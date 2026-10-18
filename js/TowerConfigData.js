/* ============================================================
 * TowerConfigData.js —— 4 级塔配置运行时副本（由 TowerConfig.json 生成，勿手改）
 *
 * 为什么存在：本项目需兼容 file:// 协议双击打开（浏览器在 file:// 下
 * 禁止 fetch/XHR 读取本地 JSON），故与 FireBurnData.js 等资产一致，
 * 以内嵌 JS 数据模块作为运行时副本。
 *
 * 唯一事实来源是根目录 TowerConfig.json。修改数值后运行：
 *     python build_tower_config.py
 * ============================================================ */
window.TOWER_CONFIG_V4 = {
  "_doc": {
    "说明": "防御塔 4 级进化配置（塔侧异常状态数值的唯一来源）。file:// 协议下浏览器无法 fetch 本地 JSON，运行时读取由 build_tower_config.py 生成的内嵌副本 js/TowerConfigData.js。修改数值请改本文件后运行：python build_tower_config.py",
    "upgrade4.maxLevel": "所有塔可升到的最高等级（3 级后解锁 4 级）",
    "upgrade4.cost": "升到 4 级的金币消耗（固定值，不受关卡 upgradeCostFactor 影响）",
    "upgrade4.waveGate": "升级 4 级的波次门槛：当前波次 >= 该值才允许升级",
    "haloColor": "4 级塔底部发光光环颜色（#RRGGBB），光环持续旋转+呼吸",
    "hpPerSecPct": "DOT 每秒扣除目标最大生命值的比例（0.01 = 1%/秒），每次扣血保底 1 点",
    "applyStatus契约": "塔侧通过怪物预留接口 applyStatus(type, data) 施加状态，type ∈ burn灼烧 / chill寒冷 / wet潮湿 / paralysisStack麻痹值 / paralyzed麻痹定身 / stun眩晕 / windErosion风蚀；受伤增幅(潮湿/风蚀)与降防(寒冷/麻痹值)的结算由怪物侧实现，塔侧只负责施加与 DOT 计算",
    "stackable": "false = 状态不可叠加，重复施加只刷新持续时间"
  },
  "upgrade4": {
    "maxLevel": 4,
    "cost": 800,
    "waveGate": 4
  },
  "towers": {
    "towerA": {
      "haloColor": "#ff7a4d",
      "stats": {
        "damage": 320,
        "cooldown": 0.556
      },
      "splash": {
        "radius": 50,
        "ratio": 0.5
      },
      "burn": {
        "duration": 5,
        "hpPerSecPct": 0.01,
        "minDamage": 1,
        "reapply": "refresh"
      }
    },
    "towerB": {
      "haloColor": "#6fd0ff",
      "cold": {
        "stacksToTrigger": 5,
        "duration": 5,
        "hpPerSecPct": 0.02,
        "defReduce": 0.2
      }
    },
    "towerC": {
      "haloColor": "#35e0d0",
      "stats": {
        "damage": 135
      },
      "wet": {
        "maxStacks": 5,
        "duration": 2,
        "perStackAmp": 0.04,
        "excludeElement": "water"
      }
    },
    "towerD": {
      "haloColor": "#b085f0",
      "bossSlow": 0.15,
      "stun": {
        "duration": 1,
        "cooldown": 5,
        "affectBoss": false
      }
    },
    "towerE": {
      "haloColor": "#ffe23b",
      "chain": {
        "jumps": 10,
        "jumpDecay": 0.95
      },
      "paralyze": {
        "chance": 0.5,
        "duration": 0.5,
        "maxStacks": 4,
        "stackDuration": 2.5,
        "defReducePerStack": 0.05,
        "hpPerSecPctPerStack": 0.005
      }
    },
    "towerF": {
      "haloColor": "#66e0a0",
      "aero": {
        "dmgAmp": 0.2,
        "duration": 5,
        "cooldown": 10,
        "stackable": false
      }
    }
  }
};

/* 注入 TD_CONFIG：所有塔解锁 4 级升级（maxLevel/lv4Cost/waveGate）+ 挂载 lv4 机制参数 */
(function () {
  'use strict';
  if (typeof TD_CONFIG === 'undefined' || !TD_CONFIG.towers) return;
  const v4 = window.TOWER_CONFIG_V4;
  const toNum = (c) => (typeof c === 'string' && c.charAt(0) === '#') ? parseInt(c.slice(1), 16) : c;
  for (const key of Object.keys(TD_CONFIG.towers)) {
    const towerCfg = TD_CONFIG.towers[key];
    if (!towerCfg || !towerCfg.upgrade) continue;
    towerCfg.upgrade.maxLevel = v4.upgrade4.maxLevel;
    towerCfg.upgrade.lv4Cost = v4.upgrade4.cost;
    towerCfg.upgrade.waveGate = v4.upgrade4.waveGate;
    const def = v4.towers[key];
    if (def) {
      const lv4 = Object.assign({}, def);
      if (lv4.haloColor != null) lv4.haloColor = toNum(lv4.haloColor);
      towerCfg.lv4 = lv4;
    }
  }
})();
