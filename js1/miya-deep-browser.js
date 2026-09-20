/**
 * miya-deep-browser.js — 深入 · 角色手机 浏览器界面
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var LOADING_MSG = '正在读取ta的浏览器数据';

  var SEARCH_CAT_LABELS = {
    emotion: '心绪', hobby: '兴趣', work: '工作',
    life: '日常', secret: '秘密', random: '随机'
  };

  var HISTORY_CAT_LABELS = {
    news: '资讯', learn: '学习', shop: '购物', social: '社交',
    entertainment: '娱乐', work: '工作', health: '健康', random: '其他'
  };

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    browserData: null,
    refreshing: false,
    view: 'home',
    activeItem: null,
    activeType: ''
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function browserStore() { return global.miyaDeepBrowserStore || null; }
  function browserBridge() { return global.miyaDeepBrowserBridge || null; }

  function loadingMsg() {
    var br = browserBridge();
    return (br && br.LOADING_MSG) ? br.LOADING_MSG : LOADING_MSG;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatParagraphs(text) {
    if (!text) return '';
    return String(text)
      .split(/\n+/)
      .filter(function (p) { return String(p || '').trim(); })
      .map(function (p) {
        return '<p class="dp-browser__article-p">' + esc(p) + '</p>';
      })
      .join('');
  }

  function toast(msg) {
    var el = $('dp-browser-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-browser-status-text');
    if (!text) return;
    var base = String(baseText || loadingMsg());
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
    var bar = $('dp-browser-status');
    var text = $('dp-browser-status-text');
    if (!bar || !text) return;
    var data = state.browserData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = loadingMsg();
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '已读取完成';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-browser__status';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-browser__status' +
      (kind === 'loading' ? ' is-loading' : kind === 'success' ? ' is-success' : kind === 'error' ? ' is-error' : '');
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-browser-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.browserData && state.browserData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function hasContent(data) {
    if (!data) return false;
    return !!(data.searches && data.searches.length) ||
      !!(data.history && data.history.length) ||
      !!(data.bookmarks && data.bookmarks.length);
  }

  function renderHero() {
    var el = $('dp-browser-hero');
    if (!el) return;
    var data = state.browserData;
    var name = state.contactName || 'ta';
    var stats = data && data.stats || {};
    var tagline = data && data.tagline;

    if (!hasContent(data)) {
      el.innerHTML =
        '<div class="dp-browser__hero-empty">' +
          '<span class="dp-browser__hero-ghost" aria-hidden="true">www</span>' +
          '<h1 class="dp-browser__hero-title">' + esc(name) + ' · Browser</h1>' +
          '<p class="dp-browser__hero-desc">点击右上角刷新，读取 ta 的浏览记录</p>' +
        '</div>';
      return;
    }

    var statLine = [
      { n: stats.searches || 0, l: '搜索' },
      { n: stats.pages || 0, l: '浏览' },
      { n: stats.bookmarks || 0, l: '收藏' },
      { n: stats.tabs || 0, l: '标签' }
    ].map(function (s) {
      return '<div class="dp-browser__hero-stat"><span class="dp-browser__hero-stat-n">' + s.n + '</span><span class="dp-browser__hero-stat-l">' + s.l + '</span></div>';
    }).join('');

    el.innerHTML =
      '<div class="dp-browser__hero-frame">' +
        '<span class="dp-browser__hero-ornament" aria-hidden="true"></span>' +
        '<div class="dp-browser__hero-inner">' +
          '<p class="dp-browser__hero-label">' + esc(name) + '</p>' +
          (tagline
            ? '<h1 class="dp-browser__hero-title">' + esc(tagline) + '</h1>'
            : '<h1 class="dp-browser__hero-title">Browsing History</h1>') +
          '<div class="dp-browser__hero-stats">' + statLine + '</div>' +
        '</div>' +
      '</div>';
  }

  function renderSearchRow(item) {
    var cat = SEARCH_CAT_LABELS[item.category] || '随机';
    var whenLine = [item.when, item.time].filter(Boolean).join(' · ');

    return (
      '<li class="dp-browser__row dp-browser__row--search">' +
        '<div class="dp-browser__row-main">' +
          '<span class="dp-browser__row-tag">' + cat + '</span>' +
          '<p class="dp-browser__row-title">' + esc(item.query) + '</p>' +
        '</div>' +
        (whenLine ? '<time class="dp-browser__row-time">' + esc(whenLine) + '</time>' : '') +
      '</li>'
    );
  }

  function renderTabRow(item) {
    return (
      '<li class="dp-browser__row dp-browser__row--tab">' +
        '<div class="dp-browser__row-main">' +
          '<p class="dp-browser__row-title">' + esc(item.title) + '</p>' +
          (item.domain ? '<span class="dp-browser__row-sub">' + esc(item.domain) + '</span>' : '') +
        '</div>' +
      '</li>'
    );
  }

  function renderHistoryRow(item) {
    var cat = HISTORY_CAT_LABELS[item.category] || '其他';
    var meta = [cat];
    if (item.visitCount > 1) meta.push('×' + item.visitCount);
    if (item.mood) meta.push(item.mood);

    return (
      '<li class="dp-browser__row dp-browser__row--hist">' +
        '<button type="button" class="dp-browser__row-btn" data-dp-browser-item="history" data-dp-browser-id="' + esc(item.id) + '">' +
          '<div class="dp-browser__row-main">' +
            '<span class="dp-browser__row-tag">' + esc(meta.join(' · ')) + '</span>' +
            '<p class="dp-browser__row-title">' + esc(item.title) + '</p>' +
            (item.domain ? '<span class="dp-browser__row-sub">' + esc(item.domain) + '</span>' : '') +
            (item.snippet ? '<p class="dp-browser__row-preview">' + esc(item.snippet) + '</p>' : '') +
          '</div>' +
          (item.visitedAt ? '<time class="dp-browser__row-time">' + esc(item.visitedAt) + '</time>' : '') +
        '</button>' +
      '</li>'
    );
  }

  function renderBookmarkRow(item) {
    return (
      '<li class="dp-browser__row dp-browser__row--mark">' +
        '<button type="button" class="dp-browser__row-btn" data-dp-browser-item="bookmark" data-dp-browser-id="' + esc(item.id) + '">' +
          '<div class="dp-browser__row-main">' +
            '<span class="dp-browser__row-tag">' + esc(item.folder || '未分类') + '</span>' +
            '<p class="dp-browser__row-title">' + esc(item.title) + '</p>' +
            (item.domain ? '<span class="dp-browser__row-sub">' + esc(item.domain) + '</span>' : '') +
            (item.note ? '<p class="dp-browser__row-preview">' + esc(item.note) + '</p>' : '') +
          '</div>' +
          (item.savedAt ? '<time class="dp-browser__row-time">' + esc(item.savedAt) + '</time>' : '') +
        '</button>' +
      '</li>'
    );
  }

  function renderDigestBlock(item) {
    var itemsHtml = (item.items || []).map(function (t) {
      return '<li>' + esc(t) + '</li>';
    }).join('');

    return (
      '<div class="dp-browser__digest">' +
        '<div class="dp-browser__digest-panel">' +
          '<h3 class="dp-browser__digest-title">' + esc(item.title) + '</h3>' +
          (item.caption ? '<p class="dp-browser__digest-cap">' + esc(item.caption) + '</p>' : '') +
          '<ul class="dp-browser__digest-list">' + itemsHtml + '</ul>' +
        '</div>' +
      '</div>'
    );
  }

  function padSectNum(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function renderSection(num, title, subtitle, bodyHtml) {
    return (
      '<section class="dp-browser__sect">' +
        '<header class="dp-browser__sect-head">' +
          '<span class="dp-browser__sect-deco" aria-hidden="true">' + padSectNum(num) + '</span>' +
          '<div class="dp-browser__sect-meta">' +
            '<h2 class="dp-browser__sect-title">' + title + '</h2>' +
            (subtitle ? '<p class="dp-browser__sect-sub">' + subtitle + '</p>' : '') +
          '</div>' +
        '</header>' +
        '<div class="dp-browser__sect-body">' + bodyHtml + '</div>' +
      '</section>'
    );
  }

  function renderSections() {
    var wrap = $('dp-browser-sections');
    var empty = $('dp-browser-empty');
    if (!wrap) return;

    var data = state.browserData;
    if (!hasContent(data)) {
      wrap.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    var html = '';
    var sectNum = 0;
    var searches = data.searches || [];
    var tabs = data.openTabs || [];
    var history = data.history || [];
    var bookmarks = data.bookmarks || [];
    var digests = data.digests || [];

    if (tabs.length) {
      sectNum++;
      html += renderSection(
        sectNum,
        'Open Tabs',
        '未关闭的页面',
        '<ul class="dp-browser__list">' + tabs.map(renderTabRow).join('') + '</ul>'
      );
    }

    if (searches.length) {
      sectNum++;
      html += renderSection(
        sectNum,
        'Search',
        '搜索记录',
        '<ul class="dp-browser__list">' + searches.map(renderSearchRow).join('') + '</ul>'
      );
    }

    if (digests.length) {
      sectNum++;
      html += renderSection(
        sectNum,
        'Patterns',
        '浏览习惯',
        '<div class="dp-browser__digest-wrap">' + digests.map(renderDigestBlock).join('') + '</div>'
      );
    }

    if (history.length) {
      sectNum++;
      html += renderSection(
        sectNum,
        'History',
        '浏览足迹',
        '<ul class="dp-browser__list dp-browser__list--hist">' + history.map(renderHistoryRow).join('') + '</ul>'
      );
    }

    if (bookmarks.length) {
      sectNum++;
      html += renderSection(
        sectNum,
        'Bookmarks',
        '收藏夹',
        '<ul class="dp-browser__list">' + bookmarks.map(renderBookmarkRow).join('') + '</ul>'
      );
    }

    wrap.innerHTML = html;
  }

  function findItem(type, id) {
    var data = state.browserData;
    if (!data || !id) return null;
    var list;
    if (type === 'history') list = data.history || [];
    else if (type === 'bookmark') list = data.bookmarks || [];
    else return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function renderComments(comments) {
    if (!comments || !comments.length) return '';
    var rows = comments.map(function (c) {
      if (typeof c === 'string') {
        return '<li class="dp-browser__comment"><p>' + esc(c) + '</p></li>';
      }
      var author = c.author || c.user || c.name || '';
      var text = c.text || c.content || c.comment || '';
      if (!text) return '';
      return (
        '<li class="dp-browser__comment">' +
          (author ? '<span class="dp-browser__comment-author">' + esc(author) + '</span>' : '') +
          '<p>' + esc(text) + '</p>' +
        '</li>'
      );
    }).filter(Boolean).join('');

    if (!rows) return '';
    return (
      '<section class="dp-browser__detail-comments">' +
        '<h3 class="dp-browser__detail-h">热评</h3>' +
        '<ul class="dp-browser__comment-list">' + rows + '</ul>' +
      '</section>'
    );
  }

  function renderDetail() {
    var el = $('dp-browser-detail');
    var homeView = $('dp-browser-home-view');
    if (!el) return;

    var item = state.activeItem;
    if (!item || state.view !== 'detail') {
      state.activeItem = null;
      state.activeType = '';
      if (homeView) homeView.hidden = false;
      el.hidden = true;
      el.innerHTML = '';
      return;
    }

    var isMark = state.activeType === 'bookmark';
    var catLabel = isMark
      ? esc(item.folder || '未分类')
      : (HISTORY_CAT_LABELS[item.category] || '其他');

    var metaParts = [catLabel];
    if (!isMark && item.visitCount > 1) metaParts.push('访问 ' + item.visitCount + ' 次');
    if (!isMark && item.mood) metaParts.push(item.mood);
    if (!isMark && item.visitedAt) metaParts.push(item.visitedAt);
    if (isMark && item.savedAt) metaParts.push(item.savedAt);

    var articleHtml = '';
    var bodyText = item.content || '';
    if (bodyText) {
      articleHtml = '<article class="dp-browser__article dp-browser__article--dropcap">' + formatParagraphs(bodyText) + '</article>';
    } else if (!isMark && item.snippet) {
      articleHtml = '<article class="dp-browser__article">' + formatParagraphs(item.snippet) + '</article>';
    } else if (isMark && item.note) {
      articleHtml = '<article class="dp-browser__article">' + formatParagraphs(item.note) + '</article>';
    }

    var deckHtml = '';
    if (!isMark && item.snippet && bodyText && item.snippet !== bodyText) {
      deckHtml = '<blockquote class="dp-browser__detail-deck"><span class="dp-browser__detail-quote" aria-hidden="true">"</span>' + esc(item.snippet) + '</blockquote>';
    }

    el.innerHTML =
      '<header class="dp-browser__detail-head">' +
        '<button type="button" class="dp-browser__detail-back" id="dp-browser-detail-back">← 返回</button>' +
        '<p class="dp-browser__detail-meta">' + esc(metaParts.join(' · ')) + '</p>' +
        '<h1 class="dp-browser__detail-title">' + esc(item.title) + '</h1>' +
        (item.domain ? '<p class="dp-browser__detail-domain">' + esc(item.domain) + '</p>' : '') +
        (item.url ? '<p class="dp-browser__detail-url">' + esc(item.url) + '</p>' : '') +
      '</header>' +
      '<div class="dp-browser__detail-scroll" id="dp-browser-detail-scroll">' +
        '<div class="dp-browser__detail-body">' +
          '<div class="dp-browser__detail-sheet">' +
            deckHtml +
            articleHtml +
            renderComments(item.comments) +
          '</div>' +
        '</div>' +
      '</div>';

    if (homeView) homeView.hidden = true;
    el.hidden = false;

    var backBtn = $('dp-browser-detail-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        state.view = 'home';
        state.activeItem = null;
        state.activeType = '';
        renderView();
      });
    }
  }

  function renderView() {
    var root = $('dp-browser');
    if (root) root.classList.toggle('is-detail', state.view === 'detail');

    if (state.view === 'detail') {
      renderDetail();
    } else {
      var detail = $('dp-browser-detail');
      var homeView = $('dp-browser-home-view');
      if (detail) { detail.hidden = true; detail.innerHTML = ''; }
      if (homeView) homeView.hidden = false;
      renderHero();
      renderSections();
    }
    updateStatusBar();
    updateRefreshBtn();
  }

  function renderAll() {
    renderView();
  }

  function loadBrowserData(contactId) {
    var bs = browserStore();
    if (!bs) return Promise.resolve(null);
    return bs.getBrowser(contactId).then(function (data) {
      state.browserData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-browser-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var bs = browserStore();
    var br = browserBridge();
    if (!bs || !br) return Promise.reject(new Error('模块未就绪'));

    var msg = loadingMsg();

    var job = bs.patchBrowser(contactId, {
      refreshStatus: 'loading',
      refreshMessage: msg,
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.browserData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateBrowser(contactId, phoneData, {
        onProgress: function (p) {
          var progressMsg = p && p.message ? p.message : msg;
          bs.patchBrowser(contactId, {
            refreshStatus: 'loading',
            refreshMessage: progressMsg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.browserData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return bs.patchBrowser(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        tagline: result.tagline,
        stats: result.stats,
        searches: result.searches,
        openTabs: result.openTabs,
        history: result.history,
        bookmarks: result.bookmarks,
        digests: result.digests
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.browserData = saved;
        state.refreshing = false;
        state.view = 'home';
        state.activeItem = null;
        state.activeType = '';
        if (state.open) {
          renderAll();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var errMsg = err && err.message ? err.message : '读取失败';
      return bs.patchBrowser(contactId, {
        refreshStatus: 'error',
        refreshMessage: errMsg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.browserData = saved;
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
    if (state.refreshing || (state.browserData && state.browserData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function openItem(type, id) {
    var item = findItem(type, id);
    if (!item) return;
    state.activeType = type;
    state.activeItem = item;
    state.view = 'detail';
    renderView();
  }

  function bindEvents() {
    var root = $('dp-browser');
    if (!root || root._dpBrowserBound) return;
    root._dpBrowserBound = true;

    var back = $('dp-browser-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-browser-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    var sections = $('dp-browser-sections');
    if (sections) {
      sections.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-dp-browser-item]');
        if (!btn) return;
        openItem(btn.getAttribute('data-dp-browser-item'), btn.getAttribute('data-dp-browser-id'));
      });
    }

    global.addEventListener('miya-deep-browser-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadBrowserData(cid).then(function () {
        renderAll();
      });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-browser');
    if (!layer) return;

    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.view = 'home';
    state.activeItem = null;
    state.activeType = '';
    state.refreshing = !!activeJobs[state.contactId];

    layer.removeAttribute('hidden');
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });

    loadBrowserData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          browserStore().patchBrowser(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.browserData = fixed;
            renderAll();
          });
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-browser');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    state.open = false;
    state.view = 'home';
    state.activeItem = null;
    state.activeType = '';
    layer.classList.remove('is-open');
    layer.classList.remove('is-detail');
    layer.setAttribute('hidden', '');
  }

  function init() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.miyaDeepBrowser = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
