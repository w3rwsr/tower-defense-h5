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
    /* 风刃（spin>0）持续旋转出旋风效果；普通圆弹贴图为圆形，朝向旋转无意义 */
    if (this.spin) this.rotation += this.spin * dt;
    else this.rotation = Math.atan2(dy, dx); // 占位贴图为圆形，旋转留作换贴图时使用
  }

  impact() {
    this.done = true;
    const scene = this.scene;
    /* 目标互斥：本弹锁定的是障碍物（isObstacle）→ 只结算障碍物；
       锁定的是小怪 → 只结算小怪，绝不伤害障碍物 */
    const vsObstacle = this.target && this.target.isObstacle;

    if (this.effect.type === 'splashSlow') {
      // 范围伤害 + 减速
      const r = this.effect.splashRadius;
      scene.spawnSplashFx(this.tx, this.ty, r, this.pCfg.color);
      if (vsObstacle) {
        // 攻击障碍物：只对障碍物结算，范围溅射不波及小怪
        if (!this.target.dead) this.target.takeDamage(this.damage);
      } else {
        scene.enemies.forEach((e) => {
          if (e.dead || e.invulnTimer > 0) return; // 传送无敌中：不受伤也不吃减速
          if (Phaser.Math.Distance.Between(this.tx, this.ty, e.x, e.y) <= r + e.radius) {
            e.takeDamage(this.damage);
            if (!e.dead) e.applySlow(this.effect.slowFactor, this.effect.slowDuration);
          }
        });
      }
    } else if (this.effect.type === 'windSpread') {
      /* 风元素塔风刃：少量伤害；目标带元素印记且本塔扩散冷却就绪 → 以目标
         为中心扩散元素（GameScene.spreadElement）；目标无元素则不扩散 */
      if (this.target && !this.target.dead) {
        this.target.takeDamage(this.damage);
        scene.spawnHitFx(this.tx, this.ty, this.pCfg.color);
        if (!vsObstacle) {
          const tower = this.sourceTower;
          const behavior = tower && tower.behavior;
          const spreadEff = (tower && tower.cfg.effect) || {};
          if (behavior && typeof behavior.tryConsumeSpread === 'function' &&
              this.target.element && this.target.elementTimer > 0 &&
              behavior.tryConsumeSpread()) {
            scene.spreadElement(this.target, spreadEff);
          }
        }
      }
    } else {
      // 单体伤害：目标仍存活才结算（小怪 / 障碍物通用 takeDamage 鸭子类型）
      if (this.target && !this.target.dead) {
        this.target.takeDamage(this.damage);
        scene.spawnHitFx(this.tx, this.ty, this.pCfg.color);
        /* 元素印记（塔A=火 / 塔C=水，JSON projectile.element 驱动）：
           纯视觉标记，不改变伤害；已有元素的小怪不覆盖（applyElement 内判定） */
        if (!vsObstacle && this.pCfg.element && typeof this.target.applyElement === 'function') {
          this.target.applyElement(this.pCfg.element, this.pCfg.elementDuration || 4);
        }
      }
    }
    this.destroy();
  }
}
