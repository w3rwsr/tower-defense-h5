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
    /* 冰元素塔（towerB）：冰簇美术贴图（ice_tower_lvN，按等级切换）。
       冰晶为竖立造型，不随目标旋转（静态贴图层），索敌/减速逻辑不变；
       贴图缺失时回退程序化炮头 turret_towerB。 */
    this.isIce = (typeKey === 'towerB') &&
      window.__iceTowerArt === true && scene.textures.exists('ice_tower_lv1');
    /* 水元素塔（towerC）：水枪塔美术贴图（water_tower_lvN，按等级切换）。
       炮口统一朝右（离线烘焙时已旋转），运行时炮头平滑旋转跟踪敌人，
       弹幕从旋转后的炮口位置发射（见 getMuzzlePos）；
       贴图缺失时回退程序化炮头 turret_towerC。 */
    this.isWater = (typeKey === 'towerC') &&
      window.__waterTowerArt === true && scene.textures.exists('water_tower_lv1');
    /* 雷元素塔（towerE）：闪电塔美术贴图（thunder_tower_lvN，按等级切换）。
       闪电主体完全静止，不随目标旋转；外围电弧由 ThunderArc.js 代码生成；
       贴图缺失时回退程序化炮头 turret_towerE。 */
    this.isThunder = (typeKey === 'towerE') &&
      window.__thunderTowerArt === true && scene.textures.exists('thunder_tower_lv1');
    /* 引力塔（towerD）：磁铁美术贴图（gravity_tower_lvN，按等级切换）。
       磁铁为静态造型，不随目标旋转（与冰塔一致），索敌/吸引逻辑不变；
       贴图缺失时回退程序化炮头 turret_towerD。 */
    this.isGravity = (typeKey === 'towerD') &&
      window.__gravityTowerArt === true && scene.textures.exists('gravity_tower_lv1');
    /* 风元素塔（towerF）：龙卷风美术贴图（wind_tower_lvN，按等级切换）。
       龙卷风整体位置不变，每帧绕中心持续旋转（速度 JSON 驱动，逐级递增），
       不随目标转向；贴图缺失时回退程序化炮头 turret_towerF。 */
    this.isWind = (typeKey === 'towerF') &&
      window.__windTowerArt === true && scene.textures.exists('wind_tower_lv1');
    if (this.isFire) {
      this.head = scene.add.container(0, -6);
      this.turret = scene.add.image(0, 0, this._fireTexKey());
      this.turret.setDisplaySize(this._fireDisplaySize(), this._fireDisplaySize());
      this.head.add(this.turret);
      this.add(this.head);
    } else if (this.isIce) {
      this.head = null;
      this.turret = scene.add.image(0, -6, this._iceTexKey());
      this._iceApplyArt();
      this.add(this.turret);
    } else if (this.isWater) {
      this.head = null;
      // 炮头位于容器原点，旋转轴即贴图中心
      this.turret = scene.add.image(0, 0, this._waterTexKey());
      this._waterApplyArt();
      this.add(this.turret);
    } else if (this.isThunder) {
      this.head = null;
      /* 炮塔是 container：内含【本体静态 image】+ 装饰层帧（ThunderArc
         注入）。本体不做任何自身动画；container 仅做黄色端索敌整体转向。
         本体 image 用 setDisplaySize 直接设显示尺寸（与火塔一致），
         container 不缩放；装饰帧以世界偏移 add，自身 setScale(k)。 */
      this.turret = scene.add.container(0, 0);
      this._thunderBody = scene.add.image(0, 0, this._thunderTexKey());
      this.turret.add(this._thunderBody);
      this._thunderApplyArt();
      this.add(this.turret);
      /* 装饰层闪现特效（形状来自贴图分层帧，参数 JSON 驱动，等级递增） */
      if (typeof ThunderArc !== 'undefined') {
        this._thunderArc = new ThunderArc(this);
      }
    } else if (this.isGravity) {
      /* 引力塔：磁铁静态贴图，锚点居中，不旋转（与冰塔一致） */
      this.head = null;
      this.turret = scene.add.image(0, -6, this._gravityTexKey());
      this._gravityApplyArt();
      this.add(this.turret);
    } else if (this.isWind) {
      /* 风塔：龙卷风贴图，锚点居中，每帧绕中心持续旋转（update 中做）；
         旋转轴即贴图中心，位置不变、不变形、不随目标转向。 */
      this.head = null;
      this.turret = scene.add.image(0, 0, this._windTexKey());
      this._windApplyArt();
      this.add(this.turret);
    } else {
      this.head = null;
      this.turret = scene.add.image(0, 0, 'turret_' + typeKey);
      this.add(this.turret);
    }

    /* 火塔燃烧视频叠加层。背景类型由 FireBurn 读像素自动检测：
       green=FireVideoGK 绿幕色度键、white=FireVideoWK 白幕色度键、
       black=FireVideo 黑底亮度键；均 NORMAL 混合、火焰原色保留。
       管线在 _applyBurnPipeline 按等级背景切换。绿幕/白幕管线不可用
       （Canvas 渲染器、shader 编译失败等）时视频层永不接管——ADD 混合
       会把亮色背景叠成绿块/白框，那种环境保持静态贴图+Tween 兜底；
       黑底管线不可用时才回退 ADD（黑底+ADD 等价透明，旧环境降级）。 */
    this._burnLv = 1;
    this._burnActive = false;     // 视频层是否已接管（接管后静态贴图隐藏）
    this.burnImg = null;
    this._burnOk = (typeof FIRE_BURN !== 'undefined') && FIRE_BURN.supported;
    if (this.isFire && this._burnOk) {
      this.burnImg = scene.add.image(0, 0, 'fire_dot').setVisible(false);
      this.burnImg.setBlendMode(Phaser.BlendModes.NORMAL); // 锁死初始 NORMAL
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
    // 火塔/冰塔/引力塔贴图不随目标旋转（保持原样）；风塔龙卷风自转在
    // update 中做（初始旋转 0，随后每帧累加）；雷塔/水塔平滑转向在 update
    // 中做（雷塔需先按本等级贴图的黄色端固有角 θ0 设好静止初始姿态）；
    // 其余程序化炮头零角朝右，初始 rotation=aimAngle 即朝上
    if (this.isThunder) {
      this.turret.rotation = this._thunderAimRotation(this.aimAngle);
    } else if (!this.isFire && !this.isIce && !this.isGravity && !this.isWind) {
      this.turret.rotation = this.aimAngle;
    }
  }

  /* 冰塔当前等级的美术贴图 key（缺失时逐级回退，最终回退程序炮头） */
  _iceTexKey() {
    for (let lv = Math.min(this.level, 3); lv >= 1; lv--) {
      const k = 'ice_tower_lv' + lv;
      if (this.scene.textures.exists(k)) return k;
    }
    return 'turret_towerB';
  }

  /* 雷塔当前等级的美术贴图 key（缺失时逐级回退，最终回退程序炮头） */
  _thunderTexKey() {
    for (let lv = Math.min(this.level, 3); lv >= 1; lv--) {
      const k = 'thunder_tower_lv' + lv;
      if (this.scene.textures.exists(k)) return k;
    }
    return 'turret_towerE';
  }

  /* 雷塔显示定标：显示高 = config towerE.art.baseHeight × scale[等级]
     （1.0/1.12/1.24 → 54/60.5/67px），纹素高为显示高 ×4（离线 LANCZOS
     烘焙，DPR2 下仍 2 倍超采，与冰塔清晰度约定一致）。
     本体 image 保持纹素原尺寸，由炮塔 container 统一 setScale(纹素→世界
     ≈0.25)；装饰帧以纹素偏移 add 在同一 container 内，天然与本体对齐。
     注意：本体除“黄色端平滑索敌整体转向”外不做任何动画（无抖动/缩放/
     位移 Tween）；该转向是瞄准行为而非装饰动画（见 setTarget/update）。 */
  _thunderApplyArt() {
    this._thunderBody.setTexture(this._thunderTexKey());
    const art = (this.cfg && this.cfg.art) || { baseHeight: 54, scale: {} };
    const lvScale = (art.scale && art.scale[this.level] != null)
      ? art.scale[this.level] : 1;
    const h = (art.baseHeight || 54) * lvScale;
    const fr = this._thunderBody.frame;
    const k = (fr && fr.height) ? h / fr.height : 0.25;
    // 缩放设在 image 上（与火塔 setDisplaySize 完全一致），container 不缩放
    const aspect = (fr && fr.height) ? fr.width / fr.height : 1;
    this._thunderBody.setDisplaySize(h * aspect, h);
    this._thunderK = k;
  }

  /* 黄色尖端在【纹素坐标】中相对本体贴图中心的偏移。
     优先用 BootScene 裁切时从本体贴图实扫黄色像素得到的 __thunderTipOffset
     （动态、随实际贴图，绝不写死）；该检测缺失时回退 config.art.tip 旧值；
     两处都缺则退化为本体贴图顶部中点。换级后随当前贴图返回，尖端位置
     始终与贴图一致——发射点 = 塔心 + 旋转矩阵 × 显示缩放 × tip。 */
  _thunderTipOffset() {
    const det = window.__thunderTipOffset &&
      window.__thunderTipOffset[this.level];
    if (det && typeof det.x === 'number') return { x: det.x, y: det.y };
    const art = (this.cfg && this.cfg.art) || {};
    const tip = art.tip && art.tip[this.level];
    if (tip && tip.length === 2) return { x: tip[0], y: tip[1] };
    const fr = this._thunderBody && this._thunderBody.frame;
    return fr ? { x: 0, y: -fr.height * 0.4 } : { x: 0, y: -24 };
  }

  /* 雷塔炮塔目标转角：贴图黄色端在 rotation=0 时固有指向 θ0=atan2(tip)，
     旋转 φ 后尖端世界角 = θ0+φ，故 φ = aimAngle − θ0。无目标（aim 朝上）
     时 φ = −π/2 − θ0，黄色端自然竖立朝上。 */
  _thunderAimRotation(aim) {
    const tip = this._thunderTipOffset();
    const theta0 = Math.atan2(tip.y, tip.x);
    return aim - theta0;
  }

  /* 冰塔显示定标：显示高 = config towerB.art.baseHeight × scale[等级]
     （0.9/1.0/1.1 → 43.2/48/52.8px），宽按纹理原始宽高比自适应 */
  _iceApplyArt() {
    this.turret.setTexture(this._iceTexKey());
    const art = (this.cfg && this.cfg.art) || { baseHeight: 48, scale: {} };
    const lvScale = (art.scale && art.scale[this.level] != null)
      ? art.scale[this.level] : 1;
    const h = (art.baseHeight || 48) * lvScale;
    const fr = this.turret.frame;
    const aspect = (fr && fr.height) ? fr.width / fr.height : 1;
    this.turret.setDisplaySize(h * aspect, h);
  }

  /* 水塔当前等级的美术贴图 key（缺失时逐级回退，最终回退程序炮头） */
  _waterTexKey() {
    for (let lv = Math.min(this.level, 3); lv >= 1; lv--) {
      const k = 'water_tower_lv' + lv;
      if (this.scene.textures.exists(k)) return k;
    }
    return 'turret_towerC';
  }

  /* 水塔显示定标：显示高 = config towerC.art.displayHeight[等级]
     （一级 40 < 二级 47 < 三级 54，JSON 驱动）；纹素高为显示高 ×3，
     显示缩放恰为 1/3，宽按纹理原始宽高比自适应（避免非整数缩放） */
  _waterApplyArt() {
    this.turret.setTexture(this._waterTexKey());
    const art = (this.cfg && this.cfg.art) || {};
    const dh = (art.displayHeight && art.displayHeight[this.level] != null)
      ? art.displayHeight[this.level] : 47;
    const fr = this.turret.frame;
    const aspect = (fr && fr.height) ? fr.width / fr.height : 1;
    this.turret.setDisplaySize(dh * aspect, dh);
  }

  /* 引力塔当前等级的美术贴图 key（缺失时逐级回退，最终回退程序炮头） */
  _gravityTexKey() {
    for (let lv = Math.min(this.level, 3); lv >= 1; lv--) {
      const k = 'gravity_tower_lv' + lv;
      if (this.scene.textures.exists(k)) return k;
    }
    return 'turret_towerD';
  }

  /* 引力塔显示定标：显示高 = config towerD.art.baseHeight × scale[等级]
     （50/56/62px），宽按纹理原始宽高比自适应。贴图保持原图造型/颜色/大小 */
  _gravityApplyArt() {
    this.turret.setTexture(this._gravityTexKey());
    const art = (this.cfg && this.cfg.art) || { baseHeight: 50, scale: {} };
    const lvScale = (art.scale && art.scale[this.level] != null)
      ? art.scale[this.level] : 1;
    const h = (art.baseHeight || 50) * lvScale;
    const fr = this.turret.frame;
    const aspect = (fr && fr.height) ? fr.width / fr.height : 1;
    this.turret.setDisplaySize(h * aspect, h);
  }

  /* 风塔当前等级的美术贴图 key（缺失时逐级回退，最终回退程序炮头） */
  _windTexKey() {
    for (let lv = Math.min(this.level, 3); lv >= 1; lv--) {
      const k = 'wind_tower_lv' + lv;
      if (this.scene.textures.exists(k)) return k;
    }
    return 'turret_towerF';
  }

  /* 风塔显示定标：显示高 = config towerF.art.baseHeight × scale[等级]
     （54/60.5/67px），宽按纹理原始宽高比自适应。
     旋转轴即贴图中心（origin 0.5,0.5 默认居中），位置不变只旋转。 */
  _windApplyArt() {
    this.turret.setTexture(this._windTexKey());
    const art = (this.cfg && this.cfg.art) || { baseHeight: 54, scale: {} };
    const lvScale = (art.scale && art.scale[this.level] != null)
      ? art.scale[this.level] : 1;
    const h = (art.baseHeight || 54) * lvScale;
    const fr = this.turret.frame;
    const aspect = (fr && fr.height) ? fr.width / fr.height : 1;
    this.turret.setDisplaySize(h * aspect, h);
    /* 旋转中心 = 龙卷风质心（视觉重心）。BootScene 裁切时检测并写入
       window.__windCentroid[等级]（归一化 0~1）。漏斗形龙卷风几何中心偏下
       接近尾部，用质心 origin 让旋转绕主体重心 → 原地卷动，不绕尾部打转。
       质心检测缺失时回退几何中心 0.5,0.5。 */
    const c = window.__windCentroid && window.__windCentroid[this.level];
    if (c && typeof c.x === 'number') this.turret.setOrigin(c.x, c.y);
    else this.turret.setOrigin(0.5, 0.5);
  }

  /* 风塔龙卷风自转速度（弧度/秒），由 JSON 配置 art.spin[等级] 驱动。
     一级慢 / 二级中等 / 三级最快，逐级递增。缺失时回退 2 rad/s。 */
  _windSpinSpeed() {
    const art = (this.cfg && this.cfg.art) || {};
    const spin = art.spin || {};
    return (spin[this.level] != null) ? spin[this.level] : 2;
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

  /* 按等级素材【自动检测到的】背景类型配置视频层渲染管线。
     green + FireVideoGK 就绪 → 绿幕色度键 NORMAL（返回 true）；
     white + FireVideoWK 就绪 → 白幕色度键 NORMAL（返回 true）；
     green/white + 管线缺失或 setPipeline 失败 → 不可接管（false，
       保持静态兜底，绝不让亮色背景走 ADD 显绿块/白框）；
     black + FireVideo 就绪  → 黑底亮度键 NORMAL（返回 true）；
     black + 管线缺失        → 回默认管线 + ADD（返回 true，旧环境降级）。 */
  _applyBurnPipeline(lv) {
    if (!this.burnImg) return false;
    const ready = (name) => (typeof fireVideoPipelineReady === 'function') &&
      !!fireVideoPipelineReady(this.scene, name);
    const mode = FIRE_BURN.bgMode(lv);
    if (mode === 'green' || mode === 'white') {
      const pipe = mode === 'green' ? 'FireVideoGK' : 'FireVideoWK';
      if (!ready(pipe)) return false;
      try {
        this.burnImg.setPipeline(pipe);
      } catch (e) {
        return false;   // shader 编译/绑定失败：不接管，防异常色块
      }
      this.burnImg.setBlendMode(Phaser.BlendModes.NORMAL);
      return true;
    }
    if (ready('FireVideo')) {
      try { this.burnImg.setPipeline('FireVideo'); } catch (e) {
        try { if (this.burnImg.resetPipeline) this.burnImg.resetPipeline(); } catch (e2) {}
        this.burnImg.setBlendMode(Phaser.BlendModes.ADD);
        return true;
      }
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
        /* fire_dot 已 2x 超采样（16px），start scale 减半保持屏显不变 */
        scale: { start: lv === 2 ? 0.25 : 0.4, end: 0 }, alpha: { start: 0.9, end: 0 },
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
    /* 冰塔：升级同步切换冰晶贴图与显示尺寸（冰弹贴图由发射时等级决定，
       Projectile 读 sourceTower.level 自动对应，无需此处处理） */
    if (this.isIce) this._iceApplyArt();
    /* 水塔：升级同步切换水枪贴图与显示尺寸（水弹贴图由发射时等级决定，
       Projectile 读 sourceTower.level 自动对应，无需此处处理） */
    if (this.isWater) this._waterApplyArt();
    /* 雷塔：升级同步切换本体贴图/缩放，并按新等级重建装饰层帧 */
    if (this.isThunder) {
      this._thunderApplyArt();
      if (this._thunderArc) this._thunderArc.setLevel(this.level);
    }
    /* 引力塔：升级同步切换磁铁贴图与显示尺寸 */
    if (this.isGravity) this._gravityApplyArt();
    /* 风塔：升级同步切换龙卷风贴图与显示尺寸（旋转速度随等级自动变化，
       _windSpinSpeed 每帧读当前等级配置，无需额外处理） */
    if (this.isWind) this._windApplyArt();
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
    /* 水塔：炮口偏移 (muzzleX, muzzleY) 由离线烘焙按各等级贴图实测得到
       （纹素坐标，相对贴图中心，烘焙时炮口朝右）。发射点不能写死：
         发射点 = 塔位置 + 旋转矩阵 × 显示缩放 × 枪口双轴偏移
       turret 随目标平滑旋转（见 update），目标移动时每帧取最新 rotation，
       弹幕始终从【当前】旋转后的真实炮口射出。
       k = turret.scaleX（显示高/纹理高 = 1/3，等比缩放）。 */
    if (this.isWater) {
      const m = (window.__waterTowerMuzzle &&
        window.__waterTowerMuzzle[this.level]) || { x: 0, y: 0 };
      const mx = m.x || 0, my = m.y || 0;
      const k = this.turret.scaleX;
      const c = Math.cos(this.turret.rotation), s = Math.sin(this.turret.rotation);
      return {
        x: this.x + k * (mx * c - my * s),
        y: this.y + k * (mx * s + my * c)
      };
    }
    /* 雷塔：发射点 = 旋转后贴图的黄色尖端（纹素偏移见 config art.tip，
       按各等级贴图实测，非写死）。turret 每帧平滑跟踪目标，取当前 rotation
       即时换算——目标移动时电链永远从【此刻】黄色端位置发出；
       k = _thunderK（等比缩放，x/y 相同）。 */
    if (this.isThunder) {
      const m = this._thunderTipOffset();
      const mx = m.x, my = m.y;
      const k = this._thunderK;
      const c = Math.cos(this.turret.rotation), s = Math.sin(this.turret.rotation);
      return {
        x: this.x + k * (mx * c - my * s),
        y: this.y + k * (mx * s + my * c)
      };
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
    // 火塔/冰塔/引力塔贴图不随目标旋转；风塔龙卷风自转（update 中做）；
    // 水塔/雷塔平滑旋转在 update 中做；其他程序化炮头即时指向
    if (!this.isFire && !this.isIce && !this.isWater && !this.isThunder &&
        !this.isGravity && !this.isWind) {
      this.turret.rotation = this.aimAngle;
    }
  }

  update(dt, ctx) {
    this.behavior.update(dt, ctx);
    if (this.isWind) {
      /* 风塔龙卷风每帧绕中心持续旋转：旋转速度由 JSON 配置 art.spin[等级]
         驱动（一级 1.8 / 二级 3.0 / 三级 4.5 弧度/秒），逐级递增。
         dt 单位为秒（Phaser update 标准参数），rotation += speed × dt
         实现匀速旋转。位置不变、不变形，只在原地持续旋转。 */
      this.turret.rotation += this._windSpinSpeed() * dt;
    }
    if (this.isWater) {
      /* 水塔炮头平滑旋转到目标方向 aimAngle。炮口已离线烘焙朝右（角度 0），
         故直接把 turret.rotation 转到 aimAngle 即指向敌人。
         RotateTo 走最短弧，12 rad/s 限速（约 0.26s 转 90°），平滑不跳变。 */
      this.turret.rotation =
        Phaser.Math.Angle.RotateTo(this.turret.rotation, this.aimAngle, 12 * dt);
    }
    if (this.isThunder) {
      /* 雷塔黄色端平滑跟踪目标：贴图尖端固有角 θ0，目标转角 = aimAngle−θ0；
         无目标时回到 (−π/2−θ0) 使黄端自然朝上。12 rad/s 限速（同水塔）。
         本体无任何抖动/缩放/位移动画，旋转轴即贴图中心。 */
      const targetRot = this._thunderAimRotation(
        this.hasTarget ? this.aimAngle : -Math.PI / 2);
      this.turret.rotation =
        Phaser.Math.Angle.RotateTo(this.turret.rotation, targetRot, 12 * dt);
      /* 外围电弧每帧更新（与炮塔旋转无关，固定环绕塔心） */
      if (this._thunderArc) this._thunderArc.update(dt);
    }
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
     会暂停解码省电），销毁电弧特效，再走容器销毁（级联销毁 head/burnImg
     等全部子对象） */
  destroy(fromScene) {
    this._clearFireFx();
    if (this._burnOk) {
      FIRE_BURN.release(this._burnLv);
    }
    if (this._thunderArc) {
      this._thunderArc.destroy();
      this._thunderArc = null;
    }
    super.destroy(fromScene);
  }
}
