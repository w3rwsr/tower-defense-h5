/**
 * ThunderArc.js —— 雷元素塔【装饰层】闪现特效
 *
 * 与旧版自由折线电弧不同：装饰形状 100% 来自母版分层出的贴图帧
 * （ThunderTowerArtData.frames，BootScene 挂到 window.__thunderDecoFrames）：
 *   - rim    : 沿整道闪电的辉光描边（一帧），低频“呼吸式”整体闪现；
 *   - sparks : 原贴图外围的独立闪电分叉（多帧），随机轮流点亮。
 * 代码只对这些静态帧做 alpha「快速亮起→保持→淡出→间隔后重生」循环，
 * 不生成任何自由形状；颜色/位置/形状与原贴图逐像素一致。
 *
 * 本体层（thunder_tower_lvN）是独立静态 image，本类完全不触碰它。
 *
 * 挂载：装饰帧 image 以【纹素坐标】add 进雷塔炮塔 container（与本体同
 * 坐标系、同旋转中心），炮塔仅做黄色端索敌转向；container 统一 4x→显示
 * 缩放（≈0.25），装饰与本体永远严格对齐，不错位。
 *
 * 参数全部 JSON 驱动（config.towers.towerE.thunderDeco）：
 *   active/interval/life 随 1/2/3 级递增；rimInterval/rimLife 控制辉环呼吸；
 *   flicker 亮起期明暗微抖；maxAlpha 峰值透明度（不压过本体）。
 */
class ThunderArc {
  constructor(tower) {
    this.tower = tower;
    this.scene = tower.scene;
    this.cfg = (tower.cfg && tower.cfg.thunderDeco) || {
      active: [2, 3, 5], interval: [0.55, 0.40, 0.26],
      life: [0.22, 0.25, 0.28], rimInterval: [1.6, 1.2, 0.9],
      rimLife: [0.28, 0.30, 0.30], flicker: 0.12, maxAlpha: 0.9
    };
    this.level = Math.max(1, Math.min(3, tower.level || 1));
    this._alive = true;
    this._imgs = [];      // 本类创建的全部 image（销毁用）
    this._sparks = [];    // 分叉帧状态 {img, frame, active, t, life, wait}
    this._rim = null;     // 辉环状态 {img, t, life, wait}
    this._build();
  }

  _pick(key) {
    const arr = this.cfg[key];
    return Array.isArray(arr) ? arr[this.level - 1] : arr;
  }

  /* 按当前等级构建一整套装饰帧（升级时先 destroyImages 再调） */
  _build() {
    const frames = (window.__thunderDecoFrames &&
      window.__thunderDecoFrames[this.level]) || null;
    const decoKey = 'thunder_deco_lv' + this.level;
    if (!frames || !this.scene.textures.exists(decoKey)) return;
    const tex = this.scene.textures.get(decoKey);
    const head = this.tower.turret;   // 雷塔炮塔 container（纹素坐标系）
    const mkImg = (fr) => {
      const fname = decoKey + '_' + fr.name;
      if (!tex.has(fname)) {
        /* Texture.add(name, sourceIndex, x, y, width, height)：位置参数，
           坐标来自离线烘焙的 0-based 像素帧元数据 */
        tex.add(fname, 0, fr.x, fr.y, fr.w, fr.h);
      }
      const img = this.scene.add.image(fr.ox, fr.oy, decoKey, fname);
      img.setAlpha(0);
      head.add(img);
      this._imgs.push(img);
      return img;
    };

    for (const fr of frames) {
      const img = mkImg(fr);
      if (fr.name === 'rim') {
        this._rim = { img: img, t: 0, life: 0,
          wait: this._rimInterval() * (0.4 + Math.random() * 0.5) };
      } else {
        this._sparks.push({ img: img, frame: fr, active: false,
          t: 0, life: 0, wait: Math.random() * this._pick('interval') });
      }
    }
  }

  _life() { return this._pick('life'); }
  _interval() { return this._pick('interval'); }
  _maxAlpha() { return this.cfg.maxAlpha != null ? this.cfg.maxAlpha : 0.9; }

  /* alpha 包络：前 20% 快速亮起，末 60% 线性淡出，中段满亮+微抖 */
  _envelope(st) {
    const life = st.life, t = st.t;
    let a;
    if (t < life * 0.2) a = t / (life * 0.2);
    else if (t > life * 0.4) a = Math.max(0, (life - t) / (life * 0.6));
    else a = 1;
    const fl = this.cfg.flicker || 0;
    if (fl > 0 && a > 0) {
      a *= 1 - fl / 2 + Math.random() * fl;
    }
    return Math.max(0, Math.min(1, a)) * this._maxAlpha();
  }

  /* 升级：销毁旧帧，按新等级重建 */
  setLevel(level) {
    const lv = Math.max(1, Math.min(3, level));
    if (lv === this.level) return;
    this.level = lv;
    this._destroyImages();
    this._sparks = [];
    this._rim = null;
    this._build();
  }

  _destroyImages() {
    const head = this.tower.turret;
    for (const img of this._imgs) {
      try { head.remove(img); } catch (e) { /* 已销毁 */ }
      img.destroy();
    }
    this._imgs = [];
  }

  /* 每帧由 Tower.update 调用；dt 秒 */
  update(dt) {
    if (!this._alive) return;
    const maxActive = this._pick('active');

    /* ---- 外侧分叉：熄灭等待 → 随机点亮一帧 → 闪现淡出 → 再等待 ---- */
    let lit = 0;
    for (const s of this._sparks) if (s.active) lit++;
    for (const s of this._sparks) {
      if (s.active) {
        s.t += dt;
        if (s.t >= s.life) {
          s.active = false;
          s.t = 0;
          s.wait = this._interval() * (0.6 + Math.random() * 0.8);
          s.img.setAlpha(0);
        } else {
          s.img.setAlpha(this._envelope(s));
        }
      } else {
        s.wait -= dt;
        // 同屏未达上限时才点亮；起始时刻加微小随机相位避免齐闪
        if (s.wait <= 0 && lit < maxActive) {
          s.active = true;
          lit++;
          s.life = this._life() * (0.85 + Math.random() * 0.4); // 0.2~0.3s 区间
          s.t = 0;
        }
      }
    }

    /* ---- 辉光描边：低频整圈呼吸（亮 0.28~0.3s，间隔随等级缩短） ---- */
    if (this._rim) {
      const r = this._rim;
      if (r.life > 0) {
        r.t += dt;
        if (r.t >= r.life) {
          r.life = 0; r.t = 0;
          r.wait = this._rimInterval() * (0.7 + Math.random() * 0.6);
          r.img.setAlpha(0);
        } else {
          r.img.setAlpha(this._envelope(r));
        }
      } else {
        r.wait -= dt;
        if (r.wait <= 0) {
          r.life = (this.cfg.rimLife[this.level - 1] || 0.3) *
                   (0.9 + Math.random() * 0.25);
          r.t = 0;
        }
      }
    }
  }

  _rimInterval() {
    const a = this.cfg.rimInterval;
    return Array.isArray(a) ? a[this.level - 1] : a;
  }

  /* 仅关停闪烁（塔销毁/场景关闭）；image 随炮塔 container 一并销毁，
     这里只兜底移除引用，避免场景重启后悬挂 */
  destroy() {
    this._alive = false;
    this._destroyImages();
    this._sparks = [];
    this._rim = null;
  }
}

window.ThunderArc = ThunderArc;
