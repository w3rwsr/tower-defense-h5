/* ============================================================
 * main.js —— Phaser 游戏启动入口
 * 设计分辨率 960x540（16:9 横屏），Scale.FIT 等比缩放：
 * 电脑窗口、手机横竖屏都会自动留边居中，配合 CSS 竖屏提示。
 * ============================================================ */
(function () {
  'use strict';

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
   * 检测结果通过给 <html> 切换 is-landscape / is-portrait class 同步给 CSS，
   * 保证检测与样式解耦、跨浏览器一致。
   * ============================================================ */
  const Orientation = (function () {
    const html = document.documentElement;
    let current = null;   // 'landscape' | 'portrait'
    let timer = null;

    /** 判断是否横屏（融合三路信号） */
    const detectLandscape = () => {
      // 信号 1：现代 Screen Orientation API
      const so = (window.screen && screen.orientation) ? screen.orientation : null;
      if (so && so.type) {
        if (so.type.indexOf('landscape') === 0) return true;
        if (so.type.indexOf('portrait') === 0) return false;
      }
      // 信号 2：旧版 window.orientation（0/180=竖屏，90/270=横屏）
      if (typeof window.orientation === 'number') {
        const o = Math.abs(window.orientation);
        if (o === 90 || o === 270) return true;
        if (o === 0 || o === 180) return false;
      }
      // 信号 3：视口宽高比兜底
      return window.innerWidth > window.innerHeight;
    };

    /** 应用方向状态到 DOM class */
    const apply = () => {
      const landscape = detectLandscape();
      const state = landscape ? 'landscape' : 'portrait';
      if (state === current) return;
      current = state;
      if (landscape) {
        html.classList.remove('is-portrait');
        html.classList.add('is-landscape');
      } else {
        html.classList.remove('is-landscape');
        html.classList.add('is-portrait');
      }
      // 对外暴露，便于调试 / 场景读取
      window.__deviceOrientation = state;
    };

    /** 去抖刷新（地址栏动画会连续触发 resize，去抖避免闪烁） */
    const schedule = () => {
      clearTimeout(timer);
      // 立即应用一次，再延迟 100ms 复核（兼容 orientationchange 后视口滞后）
      apply();
      timer = setTimeout(apply, 120);
    };

    // 监听所有方向相关事件
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('resize', schedule);
    if (window.matchMedia) {
      // CSS 媒体查询作为补充信号源
      try {
        const mq = window.matchMedia('(orientation: landscape)');
        const handler = () => schedule();
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else if (mq.addListener) mq.addListener(handler);
      } catch (e) { /* 忽略 */ }
    }
    // Screen Orientation API 的 change 事件
    try {
      const so2 = (window.screen && screen.orientation) ? screen.orientation : null;
      if (so2 && so2.addEventListener) so2.addEventListener('change', schedule);
    } catch (e) { /* 忽略 */ }

    // 初始检测
    schedule();

    return { get isLandscape() { return detectLandscape(); } };
  })();

  const world = TD_CONFIG.world;

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#7cc24e',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
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
  const forceRelayout = () => {
    // 强制浏览器重排，确保 #app / #game-container 已使用新视口尺寸
    void document.getElementById('app').offsetHeight;
    // 延迟刷新 Phaser，等待 iOS Safari 完成动态地址栏收起后的视口更新
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      try { game.scale.refresh(); } catch (e) {}
    }, 120);
  };
  window.addEventListener('orientationchange', forceRelayout);
  window.addEventListener('resize', forceRelayout);
  if (window.screen && screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener('change', forceRelayout);
  }

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
