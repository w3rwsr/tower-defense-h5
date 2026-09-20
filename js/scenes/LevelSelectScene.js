/* ============================================================
 * LevelSelectScene.js —— 关卡选择界面
 * 显示 5 个关卡卡片：
 *   - 第 1 关：新手教程，可进入
 *   - 第 2 ~ 5 关：锁定状态，点击弹出"此关卡暂未开放"
 * 已通关的关卡显示 ✓ 标记（进度来自 TDStorage）。
 *
 * 自适应：
 *   - 横屏：5 张卡片单行排列
 *   - 竖屏：5 张卡片分两行（3 + 2）居中
 *   - 字号按画布实际缩放系数放大，保证小屏可读
 *   - 监听 resize / orientationchange，方向变化时重建布局
 * ============================================================ */
class LevelSelectScene extends Phaser.Scene {
  constructor() { super('LevelSelectScene'); }

  create() {
    this.W = TD_CONFIG.world.width;
    this.H = TD_CONFIG.world.height;

    /* 选关界面隐藏游戏 HUD，保持画面干净 */
    document.getElementById('hud-top').style.display = 'none';
    document.getElementById('hud-bottom').style.display = 'none';
    window.__tdScene = this;

    /* ---- 缩放感知字号：画布被缩小时，放大世界单位字号 ---- */
    this.fontScale = this.calcFontScale();

    this.buildLayout();

    /* 方向变化时重建布局。
       关键：监听器挂在游戏级 ScaleManager 上，场景关闭不会自动移除，
       必须在 shutdown 时手动 off —— 否则进入 GameScene 后旋转手机，
       残留监听器会把已关闭的选关场景重新 restart，把玩家踢出游戏。 */
    this.lastPortrait = this.isPortrait();
    this.handleResize = () => {
      if (!this.scene.isActive()) return;
      const now = this.isPortrait();
      if (now !== this.lastPortrait) {
        this.lastPortrait = now;
        this.scene.restart();
      }
    };
    this.scale.on('resize', this.handleResize);
    this.events.once('shutdown', () => this.scale.off('resize', this.handleResize));
  }

  /** 当前是否竖屏 */
  isPortrait() { return window.innerHeight > window.innerWidth; }

  /**
   * 计算字号放大系数。
   * 设计分辨率 960×540：
   *   - 横屏桌面（1366×768 及以上）：画布被 FIT 放大，世界单位字号自然合适，不放大
   *   - 竖屏/小窗口：画布被缩小（displayScale < 1），需放大世界单位字号保证可读
   */
  calcFontScale() {
    const s = this.scale.displayScale;
    const k = Math.min(s.x, s.y) || 1;
    if (k >= 1) return 1;           // 画布放大或等比时不缩放
    return Math.min(1 / k, 1.5);    // 画布缩小时放大，上限 1.5 防过度放大
  }

  /**
   * 计算“布局缩放系数”：
   *   横屏：恒为 1（基准尺寸专为 960×540 设计，Phaser FIT 会自动放大到屏幕，
   *          不再在世界单位层面二次放大，避免标题/卡片过大）
   *   竖屏：取字号缩放系数与高度容纳上限的较小值，保证不溢出且不重叠
   */
  calcLayoutScale() {
    const portrait = this.isPortrait();

    /* 横屏：固定 1，完全不依赖 displayScale，杜绝桌面分辨率下元素过大 */
    if (!portrait) return 1;

    /* 竖屏：画布被缩小时需放大世界单位字号，但受高度容纳上限与绝对上限约束 */
    const fontScale = this.calcFontScale();
    const topPad = 18, titleH = 38, subH = 13, cardH = 132;
    const rowGap = 12, hintH = 12, bottomPad = 16, gap = 8, rows = 2;
    const totalBase =
      topPad + titleH + gap + subH + gap +
      rows * cardH + (rows - 1) * rowGap +
      gap + hintH + bottomPad;

    const fitScale = this.H / totalBase;
    return Math.min(fontScale, fitScale, 1.5);
  }

  /** 按布局缩放系数放大尺寸（保证可读且不溢出） */
  ls(basePx) { return Math.round(basePx * this.layoutScale); }

  /**
   * 计算纵向布局：返回标题 / 副标题 / 卡片行 / 底部提示的 y 中心坐标，
   * 全部依据缩放后的真实高度，确保区块之间有明确间距、不重叠。
   */
  computeVerticalLayout() {
    const portrait = this.isPortrait();
    const topPad = this.ls(portrait ? 18 : 20);
    const titleH = this.ls(portrait ? 38 : 36);
    const subH = this.ls(portrait ? 13 : 15);
    const cardH = portrait ? this.ls(132) : this.ls(160);
    const rowGap = this.ls(portrait ? 12 : 0);
    const hintH = this.ls(portrait ? 12 : 12);
    const bottomPad = this.ls(portrait ? 16 : 20);
    const gap = this.ls(portrait ? 8 : 10);

    const titleY = topPad + titleH / 2;
    const subY = titleY + titleH / 2 + gap + subH / 2;
    const headerBottom = subY + subH / 2;

    const hintY = this.H - bottomPad - hintH / 2;
    const hintTop = hintY - hintH / 2;

    const rows = portrait ? 2 : 1;
    const cardsBlockH = rows * cardH + (rows - 1) * rowGap;
    const avail = hintTop - gap - headerBottom - gap;
    const blockH = Math.min(cardsBlockH, avail);
    const usedCardH = portrait ? Math.floor((blockH - rowGap) / 2) : blockH;

    const blockTop = headerBottom + gap;
    const row1Y = blockTop + usedCardH / 2;
    const row2Y = portrait ? row1Y + usedCardH + rowGap : row1Y;

    return {
      titleY, subY, hintY,
      cardH: usedCardH,
      row1Y, row2Y,
      gap
    };
  }

  buildLayout() {
    const W = this.W, H = this.H;

    /* ---- 缩放感知字号：画布被缩小时，放大世界单位字号 ---- */
    this.fontScale = this.calcFontScale();
    this.layoutScale = this.calcLayoutScale();

    const vl = this.computeVerticalLayout();

    /* ---- 背景 ---- */
    this.add.graphics().fillStyle(0x8ed861, 1).fillRect(0, 0, W, H);
    this.add.graphics().lineStyle(6, 0x6bb244, 1).strokeRect(3, 3, W - 6, H - 6);

    /* ---- 标题 ---- */
    this.add.text(W / 2, vl.titleY, '选择关卡', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(this.isPortrait() ? 38 : 36) + 'px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setStroke('#24400f', 6).setShadow(0, 3, '#000000', 0.25);

    this.add.text(W / 2, vl.subY, '守护你的王国，逐关挑战！', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(this.isPortrait() ? 13 : 15) + 'px', color: '#1e4620'
    }).setOrigin(0.5).setStroke('#e6f7d8', 3);

    /* ---- 关卡数据 ---- */
    const levelInfo = [
      { name: '新手教程', desc: '学习基础操作', emoji: '🎓' },
      { name: '未知之地', desc: '敬请期待', emoji: '🌲' },
      { name: '未知之地', desc: '敬请期待', emoji: '🏜' },
      { name: '未知之地', desc: '敬请期待', emoji: '🌋' },
      { name: '未知之地', desc: '敬请期待', emoji: '🏰' }
    ];

    /* ---- 根据方向计算卡片排布 ---- */
    const positions = this.computeCardPositions(vl);

    this.cards = [];
    for (let i = 0; i < TDStorage.total; i++) {
      const level = i + 1;
      const pos = positions[i];
      const info = levelInfo[i];
      const unlocked = TDStorage.isUnlocked(level);
      const completed = TDStorage.isCompleted(level);
      this.cards.push(this.makeCard(pos.x, pos.y, pos.w, pos.h, level, info, unlocked, completed));
    }

    /* ---- 底部提示（深绿文字在草地 6.2:1，配浅色晕圈增强小字号可读性） ---- */
    this.add.text(W / 2, vl.hintY, '仅第 1 关已开放，其余关卡即将到来', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(this.isPortrait() ? 12 : 13) + 'px', color: '#1e4620'
    }).setOrigin(0.5).setStroke('#e6f7d8', 3);
  }

  /**
   * 计算每张卡片的中心坐标与尺寸。
   * 横屏：1 行 5 张；竖屏：2 行（3 + 2），每行居中。
   * 卡片宽高基于 layoutScale 与可用空间，保证不重叠。
   */
  computeCardPositions(vl) {
    const W = this.W;
    const portrait = this.isPortrait();
    const out = [];
    const cardH = vl.cardH;

    if (portrait) {
      /* 宽度方向：3 张卡片铺满并居中 */
      const gap = this.ls(10);
      const cardW = Math.floor((W - gap * 2) / 3);
      const row = (count, yCenter) => {
        const totalW = count * cardW + (count - 1) * gap;
        const startX = (W - totalW) / 2 + cardW / 2;
        for (let i = 0; i < count; i++) {
          out.push({ x: startX + i * (cardW + gap), y: yCenter, w: cardW, h: cardH });
        }
      };
      row(3, vl.row1Y);
      row(2, vl.row2Y);
    } else {
      const cardW = this.ls(140), gap = this.ls(18);
      const totalW = 5 * cardW + 4 * gap;
      const startX = (W - totalW) / 2 + cardW / 2;
      for (let i = 0; i < 5; i++) {
        out.push({ x: startX + i * (cardW + gap), y: vl.row1Y, w: cardW, h: cardH });
      }
    }
    return out;
  }

  makeCard(x, y, w, h, level, info, unlocked, completed) {
    const g = this.add.graphics();
    const mainColor = unlocked ? 0xfff8e7 : 0xb8b0a0;
    const borderColor = unlocked ? (completed ? 0x3f9e34 : 0x2f6fc0) : 0x5d554d;
    const bandColor = unlocked ? borderColor : 0x5d554d;
    const bandH = this.ls(this.isPortrait() ? 36 : 38);

    g.fillStyle(0x000000, 0.18);
    g.fillRoundedRect(x - w / 2 + 3, y - h / 2 + 5, w, h, 16);
    g.fillStyle(mainColor, 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 16);
    g.lineStyle(4, borderColor, 1);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 16);

    /* 色带实色填充（不再用半透明），保证白字对比度达 WCAG AA 4.5:1 */
    g.fillStyle(bandColor, 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, bandH, { tl: 16, tr: 16, bl: 0, br: 0 });

    this.add.text(x, y - h / 2 + bandH / 2, '第 ' + level + ' 关', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(this.isPortrait() ? 14 : 15) + 'px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setStroke('#1d1610', 3);

    /* emoji 居中于色带下方区域，name/desc 依次下移，均按卡片高度比例定位 */
    const emojiY = y - h * 0.08;
    const nameY = y + h * 0.22;
    const descY = y + h * 0.38;

    this.add.text(x, emojiY, info.emoji, { fontSize: this.ls(this.isPortrait() ? 34 : 36) + 'px' }).setOrigin(0.5);

    /* 文字颜色均满足 AA：解锁卡深棕(11:1)，锁定卡深灰棕(5.7:1) */
    this.add.text(x, nameY, info.name, {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(this.isPortrait() ? 14 : 15) + 'px', fontStyle: 'bold',
      color: unlocked ? '#4a3313' : '#3d352e'
    }).setOrigin(0.5);
    this.add.text(x, descY, info.desc, {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(this.isPortrait() ? 11 : 12) + 'px', color: unlocked ? '#5f4720' : '#3d352e'
    }).setOrigin(0.5);

    if (completed) {
      const bx = x + w / 2 - this.ls(16), by = y - h / 2 + this.ls(16);
      const badge = this.add.graphics();
      const br = this.ls(12);
      badge.fillStyle(0x6be86b, 1).fillCircle(bx, by, br);
      badge.lineStyle(2, 0x2e7d1c, 1).strokeCircle(bx, by, br);
      this.add.text(bx, by, '✓', {
        fontFamily: TD_FONT_STACK, fontSize: this.ls(this.isPortrait() ? 13 : 14) + 'px', fontStyle: 'bold', color: '#1b5e10'
      }).setOrigin(0.5);
    }

    if (!unlocked) {
      this.add.text(x, emojiY, '🔒', { fontSize: this.ls(this.isPortrait() ? 34 : 36) + 'px' }).setOrigin(0.5).setAlpha(0.85);
    }

    const zone = this.add.zone(x, y, w + 8, h + 8).setInteractive({ useHandCursor: unlocked });
    zone.on('pointerdown', () => this.onSelectLevel(level, unlocked, x, y));

    return { level, unlocked, zone };
  }

  onSelectLevel(level, unlocked, x, y) {
    if (!unlocked) {
      this.showToast('此关卡暂未开放', x, y);
      return;
    }
    this.scene.start('GameScene', { levelId: level });
  }

  showToast(msg, x, y) {
    /* 深红字在草地上 5.2:1（AA），配白描边保证卡通风格与清晰度 */
    const t = this.add.text(x, y - this.ls(70), msg, {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(this.isPortrait() ? 15 : 18) + 'px', fontStyle: 'bold', color: '#7a2810'
    }).setOrigin(0.5).setStroke('#ffffff', 4).setAlpha(0).setDepth(100);

    this.tweens.chain({
      targets: t,
      tweens: [
        { alpha: 1, y: y - 90, duration: 180, ease: 'Back.out' },
        { alpha: 0, y: y - 110, duration: 500, delay: 900 }
      ],
      onComplete: () => t.destroy()
    });
  }
}
