/* ============================================================
 * AudioFx.js —— 全局程序音效（Web Audio API，无需外部音频文件）
 *
 * 设计要点：
 * 1. 首次用户手势后解锁 AudioContext（浏览器/WebView 自动播放策略）；
 * 2. 同类音效 0.1 秒内只播一次：高倍速满屏雷塔同时开火也不会叠成爆音；
 * 3. 主总线挂 DynamicsCompressor + 低音量 master，限制瞬时峰值；
 * 4. 同时发声数上限 24，超出直接跳过，保护低端机音频线程；
 * 5. 全部用振荡器 + 噪声程序合成：开火 / 击杀 / 金币 / BOSS 出场 /
 *    BOSS 死亡 / 自爆 / 买血，零音频资源依赖。
 *
 * 对外 API：window.TDAudio.play(name, variant)
 *   name: 'fire' | 'kill' | 'gold' | 'bossSpawn' | 'bossDeath' |
 *         'explode' | 'buy'
 * ============================================================ */
const TDAudio = (() => {
  'use strict';

  const GAP_MS = 100;          // 同类音效最小间隔（需求：0.1 秒）
  const MAX_VOICES = 24;       // 同时发声上限，超出跳过
  const MASTER_GAIN = 0.22;    // 总音量（配合压缩器，留足动态余量）

  const api = {
    ready: false,
    unlocked: false,
    stats: { played: 0, throttled: 0, skipped: 0 }
  };

  const lastPlay = {};
  let ctx = null;
  let comp = null;
  let master = null;
  let unlocked = false;
  let voices = 0;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      comp.connect(master);
      master.connect(ctx.destination);
      api.ready = true;
    } catch (e) {
      ctx = null; comp = null; master = null;
    }
    return ctx;
  }

  function unlock() {
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') {
      try {
        const p = c.resume();
        if (p && p.catch) p.catch(() => { /* 未解锁：等下一次手势 */ });
      } catch (e) { /* 静默 */ }
    }
    unlocked = true;
    api.unlocked = true;
  }
  api.unlock = unlock;

  /* 首次任意手势解锁（pointer/touch/mouse/key 全兼容） */
  ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach((ev) => {
    try {
      window.addEventListener(ev, unlock, { once: true, passive: true, capture: true });
    } catch (e) { /* 旧内核忽略 */ }
  });

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function canPlay(name) {
    const now = nowMs();
    if (now - (lastPlay[name] || 0) < GAP_MS) {
      api.stats.throttled++;
      return false;
    }
    if (voices >= MAX_VOICES) {
      api.stats.skipped++;
      return false;
    }
    lastPlay[name] = now;
    return true;
  }

  /* 单音：频率可滑动，短促包络（避免 click） */
  function tone(freq, toFreq, dur, type, gain, delay) {
    const c = ensureCtx();
    if (!c || !comp) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (toFreq != null) {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), t0 + Math.min(0.012, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(comp);
    voices++;
    o.onended = () => {
      voices = Math.max(0, voices - 1);
      try { o.disconnect(); g.disconnect(); } catch (e) {}
    };
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /* 噪声：用于爆炸/开火气流/冲击 */
  function noise(dur, freq, gain, delay, filterType) {
    const c = ensureCtx();
    if (!c || !comp) return;
    const t0 = c.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = filterType || 'bandpass';
    f.frequency.value = freq || 800;
    f.Q.value = 1.1;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(comp);
    voices++;
    src.onended = () => {
      voices = Math.max(0, voices - 1);
      try { src.disconnect(); f.disconnect(); g.disconnect(); } catch (e) {}
    };
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 播放音效；同一 name 在 0.1 秒内只响一次 */
  api.play = function (name, variant) {
    if (!name) return false;
    const c = ensureCtx();
    if (!c) return false;
    if (c.state === 'suspended') {
      /* 手势已发生时 resume 会生效；未解锁时下面 canPlay 仍会节流，
         但不会抛错。首次手势监听器会再次解锁。 */
      try {
        const p = c.resume();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }
    if (!canPlay(name)) return false;
    api.stats.played++;

    switch (name) {
      case 'fire': {
        const v = String(variant || '');
        if (v === 'towerB') {
          tone(880, 1320, 0.07, 'sine', 0.10);
          noise(0.04, 3000, 0.05, 0, 'highpass');
        } else if (v === 'towerC') {
          tone(420, 210, 0.09, 'triangle', 0.12);
          noise(0.05, 1200, 0.05);
        } else if (v === 'towerE') {
          tone(1300, 240, 0.06, 'square', 0.07);
          noise(0.05, 2200, 0.08, 0, 'highpass');
        } else if (v === 'towerF') {
          noise(0.10, 900, 0.09, 0, 'bandpass');
          tone(260, 520, 0.08, 'sine', 0.05);
        } else {
          tone(240, 90, 0.08, 'sawtooth', 0.10);
          noise(0.04, 700, 0.05);
        }
        break;
      }
      case 'kill':
        tone(420, 120, 0.12, 'triangle', 0.12);
        noise(0.05, 900, 0.06);
        break;
      case 'gold':
        tone(1180, 1180, 0.055, 'sine', 0.09);
        tone(1760, 1760, 0.07, 'sine', 0.07, 0.055);
        break;
      case 'bossSpawn':
        tone(90, 55, 0.45, 'sawtooth', 0.16);
        noise(0.35, 180, 0.10, 0, 'lowpass');
        break;
      case 'bossDeath':
        noise(0.45, 220, 0.20, 0, 'lowpass');
        tone(70, 32, 0.55, 'sine', 0.18);
        tone(140, 60, 0.25, 'sawtooth', 0.08);
        break;
      case 'explode':
        noise(0.28, 300, 0.20, 0, 'lowpass');
        tone(110, 40, 0.30, 'sine', 0.15);
        break;
      case 'buy':
        tone(700, 1400, 0.08, 'sine', 0.08);
        break;
      default:
        tone(300, 150, 0.08, 'square', 0.08);
    }
    return true;
  };

  api.enterScene = function () { /* 限流表跨场景保留，防止切换瞬间重复音效 */ };
  api.debug = function () {
    return {
      ready: api.ready, unlocked: unlocked,
      played: api.stats.played, throttled: api.stats.throttled,
      skipped: api.stats.skipped, voices: voices
    };
  };

  return api;
})();
window.TDAudio = TDAudio;
