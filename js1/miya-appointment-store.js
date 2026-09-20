(function (global) {
    'use strict';

    var LS_KEY = 'miya-appointment-v1';
    var LS_BACKUP_KEY = 'miya-appointment-v1-backup';
    var BUILTIN_PRESET_ID = '__ap_builtin_cool__';
    /** 递增后会把内置预设的写法说明 / 字数 / 自动纪要同步为 defaultBuiltinPreset */
    var BUILTIN_DEFAULTS_REV = 2;

    var cache = null;
    var _hydrated = false;
    var _hydratePromise = null;
    var _lastRecoveryInfo = null;
    var _saveTimer = 0;
    var SAVE_DEBOUNCE_MS = 280;

    function uid(prefix) {
        return (prefix || 'ap') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function clampInt(v, lo, hi, fb) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fb;
        return Math.min(hi, Math.max(lo, n));
    }

    function defaultBuiltinPreset() {
        return {
            id: BUILTIN_PRESET_ID,
            name: '内置·漫画分镜',
            builtin: true,
            summaryTrigger: 15,
            outputWordCount: 2000,
            styleGuide:
                '按黑白漫画分镜写长篇散文：用镜头语言组织段落——远景定场、中景交锋、特写收束，格与格之间空一行。\n' +
                '节奏允许快切：一场戏内可连跳多个画面，但每格须写满多句完整叙述，禁止聊天气泡式一行一句。\n' +
                '台词可独立成段，叙述要有肌理；情绪靠动作线、光影对比与停顿推进，少用形容词堆砌。\n' +
                '禁止油腻霸总腔、过度撒娇发情与露骨描写；亲密用暗示与留白，须符合当下关系。\n' +
                '可偶有拟声或画面留白感，不必真写音效字；忌文艺腔过头。全文控制在用户设定的篇幅内。',
            rolePerson: 'third',
            userPerson: 'second',
            summaryPrompt:
                '以时间线客观总结本段线下长剧情，区分双方，保留关键情节、情绪转折与约定；100–280字，不要复述修辞。',
            worldbookBindings: [],
            showThinking: true,
            textDecor: true,
            updatedAt: Date.now()
        };
    }

    function defaultBeautify() {
        return {
            themeId: 'museum',
            customCss: '',
            wallpaperMode: 'none',
            wallpaperId: null,
            wallpaperUrl: ''
        };
    }

    function defaultStatusBar() {
        return {
            enabled: true,
            presetName: '',
            fabIconUrl: ''
        };
    }

    function normalizeStatusBar(raw) {
        var d = defaultStatusBar();
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        return {
            enabled: raw.enabled !== false,
            presetName: String(raw.presetName || '').trim(),
            fabIconUrl: String(raw.fabIconUrl || '').trim()
        };
    }

    function normalizeCastMember(row) {
        if (!row || typeof row !== 'object') return null;
        var contactId = String(row.contactId || '').trim();
        var chatId = String(row.chatId || '').trim();
        if (!contactId) return null;
        return { contactId: contactId, chatId: chatId };
    }

    function normalizeCast(raw, fallbackContactId, fallbackChatId) {
        var list = Array.isArray(raw)
            ? raw.map(normalizeCastMember).filter(Boolean)
            : [];
        if (!list.length && fallbackContactId) {
            list = [
                {
                    contactId: String(fallbackContactId).trim(),
                    chatId: String(fallbackChatId || '').trim()
                }
            ];
        }
        var seen = Object.create(null);
        return list.filter(function (row) {
            if (!row.contactId || seen[row.contactId]) return false;
            seen[row.contactId] = true;
            return true;
        });
    }

    function normalizeCastMirrors(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var out = {};
        Object.keys(raw).forEach(function (k) {
            var mid = String(raw[k] || '').trim();
            if (mid) out[String(k)] = mid;
        });
        return Object.keys(out).length ? out : null;
    }

    function normalizeStatusLogEntry(row) {
        if (!row || typeof row !== 'object') return null;
        var fields = row.fields && typeof row.fields === 'object' ? row.fields : {};
        var out = {
            contactId: String(row.contactId || '').trim(),
            roleName: String(row.roleName || '').trim(),
            mode: row.mode === 'custom' ? 'custom' : 'builtin',
            fields: fields,
            updatedAt: Number(row.updatedAt) || Date.now()
        };
        if (row.presetName) out.presetName = String(row.presetName || '').trim();
        if (row.htmlTemplate) out.htmlTemplate = String(row.htmlTemplate || '');
        return out;
    }

    function normalizeStatusLogRound(row) {
        if (!row || typeof row !== 'object') return null;
        var entries = Array.isArray(row.entries)
            ? row.entries.map(normalizeStatusLogEntry).filter(Boolean)
            : [];
        if (!entries.length) return null;
        return {
            updatedAt: Number(row.updatedAt) || Date.now(),
            entries: entries
        };
    }

    function normalizeThemeId(rawId, fallback) {
        var id = String(rawId || fallback || 'museum');
        if (id === 'ins') id = 'korean';
        if (id === 'gufeng') id = 'museum';
        if (['museum', 'korean', 'custom'].indexOf(id) >= 0) return id;
        return fallback || 'museum';
    }

    function normalizeBeautify(raw) {
        var d = defaultBeautify();
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        return {
            themeId: normalizeThemeId(raw.themeId, d.themeId),
            customCss: String(raw.customCss || ''),
            wallpaperMode: ['none', 'idb', 'url'].indexOf(raw.wallpaperMode) >= 0 ? raw.wallpaperMode : d.wallpaperMode,
            wallpaperId: raw.wallpaperId ? String(raw.wallpaperId) : null,
            wallpaperUrl: String(raw.wallpaperUrl || '').trim()
        };
    }

    function defaultState() {
        return {
            version: 1,
            presets: [defaultBuiltinPreset()],
            contactPresetId: {},
            contactParams: {},
            contactWorldbook: {},
            contactOpeningPresets: {},
            savedParamPresets: [],
            beautify: defaultBeautify(),
            statusBar: defaultStatusBar(),
            byChat: {},
            /** 用户手动删除的卷宗 id → 删除时间；双保险，防止残留镜像把已删剧情复活 */
            deletedSessionIds: {}
        };
    }

    function normalizeDeletedSessionIds(raw) {
        var out = {};
        if (!raw || typeof raw !== 'object') return out;
        Object.keys(raw).forEach(function (k) {
            var sid = String(k || '').trim();
            if (!sid) return;
            var ts = Number(raw[k]);
            out[sid] = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
        });
        return out;
    }

    function isSessionTombstoned(sessionId) {
        var sid = String(sessionId || '').trim();
        if (!sid) return false;
        var map = (cache && cache.deletedSessionIds) || {};
        return !!map[sid];
    }

    function markSessionTombstone(sessionId) {
        var sid = String(sessionId || '').trim();
        if (!sid) return;
        load();
        if (!cache.deletedSessionIds || typeof cache.deletedSessionIds !== 'object') {
            cache.deletedSessionIds = {};
        }
        cache.deletedSessionIds[sid] = Date.now();
    }

    function normalizeOpeningPreset(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var content = String(raw.content || '').trim();
        if (!content) return null;
        return {
            id: String(raw.id || '').trim() || uid('aop'),
            name: String(raw.name || '').trim() || '开场白',
            content: content,
            updatedAt: Number(raw.updatedAt) || Date.now()
        };
    }

    function normalizeContactParams(raw) {
        if (!raw || typeof raw !== 'object') return null;
        return {
            summaryTrigger: clampInt(raw.summaryTrigger, 0, 500, 15),
            outputWordCount: clampInt(raw.outputWordCount, 80, 4000, 2000),
            styleGuide: String(raw.styleGuide || '').trim(),
            rolePerson: ['first', 'second', 'third'].indexOf(raw.rolePerson) >= 0 ? raw.rolePerson : 'third',
            userPerson: ['first', 'second', 'third'].indexOf(raw.userPerson) >= 0 ? raw.userPerson : 'second',
            summaryPrompt: String(raw.summaryPrompt || '').trim(),
            showThinking: raw.showThinking !== false,
            enterToSend: raw.enterToSend !== false,
            textDecor: raw.textDecor !== false,
            updatedAt: Number(raw.updatedAt) || Date.now()
        };
    }

    function normalizeSavedParamPreset(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var params = normalizeContactParams(raw);
        if (!params) return null;
        return Object.assign({}, params, {
            id: String(raw.id || '').trim() || uid('apsp'),
            name: String(raw.name || '').trim() || '未命名预设',
            updatedAt: Number(raw.updatedAt) || Date.now()
        });
    }

    function normalizeBindings(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .map(function (row, i) {
                if (!row || typeof row !== 'object') return null;
                var entryId = String(row.entryId || row.id || '').trim();
                if (!entryId) return null;
                return {
                    entryId: entryId,
                    order: clampInt(row.order, 0, 9999, i)
                };
            })
            .filter(Boolean)
            .sort(function (a, b) {
                return a.order - b.order;
            });
    }

    function isLegacyBuiltinContent(preset) {
        if (!preset) return false;
        var style = String(preset.styleGuide || '');
        if (style.indexOf('文风为日常白描') >= 0 || style.indexOf('冷调白描') >= 0) return true;
        var trig = clampInt(preset.summaryTrigger, 0, 500, -1);
        var words = clampInt(preset.outputWordCount, 80, 4000, -1);
        return trig === 28 && words === 480;
    }

    function applyNewBuiltinFields(preset, def) {
        return Object.assign({}, preset, {
            summaryTrigger: def.summaryTrigger,
            outputWordCount: def.outputWordCount,
            styleGuide: def.styleGuide,
            summaryPrompt: def.summaryPrompt,
            updatedAt: Date.now()
        });
    }

    function mergeBuiltinDefaults(preset) {
        if (!preset || preset.id !== BUILTIN_PRESET_ID) return preset;
        var def = defaultBuiltinPreset();
        var rev = clampInt(preset.builtinDefaultsRev, 0, 99, 0);
        var legacy = isLegacyBuiltinContent(preset);
        if (rev >= BUILTIN_DEFAULTS_REV && !legacy) return preset;
        return applyNewBuiltinFields(
            Object.assign({}, preset, {
                name: def.name,
                builtin: true,
                builtinDefaultsRev: BUILTIN_DEFAULTS_REV
            }),
            def
        );
    }

    function migrateLegacyPresetFields(preset) {
        if (!preset || preset.id === BUILTIN_PRESET_ID) return preset;
        if (!isLegacyBuiltinContent(preset)) return preset;
        return applyNewBuiltinFields(preset, defaultBuiltinPreset());
    }

    function normalizePreset(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var id = String(raw.id || '').trim() || uid('preset');
        var def = id === BUILTIN_PRESET_ID ? defaultBuiltinPreset() : null;
        var styleRaw = String(raw.styleGuide || '').trim();
        var row = {
            id: id,
            name: String(raw.name || '').trim() || '未命名预设',
            builtin: !!raw.builtin || id === BUILTIN_PRESET_ID,
            builtinDefaultsRev: clampInt(raw.builtinDefaultsRev, 0, 99, 0),
            summaryTrigger: clampInt(raw.summaryTrigger, 0, 500, 15),
            outputWordCount: clampInt(raw.outputWordCount, 80, 4000, 2000),
            styleGuide: styleRaw || (def ? def.styleGuide : ''),
            rolePerson: ['first', 'second', 'third'].indexOf(raw.rolePerson) >= 0 ? raw.rolePerson : 'third',
            userPerson: ['first', 'second', 'third'].indexOf(raw.userPerson) >= 0 ? raw.userPerson : 'second',
            summaryPrompt:
                String(raw.summaryPrompt || '').trim() || (def ? def.summaryPrompt : ''),
            worldbookBindings: normalizeBindings(raw.worldbookBindings),
            showThinking: raw.showThinking !== false,
            enterToSend: raw.enterToSend !== false,
            textDecor: raw.textDecor !== false,
            updatedAt: Number(raw.updatedAt) || Date.now()
        };
        return migrateLegacyPresetFields(mergeBuiltinDefaults(row));
    }

    function normalizeSummary(row, i) {
        if (!row || typeof row !== 'object') return null;
        var id = String(row.id || '').trim() || uid('sum');
        return {
            id: id,
            content: String(row.content || '').trim(),
            startIndex: clampInt(row.startIndex, 0, 999999, 0),
            endIndex: clampInt(row.endIndex, 0, 999999, 0),
            createdAt: Number(row.createdAt) || Date.now()
        };
    }

    function normalizeMessage(row) {
        if (!row || typeof row !== 'object') return null;
        var role = row.role === 'assistant' ? 'assistant' : row.role === 'system' ? 'system' : 'user';
        var out = {
            id: String(row.id || '').trim() || uid('msg'),
            role: role,
            content: String(row.content || '').trim(),
            createdAt: Number(row.createdAt) || Date.now(),
            deleted: !!row.deleted,
            editedAt: Number(row.editedAt) || 0
        };
        if (row.chatMirrorId) out.chatMirrorId = String(row.chatMirrorId).trim();
        var thinking = String(row.thinking || '').trim();
        if (thinking) out.thinking = thinking;
        if (row.renderAsHtml) {
            out.renderAsHtml = true;
            if (row.htmlRaw) out.htmlRaw = String(row.htmlRaw || '').trim();
        }
        if (row.type) out.type = String(row.type || '').trim();
        if (row.openingPresetId) out.openingPresetId = String(row.openingPresetId || '').trim();
        var castMirrors = normalizeCastMirrors(row.castMirrors);
        if (castMirrors) out.castMirrors = castMirrors;
        return out;
    }

    function isOpeningMessage(msg) {
        return !!(msg && msg.role === 'system' && msg.type === 'opening');
    }

    /** 目标线程上是否仍有可用线下镜像（含已删除判定；不可用 getMessages，因其会滤掉 offlineMeet） */
    function liveMirrorOnChat(st, chatId, mirrorId) {
        var mid = String(mirrorId || '').trim();
        if (!st || !chatId || !mid) return null;
        var arr =
            st.getMessagesForApi && typeof st.getMessagesForApi === 'function'
                ? st.getMessagesForApi(chatId)
                : null;
        if (!Array.isArray(arr)) return null;
        for (var i = 0; i < arr.length; i++) {
            var m = arr[i];
            if (m && !m.deleted && String(m.id) === mid && m.offlineMeet) return m;
        }
        return null;
    }

    function mirrorMessageToChat(chatId, sess, msg, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var deferWrite = !!opts.deferSessionWrite;
        var knownMirrors = opts.knownMirrors || null;
        var targetChatId = String(opts.targetChatId || chatId || '').trim();
        var primaryChatId = String((sess && sess.chatId) || chatId || '').trim();
        var st = global.miyaChatStore;
        if (!st || !msg || msg.deleted || isOpeningMessage(msg)) return;
        if (!String(msg.content || '').trim()) return;
        if (!targetChatId) return;
        var existingMirrorId = getMirrorIdForChat(msg, targetChatId, primaryChatId);
        /* chatMirrorId 可能指向已丢线程/被 IDB 恢复冲掉的旧 id，必须校验目标 chat 上是否仍活着 */
        if (existingMirrorId) {
            if (knownMirrors && knownMirrors[existingMirrorId]) return;
            if (!knownMirrors && liveMirrorOnChat(st, targetChatId, existingMirrorId)) return;
            if (msg.castMirrors && msg.castMirrors[targetChatId]) delete msg.castMirrors[targetChatId];
            if (targetChatId === primaryChatId) msg.chatMirrorId = '';
        }
        if (typeof st.findMirrorByAppointmentMsgId === 'function') {
            var existing = st.findMirrorByAppointmentMsgId(targetChatId, msg.id);
            if (existing && existing.id && !existing.deleted) {
                setMirrorIdForChat(msg, targetChatId, existing.id, primaryChatId);
                if (knownMirrors) knownMirrors[existing.id] = existing;
                if (!deferWrite) store._writeSession(sess);
                return;
            }
        }
        var row = null;
        if (typeof st.mirrorOfflineMessage === 'function') {
            row = st.mirrorOfflineMessage(targetChatId, {
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt || Date.now(),
                appointmentSessionId: sess.id,
                appointmentMsgId: msg.id,
                renderAsHtml: !!msg.renderAsHtml,
                htmlRaw: msg.htmlRaw || msg.content,
                type: msg.renderAsHtml ? 'html' : undefined
            });
        } else if (st.addMessage) {
            st.addMessage(targetChatId, {
                role: msg.role,
                content: msg.content,
                createdAt: msg.createdAt || Date.now(),
                offlineMeet: true,
                renderAsHtml: !!msg.renderAsHtml,
                htmlRaw: msg.htmlRaw || msg.content,
                type: msg.renderAsHtml ? 'html' : 'text',
                appointmentSessionId: sess.id,
                appointmentMsgId: msg.id
            })
                .then(function (r) {
                    if (!r || !r.id) return;
                    setMirrorIdForChat(msg, targetChatId, r.id, primaryChatId);
                    store._writeSession(sess);
                })
                .catch(function () {});
            return;
        }
        if (row && row.id) {
            setMirrorIdForChat(msg, targetChatId, row.id, primaryChatId);
            if (knownMirrors) knownMirrors[row.id] = row;
            if (!deferWrite) store._writeSession(sess);
        }
    }

    function mirrorMessageToCast(sess, msg, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var targets = sessionCastTargets(sess);
        if (!targets.length && sess && sess.chatId) {
            targets = [{ contactId: sess.contactId, chatId: sess.chatId }];
        }
        targets.forEach(function (t) {
            var tid = String((t && t.chatId) || '').trim();
            if (!tid) return;
            mirrorMessageToChat(tid, sess, msg, Object.assign({}, opts, { targetChatId: tid }));
        });
    }

    function softDeleteChatMirror(st, chatId, mirrorId) {
        var tid = String(chatId || '').trim();
        var mid = String(mirrorId || '').trim();
        if (!st || !tid || !mid || typeof st.updateMessage !== 'function') return;
        st.updateMessage(tid, mid, { deleted: true, content: '' }).catch(function () {});
    }

    /** 彻底删除某卷宗在线上的镜像：不再注入 API / 不再被镜像恢复 */
    function purgeSessionOnlineMirrors(sess) {
        if (!sess || !sess.id) return;
        var st = global.miyaChatStore;
        if (!st) return;
        var sid = String(sess.id).trim();
        var primary = String(sess.chatId || '').trim();
        var touched = Object.create(null);

        function mark(tid, mid) {
            var t = String(tid || '').trim();
            var m = String(mid || '').trim();
            if (!t || !m) return;
            var key = t + '\0' + m;
            if (touched[key]) return;
            touched[key] = true;
            softDeleteChatMirror(st, t, m);
        }

        (sess.messages || []).forEach(function (msg) {
            if (!msg) return;
            if (msg.chatMirrorId) mark(primary, msg.chatMirrorId);
            if (msg.castMirrors && typeof msg.castMirrors === 'object') {
                Object.keys(msg.castMirrors).forEach(function (tid) {
                    mark(tid, msg.castMirrors[tid]);
                });
            }
        });

        var meta = typeof st.getMeta === 'function' ? st.getMeta() : null;
        var messagesByChat = meta && meta.messagesByChat;
        if (!messagesByChat || typeof messagesByChat !== 'object') return;
        Object.keys(messagesByChat).forEach(function (tid) {
            var arr = messagesByChat[tid] || [];
            for (var i = 0; i < arr.length; i++) {
                var m = arr[i];
                if (!m || m.deleted || !m.offlineMeet) continue;
                if (String(m.appointmentSessionId || '').trim() !== sid) continue;
                mark(tid, m.id);
            }
        });
    }

    function purgeMessageOnlineMirrors(chatId, msg) {
        if (!msg) return;
        var st = global.miyaChatStore;
        if (!st) return;
        var primary = String(chatId || '').trim();
        if (msg.chatMirrorId) softDeleteChatMirror(st, primary, msg.chatMirrorId);
        if (msg.castMirrors && typeof msg.castMirrors === 'object') {
            Object.keys(msg.castMirrors).forEach(function (tid) {
                softDeleteChatMirror(st, tid, msg.castMirrors[tid]);
            });
        }
    }

    function normalizeSession(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var msgs = Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage).filter(Boolean) : [];
        var sums = Array.isArray(raw.summaryList) ? raw.summaryList.map(normalizeSummary).filter(Boolean) : [];
        var chatId = String(raw.chatId || '').trim();
        var contactId = String(raw.contactId || '').trim();
        var cast = normalizeCast(raw.cast, contactId, chatId);
        var statusLog = Array.isArray(raw.statusLog)
            ? raw.statusLog.map(normalizeStatusLogRound).filter(Boolean)
            : [];
        return {
            id: String(raw.id || '').trim() || uid('sess'),
            chatId: chatId,
            contactId: contactId,
            cast: cast,
            createdAt: Number(raw.createdAt) || Date.now(),
            closedAt: Number(raw.closedAt) || 0,
            title: String(raw.title || '').trim(),
            messages: msgs,
            summaryList: sums,
            statusLog: statusLog
        };
    }

    function sessionCastTargets(sess) {
        var cast = normalizeCast(
            sess && sess.cast,
            sess && sess.contactId,
            sess && sess.chatId
        );
        if (cast.length) return cast;
        if (sess && sess.chatId) {
            return [{ contactId: String(sess.contactId || '').trim(), chatId: String(sess.chatId) }];
        }
        return [];
    }

    function getMirrorIdForChat(msg, targetChatId, primaryChatId) {
        var tid = String(targetChatId || '').trim();
        if (!msg || !tid) return '';
        if (msg.castMirrors && msg.castMirrors[tid]) return String(msg.castMirrors[tid]);
        if (tid === String(primaryChatId || '') && msg.chatMirrorId) return String(msg.chatMirrorId);
        return '';
    }

    function setMirrorIdForChat(msg, targetChatId, mirrorId, primaryChatId) {
        if (!msg) return;
        var tid = String(targetChatId || '').trim();
        var mid = String(mirrorId || '').trim();
        if (!tid || !mid) return;
        if (!msg.castMirrors) msg.castMirrors = {};
        msg.castMirrors[tid] = mid;
        if (tid === String(primaryChatId || '')) msg.chatMirrorId = mid;
    }

    function needsAsyncHydrate() {
        return !!(global.miyaKvKeyNeedsAsyncHydrate && global.miyaKvKeyNeedsAsyncHydrate(LS_KEY));
    }

    function stateRichness(state) {
        if (!state || typeof state !== 'object') return 0;
        return sessionDataRichness(state) + presetMetaRichness(state);
    }

    function sessionDataRichness(state) {
        if (!state || typeof state !== 'object') return 0;
        var n = 0;
        var byChat = state.byChat || {};
        Object.keys(byChat).forEach(function (chatId) {
            var bucket = byChat[chatId];
            if (!bucket || !Array.isArray(bucket.sessions)) return;
            bucket.sessions.forEach(function (sess) {
                n += countLiveMessages(sess);
                n += (sess.summaryList || []).length;
            });
        });
        return n;
    }

    function presetMetaRichness(state) {
        if (!state || typeof state !== 'object') return 0;
        var n = 0;
        n += (state.savedParamPresets || []).length * 3;
        n += Math.max(0, ((state.presets || []).length || 0) - 1);
        n += Object.keys(state.contactParams || {}).length;
        n += Object.keys(state.contactOpeningPresets || {}).length * 2;
        return n;
    }

    function finalizeByChat(byChat) {
        var rowMap = byChat && typeof byChat === 'object' ? byChat : {};
        Object.keys(rowMap).forEach(function (chatId) {
            var row = rowMap[chatId];
            if (!row || typeof row !== 'object') {
                delete rowMap[chatId];
                return;
            }
            row.sessions = Array.isArray(row.sessions) ? row.sessions.map(normalizeSession).filter(Boolean) : [];
            row.activeSessionId = String(row.activeSessionId || '').trim();
            row.sessions = row.sessions.filter(function (s) {
                return countLiveMessages(s) > 0;
            });
            if (
                row.activeSessionId &&
                !row.sessions.some(function (s) {
                    return s.id === row.activeSessionId;
                })
            ) {
                row.activeSessionId = '';
            }
        });
        return rowMap;
    }

    function buildStateFromParsed(parsed) {
        var d = defaultState();
        var presetDirty = false;
        if (parsed && typeof parsed === 'object') {
            d.version = Number(parsed.version) || 1;
            var presets = Array.isArray(parsed.presets) ? parsed.presets.map(normalizePreset).filter(Boolean) : [];
            if (!presets.some(function (p) { return p.id === BUILTIN_PRESET_ID; })) {
                presets.unshift(defaultBuiltinPreset());
            }
            d.presets = presets.map(function (p) {
                var merged = migrateLegacyPresetFields(mergeBuiltinDefaults(p));
                if (merged !== p) presetDirty = true;
                return merged;
            });
            d.contactPresetId =
                parsed.contactPresetId && typeof parsed.contactPresetId === 'object'
                    ? parsed.contactPresetId
                    : {};
            d.contactParams =
                parsed.contactParams && typeof parsed.contactParams === 'object'
                    ? parsed.contactParams
                    : {};
            d.contactWorldbook =
                parsed.contactWorldbook && typeof parsed.contactWorldbook === 'object'
                    ? parsed.contactWorldbook
                    : {};
            d.contactOpeningPresets =
                parsed.contactOpeningPresets && typeof parsed.contactOpeningPresets === 'object'
                    ? parsed.contactOpeningPresets
                    : {};
            d.savedParamPresets = Array.isArray(parsed.savedParamPresets)
                ? parsed.savedParamPresets.map(normalizeSavedParamPreset).filter(Boolean)
                : [];
            d.byChat = parsed.byChat && typeof parsed.byChat === 'object' ? parsed.byChat : {};
            d.beautify = normalizeBeautify(parsed.beautify);
            d.statusBar = normalizeStatusBar(parsed.statusBar);
            d.deletedSessionIds = normalizeDeletedSessionIds(parsed.deletedSessionIds);
        }
        d.byChat = finalizeByChat(d.byChat);
        return { state: d, presetDirty: presetDirty };
    }

    function filterTombstonedRecoveredByChat(byChat, tombstoneMap) {
        var tombs = tombstoneMap && typeof tombstoneMap === 'object' ? tombstoneMap : {};
        var out = {};
        var sessionCount = 0;
        var messageCount = 0;
        Object.keys(byChat || {}).forEach(function (chatId) {
            var src = byChat[chatId];
            if (!src || !Array.isArray(src.sessions)) return;
            var kept = src.sessions.filter(function (sess) {
                if (!sess || !sess.id) return false;
                if (tombs[String(sess.id)]) return false;
                return countLiveMessages(sess) > 0;
            });
            if (!kept.length) return;
            out[chatId] = {
                sessions: kept,
                activeSessionId: String(src.activeSessionId || '').trim()
            };
            kept.forEach(function (sess) {
                sessionCount += 1;
                messageCount += countLiveMessages(sess);
            });
        });
        if (!sessionCount) return null;
        return { byChat: out, sessionCount: sessionCount, messageCount: messageCount };
    }

    function currentTombstoneMap() {
        if (cache && cache.deletedSessionIds && typeof cache.deletedSessionIds === 'object') {
            return cache.deletedSessionIds;
        }
        return {};
    }

    function richestDiskTombstones(candidates) {
        var map = {};
        (candidates || []).forEach(function (row) {
            if (!row || typeof row !== 'object' || row.__fromMirror) return;
            var ids = normalizeDeletedSessionIds(row.deletedSessionIds);
            Object.keys(ids).forEach(function (sid) {
                var prev = Number(map[sid]) || 0;
                var next = Number(ids[sid]) || 0;
                if (next >= prev) map[sid] = next;
            });
        });
        return map;
    }

    function buildSessionFromMirrorMsgs(chatId, contactId, sessionId, msgs) {
        var sid = String(sessionId || '').trim() || uid('sess');
        var sorted = (msgs || []).slice().sort(function (a, b) {
            return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
        });
        if (!sorted.length) return null;
        var createdAt = Number(sorted[0].createdAt) || Date.now();
        var closedAt = Number(sorted[sorted.length - 1].createdAt) || createdAt;
        var normMsgs = sorted
            .map(function (m) {
                var ts = Number(m.createdAt) || createdAt;
                return normalizeMessage({
                    id: String(m.appointmentMsgId || m.id || '').trim() || uid('msg'),
                    role: m.role,
                    content: m.content,
                    createdAt: ts,
                    chatMirrorId: m.id,
                    renderAsHtml: !!m.renderAsHtml,
                    htmlRaw: m.htmlRaw || m.content,
                    type: m.type,
                    thinking: m.thinking
                });
            })
            .filter(Boolean);
        return normalizeSession({
            id: sid,
            chatId: chatId,
            contactId: contactId,
            createdAt: createdAt,
            closedAt: closedAt,
            title: '恢复 · ' + new Date(createdAt).toLocaleDateString('zh-CN'),
            messages: normMsgs,
            summaryList: []
        });
    }

    function recoverSessionsFromChatMirrors(tombstoneOverride) {
        var st = global.miyaChatStore;
        if (!st || typeof st.getMeta !== 'function') return null;
        var meta = st.getMeta();
        var messagesByChat = meta && meta.messagesByChat;
        if (!messagesByChat || typeof messagesByChat !== 'object') return null;
        try {
            load();
        } catch (e) {}
        var tombs =
            tombstoneOverride && typeof tombstoneOverride === 'object'
                ? tombstoneOverride
                : currentTombstoneMap();
        var mem = global.MiyaAppointmentMemory;
        var byChat = {};
        var sessionCount = 0;
        var messageCount = 0;
        var GAP_MS = 3 * 60 * 60 * 1000;
        Object.keys(messagesByChat).forEach(function (chatKey) {
            var chatId =
                mem && typeof mem.resolveCanonicalChatId === 'function'
                    ? mem.resolveCanonicalChatId(chatKey) || chatKey
                    : chatKey;
            var chat = st.findChat ? st.findChat(chatKey) : null;
            var contactId = chat && chat.contactId ? String(chat.contactId).trim() : '';
            var msgs = (messagesByChat[chatKey] || []).filter(function (m) {
                return m && m.offlineMeet && !m.deleted && String(m.content || '').trim();
            });
            if (!msgs.length) return;
            var explicitMap = Object.create(null);
            var noSid = [];
            msgs.forEach(function (m) {
                var sid = String(m.appointmentSessionId || '').trim();
                if (sid) {
                    if (!explicitMap[sid]) explicitMap[sid] = [];
                    explicitMap[sid].push(m);
                } else {
                    noSid.push(m);
                }
            });
            var sessions = [];
            Object.keys(explicitMap).forEach(function (sid) {
                var sess = buildSessionFromMirrorMsgs(chatId, contactId, sid, explicitMap[sid]);
                if (sess) sessions.push(sess);
            });
            noSid.sort(function (a, b) {
                return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
            });
            var block = [];
            noSid.forEach(function (m) {
                var ts = Number(m.createdAt) || Date.now();
                if (block.length) {
                    var prevTs = Number(block[block.length - 1].createdAt) || 0;
                    if (ts - prevTs > GAP_MS) {
                        var built = buildSessionFromMirrorMsgs(
                            chatId,
                            contactId,
                            'rec_' + chatId + '_' + String(Number(block[0].createdAt) || Date.now()),
                            block
                        );
                        if (built) sessions.push(built);
                        block = [];
                    }
                }
                block.push(m);
            });
            if (block.length) {
                var builtLast = buildSessionFromMirrorMsgs(
                    chatId,
                    contactId,
                    'rec_' + chatId + '_' + String(Number(block[0].createdAt) || Date.now()),
                    block
                );
                if (builtLast) sessions.push(builtLast);
            }
            sessions = sessions.filter(function (s) {
                return s && countLiveMessages(s) > 0;
            });
            if (!sessions.length) return;
            if (!byChat[chatId]) byChat[chatId] = { sessions: [], activeSessionId: '' };
            sessions.forEach(function (sess) {
                if (!sess || !sess.id || tombs[String(sess.id)]) return;
                byChat[chatId].sessions.push(sess);
                sessionCount += 1;
                messageCount += countLiveMessages(sess);
            });
        });
        if (!sessionCount) return null;
        return { byChat: byChat, sessionCount: sessionCount, messageCount: messageCount };
    }

    function countPendingMirrorRecovery(byChat) {
        load();
        var pendingSessions = 0;
        var pendingMessages = 0;
        var pendingChats = 0;
        Object.keys(byChat || {}).forEach(function (chatId) {
            var src = byChat[chatId];
            if (!src || !Array.isArray(src.sessions)) return;
            var chatPending = 0;
            src.sessions.forEach(function (sess) {
                var norm = normalizeSession(Object.assign({}, sess, { chatId: chatId }));
                if (!norm || countLiveMessages(norm) <= 0) return;
                if (isSessionTombstoned(norm.id)) return;
                var bucket = cache.byChat && cache.byChat[chatId];
                var existing =
                    bucket && Array.isArray(bucket.sessions)
                        ? bucket.sessions.find(function (s) {
                              return s && s.id === norm.id;
                          })
                        : null;
                if (existing) {
                    var ids = Object.create(null);
                    (existing.messages || []).forEach(function (m) {
                        if (m && m.id) ids[m.id] = true;
                    });
                    var added = 0;
                    (norm.messages || []).forEach(function (m) {
                        if (!m || !String(m.content || '').trim() || ids[m.id]) return;
                        added += 1;
                    });
                    if (added > 0) {
                        pendingMessages += added;
                        chatPending += 1;
                    }
                } else {
                    pendingSessions += 1;
                    pendingMessages += countLiveMessages(norm);
                    chatPending += 1;
                }
            });
            if (chatPending > 0) pendingChats += 1;
        });
        return { sessions: pendingSessions, messages: pendingMessages, chats: pendingChats };
    }

    function mergeRecoveredByChat(byChat) {
        load();
        var newSessions = 0;
        var newMessages = 0;
        var mergedSessions = 0;
        Object.keys(byChat || {}).forEach(function (chatId) {
            var src = byChat[chatId];
            if (!src || !Array.isArray(src.sessions)) return;
            var bucket = chatBucket(chatId);
            if (!bucket) return;
            src.sessions.forEach(function (sess) {
                var norm = normalizeSession(Object.assign({}, sess, { chatId: chatId }));
                if (!norm || countLiveMessages(norm) <= 0) return;
                if (isSessionTombstoned(norm.id)) return;
                var idx = bucket.sessions.findIndex(function (s) {
                    return s && s.id === norm.id;
                });
                if (idx >= 0) {
                    var ex = bucket.sessions[idx];
                    var ids = Object.create(null);
                    (ex.messages || []).forEach(function (m) {
                        if (m && m.id) ids[m.id] = true;
                    });
                    var added = 0;
                    (norm.messages || []).forEach(function (m) {
                        if (!m || !String(m.content || '').trim() || ids[m.id]) return;
                        ex.messages.push(m);
                        ids[m.id] = true;
                        added += 1;
                    });
                    if (added > 0) {
                        ex.messages.sort(function (a, b) {
                            return (a.createdAt || 0) - (b.createdAt || 0);
                        });
                        ex.closedAt = Math.max(Number(ex.closedAt) || 0, Number(norm.closedAt) || 0) || ex.closedAt;
                        if (!String(ex.contactId || '').trim() && norm.contactId) ex.contactId = norm.contactId;
                        bucket.sessions[idx] = normalizeSession(ex);
                        newMessages += added;
                        mergedSessions += 1;
                    }
                } else {
                    bucket.sessions.unshift(norm);
                    newSessions += 1;
                    newMessages += countLiveMessages(norm);
                }
            });
            bucket.sessions = bucket.sessions.filter(function (s) {
                return countLiveMessages(s) > 0;
            });
        });
        save();
        return {
            sessions: newSessions,
            messages: newMessages,
            mergedSessions: mergedSessions,
            totalSessions: newSessions + mergedSessions
        };
    }

    function previewChatMirrorRecovery() {
        var pack = recoverSessionsFromChatMirrors();
        if (!pack || !pack.byChat) return { sessions: 0, messages: 0, chats: 0 };
        return countPendingMirrorRecovery(pack.byChat);
    }

    function mirrorHydrationCandidate(recovered, tombstones) {
        if (!recovered || !recovered.byChat) return null;
        var filtered = filterTombstonedRecoveredByChat(recovered.byChat, tombstones);
        if (!filtered || !filtered.byChat) return null;
        return {
            version: 1,
            presets: [defaultBuiltinPreset()],
            contactPresetId: {},
            contactParams: {},
            contactWorldbook: {},
            contactOpeningPresets: {},
            savedParamPresets: [],
            beautify: defaultBeautify(),
            byChat: filtered.byChat,
            deletedSessionIds: normalizeDeletedSessionIds(tombstones),
            __fromMirror: true,
            __mirrorSessions: filtered.sessionCount
        };
    }

    function collectHydrationCandidates() {
        var read = global.miyaReadLsJsonKey;
        if (typeof read !== 'function') {
            var tombs0 = currentTombstoneMap();
            var recoveredOnly = recoverSessionsFromChatMirrors(tombs0);
            var onlyCand = mirrorHydrationCandidate(recoveredOnly, tombs0);
            return Promise.resolve({
                candidates: onlyCand ? [onlyCand] : [],
                mirrorSessions: onlyCand ? onlyCand.__mirrorSessions : 0
            });
        }
        return Promise.all([
            read(LS_KEY, null),
            read(LS_BACKUP_KEY, null),
            global.miyaWidgetKvIdbGet ? global.miyaWidgetKvIdbGet(LS_KEY) : Promise.resolve(null),
            global.miyaWidgetKvIdbGet ? global.miyaWidgetKvIdbGet(LS_BACKUP_KEY) : Promise.resolve(null)
        ]).then(function (rows) {
            var out = [];
            rows.forEach(function (row) {
                if (row && typeof row === 'object') out.push(row);
            });
            var diskScore = sessionDataRichness(pickRichestParsed(out));
            var tombs = richestDiskTombstones(out);
            if (!Object.keys(tombs).length) tombs = currentTombstoneMap();
            var recovered = recoverSessionsFromChatMirrors(tombs);
            var mirrorCand = diskScore === 0 ? mirrorHydrationCandidate(recovered, tombs) : null;
            var mirrorSessions = mirrorCand ? mirrorCand.__mirrorSessions : 0;
            if (mirrorCand) out.push(mirrorCand);
            return { candidates: out, mirrorSessions: mirrorSessions };
        }).catch(function () {
            var tombs = currentTombstoneMap();
            var recovered = recoverSessionsFromChatMirrors(tombs);
            var cand = mirrorHydrationCandidate(recovered, tombs);
            return {
                candidates: cand ? [cand] : [],
                mirrorSessions: cand ? cand.__mirrorSessions : 0
            };
        });
    }

    function pickRichestParsed(candidates) {
        var best = null;
        var bestScore = -1;
        (candidates || []).forEach(function (row) {
            if (!row || typeof row !== 'object') return;
            var score = stateRichness(row);
            if (score > bestScore) {
                bestScore = score;
                best = row;
            }
        });
        return best;
    }

    function applyParsedState(parsed, opts) {
        opts = opts || {};
        var built = buildStateFromParsed(parsed);
        cache = built.state;
        if (global.__miyaKvMem) global.__miyaKvMem[LS_KEY] = cache;
        if (built.presetDirty && _hydrated && !opts.skipSave) save();
        return cache;
    }

    /** 合并各候选墓碑，并从 byChat 剔除已删卷宗，避免旧备份把手动删除的剧情加回来 */
    function applyTombstonesToParsed(parsed, candidates) {
        if (!parsed || typeof parsed !== 'object') return parsed;
        var tombs = richestDiskTombstones(candidates);
        var selfTombs = normalizeDeletedSessionIds(parsed.deletedSessionIds);
        Object.keys(selfTombs).forEach(function (sid) {
            var prev = Number(tombs[sid]) || 0;
            var next = Number(selfTombs[sid]) || 0;
            if (next >= prev) tombs[sid] = next;
        });
        if (cache && cache.deletedSessionIds) {
            var live = normalizeDeletedSessionIds(cache.deletedSessionIds);
            Object.keys(live).forEach(function (sid) {
                var prev = Number(tombs[sid]) || 0;
                var next = Number(live[sid]) || 0;
                if (next >= prev) tombs[sid] = next;
            });
        }
        if (!Object.keys(tombs).length) return parsed;
        var next = Object.assign({}, parsed, { deletedSessionIds: tombs });
        if (next.byChat && typeof next.byChat === 'object') {
            var byChat = {};
            Object.keys(next.byChat).forEach(function (chatId) {
                var row = next.byChat[chatId];
                if (!row || typeof row !== 'object') return;
                var sessions = Array.isArray(row.sessions)
                    ? row.sessions.filter(function (s) {
                          return s && s.id && !tombs[String(s.id)];
                      })
                    : [];
                byChat[chatId] = Object.assign({}, row, { sessions: sessions });
            });
            next.byChat = byChat;
        }
        return next;
    }

    function ensureHydrated() {
        if (_hydrated) return Promise.resolve(cache || load());
        if (_hydratePromise) return _hydratePromise;
        var chatBoot = Promise.resolve();
        if (global.miyaChatStore && typeof global.miyaChatStore.init === 'function') {
            chatBoot = global.miyaChatStore.init().catch(function () {});
        }
        _hydratePromise = chatBoot
            .then(function () {
                return collectHydrationCandidates();
            })
            .then(function (pack) {
                var candidates = pack && pack.candidates ? pack.candidates : [];
                var mirrorSessions = pack && pack.mirrorSessions ? pack.mirrorSessions : 0;
                var best = applyTombstonesToParsed(pickRichestParsed(candidates), candidates);
                var currentScore = cache ? stateRichness(cache) : 0;
                var bestScore = stateRichness(best);
                if (best && bestScore >= currentScore) {
                    applyParsedState(best, { skipSave: true });
                } else if (!cache) {
                    applyParsedState(null, { skipSave: true });
                } else if (cache) {
                    /* 即便未采用更富候选，也要保留已收集的墓碑 */
                    var tombs = richestDiskTombstones(candidates);
                    if (Object.keys(tombs).length) {
                        cache.deletedSessionIds = Object.assign(
                            {},
                            normalizeDeletedSessionIds(cache.deletedSessionIds),
                            tombs
                        );
                        Object.keys(cache.byChat || {}).forEach(function (chatId) {
                            var bucket = cache.byChat[chatId];
                            if (!bucket || !Array.isArray(bucket.sessions)) return;
                            bucket.sessions = bucket.sessions.filter(function (s) {
                                return s && s.id && !cache.deletedSessionIds[String(s.id)];
                            });
                        });
                    }
                }
                _hydrated = true;
                _hydratePromise = null;
                if (bestScore > 0 && bestScore > currentScore) {
                    if (best && best.__fromMirror && mirrorSessions > 0) {
                        _lastRecoveryInfo = { sessions: mirrorSessions, from: 'mirror' };
                    } else if (currentScore === 0) {
                        _lastRecoveryInfo = { sessions: bestScore, from: 'backup' };
                    }
                    flushSave();
                }
                return cache;
            })
            .catch(function () {
                if (!cache) applyParsedState(null, { skipSave: true });
                _hydrated = true;
                _hydratePromise = null;
                return cache;
            });
        return _hydratePromise;
    }

    function load() {
        if (cache && (_hydrated || !needsAsyncHydrate())) return cache;
        var parsed = null;
        if (typeof global.miyaSyncReadJsonKey === 'function') {
            parsed = global.miyaSyncReadJsonKey(LS_KEY);
        }
        try {
            if (!parsed) {
                var raw = localStorage.getItem(LS_KEY);
                if (raw && !(global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw))) {
                    parsed = JSON.parse(raw);
                }
            }
        } catch (e) {}
        if (parsed && typeof parsed === 'object') {
            _hydrated = true;
            return applyParsedState(parsed);
        }
        if (needsAsyncHydrate()) {
            if (!cache) applyParsedState(null, { skipSave: true });
            ensureHydrated();
            return cache;
        }
        _hydrated = true;
        return applyParsedState(null);
    }

    function saveNow() {
        if (!cache) load();
        if (!_hydrated && needsAsyncHydrate()) return cache;
        if (typeof global.miyaSyncFlushJsonKey === 'function') {
            global.miyaSyncFlushJsonKey(LS_KEY, cache);
            if (stateRichness(cache) > 0) {
                global.miyaSyncFlushJsonKey(LS_BACKUP_KEY, cache);
            }
            return cache;
        }
        if (typeof global.miyaWriteLsJsonKey === 'function') {
            global.miyaWriteLsJsonKey(LS_KEY, cache).catch(function () {});
            if (stateRichness(cache) > 0) {
                global.miyaWriteLsJsonKey(LS_BACKUP_KEY, cache).catch(function () {});
            }
            return cache;
        }
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(cache));
            if (stateRichness(cache) > 0) {
                localStorage.setItem(LS_BACKUP_KEY, JSON.stringify(cache));
            }
        } catch (e) {}
        return cache;
    }

    function scheduleSave() {
        if (_saveTimer) return;
        _saveTimer = setTimeout(function () {
            _saveTimer = 0;
            saveNow();
        }, SAVE_DEBOUNCE_MS);
    }

    function flushSave() {
        if (_saveTimer) {
            clearTimeout(_saveTimer);
            _saveTimer = 0;
        }
        return saveNow();
    }

    /** 热路径默认防抖；封存/迁移等关键路径传 { force: true } */
    function save(opts) {
        if (opts && opts.force) return flushSave();
        scheduleSave();
        return cache;
    }

    function chatBucket(chatId) {
        load();
        var id = String(chatId || '').trim();
        if (!id) return null;
        if (!cache.byChat[id]) {
            cache.byChat[id] = { sessions: [], activeSessionId: '' };
        }
        return cache.byChat[id];
    }

    function lastSummaryEnd(session) {
        var mx = 0;
        (session.summaryList || []).forEach(function (row) {
            var e = clampInt(row && row.endIndex, 0, 9999999, 0);
            if (e > mx) mx = e;
        });
        return mx;
    }

    function summaryRangesOverlap(aStart, aEnd, bStart, bEnd) {
        var s1 = clampInt(aStart, 0, 9999999, 0);
        var e1 = clampInt(aEnd, 0, 9999999, 0);
        var s2 = clampInt(bStart, 0, 9999999, 0);
        var e2 = clampInt(bEnd, 0, 9999999, 0);
        if (!s1 || !e1 || !s2 || !e2) return false;
        return !(e1 < s2 || e2 < s1);
    }

    function countLiveMessages(session) {
        return (session && session.messages ? session.messages : []).filter(function (m) {
            return m && !m.deleted && String(m.content || '').trim();
        }).length;
    }

    var store = {
        BUILTIN_PRESET_ID: BUILTIN_PRESET_ID,
        load: load,
        save: save,
        whenReady: ensureHydrated,
        recoverFromChatMirrors: recoverSessionsFromChatMirrors,
        previewChatMirrorRecovery: previewChatMirrorRecovery,
        restoreFromChatMirrors: function () {
            var chatBoot = Promise.resolve();
            if (global.miyaChatStore && typeof global.miyaChatStore.init === 'function') {
                chatBoot = global.miyaChatStore.init().catch(function () {});
            }
            return chatBoot.then(function () {
                var recovered = recoverSessionsFromChatMirrors();
                if (!recovered || !recovered.byChat) {
                    return { ok: false, reason: 'no_mirror', sessions: 0, messages: 0 };
                }
                var pending = countPendingMirrorRecovery(recovered.byChat);
                if (!pending.sessions && !pending.messages) {
                    return { ok: false, reason: 'already_up_to_date', sessions: 0, messages: 0 };
                }
                var result = mergeRecoveredByChat(recovered.byChat);
                var ok = result.totalSessions > 0 || result.messages > 0;
                return {
                    ok: ok,
                    reason: ok ? 'restored' : 'already_up_to_date',
                    sessions: result.totalSessions,
                    newSessions: result.sessions,
                    mergedSessions: result.mergedSessions,
                    messages: result.messages
                };
            });
        },
        consumeRecoveryInfo: function () {
            var info = _lastRecoveryInfo;
            _lastRecoveryInfo = null;
            return info;
        },
        getState: function () {
            return load();
        },
        getPresets: function () {
            return load().presets.slice();
        },
        getPreset: function (presetId) {
            var id = String(presetId || '').trim();
            return load().presets.find(function (p) { return p.id === id; }) || null;
        },
        getBuiltinPreset: function () {
            return mergeBuiltinDefaults(store.getPreset(BUILTIN_PRESET_ID) || defaultBuiltinPreset());
        },
        upsertPreset: function (patch) {
            load();
            var row = normalizePreset(patch);
            if (!row) return null;
            var idx = cache.presets.findIndex(function (p) { return p.id === row.id; });
            if (idx >= 0) {
                if (cache.presets[idx].builtin && row.id === BUILTIN_PRESET_ID) {
                    row.builtin = true;
                }
                cache.presets[idx] = Object.assign({}, cache.presets[idx], row, { updatedAt: Date.now() });
            } else {
                cache.presets.push(row);
            }
            save();
            return store.getPreset(row.id);
        },
        deletePreset: function (presetId) {
            var id = String(presetId || '').trim();
            if (!id || id === BUILTIN_PRESET_ID) return false;
            load();
            var before = cache.presets.length;
            cache.presets = cache.presets.filter(function (p) { return p.id !== id; });
            Object.keys(cache.contactPresetId).forEach(function (cid) {
                if (cache.contactPresetId[cid] === id) delete cache.contactPresetId[cid];
            });
            save();
            return cache.presets.length < before;
        },
        getContactPresetId: function (contactId) {
            var cid = String(contactId || '').trim();
            if (!cid) return BUILTIN_PRESET_ID;
            load();
            return cache.contactPresetId[cid] || BUILTIN_PRESET_ID;
        },
        setContactPresetId: function (contactId, presetId) {
            var cid = String(contactId || '').trim();
            var pid = String(presetId || '').trim();
            if (!cid || !pid) return;
            load();
            cache.contactPresetId[cid] = pid;
            save();
        },
        resolvePresetForContact: function (contactId) {
            var cid = String(contactId || '').trim();
            load();
            var base = store.getBuiltinPreset();
            var merged = Object.assign({}, base);
            if (cid && cache.contactParams[cid]) {
                var cp = normalizeContactParams(cache.contactParams[cid]);
                if (cp) merged = Object.assign(merged, cp);
            }
            if (cid && cache.contactWorldbook[cid]) {
                merged.worldbookBindings = normalizeBindings(cache.contactWorldbook[cid]);
            }
            merged.id = base.id;
            merged.name = base.name;
            merged.builtin = true;
            return merged;
        },
        getContactParams: function (contactId) {
            var cid = String(contactId || '').trim();
            if (!cid) return null;
            load();
            return normalizeContactParams(cache.contactParams[cid]);
        },
        saveContactParams: function (contactId, params) {
            var cid = String(contactId || '').trim();
            if (!cid) return null;
            load();
            var row = normalizeContactParams(params);
            if (!row) return null;
            cache.contactParams[cid] = row;
            save();
            return row;
        },
        getContactWorldbook: function (contactId) {
            var cid = String(contactId || '').trim();
            if (!cid) return [];
            load();
            return normalizeBindings(cache.contactWorldbook[cid]);
        },
        saveContactWorldbook: function (contactId, bindings) {
            var cid = String(contactId || '').trim();
            if (!cid) return [];
            load();
            var rows = normalizeBindings(bindings);
            cache.contactWorldbook[cid] = rows;
            save();
            return rows;
        },
        getContactOpeningPresets: function (contactId) {
            var cid = String(contactId || '').trim();
            if (!cid) return [];
            load();
            var rows = cache.contactOpeningPresets && cache.contactOpeningPresets[cid];
            if (!Array.isArray(rows)) return [];
            return rows
                .map(normalizeOpeningPreset)
                .filter(Boolean)
                .sort(function (a, b) {
                    return (b.updatedAt || 0) - (a.updatedAt || 0);
                });
        },
        upsertContactOpeningPreset: function (contactId, patch) {
            var cid = String(contactId || '').trim();
            if (!cid) return null;
            load();
            var row = normalizeOpeningPreset(patch);
            if (!row) return null;
            if (!cache.contactOpeningPresets) cache.contactOpeningPresets = {};
            if (!Array.isArray(cache.contactOpeningPresets[cid])) cache.contactOpeningPresets[cid] = [];
            var idx = cache.contactOpeningPresets[cid].findIndex(function (p) {
                return p.id === row.id;
            });
            if (idx >= 0) {
                cache.contactOpeningPresets[cid][idx] = Object.assign({}, cache.contactOpeningPresets[cid][idx], row, {
                    updatedAt: Date.now()
                });
            } else {
                cache.contactOpeningPresets[cid].push(row);
            }
            save();
            return cache.contactOpeningPresets[cid].find(function (p) {
                return p.id === row.id;
            });
        },
        deleteContactOpeningPreset: function (contactId, presetId) {
            var cid = String(contactId || '').trim();
            var pid = String(presetId || '').trim();
            if (!cid || !pid) return false;
            load();
            if (!cache.contactOpeningPresets || !Array.isArray(cache.contactOpeningPresets[cid])) return false;
            var before = cache.contactOpeningPresets[cid].length;
            cache.contactOpeningPresets[cid] = cache.contactOpeningPresets[cid].filter(function (p) {
                return p && p.id !== pid;
            });
            save();
            return cache.contactOpeningPresets[cid].length < before;
        },
        getSessionOpeningMessage: function (chatId, sessionId) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return null;
            return (sess.messages || []).find(function (m) {
                return m && !m.deleted && isOpeningMessage(m);
            }) || null;
        },
        setSessionOpeningMessage: function (chatId, sessionId, fields) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return null;
            (sess.messages || []).forEach(function (m) {
                if (m && !m.deleted && isOpeningMessage(m)) {
                    store.deleteMessage(chatId, sessionId, m.id);
                }
            });
            var content = String((fields && fields.content) || '').trim();
            if (!content) return null;
            return store.addMessage(chatId, sessionId, {
                role: 'system',
                type: 'opening',
                content: content,
                openingPresetId: fields && fields.openingPresetId ? String(fields.openingPresetId).trim() : ''
            });
        },
        getSavedParamPresets: function () {
            load();
            return (cache.savedParamPresets || []).slice().sort(function (a, b) {
                return (b.updatedAt || 0) - (a.updatedAt || 0);
            });
        },
        upsertSavedParamPreset: function (patch) {
            load();
            var row = normalizeSavedParamPreset(patch);
            if (!row) return null;
            var idx = cache.savedParamPresets.findIndex(function (p) {
                return p.id === row.id;
            });
            if (idx >= 0) {
                cache.savedParamPresets[idx] = Object.assign({}, cache.savedParamPresets[idx], row, {
                    updatedAt: Date.now()
                });
            } else {
                cache.savedParamPresets.push(row);
            }
            save();
            return cache.savedParamPresets.find(function (p) {
                return p.id === row.id;
            });
        },
        deleteSavedParamPreset: function (presetId) {
            var id = String(presetId || '').trim();
            if (!id) return false;
            load();
            var before = cache.savedParamPresets.length;
            cache.savedParamPresets = cache.savedParamPresets.filter(function (p) {
                return p.id !== id;
            });
            save();
            return cache.savedParamPresets.length < before;
        },
        getBeautify: function () {
            return normalizeBeautify(load().beautify);
        },
        saveBeautify: function (patch) {
            load();
            cache.beautify = normalizeBeautify(Object.assign({}, cache.beautify, patch || {}));
            save();
            return cache.beautify;
        },
        getSessions: function (chatId) {
            var b = chatBucket(chatId);
            if (!b) return [];
            return b.sessions
                .filter(function (s) {
                    return countLiveMessages(s) > 0;
                })
                .slice()
                .sort(function (a, b2) {
                    return (b2.createdAt || 0) - (a.createdAt || 0);
                });
        },
        getSession: function (chatId, sessionId) {
            var b = chatBucket(chatId);
            if (!b) return null;
            var sid = String(sessionId || '').trim();
            return b.sessions.find(function (s) { return s.id === sid; }) || null;
        },
        getActiveSession: function (chatId) {
            var b = chatBucket(chatId);
            if (!b || !b.activeSessionId) return null;
            var sess = store.getSession(chatId, b.activeSessionId);
            if (!sess || sess.closedAt) return null;
            return sess;
        },
        /** 出演名单指纹（与顺序无关），用于续上未封存场次 */
        castContactKey: function (castOpt, fallbackContactId, fallbackChatId) {
            return normalizeCast(castOpt, fallbackContactId, fallbackChatId)
                .map(function (row) {
                    return row.contactId;
                })
                .sort()
                .join('\0');
        },
        /**
         * 按出演名单找回未封存场次：优先有正文的，其次当前激活，再取最近一场。
         * 多人/单人均适用；找回后会重新标为 active。
         */
        findResumableSessionByCast: function (castOpt) {
            var want = store.castContactKey(castOpt);
            if (!want) return null;
            load();
            var best = null;
            var bestScore = -1;
            Object.keys(cache.byChat || {}).forEach(function (chatKey) {
                var b = cache.byChat[chatKey];
                if (!b || !Array.isArray(b.sessions)) return;
                b.sessions.forEach(function (sess) {
                    if (!sess || sess.closedAt) return;
                    var key = store.castContactKey(
                        sess.cast,
                        sess.contactId,
                        sess.chatId || chatKey
                    );
                    if (key !== want) return;
                    var live = countLiveMessages(sess);
                    var isActive = !!(b.activeSessionId && b.activeSessionId === sess.id);
                    /* 有正文 >> 激活空场 >> 创建时间 */
                    var score =
                        live * 1e9 + (isActive ? 1e6 : 0) + (Number(sess.createdAt) || 0);
                    if (score > bestScore) {
                        bestScore = score;
                        best = sess;
                    }
                });
            });
            if (!best) return null;
            var hostId = String(best.chatId || '').trim();
            if (!hostId) return best;
            var host = chatBucket(hostId);
            if (host && host.activeSessionId !== best.id) {
                host.activeSessionId = best.id;
                flushSave();
            }
            return best;
        },
        startNewSession: function (chatId, contactId, castOpt) {
            var b = chatBucket(chatId);
            if (!b) return null;
            b.sessions = b.sessions.filter(function (s) {
                return countLiveMessages(s) > 0;
            });
            b.activeSessionId = '';
            var cast = normalizeCast(castOpt, contactId, chatId);
            var sess = normalizeSession({
                id: uid('sess'),
                chatId: chatId,
                contactId: contactId,
                cast: cast,
                createdAt: Date.now(),
                messages: [],
                summaryList: [],
                statusLog: []
            });
            b.sessions.unshift(sess);
            b.activeSessionId = sess.id;
            save();
            return sess;
        },
        _writeSession: function (session) {
            if (!session || !session.chatId) return;
            var b = chatBucket(session.chatId);
            if (!b) return;
            var idx = b.sessions.findIndex(function (s) { return s.id === session.id; });
            /* 热路径：已是 cache 内同一引用时跳过整表 remap，只防抖落盘 */
            if (idx >= 0 && b.sessions[idx] === session) {
                save();
                return;
            }
            var norm = normalizeSession(session);
            if (!norm) return;
            if (idx >= 0) b.sessions[idx] = norm;
            else b.sessions.unshift(norm);
            save();
        },
        setSessionTitle: function (chatId, sessionId, title) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return null;
            sess.title = String(title || '').trim();
            store._writeSession(sess);
            return sess;
        },
        addMessage: function (chatId, sessionId, fields) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return null;
            var msg = normalizeMessage(
                Object.assign({ id: uid('msg'), createdAt: Date.now() }, fields || {})
            );
            if (!msg || !String(msg.content || '').trim()) return null;
            sess.messages.push(msg);
            mirrorMessageToCast(sess, msg, { deferSessionWrite: true });
            store._writeSession(sess);
            return msg;
        },
        updateMessage: function (chatId, sessionId, messageId, patch) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return null;
            var idx = sess.messages.findIndex(function (m) { return m.id === messageId; });
            if (idx < 0) return null;
            sess.messages[idx] = normalizeMessage(
                Object.assign({}, sess.messages[idx], patch || {}, { editedAt: Date.now() })
            );
            store._writeSession(sess);
            var st = global.miyaChatStore;
            var mid = sess.messages[idx].chatMirrorId;
            if (st && mid && st.updateMessage) {
                st.updateMessage(chatId, mid, {
                    content: sess.messages[idx].content,
                    edited: true,
                    editedAt: Date.now()
                }).catch(function () {});
            }
            return sess.messages[idx];
        },
        deleteMessage: function (chatId, sessionId, messageId) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return null;
            var row = (sess.messages || []).find(function (m) { return m.id === messageId; });
            if (row) purgeMessageOnlineMirrors(chatId, row);
            return store.updateMessage(chatId, sessionId, messageId, { deleted: true, content: '' });
        },
        syncAllSessionsToChat: function (chatId, contactId) {
            var cid = String(contactId || '').trim();
            var sessions = cid ? store.getSessionsByContact(cid) : store.getSessions(chatId);
            var st = global.miyaChatStore;
            sessions.forEach(function (sess) {
                var targets = sessionCastTargets(sess);
                if (!targets.length) {
                    targets = [{ contactId: cid, chatId: chatId }];
                }
                targets.forEach(function (t) {
                    var tid = String((t && t.chatId) || '').trim();
                    if (!tid) return;
                    var knownMirrors = Object.create(null);
                    if (st && typeof st.getMessagesForApi === 'function') {
                        var apiMsgs = st.getMessagesForApi(tid) || [];
                        for (var i = 0; i < apiMsgs.length; i++) {
                            var row = apiMsgs[i];
                            if (row && row.id && row.offlineMeet && !row.deleted) {
                                knownMirrors[row.id] = row;
                            }
                        }
                    }
                    (sess.messages || []).forEach(function (m) {
                        mirrorMessageToChat(tid, sess, m, {
                            knownMirrors: knownMirrors,
                            targetChatId: tid
                        });
                    });
                });
            });
            flushSave();
        },
        /** 封存后：把本场消息镜像到每一位出演角色的线上线程 */
        syncSessionCastToChats: function (chatId, sessionId) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return;
            var st = global.miyaChatStore;
            var targets = sessionCastTargets(sess);
            targets.forEach(function (t) {
                var tid = String((t && t.chatId) || '').trim();
                if (!tid) return;
                var knownMirrors = Object.create(null);
                if (st && typeof st.getMessagesForApi === 'function') {
                    var apiMsgs = st.getMessagesForApi(tid) || [];
                    for (var i = 0; i < apiMsgs.length; i++) {
                        var row = apiMsgs[i];
                        if (row && row.id && row.offlineMeet && !row.deleted) {
                            knownMirrors[row.id] = row;
                        }
                    }
                }
                (sess.messages || []).forEach(function (m) {
                    mirrorMessageToChat(tid, sess, m, {
                        knownMirrors: knownMirrors,
                        targetChatId: tid
                    });
                });
            });
            flushSave();
            return targets;
        },
        getSessionCastTargets: sessionCastTargets,
        getStatusBar: function () {
            return normalizeStatusBar(load().statusBar);
        },
        saveStatusBar: function (patch) {
            load();
            cache.statusBar = normalizeStatusBar(Object.assign({}, cache.statusBar, patch || {}));
            save();
            return cache.statusBar;
        },
        getSessionMessages: function (chatId, sessionId) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return [];
            return (sess.messages || []).filter(function (m) {
                return m && !m.deleted && String(m.content || '').trim();
            });
        },
        addSummary: function (chatId, sessionId, row) {
            return store.replaceOrAddSummary(chatId, sessionId, row);
        },
        /** 同范围总结会替换/合并，供手动与自动总结写入该时刻上下文 */
        replaceOrAddSummary: function (chatId, sessionId, row) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return null;
            var patch = row && typeof row === 'object' ? row : {};
            var start = clampInt(patch.startIndex, 1, 9999999, 0);
            var end = clampInt(patch.endIndex, 1, 9999999, 0);
            if (!start || !end || end < start) return null;
            var keepId = String(patch.id || '').trim();
            sess.summaryList = (sess.summaryList || []).filter(function (r) {
                if (!r) return false;
                if (keepId && r.id === keepId) return false;
                return !summaryRangesOverlap(r.startIndex, r.endIndex, start, end);
            });
            var sum = normalizeSummary(
                Object.assign(
                    { id: keepId || uid('sum'), createdAt: Date.now() },
                    patch,
                    { startIndex: start, endIndex: end }
                )
            );
            if (!sum) return null;
            sess.summaryList.push(sum);
            store._writeSession(sess);
            return sum;
        },
        updateSummary: function (chatId, sessionId, summaryId, patch) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return null;
            var idx = (sess.summaryList || []).findIndex(function (r) {
                return r.id === summaryId;
            });
            if (idx < 0) return null;
            sess.summaryList[idx] = normalizeSummary(
                Object.assign({}, sess.summaryList[idx], patch || {}, { editedAt: Date.now() })
            );
            store._writeSession(sess);
            return sess.summaryList[idx];
        },
        deleteSummary: function (chatId, sessionId, summaryId) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return false;
            var before = (sess.summaryList || []).length;
            sess.summaryList = (sess.summaryList || []).filter(function (r) {
                return r.id !== summaryId;
            });
            if (sess.summaryList.length === before) return false;
            store._writeSession(sess);
            return true;
        },
        getSessionSummaries: function (chatId, sessionId) {
            var sess = store.getSession(chatId, sessionId);
            if (!sess) return [];
            return (sess.summaryList || []).slice().sort(function (a, b) {
                return (a.endIndex || 0) - (b.endIndex || 0);
            });
        },
        lastSummaryEnd: lastSummaryEnd,
        deleteSession: function (chatId, sessionId) {
            var sid = String(sessionId || '').trim();
            if (!sid) return;
            var sess = store.getSession(chatId, sid);
            if (!sess) {
                /* 宿主桶找不到时仍按 id 扫全库镜像，避免多人/迁移残留 */
                sess = { id: sid, chatId: chatId, messages: [] };
            }
            /* 彻底删除：线下卷宗 + 线上镜像一并清掉，不再注入上下文 */
            purgeSessionOnlineMirrors(sess);
            load();
            Object.keys(cache.byChat || {}).forEach(function (key) {
                var bucket = cache.byChat[key];
                if (!bucket || !Array.isArray(bucket.sessions)) return;
                bucket.sessions = bucket.sessions.filter(function (s) { return !s || s.id !== sid; });
                if (bucket.activeSessionId === sid) bucket.activeSessionId = '';
            });
            markSessionTombstone(sid);
            save();
        },
        setActiveSession: function (chatId, sessionId) {
            var b = chatBucket(chatId);
            if (!b) return;
            b.activeSessionId = String(sessionId || '').trim();
            save();
        },
        countLiveMessages: countLiveMessages,
        getSessionsByContact: function (contactId) {
            var cid = String(contactId || '').trim();
            if (!cid) return [];
            load();
            var st = global.miyaChatStore;
            var all = [];
            Object.keys(cache.byChat).forEach(function (chatKey) {
                var bucket = cache.byChat[chatKey];
                if (!bucket || !Array.isArray(bucket.sessions)) return;
                bucket.sessions.forEach(function (sess) {
                    if (!sess || countLiveMessages(sess) <= 0) return;
                    var sessCid = String(sess.contactId || '').trim();
                    if (sessCid === cid) {
                        all.push(sess);
                        return;
                    }
                    var cast = Array.isArray(sess.cast) ? sess.cast : [];
                    var inCast = cast.some(function (row) {
                        return row && String(row.contactId || '').trim() === cid;
                    });
                    if (inCast) {
                        all.push(sess);
                        return;
                    }
                    if (!sessCid && st && sess.chatId) {
                        var chat = st.findChat(sess.chatId);
                        if (chat && String(chat.contactId || '').trim() === cid) {
                            all.push(sess);
                        }
                    }
                });
            });
            return all.slice().sort(function (a, b) {
                return (b.createdAt || 0) - (a.createdAt || 0);
            });
        },
        migrateSessionsToCanonicalChat: function (canonicalChatId, contactId) {
            var canonId = String(canonicalChatId || '').trim();
            var cid = String(contactId || '').trim();
            if (!canonId || !cid) return;
            load();
            var canonical = chatBucket(canonId);
            if (!canonical) return;
            var moved = false;
            Object.keys(cache.byChat).forEach(function (chatKey) {
                if (chatKey === canonId) return;
                var bucket = cache.byChat[chatKey];
                if (!bucket || !Array.isArray(bucket.sessions)) return;
                var keep = [];
                bucket.sessions.forEach(function (sess) {
                    if (sess && String(sess.contactId || '').trim() === cid) {
                        sess.chatId = canonId;
                        /* 旧线程上的 mirror id 对 canonical 无效，清空以便 sync 重写镜像 */
                        (sess.messages || []).forEach(function (m) {
                            if (m && m.chatMirrorId) m.chatMirrorId = '';
                        });
                        canonical.sessions.push(sess);
                        moved = true;
                    } else {
                        keep.push(sess);
                    }
                });
                bucket.sessions = keep;
            });
            if (moved) {
                flushSave();
                store.syncAllSessionsToChat(canonId, cid);
            }
        },
        exportForMemory: function (chatId, contactIdHint) {
            var contactId = String(contactIdHint || '').trim();
            var st = global.miyaChatStore;
            if (!contactId && st && chatId) {
                var chat = st.findChat(chatId);
                contactId = chat && chat.contactId ? String(chat.contactId).trim() : '';
            }
            var sessions = contactId ? store.getSessionsByContact(contactId) : store.getSessions(chatId);
            return sessions.map(function (sess) {
                return {
                    id: sess.id,
                    createdAt: sess.createdAt,
                    closedAt: sess.closedAt,
                    contactId: sess.contactId || contactId,
                    messages: (sess.messages || []).filter(function (m) { return m && !m.deleted; }),
                    summaryList: sess.summaryList || []
                };
            });
        },
        closeActiveSession: function (chatId) {
            var b = chatBucket(chatId);
            if (!b || !b.activeSessionId) return null;
            var sess = store.getSession(chatId, b.activeSessionId);
            if (!sess || sess.closedAt || countLiveMessages(sess) <= 0) {
                if (sess && sess.closedAt) b.activeSessionId = '';
                flushSave();
                return sess;
            }
            sess.closedAt = Date.now();
            store._writeSession(sess);
            b.activeSessionId = '';
            flushSave();
            return sess;
        },
        flushSave: flushSave,
        invalidateCache: function () { cache = null; }
    };

    global.MiyaAppointmentStore = store;

    if (global.miyaRegisterPagehideFlush) {
        global.miyaRegisterPagehideFlush(function (opts) {
            if (!(cache && _hydrated)) return;
            if (opts && opts.urgent === false) {
                scheduleSave();
                return;
            }
            flushSave();
        });
    }

    if (global.miyaRegisterKvStore) {
        global.miyaRegisterKvStore({
            whenReady: ensureHydrated
        });
    }
})(window);
