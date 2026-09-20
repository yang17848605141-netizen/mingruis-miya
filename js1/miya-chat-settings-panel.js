/**
 * 设置 · 联系人聊天全局配置（感知 / 记忆 / 后台）
 */
(function (global) {
  'use strict';

  var selectedContactId = null;
  var panelDraft = {
    global: null,
    useGlobal: null,
    perByContact: {}
  };

  function captureGlobalDraft() {
    var mod = gs();
    if (!mod) return;
    panelDraft.global = readForm('miya-ct-chat-global', mod.getState().global);
    panelDraft.useGlobal = isToggleOn('miya-ct-chat-use-global');
  }

  function capturePerDraft(contactId) {
    var cid = String(contactId || '').trim();
    if (!cid) return;
    var mod = gs();
    if (!mod) return;
    panelDraft.perByContact[cid] = {
      useGlobal: isToggleOn('miya-ct-chat-per-use-global'),
      form: readForm('miya-ct-chat-per', mod.getState().global)
    };
  }

  function applyGlobalDraft() {
    if (!panelDraft.global) return;
    fillForm('miya-ct-chat-global', panelDraft.global);
    if (panelDraft.useGlobal != null) setToggle('miya-ct-chat-use-global', panelDraft.useGlobal !== false);
  }

  function applyPerDraft(contactId) {
    loadPerContactForm(contactId);
  }

  function $(id) { return document.getElementById(id); }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function gs() { return global.miyaChatGlobalSettings; }

  function isToggleOn(id) {
    var el = $(id);
    return el ? el.classList.contains('is-on') : false;
  }

  function setToggle(id, v) {
    var el = $(id);
    if (!el) return;
    el.classList.toggle('is-on', !!v);
    el.setAttribute('aria-checked', v ? 'true' : 'false');
  }

  function readNum(id, fallback) {
    var el = $(id);
    var n = parseInt(el && el.value, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function readVal(id) {
    var el = $(id);
    return el ? String(el.value || '').trim() : '';
  }

  function setVal(id, v) {
    var el = $(id);
    if (el) el.value = v != null ? v : '';
  }

  function pad2(n) {
    n = Number(n) || 0;
    return (n < 10 ? '0' : '') + n;
  }

  function minToTimeStr(min) {
    var m = parseInt(min, 10);
    if (!Number.isFinite(m)) m = 0;
    m = Math.min(1439, Math.max(0, m));
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  function timeStrToMin(str) {
    var m = String(str || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return NaN;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function toggleRow(id, label, hint) {
    return '<div class="miya-ct-row">' +
      '<div class="miya-ct-row__text">' +
        '<strong>' + esc(label) + '</strong>' +
        (hint ? '<span class="miya-ct-row__hint">' + esc(hint) + '</span>' : '') +
      '</div>' +
      '<button type="button" class="ins-toggle" id="' + id + '" role="switch" aria-checked="false"></button>' +
    '</div>';
  }

  function fieldRow(label, inputHtml) {
    return '<div class="miya-ct-field">' +
      '<label class="miya-ct-field__label">' + esc(label) + '</label>' +
      inputHtml +
    '</div>';
  }

  function fillForm(prefix, slice) {
    slice = slice || {};
    var ta = slice.timeAwareness || {};
    var bg = slice.backgroundMessage || {};
    setToggle(prefix + '-time-en', !!ta.enabled);
    setVal(prefix + '-memory-count', slice.memoryCount != null ? slice.memoryCount : 40);
    setVal(prefix + '-summary-trigger', slice.summaryTrigger != null ? slice.summaryTrigger : 0);
    setToggle(prefix + '-bg-active', !!bg.activeEnabled);
    setVal(prefix + '-bg-active-min', bg.activeIntervalMin != null ? bg.activeIntervalMin : 30);
    setToggle(prefix + '-bg-quiet-en', !!bg.quietEnabled);
    setVal(prefix + '-bg-quiet-start', minToTimeStr(bg.quietStartMin != null ? bg.quietStartMin : 1380));
    setVal(prefix + '-bg-quiet-end', minToTimeStr(bg.quietEndMin != null ? bg.quietEndMin : 420));
  }

  function readForm(prefix, baseSlice) {
    baseSlice = baseSlice || {};
    var ta = Object.assign({}, baseSlice.timeAwareness || {}, {
      enabled: isToggleOn(prefix + '-time-en'),
      mode: 'real',
      real: Object.assign({}, (baseSlice.timeAwareness && baseSlice.timeAwareness.real) || {}, {
        strength: 'strong'
      })
    });
    var qStart = timeStrToMin(readVal(prefix + '-bg-quiet-start'));
    var qEnd = timeStrToMin(readVal(prefix + '-bg-quiet-end'));
    var bg = Object.assign({}, baseSlice.backgroundMessage || {}, {
      activeEnabled: isToggleOn(prefix + '-bg-active'),
      activeIntervalMin: readNum(prefix + '-bg-active-min', 30),
      activityEnabled: false,
      offlineEnabled: false,
      quietEnabled: isToggleOn(prefix + '-bg-quiet-en'),
      quietStartMin: Number.isFinite(qStart) ? qStart : 1380,
      quietEndMin: Number.isFinite(qEnd) ? qEnd : 420
    });
    return {
      timeAwareness: ta,
      memoryCount: readNum(prefix + '-memory-count', 40),
      summaryTrigger: readNum(prefix + '-summary-trigger', 0),
      backgroundMessage: bg
    };
  }

  function formBlock(prefix, title) {
    return '<section class="miya-ct-section" data-form-prefix="' + prefix + '">' +
      (title ? '<h3 class="miya-ct-section__title">' + esc(title) + '</h3>' : '') +
      '<div class="miya-ct-card">' +
        '<p class="miya-ct-card__kicker">时间感知</p>' +
        toggleRow(prefix + '-time-en', '启用时间感知', '向模型注入真实时间上下文') +
      '</div>' +
      '<div class="miya-ct-card">' +
        '<p class="miya-ct-card__kicker">记忆</p>' +
        fieldRow('上下文条数', '<input type="number" class="miya-ct-input" id="' + prefix + '-memory-count" min="1" max="500" value="40">') +
        fieldRow('自动总结触发', '<input type="number" class="miya-ct-input" id="' + prefix + '-summary-trigger" min="0" max="500" value="0">') +
      '</div>' +
      '<div class="miya-ct-card">' +
        '<p class="miya-ct-card__kicker">后台消息</p>' +
        '<p class="miya-ct-row__hint" style="margin:0 0 10px;">「让TA自己决定何时找你」请在各聊天的聊天设置里单独开启。</p>' +
        toggleRow(prefix + '-bg-active', '主动发消息', '距最后一条消息达到间隔即触发，不论谁发的') +
        fieldRow('主动间隔（分钟）', '<input type="number" class="miya-ct-input" id="' + prefix + '-bg-active-min" min="5" value="30">') +
        '<p class="miya-ct-row__hint" style="margin:0 0 10px;">从会话最后一条消息起算；静默时间段内即使到达间隔也不会主动发消息（以本地时间为准）。</p>' +
        fieldRow('静默时段', '<div class="miya-ct-inline" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<input type="time" class="miya-ct-input" id="' + prefix + '-bg-quiet-start" step="60" style="width:112px;">' +
          '<span style="font-size:12px;color:var(--mc-ink-dim,#888);">至</span>' +
          '<input type="time" class="miya-ct-input" id="' + prefix + '-bg-quiet-end" step="60" style="width:112px;">' +
        '</div>') +
        toggleRow(prefix + '-bg-quiet-en', '启用静默', '该时段内角色不会主动发消息') +
      '</div>' +
    '</section>';
  }

  function renderPanelHtml() {
    return '<div class="miya-ct-chat-panel">' +
      '<p class="miya-ct-intro">配置时间感知、记忆与后台消息。默认对所有联系人生效，也可为单人单独覆盖。</p>' +
      '<div class="miya-ct-card miya-ct-card--accent">' +
        toggleRow('miya-ct-chat-use-global', '全员使用全局配置', '关闭后可按联系人单独设置') +
      '</div>' +
      formBlock('miya-ct-chat-global', '全局默认') +
      '<button type="button" class="miya-ct-btn miya-ct-btn--primary" id="miya-ct-chat-save-global">保存全局设置</button>' +
      '<div class="miya-ct-divider"></div>' +
      '<div class="miya-ct-card">' +
        '<p class="miya-ct-card__kicker">按联系人</p>' +
        fieldRow('选择联系人', '<select class="miya-ct-input miya-ct-input--select" id="miya-ct-chat-pick-contact"><option value="">选择联系人</option></select>') +
        '<div id="miya-ct-chat-per-global-wrap" hidden>' +
          toggleRow('miya-ct-chat-per-use-global', '此联系人使用全局', '开启后忽略下方单独配置') +
        '</div>' +
      '</div>' +
      '<div id="miya-ct-chat-per-form" hidden></div>' +
      '<button type="button" class="miya-ct-btn" id="miya-ct-chat-save-per" hidden>保存此联系人</button>' +
    '</div>';
  }

  function bindTogglesIn(root) {
    if (!root) return;
    root.querySelectorAll('.ins-toggle').forEach(function (btn) {
      if (btn.dataset.ctToggleBound) return;
      btn.dataset.ctToggleBound = '1';
      btn.addEventListener('click', function () {
        var on = !btn.classList.contains('is-on');
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    });
  }

  function hydrateContactPicker() {
    var pick = $('miya-ct-chat-pick-contact');
    if (!pick) return;
    var chain = Promise.resolve();
    if (global.miyaContactsStore && global.miyaContactsStore.whenReady) {
      chain = chain.then(function () { return global.miyaContactsStore.whenReady(); });
    }
    if (global.miyaChatStore && global.miyaChatStore.init) {
      chain = chain.then(function () { return global.miyaChatStore.init(); });
    }
    if (global.miyaChatContactsSync && global.miyaChatContactsSync.syncAll) {
      chain = chain.then(function () {
        return global.miyaChatContactsSync.syncAll({ prune: false });
      });
    }
    chain.then(function () {
      if (!global.miyaChatStore) return;
      var contacts = global.miyaChatStore.getContacts('all');
      pick.innerHTML = '<option value="">选择联系人</option>' +
        contacts.map(function (c) {
          return '<option value="' + esc(c.id) + '">' + esc(c.remarkName || c.name) + '</option>';
        }).join('');
    });
  }

  function loadGlobalForm() {
    var mod = gs();
    if (!mod) return;
    mod.whenReady().then(function () {
      var st = mod.getState();
      setToggle('miya-ct-chat-use-global', st.useGlobal !== false);
      fillForm('miya-ct-chat-global', st.global);
    });
  }

  function loadPerContactForm(contactId) {
    selectedContactId = contactId || null;
    var perForm = $('miya-ct-chat-per-form');
    var perWrap = $('miya-ct-chat-per-global-wrap');
    var saveBtn = $('miya-ct-chat-save-per');
    if (!contactId) {
      if (perForm) { perForm.hidden = true; perForm.innerHTML = ''; }
      if (perWrap) perWrap.hidden = true;
      if (saveBtn) saveBtn.hidden = true;
      return;
    }
    var mod = gs();
    var st = global.miyaChatStore;
    if (!mod || !st) return;
    Promise.all([mod.whenReady(), st.init()]).then(function () {
      var gState = mod.getState();
      var contact = st.findContact(contactId);
      var perRow = gState.perContact[contactId] || { useGlobal: true, settings: {} };
      var base = mod.defaultGlobalSlice();
      var slice = Object.assign({}, base, perRow.settings || {});
      var draftRow = panelDraft.perByContact[contactId];
      var useGlobal = draftRow ? draftRow.useGlobal !== false : perRow.useGlobal !== false;
      if (perForm) {
        perForm.hidden = false;
        perForm.innerHTML = formBlock('miya-ct-chat-per', (contact && contact.name) || '联系人');
        bindTogglesIn(perForm);
      }
      if (perWrap) perWrap.hidden = false;
      if (saveBtn) saveBtn.hidden = false;
      setToggle('miya-ct-chat-per-use-global', useGlobal);
      var perFormVisible = useGlobal === false;
      if (perForm) perForm.hidden = !perFormVisible;
      if (saveBtn) saveBtn.hidden = !perFormVisible;
      if (perFormVisible) {
        fillForm('miya-ct-chat-per', draftRow && draftRow.form ? draftRow.form : slice);
      }
    });
  }

  function stampBackgroundActiveToggle(nextBg, prevBg) {
    prevBg = prevBg || {};
    nextBg = nextBg || {};
    if (nextBg.activeEnabled && !prevBg.activeEnabled) {
      nextBg.activeEnabledAt = Date.now();
      nextBg.proactiveBaselineAt = Date.now();
    } else if (nextBg.activeEnabled === false && prevBg.activeEnabled) {
      nextBg.activeEnabledAt = 0;
    }
    return nextBg;
  }

  function bindPanel() {
    var panel = $('miya-st-panel-contact-chat');
    if (!panel || panel.dataset.bound) return;
    panel.dataset.bound = '1';
    panel.innerHTML = renderPanelHtml();
    bindTogglesIn(panel);

    panel.addEventListener('input', function () {
      captureGlobalDraft();
      if (selectedContactId) capturePerDraft(selectedContactId);
    });
    panel.addEventListener('click', function (e) {
      if (!e.target.closest('.ins-toggle')) return;
      setTimeout(function () {
        captureGlobalDraft();
        if (selectedContactId) capturePerDraft(selectedContactId);
      }, 0);
    });

    $('miya-ct-chat-save-global').addEventListener('click', function () {
      var mod = gs();
      if (!mod) return;
      var st = mod.getState();
      var prevBg = (st.global && st.global.backgroundMessage) || {};
      var patch = readForm('miya-ct-chat-global', st.global);
      stampBackgroundActiveToggle(patch.backgroundMessage, prevBg);
      mod.saveState({ useGlobal: isToggleOn('miya-ct-chat-use-global'), global: patch }).then(function () {
        panelDraft.global = null;
        panelDraft.useGlobal = null;
        loadGlobalForm();
        if (global.miyaSettingsApp && global.miyaSettingsApp.toast) {
          global.miyaSettingsApp.toast('全局聊天设置已保存');
        }
      });
    });

    var useGlobalEl = $('miya-ct-chat-use-global');
    if (useGlobalEl) {
      useGlobalEl.addEventListener('click', function () {
        var mod = gs();
        if (!mod) return;
        setTimeout(function () {
          mod.saveState({ useGlobal: isToggleOn('miya-ct-chat-use-global') });
        }, 0);
      });
    }

    $('miya-ct-chat-pick-contact').addEventListener('change', function () {
      if (selectedContactId) capturePerDraft(selectedContactId);
      captureGlobalDraft();
      var nextId = this.value;
      loadPerContactForm(nextId);
    });

    $('miya-ct-chat-per-use-global').addEventListener('click', function () {
      setTimeout(function () {
        var useG = isToggleOn('miya-ct-chat-per-use-global');
        var perForm = $('miya-ct-chat-per-form');
        var saveBtn = $('miya-ct-chat-save-per');
        if (perForm) perForm.hidden = useG;
        if (saveBtn) saveBtn.hidden = useG;
        if (!useG && selectedContactId) {
          var mod = gs();
          if (mod) fillForm('miya-ct-chat-per', mod.getState().global);
        }
      }, 0);
    });

    $('miya-ct-chat-save-per').addEventListener('click', function () {
      if (!selectedContactId) return;
      var mod = gs();
      if (!mod) return;
      var useGlobal = isToggleOn('miya-ct-chat-per-use-global');
      if (useGlobal) {
        mod.savePerContact(selectedContactId, { useGlobal: true, settings: {} }).then(function () {
          if (global.miyaSettingsApp) global.miyaSettingsApp.toast('已恢复使用全局配置');
        });
        return;
      }
      var base = mod.getState().global;
      var prevRow = mod.getState().perContact[selectedContactId] || {};
      var prevBg = (prevRow.settings && prevRow.settings.backgroundMessage) || base.backgroundMessage || {};
      var patch = readForm('miya-ct-chat-per', base);
      stampBackgroundActiveToggle(patch.backgroundMessage, prevBg);
      mod.savePerContact(selectedContactId, { useGlobal: false, settings: patch }).then(function () {
        delete panelDraft.perByContact[selectedContactId];
        if (global.miyaSettingsApp) global.miyaSettingsApp.toast('联系人单独设置已保存');
      });
    });
  }

  function onPanelOpen() {
    bindPanel();
    hydrateContactPicker();
    var mod = gs();
    if (!mod) return;
    mod.whenReady().then(function () {
      if (panelDraft.global) applyGlobalDraft();
      else loadGlobalForm();
      if (selectedContactId) {
        var pick = $('miya-ct-chat-pick-contact');
        if (pick) pick.value = selectedContactId;
        loadPerContactForm(selectedContactId);
      }
    });
  }

  global.miyaChatSettingsPanel = { onPanelOpen: onPanelOpen };
})(window);
