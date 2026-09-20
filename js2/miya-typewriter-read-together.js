/**
 * miya-typewriter-read-together.js — 打字机「共读」：选角、选书、共读对话
 */
(function (global) {
  'use strict';

  var CHARS_PER_PAGE = 520;
  var textUtil = global.miyaTypewriterText;
  if (textUtil) CHARS_PER_PAGE = textUtil.CHARS_PER_PAGE;
  var rtStore = global.miyaTypewriterReadTogetherStore;
  var bookStore = global.miyaTypewriterStore;
  if (!rtStore || !bookStore) return;

  var room = null;
  var apiPending = 0;
  var uiBound = false;
  var lobbyState = { contactId: '', profileId: '', bookId: '' };

  function $(id) { return document.getElementById(id); }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function chatStore() { return global.miyaChatStore || null; }
  function chatEngine() { return global.miyaChatEngine || null; }
  function onlineFmt() { return global.MiyaChatOnlineFormat || null; }

  function toast(msg) {
    var el = $('tw-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(el._rtT);
    el._rtT = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function confirmDialog(opts) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm(opts);
    }
    return Promise.resolve(window.confirm(String((opts.title || '') + '\n' + (opts.message || ''))));
  }

  function splitPages(content) {
    var text = String(content || '').trim();
    if (!text) return ['（空白篇章）'];
    var paras = text.split(/\n{2,}/);
    var pages = [];
    var buf = '';
    paras.forEach(function (p) {
      var chunk = p.trim();
      if (!chunk) return;
      if ((buf + '\n\n' + chunk).length > CHARS_PER_PAGE && buf) {
        pages.push(buf.trim());
        buf = chunk;
      } else {
        buf = buf ? buf + '\n\n' + chunk : chunk;
      }
    });
    if (buf) pages.push(buf.trim());
    if (!pages.length) pages.push(text.slice(0, CHARS_PER_PAGE));
    return pages;
  }

  function formatPageText(text, isFirst) {
    var t = esc(text).replace(/\n/g, '<br>');
    if (isFirst && text.length > 0) {
      var first = text.charAt(0);
      var rest = esc(text.slice(1)).replace(/\n/g, '<br>');
      return '<span class="tw-reader__dropcap">' + esc(first) + '</span>' + rest;
    }
    return t;
  }

  function buildBookPages(book) {
    if (!book) return [];
    if (textUtil) {
      var chapters = book.chapters && book.chapters.length ? book.chapters : null;
      return textUtil.buildPages(chapters || book.content);
    }
    return splitPages(book.content).map(function (text, i) {
      return { text: text, chapterTitle: '', chapterIndex: 0, isChapterStart: i === 0 };
    });
  }

  function buildPageInnerHtml(pageData, pageNo) {
    var text = typeof pageData === 'string' ? pageData : (pageData && pageData.text) || '';
    var isFirst = pageNo === 1;
    var isChapterStart = pageData && pageData.isChapterStart && pageData.chapterTitle;
    var chapterHtml = isChapterStart
      ? '<h3 class="tw-reader__chapter">' + esc(pageData.chapterTitle) + '</h3>'
      : '';
    return '<span class="tw-reader__page-corner tw-reader__page-corner--tl"></span>' +
      '<span class="tw-reader__page-corner tw-reader__page-corner--br"></span>' +
      chapterHtml +
      '<p class="tw-reader__text">' + formatPageText(text, isFirst) + '</p>' +
      (text.length > 200 ? '<div class="tw-reader__ornament">· · ❧ · ·</div>' : '') +
      '<span class="tw-reader__page-no">' + pageNo + '</span>';
  }

  function contactDisplayName(c) {
    return trim(c.remarkName || c.name || '未命名');
  }

  function contactInitial(c) {
    return contactDisplayName(c).slice(0, 1) || '?';
  }

  function profileInitial(profile) {
    return (profile && profile.name ? trim(profile.name) : '我').slice(0, 1) || '我';
  }

  function resolveChatForContact(contactId, profileId) {
    var st = chatStore();
    if (!st || !contactId) return null;
    var contact = st.findContact(contactId);
    if (!contact) return null;
    var pid = trim(profileId) || trim(contact.defaultProfileId) ||
      (st.getActiveProfile() && st.getActiveProfile().id) || '';
    var chat = st.findChatByContact(contactId, pid);
    if (!chat && st.createChat) {
      chat = st.createChat({ contactId: contactId, profileId: pid, type: 'private' });
    }
    return { contact: contact, profileId: pid, chat: chat };
  }

  function getSessionContext(session) {
    var st = chatStore();
    if (!session || !st) return null;
    var contact = st.findContact(session.contactId);
    if (!contact) return null;
    var profile = st.getProfiles().find(function (p) { return p.id === session.profileId; }) ||
      st.getActiveProfile();
    var chat = session.chatId ? st.findChat(session.chatId) : null;
    var settings = session.chatId && st.getChatSettings ? st.getChatSettings(session.chatId) : null;
    var book = bookStore.getBook(session.bookId);
    return { contact: contact, profile: profile, chat: chat, settings: settings, book: book, session: session };
  }

  function getApiConfig() {
    var eng = chatEngine();
    if (eng && typeof eng.getApiConfig === 'function') return eng.getApiConfig();
    if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
    return {};
  }

  function normalizeBaseUrl(base) {
    var t = trim(base).replace(/\/+$/, '');
    if (!t) return '';
    try {
      var u = new URL(t);
      var path = (u.pathname || '/').replace(/\/+$/, '');
      var segs = path.split('/').filter(Boolean);
      if (segs.length && segs[segs.length - 1].toLowerCase() === 'v1') return u.origin + path;
      if (!path || path === '/') return u.origin + '/v1';
      return u.origin + path + '/v1';
    } catch (e) {
      return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
    }
  }

  function resolveApiSlice(cfg, useSecondary) {
    if (useSecondary) {
      var sec = cfg.secondaryApi && typeof cfg.secondaryApi === 'object' ? cfg.secondaryApi : {};
      return {
        baseUrl: normalizeBaseUrl(sec.baseUrl),
        apiKey: trim(sec.apiKey),
        model: trim(sec.model),
        temperature: sec.temperature != null ? Number(sec.temperature) : (cfg.temperature != null ? Number(cfg.temperature) : 1)
      };
    }
    return {
      baseUrl: normalizeBaseUrl(cfg.baseUrl),
      apiKey: trim(cfg.apiKey),
      model: trim(cfg.model),
      temperature: cfg.temperature != null ? Number(cfg.temperature) : 1
    };
  }

  function hasSecondaryApi(cfg) {
    var sec = cfg.secondaryApi && typeof cfg.secondaryApi === 'object' ? cfg.secondaryApi : {};
    return !!(normalizeBaseUrl(sec.baseUrl) && trim(sec.apiKey) && trim(sec.model));
  }

  function fetchCompletion(url, headers, payload, attempt) {
    var tryNo = Math.max(1, Number(attempt) || 1);
    var eng = chatEngine();
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(payload) })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
          });
        }
        return r.json();
      })
      .then(function (data) {
        var replyRaw = eng && typeof eng.extractReplyContent === 'function'
          ? eng.extractReplyContent(data)
          : '';
        if (!replyRaw && tryNo < 3) return fetchCompletion(url, headers, payload, tryNo + 1);
        return { data: data, replyRaw: replyRaw };
      });
  }

  function buildBookContextBlock(ctx) {
    if (!ctx || !ctx.book) return '';
    var book = ctx.book;
    var session = ctx.session;
    var pages = buildBookPages(book);
    var total = pages.length;
    var page = Math.min(Math.max(0, session.page || 0), total - 1);
    var pageData = pages[page] || { text: '' };
    var pageText = pageData.text || '';
    var lines = ['【共读·当前阅读】'];
    lines.push('- 书名：《' + (book.title || '未命名') + '》');
    if (pageData.chapterTitle) lines.push('- 章节：' + pageData.chapterTitle);
    lines.push('- 页码：第 ' + (page + 1) + ' 页 / 共 ' + total + ' 页');
    lines.push('- 当前页正文：');
    lines.push(pageText.slice(0, 1200) + (pageText.length > 1200 ? '…' : ''));
    if (page > 0) {
      var prev = (pages[page - 1] || {}).text || '';
      if (prev) lines.push('- 上一页末尾：「' + prev.slice(-200) + '」');
    }
    return lines.join('\n');
  }

  function buildReadTogetherRules(roleName, userName) {
    var rn = roleName || '角色';
    var un = userName || '用户';
    return [
      '【共读·场景规则·' + rn + '】',
      '你正与「' + un + '」进行「共读」——双方同步阅读同一本书，并肩而坐讨论书中的内容。',
      '你可以感知当前书名、阅读页码与当前页正文（见「共读·当前阅读」）。',
      '对话须符合共读格式：用户发一句，你回 2–5 条气泡（每行一条）；可穿插对书中段落、人物、意境的感受与讨论。',
      '正文仅允许普通文字与「表情包-名称」；禁止引用-/语音-/图片-/位置-/转账-/旁白-等线上聊天专属格式。',
      '禁止脱离共读场景；不要假装看不到正在阅读的内容；不要输出与书籍无关的长篇说教。',
      '若用户翻页或阅读进度变化，请自然接话，可点评新页内容或延续讨论。',
      '保持 ' + rn + ' 的人设与对「' + un + '」的关系；语气亲密自然，像真的在一起读书。',
      '系统提示中已注入命中的世界书（绑定该角色的局部词条无关键词时始终纳入；有关键词须上下文命中）；须在回复中落实。',
      '每轮仅输出正文气泡（每行一条）；禁止输出 <thinking>、<miyavoice>、思维链或心声。'
    ].join('\n');
  }

  function formatSessionMsgForApi(m) {
    if (!m) return '';
    if (m.role === 'user' || m.role === 'assistant') {
      if (m.type === 'sticker') return trim(m.content) || ('表情包-' + trim(m.stickerName));
      return trim(m.content);
    }
    return '';
  }

  function buildApiMessages(userText, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var ctx = getSessionContext(room);
    if (!ctx) return { error: 'session_invalid', messages: [] };
    var eng = chatEngine();
    if (!eng) return { error: 'engine_missing', messages: [] };

    var contact = ctx.contact;
    var profile = ctx.profile;
    var settings = ctx.settings;
    var slice = (room.messages || []).slice(-40);
    var contextText = slice.map(formatSessionMsgForApi).filter(Boolean).join('\n') + '\n' + trim(userText);

    var wbBundle = typeof eng.buildWorldbookBundle === 'function'
      ? eng.buildWorldbookBundle(contact, contextText, null, { promptContext: 'general' })
      : { frontLayers: [], layers: [], backLayers: [] };

    var systemContent = typeof eng.buildReadTogetherSystemPrompt === 'function'
      ? eng.buildReadTogetherSystemPrompt({
          contact: contact,
          profile: profile,
          contextText: contextText,
          chatSettings: settings,
          worldbookFrontLayers: wbBundle.frontLayers,
          worldbookLayers: wbBundle.layers,
          worldbookBackLayers: wbBundle.backLayers
        })
      : '';

    var userName = profile && profile.name ? trim(profile.name) : '用户';
    systemContent = systemContent + '\n\n' + buildReadTogetherRules(contact.name || '角色', userName);
    systemContent = systemContent + '\n\n' + buildBookContextBlock(ctx);

    var apiMessages = [{ role: 'system', content: systemContent }];

    if (opts.systemLead) {
      apiMessages.push({ role: 'system', content: trim(opts.systemLead) });
    }

    slice.forEach(function (m) {
      if (!m || m.role === 'system') return;
      var c = formatSessionMsgForApi(m);
      if (!c) return;
      apiMessages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: c });
    });

    var pending = trim(userText);
    if (pending) {
      var last = apiMessages[apiMessages.length - 1];
      if (last && last.role === 'user') last.content = last.content ? last.content + ' / ' + pending : pending;
      else apiMessages.push({ role: 'user', content: pending });
    }

    var fmt = onlineFmt();
    if (fmt && typeof fmt.buildReadTogetherPerTurnReminder === 'function') {
      apiMessages.push({
        role: 'system',
        content: fmt.buildReadTogetherPerTurnReminder({
          roleName: contact.name || '角色',
          bubbleMin: 2,
          bubbleMax: 5
        })
      });
    }

    return { messages: apiMessages, contact: contact, profile: profile, chat: ctx.chat };
  }

  function parseRoleReply(raw, contact) {
    var eng = chatEngine();
    var body = raw;
    if (eng && typeof eng.parseThinking === 'function') {
      body = eng.parseThinking(body).content || body;
    }
    if (eng && typeof eng.stripHeartVoiceTags === 'function') body = eng.stripHeartVoiceTags(body);
    var bubbles;
    if (eng && typeof eng.splitBubbles === 'function') {
      bubbles = eng.splitBubbles(body);
    } else {
      bubbles = trim(body).split(/\n/).map(trim).filter(Boolean);
    }

    var fmt = onlineFmt();
    if (fmt && typeof fmt.parseReadTogetherOutputLinesMeta === 'function') {
      var st = chatStore();
      var catalog = fmt.collectStickerCatalogAll && st
        ? fmt.collectStickerCatalogAll(st)
        : (fmt.collectStickerCatalog && st ? fmt.collectStickerCatalog(st, contact && contact.id) : []);
      var meta = fmt.parseReadTogetherOutputLinesMeta(bubbles, catalog);
      return (meta.bubbles || []).map(function (b) {
        var out = { type: b.type || 'text', content: b.content || '' };
        if (b.type === 'sticker') {
          out.stickerName = b.stickerName || '';
          out.stickerBlobId = b.stickerBlobId || '';
          out.stickerUrl = b.stickerUrl || '';
        }
        return out;
      }).filter(function (b) { return trim(b.content) || b.type === 'sticker'; });
    }
    return bubbles.map(function (l) { return { type: 'text', content: l }; });
  }

  function setApiPending(n) {
    apiPending = Math.max(0, n);
    renderTypingIndicator();
  }

  function runCompletion(userText, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (apiPending > 0) return Promise.reject(new Error('busy'));
    var cfg = getApiConfig();
    var eng = chatEngine();
    var ready = eng && typeof eng.ensureWorldbookDepsReady === 'function'
      ? eng.ensureWorldbookDepsReady()
      : Promise.resolve();
    return ready.then(function () {
      var built = buildApiMessages(userText, opts);
      if (built.error) return Promise.reject(new Error(built.error));

      setApiPending(1);
      function callWithSlice(slice, usedSecondary) {
        if (!slice.baseUrl || !slice.apiKey || !slice.model) {
          return Promise.reject(new Error(usedSecondary ? 'secondary_api_not_configured' : 'api_not_configured'));
        }
        var url = slice.baseUrl + '/chat/completions';
        var headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + slice.apiKey };
        var payload = { model: slice.model, messages: built.messages, temperature: slice.temperature };
        return fetchCompletion(url, headers, payload, 1);
      }

      return callWithSlice(resolveApiSlice(cfg, false), false)
        .catch(function (err) {
          if (!cfg.fallbackToSecondary || !hasSecondaryApi(cfg)) throw err;
          return callWithSlice(resolveApiSlice(cfg, true), true);
        })
        .then(function (completion) {
          var replyRaw = completion.replyRaw;
          if (!trim(replyRaw)) throw new Error('empty_reply');
          var parsed = parseRoleReply(replyRaw, built.contact);
          if (!parsed.length) throw new Error('empty_reply');
          parsed.forEach(function (b) {
            if (!b || (!trim(b.content) && b.type !== 'sticker')) return;
            rtStore.addMessage(room.id, 'assistant', b);
          });
          room = rtStore.getSession(room.id);
          return parsed;
        })
        .finally(function () { setApiPending(0); });
    });
  }

  function fmtChatErr(err) {
    var m = err && err.message ? err.message : '';
    if (m === 'api_not_configured' || m === 'secondary_api_not_configured') {
      return '已进入共读，配置 API 后角色才能回复';
    }
    if (m === 'empty_reply') return '角色暂时没有回复，你可以先发消息';
    if (m === 'engine_missing') return '聊天模块未加载';
    if (m && m.indexOf('HTTP ') === 0) return '角色回复失败，请检查 API 设置';
    return '';
  }

  function fmtStartErr(err) {
    var m = err && err.message ? err.message : '';
    if (m === 'contact_not_found') return '找不到角色，请先在通讯录添加';
    if (m === 'book_not_found') return '找不到典籍，请重新选择';
    if (m) return '开始失败：' + m.slice(0, 80);
    return '开始失败，请重试';
  }

  /* ── Room state ── */

  function isInRoom() {
    return !!(room && document.getElementById('tw-rt-room') && document.getElementById('tw-rt-room').classList.contains('is-open'));
  }

  function saveRoomPage(page) {
    if (!room) return;
    room.page = Math.max(0, parseInt(page, 10) || 0);
    rtStore.updateSession(room.id, { page: room.page });
    room = rtStore.getSession(room.id);
  }

  function saveRoomScroll() {
    if (!room) return;
    var spread = $('tw-rt-book-spread');
    if (!spread) return;
    var scroll = Math.max(0, spread.scrollTop || 0);
    rtStore.updateSession(room.id, { bookScroll: scroll });
    room = rtStore.getSession(room.id);
    if (room.bookId && room.contactId) {
      bookStore.setRtProgress(room.bookId, room.contactId, room.page || 0, scroll);
    }
  }

  function saveRoomView() {
    if (!room) return;
    var spread = $('tw-rt-book-spread');
    var page = Math.max(0, parseInt(room.page, 10) || 0);
    var scroll = spread ? Math.max(0, spread.scrollTop || 0) : Math.max(0, room.bookScroll || 0);
    rtStore.updateSession(room.id, { page: page, bookScroll: scroll });
    room = rtStore.getSession(room.id);
    if (room.bookId && room.contactId) {
      bookStore.setRtProgress(room.bookId, room.contactId, page, scroll);
    }
  }

  function restoreBookScroll() {
    if (!room) return;
    var spread = $('tw-rt-book-spread');
    if (!spread) return;
    var scroll = Math.max(0, room.bookScroll || 0);
    if (!scroll) return;
    function apply() { spread.scrollTop = scroll; }
    requestAnimationFrame(function () {
      apply();
      requestAnimationFrame(function () {
        apply();
        setTimeout(apply, 0);
      });
    });
  }

  function bindBookSpreadScroll() {
    var spread = $('tw-rt-book-spread');
    if (!spread || spread._rtScrollBound) return;
    spread._rtScrollBound = true;
    spread.addEventListener('scroll', function () {
      if (!room) return;
      clearTimeout(spread._rtScrollT);
      spread._rtScrollT = setTimeout(saveRoomScroll, 160);
    }, { passive: true });
  }

  function renderBookArea() {
    var spread = $('tw-rt-book-spread');
    var folio = $('tw-rt-folio');
    var titleEl = $('tw-rt-book-title');
    if (!room || !spread) return;
    var ctx = getSessionContext(room);
    if (!ctx || !ctx.book) return;
    var book = ctx.book;
    var pages = buildBookPages(book);
    var total = pages.length;
    var page = Math.min(Math.max(0, room.page || 0), total - 1);
    if (page !== room.page) {
      room.page = page;
      rtStore.updateSession(room.id, { page: page });
      room = rtStore.getSession(room.id);
    }
    if (titleEl) titleEl.textContent = book.title;
    if (folio) {
      var cur = pages[page] || {};
      var chapterHint = cur.chapterTitle ? (' · ' + cur.chapterTitle) : '';
      folio.textContent = String(page + 1) + ' / ' + total + chapterHint;
    }
    var pageData = pages[page] || { text: '' };
    spread.innerHTML =
      '<div class="tw-reader__page">' +
      '<div class="tw-reader__page-body">' +
      buildPageInnerHtml(pageData, page + 1) +
      '</div></div>';
    if (global.miyaTypewriterSettings && global.miyaTypewriterSettings.applyReaderFont) {
      global.miyaTypewriterSettings.applyReaderFont(spread);
    }
    requestAnimationFrame(function () { restoreBookScroll(); });
  }

  function goToPage(delta) {
    if (!room) return;
    var ctx = getSessionContext(room);
    if (!ctx || !ctx.book) return;
    var pages = buildBookPages(ctx.book);
    var next = Math.min(Math.max(0, (room.page || 0) + delta), pages.length - 1);
    if (next === room.page) return;
    room.page = next;
    rtStore.updateSession(room.id, { page: next, bookScroll: 0 });
    room = rtStore.getSession(room.id);
    if (room.bookId && room.contactId) {
      bookStore.setRtProgress(room.bookId, room.contactId, next, 0);
    }
    renderBookArea();
  }

  function getReadingContext() {
    if (!room) return null;
    var ctx = getSessionContext(room);
    if (!ctx || !ctx.book) return null;
    var pages = buildBookPages(ctx.book);
    var total = pages.length;
    var page = Math.min(Math.max(0, room.page || 0), total - 1);
    return {
      mode: 'together',
      book: ctx.book,
      pages: pages,
      page: page,
      total: total
    };
  }

  function goToChapterPage(chapterIndex) {
    if (!room) return false;
    var readingCtx = getReadingContext();
    if (!readingCtx) return false;
    var ci = parseInt(chapterIndex, 10);
    if (isNaN(ci)) return false;
    for (var i = 0; i < readingCtx.pages.length; i++) {
      var page = readingCtx.pages[i];
      if (page.chapterIndex === ci && page.isChapterStart) {
        room.page = i;
        rtStore.updateSession(room.id, { page: i, bookScroll: 0 });
        room = rtStore.getSession(room.id);
        if (room.bookId && room.contactId) {
          bookStore.setRtProgress(room.bookId, room.contactId, i, 0);
        }
        renderBookArea();
        return true;
      }
    }
    return false;
  }

  function scrollChatToBottom() {
    var sc = $('tw-rt-chat-scroll');
    if (sc) sc.scrollTop = sc.scrollHeight;
  }

  function msgBodyHtml(msg) {
    if (!msg) return '';
    if (msg.type === 'sticker') {
      var name = trim(msg.stickerName) || '表情';
      var url = trim(msg.stickerUrl);
      var blobId = trim(msg.stickerBlobId);
      if (url) {
        return '<img class="tw-rt-msg__sticker" src="' + esc(url) + '" alt="' + esc(name) + '">';
      }
      if (blobId) {
        return '<img class="tw-rt-msg__sticker" data-rt-sticker="' + esc(blobId) + '" alt="' + esc(name) + '">';
      }
      return '<span class="tw-rt-msg__sticker-fallback">[' + esc(name) + ']</span>';
    }
    return '<p>' + esc(msg.content) + '</p>';
  }

  function applyStickerUrls(root) {
    if (!root) return;
    var st = chatStore();
    var ids = [];
    root.querySelectorAll('[data-rt-sticker]').forEach(function (el) {
      var key = el.getAttribute('data-rt-sticker');
      if (key) ids.push(key);
    });
    if (!ids.length) return;
    function setUrls(map) {
      root.querySelectorAll('[data-rt-sticker]').forEach(function (el) {
        var key = el.getAttribute('data-rt-sticker');
        var url = map && map[key];
        if (url) {
          el.src = url;
          el.removeAttribute('data-rt-sticker');
        }
      });
    }
    if (st && st.prefetchBlobUrls) {
      st.prefetchBlobUrls(ids).then(setUrls);
    } else if (st && st.getEmojiItemUrl) {
      var map = {};
      ids.forEach(function (key) {
        var url = st.getEmojiItemUrl(key);
        if (url) map[key] = url;
      });
      setUrls(map);
    }
  }

  function bubbleHtml(msg, ctx) {
    if (!msg || (!trim(msg.content) && msg.type !== 'sticker')) return '';
    var isUser = msg.role === 'user';
    var who = isUser
      ? (ctx.profile && ctx.profile.name) || '我'
      : contactDisplayName(ctx.contact);
    return (
      '<div class="tw-rt-msg' + (isUser ? ' is-me' : ' is-other') + '">' +
      '<span class="tw-rt-msg__who">' + esc(who) + '</span>' +
      '<div class="tw-rt-msg__bubble">' + msgBodyHtml(msg) + '</div></div>'
    );
  }

  function renderChatMessages() {
    var el = $('tw-rt-chat-messages');
    if (!el || !room) return;
    var ctx = getSessionContext(room);
    if (!ctx) return;
    var msgs = room.messages || [];
    el.innerHTML = msgs.map(function (m) { return bubbleHtml(m, ctx); }).join('');
    applyStickerUrls(el);
    scrollChatToBottom();
  }

  function renderTypingIndicator() {
    var el = $('tw-rt-typing');
    if (!el) return;
    if (apiPending > 0) {
      el.hidden = false;
      el.innerHTML =
        '<div class="tw-rt-msg is-other">' +
        '<div class="tw-rt-msg__bubble tw-rt-msg__bubble--typing">' +
        '<span class="tw-rt-dot"></span><span class="tw-rt-dot"></span><span class="tw-rt-dot"></span>' +
        '</div></div>';
      scrollChatToBottom();
    } else {
      el.hidden = true;
      el.innerHTML = '';
    }
  }

  function renderRoomHeader() {
    var ctx = getSessionContext(room);
    if (!ctx) return;
    var duo = $('tw-rt-duo');
    if (duo) {
      duo.innerHTML =
        '<span class="tw-rt-duo__user">' + esc(profileInitial(ctx.profile)) + '</span>' +
        '<span class="tw-rt-duo__bond">共读</span>' +
        '<span class="tw-rt-duo__role">' + esc(contactInitial(ctx.contact)) + '</span>';
    }
  }

  function openRoom(sessionId) {
    var session = rtStore.getSession(sessionId);
    if (!session) return Promise.reject(new Error('session_not_found'));
    room = rtStore.getSession(sessionId);
    var roomEl = $('tw-rt-room');
    var app = $('miya-typewriter-app');
    if (!roomEl) return Promise.reject(new Error('ui_missing'));
    if (app) app.classList.add('is-reading-together');
    roomEl.classList.remove('is-chat-collapsed');
    var chatToggle = $('tw-rt-chat-toggle');
    if (chatToggle) {
      chatToggle.setAttribute('aria-expanded', 'true');
      chatToggle.setAttribute('aria-label', '收起对话区');
    }
    roomEl.removeAttribute('hidden');
    roomEl.setAttribute('aria-hidden', 'false');
    roomEl.classList.add('is-open');
    renderRoomHeader();
    renderBookArea();
    renderChatMessages();
    renderTypingIndicator();
    return Promise.resolve(session);
  }

  function closeRoom() {
    if (room) saveRoomView();
    var roomEl = $('tw-rt-room');
    var app = $('miya-typewriter-app');
    if (app) app.classList.remove('is-reading-together');
    if (roomEl) {
      roomEl.classList.remove('is-open');
      roomEl.setAttribute('aria-hidden', 'true');
      clearTimeout(roomEl._closeTimer);
      roomEl._closeTimer = setTimeout(function () {
        if (!roomEl.classList.contains('is-open')) roomEl.setAttribute('hidden', '');
      }, 200);
    }
    room = null;
    renderSalon();
  }

  function startSession(contactId, bookId, profileId) {
    var resolved = resolveChatForContact(contactId, profileId);
    if (!resolved || !resolved.chat) return Promise.reject(new Error('contact_not_found'));
    var book = bookStore.getBook(bookId);
    if (!book) return Promise.reject(new Error('book_not_found'));

    var existing = rtStore.findPausedSession(contactId, bookId, resolved.profileId);
    if (existing) {
      return resumeSession(existing.id);
    }

    var savedRt = bookStore.getRtProgress(bookId, contactId);
    var startPage = savedRt ? savedRt.page : 0;
    var startScroll = savedRt ? savedRt.bookScroll : 0;

    var session = rtStore.createSession({
      contactId: contactId,
      profileId: resolved.profileId,
      chatId: resolved.chat.id,
      bookId: bookId,
      page: startPage,
      bookScroll: startScroll
    });
    if (!session) return Promise.reject(new Error('create_failed'));

    return openRoom(session.id).then(function () {
      toast('已进入共读 · 《' + book.title + '》' + (startPage > 0 ? ' · 续读第 ' + (startPage + 1) + ' 页' : ''));
      return runCompletion('', {
        systemLead: '【共读已开始】用户刚邀请你一起读《' + book.title + '》。请主动打招呼，简短点评当前页或共读氛围，2–4 条气泡即可。'
      }).catch(function (err) {
        var hint = fmtChatErr(err);
        if (hint) toast(hint);
      }).finally(function () {
        room = rtStore.getSession(session.id);
        renderChatMessages();
      });
    });
  }

  function resumeSession(sessionId) {
    return rtStore.whenReady().then(function () {
      var session = rtStore.getSession(sessionId);
      if (!session || session.status === 'completed') return Promise.reject(new Error('session_invalid'));
      return openRoom(sessionId).then(function () {
        room = rtStore.getSession(sessionId);
        renderBookArea();
        var book = bookStore.getBook(session.bookId);
        toast('继续共读 · 《' + (book && book.title || '未知典籍') + '》· 第 ' + ((room && room.page || 0) + 1) + ' 页');
      });
    });
  }

  function parseUserInput(text) {
    var fmt = onlineFmt();
    var st = chatStore();
    var catalog = fmt && st && fmt.collectStickerCatalogAll
      ? fmt.collectStickerCatalogAll(st)
      : [];
    if (fmt && typeof fmt.parseReadTogetherUserInput === 'function') {
      return fmt.parseReadTogetherUserInput(text, catalog);
    }
    var t = trim(text);
    return t ? { type: 'text', content: t } : null;
  }

  function sendUserMessage(text) {
    var parsed = parseUserInput(text);
    if (!parsed || !room) return Promise.reject(new Error('empty_message'));
    rtStore.addMessage(room.id, 'user', parsed);
    room = rtStore.getSession(room.id);
    renderChatMessages();
    var apiText = parsed.type === 'sticker' ? trim(parsed.content) : trim(parsed.content);
    return runCompletion(apiText, {}).then(function () {
      room = rtStore.getSession(room.id);
      renderChatMessages();
    });
  }

  function promptPauseOrEnd() {
    if (!room) return;
    showPauseDialog();
  }

  var pauseDialogEl = null;

  function ensurePauseDialog() {
    if (pauseDialogEl && document.body.contains(pauseDialogEl)) return pauseDialogEl;
    pauseDialogEl = document.createElement('div');
    pauseDialogEl.className = 'tw-rt-dialog';
    pauseDialogEl.hidden = true;
    pauseDialogEl.innerHTML =
      '<div class="tw-rt-dialog__veil" data-tw-rt-dialog-close></div>' +
      '<div class="tw-rt-dialog__panel" role="dialog" aria-modal="true">' +
      '<h3 class="tw-rt-dialog__title">暂停共读</h3>' +
      '<p class="tw-rt-dialog__msg">你想如何处理本次共读？</p>' +
      '<div class="tw-rt-dialog__actions">' +
      '<button type="button" class="tw-rt-dialog__btn" data-tw-rt-dialog-close>继续阅读</button>' +
      '<button type="button" class="tw-rt-dialog__btn tw-rt-dialog__btn--pause" data-tw-rt-pause>暂停进度</button>' +
      '<button type="button" class="tw-rt-dialog__btn tw-rt-dialog__btn--end" data-tw-rt-end>结束共读</button>' +
      '</div></div>';
    var app = $('miya-typewriter-app');
    if (app) app.appendChild(pauseDialogEl);
    else document.body.appendChild(pauseDialogEl);

    pauseDialogEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-tw-rt-dialog-close]')) hidePauseDialog();
      if (e.target.closest('[data-tw-rt-pause]')) handlePauseSession();
      if (e.target.closest('[data-tw-rt-end]')) handleEndSession();
    });
    return pauseDialogEl;
  }

  function showPauseDialog() {
    ensurePauseDialog();
    pauseDialogEl.hidden = false;
    pauseDialogEl.classList.add('is-show');
  }

  function hidePauseDialog() {
    if (!pauseDialogEl) return;
    pauseDialogEl.classList.remove('is-show');
    pauseDialogEl.hidden = true;
  }

  function handlePauseSession() {
    if (!room) return;
    var sid = room.id;
    saveRoomView();
    rtStore.pauseSession(sid);
    room = rtStore.getSession(sid);
    hidePauseDialog();
    toast('已暂停共读 · 进度与对话已保存');
    closeRoom();
  }

  function handleEndSession() {
    if (!room) return;
    hidePauseDialog();
    confirmDialog({
      title: '结束共读',
      message: '确定结束本次共读吗？阅读进度与全部对话将保留在「已共读」记录中。',
      confirmText: '结束',
      cancelText: '取消'
    }).then(function (ok) {
      if (!ok) return;
      var sid = room.id;
      saveRoomView();
      rtStore.completeSession(sid);
      toast('共读已结束 · 记录已保存');
      closeRoom();
    });
  }

  var archiveEl = null;

  function ensureArchive() {
    if (archiveEl && document.body.contains(archiveEl)) return archiveEl;
    archiveEl = document.createElement('div');
    archiveEl.className = 'tw-rt-archive';
    archiveEl.hidden = true;
    archiveEl.innerHTML =
      '<div class="tw-rt-archive__veil" data-tw-rt-archive-close></div>' +
      '<div class="tw-rt-archive__panel" role="dialog" aria-modal="true">' +
      '<header class="tw-rt-archive__head">' +
      '<h2 id="tw-rt-archive-title">共读记录</h2>' +
      '<button type="button" class="tw-rt-archive__close" data-tw-rt-archive-close aria-label="关闭">×</button>' +
      '</header>' +
      '<div class="tw-rt-archive__body" id="tw-rt-archive-body"></div>' +
      '</div>';
    var app = $('miya-typewriter-app');
    if (app) app.appendChild(archiveEl);
    else document.body.appendChild(archiveEl);
    archiveEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-tw-rt-archive-close]')) closeArchive();
    });
    return archiveEl;
  }

  function closeArchive() {
    if (!archiveEl) return;
    archiveEl.classList.remove('is-show');
    archiveEl.hidden = true;
  }

  function openArchive(sessionId) {
    var session = rtStore.getSession(sessionId);
    if (!session) { toast('未找到共读记录'); return; }
    var ctx = getSessionContext(session);
    ensureArchive();
    var titleEl = $('tw-rt-archive-title');
    var bodyEl = $('tw-rt-archive-body');
    var bookTitle = ctx && ctx.book ? ctx.book.title : '未知典籍';
    if (titleEl) titleEl.textContent = '已共读 · 《' + bookTitle + '》';
    var msgs = session.messages || [];
    if (bodyEl) {
      if (!msgs.length) {
        bodyEl.innerHTML = '<p class="tw-rt-archive__empty">本次共读无文字记录</p>';
      } else {
        bodyEl.innerHTML = msgs.map(function (m) {
          return bubbleHtml(m, ctx || { profile: {}, contact: {} });
        }).join('');
        applyStickerUrls(bodyEl);
      }
    }
    archiveEl.hidden = false;
    archiveEl.classList.add('is-show');
  }

  /* ── Salon lobby ── */

  function autoSelectProfile(contactId) {
    var st = chatStore();
    if (!st || !contactId) return '';
    var contact = st.findContact(contactId);
    if (!contact) return '';
    return trim(contact.defaultProfileId) || (st.getActiveProfile() && st.getActiveProfile().id) || '';
  }

  function updateLobbyPanels() {
    var st = chatStore();
    var partnerVal = $('tw-salon-partner-val');
    var bookVal = $('tw-salon-book-val');
    var userAv = $('tw-salon-avatar-user');
    var roleAv = $('tw-salon-avatar-role');

    if (lobbyState.contactId && st) {
      var contact = st.findContact(lobbyState.contactId);
      if (partnerVal && contact) partnerVal.textContent = contactDisplayName(contact);
      if (roleAv && contact) roleAv.textContent = contactInitial(contact);
      if (!lobbyState.profileId) lobbyState.profileId = autoSelectProfile(lobbyState.contactId);
    } else {
      if (partnerVal) partnerVal.textContent = '选择共读角色';
    }

    if (lobbyState.profileId && st && userAv) {
      var profile = st.getProfiles().find(function (p) { return p.id === lobbyState.profileId; });
      userAv.textContent = profile ? profileInitial(profile) : '你';
    } else if (userAv) userAv.textContent = '你';

    if (lobbyState.bookId) {
      var book = bookStore.getBook(lobbyState.bookId);
      if (bookVal && book) bookVal.textContent = book.title;
    } else if (bookVal) bookVal.textContent = '选择典籍';
  }

  function renderContactPicker() {
    var el = $('tw-salon-contacts');
    if (!el) return;
    var st = chatStore();
    var contacts = st && st.getContacts ? st.getContacts() : [];
    if (!contacts.length) {
      el.innerHTML = '<p class="tw-salon__empty">暂无角色 · 请先在通讯录添加</p>';
      return;
    }
    if (!lobbyState.contactId) {
      lobbyState.contactId = contacts[0].id;
      lobbyState.profileId = autoSelectProfile(lobbyState.contactId);
    }
    el.innerHTML = contacts.map(function (c) {
      var active = lobbyState.contactId === c.id ? ' is-selected' : '';
      return (
        '<button type="button" class="tw-salon__pick' + active + '" data-tw-rt-contact="' + esc(c.id) + '">' +
        '<span class="tw-salon__pick-av">' + esc(contactInitial(c)) + '</span>' +
        '<span class="tw-salon__pick-name">' + esc(contactDisplayName(c)) + '</span></button>'
      );
    }).join('');
    updateLobbyPanels();
  }

  function renderBookPicker() {
    var el = $('tw-salon-books');
    if (!el) return;
    var books = bookStore.getBooks();
    if (!books.length) {
      el.innerHTML = '<p class="tw-salon__empty">尚无典籍 · 请先在编纂室导入</p>';
      return;
    }
    if (!lobbyState.bookId && books[0]) lobbyState.bookId = books[0].id;
    el.innerHTML = books.map(function (b, i) {
      var active = lobbyState.bookId === b.id ? ' is-selected' : '';
      var no = String(i + 1).padStart(2, '0');
      return (
        '<button type="button" class="tw-salon__book-pick' + active + '" data-tw-rt-book="' + esc(b.id) + '">' +
        '<span class="tw-salon__book-no">' + no + '</span>' +
        '<span class="tw-salon__book-name">' + esc(b.title) + '</span></button>'
      );
    }).join('');
    updateLobbyPanels();
  }

  function renderHistory() {
    var pausedEl = $('tw-salon-paused');
    var doneEl = $('tw-salon-done');
    if (!pausedEl || !doneEl) return;
    var st = chatStore();
    var paused = rtStore.getPausedSessions();
    var done = rtStore.getCompletedSessions();

    if (!paused.length) {
      pausedEl.innerHTML = '<p class="tw-salon__hist-empty">暂无暂停中的共读</p>';
    } else {
      pausedEl.innerHTML = paused.map(function (s) {
        var book = bookStore.getBook(s.bookId);
        var contact = st && st.findContact(s.contactId);
        var title = book ? book.title : '未知典籍';
        var who = contact ? contactDisplayName(contact) : '角色';
        return (
          '<button type="button" class="tw-salon__hist-item tw-salon__hist-item--active" data-tw-rt-resume="' + esc(s.id) + '">' +
          '<span class="tw-salon__hist-badge">进行中</span>' +
          '<strong>《' + esc(title) + '》</strong>' +
          '<em>与 ' + esc(who) + ' · 第 ' + (s.page + 1) + ' 页</em></button>'
        );
      }).join('');
    }

    if (!done.length) {
      doneEl.innerHTML = '<p class="tw-salon__hist-empty">尚无已共读记录</p>';
    } else {
      doneEl.innerHTML = done.map(function (s) {
        var book = bookStore.getBook(s.bookId);
        var contact = st && st.findContact(s.contactId);
        var title = book ? book.title : '未知典籍';
        var who = contact ? contactDisplayName(contact) : '角色';
        var msgCount = (s.messages || []).length;
        return (
          '<button type="button" class="tw-salon__hist-item" data-tw-rt-view="' + esc(s.id) + '">' +
          '<strong>《' + esc(title) + '》</strong>' +
          '<em>与 ' + esc(who) + ' · ' + msgCount + ' 条对话</em></button>'
        );
      }).join('');
    }
  }

  function updateEnterButton() {
    var btn = $('tw-salon-enter');
    if (!btn) return;
    var ok = !!(lobbyState.contactId && lobbyState.bookId);
    btn.disabled = !ok;
    btn.classList.toggle('is-ready', ok);
    btn.textContent = ok ? '进入共读' : '选择角色与典籍';
  }

  function renderSalon() {
    renderContactPicker();
    renderBookPicker();
    renderHistory();
    updateEnterButton();
    updateLobbyPanels();
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;

    var salon = $('tw-salon-root');
    if (salon) {
      salon.addEventListener('click', function (e) {
        var cBtn = e.target.closest('[data-tw-rt-contact]');
        if (cBtn) {
          lobbyState.contactId = cBtn.getAttribute('data-tw-rt-contact');
          lobbyState.profileId = autoSelectProfile(lobbyState.contactId);
          renderContactPicker();
          updateEnterButton();
          return;
        }
        var bBtn = e.target.closest('[data-tw-rt-book]');
        if (bBtn) {
          lobbyState.bookId = bBtn.getAttribute('data-tw-rt-book');
          renderBookPicker();
          updateEnterButton();
          return;
        }
        var resumeBtn = e.target.closest('[data-tw-rt-resume]');
        if (resumeBtn) {
          resumeSession(resumeBtn.getAttribute('data-tw-rt-resume')).catch(function (err) {
            toast(fmtStartErr(err));
          });
          return;
        }
        var viewBtn = e.target.closest('[data-tw-rt-view]');
        if (viewBtn) {
          openArchive(viewBtn.getAttribute('data-tw-rt-view'));
          return;
        }
      });
    }

    var enterBtn = $('tw-salon-enter');
    if (enterBtn) {
      enterBtn.addEventListener('click', function () {
        if (!lobbyState.contactId || !lobbyState.bookId) {
          toast('请选择共读角色和典籍');
          return;
        }
        enterBtn.disabled = true;
        enterBtn.textContent = '正在进入…';
        startSession(lobbyState.contactId, lobbyState.bookId, lobbyState.profileId)
          .catch(function (err) { toast(fmtStartErr(err)); })
          .finally(function () {
            enterBtn.disabled = false;
            updateEnterButton();
          });
      });
    }

    var pauseBtn = $('tw-rt-pause-btn');
    if (pauseBtn) pauseBtn.addEventListener('click', promptPauseOrEnd);

    var bookArea = $('tw-rt-book');
    if (bookArea) {
      bookArea.addEventListener('click', function (e) {
        if (!room) return;
        var rect = bookArea.getBoundingClientRect();
        if (!rect.width) return;
        var relX = (e.clientX - rect.left) / rect.width;
        if (relX < 0.3) goToPage(-1);
        else if (relX > 0.7) goToPage(1);
      });
    }
    bindBookSpreadScroll();

    var chatToggle = $('tw-rt-chat-toggle');
    var rtRoom = $('tw-rt-room');
    if (chatToggle && rtRoom) {
      chatToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var collapsed = rtRoom.classList.toggle('is-chat-collapsed');
        chatToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        chatToggle.setAttribute('aria-label', collapsed ? '展开对话区' : '收起对话区');
      });
    }

    var sendBtn = $('tw-rt-send');
    var input = $('tw-rt-input');
    function doSend() {
      if (!input || apiPending > 0) return;
      var t = trim(input.value);
      if (!t) return;
      input.value = '';
      sendUserMessage(t).catch(function (err) {
        if (err && err.message === 'api_not_configured') toast('请先在设置中配置 API');
        else if (err && err.message !== 'busy' && err.message !== 'empty_message') toast('发送失败');
      });
    }
    if (sendBtn) sendBtn.addEventListener('click', doSend);
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
      });
    }
  }

  function init() {
    rtStore.load().then(function () {
      bindUi();
    });
    document.addEventListener('miya-tw-read-typography', function () {
      if (!room) return;
      var spread = $('tw-rt-book-spread');
      if (spread && global.miyaTypewriterSettings && global.miyaTypewriterSettings.applyReaderFont) {
        global.miyaTypewriterSettings.applyReaderFont(spread);
      }
    });
  }

  init();

  global.MiyaTypewriterReadTogether = {
    renderSalon: renderSalon,
    isInRoom: isInRoom,
    closeRoom: closeRoom,
    resumeSession: resumeSession,
    openArchive: openArchive,
    getReadingContext: getReadingContext,
    goToChapterPage: goToChapterPage
  };
})(window);
