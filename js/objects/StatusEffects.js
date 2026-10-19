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

  function floatText(scene, x, y, text, color) {
    if (scene && typeof scene.floatText === 'function') {
      scene.floatText(x, y, text, color);
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

    /** dt 与 GameScene 主循环口径一致：暂停/结算归零，应用倍速，上限 50ms */
    _tickScene(time, delta) {
      const s = this.scene;
      if (!s || s.paused || s.state === 'won' || s.state === 'lost') return;
      const dt = Math.min(delta, 50) / 1000 * (s.speedMul || 1);
      if (dt <= 0) return;
      this.update(dt);
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

    /** DOT 通用结算：每满 1 秒扣一次血，保底 1 点；返回计时器是否仍在持续 */
    _dot(e, slot, dt) {
      slot.timer -= dt;
      slot.acc = (slot.acc || 0) + dt;
      let guard = 0;
      while (slot.acc >= 1 && guard++ < 4) {
        slot.acc -= 1;
        if (e.dead) break;
        const dmg = Math.max(slot.minDamage || 1, Math.round(e.maxHp * slot.pct));
        e.takeDamage(dmg, slot.element || null);
      }
      return slot.timer > 0;
    }

    _tickEnemy(e, st, dt) {
      /* 灼烧（火4）：1%/秒，5 秒，不叠加只刷新 */
      if (st.burn && !this._dot(e, st.burn, dt)) st.burn = null;

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
          duckApplyStatus(e, 'wet', {
            stacks: st.wet.length,
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
            const dmg = Math.max(1, Math.round(e.maxHp * p.pct * p.timers.length));
            e.takeDamage(dmg, 'thunder');
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

    /** 火塔4：灼烧。同怪不叠加只刷新时长（cfg: duration/hpPerSecPct/minDamage） */
    applyBurn(e, cfg) {
      if (!e || e.dead || e.invulnTimer > 0) return;
      const st = this._state(e);
      const fresh = !(st.burn && st.burn.timer > 0);
      if (fresh) {
        st.burn = { timer: cfg.duration, acc: 0, pct: cfg.hpPerSecPct, minDamage: cfg.minDamage, element: 'fire' };
        floatText(this.scene, e.x, e.y - e.radius - 14, '灼烧', 0xff9a4d);
      } else {
        st.burn.timer = cfg.duration; // 多座火塔命中：只刷新持续时间
      }
      duckApplyStatus(e, 'burn', {
        duration: cfg.duration, hpPerSecPct: cfg.hpPerSecPct,
        minDamage: cfg.minDamage, element: 'fire'
      });
    }

    /** 冰塔4：+1 层寒冷值；满层触发寒冷状态并清空层数（cfg: stacksToTrigger/duration/hpPerSecPct/defReduce） */
    addColdStack(e, cfg) {
      if (!e || e.dead || e.invulnTimer > 0) return;
      const st = this._state(e);
      st.cold = st.cold || { stacks: 0 };
      st.cold.stacks++;
      if (st.cold.stacks < cfg.stacksToTrigger) return;
      st.cold.stacks = 0; // 触发即清空，可被多座冰塔快速回充
      st.coldState = { timer: cfg.duration, acc: 0, pct: cfg.hpPerSecPct, minDamage: 1, element: 'ice' };
      floatText(this.scene, e.x, e.y - e.radius - 14, '寒冷', 0x9fd8ff);
      duckApplyStatus(e, 'chill', {
        duration: cfg.duration, hpPerSecPct: cfg.hpPerSecPct,
        defReduce: cfg.defReduce, element: 'ice'
      });
    }

    /** 水塔4：+1 层潮湿，最多 maxStacks 层，每层独立计时互不刷新 */
    applyWet(e, cfg) {
      if (!e || e.dead || e.invulnTimer > 0) return;
      const st = this._state(e);
      st.wet = st.wet || [];
      if (st.wet.length >= cfg.maxStacks) return;
      st.wet.push(cfg.duration);
      st.wetPer = cfg.perStackAmp;
      st.wetEx = cfg.excludeElement;
      st.wetDur = cfg.duration;
      duckApplyStatus(e, 'wet', {
        stacks: st.wet.length, perStackAmp: cfg.perStackAmp,
        excludeElement: cfg.excludeElement, stackDuration: cfg.duration
      });
      if (st.wet.length === cfg.maxStacks) {
        floatText(this.scene, e.x, e.y - e.radius - 14, '潮湿满层', 0x35e0d0);
      }
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
      floatText(this.scene, e.x, e.y - e.radius - 14, '麻痹×' + p.timers.length, 0xffe23b);
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
      floatText(this.scene, e.x, e.y - e.radius - 14, '眩晕', 0xd9b3ff);
    }

    /** 风塔4：命中时尝试全屏风蚀增伤（10 秒共享冷却；不叠加=重复施加刷新时长） */
    tryWindAero(cfg) {
      if (this.windAeroCd > 0) return false;
      this.windAeroCd = cfg.cooldown;
      const enemies = (this.scene && this.scene.enemies) || [];
      for (const e of enemies) {
        if (e.dead || e.removed || e.invulnTimer > 0) continue;
        const st = this._state(e);
        st.wind = { timer: cfg.duration, amp: cfg.dmgAmp }; // 直接刷新，不叠加
        duckApplyStatus(e, 'windErosion', { dmgAmp: cfg.dmgAmp, duration: cfg.duration, element: 'wind' });
      }
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

      /* 火塔4：烈焰风暴 —— 命中点 50px 内所有敌人受 50% 溅射伤害并附加灼烧 */
      if (t.isFire && lv4.splash && !vsObstacle) {
        const r = lv4.splash.radius;
        if (typeof scene.spawnSplashFx === 'function') {
          scene.spawnSplashFx(this.tx, this.ty, r, this.pCfg.color);
        }
        for (const e of scene.enemies) {
          if (e.dead || e.removed || e.invulnTimer > 0) continue;
          if (Phaser.Math.Distance.Between(this.tx, this.ty, e.x, e.y) > r + e.radius) continue;
          e.takeDamage(Math.max(1, Math.round(this.damage * lv4.splash.ratio)), 'fire');
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

      /* 水塔4：高压水枪 —— 命中的目标 +1 层潮湿 */
      if (t.isWater && lv4.wet && !vsObstacle) {
        mgr.applyWet(this.target, lv4.wet);
      }

      /* 风塔4：飓风眼 —— 命中即尝试全屏风蚀增伤（共享 10 秒冷却） */
      if (t.isWind && lv4.aero && !vsObstacle) {
        if (mgr.tryWindAero(lv4.aero)) {
          floatText(scene, t.x, t.y - 46, '飓风眼！', 0x8fffc0);
        }
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
