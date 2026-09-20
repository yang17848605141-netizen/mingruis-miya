(function (global) {
    'use strict';

    var USER_MSG_JOIN = '\n\n';

    function eng() {
        return global.miyaChatEngine;
    }

    function apStore() {
        return global.MiyaAppointmentStore;
    }

    function clampInt(v, lo, hi, fb) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fb;
        return Math.min(hi, Math.max(lo, n));
    }

    function buildPersonRulesBlock(contact, profile, preset) {
        var roleName = String((contact && contact.name) || '角色');
        var userName = String((profile && profile.name) || '用户');
        var roleP = (preset && preset.rolePerson) || 'third';
        var userP = (preset && preset.userPerson) || 'second';

        var roleDesc = {
            first:
                '描写「' +
                roleName +
                '」的动作、心理、外貌时一律用第一人称「我」（角色在自述）',
            second:
                '描写「' +
                roleName +
                '」时用第二人称「你」——仅当台词里旁人称呼该角色，叙述体仍优先第三人称',
            third:
                '描写「' +
                roleName +
                '」的动作、心理、外貌时一律用第三人称（他/她/「' +
                roleName +
                '」），禁止用「你」指代' +
                roleName +
                '本人'
        };
        var userDesc = {
            first: '面对用户「' + userName + '」时以用户为第一人称「我」叙述（极少用）',
            second: '对用户「' + userName + '」的称呼、对白、互动一律用第二人称「你」',
            third:
                '提及用户「' + userName + '」时用第三人称（他/她/名字），不用「你」称呼用户'
        };

        return (
            '【人称·严格执行】\n' +
            '你扮演「' +
            roleName +
            '」，正文须遵守：\n' +
            '1、' +
            (roleDesc[roleP] || roleDesc.third) +
            '。\n' +
            '2、' +
            (userDesc[userP] || userDesc.second) +
            '。\n' +
            '3、' +
            roleName +
            '≠用户：不得用称呼用户的「你」来写' +
            roleName +
            '的行为或心理；用户才用「你」（当用户人称设为第二人称时）。'
        );
    }

    function appointmentWorldbookExtraBindings(preset) {
        return ((preset && preset.worldbookBindings) || [])
            .map(function (b) {
                if (!b || typeof b !== 'object') return null;
                var entryId = String(b.entryId || b.id || '').trim();
                if (!entryId) return null;
                return { type: 'entry', entryId: entryId, force: true };
            })
            .filter(Boolean);
    }

    function appointmentWorldbookOpts(extra) {
        var opts = { scopeMode: 'appointment', promptContext: 'offline', includeAllBoundLocal: true };
        if (extra && typeof extra === 'object') {
            if (Array.isArray(extra.roleIds) && extra.roleIds.length) {
                opts.roleIds = extra.roleIds
                    .map(function (x) {
                        return String(x || '').trim();
                    })
                    .filter(Boolean);
            }
        }
        return opts;
    }

    function resolveSessionCastContacts(st, sess, primaryContact) {
        var cast = Array.isArray(sess && sess.cast) ? sess.cast : [];
        var list = [];
        var seen = Object.create(null);
        cast.forEach(function (row) {
            var cid = String((row && row.contactId) || '').trim();
            if (!cid || seen[cid] || !st || !st.findContact) return;
            var c = st.findContact(cid);
            if (c) {
                seen[cid] = true;
                list.push(c);
            }
        });
        if (!list.length && primaryContact) list = [primaryContact];
        return list;
    }

    function mergeWorldbookBundles(bundles) {
        var front = [];
        var layers = [];
        var back = [];
        var matched = [];
        var seenText = Object.create(null);
        function pushUnique(arr, text) {
            var t = String(text || '').trim();
            if (!t || seenText[t]) return;
            seenText[t] = true;
            arr.push(t);
        }
        (bundles || []).forEach(function (b) {
            if (!b) return;
            (b.frontLayers || []).forEach(function (t) {
                pushUnique(front, t);
            });
            (b.layers || []).forEach(function (t) {
                pushUnique(layers, t);
            });
            (b.backLayers || []).forEach(function (t) {
                pushUnique(back, t);
            });
            if (Array.isArray(b.matched)) matched = matched.concat(b.matched);
        });
        return { frontLayers: front, layers: layers, backLayers: back, matched: matched };
    }

    function appendLayerListLocal(parts, layers) {
        if (!Array.isArray(layers)) return parts;
        layers.forEach(function (layer) {
            var t = String(layer || '').trim();
            if (t) parts.push(t);
        });
        return parts;
    }

    function buildWorldbookLayers(contact, contextText, preset) {
        var e = eng();
        if (e && typeof e.buildWorldbookBundle === 'function') {
            return e.buildWorldbookBundle(
                contact,
                contextText,
                appointmentWorldbookExtraBindings(preset),
                appointmentWorldbookOpts()
            ).layers;
        }
        var builder = global.miyaWorldbookPrompt || global.miyaBuildWorldbookPrompt;
        if (!builder || typeof builder.buildWorldbookPrompt !== 'function') return [];
        var roleIds =
            e && typeof e.collectContactRoleIds === 'function'
                ? e.collectContactRoleIds(contact)
                : [];
        if (!roleIds.length && contact) {
            ['characterId', 'chronicleId', 'id', 'contactId'].forEach(function (k) {
                var v = String(contact[k] || '').trim();
                if (v) roleIds.push(v);
            });
        }
        var result = builder.buildWorldbookPrompt({
            roleId: roleIds[0] || '',
            roleIds: roleIds,
            roleName: contact && contact.name,
            contextText: contextText || '',
            skipChronicleProfile: true,
            extraBindings: appointmentWorldbookExtraBindings(preset),
            scopeMode: 'appointment'
        });
        var sec = result && result.sections ? result.sections : {};
        var layers = [sec.global, sec.local]
            .map(function (x) {
                return String(x || '').trim();
            })
            .filter(Boolean);
        if (!layers.length && result && result.text) {
            var fullText = String(result.text || '').trim();
            if (fullText) layers = [fullText];
        }
        return layers;
    }

    /** 世界书关键词匹配：纳入线上近期对话 + 跨场景记忆 + 当前场景正文，避免只读当轮输入 */
    function buildWorldbookContextText(canonId, sessionMsgs, userText, settings, cross) {
        var parts = [];
        var st = global.miyaChatStore;
        var limit =
            settings && settings.memoryCount
                ? Math.min(500, Math.max(1, parseInt(settings.memoryCount, 10) || 40))
                : 40;
        if (st && typeof st.getMessages === 'function' && canonId) {
            st.getMessages(canonId)
                .filter(function (m) {
                    return m && !m.deleted && String(m.content || '').trim();
                })
                .slice(-limit)
                .forEach(function (m) {
                    parts.push(String(m.content || '').trim());
                });
        }
        if (cross) {
            if (cross.summaryText) parts.push(String(cross.summaryText));
            (cross.slotItems || []).forEach(function (it) {
                var body = String((it && it.content) || '').trim();
                if (body) parts.push(body);
            });
        }
        (sessionMsgs || []).forEach(function (m) {
            var body = String((m && m.content) || '').trim();
            if (body) parts.push(body);
        });
        var extra = String(userText || '').trim();
        if (extra) parts.push(extra);
        return parts.filter(Boolean).join('\n');
    }

    function renderContactProfileBlock(contact) {
        var cs = global.miyaContactsStore;
        if (!cs || !contact) return '';
        var rid = String(contact.characterId || contact.id || contact.chronicleId || '').trim();
        if (rid && typeof cs.renderChronicleBlock === 'function') {
            var fromStore = String(cs.renderChronicleBlock(rid) || '').trim();
            if (fromStore) return fromStore;
        }
        if (rid && typeof cs.findCharacter === 'function') {
            var row = cs.findCharacter(rid);
            if (row && row.name) {
                var lines = ['【角色·档案·' + String(row.name) + '】'];
                if (row.gender) lines.push('- 性别: ' + row.gender);
                if (row.age) lines.push('- 年龄: ' + row.age);
                if (row.birthday) lines.push('- 生日: ' + row.birthday);
                if (row.persona) lines.push('- 人设与背景: ' + row.persona);
                if (lines.length > 1) return lines.join('\n');
            }
        }
        var name = String(contact.name || '').trim();
        if (!name) return '';
        return '【角色·档案·' + name + '】';
    }

    function renderProfileBlock(profile) {
        if (!profile) return '';
        var lines = ['【用户身份·' + String(profile.name || '用户') + '】'];
        if (profile.gender) lines.push('- 性别: ' + profile.gender);
        if (profile.age) lines.push('- 年龄: ' + profile.age);
        if (profile.persona) lines.push('- 人设: ' + profile.persona);
        return lines.join('\n');
    }

    function buildNovelWriterBlock(contact, profile, preset) {
        var roleName = String((contact && contact.name) || '角色');
        var userName = String((profile && profile.name) || '用户');
        var styleHint = String((preset && preset.styleGuide) || '').trim();
        return (
            '【叙事引擎·线下长篇】\n' +
            '你正在写一段与用户共同推进的线下长篇叙事，不是即时聊天。\n' +
            '须完整消化联系人档案、世界书与下文文风要求后再落笔。\n' +
            '角色（' +
            roleName +
            '）与用户（' +
            userName +
            '）的人设、口吻与心理必须分开，禁止混写。\n' +
            '世界书分两类：绑定该联系人的设定，以及调参里额外挂载的规则/番外；在 <thinking> 中先归类再写。\n' +
            (styleHint ? '文风（现场调参）：' + styleHint : '文风以【文风·硬性要求·线下】为准。')
        );
    }

    function buildAppointmentModeBlock(contact, profile, castContacts) {
        var cast = Array.isArray(castContacts) && castContacts.length ? castContacts : [contact];
        var names = cast
            .map(function (c) {
                return String((c && c.name) || '').trim();
            })
            .filter(Boolean);
        var multi = names.length > 1;
        var lines = [
            '【对话模式·线下叙事】',
            multi
                ? '你正在写一场多人线下长篇互动（小说式正文，非聊天气泡）。本场出演：' +
                  names.join('、') +
                  '；与用户「' +
                  String((profile && profile.name) || '用户') +
                  '」共同推进。'
                : '你正在以「' +
                  String((contact && contact.name) || '对方') +
                  '」的身份，与「' +
                  String((profile && profile.name) || '用户') +
                  '」进行线下长篇互动（小说式正文，非聊天气泡）。',
            '- 正文像小说：每个自然段写满多句后空一行；禁止一行一句、禁止碎片化短行。',
            '- 禁止线上专属格式（语音-/表情包-/引用-等）。',
            '- 可用 <thinking>...</thinking> 简短思考。'
        ];
        if (multi) {
            lines.push('- 多人同场：每位出演角色言行须符合各自人设与关系；对白可标示说话人，但不要写成聊天气泡。');
            lines.push('- 主视角联系人：「' + String((contact && contact.name) || names[0] || '对方') + '」（调参文风与人称以其为准）。');
        }
        lines.push(
            '- 提示词顺序：模式 → 联系人档案 → 用户 → 关系 → 感知 → 世界书说明 → 世界书正文 → 文风人称 → 跨场景记忆 → 上下文 → 【末尾·用户元指令】（$ 行与审美母题，最高优先级）。'
        );
        lines.push('- 世界书注入规则见下文【世界书·本场读取说明】。');
        return lines.join('\n');
    }

    function buildOfflineOperationRules(contact, profile, wordCount, castContacts) {
        var cast = Array.isArray(castContacts) && castContacts.length ? castContacts : [contact];
        var names = cast
            .map(function (c) {
                return String((c && c.name) || '').trim();
            })
            .filter(Boolean);
        var multi = names.length > 1;
        var roleName = String((contact && contact.name) || '对方');
        var userName = String((profile && profile.name) || '用户');
        var base =
            '【运转规则·线下】\n' +
            (multi
                ? '1、本场出演 ' +
                  names.join('、') +
                  '，均真实存在，须消化各自人设与世界书；温柔底色，禁止油腻、辱骂、控制型表达。\n'
                : '1、你是' +
                  roleName +
                  '，真实存在，须消化人设与世界书；温柔底色，禁止油腻、辱骂、控制型表达。\n') +
            '2、你清楚' +
            userName +
            '是谁，关系与情绪须一致。\n' +
            '3、严格遵守上文的【字数·硬性要求】。\n' +
            '4、禁止输出 ⧗、› 或 API 时间戳；禁止线上聊天气泡格式。\n' +
            '5、回顾近期跨场景记忆，勿复读相同开场与句式。\n' +
            '6、若用户要求番外、小剧场、HTML 页或其它特殊玩法，以该轮 $ 元指令为准；见提示词最末【用户元指令·线下·最高优先级】；$ 行与审美母题优先于字数与文风（仍须贴合人设与世界书，不得崩人设）。';
        var statusApi = global.MiyaOfflineStatus;
        if (statusApi && typeof statusApi.isEnabled === 'function' && statusApi.isEnabled()) {
            base +=
                '\n7、正文结束后必须按【线下格式规则·状态栏】完整输出 <miyastatus>...</miyastatus>；状态不得写入正文。';
        }
        return base;
    }

    function buildWorldbookScopeBlock(contact, preset) {
        var roleName = String((contact && contact.name) || '当前联系人');
        var lines = [
            '【世界书·本场读取说明】',
            '线下场景注入下列词条；紧挨其后的【世界书·前/中/后】等为实际正文，须全部消化并在 <thinking> 与叙事中落实：',
            '',
            '1、全局世界书（对所有联系人均可生效，不绑定角色）',
            '　· 「全软件」范围：所有 API 场景均可注入；注入位置由词条深度（前/中/后）决定，不再强制顶置。',
            '　· 「仅线下」「线上线下」等范围：仅在线下场景参与匹配；须关键词命中（无关键词则始终参与）。',
            '',
            '2、绑定该联系人的局部世界书（须生效范围包含线下）',
            '　· 「全软件」：绑定「' + roleName + '」后始终纳入（位置同样由深度决定）。',
            '　· 「仅线下」「线上线下」等：仅在线下场景参与；无关键词则始终纳入，有关键词须命中。',
            '　· 「仅线上」范围：本场不纳入。',
            '',
            '3、调参里额外挂载的词条',
            '　· 指线下「调参 → 额外挂世界书」里为本联系人勾选的词条，一律强制纳入。',
            '　· 不依赖关键词是否命中，须优先遵守其设定。'
        ];
        var bindings = (preset && preset.worldbookBindings) || [];
        if (bindings.length) {
            var wbStore = global.miyaWorldbookStore;
            var entryMap = {};
            if (wbStore && typeof wbStore.listEntries === 'function') {
                wbStore.listEntries().forEach(function (ent) {
                    if (ent && ent.id) entryMap[String(ent.id)] = ent;
                });
            }
            var names = bindings
                .map(function (b, i) {
                    var ent = entryMap[String((b && b.entryId) || '')];
                    var label = (ent && ent.name) || String((b && b.entryId) || '').trim();
                    return label ? String(i + 1) + '）' + label : '';
                })
                .filter(Boolean);
            if (names.length) {
                lines.push('', '【本场额外挂载】' + names.join('；') + '。');
            }
        } else {
            lines.push('', '【本场额外挂载】（未配置；使用上述全局与局部世界书。）');
        }
        return lines.join('\n');
    }

    function resolveOutputWordCount(preset) {
        return clampInt(preset && preset.outputWordCount, 80, 4000, 2000);
    }

    function buildWordCountRules(wordCount) {
        var n = resolveOutputWordCount({ outputWordCount: wordCount });
        var minW = Math.max(80, Math.floor(n * 0.88));
        var maxW = Math.min(4000, Math.ceil(n * 1.12));
        return (
            '【字数·硬性要求】\n' +
            '本轮「角色正文」（不含 <thinking>）必须写满约 ' +
            String(n) +
            ' 个汉字，允许区间 ' +
            String(minW) +
            '–' +
            String(maxW) +
            ' 字。\n' +
            '明显低于下限视为敷衍，明显高于上限视为拖沓；请自行删改后再输出。\n' +
            '排版：每个自然段写满多句后，用空一行（两个换行）分隔下一段；禁止每写一句就单独换行。'
        );
    }

    function getGlobalUserMetaPrompt() {
        var chatEng = eng();
        if (chatEng && typeof chatEng.getGlobalPrompt === 'function') {
            return String(chatEng.getGlobalPrompt() || '').trim();
        }
        if (typeof global.miyaGetGlobalBreakPrompt === 'function') {
            return String(global.miyaGetGlobalBreakPrompt() || '').trim();
        }
        try {
            return String(localStorage.getItem('miya-global-break-prompt') || '').trim();
        } catch (e) {
            return '';
        }
    }

    function extractTurnDollarMeta(text) {
        var hp = htmlApi();
        if (hp && typeof hp.collectMetaDirectiveText === 'function') {
            return String(hp.collectMetaDirectiveText(text).metaOnly || '').trim();
        }
        var metaLines = [];
        String(text || '')
            .split(/\r?\n/)
            .forEach(function (line) {
                var trimmed = String(line || '').trim();
                if (/^[$＄]/.test(trimmed)) {
                    metaLines.push(trimmed.replace(/^[$＄]\s*/, ''));
                }
            });
        return metaLines.join('\n');
    }

    /** 线下：用户元指令置于整轮 messages 最末，优先级最高 */
    function buildOfflineUserMetaTailBlock(turnUserText) {
        var turnMeta = extractTurnDollarMeta(turnUserText);
        var globalMeta = getGlobalUserMetaPrompt();
        if (!turnMeta && !globalMeta) return '';
        var lines = [
            '【用户元指令·线下·最高优先级】',
            '若与上文系统提示、文风、字数、世界书等冲突，一律以本段为准。',
            '仍须贴合联系人档案与世界书核心设定，不得违背人设底线。'
        ];
        if (globalMeta) {
            lines.push('', '【审美母题·全局元指令】', globalMeta);
        }
        if (turnMeta) {
            lines.push('', '【本轮用户消息·$ 元指令】', turnMeta);
        }
        return lines.join('\n');
    }

    function appendOfflineUserMetaTail(apiMessages, turnUserText) {
        var block = buildOfflineUserMetaTailBlock(turnUserText);
        if (!block || !Array.isArray(apiMessages)) return;
        apiMessages.push({ role: 'system', content: block });
    }

    function htmlApi() {
        return global.MiyaChatHtml || null;
    }

    /** 本轮用户正文：优先参数，否则取会话最后一条 user */
    function resolveTurnUserText(messages, extra) {
        var t = String(extra || '').trim();
        if (t) return t;
        var list = Array.isArray(messages) ? messages : [];
        var i;
        for (i = list.length - 1; i >= 0; i--) {
            var m = list[i];
            if (m && m.role === 'user' && !m.deleted) {
                return String(m.content || '').trim();
            }
        }
        return '';
    }

    function finalizeAppointmentAssistantBody(parsed, htmlMode) {
        var body = String((parsed && parsed.content) || '').trim();
        if (!body) return { content: '', lines: [], renderAsHtml: false };
        var statusApi = global.MiyaOfflineStatus;
        if (statusApi && typeof statusApi.stripStatusFromText === 'function') {
            body = statusApi.stripStatusFromText(body);
        }
        var hpApi = htmlApi();
        if (htmlMode && hpApi && typeof hpApi.extractHtmlOnlyFromReply === 'function') {
            var hp = hpApi.extractHtmlOnlyFromReply(body);
            if (hp && hp.raw) {
                return {
                    content: hp.raw,
                    lines: [hp.raw],
                    renderAsHtml: true,
                    htmlRaw: hp.raw,
                    htmlPayload: hp
                };
            }
        }
        var lines = splitDisplayParagraphs(body);
        if (!lines.length) {
            var salvage = stripThinking(body);
            if (statusApi && typeof statusApi.stripStatusFromText === 'function') {
                salvage = statusApi.stripStatusFromText(salvage);
            }
            if (salvage) lines = [salvage];
        }
        return {
            content: lines.join('\n\n'),
            lines: lines,
            renderAsHtml: false
        };
    }

    function buildMandatoryStyleBlock(contact, profile, preset) {
        var roleName = String((contact && contact.name) || '角色');
        var userName = String((profile && profile.name) || '用户');
        var style = String((preset && preset.styleGuide) || '').trim();
        var roleP = (preset && preset.rolePerson) || 'third';
        var userP = (preset && preset.userPerson) || 'second';
        var personMap = { first: '第一人称', second: '第二人称', third: '第三人称' };
        if (!style) {
            style =
                '白描、克制、有画面感；段与段之间空一行；禁止油腻、霸道腔；亲密须符合当下关系。';
        }
        return [
            '【文风·硬性要求·线下】',
            '你必须逐项严格执行「线下调参」中的文风与人称，三项缺一不可，任何一项都不得忽略。',
            '正文排版：必须分段；每个自然段写满多句后空一行再写下一段；严禁整段不分段或每句单独换行。',
            '角色或用户说的话建议用中文双引号「」或“”包裹以便阅读。',
            '- 用户称呼：' + userName,
            '- 角色称呼：' + roleName,
            '- 用户人称：' + (personMap[userP] || personMap.second),
            '- 角色人称：' + (personMap[roleP] || personMap.third),
            '- 字数：见【字数·硬性要求】',
            '- 文风指令：' + style,
            '【冲突解决（强制）】若本段与其它系统规则在人称、字数或叙事格式上不一致：一律以本段为准。',
            '现在开始严格执行。'
        ].join('\n');
    }

    function buildGenerationTailUserNote(wordCount) {
        var n = resolveOutputWordCount({ outputWordCount: wordCount });
        return (
            '（请接续本场线下叙事：每个自然段写满多句后空一行；全文约' +
            String(n) +
            '个汉字，不得明显过短或过长）'
        );
    }

    function sessionSummaryRanges(session) {
        return ((session && session.summaryList) || []).map(function (row) {
            return {
                start: clampInt(row.startIndex, 0, 9999999, 0),
                end: clampInt(row.endIndex, 0, 9999999, 0)
            };
        });
    }

    function messageIndexCovered(idx, ranges) {
        if (!idx || !ranges.length) return false;
        for (var i = 0; i < ranges.length; i++) {
            var r = ranges[i];
            if (r.start && r.end && idx >= r.start && idx <= r.end) return true;
        }
        return false;
    }

    function buildSessionSummaryBlock(session) {
        var list = (session && session.summaryList) || [];
        if (!list.length) return '';
        var items = list
            .slice()
            .sort(function (a, b) {
                return (a.startIndex || 0) - (b.startIndex || 0);
            })
            .map(function (row, i) {
                var body = String((row && row.content) || '').trim();
                if (!body) return '';
                return (
                    '【线下场次总结' +
                    String(i + 1) +
                    ' · 第' +
                    String(row.startIndex || '?') +
                    '–' +
                    String(row.endIndex || '?') +
                    '条】\n' +
                    body
                );
            })
            .filter(Boolean);
        if (!items.length) return '';
        return '【当前场景·已总结段落】\n' + items.join('\n\n');
    }

    function appendSessionHistory(apiMessages, messages, chatSettings, session) {
        var buf = [];
        var aw = global.MiyaChatAwareness;
        var ranges = sessionSummaryRanges(session);
        function flushUser() {
            if (!buf.length) return;
            apiMessages.push({ role: 'user', content: buf.join(USER_MSG_JOIN) });
            buf = [];
        }
        (messages || []).forEach(function (m, i) {
            if (!m || m.deleted) return;
            if (m.role === 'system' && m.type === 'opening') {
                flushUser();
                var openingBody = String(m.content || '').trim();
                if (openingBody) {
                    apiMessages.push({
                        role: 'system',
                        content: '【本场线下·开场白】\n' + openingBody
                    });
                }
                return;
            }
            if (messageIndexCovered(i + 1, ranges)) return;
            var body = String(m.content || '').trim();
            if (!body) return;
            if (m.role === 'user') {
                var stamped =
                    aw && typeof aw.stampMessageForApi === 'function'
                        ? aw.stampMessageForApi(body, m, chatSettings, Date.now())
                        : body;
                buf.push(stamped);
                return;
            }
            flushUser();
            if (m.role === 'assistant') {
                var abody =
                    aw && typeof aw.stampMessageForApi === 'function'
                        ? aw.stampMessageForApi(body, m, chatSettings, Date.now())
                        : body;
                apiMessages.push({ role: 'assistant', content: abody });
            }
        });
        flushUser();
    }

    function buildAppointmentSystemPrompt(input) {
        var contact = input.contact;
        var profile = input.profile;
        var chatSettings = input.chatSettings;
        var preset = input.preset;
        var history = input.history || [];
        var contextText = String(input.contextText || '');
        var castContacts =
            Array.isArray(input.castContacts) && input.castContacts.length
                ? input.castContacts
                : contact
                  ? [contact]
                  : [];
        var parts = [];
        var aw = global.MiyaChatAwareness;
        var st = global.miyaChatStore;

        appendLayerListLocal(parts, input.worldbookFrontLayers);

        parts.push(buildAppointmentModeBlock(contact, profile, castContacts));
        parts.push(buildNovelWriterBlock(contact, profile, preset));

        castContacts.forEach(function (c) {
            var contactProfile = renderContactProfileBlock(c);
            if (contactProfile) parts.push(contactProfile);
            if (aw && typeof aw.buildRelationshipLine === 'function') {
                var settingsFor = chatSettings;
                if (st && typeof st.findChatByContact === 'function' && c && c.id) {
                    var cChat = st.findChatByContact(c.id);
                    if (cChat && typeof st.getChatSettings === 'function') {
                        settingsFor = st.getChatSettings(cChat.id) || chatSettings;
                    }
                }
                var rel = aw.buildRelationshipLine(settingsFor, c);
                if (rel) {
                    parts.push(
                        castContacts.length > 1
                            ? '【与用户关系·' + String(c.name || '') + '】\n' + rel
                            : rel
                    );
                }
                var netBlock = aw.buildChronicleRelationshipBlock(c);
                if (netBlock) {
                    parts.push(
                        castContacts.length > 1
                            ? '【人际脉络·' + String(c.name || '') + '】\n' + netBlock
                            : netBlock
                    );
                }
            }
        });

        var userBlock = renderProfileBlock(profile);
        if (userBlock) parts.push(userBlock);
        if (eng() && typeof eng().buildAvatarRecognitionBlock === 'function') {
            var avatar = eng().buildAvatarRecognitionBlock(chatSettings, contact, profile);
            if (avatar) parts.push(avatar);
        }
        if (aw) {
            var timeRules = aw.buildTimeAwarenessRules(chatSettings, history, profile);
            if (timeRules) parts.push(timeRules);
            var placeRules = aw.buildPlaceAwarenessRules(chatSettings, contact, profile);
            if (placeRules) parts.push('【地点运转】\n' + placeRules);
            var weatherRules = aw.buildWeatherAwarenessRules(chatSettings);
            if (weatherRules) parts.push(weatherRules);
        }
        parts.push(buildWorldbookScopeBlock(contact, preset));
        var wbLayers = Array.isArray(input.worldbookLayers)
            ? input.worldbookLayers
            : buildWorldbookLayers(contact, contextText, preset);
        appendLayerListLocal(parts, wbLayers);
        parts.push(buildMandatoryStyleBlock(contact, profile, preset));
        parts.push(buildPersonRulesBlock(contact, profile, preset));
        parts.push(buildWordCountRules(preset && preset.outputWordCount));
        parts.push(buildOfflineOperationRules(contact, profile, preset && preset.outputWordCount, castContacts));
        var statusApi = global.MiyaOfflineStatus;
        if (
            statusApi &&
            typeof statusApi.isEnabled === 'function' &&
            statusApi.isEnabled() &&
            typeof statusApi.buildStatusRulesBlock === 'function'
        ) {
            var statusRules = statusApi.buildStatusRulesBlock(castContacts);
            if (statusRules) parts.push(statusRules);
        }
        return parts.filter(Boolean).join('\n\n');
    }

    /** 线下：优先用联系人绑定的用户面具，而非全局当前面具或会话创建时的面具 */
    function resolveProfileForContact(st, contact, chat) {
        if (!st) return null;
        var profiles = st.getProfiles ? st.getProfiles() : [];
        var boundId = '';
        if (contact && contact.defaultProfileId) {
            boundId = String(contact.defaultProfileId).trim();
        }
        if (!boundId && chat && chat.profileId) {
            boundId = String(chat.profileId).trim();
        }
        if (boundId) {
            var found = profiles.find(function (p) {
                return p && p.id === boundId;
            });
            if (found) return found;
        }
        return st.getActiveProfile ? st.getActiveProfile() : null;
    }

    function resolveProfileForChat(st, chat) {
        if (!st || !chat) return null;
        var contact = st.findContact ? st.findContact(chat.contactId) : null;
        return resolveProfileForContact(st, contact, chat);
    }

    function buildApiMessages(chatId, sessionId, userText, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var st = global.miyaChatStore;
        var aps = apStore();
        if (!st || !aps) return { error: 'store_missing', messages: [] };
        var chat = st.findChat(chatId);
        if (!chat) return { error: 'chat_not_found', messages: [] };
        var contact = st.findContact(chat.contactId);
        if (!contact) return { error: 'contact_not_found', messages: [] };
        var profile = resolveProfileForChat(st, chat);
        if (!profile) return { error: 'profile_missing', messages: [] };
        var sess = aps.getSession(chatId, sessionId);
        if (!sess) return { error: 'session_not_found', messages: [] };
        var memMod = global.MiyaAppointmentMemory;
        var canonId = chatId;
        if (memMod && typeof memMod.resolveCanonicalChatId === 'function') {
            canonId = memMod.resolveCanonicalChatId(chatId) || chatId;
        }
        var settings = st.getChatSettings ? st.getChatSettings(chatId) : null;
        if (canonId && canonId !== chatId && st.getChatSettings) {
            var canonSettings = st.getChatSettings(canonId);
            if (canonSettings) settings = canonSettings;
        }
        var preset = aps.resolvePresetForContact(chat.contactId);
        /* 全量镜像改到 open/leave/seal，避免每轮发送阻塞主线程 */
        var sessionMsgs = aps.getSessionMessages(chatId, sessionId);
        var slice = sessionMsgs.slice();
        var castContacts = resolveSessionCastContacts(st, sess, contact);
        var castRoleIds = castContacts
            .map(function (c) {
                return String((c && c.id) || '').trim();
            })
            .filter(Boolean);

        var mem = global.MiyaAppointmentMemory;
        var cross =
            mem && typeof mem.buildAppointmentCrossMemory === 'function'
                ? mem.buildAppointmentCrossMemory(canonId, contact, profile, settings)
                : null;
        var worldbookContextText = buildWorldbookContextText(canonId, slice, userText, settings, cross);

        var wbBundle = { layers: [], matched: [], frontLayers: [], backLayers: [] };
        var engRef = eng();
        if (engRef && typeof engRef.buildWorldbookBundle === 'function') {
            if (castContacts.length > 1) {
                var bundles = castContacts.map(function (c) {
                    var cPreset = aps.resolvePresetForContact(c.id);
                    return engRef.buildWorldbookBundle(
                        c,
                        worldbookContextText,
                        appointmentWorldbookExtraBindings(cPreset),
                        appointmentWorldbookOpts({ roleIds: [c.id] })
                    );
                });
                wbBundle = mergeWorldbookBundles(bundles);
            } else {
                wbBundle = engRef.buildWorldbookBundle(
                    contact,
                    worldbookContextText,
                    appointmentWorldbookExtraBindings(preset),
                    appointmentWorldbookOpts({ roleIds: castRoleIds })
                );
            }
        } else {
            wbBundle.layers = buildWorldbookLayers(contact, worldbookContextText, preset);
        }
        var extra = String(userText || '').trim();
        var turnUserText = resolveTurnUserText(slice, extra);
        var hpApiEarly = htmlApi();
        /* 线下 HTML 仅由用户 $ 元指令触发，不用世界书，避免误伤正常叙事 */
        var htmlFromUserMeta =
            hpApiEarly &&
            typeof hpApiEarly.userOfflineMetaRequestsHtml === 'function' &&
            hpApiEarly.userOfflineMetaRequestsHtml(turnUserText);
        var htmlMode = !!htmlFromUserMeta;

        var apiMessages = [];
        var systemContent = buildAppointmentSystemPrompt({
            contact: contact,
            profile: profile,
            chatSettings: settings,
            preset: preset,
            history: slice,
            contextText: worldbookContextText,
            worldbookFrontLayers: wbBundle.frontLayers,
            worldbookLayers: wbBundle.layers,
            castContacts: castContacts
        });
        apiMessages.push({ role: 'system', content: systemContent });

        if (mem && typeof mem.injectAppointmentCrossMemory === 'function') {
            mem.injectAppointmentCrossMemory(apiMessages, cross);
        } else if (cross) {
            if (cross.summaryText) {
                apiMessages.push({ role: 'system', content: cross.summaryText });
            }
            if (
                cross.slotItems &&
                cross.slotItems.length &&
                typeof mem.injectCrossMemoryToApiMessages === 'function'
            ) {
                mem.injectCrossMemoryToApiMessages(apiMessages, cross.slotItems, '线上及往期线下');
            }
        }

        appendSessionHistory(apiMessages, slice, settings, sess);

        if (extra) {
            var last = apiMessages[apiMessages.length - 1];
            if (last && last.role === 'user') {
                last.content = last.content ? last.content + USER_MSG_JOIN + extra : extra;
            } else {
                apiMessages.push({ role: 'user', content: extra });
            }
        }

        if (engRef && typeof engRef.appendWorldbookBackMessages === 'function') {
            engRef.appendWorldbookBackMessages(apiMessages, wbBundle.backLayers);
        } else {
            (wbBundle.backLayers || []).forEach(function (layer) {
                var t = String(layer || '').trim();
                if (t) apiMessages.push({ role: 'system', content: t });
            });
        }

        if (htmlMode && hpApiEarly) {
            apiMessages.push({
                role: 'system',
                content: hpApiEarly.buildHtmlGenerationRules({
                    mode: 'offline',
                    fromUserMeta: true
                })
            });
        }

        if (!htmlMode) {
            var tailNote = buildGenerationTailUserNote(preset && preset.outputWordCount);
            var tail = apiMessages[apiMessages.length - 1];
            if (tail && tail.role === 'user') {
                var cur = String(tail.content || '').trim();
                if (
                    cur.indexOf('请接续本场线下叙事') < 0 &&
                    cur.indexOf('请接续线下长剧情') < 0 &&
                    cur.indexOf('请继续线下长剧情') < 0
                ) {
                    tail.content = cur ? cur + USER_MSG_JOIN + tailNote : tailNote;
                }
            } else {
                apiMessages.push({ role: 'user', content: tailNote });
            }
        }

        appendOfflineUserMetaTail(apiMessages, turnUserText);

        return {
            messages: apiMessages,
            contact: contact,
            profile: profile,
            chat: chat,
            session: sess,
            preset: preset,
            htmlMode: !!htmlMode
        };
    }

    function normalizeBaseUrl(base) {
        if (eng() && global.miyaChatEngine) {
            /* duplicate from engine - use config */
        }
        var t = String(base || '').trim().replace(/\/+$/, '');
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

    function getApiConfig() {
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        return {};
    }

    function appointmentStreamEnabled(cfg) {
        var c = cfg && typeof cfg === 'object' ? cfg : getApiConfig();
        return c.appointmentStream !== false;
    }

    function normalizeMessageContent(content) {
        if (content == null) return '';
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            var parts = [];
            content.forEach(function (part) {
                if (part == null) return;
                if (typeof part === 'string') {
                    if (part) parts.push(part);
                    return;
                }
                if (typeof part === 'object') {
                    var t =
                        part.text != null
                            ? part.text
                            : part.content != null
                              ? part.content
                              : part.output_text != null
                                ? part.output_text
                                : part.value;
                    if (t != null && String(t)) parts.push(String(t));
                }
            });
            return parts.join('\n');
        }
        var s = String(content);
        return s === '[object Object]' ? '' : s;
    }

    function extractStreamParts(obj) {
        if (!obj || typeof obj !== 'object') return { content: '', reasoning: '' };
        var ch = obj.choices && obj.choices[0];
        if (!ch) return { content: '', reasoning: '' };
        var d = ch.delta && typeof ch.delta === 'object' ? ch.delta : ch.message && typeof ch.message === 'object' ? ch.message : {};
        var out = { content: '', reasoning: '' };
        if (d.content != null) out.content = normalizeMessageContent(d.content);
        if (d.reasoning_content != null) out.reasoning = normalizeMessageContent(d.reasoning_content);
        else if (d.reasoning != null) out.reasoning = normalizeMessageContent(d.reasoning);
        if (!out.content && ch.text != null) out.content = normalizeMessageContent(ch.text);
        return out;
    }

    function buildStreamDisplayRaw(contentAcc, reasoningAcc) {
        var c = String(contentAcc || '');
        var r = String(reasoningAcc || '').trim();
        if (r && !/<thinking>/i.test(c) && !/＜thinking＞/i.test(c)) {
            return '<thinking>' + r + '</thinking>\n\n' + c;
        }
        return c;
    }

    function extractReplyContent(data) {
        var e = eng();
        if (e && typeof e.extractReplyContent === 'function') return e.extractReplyContent(data);
        if (!data) return '';
        if (data.choices && data.choices[0]) {
            var ch = data.choices[0];
            if (ch.message && ch.message.content != null) return normalizeMessageContent(ch.message.content).trim();
            if (ch.text != null) return normalizeMessageContent(ch.text).trim();
        }
        if (data.content != null) return normalizeMessageContent(data.content).trim();
        return '';
    }

    function parseAppointmentResponse(fullRaw, data) {
        var raw = String(fullRaw || '');
        var e = eng();
        var thinking = '';
        if (e && typeof e.extractThinkingFromResponse === 'function') {
            thinking = String(e.extractThinkingFromResponse(data, raw) || '').trim();
        }
        var parsed =
            e && typeof e.parseThinking === 'function' ? e.parseThinking(raw) : parseThinkingPayload(raw);
        if (!thinking && parsed.thinking) thinking = String(parsed.thinking || '').trim();
        var content = String(parsed.content || '').trim();
        if (!content) {
            var salvaged = salvageAppointmentParsedContent(raw, parsed);
            content = String(salvaged.content || '').trim();
            if (!thinking && salvaged.thinking) thinking = String(salvaged.thinking || '').trim();
        }
        if (!content && data) {
            var apiBody = extractReplyContent(data);
            if (apiBody) {
                var alt =
                    e && typeof e.parseThinking === 'function'
                        ? e.parseThinking(apiBody)
                        : parseThinkingPayload(apiBody);
                if (String(alt.content || '').trim()) content = String(alt.content || '').trim();
                if (!thinking && alt.thinking) thinking = String(alt.thinking || '').trim();
            }
            if (!content) {
                var msg = data.choices && data.choices[0] && data.choices[0].message;
                if (msg) {
                    var rsnPart =
                        msg.reasoning_content != null ? msg.reasoning_content : msg.reasoning;
                    if (rsnPart != null) {
                        var rsn = normalizeMessageContent(rsnPart).trim();
                        if (rsn) {
                            var rParsed =
                                e && typeof e.parseThinking === 'function'
                                    ? e.parseThinking(rsn)
                                    : parseThinkingPayload(rsn);
                            var rBody = String(rParsed.content || '').trim();
                            if (!rBody) rBody = String(stripThinkingFromBody(rsn) || '').trim();
                            if (rBody && rBody !== thinking) content = rBody;
                        }
                    }
                }
            }
        }
        return { thinking: thinking, content: content };
    }

    function findFirstThinkingClose(raw) {
        var src = String(raw || '');
        var tags = [/<\/thinking>/i, /＜\/thinking＞/i];
        var best = null;
        tags.forEach(function (re) {
            var m = src.match(re);
            if (m && m.index != null && (best == null || m.index < best.index)) {
                best = { index: m.index, length: m[0].length };
            }
        });
        return best;
    }

    function findFirstThinkingOpen(raw) {
        var src = String(raw || '');
        var tags = [/<thinking>/i, /＜thinking＞/i];
        var best = null;
        tags.forEach(function (re) {
            var m = src.match(re);
            if (m && m.index != null && (best == null || m.index < best.index)) {
                best = { index: m.index, length: m[0].length };
            }
        });
        return best;
    }

    function extractClosedThinkingText(raw) {
        var src = String(raw || '');
        var patterns = [
            /<thinking>([\s\S]*?)<\/thinking>/i,
            /＜thinking＞([\s\S]*?)＜\/thinking＞/i
        ];
        var i;
        for (i = 0; i < patterns.length; i++) {
            var m = src.match(patterns[i]);
            if (m && m[1] != null) return String(m[1]).trim();
        }
        return '';
    }

    function stripThinkingFromBody(text) {
        var e = eng();
        if (e && typeof e.parseThinking === 'function') {
            return String(e.parseThinking(text).content || '').trim();
        }
        return String(text || '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/<thinking>[\s\S]*$/gi, '')
            .replace(/＜thinking＞[\s\S]*?＜\/thinking＞/gi, '')
            .replace(/＜thinking＞[\s\S]*$/gi, '')
            .trim();
    }

    /** 思维链与正文严格分离：已闭合时正文只取首个 </thinking> 之后，避免流式时正文并入思维链 */
    function parseThinkingPayload(text) {
        var raw = String(text || '');
        if (!raw.trim()) return { thinking: '', content: '' };

        var close = findFirstThinkingClose(raw);
        if (close) {
            var eClose = eng();
            if (eClose && typeof eClose.parseThinking === 'function') {
                return eClose.parseThinking(raw);
            }
            return {
                thinking: extractClosedThinkingText(raw),
                content: stripThinkingFromBody(raw.slice(close.index + close.length))
            };
        }

        var open = findFirstThinkingOpen(raw);
        if (open) {
            var eOpen = eng();
            if (eOpen && typeof eOpen.parseThinking === 'function') {
                return eOpen.parseThinking(raw);
            }
            return {
                thinking: raw.slice(open.index + open.length).trim(),
                content: stripThinkingFromBody(raw)
            };
        }

        var e = eng();
        if (e && typeof e.parseThinking === 'function') {
            return e.parseThinking(raw);
        }
        return { thinking: '', content: raw.trim() };
    }

    function salvageAppointmentParsedContent(fullRaw, parsed) {
        var p = parsed && typeof parsed === 'object' ? parsed : { thinking: '', content: '' };
        var content = String(p.content || '').trim();
        if (content) return p;
        var raw = String(fullRaw || '').trim();
        if (!raw) return p;
        var e = eng();
        if (e && typeof e.parseThinking === 'function') {
            var alt = e.parseThinking(raw);
            if (String(alt.content || '').trim()) {
                return {
                    thinking: String(alt.thinking || p.thinking || '').trim(),
                    content: String(alt.content || '').trim()
                };
            }
        }
        var stripped = stripThinkingFromBody(raw);
        if (String(stripped || '').trim()) {
            return { thinking: String(p.thinking || '').trim(), content: stripped };
        }
        return { thinking: String(p.thinking || '').trim(), content: '' };
    }

    function stripThinking(text) {
        return parseThinkingPayload(text).content;
    }

    function stripTimelineFromParagraph(para) {
        var aw = global.MiyaChatAwareness;
        if (!aw || typeof aw.stripTimelinePrefixForDisplay !== 'function') {
            return String(para || '').trim();
        }
        return String(para || '')
            .split('\n')
            .map(function (line) {
                return aw.stripTimelinePrefixForDisplay(line);
            })
            .join('\n')
            .trim();
    }

    /** 线下正文分段：优先「空一行」为段；若无空行则按单行分段 */
    function splitDisplayParagraphs(text) {
        var body = stripThinking(text);
        body = String(body || '').trim();
        if (!body) return [];
        var parts = body
            .split(/\n\s*\n+/)
            .map(function (s) {
                return String(s || '').trim();
            })
            .filter(Boolean);
        if (parts.length <= 1 && /\n/.test(body)) {
            var lines = body
                .split(/\n/)
                .map(function (s) {
                    return String(s || '').trim();
                })
                .filter(Boolean);
            if (lines.length > 1) parts = lines;
        }
        parts = parts.map(stripTimelineFromParagraph).filter(Boolean);
        if (parts.length) return parts;
        var fallback = stripTimelineFromParagraph(body);
        return fallback ? [fallback] : [];
    }

    function splitDisplayLines(text) {
        var body = stripThinking(text);
        body = String(body || '').trim();
        if (!body) return [];
        return body
            .split(/\n/)
            .map(function (s) {
                return stripTimelineFromParagraph(s);
            })
            .filter(Boolean);
    }

    var replyInFlight = Object.create(null);

    function fetchAppointmentCompletion(url, headers, payload, handlers, useStream) {
        handlers = handlers && typeof handlers === 'object' ? handlers : {};
        var streamOn = useStream !== false;

        function emitDisplay(contentAcc, reasoningAcc) {
            var display = buildStreamDisplayRaw(contentAcc, reasoningAcc);
            if (handlers.onDelta) handlers.onDelta(display, display);
            return display;
        }

        if (!streamOn) {
            var body = Object.assign({}, payload);
            body.stream = false;
            return fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body)
            }).then(function (res) {
                if (!res.ok) {
                    return res.text().then(function (t) {
                        throw new Error('HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
                    });
                }
                return res.json().then(function (data) {
                    var msg = data && data.choices && data.choices[0] && data.choices[0].message;
                    var contentPart = msg ? normalizeMessageContent(msg.content) : '';
                    var reasoningPart = '';
                    if (msg) {
                        if (msg.reasoning_content != null) {
                            reasoningPart = normalizeMessageContent(msg.reasoning_content);
                        } else if (msg.reasoning != null) {
                            reasoningPart = normalizeMessageContent(msg.reasoning);
                        }
                    }
                    if (!contentPart) contentPart = extractReplyContent(data);
                    var display = buildStreamDisplayRaw(contentPart, reasoningPart);
                    if (handlers.onDelta) handlers.onDelta(display, display);
                    return { raw: display, data: data };
                });
            });
        }

        var req = Object.assign({}, payload);
        req.stream = true;
        return fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(req)
        }).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (t) {
                    throw new Error('HTTP ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
                });
            }
            if (!res.body || !res.body.getReader) {
                return res.json().then(function (data) {
                    var reply = extractReplyContent(data);
                    emitDisplay(reply, '');
                    return { raw: reply, data: data };
                });
            }
            var reader = res.body.getReader();
            var decoder = new TextDecoder('utf-8');
            var buffer = '';
            var contentAcc = '';
            var reasoningAcc = '';

            function pump() {
                return reader.read().then(function (result) {
                    if (result.done) {
                        var display = emitDisplay(contentAcc, reasoningAcc);
                        return { raw: display, data: null };
                    }
                    buffer += decoder.decode(result.value, { stream: true });
                    var parts = buffer.split('\n');
                    buffer = parts.pop() || '';
                    parts.forEach(function (line) {
                        var trimmed = line.trim();
                        if (!trimmed || trimmed === 'data: [DONE]') return;
                        if (trimmed.indexOf('data:') === 0) trimmed = trimmed.slice(5).trim();
                        if (!trimmed || trimmed === '[DONE]') return;
                        try {
                            var obj = JSON.parse(trimmed);
                            var delta = extractStreamParts(obj);
                            if (delta.reasoning) reasoningAcc += delta.reasoning;
                            if (delta.content) contentAcc += delta.content;
                            if (delta.reasoning || delta.content) emitDisplay(contentAcc, reasoningAcc);
                        } catch (e) {}
                    });
                    return pump();
                });
            }
            return pump();
        });
    }

    function maybeAutoSummary(chatId, sessionId, preset) {
        var aps = apStore();
        if (!aps) return;
        var trigger = clampInt(preset && preset.summaryTrigger, 0, 500, 15);
        if (trigger <= 0) return;
        var sess = aps.getSession(chatId, sessionId);
        if (!sess) return;
        var msgs = aps.getSessionMessages(chatId, sessionId);
        var last = aps.lastSummaryEnd(sess);
        if (last > msgs.length) last = 0;
        if (msgs.length - last < trigger) return;
        appointmentSummary(chatId, sessionId, { silent: true });
    }

    function appointmentSummary(chatId, sessionId, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var st = global.miyaChatStore;
        var aps = apStore();
        if (!st || !aps) return Promise.reject(new Error('store_missing'));
        var sess = aps.getSession(chatId, sessionId);
        if (!sess) return Promise.reject(new Error('session_not_found'));
        var chat = st.findChat(chatId);
        var contact = chat && st.findContact(chat.contactId);
        var profile = resolveProfileForChat(st, chat);
        var preset = aps.resolvePresetForContact(chat && chat.contactId);
        var msgs = aps.getSessionMessages(chatId, sessionId);
        var replaceId = String(opts.replaceSummaryId || '').trim();
        var start;
        var end;
        if (replaceId) {
            var existing = (sess.summaryList || []).find(function (r) {
                return r && r.id === replaceId;
            });
            if (!existing) return Promise.reject(new Error('summary_not_found'));
            start = clampInt(existing.startIndex, 1, 9999999, 0);
            end = clampInt(existing.endIndex, 1, 9999999, 0);
        } else if (opts.startIndex != null && opts.endIndex != null) {
            start = clampInt(opts.startIndex, 1, 9999999, 0);
            end = clampInt(opts.endIndex, 1, 9999999, 0);
        } else {
            start = (aps.lastSummaryEnd(sess) || 0) + 1;
            end = msgs.length;
        }
        if (end < start) return Promise.resolve(null);
        var lines = msgs.slice(start - 1, end).map(function (m) {
            var who =
                m.role === 'user'
                    ? (profile && profile.name) || '我'
                    : (contact && contact.name) || '对方';
            return who + '：' + String(m.content || '').trim();
        });
        if (!lines.length || !String(lines.join('\n')).trim()) {
            return Promise.resolve(null);
        }
        var cfg = getApiConfig();
        var baseUrl = normalizeBaseUrl(cfg.baseUrl);
        var apiKey = String(cfg.apiKey || '').trim();
        var model = String(cfg.model || '').trim();
        if (!baseUrl || !apiKey || !model) return Promise.reject(new Error('api_not_configured'));
        var prompt =
            String((preset && preset.summaryPrompt) || '').trim() ||
            '客观总结本段线下剧情，区分双方，100-280字。';
        var payload = {
            model: model,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: lines.join('\n') }
            ],
            temperature: 0.4
        };
        return fetch(baseUrl + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
            body: JSON.stringify(payload)
        })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var text = extractReplyContent(data);
                if (!text) throw new Error('empty_summary');
                var sum = aps.replaceOrAddSummary(chatId, sessionId, {
                    id: replaceId || undefined,
                    content: text,
                    startIndex: start,
                    endIndex: end
                });
                if (!opts.silent && global.miyaOfflineApp && global.miyaOfflineApp.toast) {
                    global.miyaOfflineApp.toast('已生成线下总结');
                }
                return sum;
            });
    }

    function yieldToPaint() {
        return new Promise(function (resolve) {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(function () {
                    requestAnimationFrame(resolve);
                });
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    function runAppointmentCompletion(chatId, sessionId, handlers) {
        handlers = handlers && typeof handlers === 'object' ? handlers : {};
        var aps = apStore();
        var st = global.miyaChatStore;
        var cfg = getApiConfig();
        var baseUrl = normalizeBaseUrl(cfg.baseUrl);
        var apiKey = String(cfg.apiKey || '').trim();
        var model = String(cfg.model || '').trim();
        if (!baseUrl || !apiKey || !model) {
            return Promise.reject(new Error('api_not_configured'));
        }
        if (handlers.onStatus) handlers.onStatus('coming');
        /* 先让「书写中」上屏，再拼 prompt，避免按发送瞬间卡死 */
        return yieldToPaint().then(function () {
            var built = buildApiMessages(chatId, sessionId, '', {});
            if (built.error) throw new Error(built.error);
            var url = baseUrl + '/chat/completions';
            var headers = {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + apiKey
            };
            var payload = {
                model: model,
                messages: built.messages,
                temperature: cfg.temperature != null ? Number(cfg.temperature) : 1
            };
            var useStream = appointmentStreamEnabled(cfg);
            return fetchAppointmentCompletion(
                url,
                headers,
                payload,
                {
                    onLine: handlers.onLine,
                    onDelta: handlers.onDelta
                },
                useStream
            ).then(function (completion) {
                var fullRaw =
                    completion && completion.raw != null
                        ? String(completion.raw)
                        : String(completion || '');
                var apiData = completion && completion.data != null ? completion.data : null;
                var parsed = parseAppointmentResponse(fullRaw, apiData);
                var thinking = String(parsed.thinking || '').trim();
                var htmlMode = !!built.htmlMode;
                var finalized = finalizeAppointmentAssistantBody(parsed, htmlMode);
                if (!finalized.lines.length && htmlMode) {
                    finalized = finalizeAppointmentAssistantBody(parsed, false);
                }
                var lines = finalized.lines || [];
                if (!lines.length) throw new Error('empty_reply');
                var content = finalized.content || lines.join('\n\n');
                var msgFields = { role: 'assistant', content: content };
                if (finalized.renderAsHtml) {
                    msgFields.renderAsHtml = true;
                    msgFields.htmlRaw = finalized.htmlRaw || content;
                }
                if (thinking) msgFields.thinking = thinking;
                var msg = aps.addMessage(chatId, sessionId, msgFields);
                var chatRow = st.findChat(chatId);
                var preset = aps.resolvePresetForContact(chatRow && chatRow.contactId);
                var sessAfter = aps.getSession(chatId, sessionId);
                var statusApi = global.MiyaOfflineStatus;
                if (
                    statusApi &&
                    typeof statusApi.isEnabled === 'function' &&
                    statusApi.isEnabled() &&
                    typeof statusApi.parseStatusFromReply === 'function' &&
                    typeof statusApi.appendStatusLog === 'function' &&
                    sessAfter
                ) {
                    var castForStatus = resolveSessionCastContacts(st, sessAfter, built.contact);
                    var pack = statusApi.parseStatusFromReply(fullRaw, castForStatus);
                    statusApi.appendStatusLog(sessAfter, pack);
                }
                maybeAutoSummary(chatId, sessionId, preset);
                return { message: msg, lines: lines, raw: fullRaw };
            });
        });
    }

    function sendAppointment(chatId, sessionId, userText, handlers) {
        handlers = handlers && typeof handlers === 'object' ? handlers : {};
        var text = String(userText || '').trim();
        if (!text) return Promise.reject(new Error('empty_message'));
        var key = String(chatId) + '::' + String(sessionId);
        if (replyInFlight[key]) return Promise.reject(new Error('busy'));

        var aps = apStore();
        var userMsg = aps.addMessage(chatId, sessionId, { role: 'user', content: text });
        if (!userMsg) return Promise.reject(new Error('session_not_found'));

        replyInFlight[key] = true;
        return runAppointmentCompletion(chatId, sessionId, handlers).finally(function () {
            delete replyInFlight[key];
            if (handlers.onStatus) handlers.onStatus('idle');
        });
    }

    function regenerateAppointment(chatId, sessionId, handlers) {
        handlers = handlers && typeof handlers === 'object' ? handlers : {};
        var key = String(chatId) + '::' + String(sessionId);
        if (replyInFlight[key]) return Promise.reject(new Error('busy'));
        replyInFlight[key] = true;
        return runAppointmentCompletion(chatId, sessionId, handlers).finally(function () {
            delete replyInFlight[key];
            if (handlers.onStatus) handlers.onStatus('idle');
        });
    }

    function isBusy(chatId, sessionId) {
        return !!replyInFlight[String(chatId) + '::' + String(sessionId)];
    }

    global.MiyaAppointmentEngine = {
        buildApiMessages: buildApiMessages,
        buildAppointmentSystemPrompt: buildAppointmentSystemPrompt,
        runAppointmentCompletion: runAppointmentCompletion,
        sendAppointment: sendAppointment,
        regenerateAppointment: regenerateAppointment,
        appointmentSummary: appointmentSummary,
        maybeAutoSummary: maybeAutoSummary,
        splitDisplayLines: splitDisplayLines,
        splitDisplayParagraphs: splitDisplayParagraphs,
        parseThinkingPayload: parseThinkingPayload,
        fetchAppointmentCompletion: fetchAppointmentCompletion,
        isBusy: isBusy,
        resolveProfileForContact: resolveProfileForContact,
        resolveProfileForChat: resolveProfileForChat
    };
})(window);
