/* ============================================================
 * Enemy.js —— 敌人（敌人X：低血快速 / 敌人Y：高血慢速）
 * 沿 GameScene 预计算的路径移动，支持减速 debuff 与血条。
 * ============================================================ */
class Enemy extends Phaser.GameObjects.Container {
  constructor(scene, typeKey, routeId, opts) {
    const cfg = TD_CONFIG.enemies[typeKey];
    const rid = routeId || 0;   // 所属路线（多路线关卡：0=上路 / 1=下路），缺省 0
    const p = scene.pathPointAt(0, rid);
    super(scene, p.x, p.y);
    this.routeId = rid;
    this.opts = opts || {};     // 构造选项（bossTexKey：BOSS 变体贴图键，按波次由 GameScene 指定）

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

    /* ---- 状态接口（第 8 关起供 4 级塔挂载异常状态；旧关卡无人写入，零影响） ----
       burnStacks   灼烧层 [{dps, timer}]：applyBurnStack(dps, dur) 写入，
                    update() 按层结算持续伤害（血量护盾存续时由盾吸收）
       armorBreaks  降防层 [{amount, timer}]：applyArmorBreak(降减伤量, dur)
                    写入；takeDamage 统一读取 armorReduction（基础减伤 -
                    Σ降防，下限 0），无降防层时与旧公式完全等价
       paralysis    麻痹值 0~100（雷系积累）：addParalysis(v) 写入，update()
                    内带 0.5s 保活窗口快速消退；水晶史莱姆减伤对其敏感 */
    this.burnStacks = [];
    this.armorBreaks = [];
    this.paralysis = 0;
    /* 4 级塔状态（StatusEffects.js 经 applyStatus(type, data) 鸭子调用）：
       降防合计（寒冷 -defReduce / 麻痹每层 -defReducePerStack）、
       受伤增幅合计（潮湿每层 +perStackAmp / 风蚀 +dmgAmp），
       DOT 伤害本体由塔侧按秒 takeDamage 结算（同样走 armorReduction 口径） */
    this.statusDefReduce = 0;     // 寒冷状态降防（0~1）
    this.statusParaReduce = 0;    // 麻痹值降防（0~1）
    this.statusWetAmp = 0;        // 潮湿增幅（0~n×perStackAmp）
    this.statusWindAmp = 0;       // 风蚀增幅（0~dmgAmp）
    this.statusAmpExclude = 'water'; // 潮湿增幅的排除元素（非该元素才生效）
    this._chillTimer = 0;         // 寒冷状态剩余时长（水晶史莱姆减伤敏感）
    this._windTimer = 0;          // 风蚀剩余时长
    this._paraHold = 0;           // 麻痹值保活窗口（层未到期不衰减）

    /* ---- 三阶段 BOSS（第 5 关，JSON 驱动） ---- */
    this.bossPhase = 0;       // 0=普通怪/无阶段；1=一阶段（阈值分裂）；2=分身；3=合体强化
    this.bossPhaseLink = 0;   // 同一次分裂的分身共享的组号（合体时机按组判定）
    this.bossPhasePool = 0;   // 本次分裂的分身总血量（合体回血基数）
    this.bossMini = false;    // 小 BOSS 标记（第 7 关绿色史莱姆分身）：用 enemyX 贴图
                              // 但享受 BOSS 待遇（免疫牵引/冰冻易伤，走分身计数流程）

    /* ---- BOSS 护盾（第 7 关，JSON 驱动 waves.bossShields） ----
       shield = { type:'element'|'hp', element, hits, maxHits, hp, maxHp }
         element 盾：免疫同元素伤害/附着（不计有效次数），其余命中累计次数破盾；
         hp 盾：护盾血量吸收伤害，盾破前本体不掉血。 */
    this.shield = null;
    this.shieldGfx = null;    // 护盾光环 Graphics
    this.shieldBar = null;    // 护盾剩余条 Graphics（元素盾=次数 / 血量盾=护盾血）
    this.shieldText = null;   // 元素盾剩余次数文字
    this.shieldTween = null;  // 光环脉动

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

    /* ---- 贴图：BOSS 变体贴图 / 史莱姆静态降级贴图 / 程序化占位贴图 ---- */
    const art = cfg.art || {};
    let texKey = 'enemy_' + typeKey;
    if (this.opts.bossTexKey && scene.textures.exists(this.opts.bossTexKey)) {
      /* BOSS 三变体贴图（boss_gold/boss_blue/boss_gray，EnemyArtData.js，离线裁切+
         白底抠图）；缺失时回退程序化占位 enemy_enemyBoss */
      texKey = this.opts.bossTexKey;
    } else if (cfg.slimeVideo) {
      /* 史莱姆静态降级贴图（slime_static_green/blue，从视频单帧掏出，与视频观感一致） */
      const sKey = 'slime_static_' + cfg.slimeVideo.frame;
      if (scene.textures.exists(sKey)) texKey = sKey;
    }
    this.body = scene.add.image(0, 0, texKey);
    /* 显示尺寸归一化：JSON art.h = 世界高度，宽按贴图宽高比（保持原造型不变形）；
       超采样静态贴图靠 setDisplaySize 缩回世界尺寸，DPR 下与塔清晰度一致 */
    this._applyArtSize(art);
    this.add(this.body);

    /* ---- 史莱姆蹦跳视频接管（绿色快怪=左段 / 蓝紫慢怪=右段） ----
       全场共享单视频纹理，就绪后把 body 贴图换成视频对应段 frame + 专用距离键
       管线，视频自身即蹦跳动画；不支持/加载失败/超时则保持静态贴图 + 蹦跳
       Tween 降级（见 _startStaticSlime）。 */
    this._slimeCfg = cfg.slimeVideo || null;
    this._slimeUsed = false;
    this._videoActive = false;
    this._staticSlime = false;
    this._hopTween = null;
    this._slimeGuard = null;
    if (this._slimeCfg && typeof SLIME_VIDEO !== 'undefined' && SLIME_VIDEO.supported) {
      this._slimeUsed = true;
      SLIME_VIDEO.use();
      SLIME_VIDEO.whenReady(() => this._showSlimeVideo());
      /* 解码失败/长时间未就绪 → 静态降级，避免小怪卡成静止占位 */
      this._slimeGuard = scene.time.delayedCall(3000, () => {
        if (!this._videoActive) this._startStaticSlime();
      });
    } else if (this._slimeCfg) {
      /* 当前环境不支持视频（Canvas 渲染器 / file:// 跨域 / 无 H.264）：
         直接静态贴图 + 蹦跳 Tween */
      this._startStaticSlime();
    }

    /* ---- BOSS 运动视频接管（boss_walk.mp4：左金/中蓝/右灰三段） ----
       与史莱姆同模式：全场共享单视频 + BossWalkGK 距离键管线；就绪后把
       body 换成对应段 frame，视频自身即行走动画；不支持/加载失败/超时
       则保持静态 BOSS 贴图（Player 端零改动，数值照旧）。 */
    this._bossKey = null;
    this._bossVideoUsed = false;
    this._bossVideoActive = false;
    this._bossGuard = null;
    const bossVcfg = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.enemies &&
      TD_CONFIG.enemies.bossVideo) || null;
    if (this.opts && this.opts.bossTexKey && bossVcfg &&
      typeof BOSS_VIDEO !== 'undefined' && BOSS_VIDEO.supported) {
      this._bossKey = String(this.opts.bossTexKey).replace('boss_', '');
      this._bossVideoUsed = true;
      BOSS_VIDEO.use();
      BOSS_VIDEO.whenReady(() => this._showBossVideo());
      /* 解码失败/长时间未就绪 → 释放引用，保留静态贴图 */
      this._bossGuard = scene.time.delayedCall(4000, () => {
        if (!this._bossVideoActive) this._endBossVideo();
      });
    }
    /* Boss 出场即预载对应死亡视频（懒加载，死亡时通常早已就绪） */
    if (this._bossKey && typeof BOSS_DEATH !== 'undefined' && BOSS_DEATH.prewarm) {
      try { BOSS_DEATH.prewarm(this._bossKey); } catch (e) { /* 降级兜底 */ }
    }

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

  /* 施加减速：取更强（数值更小）的减速系数，时间刷新取较长者。
     element 标注减速来源（'ice'=冰弹/冰反应；第 7 关冰元素护盾存在期间
     免疫一切冰系减速——当前游戏内减速全部来自冰元素，故无元素标注同样拦截）
     noMark=true 时不挂任何元素印记（塔D 对 BOSS 的固定减速：来源是引力而非
     冰元素，不应在 1~5 关的旧印记模式下误挂"冰"标记）
     【不设减速上限】减速幅度由调用方决定，本方法不做任何强度截断，只保
     "移速不为负"的安全下限（系数下限 0 → 移速最低 0，绝不倒退）。 */
  applySlow(factor, duration, element, noMark) {
    /* 元素护盾免疫对应元素的负面效果：
       - 同元素减速直接拦截（冰盾拦冰减速、雷盾拦雷麻痹定身等）
       - 冰盾额外拦截无元素标注的减速（引力塔等），因旧版减速全部来自冰系 */
    if (this.shield && this.shield.type === 'element' && this.shield.element) {
      if (element === this.shield.element) return;
      if (!element && this.shield.element === 'ice') return;
    }
    if (!(factor > 0)) factor = 0;   // 只防负移速，不设减速强度上限
    // 多种减速同时存在时：取更强（系数更小）者，持续时间刷新为较长者
    this.slowFactor = this.slowTimer > 0 ? Math.min(this.slowFactor, factor) : factor;
    this.slowTimer = Math.max(this.slowTimer, duration);
    this.body.setTint(0xbbeeff);
    /* 旧印记模式（1~5 关）：冰印记与减速同生同灭；新反应模式中冰元素是
       独立元素槽（attachElement），不再由减速自动挂印记 */
    if (!noMark && !this.reactionsEnabled && (!this.element || this.elementTimer <= 0)) {
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
      if ((this.cfg && this.cfg.boss) || this.bossMini) {
        /* BOSS 免疫冰冻/易伤：水+冰改为移速降低（JSON bossSlowRatio 驱动）。
           第 7 关绿色史莱姆分身（bossMini）同样按 BOSS 处理。 */
        const ratio = ((TD_CONFIG.elementSystem.vuln || {}).bossSlowRatio != null)
          ? TD_CONFIG.elementSystem.vuln.bossSlowRatio : 0.3;
        this.applySlow(Math.max(0, 1 - ratio), fz);
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
    if ((this.cfg && this.cfg.boss) || this.bossMini) return;
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
        fontSize: '11px', fontStyle: 'bold', color: '#ff5d5d',
        resolution: TD_TEXT_RES
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

  /* 受伤结算。element = 本次伤害的元素属性（'fire'|'ice'|'thunder'|'water'|
     null），由 Projectile / 电链在命中时传入：第 7 关元素护盾据此拦截。
     调用点（附着之前）应先用 shieldBlocks(element) 跳过元素附着，避免被
     免疫的元素仍触发反应；此处的同元素拦截仅作兜底。 */
  takeDamage(value, element) {
    /* 传送后 0.5s 无敌：伤害与索敌均跳过（含单体/溅射/电链） */
    if (this.dead || this.invulnTimer > 0) return;
    /* 元素护盾（第 7 关）：同元素伤害完全免疫——不掉血、不计有效攻击次数 */
    if (this.shieldBlocks(element)) return;
    /* 易伤（仅小怪，BOSS/小BOSS 不吃）：受伤 = 原伤害 × (1 + 每层10% × 层数，满层+30%) */
    let vulnMul = 1;
    if (this.reactionsEnabled && !(this.cfg && this.cfg.boss) && !this.bossMini &&
        this.vulnStacks.length) {
      const per = ((TD_CONFIG.elementSystem || {}).vuln || {}).perStack != null
        ? TD_CONFIG.elementSystem.vuln.perStack : 0.1;
      vulnMul = 1 + per * this.vulnStacks.length;
    }
    /* 风蚀增伤（第 8 关）：风眼全局窗口（scene.windErosionTimer）与
       风塔4怪物侧窗口（statusWindAmp）【不叠加，取两者较大值】；
       任一方触发都会刷新自己的窗口时长 → 效果上互为续时。
       非第 8 关场景 windErosionTimer 恒 undefined → sceneWind=0，零影响 */
    const sceneWind = (this.scene && this.scene.windErosionTimer > 0)
      ? ((this.scene.windErosionMul != null) ? this.scene.windErosionMul : 0.2) : 0;
    const statusWind = ((this.statusWindAmp || 0) && element !== this.statusAmpExclude)
      ? this.statusWindAmp : 0;
    const windMul = 1 + Math.max(sceneWind, statusWind);
    /* 4 级塔状态增幅剩余部分：潮湿每层 +4%（水塔4，排除元素不生效） */
    const statusAmp = 1 + ((this.statusWetAmp && element !== this.statusAmpExclude)
      ? this.statusWetAmp : 0);
    const dmg = value * vulnMul * windMul * statusAmp * (1 - this.armorReduction);

    /* 血量护盾（第 7 关）：护盾血量优先吸收，盾存期间本体不掉血；
       击破当帧的溢出伤害继续结算到本体 */
    const hpShield = (this.shield && this.shield.type === 'hp' && this.shield.hp > 0)
      ? this.shield : null;
    if (hpShield) {
      const absorbed = Math.min(hpShield.hp, dmg);
      hpShield.hp -= absorbed;
      this.refreshShieldView(false);
      if (hpShield.hp > 1e-6) return; // 本击被护盾完全吸收：本体无任何变化
      this.breakShield();
      const rest = dmg - absorbed;
      if (rest <= 0) return;
      this.hp -= rest;
      this.drawHpBar(Math.max(0, this.hp / this.maxHp));
    } else {
      this.hp -= dmg;
      this.drawHpBar(Math.max(0, this.hp / this.maxHp));
    }

    /* 元素护盾：
       - 次数盾（breakHits）：非免疫元素/无元素攻击每次命中计 1，满 maxHits 破盾
       - 元素值盾（value）：非免疫元素攻击按反应 cost 消耗盾值，归零破盾
         （无元素攻击不消耗盾值，仅对本体造成伤害）
       被免疫的同元素命中在函数入口已 return，不进入此处 */
    if (this.shield && this.shield.type === 'element') {
      if (this.shield.value != null) {
        if (element) {
          const consumed = this._elementShieldConsume(element);
          if (consumed > 0) {
            this.shield.value -= consumed;
            this.refreshShieldView(false);
            if (this.shield.value <= 1e-6) this.breakShield();
          }
        }
      } else {
        this.shield.hits++;
        this.refreshShieldView(false);
        if (this.shield.hits >= this.shield.maxHits) this.breakShield();
      }
    }

    /* 三阶段 BOSS（第 5/7 关，JSON 驱动）：一阶段血量降到阈值即分裂成分身；
       分裂优先于死亡判定（一击打穿阈值也走分裂），无 bossPhases 配置的
       关卡 bossPhase 恒为 0，此检查零影响 */
    if (!this.dead && this.bossPhase === 1 && this.scene.checkBossSplit(this)) return;
    if (this.hp <= 0) this.scene.onEnemyKilled(this);
  }

  /* ============================================================
   * 状态接口（第 8 关起，供 4 级塔挂载异常状态；旧关卡无人调用）
   * ============================================================ */

  /* 是否处于冰冻定身（freezeTimer > 0，供 4 级塔/水晶史莱姆判定「寒冷」） */
  get isFrozen() { return this.freezeTimer > 0; }

  /* 当前有效伤害减免 = 基础减伤 - Σ状态降防（寒冷/麻痹值） - Σ降防层，下限 0。
     takeDamage 统一读取此接口；无任何降防时返回值与旧 dmgReduction 完全一致 */
  get armorReduction() {
    let a = (this.dmgReduction || 0) - (this.statusDefReduce || 0) - (this.statusParaReduce || 0);
    for (let i = 0; i < this.armorBreaks.length; i++) a -= this.armorBreaks[i].amount;
    return Math.max(0, a);
  }

  /* 挂载灼烧层：dps = 每秒伤害，duration = 持续秒数（可叠层，独立倒计时） */
  applyBurnStack(dps, duration) {
    if (dps > 0 && duration > 0) this.burnStacks.push({ dps, timer: duration });
  }

  /* 挂载降防层：amount = 降低的减伤比例（0~1），duration = 持续秒数（可叠层） */
  applyArmorBreak(amount, duration) {
    if (amount > 0 && duration > 0) this.armorBreaks.push({ amount, timer: duration });
  }

  /* 增加麻痹值（雷系积累，0~100 封顶；水晶史莱姆减伤对其敏感） */
  addParalysis(v) {
    this.paralysis = Math.min(100, (this.paralysis || 0) + Math.max(0, v));
    this._paraHold = 0.5;
  }

  /* ============================================================
   * 4 级塔状态挂载接口（StatusEffects.js 塔侧鸭子调用，模块隔离约定）
   * 职责划分：DOT 扣血由塔侧按秒 takeDamage 结算；本接口只负责怪物侧
   * 的降防 / 受伤增幅 / 定身结算与寒冷、麻痹值等标记（供水晶史莱姆等
   * 特性怪判定）。未实现的状态类型安全忽略。
   * ============================================================ */
  applyStatus(type, data) {
    data = data || {};
    switch (type) {
      /* 冰塔4 寒冷状态：降防 + 寒冷标记（DOT 塔侧结算） */
      case 'chill': {
        this._chillTimer = Math.max(this._chillTimer || 0, data.duration || 0);
        this.statusDefReduce = Math.max(this.statusDefReduce || 0, data.defReduce || 0);
        break;
      }
      /* 水塔4 潮湿：每层受伤 +perStackAmp（层数变化时由塔侧通知重算） */
      case 'wet': {
        this.statusAmpExclude = data.excludeElement || 'water';
        this.statusWetAmp = (data.stacks || 0) * (data.perStackAmp || 0);
        break;
      }
      /* 雷塔4 麻痹值：每层降防 + 麻痹值按层映射（25/层，0~100） */
      case 'paralysisStack': {
        const stacks = data.stacks || 0;
        this.statusParaReduce = stacks * (data.perStackDefReduce || 0);
        this.paralysis = stacks > 0 ? Math.min(100, stacks * 25) : 0;
        this._paraHold = stacks > 0 ? 0.5 : 0;
        break;
      }
      /* 风塔4 风蚀增伤：怪物侧计时窗口（与塔侧计时同长对齐） */
      case 'windErosion': {
        this._windTimer = Math.max(this._windTimer || 0, data.duration || 0);
        this.statusWindAmp = data.dmgAmp || 0;
        break;
      }
      /* 雷塔4 麻痹定身 / 引力塔4 眩晕：复用减速通道实现定身（factor 0）。
         传入 data.element 使对应元素护盾（如雷盾）能免疫该负面效果。 */
      case 'paralyzed':
      case 'stun': {
        if (data.duration > 0) this.applySlow(0, data.duration, data.element || null, true);
        break;
      }
      /* 火塔4 灼烧：DOT 由塔侧结算，怪物侧无需处理（预留） */
      case 'burn':
      default:
        break;
    }
  }

  /* 持续伤害（灼烧 DoT 等）结算：与 takeDamage 同规则尊重血量护盾
     （盾存续时由盾吸收，击破溢出到本体）；次数盾每跳计 1 次有效攻击；
     元素值盾因无元素信息不消耗（仅本体承伤）。不吃易伤/风蚀乘区；
     旧关卡无人调用（burnStacks 恒空），零影响 */
  applyDot(amount) {
    if (this.dead || this.invulnTimer > 0) return;
    const hpShield = (this.shield && this.shield.type === 'hp' && this.shield.hp > 0)
      ? this.shield : null;
    if (hpShield) {
      const absorbed = Math.min(hpShield.hp, amount);
      hpShield.hp -= absorbed;
      this.refreshShieldView(false);
      if (hpShield.hp > 1e-6) return; // 本跳被护盾完全吸收
      this.breakShield();
      const rest = amount - absorbed;
      if (rest <= 0) return;
      this.hp -= rest;
    } else {
      this.hp -= amount;
      /* 次数盾：DOT 每跳也计 1 次有效攻击（百分比伤害对护盾生效） */
      if (this.shield && this.shield.type === 'element' && this.shield.value == null) {
        this.shield.hits++;
        this.refreshShieldView(false);
        if (this.shield.hits >= this.shield.maxHits) this.breakShield();
      }
    }
    this.drawHpBar(Math.max(0, this.hp / this.maxHp));
    if (this.hp <= 0) {
      if (this.bossPhase === 1 && this.scene.checkBossSplit(this)) return;
      this.scene.onEnemyKilled(this);
    }
  }

  update(dt) {
    /* dead=正常死亡/进门流程；removed=已从场景销毁（销毁后到数组过滤前
       可能残留一帧，this.scene 已失效，直接跳过避免空引用）；
      !this.scene=场景切换/销毁瞬间的残留帧（如旧场景 shutdown 与 RAF
       交叠），此时路由几何已不存在，跳过本帧即可（会被所在场景数组过滤） */
    if (this.dead || this.removed || !this.scene) return;

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

    /* ---- 状态接口结算（第 8 关起；数组/数值恒空时零开销，旧关卡无影响） ---- */
    /* 灼烧：按层求和的每秒伤害，逐层独立倒计时 */
    if (this.burnStacks.length) {
      let dps = 0;
      for (let i = this.burnStacks.length - 1; i >= 0; i--) {
        const s = this.burnStacks[i];
        s.timer -= dt;
        if (s.timer <= 0) this.burnStacks.splice(i, 1);
        else dps += s.dps;
      }
      if (dps > 0) this.applyDot(dps * dt);
    }
    /* 降防层独立倒计时，到期解除 */
    if (this.armorBreaks.length) {
      for (let i = this.armorBreaks.length - 1; i >= 0; i--) {
        const s = this.armorBreaks[i];
        s.timer -= dt;
        if (s.timer <= 0) this.armorBreaks.splice(i, 1);
      }
    }
    /* 麻痹值消退：0.5s 保活窗口内不衰减（等待塔侧层刷新），随后快速消退
       （40/秒 ≈ 满 100 值 2.5s 清空，与麻痹层 2.5s 存续时长对齐） */
    if (this._paraHold > 0) {
      this._paraHold -= dt;
    } else if (this.paralysis > 0) {
      this.paralysis = Math.max(0, this.paralysis - 40 * dt);
    }
    /* 4 级塔状态计时（与塔侧 DOT/增伤时长对齐，塔侧到期不回调故怪物侧自计） */
    if (this._chillTimer > 0) {
      this._chillTimer -= dt;
      if (this._chillTimer <= 0) {
        this._chillTimer = 0;
        this.statusDefReduce = 0;
      }
    }
    if (this._windTimer > 0) {
      this._windTimer -= dt;
      if (this._windTimer <= 0) {
        this._windTimer = 0;
        this.statusWindAmp = 0;
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

  /* ============================================================
   * BOSS 护盾（第 7/8 关，JSON 驱动 waves.bossShields；由 GameScene
   * 在 BOSS 出生时按波次挂载）
   *   {type:'element', element, breakHits}：次数盾
   *       免疫同元素的附着与伤害（shieldBlocks），同元素命中不计有效次数；
   *       其余元素/无元素攻击每次命中计 1，满 breakHits 破盾；
   *       冰盾存活期间同时免疫冰系减速（见 applySlow）。
   *   {type:'element', element, value}：元素值盾（第 8 关）
   *       免疫同元素伤害与负面效果；其他元素攻击按元素反应 cost 比例
   *       消耗盾值（参照 attachElement 的反应消耗公式），value 归零破盾；
   *       非元素攻击不消耗盾值，仅对本体造成伤害。
   *   {type:'hp', hp}：血量盾
   *       护盾血量吸收一切伤害，盾存期间本体不掉血。
   * ============================================================ */
  applyShield(def) {
    if (!def || this.dead) return;
    const isValue = (def.type === 'element' && def.value != null);
    this.shield = {
      type: def.type === 'hp' ? 'hp' : 'element',
      element: def.element || null,
      hits: 0,
      maxHits: def.breakHits || 40,
      hp: def.hp || 0,
      maxHp: def.hp || 0,
      value: isValue ? def.value : null,
      maxValue: isValue ? def.value : null
    };
    this.showShieldGfx();
    this.refreshShieldView(true);
  }

  /* 本次元素攻击是否被护盾完全免疫（调用点须在 attachElement 之前判定，
     被免疫时跳过附着/伤害/减速；返回 false 不影响任何旧关卡） */
  shieldBlocks(element) {
    const s = this.shield;
    return !!(s && s.type === 'element' && element && s.element === element);
  }

  /* 元素值盾被其他元素攻击时的消耗量：严格参照防御塔之间的元素反应
     消耗机制——u = min(盾值/cost盾, 攻击附着量/cost攻)，消耗 u×cost盾。
     无对应反应表时退化为直接消耗 attachAmount（等量交换）。
     仅非免疫元素调用；返回本次从盾中扣减的数值。 */
  _elementShieldConsume(attackElement) {
    const s = this.shield;
    if (!s || s.value == null || !attackElement || attackElement === s.element) return 0;
    const sys = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.elementSystem) || {};
    const attachAmt = (sys.attachAmount != null) ? sys.attachAmount : 2;
    const pairs = sys.pairs || {};
    const pair = pairs[s.element + '+' + attackElement] || pairs[attackElement + '+' + s.element];
    if (!pair) return attachAmt;
    const cost = pair.cost || {};
    const costShield = (cost[s.element] != null) ? cost[s.element] : 1;
    const costAtk = (cost[attackElement] != null) ? cost[attackElement] : 1;
    const u = Math.min(s.value / costShield, attachAmt / costAtk);
    return u * costShield;
  }

  /* 破盾：清状态 + 提示文字 + 扩散特效 + 销毁视觉 */
  breakShield() {
    const s = this.shield;
    if (!s) return;
    if (this.scene && typeof this.scene.floatText === 'function') {
      let label;
      if (s.type === 'hp') label = '血量护盾击破！';
      else if (s.value != null) {
        label = s.element === 'fire' ? '火元素护盾击破！'
          : s.element === 'thunder' ? '雷元素护盾击破！'
          : s.element === 'ice' ? '冰元素护盾击破！' : '元素护盾击破！';
      } else {
        label = s.element === 'thunder' ? '雷元素护盾击破！'
          : s.element === 'ice' ? '冰元素护盾击破！' : '护盾击破！';
      }
      this.scene.floatText(this.x, this.y - this.radius - 30, label, 0xffffff);
    }
    if (this.scene && typeof this.scene.makePortalBurst === 'function') {
      const col = this.shieldColor();
      this.scene.makePortalBurst(this.x, this.y, col);
    }
    this.shield = null;
    this.clearShieldGfx();
  }

  /* 护盾颜色：火=橙红 / 雷=紫 / 冰=浅蓝 / 血量=金 */
  shieldColor() {
    const s = this.shield;
    if (!s) return 0xffffff;
    if (s.type === 'hp') return 0xffe27a;
    if (s.element === 'fire') return 0xff7a3c;
    if (s.element === 'thunder') return 0xb58bff;
    return 0x7fdcff;
  }

  /* 护盾光环（描边圆 + 外圈淡光 + 呼吸脉动） */
  showShieldGfx() {
    this.clearShieldGfx();
    if (!this.shield || !this.scene) return;
    const color = this.shieldColor();
    const g = this.scene.add.graphics();
    const r = this.radius + 7;
    g.lineStyle(2.5, color, 0.95).strokeCircle(0, 0, r);
    g.lineStyle(1, 0xffffff, 0.45).strokeCircle(0, 0, r + 3.5);
    /* 四个方向的小能量点，强化"罩子"质感 */
    g.fillStyle(color, 0.9);
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      g.fillCircle(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1), 2.2);
    }
    this.add(g);
    this.shieldGfx = g;
    this.shieldTween = this.scene.tweens.add({
      targets: g, alpha: 0.5, duration: 650, yoyo: true, repeat: -1,
      ease: 'Sine.easeInOut'
    });
  }

  clearShieldGfx() {
    if (this.shieldTween) {
      try { this.shieldTween.stop(); } catch (_) {}
      this.shieldTween = null;
    }
    if (this.shieldGfx) { try { this.shieldGfx.destroy(); } catch (_) {} this.shieldGfx = null; }
    if (this.shieldBar) { try { this.shieldBar.destroy(); } catch (_) {} this.shieldBar = null; }
    if (this.shieldText) { try { this.shieldText.destroy(); } catch (_) {} this.shieldText = null; }
  }

  /* 血条上方的小盾条：
     - 次数盾 = 剩余有效次数比例，文字显示剩余次数
     - 元素值盾 = 剩余盾值比例，文字显示剩余盾值
     - 血量盾 = 剩余护盾血比例 */
  refreshShieldView() {
    if (!this.scene) return;
    const s = this.shield;
    if (!s) { this.clearShieldGfx(); return; }
    const y0 = -this.radius - 22;
    if (!this.shieldBar) {
      this.shieldBar = this.scene.add.graphics();
      this.add(this.shieldBar);
    }
    const g = this.shieldBar;
    g.clear();
    const w = this.barW;
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-w / 2 - 1, y0 - 1, w + 2, 5, 2.5);
    let ratio;
    let text = null;
    if (s.type === 'hp') {
      ratio = Math.max(0, s.hp / Math.max(1, s.maxHp));
    } else if (s.value != null) {
      ratio = Math.max(0, s.value / Math.max(1, s.maxValue));
      text = '盾值 ' + Math.ceil(Math.max(0, s.value));
    } else {
      ratio = 1 - s.hits / Math.max(1, s.maxHits);
      text = '护盾 ' + Math.max(0, s.maxHits - s.hits);
    }
    g.fillStyle(this.shieldColor(), 1);
    g.fillRoundedRect(-w / 2, y0, Math.max(0, w * ratio), 3, 1.5);

    if (text != null) {
      if (!this.shieldText) {
        this.shieldText = this.scene.add.text(0, y0 - 7, '', {
          fontFamily: TD_FONT_STACK,
          fontSize: '10px', fontStyle: 'bold', color: '#ffffff',
          resolution: TD_TEXT_RES
        }).setOrigin(0.5).setStroke('#2a1a4a', 3);
        this.add(this.shieldText);
      }
      this.shieldText.setText(text);
    }
  }

  /* 击杀后的弹跳消失动画，结束后由场景统一销毁 */
  playDeath() {
    /* 防重入：一次死亡只允许走一条流程（视频接管 或 降级动画+皇冠）。
       重复触发（同帧多次伤害/外部再调用）会导致生成第二个皇冠或二次
       动画，这里直接拦截，保证死亡时仅生成一个皇冠。 */
    if (this.removed || this._dying) return;
    this._dying = true;
    this.clearShieldGfx();   // 护盾光环/盾条随死亡清除
    this.clearElementMark();  // 印记光点随死亡清除（tween 不残留）
    this.showFreezeGfx(false);
    this.refreshVulnView(false); // 传 0 层效果：清掉易伤文字
    if (this.vulnText) { try { this.vulnText.destroy(); } catch (_) {} this.vulnText = null; }
    this.body.setTint(0xffffff);

    /* ---- BOSS 死亡视频接管 ----
       Boss 被击杀 → 在死亡位置叠加对应死亡动画视频（锚点居中，独立于
       Boss 对象播放）；播完后视频层快速淡出、皇冠贴图缓慢淡出（见
       BOSS_DEATH._finish）。接管失败（未就绪/并发超限/不支持）走下方
       原有弹跳动画 + 皇冠淡出降级，功能不缺失。 */
    const bossKey = (this.opts && this.opts.bossTexKey) ?
      String(this.opts.bossTexKey).replace('boss_', '') : null;
    if (bossKey && typeof BOSS_DEATH !== 'undefined' && BOSS_DEATH.supported) {
      const px = this.x, py = this.y;
      if (BOSS_DEATH.play(bossKey, px, py, this.scene)) {
        this.removed = true;
        this.destroy();       // Boss 本体立即销毁，视频/皇冠由 BOSS_DEATH 托管
        return;
      }
    }
    /* 降级皇冠：无视频能力时也保留「皇冠缓慢消失」效果（代码叠加贴图） */
    if (bossKey) this._spawnFadingCrown(bossKey, this.x, this.y);

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

  /* 降级路径的皇冠淡出：从死亡视频末帧提取的皇冠贴图，原地缓慢淡出。
     位置与视频路径的皇冠完全一致（crownAnchor 锚点换算 + deathDisplayH），
     并按世界尺寸收进可见区——无论走哪条路径，皇冠都落在同一位置。 */
  _spawnFadingCrown(key, x, y) {
    const scene = this.scene;
    if (!scene || !scene.add || !scene.tweens || !scene.textures) return;
    if (typeof TD_CONFIG === 'undefined' || !TD_CONFIG.enemies ||
      !TD_CONFIG.enemies.bossDeath) return;
    const texKey = 'crown_' + key;
    if (!scene.textures.exists(texKey)) return;
    const dc = TD_CONFIG.enemies.bossDeath;
    const ch = (dc.crownDisplayH && dc.crownDisplayH[key]) || 9;
    const dh = (dc.deathDisplayH && dc.deathDisplayH[key]) || 50;
    const anchor = (dc.crownAnchor && dc.crownAnchor[key]) || { x: 321, y: 434 };
    const W = TD_CONFIG.world ? TD_CONFIG.world.width : 960;
    const H = TD_CONFIG.world ? TD_CONFIG.world.height : 540;
    const px = Math.max(dh / 2, Math.min(W - dh / 2, x));
    const py = Math.max(dh / 2, Math.min(H - dh / 2, y));
    const fadeIn = Math.max(0, dc.crownFadeIn != null ? dc.crownFadeIn : 200);
    const fade = Math.max(200, dc.crownFade != null ? dc.crownFade : 1500);
    const crown = scene.add.image(
      px + (anchor.x - 320) / 640 * dh,
      py + (anchor.y - 320) / 640 * dh, texKey);
    const tex = scene.textures.get(texKey);
    const ratio = (tex && tex.source && tex.source[0]) ?
      tex.source[0].width / Math.max(1, tex.source[0].height) : 1.4;
    crown.setDisplaySize(ch * ratio, ch);
    crown.setDepth(59);
    crown.setAlpha(0);
    scene.tweens.add({
      targets: crown,
      alpha: 1,
      duration: fadeIn,
      ease: 'Sine.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: crown,
          alpha: 0,
          duration: fade,
          ease: 'Sine.easeInOut',
          onComplete: () => { try { if (crown.active) crown.destroy(); } catch (_) {} }
        });
      }
    });
  }

  destroyImmediately() {
    this.clearShieldGfx();
    this.clearElementMark();
    this.showFreezeGfx(false);
    if (this.vulnText) { try { this.vulnText.destroy(); } catch (_) {} this.vulnText = null; }
    this.removed = true;
    this.destroy();
  }

  /* ============================================================
   * 史莱姆贴图 / 视频（绿色快怪 & 蓝紫慢怪）
   * ------------------------------------------------------------
   * 视频就绪 → body 换共享视频纹理对应段 frame + SlimeVideoGK 距离键管线，
   * 视频自身即蹦跳动画；不可用 → 静态贴图 + 循环蹦跳 Tween 降级。
   * 共享视频按引用计数播放（场上有史莱姆才解码），销毁时统一释放。
   * ============================================================ */

  /* 按 JSON art.h（世界高度）设定 body 显示尺寸，保持贴图宽高比不变形 */
  _applyArtSize(art) {
    const h = art && art.h;
    if (!h || !this.body) return;
    const fw = this.body.width, fh = this.body.height;
    if (!fw || !fh) return;
    this.body.setDisplaySize(h * (fw / fh), h);
  }

  /* 史莱姆视频就绪：把身体贴图切到共享视频纹理对应段 frame + 距离键管线 */
  _showSlimeVideo() {
    if (this.dead || this.removed || !this.scene || !this.body) return;
    if (typeof SLIME_VIDEO === 'undefined' || !SLIME_VIDEO.isReady()) return;
    if (typeof fireVideoPipelineReady !== 'function' ||
      !fireVideoPipelineReady(this.scene, 'SlimeVideoGK')) {
      this._startStaticSlime();
      return;
    }
    const frame = (this._slimeCfg && this._slimeCfg.frame) || 'green';
    const d = SLIME_VIDEO.displaySize(frame);
    this.body.setTexture(SLIME_VIDEO.texKey(), SLIME_VIDEO.frameKey(frame));
    this.body.setPipeline('SlimeVideoGK');
    this.body.setDisplaySize(d.w, d.h);
    if (this._hopTween) { try { this._hopTween.stop(); } catch (_) {} this._hopTween = null; }
    this._staticSlime = false;
    this._videoActive = true;
  }

  /* 静态降级：静态贴图 + 循环蹦跳 Tween（手机端不支持视频播放时用） */
  _startStaticSlime() {
    if (this._videoActive || this._staticSlime || this.dead || this.removed || !this.scene) return;
    this._staticSlime = true;
    const hop = (this._slimeCfg && this._slimeCfg.hopHeight) || 6;
    this._hopTween = this.scene.tweens.add({
      targets: this.body, y: -hop, duration: 260, yoyo: true,
      repeat: -1, ease: 'Sine.easeInOut'
    });
  }

  /* 收尾：停蹦跳 Tween + 释放共享视频引用（引用计数归零即暂停解码） */
  _endSlime() {
    if (this._slimeGuard) { try { this._slimeGuard.remove(false); } catch (_) {} this._slimeGuard = null; }
    if (this._hopTween) { try { this._hopTween.stop(); } catch (_) {} this._hopTween = null; }
    if (this._slimeUsed) {
      this._slimeUsed = false;
      try { if (typeof SLIME_VIDEO !== 'undefined') SLIME_VIDEO.release(); } catch (_) {}
    }
    this._videoActive = false;
  }

  /* ============================================================
   * BOSS 运动视频（boss_walk.mp4：左金/中蓝/右灰三段，共享单视频）
   * ============================================================ */

  /* 视频就绪：body 换共享视频纹理对应段 frame + BossWalkGK 距离键管线 */
  _showBossVideo() {
    if (this.dead || this.removed || !this.scene || !this.body || !this._bossKey) return;
    if (typeof BOSS_VIDEO === 'undefined' || !BOSS_VIDEO.isReady()) return;
    if (typeof fireVideoPipelineReady !== 'function' ||
      !fireVideoPipelineReady(this.scene, 'BossWalkGK')) {
      this._endBossVideo();
      return;
    }
    const d = BOSS_VIDEO.displaySize(this._bossKey);
    this.body.setTexture(BOSS_VIDEO.texKey(), BOSS_VIDEO.frameKey(this._bossKey));
    this.body.setPipeline('BossWalkGK');
    this.body.setDisplaySize(d.w, d.h);
    this._bossVideoActive = true;
  }

  /* 收尾：释放共享运动视频引用（保留静态贴图显示，不加蹦跳） */
  _endBossVideo() {
    if (this._bossGuard) { try { this._bossGuard.remove(false); } catch (_) {} this._bossGuard = null; }
    if (this._bossVideoUsed) {
      this._bossVideoUsed = false;
      try { if (typeof BOSS_VIDEO !== 'undefined') BOSS_VIDEO.release(); } catch (_) {}
    }
    this._bossVideoActive = false;
  }

  /* 任一销毁路径（playDeath / destroyImmediately / 场景关闭）统一释放视频引用 */
  destroy(fromScene) {
    this._endSlime();
    this._endBossVideo();
    super.destroy(fromScene);
  }
}
