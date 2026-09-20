/**
 * miya-deep-xhs.js — 深入 · 角色手机 小红书（白底红点 · 双栏瀑布 · 消息/我的子页）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var DOCK = [
    { id: 'home', label: '首页' },
    { id: 'market', label: '市集' },
    { id: 'plus', label: '' },
    { id: 'msg', label: '消息' },
    { id: 'me', label: '我' }
  ];

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    xhsData: null,
    refreshing: false,
    built: false,
    page: 'home',
    homeTab: '发现',
    meTab: '笔记',
    noteId: '',
    noteSource: '',
    chatId: '',
    notifyKind: '',
    homeScroll: 0,
    noteFocusComments: false
  };

  var ICO = {
    heart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    heartOn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" stroke-width="1.2"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.8 6.7 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" stroke-width="1.2"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.8 6.7 19.6l1-5.8L3.5 9.7l5.9-.9L12 3.5z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-11.8 7L5 20l1.2-3A8 8 0 1 1 20 12z"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>',
    heartSm: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    heartSmOn: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    smile: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 10h.01M15.5 10h.01M8.8 14.2c.9 1.1 2 1.6 3.2 1.6s2.3-.5 3.2-1.6"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="6.5"/><path d="M16.2 16.2L20 20"/></svg>',
    bubble: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 10h8M8 14h5"/><path d="M20 12a8 8 0 0 1-12.5 6.6L4 20l1.6-3.2A8 8 0 1 1 20 12z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>',
    sort: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h10M4 12h7M4 17h4"/></svg>'
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function xhsStore() { return global.miyaDeepXhsStore || null; }
  function xhsBridge() { return global.miyaDeepXhsBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function toast(msg) {
    var el = $('dp-xhs-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-xhs-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的小红书数据');
    statusDotsTimer = setInterval(function () {
      statusDotsFrame = (statusDotsFrame + 1) % 4;
      text.textContent = base + '.'.repeat(statusDotsFrame);
    }, 420);
  }

  function clearSuccessFlash() {
    clearTimeout(successFlashTimer);
    successFlashTimer = 0;
  }

  function showSuccessFlash() {
    clearSuccessFlash();
    updateStatusBar();
    successFlashTimer = setTimeout(function () {
      successFlashTimer = 0;
      updateStatusBar();
    }, 2000);
  }

  function updateStatusBar() {
    var bar = $('dp-xhs-status');
    var text = $('dp-xhs-status-text');
    if (!bar || !text) return;
    var data = state.xhsData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的小红书数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '小红书已同步';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-xhs__status';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-xhs__status is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-xhs-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.xhsData && state.xhsData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.xhsData && state.xhsData.xhs ? state.xhsData.xhs : null;
  }

  function hasContent(x) {
    if (!x) return false;
    return !!(
      (x.feed && x.feed.length) ||
      (x.followingFeed && x.followingFeed.length) ||
      (x.market && x.market.length) ||
      (x.messages && x.messages.chats && x.messages.chats.length) ||
      (x.profile && (
        (x.profile.meNotes && x.profile.meNotes.length) ||
        (x.profile.collections && x.profile.collections.length) ||
        (x.profile.liked && x.profile.liked.length)
      )) ||
      trim(x.nickname) ||
      trim(x.bio) ||
      trim(x.footerNote) ||
      trim(x.nightThought)
    );
  }

  function persistPayload() {
    var ts = xhsStore();
    if (!ts || !state.contactId || !state.xhsData) return Promise.resolve(null);
    return ts.patchXhs(state.contactId, { xhs: state.xhsData.xhs }).then(function (saved) {
      state.xhsData = saved;
      return saved;
    });
  }

  function captureScroll() {
    var sc = $('dp-xhs-scroll');
    return sc ? sc.scrollTop : 0;
  }

  function restoreScroll(top) {
    var sc = $('dp-xhs-scroll');
    if (sc) sc.scrollTop = top || 0;
  }

  function avatarLetter(name) {
    var n = trim(name) || '红';
    return n.charAt(0);
  }

  function kindLabel(kind) {
    var map = {
      life: '日常', food: '美食', outfit: '穿搭', travel: '旅行',
      tips: '干货', mood: '心情', shop: '种草'
    };
    return map[kind] || '笔记';
  }

  function collectAllNotes(x) {
    var list = [];
    function push(arr, source) {
      (arr || []).forEach(function (n) {
        if (n) list.push({ note: n, source: source });
      });
    }
    push(x.feed, 'feed');
    push(x.followingFeed, 'followingFeed');
    if (x.profile) {
      push(x.profile.meNotes, 'meNotes');
      push(x.profile.collections, 'collections');
      push(x.profile.liked, 'liked');
    }
    return list;
  }

  function findNote(id) {
    var x = getPayload();
    if (!x || !id) return null;
    var all = collectAllNotes(x);
    var i;
    for (i = 0; i < all.length; i++) {
      if (all[i].note.id === id) return all[i];
    }
    return null;
  }

  function findChat(id) {
    var x = getPayload();
    if (!x || !x.messages) return null;
    var found = null;
    (x.messages.chats || []).forEach(function (c) {
      if (c && c.id === id) found = c;
    });
    return found;
  }

  function coverHeightClass(n, index) {
    if (n && n.coverKind === 'mood') return ' is-tall';
    if (n && n.coverKind === 'text') return ' is-mid';
    if (index % 5 === 0) return ' is-tall';
    if (index % 3 === 1) return ' is-mid';
    return '';
  }

  function buildNoteCard(n, index, opts) {
    if (!n) return '';
    opts = opts || {};
    var author = n.author || (opts.forceAuthor ? (getPayload() && getPayload().nickname) : '') || state.contactName || '用户';
    return (
      '<article class="dp-xhs__card' + coverHeightClass(n, index || 0) + (n.liked ? ' is-liked' : '') +
        '" data-act="open-note" data-id="' + esc(n.id) + '">' +
        '<div class="dp-xhs__cover tone-' + esc(n.coverTone) + ' kind-' + esc(n.coverKind) + '">' +
          (n.pinned ? '<span class="dp-xhs__pin">置顶</span>' : '') +
          '<div class="dp-xhs__cover-stage" aria-hidden="true">' +
            '<span class="dp-xhs__cover-dots"></span>' +
            (n.time ? '<span class="dp-xhs__cover-date">' + esc(String(n.time).slice(0, 12)) + '</span>' : '') +
            '<div class="dp-xhs__cover-text">' + esc(n.coverText || n.title) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="dp-xhs__card-body">' +
          '<h3 class="dp-xhs__card-title">' + esc(n.title) + '</h3>' +
          '<div class="dp-xhs__card-meta">' +
            '<span class="dp-xhs__mini-av tone-' + esc(n.authorTone || 'mist') + '">' + esc(avatarLetter(author)) + '</span>' +
            '<span class="dp-xhs__author">' + esc(author) + '</span>' +
            '<button type="button" class="dp-xhs__like' + (n.liked ? ' is-on' : '') +
              '" data-act="like-note" data-id="' + esc(n.id) + '" aria-label="点赞">' +
              (n.liked ? ICO.heartSmOn : ICO.heartSm) +
              '<em>' + esc(n.likes || '0') + '</em>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function buildWaterfall(notes, opts) {
    var left = [];
    var right = [];
    (notes || []).forEach(function (n, i) {
      var html = buildNoteCard(n, i, opts);
      if (i % 2 === 0) left.push(html);
      else right.push(html);
    });
    return (
      '<div class="dp-xhs__waterfall">' +
        '<div class="dp-xhs__col">' + left.join('') + '</div>' +
        '<div class="dp-xhs__col">' + right.join('') + '</div>' +
      '</div>'
    );
  }

  function buildHomePage(x) {
    var tabs = x.homeTabs && x.homeTabs.length ? x.homeTabs : ['关注', '发现', '附近'];
    var active = state.homeTab || x.activeHomeTab || '发现';
    var notes = active === '关注' ? (x.followingFeed || []) : (x.feed || []);
    if (active !== '关注' && active !== '发现' && !notes.length) notes = x.feed || [];

    return (
      '<div class="dp-xhs__home">' +
        '<div class="dp-xhs__home-bar">' +
          '<button type="button" class="dp-xhs__ghost-ico" data-act="tab" data-tab="msg" aria-label="消息">' + ICO.bubble + '</button>' +
          '<div class="dp-xhs__home-tabs">' +
            tabs.map(function (t) {
              return (
                '<button type="button" class="dp-xhs__home-tab' + (t === active ? ' is-on' : '') +
                  '" data-act="home-tab" data-tab="' + esc(t) + '">' + esc(t) + '</button>'
              );
            }).join('') +
          '</div>' +
          '<button type="button" class="dp-xhs__ghost-ico" data-act="focus-search" aria-label="搜索">' + ICO.search + '</button>' +
        '</div>' +
        (notes.length ? buildWaterfall(notes) : '<div class="dp-xhs__soft-empty">这一栏还没有笔记</div>') +
      '</div>'
    );
  }

  function buildMarketPage(x) {
    var items = x.market || [];
    return (
      '<div class="dp-xhs__market">' +
        '<header class="dp-xhs__page-head">' +
          '<h2>市集</h2>' +
          '<p>ta 会点开的好物与小店</p>' +
        '</header>' +
        (items.length
          ? '<div class="dp-xhs__market-list">' + items.map(function (m) {
              return (
                '<article class="dp-xhs__market-card' + (m.opened ? ' is-open' : '') + '" data-act="toggle-market" data-id="' + esc(m.id) + '">' +
                  '<div class="dp-xhs__market-cover tone-' + esc(m.coverTone) + '" aria-hidden="true"></div>' +
                  '<div class="dp-xhs__market-body">' +
                    '<h3>' + esc(m.title) + '</h3>' +
                    '<div class="dp-xhs__market-row">' +
                      '<strong>' + esc(m.price || '询价') + '</strong>' +
                      '<span>' + esc(m.shop || '') + '</span>' +
                    '</div>' +
                    '<p>' + esc(m.note || '') + '</p>' +
                    (m.opened && m.reason ? '<div class="dp-xhs__market-reason">' + esc(m.reason) + '</div>' : '') +
                  '</div>' +
                '</article>'
              );
            }).join('') + '</div>'
          : '<div class="dp-xhs__soft-empty">市集还是空的</div>') +
      '</div>'
    );
  }

  function buildMsgPage(x) {
    var msg = x.messages || { categories: {}, chats: [] };
    var cats = msg.categories || {};
    var likes = cats.likes || {};
    var follows = cats.follows || {};
    var comments = cats.comments || {};

    function catCard(kind, label, tone, data, svg) {
      return (
        '<button type="button" class="dp-xhs__cat" data-act="open-notify" data-kind="' + kind + '">' +
          '<span class="dp-xhs__cat-orb tone-' + tone + '" aria-hidden="true">' + svg + '</span>' +
          '<span class="dp-xhs__cat-label">' + esc(label) + '</span>' +
          (data.count ? '<span class="dp-xhs__cat-count">' + esc(data.count) + '</span>' : '') +
        '</button>'
      );
    }

    var icoHeart =
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>';
    var icoUser =
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="9" r="3.2"/><path d="M6.5 18.5c1.4-2.4 3.3-3.5 5.5-3.5s4.1 1.1 5.5 3.5"/></svg>';
    var icoChat =
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 0 1-11.8 7L5 20l1.2-3A8 8 0 1 1 20 12z"/></svg>';
    var icoPlus =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/></svg>';

    return (
      '<div class="dp-xhs__msg">' +
        '<header class="dp-xhs__msg-head">' +
          '<span class="dp-xhs__msg-side" aria-hidden="true"></span>' +
          '<h2>消息</h2>' +
          '<div class="dp-xhs__msg-tools">' +
            '<button type="button" class="dp-xhs__ghost-ico" data-act="focus-search" aria-label="搜索">' + ICO.search + '</button>' +
            '<button type="button" class="dp-xhs__ghost-ico" data-act="plus" aria-label="更多">' + icoPlus + '</button>' +
          '</div>' +
        '</header>' +
        '<div class="dp-xhs__cats">' +
          catCard('likes', '赞和收藏', 'rose', likes, icoHeart) +
          catCard('follows', '新增关注', 'sky', follows, icoUser) +
          catCard('comments', '评论和@', 'tea', comments, icoChat) +
        '</div>' +
        '<div class="dp-xhs__chat-list">' +
          ((msg.chats || []).map(function (c) {
            return (
              '<button type="button" class="dp-xhs__chat-row" data-act="open-chat" data-id="' + esc(c.id) + '">' +
                '<span class="dp-xhs__chat-av tone-' + esc(c.tone) + '">' + esc(avatarLetter(c.name)) + '</span>' +
                '<span class="dp-xhs__chat-main">' +
                  '<span class="dp-xhs__chat-name">' + esc(c.name) + '</span>' +
                  '<span class="dp-xhs__chat-preview">' + esc(c.preview || c.online || '') + '</span>' +
                '</span>' +
                '<span class="dp-xhs__chat-right">' +
                  '<em class="dp-xhs__chat-time">' + esc(c.time) + '</em>' +
                  (c.unread ? '<span class="dp-xhs__dot" aria-label="未读"></span>' : '') +
                '</span>' +
              '</button>'
            );
          }).join('') || '<div class="dp-xhs__soft-empty">还没有私信</div>') +
        '</div>' +
      '</div>'
    );
  }

  function buildMePage(x) {
    var p = x.profile || {};
    var tab = state.meTab || '笔记';
    var nick = x.nickname || state.contactName || '用户';
    var grid = '';
    if (tab === '评论') {
      grid = '<div class="dp-xhs__me-comments">' +
        ((p.myComments || []).map(function (c) {
          return (
            '<article class="dp-xhs__me-cmt">' +
              '<strong>' + esc(c.noteTitle || '相关笔记') + '</strong>' +
              '<p>' + esc(c.text) + '</p>' +
              '<em>' + esc(c.time) + '</em>' +
            '</article>'
          );
        }).join('') || '<div class="dp-xhs__soft-empty">还没有评论</div>') +
        '</div>';
    } else if (tab === '收藏') {
      grid = buildWaterfall(p.collections || []);
    } else if (tab === '赞过') {
      grid = buildWaterfall(p.liked || []);
    } else {
      var notes = (p.meNotes || []).map(function (n) {
        return Object.assign({}, n, { author: n.author || nick });
      });
      var draftHtml = trim(p.drafts)
        ? '<article class="dp-xhs__draft" data-act="noop"><div class="dp-xhs__draft-inner"><span>草稿箱</span><em>· ' + esc(p.drafts) + '</em></div></article>'
        : '';
      var left = draftHtml ? [draftHtml] : [];
      var right = [];
      notes.forEach(function (n, i) {
        var html = buildNoteCard(n, i, { forceAuthor: true });
        if (i % 2 === 0) left.push(html);
        else right.push(html);
      });
      grid =
        '<div class="dp-xhs__waterfall">' +
          '<div class="dp-xhs__col">' + left.join('') + '</div>' +
          '<div class="dp-xhs__col">' + right.join('') + '</div>' +
        '</div>';
    }

    var stats = x.stats || {};
    return (
      '<div class="dp-xhs__me">' +
        '<div class="dp-xhs__me-hero tone-' + esc(x.avatarTone || 'night') + '">' +
          '<div class="dp-xhs__me-tools">' +
            '<button type="button" class="dp-xhs__me-ico" data-act="close-app" aria-label="返回">' + ICO.back + '</button>' +
            '<div class="dp-xhs__me-tool-right">' +
              '<span class="dp-xhs__me-pill">编辑主页</span>' +
              '<button type="button" class="dp-xhs__me-ico" data-act="xhs-refresh" aria-label="刷新">' +
                '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 4v5h-5"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="dp-xhs__me-idrow">' +
            '<span class="dp-xhs__me-av tone-' + esc(x.avatarTone || 'night') + '">' + esc(avatarLetter(nick)) + '</span>' +
            '<div class="dp-xhs__me-names">' +
              '<h2>' + esc(nick) + '</h2>' +
              '<p>小红书号：' + esc(x.xhsId || '—') +
                (x.ipLocation ? '<i></i>IP: ' + esc(x.ipLocation) : '') + '</p>' +
            '</div>' +
          '</div>' +
          '<div class="dp-xhs__me-stats">' +
            '<span><strong>' + esc(stats.following || '0') + '</strong>关注</span>' +
            '<span><strong>' + esc(stats.followers || '0') + '</strong>粉丝</span>' +
            '<span><strong>' + esc(stats.likes || '0') + '</strong>获赞与收藏</span>' +
          '</div>' +
          (trim(x.bio) ? '<p class="dp-xhs__me-bio">' + esc(x.bio) + '</p>' : '') +
          '<div class="dp-xhs__me-actions">' +
            '<button type="button" data-act="noop">浏览记录</button>' +
            '<button type="button" data-act="noop">钱包</button>' +
          '</div>' +
        '</div>' +
        '<div class="dp-xhs__me-sheet">' +
          '<div class="dp-xhs__me-tabs">' +
            ['笔记', '评论', '收藏', '赞过'].map(function (t) {
              return (
                '<button type="button" class="dp-xhs__me-tab' + (t === tab ? ' is-on' : '') +
                  '" data-act="me-tab" data-tab="' + esc(t) + '">' + esc(t) + '</button>'
              );
            }).join('') +
            '<button type="button" class="dp-xhs__me-search" data-act="focus-search" aria-label="搜索">' + ICO.search + '</button>' +
          '</div>' +
          (trim(p.banner)
            ? '<div class="dp-xhs__me-banner"><span>' + esc(p.banner) + '</span><em>去使用</em></div>'
            : '') +
          grid +
        '</div>' +
      '</div>'
    );
  }

  function buildFooter(x) {
    return '';
  }

  function buildDock() {
    return (
      '<nav class="dp-xhs__dock" aria-label="小红书导航">' +
        DOCK.map(function (t) {
          if (t.id === 'plus') {
            return (
              '<button type="button" class="dp-xhs__dock-plus" data-act="plus" aria-label="发布">' +
                '<span>+</span>' +
              '</button>'
            );
          }
          return (
            '<button type="button" class="dp-xhs__dock-btn' + (state.page === t.id ? ' is-on' : '') +
              '" data-act="tab" data-tab="' + esc(t.id) + '">' +
              '<span class="dp-xhs__dock-ico" data-tab="' + esc(t.id) + '" aria-hidden="true"></span>' +
              '<span>' + esc(t.label) + '</span>' +
            '</button>'
          );
        }).join('') +
      '</nav>'
    );
  }

  function renderStream(x, keepScroll) {
    var el = $('dp-xhs-stream');
    if (!el) return;
    var snap = keepScroll ? captureScroll() : null;
    var pageHtml = '';
    if (state.page === 'market') pageHtml = buildMarketPage(x);
    else if (state.page === 'msg') pageHtml = buildMsgPage(x);
    else if (state.page === 'me') pageHtml = buildMePage(x);
    else pageHtml = buildHomePage(x);

    el.classList.add('is-static');
    el.innerHTML = pageHtml + buildFooter(x);
    var dockHost = $('dp-xhs-dock-host');
    if (dockHost) dockHost.innerHTML = buildDock();

    var root = $('dp-xhs');
    if (root) {
      root.classList.toggle('is-page-me', state.page === 'me');
      root.setAttribute('data-page', state.page || 'home');
    }

    updateRefreshBtn();
    if (snap != null) {
      restoreScroll(snap);
      requestAnimationFrame(function () { restoreScroll(snap); });
    }
  }

  function setOverlay(id, open) {
    var el = $(id);
    if (!el) return;
    if (open) {
      el.hidden = false;
      requestAnimationFrame(function () { el.classList.add('is-open'); });
    } else {
      el.classList.remove('is-open');
      setTimeout(function () {
        if (!el.classList.contains('is-open')) el.hidden = true;
      }, 280);
    }
  }

  function buildCommentItem(c, noteAuthor) {
    if (!c) return '';
    var badges = '';
    if (c.pinned) badges += '<span class="dp-xhs__cmt-badge is-pin">置顶评论</span>';
    if (c.first) badges += '<span class="dp-xhs__cmt-badge">首评</span>';
    if (c.authorLiked) badges += '<span class="dp-xhs__cmt-badge">作者赞过</span>';
    var replies = (c.replies || []).map(function (r) {
      return (
        '<div class="dp-xhs__cmt-reply">' +
          '<span class="dp-xhs__cmt-av is-sm">' + esc(avatarLetter(r.user)) + '</span>' +
          '<div class="dp-xhs__cmt-main">' +
            '<div class="dp-xhs__cmt-name">' +
              '<strong>' + esc(r.user || '用户') + '</strong>' +
              (r.isAuthor ? '<span class="dp-xhs__author-tag">作者</span>' : '') +
            '</div>' +
            '<p>' + esc(r.text) + '</p>' +
            '<div class="dp-xhs__cmt-meta">' +
              '<span>' + esc([r.time, r.location].filter(Boolean).join(' ')) + '</span>' +
              '<button type="button" data-act="noop">回复</button>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    var expand = (c.replies && c.replies.length > 1)
      ? '<button type="button" class="dp-xhs__cmt-expand" data-act="noop"><i></i>展开 ' + c.replies.length + ' 条回复</button>'
      : '';

    return (
      '<li class="dp-xhs__cmt" data-cmt-id="' + esc(c.id) + '">' +
        '<span class="dp-xhs__cmt-av">' + esc(avatarLetter(c.user || noteAuthor)) + '</span>' +
        '<div class="dp-xhs__cmt-main">' +
          '<div class="dp-xhs__cmt-name">' +
            '<strong>' + esc(c.user || '用户') + '</strong>' +
            (c.isAuthor ? '<span class="dp-xhs__author-tag">作者</span>' : '') +
          '</div>' +
          '<p class="dp-xhs__cmt-text">' + esc(c.text) + '</p>' +
          '<div class="dp-xhs__cmt-meta">' +
            '<span>' + esc([c.time, c.location].filter(Boolean).join(' ')) + '</span>' +
            '<button type="button" data-act="noop">回复</button>' +
          '</div>' +
          (badges ? '<div class="dp-xhs__cmt-badges">' + badges + '</div>' : '') +
          (replies ? '<div class="dp-xhs__cmt-thread">' + replies + expand + '</div>' : '') +
        '</div>' +
        '<div class="dp-xhs__cmt-side">' +
          '<button type="button" class="dp-xhs__cmt-like' + (c.liked ? ' is-on' : '') +
            '" data-act="like-cmt" data-id="' + esc(c.id) + '">' +
            (c.liked ? ICO.heartSmOn : ICO.heartSm) +
            (c.likes ? '<em>' + esc(c.likes) + '</em>' : '') +
          '</button>' +
          '<button type="button" class="dp-xhs__cmt-react" data-act="noop" aria-label="表情">' + ICO.smile + '</button>' +
        '</div>' +
      '</li>'
    );
  }

  function buildNoteBar(n) {
    var cCount = n.commentCount || String((n.comments || []).length) || '0';
    return (
      '<div class="dp-xhs__note-bar-inner">' +
        '<button type="button" class="dp-xhs__say" data-act="focus-cmt">' +
          ICO.pen + '<span>说点什么...</span>' +
        '</button>' +
        '<button type="button" class="dp-xhs__bar-act' + (n.liked ? ' is-on' : '') +
          '" data-act="like-note" data-id="' + esc(n.id) + '">' +
          (n.liked ? ICO.heartOn : ICO.heart) +
          '<em>' + esc(n.likes || '0') + '</em>' +
        '</button>' +
        '<button type="button" class="dp-xhs__bar-act' + (n.collected ? ' is-on' : '') +
          '" data-act="collect-note" data-id="' + esc(n.id) + '">' +
          (n.collected ? ICO.starOn : ICO.star) +
          '<em>' + esc(n.collects || '收藏') + '</em>' +
        '</button>' +
        '<button type="button" class="dp-xhs__bar-act" data-act="focus-cmt">' +
          ICO.chat + '<em>' + esc(cCount) + '</em>' +
        '</button>' +
      '</div>'
    );
  }

  function renderNoteDetail() {
    var panel = $('dp-xhs-note');
    var scroll = $('dp-xhs-note-scroll');
    var bar = $('dp-xhs-note-bar');
    if (!panel || !scroll) return;
    var found = findNote(state.noteId);
    if (!found) {
      setOverlay('dp-xhs-note', false);
      if (bar) { bar.hidden = true; bar.innerHTML = ''; }
      return;
    }
    var n = found.note;
    var author = n.author || state.contactName || '用户';
    var cmtList = n.comments || [];
    var cmtCount = n.commentCount || String(cmtList.length) || '0';
    var comments = cmtList.map(function (c) { return buildCommentItem(c, author); }).join('');

    scroll.innerHTML =
      '<header class="dp-xhs__note-top">' +
        '<button type="button" class="dp-xhs__ghost-ico" data-act="close-note" aria-label="返回">' + ICO.back + '</button>' +
        '<div class="dp-xhs__note-user">' +
          '<span class="dp-xhs__note-av tone-' + esc(n.authorTone || 'mist') + '">' + esc(avatarLetter(author)) + '</span>' +
          '<div class="dp-xhs__note-user-txt">' +
            '<strong>' + esc(author) + '</strong>' +
            ((n.time || n.location)
              ? '<span>' + esc([n.time, n.location].filter(Boolean).join(' ')) + '</span>'
              : '') +
          '</div>' +
        '</div>' +
        '<button type="button" class="dp-xhs__follow-outline" data-act="toast-follow">关注</button>' +
        '<button type="button" class="dp-xhs__ghost-ico" data-act="noop" aria-label="分享">' + ICO.share + '</button>' +
      '</header>' +
      '<div class="dp-xhs__note-cover tone-' + esc(n.coverTone) + ' kind-' + esc(n.coverKind) + '">' +
        '<div class="dp-xhs__cover-stage">' +
          '<span class="dp-xhs__cover-dots"></span>' +
          (n.time ? '<span class="dp-xhs__cover-date">' + esc(String(n.time).slice(0, 12)) + '</span>' : '') +
          '<div class="dp-xhs__cover-text">' + esc(n.coverText || n.title) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="dp-xhs__note-body">' +
        '<h1 class="dp-xhs__note-title">' + esc(n.title) + '</h1>' +
        '<p class="dp-xhs__note-text">' + esc(n.body || n.preview || '') + '</p>' +
        ((n.tags || []).length
          ? '<div class="dp-xhs__note-tags">' + n.tags.map(function (t) {
              return '<span>#' + esc(t) + '</span>';
            }).join('') + '</div>'
          : '') +
        (trim(n.privateNote)
          ? '<div class="dp-xhs__private"><label>仅自己可见</label><p>' + esc(n.privateNote) + '</p></div>'
          : '') +
        '<section class="dp-xhs__cmt-box" id="dp-xhs-cmt-box">' +
          '<div class="dp-xhs__cmt-head">' +
            '<h3>共 ' + esc(cmtCount) + ' 条评论</h3>' +
            '<span class="dp-xhs__cmt-sort" aria-hidden="true">' + ICO.sort + '</span>' +
          '</div>' +
          '<div class="dp-xhs__cmt-input" data-act="focus-cmt">' +
            '<span class="dp-xhs__mini-av tone-' + esc((getPayload() && getPayload().avatarTone) || 'mist') + '">' +
              esc(avatarLetter((getPayload() && getPayload().nickname) || state.contactName)) +
            '</span>' +
            '<div class="dp-xhs__cmt-field"><span>留下你的想法吧</span></div>' +
          '</div>' +
          (comments
            ? '<ul class="dp-xhs__cmt-list">' + comments + '</ul>'
            : '<p class="dp-xhs__soft-empty">还没有评论，来抢首评吧</p>') +
        '</section>' +
      '</div>';

    if (bar) {
      bar.hidden = false;
      bar.innerHTML = buildNoteBar(n);
    }
  }

  function openNote(id, focusComments) {
    if (!id) return;
    state.homeScroll = captureScroll();
    state.noteId = id;
    state.noteFocusComments = !!focusComments;
    state.chatId = '';
    state.notifyKind = '';
    renderNoteDetail();
    setOverlay('dp-xhs-note', true);
    setOverlay('dp-xhs-chat', false);
    setOverlay('dp-xhs-notify', false);
    var sc = $('dp-xhs-note-scroll');
    if (sc) {
      sc.scrollTop = 0;
      if (state.noteFocusComments) {
        requestAnimationFrame(function () {
          var box = $('dp-xhs-cmt-box');
          if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    }
  }

  function closeNote() {
    state.noteId = '';
    state.noteFocusComments = false;
    var bar = $('dp-xhs-note-bar');
    if (bar) { bar.hidden = true; bar.innerHTML = ''; }
    setOverlay('dp-xhs-note', false);
    restoreScroll(state.homeScroll || 0);
  }

  function renderChat() {
    var scroll = $('dp-xhs-chat-scroll');
    if (!scroll) return;
    var c = findChat(state.chatId);
    if (!c) {
      setOverlay('dp-xhs-chat', false);
      return;
    }
    var bubbles = (c.messages || []).map(function (m) {
      return (
        '<div class="dp-xhs__bubble is-' + esc(m.from) + '">' +
          '<p>' + esc(m.text) + '</p>' +
          (m.time ? '<em>' + esc(m.time) + '</em>' : '') +
        '</div>'
      );
    }).join('');

    scroll.innerHTML =
      '<header class="dp-xhs__note-chrome">' +
        '<button type="button" class="dp-xhs__icon" data-act="close-chat" aria-label="返回">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button>' +
        '<div class="dp-xhs__note-author">' +
          '<span class="dp-xhs__mini-av tone-' + esc(c.tone) + '">' + esc(avatarLetter(c.name)) + '</span>' +
          '<div><strong>' + esc(c.name) + '</strong>' +
            (c.online ? '<p class="dp-xhs__online">' + esc(c.online) + '</p>' : '') +
          '</div>' +
        '</div>' +
        '<span class="dp-xhs__chrome-spacer"></span>' +
      '</header>' +
      '<div class="dp-xhs__chat-thread">' +
        (bubbles || '<p class="dp-xhs__soft-empty">还没有消息</p>') +
      '</div>';
  }

  function openChat(id) {
    var c = findChat(id);
    if (!c) return;
    state.homeScroll = captureScroll();
    state.chatId = id;
    state.noteId = '';
    state.notifyKind = '';
    c.unread = false;
    persistPayload();
    renderChat();
    setOverlay('dp-xhs-chat', true);
    setOverlay('dp-xhs-note', false);
    setOverlay('dp-xhs-notify', false);
  }

  function closeChat() {
    state.chatId = '';
    setOverlay('dp-xhs-chat', false);
    var x = getPayload();
    if (x && state.page === 'msg') renderStream(x, true);
    restoreScroll(state.homeScroll || 0);
  }

  function renderNotify() {
    var scroll = $('dp-xhs-notify-scroll');
    if (!scroll) return;
    var x = getPayload();
    var cats = (x && x.messages && x.messages.categories) || {};
    var kind = state.notifyKind;
    var map = {
      likes: { title: '赞和收藏', data: cats.likes },
      follows: { title: '新增关注', data: cats.follows },
      comments: { title: '评论和@', data: cats.comments }
    };
    var pack = map[kind] || { title: '通知', data: { items: [], preview: '' } };
    var data = pack.data || { items: [], preview: '' };
    var items = (data.items || []).map(function (it) {
      return (
        '<article class="dp-xhs__notify-row">' +
          '<span class="dp-xhs__chat-av tone-mist">' + esc(avatarLetter(it.user)) + '</span>' +
          '<div>' +
            '<strong>' + esc(it.user || '用户') + '</strong>' +
            '<p>' + esc(it.text) +
              (it.noteTitle ? ' · <em>' + esc(it.noteTitle) + '</em>' : '') +
            '</p>' +
            '<span>' + esc(it.time) + '</span>' +
          '</div>' +
        '</article>'
      );
    }).join('');

    scroll.innerHTML =
      '<header class="dp-xhs__note-chrome">' +
        '<button type="button" class="dp-xhs__icon" data-act="close-notify" aria-label="返回">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 18l-6-6 6-6"/></svg>' +
        '</button>' +
        '<div class="dp-xhs__chrome-title">' + esc(pack.title) + '</div>' +
        '<span class="dp-xhs__chrome-spacer"></span>' +
      '</header>' +
      '<div class="dp-xhs__notify-list">' +
        (trim(data.preview) ? '<p class="dp-xhs__notify-hint">' + esc(data.preview) + '</p>' : '') +
        (items || '<div class="dp-xhs__soft-empty">暂时没有新通知</div>') +
      '</div>';
  }

  function openNotify(kind) {
    state.homeScroll = captureScroll();
    state.notifyKind = kind;
    state.noteId = '';
    state.chatId = '';
    renderNotify();
    setOverlay('dp-xhs-notify', true);
    setOverlay('dp-xhs-note', false);
    setOverlay('dp-xhs-chat', false);
  }

  function closeNotify() {
    state.notifyKind = '';
    setOverlay('dp-xhs-notify', false);
    restoreScroll(state.homeScroll || 0);
  }

  function buildFullUI() {
    var x = getPayload();
    var root = $('dp-xhs');
    var empty = $('dp-xhs-empty');
    var stream = $('dp-xhs-stream');
    var dockHost = $('dp-xhs-dock-host');
    var has = hasContent(x);
    if (root) root.classList.toggle('is-filled', !!has);
    if (empty) empty.hidden = !!has;
    if (stream) {
      stream.hidden = !has;
      if (has) renderStream(x);
      else stream.innerHTML = '';
    }
    if (dockHost) {
      dockHost.hidden = !has;
      if (has) dockHost.innerHTML = buildDock();
      else dockHost.innerHTML = '';
    }
    state.built = true;
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadXhsData(contactId) {
    var ts = xhsStore();
    if (!ts) return Promise.resolve(null);
    return ts.getXhs(contactId).then(function (data) {
      state.xhsData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-xhs-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = xhsStore();
    var br = xhsBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchXhs(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的小红书数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.xhsData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
      }
      return br.generateXhs(contactId, phoneData, {});
    }).then(function (result) {
      return ts.patchXhs(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        xhs: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.xhsData = saved;
        state.refreshing = false;
        if (saved.xhs && saved.xhs.activeHomeTab) state.homeTab = saved.xhs.activeHomeTab;
        if (state.open) {
          closeNote();
          closeChat();
          closeNotify();
          buildFullUI();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ts.patchXhs(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.xhsData = saved;
          state.refreshing = false;
          if (state.open) {
            updateStatusBar();
            updateRefreshBtn();
          }
        }
        dispatchUpdated(contactId);
        throw err;
      });
    });

    activeJobs[contactId] = job;
    return job;
  }

  function handleRefresh() {
    if (!state.contactId) return;
    if (state.refreshing || (state.xhsData && state.xhsData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function mutateNote(id, mutator) {
    var found = findNote(id);
    if (!found) return;
    mutator(found.note);
    persistPayload().then(function () {
      var x = getPayload();
      if (state.noteId === id) renderNoteDetail();
      if (x) renderStream(x, true);
    });
  }

  function findComment(note, cmtId) {
    var found = null;
    (note.comments || []).forEach(function (c) {
      if (c && c.id === cmtId) found = c;
      ((c && c.replies) || []).forEach(function (r) {
        if (r && r.id === cmtId) found = r;
      });
    });
    return found;
  }

  function handleRootClick(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');
    var x = getPayload();

    if (act === 'xhs-refresh') {
      handleRefresh();
      return;
    }
    if (act === 'close-note') { closeNote(); return; }
    if (act === 'close-chat') { closeChat(); return; }
    if (act === 'close-notify') { closeNotify(); return; }
    if (act === 'close-app') { close(); return; }
    if (act === 'toast-follow') { toast('已关注'); return; }
    if (act === 'plus') { toast('发布入口 · 角色视角未开放编辑'); return; }
    if (act === 'focus-search') {
      toast(trim(x && x.searchHint) || '搜索笔记、用户');
      return;
    }
    if (act === 'focus-cmt') {
      var box = $('dp-xhs-cmt-box');
      if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('留下你的想法吧');
      return;
    }
    if (act === 'like-cmt') {
      e.stopPropagation();
      var foundNote = findNote(state.noteId);
      if (foundNote) {
        var cmt = findComment(foundNote.note, id);
        if (cmt) {
          cmt.liked = !cmt.liked;
          persistPayload().then(function () { renderNoteDetail(); });
        }
      }
      return;
    }
    if (act === 'tab') {
      var tab = t.getAttribute('data-tab');
      if (!tab || tab === state.page) return;
      closeNote();
      closeChat();
      closeNotify();
      state.page = tab;
      if (x) {
        renderStream(x, false);
        restoreScroll(0);
      }
      return;
    }
    if (act === 'home-tab') {
      state.homeTab = t.getAttribute('data-tab') || '发现';
      if (x) renderStream(x, false);
      return;
    }
    if (act === 'me-tab') {
      state.meTab = t.getAttribute('data-tab') || '笔记';
      if (x) renderStream(x, true);
      return;
    }
    if (act === 'open-note') {
      openNote(id);
      return;
    }
    if (act === 'like-note') {
      e.stopPropagation();
      mutateNote(id, function (n) { n.liked = !n.liked; });
      return;
    }
    if (act === 'collect-note') {
      e.stopPropagation();
      mutateNote(id, function (n) { n.collected = !n.collected; });
      return;
    }
    if (act === 'open-chat') {
      openChat(id);
      return;
    }
    if (act === 'open-notify') {
      openNotify(t.getAttribute('data-kind') || 'likes');
      return;
    }
    if (act === 'toggle-market' && x) {
      var mk = null;
      (x.market || []).forEach(function (m) { if (m && m.id === id) mk = m; });
      if (mk) {
        mk.opened = !mk.opened;
        persistPayload().then(function () { renderStream(x, true); });
      }
    }
  }

  function handleChromeBack() {
    if (state.noteId) { closeNote(); return; }
    if (state.chatId) { closeChat(); return; }
    if (state.notifyKind) { closeNotify(); return; }
    close();
  }

  function bindOnce() {
    var root = $('dp-xhs');
    if (!root || root._xhsBound) return;
    root._xhsBound = true;

    var back = $('dp-xhs-back');
    if (back) back.addEventListener('click', handleChromeBack);

    var refresh = $('dp-xhs-refresh');
    if (refresh) refresh.addEventListener('click', function () { handleRefresh(); });

    root.addEventListener('click', handleRootClick);

    var emptyRefresh = $('dp-xhs-empty-refresh');
    if (emptyRefresh) emptyRefresh.addEventListener('click', function () { handleRefresh(); });
  }

  function open(contactId, phoneData, contactName) {
    var root = $('dp-xhs');
    if (!root) {
      toast('小红书界面未就绪');
      return;
    }
    bindOnce();
    state.open = true;
    state.contactId = String(contactId || '');
    state.contactName = String(contactName || '');
    state.phoneData = phoneData || null;
    state.page = 'home';
    state.meTab = '笔记';
    state.built = false;
    state.noteId = '';
    state.chatId = '';
    state.notifyKind = '';
    setOverlay('dp-xhs-note', false);
    setOverlay('dp-xhs-chat', false);
    setOverlay('dp-xhs-notify', false);

    root.hidden = false;
    requestAnimationFrame(function () {
      root.classList.add('is-open');
    });

    loadXhsData(state.contactId).then(function (data) {
      if (!state.open || state.contactId !== String(contactId || '')) return;
      state.xhsData = data;
      if (data && data.refreshStatus === 'loading') state.refreshing = true;
      if (data && data.xhs && data.xhs.activeHomeTab) state.homeTab = data.xhs.activeHomeTab;
      buildFullUI();
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        runRefreshJob(state.contactId, state.phoneData).catch(function () {});
      }
    });
  }

  function close() {
    var root = $('dp-xhs');
    state.open = false;
    state.noteId = '';
    state.chatId = '';
    state.notifyKind = '';
    stopStatusDots();
    clearSuccessFlash();
    setOverlay('dp-xhs-note', false);
    setOverlay('dp-xhs-chat', false);
    setOverlay('dp-xhs-notify', false);
    if (root) {
      root.classList.remove('is-open', 'is-filled');
      setTimeout(function () {
        if (!state.open) root.hidden = true;
      }, 320);
    }
  }

  global.miyaDeepXhs = {
    open: open,
    close: close,
    refresh: handleRefresh
  };
})(typeof window !== 'undefined' ? window : global);
