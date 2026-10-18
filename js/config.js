/* ============================================================
 * config.js —— 全部数值 / 路径 / 波次的 JSON 配置
 * 后续改数值、换名字、加塔加敌人，只改本文件即可。
 * ============================================================ */

/* 全局无衬线字体栈：优先系统内置高清字体（无需下载字体文件，零加载延迟），
   覆盖 Android(Roboto/Noto) / iOS(PingFang) / Windows(YaHei/Segoe) / 桌面 Chrome(Inter)。
   全部是“字体名回退”：系统装了哪个用哪个，任何一个都不存在也不会报错或卡住。 */
window.TD_FONT_STACK =
  'Inter, Roboto, "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, Arial, sans-serif';

/* 文字超采样倍率：只传给 Phaser Text 的 resolution（文字内部画布倍率），
   不改变 canvas 尺寸 / 相机 / ScaleManager / 布局，因此不会影响场景渲染。
   2x 起步保证清晰，最高 3x 避免高分屏显存占用过大；读取异常时回退 2，
   确保任何情况下游戏主流程都不会因此中断。 */
window.TD_TEXT_RES = (function () {
  try {
    var d = window.devicePixelRatio || 1;
    return Math.min(Math.max(d, 2), 3);
  } catch (e) { return 2; }
})();

window.TD_CONFIG = {

  /* ---------- 世界（设计分辨率，Phaser 按比例 FIT 缩放） ---------- */
  "world": {
    "width": 960,
    "height": 540,
    "pathWidth": 50,          // 路面宽度（视觉）
    "bgColors": [0x83ce57, 0x8ed861]
  },

  /* ---------- 固定路径：敌人从第一个点走到最后一个点 ----------
   * 首尾点放在屏幕外，形成“走进来 / 走出去”的效果            */
  "path": {
    "waypoints": [
      { "x": -40, "y": 110 },
      { "x": 240, "y": 110 },
      { "x": 240, "y": 300 },
      { "x": 500, "y": 300 },
      { "x": 500, "y": 130 },
      { "x": 740, "y": 130 },
      { "x": 740, "y": 420 },
      { "x": 170, "y": 420 },
      { "x": 170, "y": 580 }
    ],
    "borderColor": 0xc99a54,
    "fillColor": 0xeac58f
  },

  /* ---------- 放塔规则（沿路双排热区 + 离路校验） ----------
   * 热区不铺满全图，分两类（GameScene 生成，视觉上明显区分）：
   *   1) 道路火力点（绿色圆角方块）：沿路径每 cell 采一个点，向两侧法向
   *      各偏移 roadGap，形成沿道路两侧均匀分布的两排整齐点，距路心恒
   *      roadGap(< 最短射程 125)，放塔必能打到路面；
   *   2) 障碍物据点（琥珀色圆角方块）：每个障碍物附近至少生成一个，
   *      保证最短射程的塔（塔C 125）也能打到该障碍物（见 obstacles 配置）；
   *      这些点可以不覆盖道路，多个相邻障碍物可共享同一个据点。
   * 拐弯内侧过近的点按 minSpacing 去重；出界/压路点直接剔除。 */
  "build": {
    "cell": 80,              // 沿路径的采样间距（也是同侧相邻道路点间距）
    "tutorialCell": 94,      // 第 1 关（新手教程）采样间距更大，火力点适当少而简单
    "roadGap": 62,           // 道路点距路径中心线的垂直距离（两侧各一排）
    "minSpacing": 56,        // 热区去重最小间距（拐弯内侧两排点合并用）
    "edgeMargin": 34,        // 距画面边缘最小距离
    "minPathDistance": 56,   // 塔心距路径中心线的最小距离（避路硬校验）
    /* HUD 安全禁区（世界 960x540 坐标，电脑/手机两端共用同一份，保证两端
       塔位数量与位置完全一致）：矩形来自运行时实测——手机竖屏 rotate90
       视觉横屏（布局盒 844x390，画布上下无黑边，HUD 直接压在画布边缘）
       与电脑全屏 16:9（1920x1080）两种 worst case 下各 HUD 元素世界矩形
       的并集，再外扩「方格半宽18 + 误触安全距12 ≈ 30px」：
       · 顶左：关卡/金币/生命/波次 chips 一条
       · 顶右：选关/倍速/暂停 按钮一条
       · 左下：开始波次按钮 + 波次状态条
       落入区内的火力点/障碍物据点/障碍物一律不生成（canBuildAt 同样拒绝）。
       近方形窗口有黑边吸收 HUD 时多删的只是边缘点，统一裁剪换取两端一致。 */
    "uiSafeZones": [
      { "x": 0,   "y": 0,   "w": 500, "h": 104 },
      { "x": 674, "y": 0,   "w": 286, "h": 104 },
      { "x": 0,   "y": 380, "w": 160, "h": 160 }
    ],
    "touchRadius": 30,       // 点选已有塔/障碍物的热区半径（放大触控）
    /* 统一的圆角方格视觉（替代旧的小绿圈，更饱满、更明显、更卡通） */
    "spotSize": 36,          // 方格边长（世界像素）
    "spotRadius": 10,        // 圆角半径
    "roadSpot": {            // 道路火力点：绿色
      "fill": 0x6fe05f, "fillAlpha": 0.46,
      "border": 0x2e7d1c, "borderAlpha": 0.92
    },
    "campSpot": {            // 障碍物据点：琥珀色（视觉区别于道路点）
      "fill": 0xffc24b, "fillAlpha": 0.52,
      "border": 0xa8680c, "borderAlpha": 0.95
    },
    /* 点击火力点弹出的选塔浮框（替代底部塔栏；全部 JSON 可调）：
       紧凑单行图标栏：每塔=圆图标+名称+价格，整框宽≤屏宽60%、高≤屏高15%；
       半透明深色圆角框，元素色圆图标，金币不足置灰；靠近屏幕边缘自动
       上下翻转/横向钳制；容器整体按画布缩放自适应（GameScene 内实现）。
       otherSpots：浮框弹出期间，所有其他可放置区域以半透明绿色描边方框
       +轻脉冲高亮，让玩家一眼看清哪里还能放塔；关闭浮框后立即消失。 */
    "picker": {
      "spotPickRadius": 30,   // 点击距火力点中心多远算命中（与触控热区一致）
      "itemW": 56,            // 单个塔槽宽（紧凑，容得下圆图标+名称+价格）
      "gap": 4,               // 塔槽间距（收紧）
      "padX": 8,             // 框左右内边距
      "padY": 5,             // 框上下内边距
      "iconR": 13,            // 元素色圆图标半径（4x超采样纹理缩小显示，边缘平滑）
      "offsetY": 22,          // 浮框距火力点的间隔
      "edgeMargin": 8,        // 浮框距画面边缘最小距离
      "nameFS": 12,           // 塔名字号（resolution≥2 渲染，小字号也清晰）
      "costFS": 11,           // 价格字号
      "iconColors": {         // 图标元素色：火红 / 冰蓝 / 水青 / 牵引灰 / 雷紫 / 风绿
        "towerA": 0xff5d4d,
        "towerB": 0x4aa8ff,
        "towerC": 0x2fd6c4,
        "towerD": 0x9aa4ad,
        "towerE": 0x9b6bff,
        "towerF": 0x4ccf7e
      },
      "iconGlyph": {          // 圆图标中央的单字标识
        "towerA": "火", "towerB": "冰", "towerC": "水",
        "towerD": "引", "towerE": "雷", "towerF": "风"
      },
      "otherSpots": {          // 其他可放置区域的高亮样式（浮框弹出期间显示）
        "fill": 0x7CFC00, "fillAlpha": 0.16,   // 半透明草绿填充
        "border": 0x2e7d1c, "borderAlpha": 0.85, // 绿色描边
        "sizeBonus": 6, "radiusBonus": 2,        // 比常驻方格大一圈
        "pulseMin": 0.35, "pulseMax": 0.75, "duration": 600  // 脉冲透明度范围与周期
      }
    }
  },

  /* ---------- 障碍物（放塔无效区的装饰物，可被塔攻击摧毁换金币） ----------
   * 生成规则：在旧交错晶格位置中，取距路径中心线 [minRoadDist, maxRoadDist]
   * 的点——这些位置离路太远，放塔（最短射程 125 / 最长 155 基础射程）
   * 完全打不到路面，属于无效放塔区，因此摆上卡通障碍物：
   *   - 不可放塔（点击仅提示）；
   *   - 点击后由【最近的、射程够得到它的】伤害型塔（A/B/C，塔D 无伤害除外）
   *     转火攻击，攻击障碍物期间不攻击小怪；
   *   - 血量 hp，被摧毁后奖励 reward 金币，血条实时显示攻击进度。 */
  "obstacles": {
    "hp": 1000,              // 障碍物血量
    "reward": 500,           // 摧毁奖励金币
    "radius": 20,            // 判定半径（点击/溅射/弹道命中）
    "minRoadDist": 160,      // 距路心 ≥160：超出全部塔的基础射程（无效放塔区）
    "maxRoadDist": 220,      // 距路心 ≤220：保证附近放塔（含升级射程）够得到
    "spacing": 80,           // 障碍物之间最小间距（避免堆在一起）
    "maxCount": 24,          // 每关障碍物数量上限（避免满屏杂物）
    "kinds": ["rock", "tree", "barrel"],   // 石头 / 树木 / 木桶（卡通贴图）
    /* ---- 障碍物专属火力点（琥珀色据点） ----
       每个障碍物附近至少补一个可放塔的据点，保证“最短射程的塔（塔C 125）
       未升级也能打到它”：攻击判定 reach=射程+radius=145，coverRange 132 留出
       13px 余量；据点首选障碍物朝路方向 coverGap 处（尽量不压道路双排点），
       多个障碍物在 spotShare 内共享同一个据点，避免地图过挤。 */
    "coverSpot": true,       // 是否为每个障碍物保证至少一个专属据点
    "coverRange": 132,       // 据点中心距障碍物中心 ≤ 此值（塔C 125 射程也够）
    "coverGap": 92,          // 据点首选在障碍物朝路方向 92px 处
    "spotShare": 112,        // 相邻障碍物在此距离内共享同一据点
    "spotSpacing": 50        // 据点与其他热区/据点的最小间距
  },

  /* ---------- 终点城堡大门（终点标记 / 怪物进门 / 点击弹窗） ----------
     纹理 castle_gate 由 BootScene 程序化生成（圆润卡通风，与地图同色系）。
     怪物到终点即"进门"：缩入大门消失、扣生命、大门抖动+闪白光。 */
  "castleGate": {
    "width": 78,             // 显示宽（世界单位 px）；高度按贴图 120:128 比例自动换算
    "depth": 10,             // 图层：道路/传送门之上，塔(15)/敌人(20+)之下
    "bottomDy": 32,          // 门底相对终点绘制位置（goalDrawPos）的下移量（门底盖住道路末端圆头）
    "hitPad": 10,            // 点击热区外扩 px（方便手指点按）
    "enterMs": 380,          // 怪物进门动画时长 ms（缩入门内+淡出，0.3~0.5s）
    "shakeDx": 3,            // 被撞时水平抖动幅度 px
    "shakeMs": 48,           // 抖动单程时长 ms
    "shakeRepeat": 3,        // 抖动往返次数（合计≈0.38s，落在 0.3~0.5s，与进门动画协调）
    "flashAlpha": 0.55,      // 撞击白闪峰值透明度
    /* 波次按钮与终点大门避让（仅当本关大门落在左下角波次按钮区内，如第 1 关）：
       给底部 HUD 加类让波次按钮上移避开大门；上移后的新占位并入放塔禁区，
       避免按钮压住火力点。世界坐标（按钮上移量见 style.css .wave-clear-gate）。 */
    "hudAvoid": {
      "btnZone":   { "x": 0, "y": 400, "w": 300, "h": 140 },  // 左下角按钮世界占位（判定用，含药丸）
      "movedZone": { "x": 0, "y": 245, "w": 300, "h": 110 }   // 上移后的新占位（并入放塔禁区）
    },
    /* 进门吸入粒子：怪物进门瞬间少量光点从四周被“吸”向门扇中心后消散，
       数量少、寿命短（≈enterMs），金/白/浅蓝与大门地图同色系。 */
    "enterParticles": 9,     // 粒子数（≤12，控手机性能）
    "particleMs": 340        // 粒子吸入动画时长 ms
  },

  /* ---------- 集火功能（点击怪物） ----------
     点击道路上的怪物 → 标记为集火目标：所有射程覆盖它的伤害型塔
     （塔D 无差别范围吸引除外）优先攻击它；再次点击同一只怪或点击空白取消。
     集火与“点击障碍物转火”按最近一次点击意图互斥切换。 */
  "focusFire": {
    "hitPad": 12,            // 点击热区相对怪物半径外扩 px（放大触控）
    "ringColor": 0xff4d5d,   // 集火光圈颜色（醒目红，区别于障碍物金圈）
    "ringPad": 7,            // 光圈相对怪物半径外扩
    "period": 380            // 光圈脉冲半周期 ms
  },

  /* ---------- 点击大门弹出的公主窗口（半透明悬浮面板） ---------- */
  "princess": {
    "imgSize": 240,          // 公主图片显示边长（正方形，世界单位 px）
    "panelW": 292,
    "panelH": 336,
    "backdropAlpha": 0.42    // 窗口背后压暗层透明度（游戏画面仍可见）
  },

  /* ---------- 经济 ---------- */
  "economy": {
    "startGold": 260,
    "startLives": 20,
    "killRewardBonus": 20    // 每个【小怪】击杀金币在各自 reward 基础上统一增加的数量（BOSS 不享受）
  },

  /* ---------- 波次 ---------- */
  "waves": {
    "intermission": 15,      // 波次间倒计时（秒），可手动提前
    "hpGrowth": 1.5,         // 每波小怪血量复合递增：第 N 波 = 基础 × hpGrowth^(N-1)（+50%）
    "finalWaveHpFactor": 2,  // 末波小怪血量 = 倒数第 2 波（第 4 波）的 2 倍（覆盖递增公式）
    "finalBossHpFactor": 8,  // 末波 BOSS 血量 = 同波小怪（enemyX 当波血量）的 8 倍
    "clearBonus": [50, 100, 150, 200, 250], // 每波清场奖励：第1波50，此后每波 +50
    "list": [
      // 第 1 波
      [
        { "type": "enemyX", "count": 6,  "interval": 0.90, "delay": 0 }
      ],
      // 第 2 波
      [
        { "type": "enemyX", "count": 10, "interval": 0.70, "delay": 0 }
      ],
      // 第 3 波：胖子 + 快兵夹击
      [
        { "type": "enemyY", "count": 4,  "interval": 1.50, "delay": 0 },
        { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 6 }
      ],
      // 第 4 波
      [
        { "type": "enemyX", "count": 10, "interval": 0.45, "delay": 0 },
        { "type": "enemyY", "count": 5,  "interval": 1.30, "delay": 5 }
      ],
      // 第 5 波
      [
        { "type": "enemyY", "count": 8,  "interval": 1.05, "delay": 0 },
        { "type": "enemyX", "count": 16, "interval": 0.40, "delay": 3 }
      ]
    ]
  },

  /* ---------- 塔配置（4 种塔） ----------
   * targeting: furthest = 优先攻击走得最远的敌人
   * projectile.effect.type:
   *   damage      —— 单体伤害
   *   splashSlow  —— 范围伤害 + 减速
   *   pull        —— 无弹道，范围吸引控场（塔D，见 effect 配置）
   * unlock（可选）：塔的解锁条件，缺省 = 第 1 关起默认可用
   *   { "unlockLevel": N } —— 通关第 N-1 关后永久解锁，
   *     仅在第 N 关及之后关卡的商店中可选用（TDStorage 统一判定 + 持久化）
   * upgrade: 每级相对上一级的成长系数                            */
  /* ---------- 元素印记（火/冰/雷/水） ----------
   * 现有塔命中小怪时附加的【视觉标记】（不改变任何塔的伤害/攻速/射程），
   * 供风元素塔检测与扩散。color 用于印记光点、扩散光环与命中光效。
   *   火 fire —— 塔A 单体弹命中附加（projectile.element）
   *   冰 ice  —— 塔B 减速即冰，印记与减速同生同灭（Enemy.applySlow 内同步）
   *   水 water—— 塔C 速射弹命中附加（projectile.element）
   *   雷 thunder—— 塔E 电链命中附加（effect.element） */
  "elements": {
    "fire":    { "name": "火", "color": 0xff7a45 },
    "ice":     { "name": "冰", "color": 0x7fdcff },
    "water":   { "name": "水", "color": 0x4a90e2 },
    "thunder": { "name": "雷", "color": 0xffe23b }
  },

  /* ============================================================
   * 元素反应系统（第 6 关起启用；第 1~5 关仍走旧的纯视觉印记逻辑）
   * ------------------------------------------------------------
   * 附着：元素塔命中附着 attachAmount(=2) 单位，同种元素 attachInterval(0.5s)
   *       内只能附着一次；不同元素可共存，按【附着先后】保序；
   *       每个元素槽独立持续 duration(5s)，到期整槽消散（量不随时间衰减，
   *       只被反应消耗）。
   * 反应：新元素附着时，按附着先后与身上已有的元素依次结算（先附着先反应），
   *       按 cost 系数消耗双方元素量：反应量 u=min(存量A/costA, 存量B/costB)，
   *       消耗 u*costA / u*costB，未消耗完的一方继续保留并继续与后续元素
   *       结算下一轮；倍率【谁先触发谁享受】——只加倍本次攻击伤害，不叠加
   *       给其他塔。风塔扩散的附着 sourceEl=null，只出特效/冰冻，不加倍率。
   * pairs 六种反应（无向配对，cost 按元素名给出，天然支持正反两种附着顺序）：
   *   火+冰 1:1 融化；火+水 1:1 蒸发；水+冰 1:1 冰冻；
   *   水+雷 1:0.5 感电；雷+火 1:1 超载；冰+雷 0.5:1 超导。
   * ============================================================ */
  "elementSystem": {
    "enableFromLevel": 6,       // 元素反应从第 6 关起启用（1~5 关保持原样）
    "attachAmount": 2,          // 每次攻击附着的元素单位
    "spreadAmount": 1,          // 风塔扩散附着的元素单位
    "attachInterval": 0.5,      // 同种元素附着限频（秒）
    "duration": 5,              // 元素附着持续时间（秒）
    "pairs": {
      "fire+ice": {
        "cost": { "fire": 1, "ice": 1 }, "fx": "melt", "label": "融化",
        "multiplier": { "fire": 2, "ice": 1.5 }
      },
      "fire+water": {
        "cost": { "fire": 1, "water": 1 }, "fx": "vaporize", "label": "蒸发",
        "multiplier": { "fire": 2, "water": 1.5 }
      },
      "water+ice": {
        "cost": { "water": 1, "ice": 1 }, "fx": "freeze", "label": "冰冻",
        "freeze": true          // 水+冰：冰冻（无伤害倍率）
      },
      "water+thunder": {
        "cost": { "water": 1, "thunder": 0.5 }, "fx": "charged", "label": "感电",
        "multiplier": { "water": 1.75, "thunder": 1.75 }
      },
      "fire+thunder": {
        "cost": { "fire": 1, "thunder": 1 }, "fx": "overload", "label": "超载",
        "multiplier": { "fire": 1.5, "thunder": 1.5 }
      },
      "ice+thunder": {
        "cost": { "ice": 0.5, "thunder": 1 }, "fx": "superconductor", "label": "超导",
        "multiplier": { "ice": 1.5, "thunder": 1.5 }
      }
    },
    /* 水+冰冰冻；冰冻期间免疫塔D牵引，被牵引脉冲扫到则提前破冰 */
    "freeze": {
      "duration": 2             // 冰冻秒数
    },
    /* 提前破冰 → 易伤（仅小怪；BOSS 改为减速，不吃易伤） */
    "vuln": {
      "perStack": 0.10,         // 每层受伤 +10%
      "maxStacks": 3,           // 最多 3 层（满层 +30%）
      "duration": 5,            // 每层独立持续 5 秒，各自到时消失
      "bossSlowRatio": 0.30     // BOSS 不吃易伤：水+冰反应改为移速降低 30%（系数 0.70）
    }
  },

  "towers": {
    "towerA": {
      "name": "塔A",
      "desc": "单体高伤·攻速慢",
      "cost": 100,
      "color": 0x4a90e2,
      "darkColor": 0x2f6bb3,
      "targeting": "furthest",
      "stats": {
        "damage": 80,         // 一级火塔：80 伤害
        "range": 155,
        "cooldown": 1.0       // 攻击间隔（秒）→ 1 次/秒
      },
      "projectile": {
        "speed": 460,         // 弹道速度 px/s
        "radius": 8,
        "color": 0x9fd0ff,
        "element": "fire",        // 火元素印记（纯视觉标记，伤害不变；供风元素塔扩散）
        "elementDuration": 4,     // 印记持续秒数
        "effect": { "type": "damage", "value": 80 },
        /* 熔岩弹弹幕贴图（assets/lava_bullets.png 离线裁切，见
           build_lava_bullets.py；data URI 模块 LavaBulletData.js）。
           三颗贴图按球径等比烘焙（球纹素 = ballDisplay×superSample=45px），
           运行时 setScale = 等级系数 / superSample，三颗球显示几乎等大，
           等级差异只靠裂纹/拖尾/火星细节。 */
        "lavaBullet": {
          "ballDisplay": 15,
          "superSample": 3,
          "scale": { "1": 1.0, "2": 1.05, "3": 1.10 },
          /* 代码生成的拖尾/火星（贴图仅球体本体，不含拖尾）。
             拖尾长度 = 弹速(460px/s) × lifespan，故拖尾长度只由 lifespan 控制；
             frequency 越小火星越密（拖尾越连贯）。
             目标尾长：lv1≈30px、lv2≈45px、lv3≈65px（短→稍长，差异微妙）。 */
          "trail": {
            "1": { "frequency": 80, "lifespan": 70, "scale": 0.5, "alpha": 0.5 },
            "2": { "frequency": 55, "lifespan": 100, "scale": 0.7, "alpha": 0.55 },
            "3": {
              "frequency": 35, "lifespan": 140, "scale": 0.85, "alpha": 0.6,
              "sparks": { "frequency": 70, "lifespan": 140, "scale": 0.45, "speedMax": 30 }
            }
          }
        }
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,   // 升级费 = 造价 * costFactor * 当前等级
        /* 火塔成长：显式数组（下标 = 等级-1），伤害与攻击间隔双重递增。
           二级 130/0.80s（1.25 次每秒）、三级 200/0.65s（约 1.54 次每秒）。
           range 仍用成长系数（数值写法）。 */
        "damage": [80, 130, 200],
        "range": 1.10,
        "cooldown": [1.0, 0.8, 0.65]
      },

      /* 燃烧视频：lv1/lv3 已由 process_green_videos.py 离线把绿幕物理
         抠成纯黑底（边缘黑度=0），三级全部走 FireVideo 黑底亮度键；
         即使旧缓存走 ADD、任意 GPU shader 失效，黑底仍透明，矩形框
         在像素层面不可能出现。greenKey/whiteKey 参数与 GK/WK 管线
         保留，供将来直接给绿/白幕素材时自动检测启用。 */
      "fireVideo": {
        /* 视频容器显示像素（正方形）。以"火焰实际像素高度"定标：
           displaySize × 画面内火焰高度占比 = 视觉火焰高度。
           实测火焰占比 rY：lv1=0.486、lv2=0.703、lv3=0.780，
           目标视觉高度约 28 / 36 / 48px（三级≈二级 1.33 倍），
           均小于路面 50px 宽度量级，不遮挡道路。 */
        "displaySize": { "1": 58, "2": 51, "3": 62 },
        /* 火焰根部（底部钝端）在视频画面中的纵向比例（上=0 下=1），
           实测火焰包围盒 maxY：lv1=0.75、lv2=0.82、lv3=0.88。
           弹幕发射点 L = displaySize × (muzzleBottom − 0.5)。 */
        "muzzleBottom": { "1": 0.75, "2": 0.82, "3": 0.88 },
        /* 自动检测失败时的回退背景类型（三级视频均为离线黑底） */
        "bgMode": { "1": "black", "2": "black", "3": "black" },
        /* 黑底键控（三级同构）：alpha = clamp(亮度×gain − floor, 0, 1)。
           残留归因实测：旧成品火焰外环带晕圈亮度 0.024~0.035（crf17 环铃
           + 4:2:0 混色），gain1.35/floor0.03 使 lum≤0.0222 全切、0.031→0.012，
           浅色地面上不可见；火焰暗部 0.1→0.105 仅略降透明度。 */
        "blackKey": { "gain": 1.35, "floor": 0.03 },
        /* 绿幕色度键（lv1/lv3）。excess = g − max(r,b)（归一化 0~1）：
           实测背景 excess：lv1≈0.55~0.59、lv3≈0.77~0.89；
           火焰任意像素 r≥g，excess≤0。
           excess≤low 完全保留，≥high 完全抠除，之间 smoothstep 抗锯齿；
           spill 为去绿边（despill）允许量：g 超过 max(r,b)+spill 的
           部分压掉，消除火焰轮廓绿晕。 */
        "greenKey": { "low": 0.10, "high": 0.42, "spill": 0.03 },
        /* 白幕色度键（备用，自动检测到白底视频时启用）。
           whiteness = min(r,g,b)：纯白=1，火焰亮黄内焰 min≈0.45。
           whiteness≤low 完全保留，≥high 完全抠除，之间 smoothstep。 */
        "whiteKey": { "low": 0.55, "high": 0.74 }
      }
    },

    "towerB": {
      "name": "塔B",
      "desc": "范围减速·伤害低",
      "cost": 120,
      "color": 0x53d8e6,
      "darkColor": 0x2a9aa8,
      "targeting": "furthest",
      /* 冰元素塔美术贴图（assets/ice_towers.png 离线裁切，见 build_ice_assets.py；
         纹理键 ice_tower_lv1/2/3）。贴图按高度归一化烘焙（纹素高 =
         baseHeight×superSample=192px，超采样系数在离线脚本中），运行时只按
         高度定标：显示高 = baseHeight × scale[等级]（43.2 / 48 / 52.8px），
         宽按纹理原比例自适应。 */
      "art": {
        "baseHeight": 48,
        "scale": { "1": 0.9, "2": 1.0, "3": 1.1 }
      },
      "stats": {
        "damage": 9,
        "range": 135,
        "cooldown": 1.05
      },
      "projectile": {
        "speed": 330,
        "radius": 9,
        "color": 0xc8f6ff,
        "element": "ice",             // 冰元素（第6关起参与元素反应；1~5关仍为纯视觉印记）
        "effect": {
          "type": "splashSlow",
          "value": 9,
          "splashRadius": 68,
          "slowFactor": 0.50,      // 减速到 50% 移速
          "slowDuration": 1.6      // 持续秒数
        },
        /* 冰弹贴图（assets/ice_bullets.png 离线裁切，见 build_ice_assets.py；
           data URI 模块 IceBulletData.js，纹理键 proj_ice_lv1/2/3）。
           贴图只含雪花本体+近体光晕，烘焙拖尾/冰雾/文字标签均已剔除；
           三颗按雪花臂展等比烘焙（臂展纹素 = bodyDisplay×superSample=54px），
           运行时 setScale = 等级系数 / superSample，臂展显示 18/18.9/19.8px。 */
        "iceBullet": {
          "bodyDisplay": 18,
          "superSample": 3,
          "scale": { "1": 1.0, "2": 1.05, "3": 1.10 },
          /* 雪花持续自转（弧度/秒），六出对称、轻微转动即可增加动感 */
          "spin": { "1": 2.2, "2": 2.8, "3": 3.4 },
          /* 代码生成的冰蓝粒子拖尾（贴图仅雪花本体）。冰弹速度 330px/s，
             拖尾长度 ≈ 弹速 × lifespan：lv1≈30px（很短）、lv2≈46px（中等）、
             lv3≈66px（稍长，仍远小于射程，不遮挡画面）。
             每个粒子沿飞行反方向飘散（speed/angleSpread 控制飘散力度与张角），
             frequency 越小粒子越密；所有参数按等级 JSON 驱动。 */
          "trail": {
            "1": {
              "frequency": 110, "lifespan": 90, "quantity": 1,
              "speed": 8, "angleSpread": 55,
              "scale": 0.42, "alpha": 0.5, "tint": [0xffffff, 0x9fdcff]
            },
            "2": {
              "frequency": 75, "lifespan": 140, "quantity": 1,
              "speed": 12, "angleSpread": 50,
              "scale": 0.58, "alpha": 0.6, "tint": [0xffffff, 0xbfeaff]
            },
            "3": {
              "frequency": 50, "lifespan": 200, "quantity": 2,
              "speed": 16, "angleSpread": 45,
              "scale": 0.72, "alpha": 0.7, "tint": [0xffffff, 0x9fdcff]
            }
          },
          /* 可选：叠加一条浅蓝→透明的渐变光带（ice_ribbon 程序纹理），
             位于弹体后方；长度/粗细/透明度同样随等级 JSON 递增 */
          "ribbon": {
            "1": { "length": 13, "thickness": 2.6, "alpha": 0.28 },
            "2": { "length": 20, "thickness": 3.2, "alpha": 0.34 },
            "3": { "length": 28, "thickness": 4.0, "alpha": 0.4 }
          }
        }
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,
        "damage": 1.70,
        "range": 1.10,
        "cooldown": 0.90
      }
    },

    "towerC": {
      "name": "塔C",
      "desc": "攻速快·伤害低",
      "cost": 80,
      "color": 0x2fd6c4,
      "darkColor": 0x1a9e8e,
      "targeting": "furthest",
      /* 水元素塔美术贴图（assets/water_towers.png 离线裁切，见 build_water_assets.py；
         纹理键 water_tower_lv1/2/3）。贴图按显示尺寸 3 倍整数倍率烘焙
         （纹素高 = 40/47/54 × 3 = 120/141/162px，显示恰为纹理的 1/3，
         无非整数缩放、无二次缩放）。三级显示高度直接按等级配置（JSON 驱动，
         便于调整），一级最小 < 二级中等 < 三级最大；宽按纹理原比例自适应。 */
      "art": {
        "displayHeight": { "1": 40, "2": 47, "3": 54 }
      },
      "stats": {
        "damage": 7,
        "range": 125,
        "cooldown": 0.26
      },
      "projectile": {
        "speed": 560,
        "radius": 6,
        "color": 0x4a90e2,
        "element": "water",       // 水元素印记（纯视觉标记，伤害不变；供风元素塔扩散）
        "elementDuration": 4,
        "effect": { "type": "damage", "value": 7 },
        /* 水弹贴图（程序生成，见 build_water_assets.py；data URI 模块
           WaterBulletData.js，纹理键 proj_water_lv1/2/3）。
           贴图只含水珠/水柱/水球本体，拖尾与水雾由代码粒子生成；
           三颗按最大边等比烘焙（纹素 = bodyDisplay×superSample=54px），
           运行时 setScale = 等级系数 / superSample，显示 ~16.6/18/19.4px。 */
        "waterBullet": {
          "bodyDisplay": 18,
          "superSample": 3,
          "scale": { "1": 0.92, "2": 1.0, "3": 1.08 },
          /* 水弹轻微自转（弧度/秒），增加动感；水珠/水柱/水球均近似径向对称 */
          "spin": { "1": 1.5, "2": 2.0, "3": 2.6 },
          /* 代码生成的水蓝粒子拖尾（贴图仅本体）。水弹速度 560px/s，
             拖尾长度 ≈ 弹速 × lifespan：lv1≈34px（很短）、lv2≈56px（中等）、
             lv3≈84px（稍长，仍远小于射程，不遮挡画面）。
             每个粒子沿飞行反方向飘散（speed/angleSpread 控制力度与张角），
             frequency 越小粒子越密；所有参数按等级 JSON 驱动。 */
          "trail": {
            "1": {
              "frequency": 100, "lifespan": 60, "quantity": 1,
              "speed": 10, "angleSpread": 60,
              "scale": 0.38, "alpha": 0.45, "tint": [0xffffff, 0x9fdcff]
            },
            "2": {
              "frequency": 70, "lifespan": 100, "quantity": 1,
              "speed": 14, "angleSpread": 55,
              "scale": 0.52, "alpha": 0.55, "tint": [0xffffff, 0xbfeaff]
            },
            "3": {
              "frequency": 45, "lifespan": 150, "quantity": 2,
              "speed": 18, "angleSpread": 50,
              "scale": 0.68, "alpha": 0.65, "tint": [0xffffff, 0x8fd0ff]
            }
          },
          /* 叠加一条青蓝→透明的渐变光带（water_ribbon 程序纹理），
             位于弹体后方；长度/粗细/透明度随等级 JSON 递增 */
          "ribbon": {
            "1": { "length": 12, "thickness": 2.4, "alpha": 0.25 },
            "2": { "length": 19, "thickness": 3.0, "alpha": 0.32 },
            "3": { "length": 27, "thickness": 3.8, "alpha": 0.38 }
          }
        }
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,
        "damage": 1.55,
        "range": 1.08,
        "cooldown": 0.85
      }
    },

    /* 塔D —— 范围吸引·控场：不发射弹道，【范围索敌】锁定射程内所有小怪，
       每 attractInterval(2s) 触发一次吸附脉冲，对每只小怪【同等力度】沿道路
       向塔的路径投影点汇聚（越过塔的向后拉、未到塔的向前拉近，对称限幅
       maxDisplace），不分先后、不只吸第一个；吸附窗口内敌人渲染点始终是
       路径上的点，绝不会被拉出道路；【窗口结束位移烘焙进 pathDist——小怪
       停在吸附结束的位置，从该位置继续沿原路径前进，不弹回】，被显著吸引
       期间推进减速（ctrlSlow 0.5）。
       targetFilter=nonBoss：仅小怪生效（enemyX/enemyY 等 cfg.boss 非真），
       BOSS 免疫吸引。升级提高 stats.range 即扩大吸引范围。
       解锁条件：通关第 1 关后自动永久解锁，第 2 关及后续关卡可用
       （第 1 关商店中显示锁定，判定/持久化走 TDStorage）。 */
    "towerD": {
      "name": "塔D",
      "desc": "范围吸引·控场",
      "cost": 110,
      "color": 0xb07bea,
      "darkColor": 0x7a4fb0,
      "unlock": { "unlockLevel": 2 },
      "targeting": "area",
      /* 引力塔美术贴图（assets/gravity_towers.png 横向三连图，离线编码 data URI
         挂 GRAVITY_TOWERS_DATA；运行时由 BootScene 按内容边界裁切三段 + 白幕
         色度键抦图 + 超采样缩放，纹理性 gravity_tower_lv1/2/3）。
         贴图保持原图造型/颜色/大小，不重绘不变形；缺失时回退程序化炮头。 */
      "art": {
        "baseHeight": 40,      // 一级显示高度（世界单位）——缩小整体尺寸，避免遮挡路面/UI
        "scale": { "1": 1.0, "2": 1.08, "3": 1.15 },  // 收窄递增：三级 46px 不过大，等级差异靠磁力线/细节体现
        "superSample": 4      // 纹素高 = 显示高 ×4（DPR2 下仍 2 倍超采，清晰度与其他塔一致）
      },
      "stats": {
        "damage": 0,
        "range": 200,
        "cooldown": 0
      },
      "effect": {
        "type": "pull",
        "targetFilter": "nonBoss", // 只吸小怪：cfg.boss===true 的 BOSS 免疫；缺省/其他值=全敌
        "pullStrength": 10,    // 单次吸附时位移收敛速率（越大越快被拉拢，1/秒），所有小怪同一速率
        "maxDisplace": 130,    // 沿路向塔投影点的最大位移（像素，向前/向后对称限幅），绝不会被拉出道路
        "attractInterval": 2000, // 吸附间隔（毫秒）：每 2 秒触发一次
        "attractDuration": 500   // 单次吸附持续（毫秒）：收敛窗口，结束后停在新位置继续前进（不弹回）
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,
        "damage": 1,
        "range": 1.12,
        "cooldown": 1
      }
    },

    /* 塔E —— 电链弹跳·群伤：射出一道电链，在小怪之间弹跳，最多弹跳 jumps 次。
       弹跳规则：只在小怪中"尚未被本次电链击中过"的目标间传递，不重复弹同一只；
       每次弹跳优先选择距当前目标最近、且未被击中过的小怪（chainRange 内）。
       每升 1 级弹跳次数 +1（upgrade.jumps=1）；每次弹跳伤害递减 10%（×jumpDecay）。
       闪电视觉：折线闪电连线 + 被击中怪短暂高亮，持续 visualDuration 秒。
       解锁条件：通关第 2 关后永久解锁，第 3 关及之后关卡可用。 */
    "towerE": {
      "name": "塔E",
      "desc": "电链弹跳·群伤",
      "cost": 200,
      "color": 0xffe23b,
      "darkColor": 0xd9a81c,
      "unlock": { "unlockLevel": 3 },
      "targeting": "furthest",
      "stats": {
        "damage": 28,
        "range": 140,
        "cooldown": 1.10
      },
      "effect": {
        "type": "chain",
        "element": "thunder",    // 雷元素印记（纯视觉标记，伤害不变；供风元素塔扩散）
        "elementDuration": 4,    // 印记持续秒数
        "jumps": 3,              // 基础弹跳次数（1 级时 3 跳）
        "jumpDecay": 0.90,       // 每跳伤害衰减 10%（伤害 = 上一跳 × 0.90）
        "chainRange": 130,       // 弹跳搜索范围：上一目标到此范围内的最近未被击中怪
        "visualDuration": 0.25   // 闪电视觉持续秒数（0.2~0.3，避免画面杂乱）
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,
        "damage": 1.55,
        "range": 1.10,
        "cooldown": 0.88,
        "jumps": 1             // 每升 1 级弹跳次数 +1（1级3跳/2级4跳/3级5跳）
      },
      "art": {
        "baseHeight": 54,      // 一级显示高度（世界单位）
        "scale": { "1": 1.0, "2": 1.12, "3": 1.24 },  // 逐级递增，三级 ≈ 67px，不遮路面/UI
        // 纹素 = 显示高 × superSample。雷塔源图内容盒高达 965~1213px，
        // 若仍按 4×（216~268px）会 4.5× 降采样，闪电细线被压虚——故用 8×
        // （432~536px，降采样约 2.2×，与火/冰塔一致）。纹理内存增量 <1MB。
        "superSample": 8,
        // tip[等级] = 本体层“实心黄色尖端”在纹素坐标中相对贴图中心的偏移。
        // 现版：BootScene 裁切时从本体贴图实扫黄色像素，写入
        // window.__thunderTipOffset[等级]，Tower 优先取该动态值——发射点 =
        // 塔心 + 旋转矩阵 × 显示缩放 × tip，绝不写死。下面 config.tip 仅作
        // 运行时检测失败的兜底（如全图缺失黄色尖端）。
        "tip": {
          "1": [19.6, -74.8],
          "2": [26.0, -98.9],
          "3": [41.5, -128.8]
        }
      },
      /* 装饰层（thunder_deco_lvN 整张装饰贴图）闪现特效。
         形状 100% 来自 BootScene 从 thunder_deco_all.png 裁出的装饰贴图，
         代码不绘制任何自由形状，只用 per-tower canvas 做"从下往上遮罩显现
         →淡出→间隔→重生"循环，装饰形状逐像素等于贴图。装饰"数量"随等级
         递增由原图本身保证（3 级分叉多于 2 级多于 1 级），代码不做数量控制：
         - interval: 闪现后的平均等待秒（1/2/3 级递减 → 频率递增）
         - reveal:   从下往上遮罩显现持续秒（0.2~0.3）
         - fadeOut:  显现完成后淡出秒
         - maxAlpha: 装饰峰值透明度，默认 0.85 不压过本体 */
      "thunderDeco": {
        "interval":    [0.55, 0.40, 0.32],   // 闪现间隔秒，逐级递减→频率递增（相比旧 0.80/0.55/0.45 更频繁）
        "reveal":      [0.42, 0.36, 0.30],   // 从下往上显现秒（比旧 0.35/0.30/0.25 略慢，1 级更从容可见）
        "fadeOut":     [0.30, 0.26, 0.22],   // 显现完成后淡出秒（比旧略长，峰值停留更久）
        "maxAlpha":    0.95                   // 峰值透明度（从 0.85 提到 0.95，装饰更亮眼）
      }
    },

    /* 风元素塔（towerF）—— 元素扩散·辅助：
       发射风刃命中单只小怪，自身伤害极低（stats.damage=4）；
       命中后检查目标元素印记（火/冰/雷/水，见 TD_CONFIG.elements）：
       - 目标有元素 → 以目标为中心，把该元素扩散给 spreadRadius 内
         【所有无元素】的小怪（已有元素者不覆盖；冰扩散附带真实减速，
         其余元素为视觉标记传播），扩散印记持续 spreadDuration 秒；
       - 目标无元素 → 不扩散，只造成少量伤害。
       扩散冷却 spreadCooldown 秒一次（独立于风刃攻击间隔 stats.cooldown，
       由 WindSpreadBehavior.tryConsumeSpread 判定），避免无限连锁扩散；
       扩散目标 targetFilter=nonBoss：BOSS 不被附加扩散印记（中心目标不限）。
       风刃贴图 proj_wind（旋风）+ spin 旋转，由 BootScene/Projectile 处理。
       解锁：通关第 3 关后永久解锁，第 4 关及之后关卡可用。 */
    "towerF": {
      "name": "风元素塔",
      "desc": "元素扩散·辅助",
      "cost": 130,
      "color": 0x7fe3a8,
      "darkColor": 0x3fae72,
      "unlock": { "unlockLevel": 4 },
      "targeting": "furthest",
      /* 风塔龙卷风美术贴图（assets/wind_towers.png 横向三连图，离线编码
         data URI 挂 WIND_TOWERS_DATA；运行时由 BootScene 按内容边界裁切
         三段 + 绿幕色度键抦图 + 超采样缩放，纹理键 wind_tower_lv1/2/3）。
         龙卷风整体位置不变，每帧绕中心持续旋转，速度 JSON 驱动：
         一级慢 / 二级中等 / 三级最快。缺失时回退程序化炮头。 */
      "art": {
        "baseHeight": 44,      // 一级显示高度（世界单位）= 原 54 的 0.815 倍（整体略缩小，不遮挡路面）
        "scale": { "1": 1.0, "2": 1.12, "3": 1.24 },  // 逐级递增，一级最小/三级最大
        "superSample": 4,     // 纹素高 = 显示高 ×4（DPR2 下仍 2 倍超采，清晰度与其他塔一致）
        "spin": { "1": 1.8, "2": 3.0, "3": 4.5 }  // 龙卷风自转速度（弧度/秒），逐级递增
      },
      /* 龙卷风视频（assets/wind_towers.mp4）实时抠像参数 —— WindVideoGK
         管线专用，与火塔 fireVideo.greenKey 分开配置，互不影响。
         实测（全片 97 帧三段的区域统计）：
           龙卷风本体（含气流弧/水珠）green-excess ≤ 0.24（p99，中位 -0.05）；
           绿幕背景及抗锯齿过渡环 green-excess ≥ 0.62（p1，中位 0.79）。
         两者之间是一段**空档**，把 smoothstep 转折区放在空档里（0.28~0.58）
         即可：本体一像素不抠（内部缺块 0.14%），背景及混色环全部归零
         （0% 残留、0 光晕）。旧值 0.10/0.42 落在本体分布内（本体 5.1% 的
         像素 excess>0.10），会把气流弧/水珠抠成半透明暗斑 —— 即"残缺"。 */
      "windVideo": { "greenKey": { "low": 0.28, "high": 0.58, "spill": 0.03 } },
      "stats": {
        "damage": 4,
        "range": 150,
        "cooldown": 1.20       // 风刃攻击间隔（秒）
      },
      "projectile": {
        "speed": 520,
        "radius": 9,
        "color": 0xbfffd9,
        "texture": "proj_wind",  // 旋风专用贴图（BootScene 按需生成）
        "spin": 12,              // 风刃旋转速度（弧度/秒）
        "effect": { "type": "windSpread", "value": 4 }
      },
      "effect": {
        "type": "windSpread",
        "spreadRadius": 90,        // 扩散半径（像素）
        "spreadDuration": 3.0,     // 扩散出去的印记持续秒数（仅 1~5 关旧印记模式使用）
        "spreadCooldown": 2.5,     // 扩散冷却（秒）：每 2.5s 最多扩散一次
        "spreadMaxTargets": 5,     // 单次最多扩散 5 个小怪（最近且无该元素者优先）
        "spreadAmount": 1,         // 扩散附着 1 单位元素（中心目标元素量不减少）
        "targetFilter": "nonBoss", // 扩散目标仅小怪（中心目标不限）
        "iceSlowFactor": 0.50,     // 冰元素扩散附带的真实减速系数（仅旧印记模式）
        "iceSlowDuration": 1.6     // 冰扩散减速持续秒数（仅旧印记模式）
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,
        "damage": 1.50,
        "range": 1.10,
        "cooldown": 0.90
      }
    }
  },
  "enemies": {
    /* 史莱姆蹦跳视频（全场共享单视频，左段=绿色快怪 / 右段=蓝紫慢怪）。
       快怪/慢怪的【血量/移速/金币】仍由下方 enemyX / enemyY 配置，已满足
       「快怪血低·移速快·金币少 / 慢怪血高·移速慢·金币多」。
       bg/key：实测视频底色 L1 距离抠像参数（换素材须同步重测）；
       displayH：两段显示高度（世界单位，宽按段宽高比自动算，不变形）。
       尺寸依据：视频实测内容宽度/段高 ≈ 绿 0.861 / 蓝 0.933，路宽 50px →
       绿 57（可见宽约 49.1，不超路，维持原值）；蓝 52（可见宽约 48.5，
       原 68 时可见宽 63.4 明显超路，已修正） */
    "slimeVideo": {
      "src": "assets/slime_walk.mp4",
      "bg": { "r": 50.7, "g": 228.7, "b": 57.8 },
      "key": { "low": 0.06, "high": 0.13 },
      "displayH": { "green": 57, "blue": 52 }
    },

    /* BOSS 运动视频（assets/boss_walk.mp4，640x640 绿幕，横排三只：左金/中蓝/右灰）。
       全场共享 1 个视频 + 1 个纹理，三段 frame 按实测元素边界固定分区
       （内容 x[11..213]/[220..421]/[429..627]，段界 0/213.5/426.5/640）。
       displayH = 每只 BOSS 的显示高度（世界单位，宽随段宽高比不变形），
       改这里即可调 BOSS 视频大小。
       尺寸依据：视频实测内容宽度/段高 ≈ 金 0.605 / 蓝 0.623 / 灰 0.605，
       路宽 50px（world.pathWidth）→ displayH 78 时可见宽约 47.2~48.6px，
       三只均不超出路面（112 时可见宽 68~70px，明显超路）。
       三只统一 78（≈0.70×原 112），体型保持相近；要微调只改这三个数。 */
    "bossVideo": {
      "src": "assets/boss_walk.mp4",
      "bg": { "r": 71.0, "g": 220.0, "b": 80.0 },
      "key": { "low": 0.06, "high": 0.13 },
      "displayH": { "gold": 78, "blue": 78, "gray": 78 }
    },

    /* BOSS 死亡视频（三个独立绿幕视频，播放一次不循环）+ 皇冠淡出。
       bg/key = 三个死亡视频统一键控参数（背景实测绿幕中值 36,199,38）；
       maxPlaying = 同时播放的死亡视频上限（超出走降级，控手机性能）；
       playbackRate = 死亡视频播放倍速（1=原速；1.5~2 加快，JSON 驱动），
       结束仍由视频 ended 事件驱动 → 皇冠淡出/销毁时序自动跟随，不受影响；
       videoFade = 死亡视频播完后整层淡出时长 ms（爆炸残留粘液自然消失）；
       crownFadeIn = 皇冠淡入时长 ms（与视频层 300ms 淡出交叉溶解，消除
       视频皇冠→代码皇冠交接的突变）；
       crownFade = 皇冠落地后缓慢淡出时长 ms（JSON 驱动，1~2 秒）；
       deathDisplayH = 死亡爆炸显示高度（世界单位）。尺寸依据：逐帧实测
       三个视频最大内容宽 640/510/536 → 显示高 50/62/59 时可见宽均 ≤ 50
       （= 路宽 world.pathWidth，与 Boss 生前可见宽 47~49 一致），爆炸/
       粘液/皇冠全程不超出路面；原 240 时爆炸可见宽 240 明显超路。
       crownDisplayH = 皇冠显示高度（随 deathDisplayH 等比缩放：
       42/30/30 × 新 dh/240 ≈ 9/8/7，与视频中的皇冠观感一致）；
       crownAnchor = 皇冠在死亡视频里的落点（视频像素坐标，换算到世界
       位置；实测末帧皇冠中心 gold(322,434)/blue(322,391)/gray(323,394)，
       与配置误差 ≤1px，保持不变）。 */
    "bossDeath": {
      "src": "assets/boss_death_#KEY#.mp4",
      "bg": { "r": 36.0, "g": 199.0, "b": 38.0 },
      "key": { "low": 0.06, "high": 0.13 },
      "maxPlaying": 2,
      "playbackRate": 1.75,    // 死亡动画加速：1.75 倍速（1=原速，可调 1.5~2）
      "videoFade": 300,
      "crownFadeIn": 200,      // 皇冠淡入（与视频层淡出交叉溶解）
      "crownFade": 1500,       // 皇冠缓慢淡出（1~2 秒，Sine 平滑）
      "deathDisplayH": { "gold": 50, "blue": 62, "gray": 59 },
      "crownDisplayH": { "gold": 9, "blue": 8, "gray": 7 },
      "crownAnchor": {
        "gold": { "x": 321, "y": 434 },
        "blue": { "x": 322, "y": 392 },
        "gray": { "x": 323, "y": 394 }
      }
    },

    "enemyX": {
      "name": "敌人X",
      "hp": 46,
      "speed": 98,          // px/s
      "radius": 15,
      "reward": 9,          // 击杀金币
      "leakDamage": 1,      // 到达终点扣生命
      "color": 0xff6b6b,
      "darkColor": 0xc94444,
      /* 显示高度（世界单位）：宽按贴图/视频段宽高比自动算，保持造型不变形；
         超采样静态贴图 / 高分辨率视频经 setDisplaySize 缩回世界尺寸，
         DPR 下与塔清晰度一致。
         静态贴图宽高比实测 1.04 → h 46 时宽约 47.8 ≤ 路宽 50（视频版由
         slimeVideo.displayH 驱动，绿怪 57 可见宽约 49.1 同样不超路） */
      "art": { "h": 46, "superSample": 2 },
      /* 绿幕视频接管：绿色快怪=左段；视频不可用时回退静态贴图 + 蹦跳 Tween */
      "slimeVideo": { "frame": "green", "hopHeight": 6 }
    },
    "enemyY": {
      "name": "敌人Y",
      "hp": 175,
      "speed": 45,
      "radius": 19,
      "reward": 18,
      "leakDamage": 2,
      "color": 0xa06cd5,
      "darkColor": 0x7447a6,
      /* 静态贴图宽高比实测 1.167 → h 41 时宽约 47.8 ≤ 路宽 50
         （原 60 时宽 70 明显超路；视频版由 slimeVideo.displayH 驱动：
         蓝 68→52，可见宽 63.4→48.5，同样修正不超路） */
      "art": { "h": 41, "superSample": 2 },
      /* 绿幕视频接管：蓝紫慢怪=右段 */
      "slimeVideo": { "frame": "blue", "hopHeight": 7 }
    },

    /* BOSS —— 第 2 关末波末敌。血量/漏血在 GameScene.spawnEnemy 动态覆盖：
       血量 = 同波小怪(enemyX)末波血量 × waves.finalBossHpFactor(8)，
       漏血 = 普通怪漏血 × boss.leakMultiplier；这里 hp/leakDamage 仅作
       兜底占位。boss=true 标记触发大体型/更粗血条/特殊贴图（皇冠角）。 */
    "enemyBoss": {
      "name": "BOSS",
      "hp": 2480,
      "speed": 38,
      "radius": 30,
      "reward": 120,
      "leakDamage": 3,
      "color": 0xff3b3b,
      "darkColor": 0x8a1212,
      "boss": true,
      "barThickness": 8,
      /* 显示高度（世界单位）：三只 BOSS 贴图（assets/bosses.png 裁出）宽高比
         实测约 0.74，宽自动算 → h 65 时宽约 48 ≤ 路宽 50（原 90 时宽 66
         超路；与视频版可见宽 47~49 一致），保持原造型不变形；贴图 3x 超采样
         （270px 高）经 setDisplaySize 缩回，DPR 下与塔清晰度一致 */
      "art": { "h": 65 }
    }
  },

  /* ---------- BOSS 全局系数 ---------- */
  "boss": {
    "hpMultiplier": 8,      // 兜底：BOSS 血量 = 同波小怪血量 × 此值（末波实际走 waves.finalBossHpFactor）
    "leakMultiplier": 3,    // BOSS 漏怪扣生命 = 普通怪(enemyX)漏血 × 此值
    "rewardBonus": 0,      // 击杀额外金币（已含在 enemyBoss.reward）

    /* 三只 BOSS 变体（对应 assets/bosses.png 从左到右：金 / 蓝 / 灰），
       tex = 离线裁切+白底抠图后的贴图键（js/BossArtData.js）；全部 JSON 驱动：
         hp   = 同波小怪末波血量 × waves.finalBossHpFactor × hpMul（保留你现有设定）
         speed= 本怪移速(px/s)；leakMul = 漏怪扣生命 = 普通怪漏血 × 此值（默认 3）
         reward = 击杀金币（BOSS 不吃小怪金币加成）
       改成你想要的数值即可，无需改代码。 */
    "variants": [
      { "key": "gold", "tex": "boss_gold", "hpMul": 1,    "speed": 38, "leakMul": 3, "reward": 120 },
      { "key": "blue", "tex": "boss_blue", "hpMul": 1.2,  "speed": 34, "leakMul": 3, "reward": 150 },
      { "key": "gray", "tex": "boss_gray", "hpMul": 1.45, "speed": 30, "leakMul": 3, "reward": 190 }
    ],
    /* 波次索引(0 起) → 变体下标：第 3/4/5 波(索引 2/3/4) = 金/蓝/灰 BOSS，
       同一关内三种 BOSS 依次登场；表外波次回退下标 0（金色） */
    "waveVariant": { "2": 0, "3": 1, "4": 2 }
  },

  /* ---------- 关卡独立配置 ----------
   * 每关一份：path(路径点)/waves(波次，含 hpGrowth/finalWaveHpFactor/
   * finalBossHpFactor/clearBonus)/economy(起始金币生命)。Level 1 不在此
   * 登记，GameScene 回退到顶层 path/waves/economy。
   * hpGrowth=1.5 = 每波血量 +50%（复合）；末波小怪 = 第 4 波 ×2，
   * 末波 BOSS = 同波小怪 ×8。 */
  "levels": {
    "2": {
      "economy": { "startGold": 300, "startLives": 20 },
      "build": { "cell": 76 },   // 第 2 关：道路火力点比新手关略密，拐弯/直线均无火力空白
      "path": {
        "waypoints": [
          { "x": -40, "y": 100 },
          { "x": 720, "y": 100 },
          { "x": 720, "y": 250 },
          { "x": 460, "y": 250 },
          { "x": 460, "y": 400 },
          { "x": 820, "y": 400 },
          { "x": 820, "y": 580 }
        ],
        "borderColor": 0xc99a54,
        "fillColor": 0xeac58f
      },
      "waves": {
        "intermission": 15,
        "hpGrowth": 1.5,
        "finalWaveHpFactor": 2,
        "finalBossHpFactor": 32,
        "clearBonus": [50, 100, 150, 200, 250],
        "list": [
          [ { "type": "enemyX", "count": 8,  "interval": 0.80, "delay": 0 } ],
          [ { "type": "enemyX", "count": 12, "interval": 0.60, "delay": 0 } ],
          [ { "type": "enemyY", "count": 4,  "interval": 1.50, "delay": 0 },
            { "type": "enemyX", "count": 10, "interval": 0.55, "delay": 6 } ],
          [ { "type": "enemyX", "count": 14, "interval": 0.45, "delay": 0 },
            { "type": "enemyY", "count": 5,  "interval": 1.30, "delay": 6 } ],
          /* 末波末敌 = BOSS（delay=10 落在所有小怪之后，spawnList 排序后为最后一个） */
          [ { "type": "enemyX", "count": 16, "interval": 0.40, "delay": 0 },
            { "type": "enemyY", "count": 3,  "interval": 1.50, "delay": 4 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 10 } ]
        ]
      }
    },

    /* ---------- 第 3 关：双出怪路线 ----------
     * 两条独立路线（paths[0]=上路 / paths[1]=下路），各一个起点；
     * 两路在两个汇合点合并后再分叉，最终在 finalMerge 汇合通向同一终点。
     * 两路怪物配置完全相同，波次/数量/血量一致，两边同时出怪
     * （GameScene.startWave 按 routeGeoms 数量复制每波 group 到全部路线）。
     * 小怪血量每波复合 +50%（hpGrowth=1.5，finalWaveSpecial=false 不走末波翻倍）。
     * BOSS：第 3、4 波 = 当波小怪(enemyX)血量 ×16，第 5 波 = ×40
     * （per-group bossHpFactor 驱动，覆盖 finalBossHpFactor 兜底）。 */
    "3": {
      "economy": { "startGold": 320, "startLives": 25 },
      "killRewardAdjust": 0,   // 第 3 关小怪击杀金币调整值（0=标准，与第1-2关一致；reward=基础+killRewardBonus+此值）
      "build": {
        "cell": 76,
        /* 第 3 关专属额外火力点：覆盖道路间的空地，不压路、不阻碍行进，
           布局整齐（多在两路之间中带），方便玩家放塔E与其他塔。
           新增 9 点覆盖左侧中带、两路汇合点上下方及末波 BOSS 行进路线关键位置 */
        "extraSpots": [
          { "x": 90, "y": 200 }, { "x": 90, "y": 340 },
          { "x": 250, "y": 270 },
          { "x": 590, "y": 270 },
          { "x": 780, "y": 200 }, { "x": 780, "y": 340 },
          { "x": 680, "y": 230 }, { "x": 680, "y": 310 },
          { "x": 40, "y": 270 },  { "x": 170, "y": 270 },
          { "x": 380, "y": 110 }, { "x": 380, "y": 430 },
          { "x": 470, "y": 110 }, { "x": 470, "y": 430 },
          { "x": 720, "y": 110 }, { "x": 720, "y": 430 },
          { "x": 820, "y": 400 }
        ]
      },
      "path": {
        "borderColor": 0xc99a54,
        "fillColor": 0xeac58f
      },
      "paths": [
        [
          { "x": -40, "y": 80 },
          { "x": 160, "y": 80 },
          { "x": 160, "y": 175 },
          { "x": 300, "y": 175 },
          { "x": 420, "y": 270 },
          { "x": 530, "y": 175 },
          { "x": 650, "y": 175 },
          { "x": 740, "y": 270 },
          { "x": 810, "y": 210 },
          { "x": 880, "y": 270 },
          { "x": 880, "y": 580 }
        ],
        [
          { "x": -40, "y": 460 },
          { "x": 160, "y": 460 },
          { "x": 160, "y": 365 },
          { "x": 300, "y": 365 },
          { "x": 420, "y": 270 },
          { "x": 530, "y": 365 },
          { "x": 650, "y": 365 },
          { "x": 740, "y": 270 },
          { "x": 810, "y": 330 },
          { "x": 880, "y": 270 },
          { "x": 880, "y": 580 }
        ]
      ],
      "waves": {
        "intermission": 15,
        "hpGrowth": 1.5,
        "waveHpMul": [1, 2, 2, 2, 1],  // 按波次(0起)小怪血量额外乘数：第 2/3/4 波 ×2（翻倍），第 1/5 波不变；仅非 BOSS，BOSS 血量公式不变
        "finalWaveSpecial": false,
        "finalWaveHpMul": 2,           // 第 3 关末波小怪血量额外 ×2（翻倍），仅末波非 BOSS
        "finalWaveDmgReduction": 0.10, // 第 3 关末波小怪 10% 伤害减免（受击伤害 ×90%）
        "finalBossHpFactor": 40,
        "clearBonus": [50, 100, 150, 200, 250],
        "firstWaveRouteOnly": true,   // 第 1 波仅上路（route 0）出怪，下路不出
        "firstWaveClearBonus": 200,    // 第 1 波结束额外一次性奖励 200 金币
        "list": [
          [ { "type": "enemyX", "count": 8,  "interval": 0.80, "delay": 0 } ],
          [ { "type": "enemyX", "count": 12, "interval": 0.60, "delay": 0 },
            { "type": "enemyY", "count": 3,  "interval": 1.50, "delay": 4 } ],
          [ { "type": "enemyX", "count": 14, "interval": 0.50, "delay": 0 },
            { "type": "enemyY", "count": 4,  "interval": 1.30, "delay": 5 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 12, "bossHpFactor": 16 } ],
          [ { "type": "enemyX", "count": 16, "interval": 0.45, "delay": 0 },
            { "type": "enemyY", "count": 5,  "interval": 1.20, "delay": 5 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 12, "bossHpFactor": 16 } ],
          [ { "type": "enemyY", "count": 6,  "interval": 1.20, "delay": 0 },
            { "type": "enemyX", "count": 20, "interval": 0.40, "delay": 3 },
            { "type": "enemyX", "count": 12, "interval": 0.45, "delay": 8 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 14, "bossHpFactor": 40 } ]
        ]
      }
    },

    /* ---------- 第 4 关：交错迷域（右路并入左路 + 右路岔路传送门 + 支线波） ----------
     * 共 4 条路线几何：
     *   route 0（左主线）：屏幕左侧出怪 → 右行 → 下行，在 (230,170) 与右路
     *                     汇合（原左绕钩 (150,170)→(150,340)→(480,340) 已删，
     *                     右路直接在此并入）→ 右行 → 下行，途经交汇点
     *                     (480,340) 后通向底部终点；
     *   route 1（右主线）：屏幕右侧出怪 → 左行至岔路口 (720,170)（主路在此
     *                     左转、岔路 route 2 继续直行向下）→ 长横段左行至
     *                     (230,170) 并入左路（与 route 0 共线）→ 下行 →
     *                     右行 → 沿 x=480 下行到终点；
     *   route 2（右路岔路）：前 3 个路径点与 route 1 完全重合（同从右侧出怪，
     *                     视觉上就是“在右路上开出的岔路”，无断裂/错位/粗细差），
     *                     在岔路口继续下行绕一个卡通弯钩，末端 (690,420) =
     *                     传送门 A（入口，恒在道路上）；
     *   route 3（汇合尾段）：仅 (480,340)→(480,580) 一段，起点即交汇点 =
     *                     传送门 B（出口），坐标与 route 0/1 尾段重合。
     * 出怪：常规 5 波 spawnRoutes=[0,1]，左右同配置同时出怪；
     *       branchSpawns 从第 2 波起每波在 route 2（右侧岔路）追加一批
     *       小怪（第 1 波不加），与主波同场清场（JSON 驱动 list/startWave，
     *       血量按当前波水平、速度比普通怪快 10%（JSON 驱动 speedBonus），
     * 传送门：仅 1 对 A→B（岔路末端 → 交汇点），单向；小怪传送后 0.5s
     *       无敌且不可被索敌；位置全部取自路径点索引，绝不会传到道路外。
     * 血量/BOSS：每波小怪血量复合 +60%（hpGrowth=1.6，无末波特例翻倍）；
     *       第 3、4 波 BOSS = 当波小怪 ×16，第 5 波（末波）= ×50（per-group）。 */
    "4": {
      "economy": { "startGold": 320, "startLives": 20 },
      "build": {
        "cell": 76,
        /* 第 4 关专属额外火力点（buildHotspots 统一做界内/避路/去重硬校验）：
           自动双排点在多路平行道之间（路间距 80~90）存在几何空白带，
           这里补 17 个点——重点覆盖两处「躺着的 L」拐弯及其上方边缘区、
           中间横向道路上方区域，另补交汇点西南、钩弯两侧、传送门 A 周边、
           汇合尾段与左侧补点；全部距路心 60~124（最短射程塔也打得到路面），
           绝不压路。（原 (92,380)/(100,444) 两点专为已删除的左绕钩路段服务，
            路段删除后打不到任何道路，同步移除。） */
        "extraSpots": [
          { "x": 300, "y": 44 },  { "x": 356, "y": 52 },  // 左主线拐弯(230,80)上方
          { "x": 420, "y": 52 },  { "x": 500, "y": 52 },
          { "x": 580, "y": 52 },                            // 中间横向道路上方区域（圈出位置）
          { "x": 640, "y": 44 },                            // 右主线拐弯(720,80)上方
          { "x": 80, "y": 200 },                            // 左侧补点
          { "x": 140, "y": 300 },  { "x": 200, "y": 380 },  // 左侧中下部补点
          { "x": 420, "y": 400 },                           // 交汇点(480,340)西南
          { "x": 856, "y": 212 }, { "x": 912, "y": 248 },  // 岔路竖段右侧
          { "x": 640, "y": 316 },                           // 钩弯(720,290)西侧
          { "x": 632, "y": 388 },                           // 传送门 A 西北
          { "x": 620, "y": 452 },                           // 汇合尾段东侧
          { "x": 844, "y": 496 }, { "x": 900, "y": 476 }   // 钩弯/门户路右下方
        ]
      },
      "path": {
        "borderColor": 0xc99a54,
        "fillColor": 0xeac58f
      },
      "paths": [
        /* route 0：左主线（左出怪 → 汇合点 (230,170) → 交汇点 → 底部终点） */
        [
          { "x": -40, "y": 80 },
          { "x": 230, "y": 80 },
          { "x": 230, "y": 260 },    // 竖段在 (230,170) 与 route1 汇合（右路在此并入）
          { "x": 480, "y": 260 },
          { "x": 480, "y": 580 }     // 途经交汇点 (480,340)（传送门 B 出口），到底部终点
        ],
        /* route 1：右主线（右出怪 → 岔路口 → (230,170) 并入左路 → 底部终点；
           原左绕钩 (150,170)→(150,340)→(480,340) 已按需求删除，自汇合点起
           与 route0 完全共线，无断裂/错位/粗细差） */
        [
          { "x": 1000, "y": 80 },
          { "x": 720, "y": 80 },
          { "x": 720, "y": 170 },    // 岔路口：主路左转，岔路(route2)继续下行
          { "x": 230, "y": 170 },    // 长横段左行至此并入 route0（原交叉点）
          { "x": 230, "y": 260 },    // 以下与 route0 完全共线
          { "x": 480, "y": 260 },
          { "x": 480, "y": 580 }
        ],
        /* route 2：右路岔路（与 route1 共线至岔路口 → 弯钩 → 传送门 A 入口） */
        [
          { "x": 1000, "y": 80 },
          { "x": 720, "y": 80 },
          { "x": 720, "y": 170 },    // 岔路口（与主路自然 T 接，无断点）
          { "x": 720, "y": 290 },
          { "x": 820, "y": 290 },
          { "x": 820, "y": 420 },
          { "x": 690, "y": 420 }     // 末端 = 传送门 A 入口（在道路中心线上）
        ],
        /* route 3：汇合尾段（起点 = 交汇点 = 传送门 B 出口 → 底部终点） */
        [
          { "x": 480, "y": 340 },
          { "x": 480, "y": 580 }
        ]
      ],
      /* 传送门配置（全部 JSON 驱动）：
         pairs[].a/b = { route 路线号, waypoint 路径点索引 }（恒在道路上）；
         direction: "oneway" 仅 A→B；
         affectBoss: BOSS 是否也被传送（本关岔路仅供小怪支线，置 false）；
         invulnTime: 传送后无敌/不可选中秒数。 */
      "portals": {
        "invulnTime": 0.5,
        "pairs": [
          {
            "id": "branch",
            "a": { "route": 2, "waypoint": 6 },
            "b": { "route": 3, "waypoint": 0 },
            "direction": "oneway",
            "affectBoss": false
          }
        ]
      },
      "waves": {
        "intermission": 15,
        "spawnRoutes": [0, 1],        // 常规波仅 route 0/1 出怪（route 2 只走支线波，route 3 不出怪）
        "hpGrowth": 1.6,              // 每波小怪血量 +60%（复合）
        "finalWaveSpecial": false,    // 不走末波特例翻倍，纯 1.6 复合成长
        "finalBossHpFactor": 50,      // 末波 BOSS 兜底 50 倍（per-group 同值显式驱动）
        "clearBonus": [50, 100, 150, 200, 250],
        /* 右侧出怪（route 1）专属加成（JSON 驱动，仅第 4 关）：
           goldBonus=5 → 击杀右侧小怪额外 +5 金币；
           hpMul=1.5 → 右侧小怪血量在波次成长基础上再 ×1.5；
           仅非 BOSS 生效，BOSS 数值公式不受影响。 */
        "routeBonus": {
          "1": { "goldBonus": 5, "hpMul": 1.5 }
        },
        /* 末波右侧小怪免伤（JSON 驱动，仅第 4 关第 5 波 route 1）：
           0.10 = 受击伤害 ×90%（10% 减免），仅非 BOSS 生效 */
        "finalWaveRouteDmgReduction": {
          "1": 0.10
        },
        /* 右侧岔路【每波追加批次】（JSON 驱动 branchSpawns，机制仅本关启用）：
           startWave=2 → 第 1 波不加，从第 2 波起每波都额外来一批；
           routes=[2] → 仅右侧岔路出怪，左路不额外加怪；
           list 与主波 list 逐波对齐（null=该波不追加）；
           速度比普通小怪快 10%（speedBonus=0.10，JSON 驱动可调）；
           数量 JSON 配置，血量自动按【当前波】水平计算（hpWaveIndex
           留空 → waveSmallHp 取当前 waveIndex，天然遵循每波 +60%）；
           怪物沿右路进入岔路 → 传送门 → 交汇点 → 汇合段终点。 */
        "branchSpawns": {
          "startWave": 2,
          "routes": [2],
          "speedBonus": 0.10,
          "countBonus": 3,
          "list": [
            null,                       // 第 1 波：不追加
            [ { "type": "enemyX", "count": 6, "interval": 0.70, "delay": 1 } ],
            [ { "type": "enemyX", "count": 8, "interval": 0.60, "delay": 0 },
              { "type": "enemyY", "count": 2, "interval": 1.40, "delay": 5 } ],
            [ { "type": "enemyX", "count": 9, "interval": 0.55, "delay": 0 },
              { "type": "enemyY", "count": 3, "interval": 1.20, "delay": 5 } ],
            [ { "type": "enemyY", "count": 3, "interval": 1.20, "delay": 0 },
              { "type": "enemyX", "count": 10, "interval": 0.50, "delay": 3 } ]
          ]
        },
        /* 两路怪物配置完全相同、同时出怪（startWave 按 spawnRoutes 复制）；
           BOSS 波左右各出一只，交叉/交汇后在汇合段合流 */
        "list": [
          [ { "type": "enemyX", "count": 5,  "interval": 0.80, "delay": 0 } ],
          [ { "type": "enemyX", "count": 8,  "interval": 0.60, "delay": 0 },
            { "type": "enemyY", "count": 2,  "interval": 1.50, "delay": 5 } ],
          [ { "type": "enemyX", "count": 9,  "interval": 0.50, "delay": 0 },
            { "type": "enemyY", "count": 3,  "interval": 1.30, "delay": 5 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 12, "bossHpFactor": 16 } ],
          [ { "type": "enemyX", "count": 10, "interval": 0.45, "delay": 0 },
            { "type": "enemyY", "count": 3,  "interval": 1.20, "delay": 5 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 12, "bossHpFactor": 16 } ],
          [ { "type": "enemyY", "count": 4,  "interval": 1.20, "delay": 0 },
            { "type": "enemyX", "count": 12, "interval": 0.40, "delay": 3 },
            { "type": "enemyX", "count": 7,  "interval": 0.45, "delay": 9 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 14, "bossHpFactor": 50 } ]
        ],
        /* 末波右侧额外追加一批（JSON 驱动 finalWaveExtraGroups，仅第 4 关第 5 波）：
           仅 route 1（右侧）出怪，不替代/不影响 BOSS（BOSS 仍按 delay=14 最后出现）；
           血量/数量按第 5 波规则计算（routeBonus 叠加生效）。 */
        "finalWaveExtraGroups": [
          { "type": "enemyX", "count": 8, "interval": 0.45, "delay": 6 }
        ]
      }
    },

    /* ---------- 第 5 关：迷域回廊（最终关：左右对开 + 岔路传送 + 中央纵向主路 + 三阶 BOSS） ----------
     * 几何（v20260924k：合并左右传送出口、中央主路纵贯至顶部终点）：
     *   route 0 左路 = 左侧出怪 (-40,300) 向右 → (250,300) 岔路口 → 向上岔路至
     *                  (250,140) 岔路顶传送门 → 折回 (250,300) → (380,300) →
     *                  (500,380) 合并传送出口（两路传送终点统一于此）→ (500,70)。
     *   route 1 右路 = 右侧出怪 (1040,300) 向左，镜像对称（岔路口 750、岔路顶
     *                  (750,140)、(620,300)、汇合 (500,380)、终点 (500,70)）。
     *   两路在 (500,380) 汇合后共用一条中央纵向主路，向上直通地图最上方
     *   (500,70) 的唯一终点洞穴，形成纵贯中上部的「出怪长河」。
     * 传送门 2 对（单向，同色配对、无字母）：
     *   forkL: 岔路顶(250,140) → (500,380)，affectBoss:false
     *          （小怪到岔路顶即被传到中央合并出口；BOSS 不传送，走完整路线
     *           含岔路折返+主路中段→汇合→上行，全程 ~1030px，三阶段窗口充足）；
     *   forkR: 岔路顶(750,140) → (500,380)，镜像同上。
     *   左右传送出口已合并到中央同一坐标 (500,380)，怪汇聚于中央主路。
     * 单终点：goals 两条路线同指 (500,70) 洞穴，任一边漏怪扣同一条命。
     * 波次：常规 5 波 spawnRoutes=[0,1]（左右同时出怪、集中涌向顶部，制造
     *       巨大出怪量）；hpGrowth=1.6；第 3/4 波 BOSS=×16，第 5 波 BOSS=×50
     *       并启用三阶段（bossPhases）。 */
    "5": {
      "economy": { "startGold": 500, "startLives": 20 },
      "build": {
        "cell": 76,
        /* 第 5 关专属额外火力点（buildHotspots 统一做界内/避路/去重硬校验）：
           自动点已贴全部路段两侧 62px，这里补足两岔路之间上部的纵深覆盖
           （岔路在 y∈[140,300]，上部空缺 y<140 区域无法靠自动点填到） */
        "extraSpots": [
          { "x": 300, "y": 100 }, { "x": 400, "y": 100 }, { "x": 500, "y": 100 },
          { "x": 600, "y": 100 }, { "x": 700, "y": 100 },   // 顶部内区一排（覆盖岔路上段/主路顶端）
          { "x": 440, "y": 175 }, { "x": 560, "y": 175 },  // 岔路间中带一排（主路中段两侧）
          { "x": 380, "y": 110 }, { "x": 460, "y": 110 },  // 顶部补充（y=100 排部分被去重剔除，改用 y=110）
          { "x": 540, "y": 110 }, { "x": 620, "y": 110 }   // 与 y=100 排交替覆盖上部两侧
        ]
      },
      "path": { "borderColor": 0xc99a54, "fillColor": 0xeac58f },
      /* 第 5 关专属额外障碍物（JSON 驱动，追加在自动生成之外）：
         补充在大片空旷区（距路 109~141，不压路、不阻碍小怪行进），
         血量/奖励沿用全局 obstacles 配置（1000 / 500 金币）；每个点
         132 内均有火力点（塔C 攻击口径 145 可打到），据点机制照常补位 */
      "extraObstacles": [
        { "x": 286, "y": 36 }, { "x": 361, "y": 66 }, { "x": 606, "y": 36 },
        { "x": 121, "y": 191 }, { "x": 861, "y": 176 },
        { "x": 161, "y": 411 }, { "x": 386, "y": 441 }, { "x": 441, "y": 501 },
        { "x": 521, "y": 491 }
      ],
      "paths": [
        /* route 0：左路（左侧出怪向右 → 岔路口上拐 → 岔路顶传送门 → 折回 →
           主路中段 → 中央汇合（=合并传送出口）→ 中央纵向主路上行至顶部终点。
           小怪在岔路顶即被传到 (500,380)；BOSS 走完整路线含岔路折返） */
        [
          { "x": -40, "y": 300 },
          { "x": 250, "y": 300 },   // w1 = 岔路口（向上开岔）
          { "x": 250, "y": 140 },   // w2 = 岔路顶 = 传送门入口（forkL）
          { "x": 250, "y": 300 },   // w3 = 折回岔路口（仅不传送的 BOSS 走）
          { "x": 380, "y": 300 },   // w4 = 主路中段
          { "x": 500, "y": 380 },   // w5 = 中央汇合点 = 合并传送出口（两路统一于此）
          { "x": 500, "y": 70 }     // w6 = 终点洞穴（地图最上方）
        ],
        /* route 1：右路（右侧出怪向左，与左路镜像对称） */
        [
          { "x": 1040, "y": 300 },
          { "x": 750, "y": 300 },   // w1 = 岔路口（向上开岔）
          { "x": 750, "y": 140 },   // w2 = 岔路顶 = 传送门入口（forkR）
          { "x": 750, "y": 300 },   // w3 = 折回岔路口（仅不传送的 BOSS 走）
          { "x": 620, "y": 300 },   // w4 = 主路中段
          { "x": 500, "y": 380 },   // w5 = 中央汇合点 = 合并传送出口
          { "x": 500, "y": 70 }     // w6 = 终点洞穴（地图最上方）
        ]
      ],
      /* 单终点（JSON 驱动）：两条路线末路径点同为 (500,70)，洞穴重叠绘制为
         同一个；任一路线漏怪都扣同一条命（HUD 单生命显示） */
      "goals": [
        { "route": 0 },
        { "route": 1 }
      ],
      /* 传送门 2 对（岔路顶 → 中央合并出口 (500,380)，单向，同色配对、无字母）；
         affectBoss:false（BOSS 不传送，走完整路线含岔路折返，三阶段可控）；
         传送后 0.5s 无敌 */
      "portals": {
        "invulnTime": 0.5,
        "pairs": [
          { "id": "forkL",
            "a": { "route": 0, "waypoint": 2 },
            "b": { "route": 0, "waypoint": 5 },
            "direction": "oneway", "affectBoss": false },
          { "id": "forkR",
            "a": { "route": 1, "waypoint": 2 },
            "b": { "route": 1, "waypoint": 5 },
            "direction": "oneway", "affectBoss": false }
        ]
      },
      "waves": {
        "intermission": 15,
        "spawnRoutes": [0, 1],        // 左右两路同时出怪（共享终点同一生命）
        "hpGrowth": 1.6,              // 每波小怪血量 +60%（复合）
        "finalWaveSpecial": false,
        "finalBossHpFactor": 50,      // 末波 BOSS = 当波小怪 ×50
        "clearBonus": [50, 100, 150, 200, 250],
        /* 三阶段 BOSS（仅末波 BOSS 生效，第 3/4 波 BOSS 不参与）：
           血量阈值分裂 → 3 分身（总量=剩余×splitHpMul）→ 全灭合体回血 */
        "bossPhases": {
          "splitAtHpRatio": 0.40,     // 降到最大血量 40% 时分裂
          "splitHpMul": 1.0,          // 分身总血量 = 分裂时剩余血量 × 该系数
          "splitCount": 3,            // 分身数量
          "mergeHealRatio": 0.50,     // 合体血量 = 分身总血量 × 该回血比例
          "finalScale": 1.25,         // 强化 BOSS 体型放大
          "miniScale": 0.72           // 分身体型缩小
        },
        "list": [
          /* 出怪量较 j 版翻倍（左右同出、集中涌向顶部终点，制造巨大出怪量压迫感） */
          [ { "type": "enemyX", "count": 12, "interval": 0.60, "delay": 0 } ],
          [ { "type": "enemyX", "count": 20, "interval": 0.45, "delay": 0 },
            { "type": "enemyY", "count": 5,  "interval": 1.10, "delay": 5 } ],
          [ { "type": "enemyX", "count": 25, "interval": 0.40, "delay": 0 },
            { "type": "enemyY", "count": 8,  "interval": 0.95, "delay": 5 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 14, "bossHpFactor": 16 } ],
          [ { "type": "enemyX", "count": 28, "interval": 0.35, "delay": 0 },
            { "type": "enemyY", "count": 9,  "interval": 0.90, "delay": 5 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 14, "bossHpFactor": 16 } ],
          [ { "type": "enemyY", "count": 10, "interval": 0.90, "delay": 0 },
            { "type": "enemyX", "count": 26, "interval": 0.30, "delay": 3 },
            { "type": "enemyX", "count": 14, "interval": 0.35, "delay": 11 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 16, "bossHpFactor": 50 } ]
        ]
      }
    },

    /* ============================================================
     * 第 6 关「三路会师」——三路出怪 + 交叉交汇 + 共享终点
     *   route 0 左路：左缘 y=130 横穿全图 → (830,130) 下折，
     *     (830,270) 与右路 X 交叉【交叉点2】→ (830,420) 左折 →
     *     (480,420) 与主干汇合【交汇点2】→ 共享终点 (480,580)
     *   route 1 顶路：顶部中间下行至 (480,130)（与左路横线相接【交叉点1】），
     *     沿 y=130 西折至 x=355 → 下折至 y=270 → 东折回主干【交汇点1】，
     *     与右路汇合后共享主干到终点
     *   route 2 右路：右缘 y=270 左行 → (830,270) 穿过左路竖线【交叉点2】→
     *     (480,270) 与顶路汇合【交汇点1】→ 共享主干到终点
     *   三路共享段：主干 (480,270→420) + 左下绕行 (120,420→500→480,500) + 末段
     *   —— 全部 90° 直角转弯（无斜线、无锯齿折返），最短段 80px，
     *      平行路段间距 ≥80px，拐角圆点半径与线宽一致（无重叠、无大块色块）。
     *   路径长度：左 1670 / 顶 1590 / 右 1590（最大差 5%），
     *     routeBonus.speedMul 按「该路长度/三路平均」微调，三路到达终点时间一致。
     *   三路怪物配置完全相同、同时出怪（spawnRoutes:[0,1,2]，第 1 波即三路齐出）；
     *   任一路漏怪扣同一条命（goals 共享单生命，同第 5 关）。
     *   火力点：沿用全局自动布点（cell 80 / roadGap 62，每路段两侧各一排），
     *   交叉/交汇处多条路的点列天然汇聚、去重后最密，终点由末段两侧点列覆盖；
     *   障碍物走全局自动生成（1000 血 / 500 金币）+ 据点补位机制。
     *   本关不需要传送门，省略。塔E（unlockLevel 3）第 6 关自动可用。
     * ============================================================ */
    "6": {
      "economy": { "startGold": 400, "startLives": 20 },
      /* 补点（对应玩家圈选区域）：右侧岛带 +1、左下 y=420 共享横段上方草地 +4。
         全部坐标经实测 canBuildAt 校验：离路 ≥56px 不压路（路面半宽25+方格半宽18，
         43px 安全间隙），与邻点矩形去重 abs(dx)/abs(dy) 不同时 <56，方格不重叠；
         离路 60~120px 均在最短射程 125（加敌人半径判定）覆盖内。
         U 型夹缝（y=420/y=500 两平行路净距仅 30px < 方格 36px）无合法点，故不放。 */
      "build": {
        "extraSpots": [
          { "x": 540, "y": 330 },                            // 右侧中间偏下岛带左端（y=270 横路下方、主干 x=480 东侧）
          { "x": 84,  "y": 358 },                            // 左下横段上方贴路排左端补全（84/156/228/300，间距72整齐）
          { "x": 134, "y": 300 }, { "x": 194, "y": 300 },
          { "x": 254, "y": 300 }                             // 左下方大草地一排（x间隔60，离 y=420 路 105~120，所有塔射程可达）
        ]
      },
      "paths": [
        /* route 0：左路（左进右行 → 下折 → 底部左折 → 汇入主干下行），保持原状 */
        [
          { "x": -40,  "y": 130 },
          { "x": 830,  "y": 130 },   // 横穿全图，与顶路竖线相接于 (480,130)【交叉点1】
          { "x": 830,  "y": 420 },   // 下折，与右路 X 交叉于 (830,270)【交叉点2】
          { "x": 480,  "y": 420 },   // 左折，与主干汇合【交汇点2】
          { "x": 480,  "y": 580 }    // 共享终点（地图下方，洞穴视觉钳制显示在 y=506）
        ],
        /* route 1：顶路（顶进直下 → 沿左路横线西折绕行延长 → 回主干汇合 → 共享段）。
           绕行全为 90° 直角（125/140/125），回程沿 y=130 横线走廊同色无痕 */
        [
          { "x": 480,  "y": -40 },
          { "x": 480,  "y": 130 },   // 与左路横线相接【交叉点1】
          { "x": 355,  "y": 130 },   // 西折（沿横线走廊 +125px）
          { "x": 355,  "y": 270 },   // 下折（左侧空白带，与主干间距 125px）
          { "x": 480,  "y": 270 },   // 东折回主干【交汇点1】
          { "x": 480,  "y": 420 },   // 直下【交汇点2】
          { "x": 120,  "y": 420 },   // 共享绕行：西折（三路公共延长段）
          { "x": 120,  "y": 500 },   // 下折
          { "x": 480,  "y": 500 },   // 东折回主干
          { "x": 480,  "y": 580 }    // 共享终点
        ],
        /* route 2：右路（右进左行 → 交叉穿过左路竖线 → 与顶路汇合 → 共享段） */
        [
          { "x": 1040, "y": 270 },
          { "x": 480,  "y": 270 },   // 穿过 (830,270)【交叉点2】，到达【交汇点1】与顶路汇合
          { "x": 480,  "y": 420 },   // 与顶路共享主干【交汇点2】
          { "x": 120,  "y": 420 },   // 共享绕行（与顶路完全重合）
          { "x": 120,  "y": 500 },
          { "x": 480,  "y": 500 },
          { "x": 480,  "y": 580 }    // 共享终点
        ]
      ],
      /* 三路共享终点：三条路线末路径点同为 (480,580)，洞穴重叠绘制为
         同一个；任一路线漏怪都扣同一条命（HUD 单生命显示，同第 5 关） */
      "goals": [
        { "route": 0 },
        { "route": 1 },
        { "route": 2 }
      ],
      "waves": {
        "intermission": 15,
        "spawnRoutes": [0, 1, 2],     // 三路同时出怪，怪物配置完全相同
        "hpGrowth": 1.6,              // 每波小怪血量 +60%（复合，JSON 驱动）
        "finalWaveSpecial": false,
        "finalBossHpFactor": 50,      // 末波 BOSS = 当波小怪 ×50（JSON 驱动）
        "clearBonus": [50, 100, 150, 200, 250],
        /* 三路道路已梳理为全 90° 直角、无重叠的清晰道路，长度 1670/1590/1590（差 5%）。
           speedMul = 该路长度 / 三路平均长，使三路同时出怪到达终点时间一致
           （JSON 驱动，作用于所有敌人含 BOSS，因为路径长度差异对所有敌人一视同仁） */
        "routeBonus": {
          "0": { "speedMul": 1.033 },
          "1": { "speedMul": 0.984 },
          "2": { "speedMul": 0.984 }
        },
        "list": [
          /* 每波配置对三条路线各生效一份（同数量/同血量/同时出怪） */
          [ { "type": "enemyX", "count": 8,  "interval": 0.65, "delay": 0 } ],
          [ { "type": "enemyX", "count": 14, "interval": 0.50, "delay": 0 },
            { "type": "enemyY", "count": 4,  "interval": 1.10, "delay": 5 } ],
          [ { "type": "enemyX", "count": 18, "interval": 0.45, "delay": 0 },
            { "type": "enemyY", "count": 6,  "interval": 0.95, "delay": 5 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 14, "bossHpFactor": 16 } ],
          [ { "type": "enemyX", "count": 20, "interval": 0.40, "delay": 0 },
            { "type": "enemyY", "count": 7,  "interval": 0.90, "delay": 5 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 14, "bossHpFactor": 16 } ],
          [ { "type": "enemyY", "count": 8,  "interval": 0.90, "delay": 0 },
            { "type": "enemyX", "count": 20, "interval": 0.35, "delay": 3 },
            { "type": "enemyX", "count": 10, "interval": 0.40, "delay": 11 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 16, "bossHpFactor": 50 } ]
        ]
      }
    },

    /* ============================================================
     * 第 7 关「双途重围」——左右双出怪 · 双长路线汇合 · 护盾 BOSS 连战
     * ------------------------------------------------------------
     * 地图：左右两个出怪口，两条镜像对称的长蛇形路线（各 5 个拐弯，
     *   单线长约 1420px），在 (480,380) 汇合后共用中央尾段
     *   (480,380)→(480,580) 通向唯一终点；全 90° 直角、拐角圆点圆润、
     *   宽度统一。火力点全面加密布阵（cell=44 + 去重 44 + roadGap 52 +
     *   minPathDistance 52）：道路两侧自动点全程覆盖，发夹弯内侧与中央岛、
     *   上下空白带再由 14 个手工镜像点补齐，全关共约 47 个道路塔位，
     *   沿路任意点到最近火力点 ≤122px（最短射程塔 125 全覆盖，无打不到盲区）。
     * 波次：5 波，小怪血量每波复合 +80%（hpGrowth=1.8，无末波翻倍），
     *   每波小怪总数递增（16/20/30/36/44，按路线左右各出一份）。
     * BOSS：第 2 波起每波都有（波次索引 1/2/3/4）：
     *   第2波 金色 ×20 血，左右各 1（共 2）；
     *   第3波 蓝色 ×50 血，左右各 2（共 4），全部「雷元素护盾」；
     *   第4波 灰色 ×80 血，左右各 2（共 4），全部「冰元素护盾」；
     *   第5波 ×100 血，左右各 3（共 6），金/蓝/灰每边各 1（变体图案
     *          bossVariantPattern 按出怪序号分配），全部「血量护盾」，
     *          且本体血量降到 30% 分裂 3 只绿色小史莱姆（各 5000 血），
     *          小 BOSS 全灭后聚合，聚合大 BOSS 保留原最大血量 10%。
     *   bossVariantHpMul=false：本关 BOSS 血量严格等于「同波小怪×倍数」，
     *   不吃全局变体的 hpMul 微调（金1/蓝1.2/灰1.45），贴图/移速/金币
     *   仍走变体。
     * 经济：初始 400 金；小怪击杀金币 killRewardAdjust=-8（略降）；
     *   清波奖励大幅提高 [120,220,360,500,700]；升级费用 ×1.5
     *   （upgradeCostFactor，仅本关，塔造价不变）。
     * 倒计时：波间 20 秒（比前几关 15 秒宽裕），可手动提前开始。
     * 障碍物：关闭自动随机布点（obstaclesAutoCount=0），改为 5 个显式点
     *   （下缘两对镜像 + 顶部中央一个），全部在距路 ≥140px 的空白带：
     *   不压路、不挡小怪、彼此 ≥80px 不扎堆、距任一火力点 ≥61px（点击塔位
     *   不被误触，优于旧布局的 46~52px），每个都自动生成琥珀据点保证可被
     *   塔攻击；血量 1000 / 摧毁 500 金沿用全局设定。
     *   （火力点由 30 个加密到 49 个后，地图可用的"无效放塔区"空白带只剩
     *    下缘与顶部几处，障碍物数量由 11 → 5，避免与密集火力点互相遮挡。）
     * ============================================================ */
    "7": {
      "economy": { "startGold": 400, "startLives": 20 },
      "killRewardAdjust": -8,        // 小怪击杀金币略降（enemyX 9+20-8=21 / enemyY 18+20-8=30，BOSS 不受影响）
      "upgradeCostFactor": 1.5,      // 本关塔升级费用 ×1.5（造价不变，仅作用于第 7 关）
      /* 全部塔可选：本关 BOSS 带雷/冰元素护盾 + 血量护盾（需多元素协同破盾），
         且关卡已自由进入——塔的可用性不再受「历史通关记录」限制，
         只要关卡编号 ≥ 该塔解锁关卡即可选用（第 7 关 ≥ 全部塔的解锁关卡）。
         只影响本关，第 1~6 关解锁规则不变。 */
      "allTowersAvailable": true,
      "build": {
        "cell": 44,               // 采样间距 56→44：沿路火力点更密（排成整齐点阵）
        "minSpacing": 44,         // 去重间距 48→44（火力点方格 36px，相邻不重叠、留 8px 缝）
        "roadGap": 52,            // 道路点到路心 62→52：更贴路面，火力覆盖更实
                                  // （路面可视宽 60px＝±30，仍留 22px 间隙，不压路、不挡小怪）
        "minPathDistance": 52,    // 避路硬校验 56→52（仅本关）：两条平行道路间距 110px 的
                                  // 发夹弯内侧塔位不再被一刀切掉，弯道内部不再空着；
                                  // 塔心距可视路缘 22px，绝不会站在路面上
        /* 手工补点（14 个，全部按运行时真实规则逐点校验通过）：
           距路 52~118px（放塔必能打到路面）、不压路、避开 HUD 禁区、
           与自动点按【方框去重】≥44px 且左右成对镜像，补满自动采样
           够不到的空白区（中央岛、两侧内竖段、左右外侧、下缘空白带） */
        "extraSpots": [
          { "x": 320, "y": 460 }, { "x": 640, "y": 460 },   // 下横段外侧两角
          { "x": 440, "y": 120 }, { "x": 520, "y": 120 },   // 中央岛顶部两角
          { "x": 280, "y": 400 }, { "x": 680, "y": 400 },   // 下横段外侧
          { "x": 40,  "y": 360 }, { "x": 920, "y": 360 },   // 左右外侧空白带
          { "x": 440, "y": 180 }, { "x": 520, "y": 180 },   // 中央岛中部
          { "x": 200, "y": 400 }, { "x": 760, "y": 400 },   // 左下 / 右下空白带
          { "x": 380, "y": 480 }, { "x": 580, "y": 480 }    // 尾段两侧
        ]
      },
      "path": {
        "borderColor": 0xc99a54,
        "fillColor": 0xeac58f
      },
      /* 障碍物：本关【关闭自动随机障碍物】（obstaclesAutoCount: 0），改为下面
         7 个显式布点——全部经布局校验：距路 ≥140px（在"无效放塔区"，不压路、
         不挡小怪）、彼此 ≥80px（不扎堆）、距任一火力点 ≥60px（点击塔位不被
         误触，优于旧布局的 46~52px）、且每个都自动生成专属琥珀据点
         （obstacles.coverSpot），保证最短射程的塔也能打到它。
         血量 1000 / 摧毁 500 金沿用全局设定，未改动。 */
      "obstaclesAutoCount": 0,
      "extraObstacles": [
        { "x": 190, "y": 510 }, { "x": 770, "y": 510 },   // 下缘左/右（镜像对）
        { "x": 280, "y": 510 }, { "x": 680, "y": 510 },   // 下缘左/右（镜像对，与上一对错开 90px）
        { "x": 587, "y": 40  }                            // 顶部中央空白带（HUD 两组之间的空档）
      ],
      "paths": [
        /* route 0：左路（左缘 y=80 进 → 蛇形 5 拐 → 中央汇合 → 共线尾段） */
        [
          { "x": -40,  "y": 80 },
          { "x": 180,  "y": 80 },
          { "x": 180,  "y": 190 },
          { "x": 70,   "y": 190 },
          { "x": 70,   "y": 300 },
          { "x": 250,  "y": 300 },
          { "x": 250,  "y": 210 },
          { "x": 390,  "y": 210 },
          { "x": 390,  "y": 380 },
          { "x": 480,  "y": 380 },    // 汇合点
          { "x": 480,  "y": 580 }     // 共享终点（画面外，洞穴钳到 y=506）
        ],
        /* route 1：右路（route 0 关于 x=480 的镜像，长度完全相同） */
        [
          { "x": 1000, "y": 80 },
          { "x": 780,  "y": 80 },
          { "x": 780,  "y": 190 },
          { "x": 890,  "y": 190 },
          { "x": 890,  "y": 300 },
          { "x": 710,  "y": 300 },
          { "x": 710,  "y": 210 },
          { "x": 570,  "y": 210 },
          { "x": 570,  "y": 380 },
          { "x": 480,  "y": 380 },    // 汇合点（与左路重合）
          { "x": 480,  "y": 580 }     // 共享终点
        ]
      ],
      /* 两条路线共用同一终点：任一路漏怪扣同一条命 */
      "goals": [
        { "route": 0 },
        { "route": 1 }
      ],
      "waves": {
        "intermission": 20,          // 波间倒计时 20 秒（宽裕），按钮可手动提前
        "spawnRoutes": [0, 1],       // 左右两路同时出怪（每波 group 对两路各复制一份）
        "hpGrowth": 1.8,             // 每波小怪血量 +80%（复合）
        "finalWaveSpecial": false,   // 末波不额外翻倍，严格 1.8 复合成长
        "finalBossHpFactor": 100,    // 兜底（每波 BOSS 另有 per-group bossHpFactor 显式驱动）
        "clearBonus": [120, 220, 360, 500, 700],  // 清波奖励明显提高
        /* 本关 BOSS 变体（按波次索引 0 起，值=变体 key）：
           第2波金 / 第3波蓝 / 第4波灰；第5波由每组 bossVariantPattern
           在金/蓝/灰之间按出怪序号分配（左右两边图案相同）。
           表外波次（第1波无 BOSS）不读取。 */
        "bossWaveVariant": { "1": "gold", "2": "blue", "3": "gray" },
        /* 本关 BOSS 不吃变体 hpMul：血量严格 = 同波小怪 × bossHpFactor */
        "bossVariantHpMul": false,
        /* BOSS 元素/血量护盾（按波次索引，JSON 驱动；仅作用于本关本波 BOSS）：
           element 盾：免疫对应元素伤害，该元素攻击不计有效次数、不解除护盾；
                      其余元素/无元素攻击每次计 1 次有效攻击，满 breakHits 破盾；
                      冰盾存在时同时免疫冰系减速；雷盾不阻挡电链向后方小怪弹跳。
           hp 盾：护盾血量内 BOSS 本体不受伤害，护盾击破后本体才开始掉血。 */
        "bossShields": {
          "2": { "type": "element", "element": "thunder", "breakHits": 40 },
          "3": { "type": "element", "element": "ice", "breakHits": 40 },
          "4": { "type": "hp", "hp": 5000 }
        },
        /* 第 5 波 BOSS 分裂/聚合（仅末波 BOSS 生效，复用第 5 关 bossPhases
           机制并扩展：固定分身血量 / 绿色史莱姆贴图 / 聚合按原最大血量比例）：
           30% 分裂 → 3 只绿色史莱姆小 BOSS（固定各 5000 血，移速 46）→
           全灭聚合 → 大 BOSS 血量 = 原最大血量 ×10%。 */
        "bossPhases": {
          "splitAtHpRatio": 0.30,
          "splitCount": 3,
          "miniType": "enemyX",       // 分身用绿色史莱姆（enemyX 绿段视频/静态贴图）
          "miniHp": 5000,             // 每只小 BOSS 固定 5000 血（忽略分裂时剩余血量）
          "miniSpeed": 46,            // 小 BOSS 移速（enemyX 默认 98 过快，压到中速）
          "miniTint": false,          // 分身不染色（保留史莱姆原生绿色）
          "mergeHpRatio": 0.10,       // 聚合血量 = 原大 BOSS 最大血量 ×10%
          "mergeKeepParentStats": true// 聚合 BOSS 沿用父代变体移速/漏血/金币
        },
        /* 第 7 关「波内追加批次」（仅本关；波次数不变，仍是 5 波）：
           第 1 波不追加；第 2/3/4/5 波在原出怪基础上分别额外追加 1/2/3/4
           批小怪。追加批次与原有小怪同配置（类型/速度/金币/护甲一致），
           血量自动按“当前波次”规则计算（每波 +80% 复合），
           计入本波清场条件；追加批次均排在 BOSS 组之前，
           BOSS 仍按原设定波次与出场顺序出现（不受影响）。 */
        "list": [
          /* 第 1 波：左右各 8 只，共 16 只（无 BOSS）——保持原样，不追加 */
          [ { "type": "enemyX", "count": 8,  "interval": 0.70, "delay": 0 } ],
          /* 第 2 波：左右各 10 只共 20 只 + 金色 BOSS 左右各 1（共 2，×20 血）
             +【追加 1 批】enemyX ×10 */
          [ { "type": "enemyX", "count": 10, "interval": 0.55, "delay": 0 },
            { "type": "enemyX", "count": 10, "interval": 0.55, "delay": 6 },
            { "type": "enemyBoss", "count": 1, "interval": 0, "delay": 12, "bossHpFactor": 20 } ],
          /* 第 3 波：左右各 12 快兵 + 3 胖子（共 30）+ 蓝色 BOSS 左右各 2
             （共 4，×50 血，雷元素护盾：免疫雷、计 40 次有效攻击破盾）
             +【追加 2 批】enemyX ×12 / enemyY ×3 */
          [ { "type": "enemyX", "count": 12, "interval": 0.45, "delay": 0 },
            { "type": "enemyY", "count": 3,  "interval": 1.20, "delay": 6 },
            { "type": "enemyX", "count": 12, "interval": 0.45, "delay": 7 },
            { "type": "enemyY", "count": 3,  "interval": 1.20, "delay": 9 },
            { "type": "enemyBoss", "count": 2, "interval": 3, "delay": 14, "bossHpFactor": 50 } ],
          /* 第 4 波：左右各 14 快兵 + 4 胖子（共 36）+ 灰色 BOSS 左右各 2
             （共 4，×80 血，冰元素护盾：免疫冰伤与冰减速、40 次有效攻击破盾）
             +【追加 3 批】enemyX ×14 / enemyY ×4 / enemyX ×14 */
          [ { "type": "enemyX", "count": 14, "interval": 0.40, "delay": 0 },
            { "type": "enemyY", "count": 4,  "interval": 1.00, "delay": 7 },
            { "type": "enemyX", "count": 14, "interval": 0.40, "delay": 8 },
            { "type": "enemyY", "count": 4,  "interval": 1.00, "delay": 9 },
            { "type": "enemyX", "count": 14, "interval": 0.40, "delay": 10 },
            { "type": "enemyBoss", "count": 2, "interval": 3, "delay": 15, "bossHpFactor": 80 } ],
          /* 第 5 波：左右各 6 胖子 + 16 快兵（共 44）+ BOSS 左右各 3（共 6，
             ×100 血）；每边按 金→蓝→灰 顺序出场，全部 5000 血量护盾 +
             30% 分裂 3 绿色小 BOSS → 全灭聚合（10% 血）
             +【追加 4 批】enemyY ×6 / enemyX ×16 / enemyY ×6 / enemyX ×16 */
          [ { "type": "enemyY", "count": 6,  "interval": 0.90, "delay": 0 },
            { "type": "enemyX", "count": 16, "interval": 0.32, "delay": 4 },
            { "type": "enemyY", "count": 6,  "interval": 0.90, "delay": 7 },
            { "type": "enemyX", "count": 16, "interval": 0.32, "delay": 9 },
            { "type": "enemyY", "count": 6,  "interval": 0.90, "delay": 11 },
            { "type": "enemyX", "count": 16, "interval": 0.32, "delay": 13 },
            { "type": "enemyBoss", "count": 3, "interval": 3, "delay": 16,
              "bossHpFactor": 100,
              "bossVariantPattern": ["gold", "blue", "gray"] } ]
        ]
      }
    }
  },

  "sellReturn": 0.60   // 出售返还总投入的 60%
};
