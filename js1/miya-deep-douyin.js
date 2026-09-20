/**
 * miya-deep-douyin.js — 深入 · 角色手机 抖音
 * 全屏竖滑剧场 · 右栏互动 · 消息/主页浅色子页（独有布局，非瀑布/非双栏）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var DOCK = [
    { id: 'home', label: '首页' },
    { id: 'friends', label: '朋友' },
    { id: 'plus', label: '' },
    { id: 'msg', label: '消息' },
    { id: 'me', label: '我' }
  ];

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    douyinData: null,
    refreshing: false,
    built: false,
    page: 'home',
    homeTab: '推荐',
    meTab: 'works',
    videoId: '',
    chatId: '',
    sheetMode: '',
    feedIndex: 0
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function dyStore() { return global.miyaDeepDouyinStore || null; }
  function dyBridge() { return global.miyaDeepDouyinBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function toast(msg) {
    var el = $('dp-douyin-toast');
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
    var text = $('dp-douyin-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的抖音数据');
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
    var bar = $('dp-douyin-status');
    var text = $('dp-douyin-status-text');
    if (!bar || !text) return;
    var data = state.douyinData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的抖音数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '抖音已同步';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-douyin__status';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-douyin__status is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-douyin-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.douyinData && state.douyinData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.douyinData && state.douyinData.douyin ? state.douyinData.douyin : null;
  }

  function getContact() {
    var cs = global.miyaChatStore;
    if (!cs || !state.contactId) return null;
    if (typeof cs.findContact === 'function') return cs.findContact(state.contactId);
    return (cs.getContacts() || []).find(function (c) { return c && c.id === state.contactId; }) || null;
  }

  function resolveCharGender(d) {
    var p = d && d.profile ? d.profile : {};
    var g = trim(p.gender);
    if (g) return g;
    var contact = getContact();
    var cts = global.miyaContactsStore;
    if (cts && contact && typeof cts.findCharacter === 'function') {
      var roleId = trim(contact.characterId || contact.chronicleId);
      if (roleId) {
        var row = cts.findCharacter(roleId);
        if (row && trim(row.gender)) return trim(row.gender);
      }
    }
    return '';
  }

  function hasContent(d) {
    if (!d) return false;
    return !!(
      (d.feed && d.feed.length) ||
      (d.followingFeed && d.followingFeed.length) ||
      (d.friends && d.friends.length) ||
      (d.stories && d.stories.length) ||
      (d.messages && (
        (d.messages.chats && d.messages.chats.length) ||
        (d.messages.notices && d.messages.notices.length)
      )) ||
      (d.profile && (
        (d.profile.works && d.profile.works.length) ||
        (d.profile.favorites && d.profile.favorites.length) ||
        (d.profile.liked && d.profile.liked.length)
      )) ||
      trim(d.nickname) ||
      trim(d.bio) ||
      trim(d.footerNote) ||
      trim(d.nightThought) ||
      trim(d._rawBody)
    );
  }

  function persistPayload() {
    var ts = dyStore();
    if (!ts || !state.contactId || !state.douyinData) return Promise.resolve(null);
    return ts.patchDouyin(state.contactId, { douyin: state.douyinData.douyin }).then(function (saved) {
      state.douyinData = saved;
      return saved;
    });
  }

  function avatarLetter(name) {
    var n = trim(name) || 'D';
    return n.charAt(0);
  }

  function currentFeedList(d) {
    if (!d) return [];
    if (state.homeTab === '关注' && d.followingFeed && d.followingFeed.length) return d.followingFeed;
    return d.feed || [];
  }

  function findVideo(d, id) {
    if (!d || !id) return null;
    var pools = [
      d.feed, d.followingFeed,
      d.profile && d.profile.works,
      d.profile && d.profile.daily,
      d.profile && d.profile.favorites,
      d.profile && d.profile.liked
    ];
    var i, j, list;
    for (i = 0; i < pools.length; i++) {
      list = pools[i];
      if (!list) continue;
      for (j = 0; j < list.length; j++) {
        if (list[j] && list[j].id === id) return list[j];
      }
    }
    return null;
  }

  function findChat(d, id) {
    var chats = d && d.messages && d.messages.chats;
    if (!chats) return null;
    var i;
    for (i = 0; i < chats.length; i++) {
      if (chats[i] && chats[i].id === id) return chats[i];
    }
    return null;
  }

  function tagsHtml(tags) {
    if (!tags || !tags.length) return '';
    return tags.map(function (t) {
      return '<span class="dp-douyin__tag">#' + esc(t) + '</span>';
    }).join('');
  }

  function buildVideoSlide(v, index, total) {
    var tags = tagsHtml(v.tags);
    return (
      '<article class="dp-douyin__slide" data-tone="' + esc(v.coverTone || 'neon') + '" data-vid="' + esc(v.id) + '" data-index="' + index + '">' +
        '<div class="dp-douyin__stage" data-act="open-video" data-id="' + esc(v.id) + '">' +
          '<span class="dp-douyin__wash" aria-hidden="true"></span>' +
          '<span class="dp-douyin__grain" aria-hidden="true"></span>' +
          (v.subtitle
            ? '<p class="dp-douyin__subtitle">' + esc(v.subtitle) + '</p>'
            : '') +
          '<div class="dp-douyin__meta">' +
            '<button type="button" class="dp-douyin__author" data-act="open-video" data-id="' + esc(v.id) + '">@' + esc(v.author || '创作者') + '</button>' +
            '<p class="dp-douyin__caption">' + esc(v.caption || '') + '</p>' +
            (tags ? '<div class="dp-douyin__tags">' + tags + '</div>' : '') +
            (v.music ? '<p class="dp-douyin__music"><i aria-hidden="true"></i><span>' + esc(v.music) + '</span></p>' : '') +
          '</div>' +
          '<aside class="dp-douyin__rail" aria-label="互动">' +
            '<button type="button" class="dp-douyin__rail-av" data-act="open-video" data-id="' + esc(v.id) + '" data-tone="' + esc(v.authorTone || v.coverTone || 'mist') + '" aria-label="作者">' +
              '<span>' + esc(avatarLetter(v.author)) + '</span>' +
              '<em' + (v.followed ? ' class="is-on"' : '') + ' data-act="toggle-follow" data-id="' + esc(v.id) + '">' + (v.followed ? '✓' : '+') + '</em>' +
            '</button>' +
            '<button type="button" class="dp-douyin__rail-btn' + (v.liked ? ' is-on' : '') + '" data-act="like-video" data-id="' + esc(v.id) + '">' +
              '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M12 21s-6.6-4.35-9.2-8.1C1.1 10.4 1.6 6.8 4.4 5.2c2-1.1 4.4-.4 5.8 1.3C11.6 4.8 14 4.1 16 5.2c2.8 1.6 3.3 5.2 1.6 7.7C18.6 16.65 12 21 12 21z"/></svg>' +
              '<span>' + esc(v.likes || '赞') + '</span>' +
            '</button>' +
            '<button type="button" class="dp-douyin__rail-btn" data-act="open-comments" data-id="' + esc(v.id) + '">' +
              '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z"/></svg>' +
              '<span>' + esc(v.comments || '评') + '</span>' +
            '</button>' +
            '<button type="button" class="dp-douyin__rail-btn' + (v.collected ? ' is-on' : '') + '" data-act="collect-video" data-id="' + esc(v.id) + '">' +
              '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M12 3.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.6 7.2 18.1l.9-5.4L4.2 8.9l5.4-.8L12 3.2z"/></svg>' +
              '<span>' + esc(v.collects || '藏') + '</span>' +
            '</button>' +
            '<button type="button" class="dp-douyin__rail-btn" data-act="share-video" data-id="' + esc(v.id) + '">' +
              '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 4v10"/><path d="M8.5 7.5L12 4l3.5 3.5"/><path d="M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"/></svg>' +
              '<span>' + esc(v.shares || '享') + '</span>' +
            '</button>' +
            '<div class="dp-douyin__disk" aria-hidden="true"><i></i></div>' +
          '</aside>' +
        '</div>' +
      '</article>'
    );
  }

  function buildHomePage(d) {
    var tabs = d.homeTabs && d.homeTabs.length ? d.homeTabs : ['关注', '推荐', '同城'];
    var list = currentFeedList(d);
    if (!list.length && d.feed && d.feed.length) list = d.feed;
    var slides = list.length
      ? list.map(function (v, i) { return buildVideoSlide(v, i, list.length); }).join('')
      : '<article class="dp-douyin__slide is-empty"><div class="dp-douyin__empty-feed"><p>推荐流还是空的</p><button type="button" data-act="douyin-refresh">点刷新读取</button></div></article>';

    return (
      '<div class="dp-douyin__theater">' +
        '<header class="dp-douyin__home-top">' +
          '<button type="button" class="dp-douyin__menu" data-act="noop" aria-label="菜单"><span></span><span></span><span></span></button>' +
          '<div class="dp-douyin__htabs">' +
            tabs.map(function (t) {
              var on = (state.homeTab || d.activeHomeTab || '推荐') === t;
              return '<button type="button" class="dp-douyin__htab' + (on ? ' is-on' : '') + '" data-act="home-tab" data-tab="' + esc(t) + '">' + esc(t) + '</button>';
            }).join('') +
          '</div>' +
          '<button type="button" class="dp-douyin__search-ico" data-act="noop" aria-label="搜索">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="6.5"/><path d="M16.2 16.2L20 20"/></svg>' +
          '</button>' +
        '</header>' +
        '<div class="dp-douyin__reel" id="dp-douyin-reel">' + slides + '</div>' +
      '</div>'
    );
  }

  function noticeIconSvg(kind) {
    if (kind === 'follow') {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.7"><circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.4"/><path d="M3.5 18c.6-2.6 2.6-4 5.5-4s4.9 1.4 5.5 4"/><path d="M15 14.2c2 .3 3.4 1.4 3.8 3.3"/></svg>';
    }
    if (kind === 'group') {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.7"><path d="M4 10h16v9H4z"/><path d="M8 10V7.5A4 4 0 0 1 16 7.5V10"/><path d="M9 14h6"/></svg>';
    }
    if (kind === 'system') {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.7"><circle cx="12" cy="12" r="8"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.8" fill="#fff"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.7"><path d="M13 3L5 13h6l-1 8 9-12h-6l0-6z"/></svg>';
  }

  function shortcutIconSvg(name) {
    var n = String(name || '');
    if (n.indexOf('订单') >= 0 || n.indexOf('购物') >= 0) {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h16l-1.2 11H5.2L4 7z"/><path d="M8 7a4 4 0 0 1 8 0"/></svg>';
    }
    if (n.indexOf('历史') >= 0 || n.indexOf('观看') >= 0) {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 1.5"/></svg>';
    }
    if (n.indexOf('小程序') >= 0 || n.indexOf('程序') >= 0) {
      return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4l1.8 4.2L18 10l-4.2 1.8L12 16l-1.8-4.2L6 10l4.2-1.8L12 4z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/></svg>';
  }

  function buildFriendsPage(d) {
    var stories = d.stories || [];
    var friends = d.friends || [];
    var follow = d.followingFeed || [];
    return (
      '<div class="dp-douyin__page dp-douyin__page--friends">' +
        '<header class="dp-douyin__msg-head">' +
          '<button type="button" class="dp-douyin__msg-ico" data-act="noop" aria-label="菜单">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h10"/></svg>' +
          '</button>' +
          '<div class="dp-douyin__msg-title">' +
            '<span class="dp-douyin__msg-logo" aria-hidden="true"></span>' +
            '<h2>朋友</h2>' +
          '</div>' +
          '<div class="dp-douyin__msg-tools">' +
            '<button type="button" class="dp-douyin__msg-ico" data-act="noop" aria-label="搜索">' +
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="6.5"/><path d="M16.2 16.2L20 20"/></svg>' +
            '</button>' +
            '<button type="button" class="dp-douyin__msg-ico" data-act="douyin-refresh" aria-label="刷新">' +
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 4v5h-5"/></svg>' +
            '</button>' +
          '</div>' +
        '</header>' +
        '<div class="dp-douyin__story-rail dp-douyin__story-rail--msg">' +
          (stories.length ? stories.map(function (s) {
            return (
              '<button type="button" class="dp-douyin__story" data-act="open-story" data-id="' + esc(s.id) + '" data-tone="' + esc(s.tone || 'mist') + '">' +
                '<span class="dp-douyin__story-ring"><i>' + esc(avatarLetter(s.name)) + '</i></span>' +
                '<span class="dp-douyin__story-name">' + esc(s.name) + '</span>' +
                (s.label ? '<span class="dp-douyin__story-label">' + esc(s.label) + '</span>' : '') +
              '</button>'
            );
          }).join('') : '<p class="dp-douyin__muted">暂无限时日常</p>') +
        '</div>' +
        '<div class="dp-douyin__friend-list">' +
          (friends.length ? friends.map(function (f) {
            return (
              '<button type="button" class="dp-douyin__friend-row' + (f.opened ? ' is-open' : '') + '" data-act="toggle-friend" data-id="' + esc(f.id) + '">' +
                '<span class="dp-douyin__chat-av" data-tone="' + esc(f.tone || 'sand') + '">' + esc(avatarLetter(f.name)) + '</span>' +
                '<span class="dp-douyin__friend-copy">' +
                  '<strong>' + esc(f.name) + '</strong>' +
                  '<em>' + esc(f.preview || '') + '</em>' +
                  (f.opened && trim(f.note) ? '<p>' + esc(f.note) + '</p>' : '') +
                '</span>' +
                (f.time ? '<i class="dp-douyin__chat-time">' + esc(f.time) + '</i>' : '') +
              '</button>'
            );
          }).join('') : '') +
          (follow.length ? follow.map(function (v) {
            return (
              '<button type="button" class="dp-douyin__friend-row dp-douyin__friend-row--video" data-act="open-video" data-id="' + esc(v.id) + '" data-tone="' + esc(v.coverTone || 'mist') + '">' +
                '<span class="dp-douyin__friend-thumb" aria-hidden="true"></span>' +
                '<span class="dp-douyin__friend-copy">' +
                  '<strong>' + esc(v.author || '朋友') + '</strong>' +
                  '<em>' + esc(v.caption || '') + '</em>' +
                '</span>' +
                (v.time ? '<i class="dp-douyin__chat-time">' + esc(v.time) + '</i>' : '') +
              '</button>'
            );
          }).join('') : '') +
          ((!friends.length && !follow.length) ? '<p class="dp-douyin__muted">还没有朋友动态</p>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function buildMsgPage(d) {
    var msg = d.messages || {};
    var notices = (msg.notices || []).filter(function (n) { return n && !n.dismissed; });
    var chats = msg.chats || [];
    var stories = d.stories || [];
    return (
      '<div class="dp-douyin__page dp-douyin__page--msg">' +
        '<header class="dp-douyin__msg-head">' +
          '<button type="button" class="dp-douyin__msg-ico" data-act="noop" aria-label="菜单">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h10"/></svg>' +
          '</button>' +
          '<div class="dp-douyin__msg-title">' +
            '<span class="dp-douyin__msg-logo" aria-hidden="true"></span>' +
            '<h2>消息</h2>' +
          '</div>' +
          '<div class="dp-douyin__msg-tools">' +
            '<button type="button" class="dp-douyin__msg-ico" data-act="noop" aria-label="搜索">' +
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="6.5"/><path d="M16.2 16.2L20 20"/></svg>' +
            '</button>' +
            '<button type="button" class="dp-douyin__msg-ico" data-act="noop" aria-label="更多">' +
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 6v12M6 12h12"/></svg>' +
            '</button>' +
          '</div>' +
        '</header>' +
        (trim(msg.alertBanner)
          ? '<div class="dp-douyin__alert"><i aria-hidden="true"></i><span>' + esc(msg.alertBanner) + '</span><em>打开提醒 ›</em></div>'
          : '') +
        (stories.length
          ? '<div class="dp-douyin__story-rail dp-douyin__story-rail--msg">' +
              stories.map(function (s) {
                return (
                  '<button type="button" class="dp-douyin__story" data-act="open-story" data-id="' + esc(s.id) + '" data-tone="' + esc(s.tone || 'mist') + '">' +
                    '<span class="dp-douyin__story-ring"><i>' + esc(avatarLetter(s.name)) + '</i></span>' +
                    '<span class="dp-douyin__story-name">' + esc(s.name) + '</span>' +
                    (s.label ? '<span class="dp-douyin__story-label">' + esc(s.label) + '</span>' : '') +
                  '</button>'
                );
              }).join('') +
            '</div>'
          : '') +
        '<div class="dp-douyin__msg-list">' +
          notices.map(function (n) {
            return (
              '<div class="dp-douyin__notice" data-kind="' + esc(n.kind || 'interact') + '" data-notice-id="' + esc(n.id) + '">' +
                '<span class="dp-douyin__notice-ico" aria-hidden="true">' + noticeIconSvg(n.kind) + '</span>' +
                '<div class="dp-douyin__notice-copy">' +
                  '<strong>' + esc(n.title) +
                    (n.official ? '<b>官方</b>' : '') +
                  '</strong>' +
                  '<em>' + esc(n.preview) + '</em>' +
                '</div>' +
                '<div class="dp-douyin__notice-side">' +
                  (n.time ? '<i>' + esc(n.time) + '</i>' : '') +
                  '<button type="button" class="dp-douyin__notice-x" data-act="dismiss-notice" data-id="' + esc(n.id) + '" aria-label="关闭">×</button>' +
                '</div>' +
              '</div>'
            );
          }).join('') +
          chats.map(function (c) {
            return (
              '<button type="button" class="dp-douyin__chat-row' + (c.unread ? ' is-unread' : '') + '" data-act="open-chat" data-id="' + esc(c.id) + '">' +
                '<span class="dp-douyin__chat-av" data-tone="' + esc(c.tone || 'plum') + '">' + esc(avatarLetter(c.name)) + '</span>' +
                '<span class="dp-douyin__chat-copy">' +
                  '<strong>' + esc(c.name) + '</strong>' +
                  '<em>' + esc(c.preview) + '</em>' +
                '</span>' +
                (c.time ? '<i class="dp-douyin__chat-time">' + esc(c.time) + '</i>' : '') +
              '</button>'
            );
          }).join('') +
          ((!notices.length && !chats.length) ? '<p class="dp-douyin__muted">消息还是空的</p>' : '') +
        '</div>' +
      '</div>'
    );
  }

  function buildMePage(d) {
    var st = d.stats || {};
    var p = d.profile || {};
    var tab = state.meTab || 'works';
    var list = p[tab] || [];
    var tabs = [
      { id: 'works', label: '作品' },
      { id: 'daily', label: '日常' },
      { id: 'favorites', label: '收藏' },
      { id: 'liked', label: '喜欢' }
    ];
    var name = trim(d.nickname) || state.contactName || '用户';
    var charGender = resolveCharGender(d);
    var shortcuts = (p.shortcuts && p.shortcuts.length)
      ? p.shortcuts
      : [
          { id: 'sc1', name: '我的订单' },
          { id: 'sc2', name: '观看历史' },
          { id: 'sc3', name: '我的小程序' },
          { id: 'sc4', name: '全部功能' }
        ];
    return (
      '<div class="dp-douyin__page dp-douyin__page--me">' +
        '<div class="dp-douyin__me-banner" aria-hidden="true"></div>' +
        '<header class="dp-douyin__me-nav">' +
          '<button type="button" class="dp-douyin__me-nav-btn" data-act="noop" aria-label="添加朋友">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.55"><circle cx="9" cy="8" r="3"/><path d="M3.8 18c.7-2.8 2.8-4.2 5.2-4.2s4.5 1.4 5.2 4.2"/><path d="M17 8v5M14.5 10.5H19.5"/></svg>' +
          '</button>' +
          '<div class="dp-douyin__me-nav-right">' +
            '<button type="button" class="dp-douyin__me-visitor" data-act="noop">新访客</button>' +
            '<button type="button" class="dp-douyin__me-nav-btn" data-act="noop" aria-label="搜索">' +
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="6.5"/><path d="M16.2 16.2L20 20"/></svg>' +
            '</button>' +
            '<button type="button" class="dp-douyin__me-nav-btn" data-act="douyin-refresh" aria-label="刷新">' +
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h10"/></svg>' +
            '</button>' +
          '</div>' +
        '</header>' +
        '<div class="dp-douyin__me-body">' +
          '<div class="dp-douyin__me-profile">' +
            '<div class="dp-douyin__me-av" data-tone="' + esc(d.avatarTone || 'mist') + '">' +
              '<span>' + esc(avatarLetter(name)) + '</span>' +
              '<em aria-hidden="true">+</em>' +
            '</div>' +
            '<div class="dp-douyin__me-copy">' +
              '<h2>' + esc(name) + '<i aria-hidden="true"></i></h2>' +
              '<p class="dp-douyin__me-id">抖音号：' + esc(d.douyinId || '—') + '</p>' +
              '<button type="button" class="dp-douyin__me-ai" data-act="noop">创建 AI 形象</button>' +
            '</div>' +
          '</div>' +
          '<div class="dp-douyin__me-stats-row">' +
            '<div class="dp-douyin__me-stats">' +
              '<div><strong>' + esc(st.likes || '0') + '</strong><span>获赞</span></div>' +
              '<div><strong>' + esc(st.mutuals || '0') + '</strong><span>互关</span></div>' +
              '<div><strong>' + esc(st.following || '0') + '</strong><span>关注</span></div>' +
              '<div><strong>' + esc(st.followers || '0') + '</strong><span>粉丝</span></div>' +
            '</div>' +
            '<button type="button" class="dp-douyin__me-edit" data-act="noop">编辑主页</button>' +
          '</div>' +
          '<button type="button" class="dp-douyin__me-intro" data-act="noop">' +
            '<span>' + esc(trim(d.bio) || trim(p.introHint) || '点击添加介绍...') + '</span>' +
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5z"/></svg>' +
          '</button>' +
          '<div class="dp-douyin__me-tags">' +
            (charGender ? '<span>' + esc(charGender) + '</span>' : '') +
            (p.ageTag ? '<span>' + esc(p.ageTag) + '</span>' : '') +
            '<span class="is-add">+ 添加年龄等标签</span>' +
          '</div>' +
          '<div class="dp-douyin__me-shortcuts">' +
            shortcuts.map(function (s) {
              return (
                '<button type="button" class="dp-douyin__me-sc" data-act="noop">' +
                  '<span class="dp-douyin__me-sc-ico">' + shortcutIconSvg(s.name) + '</span>' +
                  '<span>' + esc(s.name) + '</span>' +
                '</button>'
              );
            }).join('') +
          '</div>' +
          '<div class="dp-douyin__me-tabs">' +
            tabs.map(function (t) {
              return '<button type="button" class="dp-douyin__me-tab' + (tab === t.id ? ' is-on' : '') + '" data-act="me-tab" data-tab="' + esc(t.id) + '">' + esc(t.label) + '</button>';
            }).join('') +
          '</div>' +
          '<div class="dp-douyin__me-grid" id="dp-douyin-me-grid">' +
            (list.length ? list.map(function (v) {
              return (
                '<button type="button" class="dp-douyin__tile" data-act="open-video" data-id="' + esc(v.id) + '" data-tone="' + esc(v.coverTone || 'mist') + '">' +
                  '<span class="dp-douyin__tile-shade"></span>' +
                  (v.likes ? '<span class="dp-douyin__tile-likes"><i></i>' + esc(v.likes) + '</span>' : '') +
                '</button>'
              );
            }).join('') : (
              '<div class="dp-douyin__me-empty">' +
                '<div class="dp-douyin__me-empty-card" data-tone="sky">' +
                  '<span class="dp-douyin__me-empty-thumb"></span>' +
                  '<div>' +
                    '<strong>还没有作品</strong>' +
                    '<p>拍一条日常，留在 ta 的主页</p>' +
                  '</div>' +
                  '<em>去发布</em>' +
                '</div>' +
              '</div>'
            )) +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function buildDock() {
    return (
      '<nav class="dp-douyin__dock" aria-label="抖音导航">' +
        DOCK.map(function (t) {
          if (t.id === 'plus') {
            return (
              '<button type="button" class="dp-douyin__dock-plus" data-act="noop" aria-label="发布">' +
                '<span></span>' +
              '</button>'
            );
          }
          return (
            '<button type="button" class="dp-douyin__dock-btn' + (state.page === t.id ? ' is-on' : '') +
              '" data-act="tab" data-tab="' + esc(t.id) + '">' +
              '<span>' + esc(t.label) + '</span>' +
            '</button>'
          );
        }).join('') +
      '</nav>'
    );
  }

  function buildSheetHtml(d, v) {
    if (!v) return '';
    var comments = v.commentsList || [];
    var name = trim(state.contactName) || trim(d.nickname) || 'ta';
    return (
      '<div class="dp-douyin__sheet-panel">' +
        '<header class="dp-douyin__sheet-head">' +
          '<button type="button" data-act="close-sheet" aria-label="关闭">‹</button>' +
          '<div>' +
            '<h3>@' + esc(v.author || '创作者') + '</h3>' +
            (v.time || v.location
              ? '<p>' + esc([v.time, v.location].filter(Boolean).join(' · ')) + '</p>'
              : '') +
          '</div>' +
          '<button type="button" class="dp-douyin__sheet-like' + (v.liked ? ' is-on' : '') + '" data-act="like-video" data-id="' + esc(v.id) + '">' +
            (v.liked ? '已赞' : '点赞') +
          '</button>' +
        '</header>' +
        '<div class="dp-douyin__sheet-stage" data-tone="' + esc(v.coverTone || 'neon') + '">' +
          '<span></span>' +
          (v.subtitle ? '<em>' + esc(v.subtitle) + '</em>' : '') +
          (v.duration ? '<i>' + esc(v.duration) + '</i>' : '') +
        '</div>' +
        '<section class="dp-douyin__sheet-body">' +
          '<p class="dp-douyin__sheet-cap">' + esc(v.caption || '') + '</p>' +
          (v.tags && v.tags.length ? '<div class="dp-douyin__tags">' + tagsHtml(v.tags) + '</div>' : '') +
          (v.music ? '<p class="dp-douyin__music"><span>' + esc(v.music) + '</span></p>' : '') +
          (trim(v.privateNote)
            ? '<aside class="dp-douyin__note"><header><em>角色批注</em><span>' + esc(name) + '</span></header><p>' + esc(v.privateNote) + '</p></aside>'
            : '') +
          '<h4 class="dp-douyin__sheet-h">评论 ' + esc(v.comments || String(comments.length || '')) + '</h4>' +
          '<div class="dp-douyin__comments">' +
            (comments.length ? comments.map(function (c) {
              return (
                '<div class="dp-douyin__comment">' +
                  '<span class="dp-douyin__comment-av">' + esc(avatarLetter(c.user || '评')) + '</span>' +
                  '<div>' +
                    '<strong>' + esc(c.user || '用户') + '</strong>' +
                    '<p>' + esc(c.text) + '</p>' +
                    '<em>' + esc([c.time, c.likes ? (c.likes + '赞') : ''].filter(Boolean).join(' · ')) + '</em>' +
                  '</div>' +
                '</div>'
              );
            }).join('') : '<p class="dp-douyin__muted">评论区还很安静</p>') +
          '</div>' +
        '</section>' +
      '</div>'
    );
  }

  function buildChatHtml(d, chat) {
    if (!chat) return '';
    var msgs = chat.messages || [];
    return (
      '<div class="dp-douyin__sheet-panel dp-douyin__sheet-panel--chat">' +
        '<header class="dp-douyin__sheet-head">' +
          '<button type="button" data-act="close-sheet" aria-label="关闭">‹</button>' +
          '<div>' +
            '<h3>' + esc(chat.name) + '</h3>' +
            (chat.online ? '<p>' + esc(chat.online) + '</p>' : '') +
          '</div>' +
          '<span></span>' +
        '</header>' +
        '<div class="dp-douyin__thread">' +
          (msgs.length ? msgs.map(function (m) {
            return (
              '<div class="dp-douyin__bubble' + (m.from === 'me' ? ' is-me' : '') + '">' +
                '<p>' + esc(m.text) + '</p>' +
                (m.time ? '<i>' + esc(m.time) + '</i>' : '') +
              '</div>'
            );
          }).join('') : '<p class="dp-douyin__muted">还没有对话</p>') +
        '</div>' +
      '</div>'
    );
  }

  function setThemeClass() {
    var root = $('dp-douyin');
    if (!root) return;
    var light = state.page !== 'home';
    root.classList.toggle('is-dark', !light);
    root.classList.toggle('is-light', light);
    root.classList.toggle('is-page-me', state.page === 'me');
    root.classList.toggle('is-page-msg', state.page === 'msg');
    root.classList.toggle('is-page-friends', state.page === 'friends');
  }

  function pageScrollEl() {
    return $('dp-douyin-scroll');
  }

  function bindReelScroll() {
    var reel = $('dp-douyin-reel');
    if (!reel || reel._dyBound) return;
    reel._dyBound = true;
    reel.addEventListener('scroll', function () {
      var h = reel.clientHeight || 1;
      state.feedIndex = Math.round(reel.scrollTop / h);
    }, { passive: true });
  }

  function renderStream(d, keepScroll) {
    var el = $('dp-douyin-stream');
    if (!el) return;
    var sc = pageScrollEl();
    var reel = $('dp-douyin-reel');
    var snap = null;
    if (keepScroll) {
      if (state.page === 'home' && reel) snap = { kind: 'reel', top: reel.scrollTop };
      else if (sc) snap = { kind: 'page', top: sc.scrollTop };
    }
    var pageHtml = '';
    if (state.page === 'friends') pageHtml = buildFriendsPage(d);
    else if (state.page === 'msg') pageHtml = buildMsgPage(d);
    else if (state.page === 'me') pageHtml = buildMePage(d);
    else pageHtml = buildHomePage(d);

    el.innerHTML = pageHtml;
    var dockHost = $('dp-douyin-dock-host');
    if (dockHost) dockHost.innerHTML = buildDock();
    setThemeClass();
    updateRefreshBtn();
    bindReelScroll();

    if (snap) {
      requestAnimationFrame(function () {
        if (snap.kind === 'reel') {
          var reel2 = $('dp-douyin-reel');
          if (reel2) reel2.scrollTop = snap.top;
        } else if (sc) sc.scrollTop = snap.top;
      });
    }
  }

  function setSheetVisible(show) {
    var panel = $('dp-douyin-sheet');
    var dock = $('dp-douyin-dock-host');
    if (!panel) return;
    if (show) {
      panel.hidden = false;
      requestAnimationFrame(function () { panel.classList.add('is-open'); });
      if (dock) dock.classList.add('is-dim');
    } else {
      panel.classList.remove('is-open');
      if (dock) dock.classList.remove('is-dim');
      setTimeout(function () {
        if (!state.videoId && !state.chatId) panel.hidden = true;
      }, 280);
    }
  }

  function onSheetBackdrop(e) {
    if (e.target && e.target.id === 'dp-douyin-sheet') closeSheet();
  }

  function renderSheet() {
    var d = getPayload();
    var sc = $('dp-douyin-sheet-scroll');
    if (!d || !sc) return;
    if (state.chatId) {
      sc.innerHTML = buildChatHtml(d, findChat(d, state.chatId));
      return;
    }
    if (state.videoId) {
      sc.innerHTML = buildSheetHtml(d, findVideo(d, state.videoId));
    }
  }

  function openVideoSheet(id) {
    var d = getPayload();
    var v = findVideo(d, id);
    if (!v) return;
    v.opened = true;
    state.videoId = id;
    state.chatId = '';
    state.sheetMode = 'video';
    persistPayload();
    renderSheet();
    setSheetVisible(true);
  }

  function openChatSheet(id) {
    var d = getPayload();
    var c = findChat(d, id);
    if (!c) return;
    c.opened = true;
    c.unread = false;
    state.chatId = id;
    state.videoId = '';
    state.sheetMode = 'chat';
    var row = document.querySelector('#dp-douyin-stream .dp-douyin__chat-row[data-id="' + id + '"], #dp-douyin-stream [data-act="open-chat"][data-id="' + id + '"]');
    if (row) row.classList.remove('is-unread');
    renderSheet();
    setSheetVisible(true);
    persistPayload();
  }

  function closeSheet() {
    state.videoId = '';
    state.chatId = '';
    state.sheetMode = '';
    setSheetVisible(false);
  }

  function buildFullUI() {
    var d = getPayload();
    var empty = $('dp-douyin-empty');
    var stream = $('dp-douyin-stream');
    var dockHost = $('dp-douyin-dock-host');
    var has = hasContent(d);
    if (empty) empty.hidden = !!has;
    if (stream) {
      stream.hidden = !has;
      if (has) renderStream(d);
      else stream.innerHTML = '';
    }
    if (dockHost) {
      dockHost.hidden = !has;
      if (has) dockHost.innerHTML = buildDock();
      else dockHost.innerHTML = '';
    }
    setThemeClass();
    state.built = true;
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadDouyinData(contactId) {
    var ts = dyStore();
    if (!ts) return Promise.resolve(null);
    return ts.getDouyin(contactId).then(function (data) {
      state.douyinData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-douyin-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = dyStore();
    var br = dyBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchDouyin(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的抖音数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.douyinData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
      }
      return br.generateDouyin(contactId, phoneData, {});
    }).then(function (result) {
      return ts.patchDouyin(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        douyin: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.douyinData = saved;
        state.refreshing = false;
        if (saved.douyin && saved.douyin.activeHomeTab) state.homeTab = saved.douyin.activeHomeTab;
        if (state.open) {
          closeSheet();
          buildFullUI();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ts.patchDouyin(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.douyinData = saved;
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
    if (state.refreshing || (state.douyinData && state.douyinData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function patchVideoFlag(id, key, value) {
    var d = getPayload();
    var v = findVideo(d, id);
    if (!v) return;
    v[key] = value;
    persistPayload().then(function () {
      if (state.sheetMode === 'video' && state.videoId === id) renderSheet();
      else if (state.page === 'home') renderStream(d, true);
      else renderStream(d, true);
    });
  }

  function handleRootClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id') || '';
    var d = getPayload();

    if (act === 'douyin-back') {
      close();
      return;
    }
    if (act === 'douyin-refresh') {
      handleRefresh();
      return;
    }
    if (act === 'tab') {
      var tab = btn.getAttribute('data-tab');
      if (!tab || tab === state.page) return;
      state.page = tab;
      closeSheet();
      if (d) renderStream(d);
      return;
    }
    if (act === 'home-tab') {
      state.homeTab = btn.getAttribute('data-tab') || '推荐';
      if (d) renderStream(d);
      return;
    }
    if (act === 'me-tab') {
      state.meTab = btn.getAttribute('data-tab') || 'works';
      if (!d) return;
      var sc = pageScrollEl();
      var top = sc ? sc.scrollTop : 0;
      renderStream(d, false);
      if (sc) {
        requestAnimationFrame(function () {
          var sc2 = pageScrollEl();
          if (sc2) sc2.scrollTop = top;
        });
      }
      return;
    }
    if (act === 'open-video' || act === 'open-comments') {
      if (id) openVideoSheet(id);
      return;
    }
    if (act === 'close-sheet') {
      closeSheet();
      return;
    }
    if (act === 'like-video') {
      var v = findVideo(d, id);
      if (v) patchVideoFlag(id, 'liked', !v.liked);
      return;
    }
    if (act === 'collect-video') {
      var vc = findVideo(d, id);
      if (vc) patchVideoFlag(id, 'collected', !vc.collected);
      return;
    }
    if (act === 'toggle-follow') {
      e.stopPropagation();
      var vf = findVideo(d, id);
      if (vf) patchVideoFlag(id, 'followed', !vf.followed);
      return;
    }
    if (act === 'share-video') {
      toast('已记下想分享的视频');
      return;
    }
    if (act === 'open-chat') {
      if (id) openChatSheet(id);
      return;
    }
    if (act === 'dismiss-notice') {
      e.stopPropagation();
      var notices = d && d.messages && d.messages.notices;
      if (notices) {
        notices.forEach(function (n) {
          if (n && n.id === id) n.dismissed = true;
        });
        var noticeEl = document.querySelector('#dp-douyin-stream [data-notice-id="' + id + '"]');
        if (noticeEl) noticeEl.remove();
        else renderStream(getPayload(), true);
        persistPayload();
      }
      return;
    }
    if (act === 'toggle-friend') {
      var friends = d && d.friends;
      var opened = false;
      var noteText = '';
      if (friends) {
        friends.forEach(function (f) {
          if (f && f.id === id) {
            f.opened = !f.opened;
            opened = f.opened;
            noteText = trim(f.note);
          }
        });
        var row = document.querySelector('#dp-douyin-stream .dp-douyin__friend-row[data-id="' + id + '"]');
        if (row) {
          row.classList.toggle('is-open', opened);
          var noteEl = row.querySelector('.dp-douyin__friend-copy p');
          if (opened && noteText) {
            if (!noteEl) {
              var copy = row.querySelector('.dp-douyin__friend-copy');
              if (copy) {
                noteEl = document.createElement('p');
                copy.appendChild(noteEl);
              }
            }
            if (noteEl) noteEl.textContent = noteText;
          } else if (noteEl) {
            noteEl.remove();
          }
          persistPayload();
        } else {
          persistPayload().then(function () { renderStream(getPayload(), true); });
        }
      }
      return;
    }
    if (act === 'open-story') {
      var stories = d && d.stories;
      var story = null;
      if (stories) {
        stories.forEach(function (s) {
          if (s && s.id === id) story = s;
        });
      }
      if (story) toast(trim(story.note) || trim(story.name) || '限时日常');
    }
  }

  function bindEvents() {
    var root = $('dp-douyin');
    if (!root || root._dyBound) return;
    root._dyBound = true;
    root.addEventListener('click', handleRootClick);
    var emptyBtn = $('dp-douyin-empty-refresh');
    if (emptyBtn) emptyBtn.addEventListener('click', handleRefresh);
    var sheet = $('dp-douyin-sheet');
    if (sheet) sheet.addEventListener('click', onSheetBackdrop);
  }

  function open(contactId, phoneData, contactName) {
    var root = $('dp-douyin');
    if (!root) return;
    state.open = true;
    state.contactId = String(contactId || '');
    state.contactName = String(contactName || '');
    state.phoneData = phoneData || null;
    state.page = 'home';
    state.meTab = 'works';
    state.videoId = '';
    state.chatId = '';
    bindEvents();
    root.hidden = false;
    requestAnimationFrame(function () { root.classList.add('is-open'); });

    loadDouyinData(state.contactId).then(function (data) {
      if (!state.open || state.contactId !== String(contactId || '')) return;
      state.douyinData = data;
      if (data && data.douyin && data.douyin.activeHomeTab) {
        state.homeTab = data.douyin.activeHomeTab;
      }
      buildFullUI();
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        state.refreshing = true;
        updateStatusBar();
        runRefreshJob(state.contactId, state.phoneData).catch(function () {});
      }
    });
  }

  function close() {
    var root = $('dp-douyin');
    state.open = false;
    state.page = 'home';
    state.meTab = 'works';
    closeSheet();
    stopStatusDots();
    clearSuccessFlash();
    if (root) {
      root.classList.remove('is-open');
      var sheet = $('dp-douyin-sheet');
      if (sheet) {
        sheet.classList.remove('is-open');
        sheet.hidden = true;
      }
      var dock = $('dp-douyin-dock-host');
      if (dock) dock.classList.remove('is-dim');
      setTimeout(function () {
        if (!state.open) root.hidden = true;
      }, 280);
    }
  }

  global.miyaDeepDouyin = {
    open: open,
    close: close,
    refresh: handleRefresh
  };
})(typeof window !== 'undefined' ? window : global);
