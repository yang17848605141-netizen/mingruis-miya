(function (global) {
    'use strict';

    var HISTORY_LIMIT = 40;
    var USER_MSG_JOIN = ' / ';
    var THINKING_EXTRACT_SEQ = [
        /<thinking>([\s\S]*?)<\/thinking>/i,
        /＜thinking＞([\s\S]*?)＜\/thinking＞/i,
        /\<think\>([\s\S]*?)<\/think>/i,
        /<think>([\s\S]*?)<\/think>/i,
        /<think>([\s\S]*?)<\/redacted_thinking>/i,
        /<redacted_thinking>([\s\S]*?)<\/think>/i,
        /＜think＞([\s\S]*?)＜\/think＞/i,
        /<reasoning>([\s\S]*?)<\/reasoning>/i
    ];

    var THINKING_CLOSE_PATTERNS = [
        /<\/thinking>/gi,
        /＜\/thinking＞/gi,
        /\[\/thinking\]/gi,
        /［\/thinking］/gi,
        /【\/thinking】/gi,
        /<\/think>/gi,
        /＜\/think＞/gi,
        /\[\/think\]/gi,
        /<\/redacted_thinking>/gi,
        /<\/reasoning>/gi
    ];

    function isSemanticAutoTranslate(s) {
        return !!(s && s.autoTranslate);
    }

    function getTranslateTargetFromSettings(s) {
        var tr = global.MiyaChatTranslate;
        if (tr && typeof tr.normalizeTargetCode === 'function') {
            return tr.normalizeTargetCode(s && s.translateTarget);
        }
        return 'zh-CN';
    }

    function normalizeBaseUrl(base) {
        var t = String(base || '').trim().replace(/\/+$/, '');
        if (!t) return '';
        try {
            var u = new URL(t);
            var path = (u.pathname || '/').replace(/\/+$/, '');
            var segs = path.split('/').filter(Boolean);
            if (segs.length && segs[segs.length - 1].toLowerCase() === 'v1') {
                return u.origin + path;
            }
            if (!path || path === '/') return u.origin + '/v1';
            return u.origin + path + '/v1';
        } catch (e) {
            return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
        }
    }

    function getApiConfig() {
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        return {};
    }

    function getGlobalPrompt() {
        if (typeof global.miyaGetGlobalBreakPrompt === 'function') {
            return String(global.miyaGetGlobalBreakPrompt() || '').trim();
        }
        try {
            return String(localStorage.getItem('miya-global-break-prompt') || '').trim();
        } catch (e) {
            return '';
        }
    }

    function renderChronicleBlock(contact) {
        var cs = global.miyaContactsStore;
        if (!cs || !contact) return '';
        var rid = String(contact.characterId || contact.id || contact.chronicleId || '').trim();
        if (rid && typeof cs.renderChronicleBlock === 'function') {
            var fromStore = String(cs.renderChronicleBlock(rid) || '').trim();
            if (fromStore) return fromStore;
        }
        var row = cs.findCharacter ? cs.findCharacter(rid) : null;
        if (!row) return '';
        var lines = ['【角色·档案·' + String(row.name || contact.name) + '】'];
        if (row.gender) lines.push('- 性别: ' + row.gender);
        if (row.age) lines.push('- 年龄: ' + row.age);
        if (row.birthday) lines.push('- 生日: ' + row.birthday);
        if (row.persona) lines.push('- 人设与背景: ' + row.persona);
        return lines.length > 1 ? lines.join('\n') : '';
    }

    function renderProfileBlock(profile) {
        if (!profile) return '';
        var lines = ['【用户身份·我方·' + String(profile.name || '未命名') + '】'];
        if (profile.gender) lines.push('- 性别: ' + profile.gender);
        if (profile.birthday) lines.push('- 生日: ' + profile.birthday);
        if (profile.persona) lines.push('- 人设: ' + profile.persona);
        return lines.length > 1 ? lines.join('\n') : '';
    }

    function buildAvatarRecognitionBlock(chatSettings, contact, profile) {
        var ar = chatSettings && chatSettings.avatarRecognition;
        if (!ar || !ar.enabled) return '';
        var contactDesc = String(ar.contactDesc || '').trim();
        var profileDesc = String(ar.profileDesc || '').trim();
        var hasContactImg = !!String(ar.contactImageId || '').trim();
        var hasProfileImg = !!String(ar.profileImageId || '').trim();
        if (!contactDesc && !profileDesc && !hasContactImg && !hasProfileImg) return '';
        var roleName = String((contact && contact.name) || '对方').trim() || '对方';
        var userName = String((profile && profile.name) || '用户').trim() || '用户';
        var lines = ['【双方通话形象】'];
        if (hasContactImg) lines.push('- ' + roleName + '（角色）已上传通话形象参考图，按图呈现。');
        else if (contactDesc) lines.push('- ' + roleName + '（角色）通话形象: ' + contactDesc);
        if (hasProfileImg) lines.push('- ' + userName + '（用户）已上传通话形象参考图，按图呈现。');
        else if (profileDesc) lines.push('- ' + userName + '（用户）通话形象: ' + profileDesc);
        lines.push('请在对白与叙述中与此外观设定保持一致；双方形象已设定，勿随意改写外貌。');
        return lines.join('\n');
    }

    function appendDynamicAvatarContextBlock(parts, chatSettings, contact, profile) {
        if (
            !global.MiyaChatDynamicAvatar ||
            typeof global.MiyaChatDynamicAvatar.buildChatAvatarContextBlock !== 'function'
        ) {
            return;
        }
        var dynAvBlock = global.MiyaChatDynamicAvatar.buildChatAvatarContextBlock(
            chatSettings,
            contact,
            profile
        );
        if (dynAvBlock) parts.push(dynAvBlock);
    }

    function appendAlbumContextBlock(parts, profile, contact, chatSettings) {
        if (!global.MiyaChatAlbum || typeof global.MiyaChatAlbum.buildAlbumContextBlock !== 'function') {
            return;
        }
        var pid = profile && profile.id ? String(profile.id) : '';
        if (!pid) return;
        var cid = contact && contact.id ? String(contact.id) : '';
        var dynAv = (chatSettings && chatSettings.dynamicAvatar) || {};
        var block = global.MiyaChatAlbum.buildAlbumContextBlock(pid, cid, {
            charAvatarSwapEnabled: !!dynAv.charEnabled,
            userAvatarSwapEnabled: !!dynAv.userEnabled
        });
        if (block) parts.push(block);
    }

    function collectContactRoleIds(contact) {
        if (!contact) return [];
        var ordered = [];
        var seen = {};
        function add(v) {
            v = String(v || '').trim();
            if (!v || seen[v]) return;
            seen[v] = true;
            ordered.push(v);
        }
        add(contact.characterId);
        add(contact.chronicleId);
        var cs = global.miyaContactsStore;
        if (cs && typeof cs.findCharacter === 'function') {
            var row =
                cs.findCharacter(contact.characterId) ||
                cs.findCharacter(contact.chronicleId);
            if (row) {
                add(row.characterId);
                add(row.id);
            }
        }
        if (!ordered.length && contact.name && cs && typeof cs.listCharacters === 'function') {
            var wantName = String(contact.name || '').trim();
            cs.listCharacters().forEach(function (row) {
                if (String(row.name || '').trim() === wantName) {
                    add(row.characterId);
                    add(row.id);
                }
            });
        }
        return ordered;
    }

    function normalizeWorldbookExtraBindings(extraBindings) {
        if (!Array.isArray(extraBindings)) return [];
        return extraBindings
            .map(function (b) {
                if (!b || typeof b !== 'object') return null;
                var entryId = String(b.entryId || b.id || '').trim();
                if (!entryId) return null;
                return {
                    type: 'entry',
                    entryId: entryId,
                    force: b.force !== false
                };
            })
            .filter(Boolean);
    }

    /** 该角色绑定的全部局部世界书词条（强制注入，不依赖关键词命中） */
    function collectBoundLocalWorldbookBindings(contact) {
        var order = resolveContactWorldbookEntryOrder(contact, null);
        return collectBoundLocalBindingsForRoleIds(collectContactRoleIds(contact), order);
    }

    function collectBoundLocalBindingsForRoleIds(roleIds, entryOrder) {
        var wb = global.miyaWorldbookStore;
        var matcher = global.miyaWorldbookMatcher;
        if (!wb || typeof wb.listEntries !== 'function') return [];
        var ids = Array.isArray(roleIds)
            ? roleIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
            : [];
        if (!ids.length) return [];
        var cfg = { roleId: ids[0], roleIds: ids, contextText: '' };
        var bindings = wb.listEntries()
            .filter(function (entry) {
                if (!entry || entry.enabled === false) return false;
                var bound = Array.isArray(entry.boundRoleIds) ? entry.boundRoleIds : [];
                if (!bound.length) return false;
                if (matcher && typeof matcher.roleMatches === 'function') {
                    return matcher.roleMatches(entry, cfg);
                }
                return bound.some(function (bid) {
                    return ids.indexOf(String(bid || '').trim()) >= 0;
                });
            })
            .map(function (entry) {
                var keywords = Array.isArray(entry.keywords) ? entry.keywords.filter(Boolean) : [];
                var reach = matcher && typeof matcher.getEntryGlobalReach === 'function'
                    ? matcher.getEntryGlobalReach(entry)
                    : '';
                return {
                    type: 'entry',
                    entryId: String(entry.id),
                    // 全软件：强制纳入；无关键词：仍强制（跳过关键词，但受生效范围约束）
                    force: keywords.length === 0 || reach === 'all'
                };
            });
        return sortBindingsByEntryOrder(bindings, entryOrder);
    }

    function buildUniversalWorldbookTopLayer() {
        var builder = global.miyaWorldbookPrompt || global.miyaBuildWorldbookPrompt;
        if (!builder || typeof builder.buildWorldbookPrompt !== 'function') return '';
        var result = builder.buildWorldbookPrompt({ universalOnly: true });
        var sec = result && result.sections ? result.sections : {};
        return String(sec.universal || result && result.text || '').trim();
    }

    /** 侧路摘要/记忆等仍可用：仅注入「全软件」范围词条（与聊天深度槽无关） */
    function prependUniversalWorldbookMessage(apiMessages) {
        var layer = buildUniversalWorldbookTopLayer();
        if (!layer) return apiMessages;
        var msgs = Array.isArray(apiMessages) ? apiMessages.slice() : [];
        if (msgs.some(function (m) {
            return m && m.role === 'system' && String(m.content || '').indexOf(layer) >= 0;
        })) {
            return msgs;
        }
        msgs.unshift({ role: 'system', content: layer });
        return msgs;
    }

    function normalizeLayerList(list) {
        if (!Array.isArray(list)) return [];
        return list
            .map(function (x) {
                return String(x || '').trim();
            })
            .filter(Boolean);
    }

    function appendLayerList(parts, layers) {
        normalizeLayerList(layers).forEach(function (layer) {
            parts.push(layer);
        });
        return parts;
    }

    function appendWorldbookBackMessages(apiMessages, backLayers) {
        if (!Array.isArray(apiMessages)) return;
        normalizeLayerList(backLayers).forEach(function (layer) {
            apiMessages.push({ role: 'system', content: layer });
        });
    }

    /** 深潜/单块上下文：按 前→中→后 拼成一段 */
    function joinWorldbookBundleText(bundle) {
        if (!bundle || typeof bundle !== 'object') return '';
        return []
            .concat(
                normalizeLayerList(bundle.frontLayers),
                normalizeLayerList(bundle.layers),
                normalizeLayerList(bundle.backLayers)
            )
            .join('\n\n')
            .trim();
    }

    function mergeWorldbookExtraBindings(extraBindings, more) {
        var out = normalizeWorldbookExtraBindings(extraBindings).slice();
        var seen = {};
        out.forEach(function (b) {
            seen[b.entryId] = true;
        });
        normalizeWorldbookExtraBindings(more).forEach(function (b) {
            if (seen[b.entryId]) return;
            seen[b.entryId] = true;
            out.push(b);
        });
        return out;
    }

    function sortBindingsByEntryOrder(bindings, orderIds) {
        if (!Array.isArray(bindings) || !bindings.length) return bindings || [];
        if (!Array.isArray(orderIds) || !orderIds.length) return bindings.slice();
        var rank = {};
        orderIds.forEach(function (id, i) {
            var key = String(id || '').trim();
            if (key) rank[key] = i;
        });
        return bindings.slice().sort(function (a, b) {
            var ra = rank[a.entryId];
            var rb = rank[b.entryId];
            var ha = ra !== undefined;
            var hb = rb !== undefined;
            if (ha && hb) return ra - rb;
            if (ha) return -1;
            if (hb) return 1;
            return 0;
        });
    }

    function listSortableWorldbookEntriesForContact(contact) {
        var wb = global.miyaWorldbookStore;
        var matcher = global.miyaWorldbookMatcher;
        if (!wb || typeof wb.listEntries !== 'function') return [];
        var roleIds = collectContactRoleIds(contact);
        var cfg = { roleId: roleIds[0] || '', roleIds: roleIds };
        var out = [];
        var seen = {};
        function push(entry) {
            if (!entry || !entry.id || seen[String(entry.id)]) return;
            seen[String(entry.id)] = true;
            out.push(entry);
        }
        wb.listEntries().forEach(function (entry) {
            if (!entry || entry.enabled === false) return;
            if (String(entry.scope) === 'local') {
                if (!roleIds.length) return;
                var bound = Array.isArray(entry.boundRoleIds) ? entry.boundRoleIds : [];
                if (!bound.length) return;
                if (matcher && typeof matcher.roleMatches === 'function') {
                    if (matcher.roleMatches(entry, cfg)) push(entry);
                    return;
                }
                if (bound.some(function (bid) {
                    return roleIds.indexOf(String(bid || '').trim()) >= 0;
                })) push(entry);
                return;
            }
            push(entry);
        });
        return out;
    }

    function collectSortableWorldbookEntryIdsForContact(contact) {
        return listSortableWorldbookEntriesForContact(contact).map(function (entry) {
            return String(entry.id);
        });
    }

    function resolveContactWorldbookEntryOrder(contact, opts) {
        if (opts && Array.isArray(opts.entryOrder) && opts.entryOrder.length) {
            return filterWorldbookEntryOrderForContact(
                contact,
                opts.entryOrder.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
            );
        }
        if (!contact || !Array.isArray(contact.worldbookEntryOrder)) return [];
        return filterWorldbookEntryOrderForContact(contact, contact.worldbookEntryOrder);
    }

    function filterWorldbookEntryOrderForContact(contact, orderIds) {
        var allowed = {};
        collectSortableWorldbookEntryIdsForContact(contact).forEach(function (id) {
            allowed[id] = true;
        });
        return (Array.isArray(orderIds) ? orderIds : [])
            .map(function (x) { return String(x || '').trim(); })
            .filter(function (id) { return id && allowed[id]; });
    }

    function ensureWorldbookDepsReady() {
        if (global.miyaBootstrapKvStores) {
            return global.miyaBootstrapKvStores();
        }
        var chain = Promise.resolve();
        var wb = global.miyaWorldbookStore;
        var cs = global.miyaContactsStore;
        if (wb && typeof wb.whenReady === 'function') {
            chain = chain.then(function () {
                return wb.whenReady();
            });
        }
        if (cs && typeof cs.whenReady === 'function') {
            chain = chain.then(function () {
                return cs.whenReady();
            });
        }
        var opMod = global.MiyaChatOperationRules;
        if (opMod && typeof opMod.ensureLoaded === 'function') {
            chain = chain.then(function () {
                return opMod.ensureLoaded();
            });
        }
        return chain;
    }

    function sumLayerChars(layers) {
        if (!Array.isArray(layers)) return 0;
        return layers.reduce(function (n, layer) {
            return n + String(layer || '').length;
        }, 0);
    }

    function buildWorldbookBundle(contact, contextText, extraBindings, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var builder = global.miyaWorldbookPrompt || global.miyaBuildWorldbookPrompt;
        var empty = {
            universalLayer: '',
            frontLayers: [],
            layers: [],
            backLayers: [],
            matched: [],
            meta: { matched: 0, chars: 0, injectedChars: 0, matchedContentChars: 0, emptyMatched: 0, roleIds: [] }
        };
        if (!builder || typeof builder.buildWorldbookPrompt !== 'function') return empty;
        if (opts.universalOnly) {
            var universalOnly = String(buildUniversalWorldbookTopLayer() || '').trim();
            return {
                universalLayer: universalOnly,
                frontLayers: universalOnly ? [universalOnly] : [],
                layers: [],
                backLayers: [],
                matched: [],
                meta: Object.assign({}, empty.meta, {
                    universalChars: universalOnly.length,
                    chars: universalOnly.length,
                    injectedChars: universalOnly.length
                })
            };
        }
        var roleIds = Array.isArray(opts.roleIds) && opts.roleIds.length
            ? opts.roleIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
            : collectContactRoleIds(contact);
        var entryOrder = resolveContactWorldbookEntryOrder(contact, opts);
        var bindings = normalizeWorldbookExtraBindings(extraBindings);
        if (opts.includeAllBoundLocal) {
            bindings = mergeWorldbookExtraBindings(
                bindings,
                collectBoundLocalBindingsForRoleIds(roleIds, entryOrder)
            );
        }
        bindings = sortBindingsByEntryOrder(bindings, entryOrder);
        var promptContext = String(opts.promptContext || '').trim();
        var excludeEntryIds = Array.isArray(opts.excludeEntryIds) ? opts.excludeEntryIds : [];
        var result = builder.buildWorldbookPrompt({
            roleId: roleIds[0] || '',
            roleIds: roleIds,
            roleName: contact && contact.name,
            contextText: contextText || '',
            skipChronicleProfile: true,
            extraBindings: bindings,
            scopeMode: String(opts.scopeMode || '').trim(),
            promptContext: promptContext,
            excludeEntryIds: excludeEntryIds,
            entryOrder: entryOrder
        });
        var sec = result && result.sections ? result.sections : {};
        var frontLayers = normalizeLayerList([sec.front]);
        var layers = normalizeLayerList([sec.middle]);
        var backLayers = normalizeLayerList([sec.back]);
        // 旧字段回退：若深度段皆空，退回 ordered/global/local
        if (!frontLayers.length && !layers.length && !backLayers.length) {
            layers = normalizeLayerList([sec.ordered, sec.global, sec.local]);
            if (!layers.length && result && result.text) {
                var fullText = String(result.text || '').trim();
                if (fullText) layers = [fullText];
            }
        }
        var matched = result && Array.isArray(result.matched) ? result.matched : [];
        var injectedChars =
            sumLayerChars(frontLayers) + sumLayerChars(layers) + sumLayerChars(backLayers);
        var matchedContentChars = 0;
        var emptyMatched = 0;
        matched.forEach(function (entry) {
            var n = String((entry && entry.content) || '').trim().length;
            if (n) matchedContentChars += n;
            else emptyMatched += 1;
        });
        return {
            universalLayer: '',
            frontLayers: frontLayers,
            layers: layers,
            backLayers: backLayers,
            matched: matched,
            meta: {
                matched: matched.length,
                chars: injectedChars,
                injectedChars: injectedChars,
                matchedContentChars: matchedContentChars,
                emptyMatched: emptyMatched,
                roleIds: roleIds,
                promptContext: promptContext,
                universalCount: result && result.universalCount ? result.universalCount : 0,
                frontCount: result && result.frontCount ? result.frontCount : frontLayers.length,
                middleCount: result && result.middleCount ? result.middleCount : layers.length,
                backCount: result && result.backCount ? result.backCount : backLayers.length,
                matchedSummary: result && result.matchedSummary ? result.matchedSummary : []
            }
        };
    }

    function buildWorldbookLayers(contact, contextText, opts) {
        return buildWorldbookBundle(contact, contextText, null, Object.assign({
            promptContext: 'online',
            includeAllBoundLocal: true
        }, opts && typeof opts === 'object' ? opts : {})).layers;
    }

    function buildChatModeBlock(contact, profile) {
        return (
            '【对话模式·线上单聊】\n' +
            '你正在以「' +
            String((contact && contact.name) || '对方') +
            '」的身份，与「' +
            String((profile && profile.name) || '用户') +
            '」进行二人私聊（即时通讯），不是群聊。\n' +
            '- 语气需要自然、口语化，模拟真人发微信，不要油腻；根据人设与情绪善用 emoji、表情包、颜文字、标点节奏（…！！？？等）\n' +
            '- 【单聊硬性边界】必须遵守下文「运转规则」「线上格式规则」：每轮 <thinking> → 正文 → <miyavoice> 三段式\n' +
            '- 【用户消息】用户普通文字无前缀；连发多条时以「 / 」分隔（仅分隔符，非正文）；引用时一次只能引用其中一条，勿把多条拼进同一行「引用-」；仅上下文里以「语音-」开头的才是语音条，勿把普通文字当语音回应\n' +
            '- 【禁止混用群聊格式】正文禁止「角色名：」多角色格式；群聊摘录/记忆仅作剧情参考，不得把群聊输出格式带入本单聊\n' +
            '- 提示词顺序：全局 → 用户身份 → 关系 → 世界书 → 线上格式 → … → 联系人档案 → 思维链 → 运转规则（置末，紧挨生成前）'
        );
    }

    function buildPrivateChatScopeFence() {
        return (
            '【场景锁定·单聊】\n' +
            '当前请求仅适用于本单聊线程：禁止套用群聊「角色名：」格式；禁止输出群聊专用格式。'
        );
    }

    var ONLINE_THREE_PART_TAIL =
        '仍须严格按顺序输出：<thinking>…</thinking> → 正文（每行一气泡，每条必须换行分隔，禁止空格/标点挤一行）→ <miyavoice>…</miyavoice>；正文只输出一遍，禁止先写草稿再复读；用户只能看到 </thinking> 与 <miyavoice> 之间；必须按照要求完整输出 miyavoice 模块（开闭标签与全部心声字段均不可缺），禁止省略思维链或心声、禁止截断心声、禁止挤成无换行的一大段。';

    function buildOnlineProactiveTailNudge() {
        return '（请主动发一条新消息：先读全上文带时间戳的历史；从对话最新状态续聊；默认勿报时；' + ONLINE_THREE_PART_TAIL + '）';
    }

    function buildAssistantContinueTailNudge(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var llTail = global.MiyaChatLifeLike;
        var nextPushTail =
            opts.isLifeLike && llTail && llTail.TAG_OPEN && llTail.TAG_CLOSE
                ? '；全文最末另起一行输出 ' + llTail.TAG_OPEN + 'YYYY-MM-DD HH:mm' + llTail.TAG_CLOSE
                : '';
        return (
            '（末条是你方发言：主动轮请自然衔接上文末尾几条并兼顾时间间隔；禁止把用户上一轮当必答；勿催回/抱怨没回；' +
            ONLINE_THREE_PART_TAIL +
            nextPushTail +
            '）'
        );
    }

    function buildManualContinueTailNudge() {
        return (
            '（上下文中末条为你方发言、用户尚未回复：禁止重答用户旧话；须从你方最近一条自然续写或推进；' +
            ONLINE_THREE_PART_TAIL +
            '；禁止群聊「角色名：」多角色格式）'
        );
    }

    function buildManualReplyToUserTailNudge() {
        return (
            '（上下文中末条为用户发言、你方尚未回复：须回应自你方上一条回复之后、截止上下文末尾连续出现的用户消息；更早用户发言仅作背景，禁止回应其它轮次旧话题；' +
            ONLINE_THREE_PART_TAIL +
            '；禁止群聊「角色名：」多角色格式）'
        );
    }

    function buildRegenerateTailNudge() {
        return (
            '（【重回·生成】须严格按上文 system 中【重回】块所列「本轮用户消息」重新生成本轮回复；更早对话仅作背景，禁止回应其它轮次用户发言；' +
            ONLINE_THREE_PART_TAIL +
            '）'
        );
    }

    function appendManualActionTailNudge(apiMessages, opts, historyTailState, hasExtraUserText) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!Array.isArray(apiMessages)) return;
        if (opts.isAutoPush || opts.isOffline || opts.isMomentsAuto || opts.isLifeLike) return;
        if (opts.callMode || opts.appointmentMode) return;
        if (!opts.skipUserMessage || hasExtraUserText) return;
        var tail;
        if (opts.isRegenerate) {
            if (historyTailState === 'user_spoke_last') {
                tail = buildRegenerateTailNudge();
            }
        } else if (historyTailState === 'assistant_spoke_last') {
            tail = buildManualContinueTailNudge();
        } else if (historyTailState === 'user_spoke_last') {
            tail = buildManualReplyToUserTailNudge();
        }
        if (tail) apiMessages.push({ role: 'user', content: tail });
    }

    function buildReadTogetherModeBlock(contact, profile) {
        return (
            '【对话模式·共读】\n' +
            '你正在以「' +
            String((contact && contact.name) || '对方') +
            '」的身份，与「' +
            String((profile && profile.name) || '用户') +
            '」并肩共读同一本书。\n' +
            '- 这是共读室专属对话，不是微信/QQ 线上聊天；禁止引用-/语音-/图片-/位置-/转账-/旁白-等线上专属格式。\n' +
            '- 正文仅允许：普通文字（每行一条气泡）、表情包-名称（单独一行）。\n' +
            '- 共读只需直接输出正文气泡，禁止输出 <thinking>、<miyavoice> 或任何思维链/心声段。\n' +
            '- 须遵守下文「共读·输出格式」；提示词顺序：全局 → 联系人档案 → 用户身份 → 关系 → 世界书。'
        );
    }

    function buildReadTogetherOperationRules(contact, profile) {
        var roleName = String((contact && contact.name) || '对方');
        var userName = String((profile && profile.name) || '用户');
        return (
            '【运转规则·共读】\n' +
            '1、你是' + roleName + '，正与用户并肩共读；须消化人设与世界书，作出符合当下阅读情境的对话。\n' +
            '2、你知道' + userName + '是谁，须符合你们的关系；禁止辱骂或控制型表达。\n' +
            '3、每轮仅输出正文：每行一条气泡，直接写对白；禁止输出 <thinking>、<miyavoice> 或任何思维链/心声。\n' +
            '4、正文仅允许普通文字与「表情包-名称」；禁止语音-/引用-/图片-/位置-/转账-/旁白-等线上专属前缀。\n' +
            '5、禁止输出 ⧗、› 或 API 时间戳；禁止复读相同句式。'
        );
    }

    function buildCallModeBlock(contact, profile, callKind) {
        var kindLabel = callKind === 'video' ? '视频' : '语音';
        return (
            '【对话模式·实时' +
            kindLabel +
            '通话】\n' +
            '你正在以「' +
            String((contact && contact.name) || '对方') +
            '」的身份，与「' +
            String((profile && profile.name) || '用户') +
            '」进行实时' +
            kindLabel +
            '通话。\n' +
            '- 【重要】这是实时通话，不是微信文字聊天；你必须始终按通话情境反应。\n' +
            '- 语气口语化、有呼吸感；禁止表情包/语音条/图片/位置/转账等线上格式。\n' +
            '- 提示词顺序：全局 → 联系人档案 → 用户身份 → 关系 → 世界书；请严格区分角色与用户。'
        );
    }

    function buildCallFormatRules(contact, callKind) {
        var roleName = String((contact && contact.name) || '角色');
        var kindLabel = callKind === 'video' ? '视频' : '语音';
        return [
            '【通话格式规则·' + roleName + '】',
            '【通话态·强制】你正处于与用户进行的实时' + kindLabel + '通话中；禁止当作文字聊天。',
            '1、可用 <thinking>...</thinking> 写简短思考；禁止输出 <miyavoice>、心声段或线上三段式尾部。',
            '2、正文每行一句口语对白，条数 1–15 行，由你根据人设、情绪与当下情境自行决定；禁止「语音-」「表情包-」「图片-」等线上专属前缀。',
            '3、禁止在正文输出发起语音通话 / 发起视频通话 / 【拨打视频电话】 等拨号指令行，以及外卖- / 送礼- 等专属单行；你已在通话中，不得再次拨号。',
            '4、若系统注入「用户摄像头画面」，可结合画面自然回应，勿编造看不见的内容；若注入「用户摄像头状态」为已关闭，则完全看不到任何画面，禁止描述、猜测或编造用户外貌、表情、动作、穿着、环境等视觉内容。',
            '5、保持人设与关系一致；勿复读上一轮相同句式。'
        ].join('\n');
    }

    function buildCallRingRules(contact, profile, callKind) {
        var roleName = String((contact && contact.name) || '角色');
        var userName = String((profile && profile.name) || '用户');
        var kindLabel = callKind === 'video' ? '视频' : '语音';
        return [
            '【来电接通判定·专属】',
            userName + ' 正在向 ' + roleName + ' 发起' + kindLabel + '通话。',
            '你必须在本轮仅输出以下结构（禁止线上聊天气泡格式）：',
            '· 若接听：第一行写「通话接听」；第二行起写接通后先对 ' + userName + ' 说的口语（每行一句）。',
            '· 若拒接：第一行写「通话拒接」；第二行可写一句简短说明（可省略第二行）。',
            '禁止输出 <miyavoice>、心声段、表情包/语音条/图片/转账等线上格式。',
            '禁止输出「发起视频通话」「发起语音通话」等拨号指令；用户已在呼叫你，只需决定接听或拒接。'
        ].join('\n');
    }

    /**
     * 通话专用系统提示：不含线上格式/表情包/心声规则
     */
    function buildCallSystemPrompt(input) {
        var cfg = input && typeof input === 'object' ? input : {};
        var contact = cfg.contact;
        var profile = cfg.profile;
        var chatSettings = cfg.chatSettings || null;
        var history = cfg.history || [];
        var contextText = String(cfg.contextText || '').trim();
        var callKind = cfg.callKind === 'video' ? 'video' : 'voice';
        var parts = [];
        var aw = global.MiyaChatAwareness;

        appendLayerList(parts, cfg.worldbookFrontLayers);

        var globalP = getGlobalPrompt();
        if (globalP) parts.push('【全局提示词】\n' + globalP);

        parts.push(buildCallModeBlock(contact, profile, callKind));

        var chronicle = renderChronicleBlock(contact);
        if (chronicle) parts.push(chronicle);

        var userBlock = renderProfileBlock(profile);
        if (userBlock) parts.push(userBlock);

        var avatarBlock = buildAvatarRecognitionBlock(chatSettings, contact, profile);
        if (avatarBlock) parts.push(avatarBlock);
        appendDynamicAvatarContextBlock(parts, chatSettings, contact, profile);
        appendAlbumContextBlock(parts, profile, contact, chatSettings);

        if (aw) {
            var relLine = aw.buildRelationshipLine(chatSettings, contact);
            if (relLine) parts.push(relLine);
            var netBlockCall = aw.buildChronicleRelationshipBlock(contact);
            if (netBlockCall) parts.push(netBlockCall);
        }

        buildAwarenessBlocks(chatSettings, contact, profile, history).forEach(function (b) {
            parts.push(b);
        });

        var wbLayers = Array.isArray(cfg.worldbookLayers)
            ? cfg.worldbookLayers
            : buildWorldbookLayers(contact, contextText);
        appendLayerList(parts, wbLayers);
        appendLayerList(parts, cfg.worldbookBackLayers);

        parts.push(
            '【运转规则·通话】\n' +
                '你是' +
                String((contact && contact.name) || '对方') +
                '，正在真实通话；须消化人设与世界书；严禁辱骂用户；每轮正文仅口语对白行。'
        );

        parts.push(buildCallFormatRules(contact, callKind));

        return parts.filter(Boolean).join('\n\n');
    }

    /** 运转规则 1–6：人设与对话风格（可被自定义预设覆盖） */
    function buildOperationRulesHead(contact, profile) {
        var roleName = String((contact && contact.name) || '对方');
        var userName = String((profile && profile.name) || '用户');
        return (
            '1、你是' +
            roleName +
            '，是真实存在的人，有自己的生活和想法，有自己的感觉和态度，你并非在扮演，你必须消化好人设与世界书中的内容，作出符合当下情境的对话；不要油腻、不要凶很、禁止评判/威胁/控制的表达方式，要以温柔为底色，不要极端的去表达自己想要的东西/控制用户\n' +
            '2、你知道' +
            userName +
            '是谁，知道自己和' +
            userName +
            '的关系，严禁对用户做出辱骂等行为，你要思考你和' +
            userName +
            '的关系，作出符合关系的对话\n' +
            '3、现在是线上聊天，须具备真人聊天的跳跃性、活跃性与不连续性：可碎片化、一句话拆成多条发、中途转话题、隔几条再续上、语气忽然变轻或变冲；不必每轮都完整接话或逻辑闭环，在符合人设的前提下拥抱不确定感\n' +
            '4、根据人设与当下情绪善用表达工具：emoji、颜文字、标点节奏（…！！？？～等）及表情包（走「表情包-名称」格式）；开朗活泼可多符号，内敛克制可少用；禁止每轮堆砌同款表情或固定句式\n' +
            '5、禁止总是重复相同句式：对照近期已发原文换说法与节奏，勿每轮套用同一开场、撒娇模板或抱怨等结构\n' +
            '6、每次回复之前输出思维过程，以<thinking>…</thinking>为格式（开闭标签均必填）；思维链只写在此段，禁止写进正文；禁止输出 [正文]、[/thinking] 等标记'
        );
    }

    /** 运转规则格式条正文（不含序号，共 7 条）
     * 心声字段细则只在「线上格式规则·心声」中定义：系统默认四行或自定义预设二选一，此处不写死四行。 */
    function getOperationRulesFormatTailItems() {
        return [
            '每一轮须按顺序输出三段：<thinking> → 正文（每行一气泡，必须换行）→ <miyavoice>；禁止一大坨无换行文字',
            '世界书已注入系统提示，你必须在 <thinking> 中体现对当前生效世界书条目的消化，并在正文中落实',
            '发送前必须回顾上下文中你方近期已发原文：禁止频繁重复相同话题、相同描写/意象、相同动作套路、相同句式或同质化撒娇/抱怨；<miyavoice> 各字段也不得与近几轮雷同；主动找话题时勿反复提天气，勿复制上一轮结构与节奏',
            '正文每行仅一条气泡，且整轮正文只输出一遍；禁止相同句子/气泡行出现两次；引用时「引用-摘抄」独占一行，每条回复各占一行',
            '每轮末尾必须按照要求完整输出 <miyavoice> 心声段，须严格按当前「线上格式规则·心声」中定义的字段逐行写满（字段名与行数以该规则为准），禁止省略、禁止截断；心声字段行不得出现在正文气泡里',
            '禁止编造关于用户的经历、共同回忆、偏好或说过/做过的事：仅可使用上下文中已明确出现的对话原文，以及系统注入的长期记忆/角色记忆/朋友圈记忆、联系人档案与用户档案；无依据时不得假称「记得」「上次你说」「我们以前」等',
            '须通读上下文中按时间顺序注入的完整近期对话（用户与角色的消息均已包含；开启时间感知时须逐条区分双方发言早晚）后再回复：衔接取决于对话最新状态——若上下文末条为用户新发言，则按该消息真实发送时刻回应；若上几条已是你方发言而用户未回，则从你方最近一条自然续写或推进，禁止每条回复都重新瞄准用户更早的旧句当作「本轮必答对象」；判断用户失联多久须按用户上次发言起算'
        ];
    }

    function buildOperationRulesFormatTailFrom(startNum) {
        var n = Math.max(1, parseInt(startNum, 10) || 7);
        return getOperationRulesFormatTailItems()
            .map(function (text, i) {
                return n + i + '、' + text;
            })
            .join('\n');
    }

    /** 运转规则 7 起：输出格式与对话纪律硬性要求（始终注入，不可被自定义覆盖） */
    function buildOperationRulesFormatTail() {
        return buildOperationRulesFormatTailFrom(7);
    }

    /** 运转规则：所有线上对话必须注入 */
    function buildOperationRules(contact, profile) {
        return (
            '【运转规则·必读】\n' +
            buildOperationRulesHead(contact, profile) +
            '\n' +
            buildOperationRulesFormatTail()
        );
    }

    function buildPromptCapabilitiesBlock(chatSettings) {
        var caps = (chatSettings && chatSettings.promptCapabilities) || {};
        var lines = [
            '- 可为用户点外卖（单独一行：外卖-店铺｜菜品与数量｜合计金额｜送达备注）',
            '- 可向用户送礼（单独一行：送礼-物品名｜数量｜赠言）'
        ];
        if (caps.song !== false) lines.push('- 可为用户点歌');
        if (caps.shop !== false) lines.push('- 用户可在聊天「更多」中点外卖或送礼');
        if (caps.call !== false && global.MiyaChatCalls) {
            lines.push('- 可主动发起视频通话（正文最末单独一行：发起视频通话）');
        }
        if (caps.countdown !== false) lines.push('- 可发起倒计时（约定一段时间后提醒或继续话题，须符合人设）');
        if (!lines.length) return '';
        return '【角色能力开关】\n' + lines.join('\n');
    }

    function getOnlineFormatApi() {
        return global.MiyaChatOnlineFormat || null;
    }

    function trimLine(s) {
        return String(s || '').trim();
    }

    /** 单聊：去掉模型误带的「角色真名：」群聊式前缀，避免解析/展示掉格式 */
    function stripPrivateRolePrefixLines(lines, contact) {
        if (!contact || !Array.isArray(lines)) return lines;
        var names = [trimLine(contact.name), trimLine(contact.remarkName)].filter(Boolean);
        if (!names.length) return lines;
        return lines.map(function (line) {
            var raw = trimLine(line);
            if (!raw) return raw;
            var i;
            for (i = 0; i < names.length; i++) {
                var hit = raw.match(
                    new RegExp('^' + escapeRegExp(names[i]) + '[：:]\\s*([\\s\\S]+)$')
                );
                if (hit) return trimLine(hit[1]);
            }
            var legacy = raw.match(/^【([^】]{1,32})】\s*([\s\S]+)$/);
            if (legacy) {
                var label = trimLine(legacy[1]);
                for (i = 0; i < names.length; i++) {
                    if (label === names[i]) return trimLine(legacy[2]);
                }
            }
            return raw;
        });
    }

    function isContactImageGenEnabled(chatSettings) {
        if (!global.MiyaImageGen || typeof global.MiyaImageGen.isGlobalEnabled !== 'function') return false;
        if (!global.MiyaImageGen.isGlobalEnabled()) return false;
        var ig = chatSettings && chatSettings.imageGen;
        return !!(ig && ig.enabled);
    }

    function getRecentAssistantLinesForContinuation(history, limit) {
        var lines = [];
        var fmt = getOnlineFormatApi();
        var aw = global.MiyaChatAwareness;
        var list = Array.isArray(history) ? history : [];
        for (var i = list.length - 1; i >= 0 && lines.length < (limit || 6); i--) {
            var m = list[i];
            if (!m || m.deleted || m.role !== 'assistant') continue;
            if (fmt && typeof fmt.shouldOmitMessage === 'function' && fmt.shouldOmitMessage(m)) continue;
            var t =
                fmt && typeof fmt.formatMessageForApi === 'function'
                    ? fmt.formatMessageForApi(m)
                    : String(m.content || '').trim();
            t = stripThinkingForApi(t);
            if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
                t = aw.stripTimelinePrefixForDisplay(t);
            }
            t = String(t || '').trim();
            if (!t) continue;
            if (t.length > 140) t = t.slice(0, 137) + '…';
            lines.unshift(t);
        }
        return lines;
    }

    function getTrailingSpeakerState(history) {
        if (!Array.isArray(history) || !history.length) return 'empty';
        var fmt = getOnlineFormatApi();
        for (var i = history.length - 1; i >= 0; i--) {
            var row = history[i];
            if (!row || row.deleted) continue;
            /* 与 appendHistory 一致：已 omit 的空壳/回执等不参与末条判定 */
            if (fmt && typeof fmt.shouldOmitMessage === 'function' && fmt.shouldOmitMessage(row)) {
                continue;
            }
            if (row.role === 'user') return 'user_spoke_last';
            if (row.role === 'assistant') return 'assistant_spoke_last';
        }
        return 'empty';
    }

    function buildPostHistoryContinuationBlock(history, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!Array.isArray(history) || !history.length) return '';
        var state = getTrailingSpeakerState(history);
        if (state !== 'assistant_spoke_last') return '';
        var lines = [
            '【紧挨上文·对话末条状态】',
            '上下文中最后一条可见消息来自你方；你已回应过用户此前的话，用户尚未回复。',
            '本轮禁止把用户更早的发言当作「本轮必答对象」再答一遍；禁止复读、改写或换皮重复你方上一轮已说过的内容、话题、语气与结构。',
            '须从你方最近一条发言自然续写：可补充半句、追问、调侃、分享新事、换角度或换话题；像真人隔一会再发微信，而不是重新答用户旧问题。'
        ];
        if (opts.isAutoPush || opts.isOffline || opts.isLifeLike) {
            lines.push('【主动/离线触发】这是主动找用户续聊，不是重新回答用户旧话。');
        }
        var recentAsst = getRecentAssistantLinesForContinuation(history, 6);
        if (recentAsst.length) {
            lines.push('【你方最近已发原文·须在此基础上推进，禁止复读】');
            recentAsst.forEach(function (t, idx) {
                lines.push(String(idx + 1) + '. ' + t);
            });
        }
        return lines.join('\n');
    }

    function buildConversationStateBlock(history, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!Array.isArray(history) || !history.length) return '';
        var state = getTrailingSpeakerState(history);
        var isProactiveTurn = !!(opts.isAutoPush || opts.isOffline || opts.isLifeLike);
        var lines = [
            '【本轮对话衔接·必读】',
            '上文已按时间顺序注入最近若干条完整聊天记录（用户与你的消息均已包含，条数由聊天设置决定），须通读全段后再决定如何衔接，勿只看孤立一句或只盯用户很久以前说过的话。'
        ];
        if (state === 'user_spoke_last') {
            if (isProactiveTurn) {
                lines.push(
                    '本轮为主动触发，且时间线末条是用户：须自然衔接上文末尾几条（含用户刚发），兼顾各条真实发送时刻与间隔；更早对话仅作背景；禁止假装未见、禁止抱怨用户没回。'
                );
                var fmtRound = getOnlineFormatApi();
                var pendingRound =
                    fmtRound && typeof fmtRound.formatUserRoundLinesForRegenerate === 'function'
                        ? String(
                              fmtRound.formatUserRoundLinesForRegenerate(history, opts.chatSettings) || ''
                          ).trim()
                        : '';
                if (pendingRound) {
                    lines.push('【末尾用户侧原文·纳入衔接】');
                    lines.push(pendingRound);
                    lines.push('把以上内容当作最新状态自然接下去；禁止抛开末尾去接更早旧话题。');
                }
            } else {
                lines.push(
                    '上下文末条为用户发言：本轮须回应自你方上一条回复之后、截止上下文末尾连续出现的用户消息；须按这些消息真实发送时刻理解（勿默认当成刚刚/今天早上）；更早用户发言仅作背景，禁止逐条复读或接续好几轮之前的旧话题，除非用户在本轮末尾再次明确提起。'
                );
            }
        } else if (state === 'assistant_spoke_last') {
            if (isProactiveTurn) {
                lines.push(
                    '本轮为主动触发，且时间线末条是你方：须自然衔接上文末尾几条消息，并按各条真实时刻理解间隔，像真人隔一会再发。',
                    '禁止把用户上一轮或更早发言当成本轮必答对象；禁止假装用户没回你而催问；勿复读你方上轮相似内容。'
                );
            } else {
                lines.push(
                    '上下文末条为你方发言，用户尚未回复：你已在上下文中回应过用户；本轮须从你方最近一条自然续写或推进，禁止回头把用户旧句当成本轮必答对象，禁止复读上轮相似内容。'
                );
            }
        }
        return lines.join('\n');
    }

    function buildPerTurnOnlineInjectBlocks(chat, contact, chatSettings, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (opts.callMode || opts.appointmentMode) return [];
        var blocks = [buildPrivateChatScopeFence()];
        var roleName = (contact && contact.name) || '角色';
        var s = chatSettings;
        var bubbleMin = 1;
        var bubbleMax = 5;
        if (s) {
            bubbleMin = s.roleReplyBubbleMin != null ? s.roleReplyBubbleMin : 1;
            bubbleMax = s.roleReplyBubbleMax != null ? s.roleReplyBubbleMax : 5;
        }
        var fmt = getOnlineFormatApi();
        if (!opts.htmlMode && fmt && typeof fmt.buildPerTurnFormatReminder === 'function') {
            blocks.push(
                fmt.buildPerTurnFormatReminder({
                    roleName: roleName,
                    bubbleMin: bubbleMin,
                    bubbleMax: bubbleMax,
                    autoTranslate: isSemanticAutoTranslate(s),
                    translateTarget: getTranslateTargetFromSettings(s),
                    onlineNarrationEnabled: !!(s && s.onlineNarrationEnabled),
                    onlineNarrationCharPerson: (s && s.onlineNarrationCharPerson) || '3',
                    onlineNarrationUserPerson: (s && s.onlineNarrationUserPerson) || '2',
                    imageGenEnabled: isContactImageGenEnabled(s),
                    charAvatarSwapEnabled: !!(s && s.dynamicAvatar && s.dynamicAvatar.charEnabled),
                    userAvatarSwapEnabled: !!(s && s.dynamicAvatar && s.dynamicAvatar.userEnabled)
                })
            );
        }
        if (
            opts.isRegenerate &&
            fmt &&
            typeof fmt.buildRegenerateRoundInjectBlock === 'function'
        ) {
            var regenBlock = fmt.buildRegenerateRoundInjectBlock(contact, {
                history: Array.isArray(opts.history) ? opts.history : [],
                chatSettings: s
            });
            if (regenBlock) blocks.push(regenBlock);
        }
        if (
            !opts.callMode &&
            !opts.appointmentMode &&
            fmt &&
            typeof fmt.buildLastHeartVoiceInjectBlock === 'function'
        ) {
            /* 含重回：自定义/默认心声都需上一轮快照，避免重回退回默认四行 */
            var hvPrev = fmt.buildLastHeartVoiceInjectBlock(chat, contact);
            if (hvPrev) blocks.push(hvPrev);
        }
        if (
            !opts.callMode &&
            !opts.appointmentMode &&
            chat &&
            chat.type !== 'group' &&
            global.MiyaChatLifeLike &&
            typeof global.MiyaChatLifeLike.isEnabled === 'function' &&
            global.MiyaChatLifeLike.isEnabled(s) &&
            typeof global.MiyaChatLifeLike.buildNextPushRulesBlock === 'function'
        ) {
            blocks.push(global.MiyaChatLifeLike.buildNextPushRulesBlock(contact, s));
        }
        var isProactiveTurn = !!(opts.isAutoPush || opts.isOffline || opts.isLifeLike);
        /* 主动/离线轮已有 systemLead 时间块，避免再叠时间感知；衔接状态仍按注入历史判断（与普通回复同一套） */
        if (
            !isProactiveTurn &&
            !opts.callMode &&
            !opts.appointmentMode &&
            global.MiyaChatAwareness &&
            typeof global.MiyaChatAwareness.buildPerTurnTimeAwarenessBlock === 'function' &&
            Array.isArray(opts.history) &&
            opts.history.length
        ) {
            var timeTurn = global.MiyaChatAwareness.buildPerTurnTimeAwarenessBlock(s, opts.history);
            if (timeTurn) blocks.push(timeTurn);
        }
        if (
            !opts.isRegenerate &&
            !opts.callMode &&
            !opts.appointmentMode &&
            Array.isArray(opts.history) &&
            opts.history.length
        ) {
            var contBlock = buildConversationStateBlock(
                opts.history,
                Object.assign({}, opts, { chatSettings: s })
            );
            if (contBlock) blocks.push(contBlock);
        }
        return blocks;
    }

    function buildOnlineRulesBundle(contact, chatSettings) {
        var fmt = getOnlineFormatApi();
        var st = global.miyaChatStore;
        var catalog =
            fmt && st && typeof fmt.collectStickerCatalog === 'function'
                ? fmt.collectStickerCatalog(st, contact && contact.id)
                : [];
        var s = chatSettings;
        var bubbleMin = 1;
        var bubbleMax = 5;
        if (s) {
            bubbleMin = s.roleReplyBubbleMin != null ? s.roleReplyBubbleMin : 1;
            bubbleMax = s.roleReplyBubbleMax != null ? s.roleReplyBubbleMax : 5;
        }
        var roleName = (contact && contact.name) || '角色';
        var blocks = [];
        if (fmt && typeof fmt.buildStickerAllowlistBlock === 'function') {
            blocks.push(fmt.buildStickerAllowlistBlock(catalog, roleName));
        }
        if (fmt && typeof fmt.buildOnlineRules === 'function') {
            var dynAv = (s && s.dynamicAvatar) || {};
            var hvTplMod = global.MiyaChatHeartVoiceTemplates;
            var hvPreset =
                hvTplMod && typeof hvTplMod.resolvePresetForChat === 'function'
                    ? hvTplMod.resolvePresetForChat(s)
                    : null;
            blocks.push(
                fmt.buildOnlineRules({
                    roleName: roleName,
                    bubbleMin: bubbleMin,
                    bubbleMax: bubbleMax,
                    catalog: catalog,
                    chatSettings: s,
                    heartVoicePreset: hvPreset,
                    promptCallEnabled: !!(global.MiyaChatCalls && s && s.promptCapabilities && s.promptCapabilities.call !== false),
                    autoTranslate: isSemanticAutoTranslate(s),
                    translateTarget: getTranslateTargetFromSettings(s),
                    momentsTranslate: !!(s && s.autoTranslate && s.momentsTranslate && isSemanticAutoTranslate(s)),
                    onlineNarrationEnabled: !!(s && s.onlineNarrationEnabled),
                    onlineNarrationCharPerson: (s && s.onlineNarrationCharPerson) || '3',
                    onlineNarrationUserPerson: (s && s.onlineNarrationUserPerson) || '2',
                    imageGenEnabled: isContactImageGenEnabled(s),
                    charAvatarSwapEnabled: !!(dynAv.charEnabled),
                    userAvatarSwapEnabled: !!(dynAv.userEnabled)
                })
            );
        } else {
            blocks.push('【线上格式规则】\n每行一气泡（必须换行，禁止空格挤一行）；语音-内容；表情包-名称；引用-原话独占一行，每条回复各占一行；用户连发多条以「 / 」分隔，引用时一次只引其中一条。');
        }
        return blocks.join('\n\n');
    }

    function buildReadTogetherRulesBundle(contact, chatSettings) {
        var fmt = getOnlineFormatApi();
        var st = global.miyaChatStore;
        var catalog =
            fmt && st && typeof fmt.collectStickerCatalog === 'function'
                ? fmt.collectStickerCatalog(st, contact && contact.id)
                : [];
        var roleName = (contact && contact.name) || '角色';
        var blocks = [];
        if (fmt && typeof fmt.buildStickerAllowlistBlock === 'function') {
            blocks.push(fmt.buildStickerAllowlistBlock(catalog, roleName));
        }
        if (fmt && typeof fmt.buildReadTogetherFormatRules === 'function') {
            blocks.push(
                fmt.buildReadTogetherFormatRules({
                    roleName: roleName,
                    bubbleMin: 2,
                    bubbleMax: 5,
                    catalog: catalog
                })
            );
        }
        return blocks.join('\n\n');
    }

    function buildListenTogetherRulesBundle(contact) {
        var fmt = getOnlineFormatApi();
        var roleName = (contact && contact.name) || '角色';
        if (fmt && typeof fmt.buildListenTogetherFormatRules === 'function') {
            return fmt.buildListenTogetherFormatRules({
                roleName: roleName,
                bubbleMin: 2,
                bubbleMax: 5
            });
        }
        return '';
    }

    /**
     * 共读专用系统提示：不注入线上单聊模式/运转/格式规则
     */
    function buildReadTogetherSystemPrompt(input) {
        var cfg = input && typeof input === 'object' ? input : {};
        var contact = cfg.contact;
        var profile = cfg.profile;
        var chatSettings = cfg.chatSettings || null;
        var contextText = String(cfg.contextText || '').trim();
        var parts = [];
        var aw = global.MiyaChatAwareness;

        appendLayerList(parts, cfg.worldbookFrontLayers);

        var globalP = getGlobalPrompt();
        if (globalP) parts.push('【全局提示词】\n' + globalP);

        parts.push(buildReadTogetherModeBlock(contact, profile));

        var chronicle = renderChronicleBlock(contact);
        if (chronicle) parts.push(chronicle);

        var userBlock = renderProfileBlock(profile);
        if (userBlock) parts.push(userBlock);

        var avatarBlock = buildAvatarRecognitionBlock(chatSettings, contact, profile);
        if (avatarBlock) parts.push(avatarBlock);
        appendDynamicAvatarContextBlock(parts, chatSettings, contact, profile);
        appendAlbumContextBlock(parts, profile, contact, chatSettings);

        if (aw) {
            var relLine = aw.buildRelationshipLine(chatSettings, contact);
            if (relLine) parts.push(relLine);
            var netBlock = aw.buildChronicleRelationshipBlock(contact);
            if (netBlock) parts.push(netBlock);
        }

        var wbLayers = Array.isArray(cfg.worldbookLayers)
            ? cfg.worldbookLayers
            : buildWorldbookLayers(contact, contextText);
        appendLayerList(parts, wbLayers);
        appendLayerList(parts, cfg.worldbookBackLayers);

        parts.push(buildReadTogetherOperationRules(contact, profile));
        parts.push(buildReadTogetherRulesBundle(contact, chatSettings));

        return parts.filter(Boolean).join('\n\n');
    }

    function buildListenTogetherModeBlock(contact, profile) {
        return (
            '【对话模式·一起听】\n' +
            '你正在以「' +
            String((contact && contact.name) || '对方') +
            '」的身份，与「' +
            String((profile && profile.name) || '用户') +
            '」进行网易云音乐「一起听」。\n' +
            '- 这是一起听专属对话，不是微信/QQ 线上聊天；禁止引用-/语音-/表情包-/图片-/位置-/转账-/旁白-等线上专属格式。\n' +
            '- 正文仅允许：普通文字（每行一条气泡）；换歌时单独一行「切歌-歌名或序号」。\n' +
            '- 一起听只需直接输出正文气泡，禁止输出 <thinking>、<miyavoice> 或任何思维链/心声段。\n' +
            '- 须遵守下文「一起听·输出格式」；提示词顺序：全局 → 联系人档案 → 用户身份 → 关系 → 世界书。'
        );
    }

    function buildListenTogetherOperationRules(contact, profile) {
        var roleName = String((contact && contact.name) || '对方');
        var userName = String((profile && profile.name) || '用户');
        return (
            '【运转规则·一起听】\n' +
            '1、你是' + roleName + '，正与用户并肩听歌；须消化人设与世界书，作出符合当下音乐情境的对话。\n' +
            '2、你知道' + userName + '是谁，须符合你们的关系；禁止辱骂或控制型表达。\n' +
            '3、每轮仅输出正文：每行一条气泡，直接写对白；禁止输出 <thinking>、<miyavoice> 或任何思维链/心声。\n' +
            '4、正文仅允许普通文字与「切歌-歌名或序号」；禁止语音-/引用-/表情包-/图片-/位置-/转账-/旁白-等线上专属前缀。\n' +
            '5、禁止输出 ⧗、› 或 API 时间戳；禁止复读相同句式。'
        );
    }

    /**
     * 一起听专用系统提示：不注入线上单聊模式/运转/格式规则
     */
    function buildListenTogetherSystemPrompt(input) {
        var cfg = input && typeof input === 'object' ? input : {};
        var contact = cfg.contact;
        var profile = cfg.profile;
        var chatSettings = cfg.chatSettings || null;
        var contextText = String(cfg.contextText || '').trim();
        var parts = [];
        var aw = global.MiyaChatAwareness;

        appendLayerList(parts, cfg.worldbookFrontLayers);

        var globalP = getGlobalPrompt();
        if (globalP) parts.push('【全局提示词】\n' + globalP);

        parts.push(buildListenTogetherModeBlock(contact, profile));

        var chronicle = renderChronicleBlock(contact);
        if (chronicle) parts.push(chronicle);

        var userBlock = renderProfileBlock(profile);
        if (userBlock) parts.push(userBlock);

        var avatarBlock = buildAvatarRecognitionBlock(chatSettings, contact, profile);
        if (avatarBlock) parts.push(avatarBlock);
        appendDynamicAvatarContextBlock(parts, chatSettings, contact, profile);
        appendAlbumContextBlock(parts, profile, contact, chatSettings);

        if (aw) {
            var relLine = aw.buildRelationshipLine(chatSettings, contact);
            if (relLine) parts.push(relLine);
            var netBlock = aw.buildChronicleRelationshipBlock(contact);
            if (netBlock) parts.push(netBlock);
        }

        var wbLayers = Array.isArray(cfg.worldbookLayers)
            ? cfg.worldbookLayers
            : buildWorldbookLayers(contact, contextText);
        appendLayerList(parts, wbLayers);
        appendLayerList(parts, cfg.worldbookBackLayers);

        parts.push(buildListenTogetherOperationRules(contact, profile));
        parts.push(buildListenTogetherRulesBundle(contact));

        return parts.filter(Boolean).join('\n\n');
    }

    function buildAwarenessBlocks(chatSettings, contact, profile, history) {
        var aw = global.MiyaChatAwareness;
        if (!aw) return [];
        var blocks = [];
        var timeRules = aw.buildTimeAwarenessRules(chatSettings, history, profile);
        if (timeRules) blocks.push(timeRules);
        var itBr = global.miyaItineraryBridge;
        if (itBr && typeof itBr.buildChatItineraryBlock === 'function' && contact) {
            var itBlock = itBr.buildChatItineraryBlock(contact, chatSettings);
            if (itBlock) blocks.push(itBlock);
        }
        var placeRules = aw.buildPlaceAwarenessRules(chatSettings, contact, profile);
        if (placeRules) blocks.push('【地点运转】\n' + placeRules);
        var weatherRules = aw.buildWeatherAwarenessRules(chatSettings);
        if (weatherRules) blocks.push(weatherRules);
        return blocks;
    }

    /**
     * 系统提示词块顺序：世界书前 → 全局 → 模式 → 用户身份 → 关系 → 人际脉络 → 感知 → 世界书中 → 能力 → 线上格式
     * （世界书后 / 联系人档案 / 思维链 / 运转规则在 buildApiMessages 末尾单独注入）
     */
    function buildSystemPrompt(input) {
        var cfg = input && typeof input === 'object' ? input : {};
        var contact = cfg.contact;
        var profile = cfg.profile;
        var chatSettings = cfg.chatSettings || null;
        var history = cfg.history || [];
        var contextText = String(cfg.contextText || '').trim();
        var parts = [];
        var aw = global.MiyaChatAwareness;

        appendLayerList(parts, cfg.worldbookFrontLayers);

        var globalP = getGlobalPrompt();
        if (globalP) parts.push('【全局提示词】\n' + globalP);

        parts.push(buildChatModeBlock(contact, profile));

        var userBlock = renderProfileBlock(profile);
        if (userBlock) parts.push(userBlock);

        var avatarBlock = buildAvatarRecognitionBlock(chatSettings, contact, profile);
        if (avatarBlock) parts.push(avatarBlock);
        appendDynamicAvatarContextBlock(parts, chatSettings, contact, profile);
        appendAlbumContextBlock(parts, profile, contact, chatSettings);

        if (aw) {
            var relLine = aw.buildRelationshipLine(chatSettings, contact);
            if (relLine) parts.push(relLine);
            var netBlock = aw.buildChronicleRelationshipBlock(contact);
            if (netBlock) parts.push(netBlock);
        }

        buildAwarenessBlocks(chatSettings, contact, profile, history).forEach(function (b) {
            parts.push(b);
        });

        var wbLayers = Array.isArray(cfg.worldbookLayers)
            ? cfg.worldbookLayers
            : buildWorldbookLayers(contact, contextText);
        appendLayerList(parts, wbLayers);

        var capBlock = buildPromptCapabilitiesBlock(chatSettings);
        if (capBlock) parts.push(capBlock);

        parts.push(buildOnlineRulesBundle(contact, chatSettings));

        return parts.filter(Boolean).join('\n\n');
    }

    /** 线上单聊：联系人档案（含人设与背景）置末注入，紧挨运转规则之前 */
    function appendChronicleBeforeOperationRulesMessage(apiMessages, contact, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!Array.isArray(apiMessages)) return;
        if (opts.callMode || opts.appointmentMode) return;
        var chronicle = renderChronicleBlock(contact);
        if (!chronicle) return;
        apiMessages.push({ role: 'system', content: chronicle });
    }

    /** 思维链：风格指引（可被自定义预设覆盖） */
    function buildThinkingRulesHead(contact, profile) {
        var roleName = String((contact && contact.name) || '对方');
        var userName = String((profile && profile.name) || '用户');
        return (
            '你是' +
            roleName +
            '，须在 <thinking> 标签内完成回复前的内部思考。\n' +
            '须消化人设与世界书、把握与' +
            userName +
            '的关系及当下情绪，回顾你方近期已发原文避免重复话题与同质化描写，并规划本轮正文气泡与格式。'
        );
    }

    /** 思维链：格式硬性要求（始终注入，不可被自定义覆盖） */
    function getThinkingRulesFormatTailItems() {
        return [
            '思维链只写在此段；禁止写入正文；禁止输出 [正文]、[/thinking] 等结构标记。'
        ];
    }

    function buildThinkingRulesFormatTail() {
        return getThinkingRulesFormatTailItems().join('\n');
    }

    /** 思维链：置末注入（运转规则之前） */
    function buildThinkingRules(contact, profile) {
        return (
            '【思维链·必读】\n' +
            buildThinkingRulesHead(contact, profile) +
            '\n' +
            buildThinkingRulesFormatTail()
        );
    }

    /** 线上单聊：思维链置末注入（联系人档案之后、运转规则之前） */
    function appendOnlineThinkingRulesMessage(apiMessages, contact, profile, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!Array.isArray(apiMessages)) return;
        if (opts.callMode || opts.appointmentMode || opts.isMomentsAuto) return;
        var block = null;
        var thMod = global.MiyaChatThinkingRules;
        if (thMod && typeof thMod.resolveForChat === 'function') {
            block = thMod.resolveForChat(opts.chatSettings, contact, profile);
        }
        if (!block) block = buildThinkingRules(contact, profile);
        if (!block) return;
        apiMessages.push({ role: 'system', content: block });
    }

    /** 线上单聊：运转规则置末注入（所有其它 system / 历史 / 本轮块 / 联系人档案之后） */
    function appendOnlineOperationRulesMessage(apiMessages, contact, profile, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!Array.isArray(apiMessages)) return;
        if (opts.callMode || opts.appointmentMode || opts.isMomentsAuto) return;
        var block = null;
        var opMod = global.MiyaChatOperationRules;
        if (opMod && typeof opMod.resolveForChat === 'function') {
            block = opMod.resolveForChat(opts.chatSettings, contact, profile);
        }
        if (!block) block = buildOperationRules(contact, profile);
        if (!block) return;
        var hvTpl = global.MiyaChatHeartVoiceTemplates;
        var hvPreset =
            hvTpl && typeof hvTpl.resolvePresetForChat === 'function'
                ? hvTpl.resolvePresetForChat(opts.chatSettings)
                : null;
        if (hvPreset && typeof hvTpl.rewriteDefaultHeartVoiceMentions === 'function') {
            block = hvTpl.rewriteDefaultHeartVoiceMentions(block);
        }
        apiMessages.push({ role: 'system', content: block });
        /* 自定义心声：再置末一条最高优先级块，确保提示词真正压过默认四行 */
        if (hvPreset && typeof hvTpl.buildCustomHeartVoicePriorityBlock === 'function') {
            var roleName = String((contact && contact.name) || '角色');
            var hvPriority = hvTpl.buildCustomHeartVoicePriorityBlock(roleName, hvPreset);
            if (hvPriority) {
                apiMessages.push({ role: 'system', content: hvPriority });
            }
        }
    }

    function extractThinkingBlock(rawText) {
        var src = String(rawText || '');
        var i;
        for (i = 0; i < THINKING_EXTRACT_SEQ.length; i++) {
            var m = src.match(THINKING_EXTRACT_SEQ[i]);
            if (m && m[1] && String(m[1]).trim()) return String(m[1]).trim();
        }
        var tailPatterns = [
            /<thinking>([\s\S]*)$/i,
            /＜thinking＞([\s\S]*)$/i,
            /\<think\>([\s\S]*)$/i,
            /＜think＞([\s\S]*)$/i,
            /<think>([\s\S]*)$/i
        ];
        for (i = 0; i < tailPatterns.length; i++) {
            var t = src.match(tailPatterns[i]);
            if (t && t[1] && String(t[1]).trim()) return String(t[1]).trim();
        }
        return '';
    }

    function findLastThinkingCloseEnd(raw) {
        var src = String(raw || '');
        var lastEnd = -1;
        var i;
        for (i = 0; i < THINKING_CLOSE_PATTERNS.length; i++) {
            var re = THINKING_CLOSE_PATTERNS[i];
            re.lastIndex = 0;
            var m;
            while ((m = re.exec(src)) !== null) {
                var end = m.index + m[0].length;
                if (end > lastEnd) lastEnd = end;
            }
        }
        return lastEnd;
    }

    /** 正文只取最后一个思维链闭合标签之后的内容，避免 [正文] 草稿与重复输出泄漏 */
    function extractBodyAfterThinkingClose(text) {
        var end = findLastThinkingCloseEnd(text);
        if (end < 0) return String(text || '');
        return String(text || '').slice(end).trim();
    }

    function escapeRegExp(s) {
        return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function stripStructuralMarkerLines(text) {
        var lines = String(text || '').split(/\n/);
        var fmt = getOnlineFormatApi();
        var out = [];
        lines.forEach(function (line) {
            var t = trimLine(line);
            if (!t) return;
            if (fmt && typeof fmt.isStructuralLeakLine === 'function' && fmt.isStructuralLeakLine(t)) {
                return;
            }
            out.push(line);
        });
        return out.join('\n').trim();
    }

    /** 未闭合 thinking 时勿吞掉正文/心声：仅剥思维段，保留其后内容 */
    function stripUnclosedThinkingTail(text) {
        var out = String(text || '');
        var markers = [
            { open: /<thinking>/i, close: /<\/thinking>/i },
            { open: /＜thinking＞/i, close: /＜\/thinking＞/i },
            { open: /\<think\>/i, close: /<\/think>/i },
            { open: /＜think＞/i, close: /＜\/think＞/i },
            { open: /<think>/i, close: /<\/redacted_thinking>|<\/think>/i },
            { open: /<reasoning>/i, close: /<\/reasoning>/i }
        ];
        var guard = 0;
        while (guard < 6) {
            guard += 1;
            var changed = false;
            markers.forEach(function (mk) {
                var m = out.match(mk.open);
                if (!m || m.index == null) return;
                var tail = out.slice(m.index);
                if (mk.close.test(tail)) return;
                var inner = tail.replace(mk.open, '');
                var hvIdx = inner.search(/<miyavoice|＜miyavoice|<heartvoice|＜heartvoice|<心声|＜心声/i);
                if (hvIdx >= 0) {
                    out = out.slice(0, m.index) + inner.slice(hvIdx);
                    changed = true;
                    return;
                }
                var para = inner.search(/\n\s*\n/);
                if (para >= 0 && trim(inner.slice(para))) {
                    out = out.slice(0, m.index) + trim(inner.slice(para));
                } else {
                    out = out.slice(0, m.index).trim();
                }
                changed = true;
            });
            if (!changed) break;
        }
        return out.trim();
    }

    function stripThinkingBlocks(text) {
        var out = String(text || '');
        var closedRegs = [
            /<thinking>[\s\S]*?(?:<\/thinking>|\[\/thinking\]|＜\/thinking＞|［\/thinking］|【\/thinking】)/gi,
            /＜thinking＞[\s\S]*?(?:＜\/thinking＞|\[\/thinking\]|［\/thinking］)/gi,
            /\[thinking\][\s\S]*?\[\/thinking\]/gi,
            /\<think\>[\s\S]*?(?:<\/think>|\[\/think\])/gi,
            /＜think＞[\s\S]*?＜\/think＞/gi,
            /<think>[\s\S]*?<\/redacted_thinking>/gi,
            /<think>[\s\S]*?<\/think>/gi,
            /<reasoning>[\s\S]*?<\/reasoning>/gi
        ];
        var prev;
        var guard = 0;
        while (guard < 10 && prev !== out) {
            prev = out;
            guard += 1;
            closedRegs.forEach(function (re) {
                out = out.replace(re, '');
            });
            out = out.trim();
        }
        out = stripUnclosedThinkingTail(out);
        out = extractBodyAfterThinkingClose(out);
        return stripStructuralMarkerLines(out);
    }

    function parseThinking(text) {
        var raw = String(text || '');
        var thinking = extractThinkingBlock(raw);
        var afterClose = extractBodyAfterThinkingClose(raw);
        var content =
            findLastThinkingCloseEnd(raw) >= 0
                ? stripHeartVoiceTags(afterClose)
                : stripThinkingBlocks(raw);
        content = stripStructuralMarkerLines(stripHeartVoiceTags(content));
        return { thinking: thinking, content: content.trim() };
    }

    function stripThinkingForApi(text) {
        return stripThinkingBlocks(text);
    }

    function extractReasoningFromApi(data) {
        var msg = data && data.choices && data.choices[0] && data.choices[0].message;
        if (!msg || typeof msg !== 'object') return '';
        var r0 = msg.reasoning_content != null ? msg.reasoning_content : msg.reasoning;
        if (typeof r0 === 'string') return r0.trim();
        return String(r0 || '').trim();
    }

    function extractThinkingFromResponse(data, replyRaw) {
        var raw = String(replyRaw || '');
        var tagged = extractThinkingBlock(raw);
        if (tagged) return tagged;
        var rsn = extractReasoningFromApi(data);
        if (rsn) return extractThinkingBlock(rsn) || rsn;
        return '';
    }

    /** 剥掉泄漏的 miyavoice/heartvoice 标签碎片（含 </miyavo> 等截断闭合） */
    function stripHeartVoiceTagFragments(text) {
        var out = String(text || '');
        out = out.replace(/<\/?miyav[\w]*\s*>/gi, '');
        out = out.replace(/＜\/?miyav[\w]*＞/gi, '');
        out = out.replace(/<\/?heartvoice\s*>/gi, '');
        out = out.replace(/＜\/?heartvoice＞/gi, '');
        out = out.replace(/<\/?心声\s*>/gi, '');
        out = out.replace(/＜\/?心声＞/gi, '');
        return out.trim();
    }

    function stripHeartVoiceTags(text) {
        var out = String(text || '');
        var closed = [
            /<miyavoice>[\s\S]*?<\/miyav[\w]*\s*>/gi,
            /＜miyavoice＞[\s\S]*?＜\/miyav[\w]*＞/gi,
            /<miyavoice>[\s\S]*?<\/miyavoice>/gi,
            /＜miyavoice＞[\s\S]*?＜\/miyavoice＞/gi,
            /<heartvoice>[\s\S]*?<\/heart[\w]*\s*>/gi,
            /＜heartvoice＞[\s\S]*?＜\/heart[\w]*＞/gi,
            /<heartvoice>[\s\S]*?<\/heartvoice>/gi,
            /＜heartvoice＞[\s\S]*?＜\/heartvoice＞/gi,
            /<心声>[\s\S]*?<\/心声\s*>/gi,
            /＜心声＞[\s\S]*?＜\/心声＞/gi
        ];
        var i;
        for (i = 0; i < closed.length; i++) out = out.replace(closed[i], '');
        out = out.replace(/<miyavoice>[\s\S]*$/gi, '');
        out = out.replace(/＜miyavoice＞[\s\S]*$/gi, '');
        out = out.replace(/<heartvoice>[\s\S]*$/gi, '');
        out = out.replace(/＜heartvoice＞[\s\S]*$/gi, '');
        out = out.replace(/<心声>[\s\S]*$/gi, '');
        out = out.replace(/【心声】[\s\S]*?(?:【\/心声】|【／心声】|$)/gi, '');
        return stripHeartVoiceTagFragments(out);
    }

    function extractHeartVoiceBlock(rawText) {
        var src = String(rawText || '');
        var patterns = [
            /<miyavoice>([\s\S]*?)<\/miyav[\w]*\s*>/i,
            /＜miyavoice＞([\s\S]*?)＜\/miyav[\w]*＞/i,
            /<miyavoice>([\s\S]*?)<\/miyavoice>/i,
            /＜miyavoice＞([\s\S]*?)＜\/miyavoice＞/i,
            /<heartvoice>([\s\S]*?)<\/heart[\w]*\s*>/i,
            /＜heartvoice＞([\s\S]*?)＜\/heart[\w]*＞/i,
            /<heartvoice>([\s\S]*?)<\/heartvoice>/i,
            /＜heartvoice＞([\s\S]*?)＜\/heartvoice＞/i,
            /<心声>([\s\S]*?)<\/心声\s*>/i,
            /＜心声＞([\s\S]*?)＜／心声＞/i,
            /【心声】([\s\S]*?)【\/心声】/i,
            /【心声】([\s\S]*?)【／心声】/i
        ];
        var i;
        for (i = 0; i < patterns.length; i++) {
            var m = src.match(patterns[i]);
            if (m && m[1] && String(m[1]).trim()) {
                return stripHeartVoiceTagFragments(String(m[1]).trim());
            }
        }
        var tailPatterns = [
            /<miyavoice>([\s\S]*)$/i,
            /＜miyavoice＞([\s\S]*)$/i,
            /<heartvoice>([\s\S]*)$/i,
            /＜heartvoice＞([\s\S]*)$/i,
            /<心声>([\s\S]*)$/i
        ];
        for (i = 0; i < tailPatterns.length; i++) {
            var t = src.match(tailPatterns[i]);
            if (t && t[1] && String(t[1]).trim()) {
                return stripHeartVoiceTagFragments(String(t[1]).trim());
            }
        }
        return '';
    }

    function parseHeartVoiceFieldLine(line, allowedNames) {
        var raw = stripHeartVoiceTagFragments(trimLine(line));
        if (!raw) return null;
        var names = Array.isArray(allowedNames) && allowedNames.length
            ? allowedNames
            : ['好感度', '欲望值', '行为动作', '角色心声'];
        var i;
        for (i = 0; i < names.length; i++) {
            var label = String(names[i] || '').trim();
            if (!label) continue;
            var escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            var re = new RegExp('^' + escaped + '\\s*[-－—：:]\\s*([\\s\\S]+)$');
            var m = raw.match(re);
            if (m) {
                return {
                    key: label,
                    value: stripHeartVoiceTagFragments(trimLine(m[1]))
                };
            }
        }
        return null;
    }

    function clampHeartVoiceScore(n) {
        var v = Math.round(Number(n));
        if (!Number.isFinite(v)) return null;
        return Math.min(100, Math.max(0, v));
    }

    /** 心声单字段上限：禁止对自定义字段做短截断（仅防极端撑爆存储） */
    var HEART_VOICE_FIELD_VALUE_MAX = 100000;
    var HEART_VOICE_LEGACY_LINE_MAX = 20000;

    function clipHeartVoiceFieldValue(v, max) {
        var s = String(v == null ? '' : v);
        var lim = max != null ? max : HEART_VOICE_FIELD_VALUE_MAX;
        if (s.length <= lim) return s;
        return s.slice(0, lim);
    }

    function tryParseCustomJsonFields(inner, fieldNames) {
        var src = String(inner || '').trim();
        if (!src || src.charAt(0) !== '{' ) {
            var m = src.match(/\{[\s\S]*\}/);
            if (!m) return null;
            src = m[0];
        }
        var obj;
        try {
            obj = JSON.parse(src);
        } catch (e1) {
            try {
                obj = JSON.parse(src.replace(/,\s*([}\]])/g, '$1'));
            } catch (e2) {
                return null;
            }
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
        var fields = {};
        var aliasMap = {
            t_top_left: '年月',
            t_top_right: '天气',
            t_content: '心声',
            t_bottom_title: '署名',
            t_bottom_desc: '短文',
            t_typewriter_logo: '品牌',
            dialog: '对话',
            dialogue: '对话',
            monologue: '心声',
            action: '动作',
            thought: '心声'
        };
        fieldNames.forEach(function (name) {
            if (obj[name] != null && String(obj[name]).trim()) {
                fields[name] = clipHeartVoiceFieldValue(String(obj[name]).trim());
            }
        });
        Object.keys(aliasMap).forEach(function (ak) {
            var cn = aliasMap[ak];
            if (fieldNames.indexOf(cn) < 0) return;
            if (fields[cn]) return;
            if (obj[ak] != null && String(obj[ak]).trim()) {
                fields[cn] = clipHeartVoiceFieldValue(String(obj[ak]).trim());
            }
        });
        var matched = 0;
        fieldNames.forEach(function (n) {
            if (String(fields[n] || '').trim()) matched += 1;
        });
        if (!matched) return null;
        return fields;
    }

    function parseHeartVoiceInner(inner, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var fieldNames = Array.isArray(opts.fieldNames) ? opts.fieldNames.filter(Boolean) : [];
        var customMode = fieldNames.length > 0;
        var lines = String(inner || '')
            .split(/\n/)
            .map(function (s) {
                return trimLine(s);
            })
            .filter(Boolean);
        if (customMode) {
            var fields = {};
            var currentKey = null;
            var i;
            for (i = 0; i < lines.length; i++) {
                var row = parseHeartVoiceFieldLine(lines[i], fieldNames);
                if (row) {
                    currentKey = row.key;
                    fields[currentKey] = clipHeartVoiceFieldValue(row.value || '');
                    continue;
                }
                if (currentKey && lines[i]) {
                    fields[currentKey] = String(fields[currentKey] || '');
                    if (fields[currentKey]) fields[currentKey] += '\n';
                    fields[currentKey] = clipHeartVoiceFieldValue(fields[currentKey] + lines[i]);
                }
            }
            var matched = 0;
            fieldNames.forEach(function (name) {
                if (String(fields[name] || '').trim()) matched += 1;
            });
            if (!matched) {
                var fromJson = tryParseCustomJsonFields(inner, fieldNames);
                if (fromJson) {
                    fields = fromJson;
                    matched = 0;
                    fieldNames.forEach(function (name) {
                        if (String(fields[name] || '').trim()) matched += 1;
                    });
                }
            }
            var ok = matched > 0;
            return {
                extracted: {
                    mode: 'custom',
                    fields: fields,
                    affection: null,
                    desire: null,
                    action: '',
                    monologue: ''
                },
                extractedOk: ok
            };
        }
        var out = {
            affection: null,
            desire: null,
            action: '',
            monologue: ''
        };
        var j;
        for (j = 0; j < lines.length; j++) {
            var legacy = parseHeartVoiceFieldLine(lines[j]);
            if (!legacy) continue;
            if (legacy.key === '好感度') out.affection = clampHeartVoiceScore(legacy.value);
            else if (legacy.key === '欲望值') out.desire = clampHeartVoiceScore(legacy.value);
            else if (legacy.key === '行为动作')
                out.action = clipHeartVoiceFieldValue(legacy.value || '', HEART_VOICE_LEGACY_LINE_MAX);
            else if (legacy.key === '角色心声')
                out.monologue = clipHeartVoiceFieldValue(legacy.value || '', HEART_VOICE_LEGACY_LINE_MAX);
        }
        var legacyOk =
            out.affection != null &&
            out.desire != null &&
            !!out.action &&
            !!out.monologue;
        return { extracted: out, extractedOk: legacyOk };
    }

    function parseHeartVoiceFromReply(rawText, opts) {
        var src = String(rawText || '');
        var inner = extractHeartVoiceBlock(src);
        var rawHasHeartVoiceTag = /<miyavoice|＜miyavoice|<heartvoice|＜heartvoice|<心声|＜心声|【心声】/i.test(src);
        if (!inner) {
            return {
                rawHasHeartVoiceTag: rawHasHeartVoiceTag,
                extractedOk: false,
                extracted: null,
                updatedAt: Date.now()
            };
        }
        var parsed = parseHeartVoiceInner(inner, opts);
        return {
            rawHasHeartVoiceTag: rawHasHeartVoiceTag,
            extractedOk: !!parsed.extractedOk,
            extracted: parsed.extracted,
            updatedAt: Date.now()
        };
    }

    var HEART_VOICE_LOG_MAX = 100;

    function appendHeartVoiceLog(prevLog, entry) {
        var log = Array.isArray(prevLog) ? prevLog.slice() : [];
        log.unshift(entry);
        if (log.length > HEART_VOICE_LOG_MAX) log.length = HEART_VOICE_LOG_MAX;
        return log;
    }


    function estimateTokensFromText(text) {
        var s = String(text || '');
        if (!s) return 0;
        return Math.max(1, Math.ceil(s.length / 1.6));
    }

    /** 仅知字符数、无正文时的 token 估算（勿把数字转成字符串再估） */
    function estimateTokensFromCharCount(charCount) {
        var n = Number(charCount);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.max(1, Math.ceil(n / 1.6));
    }

    function estimateMessagesTokens(messages) {
        if (!Array.isArray(messages)) return 0;
        var sum = 0;
        messages.forEach(function (m) {
            if (!m) return;
            sum += estimateTokensFromText(m.content);
            if (m.role) sum += 4;
        });
        return sum;
    }

    /** 实际发往 API 的 messages 正文合计字符数（与请求体 content 一致） */
    function countMessagesChars(messages) {
        if (!Array.isArray(messages)) return 0;
        var sum = 0;
        messages.forEach(function (m) {
            if (!m) return;
            sum += String(m.content || '').length;
        });
        return sum;
    }

    function buildPromptMeta(apiMessages, wbMeta) {
        var list = Array.isArray(apiMessages) ? apiMessages : [];
        var systemChars = 0;
        var historyChars = 0;
        var totalChars = 0;
        var systemText = '';
        list.forEach(function (m) {
            var n = String((m && m.content) || '').length;
            totalChars += n;
            if (m && m.role === 'system') {
                systemChars += n;
                systemText += String(m.content || '') + '\n';
            } else historyChars += n;
        });
        var wb = wbMeta && typeof wbMeta === 'object' ? wbMeta : {};
        var wbChars = Number(wb.injectedChars != null ? wb.injectedChars : wb.chars) || 0;
        var hasHvRules = /miyavoice|heartvoice|心声段|【线上格式规则·心声】/i.test(systemText);
        return {
            estimated_prompt_tokens: estimateMessagesTokens(list),
            total_prompt_chars: totalChars,
            system_chars: systemChars,
            history_chars: historyChars,
            message_count: list.length,
            system_message_count: list.filter(function (m) {
                return m && m.role === 'system';
            }).length,
            has_heartvoice_rules: hasHvRules,
            worldbook_matched: Number(wb.matched) || 0,
            worldbook_chars: wbChars,
            worldbook_in_system: wb.inSystem !== false,
            worldbook_empty_matched: Number(wb.emptyMatched) || 0,
            updatedAt: Date.now()
        };
    }

    var PROMPT_SOURCE_LABELS = {
        system_lead: '前置系统指令',
        system_main: '系统主提示（人设/档案/规则）',
        worldbook: '世界书（嵌入系统提示）',
        summary: '对话总结记忆',
        char_memory: '角色长期记忆',
        moments_ctx: '朋友圈互动记忆',
        offline: '线下场景总结',
        transfer: '待确认转账',
        per_turn_inject: '本轮注入（格式/心声/单聊锁定）',
        chronicle: '角色档案（人设·背景）',
        operation_rules: '运转规则·必读（置末）',
        thinking_rules: '思维链·必读（置末）',
        call: '通话态指令',
        call_vision: '通话画面/视觉',
        group_memory: '群聊记忆摘录',
        return_prompt: '线上回归提示',
        history_user: '历史·用户消息',
        history_assistant: '历史·角色回复',
        nudge: '续聊/主动推送指令',
        moments_task: '朋友圈自动任务',
        current_user: '本轮用户输入',
        other_system: '其它系统块',
        last_completion: '上轮模型完整回复',
        last_thinking: '上轮思维链（<thinking>）',
        unknown: '未知来源'
    };

    function messageContentText(msg) {
        if (!msg) return '';
        var c = msg.content;
        if (c == null) return '';
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) {
            return c
                .map(function (part) {
                    if (part == null) return '';
                    if (typeof part === 'string') return part;
                    if (part.type === 'text') return String(part.text || '');
                    if (part.type === 'image_url') return '[image]';
                    return '';
                })
                .join('\n');
        }
        return String(c);
    }

    function classifyApiMessageSource(msg, index, messages) {
        var role = msg && msg.role ? msg.role : '';
        var text = String(messageContentText(msg) || '').trim();
        var chars = text.length;
        function row(key, extra) {
            var out = {
                key: key,
                label: PROMPT_SOURCE_LABELS[key] || key,
                chars: chars,
                tokens: estimateTokensFromText(text),
                preview: text.slice(0, 160)
            };
            if (extra && typeof extra === 'object') {
                Object.keys(extra).forEach(function (k) {
                    out[k] = extra[k];
                });
            }
            return out;
        }
        if (role === 'user') {
            if (/^（请从新的一轮继续|^（请主动发一条|^（通话中：/.test(text)) {
                return row('nudge');
            }
            if (/这是我当前视频画面/.test(text)) return row('call_vision');
            if (index === messages.length - 1) return row('current_user');
            return row('history_user');
        }
        if (role === 'assistant') return row('history_assistant');
        if (role === 'system') {
            if (text.indexOf('【强制任务·仅发朋友圈】') === 0) return row('moments_task');
            if (text.indexOf('【通话态·强制提醒】') === 0) return row('call');
            if (text.indexOf('【用户摄像头画面】') === 0) return row('call_vision');
            if (text.indexOf('【用户摄像头状态】') === 0) return row('call_vision');
            if (text.indexOf('【本轮 · 用户向你转账') === 0) return row('transfer');
            if (text.indexOf('【长期记忆·对话总结】') === 0 || text.indexOf('【本群·记忆总结】') === 0) {
                return row('summary');
            }
            if (text.indexOf('【长期记忆·角色重要记忆】') === 0 || text.indexOf('【角色记忆') >= 0) {
                return row('char_memory');
            }
            if (text.indexOf('【朋友圈·近期互动记忆】') === 0 || text.indexOf('【朋友圈记忆') >= 0) {
                return row('moments_ctx');
            }
            if (text.indexOf('【线下场景总结') >= 0 || text.indexOf('【线下场次总结') >= 0) {
                return row('offline');
            }
            if (
                text.indexOf('【场景锁定·单聊】') === 0 ||
                text.indexOf('【本轮 · 格式') >= 0 ||
                text.indexOf('【重新生成') >= 0 ||
                text.indexOf('【上轮心声') >= 0 ||
                text.indexOf('【本轮 · 单聊') >= 0
            ) {
                return row('per_turn_inject');
            }
            if (text.indexOf('【群聊记忆') >= 0 || text.indexOf('【私聊·群记忆') >= 0) {
                return row('group_memory');
            }
            if (text.indexOf('【线上回归') >= 0 || text.indexOf('【从线下回归') >= 0) {
                return row('return_prompt');
            }
            if (
                text.indexOf('【运转规则·必读】') === 0 ||
                text.indexOf('【运转规则·自定义】') === 0
            ) {
                return row('operation_rules');
            }
            if (text.indexOf('【思维链·必读】') === 0 || text.indexOf('【思维链·自定义】') === 0) {
                return row('thinking_rules');
            }
            if (text.indexOf('【角色·档案·') === 0) {
                return row('chronicle');
            }
            var firstSystemIdx = -1;
            for (var si = 0; si < messages.length; si++) {
                if (messages[si] && messages[si].role === 'system') {
                    firstSystemIdx = si;
                    break;
                }
            }
            if (
                index === firstSystemIdx &&
                (text.indexOf('【运转规则') >= 0 ||
                    text.indexOf('【全局提示词】') >= 0 ||
                    text.indexOf('【对话模式') >= 0)
            ) {
                return row('system_main', { isMainSystem: true });
            }
            if (index === 0 && role === 'system' && text.length < 800 && text.indexOf('【运转规则') < 0) {
                return row('system_lead');
            }
            return row('other_system');
        }
        return row('unknown');
    }

    /** 按来源分区统计 prompt 字符/token（供设置页展示） */
    function buildPromptSourceBreakdown(apiMessages, wbMeta) {
        var list = Array.isArray(apiMessages) ? apiMessages : [];
        var wb = wbMeta && typeof wbMeta === 'object' ? wbMeta : {};
        var wbChars = Number(wb.injectedChars != null ? wb.injectedChars : wb.chars) || 0;
        var rawItems = [];
        var mainSystemAdjusted = false;

        list.forEach(function (m, i) {
            var src = classifyApiMessageSource(m, i, list);
            if (src.isMainSystem && wbChars > 0 && src.chars > wbChars) {
                var mainChars = src.chars - wbChars;
                var wbTokens = estimateTokensFromCharCount(wbChars);
                rawItems.push({
                    key: 'system_main',
                    label: PROMPT_SOURCE_LABELS.system_main,
                    chars: mainChars,
                    tokens: estimateTokensFromCharCount(mainChars),
                    preview: src.preview
                });
                rawItems.push({
                    key: 'worldbook',
                    label: PROMPT_SOURCE_LABELS.worldbook,
                    chars: wbChars,
                    tokens: wbTokens,
                    preview: '命中 ' + (Number(wb.matched) || 0) + ' 条世界书条目'
                });
                mainSystemAdjusted = true;
            } else if (src.isMainSystem && wbChars > 0 && src.chars <= wbChars) {
                rawItems.push({
                    key: 'worldbook',
                    label: PROMPT_SOURCE_LABELS.worldbook,
                    chars: src.chars,
                    tokens: src.tokens,
                    preview: src.preview
                });
                mainSystemAdjusted = true;
            } else {
                rawItems.push(src);
            }
        });

        if (!mainSystemAdjusted && wbChars > 0) {
            rawItems.push({
                key: 'worldbook',
                label: PROMPT_SOURCE_LABELS.worldbook,
                chars: wbChars,
                tokens: estimateTokensFromCharCount(wbChars),
                preview: '命中 ' + (Number(wb.matched) || 0) + ' 条世界书条目'
            });
        }

        var groupedMap = {};
        rawItems.forEach(function (item) {
            var key = item.key || 'unknown';
            if (!groupedMap[key]) {
                groupedMap[key] = {
                    key: key,
                    label: item.label || PROMPT_SOURCE_LABELS[key] || key,
                    chars: 0,
                    tokens: 0,
                    count: 0,
                    items: []
                };
            }
            var g = groupedMap[key];
            g.chars += Number(item.chars) || 0;
            g.tokens += Number(item.tokens) || 0;
            g.count += 1;
            g.items.push(item);
        });

        var grouped = Object.keys(groupedMap)
            .map(function (k) {
                return groupedMap[k];
            })
            .sort(function (a, b) {
                return (b.chars || 0) - (a.chars || 0);
            });

        var promptChars = countMessagesChars(list);
        var promptTokens = estimateMessagesTokens(list);

        return {
            sources: rawItems,
            grouped: grouped,
            promptChars: promptChars,
            promptTokens: promptTokens,
            worldbookMatched: Number(wb.matched) || 0,
            worldbookInSystem: wb.inSystem !== false,
            updatedAt: Date.now()
        };
    }

    /** 调试用：保存本轮实际发往 API 的 messages 快照 */
    function buildPromptDebug(apiMessages) {
        var list = Array.isArray(apiMessages) ? apiMessages : [];
        var systemText = '';
        var totalChars = 0;
        list.forEach(function (m) {
            var c = String((m && m.content) || '');
            totalChars += c.length;
            if (m && m.role === 'system') systemText += c + '\n';
        });
        var opIdx = systemText.indexOf('【运转规则');
        var hvIdx = systemText.indexOf('【线上格式规则·心声');
        var snippet = '';
        if (hvIdx >= 0) snippet = systemText.slice(hvIdx, hvIdx + 600);
        else if (opIdx >= 0) snippet = systemText.slice(opIdx, opIdx + 600);
        var hasHvRules = hvIdx >= 0 || /miyavoice|heartvoice|心声段/i.test(systemText);
        var slim = list.map(function (m, i) {
            return {
                i: i,
                role: m && m.role ? m.role : '',
                chars: String((m && m.content) || '').length,
                content: String((m && m.content) || '')
            };
        });
        var json = '';
        try {
            json = JSON.stringify(slim);
        } catch (e) {
            json = '[]';
        }
        return {
            messagesJson: json,
            hasHeartVoiceRules: hasHvRules,
            heartVoiceRulesSnippet: snippet,
            total_chars: totalChars,
            estimated_tokens: estimateMessagesTokens(list),
            message_count: list.length,
            updatedAt: Date.now()
        };
    }

    /** 从 chat/completions 响应提取 token 用量（如实记录 API 返回字段） */
    function extractUsageFromApi(data) {
        var u =
            (data && data.usage) ||
            (data && data.choices && data.choices[0] && data.choices[0].usage) ||
            null;
        if (!u || typeof u !== 'object') return null;
        var prompt =
            u.prompt_tokens != null
                ? u.prompt_tokens
                : u.input_tokens != null
                  ? u.input_tokens
                  : u.promptTokens;
        var completion =
            u.completion_tokens != null
                ? u.completion_tokens
                : u.output_tokens != null
                  ? u.output_tokens
                  : u.completionTokens;
        var total = u.total_tokens != null ? u.total_tokens : u.totalTokens;
        var p = Number(prompt);
        var c = Number(completion);
        var t = Number(total);
        if (!Number.isFinite(p) && !Number.isFinite(c) && !Number.isFinite(t)) return null;
        var out = {
            prompt_tokens: Number.isFinite(p) ? Math.max(0, Math.floor(p)) : 0,
            completion_tokens: Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 0,
            total_tokens: Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0
        };
        if (!out.total_tokens && (out.prompt_tokens || out.completion_tokens)) {
            out.total_tokens = out.prompt_tokens + out.completion_tokens;
        }
        out.updatedAt = Date.now();
        return out;
    }

    /**
     * 单条消息能否写出非空 API 正文（与 appendHistoryToApiMessages 纳入规则一致）。
     * memoryCount 只统计线上可注入消息；关闭注入的角色旁白/空壳不计名额。
     */
    function getHistoryRowApiBody(m, fmtHist) {
        if (!m || m.deleted) return '';
        fmtHist = fmtHist || getOnlineFormatApi();
        if (m.role === 'system' && m.type === 'diary_peek_context') {
            if (fmtHist && typeof fmtHist.formatDiaryPeekContextForApi === 'function') {
                return String(fmtHist.formatDiaryPeekContextForApi(m) || '').trim();
            }
            return String(m.content || '').trim();
        }
        if (fmtHist && typeof fmtHist.shouldOmitMessage === 'function' && fmtHist.shouldOmitMessage(m)) {
            return '';
        }
        if (m.role === 'system') {
            if (fmtHist && typeof fmtHist.isOnlineNarrationMessage === 'function' && fmtHist.isOnlineNarrationMessage(m)) {
                var rowIsUserNarr =
                    fmtHist && typeof fmtHist.isUserOnlineNarrationMessage === 'function'
                        ? fmtHist.isUserOnlineNarrationMessage(m)
                        : String(m.narrationFrom || '') === 'user';
                /* 用户旁白始终可注入；角色旁白才看 excludedFromContext */
                if (!rowIsUserNarr && m.excludedFromContext) return '';
                if (typeof fmtHist.formatNarrationForApi === 'function') {
                    return String(fmtHist.formatNarrationForApi(m) || '').trim();
                }
                return String(m.content || '').trim() ? '旁白-' + String(m.content).trim() : '';
            }
            if (m.type === 'call_capsule' && fmtHist && typeof fmtHist.formatCallCapsuleForApi === 'function') {
                return String(fmtHist.formatCallCapsuleForApi(m) || '').trim();
            }
            if (
                m.type === 'listen_together_capsule' &&
                fmtHist &&
                typeof fmtHist.formatListenTogetherCapsuleForApi === 'function'
            ) {
                return String(fmtHist.formatListenTogetherCapsuleForApi(m) || '').trim();
            }
            if (
                fmtHist &&
                typeof fmtHist.isAlbumAvatarChangeMessage === 'function' &&
                fmtHist.isAlbumAvatarChangeMessage(m)
            ) {
                if (typeof fmtHist.formatAlbumAvatarChangeForApi === 'function') {
                    return String(fmtHist.formatAlbumAvatarChangeForApi(m) || '').trim();
                }
                return String(m.content || '').trim();
            }
            return '';
        }
        if (m.role !== 'user' && m.role !== 'assistant') return '';
        var body =
            fmtHist && typeof fmtHist.formatMessageForApi === 'function'
                ? fmtHist.formatMessageForApi(m)
                : String(m.content || '').trim();
        if (m.role === 'assistant') body = stripThinkingForApi(body);
        return String(body || '').trim();
    }

    /**
     * 按设定 memoryCount 从尾部取最近可注入消息。
     * 线上气泡、线下镜像、可注入系统旁白/胶囊等一律按一条计入名额（与设定条数一致）。
     * 保持时间线原序；空壳不计。
     */
    function sliceHistoryForApiContext(history, limit) {
        var list = Array.isArray(history) ? history : [];
        var lim = Math.min(500, Math.max(1, Number(limit) || HISTORY_LIMIT));
        var fmtHist = getOnlineFormatApi();
        var eligible = [];
        list.forEach(function (m) {
            if (getHistoryRowApiBody(m, fmtHist)) eligible.push(m);
        });
        return eligible.length <= lim ? eligible.slice() : eligible.slice(-lim);
    }

    /**
     * 连续用户消息合并为一条；连续角色气泡/可注入旁白合并为一条 assistant（防网关折叠中间 assistant）。
     * 严格按时间线顺序写出；user / assistant / system 身份不混淆。
     * 开启时间感知时每条带发送时刻前缀。
     */
    function appendHistoryToApiMessages(apiMessages, history, chatSettings) {
        var buf = [];
        var bufStamped = [];
        var asstBuf = [];
        var aw = global.MiyaChatAwareness;
        var nowTs = Date.now();
        var lastStampedTs = 0;
        var fmtHist = getOnlineFormatApi();
        function flushUser() {
            if (!buf.length) return;
            /* stamped 为空时回退原文，避免单条用户消息被时间戳剥离后整段丢掉 */
            var parts = buf.map(function (raw, i) {
                var stamped = bufStamped[i];
                return stamped != null && String(stamped).trim() ? stamped : raw;
            });
            apiMessages.push({
                role: 'user',
                content: parts.join(USER_MSG_JOIN)
            });
            buf = [];
            bufStamped = [];
        }
        function flushAssistant() {
            if (!asstBuf.length) return;
            apiMessages.push({ role: 'assistant', content: asstBuf.join('\n') });
            asstBuf = [];
        }
        function pushAssistantLine(body, m) {
            if (!body) return;
            flushUser();
            var stamped = body;
            if (aw && typeof aw.stampMessageForApi === 'function') {
                stamped = aw.stampMessageForApi(body, m || { role: 'assistant' }, chatSettings, nowTs, lastStampedTs);
            }
            asstBuf.push(stamped);
            lastStampedTs = pickMessageTs(m, lastStampedTs);
        }
        function pushSystemBlock(block) {
            if (!block) return;
            flushUser();
            flushAssistant();
            apiMessages.push({ role: 'system', content: block });
        }
        history.forEach(function (m) {
            if (!m || m.deleted) return;
            if (m.role === 'system' && m.type === 'diary_peek_context') {
                var peekBlock =
                    fmtHist && typeof fmtHist.formatDiaryPeekContextForApi === 'function'
                        ? fmtHist.formatDiaryPeekContextForApi(m)
                        : String(m.content || '').trim();
                pushSystemBlock(peekBlock);
                return;
            }
            if (fmtHist && typeof fmtHist.shouldOmitMessage === 'function' && fmtHist.shouldOmitMessage(m)) {
                return;
            }
            if (m.role === 'system') {
                if (fmtHist && typeof fmtHist.isOnlineNarrationMessage === 'function' && fmtHist.isOnlineNarrationMessage(m)) {
                    var isUserNarr =
                        fmtHist && typeof fmtHist.isUserOnlineNarrationMessage === 'function'
                            ? fmtHist.isUserOnlineNarrationMessage(m)
                            : String(m.narrationFrom || '') === 'user';
                    /* 用户旁白始终注入；角色旁白才受「旁白注入上下文」开关影响 */
                    if (!isUserNarr && m.excludedFromContext) return;
                    var narrBody =
                        typeof fmtHist.formatNarrationForApi === 'function'
                            ? fmtHist.formatNarrationForApi(m)
                            : String(m.content || '').trim()
                              ? '旁白-' + String(m.content).trim()
                              : '';
                    narrBody = String(narrBody || '').trim();
                    if (!narrBody) return;
                    if (isUserNarr) {
                        /* 用户旁白：固定以 system 注入，始终进上下文 */
                        var narrStamp =
                            aw && typeof aw.stampMessageForApi === 'function'
                                ? aw.stampMessageForApi(
                                      narrBody,
                                      Object.assign({}, m, { role: 'user' }),
                                      chatSettings,
                                      nowTs,
                                      lastStampedTs
                                  )
                                : narrBody;
                        pushSystemBlock(narrStamp);
                        lastStampedTs = pickMessageTs(m, lastStampedTs);
                    } else {
                        pushAssistantLine(narrBody, m);
                    }
                    return;
                }
                if (m.type === 'call_capsule' && fmtHist && typeof fmtHist.formatCallCapsuleForApi === 'function') {
                    pushSystemBlock(fmtHist.formatCallCapsuleForApi(m));
                } else if (
                    m.type === 'listen_together_capsule' &&
                    fmtHist &&
                    typeof fmtHist.formatListenTogetherCapsuleForApi === 'function'
                ) {
                    pushSystemBlock(fmtHist.formatListenTogetherCapsuleForApi(m));
                } else if (
                    fmtHist &&
                    typeof fmtHist.isAlbumAvatarChangeMessage === 'function' &&
                    fmtHist.isAlbumAvatarChangeMessage(m)
                ) {
                    var albBlock =
                        fmtHist && typeof fmtHist.formatAlbumAvatarChangeForApi === 'function'
                            ? fmtHist.formatAlbumAvatarChangeForApi(m)
                            : String(m.content || '').trim();
                    pushSystemBlock(albBlock);
                }
                return;
            }
            if (m.role === 'user') {
                var ut =
                    fmtHist && typeof fmtHist.formatMessageForApi === 'function'
                        ? fmtHist.formatMessageForApi(m)
                        : String(m.content || '').trim();
                if (!ut) return;
                flushAssistant();
                ut = applyOfflineMeetLabel(ut, m);
                var stamped =
                    aw && typeof aw.stampMessageForApi === 'function'
                        ? aw.stampMessageForApi(ut, m, chatSettings, nowTs, lastStampedTs)
                        : ut;
                buf.push(ut);
                bufStamped.push(stamped);
                lastStampedTs = pickMessageTs(m, lastStampedTs);
                return;
            }
            if (m.role === 'assistant') {
                var body =
                    fmtHist && typeof fmtHist.formatMessageForApi === 'function'
                        ? fmtHist.formatMessageForApi(m)
                        : String(m.content || '').trim();
                body = stripThinkingForApi(body);
                if (!body) return;
                body = applyOfflineMeetLabel(body, m);
                pushAssistantLine(body, m);
            }
        });
        flushUser();
        flushAssistant();
    }

    function pickMessageTs(m, fallback) {
        var t = Number(m && m.createdAt);
        return Number.isFinite(t) && t > 0 ? t : fallback || 0;
    }

    var pendingOnlineReturnPromptByChat = Object.create(null);

    function filterOfflineMirrorsFromApiHistory(history, apiChatId, contactId) {
        var apMem = global.MiyaAppointmentMemory;
        if (apMem && typeof apMem.filterOfflineMirrorsForApiHistory === 'function') {
            return apMem.filterOfflineMirrorsForApiHistory(history, apiChatId, contactId);
        }
        return (history || []).filter(function (m) {
            return !m || !m.offlineMeet;
        });
    }

    /** 与 buildApiMessages 一致：消息读写用 canonical chatId，避免撤回与上下文错位 */
    function resolveApiChatId(chatId) {
        var cid = String(chatId || '').trim();
        if (!cid) return '';
        var apMem = global.MiyaAppointmentMemory;
        if (apMem && typeof apMem.resolveCanonicalChatId === 'function') {
            return apMem.resolveCanonicalChatId(cid) || cid;
        }
        return cid;
    }

    function omitTrailingAssistantRound(messages) {
        var drop = {};
        getTrailingAssistantRound(messages).forEach(function (m) {
            if (m && m.id) drop[String(m.id)] = true;
        });
        if (!Object.keys(drop).length) return messages || [];
        return (messages || []).filter(function (m) {
            return m && !drop[String(m.id)];
        });
    }

    function applyOfflineMeetLabel(body, m) {
        var text = String(body || '').trim();
        if (!text || !m || !m.offlineMeet) return text;
        var stamp = '';
        try {
            var ts = Number(m.createdAt);
            if (Number.isFinite(ts) && ts > 0) {
                stamp = new Date(ts).toLocaleString('zh-CN', {
                    hour12: false,
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (eStamp) {}
        return (stamp ? '〔' + stamp + '·线下〕' : '〔线下〕') + text;
    }

    function formatOfflineMirrorForApiContext(m, fmtCtx) {
        if (!m || m.deleted) return '';
        var body =
            fmtCtx && typeof fmtCtx.formatMessageForApi === 'function'
                ? fmtCtx.formatMessageForApi(m)
                : String(m.content || '').trim();
        return applyOfflineMeetLabel(body, m);
    }

    function buildApiMessages(chatId, userText, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var store = global.miyaChatStore;
        if (!store) return { error: 'store_missing', messages: [] };
        var chat = store.findChat(chatId);
        if (!chat) return { error: 'chat_not_found', messages: [] };
        if (
            chat.type === 'group' &&
            global.MiyaChatGroup &&
            typeof global.MiyaChatGroup.buildApiMessages === 'function'
        ) {
            return global.MiyaChatGroup.buildApiMessages(chatId, userText, opts);
        }
        var contact = store.findContact(chat.contactId);
        if (!contact) return { error: 'contact_not_found', messages: [] };
        var profiles = store.getProfiles();
        var profile = profiles.find(function (p) { return p.id === chat.profileId; }) || store.getActiveProfile();
        if (!profile) return { error: 'profile_missing', messages: [] };

        var apMemCanon = global.MiyaAppointmentMemory;
        var apiChatId = chatId;
        if (apMemCanon && typeof apMemCanon.resolveCanonicalChatId === 'function') {
            apiChatId = apMemCanon.resolveCanonicalChatId(chatId) || chatId;
        }
        if (
            contact &&
            contact.id &&
            global.MiyaAppointmentStore &&
            typeof global.MiyaAppointmentStore.syncAllSessionsToChat === 'function'
        ) {
            try {
                global.MiyaAppointmentStore.syncAllSessionsToChat(apiChatId, contact.id);
            } catch (e) {}
        }

        var history =
            store.getMergedMessagesForApi && typeof store.getMergedMessagesForApi === 'function'
                ? store.getMergedMessagesForApi(chatId)
                : store.getMessagesForApi && typeof store.getMessagesForApi === 'function'
                  ? store.getMessagesForApi(apiChatId)
                  : store.getMessages(apiChatId).filter(function (m) {
                        return m && !m.deleted;
                    });
        var settings = store.getChatSettings ? store.getChatSettings(chatId) : null;
        if (opts.chatSettings && typeof opts.chatSettings === 'object') {
            settings = Object.assign({}, settings || {}, opts.chatSettings);
        }
        var limit = settings && settings.memoryCount
            ? Math.min(500, Math.max(1, settings.memoryCount))
            : HISTORY_LIMIT;
        /*
         * 每次触发回复都从 store 现读时间线：按 memoryCount 注入最近完整一段
         *（用户 / 角色 / 可注入系统消息 / 线下镜像，各占 1 条名额），顺序与时刻不改写。
         * 已沉淀的分镜/合卷只作为【长期记忆】系统块；不从本窗口剔除原文，以免少注、断档。
         * 线下镜像同样进入分镜/合卷总结时间线（带〔线下〕标记）。
         */
        var historyForAppend = filterOfflineMirrorsFromApiHistory(
            history,
            apiChatId,
            contact && contact.id
        );
        var sliceAppend = sliceHistoryForApiContext(historyForAppend, limit);
        var sliceContext = sliceAppend;
        if (opts.isRegenerate) {
            sliceAppend = omitTrailingAssistantRound(sliceAppend);
            sliceContext = omitTrailingAssistantRound(sliceContext);
        }
        var fmtCtx = getOnlineFormatApi();
        var contextText =
            sliceContext
                .map(function (m) {
                    return formatOfflineMirrorForApiContext(m, fmtCtx);
                })
                .filter(Boolean)
                .join('\n') +
            '\n' +
            userText;
        var wbBundle = buildWorldbookBundle(contact, contextText, null, {
            promptContext: 'online',
            includeAllBoundLocal: true
        });
        var systemContent = opts.callMode
            ? buildCallSystemPrompt({
                  contact: contact,
                  profile: profile,
                  contextText: contextText,
                  chatSettings: settings,
                  history: sliceContext,
                  worldbookFrontLayers: wbBundle.frontLayers,
                  worldbookLayers: wbBundle.layers,
                  worldbookBackLayers: wbBundle.backLayers,
                  callKind: opts.callKind
              })
            : buildSystemPrompt({
                  contact: contact,
                  profile: profile,
                  contextText: contextText,
                  chatSettings: settings,
                  history: sliceContext,
                  worldbookFrontLayers: wbBundle.frontLayers,
                  worldbookLayers: wbBundle.layers
              });

        if (wbBundle.meta) {
            var systemLayers = []
                .concat(wbBundle.frontLayers || [], wbBundle.layers || []);
            wbBundle.meta.inSystem =
                systemLayers.length === 0 ||
                systemLayers.every(function (layer) {
                    var chunk = String(layer || '').trim();
                    return !chunk || systemContent.indexOf(chunk) >= 0;
                });
            wbBundle.meta.injectedChars = sumLayerChars(systemLayers) + sumLayerChars(wbBundle.backLayers);
            wbBundle.meta.chars = wbBundle.meta.injectedChars;
        }

        var htmlApi = global.MiyaChatHtml;
        var pendingUserText = String(userText || '').trim();
        var htmlMode =
            !opts.callMode &&
            !opts.appointmentMode &&
            htmlApi &&
            typeof htmlApi.detectHtmlModeFromWorldbook === 'function' &&
            htmlApi.detectHtmlModeFromWorldbook(wbBundle);
        if (htmlMode) {
            systemContent =
                systemContent + '\n\n' + htmlApi.buildHtmlGenerationRules({ mode: 'online', fromWorldbook: true });
        }

        var ggMem = global.MiyaChatGroup;
        if (
            !opts.appointmentMode &&
            !opts.callMode &&
            ggMem &&
            typeof ggMem.buildGroupMemoryBlockForPrivate === 'function'
        ) {
            var groupMemBlock = ggMem.buildGroupMemoryBlockForPrivate(
                store,
                contact,
                chat.profileId,
                chatId
            );
            if (groupMemBlock) {
                systemContent = systemContent + '\n\n' + groupMemBlock;
            }
        }

        var apiMessages = [{ role: 'system', content: systemContent }];
        var awInject = global.MiyaChatAwareness;
        var summaryBlock =
            awInject && typeof awInject.buildSummaryContextBlock === 'function'
                ? awInject.buildSummaryContextBlock(settings)
                : '';
        if (summaryBlock) {
            apiMessages.push({ role: 'system', content: summaryBlock });
        }
        var memExtract = global.MiyaChatMemoryExtract;
        var charMemBlock =
            memExtract && typeof memExtract.buildCharMemoryContextBlock === 'function'
                ? memExtract.buildCharMemoryContextBlock(settings)
                : '';
        if (charMemBlock) {
            apiMessages.push({ role: 'system', content: charMemBlock });
        }
        var mmApi = global.MiyaChatMoments;
        var momentsBlock =
            mmApi && typeof mmApi.buildMomentsContextBlock === 'function'
                ? mmApi.buildMomentsContextBlock(settings)
                : '';
        if (momentsBlock) {
            apiMessages.push({ role: 'system', content: momentsBlock });
        }
        var returnPrompt = String(pendingOnlineReturnPromptByChat[apiChatId] || pendingOnlineReturnPromptByChat[chatId] || '').trim();
        var apMem = global.MiyaAppointmentMemory;
        var offSumText = '';
        if (!opts.appointmentMode && !opts.callMode && apMem && typeof apMem.buildOfflineSummaryBlocks === 'function') {
            var aps = global.MiyaAppointmentStore;
            if (aps && aps.exportForMemory) {
                var offSum = apMem.buildOfflineSummaryBlocks(aps.exportForMemory(apiChatId, contact.id));
                offSumText = apMem.buildSummaryBlocksText ? apMem.buildSummaryBlocksText(offSum) : '';
            }
        }
        var hasOfflineMirror = (sliceAppend || []).some(function (m) {
            return m && m.offlineMeet;
        });
        /*
         * 备用注入：镜像因 chatMirrorId 失效 / 线程迁移 / 落盘冲掉而未进时间线时，
         * 仍从线下 session 拉总结与未总结尾巴，避免「封存了线上却失忆」。
         */
        var offlineCrossSlots = [];
        if (
            !opts.appointmentMode &&
            !opts.callMode &&
            apMem &&
            typeof apMem.buildOnlineCrossMemory === 'function' &&
            (!hasOfflineMirror || !offSumText)
        ) {
            try {
                var crossMem = apMem.buildOnlineCrossMemory(apiChatId, contact, profile, settings);
                var crossSlots = (crossMem && crossMem.slotItems) || [];
                if (!offSumText) {
                    var sumSlots = crossSlots.filter(function (it) {
                        return it && it.kind === 'summary' && String(it.content || '').trim();
                    });
                    if (sumSlots.length) {
                        offSumText = sumSlots
                            .map(function (it) {
                                return String(it.content || '').trim();
                            })
                            .join('\n\n');
                    }
                }
                if (!hasOfflineMirror) {
                    offlineCrossSlots = crossSlots.filter(function (it) {
                        return it && it.kind === 'message' && String(it.content || '').trim();
                    });
                }
            } catch (eCross) {}
        }
        if (
            !opts.appointmentMode &&
            !opts.callMode &&
            apMem &&
            typeof apMem.buildMemoryInteropPreambleBlock === 'function' &&
            (offSumText || hasOfflineMirror || offlineCrossSlots.length || returnPrompt)
        ) {
            apiMessages.push({ role: 'system', content: apMem.buildMemoryInteropPreambleBlock() });
        }
        if (returnPrompt) {
            apiMessages.push({ role: 'system', content: returnPrompt });
            delete pendingOnlineReturnPromptByChat[apiChatId];
            delete pendingOnlineReturnPromptByChat[chatId];
        }
        if (offSumText) {
            apiMessages.push({ role: 'system', content: offSumText });
        }
        if (
            offlineCrossSlots.length &&
            apMem &&
            typeof apMem.injectCrossMemoryToApiMessages === 'function'
        ) {
            apMem.injectCrossMemoryToApiMessages(apiMessages, offlineCrossSlots, '线下');
        }
        appendHistoryToApiMessages(apiMessages, sliceAppend, settings);
        if (!opts.callMode && !opts.appointmentMode) {
            attachTrailingRoundPhotosToApiMessages(apiMessages, sliceAppend);
        }
        var historyTailState = getTrailingSpeakerState(sliceAppend);
        /*
         * 主动/离线的 systemLead 必须紧挨历史之后：先看见带时间戳的对话，再读触发说明。
         * 原先 unshift 到最前会抢注意力，模型容易忽视上下文、只盯时间空话。
         */
        if (opts.systemLead) {
            apiMessages.push({ role: 'system', content: String(opts.systemLead) });
        }
        /* 末条续写块按本轮实际注入历史判断；有 systemLead 时也要加，避免预生成 lead 与历史脱节 */
        var postHistBlock = buildPostHistoryContinuationBlock(sliceAppend, opts);
        if (postHistBlock) {
            apiMessages.push({ role: 'system', content: postHistBlock });
        }

        var fmtXfer = getOnlineFormatApi();
        if (
            fmtXfer &&
            typeof fmtXfer.collectPendingUserTransfersInRound === 'function' &&
            typeof fmtXfer.buildTransferUserRespondBlock === 'function' &&
            !opts.isAutoPush &&
            !opts.isOffline &&
            !opts.isMomentsAuto
        ) {
            var pendingUserXfer = fmtXfer.collectPendingUserTransfersInRound(sliceAppend);
            if (pendingUserXfer.length) {
                var xferBlock = fmtXfer.buildTransferUserRespondBlock(
                    pendingUserXfer,
                    (contact && contact.name) || '角色'
                );
                if (xferBlock) {
                    apiMessages.push({ role: 'system', content: xferBlock });
                }
            }
        }

        var cpBridge = global.miyaCoupleBridge;
        if (
            cpBridge &&
            typeof cpBridge.collectPendingCoupleInvitesInRound === 'function' &&
            typeof cpBridge.buildCoupleInviteRespondBlock === 'function' &&
            !opts.isAutoPush &&
            !opts.isOffline &&
            !opts.isMomentsAuto
        ) {
            var pendingCoupleInv = cpBridge.collectPendingCoupleInvitesInRound(sliceAppend);
            if (pendingCoupleInv.length) {
                var coupleBlock = cpBridge.buildCoupleInviteRespondBlock(
                    pendingCoupleInv,
                    (contact && contact.name) || '角色'
                );
                if (coupleBlock) {
                    apiMessages.push({ role: 'system', content: coupleBlock });
                }
            }
        }

        if (
            cpBridge &&
            typeof cpBridge.buildCoupleCommemorationBlock === 'function' &&
            !opts.isAutoPush &&
            !opts.isOffline &&
            !opts.isMomentsAuto &&
            !opts.callMode &&
            contact &&
            contact.id
        ) {
            var commBlock = cpBridge.buildCoupleCommemorationBlock(contact);
            if (commBlock) {
                apiMessages.push({ role: 'system', content: commBlock });
            }
        }

        if (
            opts.lovePoemMode &&
            String(opts.lovePoemStyle || '').trim() &&
            !opts.isAutoPush &&
            !opts.isOffline &&
            !opts.isMomentsAuto &&
            !opts.callMode
        ) {
            var poemUi = global.MiyaChatLovePoem;
            var poemBlock =
                poemUi && typeof poemUi.buildLovePoemInjectBlock === 'function'
                    ? poemUi.buildLovePoemInjectBlock({
                          style: opts.lovePoemStyle,
                          roleName: (contact && contact.name) || '角色'
                      })
                    : '';
            if (poemBlock) {
                apiMessages.push({ role: 'system', content: poemBlock });
            }
        }

        buildPerTurnOnlineInjectBlocks(chat, contact, settings, {
            callMode: !!opts.callMode,
            appointmentMode: !!opts.appointmentMode,
            isOffline: !!opts.isOffline,
            isAutoPush: !!opts.isAutoPush,
            isLifeLike: !!opts.isLifeLike,
            isRegenerate: !!opts.isRegenerate,
            htmlMode: !!htmlMode,
            history: sliceAppend
        }).forEach(function (block) {
            apiMessages.push({ role: 'system', content: block });
        });

        var last = apiMessages[apiMessages.length - 1];
        var extra = String(userText || '').trim();
        if (extra) {
            if (last && last.role === 'user') {
                last.content = last.content ? last.content + USER_MSG_JOIN + extra : extra;
            } else {
                apiMessages.push({ role: 'user', content: extra });
            }
        }

        if (opts.callMode) {
            apiMessages.push({
                role: 'system',
                content:
                    '【通话态·强制提醒】你正在与用户进行实时' +
                    (opts.callKind === 'video' ? '视频' : '语音') +
                    '通话；绝不是线上文字聊天。请只输出通话口语对白。'
            });
            if (
                global.MiyaChatCalls &&
                typeof global.MiyaChatCalls.buildActiveTranscriptSystemBlock === 'function'
            ) {
                var callTb = global.MiyaChatCalls.buildActiveTranscriptSystemBlock(opts.callId);
                if (callTb) apiMessages.push({ role: 'system', content: callTb });
            }
        }
        if (opts.callMode && opts.cameraFrameDataUrl) {
            apiMessages.push({
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: '这是我当前视频画面，请结合画面与对话继续视频通话。'
                    },
                    { type: 'image_url', image_url: { url: String(opts.cameraFrameDataUrl) } }
                ]
            });
        } else if (opts.callMode && opts.cameraVisionNote) {
            apiMessages.push({
                role: 'system',
                content: '【用户摄像头画面】\n' + String(opts.cameraVisionNote).trim()
            });
        } else if (opts.callMode && opts.cameraOff) {
            apiMessages.push({
                role: 'system',
                content:
                    '【用户摄像头状态】用户已关闭摄像头。你当前看不到任何画面，禁止描述、猜测或编造用户外貌、表情、动作、穿着、环境等视觉内容；只根据语音/文字对白继续通话。'
            });
        }

        if (opts.callMode && opts.skipUserMessage && !extra && historyTailState === 'assistant_spoke_last') {
            apiMessages.push({
                role: 'user',
                content:
                    '（通话中：请用口语继续，每行一句对白，1–15 行由你根据人设与情境自行决定，遵守通话格式规则）'
            });
        }

        if (!opts.isAutoPush && !opts.isOffline && !opts.isMomentsAuto && !opts.isLifeLike) {
            appendManualActionTailNudge(apiMessages, opts, historyTailState, !!extra);
        }
        if (opts.isMomentsAuto) {
            var momentsLines = [
                '【强制任务·仅发朋友圈】',
                '忽略上文所有聊天气泡、<thinking>、<miyavoice>、旁白等格式要求。',
                '你必须只输出恰好一行：【发朋友圈：正文|配图1：图片描述】',
                '禁止输出任何其它文字。'
            ];
            var trMoments = global.MiyaChatTranslate;
            if (
                trMoments &&
                settings &&
                settings.autoTranslate &&
                settings.momentsTranslate &&
                isSemanticAutoTranslate(settings) &&
                typeof trMoments.buildMomentsAutoSemanticInject === 'function'
            ) {
                momentsLines.splice(
                    3,
                    0,
                    trMoments.buildMomentsAutoSemanticInject(getTranslateTargetFromSettings(settings))
                );
            }
            apiMessages.push({
                role: 'system',
                content: momentsLines.join('\n')
            });
        } else if (opts.isAutoPush || opts.isOffline || opts.isLifeLike) {
            var tail = apiMessages[apiMessages.length - 1];
            if (!tail || tail.role !== 'user') {
                var proactiveTail;
                if (historyTailState === 'assistant_spoke_last') {
                    proactiveTail = buildAssistantContinueTailNudge({ isLifeLike: !!opts.isLifeLike });
                } else if (historyTailState === 'user_spoke_last') {
                    var llTailUser = global.MiyaChatLifeLike;
                    var nextPushTailUser =
                        opts.isLifeLike && llTailUser && llTailUser.TAG_OPEN && llTailUser.TAG_CLOSE
                            ? '；全文最末必须另起一行输出 ' +
                              llTailUser.TAG_OPEN +
                              'YYYY-MM-DD HH:mm' +
                              llTailUser.TAG_CLOSE
                            : '';
                    var fmtPin = getOnlineFormatApi();
                    var pinRound =
                        fmtPin && typeof fmtPin.formatUserRoundLinesForRegenerate === 'function'
                            ? String(
                                  fmtPin.formatUserRoundLinesForRegenerate(sliceAppend, settings) || ''
                              ).trim()
                            : '';
                    if (pinRound) {
                        proactiveTail =
                            '（【末尾用户侧·纳入衔接】\n' +
                            pinRound +
                            '\n顺着上文末尾几条（含以上）自然发微信，兼顾时间间隔；禁止假装未见或抱怨没回；禁止抛开末尾接旧话题；' +
                            ONLINE_THREE_PART_TAIL +
                            nextPushTailUser +
                            '）';
                    } else {
                        proactiveTail =
                            '（主动轮：自然衔接上文末尾几条并兼顾时间；末条是用户时勿假装未见；禁止抱怨没回；' +
                            ONLINE_THREE_PART_TAIL +
                            nextPushTailUser +
                            '）';
                    }
                } else {
                    proactiveTail = buildOnlineProactiveTailNudge();
                }
                apiMessages.push({ role: 'user', content: proactiveTail });
            }
        }

        if (!opts.callMode && !opts.appointmentMode) {
            appendWorldbookBackMessages(apiMessages, wbBundle.backLayers);
        }
        appendChronicleBeforeOperationRulesMessage(apiMessages, contact, opts);
        if (
            historyTailState === 'assistant_spoke_last' &&
            !opts.callMode &&
            !opts.appointmentMode &&
            !opts.isMomentsAuto &&
            !opts.isRegenerate
        ) {
            apiMessages.push({
                role: 'system',
                content:
                    opts.isAutoPush || opts.isOffline || opts.isLifeLike
                        ? '【生成前最后确认】主动轮且末条是你方：自然衔接上文末尾几条并兼顾时间间隔；禁止把用户上一轮当必答；禁止催回/抱怨没回；勿复读上轮相似内容。'
                        : '【生成前最后确认】上下文末条是你方发言、用户尚未回复：禁止重答用户旧话或复读上轮相似内容；须从你方最近一条自然续写。'
            });
        } else if (
            historyTailState === 'user_spoke_last' &&
            (opts.isAutoPush || opts.isOffline || opts.isLifeLike) &&
            !opts.callMode &&
            !opts.appointmentMode
        ) {
            var fmtFinal = getOnlineFormatApi();
            var finalPin =
                fmtFinal && typeof fmtFinal.formatUserRoundLinesForRegenerate === 'function'
                    ? String(fmtFinal.formatUserRoundLinesForRegenerate(sliceAppend, settings) || '').trim()
                    : '';
            if (finalPin) {
                apiMessages.push({
                    role: 'system',
                    content:
                        '【生成前最后确认·末尾衔接】时间线末尾用户侧原文：\n' +
                        finalPin +
                        '\n须把以上纳入自然衔接（兼顾时间间隔）；禁止假装未见、禁止抱怨没回、禁止抛开末尾接旧话题。'
                });
            } else {
                apiMessages.push({
                    role: 'system',
                    content:
                        '【生成前最后确认】主动轮且末条是用户：自然衔接上文末尾几条并兼顾时间；勿假装未见，勿抱怨没回，勿接旧话题。'
                });
            }
        }
        appendOnlineThinkingRulesMessage(
            apiMessages,
            contact,
            profile,
            Object.assign({}, opts, { chatSettings: settings })
        );
        appendOnlineOperationRulesMessage(
            apiMessages,
            contact,
            profile,
            Object.assign({}, opts, { chatSettings: settings })
        );

        return {
            messages: apiMessages,
            contact: contact,
            profile: profile,
            chat: chat,
            latestHumanRole: sliceAppend.length ? sliceAppend[sliceAppend.length - 1].role : '',
            htmlMode: !!htmlMode,
            promptMeta: buildPromptMeta(apiMessages, wbBundle.meta),
            worldbookMeta: wbBundle.meta
        };
    }

    function normalizeMessageContent(content) {
        if (content == null) return '';
        if (typeof content === 'string') return content.trim();
        if (Array.isArray(content)) {
            var parts = [];
            content.forEach(function (part) {
                if (part == null) return;
                if (typeof part === 'string') {
                    if (part.trim()) parts.push(part.trim());
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
                    if (t != null && String(t).trim()) parts.push(String(t).trim());
                }
            });
            return parts.join('\n').trim();
        }
        var s = String(content).trim();
        return s === '[object Object]' ? '' : s;
    }

    function extractReplyContent(data) {
        if (!data) return '';
        if (data.error && typeof data.error === 'object') return '';

        function pickFromChoice(ch) {
            if (!ch) return '';
            var body = '';
            var msg = ch.message;
            if (msg && typeof msg === 'object') {
                var main = normalizeMessageContent(msg.content);
                if (main) return main;
                if (msg.refusal != null) {
                    body = normalizeMessageContent(msg.refusal);
                    if (body) return body;
                }
                return '';
            }
            if (ch.delta && ch.delta.content != null) {
                body = normalizeMessageContent(ch.delta.content);
                if (body) return body;
            }
            if (ch.text != null) {
                body = normalizeMessageContent(ch.text);
                if (body) return body;
            }
            return '';
        }

        var choices = data.choices;
        if (Array.isArray(choices)) {
            var i;
            for (i = 0; i < choices.length; i++) {
                var picked = pickFromChoice(choices[i]);
                if (picked) return picked;
            }
        }

        var top =
            data.output != null
                ? data.output
                : data.content != null
                  ? data.content
                  : data.result != null
                    ? data.result
                    : data.response != null
                      ? data.response
                      : data.text != null
                        ? data.text
                        : null;
        if (top != null) {
            var normalized = normalizeMessageContent(top);
            if (normalized) return normalized;
        }
        if (data.message && typeof data.message === 'object') {
            var msgBody = normalizeMessageContent(data.message.content);
            if (msgBody) return msgBody;
        }
        return '';
    }

    function buildSalvageBubbleText(replyRaw) {
        var s = stripHeartVoiceTags(stripThinkingBlocks(String(replyRaw || ''))).trim();
        if (s) return s;
        var bare = String(replyRaw || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return bare.slice(0, 2000);
    }

    var CHAT_COMPLETION_MAX_ATTEMPTS = 3;

    function resolveChatApiSlice(cfg, useSecondary) {
        if (useSecondary) {
            var sec = cfg.secondaryApi && typeof cfg.secondaryApi === 'object' ? cfg.secondaryApi : {};
            return {
                baseUrl: normalizeBaseUrl(sec.baseUrl),
                apiKey: String(sec.apiKey || '').trim(),
                model: String(sec.model || '').trim(),
                temperature: sec.temperature != null ? Number(sec.temperature) : (cfg.temperature != null ? Number(cfg.temperature) : 1)
            };
        }
        return {
            baseUrl: normalizeBaseUrl(cfg.baseUrl),
            apiKey: String(cfg.apiKey || '').trim(),
            model: String(cfg.model || '').trim(),
            temperature: cfg.temperature != null ? Number(cfg.temperature) : 1
        };
    }

    function hasSecondaryApiConfigured(cfg) {
        var sec = cfg.secondaryApi && typeof cfg.secondaryApi === 'object' ? cfg.secondaryApi : {};
        return !!(normalizeBaseUrl(sec.baseUrl) && String(sec.apiKey || '').trim() && String(sec.model || '').trim());
    }

    function fetchChatCompletion(url, headers, payload, attempt) {
        var tryNo = Math.max(1, Number(attempt) || 1);
        return fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        })
            .then(function (r) {
                if (!r.ok) {
                    return r.text().then(function (t) {
                        throw new Error('HTTP ' + r.status + (t ? ': ' + t.slice(0, 200) : ''));
                    });
                }
                return r.json();
            })
            .then(function (data) {
                var replyRaw = extractReplyContent(data);
                if (!replyRaw && tryNo < CHAT_COMPLETION_MAX_ATTEMPTS) {
                    return fetchChatCompletion(url, headers, payload, tryNo + 1);
                }
                return { data: data, replyRaw: replyRaw };
            });
    }

    function extractBodyForBubbles(rawText) {
        var raw = String(rawText || '');
        var hvIdx = raw.search(/<miyavoice\b|＜miyavoice|<heartvoice\b|＜heartvoice/i);
        if (hvIdx >= 0) raw = raw.slice(0, hvIdx);
        if (findLastThinkingCloseEnd(raw) >= 0) {
            raw = extractBodyAfterThinkingClose(raw);
        } else {
            raw = stripThinkingBlocks(raw);
        }
        raw = stripHeartVoiceTags(raw);
        if (global.MiyaChatLifeLike && typeof global.MiyaChatLifeLike.stripNextPushTags === 'function') {
            raw = global.MiyaChatLifeLike.stripNextPushTags(raw);
        }
        raw = stripStructuralMarkerLines(raw);
        return raw.trim();
    }

    function splitBubbles(text) {
        var raw = stripStructuralMarkerLines(stripHeartVoiceTags(stripThinkingBlocks(String(text || '')))).trim();
        if (!raw) return [];

        if (raw.indexOf('|||') >= 0) {
            return raw
                .split('|||')
                .map(function (s) {
                    return s.trim();
                })
                .filter(Boolean);
        }

        var lines = raw
            .split(/\n/)
            .map(function (s) {
                return s.trim();
            })
            .filter(Boolean);
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.splitCollapsedTimelineSegments === 'function') {
            var expanded = [];
            lines.forEach(function (line) {
                var segs = aw.splitCollapsedTimelineSegments(line);
                if (segs.length > 1) {
                    segs.forEach(function (s) {
                        if (s) expanded.push(s);
                    });
                } else {
                    expanded.push(segs[0] || line);
                }
            });
            lines = expanded.filter(Boolean);
        }
        if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
            lines = lines.map(function (line) {
                return aw.stripTimelinePrefixForDisplay(line);
            }).filter(Boolean);
        }
        var fmtSplit = getOnlineFormatApi();
        if (fmtSplit && typeof fmtSplit.splitCollapsedOnlineTypeLines === 'function') {
            var expanded = [];
            lines.forEach(function (line) {
                var parts = fmtSplit.splitCollapsedOnlineTypeLines(line);
                if (parts.length > 1) parts.forEach(function (p) { if (p) expanded.push(p); });
                else expanded.push(parts[0] || line);
            });
            lines = expanded.filter(Boolean);
        }
        if (fmtSplit && typeof fmtSplit.sanitizeRoleOutputLines === 'function') {
            lines = fmtSplit.sanitizeRoleOutputLines(lines);
        }
        if (fmtSplit && typeof fmtSplit.filterStructuralLeakLines === 'function') {
            lines = fmtSplit.filterStructuralLeakLines(lines);
        }
        if (fmtSplit && typeof fmtSplit.collapseDuplicateBubbleLines === 'function') {
            lines = fmtSplit.collapseDuplicateBubbleLines(lines);
        }
        if (lines.length > 1) return lines;
        if (lines.length === 1) return lines;
        return [];
    }

    function photoNeedsVision(m) {
        if (!m || m.deleted || m.role !== 'user') return false;
        var fmt = getOnlineFormatApi();
        if (fmt && typeof fmt.isRealChatPhotoMessage === 'function') {
            if (!fmt.isRealChatPhotoMessage(m)) return false;
        } else if (m.type !== 'image' || !m.imageDataKey || m.imageKind === 'text') {
            return false;
        }
        return !String(m.imageVisionText || '').trim();
    }

    var roundPhotoDataUrlCache = Object.create(null);
    var ROUND_PHOTO_BATCH_MAX = 5;

    function resolveMessageBucket(st, chatId, msg) {
        if (
            st &&
            st.findMessageChatId &&
            typeof st.findMessageChatId === 'function' &&
            msg &&
            msg.id
        ) {
            return st.findMessageChatId(msg.id) || chatId;
        }
        return chatId;
    }

    function loadChatPhotoDataUrl(st, imgApi, blobId) {
        var key = String(blobId || '').trim();
        if (!key || !st || typeof st.getAvatarUrl !== 'function') return Promise.resolve('');
        return st
            .getAvatarUrl(key)
            .then(function (url) {
                if (!url) return '';
                return fetch(url).then(function (res) {
                    if (!res.ok) return '';
                    return res.blob();
                });
            })
            .then(function (blob) {
                if (!blob) return '';
                if (imgApi && typeof imgApi.readBlobAsDataUrl === 'function') {
                    return imgApi.readBlobAsDataUrl(blob);
                }
                return '';
            })
            .catch(function () {
                return '';
            });
    }

    function applyRoundPhotoVisionText(st, chatId, row, desc) {
        var text = String(desc || '').trim();
        if (!text || !st || !row || !row.m) return Promise.resolve(null);
        return st
            .updateMessage(resolveMessageBucket(st, chatId, row.m), row.m.id, { imageVisionText: text })
            .catch(function () {
                return null;
            });
    }

    function recognizeRoundPhotoBatch(st, chatId, imgApi, batch) {
        if (!batch.length) return Promise.resolve();
        var urls = batch.map(function (row) {
            return row.dataUrl;
        });
        function recognizeSequential() {
            var chain = Promise.resolve();
            batch.forEach(function (row) {
                chain = chain.then(function () {
                    return imgApi
                        .recognizeImageDataUrl(row.dataUrl)
                        .then(function (desc) {
                            return applyRoundPhotoVisionText(st, chatId, row, desc);
                        })
                        .catch(function () {
                            return null;
                        });
                });
            });
            return chain;
        }
        if (batch.length === 1 || typeof imgApi.recognizeImageBatchDataUrls !== 'function') {
            return recognizeSequential();
        }
        return imgApi
            .recognizeImageBatchDataUrls(urls)
            .then(function (descs) {
                return Promise.all(
                    batch.map(function (row, idx) {
                        return applyRoundPhotoVisionText(st, chatId, row, descs && descs[idx]);
                    })
                );
            })
            .catch(function () {
                return recognizeSequential();
            });
    }

    /** 触发 AI 回复前：识别本轮尚未识图的真实图片，写入 imageVisionText，并缓存 dataUrl 供主模型多模态看图 */
    function recognizeRoundPhotos(chatId) {
        var st = global.miyaChatStore;
        var imgApi = global.MiyaChatImage;
        if (!st || !imgApi || typeof imgApi.recognizeImageDataUrl !== 'function') {
            return Promise.resolve();
        }
        var fmt = getOnlineFormatApi();
        var isRealPhoto =
            fmt && typeof fmt.isRealChatPhotoMessage === 'function'
                ? fmt.isRealChatPhotoMessage
                : function (m) {
                      return !!(m && m.type === 'image' && m.imageDataKey && m.imageKind !== 'text');
                  };
        var round = getTrailingUserRound(loadApiHistory(st, chatId));
        var photos = round.filter(isRealPhoto);
        if (!photos.length) return Promise.resolve();
        photos.forEach(function (m) {
            if (m && m.id) delete roundPhotoDataUrlCache[m.id];
        });
        return Promise.all(
            photos.map(function (m) {
                return loadChatPhotoDataUrl(st, imgApi, m.imageDataKey).then(function (dataUrl) {
                    if (dataUrl && m.id) roundPhotoDataUrlCache[m.id] = dataUrl;
                    return { m: m, dataUrl: dataUrl };
                });
            })
        ).then(function (rows) {
            var pending = rows.filter(function (row) {
                return photoNeedsVision(row.m) && row.dataUrl;
            });
            if (!pending.length) return;
            var chain = Promise.resolve();
            for (var i = 0; i < pending.length; i += ROUND_PHOTO_BATCH_MAX) {
                (function (batch) {
                    chain = chain.then(function () {
                        return recognizeRoundPhotoBatch(st, chatId, imgApi, batch);
                    });
                })(pending.slice(i, i + ROUND_PHOTO_BATCH_MAX));
            }
            return chain;
        });
    }

    function attachTrailingRoundPhotosToApiMessages(apiMessages, history) {
        if (!Array.isArray(apiMessages) || !apiMessages.length) return;
        var fmt = getOnlineFormatApi();
        if (!fmt || typeof fmt.isRealChatPhotoMessage !== 'function') return;
        var round = getTrailingUserRound(history);
        var photos = round.filter(fmt.isRealChatPhotoMessage);
        if (!photos.length) return;
        var imageParts = [];
        photos.forEach(function (m) {
            var url = m && m.id ? roundPhotoDataUrlCache[m.id] : '';
            if (url && /^data:image\//i.test(url)) {
                imageParts.push({ type: 'image_url', image_url: { url: url } });
            }
        });
        if (!imageParts.length) return;
        var lastUserIdx = -1;
        var i;
        for (i = apiMessages.length - 1; i >= 0; i--) {
            if (apiMessages[i] && apiMessages[i].role === 'user') {
                lastUserIdx = i;
                break;
            }
        }
        if (lastUserIdx < 0) {
            apiMessages.push({
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: '（用户本轮发送了真实图片，请结合画面与对话理解后再回复）'
                    }
                ].concat(imageParts)
            });
            return;
        }
        var last = apiMessages[lastUserIdx];
        if (Array.isArray(last.content)) {
            last.content = last.content.concat(imageParts);
            return;
        }
        var textPart = String(last.content || '').trim();
        if (!textPart) {
            textPart = '（用户本轮发送了真实图片，请结合画面与对话理解后再回复）';
        }
        last.content = [{ type: 'text', text: textPart }].concat(imageParts);
    }

    /** 本轮 = 自最后一条角色消息（含角色旁白）之后连续的用户消息 */
    function getTrailingUserRound(messages) {
        var list = (messages || []).filter(function (m) {
            return m && !m.deleted;
        });
        var round = [];
        for (var i = list.length - 1; i >= 0; i--) {
            var row = list[i];
            if (row.role === 'assistant') break;
            if (isOnlineNarrationRow(row)) break;
            if (row.role === 'user') round.unshift(row);
        }
        return round;
    }

    function isOnlineNarrationRow(m) {
        var fmt = getOnlineFormatApi();
        return !!(
            fmt &&
            typeof fmt.isCharacterOnlineNarrationMessage === 'function' &&
            fmt.isCharacterOnlineNarrationMessage(m)
        );
    }

    /** 末尾一轮角色回复（含穿插的线上旁白 system 行） */
    function getTrailingAssistantRound(messages) {
        var list = (messages || []).filter(function (m) {
            return m && !m.deleted;
        });
        if (!list.length) return [];
        var batchId = '';
        var i;
        for (i = list.length - 1; i >= 0; i--) {
            var tail = list[i];
            if (tail.role === 'assistant') {
                batchId = String(tail.replyBatchId || '').trim();
                break;
            }
            if (!isOnlineNarrationRow(tail)) break;
        }
        if (batchId) {
            var byBatch = list.filter(function (m) {
                return (
                    String(m.replyBatchId || '') === batchId &&
                    (m.role === 'assistant' || isOnlineNarrationRow(m))
                );
            });
            if (byBatch.length) return byBatch;
        }
        var firstIdx = -1;
        var lastIdx = -1;
        for (i = list.length - 1; i >= 0; i--) {
            var row = list[i];
            if (row.role === 'assistant' || isOnlineNarrationRow(row)) {
                lastIdx = i;
                break;
            }
            if (row.role !== 'assistant' && !isOnlineNarrationRow(row)) break;
        }
        if (lastIdx < 0) return [];
        for (i = lastIdx; i >= 0; i--) {
            var prev = list[i];
            if (prev.role === 'assistant' || isOnlineNarrationRow(prev)) firstIdx = i;
            else break;
        }
        if (firstIdx < 0) return [];
        var round = [];
        for (i = firstIdx; i <= lastIdx; i++) {
            var mid = list[i];
            if (mid.role === 'assistant' || isOnlineNarrationRow(mid)) round.push(mid);
        }
        return round;
    }

    function collectTrailingReplyRoundIds(messages) {
        return getTrailingAssistantRound(messages)
            .map(function (m) {
                return m && m.id;
            })
            .filter(Boolean);
    }

    /** 与末尾角色回复对应的本轮用户消息（紧邻其前的连续 user） */
    function getUserRoundBeforeAssistant(messages, assistantRound) {
        var asst = Array.isArray(assistantRound) ? assistantRound : [];
        if (!asst.length) return getTrailingUserRound(messages);
        var list = (messages || []).filter(function (m) {
            return m && !m.deleted;
        });
        var firstId = String((asst[0] && asst[0].id) || '');
        var firstIdx = -1;
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === firstId) {
                firstIdx = i;
                break;
            }
        }
        if (firstIdx < 0) return getTrailingUserRound(messages);
        var userRound = [];
        for (var j = firstIdx - 1; j >= 0; j--) {
            if (list[j].role === 'assistant') break;
            if (isOnlineNarrationRow(list[j])) break;
            if (list[j].role === 'user') userRound.unshift(list[j]);
        }
        return userRound;
    }

    function sanitizeAssistantPayload(fields) {
        var payload = Object.assign({}, fields || {});
        if (payload.content) payload.content = stripThinkingForApi(payload.content);
        if (payload.voiceText) payload.voiceText = stripThinkingForApi(payload.voiceText);
        if (payload.callLine) payload.callLine = stripThinkingForApi(payload.callLine);
        return payload;
    }

    function loadApiHistory(st, chatId) {
        if (!st || !chatId) return [];
        if (st.getMergedMessagesForApi && typeof st.getMergedMessagesForApi === 'function') {
            return st.getMergedMessagesForApi(chatId) || [];
        }
        return st.getMessages(resolveApiChatId(chatId)) || [];
    }

    function withdrawLastAssistantRound(chatId) {
        var st = global.miyaChatStore;
        if (!st) return Promise.reject(new Error('store_missing'));
        var cid = String(chatId || '').trim();
        if (!cid) return Promise.reject(new Error('invalid_chat'));
        var msgChatId = resolveApiChatId(cid);
        var msgs = loadApiHistory(st, cid);
        var ids = collectTrailingReplyRoundIds(msgs);
        if (!ids.length) return Promise.reject(new Error('no_assistant_round'));
        var byBucket = Object.create(null);
        ids.forEach(function (id) {
            var bucket =
                st.findMessageChatId && typeof st.findMessageChatId === 'function'
                    ? st.findMessageChatId(id)
                    : '';
            if (!bucket) bucket = msgChatId;
            if (!byBucket[bucket]) byBucket[bucket] = [];
            byBucket[bucket].push(id);
        });
        var chain = Promise.resolve(0);
        Object.keys(byBucket).forEach(function (bucket) {
            chain = chain.then(function () {
                return st.deleteMessages(bucket, byBucket[bucket]);
            });
        });
        return chain.then(function () {
            var patch = {
                activeThinking: '',
                activeThinkingMsgId: '',
                lastRawAssistantReply: '',
                lastHeartVoiceParse: null
            };
            var updateChain = st.updateChat(msgChatId, patch);
            if (msgChatId !== cid) {
                updateChain = updateChain.then(function () {
                    return st.updateChat(cid, patch);
                });
            }
            return updateChain.then(function () {
                return { removed: ids.length, ids: ids, msgChatId: msgChatId };
            });
        });
    }

    function regenerateLastRound(chatId) {
        var cid = String(chatId || '').trim();
        if (!cid) return Promise.reject(new Error('invalid_chat'));
        if (isChatApiBusy(cid)) return Promise.reject(new Error('chat_api_busy'));
        return withdrawLastAssistantRound(cid).then(function () {
            return sendChat(cid, '', { skipUserMessage: true, isRegenerate: true });
        });
    }

    var replyInFlight = Object.create(null);

    function acquireChatApi(chatId) {
        var id = String(chatId || '');
        if (!id) return false;
        replyInFlight[id] = (replyInFlight[id] || 0) + 1;
        return true;
    }

    function releaseChatApi(chatId) {
        var id = String(chatId || '');
        if (!id || !replyInFlight[id]) return;
        replyInFlight[id] -= 1;
        if (replyInFlight[id] <= 0) delete replyInFlight[id];
    }

    function isChatApiBusy(chatId) {
        return !!(chatId && replyInFlight[String(chatId)]);
    }

    function isReplyInFlight(chatId) {
        return isChatApiBusy(chatId);
    }

    function buildLocalTokenUsage(built, replyRaw) {
        var pm = (built && built.promptMeta) || {};
        var promptChars = countMessagesChars(built && built.messages);
        if (!promptChars && pm.total_prompt_chars) {
            promptChars = Math.max(0, Math.floor(Number(pm.total_prompt_chars) || 0));
        }
        var completionChars = String(replyRaw || '').length;
        var totalChars = promptChars + completionChars;
        return {
            prompt_chars: promptChars,
            completion_chars: completionChars,
            total_chars: totalChars,
            prompt_tokens: promptChars,
            completion_tokens: completionChars,
            total_tokens: totalChars,
            updatedAt: Date.now(),
            source: 'local_chars'
        };
    }

    function sendChat(chatId, userText, opts) {
        var store = global.miyaChatStore;
        var options = opts && typeof opts === 'object' ? opts : {};
        var text = String(userText || '').trim();
        if (!text && !options.skipUserMessage) return Promise.reject(new Error('empty_message'));

        if (isChatApiBusy(chatId)) return Promise.reject(new Error('chat_api_busy'));

        acquireChatApi(chatId);

        var cfg = getApiConfig();
        var baseUrl = normalizeBaseUrl(cfg.baseUrl);
        var apiKey = String(cfg.apiKey || '').trim();
        var model = String(cfg.model || '').trim();
        if (!baseUrl || !apiKey || !model) {
            releaseChatApi(chatId);
            return Promise.reject(new Error('api_not_configured'));
        }

        var persistUser = options.skipUserMessage
            ? Promise.resolve()
            : store.addMessage(chatId, { role: 'user', content: text });

        function clearInFlight() {
            releaseChatApi(chatId);
        }

        function maybeRefreshWeatherBeforeChat() {
            var aw = global.MiyaChatAwareness;
            if (!store || !aw || typeof aw.refreshWeatherIfStale !== 'function') return Promise.resolve();
            var chatRow = store.findChat ? store.findChat(chatId) : null;
            if (
                chatRow &&
                chatRow.type === 'group' &&
                typeof aw.refreshGroupMembersWeatherIfStale === 'function'
            ) {
                return aw.refreshGroupMembersWeatherIfStale(store, chatRow);
            }
            var settings = store.getChatSettings ? store.getChatSettings(chatId) : null;
            var wa =
                aw.normalizeWeatherAwareness && settings
                    ? aw.normalizeWeatherAwareness(settings.weatherAwareness)
                    : null;
            if (!wa || !wa.enabled) return Promise.resolve();
            var stale =
                (typeof aw.needsWeatherDailyRefresh === 'function' && aw.needsWeatherDailyRefresh(wa)) ||
                (typeof aw.weatherNeedsInitialFetch === 'function' && aw.weatherNeedsInitialFetch(wa)) ||
                (typeof aw.weatherDataIncomplete === 'function' && aw.weatherDataIncomplete(wa));
            if (!stale) return Promise.resolve();
            return aw
                .refreshWeatherIfStale(Object.assign({}, settings, { weatherAwareness: wa }), { force: true })
                .then(function (refreshed) {
                    if (refreshed && refreshed.weatherAwareness && store.saveChatSettings) {
                        return store.saveChatSettings(chatId, { weatherAwareness: refreshed.weatherAwareness });
                    }
                })
                .catch(function () {});
        }

        return persistUser
            .then(function () {
                var peek = global.miyaDiaryPeek;
                if (
                    peek &&
                    typeof peek.tryTriggerPeek === 'function' &&
                    !options.skipPeek &&
                    !options.isRegenerate &&
                    !options.callMode
                ) {
                    return peek.tryTriggerPeek(chatId);
                }
            })
            .then(function () {
                return recognizeRoundPhotos(chatId);
            })
            .then(function () {
                return maybeRefreshWeatherBeforeChat();
            })
            .then(function () {
                return ensureWorldbookDepsReady();
            })
            .then(function () {
                if (typeof global.miyaYieldToMain === 'function') {
                    return global.miyaYieldToMain();
                }
            })
            .then(function () {
            var built = buildApiMessages(chatId, '', options);
            if (built.error) return Promise.reject(new Error(built.error));

            function callWithSlice(slice, usedSecondary) {
                if (!slice.baseUrl || !slice.apiKey || !slice.model) {
                    return Promise.reject(new Error(usedSecondary ? 'secondary_api_not_configured' : 'api_not_configured'));
                }
                var url = slice.baseUrl + '/chat/completions';
                var reqHeaders = {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + slice.apiKey
                };
                var reqPayload = {
                    model: slice.model,
                    messages: built.messages,
                    temperature: slice.temperature
                };
                return fetchChatCompletion(url, reqHeaders, reqPayload, 1).then(function (completion) {
                    if (!completion.replyRaw) throw new Error('empty_reply');
                    completion._usedSecondaryApi = !!usedSecondary;
                    return completion;
                });
            }

            var primarySlice = resolveChatApiSlice(cfg, false);
            return callWithSlice(primarySlice, false).catch(function (err) {
                if (!cfg.fallbackToSecondary || !hasSecondaryApiConfigured(cfg)) throw err;
                return callWithSlice(resolveChatApiSlice(cfg, true), true);
            }).then(function (completion) {
                var data = completion.data;
                var replyRawOriginal = String(completion.replyRaw || '');
                var replyRaw = replyRawOriginal;
                var lifeLikeNextPushPatch = null;
                var llMod = global.MiyaChatLifeLike;
                var chatRowEarly = built.chat || (store.findChat ? store.findChat(chatId) : null);
                if (
                    llMod &&
                    typeof llMod.isEnabled === 'function' &&
                    typeof llMod.extractNextPushFromReply === 'function' &&
                    chatRowEarly &&
                    chatRowEarly.type !== 'group' &&
                    !options.callMode &&
                    !options.isMomentsAuto
                ) {
                    var llSettings = store.getChatSettings ? store.getChatSettings(chatId) : null;
                    if (llMod.isEnabled(llSettings)) {
                        var extractSrc = replyRawOriginal;
                        if (!/miyanextpush/i.test(extractSrc)) {
                            var rsnForPush = extractReasoningFromApi(data);
                            if (rsnForPush && /miyanextpush/i.test(rsnForPush)) {
                                extractSrc = extractSrc ? extractSrc + '\n' + rsnForPush : rsnForPush;
                            }
                        }
                        var npExtract = llMod.extractNextPushFromReply(extractSrc, { settings: llSettings });
                        if (npExtract && npExtract.stripped != null) replyRaw = npExtract.stripped;
                        if (npExtract && npExtract.ok) {
                            lifeLikeNextPushPatch = {
                                backgroundMessage: {
                                    lifeLikeNextPushAt: npExtract.atMs || 0
                                }
                            };
                        } else if (npExtract && npExtract.foundTag) {
                            console.warn(
                                '[MiyaChatLifeLike] 调度块解析失败 chat=' +
                                    chatId +
                                    ' raw=' +
                                    String(npExtract.raw || '').slice(0, 80) +
                                    (npExtract.parseReason ? ' reason=' + npExtract.parseReason : '')
                            );
                        }
                    }
                }

                var thinking = extractThinkingFromResponse(data, replyRaw);
                var parsed = parseThinking(replyRaw);
                var bodyForBubbles = extractBodyForBubbles(replyRaw);
                if (!String(bodyForBubbles || '').trim()) {
                    bodyForBubbles = stripHeartVoiceTags(parsed.content);
                }
                if (!String(bodyForBubbles || '').trim()) {
                    bodyForBubbles = buildSalvageBubbleText(replyRaw);
                }
                if (!String(bodyForBubbles || '').trim() && thinking && !options.callMode) {
                    throw new Error('empty_reply');
                }
                var fmtEarly = getOnlineFormatApi();
                var htmlApi = global.MiyaChatHtml;
                var userWantsHtml = !!(built && built.htmlMode);
                var htmlOnly =
                    userWantsHtml &&
                    htmlApi &&
                    typeof htmlApi.extractHtmlOnlyFromReply === 'function'
                        ? htmlApi.extractHtmlOnlyFromReply(bodyForBubbles)
                        : null;
                var bubbles = splitBubbles(bodyForBubbles);
                var roleMomentsIntent = null;
                if (fmtEarly && typeof fmtEarly.stripRoleMomentsFromLines === 'function') {
                    var momentsStrip = fmtEarly.stripRoleMomentsFromLines(bubbles);
                    bubbles = momentsStrip.lines;
                    roleMomentsIntent = momentsStrip.intent;
                }

                var chain = Promise.resolve([]);
                var firstMsgId = null;
                var lastMsgId = null;

                var fmt = fmtEarly || getOnlineFormatApi();
                var chatRow = store.findChat(chatId);
                var contactRow = chatRow && store.findContact(chatRow.contactId);
                var catalog =
                    fmt && typeof fmt.collectStickerCatalog === 'function'
                        ? fmt.collectStickerCatalog(store, contactRow && contactRow.id)
                        : [];
                var profileId =
                    built.profile && built.profile.id ? built.profile.id : '';
                var updatedTransferMsgIds = [];
                var updatedCoupleInviteMsgIds = [];
                var receiptChain =
                    fmt && typeof fmt.applyRoleTransferReceipts === 'function'
                        ? fmt.applyRoleTransferReceipts(chatId, bubbles, store, profileId)
                        : Promise.resolve([]);

                var pendingRoleCall = null;
                var callApiMeta = null;
                var pendingAvatarSwaps = [];

                return receiptChain
                    .then(function (xferIds) {
                        updatedTransferMsgIds = Array.isArray(xferIds) ? xferIds : [];
                        var cpBridge = global.miyaCoupleBridge;
                        if (
                            cpBridge &&
                            typeof cpBridge.applyRoleCoupleSpaceReceipts === 'function'
                        ) {
                            return cpBridge
                                .applyRoleCoupleSpaceReceipts(chatId, bubbles, store)
                                .then(function (cpIds) {
                                    updatedCoupleInviteMsgIds = Array.isArray(cpIds) ? cpIds : [];
                                    if (typeof cpBridge.applyRoleCoupleCommemorations === 'function') {
                                        return cpBridge
                                            .applyRoleCoupleCommemorations(chatId, bubbles, store)
                                            .then(function () { return xferIds; });
                                    }
                                    return xferIds;
                                });
                        }
                        if (
                            cpBridge &&
                            typeof cpBridge.applyRoleCoupleCommemorations === 'function'
                        ) {
                            return cpBridge
                                .applyRoleCoupleCommemorations(chatId, bubbles, store)
                                .then(function () { return xferIds; });
                        }
                        return xferIds;
                    })
                    .then(function (xferIds) {
                        updatedTransferMsgIds = Array.isArray(xferIds) ? xferIds : [];
                        var displayLines = bubbles;
                        if (fmt && typeof fmt.stripTransferReceiptLines === 'function') {
                            displayLines = fmt.stripTransferReceiptLines(bubbles);
                        }
                        var cpBridgeStrip = global.miyaCoupleBridge;
                        if (
                            cpBridgeStrip &&
                            typeof cpBridgeStrip.stripCoupleSpaceReceiptLines === 'function'
                        ) {
                            displayLines = cpBridgeStrip.stripCoupleSpaceReceiptLines(displayLines);
                        }
                        if (
                            cpBridgeStrip &&
                            typeof cpBridgeStrip.stripCommemorationLines === 'function'
                        ) {
                            displayLines = cpBridgeStrip.stripCommemorationLines(displayLines);
                        }
                        if (fmt && typeof fmt.stripUnknownStickerLines === 'function') {
                            displayLines = fmt.stripUnknownStickerLines(displayLines, catalog);
                        }
                        if (
                            chatRow &&
                            chatRow.type !== 'group' &&
                            contactRow &&
                            displayLines.length
                        ) {
                            displayLines = stripPrivateRolePrefixLines(displayLines, contactRow);
                        }
                        var chatSettingsForNarr =
                            store.getChatSettings && typeof store.getChatSettings === 'function'
                                ? store.getChatSettings(chatId)
                                : null;
                        var narrationOn =
                            !options.callMode &&
                            chatRow &&
                            chatRow.type !== 'group' &&
                            !!(chatSettingsForNarr && chatSettingsForNarr.onlineNarrationEnabled);
                        var narrationInjectCtx =
                            !chatSettingsForNarr || chatSettingsForNarr.onlineNarrationInjectContext !== false;
                        var narrationOps = [];
                        if (fmt && typeof fmt.extractNarrationFromLines === 'function') {
                            var narrParsed = fmt.extractNarrationFromLines(displayLines, {
                                narrationEnabled: narrationOn
                            });
                            displayLines = narrParsed.lines;
                            narrationOps = Array.isArray(narrParsed.narrationOps) ? narrParsed.narrationOps : [];
                        }
                        if (
                            !options.callMode &&
                            chatRow &&
                            chatRow.type !== 'group' &&
                            contactRow &&
                            fmt &&
                            typeof fmt.extractAvatarSwapFromLines === 'function'
                        ) {
                            var dynAvSet =
                                (chatSettingsForNarr && chatSettingsForNarr.dynamicAvatar) || {};
                            var avExtract = fmt.extractAvatarSwapFromLines(displayLines, {
                                charAvatarSwapEnabled: !!dynAvSet.charEnabled,
                                userAvatarSwapEnabled: !!dynAvSet.userEnabled
                            });
                            displayLines = avExtract.lines;
                            pendingAvatarSwaps = Array.isArray(avExtract.swaps) ? avExtract.swaps : [];
                        }
                        var parsedBubbles;
                        if (options.callMode && global.MiyaChatCalls && typeof global.MiyaChatCalls.parseCallApiLines === 'function') {
                            callApiMeta = global.MiyaChatCalls.parseCallApiLines(displayLines, {
                                mode: options.callParseMode || 'turn',
                                callId: options.callId,
                                callKind: options.callKind
                            });
                            parsedBubbles = callApiMeta.bubbles || [];
                        } else if (
                            chatRow &&
                            chatRow.type === 'group' &&
                            global.MiyaChatGroup &&
                            typeof global.MiyaChatGroup.parseGroupOutputLines === 'function'
                        ) {
                            var gMembers = global.MiyaChatGroup.getMembers(store, chatRow);
                            var gCatalog =
                                typeof global.MiyaChatGroup.collectStickerCatalog === 'function'
                                    ? global.MiyaChatGroup.collectStickerCatalog(store, gMembers)
                                    : catalog;
                            parsedBubbles = global.MiyaChatGroup.parseGroupOutputLines(
                                displayLines,
                                gMembers,
                                store,
                                chatId,
                                gCatalog,
                                built.profile
                            );
                            pendingRoleCall = null;
                        } else if (fmt && typeof fmt.parseRoleOutputLinesMeta === 'function') {
                            var metaParsed = fmt.parseRoleOutputLinesMeta(displayLines, catalog);
                            parsedBubbles = metaParsed.bubbles;
                            pendingRoleCall = metaParsed.pendingRoleCall;
                            if (userWantsHtml && htmlOnly && htmlOnly.raw) {
                                parsedBubbles = [
                                    {
                                        role: 'assistant',
                                        type: 'html',
                                        content: '[HTML]',
                                        htmlRaw: htmlOnly.raw,
                                        renderAsHtml: true
                                    }
                                ];
                                pendingRoleCall = null;
                            }
                        } else if (fmt && typeof fmt.parseRoleOutputLines === 'function') {
                            parsedBubbles = fmt.parseRoleOutputLines(displayLines, catalog);
                        } else {
                            parsedBubbles = bubbles.map(function (b) {
                                return { role: 'assistant', type: 'text', content: b };
                            });
                        }

                        if (!parsedBubbles.length && displayLines.length && !options.callMode) {
                            parsedBubbles = displayLines.map(function (b) {
                                return { role: 'assistant', type: 'text', content: b };
                            });
                            pendingRoleCall = null;
                        }
                        if (!parsedBubbles.length && !options.callMode && bubbles.length) {
                            parsedBubbles = bubbles.map(function (b) {
                                return { role: 'assistant', type: 'text', content: b };
                            });
                            pendingRoleCall = null;
                        }
                        if (!parsedBubbles.length && !options.callMode) {
                            var salvageRaw = buildSalvageBubbleText(replyRaw);
                            if (salvageRaw) {
                                parsedBubbles = [{ role: 'assistant', type: 'text', content: salvageRaw }];
                                pendingRoleCall = null;
                            }
                        }
                        if (!parsedBubbles.length && options.callMode && callApiMeta && callApiMeta.ringRejected) {
                            parsedBubbles = [];
                        }
                        if (
                            !parsedBubbles.length &&
                            !narrationOps.length &&
                            !pendingRoleCall &&
                            !(
                                options.callMode &&
                                callApiMeta &&
                                (callApiMeta.ringAccepted || callApiMeta.ringRejected)
                            )
                        ) {
                            var lastResort = buildSalvageBubbleText(replyRaw);
                            var skipCallSalvage =
                                options.callMode &&
                                global.MiyaChatCalls &&
                                typeof global.MiyaChatCalls.isCallDialCommandLine === 'function' &&
                                global.MiyaChatCalls.isCallDialCommandLine(lastResort);
                            if (lastResort && !skipCallSalvage) {
                                parsedBubbles = [{ role: 'assistant', type: 'text', content: lastResort }];
                            } else if (!options.callMode) {
                                throw new Error('empty_reply');
                            }
                        }

                        parsedBubbles = (parsedBubbles || []).filter(function (fields) {
                            if (!fields) return false;
                            if (fields.type === 'recall') return !!String(fields.recallTarget || '').trim();
                            if (fields.callLine) return !!String(fields.callLine).trim();
                            if (fields.type === 'html') {
                                return !!String(fields.htmlRaw || fields.content || '').trim();
                            }
                            if (fields.type === 'sticker') return !!(fields.stickerBlobId || fields.stickerUrl || fields.stickerName);
                            if (fields.type === 'voice') return !!String(fields.voiceText || fields.content || '').trim();
                            if (fields.type === 'image') return !!String(fields.content || fields.imageDataKey || '').trim();
                            return !!String(fields.content || '').trim();
                        });
                        if (
                            !options.callMode &&
                            fmt &&
                            typeof fmt.dedupeParsedRoleBubbles === 'function' &&
                            parsedBubbles.length > 1
                        ) {
                            parsedBubbles = fmt.dedupeParsedRoleBubbles(parsedBubbles);
                        }

                        var awSanitize = global.MiyaChatAwareness;
                        var ggSanitize = global.MiyaChatGroup;
                        var gMembersSan =
                            chatRow && chatRow.type === 'group' && ggSanitize
                                ? ggSanitize.getMembers(store, chatRow)
                                : [];
                        var replyBatchId =
                            !options.callMode && chatRow && chatRow.type !== 'group'
                                ? 'rb-' + Date.now() + '-' + String(Math.floor(Math.random() * 1e9))
                                : '';
                        var replyBaseTs = Date.now();
                        var replySeq = 0;
                        function nextReplyCreatedAt() {
                            var ts = replyBaseTs + replySeq;
                            replySeq += 1;
                            return ts;
                        }
                        function appendNarrationAfterBubble(acc, bubbleIndex) {
                            if (!narrationOps.length || !replyBatchId) return Promise.resolve(acc);
                            var chainN = Promise.resolve(acc);
                            narrationOps.forEach(function (op) {
                                if (!op || op._done) return;
                                if (Number(op.afterBubbleIndex) !== Number(bubbleIndex)) return;
                                var narrText = String(op.text || '').trim();
                                if (!narrText) {
                                    op._done = true;
                                    return;
                                }
                                chainN = chainN.then(function (innerAcc) {
                                    return store
                                        .addMessage(chatId, {
                                            role: 'system',
                                            type: 'text',
                                            content: narrText,
                                            systemKind: 'online-narration',
                                            excludedFromContext: !narrationInjectCtx,
                                            replyBatchId: replyBatchId,
                                            createdAt: nextReplyCreatedAt()
                                        })
                                        .then(function (msg) {
                                            op._done = true;
                                            innerAcc.push(msg);
                                            return innerAcc;
                                        });
                                });
                            });
                            return chainN;
                        }
                        chain = chain.then(function (acc) {
                            return appendNarrationAfterBubble(acc, -1);
                        });
                        for (var bubbleIdx = 0; bubbleIdx < parsedBubbles.length; bubbleIdx++) {
                            (function (fields, unitIndex) {
                                chain = chain.then(function (acc) {
                                var payload = sanitizeAssistantPayload(
                                    Object.assign({ role: 'assistant' }, fields || {})
                                );
                                if (replyBatchId) payload.replyBatchId = replyBatchId;
                                payload.createdAt = nextReplyCreatedAt();
                                if (options.callId) payload.callId = String(options.callId);
                                if (options.callKind) payload.callKind = options.callKind === 'video' ? 'video' : 'voice';
                                if (
                                    chatRow &&
                                    chatRow.type === 'group' &&
                                    ggSanitize &&
                                    typeof ggSanitize.stripGroupSpeakerPrefixForDisplay === 'function' &&
                                    gMembersSan.length
                                ) {
                                    if (payload.content) {
                                        payload.content = ggSanitize.stripGroupSpeakerPrefixForDisplay(
                                            payload.content,
                                            gMembersSan,
                                            store,
                                            chatId,
                                            built.profile
                                        );
                                    }
                                    if (payload.voiceText) {
                                        payload.voiceText = ggSanitize.stripGroupSpeakerPrefixForDisplay(
                                            payload.voiceText,
                                            gMembersSan,
                                            store,
                                            chatId,
                                            built.profile
                                        );
                                    }
                                }
                                if (awSanitize && typeof awSanitize.sanitizeRoleMessageFields === 'function') {
                                    payload = awSanitize.sanitizeRoleMessageFields(payload);
                                } else if (
                                    awSanitize &&
                                    typeof awSanitize.stripTimelinePrefixForDisplay === 'function'
                                ) {
                                    if (payload.content) {
                                        payload.content = awSanitize.stripTimelinePrefixForDisplay(payload.content);
                                    }
                                    if (payload.voiceText) {
                                        payload.voiceText = awSanitize.stripTimelinePrefixForDisplay(
                                            payload.voiceText
                                        );
                                    }
                                    if (payload.callLine) {
                                        payload.callLine = awSanitize.stripTimelinePrefixForDisplay(payload.callLine);
                                    }
                                }
                                if (options.callEphemeral) {
                                    var lineText = String(
                                        payload.callLine ||
                                            payload.voiceText ||
                                            payload.content ||
                                            ''
                                    )
                                        .replace(/^语音[-－—]\s*/, '')
                                        .trim();
                                    if (
                                        !lineText ||
                                        (global.MiyaChatCalls &&
                                            typeof global.MiyaChatCalls.isCallDialCommandLine === 'function' &&
                                            global.MiyaChatCalls.isCallDialCommandLine(lineText))
                                    ) {
                                        return acc;
                                    }
                                    var ep = {
                                        role: 'assistant',
                                        text: lineText,
                                        ephemeral: true,
                                        callId: options.callId
                                    };
                                    acc.push(ep);
                                    return acc;
                                }
                                if (payload.type === 'recall') {
                                    var recallOpts = {
                                        role: 'assistant',
                                        targetText: payload.recallTarget,
                                        byName: contactRow && contactRow.name ? contactRow.name : ''
                                    };
                                    if (chatRow && chatRow.type === 'group' && payload.senderContactId) {
                                        recallOpts.senderContactId = payload.senderContactId;
                                    }
                                    var recallChain = store.recallMessageByTarget
                                        ? store.recallMessageByTarget(chatId, recallOpts)
                                        : Promise.resolve(null);
                                    return recallChain.then(function (recalledMsg) {
                                        if (recalledMsg) acc.push(recalledMsg);
                                        return appendNarrationAfterBubble(acc, unitIndex);
                                    });
                                }
                                var holdXfer = Promise.resolve();
                                if (
                                    !options.callMode &&
                                    contactRow &&
                                    payload.type === 'transfer' &&
                                    payload.redPacket &&
                                    payload.redPacket.dir === 'in' &&
                                    String(payload.redPacket.status || 'pending').trim() === 'pending' &&
                                    global.MiyaChatWallet &&
                                    typeof global.MiyaChatWallet.holdRoleOutgoingTransfer === 'function'
                                ) {
                                    holdXfer = global.MiyaChatWallet
                                        .holdRoleOutgoingTransfer(
                                            contactRow.id,
                                            payload.redPacket.amount
                                        )
                                        .then(function () {
                                            payload.redPacket = Object.assign({}, payload.redPacket, {
                                                walletHeld: true
                                            });
                                        })
                                        .catch(function () {
                                            /* 余额不足时仍展示转账，但不记账 */
                                        });
                                }
                                if (
                                    !options.callMode &&
                                    chatRow &&
                                    chatRow.type !== 'group' &&
                                    contactRow &&
                                    payload.type === 'image' &&
                                    !payload.imageDataKey &&
                                    (payload.imageKind === 'text' || !payload.imageKind) &&
                                    isContactImageGenEnabled(chatSettingsForNarr)
                                ) {
                                    payload.imageGenPending = true;
                                }
                                if (
                                    !options.callMode &&
                                    chatRow &&
                                    chatRow.type === 'group' &&
                                    ggSanitize &&
                                    typeof ggSanitize.processAssistantBubbleForTitleChange === 'function'
                                ) {
                                    var titleChangeResult = ggSanitize.processAssistantBubbleForTitleChange(
                                        payload,
                                        {
                                            store: store,
                                            chatId: chatId,
                                            members: gMembersSan,
                                            profile: built.profile
                                        }
                                    );
                                    if (titleChangeResult && titleChangeResult.skipBubble) {
                                        var titleChain = holdXfer;
                                        if (titleChangeResult.settingsPatch) {
                                            titleChain = titleChain.then(function () {
                                                return store.saveChatSettings(
                                                    chatId,
                                                    titleChangeResult.settingsPatch
                                                );
                                            });
                                        }
                                        return titleChain.then(function () {
                                            if (!titleChangeResult.systemMessage) {
                                                return appendNarrationAfterBubble(acc, unitIndex);
                                            }
                                            return store
                                                .addMessage(chatId, titleChangeResult.systemMessage)
                                                .then(function (msg) {
                                                    if (!firstMsgId) firstMsgId = msg.id;
                                                    lastMsgId = msg.id;
                                                    acc.push(msg);
                                                    return appendNarrationAfterBubble(acc, unitIndex);
                                                });
                                        });
                                    }
                                }
                                return holdXfer.then(function () {
                                    return store.addMessage(chatId, payload).then(function (msg) {
                                        if (!firstMsgId) firstMsgId = msg.id;
                                        lastMsgId = msg.id;
                                        acc.push(msg);
                                        return appendNarrationAfterBubble(acc, unitIndex);
                                    });
                                });
                            });
                            })(parsedBubbles[bubbleIdx], bubbleIdx);
                        }
                        chain = chain.then(function (acc) {
                            if (!narrationOps.length || !replyBatchId) return acc;
                            var chainLeft = Promise.resolve(acc);
                            narrationOps.forEach(function (op) {
                                if (!op || op._done) return;
                                var leftText = String(op.text || '').trim();
                                if (!leftText) {
                                    op._done = true;
                                    return;
                                }
                                chainLeft = chainLeft.then(function (innerAcc) {
                                    return store
                                        .addMessage(chatId, {
                                            role: 'system',
                                            type: 'text',
                                            content: leftText,
                                            systemKind: 'online-narration',
                                            excludedFromContext: !narrationInjectCtx,
                                            replyBatchId: replyBatchId,
                                            createdAt: nextReplyCreatedAt()
                                        })
                                        .then(function (msg) {
                                            op._done = true;
                                            innerAcc.push(msg);
                                            return innerAcc;
                                        });
                                });
                            });
                            return chainLeft;
                        });
                        return chain;
                    })
                    .then(function (msgs) {
                var localUsage = buildLocalTokenUsage(built, replyRaw);
                var hvChatSettings =
                    store.getChatSettings && typeof store.getChatSettings === 'function'
                        ? store.getChatSettings(chatId)
                        : null;
                var hvTplMod = global.MiyaChatHeartVoiceTemplates;
                var hvPreset =
                    hvTplMod && typeof hvTplMod.resolvePresetForChat === 'function'
                        ? hvTplMod.resolvePresetForChat(hvChatSettings)
                        : null;
                var hvParseOpts = {};
                if (hvPreset && hvTplMod && typeof hvTplMod.getFieldNames === 'function') {
                    hvParseOpts.fieldNames = hvTplMod.getFieldNames(hvPreset);
                }
                var hvParsed = parseHeartVoiceFromReply(replyRaw, hvParseOpts);
                var thinkingText = thinking ? String(thinking).trim() : '';
                var isGroupReply = !!(chatRow && chatRow.type === 'group');
                var chatPatch = {
                    activeThinking: thinkingText,
                    activeThinkingMsgId: firstMsgId || lastMsgId || '',
                    lastPromptMeta: built.promptMeta || null,
                    lastRawAssistantReply: replyRawOriginal,
                    lastPromptDebug: buildPromptDebug(built.messages),
                    lastHeartVoiceParse: hvParsed,
                    activeHeartVoiceMsgId: isGroupReply ? '' : (lastMsgId || firstMsgId || '')
                };
                chatPatch.lastTokenUsage = localUsage;
                if (!isGroupReply && hvParsed.extractedOk && hvParsed.extracted && lastMsgId) {
                    var hvEntry = {
                        id: 'hv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                        msgId: lastMsgId,
                        affection: hvParsed.extracted.affection,
                        desire: hvParsed.extracted.desire,
                        action: hvParsed.extracted.action,
                        monologue: hvParsed.extracted.monologue,
                        updatedAt: Date.now()
                    };
                    if (hvParsed.extracted.mode === 'custom' || (hvPreset && hvParsed.extracted.fields)) {
                        hvEntry.mode = 'custom';
                        hvEntry.presetName = hvPreset
                            ? String(hvPreset.name || '')
                            : String((hvChatSettings && hvChatSettings.heartVoicePreset) || '');
                        hvEntry.fields = hvParsed.extracted.fields || {};
                        var tplHtml = hvPreset ? String(hvPreset.htmlTemplate || '') : '';
                        if (
                            !tplHtml &&
                            hvChatSettings &&
                            hvChatSettings.heartVoicePresetSnapshot
                        ) {
                            tplHtml = String(
                                hvChatSettings.heartVoicePresetSnapshot.htmlTemplate || ''
                            );
                        }
                        hvEntry.htmlTemplate = tplHtml;
                    }
                    chatPatch.heartVoiceLog = appendHeartVoiceLog(
                        chatRow && chatRow.heartVoiceLog,
                        hvEntry
                    );
                    chatPatch.activeHeartVoiceMsgId = lastMsgId;
                }

                    return store
                        .updateChat(chatId, chatPatch)
                        .then(function () {
                            if (lifeLikeNextPushPatch && store.saveChatSettings) {
                                return store.saveChatSettings(chatId, lifeLikeNextPushPatch);
                            }
                        })
                        .then(function () {
                            if (
                                lifeLikeNextPushPatch &&
                                global.MiyaChatBackground &&
                                typeof global.MiyaChatBackground.kickScan === 'function'
                            ) {
                                global.MiyaChatBackground.kickScan();
                            }
                        })
                        .then(function () {
                            if (
                                pendingAvatarSwaps.length &&
                                global.MiyaChatDynamicAvatar &&
                                typeof global.MiyaChatDynamicAvatar.applySwaps === 'function' &&
                                contactRow
                            ) {
                                return global.MiyaChatDynamicAvatar.applySwaps(
                                    chatId,
                                    pendingAvatarSwaps,
                                    msgs,
                                    contactRow.id,
                                    built.profile && built.profile.id ? built.profile.id : ''
                                );
                            }
                        })
                        .then(function () {
                            if (
                                global.miyaChatRoomExtras &&
                                typeof global.miyaChatRoomExtras.patchTokenUsageInSettings === 'function'
                            ) {
                                global.miyaChatRoomExtras.patchTokenUsageInSettings(chatId);
                            }
                            if (global.MiyaChatSummary && typeof global.MiyaChatSummary.maybeAutoSummary === 'function') {
                                global.MiyaChatSummary.maybeAutoSummary(chatId);
                            }
                            if (
                                global.MiyaChatMemoryExtract &&
                                typeof global.MiyaChatMemoryExtract.maybeAutoMemoryExtract === 'function'
                            ) {
                                global.MiyaChatMemoryExtract.maybeAutoMemoryExtract(chatId);
                            }
                            if (
                                global.MiyaChatMoments &&
                                typeof global.MiyaChatMoments.maybeAutoMomentsAfterRound === 'function'
                            ) {
                                global.MiyaChatMoments.maybeAutoMomentsAfterRound(chatId);
                            }
                            var bgPush = !!(options.isAutoPush || options.isOffline || options.isLifeLike);
                            var roomOpen =
                                global.miyaChatRoom &&
                                global.miyaChatRoom.getOpenChatId &&
                                global.miyaChatRoom.getOpenChatId() === chatId;
                            if (roomOpen) {
                                if (
                                    updatedTransferMsgIds.length &&
                                    typeof global.miyaChatRoom.patchMessageBubble === 'function'
                                ) {
                                    updatedTransferMsgIds.forEach(function (xferMsgId) {
                                        global.miyaChatRoom.patchMessageBubble(xferMsgId);
                                    });
                                }
                                if (
                                    updatedCoupleInviteMsgIds.length &&
                                    typeof global.miyaChatRoom.patchMessageBubble === 'function'
                                ) {
                                    updatedCoupleInviteMsgIds.forEach(function (cpMsgId) {
                                        global.miyaChatRoom.patchMessageBubble(cpMsgId);
                                    });
                                }
                                if (hvParsed.extractedOk && global.MiyaChatHeartVoice && typeof global.MiyaChatHeartVoice.onRoundUpdated === 'function') {
                                    global.MiyaChatHeartVoice.onRoundUpdated(chatId);
                                }
                                if (bgPush && typeof global.miyaChatRoom.refresh === 'function') {
                                    global.miyaChatRoom.refresh({
                                        animate: false,
                                        preserveScrollTop: true,
                                        preserveLoadedCount: true,
                                        toBottom: document.hidden
                                    });
                                } else if (
                                    msgs.length &&
                                    typeof global.miyaChatRoom.revealAssistantMessages === 'function'
                                ) {
                                    global.miyaChatRoom.revealAssistantMessages(msgs);
                                }
                            }
                            if (
                                global.miyaChatApp &&
                                typeof global.miyaChatApp.refreshLists === 'function' &&
                                !roomOpen
                            ) {
                                global.miyaChatApp.refreshLists();
                            }
                            if (
                                global.MiyaChatNotify &&
                                typeof global.MiyaChatNotify.notifyAssistantMessages === 'function' &&
                                msgs.length
                            ) {
                                global.MiyaChatNotify.notifyAssistantMessages(chatId, msgs, {
                                    isAutoPush: !!options.isAutoPush,
                                    isOffline: !!options.isOffline,
                                    roomWasOpen: roomOpen
                                });
                            }
                            var out = { messages: msgs, thinking: thinking };
                            if (callApiMeta) {
                                out.callApiMeta = callApiMeta;
                            }
                            if (
                                pendingRoleCall &&
                                global.MiyaChatCalls &&
                                typeof global.MiyaChatCalls.onRoleCallIntent === 'function' &&
                                !(
                                    typeof global.MiyaChatCalls.isActive === 'function' &&
                                    global.MiyaChatCalls.isActive()
                                )
                            ) {
                                try {
                                    global.MiyaChatCalls.onRoleCallIntent(chatId, pendingRoleCall);
                                } catch (callErr) {}
                            }
                            if (
                                roleMomentsIntent &&
                                contactRow &&
                                chatRow &&
                                chatRow.type !== 'group' &&
                                global.MiyaChatMoments &&
                                typeof global.MiyaChatMoments.createRolePostFromIntent === 'function'
                            ) {
                                try {
                                    global.MiyaChatMoments.createRolePostFromIntent(
                                        contactRow.id,
                                        roleMomentsIntent
                                    );
                                } catch (momErr) {}
                            }
                            if (
                                global.MiyaImageGen &&
                                typeof global.MiyaImageGen.processAssistantMessages === 'function' &&
                                chatRow &&
                                chatRow.type !== 'group'
                            ) {
                                global.MiyaImageGen.processAssistantMessages(chatId, msgs).catch(function () {});
                            }
                            return out;
                        });
                    });
            });
        })
            .catch(function (err) {
                throw err;
            })
            .finally(clearInFlight);
    }

    global.miyaChatEngine = {
        getApiConfig: getApiConfig,
        getGlobalPrompt: getGlobalPrompt,
        buildAvatarRecognitionBlock: buildAvatarRecognitionBlock,
        collectContactRoleIds: collectContactRoleIds,
        collectBoundLocalWorldbookBindings: collectBoundLocalWorldbookBindings,
        collectBoundLocalBindingsForRoleIds: collectBoundLocalBindingsForRoleIds,
        listSortableWorldbookEntriesForContact: listSortableWorldbookEntriesForContact,
        collectSortableWorldbookEntryIdsForContact: collectSortableWorldbookEntryIdsForContact,
        buildUniversalWorldbookTopLayer: buildUniversalWorldbookTopLayer,
        prependUniversalWorldbookMessage: prependUniversalWorldbookMessage,
        appendWorldbookBackMessages: appendWorldbookBackMessages,
        joinWorldbookBundleText: joinWorldbookBundleText,
        ensureWorldbookDepsReady: ensureWorldbookDepsReady,
        buildWorldbookBundle: buildWorldbookBundle,
        buildSystemPrompt: buildSystemPrompt,
        buildApiMessages: buildApiMessages,
        setPendingOnlineReturnPrompt: function (chatId, text) {
            var key = String(chatId || '').trim();
            if (!key) return;
            pendingOnlineReturnPromptByChat[key] = String(text || '').trim();
        },
        sendChat: sendChat,
        acquireChatApi: acquireChatApi,
        releaseChatApi: releaseChatApi,
        isChatApiBusy: isChatApiBusy,
        isReplyInFlight: isReplyInFlight,
        estimateTokensFromText: estimateTokensFromText,
        estimateTokensFromCharCount: estimateTokensFromCharCount,
        estimateMessagesTokens: estimateMessagesTokens,
        countMessagesChars: countMessagesChars,
        buildPromptSourceBreakdown: buildPromptSourceBreakdown,
        extractBodyForBubbles: extractBodyForBubbles,
        splitBubbles: splitBubbles,
        stripThinkingForApi: stripThinkingForApi,
        stripHeartVoiceTags: stripHeartVoiceTags,
        stripHeartVoiceTagFragments: stripHeartVoiceTagFragments,
        parseThinking: parseThinking,
        extractHeartVoiceBlock: extractHeartVoiceBlock,
        parseHeartVoiceFromReply: parseHeartVoiceFromReply,
        getTrailingUserRound: getTrailingUserRound,
        getTrailingAssistantRound: getTrailingAssistantRound,
        getUserRoundBeforeAssistant: getUserRoundBeforeAssistant,
        withdrawLastAssistantRound: withdrawLastAssistantRound,
        regenerateLastRound: regenerateLastRound,
        resolveApiChatId: resolveApiChatId,
        extractReplyContent: extractReplyContent,
        extractThinkingBlock: extractThinkingBlock,
        extractThinkingFromResponse: extractThinkingFromResponse,
        buildThinkingRules: buildThinkingRules,
        buildThinkingRulesHead: buildThinkingRulesHead,
        buildThinkingRulesFormatTail: buildThinkingRulesFormatTail,
        getThinkingRulesFormatTailItems: getThinkingRulesFormatTailItems,
        buildOperationRules: buildOperationRules,
        buildOperationRulesHead: buildOperationRulesHead,
        buildOperationRulesFormatTail: buildOperationRulesFormatTail,
        getOperationRulesFormatTailItems: getOperationRulesFormatTailItems,
        buildOperationRulesFormatTailFrom: buildOperationRulesFormatTailFrom,
        buildOnlineRulesBundle: buildOnlineRulesBundle,
        buildCallSystemPrompt: buildCallSystemPrompt,
        buildReadTogetherSystemPrompt: buildReadTogetherSystemPrompt,
        buildListenTogetherSystemPrompt: buildListenTogetherSystemPrompt,
        buildCallRingRules: buildCallRingRules
    };
})(window);
