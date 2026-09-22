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

      /* 【障碍物转火】玩家点击障碍物后（GameScene.clickObstacle 指派），
         本塔锁定攻击该障碍物，期间完全不索敌小怪——攻击障碍物时，
         不攻击小怪（目标互斥）。障碍物被摧毁后自动恢复常规索敌。 */
      const ob = this.tower.obstacleTarget;
      if (ob) {
        if (ob.dead) {
          this.tower.obstacleTarget = null;   // 已摧毁：解除锁定，回归小怪
        } else {
          this.tower.setTarget(ob);
          const ddx = ob.x - this.tower.x, ddy = ob.y - this.tower.y;
          /* 开火口径与 GameScene.clickObstacle 完全一致：射程圈触及障碍物
             本体即可开火（reach = 射程 + 障碍物半径），保证“被指派的塔
             一定打得到”，绝不对着射程外目标空射 */
          const reach = this.tower.stats.range + (ob.radius || 0);
          const inRange = ddx * ddx + ddy * ddy <= reach * reach;
          if (inRange && this.cooldown <= 0) {
            ctx.fire(this.tower, ob);
            this.cooldown = this.tower.stats.cooldown;
          }
          return;                              // 锁定期间不索敌小怪
        }
      }

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
   * 范围吸引行为（塔D）：不发射弹道。【范围索敌】——每个脉冲窗口扫描
   * 射程内的【全部小怪】，对每一只施加【同等速率】的沿路吸引（非单体锁定、
   * 不分先后）：投影点之前的小怪向前靠近、越过投影点的小怪被向后拉，
   * 大家一起向塔的沿路投影点汇聚。
   * 每 attractInterval 毫秒触发一次吸附脉冲（建塔即开窗），脉冲持续
   * attractDuration 毫秒，脉冲间隙位移烘焙进 pathDist，小怪停在新位置继续前进。
   *
   * 目标规则：
   *   - 射程：欧氏距离 ≤ tower.stats.range（升级 range 即扩大吸引范围）；
   *   - targetFilter='nonBoss'：仅小怪（cfg.boss 非真，如 enemyX/enemyY）
   *     生效，BOSS 免疫吸引；其他/缺省值 = 全部敌人生效；
   *   - 开窗瞬间若存在 ≥1 个有效目标，回调 ctx.pullPulse(tower, range,
   *     targets) 播放一次多目标攻击动画（GameScene.playPullPulse），
   *     炮头转向距塔最近的被吸目标；无目标时炮头保持原方向。
   *
   * 位移铁律：吸引【只沿道路方向、双向汇聚】，绝不产生横向/垂直分量：
   *   1. 取敌人当前所在路径段，求塔在该段上的投影点（沿路里程 footDist）；
   *   2. 带符号位移 back = pathDist - footDist：>0 已越过投影点→向塔回拉，
   *      <0 还在投影点之前→向塔拉近，=0 已在塔正对位置；统一限幅
   *      clamp(back, -maxDisplace, +maxDisplace)，远近小怪都能明显靠近；
   *   3. 写入【带符号】的 enemy.pullBack（正=向后、负=向前），Enemy 渲染点取
   *      pathPointAt(pathDist - pullBack) —— 该点【数学上恒在路径上】，
   *      拐弯处也不会切出道路；窗口结束 Enemy 把 pullBack 烘焙进 pathDist
   *      （pathDist' = pathDist - pullBack），小怪【停在吸附结束的位置继续
   *      沿路前进，不弹回、不跳变】，不卡、不脱轨；
   *   4. 每只小怪用同一收敛系数 k=1-exp(-pullStrength·dt)，吸引力度一致。
   * 被显著吸引（|pullBack|>16）的敌人推进减速（Enemy.update 内判定）→ 真控场。
   */
  class PullBehavior {
    constructor(tower, cfg) {
      this.tower = tower;
      this.cfg = cfg;
      this.eff = cfg.effect;
      this.interval = (this.eff.attractInterval != null ? this.eff.attractInterval : 2000) / 1000;
      this.duration = (this.eff.attractDuration != null ? this.eff.attractDuration : 500) / 1000;
      this.timer = this.interval; // 初始即满：2 秒后第二次脉冲
      this.active = this.duration; // 首次脉冲开窗：建塔即生效，不用干等 2 秒
      this.primed = false;         // 首帧把开窗状态补记为一次脉冲（首窗也有动画）
      this.targets = [];           // 本帧实际被吸的小怪集合（范围目标，供动画/自查）
      this.pulseCount = 0;         // 已触发的攻击脉冲数（有目标才计数，供自查）
      this.smallOnly = this.eff.targetFilter === 'nonBoss';
    }

    /** 按沿路里程找当前路径段（取敌人所属路线的 segments，多路线关卡每敌独立） */
  segmentAt(scene, dist, routeId) {
    const rg = scene.routeGeoms[routeId || 0] || scene.routeGeoms[0];
    const segs = rg.segments;
    for (let i = 0; i < segs.length; i++) {
      if (dist <= segs[i].start + segs[i].len) return segs[i];
    }
    return segs[segs.length - 1];
  }

    update(dt, ctx) {
      /* ---- 脉冲计时：每 interval 秒开窗一次，窗内持续 duration 秒 ---- */
      this.timer -= dt;
      if (this.active > 0) this.active -= dt;
      let windowJustOpened = false;
      if (!this.primed) {
        /* 构造时已开首个窗口（建塔即生效），首帧补记一次开窗事件 */
        this.primed = true;
        windowJustOpened = true;
      }
      if (this.timer <= 0) {
        this.timer += this.interval;
        this.active = this.duration;
        windowJustOpened = true;
      }

      this.targets = [];

      /* 脉冲间隙：不索敌不标记，Enemy.update 在首帧把 pullBack 位移烘焙进
         pathDist（停在吸附结束位置继续前进，不弹回）；炮头保持上一次朝向 */
      if (this.active <= 0) return;

      const t = this.tower;
      const scene = t.scene;
      const range = t.stats.range;
      const r2 = range * range;
      const strength = this.eff.pullStrength;
      const maxD = this.eff.maxDisplace;
      const k = 1 - Math.exp(-strength * dt); // 帧率无关 lerp 系数

      /* 范围索敌：遍历全场敌人，射程内的所有小怪【逐个】施加同速率沿路吸引，
         不分先后、不挑第一个——每只怪独立向自己路段上的塔投影点汇聚。
         primary = 距塔最近的被吸目标，用于炮头朝向（多目标时的视觉锚点）。 */
      let primary = null;
      let primaryD2 = Infinity;

      for (let i = 0; i < ctx.enemies.length; i++) {
        const e = ctx.enemies[i];
        if (e.dead) continue;
        /* 小怪过滤：nonBoss 模式下 BOSS（cfg.boss===true）免疫吸引 */
        if (this.smallOnly && e.cfg && e.cfg.boss) continue;

        const dx = e.x - t.x;
        const dy = e.y - t.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue; // 射程外：不标记，Enemy 首帧烘焙位移后继续前进

        /* 塔在敌人当前路段上的投影（钳在路段内），换算为沿路里程 */
        const seg = this.segmentAt(scene, e.pathDist, e.routeId);
        const inv = 1 / seg.len;
        let f = ((t.x - seg.x1) * (seg.x2 - seg.x1) + (t.y - seg.y1) * (seg.y2 - seg.y1)) * inv * inv;
        f = f < 0 ? 0 : (f > 1 ? 1 : f);
        const footDist = seg.start + f * seg.len;

        /* 沿路双向吸引（带符号，永无横向分量）：
           back>0 已越过投影点→pullBack 正向塔回拉；
           back<0 还在投影点之前→pullBack 负向塔拉近；back=0 正对塔不动。
           对称限幅 ±maxD，同一收敛系数 k —— 范围内每只小怪力度一致。 */
        const back = e.pathDist - footDist;
        const target = back > maxD ? maxD : (back < -maxD ? -maxD : back);
        e.pullBack += (target - (e.pullBack || 0)) * k;
        e.pullFresh = true;

        this.targets.push(e);
        if (d2 < primaryD2) { primaryD2 = d2; primary = e; }
      }

      /* 炮头朝向最近的被吸小怪；本帧无目标时保持上一次方向 */
      t.setTarget(primary);

      /* 开窗瞬间且至少锁定 1 个小怪：播放一次多目标攻击动画（每 2 秒一次） */
      if (windowJustOpened && this.targets.length > 0 && typeof ctx.pullPulse === 'function') {
        ctx.pullPulse(t, range, this.targets);
        this.pulseCount++;
      }
    }
  }

  /* ============================================================
   * 电链弹跳行为（塔E）：射出一道电链，在小怪间弹跳。
   * 规则（全部 JSON 驱动，见 config.towers.towerE.effect）：
   *   - 索敌：射程内走得最远的敌人作为电链起点（targeting='furthest'）；
   *   - 弹跳次数 = tower.stats.jumps（1 级 3 跳，每升 1 级 +1）；
   *   - 每次弹跳只选【尚未被本次电链击中过】的目标，不重复弹同一只怪；
   *   - 优先选距当前目标最近、且未被击中过的小怪（chainRange 范围内）；
   *   - 每次弹跳伤害递减 10%（×jumpDecay=0.90）；
   *   - 视觉：折线闪电连线 + 被击中怪短暂高亮，持续 visualDuration 秒。
   * 障碍物转火：与 AttackBehavior 一致（reach = 射程 + 半径）。
   * ============================================================ */
  class ChainBehavior {
    constructor(tower, cfg) {
      this.tower = tower;
      this.cfg = cfg;
      this.eff = cfg.effect || {};
      this.strategyName = cfg.targeting || 'furthest';
      this.cooldown = 0; // 出生即可攻击
    }

    update(dt, ctx) {
      if (this.cooldown > 0) this.cooldown -= dt;

      /* 【障碍物转火】与 AttackBehavior 完全一致：锁定期间不索敌小怪 */
      const ob = this.tower.obstacleTarget;
      if (ob) {
        if (ob.dead) {
          this.tower.obstacleTarget = null;
        } else {
          this.tower.setTarget(ob);
          const ddx = ob.x - this.tower.x, ddy = ob.y - this.tower.y;
          const reach = this.tower.stats.range + (ob.radius || 0);
          if (ddx * ddx + ddy * ddy <= reach * reach && this.cooldown <= 0) {
            ctx.fire(this.tower, ob);
            this.cooldown = this.tower.stats.cooldown;
          }
          return;
        }
      }

      /* 索敌：选射程内走得最远的敌人作为电链起点 */
      const strategy = Targeting[this.strategyName] || Targeting.furthest;
      const target = strategy(this.tower, ctx.enemies);
      this.tower.setTarget(target);

      if (!target || this.cooldown > 0) return;

      /* ---- 电链弹跳 ---- */
      const jumps = this.tower.stats.jumps || 0;
      const decay = this.eff.jumpDecay != null ? this.eff.jumpDecay : 0.90;
      const chainRange = this.eff.chainRange || 130;
      const visualDuration = this.eff.visualDuration || 0.25;
      const baseDmg = this.tower.stats.damage;

      /* 本次电链已击中的敌人集合（绝不重复弹同一只怪） */
      const hit = new Set();
      /* 电链路径点：起点 = 塔头，后续 = 每个被击中怪的位置 */
      const chainPoints = [{ x: this.tower.x, y: this.tower.y - 4 }];
      let current = target;
      let dmg = baseDmg;

      /* 循环 jumps 次（弹跳次数）：i=0 为初始击中，i=jumps 为最后一跳 */
      for (let i = 0; i <= jumps; i++) {
        hit.add(current);
        /* 造成伤害（鸭子类型：小怪 / 障碍物通用 takeDamage） */
        if (!current.dead) current.takeDamage(Math.round(dmg));
        chainPoints.push({ x: current.x, y: current.y });

        /* 最后一次后不再搜索下一目标 */
        if (i === jumps) break;

        /* 找最近的未被击中过的敌人，在 chainRange 内 */
        let next = null;
        let bestD2 = chainRange * chainRange;
        for (const e of ctx.enemies) {
          if (e.dead || hit.has(e)) continue;
          const dx = e.x - current.x, dy = e.y - current.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) { bestD2 = d2; next = e; }
        }
        if (!next) break; // 没有可弹跳的目标，电链提前结束
        current = next;
        dmg *= decay; // 每跳伤害递减 10%
      }

      /* 闪电视觉：折线闪电连线 + 被击中怪短暂高亮 */
      if (typeof ctx.spawnChainFx === 'function') {
        ctx.spawnChainFx(chainPoints, this.tower.cfg.color, visualDuration);
      }

      this.cooldown = this.tower.stats.cooldown;
    }
  }

  /* 对外接口 */
  window.TDAttack = { AttackBehavior, PullBehavior, ChainBehavior, Targeting };
})();
