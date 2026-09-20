/**
 * miya-deep-novel.js — 深入 · 角色手机 小说库界面
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var SHELF_THEMES = [
    { cls: 'healing', en: 'healing', deco: '' },
    { cls: 'classic', en: 'classic', deco: 'feather' },
    { cls: 'mystery', en: 'mystery', deco: 'clip' },
    { cls: 'romance', en: 'romance', deco: 'flower' },
    { cls: 'fantasy', en: 'fantasy', deco: 'tag' }
  ];

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    novelData: null,
    refreshing: false,
    detailBookId: '',
    statsOpen: false
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function novelStore() { return global.miyaDeepNovelStore || null; }
  function novelBridge() { return global.miyaDeepNovelBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toast(msg) {
    var el = $('dp-novel-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function formatMinutes(n) {
    var m = Math.max(0, Math.round(Number(n) || 0));
    if (m >= 60) {
      var h = Math.floor(m / 60);
      var r = m % 60;
      return h + ' 小时' + (r ? ' ' + r + ' 分' : '');
    }
    return m + ' 分钟';
  }

  function countBooks(data) {
    var shelves = data && data.shelves || [];
    var total = 0;
    shelves.forEach(function (s) { total += (s.books || []).length; });
    return total;
  }

  function shelfTheme(idx) {
    return SHELF_THEMES[idx % SHELF_THEMES.length];
  }

  function shelfEnLabel(shelf, idx) {
    if (shelf && shelf.categoryEn) return shelf.categoryEn;
    return shelfTheme(idx).en;
  }

  var CLIP_SVG = '<svg viewBox="0 0 28 34" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="clipG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#c8c8c8"/><stop offset="50%" stop-color="#ececec"/><stop offset="100%" stop-color="#989898"/></linearGradient></defs><path d="M8 2h12a4 4 0 0 1 4 4v24l-10-6-10 6V6a4 4 0 0 1 4-4z" fill="url(#clipG)" stroke="#a0a0a0" stroke-width="0.6"/></svg>';

  var FEATHER_SVG = '<svg viewBox="0 0 22 48" fill="none"><path d="M11 2c2 8 4 18 3 28-1 8-2 14-3 16" stroke="#b8a890" stroke-width="1.2" fill="none"/><path d="M11 6c-4 6-6 14-5 22M11 8c5 5 7 12 6 20M11 12c-2 4-3 9-2 14M11 14c3 3 4 8 3 13" stroke="#d8d0c0" stroke-width="0.6" opacity="0.7"/></svg>';

  var FLOWER_SVG = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="10" r="3" fill="#d8b8b8" opacity="0.7"/><circle cx="9" cy="13" r="2.5" fill="#e0c0c0" opacity="0.6"/><circle cx="15" cy="13" r="2.5" fill="#e0c0c0" opacity="0.6"/><circle cx="12" cy="15" r="2" fill="#d0b0b0" opacity="0.5"/><path d="M12 17v5" stroke="#a8a090" stroke-width="0.8"/></svg>';

  var TAG_SVG = '<svg viewBox="0 0 36 52" fill="none"><rect x="4" y="0" width="28" height="38" rx="2" fill="#f0e8d8" stroke="#c8b8a0" stroke-width="0.8"/><circle cx="18" cy="6" r="2.5" fill="none" stroke="#b0a090" stroke-width="0.8"/><text x="18" y="22" text-anchor="middle" font-size="7" fill="#8a8070" font-family="serif">NO.</text><text x="18" y="32" text-anchor="middle" font-size="9" fill="#6a6050" font-family="serif" font-weight="600">05</text><path d="M14 38h8v4l-4 10-4-10z" fill="#e8dcc8" stroke="#c8b8a0" stroke-width="0.6"/></svg>';

  var DOCK_ICONS = {
    store: '<svg viewBox="0 0 24 24"><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M4 8h16l-1.2 12H5.2L4 8z"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>',
    shelf: '<svg viewBox="0 0 24 24"><path d="M4 6h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z"/><path d="M4 10h16"/><path d="M8 14h8"/></svg>',
    compass: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2"/><path d="m12 8 2 4-4 2 2-6z" fill="currentColor" stroke="none" opacity="0.5"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3.5-6 7-6s7 2 7 6"/></svg>'
  };

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-novel-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的小说库');
    statusDotsTimer = setInterval(function () {
      statusDotsFrame = (statusDotsFrame + 1) % 4;
      text.textContent = base + '.'.repeat(statusDotsFrame);
    }, 420);
  }

  function clearSuccessFlash() {
    clearTimeout(successFlashTimer);
    successFlashTimer = 0;
  }

  function showSuccessFlash() {
    clearSuccessFlash();
    updateStatusBar();
    successFlashTimer = setTimeout(function () {
      successFlashTimer = 0;
      updateStatusBar();
    }, 2000);
  }

  function updateStatusBar() {
    var bar = $('dp-novel-status');
    var text = $('dp-novel-status-text');
    if (!bar || !text) return;
    var data = state.novelData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的小说库';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '已成功读取';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-novel__status';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-novel__status is-' + kind;
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-novel-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.novelData && state.novelData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function renderHero() {
    var el = $('dp-novel-hero');
    if (!el) return;
    var total = countBooks(state.novelData);

    el.innerHTML =
      '<h1 class="dp-novel__hero-title">书架</h1>' +
      '<p class="dp-novel__hero-count">共 ' + total + ' 本书</p>';
  }

  function renderFolderDeco(theme, idx) {
    var html = '';
    if (theme.deco === 'feather') {
      html += '<span class="dp-novel__deco-tape" aria-hidden="true"></span>';
      html += '<span class="dp-novel__deco-feather" aria-hidden="true">' + FEATHER_SVG + '</span>';
    }
    if (theme.deco === 'clip') {
      html += '<span class="dp-novel__deco-clip-tab" aria-hidden="true">' + CLIP_SVG + '</span>';
    }
    if (theme.deco === 'flower') {
      html += '<span class="dp-novel__deco-tape" aria-hidden="true"></span>';
      html += '<span class="dp-novel__deco-flower" aria-hidden="true">' + FLOWER_SVG + '</span>';
    }
    if (theme.deco === 'tag') {
      var tag = TAG_SVG.replace('>05<', '>' + pad(idx + 1) + '<');
      html += '<span class="dp-novel__deco-tag" aria-hidden="true">' + tag + '</span>';
    }
    return html;
  }

  function renderBookCover(book, shelfIdx, bookIdx) {
    var theme = shelfTheme(shelfIdx);
    var variant = 'v' + ((bookIdx % 5) + 1);
    var light = theme.cls !== 'mystery' ? ' dp-novel__cover--light' : '';
    return (
      '<button type="button" class="dp-novel__cover dp-novel__cover--' + theme.cls + ' ' + variant + light + '" data-dp-novel-book="' + esc(book.id) + '">' +
        '<span class="dp-novel__cover-art" aria-hidden="true"></span>' +
        '<span class="dp-novel__cover-spine" aria-hidden="true"></span>' +
        '<span class="dp-novel__cover-pages" aria-hidden="true"></span>' +
        '<span class="dp-novel__cover-top" aria-hidden="true"></span>' +
        '<span class="dp-novel__cover-title">' + esc(book.title) + '</span>' +
        '<span class="dp-novel__cover-author">' + esc(book.author || '') + '</span>' +
      '</button>'
    );
  }

  function renderFolders() {
    var el = $('dp-novel-folders');
    var empty = $('dp-novel-empty');
    if (!el) return;
    var shelves = state.novelData && state.novelData.shelves || [];
    if (!shelves.length) {
      el.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    el.innerHTML = shelves.map(function (shelf, si) {
      var theme = shelfTheme(si);
      var en = shelfEnLabel(shelf, si);
      var booksHtml = (shelf.books || []).map(function (book, bi) {
        return renderBookCover(book, si, bi);
      }).join('');

      return (
        '<article class="dp-novel__folder dp-novel__folder--' + theme.cls + '">' +
          '<div class="dp-novel__folder-head">' +
            '<div class="dp-novel__folder-tab">' +
              '<span class="dp-novel__folder-hole" aria-hidden="true"></span>' +
              '<span class="dp-novel__folder-no">' + pad(si + 1) + '</span>' +
              '<span class="dp-novel__folder-name">' + esc(shelf.category) + '</span>' +
              '<span class="dp-novel__folder-en">/ ' + esc(en) + '</span>' +
              '<span class="dp-novel__folder-dots" aria-hidden="true">···</span>' +
            '</div>' +
            '<span class="dp-novel__folder-badge">NO. ' + pad(si + 1) + '</span>' +
          '</div>' +
          '<div class="dp-novel__folder-panel">' +
            renderFolderDeco(theme, si) +
            '<div class="dp-novel__folder-books">' + booksHtml + '</div>' +
            '<div class="dp-novel__folder-shelf" aria-hidden="true"></div>' +
          '</div>' +
        '</article>'
      );
    }).join('');
  }

  function findBook(bookId) {
    var shelves = state.novelData && state.novelData.shelves || [];
    for (var i = 0; i < shelves.length; i++) {
      var books = shelves[i].books || [];
      for (var j = 0; j < books.length; j++) {
        if (books[j].id === bookId) {
          return { shelf: shelves[i], book: books[j], shelfIndex: i, bookIndex: j };
        }
      }
    }
    return null;
  }

  function renderBookDetail() {
    var layer = $('dp-novel-detail');
    if (!layer) return;
    if (!state.detailBookId) {
      layer.hidden = true;
      layer.classList.remove('is-open');
      return;
    }
    var hit = findBook(state.detailBookId);
    if (!hit) {
      state.detailBookId = '';
      layer.hidden = true;
      layer.classList.remove('is-open');
      return;
    }
    var book = hit.book;
    var shelf = hit.shelf;
    var theme = shelfTheme(hit.shelfIndex);
    layer.innerHTML =
      '<div class="dp-novel__detail-veil" data-dp-novel-close></div>' +
      '<article class="dp-novel__detail-card dp-novel__detail-card--' + theme.cls + '">' +
        '<span class="dp-novel__detail-clip" aria-hidden="true">' + CLIP_SVG + '</span>' +
        '<header class="dp-novel__detail-head">' +
          '<button type="button" class="dp-novel__detail-close" data-dp-novel-close aria-label="关闭">×</button>' +
          '<span class="dp-novel__detail-shelf">' + esc(shelf.category) + ' · Vol.' + pad(hit.bookIndex + 1) + '</span>' +
        '</header>' +
        '<div class="dp-novel__detail-scroll">' +
          '<h2 class="dp-novel__detail-title">' + esc(book.title) + '</h2>' +
          '<p class="dp-novel__detail-author">' + esc(book.author || '—') + '</p>' +
          '<div class="dp-novel__detail-chapter">' +
            '<span class="dp-novel__detail-label">读到</span>' +
            '<strong>' + esc(book.currentChapter || '未开始') + '</strong>' +
          '</div>' +
          (book.annotation
            ? '<blockquote class="dp-novel__detail-note">' +
                '<span class="dp-novel__detail-label">批注</span>' +
                '<p>' + esc(book.annotation) + '</p>' +
              '</blockquote>'
            : '<p class="dp-novel__detail-empty-note">暂无批注</p>') +
        '</div>' +
      '</article>';
    layer.hidden = false;
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });
  }

  function renderStatsPanel() {
    var panel = $('dp-novel-stats-panel');
    if (!panel) return;
    if (!state.statsOpen) {
      panel.hidden = true;
      panel.classList.remove('is-open');
      return;
    }
    var ws = state.novelData && state.novelData.weekStats;
    var fav = ws && ws.favoriteBook || { title: '', author: '' };
    var plan = ws && ws.plannedBook || { title: '', author: '' };
    var hasData = !!(fav.title || ws && ws.totalMinutes);

    panel.innerHTML =
      '<div class="dp-novel__stats-veil" data-dp-novel-stats-close></div>' +
      '<article class="dp-novel__stats-card">' +
        '<header class="dp-novel__stats-head">' +
          '<h3>阅读档案</h3>' +
          '<button type="button" data-dp-novel-stats-close aria-label="关闭">×</button>' +
        '</header>' +
        (hasData
          ? '<div class="dp-novel__stats-body">' +
              '<div class="dp-novel__stats-row">' +
                '<span class="dp-novel__stats-k">最爱</span>' +
                '<div class="dp-novel__stats-v">' +
                  '<strong>' + esc(fav.title || '—') + '</strong>' +
                  '<em>' + esc(fav.author || '') + '</em>' +
                '</div>' +
              '</div>' +
              '<div class="dp-novel__stats-row">' +
                '<span class="dp-novel__stats-k">本周</span>' +
                '<div class="dp-novel__stats-v">' +
                  '<strong>' + esc(formatMinutes(ws.totalMinutes)) + '</strong>' +
                '</div>' +
              '</div>' +
              '<div class="dp-novel__stats-row">' +
                '<span class="dp-novel__stats-k">计划</span>' +
                '<div class="dp-novel__stats-v">' +
                  '<strong>' + esc(plan.title || '—') + '</strong>' +
                  '<em>' + esc(plan.author || '') + '</em>' +
                '</div>' +
              '</div>' +
            '</div>'
          : '<p class="dp-novel__stats-empty">点击右上角 ↻ 读取 ta 的阅读档案</p>') +
      '</article>';
    panel.hidden = false;
    requestAnimationFrame(function () {
      panel.classList.add('is-open');
    });
  }

  function closeBookDetail() {
    state.detailBookId = '';
    var layer = $('dp-novel-detail');
    if (!layer) return;
    layer.classList.remove('is-open');
    setTimeout(function () {
      if (!state.detailBookId) layer.hidden = true;
    }, 320);
  }

  function closeStatsPanel() {
    state.statsOpen = false;
    var panel = $('dp-novel-stats-panel');
    if (!panel) return;
    panel.classList.remove('is-open');
    setTimeout(function () {
      if (!state.statsOpen) panel.hidden = true;
    }, 280);
  }

  function openStatsPanel() {
    state.statsOpen = true;
    renderStatsPanel();
  }

  function renderDock() {
    var dock = $('dp-novel-dock');
    if (!dock) return;
    dock.innerHTML =
      '<button type="button" class="dp-novel__dock-item" disabled><span class="dp-novel__dock-ico">' + DOCK_ICONS.store + '</span><span>书城</span></button>' +
      '<button type="button" class="dp-novel__dock-item" disabled><span class="dp-novel__dock-ico">' + DOCK_ICONS.grid + '</span><span>分类</span></button>' +
      '<button type="button" class="dp-novel__dock-item is-active"><span class="dp-novel__dock-ico">' + DOCK_ICONS.shelf + '</span><span>书架</span></button>' +
      '<button type="button" class="dp-novel__dock-item" disabled><span class="dp-novel__dock-ico">' + DOCK_ICONS.compass + '</span><span>发现</span></button>' +
      '<button type="button" class="dp-novel__dock-item" id="dp-novel-mine"><span class="dp-novel__dock-ico">' + DOCK_ICONS.user + '</span><span>我的</span></button>';
    var mine = $('dp-novel-mine');
    if (mine) mine.addEventListener('click', openStatsPanel);
  }

  function renderAll() {
    renderHero();
    renderFolders();
    renderBookDetail();
    renderStatsPanel();
    renderDock();
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadNovelData(contactId) {
    var ns = novelStore();
    if (!ns) return Promise.resolve(null);
    return ns.getNovel(contactId).then(function (data) {
      state.novelData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-novel-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var ns = novelStore();
    var br = novelBridge();
    if (!ns || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ns.patchNovel(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的小说库',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.novelData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateNovelLibrary(contactId, phoneData, {
        onProgress: function (p) {
          var msg = p && p.message ? p.message : '正在读取ta的小说库';
          ns.patchNovel(contactId, {
            refreshStatus: 'loading',
            refreshMessage: msg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.novelData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return ns.patchNovel(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        shelves: result.shelves,
        weekStats: result.weekStats
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.novelData = saved;
        state.refreshing = false;
        if (state.open) {
          renderAll();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ns.patchNovel(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.novelData = saved;
          state.refreshing = false;
          if (state.open) renderAll();
        }
        dispatchUpdated(contactId);
        throw err;
      });
    });

    activeJobs[contactId] = job;
    return job;
  }

  function handleRefresh() {
    if (!state.contactId) return;
    if (state.refreshing || (state.novelData && state.novelData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function bindEvents() {
    var root = $('dp-novel');
    if (!root || root._dpNovelBound) return;
    root._dpNovelBound = true;

    var back = $('dp-novel-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-novel-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    var statsBtn = $('dp-novel-stats-btn');
    if (statsBtn) statsBtn.addEventListener('click', openStatsPanel);

    renderDock();

    root.addEventListener('click', function (e) {
      var bookBtn = e.target.closest('[data-dp-novel-book]');
      if (bookBtn) {
        state.detailBookId = bookBtn.getAttribute('data-dp-novel-book');
        closeStatsPanel();
        renderBookDetail();
        return;
      }
      if (e.target.closest('[data-dp-novel-close]')) {
        closeBookDetail();
        return;
      }
      if (e.target.closest('[data-dp-novel-stats-close]')) {
        closeStatsPanel();
      }
    });

    global.addEventListener('miya-deep-novel-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadNovelData(cid).then(function () {
        renderAll();
      });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-novel');
    if (!layer) return;

    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.refreshing = !!activeJobs[state.contactId];
    state.detailBookId = '';
    state.statsOpen = false;

    layer.removeAttribute('hidden');
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });

    loadNovelData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          novelStore().patchNovel(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.novelData = fixed;
            renderAll();
          });
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-novel');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    state.detailBookId = '';
    state.statsOpen = false;
    state.open = false;
    layer.classList.remove('is-open');
    layer.setAttribute('hidden', '');
    var detail = $('dp-novel-detail');
    if (detail) {
      detail.hidden = true;
      detail.classList.remove('is-open');
    }
    var stats = $('dp-novel-stats-panel');
    if (stats) {
      stats.hidden = true;
      stats.classList.remove('is-open');
    }
  }

  function init() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.miyaDeepNovel = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
