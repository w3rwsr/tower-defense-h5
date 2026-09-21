/* ============================================================
 * attackModule.js —— 塔攻击逻辑独立模块
 *
 * 职责（固定三步循环）：索敌 → 攻击 → 冷却
 * 该模块不关心贴图、不直接操作场景，方便以后加新塔 / 新索敌规则：
 *   1) 在 Targeting 里注册新的索敌函数；
 *   2) 或在 config.towers.xxx.targeting 中按名字引用；
 *   3) 弹道命中效果（单体/范围减速）由 Projectile + GameScene 处理。
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 索敌策略表 ----------------
   * 每个策略签名：(tower, enemies) => enemy | null
   * tower 需提供：x, y, stats.range
   * enemy 需提供：x, y, pathDist, dead（死亡后不可被选中） */
  const Targeting = {

    /* 最接近终点：射程内 pathDist 最大者，防止漏怪 */
    furthest(tower, enemies) {
      let best = null;
      let bestDist = -Infinity;
      const r2 = tower.stats.range * tower.stats.range;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const dx = e.x - tower.x;
        const dy = e.y - tower.y;
        if (dx * dx + dy * dy <= r2 && e.pathDist > bestDist) {
          best = e;
          bestDist = e.pathDist;
        }
      }
      return best;
    },

    /* 距离塔最近（备用策略，新塔可直接在 JSON 里引用 "nearest"） */
    nearest(tower, enemies) {
      let best = null;
      let bestD2 = Infinity;
      const r2 = tower.stats.range * tower.stats.range;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const dx = e.x - tower.x;
        const dy = e.y - tower.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2 && d2 < bestD2) {
          best = e;
          bestD2 = d2;
        }
      }
      return best;
    },

    /* 血量最低（备用策略，留给后续“斩首型”新塔） */
    weakest(tower, enemies) {
      let best = null;
      const r2 = tower.stats.range * tower.stats.range;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.dead) continue;
        const dx = e.x - tower.x;
        const dy = e.y - tower.y;
        if (dx * dx + dy * dy <= r2 && (!best || e.hp < best.hp)) best = e;
      }
      return best;
    }
  };

  /**
   * 攻击行为：每帧由 Tower 调用 update
   * @param {object} tower   塔实例（提供 x/y/stats 与 setTarget）
   * @param {object} cfg     config.towers.xxx 中的塔配置
   */
  class AttackBehavior {
    constructor(tower, cfg) {
      this.tower = tower;
      this.cfg = cfg;
      this.strategyName = cfg.targeting || 'furthest';
      this.cooldown = 0; // 出生即可攻击
    }

    /**
     * @param {number} dt  帧间隔（秒，已含暂停/倍速处理）
     * @param {object} ctx { enemies: 敌人数组, fire(tower, target): 开火回调 }
     */
    update(dt, ctx) {
      // 1) 冷却计时（倍速与暂停由场景统一换算进 dt）
      if (this.cooldown > 0) this.cooldown -= dt;

      // 2) 索敌
      const strategy = Targeting[this.strategyName] || Targeting.furthest;
      const target = strategy(this.tower, ctx.enemies);

      // 炮口始终朝向当前目标（无目标时保持上一次方向）
      this.tower.setTarget(target);

      // 3) 攻击：有目标且冷却结束 → 开火并重置冷却
      if (target && this.cooldown <= 0) {
        ctx.fire(this.tower, target);
        this.cooldown = this.tower.stats.cooldown;
      }
    }
  }

  /**
   * 范围吸引行为（塔D）：不发射弹道，每帧把射程内敌人向塔方向位移。
   * 直接修改 enemy.pullDX/pullDY（位移场），由 Enemy.update 合成最终坐标：
   *   pos = pathPointAt(pathDist) + (pullDX, pullDY)
   * - 目标位移 = clamp(塔坐标 - 路径基点, maxDisplace)，使敌人被拉向塔但
   *   不堆叠到塔心；lerp 收敛速率 = pullStrength（越大拉拢越快）。
   * - 被显著位移（|D|>16）的敌人推进减速（Enemy.update 内判定）→ 真控场。
   * - 射程随塔等级提升（读 tower.stats.range），升级即扩大吸引范围。
   */
  class PullBehavior {
    constructor(tower, cfg) {
      this.tower = tower;
      this.cfg = cfg;
      this.eff = cfg.effect;
    }

    update(dt, ctx) {
      const t = this.tower;
      const range = t.stats.range;
      const r2 = range * range;
      const strength = this.eff.pullStrength;
      const maxD = this.eff.maxDisplace;
      const k = 1 - Math.exp(-strength * dt); // 帧率无关 lerp 系数

      for (let i = 0; i < ctx.enemies.length; i++) {
        const e = ctx.enemies[i];
        if (e.dead) continue;
        const dx = e.x - t.x;
        const dy = e.y - t.y;
        if (dx * dx + dy * dy > r2) continue; // 射程外：不标记 pullFresh，Enemy 自行衰减归位
        // 反推路径基点（渲染坐标 - 当前位移），目标位移 = 朝塔方向、限幅 maxD
        const bx = e.x - e.pullDX;
        const by = e.y - e.pullDY;
        let tx = t.x - bx;
        let ty = t.y - by;
        const td = Math.hypot(tx, ty);
        if (td > maxD) { tx = tx / td * maxD; ty = ty / td * maxD; }
        e.pullDX += (tx - e.pullDX) * k;
        e.pullDY += (ty - e.pullDY) * k;
        e.pullFresh = true;
      }
    }
  }

  /* 对外接口 */
  window.TDAttack = { AttackBehavior, PullBehavior, Targeting };
})();
