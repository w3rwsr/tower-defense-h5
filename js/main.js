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
        ' | 握持=' + (html.classList.contains('td-rot-ccw') ? '听筒左' : '听筒右') +
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
     这里覆盖 scale.transformX/Y，用最近一次的 clientX/clientY
     （capture 阶段记录）逆旋转还原为 canvas 物理坐标：
       正变换（CSS translateY(dvh) rotate(90deg) 顺时针，appW=布局宽=dvh）：
         (lx,ly) → (ly, appW-lx)
       逆变换（视觉 → 布局）：
         lx = appW - clientY,  ly = clientX
       canvas 内坐标 = (lx - offsetLeft, ly - offsetTop)。 */
  let lastPointerX = 0, lastPointerY = 0, inputRewired = false;
  try {
    document.addEventListener('pointerdown', (e) => { lastPointerX = e.clientX; lastPointerY = e.clientY; }, true);
    document.addEventListener('pointermove', (e) => { lastPointerX = e.clientX; lastPointerY = e.clientY; }, true);
    document.addEventListener('pointerup', (e) => { lastPointerX = e.clientX; lastPointerY = e.clientY; }, true);
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
    const ccw = htmlEl.classList.contains('td-rot-ccw');
    /* 注意：默认 transformX/Y 返回世界坐标
       （(pageXY-canvasBounds位置) × displayScale），
       覆盖后必须同样乘 displayScale 才是游戏世界坐标。 */
    const dsx = scale.displayScale.x, dsy = scale.displayScale.y;
    if (ccw) {
      /* 逆时针握持（听筒朝左）：正变换 (vx,vy)=(ly,lx)
         逆：lx=vy, ly=vx */
      scale.transformX = () => (lastPointerY - canvas.offsetLeft) * dsx;
      scale.transformY = () => (lastPointerX - canvas.offsetTop) * dsy;
    } else {
      /* 顺时针握持（听筒朝右）：正变换 (vx,vy)=(VW-ly, lx)，
         VW=视口宽=app 布局高(offsetHeight)
         逆：ly=VW-vx, lx=vy */
      scale.transformX = () => (lastPointerY - canvas.offsetLeft) * dsx;
      scale.transformY = () => (app.offsetHeight - lastPointerX - canvas.offsetTop) * dsy;
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

  /* 强制 Phaser 按正确尺寸重算画布（getParentBounds 已 patch，
     无需再切换 transform）。resize() 触发 FIT 重算画布尺寸，
     refresh() 重算边界。 */
  const refreshPhaserUnrotated = () => {
    window.__tdRefreshCount = (window.__tdRefreshCount || 0) + 1;
    const htmlEl = document.documentElement;
    const app = document.getElementById('app');
    const rotated = app && htmlEl.classList.contains('is-mobile') &&
                    htmlEl.classList.contains('is-portrait');
    try {
      if (rotated) {
        const gc = document.getElementById('game-container');
        game.scale.resize(gc.offsetWidth, gc.offsetHeight, gc.offsetWidth, gc.offsetHeight);
      }
      game.scale.refresh();
    } catch (e) { /* 忽略 */ }
  };

  /* ============================================================
   * 双方向握持自适应：用加速度计（DeviceOrientation）判断
   * 用户是听筒朝右还是朝左横放，切换对应旋转方向，
   * 两种拿法画面都正向。不可用（iOS 未授权/不支持）时
   * 保持默认顺时针（听筒朝右）。
   * beta 符号映射（绕屏幕内向右的水平轴旋转）：
   *   beta 明显为正 → 听筒朝左（逆时针拿）→ td-rot-ccw
   *   beta 明显为负 → 听筒朝右（顺时针拿）→ 默认方向
   * 该映射若在真机出现反相，可通过 #dbg 面板观察 beta 值校正。
   * ============================================================ */
  let lastTiltState = null;
  let tiltTimer = null;
  try {
    window.addEventListener('deviceorientation', (e) => {
      if (typeof e.beta !== 'number' || e.beta === null) return;
      window.__tdMotion = { beta: Math.round(e.beta), gamma: Math.round(e.gamma) };
      clearTimeout(tiltTimer);
      tiltTimer = setTimeout(() => {
        const portraitTilt = Math.abs(e.beta) < 55; // 接近竖直：竖屏拿法，无握持方向
        let ccw = false;
        if (!portraitTilt) ccw = e.beta > 0; // 横放：按 beta 符号定方向（见上方注释）
        if (ccw !== lastTiltState) {
          lastTiltState = ccw;
          document.documentElement.classList.toggle('td-rot-ccw', ccw);
          applyVisualLandscapeInput();
        }
      }, 200);
    });
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
