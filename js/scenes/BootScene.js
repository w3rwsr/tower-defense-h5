/* ============================================================
 * BootScene.js —— 用 Graphics 程序化生成“卡通占位贴图”
 * 圆润色块 + 描边 + 高光 + 眼睛，后续可整体替换为美术资源。
 * ============================================================ */
class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  create() {
    const C = TD_CONFIG;

    /* ---------- 塔底座阴影（所有塔共用） ---------- */
    this.makeTexture('tower_base', 64, 64, (g) => {
      g.fillStyle(0x000000, 0.18);
      g.fillEllipse(32, 42, 48, 20);
    });

    /* ---------- 三种塔的炮头（64x64，炮口朝右，运行时旋转） ---------- */
    Object.keys(C.towers).forEach((key) => {
      const t = C.towers[key];
      this.makeTexture('turret_' + key, 64, 64, (g) => {
        // 炮管
        g.fillStyle(t.darkColor, 1);
        g.fillRoundedRect(30, 26, 30, 12, 6);
        // 脑袋
        g.fillStyle(t.color, 1);
        g.fillCircle(32, 32, 20);
        g.lineStyle(3, t.darkColor, 1);
        g.strokeCircle(32, 32, 20);
        // 高光
        g.fillStyle(0xffffff, 0.35);
        g.fillCircle(26, 26, 7);
        // 卡通眼睛（朝炮口方向看）
        g.fillStyle(0xffffff, 1);
        g.fillCircle(36, 29, 4.2);
        g.fillCircle(36, 37, 4.2);
        g.fillStyle(0x2b2230, 1);
        g.fillCircle(37.5, 29, 2.1);
        g.fillCircle(37.5, 37, 2.1);
      });
    });

    /* ---------- 敌人 ---------- */
    Object.keys(C.enemies).forEach((key) => {
      const e = C.enemies[key];
      const size = e.radius * 2 + 12;
      const c = size / 2;
      this.makeTexture('enemy_' + key, size, size, (g) => {
        // 敌人Y（大胖子）头顶两只小角
        if (key === 'enemyY') {
          g.fillStyle(e.darkColor, 1);
          g.fillTriangle(c - 11, c - e.radius + 5, c - 5, c - e.radius - 9, c - 1, c - e.radius + 4);
          g.fillTriangle(c + 11, c - e.radius + 5, c + 5, c - e.radius - 9, c + 1, c - e.radius + 4);
        }
        // BOSS 头顶金皇冠（5 齿 + 底座），与大体型/粗血条一起作视觉区分
        if (key === 'enemyBoss') {
          const cy = c - e.radius - 8;
          g.fillStyle(0xffd84a, 1);
          for (let i = -2; i <= 2; i++) {
            g.fillTriangle(c + i * 8 - 4, cy + 9, c + i * 8 + 4, cy + 9, c + i * 8, cy);
          }
          g.fillStyle(0xe8b421, 1);
          g.fillRoundedRect(c - 20, cy + 6, 40, 6, 2);
        }
        // 身体
        g.fillStyle(e.color, 1);
        g.fillCircle(c, c, e.radius);
        g.lineStyle(3, e.darkColor, 1);
        g.strokeCircle(c, c, e.radius);
        // 高光
        g.fillStyle(0xffffff, 0.30);
        g.fillCircle(c - e.radius * 0.35, c - e.radius * 0.35, e.radius * 0.28);
        // 眼睛
        const eyeR = Math.max(3, e.radius * 0.22);
        const off = e.radius * 0.38;
        g.fillStyle(0xffffff, 1);
        g.fillCircle(c - off, c - 2, eyeR);
        g.fillCircle(c + off, c - 2, eyeR);
        g.fillStyle(0x2b2230, 1);
        g.fillCircle(c - off + 1, c - 1, eyeR * 0.5);
        g.fillCircle(c + off + 1, c - 1, eyeR * 0.5);
      });
    });

    /* ---------- 弹道（按颜色生成，圆弹 + 白芯） ---------- */
    const projColors = new Set();
    Object.values(C.towers).forEach((t) => { if (t.projectile) projColors.add(t.projectile.color); });
    projColors.forEach((color) => {
      const key = 'proj_' + color.toString(16);
      this.makeTexture(key, 20, 20, (g) => {
        g.fillStyle(0x000000, 0.15);
        g.fillCircle(10, 11, 8);
        g.fillStyle(color, 1);
        g.fillCircle(10, 9, 7);
        g.fillStyle(0xffffff, 0.75);
        g.fillCircle(8, 7, 2.6);
      });
    });

    /* ---------- 地面装饰（灌木 / 小花 / 石头） ---------- */
    this.makeTexture('decor_bush', 36, 30, (g) => {
      g.fillStyle(0x4f9e38, 1);
      g.fillCircle(9, 19, 8); g.fillCircle(19, 15, 10); g.fillCircle(28, 19, 8);
      g.fillStyle(0x66bd47, 1);
      g.fillCircle(15, 15, 5); g.fillCircle(23, 12, 5);
    });
    this.makeTexture('decor_flower', 18, 18, (g) => {
      g.fillStyle(0xff8fb1, 1);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        g.fillCircle(9 + Math.cos(a) * 4.5, 9 + Math.sin(a) * 4.5, 3.2);
      }
      g.fillStyle(0xffd84a, 1);
      g.fillCircle(9, 9, 3);
    });
    this.makeTexture('decor_rock', 28, 22, (g) => {
      g.fillStyle(0x9e9e9e, 1);
      g.fillEllipse(14, 12, 24, 16);
      g.fillStyle(0xbdbdbd, 1);
      g.fillEllipse(10, 9, 10, 6);
    });

    /* ---------- 障碍物（放塔无效区：石头 / 树木 / 木桶，可被塔摧毁） ---------- */
    this.makeTexture('obst_rock', 52, 42, (g) => {
      g.fillStyle(0x000000, 0.15);
      g.fillEllipse(26, 36, 40, 10);
      g.fillStyle(0x8f9aa3, 1);
      g.fillRoundedRect(6, 8, 40, 30, 14);
      g.fillStyle(0xaab6bf, 1);
      g.fillRoundedRect(10, 6, 26, 18, 9);
      g.fillStyle(0xffffff, 0.4);
      g.fillEllipse(18, 13, 10, 5);
      g.fillStyle(0x6f7a83, 1);
      g.fillCircle(34, 28, 3); g.fillCircle(22, 30, 2.4);
    });
    this.makeTexture('obst_tree', 56, 64, (g) => {
      g.fillStyle(0x000000, 0.15);
      g.fillEllipse(28, 58, 34, 9);
      g.fillStyle(0x8a5a2b, 1);                       // 树干
      g.fillRoundedRect(23, 34, 10, 24, 4);
      g.fillStyle(0x3e8f2f, 1);                       // 树冠三层
      g.fillCircle(28, 20, 19);
      g.fillCircle(15, 30, 12); g.fillCircle(41, 30, 12);
      g.fillStyle(0x55b044, 1);
      g.fillCircle(24, 15, 10); g.fillCircle(36, 22, 8);
      g.fillStyle(0xffffff, 0.3);
      g.fillCircle(20, 11, 4.5);
      g.fillStyle(0xd8453e, 1);                       // 两颗小果子
      g.fillCircle(18, 26, 2.6); g.fillCircle(37, 17, 2.6);
    });
    this.makeTexture('obst_barrel', 42, 50, (g) => {
      g.fillStyle(0x000000, 0.15);
      g.fillEllipse(21, 45, 32, 8);
      g.fillStyle(0xa9713a, 1);                       // 桶身
      g.fillRoundedRect(5, 6, 32, 40, 10);
      g.fillStyle(0xc08a4d, 1);
      g.fillRoundedRect(8, 8, 26, 14, 7);
      g.lineStyle(3, 0x7a4d20, 1);                    // 两道铁箍
      g.lineBetween(5, 17, 37, 17); g.lineBetween(5, 36, 37, 36);
      g.fillStyle(0x8a5a2b, 1);                       // 桶口
      g.fillEllipse(21, 8, 24, 7);
    });

    this.scene.start('LevelSelectScene');
  }

  /* 小工具：在一张临时 Graphics 上绘制并生成纹理 */
  makeTexture(key, w, h, drawFn) {
    const g = this.add.graphics();
    drawFn(g);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
