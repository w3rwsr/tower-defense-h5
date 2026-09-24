/* ============================================================
 * config.js —— 全部数值 / 路径 / 波次的 JSON 配置
 * 后续改数值、换名字、加塔加敌人，只改本文件即可。
 * ============================================================ */

/* 全局无衬线字体栈：优先系统内置高清字体（无需下载字体文件，零加载延迟），
   覆盖 Android(Roboto) / iOS(PingFang) / Windows(YaHei/Segoe) / 桌面 Chrome(Inter) */
window.TD_FONT_STACK =
  'Inter, Roboto, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, -apple-system, Arial, sans-serif';

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
  "towers": {
    "towerA": {
      "name": "塔A",
      "desc": "单体高伤·攻速慢",
      "cost": 100,
      "color": 0x4a90e2,
      "darkColor": 0x2f6bb3,
      "targeting": "furthest",
      "stats": {
        "damage": 42,
        "range": 155,
        "cooldown": 1.35      // 攻击间隔（秒）
      },
      "projectile": {
        "speed": 460,         // 弹道速度 px/s
        "radius": 8,
        "color": 0x9fd0ff,
        "effect": { "type": "damage", "value": 42 }
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,   // 升级费 = 造价 * costFactor * 当前等级
        "damage": 1.65,
        "range": 1.10,
        "cooldown": 0.85
      }
    },

    "towerB": {
      "name": "塔B",
      "desc": "范围减速·伤害低",
      "cost": 120,
      "color": 0x53d8e6,
      "darkColor": 0x2a9aa8,
      "targeting": "furthest",
      "stats": {
        "damage": 9,
        "range": 135,
        "cooldown": 1.05
      },
      "projectile": {
        "speed": 330,
        "radius": 9,
        "color": 0xc8f6ff,
        "effect": {
          "type": "splashSlow",
          "value": 9,
          "splashRadius": 68,
          "slowFactor": 0.50,      // 减速到 50% 移速
          "slowDuration": 1.6      // 持续秒数
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
      "color": 0xffb43b,
      "darkColor": 0xd98a1c,
      "targeting": "furthest",
      "stats": {
        "damage": 7,
        "range": 125,
        "cooldown": 0.26
      },
      "projectile": {
        "speed": 560,
        "radius": 6,
        "color": 0xffe2a3,
        "effect": { "type": "damage", "value": 7 }
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
      "stats": {
        "damage": 0,
        "range": 200,
        "cooldown": 0
      },
      "effect": {
        "type": "pull",
        "targetFilter": "nonBoss", // 只吸小怪：cfg.boss===true 的 BOSS 免疫；缺省/其他值=全敌
        "pullStrength": 7,     // 单次吸附时位移收敛速率（越大越快被拉拢，1/秒），所有小怪同一速率
        "maxDisplace": 95,     // 沿路向塔投影点的最大位移（像素，向前/向后对称限幅），绝不会被拉出道路
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
        "jumps": 3,            // 基础弹跳次数（1 级时 3 跳）
        "jumpDecay": 0.90,     // 每跳伤害衰减 10%（伤害 = 上一跳 × 0.90）
        "chainRange": 130,     // 弹跳搜索范围：上一目标到此范围内的最近未被击中怪
        "visualDuration": 0.25 // 闪电视觉持续秒数（0.2~0.3，避免画面杂乱）
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,
        "damage": 1.55,
        "range": 1.10,
        "cooldown": 0.88,
        "jumps": 1             // 每升 1 级弹跳次数 +1（1级3跳/2级4跳/3级5跳）
      }
    }
  },
  "enemies": {
    "enemyX": {
      "name": "敌人X",
      "hp": 46,
      "speed": 98,          // px/s
      "radius": 15,
      "reward": 9,          // 击杀金币
      "leakDamage": 1,      // 到达终点扣生命
      "color": 0xff6b6b,
      "darkColor": 0xc94444
    },
    "enemyY": {
      "name": "敌人Y",
      "hp": 175,
      "speed": 45,
      "radius": 19,
      "reward": 18,
      "leakDamage": 2,
      "color": 0xa06cd5,
      "darkColor": 0x7447a6
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
      "barThickness": 8
    }
  },

  /* ---------- BOSS 全局系数 ---------- */
  "boss": {
    "hpMultiplier": 8,      // 兜底：BOSS 血量 = 同波小怪血量 × 此值（末波实际走 waves.finalBossHpFactor）
    "leakMultiplier": 3,    // BOSS 漏怪扣生命 = 普通怪(enemyX)漏血 × 此值
    "rewardBonus": 0       // 击杀额外金币（已含在 enemyBoss.reward）
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

    /* ---------- 第 5 关：迷域回廊（最终关：上下双路线 + 跨路线传送 + 三阶 BOSS） ----------
     * 几何（v20260924e：删除 A-D 无用段、右终点向右延伸）：
     *   route 0 上路 = 左上出怪 → (560,80) 传送门 A；原 (560,80)→(560,220)
     *                  →(150,220) 那段 A-D 无用道路已删除（普通怪在 A 即传送、
     *                  BOSS 也走 A→B 传去下路，无需这段路）。
     *   route 1 下路 = 右下出怪 → (620,470)[C] → (620,340)[B] → (390,340) →
     *                  (390,470) → (920,470) → (920,510) 右终点（向右延伸）。
     *   route 2 左尾段 = (150,220) 传送门 D 出口 → (150,505) 左终点洞穴。
     * 传送门 2 对跨路线缠绕（单向，JSON 驱动）：
     *   cross1: A(route0,w1 560,80) → B(route1,w2 620,340)，affectBoss:true
     *           （上路 BOSS 随小怪一起传去下路走完全程到右终点）；
     *   cross2: C(route1,w1 620,470) → D(route2,w0 150,220)，affectBoss:false
     *           （下路 BOSS 不传送，走完整下路到右终点，三阶段可控）。
     *   上路小怪/BOSS → 右终点；下路小怪 → 左终点；下路 BOSS → 右终点。
     * 双终点共享血量：任一边漏怪都扣同一条命（HUD 单生命显示）。
     * 波次：常规 5 波 spawnRoutes=[0,1]；hpGrowth=1.6（每波 +60%）；
     *       第 3/4 波 BOSS=×16，第 5 波 BOSS=×50 并启用三阶段（bossPhases）。 */
    "5": {
      "economy": { "startGold": 320, "startLives": 20 },
      "build": {
        "cell": 76,
        /* 第 5 关专属额外火力点（buildHotspots 统一做界内/避路/去重硬校验）：
           覆盖上路（y=80）上下两侧、两路中带、下路上方及右延伸段，全程无火力空白 */
        "extraSpots": [
          { "x": 616, "y": 40 },  { "x": 688, "y": 40 },   // 顶部右侧一排（覆盖上路）
          { "x": 688, "y": 120 }, { "x": 688, "y": 184 },  // 右竖排（上路下方）
          { "x": 652, "y": 256 }, { "x": 724, "y": 256 },  // 两路中带一排
          { "x": 700, "y": 400 },                           // y=340 水平段下方
          { "x": 718, "y": 260 }, { "x": 842, "y": 260 },  // x=780 垂直段两侧
          { "x": 860, "y": 118 },                           // y=180 水平段上方
          { "x": 878, "y": 270 },                           // x=940 垂直段左侧
          { "x": 880, "y": 422 },                           // y=360 水平段下方
          { "x": 758, "y": 440 }                            // x=820 垂直段左侧
        ]
      },
      "path": { "borderColor": 0xc99a54, "fillColor": 0xeac58f },
      "paths": [
        /* route 0：上路（左上出怪 → 传送门 A，仅此一段；A-D 段已删除） */
        [
          { "x": -40, "y": 80 },
          { "x": 560, "y": 80 }     // w1 = 传送门 A（入口）
        ],
        /* route 1：右下侧道路（重新设计：B 出来后蛇形走向右下终点）
           出怪→C入口→B出口→右→上→右→下→左→下→右终点，流畅不折返 */
        [
          { "x": 1000, "y": 470 },
          { "x": 620, "y": 470 },   // w1 = 传送门 C（入口）
          { "x": 620, "y": 340 },   // w2 = 传送门 B（出口）
          { "x": 780, "y": 340 },   // 向右
          { "x": 780, "y": 180 },   // 向上
          { "x": 940, "y": 180 },   // 向右至右边缘
          { "x": 940, "y": 360 },   // 向下
          { "x": 820, "y": 360 },   // 向左
          { "x": 820, "y": 515 }    // w8 = 右终点洞穴（右下角）
        ],
        /* route 2：左尾段（传送门 D 出口 → 左终点洞穴；仅承接下路传送来的小怪） */
        [
          { "x": 150, "y": 220 },   // w0 = 传送门 D（出口）
          { "x": 150, "y": 505 }    // w1 = 左终点洞穴
        ]
      ],
      /* 双终点洞穴（JSON 驱动）：按路线末路径点绘制；缺省关卡（1~4）无此
         字段时维持原有单终点行为，不受影响 */
      "goals": [
        { "route": 2, "label": "左终点" },
        { "route": 1, "label": "右终点" }
      ],
      /* 传送门 2 对跨路线缠绕（A→B 上路→下路、C→D 下路→上路，单向）；
         cross1 affectBoss:true（上路 BOSS 随 A→B 传去下路），
         cross2 affectBoss:false（下路 BOSS 走完全程到右终点，三阶段可控）；
         传送后 0.5s 无敌 */
      "portals": {
        "invulnTime": 0.5,
        "pairs": [
          { "id": "cross1",
            "a": { "route": 0, "waypoint": 1 },
            "b": { "route": 1, "waypoint": 2 },
            "direction": "oneway", "affectBoss": true },
          { "id": "cross2",
            "a": { "route": 1, "waypoint": 1 },
            "b": { "route": 2, "waypoint": 0 },
            "direction": "oneway", "affectBoss": false }
        ]
      },
      "waves": {
        "intermission": 15,
        "spawnRoutes": [0, 1],        // 上下两路同时出怪（双终点共享生命）
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
        ]
      }
    },
  },

  "sellReturn": 0.60   // 出售返还总投入的 60%
};
