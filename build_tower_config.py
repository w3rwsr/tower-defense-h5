#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_tower_config.py —— 将根目录 TowerConfig.json 同步为 js/TowerConfigData.js

背景：本项目需兼容 file:// 协议双击打开，浏览器在 file:// 下禁止 fetch/XHR
读取本地 JSON，因此运行时使用内嵌 JS 数据副本（与 FireBurnData.js 等资产
同一套约定）。修改 4 级塔数值时只改 TowerConfig.json，然后运行本脚本：

    python build_tower_config.py
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "TowerConfig.json")
DST = os.path.join(ROOT, "js", "TowerConfigData.js")

HEADER = """/* ============================================================
 * TowerConfigData.js —— 4 级塔配置运行时副本（由 TowerConfig.json 生成，勿手改）
 *
 * 为什么存在：本项目需兼容 file:// 协议双击打开（浏览器在 file:// 下
 * 禁止 fetch/XHR 读取本地 JSON），故与 FireBurnData.js 等资产一致，
 * 以内嵌 JS 数据模块作为运行时副本。
 *
 * 唯一事实来源是根目录 TowerConfig.json。修改数值后运行：
 *     python build_tower_config.py
 * ============================================================ */
"""

INJECT = '''
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
'''


def main():
    with io.open(SRC, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    body = "window.TOWER_CONFIG_V4 = " + json.dumps(cfg, ensure_ascii=False, indent=2) + ";\n"
    with io.open(DST, "w", encoding="utf-8", newline="\n") as f:
        f.write(HEADER + body + INJECT)
    print("OK: TowerConfig.json -> js/TowerConfigData.js")


if __name__ == "__main__":
    sys.exit(main())
