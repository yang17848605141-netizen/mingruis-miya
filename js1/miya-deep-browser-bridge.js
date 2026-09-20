/**
 * miya-deep-browser-bridge.js — 深入 · 角色手机 浏览器 API 生成
 */
(function (global) {
  'use strict';

  var BROWSER_MAX_TOKENS = 32768;
  var LOADING_MSG = '正在读取ta的浏览器数据';

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
      var c;
      for (c = j; c >= i; c--) {
        if (t.charAt(c) !== '}') continue;
        candidates.push(t.slice(i, c + 1));
        candidates.push(repairJsonClosure(t.slice(i, c + 1)));
        candidates.push(repairJsonClosure(escapeRawNewlinesInJsonStrings(t.slice(i, c + 1))));
      }
    }
    var seen = {};
    var n;
    for (n = 0; n < candidates.length; n++) {
      var slice = candidates[n];
      if (!slice || seen[slice]) continue;
      seen[slice] = true;
      try {
        var obj = JSON.parse(slice);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
      } catch (e) { /* try next */ }
    }
    return null;
  }

  function tryParseJson(text) {
    var cleaned = sanitizeJsonText(stripThinkingNoise(text));
    if (!cleaned) return null;
    var fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    try {
      var direct = JSON.parse(cleaned);
      if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    } catch (e0) { /* fall through */ }
    return tryParseJsonSlice(cleaned);
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
      '以下是与该角色私聊时绑定的用户身份及双方关系；生成浏览器数据须贴合此关系。'
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
    var seed = trim(contact.name) + ' 浏览器 搜索 浏览 收藏 网络';
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
      '以下为与该角色的近期私聊，生成浏览器数据时可参考其中的情绪、话题、执念与关系动态——例如 ta 会因聊天内容去搜什么、反复看什么网页、偷偷收藏什么。',
      lines.join('\n')
    ].join('\n');
  }

  function buildBrowserContext(contactId) {
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
    if (eng && typeof eng.stripThinkingForApi === 'function' && text.indexOf('{') < 0) {
      text = eng.stripThinkingForApi(text);
    }
    return String(text || '').trim();
  }

  function isNetworkFetchError(err) {
    var msg = String((err && err.message) || err || '').toLowerCase();
    if (msg.indexOf('http ') === 0) return false;
    return msg === 'failed to fetch' ||
      msg.indexOf('load failed') >= 0 ||
      msg.indexOf('networkerror') >= 0 ||
      msg.indexOf('network request failed') >= 0 ||
      msg.indexOf('请求超时') >= 0 ||
      msg.indexOf('the network connection was lost') >= 0 ||
      (err && err.name === 'AbortError');
  }

  function humanizeApiError(err) {
    if (!err) return new Error('读取失败');
    if (err.name === 'AbortError') return new Error('请求超时，请稍后重试');
    var msg = String(err.message || err || '').trim();
    var lower = msg.toLowerCase();
    if (lower === 'failed to fetch' || lower.indexOf('load failed') >= 0 ||
        lower.indexOf('networkerror') >= 0 || lower.indexOf('network request failed') >= 0 ||
        lower.indexOf('the network connection was lost') >= 0) {
      return new Error('网络中断（Load failed），正在/请再试一次完整读取');
    }
    return err instanceof Error ? err : new Error(msg || '读取失败');
  }

  function extractStreamDelta(obj) {
    if (!obj || typeof obj !== 'object') return { content: '', reasoning: '' };
    var ch = obj.choices && obj.choices[0];
    if (!ch) return { content: '', reasoning: '' };
    var delta = ch.delta || ch.message || {};
    var content = normalizeApiTextContent(delta.content != null ? delta.content : delta.text);
    var reasoning = '';
    if (delta.reasoning_content != null) reasoning = normalizeApiTextContent(delta.reasoning_content);
    else if (delta.reasoning != null) reasoning = normalizeApiTextContent(delta.reasoning);
    if (!content && ch.text != null) content = normalizeApiTextContent(ch.text);
    return { content: content, reasoning: reasoning };
  }

  function fetchWithConnectTimeout(url, options, timeoutMs) {
    var ms = Number(timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0 || typeof AbortController === 'undefined') {
      return fetch(url, options);
    }
    var controller = new AbortController();
    var opts = Object.assign({}, options, { signal: controller.signal });
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, opts).then(function (res) {
      // 头到来即放行；流式正文可继续传输，避免长 JSON 被整体等死
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('请求超时');
      throw err;
    });
  }

  function finalizeStreamText(contentAcc, reasoningAcc) {
    var text = pickJsonLikeApiText(contentAcc, {
      content: contentAcc,
      reasoning_content: reasoningAcc
    });
    if (text.indexOf('{') < 0 && reasoningAcc && String(reasoningAcc).indexOf('{') >= 0) {
      text = String(reasoningAcc);
    }
    var eng = global.miyaChatEngine;
    if (eng && typeof eng.stripThinkingForApi === 'function' && String(text || '').indexOf('{') < 0) {
      text = eng.stripThinkingForApi(text);
    }
    text = String(text || '').trim();
    if (!text) throw new Error('API 返回为空');
    return text;
  }

  function readCompletionsStream(res) {
    if (!res.body || !res.body.getReader) {
      return res.json().then(function (j) {
        var text = extractApiText(j);
        if (!text) throw new Error('API 返回为空');
        return text;
      });
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var sseBuf = '';
    var contentAcc = '';
    var reasoningAcc = '';
    function consumeSseLine(line) {
      var trimmed = String(line || '').trim();
      if (!trimmed || trimmed === 'data: [DONE]' || trimmed === '[DONE]') return;
      if (trimmed.indexOf('data:') === 0) trimmed = trimmed.slice(5).trim();
      if (!trimmed || trimmed === '[DONE]') return;
      try {
        var obj = JSON.parse(trimmed);
        var delta = extractStreamDelta(obj);
        if (delta.content) contentAcc += delta.content;
        if (delta.reasoning) reasoningAcc += delta.reasoning;
      } catch (e) { /* ignore partial SSE */ }
    }
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (sseBuf.trim()) consumeSseLine(sseBuf);
          return finalizeStreamText(contentAcc, reasoningAcc);
        }
        sseBuf += decoder.decode(result.value, { stream: true });
        var parts = sseBuf.split('\n');
        sseBuf = parts.pop() || '';
        parts.forEach(consumeSseLine);
        return pump();
      });
    }
    return pump();
  }

  function callPhoneApiOnce(systemHint, userContent, phoneData, reqOpts, useStream) {
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
      temperature: resolved.temperature != null ? resolved.temperature : 0.92,
      timeoutMs: 300000,
      max_tokens: BROWSER_MAX_TOKENS
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
    if (useStream) payload.stream = true;

    var timeoutMs = Number(reqOpts.timeoutMs) || 300000;
    return fetchWithConnectTimeout(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key
      },
      body: JSON.stringify(payload)
    }, timeoutMs).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 160) : ''));
        });
      }
      if (useStream) return readCompletionsStream(r);
      return r.json().then(function (j) {
        var text = extractApiText(j);
        if (!text) throw new Error('API 返回为空');
        return text;
      });
    });
  }

  function callPhoneApi(systemHint, userContent, phoneData, reqOpts) {
    var maxAttempts = 3;
    var attempt = 0;

    function run(useStream) {
      attempt += 1;
      return callPhoneApiOnce(systemHint, userContent, phoneData, reqOpts, useStream)
        .catch(function (err) {
          var net = isNetworkFetchError(err);
          if (net && attempt < maxAttempts) {
            var nextStream = useStream && attempt < maxAttempts - 1;
            return new Promise(function (resolve) {
              setTimeout(resolve, 700 * attempt);
            }).then(function () {
              return run(nextStream);
            });
          }
          // 流式通道异常（网关半支持等）：同一提示词改非流式再拉一次，不减内容
          if (useStream && attempt < maxAttempts) {
            return run(false);
          }
          throw humanizeApiError(err);
        });
    }

    // 默认流式：边生成边推送，避免一次等完整超大 JSON 时连接被中间层掐掉（Safari Load failed）
    return run(true);
  }

  function buildJsonExample(charName) {
    return (
      '{"tagline":"凌晨还在搜奇怪的东西","stats":{"searches":18,"pages":42,"bookmarks":9,"tabs":5},' +
      '"searches":[{"id":"s1","query":"怎么判断对方是不是也在想你","time":"02:14","when":"今天","category":"emotion"}],' +
      '"openTabs":[{"id":"tab1","title":"某百科·失眠","domain":"baike.com","url":"https://example.com/a"}],' +
      '"history":[{"id":"h1","title":"知乎：成年人如何停止内耗","domain":"zhihu.com","url":"https://example.com/b","snippet":"高赞回答提到…","content":"正文第一段。\\n正文第二段，写 ta 实际看到的网页内容，可以是回答、文章、帖子正文，多段落，越丰富越好。\\n第三段继续展开…","comments":[{"author":"匿名用户","text":"这条评论说到了心坎里"},{"author":"某网友","text":"收藏了，改天再看"}],"visitedAt":"昨天 23:40","visitCount":4,"category":"learn","mood":"焦虑"}],' +
      '"bookmarks":[{"id":"b1","title":"某菜谱·治愈系汤","domain":"xiachufang.com","url":"https://example.com/c","folder":"以后做给某人","note":"聊天时提到的","content":"步骤与心得…","savedAt":"3月"}],' +
      '"digests":[{"id":"d1","title":"本周反复点开","caption":"ta好像很在意这件事","items":["某测试页面","某星座配对"]}]}'
    );
  }

  function buildSystemPrompt(charName, userName) {
    return (
      '你是「' + charName + '」手机浏览器数据生成器。根据角色人设、世界书、用户面具、双方关系、近期聊天，' +
      '生成 ta 手机浏览器里的完整数字足迹——搜索记录、未关标签、浏览历史、收藏夹、浏览习惯摘要。' +
      '这是「' + charName + '」自己的手机，一切以 ta 的第一视角为主。' +
      '内容要丰富、好玩、有窥探感：深夜冲动搜索、反复打开的页面、不好意思让人知道的收藏、因聊天触发的检索、摸鱼娱乐、专业兴趣生活混杂。' +
      '只输出一个 JSON 对象，不要 markdown，不要任何解释文字。' +
      '字段名必须严格使用：tagline、stats、searches、openTabs、history、bookmarks、digests、query、time、when、category、title、domain、url、snippet、content、comments、author、text、visitedAt、visitCount、mood、folder、note、savedAt、caption、items、searches、pages、bookmarks、tabs。' +
      '【完整输出·最高优先级·违反即失败】必须一次写完全部板块，禁止只写 searches 或只写前几条 history 就结束。' +
      'searches 必须 12-18 条：真实搜索词，口语化；category 从 emotion、hobby、work、life、secret、random 选取；' +
      'openTabs 必须 4-7 条：ta 当前没关的标签页；' +
      'history 必须 15-20 条：每条须含 snippet(列表预览，1-2句) 和 content(网页正文，核心！多段落，用\\n分段，每条约 200-800 字，写 ta 实际读到的文章/回答/帖子/商品详情/论坛内容，全部写完不截断)；' +
      '可选 comments 数组(0-5条)：热评/评论区，每项含 author、text；' +
      'category 从 news、learn、shop、social、entertainment、work、health、random 选取；含 visitedAt、visitCount、mood(可选)；' +
      'bookmarks 必须 8-12 条：含 folder、note、content(收藏页正文摘要或全文)；' +
      'digests 必须 2-4 条：浏览习惯摘要；items 为 2-5 个页面标题；' +
      'tagline 一句 ta 的网络状态侧写(12-24字)；stats 填各数组实际数量；' +
      '输出前自检 searches≥12、history≥15、bookmarks≥8、openTabs≥4、digests≥2，且 JSON 以 } 闭合；' +
      '禁止提及 AI。用户「' + userName + '」可间接出现在搜索/收藏/content 中。' +
      '示例结构（须远更丰富的条目与更长的 content，此处仅展示字段格式）：' +
      buildJsonExample(charName)
    );
  }

  function buildUserPrompt(ctx, seed) {
    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var profileName = trim(ctx.profile && ctx.profile.name || '用户');
    return [
      '【角色设定·用户面具·双方关系·世界书·编年史·近期聊天】',
      ctx.contextText,
      '',
      '【任务·必须完整】为「' + charName + '」一次性生成完整浏览器 JSON。',
      '【强制完整】',
      '- searches 12-18、openTabs 4-7、history 15-20、bookmarks 8-12、digests 2-4，全部写满禁止少写',
      '- history 每条 content 必须充实（约 200-800 字），是 ta 读到的网页正文，多段落，全部写完',
      '- 搜索/浏览/收藏/标签页高度个性化；与聊天、关系、世界书有呼应',
      '- 域名用真实常见网站风格（zhihu、bilibili、taobao、小红书、百度百科等）但 url 可虚构',
      '- 用户「' + profileName + '」可间接出现在搜索/收藏中',
      '随机种子 ' + seed,
      '直接输出完整 JSON，从 { 到 }；所有板块写满再停'
    ].join('\n');
  }

  function normalizeComment(raw) {
    if (typeof raw === 'string') {
      var s = trim(raw);
      return s ? { author: '', text: s } : null;
    }
    if (!raw || typeof raw !== 'object') return null;
    var text = trim(raw.text || raw.content || raw.comment || raw.body);
    if (!text) return null;
    return {
      author: trim(raw.author || raw.user || raw.name),
      text: text
    };
  }

  function normalizeSearch(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var query = trim(raw.query || raw.text || raw.keyword);
    if (!query) return null;
    var cat = trim(raw.category || raw.type).toLowerCase();
    var valid = ['emotion', 'hobby', 'work', 'life', 'secret', 'random'];
    if (valid.indexOf(cat) < 0) cat = 'random';
    return {
      id: trim(raw.id) || 's-' + (index + 1),
      query: query,
      time: trim(raw.time || raw.datetime),
      when: trim(raw.when || raw.date),
      category: cat
    };
  }

  function normalizeTab(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name);
    if (!title) return null;
    return {
      id: trim(raw.id) || 'tab-' + (index + 1),
      title: title,
      domain: trim(raw.domain || raw.site),
      url: trim(raw.url || raw.link)
    };
  }

  function normalizeHistory(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name || raw.page);
    if (!title) return null;
    var cat = trim(raw.category || raw.type).toLowerCase();
    var valid = ['news', 'learn', 'shop', 'social', 'entertainment', 'work', 'health', 'random'];
    if (valid.indexOf(cat) < 0) cat = 'random';
    var comments = Array.isArray(raw.comments)
      ? raw.comments.map(normalizeComment).filter(Boolean)
      : [];
    return {
      id: trim(raw.id) || 'h-' + (index + 1),
      title: title,
      domain: trim(raw.domain || raw.site),
      url: trim(raw.url || raw.link),
      snippet: trim(raw.snippet || raw.summary || raw.desc || raw.excerpt),
      content: trim(raw.content || raw.body || raw.article || raw.pageContent || raw.text || raw.fullText),
      comments: comments,
      visitedAt: trim(raw.visitedAt || raw.time || raw.date || raw.when),
      visitCount: Math.max(1, Number(raw.visitCount || raw.visits || raw.count) || 1),
      category: cat,
      mood: trim(raw.mood || raw.feeling || raw.emotion)
    };
  }

  function normalizeBookmark(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name);
    if (!title) return null;
    return {
      id: trim(raw.id) || 'b-' + (index + 1),
      title: title,
      domain: trim(raw.domain || raw.site),
      url: trim(raw.url || raw.link),
      folder: trim(raw.folder || raw.group || raw.collection) || '未分类',
      note: trim(raw.note || raw.memo || raw.comment),
      content: trim(raw.content || raw.body || raw.article || raw.pageContent || raw.text),
      savedAt: trim(raw.savedAt || raw.time || raw.date)
    };
  }

  function normalizeDigest(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = trim(raw.title || raw.name);
    if (!title) return null;
    var items = Array.isArray(raw.items)
      ? raw.items.map(function (x) { return trim(x); }).filter(Boolean)
      : [];
    if (!items.length) return null;
    return {
      id: trim(raw.id) || 'd-' + (index + 1),
      title: title,
      caption: trim(raw.caption || raw.subtitle || raw.desc),
      items: items
    };
  }

  function buildRawFallback(rawText) {
    var raw = String(rawText || '').trim();
    return {
      tagline: raw,
      stats: { searches: 0, pages: 1, bookmarks: 0, tabs: 0 },
      searches: [],
      openTabs: [],
      history: [{
        id: 'h-1',
        title: '原始返回',
        domain: '',
        url: '',
        snippet: '',
        content: raw,
        comments: [],
        visitedAt: '',
        visitCount: 1,
        category: 'random',
        mood: ''
      }],
      bookmarks: [],
      digests: []
    };
  }

  function parseApiPayload(text) {
    var rawText = String(text || '').trim();
    if (!rawText) throw new Error('API 返回为空');
    var obj = tryParseJson(rawText);
    if (!obj || typeof obj !== 'object') return buildRawFallback(rawText);

    var searches = Array.isArray(obj.searches) ? obj.searches.map(normalizeSearch).filter(Boolean) : [];
    var openTabs = Array.isArray(obj.openTabs)
      ? obj.openTabs.map(normalizeTab).filter(Boolean)
      : Array.isArray(obj.tabs) ? obj.tabs.map(normalizeTab).filter(Boolean) : [];
    var history = Array.isArray(obj.history)
      ? obj.history.map(normalizeHistory).filter(Boolean)
      : Array.isArray(obj.pages) ? obj.pages.map(normalizeHistory).filter(Boolean) : [];
    var bookmarks = Array.isArray(obj.bookmarks) ? obj.bookmarks.map(normalizeBookmark).filter(Boolean) : [];
    var digests = Array.isArray(obj.digests) ? obj.digests.map(normalizeDigest).filter(Boolean) : [];

    if (!searches.length && !history.length && !bookmarks.length && !openTabs.length && !digests.length) {
      return buildRawFallback(rawText);
    }

    return {
      tagline: trim(obj.tagline || obj.mood || obj.summary),
      stats: {
        searches: searches.length,
        pages: history.length,
        bookmarks: bookmarks.length,
        tabs: openTabs.length
      },
      searches: searches,
      openTabs: openTabs,
      history: history,
      bookmarks: bookmarks,
      digests: digests
    };
  }

  function generateBrowser(contactId, phoneData, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var ctx = buildBrowserContext(contactId);
    if (!ctx) return Promise.reject(new Error('未找到角色语境'));

    var charName = trim(ctx.contact && ctx.contact.name || '角色');
    var userName = trim(ctx.profile && ctx.profile.name || '用户');
    var seed = Math.floor(Math.random() * 99999);

    if (onProgress) onProgress({ phase: 'api', message: LOADING_MSG });

    return callPhoneApi(
      buildSystemPrompt(charName, userName),
      buildUserPrompt(ctx, seed),
      phoneData,
      { temperature: 0.9, max_tokens: BROWSER_MAX_TOKENS }
    ).then(function (text) {
      return parseApiPayload(String(text || ''));
    });
  }

  global.miyaDeepBrowserBridge = {
    buildBrowserContext: buildBrowserContext,
    generateBrowser: generateBrowser,
    LOADING_MSG: LOADING_MSG
  };
})(typeof window !== 'undefined' ? window : global);
