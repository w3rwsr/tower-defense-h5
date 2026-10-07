/* ============================================================
 * Tower.js —— 防御塔（塔A / 塔B / 塔C / 塔D）
 * 属性与升级成长全部来自 config.towers；
 * 是否可建造由 TDStorage.isTowerUnlocked(type, levelId) 统一判定
 * （塔D 通关第 1 关后解锁，仅第 2 关及之后关卡可建）；
 * 攻击行为委托给独立模块 TDAttack（索敌→攻击→冷却 / 范围吸引）。
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
    /* 火元素塔（towerA）：用美术贴图（fire_tower_lvN，按等级切换、锚点居中、
       不再旋转炮头朝向）；其余塔沿用程序化炮头并保留旋转 */
    this.isFire = (typeKey === 'towerA') && scene.textures.exists('fire_tower_lv1');
    if (this.isFire) {
      this.turret = scene.add.image(0, -6, this._fireTexKey());
      this.turret.setDisplaySize(this._fireDisplaySize(), this._fireDisplaySize());
    } else {
      this.turret = scene.add.image(0, 0, 'turret_' + typeKey);
    }
    this.add(this.turret);

    /* 火塔燃烧动效：1级轻跳 / 2级跳幅稍大 / 3级跳+火星+光晕（升级时重建） */
    this._fireFx = [];
    if (this.isFire) this._buildFireFx();

    this.badge = scene.add.text(0, 24, 'Lv1', {
      fontFamily: TD_FONT_STACK,
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#ffffff',
      resolution: TD_TEXT_RES
    }).setOrigin(0.5).setStroke('#3a2c1a', 3);
    this.add(this.badge);

    this.setDepth(15);
    scene.add.existing(this);

    this.recalcStats();
    // 攻击逻辑：按 effect.type 选择行为
    //   pull       → 范围吸引（塔D）
    //   chain      → 电链弹跳（塔E）
    //   windSpread → 风刃 + 元素扩散冷却（风元素塔）
    //   其他       → 普通弹道攻击（塔A/B/C）
    const eff = this.cfg.effect;
    let BehaviorClass = TDAttack.AttackBehavior;
    if (eff && eff.type === 'pull') BehaviorClass = TDAttack.PullBehavior;
    else if (eff && eff.type === 'chain') BehaviorClass = TDAttack.ChainBehavior;
    else if (eff && eff.type === 'windSpread') BehaviorClass = TDAttack.WindSpreadBehavior;
    this.behavior = new BehaviorClass(this, this.cfg);
    this.aimAngle = -Math.PI / 2;
    this.turret.rotation = this.aimAngle;
  }

  /* 火塔当前等级的美术贴图 key（缺失时回退到最低可用等级） */
  _fireTexKey() {
    for (let lv = Math.min(this.level, 3); lv >= 1; lv--) {
      const k = 'fire_tower_lv' + lv;
      if (this.scene.textures.exists(k)) return k;
    }
    return 'turret_towerA';
  }

  /* 火塔显示尺寸：贴图已裁剪到内容包围盒，等级越高尺寸越大（42/48/56） */
  _fireDisplaySize() {
    return this.level >= 3 ? 56 : this.level === 2 ? 48 : 42;
  }

  /* 火塔燃烧动效（Tween 缩放跳动 + 3级火星/光晕），与等级匹配；全部挂在本容器 */
  _buildFireFx() {
    this._clearFireFx();
    const lv = this.level, sc = this.scene;
    // 火焰跳动：缩放脉冲，等级越高幅度越大
    const amp = lv === 1 ? 0.06 : lv === 2 ? 0.10 : 0.14;
    this._fireFx.push(sc.tweens.add({
      targets: this.turret,
      scaleX: { from: this.turret.scaleX, to: this.turret.scaleX * (1 + amp) },
      scaleY: { from: this.turret.scaleY, to: this.turret.scaleY * (1 + amp) },
      duration: lv === 1 ? 340 : 240, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    }));
    if (lv === 3) {
      // 光晕
      const ds = this._fireDisplaySize();
      this._halo = sc.add.image(0, -6, 'fire_tower_lv3').setDisplaySize(ds + 10, ds + 10).setAlpha(0.25).setDepth(0);
      this.add(this._halo);
      this.sendToBack(this._halo);
      this._fireFx.push(sc.tweens.add({
        targets: this._halo, alpha: { from: 0.15, to: 0.4 }, duration: 480, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
      }));
      // 火星：向上飘散的小光点
      this._sparks = sc.add.particles(0, -6, 'proj_fire_lv1', {
        speed: { min: 14, max: 34 }, angle: { min: 240, max: 300 },
        scale: { start: 0.18, end: 0 }, alpha: { start: 0.9, end: 0 },
        lifespan: 900, frequency: 120, quantity: 1, blendMode: 'ADD'
      });
      this.add(this._sparks);
    }
  }

  _clearFireFx() {
    (this._fireFx || []).forEach((t) => { if (t && t.stop) t.stop(); });
    this._fireFx = [];
    if (this._halo) { this._halo.destroy(); this._halo = null; }
    if (this._sparks) { this._sparks.destroy(); this._sparks = null; }
  }

  /* 根据等级 + JSON 成长系数重算属性（伤害写回弹道 effect） */
  recalcStats() {
    const base = this.cfg.stats;
    const up = this.cfg.upgrade;
    let dmgMul = 1, rangeMul = 1, cdMul = 1, jumpsAdd = 0;
    for (let i = 1; i < this.level; i++) {
      dmgMul *= up.damage;
      rangeMul *= up.range;
      cdMul *= up.cooldown;
      if (up.jumps) jumpsAdd += up.jumps; // 塔E：每升 1 级弹跳 +1
    }
    const eff = this.cfg.effect || {};
    const baseJumps = (eff.jumps != null) ? eff.jumps : 0;
    this.stats = {
      damage: Math.round(base.damage * dmgMul),
      range: Math.round(base.range * rangeMul),
      cooldown: +(base.cooldown * cdMul).toFixed(3),
      jumps: baseJumps + jumpsAdd // 当前弹跳次数（塔E 专用，其他塔为 0）
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
    /* 火塔：升级切换美术贴图并重建燃烧动效 */
    if (this.isFire) {
      this.turret.setTexture(this._fireTexKey());
      const ds = this._fireDisplaySize();
      this.turret.setDisplaySize(ds, ds);
      this._buildFireFx();
    }
    // 升级小动画
    this.scene.tweens.add({ targets: this, scale: 1.18, duration: 110, yoyo: true });
    return cost;
  }

  /* 攻击模块每帧回调：炮头转向目标（火塔美术图为向上火焰，不随目标旋转） */
  setTarget(target) {
    if (target) {
      this.aimAngle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    }
    if (!this.isFire) this.turret.rotation = this.aimAngle;
  }

  update(dt, ctx) {
    this.behavior.update(dt, ctx);
  }
}
