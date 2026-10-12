/**
 * ThunderArc.js —— 雷元素塔【外围装饰层】遮罩显现特效
 *
 * 新版（静态 Image 纹理 + setCrop 遮罩）：
 * 装饰形状 100% 来自 BootScene 从 thunder_deco_all.png 按内容边界裁出的
 * 整张装饰贴图（thunder_deco_lvN）。代码不绘制任何自由形状，也不创建
 * per-tower canvas——直接用源贴图的静态 Image 纹理，通过 setCrop 控制
 * 可见区域实现"从下往上遮罩显现"：
 *   1. wait   随机等待 interval 秒（1/2/3 级递减 → 频率递增）；
 *   2. reveal setCrop 从底部 0 高逐渐扩展到全高，装饰从下往上逐渐显现；
 *   3. fade   完整装饰可见，alpha 从 maxAlpha 线性淡出到 0；
 *   4. 回到 wait，循环。
 *
 * 本体层（thunder_tower_lvN）是独立静态 image，本类完全不触碰它——本体始终
 * 清晰、稳定、静止，装饰闪现不影响本体。
 *
 * 挂载：装饰 image add 进雷塔炮塔 container（与本体同坐标系、同旋转中心），
 * 位置 = window.__thunderDecoOffset[等级] × k（世界坐标偏移），自身
 * setScale(k) 与本体显示缩放一致，叠加后与原图严格对齐。
 *
 * 关键优势：无 CanvasTexture、无预乘 alpha、无每帧纹理重建，
 * 与火/冰/水塔的 addImage(Image) 渲染路径完全一致，边缘锐利。
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

  /* 按当前等级构建装饰 image：直接用源贴图静态 Image 纹理，setCrop 做遮罩。
     无 CanvasTexture、无预乘 alpha、无每帧纹理重建，与本体层完全一致。 */
  _build() {
    const decoKey = 'thunder_deco_lv' + this.level;
    if (!this.scene.textures.exists(decoKey)) return;
    const head = this.tower.turret;
    this._off = (window.__thunderDecoOffset &&
      window.__thunderDecoOffset[this.level]) || { x: 0, y: 0 };

    /* 获取源贴图尺寸（用于 setCrop 计算） */
    const srcTex = this.scene.textures.get(decoKey);
    const srcImg = srcTex.getSourceImage();
    this._texW = srcImg.width;
    this._texH = srcImg.height;
    if (this._texW <= 0 || this._texH <= 0) return;

    /* 装饰 image：直接用源贴图静态 Image 纹理 */
    const k = this.tower._thunderK || 0.25;
    this._img = this.scene.add.image(this._off.x * k, this._off.y * k, decoKey);
    this._img.setScale(k);
    this._img.setAlpha(0);
    /* setCrop 初始状态：完全不可见（高度 0，从底部开始） */
    this._img.setCrop(0, this._texH, this._texW, 0);
    head.add(this._img);

    this._state = 'wait';
    this._t = 0;
    this._wait = Math.random() * this._pick('interval');
  }

  /* 更新遮罩：从底部往上逐渐显现。revealH 为已显现高度（纹素）。 */
  _updateCrop(revealH) {
    if (!this._img) return;
    const rh = Math.max(0, Math.min(revealH, this._texH));
    /* setCrop(x, y, w, h)：y 从底部开始，高度 rh */
    this._img.setCrop(0, this._texH - rh, this._texW, rh);
  }

  /* 升级：销毁旧级 image，按新等级重建 */
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
  }

  /* 每帧由 Tower.update 调用；dt 秒。
     reveal：setCrop 从底部 0 高逐渐扩展到全高，alpha = maxAlpha；
     fade：完整显现后 alpha 线性淡出到 0；
     wait：随机等待 interval 秒后进入下一次 reveal。 */
  update(dt) {
    if (!this._alive || !this._img) return;
    if (this._state === 'reveal') {
      this._t += dt;
      const progress = Math.min(1, this._t / this._revealTime);
      this._updateCrop(progress * this._texH);
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
        this._updateCrop(0);
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
        this._updateCrop(0);
      }
    }
  }

  /* 仅关停闪烁（塔销毁/场景关闭）；image 随炮塔 container 一并销毁 */
  destroy() {
    this._alive = false;
    this._destroyImage();
  }
}

window.ThunderArc = ThunderArc;
