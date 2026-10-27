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
          "slowFactor": 0.50,      // 兜底值（= 三级口径，减速到 50% 移速）；实际按 slowFactorByLevel 取
          /* 小怪减速【按塔等级】取值（移速系数，越小越慢；减速% = 1 - 系数）：
               1 级 0.70 = 减速 30% / 2 级 0.60 = 减速 40% / 3 级 0.50 = 减速 50%。
             升级只提升伤害/射程/冷却（见 upgrade），减速一律走本表，JSON 可调。 */
          "slowFactorByLevel": { "1": 0.70, "2": 0.60, "3": 0.50 },
          "slowDuration": 1.6,     // 小怪减速持续秒数（1/2/3 级相同）
          /* BOSS 专项减速（BOSS 免疫冰冻、不能定身，用大幅减速弥补）：
             仅【达到 minLevel 及以上】的冰塔对 BOSS/BossMini 触发本专项固定数值；
             未达等级的冰塔对 BOSS 仍走上面的普通小怪逻辑（按等级取 slowFactorByLevel）。
             factor = 移速系数：0.35 = 减速 65%；duration = 持续秒数。不设减速上限。 */
          "bossSlow": { "minLevel": 3, "factor": 0.35, "duration": 1.6 }
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
        "attractDuration": 500,  // 单次吸附持续（毫秒）：收敛窗口，结束后停在新位置继续前进（不弹回）
        /* BOSS 免疫牵引（位置完全不位移），用固定减速弥补：牵引脉冲命中 BOSS
           时挂一层减速 debuff。以下三项均 JSON 驱动：
             bossSlow         —— 减速量（固定 0.10 = 减速 10%）；【多座引力塔同时
                                 作用于同一 BOSS 不叠加】，BOSS 只受这 10%；
             bossSlowDuration —— 该减速持续时长（毫秒 → 0.75 秒）；
             bossSlowCooldown —— 同一座塔对 BOSS 的触发冷却（毫秒 → 2 秒），
                                 每座塔【独立计时】，互不影响。
           减速量取自本基础配置、不随塔等级变化（升级只影响射程/冷却/伤害）。 */
        "bossSlow": 0.10,
        "bossSlowDuration": 750,
        "bossSlowCooldown": 2000
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
       尺寸依据：视频窗口含蹦跳上下限余量（绿内容占窗口高 0.8825 / 蓝 0.9101），
       故 displayH 取 enemyX/enemyY 的 art.h ÷ 内容占比，使【视频档可见本体】
       与【静态降级档 art.h】严格一致（绿 46 / 蓝 41）——修复「视频接管瞬间
       体型变大」：同一只怪在静态→视频切换时不再改变世界尺寸。
       与第 8 关水晶史莱姆/自爆泥怪同约定（那边窗口已按内容裁紧，displayH=art.h）。
       宽按窗口宽高比自动算：绿 45.3 / 蓝 44.2 可见宽均 ≤ 路宽 50 */
    "slimeVideo": {
      "src": "assets/slime_walk.mp4",
      "bg": { "r": 50.7, "g": 228.7, "b": 57.8 },
      "key": { "low": 0.06, "high": 0.13 },
      "displayH": { "green": 52, "blue": 45 }
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
         静态贴图宽高比实测 1.04 → h 46 时宽约 47.8 ≤ 路宽 50；视频档由
         slimeVideo.displayH 驱动，其【可见本体】高度同样为 46（见上注释），
         故视频接管/降级来回切换时体型恒定不变 */
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
         （视频档由 slimeVideo.displayH 驱动，其可见本体高度同样为 41） */
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
    },

    /* ============================================================
     * 第 8 关新增怪物（代码绘制外观，无贴图依赖；贴图由 Level8Enemies.js
     * 在进关时用 Graphics.generateTexture 生成，键名固定为 enemy_<typeKey>）
     * ============================================================ */

    /* 水晶史莱姆：常态 80% 减伤；每受到 1 次【元素反应】（火冰融化/水雷感电等，
       单一元素附着不计）累积 1 次，累积到 reactionsToBreak 次触发「破防」：
       减伤 80% → reducedArmor，持续 breakDuration 秒；破防期间不可再次触发，
       结束后减伤复原、计数清零重新累积。减伤基数由 CrystalSlime 每帧写入
       this.dmgReduction，Enemy.takeDamage 统一读取 armorReduction 接口。
       移动动画改用 assets/crystal_slime_move.mp4（白底抠图，见 moveVideo）。 */
    "crystalSlime": {
      "name": "水晶史莱姆",
      "hp": 90,             // 基础血量（按波次 hpGrowth 复合成长）
      "speed": 55,          // 中速：比快怪慢，配 80% 减伤拖节奏
      "radius": 15,
      "reward": 25,         // 击杀金币（高减伤怪给更高奖励）
      "leakDamage": 2,
      "color": 0x9fdcff,
      "darkColor": 0x5aa8d8,
      "art": { "h": 42 },   // 代码绘制兜底贴图显示高度（视频不可用时用）
      "armorBase": 0.8,     // 常态减伤 80%（JSON 驱动）
      /* 破防（元素反应计数触发）：全部 JSON 驱动 */
      "break": {
        "reactionsToBreak": 20,   // 累积 20 次元素反应触发破防
        "reducedArmor": 0.30,     // 破防期间减伤降为 30%
        "breakDuration": 5        // 破防持续 5 秒（期间不可再次触发）
      },
      /* 移动视频（assets/crystal_slime_move.mp4，640x640 白底）：
         bg/key = 对实测白底(253,252,250)做 L1 距离键的抠图参数；
         win = 固定显示窗口（纹理像素坐标，已剔除画面底部烘焙投影）；
         displayH = 世界显示高度（宽按窗口宽高比自动算，可见宽 ≤ 路宽 50）；
         maxEnemies = 同屏使用视频的小怪上限（超出者回退代码绘制贴图，手机降级）
         —— 第 8 关追加大量水晶史莱姆批次、且 BOSS 分裂还会额外产出 3 只，
         上限放宽到 56（≥ 单波同屏峰值），保证包括分裂体在内所有水晶史莱姆
         都走视频贴图，不再出现「纯蓝色圆球」静态占位观感 */
      "moveVideo": {
        "src": "assets/crystal_slime_move.mp4",
        "bg": { "r": 253.0, "g": 252.0, "b": 250.0 },
        "key": { "low": 0.02, "high": 0.06 },
        "win": { "x": 84, "y": 78, "w": 474, "h": 418 },
        "displayH": 42,
        "maxEnemies": 56
      }
    },

    /* 自爆泥怪（移动炸弹）：常态 90% 免伤，出场即点燃 8 秒引信；
       引信归零 → 原地爆炸，爆炸半径（含自身体积补偿）内的防御塔「禁言」2 秒，
       自身死亡。被塔打死仍会自爆（保留自爆怪的死亡反馈），但不再因靠近塔
       提前引爆——倒计时是唯一主动引爆条件。
       移动动画改用 assets/bomb_slime_move.mp4（绿幕抠图，见 moveVideo）。 */
    "bomberSlime": {
      "name": "自爆泥怪",
      "hp": 60,
      "speed": 132,         // 极快（快怪 enemyX 98 的 1.35 倍）
      "radius": 13,
      "reward": 14,
      "leakDamage": 1,
      "color": 0xd94a3a,
      "darkColor": 0x7a1f16,
      "art": { "h": 38 },   // 代码绘制兜底贴图显示高度（视频不可用时用）
      "armorBase": 0.90,     // 常态免伤 90%（普通伤害只吃 10%）
      "fuseTime": 8,         // 出场引信（游戏秒；4x 下 2 个真实秒）
      "explodeRadius": 50,   // 爆炸禁言半径（像素，需求口径）
      "explodeSilence": 2,   // 禁言时长（秒）
      /* 滚动视频（assets/bomb_slime_move.mp4，640x640 绿幕）：
         key/spill = green-excess 绿幕色度键 + 去绿边参数；
         rate = 播放倍速基准，运行时再按小怪实际移速比缩放
         （滚动节奏与物理位移同步，避免「滑步」）；
         maxEnemies = 同屏视频上限（第 8 关追加自爆泥怪批次后放宽到 24） */
      "moveVideo": {
        "src": "assets/bomb_slime_move.mp4",
        "key": { "low": 0.12, "high": 0.30 },
        "spill": 0.03,
        "win": { "x": 94, "y": 144, "w": 452, "h": 364 },
        "displayH": 38,
        "rate": 1.6,
        "maxEnemies": 24
      }
    },

    /* 熔岩巨兽 —— 第 8 关终极 BOSS（状态机由 LavaBehemoth 子类实现）：
       免疫冰冻/眩晕/牵引（沿用 cfg.boss 既有豁免链）；可被 4 级塔灼烧
       （burnStacks）/降防（armorBreaks）等异常状态影响（Enemy 状态接口）。
       noVariant=true：不接入金/蓝/灰 BOSS 变体（贴图/移速/金币全走本配置，
       血量仍 = 同波小怪 × bossHpFactor）。
       机制（全部 JSON 驱动）：
         · 血量盾：开局 5000 血，每 5s 刷新一次，盾不破本体不受伤害
           （百分比伤害可打盾，但其最终伤害减半，见 Enemy.takeDamage）
         · 岩浆爆发：每 5s 一次以自身为圆心的【灰色】爆发，沉默半径内防御塔 2s
         · 分裂：血量降到 20% → 本体消失，原地分裂 3 只【特殊水晶史莱姆】
           （90% 减伤；累计 40 次元素反应才破防降至 0%）
         · 聚合：3 只分裂体全灭 → 在最后一只位置聚合回 BOSS，恢复 50% 生命
         · 跟班（原阶段二召唤的自爆泥怪）已移除
         · 火焰路径已删除：BOSS 只做普通移动，不生成任何地面持续伤害区域 */
    "lavaBoss": {
      "name": "熔岩巨兽",
      "hp": 2480,           // 兜底占位（实际由 spawnEnemy 按波次公式覆盖）
      "speed": 34,
      "radius": 30,
      "reward": 600,
      "leakDamage": 3,
      "color": 0xff6a2a,
      "darkColor": 0x4a1d0d,
      "boss": true,
      "noVariant": true,
      "barThickness": 8,
      "art": { "h": 78 },   // 显示高度 78（与金/蓝/灰 BOSS 一致，可见宽 ≤ 路宽）
      /* 阶段/分裂/聚合参数（JSON 驱动，LavaBehemoth 读取） */
      "phases": {
        "rockShieldHp": 5000,     // 血量盾血量（开局即有，全阶段每 5s 刷新）
        "rockShieldInterval": 5,  // 血量盾生成/刷新周期（秒）
        "p2HpRatio": 0.70,        // 阶段二触发血线
        "p2SpeedMul": 1.5,        // 阶段二移速 +50%（不再召唤跟班）
        "p3HpRatio": 0.30,        // 阶段三触发血线
        "p3SpeedMul": 1.3,        // 阶段三移速再 +30%
        /* 岩浆爆发（沉默技能）：每 magmaInterval 秒一次以自身为圆心的灰色爆发，
           magmaRadius 半径内的防御塔禁言 magmaSilence 秒（无法攻击）。
           半径收窄到 150：玩家拉开塔距（塔心离 BOSS 轨迹 >150px）即可规避，
           不再是「全屏禁言」；半径外的塔完全不受影响。 */
        "magmaInterval": 5,
        "magmaRadius": 150,
        "magmaSilence": 2,
        /* 分裂（20% 血线）：本体消失 → splitCount 只特殊水晶史莱姆 */
        "splitAtHpRatio": 0.20,
        "splitCount": 3,
        "splitArmor": 0.90,          // 分裂体常态减伤 90%
        "splitReactionsToBreak": 40, // 需累计 40 次元素反应才破防
        "splitReducedArmor": 0,      // 破防后减伤归零（全额输出）
        "splitBreakDuration": 6,     // 破防窗口时长（秒），到期恢复 90%
        /* 聚合：分裂体全灭 → 聚合成 BOSS 并恢复该比例生命 */
        "mergeHealRatio": 0.5
      }
    },

    /* 蓝色圣殿守卫 —— 第 9 关「元素狂暴图腾」终极 BOSS（TempleGuard 子类实现）。
       贴图统一：强制使用「蓝史莱姆 Boss」贴图（boss_blue，entry.bossTex，
       与第 8 关熔岩巨兽强制灰贴图同一套机制），noVariant=true 不接金/蓝/灰
       数值变体（移速/金币走本配置，血量仍 = 同波小怪 × bossHpFactor）。
       机制（全部 JSON 驱动，见 guard 段）：
         · 光环减伤：本体存活期间，全场【小怪】受击伤害 ×(1-auraReduce)，
           多只守卫不叠加（取同一系数）；auraIncludeBoss 可让光环也罩住 BOSS。
         · 血量盾：开局即有 5000 血「圣盾」，每 shieldInterval(5s) 刷新一次，
           盾不破本体不掉血（复用 Enemy 既有 hp 盾结算）。
         · 狂暴：血量降到 rageHpRatio(30%) 触发，吞噬周围 devourCount 只小怪
           恢复 rageHealRatio(10%) 最大生命，并进入 rageInvuln(2s) 无敌。 */
    "templeGuard": {
      "name": "蓝色圣殿守卫",
      "hp": 2480,           // 兜底占位（实际由 spawnEnemy 按波次公式覆盖）
      "speed": 36,
      "radius": 30,
      "reward": 500,
      "leakDamage": 3,
      "color": 0x4aa8ff,
      "darkColor": 0x2f6bb3,
      "boss": true,
      "noVariant": true,
      "barThickness": 8,
      "art": { "h": 78 },   // 显示高度 78（与金/蓝/灰 BOSS 一致，可见宽 ≤ 路宽）
      /* 圣殿守卫机制参数（JSON 驱动，TempleGuard 读取） */
      "guard": {
        "shieldHp": 5000,          // 圣盾血量（开局即有，每 5s 刷新）
        "shieldInterval": 5,       // 圣盾刷新周期（秒）
        "auraReduce": 0.5,         // 光环减伤 50%（作用于小怪；多只不叠加）
        "auraIncludeBoss": false,  // 光环是否也作用于 BOSS 本体（默认否，BOSS 自带圣盾）
        "rageHpRatio": 0.30,       // 狂暴触发血线（30%）
        "rageHealRatio": 0.10,     // 狂暴吞噬回血 = 最大生命的 10%
        "rageInvuln": 2.0,         // 狂暴无敌时长（秒）
        "devourRadius": 150,       // 吞噬半径（像素，以 BOSS 为圆心）
        "devourCount": 4           // 最多吞噬的小怪数量
      }
    },

    /* 元素盾绿史莱姆 —— 第 9 关新增特殊小怪（ElementShieldSlime 子类实现）。
       外观：绿史莱姆贴图（slimeVideo green 段 / 静态降级 slime_static_green），
             art.h 比普通快怪大 → 体型稍大；applyShield 自带的元素光环即「光圈」。
       机制（全部 JSON 驱动）：出场即携带随机元素护盾（火/冰/水/雷），每 10 秒
             切换成随机另一种元素；护盾期间免疫该元素的伤害与负面效果，必须用
             其它元素打元素反应消耗盾值破盾；盾破后变回普通史莱姆（体型缩回、
             不再挂盾）。 */
    "shieldSlime": {
      "name": "元素盾绿史莱姆",
      "hp": 70,             // 基础血量（按波次 hpGrowth 复合成长）
      "speed": 82,          // 中快（介于快怪 98 与慢怪 45 之间）
      "radius": 17,
      "reward": 22,
      "leakDamage": 1,
      "color": 0x6be26b,
      "darkColor": 0x2e7d1c,
      "art": { "h": 54, "superSample": 2 },   // 体型稍大于普通快怪（46）
      /* 绿史莱姆贴图接管（与 enemyX 同段视频/静态贴图，观感一致） */
      "slimeVideo": { "frame": "green", "hopHeight": 7 },
      /* 元素护盾：切换周期 10s + 盾值（非免疫元素命中按反应 cost 消耗） */
      "shieldSwitch": { "interval": 10, "value": 18 },
      "shieldElements": ["fire", "ice", "water", "thunder"]
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
     *   宽度统一。火力点：cell=52 + 去重 56 + roadGap 56 + minPathDistance 52，
     *   道路两侧自动点 24 个 + 6 个手工镜像补点（中央岛与下横段外侧）
     *   = 全关 30 个火力点；沿路任意点到最近火力点 ≤107px（最短射程塔 125
     *   全覆盖，无打不到盲区），密度适中不拥挤。
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
     * 障碍物：关闭自动随机布点（obstaclesAutoCount=0），固定 10 个显式点
     *   （下缘一排镜像 + 中央岛 / 顶部中央空白带），全部在距路 ≥110px 处：
     *   不压路、不挡小怪、彼此 ≥85px 不扎堆、距任一火力点 40~130px
     *   （点击塔位不被误触，且塔能打到它），每个都生成琥珀据点兜底；
     *   间距阈值 obstacleSpacing=64 仅本关生效；血量 1000 / 摧毁 500 金未改。
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
        "cell": 52,               // 采样间距 44→52：火力点由 45 个精简到 24 个自动点（不拥挤）
        "minSpacing": 56,         // 去重间距 48→56：优先剔除重叠/过于密集的点，保留点更均匀
        "roadGap": 56,            // 道路点到路心 62→56：更贴路面，火力覆盖更实
                                  // （路面可视半宽 30px，仍留 26px 间隙，不压路、不挡小怪）
        "minPathDistance": 52,    // 避路硬校验 56→52（仅本关）：两条平行道路间距 110px 的
                                  // 发夹弯内侧塔位不再被一刀切掉；塔心距可视路缘 22px
        /* 手工补点（7 个）：补的是自动点列够不到的关键区段——
           中央岛（顶部两角 + 中部两侧）、下横段外侧两角（原 6 个），
           以及本次新增的「终点大门左下方」1 个（门外左下，覆盖汇合尾段）。
           合计「自动 24 + 手工 7 = 31 个道路火力点」：自动点数不变——
           剔除掉门旁那个被遮挡的点后，原本被它压掉的大门右上方点
           （548,436）得以保留，一进一出净额为零，正好补上门右上的空缺。 */
        "extraSpots": [
          { "x": 440, "y": 120 }, { "x": 520, "y": 120 },   // 中央岛顶部两角
          { "x": 380, "y": 140 }, { "x": 580, "y": 140 },   // 中央岛中部两侧
          { "x": 320, "y": 460 }, { "x": 640, "y": 460 },   // 下横段外侧两角
          { "x": 392, "y": 496 }                            // 终点大门左下方（覆盖汇合尾段，不压路）
        ],
        /* 【排除点】删除个别自动生成的火力点（JSON 驱动，缺省无 → 第 1~6 关零变化）：
           终点大门右侧、紧挨门旁血量牌（❤20）左上方的那个点（世界 536,475）——
           它的方格同时压住大门矩形与血量牌，既被 UI 遮挡又紧贴门体，
           故在此剔除；该位置由「被它压掉的大门右上方点 548,436」自然接替，
           既补上红圈处的火力覆盖，又不再遮挡血量 UI。 */
        "excludeSpots": [ { "x": 536, "y": 475 } ],
        "excludeRadius": 30
      },
      "path": {
        "borderColor": 0xc99a54,
        "fillColor": 0xeac58f
      },
      /* 障碍物：关闭自动随机布点（obstaclesAutoCount: 0），改为 10 个显式点
         （下缘一排镜像 + 中央岛/顶部空白带），全部在距路 ≥110px 的空白带：
         不压路、不挡小怪、彼此 ≥85px 不扎堆、距任一火力点 40~130px
         （点击塔位不被误触，且塔能打到它），每个都自动生成琥珀据点兜底；
         obstacleSpacing 64（仅本关）：地图可放障碍物的空白带有限，
         用 64px 间距排出整齐一排，凑满 10 个；血量 1000 / 摧毁 500 金未改。 */
      "obstaclesAutoCount": 0,
      "obstacleSpacing": 64,
      "extraObstacles": [
        { "x": 180, "y": 480 }, { "x": 780, "y": 480 },   // 下缘左/右（镜像对）
        { "x": 280, "y": 420 }, { "x": 680, "y": 420 },   // 下缘左/右（镜像对，上排）
        { "x": 840, "y": 420 }, { "x": 900, "y": 480 },   // 右下外侧（左下方被 HUD 禁区占用）
        { "x": 480, "y": 140 },                           // 中央岛中部
        { "x": 580, "y": 100 },                           // 中央岛右上方
        { "x": 520, "y": 40  }, { "x": 640, "y": 40  }    // 顶部中央空白带（HUD 两组之间的空档）
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
    },

    /* ============================================================
     * 第 8 关「风蚀荒原」——左侧上下双出怪 · 中央 S 型回旋走廊 · 风眼增伤 ·
     *   水晶史莱姆 / 自爆泥怪 / 三阶段熔岩巨兽
     * ------------------------------------------------------------
     * 地图：左上 (-40,60) 与左下 (-40,480) 两个出怪口，两条镜像蛇形路线
     *   （各 5 个拐弯，单线全长均 1980px）在地图中央 (390,270) 交汇，
     *   汇合后共用一段极长的 S 型回旋走廊（970px：右→上→右→长下→右→上→右）
     *   通向右侧 (1000,270) 大门；全 90° 直角、圆角过渡、无自交无互交。
     * 火力点：沿用第 7 关参数（cell=52 / minSpacing=56 / roadGap=56 /
     *   minPathDistance=52），道路两侧自动布点 + 9 个手工补点
     *   （S 走廊内外侧夹角、大门两侧、左下/右下空地）。
     * 风眼：固定 2 个不可建造装饰（(445,450)/(880,450)，代码绘制旋涡），
     *   每 10 秒触发一次全屏「风蚀增伤」：全场怪物受伤 +20%，持续 5 秒
     *   （JSON 驱动 windEyes，Level8Controller 实现，Enemy.takeDamage 统一结算）。
     * 波次：8 波，小怪血量每波复合 +80%（hpGrowth=1.8，无末波翻倍）；
     *   第 7 波精英 = 基础史莱姆 ×4 血 + 1.4 倍体型（entry.elite，JSON 驱动）；
     *   第 8 波终极 BOSS 熔岩巨兽（bossHpFactor=30，三阶段，见 lavaBoss 配置）。
     * 经济：初始 1000 金；小怪金币 killRewardAdjust=+5（略高于前 7 关）；
     *   清波奖励 [150,260,400,560,760,1000,1300,2000]。
     * 障碍物：关闭自动布点，固定 6 个显式点（全部距路 ≥110px、距任一火力点
     *   40~130px、彼此 ≥64px），血量 1000 / 摧毁 500 金沿用全局规则。
     * ============================================================ */
    "8": {
      "economy": { "startGold": 1000, "startLives": 20 },
      "killRewardAdjust": 5,         // 小怪击杀金币略高于前 7 关（enemyX 9+20+5=34）
      /* 4 级塔波次门槛覆盖：第 8 关开局即可升级 4 级塔（不再要求第 4 波后） */
      "upgradeWaveGate": 1,
      /* 风眼（仅本关）：2 个固定装饰点 + 全屏风蚀增伤参数 */
      "windEyes": {
        "interval": 10,              // 触发周期（秒）
        "duration": 5,               // 风蚀增伤持续（秒）
        "damageMul": 0.2,            // 受伤增加 20%
        "points": [
          { "x": 445, "y": 450 },    // 中央汇合段下方空地
          { "x": 880, "y": 450 }     // 大门右下空地
        ]
      },
      "build": {
        "cell": 52,
        "minSpacing": 56,
        "roadGap": 56,
        "minPathDistance": 52,
        /* 手工补点（12 个）：左半汇合拐角 / S 走廊内外夹角 / 大门两侧 / 下方空地，
           逐点按 buildHotspots 规则模拟校验（距路 52~114、互距 ≥56、不压
           安全区），与自动点互补覆盖；旧 9 点中 8 个曾被静默去重剔除 */
        "extraSpots": [
          /* 左半补充（此前 9 个 extras 有 8 个被自动点 dup/安全区静默丢弃，
             左侧实际只有 7 个火力点；本组按 buildHotspots 同规则逐点模拟
             校验，距路心 52~92、互距 ≥56、距风眼 ≥62、距障碍 ≥50，全部可渲染） */
          { "x": 440, "y": 122 },  // S 走廊上角左夹角（补 (500,150) 顶拐弯左翼，避 HUD 安全区 y=104）
          { "x": 338, "y": 262 },  // 双路汇合拐角 (390,270) 正左侧（route0/route1 下折拐弯）
          { "x": 442, "y": 382 },  // S 走廊下角左夹角（补 (500,270) 底拐弯左翼，风眼 445,450 北侧 68）
          { "x": 380, "y": 442 },  // 下路汇合拐角 (390,390) 右下（route1 转弯处）
          /* 右半重排（原 860,180 / 860,360 / 900,350 / 680,90 / 680,220 / 560,90 /
             560,330 均被自动点 dup 或顶部安全区丢弃，改落真实空口袋） */
          { "x": 648, "y": 106 },  // S 走廊右上夹角（y=150 顶路 + x=620 上段）
          { "x": 672, "y": 326 },  // S 走廊内部岛（x=620/x=740 之间下弯内点）
          { "x": 592, "y": 434 },  // S 下走廊左下夹角（(620,390) 拐弯）
          { "x": 768, "y": 434 },  // S 下走廊右下外角（(740,390) 拐弯）
          { "x": 828, "y": 416 },  // 大门左下翼（原 860,360 dup 补位）
          { "x": 926, "y": 218 },  // 大门右缘上（y=270 主干道右侧贴路）
          { "x": 926, "y": 322 },  // 大门右缘下
          { "x": 500, "y": 420 }   // 中央下方空地（原有效点位保留）
        ]
      },
      "path": {
        "borderColor": 0xc99a54,
        "fillColor": 0xeac58f
      },
      /* 障碍物：关闭自动随机布点，固定 6 个显式点（沿用第 7 关规则）：
         距路 ≥110px、不压路不挡怪、距任一火力点 40~130px、彼此 ≥64px */
      "obstaclesAutoCount": 0,
      "obstacleSpacing": 64,
      "extraObstacles": [
        { "x": 560, "y": 40  },    // 顶部中央（S 走廊上侧火力点旁）
        { "x": 930, "y": 140 },    // 右上门翼火力点旁
        { "x": 300, "y": 510 },    // 左下横段下方
        { "x": 820, "y": 480 },    // 右下（风眼B 左侧火力点旁）
        { "x": 500, "y": 470 },    // 中央下方（补点 500,420 旁）
        { "x": 930, "y": 455 }     // 右下角
      ],
      /* route 0：左上路（左缘 y=60 进 → 蛇形 5 拐 → 中央 (390,270) 汇合
         → 共用 S 型回旋走廊 → 右侧大门） */
      "paths": [
        [
          { "x": -40,  "y": 60  },
          { "x": 170,  "y": 60  },
          { "x": 170,  "y": 150 },
          { "x": 60,   "y": 150 },
          { "x": 60,   "y": 225 },
          { "x": 300,  "y": 225 },
          { "x": 300,  "y": 150 },
          { "x": 390,  "y": 150 },
          { "x": 390,  "y": 270 },   // 中央汇合点（与下路交汇）
          { "x": 500,  "y": 270 },   // ↓↓ 以下为两路完全重合的 S 型回旋走廊 ↓↓
          { "x": 500,  "y": 150 },
          { "x": 620,  "y": 150 },
          { "x": 620,  "y": 390 },
          { "x": 740,  "y": 390 },
          { "x": 740,  "y": 270 },
          { "x": 1000, "y": 270 }    // 右侧大门（画面外，门体钳制显示在右缘）
        ],
        /* route 1：左下路（route 0 关于 y=270 的镜像，长度完全相同 1980px） */
        [
          { "x": -40,  "y": 480 },
          { "x": 170,  "y": 480 },
          { "x": 170,  "y": 390 },
          { "x": 60,   "y": 390 },
          { "x": 60,   "y": 315 },
          { "x": 300,  "y": 315 },
          { "x": 300,  "y": 390 },
          { "x": 390,  "y": 390 },
          { "x": 390,  "y": 270 },   // 中央汇合点
          { "x": 500,  "y": 270 },   // ↓↓ 共用 S 型回旋走廊（与 route 0 重合）↓↓
          { "x": 500,  "y": 150 },
          { "x": 620,  "y": 150 },
          { "x": 620,  "y": 390 },
          { "x": 740,  "y": 390 },
          { "x": 740,  "y": 270 },
          { "x": 1000, "y": 270 }    // 右侧大门
        ]
      ],
      /* 两条路线共用同一终点：任一路漏怪扣同一条命 */
      "goals": [
        { "route": 0 },
        { "route": 1 }
      ],
      "waves": {
        "intermission": 20,
        "spawnRoutes": [0, 1],       // 左右两路同时出怪（每波 group 对两路各复制一份）
        "hpGrowth": 1.8,             // 每波小怪血量 +80%（复合）
        "finalWaveSpecial": false,   // 末波不额外翻倍，严格 1.8 复合成长
        "finalBossHpFactor": 30,     // 兜底（第 8 波 BOSS 另有 per-group bossHpFactor 显式驱动）
        "clearBonus": [150, 260, 400, 560, 760, 1000, 1300, 2000],
        /* 第 8 关强化：单波内追加批次（波次 N 追加 N 批同类型小怪）+
           多 Boss 多重护盾。bossShields 为数组，按 Boss 出怪顺序逐一分配
           （lavaBoss 不参与分配，走自身三阶段岩盾机制）。 */
        "bossVariantHpMul": false,   /* BOSS 血量严格「小怪血 × bossFactor」，不吃金/蓝/灰 hpMul */
        "bossShields": {
          "2": [ /* 第 3 波：4 只金史莱姆 Boss —— 2×次数盾60 + 2×血量盾2000 */
            { "type": "element", "breakHits": 60 },
            { "type": "element", "breakHits": 60 },
            { "type": "hp", "hp": 2000 },
            { "type": "hp", "hp": 2000 }
          ],
          "3": [ /* 第 4 波：4 只 —— 2×次数盾70 + 2×血量盾3500 */
            { "type": "element", "breakHits": 70 },
            { "type": "element", "breakHits": 70 },
            { "type": "hp", "hp": 3500 },
            { "type": "hp", "hp": 3500 }
          ],
          "4": [ /* 第 5 波：6 只 —— 2×次数盾80 + 4×血量盾5000 */
            { "type": "element", "breakHits": 80 },
            { "type": "element", "breakHits": 80 },
            { "type": "hp", "hp": 5000 },
            { "type": "hp", "hp": 5000 },
            { "type": "hp", "hp": 5000 },
            { "type": "hp", "hp": 5000 }
          ],
          "5": [ /* 第 6 波：8 只 —— 2×火元素盾100 + 2×次数盾80 + 4×血量盾5000 */
            { "type": "element", "element": "fire", "value": 100 },
            { "type": "element", "element": "fire", "value": 100 },
            { "type": "element", "breakHits": 80 },
            { "type": "element", "breakHits": 80 },
            { "type": "hp", "hp": 5000 },
            { "type": "hp", "hp": 5000 },
            { "type": "hp", "hp": 5000 },
            { "type": "hp", "hp": 5000 }
          ],
          "6": [ /* 第 7 波：8 只 —— 2×雷元素盾150 + 2×次数盾80 + 4×血量盾6000 */
            { "type": "element", "element": "thunder", "value": 150 },
            { "type": "element", "element": "thunder", "value": 150 },
            { "type": "element", "breakHits": 80 },
            { "type": "element", "breakHits": 80 },
            { "type": "hp", "hp": 6000 },
            { "type": "hp", "hp": 6000 },
            { "type": "hp", "hp": 6000 },
            { "type": "hp", "hp": 6000 }
          ],
          "7": [ /* 第 8 波：8 只金史莱姆 Boss —— 2×冰元素盾200 + 2×次数盾80 + 4×血量盾8000 */
            { "type": "element", "element": "ice", "value": 200 },
            { "type": "element", "element": "ice", "value": 200 },
            { "type": "element", "breakHits": 80 },
            { "type": "element", "breakHits": 80 },
            { "type": "hp", "hp": 8000 },
            { "type": "hp", "hp": 8000 },
            { "type": "hp", "hp": 8000 },
            { "type": "hp", "hp": 8000 }
          ]
        },
        "list": [
          /* ===== 第 1 波：原 5 只 +【追加 1 批】5 只（每路，共 20 只）===== */
          [ { "type": "enemyX", "count": 5,  "interval": 0.85, "delay": 0 },
            { "type": "enemyX", "count": 5,  "interval": 0.85, "delay": 5 } ],
          /* ===== 第 2 波：原 9 只 +【追加 2 批】各 9 只（每路，共 54 只）===== */
          [ { "type": "enemyX", "count": 9,  "interval": 0.60, "delay": 0 },
            { "type": "enemyX", "count": 9,  "interval": 0.60, "delay": 6 },
            { "type": "enemyX", "count": 9,  "interval": 0.60, "delay": 12 } ],
          /* ===== 第 3 波：原混编 +【追加 3 批】混编 +【再追加 1 批水晶史莱姆】
             +【新增 1 批】自爆泥怪（每批 3 只，delay 18）
             + 4 只金史莱姆 Boss（上下各 2，bossVariantPattern 强制金色贴图）===== */
          [ { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 0 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 4 },
            { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 8 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 12 },
            { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 16 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 24 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 28 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 30 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 18 },
            { "type": "enemyBoss", "count": 2, "interval": 4, "delay": 32,
              "bossHpFactor": 30, "bossVariantPattern": ["gold"] } ],
          /* ===== 第 4 波：原混编 +【追加 4 批】混编 +【再追加 2 批水晶史莱姆】
             +【新增 2 批】自爆泥怪（每批 3 只，delay 13 / 27）
             + 4 只金史莱姆 Boss（上下各 2）===== */
          [ { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 0 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 3 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 7 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 10 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 14 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 17 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 21 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 24 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 28 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 31 },
            { "type": "crystalSlime", "count": 4, "interval": 1.10, "delay": 34 },
            { "type": "crystalSlime", "count": 4, "interval": 1.10, "delay": 38 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 13 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 27 },
            { "type": "enemyBoss", "count": 2, "interval": 4, "delay": 36,
              "bossHpFactor": 40, "bossVariantPattern": ["gold"] } ],
          /* ===== 第 5 波：原混编 +【追加 5 批】混编 +【再追加 3 批水晶史莱姆】
             +【新增 3 批】自爆泥怪（每批 3 只，delay 13 / 27 / 41）
             + 6 只金史莱姆 Boss（上下各 3）===== */
          [ { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 0 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 2 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 8 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 10 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 16 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 18 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 24 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 26 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 32 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 34 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 40 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 42 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 45 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 48 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 51 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 13 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 27 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 41 },
            { "type": "enemyBoss", "count": 3, "interval": 3, "delay": 48,
              "bossHpFactor": 50, "bossVariantPattern": ["gold"] } ],
          /* ===== 第 6 波：原大乱斗 +【追加 6 批】大乱斗 +【再追加 4 批水晶史莱姆】
             +【新增 4 批】自爆泥怪（每批 3 只，delay 8 / 20 / 32 / 44）
             + 8 只金史莱姆 Boss（上下各 4）===== */
          [ { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 0 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 2 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 5 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 7 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 10 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 12 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 15 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 17 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 20 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 22 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 25 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 27 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 30 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 32 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 35 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 37 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 40 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 42 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 44 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 47 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 50 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 53 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 8 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 20 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 32 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 44 },
            { "type": "enemyBoss", "count": 4, "interval": 3, "delay": 48,
              "bossHpFactor": 60, "bossVariantPattern": ["gold"] } ],
          /* ===== 第 7 波：原精英+快兵 +【追加 7 批】+【再追加 5 批水晶史莱姆】
             +【新增 5 批】自爆泥怪（每批 3 只，delay 8 / 21 / 34 / 47 / 60）
             + 8 只金史莱姆 Boss（上下各 4）===== */
          [ { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 0,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 2 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 10,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 12 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 20,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 22 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 30,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 32 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 40,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 42 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 50,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 52 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 60,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 62 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 45 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 49 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 53 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 57 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 61 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 8 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 21 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 34 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 47 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 60 },
            { "type": "enemyBoss", "count": 4, "interval": 3, "delay": 70,
              "bossHpFactor": 80, "bossVariantPattern": ["gold"] } ],
          /* ===== 第 8 波（终极波 · 潮水式紧凑出怪，间隔压到 0.5~0.9 秒）=====
             绿史莱姆 enemyX（快怪）12 批 = 原 9 +【追加 3】，每批 6 只/路，0.5s
             紫史莱姆 enemyY（慢怪） 4 批 =【新增】，每批 5 只/路，0.8s
             水晶史莱姆 8 批 = 原 5 +【追加 3】，每批 3 只/路，0.9s
             自爆泥怪   7 批 = 原 5 +【追加 2】，每批 3 只/路，0.5s
             + 8 只金史莱姆 Boss（上下各 4）
             + 4 只熔岩巨兽（上下各 2，使用灰史莱姆 Boss 贴图；
               血量盾每 5s 刷新 / 岩浆爆发（半径 150）沉默 2s / 20% 血分裂 3 只
               特殊水晶史莱姆 / 全灭后聚合回 50% 血，见 lavaBoss.phases）===== */
          [ /* —— 绿史莱姆（快怪）：原 9 批，间隔 0.70→0.50 —— */
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 0 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 4 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 8 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 12 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 16 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 20 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 24 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 28 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 32 },
            /* —— 绿史莱姆：追加 3 批（穿插进时间线，不集中涌出）—— */
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 2 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 18 },
            { "type": "enemyX", "count": 6, "interval": 0.50, "delay": 34 },
            /* —— 紫史莱姆（慢怪）：4 批 —— */
            { "type": "enemyY", "count": 5, "interval": 0.80, "delay": 6 },
            { "type": "enemyY", "count": 5, "interval": 0.80, "delay": 15 },
            { "type": "enemyY", "count": 5, "interval": 0.80, "delay": 27 },
            { "type": "enemyY", "count": 5, "interval": 0.80, "delay": 39 },
            /* —— 水晶史莱姆：原 5 批，间隔 1.40→0.90 —— */
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 36 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 42 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 48 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 54 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 60 },
            /* —— 水晶史莱姆：追加 3 批 —— */
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 33 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 45 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 57 },
            /* —— 自爆泥怪：原 5 批，间隔 0.70→0.50 —— */
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 8 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 21 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 34 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 47 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 60 },
            /* —— 自爆泥怪：追加 2 批 —— */
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 14 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 40 },
            /* —— BOSS：4 只金史莱姆（上下各 2）+ 4 只熔岩巨兽（上下各 2）—— */
            { "type": "enemyBoss", "count": 4, "interval": 2, "delay": 52,
              "bossHpFactor": 100, "bossVariantPattern": ["gold"] },
            { "type": "lavaBoss", "count": 2, "interval": 2.5, "delay": 66,
              "bossHpFactor": 30, "bossTex": "boss_gray" } ]
        ]
      }
    },

    /* ============================================================
     * 第 9 关「元素狂暴图腾」——双螺旋交叉路线 · 四元素狂暴图腾 ·
     *   蓝色圣殿守卫（蓝史莱姆 Boss 贴图 + 光环减伤 + 圣盾 + 30% 狂暴）
     * ------------------------------------------------------------
     * 地图：两条「双螺旋」路线（route 0/1）从左缘上下两个出怪口进入，
     *   在中间反复交错（3 处真正的十字交叉 + 汇合），最后并入同一段
     *   y=270 主路通向右侧唯一终点大门。交叉点（几何实测）：
     *     route0 底线 × route1 竖线 → (300,430) / (740,430)
     *     route0 顶线 × route1 竖线 → (520,110)
     *   两路相错处道路同色叠加无痕，全 90° 直角、拐角圆角过渡。
     *   长度差用 routeBonus.speedMul 补偿（两路同时出怪到达终点时间一致）。
     * 元素狂暴图腾（JSON 驱动 totems，Level9Enemies.js 实现）：地图上 4 个
     *   不可破坏的图腾（火/冰/水/雷），每 interval(15s) 随机选一个，给
     *   【全屏小怪】附加对应元素的「元素护盾」（复用 Enemy 既有 element 值盾：
     *   同元素伤害被免疫，必须用其他元素（水/冰等）打元素反应消耗盾值破盾）。
     * BOSS：蓝色圣殿守卫（templeGuard，强制 boss_blue 蓝史莱姆 Boss 贴图）：
     *   光环减伤 50%（存活期间全场小怪受击减半，多只不叠加）+ 5000 血圣盾
     *   （每 5s 刷新）+ 30% 血线狂暴（吞噬周围 4 只小怪回 10% 血 + 2s 无敌）。
     * 难度：8 波、hpGrowth=1.8（每波 +80%）、出怪量与波次节奏完全参照第 8 关
     *   （逐组照搬第 8 关 list，仅把 BOSS 组换成 templeGuard）；清波奖励沿用
     *   第 8 关；初始金币 1200。解锁条件：通关第 8 关后自动解锁（storage.js）。
     * ============================================================ */
    "9": {
      "economy": { "startGold": 1200, "startLives": 20 },
      "killRewardAdjust": 5,          // 小怪击杀金币对齐第 8 关（略高于前 7 关）
      "upgradeWaveGate": 1,           // 开局即可升级 4 级塔
      "allTowersAvailable": true,     // 元素护盾需全元素协同破盾 → 全部塔可选
      "build": {
        /* 高密度火力点（第 9 关出怪量/Boss 数量都很大，需要更多塔位）：
           cell 30 / roadGap 52 → 沿路采样更密；
           roadGap2 100 → 每条路两侧再增加【第二排】塔位（离路心 100，塔射程 125+
                            仍能覆盖路面）→ 塔位数量成倍增加；
           minSpacing 40 → 方格 36px，间距 40 仍留 4px 空隙，阵列整齐不重叠；
           minPathDistance 52 保持不变 → 依旧「绝不压到路面」 */
        "cell": 30,
        "roadGap": 52,
        "roadGap2": 100,
        "minSpacing": 40,
        "minPathDistance": 52,
        /* 手工补点：四类区域的空口袋（自动点覆盖不到的地方）
           ① 左侧单行道两侧 ② 两个传送门出口附近 ③ 右侧两条长岔路内外弯与中间草地
           ④ 汇合大门前长廊两侧（最终防线）。非法点（距路 <52 或与前点重复）自动剔除 */
        "extraSpots": [
          /* ① 左侧单行道（上方一排 / 中间一排 / 下方一排） */
          { "x": 60,  "y": 58 }, { "x": 110, "y": 58 }, { "x": 160, "y": 58 },
          { "x": 210, "y": 58 }, { "x": 260, "y": 58 },
          { "x": 60,  "y": 180 }, { "x": 110, "y": 180 }, { "x": 160, "y": 180 },
          { "x": 240, "y": 180 },
          { "x": 84,  "y": 330 }, { "x": 196, "y": 330 }, { "x": 244, "y": 330 },
          /* ① 传送门入口（左下）周围 */
          { "x": 84,  "y": 370 }, { "x": 196, "y": 370 },
          { "x": 84,  "y": 430 }, { "x": 196, "y": 430 }, { "x": 140, "y": 482 },
          /* ② 两个出口传送门附近（上出口 (380,70) / 下出口 (380,470)） */
          { "x": 380, "y": 124 }, { "x": 420, "y": 124 }, { "x": 460, "y": 124 },
          { "x": 380, "y": 416 }, { "x": 420, "y": 416 }, { "x": 460, "y": 416 },
          /* ③ 上岔路内弯/中间草地 */
          { "x": 580, "y": 134 }, { "x": 600, "y": 134 },
          { "x": 700, "y": 124 }, { "x": 740, "y": 124 },
          { "x": 620, "y": 262 }, { "x": 700, "y": 250 }, { "x": 740, "y": 250 },
          /* ③ 下岔路内弯/中间草地（镜像） */
          { "x": 580, "y": 406 }, { "x": 600, "y": 406 },
          { "x": 700, "y": 416 }, { "x": 740, "y": 416 },
          { "x": 620, "y": 278 }, { "x": 700, "y": 290 }, { "x": 740, "y": 290 },
          /* ④ 汇合大门前长廊两侧（最终防线） */
          { "x": 856, "y": 218 }, { "x": 904, "y": 218 },
          { "x": 856, "y": 322 }, { "x": 904, "y": 322 }
        ]
      },
      /* 默认折角渲染（与第 1~8 关一致）：粗线 + 拐角同色圆点 →
         内角圆润、外角平滑过渡，不出现尖锐刺眼的直角 */
      "path": {
        "borderColor": 0xc99a54,
        "fillColor": 0xeac58f,
        "hideSpawnPortal": true    // 不画左侧出怪口绿色圆标：怪物直接从左侧道路边缘生成
      },
      /* ===== 第 9 关地图（v20261020f：左右长度重新配平 + 火力点常显）=====
         route 0 / route 1：【完全相同的单行道】——视觉上只有一条路（左侧无出怪圆标）。
         左侧单行道【保持出怪口不变，向下延伸】：出怪口仍为 (-40,110)，走到一半
         （(300,250)→(140,250) 之后）继续向下方延伸一段纵向道路 (140,250)→(140,430)，
         传送门入口因此从「中左侧」移到【左下方 (140,430)】；单行道全长 ≈820px。
         route 2：下岔路【长】——出口传送门 (380,470) 起，走 3 次 S 型上下折返
                  （470→340→470→回到中线 270），6 段直线、每段 130~200px，全长 ≈1006px；
                  终点前汇合走廊 (800,270)→(926,270) 为 126px。
         route 3：上岔路 —— 出口传送门 (380,70) 的镜像（70→200→70→回到中线）。
         汇合点 (800,270)：两条岔路在此并成一条主路通向唯一终点大门。
         拐角保持默认折角渲染（粗线 + 同色圆点）→ 圆润的 90° 直角，无锐角。
         相邻折返排距均 ≥130px（≥ 塔位所需的 52×2）→ 每段路的两侧都能布置火力点。
         火力点默认【隐藏不可见】：点选商店里的塔或点击草地空白处才高亮显示
         （沿用全局既有逻辑，未做任何改动）。
         出怪量/波次节奏/传送分流逻辑与上一版完全一致（spawnRoutes [0,1]）。 */
      "paths": [
        [
          { "x": -40, "y": 110 },    // 出怪口（在左侧道路外沿 → 怪物从道路边缘生成）
          { "x": 300, "y": 110 },    // ① 右（340）
          { "x": 300, "y": 250 },    // ② 下（140）—— U 型弯
          { "x": 140, "y": 250 },    // ③ 左（160）—— 「走到一半」的位置
          { "x": 140, "y": 430 }     // ④ 向下延伸（180）= 末端 = 传送门入口（左下方）
        ],
        [
          { "x": -40, "y": 110 },    // 与 route 0 完全相同的单行道（叠加渲染，视觉上一条路）
          { "x": 300, "y": 110 },
          { "x": 300, "y": 250 },
          { "x": 140, "y": 250 },
          { "x": 140, "y": 430 }     // 同一个传送门入口
        ],
        [
          { "x": 380, "y": 470 },    // 下岔：出口传送门
          { "x": 520, "y": 470 },    // ① 右（140）
          { "x": 520, "y": 340 },    // ② 上（130）
          { "x": 660, "y": 340 },    // ③ 右（140）—— S 型折返 1
          { "x": 660, "y": 470 },    // ④ 下（130）
          { "x": 800, "y": 470 },    // ⑤ 右（140）—— S 型折返 2
          { "x": 800, "y": 270 },    // ⑥ 回到中线（200）→ 汇合点
          { "x": 1000, "y": 270 }    // 共用主路通向右侧唯一终点大门（钳制在 926,270）
        ],
        [
          { "x": 380, "y": 70 },     // 上岔：出口传送门（关于 y=270 镜像）
          { "x": 520, "y": 70 },
          { "x": 520, "y": 200 },
          { "x": 660, "y": 200 },
          { "x": 660, "y": 70 },
          { "x": 800, "y": 70 },
          { "x": 800, "y": 270 },    // 同一个汇合点
          { "x": 1000, "y": 270 }    // 共用同一终点大门
        ]
      ],
      /* 传送门（沿用第 4 关的成熟机制，JSON 驱动）：
         a=入口（route 0/1 的向下延伸段末端 (140,430)，同一坐标 → 视觉只画一个入口传送门）
         b=出口（下岔 / 上岔的起点 (380,470)/(380,70)，各画一个发光旋转传送门） */
      "portals": {
        "invulnTime": 0.5,
        "pairs": [
          { "id": "l9dn", "direction": "oneway",
            "a": { "route": 0, "waypoint": 4 }, "b": { "route": 2, "waypoint": 0 } },
          { "id": "l9up", "direction": "oneway",
            "a": { "route": 1, "waypoint": 4 }, "b": { "route": 3, "waypoint": 0 } }
        ]
      },
      /* 童话草地装饰（仅本关）：已按要求去除所有水池/水面，只保留灌木/花丛/小树 */
      "decor": {
        "extra": 26
      },

      /* 两条岔路共用同一终点：任一路漏怪扣同一条命（route 0/1 是单行道，
         怪物在末端被传送走、不会走到路的尽头，因此不列入 goals） */
      "goals": [
        { "route": 2 },
        { "route": 3 }
      ],
      "waves": {
        "intermission": 20,
        "spawnRoutes": [0, 1],       // 两条单行道同坐标叠加 → 视觉上仍是单一出怪口 + 单条直道（出怪量不变）
        "hpGrowth": 1.8,             // 每波小怪血量 +80%（复合）
        "finalWaveSpecial": false,   // 末波不额外翻倍，严格 1.8 复合成长
        "finalBossHpFactor": 30,     // 兜底（每波 BOSS 由 per-group bossHpFactor 显式驱动）
        "clearBonus": [150, 260, 400, 560, 760, 1000, 1300, 2000],
        "bossVariantHpMul": false,   // BOSS 血量严格「小怪血 × bossFactor」，不吃变体微调
        /* 金色分裂 BOSS（仅第 3 波，由该组 entry.bossPhases:true 逐组触发）：
           血量降到 30% → 分裂 3 只绿色史莱姆小 BOSS；小 BOSS 移速 147
           = 绿史莱姆基础 98 × 1.5（比同类绿史莱姆快 50%）；
           全灭后聚合回父代 10% 血量。其它波的 BOSS 不带该标记 → 零影响 */
        "bossPhases": {
          "splitAtHpRatio": 0.30,
          "splitCount": 3,
          "miniType": "enemyX",
          "miniHp": 5000,
          "miniSpeed": 147,
          "miniTint": false,
          "mergeHpRatio": 0.10,
          "mergeKeepParentStats": true
        },
        /* 出怪总量与波次节奏仍与第 8 关逐波一致（仅做同数量替换与 BOSS 阵容重排） */
        "list": [
          /* ===== 第 1 波（照搬第 8 关）：每路 5 + 5 = 10 只（无元素盾怪）===== */
          [ { "type": "enemyX", "count": 5,  "interval": 0.85, "delay": 0 },
            { "type": "enemyX", "count": 5,  "interval": 0.85, "delay": 5 } ],
          /* ===== 第 2 波（照搬第 8 关出怪量：每路仍 27 只）：
             第三批 9 只快怪拆成「元素盾绿史莱姆 4 + 快怪 5」===== */
          [ { "type": "enemyX", "count": 9,  "interval": 0.60, "delay": 0 },
            { "type": "enemyX", "count": 9,  "interval": 0.60, "delay": 6 },
            { "type": "shieldSlime", "count": 4, "interval": 0.90, "delay": 12 },
            { "type": "enemyX", "count": 5,  "interval": 0.60, "delay": 12 } ],
          /* ===== 第 3 波（照搬第 8 关，BOSS = 2 只蓝守卫 ×30 血）：
             一批水晶史莱姆（delay 12）替换为 3 只元素盾绿史莱姆 ===== */
          [ { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 0 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 4 },
            { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 8 },
            { "type": "shieldSlime", "count": 3, "interval": 1.00, "delay": 12 },
            { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 16 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.55, "delay": 24 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 28 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 30 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 18 },
            { "type": "enemyBoss", "count": 1, "interval": 4, "delay": 32,
              "bossHpFactor": 30, "bossVariantPattern": ["gold"],
              "bossPhases": true, "bossSpeedMul": 1.5 } ],
          /* ===== 第 4 波（照搬第 8 关，BOSS = 2 只蓝守卫 ×40 血）：
             一批自爆泥怪（delay 13）替换为 3 只元素盾绿史莱姆 ===== */
          [ { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 0 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 3 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 7 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 10 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 14 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 17 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 21 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 24 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 28 },
            { "type": "bomberSlime", "count": 5, "interval": 0.80, "delay": 31 },
            { "type": "crystalSlime", "count": 4, "interval": 1.10, "delay": 34 },
            { "type": "crystalSlime", "count": 4, "interval": 1.10, "delay": 38 },
            { "type": "shieldSlime", "count": 3, "interval": 1.00, "delay": 13 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 27 },
            { "type": "enemyBoss", "count": 2, "interval": 4, "delay": 34,
              "bossHpFactor": 40, "bossVariantPattern": ["gold"] },
            { "type": "templeGuard", "count": 1, "interval": 4, "delay": 36,
              "bossHpFactor": 40, "bossTex": "boss_blue" } ],
          /* ===== 第 5 波（照搬第 8 关，BOSS = 3 只蓝守卫 ×50 血）：
             两批水晶史莱姆（delay 16 / 45）各替换为 5 只元素盾绿史莱姆
             → 本波共 10 只，大量出现 ===== */
          [ { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 0 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 2 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 8 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 10 },
            { "type": "shieldSlime", "count": 5, "interval": 0.90, "delay": 16 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 18 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 24 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 26 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 32 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 34 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 40 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 42 },
            { "type": "shieldSlime", "count": 5, "interval": 0.90, "delay": 45 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 48 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 51 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 13 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 27 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 41 },
            { "type": "enemyBoss", "count": 1, "interval": 3, "delay": 46,
              "bossHpFactor": 50, "bossVariantPattern": ["gold"] },
            { "type": "lavaBoss", "count": 1, "interval": 3, "delay": 48,
              "bossHpFactor": 50, "bossTex": "boss_gray" },
            { "type": "templeGuard", "count": 1, "interval": 3, "delay": 50,
              "bossHpFactor": 50, "bossTex": "boss_blue" } ],
          /* ===== 第 6 波（照搬第 8 关，BOSS = 4 只蓝守卫 ×60 血）：
             一批自爆泥怪（delay 8）替换为 3 只元素盾绿史莱姆 ===== */
          [ { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 0 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 2 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 5 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 7 },
            { "type": "shieldSlime", "count": 3, "interval": 1.00, "delay": 8 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 10 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 12 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 15 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 17 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 20 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 22 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 25 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 27 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 30 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 32 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 35 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 37 },
            { "type": "enemyX", "count": 10, "interval": 0.42, "delay": 40 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 42 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 44 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 47 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 50 },
            { "type": "crystalSlime", "count": 5, "interval": 1.10, "delay": 53 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 20 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 32 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 44 },
            { "type": "enemyBoss", "count": 1, "interval": 3, "delay": 46,
              "bossHpFactor": 60, "bossVariantPattern": ["gold"] },
            { "type": "lavaBoss", "count": 2, "interval": 3, "delay": 48,
              "bossHpFactor": 60, "bossTex": "boss_gray" },
            { "type": "templeGuard", "count": 1, "interval": 3, "delay": 50,
              "bossHpFactor": 60, "bossTex": "boss_blue" } ],
          /* ===== 第 7 波（照搬第 8 关，BOSS = 4 只蓝守卫 ×80 血）：
             4 批水晶史莱姆（delay 45/49/53/57）替换为 3 只元素盾绿史莱姆
             → 本波共 12 只，大量出现 ===== */
          [ { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 0,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 2 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 10,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 12 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 20,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 22 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 30,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 32 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 40,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 42 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 50,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 52 },
            { "type": "enemyX", "count": 4,  "interval": 1.60, "delay": 60,
              "elite": true, "eliteHpMul": 4, "eliteScale": 1.4, "eliteGoldBonus": 20 },
            { "type": "enemyX", "count": 8,  "interval": 0.50, "delay": 62 },
            { "type": "shieldSlime", "count": 3, "interval": 1.00, "delay": 45 },
            { "type": "shieldSlime", "count": 3, "interval": 1.00, "delay": 49 },
            { "type": "shieldSlime", "count": 3, "interval": 1.00, "delay": 53 },
            { "type": "shieldSlime", "count": 3, "interval": 1.00, "delay": 57 },
            { "type": "crystalSlime", "count": 3, "interval": 1.40, "delay": 61 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 8 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 21 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 34 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 47 },
            { "type": "bomberSlime", "count": 3, "interval": 0.70, "delay": 60 },
            { "type": "enemyBoss", "count": 2, "interval": 3, "delay": 66,
              "bossHpFactor": 80, "bossVariantPattern": ["gold"] },
            { "type": "lavaBoss", "count": 2, "interval": 3, "delay": 70,
              "bossHpFactor": 80, "bossTex": "boss_gray" },
            { "type": "templeGuard", "count": 1, "interval": 3, "delay": 74,
              "bossHpFactor": 80, "bossTex": "boss_blue" } ],

          /* ===== 第 8 波（终极波，照搬第 8 关出怪量与节奏，总量不变）：
             一批自爆泥怪（delay 40）替换为 3 只元素盾绿史莱姆；
             4 只蓝守卫 ×100 血 + 2 只蓝守卫 ×30 血（替代第 8 关的金 BOSS + 熔岩巨兽）===== */
          [ { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 0 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 4 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 8 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 12 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 16 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 20 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 24 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 28 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 32 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 2 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 18 },
            { "type": "enemyX", "count": 6,  "interval": 0.50, "delay": 34 },
            { "type": "enemyY", "count": 5,  "interval": 0.80, "delay": 6 },
            { "type": "enemyY", "count": 5,  "interval": 0.80, "delay": 15 },
            { "type": "enemyY", "count": 5,  "interval": 0.80, "delay": 27 },
            { "type": "enemyY", "count": 5,  "interval": 0.80, "delay": 39 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 36 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 42 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 48 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 54 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 60 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 33 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 45 },
            { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 57 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 8 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 21 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 34 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 47 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 60 },
            { "type": "bomberSlime", "count": 3, "interval": 0.50, "delay": 14 },
            { "type": "shieldSlime", "count": 3, "interval": 1.00, "delay": 40 },
            /* —— BOSS 阵容（总数 6 金 + 4 灰 + 2 蓝 = 12 只）——
               路线分配：金 4 只走上面路线(route 1)/金 2 只走下面路线(route 0)；
               灰色与蓝色各平均分到上下两条路线。
               route0 传送后去下岔、route1 去上岔（见 portals） */
            { "type": "enemyBoss", "count": 4, "interval": 2, "delay": 52,
              "bossHpFactor": 100, "bossVariantPattern": ["gold"], "routes": [1] },
            { "type": "enemyBoss", "count": 2, "interval": 2, "delay": 58,
              "bossHpFactor": 100, "bossVariantPattern": ["gold"], "routes": [0] },
            { "type": "lavaBoss", "count": 2, "interval": 2.5, "delay": 62,
              "bossHpFactor": 50, "bossTex": "boss_gray", "routes": [1] },
            { "type": "lavaBoss", "count": 2, "interval": 2.5, "delay": 64,
              "bossHpFactor": 50, "bossTex": "boss_gray", "routes": [0] },
            { "type": "templeGuard", "count": 1, "interval": 2.5, "delay": 68,
              "bossHpFactor": 50, "bossTex": "boss_blue", "routes": [1] },
            { "type": "templeGuard", "count": 1, "interval": 2.5, "delay": 70,
              "bossHpFactor": 50, "bossTex": "boss_blue", "routes": [0] } ]
        ]
      }
    },

    /* ============================================================
     * 第 10 关「无尽蛇径」——单出怪口 + 横平竖直蛇形折返 · 无尽模式
     * ------------------------------------------------------------
     * 地图（严格的 90° 直角塔防地形，横线与竖线交替）：
     *   · 只有一个出怪口，位于【屏幕左上角】(-60,112)（怪物从左缘走进来）；
     *   · 路线拆成【左、右两个蛇形街区】，中间留一条 140px 的竖向连接
     *     走廊（riser）把两列串起来：
     *       左列 x 40..420：右→下→左→下→右（自上而下 3 条车道）
     *       走廊 x=490：自下而上翻到右列顶部（310px，两侧留空不压塔位）
     *       右列 x 560..920：右→下→左→下→右（自上而下 3 条车道）
     *       底部延伸：y=515 向左 745px，通到【贴着左侧的大门】(175,515)
     *   · 单段横线 360~480px（屏宽 37~50%），比 790~980px 的旧版缩短一半；
     *     共 12 个 90° 拐角；
     *   · 车道行距 155px（y=112 / 267 / 422），两车道之间净空 105px，
     *     并排放下【2 排】正方形塔位（距车道 47 / 108px，两排相隔 61px，
     *     足够容下 56px 的 3 级塔身，塔与塔之间不遮挡）；
     *   · 末端 (175,515) 即【终点大门】：尽量贴到屏幕最左侧，同时按实测的
     *     左下角按钮占位（世界 x 9~107）收窄了本关的冲突禁区（build 上方
     *     hudAvoid.btnZone 130×110）——门体右移进门框后按钮不会上移，
     *     门的左边缘 136 与按钮右边缘 107 之间仍留 29px 视觉空隙。
     *   · 单线总长 4228px（480+155+380+155+450+310+430+155+360+155+360+93+745），
     *     speedMul 0.56，普通快怪(enemyX 98px/s)单程 ≈77s ≥ 60s。
     * 拐角（微小圆角 90°）：【不使用 path.smooth】—— 走游戏默认的
     *   「粗线 + 拐角同色圆点」渲染：路面在拐角处是标准 90° 直角，外角由
     *   半径 25px 的同色圆点覆盖成圆角矩形的边角（无尖角、也绝不是大弧
     *   度弯道）；内角同样被圆点填平，不会出现刺眼的尖刺。
     * 火力点（36px 统一方格 · 紧密、互不重叠）：
     *   · spotSize 36 / spotRadius 10 = 与第 1~9 关完全一致的尺寸；
     *     cell=42 / minSpacing=38 → 相邻方格之间 4~6px 细缝，清晰可辨、好点选；
     *   · roadGap 47 / roadGap2 108：每个车缝两排塔位，两排相隔 61px，
     *     相邻两排的塔身（最高 56px）之间仍留 5px，互不遮挡；
     *   · 最顶部一整排（y≈65）+ 5 条水平塔位带（y≈159 / 220 / 314 / 375 / 469），
     *     被中间走廊分成左右两段，成排对齐；
     *   · 最底一排（y≈469）单独保持 24px 小方格与原位置，其余各排统一 36px；
     *   · minPathDistance=45 → 36px 方格距路缘 ≥4px，24px 方格距路缘 ≥8px；
     *   · 实测 100 个可放塔点，相邻方格最小边距 4px（无挤压、无重叠）；
     *   · 终点大门 (175,515) 门体范围内的塔位用 excludeSpots 剔除；
     *   · 左下角 HUD 区塔位由关卡专属 uiSafeZones 剔除（见 build.uiSafeZones）。
     * 无尽波次（全部 JSON 驱动，GameScene 程序化生成，见 buildEndlessWave）：
     *   · 无通关结算：清完最后一波也不会胜利，只有生命扣光才失败并结算波数；
     *   · 前 3 波普通基础怪（enemyX / enemyY）熟悉地形与铺塔；
     *   · 第 4 波起出怪量拉满（快怪潮 + 肉盾 + 水晶史莱姆 + 元素盾绿史莱姆 +
     *     自爆泥怪），并随波数继续增密、缩短出怪间隔 → 后期怪海连绵不断；
     *   · 血量：前 10 波按 hpGrowth(1.5) 复合成长；【第 10 波之后每波比上一波
     *     +40%】（endless.hpGrowthAfterRamp = 1.4）；
     *   · 移速：每 5 波全体敌人移速 +5%（复合，endless.speedStep / EveryWaves）；
     *   · BOSS：第 6 波起每波固定 2~4 只（金/灰/蓝随机组合），血量同样吃波次
     *     成长（= 当波小怪血 × bossHpFactor）；击杀掉落 2000 金币，保证后期
     *     有足够金币把全图火力点升满 4 级塔。
     * 经济：初始金币 2500（开局即可建立第一道防线）；小怪击杀金币 +10；
     *   清波奖励随波数递增（200 + 120×已清波数）。
     * 障碍物：关闭自动布点（obstaclesAutoCount=0），把整张地图的火力点
     *   全部留给玩家，不摆杂物。
     * ============================================================ */
    "10": {
      "economy": { "startGold": 2500, "startLives": 20 },
      "killRewardAdjust": 10,        // 小怪击杀金币略高（无尽模式经济更宽裕）
      "upgradeWaveGate": 1,          // 开局即可升级 4 级塔
      "allTowersAvailable": true,    // 水晶/元素盾/自爆混合出怪 → 全部塔可选
      "build": {
        /* 火力点：除最底一排外，尺寸与前几关完全一致（全局 36px 方格）。
           spotSize 36 / spotRadius 10 = 第 1~9 关默认尺寸；
           cell 42 / minSpacing 38 → 36px 方格之间留 4~6px 细缝（紧密不粘连、
           互不重叠，方便点选）；
           roadGap 47 / roadGap2 108 → 同缝两排相隔 61px，塔身互不遮挡；
           minPathDistance 45 → 36px 方格距路缘 4px 以上，绝不压路；
           rowSpotSize：最底部一带（y≈469±32）仍保留 24px 小方格与原位置。 */
        "cell": 42,
        "roadGap": 47,
        "roadGap2": 108,
        "minSpacing": 38,
        "minPathDistance": 45,
        "spotSize": 36,
        "spotRadius": 10,
        "rowSpotSize": [ { "y": 469, "size": 24, "tol": 32 } ],
        /* 【排除点】终点大门 (175,515) 门体内部（宽 78 高 83）的塔位剔除，
           避免塔位被城堡大门遮挡、点了没反应 */
        "excludeSpots": [ { "x": 175, "y": 487 } ],
        "excludeRadius": 62,
        /* 【本关专属 HUD 禁区】顶部两条收窄（h 104→56）：
           让「第一条车道上方的空白草地」能放下一整排塔位（y≈68）；
           HUD chip 本身 pointer-events:none，点击可穿透，只保留按钮区；
           左下角覆盖波次按钮 +「第 N 波 进行中」提示的实际占位
           （大门已右移到 370，不再触发按钮上移）。 */
        "uiSafeZones": [
          { "x": 0,   "y": 0,   "w": 500, "h": 56 },
          { "x": 674, "y": 0,   "w": 286, "h": 56 },
          { "x": 0,   "y": 430, "w": 160, "h": 110 }
        ]
      },
      /* 拐角：默认「粗线 + 拐角同色圆点」渲染（不设 smooth）——
         标准 90° 直角 + 半径 25px 的同色圆点，形成圆角矩形般的微小圆角，
         既无尖角也没有大弧度弯道。 */
      "path": {
        "borderColor": 0xc99a54,
        "fillColor": 0xeac58f
      },
      /* 障碍物：关闭自动随机布点 —— 整张地图的可放塔点全部留给玩家 */
      "obstaclesAutoCount": 0,
      /* 结束大门与左下角按钮的冲突判定：本关把门贴到最左侧，按实测
         「第 N 波 进行中 + 开始按钮」实际占位（世界 x 9~107 / y 526~588）
         收窄为 130×110 的窄禁区 —— 门只要不进入这里，按钮就不会上移。 */
      "hudAvoid": { "btnZone": { "x": 0, "y": 430, "w": 130, "h": 110 } },
      /* 双列蛇形 + 中间竖向连接走廊 + 底部左延（只此一条）：
         左列 3 条车道 → 走廊自下而上翻到右列顶部 → 右列 3 条车道 →
         底部 y=515 向左 → 终点大门尽量贴左到 (175,515)，避开左下角按钮 */
      "paths": [
        [
          { "x": -60,  "y": 112 },    // 出怪口（屏幕左上角，画面外左沿）
          /* ---- 左列（x 40..420，自上而下 3 条车道）---- */
          { "x": 420,  "y": 112 },    // ① 向右 480px（拐 1）
          { "x": 420,  "y": 267 },    // ② 向下 155px（拐 2）
          { "x": 40,   "y": 267 },    // ③ 向左 380px（拐 3）
          { "x": 40,   "y": 422 },    // ④ 向下 155px（拐 4）
          { "x": 490,  "y": 422 },    // ⑤ 向右 450px（拐 5，进入中间走廊）
          /* ---- 中间连接走廊（x=490，自下而上翻到右列顶部）---- */
          { "x": 490,  "y": 112 },    // ⑥ 向上 310px（拐 6）
          /* ---- 右列（x 560..920，自上而下 3 条车道）---- */
          { "x": 920,  "y": 112 },    // ⑦ 向右 430px（拐 7）
          { "x": 920,  "y": 267 },    // ⑧ 向下 155px（拐 8）
          { "x": 560,  "y": 267 },    // ⑨ 向左 360px（拐 9）
          { "x": 560,  "y": 422 },    // ⑩ 向下 155px（拐 10）
          { "x": 920,  "y": 422 },    // ⑪ 向右 360px（拐 11）
          /* ---- 底部延伸：向左贴到最左侧，大门在 (175,515) 且避开按钮 ---- */
          { "x": 920,  "y": 515 },    // ⑫ 向下 93px（拐 12）
          { "x": 175,  "y": 515 }     // ⑬ 向左 745px → 终点大门 (175,515)
        ]
      ],
      /* 单路线关卡：无需 goals 配置（默认取唯一路线末路径点作终点大门）。
         备注：路线 0 全长 4228px（480+155+380+155+450+310+430+155+360+155+360+93+745）。 */
      "waves": {
        "intermission": 20,          // 波间倒计时 20 秒（可手动提前）
        "spawnRoutes": [0],          // 唯一出怪口 → 唯一路线
        "hpGrowth": 1.5,             // 前 10 波小怪血量复合 +50%
        "finalWaveSpecial": false,   // 无尽模式不走「末波翻倍」特例
        "finalBossHpFactor": 20,     // BOSS 血量兜底（每波由 bossHpFactor 显式驱动）
        "clearBonus": [200, 320, 440],
        /* 全关敌人统一移速折扣：路线总长 4228px，打 0.56 折扣后
           普通快怪(enemyX 98px/s)单程 ≈77s ≥ 60s */
        "routeBonus": { "0": { "speedMul": 0.56 } },
        /* ---- 无尽波次参数（GameScene.buildEndlessWave / waveSmallHp 读取）---- */
        "endless": {
          "basicWaves": 3,           // 前 3 波：普通基础怪（enemyX/enemyY）
          "denseFromWave": 4,        // 第 4 波起：出怪量拉满（怪海）
          "denseInterval": 0.5,      // 第 4 波基准出怪间隔（秒，随波数递减）
          "hpRampWaves": 10,         // 前 10 波按 hpGrowth 复合成长
          "hpGrowthAfterRamp": 1.4,  // 第 10 波之后：每波血量 = 上一波 ×1.4（+40%）
          "speedEveryWaves": 5,      // 每 5 波
          "speedStep": 0.05,         // 全体敌人移速 +5%（复合）
          "bossFromWave": 6,         // 第 6 波起每波都有 BOSS
          "bossCountMin": 2,         // 第 6~9 波 BOSS 数量下限
          "bossCountMax": 4,         // 第 6~9 波 BOSS 数量上限（金/灰/蓝随机组合）
          /* 第 10 波起 BOSS 数量阶梯递增：第 bossScaleFromWave 波固定
             bossCountBase 只，之后每过 bossCountStepEvery 波 +bossCountStep 只
             （10 波 4 只 → 15 波 5 只 → 20 波 6 只 → 25 波 7 只 …） */
          "bossScaleFromWave": 10,
          "bossCountBase": 4,
          "bossCountStepEvery": 5,
          "bossCountStep": 1,
          "bossHpFactor": 20,        // BOSS 血量 = 当波小怪血 ×20（随波次成长）
          "bossReward": 2000,        // 击杀 BOSS 掉落金币
          "clearBonusBase": 200,     // 清波奖励基数
          "clearBonusPerWave": 120,  // 每清一波额外 +120（随波数递增）
          /* ---- BOSS 极限回血（对抗百分比伤害，第 10 波起全部 BOSS）----
             受到实际血量伤害（含百分比真伤）→ 在 healDuration 秒内回复
             healPct(20%) 最大生命；burstWindow 秒内累计打出超过 burstPct(30%)
             最大生命的伤害 → 回血被打断并压制 suppressDuration 秒；
             血量低于 disableBelowHpRatio(10%) → 机制失效（防卡血不死）。
             血条下方绿色闪烁细线 = 回血提示，提示玩家集火压制。 */
          "bossExtremeHeal": {
            "fromWave": 10,
            "healPct": 0.20,
            "healDuration": 3,
            "burstPct": 0.30,
            "burstWindow": 5,
            "suppressDuration": 5,
            "disableBelowHpRatio": 0.10
          },
          /* ---- 三大金币消耗机制（仅第 10 关无尽模式）----
             祭坛：点击花 10000，全屏怪物受到伤害 +50%、移速 -50%，持续 10 秒，
                   可重复花钱刷新（无冷却）。
             买血：顶部生命旁按钮，5000 金币 +1 生命，无冷却无上限。
             封印：右侧面板逐塔花 400000 永久解封（td_endless_seals_v1 本地存档）。 */
          "buyLifeCost": 5000,
          "altar": {
            "cost": 10000,
            "duration": 10,
            "defenseBonus": 0.50,      // 降防 50% → 怪物受到伤害 ×1.5
            "slowFactor": 0.50,        // 移速 ×0.5
            /* 祭坛位置：仅 1 个，移到地图最下方两条底部车道之间的空地
               (480,468)：距 y=422 / y=515 两条路均 46~47px（不压路），
               同时避开终点大门 (175,506) 与左下角开始按钮 (x<130)。 */
            "positions": [ { "x": 480, "y": 468 } ]
          },
          /* 解封各塔（Lv4 生效；数值均集中在此，便于后续调整） */
          "seals": {
            "cost": 400000,
            /* 全局解封：所有塔的子弹 / 弹幕飞行速度 ×3 */
            "globalBulletSpeed": { "bulletSpeedMul": 3 },
            "towerA": { "burnUnlimited": true, "burnMinDamage": 10 },
            "towerE": { "jumps": 20, "removeDecay": true, "truePct": 0.05, "trueCooldown": 3 },
            "towerB": { "coldHpPerSecPct": 0.05, "bossFreezeDuration": 1, "bossFreezeCooldown": 5 },
            "towerC": { "wetRadius": 100, "wetPerStackAmp": 0.20 },
            "towerD": { "truePctPerSec": 0.05, "duration": 5, "cooldown": 10 },
            "towerF": { "dmgAmp": 0.40 },
            /* 防御塔二次解封：解除叠层 / 触发 CD */
            "towerA2": { "burnStacksPerHit": 3 },
            "towerB2": { "instantCold": true },
            "towerC2": { "unlimitedWet": true },
            "towerD2": { "continuous": true, "duration": 5 },
            "towerE2": { "trueEveryChain": true, "paralyzeAll": true },
            "towerF2": { "ampPerHit": 0.20, "bossDotPctPerSec": 0.05, "bossDotDuration": 5 }
          },
          /* 火塔 Lv4 溅射（仅第 10 关覆盖：普通关卡仍为 TowerConfig 的 50%） */
          "fireSplashRatio": 2.0
        },
        /* 金色 BOSS 的低血分裂（buildEndlessWave 给金 BOSS 组带 bossPhases:true）：
           血量降到 30% → 分裂 3 只绿色史莱姆小 BOSS（血量均分残余血量）；
           全灭后聚合回父代 10% 血量。
           miniSpeed = 98(enemyX) × 0.56(routeBonus) × 1.5 ≈ 82，
           与本关整体速度口径一致（比同场绿史莱姆快 50%）。 */
        "bossPhases": {
          "splitAtHpRatio": 0.30,
          "splitCount": 3,
          "miniType": "enemyX",
          "miniSpeed": 82,
          "miniTint": false,
          "mergeHpRatio": 0.10,
          "mergeKeepParentStats": true
        },
        /* 出怪表占位（无尽模式实际波次由 buildEndlessWave 程序化生成，
           本表只用于「本关媒体按需加载」的探测：确保水晶史莱姆/自爆泥怪
           视频、BOSS 运动/死亡视频、熔岩巨兽/圣殿守卫贴图、以及元素盾
           史莱姆贴图控制器被正确预载） */
        "list": [
          [ { "type": "enemyX", "count": 6,  "interval": 0.90, "delay": 0 } ],
          [ { "type": "enemyX", "count": 10, "interval": 0.70, "delay": 0 },
            { "type": "enemyY", "count": 2,  "interval": 1.30, "delay": 4 } ],
          [ { "type": "enemyX", "count": 14, "interval": 0.55, "delay": 0 },
            { "type": "enemyY", "count": 4,  "interval": 1.20, "delay": 5 } ],
          [ { "type": "crystalSlime", "count": 3, "interval": 0.90, "delay": 0 },
            { "type": "shieldSlime",  "count": 3, "interval": 0.90, "delay": 4 },
            { "type": "bomberSlime",  "count": 3, "interval": 0.60, "delay": 8 } ],
          /* 三种 BOSS 各占一组（真类型绑定：金=enemyBoss 变体 / 灰=lavaBoss /
             蓝=templeGuard），仅供媒体预载与贴图探测，实际出怪由 buildEndlessWave 生成 */
          [ { "type": "enemyBoss", "count": 1, "interval": 3, "delay": 4,
              "bossHpFactor": 20, "bossVariantPattern": ["gold"], "reward": 2000 },
            { "type": "lavaBoss", "count": 1, "interval": 3, "delay": 6,
              "bossHpFactor": 20, "bossTex": "boss_gray", "reward": 2000 },
            { "type": "templeGuard", "count": 1, "interval": 3, "delay": 8,
              "bossHpFactor": 20, "bossTex": "boss_blue", "reward": 2000 } ]
        ]
      }
    }
  },

  "sellReturn": 0.60   // 出售返还总投入的 60%
};
