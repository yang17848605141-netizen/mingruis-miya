/**
 * miya-itinerary-bridge.js — 行程轨迹 API 生成与上下文拼装
 */
(function (global) {
  'use strict';

  function stripThinkingNoise(text) {
    var t = String(text || '');
    if (!t) return '';
    if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
      t = global.miyaChatEngine.stripThinkingForApi(t);
    }
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return t.trim();
  }

  function sanitizeJsonText(text) {
    var t = String(text || '');
    t = t.replace(/^\uFEFF/, '');
    t = t.replace(/[\u201c\u201d\u201e\u201f]/g, '"');
    t = t.replace(/[\u2018\u2019\u201a\u201b]/g, "'");
    t = t.replace(/,\s*([}\]])/g, '$1');
    return t;
  }

  function repairJsonClosure(text) {
    var t = sanitizeJsonText(String(text || ''));
    var i = t.indexOf('{');
    if (i < 0) {
      var ai = t.indexOf('[');
      if (ai < 0) return t;
      t = t.slice(ai);
    } else {
      t = t.slice(i);
    }
    var stack = [];
    var inStr = false;
    var esc = false;
    var out = '';
    var c;
    for (c = 0; c < t.length; c++) {
      var ch = t.charAt(c);
      out += ch;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') {
        if (stack.length) stack.pop();
      }
    }
    while (stack.length) {
      var open = stack.pop();
      out += open === '{' ? '}' : ']';
    }
    return out;
  }

  function tryParseJsonSlice(text, startChar, endChar) {
    var t = sanitizeJsonText(text);
    var i = t.indexOf(startChar);
    if (i < 0) return null;
    var j = t.lastIndexOf(endChar);
    if (j <= i) {
      t = repairJsonClosure(t.slice(i));
      try {
        return JSON.parse(t);
      } catch (e0) {
        return null;
      }
    }
    var c;
    for (c = j; c >= i; c--) {
      if (t.charAt(c) !== endChar) continue;
      try {
        return JSON.parse(t.slice(i, c + 1));
      } catch (e1) {
        try {
          return JSON.parse(repairJsonClosure(t.slice(i, c + 1)));
        } catch (e2) { /* try shorter */ }
      }
    }
    try {
      return JSON.parse(repairJsonClosure(t.slice(i)));
    } catch (e3) {
      return null;
    }
  }

  function extractDaysArrayFromLooseText(text) {
    var t = sanitizeJsonText(stripThinkingNoise(text));
    if (!t) return null;
    var marker = t.match(/"days"\s*:\s*\[/);
    if (!marker) return null;
    var start = t.indexOf('[', marker.index);
    if (start < 0) return null;
    var depth = 0;
    var inStr = false;
    var esc = false;
    var end = -1;
    var c;
    for (c = start; c < t.length; c++) {
      var ch = t.charAt(c);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          end = c;
          break;
        }
      }
    }
    var slice = end > start ? t.slice(start, end + 1) : repairJsonClosure(t.slice(start));
    var arr = tryParseJsonSlice(slice, '[', ']');
    return Array.isArray(arr) ? arr : null;
  }

  function parseJsonPayload(text) {
    var t = sanitizeJsonText(stripThinkingNoise(text));
    if (!t) return null;
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    var obj = tryParseJsonSlice(t, '{', '}');
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
    var arr = tryParseJsonSlice(t, '[', ']');
    if (Array.isArray(arr) && arr.length) return { weekTheme: '', days: arr };
    var looseDays = extractDaysArrayFromLooseText(t);
    if (looseDays && looseDays.length) {
      var themeMatch = t.match(/"weekTheme"\s*:\s*"([^"]*)"/);
      return { weekTheme: themeMatch ? themeMatch[1] : '', days: looseDays };
    }
    return null;
  }

  function extractJsonObject(text) {
    return parseJsonPayload(stripThinkingNoise(text));
  }


  function coerceDaysArray(val) {
    if (Array.isArray(val)) return val;
    if (!val || typeof val !== 'object') return null;
    return Object.keys(val).sort(function (a, b) {
      var na = parseInt(a, 10);
      var nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    }).map(function (k) { return val[k]; }).filter(function (d) {
      return d && typeof d === 'object';
    });
  }

  function expandSimpleSlot(item) {
    if (!item) return null;
    if (typeof item === 'object' && !Array.isArray(item)) return item;
    if (!Array.isArray(item)) return null;
    var timeRaw = String(item[0] || '').trim();
    var start = '';
    var end = '';
    var tm = timeRaw.match(/^(\d{1,2}:\d{2})\s*[-–—~到]\s*(\d{1,2}:\d{2})$/);
    if (tm) {
      start = tm[1];
      end = tm[2];
    } else {
      var parts = timeRaw.split(/\s*[-–—~]\s*/);
      start = parts[0] || '';
      end = parts[1] || '';
    }
    var location = String(item[1] || '').trim();
    var activity = String(item[2] || item[1] || '').trim();
    var detail = String(item[3] || '').trim();
    var mood = String(item[4] || '').trim();
    if (!start && !activity && !location) return null;
    return {
      timeStart: start,
      timeEnd: end,
      title: activity,
      location: location,
      activity: activity,
      detail: detail,
      mood: mood,
      involvesUser: false,
      innerNote: ''
    };
  }

  function expandSimpleDay(day) {
    if (!day || typeof day !== 'object' || Array.isArray(day)) return day;
    var slotsRaw = day.slots || day.s || day.items;
    if (!Array.isArray(slotsRaw)) return day;
    var slots = slotsRaw.map(expandSimpleSlot).filter(Boolean);
    if (!slots.length) return null;
    return {
      weekday: String(day.weekday || day.wd || day.d || '').trim(),
      dayMood: String(day.dayMood || day.mood || '').trim(),
      dayTheme: String(day.dayTheme || day.theme || '').trim(),
      slots: slots
    };
  }

  function coerceSchedulePayload(obj) {
    if (!obj) return null;
    if (Array.isArray(obj)) {
      var expandedDays = obj.map(expandSimpleDay).filter(Boolean);
      return expandedDays.length ? { weekTheme: '', days: expandedDays } : null;
    }
    if (typeof obj !== 'object') return null;
    var days = obj.days;
    if (!Array.isArray(days)) {
      var nested = obj.schedule || obj.itinerary || obj.plan || obj.data || obj.result;
      if (nested && typeof nested === 'object') {
        if (Array.isArray(nested.days)) {
          return coerceSchedulePayload({
            weekTheme: nested.weekTheme || obj.weekTheme || obj.theme,
            days: nested.days
          });
        }
        if (Array.isArray(nested)) {
          return coerceSchedulePayload({ weekTheme: obj.weekTheme || obj.theme, days: nested });
        }
      }
      days = coerceDaysArray(obj.days);
    }
    if (!Array.isArray(days) || !days.length) return null;
    var normDays = days.map(expandSimpleDay).filter(Boolean);
    if (!normDays.length) return null;
    return {
      weekTheme: String(obj.weekTheme || obj.theme || '').trim(),
      days: normDays
    };
  }

  function parseScheduleFromApiText(text) {
    var cleaned = stripThinkingNoise(text);
    if (!cleaned) return null;
    var obj = parseJsonPayload(cleaned);
    if (!obj && global.miyaForumBridge && typeof global.miyaForumBridge.extractJsonObject === 'function') {
      obj = global.miyaForumBridge.extractJsonObject(cleaned);
    }
    if (!obj) {
      var loose = extractDaysArrayFromLooseText(cleaned);
      if (loose && loose.length) obj = { weekTheme: '', days: loose };
    }
    return obj ? coerceSchedulePayload(obj) : null;
  }

  function weekdayLabelForIndex(dayIndex, weekStartIso) {
    var store = global.miyaItineraryStore;
    var WD = store && store.WD_ZH ? store.WD_ZH : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var start = store && store.parseIso ? store.parseIso(weekStartIso) : null;
    var dayDate = start ? new Date(start) : new Date();
    if (start) dayDate.setDate(dayDate.getDate() + dayIndex);
    return WD[dayDate.getDay()] || ('第' + (dayIndex + 1) + '天');
  }

  function makePlaceholderDay(dayIndex, weekStartIso, prevDay) {
    var mood = prevDay && prevDay.dayMood ? prevDay.dayMood : '日常';
    return {
      weekday: weekdayLabelForIndex(dayIndex, weekStartIso),
      dayMood: mood,
      dayTheme: (prevDay && prevDay.dayTheme) || '日常安排',
      slots: [
        {
          timeStart: '07:00', timeEnd: '09:00', period: 'morning',
          title: '晨间日常', location: '住处', activity: '起床洗漱',
          detail: '简单的早晨例行安排', mood: '平静', involvesUser: false, innerNote: ''
        },
        {
          timeStart: '12:00', timeEnd: '13:30', period: 'noon',
          title: '午餐', location: '住处或附近', activity: '用餐休息',
          detail: '准备或享用午餐', mood: '放松', involvesUser: false, innerNote: ''
        },
        {
          timeStart: '18:00', timeEnd: '21:00', period: 'evening',
          title: '晚间活动', location: '日常场所', activity: '自由活动',
          detail: '处理私事或放松', mood: '平淡', involvesUser: false, innerNote: ''
        },
        {
          timeStart: '23:00', timeEnd: '07:00', period: 'night',
          title: '睡眠', location: '卧室', activity: '休息入睡',
          detail: '结束一天入睡休息', mood: '困倦', involvesUser: false, innerNote: ''
        }
      ]
    };
  }

  function padDaysToCount(days, expectedCount, weekStartIso) {
    var list = Array.isArray(days) ? days.slice() : [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (!list[i] || typeof list[i] !== 'object') {
        list[i] = makePlaceholderDay(i, weekStartIso, list[i - 1]);
      } else if (!Array.isArray(list[i].slots) || !list[i].slots.length) {
        var ph = makePlaceholderDay(i, weekStartIso, list[i - 1]);
        list[i] = Object.assign({}, ph, list[i], { slots: ph.slots });
      }
    }
    while (list.length < expectedCount) {
      list.push(makePlaceholderDay(list.length, weekStartIso, list[list.length - 1]));
    }
    return list.slice(0, expectedCount);
  }

  function truncateStr(s, max) {
    var t = String(s == null ? '' : s);
    var n = max || 6000;
    return t.length <= n ? t : t.slice(0, n) + '\n…(截断)';
  }

  function callApi(systemHint, userContent, reqOpts) {
    var br = global.miyaForumBridge;
    if (br && typeof br.callItineraryCompletionsRaw === 'function') {
      return br.callItineraryCompletionsRaw(systemHint, userContent, undefined, reqOpts);
    }
    if (br && typeof br.callChatCompletionsRaw === 'function') {
      return br.callChatCompletionsRaw(systemHint, userContent);
    }
    return Promise.reject(new Error('API 模块未加载'));
  }

  /** 与线下/约会一致：优先联系人绑定的 defaultProfileId，再回退会话面具 */
  function resolveProfileForContact(contact, chat) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var profiles = cs.getProfiles ? cs.getProfiles() : [];
    var boundId = '';
    if (contact && contact.defaultProfileId) {
      boundId = String(contact.defaultProfileId).trim();
    }
    if (!boundId && chat && chat.profileId) {
      boundId = String(chat.profileId).trim();
    }
    if (boundId) {
      var found = profiles.find(function (p) { return p && p.id === boundId; });
      if (found) return found;
    }
    return cs.getActiveProfile ? cs.getActiveProfile() : null;
  }

  function resolveContactContext(contact) {
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
    var profileId = String(contact.defaultProfileId || '').trim();
    var chat = cs.findChatByContact
      ? cs.findChatByContact(contact.id, profileId)
      : null;
    if (!chat && cs.findChatByContact) {
      chat = cs.findChatByContact(contact.id, '');
    }
    var profile = resolveProfileForContact(contact, chat);
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

  function getProfileForContact(contact) {
    return resolveContactContext(contact).profile;
  }

  function buildUserRelationBlock(contact, profile, settings) {
    var aw = global.MiyaChatAwareness;
    var eng = global.miyaChatEngine;
    var parts = [
      '【用户面具与双方关系·必读】',
      '以下是与该角色私聊时绑定的用户身份及双方关系；行程中若涉及用户，须与此一致。'
    ];
    var userBlock = eng && typeof eng.renderProfileBlock === 'function'
      ? String(eng.renderProfileBlock(profile) || '').trim()
      : '';
    if (userBlock) {
      parts.push(userBlock);
    } else if (profile) {
      var userLines = ['【用户身份·我方·' + String(profile.name || '未命名') + '】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.birthday) userLines.push('- 生日: ' + profile.birthday);
      if (profile.persona) userLines.push('- 人设: ' + profile.persona);
      if (userLines.length > 1) parts.push(userLines.join('\n'));
    } else {
      parts.push('（未找到绑定的用户面具）');
    }
    var rel = String(
      (settings && settings.relationship) || (contact && contact.relationship) || ''
    ).trim();
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push('【双方关系】\n' + relLine);
    } else if (rel) {
      parts.push('【双方关系】\n你们当前的关系是：' + rel);
    }
    if (contact && contact.remarkName) {
      parts.push('用户对角色的备注称呼：' + String(contact.remarkName).trim());
    }
    return parts.join('\n\n');
  }

  function buildWorldbookBlock(contact) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildWorldbookBundle !== 'function' || !contact) return '';
    var contextSeed = String(contact.name || '') + ' 行程 一周 日常 作息';
    var bundle = eng.buildWorldbookBundle(contact, contextSeed, null, {
      includeAllBoundLocal: true,
      promptContext: ''
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

  /** 行程生成语境：档案人设 + 用户面具/关系 + 世界书 */
  function buildScheduleContext(contact, profile) {
    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    profile = profile || ctx.profile;
    var settings = ctx.settings || {};
    var cts = global.miyaContactsStore;
    var aw = global.MiyaChatAwareness;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();

    parts.push('【角色名】' + String(contact && contact.name || '未知'));

    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = String(cts.renderChronicleBlock(roleId) || '').trim();
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + truncateStr(contact.persona, 800));
    }
    if (!roleId && !(contact && contact.persona)) {
      parts.push('（警告：未找到角色档案，请检查是否已绑定通讯录角色）');
    }

    parts.push(buildUserRelationBlock(contact, profile, settings));

    if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
      var net = aw.buildChronicleRelationshipBlock(contact);
      if (net) parts.push(net);
    }

    var wb = buildWorldbookBlock(contact);
    if (wb) parts.push(wb);

    return parts.filter(Boolean).join('\n\n');
  }

  /** @deprecated 保留兼容，行程生成请用 buildScheduleContext */
  function buildLiteContext(contact, profile) {
    return buildScheduleContext(contact, profile);
  }

  function buildFullContext(contact, profile) {
    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    profile = profile || ctx.profile;
    var settings = ctx.settings || {};
    var cts = global.miyaContactsStore;
    var aw = global.MiyaChatAwareness;
    var cstore = global.miyaCstoreBridge;
    var parts = [];
    var usedCstore = false;

    if (cstore && typeof cstore.buildContactContext === 'function') {
      parts.push(cstore.buildContactContext(contact, profile));
      usedCstore = true;
    } else {
      parts.push('【目标角色】' + String(contact && contact.name || '未知'));
      if (contact && contact.persona) parts.push('人设：' + truncateStr(contact.persona, 600));
      var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();
      if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
        var ch = String(cts.renderChronicleBlock(roleId) || '').trim();
        if (ch) parts.push(ch);
      }
    }

    var wb = buildWorldbookBlock(contact);
    if (wb) parts.push(wb);

    if (aw && typeof aw.buildSummaryContextBlock === 'function') {
      var sumBlock = aw.buildSummaryContextBlock(settings);
      if (sumBlock) parts.push('【上下文记忆·分镜合卷】\n' + truncateStr(sumBlock, 2000));
    }

    if (!usedCstore && settings.charMemoryList && settings.charMemoryList.length) {
      var mems = settings.charMemoryList.slice(-8).map(function (m) {
        return String(m && m.content ? m.content : m).trim();
      }).filter(Boolean);
      if (mems.length) parts.push('【角色视角记忆】\n' + mems.join('\n\n'));
    }

    if (profile && !usedCstore) {
      parts.push('【用户面具（与角色对话时的身份）】');
      parts.push('名称：' + String(profile.name || '用户'));
      if (profile.persona) parts.push('人设：' + truncateStr(profile.persona, 400));
      if (profile.gender) parts.push('性别：' + profile.gender);
    } else if (profile && profile.gender) {
      parts.push('用户性别：' + profile.gender);
    }

    return parts.filter(Boolean).join('\n\n');
  }

  function getRoleTzForContact(contact, profile) {
    var ctx = resolveContactContext(contact);
    if (!profile) profile = ctx.profile;
    return resolveRoleTz(ctx.settings || {});
  }

  function buildWeekTimeBlock(weekStartIso, roleTz) {
    var store = global.miyaItineraryStore;
    var WD = store && store.WD_ZH ? store.WD_ZH : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var start = store && store.parseIso ? store.parseIso(weekStartIso) : null;
    if (!start) return '';
    var aw = global.MiyaChatAwareness;
    var lines = [
      '【本周时间】内化以下日期即可，在每日 theme 与细节中自然体现，勿单独解释：'
    ];
    if (roleTz) lines.push('角色时区：' + roleTz);
    var i;
    for (i = 0; i < 7; i++) {
      var d = new Date(start);
      d.setDate(d.getDate() + i);
      var ts = d.getTime();
      var wd = WD[d.getDay()] || '';
      var md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
      var label = wd + '，' + md;
      if (aw && typeof aw.formatDateWeekForTz === 'function' && roleTz) {
        label = aw.formatDateWeekForTz(ts, roleTz);
      }
      lines.push('第' + (i + 1) + '天 ' + label);
    }
    return lines.join('\n');
  }

  var NO_THINKING_RULE = '禁止思维链或解释，首字符必须是 {。';

  /** 紧凑格式：slot 为 5 元组 [时段, 地点, 活动, 细节, 情绪] */
  function buildSystemPrompt() {
    return (
      '你是行程策划。' + NO_THINKING_RULE +
      '生成前须完整阅读用户消息中的【角色档案】【用户面具】【双方关系】与【世界书】，日程须严格贴合设定。' +
      '只输出 JSON，不要 markdown。' +
      '格式：{"weekTheme":"本周氛围","days":[' +
      '{"wd":"周一","mood":"基调","theme":"日主题","slots":[' +
      '["07:00-07:35","地点","洗漱","30-50字细节","情绪"],' +
      '["07:35-08:20","地点","早餐","30-50字细节","情绪"],' +
      '["09:00-10:30","地点","工作/学习","30-50字细节","情绪"]]}]}' +
      '。必须恰好 7 天；每天 10-14 个 slots（含睡眠）；' +
      'slots 每项固定 5 个字符串：[开始-结束时间, 地点, 活动, 细节, 情绪]；细节须 30-50 字。' +
      '【时段细分】每段只写一件具体事，时长须符合常理：三餐各约 0.5-1 小时，洗漱/通勤/休息等单独成段；禁止把数小时笼统标成同一活动（如 08:00-12:00 全是「吃饭」）。' +
      '【时段安排】从起床到入睡（含睡眠）应有覆盖，但时段之间允许留空、不必强行填满全天。' +
      '日程须体现当天星期与日期的时间感；尽量不要生成莫须有的事件，主要围绕自身展开。'
    );
  }

  function buildUserPrompt(contact, profile, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var store = global.miyaItineraryStore;
    var weekStart = opts.weekStart || (store && store.isoDate ? store.isoDate(new Date()) : '');
    var seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 99999);
    var ctx = buildScheduleContext(contact, profile);
    var roleTz = opts.roleTz || getRoleTzForContact(contact, profile);
    var timeBlock = buildWeekTimeBlock(weekStart, roleTz);
    return [
      '【角色设定·用户关系·世界书·必读】',
      '以下为角色档案、绑定的用户面具、双方关系与世界书；生成每一天行程时均须内化，地点、活动、细节、情绪与之契合。',
      '',
      ctx,
      '',
      '【生成任务】',
      '为角色「' + String(contact && contact.name || '未知') + '」生成从 ' + weekStart + ' 起连续 7 天私人行程。',
      '随机种子 ' + seed + '（勿提及）。',
      '内容须贴合上文角色设定；7 天、每天 10-14 个时段不可少，每段细节 30-50 字。',
      '时段要细：三餐各约半小时到一小时，洗漱、通勤、摸鱼、休息等分开写；一段只做一件事，勿用大段模糊时段统称同一活动。',
      '从起床到入睡（含睡眠）应有安排，但中间可以留空，不必强行排满每一分钟。',
      '尽量不要生成莫须有的事件，主要围绕自身展开。',
      '',
      timeBlock,
      '',
      '只输出 JSON。'
    ].join('\n');
  }

  function parseChunkFromApiText(text, expectedCount, weekStartIso) {
    var raw = String(text || '').trim();
    if (!raw) {
      throw new Error('API 返回为空');
    }
    var obj = parseScheduleFromApiText(raw);
    if (!obj || !Array.isArray(obj.days) || !obj.days.length) {
      var preview = raw.slice(0, 120).replace(/\s+/g, ' ');
      throw new Error('生成格式无效' + (preview ? '：' + preview : ''));
    }
    var minAccept = Math.max(1, Math.ceil(Number(expectedCount) * 0.6));
    if (obj.days.length < minAccept) {
      throw new Error('生成天数不足（' + obj.days.length + '/' + expectedCount + '）');
    }
    return {
      weekTheme: String(obj.weekTheme || '').trim(),
      days: padDaysToCount(obj.days, expectedCount, weekStartIso)
    };
  }

  function finalizeMergedSchedule(part1, part2, contact, weekStart, seed) {
    var schedule = {
      contactId: contact.id,
      characterName: String(contact.name || '').trim(),
      weekStart: weekStart,
      weekTheme: (part1 && part1.weekTheme) || (part2 && part2.weekTheme) || '',
      generatedAt: Date.now(),
      seed: seed,
      days: (part1 && part1.days ? part1.days : []).concat(part2 && part2.days ? part2.days : [])
    };
    var store = global.miyaItineraryStore;
    if (store && typeof store.normalizeSchedule === 'function') {
      var norm = store.normalizeSchedule(schedule, contact.id);
      if (!norm) throw new Error('行程校验失败');
      if (typeof store.clearGenerateFail === 'function') store.clearGenerateFail(contact.id);
      return norm;
    }
    return schedule;
  }

  function generateWeekSchedule(contact, profile, opts) {
    if (!contact) return Promise.reject(new Error('缺少角色'));
    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    profile = profile || ctx.profile;
    opts = opts && typeof opts === 'object' ? opts : {};
    var store = global.miyaItineraryStore;
    var weekStart = opts.weekStart || (store && store.isoDate
      ? store.isoDate((function () { var d = new Date(); d.setHours(0, 0, 0, 0); return d; })())
      : '');
    var seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 99999);
    var systemPrompt = buildSystemPrompt();
    var userPrompt = buildUserPrompt(contact, profile, {
      weekStart: weekStart,
      seed: seed
    });

    return callApi(systemPrompt, userPrompt, {
      max_tokens: 16384,
      timeoutMs: 180000,
      temperature: 0.85
    }).then(function (text) {
      var part = parseChunkFromApiText(text, 7, weekStart);
      return finalizeMergedSchedule(part, null, contact, weekStart, seed);
    });
  }

  function formatSlotForChat(slice) {
    if (!slice || !slice.slot) return '';
    var slot = slice.slot;
    var day = slice.day;
    var lines = [];
    lines.push('时段：' + String(slot.timeStart || '') + ' — ' + String(slot.timeEnd || ''));
    if (slot.title) lines.push('标题：' + slot.title);
    if (slot.location) lines.push('地点：' + slot.location);
    if (slot.activity) lines.push('活动：' + slot.activity);
    if (slot.detail) lines.push('细节：' + truncateStr(slot.detail, 400));
    if (slot.mood) lines.push('情绪：' + slot.mood);
    if (slot.involvesUser) lines.push('（本时段与用户有关）');
    if (slot.innerNote) lines.push('内心：' + truncateStr(slot.innerNote, 200));
    if (day && day.dayMood) lines.push('今日基调：' + day.dayMood);
    if (day && day.dayTheme) lines.push('今日主题：' + day.dayTheme);
    return lines.join('\n');
  }

  function resolveRoleTz(chatSettings) {
    var aw = global.MiyaChatAwareness;
    var ta = chatSettings && chatSettings.timeAwareness;
    if (ta && ta.enabled && ta.real && ta.real.roleTz) {
      return String(ta.real.roleTz).trim();
    }
    return aw && typeof aw.localTz === 'function' ? aw.localTz() : 'Asia/Shanghai';
  }

  function buildChatItineraryBlock(contact, chatSettings, opts) {
    var store = global.miyaItineraryStore;
    if (!store || !contact || !contact.id) return '';
    if (!store.isEnabled(contact.id)) return '';
    var schedule = store.getSchedule(contact.id);
    if (!schedule || store.isScheduleExpired(schedule)) return '';

    opts = opts && typeof opts === 'object' ? opts : {};
    var ts = Number(opts.nowTs);
    if (!Number.isFinite(ts) || ts <= 0) ts = Date.now();
    var roleTz = String(opts.roleTz || resolveRoleTz(chatSettings)).trim();
    var slice = store.resolveCurrentItinerarySlice(schedule, { nowTs: ts, roleTz: roleTz });
    if (!slice || !slice.slot) return '';

    var roleName = String(contact.name || '角色').trim();
    var slot = slice.slot;
    var body = formatSlotForChat(slice);
    var when = slice.dateIso + (slice.clock ? ' ' + slice.clock : '');

    return [
      '【行程轨迹·当前时段】',
      '以下是「' + roleName + '」在角色当地（' + roleTz + '）' + when + ' 此刻的私人行程片段；这是你的真实生活状态，对话须自然体现，勿向用户提及「行程表/系统/生成」等幕后机制。',
      '- 你此刻应在：' + String(slot.location || '日常所在').trim() + '，正在「' + String(slot.activity || slot.title || '日常').trim() + '」。',
      '- 仅内化以下当前时段内容；其他时段你尚未经历或已过，勿提前剧透或混淆。',
      '- 若用户消息与你此刻状态矛盾，可自然解释（如在忙、刚换地方等），勿打破第四面墙。',
      '',
      body
    ].join('\n');
  }

  global.miyaItineraryBridge = {
    buildFullContext: buildFullContext,
    buildScheduleContext: buildScheduleContext,
    buildLiteContext: buildLiteContext,
    buildWorldbookBlock: buildWorldbookBlock,
    getProfileForContact: getProfileForContact,
    generateWeekSchedule: generateWeekSchedule,
    buildChatItineraryBlock: buildChatItineraryBlock,
    expandSimpleSlot: expandSimpleSlot
  };
})(typeof window !== 'undefined' ? window : global);
