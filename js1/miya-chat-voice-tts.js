(function (global) {
    'use strict';

    var API_CONFIG_KEY = 'miya-api-config';

    var voiceTtsActiveAudio = null;
    var voiceTtsActiveObjectUrl = null;
    var voiceTtsActivePlayBtn = null;
    var voiceTtsActiveDurEl = null;
    var voiceTtsActiveTimeUpdateTimer = null;
    var voiceTtsKeepAliveHeld = false;
    var voiceTtsPlayGen = 0;
    var voiceTtsBusyKey = '';

    function escAttrSelector(id) {
        return String(id || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function resolveLiveMsgRow(msgId) {
        var mid = String(msgId || '').trim();
        if (!mid) return null;
        var sc = document.getElementById('qq-room-scroll');
        if (!sc) return null;
        var safe = escAttrSelector(mid);
        return (
            sc.querySelector('.qq-room__row[data-msg-id="' + safe + '"]') ||
            sc.querySelector('.qq-room__sys[data-msg-id="' + safe + '"]')
        );
    }

    function resolvePlayUi(msgRow, msgId) {
        var row = msgRow && msgRow.isConnected ? msgRow : resolveLiveMsgRow(msgId);
        if (!row) return { row: null, playBtn: null, durEl: null };
        return {
            row: row,
            playBtn: row.querySelector('[data-mq-voice-play]'),
            durEl:
                row.querySelector('[data-mq-voice-tts-dur]') ||
                row.querySelector('.qq-card-voice__dur')
        };
    }

    function holdKeepAliveForVoice() {
        if (voiceTtsKeepAliveHeld) return;
        var settings = global.miyaSettingsApp;
        if (settings && typeof settings.holdKeepAliveForMedia === 'function') {
            settings.holdKeepAliveForMedia();
            voiceTtsKeepAliveHeld = true;
        }
    }

    function releaseKeepAliveForVoice() {
        if (!voiceTtsKeepAliveHeld) return;
        voiceTtsKeepAliveHeld = false;
        var settings = global.miyaSettingsApp;
        if (settings && typeof settings.releaseKeepAliveForMedia === 'function') {
            settings.releaseKeepAliveForMedia();
        }
    }

    function toast(msg) {
        var text = String(msg || '');
        var whisperView = document.getElementById('cp-view-whisper');
        if (whisperView && !whisperView.hidden) {
            if (global.miyaCoupleApp && typeof global.miyaCoupleApp.toast === 'function') {
                global.miyaCoupleApp.toast(text);
                return;
            }
            var cpToast = document.getElementById('cp-toast');
            if (cpToast) {
                cpToast.textContent = text;
                cpToast.classList.add('is-show');
                clearTimeout(cpToast._t);
                cpToast._t = setTimeout(function () {
                    cpToast.classList.remove('is-show');
                }, 2400);
                return;
            }
        }
        if (global.miyaChatRoom && typeof global.miyaChatRoom.toast === 'function') {
            global.miyaChatRoom.toast(text);
            return;
        }
        var el = document.getElementById('qq-room-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'qq-room-toast';
            el.className = 'qq-room-toast';
            document.body.appendChild(el);
        }
        el.textContent = text;
        el.classList.add('is-show');
        clearTimeout(el._t);
        el._t = setTimeout(function () {
            el.classList.remove('is-show');
        }, 2200);
    }

    function resolveVoiceConfig(chatId, contactId) {
        var st = store();
        var voiceId = '';
        var langBoost = 'auto';
        if (!st) return { voiceId: voiceId, langBoost: langBoost };
        if (chatId && typeof st.getChatSettings === 'function') {
            var cs = st.getChatSettings(chatId);
            voiceId = String((cs && cs.minimaxVoiceId) || '').trim();
            langBoost = String((cs && cs.minimaxLanguageBoost) || 'auto').trim() || 'auto';
        }
        if (!voiceId && contactId && typeof st.findContact === 'function') {
            var contact = st.findContact(contactId);
            var raw = contact && contact.chatSettings;
            if (raw && typeof raw === 'object') {
                voiceId = String(raw.minimaxVoiceId || '').trim();
                if (raw.minimaxLanguageBoost) {
                    langBoost = String(raw.minimaxLanguageBoost).trim() || 'auto';
                }
            }
        }
        return { voiceId: voiceId, langBoost: langBoost };
    }

    function store() {
        return global.miyaChatStore || null;
    }

    function activeProfileId() {
        var st = store();
        if (!st || typeof st.getActiveProfile !== 'function') return 'default';
        var p = st.getActiveProfile();
        return p && p.id ? String(p.id) : 'default';
    }

    function cleanupVoiceTtsPlaybackAll() {
        if (voiceTtsActiveTimeUpdateTimer) {
            clearInterval(voiceTtsActiveTimeUpdateTimer);
            voiceTtsActiveTimeUpdateTimer = null;
        }
        if (voiceTtsActiveAudio) {
            try {
                voiceTtsActiveAudio.pause();
                voiceTtsActiveAudio.removeAttribute('src');
                voiceTtsActiveAudio.load();
            } catch (_) {}
            voiceTtsActiveAudio = null;
        }
        if (voiceTtsActiveObjectUrl) {
            try {
                URL.revokeObjectURL(voiceTtsActiveObjectUrl);
            } catch (_) {}
            voiceTtsActiveObjectUrl = null;
        }
        if (voiceTtsActivePlayBtn) {
            try {
                voiceTtsActivePlayBtn.classList.remove('is-playing');
            } catch (_) {}
        }
        voiceTtsActivePlayBtn = null;
        voiceTtsActiveDurEl = null;
        releaseKeepAliveForVoice();
    }

    var MINIMAX_TTS_ENDPOINTS = ['https://api.minimax.io', 'https://api.minimaxi.com'];

    function normalizeMinimaxTtsBaseUrl(u) {
        var s = String(u || '')
            .trim()
            .replace(/\/+$/, '');
        var low = s.toLowerCase();
        if (low === 'https://api.minimax.com' || low === 'http://api.minimax.com') {
            return 'https://api.minimaxi.com';
        }
        return s;
    }

    function defaultMinimaxTtsSpeechModel(mm) {
        var s = String(mm && mm.model != null ? mm.model : '').trim();
        return s || 'speech-02-turbo';
    }

    function getApiConfigCached() {
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        return {};
    }

    function ensureMinimaxTtsConfigForPlay(done) {
        var cfg = getApiConfigCached();
        var mm = cfg.minimaxTts && typeof cfg.minimaxTts === 'object' ? cfg.minimaxTts : {};
        var hasCore = String(mm.apiKey || '').trim() && String(mm.groupId || '').trim();
        if (hasCore) {
            done(mm);
            return;
        }
        var needIdb = false;
        try {
            var raw = localStorage.getItem(API_CONFIG_KEY);
            if (raw) {
                var p = JSON.parse(raw);
                if (p && p.__storedInIdb === true) needIdb = true;
            }
        } catch (e0) {}
        if (needIdb && typeof global.miyaReadLsJsonKey === 'function') {
            global
                .miyaReadLsJsonKey(API_CONFIG_KEY, null)
                .then(function (v) {
                    var mm2 = v && v.minimaxTts && typeof v.minimaxTts === 'object' ? v.minimaxTts : {};
                    if (v && typeof v === 'object' && typeof global.miyaSetApiConfig === 'function') {
                        global.miyaSetApiConfig(v);
                    }
                    done(mm2);
                })
                .catch(function () {
                    done(mm);
                });
            return;
        }
        done(mm);
    }

    function hexToUint8ArrayMinimax(hex) {
        var s = String(hex || '').replace(/\s/g, '');
        if (!s.length || s.length % 2) return null;
        try {
            var out = new Uint8Array(s.length / 2);
            for (var i = 0; i < out.length; i++) {
                out[i] = parseInt(s.substr(i * 2, 2), 16);
            }
            return out;
        } catch (_) {
            return null;
        }
    }

    function voiceTtsStableMessageKey(msg) {
        if (!msg || typeof msg !== 'object') return 'nil';
        if (msg.id) return String(msg.id);
        var ts = typeof msg.createdAt === 'number' && !Number.isNaN(msg.createdAt) ? msg.createdAt : 0;
        var tx = String(msg.voiceText || msg.content || '');
        var h = 5381;
        for (var i = 0; i < tx.length; i++) {
            h = (h << 5) + h + tx.charCodeAt(i);
            h = h | 0;
        }
        return 'legacy_' + ts + '_' + (h >>> 0).toString(36);
    }

    function chatVoiceTtsIdbKey(chatId, msg) {
        return (
            'miya:voiceTts:' +
            activeProfileId() +
            ':' +
            String(chatId || '') +
            ':' +
            voiceTtsStableMessageKey(msg)
        );
    }

    function voiceTtsCacheMatchesMsg(msg, voiceId, langBoost, storageKey) {
        if (
            !msg ||
            !msg.voiceTtsIdbKey ||
            String(msg.voiceTtsIdbKey) !== String(storageKey || '') ||
            String(msg.voiceTtsVoiceId || '') !== String(voiceId || '') ||
            String(msg.voiceTtsLanguageBoost || '') !== String(langBoost || '')
        ) {
            return false;
        }
        /* 旧缓存可能没有 model 字段，仍视为命中 */
        return true;
    }

    function stripVoiceTtsFieldsFromMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        var st = store();
        if (msg.voiceTtsIdbKey && st && typeof st.idbDeleteRecord === 'function') {
            st.idbDeleteRecord(String(msg.voiceTtsIdbKey));
        }
        delete msg.voiceTtsIdbKey;
        delete msg.voiceTtsVoiceId;
        delete msg.voiceTtsLanguageBoost;
        delete msg.voiceTtsModel;
        delete msg.voiceTtsDurationSec;
    }

    function idbGetRecord(key) {
        var st = store();
        if (!st || typeof st.idbGetRecord !== 'function') return Promise.resolve(null);
        return st.idbGetRecord(key);
    }

    function idbPutRecord(key, value) {
        var st = store();
        if (!st || typeof st.idbPutRecord !== 'function') return Promise.reject(new Error('no_idb'));
        return st.idbPutRecord(key, value);
    }

    function orderedMinimaxEndpoints(mm) {
        var preferred = normalizeMinimaxTtsBaseUrl(mm && mm.baseUrl);
        var list = MINIMAX_TTS_ENDPOINTS.slice();
        if (preferred && list.indexOf(preferred) >= 0) {
            list = [preferred].concat(list.filter(function (u) { return u !== preferred; }));
        }
        return list;
    }

    function persistMinimaxLastEndpoint(baseUrl) {
        if (typeof global.miyaSetApiConfig !== 'function') return;
        var cfg = getApiConfigCached();
        var mm = cfg.minimaxTts && typeof cfg.minimaxTts === 'object' ? cfg.minimaxTts : {};
        if (normalizeMinimaxTtsBaseUrl(mm.baseUrl) === normalizeMinimaxTtsBaseUrl(baseUrl)) return;
        global.miyaSetApiConfig(Object.assign({}, cfg, {
            minimaxTts: Object.assign({}, mm, { baseUrl: normalizeMinimaxTtsBaseUrl(baseUrl) })
        }));
    }

    function fetchMinimaxTtsOnce(base, mm, text, voiceId, languageBoost) {
        var apiKey = String(mm.apiKey || '').trim();
        var groupId = String(mm.groupId || '').trim();
        var model = defaultMinimaxTtsSpeechModel(mm);
        var speedRaw = mm.speed != null ? Number(mm.speed) : 1;
        var speed = Number.isFinite(speedRaw) ? Math.min(2, Math.max(0.5, speedRaw)) : 1;
        var url = normalizeMinimaxTtsBaseUrl(base) + '/v1/t2a_v2?GroupId=' + encodeURIComponent(groupId);
        var body = {
            model: model,
            text: String(text || ''),
            stream: false,
            language_boost: String(languageBoost || 'auto').trim() || 'auto',
            output_format: 'hex',
            voice_setting: {
                voice_id: String(voiceId || '').trim(),
                speed: speed,
                vol: 1,
                pitch: 0
            },
            audio_setting: {
                sample_rate: 32000,
                bitrate: 128000,
                format: 'mp3',
                channel: 1
            }
        };
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + apiKey
            },
            body: JSON.stringify(body)
        }).then(function (r) {
            return r.text().then(function (t) {
                var j = {};
                try {
                    j = JSON.parse(t);
                } catch (_) {}
                if (!r.ok) {
                    throw new Error(
                        '语音合成失败 HTTP ' + r.status + (t ? ': ' + String(t).slice(0, 200) : '')
                    );
                }
                var br = j.base_resp || j.baseResp || {};
                if (br.status_code != null && Number(br.status_code) !== 0) {
                    throw new Error(String(br.status_msg || 'MiniMax 错误') + ' (' + String(br.status_code) + ')');
                }
                var data = j.data && typeof j.data === 'object' ? j.data : {};
                var audioHex = data.audio != null ? data.audio : j.audio;
                if (audioHex == null || audioHex === '') throw new Error('未返回音频数据');
                var bytes = hexToUint8ArrayMinimax(audioHex);
                if (!bytes || !bytes.length) throw new Error('音频解码失败');
                var extra = j.extra_info || j.extraInfo || {};
                return { bytes: bytes, extra: extra, model: model, baseUrl: normalizeMinimaxTtsBaseUrl(base) };
            });
        });
    }

    function fetchMinimaxTtsMp3Bytes(mm, text, voiceId, languageBoost) {
        var endpoints = orderedMinimaxEndpoints(mm);
        var lastErr = null;
        function tryAt(i) {
            if (i >= endpoints.length) return Promise.reject(lastErr || new Error('语音合成失败'));
            return fetchMinimaxTtsOnce(endpoints[i], mm, text, voiceId, languageBoost)
                .then(function (res) {
                    if (res.baseUrl) persistMinimaxLastEndpoint(res.baseUrl);
                    return res;
                })
                .catch(function (e) {
                    lastErr = e;
                    return tryAt(i + 1);
                });
        }
        return tryAt(0);
    }

    function applyTtsPrompt(mm, plainText) {
        var prompt = String(mm && mm.ttsPrompt || '').trim();
        var text = String(plainText || '').trim();
        if (!prompt) return text;
        return prompt + text;
    }

    function playVoiceTtsFromBlob(msgRow, blob, hintDurationSec, msgId) {
        cleanupVoiceTtsPlaybackAll();
        var ui = resolvePlayUi(msgRow, msgId);
        var playBtn = ui.playBtn;
        var durEl = ui.durEl;
        if (!blob) return;
        var objectUrl = URL.createObjectURL(blob);
        voiceTtsActiveObjectUrl = objectUrl;
        voiceTtsActivePlayBtn = playBtn;
        voiceTtsActiveDurEl = durEl;
        var audio = new Audio(objectUrl);
        voiceTtsActiveAudio = audio;
        if (playBtn) playBtn.classList.add('is-playing');
        holdKeepAliveForVoice();

        function syncLabel() {
            var el = voiceTtsActiveDurEl;
            var a = voiceTtsActiveAudio;
            if (!el || !a) return;
            if (!el.isConnected && msgId) {
                var live = resolvePlayUi(null, msgId);
                if (live.durEl) {
                    voiceTtsActiveDurEl = live.durEl;
                    el = live.durEl;
                } else {
                    return;
                }
            }
            if (playBtn && !playBtn.isConnected && msgId) {
                var liveBtn = resolvePlayUi(null, msgId).playBtn;
                if (liveBtn) {
                    voiceTtsActivePlayBtn = liveBtn;
                    liveBtn.classList.add('is-playing');
                }
            }
            var total = a.duration;
            if (!Number.isFinite(total) || total <= 0) total = Number(hintDurationSec) || 0;
            if (!Number.isFinite(total) || total <= 0) {
                el.textContent = '…';
                return;
            }
            var cur = Number(a.currentTime) || 0;
            var rem = Math.max(0, total - cur);
            el.textContent = Math.max(0, Math.ceil(rem)) + '″';
        }

        audio.addEventListener('loadedmetadata', syncLabel);
        audio.addEventListener('timeupdate', syncLabel);
        voiceTtsActiveTimeUpdateTimer = setInterval(syncLabel, 250);

        audio.onended = function () {
            var dLocal = voiceTtsActiveDurEl || durEl;
            var durNum = audio.duration;
            cleanupVoiceTtsPlaybackAll();
            if (dLocal && dLocal.isConnected && Number.isFinite(durNum) && durNum > 0) {
                dLocal.textContent = Math.round(durNum) + '″';
            } else if (msgId && Number.isFinite(durNum) && durNum > 0) {
                var liveDur = resolvePlayUi(null, msgId).durEl;
                if (liveDur) liveDur.textContent = Math.round(durNum) + '″';
            }
        };
        audio.onerror = function () {
            cleanupVoiceTtsPlaybackAll();
            toast('音频播放失败');
        };

        var pr = audio.play();
        if (pr && typeof pr.catch === 'function') {
            pr.catch(function () {
                cleanupVoiceTtsPlaybackAll();
                toast('无法播放音频');
            });
        }
    }

    function getVoicePlainText(msg) {
        if (!msg) return '';
        var fmt = global.MiyaChatOnlineFormat;
        if (fmt && typeof fmt.parseDisplayPayload === 'function') {
            var payload = fmt.parseDisplayPayload(msg);
            if (payload && payload.kind === 'voice') {
                return String(payload.voiceText || payload.text || msg.voiceText || '').trim();
            }
        }
        return String(msg.voiceText || '').trim();
    }

    function handlePlay(msgRow, msgId, chatId) {
        if (!msgId || !chatId) return;
        var st = store();
        if (!st) return;
        var msg = st.findMessage(chatId, msgId);
        if (!msg || msg.role !== 'assistant') {
            toast('仅支持播放角色发送的语音');
            return;
        }
        if (msg.type !== 'voice') {
            toast('本条不是语音消息');
            return;
        }
        var plain = getVoicePlainText(msg);
        if (!plain) {
            toast('无法从本条解析语音台词');
            return;
        }
        var cs = st.getChatSettings(chatId);
        var voiceId = String((cs && cs.minimaxVoiceId) || '').trim();
        if (!voiceId) {
            toast('请先在聊天设置中填写音色');
            return;
        }
        var langBoost = String((cs && cs.minimaxLanguageBoost) || 'auto').trim() || 'auto';

        var busyKey = String(chatId) + ':' + String(msgId);
        if (voiceTtsBusyKey === busyKey) return;
        voiceTtsBusyKey = busyKey;
        var playGen = ++voiceTtsPlayGen;

        var ui0 = resolvePlayUi(msgRow, msgId);
        var playBtn = ui0.playBtn;
        if (playBtn) playBtn.setAttribute('data-voice-tts-busy', '1');

        var storageKey = chatVoiceTtsIdbKey(chatId, msg);
        var hintDur =
            typeof msg.voiceTtsDurationSec === 'number' &&
            Number.isFinite(msg.voiceTtsDurationSec) &&
            msg.voiceTtsDurationSec > 0
                ? msg.voiceTtsDurationSec
                : 0;

        function clearBusy(forceBtn) {
            if (voiceTtsBusyKey === busyKey) voiceTtsBusyKey = '';
            var liveBtn = resolvePlayUi(null, msgId).playBtn || playBtn;
            if (liveBtn) liveBtn.removeAttribute('data-voice-tts-busy');
            if (forceBtn && playBtn && playBtn !== liveBtn) playBtn.removeAttribute('data-voice-tts-busy');
        }

        function stillCurrent() {
            return playGen === voiceTtsPlayGen;
        }

        function tryPlayStored(stored) {
            var b = stored && stored.blob;
            if (!b || typeof b.slice !== 'function') return false;
            if (!stillCurrent()) return true;
            playVoiceTtsFromBlob(resolveLiveMsgRow(msgId) || msgRow, b, hintDur || undefined, msgId);
            return true;
        }

        function runSynthesize(mmForReq, speechModel) {
            var synthText = applyTtsPrompt(mmForReq, plain);
            fetchMinimaxTtsMp3Bytes(mmForReq, synthText, voiceId, langBoost)
                .then(function (res) {
                    if (!stillCurrent()) return;
                    var blob = new Blob([res.bytes], { type: 'audio/mpeg' });
                    var extra = res.extra && typeof res.extra === 'object' ? res.extra : {};
                    var audioLenMs = Number(extra.audio_length);
                    var durGuess =
                        Number.isFinite(audioLenMs) && audioLenMs > 0
                            ? Math.max(1, Math.round(audioLenMs / 1000))
                            : 0;
                    return idbPutRecord(storageKey, {
                        blob: blob,
                        mime: 'audio/mpeg',
                        updatedAt: Date.now()
                    })
                        .then(function () {
                            return st.updateMessage(chatId, msgId, {
                                voiceTtsIdbKey: storageKey,
                                voiceTtsVoiceId: voiceId,
                                voiceTtsLanguageBoost: langBoost,
                                voiceTtsModel: speechModel,
                                voiceTtsDurationSec: durGuess
                            });
                        })
                        .then(function () {
                            if (!stillCurrent()) return;
                            playVoiceTtsFromBlob(
                                resolveLiveMsgRow(msgId) || msgRow,
                                blob,
                                durGuess || hintDur || undefined,
                                msgId
                            );
                        });
                })
                .catch(function (e) {
                    if (stillCurrent()) toast((e && e.message) || '合成失败');
                })
                .finally(function () {
                    clearBusy(true);
                });
        }

        function startSynthesize() {
            ensureMinimaxTtsConfigForPlay(function (mm) {
                if (!stillCurrent()) {
                    clearBusy(true);
                    return;
                }
                if (!String(mm.apiKey || '').trim() || !String(mm.groupId || '').trim()) {
                    clearBusy(true);
                    toast('请先在系统设置中配置 MiniMax 语音 API 并保存');
                    return;
                }
                var speechModel = defaultMinimaxTtsSpeechModel(mm);
                if (!voiceTtsCacheMatchesMsg(msg, voiceId, langBoost, storageKey)) {
                    delete msg.voiceTtsIdbKey;
                    delete msg.voiceTtsVoiceId;
                    delete msg.voiceTtsLanguageBoost;
                    delete msg.voiceTtsModel;
                    delete msg.voiceTtsDurationSec;
                }
                runSynthesize(Object.assign({}, mm, { model: speechModel }), speechModel);
            });
        }

        if (voiceTtsCacheMatchesMsg(msg, voiceId, langBoost, storageKey)) {
            idbGetRecord(storageKey)
                .then(function (stored) {
                    if (!stillCurrent()) {
                        clearBusy(true);
                        return;
                    }
                    if (tryPlayStored(stored)) {
                        clearBusy(true);
                        return;
                    }
                    startSynthesize();
                })
                .catch(function () {
                    if (!stillCurrent()) {
                        clearBusy(true);
                        return;
                    }
                    startSynthesize();
                });
            return;
        }

        startSynthesize();
    }

    function stopPlayback() {
        voiceTtsPlayGen += 1;
        voiceTtsBusyKey = '';
        cleanupVoiceTtsPlaybackAll();
        try {
            document.querySelectorAll('[data-mq-voice-play][data-voice-tts-busy]').forEach(function (btn) {
                btn.removeAttribute('data-voice-tts-busy');
            });
            document.querySelectorAll('[data-mq-voice-play][data-voice-rec-busy]').forEach(function (btn) {
                btn.removeAttribute('data-voice-rec-busy');
            });
        } catch (_) {}
    }

    function synthesizeAndPlayPlain(chatId, plain, done, contactId) {
        var st = store();
        if (!st) {
            toast('聊天模块未就绪');
            return;
        }
        var text = String(plain || '').trim();
        if (!text) {
            toast('没有可朗读的文本');
            return;
        }
        var voiceCfg = resolveVoiceConfig(chatId, contactId);
        var voiceId = voiceCfg.voiceId;
        if (!voiceId) {
            toast('请先在角色聊天设置里填写 MiniMax 音色 ID');
            return;
        }
        var langBoost = voiceCfg.langBoost;
        ensureMinimaxTtsConfigForPlay(function (mm) {
            if (!String(mm.apiKey || '').trim() || !String(mm.groupId || '').trim()) {
                toast('请先在系统设置中配置 MiniMax 语音 API（Key + GroupId）并保存');
                return;
            }
            var speechModel = defaultMinimaxTtsSpeechModel(mm);
            var synthText = applyTtsPrompt(mm, text);
            fetchMinimaxTtsMp3Bytes(mm, synthText, voiceId, langBoost)
                .then(function (res) {
                    var blob = new Blob([res.bytes], { type: 'audio/mpeg' });
                    var ghost = document.createElement('div');
                    playVoiceTtsFromBlob(ghost, blob, undefined);
                    if (done) done();
                })
                .catch(function (e) {
                    toast((e && e.message) || '语音合成失败');
                });
        });
    }

    function playPlainText(text, chatId, contactId) {
        synthesizeAndPlayPlain(chatId, text, null, contactId);
    }

    function whisperLineIdbKey(contactId, sessionId, lineId) {
        return (
            'miya:whisperTts:' +
            activeProfileId() +
            ':' +
            String(contactId || '') +
            ':' +
            String(sessionId || '') +
            ':' +
            String(lineId || '')
        );
    }

    function playWhisperLine(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var text = String(opts.text || '').trim();
        var chatId = opts.chatId;
        var contactId = opts.contactId;
        var sessionId = opts.sessionId;
        var lineId = opts.lineId;
        var hostEl = opts.hostEl;
        var playBtn = opts.playBtn;
        if (!text) {
            toast('没有可朗读的文本');
            return;
        }
        var st = store();
        if (!st) {
            toast('聊天模块未就绪');
            return;
        }
        var voiceCfg = resolveVoiceConfig(chatId, contactId);
        var voiceId = voiceCfg.voiceId;
        if (!voiceId) {
            toast('请先在角色聊天设置里填写 MiniMax 音色 ID');
            return;
        }
        var langBoost = voiceCfg.langBoost;
        var storageKey = whisperLineIdbKey(contactId, sessionId, lineId);
        var row = hostEl || (playBtn && playBtn.parentElement) || document.createElement('div');

        if (playBtn && playBtn.getAttribute('data-voice-tts-busy') === '1') return;
        if (playBtn) playBtn.setAttribute('data-voice-tts-busy', '1');

        function clearBusy() {
            if (playBtn) playBtn.removeAttribute('data-voice-tts-busy');
        }

        function tryPlayStored(stored) {
            var b = stored && stored.blob;
            if (!b || typeof b.slice !== 'function') return false;
            playVoiceTtsFromBlob(row, b, stored.durationSec || undefined);
            clearBusy();
            return true;
        }

        function runSynthesize(mmForReq, speechModel) {
            var synthText = applyTtsPrompt(mmForReq, text);
            fetchMinimaxTtsMp3Bytes(mmForReq, synthText, voiceId, langBoost)
                .then(function (res) {
                    var blob = new Blob([res.bytes], { type: 'audio/mpeg' });
                    var extra = res.extra && typeof res.extra === 'object' ? res.extra : {};
                    var audioLenMs = Number(extra.audio_length);
                    var durGuess =
                        Number.isFinite(audioLenMs) && audioLenMs > 0
                            ? Math.max(1, Math.round(audioLenMs / 1000))
                            : 0;
                    return idbPutRecord(storageKey, {
                        blob: blob,
                        mime: 'audio/mpeg',
                        voiceId: voiceId,
                        langBoost: langBoost,
                        model: speechModel,
                        durationSec: durGuess,
                        updatedAt: Date.now()
                    })
                        .catch(function () {})
                        .then(function () {
                            playVoiceTtsFromBlob(row, blob, durGuess || undefined);
                        });
                })
                .catch(function (e) {
                    toast((e && e.message) || '语音合成失败');
                })
                .finally(clearBusy);
        }

        function startSynthesize() {
            ensureMinimaxTtsConfigForPlay(function (mm) {
                if (!String(mm.apiKey || '').trim() || !String(mm.groupId || '').trim()) {
                    clearBusy();
                    toast('请先在系统设置中配置 MiniMax 语音 API（Key + GroupId）并保存');
                    return;
                }
                var speechModel = defaultMinimaxTtsSpeechModel(mm);
                runSynthesize(Object.assign({}, mm, { model: speechModel }), speechModel);
            });
        }

        idbGetRecord(storageKey)
            .then(function (stored) {
                if (
                    stored &&
                    stored.blob &&
                    String(stored.voiceId || '') === String(voiceId) &&
                    String(stored.langBoost || '') === String(langBoost)
                ) {
                    if (tryPlayStored(stored)) return;
                }
                startSynthesize();
            })
            .catch(function () {
                startSynthesize();
            });
    }

    global.MiyaChatVoiceTts = {
        handlePlay: handlePlay,
        stopPlayback: stopPlayback,
        playPlainText: playPlainText,
        playWhisperLine: playWhisperLine,
        resolveVoiceConfig: resolveVoiceConfig,
        whisperLineIdbKey: whisperLineIdbKey,
        playFromBlob: playVoiceTtsFromBlob,
        chatVoiceTtsIdbKey: chatVoiceTtsIdbKey
    };
})(window);
