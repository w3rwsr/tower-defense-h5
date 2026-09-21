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
    /** 当前版本开放的最大关卡编号（第 2 关通关第 1 关后解锁，以此类推） */
    get maxUnlocked() {
      let n = 1;
      while (n < TOTAL_LEVELS && this.isCompleted(n)) n++;
      return n;
    },

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

    /** 某关是否可进入：第 1 关恒开放；第 N 关需第 N-1 关已通关 */
    isUnlocked(level) {
      if (level < 1 || level > TOTAL_LEVELS) return false;
      if (level === 1) return true;
      return this.isCompleted(level - 1);
    },

    /** 重置全部进度（调试用） */
    reset() {
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };

  window.TDStorage = storage;
})();
