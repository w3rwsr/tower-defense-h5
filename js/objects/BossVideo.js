/* ============================================================
 * BossVideo.js —— BOSS 运动视频 + 死亡视频 + 皇冠淡出
 *
 * 导出两个全局单例：
 *
 * 【BOSS_VIDEO】运动视频（仿 SlimeVideo.js 蓝本）
 *   boss_walk.mp4（640x640 绿幕，横排三只：左金/中蓝/右灰）全场共享
 *   1 个 HTMLVideoElement + 1 个 Phaser 视频纹理 'boss_video_full'；
 *   每只 BOSS 用对应 frame（gold/blue/gray）显示自己那一段，替换静态贴图。
 *   三段按实测元素边界固定分区（内容 x[11..213]/[220..421]/[429..627]，
 *   段间空隙 ≥6px），非三等分切割。管线 BossWalkGK（背景色距离键）。
 *
 * 【BOSS_DEATH】死亡视频管理（三个独立视频，播放一次不循环）
 *   - 懒加载：Boss 出场时 prewarm(对应变体)，死亡时通常早已就绪；
 *   - Boss 被击杀时 play(key,x,y,scene) 接管：隐藏并销毁 Boss 本体，
 *     在死亡位置叠加爆炸视频（锚点居中，不遮挡 UI），按 bossDeath.
 *     playbackRate 倍速播放（JSON 可调），播完 onended；
 *   - 结束衔接：死亡视频最后一帧含「皇冠躺地 + 粘液滩」——视频层以
 *     videoFade(300ms) 淡出（粘液随之消失），同时从末帧提取的皇冠贴图
 *     （CrownArtData.js，与视频中皇冠同造型同位置）在 crownFadeIn(200ms)
 *     内淡入交叉溶解，再以 Tween 缓慢淡出 crownFade(1.5s，JSON 可调)，
 *     之后销毁皇冠；
 *   - 降级：视频不支持 / 未就绪 / 并发超限 / file:// 跨域 → 返回 false，
 *     Enemy 端走原有死亡动画 + 皇冠贴图淡出，功能不缺失；
 *   - 性能：maxPlaying(JSON) 限制同时播放数量；不播放时全部 pause。
 *
 * 视频元素 muted + playsInline + 无控制条；死亡视频 loop=false。
 * Boss 被击杀必然发生在用户交互（开始波次/放塔）之后，自动播放策略安全。
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 一、BOSS_VIDEO —— 运动视频单例
   * ============================================================ */
  const VER = '20261014e';
  const TEX_KEY = 'boss_video_full';
  const VID_W = 640, VID_H = 640;

  const CFG = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.enemies &&
    TD_CONFIG.enemies.bossVideo) || {};
  const DISP_H = CFG.displayH || { gold: 78, blue: 78, gray: 78 };
  const SRC = (CFG.src || 'assets/boss_walk.mp4') + '?v=' + VER;

  /* 三段显示窗口（视频纹理像素坐标），行范围实测 y[106..437] + 安全余量 */
  const SEG = {
    gold: { x: 0,   y: 100, w: 213, h: 342 },   // 左：金色 BOSS
    blue: { x: 214, y: 100, w: 213, h: 342 },   // 中：蓝色 BOSS
    gray: { x: 427, y: 100, w: 213, h: 342 }    // 右：灰色 BOSS
  };
  const SEGS = ['gold', 'blue', 'gray'];

  const api = {
    supported: false,
    _inited: false,
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

    /* 支持性检测：(a) H.264 MP4；(b) WebGL + BossWalkGK 管线已注册 */
    const probe = document.createElement('video');
    const canH264 = !!(probe.canPlayType &&
      probe.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
    if (!canH264) return;
    const pipelineReady = (typeof fireVideoPipelineReady === 'function') &&
      !!fireVideoPipelineReady(scene, 'BossWalkGK');
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
        let tex = this.textures.create(TEX_KEY, v, v.videoWidth, v.videoHeight);
        if (!tex) tex = this.textures.get(TEX_KEY);
        if (tex && !tex.has('__BASE')) {
          tex.add('__BASE', 0, 0, 0, v.videoWidth, v.videoHeight);
        }
        if (!tex || !tex.has('__BASE')) { this._failed = true; return; }
        SEGS.forEach((k) => {
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
    v.src = SRC;
    try { v.load(); } catch (e) { /* ignore */ }
  };

  api.use = function () { this._refs++; this._sync(); };
  api.release = function () {
    this._refs = Math.max(0, this._refs - 1);
    this._sync();
  };
  api.whenReady = function (fn) {
    if (this._ready) { try { fn(TEX_KEY); } catch (e) {} }
    else if (!this._failed) this._waiters.push(fn);
    else { try { fn(null); } catch (e) {} }
  };
  api.isReady = function () { return this._ready; };
  api.texKey = function () { return TEX_KEY; };
  api.frameKey = function (seg) { return SEG[seg] ? seg : 'gold'; };
  api.displaySize = function (seg) {
    const s = SEG[seg] || SEG.gold;
    const h = DISP_H[seg] || 78;
    return { w: h * (s.w / s.h), h: h };
  };

  api._sync = function () {
    const v = this._video;
    if (!v) return;
    if (this._refs > 0 && !this._scenePaused) {
      if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    } else if (!v.paused) {
      v.pause();
    }
  };
  api.enterScene = function () {
    if (!this._scenePaused) return;
    this._scenePaused = false;
    this._sync();
  };
  /* GameScene 每帧调用：把当前视频帧上传到共享 GL 纹理（全场 1 次）。
     Phaser 3.80 裸视频纹理【不会】随渲染自动上传——只有 Video 游戏对象
     内部才会 update；用 HTMLVideoElement 直接建纹理必须每帧手动
     source.update()（与 SlimeVideo.tick 同款），否则画面永远停在首帧。 */
  api.tick = function () {
    if (!this.supported || !this._ready || !this.textures) return;
    if (this._refs <= 0 || !this._video ||
      this._video.paused || this._video.readyState < 2) return;
    const tex = this.textures.get(TEX_KEY);
    const src = tex && tex.source && tex.source[0];
    if (src) { try { src.update(); } catch (e) {} }
  };
  api.setPaused = function (v) {
    this._scenePaused = !!v;
    this._sync();
  };

  window.BOSS_VIDEO = api;

  /* ============================================================
   * 二、BOSS_DEATH —— 死亡视频管理 + 皇冠淡出
   * ============================================================ */
  const DC = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.enemies &&
    TD_CONFIG.enemies.bossDeath) || {};
  const MAX_PLAYING = Math.max(1, DC.maxPlaying || 2);
  const VIDEO_FADE = Math.max(0, DC.videoFade != null ? DC.videoFade : 300);
  const CROWN_FADE = Math.max(200, DC.crownFade != null ? DC.crownFade : 1500);
  /* 皇冠淡入时长（JSON：crownFadeIn）：视频层 300ms 淡出期间皇冠同步淡入，
     两者交叉溶解，消除「视频皇冠 → 代码皇冠」交接瞬间的突变/微错位感 */
  const CROWN_FADE_IN = Math.max(0, DC.crownFadeIn != null ? DC.crownFadeIn : 200);
  /* 死亡视频播放倍速（JSON bossDeath.playbackRate，1=原速）：设置在 video
     元素上，ended 事件自动提前触发，皇冠淡出/销毁时序无需任何改动 */
  const DEATH_RATE = Math.max(0.1, DC.playbackRate != null ? DC.playbackRate : 1);
  const DEATH_H = DC.deathDisplayH || {};
  const CROWN_H = DC.crownDisplayH || {};
  const CROWN_ANCHOR = DC.crownAnchor || {};

  const dapi = {
    supported: false,
    _inited: false,
    _paused: false,
    textures: null,
    _st: {},          // key -> { video, texKey, ready, failed, playing }
    _playing: 0
  };

  dapi.init = function (scene) {
    if (this._inited) return;
    this._inited = true;
    this.textures = scene.textures;
    const probe = document.createElement('video');
    const canH264 = !!(probe.canPlayType &&
      probe.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '');
    if (!canH264) return;
    const pipelineReady = (typeof fireVideoPipelineReady === 'function') &&
      !!fireVideoPipelineReady(scene, 'BossDeathGK');
    if (!pipelineReady) return;
    this.supported = true;
    /* 死亡视频不在此处预载：启动瞬间并发 6 个视频首帧解码会拖慢/卡住
       Boot（弱机黑屏）。改由 GameScene.create 在「本关有 Boss」时调用
       prewarmAll()——进关后到 Boss 出场间隔数十秒，死亡时必然就绪；
       Boss 出场时 Enemy 端仍有 prewarm(key) 兜底。 */
  };

  /* 进关后后台预载三个死亡视频（preload=auto，不播放）。消除旧方案
     「Boss 出场才 prewarm、出场即被秒时 play() 因 !ready 永久降级」
     的竞态；重复调用安全（已建条目直接返回）。 */
  dapi.prewarmAll = function () {
    if (!this.supported) return;
    SEGS.forEach((k) => { try { this.prewarm(k); } catch (e) { /* 单个失败不影响其余 */ } });
  };

  /* 懒加载某个死亡视频（Boss 出场时调用；重复调用安全） */
  dapi.prewarm = function (key) {
    if (!this.supported || !this.textures) return;
    if (!SEGS_ONLY(key)) return;
    if (this._st[key]) return;
    const texKey = 'boss_death_' + key;
    const st = { video: null, texKey, ready: false, failed: false, playing: false };
    this._st[key] = st;

    const v = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.loop = false;               // 死亡视频只播一次
    v.preload = 'auto';
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.controls = false;
    st.video = v;

    v.addEventListener('loadeddata', () => {
      if (st.ready || st.failed || v.videoWidth === 0) return;
      try {
        if (this.textures.exists(texKey)) this.textures.remove(texKey);
        let tex = this.textures.create(texKey, v, v.videoWidth, v.videoHeight);
        if (!tex) tex = this.textures.get(texKey);
        if (tex && !tex.has('__BASE')) {
          tex.add('__BASE', 0, 0, 0, v.videoWidth, v.videoHeight);
        }
        if (!tex || !tex.has('__BASE')) { st.failed = true; return; }
        st.ready = true;
      } catch (e) { st.failed = true; }
    });
    v.addEventListener('error', () => { st.failed = true; });
    v.src = (DC.src || 'assets/boss_death_#KEY#.mp4').replace('#KEY#', key) + '?v=' + VER;
    try { v.load(); } catch (e) { /* ignore */ }
  };

  function SEGS_ONLY(k) { return k === 'gold' || k === 'blue' || k === 'gray'; }

  /**
   * 播放死亡动画。成功接管返回 true（Boss 本体随后销毁，视频独立播放）；
   * 返回 false = 走降级（原有死亡动画 + 皇冠淡出）。
   * @param key 'gold'|'blue'|'gray'
   */
  dapi.play = function (key, x, y, scene) {
    if (!this.supported || !scene || !scene.add || !scene.tweens) return false;
    if (!SEGS_ONLY(key)) return false;
    const st = this._st[key];
    if (!st || !st.ready || st.failed || !st.video || st.playing) return false;
    if (this._playing >= MAX_PLAYING) return false;
    const tex = this.textures.get(st.texKey);
    if (!tex || !tex.has('__BASE')) return false;

    const dh = DEATH_H[key] || 50;
    const img = scene.add.image(x, y, st.texKey);
    img.setPipeline('BossDeathGK');
    img.setDisplaySize(dh, dh);   // 视频 640x640 正方形，宽=高不变形
    img.setDepth(60);             // 叠在敌人/路径之上，UI 之下
    img.setBlendMode(Phaser.BlendModes.NORMAL);

    const v = st.video;
    try { v.currentTime = 0; } catch (e) { /* 首播无妨 */ }
    try { v.playbackRate = DEATH_RATE; } catch (e) { /* 老内核不支持则原速 */ }
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
    st.playing = true;
    this._playing++;

    const entry = { key, st, img, scene, x, y };
    const onEnded = () => {
      v.removeEventListener('ended', onEnded);
      if (this._st[key] === st) this._finish(entry);
    };
    v.addEventListener('ended', onEnded);
    return true;
  };

  /* 死亡视频播完：皇冠出现并缓慢淡出；视频层（含粘液残留）快速淡出 */
  dapi._finish = function (entry) {
    const { key, st, img, scene, x, y } = entry;
    st.playing = false;
    this._playing = Math.max(0, this._playing - 1);
    if (st.video) { try { st.video.pause(); } catch (e) {} }

    /* 场景已重启/关闭：贴图由场景销毁，直接返回 */
    if (!scene || !scene.tweens || !img.active) {
      try { if (img.active) img.destroy(); } catch (e) {}
      return;
    }

    /* 皇冠：与死亡视频中的皇冠同造型（末帧提取），落在同一位置
       （crownAnchor 实测=视频末帧皇冠中心，误差 ≤1px；世界偏移按
       deathDisplayH 等比换算，视频皇冠与代码皇冠逐像素对齐） */
    const cTex = 'crown_' + key;
    if (this.textures && this.textures.exists(cTex)) {
      const anchor = CROWN_ANCHOR[key] || { x: 321, y: 434 };
      const dh = DEATH_H[key] || 50;
      const dx = (anchor.x - 320) / 640 * dh;
      const dy = (anchor.y - 320) / 640 * dh;
      const ch = CROWN_H[key] || 9;
      const crown = scene.add.image(x + dx, y + dy, cTex);
      const tex = this.textures.get(cTex);
      if (tex && tex.source && tex.source[0]) {
        const ratio = tex.source[0].width / Math.max(1, tex.source[0].height);
        crown.setDisplaySize(ch * ratio, ch);
      } else {
        crown.setDisplaySize(ch, ch);
      }
      crown.setDepth(59);          // 位于视频层(60)之下：视频皇冠淡出时下方皇冠透出，交叉溶解
      crown.setAlpha(0);
      /* 皇冠淡入（JSON：crownFadeIn）→ 缓慢淡出（JSON：crownFade，
         Sine 平滑过渡），淡出结束后销毁皇冠对象 */
      scene.tweens.add({
        targets: crown,
        alpha: 1,
        duration: CROWN_FADE_IN,
        ease: 'Sine.easeOut',
        onComplete: () => {
          scene.tweens.add({
            targets: crown,
            alpha: 0,
            duration: CROWN_FADE,
            delay: 0,
            ease: 'Sine.easeInOut',
            onComplete: () => { try { if (crown.active) crown.destroy(); } catch (e) {} }
          });
        }
      });
    }

    /* 视频层淡出（粘液滩等爆炸残留随之消失），与皇冠位置无缝衔接 */
    scene.tweens.add({
      targets: img,
      alpha: 0,
      duration: VIDEO_FADE,
      onComplete: () => { try { if (img.active) img.destroy(); } catch (e) {} }
    });
  };

  dapi.enterScene = function () {
    /* 新一局：停掉所有死亡视频与计数（overlay/crown 由旧场景销毁） */
    for (const k in this._st) {
      const st = this._st[k];
      st.playing = false;
      if (st.video && !st.video.paused) { try { st.video.pause(); } catch (e) {} }
    }
    this._playing = 0;
    this._paused = false;
  };

  /* GameScene 每帧调用：为每个【正在播放】的死亡视频上传当前帧。
     与运动视频同理：Phaser 3.80 裸视频纹理不自动上传，不手动 update
     死亡画面会永远停在首帧（看似"死亡视频没播放"，10 秒后直接皇冠）。 */
  dapi.tick = function () {
    if (!this.supported || !this.textures) return;
    for (const k in this._st) {
      const st = this._st[k];
      if (!st.playing || !st.ready || !st.video ||
        st.video.paused || st.video.readyState < 2) continue;
      const tex = this.textures.get(st.texKey);
      const src = tex && tex.source && tex.source[0];
      if (src) { try { src.update(); } catch (e) {} }
    }
  };

  dapi.setPaused = function (v) {
    this._paused = !!v;
    for (const k in this._st) {
      const st = this._st[k];
      if (!st.video || !st.ready) continue;
      if (this._paused) {
        if (!st.video.paused) { try { st.video.pause(); } catch (e) {} }
      } else if (st.playing && st.video.paused) {
        const p = st.video.play();
        if (p && p.catch) p.catch(() => {});
      }
    }
  };

  window.BOSS_DEATH = dapi;
})();
