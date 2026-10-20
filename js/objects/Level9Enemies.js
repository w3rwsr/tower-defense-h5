/* ============================================================
 * Level9Enemies.js —— 第 9 关「元素狂暴图腾」专属实体（模块隔离）
 *   依赖：config.js（TD_CONFIG）、Enemy.js（Enemy 基类）、Phaser 3.80
 *   加载顺序：config.js → storage.js → … → Enemy.js → Level8Enemies.js
 *             → 本文件 → GameScene.js
 *
 *   ┌ 模块隔离声明 ┐
 *   本文件【只新增】第 9 关实体，绝不修改：
 *     · Tower（防御塔）底层攻击逻辑 / 伤害计算 / 1~4 级配置
 *     · StatusEffects / attackModule 等异常状态管理器
 *     · 第 1~8 关任何已有实体行为与数值
 *   光环减伤通过「运行时包装 Enemy.prototype.takeDamage」实现（与
 *   StatusEffects.js 包装 Projectile.prototype.impact 同一范式），只在本关
 *   场景 bossAuraReduce>0 时生效，其它关卡恒 0 → 零影响。
 *   元素盾直接复用 Enemy 既有 applyShield / breakShield 与 shield.strict 口径。
 *
 *   内容清单：
 *     ElementShieldSlime  元素盾绿史莱姆（新特殊小怪）：绿史莱姆贴图 + 体型稍大
 *                         + 元素光环；出场即携带【随机元素护盾】（火/冰/水/雷），
 *                         每 10 秒切换成随机另一种元素；护盾期间免疫该元素的
 *                         伤害与负面效果，须用其它元素打元素反应消耗盾值破盾；
 *                         盾破后变回普通史莱姆（体型缩回、不再挂盾）。
 *     TempleGuard         蓝色圣殿守卫（终极 BOSS，强制 boss_blue 蓝史莱姆贴图）：
 *                         光环减伤 50%（小怪）+ 5000 血圣盾【strict 强制拦截】
 *                         （盾在则本体绝不掉血；未破每 5s 回满，破盾后不再重凝）
 *                         + 30% 血线狂暴（吞噬周围小怪回 10% 血 + 2s 无敌）。
 *     Level9Controller    第 9 关每帧控制器（光环减伤计算 + 第 8 关小怪贴图预生成）。
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 光环减伤钩子 —— 运行时包装 Enemy.prototype.takeDamage
   * ------------------------------------------------------------
   * 仅当所在场景 scene.bossAuraReduce > 0（= 蓝色圣殿守卫存活）时，
   * 把「非 BOSS 小怪」受到的固定伤害 ×(1 - reduce)。BOSS 本体默认不吃
   * 该光环（自身另有圣盾 + 狂暴机制），可经 JSON auraIncludeBoss 打开。
   * 幂等安装（__td9AuraPatched），非第 9 关场景该系数恒 0 → 完全零影响。
   * ============================================================ */
  function installAuraHook() {
    if (typeof Enemy === 'undefined' || Enemy.prototype.__td9AuraPatched) return;
    const orig = Enemy.prototype.takeDamage;
    Enemy.prototype.takeDamage = function (value, element, opts) {
      const s = this.scene;
      if (s && s.bossAuraReduce > 0) {
        const isBoss = !!(this.cfg && this.cfg.boss) || this.bossMini;
        if (!isBoss || s.bossAuraIncludeBoss) {
          value = value * (1 - s.bossAuraReduce);
        }
      }
      return orig.call(this, value, element, opts);
    };
    Enemy.prototype.__td9AuraPatched = true;
  }

  /* ============================================================
   * ElementShieldSlime —— 元素盾绿史莱姆（新特殊小怪）
   * ------------------------------------------------------------
   * 外观：绿史莱姆贴图（slimeVideo green 段 / 静态降级 slime_static_green），
   *       art.h 比普通快怪大 → 体型稍大；applyShield 自带的元素光环即「光圈」。
   * 机制（JSON 驱动 shieldSwitch 段）：
   *   · 出场即携带随机元素护盾（fire/ice/water/thunder），盾值 value；
   *   · 每 interval(10s) 切换成【随机另一种】元素（重挂满盾 + 换光环颜色）；
   *   · 护盾期间免疫该元素伤害（shieldBlocks，调用点在附着之前已拦截）与
   *     该元素负面效果（applySlow 内同元素拦截）；
   *   · 其它元素命中按元素反应 cost 消耗盾值（Enemy._elementShieldConsume），
   *     盾值归零即破盾；
   *   · 破盾后 → 变回普通史莱姆：清除光环、体型缩回普通档、停止切换计时。
   * ============================================================ */
  class ElementShieldSlime extends Enemy {
    constructor(scene, typeKey, routeId, opts) {
      super(scene, typeKey, routeId, opts);
      const c = (this.cfg && this.cfg.shieldSwitch) || {};
      this._ss = {
        interval: (c.interval != null) ? c.interval : 10,
        value: (c.value != null) ? c.value : 18,
        elements: (this.cfg && this.cfg.shieldElements) || ['fire', 'ice', 'water', 'thunder']
      };
      this._switchTimer = this._ss.interval;
      this.__shieldBroken = false;
      this._element = null;
      /* 记录出场体型（破盾后缩回普通史莱姆档用） */
      this._bigW = this.body.displayWidth || 0;
      this._bigH = this.body.displayHeight || 0;
      this.applyRandomShield(true);
    }

    /* 挂随机元素护盾：switch=true 时保证与上一个元素不同（需求：切换成另一种） */
    applyRandomShield(isFirst) {
      const els = this._ss.elements;
      if (!els.length) return;
      let el = els[Math.floor(Math.random() * els.length)];
      if (!isFirst && els.length > 1 && el === this._element) {
        el = els[(els.indexOf(el) + 1) % els.length];
      }
      this._element = el;
      /* compact=true：小怪数量多，只画元素光环不画盾条/文字 */
      this.applyShield({ type: 'element', element: el, value: this._ss.value, compact: true });
    }

    update(dt) {
      super.update(dt);
      if (this.dead || this.removed || !this.scene) return;
      if (this.__shieldBroken) return;      // 已变回普通史莱姆：不再挂盾/切换
      this._switchTimer -= dt;
      if (this._switchTimer <= 0) {
        this._switchTimer = this._ss.interval;
        this.applyRandomShield(false);
      }
    }

    /* 盾值归零 → 破盾：变回普通史莱姆（缩回体型 + 停切换 + 清光环） */
    breakShield() {
      super.breakShield();
      if (this.dead || this.removed) return;
      if (this.__shieldBroken) return;
      this.__shieldBroken = true;
      this._element = null;
      /* 缩回普通史莱姆体型（绿快怪档），并给一个短暂「破防」视觉提示 */
      this.body.setDisplaySize(this._bigW * 0.82, this._bigH * 0.82);
      if (this.scene && typeof this.scene.floatText === 'function') {
        this.scene.floatText(this.x, this.y - this.radius - 8, '盾破', 0xbfeaff);
      }
    }
  }

  /* ============================================================
   * TempleGuard —— 蓝色圣殿守卫（第 9 关终极 BOSS）
   * 贴图：强制 boss_blue（蓝史莱姆 Boss），noVariant=true；血量 = 同波小怪
   *       × bossHpFactor（沿用第 8 关公式）。
   * 机制（全部 JSON 驱动 guard 段）：
   *   · 圣盾：5000 血「血量盾」+ strict 强制拦截 —— 盾在（hp>0）时任何形式的
   *     伤害（单体/溅射/电链/真伤/百分比）一律由盾承担，本体【绝不】掉血，
   *     破盾当帧的溢出伤害也全部丢弃（需求第 1~3 条）。
   *     未破期间每 shieldInterval(5s) 回满一次；【盾破后不再自动重凝】
   *     （避免出现「盾条看着是满的、本体却在掉血」的误读）。
   *   · 光环减伤：本体存活期间全场小怪受击 ×(1-auraReduce=0.5)，多只不叠加
   *     （Level9Controller 取最大值置入 scene.bossAuraReduce，钩子统一结算）。
   *   · 狂暴（30% 血线，一次性）：吞噬半径 devourRadius 内最近 devourCount
   *     只小怪 → 恢复最大生命 rageHealRatio(10%) → 进入 rageInvuln(2s) 无敌。
   * ============================================================ */
  class TempleGuard extends Enemy {
    constructor(scene, typeKey, routeId, opts) {
      super(scene, typeKey, routeId, opts);
      const g = (this.cfg && this.cfg.guard) || {};
      this._g = {
        shieldHp: (g.shieldHp != null) ? g.shieldHp : 5000,
        shieldInterval: (g.shieldInterval != null) ? g.shieldInterval : 5,
        auraReduce: (g.auraReduce != null) ? g.auraReduce : 0.5,
        auraIncludeBoss: !!g.auraIncludeBoss,
        rageHpRatio: (g.rageHpRatio != null) ? g.rageHpRatio : 0.30,
        rageHealRatio: (g.rageHealRatio != null) ? g.rageHealRatio : 0.10,
        rageInvuln: (g.rageInvuln != null) ? g.rageInvuln : 2,
        devourRadius: (g.devourRadius != null) ? g.devourRadius : 150,
        devourCount: (g.devourCount != null) ? g.devourCount : 4
      };
      this.shieldTimer = this._g.shieldInterval;
      this.__enraged = false;
      /* 圣盾配色覆写（实例级）：浅蓝光环（与金/橙/紫区分） */
      this.shieldColor = function () { return 0x7fdcff; };
      /* 开局即拥有圣盾（strict：盾在则本体一滴血都不掉） */
      this.applyShield({ type: 'hp', hp: this._g.shieldHp, strict: true });

      /* 光环指示环（半径 = 吞噬半径，淡蓝呼吸；随本体移动，纯提示） */
      this._auraGfx = scene.add.graphics();
      this._auraGfx.setDepth((this.depth || 20) - 1);
      const R = this._g.devourRadius;
      this._auraGfx.lineStyle(1.5, 0x7fdcff, 0.28).strokeCircle(0, 0, R);
      this._auraGfx.fillStyle(0x7fdcff, 0.05).fillCircle(0, 0, R);
      this._auraTween = scene.tweens.add({
        targets: this._auraGfx, alpha: 0.4, duration: 1200,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
    }

    update(dt) {
      super.update(dt);
      if (this.dead || this.removed || !this.scene) return;
      if (this._auraGfx) this._auraGfx.setPosition(this.x, this.y);

      /* 圣盾：未破则每 shieldInterval 秒回满；【已破不再自动重凝】
         （strict 口径下盾破即进入可击期，玩家不会再看到「满盾却掉本体血」） */
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) {
        this.shieldTimer = this._g.shieldInterval;
        if (this.hasShield()) {
          this.shield.hp = this.shield.maxHp;
          this.refreshShieldView();
        }
      }

      /* 狂暴：血量降到 30% 触发一次（吞噬 + 回血 + 2s 无敌） */
      const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
      if (!this.__enraged && ratio <= this._g.rageHpRatio) this.enterRage();
    }

    /* 狂暴：吞噬周围小怪 → 回 10% 血 → 2 秒无敌（纯特效，不弹状态文字） */
    enterRage() {
      this.__enraged = true;
      const eaten = this.devour();
      const heal = this.maxHp * this._g.rageHealRatio;
      if (heal > 0) {
        this.hp = Math.min(this.maxHp, this.hp + heal);
        this.drawHpBar(Math.max(0, this.hp / this.maxHp));
      }
      /* 2 秒无敌（复用传送无敌通道：期间索敌与伤害均跳过） */
      this.invulnTimer = Math.max(this.invulnTimer || 0, this._g.rageInvuln);
      this._rageFx(eaten);
    }

    /* 吞噬：以本体为圆心 R 内的最近 N 只小怪（不含 BOSS/小分身），
       播放吸入特效后立即移除（不计入击杀金币，但会从场上清掉 → 推进清场） */
    devour() {
      const s = this.scene;
      if (!s || !s.enemies) return 0;
      const R = this._g.devourRadius, N = this._g.devourCount;
      const cand = [];
      for (const e of s.enemies) {
        if (!e || e === this || e.dead || e.removed) continue;
        if ((e.cfg && e.cfg.boss) || e.bossMini) continue;
        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
        if (d <= R) cand.push({ e: e, d: d });
      }
      cand.sort((a, b) => a.d - b.d);
      let eaten = 0;
      for (const c of cand) {
        if (eaten >= N) break;
        const e = c.e;
        const p = s.add.circle(e.x, e.y, e.radius || 12, 0x9fe0ff, 0.6);
        p.setDepth((e.depth || 20) + 2);
        s.tweens.add({
          targets: p, x: this.x, y: this.y, alpha: 0, scaleX: 0.35, scaleY: 0.35,
          duration: 260, ease: 'Quad.easeIn',
          onComplete: () => { try { p.destroy(); } catch (_) {} }
        });
        e.dead = true;
        e.removed = true;
        try { e.destroy(); } catch (_) {}
        eaten++;
      }
      return eaten;
    }

    /* 狂暴特效：双层淡蓝冲击环 + 中心白闪 + 全屏淡蓝罩闪 */
    _rageFx(eaten) {
      const s = this.scene;
      if (!s || !s.tweens) return;
      const R = this._g.devourRadius;
      const ring = s.add.circle(this.x, this.y, 26, 0x7fdcff, 0.5).setDepth((this.depth || 20) + 3);
      s.tweens.add({
        targets: ring, scaleX: R / 26, scaleY: R / 26, alpha: 0,
        duration: 620, ease: 'Quad.easeOut',
        onComplete: () => { try { ring.destroy(); } catch (_) {} }
      });
      const core = s.add.circle(this.x, this.y, 16, 0xffffff, 0.9).setDepth((this.depth || 20) + 4);
      s.tweens.add({
        targets: core, scaleX: 5, scaleY: 5, alpha: 0, duration: 380,
        onComplete: () => { try { core.destroy(); } catch (_) {} }
      });
      const veil = s.add.rectangle(480, 270, 960, 540, 0x7fdcff, 0.12).setDepth(800);
      s.tweens.add({
        targets: veil, alpha: 0, duration: 520,
        onComplete: () => { try { veil.destroy(); } catch (_) {} }
      });
      if (eaten > 0 && typeof s.floatText === 'function') {
        s.floatText(this.x, this.y - this.radius - 10, '吞噬 ' + eaten, 0x9fe0ff);
      }
    }

    destroy(fromScene) {
      if (this._auraTween) { try { this._auraTween.stop(); } catch (_) {} this._auraTween = null; }
      if (this._auraGfx) { try { this._auraGfx.destroy(); } catch (_) {} this._auraGfx = null; }
      super.destroy(fromScene);
    }
  }

  /* ============================================================
   * Level9Controller —— 第 9 关每帧控制器
   * 职责：统计场上存活的 TempleGuard，把 auraReduce 置入
   *       scene.bossAuraReduce（多只取同一系数，不叠加），供 takeDamage 钩子结算；
   *       并预生成第 8 关小怪（水晶史莱姆/自爆泥怪）代码绘制贴图 —— 第 9 关波次
   *       照搬第 8 关，需要这些贴图（Level8Art 全局单例，幂等）。
   * 由 GameScene 持有（this.level9），dt>0 时每帧 tick（暂停即冻结）。
   * 注：原「元素狂暴图腾」机制已按需求移除（改为「元素盾绿史莱姆」小怪）。
   * ============================================================ */
  class Level9Controller {
    constructor(scene) {
      this.scene = scene;
      /* 光环系数（仅第 9 关场景实例上有值，其它关卡恒 0 / false） */
      scene.bossAuraReduce = 0;
      scene.bossAuraIncludeBoss = false;
      if (typeof Level8Art !== 'undefined' && Level8Art.ensureAll) {
        try { Level8Art.ensureAll(scene); } catch (e) { /* 不影响进关 */ }
      }
      installAuraHook();
    }

    tick(dt) {
      const s = this.scene;
      let reduce = 0, includeBoss = false;
      const list = s.enemies || [];
      for (const e of list) {
        if (!e || e.dead || e.removed) continue;
        if (!(e instanceof TempleGuard)) continue;
        if (e._g.auraReduce > reduce) reduce = e._g.auraReduce;
        if (e._g.auraIncludeBoss) includeBoss = true;
      }
      s.bossAuraReduce = reduce;
      s.bossAuraIncludeBoss = includeBoss;
    }
  }

  /* ---- 导出：GameScene.spawnEnemy 按 typeKey 查此注册表选用专属子类 ---- */
  window.LEVEL9_ENEMY_CLASSES = {
    templeGuard: TempleGuard,
    shieldSlime: ElementShieldSlime
  };
  window.Level9Controller = Level9Controller;

  /* 模块加载即安装光环钩子（Enemy 已在其前加载；幂等） */
  installAuraHook();
})();
