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

    this.buildLayout();

    /* 选关界面不做任何摄像机翻转：canvas 与游戏内 DOM（HUD/商店/
       按钮）同在 #app 内共享同一套 CSS 视觉横屏旋转，方向基准必须
       统一。历史上曾仅移动端 setRotation(π)，导致选关画面相对
       GameScene 倒立 180°——曾出现点视觉第 1 关实际命中第 5 关、
       卡片顺序反向的问题。GameScene 从未翻转且方向正确，故选关
       保持 rotation=0。 */

    /* 强制横屏模式：方向变化时无需重建布局（始终横屏），
       仅刷新 Phaser 画布尺寸。监听器挂在游戏级 ScaleManager 上，
       场景关闭时手动移除，避免泄漏到 GameScene。 */
    this.handleResize = () => {
      if (!this.scene.isActive()) return;
    };
    this.scale.on('resize', this.handleResize);
    this.events.once('shutdown', () => this.scale.off('resize', this.handleResize));
  }

  /**
   * 强制横屏模式：布局缩放系数恒为 1。
   * 基准尺寸专为 960×540 设计，Phaser FIT 自动放大到屏幕，
   * 不在世界单位层面二次放大，避免元素过大。
   */
  calcLayoutScale() { return 1; }

  /** 按布局缩放系数放大尺寸（强制横屏下恒等于原值） */
  ls(basePx) { return basePx; }

  /**
   * 纵向布局：标题 / 副标题 / 卡片行 / 底部提示的 y 中心坐标。
   * 始终使用横屏布局（1 行 5 张卡片）。
   */
  computeVerticalLayout() {
    const topPad = 20, titleH = 36, subH = 15, cardH = 160;
    const hintH = 12, bottomPad = 20, gap = 10;

    const titleY = topPad + titleH / 2;
    const subY = titleY + titleH / 2 + gap + subH / 2;
    const headerBottom = subY + subH / 2;

    const hintY = this.H - bottomPad - hintH / 2;
    const hintTop = hintY - hintH / 2;

    const avail = hintTop - gap - headerBottom - gap;
    const usedCardH = Math.min(cardH, avail);

    const blockTop = headerBottom + gap;
    const row1Y = blockTop + usedCardH / 2;

    return { titleY, subY, hintY, cardH: usedCardH, row1Y, gap };
  }

  buildLayout() {
    const W = this.W, H = this.H;

    this.layoutScale = this.calcLayoutScale();
    const vl = this.computeVerticalLayout();

    /* ---- 背景 ---- */
    this.add.graphics().fillStyle(0x8ed861, 1).fillRect(0, 0, W, H);
    this.add.graphics().lineStyle(6, 0x6bb244, 1).strokeRect(3, 3, W - 6, H - 6);

    /* ---- 标题 ---- */
    this.add.text(W / 2, vl.titleY, '选择关卡', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(36) + 'px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setStroke('#24400f', 6).setShadow(0, 3, '#000000', 0.25);

    this.add.text(W / 2, vl.subY, '守护你的王国，逐关挑战！', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(15) + 'px', color: '#1e4620'
    }).setOrigin(0.5).setStroke('#e6f7d8', 3);

    /* ---- 关卡数据 ---- */
    const levelInfo = [
      { name: '新手教程', desc: '学习基础操作', emoji: '🎓' },
      { name: '蜿蜒小径', desc: '多拐弯·BOSS', emoji: '🐉' },
      { name: '双线汇流', desc: '双出怪·双BOSS', emoji: '🔀' },
      { name: '交错迷域', desc: '交叉汇合·岔路奇兵', emoji: '🌀' },
      { name: '迷域回廊', desc: '传送穿梭·三阶BOSS', emoji: '🔮' }
    ];

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

    /* ---- 底部提示 ---- */
    this.add.text(W / 2, vl.hintY, '通关第 1 关解锁塔D，通关第 2 关解锁塔E·电链弹跳', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(13) + 'px', color: '#1e4620'
    }).setOrigin(0.5).setStroke('#e6f7d8', 3);
  }

  /**
   * 计算每张卡片的中心坐标与尺寸。
   * 强制横屏：1 行 5 张，居中排列。
   */
  computeCardPositions(vl) {
    const W = this.W;
    const out = [];
    const cardH = vl.cardH;
    const cardW = 140, gap = 18;
    const totalW = 5 * cardW + 4 * gap;
    const startX = (W - totalW) / 2 + cardW / 2;
    for (let i = 0; i < 5; i++) {
      out.push({ x: startX + i * (cardW + gap), y: vl.row1Y, w: cardW, h: cardH });
    }
    return out;
  }

  makeCard(x, y, w, h, level, info, unlocked, completed) {
    /* 整张卡片收进一个 Container，便于做按下缩放反馈；
       容器内所有子元素使用相对卡片中心的局部坐标。 */
    const card = this.add.container(x, y);
    const g = this.add.graphics();
    const mainColor = unlocked ? 0xfff8e7 : 0xb8b0a0;
    const borderColor = unlocked ? (completed ? 0x3f9e34 : 0x2f6fc0) : 0x5d554d;
    const bandColor = unlocked ? borderColor : 0x5d554d;
    const bandH = 38;

    g.fillStyle(0x000000, 0.18);
    g.fillRoundedRect(-w / 2 + 3, -h / 2 + 5, w, h, 16);
    g.fillStyle(mainColor, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 16);
    g.lineStyle(4, borderColor, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, 16);

    g.fillStyle(bandColor, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, bandH, { tl: 16, tr: 16, bl: 0, br: 0 });

    const titleText = this.add.text(0, -h / 2 + bandH / 2, '第 ' + level + ' 关', {
      fontFamily: TD_FONT_STACK,
      fontSize: 15 + 'px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setStroke('#1d1610', 3);

    const emojiY = -h * 0.08;
    const nameY = h * 0.22;
    const descY = h * 0.38;

    const emojiText = this.add.text(0, emojiY, info.emoji, { fontSize: 36 + 'px' }).setOrigin(0.5);

    const nameText = this.add.text(0, nameY, info.name, {
      fontFamily: TD_FONT_STACK,
      fontSize: 15 + 'px', fontStyle: 'bold',
      color: unlocked ? '#4a3313' : '#3d352e'
    }).setOrigin(0.5);
    const descText = this.add.text(0, descY, info.desc, {
      fontFamily: TD_FONT_STACK,
      fontSize: 12 + 'px', color: unlocked ? '#5f4720' : '#3d352e'
    }).setOrigin(0.5);

    card.add([g, titleText, emojiText, nameText, descText]);

    if (completed) {
      const bx = w / 2 - 16, by = -h / 2 + 16;
      const badge = this.add.graphics();
      const br = 12;
      badge.fillStyle(0x6be86b, 1).fillCircle(bx, by, br);
      badge.lineStyle(2, 0x2e7d1c, 1).strokeCircle(bx, by, br);
      const check = this.add.text(bx, by, '✓', {
        fontFamily: TD_FONT_STACK, fontSize: 14 + 'px', fontStyle: 'bold', color: '#1b5e10'
      }).setOrigin(0.5);
      card.add([badge, check]);
    }

    if (!unlocked) {
      const lock = this.add.text(0, emojiY, '🔒', { fontSize: 36 + 'px' })
        .setOrigin(0.5).setAlpha(0.85);
      card.add(lock);
    }

    /* 触控热区略大于卡片（>=44px 规范由卡片尺寸保证）。
       手势状态机（按下/抬起/滑出）：
         pointerdown       → 卡片缩放 0.95 的按压反馈
         pointerup（仍在内）→ 恢复并触发选择（轻点）
         pointerout /      → 手指滑出热区：恢复反馈，不触发选择，
         pointerupoutside     从而把"滑动手势"与"点击"区分开。 */
    const zone = this.add.zone(0, 0, w + 8, h + 8).setInteractive({ useHandCursor: unlocked });
    let pressed = false;
    const pressScale = 0.95;
    const setPressed = (v) => {
      if (pressed === v) return;
      pressed = v;
      this.tweens.killTweensOf(card);
      this.tweens.add({
        targets: card,
        scaleX: v ? pressScale : 1,
        scaleY: v ? pressScale : 1,
        duration: 70,
        ease: 'Quad.out'
      });
    };
    zone.on('pointerdown', () => setPressed(true));
    zone.on('pointerup', () => {
      if (!pressed) return;
      setPressed(false);
      this.onSelectLevel(level, unlocked, x, y);
    });
    zone.on('pointerout', () => setPressed(false));
    zone.on('pointerupoutside', () => setPressed(false));
    card.add(zone);

    return { level, unlocked, zone, container: card };
  }

  onSelectLevel(level, unlocked, x, y) {
    /* 超出设计范围的关卡：提示敬请期待，不进入游戏 */
    if (!TDStorage.isDesigned(level)) {
      this.showToast('敬请期待', x, y);
      return;
    }
    if (!unlocked) {
      this.showToast('此关卡暂未开放', x, y);
      return;
    }
    this.scene.start('GameScene', { levelId: level });
  }

  showToast(msg, x, y) {
    const t = this.add.text(x, y - 70, msg, {
      fontFamily: TD_FONT_STACK,
      fontSize: 20 + 'px', fontStyle: 'bold', color: '#7a2810'
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
