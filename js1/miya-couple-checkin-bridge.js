/**
 * miya-couple-checkin-bridge.js — 打卡摄像机 · 上下文拼装与 API 生成
 */
(function (global) {
  'use strict';

  function trim(s) { return String(s || '').trim(); }

  function truncateStr(s, max) {
    var t = String(s == null ? '' : s);
    var n = max || 6000;
    return t.length <= n ? t : t.slice(0, n) + '\n…(截断)';
  }

  function stripThinkingNoise(text) {
    var t = String(text || '');
    if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
      t = global.miyaChatEngine.stripThinkingForApi(t);
    }
    return t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  function sanitizeJsonText(text) {
    var t = String(text || '');
    t = t.replace(/^\uFEFF/, '');
    t = t.replace(/[\u201c\u201d\u201e\u201f]/g, '"');
    t = t.replace(/[\u2018\u2019\u201a\u201b]/g, "'");
    t = t.replace(/,\s*([}\]])/g, '$1');
    return t;
  }

  function tryParseJson(text) {
    var t = sanitizeJsonText(stripThinkingNoise(text));
    if (!t) return null;
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    var i = t.indexOf('{');
    if (i < 0) {
      var ai = t.indexOf('[');
      if (ai < 0) return null;
      try { return JSON.parse(t.slice(ai)); } catch (e0) { return null; }
    }
    var j = t.lastIndexOf('}');
    if (j <= i) {
      try { return JSON.parse(t.slice(i)); } catch (e1) { return null; }
    }
    try { return JSON.parse(t.slice(i, j + 1)); } catch (e2) {
      try { return JSON.parse(t.slice(i)); } catch (e3) { return null; }
    }
  }

  function callApi(systemHint, userContent, reqOpts, imageParts) {
    var br = global.miyaForumBridge;
    if (br && typeof br.callItineraryCompletionsRaw === 'function') {
      return br.callItineraryCompletionsRaw(systemHint, userContent, imageParts, reqOpts);
    }
    if (br && typeof br.callMainChatCompletionsRaw === 'function') {
      return br.callMainChatCompletionsRaw(systemHint, userContent, imageParts, reqOpts);
    }
    if (br && typeof br.callChatCompletionsRaw === 'function') {
      return br.callChatCompletionsRaw(systemHint, userContent, imageParts);
    }
    return Promise.reject(new Error('API 模块未加载'));
  }

  function callCommentApi(systemHint, userContent, imageParts, reqOpts) {
    var br = global.miyaForumBridge;
    reqOpts = reqOpts && typeof reqOpts === 'object' ? reqOpts : {};
    var opts = Object.assign({
      temperature: 0.88,
      preferJsonPayload: true,
      contentOnly: true,
      disableThinking: true,
      skipUniversalWorldbook: true
    }, reqOpts);
    if (imageParts && imageParts.length && br && typeof br.callMainChatCompletionsRaw === 'function') {
      return br.callMainChatCompletionsRaw(systemHint, userContent, imageParts, opts);
    }
    return callApi(systemHint, userContent, opts);
  }

  function blobIdToDataUrl(blobId) {
    var cs = global.miyaChatStore;
    var imgApi = global.MiyaChatImage;
    var key = trim(blobId);
    if (!key || !cs || typeof cs.getAvatarUrl !== 'function') {
      return Promise.resolve('');
    }
    return cs.getAvatarUrl(key).then(function (url) {
      if (!url) return '';
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error('blob_fetch_failed');
        return res.blob();
      });
    }).then(function (blob) {
      if (!blob) return '';
      if (imgApi && typeof imgApi.readBlobAsDataUrl === 'function') {
        return imgApi.readBlobAsDataUrl(blob);
      }
      return '';
    }).catch(function () { return ''; });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function isoDate(d) {
    var dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }

  function addDays(iso, n) {
    var d = new Date(String(iso || isoDate(new Date())) + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  function resolveProfileForContact(contact, chat, profileIdOverride) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var profiles = cs.getProfiles ? cs.getProfiles() : [];
    var boundId = trim(profileIdOverride);
    if (!boundId && contact && contact.defaultProfileId) {
      boundId = trim(contact.defaultProfileId);
    }
    if (!boundId && chat && chat.profileId) {
      boundId = trim(chat.profileId);
    }
    if (boundId) {
      var found = profiles.find(function (p) { return p && p.id === boundId; });
      if (found) return found;
    }
    return cs.getActiveProfile ? cs.getActiveProfile() : null;
  }

  function resolveContactContext(contact, profileIdOverride) {
    var cs = global.miyaChatStore;
    if (!contact) {
      return { contact: null, profile: null, chat: null, settings: {} };
    }
    if (cs && typeof cs.findContact === 'function' && contact.id) {
      var fresh = cs.findContact(contact.id);
      if (fresh) contact = fresh;
    }
    if (!cs) {
      return { contact: contact, profile: null, chat: null, settings: {} };
    }
    var profileId = trim(profileIdOverride || contact.defaultProfileId);
    var chat = cs.findChatByContact
      ? cs.findChatByContact(contact.id, profileId)
      : null;
    if (!chat && cs.findChatByContact) {
      chat = cs.findChatByContact(contact.id, '');
    }
    var profile = resolveProfileForContact(contact, chat, profileIdOverride);
    var settings = {};
    if (chat && chat.id && cs.getChatSettings) {
      settings = cs.getChatSettings(chat.id) || {};
    } else {
      settings = Object.assign(
        {},
        contact.chatSettings && typeof contact.chatSettings === 'object' ? contact.chatSettings : {}
      );
      if (contact.relationship) settings.relationship = contact.relationship;
    }
    return { contact: contact, profile: profile, chat: chat, settings: settings };
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = trim((contact && contact.characterId) || (contact && contact.chronicleId));
    parts.push('【角色名】' + trim(contact && contact.name || '未知'));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = trim(cts.renderChronicleBlock(roleId));
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + truncateStr(contact.persona, 1200));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function buildUserRelationBlock(contact, profile, settings) {
    var aw = global.MiyaChatAwareness;
    var eng = global.miyaChatEngine;
    var parts = [
      '【用户面具与双方关系·必读】',
      '以下是与该角色私聊时绑定的用户身份及双方关系；打卡内容须与此一致。'
    ];
    var userBlock = eng && typeof eng.renderProfileBlock === 'function'
      ? trim(eng.renderProfileBlock(profile))
      : '';
    if (userBlock) {
      parts.push(userBlock);
    } else if (profile) {
      var userLines = ['【用户身份·我方·' + trim(profile.name || '未命名') + '】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.birthday) userLines.push('- 生日: ' + profile.birthday);
      if (profile.persona) userLines.push('- 人设: ' + profile.persona);
      if (userLines.length > 1) parts.push(userLines.join('\n'));
    }
    var rel = trim((settings && settings.relationship) || (contact && contact.relationship));
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push('【双方关系】\n' + relLine);
    } else if (rel) {
      parts.push('【双方关系】\n你们当前的关系是：' + rel);
    }
    if (contact && contact.remarkName) {
      parts.push('用户对角色的备注称呼：' + trim(contact.remarkName));
    }
    return parts.join('\n\n');
  }

  function buildWorldbookBlock(contact, contextSeed) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildWorldbookBundle !== 'function' || !contact) return '';
    var seed = contextSeed || trim(contact.name) + ' 情侣空间 打卡 日常 上下班 上下课';
    var bundle = eng.buildWorldbookBundle(contact, seed, null, {
      includeAllBoundLocal: true,
      promptContext: 'general'
    });
    if (!bundle) return '';
    var text = '';
    if (typeof eng.joinWorldbookBundleText === 'function') {
      text = eng.joinWorldbookBundleText(bundle);
    } else {
      var parts = [];
      [].concat(bundle.frontLayers || [], bundle.layers || [], bundle.backLayers || []).forEach(function (layer) {
        if (layer) parts.push(layer);
      });
      text = parts.join('\n\n').trim();
    }
    return text ? '【世界书·必读】\n' + text : '';
  }

  function buildMemorySummaryBlock(settings) {
    var aw = global.MiyaChatAwareness;
    var parts = [];
    if (aw && typeof aw.buildSummaryContextBlock === 'function') {
      var sumBlock = aw.buildSummaryContextBlock(settings);
      if (sumBlock) parts.push('【记忆总结·分镜合卷】\n' + truncateStr(sumBlock, 4000));
    }
    if (settings && Array.isArray(settings.charMemoryList) && settings.charMemoryList.length) {
      var mems = settings.charMemoryList.slice(-12).map(function (m) {
        return trim(m && m.content ? m.content : m);
      }).filter(Boolean);
      if (mems.length) parts.push('【角色视角记忆】\n' + mems.join('\n\n'));
    }
    return parts.join('\n\n');
  }

  function formatMsgForContext(m, contact, profileName) {
    if (!m || m.deleted) return '';
    var body = trim(m.content);
    if (!body) return '';
    if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
      body = global.miyaChatEngine.stripThinkingForApi(body);
    }
    body = body.trim();
    if (!body) return '';
    var who = m.role === 'user'
      ? (profileName || '用户')
      : trim(contact && contact.name || '角色');
    return who + '：' + truncateStr(body, 400);
  }

  function buildChatContextBlock(contact, profile, settings, chat) {
    var cs = global.miyaChatStore;
    if (!cs || !chat || !chat.id) return '';
    var limit = settings && settings.memoryCount
      ? Math.min(500, Math.max(1, Number(settings.memoryCount) || 40))
      : 40;
    var msgs = cs.getMessages(chat.id) || [];
    var profileName = profile && profile.name ? profile.name : '用户';
    var lines = msgs
      .filter(function (m) { return m && !m.deleted && trim(m.content); })
      .slice(-limit)
      .map(function (m) { return formatMsgForContext(m, contact, profileName); })
      .filter(Boolean);
    if (!lines.length) return '';
    return [
      '【最近聊天上下文（最近 ' + limit + ' 条）】',
      '以下为与该角色的近期对话，打卡时可自然引用其中的细节与情绪，但不必逐条复述。',
      lines.join('\n')
    ].join('\n');
  }

  function buildCheckInContext(contactId) {
    var cs = global.miyaChatStore;
    var cpStore = global.miyaCoupleStore;
    if (!cs || !cpStore) return null;

    var sp = cpStore.getSpace(contactId);
    var contact = cs.findContact ? cs.findContact(contactId) : null;
    if (!contact) {
      contact = (cs.getContacts() || []).find(function (c) { return c && c.id === contactId; }) || null;
    }
    if (!contact) return null;

    var profileId = sp && sp.profileId ? sp.profileId : '';
    var ctx = resolveContactContext(contact, profileId);
    contact = ctx.contact || contact;
    var profile = ctx.profile;
    var settings = ctx.settings || {};
    var chat = ctx.chat;
    var aw = global.MiyaChatAwareness;

    var parts = [
      '【当前时间】' + new Date().toLocaleString('zh-CN', { hour12: false }),
      buildCharacterBlock(contact),
      buildUserRelationBlock(contact, profile, settings)
    ];

    if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
      var net = aw.buildChronicleRelationshipBlock(contact);
      if (net) parts.push(net);
    }

    var wb = buildWorldbookBlock(contact, '情侣空间 打卡摄像机 上下班 上下课 日常报备');
    if (wb) parts.push(wb);

    var chatBlock = buildChatContextBlock(contact, profile, settings, chat);
    if (chatBlock) {
      parts.push(chatBlock);
    } else {
      var mem = buildMemorySummaryBlock(settings);
      if (mem) parts.push('【无近期聊天·参考记忆】\n' + mem);
    }

    return {
      contact: contact,
      profile: profile,
      settings: settings,
      chat: chat,
      space: sp,
      contextText: parts.filter(Boolean).join('\n\n')
    };
  }

  var MAX_IMAGES_PER_BATCH = 2;

  var DAY_SLOTS = [
    { slot: 'morning', label: '早间打卡', period: '07:00–09:30', timeHint: '如 07:00、07:45、08:20（起床/出门/到岗）' },
    { slot: 'noon', label: '午间打卡', period: '11:30–13:30', timeHint: '如 12:05、12:30、13:10（午餐/午休）' },
    { slot: 'afternoon', label: '下午打卡', period: '14:00–17:30', timeHint: '如 14:30、16:00、17:15（工作/上课/外出）' },
    { slot: 'evening', label: '晚间打卡', period: '18:00–21:00', timeHint: '如 18:20、19:00、20:30（下班/放学/晚餐）' },
    { slot: 'night', label: '夜间打卡', period: '21:30–23:59', timeHint: '如 21:45、22:30、23:10（回家/洗漱/睡前）' }
  ];

  var SLOT_ORDER = { morning: 0, noon: 1, afternoon: 2, evening: 3, night: 4, custom: 9 };

  function isCoupleImageGenEnabled(contactId) {
    var cpStore = global.miyaCoupleStore;
    return !!(cpStore && cpStore.isImageGenEnabled && cpStore.isImageGenEnabled(contactId));
  }

  function isImageGenAvailable(contactId) {
    if (!isCoupleImageGenEnabled(contactId)) return false;
    var ig = global.MiyaImageGen;
    if (!ig) return false;
    if (typeof ig.isGlobalEnabled === 'function' && !ig.isGlobalEnabled()) return false;
    if (typeof ig.isContactEnabled === 'function' && !ig.isContactEnabled(contactId)) return false;
    return true;
  }

  function storeImageBlob(blob) {
    var cs = global.miyaChatStore;
    if (!cs || typeof cs.storeMediaBlob !== 'function') {
      return Promise.reject(new Error('存储模块未就绪'));
    }
    return cs.storeMediaBlob(blob, 'chat');
  }

  function generateCheckInImage(contactId, scenePrompt) {
    var ig = global.MiyaImageGen;
    if (!ig || typeof ig.generateImageForScene !== 'function') {
      return Promise.reject(new Error('image_gen_unavailable'));
    }
    if (!isImageGenAvailable(contactId)) {
      return Promise.reject(new Error('image_gen_disabled'));
    }
    return ig.generateImageForScene(contactId, scenePrompt, { size: '1024x1792' })
      .then(function (blob) {
        return storeImageBlob(blob);
      });
  }

  function normalizeApiEntry(raw, fallbackDate) {
    if (!raw || typeof raw !== 'object') return null;
    var slot = trim(raw.slot || raw.period || 'custom').toLowerCase();
    if (slot !== 'morning' && slot !== 'noon' && slot !== 'afternoon' && slot !== 'evening' && slot !== 'night') {
      slot = 'custom';
    }
    var caption = trim(raw.caption || raw.report || raw.title);
    var detail = trim(raw.detail || raw.text || raw.body || raw.description);
    if (!caption && !detail) return null;
    return {
      dateIso: trim(raw.dateIso || raw.date || fallbackDate),
      slot: slot,
      slotLabel: trim(raw.slotLabel || raw.label || raw.tag),
      caption: caption || detail.slice(0, 60),
      detail: detail || caption,
      mood: trim(raw.mood || raw.emotion),
      location: trim(raw.location || raw.place),
      scenePrompt: trim(raw.scenePrompt || raw.imagePrompt || raw.prompt),
      timeAt: trim(raw.timeAt || raw.time || raw.checkInTime)
    };
  }

  function buildBatchSystemPrompt() {
    return (
      '你是情侣空间「打卡摄像机」的内容策划。' +
      '须以角色第一人称视角，生成真实感强的日常打卡报备。' +
      '只输出 JSON，不要 markdown，不要思维链，首字符必须是 {。' +
      '格式：{"entries":[{"dateIso":"YYYY-MM-DD","slot":"morning|noon|afternoon|evening|night","timeAt":"07:15","slotLabel":"上班打卡","caption":"短报备20字内","detail":"详细报备80-150字","mood":"心情词","location":"地点","scenePrompt":"English image scene description or empty string"}]}。' +
      '【硬性】每条 entry 必须包含 timeAt：24 小时制 HH:mm，表示角色在该时刻打卡报备的具体钟点（如早上写 07:00、午间写 12:30、晚间写 19:15），须落在 slot 对应时段内，五条互不重复。' +
      '须生成「今天一整天」5 条打卡：slot 依次为 morning、noon、afternoon、evening、night。' +
      'caption 是发给恋人的短报备，detail 是更完整的碎碎念；scenePrompt 最多 2 条非空，其余填空字符串。' +
      '禁止提及 AI、系统、提示词；须严格贴合角色人设与用户关系。'
    );
  }

  function buildDaySlotsBlock() {
    return DAY_SLOTS.map(function (s, i) {
      return (i + 1) + '. ' + s.slot + ' · ' + s.label +
        '｜时段 ' + s.period + '｜timeAt 参考 ' + s.timeHint;
    }).join('\n');
  }

  function buildBatchUserPrompt(ctx, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var todayIso = opts.todayIso || isoDate(new Date());
    var seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 99999);
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '恋人');

    return [
      '【角色设定·用户面具·双方关系·世界书·聊天记忆·必读】',
      '生成前须完整阅读以下语境，打卡内容须严格贴合。',
      '',
      ctx.contextText,
      '',
      '【生成任务 · 打卡摄像机 · 今日全天】',
      '为角色「' + charName + '」生成「今天 ' + todayIso + '」一整天的打卡报备时间线，发给恋人「' + profileName + '」。',
      '随机种子 ' + seed + '（勿提及）。',
      '要求：',
      '- 只生成今天，dateIso 必须全部为 ' + todayIso,
      '- 恰好 5 条 entries，覆盖从早到晚完整一天，slot 不可重复：',
      buildDaySlotsBlock(),
      '- 【每条必填 timeAt】写出角色打卡报备的具体钟点（HH:mm），不是生成时间！例如 morning 可写 07:00、noon 可写 12:30、evening 可写 18:45；须符合人设作息且五条时间从早到晚递增',
      '- 若角色是社畜/上班族：morning/evening 须有上下班感；若是学生：须有上下课感；其他身份按人设安排',
      '- 每条 detail 80-150 字，有生活细节、小情绪、对恋人的报备感；各时段内容须明显不同',
      '- scenePrompt 最多 2 条非空（英文，竖版生活照/自拍），其余必须为空字符串',
      '- 只输出 JSON'
    ].join('\n');
  }

  function sortAndDedupeEntries(entries) {
    var seen = {};
    var list = (entries || []).filter(function (entry) {
      if (!entry) return false;
      var slot = entry.slot || 'custom';
      if (seen[slot]) return false;
      seen[slot] = true;
      return true;
    });
    list.sort(function (a, b) {
      var cpStore = global.miyaCoupleStore;
      var ta = cpStore && cpStore.slotToCheckInAt
        ? cpStore.slotToCheckInAt(a.dateIso, a.slot, a.timeAt)
        : 0;
      var tb = cpStore && cpStore.slotToCheckInAt
        ? cpStore.slotToCheckInAt(b.dateIso, b.slot, b.timeAt)
        : 0;
      return ta - tb;
    });
    return list;
  }

  function parseBatchEntries(text, startDate) {
    var obj = tryParseJson(text);
    var entries = [];
    if (Array.isArray(obj)) {
      entries = obj;
    } else if (obj && Array.isArray(obj.entries)) {
      entries = obj.entries;
    } else if (obj && Array.isArray(obj.checkIns)) {
      entries = obj.checkIns;
    }
    if (!entries.length) {
      throw new Error('生成格式无效');
    }
    return entries.map(function (e) {
      return normalizeApiEntry(e, startDate);
    }).filter(Boolean);
  }

  var MAX_IMAGES_PER_BATCH = 2;

  function dispatchCheckinUpdate(contactId, checkInId) {
    if (typeof global.dispatchEvent !== 'function') return;
    try {
      global.dispatchEvent(new CustomEvent('miya-couple-checkin-updated', {
        detail: { contactId: contactId, checkInId: checkInId }
      }));
    } catch (e) { /* ignore */ }
  }

  function queueBackgroundImages(contactId, checkIns) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore || !isImageGenAvailable(contactId)) return;

    var queue = (checkIns || []).filter(function (ci) {
      return ci && ci.imageGenPending && ci.scenePrompt;
    }).slice(0, MAX_IMAGES_PER_BATCH);

    queue.forEach(function (ci) {
      generateCheckInImage(contactId, ci.scenePrompt).then(function (blobId) {
        cpStore.updateCheckIn(contactId, ci.id, {
          blobId: blobId,
          imageGenPending: false,
          imageGenFailed: false
        });
        dispatchCheckinUpdate(contactId, ci.id);
      }).catch(function () {
        cpStore.updateCheckIn(contactId, ci.id, {
          imageGenPending: false,
          imageGenFailed: true
        });
        dispatchCheckinUpdate(contactId, ci.id);
      });
    });
  }

  function generateCharCheckIns(contactId, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));

    var ctx = buildCheckInContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var todayIso = cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date());
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var canImage = isImageGenAvailable(contactId);
    var imageQuota = 0;

    if (onProgress) onProgress({ phase: 'text', message: '正在生成今日报备…' });

    return callApi(buildBatchSystemPrompt(), buildBatchUserPrompt(ctx, {
      todayIso: todayIso,
      seed: opts.seed
    }), { temperature: 0.92 }).then(function (text) {
      var apiEntries = parseBatchEntries(text, todayIso).filter(function (entry) {
        return entry && entry.dateIso === todayIso;
      });
      if (!apiEntries.length) {
        apiEntries = parseBatchEntries(text, todayIso).map(function (entry) {
          if (!entry) return null;
          entry.dateIso = todayIso;
          return entry;
        }).filter(Boolean);
      }
      if (!apiEntries.length) throw new Error('未解析到有效打卡');

      apiEntries = sortAndDedupeEntries(apiEntries.map(function (entry) {
        entry.dateIso = todayIso;
        if (!entry.slotLabel) entry.slotLabel = defaultSlotLabel(entry.slot);
        return entry;
      }));

      cpStore.removeCharCheckInsForDate(contactId, todayIso);

      var saved = [];

      apiEntries.forEach(function (entry, idx) {
        var wantImage = !!(entry.scenePrompt && canImage && imageQuota < MAX_IMAGES_PER_BATCH);
        if (wantImage) imageQuota += 1;

        var checkInAt = cpStore.slotToCheckInAt
          ? cpStore.slotToCheckInAt(todayIso, entry.slot, entry.timeAt)
          : Date.now();

        var checkIn = cpStore.addCheckIn(contactId, {
          dateIso: todayIso,
          slot: entry.slot,
          slotLabel: entry.slotLabel || defaultSlotLabel(entry.slot),
          author: 'char',
          caption: entry.caption,
          detail: entry.detail,
          mood: entry.mood,
          location: entry.location,
          scenePrompt: entry.scenePrompt,
          timeAt: entry.timeAt,
          checkInAt: checkInAt,
          imageGenPending: wantImage,
          imageGenFailed: false,
          comments: [],
          createdAt: Date.now() + idx
        });
        if (checkIn) saved.push(checkIn);
      });

      queueBackgroundImages(contactId, saved);

      return { entries: saved, count: saved.length, todayIso: todayIso };
    });
  }

  function defaultSlotLabel(slot) {
    var map = {
      morning: '早间打卡',
      noon: '午间打卡',
      afternoon: '下午打卡',
      evening: '晚间打卡',
      night: '深夜打卡'
    };
    return map[slot] || '日常打卡';
  }

  function regenerateCheckInImage(contactId, checkInId) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));
    var ci = cpStore.findCheckIn(contactId, checkInId);
    if (!ci) return Promise.reject(new Error('打卡不存在'));
    if (!ci.scenePrompt) return Promise.reject(new Error('无场景描述'));

    cpStore.updateCheckIn(contactId, checkInId, {
      imageGenPending: true,
      imageGenFailed: false,
      blobId: ''
    });
    dispatchCheckinUpdate(contactId, checkInId);

    return generateCheckInImage(contactId, ci.scenePrompt).then(function (blobId) {
      cpStore.updateCheckIn(contactId, checkInId, {
        blobId: blobId,
        imageGenPending: false,
        imageGenFailed: false
      });
      dispatchCheckinUpdate(contactId, checkInId);
      return blobId;
    }).catch(function (err) {
      cpStore.updateCheckIn(contactId, checkInId, {
        imageGenPending: false,
        imageGenFailed: true
      });
      dispatchCheckinUpdate(contactId, checkInId);
      throw err;
    });
  }

  function getCheckInBlobIds(ci) {
    var cpStore = global.miyaCoupleStore;
    if (cpStore && typeof cpStore.getCheckInBlobIds === 'function') {
      return cpStore.getCheckInBlobIds(ci);
    }
    var ids = [];
    if (ci && Array.isArray(ci.blobIds)) {
      ci.blobIds.forEach(function (id) {
        var k = trim(id);
        if (k && ids.indexOf(k) < 0) ids.push(k);
      });
    }
    var single = trim(ci && ci.blobId);
    if (single && ids.indexOf(single) < 0) ids.unshift(single);
    return ids.slice(0, 9);
  }

  function buildCheckInImageBundle(ci) {
    var blobIds = getCheckInBlobIds(ci);
    if (!blobIds.length) {
      return Promise.resolve({ textBlock: '', imageParts: [], attachedRealImages: 0 });
    }
    var textLines = [];
    var imageParts = [];
    var attached = 0;
    var chain = Promise.resolve();
    blobIds.forEach(function (blobId, idx) {
      chain = chain.then(function () {
        textLines.push(
          '配图' + (idx + 1) + '（真实图片）：见下方附件，请仔细观看后再评论'
        );
        return blobIdToDataUrl(blobId).then(function (dataUrl) {
          if (dataUrl && /^data:image\//i.test(dataUrl)) {
            imageParts.push({ type: 'image_url', image_url: { url: dataUrl } });
            attached += 1;
          }
        });
      });
    });
    return chain.then(function () {
      return {
        textBlock: textLines.length ? ('【打卡配图】\n' + textLines.join('\n')) : '',
        imageParts: imageParts,
        attachedRealImages: attached
      };
    });
  }

  function storeImageFiles(files) {
    var list = Array.isArray(files) ? files.slice(0, 9) : [];
    if (!list.length) return Promise.resolve([]);
    var cs = global.miyaChatStore;
    var imgApi = global.MiyaChatImage;
    if (!cs || typeof cs.storeMediaBlob !== 'function') {
      return Promise.reject(new Error('存储模块未就绪'));
    }
    return Promise.all(list.map(function (file) {
      if (!file) return Promise.resolve('');
      var blobP = Promise.resolve(file);
      if (imgApi && typeof imgApi.compressImageFileToBlob === 'function') {
        blobP = imgApi.compressImageFileToBlob(file).catch(function () {
          return file instanceof Blob ? file : null;
        });
      }
      return blobP.then(function (blob) {
        if (!blob || typeof blob.size !== 'number') return '';
        return cs.storeMediaBlob(blob, 'chat');
      });
    })).then(function (ids) {
      ids = ids.filter(function (id) { return !!trim(id); });
      if (list.length && !ids.length) {
        return Promise.reject(new Error('图片保存失败，请重试'));
      }
      return ids;
    });
  }

  function createUserCheckIn(contactId, draft, opts) {
    draft = draft && typeof draft === 'object' ? draft : {};
    opts = opts && typeof opts === 'object' ? opts : {};
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));

    var caption = trim(draft.caption);
    var detail = trim(draft.detail || draft.text || draft.body);
    var mood = trim(draft.mood);
    var location = trim(draft.location);
    var files = Array.isArray(draft.files) ? draft.files : [];

    if (!caption && !detail && !files.length) {
      return Promise.reject(new Error('请填写报备内容或添加图片'));
    }

    var slotHint = cpStore.getCurrentSlotHint ? cpStore.getCurrentSlotHint() : { slot: 'custom', label: '日常打卡' };
    var todayIso = cpStore.isoToday ? cpStore.isoToday() : isoDate(new Date());
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

    if (onProgress) onProgress({ phase: 'save', message: '保存打卡…' });

    return storeImageFiles(files).then(function (blobIds) {
      var now = Date.now();
      var checkIn = cpStore.addCheckIn(contactId, {
        dateIso: todayIso,
        slot: trim(draft.slot) || slotHint.slot,
        slotLabel: trim(draft.slotLabel) || slotHint.label,
        author: 'user',
        caption: caption || detail.slice(0, 60) || '打卡报备',
        detail: detail || caption,
        mood: mood,
        location: location,
        blobIds: blobIds,
        blobId: blobIds[0] || '',
        timeAt: pad(new Date(now).getHours()) + ':' + pad(new Date(now).getMinutes()),
        checkInAt: now,
        comments: [],
        createdAt: now
      });
      if (!checkIn) throw new Error('保存失败');
      return { checkIn: checkIn };
    }).then(function (result) {
      if (onProgress) onProgress({ phase: 'comment', message: '等待角色回应…' });
      return requestCharCommentOnCheckIn(contactId, result.checkIn.id, 'user_post').then(function (comment) {
        return Object.assign({}, result, { charComment: comment });
      }).catch(function (err) {
        return Object.assign({}, result, {
          charComment: null,
          commentError: err && err.message ? err.message : '角色回应失败'
        });
      });
    });
  }

  var COUPLE_CHECKIN_SCENE =
    '【场景】这是在情侣空间「打卡摄像机」里的恋人日常报备——对方在此向你报备近况/留言互动，不是私聊也不是朋友圈；你须明确意识到这是在情侣空间里收到的报备。';

  function buildCommentSystemPrompt(roleName) {
    return (
      '你是「' + roleName + '」。恋人在情侣空间「打卡摄像机」中向你日常报备并互动。' +
      COUPLE_CHECKIN_SCENE +
      '须以角色口吻、中文、1-3 句话回复，甜蜜自然，贴合人设与关系。' +
      '只输出 JSON：{"text":"回复内容"}。不要 markdown，首字符必须是 {。'
    );
  }

  function requestCharCommentOnCheckIn(contactId, checkInId, mode) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));

    var ctx = buildCheckInContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var ci = cpStore.findCheckIn(contactId, checkInId);
    if (!ci) return Promise.reject(new Error('打卡不存在'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '恋人');
    var isUserPost = mode === 'user_post' || ci.author === 'user';
    var userComment = mode && typeof mode === 'object' ? trim(mode.text) : '';

    var taskLines = [];
    if (isUserPost && !userComment) {
      taskLines = [
        '【任务】恋人「' + profileName + '」刚刚在情侣空间向你发了一条打卡报备，请作为「' + charName + '」评论/回应。',
        COUPLE_CHECKIN_SCENE,
        '打卡标签：' + (ci.slotLabel || ci.slot),
        '短报备：' + ci.caption,
        '详细：' + ci.detail
      ];
    } else {
      var checkInFrom = ci.author === 'user'
        ? '恋人「' + profileName + '」在自己发布的情侣空间打卡下留言了'
        : '恋人「' + profileName + '」在你（' + charName + '）的情侣空间打卡下留言了';
      taskLines = [
        '【任务】' + checkInFrom + '，请作为「' + charName + '」回复。',
        COUPLE_CHECKIN_SCENE,
        '原打卡：' + ci.caption + ' — ' + ci.detail,
        '用户评论：' + userComment
      ];
      var prevComments = (ci.comments || []).slice(-4).map(function (c) {
        return (c.author === 'user' ? profileName : charName) + '：' + c.text;
      }).join('\n');
      if (prevComments) taskLines.push('此前评论：\n' + prevComments);
    }

    return buildCheckInImageBundle(ci).then(function (mediaBundle) {
      var blobIds = getCheckInBlobIds(ci);
      if (blobIds.length && !mediaBundle.attachedRealImages) {
        return Promise.reject(new Error('配图读取失败，无法识图'));
      }
      if (mediaBundle.textBlock) taskLines.push(mediaBundle.textBlock);
      if (mediaBundle.attachedRealImages > 0) {
        taskLines.push(
          '【真实配图 · 必读】上方附件为用户上传的真实打卡照片。' +
          '请先仔细观看每一张图片，理解画面内容后再生成评论；评论须自然体现对图片内容的感知（如场景、物品、氛围等）。' +
          '识图与评论须在同一次输出中完成，不要忽略配图。'
        );
      } else if (ci.visionNote) {
        taskLines.push('照片识图：' + ci.visionNote);
      }

      var userPrompt = [
        ctx.contextText,
        '',
        taskLines.join('\n'),
        '',
        '只输出 JSON'
      ].join('\n');

      return callCommentApi(
        buildCommentSystemPrompt(charName),
        userPrompt,
        mediaBundle.imageParts.length ? mediaBundle.imageParts : undefined
      ).then(function (text) {
        var obj = tryParseJson(text) || {};
        var reply = trim(obj.text || obj.reply || obj.comment || obj.content);
        if (!reply) {
          var cleaned = stripThinkingNoise(text);
          if (cleaned && cleaned.length < 200 && cleaned.indexOf('{') < 0) reply = cleaned;
        }
        if (!reply) throw new Error('角色回复为空');
        return cpStore.addCheckInComment(contactId, checkInId, {
          author: 'char',
          text: reply,
          createdAt: Date.now()
        });
      });
    });
  }

  function addUserComment(contactId, checkInId, text) {
    var cpStore = global.miyaCoupleStore;
    if (!cpStore) return Promise.reject(new Error('存储模块未就绪'));
    var comment = cpStore.addCheckInComment(contactId, checkInId, {
      author: 'user',
      text: trim(text),
      createdAt: Date.now()
    });
    if (!comment) return Promise.reject(new Error('评论为空'));
    return requestCharCommentOnCheckIn(contactId, checkInId, { text: comment.text }).then(function (reply) {
      return { userComment: comment, charReply: reply };
    });
  }

  global.miyaCoupleCheckinBridge = {
    buildCheckInContext: buildCheckInContext,
    generateCharCheckIns: generateCharCheckIns,
    regenerateCheckInImage: regenerateCheckInImage,
    createUserCheckIn: createUserCheckIn,
    addUserComment: addUserComment,
    requestCharCommentOnCheckIn: requestCharCommentOnCheckIn,
    isImageGenAvailable: isImageGenAvailable,
    isCoupleImageGenEnabled: isCoupleImageGenEnabled,
    DAY_SLOTS: DAY_SLOTS,
    isoDate: isoDate,
    addDays: addDays
  };
})(typeof window !== 'undefined' ? window : global);
