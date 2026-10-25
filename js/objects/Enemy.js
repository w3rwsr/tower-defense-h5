/* ============================================================
 * Enemy.js —— 敌人（敌人X：低血快速 / 敌人Y：高血慢速）
 * 沿 GameScene 预计算的路径移动，支持减速 debuff 与血条。
 * ============================================================ */

/* ============================================================
 * 全局大数保护工具（无尽模式后期血量可达万亿级）
 * ------------------------------------------------------------
 * TD_MAX_HP       : 所有怪物血量上限（1e15，低于 JS 安全整数上限）
 * tdSafeNumber    : NaN / Infinity / 非数字 → 安全回退值
 * tdClampHp       : 血量钳制到 [1, 1e15]
 * tdFormatBigNumber: UI 缩写（万 / 亿 / 万亿 / 1e15 以上科学计数）
 * ============================================================ */
var TD_MAX_HP = 1e15;

function tdSafeNumber(value, fallback) {
  var n = Number(value);
  return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
}

function tdClampHp(value) {
  var n = Number(value);
  if (Number.isNaN(n) || n <= 0) return 1;
  /* 正向溢出（Infinity）按 1e15 上限处理，而不是回退成 1 */
  if (n === Infinity) return TD_MAX_HP;
  return Math.min(n, TD_MAX_HP);
}

/* 15.2万 / 2.4亿 / 3.6万亿 / 1.5e18；1e4 以下显示整数 */
function tdFormatBigNumber(value) {
  var n = tdSafeNumber(value, 0);
  if (n < 0) return '-' + tdFormatBigNumber(-n);
  var trim1 = function (s) { return s.replace(/\.0$/, ''); };
  if (n >= 1e15) {
    return n.toExponential(1).replace('e+', 'e').replace(/\.0e/, 'e');
  }
  if (n >= 1e12) return trim1((n / 1e12).toFixed(1)) + '万亿';
  if (n >= 1e8) return trim1((n / 1e8).toFixed(1)) + '亿';
  if (n >= 1e4) return trim1((n / 1e4).toFixed(1)) + '万';
  return String(Math.round(n));
}

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

    /* ---- 数值（全部来自 JSON；血量统一钳制到 1e15 防溢出） ---- */
    this.maxHp = tdClampHp(cfg.hp);
    this.hp = this.maxHp;
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
    this.bossFreezeTimer = 0;   // 冰塔封印强冻 BOSS 剩余秒数（绕过硬控免疫）
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
    this._gravitySealDot = 0;     // 引力塔解封：5% 真伤/秒剩余时长
    this._windGodDots = null;     // 风神降临：Boss 5% 最大生命真伤层（每层独立 5 秒）
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
    this.hpText = null;          // BOSS 血条数字（格式化缩写；小怪不显示数字）

    this.setDepth(20);
    scene.add.existing(this);
    this.drawHpBar(1);

    /* ---- BOSS 极限回血（第 10 关无尽模式第 10 波起；其余关卡恒 null）----
       仅 cfg.boss 实体启用；分裂体 / bossMini / 小怪不继承。
       参数全部由 GameScene.getBossExtremeHealCfg()（JSON bossExtremeHeal）驱动。 */
    this._ehCfg = null;
    this._ehHealTimer = 0;       // 当前回血剩余秒数（受到伤害时刷新为 healDuration）
    this._ehHealRate = 0;        // 回血速率（最大生命 × healPct / healDuration，每秒）
    this._ehHits = [];           // 爆发窗口内的实际血量伤害记录 [{t: ms, d: 伤害}]
    this._ehSuppressTimer = 0;   // 回血压制剩余秒数
    this._ehExpired = false;     // 血量跌破 10% 后永久失效标记
    this._ehGfx = null;          // 血条下方绿色回血提示
    this._ehTween = null;
    this._initExtremeHeal(scene);
    /* 第 10 关风塔封印：风蚀增伤常驻 40%（创建时即继承，覆盖分裂/聚合体） */
    if (scene && scene.windSealPermanent && typeof scene.applyWindSealToEnemy === 'function') {
      scene.applyWindSealToEnemy(this);
    }
  }

  /* ============================================================
   * BOSS 极限回血（对抗百分比伤害，仅第 10 关无尽模式第 10 波起）
   * ------------------------------------------------------------
   * 规则（JSON: endless.bossExtremeHeal）：
   *   · 受到【实际血量伤害】（含 percent 百分比真伤）→ 在 healDuration(3s)
   *     内快速回复最大生命的 healPct(20%)；连续受击只刷新时长不叠加。
   *   · burstWindow(5s) 内累计造成超过 burstPct(30%) 最大生命的伤害 →
   *     回血立刻打断，并压制 suppressDuration(5s)。
   *   · 血量低于 disableBelowHpRatio(10%) → 回血彻底失效（防卡血不死）。
   *   · 血条下方绿色闪烁细线 = 正在回血，提示玩家集火秒杀。
   * 数值统计的是「真正扣到本体 HP 的伤害」，被护盾完全吸收的伤害不计数。
   * ============================================================ */
  _initExtremeHeal(scene) {
    if (!this.cfg || !this.cfg.boss) return;
    if (!scene || typeof scene.getBossExtremeHealCfg !== 'function') return;
    const h = scene.getBossExtremeHealCfg();
    if (!h) return;
    this._ehCfg = {
      healPct: (h.healPct != null) ? h.healPct : 0.20,
      healDuration: Math.max(0.1, (h.healDuration != null) ? h.healDuration : 3),
      burstPct: (h.burstPct != null) ? h.burstPct : 0.30,
      burstWindow: Math.max(0.1, (h.burstWindow != null) ? h.burstWindow : 5),
      suppressDuration: Math.max(0, (h.suppressDuration != null) ? h.suppressDuration : 5),
      disableBelow: (h.disableBelowHpRatio != null) ? h.disableBelowHpRatio : 0.10
    };
  }

  /* 受伤回调：amount = 本击真正扣掉的本体 HP（护盾吸收部分不计） */
  _bossExtremeHealOnDamage(amount) {
    const cfg = this._ehCfg;
    if (!cfg || this._ehExpired || this.dead || this.removed || !(amount > 0)) return;
    if (this.maxHp <= 0 || this.hp <= 0) return;
    /* 低于 10%：机制永久失效，并清掉正在进行的回血 */
    if (this.hp / this.maxHp < cfg.disableBelow) {
      this._ehExpired = true;
      this._ehHealTimer = 0;
      this._ehHealRate = 0;
      this._showExtremeHealFx(false);
      return;
    }
    /* 爆发统计：滚动 burstWindow(5s) 窗口内累计伤害达到 30% 最大生命
       → 打断回血并压制。使用真实时间戳，持续小伤害（灼烧）不会无限累积，
       必须是「短时间内的爆发」才会触发。 */
    const now = (this.scene && this.scene.time) ? this.scene.time.now : 0;
    const winMs = cfg.burstWindow * 1000;
    this._ehHits.push({ t: now, d: amount });
    while (this._ehHits.length && now - this._ehHits[0].t > winMs) this._ehHits.shift();
    let burst = 0;
    for (let i = 0; i < this._ehHits.length; i++) burst += this._ehHits[i].d;
    if (burst >= this.maxHp * cfg.burstPct) {
      this._ehHits.length = 0;
      this._ehSuppressTimer = cfg.suppressDuration;
      this._ehHealTimer = 0;
      this._ehHealRate = 0;
      this._showExtremeHealFx(false);
      return;
    }
    /* 压制期间不启动回血；解除后下一次受击才重新触发 */
    if (this._ehSuppressTimer > 0) return;
    this._ehHealTimer = cfg.healDuration;
    this._ehHealRate = this.maxHp * cfg.healPct / cfg.healDuration;
  }

  /* 每帧结算：压制倒计时 / 回血与血条刷新（爆发窗口在受伤时按时间戳滚动清理） */
  _updateExtremeHeal(dt) {
    const cfg = this._ehCfg;
    if (!cfg || this._ehExpired || this.dead || this.removed) return;
    if (this._ehSuppressTimer > 0) {
      this._ehSuppressTimer -= dt;
      if (this._ehSuppressTimer <= 0) this._ehSuppressTimer = 0;
    }
    if (this._ehHealTimer > 0) {
      /* 回血过程中跌破 10%：立即停止并永久失效（防止卡血不死） */
      if (this.hp <= 0 || this.hp / this.maxHp < cfg.disableBelow) {
        this._ehExpired = true;
        this._ehHealTimer = 0;
        this._ehHealRate = 0;
        this._showExtremeHealFx(false);
        return;
      }
      this.hp = Math.min(this.maxHp, this.hp + this._ehHealRate * dt);
      this._ehHealTimer -= dt;
      if (this._ehHealTimer <= 0) this._ehHealTimer = 0;
      this.drawHpBar(this.hp / this.maxHp);
      this._showExtremeHealFx(this._ehHealTimer > 0);
    } else {
      this._showExtremeHealFx(false);
    }
  }

  /* 血条下方绿色闪烁细线（回血提示）：首次需要时创建，之后只切显隐 */
  _showExtremeHealFx(on) {
    if (!this._ehCfg || !this.scene) return;
    if (on) {
      if (!this._ehGfx) {
        const g = this.scene.add.graphics();
        const barH = this.cfg.barThickness || 5;
        g.setPosition(0, -this.cfg.radius - 10);   // 与血条同一本地坐标
        g.fillStyle(0x4dff8f, 0.9);
        g.fillRoundedRect(-this.barW / 2, barH + 2, this.barW, 2, 1);
        g.setAlpha(0.18);
        this.add(g);
        this._ehGfx = g;
        this._ehTween = this.scene.tweens.add({
          targets: g, alpha: { from: 0.18, to: 0.62 },
          duration: 220, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
        });
      }
      if (!this._ehGfx.visible) this._ehGfx.setVisible(true);
    } else if (this._ehGfx && this._ehGfx.visible) {
      this._ehGfx.setVisible(false);
    }
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
    /* 【硬控免疫】BOSS / 小BOSS：factor ≤ 0 的「完全定身」（雷塔4 麻痹定身、
       引力塔4 眩晕、以及各处 applySlow(0) 兜底）一律不生效 —— 避免高频硬控
       把 BOSS 钉在原地走不动路。减速（factor > 0：冰塔对 BOSS 的专项减速、
       引力塔对 BOSS 的 bossSlow、水+冰反应改判的减速）照常生效。 */
    if (this.hardControlImmune && !(factor > 0)) return;
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
      } else {
        this.applyFreeze(fz);
      }
    }
  }

  /* 冰冻：定身，期间免疫塔D牵引。
     BOSS / 小BOSS 完全免疫冰冻 —— 既不进入定身态，也不显示冰晶覆盖；
     水+冰反应对 BOSS 早已改判为减速（见 applyReactionEffect），此处为兜底。 */
  applyFreeze(duration) {
    if (this.hardControlImmune) return;
    this.freezeTimer = Math.max(this.freezeTimer, duration); // 重复冰冻刷新取较长
    this.showFreezeGfx(true);
  }

  /* 冰塔封印：强冻 BOSS（绕过硬控免疫，独立计时，CD 由塔侧控制） */
  applyBossFreeze(duration) {
    if (!(duration > 0)) return;
    this.bossFreezeTimer = Math.max(this.bossFreezeTimer || 0, duration);
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
     免疫的元素仍触发反应；此处的同元素拦截仅作兜底。
     opts.percent=true 表示【百分比伤害】（按最大生命百分比结算的 DOT，
     见 StatusEffects / applyDot）：其伤害照常经过 armorReduction（含水晶
     史莱姆 80% 减伤），但打到【血量护盾】时最终伤害再 ×0.5（减免 50%）；
     常规固定伤害打血量盾不做任何减免。 */
  takeDamage(value, element, opts) {
    /* 传送后 0.5s 无敌：伤害与索敌均跳过（含单体/溅射/电链） */
    if (this.dead || this.invulnTimer > 0) return;
    /* 元素护盾（第 7 关）：同元素伤害完全免疫——不掉血、不计有效攻击次数 */
    if (this.shieldBlocks(element)) return;
    /* 大数保护：非有限伤害直接丢弃；血量本身若被外部改坏则回退到安全值 */
    const incoming = tdSafeNumber(value, 0);
    if (!(incoming > 0)) return;
    if (!Number.isFinite(this.maxHp) || this.maxHp <= 0) this.maxHp = tdClampHp(this.maxHp);
    this.maxHp = Math.min(this.maxHp, TD_MAX_HP);
    if (!Number.isFinite(this.hp)) this.hp = this.maxHp;
    /* 本击前的本体 HP：用于 BOSS 极限回血统计「真正扣到本体」的伤害 */
    const hpBefore = this.hp;
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
    /* trueDamage=true：真伤，跳过减伤与祭坛降防（护盾仍优先吸收）
       rawTrue=true：封印类「X% 最大生命真伤」完全固定，不吃潮湿/风蚀等增伤乘区 */
    const ignoreArmor = !!(opts && opts.trueDamage);
    const rawTrue = !!(opts && opts.rawTrue);
    const vulnSafe = rawTrue ? 1 : vulnMul;
    const windSafe = rawTrue ? 1 : windMul;
    const ampSafe = rawTrue ? 1 : statusAmp;
    const altarMul = (!ignoreArmor && this.scene && this.scene.altarDamageMul > 1)
      ? this.scene.altarDamageMul : 1;
    /* 减伤口径：血量盾本体无盾时的基数 = armorReduction（水晶史莱姆 80%/分裂体
       90% 等常态减伤在此生效 —— 百分比伤害同样受此减免，见需求第 4 条） */
    let dmg = incoming * vulnSafe * windSafe * ampSafe * altarMul *
      (ignoreArmor ? 1 : (1 - this.armorReduction));
    /* 大数保护：任何乘区异常（NaN/Infinity）或超限伤害统一钳制到 1e15 */
    dmg = tdSafeNumber(dmg, 0);
    dmg = Math.max(0, Math.min(dmg, TD_MAX_HP));

    /* 血量护盾（第 7 关）：护盾血量优先吸收，盾存期间本体不掉血；
       击破当帧的溢出伤害继续结算到本体。
       【百分比伤害 vs 血量盾】最终伤害 ×0.5（减免 50%，需求和第 3 条）；
       常规固定伤害照原样全额吸收，不做减免；真伤不受 ×0.5 影响。 */
    const hpShield = (this.shield && this.shield.type === 'hp' && this.shield.hp > 0)
      ? this.shield : null;
    if (hpShield && opts && opts.percent && !ignoreArmor) dmg *= 0.5;
    if (hpShield) {
      /* 【强制拦截】strict 口径（第 9 关圣殿守卫圣盾，requirements 第 1~3 条）：
         只要盾还在（hp>0），任何形式的伤害（单体 / 溅射 / 电链 / 真伤 /
         百分比）一律由盾吸收，本体血量【绝不】被扣；即便本击把盾打爆，
         破盾当帧的溢出部分也全部丢弃，不得穿透到本体。 */
      const strict = !!hpShield.strict;
      const absorbed = Math.min(hpShield.hp, dmg);
      hpShield.hp -= absorbed;
      this.refreshShieldView(false);
      if (hpShield.hp > 1e-6) {         // 本击被护盾完全吸收：本体无任何变化
        this._showDamageNumber(absorbed, element, opts);
        return;
      }
      this.breakShield();
      if (strict) {                     // strict：溢出伤害丢弃，绝不打到本体
        this._showDamageNumber(absorbed, element, opts);
        return;
      }
      const rest = dmg - absorbed;
      if (rest <= 0) {
        this._showDamageNumber(absorbed, element, opts);
        return;
      }
      this.hp -= rest;
      this.drawHpBar(Math.max(0, this.hp / this.maxHp));
      this._showDamageNumber(absorbed + rest, element, opts);
    } else {
      this.hp -= dmg;
      this.drawHpBar(Math.max(0, this.hp / this.maxHp));
      this._showDamageNumber(dmg, element, opts);
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

    /* BOSS 极限回血：按本击真正扣掉的本体 HP 记账（百分比真伤同样计入；
       被血量盾完全吸收时为 0，不触发回血） */
    this._bossExtremeHealOnDamage(hpBefore - this.hp);

    /* 子类血量阈值分裂（第 8 关熔岩巨兽 20% 血线分裂）：
       子类覆写 onHpThresholdCheck 并在命中/持续伤害结算后判定；
       返回 true = 已接管（本击不再走死亡流程）。无覆写/无配置的关卡恒 false。 */
    if (!this.dead && this.onHpThresholdCheck()) return;
    /* 三阶段 BOSS（第 5/7 关，JSON 驱动）：一阶段血量降到阈值即分裂成分身；
       分裂优先于死亡判定（一击打穿阈值也走分裂），无 bossPhases 配置的
       关卡 bossPhase 恒为 0，此检查零影响 */
    if (!this.dead && this.bossPhase === 1 && this.scene.checkBossSplit(this)) return;
    if (this.hp <= 0) this.scene.onEnemyKilled(this);
  }

  /* 第 10 关伤害飘字入口：真伤/百分比统一用金色（GameScene.damageNumber 门控关卡） */
  _showDamageNumber(value, element, opts) {
    if (!(value > 0) || !this.scene || typeof this.scene.damageNumber !== 'function') return;
    this.scene.damageNumber(this, value, element,
      !!(opts && (opts.percent || opts.trueDamage)));
  }

  /* 血量阈值分裂钩子（子类覆写；基类恒 false = 零影响） */
  onHpThresholdCheck() { return false; }

  /* ============================================================
   * 状态接口（第 8 关起，供 4 级塔挂载异常状态；旧关卡无人调用）
   * ============================================================ */

  /* 是否处于冰冻定身（freezeTimer > 0，供 4 级塔/水晶史莱姆判定「寒冷」） */
  get isFrozen() { return this.freezeTimer > 0; }

  /* ============================================================
   * 硬控免疫（BOSS / 小BOSS）—— 全局拦截口径
   * ------------------------------------------------------------
   * 「硬控」= 停止移动类状态：冰冻、雷塔4 麻痹定身、引力塔4 眩晕、
   * 以及任何以 applySlow(0) 实现定身的兜底路径。
   * BOSS（cfg.boss，含第 8 关熔岩巨兽 / 金蓝灰变体 BOSS）与第 7 关绿色
   * 史莱姆分身（bossMini）一律免疫，只保留软控与 Debuff：
   *   · 减速（冰塔对 BOSS 的专项减速、引力塔 bossSlow、水+冰反应改判减速）
   *   · 降防（寒冷 / 麻痹值 / 降防层）
   *   · 持续掉血（灼烧 / 寒冷 DOT / 麻痹值 DOT）
   * 判定口径与牵引豁免（attackModule PullBehavior）、易伤豁免完全一致。 */
  get hardControlImmune() { return !!(this.bossMini || (this.cfg && this.cfg.boss)); }

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
         传入 data.element 使对应元素护盾（如雷盾）能免疫该负面效果。
         【硬控免疫】BOSS / 小BOSS 直接 return —— 雷塔4 攻击 BOSS 只照常施加
         「麻痹值」（paralysisStack：降防 + 持续掉血），绝不打断移动；
         引力塔4 眩晕同样被拦截。 */
      case 'paralyzed':
      case 'stun': {
        if (this.hardControlImmune) return;
        if (data.duration > 0) this.applySlow(0, data.duration, data.element || null, true);
        break;
      }
      /* 火塔4 灼烧：DOT 由塔侧结算，怪物侧无需处理（预留） */
      case 'burn':
      default:
        break;
    }
  }

  /* 持续伤害（灼烧 DoT / 燃烧层等）结算：与 takeDamage 同规则尊重血量护盾
     （盾存续时由盾吸收，击破溢出到本体）；次数盾每跳计 1 次有效攻击；
     元素值盾因无元素信息不消耗（仅本体承伤）。不吃易伤/风蚀乘区；
     opts.percent=true 的百分比 DoT（burnStacks）打血量盾最终伤害 ×0.5；
     旧关卡无人调用（burnStacks 恒空），零影响 */
  applyDot(amount, opts) {
    if (this.dead || this.invulnTimer > 0) return;
    const amountSafe = tdSafeNumber(amount, 0);
    if (!(amountSafe > 0)) return;
    if (!Number.isFinite(this.maxHp) || this.maxHp <= 0) this.maxHp = tdClampHp(this.maxHp);
    this.maxHp = Math.min(this.maxHp, TD_MAX_HP);
    if (!Number.isFinite(this.hp)) this.hp = this.maxHp;
    const hpBefore = this.hp;   // BOSS 极限回血：只统计真正扣到本体的 DOT
    const hpShield = (this.shield && this.shield.type === 'hp' && this.shield.hp > 0)
      ? this.shield : null;
    /* strict 口径与 takeDamage 完全一致：盾在则本体绝不掉血（含 DOT 溢出） */
    const strict = !!hpShield && !!hpShield.strict;
    let inDmg = (hpShield && opts && opts.percent) ? amountSafe * 0.5 : amountSafe;
    inDmg = tdSafeNumber(inDmg, 0);
    inDmg = Math.max(0, Math.min(inDmg, TD_MAX_HP));
    if (hpShield) {
      const absorbed = Math.min(hpShield.hp, inDmg);
      hpShield.hp -= absorbed;
      this.refreshShieldView(false);
      if (hpShield.hp > 1e-6) {       // 本跳被护盾完全吸收
        this._showDamageNumber(absorbed, null, opts);
        return;
      }
      this.breakShield();
      if (strict) {                   // strict：溢出丢弃，绝不打到本体
        this._showDamageNumber(absorbed, null, opts);
        return;
      }
      const rest = inDmg - absorbed;
      if (rest <= 0) {
        this._showDamageNumber(absorbed, null, opts);
        return;
      }
      this.hp -= rest;
      this._showDamageNumber(absorbed + rest, null, opts);
    } else {
      this.hp -= inDmg;
      /* 次数盾：DOT 每跳也计 1 次有效攻击（百分比伤害对护盾生效） */
      if (this.shield && this.shield.type === 'element' && this.shield.value == null) {
        this.shield.hits++;
        this.refreshShieldView(false);
        if (this.shield.hits >= this.shield.maxHits) this.breakShield();
      }
      this._showDamageNumber(inDmg, null, opts);
    }
    this.drawHpBar(Math.max(0, this.hp / this.maxHp));
    /* BOSS 极限回血：DOT（含百分比灼烧）真正扣血后同样触发 */
    this._bossExtremeHealOnDamage(hpBefore - this.hp);
    if (this.hp <= 0) {
      if (this.onHpThresholdCheck()) return;
      if (this.bossPhase === 1 && this.scene.checkBossSplit(this)) return;
      this.scene.onEnemyKilled(this);
    }
  }

  update(dt, realDt) {
    /* dead=正常死亡/进门流程；removed=已从场景销毁（销毁后到数组过滤前
       可能残留一帧，this.scene 已失效，直接跳过避免空引用）；
      !this.scene=场景切换/销毁瞬间的残留帧（如旧场景 shutdown 与 RAF
       交叠），此时路由几何已不存在，跳过本帧即可（会被所在场景数组过滤） */
    if (this.dead || this.removed || !this.scene) return;
    /* 记录本帧起点：第 10 关高速索敌/子弹扫掠碰撞需要上一帧位置，
       普通关卡不读取这两个字段，行为与旧版完全一致。 */
    const frameStartX = this.x;
    const frameStartY = this.y;
    const frameStartPathDist = this.pathDist;
    /* dt = 游戏时间（移动/弹道受倍速影响）；rdt = 真实时间（Buff/特殊 CD） */
    const rdt = (realDt == null) ? dt : realDt;

    /* BOSS 极限回血：结算回血 / 爆发窗口 / 压制倒计时（旧关卡 _ehCfg 恒 null） */
    this._updateExtremeHeal(rdt);

    /* 传送后无敌计时：期间本体半透明提示，结束恢复不透明 */
    if (this.invulnTimer > 0) {
      this.invulnTimer -= rdt;
      if (this.invulnTimer <= 0) {
        this.invulnTimer = 0;
        this.body.setAlpha(1);
      }
    }

    /* 减速计时：祭坛 10 秒等 Debuff 按真实时间走，4x 下不会缩水 */
    if (this.slowTimer > 0) {
      this.slowTimer -= rdt;
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
        s.timer -= rdt;
        if (s.timer <= 0) this.burnStacks.splice(i, 1);
        else dps += s.dps;
      }
      if (dps > 0) this.applyDot(dps * rdt);
    }
    /* 降防层独立倒计时，到期解除 */
    if (this.armorBreaks.length) {
      for (let i = this.armorBreaks.length - 1; i >= 0; i--) {
        const s = this.armorBreaks[i];
        s.timer -= rdt;
        if (s.timer <= 0) this.armorBreaks.splice(i, 1);
      }
    }
    /* 麻痹值消退：0.5s 保活窗口内不衰减（等待塔侧层刷新），随后快速消退
       （40/秒 ≈ 满 100 值 2.5s 清空，与麻痹层 2.5s 存续时长对齐） */
    if (this._paraHold > 0) {
      this._paraHold -= rdt;
    } else if (this.paralysis > 0) {
      this.paralysis = Math.max(0, this.paralysis - 40 * rdt);
    }
    /* 4 级塔状态计时（与塔侧 DOT/增伤时长对齐，塔侧到期不回调故怪物侧自计） */
    if (this._chillTimer > 0) {
      this._chillTimer -= rdt;
      if (this._chillTimer <= 0) {
        this._chillTimer = 0;
        this.statusDefReduce = 0;
      }
    }
    if (this._windTimer > 0) {
      this._windTimer -= rdt;
      if (this._windTimer <= 0) {
        this._windTimer = 0;
        this.statusWindAmp = 0;
      }
    }
    /* 冰塔封印：BOSS 强冻独立倒计时（不受 hardControlImmune 清理影响） */
    if (this.bossFreezeTimer > 0) {
      this.bossFreezeTimer -= rdt;
      if (this.bossFreezeTimer <= 0) {
        this.bossFreezeTimer = 0;
        if (this.freezeTimer <= 0) this.showFreezeGfx(false);
      }
    }
    /* 引力塔封印：拉扯附加 5% 真伤/秒（持续 5 秒；真伤跳过减伤/祭坛降防） */
    if (this._gravitySealDot > 0) {
      const gsCfg = (this.scene && typeof this.scene.getSealCfg === 'function')
        ? this.scene.getSealCfg('towerD') : null;
      const pct = (gsCfg && gsCfg.truePctPerSec != null) ? gsCfg.truePctPerSec : 0.05;
      const d = Math.min(rdt, this._gravitySealDot);
      this._gravitySealDot -= rdt;
      if (d > 0 && this.maxHp > 0) {
        const dot = tdClampHp(this.maxHp) * tdSafeNumber(pct, 0.05) * d;
        this.takeDamage(tdSafeNumber(dot, 0), null, { percent: true, trueDamage: true, rawTrue: true });
      }
      if (this.dead || this.removed) return;
    }
    /* 风神降临：Boss 身上的 5% 最大生命真伤层（每层独立 5 秒，可无限叠加） */
    if (this._windGodDots && this._windGodDots.length) {
      for (let i = this._windGodDots.length - 1; i >= 0; i--) {
        this._windGodDots[i] -= rdt;
        if (this._windGodDots[i] <= 0) this._windGodDots.splice(i, 1);
      }
      if (this._windGodDots.length > 0) {
        const wp = tdSafeNumber(this._windGodDotPct, 0.05);
        const dot = tdClampHp(this.maxHp) * wp * this._windGodDots.length * rdt;
        this.takeDamage(tdSafeNumber(dot, 0), 'wind', { percent: true, trueDamage: true, rawTrue: true });
      }
      if (this.dead || this.removed) return;
    }

    /* 元素相关计时 */
    this.age += dt;
    if (this.reactionsEnabled) {
      /* 新反应模式：每个元素槽独立倒计时，到期整槽消散（量不随时间衰减） */
      if (this.elements.length) {
        let changed = false;
        for (let i = this.elements.length - 1; i >= 0; i--) {
          const s = this.elements[i];
          s.timer -= rdt;
          if (s.timer <= 0) { this.elements.splice(i, 1); changed = true; }
        }
        if (changed) this.refreshElementMarks();
      }
      /* 冰冻倒计时：到期解除定身（视觉还原交给 showFreezeGfx） */
      if (this.freezeTimer > 0) {
        this.freezeTimer -= rdt;
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
          stk.timer -= rdt;
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
        this.elementTimer -= rdt;
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

    /* 【硬控免疫兜底】BOSS / 小BOSS：不论定身状态从哪条路径误挂上来，这里
       一律强制清除，保证 BOSS 永远在移动 —— 只留减速等软控与 Debuff。
       （正常路径已在 applySlow / applyFreeze / applyStatus 处被拦截，
         这一段是最后一道保险，普通小怪完全不受影响。） */
    if (this.hardControlImmune) {
      if (this.freezeTimer > 0) {
        this.freezeTimer = 0;
        this.showFreezeGfx(false);
      }
      if (this.slowTimer > 0 && !(this.slowFactor > 0)) this.slowFactor = 1;
    }

    /* 沿路径前进；窗口内被显著吸引时（向前/向后均算）推进减速
       （真控场，避免视觉位移叠加正常推进）；烘焙后从新位置全速继续走；
       冰冻（水+冰反应）期间完全定身，不推进 */
    let speedNow = this.baseSpeed * (this.slowTimer > 0 ? this.slowFactor : 1);
    if (this.freezeTimer > 0 || this.bossFreezeTimer > 0) speedNow = 0;
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
      /* 第 10 关：先把渲染位置钉到终点再结算漏怪，避免高倍速下这一帧的
         位移让怪物看起来"跳过"大门（前 9 关不改，保持原进门动画起点）。 */
      if (this.scene.levelId === 10) {
        const end = this.scene.pathPointAt(curLen, this.routeId);
        this.setPosition(end.x, end.y);
      }
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
    /* 第 10 关高速防漏的扫掠数据：本帧起点 → 当前位置 */
    this._prevX = frameStartX;
    this._prevY = frameStartY;
    this._prevPathDist = frameStartPathDist;
    /* 让下方的敌人盖住上方的，制造一点层次 */
    this.setDepth(20 + Math.floor(p.y));
  }

  drawHpBar(ratio) {
    const g = this.barBg;
    const w = this.barW;
    const h = this.cfg.barThickness || 5;   // BOSS 更粗血条（barThickness）
    /* 防除零 / 防 NaN / 防 Infinity：血条宽度比例始终钳制在 0~1 */
    let r = Number(ratio);
    if (!Number.isFinite(r)) r = 0;
    r = Math.max(0, Math.min(1, r));
    g.clear();
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-w / 2 - 1, -1, w + 2, h + 2, 3);
    if (r > 0) {
      /* 血量颜色：绿 → 黄 → 红 */
      const color = r > 0.55 ? 0x6be26b : r > 0.25 ? 0xffd24a : 0xff5d5d;
      g.fillStyle(color, 1);
      g.fillRoundedRect(-w / 2, 0, w * r, h, 2.5);
    }
    /* 第 10 关 BOSS 血条数字：缩写显示（15.2万 / 2.4亿 / 1.5e18），
       不会横穿屏幕；小怪血条与普通关卡保持纯图形，避免后期怪海数字糊屏。 */
    if (this.cfg && this.cfg.boss && this.scene && this.scene.levelId === 10) {
      if (!this.hpText && this.scene) {
        this.hpText = this.scene.add.text(0, -this.cfg.radius - 10 + h / 2, '', {
          fontFamily: TD_FONT_STACK, fontSize: '9px', fontStyle: 'bold',
          color: '#ffffff', resolution: TD_TEXT_RES
        }).setOrigin(0.5).setStroke('#1b1412', 2);
        this.add(this.hpText);
      }
      if (this.hpText) {
        this.hpText.setText(tdFormatBigNumber(Math.max(0, tdSafeNumber(this.hp, 0))));
      }
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
      maxValue: isValue ? def.value : null,
      /* compact=true（第 9 关图腾小怪元素盾）：只画元素光环，不画盾条/盾值
         文字（小怪数量多，避免糊屏）；旧关卡从不传此字段 → 行为零变化 */
      compact: !!def.compact,
      /* strict=true（第 9 关圣殿守卫圣盾）：强制拦截口径 —— 盾存续期间本体
         绝不受任何形式的伤害（含固定/溅射/电链/百分比），破盾当帧的溢出
         伤害也一律丢弃；旧关卡从不传此字段 → 保留原有「溢出继续结算本体」口径 */
      strict: !!def.strict
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

  /* 是否持有【生效中的血量护盾】（hp 盾且盾值 > 0）。
     供 BOSS/子类与外部（如圣殿守卫狂暴判定）统一查询：只要返回 true，
     takeDamage / applyDot 的 strict 口径就保证本体一滴血都不会掉。 */
  hasShield() {
    return !!(this.shield && this.shield.type === 'hp' && this.shield.hp > 0);
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

  /* 破盾：清状态 + 扩散特效 + 销毁视觉（状态由特效体现，不弹文字） */
  breakShield() {
    const s = this.shield;
    if (!s) return;
    if (this.scene && typeof this.scene.makePortalBurst === 'function') {
      const col = this.shieldColor();
      this.scene.makePortalBurst(this.x, this.y, col);
    }
    this.shield = null;
    this.clearShieldGfx();
  }

  /* 护盾颜色：火=橙红 / 雷=紫 / 水=蓝 / 冰=浅蓝 / 血量=金 */
  shieldColor() {
    const s = this.shield;
    if (!s) return 0xffffff;
    if (s.type === 'hp') return 0xffe27a;
    if (s.element === 'fire') return 0xff7a3c;
    if (s.element === 'thunder') return 0xb58bff;
    if (s.element === 'water') return 0x4a90e2;   // 水盾（第 9 关图腾）：天蓝，与冰盾区分
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
    /* 紧凑盾（第 9 关图腾小怪元素盾）：只保留 showShieldGfx 的元素光环，
       不创建盾条与小字（layer 数量可控，不糊屏）。旧关卡无此字段，零影响 */
    if (s.compact) return;
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
      text = '盾值 ' + tdFormatBigNumber(Math.max(0, s.value));
    } else {
      ratio = 1 - s.hits / Math.max(1, s.maxHits);
      text = '护盾 ' + tdFormatBigNumber(Math.max(0, s.maxHits - s.hits));
    }
    /* 盾条比例同样防 NaN/Infinity/除零 */
    ratio = tdSafeNumber(ratio, 0);
    ratio = Math.max(0, Math.min(1, ratio));
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
    /* BOSS 极限回血提示 Tween 随本体销毁，避免残留淡入淡出 */
    if (this._ehTween) { try { this._ehTween.stop(); } catch (_) {} this._ehTween = null; }
    this._ehGfx = null;
    this._endSlime();
    this._endBossVideo();
    super.destroy(fromScene);
  }
}
