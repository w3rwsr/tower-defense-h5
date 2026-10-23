/* ============================================================
 * StatusEffects.js —— 4 级塔异常状态管理器（塔侧，模块隔离设计）
 *
 * 职责边界（与怪物侧并行开发约定）：
 *  - 不修改 Enemy.js。通过怪物预留接口 applyStatus(type, data) 施加状态；
 *    接口未实装时全部安全降级（DOT/定身照常工作，增伤/降防由怪物侧结算）。
 *  - 塔侧负责：状态挂载/叠层/冷却/刷新 + 状态 DOT 伤害计算（灼烧、寒冷、麻痹值）。
 *  - 状态数值全部来自 TowerConfig.json（经 TowerConfigData.js 注入 cfg.lv4）。
 *
 * 状态一览（type, 塔来源）：
 *  - burn    灼烧   火塔4：1%最大生命/秒，5秒；同怪5秒内不叠加只刷新时长
 *  - chill   寒冷   冰塔4：满5层寒冷值触发，2%最大生命/秒 + 降20%防御，5秒
 *  - wet     潮湿   水塔4：每攻击+1层(最多5)，每层+4%受伤(非水塔)，每层独立2秒
 *  - paralysisStack 麻痹值 雷塔4：每次触发麻痹+1层(最多4)，每层-5%防御、
 *                   -0.5%最大生命/秒，每层独立2.5秒
 *  - paralyzed 麻痹定身 雷塔4：50%概率0.5秒无法移动（BOSS/小BOSS 免疫定身：
 *                   怪物侧 applyStatus('paralyzed') 按硬控免疫拦截，BOSS 只吃
 *                   麻痹值降防/DOT；接口缺失时用 applySlow(0) 兜底，同样被拦）
 *  - stun    眩晕   引力塔4：牵引结束1秒定身，BOSS免疫，每塔5秒一次
 *  - windErosion 风蚀增伤 风塔4：全屏受伤+20%，5秒，10秒全塔共享冷却，不叠加
 *
 * 运行方式：ensure(scene) 场景级单例，自挂 scene update 事件逐帧结算，
 * 不侵入 GameScene 的 update 流程；场景 shutdown 时自动反注册。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 工具 ---------- */

  /** 怪物侧预留接口 duck 调用；返回是否成功调用（供塔侧选择兜底方案） */
  function duckApplyStatus(e, type, data) {
    if (!e || e.dead || typeof e.applyStatus !== 'function') return false;
    try {
      e.applyStatus(type, data);
      return true;
    } catch (err) {
      console.warn('[StatusEffects] applyStatus(' + type + ') 调用失败（怪物侧接口异常）：', err);
      return false;
    }
  }

  /** 判断是否 BOSS（大 BOSS / 小 BOSS），眩晕类状态对其免疫 */
  function isBoss(e) {
    return !!(e && ((e.cfg && e.cfg.boss) || e.bossMini));
  }

  /* ---------- 管理器 ---------- */

  class TDStatusEffects {
    /** 场景级单例：首次调用时创建并自挂 update 事件 */
    static ensure(scene) {
      if (!scene || !scene.add || !scene.events) return null;
      patchProjectile(); // 确保弹幕命中钩子已就位（幂等）
      if (!scene.__tdLv4Status) scene.__tdLv4Status = new TDStatusEffects(scene);
      return scene.__tdLv4Status;
    }

    constructor(scene) {
      this.scene = scene;
      this.windAeroCd = 0; // 风蚀全屏增伤的共享冷却（多座风塔共用）

      this._onUpdate = (time, delta) => this._tickScene(time, delta);
      this._unbind = () => this.destroy();
      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this._unbind);
      scene.events.once(Phaser.Scenes.Events.DESTROY, this._unbind);
      scene.events.on(Phaser.Scenes.Events.UPDATE, this._onUpdate);
    }

    destroy() {
      const s = this.scene;
      if (!s) return;
      s.events.off(Phaser.Scenes.Events.UPDATE, this._onUpdate);
      if (s.__tdLv4Status === this) s.__tdLv4Status = null;
      this.scene = null;
    }

    /** 真实时间口径：Buff 时长 / DOT 频率不受 4x 倍速影响；暂停/结算归零 */
    _tickScene(time, delta) {
      const s = this.scene;
      if (!s || s.paused || s.state === 'won' || s.state === 'lost') return;
      const realDt = Math.min(delta, 50) / 1000;
      if (realDt <= 0) return;
      this.update(realDt);
    }

    update(dt) {
      if (this.windAeroCd > 0) this.windAeroCd -= dt;
      const enemies = (this.scene && this.scene.enemies) || [];
      for (const e of enemies) {
        const st = e.__lv4st;
        if (!st || e.dead || e.removed) continue;
        this._tickEnemy(e, st, dt);
      }
    }

    /* ---------- 状态容器 ---------- */

    _state(e) {
      return e.__lv4st || (e.__lv4st = {});
    }

    /** DOT 通用结算：每满 1 秒扣一次血，保底 1 点；返回计时器是否仍在持续。
        伤害按【最大生命百分比】计算 → 标记为百分比伤害（percent:true）：
        怪物侧照常经过 armorReduction（水晶史莱姆 80% 减伤等），
        打到血量护盾时最终伤害再 ×0.5（见 Enemy.takeDamage 注释）。 */
    _dot(e, slot, dt) {
      slot.timer -= dt;
      slot.acc = (slot.acc || 0) + dt;
      let guard = 0;
      while (slot.acc >= 1 && guard++ < 4) {
        slot.acc -= 1;
        if (e.dead) break;
        /* 百分比 DOT：以钳制后的 1e15 血量上限为基准，防 NaN/Infinity */
        const baseHp = (typeof tdClampHp === 'function') ? tdClampHp(e.maxHp) : e.maxHp;
        const pct = (typeof tdSafeNumber === 'function') ? tdSafeNumber(slot.pct, 0) : slot.pct;
        const dmg = Math.min(TD_MAX_HP, Math.max(slot.minDamage || 1, Math.round(baseHp * pct)));
        e.takeDamage(dmg, slot.element || null, { percent: true });
      }
      return slot.timer > 0;
    }

    _tickEnemy(e, st, dt) {
      /* 灼烧（火4）：1%/秒，5 秒，不叠加只刷新 */
      if (st.burn && !this._dot(e, st.burn, dt)) st.burn = null;
      /* 火塔解封：无限叠加灼烧层，每层独立倒计时，到期逐层移除 */
      if (st.burns && st.burns.length) {
        for (let i = st.burns.length - 1; i >= 0; i--) {
          if (!this._dot(e, st.burns[i], dt)) st.burns.splice(i, 1);
        }
        if (!st.burns.length) st.burns = null;
      }

      /* 寒冷状态（冰4）：2%/秒，5 秒 */
      if (st.coldState && !this._dot(e, st.coldState, dt)) st.coldState = null;

      /* 潮湿（水4）：每层独立 2 秒，互不刷新；层数变化时通知怪物侧重算增幅 */
      if (st.wet) {
        let changed = false;
        for (let i = st.wet.length - 1; i >= 0; i--) {
          st.wet[i] -= dt;
          if (st.wet[i] <= 0) { st.wet.splice(i, 1); changed = true; }
        }
        if (changed) {
          const totalStacks = st.wet.length + (st.wetInf || 0);
          duckApplyStatus(e, 'wet', {
            stacks: totalStacks,
            perStackAmp: st.wetPer,
            excludeElement: st.wetEx,
            stackDuration: st.wetDur
          });
          if (!st.wet.length) st.wet = null;
        }
      }

      /* 麻痹值（雷4）：每层独立 2.5 秒；每层 0.5% 最大生命/秒 DOT */
      if (st.para) {
        const p = st.para;
        let changed = false;
        for (let i = p.timers.length - 1; i >= 0; i--) {
          p.timers[i] -= dt;
          if (p.timers[i] <= 0) { p.timers.splice(i, 1); changed = true; }
        }
        if (p.timers.length) {
          p.acc = (p.acc || 0) + dt;
          let guard = 0;
          while (p.acc >= 1 && guard++ < 4) {
            p.acc -= 1;
            if (e.dead) break;
            const baseHp = (typeof tdClampHp === 'function') ? tdClampHp(e.maxHp) : e.maxHp;
            const pct = (typeof tdSafeNumber === 'function') ? tdSafeNumber(p.pct, 0) : p.pct;
            const dmg = Math.min(TD_MAX_HP,
              Math.max(1, Math.round(baseHp * pct * p.timers.length)));
            e.takeDamage(dmg, 'thunder', { percent: true });   // 最大生命百分比 → 百分比伤害
          }
        }
        if (changed) {
          duckApplyStatus(e, 'paralysisStack', {
            stacks: p.timers.length,
            perStackDefReduce: p.def,
            perStackHpPct: p.pct,
            stackDuration: p.dur,
            element: 'thunder'
          });
          if (!p.timers.length) st.para = null;
        }
      }

      /* 风蚀增伤（风4）：只计时，不叠加（重复施加刷新时长），结算在怪物侧 */
      if (st.wind) {
        st.wind.timer -= dt;
        if (st.wind.timer <= 0) st.wind = null;
      }
    }

    /* ---------- 施加接口（塔侧调用入口） ---------- */

    /** 火塔4：灼烧。默认同怪不叠加只刷新时长；第 10 关火塔解封后无限叠加，
        且每跳最低伤害提升至 seal.burnMinDamage(10)。 */
    applyBurn(e, cfg) {
      if (!e || e.dead || e.invulnTimer > 0) return;
      const st = this._state(e);
      const seal = (this.scene && typeof this.scene.getSealCfg === 'function')
        ? this.scene.getSealCfg('towerA') : null;
      const seal2 = (this.scene && typeof this.scene.getSealCfg === 'function')
        ? this.scene.getSealCfg('towerA2') : null;
      const minDamage = (seal && seal.burnMinDamage != null) ? seal.burnMinDamage
        : (seal2 ? 10 : cfg.minDamage);
      const unlimited = !!(seal && seal.burnUnlimited) || !!seal2;
      if (unlimited) {
        /* 无限叠加：每次命中新增独立倒计时层；二次解封一次附加 3 层 */
        st.burns = st.burns || [];
        const n = seal2 ? Math.max(1, seal2.burnStacksPerHit || 3) : 1;
        for (let i = 0; i < n; i++) {
          st.burns.push({
            timer: cfg.duration, acc: 0, pct: cfg.hpPerSecPct,
            minDamage: minDamage, element: 'fire'
          });
        }
      } else {
        const fresh = !(st.burn && st.burn.timer > 0);
        if (fresh) {
          st.burn = { timer: cfg.duration, acc: 0, pct: cfg.hpPerSecPct, minDamage: minDamage, element: 'fire' };
        } else {
          st.burn.timer = cfg.duration; // 多座火塔命中：只刷新持续时间
        }
      }
      duckApplyStatus(e, 'burn', {
        duration: cfg.duration, hpPerSecPct: cfg.hpPerSecPct,
        minDamage: minDamage, element: 'fire'
      });
    }

    /** 冰塔4：+1 层寒冷值；满层触发寒冷状态并清空层数（cfg: stacksToTrigger/duration/hpPerSecPct/defReduce）
     *  第 10 关冰塔解封：寒冷每秒扣血提升至 5%。 */
    addColdStack(e, cfg) {
      if (!e || e.dead || e.invulnTimer > 0) return;
      const st = this._state(e);
      st.cold = st.cold || { stacks: 0 };
      const seal2 = (this.scene && typeof this.scene.getSealCfg === 'function')
        ? this.scene.getSealCfg('towerB2') : null;
      if (seal2 && seal2.instantCold) {
        /* 二次解封：每次命中瞬间叠满，直接触发寒冷（反复刷新 DOT） */
        st.cold.stacks = cfg.stacksToTrigger;
      } else {
        st.cold.stacks++;
      }
      if (st.cold.stacks < cfg.stacksToTrigger) return;
      st.cold.stacks = 0; // 触发即清空，可被多座冰塔快速回充
      const seal = (this.scene && typeof this.scene.getSealCfg === 'function')
        ? this.scene.getSealCfg('towerB') : null;
      const pct = (seal && seal.coldHpPerSecPct != null)
        ? seal.coldHpPerSecPct : cfg.hpPerSecPct;
      st.coldState = { timer: cfg.duration, acc: 0, pct: pct, minDamage: 1, element: 'ice' };
      duckApplyStatus(e, 'chill', {
        duration: cfg.duration, hpPerSecPct: pct,
        defReduce: cfg.defReduce, element: 'ice'
      });
    }

    /** 水塔4：+1 层潮湿，最多 maxStacks 层，每层独立计时互不刷新 */
    applyWet(e, cfg) {
      if (!e || e.dead || e.invulnTimer > 0) return;
      const st = this._state(e);
      st.wetPer = cfg.perStackAmp;
      st.wetEx = cfg.excludeElement;
      st.wetDur = cfg.duration;
      const seal2 = (this.scene && typeof this.scene.getSealCfg === 'function')
        ? this.scene.getSealCfg('towerC2') : null;
      if (seal2 && seal2.unlimitedWet) {
        /* 二次解封：无限层 + 无限持续（不写倒计时数组，避免层数计时开销） */
        st.wetInf = (st.wetInf || 0) + 1;
        const stacks = (st.wet ? st.wet.length : 0) + st.wetInf;
        duckApplyStatus(e, 'wet', {
          stacks: stacks, perStackAmp: cfg.perStackAmp,
          excludeElement: cfg.excludeElement, stackDuration: Infinity
        });
        return;
      }
      st.wet = st.wet || [];
      if (st.wet.length >= cfg.maxStacks) return;
      st.wet.push(cfg.duration);
      duckApplyStatus(e, 'wet', {
        stacks: st.wet.length, perStackAmp: cfg.perStackAmp,
        excludeElement: cfg.excludeElement, stackDuration: cfg.duration
      });
    }

    /** 雷塔4：单次链击命中后的麻痹判定 + 麻痹值叠层（cfg: chance/duration/maxStacks/stackDuration/defReducePerStack/hpPerSecPctPerStack） */
    onThunderHit(e, cfg) {
      /* 说明：雷塔4 高频链击对 BOSS【只施加麻痹值（降防 + 持续掉血）】，
         0.5 秒麻痹定身由怪物侧硬控免疫（Enemy.applyStatus('paralyzed') /
         applySlow(factor 0)）拦下，BOSS 始终保持正常移动。
         引力塔4 眩晕同样对 BOSS 免疫。 */
      if (!e || e.dead || e.invulnTimer > 0) return;
      if (Math.random() >= cfg.chance) return;

      /* 麻痹 0.5 秒定身：优先怪物侧接口，未实装时用 applySlow(0) 兜底 */
      const handled = duckApplyStatus(e, 'paralyzed', { duration: cfg.duration, element: 'thunder' });
      if (!handled && typeof e.applySlow === 'function') e.applySlow(0, cfg.duration, null, true);

      /* 麻痹值 +1 层（最多 4 层，每层独立 2.5 秒） */
      const st = this._state(e);
      const p = st.para = st.para || { timers: [], acc: 0, pct: cfg.hpPerSecPctPerStack, def: cfg.defReducePerStack, dur: cfg.stackDuration };
      if (p.timers.length >= cfg.maxStacks) return;
      p.timers.push(cfg.stackDuration);
      duckApplyStatus(e, 'paralysisStack', {
        stacks: p.timers.length,
        perStackDefReduce: cfg.defReducePerStack,
        perStackHpPct: cfg.hpPerSecPctPerStack,
        stackDuration: cfg.stackDuration,
        element: 'thunder'
      });
    }

    /** 引力塔4：牵引结束后眩晕小怪 1 秒（BOSS 免疫；cfg: duration/affectBoss） */
    applyStun(e, cfg) {
      if (!e || e.dead || e.invulnTimer > 0) return;
      if (!cfg.affectBoss && isBoss(e)) return;
      if (e.freezeTimer > 0) return; // 冰冻中不重复定身，避免视觉/判定冲突
      const handled = duckApplyStatus(e, 'stun', { duration: cfg.duration });
      if (!handled && typeof e.applySlow === 'function') e.applySlow(0, cfg.duration, null, true);
    }

    /** 风塔4：命中时尝试全屏风蚀增伤（10 秒共享冷却；不叠加=重复施加刷新时长）。
     *  第 10 关风塔解封：常驻 40%（无冷却、无到期），后续新出怪在
     *  GameScene.spawnEnemy / Enemy 构造时自动继承。
     *  风塔二次解封「风神降临」：每次命中 +20% 无限叠加；自身射程内 Boss
     *  额外获得 5% 最大生命真伤/秒层（5 秒，可无限叠层）。 */
    tryWindAero(cfg, sourceTower) {
      const seal = (this.scene && typeof this.scene.getSealCfg === 'function')
        ? this.scene.getSealCfg('towerF') : null;
      const seal2 = (this.scene && typeof this.scene.getSealCfg === 'function')
        ? this.scene.getSealCfg('towerF2') : null;
      if (this.windAeroCd > 0 && !seal && !seal2) return false;
      if (!seal && !seal2) this.windAeroCd = cfg.cooldown;
      let amp = seal
        ? ((seal.dmgAmp != null) ? seal.dmgAmp : 0.40)
        : (seal2 ? 0 : ((cfg.dmgAmp != null) ? cfg.dmgAmp : 0.20));
      if (seal2) {
        /* 每次风塔命中：全局 +20% 增伤永久叠层（无上限） */
        const add = (seal2.ampPerHit != null) ? seal2.ampPerHit : 0.20;
        this.scene.windGodStacks = tdSafeNumber((this.scene.windGodStacks || 0) + add, 0);
        amp += this.scene.windGodStacks;
      }
      if (this.scene) this.scene.windSealAmp = amp;
      const duration = (seal || seal2) ? 1e9 : cfg.duration;
      const enemies = (this.scene && this.scene.enemies) || [];
      for (const e of enemies) {
        if (e.dead || e.removed || e.invulnTimer > 0) continue;
        const st = this._state(e);
        st.wind = { timer: duration, amp: amp }; // 直接刷新，不叠加
        duckApplyStatus(e, 'windErosion', { dmgAmp: amp, duration: duration, element: 'wind' });
      }
      /* 风神降临：自身射程内 Boss 叠一层 5% 真伤/秒（5 秒） */
      if (seal2) {
        const bossPct = (seal2.bossDotPctPerSec != null) ? seal2.bossDotPctPerSec : 0.05;
        const bossDur = (seal2.bossDotDuration != null) ? seal2.bossDotDuration : 5;
        const range = sourceTower && sourceTower.stats ? sourceTower.stats.range : 0;
        const r2 = range > 0 ? range * range : Infinity;
        for (const e of enemies) {
          if (e.dead || e.removed || e.invulnTimer > 0) continue;
          if (!((e.cfg && e.cfg.boss) || e.bossMini)) continue;
          if (Number.isFinite(r2) && sourceTower) {
            const dx = e.x - sourceTower.x, dy = e.y - sourceTower.y;
            if (dx * dx + dy * dy > r2) continue;
          }
          e._windGodDots = e._windGodDots || [];
          e._windGodDots.push(bossDur);
          /* 保证层数伤害使用配置值（Enemy.update 读取怪物侧默认 5%） */
          e._windGodDotPct = bossPct;
        }
      }
      if (this.scene) this.scene.windSealPermanent = true;
      return true;
    }
  }

  /* ---------- 弹幕命中钩子（不改 Projectile.js，运行时包装 impact） ---------- */

  function patchProjectile() {
    if (typeof Projectile === 'undefined' || !Projectile.prototype || Projectile.prototype.__lv4Patched) return;
    Projectile.prototype.__lv4Patched = true;
    /** 原版 impact 之前的 4 级塔附加结算（溅射/挂状态/全屏增伤） */
    Projectile.prototype.__lv4OnImpact = function () {
      const t = this.sourceTower;
      if (!t || !t.scene || !t.cfg || !t.cfg.lv4 || t.level < 4) return;
      const lv4 = t.cfg.lv4;
      const scene = this.scene;
      const mgr = TDStatusEffects.ensure(scene);
      if (!mgr) return;
      const vsObstacle = !!(this.target && this.target.isObstacle);

      /* 火塔4：烈焰风暴 —— 命中点 50px 内所有敌人受溅射伤害并附加灼烧。
         第 10 关无尽：溅射倍率覆盖为 200%（endless.fireSplashRatio），
         伤害基于 this.damage（= 火塔当前攻击力，含等级/加成）；其他关卡仍 50%。 */
      if (t.isFire && lv4.splash && !vsObstacle) {
        const r = lv4.splash.radius;
        if (typeof scene.spawnSplashFx === 'function') {
          scene.spawnSplashFx(this.tx, this.ty, r, this.pCfg.color);
        }
        const ratio = (typeof scene.getFireSplashRatio === 'function' &&
          scene.getFireSplashRatio() != null)
          ? scene.getFireSplashRatio() : lv4.splash.ratio;
        for (const e of scene.enemies) {
          if (e.dead || e.removed || e.invulnTimer > 0) continue;
          if (Phaser.Math.Distance.Between(this.tx, this.ty, e.x, e.y) > r + e.radius) continue;
          e.takeDamage(Math.max(1, Math.round(this.damage * ratio)), 'fire');
          if (!e.dead) mgr.applyBurn(e, lv4.burn);
        }
      }

      /* 冰塔4：绝对零度 —— 溅射范围内每个被命中的敌人 +1 层寒冷值 */
      if (t.isIce && lv4.cold && !vsObstacle) {
        const r = (this.effect && this.effect.splashRadius) || 0;
        for (const e of scene.enemies) {
          if (e.dead || e.removed || e.invulnTimer > 0) continue;
          if (Phaser.Math.Distance.Between(this.tx, this.ty, e.x, e.y) <= r + e.radius) {
            mgr.addColdStack(e, lv4.cold);
          }
        }
      }

      /* 水塔4：高压水枪 —— 命中的目标 +1 层潮湿。
         第 10 关水塔解封：以命中点为中心半径 wetRadius(100) 内全部敌人
         施加潮湿，每层易伤提升至 seal.wetPerStackAmp(20%)，5 层满 100%。 */
      if (t.isWater && lv4.wet && !vsObstacle) {
        const seal = (typeof scene.getSealCfg === 'function')
          ? scene.getSealCfg('towerC') : null;
        if (seal) {
          const r = (seal.wetRadius != null) ? seal.wetRadius : 100;
          const wetCfg = Object.assign({}, lv4.wet, {
            perStackAmp: (seal.wetPerStackAmp != null) ? seal.wetPerStackAmp : 0.20
          });
          if (typeof scene.spawnSplashFx === 'function') {
            scene.spawnSplashFx(this.tx, this.ty, r, this.pCfg.color);
          }
          for (const e of scene.enemies) {
            if (e.dead || e.removed || e.invulnTimer > 0) continue;
            if (Phaser.Math.Distance.Between(this.tx, this.ty, e.x, e.y) > r + e.radius) continue;
            mgr.applyWet(e, wetCfg);
          }
        } else {
          mgr.applyWet(this.target, lv4.wet);
        }
      }

      /* 风塔4：飓风眼 —— 命中即尝试全屏风蚀增伤（共享 10 秒冷却，状态由特效体现）
         二次解封「风神降临」：把发射塔传入，用于判断自身射程内 Boss 叠真伤层 */
      if (t.isWind && lv4.aero && !vsObstacle) {
        mgr.tryWindAero(lv4.aero, this.sourceTower);
      }
    };

    const _impact = Projectile.prototype.impact;
    Projectile.prototype.impact = function () {
      try { this.__lv4OnImpact(); } catch (err) { console.warn('[StatusEffects] 4级弹幕命中钩子异常：', err); }
      return _impact.apply(this, arguments);
    };
  }

  window.TDStatusEffects = TDStatusEffects;
  window.__tdPatchLv4Projectile = patchProjectile;

  /* 脚本加载即尝试挂钩（正常脚本顺序下 Projectile.js 先于本文件加载）；
   * 若顺序异常，ensure() 首次调用时仍会补挂（幂等）。 */
  patchProjectile();
})();
