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

    /* ---- 元素系统 ----
       reactionsEnabled=true（第 6 关起，elementSystem.enableFromLevel 驱动）：
         多元素槽 this.elements = [{type, amount, timer, lastAttach}]，
         按【附着先后】保序，每个槽有附着量与独立持续时间；附着/反应/冰冻/
         易伤全部走新机制。
       reactionsEnabled=false（第 1~5 关）：保持旧的纯视觉单印记逻辑
         （this.element / elementTimer，已有印记不覆盖，冰印记跟随减速）。 */
    this.reactionsEnabled = !!(TD_CONFIG.elementSystem &&
      this.scene.levelId >= (TD_CONFIG.elementSystem.enableFromLevel != null
        ? TD_CONFIG.elementSystem.enableFromLevel : 6));
    this.age = 0;               // 本怪存活计时（附着限频用，随游戏 dt 累计）

    /* 旧印记模式字段（1~5 关原样保留） */
    this.element = null;        // 'fire' | 'ice' | 'thunder' | 'water' | null
    this.elementTimer = 0;      // 印记剩余秒数
    this.elementMark = null;    // 印记光点 Graphics
    this.elementMarkTween = null;

    /* 新反应模式字段 */
    this.elements = [];         // 元素槽（按附着先后排序）
    this.freezeTimer = 0;       // 冰冻剩余秒数（>0 时不可移动/不可被牵引）
    this.freezeGfx = null;      // 冰冻冰晶 Graphics
    this.vulnStacks = [];       // 易伤层：[{timer}]，每层独立倒计时（仅小怪）
    this.vulnText = null;       // 易伤层数文字
    this._vulnTween = null;

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
    /* 旧印记模式（1~5 关）：冰印记与减速同生同灭；新反应模式中冰元素是
       独立元素槽（attachElement），不再由减速自动挂印记 */
    if (!this.reactionsEnabled && (!this.element || this.elementTimer <= 0)) {
      this.element = 'ice';
      this.elementTimer = duration;
      this.showElementMark('ice');
    }
  }

  /* ============================================================
   * 元素附着 / 反应（新反应模式，全部 JSON 驱动：TD_CONFIG.elementSystem）
   * ------------------------------------------------------------
   * attachElement(type, amount, sourceEl)
   *   amount  缺省 attachAmount(2)；风塔扩散传 spreadAmount(1)
   *   sourceEl 触发方塔的元素（与本次附着元素相同）；风塔扩散传 null
   *           —— 倍率【谁先触发谁享受】：只在 sourceEl 命中反应表时
   *           返回倍率给【本次攻击】，不写任何全局状态、不影响其他塔。
   * 返回 { reactionMul, reactions }；反应结算后刷新头顶元素图标。
   * ============================================================ */
  attachElement(type, amount, sourceEl) {
    const res = { reactionMul: 1, reactions: [] };
    if (this.dead || !type) return res;

    /* 旧印记模式（1~5 关）：纯视觉单印记、不覆盖、不反应 */
    if (!this.reactionsEnabled) {
      this.applyElement(type, null);
      return res;
    }

    const sys = TD_CONFIG.elementSystem;
    const amt = amount != null ? amount : sys.attachAmount;
    let slot = null;
    for (const s of this.elements) { if (s.type === type) { slot = s; break; } }

    if (slot) {
      /* 同种元素 attachInterval(0.5s) 内只能附着一次；超时补量只刷新
         存量与持续时间（同元素补量不触发新反应） */
      if (this.age - slot.lastAttach < (sys.attachInterval != null ? sys.attachInterval : 0.5)) {
        return res;
      }
      slot.amount += amt;
      slot.timer = sys.duration;
      slot.lastAttach = this.age;
      this.refreshElementMarks();
      return res;
    }

    /* 新元素入列（天然按附着先后保序），随后立即与更早附着的元素结算 */
    slot = { type, amount: amt, timer: sys.duration, lastAttach: this.age };
    this.elements.push(slot);
    this.refreshElementMarks();

    /* 按附着先后依次反应：每轮取【最早附着】的其他槽与新元素配对，
       新元素耗尽则结束；其他槽耗尽则取下一个槽继续下一轮 */
    let guard = 0;
    while (slot.amount > 1e-6 && guard++ < 12) {
      let other = null;
      for (const s of this.elements) { if (s !== slot) { other = s; break; } }
      if (!other) break;
      const rule = this.findReactionRule(other.type, slot.type);
      if (!rule) break; // 理论上四元素两两皆可反应，此路仅作兜底

      const cA = rule.cost[other.type];
      const cB = rule.cost[slot.type];
      const u = Math.min(other.amount / cA, slot.amount / cB); // 本轮反应量
      other.amount -= u * cA;
      slot.amount -= u * cB;

      /* 倍率只归本次攻击的触发方塔，且一对附着只享受第一次反应的倍率 */
      let mult = 0;
      if (sourceEl && rule.multiplier && rule.multiplier[sourceEl] != null && res.reactionMul === 1) {
        mult = rule.multiplier[sourceEl];
        res.reactionMul = mult;
      }
      this.applyReactionEffect(rule, mult);
      res.reactions.push(rule.fx);

      if (other.amount <= 1e-6) this.elements.splice(this.elements.indexOf(other), 1);
    }
    if (slot.amount <= 1e-6) this.elements.splice(this.elements.indexOf(slot), 1);

    this.refreshElementMarks();
    return res;
  }

  /* 无向查反应表：a+b 或 b+a */
  findReactionRule(a, b) {
    const pairs = (TD_CONFIG.elementSystem || {}).pairs || {};
    return pairs[a + '+' + b] || pairs[b + '+' + a] || null;
  }

  /* 身上是否有任意元素（风刃命中判定用） */
  hasElement(type) {
    if (type) return this.elements.some((s) => s.type === type);
    return this.elements.length > 0;
  }

  /* 取风塔应扩散的元素：最早附着的那个槽（附着先后一致） */
  primaryElement() {
    return this.elements.length ? this.elements[0].type : null;
  }

  /* 反应生效：特效 + 水冰冰冻（BOSS 改为减速，不吃易伤） */
  applyReactionEffect(rule, mult) {
    if (this.scene && typeof this.scene.spawnReactionFx === 'function') {
      this.scene.spawnReactionFx(this, rule, mult);
    }
    if (rule.freeze) {
      const fz = (TD_CONFIG.elementSystem.freeze || {}).duration || 2;
      if (this.cfg && this.cfg.boss) {
        /* BOSS 免疫冰冻/易伤：水+冰改为移速降低（JSON bossSlowRatio 驱动） */
        const ratio = ((TD_CONFIG.elementSystem.vuln || {}).bossSlowRatio != null)
          ? TD_CONFIG.elementSystem.vuln.bossSlowRatio : 0.3;
        this.applySlow(Math.max(0.1, 1 - ratio), fz);
        if (this.scene && typeof this.scene.floatText === 'function') {
          this.scene.floatText(this.x, this.y - this.radius - 12, 'BOSS 减速', 0x9fd8ff);
        }
      } else {
        this.applyFreeze(fz);
      }
    }
  }

  /* 冰冻：定身，期间免疫塔D牵引 */
  applyFreeze(duration) {
    this.freezeTimer = Math.max(this.freezeTimer, duration); // 重复冰冻刷新取较长
    this.showFreezeGfx(true);
  }

  /* 塔D 牵引脉冲扫到冰冻小怪：不位移、提前破冰并挂一层易伤（仅小怪） */
  shatterFreeze() {
    if (this.freezeTimer <= 0) return false;
    this.freezeTimer = 0;
    this.showFreezeGfx(false);
    this.addVuln();
    if (this.scene && typeof this.scene.spawnShatterFx === 'function') {
      this.scene.spawnShatterFx(this.x, this.y);
    }
    return true;
  }

  /* 易伤叠层：每层独立持续 vuln.duration(5s)，最多 maxStacks(3) 层；
     满层后忽略新层（不互相刷新）；BOSS 不吃易伤 */
  addVuln() {
    if (this.cfg && this.cfg.boss) return;
    const v = (TD_CONFIG.elementSystem || {}).vuln || {};
    const max = v.maxStacks != null ? v.maxStacks : 3;
    if (this.vulnStacks.length >= max) return;
    this.vulnStacks.push({ timer: v.duration != null ? v.duration : 5 });
    this.refreshVulnView(true);
  }

  /* 旧印记模式附加元素印记（火/冰/雷/水）：已有印记不覆盖，只保留原有元素 */
  applyElement(el, duration) {
    if (this.dead || !el) return;
    if (this.element && this.elementTimer > 0) return; // 已有元素：不覆盖
    this.element = el;
    this.elementTimer = duration || 4;
    this.showElementMark(el);
  }

  /* 旧印记模式：元素印记光点（头顶右上的小圆点） */
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

  /* 新反应模式：头顶元素图标行——每元素一个圆点（按附着先后排列），
     圆点亮度随附着量变化，下方小刻度表示存量（1~4 滴） */
  refreshElementMarks() {
    if (!this.scene) return;
    if (!this.elementMark) {
      this.elementMark = this.scene.add.graphics();
      this.add(this.elementMark);
    }
    const g = this.elementMark;
    g.clear();
    const n = this.elements.length;
    if (!n) return;
    const spacing = 12;
    const y0 = -this.radius - 12;
    for (let i = 0; i < n; i++) {
      const s = this.elements[i];
      const conf = (TD_CONFIG.elements || {})[s.type] || {};
      const color = conf.color != null ? conf.color : 0xffffff;
      const x = (i - (n - 1) / 2) * spacing;
      const intensity = Math.max(0.45, Math.min(1, s.amount / 2));
      g.fillStyle(color, intensity).fillCircle(x, y0, 5.5);
      g.lineStyle(1.4, 0xffffff, 0.9).strokeCircle(x, y0, 5.5);
      /* 存量小刻度：最多 4 滴，半单位也显示一滴（ceil） */
      const pips = Math.max(1, Math.min(4, Math.ceil(s.amount)));
      for (let p = 0; p < pips; p++) {
        g.fillStyle(0xffffff, 0.85).fillCircle(x - (pips - 1) * 2.6 + p * 5.2, y0 + 8, 1.4);
      }
    }
  }

  /* 冰冻冰晶覆盖（身体冰白 tint + 头顶菱形冰晶） */
  showFreezeGfx(on) {
    if (on) {
      this.body.setTint(0xdff3ff);
      if (!this.freezeGfx && this.scene) {
        const g = this.scene.add.graphics();
        const r = this.radius;
        g.lineStyle(2.5, 0x8fd8ff, 0.95);
        g.fillStyle(0xbfe8ff, 0.55);
        g.beginPath();
        g.moveTo(0, -r - 4); g.lineTo(5, -r + 2); g.lineTo(0, -r + 8); g.lineTo(-5, -r + 2);
        g.closePath(); g.fillPath(); g.strokePath();
        g.lineStyle(2, 0xffffff, 0.8);
        g.strokeCircle(0, 0, r + 2);
        this.add(g);
        this.freezeGfx = g;
      }
    } else {
      if (this.freezeGfx) {
        try { this.freezeGfx.destroy(); } catch (_) {}
        this.freezeGfx = null;
      }
      /* 还原身体着色：减速中回落为减速蓝，否则清色 */
      if (!this.dead && this.body) {
        if (this.slowTimer > 0) this.body.setTint(0xbbeeff);
        else this.body.clearTint();
      }
    }
  }

  /* 易伤层数文字（脚下红色「裂甲×N」），bump 时短暂放大提示 */
  refreshVulnView(bump) {
    const n = this.vulnStacks.length;
    if (n <= 0) {
      if (this.vulnText) {
        try { this.vulnText.destroy(); } catch (_) {}
        this.vulnText = null;
      }
      return;
    }
    if (!this.vulnText && this.scene) {
      this.vulnText = this.scene.add.text(0, this.radius + 9, '', {
        fontFamily: TD_FONT_STACK,
        fontSize: '11px', fontStyle: 'bold', color: '#ff5d5d'
      }).setOrigin(0.5).setStroke('#3a0d0d', 3);
      this.add(this.vulnText);
    }
    if (this.vulnText) {
      this.vulnText.setText('裂甲×' + n);
      if (bump && this.scene) {
        this.scene.tweens.add({
          targets: this.vulnText, scale: 1.4, duration: 120, yoyo: true
        });
      }
    }
  }

  takeDamage(value) {
    /* 传送后 0.5s 无敌：伤害与索敌均跳过（含单体/溅射/电链） */
    if (this.dead || this.invulnTimer > 0) return;
    /* 易伤（仅小怪，BOSS 不吃）：受伤 = 原伤害 × (1 + 每层10% × 层数，满层+30%) */
    let vulnMul = 1;
    if (this.reactionsEnabled && !(this.cfg && this.cfg.boss) && this.vulnStacks.length) {
      const per = ((TD_CONFIG.elementSystem || {}).vuln || {}).perStack != null
        ? TD_CONFIG.elementSystem.vuln.perStack : 0.1;
      vulnMul = 1 + per * this.vulnStacks.length;
    }
    /* 伤害减免：dmgReduction > 0 时受击实际伤害 = 原伤害 × (1 - 减免) */
    const dmg = value * vulnMul * (1 - (this.dmgReduction || 0));
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

    /* 元素相关计时 */
    this.age += dt;
    if (this.reactionsEnabled) {
      /* 新反应模式：每个元素槽独立倒计时，到期整槽消散（量不随时间衰减） */
      if (this.elements.length) {
        let changed = false;
        for (let i = this.elements.length - 1; i >= 0; i--) {
          const s = this.elements[i];
          s.timer -= dt;
          if (s.timer <= 0) { this.elements.splice(i, 1); changed = true; }
        }
        if (changed) this.refreshElementMarks();
      }
      /* 冰冻倒计时：到期解除定身（视觉还原交给 showFreezeGfx） */
      if (this.freezeTimer > 0) {
        this.freezeTimer -= dt;
        if (this.freezeTimer <= 0) {
          this.freezeTimer = 0;
          this.showFreezeGfx(false);
        }
      }
      /* 易伤：每层独立倒计时，各自到时消失，不互相刷新 */
      if (this.vulnStacks.length) {
        let changed = false;
        for (let i = this.vulnStacks.length - 1; i >= 0; i--) {
          const stk = this.vulnStacks[i];
          stk.timer -= dt;
          if (stk.timer <= 0) { this.vulnStacks.splice(i, 1); changed = true; }
        }
        if (changed) this.refreshVulnView(false);
      }
    } else {
      /* 旧印记模式（1~5 关原样）：冰印记与减速同生同灭；其他元素到期消散，
         消散后若仍在减速则回落为冰印记 */
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
       （真控场，避免视觉位移叠加正常推进）；烘焙后从新位置全速继续走；
       冰冻（水+冰反应）期间完全定身，不推进 */
    let speedNow = this.baseSpeed * (this.slowTimer > 0 ? this.slowFactor : 1);
    if (this.freezeTimer > 0) speedNow = 0;
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
    this.showFreezeGfx(false);
    this.refreshVulnView(false); // 传 0 层效果：清掉易伤文字
    if (this.vulnText) { try { this.vulnText.destroy(); } catch (_) {} this.vulnText = null; }
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
    this.showFreezeGfx(false);
    if (this.vulnText) { try { this.vulnText.destroy(); } catch (_) {} this.vulnText = null; }
    this.removed = true;
    this.destroy();
  }
}
