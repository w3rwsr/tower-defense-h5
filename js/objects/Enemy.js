/* ============================================================
 * Enemy.js —— 敌人（敌人X：低血快速 / 敌人Y：高血慢速）
 * 沿 GameScene 预计算的路径移动，支持减速 debuff 与血条。
 * ============================================================ */
class Enemy extends Phaser.GameObjects.Container {
  constructor(scene, typeKey) {
    const cfg = TD_CONFIG.enemies[typeKey];
    const p = scene.pathPointAt(0);
    super(scene, p.x, p.y);

    this.typeKey = typeKey;
    this.cfg = cfg;
    this.radius = cfg.radius;

    /* ---- 数值（全部来自 JSON） ---- */
    this.maxHp = cfg.hp;
    this.hp = cfg.hp;
    this.baseSpeed = cfg.speed;
    this.reward = cfg.reward;
    this.leakDamage = cfg.leakDamage;

    /* ---- 路径状态 ---- */
    this.pathDist = 0;
    this.dead = false;     // 已死亡（索敌忽略）
    this.removed = false;  // 已从场景移除（数组过滤用）
    this.leaked = false;   // 到达终点

    /* ---- 减速状态 ---- */
    this.slowTimer = 0;
    this.slowFactor = 1;

    /* ---- 范围吸引（塔D）：pullBack = 沿路【向后】的视觉回拉距离（像素，≥0）
         渲染点 = pathPointAt(pathDist - pullBack)，数学上恒在道路上，
         绝不横向偏离路径；pathDist 只增不减，脉冲结束 pullBack 衰减归零
         即回到当前路径位置继续前进。
         pullDX/pullDY 为渲染点相对路径基点的派生向量（供自查/判定复用）；
         pullFresh 由塔D在吸附脉冲窗口内每帧标记，未标记时 pullBack 衰减。 */
    this.pullBack = 0;
    this.pullDX = 0;
    this.pullDY = 0;
    this.pullFresh = false;

    /* ---- 卡通占位贴图 ---- */
    this.body = scene.add.image(0, 0, 'enemy_' + typeKey);
    this.add(this.body);

    /* ---- 血条 ---- */
    const barW = cfg.radius * 2.4;
    this.barW = barW;
    this.barBg = scene.add.graphics();
    this.barBg.setPosition(0, -cfg.radius - 10);
    this.add(this.barBg);

    this.setDepth(20);
    scene.add.existing(this);
    this.drawHpBar(1);
  }

  /* 施加减速：取更强（数值更小）的减速系数，时间刷新取较长者 */
  applySlow(factor, duration) {
    // 多种减速同时存在时：取更强（系数更小）者，持续时间刷新为较长者
    this.slowFactor = this.slowTimer > 0 ? Math.min(this.slowFactor, factor) : factor;
    this.slowTimer = Math.max(this.slowTimer, duration);
    this.body.setTint(0xbbeeff);
  }

  takeDamage(value) {
    if (this.dead) return;
    this.hp -= value;
    this.drawHpBar(Math.max(0, this.hp / this.maxHp));
    if (this.hp <= 0) this.scene.onEnemyKilled(this);
  }

  update(dt) {
    if (this.dead) return;

    /* 减速计时 */
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) {
        this.slowTimer = 0;
        this.slowFactor = 1;
        this.body.clearTint();
      }
    }

    /* 沿路径前进；被塔D显著回拉时推进减速（真控场，避免回拉同时仍正常推进） */
    const speedNow = this.baseSpeed * (this.slowTimer > 0 ? this.slowFactor : 1);
    const ctrlSlow = (this.pullFresh && this.pullBack > 16) ? 0.5 : 1;
    this.pathDist += speedNow * dt * ctrlSlow;

    if (this.pathDist >= this.scene.pathLength) {
      this.leaked = true;
      this.dead = true;
      this.scene.onEnemyLeak(this);
      return;
    }

    /* 脉冲间隙/离开射程：沿路回拉量向 0 衰减，敌人回弹到当前路径位置 */
    if (!this.pullFresh) {
      this.pullBack *= Math.exp(-9 * dt);
      if (this.pullBack < 0.5) this.pullBack = 0;
    }
    this.pullFresh = false;

    /* 基点（真实进度）与渲染点（被回拉后的路径点）——两者都在路径上，
       从几何上保证敌人任何时刻都不会离开道路，拐弯同样成立。 */
    const p = this.scene.pathPointAt(this.pathDist);
    const vp = this.scene.pathPointAt(Math.max(0, this.pathDist - this.pullBack));
    this.pullDX = vp.x - p.x;
    this.pullDY = vp.y - p.y;
    this.setPosition(vp.x, vp.y);
    /* 让下方的敌人盖住上方的，制造一点层次 */
    this.setDepth(20 + Math.floor(p.y));
  }

  drawHpBar(ratio) {
    const g = this.barBg;
    const w = this.barW;
    const h = this.cfg.barThickness || 5;   // BOSS 更粗血条（barThickness）
    g.clear();
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-w / 2 - 1, -1, w + 2, h + 2, 3);
    if (ratio > 0) {
      /* 血量颜色：绿 → 黄 → 红 */
      const color = ratio > 0.55 ? 0x6be26b : ratio > 0.25 ? 0xffd24a : 0xff5d5d;
      g.fillStyle(color, 1);
      g.fillRoundedRect(-w / 2, 0, w * ratio, h, 2.5);
    }
  }

  /* 击杀后的弹跳消失动画，结束后由场景统一销毁 */
  playDeath() {
    this.body.setTint(0xffffff);
    this.scene.tweens.add({
      targets: this,
      scale: 1.35,
      duration: 120,
      yoyo: true,
      onComplete: () => {
        this.removed = true;
        this.destroy();
      }
    });
  }

  destroyImmediately() {
    this.removed = true;
    this.destroy();
  }
}
