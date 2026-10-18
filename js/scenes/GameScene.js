/* ============================================================
 * GameScene.js —— 主游戏场景
 * 职责：地图绘制 / 放塔 / 选塔升级出售 / 波次状态机 /
 *       金币生命 / 暂停 / 1x-2x 倍速 / DOM HUD 同步
 * ============================================================ */
class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create(data) {
    /* DPR 适配：gameSize=960dpr×540dpr，相机 zoom=dpr 后地图/塔/敌人/
       弹道/热区/触摸命中全部沿用 960x540 世界坐标，逻辑零改动
       （详见 main.js TD_DPR）。场景 restart/再来一局会重跑 create，
       zoom 随之重新生效。
       zoom 以视野中心为锚点，必须再 centerOn(世界中心) 抵消 zoom
       产生的 scroll 偏移（dpr=1 时 scroll=0，等价旧行为），否则
       地图会整体偏到画面左上外侧、点击坐标也整体错位 */
    const dpr0 = window.__TD_DPR || 1;
    this.cameras.main.setZoom(dpr0);
    this.cameras.main.centerOn(TD_CONFIG.world.width / 2, TD_CONFIG.world.height / 2);

    this.W = TD_CONFIG.world.width;
    this.H = TD_CONFIG.world.height;

    /* 进入游戏场景，恢复 HUD 显示 */
    document.getElementById('hud-top').style.display = '';
    document.getElementById('hud-bottom').style.display = '';

    /* 当前关卡编号（来自关卡选择场景），默认第 1 关 */
    this.levelId = (data && data.levelId) || 1;

    /* 关卡独立配置：Level 1 回退到顶层 path/waves/economy（零改动保持已正常体验）；
       第 5 关等部分配置关卡（仅有 enemyHpMul 等覆盖字段）与顶层基础合并，
       缺省字段从顶层取，覆盖字段叠加 */
    const _baseCfg = { path: TD_CONFIG.path, waves: TD_CONFIG.waves, economy: TD_CONFIG.economy };
    const _lvCfg = TD_CONFIG.levels[this.levelId];
    this.levelCfg = _lvCfg ? Object.assign({}, _baseCfg, _lvCfg) : _baseCfg;

    /* 放塔规则：顶层 build 为底，关卡 build 覆盖（如第 2 关更密的采样间距）；
       第 1 关新手教程单独用 tutorialCell（点更少、更简单） */
    this.buildCfg = Object.assign({}, TD_CONFIG.build, this.levelCfg.build || {});

    /* ---- 路径几何预计算 ---- */
    this.buildPathGeometry();

    /* ---- 波次按钮与终点大门避让：本关终点大门若落在左下角波次按钮区内
       （如第 1 关大门在左下角），则给底部 HUD 加类让波次按钮上移避开大门，
       并把上移后的按钮占位并入本关放塔禁区（避免按钮压住火力点）。
       地图、关卡数值、其它关卡 HUD 均不变。 ---- */
    this.waveHudClearGate = this._detectGateHudClash();
    if (this.waveHudClearGate) {
      const _av = TD_CONFIG.castleGate.hudAvoid || {};
      const _mv = _av.movedZone || { x: 0, y: 300, w: 300, h: 45 };
      /* 复制后再并入，避免改动全局 TD_CONFIG.build.uiSafeZones */
      this.buildCfg.uiSafeZones = (this.buildCfg.uiSafeZones || []).concat([_mv]);
    }

    /* ---- 传送门预计算（第 4 关等含 portals 配置的关卡）：
       把 JSON 的「路线号+路径点索引」解析为沿路里程与坐标 ---- */
    this.buildPortals();

    /* ---- 道路火力点：沿路径两侧均匀分布的两排整齐点（绿色方格） ---- */
    this.buildHotspots();

    /* ---- 障碍物：放塔无效区（离路太远、放塔打不到路面）摆卡通障碍物 ---- */
    this.spawnObstacles();

    /* ---- 障碍物据点：为每个障碍物补一个“放塔就能够到它”的专属火力点
       （琥珀色方格，可与道路点共存、可被多个障碍物共享） ---- */
    this.buildObstacleSpots();

    /* ---- 静态画面 ---- */
    this.drawGround();
    this.drawPath();
    this.drawPortals();
    this.drawDecor();
    /* 终点城堡大门改在 lives 初始化后构建（门旁血量牌要读初始生命数） */

    /* ---- 游戏状态 ---- */
    const econ = this.levelCfg.economy || TD_CONFIG.economy;
    this.gold = econ.startGold;
    this.lives = econ.startLives;
    /* 终点城堡大门（含点击热区与门旁血量牌；生命值已初始化） */
    this.drawCastleGates();
    /* 顶部 HUD 的血量 chip 隐藏——血量已改为大门旁悬浮牌显示
       （仅游戏中隐藏，不破坏选关场景对整个 hud-top 的 display 控制） */
    const _livesChip = document.querySelector('.chip-lives');
    if (_livesChip) _livesChip.classList.add('hidden-by-gate');
    /* 波次按钮避让大门：冲突时给底部 HUD 加类上移（见 style.css .wave-clear-gate） */
    const _hudBottom = document.getElementById('hud-bottom');
    if (_hudBottom) _hudBottom.classList.toggle('wave-clear-gate', !!this.waveHudClearGate);
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    /* 三阶段 BOSS 分裂/聚合链接：每局重置，避免同页跨关卡/重开残留旧链接 */
    this.bossPhaseLinks = {};
    this.bossPhaseLinkSeq = 0;
    /* this.obstacles 已在 create 开头的 spawnObstacles() 生成，这里不再重置 */
    this.occupied = new Map();      // 热区 key("x_y") -> Tower
    this.selectedType = null;       // 商店选中的塔类型（放置模式）
    this.selectedTower = null;
    this.paused = false;
    this.speedMul = 1;
    /* 集火目标（点击道路上的怪物设置）：射程覆盖它的伤害型塔优先攻击；
       null=未集火。_focusMarker=跟随怪物的脉冲光圈，_focusTween=呼吸动画。 */
    this.focusEnemy = null;
    this._focusMarker = null;
    this._focusTween = null;

    /* 火塔燃烧视频：新一局重置引用计数并暂停全部解码器（塔放置时重新注册） */
    try { FIRE_BURN.enterScene(); } catch (e) {}
    /* 风塔龙卷风视频：同上，共享单视频，新一局重置引用与暂停 */
    try { WIND_VIDEO.enterScene(); } catch (e) {}
    /* 史莱姆共享视频：新一局引用计数归零并暂停（史莱姆生成时重新注册） */
    try { SLIME_VIDEO.enterScene(); } catch (e) {}
    /* BOSS 共享运动视频：新一局引用计数归零并暂停（Boss 生成时重新注册） */
    try { BOSS_VIDEO.enterScene(); } catch (e) {}
    /* BOSS 死亡视频：新一局停掉所有播放中的死亡动画并清零计数 */
    try { BOSS_DEATH.enterScene(); } catch (e) {}
    /* 本关媒体【按需加载】：只加载本关真正会用到的视频（含 BOSS 的关卡才
       加载 BOSS 运动视频，且只预载本关实际出场的死亡视频变体），全部经
       TDMedia 串行队列逐个下载 + 进度条 + 10s 超时跳过。进关到 BOSS 出场
       间隔数十秒，死亡视频届时必然就绪；未就绪时 Enemy/Tower 照旧走既有
       静态贴图降级，玩法与观感零变化。 */
    try { this._deferredLevelMedia(); } catch (e) {
      /* 不影响进关，但不静默：打出具体报错便于真机排查 */
      console.error('[TDMedia] 本关媒体调度异常（不影响进关）：', e);
    }

    /* ---- 波次状态机：ready(可开战) / active(出怪中) / won / lost ---- */
    this.state = 'ready';
    this.waveIndex = 0;
    this.countdown = null;
    this.spawnList = [];
    this.spawnIdx = 0;
    this.spawnClock = 0;
    /* 支线波（第 4 关右侧岔路奇兵，JSON 驱动 waves.sideWaves）：
       activeSideWave=当前进行中的支线波定义（主波之间插入，不计入 5 个主波编号）；
       sideWavesDone=已播放支线波 id 集合（每局只播一次）。其他关卡无 sideWaves
       配置时两者恒为 null/{}，状态机行为与旧版完全一致。 */
    this.activeSideWave = null;
    this.sideWavesDone = {};

    /* ---- 预览 / 选中 画面 ---- */
    this.ghost = this.add.graphics().setDepth(500);
    this.rangeGfx = this.add.graphics().setDepth(499);
    /* 点击火力点时的选塔浮框（每次打开动态构建）与火力点高亮层 */
    this.picker = null;
    this._pickSpot = null;
    /* 点空白区域时的"仅高亮提示"模式（无浮框），再点空白关闭；所有关卡通用 */
    this._spotHint = false;
    this.spotHlGfx = this.add.graphics().setDepth(590);
    /* 浮框弹出期间，所有其他可放置区域的半透明绿色描边方框层（在塔/障碍物
       之上、面板之下；脉冲由 drawOtherSpotsHighlight 驱动，关闭浮框即清除） */
    this.spotOtherHlGfx = this.add.graphics().setDepth(15);

    /* ---- 塔操作面板（升级 / 出售） ---- */
    this.panel = this.buildTowerPanel();

    /* ---- 输入（鼠标 + 触摸统一走 pointer） ---- */
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    /* 右键取消放置/移除塔：阻止浏览器默认右键菜单弹出 */
    this.input.mouse && this.input.mouse.disableContextMenu();
    document.addEventListener('contextmenu', (e) => e.preventDefault());

    this.initDom();
    this.syncHud();
    /* 移动端：按地图画面重新锚定信息栏/齿轮（桌面端不执行） */
    if (window.__tdLayoutMobileHud) window.__tdLayoutMobileHud();

    /* 第 1 关 = 新手教程关，启动引导提示 */
    if (this.levelId === 1) this.startTutorial();

    /* 第 8 关「风蚀荒原」：风眼装饰 + 风蚀增伤 + 火焰路径容器
       （仅本关配置 levelCfg.windEyes 时创建；同时预生成三种新怪的
       代码绘制贴图，供 Enemy 构造器按 enemy_<typeKey> 直接取用） */
    if (this.levelCfg.windEyes && typeof Level8Controller !== 'undefined') {
      this.level8 = new Level8Controller(this);
    }
  }

  /* ============================================================
   * 本关媒体按需加载（移动端加载优化）
   * 规则：只加载本关会用到的视频，且全部经 TDMedia 串行队列逐个下载
   *      （一次只下 1 个媒体，不再并发抢带宽/解码器），带进度条与
   *      10s 单项超时；任何失败都跳过并保持既有静态贴图降级。
   *   - BOSS 运动视频（~4.1MB）：仅波次含 BOSS 的关卡加载；
   *   - BOSS 死亡视频（每个 ~2.3~3.0MB）：仅预载本关实际出场的变体；
   *   - 风塔视频（~2.3MB）：风元素塔在本关可用时才加载。
   * ============================================================ */
  _deferredLevelMedia() {
    const hasBoss = (function () {
      try { return JSON.stringify(this.levelCfg.waves).indexOf('enemyBoss') >= 0; }
      catch (e) { return false; }
    }).call(this);
    const bossKeys = hasBoss ? this._bossKeysInLevel() : [];
    const windUsable = (function () {
      try { return TDStorage.isTowerUnlocked('towerF', this.levelId); }
      catch (e) { return false; }
    }).call(this);

    /* 只把【真正还会入队下载】的项计入计划：已经 init 过的模块 / 已经建过
       条目（下载中/已就绪/已判失败）的死亡视频一律不再排——再次游玩同一关时
       资源已在内存/纹理管理器里，计划为空 → 不显示加载页 → 秒进游戏。
       若资源有缺失（例如上次加载失败），只把缺失项重新入队，绝不重置整关加载。 */
    const plan = [];
    if (hasBoss && typeof BOSS_VIDEO !== 'undefined' && BOSS_VIDEO.init && !BOSS_VIDEO._inited) {
      plan.push({ tag: 'BOSS_VIDEO.init', delay: 800, fn: () => BOSS_VIDEO.init(this) });
    }
    if (windUsable && typeof WIND_VIDEO !== 'undefined' && WIND_VIDEO.init && !WIND_VIDEO._inited) {
      plan.push({ tag: 'WIND_VIDEO.init', delay: 1100, fn: () => WIND_VIDEO.init(this) });
    }
    /* 死亡视频按出场顺序逐个错峰预载：队列串行，下完一个才下一个 */
    const deathMod = (typeof BOSS_DEATH !== 'undefined') ? BOSS_DEATH : null;
    bossKeys.forEach((k, i) => {
      if (!deathMod) return;
      if (!deathMod.supported) return;                      // H.264/管线不支持：加载无意义，不计入
      if (deathMod._st && deathMod._st[k]) return;          // 已建条目：已在下载/已就绪/已失败 → 不重复排
      plan.push({
        tag: 'BOSS_DEATH.prewarm(' + k + ')',
        delay: 1400 + i * 3500,
        fn: () => deathMod.prewarm(k)
      });
    });
    if (!plan.length) {
      /* 本关所需媒体本会话已全部加载过（或本关无需媒体）：直接进游戏，不出现加载页 */
      try { if (typeof TDMedia !== 'undefined' && TDMedia.endGroup) TDMedia.endGroup(true); } catch (e) {}
      return;
    }

    /* 进度条：百分比由 TDMedia 按已入队媒体的完成/失败推进；
       10s 上限到点自动隐藏放行，绝不卡住玩家。
       调度用 DOM setTimeout（不用 this.time.delayedCall）：媒体加载属于
       资源层，不应受游戏暂停/场景时钟暂停影响，且与选关页的错峰加载同源。 */
    try {
      if (typeof TDMedia !== 'undefined' && TDMedia.beginGroup) TDMedia.beginGroup('加载本关资源');
    } catch (e) {
      console.warn('[TDMedia] 进度条启动失败（不影响进关）：', e);
    }
    plan.forEach((p) => {
      setTimeout(() => {
        try { p.fn(); } catch (e) {
          /* 不静默：打出具体任务名与错误，便于真机排查 */
          console.error('[TDMedia] 媒体加载任务异常：' + p.tag, e);
        }
      }, p.delay);
    });
  }

  /* 本关实际出场的 BOSS 变体 key 列表（gold/blue/gray），取值规则与
     resolveBossVariant 完全对齐：entry.bossVariantPattern 优先，
     其次关卡级 waves.bossWaveVariant，最后全局 boss.waveVariant（表外回退下标 0）。
     用途：只预载本关会用到的死亡视频，避免把三个（~7.8MB）全下载下来。 */
  _bossKeysInLevel() {
    const out = [];
    const add = (k) => {
      if ((k === 'gold' || k === 'blue' || k === 'gray') && out.indexOf(k) < 0) out.push(k);
    };
    const bcfg = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.boss) || {};
    const variants = bcfg.variants || [];
    const globalMap = bcfg.waveVariant || {};
    const waves = (this.levelCfg && this.levelCfg.waves) || {};
    const levelMap = waves.bossWaveVariant || {};
    (waves.list || []).forEach((grp, wi) => {
      (grp || []).forEach((entry) => {
        if (!entry || !entry.type) return;
        const ec = (TD_CONFIG.enemies && TD_CONFIG.enemies[entry.type]) || null;
        if (!ec || !ec.boss) return;
        const pattern = entry.bossVariantPattern;
        if (pattern && pattern.length) {
          const n = Math.max(1, entry.count || 1);
          for (let i = 0; i < n; i++) add(pattern[i % pattern.length]);
          return;
        }
        if (levelMap[String(wi)] != null) { add(levelMap[String(wi)]); return; }
        const vi = (globalMap[String(wi)] != null) ? globalMap[String(wi)] : 0;
        if (variants[vi]) add(variants[vi].key);
      });
    });
    return out;
  }

  /* ============================================================
   * 路径几何
   * 支持多路线（第 3 关双出怪路线）：levelCfg.paths 为多组 waypoints，
   * 每组一条独立路线；单路线关卡仍用 levelCfg.path.waypoints（包成 1 条）。
   * routeGeoms[routeId] = { waypoints, segments, pathLength }；
   * this.segments = 全部路线线段的扁平并集（供 distToPath /
   * buildHotspots / nearestPathPoint 遍历所有道路，放塔合法性覆盖全线）；
   * 敌人持 routeId，pathPointAt / 路程 / 吸引段查询按各自路线计算。
   * ============================================================ */
  buildPathGeometry() {
    const routeWpLists = this.levelCfg.paths
      ? this.levelCfg.paths
      : [this.levelCfg.path.waypoints];
    /* 终点封闭边距（与 goalDrawPos 一致）：末路径点若落在画面外（如 y=580），
       沿最后一段回收到画面内，使道路到大门口即终止、不再延伸出地图；
       敌人走到该点（=大门门扇处）即触发进门，不会走出画面。 */
    const m = 34;
    this.routeGeoms = routeWpLists.map((rawWp) => {
      /* 复制路径点，避免直接改动关卡配置里的原数组 */
      const wp = rawWp.map((w) => ({ x: w.x, y: w.y }));
      const n = wp.length;
      if (n >= 2) {
        const q = wp[n - 2], p = wp[n - 1];
        const cx = Phaser.Math.Clamp(p.x, m, this.W - m);
        const cy = Phaser.Math.Clamp(p.y, m, this.H - m);
        if (cx !== p.x || cy !== p.y) {
          const dx = p.x - q.x, dy = p.y - q.y;
          const len2 = dx * dx + dy * dy;
          const t = len2 > 0 ? ((cx - q.x) * dx + (cy - q.y) * dy) / len2 : 0;
          /* 仅当回收点仍落在最后一段线段上（方向不反向、不偏离）时生效，
             保证多路线共享同一终点时各路线落点完全一致 */
          if (t > 0 && t < 1 &&
              Math.abs(q.x + dx * t - cx) < 0.5 &&
              Math.abs(q.y + dy * t - cy) < 0.5) {
            p.x = cx; p.y = cy;
          }
        }
      }
      const segments = [];
      let totalLength = 0;
      for (let i = 0; i < wp.length - 1; i++) {
        const len = Phaser.Math.Distance.Between(wp[i].x, wp[i].y, wp[i + 1].x, wp[i + 1].y);
        segments.push({
          x1: wp[i].x, y1: wp[i].y, x2: wp[i + 1].x, y2: wp[i + 1].y,
          start: totalLength, len
        });
        totalLength += len;
      }
      return { waypoints: wp, segments, totalLength, pathLength: totalLength };
    });
    /* 单一路线向后兼容：this.waypoints / this.pathLength 指向 route 0 */
    this.waypoints = this.routeGeoms[0].waypoints;
    this.segments = [];
    for (const rg of this.routeGeoms) this.segments = this.segments.concat(rg.segments);
    this.totalLength = this.routeGeoms[0].totalLength;
    this.pathLength = this.routeGeoms[0].pathLength;
  }

  /** 某条路线的总长（敌人按自己的 routeId 判定是否到达终点） */
  routeLength(routeId) {
    const rg = this.routeGeoms[routeId || 0];
    return rg ? rg.pathLength : this.pathLength;
  }

  /** 按“已走距离”取路径坐标；routeId 缺省 = 0（单路线关卡兼容） */
  pathPointAt(dist, routeId) {
    const rg = this.routeGeoms[routeId || 0] || this.routeGeoms[0];
    const wp = rg.waypoints, segs = rg.segments;
    if (dist <= 0) return { x: wp[0].x, y: wp[0].y };
    for (const s of segs) {
      if (dist <= s.start + s.len) {
        const t = (dist - s.start) / s.len;
        return { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t };
      }
    }
    const last = wp[wp.length - 1];
    return { x: last.x, y: last.y };
  }

  /** 点到路径中心线的最短距离（放塔合法性校验） */
  distToPath(x, y) {
    let min = Infinity;
    for (const s of this.segments) {
      /* 点到线段距离 */
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len2 = dx * dx + dy * dy;
      let t = ((x - s.x1) * dx + (y - s.y1) * dy) / len2;
      t = Phaser.Math.Clamp(t, 0, 1);
      const px = s.x1 + dx * t, py = s.y1 + dy * t;
      min = Math.min(min, Math.hypot(x - px, y - py));
    }
    return min;
  }

  /** 是否命中【关卡专属排除点】（JSON：build.excludeSpots / excludeRadius）：
      用于删掉个别自动生成的火力点（如第 7 关终点大门旁被门体与血量牌遮挡的点）。
      未配置该字段的关卡恒返回 false → 第 1~6 关行为零变化。 */
  isExcludedSpot(x, y) {
    const b = this.buildCfg || TD_CONFIG.build;
    const list = b.excludeSpots;
    if (!list || !list.length) return false;
    const r = b.excludeRadius != null ? b.excludeRadius : 30;
    for (const e of list) {
      if (Math.hypot(x - e.x, y - e.y) <= r) return true;
    }
    return false;
  }

  /* ============================================================
   * 道路火力点：由路径几何直接生成【沿道路两侧均匀分布的两排整齐点】。
   * 沿路径每 step 采样一次，向两侧法向各偏移 roadGap(62px)：
   *   - 每个点距路心恒 ≈62px，小于最短塔射程(125)——放塔必能打到路面，
   *     杜绝"放了塔也打不到怪"的白放点位；
   *   - 出界点、离路过近（<minPathDistance，拐弯处法向点可能贴到相邻
   *     路段）的点直接剔除，绝不压路面、不阻碍小怪行进；
   *   - 拐弯内侧两排过近的点按 minSpacing(56) 去重，保持整齐不堆叠。
   * 第 1 关新手教程使用更大的 tutorialCell（点更少、更简单）。
   * ============================================================ */
  buildHotspots() {
    const b = this.buildCfg;
    const gap = (b.roadGap != null) ? b.roadGap : 62;
    const step = (this.levelId === 1 && b.tutorialCell) ? b.tutorialCell : b.cell;
    const minSpacing = b.minSpacing || 56;
    const raw = [];
    for (const s of this.segments) {
      const n = Math.max(1, Math.round(s.len / step));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;                  // 段内均匀布点（避开拐角重合）
        const px = s.x1 + (s.x2 - s.x1) * t;
        const py = s.y1 + (s.y2 - s.y1) * t;
        const inv = 1 / s.len;                    // 单位法向量（垂直于路段）
        const nx = -(s.y2 - s.y1) * inv, ny = (s.x2 - s.x1) * inv;
        raw.push({ x: px + nx * gap, y: py + ny * gap });
        raw.push({ x: px - nx * gap, y: py - ny * gap });
      }
    }
    /* 全局筛选：画面边界内 + 避路硬校验 + HUD 安全禁区 + 最小间距去重 */
    this.hotspots = [];
    for (const p of raw) {
      if (p.x < b.edgeMargin || p.x > this.W - b.edgeMargin ||
          p.y < b.edgeMargin || p.y > this.H - b.edgeMargin) continue;
      if (this.distToPath(p.x, p.y) < b.minPathDistance) continue;
      if (this.inUiSafeZone(p.x, p.y)) continue;   // 避开顶部HUD/左下波次按钮（两端统一）
      if (this.isExcludedSpot(p.x, p.y)) continue; // 关卡专属排除点（JSON：build.excludeSpots）
      let dup = false;
      for (const h of this.hotspots) {
        if (Math.abs(h.x - p.x) < minSpacing && Math.abs(h.y - p.y) < minSpacing) { dup = true; break; }
      }
      if (dup) continue;
      const rx = Math.round(p.x), ry = Math.round(p.y);
      this.hotspots.push({ x: rx, y: ry, key: rx + '_' + ry, kind: 'road' });
    }

    /* 关卡专属额外火力点（JSON 驱动 build.extraSpots，仅部分关卡如第 3 关）：
       覆盖道路、不压路、避开 HUD 安全禁区、与已有热区去重，保证布局整齐不杂乱。
       新增塔位若落在 HUD 按钮区同样在此被拒绝（电脑/手机规则一致）。 */
    const extra = b.extraSpots || [];
    for (const p of extra) {
      if (p.x < b.edgeMargin || p.x > this.W - b.edgeMargin ||
          p.y < b.edgeMargin || p.y > this.H - b.edgeMargin) continue;
      if (this.distToPath(p.x, p.y) < b.minPathDistance) continue;
      if (this.inUiSafeZone(p.x, p.y)) continue;
      if (this.isExcludedSpot(p.x, p.y)) continue;   // 与自动点同一套排除规则
      let dup = false;
      for (const h of this.hotspots) {
        if (Math.abs(h.x - p.x) < minSpacing && Math.abs(h.y - p.y) < minSpacing) { dup = true; break; }
      }
      if (dup) continue;
      const rx = Math.round(p.x), ry = Math.round(p.y);
      this.hotspots.push({ x: rx, y: ry, key: rx + '_' + ry, kind: 'road' });
    }
  }

  /* ============================================================
   * 障碍物据点（琥珀色专属火力点）
   * 规则（全部 JSON 配置驱动，见 TD_CONFIG.obstacles）：
   *   - 每个障碍物附近【至少】有一个据点，据点距障碍物中心 ≤ coverRange，
   *     保证最短射程的塔（塔C 125，攻击口径 reach=射程+radius=145）直接
   *     放据点也一定打得到该障碍物；
   *   - 据点可以不覆盖道路（在环带内），但绝不压路面（distToPath 硬校验）；
   *   - 相邻障碍物在 spotShare 内共享同一据点，避免地图过挤；
   *   - 据点与已有道路点/据点保持 spotSpacing 间距，布局整齐不堆叠。
   * ============================================================ */

  /** 求离 (x,y) 最近的路径点（各线段投影取最小），用于据点朝路方向定位 */
  nearestPathPoint(x, y) {
    let bx = 0, by = 0, bd = Infinity;
    for (const s of this.segments) {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len2 = dx * dx + dy * dy;
      let t = ((x - s.x1) * dx + (y - s.y1) * dy) / len2;
      t = Phaser.Math.Clamp(t, 0, 1);
      const px = s.x1 + dx * t, py = s.y1 + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; bx = px; by = py; }
    }
    return { x: bx, y: by, d: bd };
  }

  buildObstacleSpots() {
    const oc = TD_CONFIG.obstacles;
    if (!oc || !oc.coverSpot) return;
    const b = this.buildCfg;
    const coverRange = oc.coverRange || 132;
    const coverGap = oc.coverGap || 92;
    const share = oc.spotShare || 112;
    const spacing = oc.spotSpacing || 50;

    /* 候选点合法性：界内 + 不压路 + 不落 HUD 安全禁区 + 与全部已有热区保持
       间距 + 不贴其他障碍物。
       minSpace 可放宽（首选失败时兜底），但避路/界内/禁区/覆盖距离永不放宽。 */
    const validSpot = (p, self, minSpace) => {
      if (p.x < b.edgeMargin || p.x > this.W - b.edgeMargin ||
          p.y < b.edgeMargin || p.y > this.H - b.edgeMargin) return false;
      if (this.distToPath(p.x, p.y) < b.minPathDistance) return false;
      if (this.inUiSafeZone(p.x, p.y)) return false;
      if (Math.hypot(p.x - self.x, p.y - self.y) > coverRange) return false;
      for (const h of this.hotspots) {
        if (Math.hypot(h.x - p.x, h.y - p.y) < minSpace) return false;
      }
      for (const o of this.obstacles) {
        if (o === self) continue;
        if (Math.hypot(o.x - p.x, o.y - p.y) < o.radius + 24) return false;
      }
      return true;
    };

    for (const ob of this.obstacles) {
      /* 1) 共享：已有据点若在 share（且不超 coverRange）内，直接复用 */
      let reused = false;
      for (const h of this.hotspots) {
        if (h.kind !== 'ob') continue;
        const d = Math.hypot(h.x - ob.x, h.y - ob.y);
        if (d <= Math.min(share, coverRange)) { reused = true; break; }
      }
      if (reused) continue;

      /* 2) 新据点：沿"朝路方向 + 沿路切向"生成候选扇区，首选朝路 coverGap、
            横向偏移最小的点（最整齐）；首选全失败再放宽热区间距兜底 */
      const foot = this.nearestPathPoint(ob.x, ob.y);
      let nx = foot.x - ob.x, ny = foot.y - ob.y;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;                       // 朝路单位法向
      const tx = -ny, ty = nx;                  // 沿路切向
      const dists = [coverGap, coverGap - 20, coverGap + 20, coverGap - 40,
                     coverGap + 40, coverGap - 60, coverGap + 60];
      const lats = [0, 26, -26, 52, -52, 80, -80, 104, -104];
      let picked = null;
      for (let pass = 0; pass < 2 && !picked; pass++) {
        const ms = pass === 0 ? spacing : spacing - 12;
        for (const d of dists) {
          for (const lat of lats) {
            const p = { x: ob.x + nx * d + tx * lat, y: ob.y + ny * d + ty * lat };
            if (validSpot(p, ob, ms)) { picked = p; break; }
          }
          if (picked) break;
        }
      }
      if (picked) {
        const rx = Math.round(picked.x), ry = Math.round(picked.y);
        this.hotspots.push({ x: rx, y: ry, key: rx + '_' + ry, kind: 'ob' });
      }
    }
  }

  /** 指针坐标吸附到最近热区（触摸/鼠标共用，保证点击与显示格子完全重合） */
  snapHotspot(x, y) {
    let best = null, bestD2 = Infinity;
    for (const h of this.hotspots) {
      const d2 = (h.x - x) * (h.x - x) + (h.y - y) * (h.y - y);
      if (d2 < bestD2) { bestD2 = d2; best = h; }
    }
    return best;
  }

  /* ============================================================
   * 地图绘制（卡通色块占位）
   * ============================================================ */
  drawGround() {
    const g = this.add.graphics().setDepth(0);
    /* 默认单一草地色块，去除棋盘格视觉，使整体画面更连贯 */
    g.fillStyle(TD_CONFIG.world.bgColors[0], 1);
    g.fillRect(0, 0, this.W, this.H);
    // 外圈加深一圈，强化关卡边界
    g.lineStyle(6, 0x6bb244, 1);
    g.strokeRect(3, 3, this.W - 6, this.H - 6);

    /* 放置模式专用图层：默认 alpha=0 完全隐藏，进入放置模式时淡入显示 */
    this.placementGridGfx = this.add.graphics().setDepth(2).setAlpha(0);
  }

  /* ============================================================
   * 可放置区域图层：每个合法放置点画一个【带边框的圆角方块】，
   * 视觉饱满、明显，且两类火力点颜色区分：
   *   - 道路火力点 kind='road'：绿色（放塔打路面）；
   *   - 障碍物据点 kind='ob'  ：琥珀色（专为打附近障碍物，可不覆盖路面）。
   * 不再铺满全图网格线，也不用旧的稀疏小绿圈。
   * ============================================================ */
  drawPlacementGrid() {
    const g = this.placementGridGfx;
    g.clear();
    const b = this.buildCfg;
    const size = b.spotSize || 36, r = b.spotRadius || 10;
    const drawSpot = (h, st) => {
      const x0 = h.x - size / 2, y0 = h.y - size / 2;
      g.fillStyle(st.fill, st.fillAlpha);
      g.fillRoundedRect(x0, y0, size, size, r);
      g.lineStyle(3, st.border, st.borderAlpha);
      g.strokeRoundedRect(x0, y0, size, size, r);
      /* 中心白色高光点，让方格更立体醒目（卡通感） */
      g.fillStyle(0xffffff, 0.85);
      g.fillCircle(h.x, h.y, 4);
    };
    for (const h of this.hotspots) {
      if (!this.canBuildAt(h.x, h.y, h.key)) continue;
      drawSpot(h, h.kind === 'ob' ? b.campSpot : b.roadSpot);
    }
  }

  /** 粗圆角线：线段 + 端点圆，兼容 Canvas / WebGL 渲染 */
  fatStroke(g, pts, width, color) {
    g.fillStyle(color, 1);
    for (let i = 0; i < pts.length - 1; i++) {
      g.lineStyle(width, color, 1);
      g.lineBetween(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    }
    for (const p of pts) g.fillCircle(p.x, p.y, width / 2);
  }

  drawPath() {
    const g = this.add.graphics().setDepth(1);
    const pcfg = this.levelCfg.path || {};
    const w = TD_CONFIG.world.pathWidth;
    const borderColor = (pcfg.borderColor != null) ? pcfg.borderColor : 0xc99a54;
    const fillColor = (pcfg.fillColor != null) ? pcfg.fillColor : 0xeac58f;

    /* 道路绘制：粗线 + 拐角同色圆点（经典稳健方案）。
       粗线保证宽度统一；拐角处同色 fillCircle 覆盖线段 miter 连接的尖角/缺口，
       实现圆润过渡（圆点与路面同色，视觉不可见，不产生多余圆圈）。
       多路线汇合/交叉处同色叠加无痕、无断层。
       先画全部描边层（更粗 w+10：线+点），再画全部路面层（更窄 w：线+点），
       描边在路面之下形成 5px 边缘。 */
    for (const rg of this.routeGeoms) {
      const wp = rg.waypoints;
      g.lineStyle(w + 10, borderColor, 1);
      g.beginPath();
      g.moveTo(wp[0].x, wp[0].y);
      for (let i = 1; i < wp.length; i++) g.lineTo(wp[i].x, wp[i].y);
      g.strokePath();
      g.fillStyle(borderColor, 1);
      for (let i = 0; i < wp.length; i++) g.fillCircle(wp[i].x, wp[i].y, (w + 10) / 2);
    }
    for (const rg of this.routeGeoms) {
      const wp = rg.waypoints;
      g.lineStyle(w, fillColor, 1);
      g.beginPath();
      g.moveTo(wp[0].x, wp[0].y);
      for (let i = 1; i < wp.length; i++) g.lineTo(wp[i].x, wp[i].y);
      g.strokePath();
      g.fillStyle(fillColor, 1);
      for (let i = 0; i < wp.length; i++) g.fillCircle(wp[i].x, wp[i].y, w / 2);
    }

    /* 起点（绿色传送门）：每条【出怪】路线各画一个（多出怪点）；
       waves.spawnRoutes 之外的路线（第 4 关传送后汇合段 route 2/3）
       不画出怪点，避免与传送门出口视觉冲突。缺省 = 全部路线（1~3 关兼容） */
    const spawnRoutes = (this.levelCfg.waves && this.levelCfg.waves.spawnRoutes) || null;
    for (let ri = 0; ri < this.routeGeoms.length; ri++) {
      if (spawnRoutes && spawnRoutes.indexOf(ri) === -1) continue;
      const st = this.routeGeoms[ri].waypoints[0];
      g.lineStyle(5, 0x3f9e34, 1); g.fillStyle(0x8be86b, 0.9);
      g.fillCircle(st.x, st.y, 26); g.strokeCircle(st.x, st.y, 26);
      g.fillStyle(0xffffff, 0.5); g.fillCircle(st.x - 4, st.y - 5, 7);
    }
    /* 终点城堡大门不在道路 Graphics 上画——由 drawCastleGates() 统一构建
       （门体精灵 + 点击热区 + 门旁血量牌），此处仅保留道路本身。 */
  }

  /** 终点洞穴绘制位置：钳进画面内（留洞穴半径余量），逻辑终点坐标不变 */
  goalDrawPos(x, y) {
    const m = 34;
    return {
      x: Phaser.Math.Clamp(x, m, this.W - m),
      y: Phaser.Math.Clamp(y, m, this.H - m)
    };
  }

  /** 本关全部终点大门的世界矩形（坐标去重，位置口径与 drawCastleGates 一致） */
  _gateWorldRects() {
    const cfg = TD_CONFIG.castleGate;
    if (!cfg || !this.routeGeoms || !this.routeGeoms.length) return [];
    const gw = cfg.width || 78;
    const tex = this.textures.exists('castle_gate')
      ? this.textures.get('castle_gate').getSourceImage() : null;
    const gh = tex ? gw * tex.height / tex.width : gw * 128 / 120;   // 贴图 120:128
    const bottomDy = cfg.bottomDy != null ? cfg.bottomDy : 14;

    const dps = [];
    const goals = this.levelCfg.goals;
    if (goals && goals.length) {
      for (const gl of goals) {
        const rg = this.routeGeoms[gl.route];
        if (!rg) continue;
        const wp = rg.waypoints[rg.waypoints.length - 1];
        dps.push(this.goalDrawPos(wp.x, wp.y));
      }
    } else {
      const rg = this.routeGeoms[this.routeGeoms.length - 1];
      const wp = rg.waypoints[rg.waypoints.length - 1];
      dps.push(this.goalDrawPos(wp.x, wp.y));
    }
    const out = [], seen = {};
    for (const dp of dps) {
      const k = dp.x + '_' + dp.y;
      if (seen[k]) continue;
      seen[k] = 1;
      out.push({ x: dp.x - gw / 2, y: dp.y + bottomDy - gh, w: gw, h: gh });
    }
    return out;
  }

  /** 终点大门是否与左下角波次按钮区（保守矩形）重叠：重叠则需让按钮上移 */
  _detectGateHudClash() {
    const z = (TD_CONFIG.castleGate.hudAvoid || {}).btnZone || { x: 0, y: 400, w: 300, h: 140 };
    for (const g of this._gateWorldRects()) {
      if (g.x < z.x + z.w && g.x + g.w > z.x && g.y < z.y + z.h && g.y + g.h > z.y) return true;
    }
    return false;
  }

  /* ============================================================
   * 终点城堡大门（终点标记 + 怪物进门 + 点击弹公主窗 + 门旁血量牌）
   *
   * 每个【不同终点位置】一座门（多路线同一坐标自动去重），位置沿用
   * goalDrawPos 钳制（逻辑终点坐标与漏怪判定完全不变）。routeGateMap
   * 记录每条路线 → 门，供怪物进门时选门与触发撞击反馈。
   * ============================================================ */
  drawCastleGates() {
    const cfg = TD_CONFIG.castleGate;
    this.castleGates = [];
    this.routeGateMap = {};
    if (!cfg || !this.textures.exists('castle_gate')) return;

    /* 收集每条路线终点（含 goals 配置关卡），坐标去重 */
    const goals = this.levelCfg.goals;
    const entries = [];
    if (goals && goals.length) {
      for (const gl of goals) {
        const rg = this.routeGeoms[gl.route];
        if (!rg) continue;
        const wp = rg.waypoints[rg.waypoints.length - 1];
        entries.push({ route: gl.route, dp: this.goalDrawPos(wp.x, wp.y) });
      }
    } else {
      const ri = this.routeGeoms.length - 1;
      const lastWp = this.routeGeoms[ri].waypoints;
      entries.push({ route: ri, dp: this.goalDrawPos(lastWp[lastWp.length - 1].x, lastWp[lastWp.length - 1].y) });
    }
    const seen = {};
    for (const en of entries) {
      const key = en.dp.x + '_' + en.dp.y;
      let gate = seen[key];
      if (!gate) {
        gate = this._buildCastleGate(en.dp.x, en.dp.y, cfg);
        seen[key] = gate;
        this.castleGates.push(gate);
      }
      this.routeGateMap[en.route] = gate;
    }
  }

  /** 建一座门：门体 + 白闪层 + 点击热区 + 门旁血量牌 */
  _buildCastleGate(dx, dy, cfg) {
    const tex = this.textures.get('castle_gate').getSourceImage();
    const gw = cfg.width;
    const gh = gw * tex.height / tex.width;
    const bottomY = dy + (cfg.bottomDy != null ? cfg.bottomDy : 14);

    const holder = this.add.container(dx, 0).setDepth((cfg.depth != null) ? cfg.depth : 10);

    /* 门体（origin 底中，钉在门底）；白闪副本（同尺寸白色 tint，恒透明） */
    const img = this.add.image(0, bottomY, 'castle_gate').setOrigin(0.5, 1).setDisplaySize(gw, gh);
    const flash = this.add.image(0, bottomY, 'castle_gate').setOrigin(0.5, 1).setDisplaySize(gw, gh)
      .setTintFill(0xffffff).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    holder.add([img, flash]);

    /* 点击热区（略大于门体，方便手指）：点击打开公主窗口 */
    const pad = cfg.hitPad != null ? cfg.hitPad : 10;
    const zone = this.add.zone(0, bottomY - gh / 2, gw + pad * 2, gh + pad * 2)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerdown', (p) => {
      /* 仅备战/战斗中可点（结算后大门不再弹窗）；暂停时也不弹 */
      if (this.paused || this.state === 'won' || this.state === 'lost') return;
      this.openPrincessPanel();
      /* 阻止冒泡到场景级 onPointerDown（否则会被当作"点道路"关掉浮框等，
         虽然无实质影响，这里显式拦掉保持语义干净） */
      if (p && p.event && p.event.stopPropagation) p.event.stopPropagation();
    });
    holder.add(zone);

    /* 门扇中心（怪物缩入点）：纹理上门扇中心约 (0.5, 0.71) 高 */
    const doorX = dx;
    const doorY = bottomY - gh * 0.36;

    /* 门旁血量牌：门在左半屏放右侧、右半屏放左侧；纵向避开顶/底 HUD */
    const badge = this._buildGateLivesBadge(dx, dy, gw, gh);

    return { x: dx, y: dy, gw, gh, bottomY, doorX, doorY, holder, img, flash, badge };
  }

  /** 门旁血量牌（❤️ 图标 + 数字，紧凑药丸形）；返回数字 Text 便于实时刷新 */
  _buildGateLivesBadge(dx, dy, gw, gh) {
    const side = (dx <= this.W / 2) ? 1 : -1;
    const bx = dx + side * (gw / 2 + 8 + 31);            // 31=药丸半宽
    const by = Phaser.Math.Clamp(dy - 12, 118, this.H - 20);
    const c = this.add.container(bx, by).setDepth(11);
    const PW = 62, PH = 27;
    const bg = this.add.graphics();
    bg.fillStyle(0xfffcf2, 0.92);
    bg.fillRoundedRect(-PW / 2, -PH / 2, PW, PH, 13);
    bg.lineStyle(2.5, 0xe36b7a, 0.9);
    bg.strokeRoundedRect(-PW / 2, -PH / 2, PW, PH, 13);
    const heart = this.add.image(-17, 0, 'heart_icon').setDisplaySize(19, 17);
    const num = this.add.text(6, 0, String(this.lives), {
      fontFamily: TD_FONT_STACK, fontSize: '17px', fontStyle: 'bold',
      color: '#d23b4e', resolution: TD_TEXT_RES
    }).setOrigin(0.5);
    c.add([bg, heart, num]);
    return num;
  }

  /** 大门被撞：水平短促抖动 + 白闪（tween 可重入，连续撞门不叠加错位） */
  hitCastleGate(gate) {
    if (!gate) return;
    const cfg = TD_CONFIG.castleGate;
    try { this.tweens.killTweensOf(gate.holder); } catch (e) {}
    gate.holder.x = gate.x;
    const dx = cfg.shakeDx || 3, ms = cfg.shakeMs || 42, rep = cfg.shakeRepeat != null ? cfg.shakeRepeat : 2;
    this.tweens.add({
      targets: gate.holder, x: gate.x + dx, duration: ms,
      yoyo: true, repeat: rep, ease: 'Sine.easeInOut',
      onComplete: () => { gate.holder.x = gate.x; }
    });
    const peak = cfg.flashAlpha != null ? cfg.flashAlpha : 0.55;
    gate.flash.setAlpha(peak);
    this.tweens.add({ targets: gate.flash, alpha: 0, duration: 240, ease: 'Sine.easeOut' });
  }

  /** 怪物进门：抬到大门图层之上，被门扇“吸入”——缩小+移向门扇中心+淡出，
   *  同时播放少量光点吸入粒子与门扇闪光（0.3~0.5s，castleGate.enterMs），
   *  完成后回调结算/销毁。大门抖动/白闪由 hitCastleGate 另行触发。 */
  playEnterGate(e, gate, onDone) {
    const finish = () => { if (onDone) onDone(); };
    if (!gate) { if (!e.removed) e.destroyImmediately(); finish(); return; }
    try { if (e.barBg) e.barBg.setVisible(false); } catch (err) {}
    e.setDepth(30);
    const ccfg = TD_CONFIG.castleGate || {};
    const ms = ccfg.enterMs || 380;
    /* 进门瞬间：少量金/白/浅蓝光点从怪物四周被吸向门扇中心 + 门扇闪光 */
    this.spawnGateEnterFx(gate, e.x, e.y);
    this.tweens.add({
      targets: e, x: gate.doorX, y: gate.doorY,
      scaleX: 0.12, scaleY: 0.12, alpha: 0, duration: ms, ease: 'Cubic.easeIn',
      onComplete: finish
    });
  }

  /** 进门特效：≤12 个光点（数量 JSON 驱动，手机端零压力）从敌人周围生成，
   *  各自向门扇中心飘移、缩小、淡出（被门“吸入”）；另放一次短促门扇柔光闪。
   *  光点 ADD 混合，金/白/浅蓝与大门、地图同色系。 */
  spawnGateEnterFx(gate, sx, sy) {
    const ccfg = TD_CONFIG.castleGate || {};
    const n = ccfg.enterParticles != null ? ccfg.enterParticles : 9;
    const ms = ccfg.particleMs || 340;
    const cx = gate ? gate.doorX : sx;
    const cy = gate ? gate.doorY : sy;
    const colors = [0xffe9a8, 0xffffff, 0x9fdcff];
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 16 + Math.random() * 18;
      const dot = this.add.circle(
        sx + Math.cos(ang) * r, sy + Math.sin(ang) * r,
        2 + Math.random() * 2.5, colors[i % colors.length], 0.95)
        .setDepth(31).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: dot, x: cx, y: cy, scale: 0.25, alpha: 0,
        duration: ms * (0.8 + Math.random() * 0.3), ease: 'Cubic.easeIn',
        onComplete: () => dot.destroy()
      });
    }
    /* 门扇中心短促柔光闪（扩散+淡出，~0.28s） */
    const fl = this.add.circle(cx, cy, 8, 0xfff3c4, 0.85)
      .setDepth(31).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: fl, scale: 4.2, alpha: 0, duration: 280,
      ease: 'Quad.easeOut', onComplete: () => fl.destroy()
    });
  }

  /* ============================================================
   * 公主窗口（点击大门弹出）：半透明压暗层 + 卡通悬浮面板，
   * 游戏继续运行（不暂停），点窗口外或右上 ✕ 关闭。
   * ============================================================ */
  openPrincessPanel() {
    if (this.princessPanel) return;                 // 已打开：不重复构建
    const cfg = TD_CONFIG.princess || {};
    const PW = cfg.panelW || 292, PH = cfg.panelH || 336;
    const layer = this.add.container(0, 0).setDepth(660);

    /* 半透明压暗层：点击窗口外关闭 */
    const backdrop = this.add.rectangle(0, 0, this.W, this.H, 0x2b1b30,
      cfg.backdropAlpha != null ? cfg.backdropAlpha : 0.42)
      .setOrigin(0, 0).setInteractive({ useHandCursor: true });
    backdrop.on('pointerdown', () => this.closePrincessPanel());
    layer.add(backdrop);

    /* 悬浮面板（奶油底 + 深棕描边，与选塔/升级面板同一套风格） */
    const panel = this.add.container(this.W / 2, this.H / 2);

    /* 面板自身吞掉点击，不透到压暗层/地图（最先加入，关闭按钮在其后可优先命中） */
    const pz = this.add.zone(0, 0, PW, PH).setInteractive();
    panel.add(pz);
    const pg = this.add.graphics();
    pg.fillStyle(0xfffcf2, 0.97);
    pg.fillRoundedRect(-PW / 2, -PH / 2, PW, PH, 18);
    pg.lineStyle(3, 0x4a3313, 0.85);
    pg.strokeRoundedRect(-PW / 2, -PH / 2, PW, PH, 18);
    /* 顶部粉色标题条 */
    pg.fillStyle(0xffd3e2, 0.95);
    pg.fillRoundedRect(-PW / 2, -PH / 2, PW, 44, { tl: 18, tr: 18, bl: 0, br: 0 });
    pg.fillRect(-PW / 2, -PH / 2 + 22, PW, 22);
    panel.add(pg);

    const title = this.add.text(0, -PH / 2 + 22, '🏰 公主殿下', {
      fontFamily: TD_FONT_STACK, fontSize: '18px', fontStyle: 'bold',
      color: '#8a3a5c', resolution: TD_TEXT_RES
    }).setOrigin(0.5);
    panel.add(title);

    /* 关闭按钮（右上红圆 ✕，热区放大） */
    const cbg = this.add.graphics();
    cbg.fillStyle(0xff7d8d, 1); cbg.fillCircle(PW / 2 - 16, -PH / 2 + 16, 12);
    cbg.lineStyle(2, 0xc04055, 0.9); cbg.strokeCircle(PW / 2 - 16, -PH / 2 + 16, 12);
    const ctxt = this.add.text(PW / 2 - 16, -PH / 2 + 16, '✕', {
      fontFamily: TD_FONT_STACK, fontSize: '14px', fontStyle: 'bold',
      color: '#ffffff', resolution: TD_TEXT_RES
    }).setOrigin(0.5);
    const czone = this.add.zone(PW / 2 - 16, -PH / 2 + 16, 34, 34)
      .setInteractive({ useHandCursor: true });
    czone.on('pointerdown', () => this.closePrincessPanel());
    panel.add([cbg, ctxt, czone]);

    /* 公主图片：完整居中（浅粉底框衬边）；无贴图时用文字占位，绝不报错 */
    const imgSize = cfg.imgSize || 240;
    const imgY = -PH / 2 + 64 + imgSize / 2;
    const frame = this.add.graphics();
    frame.fillStyle(0xffe9f1, 1);
    frame.fillRoundedRect(-imgSize / 2 - 7, imgY - imgSize / 2 - 7, imgSize + 14, imgSize + 14, 12);
    frame.lineStyle(2.5, 0xf0a7c0, 0.95);
    frame.strokeRoundedRect(-imgSize / 2 - 7, imgY - imgSize / 2 - 7, imgSize + 14, imgSize + 14, 12);
    panel.add(frame);
    if (this.textures.exists('princess')) {
      const pimg = this.add.image(0, imgY, 'princess').setDisplaySize(imgSize, imgSize);
      /* 圆角遮罩：独立 Graphics 不进渲染列表，仅作几何蒙板，世界坐标绘制；
         面板居中于世界中心且不缩放，pimg 世界位置 = (W/2, H/2+imgY) 恰对齐 */
      const mask = this.make.graphics({ x: 0, y: 0, add: false });
      mask.fillStyle(0xffffff, 1);
      mask.fillRoundedRect(this.W / 2 - imgSize / 2, this.H / 2 + imgY - imgSize / 2, imgSize, imgSize, 8);
      pimg.setMask(mask.createGeometryMask());
      panel.add(pimg);
    } else {
      panel.add(this.add.text(0, imgY, '（公主图片未就绪）', {
        fontFamily: TD_FONT_STACK, fontSize: '14px', color: '#a07088', resolution: TD_TEXT_RES
      }).setOrigin(0.5));
    }

    const hint = this.add.text(0, PH / 2 - 18, '点击窗口外关闭', {
      fontFamily: TD_FONT_STACK, fontSize: '12px', color: '#9a8266', resolution: TD_TEXT_RES
    }).setOrigin(0.5);
    panel.add(hint);

    /* 弹出小动画：纯淡入（无缩放，保证圆角蒙板始终对齐） */
    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 160, ease: 'Sine.easeOut' });

    layer.add(panel);
    this.princessPanel = layer;
  }

  closePrincessPanel() {
    if (!this.princessPanel) return;
    const layer = this.princessPanel;
    this.princessPanel = null;
    this.tweens.add({
      targets: layer, alpha: 0, duration: 120, ease: 'Sine.easeIn',
      onComplete: () => { try { layer.destroy(); } catch (e) {} }
    });
  }

  /* ============================================================
   * 传送门（第 4 关机制，全部 JSON 驱动：levelCfg.portals）
   *
   * 数据模型：pairs[] 每对含 a（入口）/b（出口）两个「路线号+路径点索引」，
   * buildPortals 预解析为沿路里程（entryDist/exitDist）与世界坐标。
   *   - direction "oneway"：仅 A→B；"bidirectional"：A↔B 双向各生效一次。
   * 传送在 Enemy.update 推进 pathDist 后检测：当前进【跨越】入口里程时，
   * 把敌人 pathDist 跳到出口里程（可跨路线），位置恒为路径上的点，不脱轨；
   * 每个传送规则对每只怪只生效一次（enemy.usedPortals），向后传送/双向
   * 都不会死循环；传送后给 invulnTime(0.5s) 无敌且不可被索敌。
   * 与塔D：传送优先——传送瞬间清空 pullBack 位移场，出口处重新被索敌后
   * 才继续吸引。
   * ============================================================ */
  buildPortals() {
    this.portals = [];
    this.portalEndpoints = [];
    const pc = this.levelCfg.portals;
    if (!pc || !Array.isArray(pc.pairs)) return;

    /* 「路线号+路径点索引」→ { route, dist(沿路累计里程), x, y }；
       索引即路径点，坐标几何上恒在道路中心线上，绝不会传到道路外 */
    const resolve = (ep) => {
      const route = ep.route || 0;
      const rg = this.routeGeoms[route];
      if (!rg) return null;
      const wi = Phaser.Math.Clamp(ep.waypoint, 0, rg.waypoints.length - 1);
      const wp = rg.waypoints[wi];
      let dist = 0;
      for (let i = 0; i < wi; i++) dist += rg.segments[i].len;
      return { route, waypoint: wi, dist, x: wp.x, y: wp.y };
    };

    /* 同色配对调色板：一对传送门（入口+出口）用同一颜色，不同对用不同颜色，
       方便玩家靠颜色分辨哪两个是一对，不再依赖 A/B/C/D 字母 */
    const pairColors = [0xff5ad1, 0x4be0ff, 0xffd23b, 0x6fe05f, 0xb07bea];
    const drawn = {};
    pc.pairs.forEach((pair, pi) => {
      const a = resolve(pair.a);
      const b = resolve(pair.b);
      if (!a || !b) return;
      const pid = pair.id || 'p';
      const affectBoss = pair.affectBoss !== false;
      const color = pairColors[pi % pairColors.length];
      this.portals.push({
        key: pid + '>A',
        entryRoute: a.route, entryDist: a.dist, entryX: a.x, entryY: a.y,
        exitRoute: b.route, exitDist: b.dist, affectBoss: affectBoss,
        color: color
      });
      if (pair.direction === 'bidirectional') {
        this.portals.push({
          key: pid + '>B',
          entryRoute: b.route, entryDist: b.dist, entryX: b.x, entryY: b.y,
          exitRoute: a.route, exitDist: a.dist, affectBoss: affectBoss,
          color: color
        });
      }
      /* 视觉端点去重（双向时 A/B 各只画一次）；同对入口/出口同色，不再带字母标签 */
      const ka = a.route + ':' + a.waypoint, kb = b.route + ':' + b.waypoint;
      if (!drawn[ka]) { drawn[ka] = 1; this.portalEndpoints.push({ x: a.x, y: a.y, role: 'a', color: color }); }
      if (!drawn[kb]) { drawn[kb] = 1; this.portalEndpoints.push({ x: b.x, y: b.y, role: 'b', color: color }); }
    });
  }

  /** 传送门卡通外观：呼吸光晕 + 双环反向旋转 + 脉冲核心 + 环绕粒子（同对同色，无字母） */
  drawPortals() {
    if (!this.portalEndpoints || this.portalEndpoints.length === 0) return;
    for (const ep of this.portalEndpoints) {
      const color = ep.color || (ep.role === 'a' ? 0xff5ad1 : 0x4be0ff); // 同对同色
      const c = this.add.container(ep.x, ep.y).setDepth(6);

      /* 底盘光晕（呼吸） */
      const glow = this.add.graphics();
      glow.fillStyle(color, 0.16).fillCircle(0, 0, 32);
      glow.fillStyle(color, 0.10).fillCircle(0, 0, 24);
      this.tweens.add({ targets: glow, alpha: 0.55, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

      /* 外环：三段弧整体匀速旋转 */
      const ringA = this.add.graphics();
      ringA.lineStyle(4, color, 0.95);
      for (let i = 0; i < 3; i++) {
        const s = -Math.PI / 2 + i * (Math.PI * 2 / 3);
        ringA.beginPath();
        ringA.arc(0, 0, 22, s + 0.18, s + Math.PI / 3 - 0.18);
        ringA.strokePath();
      }
      this.tweens.add({ targets: ringA, angle: 360, duration: 2400, repeat: -1, ease: 'Linear' });

      /* 内环：两段白弧反向旋转 */
      const ringB = this.add.graphics();
      ringB.lineStyle(3, 0xffffff, 0.9);
      for (let i = 0; i < 2; i++) {
        const s = i * Math.PI;
        ringB.beginPath();
        ringB.arc(0, 0, 15, s + 0.3, s + Math.PI - 0.3);
        ringB.strokePath();
      }
      this.tweens.add({ targets: ringB, angle: -360, duration: 1700, repeat: -1, ease: 'Linear' });

      /* 中心旋涡核心（脉冲缩放） */
      const core = this.add.graphics();
      core.fillStyle(0xffffff, 0.9).fillCircle(0, 0, 8);
      core.fillStyle(color, 0.55).fillCircle(0, 0, 5);
      this.tweens.add({ targets: core, scale: 1.35, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

      /* 环绕粒子：两圈亮点反向公转 */
      const spark = this.add.container(0, 0);
      for (let i = 0; i < 4; i++) {
        const ang = i * Math.PI / 2;
        const d = this.add.graphics();
        d.fillStyle(0xffffff, 0.95).fillCircle(0, 0, 2.8);
        d.setPosition(Math.cos(ang) * 27, Math.sin(ang) * 27);
        spark.add(d);
      }
      this.tweens.add({ targets: spark, angle: 360, duration: 1500, repeat: -1, ease: 'Linear' });
      const spark2 = this.add.container(0, 0);
      for (let i = 0; i < 3; i++) {
        const ang = i * (Math.PI * 2 / 3) + 0.5;
        const d = this.add.graphics();
        d.fillStyle(color, 0.9).fillCircle(0, 0, 2.2);
        d.setPosition(Math.cos(ang) * 27, Math.sin(ang) * 27);
        spark2.add(d);
      }
      this.tweens.add({ targets: spark2, angle: -360, duration: 1100, repeat: -1, ease: 'Linear' });

      c.add([glow, ringA, ringB, core, spark, spark2]);
    }
  }

  /**
   * 传送检测：Enemy.update 沿路推进后调用。
   * @param {Enemy} e           敌人（可能被原地改写 routeId/pathDist）
   * @param {number} distBefore 本帧推进前的真实沿路里程（塔D 位移已烘焙）
   * 仅【前进跨越】入口里程触发；塔D 回拉导致的倒退不触发。
   */
  checkPortalTeleport(e, distBefore) {
    if (!this.portals || this.portals.length === 0) return;
    for (const p of this.portals) {
      if (p.entryRoute !== e.routeId) continue;
      if (!p.affectBoss && e.cfg && e.cfg.boss) continue;
      if (e.usedPortals && e.usedPortals[p.key]) continue;
      if (distBefore < p.entryDist && e.pathDist >= p.entryDist) {
        if (!e.usedPortals) e.usedPortals = {};
        e.usedPortals[p.key] = true;
        const from = { x: p.entryX, y: p.entryY };

        /* 传送优先于塔D：清空吸附位移场与本帧标记，出口处由塔重新索敌 */
        e.pullBack = 0;
        e.pullDX = 0;
        e.pullDY = 0;
        e.pullFresh = false;

        /* 跳到出口里程（支持跨路线），clamp 保证不越界，渲染点恒在路径上 */
        e.routeId = p.exitRoute;
        e.pathDist = Phaser.Math.Clamp(p.exitDist, 0, this.routeLength(p.exitRoute));

        /* 0.5s 无敌 + 不可选中（索敌/伤害均跳过），避免刚出现就被秒或卡住 */
        const inv = (this.levelCfg.portals && this.levelCfg.portals.invulnTime) || 0.5;
        e.invulnTimer = inv;
        e.body.setAlpha(0.55);
        e.setScale(0.45);
        this.tweens.add({ targets: e, scaleX: 1, scaleY: 1, duration: 260, ease: 'Back.out' });

        const to = this.pathPointAt(e.pathDist, e.routeId);
        this.playPortalTeleportFx(from, { x: to.x, y: to.y }, p.color);
        return;
      }
    }
  }

  /** 传送瞬间特效：入口/出口各一次扩散光环 + 放射星点（同对同色） */
  playPortalTeleportFx(from, to, color) {
    const c = color || 0xff5ad1;
    this.makePortalBurst(from.x, from.y, c);
    this.makePortalBurst(to.x, to.y, c);
  }

  makePortalBurst(x, y, color) {
    const ring = this.add.graphics().setDepth(200);
    ring.lineStyle(4, color, 0.95).strokeCircle(0, 0, 12);
    ring.fillStyle(0xffffff, 0.85).fillCircle(0, 0, 8);
    ring.setPosition(x, y);
    this.tweens.add({
      targets: ring, scaleX: 3.2, scaleY: 3.2, alpha: 0,
      duration: 360, ease: 'Quad.out', onComplete: () => ring.destroy()
    });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const dot = this.add.graphics().setDepth(200);
      dot.fillStyle(0xffffff, 0.9).fillCircle(0, 0, 3.2);
      dot.setPosition(x, y);
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(ang) * 34, y: y + Math.sin(ang) * 34,
        alpha: 0, scale: 0.3, duration: 380, ease: 'Quad.out',
        onComplete: () => dot.destroy()
      });
    }
  }

  drawDecor() {
    // 固定种子的伪随机，保证每次刷新布局一致
    let seed = 20260920;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const keys = ['decor_bush', 'decor_bush', 'decor_flower', 'decor_rock'];
    for (let i = 0; i < 40; i++) {
      const x = 20 + rnd() * (this.W - 40);
      const y = 20 + rnd() * (this.H - 40);
      if (this.distToPath(x, y) < 46) continue; // 不压在路面上
      /* 避开障碍物：小装饰不与石头/树/木桶叠在一起 */
      let nearOb = false;
      for (const o of this.obstacles) {
        if (Math.abs(o.x - x) < 52 && Math.abs(o.y - y) < 52) { nearOb = true; break; }
      }
      if (nearOb) continue;
      /* 避开火力点：花草石头不盖住圆角方格、不干扰放塔点击（热区在方格内） */
      let nearSpot = false;
      for (const h of this.hotspots) {
        if (Math.hypot(h.x - x, h.y - y) < 28) { nearSpot = true; break; }
      }
      if (nearSpot) continue;
      const key = keys[Math.floor(rnd() * keys.length)];
      const img = this.add.image(x, y, key).setDepth(2);
      img.setScale(0.8 + rnd() * 0.5);
      img.setAlpha(0.95);
    }
  }

  /* ============================================================
   * 主循环
   * ============================================================ */
  update(time, delta) {
    // 火塔燃烧视频帧上传共享纹理（内部仅在有火塔且未暂停时工作，每帧最多3次）
    try { FIRE_BURN.tick(); } catch (e) {}
    // 风塔龙卷风视频帧上传共享纹理（全场 1 次，三塔共用同一纹理）
    try { WIND_VIDEO.tick(); } catch (e) {}
    /* 史莱姆共享视频：每帧把当前视频帧上传到共享 GL 纹理（全场 1 次，
       仅场上有史莱姆且视频在播时才上传，控制手机端开销） */
    try { SLIME_VIDEO.tick(); } catch (e) {}
    /* BOSS 运动视频 / 死亡视频：tick 内把当前视频帧手动上传到 GL 纹理
       （Phaser 3.80 裸视频纹理不自动上传，不 update 画面会停在首帧）；
       仅在有 BOSS / 有死亡视频播放时才实际工作，控制手机端开销 */
    try { BOSS_VIDEO.tick(); } catch (e) {}
    try { BOSS_DEATH.tick(); } catch (e) {}
    // 暂停或结算时冻结全部逻辑（画面保持）
    const rawDt = Math.min(delta, 50) / 1000;
    const dt = (this.paused || this.state === 'won' || this.state === 'lost')
      ? 0 : rawDt * this.speedMul;

    if (dt > 0) {
      this.updateWaves(dt);

      /* 第 8 关：风眼计时 / 风蚀增伤倒计时 / 火焰路径区域结算（暂停即冻结） */
      if (this.level8) this.level8.tick(dt);

      const ctx = {
        enemies: this.enemies,
        fire: (tower, target) => this.fireProjectile(tower, target),
        /* 塔D 范围吸引脉冲：开窗瞬间由 PullBehavior 回调一次，targets 为本脉冲
           锁定的全部小怪，播放多目标攻击动画（纯视觉，不写数值/伤害） */
        pullPulse: (tower, range, targets) => this.playPullPulse(tower, range, targets),
        /* 塔E 电链弹跳：由 ChainBehavior 回调，绘制折线闪电连线 + 被击中怪高亮 */
        spawnChainFx: (points, color, duration) => this.spawnChainFx(points, color, duration)
      };
      /* 塔先于敌更新：塔D（PullBehavior）先标记 pullFresh/写位移，敌再据其位移；
         普通 AttackBehavior 同样先于敌，1 帧索敌延迟不可见 */
      for (const t of this.towers) t.update(dt, ctx);

      for (const e of this.enemies) e.update(dt);
      this.enemies = this.enemies.filter((e) => !e.removed);

      /* 集火目标维护：已死亡/进门/被移除 → 自动取消（塔下帧恢复默认索敌）；
         仍存活 → 光圈每帧钉在怪物身上跟随移动 */
      if (this.focusEnemy) {
        const fe = this.focusEnemy;
        if (fe.dead || fe.removed) this.clearFocusEnemy();
        else if (this._focusMarker) this._focusMarker.setPosition(fe.x, fe.y);
      }

      /* 障碍物：被摧毁的从场上下排在销毁动画结束后移除（本体已 dead） */
      this.obstacles = this.obstacles.filter((o) => !o.dead);

      for (const p of this.projectiles) p.update(dt);
      this.projectiles = this.projectiles.filter((p) => !p.done);

      /* 一波结束判定：不再出怪且场上无敌人。
         支线波进行中（activeSideWave）走独立清场逻辑，主波编号不递增。 */
      if (this.state === 'active' && this.spawnIdx >= this.spawnList.length && this.enemies.length === 0) {
        if (this.activeSideWave) this.onSideWaveCleared();
        else this.onWaveCleared();
      }
    }

    this.syncHud();
  }

  /* ============================================================
   * 波次状态机
   * ============================================================ */
  updateWaves(dt) {
    if (this.state === 'ready' && this.countdown !== null) {
      this.countdown -= dt;
      if (this.countdown <= 0) this.startWave();
    } else if (this.state === 'active') {
      this.spawnClock += dt;
      while (this.spawnIdx < this.spawnList.length && this.spawnList[this.spawnIdx].t <= this.spawnClock) {
        this.spawnEnemy(this.spawnList[this.spawnIdx]);
        this.spawnIdx++;
      }
    }
  }

  startWave() {
    if (this.state !== 'ready') return;
    this.clearPlacementHighlight();   // 点"开始波次"按钮（DOM UI）时清掉残留高亮
    const wcfg = this.levelCfg.waves;
    const groups = wcfg.list[this.waveIndex];
    const routeCount = this.routeGeoms.length;
    /* 出怪路线：JSON 可配 waves.spawnRoutes（如第 4 关双出怪路线 [0,1]，
       route 2/3 为传送后汇合段不出怪）；缺省 = 全部路线（第 1~3 关兼容）。
       第 1 波仅首条出怪路线出怪（JSON 驱动 firstWaveRouteOnly，第 3 关用），
       其余波次全部出怪路线同时出怪。单路线关卡 routeCount=1，无影响。 */
    let routeIds = (wcfg.spawnRoutes && wcfg.spawnRoutes.length)
      ? wcfg.spawnRoutes.slice() : [];
    if (routeIds.length === 0) {
      for (let r = 0; r < routeCount; r++) routeIds.push(r);
    }
    if (this.waveIndex === 0 && wcfg.firstWaveRouteOnly) routeIds = routeIds.slice(0, 1);
    this.spawnList = this.expandWaveSpawns(groups, routeIds, null);
    /* 第 4 关「右侧岔路追加批次」（JSON 驱动 waves.branchSpawns）：
       从 startWave（2）起，每波主波出怪表上再追加一批仅走岔路 routes 的
       小怪（第 1 波 list[0]=null 不追加）。与主波同场出怪、同场清场；
       hpWaveIndex 留空 → 自动按当前波 waveSmallHp 计算，与主波同血量水平。
       其他关卡无 branchSpawns，零影响。 */
    const bs = wcfg.branchSpawns;
    if (bs && bs.list && this.waveIndex + 1 >= (bs.startWave || 2)) {
      const bGroups = bs.list[this.waveIndex];
      if (bGroups && bGroups.length) {
        /* JSON 驱动数量加成：branchSpawns.countBonus（如 3 = 每组 +3 只） */
        const cb = bs.countBonus || 0;
        const adjusted = cb ? bGroups.map(function(g) { return Object.assign({}, g, { count: g.count + cb }); }) : bGroups;
        const bEntries = this.expandWaveSpawns(adjusted, bs.routes || [2], null);
        /* JSON 驱动加速：branchSpawns.speedBonus（如 0.10 = +10%）仅作用于
           这批右侧岔路追加怪，主波出怪不受影响（entry 无 speedBonus 字段） */
        const sb = bs.speedBonus || 0;
        if (sb) bEntries.forEach(function(e) { e.speedBonus = sb; });
        this.spawnList = this.spawnList.concat(bEntries);
        this.spawnList.sort((a, b) => a.t - b.t);
      }
    }
    /* 末波右侧额外追加一批（JSON 驱动 finalWaveExtraGroups，仅第 4 关第 5 波）：
       仅 route 1 出怪，不替代 BOSS（BOSS 按 delay 排序仍在最后出现） */
    if (this.waveIndex === wcfg.list.length - 1 && wcfg.finalWaveExtraGroups) {
      const fwe = this.expandWaveSpawns(wcfg.finalWaveExtraGroups, [1], null);
      this.spawnList = this.spawnList.concat(fwe);
      this.spawnList.sort((a, b) => a.t - b.t);
    }
    this.spawnIdx = 0;
    this.spawnClock = 0;
    this.countdown = null;
    this.state = 'active';
    this.banner('第 ' + (this.waveIndex + 1) + ' 波 开始！', 0xfff2a0);
  }

  /** 把波次 groups 按路线展开成定时出怪表并按时间排序（主波 / 支线波共用）。
   *  sideDef 非空 = 支线波：entry.hpWaveIndex 覆盖当波血量索引（JSON 驱动，
   *  如第 4 关岔路奇兵按第 3 波血量水平出怪），route 集取支线自己的 routes。 */
  expandWaveSpawns(groups, routeIds, sideDef) {
    const list = [];
    groups.forEach((grp) => {
      for (const r of routeIds) {
        for (let i = 0; i < grp.count; i++) {
          list.push({
            t: grp.delay + i * grp.interval,
            type: grp.type,
            route: r,
            bossHpFactor: grp.bossHpFactor,
            hpWaveIndex: sideDef ? sideDef.hpWaveIndex : null,
            /* 第 7 关：组内序号 + BOSS 变体图案（金/蓝/灰按出怪序号分配，
               左右两路各自独立从 pattern[0] 开始）；旧关卡无此字段恒 null */
            variantIndex: i,
            bossVariantPattern: grp.bossVariantPattern || null,
            /* 第 8 关精英标记（第 7 波大体型高血量基础史莱姆，JSON 驱动）；
               旧关卡组无这些字段，恒 undefined，零影响 */
            elite: grp.elite || false,
            eliteHpMul: grp.eliteHpMul,
            eliteScale: grp.eliteScale,
            eliteGoldBonus: grp.eliteGoldBonus
          });
        }
      }
    });
    list.sort((a, b) => a.t - b.t);
    return list;
  }

  /** 查找“刚清场的主波（1 基编号）”之后应播放的支线波（JSON 驱动，仅一次） */
  findSideWaveAfter(clearedWave1Based) {
    const defs = this.levelCfg.waves.sideWaves;
    if (!defs || !defs.length) return null;
    for (const def of defs) {
      if (def.afterWave === clearedWave1Based && !this.sideWavesDone[def.id]) return def;
    }
    return null;
  }

  /** 开启支线波：仅在 def.routes（如第 4 关 [2]=右侧岔路）上出怪，
   *  主波编号不递增，HUD 波次仍指向下一个主波；清场后回到下一波倒计时。 */
  startSideWave(def) {
    this.activeSideWave = def;
    this.spawnList = this.expandWaveSpawns(def.groups, def.routes, def);
    this.spawnIdx = 0;
    this.spawnClock = 0;
    this.countdown = null;
    this.state = 'active';
    this.banner(def.banner || '奇兵来袭！', 0xff9de0);
  }

  /** 支线波清场：独立金币奖励 → 进入下一个主波的常规倒计时 */
  onSideWaveCleared() {
    const def = this.activeSideWave;
    this.sideWavesDone[def.id] = 1;
    this.activeSideWave = null;
    if (def.clearBonus) {
      this.gold += def.clearBonus;
      this.banner('岔路清场奖励 +' + def.clearBonus + ' 金币', 0xbef78a);
    }
    this.state = 'ready';
    this.countdown = this.levelCfg.waves.intermission;
  }

  onWaveCleared() {
    const wcfg = this.levelCfg.waves;
    const bonus = wcfg.clearBonus[this.waveIndex] || 0;
    this.gold += bonus;
    /* 第 1 波结束额外一次性奖励（JSON 驱动 firstWaveClearBonus，仅第 1 波触发） */
    const firstBonus = (this.waveIndex === 0 && wcfg.firstWaveClearBonus) ? wcfg.firstWaveClearBonus : 0;
    if (firstBonus) this.gold += firstBonus;
    this.waveIndex++;
    if (this.waveIndex >= wcfg.list.length) {
      this.endGame(true);
      return;
    }
    /* 支线波（第 4 关右侧岔路奇兵）：本主波清场后若配置了未播放的支线波，
       先插入支线波（左路不出怪），清场后再进入下一波主波倒计时 */
    const sideDef = this.findSideWaveAfter(this.waveIndex);
    if (sideDef) {
      this.startSideWave(sideDef);
      return;
    }
    this.state = 'ready';
    this.countdown = wcfg.intermission;
    if (firstBonus) {
      this.banner('清场 +' + bonus + '  首波通关 +' + firstBonus + ' 金币', 0xbef78a);
    } else {
      this.banner('清场奖励 +' + bonus + ' 金币', 0xbef78a);
    }
  }

  /* 小怪当波血量（JSON 驱动，见 waves 配置）：
     - 常规波：round(baseHp × hpGrowth^waveIndex)（hpGrowth=1.5 即每波 +50%，复合）；
     - 末波默认特例：先按公式取整得到第 N-1 波（第 4 波）血量，再 × finalWaveHpFactor(=2)
       ——严格等于"第 4 波实际血量的两倍"，避免连乘带来的 1 点舍入偏差；
     - 第 3 关设 finalWaveSpecial=false：不走末波翻倍，全程纯复合 +50%
       （第 5 波 = base × 1.5^4，与"每波比前波 +50%"完全一致）；
     - idxOverride：支线波（第 4 关右侧岔路奇兵）显式指定血量波次索引，
       与主波编号解耦（hpWaveIndex=2 即按第 3 波水平，比第 2 波 +60%）。 */
  waveSmallHp(baseHp, idxOverride) {
    const wcfg = this.levelCfg.waves;
    const total = wcfg.list.length;
    const growth = (wcfg.hpGrowth != null ? wcfg.hpGrowth : 1.5);
    const wi = (idxOverride != null) ? idxOverride : this.waveIndex;
    const special = (wcfg.finalWaveSpecial !== false); // 缺省 true：末波走特例翻倍
    if (special && total >= 2 && wi === total - 1) {
      const prevHp = Math.round(baseHp * Math.pow(growth, wi - 1));
      return Math.round(prevHp * (wcfg.finalWaveHpFactor != null ? wcfg.finalWaveHpFactor : 2));
    }
    return Math.round(baseHp * Math.pow(growth, wi));
  }

  /* 当前波次对应的 BOSS 变体（三种 BOSS：金/蓝/灰，全部 JSON 驱动）
     读取 TD_CONFIG.boss：
       variants   : [{ key, tex, hpMul, speed, leakMul, reward }, ...]
       waveVariant: { "<波次索引>": <变体下标> }（0 起；表外回退下标 0）
     返回变体对象（含 tex 贴图键），无配置时返回 null（走程序化占位贴图）。 */
  bossVariantAt(waveIdx) {
    const b = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.boss) || null;
    if (!b || !b.variants || !b.variants.length) return null;
    const map = b.waveVariant || {};
    const vi = (waveIdx != null && map[String(waveIdx)] != null) ? map[String(waveIdx)] : 0;
    return b.variants[vi] || b.variants[0] || null;
  }

  /* 本次出怪使用的 BOSS 变体（第 7 关支持关卡级配置，旧关卡回退全局表）：
     1) entry.bossVariantPattern（第 5 波金/蓝/灰图案）：按组内序号取色，
        左右两路各自从图案第 0 项开始；
     2) waves.bossWaveVariant（关卡级 波次索引→变体 key，第 7 关第 2~4 波）；
     3) 回退全局 bossVariantAt（第 1~6 关原逻辑，零变化）。 */
  resolveBossVariant(entry) {
    const wcfg = this.levelCfg && this.levelCfg.waves;
    const variants = (TD_CONFIG.boss && TD_CONFIG.boss.variants) || [];
    const byKey = (key) => {
      for (const v of variants) { if (v.key === key) return v; }
      return null;
    };
    if (wcfg) {
      const pattern = entry.bossVariantPattern;
      if (pattern && pattern.length) {
        const key = pattern[(entry.variantIndex || 0) % pattern.length];
        const v = byKey(key);
        if (v) return v;
      }
      const waveMap = wcfg.bossWaveVariant;
      if (waveMap && waveMap[String(this.waveIndex)] != null) {
        const v = byKey(waveMap[String(this.waveIndex)]);
        if (v) return v;
      }
    }
    return this.bossVariantAt(this.waveIndex);
  }

  /* 敌人出生：按波数成长缩放血量（规则见 waveSmallHp）；
     BOSS 血量 = 同波小怪(enemyX)血量 × bossFactor，bossFactor 优先级：
     group.bossHpFactor（per-group，第 3 关第 3/4 波 16×/第 5 波 40×，
     第 4 关第 3/4 波 16×/第 5 波 50×）
     > wcfg.finalBossHpFactor（末波兜底） > boss.hpMultiplier（全局兜底）；
     漏血 = enemyX.leakDamage × boss.leakMultiplier（普通怪的 3 倍）。
     entry.route 指定敌人所属路线（多路线关卡），缺省 0。 */
  spawnEnemy(entry) {
    const typeKey = entry.type;
    const routeId = entry.route || 0;
    /* 三种 BOSS 按波次接入（JSON 驱动 TD_CONFIG.boss.variants / waveVariant）：
       第 3/4/5 波(索引 2/3/4) = 金/蓝/灰 BOSS，同关内三种依次登场 */
    const isBossType = !!(TD_CONFIG.enemies[typeKey] && TD_CONFIG.enemies[typeKey].boss);
    /* 第 8 关新增怪物类注册表（Level8Enemies.js）：命中则用专属子类
       （代码绘制外观 + 专属机制/状态机）；其余关卡与类型通配 Enemy，零影响 */
    const Cls = (typeof LEVEL8_ENEMY_CLASSES !== 'undefined' && LEVEL8_ENEMY_CLASSES[typeKey])
      ? LEVEL8_ENEMY_CLASSES[typeKey] : Enemy;
    /* noVariant=true（熔岩巨兽）：不接入金/蓝/灰 BOSS 变体
       （贴图/移速/金币走 lavaBoss 自身配置，血量仍按小怪×bossFactor） */
    const noVariant = !!(TD_CONFIG.enemies[typeKey] && TD_CONFIG.enemies[typeKey].noVariant);
    const bv = (isBossType && !noVariant) ? this.resolveBossVariant(entry) : null;
    const e = new Cls(this, typeKey, routeId, (bv && bv.tex) ? { bossTexKey: bv.tex } : null);
    const isBoss = !!e.cfg.boss;
    if (isBoss) {
      const wcfg = this.levelCfg.waves;
      const bossCfg = TD_CONFIG.boss || { hpMultiplier: 8, leakMultiplier: 3 };
      let bossFactor;
      if (entry.bossHpFactor != null) bossFactor = entry.bossHpFactor;
      else if (wcfg.finalBossHpFactor != null) bossFactor = wcfg.finalBossHpFactor;
      else bossFactor = bossCfg.hpMultiplier;
      /* 血量 = 同波小怪血量 × bossFactor（保留原有设定）× 变体 hpMul（默认 1）。
         第 7 关 bossVariantHpMul=false：严格「小怪血 × bossFactor」，不吃
         金/蓝/灰的 1/1.2/1.45 微调 */
      const useHpMul = wcfg.bossVariantHpMul !== false;
      e.maxHp = Math.round(this.waveSmallHp(TD_CONFIG.enemies.enemyX.hp) * bossFactor *
        (useHpMul && bv && bv.hpMul != null ? bv.hpMul : 1));
      e.hp = e.maxHp;
      /* 移速 / 击杀金币 / 漏血扣生命 全部取变体 JSON（缺省回退全局系数）：
         漏血 = 普通怪(enemyX)漏血 × leakMul（默认 3 = 普通怪的 3 倍） */
      if (bv) {
        if (bv.speed != null) e.baseSpeed = bv.speed;
        if (bv.reward != null) e.reward = Math.max(0, bv.reward);
      }
      e.leakDamage = TD_CONFIG.enemies.enemyX.leakDamage *
        ((bv && bv.leakMul != null) ? bv.leakMul : bossCfg.leakMultiplier);
      /* 三阶段 BOSS（第 5/7 关，JSON 驱动 waves.bossPhases）：仅末波 BOSS
         标记一阶段（血量阈值分裂），其他波 BOSS 与无配置关卡不参与、零影响 */
      if (wcfg.bossPhases && this.waveIndex === wcfg.list.length - 1) {
        e.bossPhase = 1;
      }
      /* 第 7 关：按波次给 BOSS 挂护盾（雷/冰元素盾、血量盾，JSON 驱动
         waves.bossShields）；无配置的旧关卡拿到 undefined，零影响 */
      const shieldDef = wcfg.bossShields ? wcfg.bossShields[String(this.waveIndex)] : null;
      if (shieldDef && typeof e.applyShield === 'function') e.applyShield(shieldDef);
    } else {
      /* 第 5 关等关卡可配 enemyHpMul：小怪（非 BOSS）血量在波次成长基础上再乘此系数 */
      const hpMul = this.levelCfg.enemyHpMul || 1;
      const fwcfg = this.levelCfg.waves;
      /* 关卡可配 waveHpMul 数组：按波次下标（0 起）给小怪血量再乘系数
         （第 3 关 [1,2,2,2,1] = 第 2/3/4 波小怪血量翻倍，第 1/5 波不变）；
         仅非 BOSS 生效，BOSS 血量公式不变（不受 waveHpMul 影响） */
      const wHpMul = (fwcfg.waveHpMul && fwcfg.waveHpMul[this.waveIndex] != null)
        ? fwcfg.waveHpMul[this.waveIndex] : 1;
      /* 末波小怪额外血量倍率（如第 3 关 finalWaveHpMul=2：翻倍），
         仅末波非 BOSS 生效，不影响 BOSS/其他波次/其他关卡 */
      const fwHpMul = (this.waveIndex === fwcfg.list.length - 1 && fwcfg.finalWaveHpMul) ? fwcfg.finalWaveHpMul : 1;
      /* entry.hpWaveIndex 非空 = 支线波（第 4 关岔路奇兵）：血量按 JSON 指定
         波次水平成长，不受主波 waveIndex/末波特例影响（wHpMul/fwHpMul 仅按
         主波编号判定，支线波进行时均不触发）。 */
      e.maxHp = Math.round(this.waveSmallHp(e.cfg.hp, entry.hpWaveIndex) * hpMul * wHpMul * fwHpMul);
      e.hp = e.maxHp;
      e.drawHpBar(1); // 血量上限变化后重绘满血条宽度
      /* 末波小怪伤害减免（如第 3 关 finalWaveDmgReduction=0.10：受击 ×90%），
         仅末波非 BOSS 生效，不影响其他波次/其他关卡 */
      if (this.waveIndex === fwcfg.list.length - 1 && fwcfg.finalWaveDmgReduction) {
        e.dmgReduction = fwcfg.finalWaveDmgReduction;
      }
      /* JSON 驱动：按路线区分加成（第 4 关 routeBonus[1]：
         goldBonus=5 → 击杀金币额外+5；hpMul=1.5 → 血量再×1.5），
         仅非 BOSS 生效，BOSS 数值公式不受影响，左侧 route 0 无此字段不加速 */
      const rb = fwcfg.routeBonus;
      if (rb && rb[routeId]) {
        const rbCfg = rb[routeId];
        if (rbCfg.hpMul) {
          e.maxHp = Math.round(e.maxHp * rbCfg.hpMul);
          e.hp = e.maxHp;
          e.drawHpBar(1);
        }
        if (rbCfg.goldBonus) e.reward += rbCfg.goldBonus;
      }
      /* 第 8 关精英标记（entry.elite，JSON 驱动）：高血量 ×eliteHpMul、
         体型 ×eliteScale、金币 +eliteGoldBonus 的大体型基础史莱姆（第 7 波）；
         旧关卡组无此字段（恒 false），零影响 */
      if (entry.elite) {
        const mul = (entry.eliteHpMul != null) ? entry.eliteHpMul : 4;
        e.maxHp = Math.round(e.maxHp * mul);
        e.hp = e.maxHp;
        e.drawHpBar(1);
        if (entry.eliteScale) e.setScale(entry.eliteScale);
        if (entry.eliteGoldBonus) e.reward += entry.eliteGoldBonus;
      }
      /* JSON 驱动：末波按路线免伤（第 4 关 finalWaveRouteDmgReduction[1]=0.10：
         第 5 波右侧小怪受击 ×90%），仅末波非 BOSS 生效，不影响左侧/其他波 */
      if (this.waveIndex === fwcfg.list.length - 1 && fwcfg.finalWaveRouteDmgReduction) {
        const rd = fwcfg.finalWaveRouteDmgReduction[routeId];
        if (rd) e.dmgReduction = rd;
      }
    }
    /* JSON 驱动：按路线速度补偿（第 6 关 routeBonus.speedMul）：
       三路路径长度微调后仍有微小差异，按路线给 baseSpeed 乘系数，
       使三路同时出怪时到达终点时间接近。作用于所有敌人（含 BOSS），
       因为路径长度差异对所有敌人一视同仁。无配置关卡零影响。 */
    const rbSpeed = this.levelCfg.waves && this.levelCfg.waves.routeBonus;
    if (rbSpeed && rbSpeed[routeId] && rbSpeed[routeId].speedMul) {
      e.baseSpeed *= rbSpeed[routeId].speedMul;
    }
    /* JSON 驱动加速（第 4 关 branchSpawns.speedBonus=0.10）：
       仅作用于右侧岔路追加怪（entry.speedBonus），主波出怪无此字段不加速 */
    if (entry.speedBonus) e.baseSpeed *= (1 + entry.speedBonus);
    this.enemies.push(e);
    return e;
  }

  onEnemyKilled(e) {
    if (e.dead) return;
    /* 三阶段 BOSS（第 5 关）：分身死亡不入正常击杀流程（无金币、无爆尸动画），
       按组统计；全部死亡后合体成强化 BOSS */
    if (e.bossPhase === 2) { this.onMiniBossKilled(e); return; }
    e.dead = true;
    this.gold += e.reward;
    this.floatText(e.x, e.y - e.radius - 6, '+' + e.reward, 0xffe27a);
    e.playDeath();
  }

  /* ============================================================
   * 塔「禁言」（第 8 关：自爆泥怪爆炸 / 熔岩巨兽火焰路径）
   * 实现方式：对塔实例【运行时包装 update】——禁言期内整塔冻结（索敌/
   * 开火/炮塔动画全部停止），到期自动还原为原型方法。不改动 Tower.js 与
   * attackModule.js 任何源码，也不影响伤害计算公式；包装仅存在于被禁言
   * 的塔实例上，出售/场景销毁随实例一并消失。
   * ============================================================ */
  silenceTower(tw, duration) {
    if (!tw || tw.removed || !(duration > 0)) return;
    if (!tw.__silenceLeft || tw.__silenceLeft <= 0) {
      /* 首次禁言：换装实例级 update 包装（原型方法备份在 __silenceOrig） */
      tw.__silenceLeft = duration;
      tw.__silenceOrig = tw.update;
      tw.update = function (dt, ctx) {
        this.__silenceLeft -= dt;
        if (this.__silenceLeft > 0) return;  // 禁言中：完全停止攻击
        const orig = this.__silenceOrig;
        this.update = orig;                  // 到期还原为原型方法
        this.__silenceOrig = null;
        if (this.__silenceFx) {
          try { this.__silenceFx.destroy(); } catch (_) {}
          this.__silenceFx = null;
        }
        if (orig) orig.call(this, dt, ctx);  // 还原当帧立即恢复攻击逻辑
      };
      /* 视觉：灰蓝罩圈 + 「禁言」气泡（挂场景层，不进塔容器，
         避免影响塔自身的缩放/深度管理）；销毁时机与还原逻辑绑定 */
      const fx = this.add.container(tw.x, tw.y);
      fx.setDepth(tw.depth != null ? tw.depth + 1 : 40);
      const g = this.add.graphics();
      g.fillStyle(0x9fb6cc, 0.22);
      g.fillCircle(0, 0, 22);
      g.lineStyle(2, 0x9fb6cc, 0.85);
      g.strokeCircle(0, 0, 22);
      const label = this.add.text(0, -30, '🔇 禁言', {
        fontFamily: TD_FONT_STACK, fontSize: '12px', fontStyle: 'bold',
        color: '#cfe3f2', resolution: TD_TEXT_RES
      }).setOrigin(0.5).setStroke('#22303c', 3);
      fx.add([g, label]);
      tw.__silenceFx = fx;
    } else {
      /* 已在禁言：取更长剩余时间（火焰路径 0.5s 一跳需要持续刷新） */
      tw.__silenceLeft = Math.max(tw.__silenceLeft, duration);
    }
  }

  /* ============================================================
   * 三阶段 BOSS（第 5 关，全部 JSON 驱动：waves.bossPhases）
   *  P1 血量降到阈值 → 分裂 3 分身（总量=剩余×splitHpMul）；
   *  分身全灭 → 在最后一只位置合体成强化 BOSS（HP=总量×mergeHealRatio）；
   *  每阶段都有 banner 提示与扩散特效。无配置关卡零影响。
   * ============================================================ */

  /** BOSS 一阶段血量阈值检查（Enemy.takeDamage 调用）；
   *  低于阈值返回 true（已分裂，不再走死亡流程） */
  checkBossSplit(e) {
    const bp = this.levelCfg.waves && this.levelCfg.waves.bossPhases;
    if (!bp) return false;
    const thr = e.maxHp * ((bp.splitAtHpRatio != null) ? bp.splitAtHpRatio : 0.4);
    if (e.hp > thr) return false;
    this.splitBoss(e, bp);
    return true;
  }

  /** 一阶段 BOSS 分裂成 N 个分身（沿路前后错开，同组共享合体数据）。
   *  分身配置（全部 JSON 驱动 bossPhases）：
   *    miniType  分身贴图/类型（第 7 关=enemyX 绿色史莱姆；缺省沿用父代 BOSS）；
   *    miniHp    每只固定血量（第 7 关=5000；缺省走旧逻辑=剩余血×splitHpMul 均分）；
   *    miniSpeed 分身移速（缺省沿用构造移速）；
   *    miniTint  false=保留原生贴图色（第 7 关史莱姆绿）；缺省=旧版橙色 tint；
   *    miniScale 分身缩放（缺省不缩放，旧关卡由 JSON 提供才生效）。 */
  splitBoss(e, bp) {
    e.dead = true;
    /* 剩余血量计总（被一击打穿阈值时按 1 保底），× splitHpMul 得分身总量
       （旧关卡均分模式使用；第 7 关 miniHp 固定血量模式忽略 total） */
    const rest = Math.max(e.hp, 1);
    const total = Math.max(1, Math.round(rest * ((bp.splitHpMul != null) ? bp.splitHpMul : 1)));
    const n = bp.splitCount || 3;
    const miniType = bp.miniType || e.typeKey;
    const miniCfgIsBoss = !!(TD_CONFIG.enemies[miniType] && TD_CONFIG.enemies[miniType].boss);
    /* 分身沿用父代 BOSS 贴图，仅当分身本身就是 BOSS 类型时（旧关卡） */
    const miniOpts = (miniCfgIsBoss && e.opts && e.opts.bossTexKey)
      ? { bossTexKey: e.opts.bossTexKey } : null;
    this.bossPhaseLinkSeq = (this.bossPhaseLinkSeq || 0) + 1;
    this.bossPhaseLinks = this.bossPhaseLinks || {};
    this.bossPhaseLinks[this.bossPhaseLinkSeq] = {
      total: total, killed: 0, lastRoute: e.routeId, lastDist: e.pathDist,
      /* 第 7 关聚合所需：父代最大血量与变体外观/数值 */
      parentMaxHp: e.maxHp,
      parentTypeKey: e.typeKey,
      parentTexKey: (e.opts && e.opts.bossTexKey) || null,
      parentSpeed: e.baseSpeed,
      parentReward: e.reward,
      parentLeak: e.leakDamage
    };
    const base = Math.floor(total / n);
    const len = this.routeLength(e.routeId);
    for (let i = 0; i < n; i++) {
      const mi = new Enemy(this, miniType, e.routeId, miniOpts);
      if (bp.miniHp != null) {
        /* 固定分身血量（第 7 关：每只 5000，与分裂时剩余血量无关） */
        mi.maxHp = bp.miniHp;
      } else {
        mi.maxHp = (i === n - 1) ? Math.max(1, total - base * (n - 1)) : base;
      }
      mi.hp = mi.maxHp;
      mi.bossPhase = 2;
      mi.bossPhaseLink = this.bossPhaseLinkSeq;
      mi.bossPhasePool = total;
      /* 非 BOSS 贴图的分身（第 7 关绿色史莱姆）打上小 BOSS 标记：
         免疫塔D牵引、免疫冰冻/易伤，但仍走分身计数（无金币/死亡视频） */
      if (!miniCfgIsBoss) mi.bossMini = true;
      if (bp.miniSpeed != null) mi.baseSpeed = bp.miniSpeed;
      const off = (i - (n - 1) / 2) * 26;
      mi.pathDist = Phaser.Math.Clamp(e.pathDist + off, 0, len);
      const p = this.pathPointAt(mi.pathDist, e.routeId);
      mi.setPosition(p.x, p.y);
      mi.drawHpBar(1);
      if (bp.miniScale) mi.setScale(bp.miniScale);
      /* miniTint=false：保留原生贴图颜色（绿色史莱姆）；字段缺省维持旧版橙染 */
      if (bp.miniTint !== false) mi.body.setTint(0xff9a3c);
      this.enemies.push(mi);
    }
    this.banner('BOSS 分裂成 ' + n + ' 个小 BOSS！', 0x7be86b);
    this.makePortalBurst(e.x, e.y, 0x7be86b);
    e.destroyImmediately();
  }

  /** 分身死亡：无金币/无死亡动画，按组计数；同组全部死亡后合体 */
  onMiniBossKilled(e) {
    e.dead = true;
    const link = this.bossPhaseLinks && this.bossPhaseLinks[e.bossPhaseLink];
    if (link) {
      link.killed++;
      link.lastRoute = e.routeId;
      link.lastDist = e.pathDist;
      this.makePortalBurst(e.x, e.y, 0xff9a3c);
      e.destroyImmediately();
      const bp = this.levelCfg.waves.bossPhases;
      if (link.killed >= (bp.splitCount || 3) && !link.done) {
        link.done = true;
        this.spawnMergedBoss(link, bp);
      }
    } else {
      e.destroyImmediately();
    }
  }

  /** 合体：在最后一只分身位置重新生成大 BOSS。
   *  血量二选一（JSON 驱动 bossPhases）：
   *    mergeHpRatio（第 7 关=0.10）：聚合血量 = 父代大 BOSS【最大血量】× 比例；
   *    mergeHealRatio（旧关卡，缺省 0.5）：聚合血量 = 分身血量总量 × 比例。
   *  mergeKeepParentStats=true（第 7 关）：聚合体沿用父代变体贴图/移速/金币/
   *    漏血，不染色、不缩放；缺省走旧逻辑（按当前波次变体 + 红色 tint）。 */
  spawnMergedBoss(link, bp) {
    let hpv;
    if (bp.mergeHpRatio != null && link.parentMaxHp != null) {
      hpv = Math.max(1, Math.round(link.parentMaxHp * bp.mergeHpRatio));
    } else {
      hpv = Math.max(1, Math.round(link.total * ((bp.mergeHealRatio != null) ? bp.mergeHealRatio : 0.5)));
    }
    let mergeType = 'enemyBoss';
    let mergeTex = null;
    if (bp.mergeKeepParentStats) {
      /* 第 7 关：聚合回分裂前的那只大 BOSS（金/蓝/灰各自独立聚合） */
      mergeType = link.parentTypeKey || 'enemyBoss';
      mergeTex = link.parentTexKey || null;
    } else {
      const bvM = this.bossVariantAt(this.waveIndex);
      mergeTex = (bvM && bvM.tex) || null;
    }
    const mb = new Enemy(this, mergeType, link.lastRoute, mergeTex ? { bossTexKey: mergeTex } : null);
    mb.maxHp = hpv;
    mb.hp = hpv;
    mb.bossPhase = 3;
    if (bp.mergeKeepParentStats) {
      /* 沿用父代变体数值（缺省项回退构造默认） */
      if (link.parentSpeed != null) mb.baseSpeed = link.parentSpeed;
      if (link.parentReward != null) mb.reward = link.parentReward;
      if (link.parentLeak != null) mb.leakDamage = link.parentLeak;
    }
    mb.pathDist = Phaser.Math.Clamp(link.lastDist, 0, this.routeLength(link.lastRoute));
    const p = this.pathPointAt(mb.pathDist, link.lastRoute);
    mb.setPosition(p.x, p.y);
    mb.drawHpBar(1);
    /* 缩放/染色仅旧关卡（配置了 finalScale，或未启用父代沿用）时生效 */
    if (bp.finalScale) mb.setScale(bp.finalScale);
    if (!bp.mergeKeepParentStats) mb.body.setTint(0xff6666);
    this.enemies.push(mb);
    this.banner(bp.mergeKeepParentStats ? '小 BOSS 重新聚合！' : 'BOSS 合体归来！',
      bp.mergeKeepParentStats ? 0x7be86b : 0xff6666);
    this.makePortalBurst(p.x, p.y, bp.mergeKeepParentStats ? 0x7be86b : 0xff6666);
  }

  onEnemyLeak(e) {
    /* 防重入：进门动画期间若再次触发（理论上 update 已被 dead 拦截），直接忽略 */
    if (e._gateEntered) return;
    e._gateEntered = true;
    this.lives = Math.max(0, this.lives - e.leakDamage);
    this.floatText(Math.max(40, e.x), Math.min(this.H - 60, e.y), '-' + e.leakDamage + ' ❤️', 0xff8a8a);
    /* 同步门旁血量牌（多终点共享同一生命数） */
    if (this.castleGates) for (const g2 of this.castleGates) {
      if (g2.badge) g2.badge.setText(String(this.lives));
    }

    /* 选门：敌人当前路线对应的大门（传送可能切换 routeId），缺省第一扇 */
    const gate = (this.routeGateMap && this.routeGateMap[e.routeId]) ||
                 (this.castleGates && this.castleGates[0]) || null;
    /* 大门撞击反馈：抖动 + 白闪 */
    this.hitCastleGate(gate);

    /* 怪物进门：缩入门扇中心淡出，然后再走后续结算
       （三阶段 BOSS 分身沿用原合体逻辑，不改动其计数/聚合时机语义，
       仅把销毁点放在进门动画结束后） */
    this.playEnterGate(e, gate, () => {
      if (e.bossPhase === 2) { this.onMiniBossKilled(e); }
      else if (!e.removed) { e.destroyImmediately(); }
      if (this.lives <= 0) this.endGame(false);
    });
  }

  endGame(win) {
    this.state = win ? 'won' : 'lost';
    this.ghost.clear();
    this.hidePanel();
    this.closeTowerPicker(true);
    this.closePrincessPanel();
    this.clearFocusEnemy();    // 结算：移除集火光圈，避免残留在结算画面
    this.cancelAllObstacleAttacks();
    if (this.tutorialOverlay) this.tutorialOverlay.setVisible(false);

    /* 胜利 → 保存关卡进度 */
    if (win) {
      TDStorage.markCompleted(this.levelId);
    }

    const ov = document.getElementById('overlay-end');
    document.getElementById('end-title').textContent = win ? '🎉 胜利！' : '💀 防线告破';
    document.getElementById('end-desc').textContent = win
      ? ('第 ' + this.levelId + ' 关通过！' +
         (this.levelId === 1
           ? ' 教程完成，🔓 新塔「塔D·范围吸引控场」已解锁，第 2 关起即可使用！'
           : this.levelId === 2
             ? ' 🔓 新塔「塔E·电链弹跳」已解锁，第 3 关起即可使用！'
             : ''))
      : ('坚持到了第 ' + (this.waveIndex + 1) + ' 波，再试一次吧！');
    ov.classList.remove('hidden');
  }

  /* ============================================================
   * 输入：放塔 / 选塔
   * ============================================================ */
  onPointerMove(pointer) {
    if (this.selectedType) {
      /* DPR 高清渲染后 pointer.x/y 是物理缓冲坐标（0..960×dpr），
         而画幽灵/吸附/落塔全部按 960×540 逻辑世界坐标设计，
         必须经相机逆变换（含 zoom=dpr）换回世界坐标再使用；
         dpr=1 时 getWorldPoint 结果与 pointer.x/y 完全一致（旧行为）。 */
      const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const x = wp.x, y = wp.y;
      this.drawGhost(x, y);
      /* 左键按住拖动：连续放置（仅在放置模式 + 鼠标左键按下时触发，
         拖过的每个合法空格都立即放置，体验类似"画笔刷塔"）。
         拖到障碍物上不落塔（障碍物区域不可建造）。 */
      if (pointer.isDown && !pointer.rightButtonDown() && !this.getObstacleAt(x, y)) {
        this.tryPlaceAt(x, y);
      }
    }
  }

  onPointerDown(pointer) {
    /* 同 onPointerMove：pointer.x/y 已是物理缓冲坐标（×dpr），
       下方 getTowerAt/getObstacleAt/snapHotspot/distToPath 等全部
       消费世界坐标，先经相机逆变换统一换算（dpr=1 时无差别）。
       注意浮框/面板命中（manager.hitTest）内部自带相机逆变换，
       必须继续传原始 pointer，不做替换。 */
    const wp = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const x = wp.x, y = wp.y;

    /* 右键：仅用于取消放置模式 / 关闭选塔浮框。
       右键直接出售已放置塔的功能已移除——出售塔请使用左键点塔
       弹出升级/出售面板，再点面板中的"出售"按钮。 */
    if (pointer.rightButtonDown()) {
      if (this.selectedType) {
        this.setPlacement(null);
        this.floatText(x, y, '已取消放置', 0xffe27a);
      }
      this.closeTowerPicker();
      return;
    }

    // 【火力点相邻时优先于浮框命中】浮框宽约 3 槽（~200px），火力点间距
    // 仅 76px，点「另一个火力点」经常落在旧浮框覆盖范围内。旧逻辑一律被
    // 下方浮框 hitTest 吞掉，浮框不重建，上一次金币不足算出的置灰/不可点
    // 状态被保留——即使金币已恢复，点其他火力点也弹不出可用的新框。
    // 修复：命中的是另一个合法火力点时，直接把浮框切到该点重建
    // （openTowerPicker 每次重算金币，塔槽可用状态恒为最新）。
    const pickPR = (this.buildCfg.picker && this.buildCfg.picker.spotPickRadius != null)
      ? this.buildCfg.picker.spotPickRadius : this.buildCfg.touchRadius;
    const pickSpotHit = this.snapHotspot(x, y);
    if (this._pickSpot && pickSpotHit && this._pickSpot.key !== pickSpotHit.key &&
      this.canBuildAt(pickSpotHit.x, pickSpotHit.y, pickSpotHit.key)) {
      const pd2 = (pickSpotHit.x - x) * (pickSpotHit.x - x) +
        (pickSpotHit.y - y) * (pickSpotHit.y - y);
      if (pd2 <= pickPR * pickPR) {
        this.hidePanel();
        this.selectedTower = null;
        this.rangeGfx.clear();
        this.openTowerPicker(pickSpotHit);
        return;
      }
    }

    // 点在选塔浮框上：交给框内塔槽按钮，地图不响应（淡入未完成时也算命中）
    if (this.picker && this.picker.visible) {
      const pickHits = this.input.manager.hitTest(pointer, this.picker.list, this.cameras.main);
      if (pickHits.length > 0) return;
    }

    // 点在升级/出售面板上：交给面板按钮，不触发放塔/取消
    if (this.panel.visible) {
      const panelHits = this.input.manager.hitTest(pointer, this.panel.list, this.cameras.main);
      if (panelHits.length > 0) return;
    }

    // 1) 优先点选已有塔（放大触控热区）→ 升级/出售面板（不弹选塔框）
    const tower = this.getTowerAt(x, y);
    if (tower) {
      this.setPlacement(null);
      this.closeTowerPicker(true);
      this.cancelAllObstacleAttacks();  // 点塔时取消所有障碍物攻击
      this.clearFocusEnemy();      // 点塔时取消集火标记
      this.selectTower(tower);
      return;
    }

    // 1.5) 集火：非放置模式下点中道路上的怪物 → 切换集火目标
    //      （怪物在道路、障碍物在草地，热区不重叠；再点同怪/点空白取消）
    if (!this.selectedType) {
      const fe = this.getEnemyAt(x, y);
      if (fe) {
        this.closeTowerPicker(true);
        this.hidePanel();
        this.selectedTower = null;
        this.rangeGfx.clear();
        if (this.focusEnemy === fe) {
          this.clearFocusEnemy();           // 再次点击同一只怪 → 取消集火
        } else {
          /* 点击意图切换为集火：停止障碍物转火（互斥），标记集火目标 */
          this.cancelAllObstacleAttacks();
          this.setFocusEnemy(fe);
        }
        return;
      }
    }

    // 2) 障碍物：不可放塔；放置模式点击仅提示，普通模式点击=指派全部覆盖塔齐射
    const ob = this.getObstacleAt(x, y);
    if (ob) {
      this.closeTowerPicker(true);
      if (this.selectedType) {
        this.floatText(ob.x, ob.y - 30, '障碍物，不能放塔', 0xff9d9d);
        this.tweens.add({ targets: ob.img, scaleX: 1.12, scaleY: 0.9, duration: 90, yoyo: true });
      } else {
        this.clickObstacle(ob);
      }
      return;
    }

    // 3) 放置模式（旧底部栏路径，已无 UI 入口，保留逻辑兜底）：吸附 + 校验
    if (this.selectedType) {
      this.tryPlaceAt(x, y);
      return;
    }

    // 3.5) 点击空火力点 → 弹出/再次点击关闭选塔浮框；
    //      道路、装饰物、画面边缘等 canBuildAt 不通过的位置不弹框
    const h = this.snapHotspot(x, y);
    const pr = (this.buildCfg.picker && this.buildCfg.picker.spotPickRadius != null)
      ? this.buildCfg.picker.spotPickRadius : this.buildCfg.touchRadius;
    if (h && this.canBuildAt(h.x, h.y, h.key)) {
      const d2 = (h.x - x) * (h.x - x) + (h.y - y) * (h.y - y);
      if (d2 <= pr * pr) {
        if (this._pickSpot && this._pickSpot.key === h.key) {
          this.closeTowerPicker();      // 再次点击同一火力点：关闭
          return;
        }
        this.hidePanel();
        this.selectedTower = null;
        this.rangeGfx.clear();
        this.clearFocusEnemy();   // 打开选塔浮框：切换操作意图，取消集火
        this.openTowerPicker(h);
        return;
      }
    }

    // 4) 点道路/传送门/终点：不做任何建造相关反应（不弹选塔框、不显示
    //    可放置区域高亮）；仅关闭可能已打开的浮框/面板/选中态
    const roadHalf = (TD_CONFIG.world.pathWidth || 50) / 2 + 6;  // 路面半宽+触控容差
    if (this.distToPath(x, y) < roadHalf) {
      this.closeTowerPicker(true);
      this.hidePanel();
      this.selectedTower = null;
      this.rangeGfx.clear();
      this.cancelAllObstacleAttacks();  // 点道路时取消所有障碍物攻击
      this.clearFocusEnemy();      // 点道路空白处取消集火
      return;
    }

    // 5) 点不可放置的空白区域（草地、装饰物旁等，所有关卡统一）：
    //    a) 纯提示高亮已显示时，再次点击空白 → 关闭浮框与全部高亮；
    //    b) 否则不弹选塔框，仅高亮所有可放置区域，提示玩家哪里能放塔。
    if (this._spotHint) {
      this.closeTowerPicker(true);
      this.cancelAllObstacleAttacks();  // 再次点空白取消障碍物攻击
      this.clearFocusEnemy();      // 再次点空白取消集火
      return;
    }
    this.closeTowerPicker(true, true);   // 关浮框但保留高亮层，随后重绘为纯提示态
    this.hidePanel();
    this.selectedTower = null;
    this.rangeGfx.clear();
    this._spotHint = true;
    this.highlightPlacementPoints(null);
    this.cancelAllObstacleAttacks();  // 点空白时取消所有障碍物攻击
    this.clearFocusEnemy();      // 点空白时取消集火
  }

  /** 放置模式下的热区吸附 + 校验 + 落子（供左键点击与拖动共用） */
  tryPlaceAt(x, y) {
    const h = this.snapHotspot(x, y);
    if (!h) return;
    if (this.canBuildAt(h.x, h.y, h.key)) {
      this.placeTower(h.x, h.y, h.key);
    } else {
      this.floatText(h.x, h.y, '✕ 不能放这里', 0xffffff);
      this.drawGhost(x, y);
    }
  }

  /** 出售并移除已放置的塔（左键面板按钮出售） */
  sellTower(tower) {
    if (!tower) return;
    this.gold += tower.getSellValue();
    this.occupied.delete(tower.hotspotKey);
    /* 塔被卖掉时：从障碍物齐射集合摘除（该障碍物无人攻击时自动关高亮环） */
    if (tower.obstacleTarget) this._removeTowerAssignment(tower);
    this.towers = this.towers.filter((v) => v !== tower);
    tower.destroy();
    if (this.selectedTower === tower) {
      this.selectedTower = null;
      this.hidePanel();
      this.rangeGfx.clear();
    }
    if (this.selectedType) this.drawPlacementGrid();
  }

  getTowerAt(x, y) {
    const r = TD_CONFIG.build.touchRadius;
    let best = null, bestD = r * r;
    for (const t of this.towers) {
      const d2 = (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y);
      if (d2 <= bestD) { best = t; bestD = d2; }
    }
    return best;
  }

  /* ============================================================
   * 集火系统（点击怪物）：命中半径 = 怪物半径 + focusFire.hitPad
   * （外扩触控容差，手机触摸/电脑鼠标同样好点）。点中即标记为
   * this.focusEnemy，所有射程覆盖它的伤害型塔在 attackModule 中
   * 优先攻击；目标死亡/进门/再次点击/点空白时清除。
   * ============================================================ */
  getEnemyAt(x, y) {
    const pad = (TD_CONFIG.focusFire && TD_CONFIG.focusFire.hitPad != null)
      ? TD_CONFIG.focusFire.hitPad : 12;
    let best = null, bestD2 = Infinity;
    for (const e of this.enemies) {
      /* 已死亡/已移除/正在进门的怪不再响应点击 */
      if (e.dead || e.removed) continue;
      const r = (e.radius || 15) + pad;
      const d2 = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
      if (d2 <= r * r && d2 < bestD2) { best = e; bestD2 = d2; }
    }
    return best;
  }

  /** 标记集火目标：清除旧标记，在怪物头顶挂一个红色向下三角标（脉冲）。
   *  仅三角标，无光圈；为场景级 Graphics（depth 590，在敌人 20+ 与塔面板
   *  600 之间），每帧由 update 跟随怪物坐标；怪物死亡/进门时自动清除。 */
  setFocusEnemy(e) {
    if (!e || this.focusEnemy === e) return;
    this.clearFocusEnemy();
    this.focusEnemy = e;

    const fcfg = TD_CONFIG.focusFire || {};
    const color = fcfg.ringColor != null ? fcfg.ringColor : 0xff4d5d;
    const r = (e.radius || 15) + (fcfg.ringPad != null ? fcfg.ringPad : 7);
    const period = fcfg.period || 380;

    const g = this.add.graphics().setDepth(590);
    /* 仅保留：怪物头顶居中的红色倒三角，箭头向下指向怪物，无任何圆环 */
    g.fillStyle(color, 1);
    g.fillTriangle(-6, -r - 20, 6, -r - 20, 0, -r - 9);
    g.setPosition(e.x, e.y);

    const st = { s: 0.92 };
    this._focusTween = this.tweens.add({
      targets: st, s: 1.12, duration: period,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      onUpdate: () => g.setScale(st.s)
    });
    this._focusMarker = g;
  }

  /** 取消集火：销毁三角标与脉冲 tween、清空 focusEnemy（不再弹出任何提示 UI）。 */
  clearFocusEnemy() {
    if (this._focusTween) {
      try { this._focusTween.stop(); } catch (_) {}
      this._focusTween = null;
    }
    if (this._focusMarker) {
      this._focusMarker.destroy();
      this._focusMarker = null;
    }
    this.focusEnemy = null;
  }

  /** 点是否落在 HUD 安全禁区（顶部金币/生命/波次/控制按钮、左下波次按钮）。
      电脑端与移动端共用同一份世界坐标矩形（TD_CONFIG.build.uiSafeZones），
      保证两端塔位布局一致；任何火力点/据点/障碍物都不得生成在区内。 */
  inUiSafeZone(x, y) {
    const zones = (this.buildCfg && this.buildCfg.uiSafeZones) || TD_CONFIG.build.uiSafeZones;
    if (!zones) return false;
    for (const z of zones) {
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return true;
    }
    return false;
  }

  /** 热区是否可放：画面边界 + 热区未占用 + 塔心离路径中心线足够远（避路）
      + 不落入 HUD 安全禁区 */
  canBuildAt(x, y, key) {
    /* 用【本关合并后的 build 配置】（顶层 build 被 levelCfg.build 覆盖，见 create），
       与 buildHotspots 生成热区时的判定完全一致：否则关卡自定义了
       minPathDistance（如第 7 关 52，为解锁发夹弯内侧塔位）时，生成出来的点
       会在绘制/点击判定的这一刻被按全局值 56 拒绝，导致"看得见格子却放不了塔"。
       第 1~6 关 build 未覆盖该键，取值与全局完全相同，行为零变化。 */
    const b = this.buildCfg || TD_CONFIG.build;
    if (x < b.edgeMargin || x > this.W - b.edgeMargin || y < b.edgeMargin || y > this.H - b.edgeMargin) return false;
    if (this.occupied.has(key)) return false;
    if (this.distToPath(x, y) < b.minPathDistance) return false;
    if (this.inUiSafeZone(x, y)) return false;
    if (this.isExcludedSpot(x, y)) return false;   // 关卡专属排除点（与生成规则一致）
    return true;
  }

  /* ============================================================
   * 障碍物系统：放塔无效区（离路超出所有塔射程，放塔也打不到路面）
   * 摆放卡通装饰物（石头/树木/木桶）。不可放塔；点击后由最近的、
   * 射程够得到的伤害型塔转火攻击；血量/奖励全部 JSON 配置驱动。
   * ============================================================ */

  /** 生成关卡障碍物：在距路径中心线 [minRoadDist, maxRoadDist] 的环带内，
   * 按固定种子随机挑选间距 ≥spacing 的点（每次刷新布局一致），上限 maxCount */
  spawnObstacles() {
    const ocfg = TD_CONFIG.obstacles;
    this.obstacles = [];
    if (!ocfg || ocfg.hp == null) return;
    const cand = [];
    /* 40px 步进晶格覆盖旧双网格位置，逐点查离路距离 */
    for (let cx = 40; cx < this.W; cx += 40) {
      for (let cy = 40; cy < this.H; cy += 40) {
        const d = this.distToPath(cx, cy);
        if (d >= ocfg.minRoadDist && d <= ocfg.maxRoadDist) cand.push({ x: cx, y: cy });
      }
    }
    /* 固定种子洗牌（与 drawDecor 同思路，布局稳定可复现） */
    let seed = 20260921;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = cand[i]; cand[i] = cand[j]; cand[j] = t;
    }
    const kinds = ocfg.kinds || ['rock'];
    /* 自动障碍物数量上限：关卡可用 levelCfg.obstaclesAutoCount 覆盖
       （第 7 关 = 0：关掉随机布点，改为 extraObstacles 的显式整齐布点）；
       未配置的关卡沿用全局 maxCount，第 1~6 关行为零变化。 */
    const autoMax = (this.levelCfg.obstaclesAutoCount != null)
      ? this.levelCfg.obstaclesAutoCount : ocfg.maxCount;
    for (const c of cand) {
      if (this.obstacles.length >= autoMax) break;
      /* HUD 安全禁区（顶部信息栏/控制按钮、左下波次按钮）不放障碍物：
         否则被按钮遮挡无法点选/转火攻击（血量/奖励规则不变，只是换位置） */
      if (this.inUiSafeZone(c.x, c.y)) continue;
      let dup = false;
      for (const o of this.obstacles) {
        if (Math.abs(o.x - c.x) < ocfg.spacing && Math.abs(o.y - c.y) < ocfg.spacing) { dup = true; break; }
      }
      if (dup) continue;
      this.obstacles.push(this.makeObstacle(c.x, c.y, kinds[Math.floor(rnd() * kinds.length)]));
    }

    /* 关卡专属额外障碍物（JSON 驱动 levelCfg.extraObstacles，仅部分关卡如第 5 关）：
       由关卡设计者显式指定位置，绕过自动生成（不占 maxCount 名额）；
       硬校验：界内 + 不压路（distToPath ≥ minPathDistance）+ 与已有障碍物
       保持 spacing 欧氏间距，违规点跳过。血量/奖励沿用全局 obstacles 配置，
       据点机制（buildObstacleSpots）对它们同样生效，保证可被塔攻击。 */
    const extraObs = this.levelCfg.extraObstacles || [];
    const bld = this.buildCfg || {};
    const minPath = bld.minPathDistance || 56;
    /* 固定障碍物之间的最小间距：关卡可用 levelCfg.obstacleSpacing 覆盖
       （第 7 关 = 64：该关可放障碍物的空白带有限，用 64px 排出整齐一排凑满 10 个）；
       未配置的关卡沿用全局 obstacles.spacing（80），第 1~6 关行为零变化。 */
    const obGap = (this.levelCfg.obstacleSpacing != null)
      ? this.levelCfg.obstacleSpacing : ocfg.spacing;
    for (const p of extraObs) {
      if (p.x < 24 || p.x > this.W - 24 || p.y < 24 || p.y > this.H - 24) continue;
      if (this.distToPath(p.x, p.y) < minPath) continue;
      if (this.inUiSafeZone(p.x, p.y)) continue;   // 固定障碍物同样避开 HUD 区
      let dup = false;
      for (const o of this.obstacles) {
        if (Math.hypot(o.x - p.x, o.y - p.y) < obGap) { dup = true; break; }
      }
      if (dup) continue;
      this.obstacles.push(this.makeObstacle(p.x, p.y, kinds[Math.floor(rnd() * kinds.length)]));
    }
  }

  /** 创建单个障碍物：贴图 + 常显血条（攻击进度一目了然） */
  makeObstacle(x, y, kind) {
    const ocfg = TD_CONFIG.obstacles;
    const img = this.add.image(x, y, 'obst_' + kind).setDepth(8);
    const bar = this.add.graphics().setDepth(30);
    /* 攻击选中高亮环：被塔转火攻击时显示金色脉冲圈 */
    const ring = this.add.graphics().setDepth(7);
    const ob = {
      isObstacle: true, x, y, kind,
      hp: ocfg.hp, maxHp: ocfg.hp, radius: ocfg.radius,
      img, bar, ring, ringTween: null,
      baseScale: 1,
      barY: -(img.height / 2) - 10,       // 血条挂在顶上方
      /* 正在转火攻击本障碍物的【全部】塔（火/冰/水/雷/风等所有伤害型塔，
         只要射程覆盖到就齐射；塔D 无伤害的吸引塔不计入）。点击障碍物切换。 */
      assignedTowers: [], dead: false
    };
    ob.takeDamage = (dmg) => this.damageObstacle(ob, dmg);
    this.redrawObstacleBar(ob);
    return ob;
  }

  /** 重画障碍物血条（绿→黄→红随血量变化） */
  redrawObstacleBar(ob) {
    const g = ob.bar;
    g.clear();
    g.setPosition(ob.x, ob.y);
    const w = 44, h = 6, x0 = -w / 2, y0 = ob.barY;
    g.fillStyle(0x2b2230, 0.85);
    g.fillRoundedRect(x0 - 1, y0 - 1, w + 2, h + 2, 3);
    const ratio = ob.hp / ob.maxHp;
    if (ratio > 0) {
      g.fillStyle(ratio > 0.5 ? 0x7ee06a : (ratio > 0.25 ? 0xffd84a : 0xff6b6b), 1);
      g.fillRoundedRect(x0, y0, Math.max(2, w * ratio), h, 2.5);
    }
  }

  /** 障碍物受击：扣血 + 白闪抖动反馈；血量归零 → 摧毁发奖励 */
  damageObstacle(ob, dmg) {
    if (ob.dead) return;
    ob.hp = Math.max(0, ob.hp - dmg);
    this.redrawObstacleBar(ob);
    ob.img.setTintFill(0xffffff);
    this.time.delayedCall(60, () => {
      try { if (!ob.dead) ob.img.clearTint(); } catch (_) {}
    });
    this.tweens.add({
      targets: ob.img, scaleX: ob.baseScale * 1.08, scaleY: ob.baseScale * 0.94,
      duration: 70, yoyo: true
    });
    if (ob.hp <= 0) this.destroyObstacle(ob);
  }

  /** 障碍物被摧毁：奖励金币、解除所有塔的转火锁定、播放消散动画 */
  destroyObstacle(ob) {
    if (ob.dead) return;
    ob.dead = true;
    /* 解除全部参与塔的锁定，它们下帧自动恢复常规索敌 */
    for (const t of ob.assignedTowers) {
      if (t && t.obstacleTarget === ob) t.obstacleTarget = null;
    }
    ob.assignedTowers.length = 0;
    const reward = TD_CONFIG.obstacles.reward;
    this.gold += reward;
    this.syncHud();
    this.floatText(ob.x, ob.y - 34, '+' + reward, 0xffd84a);
    ob.bar.destroy();
    this.hideObstacleRing(ob);
    this.tweens.add({
      targets: ob.img, alpha: 0, scale: ob.baseScale * 0.4, angle: 30,
      duration: 240, ease: 'Cubic.in', onComplete: () => ob.img.destroy()
    });
  }

  /** 点选命中最障碍物（触摸/鼠标共用放大热区） */
  getObstacleAt(x, y) {
    const r = TD_CONFIG.build.touchRadius + (TD_CONFIG.obstacles ? TD_CONFIG.obstacles.radius : 20);
    let best = null, bestD2 = r * r;
    for (const o of this.obstacles) {
      if (o.dead) continue;
      const d2 = (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y);
      if (d2 <= bestD2) { best = o; bestD2 = d2; }
    }
    return best;
  }

  /** 点击障碍物：切换攻击状态。
   *  - 已被攻击 → 取消攻击（解除锁定、关闭高亮环、塔恢复打小怪）；
   *  - 未被攻击 → 指派射程覆盖到它的最近伤害型塔转火攻击，并显示高亮环；
   *  - 无塔覆盖 → 不攻击、不转火，仅给一行文字反馈。
   *  覆盖口径：塔心到障碍物中心 ≤ tower.range + ob.radius（射程擦到障碍物
   *  实体即可打，与 AttackBehavior 的开火判定同口径，杜绝指派了却打不到）。 */
  clickObstacle(ob) {
    /* 点击意图切换为障碍物 → 取消可能存在的集火标记 */
    this.clearFocusEnemy();
    /* 再次点击已攻击中的障碍物 → 取消全部参与塔 */
    if (ob.assignedTowers.length) {
      this.cancelObstacleAttack(ob);
      this.floatText(ob.x, ob.y - 30, '停止攻击', 0xffe27a);
      return;
    }
    /* 遍历【所有】伤害型塔（火/冰/水/雷/风…，塔D 吸引塔除外）：只要射程
       覆盖到该障碍物就加入齐射——不再只派最近的一座。 */
    const towers = this._towersCoveringObstacle(ob);
    if (!towers.length) {
      // 无塔覆盖：不攻击、不转火（浮字仅为点击反馈，不改变任何塔的目标）
      this.floatText(ob.x, ob.y - 30, '附近没有塔够得到', 0xff9d9d);
      return;
    }
    /* 一座塔同一时刻只锁定一个障碍物：原先锁着别的障碍物的塔，先从旧障碍物
       的参与集合摘除（旧障碍物若因此无人攻击则自动关闭高亮环）。 */
    for (const t of towers) {
      if (t.obstacleTarget && t.obstacleTarget !== ob) this._removeTowerAssignment(t);
      t.obstacleTarget = ob;
      ob.assignedTowers.push(t);
    }
    this.showObstacleRing(ob);
    this.floatText(ob.x, ob.y - 30, towers.length + ' 座塔开火！', 0xffe27a);
    this.tweens.add({
      targets: ob.img, scaleX: ob.baseScale * 1.12, scaleY: ob.baseScale * 0.9,
      duration: 90, yoyo: true
    });
  }

  /** 返回当前【所有】射程覆盖到该障碍物、可立即参与齐射的伤害型塔
   *  （不区分元素：火/冰/水/雷/风一视同仁；塔D 无伤害吸引塔跳过）。 */
  _towersCoveringObstacle(ob) {
    const out = [];
    for (const t of this.towers) {
      if (!t.stats.damage) continue;                       // 无伤害塔（塔D）跳过
      const eff = t.cfg.effect;
      if (eff && eff.type === 'pull') continue;            // 吸引塔无弹道，跳过
      const dx = t.x - ob.x, dy = t.y - ob.y;
      const reach = t.stats.range + ob.radius;             // 覆盖到障碍物本体即可
      if (dx * dx + dy * dy <= reach * reach) out.push(t);
    }
    return out;
  }

  /** 把一座塔从其当前障碍物的参与集合摘除并解除锁定；
   *  该障碍物因此再无塔攻击时，顺手关闭高亮环。 */
  _removeTowerAssignment(t) {
    const o = t.obstacleTarget;
    if (!o) return;
    const i = o.assignedTowers.indexOf(t);
    if (i >= 0) o.assignedTowers.splice(i, 1);
    t.obstacleTarget = null;
    if (!o.assignedTowers.length) this.hideObstacleRing(o);
  }

  /** 取消障碍物攻击：解除【全部】参与塔的锁定 + 关闭高亮环 */
  cancelObstacleAttack(ob) {
    if (!ob) return;
    for (const t of ob.assignedTowers) {
      if (t) t.obstacleTarget = null;
    }
    ob.assignedTowers.length = 0;
    this.hideObstacleRing(ob);
  }

  /** 显示障碍物攻击高亮环（金色脉冲圈） */
  showObstacleRing(ob) {
    const r = (ob.radius || 20) + 8;
    ob.ring.clear();
    ob.ring.setPosition(ob.x, ob.y);
    ob.ring.lineStyle(3, 0xffd84a, 0.9);
    ob.ring.strokeCircle(0, 0, r);
    ob.ring.setVisible(true);
    if (ob.ringTween) ob.ringTween.stop();
    ob.ringTween = this.tweens.add({
      targets: ob.ring,
      alpha: { from: 0.5, to: 1.0 },
      scale: { from: 0.92, to: 1.08 },
      duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
  }

  /** 隐藏障碍物攻击高亮环 */
  hideObstacleRing(ob) {
    if (!ob.ring) return;
    if (ob.ringTween) { ob.ringTween.stop(); ob.ringTween = null; }
    ob.ring.clear();
    ob.ring.setVisible(false);
  }

  /** 取消所有障碍物攻击（点击其他位置时调用） */
  cancelAllObstacleAttacks() {
    for (const o of this.obstacles) {
      if (o.assignedTowers && o.assignedTowers.length) this.cancelObstacleAttack(o);
    }
  }

  /** 放置预览：绿色=可放 / 红色=非法，并显示射程 */
  drawGhost(x, y) {
    const g = this.ghost;
    g.clear();
    if (!this.selectedType) return;
    const cfg = TD_CONFIG.towers[this.selectedType];
    const h = this.snapHotspot(x, y);
    const cx = h.x, cy = h.y;
    const ok = this.canBuildAt(cx, cy, h.key) && this.gold >= cfg.cost;
    const color = ok ? 0x6be86b : 0xff5d5d;

    // 放置点提示（与放置网格同款圆角方格，非法时半透明红描边）
    const b = this.buildCfg;
    const size = b.spotSize || 36, sr = b.spotRadius || 10;
    g.fillStyle(0xffffff, 0.22);
    g.fillRoundedRect(cx - size / 2, cy - size / 2, size, size, sr);
    g.lineStyle(3, color, 0.95);
    g.strokeRoundedRect(cx - size / 2, cy - size / 2, size, size, sr);
    // 射程圈
    g.lineStyle(2, color, 0.9);
    g.fillStyle(color, 0.10);
    g.fillCircle(cx, cy, cfg.stats.range);
    g.strokeCircle(cx, cy, cfg.stats.range);
    // 塔占位圆
    g.fillStyle(cfg.color, 0.85);
    g.fillCircle(cx, cy, 22);
    g.lineStyle(3, color, 1);
    g.strokeCircle(cx, cy, 22);
  }

  /** 落子建塔。typeKey 显式传入时=选塔浮框直接放置（不进入/不依赖放置模式）；
   *  缺省时沿用旧放置模式（this.selectedType，底部栏移除后已无 UI 入口，保留兜底）。
   *  返回是否放置成功。 */
  placeTower(x, y, key, typeKey) {
    const tk = typeKey || this.selectedType;
    if (!tk) return false;
    const cfg = TD_CONFIG.towers[tk];
    if (this.gold < cfg.cost) {
      if (!typeKey) this.setPlacement(null);   // 放置模式兜底：金币不足退出模式
      return false;
    }
    this.gold -= cfg.cost;
    const tower = new Tower(this, x, y, tk);
    tower.hotspotKey = key;            // 记录所占热区（出售时精确释放，主/交错晶格通用）
    this.towers.push(tower);
    this.occupied.set(key, tower);
    this.tweens.add({ targets: tower, scale: { from: 0.4, to: 1 }, duration: 160, ease: 'Back.out' });
    /* 放置后刷新可放置区域：被占的格子从图层中消失，无需手动清空 */
    if (this.selectedType) this.drawPlacementGrid();
    // 放置模式下金币不够再放一座时自动退出；选塔浮框每次点击只放一座
    if (this.selectedType && !typeKey && this.gold < cfg.cost) this.setPlacement(null);
    /* 新塔若射程覆盖【正在被攻击】的障碍物：自动加入齐射，保证“所有
       攻击范围能覆盖到该障碍物的塔都参与攻击”，无需玩家重新点一次。 */
    this._assignNewTowerToObstacles(tower, cfg);
    return true;
  }

  /** 新建塔自动加入齐射：遍历正在被攻击（assignedTowers 非空）的障碍物，
   *  新塔为伤害型（非塔D 吸引）且射程覆盖到该障碍物本体时，立即锁定加入。
   *  塔升级射程变大无需重新调用——升级后仍在原集合中，开火判定按新射程。 */
  _assignNewTowerToObstacles(tower, cfg) {
    if (!tower.stats.damage) return;
    const eff = cfg && cfg.effect;
    if (eff && eff.type === 'pull') return;
    for (const o of this.obstacles) {
      if (o.dead || !o.assignedTowers.length) continue;
      const dx = tower.x - o.x, dy = tower.y - o.y;
      const reach = tower.stats.range + o.radius;
      if (dx * dx + dy * dy <= reach * reach && tower.obstacleTarget !== o) {
        tower.obstacleTarget = o;
        o.assignedTowers.push(tower);
      }
    }
  }

  /* ============================================================
   * 选塔面板：升级 / 出售（Phaser 内绘制，随画布缩放）
   * ============================================================ */
  buildTowerPanel() {
    const panel = this.add.container(0, 0).setDepth(600).setVisible(false);
    const W = 214, H = 108;

    const bg = this.add.graphics();
    bg.fillStyle(0xfffcf2, 0.97);
    bg.fillRoundedRect(-W / 2, -H / 2, W, H, 14);
    bg.lineStyle(3, 0x4a3313, 0.85);
    bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 14);
    panel.add(bg);

    const title = this.add.text(-W / 2 + 12, -H / 2 + 8, '', {
      fontFamily: TD_FONT_STACK, fontSize: '15px',
      fontStyle: 'bold', color: '#3a2c1a', resolution: TD_TEXT_RES
    });
    const stats = this.add.text(-W / 2 + 12, -H / 2 + 30, '', {
      fontFamily: TD_FONT_STACK, fontSize: '13px',
      color: '#5c431f', resolution: TD_TEXT_RES
    });
    panel.add([title, stats]);

    // 升级按钮
    const upBtn = this.makePanelButton(-50, 28, 98, 40, 0x9be86b, '');
    // 出售按钮
    const sellBtn = this.makePanelButton(54, 28, 98, 40, 0xffb74d, '');
    panel.add([upBtn.g, upBtn.text, upBtn.zone, sellBtn.g, sellBtn.text, sellBtn.zone]);

    panel._title = title;
    panel._stats = stats;
    panel._up = upBtn;
    panel._sell = sellBtn;
    return panel;
  }

  makePanelButton(x, y, w, h, color, label) {
    const g = this.add.graphics();
    const draw = (c) => {
      g.clear();
      g.fillStyle(c, 1);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 10);
      g.lineStyle(2, 0x000000, 0.18);
      g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    };
    draw(color);
    const text = this.add.text(x, y, label, {
      fontFamily: TD_FONT_STACK, fontSize: '13.5px',
      fontStyle: 'bold', color: '#3a2c1a', resolution: TD_TEXT_RES
    }).setOrigin(0.5);
    const zone = this.add.zone(x, y, w + 12, h + 12).setInteractive({ useHandCursor: true });
    zone.setData('ui', true);
    zone.on('pointerover', () => draw(Phaser.Display.Color.IntegerToColor(color).lighten(12).color));
    zone.on('pointerout', () => draw(color));
    zone.on('pointerdown', () => {
      if (this._panelAction) this._panelAction();
    });
    return { g, text, zone, setLabel: (s) => text.setText(s), setEnabled: (on) => { zone.input.enabled = on; g.setAlpha(on ? 1 : 0.45); } };
  }

  selectTower(tower) {
    this.selectedTower = tower;
    this.rangeGfx.clear();
    this.drawRange(tower.x, tower.y, tower.stats.range, tower.cfg.color);
    this.refreshPanel();
  }

  refreshPanel() {
    const tower = this.selectedTower;
    if (!tower) return;
    const p = this.panel;
    p._title.setText(tower.cfg.name + '  Lv.' + tower.level + (tower.canUpgrade ? '' : '（满级）'));
    const effType = tower.cfg.effect && tower.cfg.effect.type;
    if (effType === 'pull') {
      p._stats.setText('类型 范围吸引·控场\n射程 ' + tower.stats.range + '   伤害 ' + tower.stats.damage);
    } else if (effType === 'chain') {
      p._stats.setText(
        '伤害 ' + tower.stats.damage +
        '   射程 ' + tower.stats.range +
        '\n电链弹跳 ' + tower.stats.jumps + ' 次'
      );
    } else if (effType === 'windSpread') {
      const weff = tower.cfg.effect || {};
      p._stats.setText(
        '伤害 ' + tower.stats.damage + '   射程 ' + tower.stats.range +
        '\n元素扩散 半径 ' + (weff.spreadRadius != null ? weff.spreadRadius : 0) +
        ' · 冷却 ' + (weff.spreadCooldown != null ? weff.spreadCooldown : 0) + 's'
      );
    } else {
      p._stats.setText(
        '伤害 ' + tower.stats.damage +
        '   射程 ' + tower.stats.range +
        '\n攻速 ' + (1 / tower.stats.cooldown).toFixed(2) + ' 次/秒'
      );
    }

    const upCost = tower.getUpgradeCost();
    /* 4 级进化门控显示：波次未达 waveGate（默认 4）时按钮置灰并提示解锁波次 */
    const upBlock = (typeof tower.upgradeBlockReason === 'function')
      ? tower.upgradeBlockReason() : null;
    if (tower.canUpgrade && upBlock) {
      p._up.setEnabled(false);
      p._up.setLabel(upBlock);
    } else if (tower.canUpgrade && upCost !== null) {
      p._up.setEnabled(true);
      p._up.setLabel('⬆ 升级 🪙' + upCost);
    } else {
      p._up.setEnabled(false);
      p._up.setLabel('已满级');
    }
    p._sell.setLabel('💰 出售 +' + tower.getSellValue());

    // 面板位置：优先在塔上方，空间不够放下方；横向钳制在画面内
    const px = Phaser.Math.Clamp(tower.x, 110, this.W - 110);
    let py = tower.y - 80;
    if (py < 70) py = tower.y + 80;
    p.setPosition(px, py);
    p.setVisible(true);

    // 绑定按钮动作
    this._panelAction = () => {
      if (!this.selectedTower) return;
      const t = this.selectedTower;
      const cost = t.getUpgradeCost();
      if (cost !== null) {
        if (this.gold >= cost) {
          this.gold -= cost;
          t.upgrade();
          this.rangeGfx.clear();
          this.drawRange(t.x, t.y, t.stats.range, t.cfg.color);
          this.refreshPanel();
        } else {
          this.floatText(t.x, t.y - 40, '金币不足', 0xffffff);
        }
      }
    };
    p._up.zone.off('pointerdown');
    p._up.zone.on('pointerdown', () => this._panelAction && this._panelAction());

    p._sell.zone.off('pointerdown');
    p._sell.zone.on('pointerdown', () => this.sellTower(this.selectedTower));
  }

  hidePanel() { this.panel.setVisible(false); this._panelAction = null; }

  /* ============================================================
   * 选塔浮框（点击空火力点弹出；替代旧底部塔栏）
   * ------------------------------------------------------------
   * - 半透明深色圆角框 + 白边 + 外发光；列出本关已解锁塔，元素色
   *   圆图标（火红/冰蓝/水青/牵引灰/雷紫/风绿）+ 名称 + 价格；
   * - 金币不足：图标与文字置灰，点击给「金币不足」提示、不落塔；
   * - 默认在火力点上方（避开手指遮挡），上方空间不够翻到下方，
   *   横向钳制不超出屏幕；整体按画布 FIT 缩放自适应手机/电脑；
   * - 淡入/淡出 140ms；打开期间被点火力点金色脉冲高亮。
   * ============================================================ */

  /** 浮框整体缩放：画布被 FIT 缩小时同步放大，保证屏上可读可点；
   *  同时受画面宽高上限钳制（宽≤屏宽60%、高≤屏高15%），避免遮大半屏幕 */
  pickerScale(w, h) {
    /* displayScale = gameSize/canvasBounds；DPR 后 gameSize=960×dpr，
       分子多出 dpr 倍，除回后得到与旧版一致的"逻辑显示压缩比"，
       保证选塔浮框缩放决策在 dpr=1/2 下完全相同 */
    const dpr = window.__TD_DPR || 1;
    const k = Math.min(this.scale.displayScale.x / dpr, this.scale.displayScale.y / dpr) || 1;
    const readScale = 1 / Math.min(k, 1);
    const fitW = (this.W * 0.60) / w;
    const fitH = (this.H * 0.15) / h;
    return Math.max(1, Math.min(readScale, fitW, fitH));
  }

  /** 在指定火力点打开选塔浮框（每次打开重建，价格/解锁状态恒为最新） */
  openTowerPicker(spot) {
    this.closeTowerPicker(true);

    const cfg = (this.buildCfg.picker) || {};
    const itemW = cfg.itemW || 56;
    const gap = cfg.gap != null ? cfg.gap : 4;
    const padX = cfg.padX != null ? cfg.padX : 8;
    const padY = cfg.padY != null ? cfg.padY : 5;
    const iconR = cfg.iconR || 13;
    const offY = cfg.offsetY != null ? cfg.offsetY : 22;
    const edge = cfg.edgeMargin != null ? cfg.edgeMargin : 8;
    const nameFS = cfg.nameFS || 12;
    const costFS = cfg.costFS || 11;
    const colors = cfg.iconColors || {};
    const glyphs = cfg.iconGlyph || {};

    /* 塔位列表直接取自 TD_CONFIG.towers（新增塔无需再改这里），按 A→F 配置顺序，
       逐个过滤本关可用性（塔D/E/F 按解锁规则；第 7 关 config.allTowersAvailable
       开放全部塔，不再受历史通关记录限制）——保证「本关已解锁的塔一座不漏」 */
    const types = Object.keys(TD_CONFIG.towers)
      .filter((k) => TD_CONFIG.towers[k] && TDStorage.isTowerUnlocked(k, this.levelId));
    if (!types.length) return;

    const innerW = types.length * itemW + (types.length - 1) * gap;
    const W = innerW + padX * 2;
    /* 紧凑垂直布局：图标(直径=2r) + gap(3) + 名称行(nameFS) + gap(2) + 价格行(costFS) */
    const gapN = 3, gapC = 2;
    const H = padY * 2 + iconR * 2 + gapN + nameFS + gapC + costFS;

    const box = this.add.container(0, 0).setDepth(700).setVisible(false);

    /* 外发光（白边外圈）+ 半透明深色框体 + 白色描边，Canvas/WebGL 通用 */
    const bg = this.add.graphics();
    bg.fillStyle(0xffffff, 0.14);
    bg.fillRoundedRect(-W / 2 - 3, -H / 2 - 3, W + 6, H + 6, 12);
    bg.fillStyle(0x101828, 0.86);
    bg.fillRoundedRect(-W / 2, -H / 2, W, H, 10);
    bg.lineStyle(2, 0xffffff, 0.72);
    bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 10);
    box.add(bg);

    const iconCy = -Math.round(H / 2 - padY - iconR);
    const nameCy = Math.round(iconCy + iconR + gapN + nameFS / 2);
    const costCy = Math.round(nameCy + nameFS / 2 + gapC + costFS / 2);
    const left = -innerW / 2 + itemW / 2;

    /* 文字统一高分辨率：分辨率 = clamp(devicePixelRatio, 2, 3)，避免小字号半像素模糊 */
    const textRes = Math.round(Math.min(Math.max(window.devicePixelRatio || 1, 2), 3));

    /* 4x 超采样烘焙塔图标纹理：在世界坐标画 52px 圆 → 缓存为 208px 纹理，
       缩小显示时边缘清晰（等效 128-256px PNG 方案，无外部资源依赖）。
       第一次打开时创建，后续复用缓存（per-key，含可用/置灰双色）。 */
    for (const tk of types) {
      const col = colors[tk] != null ? colors[tk] : (TD_CONFIG.towers[tk].color || 0xffffff);
      const gkey = '_pickerIcon_' + tk;
      const gkeyGray = gkey + '_g';
      if (!this.textures.exists(gkey)) {
        this._bakePickerIcon(gkey, col, 1.0, 0.9);       // 可用态：完全不透明
        this._bakePickerIcon(gkeyGray, col, 0.22, 0.28); // 置灰态
      }
    }

    types.forEach((tk, i) => {
      const tc = TD_CONFIG.towers[tk];
      const afford = this.gold >= tc.cost;
      const cx = Math.round(left + i * (itemW + gap));
      const texKey = afford ? '_pickerIcon_' + tk : '_pickerIcon_' + tk + '_g';

      /* 图标：Image 显示 52px，内部纹理为 208px，缩小后边缘抗锯齿 */
      const iconImg = this.add.image(cx, iconCy, texKey).setOrigin(0.5);
      iconImg.setDisplaySize(iconR * 2, iconR * 2);
      box.add(iconImg);

      /* 中心单字标识（在图标上层，直接文字清晰） */
      const glyph = this.add.text(cx, iconCy + 1, glyphs[tk] || '', {
        fontFamily: TD_FONT_STACK, fontSize: (iconR - 1) + 'px', fontStyle: 'bold',
        color: afford ? '#ffffff' : '#cfd4da', resolution: textRes
      }).setOrigin(0.5);
      glyph.setAlpha(afford ? 1 : 0.4);
      box.add(glyph);

      const name = this.add.text(cx, nameCy, tc.name, {
        fontFamily: TD_FONT_STACK, fontSize: nameFS + 'px', fontStyle: 'bold',
        color: afford ? '#ffffff' : '#aab0b8', resolution: textRes
      }).setOrigin(0.5);
      box.add(name);

      const cost = this.add.text(cx, costCy, '🪙' + tc.cost, {
        fontFamily: TD_FONT_STACK, fontSize: costFS + 'px', fontStyle: 'bold',
        color: afford ? '#ffd66b' : '#9aa0a8', resolution: textRes
      }).setOrigin(0.5);
      box.add(cost);

      /* 整条塔槽为热区（放大触控）；置灰槽仍可点击，点击给金币不足提示 */
      const zone = this.add.zone(cx, 0, itemW, H).setInteractive({ useHandCursor: afford });
      zone.setData('ui', true);
      zone.on('pointerdown', () => this.pickTowerFromBox(tk));
      box.add(zone);
    });

    /* 定位：优先上方（手指在火力点处，不遮挡内容）；顶不下则翻下方；
       横向钳制在画面内 */
    const s = this.pickerScale(W, H);
    box.setScale(s);
    let py = spot.y - offY - H / 2;
    if (py - H / 2 < edge) py = spot.y + offY + H / 2;
    py = Phaser.Math.Clamp(py, H / 2 + edge, this.H - H / 2 - edge);
    const px = Phaser.Math.Clamp(spot.x, W / 2 + edge, this.W - W / 2 - edge);
    box.setPosition(px, py);

    box.setAlpha(0).setVisible(true);
    this.tweens.add({ targets: box, alpha: 1, duration: 140, ease: 'Cubic.out' });

    this.picker = box;
    this._pickSpot = spot;
    this._spotHint = false;               // 进入浮框态，退出纯提示模式
    this.highlightPlacementPoints(spot);  // 金色当前点 + 其他全部绿色高亮
  }

  /** 4x 超采样烘焙塔图标纹理：生成高分辨率圆图标缓存，供 Image 缩小显示。
   *  worldR：世界坐标显示半径（如 13）
   *  fillAlpha / strokeAlpha：填充与描边不透明度（可用态 1.0/0.9，置灰态 0.22/0.28）
   *  纹理尺寸 = worldR×2×4，等效 128-256px PNG 清晰度 */
  _bakePickerIcon(key, color, fillAlpha, strokeAlpha) {
    const worldR = (this.buildCfg.picker && this.buildCfg.picker.iconR) || 13;
    const scale = 4;          // 4x 超采样
    const texSize = Math.ceil(worldR * 2 * scale);
    const tex = this.textures.createCanvas(key, texSize, texSize);
    const ctx = tex.getContext();
    const c = texSize / 2;
    const r = (texSize / 2) - 2;   // 留 2px 边距防止抗锯齿裁切

    ctx.clearRect(0, 0, texSize, texSize);
    ctx.fillStyle = 'rgba(' + ((color >> 16) & 0xff) + ',' + ((color >> 8) & 0xff) + ',' + (color & 0xff) + ',' + fillAlpha + ')';
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = scale * 1.5;   // 等效 1.5px 世界描边
    ctx.strokeStyle = 'rgba(255,255,255,' + strokeAlpha + ')';
    ctx.beginPath();
    ctx.arc(c, c, r - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();

    tex.refresh();
  }

  /** 点击浮框中的某个塔：校验金币与火力点合法性后立即落塔关闭浮框 */
  pickTowerFromBox(typeKey) {
    const spot = this._pickSpot;
    if (!spot) return;
    if (!TDStorage.isTowerUnlocked(typeKey, this.levelId)) return;
    const cfg = TD_CONFIG.towers[typeKey];
    if (this.gold < cfg.cost) {
      this.floatText(spot.x, spot.y - 32, '🪙 金币不足', 0xffd66b);
      return;
    }
    if (!this.canBuildAt(spot.x, spot.y, spot.key)) {
      this.floatText(spot.x, spot.y - 32, '✕ 不能放这里', 0xff9d9d);
      this.closeTowerPicker();
      return;
    }
    if (this.placeTower(spot.x, spot.y, spot.key, typeKey)) {
      this.closeTowerPicker();
    }
  }

  /** 关闭选塔浮框；immediate=true 时不播淡出（切换/落子/场景清理用）；
   *  keepHighlight=true 时保留绿色高亮层（点空白时浮框关闭、转为"纯
   *  提示高亮"模式，由调用方随后用 highlightPlacementPoints(null) 重绘）。 */
  closeTowerPicker(immediate, keepHighlight) {
    const box = this.picker;
    this.picker = null;
    this._pickSpot = null;
    if (keepHighlight) {
      this.clearSpotHighlight();        // 仅去金色标记，绿框保留待重绘
    } else {
      this.clearPlacementHighlight();   // 浮框+全部高亮+提示态一并清除
    }
    if (!box) return;
    this.tweens.killTweensOf(box);
    if (immediate) { box.destroy(true); return; }
    this.tweens.add({
      targets: box, alpha: 0, duration: 140, ease: 'Cubic.in',
      onComplete: () => { if (box && box.scene) box.destroy(true); }
    });
  }

  /** 被点击火力点的金色脉冲高亮（比常驻方格大一圈） */
  drawSpotHighlight(h) {
    const g = this.spotHlGfx;
    g.clear();
    g.setAlpha(1);
    const b = this.buildCfg;
    const size = (b.spotSize || 36) + 10;
    const r = (b.spotRadius || 10) + 3;
    g.fillStyle(0xffe27a, 0.16);
    g.fillRoundedRect(h.x - size / 2, h.y - size / 2, size, size, r);
    g.lineStyle(3.5, 0xffe27a, 0.95);
    g.strokeRoundedRect(h.x - size / 2, h.y - size / 2, size, size, r);
    this.tweens.killTweensOf(g);
    this.tweens.add({ targets: g, alpha: 0.4, duration: 420, yoyo: true, repeat: -1 });
  }

  clearSpotHighlight() {
    const g = this.spotHlGfx;
    this.tweens.killTweensOf(g);
    g.setAlpha(1).clear();
  }

  /* ============================================================
   * 可放置区域高亮 —— 统一入口（所有关卡通用）
   *   highlightPlacementPoints(activeSpot)
   *     · activeSpot 有值（点击火力点、选塔框弹出）：该点金色脉冲 +
   *       其余所有可放置区域绿色描边方框 + 脉冲；
   *     · activeSpot 为 null（点击空白区域的纯提示）：全部可放置区域
   *       亮起绿色描边方框 + 脉冲，无金色标记、无选塔框。
   *   clearPlacementHighlight()
   *     · 关闭全部高亮并退出提示模式（落塔/点道路/点塔/切关时调用）。
   * 范围：仅 hotspots 中 canBuildAt 通过（未占用、不压路、在界内）的点；
   *       道路、装饰物、障碍物、已被占用点一律不高亮。
   * ============================================================ */
  highlightPlacementPoints(activeSpot) {
    if (activeSpot) {
      this.drawOtherSpotsHighlight(activeSpot);
      this.drawSpotHighlight(activeSpot);
    } else {
      this.clearSpotHighlight();
      this.drawOtherSpotsHighlight(null);
    }
  }

  clearPlacementHighlight() {
    this._spotHint = false;
    this.clearSpotHighlight();
    this.clearOtherSpotsHighlight();
  }

  /* ============================================================
   * 其他可放置区域高亮（选塔浮框弹出期间显示）
   * 作用：玩家点击一个火力点放塔时，屏幕上其余所有可放置区域同步
   *       亮起半透明绿色描边方框 + 轻脉冲，让玩家一眼看清哪里还能
   *       放塔；关闭浮框即清除。
   * 范围：仅 hotspots 中可放塔且未被占用的点；跳过当前点击点（已由
   *       金色脉冲高亮单独标记）。装饰物、道路、已被占用点不高亮。
   * ============================================================ */

  /** 绘制其他可放置区域高亮（半透明绿框 + 轻脉冲），activeSpot 为当前被点击点 */
  drawOtherSpotsHighlight(activeSpot) {
    const g = this.spotOtherHlGfx;
    this.tweens.killTweensOf(g);
    g.clear();
    g.setAlpha(1);
    const b = this.buildCfg;
    const pk = (b.picker && b.picker.otherSpots) || {};
    const sizeBonus = pk.sizeBonus != null ? pk.sizeBonus : 6;
    const radiusBonus = pk.radiusBonus != null ? pk.radiusBonus : 2;
    const size = (b.spotSize || 36) + sizeBonus;
    const r = (b.spotRadius || 10) + radiusBonus;
    const fill = pk.fill != null ? pk.fill : 0x7CFC00;
    const fillA = pk.fillAlpha != null ? pk.fillAlpha : 0.16;
    const border = pk.border != null ? pk.border : 0x2e7d1c;
    const borderA = pk.borderAlpha != null ? pk.borderAlpha : 0.85;
    let drew = 0;
    const activeKey = activeSpot && activeSpot.key;
    for (const h of this.hotspots) {
      if (activeKey && h.key === activeKey) continue;        // 跳过当前点击点
      if (!this.canBuildAt(h.x, h.y, h.key)) continue;        // 仅可放且未占用
      const x0 = h.x - size / 2, y0 = h.y - size / 2;
      g.fillStyle(fill, fillA);
      g.fillRoundedRect(x0, y0, size, size, r);
      g.lineStyle(2.5, border, borderA);
      g.strokeRoundedRect(x0, y0, size, size, r);
      drew++;
    }
    g._tdDrew = drew;   // 实际绘制的高亮框数量（可观测/测试用，0=无高亮）
    if (drew > 0) {
      const lo = pk.pulseMin != null ? pk.pulseMin : 0.35;
      const hi = pk.pulseMax != null ? pk.pulseMax : 0.75;
      const dur = pk.duration != null ? pk.duration : 600;
      this.tweens.add({
        targets: g, alpha: { from: hi, to: lo },
        duration: dur, yoyo: true, repeat: -1, ease: 'Sine.inOut'
      });
    }
  }

  /** 清除其他可放置区域高亮（关闭选塔浮框时调用） */
  clearOtherSpotsHighlight() {
    const g = this.spotOtherHlGfx;
    this.tweens.killTweensOf(g);
    g.setAlpha(1).clear();
    g._tdDrew = 0;
  }

  drawRange(x, y, range, color) {
    const g = this.rangeGfx;
    g.clear();
    g.lineStyle(2, color, 0.85);
    g.fillStyle(color, 0.10);
    g.fillCircle(x, y, range);
    g.strokeCircle(x, y, range);
  }

  /* ============================================================
   * 弹道与特效
   * ============================================================ */
  fireProjectile(tower, target) {
    /* 发射点：火塔从旋转后的火焰根部（底部中心）出弹；其他塔保持塔中心 */
    const m = (typeof tower.getMuzzlePos === 'function')
      ? tower.getMuzzlePos() : { x: tower.x, y: tower.y - 4 };
    this.projectiles.push(
      new Projectile(this, m.x, m.y, target, tower.cfg.projectile, tower.stats.damage, tower)
    );
  }

  /* ============================================================
   * 塔D 范围吸引脉冲动画（多目标，纯视觉，不造成伤害）：
   *   1) 塔心向射程边缘扩散一圈紫色吸引光环；
   *   2) 每个被吸小怪紫色一闪 + 轻微收缩（多目标逐个反馈）；
   *   3) 炮头一次脉冲缩放，表示本次范围攻击已释放。
   * 频率由 PullBehavior 保证（每 2 秒开窗仅回调一次）。
   * ============================================================ */
  playPullPulse(tower, range, targets) {
    const color = tower.cfg.color;

    /* 1) 扩散光环：描边圈 + 极淡填充，从塔心扩到射程边缘 */
    const ring = this.add.graphics().setDepth(45);
    const st = { r: 16, a: 0.9 };
    this.tweens.add({
      targets: st, r: range, a: 0,
      duration: 420, ease: 'Quad.out',
      onUpdate: () => {
        ring.clear();
        ring.fillStyle(color, st.a * 0.08);
        ring.fillCircle(tower.x, tower.y, st.r);
        ring.lineStyle(4, color, st.a);
        ring.strokeCircle(tower.x, tower.y, st.r);
      },
      onComplete: () => ring.destroy()
    });

    /* 2) 每个被吸小怪：紫色吸引闪光 + 轻微收缩回弹（数量即多目标反馈） */
    for (const e of targets) {
      if (!e.body || e.dead) continue;
      e.body.setTint(0xd9b8ff);
      this.tweens.add({
        targets: e, scaleX: 0.92, scaleY: 0.92,
        duration: 120, yoyo: true,
        onComplete: () => { try { e.setScale(1); } catch (_) {} }
      });
      /* 闪光结束后恢复原色；若正处于减速（塔B 蓝色 tint）则还原减速色 */
      this.time.delayedCall(260, () => {
        try {
          if (e.dead) return;
          if (e.slowTimer > 0) e.body.setTint(0xbbeeff);
          else e.body.clearTint();
        } catch (_) {}
      });
    }

    /* 3) 炮头脉冲缩放（相对当前缩放，适配美术贴图 setDisplaySize 后的非 1 缩放） */
    const sx = tower.turret.scaleX, sy = tower.turret.scaleY;
    this.tweens.add({
      targets: tower.turret,
      scaleX: sx * 1.18, scaleY: sy * 1.18,
      duration: 110, yoyo: true
    });
  }

  spawnSplashFx(x, y, radius, color) {
    const g = this.add.graphics().setPosition(x, y).setDepth(45);
    g.fillStyle(color, 0.35);
    g.fillCircle(0, 0, 10);
    this.tweens.add({
      targets: g, scaleX: radius / 10, scaleY: radius / 10, alpha: 0,
      duration: 320, onComplete: () => g.destroy()
    });
  }

  /* ============================================================
   * 塔E 电链弹跳视觉：折线闪电连线 + 被击中怪短暂高亮。
   * points = [{x,y}, ...] 从塔头到每个被击中怪的路径点；
   * 用折线（每段中点加随机偏移）模拟锯齿闪电，持续 visualDuration 秒后淡出。
   * ============================================================ */
  spawnChainFx(points, color, duration) {
    if (!points || points.length < 2) return;
    const dur = Math.round((duration || 0.25) * 1000);
    const g = this.add.graphics().setDepth(46);
    /* 绘制锯齿折线：每对相邻点之间插入 2 个偏移中点模拟闪电分叉 */
    const drawLightning = (alpha) => {
      g.clear();
      /* 外发光（粗、半透明） */
      g.lineStyle(8, color, alpha * 0.30);
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const mx = (a.x + b.x) / 2 + (Math.random() - 0.5) * 18;
        const my = (a.y + b.y) / 2 + (Math.random() - 0.5) * 18;
        g.lineBetween(a.x, a.y, mx, my);
        g.lineBetween(mx, my, b.x, b.y);
      }
      /* 内芯（细、亮、白色） */
      g.lineStyle(3, 0xffffff, alpha);
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const mx = (a.x + b.x) / 2 + (Math.random() - 0.5) * 14;
        const my = (a.y + b.y) / 2 + (Math.random() - 0.5) * 14;
        g.lineBetween(a.x, a.y, mx, my);
        g.lineBetween(mx, my, b.x, b.y);
      }
      /* 被击中怪位置画一个小爆点（除起点塔头外） */
      g.fillStyle(color, alpha * 0.7);
      for (let i = 1; i < points.length; i++) {
        g.fillCircle(points[i].x, points[i].y, 6);
      }
    };

    drawLightning(1);
    /* 闪电持续闪烁后淡出（duration 内重绘 2 次制造闪烁感） */
    this.time.delayedCall(Math.round(dur * 0.4), () => { try { drawLightning(0.85); } catch(_){} });
    this.time.delayedCall(Math.round(dur * 0.7), () => { try { drawLightning(0.5); } catch(_){} });

    /* 被击中怪短暂高亮（白色 tint + 轻微缩放），路径点从 index 1 起 = 被击中怪 */
    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      /* 在敌人列表中找位置最接近的敌人做高亮 */
      let best = null, bestD = 20;
      for (const e of this.enemies) {
        if (e.dead || !e.body) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) {
        best.body.setTint(0xffff99);
        this.tweens.add({
          targets: best, scaleX: 1.12, scaleY: 1.12,
          duration: 80, yoyo: true,
          onComplete: () => { try { best.setScale(1); } catch(_){} }
        });
        this.time.delayedCall(dur, () => {
          try {
            if (best.dead) return;
            if (best.slowTimer > 0) best.body.setTint(0xbbeeff);
            else best.body.clearTint();
          } catch(_){}
        });
      }
    }

    /* 淡出后销毁 */
    this.tweens.add({
      targets: g, alpha: 0,
      duration: dur, delay: Math.round(dur * 0.5),
      onComplete: () => g.destroy()
    });
  }

  spawnHitFx(x, y, color) {
    const g = this.add.graphics().setPosition(x, y).setDepth(45);
    g.fillStyle(color, 0.9);
    g.fillCircle(0, 0, 5);
    this.tweens.add({
      targets: g, scaleX: 2.2, scaleY: 2.2, alpha: 0,
      duration: 180, onComplete: () => g.destroy()
    });
  }

  /* ============================================================
   * 风元素塔：元素扩散
   * 新反应模式（第 6 关起，规则见 elementSystem）：
   *   - 扩散目标元素 = center 身上【最早附着】的元素（火/冰/水/雷均可，含水）；
   *   - 每个目标附着 spreadAmount(1) 单位，center 元素量【不减少】（额外附加）；
   *   - 最多 spreadMaxTargets(5) 个：半径内【身上没有该元素】的小怪，
   *     按距离从近到远选取（可带着其他元素，被扩散元素照常与其反应）；
   *   - sourceEl=null：扩散可触发反应特效/冰冻，但不享受任何伤害倍率；
   *   - targetFilter=nonBoss：BOSS 不被扩散（center 不限）。
   * 旧印记模式（1~5 关）：保持原逻辑——扩散给半径内所有【完全无元素】的
   *   小怪，冰扩散附带真实减速，其余为视觉印记传播。
   * ============================================================ */
  spreadElement(center, eff) {
    const r = (eff && eff.spreadRadius != null) ? eff.spreadRadius : 90;
    const nonBossOnly = !eff || eff.targetFilter === 'nonBoss';

    /* ---- 新反应模式 ---- */
    if (center.reactionsEnabled) {
      const el = (typeof center.primaryElement === 'function') ? center.primaryElement() : null;
      if (!el) return;
      const sys = TD_CONFIG.elementSystem || {};
      const amount = (eff && eff.spreadAmount != null)
        ? eff.spreadAmount
        : (sys.spreadAmount != null ? sys.spreadAmount : 1);
      const maxTargets = (eff && eff.spreadMaxTargets != null)
        ? eff.spreadMaxTargets : 5;
      const conf = (TD_CONFIG.elements || {})[el] || {};
      const color = conf.color != null ? conf.color : 0xbfffd9;

      /* 候选：半径内、非 center、非 BOSS（按配置）、身上【没有该元素】的小怪 */
      const cands = [];
      for (const e of this.enemies) {
        if (e.dead || e.invulnTimer > 0 || e === center) continue;
        if (nonBossOnly && ((e.cfg && e.cfg.boss) || e.bossMini)) continue;
        if (typeof e.hasElement === 'function' && e.hasElement(el)) continue;
        const d = Phaser.Math.Distance.Between(center.x, center.y, e.x, e.y);
        if (d > r + e.radius) continue;
        cands.push({ e, d });
      }
      cands.sort((a, b) => a.d - b.d); // 最近优先

      /* 扩散光环：以目标为中心的元素色圆环，半径扩到扩散范围 */
      this.spawnSpreadFx(center.x, center.y, r, color);

      const n = Math.min(maxTargets, cands.length);
      for (let i = 0; i < n; i++) {
        const target = cands[i].e;
        /* 额外附着 1 单位：center 不扣量；sourceEl=null 不享受倍率；
           目标身上的其他元素照常与扩散元素反应（含水元素） */
        target.attachElement(el, amount, null);
        this.spawnSpreadHitFx(target.x, target.y, color);
      }
      return;
    }

    /* ---- 旧印记模式（1~5 关原样） ---- */
    const el = center.element;
    if (!el || center.elementTimer <= 0) return;
    const dur = (eff && eff.spreadDuration != null) ? eff.spreadDuration : 3;
    const conf = (TD_CONFIG.elements || {})[el] || {};
    const color = conf.color != null ? conf.color : 0xbfffd9;

    /* 扩散光环：以目标为中心的元素色圆环，半径扩到扩散范围 */
    this.spawnSpreadFx(center.x, center.y, r, color);

    for (const e of this.enemies) {
      if (e.dead || e.invulnTimer > 0 || e === center) continue;
      if (nonBossOnly && ((e.cfg && e.cfg.boss) || e.bossMini)) continue;   // BOSS/小BOSS 不被扩散
      if (e.element && e.elementTimer > 0) continue;      // 已有元素：不覆盖
      if (Phaser.Math.Distance.Between(center.x, center.y, e.x, e.y) > r + e.radius) continue;

      if (el === 'ice') {
        /* 冰元素扩散 = 真实减速（applySlow 内自动挂上冰印记） */
        e.applySlow(
          eff.iceSlowFactor != null ? eff.iceSlowFactor : 0.5,
          Math.min(dur, eff.iceSlowDuration != null ? eff.iceSlowDuration : dur)
        );
      } else {
        /* 火/雷/水：视觉印记传播（不改变任何数值） */
        e.applyElement(el, dur);
      }
      /* 被扩散的小怪身上播放短暂元素光效，明确提示“元素被传播了” */
      this.spawnSpreadHitFx(e.x, e.y, color);
    }
  }

  /* 扩散光环：从命中点扩散到 spreadRadius 的元素色圆环（纯视觉） */
  spawnSpreadFx(x, y, radius, color) {
    const ring = this.add.graphics().setDepth(45);
    const st = { r: 14, a: 0.85 };
    this.tweens.add({
      targets: st, r: radius, a: 0,
      duration: 380, ease: 'Quad.out',
      onUpdate: () => {
        ring.clear();
        ring.fillStyle(color, st.a * 0.10);
        ring.fillCircle(x, y, st.r);
        ring.lineStyle(3, color, st.a);
        ring.strokeCircle(x, y, st.r);
      },
      onComplete: () => ring.destroy()
    });
  }

  /* 被扩散小怪的短暂元素光效：小圆环炸开 + 白芯一闪（纯视觉） */
  spawnSpreadHitFx(x, y, color) {
    const g = this.add.graphics().setDepth(46);
    const st = { r: 4, a: 0.9 };
    this.tweens.add({
      targets: st, r: 16, a: 0,
      duration: 260, ease: 'Quad.out',
      onUpdate: () => {
        g.clear();
        g.lineStyle(2.5, color, st.a);
        g.strokeCircle(x, y, st.r);
        /* 内芯用元素色（非白色），避免攻击时地图上随机闪过白色亮光 */
        g.fillStyle(color, st.a * 0.6);
        g.fillCircle(x, y, st.r * 0.4);
      },
      onComplete: () => g.destroy()
    });
  }

  /* ============================================================
   * 元素反应特效（rule.fx 驱动）：怪身位置一圈元素色光环 + 数颗向外迸射
   * 的火花/冰晶/电弧，上方飘反应名（有伤害倍率时附带 ×N）。
   *   melt 融化（火+冰，暖橙火光）/ vaporize 蒸发（火+水，青白蒸汽）/
   *   freeze 冰冻（水+冰，冰蓝，无倍率）/ charged 感电（水+雷，明黄电弧）/
   *   overload 超载（火+雷，橙黄爆炸，光环更大）/
   *   superconductor 超导（冰+雷，淡蓝碎冰）。
   * ============================================================ */
  spawnReactionFx(enemy, rule, mult) {
    if (!enemy || !rule) return;
    const x = enemy.x, y = enemy.y;
    const presets = {
      melt:           { color: 0xff8a3d, ring: 26, sparks: 8 },
      vaporize:       { color: 0xcfeeff, ring: 24, sparks: 6 },
      freeze:         { color: 0x8fd8ff, ring: 22, sparks: 6 },
      charged:        { color: 0xffe23b, ring: 24, sparks: 7 },
      overload:       { color: 0xffb02e, ring: 34, sparks: 10 },
      superconductor: { color: 0xa9e6ff, ring: 26, sparks: 8 }
    };
    const p = presets[rule.fx] || presets.melt;

    /* 光环爆散 */
    const ring = this.add.graphics().setDepth(47);
    const rs = { r: 8, a: 0.95 };
    this.tweens.add({
      targets: rs, r: p.ring, a: 0,
      duration: 300, ease: 'Quad.out',
      onUpdate: () => {
        ring.clear();
        ring.fillStyle(p.color, rs.a * 0.12).fillCircle(x, y, rs.r);
        ring.lineStyle(3, p.color, rs.a).strokeCircle(x, y, rs.r);
      },
      onComplete: () => ring.destroy()
    });

    /* 火花/冰晶/电弧迸射（10 个小亮点各带随机方向，随机绘制在同一 graphics） */
    const parts = [];
    for (let i = 0; i < p.sparks; i++) {
      const ang = (Math.PI * 2 * i) / p.sparks + Math.random() * 0.5;
      const dist = 14 + Math.random() * 12;
      parts.push({ x: x, y: y, dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist, r: 2 + Math.random() * 1.6 });
    }
    const spark = this.add.graphics().setDepth(47);
    const ss = { t: 0 };
    this.tweens.add({
      targets: ss, t: 1,
      duration: 320, ease: 'Cubic.out',
      onUpdate: () => {
        spark.clear();
        for (const pt of parts) {
          spark.fillStyle(p.color, 0.9 * (1 - ss.t));
          spark.fillCircle(pt.x + pt.dx * ss.t, pt.y + pt.dy * ss.t, pt.r * (1 - ss.t * 0.5));
        }
      },
      onComplete: () => spark.destroy()
    });

    /* 反应名 + 倍率（冰冻无倍率；风塔扩散触发的反应 mult=0 也不显示倍率） */
    const label = rule.label + (mult && mult > 1 ? ' ×' + mult : '');
    this.floatText(x, y - enemy.radius - 14, label, p.color);
  }

  /* 提前破冰特效：冰蓝碎块四溅 + 白色冰环 */
  spawnShatterFx(x, y) {
    const ring = this.add.graphics().setDepth(47);
    const rs = { r: 10, a: 0.9 };
    this.tweens.add({
      targets: rs, r: 26, a: 0,
      duration: 260, ease: 'Quad.out',
      onUpdate: () => {
        ring.clear();
        ring.lineStyle(2.5, 0xbfe8ff, rs.a).strokeCircle(x, y, rs.r);
      },
      onComplete: () => ring.destroy()
    });
    const shards = [];
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
      shards.push({ x, y, dx: Math.cos(ang) * (14 + Math.random() * 10), dy: Math.sin(ang) * (14 + Math.random() * 10) });
    }
    const g = this.add.graphics().setDepth(47);
    const st = { t: 0 };
    this.tweens.add({
      targets: st, t: 1,
      duration: 300, ease: 'Cubic.out',
      onUpdate: () => {
        g.clear();
        g.fillStyle(0xdff3ff, 1 - st.t);
        for (const s of shards) {
          g.fillRect(s.x + s.dx * st.t - 1.5, s.y + s.dy * st.t - 1.5, 3, 3);
        }
      },
      onComplete: () => g.destroy()
    });
    this.floatText(x, y - 24, '裂甲 +1', 0xff7a7a);
  }

  floatText(x, y, text, color) {
    x = Math.round(x); y = Math.round(y);   // 坐标取整，避免半像素发虚
    const t = this.add.text(x, y, text, {
      fontFamily: TD_FONT_STACK,
      fontSize: '14px', fontStyle: 'bold',
      color: '#' + color.toString(16).padStart(6, '0'),
      resolution: TD_TEXT_RES
    }).setOrigin(0.5).setDepth(700).setStroke('#2b2230', 3);
    this.tweens.add({
      targets: t, y: y - 34, alpha: 0,
      duration: 800, ease: 'Cubic.out', onComplete: () => t.destroy()
    });
  }

  banner(text, color) {
    const t = this.add.text(this.W / 2, this.H / 2 - 60, text, {
      fontFamily: TD_FONT_STACK,
      fontSize: '30px', fontStyle: 'bold',
      color: '#' + color.toString(16).padStart(6, '0'),
      resolution: TD_TEXT_RES
    }).setOrigin(0.5).setDepth(800).setStroke('#2b2230', 5).setScale(0);
    this.tweens.chain({
      targets: t,
      tweens: [
        { scale: 1, duration: 220, ease: 'Back.out' },
        { alpha: 0, y: this.H / 2 - 100, duration: 700, delay: 600 }
      ],
      onComplete: () => t.destroy()
    });
  }

  /* ============================================================
   * DOM HUD / 商店 / 暂停 / 倍速
   * ============================================================ */
  initDom() {
    window.__tdScene = this;
    document.getElementById('overlay-end').classList.add('hidden');
    document.getElementById('overlay-pause').classList.add('hidden');

    const bindOnce = (id, evt, fn) => {
      const el = document.getElementById(id);
      if (!el.dataset.bound) {
        el.dataset.bound = '1';
        el.addEventListener(evt, fn);
      }
    };

    bindOnce('btn-pause', 'click', () => window.__tdScene && window.__tdScene.togglePause());
    bindOnce('btn-resume', 'click', () => window.__tdScene && window.__tdScene.togglePause());
    /* 暂停菜单「返回选关」：退出当前关卡回选关页（进度不保存，goToLevelSelect 统一处理） */
    bindOnce('btn-pause-levels', 'click', () => window.__tdScene && window.__tdScene.goToLevelSelect());
    bindOnce('btn-speed', 'click', () => window.__tdScene && window.__tdScene.toggleSpeed());
    /* ---- 移动端「暂停 + 倍速」合并菜单（电脑端 #mobile-menu 隐藏，绑定无副作用） ---- */
    bindOnce('btn-mobile-menu', 'click', (ev) => {
      ev.stopPropagation();
      const menu = document.getElementById('mobile-menu');
      if (menu) menu.classList.toggle('open');
    });
    bindOnce('m-menu-pause', 'click', () => {
      const s = window.__tdScene;
      if (s) s.togglePause();
      const menu = document.getElementById('mobile-menu');
      if (menu) menu.classList.remove('open');
    });
    /* 1x/2x：仅在与当前倍速不同时切换（toggleSpeed 在 1↔2 间翻转），随后收起面板 */
    bindOnce('m-menu-speed1', 'click', () => {
      const s = window.__tdScene;
      if (s && s.speedMul !== 1) s.toggleSpeed();
      const menu = document.getElementById('mobile-menu');
      if (menu) menu.classList.remove('open');
    });
    bindOnce('m-menu-speed2', 'click', () => {
      const s = window.__tdScene;
      if (s && s.speedMul !== 2) s.toggleSpeed();
      const menu = document.getElementById('mobile-menu');
      if (menu) menu.classList.remove('open');
    });
    /* 点击菜单外部任意区域自动收起（文档级只绑一次，场景重开不重复绑定） */
    if (!document.body.dataset.mobileMenuBound) {
      document.body.dataset.mobileMenuBound = '1';
      document.addEventListener('pointerdown', (ev) => {
        const menu = document.getElementById('mobile-menu');
        if (menu && menu.classList.contains('open') && !menu.contains(ev.target)) {
          menu.classList.remove('open');
        }
      });
    }
    bindOnce('btn-wave', 'click', () => {
      const s = window.__tdScene;
      if (s && s.state === 'ready') s.startWave();
    });
    bindOnce('btn-restart', 'click', () => {
      const s = window.__tdScene;
      if (s) s.scene.restart({ levelId: s.levelId });
    });
    bindOnce('btn-to-levels', 'click', () => window.__tdScene && window.__tdScene.goToLevelSelect());

    document.querySelectorAll('.btn-tower').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const s = window.__tdScene;
        if (!s) return;
        const type = btn.dataset.type;
        /* 未解锁塔（第 1 关的塔D）：不进入放置模式，画布中央提示解锁条件 */
        if (!TDStorage.isTowerUnlocked(type, s.levelId)) {
          const need = TDStorage.towerUnlockLevel(type);
          s.floatText(s.W / 2, s.H - 130,
            TD_CONFIG.towers[type].name + '：通关第 ' + (need - 1) + ' 关后，第 ' + need + ' 关解锁',
            0xffffff);
          return;
        }
        s.setPlacement(s.selectedType === type ? null : type);
      });
    });

    /* 塔 D 真实运行时自查钩子：控制台调用 window.__tdPullTest() 即可。
       在当前已运行的 GameScene 内构造真实 Tower D + 真实 Enemy，
       由真实 update 循环驱动，验证：沿路回拉生效、不出道路、
       脉冲每 2s 一次、间隙回弹归位、ctrlSlow 期间仍继续前进。 */
    window.__tdPullTest = () => this.runPullTest();
    /* 风元素塔「风刃 + 元素扩散」真实运行时自查：控制台 window.__tdWindTest() */
    window.__tdWindTest = () => this.runWindTest();
    /* 元素反应系统真实运行时自查（附着量/系数/倍率归属/冰冻易伤/BOSS减速）：
       控制台 window.__tdReactionTest()，任何关卡内均可运行 */
    window.__tdReactionTest = () => this.runElementTest();
  }

  /**
   * 塔 D「沿路吸附·范围多目标」真实运行时自查（控制台 window.__tdPullTest()）。
   * 几何夹具（Level 2 路径，建议在第 2 关内运行；Level 1 首段同为 y=100 水平段）：
   *   段0 (-40,100)→(720,100)，段1 (720,100)→(720,250)。
   *   塔1 (300,200)：投影点 footDist=340；塔2 (780,150) 卡拐角，投影 footDist=810。
   *   小怪 e1 380（距≈108）、e2 400（≈117）、eA 420（≈128）均在塔1射程 200 内，
   *   同一脉冲必须【全部】被回拉；eBoss 420 同为 cfg.boss，必须免疫；
   *   eB 560（世界 (520,100)）距塔1≈241、距塔2≈265，两塔射程外；
   *   eD 850 在拐角竖段（回拉 40，严格竖直、x 恒 720）。
   *   射程边界（塔1 (300,200)，路径 y=100，段0 起点 x=-40）：
   *   eEdgeIn pathDist 510（世界点 (470,100) 距≈197<200）必须被吸；
   *   eEdgeOut pathDist 520（世界点 (480,100) 距≈206>200）必须安全不被吸。
   *   向前吸引镜像对（投影点 footDist=340 之前）：eF1 pathDist 300（世界
   *   (260,100)，前 40）与 e1 对称；eF2 pathDist 200（世界 (160,100)，前
   *   140→限幅 95）与 eEdgeIn 对称——两者 pullBack 必须为负（向前拉近），
   *   且绝对值与镜像怪相等，证明双向同速率、等力度。
   * 时序（脉冲 0–0.5s，间隙 0.5–2.0s，第二次脉冲 2.0–2.5s）：
   *   0.15s 查范围目标集/BOSS免疫/多目标动画（紫闪、炮头朝向、脉冲计数 1）；
   *   0.3s 查首次吸附 + 在路；0.3–0.5s 查 ctrlSlow；
   *   0.58s 查【烘焙】：pullBack 归零但 pathDist 已改变、位置停留不弹回；
   *   0.58–1.55s 查小怪从新位置全速继续沿路走；
   *   1.9s 查脉冲间隙；1.95s 把静止夹具复位到初始里程（模拟继续行走），
   *   2.2s 查第二次脉冲（计数 2）。
   */
  async runPullTest() {
    const report = { step: 'init', tower: null, phase0: null, phase1: null, ctrlSlow: null,
                     release: null, intervalGap: null, secondPulse: null,
                     conclusion: null, error: null };
    try {
      // 清残留测试对象（重复调用时）
      this._pullTestObjs = this._pullTestObjs || { towers: [], enemies: [] };
      this._pullTestObjs.towers.forEach(t => { try { t.destroy(); } catch(_){} });
      this._pullTestObjs.enemies.forEach(e => { try { e.destroyImmediately && e.destroyImmediately(); } catch(_){ try{e.destroy&&e.destroy();}catch(_){} } });
      this._pullTestObjs = { towers: [], enemies: [] };

      const mkTower = (x, y) => {
        const tw = new Tower(this, x, y, 'towerD');
        this.towers.push(tw);
        this._pullTestObjs.towers.push(tw);
        return tw;
      };
      const mkEnemy = (dist, typeKey) => {
        const e = new Enemy(this, typeKey || 'enemyX');
        e.pathDist = dist;
        e.baseSpeed = 0;
        /* Enemy 出生渲染点在路径起点，手动设置 pathDist 后用 dt=0 跑一次
           update 对齐渲染位置（真实出兵由出生点沿路走，不存在此问题） */
        e.update(0);
        this.enemies.push(e);
        this._pullTestObjs.enemies.push(e);
        return e;
      };
      /* 敌人到路径中心线的最短距离：被吸附时也必须 ≈0（始终在道路内） */
      const onPath = (e) => this.distToPath(e.x, e.y);

      const tower = mkTower(300, 200);
      const tower2 = mkTower(780, 150);
      report.tower = {
        type: tower.typeKey,
        isPullBehavior: tower.behavior && tower.behavior.constructor.name === 'PullBehavior',
        intervalSec: tower.behavior.interval,
        durationSec: tower.behavior.duration,
        smallOnly: tower.behavior.smallOnly,
        stats: tower.stats,
        effect: tower.cfg.effect
      };

      const e1 = mkEnemy(380);    // (340,100) 距塔1≈108<200，回拉目标 40
      const e2 = mkEnemy(400);    // (360,100) 距塔1≈117<200，回拉目标 60
      const eA = mkEnemy(420);    // (380,100) 距塔1≈128<200，回拉目标 80
      const eBoss = mkEnemy(420, 'enemyBoss'); // 与 eA 同位但 cfg.boss=true：必须免疫
      const eB = mkEnemy(560);    // (520,100) 距塔1≈241、塔2≈265，两塔射程外
      const eD = mkEnemy(850);    // (720,190) 拐角竖段，距塔2≈72<200，回拉 40
      /* 射程 200 边界对（段0 起点 x=-40，世界 x=pathDist-40）：197 必须吸到、
         206 必须安全；两者距塔2均 >300，不受塔2干扰 */
      const eEdgeIn = mkEnemy(510);  // 世界点 (470,100) 距塔1≈197<200，回拉目标限幅 95
      const eEdgeOut = mkEnemy(520); // 世界点 (480,100) 距塔1≈206>200，射程外
      /* 向前吸引镜像对（投影点 footDist=340 之前，验证【不只吸第一个】）：
         与越过塔的 e1/eEdgeIn 沿路镜像，pullBack 必须为负且绝对值相等 */
      const eF1 = mkEnemy(300);  // (260,100) 距塔1≈108<200，向前目标 40（镜像 e1）
      const eF2 = mkEnemy(200);  // (160,100) 距塔1≈172<200，向前限幅 95（镜像 eEdgeIn）

      // ---- t=0.15s：首脉冲开窗瞬间——范围目标集 / BOSS免疫 / 多目标动画 ----
      await new Promise(r => setTimeout(r, 150));
      const tgts = tower.behavior.targets;
      report.phase0 = {
        targetsCount: tgts.length,
        targetsAllSmall: tgts.indexOf(e1) !== -1 && tgts.indexOf(e2) !== -1 &&
                         tgts.indexOf(eA) !== -1 && tgts.indexOf(eEdgeIn) !== -1 &&
                         tgts.indexOf(eF1) !== -1 && tgts.indexOf(eF2) !== -1,
        bossExcluded: tgts.indexOf(eBoss) === -1,
        pulled: { e1: e1.pullBack, e2: e2.pullBack, eA: eA.pullBack, boss: eBoss.pullBack,
                  edgeIn: eEdgeIn.pullBack, edgeOut: eEdgeOut.pullBack,
                  f1: eF1.pullBack, f2: eF2.pullBack },
        allSmallPulled: e1.pullBack > 5 && e2.pullBack > 5 && eA.pullBack > 5 &&
                        eEdgeIn.pullBack > 5,
        /* 投影点之前的小怪也必须被明显【向前】拉近（负值），不再只吸越过塔的怪 */
        forwardHit: eF1.pullBack < -15 && eF2.pullBack < -40 &&
                    tgts.indexOf(eF1) !== -1 && tgts.indexOf(eF2) !== -1,
        /* 双向等力：镜像对位移收敛量绝对值一致（同一 k、同一限幅，容差 8px） */
        equalForce: Math.abs(Math.abs(eF1.pullBack) - e1.pullBack) < 8 &&
                    Math.abs(Math.abs(eF2.pullBack) - eEdgeIn.pullBack) < 8,
        bossUntouched: eBoss.pullBack < 0.5,
        /* 射程 200 边界：197 在内且被回拉，206 在外且目标集不含、pullBack=0 */
        edgeInsideHit: tgts.indexOf(eEdgeIn) !== -1 && eEdgeIn.pullBack > 5,
        edgeOutsideSafe: tgts.indexOf(eEdgeOut) === -1 && eEdgeOut.pullBack < 0.5,
        /* 多目标攻击动画：被吸小怪紫闪 0xd9b8ff，BOSS 保持原色；炮头已转向；
           首次开窗脉冲计数 1（塔2 对 eD 同样 1） */
        fxTintOnSmall: eA.body.tintTopLeft === 0xd9b8ff,
        fxNoTintOnBoss: eBoss.body.tintTopLeft === 0xffffff,
        turretAimed: Math.abs(tower.turret.rotation - (-Math.PI / 2)) > 0.05,
        pulseCount1: tower.behavior.pulseCount === 1 && tower2.behavior.pulseCount === 1
      };

      // ---- t=0.3s：首次脉冲窗口内 ----
      await new Promise(r => setTimeout(r, 150));
      report.phase1 = {
        A: { pullBack: eA.pullBack, onPathDist: onPath(eA), x: eA.x, y: eA.y },
        B: { pullBack: eB.pullBack, onPathDist: onPath(eB) },
        D: { pullBack: eD.pullBack, onPathDist: onPath(eD), x: eD.x, y: eD.y },
        F1: { pullBack: eF1.pullBack, onPathDist: onPath(eF1), x: eF1.x, y: eF1.y },
        F2: { pullBack: eF2.pullBack, onPathDist: onPath(eF2), x: eF2.x, y: eF2.y },
        A_pulled: eA.pullBack > 10,
        B_notPulled: eB.pullBack < 5,
        /* 向前吸引持续成立：投影点前小怪保持显著负位移，且向前移动后仍在路上 */
        forwardHeld: eF1.pullBack < -30 && eF2.pullBack < -70,
        equalForceHeld: Math.abs(Math.abs(eF1.pullBack) - e1.pullBack) < 8 &&
                        Math.abs(Math.abs(eF2.pullBack) - eEdgeIn.pullBack) < 8,
        bossStillUntouched: eBoss.pullBack < 0.5,
        edgeOutStillSafe: eEdgeOut.pullBack < 0.5 && tgts.indexOf(eEdgeOut) === -1,
        allOnPath: onPath(e1) < 0.5 && onPath(e2) < 0.5 && onPath(eA) < 0.5 &&
                   onPath(eBoss) < 0.5 && onPath(eB) < 0.5 && onPath(eD) < 0.5 &&
                   onPath(eEdgeIn) < 0.5 && onPath(eEdgeOut) < 0.5 &&
                   onPath(eF1) < 0.5 && onPath(eF2) < 0.5,
        D_strictVertical: Math.abs(eD.x - 720) < 0.5
      };

      // ---- t=0.3~0.45s（完全在首个 0.5s 窗口内，避开 0.5s 烘焙帧）：ctrlSlow 压制但仍在前进 ----
      const eC = mkEnemy(420);
      eC.baseSpeed = TD_CONFIG.enemies.enemyX.speed;
      const pdBefore = eC.pathDist;
      await new Promise(r => setTimeout(r, 150));
      const delta = eC.pathDist - pdBefore;
      const expectedNormal = TD_CONFIG.enemies.enemyX.speed * 0.15;
      report.ctrlSlow = {
        pathDistDelta: delta,
        expectedNormal,
        expectedCtrlSlow: expectedNormal * 0.5,
        pullBack: eC.pullBack,
        onPathDist: onPath(eC),
        slowedButMoving: delta > expectedNormal * 0.2 && delta < expectedNormal * 0.8
      };

      /* ---- t=0.58s：窗口刚结束，位移应已【烘焙】进 pathDist：
         pullBack 全部归零，但小怪停在吸附结束位置（不弹回），且仍在路上 ---- */
      await new Promise(r => setTimeout(r, 130));
      const eCpdGap0 = eC.pathDist;
      const bakedSnapshot = {
        A: { pullBack: eA.pullBack, pathDist: eA.pathDist, x: eA.x },
        f1: { pullBack: eF1.pullBack, pathDist: eF1.pathDist, x: eF1.x },
        f2: { pullBack: eF2.pullBack, pathDist: eF2.pathDist, x: eF2.x }
      };

      /* ---- t=0.58→1.55s：间隙中小怪从【新位置】全速继续沿原路径前进 ---- */
      await new Promise(r => setTimeout(r, 970));
      const eCgapDelta = eC.pathDist - eCpdGap0;
      const eCExpectedGap = TD_CONFIG.enemies.enemyX.speed * 0.97;
      report.release = {
        time: 1.55,
        baked: bakedSnapshot,
        A_pullBack: eA.pullBack, A_pathDist: eA.pathDist, A_x: eA.x, A_onPathDist: onPath(eA),
        f1: { pullBack: eF1.pullBack, pathDist: eF1.pathDist, x: eF1.x, onPathDist: onPath(eF1) },
        f2: { pullBack: eF2.pullBack, pathDist: eF2.pathDist, x: eF2.x, onPathDist: onPath(eF2) },
        bossPullBack: eBoss.pullBack,
        /* 向后拉的 eA：烘焙后停在塔投影点附近（pathDist≈342/x≈302），
           没有弹回原位置（420/380），仍严格在道路上 */
        stayedNoSpringBack: eA.pullBack < 0.5 && eA.pathDist < 360 && eA.x < 330 &&
                            onPath(eA) < 0.5,
        /* 向前拉的 eF1/eF2：停在被拉到的新位置（300→≈339、200→≈292），
           没有退回原里程，且仍在道路上 */
        forwardStayed: Math.abs(eF1.pullBack) < 0.5 && eF1.pathDist > 320 && eF1.x > 280 &&
                       Math.abs(eF2.pullBack) < 0.5 && eF2.pathDist > 270 &&
                       onPath(eF1) < 0.5 && onPath(eF2) < 0.5,
        /* 烘焙后从新位置全速继续推进（0.97s 应走近 ≈95px，无减速、无回弹） */
        continuesWalking: eCgapDelta > eCExpectedGap * 0.75 &&
                          eCgapDelta < eCExpectedGap * 1.25 && onPath(eC) < 0.5
      };
      /* eC 验证完毕：移出两座塔射程并停下，避免计入第二次脉冲目标集 */
      eC.baseSpeed = 0;
      eC.pathDist = 600;
      eC.pullBack = 0;
      eC.update(0);

      // ---- t=1.9s：第二次脉冲（2.0s）前的间隙，仍应归零 ----
      await new Promise(r => setTimeout(r, 400));
      report.intervalGap = { time: 1.9, A_pullBack: eA.pullBack,
        targetsCleared: tower.behavior.targets.length === 0,
        inGap: eA.pullBack < 2 };

      /* ---- 静止夹具被烘焙钉在投影点附近：复位到初始里程，模拟真实行军
         重新走进射程（随后第二次脉冲开窗） ---- */
      const resetList = [[e1, 380], [e2, 400], [eA, 420], [eEdgeIn, 510],
                        [eF1, 300], [eF2, 200], [eD, 850]];
      for (let ri = 0; ri < resetList.length; ri++) {
        const re = resetList[ri][0];
        re.pullBack = 0;
        re.pathDist = resetList[ri][1];
        re.update(0);
      }

      // ---- t=2.2s：第二次脉冲窗口（2.0–2.5s），小怪再次全部被吸引、BOSS 仍免疫 ----
      await new Promise(r => setTimeout(r, 250));
      report.secondPulse = {
        time: 2.2,
        A_pullBack: eA.pullBack, A_onPathDist: onPath(eA),
        e1_pullBack: e1.pullBack, e2_pullBack: e2.pullBack, boss_pullBack: eBoss.pullBack,
        D_pullBack: eD.pullBack, D_onPathDist: onPath(eD),
        edgeIn_pullBack: eEdgeIn.pullBack, edgeOut_pullBack: eEdgeOut.pullBack,
        f1_pullBack: eF1.pullBack, f2_pullBack: eF2.pullBack,
        targetsCount: tower.behavior.targets.length,
        firedAgain: eA.pullBack > 10,
        allSmallAgain: e1.pullBack > 5 && e2.pullBack > 5 && eA.pullBack > 5 &&
                       eEdgeIn.pullBack > 5,
        /* 第二个 2s 脉冲：投影点前小怪再次被向前拉近，且与镜像怪仍然等力 */
        forwardAgain: eF1.pullBack < -15 && eF2.pullBack < -40,
        equalForceAgain: Math.abs(Math.abs(eF1.pullBack) - e1.pullBack) < 8 &&
                         Math.abs(Math.abs(eF2.pullBack) - eEdgeIn.pullBack) < 8,
        edgeBoundaryHolds: eEdgeIn.pullBack > 5 && eEdgeOut.pullBack < 0.5,
        bossStillImmune: eBoss.pullBack < 0.5,
        pulseCount2: tower.behavior.pulseCount === 2 && tower2.behavior.pulseCount === 2,
        onPath: onPath(eA) < 0.5 && onPath(eD) < 0.5 &&
                onPath(eEdgeIn) < 0.5 && onPath(eEdgeOut) < 0.5 &&
                onPath(eF1) < 0.5 && onPath(eF2) < 0.5
      };

      report.conclusion = {
        behaviorIsPull: report.tower.isPullBehavior,
        rangeIs200: report.tower.stats.range === 200,
        intervalIs2s: report.tower.intervalSec === 2,
        smallOnlyFilter: report.tower.smallOnly === true,
        areaMultiTarget: report.phase0.targetsCount === 6 && report.phase0.targetsAllSmall &&
                         report.phase0.allSmallPulled,
        /* 塔投影点前后的小怪都被明显吸引，且双向力度相等 */
        forwardAttract: report.phase0.forwardHit && report.phase1.forwardHeld &&
                        report.release.forwardStayed && report.secondPulse.forwardAgain,
        equalForceBothSides: report.phase0.equalForce && report.phase1.equalForceHeld &&
                             report.secondPulse.equalForceAgain,
        edgeBoundary: report.phase0.edgeInsideHit && report.phase0.edgeOutsideSafe &&
                      report.phase1.edgeOutStillSafe && report.secondPulse.edgeBoundaryHolds,
        bossImmune: report.phase0.bossExcluded && report.phase0.bossUntouched &&
                    report.phase1.bossStillUntouched && report.secondPulse.bossStillImmune,
        multiTargetFx: report.phase0.fxTintOnSmall && report.phase0.fxNoTintOnBoss &&
                       report.phase0.turretAimed && report.phase0.pulseCount1,
        outOfRangeSafe: report.phase1.B_notPulled,
        alwaysOnPath: report.phase1.allOnPath && report.ctrlSlow.onPathDist < 0.5 &&
                      report.release.A_onPathDist < 0.5 && report.secondPulse.onPath,
        cornerNoSideways: report.phase1.D_strictVertical,
        /* 【本次修复核心】窗口结束位移烘焙：停在吸附结束位置不弹回，仍在路上，
           并从新位置全速继续沿原路径前进（向前拉的小怪同样停留） */
        bakeNoSpringBack: report.release.stayedNoSpringBack && report.release.forwardStayed &&
                          report.release.continuesWalking,
        pulseGapClear: report.intervalGap.inGap && report.intervalGap.targetsCleared,
        pulseEvery2s: report.secondPulse.firedAgain && report.secondPulse.allSmallAgain &&
                      report.secondPulse.pulseCount2,
        slowedButMoving: report.ctrlSlow.slowedButMoving,
        pass: report.tower.isPullBehavior && report.tower.stats.range === 200 &&
              report.tower.intervalSec === 2 &&
              report.tower.smallOnly === true &&
              report.phase0.targetsCount === 6 && report.phase0.targetsAllSmall &&
              report.phase0.allSmallPulled && report.phase0.bossExcluded &&
              report.phase0.bossUntouched &&
              report.phase0.forwardHit && report.phase0.equalForce &&
              report.phase0.edgeInsideHit && report.phase0.edgeOutsideSafe &&
              report.phase0.fxTintOnSmall && report.phase0.fxNoTintOnBoss &&
              report.phase0.turretAimed && report.phase0.pulseCount1 &&
              report.phase1.A_pulled && report.phase1.B_notPulled &&
              report.phase1.bossStillUntouched && report.phase1.edgeOutStillSafe &&
              report.phase1.allOnPath && report.phase1.D_strictVertical &&
              report.phase1.forwardHeld && report.phase1.equalForceHeld &&
              report.release.stayedNoSpringBack && report.release.forwardStayed &&
              report.release.continuesWalking &&
              report.intervalGap.inGap &&
              report.intervalGap.targetsCleared &&
              report.secondPulse.firedAgain && report.secondPulse.allSmallAgain &&
              report.secondPulse.bossStillImmune && report.secondPulse.pulseCount2 &&
              report.secondPulse.edgeBoundaryHolds &&
              report.secondPulse.forwardAgain && report.secondPulse.equalForceAgain &&
              report.secondPulse.onPath && report.ctrlSlow.slowedButMoving
      };
      report.step = 'done';
    } catch (e) {
      report.error = String(e) + (e.stack ? '\n' + e.stack.split('\n').slice(0,3).join('\n') : '');
      report.step = 'error';
    } finally {
      // 清理测试对象
      if (this._pullTestObjs) {
        this._pullTestObjs.towers.forEach(t => { try { this.towers = this.towers.filter(v => v !== t); t.destroy(); } catch(_){} });
        this._pullTestObjs.enemies.forEach(e => { try { this.enemies = this.enemies.filter(v => v !== e); e.destroyImmediately && e.destroyImmediately(); } catch(_){} });
        this._pullTestObjs = null;
      }
    }
    return report;
  }

  /**
   * 风元素塔真实运行时自查（控制台 window.__tdWindTest()）。
   * 自动按当前关卡模式分支：
   * 旧印记模式（1~5关）：noOverwrite / noElementNoSpread / spreadToNearest /
   *   keepExisting / farUntouched / bossUntouched / cooldown / slowMarksIce /
   *   iceSpreadSlows；
   * 新反应模式（第6关起）：amountOne（扩散 1 单位）/ centerKept（中心不扣量）/
   *   maxFive（最多 5 个、最近优先）/ waterSpread（可扩散水）/
   *   sameElementSkipped（已有该元素者跳过，名额让给远处无素怪）/
   *   farUntouched / bossUntouched / cooldown / iceWaterFreezes
   *   （扩散冰到带水怪 → 触发冰冻）。
   * 测试对象结束全部清理，不影响正常游戏。
   */
  runWindTest() {
    const report = { step: 'init', mode: null, checks: {}, conclusion: null, error: null };
    const testTowers = [], testEnemies = [];
    try {
      const mkEnemy = (dist, typeKey) => {
        const e = new Enemy(this, typeKey || 'enemyX', 0);
        e.pathDist = dist;
        e.baseSpeed = 0; // 静止夹具：只测元素/扩散，不测移动
        e.update(0);
        this.enemies.push(e); testEnemies.push(e);
        return e;
      };
      /* 真实风刃：构造 Projectile 并同步触发 impact（伤害 + 扩散判定） */
      const fireBlade = (tower, target) => {
        const p = new Projectile(this, tower.x, tower.y, target, tower.cfg.projectile, tower.stats.damage, tower);
        p.impact();
      };

      /* 路径直线段上的夹具：pathDist 差即世界距离（路线0首段均为水平直线） */
      const center = mkEnemy(300);   // 扩散中心（距塔 100px，射程 150 内）
      const wind = new Tower(this, center.x, center.y + 100, 'towerF');
      this.towers.push(wind); testTowers.push(wind);
      report.checks.behaviorClass = wind.behavior.constructor.name;
      report.mode = center.reactionsEnabled ? 'reaction' : 'legacy';

      if (!center.reactionsEnabled) {
        /* ---------- 旧印记模式（1~5 关） ---------- */
        const clearMark = (e) => { e.element = null; e.elementTimer = 0; e.clearElementMark(); };
        center.applyElement('fire', 4);
        center.applyElement('water', 4);
        report.checks.noOverwrite = center.element === 'fire';

        const plain = mkEnemy(350);
        const witness = mkEnemy(320);
        fireBlade(wind, plain);
        report.checks.noElementNoSpread = !witness.element && !plain.element;

        const tagged = mkEnemy(330); tagged.applyElement('water', 4);
        const far = mkEnemy(560);
        const boss = mkEnemy(320, 'enemyBoss');
        fireBlade(wind, center);
        report.checks.spreadToNearest = witness.element === 'fire';
        report.checks.keepExisting = tagged.element === 'water';
        report.checks.farUntouched = !far.element;
        report.checks.bossUntouched = !boss.element;

        clearMark(witness);
        fireBlade(wind, center);
        report.checks.cooldownBlocks = !witness.element;
        wind.behavior.spreadTimer = 0;
        fireBlade(wind, center);
        report.checks.cooldownReady = witness.element === 'fire';

        clearMark(center); clearMark(witness);
        center.applySlow(0.5, 1.6);
        report.checks.slowMarksIce = center.element === 'ice';
        wind.behavior.spreadTimer = 0;
        fireBlade(wind, center);
        report.checks.iceSpreadSlows = witness.element === 'ice' && witness.slowTimer > 0;

        const c = report.checks;
        report.conclusion = (c.behaviorClass === 'WindSpreadBehavior' && c.noOverwrite &&
          c.noElementNoSpread && c.spreadToNearest && c.keepExisting && c.farUntouched &&
          c.bossUntouched && c.cooldownBlocks && c.cooldownReady && c.slowMarksIce &&
          c.iceSpreadSlows) ? 'PASS' : 'FAIL';
      } else {
        /* ---------- 新反应模式（第 6 关起） ---------- */
        const amt = (e, type) => {
          const s = e.elements.find((v) => v.type === type);
          return s ? s.amount : 0;
        };
        const clearEls = (e) => { e.elements = []; e.freezeTimer = 0; e.showFreezeGfx(false); e.refreshElementMarks(); };
        /* 夹具移走：把无关小怪挪到扩散半径外，避免占用最多 5 个扩散名额 */
        let banishSeq = 900;
        const banish = (e) => { e.pathDist = banishSeq++; e.update(0); };

        /* 无元素目标 → 不扩散 */
        const plain = mkEnemy(350);
        const w0 = mkEnemy(260);
        fireBlade(wind, plain);
        report.checks.noElementNoSpread = w0.elements.length === 0 && plain.elements.length === 0;
        banish(plain); banish(w0);

        /* 中心挂水 2 单位；半径内放 6 个无素小怪 + 1 个已带水怪（距20）：
           预期最近的 5 个无素怪各得水 1 单位（已带水者跳过），第 6 个不得；
           中心仍为 2 单位（不扣量）；可扩散水元素 */
        clearEls(center);
        center.attachElement('water', 2, null);
        const holders = [];
        for (const d of [20, 32, 44, 56, 68, 80]) holders.push(mkEnemy(300 + d));
        const alreadyWater = mkEnemy(315);
        alreadyWater.attachElement('water', 2, null);
        const far = mkEnemy(470);
        const boss = mkEnemy(318, 'enemyBoss');
        wind.behavior.spreadTimer = 0;
        fireBlade(wind, center);
        const gotWater = holders.filter((e) => Math.abs(amt(e, 'water') - 1) < 1e-6);
        report.checks.amountOne = gotWater.length === 5;
        report.checks.maxFive = gotWater.length === 5 && Math.abs(amt(holders[5], 'water')) < 1e-6;
        report.checks.sameElementSkipped = Math.abs(amt(alreadyWater, 'water') - 2) < 1e-6;
        report.checks.centerKept = Math.abs(amt(center, 'water') - 2) < 1e-6;
        report.checks.waterSpread = gotWater.length === 5;
        report.checks.farUntouched = far.elements.length === 0;
        report.checks.bossUntouched = boss.elements.length === 0;

        /* 冷却中不扩散；就绪后恢复 */
        const probe = holders[5]; // 上一轮没拿到水的第 6 只
        fireBlade(wind, center);
        report.checks.cooldownBlocks = probe.elements.length === 0;
        wind.behavior.spreadTimer = 0;
        fireBlade(wind, center);
        report.checks.cooldownReady = Math.abs(amt(probe, 'water') - 1) < 1e-6;

        /* 扩散冰（1单位）到带水（2单位）小怪 → 水+冰冰冻（冰耗尽，水剩1）。
           先把上一轮残留的带水小怪全部移走，只留 center/probe 在半径内 */
        holders.forEach((h) => { if (h !== probe) banish(h); });
        banish(alreadyWater);
        clearEls(center); clearEls(probe);
        center.attachElement('ice', 2, null);
        probe.attachElement('water', 2, null);
        wind.behavior.spreadTimer = 0;
        fireBlade(wind, center);
        report.checks.iceWaterFreezes = probe.freezeTimer > 0 &&
          Math.abs(amt(probe, 'water') - 1) < 1e-6 && amt(probe, 'ice') === 0;

        const c = report.checks;
        const keys = ['behaviorClass', 'noElementNoSpread', 'amountOne', 'maxFive',
          'sameElementSkipped', 'centerKept', 'waterSpread', 'farUntouched',
          'bossUntouched', 'cooldownBlocks', 'cooldownReady', 'iceWaterFreezes'];
        report.conclusion = keys.every((k) => c[k] === true || (k === 'behaviorClass' && c[k] === 'WindSpreadBehavior'))
          ? 'PASS' : 'FAIL';
      }
      report.step = 'done';
    } catch (err) {
      report.error = String(err && err.stack || err);
      report.step = 'error';
    } finally {
      testTowers.forEach((t) => { try { this.towers = this.towers.filter((v) => v !== t); t.destroy(); } catch (_) {} });
      testEnemies.forEach((e) => { try { this.enemies = this.enemies.filter((v) => v !== e); e.destroyImmediately(); } catch (_) {} });
    }
    return report;
  }

  /**
   * 元素反应系统真实运行时自查（控制台 window.__tdReactionTest()）。
   * 构造强制开启反应模式的真实 Enemy（不依赖当前关卡编号），逐项验证：
   *   meltByFire/ByIce   火+冰：火触发 ×2、冰触发 ×1.5；
   *   vaporByFire/ByWater 火+水：火触发 ×2、水触发 ×1.5；
   *   chargedRatio       水+雷 1:0.5（水2+雷2 → 雷剩1），双方触发 ×1.75；
   *   superRatio         冰+雷 0.5:1（冰2+雷2 → 冰剩1），×1.5；
   *   orderFirstAttached 按附着先后反应（先雷残留1，再上冰 → 先触发超导）；
   *   rateLimit          同种元素 0.5s 内限附着一次，超时补量但不触发新反应；
   *   freeze             水+冰 → 冰冻 2 秒（定身、不被牵引）；
   *   shatterVuln        塔D脉冲扫到冰冻怪：提前破冰 + 易伤 10%/层，最多3层，
   *                      满层+30%，每层独立5秒倒计时；
   *   vulnTimers         先层到时独立消失，不刷新其他层；
   *   bossSlowNotVuln    BOSS 水+冰 → 减速、不冰冻、不挂易伤，伤害不放大；
   *   projMelt           真实塔A风... 弹道命中带冰怪伤害 ×2（端到端）；
   *   pullBlocksFreeze   牵引脉冲不位移冰冻怪，破冰当窗不拉人。
   */
  runElementTest() {
    const report = { step: 'init', checks: {}, conclusion: null, error: null };
    const testTowers = [], testEnemies = [];
    try {
      const mk = (dist, typeKey) => {
        const e = new Enemy(this, typeKey || 'enemyY', 0); // 默认高血胖子，避免测试击杀
        e.reactionsEnabled = true;   // 强制新反应模式（任何关卡内都可测）
        e.pathDist = dist;
        e.baseSpeed = 0;
        e.update(0);
        this.enemies.push(e); testEnemies.push(e);
        return e;
      };
      const amt = (e, type) => {
        const s = e.elements.find((v) => v.type === type);
        return s ? s.amount : 0;
      };
      const near = (a, b) => Math.abs(a - b) < 1e-6;
      const c = report.checks;

      /* 火+冰：火先附着冰后触发 ×1.5；冰先附着火后触发 ×2 */
      let e1 = mk(300);
      let r1 = e1.attachElement('fire', 2, 'fire');
      let r2 = e1.attachElement('ice', 2, 'ice');
      c.meltByIce = r2.reactionMul === 1.5 && e1.elements.length === 0;
      let e2 = mk(300);
      e2.attachElement('ice', 2, 'ice');
      let r3 = e2.attachElement('fire', 2, 'fire');
      c.meltByFire = r3.reactionMul === 2 && e2.elements.length === 0;

      /* 火+水：水先火后 ×2；火先水后 ×1.5 */
      let e3 = mk(300);
      e3.attachElement('water', 2, 'water');
      c.vaporByFire = e3.attachElement('fire', 2, 'fire').reactionMul === 2;
      let e4 = mk(300);
      e4.attachElement('fire', 2, 'fire');
      c.vaporByWater = e4.attachElement('water', 2, 'water').reactionMul === 1.5;

      /* 水+雷 1:0.5：水2+雷2 → 水耗尽、雷剩1；双方触发都 ×1.75 */
      let e5 = mk(300);
      e5.attachElement('water', 2, 'water');
      let rr = e5.attachElement('thunder', 2, 'thunder');
      c.chargedRatio = rr.reactionMul === 1.75 && near(amt(e5, 'thunder'), 1) && amt(e5, 'water') === 0;
      let e6 = mk(300);
      e6.attachElement('thunder', 2, 'thunder');
      c.chargedByWater = e6.attachElement('water', 2, 'water').reactionMul === 1.75;

      /* 冰+雷 0.5:1：冰2+雷2 → 雷耗尽、冰剩1，×1.5 */
      let e7 = mk(300);
      e7.attachElement('ice', 2, 'ice');
      let rs = e7.attachElement('thunder', 2, 'thunder');
      c.superRatio = rs.reactionMul === 1.5 && near(amt(e7, 'ice'), 1) && amt(e7, 'thunder') === 0;

      /* 反应顺序按附着先后：雷2+水2 反应后雷剩1；再上冰2：
         冰应先与【更早附着的雷】超导（雷1耗尽、冰耗0.5剩1.5），
         而不是别的顺序 → reactions[0]==='superconductor' */
      let e8 = mk(300);
      e8.attachElement('thunder', 2, 'thunder');
      e8.attachElement('water', 2, 'water');          // 感电后雷剩1，水0
      const orderRes = e8.attachElement('ice', 2, 'ice');
      c.orderFirstAttached = orderRes.reactions[0] === 'superconductor' &&
        near(amt(e8, 'ice'), 1.5) && amt(e8, 'thunder') === 0;

      /* 0.5s 同元素限频：立即再去火被挡（量仍2）；0.6s 后补量到4但不触发反应；
         随后水2只与火按1:1反应掉2，火剩2 */
      let e9 = mk(300);
      e9.attachElement('fire', 2, 'fire');
      const blocked = e9.attachElement('fire', 2, 'fire');
      c.rateLimit = blocked.reactionMul === 1 && near(amt(e9, 'fire'), 2);
      e9.age = 0.6;
      e9.attachElement('fire', 2, 'fire');
      const fireStacked = near(amt(e9, 'fire'), 4); // 限频超时补量：水反应前火应为4
      const reV = e9.attachElement('water', 2, 'water');
      c.rateLimitStack = fireStacked &&
        reV.reactionMul === 1.5 && near(amt(e9, 'fire'), 2) && amt(e9, 'water') === 0;

      /* 水+冰 → 冰冻2秒（非BOSS、非易伤） */
      let e10 = mk(300);
      e10.attachElement('water', 2, 'water');
      e10.attachElement('ice', 2, 'ice');
      c.freeze = e10.freezeTimer > 1.9 && e10.vulnStacks.length === 0;

      /* 提前破冰 + 易伤叠层：1/2/3 层受伤 ×1.1/1.2/1.3，第4层忽略；
         每层独立5秒：先层过3秒再叠两层，2.1秒后最早层独立消失 */
      let e11 = mk(300);
      e11.applyFreeze(2);
      e11.shatterFreeze();
      c.shatterClearsFreeze = e11.freezeTimer === 0 && e11.vulnStacks.length === 1;
      const hp0 = e11.hp;
      e11.takeDamage(20);
      const dmg1 = hp0 - e11.hp;
      e11.shatterFreeze();                 // 未冰冻：无效
      c.shatterOnlyWhenFrozen = e11.vulnStacks.length === 1;
      e11.applyFreeze(2); e11.shatterFreeze();  // 第2层
      const hp1 = e11.hp; e11.takeDamage(20); const dmg2 = hp1 - e11.hp;
      e11.applyFreeze(2); e11.shatterFreeze();  // 第3层
      const hp2 = e11.hp; e11.takeDamage(20); const dmg3 = hp2 - e11.hp;
      e11.addVuln();                       // 满层忽略
      c.vulnDamage = near(dmg1, 22) && near(dmg2, 24) && near(dmg3, 26) && e11.vulnStacks.length === 3;
      /* 独立计时：第1层已过~0秒；先 update(3)（第1层剩2s），再补两层，
         update(2.1) → 第1层消失，新两层仍在（剩约2.9/2.9） */
      e11.vulnStacks.length = 0; e11.refreshVulnView(false);
      e11.addVuln();
      e11.update(3);
      e11.addVuln(); e11.addVuln();
      c.vulnStacksBefore = e11.vulnStacks.length === 3;
      e11.update(2.1);
      c.vulnTimers = e11.vulnStacks.length === 2;

      /* BOSS：水+冰 → 减速（不冰冻/不挂易伤），伤害不吃易伤 */
      let boss = mk(300, 'enemyBoss');
      boss.attachElement('water', 2, 'water');
      boss.attachElement('ice', 2, 'ice');
      c.bossSlowNotVuln = boss.freezeTimer === 0 && boss.slowTimer > 0 && boss.vulnStacks.length === 0;
      boss.applyFreeze(2);
      boss.shatterFreeze();               // BOSS 理论上不会被牵引；即便误调也不挂易伤
      c.bossNoVulnShatter = boss.vulnStacks.length === 0;
      const bh0 = boss.hp; boss.takeDamage(100);
      c.bossDamageClean = near(bh0 - boss.hp, 100);

      /* 端到端：真实塔A弹道命中带冰怪（enemyY 175血），伤害42应×2=84 */
      const tgt = mk(300);
      tgt.attachElement('ice', 2, 'ice');
      const towerA = new Tower(this, tgt.x, tgt.y + 100, 'towerA');
      this.towers.push(towerA); testTowers.push(towerA);
      const hpA = tgt.hp;
      const proj = new Projectile(this, towerA.x, towerA.y, tgt, towerA.cfg.projectile, towerA.stats.damage, towerA);
      proj.impact();
      c.projMelt = near(hpA - tgt.hp, 84);

      /* 塔D 牵引：冰冻怪不被位移且破冰；同窗口普通怪正常标记 */
      const frozen = mk(340); frozen.applyFreeze(2);
      const movable = mk(380);
      const towerD = new Tower(this, frozen.x, frozen.y + 100, 'towerD');
      this.towers.push(towerD); testTowers.push(towerD);
      towerD.behavior.update(0.016, { enemies: this.enemies });
      c.pullBlocksFreeze = frozen.freezeTimer === 0 && frozen.vulnStacks.length === 1 &&
        (frozen.pullBack || 0) === 0;
      c.pullStillWorks = movable.pullFresh === true;

      /* 塔D 不附元素：场上被牵引怪身上无元素槽 */
      c.towerDNoElement = movable.elements.length === 0;

      const keys = Object.keys(c);
      report.conclusion = keys.every((k) => c[k] === true) ? 'PASS' : 'FAIL';
      report.step = 'done';
    } catch (err) {
      report.error = String(err && err.stack || err);
      report.step = 'error';
    } finally {
      testTowers.forEach((t) => { try { this.towers = this.towers.filter((v) => v !== t); t.destroy(); } catch (_) {} });
      testEnemies.forEach((e) => { try { this.enemies = this.enemies.filter((v) => v !== e); e.destroyImmediately(); } catch (_) {} });
    }
    return report;
  }

  /** 进入 / 退出放置模式（由商店按钮触发）
   *  进入：重绘可放置区域并平滑淡入；退出：平滑淡出后清空，切换过程无闪烁 */
  setPlacement(typeKey) {
    /* 兜底拦截：未解锁塔禁止进入放置模式（UI 点击层已拦一次，防止代码直调） */
    if (typeKey && !TDStorage.isTowerUnlocked(typeKey, this.levelId)) return;
    this.selectedType = typeKey;
    const gfx = this.placementGridGfx;
    if (typeKey) {
      this.hidePanel();
      this.selectedTower = null;
      this.rangeGfx.clear();
      /* 重绘可放置区域并平滑淡入 */
      this.drawPlacementGrid();
      this.tweens.killTweensOf(gfx);
      this.tweens.add({
        targets: gfx, alpha: 1, duration: 200, ease: 'Cubic.out'
      });
    } else {
      this.ghost.clear();
      /* 平滑淡出后清空，避免残留绘图 */
      this.tweens.killTweensOf(gfx);
      this.tweens.add({
        targets: gfx, alpha: 0, duration: 200, ease: 'Cubic.in',
        onComplete: () => gfx.clear()
      });
    }
  }

  /** 返回关卡选择界面 */
  goToLevelSelect() {
    /* 清理本场景产生的 DOM 遮罩，避免带到选关界面 */
    document.getElementById('overlay-end').classList.add('hidden');
    document.getElementById('overlay-pause').classList.add('hidden');
    if (this.tutorialOverlay) this.tutorialOverlay.setVisible(false);
    this.closeTowerPicker(true);
    this.setPaused(false);
    this.scene.start('LevelSelectScene');
  }

  /* ============================================================
   * 新手教程（仅第 1 关触发）
   * 4 步引导卡片：选塔 → 放塔 → 升级/出售 → 开战
   * ============================================================ */
  startTutorial() {
    this.tutorialSteps = [
      { title: '👋 欢迎，指挥官！', text: '点击地图上的绿色火力点，会在旁边弹出选塔框。' },
      { title: '🏗 建造防御塔', text: '在弹出的选塔框里点「塔A」，就能立刻把塔建在该火力点上。\n（道路、障碍物上不能放塔；再点一次火力点可关闭选塔框）' },
      { title: '⬆ 升级 / 出售', text: '点击已经放好的塔，可以升级它的攻击力，或者出售换金币。' },
      { title: '⚔ 开始战斗', text: '准备好后，点击「开始第 1 波」，抵御入侵的敌人吧！' }
    ];
    this.tutorialStep = 0;
    this.showTutorialStep();
  }

  /** 教程卡片的整体缩放系数：画布被缩小时放大卡片，同时不超出画布 */
  tutScale() {
    /* 同 pickerScale：displayScale 除回 dpr，保持教程卡片缩放与旧版一致 */
    const s = this.scale.displayScale;
    const dpr = window.__TD_DPR || 1;
    const k = Math.min(s.x / dpr, s.y / dpr) || 1;
    const fitScale = 1 / Math.min(k, 1);       // 保证屏上可读
    const cardW = 440, cardH = 200;
    const wLimit = (this.W * 0.92) / cardW;     // 不超出宽度
    const hLimit = (this.H * 0.92) / cardH;     // 不超出高度
    return Math.max(1, Math.min(fitScale, wLimit, hLimit));
  }

  showTutorialStep() {
    if (this.tutorialStep >= this.tutorialSteps.length) {
      if (this.tutorialOverlay) this.tutorialOverlay.destroy();
      this.tutorialOverlay = null;
      return;
    }
    const step = this.tutorialSteps[this.tutorialStep];
    const W = this.W, H = this.H;

    /* 第一次：创建教程浮层容器 */
    if (!this.tutorialOverlay) {
      const overlay = this.add.container(0, 0).setDepth(900);
      /* 半透明遮罩，突出中间卡片 */
      const mask = this.add.graphics().fillStyle(0x000000, 0.30).fillRect(0, 0, W, H);
      mask.setInteractive(new Phaser.Geom.Rectangle(0, 0, W, H), Phaser.Geom.Rectangle.Contains);
      overlay.add(mask);
      this.tutorialOverlay = overlay;

      const cardW = 440, cardH = 200;
      const card = this.add.container(W / 2, H / 2);
      const bg = this.add.graphics();
      bg.fillStyle(0xfff8e7, 1).fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 20);
      bg.lineStyle(4, 0x4a90e2, 1).strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 20);
      card.add(bg);

      const title = this.add.text(0, -60, '', {
        fontFamily: TD_FONT_STACK,
        fontSize: '24px', fontStyle: 'bold', color: '#2a4a7a', resolution: TD_TEXT_RES
      }).setOrigin(0.5);
      const text = this.add.text(0, 0, '', {
        fontFamily: TD_FONT_STACK,
        fontSize: '16px', color: '#4a3313', align: 'center', wordWrap: { width: cardW - 40 },
        resolution: TD_TEXT_RES
      }).setOrigin(0.5);
      const btn = this.add.graphics();
      /* 按钮底色加深至 #2f6fc0，白字对比度 5.1:1（AA） */
      btn.fillStyle(0x2f6fc0, 1).fillRoundedRect(-60, 50, 120, 40, 12);
      btn.lineStyle(3, 0x245a9e, 1).strokeRoundedRect(-60, 50, 120, 40, 12);
      const btnText = this.add.text(0, 70, '知道了', {
        fontFamily: TD_FONT_STACK,
        fontSize: '16px', fontStyle: 'bold', color: '#ffffff', resolution: TD_TEXT_RES
      }).setOrigin(0.5);
      const btnZone = this.add.zone(0, 70, 120, 40).setInteractive({ useHandCursor: true });
      btnZone.on('pointerdown', () => {
        this.tutorialStep++;
        this.showTutorialStep();
      });

      card.add([title, text, btn, btnText, btnZone]);
      overlay.add(card);
      this.tutorialCard = { title, text, btnText, bg, card };
    }

    /* 按当前缩放系数整体缩放卡片（文本/按钮等比放大，触控目标也随之变大） */
    const sc = this.tutScale();
    this.tutorialCard.card.setScale(sc);

    this.tutorialCard.title.setText(step.title);
    this.tutorialCard.text.setText(step.text);
    const isLast = this.tutorialStep === this.tutorialSteps.length - 1;
    this.tutorialCard.btnText.setText(isLast ? '开始游戏！' : '下一步');

    /* 小弹入动画 */
    this.tweens.add({
      targets: this.tutorialCard.card,
      scaleX: { from: sc * 0.8, to: sc },
      scaleY: { from: sc * 0.8, to: sc },
      duration: 180, ease: 'Back.out'
    });
  }

  togglePause() {
    if (this.state === 'won' || this.state === 'lost') return;
    this.setPaused(!this.paused);
  }

  setPaused(v) {
    this.paused = v;
    this.tweens.timeScale = v ? 0 : this.speedMul;
    document.getElementById('overlay-pause').classList.toggle('hidden', !v);
    if (v) this.clearPlacementHighlight();   // 暂停时关闭可能残留的放塔高亮
    /* 火塔燃烧视频随暂停停播/恢复（省电；共享解码器由引用计数统一调度） */
    try { FIRE_BURN.setPaused(v); } catch (e) {}
    /* 风塔龙卷风视频同步暂停/恢复 */
    try { WIND_VIDEO.setPaused(v); } catch (e) {}
    /* 史莱姆共享视频随游戏暂停/恢复（暂停即停解码，省电防卡） */
    try { SLIME_VIDEO.setPaused(v); } catch (e) {}
    /* BOSS 运动视频随暂停停播/恢复 */
    try { BOSS_VIDEO.setPaused(v); } catch (e) {}
    /* BOSS 死亡视频（爆炸动画）随暂停停播/恢复；皇冠 Tween 已被
       tweens.timeScale=0 冻结，恢复后继续淡出 */
    try { BOSS_DEATH.setPaused(v); } catch (e) {}
  }

  toggleSpeed() {
    this.speedMul = this.speedMul === 1 ? 2 : 1;
    if (!this.paused) this.tweens.timeScale = this.speedMul;
  }

  syncHud() {
    /* 当前关卡编号实时反映选关界面的选择（levelId 由场景启动参数传入，
       重玩沿用同一关卡；通关进度与解锁状态在返回选关时由 TDStorage
       统一读取，选关↔游戏两处始终一致）。
       手机端顶部信息栏为「图标 + 数字」紧凑格式（去掉文字标签，见
       style.css 的 html.is-mobile 规则），电脑端保持原「第 N 关」文案。 */
    const hudLevel = document.getElementById('hud-level');
    if (hudLevel) {
      hudLevel.textContent = window.__isMobile ? String(this.levelId) : '第 ' + this.levelId + ' 关';
    }
    document.getElementById('hud-gold').textContent = this.gold;
    document.getElementById('hud-lives').textContent = this.lives;
    document.getElementById('hud-wave').textContent =
      Math.min(this.waveIndex + 1, this.levelCfg.waves.list.length) + '/' + this.levelCfg.waves.list.length;

    // 商店按钮：未解锁显示锁定态（保持可点击以弹出解锁条件提示，
    // 不用 disabled——禁用按钮不派发 click）；已解锁则按金币置灰 / 选中高亮
    document.querySelectorAll('.btn-tower').forEach((btn) => {
      const type = btn.dataset.type;
      const unlocked = TDStorage.isTowerUnlocked(type, this.levelId);
      btn.classList.toggle('locked', !unlocked);
      btn.disabled = unlocked && this.gold < TD_CONFIG.towers[type].cost;
      btn.classList.toggle('active', unlocked && this.selectedType === type);
    });

    // 暂停 / 倍速按钮
    document.getElementById('btn-pause').textContent = this.paused ? '▶ 继续' : '⏸ 暂停';
    const speedBtn = document.getElementById('btn-speed');
    speedBtn.textContent = this.speedMul + 'x';
    speedBtn.classList.toggle('on', this.speedMul === 2);

    // 移动端合并菜单：暂停/继续文案 + 1x/2x 当前档高亮（元素不存在于旧 DOM 时跳过）
    const mPause = document.getElementById('m-menu-pause');
    if (mPause) mPause.textContent = this.paused ? '▶ 继续' : '⏸ 暂停';
    const mSp1 = document.getElementById('m-menu-speed1');
    const mSp2 = document.getElementById('m-menu-speed2');
    if (mSp1) mSp1.classList.toggle('active', this.speedMul === 1);
    if (mSp2) mSp2.classList.toggle('active', this.speedMul === 2);

    // 波次控制区
    const info = document.getElementById('wave-info');
    const waveBtn = document.getElementById('btn-wave');
    if (this.state === 'ready') {
      waveBtn.disabled = false;
      if (this.countdown === null) {
        info.textContent = '准备就绪';
        waveBtn.textContent = '开始第 1 波';
      } else {
        info.textContent = '下一波 ' + Math.ceil(this.countdown) + 's';
        waveBtn.textContent = '⏩ 提前开始';
      }
    } else if (this.state === 'active') {
      /* 支线波（第 4 关右侧岔路奇兵）进行中：波次编号仍指向下一个主波，
         状态文字单独提示，避免与主波“第 N 波”混淆 */
      info.textContent = this.activeSideWave
        ? '右侧岔路奇兵 进行中'
        : '第 ' + (this.waveIndex + 1) + ' 波 进行中';
      waveBtn.textContent = '战斗中…';
      waveBtn.disabled = true;
    } else {
      info.textContent = '';
      waveBtn.textContent = '已结束';
      waveBtn.disabled = true;
    }
  }
}
