(function (global) {
    'use strict';

    var MAX_RECORD_SEC = 60;

    function toast(msg) {
        if (global.miyaChatRoom && typeof global.miyaChatRoom.toast === 'function') {
            global.miyaChatRoom.toast(msg);
            return;
        }
        var el = document.getElementById('qq-room-toast');
        if (!el) return;
        el.textContent = String(msg || '');
        el.classList.add('is-show');
        clearTimeout(el._t);
        el._t = setTimeout(function () {
            el.classList.remove('is-show');
        }, 2200);
    }

    function store() {
        return global.miyaChatStore || null;
    }

    function pickRecorderMime() {
        if (!global.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
        var types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/mp4',
            'audio/aac',
            'audio/ogg;codecs=opus',
            'audio/ogg'
        ];
        for (var i = 0; i < types.length; i++) {
            if (MediaRecorder.isTypeSupported(types[i])) return types[i];
        }
        return '';
    }

    function getSpeechRecognitionCtor() {
        return global.SpeechRecognition || global.webkitSpeechRecognition || null;
    }

    function formatTimer(sec) {
        var s = Math.max(0, Math.floor(sec));
        var m = Math.floor(s / 60);
        var r = s % 60;
        return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
    }

    function probeAudioDurationSec(blob) {
        return new Promise(function (resolve) {
            if (!blob) {
                resolve(0);
                return;
            }
            var url = '';
            try {
                url = URL.createObjectURL(blob);
            } catch (_) {
                resolve(0);
                return;
            }
            var audio = new Audio();
            audio.preload = 'metadata';
            audio.onloadedmetadata = function () {
                var d = Number(audio.duration);
                try {
                    URL.revokeObjectURL(url);
                } catch (_) {}
                resolve(Number.isFinite(d) && d > 0 ? d : 0);
            };
            audio.onerror = function () {
                try {
                    URL.revokeObjectURL(url);
                } catch (_) {}
                resolve(0);
            };
            audio.src = url;
        });
    }

    function storeVoiceBlob(blob) {
        var st = store();
        if (!st) return Promise.reject(new Error('no_store'));
        if (typeof st.storeMediaBlob === 'function') {
            return st.storeMediaBlob(blob, 'voice-rec');
        }
        if (typeof st.storeChatMedia === 'function') {
            return st.storeChatMedia(blob, 'voice-rec');
        }
        return Promise.reject(new Error('no_store_api'));
    }

    function loadStoredVoiceBlob(key) {
        var st = store();
        if (!st) return Promise.reject(new Error('no_store'));
        function readOnce() {
            if (typeof st.idbGetRecord === 'function') {
                return st.idbGetRecord(key).then(function (rec) {
                    if (rec && rec.blob) return rec.blob;
                    throw new Error('no_blob');
                });
            }
            var getUrl =
                typeof st.getBlobUrl === 'function'
                    ? st.getBlobUrl
                    : typeof st.getAvatarUrl === 'function'
                      ? st.getAvatarUrl
                      : null;
            if (!getUrl) return Promise.reject(new Error('no_store_api'));
            return getUrl(key).then(function (url) {
                if (!url) throw new Error('no_url');
                return fetch(url).then(function (r) {
                    return r.blob();
                });
            });
        }
        return readOnce().catch(function (err) {
            /* IDB 连接被系统关闭后重试一次 */
            return new Promise(function (resolve) {
                setTimeout(resolve, 80);
            }).then(readOnce).catch(function () {
                throw err || new Error('no_blob');
            });
        });
    }

    var activeSession = null;

    function destroyActive() {
        if (!activeSession) return;
        try {
            activeSession.cleanup();
        } catch (_) {}
        activeSession = null;
    }

    function VoiceRecorderSession(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        this.onStateChange = typeof opts.onStateChange === 'function' ? opts.onStateChange : null;
        this.stream = null;
        this.recorder = null;
        this.chunks = [];
        this.mime = '';
        this.recording = false;
        this.startedAt = 0;
        this.timerId = null;
        this.elapsedSec = 0;
        this.recognition = null;
        this.recognitionRestartTimer = null;
        this.finalTranscript = '';
        this.interimTranscript = '';
        this.stoppedBlob = null;
        this.stoppedDurationSec = 0;
    }

    VoiceRecorderSession.prototype.emitState = function () {
        if (this.onStateChange) {
            this.onStateChange({
                recording: this.recording,
                elapsedSec: this.elapsedSec,
                transcript: this.getTranscript(),
                finalTranscript: this.finalTranscript,
                interimTranscript: this.interimTranscript,
                hasAudio: !!this.stoppedBlob,
                durationSec: this.stoppedDurationSec
            });
        }
    };

    VoiceRecorderSession.prototype.getTranscript = function () {
        var base = String(this.finalTranscript || '').trim();
        var interim = String(this.interimTranscript || '').trim();
        if (!interim) return base;
        if (!base) return interim;
        return base + interim;
    };

    VoiceRecorderSession.prototype.startTimer = function () {
        var self = this;
        clearInterval(this.timerId);
        this.timerId = setInterval(function () {
            if (!self.recording) return;
            self.elapsedSec = Math.max(0, (Date.now() - self.startedAt) / 1000);
            self.emitState();
            if (self.elapsedSec >= MAX_RECORD_SEC) self.stop();
        }, 200);
    };

    VoiceRecorderSession.prototype.stopTimer = function () {
        clearInterval(this.timerId);
        this.timerId = null;
    };

    VoiceRecorderSession.prototype.startRecognition = function () {
        var SR = getSpeechRecognitionCtor();
        if (!SR) return;
        if (global.isSecureContext === false) {
            toast('语音识别需要 HTTPS 或 localhost，请手动输入文字');
            return;
        }
        var self = this;
        try {
            this.recognition = new SR();
        } catch (_) {
            return;
        }
        this.recognition.lang = 'zh-CN';
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 1;
        this.recognitionRestartTimer = null;

        this.recognition.onresult = function (e) {
            var interim = '';
            var finals = '';
            for (var i = e.resultIndex; i < e.results.length; i++) {
                var piece = e.results[i] && e.results[i][0] ? e.results[i][0].transcript : '';
                if (!piece) continue;
                if (e.results[i].isFinal) finals += piece;
                else interim += piece;
            }
            if (finals) self.finalTranscript = (self.finalTranscript + finals).trim();
            self.interimTranscript = interim.trim();
            self.emitState();
        };

        this.recognition.onerror = function (ev) {
            var code = ev && ev.error ? String(ev.error) : '';
            if (code === 'not-allowed' || code === 'service-not-allowed') {
                toast('语音识别权限被拒绝，可手动编辑文字');
                return;
            }
            if (code === 'audio-capture' && self.recording) {
                self.scheduleRecognitionRestart(600);
                return;
            }
            if (code === 'network') {
                toast('语音识别需要网络，请检查连接或手动输入');
            }
        };

        this.recognition.onend = function () {
            if (!self.recording || !self.recognition) return;
            self.scheduleRecognitionRestart(120);
        };

        try {
            this.recognition.start();
        } catch (_) {
            self.scheduleRecognitionRestart(400);
        }
    };

    VoiceRecorderSession.prototype.scheduleRecognitionRestart = function (delayMs) {
        var self = this;
        if (!self.recording || !self.recognition) return;
        clearTimeout(self.recognitionRestartTimer);
        self.recognitionRestartTimer = setTimeout(function () {
            if (!self.recording || !self.recognition) return;
            try {
                self.recognition.start();
            } catch (_) {}
        }, Math.max(80, Number(delayMs) || 200));
    };

    VoiceRecorderSession.prototype.stopRecognition = function () {
        clearTimeout(this.recognitionRestartTimer);
        this.recognitionRestartTimer = null;
        if (!this.recognition) return;
        try {
            this.recognition.onend = null;
            this.recognition.stop();
        } catch (_) {}
        this.recognition = null;
        this.interimTranscript = '';
    };

    VoiceRecorderSession.prototype.start = function () {
        var self = this;
        if (self.recording) return Promise.resolve();
        if (!global.navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return Promise.reject(new Error('no_mic_api'));
        }
        if (!global.MediaRecorder) {
            return Promise.reject(new Error('no_recorder'));
        }
        self.startRecognition();
        return navigator.mediaDevices
            .getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                },
                video: false
            })
            .then(function (stream) {
                self.stream = stream;
                self.chunks = [];
                self.stoppedBlob = null;
                self.stoppedDurationSec = 0;
                self.finalTranscript = '';
                self.interimTranscript = '';
                self.mime = pickRecorderMime();
                var options = self.mime ? { mimeType: self.mime } : undefined;
                self.recorder = new MediaRecorder(stream, options);
                if (!self.mime && self.recorder.mimeType) self.mime = self.recorder.mimeType;
                self.recorder.ondataavailable = function (ev) {
                    if (ev.data && ev.data.size > 0) self.chunks.push(ev.data);
                };
                self.recorder.onstop = function () {
                    var type = self.mime || (self.chunks[0] && self.chunks[0].type) || 'audio/webm';
                    self.stoppedBlob = self.chunks.length ? new Blob(self.chunks, { type: type }) : null;
                    self.stoppedDurationSec = Math.max(1, Math.round(self.elapsedSec || 0));
                    self.emitState();
                };
                self.recorder.start(250);
                self.recording = true;
                self.startedAt = Date.now();
                self.elapsedSec = 0;
                self.startTimer();
                self.emitState();
            })
            .catch(function (err) {
                self.cleanup();
                throw err;
            });
    };

    VoiceRecorderSession.prototype.stop = function () {
        if (!this.recording) return Promise.resolve(this.stoppedBlob);
        var self = this;
        this.recording = false;
        this.stopTimer();
        this.stopRecognition();
        return new Promise(function (resolve) {
            if (!self.recorder || self.recorder.state === 'inactive') {
                self.cleanupStream();
                resolve(self.stoppedBlob);
                return;
            }
            var prev = self.recorder.onstop;
            self.recorder.onstop = function () {
                if (typeof prev === 'function') prev();
                self.cleanupStream();
                resolve(self.stoppedBlob);
            };
            try {
                self.recorder.stop();
            } catch (_) {
                self.cleanupStream();
                resolve(self.stoppedBlob);
            }
        }).then(function () {
            self.emitState();
            return self.stoppedBlob;
        });
    };

    VoiceRecorderSession.prototype.cleanupStream = function () {
        if (this.stream) {
            this.stream.getTracks().forEach(function (t) {
                try {
                    t.stop();
                } catch (_) {}
            });
        }
        this.stream = null;
        this.recorder = null;
    };

    VoiceRecorderSession.prototype.cleanup = function () {
        this.recording = false;
        this.stopTimer();
        this.stopRecognition();
        if (this.recorder && this.recorder.state !== 'inactive') {
            try {
                this.recorder.stop();
            } catch (_) {}
        }
        this.cleanupStream();
    };

    function buildRecorderHtml(hasStt) {
        return (
            '<div class="qq-sheet qq-voice-rec">' +
            '<div class="qq-sheet__panel qq-voice-rec__panel">' +
            '<div class="qq-sheet__grab" aria-hidden="true"></div>' +
            '<header class="qq-sheet__head">' +
            '<span class="qq-sheet__kicker">Voice · 语音</span>' +
            '<h3 class="qq-sheet__title">录制语音</h3>' +
            '<p class="qq-sheet__desc qq-voice-rec__hint">' +
            (hasStt
                ? '正在聆听，识别文字可随时编辑；最长 ' + MAX_RECORD_SEC + ' 秒'
                : '当前环境不支持语音识别，请手动输入文字；最长 ' + MAX_RECORD_SEC + ' 秒') +
            '</p>' +
            '</header>' +
            '<div class="qq-voice-rec__meter" aria-hidden="true">' +
            '<span class="qq-voice-rec__dot"></span>' +
            '<span class="qq-voice-rec__timer" data-voice-rec-timer>00:00</span>' +
            '<span class="qq-voice-rec__wave">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
            '</span>' +
            '</div>' +
            '<label class="qq-sheet__field">' +
            '<span class="qq-sheet__label"><em>01</em> 转写 <i>Transcript</i></span>' +
            '<textarea class="qq-sheet__input qq-voice-rec__text" data-voice-rec-text rows="4" placeholder="识别文字将显示在这里…"></textarea>' +
            '</label>' +
            '<div class="qq-sheet__actions">' +
            '<button type="button" class="qq-sheet__btn qq-sheet__btn--ghost" data-voice-rec-stop>停止</button>' +
            '<button type="button" class="qq-sheet__btn qq-sheet__btn--primary" data-voice-rec-send hidden>发送</button>' +
            '</div>' +
            '<button type="button" class="qq-sheet__cancel" data-voice-rec-cancel>取消</button>' +
            '</div></div>'
        );
    }

    function bindRecorderPanel(rootEl, hooks) {
        hooks = hooks && typeof hooks === 'object' ? hooks : {};
        var closeOverlay = hooks.closeOverlay;
        var onSend = hooks.onSend;
        if (!rootEl || typeof closeOverlay !== 'function') {
            toast('录音面板加载失败');
            return;
        }

        var timerEl = rootEl.querySelector('[data-voice-rec-timer]');
        var textEl = rootEl.querySelector('[data-voice-rec-text]');
        var stopBtn = rootEl.querySelector('[data-voice-rec-stop]');
        var sendBtn = rootEl.querySelector('[data-voice-rec-send]');
        var cancelBtn = rootEl.querySelector('[data-voice-rec-cancel]');
        var meterEl = rootEl.querySelector('.qq-voice-rec__meter');
        var session = new VoiceRecorderSession({
            onStateChange: function (st) {
                if (timerEl) timerEl.textContent = formatTimer(st.elapsedSec);
                if (meterEl) meterEl.classList.toggle('is-recording', !!st.recording);
                if (textEl && st.recording) {
                    if (document.activeElement !== textEl) {
                        textEl.value = st.transcript;
                    }
                }
                if (stopBtn) stopBtn.hidden = !st.recording;
                if (sendBtn) sendBtn.hidden = !!st.recording;
            }
        });
        activeSession = session;

        var destroyed = false;
        function destroySession() {
            if (destroyed) return;
            destroyed = true;
            session.cleanup();
            if (activeSession === session) activeSession = null;
        }

        function finishClose() {
            destroySession();
            closeOverlay();
        }

        stopBtn &&
            stopBtn.addEventListener('click', function () {
                session.stop().then(function () {
                    if (textEl && !String(textEl.value || '').trim()) {
                        textEl.value = session.getTranscript();
                    }
                    if (sendBtn) sendBtn.hidden = false;
                    if (stopBtn) stopBtn.hidden = true;
                });
            });

        cancelBtn &&
            cancelBtn.addEventListener('click', function () {
                finishClose();
            });

        sendBtn &&
            sendBtn.addEventListener('click', function () {
                var txt = String((textEl && textEl.value) || session.getTranscript() || '').trim();
                if (!txt) {
                    toast('请输入或录制语音内容');
                    return;
                }
                var blob = session.stoppedBlob;
                if (!blob || !blob.size) {
                    toast('没有录到音频，请先录音');
                    return;
                }
                sendBtn.disabled = true;
                var durGuess = session.stoppedDurationSec;
                Promise.resolve()
                    .then(function () {
                        return durGuess ? durGuess : probeAudioDurationSec(blob);
                    })
                    .then(function (dur) {
                        return storeVoiceBlob(blob).then(function (key) {
                            return {
                                voiceText: txt,
                                voiceAudioIdbKey: key,
                                voiceDurationSec: Math.max(1, Math.round(Number(dur) || durGuess || 1))
                            };
                        });
                    })
                    .then(function (payload) {
                        if (typeof onSend === 'function') {
                            return onSend(payload);
                        }
                    })
                    .then(function () {
                        finishClose();
                    })
                    .catch(function () {
                        toast('发送失败');
                        sendBtn.disabled = false;
                    });
            });

        session.start().catch(function (err) {
            var code = err && err.message ? String(err.message) : '';
            if (code === 'no_mic_api' || code === 'no_recorder') {
                toast('当前浏览器不支持录音');
            } else {
                toast('无法访问麦克风，请检查权限');
            }
            finishClose();
        });
    }

    function openPanel(hooks) {
        hooks = hooks && typeof hooks === 'object' ? hooks : {};
        var openOverlay = hooks.openOverlay;
        var closeOverlay = hooks.closeOverlay;
        if (typeof openOverlay !== 'function' || typeof closeOverlay !== 'function') {
            toast('录音面板加载失败');
            return;
        }

        var hasStt = !!getSpeechRecognitionCtor();
        openOverlay(buildRecorderHtml(hasStt));

        var rootEl = hooks.overlayRoot || document.getElementById('qq-room-overlay');
        if (!rootEl) return;
        bindRecorderPanel(rootEl, hooks);
    }

    function handlePlay(msgRow, msgId, chatId) {
        if (!msgId || !chatId) return;
        var st = store();
        if (!st) return;
        var msg = st.findMessage(chatId, msgId);
        if (!msg || msg.role !== 'user' || msg.type !== 'voice') {
            toast('无法播放本条语音');
            return;
        }
        var key = String(msg.voiceAudioIdbKey || '').trim();
        if (!key) {
            toast('本条没有录音文件');
            return;
        }

        var busyKey = 'rec:' + String(chatId) + ':' + String(msgId);
        if (handlePlay._busyKey === busyKey) return;
        handlePlay._busyKey = busyKey;

        function resolveRow() {
            var sc = document.getElementById('qq-room-scroll');
            if (!sc) return msgRow && msgRow.isConnected ? msgRow : null;
            var safe = String(msgId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return (
                sc.querySelector('.qq-room__row[data-msg-id="' + safe + '"]') ||
                (msgRow && msgRow.isConnected ? msgRow : null)
            );
        }

        var row0 = resolveRow();
        var playBtn = row0 && row0.querySelector('[data-mq-voice-play]');
        if (playBtn) playBtn.setAttribute('data-voice-rec-busy', '1');

        var hintDur =
            typeof msg.voiceDurationSec === 'number' && Number.isFinite(msg.voiceDurationSec) && msg.voiceDurationSec > 0
                ? msg.voiceDurationSec
                : 0;

        function doneBusy() {
            if (handlePlay._busyKey === busyKey) handlePlay._busyKey = '';
            var live = resolveRow();
            var btn = (live && live.querySelector('[data-mq-voice-play]')) || playBtn;
            if (btn) btn.removeAttribute('data-voice-rec-busy');
        }

        var tts = global.MiyaChatVoiceTts;
        loadStoredVoiceBlob(key)
            .then(function (blob) {
                if (!blob) throw new Error('no_blob');
                var liveRow = resolveRow();
                if (tts && typeof tts.playFromBlob === 'function') {
                    tts.playFromBlob(liveRow || msgRow, blob, hintDur || undefined, msgId);
                } else {
                    toast('播放模块未加载');
                }
            })
            .catch(function () {
                toast('音频加载失败');
            })
            .finally(doneBusy);
    }
    handlePlay._busyKey = '';

    function supportsRecording() {
        return !!(
            global.navigator &&
            navigator.mediaDevices &&
            typeof navigator.mediaDevices.getUserMedia === 'function' &&
            global.MediaRecorder
        );
    }

    global.MiyaChatVoiceRecord = {
        openPanel: openPanel,
        bindRecorderPanel: bindRecorderPanel,
        handlePlay: handlePlay,
        destroyActive: destroyActive,
        loadStoredVoiceBlob: loadStoredVoiceBlob,
        supportsRecording: supportsRecording,
        supportsSpeechRecognition: function () {
            return !!getSpeechRecognitionCtor();
        }
    };
})(window);
