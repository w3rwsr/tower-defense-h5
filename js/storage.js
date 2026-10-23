/* ============================================================
 * storage.js —— 关卡进度 / 塔解锁状态存取（localStorage）
 * 仅依赖浏览器原生 API，与 Phaser 解耦。
 * 数据结构：{ completed: [1, 2, ...], unlockedTowers: ['towerD', ...] }
 *   completed：玩家已通关的关卡编号数组
 *   unlockedTowers：已永久解锁的塔类型 key（通关对应关卡时自动写入）
 *   关卡解锁：第 1~9 关全部已设计关卡一律开放，可自由进入（isUnlocked），
 *           不依赖任何前置通关条件；通关进度仅作记录与塔解锁依据
 *   塔解锁：读 TD_CONFIG.towers[key].unlock.unlockLevel（缺省默认可用）；
 *           塔D = 通关第 1 关后解锁，第 2 关及之后关卡可选用。
 *           旧存档无 unlockedTowers 字段时，按 completed 进度推导，
 *           下次通关时补写，保证老玩家进度不丢失。
 * ============================================================ */
(function () {
  'use strict';

  const KEY = 'td_levels_progress_v1';
  /* 第 10 关无尽模式：存档与历史最高波次（见文件末尾 saveEndlessRun 等） */
  const ENDLESS_KEY = 'endless_save';
  const ENDLESS_BEST_KEY = 'endless_best';
  /* 第 10 关「解除封印」永久状态：{ towerA:true, towerE:true, ... } */
  const ENDLESS_SEAL_KEY = 'td_endless_seals_v1';
  const TOTAL_LEVELS = 10;
  /* 当前已设计完成的关卡数：第 1～10 关可游玩（第 8 关=风蚀荒原·熔岩巨兽，
     第 9 关=元素狂暴图腾·蓝色圣殿守卫，
     第 10 关=无尽蛇径·超长单线无尽模式）。第 1～10 关全部开放自由进入。 */
  const TOTAL_DESIGNED = 10;

  const storage = {
    /**
     * 调试总开关（纯内存，默认 false，绝不写入 localStorage）。
     * 仅 URL 带 #dbg 时由 debugTools.js 置 true：开启后所有关卡 / 塔 /
     * 特殊解锁条件一律放行，供开发调试直接访问全部内容；
     * 不改变存档数据结构（completed / unlockedTowers）与正式业务逻辑。
     */
    __debugAllUnlocked: false,

    /** 已通关的最大关卡编号（进度记录，仅用于展示/塔解锁，不再限制进关） */
    get maxUnlocked() {
      if (this.__debugAllUnlocked) return TOTAL_LEVELS;
      let n = 1;
      while (n < TOTAL_LEVELS && this.isCompleted(n)) n++;
      return n;
    },

    get total() { return TOTAL_LEVELS; },

    /** 当前已设计完成并可游玩的最大关卡编号（第 7 关为当前最终关） */
    get designed() { return TOTAL_DESIGNED; },

    /** 某关是否已设计完成（可游玩）；超出设计范围的关卡不可进入 */
    isDesigned(level) {
      return level >= 1 && level <= TOTAL_DESIGNED;
    },

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

    /** 某关是否可进入：第 1~9 关（全部已设计关卡）一律开放，可自由进入，
     *  不依赖任何前置通关条件（第 9 关也已解除"需通关第 8 关"的限制）；
     *  未设计关卡恒不可进入（敬请期待）。
     *  通关进度 completed 仍正常记录并用于塔解锁。 */
    isUnlocked(level) {
      if (level < 1 || level > TOTAL_LEVELS) return false;
      if (this.__debugAllUnlocked) return true; // 调试态：全关卡放行（不落盘）
      if (level > TOTAL_DESIGNED) return false; // 未设计关卡：敬请期待，不可进入
      return true; // 已设计关卡（第 1~9 关）全部开放
    },

    /* ---------------- 塔解锁 ---------------- */

    /** 读取某塔的解锁关卡要求；无 unlock 配置 = 默认解锁（返回 0） */
    towerUnlockLevel(typeKey) {
      const cfg = window.TD_CONFIG && TD_CONFIG.towers ? TD_CONFIG.towers[typeKey] : null;
      return cfg && cfg.unlock ? (cfg.unlock.unlockLevel || 0) : 0;
    },

    /** 某关是否声明「全部塔可选」：读关卡配置 levelCfg.allTowersAvailable。
     *  目前仅第 7 关「双途重围」开启（BOSS 元素/血量护盾需多元素协同），
     *  该关不再要求「历史通关记录」，只要关卡编号 ≥ 塔解锁关卡即可选用。 */
    levelAllowsAllTowers(levelId) {
      const lv = (window.TD_CONFIG && TD_CONFIG.levels) ? TD_CONFIG.levels[levelId] : null;
      return !!(lv && lv.allTowersAvailable === true);
    },

    /**
     * 某塔在指定关卡中是否可选用。
     * @param typeKey 塔类型（towerA/B/C/D）
     * @param levelId 当前进行中的关卡编号
     * 规则：无解锁要求 → 恒可用；
     *       当前关卡 < 解锁关卡（如第 1 关用塔D）→ 锁定；
     *       关卡声明 allTowersAvailable（第 7 关）→ 只看关卡编号够不够，
     *       不要求永久解锁记录（关卡已自由进入，避免「跳过前面关卡就无塔可用」）；
     *       否则要求已永久解锁（unlockedTowers 记录），
     *       旧档无记录时回退按「解锁关卡的前一关已通关」推导。
     */
    isTowerUnlocked(typeKey, levelId) {
      if (this.__debugAllUnlocked) return true; // 调试态：全部塔放行（含第1关用塔D）
      const need = this.towerUnlockLevel(typeKey);
      if (!need) return true;
      if (this.levelAllowsAllTowers(levelId)) return levelId == null || levelId >= need;
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
    },

    /* ============================================================
     * 第 10 关无尽模式存档（核心原则：只存塔，不存怪）
     *   endless_save = { v:1, level:10, wave, lives, gold,
     *                    towers:[{x,y,t,l}], best, ts }
     *   —— 绝不保存场上怪物的位置/状态/血量：后期怪物成百上千，
     *      序列化会让存档膨胀到数 MB 并卡死主线程。
     *   endless_best = 历史最高波次（跨局保留，失败也不清零）
     * ============================================================ */
    saveEndlessRun(data) {
      try {
        localStorage.setItem(ENDLESS_KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        /* 配额超限/隐私模式：静默失败，不影响游戏 */
        return false;
      }
    },

    /** 读取无尽存档；结构不合法（版本不符/字段缺失）时视为无档 */
    loadEndlessSave() {
      try {
        const raw = localStorage.getItem(ENDLESS_KEY);
        if (!raw) return null;
        const d = JSON.parse(raw);
        if (!d || d.v !== 1 || !Array.isArray(d.towers)) return null;
        if (!(d.wave >= 1)) return null;
        return d;
      } catch (e) {
        return null;
      }
    },

    /** 清档（失败结算 / 选择重新开始时调用） */
    clearEndlessSave() {
      try { localStorage.removeItem(ENDLESS_KEY); } catch (e) {}
    },

    /** 历史最高无尽波次 */
    getEndlessBest() {
      try {
        const n = parseInt(localStorage.getItem(ENDLESS_BEST_KEY) || '0', 10);
        return n > 0 ? n : 0;
      } catch (e) {
        return 0;
      }
    },

    /** 上报本局波次，刷新最高记录并返回最新值 */
    recordEndlessBest(wave) {
      const w = parseInt(wave, 10) || 0;
      const cur = this.getEndlessBest();
      if (w > cur) {
        try { localStorage.setItem(ENDLESS_BEST_KEY, String(w)); } catch (e) {}
        return w;
      }
      return cur;
    },

    /* ---------------- 第 10 关「解除封印」永久状态 ---------------- */

    /** 读取全部封印状态；损坏/无档返回空对象（不抛异常） */
    loadEndlessSeals() {
      try {
        const raw = localStorage.getItem(ENDLESS_SEAL_KEY);
        const d = raw ? JSON.parse(raw) : null;
        if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
        const out = {};
        ['towerA', 'towerB', 'towerC', 'towerD', 'towerE', 'towerF',
          'towerA2', 'towerB2', 'towerC2', 'towerD2', 'towerE2', 'towerF2',
          'globalBulletSpeed'].forEach((k) => {
          if (d[k] === true) out[k] = true;
        });
        return out;
      } catch (e) {
        return {};
      }
    },

    /** 某塔是否已永久解封 */
    isEndlessSealUnlocked(typeKey) {
      return this.loadEndlessSeals()[typeKey] === true;
    },

    /** 永久解封某塔（幂等写入，失败静默） */
    unlockEndlessSeal(typeKey) {
      if (!typeKey) return false;
      const d = this.loadEndlessSeals();
      if (d[typeKey] === true) return true;
      d[typeKey] = true;
      try { localStorage.setItem(ENDLESS_SEAL_KEY, JSON.stringify(d)); } catch (e) {}
      return true;
    }
  };

  window.TDStorage = storage;
})();
