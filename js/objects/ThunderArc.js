/**
 * ThunderArc.js —— 雷元素塔外围电弧特效（Phaser Graphics 代码生成）
 *
 * 规则（全部 JSON 驱动，见 config.towers.towerE.thunderArc）：
 * - 电弧为围绕塔身的随机折线，由 scene.add.graphics() 每帧重绘；
 * - 每条电弧闪现 life 秒后完全消失，再按 interval 随机重生；
 * - 数量/频率/长度/分叉/颜色/持续时间均随等级递增（数组索引 level-1）；
 * - 塔主体贴图（thunder_tower_lvN）完全静止，电弧绝不覆盖中心；
 * - 每帧开销 = arcCount × (6~10 段) 次 lineTo，性能可控。
 *
 * 使用方式：
 *   const arc = new ThunderArc(tower);
 *   tower.add(arc.gfx);   // 或 tower.head.add(arc.gfx)（静止主体）
 *   arc.setLevel(level);  // 升级时调用，参数立即切换
 *   arc.destroy();        // 塔销毁时调用
 */

class ThunderArc {
  constructor(tower) {
    this.tower = tower;
    this.scene = tower.scene;
    this.cfg = (tower.cfg && tower.cfg.thunderArc) || {
      arcCount: [1, 2, 3],
      interval: [0.55, 0.40, 0.28],
      length: [12, 18, 24],
      branches: [1, 2, 3],
      life: [0.22, 0.25, 0.28],
      colors: [0x9b6bff, 0x9fdcff, 0xffe76b, 0xffffff]
    };
    this.level = Math.max(1, Math.min(3, tower.level || 1));
    this.gfx = this.scene.add.graphics();
    this.arcs = [];        // 活跃电弧列表
    this._spawnT = 0;      // 下次重生倒计时
    this._alive = true;
    // 初始立即生成一批，避免启动瞬间无特效
    for (let i = 0; i < this._maxArc(); i++) this._spawnArc();
  }

  /* ---------- 参数读取（按等级索引） ---------- */
  _maxArc() { return this._pick('arcCount'); }
  _interval() { return this._pick('interval'); }
  _length() { return this._pick('length'); }
  _branches() { return this._pick('branches'); }
  _life() { return this._pick('life'); }
  _colors() { return this.cfg.colors; }
  _pick(key) {
    const arr = this.cfg[key];
    return Array.isArray(arr) ? arr[this.level - 1] : arr;
  }

  /* 升级时调用：切换等级，立即刷新参数并清空旧电弧 */
  setLevel(level) {
    const lv = Math.max(1, Math.min(3, level));
    if (lv === this.level) return;
    this.level = lv;
    this.arcs = [];
    this.gfx.clear();
    for (let i = 0; i < this._maxArc(); i++) this._spawnArc();
  }

  /* 生成一条新电弧：随机方向 + 随机长度 + 随机分叉 */
  _spawnArc() {
    const maxArc = this._maxArc();
    if (this.arcs.length >= maxArc) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = this._length() * (0.6 + Math.random() * 0.4); // 离主体 0.6~1.0 倍
    const life = this._life() * (0.7 + Math.random() * 0.6);   // 0.7~1.3 倍
    const color = this._colors()[Math.floor(Math.random() * this._colors().length)];
    const branches = this._branches();
    const segs = 5 + Math.floor(Math.random() * 4); // 5~8 段折线
    const pts = [{ x: 0, y: 0 }];
    let px = 0, py = 0;
    const step = dist / segs;
    for (let i = 0; i < segs; i++) {
      px += step * (0.7 + Math.random() * 0.6);
      py += (Math.random() - 0.5) * step * 0.8;
      pts.push({ x: px, y: py });
    }
    const arc = {
      angle, pts, life, maxLife: life, color, branches,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      alpha: 0,
      fadeIn: Math.min(0.04, life * 0.25),   // 快速出现
      fadeOut: life * 0.6                      // 缓慢消失
    };
    this.arcs.push(arc);
  }

  /* 生成单条电弧的折线路径（含分叉） */
  _drawArc(arc) {
    const { pts, color, alpha, branches } = arc;
    const lw = 1.2 + (this.level - 1) * 0.4;
    // 主路径
    this.gfx.lineStyle(lw, color, alpha);
    this.gfx.beginPath();
    this.gfx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      this.gfx.lineTo(pts[i].x, pts[i].y);
    }
    this.gfx.strokePath();
    // 分叉：从中间点随机引出
    for (let b = 0; b < branches; b++) {
      const mid = 1 + Math.floor(Math.random() * (pts.length - 2));
      const sx = pts[mid].x, sy = pts[mid].y;
      let bx = sx, by = sy;
      this.gfx.beginPath();
      this.gfx.moveTo(sx, sy);
      const bSegs = 2 + Math.floor(Math.random() * 2); // 2~3 段
      const bLen = this._length() * 0.35;
      for (let i = 0; i < bSegs; i++) {
        bx += (Math.random() - 0.5) * bLen;
        by += (Math.random() - 0.5) * bLen;
        this.gfx.lineTo(bx, by);
      }
      this.gfx.lineStyle(lw * 0.65, color, alpha * 0.75);
      this.gfx.strokePath();
    }
  }

  /* 每帧调用（由 Tower.update 或 scene.update 触发） */
  update(dt) {
    if (!this._alive) return;
    const now = this.scene.time.now / 1000;
    // 重生倒计时
    this._spawnT -= dt;
    if (this._spawnT <= 0) {
      this._spawnArc();
      this._spawnT = this._interval() * (0.8 + Math.random() * 0.4); // 随机间隔
    }
    // 更新存活电弧
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const a = this.arcs[i];
      a.life -= dt;
      if (a.life <= 0) {
        this.arcs.splice(i, 1);
        continue;
      }
      const t = a.maxLife - a.life;
      if (t < a.fadeIn) a.alpha = t / a.fadeIn;
      else if (a.life < a.fadeOut) a.alpha = a.life / a.fadeOut;
      else a.alpha = 1;
      // 轻微闪烁（模拟自然闪电抖动）
      a.alpha *= 0.9 + Math.sin(now * 40 + a.angle * 10) * 0.1;
    }
    // 重绘
    this.gfx.clear();
    for (const a of this.arcs) {
      this.gfx.save();
      this.gfx.translateCanvas(a.x, a.y);
      this.gfx.rotateCanvas(a.angle);
      this._drawArc(a);
      this.gfx.restore();
    }
  }

  destroy() {
    this._alive = false;
    if (this.gfx && this.gfx.active) this.gfx.destroy();
    this.arcs = [];
  }
}

window.ThunderArc = ThunderArc;
