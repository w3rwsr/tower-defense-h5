/* ============================================================
 * FireVideoPipeline.js —— 火塔燃烧视频专用渲染管线（WebGL）
 *
 * 为什么不用 ADD 混合：
 *   素材是黑底 H.264 MP4（H.264 无 alpha 通道，iOS 也不支持 WebM alpha）。
 *   旧方案黑底+ADD 让黑色"加 0"等效透明，但在绿色/土黄色游戏地面上，
 *   火焰颜色会与背景【相加】变色：外焰橙红(255,93,26)+绿草(124,194,78)
 *   =(255,255,104) 纯黄——三层火焰被加成一片金黄色。
 *
 * 本管线在 GPU 片元阶段把黑底亮度换算成真正的 alpha，再用 NORMAL
 * （SRC_ALPHA / ONE_MINUS_SRC_ALPHA）混合：
 *   - 黑底（亮度≈0）→ alpha=0，完全透明，无残留色块；
 *   - 火焰像素 rgb 原样输出，橙红/橙黄/亮黄三层颜色不被背景改写；
 *   - 暗部线性增益保留外焰橙红边缘，极低亮度（压缩黑底噪点）清零。
 *
 * 只作用于火塔视频 Image；Canvas 渲染器 / 管线缺失时 Tower 端自动
 * 回退旧的 ADD 方案，游戏功能不受影响。
 * ============================================================ */
const FIRE_VIDEO_FS = [
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  '#else',
  'precision mediump float;',
  '#endif',
  'uniform sampler2D uMainSampler;',
  'varying vec2 outTexCoord;',
  'varying float outTintEffect;',
  'varying vec4 outTint;',
  'void main ()',
  '{',
  '    vec4 tex = texture2D(uMainSampler, outTexCoord);',
  '    /* 黑底抠像：取 RGB 最大通道作亮度，1.5 增益让外焰暗橙边缘不被吃掉，',
  '       再减掉 1% 底噪（H.264 黑场上的压缩杂色），clamp 到 0~1 */',
  '    float lum = max(max(tex.r, tex.g), tex.b);',
  '    float a = clamp(lum * 1.5 - 0.01, 0.0, 1.0);',
  '    /* rgb 原色保留，仅乘对象 tint（火塔恒为白 tint=不改色）；',
  '       tintFill（effect==2）时退化为纯色，保持与内置管线一致 */',
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

/* 供 Tower 端判断当前渲染器是否支持本管线（WebGL + 已注册） */
function fireVideoPipelineReady(scene) {
  try {
    const r = scene && scene.game && scene.game.renderer;
    return !!(r instanceof Phaser.Renderer.WebGL.WebGLRenderer &&
      r.pipelines && r.pipelines.has && r.pipelines.has('FireVideo'));
  } catch (e) { return false; }
}
