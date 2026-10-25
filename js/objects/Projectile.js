/* ============================================================
 * Projectile.js —— 塔发射的弹道
 * 追踪目标飞行；目标死亡后仍飞向最后已知位置：
 *   - 单体弹（damage）：目标没了就空爆消失；
 *   - 范围冰弹（splashSlow）：到达落点后范围伤害 + 减速。
 * ============================================================ */
/* 点到线段最短距离的平方（扫掠碰撞用，避免开方） */
function segPointDistSq(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0.000001) {
    const ex = px - ax, ey = py - ay;
    return ex * ex + ey * ey;
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  const qx = ax + dx * t, qy = ay + dy * t;
  const ex = px - qx, ey = py - qy;
  return ex * ex + ey * ey;
}

class Projectile extends Phaser.GameObjects.Image {
  constructor(scene, x, y, target, pCfg, damage, sourceTower) {
    /* 贴图：默认按颜色生成圆弹；pCfg.texture 指定专用贴图（如风刃 proj_wind） */
    super(scene, x, y, pCfg.texture || ('proj_' + pCfg.color.toString(16)));

    this.pCfg = pCfg;
    this.damage = damage;                 // 已含塔等级加成
    this.effect = pCfg.effect;
    /* 全局解封「极速弹道」：所有塔的子弹/弹幕速度 ×3（仅第 10 关封印生效） */
    const bulletSeal = (scene && typeof scene.getSealCfg === 'function')
      ? scene.getSealCfg('globalBulletSpeed') : null;
    this._bulletSealApplied = !!bulletSeal;
    this.speed = pCfg.speed * (bulletSeal
      ? ((bulletSeal.bulletSpeedMul != null) ? bulletSeal.bulletSpeedMul : 3) : 1);
    this.target = target;
    this.sourceTower = sourceTower || null; // 发射塔（风元素塔扩散冷却判定用）
    this.spin = pCfg.spin || 0;           // 风刃旋转速度（弧度/秒，0=不旋转）

    /* 火元素塔（towerA）：按塔等级换熔岩弹贴图（裂纹/拖尾/火星随等级增强）。
       离线贴图（window.__lavaBulletArt）自带拖尾火星，不再挂粒子；
       data URI 缺失回退程序火苗贴图时，保留旧的粒子拖尾表现。 */
    this._trail = null;
    const srcLv = sourceTower && sourceTower.isFire ? sourceTower.level : 0;
    if (srcLv >= 1) {
      const lv = Math.min(srcLv, 3);
      const texKey = 'proj_fire_lv' + lv;
      if (scene.textures.exists(texKey)) this.setTexture(texKey);
      /* 方向性熔岩弹：初始即朝目标偏转（update 中每帧随目标位置修正） */
      if (target) this.rotation = Math.atan2(target.y - y, target.x - x);
      if (window.__lavaBulletArt === true) {
        /* 离线贴图按球径等比烘焙（球纹素=ballDisplay×superSample=45px）：
           setScale = 等级系数 / superSample，三颗球显示几乎等大（15/15.75/16.5px），
           缩放系数由 config.towers.towerA.projectile.lavaBullet 驱动 */
        const lb = (pCfg.lavaBullet) ||
          (((typeof TD_CONFIG !== 'undefined') && TD_CONFIG.towers.towerA.projectile.lavaBullet) ||
           { superSample: 3, scale: {} });
        const lvScale = (lb.scale && lb.scale[lv]) != null ? lb.scale[lv] : 1;
        this.setScale(lvScale / (lb.superSample || 3));
        /* 代码拖尾：贴图仅球体本体，拖尾/火星由粒子生成，强度随等级递增。
           粒子 speed=0、follow 本弹——发射后滞留原地，形成朝后的橙红尾迹。 */
        const t = (lb.trail && lb.trail[lv]) || null;
        if (t) {
          this._trail = scene.add.particles(0, 0, 'fire_dot', {
            /* fire_dot 已 2x 超采样（16px），start scale 减半保持屏显不变 */
            speed: 0, scale: { start: t.scale / 2, end: 0 },
            alpha: { start: t.alpha, end: 0 }, lifespan: t.lifespan,
            frequency: t.frequency, blendMode: 'ADD', follow: this
          }).setDepth(39);
          if (t.sparks) {
            // 三级额外火星：四散的小亮点（参数全部由 config.lavaBullet.trail[3].sparks 驱动）
            const sp = t.sparks;
            this._sparks = scene.add.particles(0, 0, 'fire_dot', {
              speed: { min: 8, max: sp.speedMax || 30 },
              scale: { start: (sp.scale || 0.45) / 2, end: 0 },
              alpha: { start: 0.9, end: 0 },
              lifespan: sp.lifespan || 140, frequency: sp.frequency || 70,
              blendMode: 'ADD', follow: this
            }).setDepth(39);
          }
        }
      } else {
        /* 程序火苗贴图已 2x 超采样烘焙（52/68/88px），scale 减半保持
           屏显尺寸与旧版一致（26/35.7/50.6px），纹理清晰度翻倍 */
        this.setScale(srcLv === 1 ? 0.5 : srcLv === 2 ? 0.525 : 0.575);
        if (srcLv >= 2) {
          this._trail = scene.add.particles(0, 0, 'fire_dot', {
            speed: 0, scale: { start: srcLv === 2 ? 0.45 : 0.65, end: 0 },
            alpha: { start: 0.55, end: 0 }, lifespan: srcLv === 2 ? 160 : 260,
            frequency: srcLv === 2 ? 30 : 18, blendMode: 'ADD', follow: this
          }).setDepth(39);
          if (srcLv >= 3) {
            // 3级额外火星：四散的小亮点
            this._sparks = scene.add.particles(0, 0, 'fire_dot', {
              speed: { min: 10, max: 40 }, scale: { start: 0.25, end: 0 },
              alpha: { start: 0.9, end: 0 }, lifespan: 300, frequency: 40,
              blendMode: 'ADD', follow: this
            }).setDepth(39);
          }
        }
      }
    }

    /* 冰元素塔（towerB）：按塔等级换雪花冰弹贴图（proj_ice_lvN）。
       离线贴图只含雪花本体（烘焙拖尾/冰雾/文字已剔除），拖尾完全由代码
       生成——冰蓝粒子向后飘散 + 一条浅蓝渐变光带，强度随等级递增，
       参数全部读 config towerB.projectile.iceBullet（JSON 驱动）。
       雪花六出对称，不朝向目标，改为持续轻微自转增加动感。 */
    this.isIce = false;
    this.iceSpin = 0;
    this._ribbon = null;
    const iceSrcLv = sourceTower && sourceTower.isIce ? sourceTower.level : 0;
    if (iceSrcLv >= 1) {
      const lv = Math.min(iceSrcLv, 3);
      const texKey = 'proj_ice_lv' + lv;
      if (window.__iceBulletArt === true && scene.textures.exists(texKey)) {
        const ib = pCfg.iceBullet ||
          (((typeof TD_CONFIG !== 'undefined') && TD_CONFIG.towers.towerB.projectile.iceBullet) || null);
        if (ib) {
          this.isIce = true;
          this.setTexture(texKey);
          /* 臂展等比烘焙（臂展纹素=bodyDisplay×superSample=54px）：
             setScale=等级系数/superSample → 臂展显示 18/18.9/19.8px */
          const lvScale = (ib.scale && ib.scale[lv] != null) ? ib.scale[lv] : 1;
          this.setScale(lvScale / (ib.superSample || 3));
          this.iceSpin = (ib.spin && ib.spin[lv] != null) ? ib.spin[lv] : 0;

          const headDeg = target
            ? Phaser.Math.RadToDeg(Math.atan2(target.y - y, target.x - x)) : 0;
          /* 冰蓝粒子：follow 本弹发射，speed 沿飞行反方向飘散 */
          const t = (ib.trail && ib.trail[lv]) || null;
          if (t) {
            const spread = t.angleSpread || 0;
            this._trail = scene.add.particles(0, 0, 'ice_dot', {
              speed: { min: (t.speed || 0) * 0.6, max: t.speed || 0 },
              angle: { min: headDeg + 180 - spread / 2, max: headDeg + 180 + spread / 2 },
              /* ice_dot 已 2x 超采样（16px），start scale 减半保持屏显不变 */
              scale: { start: t.scale / 2, end: 0 },
              alpha: { start: t.alpha, end: 0 },
              tint: t.tint, lifespan: t.lifespan,
              frequency: t.frequency, quantity: t.quantity || 1,
              blendMode: 'ADD', follow: this
            }).setDepth(39);
          }
          /* 渐变光带：右端钉在弹心、沿弹尾延伸，随飞行方向偏转 */
          const rb = (ib.ribbon && ib.ribbon[lv]) || null;
          if (rb) {
            this._ribbon = scene.add.image(x, y, 'ice_ribbon')
              .setOrigin(1, 0.5)
              .setScale((rb.length || 16) / 40, (rb.thickness || 3) / 8)
              .setAlpha(rb.alpha != null ? rb.alpha : 0.35)
              .setBlendMode(Phaser.BlendModes.ADD)
              .setDepth(39);
          }
        }
      }
    }

    /* 水元素塔（towerC）：按塔等级换水弹贴图（proj_water_lvN）。
       离线贴图只含水珠/水柱/水球本体，拖尾完全由代码生成——水蓝粒子
       向后飘散 + 一条青蓝渐变光带，强度随等级递增，参数全部读 config
       towerC.projectile.waterBullet（JSON 驱动）。水弹近似径向对称，
       不朝向目标，改为持续轻微自转增加动感。 */
    this.isWater = false;
    this.waterSpin = 0;
    const waterSrcLv = sourceTower && sourceTower.isWater ? sourceTower.level : 0;
    if (waterSrcLv >= 1) {
      const lv = Math.min(waterSrcLv, 3);
      const texKey = 'proj_water_lv' + lv;
      if (window.__waterBulletArt === true && scene.textures.exists(texKey)) {
        const wb = pCfg.waterBullet ||
          (((typeof TD_CONFIG !== 'undefined') && TD_CONFIG.towers.towerC.projectile.waterBullet) || null);
        if (wb) {
          this.isWater = true;
          this.setTexture(texKey);
          /* 最大边等比烘焙（纹素 = bodyDisplay×superSample=54px）：
             setScale = 等级系数 / superSample → 显示 ~16.6/18/19.4px */
          const lvScale = (wb.scale && wb.scale[lv] != null) ? wb.scale[lv] : 1;
          this.setScale(lvScale / (wb.superSample || 3));
          this.waterSpin = (wb.spin && wb.spin[lv] != null) ? wb.spin[lv] : 0;

          const headDeg = target
            ? Phaser.Math.RadToDeg(Math.atan2(target.y - y, target.x - x)) : 0;
          /* 水蓝粒子：follow 本弹发射，speed 沿飞行反方向飘散 */
          const t = (wb.trail && wb.trail[lv]) || null;
          if (t) {
            const spread = t.angleSpread || 0;
            this._trail = scene.add.particles(0, 0, 'water_dot', {
              speed: { min: (t.speed || 0) * 0.6, max: t.speed || 0 },
              angle: { min: headDeg + 180 - spread / 2, max: headDeg + 180 + spread / 2 },
              scale: { start: t.scale, end: 0 },
              alpha: { start: t.alpha, end: 0 },
              tint: t.tint, lifespan: t.lifespan,
              frequency: t.frequency, quantity: t.quantity || 1,
              blendMode: 'ADD', follow: this
            }).setDepth(39);
          }
          /* 渐变光带：右端钉在弹心、沿弹尾延伸，随飞行方向偏转 */
          const rb = (wb.ribbon && wb.ribbon[lv]) || null;
          if (rb) {
            this._ribbon = scene.add.image(x, y, 'water_ribbon')
              .setOrigin(1, 0.5)
              .setScale((rb.length || 16) / 40, (rb.thickness || 3) / 8)
              .setAlpha(rb.alpha != null ? rb.alpha : 0.3)
              .setBlendMode(Phaser.BlendModes.ADD)
              .setDepth(39);
          }
        }
      }
    }

    // 落点（目标活着则每帧刷新）
    this.tx = target.x;
    this.ty = target.y;
    this.done = false;

    this.setDepth(40);
    scene.add.existing(this);
  }

  update(dt) {
    if (this.done) return;

    const scene = this.scene;
    /* 高速防漏增强仅在第 10 关启用；前 9 关 isL10=false，走原逻辑 */
    const isL10 = !!(scene && scene.levelId === 10);

    if (this.target && !this.target.dead) {
      let tx = this.target.x;
      let ty = this.target.y;
      /* 第 10 关：按目标本帧速度预测拦截点。4x / 后期高移速下，
         纯追尾会让子弹永远落后于目标，提前量可保证在目标前方命中。 */
      if (isL10 && this.target._prevX != null && dt > 0) {
        const vx = (tx - this.target._prevX) / dt;
        const vy = (ty - this.target._prevY) / dt;
        const t = Math.min(0.35,
          Math.hypot(tx - this.x, ty - this.y) / Math.max(this.speed, 1));
        let lx = vx * t, ly = vy * t;
        const ll = Math.hypot(lx, ly);
        if (ll > 24) { lx *= 24 / ll; ly *= 24 / ll; }
        tx += lx; ty += ly;
      }
      this.tx = tx;
      this.ty = ty;
    }

    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const dist = Math.hypot(dx, dy);

    /* 第 10 关命中半径加厚：基础 6px + 目标本体半径的 50%（上限 16px）。
       防止极速下目标与弹丸"擦肩而过"被判定为未命中。 */
    let hitDist = 6;
    if (isL10 && this.target) {
      hitDist += Math.min(16, (this.target.radius || 0) * 0.5);
    }

    /* 扫掠碰撞（CCD）第一步：目标本帧从 _prev 移到当前位置，若扫过弹丸
       当前位置，直接判定命中——这是 4x 下防穿透的关键。 */
    if (isL10 && this.target && !this.target.dead && this.target._prevX != null) {
      const d2 = segPointDistSq(this.target._prevX, this.target._prevY,
        this.target.x, this.target.y, this.x, this.y);
      if (d2 <= hitDist * hitDist) {
        this.tx = this.target.x;
        this.ty = this.target.y;
        this.impact();
        return;
      }
    }

    /* 第 10 关：目标速度超过子弹时临时提速（最多 3 倍），保证追得上；
       正常波次目标远慢于子弹，这段不改变原有手感。 */
    let speedNow = this.speed;
    if (isL10 && this.target && !this.target.dead &&
        this.target._prevX != null && dt > 0) {
      const tv = Math.hypot(this.target.x - this.target._prevX,
        this.target.y - this.target._prevY) / dt;
      if (tv > speedNow) speedNow = Math.min(tv * 1.25, this.speed * 3);
    }
    const step = speedNow * dt;

    if (dist <= step + hitDist) {
      this.setPosition(this.tx, this.ty);
      this.impact();
      return;
    }

    const nx = this.x + (dx / dist) * step;
    const ny = this.y + (dy / dist) * step;

    /* 扫掠碰撞（CCD）第二步：弹丸本帧路径与目标本帧路径贴近则命中 */
    if (isL10 && this.target && !this.target.dead && this.target._prevX != null) {
      const d2 = segPointDistSq(this.target._prevX, this.target._prevY,
        this.target.x, this.target.y, nx, ny);
      if (d2 <= hitDist * hitDist) {
        this.tx = this.target.x;
        this.ty = this.target.y;
        this.setPosition(this.target.x, this.target.y);
        this.impact();
        return;
      }
    }

    this.setPosition(nx, ny);
    /* 风刃（spin>0）持续旋转出旋风效果；火焰弹幕沿飞行方向朝向目标（贴图尖端朝右）；
       冰雪花 / 水弹不朝向目标，持续轻微自转，并同步光带朝向与粒子飘散方向 */
    if (this.isIce || this.isWater) {
      this.rotation += (this.isIce ? this.iceSpin : this.waterSpin) * dt;
      const head = Math.atan2(dy, dx);
      if (this._ribbon) {
        this._ribbon.setPosition(this.x, this.y);
        this._ribbon.rotation = head;
      }
      /* 粒子发射角随飞行方向修正到"反方向 ± 张角"（配置 angleSpread）；
         setAngle 的 step 参数按 value±step/2 随机，失败不影响主流程 */
      if (this._trail && typeof this._trail.setAngle === 'function') {
        try {
          const tc = this.isIce ? this.pCfg.iceBullet : this.pCfg.waterBullet;
          const lvt = tc && tc.trail && tc.trail[Math.min((this.sourceTower && this.sourceTower.level) || 1, 3)];
          const spread = lvt ? (lvt.angleSpread || 0) : 0;
          this._trail.setAngle(Phaser.Math.RadToDeg(head) + 180, spread);
        } catch (e) { /* 角度运行时更新失败：保留构造时的发射角 */ }
      }
    } else if (this.spin) this.rotation += this.spin * dt;
    else this.rotation = Math.atan2(dy, dx);
  }

  impact() {
    this.done = true;
    const scene = this.scene;
    /* 火焰弹幕的拖尾/火星粒子随弹幕一并销毁，避免残留 */
    if (this._trail) { this._trail.destroy(); this._trail = null; }
    if (this._sparks) { this._sparks.destroy(); this._sparks = null; }
    if (this._ribbon) { this._ribbon.destroy(); this._ribbon = null; }
    /* 目标互斥：本弹锁定的是障碍物（isObstacle）→ 只结算障碍物；
       锁定的是小怪 → 只结算小怪，绝不伤害障碍物 */
    const vsObstacle = this.target && this.target.isObstacle;

    if (this.effect.type === 'splashSlow') {
      // 范围伤害 + 减速（塔B=冰元素：先附着冰元素并按反应倍率结算本次伤害）
      const r = this.effect.splashRadius;
      scene.spawnSplashFx(this.tx, this.ty, r, this.pCfg.color);
      if (vsObstacle) {
        // 攻击障碍物：只对障碍物结算，范围溅射不波及小怪
        if (!this.target.dead) this.target.takeDamage(this.damage);
      } else {
        scene.enemies.forEach((e) => {
          if (e.dead || e.invulnTimer > 0) return; // 传送无敌中：不受伤也不吃减速
          if (Phaser.Math.Distance.Between(this.tx, this.ty, e.x, e.y) <= r + e.radius) {
            /* 第 7 关元素护盾：同元素免疫时整次命中跳过（不附着/不伤血/
               不计有效次数/不减速），由命中特效统一表现“打在罩子上” */
            const el = this.pCfg.element || null;
            if (el && typeof e.shieldBlocks === 'function' && e.shieldBlocks(el)) return;
            let mul = 1;
            /* 冰元素附着（第6关起参与反应，倍率“谁先触发谁享受”归塔B本次溅射） */
            if (el && typeof e.attachElement === 'function') {
              mul = e.attachElement(el, null, el).reactionMul || 1;
            }
            e.takeDamage(this.damage * mul, el);
            /* 减速（不设减速上限，只保"移速不为负"的安全下限 0）：
               小怪按【塔等级】取 slowFactorByLevel（1级 30% / 2级 40% / 3级 50%）；
               BOSS/BossMini 免疫冰冻（不能定身），仅【达到 bossSlow.minLevel 的冰塔】
               改用专项固定数值（默认 3 级及以上 = 65%），未达等级仍走普通小怪逻辑。 */
            const eff = this.effect;
            const lv = Math.min(3, Math.max(1, (this.sourceTower && this.sourceTower.level) || 1));
            const byLv = eff.slowFactorByLevel;
            let sf = (byLv && byLv[lv] != null) ? byLv[lv]
              : (eff.slowFactor != null ? eff.slowFactor : 1);
            let sd = eff.slowDuration;
            const bs = eff.bossSlow;
            if (((e.cfg && e.cfg.boss) || e.bossMini) && bs && bs.factor != null &&
                lv >= (bs.minLevel != null ? bs.minLevel : 3)) {
              sf = bs.factor;
              if (bs.duration != null) sd = bs.duration;
            }
            if (!e.dead) e.applySlow(Math.max(0, sf), sd, el);
            /* 第 10 关冰塔解封：Lv4 冰塔命中 BOSS 时可强冻 1 秒，
               每座塔 5 秒 CD（独立计时）；BOSS 的普通冰冻免疫不拦截此强冻 */
            const sealIce = (scene && typeof scene.getSealCfg === 'function')
              ? scene.getSealCfg('towerB') : null;
            const srcLv = (this.sourceTower && this.sourceTower.level) || 1;
            if (sealIce && srcLv >= 4 && !e.dead &&
                ((e.cfg && e.cfg.boss) || e.bossMini) &&
                typeof e.applyBossFreeze === 'function') {
              const tw = this.sourceTower;
              const now = (scene.time && scene.time.now) || 0;
              if (tw && now >= (tw._sealIceFreezeNext || 0)) {
                e.applyBossFreeze((sealIce.bossFreezeDuration != null)
                  ? sealIce.bossFreezeDuration : 1);
                tw._sealIceFreezeNext = now +
                  ((sealIce.bossFreezeCooldown != null) ? sealIce.bossFreezeCooldown : 5) * 1000;
              }
            }
          }
        });
      }
    } else if (this.effect.type === 'windSpread') {
      /* 风元素塔风刃：少量伤害；目标带元素且本塔扩散冷却就绪 → 以目标
         为中心扩散元素（GameScene.spreadElement）；目标无元素则不扩散。
         风塔自身不附着风元素，扩散附着 sourceEl=null（不享受反应倍率） */
      if (this.target && !this.target.dead) {
        this.target.takeDamage(this.damage);
        scene.spawnHitFx(this.tx, this.ty, this.pCfg.color);
        if (!vsObstacle) {
          const tower = this.sourceTower;
          const behavior = tower && tower.behavior;
          const spreadEff = (tower && tower.cfg.effect) || {};
          const hasEl = this.target.reactionsEnabled
            ? this.target.hasElement()                                  // 新反应模式：多元素槽
            : (this.target.element && this.target.elementTimer > 0);    // 旧印记模式（1~5关）
          if (behavior && typeof behavior.tryConsumeSpread === 'function' &&
              hasEl && behavior.tryConsumeSpread()) {
            scene.spreadElement(this.target, spreadEff);
          }
        }
      }
    } else {
      // 单体伤害：目标仍存活才结算（小怪 / 障碍物通用 takeDamage 鸭子类型）
      if (this.target && !this.target.dead) {
        /* 第 7 关元素护盾：同元素命中在附着之前整体跳过（不伤血/不附着/
           不计有效次数）；障碍物无 shieldBlocks，鸭子类型自动放行 */
        const el = this.pCfg.element || null;
        const blocked = !vsObstacle && el &&
          typeof this.target.shieldBlocks === 'function' &&
          this.target.shieldBlocks(el);
        if (!blocked) {
          /* 先附着元素并结算反应：倍率“谁先触发谁享受”，只加倍塔A(火)/塔C(水)
             本次命中的伤害；第1~5关 attachElement 退化为旧视觉印记，倍率恒1 */
          let mul = 1;
          if (!vsObstacle && el &&
              typeof this.target.attachElement === 'function') {
            mul = this.target.attachElement(el, null, el).reactionMul || 1;
          }
          this.target.takeDamage(this.damage * mul, vsObstacle ? null : el);
        }
        scene.spawnHitFx(this.tx, this.ty, this.pCfg.color);
      }
    }
    this.destroy();
  }
}
