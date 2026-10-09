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

    /* 火塔燃烧视频叠加层：黑底 MP4 + ADD 混合（黑色自然透明），与静态贴图
       同位置同中心。每等级全游戏共享一个解码器/纹理（见 FireBurn.js）。
       纹理未就绪或设备不支持时保持隐藏，静态贴图+Tween 即为降级效果。
       必须在 badge 之前 add，保证等级文字始终在视频之上。 */
    this._burnLv = 1;
    this._burnTweens = [];
    this.burnImg = null;
    this._burnOk = (typeof FIRE_BURN !== 'undefined') && FIRE_BURN.supported;
    if (this.isFire && this._burnOk) {
      this.burnImg = scene.add.image(0, -6, 'fire_dot')
        .setVisible(false)
        .setBlendMode(Phaser.BlendModes.ADD);
      this.add(this.burnImg);
      FIRE_BURN.whenReady(1, (key) => this._showBurn(key));
      FIRE_BURN.use(1);
    }

    /* 火塔燃烧动效：缩放脉冲+纵向窜动+明灭，2/3级加火星（升级时重建） */
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

  /* 燃烧视频显示尺寸：静态贴图尺寸 × 匹配系数（视频画面内火焰占比小于
     静态贴图纹理，容器需放大才能与静态火焰等大，系数按包围盒实测） */
  _burnDisplaySize() {
    return FIRE_BURN.displaySize(this.level);
  }

  /* 视频纹理就绪 / 升级换级时：换纹理、对齐尺寸位置，并重建与静态贴图
     节奏一致的缩放脉冲+纵向窜动（视频自身已含火苗动态，不做明灭） */
  _showBurn(key) {
    if (!this.burnImg || !this.burnImg.active || !this.scene) return;
    this.burnImg.setTexture(key);
    const d = this._burnDisplaySize();
    this.burnImg.setPosition(0, -6).setDisplaySize(d, d).setVisible(true);
    this._burnTweens.forEach((t) => { if (t && t.stop) t.stop(); });
    this._burnTweens = [];
    const lv = this.level;
    const dur = lv === 1 ? 300 : lv === 2 ? 240 : 200;
    const ampY = lv === 1 ? 0.12 : lv === 2 ? 0.18 : 0.24;
    const bs = this.burnImg.scaleX;
    this._burnTweens.push(this.scene.tweens.add({
      targets: this.burnImg,
      scaleY: { from: bs, to: bs * (1 + ampY) },
      scaleX: { from: bs, to: bs * (1 - ampY * 0.3) },
      duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    }));
    this._burnTweens.push(this.scene.tweens.add({
      targets: this.burnImg,
      y: { from: -6, to: -6 - (lv === 1 ? 1.5 : lv === 2 ? 2.2 : 3) },
      duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    }));
  }

  /* 火塔燃烧动效：缩放脉冲 + 纵向窜动 + 火苗明灭（2/3 级加火星飘散）。
     不使用垫底复制贴图的光晕层，避免半透明残影；全部挂在本容器 */
  _buildFireFx() {
    this._clearFireFx();
    const lv = this.level, sc = this.scene;
    const sx = this.turret.scaleX, sy = this.turret.scaleY;
    const dur = lv === 1 ? 300 : lv === 2 ? 240 : 200;
    // 火焰跳动：纵向拉伸为主、横向微收的缩放脉冲（模拟火舌蹿动）
    const ampY = lv === 1 ? 0.12 : lv === 2 ? 0.18 : 0.24;
    this._fireFx.push(sc.tweens.add({
      targets: this.turret,
      scaleY: { from: sy, to: sy * (1 + ampY) },
      scaleX: { from: sx, to: sx * (1 - ampY * 0.3) },
      duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    }));
    // 纵向轻微浮动（火焰向上窜）
    this._fireFx.push(sc.tweens.add({
      targets: this.turret,
      y: { from: -6, to: -6 - (lv === 1 ? 1.5 : lv === 2 ? 2.2 : 3) },
      duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    }));
    // 火苗明灭
    this._fireFx.push(sc.tweens.add({
      targets: this.turret,
      alpha: { from: 1, to: 0.88 },
      duration: dur * 0.7, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    }));
    if (lv >= 2) {
      // 火星：向上飘散的小火点（无方向性贴图 fire_dot）
      this._sparks = sc.add.particles(0, -6, 'fire_dot', {
        speed: { min: 12, max: 32 }, angle: { min: 240, max: 300 },
        scale: { start: lv === 2 ? 0.5 : 0.8, end: 0 }, alpha: { start: 0.9, end: 0 },
        lifespan: lv === 2 ? 600 : 850, frequency: lv === 2 ? 200 : 110,
        quantity: 1, blendMode: 'ADD'
      });
      this.add(this._sparks);
    }
  }

  _clearFireFx() {
    (this._fireFx || []).forEach((t) => { if (t && t.stop) t.stop(); });
    this._fireFx = [];
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
      /* 燃烧视频：释放旧等级播放引用 → 注册新等级 → 换纹理（已就绪立即换，
         未就绪则等 whenReady 回调；期间静态贴图始终兜底） */
      if (this._burnOk) {
        FIRE_BURN.release(this._burnLv);
        this._burnLv = this.level;
        FIRE_BURN.use(this._burnLv);
        FIRE_BURN.whenReady(this._burnLv, (key) => this._showBurn(key));
      }
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

  /* 出售 / 场景关闭：先注销燃烧视频播放引用（引用计数归零会暂停解码省电），
     再走容器销毁（级联销毁 burnImg 等全部子对象） */
  destroy(fromScene) {
    if (this._burnOk) {
      FIRE_BURN.release(this._burnLv);
      this._burnTweens.forEach((t) => { if (t && t.stop) t.stop(); });
    }
    super.destroy(fromScene);
  }
}
