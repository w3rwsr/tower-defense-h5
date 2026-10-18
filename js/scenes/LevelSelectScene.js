/* ============================================================
 * LevelSelectScene.js —— 关卡选择界面
 * 关卡卡片按网格排列：每排最多 6 张（5~6 张，见 get maxPerRow），
 * 超出后自动换行，后续新增关卡无需改排版代码：
 *   - 第 1~6 关：第一排（居中 6 列网格）
 *   - 第 7 关及以后：第二排起，从每排第 1 个位置依次排列
 * 已通关的关卡显示 ✓ 标记（进度来自 TDStorage）。
 *
 * 左下角「📖 图鉴」按钮 → 打开防御塔图鉴（半透明悬浮窗，可滚动、
 * 可关闭）：逐塔列出名称/外观小图标、元素属性、功能说明，以及
 * Lv1~Lv4 的具体数值差异，并以金色高亮标注 Lv4 进化特性（机制质变）。
 * 数值全部实时读取 TD_CONFIG.towers，
 * 口径与 Tower.recalcStats 完全一致，因此与游戏内实际战斗数据相同。
 * 图鉴仅用于查看，不参与任何战斗逻辑。
 *
 * 强制横屏：布局基准 960×540，Phaser FIT 自动放大；方向变化时
 * 只需刷新画布尺寸（监听挂在游戏级 ScaleManager，场景关闭时移除）。
 * ============================================================ */
class LevelSelectScene extends Phaser.Scene {
  constructor() { super('LevelSelectScene'); }

  create() {
    /* DPR 适配：gameSize=960dpr×540dpr，相机 zoom=dpr 后布局世界
       仍为 960x540（详见 main.js TD_DPR）；场景重启会重跑 create，
       故 zoom 在每次进入选关页时都会重新生效。
       zoom 以视野中心为锚点，必须再 centerOn(世界中心) 把左上角
       对回 (0,0)，否则整张 960x540 布局会偏到画面左上外侧；
       dpr=1 时 centerOn 得到 scroll=0，与旧行为完全一致 */
    const dpr0 = window.__TD_DPR || 1;
    this.cameras.main.setZoom(dpr0);
    this.cameras.main.centerOn(TD_CONFIG.world.width / 2, TD_CONFIG.world.height / 2);

    this.W = TD_CONFIG.world.width;
    this.H = TD_CONFIG.world.height;

    /* 选关界面隐藏游戏 HUD，保持画面干净 */
    document.getElementById('hud-top').style.display = 'none';
    document.getElementById('hud-bottom').style.display = 'none';
    window.__tdScene = this;

    /* 图鉴状态重置：场景实例会被复用（返回选关不会 new 新实例），
       每次 create 清空上一局的引用，避免悬浮窗残留 / 重复打开 */
    this.codexPanel = null;
    this.codexBtn = null;
    this._codexWheel = null;
    this._codexMask = null;

    this.buildLayout();

    /* 移动端：HUD 锚定（选关页 HUD 隐藏，但保持位置正确，返回游戏即生效） */
    if (window.__tdLayoutMobileHud) window.__tdLayoutMobileHud();

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
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.handleResize);
      /* 图鉴全局滚轮监听与残留引用一并清理（场景关闭时 InputPlugin
         本身会销毁监听，这里只清引用，双保险） */
      if (this._codexWheel) { this.input.off('wheel', this._codexWheel); this._codexWheel = null; }
      this.codexPanel = null;
      this._codexMask = null;
    });

    this._deferredVideoInit();
  }

  /* 选关页后台“按需”预载：只预载【马上就可能用到】的视频，其余进关再加载。
     - 史莱姆视频（~2.2MB）：第 1 关就有史莱姆小怪，选关页空闲时预载；
     - 风塔视频（~2.3MB）：仅当风元素塔（通关第 3 关解锁）在本存档可用时预载；
     - BOSS 运动视频（~4.1MB）/ BOSS 死亡视频（3 个共 ~7.8MB）：
       【不在选关页加载】，改为进入含 BOSS 的关卡后按本关实际出场的变体懒加载
       （见 GameScene.create），避免“进选关就下 16MB”把弱网彻底堵死。
     所有视频统一走 TDMedia 串行队列（一次只下 1 个），下载期间/不支持/失败时
     Tower/Enemy 保持既有静态贴图降级，就绪后经各模块 whenReady 回调自动接管。
     重复进入本场景安全：各 init 内部均有 _inited 防重入。 */
  _deferredVideoInit() {
    const jobs = [];
    jobs.push(() => { try { SLIME_VIDEO.init(this); } catch (e) { /* 静态兜底 */ } });
    /* 风塔是否可用：按该塔自身的解锁关卡判定（通关第 3 关才永久解锁）。
       不能用 isTowerUnlocked('towerF', 总关卡数)——第 7 关配置了
       allTowersAvailable，会把它误判为"已解锁"，导致新档进选关就白下 2.3MB。 */
    let windUsable = false;
    try {
      const need = TDStorage.towerUnlockLevel('towerF') || 1;
      windUsable = TDStorage.isTowerUnlocked('towerF', need);
    } catch (e) { /* 忽略 */ }
    if (windUsable) {
      jobs.push(() => { try { WIND_VIDEO.init(this); } catch (e) { /* 静态兜底 */ } });
    }
    jobs.forEach((fn, i) => setTimeout(fn, 900 + i * 1200));
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
   * 每排最多显示的关卡卡片数（5~6 张）。超过此数自动换行；
   * 当前 7 关 = 第一排 6 张 + 第二排 1 张（第 7 关在第二排第 1 个位置）。
   */
  get maxPerRow() { return 6; }

  /**
   * 纵向布局：标题 / 副标题 / 卡片行 / 底部提示的 y 中心坐标。
   * 卡片行数按「关卡总数 ÷ 每排上限」自动取整换行，行高按可用
   * 高度自适应收缩，保证所有行 + 底部提示都落在 540 之内。
   */
  computeVerticalLayout() {
    const topPad = 20, titleH = 36, subH = 15, cardH = 160;
    const hintH = 12, bottomPad = 20, gap = 10;
    const rowGap = 12;

    const rows = Math.max(1, Math.ceil(TDStorage.total / this.maxPerRow));

    const titleY = topPad + titleH / 2;
    const subY = titleY + titleH / 2 + gap + subH / 2;
    const headerBottom = subY + subH / 2;

    const hintY = this.H - bottomPad - hintH / 2;
    const hintTop = hintY - hintH / 2;

    /* 可用高度按行数均分（含行间距），单卡最高 160 */
    const avail = hintTop - gap - headerBottom - gap;
    const usedCardH = Math.min(cardH, Math.floor((avail - rowGap * (rows - 1)) / rows));

    const blockTop = headerBottom + gap;
    const rowYs = [];
    for (let r = 0; r < rows; r++) {
      rowYs.push(blockTop + usedCardH / 2 + r * (usedCardH + rowGap));
    }

    return { titleY, subY, hintY, cardH: usedCardH, rowYs, rowGap, gap };
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
      fontSize: this.ls(36) + 'px', fontStyle: 'bold', color: '#ffffff',
      resolution: TD_TEXT_RES
    }).setOrigin(0.5).setStroke('#24400f', 6).setShadow(0, 3, '#000000', 0.25);

    this.add.text(W / 2, vl.subY, '守护你的王国，逐关挑战！', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(15) + 'px', color: '#1e4620',
      resolution: TD_TEXT_RES
    }).setOrigin(0.5).setStroke('#e6f7d8', 3);

    /* ---- 关卡数据 ---- */
    const levelInfo = [
      { name: '新手教程', desc: '学习基础操作', emoji: '🎓' },
      { name: '蜿蜒小径', desc: '多拐弯·BOSS', emoji: '🐉' },
      { name: '双线汇流', desc: '双出怪·双BOSS', emoji: '🔀' },
      { name: '交错迷域', desc: '交叉汇合·岔路奇兵', emoji: '🌀' },
      { name: '迷域回廊', desc: '传送穿梭·三阶BOSS', emoji: '🔮' },
      { name: '三路会师', desc: '三线交叉·共享终点', emoji: '⚔️' },
      { name: '双途重围', desc: '双线汇合·护盾BOSS', emoji: '🛡️' },
      { name: '风蚀荒原', desc: '双路S廊·风眼增伤·熔岩巨兽', emoji: '🌋' }
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
    this.add.text(W / 2, vl.hintY, '通关第 1 关解锁塔D，通关第 2 关解锁塔E·电链弹跳，通关第 3 关解锁风元素塔', {
      fontFamily: TD_FONT_STACK,
      fontSize: this.ls(13) + 'px', color: '#1e4620',
      resolution: TD_TEXT_RES
    }).setOrigin(0.5).setStroke('#e6f7d8', 3);

    /* ---- 左下角「图鉴」按钮（纯 UI，不参与战斗） ---- */
    this.buildCodexButton();
  }

  /**
   * 计算每张卡片的中心坐标与尺寸。
   * 网格排列：每排最多 maxPerRow(6) 张，超出自动换行。
   *   - 网格按 6 列固定列宽/列距居中排布（6×132 + 5×16 = 872 ≤ 960，
   *     两侧各留 44px，绝不超出屏幕）；
   *   - 不足一排的行（如第 7 关独占第二排）从第 1 个位置起排，
   *     与上一排同列对齐（第 7 关 = 第二排第 1 个）。
   */
  computeCardPositions(vl) {
    const W = this.W;
    const out = [];
    const cardH = vl.cardH;
    const count = TDStorage.total;              // 关卡总数（当前 8）
    const perRow = this.maxPerRow;              // 每排上限（5~6 张）
    const cardW = 132;
    const gap = 16;
    const totalW = perRow * cardW + (perRow - 1) * gap;
    const startX = (W - totalW) / 2 + cardW / 2;
    for (let i = 0; i < count; i++) {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      out.push({
        x: startX + col * (cardW + gap),
        y: vl.rowYs[Math.min(row, vl.rowYs.length - 1)],
        w: cardW,
        h: cardH
      });
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
      fontSize: 15 + 'px', fontStyle: 'bold', color: '#ffffff',
      resolution: TD_TEXT_RES
    }).setOrigin(0.5).setStroke('#1d1610', 3);

    const emojiY = -h * 0.08;
    const nameY = h * 0.22;
    const descY = h * 0.38;

    const emojiText = this.add.text(0, emojiY, info.emoji, {
      fontSize: 36 + 'px', resolution: TD_TEXT_RES
    }).setOrigin(0.5);

    const nameText = this.add.text(0, nameY, info.name, {
      fontFamily: TD_FONT_STACK,
      fontSize: 15 + 'px', fontStyle: 'bold',
      color: unlocked ? '#4a3313' : '#3d352e',
      resolution: TD_TEXT_RES
    }).setOrigin(0.5);
    const descText = this.add.text(0, descY, info.desc, {
      fontFamily: TD_FONT_STACK,
      fontSize: 12 + 'px', color: unlocked ? '#5f4720' : '#3d352e',
      resolution: TD_TEXT_RES
    }).setOrigin(0.5);

    card.add([g, titleText, emojiText, nameText, descText]);

    if (completed) {
      const bx = w / 2 - 16, by = -h / 2 + 16;
      const badge = this.add.graphics();
      const br = 12;
      badge.fillStyle(0x6be86b, 1).fillCircle(bx, by, br);
      badge.lineStyle(2, 0x2e7d1c, 1).strokeCircle(bx, by, br);
      const check = this.add.text(bx, by, '✓', {
        fontFamily: TD_FONT_STACK, fontSize: 14 + 'px', fontStyle: 'bold', color: '#1b5e10',
        resolution: TD_TEXT_RES
      }).setOrigin(0.5);
      card.add([badge, check]);
    }

    /* 锁定图标与拦截逻辑已彻底移除：第 1~8 关全部直接开放，自由进入 */

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
    /* 第 1~8 关全部直接开放：不再有任何解锁拦截 */
    this.scene.start('GameScene', { levelId: level });
  }

  showToast(msg, x, y) {
    const t = this.add.text(Math.round(x), Math.round(y - 70), msg, {
      fontFamily: TD_FONT_STACK,
      fontSize: 20 + 'px', fontStyle: 'bold', color: '#7a2810',
      resolution: TD_TEXT_RES
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

  /* ============================================================
   * 防御塔图鉴（纯查看 UI，不参与任何战斗逻辑）
   *   · 左下角「📖 图鉴」按钮 → openCodex() 弹出半透明悬浮窗
   *   · 窗口内容上下拖动 / 滚轮滚动，右上 ✕ 或点窗口外关闭
   *   · 每种塔列出：名称 / 元素色小图标 / 元素属性 / 功能说明 /
   *     Lv1~Lv4 的具体数值差异 + Lv4 进化特性（机制质变说明）
   *   · 全部数值实时读取 TD_CONFIG.towers，计算口径与
   *     Tower.recalcStats 完全一致 → 与战斗内实际数值相同
   * ============================================================ */

  /** 左下角「图鉴」按钮（圆润卡通、明亮，与游戏 UI 同风格） */
  buildCodexButton() {
    const bw = 112, bh = 44;
    const bx = 14 + bw / 2;                    // 左侧留 14px
    const by = this.H - 16 - bh / 2;           // 底部留 16px（在第二排卡片下方，不遮挡）
    const btn = this.add.container(bx, by).setDepth(60);

    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.16);
    g.fillRoundedRect(-bw / 2 + 2, -bh / 2 + 3, bw, bh, 16);      // 底部投影
    g.fillStyle(0xffe9a8, 1);
    g.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 16);
    g.lineStyle(3.5, 0xffb43c, 1);
    g.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 16);

    const label = this.add.text(0, 0, '📖 图鉴', {
      fontFamily: TD_FONT_STACK, fontSize: '19px', fontStyle: 'bold',
      color: '#7a4a06', resolution: TD_TEXT_RES
    }).setOrigin(0.5).setStroke('#fff6d8', 3);

    /* 手势状态机与关卡卡片一致：按下缩放，滑出热区不触发 */
    const zone = this.add.zone(0, 0, bw + 6, bh + 6).setInteractive({ useHandCursor: true });
    let pressed = false;
    const setPressed = (v) => {
      if (pressed === v) return;
      pressed = v;
      this.tweens.killTweensOf(btn);
      this.tweens.add({
        targets: btn, scaleX: v ? 0.94 : 1, scaleY: v ? 0.94 : 1,
        duration: 70, ease: 'Quad.out'
      });
    };
    zone.on('pointerdown', () => setPressed(true));
    zone.on('pointerup', () => { if (!pressed) return; setPressed(false); this.openCodex(); });
    zone.on('pointerout', () => setPressed(false));
    zone.on('pointerupoutside', () => setPressed(false));

    btn.add([g, label, zone]);
    this.codexBtn = btn;
  }

  /** 打开图鉴悬浮窗（半透明背景 + 圆角面板 + 可滚动内容 + 关闭按钮） */
  openCodex() {
    if (this.codexPanel) return;               // 已打开：不重复构建

    const cx = this.W / 2, cy = this.H / 2;
    const PW = 780, PH = 460;                  // 面板尺寸（世界单位，960×540 内留足边距）
    const barH = 48;                           // 标题条高度
    const layer = this.add.container(0, 0).setDepth(660);

    /* ---- 半透明压暗背景：覆盖全屏，屏蔽下方关卡卡片点击；点它关闭 ---- */
    const backdrop = this.add.rectangle(0, 0, this.W, this.H, 0x14290f, 0.58)
      .setOrigin(0, 0).setInteractive({ useHandCursor: true });
    backdrop.on('pointerdown', () => this.closeCodex());
    layer.add(backdrop);

    /* ---- 圆角面板（容器，局部坐标以面板中心为原点；与游戏内公主窗口
       同一套嵌套结构：后加入的可交互子元素优先命中，保证 ✕ 与拖动热区
       不会被面板吞点击层盖住） ---- */
    const panel = this.add.container(cx, cy);
    const pz = this.add.zone(0, 0, PW, PH).setInteractive();   // 面板吞点击，不透到背景
    panel.add(pz);

    const pg = this.add.graphics();
    pg.fillStyle(0xfffcf2, 0.97);
    pg.fillRoundedRect(-PW / 2, -PH / 2, PW, PH, 22);
    pg.lineStyle(3, 0x4a3313, 0.9);
    pg.strokeRoundedRect(-PW / 2, -PH / 2, PW, PH, 22);
    pg.fillStyle(0x59b83e, 0.98);                              // 顶部草绿标题条
    pg.fillRoundedRect(-PW / 2, -PH / 2, PW, barH, { tl: 22, tr: 22, bl: 0, br: 0 });
    pg.fillRect(-PW / 2, -PH / 2 + barH / 2, PW, barH / 2);
    panel.add(pg);

    const title = this.add.text(-PW / 2 + 22, -PH / 2 + barH / 2, '📖 防御塔图鉴', {
      fontFamily: TD_FONT_STACK, fontSize: '21px', fontStyle: 'bold',
      color: '#ffffff', resolution: TD_TEXT_RES
    }).setOrigin(0, 0.5).setStroke('#25581a', 4);
    panel.add(title);

    /* 关闭按钮（右上红圆 ✕，热区放大；最后加入，命中优先级最高） */
    const cbg = this.add.graphics();
    cbg.fillStyle(0xff7d8d, 1); cbg.fillCircle(PW / 2 - 22, -PH / 2 + barH / 2, 15);
    cbg.lineStyle(2.5, 0xc04055, 0.9);
    cbg.strokeCircle(PW / 2 - 22, -PH / 2 + barH / 2, 15);
    const ctxt = this.add.text(PW / 2 - 22, -PH / 2 + barH / 2, '✕', {
      fontFamily: TD_FONT_STACK, fontSize: '17px', fontStyle: 'bold',
      color: '#ffffff', resolution: TD_TEXT_RES
    }).setOrigin(0.5);
    const czone = this.add.zone(PW / 2 - 22, -PH / 2 + barH / 2, 44, 44)
      .setInteractive({ useHandCursor: true });
    czone.on('pointerdown', () => this.closeCodex());
    panel.add([cbg, ctxt]);

    /* ---- 滚动内容区：局部坐标（面板内）+ 世界坐标（几何蒙板用） ---- */
    const vv = { x: -PW / 2 + 14, y: -PH / 2 + barH + 10, w: PW - 28, h: PH - barH - 34 };
    const worldView = { x: cx + vv.x, y: cy + vv.y, w: vv.w, h: vv.h };

    const scrollBox = this.add.container(vv.x, vv.y);
    const maskG = this.make.graphics({ x: 0, y: 0, add: false });
    maskG.fillStyle(0xffffff, 1);
    maskG.fillRect(worldView.x, worldView.y, worldView.w, worldView.h);
    scrollBox.setMask(maskG.createGeometryMask());
    this._codexMask = maskG;

    const entryW = vv.w - 12;                   // 右侧留 12px 给滚动条
    const contentH = this.buildCodexEntries(scrollBox, entryW);
    panel.add(scrollBox);

    /* ---- 滚动条（内容超出一屏时显示） ---- */
    const barW = 6;
    const trackX = vv.x + vv.w - 2;
    const track = this.add.graphics();
    track.fillStyle(0x000000, 0.12);
    track.fillRoundedRect(trackX - barW / 2, vv.y + 2, barW, vv.h - 4, barW / 2);
    const thumb = this.add.graphics();
    panel.add(track);
    panel.add(thumb);

    const scrollState = { y: 0 };
    const maxScroll = Math.max(0, contentH - vv.h);
    const applyScroll = (v) => {
      const sv = Phaser.Math.Clamp(v, 0, maxScroll);
      scrollState.y = sv;
      scrollBox.y = vv.y - sv;
      thumb.clear();
      if (maxScroll <= 0) return;               // 不需要滚动：不画滑块
      const trackH = vv.h - 4;
      const thumbH = Math.max(30, trackH * (vv.h / contentH));
      const ty = vv.y + 2 + (trackH - thumbH) * (sv / maxScroll);
      thumb.fillStyle(0x6bb244, 0.95);
      thumb.fillRoundedRect(trackX - barW / 2, ty, barW, thumbH, barW / 2);
    };
    applyScroll(0);

    /* ---- 拖动滚动热区（覆盖内容区；在 pz 之后加入 → 命中优先于吞点击层） ---- */
    const dragZone = this.add.zone(vv.x + vv.w / 2, vv.y + vv.h / 2, vv.w, vv.h)
      .setInteractive({ useHandCursor: true });
    panel.add(dragZone);
    this.input.setDraggable(dragZone);
    let dragStartY = 0, dragScroll0 = 0;
    dragZone.on('pointerdown', (p) => { dragStartY = p.y; dragScroll0 = scrollState.y; });
    dragZone.on('drag', (p) => { applyScroll(dragScroll0 - (p.y - dragStartY)); });

    /* ---- 滚轮滚动（电脑端）：场景级监听，关闭时移除 ----
       方向修正：delta 取反 —— 顺时针（向下滚，dy>0）内容向下移动
       （视口回看顶部的卡）；逆时针（向上滚）内容向上（看后面的卡）。
       乘 0.5 为缓动手感 */
    const wheelHandler = (pointer, objs, dx, dy) => {
      if (!this.codexPanel) return;
      applyScroll(scrollState.y + dy * 0.5);
    };
    this.input.on('wheel', wheelHandler);
    this._codexWheel = wheelHandler;

    /* ---- 底部提示 ---- */
    const hint = this.add.text(0, PH / 2 - 16,
      maxScroll > 0 ? '上下拖动或滚动滚轮查看更多 · 点窗口外或右上 ✕ 关闭' : '点窗口外或右上 ✕ 关闭', {
        fontFamily: TD_FONT_STACK, fontSize: '12px', color: '#8a7554',
        resolution: TD_TEXT_RES
      }).setOrigin(0.5);
    panel.add(hint);

    panel.add(czone);                           // ✕ 热区最后加入（优先级最高）

    layer.add(panel);

    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 160, ease: 'Sine.easeOut' });
    this.codexPanel = layer;
  }

  /** 关闭图鉴悬浮窗（移除滚轮监听 + 清理蒙板） */
  closeCodex() {
    if (!this.codexPanel) return;
    if (this._codexWheel) {
      this.input.off('wheel', this._codexWheel);
      this._codexWheel = null;
    }
    const layer = this.codexPanel;
    const maskG = this._codexMask;
    this.codexPanel = null;
    this._codexMask = null;
    this.tweens.add({
      targets: layer, alpha: 0, duration: 130, ease: 'Sine.easeIn',
      onComplete: () => {
        try { layer.destroy(); } catch (e) { /* 忽略 */ }
        if (maskG) { try { maskG.destroy(); } catch (e) { /* 忽略 */ } }
      }
    });
  }

  /**
   * 构建图鉴条目列表（全部塔，按 TD_CONFIG.towers 配置顺序）。
   * @returns 内容总高度（像素），供滚动范围计算
   */
  buildCodexEntries(box, entryW) {
    const picker = (TD_CONFIG.build && TD_CONFIG.build.picker) || {};
    const colors = picker.iconColors || {};
    const glyphs = picker.iconGlyph || {};
    /* 卡高按 Lv1~Lv4 四行数值行 + 一行 Lv4 特性说明加高（186→220），
       间距 12，保证 Lv4 特性行（含自动换行余量）完整落在卡片内、
       不与下一张卡重叠 */
    const entryH = 220, gap = 12;
    const keys = Object.keys(TD_CONFIG.towers).filter((k) => TD_CONFIG.towers[k]);
    let y = 0;

    keys.forEach((key) => {
      const cfg = TD_CONFIG.towers[key];
      const meta = this.codexMeta(key, cfg);
      const color = colors[key] != null ? colors[key] : (cfg.color || 0xffffff);
      const glyph = glyphs[key] || meta.element.charAt(0);

      const row = this.add.container(0, y);

      /* 卡片底：奶油底 + 元素色描边，与选关卡片同风格 */
      const g = this.add.graphics();
      g.fillStyle(0xfffdf4, 1);
      g.fillRoundedRect(0, 0, entryW, entryH, 14);
      g.lineStyle(2.5, color, 0.85);
      g.strokeRoundedRect(0, 0, entryW, entryH, 14);
      row.add(g);

      /* 外观小图标：元素色圆 + 白描边 + 中心单字（与战斗内选塔框图标一致） */
      const icx = 36, icy = entryH / 2;
      const ic = this.add.graphics();
      ic.fillStyle(color, 1); ic.fillCircle(icx, icy, 21);
      ic.lineStyle(3, 0xffffff, 0.92); ic.strokeCircle(icx, icy, 21);
      const ict = this.add.text(icx, icy + 1, glyph, {
        fontFamily: TD_FONT_STACK, fontSize: '19px', fontStyle: 'bold',
        color: '#ffffff', resolution: TD_TEXT_RES
      }).setOrigin(0.5);
      row.add([ic, ict]);

      /* 名称 + 元素属性标签（元素色胶囊，文字按底色亮度取黑/白保证可读）+ 造价 */
      const name = this.add.text(70, 16, cfg.name, {
        fontFamily: TD_FONT_STACK, fontSize: '17px', fontStyle: 'bold',
        color: '#3d2b12', resolution: TD_TEXT_RES
      }).setOrigin(0, 0.5);

      const lum = (0.299 * ((color >> 16) & 0xff) + 0.587 * ((color >> 8) & 0xff) +
        0.114 * (color & 0xff)) / 255;
      const tag = this.add.text(0, 16, meta.element, {
        fontFamily: TD_FONT_STACK, fontSize: '13px', fontStyle: 'bold',
        color: lum > 0.72 ? '#3d2b12' : '#ffffff', resolution: TD_TEXT_RES
      }).setOrigin(0.5);
      const tagW = Math.ceil(tag.width) + 20;
      const tagX = 70 + name.width + 12;
      tag.setPosition(tagX + tagW / 2, 16);
      const tagBg = this.add.graphics();
      tagBg.fillStyle(color, 0.95);
      tagBg.fillRoundedRect(tagX, 6, tagW, 20, 10);

      const cost = this.add.text(entryW - 16, 16, '🪙 ' + cfg.cost, {
        fontFamily: TD_FONT_STACK, fontSize: '14px', fontStyle: 'bold',
        color: '#a06b12', resolution: TD_TEXT_RES
      }).setOrigin(1, 0.5);
      row.add([tagBg, name, tag, cost]);

      /* 功能 / 定位说明 */
      const role = this.add.text(70, 40, cfg.desc, {
        fontFamily: TD_FONT_STACK, fontSize: '13px', fontStyle: 'bold',
        color: '#5f4720', resolution: TD_TEXT_RES
      }).setOrigin(0, 0.5);
      const note = this.add.text(70, 60, meta.note, {
        fontFamily: TD_FONT_STACK, fontSize: '12px', color: '#8a7a5e',
        resolution: TD_TEXT_RES
      }).setOrigin(0, 0.5);
      row.add([role, note]);

      /* Lv1~Lv4 具体数值（与战斗内实际数值同口径）；行距 26、起始 84，
         末行（i=3）底边 ≈170，完整收在卡片内 */
      const lines = this.codexLines(key, cfg);
      lines.forEach((t, i) => {
        const lt = this.add.text(70, 84 + i * 26, t, {
          fontFamily: TD_FONT_STACK, fontSize: '13px', color: '#2f4a1c',
          resolution: TD_TEXT_RES
        }).setOrigin(0, 0.5);
        row.add(lt);
      });

      /* Lv4 特性：进化后的机制质变说明（纯展示文案，不改战斗数值）。
         金色加粗 + 奶白描边高亮，与 Lv1~Lv4 基础数值行区分；
         wordWrap 限制在卡片宽度内，极端长度自动换行、不溢出 */
      const feature = this.codexLv4Feature(key);
      if (feature) {
        const ft = this.add.text(70, 84 + lines.length * 26 + 4, 'Lv4 特性：' + feature, {
          fontFamily: TD_FONT_STACK, fontSize: '13px', fontStyle: 'bold',
          color: '#b8860b', resolution: TD_TEXT_RES,
          wordWrap: { width: entryW - 86 }
        }).setOrigin(0, 0.5).setStroke('#fff3cf', 3);
        row.add(ft);
      }

      box.add(row);
      y += entryH + gap;
    });

    return Math.max(0, y - gap);
  }

  /**
   * 计算某塔某等级的最终属性——与 Tower.recalcStats 完全同口径
   * （成长项支持「数组=逐级显式值」与「数值=逐级相乘系数」两种写法）。
   */
  towerStatsAt(cfg, level) {
    const base = cfg.stats || {};
    const up = cfg.upgrade || {};
    const isArr = Array.isArray;
    let dmgMul = 1, rangeMul = 1, cdMul = 1, jumpsAdd = 0;
    for (let i = 1; i < level; i++) {
      if (!isArr(up.damage) && up.damage != null) dmgMul *= up.damage;
      if (!isArr(up.range) && up.range != null) rangeMul *= up.range;
      if (!isArr(up.cooldown) && up.cooldown != null) cdMul *= up.cooldown;
      if (up.jumps) jumpsAdd += up.jumps;
    }
    const baseJumps = (cfg.effect && cfg.effect.jumps != null) ? cfg.effect.jumps : 0;
    /* 4 级进化：数组成长项只写到 3 级（如火塔 [80,130,200]），Lv4 沿用末级
       显式数值（与 Tower.recalcStats 口径一致）；Lv4 专属覆盖读 TowerConfig
       （cfg.lv4，由 TowerConfigData.js 注入）：雷塔弹跳 10 次、引力塔 BOSS 减速、
       火/水塔伤害与攻速（lv4.stats，与 Tower.recalcStats 同口径）。 */
    const ai = (a) => Math.min(level, a.length) - 1;
    const lv4 = (level >= 4 && cfg.lv4) || null;
    let jumps = baseJumps + jumpsAdd;
    if (lv4 && lv4.chain && lv4.chain.jumps != null) jumps = lv4.chain.jumps;
    const lv4s = lv4 && lv4.stats;
    return {
      damage: Math.round(lv4s && lv4s.damage != null ? lv4s.damage
        : (isArr(up.damage) ? up.damage[ai(up.damage)] : base.damage * dmgMul)),
      range: Math.round(isArr(up.range) ? up.range[ai(up.range)] : base.range * rangeMul),
      cooldown: +(lv4s && lv4s.cooldown != null ? lv4s.cooldown
        : (isArr(up.cooldown) ? up.cooldown[ai(up.cooldown)] : base.cooldown * cdMul)).toFixed(3),
      jumps
    };
  }

  /** 元素属性 + 功能补充说明（全部读配置，不写死数值） */
  codexMeta(key, cfg) {
    const pe = (cfg.projectile && cfg.projectile.effect) || {};
    const eff = cfg.effect || {};
    const type = pe.type || eff.type || '';
    const elems = TD_CONFIG.elements || {};
    const elKey = (cfg.projectile && cfg.projectile.element) || eff.element || null;
    const elName = elKey && elems[elKey] ? elems[elKey].name : '';

    if (type === 'pull') {
      return {
        element: '引力 / 牵引',
        note: '无伤害·范围索敌：仅牵引小怪（BOSS 免疫），每 ' + (eff.attractInterval / 1000) +
          ' 秒脉冲一次，被牵引期间推进减速'
      };
    }
    if (type === 'windSpread') {
      return {
        element: '风元素',
        note: '命中带元素小怪时，向 ' + eff.spreadRadius + 'px 内最多 ' + eff.spreadMaxTargets +
          ' 只无元素小怪扩散该元素（冷却 ' + eff.spreadCooldown + ' 秒）'
      };
    }
    if (type === 'chain') {
      return {
        element: (elems.thunder ? elems.thunder.name : '雷') + '元素',
        note: '电链在小怪间弹跳，每次弹跳伤害 ×' + eff.jumpDecay +
          '（递减 10%），搜索半径 ' + eff.chainRange + 'px'
      };
    }
    if (type === 'splashSlow') {
      return {
        element: (elName || '冰') + '元素',
        note: '命中溅射半径 ' + pe.splashRadius + 'px，范围内小怪减速持续 ' + pe.slowDuration + ' 秒'
      };
    }
    return {
      element: elName ? elName + '元素' : '无元素',
      note: elName
        ? '命中附加 ' + elName + '元素印记（纯视觉标记，供风元素塔扩散）'
        : '单体伤害'
    };
  }

  /** 生成 Lv1~maxLevel 的数值说明行（冰塔含 BOSS 专项减速等，全部读配置） */
  codexLines(key, cfg) {
    const pe = (cfg.projectile && cfg.projectile.effect) || {};
    const eff = cfg.effect || {};
    const type = pe.type || eff.type || '';
    const maxLv = (cfg.upgrade && cfg.upgrade.maxLevel) || 3;
    const out = [];
    for (let lv = 1; lv <= maxLv; lv++) {
      const st = this.towerStatsAt(cfg, lv);
      const rate = st.cooldown > 0 ? (1 / st.cooldown).toFixed(2) + ' 次/秒' : '—';
      let txt;
      if (type === 'pull') {
        /* 4 级黑洞引力（TowerConfig lv4.bossSlow）：Lv4 行显示 15% 减速 */
        const bossSlow = (lv >= 4 && cfg.lv4 && cfg.lv4.bossSlow != null)
          ? cfg.lv4.bossSlow : (eff.bossSlow || 0);
        txt = '牵引范围 ' + st.range + ' · 无伤害 · 对 BOSS 减速 ' +
          Math.round(bossSlow * 100) + '%';
      } else if (type === 'chain') {
        txt = '伤害 ' + st.damage + ' · 弹跳 ' + st.jumps + ' 次 · 攻速 ' + rate + ' · 射程 ' + st.range;
      } else if (type === 'windSpread') {
        txt = '伤害 ' + st.damage + ' · 扩散半径 ' + eff.spreadRadius + ' · 冷却 ' +
          eff.spreadCooldown + ' 秒 · 射程 ' + st.range;
      } else if (type === 'splashSlow') {
        const tbl = pe.slowFactorByLevel || {};
        const sf = tbl[String(lv)] != null ? tbl[String(lv)] : pe.slowFactor;
        txt = '减速 ' + Math.round((1 - sf) * 100) + '% · 伤害 ' + st.damage +
          ' · 攻速 ' + rate + ' · 射程 ' + st.range;
        if (pe.bossSlow && lv >= (pe.bossSlow.minLevel || 1)) {
          txt += ' · 对 BOSS 减速 ' + Math.round((1 - pe.bossSlow.factor) * 100) + '%';
        }
      } else {
        txt = '伤害 ' + st.damage + ' · 攻速 ' + rate + ' · 射程 ' + st.range;
      }
      out.push('Lv' + lv + '：' + txt);
    }
    return out;
  }

  /**
   * Lv4 进化特性说明（机制质变文案，纯图鉴展示，不参与战斗逻辑）。
   * 文案数值口径与 TowerConfig.json 的 lv4 段一致；
   * 返回 null 表示该塔无 Lv4 特性（不渲染该行）。
   */
  codexLv4Feature(key) {
    const map = {
      towerA: '攻击产生 50% 溅射，附加【灼烧】：每秒扣 1% 最大生命值（持续 5 秒）',
      towerB: '攻击叠加【寒冷值】，满 5 层触发【寒冷】：降 20% 防御，每秒扣 2% 最大生命值',
      towerC: '攻击附加【潮湿】（最多 5 层），每层使非水元素塔对其伤害 +4%',
      towerD: '牵引结束造成 1 秒眩晕（对 BOSS 无效，5秒CD），对 BOSS 减速提升至 15%',
      towerE: '弹射 10 次（衰减 5%），50% 概率麻痹，附加【麻痹值】：降 5% 防御，每秒扣 0.5% 生命',
      towerF: '触发全屏【风蚀增伤】：全场怪物受到伤害 +20%（持续 5 秒，10秒CD）'
    };
    return map[key] || null;
  }
}
