/**
 * miya-deep-health-bridge.js — 深入 · 角色手机 健康 API 生成
 */
(function (global) {
  'use strict';

  var HEALTH_MAX_TOKENS = 32768;

  var METRIC_IDS = [
    'sleep', 'exercise', 'steps', 'heartRate', 'activeEnergy',
    'mood', 'hydration', 'screenTime', 'nutrition', 'recovery',
    'mindfulness', 'socialEnergy', 'intimatePhysio'
  ];

  var METRIC_ICONS = {
    sleep: 'moon',
    exercise: 'run',
    steps: 'steps',
    heartRate: 'heart',
    activeEnergy: 'flame',
    mood: 'smile',
    hydration: 'drop',
    screenTime: 'screen',
    nutrition: 'leaf',
    recovery: 'battery',
    mindfulness: 'lotus',
    socialEnergy: 'people',
    intimatePhysio: 'veil'
  };

  function trim(s) { return String(s || '').trim(); }

  function normalizeApiTextContent(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') return raw.trim();
    if (Array.isArray(raw)) {
      return raw.map(function (p) {
        if (!p) return '';
        if (typeof p === 'string') return p;
        return p.text != null ? String(p.text) : (p.content != null ? String(p.content) : '');
      }).join('').trim();
    }
    return String(raw || '').trim();
  }

  function extractReasoningText(message) {
    if (!message || typeof message !== 'object') return '';
    var rc = message.reasoning_content != null ? message.reasoning_content : message.reasoning;
    return normalizeApiTextContent(rc);
  }

  function pickJsonLikeApiText(text, message) {
    var body = String(text || '').trim();
    if (body.indexOf('{') >= 0) return body;
    var reasoning = extractReasoningText(message);
    if (reasoning && reasoning.indexOf('{') >= 0) return reasoning;
    return body || reasoning;
  }

  function stripThinkingNoise(text) {
    var t = String(text || '');
    var brace = t.indexOf('{');
    // 健康 JSON 很长：已有 { 时绝不能再走聊天用的 stripThinking（会误切半截）
    if (brace >= 0) {
      t = t.slice(brace);
    } else if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
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

  function repairJsonClosure(text) {
    var t = sanitizeJsonText(String(text || ''));
    var i = t.indexOf('{');
    if (i < 0) return t;
    t = t.slice(i);
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
    if (inStr) out += '"';
    while (stack.length) {
      var open = stack.pop();
      out += open === '{' ? '}' : ']';
    }
    return out;
  }

  function escapeRawNewlinesInJsonStrings(text) {
    var inStr = false;
    var esc = false;
    var out = '';
    var c;
    for (c = 0; c < text.length; c++) {
      var ch = text.charAt(c);
      if (inStr) {
        if (esc) {
          out += ch;
          esc = false;
        } else if (ch === '\\') {
          out += ch;
          esc = true;
        } else if (ch === '"') {
          out += ch;
          inStr = false;
        } else if (ch === '\r') {
          if (text.charAt(c + 1) === '\n') c++;
          out += '\\n';
        } else if (ch === '\n') {
          out += '\\n';
        } else {
          out += ch;
        }
      } else {
        if (ch === '"') inStr = true;
        out += ch;
      }
    }
    return out;
  }

  function scoreHealthObj(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return -1;
    var metrics = Array.isArray(obj.metrics) ? obj.metrics.length : 0;
    var highlights = Array.isArray(obj.highlights) ? obj.highlights.length : 0;
    var insights = Array.isArray(obj.insights) ? obj.insights.length : 0;
    var bonus = 0;
    if (obj.overallNote || obj.summary) bonus += 2;
    if (obj.hero && typeof obj.hero === 'object') bonus += 2;
    if (obj.footerNote || obj.closing) bonus += 1;
    // 优先 metrics 数量——避免「第一个能 parse 的半截 JSON」抢赢完整结果
    return metrics * 1000 + highlights * 20 + insights * 10 + bonus;
  }

  function tryParseJsonSlice(text) {
    var t = sanitizeJsonText(text);
    if (!t) return null;
    var i = t.indexOf('{');
    if (i < 0) return null;
    var j = t.lastIndexOf('}');
    var candidates = [];
    if (j > i) candidates.push(t.slice(i, j + 1));
    candidates.push(repairJsonClosure(t.slice(i)));
    candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i))));
    if (j > i) {
      candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, j + 1))));
      // 只试靠后的闭合，避免从头吞掉半截 metrics 当「成功」
      var bracePositions = [];
      var c;
      for (c = j; c >= i; c--) {
        if (t.charAt(c) === '}') bracePositions.push(c);
      }
      var maxBraceTries = 8;
      for (c = 0; c < bracePositions.length && c < maxBraceTries; c++) {
        var pos = bracePositions[c];
        candidates.push(t.slice(i, pos + 1));
        candidates.push(repairJsonClosure(t.slice(i, pos + 1)));
        candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, pos + 1))));
      }
    }
    var seen = {};
    var best = null;
    var bestScore = -1;
    var n;
    for (n = 0; n < candidates.length; n++) {
      var slice = candidates[n];
      if (!slice || seen[slice]) continue;
      seen[slice] = true;
      try {
        var obj = JSON.parse(slice);
        var score = scoreHealthObj(obj);
        if (score > bestScore) {
          bestScore = score;
          best = obj;
        }
      } catch (e) { /* try next */ }
    }
    return best;
  }

  function tryParseJson(text) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    if (!cleaned) return null;
    // 贪婪取最外层 fence，避免非贪婪提前截断大 JSON
    var fence = cleaned.match(/```(?:json)?\s*([\s\S]*)```/i);
    if (fence) cleaned = fence[1].trim();
    try {
      var direct = JSON.parse(cleaned);
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    } catch (e0) { /* fall through */ }
    return tryParseJsonSlice(cleaned);
  }

  /** 从破损/半截 JSON 里逐条捞出完整的 metrics 对象（与短信 salvage 同思路） */
  function salvageMetricObjects(text) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    var keyRe = /"(?:metrics|items|data)"\s*:\s*\[/i;
    var keyMatch = keyRe.exec(cleaned);
    var searchFrom = keyMatch ? cleaned.indexOf('[', keyMatch.index) : cleaned.indexOf('{');
    if (searchFrom < 0) searchFrom = 0;

    var out = [];
    var seen = Object.create(null);

    function tryPush(slice) {
      if (!slice) return;
      var parsed = null;
      try {
        parsed = JSON.parse(slice);
      } catch (e1) {
        try {
          parsed = JSON.parse(repairJsonClosure(escapeRawNewlinesInJsonStrings(slice)));
        } catch (e2) { /* skip */ }
      }
      if (!parsed || typeof parsed !== 'object') return;
      var id = trim(parsed.id);
      var key = id || ('name:' + trim(parsed.name || parsed.title));
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(parsed);
    }

    // 1) 数组内按大括号深度扫描
    if (keyMatch) {
      var arrStart = cleaned.indexOf('[', keyMatch.index);
      if (arrStart >= 0) {
        var depth = 0;
        var objStart = -1;
        var inStr = false;
        var esc = false;
        var i;
        for (i = arrStart + 1; i < cleaned.length; i++) {
          var ch = cleaned.charAt(i);
          if (inStr) {
            if (esc) esc = false;
            else if (ch === '\\') esc = true;
            else if (ch === '"') inStr = false;
            continue;
          }
          if (ch === '"') { inStr = true; continue; }
          if (ch === '{') {
            if (depth === 0) objStart = i;
            depth++;
            continue;
          }
          if (ch === '}') {
            depth--;
            if (depth === 0 && objStart >= 0) {
              tryPush(cleaned.slice(objStart, i + 1));
              objStart = -1;
            }
            continue;
          }
          if (ch === ']' && depth === 0) break;
        }
      }
    }

    // 2) 按官方 id 锚定再捞一遍——中间某项坏引号时，后面的项仍能救回
    METRIC_IDS.forEach(function (id) {
      if (seen[id]) return;
      var idRe = new RegExp('"id"\\s*:\\s*"' + id + '"', 'i');
      var m = idRe.exec(cleaned);
      if (!m || m.index == null) return;
      var braceStart = cleaned.lastIndexOf('{', m.index);
      if (braceStart < 0) return;
      var d = 0;
      var inS = false;
      var es = false;
      var p;
      for (p = braceStart; p < cleaned.length; p++) {
        var c2 = cleaned.charAt(p);
        if (inS) {
          if (es) es = false;
          else if (c2 === '\\') es = true;
          else if (c2 === '"') inS = false;
          continue;
        }
        if (c2 === '"') { inS = true; continue; }
        if (c2 === '{') d++;
        else if (c2 === '}') {
          d--;
          if (d === 0) {
            tryPush(cleaned.slice(braceStart, p + 1));
            break;
          }
        }
      }
    });

    return out;
  }

  function mergeMetricLists(primary, salvaged) {
    var byId = Object.create(null);
    var order = [];
    function take(list) {
      (list || []).forEach(function (m) {
        if (!m || typeof m !== 'object') return;
        var id = trim(m.id);
        var key = id || ('name:' + trim(m.name || m.title));
        if (!key) return;
        if (!byId[key]) {
          byId[key] = m;
          order.push(key);
        } else {
          // 后写覆盖：salvage 补全字段时可更新空值
          var cur = byId[key];
          Object.keys(m).forEach(function (k) {
            if (m[k] != null && m[k] !== '' && (cur[k] == null || cur[k] === '')) {
              cur[k] = m[k];
            }
          });
        }
      });
    }
    take(primary);
    take(salvaged);
    // 尽量按官方 13 id 顺序排
    var ordered = [];
    var seen = Object.create(null);
    METRIC_IDS.forEach(function (id) {
      if (byId[id]) {
        ordered.push(byId[id]);
        seen[id] = true;
      }
    });
    order.forEach(function (key) {
      if (seen[key]) return;
      ordered.push(byId[key]);
      seen[key] = true;
    });
    return ordered;
  }

  function resolveContactContext(contact) {
    var diaryBr = global.miyaDiaryBridge;
    if (diaryBr && typeof diaryBr.resolveContactContext === 'function') {
      return diaryBr.resolveContactContext(contact);
    }
    return { contact: contact, profile: null, chat: null, settings: {} };
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();
    parts.push('【角色名】' + trim(contact && contact.name || '未知'));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = trim(cts.renderChronicleBlock(roleId));
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + trim(contact.persona));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function buildUserRelationBlock(contact, profile, settings) {
    var aw = global.MiyaChatAwareness;
    var eng = global.miyaChatEngine;
    var parts = [
      '【用户面具与双方关系·参考】',
      '以下是与该角色私聊时绑定的用户身份及双方关系；健康数据须贴合此关系。'
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
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push('【双方关系】\n' + relLine);
    } else if (settings && settings.relationship) {
      parts.push('【双方关系】\n你们当前的关系是：' + trim(settings.relationship));
    }
    if (contact && contact.remarkName) {
      parts.push('用户对角色的备注称呼：' + trim(contact.remarkName));
    }
    return parts.join('\n\n');
  }

  function buildWorldbookBlock(contact) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildWorldbookBundle !== 'function' || !contact) return '';
    var seed = trim(contact.name) + ' 健康 作息 运动 睡眠 饮食 情绪 身体';
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

  function buildChatContextBlock(contact, profile, chat) {
    var cs = global.miyaChatStore;
    if (!cs || !chat || !chat.id) return '';
    var profileName = trim(profile && profile.name || '用户');
    var charName = trim(contact && contact.name || '角色');
    var msgs = cs.getMessages(chat.id) || [];
    var lines = msgs
      .filter(function (m) {
        return m && !m.deleted && trim(m.content);
      })
      .slice(-50)
      .map(function (m) {
        var body = trim(m.content);
        if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
          body = global.miyaChatEngine.stripThinkingForApi(body);
        }
        body = trim(body);
        if (!body) return '';
        var who = m.role === 'user' ? profileName : charName;
        return who + '：' + body;
      })
      .filter(Boolean);
    if (!lines.length) return '';
    return [
      '【近期聊天记录（最近 ' + lines.length + ' 条）】',
      '以下为与该角色的近期私聊，生成健康数据时可参考其中的情绪、作息、压力、活动线索，但不必逐条提及。',
      lines.join('\n')
    ].join('\n');
  }

  function buildHealthContext(contactId) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var contact = cs.findContact ? cs.findContact(contactId) : null;
    if (!contact) {
      contact = (cs.getContacts() || []).find(function (c) { return c && c.id === contactId; }) || null;
    }
    if (!contact) return null;

    var ctx = resolveContactContext(contact);
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

    var wb = buildWorldbookBlock(contact);
    if (wb) parts.push(wb);

    var chatBlock = buildChatContextBlock(contact, profile, chat);
    if (chatBlock) parts.push(chatBlock);

    return {
      contact: contact,
      profile: profile,
      settings: settings,
      chat: chat,
      contextText: parts.filter(Boolean).join('\n\n')
    };
  }

  function extractApiText(j) {
    var eng = global.miyaChatEngine;
    var msg = j && j.choices && j.choices[0] && j.choices[0].message;
    var text = '';
    if (eng && typeof eng.extractReplyContent === 'function') {
      text = eng.extractReplyContent(j);
    } else if (msg) {
      text = normalizeApiTextContent(msg.content);
    }
    text = pickJsonLikeApiText(text, msg);
    if (text.indexOf('{') < 0 && msg) {
      var reasoning = extractReasoningText(msg);
      if (reasoning && reasoning.indexOf('{') >= 0) text = reasoning;
    }
    // 已有 JSON 时不要 stripThinking——聊天用剥思维链会误切健康大 JSON
    if (eng && typeof eng.stripThinkingForApi === 'function' && text.indexOf('{') < 0) {
      text = eng.stripThinkingForApi(text);
    }
    return String(text || '').trim();
  }

  function callPhoneApi(systemHint, userContent, phoneData, reqOpts) {
    var deepStore = global.miyaDeepStore;
    if (!deepStore) return Promise.reject(new Error('API 模块未加载'));
    var resolved = deepStore.resolvePhoneApiConfig(phoneData || {});
    var base = resolved.normalizedBaseUrl;
    var model = trim(resolved.model);
    var key = trim(resolved.apiKey);
    if (!base || !model || !key) {
      return Promise.reject(new Error('请先在角色手机设置或全局设置中配置 API'));
    }
    reqOpts = Object.assign({
      temperature: resolved.temperature != null ? resolved.temperature : 0.88,
      timeoutMs: 300000,
      max_tokens: HEALTH_MAX_TOKENS
    }, reqOpts || {});

    var payload = {
      model: model,
      temperature: reqOpts.temperature,
      max_tokens: reqOpts.max_tokens,
      messages: [
        { role: 'system', content: String(systemHint || '') },
        { role: 'user', content: String(userContent || '') }
      ]
    };

    var timeoutMs = Number(reqOpts.timeoutMs) || 300000;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;

    return fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
        });
      }
      return r.json();
    }).then(function (j) {
      var text = extractApiText(j);
      if (!text) throw new Error('API 返回为空');
      return text;
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('请求超时');
      throw err;
    });
  }

  function buildSystemPrompt(charName) {
    return (
      '你是「' + charName + '」私人健康 App 的数据策展人。' +
      '须根据角色人设、单独绑定的世界书、用户面具、双方关系、近期聊天记录，' +
      '推断 ta 手机里健康 App 会记录怎样的身体与生活数据。' +
      '一切从角色第一人称视角出发——这是 ta 的手机，数据反映 ta 的真实生活状态与内心感受。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构：{"dateLabel":"7月11日 周六","overallScore":78,"overallNote":"40-80字综述","hero":{"greeting":"角色口吻问候","status":"今日状态一句话","trend":"up|stable|down"},' +
      '"metrics":[{"id":"sleep","name":"睡眠质量","icon":"moon","score":62,"value":"6.5","unit":"h","label":"浅眠","detail":"50-90字详细描述","note":"20-40字角色内心备注","subItems":[{"key":"入睡","value":"01:24"},{"key":"深睡","value":"1.2h"},{"key":"醒来","value":"07:48"}],"weekBars":[45,60,55,70,40,65,62]}],' +
      '"highlights":[{"time":"07:10","metric":"步数","text":"30-50字事件描述"}],' +
      '"insights":[{"title":"洞察标题","text":"40-70字分析"}],' +
      '"footerNote":"30-50字角色碎碎念收尾"}。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完全部内容，禁止偷懒、禁止半截、禁止只写前几项就结束。' +
      '硬性数量（缺一项都算失败）：metrics 必须恰好 13 条（不得 4 条、不得 6 条、不得 8 条、不得 12 条，必须 13），' +
      'id 必须且仅按此顺序各出现一次：sleep、exercise、steps、heartRate、activeEnergy、mood、hydration、screenTime、nutrition、recovery、mindfulness、socialEnergy、intimatePhysio；' +
      '对应名称依次为：睡眠质量、运动质量、步数、心率、活动消耗、情绪状态、饮水、屏幕使用、饮食营养、恢复指数、正念冥想、社交能量、私密生理状态；' +
      '其中 intimatePhysio（私密生理状态）写 ta 私人身体敏感/生理节律类状态（如经期周期、欲望与节制、内分敏感知、私密不适等，按人设性别与设定合理取舍，第一人称、克制且具体）；' +
      '每条 metrics 的 detail 必须 50-90 字、note 必须 20-40 字、subItems 至少 3 项、weekBars 恰好 7 个 0-100 整数；' +
      'highlights 必须恰好 4 条、insights 必须恰好 3 条；必须写 overallNote、hero、footerNote；' +
      '输出前自检：metrics.length===13 且 highlights.length===4 且 insights.length===3，JSON 必须以 } 完整闭合；' +
      '数据须与人设/世界书/聊天线索自洽；禁止提及 AI、系统、提示词。'
    );
  }

  function buildUserPrompt(ctx, seed) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    return [
      '【角色设定·用户面具·双方关系·世界书·必读】',
      ctx.contextText,
      '',
      '【生成任务 · ' + charName + ' 的手机 · 健康 App · 必须完整】',
      '为角色「' + charName + '」一次性生成 ta 私人健康 App 的完整健康档案，面向与 ta 有关系的「' + profileName + '」。',
      '随机种子 ' + seed + '（勿提及）。',
      '【强制完整·不可省略】',
      '- metrics 必须正好 13 项，一项都不能少、不能只输出前几项就停：',
      '  1.sleep 睡眠质量  2.exercise 运动质量  3.steps 步数  4.heartRate 心率',
      '  5.activeEnergy 活动消耗  6.mood 情绪状态  7.hydration 饮水  8.screenTime 屏幕使用',
      '  9.nutrition 饮食营养  10.recovery 恢复指数  11.mindfulness 正念冥想  12.socialEnergy 社交能量',
      '  13.intimatePhysio 私密生理状态（按人设写私人生理/身体敏感状态，具体）',
      '- 上面 13 项每项都要写满：detail 50-90 字、note 20-40 字、subItems≥3、weekBars 7 个数',
      '- highlights 必须 4 条、insights 必须 3 条，另含 overallScore、overallNote、hero、footerNote',
      '- 第一人称视角；只输出一个完整 JSON（从 { 到 }），写完 13 项再结束，禁止半截'
    ].join('\n');
  }

  function normalizeApiMetric(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = trim(raw.name || raw.title);
    if (!name) return null;
    var id = trim(raw.id) || METRIC_IDS[index] || ('m-' + (index + 1));
    var icon = trim(raw.icon) || METRIC_ICONS[id] || 'dot';
    var bars = Array.isArray(raw.weekBars)
      ? raw.weekBars.map(function (n) {
        return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
      })
      : [];
    var subItems = Array.isArray(raw.subItems)
      ? raw.subItems.map(function (si) {
        if (!si || typeof si !== 'object') return null;
        var k = trim(si.key || si.label || si.name);
        var v = trim(si.value || si.val);
        if (!k && !v) return null;
        return { key: k, value: v };
      }).filter(Boolean)
      : [];
    return {
      id: id,
      name: name,
      icon: icon,
      score: Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0))),
      value: trim(raw.value || raw.mainValue),
      unit: trim(raw.unit),
      label: trim(raw.label || raw.status),
      detail: trim(raw.detail || raw.description),
      note: trim(raw.note || raw.remark),
      subItems: subItems,
      weekBars: bars
    };
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      dateLabel: '',
      overallScore: 0,
      overallNote: raw,
      hero: { greeting: '', status: '', trend: 'stable' },
      metrics: [{
        id: 'raw',
        name: '原始返回',
        icon: 'dot',
        score: 0,
        value: '',
        unit: '',
        label: '',
        detail: raw,
        note: '',
        subItems: [],
        weekBars: []
      }],
      highlights: [],
      insights: [],
      footerNote: ''
    };
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    var metrics = obj && Array.isArray(obj.metrics) ? obj.metrics : [];
    var salvaged = salvageMetricObjects(rawText);
    if (salvaged.length) {
      metrics = mergeMetricLists(metrics, salvaged);
    }
    if ((!obj || typeof obj !== 'object') && !metrics.length) {
      return buildRawFallback(rawText);
    }
    var norm = metrics.map(normalizeApiMetric).filter(Boolean);
    if (!norm.length) return buildRawFallback(rawText);
    var highlights = obj && Array.isArray(obj.highlights) ? obj.highlights : [];
    var insights = obj && Array.isArray(obj.insights) ? obj.insights : [];
    return {
      dateLabel: trim(obj && (obj.dateLabel || obj.date)),
      overallScore: Math.max(0, Math.min(100, Math.round(Number(obj && obj.overallScore) || 0))),
      overallNote: trim(obj && (obj.overallNote || obj.summary)),
      hero: {
        greeting: trim(obj && obj.hero && obj.hero.greeting),
        status: trim(obj && obj.hero && obj.hero.status),
        trend: trim(obj && obj.hero && obj.hero.trend) || 'stable'
      },
      metrics: norm,
      highlights: highlights.map(function (h) {
        if (!h || typeof h !== 'object') return null;
        var t = trim(h.text || h.content);
        if (!t) return null;
        return {
          time: trim(h.time || h.date),
          metric: trim(h.metric || h.category),
          text: t
        };
      }).filter(Boolean),
      insights: insights.map(function (ins) {
        if (!ins || typeof ins !== 'object') return null;
        var t = trim(ins.text || ins.content);
        if (!t) return null;
        return {
          title: trim(ins.title || ins.label),
          text: t
        };
      }).filter(Boolean),
      footerNote: trim(obj && (obj.footerNote || obj.closing))
    };
  }

  function missingMetricIds(payload) {
    var have = Object.create(null);
    (payload && payload.metrics || []).forEach(function (m) {
      if (m && m.id) have[m.id] = true;
    });
    return METRIC_IDS.filter(function (id) { return !have[id]; });
  }

  function buildFillSystemPrompt(charName) {
    return (
      '你是「' + charName + '」私人健康 App 的数据策展人。' +
      '上一轮输出缺了部分 metrics，现在只补齐缺失项。' +
      '只输出一个 JSON 对象，不要 markdown，不要解释，首字符必须是 {，末字符必须是 }。' +
      'JSON 结构：{"metrics":[{"id":"...","name":"...","icon":"...","score":70,"value":"...","unit":"...","label":"...","detail":"50-90字","note":"20-40字","subItems":[{"key":"a","value":"b"}],"weekBars":[40,50,55,60,45,58,62]}]}。' +
      'metrics 必须恰好等于要求补齐的数量；id 只能用给定缺失列表；每项写满 detail/note/subItems≥3/weekBars 7 个数；第一人称；禁止提及 AI。'
    );
  }

  function buildFillUserPrompt(ctx, missingIds, seed) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var names = {
      sleep: '睡眠质量', exercise: '运动质量', steps: '步数', heartRate: '心率',
      activeEnergy: '活动消耗', mood: '情绪状态', hydration: '饮水', screenTime: '屏幕使用',
      nutrition: '饮食营养', recovery: '恢复指数', mindfulness: '正念冥想',
      socialEnergy: '社交能量', intimatePhysio: '私密生理状态'
    };
    var lines = missingIds.map(function (id, i) {
      return (i + 1) + '.' + id + ' ' + (names[id] || id);
    });
    return [
      '【角色语境摘要】',
      trim(ctx.contextText).slice(0, 6000),
      '',
      '【补齐任务 · ' + charName + ' · 缺失 metrics】',
      '必须一次性补齐下列 ' + missingIds.length + ' 项（一项都不能少）：',
      lines.join('\n'),
      '随机种子 ' + seed + '（勿提及）。',
      '只输出 {"metrics":[...]} ，写满上述全部 id 再结束。'
    ].join('\n');
  }

  function mergeHealthPayload(base, fill) {
    if (!fill || !fill.metrics || !fill.metrics.length) return base;
    var merged = mergeMetricLists(
      (base.metrics || []).map(function (m) { return m; }),
      fill.metrics
    );
    var norm = merged.map(normalizeApiMetric).filter(Boolean);
    // 再按官方顺序排一次
    var byId = Object.create(null);
    norm.forEach(function (m) { if (m && m.id) byId[m.id] = m; });
    var ordered = [];
    METRIC_IDS.forEach(function (id) {
      if (byId[id]) ordered.push(byId[id]);
    });
    norm.forEach(function (m) {
      if (m && m.id && METRIC_IDS.indexOf(m.id) < 0) ordered.push(m);
    });
    base.metrics = ordered;
    if (!base.highlights.length && fill.highlights && fill.highlights.length) {
      base.highlights = fill.highlights;
    }
    if (!base.insights.length && fill.insights && fill.insights.length) {
      base.insights = fill.insights;
    }
    if (!base.overallNote && fill.overallNote) base.overallNote = fill.overallNote;
    if (!base.footerNote && fill.footerNote) base.footerNote = fill.footerNote;
    if ((!base.hero || (!base.hero.greeting && !base.hero.status)) && fill.hero) {
      base.hero = fill.hero;
    }
    return base;
  }

  function generateHealth(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildHealthContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) {
      onProgress({ phase: 'api', message: '正在读取ta的健康数据' });
    }

    return callPhoneApi(
      buildSystemPrompt(charName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.88, max_tokens: HEALTH_MAX_TOKENS }
    ).then(function (text) {
      var payload = parseApiPayload(String(text || ''));
      var missing = missingMetricIds(payload);
      if (!missing.length) return payload;

      if (onProgress) {
        onProgress({
          phase: 'api',
          message: '正在补齐缺失指标（' + missing.length + '）'
        });
      }
      var fillSeed = Math.floor(Math.random() * 99999);
      return callPhoneApi(
        buildFillSystemPrompt(charName),
        buildFillUserPrompt(ctx, missing, fillSeed),
        phoneData,
        { temperature: 0.7, max_tokens: HEALTH_MAX_TOKENS }
      ).then(function (fillText) {
        var fillPayload = parseApiPayload(String(fillText || ''));
        return mergeHealthPayload(payload, fillPayload);
      }).catch(function () {
        // 补齐失败仍返回已解析到的部分，避免整次失败
        return payload;
      });
    });
  }

  global.miyaDeepHealthBridge = {
    buildHealthContext: buildHealthContext,
    generateHealth: generateHealth,
    METRIC_IDS: METRIC_IDS
  };
})(typeof window !== 'undefined' ? window : global);
