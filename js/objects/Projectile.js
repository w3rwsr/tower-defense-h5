/* ============================================================
 * Projectile.js —— 塔发射的弹道
 * 追踪目标飞行；目标死亡后仍飞向最后已知位置：
 *   - 单体弹（damage）：目标没了就空爆消失；
 *   - 范围冰弹（splashSlow）：到达落点后范围伤害 + 减速。
 * ============================================================ */
class Projectile extends Phaser.GameObjects.Image {
  constructor(scene, x, y, target, pCfg, damage, sourceTower) {
    /* 贴图：默认按颜色生成圆弹；pCfg.texture 指定专用贴图（如风刃 proj_wind） */
    super(scene, x, y, pCfg.texture || ('proj_' + pCfg.color.toString(16)));

    this.pCfg = pCfg;
    this.damage = damage;                 // 已含塔等级加成
    this.effect = pCfg.effect;
    this.speed = pCfg.speed;
    this.target = target;
    this.sourceTower = sourceTower || null; // 发射塔（风元素塔扩散冷却判定用）
    this.spin = pCfg.spin || 0;           // 风刃旋转速度（弧度/秒，0=不旋转）

    /* 火元素塔（towerA）：按塔等级换熔岩弹贴图（裂纹/拖尾/火星随等级增强）。
       离线贴图（window.__lavaBulletArt）自带拖尾火星，不再挂粒子；
       data URI 缺失回退程序火苗贴图时，保留旧的粒子拖尾表现。 */
    this._trail = null;
    const srcLv = sourceTower && sourceTower.isFire ? sourceTower.level : 0;
    if (srcLv >= 1) {
      const lv = Math.min(srcLv, 3);
      const texKey = 'proj_fire_lv' + lv;
      if (scene.textures.exists(texKey)) this.setTexture(texKey);
      /* 方向性熔岩弹：初始即朝目标偏转（update 中每帧随目标位置修正） */
      if (target) this.rotation = Math.atan2(target.y - y, target.x - x);
      if (window.__lavaBulletArt === true) {
        /* 离线贴图按球径等比烘焙（球纹素=ballDisplay×superSample=45px）：
           setScale = 等级系数 / superSample，三颗球显示几乎等大（15/15.75/16.5px），
           缩放系数由 config.towers.towerA.projectile.lavaBullet 驱动 */
        const lb = (pCfg.lavaBullet) ||
          (((typeof TD_CONFIG !== 'undefined') && TD_CONFIG.towers.towerA.projectile.lavaBullet) ||
           { superSample: 3, scale: {} });
        const lvScale = (lb.scale && lb.scale[lv]) != null ? lb.scale[lv] : 1;
        this.setScale(lvScale / (lb.superSample || 3));
        /* 代码拖尾：贴图仅球体本体，拖尾/火星由粒子生成，强度随等级递增。
           粒子 speed=0、follow 本弹——发射后滞留原地，形成朝后的橙红尾迹。 */
        const t = (lb.trail && lb.trail[lv]) || null;
        if (t) {
          this._trail = scene.add.particles(0, 0, 'fire_dot', {
            speed: 0, scale: { start: t.scale, end: 0 },
            alpha: { start: t.alpha, end: 0 }, lifespan: t.lifespan,
            frequency: t.frequency, blendMode: 'ADD', follow: this
          }).setDepth(39);
          if (t.sparks) {
            // 三级额外火星：四散的小亮点（参数全部由 config.lavaBullet.trail[3].sparks 驱动）
            const sp = t.sparks;
            this._sparks = scene.add.particles(0, 0, 'fire_dot', {
              speed: { min: 8, max: sp.speedMax || 30 },
              scale: { start: sp.scale || 0.45, end: 0 },
              alpha: { start: 0.9, end: 0 },
              lifespan: sp.lifespan || 140, frequency: sp.frequency || 70,
              blendMode: 'ADD', follow: this
            }).setDepth(39);
          }
        }
      } else {
        this.setScale(srcLv === 1 ? 1 : srcLv === 2 ? 1.05 : 1.15); // 等级越高弹幕越大
        if (srcLv >= 2) {
          this._trail = scene.add.particles(0, 0, 'fire_dot', {
            speed: 0, scale: { start: srcLv === 2 ? 0.9 : 1.3, end: 0 },
            alpha: { start: 0.55, end: 0 }, lifespan: srcLv === 2 ? 160 : 260,
            frequency: srcLv === 2 ? 30 : 18, blendMode: 'ADD', follow: this
          }).setDepth(39);
          if (srcLv >= 3) {
            // 3级额外火星：四散的小亮点
            this._sparks = scene.add.particles(0, 0, 'fire_dot', {
              speed: { min: 10, max: 40 }, scale: { start: 0.5, end: 0 },
              alpha: { start: 0.9, end: 0 }, lifespan: 300, frequency: 40,
              blendMode: 'ADD', follow: this
            }).setDepth(39);
          }
        }
      }
    }

    /* 冰元素塔（towerB）：按塔等级换雪花冰弹贴图（proj_ice_lvN）。
       离线贴图只含雪花本体（烘焙拖尾/冰雾/文字已剔除），拖尾完全由代码
       生成——冰蓝粒子向后飘散 + 一条浅蓝渐变光带，强度随等级递增，
       参数全部读 config towerB.projectile.iceBullet（JSON 驱动）。
       雪花六出对称，不朝向目标，改为持续轻微自转增加动感。 */
    this.isIce = false;
    this.iceSpin = 0;
    this._ribbon = null;
    const iceSrcLv = sourceTower && sourceTower.isIce ? sourceTower.level : 0;
    if (iceSrcLv >= 1) {
      const lv = Math.min(iceSrcLv, 3);
      const texKey = 'proj_ice_lv' + lv;
      if (window.__iceBulletArt === true && scene.textures.exists(texKey)) {
        const ib = pCfg.iceBullet ||
          (((typeof TD_CONFIG !== 'undefined') && TD_CONFIG.towers.towerB.projectile.iceBullet) || null);
        if (ib) {
          this.isIce = true;
          this.setTexture(texKey);
          /* 臂展等比烘焙（臂展纹素=bodyDisplay×superSample=54px）：
             setScale=等级系数/superSample → 臂展显示 18/18.9/19.8px */
          const lvScale = (ib.scale && ib.scale[lv] != null) ? ib.scale[lv] : 1;
          this.setScale(lvScale / (ib.superSample || 3));
          this.iceSpin = (ib.spin && ib.spin[lv] != null) ? ib.spin[lv] : 0;

          const headDeg = target
            ? Phaser.Math.RadToDeg(Math.atan2(target.y - y, target.x - x)) : 0;
          /* 冰蓝粒子：follow 本弹发射，speed 沿飞行反方向飘散 */
          const t = (ib.trail && ib.trail[lv]) || null;
          if (t) {
            const spread = t.angleSpread || 0;
            this._trail = scene.add.particles(0, 0, 'ice_dot', {
              speed: { min: (t.speed || 0) * 0.6, max: t.speed || 0 },
              angle: { min: headDeg + 180 - spread / 2, max: headDeg + 180 + spread / 2 },
              scale: { start: t.scale, end: 0 },
              alpha: { start: t.alpha, end: 0 },
              tint: t.tint, lifespan: t.lifespan,
              frequency: t.frequency, quantity: t.quantity || 1,
              blendMode: 'ADD', follow: this
            }).setDepth(39);
          }
          /* 渐变光带：右端钉在弹心、沿弹尾延伸，随飞行方向偏转 */
          const rb = (ib.ribbon && ib.ribbon[lv]) || null;
          if (rb) {
            this._ribbon = scene.add.image(x, y, 'ice_ribbon')
              .setOrigin(1, 0.5)
              .setScale((rb.length || 16) / 40, (rb.thickness || 3) / 8)
              .setAlpha(rb.alpha != null ? rb.alpha : 0.35)
              .setBlendMode(Phaser.BlendModes.ADD)
              .setDepth(39);
          }
        }
      }
    }

    // 落点（目标活着则每帧刷新）
    this.tx = target.x;
    this.ty = target.y;
    this.done = false;

    this.setDepth(40);
    scene.add.existing(this);
  }

  update(dt) {
    if (this.done) return;

    if (this.target && !this.target.dead) {
      this.tx = this.target.x;
      this.ty = this.target.y;
    }

    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const dist = Math.hypot(dx, dy);
    const step = this.speed * dt;

    if (dist <= step + 6) {
      this.setPosition(this.tx, this.ty);
      this.impact();
      return;
    }

    this.setPosition(this.x + (dx / dist) * step, this.y + (dy / dist) * step);
    /* 风刃（spin>0）持续旋转出旋风效果；火焰弹幕沿飞行方向朝向目标（贴图尖端朝右）；
       冰雪花不朝向目标，持续轻微自转，并同步光带朝向与粒子飘散方向 */
    if (this.isIce) {
      this.rotation += this.iceSpin * dt;
      const head = Math.atan2(dy, dx);
      if (this._ribbon) {
        this._ribbon.setPosition(this.x, this.y);
        this._ribbon.rotation = head;
      }
      /* 粒子发射角随飞行方向修正到"反方向 ± 张角"（配置 angleSpread）；
         setAngle 的 step 参数按 value±step/2 随机，失败不影响主流程 */
      if (this._trail && typeof this._trail.setAngle === 'function') {
        try {
          const tc = this.pCfg.iceBullet;
          const lvt = tc && tc.trail && tc.trail[Math.min((this.sourceTower && this.sourceTower.level) || 1, 3)];
          const spread = lvt ? (lvt.angleSpread || 0) : 0;
          this._trail.setAngle(Phaser.Math.RadToDeg(head) + 180, spread);
        } catch (e) { /* 角度运行时更新失败：保留构造时的发射角 */ }
      }
    } else if (this.spin) this.rotation += this.spin * dt;
    else this.rotation = Math.atan2(dy, dx);
  }

  impact() {
    this.done = true;
    const scene = this.scene;
    /* 火焰弹幕的拖尾/火星粒子随弹幕一并销毁，避免残留 */
    if (this._trail) { this._trail.destroy(); this._trail = null; }
    if (this._sparks) { this._sparks.destroy(); this._sparks = null; }
    if (this._ribbon) { this._ribbon.destroy(); this._ribbon = null; }
    /* 目标互斥：本弹锁定的是障碍物（isObstacle）→ 只结算障碍物；
       锁定的是小怪 → 只结算小怪，绝不伤害障碍物 */
    const vsObstacle = this.target && this.target.isObstacle;

    if (this.effect.type === 'splashSlow') {
      // 范围伤害 + 减速（塔B=冰元素：先附着冰元素并按反应倍率结算本次伤害）
      const r = this.effect.splashRadius;
      scene.spawnSplashFx(this.tx, this.ty, r, this.pCfg.color);
      if (vsObstacle) {
        // 攻击障碍物：只对障碍物结算，范围溅射不波及小怪
        if (!this.target.dead) this.target.takeDamage(this.damage);
      } else {
        scene.enemies.forEach((e) => {
          if (e.dead || e.invulnTimer > 0) return; // 传送无敌中：不受伤也不吃减速
          if (Phaser.Math.Distance.Between(this.tx, this.ty, e.x, e.y) <= r + e.radius) {
            let mul = 1;
            /* 冰元素附着（第6关起参与反应，倍率“谁先触发谁享受”归塔B本次溅射） */
            if (this.pCfg.element && typeof e.attachElement === 'function') {
              mul = e.attachElement(this.pCfg.element, null, this.pCfg.element).reactionMul || 1;
            }
            e.takeDamage(this.damage * mul);
            if (!e.dead) e.applySlow(this.effect.slowFactor, this.effect.slowDuration);
          }
        });
      }
    } else if (this.effect.type === 'windSpread') {
      /* 风元素塔风刃：少量伤害；目标带元素且本塔扩散冷却就绪 → 以目标
         为中心扩散元素（GameScene.spreadElement）；目标无元素则不扩散。
         风塔自身不附着风元素，扩散附着 sourceEl=null（不享受反应倍率） */
      if (this.target && !this.target.dead) {
        this.target.takeDamage(this.damage);
        scene.spawnHitFx(this.tx, this.ty, this.pCfg.color);
        if (!vsObstacle) {
          const tower = this.sourceTower;
          const behavior = tower && tower.behavior;
          const spreadEff = (tower && tower.cfg.effect) || {};
          const hasEl = this.target.reactionsEnabled
            ? this.target.hasElement()                                  // 新反应模式：多元素槽
            : (this.target.element && this.target.elementTimer > 0);    // 旧印记模式（1~5关）
          if (behavior && typeof behavior.tryConsumeSpread === 'function' &&
              hasEl && behavior.tryConsumeSpread()) {
            scene.spreadElement(this.target, spreadEff);
          }
        }
      }
    } else {
      // 单体伤害：目标仍存活才结算（小怪 / 障碍物通用 takeDamage 鸭子类型）
      if (this.target && !this.target.dead) {
        /* 先附着元素并结算反应：倍率“谁先触发谁享受”，只加倍塔A(火)/塔C(水)
           本次命中的伤害；第1~5关 attachElement 退化为旧视觉印记，倍率恒1 */
        let mul = 1;
        if (!vsObstacle && this.pCfg.element &&
            typeof this.target.attachElement === 'function') {
          mul = this.target.attachElement(this.pCfg.element, null, this.pCfg.element).reactionMul || 1;
        }
        this.target.takeDamage(this.damage * mul);
        scene.spawnHitFx(this.tx, this.ty, this.pCfg.color);
      }
    }
    this.destroy();
  }
}
