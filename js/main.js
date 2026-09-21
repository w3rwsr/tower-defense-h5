/* ============================================================
 * main.js —— Phaser 游戏启动入口
 * 设计分辨率 960x540（16:9 横屏），Scale.FIT 等比缩放：
 * 电脑窗口、手机横竖屏都会自动留边居中，配合 CSS 竖屏提示。
 * ============================================================ */
(function () {
  'use strict';

  /* ============================================================
   * 移动端识别：给 <html> 加 is-mobile class。
   * 微信/QQ 等 App 内置浏览器（WebView）在 Android 上通常锁死竖屏方向，
   * 系统旋转锁定开启时 WebView 视口永远竖屏，横屏"检测不到"——
   * 这不是检测 bug，而是 WebView 物理限制。
   * 解法：移动端 + 竖屏时用 CSS 旋转 90° 实现「视觉横屏」，
   * 让游戏在任何锁定状态下都能以横屏布局正常游玩。
   * ============================================================ */
  (function detectMobile() {
    try {
      const ua = navigator.userAgent || '';
      const isMobile =
        /Android|iPhone|iPad|iPod|Mobile|MicroMessenger|QQBrowser|MQQBrowser/i.test(ua) ||
        (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);
      if (isMobile) document.documentElement.classList.add('is-mobile');
      window.__isMobile = isMobile;
    } catch (e) { /* 忽略 */ }
  })();

  /* 画面朝向校准（音量键侧）：false=UI 顶部朝机身右边框（默认，多数
     安卓音量键位置），true=朝左边框。校准值持久化于 localStorage
     tdRotFlip，画面方向相对机身永久锁定。UI 中不再提供翻转按钮；
     需要切换朝向时（换新设备/音量键侧与默认不符），由调试入口预置：
     localStorage.setItem('tdRotFlip','1') 后刷新页面（'0' 为恢复默认）。
     必须在 Orientation 模块之前用 let 声明并完成初始化：Orientation IIFE
     初始化时会同步调用 apply()→updateDebug() 引用本变量，若声明在其后，
     同步调用瞬间变量仍处于 TDZ，抛 ReferenceError 会中断整个主 IIFE，
     导致 Phaser 游戏与 deviceorientation 监听全部无法注册。 */
  let manualFlip = false;
  try { manualFlip = localStorage.getItem('tdRotFlip') === '1'; } catch (e) { /* 忽略 */ }

  /* ============================================================
   * 可靠的设备方向检测模块。
   *
   * 为什么不用纯 CSS @media (orientation: portrait)：
   *   - CSS orientation 媒体查询依据的是「视口宽高比」，而非真实设备方向，
   *     移动端地址栏显示/收起、分屏、软键盘都会改变视口尺寸导致误判。
   *   - iOS Safari / 部分 Android 浏览器的 orientationchange 与视口更新
   *     不同步，媒体查询会出现短暂错误状态。
   *
   * 本模块融合三路信号（按可靠性优先级）：
   *   1. screen.orientation.type  —— 现代 API，优先使用
   *   2. window.orientation        —— 旧 API，iOS Safari / 老 Android 广泛支持
   *   3. innerWidth > innerHeight  —— 视口比例兜底
   *
   * 三重保障，保证任何设备/浏览器/旋转锁定状态下都能实时检测：
   *   a. 事件驱动：orientationchange / resize / screen.orientation.change /
   *      matchMedia / visibilitychange(pageshow) / visualViewport.resize
   *   b. 去抖复核：状态变化后 120ms 复核，兼容事件先于视口更新的浏览器
   *   c. 轮询兜底：每 500ms 轮询一次，即使所有事件都不触发
   *      （例如系统旋转锁定开启、某些 webview 不派发事件）
   *      —— 注意：系统级旋转锁定是 OS 行为，浏览器无法绕过，
   *      只要事件不触发，轮询也会读到真实方向并刷新。
   *
   * 检测结果通过给 <html> 切换 is-landscape / is-portrait class 同步给 CSS。
   * 打开 URL 追加 #dbg 可在真机看到诊断面板（三路信号 + 最终判定）。
   * ============================================================ */
  const Orientation = (function () {
    const html = document.documentElement;
    let current = null;    // 'landscape' | 'portrait'
    let timer = null;
    let lastSource = null; // 最近一次生效的信号源：'so' | 'wo' | 'vw'
    let eventCount = 0;    // 事件驱动触发次数
    let pollCount = 0;     // 轮询触发次数
    let lastUpdate = 0;    // 最近一次状态变化时间戳

    /** 判断是否横屏，并记录生效的信号源 */
    const detect = () => {
      /* 非移动端（桌面窄窗口）：screen.orientation.type 反映的是
         显示器物理方向（桌面恒为 landscape-primary），与窗口无关，
         必须改用视口比例判断。 */
      if (!html.classList.contains('is-mobile')) {
        lastSource = 'vw';
        return window.innerWidth > window.innerHeight;
      }
      // 信号 1：现代 Screen Orientation API
      let so = null;
      try { so = (window.screen && screen.orientation) ? screen.orientation : null; } catch (e) {}
      if (so && so.type) {
        if (so.type.indexOf('landscape') === 0) { lastSource = 'so'; return true; }
        if (so.type.indexOf('portrait') === 0) { lastSource = 'so'; return false; }
      }
      // 信号 2：旧版 window.orientation（0/180=竖屏，90/±270=横屏）
      if (typeof window.orientation === 'number') {
        const o = Math.abs(window.orientation) % 360;
        if (o === 90 || o === 270) { lastSource = 'wo'; return true; }
        if (o === 0 || o === 180) { lastSource = 'wo'; return false; }
      }
      // 信号 3：视口宽高比兜底
      lastSource = 'vw';
      return window.innerWidth > window.innerHeight;
    };

    /** 更新诊断面板（仅 #dbg 模式可见） */
    const updateDebug = (state) => {
      const panel = document.getElementById('dbg-panel');
      if (!panel) return;
      let soType = '-';
      try { soType = (screen.orientation && screen.orientation.type) || '-'; } catch (e) {}
      const wo = (typeof window.orientation === 'number') ? String(window.orientation) : '-';
      const src = { so: 'screen.orientation', wo: 'window.orientation', vw: '视口比例' }[lastSource] || lastSource;
      const mo = window.__tdMotion || {};
      panel.textContent =
        '方向诊断 | so.type=' + soType +
        ' | win.orient=' + wo +
        ' | 视口=' + window.innerWidth + 'x' + window.innerHeight +
        ' | 判定=' + state +
        ' | 信号源=' + src +
        ' | 倾斜=β' + (mo.beta === undefined ? '-' : mo.beta) + '/γ' + (mo.gamma === undefined ? '-' : mo.gamma) +
        ' | 横置=' + (html.classList.contains('is-held-landscape') ? '是' : '否') +
        ' | 朝向=' + (html.classList.contains('td-rot-ccw') ? '左边框' : '右边框') +
        ' | 校准=' + (manualFlip ? '左' : '右') +
        ' | 事件=' + eventCount + ' 轮询=' + pollCount +
        ' | 更新=' + lastUpdate;
    };

    /** 应用方向状态到 DOM class */
    const apply = () => {
      const landscape = detect();
      const state = landscape ? 'landscape' : 'portrait';
      if (state !== current) {
        current = state;
        lastUpdate = Date.now() % 100000;
        if (landscape) {
          html.classList.remove('is-portrait');
          html.classList.add('is-landscape');
        } else {
          html.classList.remove('is-landscape');
          html.classList.add('is-portrait');
        }
        // 对外暴露，便于调试 / 场景读取
        window.__deviceOrientation = state;
        window.__deviceOrientationSource = lastSource;
        // 视觉横屏：class 切换后通知 Phaser 重算画布（钩子稍后定义，需判空）
        if (typeof window.__tdOrientationChanged === 'function') {
          window.__tdOrientationChanged(state);
        }
      }
      updateDebug(state);
    };

    /** 事件驱动刷新（立即应用 + 120ms 复核，兼容视口滞后） */
    const schedule = () => {
      eventCount++;
      clearTimeout(timer);
      apply();
      timer = setTimeout(apply, 120);
    };

    // ---- 事件监听（覆盖所有方向相关信号源） ----
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('resize', schedule);
    if (window.matchMedia) {
      try {
        const mq = window.matchMedia('(orientation: landscape)');
        const handler = () => schedule();
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else if (mq.addListener) mq.addListener(handler);
      } catch (e) { /* 忽略 */ }
    }
    try {
      const so = (window.screen && screen.orientation) ? screen.orientation : null;
      if (so && so.addEventListener) so.addEventListener('change', schedule);
    } catch (e) { /* 忽略 */ }
    // 应用切换返回 / bfcache 恢复：Android 切后台再回来时方向可能已变
    try {
      document.addEventListener('visibilitychange', schedule);
      window.addEventListener('pageshow', schedule);
    } catch (e) { /* 忽略 */ }
    // iOS 动态地址栏（visualViewport 变化）
    try {
      if (window.visualViewport && visualViewport.addEventListener) {
        visualViewport.addEventListener('resize', schedule);
      }
    } catch (e) { /* 忽略 */ }

    // ---- 轮询兜底：即使所有事件都不触发也能检测方向变化 ----
    setInterval(() => { pollCount++; apply(); }, 500);

    // 初始检测
    apply();

    return {
      get isLandscape() { return detect(); },
      get state() { return current; }
    };
  })();

  /* ============================================================
   * 诊断模式：URL 追加 #dbg（如 https://…/?…&#dbg）
   * 给 <html> 加 has-dbg class，CSS 显示诊断面板。
   * ============================================================ */
  (function enableDebug() {
    try {
      const want = location.hash.indexOf('dbg') !== -1;
      if (want) {
        document.documentElement.classList.add('has-dbg');
        const panel = document.getElementById('dbg-panel');
        if (panel) panel.hidden = false;
      }
    } catch (e) { /* 忽略 */ }
  })();

  const world = TD_CONFIG.world;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#7cc24e',
    scale: {
      mode: Phaser.Scale.FIT,
      /* 居中交给 CSS flex（#game-container 内），禁用 Phaser 自带
         margin 居中——CSS 旋转容器中 canvasBounds 是旋转后的轴对齐框，
         Phaser 会算出错误的 margin 造成画面偏移 */
      autoCenter: Phaser.Scale.NONE,
      width: world.width,
      height: world.height,
      /* 立即响应窗口变化，不等待默认 500ms 轮询间隔，
         确保横竖屏切换时画布立刻重算尺寸 */
      resizeInterval: 0
    },
    render: {
      antialias: true,
      roundPixels: true,
      pixelArt: false
    },
    scene: [BootScene, LevelSelectScene, GameScene]
  });

  /* ============================================================
   * 真机横竖屏切换：移动浏览器的 orientationchange 在视口尺寸更新前触发，
   * Phaser 自动 resize 可能读到过期的父容器尺寸，导致画布错位。
   * 这里在方向变化后强制重排 + 延迟刷新 Phaser ScaleManager。
   * ============================================================ */
  let resizeTimer = null;
  /* 视觉横屏模式下的触摸坐标逆变换。
     CSS 旋转容器中 canvas.getBoundingClientRect() 返回轴对齐框，
     Phaser 默认的 pageX→canvas 映射会错位，导致旋转后触摸点不准确。
     这里覆盖 scale.transformX/Y，用【最近一次输入事件】的
     clientX/clientY 逆旋转还原为 canvas 布局坐标：
       cw  正变换 (cx,cy)=(LH-ly, lx)，逆 lx=cy, ly=LH-cx
       ccw 正变换 (cx,cy)=(ly, lx)，   逆 lx=cy, ly=cx
       游戏坐标 = (布局坐标 - canvas.offset*) × 世界/布局比例。

     为什么必须自己捕获坐标而不用 Phaser 的函数参数：
       Phaser 是【分别】调用 transformX(pageX) 与 transformY(pageY)
       的（各只有一个参数），但 CSS 旋转 90° 后游戏 X 来自视口 Y、
       游戏 Y 来自视口 X，单个参数无法同时拿到交叉轴坐标，
       因此在 capture 阶段记录完整的 (clientX,clientY)。

     为什么 pointer/touch/mouse 三类事件都要监听：
       - 现代浏览器：pointerdown 最先触发；
       - 旧版微信 X5/QQ 内核可能不派发 PointerEvent，只派发 touch*，
         只监听 pointer 会导致捕获值恒为 (0,0)，所有点击错位；
       - 桌面调试与跨内核兜底保留 mouse*。
       三类事件均在 capture 阶段记录，早于 Phaser 在目标上的处理。

     多触点对齐：Phaser 3 默认 activePointers=1，同一时刻只有一个
       活跃触摸 pointer，多余触点直接忽略；但一次 touchend/move 的
       changedTouches 可能同时含多根手指。若盲目取第 0/最后一个触点，
       可能选到被忽略的那根手指，坐标就串了。这里与 Phaser 的选择
       逻辑对齐：优先取 identifier === 当前活跃触摸 pointer 的触点；
       touchstart 时（pointer 尚未激活）取第一个新触点——Phaser 也是
       把第一个空闲触点分配给唯一的触摸 pointer。单指操作下二者等价，
       就是 changedTouches[0]。 */
  let inputRewired = false;
  let inputQueue = [{ x: 0, y: 0 }];
  try {
    const setPoint = (pt) => { inputQueue = [pt]; };
    const recordPointer = (e) => {
      if (typeof e.clientX === 'number') setPoint({ x: e.clientX, y: e.clientY });
    };
    const activeTouchId = () => {
      try {
        const ps = game.input.manager.pointers;
        for (let i = 1; i < ps.length; i++) {
          if (ps[i].active) return ps[i].identifier;
        }
      } catch (e) { /* 忽略 */ }
      return null;
    };
    const recordTouch = (e) => {
      const ts = e.changedTouches;
      if (!ts || !ts.length) return;
      let chosen = null;
      const aid = activeTouchId();
      if (aid !== null && aid !== undefined) {
        for (let i = 0; i < ts.length; i++) {
          if (ts[i].identifier === aid) { chosen = ts[i]; break; }
        }
      }
      if (!chosen) chosen = ts[0];
      setPoint({ x: chosen.clientX, y: chosen.clientY });
    };
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((evt) =>
      document.addEventListener(evt, recordPointer, true));
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((evt) =>
      document.addEventListener(evt, recordTouch, true));
    ['mousedown', 'mousemove', 'mouseup'].forEach((evt) =>
      document.addEventListener(evt, recordPointer, true));
  } catch (e) { /* 忽略 */ }

  const applyVisualLandscapeInput = () => {
    const htmlEl = document.documentElement;
    const app = document.getElementById('app');
    const rotated = app && htmlEl.classList.contains('is-mobile') &&
                    htmlEl.classList.contains('is-portrait');
    const scale = game.scale;
    if (!rotated) {
      if (inputRewired && scale._origTX) {
        scale.transformX = scale._origTX;
        scale.transformY = scale._origTY;
        inputRewired = false;
      }
      if (scale._origGPB) {
        scale.getParentBounds = scale._origGPB;
        scale._origGPB = null;
      }
      return;
    }
    if (!scale._origTX) {
      scale._origTX = scale.transformX;
      scale._origTY = scale.transformY;
    }
    /* 关键修复：视觉横屏旋转后，Phaser 的 getParentBounds 用
       getBoundingClientRect 度量的父容器是旋转后的轴对齐框
       （390x844 竖形），会把画布算成竖形错位。
       该函数协议：比较 parentSize 与度量值，变化则 setSize 并
       返回 true（触发 updateScale）。patch 后改用 offsetWidth/
       offsetHeight（布局尺寸，不受 transform 影响）。 */
    if (!scale._origGPB) {
      scale._origGPB = scale.getParentBounds;
      scale.getParentBounds = function () {
        const gc = document.getElementById('game-container');
        const t = this.parentSize;
        if (t.width !== gc.offsetWidth || t.height !== gc.offsetHeight) {
          t.setSize(gc.offsetWidth, gc.offsetHeight);
          return true;
        }
        return false;
      };
    }
    const canvas = game.canvas;
    /* 注意：默认 transformX/Y 返回世界坐标
       （(pageXY-canvasBounds位置) × displayScale），
       覆盖后必须同样乘世界比例才是游戏世界坐标。
       不能直接用 scale.displayScale：ScaleManager.refresh() 内部
       displayScale = baseSize / canvasBounds，而 canvasBounds 来自
       getBoundingClientRect——CSS 旋转 90° 后返回的是轴对齐包围盒
       （宽高互换），该值在视觉横屏态是错误的（如 960/390）。
       正确的等比比例 = 世界尺寸 / canvas 布局尺寸（clientWidth/
       Height 不受 transform 影响）；FIT 等比下二者相等。
       offset* / app 尺寸也在调用时动态读取，FIT 重算后下一次
       触摸自动使用新比例，旋转交换坐标后映射仍准确。 */
    const readDS = () => (canvas.clientWidth > 0 && canvas.clientHeight > 0)
      ? { x: scale.gameSize.width / canvas.clientWidth,
          y: scale.gameSize.height / canvas.clientHeight }
      : scale.displayScale;
    /* 捕获值即视口 client 坐标（pointer/touch/mouse 统一，已对齐
       Phaser 单触摸 pointer 的触点，队列恒为 1 项）。
       布局坐标（#app 未旋转系，尺寸 100dvh × 100dvw）：
       canvas 在 #app 内 flex 居中，offsetLeft/Top 即布局内偏移。
       每次调用动态读取比例，FIT 重算后下一次触摸自动使用新比例。 */
    const curPoint = () => inputQueue[0];
    if (htmlEl.classList.contains('td-rot-ccw')) {
      /* 听筒朝左校准：CSS 为 rotate(-90deg) translateX(-100dvh)，
         浏览器实测变换矩阵作用于 #app 布局点：
           (cx,cy) = (ly, LW-lx)，LW=#app 布局宽=视口高(offsetWidth)
         （注意 cy 含 LW-lx 翻转项——曾漏写成 cy=lx，导致此校准
          下所有触摸纵向镜像错位：点第1关命中第5关）
         逆：lx=LW-cy, ly=cx
           gameX=(LW-cy-OL)·s, gameY=(cx-OT)·s */
      scale.transformX = () =>
        (app.offsetWidth - curPoint().y - canvas.offsetLeft) * readDS().x;
      scale.transformY = () => (curPoint().x - canvas.offsetTop) * readDS().y;
    } else {
      /* 顺时针握持（听筒朝右）：正变换 (cx,cy)=(LH-ly, lx)，
         LH=#app 布局高=视口宽(offsetHeight)
         逆：lx=cy, ly=LH-cx → gameY=(LH-cx-OT)·s */
      scale.transformX = () => (curPoint().y - canvas.offsetLeft) * readDS().x;
      scale.transformY = () =>
        (app.offsetHeight - curPoint().x - canvas.offsetTop) * readDS().y;
    }
    inputRewired = true;
  };

  const forceRelayout = () => {
    // 强制浏览器重排，确保 #app / #game-container 已使用新视口尺寸
    void document.getElementById('app').offsetHeight;
    // 延迟刷新 Phaser，等待 iOS Safari 完成动态地址栏收起后的视口更新
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyVisualLandscapeInput();  // 先装好 parent-bounds patch，再刷新
      refreshPhaserUnrotated();
    }, 120);
  };

  /* 强制 Phaser 按新的父容器尺寸重算画布。
     关键：绝不能调用 game.scale.resize(w, h)——Phaser 3.80 的
     ScaleManager.resize 只有两个参数，会把 gameSize / baseSize /
     canvas 缓冲全部改成传入值（第 3、4 个参数即使传入也被忽略），
     即把设计世界 960x540 改成容器 CSS 尺寸（如 844x390）：按
     960x540 布局的选关卡片、底部提示因此被截断，世界比例非等比
     也会使触摸映射错位。
     正确流程是只重走 getParentBounds + refresh：FIT 模式下
     gameSize 始终保持 960x540，仅按父容器重算 canvas 的 CSS
     显示尺寸（等比缩放）。视觉横屏态 getParentBounds 已 patch
     为读 offsetWidth/Height（布局尺寸不受 rotate 影响）；切回
     非旋转态时已还原为原版（无 transform，getBoundingClientRect
     结果正确）。旋转态与非旋转态都调用，保证两条路径一致。 */
  const refreshPhaserUnrotated = () => {
    window.__tdRefreshCount = (window.__tdRefreshCount || 0) + 1;
    try {
      game.scale.getParentBounds();
      game.scale.refresh();
    } catch (e) { /* 忽略 */ }
  };

  /* ============================================================
   * 横置检测 + 画面方向锁定（始终朝向设备音量键一侧）
   *
   * 设计决策（2026-09-21）：画面方向【相对机身固定】，不随握持
   * 姿态、听筒朝左/朝右、γ 符号或传感器噪声翻转。音量键是机身上
   * 的固定锚点——锁竖屏 WebView 的视口表面就是机身坐标系：
   *   - manualFlip=false（默认）：rotate(90)，UI 顶部朝机身【右边框】
   *     （多数安卓机音量键位置）
   *   manualFlip=true：rotate(-90)，UI 顶部朝机身【左边框】
   *     （音量键在左侧的机型）
   * 校准值存 localStorage（tdRotFlip），UI 无翻转按钮；需切换时经
   * 调试入口写入后刷新。校准后无论手机怎么横置/转 180°/后仰/
   * 平放，UI 顶部永远指向音量键所在边框。
   *
   * 为什么不再用 γ 符号自动选方向：
   *   - 部分微信/QQ X5 内核 γ 符号与 W3C 标准相反，自动判定必然
   *     在一类设备上选错，与系统表面旋转叠加成 180° 全颠倒；
   *   - 即使标准设备，自动双向意味着用户换个方向横置画面就翻转，
   *     不符合"方向锁定"诉求；
   *   - γ 近水平时符号不可辨识，任何自动方案在平放过渡区都会抖动。
   *   γ 现在仅用于判断"是否已横置"（提示层显隐），不参与方向。
   *
   * 横置状态机（DeviceOrientation，解决平放横屏退出问题）：
   * - γ：绕设备长轴旋转角，垂直横置≈±90°，平放≈0°，横置后仰
   *   0~90° 全程 |γ|≈仰角
   * - β：平放屏幕朝上≈0°，竖持≈90°
   * - 进入横置：|γ|>12°（确保用户主动横置）
   * - 保持横置：|γ|>=8°，或 |γ|<8° 且 β<=45°（平放横屏）
   * - 退出横置：|γ|<8° 且 β>45°（明显竖持），或传感器 2s 无数据
   *
   * β 不可靠机型妥协：部分 X5 WebView 的 β 恒报 0，横置→竖持后
   *   无法自动退出提示层（W3C 规范下 γ/β 均无法区分），需重新
   *   横置一次"重置"。
   *
   * 平台边界：真横屏（非锁竖屏浏览器）由系统接管旋转，UI 始终朝
   *   物理上方且正向；Web 无法在非全屏下 lock 原生方向，故本锁定
   *   作用于视觉横屏（微信/QQ 等锁竖屏 WebView，本项目主场景）。
   * ============================================================ */
  let lastTiltState = null;
  let tiltTimer = null;

  /* 握持状态的唯一应用入口（单一状态源，避免事件回调与轮询各自写 class）：
     - 依据 window.__tdMotion（deviceorientation 回调只更新数据+时间戳）
     - 传感器数据超过 2 秒未更新视为失效（微信 X5 WebView 切后台/锁屏/
       权限收回时事件会停发），此时强制按「未横置」处理——
       解决「横放后切回竖屏，提示层不恢复」的残留状态问题。
     - 由 200ms 防抖（快速响应）和 500ms 轮询（兜底）共同驱动。 */
  const applyHeldState = () => {
    const m = window.__tdMotion;
    const fresh = !!(m && (Date.now() - m.t) < 2000);
    const g = fresh ? Math.abs(m.gamma) : 0;
    const b = fresh ? Math.abs(m.beta || 0) : 0;
    const htmlEl = document.documentElement;
    const wasHeld = htmlEl.classList.contains('is-held-landscape');
    /* 进入横置：|γ|>12°（迟滞带 8~12° 防止边界抖动）
       保持横置：|γ|>=8°，或 |γ|<8° 但 β<=45°（疑似平放横屏）
       退出横置：|γ|<8° 且 β>45°（明显竖持）
       —— β 用于区分平放横屏（β≈0）与竖持（β≈90） */
    let heldLandscape;
    if (wasHeld) {
      heldLandscape = fresh && (g >= 8 || b <= 45);
    } else {
      heldLandscape = fresh && g > 12;
    }
    /* 方向锁定：只看用户校准的 manualFlip，与 γ 符号完全无关——
       听筒朝左/朝右、X5 报告符号反相、近水平噪声都不会翻转画面，
       UI 顶部始终指向用户选定的边框（音量键侧）。 */
    const ccw = heldLandscape && manualFlip;
    if (wasHeld !== heldLandscape) {
      htmlEl.classList.toggle('is-held-landscape', heldLandscape);
    }
    if (ccw !== lastTiltState) {
      lastTiltState = ccw;
      htmlEl.classList.toggle('td-rot-ccw', ccw);
      applyVisualLandscapeInput();
    }
  };

  try {
    window.addEventListener('deviceorientation', (e) => {
      const betaNum = typeof e.beta === 'number' ? e.beta : 0;
      const gammaNum = typeof e.gamma === 'number' ? e.gamma : 0;
      if (typeof e.beta !== 'number' && typeof e.gamma !== 'number') return;
      window.__tdMotion = { beta: Math.round(betaNum), gamma: Math.round(gammaNum), t: Date.now() };
      clearTimeout(tiltTimer);
      tiltTimer = setTimeout(applyHeldState, 200);
    });
  } catch (e) { /* 忽略 */ }
  /* 轮询兜底：传感器事件停发（WebView 节流/切后台返回）时，
     靠新鲜度判定把 is-held-landscape 拉回 false，提示层恢复 */
  setInterval(applyHeldState, 500);
  try {
    document.addEventListener('visibilitychange', applyHeldState);
    window.addEventListener('pageshow', applyHeldState);
  } catch (e) { /* 忽略 */ }

  window.addEventListener('orientationchange', forceRelayout);
  window.addEventListener('resize', forceRelayout);
  if (window.screen && screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', forceRelayout);
  }
  /* 视觉横屏：is-portrait/is-landscape class 切换不会触发 window resize，
     Orientation 状态变化时手动调用，让 Phaser 重算旋转后的画布尺寸 */
  window.__tdOrientationChanged = () => { forceRelayout(); };
  /* 初始加载即处于视觉横屏时（如旋转锁定开启进入）重新度量画布并应用逆变换 */
  const initialLandscapeRefresh = () => {
    refreshPhaserUnrotated();
    applyVisualLandscapeInput();
  };
  if (document.readyState === 'complete') { initialLandscapeRefresh(); }
  else { window.addEventListener('load', initialLandscapeRefresh); }
  setTimeout(initialLandscapeRefresh, 400);

  /* ============================================================
   * 强制横屏：尝试通过 Screen Orientation API 锁定横屏。
   * 仅在支持的环境生效（Android Chrome 全屏模式），iOS Safari 不支持，
   * 此时由 CSS 竖屏遮罩提示用户旋转设备。
   * ============================================================ */
  const lockLandscape = () => {
    try {
      const so = screen.orientation;
      if (so && typeof so.lock === 'function') {
        so.lock('landscape').catch(() => { /* 静默失败，由 CSS 遮罩兜底 */ });
      }
    } catch (e) { /* 忽略 */ }
  };
  // 用户首次交互后尝试锁定（API 要求用户手势）
  document.addEventListener('pointerdown', lockLandscape, { once: true });
  document.addEventListener('keydown', lockLandscape, { once: true });

  /* 阻止双击缩放 / 手势缩放干扰（移动端） */
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
})();
