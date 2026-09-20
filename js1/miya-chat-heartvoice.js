(function (global) {
    'use strict';

    var HEART_VOICE_LOG_MAX = 100;
    var PANEL_BOUND = '4';
    var panelEl = null;
    var closeTimer = null;
    var state = {
        chatId: null,
        entryId: null,
        avatarUrl: '',
        userAvatarUrl: '',
        paintGen: 0
    };

    function setRoomHvOpen(on) {
        var room = $('qq-room');
        if (room) room.classList.toggle('qq-room--hv-open', !!on);
    }

    function $(id) {
        return document.getElementById(id);
    }

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getStore() {
        return global.miyaChatStore || null;
    }

    function avatarFallback(name) {
        var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
        return (
            'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">' +
                    '<rect width="120" height="120" rx="4" fill="#EDE8E0"/>' +
                    '<text x="60" y="72" text-anchor="middle" font-family="Georgia,serif" font-size="42" fill="#7A7268">' +
                    ch +
                    '</text></svg>'
            )
        );
    }

    function findArchiveAvatar(contact) {
        if (!contact) return '';
        var cs = global.miyaContactsStore;
        if (!cs || typeof cs.findCharacter !== 'function') return '';
        try {
            var chronicleId = String(contact.chronicleId || '').trim();
            var characterId = String(contact.characterId || '').trim();
            var row =
                (chronicleId && cs.findCharacter(chronicleId)) ||
                (characterId && cs.findCharacter(characterId)) ||
                null;
            return row && row.avatar ? String(row.avatar).trim() : '';
        } catch (e) {
            return '';
        }
    }

    function resolveCharAvatarForChat(chatId, preferredUrl) {
        var preferred = String(preferredUrl || '').trim();
        if (preferred) return Promise.resolve(preferred);
        var store = getStore();
        if (!store || !chatId) return Promise.resolve(avatarFallback('TA'));
        var chat = store.findChat(chatId);
        var contact = chat && chat.contactId ? store.findContact(chat.contactId) : null;
        var name =
            (contact && (contact.remarkName || contact.name)) ||
            (chat && chat.title) ||
            'TA';
        var fallback = avatarFallback(name);
        if (!contact) return Promise.resolve(fallback);

        if (store.resolveContactDisplayAvatarSync) {
            var sync = store.resolveContactDisplayAvatarSync(contact);
            if (sync) return Promise.resolve(sync);
        }
        if (
            store.hasContactDisplayAvatarOverride &&
            store.hasContactDisplayAvatarOverride(contact) &&
            store.resolveContactDisplayAvatarAsync
        ) {
            return store.resolveContactDisplayAvatarAsync(contact).then(function (url) {
                return url || String(contact.avatar || '').trim() || findArchiveAvatar(contact) || fallback;
            });
        }
        var direct = String(contact.avatar || '').trim();
        if (direct) return Promise.resolve(direct);
        var archive = findArchiveAvatar(contact);
        if (archive) return Promise.resolve(archive);
        var blobId = String(contact.avatarBlobId || '').trim();
        if (blobId && store.getAvatarUrl) {
            return store.getAvatarUrl(blobId).then(function (url) {
                return url || fallback;
            }).catch(function () {
                return fallback;
            });
        }
        return Promise.resolve(fallback);
    }

    function resolveUserAvatarForChat(chatId) {
        var store = getStore();
        if (!store) return Promise.resolve(avatarFallback('我'));
        var chat = chatId ? store.findChat(chatId) : null;
        var profile = null;
        if (chat && chat.profileId && store.getProfiles) {
            var list = store.getProfiles() || [];
            var i;
            for (i = 0; i < list.length; i++) {
                if (list[i] && String(list[i].id) === String(chat.profileId)) {
                    profile = list[i];
                    break;
                }
            }
        }
        if (!profile && store.getActiveProfile) profile = store.getActiveProfile();
        var name = (profile && profile.name) || '我';
        var fallback = avatarFallback(name);
        if (!profile) return Promise.resolve(fallback);

        if (store.resolveProfileDisplayAvatarSync) {
            var sync = store.resolveProfileDisplayAvatarSync(profile);
            if (sync) return Promise.resolve(sync);
        }
        if (
            store.hasProfileDisplayAvatarOverride &&
            store.hasProfileDisplayAvatarOverride(profile) &&
            store.resolveProfileDisplayAvatarAsync
        ) {
            return store.resolveProfileDisplayAvatarAsync(profile).then(function (url) {
                return url || fallback;
            });
        }
        var direct = String(profile.avatarUrl || profile.avatar || '').trim();
        if (direct && direct.indexOf('blob:') !== 0) return Promise.resolve(direct);
        if (profile.avatarId && store.getAvatarUrl) {
            return store.getAvatarUrl(profile.avatarId).then(function (url) {
                return url || fallback;
            }).catch(function () {
                return fallback;
            });
        }
        return Promise.resolve(fallback);
    }

    function resolvePairAvatars(chatId, preferredCharUrl) {
        return Promise.all([
            resolveCharAvatarForChat(chatId, preferredCharUrl),
            resolveUserAvatarForChat(chatId)
        ]).then(function (pair) {
            return {
                charAvatar: pair[0] || '',
                userAvatar: pair[1] || ''
            };
        });
    }

    function formatTime(ts) {
        var n = Number(ts);
        if (!Number.isFinite(n) || n <= 0) return '';
        var d = new Date(n);
        var pad = function (v) {
            return String(v).padStart(2, '0');
        };
        return pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function scoreArc(score) {
        var v = Math.min(100, Math.max(0, Math.round(Number(score) || 0)));
        var r = 42;
        var c = 2 * Math.PI * r;
        var dash = (v / 100) * c;
        return (
            '<svg class="mc-hv__gauge-svg" viewBox="0 0 100 100" aria-hidden="true">' +
            '<circle class="mc-hv__gauge-track" cx="50" cy="50" r="' +
            r +
            '"></circle>' +
            '<circle class="mc-hv__gauge-fill" cx="50" cy="50" r="' +
            r +
            '" stroke-dasharray="' +
            dash.toFixed(2) +
            ' ' +
            c.toFixed(2) +
            '"></circle>' +
            '<text class="mc-hv__gauge-num" x="50" y="54">' +
            v +
            '</text></svg>'
        );
    }

    function findRoundLastMsgId(store, chatId, msgId) {
        if (!store || !chatId || !msgId) return msgId;
        var msgs = store.getMessages(chatId).filter(function (m) {
            return m && !m.deleted;
        });
        var idx = -1;
        var i;
        for (i = 0; i < msgs.length; i++) {
            if (String(msgs[i].id) === String(msgId)) {
                idx = i;
                break;
            }
        }
        if (idx < 0) return msgId;
        var lastId = msgId;
        for (i = idx; i < msgs.length; i++) {
            if (msgs[i].role !== 'assistant') break;
            lastId = msgs[i].id;
        }
        return lastId;
    }

    function findEntryForMessage(chat, store, msgId) {
        var log = Array.isArray(chat && chat.heartVoiceLog) ? chat.heartVoiceLog : [];
        if (!log.length) return null;
        var i;
        if (msgId) {
            for (i = 0; i < log.length; i++) {
                if (String(log[i].msgId) === String(msgId)) return log[i];
            }
            var roundLast = findRoundLastMsgId(store, chat.id, msgId);
            for (i = 0; i < log.length; i++) {
                if (String(log[i].msgId) === String(roundLast)) return log[i];
            }
        }
        if (chat.activeHeartVoiceMsgId) {
            for (i = 0; i < log.length; i++) {
                if (String(log[i].msgId) === String(chat.activeHeartVoiceMsgId)) return log[i];
            }
        }
        return log[0] || null;
    }

    /** 气泡头像高亮：仅当该条消息确实绑定了心声条目时为 true（不含 log[0] 兜底） */
    function messageHasHeartVoiceEntry(chat, store, msgId) {
        if (!chat || !msgId) return false;
        var log = Array.isArray(chat.heartVoiceLog) ? chat.heartVoiceLog : [];
        if (!log.length) return false;
        var i;
        for (i = 0; i < log.length; i++) {
            if (String(log[i].msgId) === String(msgId)) return true;
        }
        if (store && chat.id) {
            var roundLast = findRoundLastMsgId(store, chat.id, msgId);
            for (i = 0; i < log.length; i++) {
                if (String(log[i].msgId) === String(roundLast)) return true;
            }
        }
        if (chat.activeHeartVoiceMsgId) {
            var activeRoundLast = store && chat.id
                ? findRoundLastMsgId(store, chat.id, chat.activeHeartVoiceMsgId)
                : chat.activeHeartVoiceMsgId;
            var roundLastForMsg = store && chat.id
                ? findRoundLastMsgId(store, chat.id, msgId)
                : msgId;
            if (String(activeRoundLast) === String(roundLastForMsg)) return true;
        }
        return false;
    }

    function buildHeartVoiceHighlightIndex(chat, store) {
        var index = {};
        if (!chat || !store || !chat.id) return index;
        var log = Array.isArray(chat.heartVoiceLog) ? chat.heartVoiceLog : [];
        if (!log.length) return index;
        var allMsgs = store.getMessages(chat.id).filter(function (m) {
            return m && !m.deleted;
        });
        if (!allMsgs.length) return index;
        log.forEach(function (entry) {
            if (!entry || !entry.msgId) return;
            var anchorIdx = -1;
            var i;
            for (i = 0; i < allMsgs.length; i++) {
                if (String(allMsgs[i].id) === String(entry.msgId)) {
                    anchorIdx = i;
                    break;
                }
            }
            if (anchorIdx < 0) return;
            var left = anchorIdx;
            while (left > 0 && allMsgs[left - 1].role === 'assistant') left--;
            var right = anchorIdx;
            while (right < allMsgs.length - 1 && allMsgs[right + 1].role === 'assistant') right++;
            for (i = left; i <= right; i++) {
                if (allMsgs[i].role === 'assistant') index[String(allMsgs[i].id)] = true;
            }
        });
        return index;
    }

    function entryKey(entry, idx) {
        return String((entry && (entry.id || entry.msgId)) || idx);
    }

    function matchesEntryKey(entry, key) {
        if (!entry || key == null || key === '') return false;
        var k = String(key);
        return k === String(entry.id || '') || k === String(entry.msgId || '');
    }

    function renderHistoryList(log, activeId) {
        if (!log.length) {
            return '<div class="mc-hv__hist-empty">暂无心声记录</div>';
        }
        var tplMod = global.MiyaChatHeartVoiceTemplates;
        return log
            .map(function (entry, idx) {
                var id = entryKey(entry, idx);
                var cls = 'mc-hv__hist-item' + (id === activeId ? ' is-active' : '');
                var isCustom =
                    tplMod && typeof tplMod.isCustomEntry === 'function'
                        ? tplMod.isCustomEntry(entry)
                        : !!(entry && entry.mode === 'custom');
                var preview = '';
                if (tplMod && typeof tplMod.previewTextFromEntry === 'function') {
                    preview = cleanHeartVoiceDisplayText(tplMod.previewTextFromEntry(entry)).slice(0, 36);
                } else {
                    preview = cleanHeartVoiceDisplayText(String(entry.monologue || entry.action || '')).slice(0, 36);
                }
                var scoresHtml = isCustom
                    ? '<span class="mc-hv__hist-scores">自定义</span>'
                    : '<span class="mc-hv__hist-scores">♡' +
                      esc(entry.affection != null ? entry.affection : '—') +
                      ' · ◇' +
                      esc(entry.desire != null ? entry.desire : '—') +
                      '</span>';
                return (
                    '<div class="mc-hv__hist-row">' +
                    '<button type="button" class="' +
                    cls +
                    '" data-hv-id="' +
                    esc(id) +
                    '">' +
                    '<span class="mc-hv__hist-idx">' +
                    String(log.length - idx).padStart(2, '0') +
                    '</span>' +
                    '<span class="mc-hv__hist-meta">' +
                    '<span class="mc-hv__hist-time">' +
                    esc(formatTime(entry.updatedAt)) +
                    '</span>' +
                    scoresHtml +
                    '</span>' +
                    '<span class="mc-hv__hist-preview">' +
                    esc(preview || '…') +
                    '</span></button>' +
                    '<button type="button" class="mc-hv__hist-del" data-hv-delete="' +
                    esc(id) +
                    '" aria-label="删除此条心声">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
                    '<path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M8 7l1 12h6l1-12" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '</svg></button></div>'
                );
            })
            .join('');
    }

    function cleanHeartVoiceDisplayText(text) {
        var eng = global.miyaChatEngine;
        if (eng && typeof eng.stripHeartVoiceTagFragments === 'function') {
            return eng.stripHeartVoiceTagFragments(text);
        }
        return String(text || '')
            .replace(/<\/?miyav[\w]*\s*>/gi, '')
            .trim();
    }

    function resolveEntryTemplate(entry, chatId) {
        var tpl = entry && entry.htmlTemplate ? String(entry.htmlTemplate) : '';
        if (tpl.trim()) return tpl;
        var store = getStore();
        if (!store || !chatId || !store.getChatSettings) return '';
        var settings = store.getChatSettings(chatId);
        var snap = settings && settings.heartVoicePresetSnapshot;
        if (snap && snap.htmlTemplate) return String(snap.htmlTemplate);
        var tplMod = global.MiyaChatHeartVoiceTemplates;
        if (
            settings &&
            settings.heartVoicePreset &&
            tplMod &&
            typeof tplMod.findPreset === 'function'
        ) {
            var row = tplMod.findPreset(settings.heartVoicePreset);
            if (row && row.htmlTemplate) return String(row.htmlTemplate);
        }
        return '';
    }

    function renderCustomFallbackFields(fields) {
        var map = fields && typeof fields === 'object' ? fields : {};
        var keys = Object.keys(map);
        if (!keys.length) {
            return '<p class="mc-hv__custom-empty">已识别为自定义心声，但字段为空或模板未保存。请重新保存预设并再聊一轮。</p>';
        }
        return (
            '<div class="mc-hv__custom-fallback">' +
            keys
                .map(function (k) {
                    return (
                        '<div class="mc-hv__custom-fallback-row"><strong>' +
                        esc(k) +
                        '</strong><p>' +
                        esc(String(map[k] || '')) +
                        '</p></div>'
                    );
                })
                .join('') +
            '</div>'
        );
    }

    function renderMain(entry, roleName, avatarUrl, chatId) {
        if (!entry) {
            return (
                '<div class="mc-hv__empty">' +
                '<div class="mc-hv__empty-ring"></div>' +
                '<p>本轮暂无心声</p>' +
                '<span>角色回复后将在此呈现内心独白</span></div>'
            );
        }
        var tplMod = global.MiyaChatHeartVoiceTemplates;
        var isCustom =
            tplMod && typeof tplMod.isCustomEntry === 'function'
                ? tplMod.isCustomEntry(entry)
                : !!(entry && entry.mode === 'custom');
        if (isCustom) {
            var htmlTpl = resolveEntryTemplate(entry, chatId);
            var hasTpl = !!(htmlTpl && String(htmlTpl).trim());
            if (!hasTpl) {
                return (
                    '<div class="mc-hv__custom">' +
                    '<div class="mc-hv__custom-stage">' +
                    '<div class="mc-hv__custom-card">' +
                    renderCustomFallbackFields(entry.fields) +
                    '</div></div></div>'
                );
            }
            return (
                '<div class="mc-hv__custom">' +
                '<div class="mc-hv__custom-stage">' +
                '<div class="mc-hv__custom-card" data-hv-mount></div></div></div>'
            );
        }
        var affection = entry.affection != null ? entry.affection : 0;
        var desire = entry.desire != null ? entry.desire : 0;
        var entryId = entryKey(entry, 0);
        return (
            '<div class="mc-hv__hero">' +
            '<div class="mc-hv__hero-portrait">' +
            '<div class="mc-hv__hero-ring mc-hv__hero-ring--a"></div>' +
            '<div class="mc-hv__hero-ring mc-hv__hero-ring--b"></div>' +
            '<img class="mc-hv__hero-ava" src="' +
            esc(avatarUrl) +
            '" alt="">' +
            '<div class="mc-hv__hero-badge">INNER</div></div>' +
            '<div class="mc-hv__hero-copy">' +
            '<span class="mc-hv__hero-kicker">Heart Voice · 心声</span>' +
            '<h2 class="mc-hv__hero-name">' +
            esc(roleName) +
            '</h2>' +
            '<p class="mc-hv__hero-sub">本轮内心快照 · ' +
            esc(formatTime(entry.updatedAt)) +
            '</p>' +
            '<button type="button" class="mc-hv__del" data-hv-delete="' +
            esc(entryId) +
            '" aria-label="删除此条心声">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
            '<path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M8 7l1 12h6l1-12" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg><span>删除</span></button></div></div>' +
            '<div class="mc-hv__metrics">' +
            '<div class="mc-hv__metric mc-hv__metric--aff">' +
            '<div class="mc-hv__metric-label"><span>好感度</span><em>Affection</em></div>' +
            scoreArc(affection) +
            '</div>' +
            '<div class="mc-hv__metric-div"></div>' +
            '<div class="mc-hv__metric mc-hv__metric--des">' +
            '<div class="mc-hv__metric-label"><span>欲望值</span><em>Desire</em></div>' +
            scoreArc(desire) +
            '</div></div>' +
            '<div class="mc-hv__section mc-hv__section--action">' +
            '<div class="mc-hv__section-head">' +
            '<span class="mc-hv__section-no">01</span>' +
            '<span class="mc-hv__section-title">行为动作</span>' +
            '<span class="mc-hv__section-tag">Objective</span></div>' +
            '<div class="mc-hv__action-frame">' +
            '<div class="mc-hv__action-corner mc-hv__action-corner--tl"></div>' +
            '<div class="mc-hv__action-corner mc-hv__action-corner--br"></div>' +
            '<p>' +
            esc(cleanHeartVoiceDisplayText(entry.action) || '—') +
            '</p></div></div>' +
            '<div class="mc-hv__section mc-hv__section--voice">' +
            '<div class="mc-hv__section-head">' +
            '<span class="mc-hv__section-no">02</span>' +
            '<span class="mc-hv__section-title">角色心声</span>' +
            '<span class="mc-hv__section-tag">First Person</span></div>' +
            '<blockquote class="mc-hv__quote">' +
            '<span class="mc-hv__quote-mark">“</span>' +
            esc(cleanHeartVoiceDisplayText(entry.monologue) || '—') +
            '<span class="mc-hv__quote-mark mc-hv__quote-mark--end">”</span></blockquote></div>'
        );
    }

    function panelShellHtml() {
        return (
            '<div class="mc-hv" id="mc-hv-panel" hidden aria-hidden="true">' +
            '<div class="mc-hv__backdrop" data-hv-close></div>' +
            '<div class="mc-hv__sheet" role="dialog" aria-modal="true" aria-labelledby="mc-hv-title">' +
            '<div class="mc-hv__deco" aria-hidden="true">' +
            '<div class="mc-hv__deco-grain"></div>' +
            '<div class="mc-hv__deco-line mc-hv__deco-line--a"></div>' +
            '<div class="mc-hv__deco-line mc-hv__deco-line--b"></div>' +
            '<div class="mc-hv__deco-stamp">Secret</div></div>' +
            '<header class="mc-hv__head">' +
            '<button type="button" class="mc-hv__hist-fab" data-hv-hist-toggle hidden aria-label="历史心声" title="历史心声">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
            '<path d="M4 5h12v14H4zM8 9h6M8 13h4" stroke-linecap="round"/>' +
            '<path d="M16 8l4 2v9l-4 2V8z" stroke-linejoin="round"/>' +
            '</svg></button>' +
            '<div class="mc-hv__head-left">' +
            '<span class="mc-hv__head-tag">PRIVATE</span>' +
            '<h1 class="mc-hv__head-title" id="mc-hv-title">心声档案</h1></div>' +
            '<button type="button" class="mc-hv__close" data-hv-close aria-label="关闭">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>' +
            '</button></header>' +
            '<div class="mc-hv__body">' +
            '<div class="mc-hv__main" id="mc-hv-main"></div>' +
            '<aside class="mc-hv__aside" id="mc-hv-aside">' +
            '<div class="mc-hv__aside-head">' +
            '<span class="mc-hv__aside-title">历史心声</span>' +
            '<span class="mc-hv__aside-count" id="mc-hv-count">0</span>' +
            '<button type="button" class="mc-hv__aside-close" data-hv-hist-close hidden aria-label="关闭历史">×</button></div>' +
            '<div class="mc-hv__hist" id="mc-hv-hist"></div></aside></div></div></div>'
        );
    }

    function ensurePanel() {
        if (panelEl && panelEl.isConnected && panelEl.querySelector('[data-hv-hist-toggle]') &&
            panelEl.dataset.bound === PANEL_BOUND) {
            return panelEl;
        }
        /* 旧版绑定会残留 click 监听，与 pointerdown 叠加重触发，必须重建 */
        if (panelEl && panelEl.isConnected) {
            panelEl.remove();
        }
        panelEl = null;
        var existing = $('mc-hv-panel');
        if (existing && existing.isConnected) {
            if (!existing.querySelector('[data-hv-hist-toggle]') || existing.dataset.bound !== PANEL_BOUND) {
                existing.remove();
                existing = null;
            } else {
                panelEl = existing;
            }
        }
        if (!panelEl) {
            var wrap = document.createElement('div');
            wrap.innerHTML = panelShellHtml();
            panelEl = wrap.firstElementChild;
            var room = $('qq-room');
            if (room) room.appendChild(panelEl);
            else document.body.appendChild(panelEl);
        }
        if (panelEl.dataset.bound !== PANEL_BOUND) {
            panelEl.dataset.bound = PANEL_BOUND;
            /* pointerdown 捕获：避开 iframe 叠层与二次 paint 导致的「要点好几下」 */
            panelEl.addEventListener(
                'pointerdown',
                function (e) {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    if (e.target.closest('[data-hv-close]')) {
                        e.preventDefault();
                        e.stopPropagation();
                        close();
                        return;
                    }
                    if (e.target.closest('[data-hv-hist-toggle]')) {
                        e.preventDefault();
                        e.stopPropagation();
                        panelEl.classList.toggle('is-hist-open');
                        return;
                    }
                    if (e.target.closest('[data-hv-hist-close]')) {
                        e.preventDefault();
                        e.stopPropagation();
                        panelEl.classList.remove('is-hist-open');
                    }
                },
                true
            );
            panelEl.addEventListener('click', function (e) {
                /* 关闭/历史已在 pointerdown 处理；此处挡住合成 click，避免穿透 */
                if (
                    e.target.closest('[data-hv-close]') ||
                    e.target.closest('[data-hv-hist-toggle]') ||
                    e.target.closest('[data-hv-hist-close]')
                ) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                var delBtn = e.target.closest('[data-hv-delete]');
                if (delBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteEntry(delBtn.getAttribute('data-hv-delete'));
                    return;
                }
                var item = e.target.closest('[data-hv-id]');
                if (item) {
                    e.preventDefault();
                    selectEntry(item.getAttribute('data-hv-id'));
                    panelEl.classList.remove('is-hist-open');
                }
            });
        }
        return panelEl;
    }

    function resolveRoleName(chatId) {
        var store = getStore();
        if (!store) return '角色';
        var chat = store.findChat(chatId);
        if (!chat) return '角色';
        var contact = store.findContact(chat.contactId);
        return String((contact && (contact.remarkName || contact.name)) || '角色').trim();
    }

    function resolveAvatarUrl(chatId) {
        if (state.avatarUrl) return state.avatarUrl;
        return '';
    }

    function buildAvatarCtx() {
        return {
            charAvatar: state.avatarUrl || '',
            userAvatar: state.userAvatarUrl || '',
            avatarUrl: state.avatarUrl || ''
        };
    }

    function findLogEntryByKey(log, entryId) {
        if (!entryId || !Array.isArray(log)) return null;
        var key = String(entryId);
        var found = null;
        log.some(function (row, idx) {
            var id = entryKey(row, idx);
            if (id === key || matchesEntryKey(row, key)) {
                found = { entry: row, activeId: id };
                return true;
            }
            return false;
        });
        return found;
    }

    function paint(chatId, entryId) {
        var store = getStore();
        if (!store || !chatId) return;
        var chat = store.findChat(chatId);
        if (!chat) return;
        var log = Array.isArray(chat.heartVoiceLog) ? chat.heartVoiceLog : [];
        var entry = null;
        var activeId = '';
        var picked = entryId ? findLogEntryByKey(log, entryId) : null;
        if (picked) {
            entry = picked.entry;
            activeId = picked.activeId;
        }
        if (!entry) entry = findEntryForMessage(chat, store, null);
        if (entry && !activeId) activeId = entryKey(entry, log.indexOf(entry));
        state.entryId = activeId;
        var main = panelEl.querySelector('#mc-hv-main');
        var hist = panelEl.querySelector('#mc-hv-hist');
        var count = panelEl.querySelector('#mc-hv-count');
        var sheet = panelEl.querySelector('.mc-hv__sheet');
        var histFab = panelEl.querySelector('[data-hv-hist-toggle]');
        var asideClose = panelEl.querySelector('[data-hv-hist-close]');
        var tplModPaint = global.MiyaChatHeartVoiceTemplates;
        var entryIsCustom =
            entry &&
            ((tplModPaint &&
                typeof tplModPaint.isCustomEntry === 'function' &&
                tplModPaint.isCustomEntry(entry)) ||
                entry.mode === 'custom');
        if (sheet) sheet.classList.toggle('mc-hv__sheet--custom', !!entryIsCustom);
        panelEl.classList.toggle('mc-hv--custom', !!entryIsCustom);
        /* 不在 paint 里清 is-hist-open：头像异步重绘会把刚打开的历史关掉，造成要点多次 */
        if (histFab) histFab.hidden = !entryIsCustom;
        if (asideClose) asideClose.hidden = !entryIsCustom;
        if (main) {
            var avatarCtx = buildAvatarCtx();
            main.innerHTML = renderMain(
                entry,
                resolveRoleName(chatId),
                resolveAvatarUrl(chatId) || avatarCtx.charAvatar,
                chatId
            );
            if (entryIsCustom) {
                var mount = main.querySelector('[data-hv-mount]');
                if (mount && tplModPaint && typeof tplModPaint.mountInteractiveHtml === 'function') {
                    var htmlTplPaint = resolveEntryTemplate(entry, chatId);
                    var htmlPaint =
                        typeof tplModPaint.renderTemplate === 'function' && htmlTplPaint
                            ? tplModPaint.renderTemplate(
                                  htmlTplPaint,
                                  entry.fields || {},
                                  avatarCtx
                              )
                            : '';
                    if (String(htmlPaint || '').trim()) {
                        tplModPaint.mountInteractiveHtml(mount, htmlPaint, {
                            frameClass: 'mc-hv__interactive-frame',
                            title: '自定义心声'
                        });
                    } else {
                        mount.innerHTML = renderCustomFallbackFields(entry.fields);
                    }
                }
            }
        }
        if (hist) hist.innerHTML = renderHistoryList(log, activeId);
        if (count) count.textContent = String(Math.min(log.length, HEART_VOICE_LOG_MAX));
    }

    function selectEntry(entryId) {
        if (!state.chatId || !entryId) return;
        /* 点历史：用该条替换主区当前展示，便于回看 */
        paint(state.chatId, entryId);
    }

    function pickViewEntryId(nextLog, currentViewId) {
        if (!nextLog.length) return '';
        var viewId = String(currentViewId || '');
        if (viewId && nextLog.some(function (entry) { return matchesEntryKey(entry, viewId); })) {
            return viewId;
        }
        return entryKey(nextLog[0], 0);
    }

    function deleteEntry(entryId) {
        if (!state.chatId || entryId == null || entryId === '') return;
        var store = getStore();
        if (!store) return;
        var chatId = state.chatId;
        var viewId = state.entryId;

        function runDelete() {
            var chat = store.findChat(chatId);
            if (!chat) return;
            var log = Array.isArray(chat.heartVoiceLog) ? chat.heartVoiceLog : [];
            var target = null;
            var nextLog = log.filter(function (entry) {
                if (matchesEntryKey(entry, entryId)) {
                    target = entry;
                    return false;
                }
                return true;
            });
            if (!target || nextLog.length === log.length) return;
            var patch = { heartVoiceLog: nextLog };
            var targetMsgId = String(target.msgId || '');
            if (
                (targetMsgId && String(chat.activeHeartVoiceMsgId) === targetMsgId) ||
                matchesEntryKey(target, chat.activeHeartVoiceMsgId)
            ) {
                patch.activeHeartVoiceMsgId = '';
                patch.lastHeartVoiceParse = null;
            }
            store.updateChat(chatId, patch).then(function () {
                paint(chatId, pickViewEntryId(nextLog, viewId));
                var room = global.miyaChatRoom;
                if (room && typeof room.getOpenChatId === 'function' &&
                    String(room.getOpenChatId()) === String(chatId) &&
                    typeof room.refresh === 'function') {
                    room.refresh();
                }
            });
        }

        if (global.miyaDialog && global.miyaDialog.confirm) {
            global.miyaDialog.confirm({
                title: '删除心声',
                message: '删除后无法恢复，确定要删除这条心声吗？',
                confirmText: '删除',
                cancelText: '取消'
            }).then(function (ok) {
                if (ok) runDelete();
            });
            return;
        }
        runDelete();
    }

    function open(chatId, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var store = getStore();
        if (!store || !chatId) return;
        var chat = store.findChat(chatId);
        if (!chat || chat.type === 'group') return;
        ensurePanel();
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
        state.chatId = chatId;
        state.avatarUrl = String(opts.avatarUrl || '');
        state.userAvatarUrl = '';
        var entry = findEntryForMessage(chat, store, opts.msgId);
        var entryId = entry ? String(entry.id || entry.msgId || '') : '';
        var gen = ++state.paintGen;
        panelEl.classList.remove('is-hist-open');
        panelEl.classList.remove('is-closing');
        resolvePairAvatars(chatId, state.avatarUrl).then(function (pair) {
            if (gen !== state.paintGen || String(state.chatId) !== String(chatId)) return;
            state.avatarUrl = pair.charAvatar || state.avatarUrl;
            state.userAvatarUrl = pair.userAvatar || '';
            paint(chatId, entryId);
        });
        paint(chatId, entryId);
        panelEl.hidden = false;
        panelEl.setAttribute('aria-hidden', 'false');
        setRoomHvOpen(true);
        requestAnimationFrame(function () {
            panelEl.classList.add('is-open');
        });
    }

    function finishClose() {
        if (!panelEl) return;
        panelEl.classList.remove('is-closing');
        panelEl.hidden = true;
        closeTimer = null;
        setRoomHvOpen(false);
    }

    function close() {
        if (!panelEl || panelEl.hidden) return;
        if (panelEl.classList.contains('is-closing')) return;
        panelEl.classList.remove('is-open');
        panelEl.classList.remove('is-hist-open');
        panelEl.classList.remove('mc-hv--custom');
        panelEl.classList.add('is-closing');
        panelEl.setAttribute('aria-hidden', 'true');
        /* 先淡出并继续挡住点击，等动画后再 hidden，避免穿透到设置键 */
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(finishClose, 420);
        state.chatId = null;
        state.entryId = null;
        state.avatarUrl = '';
        state.userAvatarUrl = '';
        state.paintGen += 1;
        var room = global.miyaChatRoom;
        if (room && typeof room.getOpenChatId === 'function' && room.getOpenChatId() &&
            typeof room.restoreCompose === 'function') {
            room.restoreCompose();
        }
    }

    function onRoundUpdated(chatId) {
        if (!panelEl || panelEl.hidden || String(state.chatId) !== String(chatId)) return;
        var gen = ++state.paintGen;
        resolvePairAvatars(chatId, state.avatarUrl).then(function (pair) {
            if (gen !== state.paintGen || String(state.chatId) !== String(chatId)) return;
            state.avatarUrl = pair.charAvatar || state.avatarUrl;
            state.userAvatarUrl = pair.userAvatar || '';
            paint(chatId, null);
        });
    }

    function onAvatarClick(chatId, msgId, avatarUrl) {
        open(chatId, { msgId: msgId, avatarUrl: avatarUrl });
    }

    global.MiyaChatHeartVoice = {
        open: open,
        close: close,
        onAvatarClick: onAvatarClick,
        onRoundUpdated: onRoundUpdated,
        findEntryForMessage: findEntryForMessage,
        messageHasHeartVoiceEntry: messageHasHeartVoiceEntry,
        buildHeartVoiceHighlightIndex: buildHeartVoiceHighlightIndex
    };
})(window);
