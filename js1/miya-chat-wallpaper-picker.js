/**
 * Miya 聊天 · 壁纸库快捷选用（联系人 / 群聊设置共用）
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escAttr(s) {
    return esc(s).replace(/[\r\n\u2028\u2029]/g, '');
  }

  function getStore() {
    return global.miyaChatStore || null;
  }

  function renderLibrary(currentBf, opts) {
    opts = opts || {};
    var libAttr = opts.libAttr || 'data-mq-set-wall-lib';
    var manageAttr = opts.manageAttr || 'data-mq-set-wall-manage';
    var urlAttr = opts.urlAttr || 'data-mq-wall-lib-url';
    var blobAttr = opts.blobAttr || 'data-mq-wall-lib-blob';
    var expanded = !!opts.expanded;

    var head =
      '<div class="mi-wall-lib__toolbar">' +
        '<p class="st-form-hint mi-wall-lib__hint">从壁纸库快捷选用</p>' +
        '<button type="button" class="st-foot-btn st-foot-btn--xs" ' + manageAttr + '>管理壁纸</button>' +
      '</div>';

    var st = getStore();
    var list = st && st.getChatWallpapers ? st.getChatWallpapers() : null;
    var count = list ? list.length : 0;
    var meta = list ? (count ? count + ' 张' : '暂无') : '…';
    var body;

    if (!list) {
      body = '<p class="mi-empty-hint mi-wall-lib__empty">壁纸库加载中…</p>';
    } else if (!count) {
      body = '<p class="mi-empty-hint mi-wall-lib__empty">暂无壁纸，点「管理壁纸」可一次上传多张</p>';
    } else {
      var curId = currentBf && currentBf.wallpaperMode === 'idb' ? String(currentBf.wallpaperId || '') : '';
      var curUrl = currentBf && currentBf.wallpaperMode === 'url' ? String(currentBf.wallpaperUrl || '') : '';
      body = '<div class="mi-wall-lib__grid">' + list.map(function (wp) {
        var active = (wp.blobId && curId === wp.blobId) || (wp.url && curUrl === wp.url);
        var thumb = wp.url
          ? ' ' + urlAttr + '="' + escAttr(wp.url) + '"'
          : ' ' + blobAttr + '="' + escAttr(wp.blobId) + '"';
        return '<button type="button" class="mi-wall-lib-cell' + (active ? ' is-active' : '') + '"' +
          ' ' + libAttr + '="' + esc(wp.id) + '"' + thumb +
          ' aria-label="' + esc(wp.name || '壁纸') + '" title="' + esc(wp.name || '壁纸') + '">' +
          (active ? '<span class="mi-wall-lib-cell__check" aria-hidden="true">✓</span>' : '') +
        '</button>';
      }).join('') + '</div>';
    }

    return '<div class="mi-wall-lib mi-wall-lib-panel' + (expanded ? ' is-open' : '') + '" data-mi-wall-lib-panel>' +
      '<button type="button" class="mi-wall-lib-toggle" data-mi-wall-lib-toggle aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
        '<strong class="mi-wall-lib-toggle__title">壁纸库</strong>' +
        '<span class="mi-wall-lib-toggle__meta">' + esc(meta) + '</span>' +
        '<svg class="st-chevron mi-wall-lib-toggle__chev" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
      '</button>' +
      '<div class="mi-wall-lib-body"' + (expanded ? '' : ' hidden') + ' data-mi-wall-lib-body>' +
        head + body +
      '</div>' +
    '</div>';
  }

  function togglePanel(panel, forceOpen) {
    if (!panel) return false;
    var body = panel.querySelector('[data-mi-wall-lib-body]');
    var toggle = panel.querySelector('[data-mi-wall-lib-toggle]');
    if (!body) return false;
    var nextOpen = typeof forceOpen === 'boolean'
      ? forceOpen
      : !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', nextOpen);
    body.hidden = !nextOpen;
    if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    return nextOpen;
  }

  function bindPanel(root) {
    if (!root || root._miWallLibBound) return;
    root._miWallLibBound = true;
    root.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-mi-wall-lib-toggle]');
      if (!toggle || !root.contains(toggle)) return;
      e.preventDefault();
      togglePanel(toggle.closest('[data-mi-wall-lib-panel]'));
    });
  }

  function hydrateThumbs(root, opts) {
    opts = opts || {};
    var urlAttr = opts.urlAttr || 'data-mq-wall-lib-url';
    var blobAttr = opts.blobAttr || 'data-mq-wall-lib-blob';
    var st = getStore();
    if (!root) return;
    bindPanel(root);
    root.querySelectorAll('[' + urlAttr + ']').forEach(function (el) {
      var url = el.getAttribute(urlAttr);
      if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
    });
    if (!st || !st.getChatWallpaperUrl) return;
    root.querySelectorAll('[' + blobAttr + ']').forEach(function (el) {
      var bid = el.getAttribute(blobAttr);
      if (!bid) return;
      st.getChatWallpaperUrl({ blobId: bid }).then(function (url) {
        if (url) el.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
      });
    });
  }

  function applyWallpaperToChat(chatId, wp) {
    var st = getStore();
    if (!st || !chatId || !wp) return Promise.reject(new Error('invalid'));
    var patch = { wallpaperMode: 'none', wallpaperId: null, wallpaperUrl: '' };
    if (wp.url) {
      patch.wallpaperMode = 'url';
      patch.wallpaperUrl = wp.url;
    } else if (wp.blobId) {
      patch.wallpaperMode = 'idb';
      patch.wallpaperId = wp.blobId;
    }
    return st.saveChatSettings(chatId, {
      chatBeautify: Object.assign({}, st.getChatSettings(chatId).chatBeautify, patch)
    }).then(function () {
      if (global.MiyaChatBeautify) return global.MiyaChatBeautify.applyForChat(chatId);
    });
  }

  function findWallpaper(wpId) {
    var st = getStore();
    if (!st || !st.getChatWallpapers || !wpId) return null;
    return st.getChatWallpapers().find(function (w) { return w && w.id === wpId; }) || null;
  }

  function openManage() {
    if (global.miyaChatMe && global.miyaChatMe.openWallpapers) {
      global.miyaChatMe.openWallpapers();
    }
  }

  global.MiyaChatWallpaperPicker = {
    renderLibrary: renderLibrary,
    hydrateThumbs: hydrateThumbs,
    togglePanel: togglePanel,
    applyWallpaperToChat: applyWallpaperToChat,
    findWallpaper: findWallpaper,
    openManage: openManage
  };
})(window);
