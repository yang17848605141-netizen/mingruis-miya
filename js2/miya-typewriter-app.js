/**
 * miya-typewriter-app.js — 复古英伦打字机 · 编纂室 & 共读室
 */
(function (global) {
  'use strict';

  var store = global.miyaTypewriterStore;
  if (!store) return;

  var textUtil = global.miyaTypewriterText;
  var readSettings = global.miyaTypewriterSettings;
  var CHARS_PER_PAGE = textUtil ? textUtil.CHARS_PER_PAGE : 520;
  var BOOT_LINES = [
    'INITIALIZING TELEGRAPH…',
    'CALIBRATING PLATEN…',
    'INK RIBBON ENGAGED…',
    'SYNCHRONIZING ARCHIVE…'
  ];

  var vessels = global.miyaTypewriterVessels;

  var ui = {
    tab: 'shelf',
    readingId: null,
    readingPage: 0,
    readerChromeVisible: false,
    bootDone: false,
    settingsOpen: false,
    chaptersDrawerOpen: false
  };

  var bootTimerIds = [];

  function ensureReaderStage() {
    var spread = $('tw-reader-spread');
    if (!spread) return null;
    if (spread.querySelector('#tw-reader-base-body')) return spread;
    spread.innerHTML =
      '<div class="tw-reader__page" id="tw-reader-base">' +
        '<div class="tw-reader__page-body" id="tw-reader-base-body"></div>' +
      '</div>';
    return spread;
  }

  function populatePageBody(pageData, pageNo) {
    var body = $('tw-reader-base-body');
    if (!body) return;
    body.innerHTML = buildPageInnerHtml(pageData, pageNo);
    if (readSettings && readSettings.applyReaderFont) {
      readSettings.applyReaderFont(body.parentElement || body);
    }
  }

  function resetReaderScroll() {
    var page = $('tw-reader-base');
    if (!page) return;
    page.scrollTop = 0;
    requestAnimationFrame(function () {
      page.scrollTop = 0;
    });
  }

  function toggleReaderChrome(force) {
    var reader = $('tw-reader');
    var chrome = $('tw-reader-chrome');
    if (!reader) return;
    ui.readerChromeVisible = typeof force === 'boolean' ? force : !ui.readerChromeVisible;
    reader.classList.toggle('is-show-chrome', ui.readerChromeVisible);
    if (chrome) chrome.hidden = !ui.readerChromeVisible;
  }

  function $(id) { return document.getElementById(id); }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('tw-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  var importProgressUi = null;

  function ensureImportProgress() {
    if (importProgressUi) return importProgressUi;
    var app = $('miya-typewriter-app');
    if (!app) return null;
    var root = document.createElement('div');
    root.className = 'tw-import-progress';
    root.id = 'tw-import-progress';
    root.hidden = true;
    root.innerHTML =
      '<div class="tw-import-progress__veil"></div>' +
      '<div class="tw-import-progress__panel">' +
        '<p class="tw-import-progress__title">Importing Folio</p>' +
        '<p class="tw-import-progress__status" id="tw-import-progress-status">正在导入…</p>' +
        '<div class="tw-import-progress__bar"><div class="tw-import-progress__fill" id="tw-import-progress-fill"></div></div>' +
        '<p class="tw-import-progress__pct" id="tw-import-progress-pct">0%</p>' +
      '</div>';
    app.appendChild(root);
    importProgressUi = {
      root: root,
      status: root.querySelector('#tw-import-progress-status'),
      fill: root.querySelector('#tw-import-progress-fill'),
      pct: root.querySelector('#tw-import-progress-pct')
    };
    return importProgressUi;
  }

  function setImportProgress(pct, status) {
    var panel = ensureImportProgress();
    if (!panel) return;
    panel.root.hidden = false;
    panel.root.classList.add('is-show');
    var p = Math.max(0, Math.min(100, Math.round(pct || 0)));
    if (panel.fill) panel.fill.style.width = p + '%';
    if (panel.pct) panel.pct.textContent = p + '%';
    if (status && panel.status) panel.status.textContent = status;
  }

  function hideImportProgress() {
    if (!importProgressUi) return;
    importProgressUi.root.classList.remove('is-show');
    importProgressUi.root.hidden = true;
    if (importProgressUi.fill) importProgressUi.fill.style.width = '0%';
    if (importProgressUi.pct) importProgressUi.pct.textContent = '0%';
  }

  function formatFileSize(bytes) {
    var n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function confirmDialog(opts) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm(opts);
    }
    var msg = (opts.title || '') + '\n' + (opts.message || '');
    return Promise.resolve(window.confirm(msg));
  }

  function deleteBook(bookId) {
    var book = store.getBook(bookId);
    if (!book) return Promise.resolve();
    return confirmDialog({
      title: '移出藏品',
      message: '确定将「' + book.title + '」从陈列廊移出？删除后无法恢复。',
      confirmText: '删除',
      cancelText: '取消'
    }).then(function (ok) {
      if (!ok) return;
      if (ui.readingId === bookId) closeReader();
      store.removeBook(bookId);
      renderShelf();
      toast('典籍已移出 · ' + book.title);
    });
  }

  function splitPages(content) {
    if (textUtil) return textUtil.splitPages(content);
    var text = String(content || '').trim();
    if (!text) return ['（空白篇章）'];
    var paras = text.split(/\n{2,}/);
    var pages = [];
    var buf = '';
    paras.forEach(function (p) {
      var chunk = p.trim();
      if (!chunk) return;
      if ((buf + '\n\n' + chunk).length > CHARS_PER_PAGE && buf) {
        pages.push(buf.trim());
        buf = chunk;
      } else {
        buf = buf ? buf + '\n\n' + chunk : chunk;
      }
    });
    if (buf) pages.push(buf.trim());
    if (!pages.length) pages.push(text.slice(0, CHARS_PER_PAGE));
    return pages;
  }

  function buildBookPages(book) {
    if (!book) return [];
    if (textUtil) {
      var chapters = book.chapters && book.chapters.length ? book.chapters : null;
      return textUtil.buildPages(chapters || book.content);
    }
    return splitPages(book.content).map(function (text, i) {
      return { text: text, chapterTitle: '', chapterIndex: 0, isChapterStart: i === 0 };
    });
  }

  function vesselLabel(vessel) {
    if (vessels && vessels.LABELS[vessel]) return vessels.LABELS[vessel];
    return 'Archive';
  }

  function vesselArtHtml(vessel) {
    if (vessels) return vessels.html(vessel);
    return '';
  }

  function resolveVessel(book, index) {
    if (vessels) return vessels.resolve(book, index);
    return book.vessel || 'typewriter';
  }

  function renderShelf() {
    var grid = $('tw-shelf-grid');
    if (!grid) return;
    var books = store.getBooks();
    if (!books.length) {
      grid.innerHTML =
        '<div class="tw-empty-shelf">' +
          '<div class="tw-empty-shelf__frame">' +
            '<p class="tw-empty-shelf__script">Empty Folio</p>' +
            '<p class="tw-empty-shelf__text">尚无典籍入藏<br>点击右上角导入 .txt 或 .docx<br>每部典籍将安置于八种复古器物之一</p>' +
          '</div>' +
        '</div>';
      return;
    }
    grid.innerHTML = books.map(function (book, idx) {
      var vessel = resolveVessel(book, idx);
      var label = vesselLabel(vessel);
      var no = String(idx + 1).padStart(2, '0');
      return '<button type="button" class="tw-exhibit tw-exhibit--' + esc(vessel) + '" data-tw-book="' + esc(book.id) + '" aria-label="打开《' + esc(book.title) + '》，长按删除">' +
        '<div class="tw-exhibit__alcove" aria-hidden="true">' +
          '<div class="tw-exhibit__beam"></div>' +
          '<div class="tw-exhibit__haze"></div>' +
          '<div class="tw-exhibit__pedestal"></div>' +
          '<div class="tw-exhibit__object">' + vesselArtHtml(vessel) + '</div>' +
          '<div class="tw-exhibit__shadow"></div>' +
        '</div>' +
        '<figcaption class="tw-exhibit__caption">' +
          '<span class="tw-exhibit__index">Exhibit · ' + no + '</span>' +
          '<p class="tw-exhibit__title">' + esc(book.title) + '</p>' +
          '<p class="tw-exhibit__specimen">' + esc(label) + '</p>' +
        '</figcaption>' +
      '</button>';
    }).join('');
  }

  function formatPageText(text, isFirst) {
    var t = esc(text).replace(/\n/g, '<br>');
    if (isFirst && text.length > 0) {
      var first = text.charAt(0);
      var rest = esc(text.slice(1)).replace(/\n/g, '<br>');
      return '<span class="tw-reader__dropcap">' + esc(first) + '</span>' + rest;
    }
    return t;
  }

  function buildPageInnerHtml(pageData, pageNo) {
    var text = typeof pageData === 'string' ? pageData : (pageData && pageData.text) || '';
    var isFirst = pageNo === 1;
    var isChapterStart = pageData && pageData.isChapterStart && pageData.chapterTitle;
    var chapterHtml = isChapterStart
      ? '<h3 class="tw-reader__chapter">' + esc(pageData.chapterTitle) + '</h3>'
      : '';
    return '<span class="tw-reader__page-corner tw-reader__page-corner--tl"></span>' +
      '<span class="tw-reader__page-corner tw-reader__page-corner--br"></span>' +
      chapterHtml +
      '<p class="tw-reader__text">' + formatPageText(text, isFirst) + '</p>' +
      (text.length > 200 ? '<div class="tw-reader__ornament">· · ❧ · ·</div>' : '') +
      '<span class="tw-reader__page-no">' + pageNo + '</span>';
  }

  function getReaderState() {
    var book = store.getBook(ui.readingId);
    if (!book) return null;
    var pages = buildBookPages(book);
    var total = pages.length;
    var page = Math.min(Math.max(0, ui.readingPage), total - 1);
    return { book: book, pages: pages, total: total, page: page };
  }

  function getActiveReadingContext() {
    if (ui.readingId) {
      var state = getReaderState();
      if (!state) return null;
      return {
        mode: 'solo',
        book: state.book,
        pages: state.pages,
        page: state.page,
        total: state.total
      };
    }
    var rt = global.MiyaTypewriterReadTogether;
    if (rt && rt.getReadingContext) return rt.getReadingContext();
    return null;
  }

  function saveReadingProgress(page) {
    if (!ui.readingId) return;
    store.setProgress(ui.readingId, page);
  }

  function updateReaderChrome(state) {
    var titleEl = $('tw-reader-title');
    var scriptEl = $('tw-reader-script');
    var folioEl = $('tw-reader-folio');
    if (!state) return;
    if (titleEl) titleEl.textContent = state.book.title;
    if (scriptEl) scriptEl.textContent = vesselLabel(state.book.vessel) || 'Reading';
    if (folioEl) {
      var cur = state.pages[state.page] || {};
      var chapterHint = cur.chapterTitle ? (' · ' + cur.chapterTitle) : '';
      folioEl.textContent = String(state.page + 1) + ' / ' + state.total +
        chapterHint +
        ' · ' + Math.round(((state.page + 1) / state.total) * 100) + '%';
    }
  }

  function renderReader() {
    ensureReaderStage();
    var state = getReaderState();
    if (!state) return;

    ui.readingPage = state.page;
    saveReadingProgress(state.page);
    var pageData = state.pages[state.page] || { text: '' };
    populatePageBody(pageData, state.page + 1);
    updateReaderChrome(state);
    resetReaderScroll();
  }

  function goToPage(delta) {
    if (!ui.readingId) return;
    var state = getReaderState();
    if (!state) return;
    var nextPage = state.page + delta;
    if (nextPage < 0 || nextPage >= state.total) return;
    ui.readingPage = nextPage;
    renderReader();
  }

  function getChapterNav(state) {
    if (!state || !state.pages.length) return [];
    var list = [];
    var seen = {};
    state.pages.forEach(function (page, pageIndex) {
      if (!page.isChapterStart) return;
      var ci = page.chapterIndex;
      if (seen[ci]) return;
      seen[ci] = true;
      list.push({
        index: ci,
        title: page.chapterTitle || ('第 ' + (list.length + 1) + ' 章'),
        page: pageIndex
      });
    });
    return list;
  }

  function goToChapter(chapterIndex) {
    var ctx = getActiveReadingContext();
    if (!ctx || !ctx.pages || !ctx.pages.length) return;
    closeChapterDrawer();
    var ci = parseInt(chapterIndex, 10);
    if (isNaN(ci)) return;

    if (ctx.mode === 'solo') {
      for (var i = 0; i < ctx.pages.length; i++) {
        var page = ctx.pages[i];
        if (page.chapterIndex === ci && page.isChapterStart) {
          ui.readingPage = i;
          renderReader();
          closeSettings();
          return;
        }
      }
      return;
    }

    var rt = global.MiyaTypewriterReadTogether;
    if (rt && rt.goToChapterPage && rt.goToChapterPage(ci)) {
      closeSettings();
    }
  }

  function openReader(bookId) {
    var book = store.getBook(bookId);
    if (!book) return;
    ui.readingId = bookId;
    ui.readingPage = book.progress || 0;
    ui.readerChromeVisible = false;
    var reader = $('tw-reader');
    var app = $('miya-typewriter-app');
    if (!reader) return;
    if (app) app.classList.add('is-reading');
    toggleReaderChrome(false);
    renderReader();
    reader.removeAttribute('hidden');
    reader.setAttribute('aria-hidden', 'false');
    reader.classList.add('is-open');
  }

  function closeReader() {
    if (ui.readingId) saveReadingProgress(ui.readingPage);
    ui.readingId = null;
    ui.readerChromeVisible = false;
    var reader = $('tw-reader');
    var spread = $('tw-reader-spread');
    var app = $('miya-typewriter-app');
    if (spread) spread.innerHTML = '';
    if (app) app.classList.remove('is-reading');
    if (reader) {
      reader.classList.remove('is-open', 'is-show-chrome');
      reader.setAttribute('aria-hidden', 'true');
      var chrome = $('tw-reader-chrome');
      if (chrome) chrome.hidden = true;
      clearTimeout(reader._closeTimer);
      reader._closeTimer = setTimeout(function () {
        if (reader.classList.contains('is-open')) return;
        reader.setAttribute('hidden', '');
      }, 200);
    }
  }

  function setTab(tab) {
    ui.tab = tab;
    var app = $('miya-typewriter-app');
    if (app) app.setAttribute('data-tw-tab', tab);
    document.querySelectorAll('.tw-tab').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-tw-tab') === tab);
    });
    document.querySelectorAll('.tw-page').forEach(function (page) {
      page.classList.toggle('is-active', page.getAttribute('data-tw-page') === tab);
    });
    document.querySelectorAll('.tw-masthead__center').forEach(function (center) {
      var isSalon = center.classList.contains('tw-masthead__center--salon');
      center.hidden = tab === 'salon' ? !isSalon : isSalon;
    });
    var importBtn = $('tw-import-btn');
    if (importBtn) importBtn.hidden = tab !== 'shelf';
    if (tab === 'salon' && global.MiyaTypewriterReadTogether) {
      global.MiyaTypewriterReadTogether.renderSalon();
    }
  }

  function clearBootTimers() {
    bootTimerIds.forEach(function (id) { clearTimeout(id); });
    bootTimerIds = [];
  }

  function finishBootAnimation() {
    var boot = $('tw-boot');
    clearBootTimers();
    if (boot) boot.classList.add('is-done');
    ui.bootDone = true;
  }

  function runBootAnimation(cb) {
    var boot = $('tw-boot');
    var status = $('tw-boot-status');
    var bar = $('tw-boot-bar-fill');
    var paper = $('tw-boot-paper');
    var flourish = $('tw-boot-flourish');
    if (!boot) { if (cb) cb(); return; }

    clearBootTimers();
    boot.classList.remove('is-done');
    if (status) {
      status.textContent = '打字机连接中…';
      status.classList.remove('is-success');
    }
    if (bar) bar.style.width = '0%';
    if (flourish) flourish.classList.remove('is-show');

    var step = 0;
    var total = BOOT_LINES.length;

    function tick() {
      if (step < total) {
        if (status) status.textContent = BOOT_LINES[step];
        if (paper) paper.textContent = BOOT_LINES[step].slice(0, 18);
        if (bar) bar.style.width = Math.round(((step + 1) / (total + 1)) * 70) + '%';
        step += 1;
        bootTimerIds.push(setTimeout(tick, 420));
      } else {
        if (status) {
          status.textContent = '◆ 连接成功 ◆';
          status.classList.add('is-success');
        }
        if (bar) bar.style.width = '100%';
        if (flourish) flourish.classList.add('is-show');
        bootTimerIds.push(setTimeout(function () {
          finishBootAnimation();
          if (cb) cb();
        }, 680));
      }
    }

    bootTimerIds.push(setTimeout(tick, 380));
  }

  function skipBootAnimation() {
    finishBootAnimation();
  }

  function ensureSettingsPanel() {
    var panel = $('tw-settings');
    if (panel) {
      var drawer = $('tw-settings-chapters');
      var sheet = panel.querySelector('.tw-settings__sheet');
      if (drawer && sheet && sheet.contains(drawer)) {
        panel.classList.remove('is-chapters-open');
        panel.appendChild(drawer);
      }
      bindChapterDrawerEvents();
      return panel;
    }
    var app = $('miya-typewriter-app');
    if (!app || !readSettings) return null;
    panel = document.createElement('div');
    panel.className = 'tw-settings';
    panel.id = 'tw-settings';
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML =
      '<div class="tw-settings__veil" id="tw-settings-veil"></div>' +
      '<div class="tw-settings__sheet" role="dialog" aria-modal="true" aria-label="阅读设置">' +
        '<header class="tw-settings__head">' +
          '<h2 class="tw-settings__title">阅读设置</h2>' +
          '<button type="button" class="tw-settings__close" id="tw-settings-close" aria-label="关闭">×</button>' +
        '</header>' +
        '<div class="tw-settings__body" id="tw-settings-body"></div>' +
      '</div>' +
      '<div class="tw-settings__chapters-drawer" id="tw-settings-chapters" aria-hidden="true">' +
        '<header class="tw-settings__chapters-head">' +
          '<button type="button" class="tw-settings__chapters-back" id="tw-settings-chapters-back" aria-label="返回">←</button>' +
          '<h3 class="tw-settings__chapters-title">章节跳转</h3>' +
          '<span class="tw-settings__chapters-count" id="tw-settings-chapters-count"></span>' +
        '</header>' +
        '<div class="tw-settings__chapters-list" id="tw-settings-chapters-list"></div>' +
      '</div>';
    app.appendChild(panel);
    bindChapterDrawerEvents();
    return panel;
  }

  function bindChapterDrawerEvents() {
    if (bindChapterDrawerEvents._done) return;
    bindChapterDrawerEvents._done = true;
    var back = $('tw-settings-chapters-back');
    if (back) {
      back.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeChapterDrawer();
      });
    }
    var list = $('tw-settings-chapters-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tw-goto-chapter]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        goToChapter(parseInt(btn.getAttribute('data-tw-goto-chapter'), 10));
      });
    }
  }

  function renderChapterDrawer() {
    var list = $('tw-settings-chapters-list');
    var countEl = $('tw-settings-chapters-count');
    if (!list) return;
    var ctx = getActiveReadingContext();
    if (!ctx) {
      list.innerHTML = '';
      if (countEl) countEl.textContent = '';
      return;
    }
    var chapters = getChapterNav(ctx);
    var currentChapter = ctx.pages[ctx.page] ? ctx.pages[ctx.page].chapterIndex : 0;
    if (countEl) countEl.textContent = chapters.length ? ('共 ' + chapters.length + ' 章') : '';
    list.innerHTML = chapters.map(function (ch, i) {
      return '<button type="button" class="tw-settings__chapter' +
        (ch.index === currentChapter ? ' is-active' : '') +
        '" data-tw-goto-chapter="' + ch.index + '" title="' + esc(ch.title) + '">' +
        '<span class="tw-settings__chapter-no">' + String(i + 1) + '</span>' +
        '<span class="tw-settings__chapter-name">' + esc(ch.title) + '</span>' +
        '</button>';
    }).join('');
  }

  function scrollActiveChapterIntoView() {
    var list = $('tw-settings-chapters-list');
    if (!list) return;
    var active = list.querySelector('.tw-settings__chapter.is-active');
    if (!active) return;
    requestAnimationFrame(function () {
      var target = active.offsetTop - (list.clientHeight - active.offsetHeight) / 2;
      list.scrollTop = Math.max(0, target);
    });
  }

  function openChapterDrawer() {
    ensureSettingsPanel();
    bindChapterDrawerEvents();
    renderChapterDrawer();
    var drawer = $('tw-settings-chapters');
    var panel = $('tw-settings');
    if (!drawer) return;
    ui.chaptersDrawerOpen = true;
    drawer.setAttribute('aria-hidden', 'false');
    drawer.classList.remove('is-open');
    if (panel) panel.classList.add('is-chapters-open');
    void drawer.offsetWidth;
    drawer.classList.add('is-open');
    scrollActiveChapterIntoView();
  }

  function closeChapterDrawer() {
    var drawer = $('tw-settings-chapters');
    var panel = $('tw-settings');
    if (!drawer) return;
    ui.chaptersDrawerOpen = false;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    if (panel) panel.classList.remove('is-chapters-open');
  }

  function renderSettingsPanel() {
    if (!readSettings) return;
    ensureSettingsPanel();
    var body = $('tw-settings-body');
    if (!body) return;
    var s = readSettings.get();
    var fontHtml = readSettings.FONTS.map(function (f) {
      return '<button type="button" class="tw-settings__chip' + (s.fontId === f.id ? ' is-active' : '') +
        '" data-tw-set-font="' + esc(f.id) + '">' + esc(f.label) + '</button>';
    }).join('');
    var bgHtml = readSettings.BG_THEMES.map(function (b) {
      return '<button type="button" class="tw-settings__bg' + (s.bgId === b.id ? ' is-active' : '') +
        '" data-tw-set-bg="' + esc(b.id) + '" title="' + esc(b.label) + '" style="background:' + b.paper + '"></button>';
    }).join('');
    var colorHtml = readSettings.TEXT_COLORS.map(function (c) {
      return '<button type="button" class="tw-settings__color' + (s.colorId === c.id ? ' is-active' : '') +
        '" data-tw-set-color="' + esc(c.id) + '" title="' + esc(c.label) + '" style="background:' + c.value + '"></button>';
    }).join('');
    var chapterEntryHtml = '';
    var readingCtx = getActiveReadingContext();
    if (readingCtx) {
      var chapters = getChapterNav(readingCtx);
      if (chapters.length > 1) {
        var currentPage = readingCtx.pages[readingCtx.page];
        var currentTitle = currentPage && currentPage.chapterTitle
          ? currentPage.chapterTitle
          : '正文';
        chapterEntryHtml =
          '<section class="tw-settings__section">' +
            '<button type="button" class="tw-settings__nav-row" id="tw-settings-chapters-open">' +
              '<span class="tw-settings__nav-main">' +
                '<span class="tw-settings__nav-label">章节跳转</span>' +
                '<span class="tw-settings__nav-meta">' + esc(currentTitle) + ' · 共 ' + chapters.length + ' 章</span>' +
              '</span>' +
              '<span class="tw-settings__nav-arrow" aria-hidden="true">›</span>' +
            '</button>' +
          '</section>';
      }
    }
    body.innerHTML =
      chapterEntryHtml +
      '<section class="tw-settings__section">' +
        '<h3 class="tw-settings__label">字体</h3>' +
        '<div class="tw-settings__chips">' + fontHtml + '</div>' +
      '</section>' +
      '<section class="tw-settings__section">' +
        '<h3 class="tw-settings__label">字号 <span id="tw-settings-size-val">' + s.fontSize + 'px</span></h3>' +
        '<input type="range" class="tw-settings__range" id="tw-settings-size" min="12" max="24" step="1" value="' + s.fontSize + '">' +
      '</section>' +
      '<section class="tw-settings__section">' +
        '<h3 class="tw-settings__label">行间距 <span id="tw-settings-lh-val">' + s.lineHeight + '</span></h3>' +
        '<input type="range" class="tw-settings__range" id="tw-settings-lh" min="1.4" max="2.4" step="0.05" value="' + s.lineHeight + '">' +
      '</section>' +
      '<section class="tw-settings__section">' +
        '<h3 class="tw-settings__label">文字颜色</h3>' +
        '<div class="tw-settings__colors">' + colorHtml + '</div>' +
      '</section>' +
      '<section class="tw-settings__section">' +
        '<h3 class="tw-settings__label">背景模式</h3>' +
        '<div class="tw-settings__bgs">' + bgHtml + '</div>' +
      '</section>';
  }

  function openSettings() {
    if (!readSettings) return;
    ensureSettingsPanel();
    closeChapterDrawer();
    renderSettingsPanel();
    var panel = $('tw-settings');
    if (!panel) return;
    ui.settingsOpen = true;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('is-open');
  }

  function closeSettings() {
    var panel = $('tw-settings');
    if (!panel) return;
    closeChapterDrawer();
    ui.settingsOpen = false;
    if (global.miyaSlidePanel) {
      global.miyaSlidePanel.close(panel, { ms: 280 });
      return;
    }
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    panel.hidden = true;
  }

  function bindSettingsEvents() {
    if (bindSettingsEvents._done || !readSettings) return;
    bindSettingsEvents._done = true;
    var app = $('miya-typewriter-app');
    if (!app) return;

    document.addEventListener('miya-tw-read-typography', function () {
      if (ui.readingId && readSettings && readSettings.applyReaderFont) {
        readSettings.applyReaderFont($('tw-reader'));
      }
    });

    app.addEventListener('click', function (e) {
      if (e.target.closest('#tw-settings-open') || e.target.closest('#tw-rt-settings-open')) {
        e.stopPropagation();
        openSettings();
        return;
      }
      if (e.target.closest('#tw-settings-close') || e.target.closest('#tw-settings-veil')) {
        closeSettings();
        return;
      }
      if (e.target.closest('#tw-settings-chapters-open')) {
        e.stopPropagation();
        openChapterDrawer();
        return;
      }
      var fontBtn = e.target.closest('[data-tw-set-font]');
      if (fontBtn) {
        readSettings.update({ fontId: fontBtn.getAttribute('data-tw-set-font') });
        renderSettingsPanel();
        return;
      }
      var bgBtn = e.target.closest('[data-tw-set-bg]');
      if (bgBtn) {
        readSettings.update({ bgId: bgBtn.getAttribute('data-tw-set-bg') });
        renderSettingsPanel();
        return;
      }
      var colorBtn = e.target.closest('[data-tw-set-color]');
      if (colorBtn) {
        readSettings.update({ colorId: colorBtn.getAttribute('data-tw-set-color') });
        renderSettingsPanel();
        return;
      }
    });

    app.addEventListener('input', function (e) {
      if (e.target.id === 'tw-settings-size') {
        var v = parseInt(e.target.value, 10) || 15;
        readSettings.update({ fontSize: v });
        var lbl = $('tw-settings-size-val');
        if (lbl) lbl.textContent = v + 'px';
      }
      if (e.target.id === 'tw-settings-lh') {
        var lh = parseFloat(e.target.value) || 1.82;
        readSettings.update({ lineHeight: lh });
        var lhLbl = $('tw-settings-lh-val');
        if (lhLbl) lhLbl.textContent = String(lh);
      }
    });
  }

  function handleImport(file) {
    if (!file) return;
    var ext = String(file.name || '').toLowerCase();
    if (!/\.(txt|docx)$/.test(ext)) {
      toast('仅支持 .txt 或 .docx 格式');
      return;
    }
    var extract = global.miyaWorldbookExtractFileText;
    if (!extract) {
      toast('导入模块未就绪');
      return;
    }

    var showProgress = file.size > 48 * 1024;
    if (showProgress) {
      setImportProgress(0, '准备导入 · ' + formatFileSize(file.size));
    } else {
      toast('正在解析文稿…');
    }

    extract(file, {
      onProgress: function (pct, status) {
        if (showProgress) setImportProgress(pct, status);
      }
    }).then(function (text) {
      setImportProgress(92, '正在写入书库…');
      return new Promise(function (resolve) {
        setTimeout(function () {
          var content = String(text || '').trim();
          if (!content) {
            hideImportProgress();
            toast('文件内容为空');
            resolve(null);
            return;
          }
          var title = file.name.replace(/\.(txt|docx)$/i, '') || '未命名';
          var parsed = textUtil ? textUtil.parseImportedText(content) : { chapters: [], content: content };
          store.addBook(title, parsed.content, parsed.chapters);
          renderShelf();
          var chCount = parsed.chapters ? parsed.chapters.length : 0;
          setImportProgress(100, '导入完成');
          setTimeout(function () {
            hideImportProgress();
            toast('典籍已入藏 · ' + title + (chCount > 1 ? ' · ' + chCount + ' 章' : ''));
          }, showProgress ? 260 : 0);
          resolve(title);
        }, 0);
      });
    }).catch(function () {
      hideImportProgress();
      toast('导入失败，请检查文件格式');
    });
  }

  function bindEvents() {
    if (bindEvents._done) return;
    bindEvents._done = true;
    bindSettingsEvents();

    var bootSkip = $('tw-boot-skip');
    if (bootSkip) bootSkip.addEventListener('click', function (e) {
      e.stopPropagation();
      skipBootAnimation();
    });

    var back = $('tw-back');
    if (back) back.addEventListener('click', closeApp);

    document.querySelectorAll('.tw-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTab(btn.getAttribute('data-tw-tab') || 'shelf');
      });
    });

    var importBtn = $('tw-import-btn');
    var fileInput = $('tw-file-input');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (f) handleImport(f);
        fileInput.value = '';
      });
    }

    var grid = $('tw-shelf-grid');
    var shelfPress = {
      timer: null,
      card: null,
      bookId: null,
      pointerId: null,
      startX: 0,
      startY: 0,
      suppressClickUntil: 0
    };

    function clearShelfPress() {
      if (shelfPress.timer) clearTimeout(shelfPress.timer);
      if (shelfPress.card) shelfPress.card.classList.remove('is-longpressing');
      shelfPress.timer = null;
      shelfPress.card = null;
      shelfPress.bookId = null;
      shelfPress.pointerId = null;
    }

    if (grid) {
      grid.addEventListener('click', function (e) {
        if (Date.now() < shelfPress.suppressClickUntil) return;
        var card = e.target.closest('[data-tw-book]');
        if (!card) return;
        openReader(card.getAttribute('data-tw-book'));
      });

      grid.addEventListener('contextmenu', function (e) {
        var card = e.target.closest('[data-tw-book]');
        if (!card) return;
        e.preventDefault();
        shelfPress.suppressClickUntil = Date.now() + 400;
        deleteBook(card.getAttribute('data-tw-book'));
      });

      grid.addEventListener('pointerdown', function (e) {
        if (e.button > 0) return;
        var card = e.target.closest('[data-tw-book]');
        if (!card) return;
        clearShelfPress();
        shelfPress.card = card;
        shelfPress.bookId = card.getAttribute('data-tw-book');
        shelfPress.pointerId = e.pointerId;
        shelfPress.startX = e.clientX;
        shelfPress.startY = e.clientY;
        card.classList.add('is-longpressing');
        shelfPress.timer = setTimeout(function () {
          shelfPress.timer = null;
          var id = shelfPress.bookId;
          shelfPress.suppressClickUntil = Date.now() + 420;
          clearShelfPress();
          if (global.navigator && navigator.vibrate) navigator.vibrate(16);
          deleteBook(id);
        }, 520);
      }, { passive: true });

      grid.addEventListener('pointermove', function (e) {
        if (shelfPress.pointerId == null || e.pointerId !== shelfPress.pointerId) return;
        if (Math.abs(e.clientX - shelfPress.startX) > 12 || Math.abs(e.clientY - shelfPress.startY) > 12) {
          clearShelfPress();
        }
      }, { passive: true });

      grid.addEventListener('pointerup', clearShelfPress);
      grid.addEventListener('pointercancel', clearShelfPress);
    }

    var readerBack = $('tw-reader-back');
    if (readerBack) {
      readerBack.addEventListener('click', function (e) {
        e.stopPropagation();
        closeReader();
      });
    }

    var settingsOpenBtn = $('tw-settings-open');
    if (settingsOpenBtn) {
      settingsOpenBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openSettings();
      });
    }

    var rtSettingsOpenBtn = $('tw-rt-settings-open');
    if (rtSettingsOpenBtn) {
      rtSettingsOpenBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openSettings();
      });
    }

    var chrome = $('tw-reader-chrome');
    if (chrome) {
      chrome.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    var book = $('tw-reader-book');
    var pointer = { x: 0, y: 0, t: 0, moved: false, active: false, id: null, suppressClick: false };

    function handleReaderTap(clientX, bookEl) {
      if (!bookEl) {
        toggleReaderChrome();
        return;
      }
      var rect = bookEl.getBoundingClientRect();
      if (!rect.width) {
        toggleReaderChrome();
        return;
      }
      var relX = (clientX - rect.left) / rect.width;
      if (relX < 0.28) goToPage(-1);
      else if (relX > 0.72) goToPage(1);
      else toggleReaderChrome();
    }

    function onReaderPointerEnd(clientX, clientY, bookEl) {
      if (!ui.readingId) return;
      var dx = clientX - pointer.x;
      var dy = clientY - pointer.y;
      var dt = Date.now() - pointer.t;

      if (!pointer.moved && Math.abs(dx) < 14 && Math.abs(dy) < 14 && dt < 420) {
        handleReaderTap(clientX, bookEl);
        return;
      }
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.15) {
        if (dx < 0) goToPage(1);
        else goToPage(-1);
      }
    }

    if (book) {
      book.addEventListener('pointerdown', function (e) {
        if (!ui.readingId || e.button > 0) return;
        pointer.active = true;
        pointer.id = e.pointerId;
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.t = Date.now();
        pointer.moved = false;
      });

      book.addEventListener('pointermove', function (e) {
        if (!pointer.active || e.pointerId !== pointer.id) return;
        if (Math.abs(e.clientX - pointer.x) > 8 || Math.abs(e.clientY - pointer.y) > 8) {
          pointer.moved = true;
        }
      });

      book.addEventListener('pointerup', function (e) {
        if (!pointer.active || e.pointerId !== pointer.id) return;
        onReaderPointerEnd(e.clientX, e.clientY, book);
        pointer.active = false;
        pointer.id = null;
        pointer.suppressClick = true;
      });

      book.addEventListener('pointercancel', function (e) {
        if (e.pointerId !== pointer.id) return;
        pointer.active = false;
        pointer.id = null;
        pointer.suppressClick = true;
      });

      book.addEventListener('click', function (e) {
        if (!ui.readingId) return;
        if (pointer.suppressClick) {
          pointer.suppressClick = false;
          return;
        }
        handleReaderTap(e.clientX, book);
      });
    }

    document.addEventListener('keydown', function (e) {
      if (!ui.readingId) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goToPage(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        goToPage(1);
      }
    });
  }

  function openApp() {
    var el = $('miya-typewriter-app');
    if (!el) return;
    bindEvents();
    var settingsLoad = readSettings ? readSettings.load() : Promise.resolve();
    Promise.all([store.load(), settingsLoad]).then(function () {
      closeReader();
      setTab('shelf');
      renderShelf();
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      if (!ui.bootDone) {
        runBootAnimation();
      } else {
        var boot = $('tw-boot');
        if (boot) boot.classList.add('is-done');
      }
    });
  }

  function closeApp() {
    closeReader();
    if (global.MiyaTypewriterReadTogether && global.MiyaTypewriterReadTogether.isInRoom()) {
      global.MiyaTypewriterReadTogether.closeRoom();
    }
    var el = $('miya-typewriter-app');
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-worldbook-app.is-open') &&
        !document.querySelector('#miya-music-app.is-open') &&
        !document.querySelector('#miya-chat-app.is-open') &&
        !document.querySelector('.miya-memory-app.is-open') &&
        !document.querySelector('.miya-contacts-app.is-open') &&
        !document.querySelector('.miya-offline-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  global.miyaTypewriterApp = {
    open: openApp,
    close: closeApp
  };
})(window);
