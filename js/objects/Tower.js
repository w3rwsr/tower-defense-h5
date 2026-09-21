/* ============================================================
 * Tower.js —— 防御塔（塔A / 塔B / 塔C）
 * 属性与升级成长全部来自 config.towers；
 * 攻击行为委托给独立模块 TDAttack（索敌→攻击→冷却）。
 * ============================================================ */
class Tower extends Phaser.GameObjects.Container {
  constructor(scene, x, y, typeKey) {
    super(scene, x, y);

    this.typeKey = typeKey;
    this.cfg = TD_CONFIG.towers[typeKey];
    this.level = 1;
    this.invested = this.cfg.cost; // 总投入（用于出售返还）

    /* 阴影底座 + 可旋转炮头 + 等级徽标 */
    this.add(scene.add.image(0, 6, 'tower_base'));
    this.turret = scene.add.image(0, 0, 'turret_' + typeKey);
    this.add(this.turret);

    this.badge = scene.add.text(0, 24, 'Lv1', {
      fontFamily: TD_FONT_STACK,
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5).setStroke('#3a2c1a', 3);
    this.add(this.badge);

    this.setDepth(15);
    scene.add.existing(this);

    this.recalcStats();
    // 攻击逻辑：按 effect.type 选择行为（pull → 范围吸引；否则 → 普通弹道攻击）
    const eff = this.cfg.effect;
    this.behavior = (eff && eff.type === 'pull')
      ? new TDAttack.PullBehavior(this, this.cfg)
      : new TDAttack.AttackBehavior(this, this.cfg);
    this.aimAngle = -Math.PI / 2;
    this.turret.rotation = this.aimAngle;
  }

  /* 根据等级 + JSON 成长系数重算属性（伤害写回弹道 effect） */
  recalcStats() {
    const base = this.cfg.stats;
    const up = this.cfg.upgrade;
    let dmgMul = 1, rangeMul = 1, cdMul = 1;
    for (let i = 1; i < this.level; i++) {
      dmgMul *= up.damage;
      rangeMul *= up.range;
      cdMul *= up.cooldown;
    }
    this.stats = {
      damage: Math.round(base.damage * dmgMul),
      range: Math.round(base.range * rangeMul),
      cooldown: +(base.cooldown * cdMul).toFixed(3)
    };
  }

  get maxLevel() { return this.cfg.upgrade.maxLevel; }
  get canUpgrade() { return this.level < this.cfg.upgrade.maxLevel; }

  /* 升级费用：造价 * costFactor * 当前等级 */
  getUpgradeCost() {
    if (!this.canUpgrade) return null;
    return Math.round(this.cfg.cost * this.cfg.upgrade.costFactor * this.level);
  }

  getSellValue() {
    return Math.floor(this.invested * TD_CONFIG.sellReturn);
  }

  upgrade() {
    const cost = this.getUpgradeCost();
    if (cost === null) return false;
    this.level++;
    this.invested += cost;
    this.recalcStats();
    this.badge.setText('Lv' + this.level);
    // 升级小动画
    this.scene.tweens.add({ targets: this, scale: 1.18, duration: 110, yoyo: true });
    return cost;
  }

  /* 攻击模块每帧回调：炮头转向目标 */
  setTarget(target) {
    if (target) {
      this.aimAngle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    }
    this.turret.rotation = this.aimAngle;
  }

  update(dt, ctx) {
    this.behavior.update(dt, ctx);
  }
}
