/**
 * Miya 线下 · 现场样式 / 主题切换 / 自定义 CSS
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'xw-beautify-custom-style';
  var PRESETS_LS = 'miya-offline-beautify-presets-v1';
  var presetsCache = null;
  var presetsReady = null;
  var _presetsHydrated = false;
  var SAFETY_CSS = [
    '/* miya-offline-safety */',
    '#miya-offline-app[hidden] { display: none !important; visibility: hidden !important; pointer-events: none !important; }',
    '#miya-offline-app .xw-bg,',
    '#miya-offline-app .xw-bg__mesh,',
    '#miya-offline-app .xw-bg__dots { pointer-events: none !important; }',
    '#miya-offline-app .xw-scene__band-shade { pointer-events: none !important; }',
    '#miya-offline-app button,',
    '#miya-offline-app [role="button"],',
    '#miya-offline-app a,',
    '#miya-offline-app textarea,',
    '#miya-offline-app input,',
    '#miya-offline-app select { pointer-events: auto !important; cursor: pointer !important; }'
  ].join('\n');
  var THEME_MAP = {
    museum: 'xw-theme-museum',
    korean: 'xw-theme-korean',
    ins: 'xw-theme-korean',
    custom: 'xw-theme-custom'
  };

  var BUILTIN_THEMES = [
    { id: 'museum', label: '素纸', sub: '暖灰底 · 窄栏正文 · 基础现场' },
    { id: 'korean', label: '手帐', sub: '纸感拼贴 · 撕边信笺 · 对话气泡' },
    { id: 'custom', label: '自定义', sub: '写入 CSS · 素纸通用 xw- 类名' }
  ];

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaOfflineApp && global.miyaOfflineApp.toast) {
      global.miyaOfflineApp.toast(msg);
      return;
    }
    var el = document.createElement('div');
    el.className = 'xw-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    el.classList.add('is-show');
    setTimeout(function () { el.remove(); }, 2400);
  }

  function apStore() {
    return global.MiyaAppointmentStore;
  }

  function normalizeBeautify(raw) {
    var st = apStore();
    var d = st && st.getBeautify ? st.getBeautify() : { themeId: 'museum', customCss: '' };
    if (!raw || typeof raw !== 'object') return Object.assign({}, d);
    var themeId = raw.themeId || d.themeId || 'museum';
    if (themeId === 'ins') themeId = 'korean';
    if (themeId === 'gufeng') themeId = 'museum';
    if (['museum', 'korean', 'custom'].indexOf(themeId) < 0) themeId = 'museum';
    return {
      themeId: raw.customCss ? 'custom' : (themeId === 'custom' && !raw.customCss ? 'museum' : themeId),
      customCss: String(raw.customCss || ''),
      wallpaperMode: ['none', 'idb', 'url'].indexOf(raw.wallpaperMode) >= 0 ? raw.wallpaperMode : d.wallpaperMode,
      wallpaperId: raw.wallpaperId ? String(raw.wallpaperId) : null,
      wallpaperUrl: String(raw.wallpaperUrl || '').trim()
    };
  }

  function themeClassFor(id) {
    if (id === 'custom') return THEME_MAP.custom;
    return THEME_MAP[id] || THEME_MAP.museum;
  }

  function allThemeClasses() {
    var seen = {};
    Object.keys(THEME_MAP).forEach(function (k) { seen[THEME_MAP[k]] = true; });
    return Object.keys(seen);
  }

  function stripDangerousGlobalCss(css) {
    var s = String(css || '');
    s = s.replace(/(?:^|[\n\r])\s*\*\s*\{[\s\S]*?\}/g, '\n');
    s = s.replace(/(?:^|[\n\r])\s*body\s*\{[\s\S]*?\}/g, '\n');
    s = s.replace(/(?:^|[\n\r])\s*html\s*\{[\s\S]*?\}/g, '\n');
    s = s.replace(/(?:^|[\n\r])\s*#miya-offline-app\[hidden\]\s*\{[\s\S]*?\}/g, '\n');
    s = s.replace(/(?:^|[\n\r])\s*#miya-offline-app\s*\{[^}]*display\s*:[^}]*\}/gi, '\n');
    return s.trim();
  }

  function prepareCustomCssForInject(css) {
    var raw = stripDangerousGlobalCss(css);
    if (!raw) return '';
    return raw + '\n' + SAFETY_CSS;
  }

  function injectCustomCss(css) {
    var el = document.getElementById(STYLE_ID);
    var host = document.getElementById('miya-offline-app');
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      if (host) host.appendChild(el);
      else document.body.appendChild(el);
    } else if (host && el.parentNode !== host) {
      host.appendChild(el);
    }
    var prepared = String(css || '').trim() ? prepareCustomCssForInject(css) : '';
    el.textContent = prepared;
    return el;
  }

  function applyToAppEl(app, bf) {
    if (!app) return;
    bf = normalizeBeautify(bf || (apStore() && apStore().getBeautify()));
    allThemeClasses().forEach(function (cls) { app.classList.remove(cls); });
    var tid = bf.customCss ? 'custom' : bf.themeId;
    app.classList.add(themeClassFor(tid));
    app.classList.toggle('xw-has-custom-css', !!bf.customCss);
    injectCustomCss(bf.customCss);
  }

  function applyBeautify() {
    var app = document.getElementById('miya-offline-app');
    var bf = apStore() ? apStore().getBeautify() : null;
    applyToAppEl(app, bf);
    if (global.miyaOfflineApp && typeof global.miyaOfflineApp.rerender === 'function' && app && !app.hidden) {
      global.miyaOfflineApp.rerender();
    }
  }

  function saveBeautify(patch) {
    if (!apStore()) return Promise.reject(new Error('no_store'));
    var next = normalizeBeautify(Object.assign({}, apStore().getBeautify(), patch || {}));
    apStore().saveBeautify(next);
    applyBeautify();
    return Promise.resolve(next);
  }

  function buildThemePickerHtml(activeId) {
    return BUILTIN_THEMES.map(function (t) {
      var on = t.id === activeId || (activeId === 'custom' && t.id === 'custom');
      return (
        '<button type="button" class="xw-bf-theme' + (on ? ' is-active' : '') + '" data-xw-bf-theme="' + esc(t.id) + '">' +
        '<span class="xw-bf-theme__swatch xw-bf-theme__swatch--' + esc(t.id) + '" aria-hidden="true"></span>' +
        '<strong>' + esc(t.label) + '</strong>' +
        '<small>' + esc(t.sub) + '</small></button>'
      );
    }).join('');
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

  function getFullSourcePack() {
    if (global.MIYA_OFFLINE_SOURCE_REF) return global.MIYA_OFFLINE_SOURCE_REF;
    return [
      '# Miya 线下现场 · 美化源码 & 选择器参考',
      '',
      '（参考文档未加载，请刷新页面后重试）'
    ].join('\n');
  }

  function buildSourceReferenceHtml() {
    var src = getFullSourcePack();
    return '<section class="xw-bf-section xw-bf-section--ref">' +
      '<span class="xw-bf-section__label">素纸类名</span>' +
      '<textarea class="xw-bf-src" data-xw-bf-src-readonly rows="12" readonly tabindex="-1">' +
      esc(src) + '</textarea>' +
      '<div class="xw-bf-src-row">' +
      '<button type="button" class="xw-btn xw-btn--solid" data-xw-bf-copy-src>复制参考</button>' +
      '<button type="button" class="xw-btn" data-xw-bf-download-src>下载 txt</button>' +
      '</div></section>';
  }

  function normalizePresetRow(raw) {
    if (!raw || !raw.name) return null;
    return {
      name: String(raw.name).trim(),
      savedAt: Number(raw.savedAt) || Date.now(),
      customCss: String(raw.customCss || ''),
      themeId: normalizeBeautify(raw).themeId
    };
  }

  function presetsNeedAsyncHydrate() {
    return !!(global.miyaKvKeyNeedsAsyncHydrate && global.miyaKvKeyNeedsAsyncHydrate(PRESETS_LS));
  }

  function hydratePresetsSync() {
    if (presetsCache && (_presetsHydrated || !presetsNeedAsyncHydrate())) return presetsCache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(PRESETS_LS);
      if (Array.isArray(raw)) {
        presetsCache = raw.map(normalizePresetRow).filter(Boolean);
        _presetsHydrated = true;
        return presetsCache;
      }
    }
    return null;
  }

  function whenPresetsReady() {
    if (_presetsHydrated && presetsCache) return Promise.resolve(presetsCache.slice());
    if (presetsReady) return presetsReady;
    var chain = typeof global.miyaReadLsJsonKey === 'function'
      ? global.miyaReadLsJsonKey(PRESETS_LS, [])
      : Promise.resolve([]);
    presetsReady = chain.then(function (parsed) {
      if (!Array.isArray(parsed)) parsed = [];
      presetsCache = parsed.map(normalizePresetRow).filter(Boolean);
      _presetsHydrated = true;
      presetsReady = null;
      return presetsCache.slice();
    }).catch(function () {
      if (!presetsCache) presetsCache = [];
      _presetsHydrated = true;
      presetsReady = null;
      return presetsCache.slice();
    });
    return presetsReady;
  }

  function loadPresets() {
    var hydrated = hydratePresetsSync();
    if (hydrated) return hydrated.slice();
    if (presetsNeedAsyncHydrate()) {
      whenPresetsReady();
      return presetsCache ? presetsCache.slice() : [];
    }
    presetsCache = [];
    _presetsHydrated = true;
    return [];
  }

  function persistPresets(list) {
    if (!_presetsHydrated && presetsNeedAsyncHydrate()) {
      return whenPresetsReady().then(function () {
        return persistPresets(list);
      });
    }
    presetsCache = Array.isArray(list) ? list.slice() : [];
    presetsReady = null;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(PRESETS_LS, presetsCache).then(function () {
        return presetsCache.slice();
      });
    }
    try { localStorage.setItem(PRESETS_LS, JSON.stringify(presetsCache)); } catch (e) {}
    return Promise.resolve(presetsCache.slice());
  }

  function findPreset(name) {
    var label = String(name || '').trim();
    if (!label) return null;
    return loadPresets().find(function (p) { return p.name === label; }) || null;
  }

  function buildPresetSelectOptions(selectedName) {
    var html = '<option value="">选择预设…</option>';
    loadPresets().forEach(function (p) {
      html += '<option value="' + esc(p.name) + '"' + (p.name === selectedName ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return html;
  }

  function refreshPresetSelect(root, selectedName) {
    var sel = root && root.querySelector('[data-xw-bf-preset-pick]');
    if (!sel) return;
    sel.innerHTML = buildPresetSelectOptions(selectedName);
  }

  function savePreset(name, patch) {
    var label = String(name || '').trim();
    if (!label) return Promise.reject(new Error('empty_name'));
    var css = patch && patch.customCss != null ? String(patch.customCss) : '';
    return whenPresetsReady().then(function (list) {
      var row = normalizePresetRow({
        name: label,
        savedAt: Date.now(),
        customCss: css,
        themeId: css.trim() ? 'custom' : (patch && patch.themeId) || 'museum'
      });
      var idx = list.findIndex(function (p) { return p.name === label; });
      if (idx >= 0) list[idx] = row;
      else list.unshift(row);
      return persistPresets(list).then(function () { return row; });
    });
  }

  function deletePreset(name) {
    var label = String(name || '').trim();
    if (!label) return Promise.reject(new Error('empty_name'));
    return whenPresetsReady().then(function (list) {
      var next = list.filter(function (p) { return p.name !== label; });
      if (next.length === list.length) return Promise.reject(new Error('not_found'));
      return persistPresets(next);
    });
  }

  function buildPresetSectionHtml() {
    return '<div class="xw-bf-section--presets">' +
      '<span class="xw-bf-section__label">预设</span>' +
      '<p class="xw-bf-section__hint">保存的预设所有角色通用；同名预设会自动覆盖</p>' +
      '<select class="xw-bf-preset-pick" data-xw-bf-preset-pick>' + buildPresetSelectOptions('') + '</select>' +
      '<div class="xw-bf-src-row">' +
      '<button type="button" class="xw-btn xw-btn--solid" data-xw-bf-preset-save>保存预设</button>' +
      '<button type="button" class="xw-btn" data-xw-bf-preset-load>读取预设</button>' +
      '<button type="button" class="xw-btn" data-xw-bf-preset-delete>删除预设</button>' +
      '</div></div>';
  }

  function buildCustomCssHtml(bf) {
    return '<section class="xw-bf-section">' +
      '<div class="xw-bf-section__head">' +
        '<span class="xw-bf-section__label">自定义 CSS</span>' +
        '<button type="button" class="xw-btn xw-btn--compact" data-xw-bf-doc-import>快捷导入</button>' +
      '</div>' +
      '<textarea class="xw-bf-css" data-xw-bf-custom-css rows="10" placeholder="' +
      esc(cssReferenceHint()) + '">' + esc(bf.customCss || '') + '</textarea>' +
      '<div class="xw-bf-src-row">' +
      '<button type="button" class="xw-btn xw-btn--solid" data-xw-bf-save-css>应用</button>' +
      '<button type="button" class="xw-btn" data-xw-bf-clear-css>清除 CSS</button>' +
      '</div>' +
      buildPresetSectionHtml() +
      '</section>';
  }

  function copySource() {
    return copyText(getFullSourcePack()).then(function () {
      toast('选择器参考已复制');
    }).catch(function () {
      toast('复制失败，请手动选取');
    });
  }

  function downloadSource() {
    var text = getFullSourcePack();
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'miya线下美化-选择器参考.txt';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('已下载 txt 文件');
    } catch (e) {
      toast('下载失败');
    }
  }

  function cssReferenceHint() {
    return '/* 建议以 #miya-offline-app 为作用域；完整类名见下方「选择器参考」 */';
  }

  function openBeautifyDrawer() {
    var existing = document.getElementById('xw-bf-drawer');
    if (existing) {
      existing.classList.add('is-open');
      whenPresetsReady().then(function () {
        refreshPresetSelect(existing, '');
      });
      return;
    }

    var bf = normalizeBeautify(apStore() ? apStore().getBeautify() : {});
    var activeTheme = bf.customCss ? 'custom' : bf.themeId;

    var sheet = document.createElement('div');
    sheet.id = 'xw-bf-drawer';
    sheet.className = 'xw-drawer xw-drawer--beautify is-open';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', '现场样式');

    sheet.innerHTML =
      '<div class="xw-drawer__panel xw-bf-panel">' +
      '<header class="xw-drawer__head xw-bf-head">' +
      '<span class="xw-drawer__kicker">现场 · 界面</span>' +
      '<h3>现场样式</h3></header>' +
      '<section class="xw-bf-section">' +
      '<span class="xw-bf-section__label">主题</span>' +
      '<div class="xw-bf-themes" data-xw-bf-themes>' + buildThemePickerHtml(activeTheme) + '</div></section>' +
      buildSourceReferenceHtml() +
      buildCustomCssHtml(bf) +
      '<footer class="xw-drawer__foot xw-bf-foot">' +
      '<button type="button" class="xw-btn" data-xw-bf-close>收起</button></footer></div>';

    document.body.appendChild(sheet);

    whenPresetsReady().then(function () {
      refreshPresetSelect(sheet, '');
    });

    function closeDrawer() {
      sheet.classList.remove('is-open');
      setTimeout(function () { sheet.remove(); }, 320);
    }

    function readCustomCss() {
      var ta = sheet.querySelector('[data-xw-bf-custom-css]');
      return ta ? String(ta.value || '') : '';
    }

    sheet.addEventListener('click', function (e) {
      if (e.target === sheet) closeDrawer();
      var themeBtn = e.target.closest('[data-xw-bf-theme]');
      if (themeBtn) {
        var tid = themeBtn.getAttribute('data-xw-bf-theme');
        sheet.querySelectorAll('[data-xw-bf-theme]').forEach(function (b) {
          b.classList.toggle('is-active', b === themeBtn);
        });
        if (tid === 'custom') {
          var css = readCustomCss();
          saveBeautify({ themeId: 'custom', customCss: css }).then(function () {
            toast(css.trim() ? '已选用自定义' : '请写入 CSS 后点应用');
          });
          return;
        }
        saveBeautify({ themeId: tid, customCss: '' }).then(function () {
          var ta = sheet.querySelector('[data-xw-bf-custom-css]');
          if (ta) ta.value = '';
          toast('已切换「' + (BUILTIN_THEMES.find(function (t) { return t.id === tid; }) || {}).label + '」');
        });
        return;
      }
      if (e.target.closest('[data-xw-bf-save-css]')) {
        var cssVal = readCustomCss();
        sheet.querySelectorAll('[data-xw-bf-theme]').forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-xw-bf-theme') === 'custom');
        });
        saveBeautify({ themeId: 'custom', customCss: cssVal }).then(function () {
          toast(cssVal.trim() ? '自定义 CSS 已应用' : 'CSS 为空，已回退素纸');
        });
        return;
      }
      if (e.target.closest('[data-xw-bf-clear-css]')) {
        var taClear = sheet.querySelector('[data-xw-bf-custom-css]');
        if (taClear) taClear.value = '';
        sheet.querySelectorAll('[data-xw-bf-theme]').forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-xw-bf-theme') === 'museum');
        });
        saveBeautify({ themeId: 'museum', customCss: '' }).then(function () {
          toast('已清除自定义 CSS');
        });
        return;
      }
      if (e.target.closest('[data-xw-bf-preset-save]')) {
        var pickSave = sheet.querySelector('[data-xw-bf-preset-pick]');
        var defaultName = pickSave && pickSave.value ? pickSave.value : '';
        var promptFn = global.miyaDialog && global.miyaDialog.prompt
          ? global.miyaDialog.prompt.bind(global.miyaDialog)
          : function (o) { return Promise.resolve(prompt(o.message || '名称', o.defaultValue || '')); };
        promptFn({
          title: '保存预设',
          message: '为这个预设取个名字（同名将自动覆盖）',
          placeholder: '例如：暖灰手帐',
          defaultValue: defaultName
        }).then(function (name) {
          if (!name || !String(name).trim()) return;
          return savePreset(String(name).trim(), { customCss: readCustomCss() });
        }).then(function (row) {
          if (!row) return;
          refreshPresetSelect(sheet, row.name);
          toast('预设已保存');
        }).catch(function (err) {
          if (err && err.message !== 'empty_name') toast('保存失败');
        });
        return;
      }
      if (e.target.closest('[data-xw-bf-preset-load]')) {
        var selLoad = sheet.querySelector('[data-xw-bf-preset-pick]');
        var loadName = selLoad ? String(selLoad.value || '').trim() : '';
        if (!loadName) {
          toast('请先选择预设');
          return;
        }
        var preset = findPreset(loadName);
        if (!preset) {
          toast('预设不存在');
          return;
        }
        var taLoad = sheet.querySelector('[data-xw-bf-custom-css]');
        if (taLoad) taLoad.value = preset.customCss || '';
        sheet.querySelectorAll('[data-xw-bf-theme]').forEach(function (b) {
          b.classList.toggle('is-active', b.getAttribute('data-xw-bf-theme') === 'custom');
        });
        saveBeautify({ themeId: 'custom', customCss: preset.customCss || '' }).then(function () {
          toast('已读取「' + loadName + '」');
        });
        return;
      }
      if (e.target.closest('[data-xw-bf-preset-delete]')) {
        var selDel = sheet.querySelector('[data-xw-bf-preset-pick]');
        var delName = selDel ? String(selDel.value || '').trim() : '';
        if (!delName) {
          toast('请先选择要删除的预设');
          return;
        }
        var confirmFn = global.miyaDialog && global.miyaDialog.confirm
          ? global.miyaDialog.confirm.bind(global.miyaDialog)
          : function (o) { return Promise.resolve(confirm(o.message || '确定？')); };
        confirmFn({
          title: '删除预设',
          message: '确定删除「' + delName + '」？',
          confirmText: '删除',
          cancelText: '取消'
        }).then(function (ok) {
          if (!ok) return;
          return deletePreset(delName);
        }).then(function () {
          refreshPresetSelect(sheet, '');
          toast('预设已删除');
        }).catch(function (err) {
          if (err && err.message !== 'not_found') toast('删除失败');
        });
        return;
      }
      if (e.target.closest('[data-xw-bf-copy-src]')) {
        copySource();
        return;
      }
      if (e.target.closest('[data-xw-bf-download-src]')) {
        downloadSource();
        return;
      }
      if (e.target.closest('[data-xw-bf-doc-import]')) {
        var cssTaXw = sheet.querySelector('[data-xw-bf-custom-css]');
        var docImpXw = global.miyaBeautifyDocImport;
        if (!docImpXw || !cssTaXw) {
          toast('导入模块未加载');
          return;
        }
        docImpXw.pickAndImport(cssTaXw).then(function () {
          sheet.querySelectorAll('[data-xw-bf-theme]').forEach(function (b) {
            b.classList.toggle('is-active', b.getAttribute('data-xw-bf-theme') === 'custom');
          });
          toast('CSS 已导入');
        }).catch(function (err) {
          docImpXw.toastError(err, toast);
        });
        return;
      }
      if (e.target.closest('[data-xw-bf-close]')) closeDrawer();
    });
  }

  global.MiyaOfflineBeautify = {
    BUILTIN_THEMES: BUILTIN_THEMES,
    normalizeBeautify: normalizeBeautify,
    applyBeautify: applyBeautify,
    applyToAppEl: applyToAppEl,
    saveBeautify: saveBeautify,
    openBeautifyDrawer: openBeautifyDrawer,
    buildThemePickerHtml: buildThemePickerHtml,
    cssReferenceHint: cssReferenceHint,
    getCssReference: getFullSourcePack,
    copySource: copySource,
    downloadSource: downloadSource,
    whenPresetsReady: whenPresetsReady,
    loadPresets: loadPresets,
    savePreset: savePreset,
    deletePreset: deletePreset,
    findPreset: findPreset
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBeautify);
  } else {
    applyBeautify();
  }
})(window);
