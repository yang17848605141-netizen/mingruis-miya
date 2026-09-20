/**
 * miya-chat-app.js — INS 风聊天（档案联系人自动同步）
 */
(function (global) {
  'use strict';

  var currentTab = 'msg';
  var storeReady = null;
  var avatarUrlCache = {};
  var msgSearchQuery = '';
  var chatSwipeOpen = null;
  var chatSwipeDrag = null;
  var CHAT_SWIPE_ACTION_W = 84;
  var SOFT_UI_KEY = 'miya-soft-profile-ui';
  var avatarLazyObserver = null;
  var contactsRenderGen = 0;
  var chatsRenderGen = 0;
  var deferredRenderRaf = 0;

  function applyChatBodyTheme() {
    document.documentElement.style.backgroundColor = '#FFFFFF';
    document.body.style.backgroundColor = '#FFFFFF';
  }

  function readSoftUi() {
    try {
      var raw = localStorage.getItem(SOFT_UI_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveSoftUi(patch) {
    var next = Object.assign(readSoftUi(), patch || {});
    try { localStorage.setItem(SOFT_UI_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  }

  function hydrateSoftUiTexts() {
    var data = readSoftUi();
    var app = $('miya-chat-app');
    if (!app) return;

    app.querySelectorAll('[data-soft-edit]').forEach(function (el) {
      var key = el.getAttribute('data-soft-edit');
      if (!key) return;
      var val = data[key];
      if (key === 'bio' && val == null && data['profile-bio'] != null) val = data['profile-bio'];
      if (val != null && String(val).trim() !== '') {
        el.textContent = String(val);
      }
    });

    app.querySelectorAll('[data-soft-text]').forEach(function (el) {
      var key = el.getAttribute('data-soft-text');
      if (!key || data[key] == null) return;
      el.textContent = String(data[key]);
    });

    var statusImg = $('soft-status-avatar-img');
    if (statusImg && data.statusAvatar) {
      statusImg.src = data.statusAvatar;
    }
  }

  function commitSoftEditEl(el) {
    if (!el) return;
    var key = el.getAttribute('data-soft-edit');
    if (!key) return;
    var raw = String(el.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (key === 'status') {
      if (!raw) {
        raw = '在想你';
        el.textContent = raw;
      }
      saveSoftUi({ status: raw.slice(0, 40) });
      return;
    }
    if (key === 'bio') {
      if (!raw) {
        raw = '记录日常，保留质感';
        el.textContent = raw;
      }
      saveSoftUi({ bio: raw.slice(0, 80) });
      return;
    }
    if (key === 'following' || key === 'fans' || key === 'likes') {
      var num = raw.replace(/[^\d]/g, '');
      if (!num) num = '0';
      el.textContent = num;
      var patch = {};
      patch[key] = num;
      saveSoftUi(patch);
    }
  }

  function bindSoftMineInlineEdit() {
    var app = $('miya-chat-app');
    if (!app || app.dataset.softMineEditBound) return;
    app.dataset.softMineEditBound = '1';

    app.addEventListener('focusin', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-soft-edit]') : null;
      if (!el) return;
      el.dataset.softEditBefore = el.textContent || '';
    });

    app.addEventListener('focusout', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-soft-edit]') : null;
      if (!el) return;
      commitSoftEditEl(el);
    });

    app.addEventListener('keydown', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-soft-edit]') : null;
      if (!el) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        el.blur();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (el.dataset.softEditBefore != null) el.textContent = el.dataset.softEditBefore;
        el.blur();
      }
    });

    var avaBtn = app.querySelector('[data-soft-status-ava]');
    var avaFile = $('soft-status-avatar-file');
    if (avaBtn && avaFile && !avaFile.dataset.bound) {
      avaFile.dataset.bound = '1';
      avaBtn.addEventListener('click', function (e) {
        e.preventDefault();
        avaFile.click();
      });
      avaFile.addEventListener('change', function () {
        var file = avaFile.files && avaFile.files[0];
        avaFile.value = '';
        if (!file || !/^image\//i.test(file.type)) return;
        var reader = new FileReader();
        reader.onload = function () {
          var url = String(reader.result || '');
          if (!url) return;
          saveSoftUi({ statusAvatar: url });
          var img = $('soft-status-avatar-img');
          if (img) img.src = url;
        };
        reader.readAsDataURL(file);
      });
    }
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
    if (global.miyaSettingsApp && global.miyaSettingsApp.toast) {
      global.miyaSettingsApp.toast(msg);
      return;
    }
    var el = document.createElement('div');
    el.className = 'qq-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  function ensureStore() {
    if (storeReady) return storeReady;
    if (global.miyaChatContactsSync && global.miyaChatContactsSync.ensureBootstrap) {
      storeReady = global.miyaChatContactsSync.ensureBootstrap();
      return storeReady;
    }
    var chain = Promise.resolve();
    if (global.miyaBootstrapKvStores) {
      chain = chain.then(function () { return global.miyaBootstrapKvStores(); });
    }
    if (global.miyaChatStore && global.miyaChatStore.init) {
      chain = chain.then(function () { return global.miyaChatStore.init(); });
    }
    if (global.miyaChatContactsSync && global.miyaChatContactsSync.syncAll) {
      chain = chain.then(function () {
        return global.miyaChatContactsSync.syncAll({ prune: false });
      });
    }
    storeReady = chain;
    return storeReady;
  }

  function invalidateStoreReady() {
    storeReady = null;
    if (global.miyaChatContactsSync && global.miyaChatContactsSync.invalidateBootstrap) {
      global.miyaChatContactsSync.invalidateBootstrap();
    }
  }

  function avatarFallback(name) {
    var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#F0F0F0"/><stop offset="100%" stop-color="#E0E0E0"/></linearGradient></defs>' +
      '<rect width="80" height="80" rx="3" fill="url(#g)"/>' +
      '<text x="40" y="50" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#999999">' + ch + '</text></svg>'
    );
  }

  function formatListTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var hm = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    if (d.toDateString() === now.toDateString()) return hm;
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function getStore() { return global.miyaChatStore; }

  function findArchiveAvatar(contact) {
    if (!contact) return '';
    var cs = global.miyaContactsStore;
    if (!cs || typeof cs.findCharacter !== 'function') return '';
    try {
      var chronicleId = String(contact.chronicleId || '').trim();
      var characterId = String(contact.characterId || '').trim();
      var row =
        (chronicleId && cs.findCharacter(chronicleId)) ||
        (characterId && cs.findCharacter(characterId)) ||
        null;
      return row && row.avatar ? String(row.avatar).trim() : '';
    } catch (e) {
      return '';
    }
  }

  function chatAvatarCacheKey(chatId, contactId) {
    return String(chatId || '') + ':' + String(contactId || '');
  }

  function profileAvatarCacheKey(profileId) {
    return 'profile-display:' + String(profileId || '');
  }

  function hasContactDisplayOverride(contact, st) {
    st = st || getStore();
    if (!contact || !st || typeof st.hasContactDisplayAvatarOverride !== 'function') return false;
    return st.hasContactDisplayAvatarOverride(contact);
  }

  function resolveContactDisplayAvatarSync(contact, st) {
    st = st || getStore();
    if (!contact || !st || typeof st.resolveContactDisplayAvatarSync !== 'function') return '';
    return st.resolveContactDisplayAvatarSync(contact) || '';
  }

  function resolveContactDisplayAvatarAsync(contact, st) {
    st = st || getStore();
    if (!contact || !st || typeof st.resolveContactDisplayAvatarAsync !== 'function') {
      return Promise.resolve('');
    }
    return st.resolveContactDisplayAvatarAsync(contact);
  }

  function resolveProfileDisplayAvatarSync(profile, st) {
    st = st || getStore();
    if (!profile || !st || typeof st.resolveProfileDisplayAvatarSync !== 'function') return '';
    return st.resolveProfileDisplayAvatarSync(profile) || '';
  }

  function resolveProfileDisplayAvatarAsync(profile, st) {
    st = st || getStore();
    if (!profile || !st || typeof st.resolveProfileDisplayAvatarAsync !== 'function') {
      return Promise.resolve('');
    }
    return st.resolveProfileDisplayAvatarAsync(profile);
  }

  function invalidateChatAvatarCache(chatId, contactId, profileId) {
    if (contactId) {
      delete avatarUrlCache[contactId];
      Object.keys(avatarUrlCache).forEach(function (key) {
        if (key.indexOf(':' + contactId) >= 0 || key.endsWith(':' + contactId)) {
          delete avatarUrlCache[key];
        }
      });
    }
    if (profileId) delete avatarUrlCache[profileAvatarCacheKey(profileId)];
    if (chatId && contactId) delete avatarUrlCache[chatAvatarCacheKey(chatId, contactId)];
  }

  function resolveContactAvatarUrl(contact, chatId) {
    if (!contact) return '';
    var cacheKey = contact.id;
    if (avatarUrlCache[cacheKey]) return avatarUrlCache[cacheKey];
    if (hasContactDisplayOverride(contact)) {
      var displayAv = resolveContactDisplayAvatarSync(contact);
      if (displayAv) {
        avatarUrlCache[cacheKey] = displayAv;
        if (chatId) avatarUrlCache[chatAvatarCacheKey(chatId, contact.id)] = displayAv;
        return displayAv;
      }
      return '';
    }
    var av = String(contact.avatar || '').trim();
    if (av) {
      avatarUrlCache[cacheKey] = av;
      return av;
    }
    var archiveAv = findArchiveAvatar(contact);
    if (archiveAv) {
      avatarUrlCache[cacheKey] = archiveAv;
      return archiveAv;
    }
    var blobId = String(contact.avatarBlobId || '').trim();
    if (blobId) {
      var st = getStore();
      if (st && typeof st.getCachedBlobUrl === 'function') {
        var cached = st.getCachedBlobUrl(blobId);
        if (cached) {
          avatarUrlCache[cacheKey] = cached;
          return cached;
        }
      }
    }
    return '';
  }

  function resolveContactAvatarUrlAsync(contact, chatId) {
    if (!contact) return Promise.resolve('');
    var cacheKey = contact.id;
    if (hasContactDisplayOverride(contact)) {
      return resolveContactDisplayAvatarAsync(contact).then(function (displayAv) {
        if (displayAv) {
          avatarUrlCache[cacheKey] = displayAv;
          if (chatId) avatarUrlCache[chatAvatarCacheKey(chatId, contact.id)] = displayAv;
          return displayAv;
        }
        return resolveContactAvatarUrlAsyncFromArchive(contact, chatId);
      });
    }
    return resolveContactAvatarUrlAsyncFromArchive(contact, chatId);
  }

  function resolveContactAvatarUrlAsyncFromArchive(contact, chatId) {
    if (!contact) return Promise.resolve('');
    var cacheKey = chatId ? chatAvatarCacheKey(chatId, contact.id) : contact.id;
    var key = contact.id;
    var sync = resolveContactAvatarUrl(contact, chatId);
    if (sync) return Promise.resolve(sync);
    var blobId = String(contact.avatarBlobId || '').trim();
    if (!blobId) {
      var archiveOnly = findArchiveAvatar(contact);
      return Promise.resolve(archiveOnly || '');
    }
    var st = getStore();
    if (!st || typeof st.getAvatarUrl !== 'function') {
      return Promise.resolve(findArchiveAvatar(contact) || '');
    }
    return st.getAvatarUrl(blobId).then(function (url) {
      if (url) {
        avatarUrlCache[cacheKey] = url;
        if (!chatId) avatarUrlCache[key] = url;
        return url;
      }
      var archiveAv = findArchiveAvatar(contact);
      if (archiveAv) {
        avatarUrlCache[cacheKey] = archiveAv;
        if (!chatId) avatarUrlCache[key] = archiveAv;
        return archiveAv;
      }
      return '';
    }).catch(function () {
      var archiveAv = findArchiveAvatar(contact);
      if (archiveAv) {
        avatarUrlCache[cacheKey] = archiveAv;
        if (!chatId) avatarUrlCache[key] = archiveAv;
        return archiveAv;
      }
      return '';
    });
  }

  function isPersistableAvatarSrc(src) {
    var s = String(src || '').trim();
    if (!s || /^data:image\/svg/i.test(s)) return false;
    if (/^blob:/i.test(s)) return false;
    return true;
  }

  function usableAvatarUrl(url) {
    var s = String(url || '').trim();
    return !!s && !/^data:image\/svg/i.test(s);
  }

  function captureAvatarSrcMap(root) {
    var map = {};
    if (!root) return map;
    root.querySelectorAll('img[data-avatar-contact]').forEach(function (img) {
      var cid = img.getAttribute('data-avatar-contact');
      var chatId = img.getAttribute('data-avatar-chat') || '';
      if (!chatId) {
        var row = img.closest('[data-chat-id]');
        if (row) chatId = row.getAttribute('data-chat-id') || '';
      }
      var src = String(img.src || img.currentSrc || '').trim();
      if (!cid || !isPersistableAvatarSrc(src)) return;
      var mapKey = chatId ? chatAvatarCacheKey(chatId, cid) : cid;
      map[mapKey] = src;
    });
    return map;
  }

  function bindAvatarImg(img, contact, name, chatId) {
    if (!img) return;
    var fallback = avatarFallback(name);
    var cid = contact && contact.id;
    var cacheKey = chatId && cid ? chatAvatarCacheKey(chatId, cid) : cid;

    function useFallback() {
      img.onerror = null;
      img.src = fallback;
    }

    img.onerror = function () {
      img.onerror = null;
      var archiveAv = findArchiveAvatar(contact);
      if (archiveAv && archiveAv !== img.src) {
        img.onerror = useFallback;
        if (cacheKey) avatarUrlCache[cacheKey] = archiveAv;
        img.src = archiveAv;
        return;
      }
      useFallback();
    };
    if (!cid) return;

    function applyUrl(url) {
      if (!usableAvatarUrl(url) || !img.parentNode) return;
      if (cacheKey) avatarUrlCache[cacheKey] = url;
      img.src = url;
    }

    var sync = resolveContactAvatarUrl(contact, chatId);
    if (usableAvatarUrl(sync)) {
      applyUrl(sync);
      return;
    }
    var cached = cacheKey ? avatarUrlCache[cacheKey] : '';
    if (usableAvatarUrl(cached)) {
      applyUrl(cached);
      return;
    }
    resolveContactAvatarUrlAsync(contact, chatId).then(function (url) {
      applyUrl(url);
    });
  }

  function isGroupChat(chat) {
    return !!(chat && chat.type === 'group');
  }

  function contactsBoundToProfile(st, profileId) {
    var pid = String(profileId || '').trim();
    if (!pid || !st) return [];
    return (st.getContacts('all') || []).filter(function (c) {
      return String(c.defaultProfileId || '').trim() === pid;
    });
  }

  function getAvatarLazyObserver() {
    if (avatarLazyObserver) return avatarLazyObserver;
    if (!('IntersectionObserver' in global)) return null;
    avatarLazyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var img = entry.target;
        avatarLazyObserver.unobserve(img);
        hydrateAvatarImg(img);
      });
    }, { root: null, rootMargin: '160px 0px', threshold: 0.01 });
    return avatarLazyObserver;
  }

  function hydrateAvatarImg(img) {
    if (!img || !getStore()) return;
    var st = getStore();
    var cid = img.getAttribute('data-avatar-contact');
    var chatId = img.getAttribute('data-avatar-chat') || '';
    if (!chatId) {
      var row = img.closest('[data-chat-id]');
      if (row) chatId = row.getAttribute('data-chat-id') || '';
    }
    if (cid) {
      var contact = st.findContact(cid);
      if (!contact) return;
      var name = contact.remarkName || contact.name || '?';
      bindAvatarImg(img, contact, name, chatId);
      return;
    }
    var mid = img.getAttribute('data-mq-mid');
    if (mid) {
      var member = st.findContact(mid);
      if (!member) return;
      bindAvatarImg(img, member, member.remarkName || member.name || '?');
    }
  }

  function observeLazyAvatars(root) {
    var obs = getAvatarLazyObserver();
    if (!obs || !root) {
      root.querySelectorAll('img[data-avatar-contact], img[data-mq-mid]').forEach(hydrateAvatarImg);
      return;
    }
    root.querySelectorAll('img[data-avatar-contact], img[data-mq-mid]').forEach(function (img) {
      obs.observe(img);
    });
  }

  function hydrateAvatarsIn(root) {
    if (!root || !getStore()) return;
    var st = getStore();
    var run = function () {
      observeLazyAvatars(root);
      root.querySelectorAll('[data-mq-group-avatar]').forEach(function (img) {
        var chatId = img.getAttribute('data-mq-chat-id');
        if (!chatId || !global.MiyaChatGroup) return;
        var chat = st.findChat(chatId);
        if (!chat) return;
        global.MiyaChatGroup.resolveGroupAvatarUrlAsync(st, chatId).then(function (url) {
          if (url) img.src = url;
        });
      });
    };
    var chain = Promise.resolve();
    if (global.miyaContactsStore && typeof global.miyaContactsStore.whenReady === 'function') {
      chain = chain.then(function () { return global.miyaContactsStore.whenReady(); });
    }
    chain.then(run);
  }

  function buildContactSearchBlob(contact, archiveRow) {
    var parts = [
      contact.name,
      contact.remarkName,
      contact.relationship
    ];
    if (archiveRow) {
      parts.push(archiveRow.name, archiveRow.persona, archiveRow.gender, archiveRow.age);
      if (Array.isArray(archiveRow.tags)) parts.push(archiveRow.tags.join(' '));
    }
    return parts.join(' ').toLowerCase();
  }

  function collectSearchableContacts() {
    var st = getStore();
    var cs = global.miyaContactsStore;
    if (!st) return [];

    var results = [];
    var seenArchiveIds = {};
    var lookup = st.buildContactsTabLookup ? st.buildContactsTabLookup() : null;
    var chatByContact = lookup && lookup.chatByContact ? lookup.chatByContact : null;

    (st.getContacts('all') || []).forEach(function (contact) {
      var archiveRow = null;
      if (cs && contact.chronicleId && cs.findCharacter) {
        archiveRow = cs.findCharacter(contact.chronicleId);
      }
      var chat = chatByContact ? chatByContact[contact.id] : st.findChatByContact(contact.id);
      var name = contact.remarkName || contact.name || (archiveRow && archiveRow.name) || '未命名';
      var sub = (archiveRow && archiveRow.persona) || contact.relationship || '';
      results.push({
        contactId: contact.id,
        chatId: chat ? chat.id : '',
        archiveId: contact.chronicleId || '',
        name: name,
        sub: sub,
        avatar: resolveContactAvatarUrl(contact) || findArchiveAvatar(contact) || (archiveRow && archiveRow.avatar) || '',
        avatarContactId: contact.id,
        searchBlob: buildContactSearchBlob(contact, archiveRow)
      });
      if (contact.chronicleId) seenArchiveIds[contact.chronicleId] = true;
    });

    if (cs && cs.getState) {
      var archive = cs.getState();
      (archive.characters || []).forEach(function (ch) {
        if (seenArchiveIds[ch.id]) return;
        results.push({
          contactId: '',
          chatId: '',
          archiveId: ch.id,
          name: ch.name || '未命名',
          sub: ch.persona || '',
          avatar: ch.avatar || '',
          avatarContactId: '',
          searchBlob: [ch.name, ch.persona, ch.gender, ch.age, (ch.tags || []).join(' ')].join(' ').toLowerCase()
        });
      });
    }

    return results;
  }

  function filterContactsByQuery(query) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    return collectSearchableContacts().filter(function (row) {
      return row.searchBlob.indexOf(q) >= 0;
    });
  }

  function renderMsgSearch() {
    var box = $('qq-msg-search-results');
    var list = $('qq-chat-list');
    if (!box || !list) return;

    var q = msgSearchQuery.trim();
    if (!q) {
      box.hidden = true;
      box.innerHTML = '';
      list.hidden = false;
      return;
    }

    var hits = filterContactsByQuery(q);
    list.hidden = true;
    box.hidden = false;

    if (!hits.length) {
      box.innerHTML = '<div class="qq-search-empty">没有找到「' + esc(q) + '」相关联系人</div>';
      return;
    }

    box.innerHTML = hits.map(function (row) {
      var avaAttr = row.avatarContactId
        ? ' data-avatar-contact="' + esc(row.avatarContactId) + '"'
        : '';
      var avaSrc = row.avatarContactId
        ? avatarFallback(row.name)
        : (row.avatar || avatarFallback(row.name));
      return '<button type="button" class="qq-contact-row qq-search-hit"' +
        (row.chatId ? ' data-chat-id="' + esc(row.chatId) + '"' : '') +
        (row.contactId ? ' data-contact-id="' + esc(row.contactId) + '"' : '') +
        (row.archiveId ? ' data-archive-id="' + esc(row.archiveId) + '"' : '') + '>' +
        '<img class="qq-contact-row__ava" src="' + avaSrc + '" alt=""' + avaAttr + '>' +
        '<span class="qq-contact-row__main">' +
          '<span class="qq-contact-row__name">' + esc(row.name) + '</span>' +
          (row.sub ? '<span class="qq-contact-row__sub">' + esc(String(row.sub).slice(0, 48)) + '</span>' : '') +
        '</span>' +
        '<span class="qq-contact-row__chevron">›</span>' +
      '</button>';
    }).join('');
    hydrateAvatarsIn(box);
  }

  function buildGroupListAvatar(chat, st, name) {
    var gg = global.MiyaChatGroup;
    if (gg && typeof gg.renderGroupListAvatarHtml === 'function') {
      return gg.renderGroupListAvatarHtml(st, chat, function (c) {
        return avatarUrlCache[c.id] || c.avatar || avatarFallback(c.name || name);
      });
    }
    return '<img class="qq-chat-item__ava soft-thread__ava" src="' + avatarFallback(name) + '" alt="">';
  }

  function buildSoftChatItem(chat, contact, idx) {
    var st = getStore();
    var isGrp = isGroupChat(chat);
    var name = isGrp ? (chat.title || '群聊') : ((contact && (contact.remarkName || contact.name)) || chat.title || '未命名');
    var preview = String(chat.lastPreview || '').slice(0, 48) || (isGrp ? '点击进入群聊' : '点击开始聊天');
    var time = formatListTime(chat.lastAt);
    var badge = chat.unread > 99 ? '99+' : (chat.unread > 0 ? String(chat.unread) : '');
    var avaHtml = isGrp
      ? buildGroupListAvatar(chat, st, name)
      : '<img class="soft-thread__ava qq-chat-item__ava" src="' + avatarFallback(name) + '" alt="" loading="lazy" decoding="async"' +
        (contact ? ' data-avatar-contact="' + esc(contact.id) + '"' : '') +
        ' data-avatar-chat="' + esc(chat.id) + '">';
    var pinned = !!(contact && contact.pinned);
    var unreadCls = badge ? ' is-unread' : '';
    return '<button type="button" class="soft-thread qq-chat-item' + unreadCls + (pinned ? ' qq-chat-item--pinned' : '') + (isGrp ? ' qq-chat-item--group' : '') + '" data-chat-id="' + esc(chat.id) + '">' +
      '<div class="soft-thread__ava-wrap">' +
        avaHtml +
      '</div>' +
      '<div class="soft-thread__body">' +
        '<div class="soft-thread__row">' +
          '<span class="soft-thread__name qq-chat-item__name">' + esc(name) + '</span>' +
        '</div>' +
        '<p class="soft-thread__preview qq-chat-item__msg">' + esc(preview) + '</p>' +
      '</div>' +
      '<div class="soft-thread__aside">' +
        (time ? '<time class="soft-thread__time">' + esc(time) + '</time>' : '') +
        (badge ? '<span class="soft-thread__badge qq-chat-item__badge">' + esc(badge) + '</span>' : '') +
      '</div>' +
    '</button>';
  }

  function buildChatSwipeWrap(chat, contact, itemInner) {
    var canPin = !!(contact && chat.type !== 'group');
    if (!canPin) return itemInner;
    var pinned = !!(contact && contact.pinned);
    var pinBtn = '<button type="button" class="qq-chat-swipe__act' + (pinned ? ' is-active' : '') + '" data-chat-pin aria-label="' + (pinned ? '取消置顶' : '置顶') + '">' +
      (pinned ? '取消' : '置顶') + '</button>';
    return '<div class="qq-chat-swipe' + (pinned ? ' is-pinned' : '') + '" data-chat-swipe data-chat-id="' + esc(chat.id) + '" data-contact-id="' + esc(contact.id) + '">' +
      '<div class="qq-chat-swipe__actions" aria-hidden="true">' + pinBtn + '</div>' +
      '<div class="qq-chat-swipe__main">' + itemInner + '</div>' +
    '</div>';
  }

  function renderChats() {
    var list = $('qq-chat-list');
    if (!list) return;
    var st = getStore();
    if (!st) {
      list.innerHTML = '<div class="qq-chat-empty">加载中…</div>';
      return;
    }
    if (msgSearchQuery.trim()) {
      renderMsgSearch();
      return;
    }
    var box = $('qq-msg-search-results');
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
    list.hidden = false;
    var prevAvatars = captureAvatarSrcMap(list);
    Object.keys(prevAvatars).forEach(function (key) {
      avatarUrlCache[key] = prevAvatars[key];
    });
    var chats = st.getChats('all');
    if (!chats.length) {
      list.innerHTML = '<div class="qq-chat-empty">暂无会话<br><span>在「联系人」档案中添加角色后会自动出现</span></div>';
      return;
    }
    list.innerHTML = chats.map(function (chat, idx) {
      var contact = st.findContact(chat.contactId);
      var itemInner = buildSoftChatItem(chat, contact, idx);
      return buildChatSwipeWrap(chat, contact, itemInner);
    }).join('');
    hydrateAvatarsIn(list);
    bindChatListSwipe(list);
    updateMsgHeadMeta();
  }

  function closeChatSwipe(except) {
    if (!chatSwipeOpen || chatSwipeOpen === except) return;
    chatSwipeOpen.classList.remove('is-open');
    var main = chatSwipeOpen.querySelector('.qq-chat-swipe__main');
    if (main) main.style.transform = '';
    chatSwipeOpen = null;
  }

  function setChatSwipeOffset(wrap, offset) {
    var main = wrap && wrap.querySelector('.qq-chat-swipe__main');
    if (!main) return;
    var x = Math.max(-CHAT_SWIPE_ACTION_W, Math.min(0, offset));
    main.style.transform = x ? 'translateX(' + x + 'px)' : '';
    if (x <= -CHAT_SWIPE_ACTION_W * 0.45) wrap.classList.add('is-open');
    else wrap.classList.remove('is-open');
  }

  function snapChatSwipe(wrap, open) {
    if (!wrap) return;
    var main = wrap.querySelector('.qq-chat-swipe__main');
    if (open) {
      closeChatSwipe(wrap);
      wrap.classList.add('is-open');
      if (main) main.style.transform = 'translateX(-' + CHAT_SWIPE_ACTION_W + 'px)';
      chatSwipeOpen = wrap;
    } else {
      wrap.classList.remove('is-open');
      if (main) main.style.transform = '';
      if (chatSwipeOpen === wrap) chatSwipeOpen = null;
    }
  }

  function updateChatListPinState(chatId, pinned) {
    var list = $('qq-chat-list');
    if (!list || !chatId) return false;
    var escId = String(chatId).replace(/"/g, '\\"');
    var wrap = list.querySelector('[data-chat-swipe][data-chat-id="' + escId + '"]');
    if (!wrap) return false;
    var item = wrap.querySelector('.qq-chat-item');
    var pinBtn = wrap.querySelector('[data-chat-pin]');
    wrap.classList.toggle('is-pinned', pinned);
    wrap.classList.remove('is-open');
    var main = wrap.querySelector('.qq-chat-swipe__main');
    if (main) main.style.transform = '';
    if (item) item.classList.toggle('qq-chat-item--pinned', pinned);
    if (pinBtn) {
      pinBtn.classList.toggle('is-active', pinned);
      pinBtn.setAttribute('aria-label', pinned ? '取消置顶' : '置顶');
      pinBtn.textContent = pinned ? '取消' : '置顶';
    }
    return true;
  }

  function reorderChatListDom() {
    var list = $('qq-chat-list');
    var st = getStore();
    if (!list || !st) return false;
    var chats = st.getChats('all');
    var missing = false;
    chats.forEach(function (chat, idx) {
      var escId = String(chat.id || '').replace(/"/g, '\\"');
      var wrap = list.querySelector('[data-chat-swipe][data-chat-id="' + escId + '"]');
      if (!wrap) {
        missing = true;
        return;
      }
      list.appendChild(wrap);
    });
    if (missing) {
      renderChats();
      return false;
    }
    return true;
  }

  function toggleChatPin(wrap) {
    var st = getStore();
    if (!st || !wrap) return;
    var contactId = wrap.getAttribute('data-contact-id');
    var chatId = wrap.getAttribute('data-chat-id');
    var contact = st.findContact(contactId);
    if (!contact) return;
    var nextPinned = !contact.pinned;
    st.updateContact(contact.id, { pinned: nextPinned }).then(function () {
      closeChatSwipe();
      if (!updateChatListPinState(chatId, nextPinned) || !reorderChatListDom()) {
        renderChats();
      }
      updateMsgHeadMeta();
      toast(nextPinned ? '已置顶' : '已取消置顶');
    }).catch(function () {
      toast('操作失败');
    });
  }

  function bindChatListSwipe(list) {
    if (!list || list.dataset.swipeBound) return;
    list.dataset.swipeBound = '1';

    list.addEventListener('click', function (e) {
      var pinBtn = e.target.closest('[data-chat-pin]');
      if (pinBtn) {
        e.preventDefault();
        e.stopPropagation();
        toggleChatPin(pinBtn.closest('[data-chat-swipe]'));
        return;
      }
      var wrap = e.target.closest('[data-chat-swipe]');
      if (wrap && wrap.classList.contains('is-open') && !e.target.closest('[data-chat-pin]')) {
        var main = wrap.querySelector('.qq-chat-swipe__main');
        if (main && main.contains(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          snapChatSwipe(wrap, false);
        }
      }
    });

    function onStart(clientX, wrap) {
      if (!wrap) return;
      closeChatSwipe(wrap);
      chatSwipeDrag = {
        wrap: wrap,
        startX: clientX,
        startOffset: wrap.classList.contains('is-open') ? -CHAT_SWIPE_ACTION_W : 0,
        moved: false
      };
    }

    function onMove(clientX) {
      if (!chatSwipeDrag) return;
      var dx = clientX - chatSwipeDrag.startX;
      if (Math.abs(dx) > 6) chatSwipeDrag.moved = true;
      setChatSwipeOffset(chatSwipeDrag.wrap, chatSwipeDrag.startOffset + dx);
    }

    function onEnd() {
      if (!chatSwipeDrag) return;
      var wrap = chatSwipeDrag.wrap;
      var open = wrap.classList.contains('is-open');
      snapChatSwipe(wrap, open);
      if (chatSwipeDrag.moved) wrap.dataset.swipeMoved = '1';
      else delete wrap.dataset.swipeMoved;
      chatSwipeDrag = null;
    }

    list.addEventListener('touchstart', function (e) {
      var wrap = e.target.closest('[data-chat-swipe]');
      if (!wrap || e.target.closest('[data-chat-pin]')) return;
      onStart(e.touches[0].clientX, wrap);
    }, { passive: true });

    list.addEventListener('touchmove', function (e) {
      if (!chatSwipeDrag) return;
      onMove(e.touches[0].clientX);
    }, { passive: true });

    list.addEventListener('touchend', onEnd);
    list.addEventListener('touchcancel', onEnd);

    list.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var wrap = e.target.closest('[data-chat-swipe]');
      if (!wrap || e.target.closest('[data-chat-pin]')) return;
      onStart(e.clientX, wrap);
      function mm(ev) { onMove(ev.clientX); }
      function mu() {
        onEnd();
        document.removeEventListener('mousemove', mm);
        document.removeEventListener('mouseup', mu);
      }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
  }

  function getContactSortLetter(name) {
    var n = String(name || '').trim();
    if (!n) return '#';
    var ch = n.charAt(0);
    if (/[A-Za-z]/.test(ch)) return ch.toUpperCase();
    if (/[\u4e00-\u9fff]/.test(ch)) return ch;
    return '#';
  }

  function showGroupCreatePicker() {
    var app = $('miya-chat-app');
    if (!app) return;
    var st = getStore();
    if (!st) return;
    var profiles = st.getProfiles();
    if (!profiles.length) {
      toast('请先创建面具');
      return;
    }
    var old = $('mq-grp-picker');
    if (old) old.remove();

    var step = 'profile';
    var pickedProfileId = '';
    var selected = {};

    var el = document.createElement('div');
    el.id = 'mq-grp-picker';
    el.className = 'mq-grp-picker is-open';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');

    function closePicker() {
      el.remove();
    }

    function profileRows() {
      return profiles.map(function (p, i) {
        return '<button type="button" class="mq-grp-pick-row mq-grp-pick-row--profile" data-mq-grp-profile="' + esc(p.id) + '" style="--mq-i:' + i + '">' +
          '<span class="mq-grp-pick-mark" aria-hidden="true"></span>' +
          '<span class="mq-grp-pick-ava">' + esc(Array.from(p.name || '我')[0] || '我') + '</span>' +
          '<span class="mq-grp-pick-copy">' +
            '<span class="mq-grp-pick-name">' + esc(p.name || '未命名') + '</span>' +
            '<span class="mq-grp-pick-sub">选择此面具身份建群</span>' +
          '</span>' +
        '</button>';
      }).join('');
    }

    function memberRows() {
      var bound = contactsBoundToProfile(st, pickedProfileId);
      if (!bound.length) {
        return '<div class="mq-grp-picker-empty">该面具下暂无绑定联系人<br><span>请先在单聊设置中为角色绑定此面具</span></div>';
      }
      return bound.map(function (c, i) {
        return '<button type="button" class="mq-grp-pick-row" data-mq-grp-pick="' + esc(c.id) + '" style="--mq-i:' + i + '" aria-pressed="false">' +
          '<span class="mq-grp-pick-mark" aria-hidden="true"></span>' +
          '<img class="mq-grp-pick-img" src="' + avatarFallback(c.remarkName || c.name) + '" alt="" loading="lazy" decoding="async" data-avatar-contact="' + esc(c.id) + '">' +
          '<span class="mq-grp-pick-name">' + esc(c.remarkName || c.name) + '</span>' +
        '</button>';
      }).join('');
    }

    function renderSheet() {
      if (step === 'profile') {
        el.innerHTML =
          '<div class="mq-grp-picker__sheet">' +
            '<button type="button" class="mq-grp-picker__close" data-mq-grp-close aria-label="关闭">×</button>' +
            '<header class="mq-grp-picker__head">' +
              '<span class="mq-grp-picker__kicker">STEP 01</span>' +
              '<h2 class="mq-grp-picker__title">选择面具</h2>' +
              '<p class="mq-grp-picker__hint">先确定你在群里的身份</p>' +
            '</header>' +
            '<div class="mq-grp-picker__list">' + profileRows() + '</div>' +
          '</div>';
        return;
      }
      var profile = profiles.find(function (p) { return p.id === pickedProfileId; });
      var hint = '点选至少 2 位成员 · 已选 ' + Object.keys(selected).length + ' 人';
      el.innerHTML =
        '<div class="mq-grp-picker__sheet">' +
          '<button type="button" class="mq-grp-picker__close" data-mq-grp-close aria-label="关闭">×</button>' +
          '<header class="mq-grp-picker__head">' +
            '<span class="mq-grp-picker__kicker">STEP 02 · ' + esc(profile && profile.name || '面具') + '</span>' +
            '<h2 class="mq-grp-picker__title">选择成员</h2>' +
            '<p class="mq-grp-picker__hint" id="mq-grp-picker-hint">' + esc(hint) + '</p>' +
          '</header>' +
          '<div class="mq-grp-picker__list">' + memberRows() + '</div>' +
          '<div class="mq-grp-picker__title-field">' +
            '<label for="mq-grp-title">群名称</label>' +
            '<input type="text" id="mq-grp-title" class="mq-grp-picker__input" placeholder="例如：午后茶会" maxlength="32">' +
          '</div>' +
          '<div class="mq-grp-picker__actions">' +
            '<button type="button" class="mq-grp-picker__back" data-mq-grp-back>换面具</button>' +
            '<button type="button" class="mq-grp-picker__go" data-mq-grp-go>创建并进入</button>' +
          '</div>' +
        '</div>';
      hydrateAvatarsIn(el);
    }

    function syncPickUi() {
      var hint = $('mq-grp-picker-hint');
      if (hint) hint.textContent = '点选至少 2 位成员 · 已选 ' + Object.keys(selected).length + ' 人';
      el.querySelectorAll('[data-mq-grp-pick]').forEach(function (btn) {
        var id = btn.getAttribute('data-mq-grp-pick');
        var on = !!selected[id];
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    renderSheet();
    app.appendChild(el);

    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (ev.target.closest('[data-mq-grp-close]') || ev.target === el) {
        ev.preventDefault();
        closePicker();
        return;
      }
      if (step === 'profile') {
        var profBtn = ev.target.closest('[data-mq-grp-profile]');
        if (profBtn) {
          ev.preventDefault();
          pickedProfileId = profBtn.getAttribute('data-mq-grp-profile');
          var bound = contactsBoundToProfile(st, pickedProfileId);
          if (bound.length < 2) {
            toast('该面具下绑定联系人不足 2 人');
            return;
          }
          step = 'member';
          selected = {};
          renderSheet();
        }
        return;
      }
      var row = ev.target.closest('[data-mq-grp-pick]');
      if (row) {
        ev.preventDefault();
        var id = row.getAttribute('data-mq-grp-pick');
        if (selected[id]) delete selected[id];
        else selected[id] = true;
        syncPickUi();
        return;
      }
      if (ev.target.closest('[data-mq-grp-back]')) {
        ev.preventDefault();
        step = 'profile';
        selected = {};
        renderSheet();
        return;
      }
      if (ev.target.closest('[data-mq-grp-go]')) {
        ev.preventDefault();
        var ids = Object.keys(selected);
        if (ids.length < 2) {
          toast('请至少选择 2 位成员');
          return;
        }
        var titleInp = $('mq-grp-title');
        var title = titleInp ? String(titleInp.value || '').trim() : '';
        if (!title) {
          var names = ids.map(function (id) {
            var c = st.findContact(id);
            return c ? (c.remarkName || c.name) : '';
          }).filter(Boolean).slice(0, 3);
          title = names.join('、') + (ids.length > 3 ? ' 等' : '');
        }
        st.createGroupChat({
          memberIds: ids,
          title: title,
          profileId: pickedProfileId
        }).then(function (ch) {
          closePicker();
          refreshLists();
          toast('群聊已创建');
          openChatById(ch.id);
        }).catch(function () {
          toast('创建失败');
        });
      }
    });
  }

  function renderStoryRow(el, contacts, compact) {
    if (!el) return;
    var selfStory = !compact
      ? '<button type="button" class="soft-story soft-story--self" aria-label="你的快拍">' +
          '<div class="soft-story__ring soft-story__ring--new">' +
            '<span class="soft-story__add" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5"/></svg>' +
            '</span>' +
          '</div>' +
          '<span class="soft-story__label">你的快拍</span>' +
        '</button>'
      : '';
    if (!contacts.length) {
      el.innerHTML = selfStory;
      return;
    }
    el.innerHTML = selfStory + contacts.map(function (c, i) {
      var name = c.remarkName || c.name || '?';
      var avaAttr = ' data-avatar-contact="' + esc(c.id) + '"';
      var ringCls = i === 0 ? ' soft-story__ring--new' : '';
      return '<button type="button" class="soft-story" data-contact-id="' + esc(c.id) + '">' +
        '<div class="soft-story__ring' + ringCls + '">' +
          '<img class="soft-story__ava" src="' + avatarFallback(name) + '" alt=""' + avaAttr + '>' +
        '</div>' +
        '<span class="soft-story__label">' + esc(String(name).slice(0, 6)) + '</span>' +
      '</button>';
    }).join('');
    hydrateAvatarsIn(el);
  }

  function renderContactsTab() {
    var groupsEl = $('qq-group-list');
    var alphaEl = $('soft-contacts-alpha');
    var subEl = $('soft-contacts-sub');
    var starEl = $('soft-contacts-star-row');
    var cs = global.miyaContactsStore;
    var st = getStore();
    var gen = ++contactsRenderGen;

    if (!groupsEl) return;
    if (!cs || !st) {
      groupsEl.innerHTML = '<div class="soft-contacts-empty">加载中…</div>';
      if (alphaEl) alphaEl.innerHTML = '';
      if (starEl) starEl.innerHTML = '';
      return;
    }

    var archive = cs.getState();
    var characters = archive.characters || [];
    var groupNameById = Object.create(null);
    (archive.groups || []).forEach(function (g) {
      if (g && g.id) groupNameById[g.id] = g.name || '';
    });
    var lookup = st.buildContactsTabLookup ? st.buildContactsTabLookup() : null;

    if (!characters.length) {
      groupsEl.innerHTML = '<div class="soft-contacts-empty">档案中暂无角色<span>去「联系人」应用创建档案</span></div>';
      if (alphaEl) alphaEl.innerHTML = '';
      if (starEl) starEl.innerHTML = '';
      if (subEl) subEl.textContent = '0 位联系人';
      return;
    }

    if (subEl) subEl.textContent = characters.length + ' 位联系人';

    var pinnedContacts = (st.getContacts ? st.getContacts() : []).filter(function (c) { return c.pinned; });
    renderStoryRow(starEl, pinnedContacts.slice(0, 8), true);

    var byLetter = Object.create(null);
    characters.forEach(function (ch) {
      var letter = getContactSortLetter(ch.name);
      if (!byLetter[letter]) byLetter[letter] = [];
      byLetter[letter].push(ch);
    });

    var letters = Object.keys(byLetter).sort(function (a, b) {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b, 'zh-CN');
    });

    if (alphaEl) {
      alphaEl.innerHTML = letters.map(function (letter, i) {
        return '<button type="button" class="soft-alpha-tag' + (i === 0 ? ' is-active' : '') + '" data-soft-alpha="' + esc(letter) + '">' + esc(letter) + '</button>';
      }).join('');
    }

    function resolveChatContact(ch) {
      if (!lookup) {
        return st.findContactByArchiveCharacter ? st.findContactByArchiveCharacter(ch) : null;
      }
      var key = String(ch.id || '').trim();
      if (key && lookup.byChronicle[key]) return lookup.byChronicle[key];
      var cid = String(ch.characterId || ch.id || '').trim();
      if (cid && lookup.byCharacterId[cid]) return lookup.byCharacterId[cid];
      return null;
    }

    var num = 0;
    var htmlParts = letters.map(function (letter) {
      var members = byLetter[letter].slice().sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      });
      var rows = members.map(function (ch) {
        num += 1;
        var chatContact = resolveChatContact(ch);
        var chatId = '';
        if (chatContact && lookup && lookup.chatByContact) {
          var chat = lookup.chatByContact[chatContact.id];
          if (chat) chatId = chat.id;
        } else if (chatContact && st.findChatByContact) {
          var chatFallback = st.findChatByContact(chatContact.id);
          if (chatFallback) chatId = chatFallback.id;
        }
        var avaAttr = chatContact ? ' data-avatar-contact="' + esc(chatContact.id) + '"' : '';
        var note = String(ch.persona || '').trim().slice(0, 32);
        if (!note) note = groupNameById[ch.groupId] || '';
        return '<button type="button" class="soft-contact-item qq-contact-row" data-num="' + String(num).padStart(3, '0') + '"' +
          ' data-archive-id="' + esc(ch.id) + '"' +
          (chatContact ? ' data-contact-id="' + esc(chatContact.id) + '"' : '') +
          (chatId ? ' data-chat-id="' + esc(chatId) + '"' : '') + '>' +
          '<img class="soft-contact-item__ava" src="' + avatarFallback(ch.name) + '" alt="" loading="lazy" decoding="async"' + avaAttr + '>' +
          '<div class="soft-contact-item__info">' +
            '<div class="soft-contact-item__name">' + esc(ch.name) + '</div>' +
            (note ? '<div class="soft-contact-item__note">' + esc(note) + '</div>' : '') +
          '</div>' +
        '</button>';
      }).join('');
      return '<div class="soft-contact-group" id="soft-alpha-' + esc(letter) + '" data-soft-group="' + esc(letter) + '">' +
        '<div class="soft-contact-group__letter">' + esc(letter) + '</div>' +
        '<div class="soft-contact-group__list">' + rows + '</div>' +
      '</div>';
    });

    if (characters.length > 80) {
      groupsEl.innerHTML = '';
      var partIdx = 0;
      var chunkSize = (document.documentElement && document.documentElement.classList.contains('is-low-end')) ? 2 : 4;
      function appendGroups() {
        if (gen !== contactsRenderGen) return;
        var slice = htmlParts.slice(partIdx, partIdx + chunkSize);
        if (!slice.length) {
          hydrateAvatarsIn(groupsEl);
          return;
        }
        groupsEl.insertAdjacentHTML('beforeend', slice.join(''));
        partIdx += chunkSize;
        requestAnimationFrame(appendGroups);
      }
      requestAnimationFrame(appendGroups);
    } else {
      groupsEl.innerHTML = htmlParts.join('');
      hydrateAvatarsIn(groupsEl);
    }
  }

  function renderFeed(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var list = $('qq-feed-list');
    var storiesEl = $('soft-stories-row');
    if (!list) return;

    if (opts.postId) {
      if (global.MiyaChatMoments && typeof global.MiyaChatMoments.renderFeedInto === 'function') {
        global.MiyaChatMoments.renderFeedInto(list, null, opts);
      }
      return;
    }

    var st = getStore();
    var contacts = st && st.getContacts ? st.getContacts() : [];
    renderStoryRow(storiesEl, contacts.slice(0, 8), false);

    if (global.MiyaChatMoments && typeof global.MiyaChatMoments.renderFeedInto === 'function') {
      var mm = global.MiyaChatMoments;
      var renderMm = function () { mm.renderFeedInto(list, null); };
      if (mm.whenReady) mm.whenReady().then(renderMm).catch(renderMm);
      else renderMm();
    } else {
      list.innerHTML =
        '<div class="mm-feed-card mm-feed-card--empty">' +
          '<p class="mm-feed-card__empty-tip">动态加载中…</p>' +
        '</div>';
    }
  }

  function updateMsgHeadMeta() {
    /* 软刊风顶栏无副标题槽，保留空实现供刷新链调用 */
  }

  function resolveProfileAvatar(profile, cb) {
    if (!profile) { cb(avatarFallback('我')); return; }
    var st = getStore();
    if (st && typeof st.resolveProfileDisplayAvatarSync === 'function') {
      var displaySync = st.resolveProfileDisplayAvatarSync(profile);
      if (displaySync) { cb(displaySync); return; }
    }
    if (st && typeof st.hasProfileDisplayAvatarOverride === 'function' && st.hasProfileDisplayAvatarOverride(profile)) {
      if (st.resolveProfileDisplayAvatarAsync) {
        st.resolveProfileDisplayAvatarAsync(profile).then(function (url) {
          cb(url || avatarFallback(profile.name));
        });
        return;
      }
      cb(avatarFallback(profile.name));
      return;
    }
    if (profile.avatarUrl) { cb(profile.avatarUrl); return; }
    if (profile.avatarId && getStore() && getStore().getAvatarUrl) {
      getStore().getAvatarUrl(profile.avatarId).then(function (url) {
        cb(url || avatarFallback(profile.name));
      });
      return;
    }
    cb(avatarFallback(profile.name));
  }

  function hydrateProfileAvatars() {
    var st = getStore();
    var profile = st && st.getActiveProfile ? st.getActiveProfile() : null;
    var name = (profile && profile.name) || '我';
    var app = $('miya-chat-app');
    if (!app) return;

    var mineName = app.querySelector('.qq-mine-profile__name');
    if (mineName) mineName.textContent = name;
    var mineId = app.querySelector('.qq-mine-profile__id');
    if (mineId) {
      var sub = profile && profile.name ? ('@' + String(profile.name).replace(/\s+/g, '.').toLowerCase()) : '面具 · 未命名';
      if (profile && st.getWallet && global.MiyaChatWallet) {
        var w = st.getWallet(profile.id);
        sub += ' · ' + global.MiyaChatWallet.formatDisplay(w.balance);
      }
      mineId.textContent = sub;
    }

    resolveProfileAvatar(profile, function (url) {
      var mineImg = $('soft-me-avatar-img') || app.querySelector('.qq-mine-profile__ava');
      if (mineImg) {
        mineImg.src = url || avatarFallback(name);
        mineImg.alt = name;
        mineImg.onerror = function () {
          mineImg.onerror = null;
          mineImg.src = avatarFallback(name);
        };
      }
      var fgTabAva = $('fg-tabbar-avatar-img');
      if (fgTabAva) {
        fgTabAva.src = url || avatarFallback(name);
        fgTabAva.alt = name;
        fgTabAva.onerror = function () {
          fgTabAva.onerror = null;
          fgTabAva.src = avatarFallback(name);
        };
      }
    });

    var fgGreeting = $('fg-greeting-name');
    if (fgGreeting) fgGreeting.textContent = name;

    hydrateSoftUiTexts();

    var data = readSoftUi();
    var cs = global.miyaContactsStore;
    var charCount = cs && cs.getState ? (cs.getState().characters || []).length : 0;
    var fgFriends = $('fg-friends-count');
    if (fgFriends) fgFriends.textContent = String(charCount);
    var chatCount = st && st.getChats ? st.getChats('all').length : 0;
    var statContacts = $('soft-stat-contacts');
    var statFollowing = $('soft-stat-following');
    var statMoments = $('soft-stat-moments');
    if (statFollowing && data.following == null) statFollowing.textContent = String(chatCount);
    if (statContacts && data.fans == null) statContacts.textContent = String(charCount);
    if (statMoments && data.likes == null) statMoments.textContent = '0';
  }

  var SOFT_MENU_ICONS = {
    favorites: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
    album: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    files: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    wallpapers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15l4-4 4 4 5-6 4 5"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="16" cy="14" r="1" fill="currentColor"/></svg>',
    emoji: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.2 1.8c0 1.8-2.2 2.2-2.2 3.7" stroke-linecap="round"/><circle cx="12" cy="17" r="0.5" fill="currentColor"/></svg>',
    about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 11v5" stroke-linecap="round"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/></svg>',
    dress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" stroke-linejoin="round"/></svg>'
  };

  function isInsWhiteTheme() {
    var app = document.getElementById('miya-chat-app');
    return !!(app && app.classList.contains('chat-bf-theme-ins-white'));
  }

  function isFreshGreenTheme() {
    var app = document.getElementById('miya-chat-app');
    return !!(app && app.classList.contains('chat-bf-theme-fresh-green'));
  }

  function buildMineMenuHtml() {
    if (isFreshGreenTheme()) {
      var fgItems = [
        { title: '收藏', action: 'favorites', icon: 'favorites' },
        { title: '相册', action: 'album', icon: 'album' },
        { title: '表情', action: 'dress', icon: 'emoji', grid: true },
        { title: '钱包', action: 'wallet', icon: 'wallet' },
        { title: '设置', action: 'settings', icon: 'settings', mine: true },
        { title: '帮助', action: 'settings', icon: 'help', mine: true },
        { title: '壁纸管理', action: 'wallpapers', icon: 'wallpapers' },
        { title: '装扮', action: 'dress-app', icon: 'dress', grid: true }
      ];
      return fgItems.map(function (item) {
        var attrs = item.mine
          ? ' data-mine-action="settings"'
          : (item.grid ? ' data-mq-mine-grid="' + item.action + '"' : ' data-mq-mine-action="' + item.action + '"');
        return '<div class="soft-menu__item"' + attrs + '>' +
          '<span class="soft-menu__item-icon">' + (SOFT_MENU_ICONS[item.icon] || '') + '</span>' +
          '<span class="soft-menu__item-title">' + esc(item.title) + '</span>' +
          '<span class="soft-menu__item-arrow">›</span>' +
        '</div>';
      }).join('');
    }
    var items = isInsWhiteTheme() ? [
      { title: '收藏', action: 'favorites', icon: 'favorites' },
      { title: '相册', action: 'album', icon: 'album' },
      { title: '壁纸管理', action: 'wallpapers', icon: 'wallpapers' },
      { title: '卡包', action: 'wallet', icon: 'wallet' },
      { title: '表情', action: 'dress', icon: 'emoji', grid: true },
      { title: '帮助与反馈', action: 'settings', icon: 'settings', mine: true }
    ] : [
      { title: '我的收藏', action: 'favorites', icon: 'favorites' },
      { title: '我的相册', action: 'album', icon: 'album' },
      { title: '壁纸管理', action: 'wallpapers', icon: 'wallpapers' },
      { title: '我的钱包', action: 'wallet', icon: 'wallet' },
      { title: '表情管理', action: 'dress', icon: 'emoji', grid: true },
      { title: '设置', action: 'settings', icon: 'settings', mine: true }
    ];
    return items.map(function (item) {
      var attrs = item.mine
        ? ' data-mine-action="settings"'
        : (item.grid ? ' data-mq-mine-grid="' + item.action + '"' : ' data-mq-mine-action="' + item.action + '"');
      return '<div class="soft-menu__item"' + attrs + '>' +
        '<span class="soft-menu__item-icon">' + (SOFT_MENU_ICONS[item.icon] || '') + '</span>' +
        '<span class="soft-menu__item-title">' + esc(item.title) + '</span>' +
        '<span class="soft-menu__item-arrow">›</span>' +
      '</div>';
    }).join('');
  }

  function renderMine() {
    var list = $('qq-mine-menu');
    if (list) list.innerHTML = buildMineMenuHtml();
    hydrateProfileAvatars();
  }

  function refreshMineMenu() {
    var list = $('qq-mine-menu');
    if (list) list.innerHTML = buildMineMenuHtml();
    if (currentTab === 'mine') hydrateProfileAvatars();
  }

  function hydrateMsgHead() {
    hydrateProfileAvatars();
    updateMsgHeadMeta();
  }

  function refreshProfileUI() {
    hydrateProfileAvatars();
    if (global.miyaChatRoom && typeof global.miyaChatRoom.refresh === 'function') {
      global.miyaChatRoom.refresh();
    }
  }

  function switchTab(tab) {
    if (!tab) return;
    var app = $('miya-chat-app');
    if (!app) return;
    var sameTab = currentTab === tab;
    currentTab = tab;
    app.querySelectorAll('.qq-page').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-qq-tab') === tab);
    });
    app.querySelectorAll('.qq-tabbar__item').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-qq-tab') === tab);
    });
    if (sameTab) return;
    var activePage = app.querySelector('.qq-page.is-active .qq-page__scroll');
    if (activePage) activePage.scrollTop = 0;
    if (tab === 'contacts') renderContactsTab();
    if (tab === 'msg') renderChats();
    if (tab === 'feed') renderFeed();
    if (tab === 'mine') renderMine();
    if (global.MiyaChatAppBeautify && global.MiyaChatAppBeautify.renderDecoLayer) {
      global.MiyaChatAppBeautify.renderDecoLayer();
    }
  }

  function onUiThemeChange(theme, prev) {
    applyChatBodyTheme();
    var el = $('miya-chat-app');
    if (!el || !el.classList.contains('is-open')) return;
    renderAll();
  }

  function clearMsgSearch() {
    msgSearchQuery = '';
    var input = $('qq-msg-search');
    if (input) input.value = '';
  }

  function openChatById(chatId, opts) {
    if (!chatId || !global.miyaChatRoom) return Promise.resolve();
    opts = opts && typeof opts === 'object' ? opts : {};
    clearMsgSearch();
    var app = $('miya-chat-app');
    if (app) app.classList.add('qq-room-open');

    function doOpen() {
      return global.miyaChatRoom.open(chatId, opts).catch(function () {
        if (app) app.classList.remove('qq-room-open');
        toast('无法打开会话');
      });
    }

    /* store 已就绪时立刻进房，不把点击堵在 ensureStore 微任务链上 */
    var st = getStore();
    if (st && typeof st.findChat === 'function' && st.findChat(chatId)) {
      ensureStore().catch(function () {});
      return doOpen();
    }
    return ensureStore().then(doOpen);
  }

  function openChatByContact(contactId) {
    var st = getStore();
    if (!st) return;
    var openOpts = { toBottom: true };
    var chat = st.findChatByContact(contactId);
    if (chat) {
      openChatById(chat.id, openOpts);
      return;
    }
    var contact = st.findContact ? st.findContact(contactId) : null;
    var app = $('miya-chat-app');
    if (app) app.classList.add('qq-room-open');
    if (global.miyaChatRoom && typeof global.miyaChatRoom.prepareShell === 'function') {
      global.miyaChatRoom.prepareShell(contact);
    }
    var profileId = (st.getActiveProfile && st.getActiveProfile()) ? st.getActiveProfile().id : null;
    st.createChat({ contactId: contactId, profileId: profileId })
      .then(function (ch) { openChatById(ch.id, openOpts); })
      .catch(function () {
        if (app) app.classList.remove('qq-room-open');
        if (global.miyaChatRoom && typeof global.miyaChatRoom.close === 'function') {
          global.miyaChatRoom.close();
        }
        toast('创建会话失败');
      });
  }

  function openChatByArchiveId(archiveCharId) {
    var cs = global.miyaContactsStore;
    var st = getStore();
    if (!cs || !st) return;
    var row = cs.findCharacter(archiveCharId);
    if (!row) {
      toast('未找到该角色');
      return;
    }
    var sync = global.miyaChatContactsSync;
    var chain = sync && sync.syncOne
      ? sync.syncOne(archiveCharId)
      : Promise.resolve();
    chain.then(function () {
      var contact = st.findContactByArchiveCharacter
        ? st.findContactByArchiveCharacter(row)
        : null;
      if (!contact) {
        toast('同步联系人失败，请重试');
        renderContactsTab();
        renderChats();
        return;
      }
      openChatByContact(contact.id);
    });
  }

  function bindMsgSearch() {
    function onSearchInput(input) {
      msgSearchQuery = input.value || '';
      if (msgSearchQuery.trim()) renderMsgSearch();
      else renderChats();
    }
    var input = $('qq-msg-search');
    if (input && !input.dataset.searchBound) {
      input.dataset.searchBound = '1';
      input.addEventListener('input', function () { onSearchInput(input); });
    }
  }

  function bindAvatarHome(root) {
    if (!root) return;
    root.querySelectorAll('[data-qq-avatar-home]').forEach(function (el) {
      if (el.dataset.avatarHomeBound) return;
      el.dataset.avatarHomeBound = '1';
      el.style.cursor = 'pointer';
      el.addEventListener('click', closeToHome);
    });
  }

  function bindThemeTopbarHome(root) {
    if (!root) return;
    root.querySelectorAll('.soft-topbar__titles').forEach(function (el) {
      if (el.dataset.themeHomeBound) return;
      el.dataset.themeHomeBound = '1';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', '返回主屏幕');
      el.addEventListener('click', function (e) {
        if (!isInsWhiteTheme() && !isFreshGreenTheme()) return;
        e.stopPropagation();
        closeToHome();
      });
      el.addEventListener('keydown', function (e) {
        if (!isInsWhiteTheme() && !isFreshGreenTheme()) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        closeToHome();
      });
    });
  }

  function bindEvents() {
    var app = $('miya-chat-app');
    if (!app || app.dataset.chatBound) return;
    app.dataset.chatBound = '1';

    bindAvatarHome(app);
    bindThemeTopbarHome(app);
    bindMsgSearch();
    bindSoftMineInlineEdit();

    var backBtn = $('qq-app-back');
    if (backBtn) {
      backBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        closeToHome();
      });
    }

    app.querySelectorAll('.qq-tabbar__item[data-qq-tab]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var tab = btn.getAttribute('data-qq-tab');
        if (tab) switchTab(tab);
      });
    });

    app.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var chatBtn = t.closest('.qq-chat-item');
      if (chatBtn) {
        var swipeWrap = chatBtn.closest('[data-chat-swipe]');
        if (swipeWrap) {
          if (swipeWrap.classList.contains('is-open')) {
            e.preventDefault();
            snapChatSwipe(swipeWrap, false);
            return;
          }
          if (swipeWrap.dataset.swipeMoved === '1') {
            e.preventDefault();
            delete swipeWrap.dataset.swipeMoved;
            return;
          }
        }
        e.preventDefault();
        var cid = chatBtn.getAttribute('data-chat-id');
        if (cid) openChatById(cid);
        return;
      }

      var contactBtn = t.closest('.qq-contact-row');
      if (contactBtn) {
        e.preventDefault();
        var chatId = contactBtn.getAttribute('data-chat-id');
        if (chatId) {
          openChatById(chatId, { toBottom: true });
          return;
        }
        var contactId = contactBtn.getAttribute('data-contact-id');
        if (contactId) {
          openChatByContact(contactId);
          return;
        }
        var archiveId = contactBtn.getAttribute('data-archive-id');
        if (archiveId) openChatByArchiveId(archiveId);
        return;
      }

      if (t.closest('[data-mq-grp-create]')) {
        e.preventDefault();
        showGroupCreatePicker();
        return;
      }

      var alphaBtn = t.closest('[data-soft-alpha]');
      if (alphaBtn) {
        e.preventDefault();
        var letter = alphaBtn.getAttribute('data-soft-alpha');
        app.querySelectorAll('.soft-alpha-tag').forEach(function (tag) {
          tag.classList.toggle('is-active', tag === alphaBtn);
        });
        var target = $('soft-alpha-' + letter) ||
          app.querySelector('[data-soft-group="' + letter + '"]');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      var storyBtn = t.closest('.soft-story[data-contact-id]');
      if (storyBtn) {
        e.preventDefault();
        openChatByContact(storyBtn.getAttribute('data-contact-id'));
        return;
      }

      if (t.closest('[data-mine-action="settings"]') && global.miyaSettingsApp) {
        e.preventDefault();
        global.miyaSettingsApp.open('miya-st-panel-contact-chat');
        return;
      }

      var mineAct = t.closest('[data-mq-mine-action]');
      if (mineAct && global.miyaChatMe) {
        e.preventDefault();
        var act = mineAct.getAttribute('data-mq-mine-action');
        if (act === 'profiles') global.miyaChatMe.openProfiles();
        else if (act === 'wallet') global.miyaChatMe.openWallet();
        else if (act === 'favorites') global.miyaChatMe.openFavorites();
        else if (act === 'album') global.miyaChatMe.openAlbum();
        else if (act === 'wallpapers') global.miyaChatMe.openWallpapers();
        return;
      }

      var gridItem = t.closest('[data-mq-mine-grid]');
      if (gridItem && global.miyaChatMe) {
        e.preventDefault();
        var gridAct = gridItem.getAttribute('data-mq-mine-grid');
        if (gridAct === 'dress') global.miyaChatMe.openDress();
        else if (gridAct === 'dress-app') global.miyaChatMe.openDressApp();
        else if (gridAct === 'emoji') global.miyaChatMe.openEmoji();
        return;
      }

      if (t.closest('[data-mq-mine-action="profiles"]') && global.miyaChatMe) {
        e.preventDefault();
        global.miyaChatMe.openProfiles();
        return;
      }

    });

  }

  function renderAll() {
    renderChats();
    hydrateMsgHead();
    if (currentTab === 'contacts') renderContactsTab();
    else if (currentTab === 'feed') renderFeed();
    else if (currentTab === 'mine') renderMine();
    var rafId = ++deferredRenderRaf;
    function paintIdleTabs() {
      if (rafId !== deferredRenderRaf) return;
      if (currentTab !== 'contacts') renderContactsTab();
      if (currentTab !== 'feed') renderFeed();
      if (currentTab !== 'mine') renderMine();
    }
    if (typeof global.miyaScheduleIdle === 'function') {
      global.miyaScheduleIdle(paintIdleTabs, 900);
    } else {
      requestAnimationFrame(paintIdleTabs);
    }
    if (global.MiyaChatMoments && global.MiyaChatMoments.bindEvents) {
      global.MiyaChatMoments.bindEvents($('miya-chat-app'));
    }
  }

  function paintChatAppShell() {
    var el = $('miya-chat-app');
    if (!el) return null;
    el.removeAttribute('hidden');
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('miya-app-open');
    applyChatBodyTheme();
    /* 美化放到下一帧，先让聊天壳立刻可见 */
    if (global.MiyaChatAppBeautify && global.MiyaChatAppBeautify.apply) {
      requestAnimationFrame(function () {
        try { global.MiyaChatAppBeautify.apply(); } catch (e) {}
      });
    }
    return el;
  }

  function openChatApp() {
    var el = paintChatAppShell();
    if (!el) return Promise.resolve();
    /* 先亮壳再等 store，避免白等整库水合 */
    currentTab = 'msg';
    el.querySelectorAll('.qq-page').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-qq-tab') === 'msg');
    });
    el.querySelectorAll('.qq-tabbar__item').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-qq-tab') === 'msg');
    });
    var list = $('qq-chat-list');
    if (list && !list.children.length) {
      list.innerHTML = '<div class="qq-chat-empty">加载中…</div>';
    }

    function afterReady() {
      if (global.MiyaChatBackground && global.MiyaChatBackground.start) {
        if (typeof global.miyaScheduleIdle === 'function') {
          global.miyaScheduleIdle(function () {
            global.MiyaChatBackground.start();
          }, 1000);
        } else {
          setTimeout(function () { global.MiyaChatBackground.start(); }, 0);
        }
      }
      renderChats();
      hydrateMsgHead();
      var rafId = ++deferredRenderRaf;
      function paintIdleTabs() {
        if (rafId !== deferredRenderRaf) return;
        renderContactsTab();
        renderFeed();
        renderMine();
      }
      if (typeof global.miyaScheduleIdle === 'function') {
        global.miyaScheduleIdle(paintIdleTabs, 900);
      } else {
        requestAnimationFrame(function () {
          requestAnimationFrame(paintIdleTabs);
        });
      }
      if (global.MiyaChatMoments && global.MiyaChatMoments.bindEvents) {
        global.MiyaChatMoments.bindEvents(el);
      }
    }

    return ensureStore().then(function () {
      /* 壳已上屏：列表刷新让到下一帧，避免挡住进 App 的第一帧 */
      return new Promise(function (resolve) {
        requestAnimationFrame(function () {
          try { afterReady(); } catch (e) {}
          resolve();
        });
      });
    }).catch(function () {
      toast('聊天加载失败');
    });
  }

  function closeChatApp() {
    var el = $('miya-chat-app');
    if (!el) return;
    if (global.miyaChatRoom) global.miyaChatRoom.close();
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-worldbook-app.is-open') &&
        !document.querySelector('.miya-music-app.is-open') &&
        !document.querySelector('.miya-chat-app.is-open') &&
        !document.querySelector('.miya-memory-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
    document.body.style.backgroundColor = '';
    document.documentElement.style.backgroundColor = '';
  }

  function closeToHome() {
    closeChatApp();
  }

  var pendingListRefresh = false;

  function refreshLists(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var roomOpen = global.miyaChatRoom && global.miyaChatRoom.getOpenChatId && global.miyaChatRoom.getOpenChatId();
    if (!opts.force && roomOpen) {
      pendingListRefresh = true;
      return;
    }
    pendingListRefresh = false;
    var rafId = ++deferredRenderRaf;
    requestAnimationFrame(function () {
      if (rafId !== deferredRenderRaf) return;
      renderChats();
      if (currentTab === 'contacts') renderContactsTab();
      refreshProfileUI();
    });
  }

  function flushPendingListRefresh() {
    if (!pendingListRefresh) return;
    pendingListRefresh = false;
    renderChats();
    if (currentTab === 'contacts') renderContactsTab();
    refreshProfileUI();
  }

  bindEvents();

  /* 空闲预热 store，减少首次点开聊天 App 的等待 */
  if (typeof global.miyaScheduleIdle === 'function') {
    global.miyaScheduleIdle(function () { ensureStore().catch(function () {}); }, 2200);
  } else {
    setTimeout(function () { ensureStore().catch(function () {}); }, 1800);
  }

  if (!global.miyaChatRoomExtras) global.miyaChatRoomExtras = {};
  global.miyaChatRoomExtras.resolveContactAvatarUrl = resolveContactAvatarUrl;
  global.miyaChatRoomExtras.resolveContactAvatarUrlAsync = resolveContactAvatarUrlAsync;
  global.miyaChatRoomExtras.resolveProfileDisplayAvatarSync = resolveProfileDisplayAvatarSync;
  global.miyaChatRoomExtras.resolveProfileDisplayAvatarAsync = resolveProfileDisplayAvatarAsync;

  global.miyaChatApp = {
    open: openChatApp,
    close: closeChatApp,
    closeToHome: closeToHome,
    switchTab: switchTab,
    refreshLists: refreshLists,
    flushPendingListRefresh: flushPendingListRefresh,
    invalidateChatAvatarCache: invalidateChatAvatarCache,
    refreshProfileUI: refreshProfileUI,
    refreshMineMenu: refreshMineMenu,
    refreshFeed: renderFeed,
    openChatByContact: openChatByContact,
    openChatById: openChatById,
    invalidateStore: invalidateStoreReady,
    onUiThemeChange: onUiThemeChange,
    toast: toast,
    resolveContactAvatarUrl: resolveContactAvatarUrl,
    resolveContactAvatarUrlAsync: resolveContactAvatarUrlAsync
  };
})(window);
