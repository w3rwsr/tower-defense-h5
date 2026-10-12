/**
 * ThunderArc.js —— 雷元素塔【外围装饰层】遮罩显现特效
 *
 * 新版（遮罩驱动）：装饰形状 100% 来自 BootScene 从 thunder_deco_all.png
 * 按内容边界裁出的整张装饰贴图（thunder_deco_lvN）。代码不绘制任何自由形状，
 * 只用一张与源贴图等大的 per-tower canvas 做"从下往上遮罩显现"：
 *   1. wait   随机等待 interval 秒（1/2/3 级递减 → 频率递增）；
 *   2. reveal 从底部 0 行逐渐复制到顶部全高（0.2~0.3 秒），装饰从下往上逐渐
 *              显现；alpha = maxAlpha；
 *   3. fade   完整装饰可见，alpha 从 maxAlpha 线性淡出到 0；
 *   4. 回到 wait，循环。
 *
 * 本体层（thunder_tower_lvN）是独立静态 image，本类完全不触碰它——本体始终
 * 清晰、稳定、静止，装饰闪现不影响本体。
 *
 * 挂载：装饰 image add 进雷塔炮塔 container（与本体同坐标系、同旋转中心），
 * 位置 = window.__thunderDecoOffset[等级] × k（世界坐标偏移），自身
 * setScale(k) 与本体显示缩放一致，叠加后与原图严格对齐。
 * 装饰 image 自身 setScale(k) 与本体一致，container 不缩放只做转向。
 *
 * per-tower canvas：每座雷塔独有一张与源装饰贴图等大的 canvas 纹理，
 * 每帧只复制当前已显现的底部行（drawImage 同位置同尺寸，无拉伸），
 * 未显现区域保持透明。形状 = 源贴图逐像素一致，代码不重绘。
 * 注意：CanvasTexture 存在预乘 alpha 二次预乘问题，每次 _updateDisplay
 * 将 canvas 转 dataURL → Image → addImage，走 PNG 直通 alpha 路径，
 * 与本体层完全一致，消除边缘发虚。
 *
 * 特效参数（JSON 驱动，config.towers.towerE.thunderDeco）：
 *   interval  闪现后的平均等待秒（1/2/3 级递减 → 频率递增）；
 *   reveal    从下往上显现持续秒（0.2~0.3 区间）；
 *   fadeOut   显现完成后淡出秒；
 *   maxAlpha  峰值透明度（默认 0.85，不压过本体）。
 * 装饰"数量"随等级递增由原图本身保证：3 级装饰分叉多于 2 级多于 1 级。
 */
let _thunderArcUid = 0;

class ThunderArc {
  constructor(tower) {
    this.tower = tower;
    this.scene = tower.scene;
    this.cfg = (tower.cfg && tower.cfg.thunderDeco) || {
      interval: [0.55, 0.40, 0.26],
      reveal:   [0.22, 0.25, 0.28],
      fadeOut:  [0.15, 0.18, 0.20],
      maxAlpha: 0.85
    };
    this.level = Math.max(1, Math.min(3, tower.level || 1));
    this._alive = true;
    this._img = null;          // 装饰层 image
    this._dispKey = null;      // per-tower canvas 纹理 key
    this._dispTex = null;      // per-tower CanvasTexture
    this._dispCtx = null;      // per-tower canvas 2D context
    this._srcCanvas = null;    // 源装饰贴图 canvas（从中复制像素）
    this._texW = 0;
    this._texH = 0;
    this._off = { x: 0, y: 0 };
    this._state = 'wait';      // 'reveal' | 'fade' | 'wait'
    this._t = 0;
    this._revealTime = 0;
    this._fadeTime = 0;
    this._wait = 0;
    this._uid = ++_thunderArcUid;
    this._build();
  }

  _pick(key) {
    const arr = this.cfg[key];
    return Array.isArray(arr) ? arr[this.level - 1] : arr;
  }
  _maxAlpha() { return this.cfg.maxAlpha != null ? this.cfg.maxAlpha : 0.85; }

  /* 按当前等级构建装饰 image + per-tower canvas 纹理。
     canvas 创建失败时回退直接用源贴图（整体 alpha 闪现，无遮罩）。 */
  _build() {
    const decoKey = 'thunder_deco_lv' + this.level;
    if (!this.scene.textures.exists(decoKey)) return;
    const head = this.tower.turret;
    this._off = (window.__thunderDecoOffset &&
      window.__thunderDecoOffset[this.level]) || { x: 0, y: 0 };

    /* 获取源装饰贴图 canvas（BootScene addImage 的产物，getSourceImage 返回 Canvas） */
    const srcTex = this.scene.textures.get(decoKey);
    try { this._srcCanvas = srcTex.getSourceImage(); }
    catch (e) { this._srcCanvas = null; }
    if (!this._srcCanvas) return;
    this._texW = this._srcCanvas.width;
    this._texH = this._srcCanvas.height;
    if (this._texW <= 0 || this._texH <= 0) return;

    /* 创建 per-tower canvas 纹理（与源贴图等大，仅复制显现区域，无拉伸） */
    this._dispKey = 'thunder_deco_disp_' + this._uid;
    try {
      this._dispTex = this.scene.textures.createCanvas(
        this._dispKey, this._texW, this._texH);
    } catch (e) { this._dispTex = null; }

    if (!this._dispTex) {
      /* canvas 创建失败：回退直接用源贴图（整体 alpha 闪现，无遮罩） */
      const k = this.tower._thunderK || 0.25;
      this._img = this.scene.add.image(this._off.x * k, this._off.y * k, decoKey);
      this._img.setScale(k);
      this._img.setAlpha(0);
      head.add(this._img);
      this._state = 'wait';
      this._wait = Math.random() * this._pick('interval');
      return;
    }
    this._dispCtx = this._dispTex.getContext();
    this._dispCtx.clearRect(0, 0, this._texW, this._texH);
    /* LINEAR filter：与本体层一致 */
    try { this._dispTex.setFilter(Phaser.Textures.FilterMode.LINEAR); } catch (e) {}

    /* 装饰 image 使用 per-tower canvas 纹理 */
    const k = this.tower._thunderK || 0.25;
    this._img = this.scene.add.image(this._off.x * k, this._off.y * k, this._dispKey);
    this._img.setScale(k);
    this._img.setAlpha(0);
    head.add(this._img);

    /* CanvasTexture 预乘 alpha 修复：创建 Image 纹理替代 CanvasTexture。
       Canvas 2D 内部已做预乘 alpha，WebGL texImage2D 默认再预乘一次，
       导致边缘像素被二次压暗发虚。将 canvas 转 dataURL → Image → addImage，
       走 HTMLImageElement 的 PNG 直通 alpha 路径，与本体层完全一致。
       初始空纹理，首次 _updateDisplay 时替换。 */
    this._pendingTexUpdate = false;
    this._useImageTex = true;

    this._state = 'wait';
    this._t = 0;
    this._wait = Math.random() * this._pick('interval');
  }

  /* 从源 canvas 复制底部 revealH 行到 per-tower canvas（同位置同尺寸，无拉伸），
     然后转 Image 纹理消除预乘 alpha 问题。 */
  _updateDisplay(revealH) {
    if (!this._dispCtx || !this._srcCanvas) return;
    const ctx = this._dispCtx;
    ctx.clearRect(0, 0, this._texW, this._texH);
    if (revealH > 0) {
      const rh = Math.min(revealH, this._texH);
      ctx.drawImage(
        this._srcCanvas,
        0, this._texH - rh, this._texW, rh,       // 源区域
        0, this._texH - rh, this._texW, rh        // 目标区域（同位置同尺寸）
      );
    }
    /* Canvas → dataURL → Image → addImage：消除预乘 alpha，与本体层一致。
       异步解码完成后替换纹理，避免每帧创建大量 Image 对象。 */
    if (this._useImageTex && !this._pendingTexUpdate) {
      this._pendingTexUpdate = true;
      const dataURL = ctx.canvas.toDataURL('image/png');
      const img = new Image();
      img.onload = () => {
        try {
          if (this.scene.textures.exists(this._dispKey)) this.scene.textures.remove(this._dispKey);
          this.scene.textures.addImage(this._dispKey, img);
          this._img.setTexture(this._dispKey);
        } catch (e) {}
        this._pendingTexUpdate = false;
      };
      img.onerror = () => { this._pendingTexUpdate = false; };
      img.src = dataURL;
    } else {
      this._dispTex.refresh();
    }
  }

  /* 升级：销毁旧级 image + canvas，按新等级重建 */
  setLevel(level) {
    const lv = Math.max(1, Math.min(3, level));
    if (lv === this.level) return;
    this.level = lv;
    this._destroyImage();
    this._build();
  }

  _destroyImage() {
    if (this._img) {
      const head = this.tower.turret;
      try { head.remove(this._img); } catch (e) { /* 已销毁 */ }
      this._img.destroy();
      this._img = null;
    }
    /* 清理 per-tower canvas 纹理 */
    if (this._dispKey) {
      try {
        if (this.scene.textures.exists(this._dispKey))
          this.scene.textures.remove(this._dispKey);
      } catch (e) {}
    }
    this._dispKey = null;
    this._dispTex = null;
    this._dispCtx = null;
    this._srcCanvas = null;
  }

  /* 每帧由 Tower.update 调用；dt 秒。
     reveal：从底部往上复制，0.2~0.3 秒完成，alpha = maxAlpha；
     fade：完整显现后 alpha 线性淡出到 0；
     wait：随机等待 interval 秒后进入下一次 reveal。
     频率随等级递增（interval 数组 1<2<3 级递减）。 */
  update(dt) {
    if (!this._alive || !this._img) return;
    if (this._state === 'reveal') {
      this._t += dt;
      const progress = Math.min(1, this._t / this._revealTime);
      const revealH = progress * this._texH;
      if (this._dispCtx) this._updateDisplay(revealH);
      this._img.setAlpha(this._maxAlpha());
      if (progress >= 1) {
        this._state = 'fade';
        this._t = 0;
      }
    } else if (this._state === 'fade') {
      this._t += dt;
      const progress = Math.min(1, this._t / this._fadeTime);
      this._img.setAlpha(this._maxAlpha() * (1 - progress));
      if (progress >= 1) {
        this._state = 'wait';
        this._t = 0;
        this._img.setAlpha(0);
        if (this._dispCtx) this._updateDisplay(0);
        this._wait = this._pick('interval') * (0.7 + Math.random() * 0.8);
      }
    } else {
      this._wait -= dt;
      if (this._wait <= 0) {
        this._state = 'reveal';
        this._t = 0;
        /* 显现持续 0.2~0.3 秒，加随机相位避免节奏机械 */
        this._revealTime = this._pick('reveal') * (0.85 + Math.random() * 0.4);
        this._fadeTime = this._pick('fadeOut') * (0.85 + Math.random() * 0.4);
        if (this._dispCtx) this._updateDisplay(0);
      }
    }
  }

  /* 仅关停闪烁（塔销毁/场景关闭）；image + canvas 随炮塔 container 一并销毁，
     这里只兜底移除引用，避免场景重启后悬挂 */
  destroy() {
    this._alive = false;
    this._destroyImage();
  }
}

window.ThunderArc = ThunderArc;
