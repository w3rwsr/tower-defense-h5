/* ============================================================
 * storage.js —— 关卡进度 / 塔解锁状态存取（localStorage）
 * 仅依赖浏览器原生 API，与 Phaser 解耦。
 * 数据结构：{ completed: [1, 2, ...], unlockedTowers: ['towerD', ...] }
 *   completed：玩家已通关的关卡编号数组
 *   unlockedTowers：已永久解锁的塔类型 key（通关对应关卡时自动写入）
 *   关卡解锁：第 1 关恒开放；第 N 关需第 N-1 关已通关（isUnlocked）
 *   塔解锁：读 TD_CONFIG.towers[key].unlock.unlockLevel（缺省默认可用）；
 *           塔D = 通关第 1 关后解锁，第 2 关及之后关卡可选用。
 *           旧存档无 unlockedTowers 字段时，按 completed 进度推导，
 *           下次通关时补写，保证老玩家进度不丢失。
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
        if (!Array.isArray(data.unlockedTowers)) data.unlockedTowers = [];
        return data;
      } catch (e) {
        return { completed: [], unlockedTowers: [] };
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
      /* 通关即同步塔解锁：如通关第 1 关 → 塔D 解锁记录落盘 */
      this.refreshTowerUnlocks();
    },

    /** 某关是否可进入：第 1 关恒开放；第 N 关需第 N-1 关已通关 */
    isUnlocked(level) {
      if (level < 1 || level > TOTAL_LEVELS) return false;
      if (level === 1) return true;
      return this.isCompleted(level - 1);
    },

    /* ---------------- 塔解锁 ---------------- */

    /** 读取某塔的解锁关卡要求；无 unlock 配置 = 默认解锁（返回 0） */
    towerUnlockLevel(typeKey) {
      const cfg = window.TD_CONFIG && TD_CONFIG.towers ? TD_CONFIG.towers[typeKey] : null;
      return cfg && cfg.unlock ? (cfg.unlock.unlockLevel || 0) : 0;
    },

    /**
     * 某塔在指定关卡中是否可选用。
     * @param typeKey 塔类型（towerA/B/C/D）
     * @param levelId 当前进行中的关卡编号
     * 规则：无解锁要求 → 恒可用；
     *       当前关卡 < 解锁关卡（如第 1 关用塔D）→ 锁定；
     *       否则要求已永久解锁（unlockedTowers 记录），
     *       旧档无记录时回退按「解锁关卡的前一关已通关」推导。
     */
    isTowerUnlocked(typeKey, levelId) {
      const need = this.towerUnlockLevel(typeKey);
      if (!need) return true;
      if (levelId != null && levelId < need) return false;
      const data = this.load();
      if (data.unlockedTowers.indexOf(typeKey) !== -1) return true;
      return this.isCompleted(need - 1);
    },

    /** 永久解锁一座塔（写 localStorage），已解锁时幂等无操作 */
    markTowerUnlocked(typeKey) {
      const data = this.load();
      if (data.unlockedTowers.indexOf(typeKey) === -1) {
        data.unlockedTowers.push(typeKey);
        this.save(data);
      }
    },

    /**
     * 按关卡进度同步全部塔的解锁记录（通关后由 markCompleted 自动调用）。
     * 凡配置了 unlock.unlockLevel 且其前一关已通关的塔，写入 unlockedTowers。
     */
    refreshTowerUnlocks() {
      const towers = window.TD_CONFIG && TD_CONFIG.towers ? TD_CONFIG.towers : {};
      let changed = false;
      const data = this.load();
      Object.keys(towers).forEach((key) => {
        const need = towers[key].unlock ? towers[key].unlock.unlockLevel : 0;
        if (need && this.isCompleted(need - 1) && data.unlockedTowers.indexOf(key) === -1) {
          data.unlockedTowers.push(key);
          changed = true;
        }
      });
      if (changed) this.save(data);
    },

    /** 重置全部进度（调试用） */
    reset() {
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };

  window.TDStorage = storage;
})();
