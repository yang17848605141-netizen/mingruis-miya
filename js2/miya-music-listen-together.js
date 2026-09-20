/**
 * miya-music-listen-together.js — 网易云「一起听」：选角、选歌、线上聊天、切歌
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'miya-music-listen-together-v1';
  var RE_SWITCH_SONG = /^切歌[-－—]\s*(.+)$/;

  var session = null;
  var sessionReady = false;
  var sessionReadyPromise = null;
  var apiPending = 0;
  var uiBound = false;
  var lobbyState = { contactId: '', trackId: '', playlistId: '' };

  function $(id) { return document.getElementById(id); }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function newId(prefix) {
    return (prefix || 'lt') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function chatStore() { return global.miyaChatStore || null; }
  function chatEngine() { return global.miyaChatEngine || null; }
  function musicEngine() { return global.miyaMusicEngine || null; }
  function onlineFmt() { return global.MiyaChatOnlineFormat || null; }

  function defaultSession() {
    return { active: false, messages: [] };
  }

  function applySessionRaw(raw) {
    if (raw && raw.active) {
      session = raw;
    } else {
      session = defaultSession();
    }
    sessionReady = true;
    return session;
  }

  function trySyncHydrateSession() {
    if (sessionReady) return session;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(STORAGE_KEY);
      if (raw != null) return applySessionRaw(raw);
    }
    return null;
  }

  function loadSession() {
    var sync = trySyncHydrateSession();
    if (sync) return sync;
    if (!session) session = defaultSession();
    return session;
  }

  function whenSessionReady() {
    if (sessionReady) return Promise.resolve(session);
    if (sessionReadyPromise) return sessionReadyPromise;
    sessionReadyPromise = (global.miyaReadLsJsonKey
      ? global.miyaReadLsJsonKey(STORAGE_KEY, null)
      : Promise.resolve(null)
    ).then(function (raw) {
      return applySessionRaw(raw);
    }).catch(function () {
      session = defaultSession();
      sessionReady = true;
      return session;
    });
    return sessionReadyPromise;
  }

  function invalidateSessionCache() {
    session = null;
    sessionReady = false;
    sessionReadyPromise = null;
  }

  function saveSession() {
    if (!session) return;
    if (global.miyaWriteLsJsonKey) {
      global.miyaWriteLsJsonKey(STORAGE_KEY, session).catch(function () {});
    }
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

  function getSessionContext() {
    var st = chatStore();
    if (!session || !session.active || !st) return null;
    var contact = st.findContact(session.contactId);
    if (!contact) return null;
    var profile = st.getProfiles().find(function (p) { return p.id === session.profileId; }) || st.getActiveProfile();
    var chat = session.chatId ? st.findChat(session.chatId) : null;
    var settings = session.chatId && st.getChatSettings ? st.getChatSettings(session.chatId) : null;
    return { contact: contact, profile: profile, chat: chat, settings: settings };
  }

  function resolveChatForContact(contactId) {
    var st = chatStore();
    if (!st || !contactId) return null;
    var contact = st.findContact(contactId);
    if (!contact) return null;
    var profileId = trim(contact.defaultProfileId) || (st.getActiveProfile() && st.getActiveProfile().id) || '';
    var chat = st.findChatByContact(contactId, profileId);
    if (!chat && st.createChat) {
      chat = st.createChat({ contactId: contactId, profileId: profileId, type: 'private' });
    }
    return { contact: contact, profileId: profileId, chat: chat };
  }

  function getPlaylistTracks(playlistId) {
    var eng = musicEngine();
    if (!eng) return [];
    var data = eng.getData();
    if (!playlistId) return data.library.slice();
    var pl = data.playlists.find(function (p) { return p && p.id === playlistId; });
    if (!pl) return [];
    return (pl.trackIds || []).map(function (tid) {
      return data.library.find(function (t) { return t && t.id === tid; });
    }).filter(Boolean);
  }

  function buildMusicContextBlock() {
    var eng = musicEngine();
    if (!eng) return '';
    var snap = eng.buildSnapshot();
    var lines = ['【一起听·当前播放】'];
    if (!snap.title) {
      lines.push('- 状态：尚未播放歌曲');
      return lines.join('\n');
    }
    lines.push('- 歌名：' + snap.title);
    lines.push('- 歌手：' + (snap.artist || '未知'));
    lines.push('- 播放状态：' + (snap.isPlaying ? '播放中' : '已暂停'));
    if (snap.duration) {
      var ct = Math.floor(snap.currentTime || 0);
      var dur = Math.floor(snap.duration || 0);
      lines.push('- 进度：' + Math.floor(ct / 60) + ':' + String(ct % 60).padStart(2, '0') + ' / ' + Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0'));
    }
    if (snap.lyricLine) lines.push('- 当前歌词：「' + snap.lyricLine + '」');
    var parsed = snap.parsedLrc || [];
    if (parsed.length) {
      var idx = snap.lyricsActiveIndex != null ? snap.lyricsActiveIndex : 0;
      var ctx = [];
      for (var i = Math.max(0, idx - 2); i <= Math.min(parsed.length - 1, idx + 3); i++) {
        var row = parsed[i];
        if (row && row.text) ctx.push((i === idx ? '▶ ' : '  ') + row.text);
      }
      if (ctx.length) {
        lines.push('- 歌词上下文：');
        lines.push(ctx.join('\n'));
      }
    }
    var tracks = getPlaylistTracks(session && session.playlistId);
    if (tracks.length) {
      lines.push('- 可选歌单（共 ' + tracks.length + ' 首，切歌时从中选择）：');
      tracks.slice(0, 30).forEach(function (t, i) {
        lines.push('  ' + (i + 1) + '. ' + t.title + ' — ' + (t.artist || '未知'));
      });
      if (tracks.length > 30) lines.push('  … 另有 ' + (tracks.length - 30) + ' 首');
    }
    return lines.join('\n');
  }

  function buildListenTogetherRules(roleName) {
    var rn = roleName || '角色';
    return [
      '【一起听·场景规则·' + rn + '】',
      '你正与用户进行网易云音乐「一起听」——双方同步听同一首歌，像并肩戴耳机聊天。',
      '你可以感知当前播放的歌名、歌手、实时歌词与播放进度（见「一起听·当前播放」）。',
      '对话须符合一起听格式：用户发一句，你回 2–5 条气泡（每行一条）；可穿插对歌曲、歌词、氛围的感受。',
      '正文仅允许普通文字与「切歌-歌名或序号」；禁止引用-/语音-/表情包-/图片-/位置-/转账-/旁白-等线上聊天专属格式。',
      '禁止脱离一起听场景；不要假装听不到正在播放的歌；不要输出与音乐无关的长篇说教。',
      '若你想换歌，单独输出一行：切歌-歌名（或 切歌-序号，序号对应歌单列表）；该行只写切歌指令，不要和其他文字混在同一行。',
      '切歌应自然：可以说「下一首想听 xxx」然后输出切歌行；不要频繁切歌。',
      '用户也可能手动切歌——若系统通知歌曲已变更，请自然接话点评新歌。',
      '保持 ' + rn + ' 的人设与对用户的关系；语气亲密自然，像真的在一起听歌。',
      '系统提示中已注入命中的世界书（绑定该角色的局部词条无关键词时始终纳入；有关键词须上下文命中）；须在回复中落实。',
      '每轮仅输出正文气泡（每行一条）；禁止输出 <thinking>、<miyavoice>、思维链或心声。'
    ].join('\n');
  }

  function formatSessionMsgForApi(m) {
    if (!m) return '';
    if (m.role === 'user') return trim(m.content);
    if (m.role === 'assistant') return trim(m.content);
    if (m.role === 'system') return trim(m.content);
    return '';
  }

  function buildApiMessages(userText, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var ctx = getSessionContext();
    if (!ctx) return { error: 'session_invalid', messages: [] };
    var eng = chatEngine();
    if (!eng) return { error: 'engine_missing', messages: [] };

    var contact = ctx.contact;
    var profile = ctx.profile;
    var settings = ctx.settings;
    var slice = (session.messages || []).slice(-40);
    var contextText = slice.map(formatSessionMsgForApi).filter(Boolean).join('\n') + '\n' + trim(userText);

    var wbBundle = typeof eng.buildWorldbookBundle === 'function'
      ? eng.buildWorldbookBundle(contact, contextText, null, { promptContext: 'general' })
      : { frontLayers: [], layers: [], backLayers: [] };

    var systemContent = typeof eng.buildListenTogetherSystemPrompt === 'function'
      ? eng.buildListenTogetherSystemPrompt({
          contact: contact,
          profile: profile,
          contextText: contextText,
          chatSettings: settings,
          worldbookFrontLayers: wbBundle.frontLayers,
          worldbookLayers: wbBundle.layers,
          worldbookBackLayers: wbBundle.backLayers
        })
      : '';

    systemContent = systemContent + '\n\n' + buildListenTogetherRules(contact.name || '角色');
    systemContent = systemContent + '\n\n' + buildMusicContextBlock();

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
    if (fmt && typeof fmt.buildListenTogetherPerTurnReminder === 'function') {
      apiMessages.push({
        role: 'system',
        content: fmt.buildListenTogetherPerTurnReminder({
          roleName: contact.name || '角色',
          bubbleMin: 2,
          bubbleMax: 5
        })
      });
    }

    return {
      messages: apiMessages,
      contact: contact,
      profile: profile,
      chat: ctx.chat
    };
  }

  function parseSwitchSongAction(line) {
    var m = trim(line).match(RE_SWITCH_SONG);
    return m ? trim(m[1]) : '';
  }

  function findTrackByHint(hint) {
    var tracks = getPlaylistTracks(session && session.playlistId);
    if (!tracks.length) return null;
    var h = trim(hint);
    if (!h) return null;
    var num = parseInt(h, 10);
    if (!isNaN(num) && num >= 1 && num <= tracks.length) return tracks[num - 1];
    var lower = h.toLowerCase();
    var exact = tracks.find(function (t) {
      return trim(t.title).toLowerCase() === lower || (trim(t.title) + ' ' + trim(t.artist)).toLowerCase() === lower;
    });
    if (exact) return exact;
    return tracks.find(function (t) {
      return trim(t.title).toLowerCase().indexOf(lower) >= 0 || trim(t.artist || '').toLowerCase().indexOf(lower) >= 0;
    }) || null;
  }

  function parseRoleReply(raw, contact) {
    var eng = chatEngine();
    var fmt = onlineFmt();
    var body = raw;
    if (eng && typeof eng.parseThinking === 'function') {
      body = eng.parseThinking(body).content || body;
    }
    if (eng && typeof eng.stripHeartVoiceTags === 'function') body = eng.stripHeartVoiceTags(body);
    if (eng && typeof eng.splitBubbles === 'function') {
      var bubbles = eng.splitBubbles(body);
    } else {
      bubbles = trim(body).split(/\n/).map(trim).filter(Boolean);
    }

    var displayLines = bubbles.slice();
    var switchAction = null;
    var outBubbles = [];

    displayLines.forEach(function (line) {
      var sw = parseSwitchSongAction(line);
      if (sw) {
        switchAction = sw;
        return;
      }
      outBubbles.push(line);
    });

    var parsed = [];
    if (fmt && typeof fmt.parseListenTogetherOutputLinesMeta === 'function') {
      var meta = fmt.parseListenTogetherOutputLinesMeta(outBubbles);
      parsed = (meta.bubbles || []).map(function (b) {
        return { type: b.type || 'text', content: b.content || '' };
      });
    } else {
      parsed = outBubbles.map(function (l) { return { type: 'text', content: l }; });
    }

    return { bubbles: parsed, switchAction: switchAction };
  }

  function addMessage(role, content, extra) {
    extra = extra || {};
    var msg = {
      id: newId('msg'),
      role: role,
      content: trim(content),
      type: extra.type || 'text',
      createdAt: Date.now()
    };
    if (extra.switchTrack) msg.switchTrack = extra.switchTrack;
    session.messages = session.messages || [];
    session.messages.push(msg);
    saveSession();
    return msg;
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
          if (!parsed.bubbles.length && !parsed.switchAction) throw new Error('empty_reply');
          parsed.bubbles.forEach(function (b) {
            if (b.content) addMessage('assistant', b.content, { type: b.type });
          });
          if (parsed.switchAction) {
            var track = findTrackByHint(parsed.switchAction);
            if (track) {
              addMessage('system', '已切至「' + track.title + '」', { type: 'track_change' });
              return applyTrackSwitch(track).then(function () { return parsed; });
            }
          }
          return parsed;
        })
        .finally(function () { setApiPending(0); });
    });
  }

  function applyTrackSwitch(track) {
    var eng = musicEngine();
    if (!eng || !track) return Promise.resolve();
    session.currentTrackId = track.id;
    saveSession();
    var tick = global.miyaMusicApp && global.miyaMusicApp._tickUi ? global.miyaMusicApp._tickUi : null;
    return eng.playTrack(track, tick || function () { onMusicTick(); }).then(function () {
      onMusicTick();
      renderSessionPlayer();
    });
  }

  function startSession(contactId, trackId, playlistId) {
    var resolved = resolveChatForContact(contactId);
    if (!resolved || !resolved.chat) return Promise.reject(new Error('contact_not_found'));
    var eng = musicEngine();
    if (!eng) return Promise.reject(new Error('music_missing'));
    var track = eng.getData().library.find(function (t) { return t && t.id === trackId; });
    if (!track) return Promise.reject(new Error('track_not_found'));

    var tick = global.miyaMusicApp && global.miyaMusicApp._tickUi ? global.miyaMusicApp._tickUi : null;
    if (playlistId) eng.setActivePlaylistId(playlistId);

    return eng.playTrack(track, tick || function () { onMusicTick(); })
      .catch(function (err) {
        if (isTrackPlayingNow(eng, trackId)) return;
        return Promise.reject(err);
      })
      .then(function () {
        session = {
          active: true,
          sessionId: newId('sess'),
          contactId: contactId,
          profileId: resolved.profileId,
          chatId: resolved.chat.id,
          playlistId: playlistId || '',
          currentTrackId: trackId,
          messages: [],
          startedAt: Date.now()
        };
        saveSession();
        showLtPage('room');
        renderAll();
        updateTabBadge(true);
        renderSessionPlayer();
        toast('已进入一起听 · 正在播放「' + track.title + '」');

        return runCompletion('', {
          systemLead: '【一起听已开始】用户刚邀请你一起听「' + track.title + '」— ' + (track.artist || '未知歌手') + '。请主动打招呼，简短点评这首歌或当前氛围，2–4 条气泡即可，不要切歌。'
        }).catch(function (err) {
          var hint = fmtChatErr(err);
          if (hint) toast(hint);
        }).finally(function () {
          renderChatMessages();
        });
      });
  }

  function formatDuration(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function buildSessionSnapshot() {
    loadSession();
    if (!session || !session.active) return null;
    var ctx = getSessionContext();
    var eng = musicEngine();
    var trackTitle = '';
    var trackArtist = '';
    if (eng && session.currentTrackId) {
      var track = eng.getData().library.find(function (t) { return t && t.id === session.currentTrackId; });
      if (track) {
        trackTitle = track.title || '';
        trackArtist = track.artist || '';
      }
    }
    var startedAt = session.startedAt || Date.now();
    var items = (session.messages || []).filter(function (m) {
      if (!m) return false;
      if (m.role === 'user' || m.role === 'assistant') return trim(m.content);
      return m.role === 'system' && m.type === 'track_change' && trim(m.content);
    }).map(function (m) {
      return {
        role: m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'system'),
        text: trim(m.content),
        type: m.type || 'text'
      };
    });
    return {
      chatId: session.chatId,
      sessionId: session.sessionId,
      contactId: session.contactId,
      contactName: ctx ? contactDisplayName(ctx.contact) : 'TA',
      startedAt: startedAt,
      endedAt: Date.now(),
      durationSec: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
      trackTitle: trackTitle,
      trackArtist: trackArtist,
      items: items
    };
  }

  function saveListenTogetherCapsule(snapshot) {
    if (!snapshot || !snapshot.chatId) return Promise.resolve();
    var st = chatStore();
    if (!st || !st.addMessage) return Promise.resolve();
    var dur = formatDuration(snapshot.durationSec);
    var preview = '一起听 ' + dur;
    if (snapshot.trackTitle) preview += ' · ' + snapshot.trackTitle;
    return st.addMessage(snapshot.chatId, {
      role: 'system',
      type: 'listen_together_capsule',
      content: preview,
      sessionId: snapshot.sessionId,
      listenTogetherCapsule: {
        sessionId: snapshot.sessionId,
        status: 'ended',
        startedAt: snapshot.startedAt,
        endedAt: snapshot.endedAt,
        durationSec: snapshot.durationSec,
        trackTitle: snapshot.trackTitle,
        trackArtist: snapshot.trackArtist,
        items: snapshot.items.slice()
      }
    }).then(function () {
      if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
        global.miyaChatApp.refreshLists();
      }
      if (global.miyaChatRoom && typeof global.miyaChatRoom.getOpenChatId === 'function' &&
          global.miyaChatRoom.getOpenChatId() === snapshot.chatId &&
          typeof global.miyaChatRoom.refresh === 'function') {
        global.miyaChatRoom.refresh();
      }
      toast('已分享给' + snapshot.contactName);
    }).catch(function () {
      toast('分享失败');
    });
  }

  function confirmDialog(opts) {
    if (global.miyaDialog && global.miyaDialog.confirm) {
      return global.miyaDialog.confirm(opts);
    }
    return Promise.resolve(window.confirm(String((opts.title || '') + '\n' + (opts.message || ''))));
  }

  function promptEndSession() {
    loadSession();
    if (!session || !session.active) return;
    var ctx = getSessionContext();
    var contactName = ctx ? contactDisplayName(ctx.contact) : 'TA';
    confirmDialog({
      title: '结束一起听',
      message: '确定要结束本次一起听吗？',
      confirmText: '结束',
      cancelText: '取消'
    }).then(function (ok) {
      if (!ok) return;
      var snapshot = buildSessionSnapshot();
      if (!snapshot) {
        endSession();
        return;
      }
      return confirmDialog({
        title: '分享记录',
        message: '是否将本次记录分享给' + contactName + '？',
        confirmText: '分享',
        cancelText: '暂不'
      }).then(function (share) {
        if (share) {
          return saveListenTogetherCapsule(snapshot).then(function () { endSession(); });
        }
        endSession();
      });
    });
  }

  var archiveEl = null;

  function ensureArchiveHost() {
    if (archiveEl && document.body.contains(archiveEl)) return archiveEl;
    archiveEl = document.createElement('div');
    archiveEl.className = 'mc-call-archive';
    archiveEl.hidden = true;
    archiveEl.setAttribute('aria-hidden', 'true');
    archiveEl.innerHTML =
      '<div class="mc-call-archive-backdrop" data-lt-archive-close></div>' +
      '<div class="mc-call-archive-panel" role="dialog" aria-modal="true">' +
      '<header class="mc-call-archive-head">' +
      '<h2 id="ncm-lt-archive-title">一起听</h2>' +
      '<button type="button" class="mc-call-archive-close" data-lt-archive-close aria-label="关闭">×</button>' +
      '</header>' +
      '<div class="mc-call-archive-body" id="ncm-lt-archive-body"></div>' +
      '</div>';
    document.body.appendChild(archiveEl);
    archiveEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-lt-archive-close]')) closeListenTogetherArchive();
    });
    return archiveEl;
  }

  function closeListenTogetherArchive() {
    if (!archiveEl) return;
    archiveEl.classList.remove('is-open');
    archiveEl.hidden = true;
    archiveEl.setAttribute('aria-hidden', 'true');
  }

  function findCapsuleMessage(chatId, sessionId) {
    var st = chatStore();
    if (!st || !chatId || !sessionId) return null;
    var list = st.getMessages(chatId) || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (!m || m.deleted || m.type !== 'listen_together_capsule') continue;
      var sid = (m.listenTogetherCapsule && m.listenTogetherCapsule.sessionId) || m.sessionId;
      if (String(sid) === String(sessionId)) return m;
    }
    return null;
  }

  function openListenTogetherArchive(chatId, sessionId) {
    var m = findCapsuleMessage(chatId, sessionId);
    if (!m || !m.listenTogetherCapsule) {
      toast('未找到一起听记录');
      return;
    }
    ensureArchiveHost();
    var cap = m.listenTogetherCapsule;
    var titleEl = $('ncm-lt-archive-title');
    var bodyEl = $('ncm-lt-archive-body');
    if (titleEl) titleEl.textContent = '一起听 · ' + formatDuration(cap.durationSec);
    var st = chatStore();
    var chat = st && st.findChat ? st.findChat(chatId) : null;
    var contact = chat && st.findContact ? st.findContact(chat.contactId) : null;
    var profile = chat && st.getProfiles
      ? (st.getProfiles().find(function (p) { return p.id === chat.profileId; }) || st.getActiveProfile())
      : null;
    var items = Array.isArray(cap.items) ? cap.items : [];
    var songLine = '';
    if (cap.trackTitle || cap.trackArtist) {
      songLine = '<p class="mc-call-archive-empty">' + esc(cap.trackTitle || '未记录歌曲') +
        (cap.trackArtist ? ' — ' + esc(cap.trackArtist) : '') + '</p>';
    }
    if (bodyEl) {
      if (!items.length) {
        bodyEl.innerHTML = songLine + '<p class="mc-call-archive-empty">本次一起听无文字记录</p>';
      } else {
        bodyEl.innerHTML = songLine + items.map(function (it) {
          var isUser = it.role === 'user';
          var who = isUser
            ? (profile && profile.name) || '我'
            : (contact ? contactDisplayName(contact) : '对方');
          if (it.role === 'system') {
            return '<div class="mc-call-archive-msg is-system"><span class="mc-call-archive-who">系统</span>' +
              '<div class="mc-call-archive-bubble"><p class="mc-call-archive-text">' + esc(it.text) + '</p></div></div>';
          }
          return '<div class="mc-call-archive-msg' + (isUser ? ' is-me' : ' is-other') + '">' +
            '<span class="mc-call-archive-who">' + esc(who) + '</span>' +
            '<div class="mc-call-archive-bubble"><p class="mc-call-archive-text">' + esc(it.text) + '</p></div></div>';
        }).join('');
      }
    }
    archiveEl.hidden = false;
    archiveEl.setAttribute('aria-hidden', 'false');
    archiveEl.classList.add('is-open');
  }

  function handleCapsuleClick(e) {
    var cap = e.target.closest('[data-qq-lt-capsule]');
    if (!cap) return false;
    e.preventDefault();
    e.stopPropagation();
    var cid = cap.getAttribute('data-chat-id');
    var sid = cap.getAttribute('data-session-id');
    if (cid && sid) openListenTogetherArchive(cid, sid);
    return true;
  }

  function endSession() {
    session = { active: false, messages: [] };
    saveSession();
    updateTabBadge(false);
    renderAll();
    toast('已结束一起听');
  }

  function sendUserMessage(text) {
    var t = trim(text);
    if (!t || !session || !session.active) return Promise.reject(new Error('empty_message'));
    addMessage('user', t);
    renderChatMessages();
    return runCompletion(t, {}).then(function () {
      renderChatMessages();
    });
  }

  function switchTrackByUser(trackId) {
    var eng = musicEngine();
    if (!eng || !session || !session.active) return Promise.resolve();
    var track = eng.getData().library.find(function (t) { return t && t.id === trackId; });
    if (!track) return Promise.resolve();
    session.currentTrackId = trackId;
    saveSession();
    addMessage('system', '你切换到了「' + track.title + '」', { type: 'track_change' });
    renderChatMessages();
    return applyTrackSwitch(track).then(function () {
      return runCompletion('', {
        systemLead: '【歌曲已切换】用户刚手动切到「' + track.title + '」— ' + (track.artist || '未知') + '。请自然接话，简短点评新歌，2–3 条气泡。'
      }).catch(function () {});
    });
  }

  function isActive() {
    loadSession();
    return !!(session && session.active);
  }

  /* ── UI ── */

  function toast(msg) {
    if (global.miyaMusicApp && typeof global.miyaMusicApp.toast === 'function') {
      global.miyaMusicApp.toast(msg);
      return;
    }
    var div = document.createElement('div');
    div.className = 'ncm-toast';
    div.textContent = msg;
    document.body.appendChild(div);
    requestAnimationFrame(function () { div.classList.add('is-visible'); });
    setTimeout(function () {
      div.classList.remove('is-visible');
      setTimeout(function () { div.remove(); }, 350);
    }, 2200);
  }

  function updateTabBadge(on) {
    var dot = $('ncm-lt-tab-dot');
    if (dot) dot.hidden = !on;
  }

  function syncShellChrome() {
    var app = document.getElementById('miya-music-app');
    if (!app) return;
    var room = $('ncm-lt-page-room');
    var onNotes = document.querySelector('.ncm-page--listen.is-active');
    var inRoom = !!(room && room.classList.contains('is-active'));
    app.classList.toggle('is-lt-room', !!(onNotes && inRoom));
  }

  function showLtPage(page) {
    var setup = $('ncm-lt-page-setup');
    var room = $('ncm-lt-page-room');
    if (!setup || !room) return;
    var isRoom = page === 'room';
    setup.classList.toggle('is-active', !isRoom);
    room.classList.toggle('is-active', isRoom);
    syncShellChrome();
  }

  function renderSetup() {
    renderContactPicker();
    renderPlaylistPicker();
    updateStartButton();
    updatePreview();
  }

  function updatePreview() {
    var el = $('ncm-lt-preview');
    var btn = $('ncm-lt-start');
    if (!el) return;
    var st = chatStore();
    var eng = musicEngine();
    if (!lobbyState.contactId) {
      el.textContent = '请先选择一位角色';
      return;
    }
    if (!lobbyState.trackId) {
      el.textContent = '再选一首想一起听的歌';
      return;
    }
    var contact = st && st.findContact(lobbyState.contactId);
    var track = eng && eng.getData().library.find(function (t) { return t && t.id === lobbyState.trackId; });
    var cName = contact ? contactDisplayName(contact) : '角色';
    var tName = track ? track.title : '歌曲';
    el.textContent = '和 ' + cName + ' 一起听「' + tName + '」';
    if (btn && lobbyState.contactId && lobbyState.trackId) {
      btn.textContent = 'ENTER · 进入一起听';
    }
  }

  function fmtStartErr(err) {
    var m = err && err.message ? err.message : '';
    if (m === 'contact_not_found') return '找不到角色，请先在通讯录添加';
    if (m === 'track_not_found') return '找不到歌曲，请重新选择';
    if (m === 'music_missing') return '音乐模块未加载';
    if (m === '没有拿到可播放链接' || m.indexOf('可播放链接') >= 0) {
      return '这首歌曲暂无法播放，请换一首或检查导入';
    }
    if (m === '播放失败' || /NotAllowedError|play\(\)/i.test(m)) {
      return '浏览器阻止自动播放，请先在其他页面点一次播放再试';
    }
    if (m) return '开始失败：' + m.slice(0, 80);
    return '开始失败，请换一首歌再试';
  }

  function fmtChatErr(err) {
    var m = err && err.message ? err.message : '';
    if (m === 'api_not_configured' || m === 'secondary_api_not_configured') {
      return '已进入一起听，配置 API 后角色才能聊天';
    }
    if (m === 'empty_reply') return '角色暂时没有回复，你可以先发消息';
    if (m === 'engine_missing') return '聊天模块未加载';
    if (m && m.indexOf('HTTP ') === 0) return '角色回复失败，请检查 API 设置';
    return '';
  }

  function isTrackPlayingNow(eng, trackId) {
    if (!eng || !trackId) return false;
    var np = eng.getData().nowPlaying;
    if (!np || np.id !== trackId) return false;
    return !!eng.buildSnapshot().isPlaying;
  }

  function contactDisplayName(c) {
    return trim(c.remarkName || c.name || '未命名');
  }

  function contactInitial(c) {
    var n = contactDisplayName(c);
    return n.slice(0, 1) || '?';
  }

  function profileInitial(profile) {
    var n = profile && profile.name ? trim(profile.name) : '我';
    return n.slice(0, 1) || '我';
  }

  function resolveProfileAvatarUrl(profile, cb) {
    var st = chatStore();
    if (!profile) { cb(''); return; }
    if (profile.avatarUrl) { cb(trim(profile.avatarUrl)); return; }
    if (profile.avatar) { cb(trim(profile.avatar)); return; }
    if (profile.avatarId && st) {
      if (st.getCachedBlobUrl) {
        var cachedProfile = st.getCachedBlobUrl(profile.avatarId);
        if (cachedProfile) { cb(trim(cachedProfile)); return; }
      }
      if (st.getAvatarUrl) {
        st.getAvatarUrl(profile.avatarId).then(function (url) { cb(trim(url)); }).catch(function () { cb(''); });
        return;
      }
    }
    cb('');
  }

  function resolveContactAvatarUrl(contact, cb) {
    var extras = global.miyaChatRoomExtras;
    if (extras && typeof extras.resolveContactAvatarUrl === 'function') {
      var sync = extras.resolveContactAvatarUrl(contact);
      if (sync) { cb(trim(sync)); return; }
    }
    var st = chatStore();
    if (!contact) { cb(''); return; }
    if (contact.avatar) { cb(trim(contact.avatar)); return; }
    if (contact.avatarBlobId && st) {
      if (st.getCachedBlobUrl) {
        var cachedContact = st.getCachedBlobUrl(contact.avatarBlobId);
        if (cachedContact) { cb(trim(cachedContact)); return; }
      }
      if (st.getAvatarUrl) {
        st.getAvatarUrl(contact.avatarBlobId).then(function (url) { cb(trim(url)); }).catch(function () { cb(''); });
        return;
      }
    }
    if (extras && typeof extras.resolveContactAvatarUrlAsync === 'function') {
      extras.resolveContactAvatarUrlAsync(contact).then(function (url) { cb(trim(url)); }).catch(function () { cb(''); });
      return;
    }
    cb('');
  }

  function avatarInnerHtml(url, initial) {
    if (url) {
      return '<img class="lt-av-img" src="' + esc(url) + '" alt="" data-lt-fallback="' + esc(initial) + '">';
    }
    return '<span class="lt-av-fallback">' + esc(initial) + '</span>';
  }

  function setAvatarEl(el, url, initial) {
    if (!el) return;
    el.innerHTML = avatarInnerHtml(url, initial);
  }

  function enrichContextAvatars(ctx, cb) {
    if (!ctx) { cb(null); return; }
    var out = { profileUrl: '', contactUrl: '' };
    var left = 2;
    function done() {
      left--;
      if (left <= 0) cb(Object.assign({}, ctx, out));
    }
    resolveProfileAvatarUrl(ctx.profile, function (url) { out.profileUrl = url; done(); });
    resolveContactAvatarUrl(ctx.contact, function (url) { out.contactUrl = url; done(); });
  }

  function renderContactPicker() {
    var el = $('ncm-lt-contacts');
    if (!el) return;
    var st = chatStore();
    var contacts = st && st.getContacts ? st.getContacts() : [];
    if (!contacts.length) {
      el.innerHTML = '<p class="lt-empty">暂无角色 · 请先在通讯录添加</p>';
      return;
    }
    if (!lobbyState.contactId) lobbyState.contactId = contacts[0].id;
    el.innerHTML = contacts.map(function (c) {
      var active = lobbyState.contactId === c.id ? ' is-selected' : '';
      var initial = contactInitial(c);
      return (
        '<button type="button" class="lt-cast__card' + active + '" data-lt-contact="' + esc(c.id) + '">' +
        '<span class="lt-cast__av" data-lt-cast-ava="' + esc(c.id) + '">' + esc(initial) + '</span>' +
        '<span class="lt-cast__name">' + esc(contactDisplayName(c)) + '</span>' +
        '<span class="lt-cast__mark">SELECTED</span></button>'
      );
    }).join('');
    contacts.forEach(function (c) {
      var avEl = el.querySelector('[data-lt-cast-ava="' + String(c.id).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]');
      if (!avEl) return;
      var initial = contactInitial(c);
      resolveContactAvatarUrl(c, function (url) {
        if (url) setAvatarEl(avEl, url, initial);
      });
    });
  }

  function renderPlaylistPicker() {
    var plEl = $('ncm-lt-playlists');
    var trEl = $('ncm-lt-tracks');
    if (!plEl || !trEl) return;
    var eng = musicEngine();
    if (!eng) return;
    var data = eng.getData();
    var pls = data.playlists.slice();
    if (!pls.length && data.library.length) {
      plEl.innerHTML = '';
      lobbyState.playlistId = '';
      var libTracks = data.library.slice();
      if (!lobbyState.trackId && libTracks[0]) lobbyState.trackId = libTracks[0].id;
      trEl.innerHTML = libTracks.map(function (t, i) {
        return trackRowHtml(t, i, lobbyState.trackId === t.id);
      }).join('');
      return;
    }
    if (!pls.length) {
      plEl.innerHTML = '';
      trEl.innerHTML = '<p class="lt-empty">暂无歌曲 · 请先在「我的」导入</p>';
      return;
    }
    if (!lobbyState.playlistId && pls[0]) lobbyState.playlistId = pls[0].id;
    plEl.innerHTML = pls.map(function (pl) {
      var active = lobbyState.playlistId === pl.id ? ' is-active' : '';
      return (
        '<button type="button" class="lt-pl-tab' + active + '" data-lt-pl="' + esc(pl.id) + '">' +
        esc(pl.name) + '</button>'
      );
    }).join('');

    var tracks = getPlaylistTracks(lobbyState.playlistId);
    if (!tracks.length) {
      trEl.innerHTML = '<p class="lt-empty">歌单为空</p>';
      return;
    }
    if (!lobbyState.trackId && tracks[0]) lobbyState.trackId = tracks[0].id;
    trEl.innerHTML = tracks.map(function (t, i) {
      return trackRowHtml(t, i, lobbyState.trackId === t.id);
    }).join('');
  }

  function trackRowHtml(t, i, selected) {
    var no = String(i + 1).padStart(2, '0');
    return (
      '<button type="button" class="lt-track' + (selected ? ' is-selected' : '') + '" data-lt-track="' + esc(t.id) + '">' +
      '<span class="lt-track__no">' + no + '</span>' +
      '<span class="lt-track__info"><strong>' + esc(t.title) + '</strong>' +
      '<em>' + esc(t.artist || '未知') + '</em></span></button>'
    );
  }

  function renderAll() {
    loadSession();
    if (session && session.active) {
      showLtPage('room');
      renderSession();
    } else {
      showLtPage('setup');
      renderSetup();
    }
  }

  function updateStartButton() {
    var btn = $('ncm-lt-start');
    if (!btn) return;
    var ok = !!(lobbyState.contactId && lobbyState.trackId);
    btn.disabled = !ok;
    btn.classList.toggle('is-ready', ok);
    if (!ok) btn.textContent = '进入一起听';
    updatePreview();
  }

  function renderSession() {
    renderSessionHeader();
    renderSessionPlayer();
    renderChatMessages();
    renderTypingIndicator();
  }

  function renderSessionHeader() {
    var el = $('ncm-lt-session-header');
    if (!el) return;
    var ctx = getSessionContext();
    if (!ctx) {
      el.innerHTML = '';
      return;
    }
    var userInitial = profileInitial(ctx.profile);
    var roleInitial = contactInitial(ctx.contact);
    el.innerHTML =
      '<div class="lt-duo__av lt-duo__av--user">' + avatarInnerHtml('', userInitial) + '</div>' +
      '<div class="lt-duo__bond"><span>WITH</span><i>♪</i></div>' +
      '<div class="lt-duo__av lt-duo__av--role">' + avatarInnerHtml('', roleInitial) + '</div>';
    resolveProfileAvatarUrl(ctx.profile, function (url) {
      var av = el.querySelector('.lt-duo__av--user');
      if (av) setAvatarEl(av, url, userInitial);
    });
    resolveContactAvatarUrl(ctx.contact, function (url) {
      var av = el.querySelector('.lt-duo__av--role');
      if (av) setAvatarEl(av, url, roleInitial);
    });
  }

  function renderSessionPlayer() {
    var eng = musicEngine();
    if (!eng) return;
    var snap = eng.buildSnapshot();
    var titleEl = $('ncm-lt-song-title');
    var artistEl = $('ncm-lt-song-artist');
    var lyricEl = $('ncm-lt-lyric');
    var discEl = $('ncm-lt-disc');
    var discLabel = $('ncm-lt-disc-label');
    var armEl = document.querySelector('.lt-vinyl__arm');
    var playBtn = $('ncm-lt-play');
    var title = snap.title || '未在播放';
    if (titleEl) titleEl.textContent = title;
    if (artistEl) artistEl.textContent = snap.artist || '—';
    if (lyricEl) lyricEl.textContent = snap.lyricLine || (snap.title ? '暂无歌词' : '等待播放…');
    if (discEl) discEl.classList.toggle('is-paused', !snap.isPlaying);
    if (armEl) armEl.classList.toggle('is-paused', !snap.isPlaying);
    if (discLabel) discLabel.textContent = title.slice(0, 12);
    if (playBtn) {
      playBtn.innerHTML = snap.isPlaying
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    }
  }

  function togglePlayPause() {
    var eng = musicEngine();
    if (!eng) return;
    var audio = eng.getAudio(function () { onMusicTick(); });
    if (!audio || !audio.src) {
      if (session && session.currentTrackId) {
        var t = eng.getData().library.find(function (x) { return x && x.id === session.currentTrackId; });
        if (t) eng.playTrack(t, global.miyaMusicApp && global.miyaMusicApp._tickUi);
      }
      return;
    }
    if (audio.paused) audio.play().catch(function () {});
    else audio.pause();
    renderSessionPlayer();
    if (global.miyaMusicApp && global.miyaMusicApp._tickUi) global.miyaMusicApp._tickUi();
  }

  function msgAvatarHtml(isUser, ctx) {
    var url = isUser ? ctx.profileUrl : ctx.contactUrl;
    var initial = isUser ? profileInitial(ctx.profile) : contactInitial(ctx.contact);
    var cls = 'lt-msg__av lt-msg__av--' + (isUser ? 'user' : 'role');
    return '<div class="' + cls + '">' + avatarInnerHtml(url, initial) + '</div>';
  }

  function bubbleHtml(msg, ctx) {
    if (msg.role === 'system') {
      return '<div class="lt-msg lt-msg--system"><span>' + esc(msg.content) + '</span></div>';
    }
    var isUser = msg.role === 'user';
    if (isUser) {
      return (
        '<div class="lt-msg lt-msg--user">' +
        '<div class="lt-msg__text">' + esc(msg.content) + '</div>' +
        msgAvatarHtml(true, ctx) +
        '</div>'
      );
    }
    return (
      '<div class="lt-msg lt-msg--role">' +
      msgAvatarHtml(false, ctx) +
      '<div class="lt-msg__text">' + esc(msg.content) + '</div></div>'
    );
  }

  function scrollChatToBottom() {
    var wrap = document.querySelector('.lt-chat-scroll');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  function renderChatMessages() {
    var el = $('ncm-lt-chat');
    if (!el || !session) return;
    var ctx = getSessionContext();
    var msgs = session.messages || [];
    enrichContextAvatars(ctx, function (enriched) {
      el.innerHTML = msgs.map(function (m) { return bubbleHtml(m, enriched || ctx); }).join('');
      scrollChatToBottom();
    });
  }

  function renderTypingIndicator() {
    var el = $('ncm-lt-typing');
    if (!el) return;
    if (apiPending > 0) {
      el.hidden = false;
      var ctx = getSessionContext();
      enrichContextAvatars(ctx, function (enriched) {
        var avCtx = enriched || ctx || {};
        el.innerHTML =
          '<div class="lt-msg lt-msg--role">' +
          msgAvatarHtml(false, avCtx) +
          '<div class="lt-msg__typing">' +
          '<span class="lt-dot"></span><span class="lt-dot"></span><span class="lt-dot"></span>' +
          '</div></div>';
        scrollChatToBottom();
      });
    } else {
      el.hidden = true;
      el.innerHTML = '';
    }
  }

  function renderTrackPickerSheet() {
    var tracks = getPlaylistTracks(session && session.playlistId);
    if (!tracks.length) { toast('当前歌单为空'); return; }
    var body = tracks.map(function (t) {
      return (
        '<button type="button" class="lt-sheet-track" data-lt-switch="' + esc(t.id) + '">' +
        '<strong>' + esc(t.title) + '</strong>' +
        '<em>' + esc(t.artist || '') + '</em></button>'
      );
    }).join('');
    if (global.miyaMusicApp && typeof global.miyaMusicApp.openSheet === 'function') {
      global.miyaMusicApp.openSheet('换一首歌', body);
      var sheetBody = $('ncm-sheet-body');
      if (sheetBody) {
        sheetBody.querySelectorAll('[data-lt-switch]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var tid = btn.getAttribute('data-lt-switch');
            if (global.miyaMusicApp && global.miyaMusicApp.closeSheet) global.miyaMusicApp.closeSheet();
            switchTrackByUser(tid);
          });
        });
      }
    }
  }

  function onMusicTick() {
    if (!isActive()) return;
    renderSessionPlayer();
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    var root = $('ncm-lt-root');
    if (!root) return;

    root.addEventListener('error', function (e) {
      var img = e.target;
      if (!img || !img.classList || !img.classList.contains('lt-av-img')) return;
      var fb = img.getAttribute('data-lt-fallback') || '?';
      var span = document.createElement('span');
      span.className = 'lt-av-fallback';
      span.textContent = fb;
      img.replaceWith(span);
    }, true);

    root.addEventListener('click', function (e) {
      var cBtn = e.target.closest('[data-lt-contact]');
      if (cBtn) {
        lobbyState.contactId = cBtn.getAttribute('data-lt-contact');
        renderContactPicker();
        updateStartButton();
        return;
      }
      var plBtn = e.target.closest('[data-lt-pl]');
      if (plBtn) {
        lobbyState.playlistId = plBtn.getAttribute('data-lt-pl');
        lobbyState.trackId = '';
        renderPlaylistPicker();
        updateStartButton();
        return;
      }
      var trBtn = e.target.closest('[data-lt-track]');
      if (trBtn) {
        lobbyState.trackId = trBtn.getAttribute('data-lt-track');
        renderPlaylistPicker();
        updateStartButton();
        return;
      }
      var swBtn = e.target.closest('[data-lt-switch]');
      if (swBtn) {
        var tid = swBtn.getAttribute('data-lt-switch');
        if (global.miyaMusicApp && global.miyaMusicApp.closeSheet) global.miyaMusicApp.closeSheet();
        switchTrackByUser(tid);
        return;
      }
      var endBtn = e.target.closest('[data-lt-end]');
      if (endBtn) {
        promptEndSession();
        return;
      }
    });

    var startBtn = $('ncm-lt-start');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        if (!lobbyState.contactId || !lobbyState.trackId) {
          toast('请选择角色和歌曲');
          return;
        }
        startBtn.disabled = true;
        startBtn.textContent = '正在进入…';
        startSession(lobbyState.contactId, lobbyState.trackId, lobbyState.playlistId)
          .catch(function (err) {
            toast(fmtStartErr(err));
          })
          .finally(function () {
            startBtn.disabled = false;
            updateStartButton();
          });
      });
    }

    var switchBtn = $('ncm-lt-switch-song');
    if (switchBtn) {
      switchBtn.addEventListener('click', function () { renderTrackPickerSheet(); });
    }

    var playBtn = $('ncm-lt-play');
    if (playBtn) {
      playBtn.addEventListener('click', togglePlayPause);
    }

    var sendBtn = $('ncm-lt-send');
    var input = $('ncm-lt-input');
    function doSend() {
      if (!input || apiPending > 0) return;
      var t = trim(input.value);
      if (!t) return;
      input.value = '';
      sendUserMessage(t).catch(function (err) {
        if (err && err.message === 'api_not_configured') toast('请先在设置中配置 API');
        else if (err && err.message !== 'busy') toast('发送失败');
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
    loadSession();
    bindUi();
    whenSessionReady().then(function (s) {
      if (s && s.active) {
        updateTabBadge(true);
        syncShellChrome();
      }
    });
  }

  init();

  var listenTogetherApi = {
    STORAGE_KEY: STORAGE_KEY,
    whenReady: whenSessionReady,
    invalidateCache: invalidateSessionCache,
    render: renderAll,
    onMusicTick: onMusicTick,
    isActive: isActive,
    syncShellChrome: syncShellChrome,
    startSession: startSession,
    endSession: endSession,
    promptEndSession: promptEndSession,
    sendMessage: sendUserMessage,
    switchTrack: switchTrackByUser,
    formatDuration: formatDuration,
    handleClick: handleCapsuleClick,
    openArchive: openListenTogetherArchive,
    getSession: function () { loadSession(); return session; }
  };

  global.MiyaMusicListenTogether = listenTogetherApi;
  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(listenTogetherApi);
})(window);
