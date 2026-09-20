/**
 * Miya 聊天 · 联系人设置（全屏 · 单页滚动）
 */
(function (global) {
  'use strict';

  var store = null;
  var pageEl = null;
  var state = { chatId: null, searchQuery: '', formDraft: null, wbSortOpen: false, zoneOpen: {} };
  var DEFAULT_ZONE_OPEN = { basic: true };
  var renderRaf = 0;
  var ctxUsageGen = 0;

  var LANG_OPTS = [
    { v: 'auto', label: '自动' },
    { v: 'Chinese', label: '中文（普通话）' },
    { v: 'Chinese,Yue', label: '中文（粤语）' },
    { v: 'English', label: 'English' },
    { v: 'Japanese', label: '日本語' },
    { v: 'Korean', label: '한국어' }
  ];

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaChatApp && global.miyaChatApp.toast) global.miyaChatApp.toast(msg);
    else if (pageEl) {
      var el = pageEl.querySelector('.mi-toast');
      if (el) {
        el.textContent = msg;
        el.classList.add('is-show');
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
      }
    }
  }

  function dialog(opts) {
    if (global.miyaDialog) {
      if (opts.mode === 'confirm' && global.miyaDialog.confirm) return global.miyaDialog.confirm(opts);
      if (global.miyaDialog.prompt) return global.miyaDialog.prompt(opts);
    }
    return Promise.resolve(null);
  }

  function triggerFileInput(input) {
    if (!input) return;
    if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(input);
    else input.click();
  }

  function ctx() {
    if (!store || !state.chatId) return null;
    var chat = store.findChat(state.chatId);
    if (!chat) return null;
    var contact = store.findContact(chat.contactId);
    var settings = store.getChatSettings(state.chatId);
    var profiles = store.getProfiles();
    var profile = profiles.find(function (p) {
      return p.id === (chat.profileId || (contact && contact.defaultProfileId));
    }) || store.getActiveProfile();
    return { chat: chat, contact: contact, settings: settings, profiles: profiles, profile: profile };
  }

  function sectionLabel(title, sub) {
    return '<div class="st-section-label">' + esc(title) + '</div>' +
      (sub ? '<p class="st-form-hint mi-set-section-hint">' + esc(sub) + '</p>' : '');
  }

  function isZoneOpen(id) {
    if (Object.prototype.hasOwnProperty.call(state.zoneOpen, id)) {
      return !!state.zoneOpen[id];
    }
    return !!DEFAULT_ZONE_OPEN[id];
  }

  function captureZoneOpenState(body) {
    if (!body) return;
    body.querySelectorAll('[data-mq-set-zone]').forEach(function (el) {
      var id = el.getAttribute('data-mq-set-zone');
      if (id) state.zoneOpen[id] = el.classList.contains('is-open');
    });
  }

  function toggleZone(panel) {
    if (!panel) return;
    var body = panel.querySelector('.mi-set-zone__body');
    var toggle = panel.querySelector('[data-mq-set-zone-toggle]');
    if (!body) return;
    var nextOpen = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', nextOpen);
    body.hidden = !nextOpen;
    var id = panel.getAttribute('data-mq-set-zone');
    if (id) state.zoneOpen[id] = nextOpen;
    if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  }

  function renderZone(id, title, hint, content) {
    var open = isZoneOpen(id);
    return '<section class="mi-set-zone' + (open ? ' is-open' : '') + '" data-mq-set-zone="' + esc(id) + '">' +
      '<button type="button" class="mi-set-zone__head" data-mq-set-zone-toggle aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<div class="mi-set-zone__text">' +
          '<strong class="mi-set-zone__title">' + esc(title) + '</strong>' +
          (hint ? '<span class="mi-set-zone__hint">' + esc(hint) + '</span>' : '') +
        '</div>' +
        '<svg class="st-chevron mi-set-zone__chev" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
      '</button>' +
      '<div class="mi-set-zone__body"' + (open ? '' : ' hidden') + '>' + content + '</div>' +
    '</section>';
  }

  function subBlock(title, sub, inner) {
    return '<div class="mi-set-sub">' +
      (title ? '<div class="mi-set-sub__head">' +
        '<span class="mi-set-sub__title">' + esc(title) + '</span>' +
        (sub ? '<span class="mi-set-sub__hint">' + esc(sub) + '</span>' : '') +
      '</div>' : '') +
      inner +
    '</div>';
  }

  function formCard(inner, extraClass) {
    return '<div class="st-form-card ins-form-block' + (extraClass ? ' ' + extraClass : '') + '">' + inner + '</div>';
  }

  function toggleRow(id, label, sub, on) {
    return '<div class="st-toggle-in-form">' +
      '<div class="st-toggle-in-form__text">' +
        '<strong>' + esc(label) + '</strong>' +
        (sub ? '<span>' + esc(sub) + '</span>' : '') +
      '</div>' +
      '<button type="button" class="ins-toggle' + (on ? ' is-on' : '') + '" id="' + esc(id) + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"></button>' +
    '</div>';
  }

  function emoGroupToggleRow(groupId, label, on, disabled) {
    return '<div class="st-toggle-in-form mi-emo-bind-row' + (disabled ? ' is-disabled' : '') + '">' +
      '<div class="st-toggle-in-form__text"><strong>' + esc(label) + '</strong></div>' +
      '<button type="button" class="ins-toggle' + (on ? ' is-on' : '') + (disabled ? ' is-disabled' : '') +
      '" data-mq-set-emo-grp="' + esc(groupId) + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' +
      (disabled ? ' aria-disabled="true" tabindex="-1"' : '') + '></button></div>';
  }

  function syncTranslateExtrasVisibility(root) {
    if (!root) return;
    var on = isToggleOn(root, '#mq-set-trans');
    var wrap = root.querySelector('[data-mq-set-trans-extra]');
    if (wrap) wrap.hidden = !on;
  }

  function syncEmoBindGroupToggles(root) {
    if (!root) return;
    var useAll = isToggleOn(root, '#mq-set-emo-all');
    root.querySelectorAll('[data-mq-set-emo-grp]').forEach(function (sw) {
      sw.classList.toggle('is-disabled', useAll);
      sw.setAttribute('aria-disabled', useAll ? 'true' : 'false');
      if (useAll) {
        sw.classList.remove('is-on');
        sw.setAttribute('aria-checked', 'false');
      }
    });
    root.querySelectorAll('.mi-emo-bind-row').forEach(function (row) {
      row.classList.toggle('is-disabled', useAll);
    });
  }

  function collectContactRoleIds(contact) {
    var eng = global.miyaChatEngine;
    if (eng && typeof eng.collectContactRoleIds === 'function') {
      return eng.collectContactRoleIds(contact);
    }
    if (!contact) return [];
    return [contact.characterId, contact.chronicleId, contact.id]
      .map(function (x) { return String(x || '').trim(); })
      .filter(Boolean);
  }

  function listSortableWorldbookEntriesForContact(contact) {
    var eng = global.miyaChatEngine;
    if (eng && typeof eng.listSortableWorldbookEntriesForContact === 'function') {
      return eng.listSortableWorldbookEntriesForContact(contact);
    }
    return [];
  }

  function filterWorldbookEntryOrderForContact(contact, orderIds) {
    var eng = global.miyaChatEngine;
    if (eng && typeof eng.collectSortableWorldbookEntryIdsForContact === 'function') {
      var allowed = {};
      eng.collectSortableWorldbookEntryIdsForContact(contact).forEach(function (id) {
        allowed[id] = true;
      });
      return (Array.isArray(orderIds) ? orderIds : [])
        .map(function (x) { return String(x || '').trim(); })
        .filter(function (id) { return id && allowed[id]; });
    }
    return [];
  }

  function resolveWorldbookEntryOrder(contact, boundEntries) {
    var saved = filterWorldbookEntryOrderForContact(
      contact,
      contact && Array.isArray(contact.worldbookEntryOrder) ? contact.worldbookEntryOrder : []
    );
    var byId = {};
    (boundEntries || []).forEach(function (entry) {
      if (entry && entry.id) byId[String(entry.id)] = entry;
    });
    var ordered = [];
    var seen = {};
    saved.forEach(function (id) {
      id = String(id || '').trim();
      if (!id || seen[id] || !byId[id]) return;
      seen[id] = true;
      ordered.push(byId[id]);
    });
    (boundEntries || []).forEach(function (entry) {
      if (!entry || !entry.id || seen[entry.id]) return;
      ordered.push(entry);
    });
    return ordered;
  }

  function renderWorldbookSortListRows(rows) {
    return '<div class="mi-wb-sort-list" data-mq-set-wb-sort>' +
      (rows || []).map(function (entry, i) {
        return '<div class="mi-wb-sort-row" data-mq-set-wb-sort-id="' + esc(entry.id) + '">' +
          '<span class="mi-wb-sort-row__idx">' + esc(String(i + 1)) + '</span>' +
          '<strong class="mi-wb-sort-row__name">' + esc(entry.name || '未命名片段') + '</strong>' +
          '<div class="mi-wb-sort-row__btns">' +
            '<button type="button" class="mi-wb-sort-btn" data-mq-set-wb-sort-up aria-label="上移"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" class="mi-wb-sort-btn" data-mq-set-wb-sort-down aria-label="下移"' + (i === rows.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderWorldbookSortSection(contact) {
    var rows = resolveWorldbookEntryOrder(contact, listSortableWorldbookEntriesForContact(contact));
    var open = !!state.wbSortOpen;
    return formCard(
      '<div class="mi-wb-sort-panel' + (open ? ' is-open' : '') + '" data-mq-set-wb-sort-panel>' +
        '<button type="button" class="mi-wb-sort-toggle" data-mq-set-wb-sort-toggle aria-expanded="' + (open ? 'true' : 'false') + '">' +
          '<strong class="mi-wb-sort-toggle__title">世界书排序</strong>' +
          '<span class="mi-wb-sort-toggle__meta">' + esc(formatNum(rows.length)) + '</span>' +
          '<svg class="st-chevron mi-wb-sort-toggle__chev" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
        '</button>' +
        '<div class="mi-wb-sort-body"' + (open ? '' : ' hidden') + ' data-mq-set-wb-sort-body>' +
          renderWorldbookSortListRows(rows) +
        '</div>' +
      '</div>'
    );
  }

  function toggleWorldbookSortPanel() {
    if (!pageEl) return;
    var panel = pageEl.querySelector('[data-mq-set-wb-sort-panel]');
    var body = pageEl.querySelector('[data-mq-set-wb-sort-body]');
    var toggle = pageEl.querySelector('[data-mq-set-wb-sort-toggle]');
    if (!panel || !body) return;
    var nextOpen = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', nextOpen);
    body.hidden = !nextOpen;
    state.wbSortOpen = nextOpen;
    if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  }

  function readWorldbookEntryOrderFromRoot(root) {
    if (!root) return [];
    var list = root.querySelector('[data-mq-set-wb-sort]');
    if (!list) return [];
    var out = [];
    list.querySelectorAll('[data-mq-set-wb-sort-id]').forEach(function (row) {
      var id = String(row.getAttribute('data-mq-set-wb-sort-id') || '').trim();
      if (id) out.push(id);
    });
    return out;
  }

  function refreshWorldbookSortRowState(list) {
    if (!list) return;
    var rows = Array.prototype.slice.call(list.querySelectorAll('[data-mq-set-wb-sort-id]'));
    rows.forEach(function (row, i) {
      var idx = row.querySelector('.mi-wb-sort-row__idx');
      if (idx) idx.textContent = String(i + 1);
      var up = row.querySelector('[data-mq-set-wb-sort-up]');
      var down = row.querySelector('[data-mq-set-wb-sort-down]');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === rows.length - 1;
    });
  }

  function moveWorldbookSortRow(list, entryId, dir) {
    if (!list || !entryId) return;
    var rows = Array.prototype.slice.call(list.querySelectorAll('[data-mq-set-wb-sort-id]'));
    var idx = -1;
    rows.forEach(function (row, i) {
      if (row.getAttribute('data-mq-set-wb-sort-id') === entryId) idx = i;
    });
    if (idx < 0) return;
    var target = dir < 0 ? idx - 1 : idx + 1;
    if (target < 0 || target >= rows.length) return;
    if (dir < 0) list.insertBefore(rows[idx], rows[target]);
    else list.insertBefore(rows[target], rows[idx]);
    refreshWorldbookSortRowState(list);
  }

  function renderLifeLikeSection(settings) {
    var bg = (settings && settings.backgroundMessage) || {};
    return formCard(
      toggleRow('mq-set-lifelike', '让TA自己决定何时找你', '替代定时主动消息，由角色自行判断何时联系你', !!bg.lifeLikeEnabled)
    );
  }

  function renderImageGenBlock(settings) {
    var igGlobal = global.MiyaImageGen && global.MiyaImageGen.isGlobalEnabled && global.MiyaImageGen.isGlobalEnabled();
    var ig = settings.imageGen || {};
    var refNote = global.MiyaImageGen && global.MiyaImageGen.REF_LEGAL_NOTE
      ? global.MiyaImageGen.REF_LEGAL_NOTE
      : '参考图仅针对支持图片输入的模型生效。严禁上传无版权、无授权的图片信息；严禁未经他人允许上传他人肖像信息。';
    if (!igGlobal) {
      return formCard('<p class="st-form-hint">全局生图接口未启用或未配置，此处设置暂不可用。</p>');
    }
    return formCard(
      toggleRow('mq-set-ig-en', '为此联系人开启生图', '聊天与朋友圈中的文字图将生成真实图片', !!ig.enabled) +
      fieldBlock('专属生图提示词', '可留空', '<textarea class="ins-text-input ins-text-input--area" data-mq-set-ig-prompt rows="3" placeholder="例如：日系插画、柔和色调、角色外貌特征…">' + esc(ig.customPrompt || '') + '</textarea>') +
      mediaPickBlock('外观参考图', 'data-mq-set-ig-ref-preview', 'data-mq-set-ig-ref-pick', 'data-mq-set-ig-ref-reset', 'data-mq-set-ig-ref-url-input', 'data-mq-set-ig-ref-url-apply', refNote)
    );
  }

  function readLifeLikeBackground(prevBg, root) {
    prevBg = prevBg || {};
    var lifeLikeOn = isToggleOn(root, '#mq-set-lifelike');
    var bg = Object.assign({}, prevBg, { lifeLikeEnabled: lifeLikeOn });
    if (lifeLikeOn) {
      bg.activeEnabled = false;
      bg.offlineEnabled = false;
      if (!prevBg.lifeLikeEnabledAt) bg.lifeLikeEnabledAt = Date.now();
    } else if (prevBg.lifeLikeEnabled) {
      bg.lifeLikeNextPushAt = 0;
    }
    return bg;
  }

  function fieldBlock(label, sub, inner) {
    return '<label class="mi-set-field">' +
      '<span class="ins-field-label">' + esc(label) + '</span>' +
      (sub ? '<span class="st-form-hint mi-set-field__sub">' + esc(sub) + '</span>' : '') +
      '<div class="mi-set-field__box">' + inner + '</div>' +
    '</label>';
  }

  function mediaPickBlock(label, previewData, pickData, resetData, urlInputData, urlApplyData, sub) {
    return fieldBlock(label, sub || '',
      '<button type="button" class="mi-bg-pick" ' + pickData + '>' +
        '<div class="mi-bg-stage mi-bg-stage--sm" ' + previewData + '><span class="mi-bg-stage__placeholder">+</span></div>' +
      '</button>' +
      '<div class="mi-img-pick-tools">' +
        '<button type="button" class="st-foot-btn" ' + resetData + '>恢复默认</button>' +
        '<div class="ins-inline-field">' +
          '<input type="url" class="ins-text-input" ' + urlInputData + ' placeholder="图片链接" autocomplete="off">' +
          '<button type="button" class="ins-icon-btn" ' + urlApplyData + ' title="应用">✓</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderChatWallpaperLibrary(currentBf) {
    var picker = global.MiyaChatWallpaperPicker;
    if (!picker || !picker.renderLibrary) return '';
    return picker.renderLibrary(currentBf || {}, {
      libAttr: 'data-mq-set-wall-lib',
      manageAttr: 'data-mq-set-wall-manage'
    });
  }

  function escAttr(s) {
    return esc(s).replace(/[\r\n\u2028\u2029]/g, '');
  }

  function compactAvatarPickCol(label, previewData, pickData, resetData, urlInputData, urlApplyData) {
    return '<div class="mi-ava-row-compact__col">' +
      '<span class="mi-ava-row-compact__label">' + esc(label) + '</span>' +
      '<button type="button" class="mi-bg-pick mi-bg-pick--compact" ' + pickData + '>' +
        '<div class="mi-bg-stage mi-bg-stage--ava" ' + previewData + '><span class="mi-bg-stage__placeholder">+</span></div>' +
      '</button>' +
      '<div class="mi-ava-row-compact__tools">' +
        '<button type="button" class="st-foot-btn st-foot-btn--xs" ' + resetData + '>默认</button>' +
        '<div class="ins-inline-field ins-inline-field--compact">' +
          '<input type="url" class="ins-text-input" ' + urlInputData + ' placeholder="链接" autocomplete="off">' +
          '<button type="button" class="ins-icon-btn" ' + urlApplyData + ' title="应用">✓</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function profileIdForCtx(c) {
    if (!c) return '';
    return String(
      c.chat.profileId || c.contact.defaultProfileId || (c.profile && c.profile.id) || ''
    ).trim();
  }

  function invalidateDisplayAvatarCache(chatId) {
    var c = ctx();
    if (global.miyaChatApp && global.miyaChatApp.invalidateChatAvatarCache && c && c.contact) {
      global.miyaChatApp.invalidateChatAvatarCache(
        chatId,
        c.contact.id,
        profileIdForCtx(c)
      );
    }
  }

  function mergeDisplayAvatars(chatId, kind, patch) {
    var c = ctx();
    if (!c || !store) return Promise.resolve();
    if (kind === 'contact') {
      if (!c.contact || typeof store.mergeContactDisplayAvatar !== 'function') return Promise.resolve();
      return store.mergeContactDisplayAvatar(c.contact.id, patch).then(function (result) {
        invalidateDisplayAvatarCache(chatId);
        refreshOpenChatRoom();
        return result;
      });
    }
    var profileId = profileIdForCtx(c);
    if (!profileId || typeof store.mergeProfileDisplayAvatar !== 'function') return Promise.resolve();
    return store.mergeProfileDisplayAvatar(profileId, patch).then(function (result) {
      invalidateDisplayAvatarCache(chatId);
      refreshOpenChatRoom();
      return result;
    });
  }

  function resetDisplayAvatar(chatId, kind) {
    var c = ctx();
    if (!c || !store) return Promise.resolve();
    if (kind === 'contact') {
      if (!c.contact || typeof store.mergeContactDisplayAvatar !== 'function') return Promise.resolve();
      return store.mergeContactDisplayAvatar(c.contact.id, { reset: true }).then(function (result) {
        invalidateDisplayAvatarCache(chatId);
        refreshOpenChatRoom();
        return result;
      });
    }
    var profileId = profileIdForCtx(c);
    if (!profileId || typeof store.mergeProfileDisplayAvatar !== 'function') return Promise.resolve();
    return store.mergeProfileDisplayAvatar(profileId, { reset: true }).then(function (result) {
      invalidateDisplayAvatarCache(chatId);
      refreshOpenChatRoom();
      return result;
    });
  }

  function refreshOpenChatRoom() {
    if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === state.chatId) {
      global.miyaChatRoom.refresh({ forceAvatars: true });
    }
    if (global.miyaChatApp && global.miyaChatApp.refreshLists) {
      global.miyaChatApp.refreshLists({ force: true });
    }
    if (global.MiyaChatMoments && typeof global.MiyaChatMoments.refreshFeedUI === 'function') {
      global.MiyaChatMoments.refreshFeedUI();
    }
    if (global.miyaChatApp && typeof global.miyaChatApp.refreshProfileUI === 'function') {
      global.miyaChatApp.refreshProfileUI();
    }
  }

  function applyDisplayAvatarPreview(preview, url) {
    if (!preview) return;
    var ph = preview.querySelector('.mi-bg-stage__placeholder');
    if (url) {
      preview.style.backgroundImage = 'url("' + String(url).replace(/"/g, '') + '")';
      preview.classList.add('has-image');
      if (ph) ph.hidden = true;
    } else {
      preview.style.backgroundImage = '';
      preview.classList.remove('has-image');
      if (ph) ph.hidden = false;
    }
  }

  function hydrateDisplayAvatarPicker(root, kind, entity) {
    if (!root) return;
    var preview = root.querySelector('[data-mq-set-dava-' + kind + '-preview]');
    if (!preview) return;
    var da = (entity && entity.displayAvatar) || {};
    var url = String(da.url || '').trim();
    var blobId = da.blobId ? String(da.blobId) : '';
    applyDisplayAvatarPreview(preview, '');
    if (url) applyDisplayAvatarPreview(preview, url);
    else if (blobId) {
      store.getAvatarUrl(blobId).then(function (u) {
        if (u) applyDisplayAvatarPreview(preview, u);
      });
    }
  }

  function resolveHeroAvatarUrl(kind, c, da) {
    da = da || {};
    var url = kind === 'contact' ? da.contactUrl : da.profileUrl;
    var blobId = kind === 'contact' ? da.contactBlobId : da.profileBlobId;
    if (url) return Promise.resolve(url);
    if (blobId) return store.getAvatarUrl(blobId).catch(function () { return ''; });
    if (kind === 'contact' && c.contact) {
      if (c.contact.avatar) return Promise.resolve(c.contact.avatar);
      if (c.contact.avatarBlobId) return store.getAvatarUrl(c.contact.avatarBlobId).catch(function () { return ''; });
    }
    if (kind === 'profile' && c.profile) {
      if (c.profile.avatar) return Promise.resolve(c.profile.avatar);
      if (c.profile.avatarId) return store.getAvatarUrl(c.profile.avatarId).catch(function () { return ''; });
    }
    return Promise.resolve('');
  }

  function buildLangOptions(selected) {
    var want = String(selected || 'auto');
    return LANG_OPTS.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (o.v === want ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
  }

  var NARRATION_PERSON_OPTS = [
    { v: '1', label: '第一人称（我）' },
    { v: '2', label: '第二人称（你）' },
    { v: '3', label: '第三人称（他/她/名）' }
  ];

  function buildNarrationPersonOptions(selected, fallback) {
    var want = String(selected || fallback || '3').trim();
    if (['1', '2', '3'].indexOf(want) < 0) want = String(fallback || '3');
    return NARRATION_PERSON_OPTS.map(function (o) {
      return '<option value="' + esc(o.v) + '"' + (o.v === want ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
  }

  function formatNum(n) {
    return Number(n || 0).toLocaleString('zh-CN');
  }

  function resolveMomentsAutoDisplay(ma) {
    ma = ma || {};
    var mode = String(ma.mode || 'off').trim().toLowerCase();
    if (mode !== 'rounds' && mode !== 'hours') mode = 'off';
    return {
      mode: mode,
      rounds: mode === 'rounds' ? (parseInt(ma.roundInterval, 10) || '') : '',
      hours: mode === 'hours' ? (parseInt(ma.hourInterval, 10) || '') : ''
    };
  }

  function syncMomentsAutoModeUI(root) {
    if (!root) return;
    var mode = String((root.querySelector('[data-mq-set-moments-mode]') || {}).value || 'off').trim();
    var roundsWrap = root.querySelector('[data-mq-set-moments-rounds-wrap]');
    var hoursWrap = root.querySelector('[data-mq-set-moments-hours-wrap]');
    if (roundsWrap) roundsWrap.hidden = mode !== 'rounds';
    if (hoursWrap) hoursWrap.hidden = mode !== 'hours';
  }

  function ensureMomentsAutoIntervalDefaults(root, mode, prevMa) {
    if (!root || !mode || mode === 'off') return;
    prevMa = prevMa || {};
    if (mode === 'rounds') {
      var roundsIn = root.querySelector('[data-mq-set-moments-rounds]');
      if (!roundsIn || String(roundsIn.value || '').trim()) return;
      var prevRounds = parseInt(prevMa.roundInterval, 10);
      roundsIn.value = String(Number.isFinite(prevRounds) && prevRounds > 0 ? prevRounds : 30);
      return;
    }
    if (mode === 'hours') {
      var hoursIn = root.querySelector('[data-mq-set-moments-hours]');
      if (!hoursIn || String(hoursIn.value || '').trim()) return;
      var prevHours = parseInt(prevMa.hourInterval, 10);
      hoursIn.value = String(Number.isFinite(prevHours) && prevHours > 0 ? prevHours : 24);
    }
  }

  function readMomentsAutoFromRoot(root, prevMa) {
    prevMa = prevMa || {};
    var maModeSel = String((root.querySelector('[data-mq-set-moments-mode]') || {}).value || 'off').trim();
    var maRounds = parseInt(String((root.querySelector('[data-mq-set-moments-rounds]') || {}).value || '').trim(), 10);
    var maHours = parseInt(String((root.querySelector('[data-mq-set-moments-hours]') || {}).value || '').trim(), 10);
    var momentsAuto = {
      mode: 'off',
      roundInterval: 0,
      hourInterval: 0,
      roundAnchorEnd: prevMa.roundAnchorEnd || 0,
      enabledAt: prevMa.enabledAt || 0,
      lastMomentsAutoAt: prevMa.lastMomentsAutoAt || 0,
      lastMomentsAutoAttemptAt: prevMa.lastMomentsAutoAttemptAt || 0,
      lastFailedAt: prevMa.lastFailedAt || 0
    };
    if (maModeSel === 'rounds') {
      if (!Number.isFinite(maRounds) || maRounds <= 0) {
        maRounds = parseInt(prevMa.roundInterval, 10);
      }
      if (!Number.isFinite(maRounds) || maRounds <= 0) maRounds = 30;
      momentsAuto.mode = 'rounds';
      momentsAuto.roundInterval = Math.min(500, maRounds);
    } else if (maModeSel === 'hours') {
      if (!Number.isFinite(maHours) || maHours <= 0) {
        maHours = parseInt(prevMa.hourInterval, 10);
      }
      if (!Number.isFinite(maHours) || maHours <= 0) maHours = 24;
      momentsAuto.mode = 'hours';
      momentsAuto.hourInterval = Math.min(720, maHours);
    }
    var intervalChanged =
      String(prevMa.mode || 'off') !== momentsAuto.mode ||
      (momentsAuto.mode === 'rounds' && parseInt(prevMa.roundInterval, 10) !== momentsAuto.roundInterval) ||
      (momentsAuto.mode === 'hours' && parseInt(prevMa.hourInterval, 10) !== momentsAuto.hourInterval);
    if (momentsAuto.mode === 'off') {
      momentsAuto.enabledAt = 0;
      momentsAuto.roundAnchorEnd = 0;
      momentsAuto.lastMomentsAutoAt = 0;
      momentsAuto.lastMomentsAutoAttemptAt = 0;
      momentsAuto.lastFailedAt = 0;
    } else if (!prevMa.enabledAt || String(prevMa.mode || 'off') === 'off') {
      momentsAuto.enabledAt = Date.now();
    }
    if (intervalChanged) momentsAuto.roundAnchorEnd = 0;
    return momentsAuto;
  }

  function findLastSystemBlock(messages, prefixRe) {
    var found = '';
    (messages || []).forEach(function (m) {
      if (!m || m.role !== 'system') return;
      var t = String(m.content || '');
      if (prefixRe.test(t)) found = t;
    });
    return found;
  }

  function patchBreakdownRuleGroup(breakdown, key, block, eng) {
    if (!breakdown || !block) return;
    var chars = block.length;
    var tokens = eng && typeof eng.estimateTokensFromText === 'function'
      ? eng.estimateTokensFromText(block)
      : Math.max(0, Math.ceil(chars / 1.6));
    if (Array.isArray(breakdown.grouped)) {
      var hit = false;
      breakdown.grouped = breakdown.grouped.map(function (g) {
        if (g.key !== key) return g;
        hit = true;
        return Object.assign({}, g, { chars: chars, tokens: tokens });
      });
      if (!hit) {
        var labels = {
          operation_rules: '运转规则·必读（置首）',
          thinking_rules: '思维链·必读（置末）'
        };
        breakdown.grouped.push({
          key: key,
          label: labels[key] || key,
          chars: chars,
          tokens: tokens,
          count: 1,
          items: [{ key: key, label: labels[key] || key, chars: chars, tokens: tokens }]
        });
        breakdown.grouped.sort(function (a, b) {
          return (b.chars || 0) - (a.chars || 0);
        });
      }
    }
    if (Array.isArray(breakdown.sources)) {
      var srcHit = false;
      breakdown.sources = breakdown.sources.map(function (s) {
        if (s.key !== key) return s;
        srcHit = true;
        return Object.assign({}, s, { chars: chars, tokens: tokens });
      });
      if (!srcHit) {
        breakdown.sources.push({
          key: key,
          label: key,
          chars: chars,
          tokens: tokens
        });
      }
    }
  }

  function buildContextUsageSettings(chatId) {
    if (!store || !store.getChatSettings) return null;
    var settings = store.getChatSettings(chatId);
    if (!pageEl || !state.chatId || String(state.chatId) !== String(chatId)) {
      return settings;
    }
    var root = pageEl.querySelector('[data-mq-set-body]');
    if (!root) return settings;
    var merged = Object.assign({}, settings);
    var opMod = global.MiyaChatOperationRules;
    var thMod = global.MiyaChatThinkingRules;
    var hvMod = global.MiyaChatHeartVoiceTemplates;
    if (opMod && typeof opMod.readChatPresetFromRoot === 'function') {
      var opFromDom = opMod.readChatPresetFromRoot(root, settings.operationRulesPreset);
      merged.operationRulesPreset = opFromDom || String(settings.operationRulesPreset || '').trim();
    }
    if (thMod && typeof thMod.readChatPresetFromRoot === 'function') {
      var thFromDom = thMod.readChatPresetFromRoot(root, settings.thinkingRulesPreset);
      merged.thinkingRulesPreset = thFromDom || String(settings.thinkingRulesPreset || '').trim();
    }
    if (hvMod && typeof hvMod.readChatPresetFromRoot === 'function') {
      var hvFromDom = hvMod.readChatPresetFromRoot(root, settings.heartVoicePreset);
      merged.heartVoicePreset = hvFromDom || String(settings.heartVoicePreset || '').trim();
      if (merged.heartVoicePreset && typeof hvMod.findPreset === 'function' && typeof hvMod.buildSnapshotFromPreset === 'function') {
        var hvSnapRow = hvMod.findPreset(merged.heartVoicePreset);
        merged.heartVoicePresetSnapshot = hvSnapRow
          ? hvMod.buildSnapshotFromPreset(hvSnapRow)
          : settings.heartVoicePresetSnapshot || null;
      } else if (!merged.heartVoicePreset) {
        merged.heartVoicePresetSnapshot = null;
      }
    }
    return merged;
  }

  function forceSummaryBreakdownFromMessages(breakdown, messages, eng) {
    var chars = 0;
    var blockCount = 0;
    var preview = '';
    (messages || []).forEach(function (m) {
      if (!m || m.role !== 'system') return;
      var t = String(m.content || '');
      if (t.indexOf('【长期记忆·对话总结】') === 0 || t.indexOf('【本群·记忆总结】') === 0) {
        chars += t.length;
        blockCount += 1;
        if (!preview) preview = t.slice(0, 240);
      }
    });
    var tokens =
      eng && typeof eng.estimateTokensFromCharCount === 'function'
        ? eng.estimateTokensFromCharCount(chars)
        : Math.max(0, Math.ceil(chars / 1.6));
    if (breakdown && Array.isArray(breakdown.grouped)) {
      breakdown.grouped = breakdown.grouped.filter(function (g) {
        return g.key !== 'summary';
      });
      if (chars > 0) {
        breakdown.grouped.push({
          key: 'summary',
          label: '对话总结记忆',
          chars: chars,
          tokens: tokens,
          count: blockCount,
          items: [
            {
              key: 'summary',
              label: '对话总结记忆',
              chars: chars,
              tokens: tokens,
              preview: preview
            }
          ]
        });
        breakdown.grouped.sort(function (a, b) {
          return (b.chars || 0) - (a.chars || 0);
        });
      }
    }
    if (breakdown && Array.isArray(breakdown.sources)) {
      breakdown.sources = breakdown.sources.filter(function (s) {
        return s.key !== 'summary';
      });
      if (chars > 0) {
        breakdown.sources.push({
          key: 'summary',
          label: '对话总结记忆',
          chars: chars,
          tokens: tokens,
          preview: preview
        });
      }
    }
    return { chars: chars, tokens: tokens, blockCount: blockCount, preview: preview };
  }

  function collectContextUsage(chatId) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildApiMessages !== 'function') {
      return { error: 'engine_missing' };
    }
    var usageSettings = buildContextUsageSettings(chatId);
    var built = eng.buildApiMessages(chatId, '', {
      chatSettings: usageSettings || undefined
    });
    if (!built || built.error) {
      return { error: (built && built.error) || 'build_failed' };
    }
    var opPresetName = usageSettings && usageSettings.operationRulesPreset
      ? String(usageSettings.operationRulesPreset).trim()
      : '';
    var thPresetName = usageSettings && usageSettings.thinkingRulesPreset
      ? String(usageSettings.thinkingRulesPreset).trim()
      : '';
    var pm = built.promptMeta || {};
    var wb = built.worldbookMeta || {};
    var entries = Array.isArray(wb.matchedSummary) ? wb.matchedSummary : [];
    var wbStore = global.miyaWorldbookStore;
    var totalInStore = wbStore && typeof wbStore.listEntries === 'function'
      ? wbStore.listEntries().length
      : 0;
    var breakdown =
      typeof eng.buildPromptSourceBreakdown === 'function'
        ? eng.buildPromptSourceBreakdown(built.messages, wb)
        : null;
    var opMod = global.MiyaChatOperationRules;
    var thMod = global.MiyaChatThinkingRules;
    var opInjected = findLastSystemBlock(built.messages, /^【运转规则·(必读|自定义)】/);
    var thInjected = findLastSystemBlock(built.messages, /^【思维链·(必读|自定义)】/);
    var opInspect = opMod && typeof opMod.inspectForChat === 'function'
      ? opMod.inspectForChat(usageSettings, built.contact, built.profile)
      : null;
    var thResolved = thMod && typeof thMod.resolveForChat === 'function'
      ? thMod.resolveForChat(usageSettings, built.contact, built.profile)
      : null;
    var opBlock = opInjected || '';
    if (opInspect && opInspect.block) {
      if (!opBlock || (opPresetName && opInspect.block.length > opBlock.length)) {
        opBlock = opInspect.block;
      }
    }
    var thBlock = thInjected || thResolved || '';
    if (breakdown) {
      if (opBlock) patchBreakdownRuleGroup(breakdown, 'operation_rules', opBlock, eng);
      if (thBlock) patchBreakdownRuleGroup(breakdown, 'thinking_rules', thBlock, eng);
    }
    /* 对话总结记忆：只认实际注入的 system 块，禁止分类误伤导致虚高 */
    var summaryMeasured = forceSummaryBreakdownFromMessages(breakdown, built.messages, eng);
    var opRulesUsedDefault = !!opPresetName && (!opInspect || !opInspect.block);
    var opRulesInjectFallback = !!opPresetName && !!opInspect && !!opInspect.block &&
      opInjected && opInspect.block.length > opInjected.length + 32;
    var opRulesFailReason = opInspect && opInspect.reason ? opInspect.reason : '';
    var chat = store && store.findChat ? store.findChat(chatId) : null;
    var lastUsage = chat && chat.lastTokenUsage ? chat.lastTokenUsage : null;
    var activeThinking = chat && chat.activeThinking ? String(chat.activeThinking).trim() : '';
    var thinkingChars = activeThinking.length;
    var thinkingTokens =
      eng && typeof eng.estimateTokensFromText === 'function'
        ? eng.estimateTokensFromText(activeThinking)
        : Math.max(0, Math.ceil(thinkingChars / 1.6));
    var completionChars = lastUsage
      ? Number(lastUsage.completion_chars != null ? lastUsage.completion_chars : lastUsage.completion_tokens) || 0
      : 0;
    var completionTokens =
      eng && typeof eng.estimateTokensFromCharCount === 'function'
        ? eng.estimateTokensFromCharCount(completionChars)
        : Math.max(0, Math.ceil(completionChars / 1.6));
    var summaryInject = null;
    var sumMod = global.MiyaChatSummary;
    if (sumMod && typeof sumMod.inspectSummaryInjection === 'function') {
      summaryInject = sumMod.inspectSummaryInjection(usageSettings);
    }
    if (summaryInject && summaryMeasured) {
      summaryInject.actualInjectedChars = summaryMeasured.chars;
      summaryInject.actualInjectedTokens = summaryMeasured.tokens;
      summaryInject.actualBlockCount = summaryMeasured.blockCount;
      summaryInject.actualPreview = summaryMeasured.preview;
    }
    return {
      estimatedTokens: pm.estimated_prompt_tokens || (breakdown && breakdown.promptTokens) || 0,
      totalChars: pm.total_prompt_chars || (breakdown && breakdown.promptChars) || 0,
      systemChars: pm.system_chars || 0,
      historyChars: pm.history_chars || 0,
      worldbookChars: pm.worldbook_chars || 0,
      worldbookCount: pm.worldbook_matched || entries.length || 0,
      worldbookInSystem: pm.worldbook_in_system !== false,
      worldbookEmptyMatched: pm.worldbook_empty_matched || 0,
      entries: entries,
      totalInStore: totalInStore,
      roleIds: Array.isArray(wb.roleIds) ? wb.roleIds : [],
      breakdown: breakdown,
      summaryInject: summaryInject,
      operationRulesPreset: opPresetName,
      thinkingRulesPreset: thPresetName,
      operationRulesUsedDefault: opRulesUsedDefault,
      operationRulesInjectFallback: opRulesInjectFallback,
      operationRulesFailReason: opRulesFailReason,
      operationRulesLibraryCount: opInspect ? opInspect.libraryCount : 0,
      operationRulesItemCount: opInspect ? opInspect.itemCount : 0,
      lastTokenUsage: lastUsage,
      activeThinking: activeThinking,
      thinkingChars: thinkingChars,
      thinkingTokens: thinkingTokens,
      completionChars: completionChars,
      completionTokens: completionTokens,
      messageCount: pm.message_count || 0
    };
  }

  function ensureContextUsageDeps() {
    if (global.miyaBootstrapKvStores) {
      return global.miyaBootstrapKvStores();
    }
    var chain = Promise.resolve();
    var wb = global.miyaWorldbookStore;
    var cs = global.miyaContactsStore;
    if (wb && typeof wb.whenReady === 'function') {
      chain = chain.then(function () { return wb.whenReady(); });
    }
    if (cs && typeof cs.whenReady === 'function') {
      chain = chain.then(function () { return cs.whenReady(); });
    }
    if (global.MiyaChatOperationRules && global.MiyaChatOperationRules.ensureLoaded) {
      chain = chain.then(function () { return global.MiyaChatOperationRules.ensureLoaded(); });
    } else if (global.MiyaChatOperationRules && global.MiyaChatOperationRules.whenPresetsReady) {
      chain = chain.then(function () { return global.MiyaChatOperationRules.whenPresetsReady(); });
    }
    if (global.MiyaChatThinkingRules && global.MiyaChatThinkingRules.whenPresetsReady) {
      chain = chain.then(function () { return global.MiyaChatThinkingRules.whenPresetsReady(); });
    }
    return chain;
  }

  function contextUsageErrorText(code) {
    if (code === 'engine_missing') return '对话引擎未就绪';
    if (code === 'chat_not_found') return '会话不存在';
    if (code === 'contact_not_found') return '联系人不存在';
    if (code === 'profile_missing') return '请先选择面具';
    return '无法计算上下文用量';
  }

  function renderContextSourceRow(label, chars, tokens, sub) {
    return '<div class="mi-ctx-src-row">' +
      '<span class="mi-ctx-src-row__label">' + esc(label) +
        (sub ? '<span class="mi-ctx-src-row__sub">' + esc(sub) + '</span>' : '') +
      '</span>' +
      '<span class="mi-ctx-src-row__val">' +
        esc(formatNum(chars)) + ' 字' +
        '<span class="mi-ctx-src-row__tok">≈ ' + esc(formatNum(tokens)) + ' tok</span>' +
      '</span>' +
    '</div>';
  }

  function renderWorldbookEntryList(entries) {
    if (!entries || !entries.length) {
      return '<p class="mi-empty-hint mi-empty-hint--inline">当前无命中条目</p>';
    }
    return '<ul class="mi-ctx-wb__list">' +
      entries.map(function (e) {
        var tag = e.scope && e.scope !== 'global' ? ' · ' + e.scope : '';
        return '<li class="mi-ctx-wb__item">' +
          esc(e.name || '未命名') + tag +
          ' <span class="mi-ctx-wb__tag">' + esc(formatNum(e.charCount || 0)) + ' 字</span>' +
        '</li>';
      }).join('') +
    '</ul>';
  }

  function renderContextUsageDetailPop(snapshot, open) {
    var grouped = snapshot.breakdown && Array.isArray(snapshot.breakdown.grouped)
      ? snapshot.breakdown.grouped
      : [];
    var promptRows = grouped.map(function (g) {
      var sub = g.count > 1 ? '×' + g.count : '';
      if (g.key === 'operation_rules') {
        if (snapshot.operationRulesPreset) {
          sub = '预设：' + snapshot.operationRulesPreset;
          if (snapshot.operationRulesItemCount > 0) {
            sub += ' · ' + snapshot.operationRulesItemCount + ' 条';
          }
          if (snapshot.operationRulesUsedDefault) {
            if (snapshot.operationRulesFailReason === 'preset_not_found') {
              sub += ' · 预设库中未找到（库内 ' + (snapshot.operationRulesLibraryCount || 0) + ' 个）';
            } else if (snapshot.operationRulesFailReason === 'preset_empty') {
              sub += ' · 预设正文为空，请重新保存';
            } else {
              sub += ' · 内容未加载，已回退默认';
            }
          } else if (snapshot.operationRulesInjectFallback) {
            sub += ' · 已按预设正文校正统计';
          }
          if (g.count > 1) sub += ' · ×' + g.count;
        } else {
          sub = '默认规则' + (g.count > 1 ? ' · ×' + g.count : '');
        }
      } else if (g.key === 'thinking_rules') {
        sub = snapshot.thinkingRulesPreset
          ? '预设：' + snapshot.thinkingRulesPreset + (sub ? ' · ' + sub : '')
          : '默认思维链' + (sub ? ' · ' + sub : '');
      } else if (g.key === 'summary' && snapshot.summaryInject) {
        var si = snapshot.summaryInject;
        var actualChars = si.actualInjectedChars != null ? si.actualInjectedChars : si.contentChars;
        sub =
          '实际注入 ' +
          formatNum(actualChars || 0) +
          ' 字 · 合卷 ' +
          (si.megaInjected || 0) +
          '（' +
          formatNum(si.megaChars || 0) +
          '字）· 分镜 ' +
          (si.shotInjected || 0) +
          (si.shotSkipped ? '（跳过已并入 ' + si.shotSkipped + '）' : '');
      }
      return renderContextSourceRow(g.label, g.chars, g.tokens, sub);
    }).join('');

    var roundRows = '';
    if (snapshot.completionChars > 0) {
      roundRows += renderContextSourceRow(
        '上轮模型完整回复（API 返回原文）',
        snapshot.completionChars,
        snapshot.completionTokens,
        '含思维链/正文/心声标签'
      );
    }
    if (snapshot.thinkingChars > 0) {
      roundRows += renderContextSourceRow(
        '思维链',
        snapshot.thinkingChars,
        snapshot.thinkingTokens
      );
    }
    if (!roundRows) {
      roundRows = '<p class="mi-empty-hint mi-empty-hint--inline">尚无上一轮回复记录，发送一条消息后更新</p>';
    }

    var wbNote = snapshot.worldbookInSystem === false
      ? '<p class="mi-ctx-inject mi-ctx-inject--warn">世界书文本可能未完全写入系统提示，请检查绑定与关键词。</p>'
      : (snapshot.worldbookCount > 0
        ? '<p class="mi-ctx-inject mi-ctx-inject--ok">世界书已注入系统提示 · 命中 ' +
          esc(formatNum(snapshot.worldbookCount)) + ' / 库内 ' + esc(formatNum(snapshot.totalInStore)) + ' 条</p>'
        : '<p class="mi-ctx-inject">库内共 ' + esc(formatNum(snapshot.totalInStore)) + ' 条，当前上下文未命中世界书。</p>');

    return '<div class="mi-ctx-detail-pop' + (open ? ' is-open' : '') + '" data-mq-set-ctx-pop aria-hidden="' + (open ? 'false' : 'true') + '">' +
      '<div class="mi-ctx-detail-pop__sheet" role="region" aria-label="Token 来源明细">' +
        '<header class="mi-ctx-detail-pop__head">' +
          '<h3 class="mi-ctx-detail-pop__title">Token 来源明细</h3>' +
        '</header>' +
        '<div class="mi-ctx-detail-pop__body">' +
          '<section class="mi-ctx-detail__section">' +
            '<h4 class="mi-ctx-detail__heading">下次请求 · Prompt 注入（' + esc(formatNum(snapshot.messageCount || 0)) + ' 条 message）</h4>' +
            '<p class="mi-ctx-detail__hint">以下为当前设置下，下一条消息将发往 API 的上下文构成。字符数按实际 request body 统计；Token 为本地粗算（中文约 1.6 字/token，与 API 账单可能略有出入）。「对话总结记忆」只统计以【长期记忆·对话总结】开头的系统块：已并入合卷的分镜不应再出现。</p>' +
              (snapshot.summaryInject
              ? '<p class="mi-ctx-inject' +
                ((snapshot.summaryInject.actualInjectedChars || snapshot.summaryInject.contentChars || 0) > 5000
                  ? ' mi-ctx-inject--warn'
                  : snapshot.summaryInject.megaInjected > 0 && !snapshot.summaryInject.shotInjected
                    ? ' mi-ctx-inject--ok'
                    : '') +
                '">总结块实测：' +
                esc(formatNum(snapshot.summaryInject.actualInjectedChars != null
                  ? snapshot.summaryInject.actualInjectedChars
                  : snapshot.summaryInject.contentChars)) +
                ' 字 ≈ ' +
                esc(formatNum(snapshot.summaryInject.actualInjectedTokens != null
                  ? snapshot.summaryInject.actualInjectedTokens
                  : Math.ceil((snapshot.summaryInject.contentChars || 0) / 1.6))) +
                ' tok · 合卷 ' +
                esc(formatNum(snapshot.summaryInject.megaInjected)) +
                '（' +
                esc(formatNum(snapshot.summaryInject.megaChars || 0)) +
                '字）/ 分镜 ' +
                esc(formatNum(snapshot.summaryInject.shotInjected)) +
                '（跳过 ' +
                esc(formatNum(snapshot.summaryInject.shotSkipped)) +
                '）</p>'
              : '') +
            '<div class="mi-ctx-src-list">' + (promptRows || '<p class="mi-empty-hint mi-empty-hint--inline">无数据</p>') + '</div>' +
          '</section>' +
          '<section class="mi-ctx-detail__section">' +
            '<h4 class="mi-ctx-detail__heading">世界书命中条目</h4>' +
            wbNote +
            renderWorldbookEntryList(snapshot.entries) +
          '</section>' +
          '<section class="mi-ctx-detail__section">' +
            '<h4 class="mi-ctx-detail__heading">上一轮 · 模型回复消耗</h4>' +
            '<div class="mi-ctx-src-list">' + roundRows + '</div>' +
          '</section>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderContextUsageBody(snapshot, detailOpen) {
    if (!snapshot || snapshot.error) {
      return '<p class="mi-empty-hint">' + esc(contextUsageErrorText(snapshot && snapshot.error)) + '</p>';
    }
    var open = !!detailOpen;
    var injectNote = snapshot.worldbookCount > 0
      ? '世界书命中 ' + formatNum(snapshot.worldbookCount) + ' 条'
      : '世界书未命中';
    return '<div class="mi-ctx-panel" data-mq-set-ctx-panel>' +
      '<button type="button" class="mi-ctx-stats mi-ctx-stats--clickable" data-mq-set-ctx-toggle aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<div class="mi-ctx-stat mi-ctx-stat--main">' +
          '<span class="mi-ctx-stat__label">Prompt 注入</span>' +
          '<strong class="mi-ctx-stat__val">' + esc(formatNum(snapshot.totalChars)) + '<span class="mi-ctx-stat__unit"> 字</span></strong>' +
        '</div>' +
        '<p class="mi-ctx-stat__sub">≈ ' + esc(formatNum(snapshot.estimatedTokens)) + ' token · ' + esc(injectNote) + '</p>' +
        '<p class="mi-ctx-stat__note">' + (open ? '再次点击收起明细' : '点击查看 Token 来源分区') + '</p>' +
      '</button>' +
      renderContextUsageDetailPop(snapshot, open) +
    '</div>';
  }

  function isContextUsageDetailOpen() {
    if (!pageEl) return false;
    var pop = pageEl.querySelector('[data-mq-set-ctx-pop]');
    return !!(pop && pop.classList.contains('is-open'));
  }

  function refreshContextUsagePanel() {
    if (!pageEl || !state.chatId) return;
    var box = pageEl.querySelector('[data-mq-set-ctx-usage]');
    if (!box) return;
    var detailOpen = isContextUsageDetailOpen();
    box.innerHTML = '<p class="mi-empty-hint">正在计算…</p>';
    var chatId = state.chatId;
    ensureContextUsageDeps().then(function () {
      if (!state.chatId || String(state.chatId) !== String(chatId)) return;
      var opMod = global.MiyaChatOperationRules;
      var loadChain = opMod && typeof opMod.ensureLoaded === 'function'
        ? opMod.ensureLoaded()
        : Promise.resolve();
      return loadChain.then(function () {
        if (!state.chatId || String(state.chatId) !== String(chatId)) return;
        var snap = collectContextUsage(chatId);
        box.innerHTML = renderContextUsageBody(snap, detailOpen);
      });
    }).catch(function () {
      if (!pageEl || String(state.chatId) !== String(chatId)) return;
      box.innerHTML = '<p class="mi-empty-hint">世界书加载失败，请刷新后重试</p>';
    });
  }

  function scheduleContextUsageRefresh() {
    var gen = ++ctxUsageGen;
    var run = function () {
      if (gen !== ctxUsageGen) return;
      refreshContextUsagePanel();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 1600 });
    } else {
      setTimeout(run, 48);
    }
  }

  function toggleContextUsageDetail(forceClose) {
    if (!pageEl) return;
    var pop = pageEl.querySelector('[data-mq-set-ctx-pop]');
    var toggle = pageEl.querySelector('[data-mq-set-ctx-toggle]');
    if (!pop) return;
    var nextOpen = forceClose ? false : !pop.classList.contains('is-open');
    pop.classList.toggle('is-open', nextOpen);
    pop.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
    if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    var note = pageEl.querySelector('.mi-ctx-stat__note');
    if (note) {
      note.textContent = nextOpen ? '再次点击收起明细' : '点击查看 Token 来源分区';
    }
  }

  function countVisibleMessages(chatId) {
    if (!store || !chatId || !store.getRecentVisibleMessages) {
      return store && store.getMessages
        ? store.getMessages(chatId).length
        : 0;
    }
    return store.getRecentVisibleMessages(chatId, 1).total || 0;
  }

  function searchMessageHits(chatId, query) {
    if (!store || !chatId || !query) return [];
    var meta = store.getMeta ? store.getMeta() : null;
    var arr = meta && meta.messagesByChat && meta.messagesByChat[chatId];
    if (!Array.isArray(arr)) return [];
    var q = String(query).toLowerCase();
    var hits = [];
    var i;
    for (i = arr.length - 1; i >= 0; i--) {
      var m = arr[i];
      if (!m || m.deleted || m.offlineMeet) continue;
      if (String(m.content || '').toLowerCase().indexOf(q) < 0) continue;
      hits.push(m);
      if (hits.length >= 60) break;
    }
    hits.reverse();
    return hits;
  }

  function renderSearchHits(c) {
    var q = state.searchQuery.trim().toLowerCase();
    if (!q) return '<p class="mi-empty-hint">输入关键词查找历史消息</p>';
    var hits = searchMessageHits(state.chatId, q);
    if (!hits.length) return '<p class="mi-empty-hint">没有找到相关记录</p>';
    return hits.map(function (m) {
      return '<article class="mi-hit">' +
        '<span class="mi-hit__tag">' + (m.role === 'user' ? '我' : 'Ta') + '</span>' +
        '<p>' + esc(String(m.content || '').slice(0, 180)) + '</p>' +
      '</article>';
    }).join('');
  }

  function renderPage() {
    var c = ctx();
    if (!c || !c.contact) return '<div class="mi-empty-hint">会话不存在</div>';

    var s = c.settings;
    var contact = c.contact;
    var wa = s.weatherAwareness || {};
    var name = contact.remarkName || contact.name || '未命名';
    var msgCount = countVisibleMessages(state.chatId);

    var maskOpts = c.profiles.map(function (p) {
      var sel = (c.chat.profileId || contact.defaultProfileId || '') === p.id;
      return '<option value="' + esc(p.id) + '"' + (sel ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');

    var roleWallet = store.getContactWallet ? store.getContactWallet(contact.id) : { balance: 0 };
    var roleBalFmt = global.MiyaChatWallet && global.MiyaChatWallet.formatDisplay
      ? global.MiyaChatWallet.formatDisplay(roleWallet.balance)
      : ('¥' + (Number(roleWallet.balance) || 0));
    var dynAv = s.dynamicAvatar || {};

    return '<div class="st-container mi-set-flow">' +
      '<div class="st-deco-ornament" style="top: 80px; right: -20px;">§</div>' +
      '<div class="st-deco-ornament" style="bottom: 280px; left: -40px; font-size: 100px;">¶</div>' +

      '<header class="mi-set-title-bar">' +
        '<h1 class="mi-set-title-bar__name">' + esc(name) + '</h1>' +
        '<p class="mi-set-title-bar__meta">' + formatNum(msgCount) + ' 条消息</p>' +
      '</header>' +

      renderZone('basic', '基础', '身份、头像、通知与主动消息',
        subBlock('身份与显示', '', formCard(
          fieldBlock('用哪张面具', '和 Ta 聊天时你是谁', '<select class="ins-select" data-mq-set-mask>' + maskOpts + '</select>') +
          fieldBlock('备注名', '列表和顶栏显示的名字', '<input type="text" class="ins-text-input" data-mq-set-remark value="' + esc(contact.remarkName || '') + '" placeholder="' + esc(contact.name) + '">') +
          fieldBlock('关系', '会写进对话上下文', '<input type="text" class="ins-text-input" data-mq-set-rel value="' + esc(s.relationship || contact.relationship || '') + '" placeholder="朋友 / 恋人 / …">')
        )) +
        subBlock('聊天头像', '全局生效：单聊、群聊、通知；档案头像不受影响', formCard(
          '<div class="mi-ava-row-compact">' +
            compactAvatarPickCol('Ta',
              'data-mq-set-dava-contact-preview',
              'data-mq-set-dava-contact-pick',
              'data-mq-set-dava-contact-reset',
              'data-mq-set-dava-contact-url-input',
              'data-mq-set-dava-contact-url-apply') +
            compactAvatarPickCol('我',
              'data-mq-set-dava-profile-preview',
              'data-mq-set-dava-profile-pick',
              'data-mq-set-dava-profile-reset',
              'data-mq-set-dava-profile-url-input',
              'data-mq-set-dava-profile-url-apply') +
          '</div>' +
          toggleRow('mq-set-dava-char', 'Ta 可自主换头像', '喜欢你的照片时可换成聊天头像；Ta 知道自己当前头像内容', !!dynAv.charEnabled) +
          toggleRow('mq-set-dava-user', 'Ta 可给你换头像', '可换成你相册里已同步的照片，仅聊天窗口', !!dynAv.userEnabled)
        )) +
        subBlock('通知', '仅影响弹窗提醒', formCard(
          toggleRow(
            'mq-set-mute-notify',
            '消息免打扰',
            '开启后将不会收到该角色的消息弹窗通知，但不影响发消息与对话响应',
            !!s.muteNotifications
          )
        )) +
        subBlock('主动消息', '由角色自行判断何时联系你', renderLifeLikeSection(s))
      ) +

      renderZone('look', '外观与背景', '壁纸、CSS 主题与预设',
        subBlock('聊天背景', '', formCard(
          mediaPickBlock('聊天背景',
            'data-mq-set-bg-preview',
            'data-mq-set-bg-pick',
            'data-mq-set-bg-reset',
            'data-mq-set-bg-url-input',
            'data-mq-set-bg-url-apply') +
          renderChatWallpaperLibrary(c.settings.chatBeautify || {})
        )) +
        subBlock('聊天样式', 'CSS 主题与预设', formCard(
          (global.MiyaChatBeautify ? global.MiyaChatBeautify.buildChatSettingsBeautifyHtml(s.chatBeautify) : '')
        , 'mi-set-bf-card'))
      ) +

      renderZone('dialogue', '对话表现', '回复条数、翻译、语音、旁白与心声模版',
        subBlock('回复与翻译', '', formCard(
          fieldBlock('消息渲染条数', '进入聊天时加载最近多少条，数值越大越慢', '<input type="number" class="ins-text-input" data-mq-set-render-limit min="20" max="500" value="' + esc(s.messageRenderLimit || 100) + '">') +
          fieldBlock('角色回复条数', '', '<div class="mi-inline-nums">' +
            '<input type="number" class="ins-text-input mi-input--xs" data-mq-set-bubble-min min="1" max="15" value="' + esc(s.roleReplyBubbleMin || 1) + '">' +
            '<span class="mi-inline-nums__sep">~</span>' +
            '<input type="number" class="ins-text-input mi-input--xs" data-mq-set-bubble-max min="1" max="15" value="' + esc(s.roleReplyBubbleMax || 5) + '">' +
          '</div>') +
          (function () {
            var transOn = !!s.autoTranslate;
            return toggleRow(
              'mq-set-trans',
              '自动翻译',
              '同一轮随 API 输出意译译文',
              transOn
            ) +
            '<div class="mi-trans-extra"' + (transOn ? '' : ' hidden') + ' data-mq-set-trans-extra">' +
            fieldBlock('译文语言', '支持普通话、粤语、繁体、吴语等', '<select class="ins-select" data-mq-set-trans-target>' +
              (global.MiyaChatTranslate && global.MiyaChatTranslate.buildTargetOptionsHtml
                ? global.MiyaChatTranslate.buildTargetOptionsHtml(s.translateTarget)
                : '<option value="zh-CN" selected>中文（普通话）</option>') +
            '</select>') +
            toggleRow('mq-set-moments-trans', '朋友圈翻译', '角色发朋友圈时附带意译译文', !!s.momentsTranslate) +
            '</div>';
          })() +
          toggleRow('mq-set-tts-en', '语音朗读', 'MiniMax TTS', !!String(s.minimaxVoiceId || '').trim()) +
          fieldBlock('音色 ID', '', '<input type="text" class="ins-text-input" data-mq-set-voice-id value="' + esc(s.minimaxVoiceId || '') + '">') +
          fieldBlock('语言', '', '<select class="ins-select" data-mq-set-lang>' + buildLangOptions(s.minimaxLanguageBoost) + '</select>')
        )) +
        subBlock('线上旁白', '与回复条数无关', formCard(
          toggleRow('mq-set-online-narration', '启用线上旁白', '角色回复中穿插旁白-…动作/神态描写，以居中灰字展示', !!s.onlineNarrationEnabled) +
          toggleRow('mq-set-online-narration-ctx', '旁白注入上下文', '角色旁白是否写入模型上下文；用户旁白始终注入', s.onlineNarrationInjectContext !== false) +
          fieldBlock('称呼角色人称', '旁白里如何称呼 char', '<select class="ins-select" data-mq-set-narration-char-person>' +
            buildNarrationPersonOptions(s.onlineNarrationCharPerson, '3') +
          '</select>') +
          fieldBlock('称呼用户人称', '旁白里如何称呼 user', '<select class="ins-select" data-mq-set-narration-user-person>' +
            buildNarrationPersonOptions(s.onlineNarrationUserPerson, '2') +
          '</select>')
        )) +
        subBlock('心声模版', '在「装扮与表情 → 自定义心声」里先保存预设，再在此选用', formCard(
          (global.MiyaChatHeartVoiceTemplates
            ? global.MiyaChatHeartVoiceTemplates.buildChatSettingsPickerHtml(s.heartVoicePreset)
            : '<p class="st-form-hint">心声模版模块未加载，请刷新页面</p>')
        ))
      ) +

      renderZone('sense', '感知与绑定', '天气、表情包与世界书',
        subBlock('天气', '虚拟地点映射现实天气', formCard(
          toggleRow('mq-set-weather-en', '天气感知', '按映射地点查询真实天气', !!wa.enabled) +
          fieldBlock('我的虚拟地点', '故事里的位置', '<input type="text" class="ins-text-input" data-mq-set-vplace-user value="' + esc(wa.placeUser || '') + '" placeholder="如：云城">') +
          fieldBlock('映射现实地点', '用来查天气', '<input type="text" class="ins-text-input" data-mq-set-rloc-user value="' + esc(wa.realLocUser || '') + '" placeholder="如：上海">') +
          fieldBlock('Ta 的虚拟地点', '故事里的位置', '<input type="text" class="ins-text-input" data-mq-set-vplace-role value="' + esc(wa.placeRole || '') + '" placeholder="如：旧都">') +
          fieldBlock('映射现实地点', '用来查天气', '<input type="text" class="ins-text-input" data-mq-set-rloc-role value="' + esc(wa.realLocRole || '') + '" placeholder="如：东京">') +
          (wa.weatherTextUser ? '<p class="mi-pill-note">我这边 · ' + esc(wa.weatherTextUser) + '</p>' : '') +
          (wa.weatherTextRole ? '<p class="mi-pill-note">Ta 那边 · ' + esc(wa.weatherTextRole) + '</p>' : '') +
          '<p class="st-form-hint">天气 App 与这里是两套数据。点「同步天气 App」会填入 App 里的位置并自动感知拉取天气；仍可手改后再点「感知」刷新。</p>' +
          '<div class="mi-btn-row">' +
            '<button type="button" class="st-action-btn" data-mq-set-weather-sync-app>同步天气 App</button>' +
            '<button type="button" class="st-action-btn st-action-btn--primary" data-mq-set-weather-sense>感知</button>' +
          '</div>'
        )) +
        subBlock('表情包', '绑定后该角色在对话中可发', formCard(
          '<p class="st-form-hint">打开「使用全部分组」，或关闭后在下方为角色指定可用分组</p>' +
          (function () {
            var bound = Array.isArray(contact.emojiGroupIds) ? contact.emojiGroupIds : [];
            var useAllEmo = !bound.length;
            var hasCustom = bound.length > 0;
            return toggleRow('mq-set-emo-all', '使用全部分组', '开启后该角色可使用所有表情分组', useAllEmo) +
              '<div class="mi-emo-bind-list" data-mq-set-emo-list>' +
              store.getEmojiGroups().map(function (g) {
                var on = hasCustom && bound.indexOf(g.id) >= 0;
                return emoGroupToggleRow(g.id, g.name, on, !hasCustom);
              }).join('') +
              '</div>';
          })()
        )) +
        subBlock('', '', renderWorldbookSortSection(contact))
      ) +

      renderZone('content', '朋友圈与生图', '自动发动态与文字配图',
        subBlock('朋友圈', '', formCard(
          fieldBlock(
            '自动发动态',
            '二选一：按对话轮数，或距上次发朋友圈的小时数',
            '<select class="ins-select" data-mq-set-moments-mode>' +
              (function () {
                var md = resolveMomentsAutoDisplay(s.momentsAuto);
                return '<option value="off"' + (md.mode === 'off' ? ' selected' : '') + '>关闭</option>' +
                  '<option value="rounds"' + (md.mode === 'rounds' ? ' selected' : '') + '>每 N 轮对话</option>' +
                  '<option value="hours"' + (md.mode === 'hours' ? ' selected' : '') + '>每 N 小时</option>';
              })() +
            '</select>' +
            '<div class="mi-moments-auto-fields">' +
              (function () {
                var md = resolveMomentsAutoDisplay(s.momentsAuto);
                return '<div class="mi-inline-nums" data-mq-set-moments-rounds-wrap' + (md.mode !== 'rounds' ? ' hidden' : '') + '>' +
                    '每 <input type="number" class="ins-text-input mi-input--xs" data-mq-set-moments-rounds min="1" max="500" placeholder="轮数" value="' + esc(md.rounds) + '"> 轮对话自动发一次' +
                  '</div>' +
                  '<div class="mi-inline-nums" data-mq-set-moments-hours-wrap' + (md.mode !== 'hours' ? ' hidden' : '') + '>' +
                    '每 <input type="number" class="ins-text-input mi-input--xs" data-mq-set-moments-hours min="1" max="720" placeholder="小时" value="' + esc(md.hours) + '"> 小时自动发一次' +
                  '</div>';
              })() +
            '</div>'
          )
        )) +
        subBlock('生图', (global.MiyaImageGen && global.MiyaImageGen.isGlobalEnabled && global.MiyaImageGen.isGlobalEnabled())
          ? '角色文字图将调用生图 API'
          : '请先在设置中启用生图 API', renderImageGenBlock(s))
      ) +

      renderZone('model', '模型高级', '运转规则、思维链与 Token 用量',
        subBlock('线上运转规则', '', formCard(
          (global.MiyaChatOperationRules
            ? global.MiyaChatOperationRules.buildChatSettingsPickerHtml(s.operationRulesPreset)
            : '<p class="st-form-hint">运转规则模块未加载</p>')
        )) +
        subBlock('线上思维链', '', formCard(
          (global.MiyaChatThinkingRules
            ? global.MiyaChatThinkingRules.buildChatSettingsPickerHtml(s.thinkingRulesPreset)
            : '<p class="st-form-hint">思维链模块未加载</p>')
        )) +
        subBlock('上下文用量', '点按卡片查看 Token 分区来源', formCard(
          '<div class="mi-ctx-usage" data-mq-set-ctx-usage><p class="mi-empty-hint">正在计算…</p></div>'
        ))
      ) +

      renderZone('wallet', '钱包', '角色独立余额 · ' + esc(roleBalFmt),
        formCard(
          '<article class="mi-wcard mi-wcard--compact mi-wcard--static">' +
            '<span class="mi-wcard__grain" aria-hidden="true"></span>' +
            '<span class="mi-wcard__shine" aria-hidden="true"></span>' +
            '<span class="mi-wcard__chip" aria-hidden="true"></span>' +
            '<div class="mi-wcard__head">' +
              '<span class="mi-wcard__brand">MIYA WALLET</span>' +
            '</div>' +
            '<div class="mi-wcard__body">' +
              '<span class="mi-wcard__label">' + esc(name) + ' 的钱包</span>' +
              '<p class="mi-wcard__amount"><em>¥</em>' + esc(roleBalFmt.replace(/^¥/, '')) + '</p>' +
            '</div>' +
            '<div class="mi-wcard__foot">' +
              '<span class="mi-wcard__holder">' + esc(name) + '</span>' +
              '<span class="mi-wcard__badge">ROLE</span>' +
            '</div>' +
          '</article>' +
          '<div class="mi-wallet-note">' +
            '<span class="mi-wallet-note__icon" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="16" cy="14" r="1" fill="currentColor"/></svg>' +
            '</span>' +
            '<p>角色向你转账时从此扣款；你向角色转账且对方收款后入账此处。</p>' +
          '</div>' +
          '<div class="mi-btn-row">' +
            '<button type="button" class="st-action-btn" data-mq-set-contact-wallet-adjust>调整 Ta 的余额</button>' +
          '</div>'
        )
      ) +

      renderZone('data', '数据管理', '聊天记录、导入导出与删除',
        subBlock('聊天记录', '共 ' + msgCount + ' 条', formCard(
          '<div class="st-card st-set-search-card">' +
            '<input type="search" class="ins-text-input mi-set-search" data-mq-set-search placeholder="搜消息内容…" value="' + esc(state.searchQuery) + '" autocomplete="off" spellcheck="false">' +
          '</div>' +
          '<div class="mi-hits" data-mq-set-hits>' + renderSearchHits(c) + '</div>' +
          '<div class="st-card mi-set-action-card">' +
            '<button type="button" class="st-card-row" data-mq-set-export>' +
              '<div class="st-card-row-left"><div><div class="st-card-label">导出 JSON</div></div></div>' +
              '<svg class="st-chevron" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
            '</button>' +
            '<button type="button" class="st-card-row" data-mq-set-import>' +
              '<div class="st-card-row-left"><div><div class="st-card-label">导入 JSON</div></div></div>' +
              '<svg class="st-chevron" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
            '</button>' +
            '<button type="button" class="st-card-row mi-set-action-row--warn" data-mq-set-clear>' +
              '<div class="st-card-row-left"><div><div class="st-card-label">清空全部消息</div></div></div>' +
              '<svg class="st-chevron" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>' +
            '</button>' +
          '</div>' +
          '<input type="file" accept="application/json,.json" hidden data-mq-set-import-file>'
        )) +
        subBlock('移除联系人', '删除后无法恢复', formCard(
          '<p class="mi-danger-text">删除后联系人、会话、消息全部消失，无法恢复。</p>' +
          '<button type="button" class="st-action-btn st-action-btn--danger" data-mq-set-delete-contact>删除这个联系人</button>'
        , 'mi-set-danger-card'))
      ) +

      '<footer class="st-footer">' +
        '<div class="st-footer-brand">Chat Preferences</div>' +
        '<div class="st-footer-version">miya 小手机 · 2026</div>' +
      '</footer>' +
    '</div>';
  }

  function ensurePage() {
    if (pageEl) return pageEl;
    var app = $('miya-chat-app');
    pageEl = document.createElement('div');
    pageEl.className = 'mi-set-page';
    pageEl.id = 'mq-set-page';
    pageEl.hidden = true;
    pageEl.setAttribute('aria-hidden', 'true');
    pageEl.innerHTML =
      '<div class="st-ambient-bg" aria-hidden="true"></div>' +
      '<header class="st-navbar mi-set-navbar">' +
        '<button type="button" class="st-navback" data-mq-set-back aria-label="返回">' +
          '<svg width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden="true"><path d="M9 1L1 9l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '<span>返回</span>' +
        '</button>' +
        '<h1 class="st-navtitle">聊天设置</h1>' +
        '<button type="button" class="mi-set-navsave" data-mq-set-save>保存</button>' +
      '</header>' +
      '<div class="st-scroll mi-set-body" data-mq-set-body></div>' +
      '<div class="mi-toast"></div>';
    if (app) app.appendChild(pageEl);
    else document.body.appendChild(pageEl);
    bindPageEvents();
    return pageEl;
  }

  function isToggleOn(root, sel) {
    var el = root.querySelector(sel);
    return el ? el.classList.contains('is-on') : false;
  }

  function readWeatherFromRoot(root, baseWa) {
    return Object.assign({}, baseWa || {}, {
      enabled: isToggleOn(root, '#mq-set-weather-en'),
      placeUser: String((root.querySelector('[data-mq-set-vplace-user]') || {}).value || '').trim(),
      placeRole: String((root.querySelector('[data-mq-set-vplace-role]') || {}).value || '').trim(),
      realLocUser: String((root.querySelector('[data-mq-set-rloc-user]') || {}).value || '').trim(),
      realLocRole: String((root.querySelector('[data-mq-set-rloc-role]') || {}).value || '').trim(),
      settingsUiVersion: 2
    });
  }

  function runWeatherSense() {
    if (!pageEl || !state.chatId || !store) return;
    var root = pageEl.querySelector('[data-mq-set-body]');
    var c = ctx();
    if (!root || !c) return;
    var wa = readWeatherFromRoot(root, c.settings.weatherAwareness);
    if (!wa.enabled) {
      toast('请先开启天气感知');
      return;
    }
    var aw = global.MiyaChatAwareness;
    if (!aw || typeof aw.refreshWeatherForSettings !== 'function') {
      toast('感知模块未就绪');
      return;
    }
    toast('正在感知…');
    var settings = Object.assign({}, c.settings, { weatherAwareness: wa });
    aw.refreshWeatherForSettings(settings).then(function (refreshed) {
      if (refreshed && refreshed.weatherAwareness) {
        return store.saveChatSettings(state.chatId, { weatherAwareness: refreshed.weatherAwareness });
      }
      return store.saveChatSettings(state.chatId, { weatherAwareness: wa });
    }).then(function () {
      toast('天气已更新');
      render();
    }).catch(function () {
      toast('感知失败');
    });
  }

  function syncWeatherAppIntoForm() {
    if (!pageEl || !state.chatId || !store) return;
    var root = pageEl.querySelector('[data-mq-set-body]');
    var c = ctx();
    if (!root || !c || !c.contact) return;
    var br = global.miyaWeatherBridge;
    var wst = global.miyaWeatherStore;
    if (!br || !wst) {
      toast('天气模块未就绪');
      return;
    }
    var me = wst.getMyLocation();
    var roleCity = wst.findCityByContact(c.contact.id);
    if ((!me || !me.name) && !roleCity) {
      toast('天气 App 里还没有「我的位置」或该角色城市');
      return;
    }
    toast('正在同步并感知…');
    br.syncAppToChatWeatherAwareness(state.chatId, c.contact.id)
      .then(function (wa) {
        var next = Object.assign({}, wa || {}, { enabled: true, settingsUiVersion: 2 });
        var uPlace = root.querySelector('[data-mq-set-vplace-user]');
        var uReal = root.querySelector('[data-mq-set-rloc-user]');
        var rPlace = root.querySelector('[data-mq-set-vplace-role]');
        var rReal = root.querySelector('[data-mq-set-rloc-role]');
        if (uReal && next.realLocUser) uReal.value = next.realLocUser;
        if (uPlace && next.placeUser) uPlace.value = next.placeUser;
        if (rReal && next.realLocRole) rReal.value = next.realLocRole;
        if (rPlace && next.placeRole) rPlace.value = next.placeRole;

        var enToggle = root.querySelector('#mq-set-weather-en');
        if (enToggle) {
          enToggle.classList.add('is-on');
          enToggle.setAttribute('aria-checked', 'true');
        }

        var aw = global.MiyaChatAwareness;
        if (!aw || typeof aw.refreshWeatherForSettings !== 'function') {
          return store.saveChatSettings(state.chatId, { weatherAwareness: next }).then(function () {
            toast('已同步地点；感知模块未就绪，请稍后点「感知」');
            render();
          });
        }
        var settings = Object.assign({}, c.settings, { weatherAwareness: next });
        return aw.refreshWeatherForSettings(settings).then(function (refreshed) {
          var saved = (refreshed && refreshed.weatherAwareness) || next;
          return store.saveChatSettings(state.chatId, { weatherAwareness: saved }).then(function () {
            var parts = [];
            if (saved.realLocUser) parts.push('我→' + saved.realLocUser);
            if (saved.realLocRole) parts.push('Ta→' + saved.realLocRole);
            toast(parts.length ? '已同步并感知：' + parts.join('，') : '已同步并感知天气');
            render();
          });
        });
      })
      .catch(function (err) {
        toast((err && err.message) || '同步失败');
      });
  }

  function readForm(root) {
    var c = ctx();
    if (!c) return {};
    var s = c.settings;
    var chatBg = (c.chat.chatSettings && c.chat.chatSettings.backgroundMessage) || {};
    var wa = readWeatherFromRoot(root, s.weatherAwareness);
    var ttsOn = isToggleOn(root, '#mq-set-tts-en');
    var bfMod = global.MiyaChatBeautify;
    var chatBeautify = bfMod
      ? bfMod.readChatBeautifyFromRoot(root, s.chatBeautify)
      : Object.assign({}, s.chatBeautify || {});
    var opMod = global.MiyaChatOperationRules;
    var operationRulesPreset = opMod
      ? opMod.readChatPresetFromRoot(root, s.operationRulesPreset)
      : String(s.operationRulesPreset || '').trim();
    var thMod = global.MiyaChatThinkingRules;
    var thinkingRulesPreset = thMod
      ? thMod.readChatPresetFromRoot(root, s.thinkingRulesPreset)
      : String(s.thinkingRulesPreset || '').trim();
    var hvMod = global.MiyaChatHeartVoiceTemplates;
    var heartVoicePreset = hvMod
      ? hvMod.readChatPresetFromRoot(root, s.heartVoicePreset)
      : String(s.heartVoicePreset || '').trim();
    var heartVoicePresetSnapshot = null;
    if (heartVoicePreset && hvMod) {
      if (typeof hvMod.findPreset === 'function') {
        var hvRow = hvMod.findPreset(heartVoicePreset);
        if (hvRow && typeof hvMod.buildSnapshotFromPreset === 'function') {
          heartVoicePresetSnapshot = hvMod.buildSnapshotFromPreset(hvRow);
        }
      }
      if (
        !heartVoicePresetSnapshot &&
        s.heartVoicePresetSnapshot &&
        String((s.heartVoicePresetSnapshot.name || s.heartVoicePreset) || '').trim() === heartVoicePreset &&
        typeof hvMod.buildSnapshotFromPreset === 'function'
      ) {
        heartVoicePresetSnapshot = hvMod.buildSnapshotFromPreset(s.heartVoicePresetSnapshot);
      }
    }
    var prevMa = s.momentsAuto || {};
    var momentsAuto = readMomentsAutoFromRoot(root, prevMa);
    var patch = {
      remarkName: (root.querySelector('[data-mq-set-remark]') || {}).value || '',
      relationship: (root.querySelector('[data-mq-set-rel]') || {}).value || '',
      weatherAwareness: wa,
      replyBannerEnabled: s.replyBannerEnabled !== false,
      muteNotifications: isToggleOn(root, '#mq-set-mute-notify'),
      onlineNarrationEnabled: isToggleOn(root, '#mq-set-online-narration'),
      onlineNarrationInjectContext: isToggleOn(root, '#mq-set-online-narration-ctx'),
      onlineNarrationCharPerson: String((root.querySelector('[data-mq-set-narration-char-person]') || {}).value || '3').trim() || '3',
      onlineNarrationUserPerson: String((root.querySelector('[data-mq-set-narration-user-person]') || {}).value || '2').trim() || '2',
      autoTranslate: isToggleOn(root, '#mq-set-trans'),
      translateMode: 'semantic',
      translateTarget: String((root.querySelector('[data-mq-set-trans-target]') || {}).value || 'zh-CN').trim(),
      momentsTranslate: isToggleOn(root, '#mq-set-moments-trans'),
      roleReplyBubbleMin: parseInt((root.querySelector('[data-mq-set-bubble-min]') || {}).value, 10) || 1,
      roleReplyBubbleMax: parseInt((root.querySelector('[data-mq-set-bubble-max]') || {}).value, 10) || 5,
      messageRenderLimit: parseInt((root.querySelector('[data-mq-set-render-limit]') || {}).value, 10) || 100,
      minimaxVoiceId: String((root.querySelector('[data-mq-set-voice-id]') || {}).value || '').trim(),
      minimaxLanguageBoost: (root.querySelector('[data-mq-set-lang]') || {}).value || 'auto',
      chatBeautify: chatBeautify,
      operationRulesPreset: operationRulesPreset,
      thinkingRulesPreset: thinkingRulesPreset,
      heartVoicePreset: heartVoicePreset,
      heartVoicePresetSnapshot: heartVoicePresetSnapshot,
      momentsAuto: momentsAuto,
      backgroundMessage: readLifeLikeBackground(chatBg, root)
    };
    patch.dynamicAvatar = {
      charEnabled: isToggleOn(root, '#mq-set-dava-char'),
      userEnabled: isToggleOn(root, '#mq-set-dava-user')
    };
    if (global.MiyaImageGen && global.MiyaImageGen.isGlobalEnabled && global.MiyaImageGen.isGlobalEnabled()) {
      var prevIg = s.imageGen || {};
      patch.imageGen = {
        enabled: isToggleOn(root, '#mq-set-ig-en'),
        customPrompt: String((root.querySelector('[data-mq-set-ig-prompt]') || {}).value || '').trim(),
        refUrl: prevIg.refUrl || '',
        refBlobId: prevIg.refBlobId || null
      };
    }
    var useAllEmo = isToggleOn(root, '#mq-set-emo-all');
    var emoGroupIds = [];
    if (!useAllEmo) {
      root.querySelectorAll('[data-mq-set-emo-grp].is-on').forEach(function (sw) {
        var gid = sw.getAttribute('data-mq-set-emo-grp');
        if (gid) emoGroupIds.push(gid);
      });
    }
    return {
      settingsPatch: patch,
      profileId: (root.querySelector('[data-mq-set-mask]') || {}).value || '',
      emojiGroupIds: emoGroupIds,
      useAllEmo: useAllEmo,
      ttsEnabled: ttsOn,
      worldbookEntryOrder: filterWorldbookEntryOrderForContact(
        c.contact,
        readWorldbookEntryOrderFromRoot(root)
      )
    };
  }

  function captureFormDraft(root) {
    if (!root || !state.chatId) return;
    try {
      state.formDraft = readForm(root);
    } catch (e) {
      state.formDraft = null;
    }
  }

  function applyFormDraft(root) {
    var draft = state.formDraft;
    if (!root || !draft || !draft.settingsPatch) return;
    var p = draft.settingsPatch;

    function setVal(sel, v) {
      var el = root.querySelector(sel);
      if (el) el.value = v != null ? String(v) : '';
    }

    function setToggle(sel, on) {
      var el = root.querySelector(sel);
      if (!el) return;
      el.classList.toggle('is-on', !!on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    }

    setVal('[data-mq-set-remark]', p.remarkName);
    setVal('[data-mq-set-rel]', p.relationship);
    if (draft.profileId) setVal('[data-mq-set-mask]', draft.profileId);

    var wa = p.weatherAwareness || {};
    setToggle('#mq-set-weather-en', wa.enabled);
    setVal('[data-mq-set-vplace-user]', wa.placeUser);
    setVal('[data-mq-set-rloc-user]', wa.realLocUser);
    setVal('[data-mq-set-vplace-role]', wa.placeRole);
    setVal('[data-mq-set-rloc-role]', wa.realLocRole);

    setToggle('#mq-set-mute-notify', p.muteNotifications);
    setToggle('#mq-set-lifelike', p.backgroundMessage && p.backgroundMessage.lifeLikeEnabled);
    setVal('[data-mq-set-render-limit]', p.messageRenderLimit);
    setVal('[data-mq-set-bubble-min]', p.roleReplyBubbleMin);
    setVal('[data-mq-set-bubble-max]', p.roleReplyBubbleMax);
    setToggle('#mq-set-trans', p.autoTranslate);
    setVal('[data-mq-set-trans-target]', p.translateTarget);
    setToggle('#mq-set-moments-trans', p.momentsTranslate);
    setToggle('#mq-set-tts-en', draft.ttsEnabled != null ? draft.ttsEnabled : !!String(p.minimaxVoiceId || '').trim());
    setVal('[data-mq-set-voice-id]', p.minimaxVoiceId);
    setVal('[data-mq-set-lang]', p.minimaxLanguageBoost);

    if (p.dynamicAvatar) {
      setToggle('#mq-set-dava-char', p.dynamicAvatar.charEnabled);
      setToggle('#mq-set-dava-user', p.dynamicAvatar.userEnabled);
    }

    if (p.imageGen) {
      setToggle('#mq-set-ig-en', p.imageGen.enabled);
      setVal('[data-mq-set-ig-prompt]', p.imageGen.customPrompt);
    }

    var ma = p.momentsAuto || {};
    setVal('[data-mq-set-moments-mode]', ma.mode || 'off');
    if (ma.mode === 'rounds') setVal('[data-mq-set-moments-rounds]', ma.roundInterval);
    if (ma.mode === 'hours') setVal('[data-mq-set-moments-hours]', ma.hourInterval);

    setToggle('#mq-set-online-narration', p.onlineNarrationEnabled);
    setToggle('#mq-set-online-narration-ctx', p.onlineNarrationInjectContext);
    setVal('[data-mq-set-narration-char-person]', p.onlineNarrationCharPerson || '3');
    setVal('[data-mq-set-narration-user-person]', p.onlineNarrationUserPerson || '2');

    setToggle('#mq-set-emo-all', draft.useAllEmo !== false);
    if (draft.useAllEmo === false && Array.isArray(draft.emojiGroupIds)) {
      root.querySelectorAll('[data-mq-set-emo-grp]').forEach(function (sw) {
        var gid = sw.getAttribute('data-mq-set-emo-grp');
        var on = draft.emojiGroupIds.indexOf(gid) >= 0;
        sw.classList.toggle('is-on', on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }

    if (p.chatBeautify) {
      var cssTa = root.querySelector('[data-mq-bf-custom-css]');
      if (cssTa) cssTa.value = p.chatBeautify.customCss || '';
      var presetPick = root.querySelector('[data-mq-bf-preset-pick]');
      if (presetPick && p.chatBeautify.presetName != null) presetPick.value = p.chatBeautify.presetName;
    }

    if (p.operationRulesPreset != null) {
      var opPick = root.querySelector('[data-mq-set-oprules-preset]');
      if (opPick) opPick.value = p.operationRulesPreset;
    }

    if (p.thinkingRulesPreset != null) {
      var thPick = root.querySelector('[data-mq-set-thrules-preset]');
      if (thPick) thPick.value = p.thinkingRulesPreset;
    }

    if (p.heartVoicePreset != null) {
      var hvPick = root.querySelector('[data-mq-set-hv-tpl-preset]');
      if (hvPick) hvPick.value = p.heartVoicePreset;
    }

    syncTranslateExtrasVisibility(root);
    syncMomentsAutoModeUI(root);
    syncEmoBindGroupToggles(root);

    if (Array.isArray(draft.worldbookEntryOrder) && draft.worldbookEntryOrder.length) {
      var wbList = root.querySelector('[data-mq-set-wb-sort]');
      if (wbList) {
        draft.worldbookEntryOrder.forEach(function (id, targetIdx) {
          id = String(id || '').trim();
          if (!id) return;
          var rows = Array.prototype.slice.call(wbList.querySelectorAll('[data-mq-set-wb-sort-id]'));
          var row = rows.find(function (el) {
            return el.getAttribute('data-mq-set-wb-sort-id') === id;
          });
          if (!row) return;
          var currentIdx = rows.indexOf(row);
          if (currentIdx < 0 || currentIdx === targetIdx) return;
          var ref = rows[targetIdx] || null;
          if (ref && ref !== row) wbList.insertBefore(row, ref);
          else wbList.appendChild(row);
        });
        refreshWorldbookSortRowState(wbList);
      }
    }

    var bfMod = global.MiyaChatBeautify;
    var bfWrap = root.querySelector('.mi-bf-wrap');
    if (bfMod && bfWrap) bfMod.hydrateCssPreview(bfWrap);
  }

  function refreshWeatherAfterSaveInBackground(prevWa, nextWa) {
    var aw = global.MiyaChatAwareness;
    if (!aw || typeof aw.refreshWeatherIfStale !== 'function' || !store || !state.chatId) return;
    var shouldRefresh =
      nextWa &&
      nextWa.enabled &&
      typeof aw.shouldRefreshWeatherOnSave === 'function' &&
      aw.shouldRefreshWeatherOnSave(prevWa, nextWa);
    if (!shouldRefresh) return;
    var chatId = state.chatId;
    var fresh = store.getChatSettings(chatId);
    aw.refreshWeatherIfStale(fresh, { forceLocChange: true }).then(function (refreshed) {
      if (refreshed && refreshed.weatherAwareness) {
        return store.saveChatSettings(chatId, { weatherAwareness: refreshed.weatherAwareness });
      }
    }).catch(function () {});
  }

  function saveForm() {
    if (!store || !state.chatId || !pageEl) return Promise.resolve();
    var root = pageEl.querySelector('[data-mq-set-body]');
    var data = readForm(root);
    var c = ctx();
    if (!c) return Promise.resolve();

    var useAllEmo = isToggleOn(root, '#mq-set-emo-all');
    var emojiValid = useAllEmo || data.emojiGroupIds.length > 0;
    var prevWa = c.settings.weatherAwareness;
    var nextWa = data.settingsPatch.weatherAwareness;
    var chain = Promise.resolve();
    if (data.profileId && data.profileId !== c.chat.profileId) {
      chain = chain.then(function () { return store.updateChat(state.chatId, { profileId: data.profileId }); });
      if (c.contact) {
        chain = chain.then(function () {
          return store.updateContact(c.contact.id, { defaultProfileId: data.profileId });
        });
      }
    }
    chain = chain.then(function () {
      return store.saveChatSettings(state.chatId, data.settingsPatch);
    });

    return chain.then(function () {
      var emojiChain = Promise.resolve();
      if (emojiValid && c.contact && typeof data.emojiGroupIds !== 'undefined') {
        emojiChain = store.setContactEmojiGroups(c.contact.id, data.emojiGroupIds);
      }
      return emojiChain;
    }).then(function () {
      if (c.contact && store.setContactWorldbookEntryOrder && Array.isArray(data.worldbookEntryOrder)) {
        return store.setContactWorldbookEntryOrder(c.contact.id, data.worldbookEntryOrder);
      }
    }).then(function () {
      state.formDraft = null;
      toast(emojiValid
        ? '已保存'
        : '其它设置已保存；表情包请打开「使用全部分组」或至少开启一个分组');
      /* 先反馈，再轻量刷 UI；禁止整页房间 refresh（会重渲全部消息） */
      if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
      scheduleRender({ fromStore: true, skipContextUsage: true });
      if (global.miyaChatApp && global.miyaChatApp.refreshLists) {
        if (typeof global.miyaScheduleIdle === 'function') {
          global.miyaScheduleIdle(function () { global.miyaChatApp.refreshLists(); }, 700);
        } else {
          setTimeout(function () { global.miyaChatApp.refreshLists(); }, 0);
        }
      }
      if (
        c.contact &&
        data.settingsPatch &&
        data.settingsPatch.momentsAuto &&
        data.settingsPatch.momentsAuto.mode &&
        data.settingsPatch.momentsAuto.mode !== 'off' &&
        global.MiyaChatMoments &&
        typeof global.MiyaChatMoments.checkMomentsAutoForContact === 'function'
      ) {
        var momentsMod = global.MiyaChatMoments;
        var dueCheck = function () { momentsMod.checkMomentsAutoForContact(c.contact.id); };
        if (typeof momentsMod.whenReady === 'function') {
          momentsMod.whenReady().then(dueCheck).catch(dueCheck);
        } else if (typeof global.miyaScheduleIdle === 'function') {
          global.miyaScheduleIdle(dueCheck, 1200);
        } else {
          setTimeout(dueCheck, 0);
        }
      }
      if (
        data.settingsPatch &&
        data.settingsPatch.backgroundMessage &&
        data.settingsPatch.backgroundMessage.lifeLikeEnabled &&
        global.MiyaChatBackground &&
        typeof global.MiyaChatBackground.checkAll === 'function'
      ) {
        if (typeof global.miyaScheduleIdle === 'function') {
          global.miyaScheduleIdle(function () { global.MiyaChatBackground.checkAll(); }, 1400);
        } else {
          setTimeout(function () { global.MiyaChatBackground.checkAll(); }, 0);
        }
      }
      refreshWeatherAfterSaveInBackground(prevWa, nextWa);
    }).catch(function () { toast('保存失败'); });
  }

  function hydrateAvatars(root) {
    var c = ctx();
    if (!c || !root) return;
    var contact = c.contact && store.findContact ? store.findContact(c.contact.id) : c.contact;
    var profileId = profileIdForCtx(c);
    var profile =
      (store.getProfiles() || []).find(function (p) { return p.id === profileId; }) || c.profile;
    hydrateDisplayAvatarPicker(root, 'contact', contact);
    hydrateDisplayAvatarPicker(root, 'profile', profile);
    var bf = c.settings.chatBeautify || {};
    var bfMod = global.MiyaChatBeautify;
    var preview = root.querySelector('[data-mq-set-bg-preview]');
    if (preview && bfMod) {
      bfMod.resolveWallpaperUrl(bf).then(function (url) {
        if (url) {
          preview.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
          preview.classList.add('has-image');
          var ph = preview.querySelector('.mi-bg-stage__placeholder');
          if (ph) ph.hidden = true;
        }
      });
    }
    if (global.MiyaChatWallpaperPicker && global.MiyaChatWallpaperPicker.hydrateThumbs) {
      global.MiyaChatWallpaperPicker.hydrateThumbs(root);
    }
    var igPreview = root.querySelector('[data-mq-set-ig-ref-preview]');
    if (igPreview && c.settings.imageGen) {
      var ig = c.settings.imageGen;
      applyDisplayAvatarPreview(igPreview, '');
      if (ig.refUrl) applyDisplayAvatarPreview(igPreview, ig.refUrl);
      else if (ig.refBlobId) {
        store.getAvatarUrl(ig.refBlobId).then(function (url) {
          if (url) applyDisplayAvatarPreview(igPreview, url);
        });
      }
    }
  }

  function render(opts) {
    opts = opts || {};
    if (!pageEl) return;
    var body = pageEl.querySelector('[data-mq-set-body]');
    if (!body) return;
    var prevScroll = body.scrollTop;
    captureZoneOpenState(body);
    var wbPanel = body.querySelector('[data-mq-set-wb-sort-panel]');
    if (wbPanel) state.wbSortOpen = wbPanel.classList.contains('is-open');
    if (!opts.fromStore && body.querySelector('[data-mq-set-remark]')) captureFormDraft(body);
    body.innerHTML = renderPage();
    hydrateAvatars(body);
    if (!opts.fromStore) applyFormDraft(body);
    syncEmoBindGroupToggles(body);
    syncMomentsAutoModeUI(body);
    syncTranslateExtrasVisibility(body);
    body.scrollTop = prevScroll;
    if (!opts.skipContextUsage) scheduleContextUsageRefresh();
    var bfMod = global.MiyaChatBeautify;
    var bfWrap = body.querySelector('.mi-bf-wrap');
    if (bfMod && bfWrap && state.chatId) {
      bfMod.bindAtelierRoot(bfWrap, state.chatId, function () { render(); });
      bfMod.hydrateCssPreview(bfWrap);
    }
  }

  function scheduleRender(opts) {
    var gen = ++renderRaf;
    requestAnimationFrame(function () {
      if (gen !== renderRaf || !pageEl || !state.chatId) return;
      render(opts);
    });
  }

  function markWallpaperLibActive(wpId) {
    if (!pageEl) return;
    var id = wpId != null ? String(wpId) : '';
    pageEl.querySelectorAll('[data-mq-set-wall-lib]').forEach(function (btn) {
      var on = !!(id && btn.getAttribute('data-mq-set-wall-lib') === id);
      btn.classList.toggle('is-active', on);
      var check = btn.querySelector('.mi-wall-lib-cell__check');
      if (on && !check) {
        btn.insertAdjacentHTML('beforeend', '<span class="mi-wall-lib-cell__check" aria-hidden="true">✓</span>');
      } else if (!on && check) {
        check.remove();
      }
    });
  }

  function open(chatId) {
    store = global.miyaChatStore;
    if (!store || !chatId) return Promise.resolve();
    var chat = store.findChat(chatId);
    if (chat && chat.type === 'group' && global.miyaChatGroupSettings) {
      return global.miyaChatGroupSettings.open(chatId);
    }

    state.chatId = chatId;
    state.searchQuery = '';
    state.wbSortOpen = false;
    state.zoneOpen = {};
    ensurePage();
    pageEl.hidden = false;
    pageEl.classList.add('is-open');
    pageEl.setAttribute('aria-hidden', 'false');
    var app = $('miya-chat-app');
    if (app) app.classList.add('mi-set-open');

    var body = pageEl.querySelector('[data-mq-set-body]');
    var scroll = body;
    if (scroll) scroll.scrollTop = 0;

    if (chat) {
      scheduleRender({ skipContextUsage: true, fromStore: true });
    } else if (body) {
      body.innerHTML = '<p class="mi-empty-hint">加载中…</p>';
    }

    var chain = Promise.resolve();
    if (global.MiyaChatBeautify && global.MiyaChatBeautify.whenPresetsReady) {
      chain = chain.then(function () { return global.MiyaChatBeautify.whenPresetsReady(); });
    }
    if (global.MiyaChatOperationRules && global.MiyaChatOperationRules.ensureLoaded) {
      chain = chain.then(function () { return global.MiyaChatOperationRules.ensureLoaded(); });
    } else if (global.MiyaChatOperationRules && global.MiyaChatOperationRules.whenPresetsReady) {
      chain = chain.then(function () { return global.MiyaChatOperationRules.whenPresetsReady(); });
    }
    if (global.MiyaChatThinkingRules && global.MiyaChatThinkingRules.whenPresetsReady) {
      chain = chain.then(function () { return global.MiyaChatThinkingRules.whenPresetsReady(); });
    }
    if (global.MiyaChatHeartVoiceTemplates && global.MiyaChatHeartVoiceTemplates.whenPresetsReady) {
      chain = chain.then(function () { return global.MiyaChatHeartVoiceTemplates.whenPresetsReady(); });
    }
    return chain.then(function () {
      return store.init();
    }).then(function () {
      if (String(state.chatId) !== String(chatId)) return;
      var loaded = store.findChat(chatId);
      if (!loaded || loaded.type === 'group') return;
      scheduleRender({ fromStore: true });
    });
  }

  function close() {
    state.chatId = null;
    state.formDraft = null;
    if (pageEl) {
      pageEl.classList.remove('is-open');
      pageEl.hidden = true;
      pageEl.setAttribute('aria-hidden', 'true');
    }
    var app = $('miya-chat-app');
    if (app) app.classList.remove('mi-set-open');
    if (global.miyaChatRoom && typeof global.miyaChatRoom.restoreCompose === 'function') {
      global.miyaChatRoom.restoreCompose();
    }
  }

  function bindPageEvents() {
    if (!pageEl || pageEl.dataset.bound) return;
    pageEl.dataset.bound = '1';

    pageEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-mq-set-back]')) { close(); return; }
      if (e.target.closest('[data-mq-set-save]')) { saveForm(); return; }
      if (e.target.closest('[data-mq-set-weather-sense]')) { runWeatherSense(); return; }
      if (e.target.closest('[data-mq-set-weather-sync-app]')) { syncWeatherAppIntoForm(); return; }

      var zoneToggle = e.target.closest('[data-mq-set-zone-toggle]');
      if (zoneToggle) {
        toggleZone(zoneToggle.closest('[data-mq-set-zone]'));
        return;
      }

      if (e.target.closest('[data-mq-set-wb-sort-toggle]')) {
        toggleWorldbookSortPanel();
        return;
      }

      var wbUp = e.target.closest('[data-mq-set-wb-sort-up]');
      if (wbUp && !wbUp.disabled) {
        var wbRowUp = wbUp.closest('[data-mq-set-wb-sort-id]');
        var wbListUp = pageEl.querySelector('[data-mq-set-wb-sort]');
        if (wbRowUp && wbListUp) {
          moveWorldbookSortRow(wbListUp, wbRowUp.getAttribute('data-mq-set-wb-sort-id'), -1);
        }
        return;
      }
      var wbDown = e.target.closest('[data-mq-set-wb-sort-down]');
      if (wbDown && !wbDown.disabled) {
        var wbRowDown = wbDown.closest('[data-mq-set-wb-sort-id]');
        var wbListDown = pageEl.querySelector('[data-mq-set-wb-sort]');
        if (wbRowDown && wbListDown) {
          moveWorldbookSortRow(wbListDown, wbRowDown.getAttribute('data-mq-set-wb-sort-id'), 1);
        }
        return;
      }

      if (e.target.closest('[data-mq-set-contact-wallet-adjust]')) {
        var cW = ctx();
        if (!cW || !cW.contact || !store.setContactWalletBalance) return;
        var curRoleBal = Number((store.getContactWallet(cW.contact.id) || {}).balance) || 0;
        dialog({
          mode: 'prompt',
          title: '调整角色余额',
          message: '设置「' + (cW.contact.remarkName || cW.contact.name || 'Ta') + '」的余额（当前 ¥' + curRoleBal + '）',
          placeholder: '例如：5000',
          defaultValue: String(curRoleBal)
        }).then(function (val) {
          if (val == null || val === '') return;
          var next = Number(String(val).trim());
          if (!Number.isFinite(next) || next < 0) {
            toast('请输入有效金额');
            return;
          }
          store.setContactWalletBalance(cW.contact.id, next).then(function () {
            toast('余额已更新');
            render();
          }).catch(function () { toast('更新失败'); });
        });
        return;
      }

      if (e.target.closest('.mi-toggle, .ins-toggle')) {
        var sw = e.target.closest('.mi-toggle, .ins-toggle');
        if (sw.classList.contains('is-disabled')) return;
        var on = !sw.classList.contains('is-on');
        sw.classList.toggle('is-on', on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
        if (sw.id === 'mq-set-emo-all' || sw.hasAttribute('data-mq-set-emo-grp')) {
          var body = pageEl.querySelector('[data-mq-set-body]');
          syncEmoBindGroupToggles(body);
        }
        if (sw.id === 'mq-set-trans') {
          var transBody = pageEl.querySelector('[data-mq-set-body]');
          syncTranslateExtrasVisibility(transBody);
        }
        return;
      }

      if (e.target.closest('[data-mq-set-clear]')) {
        dialog({ mode: 'confirm', title: '清空消息', message: '确定清空全部聊天记录？', confirmText: '清空', cancelText: '取消' }).then(function (ok) {
          if (!ok || !state.chatId) return;
          store.clearChatMessages(state.chatId).then(function () {
            toast('已清空');
            if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === state.chatId) global.miyaChatRoom.refresh();
            render();
          });
        });
        return;
      }

      if (e.target.closest('[data-mq-set-export]')) {
        var msgs = store.getMessages(state.chatId).filter(function (m) { return m && !m.deleted; });
        var blob = new Blob([JSON.stringify(msgs, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.download = 'miya-chat-' + state.chatId + '.json';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
        toast('已导出 ' + msgs.length + ' 条');
        return;
      }

      if (e.target.closest('[data-mq-set-import]')) {
        var finp = pageEl.querySelector('[data-mq-set-import-file]');
        if (finp && global.miyaTriggerFileInput) global.miyaTriggerFileInput(finp);
        else if (finp) finp.click();
        return;
      }

      if (e.target.closest('[data-mq-set-delete-contact]')) {
        var c = ctx();
        if (!c || !c.contact) return;
        dialog({ mode: 'confirm', title: '删除联系人', message: '确定删除「' + (c.contact.name || '') + '」？', confirmText: '删除', cancelText: '取消' }).then(function (ok) {
          if (!ok) return;
          store.deleteContactAndData(c.contact.id).then(function () {
            toast('已删除');
            close();
            if (global.miyaChatRoom) global.miyaChatRoom.close();
            if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
          });
        });
        return;
      }

      function ensureBgFileInput() {
        var finp = pageEl.querySelector('[data-mq-set-bg-file]');
        if (finp) return finp;
        finp = document.createElement('input');
        finp.type = 'file';
        finp.accept = 'image/*';
        finp.hidden = true;
        finp.setAttribute('data-mq-set-bg-file', '');
        pageEl.appendChild(finp);
        finp.addEventListener('change', function (ev) {
          var file = ev.target.files && ev.target.files[0];
          ev.target.value = '';
          if (!file || !state.chatId) return;
          store.storeChatMedia(file, 'wall').then(function (blobId) {
            return store.saveChatSettings(state.chatId, {
              chatBeautify: Object.assign({}, store.getChatSettings(state.chatId).chatBeautify, {
                wallpaperMode: 'idb', wallpaperId: blobId, wallpaperUrl: ''
              })
            });
          }).then(function () {
            toast('背景已更新');
            if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
            markWallpaperLibActive(null);
            scheduleRender({ fromStore: true, skipContextUsage: true });
          });
        });
        return finp;
      }

      if (e.target.closest('[data-mq-set-bg-pick]')) {
        triggerFileInput(ensureBgFileInput());
        return;
      }

      if (e.target.closest('[data-mq-set-wall-manage]')) {
        if (global.MiyaChatWallpaperPicker && global.MiyaChatWallpaperPicker.openManage) {
          global.MiyaChatWallpaperPicker.openManage();
        }
        return;
      }

      if (e.target.closest('[data-mq-set-wall-lib]')) {
        var libBtn = e.target.closest('[data-mq-set-wall-lib]');
        var wpId = libBtn.getAttribute('data-mq-set-wall-lib');
        var picker = global.MiyaChatWallpaperPicker;
        var wp = picker && picker.findWallpaper ? picker.findWallpaper(wpId) : null;
        if (!wp || !state.chatId || !picker || !picker.applyWallpaperToChat) return;
        markWallpaperLibActive(wpId);
        toast('背景已更新');
        picker.applyWallpaperToChat(state.chatId, wp).then(function () {
          if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
        }).catch(function () {
          toast('背景更新失败');
          scheduleRender({ fromStore: true, skipContextUsage: true });
        });
        return;
      }

      if (e.target.closest('[data-mq-set-bg-reset]')) {
        store.saveChatSettings(state.chatId, {
          background: '',
          chatBeautify: Object.assign({}, store.getChatSettings(state.chatId).chatBeautify, {
            wallpaperMode: 'none', wallpaperId: null, wallpaperUrl: ''
          })
        }).then(function () {
          toast('已恢复默认');
          if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
          markWallpaperLibActive(null);
          scheduleRender({ fromStore: true, skipContextUsage: true });
        });
        return;
      }

      if (e.target.closest('[data-mq-set-bg-url-apply]')) {
        var bgUrlIn = pageEl.querySelector('[data-mq-set-bg-url-input]');
        var bgUrl = bgUrlIn ? String(bgUrlIn.value || '').trim() : '';
        if (!bgUrl) { toast('请填写图片链接'); return; }
        store.saveChatSettings(state.chatId, {
          chatBeautify: Object.assign({}, store.getChatSettings(state.chatId).chatBeautify, {
            wallpaperMode: 'url', wallpaperUrl: bgUrl, wallpaperId: null
          })
        }).then(function () {
          toast('背景已更新');
          if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
          markWallpaperLibActive(null);
          scheduleRender({ fromStore: true, skipContextUsage: true });
        });
        return;
      }

      function ensureDisplayAvatarFileInput(kind) {
        var sel = '[data-mq-set-dava-' + kind + '-file]';
        var finp = pageEl.querySelector(sel);
        if (finp) return finp;
        finp = document.createElement('input');
        finp.type = 'file';
        finp.accept = 'image/*';
        finp.hidden = true;
        finp.setAttribute('data-mq-set-dava-' + kind + '-file', '');
        pageEl.appendChild(finp);
        finp.addEventListener('change', function (ev) {
          var file = ev.target.files && ev.target.files[0];
          ev.target.value = '';
          if (!file || !state.chatId) return;
          store.storeChatMedia(file, 'avatar').then(function (blobId) {
            return mergeDisplayAvatars(state.chatId, kind, { url: '', blobId: blobId });
          }).then(function () {
            toast(kind === 'contact' ? 'Ta 的头像已更新' : '我的头像已更新');
            render();
            refreshOpenChatRoom();
          }).catch(function () { toast('上传失败'); });
        });
        return finp;
      }

      function handleDisplayAvatarPick(kind) {
        triggerFileInput(ensureDisplayAvatarFileInput(kind));
      }

      function handleDisplayAvatarReset(kind) {
        resetDisplayAvatar(state.chatId, kind).then(function () {
          toast('已恢复档案头像');
          render();
          refreshOpenChatRoom();
        });
      }

      function handleDisplayAvatarUrlApply(kind) {
        var urlIn = pageEl.querySelector('[data-mq-set-dava-' + kind + '-url-input]');
        var url = urlIn ? String(urlIn.value || '').trim() : '';
        if (!url) { toast('请填写图片链接'); return; }
        mergeDisplayAvatars(state.chatId, kind, { url: url, blobId: null }).then(function () {
          toast(kind === 'contact' ? 'Ta 的头像已更新' : '我的头像已更新');
          render();
          refreshOpenChatRoom();
        });
      }

      if (e.target.closest('[data-mq-set-dava-contact-pick]')) { handleDisplayAvatarPick('contact'); return; }
      if (e.target.closest('[data-mq-set-dava-profile-pick]')) { handleDisplayAvatarPick('profile'); return; }
      if (e.target.closest('[data-mq-set-dava-contact-reset]')) { handleDisplayAvatarReset('contact'); return; }
      if (e.target.closest('[data-mq-set-dava-profile-reset]')) { handleDisplayAvatarReset('profile'); return; }
      if (e.target.closest('[data-mq-set-dava-contact-url-apply]')) { handleDisplayAvatarUrlApply('contact'); return; }
      if (e.target.closest('[data-mq-set-dava-profile-url-apply]')) { handleDisplayAvatarUrlApply('profile'); return; }

      function patchImageGenRef(patch) {
        var cur = store.getChatSettings(state.chatId) || {};
        var ig = Object.assign({}, cur.imageGen || {}, patch);
        return store.saveChatSettings(state.chatId, { imageGen: ig });
      }

      function ensureIgRefFileInput() {
        var finp = pageEl.querySelector('[data-mq-set-ig-ref-file]');
        if (finp) return finp;
        finp = document.createElement('input');
        finp.type = 'file';
        finp.accept = 'image/*';
        finp.hidden = true;
        finp.setAttribute('data-mq-set-ig-ref-file', '');
        pageEl.appendChild(finp);
        finp.addEventListener('change', function (ev) {
          var file = ev.target.files && ev.target.files[0];
          ev.target.value = '';
          if (!file || !state.chatId) return;
          store.storeChatMedia(file, 'imagegen-ref').then(function (blobId) {
            return patchImageGenRef({ refBlobId: blobId, refUrl: '' });
          }).then(function () {
            toast('参考图已更新');
            render();
          }).catch(function () { toast('上传失败'); });
        });
        return finp;
      }

      if (e.target.closest('[data-mq-set-ig-ref-pick]')) {
        triggerFileInput(ensureIgRefFileInput());
        return;
      }
      if (e.target.closest('[data-mq-set-ig-ref-reset]')) {
        patchImageGenRef({ refBlobId: null, refUrl: '' }).then(function () {
          toast('已清除参考图');
          render();
        });
        return;
      }
      if (e.target.closest('[data-mq-set-ig-ref-url-apply]')) {
        var igUrlIn = pageEl.querySelector('[data-mq-set-ig-ref-url-input]');
        var igUrl = igUrlIn ? String(igUrlIn.value || '').trim() : '';
        if (!igUrl) { toast('请填写图片链接'); return; }
        patchImageGenRef({ refUrl: igUrl, refBlobId: null }).then(function () {
          toast('参考图已更新');
          render();
        });
        return;
      }

      if (e.target.closest('[data-mq-set-ctx-toggle]')) {
        toggleContextUsageDetail(false);
        return;
      }
    });

    pageEl.addEventListener('input', function (e) {
      if (e.target.matches('[data-mq-set-search]')) {
        state.searchQuery = e.target.value;
        var box = pageEl.querySelector('[data-mq-set-hits]');
        var c = ctx();
        if (box && c) box.innerHTML = renderSearchHits(c);
      }
    });

    pageEl.addEventListener('change', function (e) {
      if (e.target.matches('[data-mq-set-moments-mode]')) {
        var root = pageEl.querySelector('[data-mq-set-body]');
        var c = ctx();
        syncMomentsAutoModeUI(root);
        ensureMomentsAutoIntervalDefaults(root, e.target.value, c && c.settings && c.settings.momentsAuto);
        return;
      }
      if (
        e.target.matches('[data-mq-set-oprules-preset]') ||
        e.target.matches('[data-mq-set-thrules-preset]')
      ) {
        scheduleContextUsageRefresh();
        return;
      }
      if (e.target.matches('[data-mq-set-import-file]')) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var parsed = JSON.parse(reader.result);
            if (!Array.isArray(parsed)) throw new Error('invalid');
            store.importChatMessages(state.chatId, parsed).then(function (n) {
              toast('已导入 ' + n + ' 条');
              render({ fromStore: true });
              if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === state.chatId) global.miyaChatRoom.refresh();
            });
          } catch (err) { toast('JSON 无效'); }
        };
        reader.readAsText(file, 'utf-8');
      }
    });
  }

  function patchTokenUsageInSettings(chatId) {
    if (!pageEl || pageEl.hidden || !state.chatId) return;
    if (String(state.chatId) !== String(chatId || '')) return;
    refreshContextUsagePanel();
  }

  if (!global.miyaChatRoomExtras) global.miyaChatRoomExtras = {};
  global.miyaChatRoomExtras.patchTokenUsageInSettings = patchTokenUsageInSettings;

  global.miyaChatContactSettings = {
    open: open,
    close: close,
    save: saveForm,
    refreshContextUsage: refreshContextUsagePanel
  };
})(window);
