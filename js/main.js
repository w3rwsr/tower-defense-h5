/* ============================================================
 * main.js —— Phaser 游戏启动入口
 * 设计分辨率 960x540（16:9 横屏），Scale.FIT 等比缩放：
 * 电脑窗口、手机横竖屏都会自动留边居中，配合 CSS 竖屏提示。
 * ============================================================ */
(function () {
  'use strict';

  const world = TD_CONFIG.world;

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#7cc24e',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: world.width,
      height: world.height
    },
    render: {
      antialias: true,        /* 形状边缘平滑，避免锯齿 */
      roundPixels: true,      /* 文字/精灵坐标对齐整像素，杜绝亚像素模糊 */
      pixelArt: false         /* 非像素风，保留矢量平滑 */
    },
    scene: [BootScene, LevelSelectScene, GameScene]
  });

  /* 阻止双击缩放 / 手势缩放干扰（移动端） */
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
})();
