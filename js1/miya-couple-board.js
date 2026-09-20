/**
 * miya-couple-board.js — 留言板 · UI
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var TYPE_LABELS = {
    sticky: '随手贴',
    fold: '折叠条',
    challenge: '挑战贴',
    capsule: '胶囊贴',
    prompt: '双贴问答',
    reply: '回音贴'
  };

  var COLOR_CLASS = {
    rose: 'pink',
    coral: 'pink',
    sky: 'cream',
    mint: 'cream',
    lavender: 'cream',
    gold: 'beige',
    lemon: 'beige'
  };

  var PLACEHOLDER_STICKIES = [
    { text: '今天的夕阳很好看呀', emoji: '🌸', color: 'beige', time: '05/20 18:30' },
    { text: '遇到可爱的人\n生活一下子\n不艰难了', emoji: '♡', color: 'pink', time: '05/20 17:15' },
    { text: '希望我们都能\n在各自的热爱里\n闪闪发光', emoji: '✦', color: 'cream', time: '06/20 16:20' }
  ];

  var state = {
    contactId: '',
    busy: false,
    composeMode: 'sticky',
    openedFoldId: '',
    openedCapsuleId: '',
    answerPromptId: '',
    answerPromptMode: 'first',
    foldExpanded: false,
    mineFilter: false,
    stickyShowAll: false,
    challengeShowAll: false,
    openedChallengeId: '',
    answerChallengeId: '',
    menuOpen: false,
    avatarUrls: { user: '', char: '' }
  };

  function store() { return global.miyaCoupleStore || null; }
  function bridge() { return global.miyaCoupleBoardBridge || null; }
  function chatStore() { return global.miyaChatStore || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function toast(msg) {
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.toast === 'function') {
      global.miyaCoupleApp.toast(msg);
      return;
    }
    var el = $('cp-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function todayIso() {
    var st = store();
    return st && st.isoToday ? st.isoToday() : '';
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function getSpaceNames(contactId) {
    var st = store();
    var sp = st ? st.getSpace(contactId) : null;
    var cs = chatStore();
    var contact = null;
    if (cs && contactId) {
      contact = cs.findContact ? cs.findContact(contactId) : null;
      if (!contact) {
        contact = (cs.getContacts() || []).find(function (c) { return c && c.id === contactId; }) || null;
      }
    }
    var profile = null;
    if (cs && sp && sp.profileId) {
      profile = (cs.getProfiles() || []).find(function (p) { return p && p.id === sp.profileId; }) || null;
    }
    if (!profile && cs && cs.getActiveProfile) profile = cs.getActiveProfile();
    return {
      profileName: profile && profile.name ? String(profile.name).trim() : (sp && sp.profileName ? sp.profileName : '我'),
      charName: contact && contact.name ? String(contact.name).trim() : (sp && sp.charName ? sp.charName : 'TA'),
      contact: contact,
      profile: profile
    };
  }

  function resolveProfileAvatarUrl(profile) {
    var cs = chatStore();
    if (!profile) return Promise.resolve('');
    if (cs && typeof cs.resolveProfileDisplayAvatarSync === 'function') {
      var displaySync = cs.resolveProfileDisplayAvatarSync(profile);
      if (displaySync) return Promise.resolve(displaySync);
    }
    if (cs && typeof cs.hasProfileDisplayAvatarOverride === 'function' && cs.hasProfileDisplayAvatarOverride(profile)) {
      if (typeof cs.resolveProfileDisplayAvatarAsync === 'function') {
        return cs.resolveProfileDisplayAvatarAsync(profile).then(function (url) {
          return url || resolveProfileAvatarFromId(profile);
        });
      }
    }
    return resolveProfileAvatarFromId(profile);
  }

  function resolveProfileAvatarFromId(profile) {
    var cs = chatStore();
    if (!profile) return Promise.resolve('');
    var direct = trim(profile.avatarUrl || profile.avatar);
    if (direct && direct.indexOf('blob:') !== 0) return Promise.resolve(direct);
    var blobId = trim(profile.avatarId || profile.avatarBlobId);
    if (cs && blobId) {
      if (typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) return Promise.resolve(cached);
      }
      if (typeof cs.getAvatarUrl === 'function') {
        return cs.getAvatarUrl(blobId).then(function (url) { return url || ''; }).catch(function () { return ''; });
      }
    }
    return Promise.resolve('');
  }

  function resolveCharAvatarUrl(contact) {
    var cs = chatStore();
    if (!contact) return Promise.resolve('');
    if (cs && typeof cs.resolveContactDisplayAvatarSync === 'function') {
      var displaySync = cs.resolveContactDisplayAvatarSync(contact);
      if (displaySync) return Promise.resolve(displaySync);
    }
    if (cs && typeof cs.hasContactDisplayAvatarOverride === 'function' && cs.hasContactDisplayAvatarOverride(contact)) {
      if (typeof cs.resolveContactDisplayAvatarAsync === 'function') {
        return cs.resolveContactDisplayAvatarAsync(contact).then(function (url) {
          return url || resolveCharAvatarFromId(contact);
        });
      }
    }
    return resolveCharAvatarFromId(contact);
  }

  function resolveCharAvatarFromId(contact) {
    var cs = chatStore();
    if (!contact) return Promise.resolve('');
    var direct = trim(contact.avatar);
    if (direct) return Promise.resolve(direct);
    var blobId = trim(contact.avatarBlobId);
    if (cs && blobId) {
      if (typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) return Promise.resolve(cached);
      }
      if (typeof cs.getAvatarUrl === 'function') {
        return cs.getAvatarUrl(blobId).then(function (url) { return url || ''; }).catch(function () { return ''; });
      }
    }
    return Promise.resolve('');
  }

  function resolveAvatars(contactId) {
    state.avatarUrls = { user: '', char: '' };
    var names = getSpaceNames(contactId);

    function applyAvatar(role, url) {
      state.avatarUrls[role] = url || '';
      if (state.contactId === contactId) renderChallengeSection();
    }

    if (names.profile) {
      resolveProfileAvatarUrl(names.profile).then(function (url) {
        applyAvatar('user', url);
      });
    }
    if (names.contact) {
      resolveCharAvatarUrl(names.contact).then(function (url) {
        applyAvatar('char', url);
      });
    }
  }

  function avatarHtml(role, letter) {
    var url = role === 'user' ? state.avatarUrls.user : state.avatarUrls.char;
    if (url) {
      return '<span class="cp-bd-challenge-card__av"><img src="' + esc(url) + '" alt=""></span>';
    }
    return '<span class="cp-bd-challenge-card__av">' + esc(letter || '?') + '</span>';
  }

  function setLoading(show, text) {
    var el = $('cp-board-loading');
    var tx = $('cp-board-loading-text');
    if (el) el.hidden = !show;
    if (tx && text) tx.textContent = text;
    state.busy = !!show;
    var refreshBtn = $('cp-board-refresh');
    var fabBtn = $('cp-board-write-fab');
    var typeBtns = document.querySelectorAll('[data-cp-board-fab]');
    if (refreshBtn) refreshBtn.disabled = !!show;
    if (fabBtn) fabBtn.disabled = !!show;
    typeBtns.forEach(function (btn) { btn.disabled = !!show; });
  }

  function setViewVisible(show) {
    var view = $('cp-view-board');
    var app = $('miya-couple-app');
    if (view) view.hidden = !show;
    if (app) app.classList.toggle('is-board', !!show);
  }

  function dispatchUpdated() {
    if (typeof global.dispatchEvent === 'function') {
      try {
        global.dispatchEvent(new CustomEvent('miya-couple-board-updated', {
          detail: { contactId: state.contactId }
        }));
      } catch (e) { /* ignore */ }
    }
  }

  function open(contactId) {
    if (!contactId) return;
    state.contactId = contactId;
    state.openedFoldId = '';
    state.openedCapsuleId = '';
    state.foldExpanded = false;
    state.mineFilter = false;
    state.stickyShowAll = false;
    state.challengeShowAll = false;
    state.openedChallengeId = '';
    state.answerChallengeId = '';
    state.menuOpen = false;

    resolveAvatars(contactId);

    var st = store();
    if (st) {
      if (typeof st.revealDueBoardCapsules === 'function') {
        var revealed = st.revealDueBoardCapsules(contactId);
        if (revealed.length) toast('有 ' + revealed.length + ' 张胶囊贴到了拆开的时候');
      }
      if (typeof st.markBoardRead === 'function') st.markBoardRead(contactId);
    }

    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderBoardPreview === 'function') {
      global.miyaCoupleApp.renderBoardPreview(contactId);
    }

    setViewVisible(true);
    renderAll();

    var br = bridge();
    if (br && typeof br.ensureWeeklyPrompt === 'function') {
      setLoading(true, '正在加载本周问答…');
      br.ensureWeeklyPrompt(contactId, {
        onProgress: function (p) {
          if (p && p.message) setLoading(true, p.message);
        }
      }).then(function () {
        setLoading(false);
        renderAll();
      }).catch(function (err) {
        setLoading(false);
        if (err && err.message && err.message.indexOf('未找到') < 0) {
          toast(err.message);
        }
        renderAll();
      });
    }
  }

  function close() {
    var cid = state.contactId;
    setViewVisible(false);
    state.contactId = '';
    closeCompose();
    closeTypeSheet();
    closeMenu();
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderBoardPreview === 'function') {
      global.miyaCoupleApp.renderBoardPreview(cid);
    }
  }

  function closeMenu() {
    state.menuOpen = false;
    var pop = $('cp-board-menu-pop');
    if (pop) pop.hidden = true;
  }

  function toggleMenu() {
    state.menuOpen = !state.menuOpen;
    var pop = $('cp-board-menu-pop');
    if (pop) pop.hidden = !state.menuOpen;
  }

  function openTypeSheet() {
    if (state.busy) return;
    var el = $('cp-board-type-sheet');
    if (el) el.hidden = false;
  }

  function closeTypeSheet() {
    var el = $('cp-board-type-sheet');
    if (el) el.hidden = true;
  }

  function isCapsuleLocked(entry) {
    if (!entry || entry.type !== 'capsule') return false;
    if (entry.revealed) return false;
    var reveal = trim(entry.revealAt);
    if (!reveal) return true;
    return reveal > todayIso();
  }

  function formatDateTime(entry) {
    if (!entry) return '';
    var dateIso = trim(entry.dateIso);
    var mm = '—';
    var dd = '—';
    if (dateIso && dateIso.indexOf('-') > 0) {
      var parts = dateIso.split('-');
      if (parts.length >= 3) {
        mm = parts[1];
        dd = parts[2];
      }
    } else if (entry.createdAt) {
      var d = new Date(entry.createdAt);
      mm = pad(d.getMonth() + 1);
      dd = pad(d.getDate());
    }
    var time = trim(entry.timeAt);
    if (!time && entry.createdAt) {
      var dt = new Date(entry.createdAt);
      time = pad(dt.getHours()) + ':' + pad(dt.getMinutes());
    }
    return mm + '/' + dd + (time ? ' ' + time : '');
  }

  function formatRevealDate(revealAt) {
    if (!revealAt) return '未来某天 开启';
    var parts = String(revealAt).split('-');
    if (parts.length < 3) return revealAt + ' 开启';
    return parts[0] + '.' + parts[1] + '.' + parts[2] + ' 20:00 开启';
  }

  function colorClass(entry, idx) {
    var c = entry && entry.color ? COLOR_CLASS[entry.color] || entry.color : '';
    if (c === 'pink' || c === 'beige' || c === 'cream') return c;
    if (entry && entry.color) return entry.color;
    var defaults = ['beige', 'pink', 'cream'];
    return defaults[idx % 3];
  }

  function getBoardList() {
    var st = store();
    return st ? st.getBoard(state.contactId) : [];
  }

  function filterTopLevel(list) {
    var st = store();
    return list.filter(function (e) {
      if (!e) return false;
      if (e.type === 'prompt') return false;
      if (e.parentId) {
        var parent = st.findBoardEntry(state.contactId, e.parentId);
        if (parent && parent.type !== 'reply') return false;
      }
      return true;
    });
  }

  function renderFoldReply(reply, names) {
    if (!reply) return '';
    var isUser = reply.author === 'user';
    return (
      '<div class="cp-bd-fold-reply" data-cp-board-id="' + esc(reply.id) + '">' +
        '<span class="cp-bd-fold-reply__who">' + esc(isUser ? names.profileName : names.charName) + ' 回贴</span>' +
        '<p class="cp-bd-fold-reply__text">' + esc(reply.text) + '</p>' +
      '</div>'
    );
  }

  function renderFoldItem(entry, names) {
    var isOpened = state.openedFoldId === entry.id || entry.opened;
    var isUser = entry.author === 'user';
    var replies = getThreadReplies(entry.id);
    var hasCharReply = replies.some(function (r) { return r.author === 'char'; });
    var text = isOpened
      ? esc(entry.text)
      : (hasCharReply ? '点击展开 · TA 已回贴' : '点击展开这条折叠条');
    var html = (
      '<div class="cp-bd-fold-group">' +
        '<button type="button" class="cp-bd-fold-item' + (isOpened ? '' : ' is-folded') + '" data-cp-board-fold="' + esc(entry.id) + '">' +
          '<span class="cp-bd-fold-item__who">' + esc(isUser ? names.profileName : names.charName) + '</span>' +
          '<p class="cp-bd-fold-item__text">' + text + '</p>' +
        '</button>'
    );
    if (replies.length && isOpened) {
      html += '<div class="cp-bd-fold-thread">' +
        replies.map(function (r) { return renderFoldReply(r, names); }).join('') +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  function getThreadReplies(parentId) {
    var st = store();
    if (!st || !parentId) return [];
    return st.getBoard(state.contactId).filter(function (e) {
      return e && e.parentId === parentId && e.type === 'reply';
    });
  }

  function getPromptThreadReplies(promptId) {
    return getThreadReplies(promptId).slice().sort(function (a, b) {
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
  }

  function getPromptTurn(promptId) {
    var thread = getPromptThreadReplies(promptId);
    var last = thread[thread.length - 1];
    if (!last || last.author === 'char') return 'user';
    return 'char';
  }

  function collectStickyCards() {
    var st = store();
    var today = todayIso();
    var list = filterTopLevel(getBoardList());
    var cards = [];
    var seen = {};

    function push(entry, opts) {
      opts = opts || {};
      if (!entry || seen[entry.id]) return;
      if (state.mineFilter && entry.author !== 'user') return;
      seen[entry.id] = true;
      cards.push({
        entry: entry,
        isReply: !!opts.isReply,
        isTodayChar: !!opts.isTodayChar
      });
    }

    list.forEach(function (e) {
      if (e.author === 'char' && e.source === 'char_daily' && e.dateIso === today) {
        push(e, { isTodayChar: true });
      }
    });

    list.forEach(function (e) {
      if (e.type !== 'sticky') return;
      push(e, { isReply: false });
      getThreadReplies(e.id).forEach(function (r) {
        push(r, { isReply: true });
      });
    });

    cards.sort(function (a, b) {
      var ka = st && st.boardSortKey ? st.boardSortKey(a.entry) : (Number(a.entry.createdAt) || 0);
      var kb = st && st.boardSortKey ? st.boardSortKey(b.entry) : (Number(b.entry.createdAt) || 0);
      if (a.isTodayChar && b.isTodayChar) return ka - kb;
      if (a.isTodayChar && !b.isTodayChar) return -1;
      if (!a.isTodayChar && b.isTodayChar) return 1;
      return kb - ka;
    });

    return cards;
  }

  function stickyTypeBadge(entry) {
    if (!entry || entry.type === 'sticky' || entry.type === 'reply') return '';
    var label = TYPE_LABELS[entry.type] || entry.type;
    return '<span class="cp-bd-note__type">' + esc(label.replace('贴', '')) + '</span>';
  }

  function renderStickyNote(entry, idx, isPlaceholder, isReply) {
    var cls = colorClass(entry, idx);
    var curl = idx % 2 === 0 ? ' cp-bd-note--curl' : '';
    var phCls = isPlaceholder ? ' cp-bd-note--empty' : '';
    var replyCls = isReply ? ' cp-bd-note--reply' : '';
    var text = isPlaceholder ? entry.text : esc(entry.text);
    var time = isPlaceholder ? entry.time : formatDateTime(entry);
    var emoji = isPlaceholder ? entry.emoji : (entry.sticker || entry.mood || '');
    var emojiHtml = emoji ? '<span class="cp-bd-note__emoji">' + esc(emoji) + '</span>' : '';
    var idAttr = isPlaceholder ? '' : ' data-cp-board-id="' + esc(entry.id) + '"';
    var typeBadge = isPlaceholder ? '' : stickyTypeBadge(entry);

    return (
      '<article class="cp-bd-note cp-bd-note--' + esc(cls) + curl + phCls + replyCls + '"' + idAttr + '>' +
        '<span class="cp-bd-note__pin" aria-hidden="true"></span>' +
        (isReply ? '<span class="cp-bd-note__reply-mark">回</span>' : '') +
        typeBadge +
        '<p class="cp-bd-note__text">' + text.replace(/\n/g, '<br>') + '</p>' +
        emojiHtml +
        '<time class="cp-bd-note__time">' + esc(time) + '</time>' +
      '</article>'
    );
  }

  function renderStickySection() {
    var track = $('cp-board-sticky-track');
    var allList = $('cp-board-sticky-all-list');
    var allBtn = $('cp-board-sticky-all');
    var subEl = document.querySelector('.cp-bd-sec[aria-label="随手贴"] .cp-bd-sec-head__sub');
    if (!track) return;

    var cards = collectStickyCards();
    var hasReal = cards.length > 0;
    var todayCharCount = cards.filter(function (c) { return c.isTodayChar; }).length;

    if (subEl) {
      subEl.textContent = todayCharCount > 0
        ? ('今日 TA 留了 ' + todayCharCount + ' 条 · 左右滑动查看更多')
        : '此刻的心情，随手记录';
    }

    if (allBtn) {
      allBtn.innerHTML = state.stickyShowAll && hasReal
        ? '收起 <span aria-hidden="true">‹</span>'
        : '全部 <span aria-hidden="true">›</span>';
    }

    if (hasReal) {
      track.innerHTML = cards.map(function (c, i) {
        return renderStickyNote(c.entry, i, false, c.isReply);
      }).join('');
      track.classList.toggle('is-hidden', state.stickyShowAll);

      if (allList) {
        if (state.stickyShowAll) {
          allList.hidden = false;
          allList.innerHTML = cards.map(function (c, i) {
            return renderStickyNote(c.entry, i, false, c.isReply);
          }).join('');
        } else {
          allList.hidden = true;
          allList.innerHTML = '';
        }
      }
    } else {
      track.classList.remove('is-hidden');
      track.innerHTML = PLACEHOLDER_STICKIES.map(function (e, i) {
        return renderStickyNote(e, i, true, false);
      }).join('');
      if (allList) {
        allList.hidden = true;
        allList.innerHTML = '';
      }
    }
  }

  function renderFoldSection() {
    var toggle = $('cp-board-fold-toggle');
    var listEl = $('cp-board-fold-list');
    var label = $('cp-board-fold-label');
    if (!toggle || !listEl) return;

    var folds = filterTopLevel(getBoardList()).filter(function (e) {
      return e.type === 'fold';
    });

    toggle.classList.toggle('is-open', state.foldExpanded);
    if (label) label.textContent = state.foldExpanded ? '收起' : '展开';

    var foldTitle = toggle && toggle.querySelector('.cp-bd-fold-bar__sub');
    if (foldTitle) {
      foldTitle.textContent = folds.length
        ? ('共 ' + folds.length + ' 条折叠心事 · 点击' + (state.foldExpanded ? '收起' : '展开'))
        : '展开属于你的更多心事';
    }

    if (!folds.length) {
      listEl.hidden = true;
      listEl.innerHTML = '';
      return;
    }

    listEl.hidden = !state.foldExpanded;
    if (!state.foldExpanded) {
      listEl.innerHTML = '';
      return;
    }

    var names = getSpaceNames(state.contactId);
    listEl.innerHTML = folds.map(function (entry) {
      return renderFoldItem(entry, names);
    }).join('');
  }

  function collectChallenges() {
    var st = store();
    return filterTopLevel(getBoardList()).filter(function (e) {
      return e && e.type === 'challenge';
    }).sort(function (a, b) {
      var ka = st && st.boardSortKey ? st.boardSortKey(a) : (Number(a.createdAt) || 0);
      var kb = st && st.boardSortKey ? st.boardSortKey(b) : (Number(b.createdAt) || 0);
      return kb - ka;
    });
  }

  function getChallengeReplies(challengeId) {
    return getThreadReplies(challengeId).slice().sort(function (a, b) {
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });
  }

  function getChallengeParticipants(entry, replies) {
    var names = getSpaceNames(state.contactId);
    var participants = [];
    var seen = {};

    function push(role, author) {
      if (seen[author]) return;
      seen[author] = true;
      participants.push({
        role: role,
        author: author,
        letter: author === 'user' ? names.profileName.charAt(0) : names.charName.charAt(0)
      });
    }

    if (entry) push(entry.author === 'user' ? 'user' : 'char', entry.author);
    (replies || []).forEach(function (r) {
      push(r.author === 'user' ? 'user' : 'char', r.author);
    });
    return participants;
  }

  function userHasChallengeAnswer(challengeId) {
    return getChallengeReplies(challengeId).some(function (e) {
      return e.author === 'user' && e.source === 'user_challenge_answer';
    });
  }

  function renderChallengeReply(reply, names) {
    if (!reply) return '';
    var isUser = reply.author === 'user';
    return (
      '<div class="cp-bd-challenge-reply" data-cp-board-id="' + esc(reply.id) + '">' +
        '<span class="cp-bd-challenge-reply__who">' + esc(isUser ? names.profileName : names.charName) + ' 的回答</span>' +
        '<p class="cp-bd-challenge-reply__text">' + esc(reply.text) + '</p>' +
      '</div>'
    );
  }

  function renderChallengeItem(entry, names, expanded) {
    var replies = getChallengeReplies(entry.id);
    var participants = getChallengeParticipants(entry, replies);
    var isUserChallenge = entry.author === 'user';
    var userAnswered = userHasChallengeAnswer(entry.id);
    var charReplied = replies.some(function (r) { return r.author === 'char'; });
    var needsUserAnswer = !isUserChallenge && !userAnswered;
    var waitingChar = isUserChallenge && !charReplied;
    var stats = participants.length + ' 人参与挑战';
    var previewReplies = replies.slice(0, 2);

    var html = (
      '<div class="cp-bd-challenge-group">' +
        '<button type="button" class="cp-bd-challenge-item' + (expanded ? '' : ' is-collapsed') + '" data-cp-board-challenge-toggle="' + esc(entry.id) + '">' +
          '<span class="cp-bd-challenge-item__tag">挑战</span>' +
          '<p class="cp-bd-challenge-item__q"># ' + esc(entry.text) + '</p>' +
          '<span class="cp-bd-challenge-item__meta">' + esc(stats) + ' · ' + esc(formatDateTime(entry)) + '</span>' +
        '</button>'
    );

    if (expanded) {
      html += '<div class="cp-bd-challenge-thread">';
      if (isUserChallenge) {
        html += (
          '<div class="cp-bd-challenge-reply cp-bd-challenge-reply--question">' +
            '<span class="cp-bd-challenge-reply__who">' + esc(names.profileName) + ' 出题</span>' +
            '<p class="cp-bd-challenge-reply__text">' + esc(entry.text) + '</p>' +
          '</div>'
        );
      } else {
        html += (
          '<div class="cp-bd-challenge-reply cp-bd-challenge-reply--question">' +
            '<span class="cp-bd-challenge-reply__who">' + esc(names.charName) + ' 出题</span>' +
            '<p class="cp-bd-challenge-reply__text">' + esc(entry.text) + '</p>' +
          '</div>'
        );
      }
      if (replies.length) {
        html += replies.map(function (r) { return renderChallengeReply(r, names); }).join('');
      } else if (waitingChar) {
        html += '<p class="cp-bd-challenge-thread__wait">等待 TA 接招…</p>';
      }
      if (needsUserAnswer) {
        html += (
          '<button type="button" class="cp-bd-challenge-thread__answer-btn" data-cp-board-challenge-answer="' + esc(entry.id) + '">' +
            '写下你的回答 <span aria-hidden="true">›</span>' +
          '</button>'
        );
      }
      html += '</div>';
    } else if (previewReplies.length) {
      html += '<div class="cp-bd-challenge-preview">' +
        previewReplies.map(function (r) { return renderChallengeReply(r, names); }).join('') +
      '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderChallengeCard(entry, names) {
    var replies = getChallengeReplies(entry.id);
    var participants = getChallengeParticipants(entry, replies);
    var isUserChallenge = entry.author === 'user';
    var userAnswered = userHasChallengeAnswer(entry.id);
    var charReplied = replies.some(function (r) { return r.author === 'char'; });
    var needsUserAnswer = !isUserChallenge && !userAnswered;
    var waitingChar = isUserChallenge && !charReplied;
    var stats = participants.length > 0
      ? participants.length + ' 人参与挑战'
      : '暂无回答';
    var previewReplies = replies.slice(0, 2);
    var btnLabel = needsUserAnswer ? '去回答' : (replies.length ? '查看回答' : '等待 TA 接招');
    var btnAttr = needsUserAnswer
      ? ' data-cp-board-challenge-answer="' + esc(entry.id) + '"'
      : (replies.length ? ' data-cp-board-challenge-toggle="' + esc(entry.id) + '"' : ' disabled');

    var repliesHtml = previewReplies.length
      ? '<div class="cp-bd-challenge-card__replies">' +
          previewReplies.map(function (r) { return renderChallengeReply(r, names); }).join('') +
        '</div>'
      : (waitingChar ? '<p class="cp-bd-challenge-card__wait">等待 TA 接招…</p>' : '');

    return (
      '<div class="cp-bd-challenge-card__img" aria-hidden="true"></div>' +
      '<div class="cp-bd-challenge-card__body">' +
        '<p class="cp-bd-challenge-card__q"># ' + esc(entry.text) + '</p>' +
        '<p class="cp-bd-challenge-card__stats">' + esc(stats) + '</p>' +
        '<div class="cp-bd-challenge-card__avatars">' +
          participants.map(function (p) { return avatarHtml(p.role, p.letter); }).join('') +
        '</div>' +
        repliesHtml +
        '<div class="cp-bd-challenge-card__foot">' +
          '<button type="button" class="cp-bd-challenge-card__btn"' + btnAttr + '>' + esc(btnLabel) + ' <span>›</span></button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderChallengeSection() {
    var card = $('cp-board-challenge-card');
    var allList = $('cp-board-challenge-all-list');
    var allBtn = $('cp-board-challenge-all');
    if (!card) return;

    var challenges = collectChallenges();
    var names = getSpaceNames(state.contactId);
    var latest = challenges[0] || null;
    var hasReal = challenges.length > 0;

    if (allBtn) {
      allBtn.innerHTML = state.challengeShowAll && hasReal
        ? '收起 <span aria-hidden="true">‹</span>'
        : '全部挑战 <span aria-hidden="true">›</span>';
    }

    if (!latest) {
      card.innerHTML = (
          '<div class="cp-bd-challenge-card__img" aria-hidden="true"></div>' +
          '<div class="cp-bd-challenge-card__body">' +
            '<p class="cp-bd-challenge-card__q"># 你最近最治愈的一件小事是什么？</p>' +
            '<p class="cp-bd-challenge-card__stats">写下第一条挑战吧</p>' +
            '<div class="cp-bd-challenge-card__avatars">' +
              avatarHtml('char', names.charName.charAt(0)) +
              avatarHtml('user', names.profileName.charAt(0)) +
            '</div>' +
            '<div class="cp-bd-challenge-card__foot">' +
              '<button type="button" class="cp-bd-challenge-card__btn" data-cp-board-fab="challenge">发起挑战 <span>›</span></button>' +
            '</div>' +
          '</div>'
      );
      card.classList.add('cp-bd-challenge-card--empty');
      card.classList.remove('is-hidden');
      if (allList) {
        allList.hidden = true;
        allList.innerHTML = '';
      }
      return;
    }

    card.classList.remove('cp-bd-challenge-card--empty');
    card.innerHTML = renderChallengeCard(latest, names);
    card.classList.toggle('is-hidden', state.challengeShowAll);

    if (allList) {
      if (state.challengeShowAll) {
        allList.hidden = false;
        allList.innerHTML = challenges.map(function (entry) {
          return renderChallengeItem(entry, names, state.openedChallengeId === entry.id);
        }).join('');
      } else {
        allList.hidden = true;
        allList.innerHTML = '';
      }
    }
  }

  function renderCapsuleSection() {
    var card = $('cp-board-capsule-card');
    if (!card) return;

    var capsules = filterTopLevel(getBoardList()).filter(function (e) {
      return e.type === 'capsule';
    });

    var entry = capsules.find(isCapsuleLocked) || capsules[0];

    if (!entry) {
      card.innerHTML = (
          '<div class="cp-bd-capsule-card__visual" aria-hidden="true">' +
            '<div class="cp-bd-capsule-card__capsule"><span class="cp-bd-capsule-card__scroll"></span></div>' +
          '</div>' +
          '<div class="cp-bd-capsule-card__info">' +
            '<p class="cp-bd-capsule-card__title">给未来的自己</p>' +
            '<p class="cp-bd-capsule-card__date">2025.12.31 20:00 开启</p>' +
            '<span class="cp-bd-capsule-card__tag">待开启</span>' +
          '</div>' +
          '<div class="cp-bd-capsule-card__stamp" aria-hidden="true">' +
            '<span class="cp-bd-capsule-card__stamp-text">未来<br>可期</span>' +
            '<span class="cp-bd-capsule-card__stamp-waves">～～～</span>' +
          '</div>'
      );
      card.classList.add('cp-bd-capsule-card--empty');
      return;
    }

    card.classList.remove('cp-bd-capsule-card--empty');

    var locked = isCapsuleLocked(entry);
    var title = locked ? '给未来的自己' : esc(entry.text.slice(0, 20) + (entry.text.length > 20 ? '…' : ''));
    var dateStr = locked ? formatRevealDate(entry.revealAt) : formatDateTime(entry);
    var tagText = locked ? '待开启' : '已开启';
    var tagCls = locked ? '' : ' is-open';

    card.innerHTML = (
        '<div class="cp-bd-capsule-card__visual" aria-hidden="true">' +
          '<div class="cp-bd-capsule-card__capsule"><span class="cp-bd-capsule-card__scroll"></span></div>' +
        '</div>' +
        '<div class="cp-bd-capsule-card__info">' +
          '<p class="cp-bd-capsule-card__title">' + title + '</p>' +
          '<p class="cp-bd-capsule-card__date">' + esc(dateStr) + '</p>' +
          '<span class="cp-bd-capsule-card__tag' + tagCls + '">' + tagText + '</span>' +
        '</div>' +
        '<div class="cp-bd-capsule-card__stamp" aria-hidden="true">' +
          '<span class="cp-bd-capsule-card__stamp-text">未来<br>可期</span>' +
          '<span class="cp-bd-capsule-card__stamp-waves">～～～</span>' +
        '</div>'
    );
    card.setAttribute('data-cp-board-id', entry.id);
  }

  function renderPromptSideNote(reply, names) {
    if (!reply) return '';
    var isUser = reply.author === 'user';
    return (
      '<article class="cp-board-note cp-board-note--' + (isUser ? 'user' : 'char') +
        ' is-color-' + esc(reply.color || (isUser ? 'sky' : 'gold')) + ' is-prompt-side">' +
        '<span class="cp-board-note__who">' + esc(isUser ? names.profileName : names.charName) + '</span>' +
        '<p class="cp-board-note__text">' + esc(reply.text) + '</p>' +
      '</article>'
    );
  }

  function renderPromptCard(entry) {
    if (!entry) return '';
    var names = getSpaceNames(state.contactId);
    var thread = getPromptThreadReplies(entry.id);
    var charAnswer = entry.meta && entry.meta.charAnswer ? entry.meta.charAnswer : '';
    var charReply = thread.find(function (e) { return e.source === 'char_prompt_answer' || e.author === 'char'; });
    if (!charAnswer && charReply) charAnswer = charReply.text;
    var userReply = thread.find(function (e) { return e.source === 'user_prompt_answer'; });
    var continuations = thread.filter(function (e) {
      return e.source === 'user_prompt_continue' || e.source === 'char_prompt_continue';
    });
    var turn = getPromptTurn(entry.id);
    var hasFirstAnswer = !!userReply;
    var arrowLabel = turn === 'user'
      ? (hasFirstAnswer ? '继续回复' : '写下回答')
      : '让 TA 继续贴';
    return (
      '<section class="cp-board-prompt" data-cp-board-prompt="' + esc(entry.id) + '">' +
        '<header class="cp-board-prompt__head">' +
          '<span class="cp-board-prompt__label">Weekly · 双贴问答</span>' +
          '<span class="cp-board-prompt__rule" aria-hidden="true"></span>' +
        '</header>' +
        '<blockquote class="cp-board-prompt__q">' + esc(entry.text) + '</blockquote>' +
        '<div class="cp-board-prompt__pair">' +
          '<article class="cp-board-note cp-board-note--char is-color-' + esc(entry.color || 'gold') + ' is-prompt-side">' +
            '<span class="cp-board-note__who">' + esc(names.charName) + '</span>' +
            '<p class="cp-board-note__text">' + esc(charAnswer || '…') + '</p>' +
          '</article>' +
          (userReply
            ? renderPromptSideNote(userReply, names)
            : '<button type="button" class="cp-board-prompt__answer-btn" data-cp-board-answer="' + esc(entry.id) + '">' +
                '<span class="cp-board-prompt__answer-icon" aria-hidden="true">+</span>' +
                '<span>写下你的回答</span>' +
              '</button>') +
        '</div>' +
        (continuations.length
          ? '<div class="cp-board-prompt__thread">' +
              continuations.map(function (r) { return renderPromptSideNote(r, names); }).join('') +
            '</div>'
          : '') +
        '<div class="cp-board-prompt__continue">' +
          '<button type="button" class="cp-board-prompt__continue-btn" data-cp-board-prompt-continue="' + esc(entry.id) + '" data-cp-board-prompt-turn="' + esc(turn) + '">' +
            '<span aria-hidden="true">→</span> ' + esc(arrowLabel) +
          '</button>' +
        '</div>' +
      '</section>'
    );
  }

  function renderPromptWrap() {
    var wrap = $('cp-board-prompt-wrap');
    if (!wrap) return;
    var prompt = getBoardList().find(function (e) { return e && e.type === 'prompt'; });
    if (!prompt) {
      wrap.hidden = true;
      wrap.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    wrap.innerHTML = renderPromptCard(prompt);
  }

  function renderMineButton() {
    var btn = $('cp-board-mine');
    if (btn) btn.classList.toggle('is-on', state.mineFilter);
  }

  function renderAll() {
    renderMineButton();
    renderStickySection();
    renderFoldSection();
    renderChallengeSection();
    renderCapsuleSection();
    renderPromptWrap();
  }

  function handleRefresh() {
    closeMenu();
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.generateCharDailyBoard !== 'function') {
      toast('留言板模块未就绪');
      return;
    }
    setLoading(true, '正在刷新 TA 今日留言…');
    br.generateCharDailyBoard(state.contactId, {
      onProgress: function (p) {
        if (p && p.message) setLoading(true, p.message);
      }
    }).then(function (res) {
      setLoading(false);
      renderAll();
      dispatchUpdated();
      toast('已刷新 ' + (res && res.count ? res.count : '') + ' 条 TA 的便签');
      if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderBoardPreview === 'function') {
        global.miyaCoupleApp.renderBoardPreview(state.contactId);
      }
    }).catch(function (err) {
      setLoading(false);
      toast(err && err.message ? err.message : '刷新失败');
    });
  }

  function openCompose(mode) {
    if (state.busy) return;
    closeTypeSheet();
    state.composeMode = mode || 'sticky';
    var overlay = $('cp-board-compose');
    var title = $('cp-board-compose-title');
    var capsuleRow = $('cp-board-compose-capsule-row');
    var hint = $('cp-board-compose-hint');
    if (overlay) overlay.hidden = false;
    if (title) {
      title.textContent = TYPE_LABELS[state.composeMode] || '写便签';
    }
    if (capsuleRow) capsuleRow.hidden = state.composeMode !== 'capsule';
    if (hint) {
      hint.textContent = state.composeMode === 'challenge'
        ? '给 TA 出一道恋人挑战，TA 会接招回贴'
        : state.composeMode === 'capsule'
          ? '设定拆开日期，到期后才能看见'
          : state.composeMode === 'fold'
            ? '写好后会折起来，点开才展开'
            : '随手写一句，TA 会在旁边回贴';
    }
    var text = $('cp-board-compose-text');
    var mood = $('cp-board-compose-mood');
    var reveal = $('cp-board-compose-reveal');
    if (text) text.value = '';
    if (mood) mood.value = '';
    if (reveal && state.composeMode === 'capsule') {
      var d = new Date();
      d.setDate(d.getDate() + 3);
      reveal.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    var colors = $('cp-board-compose-colors');
    if (colors) {
      colors.querySelectorAll('[data-cp-board-color]').forEach(function (btn, idx) {
        btn.classList.toggle('is-on', idx === 0);
      });
    }
    if (text) text.focus();
  }

  function closeCompose() {
    var overlay = $('cp-board-compose');
    if (overlay) overlay.hidden = true;
  }

  function getSelectedColor() {
    var active = document.querySelector('#cp-board-compose-colors [data-cp-board-color].is-on');
    return active ? trim(active.getAttribute('data-cp-board-color')) || 'rose' : 'rose';
  }

  function handleComposeSubmit() {
    if (state.busy) return;
    var br = bridge();
    if (!br || typeof br.createUserBoardNote !== 'function') {
      toast('留言板模块未就绪');
      return;
    }
    var text = trim($('cp-board-compose-text') && $('cp-board-compose-text').value);
    if (!text) {
      toast('请写点什么');
      return;
    }
    var mood = trim($('cp-board-compose-mood') && $('cp-board-compose-mood').value);
    var revealAt = trim($('cp-board-compose-reveal') && $('cp-board-compose-reveal').value);
    var payload = {
      type: state.composeMode,
      text: text,
      color: getSelectedColor(),
      mood: mood
    };
    if (state.composeMode === 'capsule') {
      if (!revealAt || revealAt <= todayIso()) {
        toast('请选择未来的拆开日期');
        return;
      }
      payload.revealAt = revealAt;
    }

    closeCompose();
    var loadingMsg = state.composeMode === 'capsule'
      ? '正在封存胶囊贴…'
      : '正在贴便签…';
    setLoading(true, loadingMsg);

    br.createUserBoardNote(state.contactId, payload, {
      onProgress: function (p) {
        if (p && p.message) setLoading(true, p.message);
      }
    }).then(function (res) {
      setLoading(false);
      if (state.composeMode === 'fold' && res && res.entry) {
        state.foldExpanded = true;
        state.openedFoldId = res.entry.id;
        var st = store();
        if (st) st.updateBoardEntry(state.contactId, res.entry.id, { opened: true });
      }
      if (state.composeMode === 'challenge' && res && res.entry) {
        state.challengeShowAll = true;
        state.openedChallengeId = res.entry.id;
      }
      renderAll();
      dispatchUpdated();
      if (global.miyaCoupleApp && typeof global.miyaCoupleApp.renderBoardPreview === 'function') {
        global.miyaCoupleApp.renderBoardPreview(state.contactId);
      }
      if (res && res.replyError) {
        toast('已贴上，但 TA 回贴失败：' + res.replyError);
      } else if (state.composeMode === 'capsule') {
        toast('胶囊贴已封存');
      } else if (state.composeMode === 'fold') {
        toast('折叠条已贴上，TA 回贴了');
        var foldSec = document.querySelector('.cp-bd-fold-wrap');
        if (foldSec) foldSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (state.composeMode === 'challenge') {
        toast('挑战已发出，TA 正在接招…');
        var challengeSec = $('cp-board-challenge-sec');
        if (challengeSec) challengeSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        toast('已贴上，TA 回贴了');
      }
    }).catch(function (err) {
      setLoading(false);
      toast(err && err.message ? err.message : '发布失败');
    });
  }

  function openPromptAnswer(promptId, mode) {
    var entry = store().findBoardEntry(state.contactId, promptId);
    if (!entry) return;
    state.answerChallengeId = '';
    state.answerPromptId = promptId;
    state.answerPromptMode = mode === 'continue' ? 'continue' : 'first';
    var existing = null;
    if (state.answerPromptMode === 'first') {
      existing = getPromptThreadReplies(promptId).find(function (e) {
        return e.source === 'user_prompt_answer';
      });
    }
    var overlay = $('cp-board-answer');
    var title = $('cp-board-answer-title');
    var qEl = $('cp-board-answer-q');
    var textEl = $('cp-board-answer-text');
    if (title) {
      title.textContent = state.answerPromptMode === 'continue' ? '继续回复' : '写下你的回答';
    }
    if (qEl) qEl.textContent = entry.text;
    if (textEl) textEl.value = existing ? existing.text : '';
    if (overlay) overlay.hidden = false;
    if (textEl) textEl.focus();
  }

  function openChallengeAnswer(challengeId) {
    var entry = store().findBoardEntry(state.contactId, challengeId);
    if (!entry || entry.type !== 'challenge') return;
    state.answerPromptId = '';
    state.answerPromptMode = 'first';
    state.answerChallengeId = challengeId;
    var existing = getChallengeReplies(challengeId).find(function (e) {
      return e.author === 'user' && e.source === 'user_challenge_answer';
    });
    var overlay = $('cp-board-answer');
    var title = $('cp-board-answer-title');
    var eyebrow = overlay && overlay.querySelector('.cp-board-compose__eyebrow');
    var qEl = $('cp-board-answer-q');
    var textEl = $('cp-board-answer-text');
    if (eyebrow) eyebrow.textContent = 'Challenge';
    if (title) title.textContent = '写下你的回答';
    if (qEl) qEl.textContent = entry.text;
    if (textEl) textEl.value = existing ? existing.text : '';
    if (overlay) overlay.hidden = false;
    if (textEl) textEl.focus();
  }

  function closePromptAnswer() {
    state.answerPromptId = '';
    state.answerPromptMode = 'first';
    state.answerChallengeId = '';
    var overlay = $('cp-board-answer');
    if (overlay) overlay.hidden = true;
    var eyebrow = overlay && overlay.querySelector('.cp-board-compose__eyebrow');
    if (eyebrow) eyebrow.textContent = 'Weekly Q&A';
  }

  function handlePromptAnswerSubmit() {
    if (state.busy) return;
    var text = trim($('cp-board-answer-text') && $('cp-board-answer-text').value);
    if (!text) {
      toast('回答不能为空');
      return;
    }
    var br = bridge();
    if (!br) {
      toast('留言板模块未就绪');
      return;
    }

    if (state.answerChallengeId) {
      if (typeof br.submitChallengeAnswer !== 'function') {
        toast('留言板模块未就绪');
        return;
      }
      setLoading(true, '保存回答中…');
      br.submitChallengeAnswer(state.contactId, state.answerChallengeId, text).then(function () {
        setLoading(false);
        closePromptAnswer();
        state.challengeShowAll = true;
        state.openedChallengeId = state.answerChallengeId;
        renderAll();
        dispatchUpdated();
        toast('回答已贴上');
      }).catch(function (err) {
        setLoading(false);
        toast(err && err.message ? err.message : '保存失败');
      });
      return;
    }

    if (!state.answerPromptId) return;
    var isContinue = state.answerPromptMode === 'continue';
    var submitFn = isContinue
      ? br.submitPromptContinueAnswer
      : br.submitPromptAnswer;
    if (typeof submitFn !== 'function') {
      toast('留言板模块未就绪');
      return;
    }
    setLoading(true, isContinue ? '贴上回复…' : '保存回答中…');
    submitFn.call(br, state.contactId, state.answerPromptId, text).then(function () {
      setLoading(false);
      closePromptAnswer();
      renderAll();
      dispatchUpdated();
      toast(isContinue ? '回复已贴上' : '回答已贴上');
    }).catch(function (err) {
      setLoading(false);
      toast(err && err.message ? err.message : '保存失败');
    });
  }

  function handlePromptContinue(promptId, turn) {
    if (state.busy) return;
    if (turn === 'user') {
      var hasFirstAnswer = getPromptThreadReplies(promptId).some(function (e) {
        return e.source === 'user_prompt_answer';
      });
      openPromptAnswer(promptId, hasFirstAnswer ? 'continue' : 'first');
      return;
    }
    var br = bridge();
    if (!br || typeof br.requestPromptThreadReply !== 'function') {
      toast('留言板模块未就绪');
      return;
    }
    setLoading(true, 'TA 正在写回贴…');
    br.requestPromptThreadReply(state.contactId, promptId, {
      onProgress: function (p) {
        if (p && p.message) setLoading(true, p.message);
      }
    }).then(function () {
      setLoading(false);
      renderAll();
      dispatchUpdated();
      toast('TA 回贴了');
    }).catch(function (err) {
      setLoading(false);
      toast(err && err.message ? err.message : '回贴失败');
    });
  }

  function scrollToSection(id) {
    var el = $(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function bindEvents() {
    var back = $('cp-board-back');
    if (back) {
      back.addEventListener('click', function () {
        closeMenu();
        close();
        if (global.miyaCoupleApp && typeof global.miyaCoupleApp.showSpaceView === 'function') {
          global.miyaCoupleApp.showSpaceView();
        }
      });
    }

    var menuBtn = $('cp-board-menu');
    if (menuBtn) menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMenu();
    });

    document.addEventListener('click', function () {
      if (state.menuOpen) closeMenu();
    });

    var menuPop = $('cp-board-menu-pop');
    if (menuPop) {
      menuPop.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    var refreshBtn = $('cp-board-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', handleRefresh);

    var writeFab = $('cp-board-write-fab');
    if (writeFab) writeFab.addEventListener('click', openTypeSheet);

    var typeSheet = $('cp-board-type-sheet');
    if (typeSheet) {
      typeSheet.addEventListener('click', function (e) {
        if (e.target.closest('[data-cp-board-type-close]') || e.target.classList.contains('cp-bd-type-sheet__backdrop')) {
          closeTypeSheet();
        }
        var fab = e.target.closest('[data-cp-board-fab]');
        if (fab) openCompose(fab.getAttribute('data-cp-board-fab') || 'sticky');
      });
    }

    document.querySelectorAll('#cp-board-type-sheet [data-cp-board-fab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openCompose(btn.getAttribute('data-cp-board-fab') || 'sticky');
      });
    });

    var mineBtn = $('cp-board-mine');
    if (mineBtn) {
      mineBtn.addEventListener('click', function () {
        state.mineFilter = !state.mineFilter;
        renderAll();
        toast(state.mineFilter ? '只看我的留言' : '显示全部留言');
      });
    }

    var foldToggle = $('cp-board-fold-toggle');
    if (foldToggle) {
      foldToggle.addEventListener('click', function () {
        state.foldExpanded = !state.foldExpanded;
        renderFoldSection();
      });
    }

    var stickyAll = $('cp-board-sticky-all');
    if (stickyAll) {
      stickyAll.addEventListener('click', function () {
        var cards = collectStickyCards();
        if (!cards.length) {
          openCompose('sticky');
          return;
        }
        state.stickyShowAll = !state.stickyShowAll;
        renderStickySection();
      });
    }

    var challengeAll = $('cp-board-challenge-all');
    if (challengeAll) {
      challengeAll.addEventListener('click', function () {
        var challenges = collectChallenges();
        if (!challenges.length) {
          openCompose('challenge');
          return;
        }
        state.challengeShowAll = !state.challengeShowAll;
        if (!state.challengeShowAll) state.openedChallengeId = '';
        renderChallengeSection();
      });
    }

    var capsuleAll = $('cp-board-capsule-all');
    if (capsuleAll) {
      capsuleAll.addEventListener('click', function () {
        openCompose('capsule');
      });
    }

    var discoverTab = $('cp-board-tab-discover');
    if (discoverTab) {
      discoverTab.addEventListener('click', function () {
        var challenges = collectChallenges();
        if (challenges.length) {
          state.challengeShowAll = true;
          state.openedChallengeId = challenges[0].id;
          renderChallengeSection();
        }
        scrollToSection('cp-board-challenge-sec');
        document.querySelectorAll('.cp-bd-tab').forEach(function (t) {
          t.classList.remove('is-active');
        });
        discoverTab.classList.add('is-active');
        var homeTab = $('cp-board-tab-home');
        if (homeTab) homeTab.classList.remove('is-active');
      });
    }

    var homeTab = $('cp-board-tab-home');
    if (homeTab) {
      homeTab.addEventListener('click', function () {
        var scroll = document.querySelector('.cp-bd-scroll');
        if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
        document.querySelectorAll('.cp-bd-tab').forEach(function (t) {
          t.classList.remove('is-active');
        });
        homeTab.classList.add('is-active');
      });
    }

    var composeSubmit = $('cp-board-compose-submit');
    if (composeSubmit) composeSubmit.addEventListener('click', handleComposeSubmit);

    var composeClose = $('cp-board-compose-close');
    if (composeClose) composeClose.addEventListener('click', closeCompose);

    var composeOverlay = $('cp-board-compose');
    if (composeOverlay) {
      composeOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-cp-board-compose-close]') || e.target.classList.contains('cp-board-compose__backdrop')) {
          closeCompose();
        }
      });
    }

    var colors = $('cp-board-compose-colors');
    if (colors) {
      colors.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-cp-board-color]');
        if (!btn) return;
        colors.querySelectorAll('[data-cp-board-color]').forEach(function (b) {
          b.classList.toggle('is-on', b === btn);
        });
      });
    }

    var answerSubmit = $('cp-board-answer-submit');
    if (answerSubmit) answerSubmit.addEventListener('click', handlePromptAnswerSubmit);

    var answerOverlay = $('cp-board-answer');
    if (answerOverlay) {
      answerOverlay.addEventListener('click', function (e) {
        if (e.target.closest('[data-cp-board-answer-close]') || e.target.classList.contains('cp-board-compose__backdrop')) {
          closePromptAnswer();
        }
      });
    }

    var scroll = document.querySelector('.cp-bd-scroll');
    if (scroll) {
      scroll.addEventListener('click', handleBoardClick);
    }
  }

  function handleBoardClick(e) {
    var fabBtn = e.target.closest('[data-cp-board-fab]');
    if (fabBtn && !fabBtn.closest('#cp-board-type-sheet')) {
      openCompose(fabBtn.getAttribute('data-cp-board-fab') || 'sticky');
      return;
    }

    var foldBtn = e.target.closest('[data-cp-board-fold]');
    if (foldBtn) {
      var fid = foldBtn.getAttribute('data-cp-board-fold');
      state.openedFoldId = state.openedFoldId === fid ? '' : fid;
      var st = store();
      if (st && state.openedFoldId) {
        st.updateBoardEntry(state.contactId, fid, { opened: true });
      }
      if (!state.foldExpanded) {
        state.foldExpanded = true;
      }
      renderFoldSection();
      return;
    }

    var answerBtn = e.target.closest('[data-cp-board-answer]');
    if (answerBtn) {
      openPromptAnswer(answerBtn.getAttribute('data-cp-board-answer'), 'first');
      return;
    }

    var challengeAnswerBtn = e.target.closest('[data-cp-board-challenge-answer]');
    if (challengeAnswerBtn) {
      openChallengeAnswer(challengeAnswerBtn.getAttribute('data-cp-board-challenge-answer'));
      return;
    }

    var challengeToggleBtn = e.target.closest('[data-cp-board-challenge-toggle]');
    if (challengeToggleBtn) {
      var cid = challengeToggleBtn.getAttribute('data-cp-board-challenge-toggle');
      state.challengeShowAll = true;
      state.openedChallengeId = state.openedChallengeId === cid ? '' : cid;
      renderChallengeSection();
      return;
    }

    var challengeBtn = e.target.closest('[data-cp-board-challenge]');
    if (challengeBtn) {
      openChallengeAnswer(challengeBtn.getAttribute('data-cp-board-challenge'));
      return;
    }

    var continueBtn = e.target.closest('[data-cp-board-prompt-continue]');
    if (continueBtn) {
      handlePromptContinue(
        continueBtn.getAttribute('data-cp-board-prompt-continue'),
        continueBtn.getAttribute('data-cp-board-prompt-turn')
      );
      return;
    }

    var note = e.target.closest('[data-cp-board-id]');
    if (note) {
      var nid = note.getAttribute('data-cp-board-id');
      var entry = store().findBoardEntry(state.contactId, nid);
      if (entry && entry.type === 'capsule' && isCapsuleLocked(entry)) {
        toast('还没到拆开的日子');
        return;
      }
      if (entry && entry.author === 'char' && !entry.readAt) {
        store().markBoardRead(state.contactId, nid);
        dispatchUpdated();
      }
    }
  }

  bindEvents();

  global.miyaCoupleBoard = {
    open: open,
    close: close,
    renderAll: renderAll
  };
})(typeof window !== 'undefined' ? window : global);
