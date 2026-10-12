/**
 * ThunderArc.js —— 雷元素塔【外围装饰层】闪现特效
 *
 * 新版（贴图分层驱动）：装饰形状 100% 来自 BootScene 从 thunder_deco_all.png
 * 按内容边界裁出的整张装饰贴图（thunder_deco_lvN），代码不绘制任何自由形状，
 * 只对这张装饰图做 alpha「闪现—亮起—保持—淡出—间隔—重新出现」循环，
 * 模拟自然闪电的明灭节奏。形状 / 颜色 / 位置与原图逐像素一致。
 *
 * 本体层（thunder_tower_lvN）是独立静态 image，本类完全不触碰它——本体始终
 * 清晰、稳定、静止，装饰闪现不影响本体。
 *
 * 挂载：装饰 image 以【纹素坐标】add 进雷塔炮塔 container（与本体同坐标系、
 * 同旋转中心），位置 = window.__thunderDecoOffset[等级]（装饰中心相对本体
 * 中心的纹素偏移，由裁切时按共享坐标系实测，叠加后与原图严格对齐）。
 * container 统一 setScale(纹素→世界 ≈0.25)，装饰与本体永远严格对齐，不错位。
 *
 * 闪现节奏（JSON 驱动，config.towers.towerE.thunderDeco）：
 *   interval  次闪现后的平均等待秒（1/2/3 级递减 → 频率递增）；
 *   life      单次闪现持续秒（0.2~0.3 区间，亮 20% → 保持 → 淡出 60%）；
 *   flicker   亮起期明暗微抖幅度（0~0.25）；
 *   maxAlpha  峰值透明度（默认 0.9，不压过本体）。
 * 装饰"数量"随等级递增由原图本身保证：3 级装饰分叉多于 2 级多于 1 级，
 * 代码不做数量控制，闪现的是整张装饰图（含全部分叉）。
 */
class ThunderArc {
  constructor(tower) {
    this.tower = tower;
    this.scene = tower.scene;
    this.cfg = (tower.cfg && tower.cfg.thunderDeco) || {
      interval: [0.55, 0.40, 0.26], life: [0.22, 0.25, 0.28],
      flicker: 0.12, maxAlpha: 0.9
    };
    this.level = Math.max(1, Math.min(3, tower.level || 1));
    this._alive = true;
    this._img = null;        // 装饰层 image（销毁用）
    this._state = 'wait';    // 'lit'=闪现中 / 'wait'=间隔等待
    this._t = 0;              // 当前状态已持续时间
    this._life = 0;           // 本次闪现持续秒
    this._wait = 0;           // 本次等待剩余秒
    this._build();
  }

  _pick(key) {
    const arr = this.cfg[key];
    return Array.isArray(arr) ? arr[this.level - 1] : arr;
  }
  _maxAlpha() { return this.cfg.maxAlpha != null ? this.cfg.maxAlpha : 0.9; }

  /* 按当前等级构建装饰 image：纹理缺失则禁用闪现（本体仍可用，绝不黑屏） */
  _build() {
    const decoKey = 'thunder_deco_lv' + this.level;
    if (!this.scene.textures.exists(decoKey)) return;
    const head = this.tower.turret;   // 雷塔炮塔 container（纹素坐标系）
    const off = (window.__thunderDecoOffset &&
      window.__thunderDecoOffset[this.level]) || { x: 0, y: 0 };
    this._img = this.scene.add.image(off.x, off.y, decoKey);
    this._img.setAlpha(0);
    head.add(this._img);
    /* 起始等待一个随机相位，避免多塔同时闪现 */
    this._state = 'wait';
    this._t = 0;
    this._wait = Math.random() * this._pick('interval');
  }

  /* alpha 包络：前 20% 快速亮起，中段满亮+微抖，末 60% 线性淡出。
     亮起/淡出过渡平滑，模拟自然闪电的明灭感。 */
  _envelope(t, life) {
    let a;
    if (t < life * 0.2) a = t / (life * 0.2);
    else if (t > life * 0.4) a = Math.max(0, (life - t) / (life * 0.6));
    else a = 1;
    const fl = this.cfg.flicker || 0;
    if (fl > 0 && a > 0) a *= 1 - fl / 2 + Math.random() * fl;
    return Math.max(0, Math.min(1, a)) * this._maxAlpha();
  }

  /* 升级：销毁旧级 image，按新等级重建（新级装饰贴图 + 新偏移 + 新节奏） */
  setLevel(level) {
    const lv = Math.max(1, Math.min(3, level));
    if (lv === this.level) return;
    this.level = lv;
    this._destroyImage();
    this._build();
  }

  _destroyImage() {
    if (!this._img) return;
    const head = this.tower.turret;
    try { head.remove(this._img); } catch (e) { /* 已销毁 */ }
    this._img.destroy();
    this._img = null;
  }

  /* 每帧由 Tower.update 调用；dt 秒。
     闪现中：累加 t，按包络设 alpha，t≥life 转 wait；
     等待中：递减 wait，wait≤0 转 lit 开始下一次闪现。
     频率随等级递增（interval 数组 1<2<3 级递减）。 */
  update(dt) {
    if (!this._alive || !this._img) return;
    if (this._state === 'lit') {
      this._t += dt;
      if (this._t >= this._life) {
        this._state = 'wait';
        this._t = 0;
        this._wait = this._pick('interval') * (0.7 + Math.random() * 0.8);
        this._img.setAlpha(0);
      } else {
        this._img.setAlpha(this._envelope(this._t, this._life));
      }
    } else {
      this._wait -= dt;
      if (this._wait <= 0) {
        this._state = 'lit';
        this._t = 0;
        /* 单次闪现持续 0.2~0.3 区间，加随机相位避免节奏机械 */
        this._life = this._pick('life') * (0.85 + Math.random() * 0.4);
      }
    }
  }

  /* 仅关停闪烁（塔销毁/场景关闭）；image 随炮塔 container 一并销毁，
     这里只兜底移除引用，避免场景重启后悬挂 */
  destroy() {
    this._alive = false;
    this._destroyImage();
  }
}

window.ThunderArc = ThunderArc;
