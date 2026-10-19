/* ============================================================
 * Level8Video.js —— 第 8 关小怪移动视频（水晶史莱姆 / 自爆泥怪）
 *
 * 两种小怪各有一段独立素材（单段、非横排多段），故各自建立一份
 * 「共享单视频」单例（结构完全同构 SlimeVideo.js / BossVideo.js）：
 *   window.CRYSTAL_SLIME_VIDEO ← assets/crystal_slime_move.mp4
 *   window.BOMB_SLIME_VIDEO    ← assets/bomb_slime_move.mp4
 *
 * 设计要点（与既有视频模块保持一致）：
 * 1. 全场共享 1 个 HTMLVideoElement + 1 个 Phaser 视频纹理，所有同类小怪
 *    共用同一解码器与同一张 GPU 纹理；每只怪把 body 贴图换成该纹理的固定
 *    窗口 frame，视频自身即移动/滚动动画；
 * 2. 素材背景为纯色（水晶=白底 253,252,250 / 自爆=绿幕 50,233,69），运行时
 *    由专用色度键管线抠成透明（CrystalSlimeGK / BombSlimeGK，见
 *    FireVideoPipeline.js，参数全部来自 TD_CONFIG 实测值）；
 * 3. 引用计数：场上有该类小怪才播放（refs>0），全灭即暂停（省电防卡）；
 *    游戏暂停全部暂停；新一局/重进关卡引用归零并暂停；
 * 4. 【同屏降级】maxEnemies（JSON 可调，默认 12）：use() 超过上限即返回
 *    false，超出的小怪保持代码绘制静态贴图 —— 手机端同屏大量视频怪时
 *    控制开销，不卡顿、不黑屏；
 * 5. 不支持（Canvas 渲染器 / 无 H.264 / 管线未注册 / file:// 跨域）或加载
 *    失败（10s 超时）时 supported/failed 生效，Enemy 侧保持静态贴图兜底，
 *    功能与观感不缺失；
 * 6. muted + playsInline + loop，符合手机浏览器自动播放策略；无控制条、
 *    无声音；首次用户手势后解锁播放。
 *
 * 两段素材的显示窗口（视频纹理像素坐标，实测内容包围盒 + 安全余量，
 * 已剔除画面底部烘焙的灰色投影，怪物贴地不存在多余阴影）：
 *   水晶史莱姆：x[84..558] y[78..496]  → 显示高 42（可见宽约 47.6 ≤ 路宽 50）
 *   自爆泥怪  ：x[94..546] y[144..508] → 显示高 38（可见宽约 47.2 ≤ 路宽 50）
 * ============================================================ */
(function () {
  'use strict';

  const VER = '20261019a';   // 素材版本号（破 file:// / HTTP 缓存）

  /* 由配置生成一份「共享单视频」单例（两种小怪各一份，互不影响） */
  function createVideo(spec) {
    const ECFG = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.enemies) || {};
    const CFG = (ECFG[spec.enemyKey] && ECFG[spec.enemyKey][spec.cfgKey]) || {};
    const TEX_KEY = spec.texKey;                       // 共享 Phaser 视频纹理键
    const FRAME_KEY = 'main';                          // 固定显示窗口 frame 名
    const SRC = (CFG.src || spec.src) + '?v=' + VER;
    const WIN = CFG.win || spec.win;                    // 显示窗口（纹理像素坐标）
    const DISP_H = (CFG.displayH != null) ? CFG.displayH : spec.displayH;

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
      _baseRate: (CFG.rate != null) ? CFG.rate : 1,       // 播放倍速基准（自爆滚动节奏）
      _pendingRate: null,                                 // 本帧待应用的移速比（report→tick）
      _maxEnemies: Math.max(1, CFG.maxEnemies || 12),     // 同屏视频怪上限（降级用）
      textures: null
    };

    /* GameScene.create（或按需加载调度）中调用一次；renderer/TextureManager 已就绪 */
    api.init = function (scene) {
      if (this._inited) return;
      this._inited = true;
      this._scene = scene;
      this.textures = scene.textures;

      /* 支持性检测：(a) 浏览器能解 H.264 MP4；(b) WebGL + 专用抠图管线已注册。
         二者缺一不可——Canvas 渲染器或管线缺失时绝不让视频接管（纯色背景
         无法被键出，会叠成大色块，比静态贴图更糟）。 */
      const probe = document.createElement('video');
      const canH264 = !!(probe.canPlayType &&
        probe.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
      if (!canH264) return;
      const pipelineReady = (typeof fireVideoPipelineReady === 'function') &&
        !!fireVideoPipelineReady(scene, spec.pipeline);
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
      /* 初始播放倍速 = JSON 基准（滚动节奏；运行时由 report→tick 按移速微调） */
      try { v.playbackRate = this._baseRate; } catch (e) {}
      this._video = v;

      v.addEventListener('loadeddata', () => {
        if (this._ready || this._failed || v.videoWidth === 0) return;
        try {
          if (this.textures.exists(TEX_KEY)) this.textures.remove(TEX_KEY);
          /* 必须显式传 videoWidth/Height，TextureManager 才会创建 __BASE 帧 */
          let tex = this.textures.create(TEX_KEY, v, v.videoWidth, v.videoHeight);
          if (!tex) tex = this.textures.get(TEX_KEY);
          if (tex && !tex.has('__BASE')) {
            tex.add('__BASE', 0, 0, 0, v.videoWidth, v.videoHeight);
          }
          if (!tex || !tex.has('__BASE')) { this._failed = true; return; }
          /* 固定显示窗口帧：Enemy 用 setTexture(TEX_KEY, 'main') 切到该窗口，
             比 setCrop 可靠（setDisplaySize 后少数 3.80 版本 setCrop 不生效） */
          if (!tex.has(FRAME_KEY)) tex.add(FRAME_KEY, 0, WIN.x, WIN.y, WIN.w, WIN.h);
          this._ready = true;
          const ws = this._waiters;
          this._waiters = [];
          ws.forEach((fn) => { try { fn(TEX_KEY); } catch (e) { /* 回调方已销毁 */ } });
        } catch (e) { this._failed = true; }
      });
      v.addEventListener('error', () => { this._failed = true; });

      /* 来源统一交给 TDMedia 串行队列（一次只下载 1 个视频，单项 10s 超时即
         跳过；http(s) 命中缓存用 blob URL 秒开并回填缓存）。TDMedia 缺失时
         回退旧直连方式。file:// 下 WebGL 上传本地视频会抛 SecurityError →
         失败即静默降级静态贴图（Enemy 端兜底）。 */
      try {
        if (typeof TDMedia !== 'undefined' && TDMedia.loadVideo) {
          TDMedia.loadVideo(v, SRC, {
            fillCache: true,
            onFail: () => { this._failed = true; }
          });
        } else {
          v.src = SRC;
          v.load();
        }
      } catch (e) { this._failed = true; }

      /* 首次用户手势后解锁（pointer/touch/mouse 三类全监听，兼容旧 X5） */
      const unlock = () => { api._locked = false; api._sync(); };
      ['pointerdown', 'touchstart', 'mousedown'].forEach((ev) =>
        window.addEventListener(ev, unlock, { once: true, passive: true, capture: true }));
    };

    /* 注册 / 注销播放引用（引用计数驱动播放与暂停）。
       返回 false = 本只怪不走视频（不支持 / 已失败 / 超同屏上限）→ 调用方
       保持代码绘制静态贴图降级。 */
    api.use = function () {
      if (!this.supported || this._failed) return false;
      if (this._refs >= this._maxEnemies) return false;
      this._refs++;
      this._sync();
      return true;
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
    api.frameKey = function () { return FRAME_KEY; };
    api.windowRect = function () { return { x: WIN.x, y: WIN.y, w: WIN.w, h: WIN.h }; };

    /* 显示尺寸（世界单位）：高 = displayH（JSON 驱动）；宽 = 高 × 窗口宽高比，
       保持造型不拉伸（两种素材的窗口宽高比换算后可见宽均 ≤ 路宽 50）。 */
    api.displaySize = function () {
      const h = (DISP_H != null) ? DISP_H : spec.displayH;
      return { w: h * (WIN.w / WIN.h), h: h };
    };

    /* 播放倍速随移速缩放（自爆泥怪「贴地滚动」节奏与物理位移同步，避免滑步）：
       rate = baseRate × 速度比；被减速/加速时滚动节奏同步变慢/变快。
       共享单视频只有一个解码器，故本帧取「同类小怪里最快的速度比」为准。 */
    api.setRate = function (ratio) {
      const v = this._video;
      if (!v || !this._ready) return;
      const r = Math.max(0.25, Math.min(3, (ratio || 1) * this._baseRate));
      try { if (Math.abs(v.playbackRate - r) > 0.01) v.playbackRate = r; } catch (e) {}
    };

    /* 小怪每帧上报自身移速比（speedNow/baseSpeed）；tick 时统一消费 */
    api.report = function (ratio) {
      const r = (ratio > 0) ? ratio : 0;
      this._pendingRate = (this._pendingRate == null) ? r : Math.max(this._pendingRate, r);
    };

    /* GameScene 每帧调用：先消费本帧移速比（滚动节奏），再把当前视频帧上传到
       共享 GL 纹理（全场 1 次）。Phaser 3.80 裸视频纹理不会随渲染自动上传
       ——只有 Video 游戏对象内部才会 update；用 HTMLVideoElement 直接建纹理
       必须每帧手动 source.update()，否则画面永远停在首帧。 */
    api.tick = function () {
      if (this._pendingRate != null) {
        /* 无小怪上报时（如刚进场）按 1 倍速复位 */
        this.setRate(this._pendingRate);
        this._pendingRate = null;
      }
      if (!this.supported || !this._ready || !this.textures) return;
      if (this._refs <= 0 || !this._video ||
        this._video.paused || this._video.readyState < 2) return;
      const tex = this.textures.get(TEX_KEY);
      const src = tex && tex.source && tex.source[0];
      if (src) { try { src.update(); } catch (e) {} }
    };

    /* 游戏暂停 / 恢复 */
    api.setPaused = function (v) { this._scenePaused = !!v; this._sync(); };

    /* 新一局 / 场景重启：引用计数归零并暂停视频（小怪会重新注册） */
    api.enterScene = function () {
      this._scenePaused = false;
      this._refs = 0;
      this._pendingRate = null;
      if (this._video) {
        try { this._video.pause(); } catch (e) {}
        try { this._video.playbackRate = this._baseRate; } catch (e) {}
      }
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
  }

  /* ---- 两个单例（键名与 Enemy/管线约定一致） ---- */
  window.CRYSTAL_SLIME_VIDEO = createVideo({
    enemyKey: 'crystalSlime', cfgKey: 'moveVideo',
    texKey: 'crystal_video_full', pipeline: 'CrystalSlimeGK',
    src: 'assets/crystal_slime_move.mp4',
    win: { x: 84, y: 78, w: 474, h: 418 }, displayH: 42
  });
  window.BOMB_SLIME_VIDEO = createVideo({
    enemyKey: 'bomberSlime', cfgKey: 'moveVideo',
    texKey: 'bomb_video_full', pipeline: 'BombSlimeGK',
    src: 'assets/bomb_slime_move.mp4',
    win: { x: 94, y: 144, w: 452, h: 364 }, displayH: 38
  });
})();
