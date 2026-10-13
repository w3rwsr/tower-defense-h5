/* ============================================================
 * WindVideo.js —— 风元素塔龙卷风视频（全局共享单例 WIND_VIDEO）
 *
 * 设计要点（仿 FireBurn.js 蓝本，跨平台 / 性能 / 降级）：
 * 1. 全场只创建 1 个 HTMLVideoElement + 1 个 Phaser 视频纹理
 *    'wind_video_full'（640x640 横排三等级龙卷风），所有风塔共享
 *    同一解码器与同一张 GPU 纹理；每塔用 setCrop 显示对应段；
 * 2. 素材为亮绿幕 H.264 MP4（assets/wind_towers.mp4），用 FireVideoGK
 *    管线（绿幕色度键，NORMAL 混合）做透明背景，绿幕完全不可见，
 *    龙卷风原色保留，无绿边/绿块。绿幕管线不可用（Canvas 渲染器、
 *    shader 编译失败、file:// 跨域污染等）→ supported=false，Tower
 *    端回退静态贴图 wind_tower_lvN + Tween 旋转，游戏功能不受影响；
 * 3. 视频本身横向三段：左=一级 / 中=二级 / 右=三级，三龙卷风同步
 *    循环旋转。视频接管后不再每帧 rotation（视频自身已旋转）；
 * 4. 引用计数：场上有风塔才播放；游戏暂停全部暂停；新一局重置；
 * 5. muted + playsInline + loop，符合手机浏览器自动播放策略；首次
 *    用户触摸后解锁播放。
 *
 * 三段内容边界（全片 97 帧【内容像素并集】实测 + 每边 1px 安全余量，
 * 非简单三等分，避免切到相邻龙卷风）：
 *   一级 x∈[40,162]  y∈[297,420]  123×124
 *   二级 x∈[201,358] y∈[273,428]  158×156
 *   三级 x∈[379,618] y∈[231,442]  240×212
 * 相邻元素列间距 39px / 21px，取满元素边界也不会串到隔壁。
 * ============================================================ */
const WIND_VIDEO = (() => {
  const VER = '20261013a';               // 素材版本号（破 file:// 缓存）
  const TEX_KEY = 'wind_video_full';     // 共享 Phaser 视频纹理键
  const SRC = 'assets/wind_towers.mp4?v=' + VER;
  const VID_W = 640, VID_H = 640;        // 视频尺寸（H.264 640x640）

  /* 三段龙卷风【完整元素包围盒】（视频纹理像素坐标）。
     来源：全片 97 帧逐帧判定"内容像素"（与绿幕背景 RGB(31,230,20) 的最大
     通道差 > 40），取列/行并集 —— 包含漏斗本体 + 外围气流弧 + 水珠等
     **该段龙卷风的全部元素**，一点不缺；每边再留 1px 安全余量（全 97 帧
     实测只有 f55 的 lv1 有 1 个像素贴边）。相邻三级列间距 39px/21px，
     取满边界也不会串到隔壁元素。
     旧值（x=81/240/435 起、宽 62/95/138）只截到漏斗中段，把每道龙卷风
     的左/右/上/下都切掉一大块 —— 用户看到的"主体被抠掉一大半、只剩残缺
     形状"其实是**裁切过窄**造成的（色度键本身没问题）。收紧到元素边界后
     残缺消失，且不再有被切一半的气流弧碎片（即"右侧残留"）。
     这与 BootScene 静态兜底贴图 wind_tower_lvN 自动检测的内容包围盒一致。 */
  const SEG = {
    1: { x: 40,  y: 297, w: 123, h: 124 },   // 一级（左）：最小
    2: { x: 201, y: 273, w: 158, h: 156 },   // 二级（中）
    3: { x: 379, y: 231, w: 240, h: 212 }    // 三级（右）：最大
  };

  /* 显示高度（世界单位）= config.towers.towerF.art 的 baseHeight × scale[等级]，
     JSON 驱动（改 config 即可调尺寸，无需改代码）。默认 44 / 49.28 / 54.56，
     即原 54 基准整体缩小到 0.815 倍。读取异常回退内置默认。 */
  const ART = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.towers &&
    TD_CONFIG.towers.towerF && TD_CONFIG.towers.towerF.art) || {};
  const BASE_H = (typeof ART.baseHeight === 'number' && ART.baseHeight > 0)
    ? ART.baseHeight : 44;
  const LV_SCALE = ART.scale || { 1: 1.0, 2: 1.12, 3: 1.24 };

  const api = {
    supported: false,
    _inited: false,
    _locked: true,          // 尚未拿到用户手势（自动播放解锁前）
    _scenePaused: false,
    _scene: null,
    _video: null,
    _ready: false,
    _failed: false,
    _refs: 0,
    _waiters: [],
    textures: null
  };

  /* BootScene.create 中调用一次（renderer / TextureManager 已就绪） */
  api.init = function (scene) {
    if (this._inited) return;
    this._inited = true;
    this._scene = scene;
    this.textures = scene.textures;

    /* 支持性检测：
       (a) 浏览器能解 H.264 MP4；
       (b) 当前是 WebGL 渲染器 + FireVideoGK 绿幕管线已注册。
       二者缺一不可——Canvas 渲染器或管线缺失时绝不让视频接管
       （绿幕 + ADD 会把亮绿背景叠成大色块，反而比静态贴图更糟）。 */
    const probe = document.createElement('video');
    const canH264 = !!(probe.canPlayType &&
      probe.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
    if (!canH264) return;
    const pipelineReady = (typeof fireVideoPipelineReady === 'function') &&
      !!fireVideoPipelineReady(scene, 'WindVideoGK');
    if (!pipelineReady) return;
    this.supported = true;

    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    this._video = v;

    v.addEventListener('loadeddata', () => {
      if (this._ready || this._failed || v.videoWidth === 0) return;
      try {
        if (this.textures.exists(TEX_KEY)) this.textures.remove(TEX_KEY);
        /* 必须显式传入 videoWidth/Height，TextureManager 才会创建 __BASE
           帧（仅传 video 元素时部分 3.80 版本不会自动建帧，后续
           setTexture 会报 has no frame "__BASE"） */
        let tex = this.textures.create(TEX_KEY, v, v.videoWidth, v.videoHeight);
        if (!tex) tex = this.textures.get(TEX_KEY);
        if (tex && !tex.has('__BASE')) {
          tex.add('__BASE', 0, 0, 0, v.videoWidth, v.videoHeight);
        }
        if (!tex || !tex.has('__BASE')) { this._failed = true; return; }
        /* 为每个等级预定义独立 frame（纹理像素坐标内的子帧）。
           用 setTexture(key, 'lv'+level) 切到对应 frame，比 setCrop 更
           可靠——后者在 setDisplaySize 后偶发不生效（cutX/cutWidth 不
           更新），导致塔显示整张 640x640 视频而非单段。 */
        [1, 2, 3].forEach((lv) => {
          const s = SEG[lv];
          const fk = 'lv' + lv;
          if (!tex.has(fk)) tex.add(fk, 0, s.x, s.y, s.w, s.h);
        });
        this._ready = true;
        const ws = this._waiters;
        this._waiters = [];
        ws.forEach((fn) => { try { fn(TEX_KEY); } catch (e) { /* 回调方已销毁 */ } });
      } catch (e) { this._failed = true; }
    });
    v.addEventListener('error', () => { this._failed = true; });

    /* file:// 协议下 Chromium 把本地视频视为跨域，WebGL texImage2D 上传
       会抛 SecurityError → 视频纹理建不出来；http(s):// 同源正常。
       file:// 失败时静默降级到静态贴图（Tower 端兜底）。 */
    try { v.src = SRC; v.load(); } catch (e) { this._failed = true; }

    /* 首次用户手势后解锁（pointer/touch/mouse 三类全监听，兼容旧 X5） */
    const unlock = () => { api._locked = false; api._sync(); };
    ['pointerdown', 'touchstart', 'mousedown'].forEach((ev) =>
      window.addEventListener(ev, unlock, { once: true, passive: true, capture: true }));
  };

  /* 塔注册 / 注销播放引用（引用计数驱动播放与暂停）。
     全场共享一个视频，refs>0 即播放，refs=0 即暂停。 */
  api.use = function () {
    if (!this.supported || this._failed) return;
    this._refs++;
    this._sync();
  };
  api.release = function () {
    if (!this.supported || this._failed || this._refs <= 0) return;
    this._refs--;
    this._sync();
  };

  /* 纹理就绪回调：已就绪立即回调；失败则永不回调（Tower 保持静态兜底） */
  api.whenReady = function (cb) {
    if (!this.supported || this._failed) return;
    if (this._ready) { try { cb(TEX_KEY); } catch (e) {} }
    else this._waiters.push(cb);
  };

  api.isReady = function () { return !!(this.supported && this._ready); };

  /* 返回某等级的纹理裁切区域 { x, y, w, h }（纹理像素坐标），
     即该段龙卷风的内容包围盒。 */
  api.cropForLevel = function (lv) {
    const s = SEG[lv] || SEG[1];
    return { x: s.x, y: s.y, w: s.w, h: s.h };
  };

  /* 返回某等级对应的 Phaser frame key（在 init 时预定义的子帧）。
     Tower 用 setTexture(TEX_KEY, frameKey) 切到该段，比 setCrop 可靠。 */
  api.frameKeyForLevel = function (lv) {
    return 'lv' + (lv >= 1 && lv <= 3 ? lv : 1);
  };

  /* 返回某等级的显示尺寸 { w, h }（世界单位）：
     高 = baseHeight × scale[等级]（JSON 驱动，默认 44/49.28/54.56）；
     宽 = 高 × 包围盒宽高比，保持龙卷风原始造型不拉伸。 */
  api.displaySize = function (lv) {
    const s = SEG[lv] || SEG[1];
    const sc = (LV_SCALE[lv] != null) ? LV_SCALE[lv] : 1;
    const h = BASE_H * sc;
    return { w: h * (s.w / s.h), h: h };
  };

  /* 该等级龙卷风的视觉中心在纹理像素坐标中的位置：
     供 Tower 计算发射点等用途（当前风塔弹道从塔心发射，未用到）。 */
  api.segmentCenter = function (lv) {
    const s = SEG[lv] || SEG[1];
    return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  };

  /* GameScene 每帧调用：把当前视频帧上传到共享 GL 纹理（全场 1 次） */
  api.tick = function () {
    if (!this.supported || !this._ready || !this.textures) return;
    if (this._refs <= 0 || !this._video ||
      this._video.paused || this._video.readyState < 2) return;
    const tex = this.textures.get(TEX_KEY);
    const src = tex && tex.source && tex.source[0];
    if (src) { try { src.update(); } catch (e) {} }
  };

  /* 游戏暂停 / 恢复 */
  api.setPaused = function (v) { this._scenePaused = !!v; this._sync(); };

  /* 新一局 / 场景重启：引用计数归零并暂停视频（塔会重新注册） */
  api.enterScene = function () {
    this._scenePaused = false;
    this._refs = 0;
    if (this._video) { try { this._video.pause(); } catch (e) {} }
  };

  api._sync = function () {
    if (!this.supported || this._failed || !this._video) return;
    const shouldPlay = this._refs > 0 && !this._scenePaused && !this._locked;
    if (shouldPlay) {
      const p = this._video.play();
      if (p && p.catch) p.catch(() => { /* 自动播放被拒：等手势解锁后重试 */ });
    } else {
      try { this._video.pause(); } catch (e) {}
    }
  };

  return api;
})();
