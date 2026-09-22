/* ============================================================
 * GameScene.js —— 主游戏场景
 * 职责：地图绘制 / 放塔 / 选塔升级出售 / 波次状态机 /
 *       金币生命 / 暂停 / 1x-2x 倍速 / DOM HUD 同步
 * ============================================================ */
class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  create(data) {
    this.W = TD_CONFIG.world.width;
    this.H = TD_CONFIG.world.height;

    /* 进入游戏场景，恢复 HUD 显示 */
    document.getElementById('hud-top').style.display = '';
    document.getElementById('hud-bottom').style.display = '';

    /* 当前关卡编号（来自关卡选择场景），默认第 1 关 */
    this.levelId = (data && data.levelId) || 1;

    /* 关卡独立配置：Level 1 回退到顶层 path/waves/economy（零改动保持已正常体验） */
    this.levelCfg = TD_CONFIG.levels[this.levelId] ||
      { path: TD_CONFIG.path, waves: TD_CONFIG.waves, economy: TD_CONFIG.economy };

    /* 放塔规则：顶层 build 为底，关卡 build 覆盖（如第 2 关更密的采样间距）；
       第 1 关新手教程单独用 tutorialCell（点更少、更简单） */
    this.buildCfg = Object.assign({}, TD_CONFIG.build, this.levelCfg.build || {});

    /* ---- 路径几何预计算 ---- */
    this.buildPathGeometry();

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
    this.drawDecor();

    /* ---- 游戏状态 ---- */
    const econ = this.levelCfg.economy || TD_CONFIG.economy;
    this.gold = econ.startGold;
    this.lives = econ.startLives;
    this.towers = [];
    this.enemies = [];
    this.projectiles = [];
    /* this.obstacles 已在 create 开头的 spawnObstacles() 生成，这里不再重置 */
    this.occupied = new Map();      // 热区 key("x_y") -> Tower
    this.selectedType = null;       // 商店选中的塔类型（放置模式）
    this.selectedTower = null;
    this.paused = false;
    this.speedMul = 1;

    /* ---- 波次状态机：ready(可开战) / active(出怪中) / won / lost ---- */
    this.state = 'ready';
    this.waveIndex = 0;
    this.countdown = null;
    this.spawnList = [];
    this.spawnIdx = 0;
    this.spawnClock = 0;

    /* ---- 预览 / 选中 画面 ---- */
    this.ghost = this.add.graphics().setDepth(500);
    this.rangeGfx = this.add.graphics().setDepth(499);

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

    /* 第 1 关 = 新手教程关，启动引导提示 */
    if (this.levelId === 1) this.startTutorial();
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
    this.routeGeoms = routeWpLists.map((wp) => {
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
    /* 全局筛选：画面边界内 + 避路硬校验 + 最小间距去重 */
    this.hotspots = [];
    for (const p of raw) {
      if (p.x < b.edgeMargin || p.x > this.W - b.edgeMargin ||
          p.y < b.edgeMargin || p.y > this.H - b.edgeMargin) continue;
      if (this.distToPath(p.x, p.y) < b.minPathDistance) continue;
      let dup = false;
      for (const h of this.hotspots) {
        if (Math.abs(h.x - p.x) < minSpacing && Math.abs(h.y - p.y) < minSpacing) { dup = true; break; }
      }
      if (dup) continue;
      const rx = Math.round(p.x), ry = Math.round(p.y);
      this.hotspots.push({ x: rx, y: ry, key: rx + '_' + ry, kind: 'road' });
    }

    /* 关卡专属额外火力点（JSON 驱动 build.extraSpots，仅部分关卡如第 3 关）：
       覆盖道路、不压路、与已有热区去重，保证布局整齐不杂乱 */
    const extra = b.extraSpots || [];
    for (const p of extra) {
      if (p.x < b.edgeMargin || p.x > this.W - b.edgeMargin ||
          p.y < b.edgeMargin || p.y > this.H - b.edgeMargin) continue;
      if (this.distToPath(p.x, p.y) < b.minPathDistance) continue;
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

    /* 候选点合法性：界内 + 不压路 + 与全部已有热区保持间距 + 不贴其他障碍物。
       minSpace 可放宽（首选失败时兜底），但避路/界内/覆盖距离永不放宽。 */
    const validSpot = (p, self, minSpace) => {
      if (p.x < b.edgeMargin || p.x > this.W - b.edgeMargin ||
          p.y < b.edgeMargin || p.y > this.H - b.edgeMargin) return false;
      if (this.distToPath(p.x, p.y) < b.minPathDistance) return false;
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

  /**
   * 构建道路轮廓多边形：取中心线 waypoints，向左右法向各偏移 halfWidth，
   * 返回闭合多边形顶点数组（边缘A正向 + 边缘B逆向）。
   * 拐角处用圆弧（round join）采样：以路径点为圆心、halfWidth 为半径，
   * 在入/出法线之间插入 arcSteps 个弧线点，实现圆润拐角。
   * 道路宽度恒定（两弧对径距离=2×halfWidth），拐角不变粗变细。
   * 多路线汇合处各路多边形重叠填充（同色无痕）。
   */
  buildRoadPolygon(waypoints, halfWidth) {
    if (waypoints.length < 2) return [];
    const arcSteps = 8;       // 圆角弧线采样点数（越大越平滑）
    const edgeA = [], edgeB = []; // 道路两侧边缘点
    for (let i = 0; i < waypoints.length; i++) {
      const p = waypoints[i];
      if (i === 0) {
        /* 起点：平直边（法向偏移） */
        const dx = waypoints[1].x - p.x, dy = waypoints[1].y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        edgeA.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth });
        edgeB.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth });
      } else if (i === waypoints.length - 1) {
        /* 终点：平直边 */
        const dx = p.x - waypoints[i - 1].x, dy = p.y - waypoints[i - 1].y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        edgeA.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth });
        edgeB.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth });
      } else {
        /* 拐角：圆弧过渡——以 p 为圆心、halfWidth 为半径，
           在入法线→出法线之间插入弧线点，实现圆润拐角 */
        const d1x = p.x - waypoints[i - 1].x, d1y = p.y - waypoints[i - 1].y;
        const d2x = waypoints[i + 1].x - p.x, d2y = waypoints[i + 1].y - p.y;
        const l1 = Math.hypot(d1x, d1y) || 1;
        const l2 = Math.hypot(d2x, d2y) || 1;
        /* 入/出方向单位向量 */
        const t1x = d1x / l1, t1y = d1y / l1;
        const t2x = d2x / l2, t2y = d2y / l2;
        /* 入/出法线（左侧 = 旋转 90°） */
        const n1x = -t1y, n1y = t1x;
        const n2x = -t2y, n2y = t2x;
        /* 边缘A：从 n1 到 n2 的最短弧 */
        const a1 = Math.atan2(n1y, n1x);
        const a2 = Math.atan2(n2y, n2x);
        let delta = a2 - a1;
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        for (let s = 0; s <= arcSteps; s++) {
          const a = a1 + delta * (s / arcSteps);
          edgeA.push({ x: p.x + Math.cos(a) * halfWidth, y: p.y + Math.sin(a) * halfWidth });
        }
        /* 边缘B：从 -n1 到 -n2 的最短弧（对径，在道路另一侧） */
        const ra1 = Math.atan2(-n1y, -n1x);
        const ra2 = Math.atan2(-n2y, -n2x);
        let rdelta = ra2 - ra1;
        if (rdelta > Math.PI) rdelta -= 2 * Math.PI;
        if (rdelta < -Math.PI) rdelta += 2 * Math.PI;
        for (let s = 0; s <= arcSteps; s++) {
          const a = ra1 + rdelta * (s / arcSteps);
          edgeB.push({ x: p.x + Math.cos(a) * halfWidth, y: p.y + Math.sin(a) * halfWidth });
        }
      }
    }
    return edgeA.concat(edgeB.reverse());
  }

  drawPath() {
    const g = this.add.graphics().setDepth(1);
    const pcfg = this.levelCfg.path || {};
    const w = TD_CONFIG.world.pathWidth;
    const borderColor = (pcfg.borderColor != null) ? pcfg.borderColor : 0xc99a54;
    const fillColor = (pcfg.fillColor != null) ? pcfg.fillColor : 0xeac58f;

    /* 道路绘制：用填充多边形代替粗线+圆点，消除路径点处的可见圆圈。
       每条路线构建两侧边缘多边形（法向偏移 halfWidth），拐角处圆弧过渡
       （round join），道路宽度恒定，拐角圆润平滑不变粗细。
       汇合处两路多边形重叠填充（同色无痕），无圆圈、无缺口。
       先画全部描边多边形（更宽 w+10），再画全部路面多边形（更窄 w），
       描边在路面之下形成边缘，颜色自然过渡。 */
    for (const rg of this.routeGeoms) {
      const pts = this.buildRoadPolygon(rg.waypoints, (w + 10) / 2);
      g.fillStyle(borderColor, 1);
      g.fillPoints(pts, true);
    }
    for (const rg of this.routeGeoms) {
      const pts = this.buildRoadPolygon(rg.waypoints, w / 2);
      g.fillStyle(fillColor, 1);
      g.fillPoints(pts, true);
    }

    /* 起点（绿色传送门）：每条路线各画一个（多出怪点） */
    for (const rg of this.routeGeoms) {
      const wp = rg.waypoints;
      const st = wp[0];
      g.lineStyle(5, 0x3f9e34, 1); g.fillStyle(0x8be86b, 0.9);
      g.fillCircle(st.x, st.y, 26); g.strokeCircle(st.x, st.y, 26);
      g.fillStyle(0xffffff, 0.5); g.fillCircle(st.x - 4, st.y - 5, 7);
    }
    /* 终点（红色洞穴）：所有路线共用同一终点，画一次即可 */
    const lastWp = this.routeGeoms[this.routeGeoms.length - 1].waypoints;
    const ed = lastWp[lastWp.length - 1];
    g.lineStyle(5, 0x7a2a2a, 1); g.fillStyle(0x5d3328, 1);
    g.fillCircle(ed.x, ed.y, 26); g.strokeCircle(ed.x, ed.y, 26);
    g.fillStyle(0x2e1812, 1); g.fillCircle(ed.x, ed.y, 16);
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
    // 暂停或结算时冻结全部逻辑（画面保持）
    const rawDt = Math.min(delta, 50) / 1000;
    const dt = (this.paused || this.state === 'won' || this.state === 'lost')
      ? 0 : rawDt * this.speedMul;

    if (dt > 0) {
      this.updateWaves(dt);

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

      /* 障碍物：被摧毁的从场上下排在销毁动画结束后移除（本体已 dead） */
      this.obstacles = this.obstacles.filter((o) => !o.dead);

      for (const p of this.projectiles) p.update(dt);
      this.projectiles = this.projectiles.filter((p) => !p.done);

      /* 一波结束判定：不再出怪且场上无敌人 */
      if (this.state === 'active' && this.spawnIdx >= this.spawnList.length && this.enemies.length === 0) {
        this.onWaveCleared();
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
    const wcfg = this.levelCfg.waves;
    const groups = wcfg.list[this.waveIndex];
    const routeCount = this.routeGeoms.length;
    /* 第 1 波仅上路（route 0）出怪（JSON 驱动开关 firstWaveRouteOnly）；
       第 2 波起恢复全部路线同时出怪。单路线关卡 routeCount=1，无影响。 */
    const firstOnly = (this.waveIndex === 0 && wcfg.firstWaveRouteOnly);
    const routesToSpawn = firstOnly ? 1 : routeCount;
    this.spawnList = [];
    groups.forEach((grp) => {
      for (let r = 0; r < routesToSpawn; r++) {
        for (let i = 0; i < grp.count; i++) {
          this.spawnList.push({
            t: grp.delay + i * grp.interval,
            type: grp.type,
            route: r,
            bossHpFactor: grp.bossHpFactor
          });
        }
      }
    });
    this.spawnList.sort((a, b) => a.t - b.t);
    this.spawnIdx = 0;
    this.spawnClock = 0;
    this.countdown = null;
    this.state = 'active';
    this.banner('第 ' + (this.waveIndex + 1) + ' 波 开始！', 0xfff2a0);
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
       （第 5 波 = base × 1.5^4，与"每波比前波 +50%"完全一致）。 */
  waveSmallHp(baseHp) {
    const wcfg = this.levelCfg.waves;
    const total = wcfg.list.length;
    const growth = (wcfg.hpGrowth != null ? wcfg.hpGrowth : 1.5);
    const wi = this.waveIndex;
    const special = (wcfg.finalWaveSpecial !== false); // 缺省 true：末波走特例翻倍
    if (special && total >= 2 && wi === total - 1) {
      const prevHp = Math.round(baseHp * Math.pow(growth, wi - 1));
      return Math.round(prevHp * (wcfg.finalWaveHpFactor != null ? wcfg.finalWaveHpFactor : 2));
    }
    return Math.round(baseHp * Math.pow(growth, wi));
  }

  /* 敌人出生：按波数成长缩放血量（规则见 waveSmallHp）；
     BOSS 血量 = 同波小怪(enemyX)血量 × bossFactor，bossFactor 优先级：
     group.bossHpFactor（per-group，第 3 关第 3/4 波 16×、第 5 波 40×）
     > wcfg.finalBossHpFactor（末波兜底） > boss.hpMultiplier（全局兜底）；
     漏血 = enemyX.leakDamage × boss.leakMultiplier（普通怪的 3 倍）。
     entry.route 指定敌人所属路线（多路线关卡），缺省 0。 */
  spawnEnemy(entry) {
    const typeKey = entry.type;
    const routeId = entry.route || 0;
    const e = new Enemy(this, typeKey, routeId);
    const isBoss = !!e.cfg.boss;
    if (isBoss) {
      const wcfg = this.levelCfg.waves;
      const bossCfg = TD_CONFIG.boss || { hpMultiplier: 8, leakMultiplier: 3 };
      let bossFactor;
      if (entry.bossHpFactor != null) bossFactor = entry.bossHpFactor;
      else if (wcfg.finalBossHpFactor != null) bossFactor = wcfg.finalBossHpFactor;
      else bossFactor = bossCfg.hpMultiplier;
      e.maxHp = this.waveSmallHp(TD_CONFIG.enemies.enemyX.hp) * bossFactor;
      e.hp = e.maxHp;
      e.leakDamage = TD_CONFIG.enemies.enemyX.leakDamage * bossCfg.leakMultiplier;
    } else {
      e.maxHp = this.waveSmallHp(e.cfg.hp);
      e.hp = e.maxHp;
      e.drawHpBar(1); // 血量上限变化后重绘满血条宽度
    }
    this.enemies.push(e);
  }

  onEnemyKilled(e) {
    if (e.dead) return;
    e.dead = true;
    this.gold += e.reward;
    this.floatText(e.x, e.y - e.radius - 6, '+' + e.reward, 0xffe27a);
    e.playDeath();
  }

  onEnemyLeak(e) {
    this.lives = Math.max(0, this.lives - e.leakDamage);
    this.floatText(Math.max(40, e.x), Math.min(this.H - 60, e.y), '-' + e.leakDamage + ' ❤️', 0xff8a8a);
    e.destroyImmediately();
    if (this.lives <= 0) this.endGame(false);
  }

  endGame(win) {
    this.state = win ? 'won' : 'lost';
    this.ghost.clear();
    this.hidePanel();
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
      this.drawGhost(pointer.x, pointer.y);
      /* 左键按住拖动：连续放置（仅在放置模式 + 鼠标左键按下时触发，
         拖过的每个合法空格都立即放置，体验类似"画笔刷塔"）。
         拖到障碍物上不落塔（障碍物区域不可建造）。 */
      if (pointer.isDown && !pointer.rightButtonDown() && !this.getObstacleAt(pointer.x, pointer.y)) {
        this.tryPlaceAt(pointer.x, pointer.y);
      }
    }
  }

  onPointerDown(pointer) {
    const x = pointer.x, y = pointer.y;

    /* 右键：仅用于取消放置模式。
       右键直接出售已放置塔的功能已移除——出售塔请使用左键点塔
       弹出升级/出售面板，再点面板中的"出售"按钮。 */
    if (pointer.rightButtonDown()) {
      if (this.selectedType) {
        this.setPlacement(null);
        this.floatText(x, y, '已取消放置', 0xffe27a);
      }
      return;
    }

    // 点在升级/出售面板上：交给面板按钮，不触发放塔/取消
    if (this.panel.visible) {
      const panelHits = this.input.manager.hitTest(pointer, this.panel.list, this.cameras.main);
      if (panelHits.length > 0) return;
    }

    // 1) 优先点选已有塔（放大触控热区）
    const tower = this.getTowerAt(x, y);
    if (tower) {
      this.setPlacement(null);
      this.selectTower(tower);
      return;
    }

    // 2) 障碍物：不可放塔；放置模式点击仅提示，普通模式点击=指派最近的塔攻击
    const ob = this.getObstacleAt(x, y);
    if (ob) {
      if (this.selectedType) {
        this.floatText(ob.x, ob.y - 30, '障碍物，不能放塔', 0xff9d9d);
        this.tweens.add({ targets: ob.img, scaleX: 1.12, scaleY: 0.9, duration: 90, yoyo: true });
      } else {
        this.clickObstacle(ob);
      }
      return;
    }

    // 3) 放置模式：网格吸附 + 合法性校验
    if (this.selectedType) {
      this.tryPlaceAt(x, y);
      return;
    }

    // 4) 点空地：取消选中
    this.hidePanel();
    this.selectedTower = null;
    this.rangeGfx.clear();
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
    /* 塔被卖掉时解除其障碍物转火锁定 */
    if (tower.obstacleTarget) {
      tower.obstacleTarget.assignedTower = null;
      tower.obstacleTarget = null;
    }
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

  /** 热区是否可放：画面边界 + 热区未占用 + 塔心离路径中心线足够远（避路） */
  canBuildAt(x, y, key) {
    const b = TD_CONFIG.build;
    if (x < b.edgeMargin || x > this.W - b.edgeMargin || y < b.edgeMargin || y > this.H - b.edgeMargin) return false;
    if (this.occupied.has(key)) return false;
    if (this.distToPath(x, y) < b.minPathDistance) return false;
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
    for (const c of cand) {
      if (this.obstacles.length >= ocfg.maxCount) break;
      let dup = false;
      for (const o of this.obstacles) {
        if (Math.abs(o.x - c.x) < ocfg.spacing && Math.abs(o.y - c.y) < ocfg.spacing) { dup = true; break; }
      }
      if (dup) continue;
      this.obstacles.push(this.makeObstacle(c.x, c.y, kinds[Math.floor(rnd() * kinds.length)]));
    }
  }

  /** 创建单个障碍物：贴图 + 常显血条（攻击进度一目了然） */
  makeObstacle(x, y, kind) {
    const ocfg = TD_CONFIG.obstacles;
    const img = this.add.image(x, y, 'obst_' + kind).setDepth(8);
    const bar = this.add.graphics().setDepth(30);
    const ob = {
      isObstacle: true, x, y, kind,
      hp: ocfg.hp, maxHp: ocfg.hp, radius: ocfg.radius,
      img, bar, baseScale: 1,
      barY: -(img.height / 2) - 10,       // 血条挂在顶上方
      assignedTower: null, dead: false
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

  /** 障碍物被摧毁：奖励金币、解除塔的转火锁定、播放消散动画 */
  destroyObstacle(ob) {
    if (ob.dead) return;
    ob.dead = true;
    if (ob.assignedTower) {
      ob.assignedTower.obstacleTarget = null;
      ob.assignedTower = null;
    }
    const reward = TD_CONFIG.obstacles.reward;
    this.gold += reward;
    this.syncHud();
    this.floatText(ob.x, ob.y - 34, '+' + reward, 0xffd84a);
    ob.bar.destroy();
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

  /** 点击障碍物：只在【射程圈能覆盖到障碍物本体】的伤害型塔中，指派距离最近
   *  的一座转火攻击。
   *  - 覆盖口径：塔心到障碍物中心 ≤ tower.range + ob.radius（射程擦到障碍物
   *    实体即可打，与 AttackBehavior 的开火判定完全同口径，杜绝“指派了却
   *    打不到/打空气”）；
   *  - 哪怕物理距离更近，射程覆盖不到的塔也绝不入选；
   *  - 没有任何塔覆盖时：不攻击、不转火，仅给一行文字反馈；
   *  - 塔D（无伤害的范围吸引塔）不能攻击障碍物，不参与指派。 */
  clickObstacle(ob) {
    let best = null, bestD2 = Infinity;
    for (const t of this.towers) {
      if (!t.stats.damage) continue;                       // 无伤害塔（塔D）跳过
      const eff = t.cfg.effect;
      if (eff && eff.type === 'pull') continue;            // 吸引塔无弹道，跳过
      const dx = t.x - ob.x, dy = t.y - ob.y;
      const d2 = dx * dx + dy * dy;
      const reach = t.stats.range + ob.radius;             // 覆盖到障碍物本体即可
      if (d2 <= reach * reach && d2 < bestD2) { best = t; bestD2 = d2; }
    }
    if (!best) {
      // 无塔覆盖：不攻击、不转火（浮字仅为点击反馈，不改变任何塔的目标）
      this.floatText(ob.x, ob.y - 30, '附近没有塔够得到', 0xff9d9d);
      return;
    }
    /* 一座塔只锁定一个障碍物、一个障碍物只有一座塔在打：互斥切换 */
    if (best.obstacleTarget && best.obstacleTarget !== ob) best.obstacleTarget.assignedTower = null;
    if (ob.assignedTower && ob.assignedTower !== best) ob.assignedTower.obstacleTarget = null;
    best.obstacleTarget = ob;
    ob.assignedTower = best;
    this.floatText(ob.x, ob.y - 30, best.cfg.name + ' 开火！', 0xffe27a);
    this.tweens.add({
      targets: ob.img, scaleX: ob.baseScale * 1.12, scaleY: ob.baseScale * 0.9,
      duration: 90, yoyo: true
    });
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

  placeTower(x, y, key) {
    const typeKey = this.selectedType;
    const cfg = TD_CONFIG.towers[typeKey];
    if (this.gold < cfg.cost) { this.setPlacement(null); return; }
    this.gold -= cfg.cost;
    const tower = new Tower(this, x, y, typeKey);
    tower.hotspotKey = key;            // 记录所占热区（出售时精确释放，主/交错晶格通用）
    this.towers.push(tower);
    this.occupied.set(key, tower);
    this.tweens.add({ targets: tower, scale: { from: 0.4, to: 1 }, duration: 160, ease: 'Back.out' });
    /* 放置后刷新可放置区域：被占的格子从图层中消失，无需手动清空 */
    if (this.selectedType) this.drawPlacementGrid();
    // 金币不够再放一座时自动退出放置模式
    if (this.gold < cfg.cost) this.setPlacement(null);
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
      fontStyle: 'bold', color: '#3a2c1a'
    });
    const stats = this.add.text(-W / 2 + 12, -H / 2 + 30, '', {
      fontFamily: TD_FONT_STACK, fontSize: '13px',
      color: '#5c431f'
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
      fontStyle: 'bold', color: '#3a2c1a'
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
    } else {
      p._stats.setText(
        '伤害 ' + tower.stats.damage +
        '   射程 ' + tower.stats.range +
        '\n攻速 ' + (1 / tower.stats.cooldown).toFixed(2) + ' 次/秒'
      );
    }

    const upCost = tower.getUpgradeCost();
    if (tower.canUpgrade) {
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
    this.projectiles.push(
      new Projectile(this, tower.x, tower.y - 4, target, tower.cfg.projectile, tower.stats.damage)
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

    /* 3) 炮头脉冲缩放 */
    this.tweens.add({
      targets: tower.turret, scaleX: 1.18, scaleY: 1.18,
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

  floatText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      fontFamily: TD_FONT_STACK,
      fontSize: '14px', fontStyle: 'bold',
      color: '#' + color.toString(16).padStart(6, '0')
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
      color: '#' + color.toString(16).padStart(6, '0')
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
    bindOnce('btn-speed', 'click', () => window.__tdScene && window.__tdScene.toggleSpeed());
    bindOnce('btn-levels', 'click', () => window.__tdScene && window.__tdScene.goToLevelSelect());
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
    this.setPaused(false);
    this.scene.start('LevelSelectScene');
  }

  /* ============================================================
   * 新手教程（仅第 1 关触发）
   * 4 步引导卡片：选塔 → 放塔 → 升级/出售 → 开战
   * ============================================================ */
  startTutorial() {
    this.tutorialSteps = [
      { title: '👋 欢迎，指挥官！', text: '点击下方的「塔A」按钮，选择你要建造的防御塔。' },
      { title: '🏗 建造防御塔', text: '在绿色空地上点击，就可以把塔放在那里了。\n（不能放在路径或其他塔上哦）' },
      { title: '⬆ 升级 / 出售', text: '点击已经放好的塔，可以升级它的攻击力，或者出售换金币。' },
      { title: '⚔ 开始战斗', text: '准备好后，点击「开始第 1 波」，抵御入侵的敌人吧！' }
    ];
    this.tutorialStep = 0;
    this.showTutorialStep();
  }

  /** 教程卡片的整体缩放系数：画布被缩小时放大卡片，同时不超出画布 */
  tutScale() {
    const s = this.scale.displayScale;
    const k = Math.min(s.x, s.y) || 1;
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
        fontSize: '24px', fontStyle: 'bold', color: '#2a4a7a'
      }).setOrigin(0.5);
      const text = this.add.text(0, 0, '', {
        fontFamily: TD_FONT_STACK,
        fontSize: '16px', color: '#4a3313', align: 'center', wordWrap: { width: cardW - 40 }
      }).setOrigin(0.5);
      const btn = this.add.graphics();
      /* 按钮底色加深至 #2f6fc0，白字对比度 5.1:1（AA） */
      btn.fillStyle(0x2f6fc0, 1).fillRoundedRect(-60, 50, 120, 40, 12);
      btn.lineStyle(3, 0x245a9e, 1).strokeRoundedRect(-60, 50, 120, 40, 12);
      const btnText = this.add.text(0, 70, '知道了', {
        fontFamily: TD_FONT_STACK,
        fontSize: '16px', fontStyle: 'bold', color: '#ffffff'
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
  }

  toggleSpeed() {
    this.speedMul = this.speedMul === 1 ? 2 : 1;
    if (!this.paused) this.tweens.timeScale = this.speedMul;
  }

  syncHud() {
    /* 当前关卡编号实时反映选关界面的选择（levelId 由场景启动参数传入，
       重玩沿用同一关卡；通关进度与解锁状态在返回选关时由 TDStorage
       统一读取，选关↔游戏两处始终一致）。 */
    const hudLevel = document.getElementById('hud-level');
    if (hudLevel) hudLevel.textContent = '第 ' + this.levelId + ' 关';
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
      info.textContent = '第 ' + (this.waveIndex + 1) + ' 波 进行中';
      waveBtn.textContent = '战斗中…';
      waveBtn.disabled = true;
    } else {
      info.textContent = '';
      waveBtn.textContent = '已结束';
      waveBtn.disabled = true;
    }
  }
}
