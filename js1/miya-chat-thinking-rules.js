/**
 * Miya 线上思维链 · 预设库（设置软件编辑）+ 各聊天选用
 */
(function (global) {
  'use strict';

  var PRESETS_LS = 'miya-chat-thinking-rules-presets-v1';
  var presetsCache = null;
  var presetsReady = null;
  var settingsBound = false;

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

  function normalizePresetRow(raw) {
    if (!raw || !raw.name) return null;
    var text = stripFormatTailFromBody(String(raw.text || '').trim());
    if (!text && Array.isArray(raw.items)) {
      text = raw.items.map(function (t) { return String(t || '').trim(); }).filter(Boolean).join('\n');
      text = stripFormatTailFromBody(text);
    }
    return {
      name: String(raw.name).trim(),
      text: text,
      savedAt: raw.savedAt || Date.now()
    };
  }

  function hydratePresetsSync() {
    if (presetsCache) return presetsCache;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(PRESETS_LS);
      if (Array.isArray(raw)) {
        presetsCache = raw.map(normalizePresetRow).filter(Boolean);
        return presetsCache;
      }
    }
    return null;
  }

  function whenPresetsReady() {
    if (presetsReady) return presetsReady;
    var chain = typeof global.miyaReadLsJsonKey === 'function'
      ? global.miyaReadLsJsonKey(PRESETS_LS, [])
      : Promise.resolve([]);
    presetsReady = chain.then(function (parsed) {
      if (!Array.isArray(parsed)) parsed = [];
      presetsCache = parsed.map(normalizePresetRow).filter(Boolean);
      return presetsCache.slice();
    }).catch(function () {
      presetsCache = [];
      return [];
    });
    return presetsReady;
  }

  function loadPresets() {
    var hydrated = hydratePresetsSync();
    if (hydrated) return hydrated.slice();
    return [];
  }

  function persistPresets(list) {
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

  function savePreset(name, text) {
    var label = String(name || '').trim();
    if (!label) return Promise.reject(new Error('empty_name'));
    var raw = String(text || '').trim();
    var hadThinkingTags = /<\/?thinking>|＜\/?thinking＞|\[\/thinking\]/i.test(raw);
    var body = stripFormatTailFromBody(raw);
    if (!body) return Promise.reject(new Error('empty_text'));
    return whenPresetsReady().then(function (presets) {
      var next = presets.filter(function (p) { return p.name !== label; });
      next.unshift({ name: label, text: body, savedAt: Date.now() });
      return persistPresets(next).then(function () {
        if (hadThinkingTags) {
          toast('已移除 <thinking> 标签；预设里只需写风格指引');
        }
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
      ? '<option value="">' + esc(includeDefault === 'settings' ? '选择预设' : '默认思维链') + '</option>'
      : '';
    loadPresets().forEach(function (p) {
      html += '<option value="' + esc(p.name) + '"' + (p.name === selectedName ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return html;
  }

  function refreshPresetSelect(root, selectedName, selector) {
    var sel = root && root.querySelector(selector || '[data-mq-thrules-preset-pick]');
    if (!sel) return;
    var includeDefault = sel.getAttribute('data-mq-thrules-include-default');
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

  function getFormatTailItems() {
    var eng = global.MiyaChatEngine;
    if (eng && typeof eng.getThinkingRulesFormatTailItems === 'function') {
      return eng.getThinkingRulesFormatTailItems().slice();
    }
    return [];
  }

  function buildFormatTail() {
    var eng = global.MiyaChatEngine;
    if (eng && typeof eng.buildThinkingRulesFormatTail === 'function') {
      return String(eng.buildThinkingRulesFormatTail() || '').trim();
    }
    return getFormatTailItems().join('\n');
  }

  function stripThinkingTagsFromPreset(text) {
    return String(text || '')
      .replace(/<\/?thinking>/gi, '')
      .replace(/＜\/?thinking＞/gi, '')
      .replace(/\[\/thinking\]/gi, '')
      .trim();
  }

  function stripFormatTailFromBody(text) {
    var body = normalizeBody(text);
    body = stripThinkingTagsFromPreset(body);
    var tailItems = getFormatTailItems();
    if (!tailItems.length) return body;
    var lines = body.split('\n');
    var filtered = lines.filter(function (line) {
      var t = line.trim();
      if (!t) return true;
      return !tailItems.some(function (item) {
        var needle = String(item || '').trim();
        return needle && (t === needle || t.indexOf(needle) === 0);
      });
    });
    return filtered.join('\n').trim();
  }

  function composeThinkingRules(customText, contact, profile) {
    var head = stripFormatTailFromBody(applyVariables(customText, contact, profile));
    if (!head) return null;
    var tail = buildFormatTail();
    if (!tail) return '【思维链·必读】\n' + head;
    return '【思维链·必读】\n' + head + '\n' + tail;
  }

  function normalizeBody(text) {
    var body = String(text || '').trim();
    if (!body) return '';
    if (body.indexOf('【思维链') === 0) {
      return body.replace(/^【思维链[^】]*】\s*/u, '').trim();
    }
    return body;
  }

  function normalizeChatPresetName(raw) {
    return String(raw || '').trim();
  }

  function resolveForChat(chatSettings, contact, profile) {
    var presetName = normalizeChatPresetName(
      chatSettings && (chatSettings.thinkingRulesPreset != null
        ? chatSettings.thinkingRulesPreset
        : chatSettings.thinkingRules && chatSettings.thinkingRules.presetName)
    );
    if (!presetName) return null;
    var preset = findPreset(presetName);
    if (!preset || !preset.text) return null;
    return composeThinkingRules(preset.text, contact, profile);
  }

  function readTextFromRoot(root) {
    var ta = root && root.querySelector('[data-mq-thrules-text]');
    return ta ? String(ta.value || '').trim() : '';
  }

  function buildFormatGuideHtml() {
    return '<div class="mi-oprules-think-guide">' +
      '<p class="mi-oprules-think-guide__lead">' +
        '此处写的是给模型的<strong>思维链风格指引</strong>（system 提示），不是角色要发出去的聊天正文。' +
      '</p>' +
      '<ul class="mi-oprules-think-guide__list">' +
        '<li>用普通文字描述「怎么想」，<strong>不要写</strong> <code>&lt;thinking&gt;</code> / <code>&lt;/thinking&gt;</code> 标签</li>' +
        '<li>标签由角色<strong>每轮回复时</strong>自行输出；运转规则会规定 <code>&lt;thinking&gt; → 正文 → &lt;miyavoice&gt;</code> 三段式</li>' +
        '<li>可用占位符 <code>{{角色名}}</code>、<code>{{用户名}}</code></li>' +
        '<li>末尾「格式硬性要求」由系统自动追加，无需手写</li>' +
      '</ul>' +
    '</div>';
  }

  function buildSettingsPanelHtml() {
    return '<div class="mi-oprules-atelier mi-oprules-atelier--thinking">' +
      '<div class="mi-oprules-atelier__veil mi-oprules-atelier__veil--thinking" aria-hidden="true"></div>' +
      '<header class="mi-oprules-atelier__mast">' +
        '<span class="mi-oprules-atelier__glyph">¶</span>' +
        '<div class="mi-oprules-atelier__mast-copy">' +
          '<span class="mi-oprules-atelier__kicker">Thinking Chain</span>' +
          '<h3 class="mi-oprules-atelier__title">思维链</h3>' +
        '</div>' +
      '</header>' +
      '<section class="mi-oprules-atelier__section">' +
        '<div class="mi-oprules-atelier__section-head">' +
          '<span class="mi-oprules-atelier__section-kicker">Body</span>' +
          '<span class="mi-oprules-atelier__section-label">正文</span>' +
        '</div>' +
        buildFormatGuideHtml() +
        '<div class="mi-oprules-atelier__sheet">' +
          '<textarea class="mi-oprules-think-body" data-mq-thrules-text rows="10"></textarea>' +
        '</div>' +
      '</section>' +
      '<section class="mi-oprules-atelier__section">' +
        '<div class="mi-oprules-atelier__section-head">' +
          '<span class="mi-oprules-atelier__section-kicker">Archive</span>' +
          '<span class="mi-oprules-atelier__section-label">预设库</span>' +
        '</div>' +
        '<div class="mi-oprules-atelier__sheet mi-oprules-atelier__sheet--vault">' +
          '<div class="mi-oprules-vault__field">' +
            '<label class="mi-oprules-vault__label" for="mq-thrules-preset-pick">Preset</label>' +
            '<div class="mi-oprules-vault__select-wrap">' +
              '<select class="mi-oprules-vault__select" id="mq-thrules-preset-pick" data-mq-thrules-preset-pick data-mq-thrules-include-default="settings">' +
                buildPresetSelectOptions('', 'settings') +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="mi-oprules-vault__toolbar">' +
            '<button type="button" class="mi-oprules-vault__btn mi-oprules-vault__btn--primary" data-mq-thrules-preset-save>保存</button>' +
            '<button type="button" class="mi-oprules-vault__btn" data-mq-thrules-preset-load>读取</button>' +
            '<button type="button" class="mi-oprules-vault__btn mi-oprules-vault__btn--muted" data-mq-thrules-preset-delete>删除</button>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="mi-oprules-atelier__section mi-oprules-atelier__section--last">' +
        '<div class="mi-oprules-atelier__section-head">' +
          '<span class="mi-oprules-atelier__section-kicker">Applied</span>' +
          '<span class="mi-oprules-atelier__section-label">已选用</span>' +
        '</div>' +
        '<div class="mi-oprules-atelier__sheet mi-oprules-atelier__sheet--applied">' +
          '<div class="mi-oprules-applied" data-mq-thrules-applied-list></div>' +
        '</div>' +
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
      var preset = normalizeChatPresetName(st.getChatSettings(ch.id).thinkingRulesPreset);
      return !!preset;
    }).map(function (ch) {
      return {
        chatId: ch.id,
        name: chatDisplayName(st, ch),
        presetName: normalizeChatPresetName(st.getChatSettings(ch.id).thinkingRulesPreset)
      };
    });
  }

  function buildAppliedListHtml() {
    var rows = getChatsWithCustomRules();
    if (!rows.length) {
      return '<p class="mi-oprules-applied__empty">—</p>';
    }
    return rows.map(function (row) {
      return '<div class="mi-oprules-applied__chip">' +
        '<span class="mi-oprules-applied__name">' + esc(row.name) + '</span>' +
        '<span class="mi-oprules-applied__preset">' + esc(row.presetName) + '</span>' +
      '</div>';
    }).join('');
  }

  function refreshAppliedList(root) {
    var list = root && root.querySelector('[data-mq-thrules-applied-list]');
    if (list) list.innerHTML = buildAppliedListHtml();
  }

  function bindSettingsPanel(root) {
    if (!root || settingsBound) return;
    settingsBound = true;
    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-mq-thrules-preset-save]')) {
        var pick = root.querySelector('[data-mq-thrules-preset-pick]');
        var defaultName = pick && pick.value ? pick.value : '';
        var body = readTextFromRoot(root);
        if (!body) {
          toast('请先编写思维链内容');
          return;
        }
        promptFn({
          title: '保存预设',
          message: '为这个思维链预设取个名字',
          placeholder: '预设名称',
          defaultValue: defaultName
        }).then(function (name) {
          if (!name || !String(name).trim()) return;
          return savePreset(String(name).trim(), body);
        }).then(function (row) {
          if (!row) return;
          refreshPresetSelect(root, row.name);
          toast('预设已保存');
          refreshAppliedList(root);
        }).catch(function (err) {
          if (err && err.message === 'empty_text') toast('请先编写思维链内容');
          else if (err && err.message !== 'empty_name') toast('保存失败');
        });
        return;
      }
      if (e.target.closest('[data-mq-thrules-preset-load]')) {
        var sel = root.querySelector('[data-mq-thrules-preset-pick]');
        var loadName = sel ? sel.value : '';
        if (!loadName) return toast('请先选择预设');
        var preset = findPreset(loadName);
        if (!preset) return toast('预设不存在');
        var ta = root.querySelector('[data-mq-thrules-text]');
        if (ta) ta.value = preset.text || '';
        toast('已读取「' + loadName + '」');
        return;
      }
      if (e.target.closest('[data-mq-thrules-preset-delete]')) {
        var selDel = root.querySelector('[data-mq-thrules-preset-pick]');
        var delName = selDel ? selDel.value : '';
        if (!delName) return toast('请先选择要删除的预设');
        confirmFn({
          title: '删除预设',
          message: '确定删除「' + delName + '」？已选用该预设的联系人将回退为默认思维链。',
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
      }
    });
  }

  function onSettingsPanelOpen() {
    var panel = document.getElementById('miya-st-panel-thinking-rules');
    if (!panel) return whenPresetsReady();
    return whenPresetsReady().then(function () {
      if (!panel.dataset.mqThrulesRendered || panel.dataset.mqThrulesRendered !== '4') {
        panel.innerHTML = buildSettingsPanelHtml();
        panel.dataset.mqThrulesRendered = '4';
        settingsBound = false;
        bindSettingsPanel(panel);
      }
      refreshPresetSelect(panel, '');
      refreshAppliedList(panel);
    });
  }

  function buildChatSettingsPickerHtml(selectedName) {
    var preset = normalizeChatPresetName(selectedName);
    return '<div class="mi-oprules-pick">' +
      '<div class="mi-oprules-pick__head">' +
        '<span class="mi-oprules-pick__kicker">Thinking</span>' +
        '<span class="mi-oprules-pick__label">思维链</span>' +
      '</div>' +
      '<div class="mi-oprules-pick__field">' +
        '<select class="mi-oprules-pick__select" data-mq-set-thrules-preset data-mq-thrules-include-default="chat">' +
          buildPresetSelectOptions(preset, true) +
        '</select>' +
      '</div>' +
    '</div>';
  }

  function readChatPresetFromRoot(root, base) {
    var sel = root && root.querySelector('[data-mq-set-thrules-preset]');
    if (!sel) return normalizeChatPresetName(base);
    return String(sel.value || '').trim();
  }

  function syncChatPresetSelect(root, storedName) {
    if (!root) return;
    var sel = root.querySelector('[data-mq-set-thrules-preset]');
    if (!sel) return;
    var stored = normalizeChatPresetName(storedName);
    refreshPresetSelect(root, stored, '[data-mq-set-thrules-preset]');
    if (stored) sel.value = stored;
  }

  global.MiyaChatThinkingRules = {
    PRESETS_LS: PRESETS_LS,
    whenPresetsReady: whenPresetsReady,
    loadPresets: loadPresets,
    savePreset: savePreset,
    deletePreset: deletePreset,
    findPreset: findPreset,
    resolveForChat: resolveForChat,
    buildPresetSelectOptions: buildPresetSelectOptions,
    refreshPresetSelect: refreshPresetSelect,
    buildSettingsPanelHtml: buildSettingsPanelHtml,
    onSettingsPanelOpen: onSettingsPanelOpen,
    buildChatSettingsPickerHtml: buildChatSettingsPickerHtml,
    readChatPresetFromRoot: readChatPresetFromRoot,
    syncChatPresetSelect: syncChatPresetSelect,
    normalizeChatPresetName: normalizeChatPresetName,
    getChatsWithCustomRules: getChatsWithCustomRules
  };

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({ whenReady: whenPresetsReady });
  }
  whenPresetsReady();
})(window);
