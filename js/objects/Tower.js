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

    /* 阴影底座（不随目标旋转） + 可旋转头部 + 等级徽标 */
    this.add(scene.add.image(0, 6, 'tower_base'));
    /* 火元素塔（towerA）：用美术贴图（fire_tower_lvN，按等级切换、锚点居中）。
       火焰贴图 / 燃烧视频 / 火星统一挂在 head 子容器（位于炮头中心 0,-6），
       攻击时 head 整体平滑转向目标；底座与 Lv 徽标留在外层不转。
       其余塔沿用程序化炮头并直接旋转（炮口朝右贴图，零角朝右）。 */
    this.isFire = (typeKey === 'towerA') && scene.textures.exists('fire_tower_lv1');
    if (this.isFire) {
      this.head = scene.add.container(0, -6);
      this.turret = scene.add.image(0, 0, this._fireTexKey());
      this.turret.setDisplaySize(this._fireDisplaySize(), this._fireDisplaySize());
      this.head.add(this.turret);
      this.add(this.head);
    } else {
      this.head = null;
      this.turret = scene.add.image(0, 0, 'turret_' + typeKey);
      this.add(this.turret);
    }

    /* 火塔燃烧视频叠加层。lv1/lv3 为亮绿幕素材（FireVideoGK 色度键管线：
       green-excess 抠绿+despill 去绿边），lv2 为黑底（FireVideo 亮度键）。
       均 NORMAL 混合、火焰原色保留。管线在 _applyBurnPipeline 按等级切换；
       绿幕管线不可用（Canvas 渲染器等）时视频层永不接管——ADD 混合会把
       亮绿幕直接显示成绿方块，那种环境保持静态贴图+Tween 兜底。
       黑底管线不可用时回退 ADD（旧环境降级）。 */
    this._burnLv = 1;
    this._burnActive = false;     // 视频层是否已接管（接管后静态贴图隐藏）
    this.burnImg = null;
    this._burnOk = (typeof FIRE_BURN !== 'undefined') && FIRE_BURN.supported;
    if (this.isFire && this._burnOk) {
      this.burnImg = scene.add.image(0, 0, 'fire_dot').setVisible(false);
      this._applyBurnPipeline(1);
      this.head.add(this.burnImg);
      FIRE_BURN.whenReady(1, (key) => this._showBurn(key));
      FIRE_BURN.use(1);
    }

    /* 火塔燃烧兜底动效（仅视频未接管期间）：缩放脉冲+纵向窜动+明灭，
       2/3级加火星；视频就绪后由 _showBurn 立即清除，只保留视频自身动画。
       注意 whenReady 在 data URI 已缓存时可能于上方同步回调并已接管，
       此时不得再建兜底 Tween（否则会在隐藏的静态层上永久空转）。 */
    this._fireFx = [];
    if (this.isFire && !this._burnActive) this._buildFireFx();

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
    this.aimAngle = -Math.PI / 2;          // 初始朝上
    this.hasTarget = false;                // 火塔：无目标时火焰自然竖立
    if (!this.isFire) this.turret.rotation = this.aimAngle;  // 其他塔炮口即时指向
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

  /* 按等级素材背景类型配置视频层渲染管线。
     green + FireVideoGK 就绪 → 绿幕色度键 NORMAL（返回 true）；
     green + 管线缺失        → 不可接管（返回 false，保持静态兜底，防绿块）；
     black + FireVideo 就绪  → 黑底亮度键 NORMAL（返回 true）；
     black + 管线缺失        → 回默认管线 + ADD（返回 true，旧环境降级）。 */
  _applyBurnPipeline(lv) {
    if (!this.burnImg) return false;
    const ready = (name) => (typeof fireVideoPipelineReady === 'function') &&
      !!fireVideoPipelineReady(this.scene, name);
    const green = FIRE_BURN.bgMode(lv) === 'green';
    if (green) {
      if (!ready('FireVideoGK')) return false;
      this.burnImg.setPipeline('FireVideoGK');
      this.burnImg.setBlendMode(Phaser.BlendModes.NORMAL);
      return true;
    }
    if (ready('FireVideo')) {
      this.burnImg.setPipeline('FireVideo');
      this.burnImg.setBlendMode(Phaser.BlendModes.NORMAL);
    } else {
      try { if (this.burnImg.resetPipeline) this.burnImg.resetPipeline(); } catch (e) {}
      this.burnImg.setBlendMode(Phaser.BlendModes.ADD);
    }
    return true;
  }

  /* 视频纹理就绪 / 升级换级时：按新等级背景切管线、换纹理并固定居中显示。
     不添加任何缩放/位移 Tween——视频自身已含火苗燃烧动态，再叠加 Tween
     会产生明显抖动（等级越高 Tween 越快）。同时隐藏静态美术贴图并清除
     其兜底 Tween 与火星：两层同时显示会过曝出虚影/色块。 */
  _showBurn(key) {
    if (!this.burnImg || !this.burnImg.active || !this.scene) return;
    /* 绿幕素材在无抠像管线的环境绝不显示（否则亮绿方块直接上墙） */
    if (!this._applyBurnPipeline(this._burnLv)) return;
    this.burnImg.setTexture(key);
    const d = this._burnDisplaySize();
    this.burnImg.setPosition(0, 0).setDisplaySize(d, d).setVisible(true);
    if (!this._burnActive) {
      this._burnActive = true;
      this._clearFireFx();
      this.turret.setVisible(false);
    }
  }

  /* 火塔燃烧兜底动效（仅视频未接管时存在）：缩放脉冲 + 纵向窜动 + 火苗明灭
     （2/3 级加火星飘散）。全部挂在 head 内，坐标相对 head 中心（0,0）。 */
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
      y: { from: 0, to: -(lv === 1 ? 1.5 : lv === 2 ? 2.2 : 3) },
      duration: dur, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    }));
    // 火苗明灭
    this._fireFx.push(sc.tweens.add({
      targets: this.turret,
      alpha: { from: 1, to: 0.88 },
      duration: dur * 0.7, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    }));
    if (lv >= 2) {
      // 火星：向上飘散的小火点（无方向性贴图 fire_dot），挂 head 跟随朝向
      this._sparks = sc.add.particles(0, 0, 'fire_dot', {
        speed: { min: 12, max: 32 }, angle: { min: 240, max: 300 },
        scale: { start: lv === 2 ? 0.5 : 0.8, end: 0 }, alpha: { start: 0.9, end: 0 },
        lifespan: lv === 2 ? 600 : 850, frequency: lv === 2 ? 200 : 110,
        quantity: 1, blendMode: 'ADD'
      });
      this.head.add(this._sparks);
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
    /* 火塔：升级切换美术贴图；燃烧视频已接管时只用视频，不重建静态动效 */
    if (this.isFire) {
      this.turret.setTexture(this._fireTexKey());
      const ds = this._fireDisplaySize();
      this.turret.setDisplaySize(ds, ds);
      if (!this._burnActive) this._buildFireFx();
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

  /* 弹幕发射点（世界坐标）= 旋转后的火焰根部（火焰底部钝端）。
     根部在 head 本地 (0,+L)，经 head 旋转矩阵换算：
       wx = -L·sinθ,  wy = L·cosθ
     配合 update 的约定 θ=aimAngle−π/2，根部恰好落在"塔心→敌人"连线
     向外 L 处（右敌在右、左敌在左），弹幕即从此处朝目标直线飞出。
     视频接管时 L = 容器尺寸 ×（实测根部纵向比例 − 0.5），换视频/换级
     后根部仍精准；静态兜底时用静态贴图半高。其他塔返回塔中心。 */
  getMuzzlePos() {
    if (this.isFire && this.head) {
      let L;
      if (this._burnActive) {
        L = FIRE_BURN.displaySize(this._burnLv) *
          (FIRE_BURN.muzzleBottom(this._burnLv) - 0.5);
      } else {
        L = this._fireDisplaySize() * 0.5;
      }
      const c = Math.cos(this.head.rotation), s = Math.sin(this.head.rotation);
      return { x: this.x - L * s, y: this.y - 6 + L * c };
    }
    return { x: this.x, y: this.y };
  }

  /* 攻击模块每帧回调：更新目标方向。其他塔炮头（零角朝右）即时指向；
     火塔只记录目标方向/有无目标，平滑旋转在 update 中做。 */
  setTarget(target) {
    if (target) {
      this.aimAngle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
      this.hasTarget = true;
    } else {
      this.hasTarget = false;
    }
    if (!this.isFire) this.turret.rotation = this.aimAngle;
  }

  update(dt, ctx) {
    this.behavior.update(dt, ctx);
    if (this.isFire && this.head) {
      /* 旋转约定：贴图根部（钝端）朝本地 +Y（角度 π/2）。要让根部指向
         目标方向 aimAngle，需 π/2 + θ = aimAngle，即 θ = aimAngle − π/2。
         RotateTo 自动走最短弧，10 rad/s 限速平滑（约 0.3s 转 90°）。
         无目标时平滑回正 θ=0：火焰自然竖立、根部向下贴底座。 */
      const targetRot = this.hasTarget ? (this.aimAngle - Math.PI / 2) : 0;
      this.head.rotation =
        Phaser.Math.Angle.RotateTo(this.head.rotation, targetRot, 10 * dt);
    }
  }

  /* 出售 / 场景关闭：先注销燃烧视频播放引用并停掉兜底 Tween（引用计数归零
     会暂停解码省电），再走容器销毁（级联销毁 head/burnImg 等全部子对象） */
  destroy(fromScene) {
    this._clearFireFx();
    if (this._burnOk) {
      FIRE_BURN.release(this._burnLv);
    }
    super.destroy(fromScene);
  }
}
