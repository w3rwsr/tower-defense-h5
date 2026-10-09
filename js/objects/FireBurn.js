/* ============================================================
 * FireBurn.js —— 火元素塔燃烧视频（全局共享单例 FIRE_BURN）
 *
 * 设计要点（跨平台 / 性能）：
 * 1. 每个等级只创建 1 个 HTMLVideoElement + 1 个 Phaser 视频纹理，
 *    同屏任意数量火塔共享同一个解码器与同一张 GPU 纹理；
 * 2. 素材为黑底 H.264 MP4，运行时以 ADD 混合叠加在静态火焰贴图上，
 *    黑色自动不可见——iOS Safari 不支持 WebM alpha 通道，黑底+ADD
 *    是兼容性最好的"透明"方案；
 * 3. 引用计数：场上有某等级火塔才播放该等级视频；游戏暂停时全部暂停；
 * 4. 任意环节不可用（无法解码 H.264 / 加载失败 / 纹理创建失败）→
 *    supported=false 或对应等级 failed，Tower 回退静态贴图+Tween，
 *    游戏功能不受任何影响；
 * 5. muted + playsInline + loop，符合手机浏览器自动播放策略；首次
 *    用户触摸后解锁播放。
 * ============================================================ */
const FIRE_BURN = (() => {
  const VER = '20261009b';                 // 素材版本号（破 file:// 缓存，仅文件回退用）
  const LEVELS = [1, 2, 3];
  const TEX_KEY = { 1: 'fire_burn_lv1', 2: 'fire_burn_lv2', 3: 'fire_burn_lv3' };
  /* 视频来源：优先 base64 data URI（FireBurnData.js 内嵌，与 assets 下 mp4
     逐字节一致）。file:// 协议下 Chromium 把本地文件视频视为跨域数据，
     WebGL texImage2D 上传会抛 SecurityError → 视频纹理永远建不出来，
     火塔只能显示静态贴图；data: URI 属同源干净数据不触发污染，
     file:// / http:// / 微信 X5 全环境通用。data URI 加载失败时
     自动回退到文件 URL（http:// 环境兜底）。 */
  const MIME = 'data:video/mp4;base64,';
  const hasData = (typeof FIRE_BURN_DATA !== 'undefined') && FIRE_BURN_DATA;
  const srcFor = (lv) => (hasData && FIRE_BURN_DATA[lv])
    ? MIME + FIRE_BURN_DATA[lv]
    : 'assets/fire_burn_lv' + lv + '.mp4?v=' + VER;
  /* 静态贴图显示尺寸（与 Tower._fireDisplaySize 一致） */
  const BASE_DISPLAY = { 1: 42, 2: 48, 3: 56 };
  /* 视频画面内火焰占比小于静态贴图纹理（静态贴图按包围盒裁剪、视频保留
     完整画面），叠加容器需放大才能让火焰视觉尺寸与静态贴图一致。
     系数 = 静态纹理内容占比 / 视频内容占比（包围盒实测） */
  const SCALE = { 1: 1.83, 2: 1.70, 3: 1.15 };

  const api = {
    supported: false,
    _inited: false,
    _locked: true,          // 尚未拿到用户手势（自动播放解锁前）
    _scenePaused: false,
    items: {},              // lv -> {video, ready, failed, refs, waiters}
    textures: null
  };

  /* BootScene.create 中调用一次（renderer / TextureManager 已就绪） */
  api.init = function (scene) {
    if (this._inited) return;
    this._inited = true;
    this.textures = scene.textures;

    const probe = document.createElement('video');
    this.supported = !!(probe.canPlayType &&
      probe.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
    if (!this.supported) return;

    LEVELS.forEach((lv) => {
      const v = document.createElement('video');
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.preload = 'auto';
      v.playsInline = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      const item = { video: v, ready: false, failed: false, refs: 0, waiters: [], triedFile: false };
      this.items[lv] = item;

      v.addEventListener('loadeddata', () => {
        if (item.ready || item.failed || v.videoWidth === 0) return;
        try {
          const key = TEX_KEY[lv];
          if (this.textures.exists(key)) this.textures.remove(key);
          /* 必须显式传入 videoWidth/Height，TextureManager 才会创建 __BASE
             帧（仅传 video 元素时部分 3.80 版本不会自动建帧，后续
             setTexture 会报 has no frame "__BASE"） */
          let tex = this.textures.create(key, v, v.videoWidth, v.videoHeight);
          if (!tex) tex = this.textures.get(key);
          if (tex && !tex.has('__BASE')) {
            tex.add('__BASE', 0, 0, 0, v.videoWidth, v.videoHeight);
          }
          if (!tex || !tex.has('__BASE')) { item.failed = true; return; }
          item.ready = true;
          const ws = item.waiters;
          item.waiters = [];
          ws.forEach((fn) => { try { fn(key); } catch (e) { /* 回调方已销毁 */ } });
        } catch (e) { item.failed = true; }
      });
      v.addEventListener('error', () => {
        /* data URI 失败（个别内核不支持 base64 视频）→ 回退文件 URL 重试；
           文件 URL 也失败才判定 failed（Tower 保持静态贴图兜底） */
        if (!item.triedFile && v.src.indexOf('data:') === 0) {
          item.triedFile = true;
          v.src = 'assets/fire_burn_lv' + lv + '.mp4?v=' + VER;
          v.load();
          return;
        }
        item.failed = true;
      });

      v.src = srcFor(lv);
    });

    /* 首次用户手势后解锁（pointer/touch/mouse 三类全监听，兼容旧 X5 内核） */
    const unlock = () => { api._locked = false; api._syncAll(); };
    ['pointerdown', 'touchstart', 'mousedown'].forEach((ev) =>
      window.addEventListener(ev, unlock, { once: true, passive: true, capture: true }));
  };

  /* 塔注册 / 注销某等级的播放引用（引用计数驱动播放与暂停） */
  api.use = function (lv) {
    const it = this.items[lv];
    if (!it || it.failed) return;
    it.refs++;
    this._sync(it);
  };
  api.release = function (lv) {
    const it = this.items[lv];
    if (!it || it.failed || it.refs <= 0) return;
    it.refs--;
    this._sync(it);
  };

  /* 纹理就绪回调：已就绪立即回调；失败则永不回调（Tower 保持静态兜底） */
  api.whenReady = function (lv, cb) {
    const it = this.items[lv];
    if (!it || !this.supported || it.failed) return;
    if (it.ready) { try { cb(TEX_KEY[lv]); } catch (e) {} }
    else it.waiters.push(cb);
  };

  api.isReady = function (lv) { return !!(this.items[lv] && this.items[lv].ready); };
  api.displaySize = function (lv) { return Math.round(BASE_DISPLAY[lv] * SCALE[lv]); };

  /* GameScene 每帧调用：把当前视频帧上传到共享 GL 纹理（全场最多 3 次） */
  api.tick = function () {
    if (!this.supported || !this.textures) return;
    for (const lv of LEVELS) {
      const it = this.items[lv];
      if (!it || !it.ready || it.refs <= 0 || it.video.paused ||
        it.video.readyState < 2) continue;
      const tex = this.textures.get(TEX_KEY[lv]);
      const src = tex && tex.source && tex.source[0];
      if (src) { try { src.update(); } catch (e) {} }
    }
  };

  /* 游戏暂停 / 恢复 */
  api.setPaused = function (v) { this._scenePaused = !!v; this._syncAll(); };

  /* 新一局 / 场景重启：引用计数归零并暂停所有视频（塔会重新注册） */
  api.enterScene = function () {
    this._scenePaused = false;
    LEVELS.forEach((lv) => {
      const it = this.items[lv];
      if (!it) return;
      it.refs = 0;
      try { it.video.pause(); } catch (e) {}
    });
  };

  api._sync = function (it) {
    if (!this.supported || !it || it.failed) return;
    const shouldPlay = it.refs > 0 && !this._scenePaused && !this._locked;
    if (shouldPlay) {
      const p = it.video.play();
      if (p && p.catch) p.catch(() => { /* 自动播放被拒：等手势解锁后重试 */ });
    } else {
      try { it.video.pause(); } catch (e) {}
    }
  };
  api._syncAll = function () { LEVELS.forEach((lv) => this._sync(this.items[lv])); };

  return api;
})();
