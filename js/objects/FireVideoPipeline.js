/* ============================================================
 * FireVideoPipeline.js —— 火塔燃烧视频专用渲染管线（WebGL）
 *
 * 两条管线（参数全部来自 config.js 的 towers.towerA.fireVideo，
 *  本文件加载时 TD_CONFIG 已就绪；读取异常用内置默认值兜底）：
 *
 * A. FireVideoPipeline（'FireVideo'，黑底亮度键，lv2 用）
 *    旧方案黑底+ADD 会在绿色/土黄地面上把橙红外焰加成纯金黄色。
 *    片元把黑底亮度换算成真 alpha，NORMAL 混合，火焰 rgb 原色保留：
 *      alpha = clamp(亮度 × gain − floor, 0, 1)
 *
 * B. FireVideoGKPipeline（'FireVideoGK'，绿幕色度键，lv1/lv3 用）
 *    新视频是亮绿幕（lv1≈#3EFF6D、lv3≈#29FF30，H.264 无 alpha）。
 *    用 green-excess = g − max(r,b) 区分绿幕与火焰：
 *      - 绿幕像素 excess≈0.55~0.89；火焰像素 r≥g，excess≤0；
 *      - alpha = 1 − smoothstep(low, high, excess)，区间内抗锯齿；
 *      - despill：g 压到不超过 max(r,b)+spill，消除轮廓绿晕；
 *    NORMAL 混合，背景完全透明，无绿方块/绿边/半透明残留。
 *
 * C. FireVideoWKPipeline（'FireVideoWK'，白幕色度键，备用）
 *    白底视频（纯白或白+浅色渐变）用 whiteness = min(r,g,b) 区分：
 *      - 白背景 min≈0.75~1.0；火焰饱和色 min 低（亮黄内焰≈0.45）；
 *      - alpha = 1 − smoothstep(low, high, whiteness)。
 *
 * 背景类型由 FireBurn 读视频边缘像素自动判定（white/green/black）；
 * Canvas 渲染器 / 管线缺失时：黑底由 Tower 端回退 ADD，绿幕/白幕
 * 保持静态贴图兜底（ADD 会把亮色背景直接叠成色块/白框）。
 * ============================================================ */
(function () {
  const CFG = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.towers &&
    TD_CONFIG.towers.towerA && TD_CONFIG.towers.towerA.fireVideo) || {};
  const BK = CFG.blackKey || { gain: 1.5, floor: 0.01 };
  const GK = CFG.greenKey || { low: 0.1, high: 0.42, spill: 0.03 };
  const WK = CFG.whiteKey || { low: 0.55, high: 0.74 };
  const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const BLACK_GAIN = n(BK.gain, 1.5);
  const BLACK_FLOOR = n(BK.floor, 0.01);
  const GK_LOW = n(GK.low, 0.1);
  const GK_HIGH = Math.max(n(GK.high, 0.42), GK_LOW + 0.001);
  const GK_SPILL = n(GK.spill, 0.03);
  const WK_LOW = n(WK.low, 0.55);
  const WK_HIGH = Math.max(n(WK.high, 0.74), WK_LOW + 0.001);

  /* 风塔龙卷风专用绿幕参数（TD_CONFIG.towers.towerF.windVideo.greenKey）：
     与火塔 greenKey 分开，互不影响。实测龙卷风本体 green-excess ≤0.24、
     绿幕背景及混色环 ≥0.62，转折区 0.28/0.58 正好落在两者之间的空档里
     —— 主体（含气流弧/水珠）零残缺、背景零残留。缺失时回退火塔绿幕参数。 */
  const WCFG = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.towers &&
    TD_CONFIG.towers.towerF && TD_CONFIG.towers.towerF.windVideo) || {};
  const WGK = WCFG.greenKey || GK;
  const WGK_LOW = n(WGK.low, GK_LOW);
  const WGK_HIGH = Math.max(n(WGK.high, GK_HIGH), WGK_LOW + 0.001);
  const WGK_SPILL = n(WGK.spill, GK_SPILL);

  /* 史莱姆小怪专用背景色距离键（TD_CONFIG.enemies.slimeVideo）：
     视频背景为纯亮绿 RGB(50.7,228.7,57.8)，但与「绿色快怪」本体颜色较近，
     不能用 green-excess 键（绿怪本体 green-excess 与绿幕重叠 → 会被一起抠缺）。
     改用【到背景色的 L1 距离】：实测背景 d≈0，快/慢怪本体 d≥0.14，
     空档 0.06/0.13 —— 主体（含深色描边）零残缺、背景零残留。 */
  const SCFG = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.enemies &&
    TD_CONFIG.enemies.slimeVideo) || {};
  const SBG = SCFG.bg || { r: 50.7, g: 228.7, b: 57.8 };
  const SK = SCFG.key || { low: 0.06, high: 0.13 };
  const SBG_R = n(SBG.r, 50.7) / 255.0;
  const SBG_G = n(SBG.g, 228.7) / 255.0;
  const SBG_B = n(SBG.b, 57.8) / 255.0;
  const SK_LOW = n(SK.low, 0.06);
  const SK_HIGH = Math.max(n(SK.high, 0.13), SK_LOW + 0.001);

  const PRECISION = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform sampler2D uMainSampler;',
    'varying vec2 outTexCoord;',
    'varying float outTintEffect;',
    'varying vec4 outTint;'
  ].join('\n');

  /* A. 黑底亮度键 */
  const FIRE_VIDEO_FS = PRECISION + '\n' + [
    'void main ()',
    '{',
    '    vec4 tex = texture2D(uMainSampler, outTexCoord);',
    '    float lum = max(max(tex.r, tex.g), tex.b);',
    '    float a = clamp(lum * ' + BLACK_GAIN.toFixed(3) + ' - ' + BLACK_FLOOR.toFixed(3) + ', 0.0, 1.0);',
    '    vec3 rgb = tex.rgb * outTint.bgr;',
    '    if (outTintEffect == 2.0) {',
    '        gl_FragColor = vec4(outTint.bgr, a * outTint.a);',
    '    } else {',
    '        gl_FragColor = vec4(rgb, a * outTint.a);',
    '    }',
    '}'
  ].join('\n');

  /* B. 绿幕色度键 */
  const FIRE_VIDEO_GK_FS = PRECISION + '\n' + [
    'void main ()',
    '{',
    '    vec4 tex = texture2D(uMainSampler, outTexCoord);',
    '    /* green-excess：绿幕正值很大，火焰 r>=g 恒<=0 */',
    '    float ex = tex.g - max(tex.r, tex.b);',
    '    float a = 1.0 - smoothstep(' + GK_LOW.toFixed(3) + ', ' + GK_HIGH.toFixed(3) + ', ex);',
    '    /* despill 去绿晕：绿色不允许超过红/蓝最大值 + spill 容忍量 */',
    '    float g2 = min(tex.g, max(tex.r, tex.b) + ' + GK_SPILL.toFixed(3) + ');',
    '    vec3 rgb = vec3(tex.r, g2, tex.b) * outTint.bgr;',
    '    if (outTintEffect == 2.0) {',
    '        gl_FragColor = vec4(outTint.bgr, a * outTint.a);',
    '    } else {',
    '        gl_FragColor = vec4(rgb, a * outTint.a);',
    '    }',
    '}'
  ].join('\n');

  /* D. 风塔专用绿幕色度键（预乘 alpha 输出）。
     与 B 的差别：① 输出颜色预乘 alpha；② 阈值用风塔专用参数 WGK_*
     （见上方 WCFG，实测空档 0.28/0.58，主体零残缺、背景零残留）。
     Phaser 默认 premultipliedAlpha=true → blendFunc = (ONE, ONE_MINUS_SRC_ALPHA)；
     shader 若输出非预乘颜色，alpha=0 的背景像素其 rgb 仍会被加到画面上
     （实测绿幕泄漏：地图绿 131,206,87 → 164,247,104）。把 rgb 乘 alpha
     后，alpha=0 的像素贡献为 0，绿幕完全透明、无绿边。 */
  const WIND_VIDEO_GK_FS = PRECISION + '\n' + [
    'void main ()',
    '{',
    '    vec4 tex = texture2D(uMainSampler, outTexCoord);',
    '    float ex = tex.g - max(tex.r, tex.b);',
    '    float a = 1.0 - smoothstep(' + WGK_LOW.toFixed(3) + ', ' + WGK_HIGH.toFixed(3) + ', ex);',
    '    float g2 = min(tex.g, max(tex.r, tex.b) + ' + WGK_SPILL.toFixed(3) + ');',
    '    vec3 rgb = vec3(tex.r, g2, tex.b) * outTint.bgr;',
    '    float A = a * outTint.a;',
    '    if (outTintEffect == 2.0) {',
    '        gl_FragColor = vec4(outTint.bgr * A, A);',
    '    } else {',
    '        gl_FragColor = vec4(rgb * A, A);',
    '    }',
    '}'
  ].join('\n');

  /* E. 史莱姆小怪专用背景色距离键（预乘 alpha 输出）。
     与 B/D 不同：键参数来自【到实测背景色的 L1 距离】，而非绿通道超出量
     ——「绿色快怪」本体 green-excess 与绿幕接近，用 D 会把主体一起抠缺。
     alpha = smoothstep(low, high, d)，d = (|Δr|+|Δg|+|Δb|)/3：
     背景 d≈0 → 全透明；主体（含深色描边）d≥0.14 → 全不透明；边缘平滑过渡。
     不做 despill：绿怪本体绿通道本就很高，压绿会改色。 */
  const SLIME_VIDEO_FS = PRECISION + '\n' + [
    'void main ()',
    '{',
    '    vec4 tex = texture2D(uMainSampler, outTexCoord);',
    '    float d = (abs(tex.r - ' + SBG_R.toFixed(4) + ') + abs(tex.g - ' + SBG_G.toFixed(4) + ') + abs(tex.b - ' + SBG_B.toFixed(4) + ')) / 3.0;',
    '    float a = smoothstep(' + SK_LOW.toFixed(3) + ', ' + SK_HIGH.toFixed(3) + ', d);',
    '    vec3 rgb = tex.rgb * outTint.bgr;',
    '    float A = a * outTint.a;',
    '    if (outTintEffect == 2.0) {',
    '        gl_FragColor = vec4(outTint.bgr * A, A);',
    '    } else {',
    '        gl_FragColor = vec4(rgb * A, A);',
    '    }',
    '}'
  ].join('\n');

  /* C. 白幕色度键 */
  const FIRE_VIDEO_WK_FS = PRECISION + '\n' + [
    'void main ()',
    '{',
    '    vec4 tex = texture2D(uMainSampler, outTexCoord);',
    '    /* whiteness：白背景 min(r,g,b) 接近 1，饱和火焰颜色偏低 */',
    '    float wh = min(min(tex.r, tex.g), tex.b);',
    '    float a = 1.0 - smoothstep(' + WK_LOW.toFixed(3) + ', ' + WK_HIGH.toFixed(3) + ', wh);',
    '    vec3 rgb = tex.rgb * outTint.bgr;',
    '    if (outTintEffect == 2.0) {',
    '        gl_FragColor = vec4(outTint.bgr, a * outTint.a);',
    '    } else {',
    '        gl_FragColor = vec4(rgb, a * outTint.a);',
    '    }',
    '}'
  ].join('\n');

  class FireVideoPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
    constructor(game) {
      super({ game, fragShader: FIRE_VIDEO_FS });
    }
  }
  class FireVideoGKPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
    constructor(game) {
      super({ game, fragShader: FIRE_VIDEO_GK_FS });
    }
  }
  class FireVideoWKPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
    constructor(game) {
      super({ game, fragShader: FIRE_VIDEO_WK_FS });
    }
  }
  /* 风塔专用（预乘输出，见 D 段说明） */
  class WindVideoGKPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
    constructor(game) {
      super({ game, fragShader: WIND_VIDEO_GK_FS });
    }
  }
  /* 史莱姆小怪专用（背景色距离键 + 预乘输出，见 E 段说明） */
  class SlimeVideoGKPipeline extends Phaser.Renderer.WebGL.Pipelines.SinglePipeline {
    constructor(game) {
      super({ game, fragShader: SLIME_VIDEO_FS });
    }
  }

  /* 供 Tower 端判断某条管线是否已在当前渲染器注册（WebGL） */
  function fireVideoPipelineReady(scene, name) {
    try {
      const r = scene && scene.game && scene.game.renderer;
      return !!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer &&
        r.pipelines && r.pipelines.has && r.pipelines.has(name || 'FireVideo'));
    } catch (e) { return false; }
  }

  window.FireVideoPipeline = FireVideoPipeline;
  window.FireVideoGKPipeline = FireVideoGKPipeline;
  window.FireVideoWKPipeline = FireVideoWKPipeline;
  window.WindVideoGKPipeline = WindVideoGKPipeline;
  window.SlimeVideoGKPipeline = SlimeVideoGKPipeline;
  window.fireVideoPipelineReady = fireVideoPipelineReady;
})();
