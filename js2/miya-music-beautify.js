/**
 * miya-music-beautify.js — 音乐外观装修（全屏子页）& 桌面歌词 CSS
 */
(function (global) {
  'use strict';

  var eng = global.miyaMusicEngine;
  if (!eng) return;

  var PRESETS_LS = 'miya-music-appearance-presets-v1';
  var MDL_STYLE_ID = 'ncm-mdl-beautify-style';
  var MDL_PREVIEW_STYLE_ID = 'ncm-mdl-preview-style';
  var MAX_PRESETS = 24;
  var presetsCache = null;
  var vinylCoverUrlCache = '';
  var panelBound = false;
  var mdlPreviewTimer = null;

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaMusicApp && global.miyaMusicApp.toast) {
      global.miyaMusicApp.toast(msg);
      return;
    }
    var el = document.createElement('div');
    el.className = 'ncm-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-visible'); });
    setTimeout(function () {
      el.classList.remove('is-visible');
      setTimeout(function () { el.remove(); }, 350);
    }, 2200);
  }

  function promptFn(opts) {
    if (global.miyaDialog && global.miyaDialog.prompt) {
      return global.miyaDialog.prompt(opts);
    }
    return Promise.resolve(prompt(opts.message || opts.title || '', opts.defaultValue || ''));
  }

  function confirmFn(opts) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm(opts);
    }
    return Promise.resolve(confirm(opts.message || opts.title || ''));
  }

  function copyText(text) {
    var t = String(text || '');
    if (!t) return Promise.reject(new Error('empty'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = t;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  function getSourceRef() {
    if (global.MIYA_MUSIC_BEAUTIFY_SOURCE_REF) return String(global.MIYA_MUSIC_BEAUTIFY_SOURCE_REF);
    return '# Miya 桌面歌词 · CSS 选择器参考\n#miya-desk-lyrics.mdl';
  }

  function loadPresets() {
    if (presetsCache) return presetsCache;
    try {
      var raw = localStorage.getItem(PRESETS_LS);
      var arr = raw ? JSON.parse(raw) : [];
      presetsCache = Array.isArray(arr) ? arr : [];
    } catch (e) {
      presetsCache = [];
    }
    return presetsCache;
  }

  function savePresets(list) {
    presetsCache = list;
    try {
      localStorage.setItem(PRESETS_LS, JSON.stringify(list));
    } catch (e) {
      toast('预设保存失败');
    }
  }

  function normalizePreset(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim().slice(0, 32);
    if (!name) return null;
    var minePageBg = raw.minePageBg || raw.homeBg || null;
    return {
      name: name,
      minePageBg: minePageBg ? String(minePageBg) : null,
      profileAvatar: raw.profileAvatar ? String(raw.profileAvatar) : null,
      profileNickname: String(raw.profileNickname || '').trim().slice(0, 32),
      mineStatusText: String(raw.mineStatusText || '').trim().slice(0, 32),
      playerBg: raw.playerBg ? String(raw.playerBg) : null,
      vinylCover: raw.vinylCover ? String(raw.vinylCover) : null,
      playerLyricsColor: String(raw.playerLyricsColor || '').trim().slice(0, 32),
      playerLyricsFontSize: Number(raw.playerLyricsFontSize) || 0,
      desktopLyricsCss: String(raw.desktopLyricsCss || ''),
      createdAt: Number(raw.createdAt) || Date.now()
    };
  }

  function injectMdlStyle(css) {
    var el = document.getElementById(MDL_STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = MDL_STYLE_ID;
      document.body.appendChild(el);
    }
    el.textContent = String(css || '');
    return el;
  }

  function cssForMdlPreview(css) {
    return String(css || '').replace(/#miya-desk-lyrics/g, '#ncm-mdl-preview');
  }

  function injectMdlPreviewStyle(css) {
    var el = document.getElementById(MDL_PREVIEW_STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = MDL_PREVIEW_STYLE_ID;
      document.body.appendChild(el);
    }
    el.textContent = cssForMdlPreview(css);
    return el;
  }

  function applyMdlPreviewCss(css) {
    injectMdlPreviewStyle(css);
    var preview = document.getElementById('ncm-mdl-preview');
    if (preview) {
      preview.classList.toggle('has-custom-css', !!(css && css.trim()));
    }
  }

  function buildMdlPreviewHtml() {
    return (
      '<div class="mdl ncm-ap-mdl-preview is-visible is-playing" id="ncm-mdl-preview">' +
        '<div class="mdl__panel">' +
          '<div class="mdl__border" aria-hidden="true"></div>' +
          '<div class="mdl__aurora" aria-hidden="true"></div>' +
          '<div class="mdl__grain" aria-hidden="true"></div>' +
          '<div class="mdl__scan" aria-hidden="true"></div>' +
          '<span class="mdl__corner mdl__corner--tl" aria-hidden="true"></span>' +
          '<span class="mdl__corner mdl__corner--br" aria-hidden="true"></span>' +
          '<header class="mdl__bar">' +
            '<div class="mdl__bar-left">' +
              '<span class="mdl__pulse" aria-hidden="true"></span>' +
              '<span class="mdl__tag">Now Playing</span>' +
            '</div>' +
            '<div class="mdl__bar-actions">' +
              '<span class="mdl__shrink" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>' +
              '</span>' +
              '<span class="mdl__close" aria-hidden="true">×</span>' +
            '</div>' +
          '</header>' +
          '<div class="mdl__body">' +
            '<div class="mdl__cover-wrap is-fallback" data-fallback="♪">' +
              '<span class="mdl__cover-ring" aria-hidden="true"></span>' +
              '<img class="mdl__cover mdl__cover--fallback" alt="" hidden>' +
            '</div>' +
            '<div class="mdl__meta">' +
              '<p class="mdl__title">夜曲</p>' +
              '<p class="mdl__artist">周杰伦</p>' +
            '</div>' +
            '<div class="mdl__lyrics mdl__expand-only">' +
              '<p class="mdl__line mdl__line--current">为你弹奏肖邦的夜曲</p>' +
              '<p class="mdl__line mdl__line--next">纪念我死去的爱情</p>' +
            '</div>' +
          '</div>' +
          '<div class="mdl__progress mdl__expand-only" aria-hidden="true">' +
            '<i class="mdl__progress-fill" style="width:42%"></i>' +
          '</div>' +
          '<footer class="mdl__ctrl mdl__expand-only">' +
            '<span class="mdl__btn" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>' +
            '</span>' +
            '<span class="mdl__btn mdl__btn--play" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' +
            '</span>' +
            '<span class="mdl__btn" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2V6zM6 18l8.5-6L6 6v12z"/></svg>' +
            '</span>' +
          '</footer>' +
        '</div>' +
      '</div>'
    );
  }

  var AP_ICON = {
    mine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5L5 21"/></svg>',
    profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
    status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12h16M12 4v16" stroke-linecap="round" opacity="0.4"/><circle cx="12" cy="12" r="8"/></svg>',
    player: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l6 3-6 3V9z" fill="currentColor" stroke="none"/></svg>',
    vinyl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="6" opacity="0.35"/></svg>',
    lyrics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 18V6l4 3 4-3 4 3 4-3v12" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 15h8M8 12h5" stroke-linecap="round"/></svg>',
    mdl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h4M7 13h6" stroke-linecap="round"/><circle cx="17" cy="9" r="2" fill="currentColor" stroke="none"/></svg>'
  };

  function cardHead(icon, title, hint) {
    return (
      '<div class="ncm-ap-card__head">' +
        '<div class="ncm-ap-card__icon">' + icon + '</div>' +
        '<div class="ncm-ap-card__meta">' +
          '<h3 class="ncm-ap-card__title">' + title + '</h3>' +
          '<p class="ncm-ap-card__hint">' + hint + '</p>' +
        '</div>' +
      '</div>'
    );
  }

  function resolveUrl(ref) {
    if (!ref) return Promise.resolve(null);
    if (global.miyaResolveMediaUrl) return global.miyaResolveMediaUrl(ref);
    return Promise.resolve(typeof ref === 'string' ? ref : null);
  }

  function hexToRgb(hex) {
    var h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length !== 6) return null;
    var n = parseInt(h, 16);
    if (!Number.isFinite(n)) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbaFromHex(hex, alpha) {
    var rgb = hexToRgb(hex);
    if (!rgb) return '';
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
  }

  function applyPlayerLyricsTheme(ap) {
    var page = document.querySelector('#miya-music-app .ncm-page--player');
    if (!page) return;
    var props = [
      '--ncm-lyrics-color-active',
      '--ncm-lyrics-color-near',
      '--ncm-lyrics-color-dim',
      '--ncm-lyrics-font-size'
    ];
    if (ap.playerLyricsColor) {
      var c = ap.playerLyricsColor;
      page.style.setProperty('--ncm-lyrics-color-active', c);
      page.style.setProperty('--ncm-lyrics-color-near', rgbaFromHex(c, 0.58) || c);
      page.style.setProperty('--ncm-lyrics-color-dim', rgbaFromHex(c, 0.32) || c);
    } else {
      props.slice(0, 3).forEach(function (p) { page.style.removeProperty(p); });
    }
    if (ap.playerLyricsFontSize) {
      page.style.setProperty('--ncm-lyrics-font-size', ap.playerLyricsFontSize + 'px');
    } else {
      page.style.removeProperty('--ncm-lyrics-font-size');
    }
  }

  function applyMineStatusText(ap) {
    var el = document.getElementById('ncm-mine-status');
    if (!el) return;
    el.textContent = ap.mineStatusText || '添加状态';
  }

  function applyBgToEl(el, ref, classOn) {
    if (!el) return Promise.resolve();
    if (!ref) {
      el.style.backgroundImage = '';
      if (classOn) el.classList.remove(classOn);
      return Promise.resolve();
    }
    return resolveUrl(ref).then(function (url) {
      if (!url) {
        el.style.backgroundImage = '';
        if (classOn) el.classList.remove(classOn);
        return;
      }
      el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      if (classOn) el.classList.add(classOn);
    });
  }

  function applyAppearance() {
    var ap = eng.getAppearance();
    var mineHeader = document.querySelector('#miya-music-app .ncm-mine-header');
    var playerPage = document.querySelector('#miya-music-app .ncm-page--player');
    var mineBgEl = document.getElementById('ncm-mine-page-bg');
    var sceneBgEl = document.getElementById('ncm-player-scene-bg');
    var avatarEl = document.querySelector('#miya-music-app .ncm-profile__avatar');
    var mdlRoot = document.getElementById('miya-desk-lyrics');

    if (mineHeader) {
      mineHeader.classList.toggle('has-custom-mine-bg', !!ap.minePageBg);
    }
    if (playerPage) {
      playerPage.classList.toggle('has-custom-player-bg', !!ap.playerBg);
    }

    applyPlayerLyricsTheme(ap);
    applyMineStatusText(ap);

    var promises = [
      applyBgToEl(mineBgEl, ap.minePageBg, 'has-image'),
      applyBgToEl(sceneBgEl, ap.playerBg, 'has-image')
    ];

    if (avatarEl) {
      if (!ap.profileAvatar) {
        avatarEl.style.backgroundImage = '';
        avatarEl.classList.remove('has-custom-avatar');
      } else {
        promises.push(
          resolveUrl(ap.profileAvatar).then(function (url) {
            if (!url) return;
            avatarEl.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
            avatarEl.classList.add('has-custom-avatar');
          })
        );
      }
    }

    if (ap.vinylCover) {
      promises.push(
        resolveUrl(ap.vinylCover).then(function (url) {
          vinylCoverUrlCache = url || '';
          if (global.miyaMusicApp && global.miyaMusicApp.invalidateCoverUi) {
            global.miyaMusicApp.invalidateCoverUi();
          } else if (global.miyaMusicApp && global.miyaMusicApp._tickUi) {
            global.miyaMusicApp._tickUi(true);
          }
        })
      );
    } else {
      vinylCoverUrlCache = '';
      if (global.miyaMusicApp && global.miyaMusicApp.invalidateCoverUi) {
        global.miyaMusicApp.invalidateCoverUi();
      }
    }

    injectMdlStyle(ap.desktopLyricsCss || '');
    if (mdlRoot) {
      mdlRoot.classList.toggle('has-custom-css', !!(ap.desktopLyricsCss && ap.desktopLyricsCss.trim()));
    }

    return Promise.all(promises);
  }

  function storeImageFile(file, replaceId) {
    if (!global.miyaStoreImageFile) return Promise.reject(new Error('图片存储不可用'));
    var opts = replaceId ? { replaceId: replaceId } : undefined;
    return global.miyaStoreImageFile(file, opts);
  }

  function buildPresetOptionsHtml(selected) {
    var list = loadPresets();
    var html = '<option value="">选择已存预设</option>';
    list.forEach(function (p) {
      html += '<option value="' + esc(p.name) + '"' + (p.name === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return html;
  }

  function renderAppearancePanel() {
    var ap = eng.getAppearance();
    var presetHint = ap.desktopLyricsPresetName
      ? '当前预设「' + esc(ap.desktopLyricsPresetName) + '」'
      : (ap.desktopLyricsCss ? '已写入桌面歌词 CSS' : '未选用预设');
    var lyricsColor = ap.playerLyricsColor || '#ffffff';

    return (
      '<div class="ncm-appearance-panel" id="ncm-appearance-panel">' +

        '<div class="ncm-ap-hero">' +
          '<div class="ncm-ap-hero__badge"><span class="ncm-ap-hero__badge-dot"></span>Music Atelier</div>' +
          '<h2 class="ncm-ap-hero__title">定制你的音乐空间</h2>' +
          '<p class="ncm-ap-hero__desc">背景、头像、唱片与播放页歌词样式 · 下方自定义 CSS <strong>仅</strong>作用于桌面歌词悬浮层</p>' +
        '</div>' +

        '<div class="ncm-ap-preset-bar">' +
          '<div class="ncm-ap-preset-bar__head">' +
            '<span class="ncm-ap-preset-bar__label">装修预设</span>' +
            '<span class="ncm-ap-preset-bar__status">' + presetHint + '</span>' +
          '</div>' +
          '<div class="ncm-ap-preset-bar__row">' +
            '<select class="ncm-appearance-select" id="ncm-ap-preset-pick">' + buildPresetOptionsHtml(ap.desktopLyricsPresetName) + '</select>' +
          '</div>' +
          '<div class="ncm-ap-preset-bar__actions">' +
            '<button type="button" class="ncm-appearance-btn" data-ncm-ap-preset-save>保存为预设</button>' +
            '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-preset-load>读取预设</button>' +
            '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-preset-delete>删除预设</button>' +
          '</div>' +
        '</div>' +

        '<div class="ncm-ap-grid ncm-ap-grid--duo">' +

          '<article class="ncm-ap-card ncm-ap-card--wide">' +
            cardHead(AP_ICON.mine, '我的页背景', '「我的」页顶部深色区域背景') +
            '<div class="ncm-appearance-preview' + (ap.minePageBg ? ' has-image' : '') + '" id="ncm-ap-preview-mine"></div>' +
            '<div class="ncm-appearance-actions">' +
              '<button type="button" class="ncm-appearance-btn" data-ncm-ap-upload="minePageBg">上传图片</button>' +
              '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-clear="minePageBg"' + (ap.minePageBg ? '' : ' disabled') + '>删除</button>' +
            '</div>' +
          '</article>' +

          '<article class="ncm-ap-card">' +
            cardHead(AP_ICON.profile, '头像与昵称', '仅影响「我的」页展示') +
            '<div class="ncm-appearance-row">' +
              '<div class="ncm-appearance-preview ncm-appearance-preview--round' + (ap.profileAvatar ? ' has-image' : '') + '" id="ncm-ap-preview-avatar"></div>' +
              '<div class="ncm-appearance-field">' +
                '<label class="ncm-appearance-label" for="ncm-ap-nickname">昵称</label>' +
                '<input type="text" class="ncm-appearance-input" id="ncm-ap-nickname" maxlength="32" placeholder="自定义昵称" value="' + esc(ap.profileNickname) + '">' +
              '</div>' +
            '</div>' +
            '<div class="ncm-appearance-actions">' +
              '<button type="button" class="ncm-appearance-btn" data-ncm-ap-upload="profileAvatar">上传头像</button>' +
              '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-clear="profileAvatar"' + (ap.profileAvatar ? '' : ' disabled') + '>删除</button>' +
              '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-save-nickname>保存昵称</button>' +
            '</div>' +
          '</article>' +

          '<article class="ncm-ap-card">' +
            cardHead(AP_ICON.status, '状态文案', '顶栏中间文字，留空显示「添加状态」') +
            '<input type="text" class="ncm-appearance-input" id="ncm-ap-status" maxlength="32" placeholder="添加状态" value="' + esc(ap.mineStatusText) + '">' +
            '<div class="ncm-appearance-actions">' +
              '<button type="button" class="ncm-appearance-btn" data-ncm-ap-save-status>保存状态</button>' +
              '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-clear="mineStatusText"' + (ap.mineStatusText ? '' : ' disabled') + '>恢复默认</button>' +
            '</div>' +
          '</article>' +

          '<article class="ncm-ap-card">' +
            cardHead(AP_ICON.player, '播放器大背景', '铺满播放页整屏装饰层') +
            '<div class="ncm-appearance-preview' + (ap.playerBg ? ' has-image' : '') + '" id="ncm-ap-preview-player"></div>' +
            '<div class="ncm-appearance-actions">' +
              '<button type="button" class="ncm-appearance-btn" data-ncm-ap-upload="playerBg">上传图片</button>' +
              '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-clear="playerBg"' + (ap.playerBg ? '' : ' disabled') + '>删除</button>' +
            '</div>' +
          '</article>' +

          '<article class="ncm-ap-card">' +
            cardHead(AP_ICON.vinyl, '唱片封面', '自定义首页唱片中心封面') +
            '<div class="ncm-appearance-preview ncm-appearance-preview--disc' + (ap.vinylCover ? ' has-image' : '') + '" id="ncm-ap-preview-vinyl"></div>' +
            '<div class="ncm-appearance-actions">' +
              '<button type="button" class="ncm-appearance-btn" data-ncm-ap-upload="vinylCover">上传封面</button>' +
              '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-clear="vinylCover"' + (ap.vinylCover ? '' : ' disabled') + '>删除</button>' +
            '</div>' +
          '</article>' +

          '<article class="ncm-ap-card ncm-ap-card--wide">' +
            cardHead(AP_ICON.lyrics, '播放页歌词样式', '仅影响首页点击唱片后的歌词展示') +
            '<div class="ncm-ap-lyrics-controls">' +
              '<div class="ncm-ap-color-field">' +
                '<input type="color" class="ncm-appearance-input" id="ncm-ap-lyrics-color" value="' + esc(lyricsColor) + '">' +
                '<div>' +
                  '<label class="ncm-appearance-label" for="ncm-ap-lyrics-color">歌词颜色</label>' +
                  '<span class="ncm-ap-color-field__val" id="ncm-ap-lyrics-color-val">' + esc(lyricsColor) + '</span>' +
                '</div>' +
              '</div>' +
              '<div>' +
                '<label class="ncm-appearance-label" for="ncm-ap-lyrics-size">字号 <span class="ncm-appearance-range-val" id="ncm-ap-lyrics-size-val">' + (ap.playerLyricsFontSize || 14) + 'px</span></label>' +
                '<div class="ncm-appearance-range-row">' +
                  '<input type="range" id="ncm-ap-lyrics-size" min="10" max="28" step="1" value="' + (ap.playerLyricsFontSize || 14) + '">' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="ncm-appearance-actions">' +
              '<button type="button" class="ncm-appearance-btn" data-ncm-ap-save-lyrics-style>应用歌词样式</button>' +
              '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-ap-clear-lyrics-style>恢复默认</button>' +
            '</div>' +
          '</article>' +

          '<article class="ncm-ap-card ncm-ap-card--wide">' +
            cardHead(AP_ICON.mdl, '桌面歌词 CSS', '自定义 CSS 仅作用 <code>#miya-desk-lyrics</code> · 不影响音乐 App · 编辑时实时预览') +
            '<div class="ncm-ap-mdl-workbench">' +
              '<div class="ncm-ap-mdl-preview-wrap">' +
                '<span class="ncm-ap-mdl-preview-wrap__label"><span class="ncm-ap-mdl-preview-wrap__label-dot"></span>Live Preview</span>' +
                '<div class="ncm-ap-mdl-preview-stage">' +
                  buildMdlPreviewHtml() +
                '</div>' +
              '</div>' +
              '<div class="ncm-ap-mdl-editor">' +
                '<div class="ncm-ap-mdl-editor__head">' +
                  '<label class="ncm-appearance-label" for="ncm-mdl-css-input">桌面歌词 CSS</label>' +
                  '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost ncm-appearance-btn--compact" data-ncm-mdl-doc-import>快捷导入</button>' +
                '</div>' +
                '<p class="ncm-ap-mdl-editor__hint">输入即预览 · 应用后仅写入桌面歌词</p>' +
                '<textarea class="ncm-mdl-css-editor" id="ncm-mdl-css-input" rows="8" placeholder="/* 仅桌面歌词 · 例：\n#miya-desk-lyrics .mdl__panel {\n  border-radius: 999px;\n}\n#miya-desk-lyrics .mdl__line--current {\n  color: #ff6b9d;\n} */">' + esc(ap.desktopLyricsCss) + '</textarea>' +
                '<div class="ncm-appearance-actions ncm-appearance-actions--tight">' +
                  '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--preview" data-ncm-mdl-preview-css>刷新预览</button>' +
                  '<button type="button" class="ncm-appearance-btn" data-ncm-mdl-apply-css>应用 CSS</button>' +
                  '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-mdl-copy-ref>复制桌面歌词选择器</button>' +
                  '<button type="button" class="ncm-appearance-btn ncm-appearance-btn--ghost" data-ncm-mdl-clear-css>清除 CSS</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</article>' +

        '</div>' +
      '</div>'
    );
  }

  function hydratePreviews() {
    var ap = eng.getAppearance();
    var map = {
      minePageBg: 'ncm-ap-preview-mine',
      profileAvatar: 'ncm-ap-preview-avatar',
      playerBg: 'ncm-ap-preview-player',
      vinylCover: 'ncm-ap-preview-vinyl'
    };
    Object.keys(map).forEach(function (key) {
      var el = document.getElementById(map[key]);
      var ref = ap[key];
      if (!el) return;
      if (!ref) {
        el.style.backgroundImage = '';
        el.classList.remove('has-image');
        return;
      }
      resolveUrl(ref).then(function (url) {
        if (!url) return;
        el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        el.classList.add('has-image');
      });
    });
  }

  function refreshAppearancePanel() {
    var mount = document.getElementById('ncm-appearance-mount');
    if (!mount) return;
    panelBound = false;
    mount.innerHTML = renderAppearancePanel();
    bindAppearancePanel(mount);
    hydratePreviews();
    var ap = eng.getAppearance();
    applyMdlPreviewCss(ap.desktopLyricsCss || '');
  }

  function refreshAppearanceUi(field) {
    if (field === 'vinylCover' && global.miyaMusicApp && global.miyaMusicApp.invalidateCoverUi) {
      global.miyaMusicApp.invalidateCoverUi();
    }
    if (global.miyaMusicApp && global.miyaMusicApp.renderMinePlaylists) {
      global.miyaMusicApp.renderMinePlaylists();
    }
    if (global.miyaMusicApp && global.miyaMusicApp._tickUi) {
      global.miyaMusicApp._tickUi(true);
    }
    refreshAppearancePanel();
  }

  function bindFileInputs() {
    ['minePageBg', 'profileAvatar', 'playerBg', 'vinylCover'].forEach(function (field) {
      var fileInp = document.getElementById('ncm-ap-file-' + field);
      if (!fileInp || fileInp.dataset.ncmApFileBound) return;
      fileInp.dataset.ncmApFileBound = '1';
      fileInp.addEventListener('change', function () {
        var file = fileInp.files && fileInp.files[0];
        fileInp.value = '';
        if (!file) return;
        if (!(file.size > 0)) {
          toast('文件为空，请换一张图片');
          return;
        }
        var oldId = (eng.getAppearance()[field] || '').trim();
        var readyP = typeof eng.ensureDataReady === 'function'
          ? eng.ensureDataReady(12000)
          : (typeof eng.loadDataWithTimeout === 'function'
            ? eng.loadDataWithTimeout(12000).catch(function () {})
            : Promise.resolve());
        readyP.then(function () {
          return storeImageFile(file, oldId || null);
        }).then(function (id) {
          var patch = {};
          patch[field] = id;
          eng.setAppearance(patch);
          var flushP = typeof eng.flushSave === 'function' ? eng.flushSave() : Promise.resolve();
          return flushP.then(function () { return applyAppearance(); });
        }).then(function () {
          refreshAppearanceUi(field);
          toast('图片已应用');
        }).catch(function (e) {
          var msg = (e && e.message) ? String(e.message) : '';
          if (msg === 'empty_file') toast('文件为空，请换一张图片');
          else if (msg === 'QuotaExceededError' || /quota/i.test(msg)) toast('存储空间不足，请先在设置里清理缓存');
          else toast('图片上传失败，请重试');
        });
      });
    });
  }

  function bindAppearancePanel(root) {
    if (!root || panelBound) return;
    panelBound = true;

    root.addEventListener('click', function (e) {
      var uploadBtn = e.target.closest('[data-ncm-ap-upload]');
      if (uploadBtn) {
        var field = uploadBtn.getAttribute('data-ncm-ap-upload');
        var inp = document.getElementById('ncm-ap-file-' + field);
        if (inp) {
          if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(inp);
          else inp.click();
        }
        return;
      }

      var clearBtn = e.target.closest('[data-ncm-ap-clear]');
      if (clearBtn) {
        eng.clearAppearanceField(clearBtn.getAttribute('data-ncm-ap-clear'));
        applyAppearance();
        if (global.miyaMusicApp && global.miyaMusicApp.renderMinePlaylists) {
          global.miyaMusicApp.renderMinePlaylists();
        }
        refreshAppearancePanel();
        toast('已删除');
        return;
      }

      if (e.target.closest('[data-ncm-ap-save-nickname]')) {
        var nickInp = document.getElementById('ncm-ap-nickname');
        eng.setAppearance({ profileNickname: nickInp ? nickInp.value : '' });
        if (global.miyaMusicApp && global.miyaMusicApp.renderMinePlaylists) {
          global.miyaMusicApp.renderMinePlaylists();
        }
        toast('昵称已保存');
        return;
      }

      if (e.target.closest('[data-ncm-ap-save-status]')) {
        var statusInp = document.getElementById('ncm-ap-status');
        eng.setAppearance({ mineStatusText: statusInp ? statusInp.value : '' });
        applyMineStatusText(eng.getAppearance());
        refreshAppearancePanel();
        toast('状态文案已保存');
        return;
      }

      if (e.target.closest('[data-ncm-ap-save-lyrics-style]')) {
        var colorInp = document.getElementById('ncm-ap-lyrics-color');
        var sizeInp = document.getElementById('ncm-ap-lyrics-size');
        eng.setAppearance({
          playerLyricsColor: colorInp ? colorInp.value : '',
          playerLyricsFontSize: sizeInp ? parseInt(sizeInp.value, 10) : 0
        });
        applyPlayerLyricsTheme(eng.getAppearance());
        toast('歌词样式已应用');
        return;
      }

      if (e.target.closest('[data-ncm-ap-clear-lyrics-style]')) {
        eng.setAppearance({ playerLyricsColor: '', playerLyricsFontSize: 0 });
        applyPlayerLyricsTheme(eng.getAppearance());
        refreshAppearancePanel();
        toast('歌词样式已恢复默认');
        return;
      }

      if (e.target.closest('[data-ncm-mdl-preview-css]')) {
        var previewInp = document.getElementById('ncm-mdl-css-input');
        applyMdlPreviewCss(previewInp ? previewInp.value : '');
        toast('预览已刷新');
        return;
      }

      if (e.target.closest('[data-ncm-mdl-apply-css]')) {
        var cssInp = document.getElementById('ncm-mdl-css-input');
        var css = cssInp ? cssInp.value : '';
        eng.setAppearance({ desktopLyricsCss: css, desktopLyricsPresetName: '' });
        applyAppearance();
        applyMdlPreviewCss(css);
        toast(css.trim() ? '桌面歌词 CSS 已应用' : '已清除 CSS');
        return;
      }

      if (e.target.closest('[data-ncm-mdl-copy-ref]')) {
        copyText(getSourceRef()).then(function () {
          toast('桌面歌词选择器已复制');
        }).catch(function () {
          toast('复制失败');
        });
        return;
      }

      if (e.target.closest('[data-ncm-mdl-clear-css]')) {
        eng.clearAppearanceField('desktopLyricsCss');
        var ta = document.getElementById('ncm-mdl-css-input');
        if (ta) ta.value = '';
        applyAppearance();
        applyMdlPreviewCss('');
        toast('CSS 已清除');
        return;
      }

      if (e.target.closest('[data-ncm-mdl-doc-import]')) {
        var cssTaMdl = document.getElementById('ncm-mdl-css-input');
        var docImpMdl = global.miyaBeautifyDocImport;
        if (!docImpMdl || !cssTaMdl) {
          toast('导入模块未加载');
          return;
        }
        docImpMdl.pickAndImport(cssTaMdl).then(function () {
          applyMdlPreviewCss(cssTaMdl.value);
          toast('CSS 已导入');
        }).catch(function (err) {
          docImpMdl.toastError(err, toast);
        });
        return;
      }

      if (e.target.closest('[data-ncm-ap-preset-save]')) {
        var apNow = eng.getAppearance();
        promptFn({
          title: '保存装修预设',
          message: '为这套外观起名',
          defaultValue: apNow.desktopLyricsPresetName || '我的音乐装修',
          placeholder: '例如：雾夜粉'
        }).then(function (name) {
          name = String(name || '').trim();
          if (!name) {
            toast('请输入预设名称');
            return;
          }
          var list = loadPresets();
          var idx = list.findIndex(function (p) { return p.name === name; });
          var row = normalizePreset(Object.assign({ name: name, createdAt: Date.now() }, apNow));
          if (!row) return;
          if (idx >= 0) list[idx] = row;
          else {
            if (list.length >= MAX_PRESETS) {
              toast('预设最多 ' + MAX_PRESETS + ' 个');
              return;
            }
            list.push(row);
          }
          savePresets(list);
          eng.setAppearance({ desktopLyricsPresetName: name });
          refreshAppearancePanel();
          toast('预设已保存');
        });
        return;
      }

      if (e.target.closest('[data-ncm-ap-preset-load]')) {
        var pick = document.getElementById('ncm-ap-preset-pick');
        var pickName = pick ? pick.value : '';
        if (!pickName) return toast('请先选择预设');
        var preset = loadPresets().find(function (p) { return p.name === pickName; });
        if (!preset) return toast('预设不存在');
        eng.setAppearance({
          minePageBg: preset.minePageBg,
          profileAvatar: preset.profileAvatar,
          profileNickname: preset.profileNickname,
          mineStatusText: preset.mineStatusText,
          playerBg: preset.playerBg,
          vinylCover: preset.vinylCover,
          playerLyricsColor: preset.playerLyricsColor,
          playerLyricsFontSize: preset.playerLyricsFontSize,
          desktopLyricsCss: preset.desktopLyricsCss,
          desktopLyricsPresetName: preset.name
        });
        applyAppearance();
        if (global.miyaMusicApp && global.miyaMusicApp.renderMinePlaylists) {
          global.miyaMusicApp.renderMinePlaylists();
        }
        refreshAppearancePanel();
        toast('已读取预设「' + pickName + '」');
        return;
      }

      if (e.target.closest('[data-ncm-ap-preset-delete]')) {
        var delPick = document.getElementById('ncm-ap-preset-pick');
        var delName = delPick ? delPick.value : '';
        if (!delName) return toast('请先选择要删除的预设');
        confirmFn({
          title: '删除预设',
          message: '确定删除「' + delName + '」？',
          confirmText: '删除',
          cancelText: '取消'
        }).then(function (ok) {
          if (!ok) return;
          savePresets(loadPresets().filter(function (p) { return p.name !== delName; }));
          var cur = eng.getAppearance();
          if (cur.desktopLyricsPresetName === delName) {
            eng.setAppearance({ desktopLyricsPresetName: '' });
          }
          refreshAppearancePanel();
          toast('预设已删除');
        });
      }
    });

    var sizeRange = root.querySelector('#ncm-ap-lyrics-size');
    if (sizeRange) {
      sizeRange.addEventListener('input', function () {
        var lbl = document.getElementById('ncm-ap-lyrics-size-val');
        if (lbl) lbl.textContent = sizeRange.value + 'px';
      });
    }

    var colorInp = root.querySelector('#ncm-ap-lyrics-color');
    if (colorInp) {
      colorInp.addEventListener('input', function () {
        var colorLbl = document.getElementById('ncm-ap-lyrics-color-val');
        if (colorLbl) colorLbl.textContent = colorInp.value;
      });
    }

    var cssEditor = root.querySelector('#ncm-mdl-css-input');
    if (cssEditor) {
      cssEditor.addEventListener('input', function () {
        clearTimeout(mdlPreviewTimer);
        mdlPreviewTimer = setTimeout(function () {
          applyMdlPreviewCss(cssEditor.value);
        }, 280);
      });
    }

    bindFileInputs();
  }

  function openPage() {
    var page = document.getElementById('ncm-appearance-page');
    var app = document.getElementById('miya-music-app');
    if (!page) return;
    page.hidden = false;
    if (app) app.classList.add('is-appearance-open');
    refreshAppearancePanel();
  }

  function closePage() {
    var page = document.getElementById('ncm-appearance-page');
    var app = document.getElementById('miya-music-app');
    if (page) page.hidden = true;
    if (app) app.classList.remove('is-appearance-open');
    panelBound = false;
  }

  function init() {
    var back = document.getElementById('ncm-appearance-back');
    if (back) {
      back.addEventListener('click', function () {
        if (global.miyaMusicApp && global.miyaMusicApp.closeAppearancePage) {
          global.miyaMusicApp.closeAppearancePage();
        } else {
          closePage();
        }
      });
    }

    eng.loadDataWithTimeout(8000).then(function () {
      applyAppearance();
      bindFileInputs();
    }).catch(function () {
      applyAppearance();
      bindFileInputs();
    });

    global.addEventListener('miya-music-appearance-recovered', function () {
      applyAppearance();
      if (global.miyaMusicApp && global.miyaMusicApp.renderMinePlaylists) {
        global.miyaMusicApp.renderMinePlaylists();
      }
      toast('已自动恢复外观图片');
    });

    global.addEventListener('miya-music-state', function () {
      applyAppearance();
    });
  }

  global.MiyaMusicBeautify = {
    applyAppearance: applyAppearance,
    openPage: openPage,
    closePage: closePage,
    getVinylCoverUrl: function () { return vinylCoverUrlCache; },
    getSourceRef: getSourceRef,
    copySourceRef: function () {
      return copyText(getSourceRef()).then(function () { toast('桌面歌词选择器已复制'); });
    },
    loadPresets: loadPresets
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
