/* ============================================================
 * debugTools.js —— 开发调试工具集（仅 URL 带 #dbg 时启用）
 *
 * 正式环境（无 #dbg）本脚本立即 return，不创建任何 DOM、不写任何存储，
 * 对游戏逻辑零影响。启用后提供两项能力：
 *
 * 1) 全内容解锁（只读覆盖，不落盘）
 *    置 TDStorage.__debugAllUnlocked = true：所有关卡 / 塔 / 特殊解锁
 *    条件直接放行。该开关为纯内存布尔，游戏存档（td_levels_progress_v1）
 *    的数据结构与读写逻辑完全不变；刷新且不带 #dbg 即恢复正式状态。
 *
 * 2) 应用内本地浏览器（调试纠错用）
 *    右下角悬浮入口打开 iframe 浏览面板：地址栏输入、前进 / 后退 /
 *    刷新 / 主页、历史记录管理（持久化在独立 key
 *    td_debug_browser_history_v1，与游戏存档分离）。
 *    面板位于 #app 外部，不参与视觉横屏旋转，触摸 / 鼠标均可操作。
 *    注意：部分网站以 X-Frame-Options / CSP 禁止被 iframe 嵌入，
 *    属浏览器安全策略，页面会空白（面板内有常驻提示）。
 *
 * 对外 API：window.__tdDebug = { isDebug, unlock, browser }
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 门控：仅 #dbg 启用 ---------- */
  var debugOn = false;
  try { debugOn = location.hash.indexOf('dbg') !== -1; } catch (e) {}
  if (!debugOn) return;

  /* ---------- 1) 全内容解锁（内存开关，详见 storage.js 头注释） ---------- */
  if (window.TDStorage) TDStorage.__debugAllUnlocked = true;

  /* ============================================================
   * 2) 应用内本地浏览器
   * ============================================================ */
  var HIST_KEY = 'td_debug_browser_history_v1';
  var HOME_URL = 'td://home';                 // 虚拟起始页（用 srcdoc 渲染）
  var HIST_MAX = 50;

  var list = [];                               // 历史记录 [{ u:url, t:title }]
  var cursor = -1;                             // 当前记录下标
  var suppressHistSync = false;                // 同源跳转回写期间防止递归

  /* ---- 历史持久化（独立 key，与游戏存档完全分离） ---- */
  function loadHist() {
    try {
      var raw = localStorage.getItem(HIST_KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (d && Array.isArray(d.list) && typeof d.cursor === 'number') {
        list = d.list;
        cursor = Math.min(d.cursor, list.length - 1);
      }
    } catch (e) { /* 损坏则从零开始 */ }
    if (!list.length) { list = [{ u: HOME_URL, t: '起始页' }]; cursor = 0; }
    if (cursor < 0) cursor = list.length - 1;
  }
  function saveHist() {
    try { localStorage.setItem(HIST_KEY, JSON.stringify({ list: list, cursor: cursor })); }
    catch (e) { /* 配额满 / 隐私模式：本次会话仍保留内存记录 */ }
  }
  function clearHist() {
    list = [{ u: HOME_URL, t: '起始页' }];
    cursor = 0;
    saveHist();
  }

  /* ---- 地址规范化：补协议 / 允许 about: 与虚拟 td: 协议 ---- */
  function normalize(input) {
    var u = String(input || '').trim();
    if (!u) return '';
    if (u === HOME_URL || u.indexOf('about:') === 0) return u;
    if (u.indexOf('://') !== -1) return u;
    return 'https://' + u;
  }
  function displayUrl(u) {
    return u === HOME_URL ? '起始页（本地）' : u;
  }

  /* ---- 起始页（srcdoc，不产生网络请求） ---- */
  function homeDoc() {
    var gameUrl = new URL('index.html', location.href).href;
    var pagesUrl = 'https://w3rwsr.github.io/tower-defense-h5/';
    var repoUrl = 'https://github.com/w3rwsr/tower-defense-h5';
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>调试浏览器·起始页</title><style>' +
      'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'background:#f4f7ef;color:#243018;display:flex;flex-direction:column;' +
      'align-items:center;min-height:100vh;padding:32px 16px;box-sizing:border-box}' +
      'h1{font-size:22px;margin:8px 0 4px}.sub{color:#5c6b48;font-size:13px;margin-bottom:24px}' +
      '.grid{display:flex;flex-direction:column;gap:12px;width:100%;max-width:420px}' +
      'a{display:block;padding:14px 16px;background:#fff;border:1px solid #cdddb2;' +
      'border-radius:12px;text-decoration:none;color:#2f4a16;font-size:15px;' +
      'box-shadow:0 1px 2px rgba(0,0,0,.06)}' +
      'a small{display:block;color:#7a8a63;margin-top:4px;font-size:12px;word-break:break-all}' +
      '.tip{margin-top:26px;font-size:12px;color:#8a9772;text-align:center;line-height:1.7}' +
      '</style></head><body>' +
      '<h1>🌐 调试浏览器</h1>' +
      '<div class="sub">仅在 URL 带 #dbg 的开发调试模式下可用</div>' +
      '<div class="grid">' +
      '<a href="' + gameUrl + '">🎮 打开游戏首页<small>' + gameUrl + '</small></a>' +
      '<a href="' + pagesUrl + '">🚀 GitHub Pages 在线版<small>' + pagesUrl + '</small></a>' +
      '<a href="' + repoUrl + '">📦 GitHub 仓库<small>' + repoUrl + '</small></a>' +
      '</div>' +
      '<div class="tip">在上方地址栏输入任意网址后回车即可访问。<br>' +
      '若页面空白，通常是目标网站通过 X-Frame-Options / CSP 禁止被嵌入。</div>' +
      '</body></html>';
  }

  /* ---- DOM 构建（脚本位于 body 末尾，DOM 已就绪） ---- */
  var fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'td-dbg-browser-fab';
  fab.textContent = '🌐 调试浏览器';

  var panel = document.createElement('div');
  panel.id = 'td-dbg-browser';
  panel.hidden = true;
  panel.innerHTML =
    '<div class="td-dbg-bar">' +
      '<button type="button" class="td-dbg-btn" data-act="back" title="后退">◀</button>' +
      '<button type="button" class="td-dbg-btn" data-act="fwd" title="前进">▶</button>' +
      '<button type="button" class="td-dbg-btn" data-act="reload" title="刷新">⟳</button>' +
      '<button type="button" class="td-dbg-btn" data-act="home" title="主页">🏠</button>' +
      '<input type="text" class="td-dbg-url" spellcheck="false" ' +
        'placeholder="输入网址后回车，如 example.com" />' +
      '<button type="button" class="td-dbg-btn td-dbg-go" data-act="go">前往</button>' +
      '<button type="button" class="td-dbg-btn" data-act="hist" title="历史记录">📜</button>' +
      '<button type="button" class="td-dbg-btn td-dbg-x" data-act="close" title="关闭面板">✕</button>' +
    '</div>' +
    '<div class="td-dbg-hist" hidden>' +
      '<div class="td-dbg-hist-head">' +
        '<span>历史记录</span>' +
        '<button type="button" class="td-dbg-btn td-dbg-clear" data-act="clearHist">清空</button>' +
      '</div>' +
      '<div class="td-dbg-hist-list"></div>' +
    '</div>' +
    '<iframe class="td-dbg-frame" ' +
      'sandbox="allow-forms allow-modals allow-popups allow-scripts allow-same-origin" ' +
      'referrerpolicy="no-referrer" title="调试浏览器"></iframe>' +
    '<div class="td-dbg-foot">#dbg 调试模式 · 空白页多为目标站点禁止嵌入（X-Frame-Options/CSP）</div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var urlInput = panel.querySelector('.td-dbg-url');
  var histBox = panel.querySelector('.td-dbg-hist');
  var histList = panel.querySelector('.td-dbg-hist-list');
  var frame = panel.querySelector('.td-dbg-frame');

  /* ---- 界面状态刷新 ---- */
  function refreshChrome() {
    urlInput.value = displayUrl(list[cursor].u);
    panel.querySelector('[data-act="back"]').disabled = cursor <= 0;
    panel.querySelector('[data-act="fwd"]').disabled = cursor >= list.length - 1;
  }

  function renderHist() {
    histList.innerHTML = '';
    /* 最新访问在顶部 */
    for (var i = list.length - 1; i >= 0; i--) {
      (function (idx) {
        var item = list[idx];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'td-dbg-hist-item' + (idx === cursor ? ' cur' : '');
        var dot = document.createElement('span');
        dot.className = 'td-dbg-hist-dot';
        dot.textContent = idx === cursor ? '▶' : '·';
        var txt = document.createElement('span');
        txt.className = 'td-dbg-hist-url';
        txt.textContent = displayUrl(item.t || item.u) + (item.t && item.t !== item.u ? '' : '');
        var sub = document.createElement('small');
        sub.textContent = displayUrl(item.u);
        b.appendChild(dot);
        b.appendChild(txt);
        b.appendChild(sub);
        b.addEventListener('click', function () { jump(idx); });
        histList.appendChild(b);
      })(i);
    }
  }

  /* ---- 核心导航 ---- */
  /* src / srcdoc 互相切换时用 removeAttribute 而不是赋空串：
     赋空 srcdoc 会先排队一次 about:srcdoc 空文档加载，与紧接的 src
     赋值产生竞争（实测空白页偶发胜出）；移除属性不触发任何导航。 */
  function renderFrame(u) {
    suppressHistSync = true;
    if (u === HOME_URL) {
      frame.removeAttribute('src');
      frame.srcdoc = homeDoc();
    } else {
      frame.removeAttribute('srcdoc');
      frame.src = u;
    }
    /* load 事件可能不触发（跨域被拒），用短超时解除同步抑制 */
    setTimeout(function () { suppressHistSync = false; }, 1200);
  }

  function commit(u, push) {
    u = normalize(u);
    if (!u) return;
    if (push) {
      /* 标准浏览器语义：从历史中间位置新开页面时截断前进链 */
      if (cursor < list.length - 1) list = list.slice(0, cursor + 1);
      var last = list[list.length - 1];
      if (!last || last.u !== u) list.push({ u: u, t: u });
      if (list.length > HIST_MAX) list = list.slice(list.length - HIST_MAX);
      cursor = list.length - 1;
    }
    renderFrame(u);
    refreshChrome();
    renderHist();
    saveHist();
  }

  function navigate(input) { commit(input, true); }
  function jump(idx) {
    if (idx < 0 || idx >= list.length) return;
    cursor = idx;
    commit(list[idx].u, false);
    if (histBox.hidden === false) renderHist();
  }
  function back() { if (cursor > 0) jump(cursor - 1); }
  function fwd() { if (cursor < list.length - 1) jump(cursor + 1); }
  function reload() {
    var u = list[cursor].u;
    if (u === HOME_URL) { frame.srcdoc = homeDoc(); return; }
    /* 重新赋同源地址强制刷新 */
    renderFrame(u);
  }
  function home() { commit(HOME_URL, list[cursor].u === HOME_URL ? false : true); }

  function openPanel() {
    panel.hidden = false;
    fab.classList.add('open');
    if (!frame.srcdoc && !frame.src) renderFrame(list[cursor].u);
    refreshChrome();
    renderHist();
  }
  function closePanel() {
    panel.hidden = true;
    fab.classList.remove('open');
  }

  /* ---- 事件绑定 ---- */
  fab.addEventListener('click', openPanel);
  panel.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn) return;
    switch (btn.dataset.act) {
      case 'back': back(); break;
      case 'fwd': fwd(); break;
      case 'reload': reload(); break;
      case 'home': home(); break;
      case 'go': navigate(urlInput.value); break;
      case 'hist':
        histBox.hidden = !histBox.hidden;
        if (!histBox.hidden) renderHist();
        break;
      case 'clearHist': clearHist(); renderHist(); refreshChrome(); break;
      case 'close': closePanel(); break;
    }
  });
  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); navigate(urlInput.value); }
  });

  /* 同源页面加载后：把真实 URL（重定向 / 相对链接跳转后）与标题回写历史。
     跨域访问 contentWindow.location 会抛 SecurityError，静默保留输入值。 */
  frame.addEventListener('load', function () {
    if (suppressHistSync) return;
    try {
      var w = frame.contentWindow;
      var href = w.location.href;
      if (!href || href.indexOf('about:') === 0) return;
      var title = href;
      try { title = w.document.title || href; } catch (e2) {}
      if (list[cursor] && list[cursor].u !== href) list[cursor].u = href;
      if (list[cursor]) list[cursor].t = title;
      urlInput.value = href;
      renderHist();
      saveHist();
    } catch (e) { /* 跨域：地址栏保留用户输入 */ }
  });

  /* ---- 初始化 ---- */
  loadHist();
  saveHist();   // 首次使用即写入独立 key，保证刷新后起始页记录可恢复
  refreshChrome();
  renderHist();

  /* ---- 对外调试 API ---- */
  window.__tdDebug = {
    isDebug: true,
    unlock: {
      get enabled() { return !!TDStorage && TDStorage.__debugAllUnlocked === true; }
    },
    browser: {
      open: openPanel,
      close: closePanel,
      navigate: navigate,
      back: back,
      forward: fwd,
      reload: reload,
      home: home,
      get history() { return list.slice(); },
      get cursor() { return cursor; },
      clearHistory: function () { clearHist(); renderHist(); refreshChrome(); }
    }
  };

  try {
    console.info('[debug] #dbg 模式已启用：全部关卡/塔解锁（内存生效，不落盘）；' +
      '右下角「🌐 调试浏览器」可用，window.__tdDebug 可脚本控制。');
  } catch (e) {}
})();
