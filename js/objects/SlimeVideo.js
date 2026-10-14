/* ============================================================
 * SlimeVideo.js —— 史莱姆小怪蹦跳视频（全局共享单例 SLIME_VIDEO）
 *
 * 设计要点（仿 WindVideo.js 蓝本，跨平台 / 性能 / 降级）：
 * 1. 全场只创建 1 个 HTMLVideoElement + 1 个 Phaser 视频纹理
 *    'slime_video_full'（640x640，横排两只史莱姆：左=绿色快怪 / 右=蓝紫慢怪），
 *    所有史莱姆共享同一解码器与同一张 GPU 纹理；每只怪用对应 frame
 *    显示自己那一段，替换原来的静态占位贴图；
 * 2. 素材为亮绿幕 H.264 MP4（assets/slime_walk.mp4）。因「绿色快怪」本体
 *    颜色与绿幕较近，不能用 green-excess 键（会连绿怪一起抠缺），改用
 *    SlimeVideoGK 管线（到实测背景色的 L1 距离键，预乘 alpha 输出）。
 *    管线不可用（Canvas 渲染器 / shader 编译失败 / file:// 跨域污染等）
 *    → supported=false，Enemy 端回退静态贴图 + 蹦跳 Tween，功能不受影响；
 * 3. 视频本身即蹦跳循环动画，横向两段：左=绿色快怪 / 右=蓝紫慢怪；
 * 4. 引用计数：场上有史莱姆才播放；游戏暂停全部暂停；新一局重置；
 * 5. muted + playsInline + loop，符合手机浏览器自动播放策略；首次用户
 *    触摸后解锁播放；无控制条、无声音。
 *
 * 两段内容边界（全片 241 帧【内容像素并集】实测 + 每边安全余量，非简单
 * 二分，避免切到相邻史莱姆）：两只怪水平位置几乎不动（中心 x 仅 ±2px），
 * 只在原地上下蹦跳，故固定窗口即可稳定对齐到怪物逻辑位置。
 *   绿色快怪（左）列 x∈[0,285]   行 y∈[160,452]  → 取窗口 x[0,289]  y[138,469]
 *   蓝紫慢怪（右）列 x∈[294,625] 行 y∈[128,451]  → 取窗口 x[290,639] y[110,465]
 * 两段之间的空列区间为 x∈[286,293]（无任何内容），以 x=290 为分界最稳。
 * ============================================================ */
const SLIME_VIDEO = (() => {
  const VER = '20261014a';               // 素材版本号（破 file:// 缓存）
  const TEX_KEY = 'slime_video_full';    // 共享 Phaser 视频纹理键
  const VID_W = 640, VID_H = 640;        // 视频尺寸（H.264 640x640）

  /* 显示高度（世界单位）= config.enemies.slimeVideo.displayH[段]（JSON 驱动，
     改 config 即可调尺寸，无需改代码）。读取异常回退内置默认。 */
  const CFG = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.enemies &&
    TD_CONFIG.enemies.slimeVideo) || {};
  const DISP_H = CFG.displayH || { green: 50, blue: 60 };
  const SRC = (CFG.src || 'assets/slime_walk.mp4') + '?v=' + VER;

  /* 两段史莱姆的【显示窗口】（视频纹理像素坐标），含蹦跳上下限 + 安全余量 */
  const SEG = {
    green: { x: 0,   y: 138, w: 290, h: 332 },   // 左：绿色快怪
    blue:  { x: 290, y: 110, w: 350, h: 356 }    // 右：蓝紫慢怪
  };

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
       (b) 当前是 WebGL 渲染器 + SlimeVideoGK 距离键管线已注册。
       二者缺一不可——Canvas 渲染器或管线缺失时绝不让视频接管
       （绿幕背景无法被键出，会叠成大色块，比静态贴图更糟）。 */
    const probe = document.createElement('video');
    const canH264 = !!(probe.canPlayType &&
      probe.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
    if (!canH264) return;
    const pipelineReady = (typeof fireVideoPipelineReady === 'function') &&
      !!fireVideoPipelineReady(scene, 'SlimeVideoGK');
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
    v.controls = false;
    this._video = v;

    v.addEventListener('loadeddata', () => {
      if (this._ready || this._failed || v.videoWidth === 0) return;
      try {
        if (this.textures.exists(TEX_KEY)) this.textures.remove(TEX_KEY);
        /* 必须显式传入 videoWidth/Height，TextureManager 才会创建 __BASE
           帧（仅传 video 元素时部分 3.80 版本不会自动建帧） */
        let tex = this.textures.create(TEX_KEY, v, v.videoWidth, v.videoHeight);
        if (!tex) tex = this.textures.get(TEX_KEY);
        if (tex && !tex.has('__BASE')) {
          tex.add('__BASE', 0, 0, 0, v.videoWidth, v.videoHeight);
        }
        if (!tex || !tex.has('__BASE')) { this._failed = true; return; }
        /* 为两段预定义独立 frame：Enemy 用 setTexture(TEX_KEY, 'green'/'blue')
           切到对应段，比 setCrop 可靠（setDisplaySize 后少数版本 setCrop 不生效） */
        ['green', 'blue'].forEach((k) => {
          const s = SEG[k];
          if (!tex.has(k)) tex.add(k, 0, s.x, s.y, s.w, s.h);
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
       file:// 失败时静默降级到静态贴图（Enemy 端兜底）。 */
    try { v.src = SRC; v.load(); } catch (e) { this._failed = true; }

    /* 首次用户手势后解锁（pointer/touch/mouse 三类全监听，兼容旧 X5） */
    const unlock = () => { api._locked = false; api._sync(); };
    ['pointerdown', 'touchstart', 'mousedown'].forEach((ev) =>
      window.addEventListener(ev, unlock, { once: true, passive: true, capture: true }));
  };

  /* 史莱姆注册 / 注销播放引用（引用计数驱动播放与暂停）。
     全场共享一个视频，refs>0 即播放，refs=0 即暂停（省电、防手机卡顿）。 */
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

  /* 纹理就绪回调：已就绪立即回调；失败则永不回调（Enemy 保持静态降级） */
  api.whenReady = function (cb) {
    if (!this.supported || this._failed) return;
    if (this._ready) { try { cb(TEX_KEY); } catch (e) {} }
    else this._waiters.push(cb);
  };

  api.isReady = function () { return !!(this.supported && this._ready); };

  api.texKey = function () { return TEX_KEY; };

  /* 段名 → Phaser frame key（init 时预定义的子帧） */
  api.frameKey = function (seg) {
    return (seg === 'blue') ? 'blue' : 'green';
  };

  /* 返回某段的显示尺寸 { w, h }（世界单位）：
     高 = displayH[段]（JSON 驱动，默认 50/60）；宽 = 高 × 窗口宽高比，
     保持史莱姆原造型不拉伸。 */
  api.displaySize = function (seg) {
    const s = SEG[api.frameKey(seg)];
    const key = api.frameKey(seg);
    const h = (DISP_H && DISP_H[key] != null) ? DISP_H[key] : (key === 'blue' ? 60 : 50);
    return { w: h * (s.w / s.h), h: h };
  };

  /* 返回某段的窗口区域 { x, y, w, h }（纹理像素坐标） */
  api.segmentRect = function (seg) {
    const s = SEG[api.frameKey(seg)];
    return { x: s.x, y: s.y, w: s.w, h: s.h };
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

  /* 新一局 / 场景重启：引用计数归零并暂停视频（史莱姆会重新注册） */
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
