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
    /* 风刃（spin>0）持续旋转出旋风效果；火焰弹幕沿飞行方向朝向目标（贴图尖端朝右） */
    if (this.spin) this.rotation += this.spin * dt;
    else this.rotation = Math.atan2(dy, dx);
  }

  impact() {
    this.done = true;
    const scene = this.scene;
    /* 火焰弹幕的拖尾/火星粒子随弹幕一并销毁，避免残留 */
    if (this._trail) { this._trail.destroy(); this._trail = null; }
    if (this._sparks) { this._sparks.destroy(); this._sparks = null; }
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
