/**
 * miya-diary-peek.js — 角色偷看用户日记
 */
(function (global) {
  'use strict';

  function store() { return global.miyaDiaryStore || null; }
  function bridge() { return global.miyaDiaryBridge || null; }

  function chatStore() { return global.miyaChatStore || null; }

  function displayName(contact) {
    if (!contact) return 'TA';
    return String(contact.remarkName || contact.name || 'TA').trim();
  }

  function profileName(profile) {
    if (!profile) return '用户';
    return String(profile.name || '用户').trim();
  }

  function todayIsoForContact(contact) {
    var br = bridge();
    if (br && typeof br.buildDiaryContext === 'function') {
      return br.buildDiaryContext(contact).todayIso;
    }
    var st = store();
    return st && st.isoDate ? st.isoDate(new Date()) : '';
  }

  function contactBoundToProfile(contact, profileId) {
    if (!contact || !profileId) return false;
    var bound = String(contact.defaultProfileId || '').trim();
    if (bound && bound === String(profileId)) return true;
    var cs = chatStore();
    if (!cs || !contact.id) return false;
    var chats = cs.getChats ? cs.getChats('all') : [];
    return chats.some(function (ch) {
      return ch && ch.contactId === contact.id && ch.type !== 'group' &&
        String(ch.profileId || '') === String(profileId);
    });
  }

  function getPeekLog(chatId) {
    var cs = chatStore();
    if (!cs || !chatId) return [];
    var settings = cs.getChatSettings ? cs.getChatSettings(chatId) : {};
    return settings && Array.isArray(settings.diaryPeekLog) ? settings.diaryPeekLog : [];
  }

  function lastPeekedAtForDiary(log, contactId, profileId, dateIso, diaryId) {
    var latest = 0;
    (log || []).forEach(function (row) {
      if (!row) return;
      if (String(row.contactId) !== String(contactId)) return;
      if (String(row.profileId) !== String(profileId)) return;
      if (String(row.dateIso) !== String(dateIso)) return;
      var ids = Array.isArray(row.diaryIds) ? row.diaryIds : [];
      var hit = ids.some(function (id) { return String(id) === String(diaryId); });
      if (!hit) return;
      var t = Number(row.peekedAt) || 0;
      if (t > latest) latest = t;
    });
    return latest;
  }

  function filterPeekEligibleEntries(entries, log, contactId, profileId, dateIso) {
    return (entries || []).filter(function (entry) {
      if (!entry || !entry.id) return false;
      if (!String(entry.content || '').trim()) return false;
      var lastPeeked = lastPeekedAtForDiary(log, contactId, profileId, dateIso, entry.id);
      if (!lastPeeked) return true;
      var updated = Number(entry.updatedAt || entry.createdAt) || 0;
      return updated > lastPeeked;
    });
  }

  function markPeekedToday(chatId, contactId, profileId, dateIso, diaryIds) {
    var cs = chatStore();
    if (!cs || !cs.saveChatSettings || !chatId) return Promise.resolve();
    var settings = cs.getChatSettings ? cs.getChatSettings(chatId) : {};
    var log = settings && Array.isArray(settings.diaryPeekLog) ? settings.diaryPeekLog.slice() : [];
    log.push({
      contactId: String(contactId),
      profileId: String(profileId),
      dateIso: String(dateIso),
      diaryIds: Array.isArray(diaryIds) ? diaryIds.slice() : [],
      peekedAt: Date.now()
    });
    return cs.saveChatSettings(chatId, { diaryPeekLog: log });
  }

  function buildPeekContextBlock(contact, profile, entries, dateIso) {
    var maskName = profileName(profile);
    var lines = [
      '〔你偷看日记·' + dateIso + '〕',
      '【事实】方才或今日聊天前，你私自偷看了对方（面具：' + maskName + '）在 ' + dateIso + ' 写下的私人日记。',
      '【重要】下方即你从日记本里读到的原文——这是对方的日记内容，是你亲眼偷看到的，不是微信聊天消息、不是旁白、不是系统编造。',
      '对方尚不知你已看过；聊天中勿直接说「我偷看了你日记」，是否不经意提起、说漏嘴或装作不知，由你按人设决定。',
      '勿逐字复读全文，但可据此把握对方心境，在回复中自然流露你可能知道的事。',
      '',
      '〔对方日记原文·面具：' + maskName + '·' + dateIso + '〕'
    ];
    entries.forEach(function (entry, i) {
      if (!entry) return;
      var title = String(entry.title || '随笔').trim();
      var body = String(entry.content || '').trim();
      if (!body) return;
      lines.push('— 第 ' + (i + 1) + ' 篇：《' + title + '》—');
      lines.push(body);
      lines.push('');
    });
    lines.push('〔对方日记原文结束〕');
    return lines.join('\n');
  }

  function tryTriggerPeek(chatId) {
    var cs = chatStore();
    var st = store();
    if (!cs || !st || !chatId) return Promise.resolve(false);

    var chat = cs.findChat ? cs.findChat(chatId) : null;
    if (!chat || chat.type === 'group') return Promise.resolve(false);

    var contact = cs.findContact ? cs.findContact(chat.contactId) : null;
    if (!contact) return Promise.resolve(false);

    var settings = st.getDiarySettings(contact.id);
    if (!settings.peek.enabled) return Promise.resolve(false);

    var profileId = String(chat.profileId || '').trim();
    if (!profileId) return Promise.resolve(false);
    if (!contactBoundToProfile(contact, profileId)) return Promise.resolve(false);

    var profiles = cs.getProfiles ? cs.getProfiles() : [];
    var profile = profiles.find(function (p) { return p && p.id === profileId; }) || null;
    if (!profile) return Promise.resolve(false);

    var today = todayIsoForContact(contact);
    var peekLog = getPeekLog(chatId);
    var entries = filterPeekEligibleEntries(
      st.getUserDiariesForDate(profileId, today),
      peekLog,
      contact.id,
      profileId,
      today
    );
    if (!entries.length) return Promise.resolve(false);

    var chance = Number(settings.peek.chance);
    if (!(chance > 0)) return Promise.resolve(false);
    if (Math.random() * 100 >= chance) return Promise.resolve(false);

    var contextBlock = buildPeekContextBlock(contact, profile, entries, today);
    var noticeContent = displayName(contact) + '偷看了你的日记！';

    var hiddenMsg = {
      role: 'system',
      type: 'diary_peek_context',
      content: contextBlock,
      diaryPeekMeta: {
        contactId: contact.id,
        profileId: profileId,
        dateIso: today,
        diaryIds: entries.map(function (e) { return e.id; })
      }
    };

    var noticeMsg = {
      role: 'system',
      type: 'diary_peek_notice',
      content: noticeContent,
      diaryPeekMeta: hiddenMsg.diaryPeekMeta
    };

    var chain = Promise.resolve();
    if (typeof cs.addMessage === 'function') {
      chain = chain.then(function () {
        return cs.addMessage(chatId, hiddenMsg);
      }).then(function () {
        return cs.addMessage(chatId, noticeMsg);
      });
    }
    return chain.then(function () {
      return markPeekedToday(chatId, contact.id, profileId, today, hiddenMsg.diaryPeekMeta.diaryIds);
    }).then(function () {
      if (
        global.miyaChatRoom &&
        typeof global.miyaChatRoom.getOpenChatId === 'function' &&
        global.miyaChatRoom.getOpenChatId() === chatId &&
        typeof global.miyaChatRoom.refresh === 'function'
      ) {
        global.miyaChatRoom.refresh();
      }
      return true;
    });
  }

  function formatDiaryPeekContextForApi(m) {
    if (!m || m.type !== 'diary_peek_context') return '';
    return String(m.content || '').trim();
  }

  function formatDiaryPeekNoticeForApi() {
    return '';
  }

  global.miyaDiaryPeek = {
    tryTriggerPeek: tryTriggerPeek,
    buildPeekContextBlock: buildPeekContextBlock,
    formatDiaryPeekContextForApi: formatDiaryPeekContextForApi,
    formatDiaryPeekNoticeForApi: formatDiaryPeekNoticeForApi
  };
})(typeof window !== 'undefined' ? window : global);
