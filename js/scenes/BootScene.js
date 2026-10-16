/* ============================================================
 * BootScene.js —— 用 Graphics 程序化生成“卡通占位贴图”
 * 圆润色块 + 描边 + 高光 + 眼睛，后续可整体替换为美术资源。
 * ============================================================ */
class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }

  /* 加载火元素塔（towerA）1/2/3 级美术图；加载失败不影响游戏，create 中做回退。
     FireTowerArtData.js 内嵌离线抠图 data URI 时跳过原图加载（file:// 下本地
     图片无法上传 WebGL、getImageData 也被禁，运行时抠图路径不可用）。 */
  preload() {
    if (typeof FIRE_TOWER_ART !== 'undefined' && FIRE_TOWER_ART) return;
    try {
      this.load.image('fire_tower_lv1_raw', 'assets/fire_tower_lv1.png');
      this.load.image('fire_tower_lv2_raw', 'assets/fire_tower_lv2.png');
      this.load.image('fire_tower_lv3_raw', 'assets/fire_tower_lv3.png');
    } catch (e) { /* 兜底：create 中会检测缺失并回退程序化炮头 */ }
  }

  create() {
    /* DPR 适配：主相机按设备像素比缩放（gameSize 已为 960*dpr，
       缩放后相机视野保持 960x540 逻辑世界；详见 main.js TD_DPR）。
       Phaser 相机 zoom 以【视野中心】为锚点：zoom 后 scroll=(0,0)
       会让 960x540 世界偏移到画面左上外侧，必须用 centerOn 把视野
       中心重新对回世界中心 (480,270)。centerOn 按相机像素宽高求
       scroll，dpr=1 时 scroll 恰为 0（=旧行为）。
       必须放在 create 第一行：本场景生成的纹理虽不按坐标定位，
       但保证任意时刻相机矩阵都已就绪，不出现半帧错位。 */
    const dpr0 = window.__TD_DPR || 1;
    this.cameras.main.setZoom(dpr0);
    this.cameras.main.centerOn(TD_CONFIG.world.width / 2, TD_CONFIG.world.height / 2);

    /* Phaser 就绪：移除 index.html 的启动加载提示层（仅启动时执行一次，
       本场景不会重进，无重复移除问题）；同时清除加载失败自动重试计数
       （index.html 启动守护用 sessionStorage.__tdBootRetry 限制重试 ≤2 次） */
    try {
      window.__tdBootOK = true;
      try { sessionStorage.removeItem('__tdBootRetry'); } catch (e2) { /* 隐私模式忽略 */ }
      const bl = document.getElementById('boot-loading');
      if (bl && bl.parentNode) bl.parentNode.removeChild(bl);
    } catch (e) { /* 忽略：提示层缺失不影响游戏 */ }

    const C = TD_CONFIG;

    /* 火塔燃烧视频（全局共享解码器；不支持/加载失败时自动降级静态贴图，
       任何异常都不阻断启动） */
    try { FIRE_BURN.init(this); } catch (e) { /* 忽略：Tower 端静态兜底 */ }

    /* 风塔/史莱姆/BOSS 三个运动视频（wind_towers/slime_walk/boss_walk.mp4，
       合计 ~8.4MB）【不在启动时加载】——移动端弱网下它们会抢占首屏带宽、
       拖长选关页出现时间。改为进入选关页后由 LevelSelectScene 延迟错峰
       后台加载（见 LevelSelectScene.create 的 _deferredVideoInit）；
       加载期间/不支持时 supported=false，Tower/Enemy 端回退静态贴图，
       视频就绪后通过 whenReady 回调自动接管，功能观感均不受影响。 */
    /* BOSS 死亡视频（BossVideo.js）：init 只做支持性检测不下载视频；
       死亡视频按 Boss 出场懒加载（prewarm），不拖慢启动。 */
    try { BOSS_DEATH.init(this); } catch (e) { /* 忽略：Enemy 端降级兜底 */ }

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
      /* enemies 下除小怪/BOSS 外还有 slimeVideo 等非实体配置项，跳过（无 radius） */
      if (!e || typeof e.radius !== 'number') return;
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

    /* ---------- 终点城堡大门（圆润卡通 / 扁平 / 明亮，与草地+土路地图同色系） ----------
       120x128，显示时 origin(0.5,1) 钉在终点绘制位置。两侧圆塔 + 粉色尖顶+小旗，
       中央城垛墙 + 圆拱木门（双扇/木板纹/金把手）。撞击闪白光用同名白色 tint 副本。 */
    this.makeTexture('castle_gate', 120, 128, (g) => {
      /* 脚下软阴影 */
      g.fillStyle(0x000000, 0.15);
      g.fillEllipse(60, 124, 84, 10);
      /* 两侧圆塔塔身（奶油石色） */
      const tower = (tx) => {
        g.fillStyle(0xf4e6c8, 1);
        g.fillRoundedRect(tx, 44, 26, 80, 9);
        g.lineStyle(2.5, 0xc8a86e, 1);
        g.strokeRoundedRect(tx, 44, 26, 80, 9);
        /* 粉色锥形塔顶 */
        g.fillStyle(0xe8789c, 1);
        g.fillTriangle(tx - 3, 48, tx + 13, 16, tx + 29, 48);
        g.lineStyle(2.5, 0xbf5279, 1);
        g.lineBetween(tx - 3, 48, tx + 13, 16);
        g.lineBetween(tx + 13, 16, tx + 29, 48);
        /* 塔顶小金球 + 小旗 */
        g.fillStyle(0xffd24a, 1);
        g.fillCircle(tx + 13, 14, 3);
        g.lineStyle(1.6, 0x8a5a2b, 1);
        g.lineBetween(tx + 13, 14, tx + 13, 2);
        g.fillStyle(0xff8fb1, 1);
        g.fillTriangle(tx + 13, 3, tx + 25, 6, tx + 13, 10);
        /* 塔身小窗 + 高光 */
        g.fillStyle(0xb88a52, 1);
        g.fillRoundedRect(tx + 9, 62, 8, 11, 4);
        g.fillStyle(0xffffff, 0.35);
        g.fillEllipse(tx + 7, 54, 5, 8);
      };
      tower(8);
      tower(86);
      /* 中央城墙（城垛） */
      g.fillStyle(0xf7ecd2, 1);
      g.fillRoundedRect(26, 58, 68, 66, 7);
      g.lineStyle(2.5, 0xc8a86e, 1);
      g.strokeRoundedRect(26, 58, 68, 66, 7);
      for (let i = 0; i < 3; i++) {
        g.fillStyle(0xf7ecd2, 1);
        g.fillRoundedRect(31 + i * 21, 49, 14, 12, 3);
        g.lineStyle(2, 0xc8a86e, 1);
        g.strokeRoundedRect(31 + i * 21, 49, 14, 12, 3);
      }
      /* 圆拱门框（浅石色描边环） */
      g.fillStyle(0xd9b98a, 1);
      g.fillRoundedRect(33, 56, 54, 68, 26);
      /* 木门双扇 */
      g.fillStyle(0xa56132, 1);
      g.fillRoundedRect(38, 61, 44, 63, 21);
      g.lineStyle(2.5, 0x6e3d1c, 1);
      g.strokeRoundedRect(38, 61, 44, 63, 21);
      /* 中缝 + 每扇两道木板纹 */
      g.lineStyle(2, 0x7d4722, 1);
      g.lineBetween(60, 66, 60, 124);
      g.lineStyle(1.4, 0x8a5228, 0.8);
      g.lineBetween(49, 72, 49, 120);
      g.lineBetween(53.5, 74, 53.5, 118);
      g.lineBetween(66.5, 74, 66.5, 118);
      g.lineBetween(71, 72, 71, 120);
      /* 横向木纹节疤 */
      g.lineStyle(1.2, 0x8a5228, 0.7);
      g.lineBetween(42, 92, 56, 92);
      g.lineBetween(64, 100, 78, 100);
      /* 金色门把手 */
      g.fillStyle(0xffd24a, 1);
      g.fillCircle(55, 98, 3.2); g.fillCircle(65, 98, 3.2);
      g.lineStyle(1.2, 0xb8860f, 1);
      g.strokeCircle(55, 98, 3.2); g.strokeCircle(65, 98, 3.2);
      /* 墙面高光点 */
      g.fillStyle(0xffffff, 0.4);
      g.fillEllipse(36, 70, 6, 9);
      g.fillEllipse(84, 70, 6, 9);
    });

    /* ---------- 血量牌小爱心（门旁血量显示用，红色心形 + 左上高光） ---------- */
    this.makeTexture('heart_icon', 20, 18, (g) => {
      g.fillStyle(0xff5d6e, 1);
      g.fillCircle(7, 7, 5.5);
      g.fillCircle(13, 7, 5.5);
      g.fillTriangle(2.2, 9, 17.8, 9, 10, 17);
      g.lineStyle(1.6, 0xd33b4d, 1);
      g.strokeCircle(7, 7, 5.5);
      g.strokeCircle(13, 7, 5.5);
      g.fillStyle(0xffffff, 0.55);
      g.fillCircle(5.5, 5, 1.7);
    });

    /* ---------- 火元素塔（towerA）1/2/3 级美术贴图 ----------
       优先 FireTowerArtData.js：离线已按同一算法抠图的 data URI（同源干净，
       file:// 也可上传 WebGL），异步解码完成后注册纹理。注意此处只登记异步
       任务、不提前 return——后续 proj_fire/fire_dot 贴图仍需同步创建，
       仅场景跳转延迟到贴图就绪（或超时兜底）。无数据模块时回退原路径：
       加载原图 + 运行时色度键抠图（仅 http:// 等可读画布环境可用）。 */
    const hasArtData = (typeof FIRE_TOWER_ART !== 'undefined') && FIRE_TOWER_ART;
    let artJobs = null;
    if (hasArtData) {
      artJobs = [];
      [1, 2, 3].forEach((lv) => {
        const durl = FIRE_TOWER_ART[lv];
        if (!durl) return;
        const key = 'fire_tower_lv' + lv;
        artJobs.push(new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              if (this.textures.exists(key)) this.textures.remove(key);
              this.textures.addImage(key, img);
              resolve(true);
            } catch (e) { resolve(false); }
          };
          img.onerror = () => resolve(false);
          img.src = durl;
        }));
      });
      if (!artJobs.length) artJobs = null;
    }
    if (!artJobs) {
      try {
        const bgKeys = ['fire_tower_lv1_raw', 'fire_tower_lv2_raw', 'fire_tower_lv3_raw'];
        const bgs = ['green', 'white', 'green'];
        bgKeys.forEach((rawKey, i) => {
          const lv = i + 1;
          const outKey = 'fire_tower_lv' + lv;
          if (this.textures.exists(rawKey)) {
            /* 输出尺寸 = 显示尺寸(42/48/56) × 4 超采样：运行时最多 1:1 或轻
               微缩小，配合 LINEAR 采样保证清晰（不再用 256 固定输出） */
            this.chromaKeyTexture(rawKey, outKey, bgs[i], [168, 192, 224][i]);
          }
        });
      } catch (e) { /* 抠图异常：忽略，Tower 端会回退到 turret_towerA 炮头 */ }
    }

    /* ---------- 火元素弹幕贴图（3 级：方向性火苗，尖端朝右 +x） ----------
       外焰橙红 0xff5d1a、中焰橙黄 0xffa93b、内焰亮黄 0xffe76b；
       头部为圆球在右，尾部向左收窄——运行时 rotation=atan2(dy,dx) 朝向目标。 */
    const drawFireProj = (g, w, h) => {
      const cy = h / 2, hr = h * 0.36;           // 头部半径
      const hx = w - hr - 1;                     // 头部圆心 x
      g.fillStyle(0xff5d1a, 1);                  // 外焰：左收窄椭圆 + 头圆
      g.fillEllipse(w * 0.32, cy, w * 0.62, h * 0.74);
      g.fillCircle(hx, cy, hr);
      g.fillStyle(0xffa93b, 1);                  // 中焰
      g.fillEllipse(w * 0.40, cy, w * 0.44, h * 0.5);
      g.fillCircle(hx, cy, hr * 0.72);
      g.fillStyle(0xffe76b, 1);                  // 内焰亮芯
      g.fillEllipse(w * 0.50, cy, w * 0.26, h * 0.3);
      g.fillCircle(hx + hr * 0.1, cy, hr * 0.42);
    };
    /* DPR 高清：按 DPR 上限 2x 超采样烘焙（矢量绘制天然无损），
       显示端 setScale 同步除 2，屏显尺寸与旧版完全一致、清晰度翻倍。
       生产路径熔岩弹 ArtData(68px) 会以同名 key 覆盖本纹理，不受影响 */
    this.makeTexture('proj_fire_lv1', 52, 36, (g) => drawFireProj(g, 52, 36));
    this.makeTexture('proj_fire_lv2', 68, 44, (g) => drawFireProj(g, 68, 44));
    this.makeTexture('proj_fire_lv3', 88, 56, (g) => drawFireProj(g, 88, 56));
    /* 圆形小火点：火焰粒子（塔身火星 / 弹幕拖尾）专用，无方向性 */
    this.makeTexture('fire_dot', 16, 16, (g) => {
      g.fillStyle(0xffa93b, 1); g.fillCircle(8, 8, 6.8);
      g.fillStyle(0xffe76b, 1); g.fillCircle(8, 8, 3.4);
    });
    /* 圆形冰点：冰弹粒子拖尾专用，外冰蓝 0x9fdcff、内白，运行时可再 tint。
       同 fire_dot：16px 2x 超采样，消费端粒子 scale 已同步减半 */
    this.makeTexture('ice_dot', 16, 16, (g) => {
      g.fillStyle(0x9fdcff, 1); g.fillCircle(8, 8, 6.8);
      g.fillStyle(0xffffff, 1); g.fillCircle(8, 8, 3.6);
    });
    /* 冰弹渐变光带：横向 40×8，右侧（起点 x=40）亮、向左渐隐为透明；
       使用时 origin(1,0.5) 钉在弹体中心，向弹尾方向延伸并按等级缩放 */
    this.makeTexture('ice_ribbon', 40, 8, (g) => {
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;                 // 0=左端(尾) 1=右端(头)
        const a = Math.pow(t, 1.6) * 0.55;   // 头部最亮 .55，尾部趋 0
        const w = 1 + t * 3.2;               // 头粗尾细
        g.fillStyle(0xbfeaff, a);
        g.fillRect(i * (40 / steps), 4 - w / 2, 40 / steps + 0.6, w);
      }
    });

    /* ---------- 熔岩弹弹幕贴图（LavaBulletData.js，三级三连图离线裁切） ----------
       data URI 同源干净，file:// 也可上传 WebGL；上面的程序火苗贴图作为
       解码失败时的兜底。三张全部就绪才置 window.__lavaBulletArt，
       Projectile 据此启用 1/superSample 归一化缩放并停用自带的粒子拖尾
       （新贴图已烘焙拖尾火星，避免双重拖尾）。同样并入 artJobs 等待链。 */
    const hasLavaData = (typeof LAVA_BULLET_DATA !== 'undefined') && LAVA_BULLET_DATA;
    if (hasLavaData) {
      if (!artJobs) artJobs = [];
      const lavaJobs = [1, 2, 3].map((lv) => new Promise((resolve) => {
        const durl = LAVA_BULLET_DATA[lv];
        if (!durl) { resolve(false); return; }
        const key = 'proj_fire_lv' + lv;
        const img = new Image();
        img.onload = () => {
          try {
            if (this.textures.exists(key)) this.textures.remove(key);
            this.textures.addImage(key, img);
            resolve(true);
          } catch (e) { resolve(false); }
        };
        img.onerror = () => resolve(false);
        img.src = durl;
      }));
      artJobs.push(Promise.all(lavaJobs).then((oks) => {
        if (oks.every((v) => v)) window.__lavaBulletArt = true;
        return true;
      }));
    }

    /* ---------- 冰元素塔三级贴图（IceTowerArtData.js，三连图离线裁切） ----------
       data URI 同源干净，file:// 也可上传 WebGL。三张全部就绪才置
       window.__iceTowerArt，Tower 据此给 towerB 换冰塔贴图；缺失时 Tower
       回退到程序化炮头 turret_towerB，绝不黑屏。并入 artJobs 等待链。 */
    const hasIceTowerData = (typeof ICE_TOWER_ART !== 'undefined') && ICE_TOWER_ART;
    if (hasIceTowerData) {
      if (!artJobs) artJobs = [];
      const iceTowerJobs = [1, 2, 3].map((lv) => new Promise((resolve) => {
        const durl = ICE_TOWER_ART[lv];
        if (!durl) { resolve(false); return; }
        const key = 'ice_tower_lv' + lv;
        const img = new Image();
        img.onload = () => {
          try {
            if (this.textures.exists(key)) this.textures.remove(key);
            this.textures.addImage(key, img);
            resolve(true);
          } catch (e) { resolve(false); }
        };
        img.onerror = () => resolve(false);
        img.src = durl;
      }));
      artJobs.push(Promise.all(iceTowerJobs).then((oks) => {
        if (oks.every((v) => v)) window.__iceTowerArt = true;
        return true;
      }));
    }

    /* ---------- 冰弹三级贴图（IceBulletData.js，三连图离线裁切） ----------
       贴图只含雪花本体+近体光晕（烘焙拖尾/冰雾/文字已在离线脚本剔除），
       拖尾由 Projectile 的冰蓝粒子 + ice_ribbon 光带代码生成。三张全部
       就绪才置 window.__iceBulletArt；缺失时冰弹回退程序圆弹。并入等待链。 */
    const hasIceBulletData = (typeof ICE_BULLET_DATA !== 'undefined') && ICE_BULLET_DATA;
    if (hasIceBulletData) {
      if (!artJobs) artJobs = [];
      const iceBulletJobs = [1, 2, 3].map((lv) => new Promise((resolve) => {
        const durl = ICE_BULLET_DATA[lv];
        if (!durl) { resolve(false); return; }
        const key = 'proj_ice_lv' + lv;
        const img = new Image();
        img.onload = () => {
          try {
            if (this.textures.exists(key)) this.textures.remove(key);
            this.textures.addImage(key, img);
            resolve(true);
          } catch (e) { resolve(false); }
        };
        img.onerror = () => resolve(false);
        img.src = durl;
      }));
      artJobs.push(Promise.all(iceBulletJobs).then((oks) => {
        if (oks.every((v) => v)) window.__iceBulletArt = true;
        return true;
      }));
    }

    /* ---------- 水元素塔三级贴图（WaterTowerArtData.js，三连图离线裁切） ----------
       data URI 同源干净，file:// 也可上传 WebGL。三张全部就绪才置
       window.__waterTowerArt，Tower 据此给 towerC 换水塔贴图；缺失时 Tower
       回退到程序化炮头 turret_towerC，绝不黑屏。并入 artJobs 等待链。 */
    const hasWaterTowerData = (typeof WATER_TOWER_ART !== 'undefined') && WATER_TOWER_ART;
    if (hasWaterTowerData) {
      if (!artJobs) artJobs = [];
      /* WATER_TOWER_ART 格式：{level: {data: dataURI, muzzleX, muzzleY}}
         muzzleX/muzzleY 为炮口相对贴图中心的双轴纹素偏移（烘焙时炮口朝右，
         按各等级贴图实测）。旧版兼容：值为字符串→纯 dataURI；
         仅有 muzzleDist→视为水平单轴（y=0）。 */
      window.__waterTowerMuzzle = {};
      const waterTowerJobs = [1, 2, 3].map((lv) => new Promise((resolve) => {
        const entry = WATER_TOWER_ART[lv];
        const durl = (typeof entry === 'string') ? entry : (entry && entry.data);
        let mx = 0, my = 0;
        if (entry && typeof entry === 'object') {
          if (typeof entry.muzzleX === 'number') mx = entry.muzzleX;
          else if (typeof entry.muzzleDist === 'number') mx = entry.muzzleDist;
          if (typeof entry.muzzleY === 'number') my = entry.muzzleY;
        }
        if (!durl) { resolve(false); return; }
        const key = 'water_tower_lv' + lv;
        const img = new Image();
        img.onload = () => {
          try {
            if (this.textures.exists(key)) this.textures.remove(key);
            this.textures.addImage(key, img);
            window.__waterTowerMuzzle[lv] = { x: mx, y: my };
            resolve(true);
          } catch (e) { resolve(false); }
        };
        img.onerror = () => resolve(false);
        img.src = durl;
      }));
      artJobs.push(Promise.all(waterTowerJobs).then((oks) => {
        if (oks.every((v) => v)) window.__waterTowerArt = true;
        return true;
      }));
    }

    /* ---------- 雷元素塔三级贴图（ThunderSheetData.js 全图 data URI，运行时按元素边界裁切） ----------
       数据源：assets/thunder_body_all.png / thunder_deco_all.png 横向三连图，
       离线编码为 data URI 挂 window.THUNDER_SHEET_DATA。运行时用 canvas 读像素，
       按【内容列】扫描三段闪电边界（非简单三等分），自动检测背景（透明 / 纯色）
       做色度键抠图，按内容包围盒裁出每级两张独立贴图：
         thunder_tower_lvN  = 闪电主体静态层（造型 / 颜色 / 大小保持原图，不重绘）
         thunder_deco_lvN   = 外围装饰层（形状与原图逐像素一致，仅做闪现 alpha 循环）
       本体层扫描"实心黄色尖端"像素，相对本体纹理中心写入 window.__thunderTipOffset[lv]，
       发射点据此 + 旋转矩阵动态计算（不再写死 config.tip）。
       装饰层相对本体中心的纹素偏移写入 window.__thunderDecoOffset[lv]，叠加时严格对齐原图。
       data URI 同源干净，file:// 下 getImageData 也可用；任一步异常回退程序炮头，
       绝不黑屏。并入 artJobs 等待链。 */
    const hasThunderSheet = (typeof THUNDER_SHEET_DATA !== 'undefined') && THUNDER_SHEET_DATA;
    if (hasThunderSheet) {
      if (!artJobs) artJobs = [];
      artJobs.push(new Promise((resolve) => {
        /* 异步解码两张全图 data URI → Image；两图就绪后进入裁切流程。
           任一张 onerror 也继续（缺失图按 null 处理，本体缺失即整体回退）。 */
        const imgs = { body: null, deco: null };
        let pending = 2;
        const done = () => {
          if (--pending > 0) return;
          try {
            const p = this._processThunderSheets(imgs.body, imgs.deco);
            if (p && typeof p.then === 'function') {
              p.then(() => resolve(true)).catch(() => resolve(true));
            } else { resolve(true); }
          } catch (e) { resolve(true); }
        };
        const load = (url, slot) => {
          if (!url) { done(); return; }
          const img = new Image();
          img.onload = () => { imgs[slot] = img; done(); };
          img.onerror = () => done();
          img.src = url;
        };
        load(THUNDER_SHEET_DATA.body, 'body');
        load(THUNDER_SHEET_DATA.deco, 'deco');
      }));
    }

    /* ---------- 水弹三级贴图（WaterBulletData.js，程序生成水珠/水柱/水球本体） ----------
       贴图只含本体（拖尾/水雾已剔除），拖尾由 Projectile 的水蓝粒子 +
       water_ribbon 光带代码生成。三张全部就绪才置 window.__waterBulletArt；
       缺失时水弹回退程序圆弹。并入等待链。 */
    const hasWaterBulletData = (typeof WATER_BULLET_DATA !== 'undefined') && WATER_BULLET_DATA;
    if (hasWaterBulletData) {
      if (!artJobs) artJobs = [];
      const waterBulletJobs = [1, 2, 3].map((lv) => new Promise((resolve) => {
        const durl = WATER_BULLET_DATA[lv];
        if (!durl) { resolve(false); return; }
        const key = 'proj_water_lv' + lv;
        const img = new Image();
        img.onload = () => {
          try {
            if (this.textures.exists(key)) this.textures.remove(key);
            this.textures.addImage(key, img);
            resolve(true);
          } catch (e) { resolve(false); }
        };
        img.onerror = () => resolve(false);
        img.src = durl;
      }));
      artJobs.push(Promise.all(waterBulletJobs).then((oks) => {
        if (oks.every((v) => v)) window.__waterBulletArt = true;
        return true;
      }));
    }

    /* ---------- 风元素塔三级贴图（WindTowersArtData.js，横向三连图运行时裁切） ----------
       数据源：assets/wind_towers.png（绿幕背景 2352x1008）离线编码为 data URI
       挂 WIND_TOWERS_DATA。运行时用 canvas 读像素，按【内容列】扫描三段龙卷风
       边界（非简单三等分），自动检测绿幕背景做色度键抦图，按内容包围盒裁出
       每级独立贴图 wind_tower_lvN。data URI 同源干净，file:// 下也可用。
       任一步异常回退程序炮头，绝不黑屏。并入 artJobs 等待链。 */
    const hasWindData = (typeof WIND_TOWERS_DATA !== 'undefined') && WIND_TOWERS_DATA;
    if (hasWindData) {
      if (!artJobs) artJobs = [];
      artJobs.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const p = this._processTowerSheet(img, 'wind', 'wind_tower_lv', TD_CONFIG.towers.towerF.art);
            if (p && typeof p.then === 'function') {
              p.then(() => resolve(true)).catch(() => resolve(true));
            } else { resolve(true); }
          } catch (e) { resolve(true); }
        };
        img.onerror = () => resolve(true);
        img.src = WIND_TOWERS_DATA;
      }));
    }

    /* ---------- 引力塔三级贴图（GravityTowersArtData.js，横向三连图运行时裁切） ----------
       数据源：assets/gravity_towers.png（白幕背景 2912x1456）离线编码为 data URI
       挂 GRAVITY_TOWERS_DATA。运行时按内容列扫描三段磁铁边界（非简单三等分），
       自动检测白幕背景做色度键抦图，按内容包围盒裁出每级独立贴图
       gravity_tower_lvN。贴图保持原图造型/颜色/大小，不重绘不变形。
       data URI 同源干净，file:// 下也可用。任一步异常回退程序炮头。 */
    const hasGravityData = (typeof GRAVITY_TOWERS_DATA !== 'undefined') && GRAVITY_TOWERS_DATA;
    if (hasGravityData) {
      if (!artJobs) artJobs = [];
      artJobs.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const p = this._processTowerSheet(img, 'gravity', 'gravity_tower_lv', TD_CONFIG.towers.towerD.art);
            if (p && typeof p.then === 'function') {
              p.then(() => resolve(true)).catch(() => resolve(true));
            } else { resolve(true); }
          } catch (e) { resolve(true); }
        };
        img.onerror = () => resolve(true);
        img.src = GRAVITY_TOWERS_DATA;
      }));
    }

    /* ---------- 水弹粒子与渐变光带（代码生成拖尾用） ----------
       water_dot：圆形水蓝粒子（外水蓝 0x7fc8ff、内白），运行时可再 tint；
       water_ribbon：横向 40×8 渐变光带（右侧亮、向左渐隐），origin(1,0.5)
       钉在弹体中心向弹尾延伸。 */
    this.makeTexture('water_dot', 8, 8, (g) => {
      g.fillStyle(0x7fc8ff, 1); g.fillCircle(4, 4, 3.4);
      g.fillStyle(0xffffff, 1); g.fillCircle(4, 4, 1.8);
    });
    this.makeTexture('water_ribbon', 40, 8, (g) => {
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const a = Math.pow(t, 1.6) * 0.5;
        const w = 1 + t * 3.0;
        g.fillStyle(0xbfeaff, a);
        g.fillRect(i * (40 / steps), 4 - w / 2, 40 / steps + 0.6, w);
      }
    });

    /* ---------- 敌人美术数据（EnemyArtData.js，data URI，离线生成） ----------
       ① BOSS_ART：三只 BOSS 贴图 boss_gold/boss_blue/boss_gray（按元素边界裁切 +
          白底连通域抠图）；Enemy 端由 GameScene 按波次选变体贴图。
       ② SLIME_STATIC_ART：史莱姆静态降级贴图 slime_static_green/slime_static_blue
          （视频不可用时的兜底，如 Canvas 渲染器 / file:// 跨域 / 手机不支持）。
       与火/冰/水/雷塔一致：异步解码后 addImage 注册纹理，并入 artJobs 等待链，
       就绪后再进选关（贴图缺失时不阻塞启动，Enemy 端自动回退程序化占位贴图）。 */
    if (typeof BOSS_ART !== 'undefined' && BOSS_ART) {
      if (!artJobs) artJobs = [];
      Object.keys(BOSS_ART).forEach((k) => {
        const durl = BOSS_ART[k];
        if (!durl) return;
        const key = 'boss_' + k;
        artJobs.push(new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              if (this.textures.exists(key)) this.textures.remove(key);
              this.textures.addImage(key, img);
              resolve(true);
            } catch (e) { resolve(false); }
          };
          img.onerror = () => resolve(false);
          img.src = durl;
        }));
      });
    }
    if (typeof SLIME_STATIC_ART !== 'undefined' && SLIME_STATIC_ART) {
      if (!artJobs) artJobs = [];
      Object.keys(SLIME_STATIC_ART).forEach((k) => {
        const durl = SLIME_STATIC_ART[k];
        if (!durl) return;
        const key = 'slime_static_' + k;
        artJobs.push(new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              if (this.textures.exists(key)) this.textures.remove(key);
              this.textures.addImage(key, img);
              resolve(true);
            } catch (e) { resolve(false); }
          };
          img.onerror = () => resolve(false);
          img.src = durl;
        }));
      });
    }

    /* ---------- 皇冠贴图（CrownArtData.js，data URI，离线生成） ----------
       从三个 Boss 死亡视频末帧提取的金/蓝/灰皇冠落地造型（绿幕距离键 +
       despill 抠透明，2x 超采样）。Boss 死亡视频播完后叠加在落点缓慢淡出；
       视频降级时同样用它做皇冠淡出。缺失时跳过皇冠淡出，不影响死亡动画。 */
    if (typeof CROWN_ART !== 'undefined' && CROWN_ART) {
      if (!artJobs) artJobs = [];
      Object.keys(CROWN_ART).forEach((k) => {
        const durl = CROWN_ART[k];
        if (!durl) return;
        const key = 'crown_' + k;
        artJobs.push(new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              if (this.textures.exists(key)) this.textures.remove(key);
              this.textures.addImage(key, img);
              resolve(true);
            } catch (e) { resolve(false); }
          };
          img.onerror = () => resolve(false);
          img.src = durl;
        }));
      });
    }

    /* ---------- 公主窗口图片（PrincessArtData.js，data URI，整图不抠图） ----------
       点击城堡大门弹出的窗口里居中完整显示；异步解码后注册纹理 'princess'。
       缺失时静默跳过（仅弹窗内无图，大门与游戏主流程不受影响）。 */
    if (typeof PRINCESS_ART !== 'undefined' && PRINCESS_ART && PRINCESS_ART.data) {
      if (!artJobs) artJobs = [];
      artJobs.push(new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            if (this.textures.exists('princess')) this.textures.remove('princess');
            this.textures.addImage('princess', img);
            resolve(true);
          } catch (e) { resolve(false); }
        };
        img.onerror = () => resolve(false);
        img.src = PRINCESS_ART.data;
      }));
    }

    /* 内嵌贴图就绪后再进选关（小图解码通常几十 ms；超时兜底绝不阻断启动） */
    if (artJobs) {
      let started = false;
      const go = () => { if (!started) { started = true; this.scene.start('LevelSelectScene'); } };
      Promise.all(artJobs).then(go);
      setTimeout(go, 800);
      return;
    }
    this.scene.start('LevelSelectScene');
  }

  /* 色度键抠图：把纯色背景（green/white）转透明，并做边缘去晕防白边/绿边；
     随后按 alpha 裁剪到内容包围盒，缩放到 outSize（= 显示尺寸×4 超采样）。
     原图 1024×1024，内容包围盒 400~600px，canvas 高质量缩到 168/192/224，
     显示 42/48/56 时最多 1:1 采样，不需要 mipmap 也清晰。 */
  chromaKeyTexture(rawKey, outKey, bg, outSize) {
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
      if (d[i + 3] < 40) d[i + 3] = 0; // 残边清除：过淡的半透明像素直接全透明，防虚影
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
    /* 输出纹理尺寸按显示尺寸 ×4 超采样（调用方传入，默认 256）；
       留 12% 边距给缩放动效余量，剩余区域高质量缩放 */
    const OUT = outSize || 256;
    const side = Math.ceil(Math.max(cw, ch) * 1.12); // 12% 边距
    const ct = this.textures.createCanvas(outKey, OUT, OUT);
    const cctx = ct.getContext();
    cctx.clearRect(0, 0, OUT, OUT);
    /* 开启浏览器高质量平滑（Lanczos/bicubic）缩放到输出尺寸 */
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = 'high';
    const drawW = Math.round(OUT * (cw / side));
    const drawH = Math.round(OUT * (ch / side));
    cctx.drawImage(off, minX, minY, cw, ch,
      Math.round((OUT - drawW) / 2), Math.round((OUT - drawH) / 2), drawW, drawH);
    ct.refresh();
  }

  /* ============================================================
   * 雷塔全图裁切（运行时）：把 body/deco 两张横向三连图按内容边界切成
   * 3 级本体 + 装饰纹理，并探测黄色尖端 / 装饰对齐偏移。像素读写在 canvas
   * 上完成，data URI 同源干净，file:// 也可用。任一异常静默退出 → Tower
   * 回退程序炮头 turret_towerE，绝不黑屏。
   * ============================================================ */
  _processThunderSheets(bodyImg, decoImg) {
    if (!bodyImg) return;  // 本体全图缺失 → 整体回退
    const body = this._thunderDrawToCanvas(bodyImg);
    if (!body) return;
    const bodyData = body.ctx.getImageData(0, 0, body.w, body.h);
    const bodyBg = this._thunderDetectBg(bodyData, body.w, body.h);
    const bodySegs = this._thunderFindSegments(bodyData, body.w, body.h, bodyBg);
    if (bodySegs.length < 3) return;  // 无法识别三段 → 回退
    let deco = null, decoData = null, decoBg = null, decoSegs = null;
    if (decoImg) {
      deco = this._thunderDrawToCanvas(decoImg);
      if (deco) {
        decoData = deco.ctx.getImageData(0, 0, deco.w, deco.h);
        decoBg = this._thunderDetectBg(decoData, deco.w, deco.h);
        decoSegs = this._thunderFindSegments(decoData, deco.w, deco.h, decoBg);
      }
    }
    /* 两图尺寸一致时按共享坐标系对齐装饰；否则按段中心兜底（deco 居中于 body） */
    const shared = deco && deco.w === body.w && deco.h === body.h;
    window.__thunderTipOffset = window.__thunderTipOffset || {};
    window.__thunderDecoOffset = window.__thunderDecoOffset || {};
    let anyBody = false;
    /* 收集所有裁切后的 Canvas，稍后统一转 Image 再 addImage（与火/冰/水塔
       完全一致：HTMLImageElement 直通 alpha，避免 Canvas 内部预乘 alpha 被
       WebGL texImage2D 二次预乘导致边缘发虚）。 */
    const texEntries = [];
    /* 超采样倍数 JSON 驱动（config towerE.art.superSample，默认 4）：
       雷塔源图内容盒 965~1213px，4×（216~268px）会 4.5× 降采样把闪电
       细线压虚；8×（432~536px）降采样约 2.2×，与火/冰塔清晰度对齐。
       body 和 deco 用同一缩放因子 s，保证两层叠加严格对齐。 */
    const art = TD_CONFIG.towers.towerE.art;
    const baseH = (art && art.baseHeight) || 54;
    const lvScales = (art && art.scale) || {};
    const superSample = (art && art.superSample) || 4;
    /* 装饰层分段：与主体共用同一分段（装饰图碎片多，按主体段范围裁切）。
       装饰图在主体段 x 范围内有内容，直接按主体段范围 + 装饰图内容包围盒裁切。 */
    for (let lv = 1; lv <= 3; lv++) {
      const bSeg = bodySegs[lv - 1];
      if (!bSeg) continue;
      const bBox = this._thunderContentBox(bodyData, body.w, body.h, bodyBg,
        bSeg.x0, bSeg.x1);
      if (!bBox) continue;
      /* 目标纹素高 = superSample × 显示高；s = 输出/原始，body 和 deco 共用 */
      const dispH = baseH * (lvScales[lv] || 1);
      const targetH = Math.round(superSample * dispH);
      const s = targetH / bBox.h;
      const bodyKey = 'thunder_tower_lv' + lv;
      /* 透明背景检测：bg.type === 'transparent' 时跳过色度键，直接裁切 */
      const bodyCanvas = (bodyBg.type === 'transparent')
        ? this._thunderCropOnly(bodyData, body.w, body.h, bBox, bodyKey, targetH)
        : this._thunderCropAndKey(bodyData, body.w, body.h, bodyBg, bBox, bodyKey, targetH);
      if (!bodyCanvas) continue;
      texEntries.push({ key: bodyKey, canvas: bodyCanvas });
      anyBody = true;
      /* 黄色尖端（相对本体纹理中心，纹素坐标；按缩放 s 换算到输出纹理尺寸） */
      const tip = this._thunderDetectYellowTip(bodyData,
        body.w, body.h, bodyBg, bBox);
      window.__thunderTipOffset[lv] = { x: tip.x * s, y: tip.y * s };
      /* 装饰层（可选；缺失仅禁用闪现，本体仍可用）。
         装饰图碎片多，不按装饰图自己的分段，而是按主体段 x 范围裁切，
         保证与主体严格对齐。 */
      if (decoData) {
        /* 在主体段 x 范围内找装饰内容包围盒 */
        const dBox = this._thunderContentBox(decoData, deco.w, deco.h, decoBg,
          bSeg.x0, bSeg.x1);
        if (dBox) {
          const decoKey = 'thunder_deco_lv' + lv;
          /* 装饰用同一 s 缩放，保证与本体对齐 */
          const decoTargetH = Math.round(dBox.h * s);
          /* 透明背景检测：跳过色度键 */
          const decoCanvas = (decoBg.type === 'transparent')
            ? this._thunderCropOnly(decoData, deco.w, deco.h, dBox, decoKey, decoTargetH)
            : this._thunderCropAndKey(decoData, deco.w, deco.h, decoBg, dBox, decoKey, decoTargetH);
          if (decoCanvas) {
            texEntries.push({ key: decoKey, canvas: decoCanvas });
            /* 装饰中心相对本体中心的纹素偏移（按 s 换算到输出纹理尺寸） */
            let ox = 0, oy = 0;
            if (shared) {
              ox = (dBox.x0 + dBox.w / 2) - (bBox.x0 + bBox.w / 2);
              oy = (dBox.y0 + dBox.h / 2) - (bBox.y0 + bBox.h / 2);
            }
            window.__thunderDecoOffset[lv] = { x: ox * s, y: oy * s };
          }
        }
      }
    }
    /* 异步：所有 Canvas → dataURL → Image → addImage（与火/冰/水塔完全一致：
       HTMLImageElement 直通 alpha，避免 Canvas 内部预乘 alpha 被 WebGL
       texImage2D 二次预乘导致边缘发虚）。返回 Promise 供调用方等待。 */
    return Promise.all(texEntries.map((entry) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          if (this.textures.exists(entry.key)) this.textures.remove(entry.key);
          this.textures.addImage(entry.key, img);
        } catch (e) {}
        resolve();
      };
      img.onerror = () => resolve();
      img.src = entry.canvas.toDataURL('image/png');
    }))).then(() => {
      /* 至少一级本体就绪即启用美术路径；高级缺失由 _thunderTexKey 逐级回退 */
      if (anyBody) window.__thunderTowerArt = true;
    });
  }

  /* Image → canvas（带 willReadFrequently 优化），返回 {ctx, w, h} */
  _thunderDrawToCanvas(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { ctx, w, h };
  }

  /* 背景检测：采样四角，多数透明→已透明；角颜色近纯色→纯色背景→色度键；
     角颜色差异大→当透明处理（保留原样，不抠图） */
  _thunderDetectBg(imgData, w, h) {
    const d = imgData.data;
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
    let transparent = 0, samples = [];
    for (const [cx, cy] of corners) {
      const i = (cy * w + cx) * 4;
      if (d[i + 3] < 16) transparent++;
      else samples.push([d[i], d[i + 1], d[i + 2]]);
    }
    if (transparent >= 3 || samples.length === 0) return { type: 'transparent' };
    let r = 0, g = 0, b = 0;
    for (const s of samples) { r += s[0]; g += s[1]; b += s[2]; }
    r = r / samples.length; g = g / samples.length; b = b / samples.length;
    let dev = 0;
    for (const s of samples) {
      dev = Math.max(dev, Math.abs(s[0] - r), Math.abs(s[1] - g), Math.abs(s[2] - b));
    }
    if (dev <= 24) return { type: 'solid', r: Math.round(r), g: Math.round(g), b: Math.round(b) };
    return { type: 'transparent' };
  }

  /* 像素是否为"内容"（非背景）。透明背景：alpha>16；纯色背景：与背景差异大 */
  _thunderIsContent(d, i, bg) {
    if (d[i + 3] < 16) return false;
    if (bg.type === 'transparent') return true;
    const dev = Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b);
    return dev > 60;
  }

  /* 找 3 段内容列（横向三连图，段间有透明列间隙）。返回 [{x0,x1}×3]；
     无法识别三段（粘连 / 全空）时返回 [] */
  _thunderFindSegments(imgData, w, h, bg) {
    const d = imgData.data;
    const cols = new Array(w).fill(false);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y += 2) {
        if (this._thunderIsContent(d, (y * w + x) * 4, bg)) { cols[x] = true; break; }
      }
    }
    const segs = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && cols[x]) { if (start < 0) start = x; }
      else if (start >= 0) { segs.push({ x0: start, x1: x - 1 }); start = -1; }
    }
    if (segs.length === 3) return segs;
    /* 兜底：内容列总宽三等分（仅当段间无间隙、三连图粘连时） */
    let cmin = w, cmax = -1;
    for (let x = 0; x < w; x++) if (cols[x]) { if (x < cmin) cmin = x; if (x > cmax) cmax = x; }
    if (cmax < 0) return [];
    const step = (cmax - cmin + 1) / 3;
    return [
      { x0: cmin, x1: Math.round(cmin + step) - 1 },
      { x0: Math.round(cmin + step), x1: Math.round(cmin + 2 * step) - 1 },
      { x0: Math.round(cmin + 2 * step), x1: cmax }
    ];
  }

  /* 段内内容包围盒（纹素）。隔行隔列扫描后向外扩 1px 补偿边缘。
     返回 {x0,y0,w,h}；段内无内容返回 null */
  _thunderContentBox(imgData, w, h, bg, x0, x1) {
    const d = imgData.data;
    let minX = x1 + 1, maxX = x0 - 1, minY = h, maxY = -1;
    for (let y = 0; y < h; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        if (this._thunderIsContent(d, (y * w + x) * 4, bg)) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxY < 0) return null;
    minX = Math.max(x0, minX - 1); maxX = Math.min(x1, maxX + 1);
    minY = Math.max(0, minY - 1); maxY = Math.min(h - 1, maxY + 1);
    return { x0: minX, y0: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /* 按包围盒裁切 + 色度键抠图，创建纹理。透明背景原样拷贝。
     绿幕背景：excess-green 抠图（g−max(r,b)>50 全透明、≤0 全保留、
     之间软过渡），并做去绿边（un-premultiply 反算去除背景色溢出），
     无绿边、无残留。其他纯色背景：差异度抠图（<32 全透明、32~80 半透明、
     >80 全保留）。targetH > h 时用高质量 Lanczos/bicubic 放大到目标尺寸
     （4 倍超采样），并设 LINEAR filter 保证缩放后清晰。返回是否成功 */
  _thunderCropAndKey(imgData, srcW, srcH, bg, box, outKey, targetH) {
    const { x0, y0, w, h } = box;
    if (w <= 0 || h <= 0) return false;
    if (this.textures.exists(outKey)) this.textures.remove(outKey);
    /* Step 1: 色度键抠图到临时 canvas（原始分辨率，像素级精确） */
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    const out = tctx.createImageData(w, h);
    const od = out.data, sd = imgData.data;
    const solid = bg.type === 'solid';
    const isGreen = solid && bg.g > 120 && bg.g - Math.max(bg.r, bg.b) > 60;
    /* 收紧过渡带：excess 50→20。源图闪电边缘反走样像素 excess 多在 0~20，
       50 过渡带会把这些边缘像素做成半透明，导致整体发虚。20 过渡带更硬边，
       与火塔离线抠图效果一致。 */
    const KEY_SOFT = 20;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((y0 + y) * srcW + (x0 + x)) * 4;
        const oi = (y * w + x) * 4;
        const a = sd[si + 3];
        if (a < 16) { od[oi + 3] = 0; continue; }
        if (solid) {
          const r = sd[si], g = sd[si + 1], b = sd[si + 2];
          if (isGreen) {
            const excess = g - Math.max(r, b);
            if (excess > KEY_SOFT) { od[oi + 3] = 0; continue; }
            if (excess <= 0) {
              od[oi] = r; od[oi + 1] = g; od[oi + 2] = b; od[oi + 3] = a;
            } else {
              const key = excess / KEY_SOFT;
              od[oi] = r;
              od[oi + 1] = Phaser.Math.Clamp((g - 255 * key) / (1 - key), 0, 255);
              od[oi + 2] = b;
              od[oi + 3] = Math.round(a * (1 - key));
              if (od[oi + 3] < 40) od[oi + 3] = 0;
            }
          } else {
            const dev = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
            if (dev < 32) { od[oi + 3] = 0; continue; }
            od[oi] = r; od[oi + 1] = g; od[oi + 2] = b;
            if (dev < 80) {
              const k = (dev - 32) / 48;
              od[oi + 3] = Math.round(a * k);
              if (od[oi + 3] < 40) od[oi + 3] = 0;
            } else {
              od[oi + 3] = a;
            }
          }
        } else {
          od[oi] = sd[si]; od[oi + 1] = sd[si + 1]; od[oi + 2] = sd[si + 2]; od[oi + 3] = a;
        }
      }
    }
    /* 二次去绿：清理边缘残留的绿色溢出像素（g 偏高但未进 KEY_SOFT 软过渡带）。
       只对 alpha > 16 的像素：若 g > max(r,b) + 5（明显偏绿），把 g 降到 max(r,b)。
       不影响蓝白主体（白 excess=0、蓝 excess 负），只清理残留绿边/碎片。 */
    if (isGreen) {
      for (let i = 0; i < od.length; i += 4) {
        if (od[i + 3] > 16) {
          const r = od[i], g = od[i + 1], b = od[i + 2];
          if (g > Math.max(r, b) + 5) od[i + 1] = Math.max(r, b);
        }
      }
    }
    tctx.putImageData(out, 0, 0);
    /* Step 2: 高质量放大到目标尺寸（4 倍超采样），返回 Canvas。
       调用方负责 Canvas → dataURL → Image → addImage（与火/冰/水塔完全一致：
       HTMLImageElement 的 PNG 直通 alpha，避免 Canvas 内部预乘 alpha 被
       WebGL texImage2D 二次预乘导致边缘发虚）。 */
    const outH = (targetH && targetH > h) ? targetH : h;
    const scale = outH / h;
    const outW = Math.round(w * scale);
    const fc = document.createElement('canvas');
    fc.width = outW;
    fc.height = Math.round(outH);
    const fctx = fc.getContext('2d');
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(tmp, 0, 0, w, h, 0, 0, outW, Math.round(outH));
    return fc;
  }

  /* 透明背景直接裁切（不做色度键抠图）：从源 ImageData 按包围盒裁出，
     高质量放大到目标尺寸，返回 Canvas。用于 thunder_*_transparent.png。 */
  _thunderCropOnly(imgData, srcW, srcH, box, outKey, targetH) {
    const { x0, y0, w, h } = box;
    if (w <= 0 || h <= 0) return null;
    if (this.textures.exists(outKey)) this.textures.remove(outKey);
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const tctx = tmp.getContext('2d');
    const out = tctx.createImageData(w, h);
    const od = out.data, sd = imgData.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((y0 + y) * srcW + (x0 + x)) * 4;
        const oi = (y * w + x) * 4;
        od[oi] = sd[si]; od[oi + 1] = sd[si + 1];
        od[oi + 2] = sd[si + 2]; od[oi + 3] = sd[si + 3];
      }
    }
    tctx.putImageData(out, 0, 0);
    const outH = (targetH && targetH > h) ? targetH : h;
    const scale = outH / h;
    const outW = Math.round(w * scale);
    const fc = document.createElement('canvas');
    fc.width = outW;
    fc.height = Math.round(outH);
    const fctx = fc.getContext('2d');
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(tmp, 0, 0, w, h, 0, 0, outW, Math.round(outH));
    return fc;
  }

  /* 探测本体"实心黄色尖端"相对本体纹理中心的纹素偏移。黄色判据：
     R>200, G>180, B<130, R>=G。取距中心最远的黄像素作尖端（黄色端为
     闪电顶端，天然在远离中心处）。未检出黄 → 退化为顶部中点偏移 */
  _thunderDetectYellowTip(imgData, srcW, srcH, bg, box) {
    const { x0, y0, w, h } = box;
    const cx = w / 2, cy = h / 2;
    const sd = imgData.data;
    let bestX = 0, bestY = -h * 0.4, bestDist = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = ((y0 + y) * srcW + (x0 + x)) * 4;
        const r = sd[si], g = sd[si + 1], b = sd[si + 2], a = sd[si + 3];
        if (a < 128) continue;
        if (r > 200 && g > 180 && b < 130 && r >= g) {
          const dx = x - cx, dy = y - cy;
          const dist = dx * dx + dy * dy;
          if (dist > bestDist) { bestDist = dist; bestX = dx; bestY = dy; }
        }
      }
    }
    return { x: bestX, y: bestY };
  }

  /* ============================================================
   * 横向三连图"取 3 主体段"（风塔/引力塔专用，不动雷塔共享的
   * _thunderFindSegments）：先按内容列分段，再按每段内容像素数丢弃
   * 明显偏小的碎片段——源图边缘常残留相邻元素的碎块（实测
   * wind_towers.png 共 5 段：左端 1px 噪点 + 3 个龙卷风 + 右端 46×35
   * 的相邻龙卷风碎片），旧的"段数≠3 就总宽三等分"兜底会把相邻龙卷风
   * 切进来。改为按像素数过滤后从左到右取前 3 段为 1/2/3 级，绝不切到
   * 相邻元素。返回 [{x0,x1}×3]；不足 3 段返回 []。
   * ============================================================ */
  _towerMainSegments(imgData, w, h, bg) {
    const d = imgData.data;
    const cols = new Array(w).fill(false);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y += 2) {
        if (this._thunderIsContent(d, (y * w + x) * 4, bg)) { cols[x] = true; break; }
      }
    }
    const runs = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      if (x < w && cols[x]) { if (start < 0) start = x; }
      else if (start >= 0) { runs.push({ x0: start, x1: x - 1 }); start = -1; }
    }
    if (runs.length < 3) return [];
    /* 每段内容像素数（隔行隔列采样，仅用于碎片判定，开销与源图同量级） */
    for (const s of runs) {
      let n = 0;
      for (let y = 0; y < h; y += 2) {
        for (let x = s.x0; x <= s.x1; x += 2) {
          if (this._thunderIsContent(d, (y * w + x) * 4, bg)) n++;
        }
      }
      s.n = n;
    }
    const mx = Math.max(...runs.map((s) => s.n));
    /* 丢弃明显偏小的碎片段（< 最大段的 8%）：实测碎片约 0.3%，主体同级 */
    const main = runs.filter((s) => s.n >= mx * 0.08);
    main.sort((a, b) => a.x0 - b.x0);
    if (main.length < 3) return [];
    return main.slice(0, 3);
  }

  /* ============================================================
   * 通用横向三连图裁切（风塔/引力塔共用）：把一张横向排列的三连图按
   * 内容列边界切成 3 级独立贴图，自动检测背景做色度键抦图，按内容包
   * 围盒裁切 + 超采样缩放。像素读写在 canvas 上完成，data URI 同源干净，
   * file://下也可用。任一异常静默退出 → Tower 回退程序炮头，绝不黑屏。
   *
   * 参数：
   *   img       : HTMLImageElement（已解码的 data URI）
   *   kind      : 'wind' | 'gravity'（用于设置 window flag）
   *   texPrefix : 纹理键前缀（如 'wind_tower_lv' → wind_tower_lv1/2/3）
   *   artCfg    : config 中的 art 段（baseHeight/scale/superSample）
   * ============================================================ */
  _processTowerSheet(img, kind, texPrefix, artCfg) {
    if (!img) return;
    const c = this._thunderDrawToCanvas(img);
    if (!c) return;
    const data = c.ctx.getImageData(0, 0, c.w, c.h);
    const bg = this._thunderDetectBg(data, c.w, c.h);
    /* 用"取 3 主体段"（按像素数过滤碎片），避免三等分兜底切到相邻元素 */
    const segs = this._towerMainSegments(data, c.w, c.h, bg);
    if (segs.length < 3) return;  // 无法识别三段 → 回退
    /* 超采样倍数 JSON 驱动（默认 4）。风塔/引力塔源图内容盒较大，
       4× 超采样配合 LINEAR 采样保证清晰（与火/冰塔一致）。 */
    const baseH = (artCfg && artCfg.baseHeight) || 54;
    const lvScales = (artCfg && artCfg.scale) || {};
    const superSample = (artCfg && artCfg.superSample) || 4;
    const texEntries = [];
    let anyOk = false;
    for (let lv = 1; lv <= 3; lv++) {
      const seg = segs[lv - 1];
      if (!seg) continue;
      const box = this._thunderContentBox(data, c.w, c.h, bg, seg.x0, seg.x1);
      if (!box) continue;
      /* 目标纹素高 = superSample × 显示高；s = 输出/原始 */
      const dispH = baseH * (lvScales[lv] || 1);
      const targetH = Math.round(superSample * dispH);
      const key = texPrefix + lv;
      /* 透明背景检测：bg.type === 'transparent' 时跳过色度键，直接裁切 */
      const canvas = (bg.type === 'transparent')
        ? this._thunderCropOnly(data, c.w, c.h, box, key, targetH)
        : this._thunderCropAndKey(data, c.w, c.h, bg, box, key, targetH);
      if (!canvas) continue;
      texEntries.push({ key: key, canvas: canvas });
      anyOk = true;
    }
    /* 异步：所有 Canvas → dataURL → Image → addImage（与火/冰/水/雷塔一致：
       HTMLImageElement 直通 alpha，避免 Canvas 内部预乘 alpha 被 WebGL
       texImage2D 二次预乘导致边缘发虚）。 */
    return Promise.all(texEntries.map((entry) => new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        try {
          if (this.textures.exists(entry.key)) this.textures.remove(entry.key);
          this.textures.addImage(entry.key, im);
        } catch (e) {}
        resolve();
      };
      im.onerror = () => resolve();
      im.src = entry.canvas.toDataURL('image/png');
    }))).then(() => {
      /* 至少一级贴图就绪即启用美术路径；高级缺失由 Tower 逐级回退 */
      if (anyOk) {
        if (kind === 'wind') window.__windTowerArt = true;
        else if (kind === 'gravity') window.__gravityTowerArt = true;
      }
    });
  }

  /* 小工具：在一张临时 Graphics 上绘制并生成纹理 */
  makeTexture(key, w, h, drawFn) {
    const g = this.add.graphics();
    drawFn(g);
    g.generateTexture(key, w, h);
    g.destroy();
  }
}
