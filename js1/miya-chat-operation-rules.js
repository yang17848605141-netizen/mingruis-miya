/**
 * Miya 线上运转规则 · 预设库（设置软件编辑）+ 各聊天选用
 * 自定义按条添加（名称 + 开关）；关闭的条目不注入；末尾格式条序号随启用条数顺延
 */
(function (global) {
  'use strict';

  var PRESETS_LS = 'miya-chat-operation-rules-presets-v1';
  var EXPORT_FORMAT = 'miya-operation-rules';
  var PANEL_RENDER_VER = '9';
  var presetsCache = null; // null=未加载, []=已加载但为空, 非空=有数据
  var presetsReady = null;
  var settingsBound = false;

  /** 与 engine 内置格式条一致；engine 未就绪时仍保证能 compose */
  var DEFAULT_FORMAT_TAIL_ITEMS = [
    '每一轮须按顺序输出三段：<thinking> → 正文（每行一气泡，必须换行）→ <miyavoice>；禁止一大坨无换行文字',
    '世界书已注入系统提示，你必须在 <thinking> 中体现对当前生效世界书条目的消化，并在正文中落实',
    '发送前必须回顾上下文中你方近期已发原文：禁止频繁重复相同话题、相同描写/意象、相同动作套路、相同句式或同质化撒娇/抱怨；<miyavoice> 各字段也不得与近几轮雷同；主动找话题时勿反复提天气，勿复制上一轮结构与节奏',
    '正文每行仅一条气泡，且整轮正文只输出一遍；禁止相同句子/气泡行出现两次；引用时「引用-摘抄」独占一行，每条回复各占一行',
    '每轮末尾必须按照要求完整输出 <miyavoice> 心声段，须严格按当前「线上格式规则·心声」中定义的字段逐行写满（字段名与行数以该规则为准），禁止省略、禁止截断；心声字段行不得出现在正文气泡里',
    '禁止编造关于用户的经历、共同回忆、偏好或说过/做过的事：仅可使用上下文中已明确出现的对话原文，以及系统注入的长期记忆/角色记忆/朋友圈记忆、联系人档案与用户档案；无依据时不得假称「记得」「上次你说」「我们以前」等',
    '须通读上下文中按时间顺序注入的完整近期对话（用户与角色的消息均已包含；开启时间感知时须逐条区分双方发言早晚）后再回复：衔接取决于对话最新状态——若上下文末条为用户新发言，则按该消息真实发送时刻回应；若上几条已是你方发言而用户未回，则从你方最近一条自然续写或推进；判断用户失联多久须按用户上次发言起算'
  ];

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaSettingsApp && global.miyaSettingsApp.toast) {
      global.miyaSettingsApp.toast(msg);
      return;
    }
    if (global.miyaChatApp && global.miyaChatApp.toast) {
      global.miyaChatApp.toast(msg);
      return;
    }
    var el = document.createElement('div');
    el.className = 'ins-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2400);
  }

  function promptFn(opts) {
    if (global.miyaDialog && global.miyaDialog.prompt) {
      return global.miyaDialog.prompt(opts);
    }
    return Promise.resolve(prompt((opts.message || '') + '\n' + (opts.placeholder || ''), opts.defaultValue || ''));
  }

  function confirmFn(opts) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm(opts);
    }
    return Promise.resolve(confirm(opts.message || '确定？'));
  }

  function stripLeadingNumber(text) {
    return String(text || '').replace(/^\d+[、.．]\s*/, '').trim();
  }

  function formatNumberedLines(items, startNum) {
    var n = Math.max(1, parseInt(startNum, 10) || 1);
    return (items || [])
      .map(function (text) {
        return stripLeadingNumber(text);
      })
      .filter(Boolean)
      .map(function (text, i) {
        return n + i + '、' + text;
      })
      .join('\n');
  }

  function getFormatTailItems() {
    var eng = global.MiyaChatEngine;
    if (eng && typeof eng.getOperationRulesFormatTailItems === 'function') {
      var fromEng = eng.getOperationRulesFormatTailItems();
      if (Array.isArray(fromEng) && fromEng.length) return fromEng.slice();
    }
    return DEFAULT_FORMAT_TAIL_ITEMS.slice();
  }

  function buildFormatTailFrom(startNum) {
    var eng = global.MiyaChatEngine;
    if (eng && typeof eng.buildOperationRulesFormatTailFrom === 'function') {
      return String(eng.buildOperationRulesFormatTailFrom(startNum) || '').trim();
    }
    return formatNumberedLines(getFormatTailItems(), startNum);
  }

  function parseLegacyTextToItems(text) {
    var body = String(text || '').trim();
    if (!body) return [];
    body = body.replace(/^【运转规则[^】]*】\s*/u, '').trim();
    if (!body) return [];
    var lines = body.split('\n');
    if (lines.length <= 1) {
      var single = stripLeadingNumber(body);
      return single ? [normalizeItemRow(single)] : [];
    }
    var out = [];
    var stripDefaultTail =
      body.indexOf('【运转规则') >= 0 &&
      /每一轮须按顺序输出三段/.test(body);
    var inFormatTail = false;
    lines.forEach(function (line) {
      var t = line.trim();
      if (!t) return;
      if (t.indexOf('【运转规则') === 0) return;
      if (stripDefaultTail && /每一轮须按顺序输出三段/.test(t)) {
        inFormatTail = true;
      }
      if (inFormatTail) return;
      var row = normalizeItemRow(stripLeadingNumber(t));
      if (row && row.text) out.push(row);
    });
    return out;
  }

  function coerceEnabled(v, fallback) {
    if (v === false || v === 0 || v === '0' || v === 'false' || v === 'off') return false;
    if (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') return true;
    return fallback !== false;
  }

  function normalizeItemRow(raw) {
    if (raw == null) return null;
    if (typeof raw === 'string') {
      var st = stripLeadingNumber(raw.trim());
      if (!st) return null;
      return { name: '', text: st, enabled: true };
    }
    if (typeof raw !== 'object') {
      var asStr = stripLeadingNumber(String(raw).trim());
      if (!asStr) return null;
      return { name: '', text: asStr, enabled: true };
    }
    var text = raw.text != null
      ? raw.text
      : (raw.content != null ? raw.content : (raw.body != null ? raw.body : ''));
    text = stripLeadingNumber(String(text || '').trim());
    var name = String(raw.name != null ? raw.name : (raw.title != null ? raw.title : '')).trim().slice(0, 64);
    var enabled = coerceEnabled(
      raw.enabled != null ? raw.enabled : (raw.on != null ? raw.on : raw.active),
      true
    );
    if (!text && !name) return null;
    return { name: name, text: text, enabled: enabled };
  }

  function normalizeItems(rawItems, legacyText) {
    var fromItems = Array.isArray(rawItems)
      ? rawItems.map(normalizeItemRow).filter(Boolean)
      : [];
    if (fromItems.length) return fromItems;
    if (legacyText) return parseLegacyTextToItems(legacyText);
    return [];
  }

  function itemHasText(item) {
    return !!(item && String(item.text || '').trim());
  }

  function getEnabledTexts(items) {
    return (items || [])
      .filter(function (it) { return it && it.enabled !== false && itemHasText(it); })
      .map(function (it) { return String(it.text).trim(); });
  }

  function normalizePresetRow(raw) {
    if (!raw || !raw.name) return null;
    var legacyText = raw.text != null
      ? raw.text
      : (raw.body != null ? raw.body : (raw.content != null ? raw.content : ''));
    var items = normalizeItems(raw.items, legacyText);
    return {
      name: String(raw.name).trim(),
      items: items,
      text: String(legacyText || '').trim(),
      savedAt: raw.savedAt || Date.now()
    };
  }

  function syncPresetsFromMem() {
    if (typeof global.__miyaKvMem === 'undefined') return false;
    if (!Object.prototype.hasOwnProperty.call(global.__miyaKvMem, PRESETS_LS)) return false;
    var raw = global.__miyaKvMem[PRESETS_LS];
    if (!Array.isArray(raw)) return false;
    presetsCache = raw.map(normalizePresetRow).filter(Boolean);
    return true;
  }

  function invalidatePresetsCache() {
    presetsCache = null;
    presetsReady = null;
  }

  function hydratePresetsSync() {
    if (presetsCache !== null && presetsCache.length) return presetsCache;
    if (syncPresetsFromMem() && presetsCache.length) return presetsCache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(PRESETS_LS);
      if (Array.isArray(raw)) {
        presetsCache = raw.map(normalizePresetRow).filter(Boolean);
        return presetsCache;
      }
    }
    return presetsCache;
  }

  function whenPresetsReady() {
    if (presetsReady) return presetsReady;
    var chain = typeof global.miyaReadLsJsonKey === 'function'
      ? global.miyaReadLsJsonKey(PRESETS_LS, null)
      : Promise.resolve(null);
    presetsReady = chain.then(function (parsed) {
      if (!Array.isArray(parsed)) parsed = [];
      var rows = parsed.map(normalizePresetRow).filter(Boolean);
      if (rows.length) {
        presetsCache = rows;
        return rows.slice();
      }
      hydratePresetsSync();
      if (presetsCache !== null) return presetsCache.slice();
      presetsCache = rows;
      return rows.slice();
    }).catch(function () {
      invalidatePresetsCache();
      return [];
    });
    return presetsReady;
  }

  function ensureLoaded() {
    hydratePresetsSync();
    if (presetsCache !== null && presetsCache.length) return Promise.resolve(presetsCache.slice());
    invalidatePresetsCache();
    return whenPresetsReady();
  }

  function loadPresets() {
    hydratePresetsSync();
    return presetsCache !== null ? presetsCache.slice() : [];
  }

  function getPresetItems(preset) {
    if (!preset) return [];
    var items = normalizeItems(preset.items, preset.text);
    if (items.length) return items;
    if (preset.body) return normalizeItems(null, preset.body);
    if (preset.content) return normalizeItems(null, preset.content);
    return [];
  }

  function findPresetRelaxed(name) {
    var label = normalizeChatPresetName(name);
    if (!label) return null;
    var list = loadPresets();
    var exact = list.find(function (p) { return p.name === label; });
    if (exact) return exact;
    var lower = label.toLowerCase();
    var ci = list.find(function (p) { return String(p.name || '').trim().toLowerCase() === lower; });
    if (ci) return ci;
    var collapsed = label.replace(/\s+/g, '');
    return list.find(function (p) {
      return String(p.name || '').trim().replace(/\s+/g, '') === collapsed;
    }) || null;
  }

  function persistPresets(list) {
    presetsCache = Array.isArray(list) ? list.map(function (row) {
      return normalizePresetRow(row) || row;
    }).filter(function (row) { return row && row.name; }) : [];
    presetsReady = null;
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return global.miyaWriteLsJsonKey(PRESETS_LS, presetsCache).then(function () {
        return presetsCache.slice();
      });
    }
    try { localStorage.setItem(PRESETS_LS, JSON.stringify(presetsCache)); } catch (e) {}
    if (typeof global.miyaSyncFlushJsonKey === 'function') {
      try { global.miyaSyncFlushJsonKey(PRESETS_LS, presetsCache); } catch (e2) {}
    }
    return Promise.resolve(presetsCache.slice());
  }

  function findPreset(name) {
    return findPresetRelaxed(name);
  }

  function savePreset(name, items) {
    var label = String(name || '').trim();
    if (!label) return Promise.reject(new Error('empty_name'));
    var list = normalizeItems(items).filter(itemHasText);
    if (!list.length) return Promise.reject(new Error('empty_text'));
    return whenPresetsReady().then(function (presets) {
      var next = presets.filter(function (p) { return p.name !== label; });
      next.unshift({ name: label, items: list, savedAt: Date.now() });
      return persistPresets(next).then(function () {
        return findPreset(label);
      });
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

  function buildPresetSelectOptions(selectedName, includeDefault) {
    var html = includeDefault !== false
      ? '<option value="">' + esc(includeDefault === 'settings' ? '选择预设' : '默认运转规则') + '</option>'
      : '';
    loadPresets().forEach(function (p) {
      html += '<option value="' + esc(p.name) + '"' + (p.name === selectedName ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return html;
  }

  function refreshPresetSelect(root, selectedName, selector) {
    var sel = root && root.querySelector(selector || '[data-mq-oprules-preset-pick]');
    if (!sel) return;
    var includeDefault = sel.getAttribute('data-mq-oprules-include-default');
    sel.innerHTML = buildPresetSelectOptions(selectedName, includeDefault || true);
  }

  function applyVariables(text, contact, profile) {
    var roleName = String((contact && contact.name) || '对方');
    var userName = String((profile && profile.name) || '用户');
    return String(text || '')
      .replace(/\{\{角色名\}\}/g, roleName)
      .replace(/\{\{用户名\}\}/g, userName)
      .replace(/\{\{roleName\}\}/g, roleName)
      .replace(/\{\{userName\}\}/g, userName);
  }

  function normalizeChatPresetName(raw) {
    return String(raw || '').trim();
  }

  function composeOperationRules(customItems, contact, profile) {
    var texts = getEnabledTexts(
      Array.isArray(customItems) && customItems.length && typeof customItems[0] === 'object'
        ? customItems
        : (customItems || []).map(function (t) { return { text: t, enabled: true }; })
    ).map(function (t) {
      return stripLeadingNumber(applyVariables(t, contact, profile));
    }).filter(Boolean);
    if (!texts.length) return null;
    var head = formatNumberedLines(texts, 1);
    var tail = buildFormatTailFrom(texts.length + 1);
    if (!tail) tail = formatNumberedLines(DEFAULT_FORMAT_TAIL_ITEMS, texts.length + 1);
    return '【运转规则·必读】\n' + head + '\n' + tail;
  }

  function resolvePresetName(chatSettings) {
    return normalizeChatPresetName(
      chatSettings && (chatSettings.operationRulesPreset != null
        ? chatSettings.operationRulesPreset
        : chatSettings.operationRules && chatSettings.operationRules.presetName)
    );
  }

  function resolveForChat(chatSettings, contact, profile) {
    hydratePresetsSync();
    var presetName = resolvePresetName(chatSettings);
    if (!presetName) return null;
    var preset = findPreset(presetName);
    if (!preset) return null;
    var items = getPresetItems(preset);
    if (!getEnabledTexts(items).length) return null;
    return composeOperationRules(items, contact, profile);
  }

  function inspectForChat(chatSettings, contact, profile) {
    hydratePresetsSync();
    var presetName = resolvePresetName(chatSettings);
    if (!presetName) {
      return { presetName: '', block: null, itemCount: 0, bodyChars: 0, reason: 'no_preset_selected' };
    }
    var preset = findPreset(presetName);
    if (!preset) {
      return {
        presetName: presetName,
        block: null,
        itemCount: 0,
        bodyChars: 0,
        presetFound: false,
        reason: 'preset_not_found',
        libraryCount: loadPresets().length
      };
    }
    var items = getPresetItems(preset);
    var enabled = getEnabledTexts(items);
    if (!enabled.length) {
      return {
        presetName: presetName,
        block: null,
        itemCount: 0,
        bodyChars: 0,
        presetFound: true,
        reason: 'preset_empty'
      };
    }
    var block = composeOperationRules(items, contact, profile);
    var bodyChars = enabled.reduce(function (n, t) { return n + String(t || '').length; }, 0);
    return {
      presetName: presetName,
      block: block,
      itemCount: enabled.length,
      bodyChars: bodyChars,
      presetFound: true,
      reason: block ? 'ok' : 'compose_failed'
    };
  }

  function resolveForChatAsync(chatSettings, contact, profile) {
    return ensureLoaded().then(function () {
      return resolveForChat(chatSettings, contact, profile);
    });
  }

  function padIndex(n) {
    n = Number(n) || 1;
    return (n < 10 ? '0' : '') + n;
  }

  var OPRULES_REMOVE_SVG =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M18 6L6 18M6 6l12 12"/>' +
    '</svg>';
  var OPRULES_PLUS_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M12 5v14M5 12h14"/>' +
    '</svg>';

  function buildItemRowHtml(index, item) {
    var row = normalizeItemRow(item) || { name: '', text: '', enabled: true };
    if (typeof item === 'string') row = { name: '', text: stripLeadingNumber(item), enabled: true };
    var on = row.enabled !== false;
    return '<article class="mi-oprules-card' + (on ? '' : ' is-off') + '" data-mq-oprules-item>' +
      '<div class="mi-oprules-card__top">' +
        '<div class="mi-oprules-card__title">' +
          '<span class="mi-oprules-card__idx" data-mq-oprules-item-num>' + padIndex(index) + '</span>' +
          '<input type="text" class="mi-oprules-card__name" data-mq-oprules-item-name' +
            ' placeholder="规则名称（可选）" maxlength="64" value="' + esc(row.name || '') + '">' +
        '</div>' +
        '<div class="mi-oprules-card__ctrls">' +
          '<button type="button" class="mi-oprules-switch' + (on ? ' is-on' : '') + '"' +
            ' data-mq-oprules-item-enabled role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' +
            ' aria-label="启用此条"></button>' +
          '<button type="button" class="mi-oprules-card__x" data-mq-oprules-item-del aria-label="删除此条">' +
            OPRULES_REMOVE_SVG +
          '</button>' +
        '</div>' +
      '</div>' +
      '<textarea class="mi-oprules-card__body" data-mq-oprules-item-text rows="4"' +
        ' placeholder="写下这条规则…">' + esc(row.text || '') + '</textarea>' +
    '</article>';
  }

  function renderItemsList(root, items) {
    var list = root && root.querySelector('[data-mq-oprules-items]');
    if (!list) return;
    var rows = Array.isArray(items) && items.length ? items : [{ name: '', text: '', enabled: true }];
    list.innerHTML = rows.map(function (item, i) {
      return buildItemRowHtml(i + 1, item);
    }).join('');
  }

  function refreshItemNumbers(root) {
    if (!root) return;
    root.querySelectorAll('[data-mq-oprules-item]').forEach(function (row, i) {
      var num = row.querySelector('[data-mq-oprules-item-num]');
      if (num) num.textContent = padIndex(i + 1);
    });
  }

  function readItemsFromRoot(root, opts) {
    if (!root) return [];
    var keepEmpty = !!(opts && opts.keepEmpty);
    var out = [];
    root.querySelectorAll('[data-mq-oprules-item]').forEach(function (row) {
      var nameEl = row.querySelector('[data-mq-oprules-item-name]');
      var ta = row.querySelector('[data-mq-oprules-item-text]');
      var sw = row.querySelector('[data-mq-oprules-item-enabled]');
      var name = nameEl ? String(nameEl.value || '').trim().slice(0, 64) : '';
      var text = stripLeadingNumber(String((ta && ta.value) || '').trim());
      var enabled = !(sw && !sw.classList.contains('is-on'));
      if (!text && !keepEmpty) return;
      out.push({ name: name, text: text, enabled: enabled });
    });
    return out;
  }

  function sanitizeExportFileName(name) {
    return String(name || 'preset')
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '-')
      .trim()
      .slice(0, 48) || 'preset';
  }

  function buildExportPayload(name, items) {
    var list = normalizeItems(items).filter(itemHasText);
    return {
      format: EXPORT_FORMAT,
      version: 1,
      name: String(name || '').trim(),
      items: list.map(function (it) {
        return {
          name: String(it.name || '').trim(),
          text: String(it.text || '').trim(),
          enabled: it.enabled !== false
        };
      }),
      exportedAt: Date.now()
    };
  }

  function parseImportPayload(raw) {
    if (raw == null) return null;
    var data = raw;
    if (typeof raw === 'string') {
      var text = String(raw).replace(/^\uFEFF/, '').trim();
      if (!text) return null;
      try {
        data = JSON.parse(text);
      } catch (e1) {
        var start = text.indexOf('{');
        var end = text.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
          data = JSON.parse(text.slice(start, end + 1));
        } catch (e2) {
          return null;
        }
      }
    }
    if (!data || typeof data !== 'object') return null;

    // 单预设
    if (Array.isArray(data.items) || data.text || data.body || data.content) {
      var items = normalizeItems(data.items, data.text || data.body || data.content).filter(itemHasText);
      if (!items.length) return null;
      return {
        name: String(data.name || '').trim(),
        items: items
      };
    }

    // 预设数组 / { presets: [...] }
    var list = Array.isArray(data) ? data : (Array.isArray(data.presets) ? data.presets : null);
    if (list && list.length) {
      var first = list.map(normalizePresetRow).filter(Boolean)[0];
      if (!first) return null;
      var imported = first.items.filter(itemHasText);
      if (!imported.length) return null;
      return { name: first.name, items: imported };
    }

    return null;
  }

  function downloadJson(payload, filename) {
    try {
      var blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8'
      });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'miya-operation-rules.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        try { URL.revokeObjectURL(url); } catch (eRev) {}
      }, 1500);
      return true;
    } catch (e) {
      return false;
    }
  }

  function exportCurrentOrSelected(root) {
    var pick = root.querySelector('[data-mq-oprules-preset-pick]');
    var selected = pick ? String(pick.value || '').trim() : '';
    var items = readItemsFromRoot(root);
    var name = selected;
    if (selected) {
      var preset = findPreset(selected);
      if (preset) {
        var presetItems = getPresetItems(preset);
        // 若编辑器有内容则优先导出编辑器；否则导出库内预设
        if (!items.length) {
          items = presetItems;
          name = preset.name;
        } else {
          name = selected;
        }
      }
    }
    if (!items.length) {
      toast('请至少添加一条规则');
      return;
    }
    var payload = buildExportPayload(name || '运转规则', items);
    var ok = downloadJson(payload, 'miya-oprules-' + sanitizeExportFileName(payload.name) + '.json');
    toast(ok ? '已导出 JSON' : '导出失败');
  }

  function importFromFile(root, file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed = parseImportPayload(String(reader.result || ''));
      if (!parsed || !parsed.items || !parsed.items.length) {
        toast('无法解析该 JSON');
        return;
      }
      renderItemsList(root, parsed.items);
      refreshItemNumbers(root);
      if (parsed.name) {
        refreshPresetSelect(root, parsed.name);
        var sel = root.querySelector('[data-mq-oprules-preset-pick]');
        if (sel) {
          var opt = Array.prototype.find.call(sel.options, function (o) {
            return o.value === parsed.name;
          });
          if (!opt) {
            // 名称不在库中：保持选择为空，提示可保存
            sel.value = '';
          } else {
            sel.value = parsed.name;
          }
        }
      }
      toast(parsed.name ? ('已导入「' + parsed.name + '」') : '已导入预设');
    };
    reader.onerror = function () {
      toast('读取文件失败');
    };
    reader.readAsText(file, 'utf-8');
  }

  function buildSettingsPanelHtml() {
    return '<div class="mi-oprules-ins">' +
      '<header class="mi-oprules-ins__top">' +
        '<p class="mi-oprules-ins__sub">每条独立开关 · 关闭不注入</p>' +
        '<div class="mi-oprules-ins__top-actions">' +
          '<button type="button" class="mi-oprules-pill" data-mq-oprules-preset-import>导入</button>' +
          '<button type="button" class="mi-oprules-pill mi-oprules-pill--dark" data-mq-oprules-preset-export>导出</button>' +
        '</div>' +
        '<input type="file" class="mi-oprules-ins__file" data-mq-oprules-import-file' +
          ' accept="application/json,.json,text/json,text/plain" hidden>' +
      '</header>' +
      '<div class="mi-oprules-ins__stack" data-mq-oprules-items></div>' +
      '<button type="button" class="mi-oprules-ins__add" data-mq-oprules-item-add>' +
        OPRULES_PLUS_SVG +
        '<span>添加规则</span>' +
      '</button>' +
      '<section class="mi-oprules-widget">' +
        '<div class="mi-oprules-widget__head">' +
          '<h4 class="mi-oprules-widget__title">预设库</h4>' +
        '</div>' +
        '<div class="mi-oprules-widget__select-wrap">' +
          '<select class="mi-oprules-widget__select" id="mq-oprules-preset-pick"' +
            ' data-mq-oprules-preset-pick data-mq-oprules-include-default="settings">' +
            buildPresetSelectOptions('', 'settings') +
          '</select>' +
        '</div>' +
        '<div class="mi-oprules-widget__actions">' +
          '<button type="button" class="mi-oprules-pill mi-oprules-pill--dark" data-mq-oprules-preset-save>保存</button>' +
          '<button type="button" class="mi-oprules-pill" data-mq-oprules-preset-load>读取</button>' +
          '<button type="button" class="mi-oprules-pill mi-oprules-pill--ghost" data-mq-oprules-preset-delete>删除</button>' +
        '</div>' +
      '</section>' +
      '<section class="mi-oprules-widget mi-oprules-widget--soft">' +
        '<div class="mi-oprules-widget__head">' +
          '<h4 class="mi-oprules-widget__title">已选用</h4>' +
        '</div>' +
        '<div class="mi-oprules-applied" data-mq-oprules-applied-list></div>' +
      '</section>' +
    '</div>';
  }

  function chatDisplayName(st, chat) {
    var contact = st.findContact(chat.contactId);
    var name = contact ? String(contact.remarkName || contact.name || '').trim() : '';
    if (!name) name = String(chat.title || '').trim() || '未命名';
    return name;
  }

  function getChatsWithCustomRules() {
    var st = global.miyaChatStore;
    if (!st || !st.getChats) return [];
    return st.getChats().filter(function (ch) {
      if (ch.type === 'group') return false;
      var preset = normalizeChatPresetName(st.getChatSettings(ch.id).operationRulesPreset);
      return !!preset;
    }).map(function (ch) {
      return {
        chatId: ch.id,
        name: chatDisplayName(st, ch),
        presetName: normalizeChatPresetName(st.getChatSettings(ch.id).operationRulesPreset)
      };
    });
  }

  function buildAppliedListHtml() {
    var rows = getChatsWithCustomRules();
    if (!rows.length) {
      return '<p class="mi-oprules-applied__empty">还没有聊天选用自定义预设</p>';
    }
    return '<div class="mi-oprules-applied__list">' + rows.map(function (row) {
      return '<div class="mi-oprules-applied__chip">' +
        '<span class="mi-oprules-applied__name">' + esc(row.name) + '</span>' +
        '<span class="mi-oprules-applied__preset">' + esc(row.presetName) + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function refreshAppliedList(root) {
    var list = root && root.querySelector('[data-mq-oprules-applied-list]');
    if (list) list.innerHTML = buildAppliedListHtml();
  }

  function setToggleState(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-on', !!on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    var row = btn.closest('[data-mq-oprules-item]');
    if (row) row.classList.toggle('is-off', !on);
  }

  function bindSettingsPanel(root) {
    if (!root || settingsBound) return;
    settingsBound = true;

    root.addEventListener('click', function (e) {
      var toggleBtn = e.target.closest('[data-mq-oprules-item-enabled]');
      if (toggleBtn && root.contains(toggleBtn)) {
        e.preventDefault();
        setToggleState(toggleBtn, !toggleBtn.classList.contains('is-on'));
        return;
      }
      if (e.target.closest('[data-mq-oprules-item-add]')) {
        var items = readItemsFromRoot(root, { keepEmpty: true });
        items.push({ name: '', text: '', enabled: true });
        renderItemsList(root, items);
        refreshItemNumbers(root);
        var rows = root.querySelectorAll('[data-mq-oprules-item-text]');
        var last = rows[rows.length - 1];
        if (last) last.focus();
        return;
      }
      if (e.target.closest('[data-mq-oprules-item-del]')) {
        var delBtn = e.target.closest('[data-mq-oprules-item-del]');
        var row = delBtn && delBtn.closest('[data-mq-oprules-item]');
        if (!row) return;
        var allRows = root.querySelectorAll('[data-mq-oprules-item]');
        if (allRows.length <= 1) {
          var ta = row.querySelector('[data-mq-oprules-item-text]');
          var nameEl = row.querySelector('[data-mq-oprules-item-name]');
          var sw = row.querySelector('[data-mq-oprules-item-enabled]');
          if (ta) ta.value = '';
          if (nameEl) nameEl.value = '';
          setToggleState(sw, true);
          return;
        }
        row.remove();
        refreshItemNumbers(root);
        return;
      }
      if (e.target.closest('[data-mq-oprules-preset-save]')) {
        var pick = root.querySelector('[data-mq-oprules-preset-pick]');
        var defaultName = pick && pick.value ? pick.value : '';
        var itemsSave = readItemsFromRoot(root);
        if (!itemsSave.length) {
          toast('请至少添加一条规则');
          return;
        }
        promptFn({
          title: '保存预设',
          message: '为这个运转规则预设取个名字',
          placeholder: '预设名称',
          defaultValue: defaultName
        }).then(function (name) {
          if (!name || !String(name).trim()) return;
          return savePreset(String(name).trim(), itemsSave);
        }).then(function (row) {
          if (!row) return;
          refreshPresetSelect(root, row.name);
          toast('预设已保存');
          refreshAppliedList(root);
        }).catch(function (err) {
          if (err && err.message === 'empty_text') toast('请至少添加一条规则');
          else if (err && err.message !== 'empty_name') toast('保存失败');
        });
        return;
      }
      if (e.target.closest('[data-mq-oprules-preset-load]')) {
        var sel = root.querySelector('[data-mq-oprules-preset-pick]');
        var loadName = sel ? sel.value : '';
        if (!loadName) return toast('请先选择预设');
        var preset = findPreset(loadName);
        if (!preset) return toast('预设不存在');
        var presetItems = getPresetItems(preset);
        renderItemsList(root, presetItems.length ? presetItems : [{ name: '', text: '', enabled: true }]);
        refreshItemNumbers(root);
        toast('已读取「' + loadName + '」');
        return;
      }
      if (e.target.closest('[data-mq-oprules-preset-delete]')) {
        var selDel = root.querySelector('[data-mq-oprules-preset-pick]');
        var delName = selDel ? selDel.value : '';
        if (!delName) return toast('请先选择要删除的预设');
        confirmFn({
          title: '删除预设',
          message: '确定删除「' + delName + '」？已选用该预设的联系人将回退为默认规则。',
          confirmText: '删除',
          cancelText: '取消'
        }).then(function (ok) {
          if (!ok) return;
          return deletePreset(delName);
        }).then(function () {
          refreshPresetSelect(root, '');
          toast('预设已删除');
          refreshAppliedList(root);
        }).catch(function (err) {
          if (err && err.message !== 'not_found') toast('删除失败');
        });
        return;
      }
      if (e.target.closest('[data-mq-oprules-preset-export]')) {
        exportCurrentOrSelected(root);
        return;
      }
      if (e.target.closest('[data-mq-oprules-preset-import]')) {
        var fileInput = root.querySelector('[data-mq-oprules-import-file]');
        if (fileInput) {
          fileInput.value = '';
          fileInput.click();
        }
      }
    });

    root.addEventListener('change', function (e) {
      var input = e.target.closest('[data-mq-oprules-import-file]');
      if (!input || !root.contains(input)) return;
      var file = input.files && input.files[0];
      importFromFile(root, file);
      input.value = '';
    });
  }

  function onSettingsPanelOpen() {
    var panel = document.getElementById('miya-st-panel-operation-rules');
    if (!panel) return whenPresetsReady();
    return whenPresetsReady().then(function () {
      if (!panel.dataset.mqOprulesRendered || panel.dataset.mqOprulesRendered !== PANEL_RENDER_VER) {
        panel.innerHTML = buildSettingsPanelHtml();
        panel.dataset.mqOprulesRendered = PANEL_RENDER_VER;
        settingsBound = false;
        bindSettingsPanel(panel);
        renderItemsList(panel, [{ name: '', text: '', enabled: true }]);
        refreshItemNumbers(panel);
      }
      refreshPresetSelect(panel, '');
      refreshAppliedList(panel);
    });
  }

  function buildChatSettingsPickerHtml(selectedName) {
    var preset = normalizeChatPresetName(selectedName);
    return '<div class="mi-oprules-pick mi-oprules-pick--ins">' +
      '<div class="mi-oprules-widget__select-wrap">' +
        '<select class="mi-oprules-widget__select" data-mq-set-oprules-preset data-mq-oprules-include-default="chat">' +
          buildPresetSelectOptions(preset, true) +
        '</select>' +
      '</div>' +
    '</div>';
  }

  function readChatPresetFromRoot(root, base) {
    var sel = root && root.querySelector('[data-mq-set-oprules-preset]');
    if (!sel) return normalizeChatPresetName(base);
    return String(sel.value || '').trim();
  }

  function syncChatPresetSelect(root, storedName) {
    if (!root) return;
    var sel = root.querySelector('[data-mq-set-oprules-preset]');
    if (!sel) return;
    var stored = normalizeChatPresetName(storedName);
    refreshPresetSelect(root, stored, '[data-mq-set-oprules-preset]');
    if (stored) sel.value = stored;
  }

  global.MiyaChatOperationRules = {
    PRESETS_LS: PRESETS_LS,
    EXPORT_FORMAT: EXPORT_FORMAT,
    whenPresetsReady: whenPresetsReady,
    ensureLoaded: ensureLoaded,
    invalidatePresetsCache: invalidatePresetsCache,
    loadPresets: loadPresets,
    savePreset: savePreset,
    deletePreset: deletePreset,
    findPreset: findPreset,
    resolveForChat: resolveForChat,
    resolveForChatAsync: resolveForChatAsync,
    inspectForChat: inspectForChat,
    getPresetItems: getPresetItems,
    getEnabledTexts: getEnabledTexts,
    composeOperationRules: composeOperationRules,
    buildPresetSelectOptions: buildPresetSelectOptions,
    refreshPresetSelect: refreshPresetSelect,
    buildSettingsPanelHtml: buildSettingsPanelHtml,
    onSettingsPanelOpen: onSettingsPanelOpen,
    buildChatSettingsPickerHtml: buildChatSettingsPickerHtml,
    readChatPresetFromRoot: readChatPresetFromRoot,
    syncChatPresetSelect: syncChatPresetSelect,
    normalizeChatPresetName: normalizeChatPresetName,
    getChatsWithCustomRules: getChatsWithCustomRules,
    buildExportPayload: buildExportPayload,
    parseImportPayload: parseImportPayload
  };

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({ whenReady: ensureLoaded });
  }
  whenPresetsReady();
})(window);
