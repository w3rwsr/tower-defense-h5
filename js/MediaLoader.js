/* ============================================================
 * MediaLoader.js —— 媒体加载统一调度（移动端加载性能优化）
 *
 * 解决的四个问题（全部为"尽力而为"的增强，任何一步失败都静默降级，
 * 不改动任何玩法逻辑、不影响电脑端）：
 *
 * 1) 视频"一哄而上"：风塔 / 史莱姆 / BOSS 运动视频 + 三个 BOSS 死亡视频
 *    原先各自在 init / prewarm 时立即 src + preload=auto，手机上最多 6 个
 *    视频同时抢带宽、同时解码首帧 → 带宽 + 内存 + 解码器三重过载，界面卡顿。
 *    现在统一进【串行队列】：一次只下载 1 个，下载完再下一个。
 *
 * 2) 没有进度：提供 DOM 进度条（百分比 + 文案），玩家看得见在加载什么。
 *
 * 3) 没有超时：单项 10 秒未就绪即跳过（回调 onFail），媒体模块照旧走
 *    静态贴图 / 静态降级路径，绝不卡死、绝不黑屏；并给一次轻提示。
 *
 * 4) 没有缓存：http(s) 环境用 Cache Storage 落盘缓存【已完整缓冲过】的视频，
 *    第二次进入直接读缓存（blob URL），不再重复从网络下载。
 *    file:// 下 fetch 被跨域策略禁用 → 自动跳过缓存层，行为与旧版一致。
 *
 * 用法（媒体模块内）：
 *   TDMedia.loadVideo(videoEl, url, { fillCache: true, onFail: () => {} });
 *   TDMedia.beginGroup('加载本关资源');   // 需要进度条时，进关前调用
 * ============================================================ */
const TDMedia = (function () {
  'use strict';

  const VER = '20261018a';
  const CACHE_NAME = 'td-media-' + VER;
  const ITEM_TIMEOUT = 10000;      // 单个媒体超时（ms）：超时即跳过，走降级
  const GROUP_TIMEOUT = 10000;     // 整组加载超时（ms）：到点强制放行（允许进入游戏）
  const IDLE_GRACE = 2000;         // 零任务看门狗（ms）：组内迟迟无任务入队即收起进度条
  const OVERLAY_MIN_MS = 300;      // 进度条最短展示时长，避免一闪而过

  /* 缓存层可用性检测：http(s) + Cache API + fetch。
     file:// 下 fetch/XHR 被 Chromium 跨域策略禁用 → 这里恒为 false。 */
  const canCache = (function () {
    try {
      return (location.protocol === 'http:' || location.protocol === 'https:') &&
        typeof window.caches !== 'undefined' && typeof window.fetch === 'function';
    } catch (e) { return false; }
  })();

  const api = {
    canCache: canCache,
    /* 已解析过的 url → blob URL（缓存命中后同会话复用，避免重复读缓存） */
    _blob: {},
    /* 已尝试回填缓存的 url（每会话每 url 只回填一次） */
    _filled: {},
    _queue: [],
    _running: false,
    _stats: { done: 0, fail: 0, skipped: 0, cachedHit: 0 }
  };

  /* ---------------- 进度组（进度条 UI） ---------------- */
  const group = {
    active: false, shown: false, label: '', total: 0, done: 0, fail: 0,
    shownAt: 0, capTimer: null, hideTimer: null, idleTimer: null
  };
  let overlay = null, barFill = null, textEl = null;
  let toastEl = null, toastTimer = null;

  function ensureOverlay() {
    if (overlay || !document || !document.body) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'td-media-loading';
    /* 内联样式：不依赖 style.css，避免与既有样式冲突；
       pointer-events:none —— 进度条绝不吞掉任何触摸/点击（玩法零影响） */
    overlay.style.cssText = 'position:fixed;left:0;right:0;top:0;bottom:0;z-index:9998;' +
      'display:none;flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(18,30,10,0.42);pointer-events:none;' +
      'font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#fff;';
    const box = document.createElement('div');
    box.style.cssText = 'min-width:280px;padding:18px 22px;border-radius:14px;' +
      'background:rgba(0,0,0,0.55);text-align:center;';
    textEl = document.createElement('div');
    textEl.style.cssText = 'font-size:15px;font-weight:bold;margin-bottom:10px;' +
      'text-shadow:0 2px 0 rgba(0,0,0,0.45);';
    const bar = document.createElement('div');
    bar.style.cssText = 'height:10px;border-radius:6px;background:rgba(255,255,255,0.22);overflow:hidden;';
    barFill = document.createElement('i');
    barFill.style.cssText = 'display:block;height:100%;width:0%;border-radius:6px;' +
      'background:linear-gradient(90deg,#ffd24a,#ff8f3c);transition:width 0.18s linear;';
    bar.appendChild(barFill);
    box.appendChild(textEl);
    box.appendChild(bar);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return overlay;
  }

  function renderGroup() {
    if (!group.active || !group.shown || !overlay) return;
    const settled = group.done + group.fail;
    const pct = group.total ? Math.min(100, Math.round(settled / group.total * 100)) : 0;
    barFill.style.width = pct + '%';
    textEl.textContent = group.label + ' ' + pct + '%';
  }

  /* 【懒显示】真正有媒体入队时才显示进度条。
     这样“再次游玩”时若资源已在内存/纹理管理器里（没有任何任务入队），
     进度条根本不会出现——既不会闪出 0% 假加载页，也不会把进度重置为 0。
     首次进关时首个媒体通常在 0.8~1.4s 内入队，进度条随即显示，观感不变。 */
  function showGroup() {
    if (!group.active || group.shown) return;
    group.shown = true;
    group.shownAt = Date.now();
    ensureOverlay();
    if (overlay) overlay.style.display = 'flex';
    renderGroup();
  }

  /** 开始一个进度组（有媒体入队时才显示进度条）。进关时调用。 */
  api.beginGroup = function (label) {
    group.active = true;
    group.shown = false;                 // 先不显示：等首个媒体入队（见 showGroup）
    group.label = label || '加载中';
    group.total = group.done = group.fail = 0;
    group.shownAt = 0;
    ensureOverlay();
    if (overlay) overlay.style.display = 'none';
    /* 整组硬超时：到点无论是否加载完都放行（隐藏进度条，绝不卡住玩家） */
    clearTimeout(group.capTimer);
    group.capTimer = setTimeout(() => api.endGroup(true), GROUP_TIMEOUT);
    /* 零任务看门狗：宽限期内始终没有媒体入队 → 直接结束本组，绝不显示“0%”。 */
    clearTimeout(group.idleTimer);
    group.idleTimer = setTimeout(() => {
      if (group.active && group.total === 0) api.endGroup(true);
    }, IDLE_GRACE);
  }

  /** 结束进度组：清进度条；failed>0 时给一次轻提示 */
  api.endGroup = function (force) {
    if (!group.active) return;
    group.active = false;
    group.shown = false;
    clearTimeout(group.capTimer);
    clearTimeout(group.idleTimer);
    clearTimeout(group.hideTimer);
    const failed = group.fail;
    const wait = force ? 0 : Math.max(0, OVERLAY_MIN_MS - (Date.now() - group.shownAt));
    group.hideTimer = setTimeout(() => {
      if (group.active || !overlay) return;
      overlay.style.display = 'none';
      if (failed > 0) api.toast('部分素材加载失败，已自动跳过');
    }, wait);
  };

  /** 轻提示（自动消失，pointer-events:none，不遮挡操作） */
  api.toast = function (msg) {
    try {
      if (!document || !document.body) return;
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.style.cssText = 'position:fixed;left:50%;bottom:12%;transform:translateX(-50%);' +
          'z-index:9997;padding:8px 16px;border-radius:10px;background:rgba(0,0,0,0.62);' +
          'color:#fff;font-size:14px;pointer-events:none;display:none;' +
          'font-family:"PingFang SC","Microsoft YaHei",sans-serif;';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.display = 'block';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { if (toastEl) toastEl.style.display = 'none'; }, 2600);
    } catch (e) { /* 提示失败不影响游戏 */ }
  };

  /* ---------------- 缓存层 ---------------- */

  /* 解析最终 src：命中 Cache Storage → blob URL（离线/秒开）；否则用原始 URL。
     任何异常都回退原始 URL，绝不阻断加载。 */
  function resolveSrc(url) {
    if (!canCache || api._blob[url]) return Promise.resolve(api._blob[url] || url);
    try {
      return caches.open(CACHE_NAME).then((c) => c.match(url)).then((res) => {
        if (!res) return url;
        return res.blob().then((b) => {
          const u = URL.createObjectURL(b);
          api._blob[url] = u;
          api._stats.cachedHit++;
          return u;
        });
      }).catch(() => url);
    } catch (e) { return Promise.resolve(url); }
  }

  /* 缓存回填：媒体【完整缓冲】后调用，把浏览器 HTTP 缓存里已有的响应
     抄进 Cache Storage，供下次进入游戏秒开。
     必须用 only-if-cached（只用 HTTP 缓存、绝不联网）：缓存里有完整 200
     才写入；没有 / 只有分段(206) 就直接放弃并复位标记，等后续事件再试。
     这样【首次进入绝不产生额外流量】（不会为了写缓存而重复下载一次）。 */
  function fillCache(el, url) {
    if (!canCache || api._filled[url]) return;
    try {
      const b = el.buffered;
      const dur = el.duration;
      const full = !!(b && b.length && dur && isFinite(dur) && b.end(b.length - 1) >= dur - 0.15);
      if (!full) return;                 // 未完整缓冲：等后续 progress/canplay 再试
      api._filled[url] = true;
      fetch(url, { cache: 'only-if-cached', mode: 'same-origin' }).then((r) => {
        if (!r || !r.ok || r.status !== 200) { api._filled[url] = false; return null; }
        return caches.open(CACHE_NAME).then((c) => c.put(url, r));
      }).catch(() => { api._filled[url] = false; /* 未进 HTTP 缓存：下次再试 */ });
    } catch (e) { api._filled[url] = false; }
  }

  /* ---------------- 串行队列 ---------------- */

  /** 把一个 video 元素排进串行加载队列（一次只下载 1 个媒体）。
      opts: { onReady, onFail, fillCache } */
  api.loadVideo = function (el, url, opts) {
    if (!el || !url) return;
    const o = opts || {};
    const task = { el, url, onReady: o.onReady, onFail: o.onFail, fill: !!o.fillCache };
    if (group.active) { group.total++; showGroup(); }   // 首个媒体入队时才显示进度条
    api._queue.push(task);
    runNext();
  };

  /** 直接把 Promise 化任务排进同一队列（预读/回填等，可选） */
  api.loadUrl = function (url) {
    if (!canCache || api._blob[url]) return;
    api._queue.push({ preloadOnly: true, url });
    runNext();
  };

  function runNext() {
    if (api._running) return;
    const task = api._queue.shift();
    if (!task) return;
    api._running = true;
    if (task.preloadOnly) {
      resolveSrc(task.url).then(() => {}, () => {}).then(() => { api._running = false; runNext(); });
      return;
    }
    startTask(task, () => { api._running = false; runNext(); });
  }

  function startTask(task, next) {
    const el = task.el;
    let settled = false;
    let timer = null;

    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { el.removeEventListener('loadeddata', onLoaded); } catch (e) {}
      try { el.removeEventListener('error', onError); } catch (e) {}
      if (ok) api._stats.done++; else api._stats.fail++;
      /* 不静默失败：打出具体 URL 与原因（超时/错误/赋值失败），方便真机排查 */
      if (!ok) console.warn('[TDMedia] 媒体加载失败，已跳过并走降级：', task.url, '(' + reason + ')');
      if (group.active) {
        if (ok) group.done++; else group.fail++;
        renderGroup();
        if (group.total > 0 && group.done + group.fail >= group.total) api.endGroup(false);
      }
      try {
        if (ok) { if (task.onReady) task.onReady(); }
        else { if (task.onFail) task.onFail(reason); }
      } catch (e) { /* 回调方自身异常不影响队列 */ }
      next();
    };
    const onLoaded = () => { if (el.videoWidth === 0) return; done(true); };
    const onError = () => done(false, 'error');
    const onBuffered = () => { if (task.fill) fillCache(el, task.url); };

    try {
      el.addEventListener('loadeddata', onLoaded);
      el.addEventListener('error', onError);
      if (task.fill) {
        el.addEventListener('progress', onBuffered);
        el.addEventListener('canplay', onBuffered);
        el.addEventListener('canplaythrough', onBuffered);
      }
    } catch (e) { /* 忽略 */ }
    /* 单项超时：到点即跳过（模块端照旧走静态降级），绝不挂起队列 */
    timer = setTimeout(() => done(false, 'timeout'), ITEM_TIMEOUT);

    resolveSrc(task.url).then((src) => {
      if (settled) return;
      try {
        el.src = src;
        try { el.load(); } catch (e2) { /* 部分内核 load 可省 */ }
        if (el.readyState >= 2 && el.videoWidth > 0) done(true);   // 缓存命中可能已就绪
      } catch (e) { done(false, 'assign'); }
    }, () => done(false, 'resolve'));
  }

  /** 会话统计（排查用，可在控制台调用 window.TDMedia.stats()） */
  api.stats = function () {
    return {
      canCache: canCache, cachedHit: api._stats.cachedHit,
      done: api._stats.done, fail: api._stats.fail,
      queued: api._queue.length, running: api._running
    };
  };

  /* 挂到 window：便于真机排查（控制台 TDMedia.stats()） */
  try { window.TDMedia = api; } catch (e) { /* 忽略 */ }

  return api;
})();
