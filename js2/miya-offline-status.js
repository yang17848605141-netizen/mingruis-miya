/**
 * 线下状态栏：可拖动悬浮球 + Ins 内置 + 自有预设库（保存/读取/导出/导入）。
 * 单人/多人共用；多人时默认展示每位出演角色状态。
 * 展示样式刻意区别于线上心声；字段解析复用 miyaChatEngine.parseHeartVoiceFromReply。
 */
(function (global) {
    'use strict';

    var FAB_POS_KEY = 'miya-offline-status-fab-pos-v1';
    var PRESETS_LS = 'miya-offline-status-presets-v1';
    var STATUS_LOG_MAX = 40;

    var BUILTIN_FIELDS = [
        { name: '心情', requirement: '一两个词概括此刻情绪，克制真实' },
        { name: '状态', requirement: '一句客观现状或处境' },
        { name: '想法', requirement: '一句内心独白，贴合人设与当下' }
    ];

    var panelEl = null;
    var fabEl = null;
    var dragState = null;
    var presetsCache = null;
    var viewState = {
        chatId: '',
        sessionId: '',
        contactId: '',
        activeContactId: 'all',
        entryIdx: 0
    };

    function esc(t) {
        return String(t || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function toast(msg) {
        if (global.miyaOfflineApp && typeof global.miyaOfflineApp.toast === 'function') {
            global.miyaOfflineApp.toast(msg);
            return;
        }
        try {
            console.log('[offline-status]', msg);
        } catch (e) {}
    }

    function apStore() {
        return global.MiyaAppointmentStore;
    }

    function chatStore() {
        return global.miyaChatStore;
    }

    function tplMod() {
        return global.MiyaChatHeartVoiceTemplates;
    }

    function engineParse() {
        var eng = global.miyaChatEngine;
        return eng && typeof eng.parseHeartVoiceFromReply === 'function' ? eng : null;
    }

    function loadFabPos() {
        try {
            var raw = JSON.parse(localStorage.getItem(FAB_POS_KEY) || 'null');
            if (raw && typeof raw.x === 'number' && typeof raw.y === 'number') return raw;
        } catch (e) {}
        return null;
    }

    function saveFabPos(pos) {
        try {
            localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos));
        } catch (e) {}
    }

    function getStatusSettings() {
        var st = apStore();
        if (st && typeof st.getStatusBar === 'function') return st.getStatusBar() || {};
        return { enabled: true, presetName: '' };
    }

    function saveStatusSettings(patch) {
        var st = apStore();
        if (st && typeof st.saveStatusBar === 'function') return st.saveStatusBar(patch || {});
        return getStatusSettings();
    }

    function isEnabled() {
        var s = getStatusSettings();
        return !s || s.enabled !== false;
    }

    function normalizePreset(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var name = String(raw.name || '').trim();
        if (!name) return null;
        var fields = Array.isArray(raw.fields)
            ? raw.fields
                  .map(function (f) {
                      var n = String((f && f.name) || '').trim();
                      if (!n) return null;
                      return {
                          name: n,
                          requirement: String((f && f.requirement) || '').trim()
                      };
                  })
                  .filter(Boolean)
            : [];
        if (!fields.length) return null;
        return {
            name: name,
            customPrompt: String(raw.customPrompt || '').trim(),
            fields: fields,
            htmlTemplate: String(raw.htmlTemplate || ''),
            savedAt: Number(raw.savedAt) || Date.now()
        };
    }

    function loadPresets() {
        if (presetsCache) return presetsCache;
        var list = [];
        try {
            var raw = JSON.parse(localStorage.getItem(PRESETS_LS) || '[]');
            if (Array.isArray(raw)) {
                list = raw.map(normalizePreset).filter(Boolean);
            }
        } catch (e) {}
        presetsCache = list;
        return list;
    }

    function persistPresets(list) {
        presetsCache = Array.isArray(list) ? list : [];
        try {
            localStorage.setItem(PRESETS_LS, JSON.stringify(presetsCache));
        } catch (e) {}
        return presetsCache;
    }

    function findOfflinePreset(name) {
        var n = String(name || '').trim();
        if (!n) return null;
        var list = loadPresets();
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].name === n) return list[i];
        }
        return null;
    }

    function saveOfflinePreset(name, state) {
        var row = normalizePreset(
            Object.assign({}, state || {}, { name: name, savedAt: Date.now() })
        );
        if (!row) return null;
        var list = loadPresets().filter(function (p) {
            return p.name !== row.name;
        });
        list.unshift(row);
        persistPresets(list);
        return row;
    }

    function deleteOfflinePreset(name) {
        var n = String(name || '').trim();
        if (!n) return false;
        var before = loadPresets().length;
        persistPresets(
            loadPresets().filter(function (p) {
                return p.name !== n;
            })
        );
        var cur = String((getStatusSettings().presetName) || '').trim();
        if (cur === n || cur === 'offline:' + n) {
            saveStatusSettings({ presetName: '' });
        }
        return loadPresets().length < before;
    }

    function parsePresetKey(raw) {
        var s = String(raw || '').trim();
        if (!s) return { source: 'builtin', name: '' };
        if (s.indexOf('offline:') === 0) return { source: 'offline', name: s.slice(8) };
        if (s.indexOf('hv:') === 0) return { source: 'hv', name: s.slice(3) };
        /* 兼容旧值：纯名称优先线下，再心声 */
        if (findOfflinePreset(s)) return { source: 'offline', name: s };
        var mod = tplMod();
        if (mod && typeof mod.findPreset === 'function' && mod.findPreset(s)) {
            return { source: 'hv', name: s };
        }
        return { source: 'offline', name: s };
    }

    function encodePresetKey(source, name) {
        if (!name) return '';
        if (source === 'hv') return 'hv:' + name;
        return 'offline:' + name;
    }

    function resolveStatusPreset() {
        var settings = getStatusSettings();
        var key = parsePresetKey(settings && settings.presetName);
        if (key.source === 'builtin' || !key.name) return null;
        if (key.source === 'offline') return findOfflinePreset(key.name);
        var mod = tplMod();
        if (mod && typeof mod.findPreset === 'function') return mod.findPreset(key.name) || null;
        return null;
    }

    function builtinFieldNames() {
        return BUILTIN_FIELDS.map(function (f) {
            return f.name;
        });
    }

    function resolveFieldNames(preset) {
        if (preset && Array.isArray(preset.fields) && preset.fields.length) {
            return preset.fields
                .map(function (f) {
                    return String((f && f.name) || '').trim();
                })
                .filter(Boolean);
        }
        return builtinFieldNames();
    }

    function buildStatusRulesBlock(castContacts) {
        if (!isEnabled()) return '';
        var list = Array.isArray(castContacts) && castContacts.length ? castContacts : [];
        var names = list
            .map(function (c) {
                return String((c && c.name) || '').trim();
            })
            .filter(Boolean);
        var multi = names.length > 1;
        var preset = resolveStatusPreset();
        var fieldNames = resolveFieldNames(preset);
        var n = fieldNames.length;
        var lines = [
            '【线下格式规则·状态栏】',
            '正文结束后必须完整输出 <miyastatus>...</miyastatus>：开闭标签均必填；禁止写入 <thinking> 或正文。',
            '状态栏只输出纯文本字段行（字段名-内容），禁止输出 HTML/CSS/模板。'
        ];
        if (multi) {
            lines.push(
                '本场为多人线下，须为每一位出演角色各写一套完整状态，不得合并、不得省略任何人。'
            );
            lines.push('出演名单（名称须完全一致）：' + names.join('、') + '。');
            lines.push(
                '格式：每位角色以单独一行「### 角色名」开头，其下紧跟 ' +
                    n +
                    ' 个字段行；下一位角色再写下一个「### 角色名」。'
            );
            lines.push('完整示例：');
            lines.push('<miyastatus>');
            names.forEach(function (nm) {
                lines.push('### ' + nm);
                fieldNames.forEach(function (fn) {
                    lines.push(fn + '-（写' + nm + '的本字段）');
                });
            });
            lines.push('</miyastatus>');
            lines.push('自检：### 标题数量必须等于 ' + String(names.length) + '，且每人字段齐全。');
        } else {
            var rn = names[0] || '角色';
            lines.push('本场角色：' + rn + '。段内须写满以下 ' + n + ' 个字段：');
        }
        if (preset) {
            var customPrompt = String(preset.customPrompt || '').trim();
            if (customPrompt) {
                lines.push('【自定义状态要求·须优先遵守】');
                lines.push(
                    customPrompt
                        .replace(/<miyavoice>/gi, '<miyastatus>')
                        .replace(/<\/miyavoice>/gi, '</miyastatus>')
                        .replace(/miyavoice/gi, 'miyastatus')
                        .replace(/心声/g, '状态')
                );
            }
            lines.push('【字段说明·须全部输出】');
            (preset.fields || []).forEach(function (f) {
                var req = String((f && f.requirement) || '').trim() || '按人设与当下情境填写';
                lines.push(String(f.name) + '-' + req);
            });
        } else {
            lines.push('【字段说明·须全部输出】（内置简约）');
            BUILTIN_FIELDS.forEach(function (f) {
                lines.push(f.name + '-' + f.requirement);
            });
        }
        lines.push('发出前自检：字段是否写满并正确闭合 </miyastatus>；不足则补全。');
        return lines.join('\n');
    }

    function extractStatusBlock(rawText) {
        var src = String(rawText || '');
        var patterns = [
            /<miyastatus>([\s\S]*?)<\/miyastatus\s*>/i,
            /＜miyastatus＞([\s\S]*?)＜\/miyastatus＞/i,
            /<miyavoice>([\s\S]*?)<\/miyav[\w]*\s*>/i,
            /＜miyavoice＞([\s\S]*?)＜\/miyav[\w]*＞/i
        ];
        var i;
        for (i = 0; i < patterns.length; i++) {
            var m = src.match(patterns[i]);
            if (m && m[1] && String(m[1]).trim()) return String(m[1]).trim();
        }
        var tail = src.match(/<miyastatus>([\s\S]*)$/i) || src.match(/＜miyastatus＞([\s\S]*)$/i);
        if (tail && tail[1] && String(tail[1]).trim()) return String(tail[1]).trim();
        return '';
    }

    function stripStatusFromText(rawText) {
        return String(rawText || '')
            .replace(/<miyastatus>[\s\S]*?<\/miyastatus\s*>/gi, '')
            .replace(/＜miyastatus＞[\s\S]*?＜\/miyastatus＞/gi, '')
            .replace(/<miyastatus>[\s\S]*$/gi, '')
            .replace(/＜miyastatus＞[\s\S]*$/gi, '')
            .replace(/<miyavoice>[\s\S]*?<\/miyav[\w]*\s*>/gi, '')
            .replace(/＜miyavoice＞[\s\S]*?＜\/miyav[\w]*＞/gi, '')
            .replace(/<miyavoice>[\s\S]*$/gi, '')
            .replace(/＜miyavoice＞[\s\S]*$/gi, '')
            .trim();
    }

    function splitMultiSections(inner) {
        var src = String(inner || '').trim();
        if (!src) return [];
        var parts = src.split(/(?=^###\s+.+$|^【[^】]+】\s*$)/m);
        if (parts.length <= 1) {
            return [{ name: '', body: src }];
        }
        return parts
            .map(function (chunk) {
                var t = String(chunk || '').trim();
                if (!t) return null;
                var hm = t.match(/^###\s+(.+?)\s*\n([\s\S]*)$/);
                if (hm) return { name: String(hm[1] || '').trim(), body: String(hm[2] || '').trim() };
                var bm = t.match(/^【([^】]+)】\s*\n([\s\S]*)$/);
                if (bm) return { name: String(bm[1] || '').trim(), body: String(bm[2] || '').trim() };
                return { name: '', body: t };
            })
            .filter(Boolean);
    }

    function parseFieldsFromInner(inner, fieldNames) {
        var eng = engineParse();
        if (eng) {
            var wrapped = '<miyavoice>' + String(inner || '') + '</miyavoice>';
            var parsed = eng.parseHeartVoiceFromReply(wrapped, { fieldNames: fieldNames });
            if (parsed && parsed.extractedOk && parsed.extracted) {
                if (parsed.extracted.mode === 'custom' && parsed.extracted.fields) {
                    return parsed.extracted.fields;
                }
                var legacyMap = {
                    好感度: parsed.extracted.affection != null ? String(parsed.extracted.affection) : '',
                    欲望值: parsed.extracted.desire != null ? String(parsed.extracted.desire) : '',
                    行为动作: parsed.extracted.action || '',
                    角色心声: parsed.extracted.monologue || ''
                };
                var out = {};
                var hit = 0;
                fieldNames.forEach(function (n) {
                    if (legacyMap[n]) {
                        out[n] = legacyMap[n];
                        hit += 1;
                    }
                });
                if (hit) return out;
            }
        }
        var fields = {};
        var current = null;
        String(inner || '')
            .split(/\n/)
            .forEach(function (line) {
                var raw = String(line || '').trim();
                if (!raw) return;
                var matched = null;
                fieldNames.some(function (label) {
                    var escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    var re = new RegExp('^' + escaped + '\\s*[-－—：:]\\s*([\\s\\S]+)$');
                    var m = raw.match(re);
                    if (m) {
                        matched = { key: label, value: String(m[1] || '').trim() };
                        return true;
                    }
                    return false;
                });
                if (matched) {
                    current = matched.key;
                    fields[current] = matched.value;
                    return;
                }
                if (current) {
                    fields[current] = (fields[current] ? fields[current] + '\n' : '') + raw;
                }
            });
        return fields;
    }

    function matchContactByName(castContacts, name) {
        var n = String(name || '').trim();
        var list = Array.isArray(castContacts) ? castContacts : [];
        if (!n) return list[0] || null;
        var found = null;
        list.some(function (c) {
            if (!c) return false;
            if (String(c.name || '').trim() === n) {
                found = c;
                return true;
            }
            return false;
        });
        return found || null;
    }

    function parseStatusFromReply(rawText, castContacts) {
        var inner = extractStatusBlock(rawText);
        if (!inner) {
            return { ok: false, entries: [], updatedAt: Date.now() };
        }
        var preset = resolveStatusPreset();
        var fieldNames = resolveFieldNames(preset);
        var sections = splitMultiSections(inner);
        var list = Array.isArray(castContacts) && castContacts.length ? castContacts : [{ id: '', name: '' }];
        var entries = [];
        if (sections.length === 1 && !sections[0].name && list.length === 1) {
            entries.push(makeEntry(list[0], parseFieldsFromInner(sections[0].body, fieldNames), preset));
        } else {
            sections.forEach(function (sec) {
                var contact = matchContactByName(list, sec.name);
                if (!contact && list.length === 1) contact = list[0];
                if (!contact) return;
                entries.push(makeEntry(contact, parseFieldsFromInner(sec.body, fieldNames), preset));
            });
            if (!entries.length && list[0]) {
                entries.push(makeEntry(list[0], parseFieldsFromInner(inner, fieldNames), preset));
            }
            /* 多人：补齐未写出状态的角色空槽，方便 UI 仍列出名字 */
            if (list.length > 1) {
                list.forEach(function (c) {
                    var has = entries.some(function (e) {
                        return e && e.contactId === c.id;
                    });
                    if (!has) entries.push(makeEntry(c, {}, preset));
                });
            }
        }
        var ok = entries.some(function (e) {
            return (
                e &&
                e.fields &&
                Object.keys(e.fields).some(function (k) {
                    return String(e.fields[k] || '').trim();
                })
            );
        });
        return { ok: ok, entries: entries, updatedAt: Date.now() };
    }

    function makeEntry(contact, fields, preset) {
        var map = fields && typeof fields === 'object' ? fields : {};
        var row = {
            contactId: String((contact && (contact.id || contact.contactId)) || '').trim(),
            roleName: String((contact && contact.name) || '').trim(),
            mode: preset ? 'custom' : 'builtin',
            fields: map,
            updatedAt: Date.now()
        };
        if (preset) {
            row.presetName = String(preset.name || '').trim();
            row.htmlTemplate = String(preset.htmlTemplate || '');
        }
        return row;
    }

    function appendStatusLog(sess, pack) {
        if (!sess || !pack || !pack.ok || !pack.entries || !pack.entries.length) return;
        var log = Array.isArray(sess.statusLog) ? sess.statusLog.slice() : [];
        log.unshift({
            updatedAt: pack.updatedAt || Date.now(),
            entries: pack.entries
        });
        if (log.length > STATUS_LOG_MAX) log.length = STATUS_LOG_MAX;
        sess.statusLog = log;
        var st = apStore();
        if (st && typeof st._writeSession === 'function') st._writeSession(sess);
    }

    function latestRound(sess) {
        var log = (sess && sess.statusLog) || [];
        return log[0] || null;
    }

    function resolveCastContacts(sess) {
        var st = chatStore();
        var cast =
            sess && Array.isArray(sess.cast) && sess.cast.length
                ? sess.cast
                : [{ contactId: sess && sess.contactId, chatId: sess && sess.chatId }];
        return cast
            .map(function (row) {
                var cid = String((row && row.contactId) || '').trim();
                var contact = st && cid && st.findContact ? st.findContact(cid) : null;
                if (!contact && cid) {
                    return { id: cid, name: cid, avatar: '' };
                }
                if (!contact) return null;
                return {
                    id: contact.id,
                    name: contact.name,
                    avatar: contact.avatar,
                    avatarBlobId: contact.avatarBlobId,
                    characterId: contact.characterId,
                    chronicleId: contact.chronicleId,
                    _contact: contact
                };
            })
            .filter(Boolean);
    }

    function resolveStatusAvatarSync(contact) {
        if (!contact) return '';
        var app = global.miyaOfflineApp;
        if (app && typeof app.findContactsAppAvatar === 'function') {
            var fromCt = app.findContactsAppAvatar(contact._contact || contact);
            if (fromCt) return fromCt;
        }
        if (app && typeof app.contactAvatar === 'function') {
            var url = app.contactAvatar(contact._contact || contact);
            if (url) return url;
        }
        var a = contact.avatar;
        if (typeof a === 'string' && a.trim()) return a.trim();
        if (a && a.url) return a.url;
        return '';
    }

    function avatarUrl(contact) {
        return resolveStatusAvatarSync(contact);
    }

    function hydrateStatusAvatars(root, cast) {
        if (!root) return;
        var app = global.miyaOfflineApp;
        var list = Array.isArray(cast) ? cast : [];
        root.querySelectorAll('img.xw-status__ava[data-xw-status-cid]').forEach(function (img) {
            var cid = img.getAttribute('data-xw-status-cid') || '';
            var contact =
                list.filter(function (c) {
                    return c && c.id === cid;
                })[0] || null;
            if (!contact) return;
            var full = contact._contact || contact;
            var sync = resolveStatusAvatarSync(contact);
            if (sync) {
                img.src = sync;
                img.hidden = false;
            }
            if (app && typeof app.resolveOfflineContactAvatarAsync === 'function') {
                app.resolveOfflineContactAvatarAsync(full).then(function (url) {
                    if (!url || !img.isConnected) return;
                    img.src = url;
                    img.hidden = false;
                    var ph = img.parentElement && img.parentElement.querySelector('.xw-status__ava--ph');
                    if (ph) ph.hidden = true;
                });
            }
        });
    }

    function panelShellHtml() {
        return (
            '<div class="xw-status" id="xw-status-panel" hidden aria-hidden="true">' +
            '<div class="xw-status__backdrop" data-xw-status-close></div>' +
            '<div class="xw-status__sheet" role="dialog" aria-modal="true" aria-labelledby="xw-status-title">' +
            '<header class="xw-status__head">' +
            '<div class="xw-status__head-text">' +
            '<p class="xw-status__kicker">STATUS</p>' +
            '<h2 class="xw-status__title" id="xw-status-title">本轮状态</h2></div>' +
            '<button type="button" class="xw-status__close" data-xw-status-close aria-label="关闭">×</button>' +
            '</header>' +
            '<div class="xw-status__tabs" id="xw-status-tabs" hidden></div>' +
            '<div class="xw-status__body" id="xw-status-body"></div>' +
            '<footer class="xw-status__foot">' +
            '<details class="xw-status__preset-fold">' +
            '<summary class="xw-status__preset-sum">' +
            '<span>状态模版</span>' +
            '<i class="xw-status__preset-chev" aria-hidden="true"></i></summary>' +
            '<div class="xw-status__preset-panel">' +
            '<label class="xw-status__preset-lab" for="xw-status-preset">选择模版</label>' +
            '<select class="xw-status__preset" id="xw-status-preset" aria-label="状态模版"></select>' +
            '<div class="xw-status__preset-actions">' +
            '<button type="button" class="xw-status__mini" data-xw-status-save>保存</button>' +
            '<button type="button" class="xw-status__mini" data-xw-status-del>删除</button>' +
            '<button type="button" class="xw-status__mini" data-xw-status-export>导出</button>' +
            '<button type="button" class="xw-status__mini" data-xw-status-import>导入</button>' +
            '<input type="file" id="xw-status-import-file" accept="application/json,.json" hidden multiple>' +
            '</div>' +
            '<p class="xw-status__hint">单人/多人共用；可保存线下预设，也可读取心声库；导入支持 miyastatus / miyavoice JSON</p>' +
            '</div></details></footer></div></div>'
        );
    }

    function ensurePanel() {
        var app = document.getElementById('miya-offline-app');
        if (!app) return null;
        if (panelEl && panelEl.isConnected && panelEl.querySelector('.xw-status__preset-fold') && panelEl.querySelector('[data-xw-status-save]')) return panelEl;
        if (panelEl && panelEl.isConnected) {
            try {
                panelEl.remove();
            } catch (e) {}
            panelEl = null;
        }
        var wrap = document.createElement('div');
        wrap.innerHTML = panelShellHtml();
        panelEl = wrap.firstChild;
        app.appendChild(panelEl);
        panelEl.addEventListener('click', function (e) {
            if (e.target.closest('[data-xw-status-close]')) {
                closePanel();
                return;
            }
            var tab = e.target.closest('[data-xw-status-tab]');
            if (tab) {
                viewState.activeContactId = tab.getAttribute('data-xw-status-tab') || 'all';
                paintPanel();
                return;
            }
            if (e.target.closest('[data-xw-status-save]')) {
                saveCurrentPresetFlow();
                return;
            }
            if (e.target.closest('[data-xw-status-del]')) {
                deleteCurrentPresetFlow();
                return;
            }
            if (e.target.closest('[data-xw-status-export]')) {
                exportCurrentPresetFlow();
                return;
            }
            if (e.target.closest('[data-xw-status-import]')) {
                var fileInp = panelEl.querySelector('#xw-status-import-file');
                if (fileInp) fileInp.click();
            }
        });
        var sel = panelEl.querySelector('#xw-status-preset');
        if (sel) {
            sel.addEventListener('change', function () {
                saveStatusSettings({ presetName: String(sel.value || '').trim() });
                paintPanel();
            });
        }
        var fileInp2 = panelEl.querySelector('#xw-status-import-file');
        if (fileInp2) {
            fileInp2.addEventListener('change', function () {
                importPresetFiles(fileInp2.files);
                fileInp2.value = '';
            });
        }
        return panelEl;
    }

    function fillPresetSelect() {
        if (!panelEl) return;
        var sel = panelEl.querySelector('#xw-status-preset');
        if (!sel) return;
        var cur = String((getStatusSettings().presetName) || '').trim();
        var opts = '<option value="">内置 · Ins 简约</option>';
        var offline = loadPresets();
        if (offline.length) {
            opts += '<optgroup label="线下预设">';
            offline.forEach(function (p) {
                var key = encodePresetKey('offline', p.name);
                opts +=
                    '<option value="' +
                    esc(key) +
                    '"' +
                    (key === cur || p.name === cur ? ' selected' : '') +
                    '>' +
                    esc(p.name) +
                    '</option>';
            });
            opts += '</optgroup>';
        }
        var mod = tplMod();
        if (mod && typeof mod.loadPresets === 'function') {
            var hv = mod.loadPresets() || [];
            if (hv.length) {
                opts += '<optgroup label="心声库（只读选用）">';
                hv.forEach(function (p) {
                    if (!p || !p.name) return;
                    var key = encodePresetKey('hv', p.name);
                    opts +=
                        '<option value="' +
                        esc(key) +
                        '"' +
                        (key === cur || p.name === cur ? ' selected' : '') +
                        '>' +
                        esc(p.name) +
                        '</option>';
                });
                opts += '</optgroup>';
            }
        }
        sel.innerHTML = opts;
        if (cur) sel.value = cur;
        if (sel.value !== cur && cur.indexOf(':') < 0) {
            /* 兼容旧纯名 */
            var offKey = encodePresetKey('offline', cur);
            var hvKey = encodePresetKey('hv', cur);
            if ([].some.call(sel.options, function (o) { return o.value === offKey; })) sel.value = offKey;
            else if ([].some.call(sel.options, function (o) { return o.value === hvKey; })) sel.value = hvKey;
        }
    }

    function currentSelectedPreset() {
        return resolveStatusPreset();
    }

    function saveCurrentPresetFlow() {
        var preset = currentSelectedPreset();
        if (!preset) {
            toast('内置模版无需保存；请先导入自定义或从心声库选用后再保存到线下');
            return;
        }
        var key = parsePresetKey(getStatusSettings().presetName);
        var defaultName = preset.name || '线下状态';
        var ask =
            global.miyaDialog && global.miyaDialog.prompt
                ? global.miyaDialog.prompt({
                      title: '保存线下状态预设',
                      message: key.source === 'hv' ? '将心声预设另存为线下预设名称' : '预设名称',
                      defaultValue: defaultName
                  })
                : Promise.resolve(window.prompt('预设名称', defaultName));
        ask.then(function (name) {
            if (name == null) return;
            var trimmed = String(name || '').trim();
            if (!trimmed) {
                toast('请输入名称');
                return;
            }
            var row = saveOfflinePreset(trimmed, {
                customPrompt: preset.customPrompt,
                fields: preset.fields,
                htmlTemplate: preset.htmlTemplate
            });
            if (row) {
                saveStatusSettings({ presetName: encodePresetKey('offline', row.name) });
                fillPresetSelect();
                toast('已保存「' + row.name + '」');
            } else toast('保存失败');
        });
    }

    function deleteCurrentPresetFlow() {
        var key = parsePresetKey(getStatusSettings().presetName);
        if (key.source !== 'offline' || !key.name) {
            toast('只能删除线下预设');
            return;
        }
        var ask =
            global.miyaDialog && global.miyaDialog.confirm
                ? global.miyaDialog.confirm({
                      title: '删除预设',
                      message: '确定删除线下状态预设「' + key.name + '」？'
                  })
                : Promise.resolve(window.confirm('删除「' + key.name + '」？'));
        ask.then(function (ok) {
            if (!ok) return;
            if (deleteOfflinePreset(key.name)) {
                fillPresetSelect();
                toast('已删除');
                paintPanel();
            }
        });
    }

    function buildExportPayload(preset) {
        var row = normalizePreset(preset);
        if (!row) return null;
        return {
            format: 'miyastatus',
            name: row.name,
            customPrompt: row.customPrompt,
            fields: row.fields.map(function (f) {
                return { name: f.name, requirement: f.requirement };
            }),
            htmlTemplate: row.htmlTemplate
        };
    }

    function exportCurrentPresetFlow() {
        var preset = currentSelectedPreset();
        if (!preset) {
            toast('内置模版无需导出；请先选择或导入自定义预设');
            return;
        }
        var payload = buildExportPayload(preset);
        if (!payload) {
            toast('导出失败');
            return;
        }
        try {
            var blob = new Blob([JSON.stringify(payload, null, 2)], {
                type: 'application/json;charset=utf-8'
            });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download =
                'miyastatus-' +
                String(payload.name || 'preset')
                    .replace(/[\\/:*?"<>|]+/g, '_')
                    .slice(0, 40) +
                '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () {
                try {
                    URL.revokeObjectURL(url);
                } catch (e) {}
            }, 1200);
            toast('已导出「' + payload.name + '」');
        } catch (e2) {
            toast('导出失败');
        }
    }

    function parseImportPayload(raw, fileName) {
        if (!raw || typeof raw !== 'object') return null;
        var format = String(raw.format || '').trim().toLowerCase();
        if (format && format !== 'miyastatus' && format !== 'miyavoice') return null;
        var name = String(raw.name || '').trim();
        if (!name && fileName) {
            name = String(fileName)
                .replace(/^.*[\\/]/, '')
                .replace(/\.json$/i, '')
                .replace(/^miyastatus[-_\s]*/i, '')
                .replace(/^miyavoice[-_\s]*/i, '')
                .trim();
        }
        return normalizePreset({
            name: name || '导入预设',
            customPrompt: raw.customPrompt,
            fields: raw.fields,
            htmlTemplate: raw.htmlTemplate
        });
    }

    function importPresetFiles(fileList) {
        var files = fileList ? Array.prototype.slice.call(fileList) : [];
        if (!files.length) return;
        var ok = 0;
        var fail = 0;
        var lastName = '';
        var chain = Promise.resolve();
        files.forEach(function (file) {
            chain = chain.then(function () {
                return new Promise(function (resolve) {
                    var reader = new FileReader();
                    reader.onload = function () {
                        try {
                            var raw = JSON.parse(String(reader.result || ''));
                            var row = parseImportPayload(raw, file && file.name);
                            if (!row) {
                                fail += 1;
                            } else {
                                saveOfflinePreset(row.name, row);
                                lastName = row.name;
                                ok += 1;
                            }
                        } catch (e) {
                            fail += 1;
                        }
                        resolve();
                    };
                    reader.onerror = function () {
                        fail += 1;
                        resolve();
                    };
                    reader.readAsText(file);
                });
            });
        });
        chain.then(function () {
            if (ok && lastName) {
                saveStatusSettings({ presetName: encodePresetKey('offline', lastName) });
            }
            fillPresetSelect();
            paintPanel();
            if (ok && !fail) toast('导入成功 ' + ok + ' 个');
            else if (ok) toast('导入完成：成功 ' + ok + '，失败 ' + fail);
            else toast('导入失败，请选择 miyastatus / miyavoice JSON');
        });
    }

    function renderBuiltinCard(entry, contact) {
        var fields = (entry && entry.fields) || {};
        var name = (entry && entry.roleName) || (contact && contact.name) || '角色';
        var ava = avatarUrl(contact);
        var cid = String((contact && contact.id) || (entry && entry.contactId) || '').trim();
        var rows = BUILTIN_FIELDS.map(function (f) {
            var v = String(fields[f.name] || '').trim() || '—';
            return (
                '<div class="xw-status__row">' +
                '<span class="xw-status__lab">' +
                esc(f.name) +
                '</span>' +
                '<p class="xw-status__val">' +
                esc(v) +
                '</p></div>'
            );
        }).join('');
        return (
            '<div class="xw-status__card">' +
            '<div class="xw-status__who">' +
            (ava
                ? '<img class="xw-status__ava" data-xw-status-cid="' +
                  esc(cid) +
                  '" src="' +
                  esc(ava) +
                  '" alt="">'
                : '<span class="xw-status__ava xw-status__ava--ph" aria-hidden="true"></span>' +
                  (cid
                      ? '<img class="xw-status__ava" data-xw-status-cid="' +
                        esc(cid) +
                        '" alt="" hidden>'
                      : '')) +
            '<div><strong>' +
            esc(name) +
            '</strong><span>本轮快照</span></div></div>' +
            rows +
            '</div>'
        );
    }

    function renderEntryCard(entry, contact) {
        var cid = String((contact && contact.id) || (entry && entry.contactId) || '').trim();
        var ava = avatarUrl(contact);
        var whoAva =
            ava
                ? '<img class="xw-status__ava" data-xw-status-cid="' +
                  esc(cid) +
                  '" src="' +
                  esc(ava) +
                  '" alt="">'
                : '<span class="xw-status__ava xw-status__ava--ph" aria-hidden="true"></span>' +
                  (cid
                      ? '<img class="xw-status__ava" data-xw-status-cid="' +
                        esc(cid) +
                        '" alt="" hidden>'
                      : '');
        if (!entry) {
            return (
                '<div class="xw-status__card xw-status__card--empty">' +
                '<div class="xw-status__who">' +
                whoAva +
                '<div><strong>' +
                esc((contact && contact.name) || '角色') +
                '</strong><span>暂无本轮状态</span></div></div></div>'
            );
        }
        if (entry.mode === 'custom') {
            return (
                '<div class="xw-status__card xw-status__card--custom" data-xw-status-entry="' +
                esc(entry.contactId || '') +
                '">' +
                '<div class="xw-status__who">' +
                whoAva +
                '<div><strong>' +
                esc(entry.roleName || (contact && contact.name) || '角色') +
                '</strong><span>自定义模版</span></div></div>' +
                '<div class="xw-status__custom" data-xw-status-mount></div></div>'
            );
        }
        return renderBuiltinCard(entry, contact);
    }

    function mountCustomCards(body, round, cast) {
        var mod = tplMod();
        if (!body || !mod) return;
        body.querySelectorAll('[data-xw-status-entry]').forEach(function (card) {
            var cid = card.getAttribute('data-xw-status-entry') || '';
            var entry =
                round &&
                (round.entries || []).filter(function (e) {
                    return e && e.contactId === cid;
                })[0];
            var contact =
                cast.filter(function (c) {
                    return c.id === cid;
                })[0] || null;
            var mount = card.querySelector('[data-xw-status-mount]');
            if (!entry || !mount) return;
            var tpl = String(entry.htmlTemplate || '').trim();
            if (!tpl && entry.presetName) {
                var p = findOfflinePreset(entry.presetName);
                if (!p && mod.findPreset) p = mod.findPreset(entry.presetName);
                if (p) tpl = String(p.htmlTemplate || '');
            }
            if (tpl && typeof mod.renderTemplate === 'function' && typeof mod.mountInteractiveHtml === 'function') {
                var html = mod.renderTemplate(tpl, entry.fields || {}, {
                    charAvatar: avatarUrl(contact),
                    userAvatar: ''
                });
                if (String(html || '').trim()) {
                    mod.mountInteractiveHtml(mount, html, {
                        frameClass: 'xw-status__iframe',
                        title: '线下状态'
                    });
                    return;
                }
            }
            var keys = Object.keys(entry.fields || {});
            mount.innerHTML = keys.length
                ? keys
                      .map(function (k) {
                          return (
                              '<div class="xw-status__row"><span class="xw-status__lab">' +
                              esc(k) +
                              '</span><p class="xw-status__val">' +
                              esc(String(entry.fields[k] || '')) +
                              '</p></div>'
                          );
                      })
                      .join('')
                : '<p class="xw-status__empty">字段为空</p>';
        });
    }

    function paintPanel() {
        if (!panelEl) return;
        fillPresetSelect();
        var st = apStore();
        var sess =
            st && viewState.chatId && viewState.sessionId
                ? st.getSession(viewState.chatId, viewState.sessionId)
                : null;
        var cast = resolveCastContacts(sess);
        var tabs = panelEl.querySelector('#xw-status-tabs');
        var body = panelEl.querySelector('#xw-status-body');
        var title = panelEl.querySelector('#xw-status-title');
        if (!body) return;
        if (title) {
            title.textContent = cast.length > 1 ? '本轮状态 · ' + cast.length + ' 人' : '本轮状态';
        }
        if (cast.length > 1 && tabs) {
            tabs.hidden = false;
            if (!viewState.activeContactId) viewState.activeContactId = 'all';
            var tabHtml =
                '<button type="button" class="xw-status__tab' +
                (viewState.activeContactId === 'all' ? ' is-on' : '') +
                '" data-xw-status-tab="all">全部</button>';
            cast.forEach(function (c) {
                var on = c.id === viewState.activeContactId;
                tabHtml +=
                    '<button type="button" class="xw-status__tab' +
                    (on ? ' is-on' : '') +
                    '" data-xw-status-tab="' +
                    esc(c.id) +
                    '">' +
                    esc(c.name) +
                    '</button>';
            });
            tabs.innerHTML = tabHtml;
        } else if (tabs) {
            tabs.hidden = true;
            tabs.innerHTML = '';
            viewState.activeContactId = cast[0] ? cast[0].id : 'all';
        }
        var round = latestRound(sess);
        var showAll = cast.length > 1 && viewState.activeContactId === 'all';
        var targets = showAll
            ? cast
            : cast.filter(function (c) {
                  return c.id === viewState.activeContactId;
              });
        if (!targets.length && cast[0]) targets = [cast[0]];
        if (!targets.length) {
            body.innerHTML = '<p class="xw-status__empty">本轮暂无状态</p>';
            return;
        }
        if (!round || !round.entries || !round.entries.length) {
            body.innerHTML =
                '<div class="xw-status__stack">' +
                targets
                    .map(function (c) {
                        return renderEntryCard(null, c);
                    })
                    .join('') +
                '</div>' +
                '<p class="xw-status__empty"><span>角色回复后会出现在这里</span></p>';
            hydrateStatusAvatars(body, cast);
            return;
        }
        body.innerHTML =
            '<div class="xw-status__stack">' +
            targets
                .map(function (c) {
                    var entry =
                        (round.entries || []).filter(function (e) {
                            return e && e.contactId === c.id;
                        })[0] || null;
                    return renderEntryCard(entry, c);
                })
                .join('') +
            '</div>';
        mountCustomCards(body, round, cast);
        hydrateStatusAvatars(body, cast);
    }

    function openPanel(ctx) {
        if (!isEnabled()) {
            toast('状态栏已在调参中关闭');
            return;
        }
        ctx = ctx && typeof ctx === 'object' ? ctx : {};
        viewState.chatId = String(ctx.chatId || '').trim();
        viewState.sessionId = String(ctx.sessionId || '').trim();
        viewState.contactId = String(ctx.contactId || '').trim();
        viewState.activeContactId = 'all';
        ensurePanel();
        if (!panelEl) return;
        paintPanel();
        panelEl.hidden = false;
        panelEl.setAttribute('aria-hidden', 'false');
        panelEl.classList.add('is-open');
    }

    function closePanel() {
        if (!panelEl) return;
        panelEl.classList.remove('is-open');
        panelEl.hidden = true;
        panelEl.setAttribute('aria-hidden', 'true');
    }

    var DEFAULT_FAB_ICON =
        '<svg class="xw-status-fab__icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="8.2"/>' +
        '<circle cx="12" cy="12" r="3.2"/>' +
        '</svg>';

    function getFabIconUrl() {
        return String((getStatusSettings().fabIconUrl) || '').trim();
    }

    function fabInnerHtml() {
        var url = getFabIconUrl();
        if (url) {
            return '<img class="xw-status-fab__img" src="' + esc(url) + '" alt="">';
        }
        return DEFAULT_FAB_ICON;
    }

    function applyFabAppearance() {
        ensureFab();
        if (!fabEl) return;
        var url = getFabIconUrl();
        fabEl.classList.toggle('is-custom', !!url);
        fabEl.innerHTML = fabInnerHtml();
    }

    function ensureFab() {
        var app = document.getElementById('miya-offline-app');
        if (!app) return null;
        if (fabEl && fabEl.isConnected) return fabEl;
        fabEl = document.createElement('button');
        fabEl.type = 'button';
        fabEl.id = 'xw-status-fab';
        fabEl.className = 'xw-status-fab';
        fabEl.setAttribute('aria-label', '本轮状态');
        fabEl.title = '本轮状态';
        fabEl.innerHTML = fabInnerHtml();
        if (getFabIconUrl()) fabEl.classList.add('is-custom');
        app.appendChild(fabEl);
        var pos = loadFabPos();
        if (pos) {
            fabEl.style.left = pos.x + 'px';
            fabEl.style.top = pos.y + 'px';
            fabEl.style.right = 'auto';
            fabEl.style.bottom = 'auto';
        }
        bindFabDrag(fabEl);
        return fabEl;
    }

    function bindFabDrag(el) {
        var moved = false;
        function onDown(ev) {
            if (ev.type === 'mousedown' && ev.button !== 0) return;
            var point = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
            var rect = el.getBoundingClientRect();
            dragState = {
                ox: point.clientX - rect.left,
                oy: point.clientY - rect.top,
                moved: false
            };
            moved = false;
            el.classList.add('is-dragging');
            ev.preventDefault();
        }
        function onMove(ev) {
            if (!dragState) return;
            var point = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
            var app = document.getElementById('miya-offline-app');
            var box = app
                ? app.getBoundingClientRect()
                : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
            var x = point.clientX - box.left - dragState.ox;
            var y = point.clientY - box.top - dragState.oy;
            var maxX = Math.max(8, box.width - el.offsetWidth - 8);
            var maxY = Math.max(8, box.height - el.offsetHeight - 8);
            x = Math.min(maxX, Math.max(8, x));
            y = Math.min(maxY, Math.max(8, y));
            el.style.left = x + 'px';
            el.style.top = y + 'px';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            dragState.moved = true;
            moved = true;
            if (ev.cancelable) ev.preventDefault();
        }
        function onUp() {
            if (!dragState) return;
            el.classList.remove('is-dragging');
            if (dragState.moved) {
                saveFabPos({
                    x: parseFloat(el.style.left) || 0,
                    y: parseFloat(el.style.top) || 0
                });
            }
            dragState = null;
        }
        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onUp);
        window.addEventListener('touchend', onUp);
        el.addEventListener('click', function (e) {
            if (moved) {
                e.preventDefault();
                e.stopPropagation();
                moved = false;
                return;
            }
            var appUi = global.miyaOfflineApp;
            var ctx = appUi && typeof appUi.getStatusContext === 'function' ? appUi.getStatusContext() : null;
            if (!ctx || !ctx.chatId) return;
            openPanel(ctx);
        });
    }

    function syncFab(visible) {
        ensureFab();
        if (!fabEl) return;
        applyFabAppearance();
        var show = !!visible && isEnabled();
        fabEl.hidden = !show;
        fabEl.setAttribute('aria-hidden', show ? 'false' : 'true');
        fabEl.classList.toggle('is-show', show);
    }

    function hideAll() {
        closePanel();
        syncFab(false);
    }

    global.MiyaOfflineStatus = {
        isEnabled: isEnabled,
        buildStatusRulesBlock: buildStatusRulesBlock,
        parseStatusFromReply: parseStatusFromReply,
        stripStatusFromText: stripStatusFromText,
        appendStatusLog: appendStatusLog,
        openPanel: openPanel,
        closePanel: closePanel,
        syncFab: syncFab,
        hideAll: hideAll,
        ensureFab: ensureFab,
        applyFabAppearance: applyFabAppearance,
        getStatusSettings: getStatusSettings,
        resolveStatusPreset: resolveStatusPreset,
        loadPresets: loadPresets,
        saveOfflinePreset: saveOfflinePreset,
        deleteOfflinePreset: deleteOfflinePreset,
        builtinFields: BUILTIN_FIELDS,
        defaultFabIconHtml: DEFAULT_FAB_ICON
    };
})(window);
