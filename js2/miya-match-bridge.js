/**
 * miya-match-bridge.js — 赛事上下文拼装与两段 API（超详细赛程 + 全员感想）
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

  function escapeRegExp(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 去掉赛程正文里泄漏的 contactId / ct_ 编码 */
  function scrubMatchProse(text, session) {
    var t = String(text == null ? '' : text);
    if (!t) return '';
    t = t.replace(/\bcontactId\s*[=：:]\s*[A-Za-z0-9_\-]+/gi, '');
    t = t.replace(/[（(\[【]\s*ct_[A-Za-z0-9_]+\s*[）)\]】]/g, '');
    t = t.replace(/\bct_[A-Za-z0-9_]+\b/g, '');
    var ids = [];
    (session && session.participants ? session.participants : []).forEach(function (p) {
      if (!p) return;
      var cid = String(p.contactId || '').trim();
      if (cid) ids.push(cid);
    });
    ids.forEach(function (id) {
      if (id.length < 4) return;
      t = t.replace(new RegExp(escapeRegExp(id), 'gi'), '');
    });
    t = t.replace(/[（(\[【]\s*[）)\]】]/g, '');
    t = t.replace(/[ \t]+\n/g, '\n');
    t = t.replace(/\n[ \t]+/g, '\n');
    t = t.replace(/[ \t]{2,}/g, ' ');
    t = t.replace(/([^\s])\s+([，。！？、；：,.!?;:])/g, '$1$2');
    return t.trim();
  }

  /**
   * 将赛程段落拆成旁白 / 对白片段。
   * 对白约定：角色名：「台词」或 角色名："台词"；已知角色名也可用 角色名：台词
   */
  function parseMatchBeatSegments(text, nameList) {
    var raw = String(text == null ? '' : text);
    if (!raw.trim()) return [];
    var names = (nameList || []).map(function (n) {
      return String(n || '').trim();
    }).filter(Boolean).sort(function (a, b) {
      return b.length - a.length;
    });
    var nameAlt = names.map(escapeRegExp).join('|');
    var reQuoted = /^(.{1,24}?)\s*[：:]\s*[「“"](.+?)[」”"]\s*$/;
    var reKnown = nameAlt
      ? new RegExp('^(' + nameAlt + ')\\s*[：:]\\s*(.+)$')
      : null;
    var lines = raw.split(/\n/);
    var segments = [];
    var narrBuf = [];

    function flushNarr() {
      var n = narrBuf.join('\n').replace(/^\n+/, '').replace(/\n+$/, '').trim();
      if (n) segments.push({ type: 'narration', text: n });
      narrBuf = [];
    }

    lines.forEach(function (line) {
      var trimmed = String(line || '').trim();
      if (!trimmed) {
        if (narrBuf.length) narrBuf.push('');
        return;
      }
      var m = trimmed.match(reQuoted);
      if (!m && reKnown) m = trimmed.match(reKnown);
      if (m) {
        var speaker = String(m[1] || '').trim();
        var speech = String(m[2] || '').trim()
          .replace(/^[「“"]+/, '')
          .replace(/[」”"]+$/, '')
          .trim();
        if (speaker && speech) {
          flushNarr();
          segments.push({ type: 'speech', name: speaker, text: speech });
          return;
        }
      }
      narrBuf.push(line);
    });
    flushNarr();
    return segments.length ? segments : [{ type: 'narration', text: raw.trim() }];
  }

  function collectSpeakerNames(session) {
    var names = [];
    var seen = {};
    function add(n) {
      var s = String(n || '').trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      names.push(s);
    }
    if (session && session.profileName) add(session.profileName);
    (session && session.participants ? session.participants : []).forEach(function (p) {
      if (p) add(p.name);
    });
    return names;
  }

  function callApi(systemHint, userContent, reqOpts) {
    var br = global.miyaForumBridge;
    var opts = Object.assign({
      max_tokens: 16000,
      temperature: 0.85,
      timeoutMs: 240000,
      preferJsonPayload: true,
      disableThinking: true,
      stream: true
    }, reqOpts || {});
    if (br && typeof br.callItineraryCompletionsRaw === 'function') {
      return br.callItineraryCompletionsRaw(systemHint, userContent, undefined, opts);
    }
    if (br && typeof br.callChatCompletionsRaw === 'function') {
      return br.callChatCompletionsRaw(systemHint, userContent);
    }
    return Promise.reject(new Error('API 模块未加载'));
  }

  function extractJson(text) {
    var br = global.miyaForumBridge;
    var cleaned = stripThinkingNoise(text);
    if (br && typeof br.extractJsonObject === 'function') {
      var obj = br.extractJsonObject(cleaned);
      if (obj) return obj;
    }
    var i = cleaned.indexOf('{');
    var j = cleaned.lastIndexOf('}');
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(cleaned.slice(i, j + 1));
      } catch (e) {}
    }
    return null;
  }

  function resolveProfile(profileId) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var id = String(profileId || '').trim();
    var profiles = cs.getProfiles ? cs.getProfiles() : [];
    if (id) {
      var found = profiles.find(function (p) { return p && String(p.id) === id; });
      if (found) return found;
    }
    return cs.getActiveProfile ? cs.getActiveProfile() : null;
  }

  function resolveContactContext(contact) {
    var cs = global.miyaChatStore;
    if (!contact) return { contact: null, profile: null, chat: null, settings: {} };
    if (cs && typeof cs.findContact === 'function' && contact.id) {
      var fresh = cs.findContact(contact.id);
      if (fresh) contact = fresh;
    }
    if (!cs) return { contact: contact, profile: null, chat: null, settings: {} };
    var profileId = String(contact.defaultProfileId || '').trim();
    var chat = cs.findChatByContact ? cs.findChatByContact(contact.id, profileId) : null;
    if (!chat && cs.findChatByContact) chat = cs.findChatByContact(contact.id, '');
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
    return { contact: contact, profile: null, chat: chat, settings: settings };
  }

  /** 赛事一律用角色真名，不用备注名 */
  function displayName(contact) {
    if (!contact) return '未命名';
    return String(contact.name || '未命名').trim() || '未命名';
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();
    parts.push('【角色名】' + displayName(contact));
    parts.push('【结果字段用 contactId｜正文禁止出现】' + String(contact && contact.id || ''));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = String(cts.renderChronicleBlock(roleId) || '').trim();
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + truncateStr(contact.persona, 2000));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function buildUserRelationBlock(contact, hostProfile, settings) {
    var aw = global.MiyaChatAwareness;
    var parts = ['【与主持人的关系】'];
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push(relLine);
    } else if (settings && settings.relationship) {
      parts.push('你们当前的关系是：' + String(settings.relationship).trim());
    }
    if (contact && contact.remarkName) {
      parts.push('主持人对角色的备注称呼：' + String(contact.remarkName).trim());
    }
    return parts.join('\n');
  }

  function buildHostBlock(profile) {
    var eng = global.miyaChatEngine;
    var parts = ['【主持人·用户面具】'];
    if (eng && typeof eng.renderProfileBlock === 'function') {
      var block = String(eng.renderProfileBlock(profile) || '').trim();
      if (block) {
        parts.push(block);
        return parts.join('\n');
      }
    }
    if (profile) {
      parts.push('姓名：' + String(profile.name || '用户'));
      if (profile.gender) parts.push('性别：' + profile.gender);
      if (profile.persona) parts.push('人设：' + truncateStr(profile.persona, 2000));
    } else {
      parts.push('姓名：用户');
    }
    return parts.join('\n');
  }

  function buildPairwiseRelations(contacts) {
    var aw = global.MiyaChatAwareness;
    var relStore = global.miyaContactsRelationshipStore;
    var parts = ['【参赛者之间的关系】'];
    var seen = {};
    var i;
    var j;
    for (i = 0; i < contacts.length; i++) {
      for (j = i + 1; j < contacts.length; j++) {
        var a = contacts[i];
        var b = contacts[j];
        var key = [a.id, b.id].sort().join('|');
        if (seen[key]) continue;
        seen[key] = true;
        var line = '';
        var aRole = String(a.characterId || a.chronicleId || '').trim();
        var bRole = String(b.characterId || b.chronicleId || '').trim();
        if (relStore && typeof relStore.getRelation === 'function' && aRole && bRole) {
          line = String(relStore.getRelation(aRole, bRole) || '').trim();
        }
        if (!line && aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
          var netA = String(aw.buildChronicleRelationshipBlock(a) || '');
          var nameB = displayName(b);
          if (netA && nameB && netA.indexOf(nameB) >= 0) {
            line = '见档案人际脉络（含与「' + nameB + '」相关描述）';
          }
        }
        if (line) {
          parts.push(displayName(a) + ' ↔ ' + displayName(b) + '：' + line);
        }
      }
    }
    if (parts.length === 1) parts.push('（档案中暂无明确双边关系，按各自人设自然互动）');
    return parts.join('\n');
  }

  function buildMatchMeta(session) {
    var lines = [
      '【本场比赛】',
      '赛事：' + String(session.eventName || ''),
      '项目：' + String(session.eventItemName || ''),
      '项目说明：' + String(session.eventItemDesc || ''),
      '氛围：' + String(session.eventMood || ''),
      '赛制：' + (session.mode === 'team' ? '阵营赛（两边人数相同，决出胜方/败方与可选 MVP）' : '单人赛（决出全部名次）'),
      '主持人面具：' + String(session.profileName || '用户')
    ];
    if (session.source === 'user_custom' || session.source === 'char_invite') {
      lines.push('来源：' + (session.source === 'char_invite' ? '角色发起' : '自定义比赛'));
      if (session.proposerName) lines.push('发起角色：' + String(session.proposerName));
      lines.push('');
      lines.push('【自定义规则（必须遵守）】');
      lines.push(String(session.eventItemDesc || '（无额外规则）'));
    }
    lines.push('');
    lines.push('【参赛名单·显示名（正文只用这些名字）】');
    (session.participants || []).forEach(function (p, idx) {
      var row = (idx + 1) + '. ' + p.name;
      if (session.mode === 'team') row += ' · 阵营' + (p.team || '?');
      lines.push(row);
    });
    lines.push('');
    lines.push('【结果字段 ID 对照｜仅用于 rankings / mvpContactId，正文严禁出现】');
    (session.participants || []).forEach(function (p, idx) {
      lines.push((idx + 1) + '. ' + p.name + ' → ' + p.contactId);
    });
    lines.push('');
    lines.push('【奖品配置】');
    var prizes = session.prizes || {};
    if (session.mode === 'team') {
      lines.push('胜方奖品：' + (prizes.teamWin || '（无）'));
      lines.push('败方奖品：' + (prizes.teamLose || '（无）'));
      lines.push('MVP 奖品：' + (prizes.mvp || '（无）'));
    } else {
      var n = (session.participants || []).length;
      var ranks = prizes.soloRanks || [];
      for (var r = 0; r < n; r++) {
        lines.push('第' + (r + 1) + '名奖品：' + (ranks[r] || '（无）'));
      }
    }
    return lines.join('\n');
  }

  function systemPromptPropose() {
    return [
      '你是角色扮演助手。根据角色人设与关系，替该角色提出一场「TA 想举办/参加」的趣味比赛。',
      '只输出一个 JSON 对象，不要 markdown 围栏外的解释。',
      '字段：',
      '- name: string 比赛项目名（短，≤20字）',
      '- desc: string 规则与玩法说明（清晰可执行，写清怎么比、怎么算赢）',
      '- mood: string 场景氛围关键词（逗号或顿号分隔）',
      '- preferredMode: "solo" 或 "team"（按项目性质选；默认 solo）',
      '- pitch: string 角色用第一人称发出的邀请语（2～5句，贴合人设，不要提 AI）',
      '',
      '要求：贴合人设兴趣；比赛可落地、适合多人角色同场；禁止成人色情内容；禁止提及 AI/提示词。'
    ].join('\n');
  }

  function normalizeProposal(raw, contact) {
    var obj = raw && typeof raw === 'object' ? raw : {};
    var name = String(obj.name || '').trim();
    var desc = String(obj.desc || '').trim();
    var mood = String(obj.mood || '').trim();
    var pitch = String(obj.pitch || '').trim();
    var mode = String(obj.preferredMode || obj.defaultMode || 'solo').trim().toLowerCase();
    if (mode !== 'team') mode = 'solo';
    if (!name) name = (displayName(contact) || '角色') + '的挑战赛';
    if (!desc) desc = '按角色提议进行趣味比赛，公平公正，决出胜负。';
    return {
      name: name.slice(0, 40),
      desc: desc.slice(0, 2000),
      mood: mood.slice(0, 500),
      defaultMode: mode,
      pitch: pitch.slice(0, 800),
      fromChar: true,
      proposerContactId: contact && contact.id ? String(contact.id) : '',
      proposerName: displayName(contact)
    };
  }

  function proposeMatch(contact) {
    if (!contact || !contact.id) {
      return Promise.reject(new Error('请选择角色'));
    }
    var host = resolveProfile('');
    var ctx = resolveContactContext(contact);
    var parts = [
      '请根据以下角色，提出一场 TA 真正想比的趣味比赛 JSON。',
      '',
      buildHostBlock(host),
      '',
      '════ 发起角色 ════',
      buildCharacterBlock(ctx.contact || contact),
      buildUserRelationBlock(ctx.contact || contact, host, ctx.settings || {})
    ];
    var aw = global.MiyaChatAwareness;
    if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
      var net = aw.buildChronicleRelationshipBlock(ctx.contact || contact);
      if (net) parts.push(net);
    }
    var existing = [];
    var store = global.miyaMatchStore;
    if (store && store.listCustomItems) {
      existing = store.listCustomItems().slice(0, 8).map(function (it) {
        return '- ' + it.name;
      });
    }
    if (existing.length) {
      parts.push('【已有自定义项目（避免雷同）】\n' + existing.join('\n'));
    }
    parts.push('', '只输出 JSON。');

    return callApi(systemPromptPropose(), parts.join('\n\n'), {
      max_tokens: 2000,
      timeoutMs: 120000,
      temperature: 0.9
    }).then(function (raw) {
      var parsed = extractJson(raw);
      if (!parsed) throw new Error('提案解析失败，请重试');
      var proposal = normalizeProposal(parsed, contact);
      if (!proposal.name || !proposal.desc) throw new Error('提案不完整，请重试');
      return proposal;
    });
  }

  function listContactsFromSession(session) {
    var cs = global.miyaChatStore;
    if (!cs || !cs.findContact) return [];
    return (session.participants || []).map(function (p) {
      return cs.findContact(p.contactId);
    }).filter(Boolean);
  }

  function buildFullContext(session) {
    var host = resolveProfile(session.profileId);
    var contacts = listContactsFromSession(session);
    var parts = [buildMatchMeta(session), buildHostBlock(host)];

    contacts.forEach(function (contact) {
      var ctx = resolveContactContext(contact);
      var block = [
        '════ ' + displayName(contact) + ' ════',
        buildCharacterBlock(ctx.contact || contact),
        buildUserRelationBlock(ctx.contact || contact, host, ctx.settings || {})
      ];
      var aw = global.MiyaChatAwareness;
      if (aw && typeof aw.buildChronicleRelationshipBlock === 'function') {
        var net = aw.buildChronicleRelationshipBlock(ctx.contact || contact);
        if (net) block.push(net);
      }
      parts.push(block.filter(Boolean).join('\n\n'));
    });

    parts.push(buildPairwiseRelations(contacts));
    return {
      host: host,
      contacts: contacts,
      text: parts.filter(Boolean).join('\n\n')
    };
  }

  function systemPromptMatch() {
    return [
      '你是赛事现场记录员兼小说笔法的编剧：根据人设、关系与赛制，写一场可读性强、细节饱满的比赛全过程，并给出公正结果。',
      '必须只输出一个 JSON 对象，不要 markdown 围栏外的解释。',
      'JSON 字段：',
      '- highlight: string 一句话金句（文学感，不堆砌术语）',
      '- beats: string[] 分幕正文；每幕内部用空行分段；旁白与对白严格分行',
      '- narrative: string 将 beats 按顺序用空行拼接的完整长文',
      '- rankings: 单人赛必填 [{ contactId, rank, note? }]，rank 从 1 开始覆盖所有参赛者',
      '- winnerTeam: 阵营赛必填 "A" 或 "B"',
      '- mvpContactId: 阵营赛可选，须为参赛 contactId',
      '',
      '正文版式（beats / narrative 必须遵守）：',
      '· 旁白：第三人称场景描写，写动作、表情、气息、道具与氛围；一段一事，段与段空一行。',
      '· 对白：必须单独成行，格式固定为 角色显示名：「台词」（中文引号）；主持人用其面具姓名。',
      '· 示例：',
      '哨声落下，跑道边的尘土被风掀起一层浅雾。',
      '',
      '林遥：「别眨眼——这一下，我可不会让。」',
      '',
      '对面的人只是笑了笑，指尖在起点线上轻轻一点。',
      '',
      '写作铁律：',
      '1) 结构：开场铺垫 → 多幕推进 → 高潮胶着 → 收束与宣布名次；禁止只写结果短讯。',
      '2) 每位角色在关键节点都要有可见动作、微表情/肢体、对白或短句、以及对他人的即时反应；关系要写进互动里。',
      '3) 文笔要顺、有画面感，避免说明书腔与流水账；适当留白与节奏变化。',
      '4) 主持人可穿插口令与现场反应，但不抢戏。',
      '5) 宁长勿短；人数越多幕数越多；体力赛写拉锯，才艺赛写表演质感。',
      '6) rankings / mvp 等字段里的 contactId 必须用输入给出的真实 id；正文里只写角色显示名，禁止出现 contactId、ct_ 编码、括号里的内部 id。',
      '7) 禁止提及 AI、提示词、系统。'
    ].join('\n');
  }

  function systemPromptReactions() {
    return [
      '你是赛后采访编辑。比赛已结束并颁发奖品，请为每一位参赛角色写最终感想/反应。',
      '只输出 JSON：{ "reactions": [{ "contactId": "...", "name": "...", "text": "..." }] }',
      '必须覆盖全部参赛者；感想贴合人设、本场名次/胜负、所得奖品（可无奖品）与赛程经历。',
      '每人 2～5 句，有情绪与具体细节，不要空话套话。禁止提及 AI。'
    ].join('\n');
  }

  function normalizeMatchResult(raw, session) {
    var obj = raw && typeof raw === 'object' ? raw : {};
    var beats = Array.isArray(obj.beats)
      ? obj.beats.map(function (b) { return scrubMatchProse(b, session); }).filter(Boolean)
      : [];
    var narrative = scrubMatchProse(obj.narrative, session);
    if (!narrative && beats.length) narrative = beats.join('\n\n');
    if (!beats.length && narrative) beats = narrative.split(/\n{2,}/).map(function (s) {
      return scrubMatchProse(s, session);
    }).filter(Boolean);

    var highlight = scrubMatchProse(obj.highlight, session);
    var result = {
      narrative: narrative,
      beats: beats,
      highlight: highlight
    };

    var idSet = {};
    (session.participants || []).forEach(function (p) {
      idSet[String(p.contactId)] = p;
    });

    function resolveId(val, nameHint) {
      var id = String(val || '').trim();
      if (id && idSet[id]) return id;
      var hint = String(nameHint || val || '').trim();
      if (!hint) return '';
      var hit = (session.participants || []).find(function (p) {
        return String(p.name) === hint || String(p.name).indexOf(hint) >= 0 || hint.indexOf(String(p.name)) >= 0;
      });
      return hit ? String(hit.contactId) : '';
    }

    if (session.mode === 'team') {
      var wt = String(obj.winnerTeam || '').trim().toUpperCase();
      if (wt !== 'A' && wt !== 'B') wt = 'A';
      result.winnerTeam = wt;
      result.mvpContactId = resolveId(obj.mvpContactId, obj.mvpName);
    } else {
      var rankings = Array.isArray(obj.rankings) ? obj.rankings : [];
      var mapped = [];
      rankings.forEach(function (row) {
        if (!row) return;
        var cid = resolveId(row.contactId, row.name);
        if (!cid) return;
        mapped.push({
          contactId: cid,
          rank: Math.max(1, Number(row.rank) || mapped.length + 1),
          note: scrubMatchProse(row.note, session)
        });
      });
      if (mapped.length < (session.participants || []).length) {
        var used = {};
        mapped.forEach(function (r) { used[r.contactId] = true; });
        (session.participants || []).forEach(function (p) {
          if (used[p.contactId]) return;
          mapped.push({ contactId: p.contactId, rank: mapped.length + 1, note: '' });
        });
      }
      mapped.sort(function (a, b) { return a.rank - b.rank; });
      mapped.forEach(function (r, i) { r.rank = i + 1; });
      result.rankings = mapped;
    }
    return result;
  }

  function normalizeReactions(raw, session) {
    var obj = raw && typeof raw === 'object' ? raw : {};
    var list = Array.isArray(obj.reactions) ? obj.reactions : [];
    var byId = {};
    list.forEach(function (rx) {
      if (!rx) return;
      var cid = String(rx.contactId || '').trim();
      var name = String(rx.name || '').trim();
      if (!cid) {
        var hit = (session.participants || []).find(function (p) {
          return p.name === name || (name && String(p.name).indexOf(name) >= 0);
        });
        if (hit) cid = hit.contactId;
      }
      if (!cid) return;
      byId[cid] = {
        contactId: cid,
        name: name || ((session.participants || []).find(function (p) {
          return String(p.contactId) === cid;
        }) || {}).name || '角色',
        text: scrubMatchProse(rx.text, session)
      };
    });
    return (session.participants || []).map(function (p) {
      if (byId[p.contactId] && byId[p.contactId].text) return byId[p.contactId];
      return {
        contactId: p.contactId,
        name: p.name,
        text: byId[p.contactId] ? byId[p.contactId].text : ''
      };
    }).filter(function (rx) {
      return rx.text;
    });
  }

  function runMatch(session) {
    if (!session) return Promise.reject(new Error('场次无效'));
    var store = global.miyaMatchStore;
    var v = store.validateParticipants(session.mode, session.participants);
    if (!v.ok) return Promise.reject(new Error(v.message));

    var ctx = buildFullContext(session);
    var userPrompt = [
      '请根据以下设定撰写比赛全过程，并给出结果 JSON。',
      '',
      ctx.text,
      '',
      '再次强调：',
      '- beats 要细、要分段；旁白与对白分行；对白格式为 角色名：「台词」；',
      '- 正文只写显示名，禁止写入任何 contactId / ct_ 编码；',
      '- rankings 等结果字段才使用真实 contactId；',
      '- 只输出 JSON。'
    ].join('\n');

    return callApi(systemPromptMatch(), userPrompt, { max_tokens: 16000, timeoutMs: 240000 }).then(function (raw) {
      var parsed = extractJson(raw);
      if (!parsed) throw new Error('赛程解析失败，请重试');
      var result = normalizeMatchResult(parsed, session);
      if (!result.narrative) throw new Error('赛程正文为空，请重试');
      if (session.mode === 'solo' && (!result.rankings || !result.rankings.length)) {
        throw new Error('排名缺失，请重试');
      }
      if (session.mode === 'team' && !result.winnerTeam) {
        throw new Error('胜方缺失，请重试');
      }
      return result;
    });
  }

  function runReactions(session) {
    if (!session || !session.result) return Promise.reject(new Error('请先完成比赛'));
    var ctx = buildFullContext(session);
    var result = session.result;
    var outcomeLines = ['【最终结果（已定稿）】'];
    if (session.mode === 'team') {
      outcomeLines.push('胜方：阵营' + result.winnerTeam);
      outcomeLines.push('MVP contactId：' + (result.mvpContactId || '无'));
    } else {
      (result.rankings || []).forEach(function (r) {
        outcomeLines.push('第' + r.rank + '名 contactId=' + r.contactId + (r.note ? ' · ' + r.note : ''));
      });
    }
    outcomeLines.push('');
    outcomeLines.push('【奖品定稿】');
    var prizes = session.prizes || {};
    if (session.mode === 'team') {
      outcomeLines.push('胜方：' + (prizes.teamWin || '无'));
      outcomeLines.push('败方：' + (prizes.teamLose || '无'));
      outcomeLines.push('MVP：' + (prizes.mvp || '无'));
    } else {
      (result.rankings || []).forEach(function (r) {
        outcomeLines.push('第' + r.rank + '名奖品：' + ((prizes.soloRanks || [])[r.rank - 1] || '无'));
      });
    }
    var narrativeFull = '';
    if (Array.isArray(result.beats) && result.beats.length) {
      narrativeFull = result.beats.join('\n\n');
    } else {
      narrativeFull = String(result.narrative || '').trim();
    }

    var userPrompt = [
      '请为每位参赛者写最终感想 JSON。',
      '',
      ctx.text,
      '',
      outcomeLines.join('\n'),
      '',
      '【完整赛程】',
      narrativeFull,
      '',
      '只输出 JSON，reactions 必须覆盖全部参赛 contactId。'
    ].join('\n');

    return callApi(systemPromptReactions(), userPrompt, { max_tokens: 6000, timeoutMs: 180000 }).then(function (raw) {
      var parsed = extractJson(raw);
      if (!parsed) throw new Error('感想解析失败，请重试');
      var reactions = normalizeReactions(parsed, session);
      if (!reactions.length) throw new Error('感想为空，请重试');
      return reactions;
    });
  }

  global.miyaMatchBridge = {
    runMatch: runMatch,
    runReactions: runReactions,
    proposeMatch: proposeMatch,
    buildFullContext: buildFullContext,
    resolveProfile: resolveProfile,
    scrubMatchProse: scrubMatchProse,
    parseMatchBeatSegments: parseMatchBeatSegments,
    collectSpeakerNames: collectSpeakerNames
  };
})(typeof window !== 'undefined' ? window : this);
