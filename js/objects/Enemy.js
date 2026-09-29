/* ============================================================
 * Enemy.js —— 敌人（敌人X：低血快速 / 敌人Y：高血慢速）
 * 沿 GameScene 预计算的路径移动，支持减速 debuff 与血条。
 * ============================================================ */
class Enemy extends Phaser.GameObjects.Container {
  constructor(scene, typeKey, routeId) {
    const cfg = TD_CONFIG.enemies[typeKey];
    const rid = routeId || 0;   // 所属路线（多路线关卡：0=上路 / 1=下路），缺省 0
    const p = scene.pathPointAt(0, rid);
    super(scene, p.x, p.y);
    this.routeId = rid;

    this.typeKey = typeKey;
    this.cfg = cfg;
    this.radius = cfg.radius;

    /* ---- 数值（全部来自 JSON） ---- */
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.baseSpeed = cfg.speed;
    /* 小怪击杀金币 = 基础 reward + economy.killRewardBonus + 关卡调整值；
       关卡调整值 killRewardAdjust 可正（奖励）可负（惩罚，旧字段 killRewardPenalty 仍兼容）；
       BOSS 不享受任何加成/调整；最低保 0 */
    const killBonus = (!cfg.boss && TD_CONFIG.economy.killRewardBonus) || 0;
    const adjust = (!cfg.boss && (scene.levelCfg.killRewardAdjust != null
      ? scene.levelCfg.killRewardAdjust
      : -(scene.levelCfg.killRewardPenalty || 0))) || 0;
    this.reward = Math.max(0, cfg.reward + killBonus + adjust);
    this.leakDamage = cfg.leakDamage;

    /* 伤害减免（0=无减免）：末波小怪可配 finalWaveDmgReduction，
       受击实际伤害 = 原伤害 × (1 - dmgReduction) */
    this.dmgReduction = 0;

    /* ---- 路径状态 ---- */
    this.pathDist = 0;
    this.dead = false;     // 已死亡（索敌忽略）
    this.removed = false;  // 已从场景移除（数组过滤用）
    this.leaked = false;   // 到达终点

    /* ---- 传送门（第 4 关） ---- */
    this.invulnTimer = 0;    // 传送后无敌/不可选中剩余秒数（期间索敌与伤害均跳过）
    this.usedPortals = null; // 已对本怪生效的传送规则 key 集合（每门每怪仅一次，防循环）

    /* ---- 减速状态 ---- */
    this.slowTimer = 0;
    this.slowFactor = 1;

    /* ---- 元素印记（火/冰/雷/水，供风元素塔扩散） ----
       纯视觉标记：头顶小光点（elementMark），颜色取 TD_CONFIG.elements。
       规则：已有印记时新印记不覆盖（保留原有）；冰印记与减速同生同灭
       （applySlow 内同步）；到期自动消散。 */
    this.element = null;        // 'fire' | 'ice' | 'thunder' | 'water' | null
    this.elementTimer = 0;      // 印记剩余秒数
    this.elementMark = null;    // 印记光点 Graphics
    this.elementMarkTween = null;

    /* ---- 三阶段 BOSS（第 5 关，JSON 驱动） ---- */
    this.bossPhase = 0;       // 0=普通怪/无阶段；1=一阶段（阈值分裂）；2=分身；3=合体强化
    this.bossPhaseLink = 0;   // 同一次分裂的分身共享的组号（合体时机按组判定）
    this.bossPhasePool = 0;   // 本次分裂的分身总血量（合体回血基数）

    /* ---- 范围吸引（塔D）：pullBack = 沿路【带符号】的吸引位移（像素）
         正=已越过塔投影点被向回拉，负=还在塔之前被向前拉近。
         吸附【窗口内】渲染点 = pathPointAt(pathDist - pullBack)，数学上恒在
         道路上；【窗口结束/离开射程的第一帧把位移烘焙进 pathDist】：
         pathDist' = clamp(pathDist - pullBack)，pullBack 归零——渲染点坐标
         前后完全一致（无跳变、不弹回），小怪停在吸附结束的位置继续沿路前进。
         pullDX/pullDY 为渲染点相对路径基点的派生向量（供自查/判定复用）；
         pullFresh 由塔D在吸附脉冲窗口内每帧标记。 */
    this.pullBack = 0;
    this.pullDX = 0;
    this.pullDY = 0;
    this.pullFresh = false;

    /* ---- 卡通占位贴图 ---- */
    this.body = scene.add.image(0, 0, 'enemy_' + typeKey);
    this.add(this.body);

    /* ---- 血条 ---- */
    const barW = cfg.radius * 2.4;
    this.barW = barW;
    this.barBg = scene.add.graphics();
    this.barBg.setPosition(0, -cfg.radius - 10);
    this.add(this.barBg);

    this.setDepth(20);
    scene.add.existing(this);
    this.drawHpBar(1);
  }

  /* 施加减速：取更强（数值更小）的减速系数，时间刷新取较长者 */
  applySlow(factor, duration) {
    // 多种减速同时存在时：取更强（系数更小）者，持续时间刷新为较长者
    this.slowFactor = this.slowTimer > 0 ? Math.min(this.slowFactor, factor) : factor;
    this.slowTimer = Math.max(this.slowTimer, duration);
    this.body.setTint(0xbbeeff);
    /* 冰元素印记：塔B 减速即冰（风塔冰扩散共用本方法），印记与减速同生同灭；
       已有其他元素印记时不覆盖（update 中其他元素消散后若仍减速会回落为冰） */
    if (!this.element || this.elementTimer <= 0) {
      this.element = 'ice';
      this.elementTimer = duration;
      this.showElementMark('ice');
    }
  }

  /* 附加元素印记（火/冰/雷/水）：已有印记不覆盖，只保留原有元素 */
  applyElement(el, duration) {
    if (this.dead || !el) return;
    if (this.element && this.elementTimer > 0) return; // 已有元素：不覆盖
    this.element = el;
    this.elementTimer = duration;
    this.showElementMark(el);
  }

  /* 元素印记光点：头顶右上的小圆点（独立于 body tint，不与减速/吸引闪光冲突） */
  showElementMark(el) {
    this.clearElementMark();
    const conf = (TD_CONFIG.elements || {})[el];
    if (!conf || !this.scene) return;
    const g = this.scene.add.graphics();
    g.fillStyle(conf.color, 0.95).fillCircle(0, 0, 5.5);
    g.lineStyle(1.5, 0xffffff, 0.9).strokeCircle(0, 0, 5.5);
    g.setPosition(this.radius * 0.85, -this.radius - 6);
    this.add(g);
    this.elementMark = g;
    /* 轻微脉动，提示“身上有元素” */
    this.elementMarkTween = this.scene.tweens.add({
      targets: g, scale: 1.3, duration: 350, yoyo: true, repeat: -1
    });
  }

  clearElementMark() {
    if (this.elementMarkTween) {
      try { this.elementMarkTween.stop(); } catch (_) {}
      this.elementMarkTween = null;
    }
    if (this.elementMark) {
      try { this.elementMark.destroy(); } catch (_) {}
      this.elementMark = null;
    }
  }

  takeDamage(value) {
    /* 传送后 0.5s 无敌：伤害与索敌均跳过（含单体/溅射/电链） */
    if (this.dead || this.invulnTimer > 0) return;
    /* 伤害减免：dmgReduction > 0 时受击实际伤害 = 原伤害 × (1 - 减免) */
    const dmg = value * (1 - (this.dmgReduction || 0));
    this.hp -= dmg;
    this.drawHpBar(Math.max(0, this.hp / this.maxHp));
    /* 三阶段 BOSS（第 5 关，JSON 驱动）：一阶段血量降到阈值即分裂成 3 分身；
       分裂优先于死亡判定（一击打穿阈值也走分裂），无 bossPhases 配置的
       关卡 bossPhase 恒为 0，此检查零影响 */
    if (!this.dead && this.bossPhase === 1 && this.scene.checkBossSplit(this)) return;
    if (this.hp <= 0) this.scene.onEnemyKilled(this);
  }

  update(dt) {
    if (this.dead) return;

    /* 传送后无敌计时：期间本体半透明提示，结束恢复不透明 */
    if (this.invulnTimer > 0) {
      this.invulnTimer -= dt;
      if (this.invulnTimer <= 0) {
        this.invulnTimer = 0;
        this.body.setAlpha(1);
      }
    }

    /* 减速计时 */
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) {
        this.slowTimer = 0;
        this.slowFactor = 1;
        this.body.clearTint();
      }
    }

    /* 元素印记计时：冰印记与减速同生同灭（跟随 slowTimer）；
       其他元素到期消散，消散后若仍在减速则回落为冰印记 */
    if (this.element === 'ice') {
      if (this.slowTimer > 0) {
        this.elementTimer = this.slowTimer;
      } else {
        this.element = null;
        this.elementTimer = 0;
        this.clearElementMark();
      }
    } else if (this.element && this.elementTimer > 0) {
      this.elementTimer -= dt;
      if (this.elementTimer <= 0) {
        this.elementTimer = 0;
        this.element = null;
        this.clearElementMark();
        if (this.slowTimer > 0) { // 回落为冰（减速的视觉同步）
          this.element = 'ice';
          this.elementTimer = this.slowTimer;
          this.showElementMark('ice');
        }
      }
    }

    /* 吸附窗口结束 / 离开射程的第一帧：把带符号吸引位移【烘焙】进真实进度，
       pullBack 归零。烘焙前后渲染点 pathPointAt(pathDist - pullBack) 完全重合
       ——小怪停在吸附结束的位置继续走，不弹回、不跳变；clamp 保证不越过
       起点/终点，新位置仍是路径上的点，绝不脱离道路。 */
    const wasPulled = this.pullFresh && Math.abs(this.pullBack) > 16;
    const myLen = this.scene.routeLength(this.routeId);
    if (!this.pullFresh && this.pullBack !== 0) {
      let nd = this.pathDist - this.pullBack;
      if (nd < 0) nd = 0;
      else if (nd > myLen) nd = myLen;
      this.pathDist = nd;
      this.pullBack = 0;
    }
    this.pullFresh = false;

    /* 沿路径前进；窗口内被显著吸引时（向前/向后均算）推进减速
       （真控场，避免视觉位移叠加正常推进）；烘焙后从新位置全速继续走 */
    const speedNow = this.baseSpeed * (this.slowTimer > 0 ? this.slowFactor : 1);
    const ctrlSlow = wasPulled ? 0.5 : 1;
    const distBefore = this.pathDist;
    this.pathDist += speedNow * dt * ctrlSlow;

    /* 传送门检测（第 4 关）：前进跨越入口里程即跳到出口（可能切换路线）；
       传送优先于塔D（checkPortalTeleport 内清空 pullBack）。无传送门关卡
       该方法立即返回，零开销、零影响 */
    this.scene.checkPortalTeleport(this, distBefore);
    /* 传送可能切换 routeId，终点里程按当前路线重新取 */
    const curLen = this.scene.routeLength(this.routeId);

    if (this.pathDist >= curLen) {
      this.leaked = true;
      this.dead = true;
      this.scene.onEnemyLeak(this);
      return;
    }

    /* 基点（真实进度）与渲染点（窗口内被吸引位移后的路径点）——两者都在
       路径上，从几何上保证敌人任何时刻都不会离开道路，拐弯同样成立。 */
    const p = this.scene.pathPointAt(this.pathDist, this.routeId);
    const vp = this.scene.pathPointAt(Math.max(0, this.pathDist - this.pullBack), this.routeId);
    this.pullDX = vp.x - p.x;
    this.pullDY = vp.y - p.y;
    this.setPosition(vp.x, vp.y);
    /* 让下方的敌人盖住上方的，制造一点层次 */
    this.setDepth(20 + Math.floor(p.y));
  }

  drawHpBar(ratio) {
    const g = this.barBg;
    const w = this.barW;
    const h = this.cfg.barThickness || 5;   // BOSS 更粗血条（barThickness）
    g.clear();
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-w / 2 - 1, -1, w + 2, h + 2, 3);
    if (ratio > 0) {
      /* 血量颜色：绿 → 黄 → 红 */
      const color = ratio > 0.55 ? 0x6be26b : ratio > 0.25 ? 0xffd24a : 0xff5d5d;
      g.fillStyle(color, 1);
      g.fillRoundedRect(-w / 2, 0, w * ratio, h, 2.5);
    }
  }

  /* 击杀后的弹跳消失动画，结束后由场景统一销毁 */
  playDeath() {
    this.clearElementMark();  // 印记光点随死亡清除（tween 不残留）
    this.body.setTint(0xffffff);
    this.scene.tweens.add({
      targets: this,
      scale: 1.35,
      duration: 120,
      yoyo: true,
      onComplete: () => {
        this.removed = true;
        this.destroy();
      }
    });
  }

  destroyImmediately() {
    this.clearElementMark();
    this.removed = true;
    this.destroy();
  }
}
