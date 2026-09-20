/* ============================================================
 * main.js —— Phaser 游戏启动入口
 * 设计分辨率 960x540（16:9 横屏），Scale.FIT 等比缩放：
 * 电脑窗口、手机横竖屏都会自动留边居中，配合 CSS 竖屏提示。
 * ============================================================ */
(function () {
  'use strict';

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

  /* 阻止双击缩放 / 手势缩放干扰（移动端） */
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
})();
