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

  /* ---------- 放塔规则（网格吸附 + 离路距离校验） ---------- */
  "build": {
    "cell": 80,              // 网格大小，也是触控热区间距
    "edgeMargin": 34,        // 距画面边缘最小距离
    "minPathDistance": 56,   // 塔心距路径中心线的最小距离
    "touchRadius": 30        // 点选已有塔的热区半径（放大触控）
  },

  /* ---------- 经济 ---------- */
  "economy": {
    "startGold": 260,
    "startLives": 20
  },

  /* ---------- 波次 ---------- */
  "waves": {
    "intermission": 15,      // 波次间倒计时（秒），可手动提前
    "clearBonus": [40, 50, 60, 75, 100], // 每波清场奖励
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
       每 attractInterval(2s) 触发一次吸附脉冲，把它们【沿道路方向】
       向塔的路径投影点回拉（只沿路径切线、只向后拉、限幅 maxDisplace），
       敌人渲染点始终是路径上的点，绝不会被拉出道路；吸附结束位移回弹
       归零、继续前进，被显著回拉期间推进减速（ctrlSlow 0.5）。
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
        "pullStrength": 7,     // 单次吸附时位移收敛速率（越大越快被拉拢，1/秒）
        "maxDisplace": 95,     // 沿路向后最大回拉距离（像素），敌人绝不会被拉出道路
        "attractInterval": 2000, // 吸附间隔（毫秒）：每 2 秒触发一次
        "attractDuration": 500   // 单次吸附持续（毫秒）：收敛窗口，结束后回弹归位继续前进
      },
      "upgrade": {
        "maxLevel": 3,
        "costFactor": 0.80,
        "damage": 1,
        "range": 1.12,
        "cooldown": 1
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

    /* BOSS —— 第 2 关末波末敌。血量/漏血在 GameScene.spawnEnemy
       按「普通怪(enemyX)当前波血量 × boss.hpMultiplier」动态覆盖，
       这里 hp/leakDamage 仅作兜底占位。boss=true 标记触发大体型/
       更粗血条/特殊贴图（皇冠角）。 */
    "enemyBoss": {
      "name": "BOSS",
      "hp": 460,
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
    "hpMultiplier": 5,      // BOSS 血量 = 普通怪(enemyX)当前波血量 × 此值
    "leakMultiplier": 3,    // BOSS 漏怪扣生命 = 普通怪(enemyX)漏血 × 此值
    "rewardBonus": 0       // 击杀额外金币（已含在 enemyBoss.reward）
  },

  /* ---------- 关卡独立配置 ----------
   * 每关一份：path(路径点)/waves(波次)/hpGrowth(每波血量递增系数)/
   * economy(起始金币生命)。Level 1 不在此登记，GameScene 回退到顶层
   * path/waves/economy（零改动保持已正常体验）。
   * hpGrowth=1.0 表示无递增；1.20 = 每波 +20%（复合）。 */
  "levels": {
    "2": {
      "economy": { "startGold": 300, "startLives": 20 },
      "hpGrowth": 1.20,
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
        "clearBonus": [40, 55, 70, 90, 120],
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
    }
  },

  "sellReturn": 0.60   // 出售返还总投入的 60%
};
