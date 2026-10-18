/* ============================================================
 * Level8Enemies.js —— 第 8 关「风蚀荒原」专属实体（模块隔离）
 *   依赖：config.js（TD_CONFIG）、Enemy.js（Enemy 基类）、Phaser 3.80
 *   加载顺序：config.js → storage.js → … → Enemy.js → 本文件 → GameScene.js
 *
 *   ┌ 模块隔离声明 ┐
 *   本文件【只新增】第 8 关实体，绝不修改：
 *     · Tower（防御塔）底层攻击逻辑 / 伤害计算 / 1~3 级配置
 *     · StatusEffects / attackModule 等异常状态管理器
 *     · 第 1~7 关任何已有实体行为
 *   塔「禁言」通过 GameScene.silenceTower 的实例级 update 包装实现
 *   （运行时换装，不改 Tower.js 源码）；异常状态挂载走 Enemy 暴露的
 *   状态接口（isFrozen / armorReduction / burnStacks / addParalysis /
 *   applyArmorBreak），由 4 级塔（另一并行任务）按接口调用。
 *
 *   内容清单：
 *     Level8Art          三种新怪代码绘制贴图（Graphics.generateTexture，
 *                        键名 = enemy_<typeKey>，进关时预生成一次）
 *     CrystalSlime       水晶史莱姆：80% 减伤（寒冷/麻痹归零）+ 果冻跳动
 *                        + 高光闪烁 + 冰蓝粒子拖尾
 *     BomberSlime        自爆泥怪：极快移速 + 死亡/碰塔爆炸 → 半径 50 内
 *                        塔「禁言」2 秒 + 高频膨胀 + 红色残影
 *     LavaBehemoth       熔岩巨兽（终极 BOSS）：三阶段状态机
 *                        P1 每 5s 岩盾 5000（盾存本体免疫一切伤害）
 *                        P2 移速 +50% + 召唤 4 自爆泥怪
 *                        P3 移速再 +30% + 身后 0.5s/个火焰路径灼烧防御塔
 *     WindEye            风眼装饰（不可建造）：每 10s 全屏风蚀增伤 +20%（5s）
 *     Level8Controller   第 8 关每帧控制器（风眼计时 / 风蚀倒计时 / 火焰路径）
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * Level8Art —— 代码绘制贴图（无贴图资源依赖，2x 超采样离屏生成）
   * ============================================================ */
  const Level8Art = {
    /** 进关时预生成三种新怪贴图（GameScene.create → Level8Controller 内调用）；
     *  Enemy 构造器按 'enemy_<typeKey>' 取图，故必须先于首波出怪执行 */
    ensureAll(scene) {
      if (!scene.textures.exists('enemy_crystalSlime')) this.crystal(scene);
      if (!scene.textures.exists('enemy_bomberSlime')) this.bomber(scene);
      if (!scene.textures.exists('enemy_lavaBoss')) this.lava(scene);
    },

    /* 水晶史莱姆：半透明冰蓝圆球（本体 alpha 0.88 由子类叠加；高光点由
       子类单独 Graphics 承载以实现 1 秒周期闪烁，不烧进贴图） */
    crystal(scene) {
      const g = scene.make.graphics({}, false);
      const cx = 48, cy = 48, r = 42;           // 96×96，显示 h 42
      g.fillStyle(0x5aa8d8, 0.95);              // 深冰蓝外圈
      g.fillCircle(cx, cy, r);
      g.fillStyle(0x9fdcff, 0.92);              // 冰蓝主球
      g.fillCircle(cx, cy, r - 6);
      g.fillStyle(0xd8f4ff, 0.7);               // 内芯高透
      g.fillCircle(cx - 6, cy - 8, r - 18);
      /* 冰晶棱面折线 */
      g.lineStyle(2, 0xeaffff, 0.5);
      g.beginPath();
      g.moveTo(cx - r + 8, cy + 8);
      g.lineTo(cx - 10, cy - 20);
      g.lineTo(cx + 14, cy + 14);
      g.lineTo(cx + r - 6, cy - 10);
      g.strokePath();
      g.beginPath();
      g.moveTo(cx - 16, cy - 26);
      g.lineTo(cx + 4, cy + 2);
      g.strokePath();
      g.generateTexture('enemy_crystalSlime', 96, 96);
      g.destroy();
    },

    /* 自爆泥怪：暗红圆球 + 黑色不规则裂纹（红色警示「!」由子类 Text 悬浮） */
    bomber(scene) {
      const g = scene.make.graphics({}, false);
      const cx = 40, cy = 40, r = 36;           // 80×80，显示 h 38
      g.fillStyle(0x7a1f16, 1);                 // 暗红底
      g.fillCircle(cx, cy, r);
      g.fillStyle(0xd94a3a, 1);                 // 主球体
      g.fillCircle(cx, cy, r - 5);
      g.fillStyle(0xe86a4a, 0.8);               // 局部受热高光
      g.fillCircle(cx - 8, cy - 10, r - 20);
      /* 黑色不规则裂纹 × 4 */
      g.lineStyle(3, 0x1a0a06, 0.9);
      g.beginPath(); g.moveTo(cx - 18, cy - 20); g.lineTo(cx - 4, cy - 4); g.lineTo(cx - 14, cy + 14); g.strokePath();
      g.beginPath(); g.moveTo(cx + 20, cy - 12); g.lineTo(cx + 4, cy + 2); g.lineTo(cx + 16, cy + 20); g.strokePath();
      g.beginPath(); g.moveTo(cx - 2, cy - 30); g.lineTo(cx + 2, cy - 8); g.strokePath();
      g.beginPath(); g.moveTo(cx + 26, cy + 8); g.lineTo(cx + 8, cy + 13); g.strokePath();
      g.generateTexture('enemy_bomberSlime', 80, 80);
      g.destroy();
    },

    /* 熔岩巨兽：暗色岩躯 + 熔岩裂纹 + 灼灼双眼（100×160，aspect 0.625 →
       显示 h 78 时可见宽约 49 ≤ 路宽 50，不超道路边界） */
    lava(scene) {
      const g = scene.make.graphics({}, false);
      const cx = 50;
      g.fillStyle(0x4a1d0d, 1);                 // 底座岩体
      g.fillEllipse(cx, 134, 88, 46);
      g.fillStyle(0x592815, 1);                 // 主躯干（上窄下宽）
      g.fillEllipse(cx, 94, 70, 96);
      g.fillStyle(0x6b3320, 1);                 // 正面受光岩面
      g.fillEllipse(cx - 8, 82, 50, 70);
      g.fillStyle(0x3a1409, 1);                 // 岩壳尖刺
      g.fillTriangle(cx - 30, 42, cx - 14, 8, cx - 2, 44);
      g.fillTriangle(cx + 2, 40, cx + 16, 4, cx + 32, 42);
      g.fillTriangle(cx - 46, 72, cx - 30, 50, cx - 20, 76);
      g.fillTriangle(cx + 20, 76, cx + 32, 52, cx + 46, 74);
      /* 熔岩裂纹（橙芯 + 亮黄内线） */
      g.lineStyle(4, 0xff6a2a, 0.95);
      g.beginPath(); g.moveTo(cx - 20, 52); g.lineTo(cx - 6, 78); g.lineTo(cx - 22, 106); g.lineTo(cx - 6, 126); g.strokePath();
      g.beginPath(); g.moveTo(cx + 22, 58); g.lineTo(cx + 8, 88); g.lineTo(cx + 24, 118); g.strokePath();
      g.lineStyle(2.5, 0xffc24a, 0.9);
      g.beginPath(); g.moveTo(cx - 6, 78); g.lineTo(cx + 8, 88); g.strokePath();
      /* 双眼 */
      g.fillStyle(0xffd24a, 1);
      g.fillEllipse(cx - 14, 62, 13, 8);
      g.fillEllipse(cx + 14, 62, 13, 8);
      g.fillStyle(0x2a0d05, 1);
      g.fillCircle(cx - 14, 62, 2.5);
      g.fillCircle(cx + 14, 62, 2.5);
      /* 胸口熔核 */
      g.fillStyle(0xff8c3a, 0.95);
      g.fillCircle(cx, 104, 9);
      g.fillStyle(0xffd24a, 0.9);
      g.fillCircle(cx, 104, 4);
      g.generateTexture('enemy_lavaBoss', 100, 160);
      g.destroy();
    }
  };

  /* ============================================================
   * CrystalSlime —— 水晶史莱姆
   * 机制：80% 基础减伤；存在「寒冷」（冰元素附着 / 减速 / 冰冻）或
   *       「麻痹值」> 0 时减伤立刻归零（全额伤害）。
   * 动效：果冻跳动（压扁拉长 Tween）+ 高光点 1 秒周期闪烁 + 冰蓝粒子拖尾。
   * ============================================================ */
  class CrystalSlime extends Enemy {
    constructor(scene, typeKey, routeId, opts) {
      super(scene, typeKey, routeId, opts);
      const cfg = this.cfg || {};
      this.armorBase = (cfg.armorBase != null) ? cfg.armorBase : 0.8;
      this.dmgReduction = this.armorBase;   // 初始即 80% 减伤（update 每帧复核）
      /* 半透明冰蓝质感 */
      this.body.setAlpha(0.88);
      /* 高光点（2~3 个白点，透明度 1 秒周期闪烁） */
      const r = this.radius;
      const hl = scene.add.graphics();
      hl.fillStyle(0xffffff, 0.95);
      hl.fillCircle(-r * 0.35, -r * 0.4, r * 0.17);
      hl.fillCircle(r * 0.32, -r * 0.22, r * 0.11);
      hl.fillCircle(-r * 0.05, r * 0.32, r * 0.09);
      this.add(hl);
      this._hlTween = scene.tweens.add({
        targets: hl, alpha: 0.2, duration: 1000, yoyo: true,
        repeat: -1, ease: 'Sine.easeInOut'
      });
      /* 果冻跳动：压扁拉长（宽度 -10% ↔ 高度 +12%） */
      const bx = this.body.scaleX, by = this.body.scaleY;
      this._jellyTween = scene.tweens.add({
        targets: this.body,
        scaleX: bx * 0.9, scaleY: by * 1.12,
        duration: 640, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
      this._trailClock = 0;
    }

    update(dt) {
      super.update(dt);
      if (this.dead || this.removed || !this.scene) return;
      /* 减伤归零判定：寒冷（冰元素/减速/冰冻）或麻痹值 > 0 → 立刻全额承伤 */
      const cold = this.slowTimer > 0 || this.freezeTimer > 0 ||
        (this.reactionsEnabled ? this.hasElement('ice') : this.element === 'ice');
      this.dmgReduction = (cold || this.paralysis > 0) ? 0 : this.armorBase;
      /* 冰蓝粒子拖尾（移动时身后微弱光点，冻结时不产尾） */
      this._trailClock += dt;
      if (this._trailClock >= 0.16) {
        this._trailClock = 0;
        if (this.freezeTimer <= 0) {
          const p = this.scene.add.circle(this.x, this.y + 4, 5, 0x9fdcff, 0.5);
          p.setDepth(this.depth - 1);
          this.scene.tweens.add({
            targets: p, alpha: 0, scaleX: 0.3, scaleY: 0.3,
            duration: 380, onComplete: () => { try { p.destroy(); } catch (_) {} }
          });
        }
      }
    }

    destroy(fromScene) {
      if (this._hlTween) { try { this._hlTween.stop(); } catch (_) {} this._hlTween = null; }
      if (this._jellyTween) { try { this._jellyTween.stop(); } catch (_) {} this._jellyTween = null; }
      super.destroy(fromScene);
    }
  }

  /* ============================================================
   * BomberSlime —— 自爆泥怪
   * 机制：移速极快（132）；死亡时（或碰到塔时）爆炸，使爆炸半径
   *       （JSON explodeRadius=50 + 自身体积补偿）内的防御塔「禁言」
   *       （完全停止攻击）2 秒（GameScene.silenceTower，不改塔源码）。
   * 动效：高频小幅膨胀收缩（170ms）+ 移动红色残影 + 头顶红色警示「!」。
   * ============================================================ */
  class BomberSlime extends Enemy {
    constructor(scene, typeKey, routeId, opts) {
      super(scene, typeKey, routeId, opts);
      const cfg = this.cfg || {};
      this.explodeRadius = (cfg.explodeRadius != null) ? cfg.explodeRadius : 50;
      this.explodeSilence = (cfg.explodeSilence != null) ? cfg.explodeSilence : 2;
      this.contactRange = (cfg.contactRange != null) ? cfg.contactRange : 64;
      this._exploded = false;
      /* 头顶悬浮红色警示「!」（微微上下浮动） */
      const mark = scene.add.text(0, -this.radius - 18, '!', {
        fontFamily: TD_FONT_STACK, fontSize: '17px', fontStyle: 'bold',
        color: '#ff3b3b', resolution: TD_TEXT_RES
      }).setOrigin(0.5).setStroke('#3a0c08', 3);
      this.add(mark);
      this._markTween = scene.tweens.add({
        targets: mark, y: '-=3', duration: 300,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
      /* 高频小幅度膨胀收缩（模拟濒临爆炸的抖动） */
      const bx = this.body.scaleX, by = this.body.scaleY;
      this._pulseTween = scene.tweens.add({
        targets: this.body,
        scaleX: bx * 1.07, scaleY: by * 1.07,
        duration: 170, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      });
      this._ghostClock = 0;
    }

    update(dt) {
      super.update(dt);
      if (this.dead || this.removed || !this.scene) return;
      /* 红色残影（短促淡出的小圆） */
      this._ghostClock += dt;
      if (this._ghostClock >= 0.12) {
        this._ghostClock = 0;
        const g = this.scene.add.circle(this.x, this.y, this.radius * 0.85, 0xd94a3a, 0.32);
        g.setDepth(this.depth - 1);
        this.scene.tweens.add({
          targets: g, alpha: 0, duration: 240,
          onComplete: () => { try { g.destroy(); } catch (_) {} }
        });
      }
      /* 碰塔引爆：与任一存活塔中心距 < contactRange 即爆炸 */
      const towers = this.scene.towers || [];
      for (const tw of towers) {
        if (!tw || tw.removed) continue;
        if (Phaser.Math.Distance.Between(this.x, this.y, tw.x, tw.y) < this.contactRange) {
          this.detonate();
          break;
        }
      }
    }

    /* 爆炸：特效 → 半径内塔禁言 → 自毁（走正常击杀流程保证波次计数一致） */
    detonate() {
      if (this._exploded || this.dead || this.removed || !this.scene) return;
      this._exploded = true;
      this.explodeFx();
      const reach = this.explodeRadius + this.radius; // 半径 50 + 自身体积补偿
      const towers = this.scene.towers || [];
      for (const tw of towers) {
        if (!tw || tw.removed) continue;
        if (Phaser.Math.Distance.Between(this.x, this.y, tw.x, tw.y) <= reach) {
          this.scene.silenceTower(tw, this.explodeSilence);
        }
      }
      /* 自毁：dead 尚为 false 时经 onEnemyKilled 正常结算（金币/清场计数）；
         被塔打死的情况（playDeath 已置 dead）此调用自然空转 */
      this.scene.onEnemyKilled(this);
    }

    /* 爆炸特效：橙核闪爆 + 扩散冲击环 + 「轰！」飘字 */
    explodeFx() {
      const s = this.scene;
      const reach = this.explodeRadius + this.radius;
      const core = s.add.circle(this.x, this.y, 12, 0xffd08a, 0.95);
      core.setDepth(this.depth + 2);
      s.tweens.add({
        targets: core, scaleX: reach / 12, scaleY: reach / 12, alpha: 0,
        duration: 300, ease: 'Quad.easeOut', onComplete: () => { try { core.destroy(); } catch (_) {} }
      });
      const ring = s.add.circle(this.x, this.y, reach * 0.4, 0xff7a3c, 0);
      ring.setStrokeStyle(3, 0xff9d5c, 0.9);
      ring.setDepth(this.depth + 2);
      s.tweens.add({
        targets: ring, scaleX: 1.6, scaleY: 1.6, alpha: 0,
        duration: 420, ease: 'Quad.easeOut', onComplete: () => { try { ring.destroy(); } catch (_) {} }
      });
      if (typeof s.floatText === 'function') {
        s.floatText(this.x, this.y - 26, '轰！', 0xff9d5c);
      }
    }

    /* 被塔打死同样爆炸（takeDamage → onEnemyKilled → playDeath） */
    playDeath() {
      if (!this._exploded) this.detonate();
      super.playDeath();
    }

    destroy(fromScene) {
      if (this._markTween) { try { this._markTween.stop(); } catch (_) {} this._markTween = null; }
      if (this._pulseTween) { try { this._pulseTween.stop(); } catch (_) {} this._pulseTween = null; }
      super.destroy(fromScene);
    }
  }

  /* ============================================================
   * LavaBehemoth —— 终极 BOSS 熔岩巨兽（三阶段状态机）
   * 免疫：冰冻/眩晕/牵引（沿用 cfg.boss 既有豁免链：冰冻→30% 减速、
   *       易伤拒绝、塔D 索敌排除 BOSS）；可被 4 级塔灼烧/降防影响
   *       （Enemy.burnStacks / armorBreaks 状态接口）。
   * 阶段一（100%~70% 血）：每 5s 生成/重塑 5000 血「岩盾」；盾存续期间
   *       本体免疫一切伤害（hp 盾吸收全部伤害，见 Enemy.takeDamage）。
   * 阶段二（70%~30% 血）：移速 +50%，立刻召唤 4 只自爆泥怪。
   * 阶段三（30% 以下）：移速再 +30%，身后每 0.5s 留置「火焰路径」，
   *       对踩在上面的防御塔造成持续伤害（禁言压制，GameScene.silenceTower）。
   * 注：lvPhase 为本 BOSS 专属阶段位，与第 5/7 关 bossPhase 分裂系统
   *     完全独立（bossPhase 恒 0，不触发 checkBossSplit）。
   * ============================================================ */
  class LavaBehemoth extends Enemy {
    constructor(scene, typeKey, routeId, opts) {
      super(scene, typeKey, routeId, opts);
      const ph = (this.cfg && this.cfg.phases) || {};
      this._ph = {
        shieldHp: ph.rockShieldHp != null ? ph.rockShieldHp : 5000,
        shieldInterval: ph.rockShieldInterval != null ? ph.rockShieldInterval : 5,
        p2Ratio: ph.p2HpRatio != null ? ph.p2HpRatio : 0.7,
        p2SpeedMul: ph.p2SpeedMul != null ? ph.p2SpeedMul : 1.5,
        p2Summon: ph.p2SummonCount != null ? ph.p2SummonCount : 4,
        p3Ratio: ph.p3HpRatio != null ? ph.p3HpRatio : 0.3,
        p3SpeedMul: ph.p3SpeedMul != null ? ph.p3SpeedMul : 1.3,
        fireInterval: ph.firePathInterval != null ? ph.firePathInterval : 0.5,
        fireRadius: ph.firePathRadius != null ? ph.firePathRadius : 42,
        fireHit: ph.firePathHitRange != null ? ph.firePathHitRange : 62,
        fireLife: ph.firePathLife != null ? ph.firePathLife : 6
      };
      this.lvPhase = 1;                 // 1=岩盾期 2=狂暴期 3=燃地期
      this.shieldTimer = this._ph.shieldInterval;
      this.fireTimer = 0;
      /* 岩盾配色覆写（实例级）：熔岩橙光环 + 「岩盾击破！」专属文案 */
      this.shieldColor = function () { return 0xff8c3a; };
    }

    update(dt) {
      super.update(dt);
      if (this.dead || this.removed || !this.scene) return;
      const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
      /* 三阶段血线驱动转换（单向、不回退，转换即生效保证流畅） */
      if (this.lvPhase === 1 && ratio <= this._ph.p2Ratio) this.enterPhase2();
      if (this.lvPhase === 2 && ratio <= this._ph.p3Ratio) this.enterPhase3();

      /* 阶段一：每 5s 生成岩盾；未破则满血重塑（盾存本体免疫一切伤害） */
      if (this.lvPhase === 1) {
        this.shieldTimer -= dt;
        if (this.shieldTimer <= 0) {
          this.shieldTimer = this._ph.shieldInterval;
          if (this.shield && this.shield.type === 'hp') {
            this.shield.hp = this.shield.maxHp;
            this.refreshShieldView();
          } else if (!this.shield) {
            this.applyShield({ type: 'hp', hp: this._ph.shieldHp });
            if (typeof this.scene.floatText === 'function') {
              this.scene.floatText(this.x, this.y - this.radius - 42, '岩盾凝聚！', 0xffb27a);
            }
          }
        }
      }

      /* 阶段三：身后每 0.5s 留置火焰路径（区域结算托管给 Level8Controller） */
      if (this.lvPhase === 3) {
        this.fireTimer -= dt;
        if (this.fireTimer <= 0) {
          this.fireTimer = this._ph.fireInterval;
          if (this.scene.level8) {
            this.scene.level8.addFireZone(this.x, this.y, this._ph);
          }
        }
      }
    }

    /* 阶段二：移速 +50% + 立即召唤 4 只自爆泥怪（本位前后错开沿路） */
    enterPhase2() {
      this.lvPhase = 2;
      this.baseSpeed *= this._ph.p2SpeedMul;
      this.shieldTimer = 0;
      const s = this.scene;
      for (let i = 0; i < this._ph.p2Summon; i++) {
        const e = s.spawnEnemy({ type: 'bomberSlime', route: this.routeId });
        if (e) {
          e.pathDist = Math.max(0, this.pathDist - 8 - i * 16);
          const p = s.pathPointAt(e.pathDist, e.routeId);
          e.setPosition(p.x, p.y);
          e.drawHpBar(1);
        }
      }
      if (typeof s.banner === 'function') s.banner('熔岩巨兽进入狂暴阶段！', 0xff7a3c);
      if (typeof s.floatText === 'function') {
        s.floatText(this.x, this.y - this.radius - 44, '移速 +50%，召唤泥怪！', 0xff7a3c);
      }
    }

    /* 阶段三：移速再 +30% + 开启火焰路径留置 */
    enterPhase3() {
      this.lvPhase = 3;
      this.baseSpeed *= this._ph.p3SpeedMul;
      this.fireTimer = 0;
      const s = this.scene;
      if (typeof s.banner === 'function') s.banner('熔岩巨兽燃烧大地！', 0xff5a2a);
      if (typeof s.floatText === 'function') {
        s.floatText(this.x, this.y - this.radius - 44, '移速再 +30%，大地灼烧！', 0xff5a2a);
      }
    }

    /* 破盾文案专属化：岩盾击破（熔岩橙爆裂），其余同基类流程 */
    breakShield() {
      const s = this.shield;
      if (!s) return;
      if (this.scene && typeof this.scene.floatText === 'function') {
        this.scene.floatText(this.x, this.y - this.radius - 34, '岩盾击破！', 0xffb27a);
      }
      if (this.scene && typeof this.scene.makePortalBurst === 'function') {
        this.scene.makePortalBurst(this.x, this.y, 0xff8c3a);
      }
      this.shield = null;
      this.clearShieldGfx();
    }

    destroy(fromScene) {
      /* 火焰路径区域不随 BOSS 死亡消失（由 Level8Controller 独立衰减） */
      super.destroy(fromScene);
    }
  }

  /* ============================================================
   * WindEye —— 风眼装饰（不可建造）
   * 双层旋涡代码绘制 + 匀速旋转；每 interval(10s) 触发一次全屏
   * 「风蚀增伤」：全场怪物受伤 +20%（windErosionTimer 5s，
   * Enemy.takeDamage 统一结算），伴随扩散冲击环与全屏淡青罩闪。
   * ============================================================ */
  class WindEye {
    constructor(scene, x, y, opts) {
      this.scene = scene;
      this.x = x;
      this.y = y;
      this.interval = (opts && opts.interval) || 10;
      this.cd = this.interval;      // 进关后首圈满间隔
      const g = scene.add.graphics();
      g.setPosition(x, y);
      g.setDepth(4);                // 路面之上、火力点(15)/怪物(20+)之下
      /* 外圈 + 双弧旋涡 + 中心气旋 */
      g.fillStyle(0x9fe2ff, 0.16);
      g.fillCircle(0, 0, 27);
      g.lineStyle(2.5, 0x7fd4ff, 0.85);
      g.strokeCircle(0, 0, 20);
      g.lineStyle(1.5, 0xbfeaff, 0.7);
      g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 1.35); g.strokePath();
      g.beginPath(); g.arc(0, 0, 8, Math.PI, Math.PI * 2.2); g.strokePath();
      g.fillStyle(0x9fe2ff, 0.55);
      g.fillCircle(0, 0, 4.5);
      this.gfx = g;
      this.spinTween = scene.tweens.add({
        targets: g, angle: 360, duration: 4000, repeat: -1
      });
      const label = scene.add.text(x, y + 34, '🌪 风眼', {
        fontFamily: TD_FONT_STACK, fontSize: '11px', fontStyle: 'bold',
        color: '#bfeaff', resolution: TD_TEXT_RES
      }).setOrigin(0.5).setStroke('#1e3a4a', 3).setAlpha(0.85);
      label.setDepth(4);
      this.label = label;
    }

    tick(dt) {
      this.cd -= dt;
      if (this.cd <= 0) {
        this.cd = this.interval;
        this.trigger();
      }
    }

    trigger() {
      const s = this.scene;
      const cfg = (s.levelCfg && s.levelCfg.windEyes) || {};
      /* 全屏风蚀增伤：窗口由 Enemy.takeDamage 读取结算 */
      s.windErosionTimer = (cfg.duration != null) ? cfg.duration : 5;
      /* 扩散冲击环 */
      const blast = s.add.circle(this.x, this.y, 26, 0x9fe2ff, 0.5);
      blast.setDepth(6);
      s.tweens.add({
        targets: blast, scaleX: 7, scaleY: 7, alpha: 0,
        duration: 750, ease: 'Quad.easeOut', onComplete: () => { try { blast.destroy(); } catch (_) {} }
      });
      /* 全屏淡青罩闪（快速淡出，纯提示） */
      const veil = s.add.rectangle(480, 270, 960, 540, 0x9fe2ff, 0.1).setDepth(800);
      s.tweens.add({
        targets: veil, alpha: 0, duration: 550,
        onComplete: () => { try { veil.destroy(); } catch (_) {} }
      });
      if (typeof s.floatText === 'function') {
        s.floatText(this.x, this.y - 44, '风蚀增伤 +20%！', 0xbfeaff);
      }
    }
  }

  /* ============================================================
   * Level8Controller —— 第 8 关每帧控制器
   * 职责：风眼计时触发 / 风蚀增伤倒计时 / 火焰路径区域结算与绘制。
   * 由 GameScene 持有（this.level8），dt>0 时每帧 tick（暂停即冻结）。
   * ============================================================ */
  class Level8Controller {
    constructor(scene) {
      this.scene = scene;
      const cfg = (scene.levelCfg && scene.levelCfg.windEyes) || {};
      /* 风蚀增伤全局窗口（仅第 8 关场景实例上有值，旧关卡恒 undefined） */
      scene.windErosionTimer = 0;
      scene.windErosionMul = (cfg.damageMul != null) ? cfg.damageMul : 0.2;
      /* 预生成三种新怪贴图（先于首波出怪） */
      Level8Art.ensureAll(scene);
      /* 固定 2 个风眼装饰 */
      this.windEyes = (cfg.points || []).map((p) =>
        new WindEye(scene, p.x, p.y, { interval: cfg.interval || 10 }));
      /* 火焰路径（BOSS 阶段三）共享绘制层与区域列表 */
      this.fireGfx = scene.add.graphics().setDepth(12);
      this.fireZones = [];
    }

    /** BOSS 阶段三留置火焰路径（LavaBehemoth 每 0.5s 调用） */
    addFireZone(x, y, ph) {
      this.fireZones.push({
        x, y,
        r: ph.fireRadius != null ? ph.fireRadius : 42,
        hit: ph.firePathHitRange != null ? ph.firePathHitRange : 62,
        life: ph.firePathLife != null ? ph.firePathLife : 6,
        tick: 0.5      // 独立 0.5s 对塔结算节拍
      });
    }

    tick(dt) {
      const s = this.scene;
      /* 风蚀增伤倒计时 */
      if (s.windErosionTimer > 0) {
        s.windErosionTimer = Math.max(0, s.windErosionTimer - dt);
      }
      /* 风眼计时 */
      for (const we of this.windEyes) we.tick(dt);

      /* 火焰路径：存活衰减 + 每 0.5s 对踩上来的塔持续伤害（禁言压制） */
      let changed = false;
      for (let i = this.fireZones.length - 1; i >= 0; i--) {
        const z = this.fireZones[i];
        z.life -= dt;
        z.tick -= dt;
        if (z.life <= 0) {
          this.fireZones.splice(i, 1);
          changed = true;
          continue;
        }
        if (z.tick <= 0) {
          z.tick = 0.5;
          const towers = s.towers || [];
          for (const tw of towers) {
            if (!tw || tw.removed) continue;
            if (Phaser.Math.Distance.Between(z.x, z.y, tw.x, tw.y) <= z.hit) {
              s.silenceTower(tw, 0.85);   // 短禁言高频刷新 ≈ 站火即持续压制
              if (typeof s.floatText === 'function' && Math.random() < 0.2) {
                s.floatText(tw.x, tw.y - 36, '灼烧', 0xff7a3c);
              }
            }
          }
        }
        changed = true;
      }
      this.drawFireZones(changed);
    }

    /** 火焰路径绘制：橙红地火圆斑 + 内焰闪烁（随存活时间衰减） */
    drawFireZones() {
      const g = this.fireGfx;
      if (!g) return;
      g.clear();
      const now = this.scene.time.now;
      for (const z of this.fireZones) {
        const fade = Math.min(1, z.life / 1.2);             // 临消失 1.2s 渐隐
        const flick = 0.72 + 0.28 * Math.sin(now / 90);     // 火苗闪烁
        g.fillStyle(0xff5a2a, 0.30 * fade);
        g.fillCircle(z.x, z.y, z.r);
        g.fillStyle(0xff8c3a, 0.38 * fade * flick);
        g.fillCircle(z.x, z.y, z.r * 0.66);
        g.fillStyle(0xffc24a, 0.55 * fade * flick);
        g.fillCircle(z.x, z.y, z.r * 0.3);
        g.lineStyle(2, 0xff8c3a, 0.55 * fade);
        g.strokeCircle(z.x, z.y, z.r);
      }
    }
  }

  /* ---- 导出：GameScene.spawnEnemy 按 typeKey 查此注册表选用专属子类 ---- */
  window.LEVEL8_ENEMY_CLASSES = {
    crystalSlime: CrystalSlime,
    bomberSlime: BomberSlime,
    lavaBoss: LavaBehemoth
  };
  window.Level8Controller = Level8Controller;
  window.Level8Art = Level8Art;
})();
