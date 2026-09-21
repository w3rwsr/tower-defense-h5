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
      { path: TD_CONFIG.path, waves: TD_CONFIG.waves, hpGrowth: 1, economy: TD_CONFIG.economy };

    /* ---- 路径几何预计算 ---- */
    this.buildPathGeometry();

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
    this.occupied = new Map();      // "col,row" -> Tower
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
   * ============================================================ */
  buildPathGeometry() {
    const wp = this.levelCfg.path.waypoints;
    this.waypoints = wp;
    this.segments = [];
    this.totalLength = 0;
    for (let i = 0; i < wp.length - 1; i++) {
      const len = Phaser.Math.Distance.Between(wp[i].x, wp[i].y, wp[i + 1].x, wp[i + 1].y);
      this.segments.push({
        x1: wp[i].x, y1: wp[i].y, x2: wp[i + 1].x, y2: wp[i + 1].y,
        start: this.totalLength, len
      });
      this.totalLength += len;
    }
    this.pathLength = this.totalLength;
  }

  /** 按“已走距离”取路径坐标 */
  pathPointAt(dist) {
    if (dist <= 0) return { x: this.waypoints[0].x, y: this.waypoints[0].y };
    for (const s of this.segments) {
      if (dist <= s.start + s.len) {
        const t = (dist - s.start) / s.len;
        return { x: s.x1 + (s.x2 - s.x1) * t, y: s.y1 + (s.y2 - s.y1) * t };
      }
    }
    const last = this.waypoints[this.waypoints.length - 1];
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
   * 可放置区域图层：遍历全部网格，绘制所有合法格子的可视化标识
   * 绿色半透明填充 + 深绿描边，与路径 / 已占格 / 边界形成明显区分
   * ============================================================ */
  drawPlacementGrid() {
    const g = this.placementGridGfx;
    g.clear();
    const cell = TD_CONFIG.build.cell;
    const pad = 4;
    const fillCol = 0x6be86b;
    const borderCol = 0x2e7d1c;

    for (let row = 0; row * cell < this.H; row++) {
      for (let col = 0; col * cell < this.W; col++) {
        const cx = col * cell + cell / 2;
        const cy = row * cell + cell / 2;
        if (!this.canBuildAt(cx, cy, col, row)) continue;
        const x = cx - cell / 2 + pad;
        const y = cy - cell / 2 + pad;
        const w = cell - pad * 2, h = cell - pad * 2;
        g.fillStyle(fillCol, 0.30);
        g.fillRoundedRect(x, y, w, h, 10);
        g.lineStyle(2, borderCol, 0.65);
        g.strokeRoundedRect(x, y, w, h, 10);
      }
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
    const wp = this.waypoints;
    const pcfg = this.levelCfg.path;
    const w = TD_CONFIG.world.pathWidth;
    // 深色描边 + 浅色路面
    this.fatStroke(g, wp, w + 10, pcfg.borderColor);
    this.fatStroke(g, wp, w, pcfg.fillColor);

    // 起点（绿色传送门）/ 终点（红色洞穴）
    const st = wp[0], ed = wp[wp.length - 1];
    g.lineStyle(5, 0x3f9e34, 1); g.fillStyle(0x8be86b, 0.9);
    g.fillCircle(st.x, st.y, 26); g.strokeCircle(st.x, st.y, 26);
    g.fillStyle(0xffffff, 0.5); g.fillCircle(st.x - 4, st.y - 5, 7);
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
    for (let i = 0; i < 30; i++) {
      const x = 20 + rnd() * (this.W - 40);
      const y = 20 + rnd() * (this.H - 40);
      if (this.distToPath(x, y) < 46) continue; // 不压在路面上
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
        fire: (tower, target) => this.fireProjectile(tower, target)
      };
      /* 塔先于敌更新：塔D（PullBehavior）先标记 pullFresh/写位移，敌再据其位移；
         普通 AttackBehavior 同样先于敌，1 帧索敌延迟不可见 */
      for (const t of this.towers) t.update(dt, ctx);

      for (const e of this.enemies) e.update(dt);
      this.enemies = this.enemies.filter((e) => !e.removed);

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
        this.spawnEnemy(this.spawnList[this.spawnIdx].type);
        this.spawnIdx++;
      }
    }
  }

  startWave() {
    if (this.state !== 'ready') return;
    const groups = this.levelCfg.waves.list[this.waveIndex];
    this.spawnList = [];
    groups.forEach((grp) => {
      for (let i = 0; i < grp.count; i++) {
        this.spawnList.push({ t: grp.delay + i * grp.interval, type: grp.type });
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
    const bonus = this.levelCfg.waves.clearBonus[this.waveIndex] || 0;
    this.gold += bonus;
    this.waveIndex++;
    if (this.waveIndex >= this.levelCfg.waves.list.length) {
      this.endGame(true);
      return;
    }
    this.state = 'ready';
    this.countdown = this.levelCfg.waves.intermission;
    this.banner('清场奖励 +' + bonus + ' 金币', 0xbef78a);
  }

  /* 敌人出生：按波数成长缩放血量；BOSS 血量单独按「普通怪当前波血量 × 5」计算。
     - 普通怪：maxHp = cfg.hp × hpGrowth^waveIndex（复合递增）
     - BOSS：maxHp = enemyX.hp × hpGrowth^waveIndex × boss.hpMultiplier；
              leakDamage = enemyX.leakDamage × boss.leakMultiplier（普通怪的 3 倍） */
  spawnEnemy(typeKey) {
    const e = new Enemy(this, typeKey);
    const growth = this.levelCfg.hpGrowth || 1;
    const waveFactor = Math.pow(growth, this.waveIndex);
    const isBoss = !!e.cfg.boss;
    if (isBoss) {
      const bossCfg = TD_CONFIG.boss || { hpMultiplier: 5, leakMultiplier: 3 };
      const normalBase = TD_CONFIG.enemies.enemyX;
      e.maxHp = Math.round(normalBase.hp * waveFactor * bossCfg.hpMultiplier);
      e.hp = e.maxHp;
      e.leakDamage = normalBase.leakDamage * bossCfg.leakMultiplier;
    } else {
      e.maxHp = Math.round(e.cfg.hp * waveFactor);
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
         拖过的每个合法空格都立即放置，体验类似"画笔刷塔"） */
      if (pointer.isDown && !pointer.rightButtonDown()) {
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

    // 2) 放置模式：网格吸附 + 合法性校验
    if (this.selectedType) {
      this.tryPlaceAt(x, y);
      return;
    }

    // 3) 点空地：取消选中
    this.hidePanel();
    this.selectedTower = null;
    this.rangeGfx.clear();
  }

  /** 放置模式下的网格吸附 + 校验 + 落子（供左键点击与拖动共用） */
  tryPlaceAt(x, y) {
    const cell = TD_CONFIG.build.cell;
    const col = Math.floor(x / cell);
    const row = Math.floor(y / cell);
    const cx = col * cell + cell / 2;
    const cy = row * cell + cell / 2;
    if (this.canBuildAt(cx, cy, col, row)) {
      this.placeTower(cx, cy, col, row);
    } else {
      this.floatText(cx, cy, '✕ 不能放这里', 0xffffff);
      this.drawGhost(x, y);
    }
  }

  /** 出售并移除已放置的塔（左键面板按钮、右键直接出售共用） */
  sellTower(tower) {
    if (!tower) return;
    this.gold += tower.getSellValue();
    const col = Math.floor(tower.x / TD_CONFIG.build.cell);
    const row = Math.floor(tower.y / TD_CONFIG.build.cell);
    this.occupied.delete(this.cellKey(col, row));
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

  cellKey(col, row) { return col + ',' + row; }

  canBuildAt(x, y, col, row) {
    const b = TD_CONFIG.build;
    if (x < b.edgeMargin || x > this.W - b.edgeMargin || y < b.edgeMargin || y > this.H - b.edgeMargin) return false;
    if (this.occupied.has(this.cellKey(col, row))) return false;
    if (this.distToPath(x, y) < b.minPathDistance) return false;
    return true;
  }

  /** 放置预览：绿色=可放 / 红色=非法，并显示射程 */
  drawGhost(x, y) {
    const g = this.ghost;
    g.clear();
    if (!this.selectedType) return;
    const cfg = TD_CONFIG.towers[this.selectedType];
    const cell = TD_CONFIG.build.cell;
    const col = Math.floor(x / cell);
    const row = Math.floor(y / cell);
    const cx = col * cell + cell / 2;
    const cy = row * cell + cell / 2;
    const ok = this.canBuildAt(cx, cy, col, row) && this.gold >= cfg.cost;
    const color = ok ? 0x6be86b : 0xff5d5d;

    // 网格落点提示
    g.fillStyle(0xffffff, 0.12);
    g.fillRoundedRect(cx - cell / 2 + 4, cy - cell / 2 + 4, cell - 8, cell - 8, 12);
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

  placeTower(x, y, col, row) {
    const typeKey = this.selectedType;
    const cfg = TD_CONFIG.towers[typeKey];
    if (this.gold < cfg.cost) { this.setPlacement(null); return; }
    this.gold -= cfg.cost;
    const tower = new Tower(this, x, y, typeKey);
    this.towers.push(tower);
    this.occupied.set(this.cellKey(col, row), tower);
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
    const isPull = tower.cfg.effect && tower.cfg.effect.type === 'pull';
    p._stats.setText(
      isPull
        ? '类型 范围吸引·控场\n射程 ' + tower.stats.range + '   伤害 ' + tower.stats.damage
        : ('伤害 ' + tower.stats.damage +
           '   射程 ' + tower.stats.range +
           '\n攻速 ' + (1 / tower.stats.cooldown).toFixed(2) + ' 次/秒')
    );

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

  spawnSplashFx(x, y, radius, color) {
    const g = this.add.graphics().setPosition(x, y).setDepth(45);
    g.fillStyle(color, 0.35);
    g.fillCircle(0, 0, 10);
    this.tweens.add({
      targets: g, scaleX: radius / 10, scaleY: radius / 10, alpha: 0,
      duration: 320, onComplete: () => g.destroy()
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
   * 塔 D「沿路吸附」真实运行时自查（控制台 window.__tdPullTest()）。
   * 几何夹具（Level 2 路径，建议在第 2 关内运行；Level 1 首段同为 y=100 水平段）：
   *   段0 (-40,100)→(720,100)，段1 (720,100)→(720,250)。
   *   塔1 (300,200)：投影点 footDist=340；塔2 (780,150) 卡拐角，投影 footDist=810。
   *   eA 420 在塔1射程内（回拉目标 80）、eB 740 在射程外；
   *   eD 850 在拐角竖段（回拉 40，必须严格竖直、x 恒为 720）。
   * 时序（脉冲 0–0.5s，间隙 0.5–2.0s，第二次脉冲 2.0–2.5s）：
   *   0.3s 查首次吸附 + 在路；0.25–0.45s 查 ctrlSlow；
   *   1.5s 查回弹归位；1.9s 查脉冲间隙；2.15s 查第二次脉冲。
   */
  async runPullTest() {
    const report = { step: 'init', tower: null, phase1: null, ctrlSlow: null,
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
      const mkEnemy = (dist) => {
        const e = new Enemy(this, 'enemyX');
        e.pathDist = dist;
        e.baseSpeed = 0;
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
        stats: tower.stats,
        effect: tower.cfg.effect
      };

      const eA = mkEnemy(420);  // (380,100) 距塔1≈128<140，目标回拉 80
      const eB = mkEnemy(740);  // (700,100) 距塔1≈412>140，射程外
      const eD = mkEnemy(850);  // (720,190) 拐角竖段，距塔2≈72<140，目标回拉 40

      // ---- t=0.3s：首次脉冲窗口内 ----
      await new Promise(r => setTimeout(r, 300));
      report.phase1 = {
        A: { pullBack: eA.pullBack, onPathDist: onPath(eA), x: eA.x, y: eA.y },
        B: { pullBack: eB.pullBack, onPathDist: onPath(eB) },
        D: { pullBack: eD.pullBack, onPathDist: onPath(eD), x: eD.x, y: eD.y },
        A_pulled: eA.pullBack > 10,
        B_notPulled: eB.pullBack < 5,
        allOnPath: onPath(eA) < 0.5 && onPath(eB) < 0.5 && onPath(eD) < 0.5,
        D_strictVertical: Math.abs(eD.x - 720) < 0.5
      };

      // ---- t=0.25~0.45s（仍在首个 0.5s 窗口内）：ctrlSlow 压制但仍在前进 ----
      const eC = mkEnemy(420);
      eC.baseSpeed = TD_CONFIG.enemies.enemyX.speed;
      const pdBefore = eC.pathDist;
      await new Promise(r => setTimeout(r, 200));
      const delta = eC.pathDist - pdBefore;
      const expectedNormal = TD_CONFIG.enemies.enemyX.speed * 0.2;
      report.ctrlSlow = {
        pathDistDelta: delta,
        expectedNormal,
        expectedCtrlSlow: expectedNormal * 0.5,
        pullBack: eC.pullBack,
        onPathDist: onPath(eC),
        slowedButMoving: delta > expectedNormal * 0.25 && delta < expectedNormal * 0.7
      };

      // ---- t=1.5s：脉冲间隙已 1s，pullBack 应衰减归零（回弹到路径位置继续走） ----
      await new Promise(r => setTimeout(r, 1050));
      report.release = { time: 1.5, A_pullBack: eA.pullBack, A_onPathDist: onPath(eA),
        returnedToPath: eA.pullBack < 2 && onPath(eA) < 0.5 };

      // ---- t=1.9s：第二次脉冲（2.0s）前的间隙，仍应归零 ----
      await new Promise(r => setTimeout(r, 400));
      report.intervalGap = { time: 1.9, A_pullBack: eA.pullBack, inGap: eA.pullBack < 2 };

      // ---- t=2.15s：第二次脉冲窗口（2.0–2.5s），再次被回拉 ----
      await new Promise(r => setTimeout(r, 250));
      report.secondPulse = {
        time: 2.15,
        A_pullBack: eA.pullBack, A_onPathDist: onPath(eA),
        D_pullBack: eD.pullBack, D_onPathDist: onPath(eD),
        firedAgain: eA.pullBack > 10,
        onPath: onPath(eA) < 0.5 && onPath(eD) < 0.5
      };

      report.conclusion = {
        behaviorIsPull: report.tower.isPullBehavior,
        intervalIs2s: report.tower.intervalSec === 2,
        A_pulled: report.phase1.A_pulled,
        B_notPulled: report.phase1.B_notPulled,
        alwaysOnPath: report.phase1.allOnPath && report.ctrlSlow.onPathDist < 0.5 &&
                      report.release.A_onPathDist < 0.5 && report.secondPulse.onPath,
        cornerNoSideways: report.phase1.D_strictVertical,
        returnedToPath: report.release.returnedToPath,
        pulseGapClear: report.intervalGap.inGap,
        pulseEvery2s: report.secondPulse.firedAgain,
        slowedButMoving: report.ctrlSlow.slowedButMoving,
        pass: report.tower.isPullBehavior && report.tower.intervalSec === 2 &&
              report.phase1.A_pulled && report.phase1.B_notPulled &&
              report.phase1.allOnPath && report.phase1.D_strictVertical &&
              report.release.returnedToPath && report.intervalGap.inGap &&
              report.secondPulse.firedAgain && report.secondPulse.onPath &&
              report.ctrlSlow.slowedButMoving
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
