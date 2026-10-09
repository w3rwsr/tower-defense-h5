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
 * Canvas 渲染器 / 管线缺失时：黑底由 Tower 端回退 ADD；绿幕无法
 * 用 ADD（会显亮绿块），Tower 端保持静态贴图兜底，不显示视频层。
 * ============================================================ */
(function () {
  const CFG = (typeof TD_CONFIG !== 'undefined' && TD_CONFIG.towers &&
    TD_CONFIG.towers.towerA && TD_CONFIG.towers.towerA.fireVideo) || {};
  const BK = CFG.blackKey || { gain: 1.5, floor: 0.01 };
  const GK = CFG.greenKey || { low: 0.1, high: 0.42, spill: 0.03 };
  const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const BLACK_GAIN = n(BK.gain, 1.5);
  const BLACK_FLOOR = n(BK.floor, 0.01);
  const GK_LOW = n(GK.low, 0.1);
  const GK_HIGH = Math.max(n(GK.high, 0.42), GK_LOW + 0.001);
  const GK_SPILL = n(GK.spill, 0.03);

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
  window.fireVideoPipelineReady = fireVideoPipelineReady;
})();
