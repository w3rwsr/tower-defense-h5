/* ============================================================
 * storage.js —— 关卡进度存取（localStorage）
 * 仅依赖浏览器原生 API，与 Phaser 解耦。
 * 数据结构：{ completed: [1, 2, ...] }
 *   completed：玩家已通关的关卡编号数组
 *   解锁规则：当前版本仅第 1 关可玩（isUnlocked 统一判断），
 *             其余关卡点击时提示"暂未开放"。
 * ============================================================ */
(function () {
  'use strict';

  const KEY = 'td_levels_progress_v1';
  const TOTAL_LEVELS = 5;

  const storage = {
    /** 当前版本开放的最大关卡编号（需求：仅第1关可进入） */
    get maxUnlocked() { return 1; },

    get total() { return TOTAL_LEVELS; },

    load() {
      try {
        const raw = localStorage.getItem(KEY);
        const data = raw ? JSON.parse(raw) : {};
        if (!Array.isArray(data.completed)) data.completed = [];
        return data;
      } catch (e) {
        return { completed: [] };
      }
    },

    save(data) {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (e) {
        /* 隐私模式 / 配额满时静默失败，不影响游戏 */
      }
    },

    isCompleted(level) {
      return this.load().completed.indexOf(level) !== -1;
    },

    markCompleted(level) {
      const data = this.load();
      if (data.completed.indexOf(level) === -1) {
        data.completed.push(level);
        this.save(data);
      }
    },

    /** 某关是否可进入（只有开放范围内的关才能进） */
    isUnlocked(level) {
      return level >= 1 && level <= this.maxUnlocked;
    },

    /** 重置全部进度（调试用） */
    reset() {
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };

  window.TDStorage = storage;
})();
