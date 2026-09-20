/**
 * miya-theater-bridge.js — 小剧场上下文拼装与 API 生成
 */
(function (global) {
  'use strict';

  function truncateStr(s, max) {
    var t = String(s == null ? '' : s);
    var n = max || 6000;
    return t.length <= n ? t : t.slice(0, n) + '\n…(截断)';
  }

  function stripThinkingNoise(text) {
    var t = String(text || '');
    if (!t) return '';
    if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
      t = global.miyaChatEngine.stripThinkingForApi(t);
    }
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    return t.trim();
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

  function displayName(contact) {
    if (!contact) return '未命名';
    return String(contact.remarkName || contact.name || '未命名').trim();
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();
    parts.push('【角色名】' + displayName(contact));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = String(cts.renderChronicleBlock(roleId) || '').trim();
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
    var parts = ['【用户面具与双方关系】'];
    var userBlock = eng && typeof eng.renderProfileBlock === 'function'
      ? String(eng.renderProfileBlock(profile) || '').trim()
      : '';
    if (userBlock) {
      parts.push(userBlock);
    } else if (profile) {
      var userLines = ['【用户身份·' + String(profile.name || '未命名') + '】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.birthday) userLines.push('- 生日: ' + profile.birthday);
      if (profile.persona) userLines.push('- 人设: ' + truncateStr(profile.persona, 800));
      if (userLines.length > 1) parts.push(userLines.join('\n'));
    }
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push('【双方关系】\n' + relLine);
    } else if (settings && settings.relationship) {
      parts.push('【双方关系】\n你们当前的关系是：' + String(settings.relationship).trim());
    }
    if (contact && contact.remarkName) {
      parts.push('用户对角色的备注称呼：' + String(contact.remarkName).trim());
    }
    return parts.join('\n\n');
  }

  function buildWorldbookBlock(contact, contextSeed) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildWorldbookBundle !== 'function' || !contact) return '';
    var seed = contextSeed || String(contact.name || '') + ' 小剧场 剧情';
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
    return text ? '【世界书·必读】\n' + truncateStr(text, 8000) : '';
  }

  function buildMemorySummaryBlock(settings) {
    var aw = global.MiyaChatAwareness;
    var parts = [];
    if (aw && typeof aw.buildSummaryContextBlock === 'function') {
      var sumBlock = aw.buildSummaryContextBlock(settings);
      if (sumBlock) parts.push('【记忆总结】\n' + truncateStr(sumBlock, 3000));
    }
    if (settings && Array.isArray(settings.charMemoryList) && settings.charMemoryList.length) {
      var mems = settings.charMemoryList.slice(-10).map(function (m) {
        return String(m && m.content ? m.content : m).trim();
      }).filter(Boolean);
      if (mems.length) {
        parts.push('【角色视角记忆】\n' + mems.join('\n\n'));
      }
    }
    return parts.join('\n\n');
  }

  function buildRecentChatBlock(contact, chat, profile, limit) {
    var cs = global.miyaChatStore;
    if (!cs || !chat || !chat.id) return '';
    var msgs = [];
    if (typeof cs.getMergedMessagesForApi === 'function') {
      msgs = cs.getMergedMessagesForApi(chat.id) || [];
    } else if (typeof cs.getMessages === 'function') {
      msgs = cs.getMessages(chat.id) || [];
    }
    var profileName = profile && profile.name ? profile.name : '用户';
    var roleName = displayName(contact);
    var n = Math.max(6, Math.min(Number(limit) || 24, 40));
    var recent = msgs.filter(function (m) {
      return m && !m.deleted && String(m.content || '').trim();
    }).slice(-n);
    if (!recent.length) return '';
    var lines = recent.map(function (m) {
      var body = String(m.content || '').trim();
      if (global.miyaChatEngine && typeof global.miyaChatEngine.stripThinkingForApi === 'function') {
        body = global.miyaChatEngine.stripThinkingForApi(body);
      }
      body = truncateStr(body, 400);
      if (!body) return '';
      var who = m.role === 'user' ? profileName : roleName;
      return who + '：' + body;
    }).filter(Boolean);
    if (!lines.length) return '';
    return '【近期对话】\n' + lines.join('\n');
  }

  function buildOneContactContext(contact, templatePrompt) {
    var ctx = resolveContactContext(contact);
    contact = ctx.contact || contact;
    var profile = ctx.profile;
    var settings = ctx.settings || {};
    var chat = ctx.chat;
    var aw = global.MiyaChatAwareness;
    var seed = String(templatePrompt || '') + ' ' + displayName(contact) + ' 小剧场';

    var parts = [
      '═══ 角色：' + displayName(contact) + ' ═══',
      buildCharacterBlock(contact),
      buildUserRelationBlock(contact, profile, settings)
    ];

    if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
      var net = aw.buildChronicleRelationshipBlock(contact);
      if (net) parts.push(net);
    }

    var wb = buildWorldbookBlock(contact, seed);
    if (wb) parts.push(wb);

    var mem = buildMemorySummaryBlock(settings);
    if (mem) parts.push(mem);

    var recent = buildRecentChatBlock(contact, chat, profile, settings.memoryCount || 24);
    if (recent) parts.push(recent);

    return {
      contact: contact,
      profile: profile,
      settings: settings,
      text: parts.filter(Boolean).join('\n\n')
    };
  }

  function buildTheaterContext(contacts, template) {
    var list = Array.isArray(contacts) ? contacts.filter(Boolean) : [];
    if (!list.length) throw new Error('请选择角色');
    var prompt = String(template && template.prompt || '').trim();
    if (!prompt) throw new Error('模版生成要求为空');

    var blocks = list.map(function (c) {
      return buildOneContactContext(c, prompt);
    });

    var names = blocks.map(function (b) {
      return displayName(b.contact);
    });

    var mode = list.length > 1 ? 'multi' : 'solo';
    var header = [
      '【小剧场生成任务】',
      '模式：' + (mode === 'multi' ? '多人小剧场' : '单人小剧场'),
      '出演角色：' + names.join('、'),
      '模版标题：' + String(template.title || '未命名'),
      '',
      '【模版生成要求·必须严格遵循】',
      prompt
    ].join('\n');

    return {
      mode: mode,
      contacts: blocks.map(function (b) { return b.contact; }),
      names: names,
      contextText: header + '\n\n' + blocks.map(function (b) { return b.text; }).join('\n\n')
    };
  }

  function buildSystemPrompt(mode, names) {
    var cast = (names || []).join('、') || '角色';
    return [
      '你是小剧场编剧与导演，根据模版要求与角色设定创作一场「小剧场」。',
      '出演：' + cast + '。模式：' + (mode === 'multi' ? '多人' : '单人') + '。',
      '输出规则（二选一，按模版要求决定）：',
      '1) 纯文字：直接输出完整剧情正文（可含旁白、对白、场景），不要 JSON，不要解释。',
      '2) HTML：若模版要求页面/互动/可视化，请输出完整可运行的 HTML。',
      '   - 优先用 ```html ... ``` 围栏包裹；也可直接输出完整 HTML 文档。',
      '   - HTML 须自包含样式与脚本，适配手机竖屏，可含按钮、表单等互动。',
      '   - 互动必须可点击可用：展开/收起、选项、翻页等须用 <script>+addEventListener，或原生 <details>/<summary>；禁止只写样子不能点的假按钮。',
      '   - 不要与纯文字对白混排：选定 HTML 后正文只能是 HTML。',
      '',
      '【HTML 视觉质量·强制】若输出 HTML，且模版未提供具体 HTML/CSS 结构或视觉模版时，必须做到：',
      '- 内容丰富：有明确版式层次（标题区、叙事区、互动区等），信息量充足，不要只有几行空壳。',
      '- UI 有创意：构图、排版、动效或交互至少有一处鲜明设计感；可做卡片流、杂志页、对话气泡舞台、日记撕页、票根、星空便签等创意形态，避免千篇一律的白底灰字列表。',
      '- 配色高级：用和谐的色板与渐变/质感背景；禁止廉价高饱和撞色、脏灰堆砌、纯白加默认蓝链那种简陋网页感。',
      '- 字体与细节：字号层级清晰，留白舒服，圆角/阴影/分割克制而精致；按钮与控件要像成品 App，不要裸 HTML 默认样式。',
      '- 禁止简陋 emoji 堆砌当装饰；若需符号请克制、精致，或用 CSS/SVG/几何图形代替。',
      '- 禁止简陋：禁止空页面、大片空白、无样式标签堆叠、仅黑白粗暴对比、像作业演示的丑页面。',
      '- 目标：打开后第一眼要好看、有氛围、像精心设计的移动端互动页，而不是临时拼出来的。',
      '- 交互可用：点「展开」必须真的展开内容；脚本写在页面内并确保绑定成功。',
      '',
      '禁止提及 AI、提示词、系统、生成过程；禁止打破第四面墙。',
      '务必贴合人设、关系、世界书与近期记忆，严格落实模版生成要求。'
    ].join('\n');
  }

  function buildUserPrompt(ctx) {
    return [
      '请阅读全部设定后，按模版要求生成小剧场。',
      '',
      ctx.contextText,
      '',
      '【再次强调】',
      '- 严格按「模版生成要求」决定内容形态与风格',
      '- 角色言行必须符合其人设与关系',
      '- 若输出 HTML 且模版未给具体页面模版：必须内容丰富、UI 有创意、配色与排版精致好看；禁止简陋配色、禁止简陋 emoji 堆砌、禁止丑页面',
      '- 若输出 HTML：展开/收起等互动必须可点可用（用 script 或 details/summary），不要假按钮',
      '- 只输出剧场正文（纯文字或 HTML），不要前言后语'
    ].join('\n');
  }

  function detectContentType(text) {
    var t = String(text || '').trim();
    if (!t) return 'text';
    var htmlApi = global.MiyaChatHtml;
    if (htmlApi) {
      if (typeof htmlApi.looksLikeHtmlReply === 'function' && htmlApi.looksLikeHtmlReply(t)) {
        return 'html';
      }
      if (typeof htmlApi.extractHtmlFromCodeFence === 'function' && htmlApi.extractHtmlFromCodeFence(t)) {
        return 'html';
      }
    }
    if (/```(?:html|htm|xml)\b/i.test(t) || /<\s*!doctype\s+html\b/i.test(t)) return 'html';
    if (/<\s*(html|body|div|section|main|button|form)\b/i.test(t) && (t.match(/<\s*[a-z]/gi) || []).length >= 2) {
      return 'html';
    }
    return 'text';
  }

  function extractPlayContent(rawText) {
    var cleaned = stripThinkingNoise(rawText);
    if (!cleaned) throw new Error('API 返回为空');

    var contentType = detectContentType(cleaned);
    var content = cleaned;
    var title = '';

    if (contentType === 'html') {
      var htmlApi = global.MiyaChatHtml;
      if (htmlApi && typeof htmlApi.extractHtmlOnlyFromReply === 'function') {
        var payload = htmlApi.extractHtmlOnlyFromReply(cleaned);
        // 必须保留原始 HTML（含 script / 事件），禁止用消毒后的 html
        if (payload && payload.raw) {
          content = payload.raw;
        } else if (payload && payload.iframeSrcdoc) {
          content = payload.iframeSrcdoc;
        }
      } else if (htmlApi && typeof htmlApi.extractHtmlFromCodeFence === 'function') {
        var fenced = htmlApi.extractHtmlFromCodeFence(cleaned);
        if (fenced) content = fenced;
      } else {
        var m = cleaned.match(/```(?:html|htm|xml)\s*([\s\S]*?)```/i);
        if (m) content = m[1].trim();
      }
    } else {
      var titleMatch = cleaned.match(/^(?:标题|Title)[:：\s]*(.+)$/im);
      if (titleMatch) {
        title = String(titleMatch[1] || '').trim().slice(0, 40);
      }
    }

    if (!String(content || '').trim()) throw new Error('生成内容为空');
    return { content: content, contentType: contentType, title: title };
  }

  function makePlayTitle(template, names, parsedTitle) {
    if (parsedTitle) return parsedTitle;
    var tplTitle = String(template && template.title || '').trim();
    var cast = (names || []).slice(0, 2).join('·');
    if (tplTitle && cast) return tplTitle + ' · ' + cast;
    return tplTitle || cast || '小剧场';
  }

  function generatePlay(opts) {
    opts = opts || {};
    var contacts = Array.isArray(opts.contacts) ? opts.contacts : [];
    var template = opts.template;
    if (!template) return Promise.reject(new Error('缺少模版'));
    if (!contacts.length) return Promise.reject(new Error('请选择角色'));

    var ctx;
    try {
      ctx = buildTheaterContext(contacts, template);
    } catch (e) {
      return Promise.reject(e);
    }

    var systemPrompt = buildSystemPrompt(ctx.mode, ctx.names);
    var userPrompt = buildUserPrompt(ctx);

    return callApi(systemPrompt, userPrompt, {
      max_tokens: 8192,
      timeoutMs: 180000,
      temperature: 0.88,
      stream: false
    }).then(function (text) {
      var parsed = extractPlayContent(text);
      var store = global.miyaTheaterStore;
      if (!store || typeof store.upsertPlay !== 'function') {
        throw new Error('剧场存储未加载');
      }
      var existingId = String(opts.replacePlayId || '').trim();
      var prev = existingId && store.findPlay ? store.findPlay(existingId) : null;
      var row = store.upsertPlay({
        id: existingId || undefined,
        title: makePlayTitle(template, ctx.names, parsed.title),
        content: parsed.content,
        contentType: parsed.contentType,
        mode: ctx.mode,
        templateId: template.id,
        templateTitle: template.title,
        contactIds: ctx.contacts.map(function (c) { return c.id; }),
        contactNames: ctx.names,
        favorited: prev ? !!prev.favorited : false,
        createdAt: prev ? prev.createdAt : Date.now()
      });
      if (!row) throw new Error('保存剧目失败');
      return row;
    });
  }

  global.miyaTheaterBridge = {
    resolveContactContext: resolveContactContext,
    buildTheaterContext: buildTheaterContext,
    generatePlay: generatePlay,
    detectContentType: detectContentType,
    extractPlayContent: extractPlayContent
  };
})(typeof window !== 'undefined' ? window : global);
