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

    /* ---- 范围吸引位移场（塔D）：渲染坐标 = 路径基点 + (pullDX,pullDY)
         pullFresh 由塔 D 每帧标记，未标记时位移向 0 衰减回路径 ---- */
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

    /* 沿路径前进；被塔D显著拉开时推进减速（真控场，避免拉开同时仍正常推进） */
    const speedNow = this.baseSpeed * (this.slowTimer > 0 ? this.slowFactor : 1);
    const dispMag = Math.hypot(this.pullDX, this.pullDY);
    const ctrlSlow = (this.pullFresh && dispMag > 16) ? 0.5 : 1;
    this.pathDist += speedNow * dt * ctrlSlow;

    if (this.pathDist >= this.scene.pathLength) {
      this.leaked = true;
      this.dead = true;
      this.scene.onEnemyLeak(this);
      return;
    }

    const p = this.scene.pathPointAt(this.pathDist);
    /* 未被塔D标记时位移向 0 衰减（敌人离开吸引范围后回归路径） */
    if (!this.pullFresh) {
      const decay = Math.exp(-9 * dt);
      this.pullDX *= decay;
      this.pullDY *= decay;
    }
    this.pullFresh = false;
    this.setPosition(p.x + this.pullDX, p.y + this.pullDY);
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
