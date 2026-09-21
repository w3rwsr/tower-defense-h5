/* ============================================================
 * Projectile.js —— 塔发射的弹道
 * 追踪目标飞行；目标死亡后仍飞向最后已知位置：
 *   - 单体弹（damage）：目标没了就空爆消失；
 *   - 范围冰弹（splashSlow）：到达落点后范围伤害 + 减速。
 * ============================================================ */
class Projectile extends Phaser.GameObjects.Image {
  constructor(scene, x, y, target, pCfg, damage) {
    super(scene, x, y, 'proj_' + pCfg.color.toString(16));

    this.pCfg = pCfg;
    this.damage = damage;                 // 已含塔等级加成
    this.effect = pCfg.effect;
    this.speed = pCfg.speed;
    this.target = target;

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
    this.rotation = Math.atan2(dy, dx); // 占位贴图为圆形，旋转留作换贴图时使用
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
          if (e.dead) return;
          if (Phaser.Math.Distance.Between(this.tx, this.ty, e.x, e.y) <= r + e.radius) {
            e.takeDamage(this.damage);
            if (!e.dead) e.applySlow(this.effect.slowFactor, this.effect.slowDuration);
          }
        });
      }
    } else {
      // 单体伤害：目标仍存活才结算（小怪 / 障碍物通用 takeDamage 鸭子类型）
      if (this.target && !this.target.dead) {
        this.target.takeDamage(this.damage);
        scene.spawnHitFx(this.tx, this.ty, this.pCfg.color);
      }
    }
    this.destroy();
  }
}
