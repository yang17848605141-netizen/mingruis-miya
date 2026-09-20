/**
 * miya-forum-app.js — 论坛 · 韩系 INS 编辑风 UI + 生成逻辑
 */
(function (global) {
  'use strict';

  var currentTab = 'home';
  var currentDiscoverTopic = null;
  var currentDiscoverCollection = null;
  var composeOpen = false;
  var refreshing = false;
  var detailPostId = null;
  var detailReplyToId = null;
  var detailLoadingMore = false;
  var avatarUrlCache = {};

  function slideClose(el, doneOrOpts) {
    var done = null;
    var instant = false;
    if (typeof doneOrOpts === 'function') done = doneOrOpts;
    else if (doneOrOpts && typeof doneOrOpts === 'object') {
      done = doneOrOpts.onDone;
      instant = !!doneOrOpts.instant;
    }
    if (!el) return;
    if (instant) {
      el.classList.remove('is-open');
      el.setAttribute('aria-hidden', 'true');
      el.hidden = true;
      if (done) done();
      return;
    }
    if (global.miyaSlidePanel) {
      global.miyaSlidePanel.close(el, { onDone: done });
      return;
    }
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
    if (done) done();
  }

  function slideOpen(el) {
    if (global.miyaSlidePanel) {
      global.miyaSlidePanel.open(el);
      return;
    }
    if (!el) return;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { el.classList.add('is-open'); });
  }
  var imageUrlCache = {};
  var inboxFilter = 'all';
  var noteDraft = { text: '', images: [], location: '', tags: [], collectionId: '' };
  var boardDraft = [null, null, null, null, null];
  var pendingGenTasks = 0;
  var statusBarTimer = null;

  var ORBIT_POS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  var COLL_BG_MODS = ['', ' fr-coll-item__bg--2', ' fr-coll-item__bg--3'];

  var FOLLOWER_NAME_POOL = [
    '月下独酌', '咖啡因依赖', '拖延症晚期', '今天的风', '吃瓜群众甲',
    '路过的猫猫', '失眠发行人', '薯片收藏家', '旧书店常客', '雨天不打伞',
    '一颗柠檬精', '周末躺平中', '凌晨四点', '奶茶半糖', '追星日记本',
    '沙发土豆', '云游四方', '随遇而安', '番茄炒蛋', '不想起名字'
  ];

  function $(id) { return document.getElementById(id); }

  function store() { return global.miyaForumStore; }
  function bridge() { return global.miyaForumBridge; }

  function toast(msg) {
    var el = $('fr-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatHandle(name) {
    var n = esc(String(name || 'user'));
    return '<span class="fr-handle"><span class="fr-at">@</span>' + n + '</span>';
  }

  function dialogPrompt(opts) {
    if (global.miyaDialog && global.miyaDialog.prompt) return global.miyaDialog.prompt(opts);
    var v = window.prompt((opts && opts.title) || '输入', (opts && opts.value) || '');
    return Promise.resolve(v);
  }

  function dialogConfirm(opts) {
    if (global.miyaDialog && global.miyaDialog.confirm) return global.miyaDialog.confirm(opts);
    var ok = window.confirm((opts && opts.message) || (opts && opts.title) || '确认？');
    return Promise.resolve(!!ok);
  }

  function showLoading(text) {
    var el = $('fr-loading');
    var tx = $('fr-loading-text');
    if (tx) tx.textContent = text || '加载中…';
    if (el) {
      el.hidden = false;
      el.setAttribute('aria-hidden', 'false');
    }
  }

  function hideLoading() {
    var el = $('fr-loading');
    if (el) {
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
    }
  }

  function setFeedStatus(text) {
    var el = $('fr-feed-status');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  function showStatusBar(text, done) {
    var el = $('fr-status-bar');
    if (!el) return;
    clearTimeout(statusBarTimer);
    el.textContent = text || '';
    el.hidden = !text;
    el.classList.toggle('is-done', !!done);
    el.setAttribute('aria-hidden', text ? 'false' : 'true');
  }

  function hideStatusBarSoon(delay) {
    clearTimeout(statusBarTimer);
    statusBarTimer = setTimeout(function () {
      showStatusBar('');
    }, delay || 2800);
  }

  function syncInboxBadge() {
    var badge = $('fr-inbox-badge');
    var stApi = store();
    if (!badge || !stApi || !stApi.countUnreadNotifications) return;
    var n = stApi.countUnreadNotifications();
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.setAttribute('aria-hidden', 'false');
    } else {
      badge.hidden = true;
      badge.textContent = '';
      badge.setAttribute('aria-hidden', 'true');
    }
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function notificationTitle(n) {
    if (!n) return '';
    if (n.type === 'like') {
      return n.likeCount > 1 ? (n.likeCount + ' 人赞了你的笔记') : '有人赞了你的笔记';
    }
    if (n.type === 'follower') {
      if (n.followerCount > 1) return n.followerCount + ' 人关注了你';
      return n.actorDisplay ? (n.actorDisplay + ' 关注了你') : '有人关注了你';
    }
    if (n.type === 'comment') return n.actorDisplay + ' 评论了你';
    if (n.type === 'reply') return n.actorDisplay + ' 回复了你';
    if (n.type === 'mention_post') return n.actorDisplay + ' 在帖子中 @了你';
    if (n.type === 'mention_comment') return n.actorDisplay + ' 在评论中 @了你';
    return '系统通知';
  }

  function notificationBadge(n) {
    if (!n) return '';
    var map = {
      comment: '评论',
      like: '点赞',
      reply: '回复',
      follower: '关注',
      mention_post: '提及',
      mention_comment: '提及',
      system: '系统'
    };
    return map[n.type] || '消息';
  }

  function notificationMark(n) {
    if (!n) return '·';
    if (n.type === 'like') return '♡';
    if (n.type === 'follower') return '+';
    if (n.type === 'mention_post' || n.type === 'mention_comment') return '@';
    if (n.type === 'reply') return '↩';
    if (n.type === 'comment') return 'NEW';
    return '★';
  }

  function inboxFilterMatch(n, filter) {
    if (!n || filter === 'all') return true;
    if (filter === 'comment') return n.type === 'comment' || n.type === 'reply';
    if (filter === 'like') return n.type === 'like';
    if (filter === 'follower') return n.type === 'follower';
    if (filter === 'system') return n.type === 'system' || n.type === 'mention_post' || n.type === 'mention_comment';
    return true;
  }

  function renderInbox() {
    var list = $('fr-inbox-list');
    var empty = $('fr-inbox-empty');
    var stApi = store();
    if (!list || !stApi) return;
    var items = (stApi.listNotifications ? stApi.listNotifications() : []).filter(function (n) {
      return inboxFilterMatch(n, inboxFilter);
    });
    if (!items.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = items.map(function (n) {
      var unread = n.read ? '' : ' fr-letter--unread';
      var preview = n.type === 'like' ? (n.preview || n.postPreview)
        : (n.type === 'follower' ? (n.preview || n.postPreview || '有新粉丝关注了你')
          : (n.preview || n.postPreview));
      return '<article class="fr-letter' + unread + '" data-fr-notif-id="' + esc(n.id) + '" data-fr-notif-post="' + esc(n.postId) + '" data-fr-notif-type="' + esc(n.type) + '" role="button" tabindex="0">' +
        '<div class="fr-letter__env"><span class="fr-letter__env-mark">' + esc(notificationMark(n)) + '</span></div>' +
        '<div><h4 class="fr-letter__from">' + esc(notificationTitle(n)) + '</h4>' +
        '<p class="fr-letter__preview">' + esc(preview) + '</p>' +
        '<span class="fr-letter__badge">' + esc(notificationBadge(n)) + '</span></div>' +
        '<time class="fr-letter__time">' + esc(formatRelativeTime(n.createdAt)) + '</time></article>';
    }).join('');
    list.querySelectorAll('[data-fr-notif-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        var nid = el.getAttribute('data-fr-notif-id');
        var pid = el.getAttribute('data-fr-notif-post');
        var ntype = el.getAttribute('data-fr-notif-type');
        if (stApi.markNotificationRead) stApi.markNotificationRead(nid).then(function () {
          syncInboxBadge();
          renderInbox();
        });
        if (pid) openPostDetail(pid);
        else if (ntype === 'follower') setTab('me');
      });
    });
  }

  function pushNotifications(notifs) {
    var stApi = store();
    if (!stApi || !notifs || !notifs.length) return Promise.resolve();
    return (stApi.addNotifications ? stApi.addNotifications(notifs) : Promise.resolve()).then(function () {
      syncInboxBadge();
      if (currentTab === 'inbox') renderInbox();
    });
  }

  function setTab(tab) {
    if (!tab) return;
    currentTab = tab;
    document.querySelectorAll('.fr-page').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-fr-page') === tab);
    });
    document.querySelectorAll('[data-fr-tab]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-fr-tab') === tab);
    });
    syncTopAction();
    if (tab === 'me') renderMeProfile();
    if (tab === 'home') renderFeed();
    if (tab === 'discover') renderDiscoverView();
    if (tab === 'inbox') {
      var stApi = store();
      if (stApi && stApi.markAllNotificationsRead) {
        stApi.markAllNotificationsRead().then(function () {
          syncInboxBadge();
          renderInbox();
        });
      } else {
        renderInbox();
      }
    }
  }

  function runTopAction() {
    if (currentTab === 'home') refreshHomeFeed();
    else if (currentTab === 'discover' && currentDiscoverTopic) refreshDiscoverFeed();
    else if (currentTab === 'discover' && currentDiscoverCollection) refreshCollectionFeed();
    else if (currentTab === 'discover') refreshHotSearch();
    else if (currentTab === 'me') openSettings();
  }

  function syncTopAction() {
    var btn = $('fr-top-action');
    var icon = $('fr-top-action-icon');
    var app = $('miya-forum-app');
    var inDiscoverSub = currentTab === 'discover' && (currentDiscoverTopic || currentDiscoverCollection);
    if (app) app.classList.toggle('is-discover-sub', inDiscoverSub);
    if (!btn || !icon) return;
    if (currentTab === 'home' || currentTab === 'me' || currentTab === 'discover') {
      btn.hidden = false;
      if (currentTab === 'home') {
        btn.setAttribute('aria-label', '刷新帖子');
        icon.textContent = '↻';
        btn.classList.remove('fr-top__action--settings');
      } else if (currentTab === 'discover') {
        btn.setAttribute('aria-label', inDiscoverSub ? '刷新帖子' : '刷新热搜');
        icon.textContent = '↻';
        btn.classList.remove('fr-top__action--settings');
      } else {
        btn.setAttribute('aria-label', '论坛设置');
        icon.textContent = '⚙';
        btn.classList.add('fr-top__action--settings');
      }
    } else {
      btn.hidden = true;
    }
  }

  function getActiveMaskInfo() {
    var st = store() ? store().getState() : {};
    return resolveMaskInfo(st, st.activeMask || { source: 'chat', id: '' });
  }

  function resolveMaskInfo(st, mask) {
    var chatStore = global.miyaChatStore;
    mask = mask || { source: 'chat', id: '' };
    if (mask.source === 'forum') {
      var fm = (st.forumMasks || []).find(function (m) { return m.id === mask.id; });
      if (!fm && st.forumMasks && st.forumMasks[0]) fm = st.forumMasks[0];
      if (!fm) return { source: 'forum', id: '', nickname: '旅人', signature: '', persona: '', avatarBlobId: '', avatar: '' };
      return {
        source: 'forum',
        id: fm.id,
        nickname: fm.nickname || fm.name || '旅人',
        signature: fm.signature || '',
        persona: fm.persona || '',
        avatarBlobId: fm.avatarBlobId || '',
        avatar: ''
      };
    }
    var profiles = chatStore && chatStore.getProfiles ? chatStore.getProfiles() : [];
    var prof = profiles.find(function (p) { return p.id === mask.id; });
    if (!prof) prof = chatStore && chatStore.getActiveProfile ? chatStore.getActiveProfile() : null;
    var overrides = (st.chatMaskOverrides || {})[prof ? prof.id : ''] || {};
    return {
      source: 'chat',
      id: prof ? prof.id : '',
      nickname: overrides.nickname || (prof ? prof.name : '我'),
      signature: overrides.signature || (prof ? prof.persona : '').slice(0, 120),
      persona: overrides.persona || (prof ? prof.persona : '') || '',
      avatarBlobId: prof ? prof.avatarId : '',
      avatar: ''
    };
  }

  function getMaskInfoForPost(post) {
    var st = store() ? store().getState() : {};
    if (post && post.authorMaskSource && post.authorMaskId) {
      return resolveMaskInfo(st, { source: post.authorMaskSource, id: post.authorMaskId });
    }
    return getActiveMaskInfo();
  }

  function getVisibleCommentsForPost(post) {
    return (post && post.commentsFlat) || [];
  }

  function commentReplyLabel(c, byId) {
    if (!c) return '';
    var rid = c.replyToId ? String(c.replyToId).trim() : '';
    if (rid && byId && byId[rid]) {
      return '回复 @' + byId[rid].authorDisplay;
    }
    return '';
  }

  function resolveAvatarUrl(info, cb) {
    if (!info) { cb(''); return; }
    if (info.avatar) { cb(info.avatar); return; }
    var key = info.avatarBlobId;
    if (!key) {
      cb((info.nickname || '?').charAt(0).toUpperCase());
      return;
    }
    if (avatarUrlCache[key]) { cb(avatarUrlCache[key]); return; }
    var cs = global.miyaChatStore;
    if (!cs || !cs.getAvatarUrl) {
      cb((info.nickname || '?').charAt(0).toUpperCase());
      return;
    }
    cs.getAvatarUrl(key).then(function (url) {
      avatarUrlCache[key] = url || '';
      cb(url || (info.nickname || '?').charAt(0).toUpperCase());
    }).catch(function () {
      cb((info.nickname || '?').charAt(0).toUpperCase());
    });
  }

  function polaroidAvatarFallback(name) {
    var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
    return 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#EDE8E0"/><stop offset="100%" stop-color="#D8D0C4"/></linearGradient></defs>' +
      '<rect width="80" height="80" rx="2" fill="url(#g)"/>' +
      '<text x="40" y="50" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#7A7268">' + ch + '</text></svg>'
    );
  }

  function shuffleList(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function resolveCharacterAvatar(char) {
    return new Promise(function (resolve) {
      if (!char) { resolve(''); return; }
      var av = String(char.avatar || '').trim();
      if (av) { resolve(av); return; }
      var chatStore = global.miyaChatStore;
      var contact = chatStore && chatStore.findContactByArchiveCharacter
        ? chatStore.findContactByArchiveCharacter(char)
        : null;
      if (!contact) { resolve(''); return; }
      var direct = String(contact.avatar || '').trim();
      if (direct) { resolve(direct); return; }
      var blobId = String(contact.avatarBlobId || '').trim();
      if (!blobId) { resolve(''); return; }
      if (avatarUrlCache[blobId]) { resolve(avatarUrlCache[blobId]); return; }
      if (!chatStore.getAvatarUrl) { resolve(''); return; }
      chatStore.getAvatarUrl(blobId).then(function (url) {
        avatarUrlCache[blobId] = url || '';
        resolve(url || '');
      }).catch(function () { resolve(''); });
    });
  }

  function collectCharacters() {
    var cs = global.miyaContactsStore;
    if (!cs || !cs.listCharacters) return [];
    return cs.listCharacters().filter(function (c) {
      return c && String(c.name || '').trim();
    });
  }

  function renderPolaroidWall() {
    var grid = $('fr-polaroid-wall-grid');
    var wall = $('fr-polaroid-wall');
    if (!grid) return;
    var slots = 4;
    var chars = shuffleList(collectCharacters());
    var picked = chars.slice(0, slots);
    while (picked.length < slots && chars.length) {
      picked.push(chars[Math.floor(Math.random() * chars.length)]);
    }
    if (!picked.length) {
      grid.innerHTML = '';
      if (wall) wall.hidden = true;
      return;
    }
    if (wall) wall.hidden = false;
    grid.innerHTML = picked.map(function (char, index) {
      var deco = '';
      if (index === 0) deco = '<span class="fr-polaroid__tape"></span>';
      else if (index === 1 || index === 2) deco = '<span class="fr-polaroid__pin"></span>';
      else if (index === 3) deco = '<span class="fr-polaroid__clip"></span>';
      return (
        '<figure class="fr-polaroid fr-polaroid--slot-' + index + '">' +
          deco +
          '<div class="fr-polaroid__photo">' +
            '<img alt="" data-fr-polaroid-img="' + index + '">' +
            '<span class="fr-polaroid__leak"></span>' +
            '<span class="fr-polaroid__grain"></span>' +
          '</div>' +
          '<figcaption class="fr-polaroid__cap">' + esc(char.name) + '</figcaption>' +
        '</figure>'
      );
    }).join('');
    picked.forEach(function (char, index) {
      resolveCharacterAvatar(char).then(function (url) {
        var img = grid.querySelector('[data-fr-polaroid-img="' + index + '"]');
        if (!img) return;
        img.src = url || polaroidAvatarFallback(char.name);
        img.alt = char.name || '';
      });
    });
  }

  function hydrateLazyAvatars(root) {
    if (!root) return;
    root.querySelectorAll('[data-fr-lazy-avatar]').forEach(function (el) {
      var key = el.getAttribute('data-fr-lazy-avatar');
      if (!key) return;
      resolveAvatarUrl({ avatarBlobId: key }, function (url) {
        if (url && /^https?:|^blob:|^data:/.test(url)) {
          el.style.backgroundImage = 'url("' + url + '")';
          el.classList.remove('fr-card__author-dot');
          el.classList.remove('fr-detail__author-ava--letter');
        }
      });
    });
  }

  function resolvePostAvatarBlobId(post) {
    if (!post || post.authorType !== 'user') return String(post && post.authorAvatarBlobId || '').trim();
    var blobId = String(post.authorAvatarBlobId || '').trim();
    if (blobId) return blobId;
    var info = getActiveMaskInfo();
    return String(info.avatarBlobId || '').trim();
  }

  function renderAuthorAvatarHtml(post, detail) {
    var av = String(post.authorAvatar || '').trim();
    var blobKey = resolvePostAvatarBlobId(post);
    var cls = detail ? 'fr-detail__author-ava' : 'fr-card__author-ava';
    if (av && (/^https?:|^blob:|^data:/.test(av))) {
      return '<span class="' + cls + '" style="background-image:url(\'' + esc(av) + '\')"></span>';
    }
    if (blobKey) {
      return '<span class="' + cls + '" data-fr-lazy-avatar="' + esc(blobKey) + '"></span>';
    }
    if (post.authorType === 'character' && av) {
      return '<span class="' + cls + '" style="background-image:url(\'' + esc(av) + '\')"></span>';
    }
    var letterCls = detail ? cls + ' fr-detail__author-ava--letter' : 'fr-card__author-dot';
    var letter = String(post.authorDisplay || '?').charAt(0).toUpperCase();
    return '<span class="' + letterCls + '">' + esc(letter) + '</span>';
  }

  function renderMeBoard() {
    var mosaic = $('fr-me-mosaic');
    var stApi = store();
    if (!mosaic || !stApi) return;
    var info = getActiveMaskInfo();
    var images = stApi.getProfileBoard ? stApi.getProfileBoard(info.source, info.id) : [];
    var labels = ['FEATURED', '01', '02', '03', '04'];
    var layouts = [' fr-me-mosaic__cell--span2', '', '', '', ''];
    mosaic.innerHTML = labels.map(function (label, idx) {
      var im = images[idx];
      var hasImg = im && (im.imageKey || im.src);
      var imgCls = hasImg ? ' fr-me-mosaic__cell--has-img' : '';
      var lazy = (im && im.imageKey) ? ' data-fr-lazy-img="' + esc(im.imageKey) + '"' : '';
      return '<div class="fr-me-mosaic__cell' + layouts[idx] + imgCls + '" data-fr-mosaic-idx="' + idx + '"' + lazy + '>' +
        (hasImg ? '' : '<span class="fr-me-mosaic__cell-label">' + label + '</span>') +
      '</div>';
    }).join('');
    mosaic.querySelectorAll('[data-fr-mosaic-idx]').forEach(function (cell) {
      var idx = Math.floor(Number(cell.getAttribute('data-fr-mosaic-idx')));
      var im = images[idx];
      if (im && im.src && !im.imageKey) applyBoardImageToCell(cell, im);
    });
    hydrateLazyImages(mosaic);
  }

  function resetBoardDraft() {
    boardDraft.forEach(revokePreviewUrl);
    var stApi = store();
    var info = getActiveMaskInfo();
    var saved = stApi && stApi.getProfileBoard ? stApi.getProfileBoard(info.source, info.id) : [];
    boardDraft = [null, null, null, null, null];
    for (var i = 0; i < 5; i++) boardDraft[i] = saved[i] ? Object.assign({}, saved[i]) : null;
  }

  function renderBoardEditorMosaic() {
    var box = $('fr-me-board-editor-mosaic');
    if (!box) return;
    var labels = ['主图', '图 2', '图 3', '图 4', '图 5'];
    var layouts = [' fr-me-mosaic__cell--span2', '', '', '', ''];
    box.innerHTML = boardDraft.map(function (im, idx) {
      var hasImg = im && (im.imageKey || im.previewUrl || im.src);
      return '<div class="fr-me-mosaic__cell fr-me-board-editor__cell' + layouts[idx] + (hasImg ? ' fr-me-mosaic__cell--has-img' : '') + '"' +
        ' data-fr-board-slot="' + idx + '" role="button" tabindex="0">' +
        '<span class="fr-me-board-editor__cell-hint">' + (hasImg ? '更换' : labels[idx]) + '</span>' +
        (hasImg ? '<button type="button" class="fr-me-board-editor__cell-rm" data-fr-board-rm="' + idx + '">×</button>' : '') +
      '</div>';
    }).join('');
    box.querySelectorAll('[data-fr-board-slot]').forEach(function (cell) {
      var idx = Math.floor(Number(cell.getAttribute('data-fr-board-slot')));
      applyBoardImageToCell(cell, boardDraft[idx]);
    });
    hydrateLazyImages(box);
    box.querySelectorAll('[data-fr-board-slot]').forEach(function (cell) {
      cell.addEventListener('click', function (e) {
        if (e.target.closest('[data-fr-board-rm]')) return;
        pickBoardImage(Number(cell.getAttribute('data-fr-board-slot')));
      });
    });
    box.querySelectorAll('[data-fr-board-rm]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var i = Number(btn.getAttribute('data-fr-board-rm'));
        revokePreviewUrl(boardDraft[i]);
        boardDraft[i] = null;
        renderBoardEditorMosaic();
      });
    });
  }

  function openBoardEditor() {
    resetBoardDraft();
    renderBoardEditorMosaic();
    var el = $('fr-me-board-editor');
    if (!el) return;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { el.classList.add('is-open'); });
  }

  function closeBoardEditor() {
    slideClose($('fr-me-board-editor'));
  }

  function handleBoardImageFile(slotIdx, file) {
    var slot = Math.floor(Number(slotIdx));
    if (slot < 0 || slot > 4) return;
    if (boardDraft[slot]) revokePreviewUrl(boardDraft[slot]);
    var previewUrl = '';
    try { previewUrl = URL.createObjectURL(file); } catch (e0) {}
    var draftItem = { imageKey: '', previewUrl: previewUrl, src: '', file: file };
    boardDraft[slot] = draftItem;
    renderBoardEditorMosaic();
    storeForumImageFile(file, 'forum-board').then(function (blobId) {
      if (!blobId || !boardDraft[slot] || boardDraft[slot] !== draftItem) return;
      draftItem.imageKey = blobId;
    }).catch(function () {});
  }

  function pickBoardImage(slotIdx) {
    openForumImageFilePicker('board', slotIdx);
  }

  async function saveBoardEditor() {
    var stApi = store();
    if (!stApi || !stApi.setProfileBoard) {
      toast('论坛存储未就绪，请刷新页面后重试');
      return;
    }
    try {
      await ensureDefaultMask();
      var info = getActiveMaskInfo();
      if (!info.id) {
        toast('请先设置面具');
        return;
      }
      var images = [];
      for (var i = 0; i < boardDraft.length; i++) {
        var im = boardDraft[i];
        if (!im) {
          images.push(null);
          continue;
        }
        var imageKey = String(im.imageKey || '').trim();
        if (!imageKey && im.file) {
          try {
            imageKey = await storeForumImageFile(im.file, 'forum-board');
            im.imageKey = imageKey;
          } catch (eUp) {
            toast('图片上传失败，请重试');
            return;
          }
        }
        if (!imageKey) {
          toast('图片还在处理中，请稍候再保存');
          return;
        }
        images.push({ imageKey: imageKey, src: '' });
      }
      var saved = await stApi.setProfileBoard(info.source, info.id, images);
      if (!saved) return;
      boardDraft.forEach(revokePreviewUrl);
      closeBoardEditor();
      renderMeBoard();
      toast('版面已保存');
    } catch (e) {
      toast('保存失败：' + ((e && e.message) || '请重试'));
    }
  }

  function renderMeProfile() {
    var info = getActiveMaskInfo();
    var nameEl = $('fr-me-name');
    var handleEl = $('fr-me-handle');
    var bioEl = $('fr-me-bio');
    var sigEl = $('fr-me-sig');
    var avaEl = $('fr-me-ava');
    if (nameEl) nameEl.textContent = info.nickname || '未命名';
    if (handleEl) handleEl.innerHTML = formatHandle((info.nickname || 'user').toLowerCase().replace(/\s+/g, '.'));
    if (bioEl) bioEl.textContent = info.signature || '点击编辑签名';
    if (sigEl) sigEl.textContent = info.source === 'forum' ? 'Forum Alias' : 'Alter Ego';
    renderMeStats();
    var favDesc = $('fr-me-fav-desc');
    if (favDesc && store()) {
      var favCount = store().listBookmarkedPosts ? store().listBookmarkedPosts().length : 0;
      favDesc.textContent = favCount ? ('已收藏 ' + favCount + ' 篇') : '收藏感兴趣的帖子';
    }
    var histDesc = $('fr-me-hist-desc');
    if (histDesc && store()) {
      var histCount = store().listBrowsingHistory ? store().listBrowsingHistory().length : 0;
      histDesc.textContent = histCount ? ('已浏览 ' + histCount + ' 篇') : '浏览过的帖子会保留在这里';
    }
    var myPostsDesc = $('fr-me-myposts-desc');
    if (myPostsDesc && store()) {
      var myCount = store().countUserPosts ? store().countUserPosts() : 0;
      myPostsDesc.textContent = myCount ? ('已发布 ' + myCount + ' 篇') : '你发过的帖子会保留在这里';
    }
    if (avaEl) {
      resolveAvatarUrl(info, function (url) {
        if (url && /^https?:|^blob:|^data:/.test(url)) {
          avaEl.style.backgroundImage = 'url("' + url + '")';
          avaEl.textContent = '';
        } else {
          avaEl.style.backgroundImage = '';
          avaEl.textContent = String(url || info.nickname || 'm').charAt(0).toLowerCase();
        }
      });
    }
    renderMeBoard();
  }

  function renderMeStats() {
    var stApi = store();
    var notesEl = $('fr-me-stat-notes');
    var followersEl = $('fr-me-stat-followers');
    if (!stApi) return;
    var noteCount = stApi.countUserPosts ? stApi.countUserPosts() : 0;
    var followerCount = stApi.getFollowerCount ? stApi.getFollowerCount() : 0;
    if (notesEl) notesEl.textContent = formatLikes(noteCount);
    if (followersEl) followersEl.textContent = formatLikes(followerCount);
  }

  function pickRandomFollowerName() {
    return FOLLOWER_NAME_POOL[Math.floor(Math.random() * FOLLOWER_NAME_POOL.length)];
  }

  function postPreviewSnippet(post) {
    if (!post) return '';
    var t = String(post.text || '').trim();
    if (t) return t.slice(0, 60) + (t.length > 60 ? '…' : '');
    var im = (post.images || [])[0];
    if (im && im.textBody) return im.textBody.slice(0, 40);
    return '一条笔记';
  }

  function rollFollowersOnPost(post) {
    if (Math.random() > 0.65) return Promise.resolve();
    var gain = 1 + Math.floor(Math.random() * 12);
    if (Math.random() < 0.18) gain += 5 + Math.floor(Math.random() * 20);
    var stApi = store();
    if (!stApi || !stApi.addFollowers) return Promise.resolve();
    var actorName = pickRandomFollowerName();
    return stApi.addFollowers(gain).then(function () {
      var notif = {
        id: 'fnotif_follow_' + (post && post.id || '') + '_' + Date.now(),
        type: 'follower',
        read: false,
        createdAt: Date.now(),
        postId: post && post.id || '',
        commentId: '',
        actorDisplay: actorName,
        actorContactId: '',
        actorKind: 'npc',
        preview: gain > 1 ? (actorName + ' 等 ' + gain + ' 人关注了你') : (actorName + ' 关注了你'),
        postPreview: postPreviewSnippet(post),
        likeCount: 0,
        followerCount: gain
      };
      return pushNotifications([notif]).then(function () {
        if (currentTab === 'me') renderMeProfile();
        if (gain >= 3) {
          showStatusBar('收获了 ' + gain + ' 位新粉丝', true);
          hideStatusBarSoon(3200);
        }
      });
    });
  }

  function formatLikes(n) {
    var v = Number(n) || 0;
    if (v >= 1000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(v);
  }

  function cardVariantClass(index, post) {
    if (index === 0) return 'fr-card--hero';
    if (index === 1) return 'fr-card--tall fr-card--tilt-l';
    if (index === 2) return 'fr-card--tilt-r';
    if (index === 4) return 'fr-card--wide';
    return '';
  }

  function mediaVariantClass(index) {
    var mods = ['fr-card__media--a', 'fr-card__media--b', 'fr-card__media--c'];
    return mods[index % mods.length];
  }

  function resolveImageUrl(imageKey, cb) {
    var key = String(imageKey || '').trim();
    if (!key) { cb(''); return; }
    if (imageUrlCache[key]) { cb(imageUrlCache[key]); return; }
    var cs = global.miyaChatStore;
    if (!cs || !cs.getAvatarUrl) { cb(''); return; }
    cs.getAvatarUrl(key).then(function (url) {
      imageUrlCache[key] = url || '';
      cb(url || '');
    }).catch(function () { cb(''); });
  }

  function isLikelyImageFile(file) {
    var imgApi = global.MiyaChatImage;
    if (imgApi && typeof imgApi.isLikelyImageFile === 'function') return imgApi.isLikelyImageFile(file);
    if (!file) return false;
    if (String(file.type || '').indexOf('image') === 0) return true;
    return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(String(file.name || ''));
  }

  function revokePreviewUrl(im) {
    if (!im || !im.previewUrl) return;
    try { URL.revokeObjectURL(im.previewUrl); } catch (e) {}
    im.previewUrl = '';
  }

  function storeForumImageFile(file, kind) {
    var cs = global.miyaChatStore;
    if (!cs || !cs.storeMediaBlob) return Promise.reject(new Error('store_unavailable'));
    var imgApi = global.MiyaChatImage;
    var blobP = (imgApi && imgApi.compressImageFileToBlob)
      ? imgApi.compressImageFileToBlob(file).catch(function () { return file; })
      : Promise.resolve(file);
    return blobP.then(function (blob) {
      if (!blob || typeof blob.size !== 'number') throw new Error('invalid_blob');
      return cs.storeMediaBlob(blob, kind || 'forum-post');
    });
  }

  var forumImageFileInput = null;
  var forumImageFilePendingKind = null;
  var forumImageFilePendingSlot = null;

  function ensureForumImageFileInput() {
    if (forumImageFileInput) return forumImageFileInput;
    forumImageFileInput = document.createElement('input');
    forumImageFileInput.type = 'file';
    forumImageFileInput.accept = 'image/*,.heic,.heif';
    forumImageFileInput.hidden = true;
    forumImageFileInput.setAttribute('aria-hidden', 'true');
    document.body.appendChild(forumImageFileInput);
    forumImageFileInput.addEventListener('change', function () {
      var file = forumImageFileInput.files && forumImageFileInput.files[0];
      forumImageFileInput.value = '';
      if (!file) return;
      if (!isLikelyImageFile(file)) {
        toast('请选择图片文件');
        forumImageFilePendingKind = null;
        forumImageFilePendingSlot = null;
        return;
      }
      if (forumImageFilePendingKind === 'board' && forumImageFilePendingSlot != null) {
        handleBoardImageFile(forumImageFilePendingSlot, file);
      } else if (forumImageFilePendingKind === 'note') {
        handleNoteImageFile(file);
      }
      forumImageFilePendingKind = null;
      forumImageFilePendingSlot = null;
    });
    return forumImageFileInput;
  }

  function openForumImageFilePicker(kind, slotIdx) {
    forumImageFilePendingKind = kind;
    forumImageFilePendingSlot = slotIdx != null ? slotIdx : null;
    ensureForumImageFileInput().click();
  }

  function applyBoardImageToCell(cell, im) {
    if (!cell) return;
    var hasImg = !!(im && (im.imageKey || im.previewUrl || im.src));
    cell.classList.toggle('fr-me-mosaic__cell--has-img', hasImg);
    cell.style.backgroundImage = '';
    cell.removeAttribute('data-fr-lazy-img');
    if (!im) return;
    var preview = String(im.previewUrl || im.src || '').trim();
    if (preview) {
      cell.style.backgroundImage = 'url("' + preview.replace(/"/g, '\\"') + '")';
    } else if (im.imageKey) {
      cell.setAttribute('data-fr-lazy-img', im.imageKey);
    }
  }

  function applyRealImageToImg(img, im) {
    if (!img || !im || im.type !== 'real') return;
    if (im.imageKey) {
      img.removeAttribute('src');
      img.setAttribute('data-fr-lazy-img', im.imageKey);
      return;
    }
    var preview = String(im.previewUrl || im.src || '').trim();
    if (preview) {
      img.removeAttribute('data-fr-lazy-img');
      img.src = preview;
    }
  }

  function hydrateLazyImages(root) {
    if (!root) return;
    root.querySelectorAll('[data-fr-lazy-img]').forEach(function (el) {
      var key = el.getAttribute('data-fr-lazy-img');
      if (!key) return;
      resolveImageUrl(key, function (url) {
        if (!url) return;
        if (el.classList.contains('fr-card__media') || el.classList.contains('fr-detail__img') || el.classList.contains('fr-me-mosaic__cell')) {
          el.style.backgroundImage = 'url("' + url + '")';
          el.classList.add('fr-me-mosaic__cell--has-img');
          var label = el.querySelector('.fr-me-mosaic__cell-label');
          if (label) label.remove();
        } else if (el.tagName === 'IMG') {
          el.src = url;
          var lazyWrap = el.closest('.fr-detail__img--lazy');
          if (lazyWrap) lazyWrap.classList.remove('fr-detail__img--lazy');
        }
      });
    });
  }

  function renderDetailImagesHtml(images) {
    return (images || []).map(function (im) {
      if (!im) return '';
      if (im.type === 'text-image') {
        return '<div class="fr-detail__img fr-detail__img--text">' + esc(im.textBody) + '</div>';
      }
      var isReal = im.type === 'real' || !!(im.imageKey && !im.textBody);
      var key = String(im.imageKey || '').trim();
      var preview = String(im.previewUrl || im.src || '').trim();
      if (!isReal && !key && !preview) return '';
      if (key) {
        return '<div class="fr-detail__img fr-detail__img--real fr-detail__img--lazy">' +
          '<img alt="" data-fr-lazy-img="' + esc(key) + '"></div>';
      }
      if (preview) {
        return '<div class="fr-detail__img fr-detail__img--real">' +
          '<img alt="" src="' + esc(preview) + '"></div>';
      }
      return '';
    }).join('');
  }

  function hydratePostDetailImages(root) {
    if (!root) return Promise.resolve();
    function run() {
      hydrateLazyImages(root);
    }
    var cs = global.miyaChatStore;
    if (cs && typeof cs.whenReady === 'function') {
      return cs.whenReady().then(run).catch(run);
    }
    run();
    return Promise.resolve();
  }

  function renderPostImagesHtml(images, cardIndex, authorType) {
    if (!images || !images.length) return '';
    var im = images[0];
    if (im.type === 'text-image' && im.textBody) {
      return '<div class="fr-card__media fr-card__media--text ' + mediaVariantClass(cardIndex) + '"><span class="fr-card__media-caption">' + esc(im.textBody) + '</span></div>';
    }
    if (im.type === 'real' && (im.imageKey || im.src || im.previewUrl)) {
      return '<div class="fr-card__media fr-card__media--real"><img alt=""></div>';
    }
    return '<div class="fr-card__media ' + mediaVariantClass(cardIndex) + '"></div>';
  }

  function hydratePostCardImages(box, posts) {
    if (!box || !posts || !posts.length) return;
    var cards = box.querySelectorAll('[data-fr-post-id]');
    cards.forEach(function (card, i) {
      var post = posts[i];
      if (!post) return;
      var im = (post.images || [])[0];
      if (!im || im.type !== 'real') return;
      var img = card.querySelector('.fr-card__media--real img');
      if (!img) return;
      applyRealImageToImg(img, im);
    });
  }

  function renderTagsHtml(tags, cls) {
    if (!tags || !tags.length) return '';
    var c = cls || 'fr-card__tags';
    return '<div class="' + c + '">' + tags.map(function (t) {
      var label = String(t || '').replace(/^#/, '');
      return '<span class="fr-card__tag-item">#' + esc(label) + '</span>';
    }).join('') + '</div>';
  }

  function findPostById(postId) {
    var stApi = store();
    if (!stApi) return null;
    if (stApi.findPostAnywhere) return stApi.findPostAnywhere(postId);
    return stApi.findPost(postId);
  }

  function findThreadRootId(commentId, byId) {
    var cur = byId[commentId];
    var guard = 0;
    while (cur && cur.replyToId && byId[cur.replyToId] && guard++ < 40) {
      cur = byId[cur.replyToId];
    }
    return cur ? cur.id : commentId;
  }

  function buildCommentForest(comments) {
    var list = (comments || []).slice();
    list.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    var byId = {};
    list.forEach(function (c) { byId[c.id] = c; });
    var roots = [];
    var childrenMap = {};
    var assigned = {};

    list.forEach(function (c) {
      var pid = c.replyToId;
      if (pid && byId[pid] && pid !== c.id) {
        var rootId = findThreadRootId(pid, byId);
        if (rootId === c.id) {
          if (!assigned[c.id]) {
            roots.push(c);
            assigned[c.id] = true;
          }
          return;
        }
        if (!childrenMap[rootId]) childrenMap[rootId] = [];
        if (!assigned[c.id]) {
          childrenMap[rootId].push(c);
          assigned[c.id] = true;
        }
      } else if (!assigned[c.id]) {
        roots.push(c);
        assigned[c.id] = true;
      }
    });

    function sortByTime(a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }
    roots.sort(sortByTime);
    Object.keys(childrenMap).forEach(function (k) { childrenMap[k].sort(sortByTime); });
    return { roots: roots, childrenMap: childrenMap };
  }

  function canDeleteComment(post, comment) {
    if (!post || !comment) return false;
    if (comment.authorKind === 'user') return true;
    if (post.authorType === 'user') return true;
    return false;
  }

  function renderCommentDeleteBtn(post, comment) {
    if (!canDeleteComment(post, comment)) return '';
    return '<button type="button" class="fr-detail__comment-del" data-fr-del-comment="' + esc(comment.id) + '" aria-label="删除评论">删除</button>';
  }

  function renderFlatReplyHtml(c, post, byId) {
    var replyLabel = commentReplyLabel(c, byId);
    var reply = replyLabel ? '<span class="fr-detail__reply">' + esc(replyLabel) + '</span>' : '';
    return '<div class="fr-detail__comment fr-detail__comment--reply" data-fr-comment-id="' + esc(c.id) + '" role="button" tabindex="0">' +
      '<div class="fr-detail__comment-head"><strong>' + esc(c.authorDisplay) + '</strong>' + reply + renderCommentDeleteBtn(post, c) + '</div>' +
      '<p class="fr-detail__comment-text">' + esc(c.text) + '</p>' +
      '<span class="fr-detail__comment-like">♡ ' + formatLikes(c.likes) + '</span>' +
    '</div>';
  }

  function renderCommentThreadHtml(root, childrenMap, post, byId) {
    var replies = (childrenMap[root.id] || []).slice();
    replies.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
    var repliesHtml = replies.map(function (c) { return renderFlatReplyHtml(c, post, byId); }).join('');
    var repliesBlock = repliesHtml ? '<div class="fr-detail__comment-replies">' + repliesHtml + '</div>' : '';
    return '<div class="fr-detail__comment" data-fr-comment-id="' + esc(root.id) + '" role="button" tabindex="0">' +
      '<div class="fr-detail__comment-head"><strong>' + esc(root.authorDisplay) + '</strong>' + renderCommentDeleteBtn(post, root) + '</div>' +
      '<p class="fr-detail__comment-text">' + esc(root.text) + '</p>' +
      '<span class="fr-detail__comment-like">♡ ' + formatLikes(root.likes) + '</span>' +
      repliesBlock +
    '</div>';
  }

  function renderCommentsFooterHtml(post) {
    if (post.commentsGenerating) {
      return '<p class="fr-detail__loading-more" aria-live="polite">' +
        '<span class="fr-detail__loading-spin" aria-hidden="true"></span>评论生成中…</p>';
    }
    var unreplied = 0;
    var br = bridge();
    if (br && br.countUserCommentsNeedingReply) unreplied = br.countUserCommentsNeedingReply(post);
    else if (br && br.findUnrepliedUserComments) unreplied = br.findUnrepliedUserComments(post).length;
    var label = unreplied ? '查看更多评论 · 获取回复' : '查看更多评论';
    return '<button type="button" class="fr-detail__more-comments" data-fr-more-comments>' + label + '</button>';
  }

  function renderCommentsListHtml(post) {
    var comments = getVisibleCommentsForPost(post);
    if (!comments.length) {
      return '<p class="fr-detail__empty">暂无评论</p>';
    }
    var byId = {};
    comments.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var forest = buildCommentForest(comments);
    return forest.roots.map(function (c) {
      return renderCommentThreadHtml(c, forest.childrenMap, post, byId);
    }).join('');
  }

  function renderCommentsSectionHtml(post) {
    return renderCommentsListHtml(post) + renderCommentsFooterHtml(post);
  }

  function updateCommentsFooter(post) {
    var foot = $('fr-detail-comments-foot');
    if (!foot || !post) return;
    foot.innerHTML = renderCommentsFooterHtml(post);
    var moreBtn = foot.querySelector('[data-fr-more-comments]');
    if (moreBtn) moreBtn.addEventListener('click', function () { loadMoreComments(); });
  }

  function setDetailCommentsGenerating(on) {
    var p = findPostById(detailPostId);
    if (!p) return;
    p.commentsGenerating = !!on;
    updateCommentsFooter(p);
  }

  function updateBookmarkButton(post) {
    var btn = $('fr-detail-bookmark');
    if (!btn || !post) return;
    var on = !!post.bookmarked;
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-label', on ? '取消收藏' : '收藏');
    btn.textContent = on ? '★' : '☆';
  }

  function updateReplyComposerHint() {
    var input = $('fr-detail-input');
    if (!input) return;
    if (!detailReplyToId) {
      input.placeholder = '写评论…';
      return;
    }
    var p = findPostById(detailPostId);
    var tgt = p && (p.commentsFlat || []).find(function (c) { return c.id === detailReplyToId; });
    input.placeholder = tgt ? ('回复 @' + tgt.authorDisplay + '…') : '写评论…';
  }

  function clearReplyTarget() {
    detailReplyToId = null;
    updateReplyComposerHint();
  }

  function filterPostsForFeed(posts, mode) {
    if (mode === 'topic') {
      var tag = String(currentDiscoverTopic || '').trim();
      return (posts || []).filter(function (p) {
        return p.source === 'topic' && p.topicTag === tag;
      });
    }
    if (mode === 'collection') {
      var cid = String(currentDiscoverCollection || '').trim();
      return (posts || []).filter(function (p) {
        return p.collectionId === cid;
      });
    }
    return (posts || []).filter(function (p) {
      return p.source === 'home' || p.source === 'user' || !p.source;
    });
  }

  function syncOrbitBubblesActive() {
    document.querySelectorAll('[data-fr-orbit-topic]').forEach(function (btn) {
      var t = btn.getAttribute('data-fr-orbit-topic');
      btn.classList.toggle('is-active', !!currentDiscoverTopic && t === currentDiscoverTopic);
    });
  }

  function bindOrbitBubbles() {
    document.querySelectorAll('[data-fr-orbit-topic]').forEach(function (btn) {
      if (btn._frOrbitBound) return;
      btn._frOrbitBound = true;
      btn.addEventListener('click', function () {
        openDiscoverTopic(btn.getAttribute('data-fr-orbit-topic'));
      });
    });
  }

  function renderHotSearch() {
    var stApi = store();
    var topics = stApi && stApi.getHotSearchTopics ? stApi.getHotSearchTopics() : [];
    var listBox = $('fr-topic-list');
    if (!listBox) return;

    if (!topics.length) {
      listBox.innerHTML = '<p class="fr-topic-empty" id="fr-topic-empty">点击右上角刷新，生成今日热搜</p>';
      return;
    }

    listBox.innerHTML = topics.map(function (t, i) {
      var idx = String(i + 1).padStart(2, '0');
      return '<article class="fr-topic-row" data-fr-topic="' + esc(t.tag) + '" role="button" tabindex="0">' +
        '<span class="fr-topic-row__idx">' + idx + '</span>' +
        '<div><h4 class="fr-topic-row__title">' + esc(t.tag) + '</h4>' +
        '<p class="fr-topic-row__sub">' + esc(t.discussCount || '') + '</p></div>' +
        '<span class="fr-topic-row__heat">' + esc(t.heat || 'HOT') + '</span></article>';
    }).join('');
    listBox.querySelectorAll('[data-fr-topic]').forEach(function (el) {
      el.addEventListener('click', function () {
        openDiscoverTopic(el.getAttribute('data-fr-topic'));
      });
    });
  }

  function renderCollections() {
    var grid = $('fr-coll-grid');
    var stApi = store();
    if (!grid || !stApi) return;
    var collections = stApi.listCollections ? stApi.listCollections() : [];
    if (!collections.length) {
      grid.innerHTML = '<p class="fr-coll-empty" id="fr-coll-empty">点击 VIEW ALL 添加策展合集</p>';
      return;
    }
    grid.innerHTML = collections.map(function (coll, i) {
      var isMain = i === 0 ? ' fr-coll-item--main' : '';
      var bgMod = COLL_BG_MODS[i % COLL_BG_MODS.length];
      var count = stApi.countCollectionPosts ? stApi.countCollectionPosts(coll.id) : 0;
      var total = count;
      var vol = i === 0 ? ('COLLECTION · ' + String(i + 1).padStart(2, '0')) : String(i + 1).padStart(2, '0');
      var nameHtml = esc(coll.name).replace(/\n/g, '<br>');
      var desc = coll.description ? ('<p class="fr-coll-item__desc">' + esc(coll.description.slice(0, 40)) + (coll.description.length > 40 ? '…' : '') + '</p>') : '';
      return '<article class="fr-coll-item' + isMain + '" data-fr-collection-id="' + esc(coll.id) + '" role="button" tabindex="0">' +
        '<div class="fr-coll-item__bg' + bgMod + '"></div>' +
        '<div class="fr-coll-item__overlay"></div>' +
        '<div class="fr-coll-item__copy">' +
          '<span class="fr-coll-item__vol">' + vol + '</span>' +
          '<h4 class="fr-coll-item__name">' + nameHtml + '</h4>' +
          desc +
          '<p class="fr-coll-item__count">' + total + ' 篇收录</p>' +
        '</div></article>';
    }).join('');
    grid.querySelectorAll('[data-fr-collection-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        openDiscoverCollection(el.getAttribute('data-fr-collection-id'));
      });
    });
  }

  function syncNoteCollectionSelect() {
    var sel = $('fr-note-collection');
    var stApi = store();
    if (!sel || !stApi) return;
    var collections = stApi.listCollections ? stApi.listCollections() : [];
    var cur = noteDraft.collectionId || '';
    sel.innerHTML = '<option value="">不归入策展</option>' +
      collections.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (cur === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      }).join('');
  }

  function openCollectionEditor() {
    renderCollectionEditorList();
    var el = $('fr-coll-editor');
    if (!el) return;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { el.classList.add('is-open'); });
  }

  function closeCollectionEditor() {
    slideClose($('fr-coll-editor'), function () {
      renderCollections();
      syncNoteCollectionSelect();
    });
  }

  function renderCollectionEditorList() {
    var box = $('fr-coll-editor-list');
    var stApi = store();
    if (!box || !stApi) return;
    var collections = stApi.listCollections ? stApi.listCollections() : [];
    if (!collections.length) {
      box.innerHTML = '<p class="fr-coll-editor__empty">还没有策展合集，点击右上角添加</p>';
      return;
    }
    box.innerHTML = collections.map(function (coll) {
      return '<article class="fr-coll-editor__item" data-fr-coll-edit-id="' + esc(coll.id) + '">' +
        '<div class="fr-coll-editor__item-main">' +
          '<h4 class="fr-coll-editor__item-name">' + esc(coll.name) + '</h4>' +
          '<p class="fr-coll-editor__item-desc">' + esc(coll.description || '暂无简介') + '</p>' +
        '</div>' +
        '<div class="fr-coll-editor__item-actions">' +
          '<button type="button" class="fr-coll-editor__item-btn" data-fr-coll-edit="' + esc(coll.id) + '">编辑</button>' +
          '<button type="button" class="fr-coll-editor__item-btn fr-coll-editor__item-btn--del" data-fr-coll-del="' + esc(coll.id) + '">删除</button>' +
        '</div></article>';
    }).join('');
    box.querySelectorAll('[data-fr-coll-edit]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        editCollection(btn.getAttribute('data-fr-coll-edit'));
      });
    });
    box.querySelectorAll('[data-fr-coll-del]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteCollectionItem(btn.getAttribute('data-fr-coll-del'));
      });
    });
  }

  function promptCollectionFields(existing) {
    var ex = existing || {};
    return dialogPrompt({ title: '模块名称', value: ex.name || '', placeholder: '例：白色系空间图鉴' }).then(function (name) {
      if (name == null) return null;
      name = String(name || '').trim();
      if (!name) { toast('名称不能为空'); return null; }
      return dialogPrompt({ title: '模块简介', value: ex.description || '', placeholder: '描述这个策展的主题…' }).then(function (desc) {
        if (desc == null) return null;
        return { name: name, description: String(desc || '').trim() };
      });
    });
  }

  function addCollection() {
    promptCollectionFields().then(function (fields) {
      if (!fields) return;
      var stApi = store();
      if (!stApi || !stApi.addCollection) return;
      stApi.addCollection(fields.name, fields.description).then(function () {
        renderCollectionEditorList();
        renderCollections();
        syncNoteCollectionSelect();
        toast('策展已添加');
      });
    });
  }

  function editCollection(id) {
    var stApi = store();
    if (!stApi) return;
    var coll = (stApi.listCollections ? stApi.listCollections() : []).find(function (c) { return c.id === id; });
    if (!coll) return;
    promptCollectionFields(coll).then(function (fields) {
      if (!fields) return;
      stApi.updateCollection(id, fields).then(function () {
        renderCollectionEditorList();
        renderCollections();
        syncNoteCollectionSelect();
        if (currentDiscoverCollection === id) renderDiscoverView();
        toast('策展已更新');
      });
    });
  }

  function deleteCollectionItem(id) {
    dialogConfirm({ title: '删除策展', message: '确定删除这个策展合集吗？合集内的 AI 帖子也会移除。' }).then(function (ok) {
      if (!ok) return;
      var stApi = store();
      if (!stApi || !stApi.deleteCollection) return;
      stApi.deleteCollection(id).then(function () {
        if (currentDiscoverCollection === id) closeDiscoverCollection();
        renderCollectionEditorList();
        renderCollections();
        syncNoteCollectionSelect();
        toast('策展已删除');
      });
    });
  }

  function openDiscoverCollection(collectionId) {
    var cid = String(collectionId || '').trim();
    if (!cid) return;
    currentDiscoverCollection = cid;
    currentDiscoverTopic = null;
    renderDiscoverView();
  }

  function closeDiscoverCollection() {
    currentDiscoverCollection = null;
    renderDiscoverView();
  }

  function renderCollectionFeed() {
    var st = store() ? store().getState() : { posts: [] };
    var posts = filterPostsForFeed(st.posts || [], 'collection');
    renderFeedInto($('fr-disc-coll-feed-bento'), $('fr-disc-coll-feed-empty'), posts);
  }

  function setCollectionFeedStatus(text) {
    var el = $('fr-disc-coll-feed-status');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  async function refreshHotSearch() {
    if (refreshing) return;
    var br = bridge();
    var stApi = store();
    if (!br || !stApi || !br.generateHotSearchTopics) { toast('论坛模块未加载'); return; }
    refreshing = true;
    showLoading('正在刷新热搜…');
    try {
      await stApi.whenReady();
      if (global.miyaWorldbookStore && global.miyaWorldbookStore.whenReady) await global.miyaWorldbookStore.whenReady();
      var forumState = stApi.getState();
      var topics = await br.generateHotSearchTopics(forumState);
      if (stApi.setHotSearchTopics) await stApi.setHotSearchTopics(topics);
      hideLoading();
      renderHotSearch();
      toast('热搜已更新 · ' + topics.length + ' 条');
    } catch (e) {
      hideLoading();
      toast(String(e.message || e));
    }
    refreshing = false;
  }

  async function refreshCollectionFeed() {
    if (refreshing || !currentDiscoverCollection) return;
    var br = bridge();
    var stApi = store();
    if (!br || !stApi || !br.generateCollectionPosts) { toast('论坛模块未加载'); return; }
    var coll = (stApi.listCollections ? stApi.listCollections() : []).find(function (c) {
      return c.id === currentDiscoverCollection;
    });
    if (!coll) { toast('策展不存在'); return; }
    refreshing = true;
    showLoading('正在刷新「' + coll.name + '」帖子…');
    setCollectionFeedStatus('正在刷新帖子…');
    try {
      await stApi.whenReady();
      if (global.miyaWorldbookStore && global.miyaWorldbookStore.whenReady) await global.miyaWorldbookStore.whenReady();
      if (global.miyaContactsStore && global.miyaContactsStore.whenReady) await global.miyaContactsStore.whenReady();
      var forumState = stApi.getState();
      var maskInfo = getActiveMaskInfo();
      var posts = await br.generateCollectionPosts(coll, forumState, maskInfo);
      posts.forEach(function (p) {
        p.commentsFlat = p.commentsFlat || [];
        p.commentsGenerating = false;
      });
      if (stApi.replaceCollectionPosts) await stApi.replaceCollectionPosts(currentDiscoverCollection, posts);
      hideLoading();
      setCollectionFeedStatus('');
      renderCollectionFeed();
      renderCollections();
      var br2 = bridge();
      var maskInfo2 = getActiveMaskInfo();
      if (br2 && br2.buildMentionNotifications) {
        var mentionNotifs = [];
        posts.forEach(function (pp) {
          mentionNotifs = mentionNotifs.concat(br2.buildMentionNotifications(pp, {}, maskInfo2));
        });
        if (mentionNotifs.length) await pushNotifications(mentionNotifs);
      }
      toast('刷新完成');
    } catch (e) {
      hideLoading();
      setCollectionFeedStatus('');
      toast(String(e.message || e));
    }
    refreshing = false;
  }

  function renderFeedInto(box, empty, posts) {
    if (!box) return;
    if (!posts.length) {
      box.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    box.innerHTML = posts.map(function (post, i) {
      var variant = cardVariantClass(i, post);
      var tag = post.authorType === 'character' ? 'CHARACTER' : (post.authorType === 'user' ? 'MINE' : (i === 0 ? 'FEATURED' : 'POST'));
      var commentHint = post.commentsGenerating ? '<span class="fr-card__gen">评论生成中…</span>' : '';
      var genHint = post.generating ? '<span class="fr-card__gen">生成中…</span>' : commentHint;
      return '<article class="fr-card ' + variant + '" data-fr-post-id="' + esc(post.id) + '" role="button" tabindex="0">' +
        (i === 1 ? '<span class="fr-card__deco-num">0' + (i + 1) + '</span>' : '') +
        (i === 3 ? '<span class="fr-card__pin">HOT</span>' : '') +
        renderPostImagesHtml(post.images, i, post.authorType) +
        '<div class="fr-card__body">' +
          '<span class="fr-card__tag">' + tag + '</span>' +
          '<h3 class="fr-card__title">' + esc(post.text.slice(0, 60) + (post.text.length > 60 ? '…' : '')) + '</h3>' +
          (post.text.length > 60 ? '<p class="fr-card__desc">' + esc(post.text) + '</p>' : '') +
          renderTagsHtml(post.tags) +
          '<div class="fr-card__foot">' +
            '<span class="fr-card__author">' + renderAuthorAvatarHtml(post) + formatHandle(post.authorDisplay) + '</span>' +
            '<span class="fr-card__likes">♡ ' + formatLikes(post.likeCount) + ' · ' + formatLikes(post.commentCount) + '评</span>' +
          '</div>' + genHint +
        '</div></article>';
    }).join('');
    box.querySelectorAll('[data-fr-post-id]').forEach(function (el) {
      el.addEventListener('click', function () {
        openPostDetail(el.getAttribute('data-fr-post-id'));
      });
    });
    hydratePostCardImages(box, posts);
    hydrateLazyImages(box);
    hydrateLazyAvatars(box);
  }

  function renderFeed() {
    var st = store() ? store().getState() : { posts: [] };
    var posts = filterPostsForFeed(st.posts || [], 'home');
    renderFeedInto($('fr-feed-bento'), $('fr-feed-empty'), posts);
  }

  function renderDiscoverView() {
    var orbit = document.querySelector('.fr-orbit-stage');
    var collections = document.querySelector('.fr-collections');
    var divider = document.querySelector('.fr-divider');
    var topicList = $('fr-topic-list');
    var topicPanel = $('fr-disc-topic');
    var collPanel = $('fr-disc-collection');
    var inTopic = !!currentDiscoverTopic;
    var inCollection = !!currentDiscoverCollection;
    var inSub = inTopic || inCollection;

    if (orbit) orbit.hidden = inSub;
    if (collections) collections.hidden = inSub;
    if (divider) divider.hidden = inSub;
    if (topicList) topicList.hidden = inSub;
    if (topicPanel) topicPanel.hidden = !inTopic;
    if (collPanel) collPanel.hidden = !inCollection;

    if (inTopic) {
      var titleEl = $('fr-disc-topic-title');
      if (titleEl) titleEl.textContent = '#' + currentDiscoverTopic;
      syncOrbitBubblesActive();
      renderDiscoverFeed();
    } else if (inCollection) {
      var stApi = store();
      var coll = stApi && stApi.listCollections
        ? (stApi.listCollections().find(function (c) { return c.id === currentDiscoverCollection; }) || null)
        : null;
      var collTitle = $('fr-disc-collection-title');
      var collDesc = $('fr-disc-collection-desc');
      if (collTitle) collTitle.textContent = coll ? coll.name : '合集';
      if (collDesc) collDesc.textContent = coll && coll.description ? coll.description : '';
      renderCollectionFeed();
    } else {
      renderHotSearch();
      renderCollections();
      syncOrbitBubblesActive();
    }
    syncTopAction();
  }

  function renderDiscoverFeed() {
    var st = store() ? store().getState() : { posts: [] };
    var posts = filterPostsForFeed(st.posts || [], 'topic');
    renderFeedInto($('fr-disc-feed-bento'), $('fr-disc-feed-empty'), posts);
  }

  function openDiscoverTopic(topic) {
    var t = String(topic || '').trim();
    if (!t) return;
    currentDiscoverTopic = t;
    currentDiscoverCollection = null;
    renderDiscoverView();
  }

  function closeDiscoverTopic() {
    currentDiscoverTopic = null;
    renderDiscoverView();
  }

  function setDiscoverFeedStatus(text) {
    var el = $('fr-disc-feed-status');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  async function generateCommentsInBackground(postId) {
    var br = bridge();
    var stApi = store();
    if (!br || !stApi || !br.generateInitialCommentsForUserPost) return;
    pendingGenTasks++;
    showStatusBar('正在生成评论…');
    var p = findPostById(postId);
    if (!p) {
      pendingGenTasks = Math.max(0, pendingGenTasks - 1);
      if (!pendingGenTasks) hideStatusBarSoon(1200);
      return;
    }
    p.commentsGenerating = true;
    await stApi.syncPostEverywhere(p);
    renderFeed();
    renderDiscoverFeed();
    var prevIds = br.snapshotCommentIds ? br.snapshotCommentIds(p) : {};
    try {
      await stApi.whenReady();
      var forumState = stApi.getState();
      var maskInfo = getMaskInfoForPost(p);
      var result = await br.generateInitialCommentsForUserPost(p, forumState, maskInfo);
      p = result.post || p;
      p.commentsGenerating = false;
      var notifs = br.collectAllEngagementNotifications
        ? br.collectAllEngagementNotifications(p, prevIds, maskInfo, result.suggestedLikes || p.likeCount)
        : [];
      await stApi.syncPostEverywhere(p);
      await pushNotifications(notifs);
      renderFeed();
      renderDiscoverFeed();
      renderCollectionFeed();
      if (detailPostId === postId) openPostDetail(postId);
      showStatusBar('您有新的消息通知', true);
      hideStatusBarSoon(3200);
    } catch (e) {
      p.commentsGenerating = false;
      await stApi.syncPostEverywhere(p);
      renderFeed();
      renderDiscoverFeed();
      renderCollectionFeed();
      toast(String(e.message || e));
      showStatusBar('');
    }
    pendingGenTasks = Math.max(0, pendingGenTasks - 1);
  }

  async function refreshHomeFeed() {
    if (refreshing) return;
    var br = bridge();
    var stApi = store();
    if (!br || !stApi) { toast('论坛模块未加载'); return; }
    refreshing = true;
    showLoading('正在刷新帖子…');
    setFeedStatus('正在刷新帖子…');
    try {
      await stApi.whenReady();
      if (global.miyaWorldbookStore && global.miyaWorldbookStore.whenReady) await global.miyaWorldbookStore.whenReady();
      if (global.miyaContactsStore && global.miyaContactsStore.whenReady) await global.miyaContactsStore.whenReady();
      var forumState = stApi.getState();
      var maskInfo = getActiveMaskInfo();
      var posts = await br.generateHomePosts(forumState, maskInfo);
      posts.forEach(function (p) {
        p.source = 'home';
        p.commentsFlat = p.commentsFlat || [];
        p.commentsGenerating = false;
      });
      var hotTopics = stApi.getHotSearchTopics ? stApi.getHotSearchTopics() : [];
      if (hotTopics.length && br.applyHotSearchTagsToPosts) {
        br.applyHotSearchTagsToPosts(posts, hotTopics);
      }
      if (stApi.replaceHomePosts) await stApi.replaceHomePosts(posts);
      else await stApi.replacePosts(posts);
      hideLoading();
      setFeedStatus('');
      renderFeed();
      var br2 = bridge();
      var maskInfo2 = getActiveMaskInfo();
      if (br2 && br2.buildMentionNotifications) {
        var mentionNotifs = [];
        posts.forEach(function (pp) {
          mentionNotifs = mentionNotifs.concat(br2.buildMentionNotifications(pp, {}, maskInfo2));
        });
        if (mentionNotifs.length) await pushNotifications(mentionNotifs);
      }
      toast('刷新完成');
    } catch (e) {
      hideLoading();
      setFeedStatus('');
      toast(String(e.message || e));
    }
    refreshing = false;
  }

  async function refreshDiscoverFeed() {
    if (refreshing || !currentDiscoverTopic) return;
    var br = bridge();
    var stApi = store();
    if (!br || !stApi || !br.generateTopicPosts) { toast('论坛模块未加载'); return; }
    refreshing = true;
    showLoading('正在刷新「' + currentDiscoverTopic + '」帖子…');
    setDiscoverFeedStatus('正在刷新帖子…');
    try {
      await stApi.whenReady();
      if (global.miyaWorldbookStore && global.miyaWorldbookStore.whenReady) await global.miyaWorldbookStore.whenReady();
      if (global.miyaContactsStore && global.miyaContactsStore.whenReady) await global.miyaContactsStore.whenReady();
      var forumState = stApi.getState();
      var maskInfo = getActiveMaskInfo();
      var posts = await br.generateTopicPosts(currentDiscoverTopic, forumState, maskInfo);
      posts.forEach(function (p) {
        p.commentsFlat = p.commentsFlat || [];
        p.commentsGenerating = false;
      });
      if (stApi.replaceTopicPosts) await stApi.replaceTopicPosts(currentDiscoverTopic, posts);
      else await stApi.replacePosts(posts);
      hideLoading();
      setDiscoverFeedStatus('');
      renderDiscoverFeed();
      var br2 = bridge();
      var maskInfo2 = getActiveMaskInfo();
      if (br2 && br2.buildMentionNotifications) {
        var mentionNotifs = [];
        posts.forEach(function (pp) {
          mentionNotifs = mentionNotifs.concat(br2.buildMentionNotifications(pp, {}, maskInfo2));
        });
        if (mentionNotifs.length) await pushNotifications(mentionNotifs);
      }
      toast('刷新完成');
    } catch (e) {
      hideLoading();
      setDiscoverFeedStatus('');
      toast(String(e.message || e));
    }
    refreshing = false;
  }

  function bindDetailInteractions() {
    var body = $('fr-detail-body');
    if (!body) return;
    body.querySelectorAll('[data-fr-comment-id]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-fr-del-comment]')) return;
        e.stopPropagation();
        detailReplyToId = el.getAttribute('data-fr-comment-id');
        updateReplyComposerHint();
        var input = $('fr-detail-input');
        if (input) input.focus();
      });
    });
    body.querySelectorAll('[data-fr-del-comment]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        var cid = btn.getAttribute('data-fr-del-comment');
        if (cid) deleteUserComment(cid);
      });
    });
    var delPostBtn = $('fr-detail-delete');
    if (delPostBtn) {
      delPostBtn.onclick = function () { deleteUserPost(); };
    }
    var foot = $('fr-detail-comments-foot');
    var moreBtn = foot ? foot.querySelector('[data-fr-more-comments]') : null;
    if (moreBtn) {
      moreBtn.addEventListener('click', function () { loadMoreComments(); });
    }
  }

  async function loadMoreComments() {
    if (detailLoadingMore || !detailPostId) return;
    var br = bridge();
    var stApi = store();
    if (!br || !stApi || !br.generateMoreCommentsForPost) return;
    var p = findPostById(detailPostId);
    if (!p) return;
    detailLoadingMore = true;
    setDetailCommentsGenerating(true);
    var brPrev = bridge();
    var prevIds = brPrev && brPrev.snapshotCommentIds ? brPrev.snapshotCommentIds(p) : {};
    try {
      await stApi.whenReady();
      var forumState = stApi.getState();
      var maskInfo = getMaskInfoForPost(p);
      await br.generateMoreCommentsForPost(p, forumState, maskInfo);
      p.commentsGenerating = false;
      p.awaitingCommentReply = false;
      if (br.collectAllEngagementNotifications) {
        var extra = br.collectAllEngagementNotifications(p, prevIds, maskInfo, 0);
        await pushNotifications(extra);
      }
      if (stApi.syncPostEverywhere) await stApi.syncPostEverywhere(p);
      else if (p.bookmarked && stApi.syncBookmarkedCopy) await stApi.syncBookmarkedCopy(p);
      else await stApi.upsertPost(p);
      openPostDetail(detailPostId);
      renderFeed();
      renderDiscoverFeed();
      renderCollectionFeed();
    } catch (e) {
      p.commentsGenerating = false;
      setDetailCommentsGenerating(false);
      toast(String(e.message || e));
    }
    detailLoadingMore = false;
  }

  function toggleBookmark() {
    if (!detailPostId) return;
    var stApi = store();
    var p = findPostById(detailPostId);
    if (!p || !stApi || !stApi.setPostBookmarked) return;
    var next = !p.bookmarked;
    stApi.setPostBookmarked(p, next).then(function () {
      var updated = findPostById(detailPostId) || p;
      updated.bookmarked = next;
      updateBookmarkButton(updated);
      renderMeProfile();
      toast(next ? '已收藏' : '已取消收藏');
    });
  }

  function openPostDetail(postId) {
    var p = findPostById(postId);
    if (!p) return;
    detailPostId = postId;
    var stApi = store();
    var br = bridge();
    if (br && br.repairCommentReplyTargets) {
      br.repairCommentReplyTargets(p, stApi ? stApi.getState() : {});
      if (p._replyTargetsRepaired && stApi && stApi.syncPostEverywhere) {
        stApi.syncPostEverywhere(p);
      }
    } else if (p.authorType === 'user' && br && br.repairUserCommentReplyTargets) {
      br.repairUserCommentReplyTargets(p, stApi ? stApi.getState() : {});
      if (p._replyTargetsRepaired && stApi && stApi.syncPostEverywhere) {
        stApi.syncPostEverywhere(p);
      }
    }
    if (stApi && stApi.recordPostView) {
      stApi.recordPostView(p).then(function () { renderMeProfile(); });
    }
    var panel = $('fr-post-detail');
    var body = $('fr-detail-body');
    if (!panel || !body) return;
    var comments = getVisibleCommentsForPost(p);
    var commentsListHtml = renderCommentsListHtml(p);
    if (!comments.length && !p.commentsGenerating) {
      commentsListHtml = '<p class="fr-detail__empty">暂无评论</p>';
    }
    var imagesHtml = renderDetailImagesHtml(p.images);
    var tagsHtml = renderTagsHtml(p.tags, 'fr-detail__tags');
    var authorAvaHtml = renderAuthorAvatarHtml(p, true);
    body.innerHTML =
      '<article class="fr-detail__post">' +
        '<div class="fr-detail__post-meta">' + authorAvaHtml +
          formatHandle(p.authorDisplay) +
          (p.authorType === 'character' ? ' · 角色' : (p.authorType === 'user' ? ' · 我' : ' · 网友')) + '</span></div>' +
        imagesHtml +
        '<p class="fr-detail__post-text">' + esc(p.text) + '</p>' +
        tagsHtml +
        (p.location ? '<p class="fr-detail__location">📍 ' + esc(p.location) + '</p>' : '') +
        '<div class="fr-detail__stats">♡ ' + formatLikes(p.likeCount) + ' · ' + formatLikes(comments.length) + ' 条评论</div>' +
      '</article>' +
      '<div class="fr-detail__comments"><h3>评论</h3>' + commentsListHtml +
        '<div class="fr-detail__comments-foot" id="fr-detail-comments-foot">' + renderCommentsFooterHtml(p) + '</div></div>';
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('is-open');
    updateBookmarkButton(p);
    updateReplyComposerHint();
    bindDetailInteractions();
    hydratePostDetailImages(body);
    hydrateLazyAvatars(body);
    var delBtn = $('fr-detail-delete');
    if (delBtn) delBtn.hidden = p.authorType !== 'user';
  }

  function closePostDetail() {
    detailPostId = null;
    clearReplyTarget();
    var panel = $('fr-post-detail');
    slideClose(panel, function () {
      var delBtn = $('fr-detail-delete');
      if (delBtn) delBtn.hidden = true;
    });
  }

  function deleteUserPost() {
    if (!detailPostId) return;
    var stApi = store();
    if (!stApi || !stApi.deletePost) return;
    var p = findPostById(detailPostId);
    if (!p || p.authorType !== 'user') return;
    dialogConfirm({ title: '删除帖子', message: '确定删除这条帖子吗？删除后不可恢复。' }).then(function (ok) {
      if (!ok) return;
      var pid = detailPostId;
      stApi.deletePost(pid).then(function () {
        closePostDetail();
        renderFeed();
        renderDiscoverFeed();
        renderMeProfile();
        toast('帖子已删除');
      });
    });
  }

  function deleteUserComment(commentId) {
    if (!detailPostId || !commentId) return;
    var stApi = store();
    if (!stApi || !stApi.deleteComment) return;
    var p = findPostById(detailPostId);
    if (!p) return;
    var cmt = (p.commentsFlat || []).find(function (c) { return c.id === commentId; });
    if (!cmt || !canDeleteComment(p, cmt)) return;
    dialogConfirm({ title: '删除评论', message: '确定删除这条评论吗？' }).then(function (ok) {
      if (!ok) return;
      stApi.deleteComment(detailPostId, commentId).then(function () {
        openPostDetail(detailPostId);
        renderFeed();
        renderDiscoverFeed();
        toast('评论已删除');
      });
    });
  }

  function sendUserComment() {
    var input = $('fr-detail-input');
    if (!input || !detailPostId) return;
    var text = String(input.value || '').trim();
    if (!text) return;
    var stApi = store();
    var p = findPostById(detailPostId);
    if (!p) return;
    var info = getActiveMaskInfo();
    var replyToId = detailReplyToId || null;
    var replyToLabel = '';
    if (replyToId) {
      var tgt = (p.commentsFlat || []).find(function (c) { return c.id === replyToId; });
      if (tgt) replyToLabel = '回复 @' + tgt.authorDisplay;
    }
    var cmt = {
      id: 'fcmt_user_' + Date.now(),
      authorKind: 'user',
      authorContactId: '',
      authorDisplay: info.nickname || '我',
      authorAvatar: '',
      text: text,
      replyToId: replyToId,
      replyToLabel: replyToLabel,
      likes: 0,
      createdAt: Date.now()
    };
    p.commentsFlat = p.commentsFlat || [];
    p.commentsFlat.push(cmt);
    p.commentCount = p.commentsFlat.length;
    p.awaitingCommentReply = true;
    input.value = '';
    clearReplyTarget();
    var saveChain;
    if (stApi.syncPostEverywhere) saveChain = stApi.syncPostEverywhere(p);
    else if (p.bookmarked && stApi.syncBookmarkedCopy) saveChain = stApi.syncBookmarkedCopy(p);
    else saveChain = stApi.upsertPost(p);
    saveChain.then(function () {
      openPostDetail(detailPostId);
    });
  }

  function openFavorites() {
    var panel = $('fr-favorites');
    var list = $('fr-favorites-list');
    if (!panel || !list || !store()) return;
    var posts = store().listBookmarkedPosts ? store().listBookmarkedPosts() : [];
    if (!posts.length) {
      list.innerHTML = '<p class="fr-favorites__empty">还没有收藏的帖子</p>';
    } else {
      list.innerHTML = posts.map(function (post) {
        var preview = post.text.slice(0, 80) + (post.text.length > 80 ? '…' : '');
        return '<article class="fr-favorites__item" data-fr-fav-post-id="' + esc(post.id) + '" role="button" tabindex="0">' +
          '<div class="fr-favorites__item-head">' + formatHandle(post.authorDisplay) + '</div>' +
          '<p class="fr-favorites__item-text">' + esc(preview) + '</p>' +
          '<span class="fr-favorites__item-meta">♡ ' + formatLikes(post.likeCount) + ' · ' + formatLikes((post.commentsFlat || []).length) + ' 评</span>' +
        '</article>';
      }).join('');
      list.querySelectorAll('[data-fr-fav-post-id]').forEach(function (el) {
        el.addEventListener('click', function () {
          openPostDetail(el.getAttribute('data-fr-fav-post-id'));
        });
      });
    }
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('is-open');
  }

  function closeFavorites() {
    slideClose($('fr-favorites'));
  }

  function formatViewedAt(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function openHistory() {
    var panel = $('fr-history');
    var list = $('fr-history-list');
    if (!panel || !list || !store()) return;
    var posts = store().listBrowsingHistory ? store().listBrowsingHistory() : [];
    if (!posts.length) {
      list.innerHTML = '<p class="fr-favorites__empty">还没有浏览记录</p>';
    } else {
      list.innerHTML = posts.map(function (post) {
        var preview = post.text.slice(0, 80) + (post.text.length > 80 ? '…' : '');
        var when = formatViewedAt(post.viewedAt);
        return '<article class="fr-favorites__item" data-fr-hist-post-id="' + esc(post.id) + '" role="button" tabindex="0">' +
          '<div class="fr-favorites__item-head">' + formatHandle(post.authorDisplay) +
          (when ? ' · ' + esc(when) : '') + '</div>' +
          '<p class="fr-favorites__item-text">' + esc(preview) + '</p>' +
          '<span class="fr-favorites__item-meta">♡ ' + formatLikes(post.likeCount) + ' · ' + formatLikes((post.commentsFlat || []).length) + ' 评</span>' +
        '</article>';
      }).join('');
      list.querySelectorAll('[data-fr-hist-post-id]').forEach(function (el) {
        el.addEventListener('click', function () {
          openPostDetail(el.getAttribute('data-fr-hist-post-id'));
        });
      });
    }
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('is-open');
  }

  function closeHistory() {
    slideClose($('fr-history'));
  }

  function openMyPosts() {
    var panel = $('fr-myposts');
    var list = $('fr-myposts-list');
    if (!panel || !list || !store()) return;
    var posts = store().listUserPosts ? store().listUserPosts() : [];
    if (!posts.length) {
      list.innerHTML = '<p class="fr-favorites__empty">还没有发布过帖子</p>';
    } else {
      list.innerHTML = posts.map(function (post) {
        var preview = post.text.slice(0, 80) + (post.text.length > 80 ? '…' : '');
        var when = formatViewedAt(post.createdAt);
        return '<article class="fr-favorites__item" data-fr-mypost-id="' + esc(post.id) + '" role="button" tabindex="0">' +
          '<div class="fr-favorites__item-head">' + formatHandle(post.authorDisplay) +
          (when ? ' · ' + esc(when) : '') + '</div>' +
          '<p class="fr-favorites__item-text">' + esc(preview) + '</p>' +
          '<span class="fr-favorites__item-meta">♡ ' + formatLikes(post.likeCount) + ' · ' + formatLikes((post.commentsFlat || []).length) + ' 评</span>' +
        '</article>';
      }).join('');
      list.querySelectorAll('[data-fr-mypost-id]').forEach(function (el) {
        el.addEventListener('click', function () {
          openPostDetail(el.getAttribute('data-fr-mypost-id'));
        });
      });
    }
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('is-open');
  }

  function closeMyPosts() {
    slideClose($('fr-myposts'));
  }

  function openSettings() {
    var el = $('fr-settings');
    if (!el) return;
    renderSettingsWorldview();
    renderSettingsWorldbook();
    renderSettingsMasks();
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('is-open');
  }

  function renderSettingsWorldview() {
    var ta = $('fr-settings-worldview');
    if (!ta) return;
    var st = store().getState();
    ta.value = String(st.worldview || '');
    if (ta._bound) return;
    ta._bound = true;
    var saveTimer = null;
    ta.addEventListener('input', function () {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        store().setWorldview(ta.value);
      }, 400);
    });
  }

  function closeSettings() {
    slideClose($('fr-settings'), function () {
      closeActivitySettings(true);
      closeNicknamesSettings(true);
    });
  }

  function openActivitySettings() {
    var el = $('fr-settings-activity');
    if (!el) return;
    renderActivityGroups();
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('is-open');
  }

  function closeActivitySettings(instant) {
    var el = $('fr-settings-activity');
    if (!el) return;
    if (instant) {
      el.classList.remove('is-open');
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
      closeNicknamesSettings(true);
      return;
    }
    slideClose(el, function () { closeNicknamesSettings(true); });
  }

  function openNicknamesSettings() {
    var el = $('fr-settings-nicknames');
    if (!el) return;
    renderNicknamesGroups();
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('is-open');
  }

  function closeNicknamesSettings(instant) {
    var el = $('fr-settings-nicknames');
    if (!el) return;
    if (instant) {
      el.classList.remove('is-open');
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
      return;
    }
    slideClose(el);
  }

  function renderNicknamesGroups() {
    var box = $('fr-nicknames-groups');
    if (!box) return;
    var cs = global.miyaContactsStore;
    var st = store().getState();
    var nicknames = st.characterForumNicknames || {};
    if (!cs || !cs.listGroups) {
      box.innerHTML = '<p class="fr-settings__empty">联系人未加载</p>';
      return;
    }
    var groups = cs.listGroups();
    var chars = cs.listCharacters('all');
    box.innerHTML = groups.map(function (g) {
      var members = chars.filter(function (c) { return c.groupId === g.id; });
      if (!members.length) return '';
      var rows = members.map(function (c) {
        var nick = nicknames[c.id] || nicknames[c.characterId] || '';
        return '<div class="fr-nicknames__row">' +
          '<label class="fr-nicknames__pick">' +
            '<input type="checkbox" data-fr-nick-pick="' + esc(c.id) + '">' +
            '<span class="fr-nicknames__name">' + esc(c.name) + '</span>' +
          '</label>' +
          '<input type="text" class="fr-nicknames__input" data-fr-nick-input="' + esc(c.id) + '" ' +
            'placeholder="论坛昵称" value="' + esc(nick) + '">' +
        '</div>';
      }).join('');
      return '<details class="fr-activity__group">' +
        '<summary class="fr-activity__summary">' + esc(g.name) + ' <span>(' + members.length + ')</span></summary>' +
        '<div class="fr-activity__members">' + rows + '</div></details>';
    }).join('');

    box.querySelectorAll('[data-fr-nick-input]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var cid = inp.getAttribute('data-fr-nick-input');
        store().setCharacterForumNickname(cid, inp.value);
      });
    });
  }

  async function generateSelectedNicknames() {
    var box = $('fr-nicknames-groups');
    if (!box) return;
    var ids = [];
    box.querySelectorAll('input[data-fr-nick-pick]:checked').forEach(function (inp) {
      ids.push(inp.getAttribute('data-fr-nick-pick'));
    });
    if (!ids.length) {
      toast('请先勾选要生成昵称的角色');
      return;
    }
    var br = bridge();
    var stApi = store();
    if (!br || !stApi || !br.generateCharacterForumNicknames) return;
    showLoading('正在生成论坛昵称…');
    try {
      await stApi.whenReady();
      var forumState = stApi.getState();
      var map = await br.generateCharacterForumNicknames(ids, forumState);
      if (!Object.keys(map).length) {
        hideLoading();
        toast('未能生成昵称，请重试');
        return;
      }
      await stApi.setCharacterForumNicknames(map);
      hideLoading();
      renderNicknamesGroups();
      toast('昵称已生成');
    } catch (e) {
      hideLoading();
      toast(String(e.message || e));
    }
  }

  function renderSettingsWorldbook() {
    var box = $('fr-settings-wb-list');
    if (!box) return;
    var wb = global.miyaWorldbookStore;
    var st = store().getState();
    var selected = {};
    (st.worldbookEntryIds || []).forEach(function (id) { selected[id] = true; });
    if (!wb || !wb.listEntries) {
      box.innerHTML = '<p class="fr-settings__empty">世界书未加载</p>';
      return;
    }
    var entries = wb.listEntries().filter(function (e) { return e.enabled !== false; });
    if (!entries.length) {
      box.innerHTML = '<p class="fr-settings__empty">暂无可用世界书词条</p>';
      return;
    }
    box.innerHTML = entries.map(function (e) {
      var on = selected[e.id] ? ' is-on' : '';
      return '<div class="fr-settings__wb-row">' +
        '<span class="fr-settings__wb-name">' + esc(e.name || e.id) + '</span>' +
        '<button type="button" class="fr-toggle' + on + '" data-fr-wb-id="' + esc(e.id) + '" role="switch" aria-checked="' + (selected[e.id] ? 'true' : 'false') + '">' +
          '<span class="fr-toggle__knob"></span>' +
        '</button></div>';
    }).join('');
    box.querySelectorAll('[data-fr-wb-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var on = !btn.classList.contains('is-on');
        btn.classList.toggle('is-on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        var ids = [];
        box.querySelectorAll('.fr-toggle.is-on[data-fr-wb-id]').forEach(function (x) {
          ids.push(x.getAttribute('data-fr-wb-id'));
        });
        store().setWorldbookEntryIds(ids);
      });
    });
  }

  function renderSettingsMasks() {
    var box = $('fr-settings-mask-list');
    if (!box) return;
    var st = store().getState();
    var active = st.activeMask || {};
    var chatStore = global.miyaChatStore;
    var profiles = chatStore && chatStore.getProfiles ? chatStore.getProfiles() : [];
    var html = '';
    profiles.forEach(function (p) {
      var isActive = active.source === 'chat' && active.id === p.id;
      html += '<button type="button" class="fr-settings__mask' + (isActive ? ' is-active' : '') + '" data-fr-mask-source="chat" data-fr-mask-id="' + esc(p.id) + '">' +
        '<span class="fr-settings__mask-name">' + esc(p.name) + '</span>' +
        '<span class="fr-settings__mask-tag">聊天面具</span></button>';
    });
    (st.forumMasks || []).forEach(function (m) {
      var isActive = active.source === 'forum' && active.id === m.id;
      html += '<button type="button" class="fr-settings__mask' + (isActive ? ' is-active' : '') + '" data-fr-mask-source="forum" data-fr-mask-id="' + esc(m.id) + '">' +
        '<span class="fr-settings__mask-name">' + esc(m.nickname || m.name) + '</span>' +
        '<span class="fr-settings__mask-tag">论坛专用</span></button>';
    });
    box.innerHTML = html || '<p class="fr-settings__empty">暂无面具</p>';
    box.querySelectorAll('[data-fr-mask-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var src = btn.getAttribute('data-fr-mask-source');
        var id = btn.getAttribute('data-fr-mask-id');
        store().setActiveMask(src, id).then(function () {
          renderSettingsMasks();
          renderMeProfile();
          toast('已切换面具');
        });
      });
    });
  }

  function renderActivityGroups() {
    var box = $('fr-activity-groups');
    if (!box) return;
    var cs = global.miyaContactsStore;
    var st = store().getState();
    var activity = st.characterActivity || {};
    if (!cs || !cs.listGroups) {
      box.innerHTML = '<p class="fr-settings__empty">联系人未加载</p>';
      return;
    }
    var groups = cs.listGroups();
    var chars = cs.listCharacters('all');
    box.innerHTML = groups.map(function (g) {
      var members = chars.filter(function (c) { return c.groupId === g.id; });
      if (!members.length) return '';
      var rows = members.map(function (c) {
        var lv = activity[c.id] || activity[c.characterId] || 'off';
        return '<div class="fr-activity__row" data-fr-char-id="' + esc(c.id) + '">' +
          '<span class="fr-activity__name">' + esc(c.name) + '</span>' +
          '<select class="fr-activity__select" data-fr-char-id="' + esc(c.id) + '">' +
            ['off', 'low', 'medium', 'high'].map(function (opt) {
              var labels = { off: '关闭', low: '低', medium: '中', high: '高' };
              return '<option value="' + opt + '"' + (lv === opt ? ' selected' : '') + '>' + labels[opt] + '</option>';
            }).join('') +
          '</select></div>';
      }).join('');
      return '<details class="fr-activity__group">' +
        '<summary class="fr-activity__summary">' + esc(g.name) + ' <span>(' + members.length + ')</span></summary>' +
        '<div class="fr-activity__members">' + rows + '</div></details>';
    }).join('');
    box.querySelectorAll('.fr-activity__select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var cid = sel.getAttribute('data-fr-char-id');
        store().setCharacterActivity(cid, sel.value);
      });
    });
  }

  function createForumMask() {
    dialogPrompt({ title: '新建论坛面具名称', value: '论坛旅人' }).then(function (name) {
      if (!name) return;
      store().addForumMask(name).then(function (mask) {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = function () {
          var file = input.files && input.files[0];
          if (!file) return;
          var reader = new FileReader();
          reader.onload = function () {
            var cs = global.miyaChatStore;
            if (!cs || !cs.storeMediaBlob) {
              store().updateForumMask(mask.id, { nickname: name });
              renderSettingsMasks();
              return;
            }
            fetch(reader.result).then(function (r) { return r.blob(); }).then(function (blob) {
              return cs.storeMediaBlob(blob, 'forum-avatar');
            }).then(function (blobId) {
              return store().updateForumMask(mask.id, { avatarBlobId: blobId, nickname: name });
            }).then(function () {
              renderSettingsMasks();
              toast('面具已创建');
            });
          };
          reader.readAsDataURL(file);
        };
        input.click();
      });
    });
  }

  function editMaskField(field) {
    var info = getActiveMaskInfo();
    var st = store().getState();
    var title = field === 'nickname' ? '编辑论坛昵称' : '编辑论坛签名';
    var value = field === 'nickname' ? info.nickname : info.signature;
    dialogPrompt({ title: title, value: value }).then(function (v) {
      if (v == null) return;
      if (info.source === 'forum') {
        var patch = {};
        patch[field] = String(v).trim();
        if (field === 'nickname' && patch.nickname) patch.name = patch.nickname;
        store().updateForumMask(info.id, patch).then(renderMeProfile);
      } else if (info.id) {
        var o = {};
        o[field] = String(v).trim();
        store().setChatMaskOverride(info.id, o).then(renderMeProfile);
      }
    });
  }

  function resetNoteDraft() {
    (noteDraft.images || []).forEach(revokePreviewUrl);
    noteDraft = { text: '', images: [], location: '', tags: [], collectionId: '' };
    var body = $('fr-note-body');
    var loc = $('fr-note-location');
    var tagIn = $('fr-note-tag-input');
    var collSel = $('fr-note-collection');
    if (body) body.value = '';
    if (loc) loc.value = '';
    if (tagIn) tagIn.value = '';
    if (collSel) collSel.value = '';
    renderNoteImages();
    renderNoteTags();
    syncNoteCollectionSelect();
    syncNoteSendButton();
  }

  function syncNoteSendButton() {
    var btn = $('fr-note-send');
    if (!btn) return;
    var body = $('fr-note-body');
    var text = body ? String(body.value || '').trim() : '';
    var hasContent = text || (noteDraft.images && noteDraft.images.length);
    btn.disabled = !hasContent;
  }

  function renderNoteImages() {
    var box = $('fr-note-images');
    var wrap = $('fr-note-add-wrap');
    if (!box) return;
    box.innerHTML = (noteDraft.images || []).map(function (im, idx) {
      if (im.type === 'text-image') {
        return '<div class="fr-note-editor__img-slot fr-note-editor__img-slot--text">' +
          '<button type="button" class="fr-note-editor__img-remove" data-fr-note-rm="' + idx + '">×</button>' +
          esc(im.textBody) + '</div>';
      }
      if (im.type === 'real') {
        return '<div class="fr-note-editor__img-slot fr-note-editor__img-slot--real" data-fr-note-img="' + idx + '">' +
          '<img alt="">' +
          '<button type="button" class="fr-note-editor__img-remove" data-fr-note-rm="' + idx + '">×</button></div>';
      }
      return '';
    }).join('');
    box.querySelectorAll('[data-fr-note-img]').forEach(function (slot) {
      var idx = Math.floor(Number(slot.getAttribute('data-fr-note-img')));
      var im = noteDraft.images[idx];
      if (!im || im.type !== 'real') return;
      var img = slot.querySelector('img');
      if (!img) return;
      applyRealImageToImg(img, im);
    });
    if (wrap) wrap.hidden = (noteDraft.images || []).length >= 3;
    box.querySelectorAll('[data-fr-note-rm]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var i = Math.floor(Number(btn.getAttribute('data-fr-note-rm')));
        revokePreviewUrl(noteDraft.images[i]);
        noteDraft.images.splice(i, 1);
        renderNoteImages();
        syncNoteSendButton();
      });
    });
    hydrateLazyImages(box);
  }

  function renderNoteTags() {
    var box = $('fr-note-tags');
    if (!box) return;
    box.innerHTML = (noteDraft.tags || []).map(function (t, idx) {
      return '<span class="fr-note-editor__tag">#' + esc(String(t).replace(/^#/, '')) +
        '<button type="button" class="fr-note-editor__tag-rm" data-fr-tag-rm="' + idx + '">×</button></span>';
    }).join('');
    box.querySelectorAll('[data-fr-tag-rm]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = Math.floor(Number(btn.getAttribute('data-fr-tag-rm')));
        noteDraft.tags.splice(i, 1);
        renderNoteTags();
      });
    });
  }

  function addNoteTag(raw) {
    var t = String(raw || '').trim().replace(/^#+/, '');
    if (!t) return;
    noteDraft.tags = noteDraft.tags || [];
    if (noteDraft.tags.length >= 8) {
      toast('最多 8 个话题标签');
      return;
    }
    if (noteDraft.tags.some(function (x) { return x.toLowerCase() === t.toLowerCase(); })) return;
    noteDraft.tags.push(t);
    renderNoteTags();
    var inp = $('fr-note-tag-input');
    if (inp) inp.value = '';
  }

  function openNoteEditor() {
    resetNoteDraft();
    syncNoteCollectionSelect();
    var el = $('fr-note-editor');
    if (!el) return;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(function () { el.classList.add('is-open'); });
  }

  function closeNoteEditor() {
    slideClose($('fr-note-editor'));
  }

  function handleNoteImageFile(file) {
    if ((noteDraft.images || []).length >= 3) {
      toast('最多 3 张图片');
      return;
    }
    var previewUrl = '';
    try { previewUrl = URL.createObjectURL(file); } catch (e0) {}
    var draftItem = { type: 'real', file: file, previewUrl: previewUrl, src: '', imageKey: '' };
    noteDraft.images.push(draftItem);
    renderNoteImages();
    syncNoteSendButton();
    storeForumImageFile(file, 'forum-post').then(function (blobId) {
      if (!blobId) return;
      draftItem.imageKey = blobId;
    }).catch(function () {});
  }

  function addRealNoteImage() {
    if ((noteDraft.images || []).length >= 3) {
      toast('最多 3 张图片');
      return;
    }
    openForumImageFilePicker('note');
  }

  function addTextNoteImage() {
    if ((noteDraft.images || []).length >= 3) {
      toast('最多 3 张图片');
      return;
    }
    dialogPrompt({ title: '文字图片描述', value: '', placeholder: '描述这张「文字图片」的内容…' }).then(function (v) {
      var text = String(v || '').trim();
      if (!text) return;
      noteDraft.images.push({ type: 'text-image', textBody: text.slice(0, 500) });
      renderNoteImages();
      syncNoteSendButton();
    });
  }

  async function publishNotePost() {
    var bodyEl = $('fr-note-body');
    var locEl = $('fr-note-location');
    var text = bodyEl ? String(bodyEl.value || '').trim() : '';
    var location = locEl ? String(locEl.value || '').trim() : '';
    var collSel = $('fr-note-collection');
    var collectionId = collSel ? String(collSel.value || '').trim() : '';
    if (!text && !(noteDraft.images && noteDraft.images.length)) {
      toast('请填写正文或添加图片');
      return;
    }
    var stApi = store();
    if (!stApi) return;
    var info = getActiveMaskInfo();
    var collName = '';
    if (collectionId && stApi.listCollections) {
      var coll = stApi.listCollections().find(function (c) { return c.id === collectionId; });
      if (coll) collName = coll.name;
    }
    var tags = (noteDraft.tags || []).slice();
    if (collName && tags.indexOf(collName) < 0) tags.unshift(collName);
    var draftImages = (noteDraft.images || []).slice(0, 3);
    var images = [];
    for (var di = 0; di < draftImages.length; di++) {
      var dim = draftImages[di];
      if (!dim) continue;
      if (dim.type === 'real') {
        var imageKey = String(dim.imageKey || '').trim();
        if (!imageKey && dim.file) {
          try {
            imageKey = await storeForumImageFile(dim.file, 'forum-post');
          } catch (eImg) {
            imageKey = '';
          }
        }
        if (!imageKey) {
          toast('图片上传失败，请重试');
          return;
        }
        images.push({
          type: 'real',
          src: '',
          imageKey: imageKey,
          imageDesc: dim.imageDesc || ''
        });
      } else {
        images.push(dim);
      }
    }
    var post = {
      id: stApi.nowId(),
      authorType: 'user',
      authorContactId: '',
      authorDisplay: info.nickname || '我',
      authorAvatar: '',
      authorAvatarBlobId: info.avatarBlobId || '',
      authorMaskSource: info.source || 'chat',
      authorMaskId: info.id || '',
      text: text,
      images: images,
      location: location,
      tags: tags,
      collectionId: collectionId,
      postKind: (noteDraft.images && noteDraft.images.length) ? 'image' : 'text',
      createdAt: Date.now(),
      likeCount: 0,
      commentCount: 0,
      likedByUser: false,
      bookmarked: false,
      commentsFlat: [],
      source: collectionId ? 'collection' : 'user',
      commentsGenerating: true,
      generating: false,
      awaitingCommentReply: false
    };
    closeNoteEditor();
    closeCompose();
    resetNoteDraft();
    await stApi.upsertPost(post);
    renderFeed();
    setTab('home');
    toast('发布成功');
    rollFollowersOnPost(post);
    generateCommentsInBackground(post.id);
  }

  function openCompose() {
    composeOpen = true;
    var el = $('fr-compose');
    if (el) el.classList.add('is-open');
  }

  function closeCompose() {
    composeOpen = false;
    var el = $('fr-compose');
    if (el) el.classList.remove('is-open');
  }

  function syncDate() {
    var el = $('fr-home-date');
    if (!el) return;
    var d = new Date();
    var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    el.innerHTML = MON[d.getMonth()] + ' · ' + WD[d.getDay()] + '<br>Vol.' + (d.getMonth() + 1) + String(d.getDate()).padStart(2, '0');
  }

  function bindEvents() {
    var back = $('fr-back');
    if (back) back.addEventListener('click', closeForumApp);

    document.querySelectorAll('[data-fr-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-fr-tab');
        if (tab) setTab(tab);
      });
    });

    var topAction = $('fr-top-action');
    if (topAction) topAction.addEventListener('click', runTopAction);

    document.querySelectorAll('.fr-disc-sub-refresh').forEach(function (btn) {
      btn.addEventListener('click', runTopAction);
    });

    var collMore = $('fr-collections-more');
    if (collMore) collMore.addEventListener('click', openCollectionEditor);

    var collEditorBack = $('fr-coll-editor-back');
    if (collEditorBack) collEditorBack.addEventListener('click', closeCollectionEditor);

    var collEditorAdd = $('fr-coll-editor-add');
    if (collEditorAdd) collEditorAdd.addEventListener('click', addCollection);

    var discCollBack = $('fr-disc-collection-back');
    if (discCollBack) discCollBack.addEventListener('click', closeDiscoverCollection);

    var noteCollection = $('fr-note-collection');
    if (noteCollection) {
      noteCollection.addEventListener('change', function () {
        noteDraft.collectionId = String(noteCollection.value || '').trim();
      });
    }

    document.querySelectorAll('[data-fr-topic]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openDiscoverTopic(btn.getAttribute('data-fr-topic'));
      });
    });

    bindOrbitBubbles();

    var discTopicBack = $('fr-disc-topic-back');
    if (discTopicBack) discTopicBack.addEventListener('click', closeDiscoverTopic);

    var fab = $('fr-nav-fab');
    if (fab) fab.addEventListener('click', openCompose);

    var composeClose = $('fr-compose-close');
    if (composeClose) composeClose.addEventListener('click', closeCompose);

    var composeVeil = $('fr-compose-veil');
    if (composeVeil) composeVeil.addEventListener('click', closeCompose);

    document.querySelectorAll('[data-fr-compose]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-fr-compose') || '';
        closeCompose();
        if (kind === '图文笔记') openNoteEditor();
        else toast('「' + kind + '」功能即将上线');
      });
    });

    document.querySelectorAll('[data-fr-inbox-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        inboxFilter = btn.getAttribute('data-fr-inbox-filter') || 'all';
        document.querySelectorAll('.fr-inbox-tab').forEach(function (t) { t.classList.remove('is-active'); });
        btn.classList.add('is-active');
        renderInbox();
      });
    });

    var noteBack = $('fr-note-back');
    if (noteBack) noteBack.addEventListener('click', closeNoteEditor);

    var noteSend = $('fr-note-send');
    if (noteSend) noteSend.addEventListener('click', publishNotePost);

    var noteBody = $('fr-note-body');
    if (noteBody) noteBody.addEventListener('input', syncNoteSendButton);

    var noteAddReal = $('fr-note-add-real');
    if (noteAddReal) noteAddReal.addEventListener('click', addRealNoteImage);

    var noteAddText = $('fr-note-add-text');
    if (noteAddText) noteAddText.addEventListener('click', addTextNoteImage);

    var noteTagAdd = $('fr-note-tag-add');
    if (noteTagAdd) {
      noteTagAdd.addEventListener('click', function () {
        var inp = $('fr-note-tag-input');
        addNoteTag(inp ? inp.value : '');
      });
    }

    var noteTagInput = $('fr-note-tag-input');
    if (noteTagInput) {
      noteTagInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addNoteTag(noteTagInput.value);
        }
      });
    }

    var boardEdit = $('fr-me-board-edit');
    if (boardEdit) boardEdit.addEventListener('click', openBoardEditor);

    var boardBack = $('fr-me-board-back');
    if (boardBack) boardBack.addEventListener('click', closeBoardEditor);

    var boardSave = $('fr-me-board-save');
    if (boardSave) boardSave.addEventListener('click', saveBoardEditor);

    document.querySelectorAll('[data-fr-edit]').forEach(function (el) {
      el.addEventListener('click', function () {
        editMaskField(el.getAttribute('data-fr-edit'));
      });
    });

    var settingsBack = $('fr-settings-back');
    if (settingsBack) settingsBack.addEventListener('click', closeSettings);

    var activityOpen = $('fr-settings-activity-open');
    if (activityOpen) activityOpen.addEventListener('click', openActivitySettings);

    var activityBack = $('fr-activity-back');
    if (activityBack) activityBack.addEventListener('click', closeActivitySettings);

    var nicknamesOpen = $('fr-settings-nicknames-open');
    if (nicknamesOpen) nicknamesOpen.addEventListener('click', openNicknamesSettings);

    var nicknamesBack = $('fr-nicknames-back');
    if (nicknamesBack) nicknamesBack.addEventListener('click', closeNicknamesSettings);

    var nicknamesGen = $('fr-nicknames-generate');
    if (nicknamesGen) nicknamesGen.addEventListener('click', generateSelectedNicknames);

    var maskAdd = $('fr-settings-mask-add');
    if (maskAdd) maskAdd.addEventListener('click', createForumMask);

    var detailBack = $('fr-detail-back');
    if (detailBack) detailBack.addEventListener('click', closePostDetail);

    var detailBookmark = $('fr-detail-bookmark');
    if (detailBookmark) detailBookmark.addEventListener('click', toggleBookmark);

    var favOpen = $('fr-me-fav-open');
    if (favOpen) favOpen.addEventListener('click', openFavorites);

    var favBack = $('fr-favorites-back');
    if (favBack) favBack.addEventListener('click', closeFavorites);

    var histOpen = $('fr-me-hist-open');
    if (histOpen) histOpen.addEventListener('click', openHistory);

    var histBack = $('fr-history-back');
    if (histBack) histBack.addEventListener('click', closeHistory);

    var myPostsOpen = $('fr-me-myposts-open');
    if (myPostsOpen) myPostsOpen.addEventListener('click', openMyPosts);

    var myPostsBack = $('fr-myposts-back');
    if (myPostsBack) myPostsBack.addEventListener('click', closeMyPosts);

    var detailSend = $('fr-detail-send');
    if (detailSend) detailSend.addEventListener('click', sendUserComment);

    var detailInput = $('fr-detail-input');
    if (detailInput) {
      detailInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') sendUserComment();
      });
    }
  }

  function ensureDefaultMask() {
    var stApi = store();
    if (!stApi) return Promise.resolve();
    var st = stApi.getState();
    if (st.activeMask && st.activeMask.id) return Promise.resolve();
    var chatStore = global.miyaChatStore;
    var prof = chatStore && chatStore.getActiveProfile ? chatStore.getActiveProfile() : null;
    if (prof) return stApi.setActiveMask('chat', prof.id);
    return Promise.resolve();
  }

  function openForumApp() {
    var el = $('miya-forum-app');
    if (!el) return;
    syncDate();
    var chain = Promise.resolve();
    if (store() && store().whenReady) chain = chain.then(function () { return store().whenReady(); });
    var contactsStore = global.miyaContactsStore;
    if (contactsStore && contactsStore.whenReady) {
      chain = chain.then(function () { return contactsStore.whenReady(); });
    }
    chain = chain.then(function () { return ensureDefaultMask(); });
    chain.then(function () {
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      setTab('home');
      closeCompose();
      closeNoteEditor();
      renderPolaroidWall();
      requestAnimationFrame(function () {
        syncInboxBadge();
      });
    });
  }

  function closeForumApp() {
    var el = $('miya-forum-app');
    if (!el) return;
    currentDiscoverTopic = null;
    currentDiscoverCollection = null;
    var instant = { instant: true };
    closeCompose();
    slideClose($('fr-note-editor'), instant);
    slideClose($('fr-coll-editor'), instant);
    slideClose($('fr-settings'), instant);
    slideClose($('fr-settings-activity'), instant);
    slideClose($('fr-settings-nicknames'), instant);
    slideClose($('fr-post-detail'), instant);
    slideClose($('fr-favorites'), instant);
    slideClose($('fr-history'), instant);
    slideClose($('fr-myposts'), instant);
    slideClose($('fr-me-board-editor'), instant);
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-worldbook-app.is-open') &&
        !document.querySelector('.miya-contacts-app.is-open') &&
        !document.querySelector('#miya-music-app.is-open') &&
        !document.querySelector('#miya-chat-app.is-open') &&
        !document.querySelector('#miya-memory-app.is-open') &&
        !document.querySelector('#miya-typewriter-app.is-open') &&
        !document.querySelector('.miya-forum-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  function repairStoredCommentReplyTargets() {
    var br = bridge();
    var stApi = store();
    if (!br || !br.repairCommentReplyTargets || !stApi || !stApi.mergeState) return Promise.resolve();
    var st = stApi.getState();
    var touched = false;
    function repairList(list) {
      (list || []).forEach(function (p) {
        if (!p || !Array.isArray(p.commentsFlat) || !p.commentsFlat.length) return;
        br.repairCommentReplyTargets(p, st);
        if (p._replyTargetsRepaired) touched = true;
      });
    }
    repairList(st.posts);
    repairList(st.bookmarkedPosts);
    repairList(st.browsingHistory);
    if (!touched) return Promise.resolve();
    return stApi.mergeState(function (cur) {
      cur.posts = st.posts;
      cur.bookmarkedPosts = st.bookmarkedPosts;
      cur.browsingHistory = st.browsingHistory;
      return cur;
    });
  }

  bindEvents();
  syncDate();
  setInterval(syncDate, 60000);
  if (store() && store().whenReady) store().whenReady().then(function () {
    return repairStoredCommentReplyTargets();
  }).then(function () {
    renderFeed();
    syncInboxBadge();
  });

  global.miyaForumApp = {
    open: openForumApp,
    close: closeForumApp,
    setTab: setTab,
    refreshFeed: refreshHomeFeed
  };
})(window);
