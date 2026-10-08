/* ============================================================
 * BootScene.js —— 用 Graphics 程序化生成“卡通占位贴图”
 * 圆润色块 + 描边 + 高光 + 眼睛，后续可整体替换为美术资源。
 * ============================================================ */
class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  /* 加载火元素塔（towerA）1/2/3 级美术图；加载失败不影响游戏，create 中做回退 */
  preload() {
    try {
      this.load.image('fire_tower_lv1_raw', 'assets/fire_tower_lv1.png');
      this.load.image('fire_tower_lv2_raw', 'assets/fire_tower_lv2.png');
      this.load.image('fire_tower_lv3_raw', 'assets/fire_tower_lv3.png');
    } catch (e) { /* 兜底：create 中会检测缺失并回退程序化炮头 */ }
  }

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

    /* ---------- 风元素塔风刃（旋风贴图，仅当配置引用 proj_wind 时生成） ----------
       三条旋臂 + 白芯，运行时由 Projectile 持续旋转形成旋风效果 */
    const needWind = Object.values(C.towers).some((t) => t.projectile && t.projectile.texture === 'proj_wind');
    if (needWind) {
      this.makeTexture('proj_wind', 24, 24, (g) => {
        for (let i = 0; i < 3; i++) {
          const a0 = (i / 3) * Math.PI * 2;
          /* 内层旋臂（风绿） */
          g.lineStyle(3.2, 0x7fe3a8, 1);
          g.beginPath();
          g.arc(12, 12, 5.5, a0, a0 + Math.PI * 0.75);
          g.strokePath();
          /* 外层旋臂（近白） */
          g.lineStyle(2.4, 0xeafff3, 0.95);
          g.beginPath();
          g.arc(12, 12, 8.5, a0 + 0.5, a0 + Math.PI * 0.6 + 0.5);
          g.strokePath();
        }
        g.fillStyle(0xffffff, 0.95);
        g.fillCircle(12, 12, 2.6);
      });
    }

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

    /* ---------- 火元素塔（towerA）1/2/3 级美术贴图：色度键抠图转透明 ----------
       lv1/lv3 绿幕（纯绿 #00ff00），lv2 白幕（纯白 #ffffff），纯色且与火焰
       颜色无重叠，用 canvas 像素级抠图 + 边缘去晕，结果存为 fire_tower_lvN。
       任何一步失败都会保留对应等级的程序化炮头回退，绝不影响游戏启动。 */
    try {
      const bgKeys = ['fire_tower_lv1_raw', 'fire_tower_lv2_raw', 'fire_tower_lv3_raw'];
      const bgs = ['green', 'white', 'green'];
      bgKeys.forEach((rawKey, i) => {
        const lv = i + 1;
        const outKey = 'fire_tower_lv' + lv;
        if (this.textures.exists(rawKey)) {
          this.chromaKeyTexture(rawKey, outKey, bgs[i]);
        }
      });
    } catch (e) { /* 抠图异常：忽略，Tower 端会回退到 turret_towerA 炮头 */ }

    /* ---------- 火元素弹幕贴图（3 级风格：小火苗 / 中火球 / 大火球） ----------
       外焰橙红 0xff5d1a、中焰橙黄 0xffa93b、内焰亮黄 0xffe76b，统一生成。 */
    this.makeTexture('proj_fire_lv1', 18, 18, (g) => {
      g.fillStyle(0xff5d1a, 1); g.fillCircle(9, 10, 7);
      g.fillStyle(0xffa93b, 1); g.fillCircle(9, 9.5, 5);
      g.fillStyle(0xffe76b, 1); g.fillCircle(9, 9, 2.6);
    });
    this.makeTexture('proj_fire_lv2', 24, 24, (g) => {
      g.fillStyle(0xff5d1a, 1); g.fillCircle(12, 13, 10);
      g.fillStyle(0xffa93b, 1); g.fillCircle(12, 12.5, 7);
      g.fillStyle(0xffe76b, 1); g.fillCircle(12, 12, 3.6);
    });
    this.makeTexture('proj_fire_lv3', 30, 30, (g) => {
      g.fillStyle(0xff5d1a, 1); g.fillCircle(15, 16, 13);
      g.fillStyle(0xffa93b, 1); g.fillCircle(15, 15.5, 9.5);
      g.fillStyle(0xffe76b, 1); g.fillCircle(15, 15, 5);
    });

    this.scene.start('LevelSelectScene');
  }

  /* 色度键抠图：把纯色背景（green/white）转透明，并做边缘去晕防白边/绿边；
     随后按 alpha 裁剪到内容包围盒，缩放到适中输出尺寸（192×192）。
     原图 1024×1024，内容包围盒可能 400~600px——直接作为纹理在 42~56px 显示
     时，WebGL LINEAR 缩小 8~14 倍且无 mipmap，会产生明显模糊。
     改为：先用浏览器 canvas 高质量平滑缩到 192px（Lanczos/bicubic），
     再作为 Phaser 纹理。192px → 42~56px 显示仅 3~4 倍缩小，LINEAR 清晰。 */
  chromaKeyTexture(rawKey, outKey, bg) {
    if (this.textures.exists(outKey)) this.textures.remove(outKey);
    const src = this.textures.get(rawKey).getSourceImage();
    const w = src.width, h = src.height;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d');
    ctx.drawImage(src, 0, 0);
    let img;
    try { img = ctx.getImageData(0, 0, w, h); } catch (e) { return; } // 跨域等异常：放弃抠图
    const d = img.data;
    const isGreen = bg === 'green';
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      let key; // 0=主体, 1=背景, 0~1=边缘混合度
      if (isGreen) {
        // 纯绿幕：绿分量远高于红蓝则视为背景；收紧过渡带（50→更硬边）
        const excess = g - Math.max(r, b);
        key = Phaser.Math.Clamp(excess / 50, 0, 1);
      } else {
        /* 纯白幕：RGB 最小分量足够接近 255 才算背景（m≥235 全透明，m≤165 全保留）。
           亮黄内焰 m≈107、橙红外焰 m≈20 均远低于 165，不会被误抠出洞；
           白边/白晕处于 165~235 之间，按键控值半透明 + 去白晕。 */
        const m = Math.min(r, g, b);
        key = Phaser.Math.Clamp((m - 165) / 70, 0, 1);
      }
      if (key >= 1) { d[i + 3] = 0; continue; }          // 纯背景 → 全透明
      if (key <= 0) { continue; }                        // 纯主体 → 保持
      // 边缘：反算去除背景色溢出（un-premultiply），再按键控值设 alpha
      const inv = 1 / (1 - key);
      if (isGreen) {
        d[i + 1] = Phaser.Math.Clamp((g - 255 * key) * inv, 0, 255);
      } else {
        d[i]     = Phaser.Math.Clamp((r - 255 * key) * inv, 0, 255);
        d[i + 1] = Phaser.Math.Clamp((g - 255 * key) * inv, 0, 255);
        d[i + 2] = Phaser.Math.Clamp((b - 255 * key) * inv, 0, 255);
      }
      d[i + 3] = Math.round(255 * (1 - key));
    }
    ctx.putImageData(img, 0, 0);

    /* 按 alpha>16 扫描内容包围盒（隔行隔列扫描提速），裁剪为居中正方形 */
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        if (d[(y * w + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return; // 全透明（抠图失败）：不生成纹理，Tower 端回退炮头
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    /* 输出纹理固定 256×256（2 的幂 → WebGL 可生成 mipmap，缩小清晰）；
       留 12% 边距给缩放动效余量，剩余区域高质量缩放 */
    const OUT = 256;
    const side = Math.ceil(Math.max(cw, ch) * 1.12); // 12% 边距
    const ct = this.textures.createCanvas(outKey, OUT, OUT);
    const cctx = ct.getContext();
    cctx.clearRect(0, 0, OUT, OUT);
    /* 开启浏览器高质量平滑（Lanczos/bicubic）缩放到 192px */
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    const drawW = Math.round(OUT * (cw / side));
    const drawH = Math.round(OUT * (ch / side));
    cctx.drawImage(off, minX, minY, cw, ch,
      Math.round((OUT - drawW) / 2), Math.round((OUT - drawH) / 2), drawW, drawH);
    ct.refresh();
  }

  /* 小工具：在一张临时 Graphics 上绘制并生成纹理 */
  makeTexture(key, w, h, drawFn) {
    const g = this.add.graphics();
    drawFn(g);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
