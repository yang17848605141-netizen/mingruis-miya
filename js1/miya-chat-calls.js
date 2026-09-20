(function (global) {
    'use strict';

    var active = null;
    var hostEl = null;
    var archiveEl = null;
    var cameraStream = null;
    var pipVideoEl = null;
    var timerIv = null;
    var apiPending = 0;
    var callKeyboardInsetBound = false;
    var callIosKeyboardWasOpen = false;
    var callKbRecoveryTimers = [];

    function store() {
        return global.miyaChatStore || null;
    }

    function engine() {
        return global.miyaChatEngine || null;
    }

    function toast(msg) {
        if (global.miyaChatRoom && typeof global.miyaChatRoom.toast === 'function') {
            global.miyaChatRoom.toast(msg);
            return;
        }
        var el = document.getElementById('qq-room-toast');
        if (!el) return;
        el.textContent = String(msg || '');
        el.classList.add('is-show');
        clearTimeout(el._callT);
        el._callT = setTimeout(function () {
            el.classList.remove('is-show');
        }, 2400);
    }

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function newCallId() {
        return 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    }

    function formatCallDuration(sec) {
        var s = Math.max(0, Math.floor(Number(sec) || 0));
        var m = Math.floor(s / 60);
        var r = s % 60;
        return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }

    function isActive() {
        return !!(active && active.status !== 'ended');
    }

    function getChatContext(chatId) {
        var st = store();
        if (!st || !chatId) return null;
        var chat = st.findChat(chatId);
        if (!chat) return null;
        var contact = st.findContact(chat.contactId);
        var profile =
            st.getProfiles().find(function (p) {
                return p.id === chat.profileId;
            }) || st.getActiveProfile();
        return { chat: chat, contact: contact, profile: profile };
    }

    function displayContactName(contact) {
        if (!contact) return '对方';
        return String(contact.remarkName || contact.name || '对方').trim();
    }

    function getAvatarUrl(blobId, fallback) {
        var st = store();
        if (!st || !blobId) return Promise.resolve(fallback || '');
        return st.getAvatarUrl(blobId).then(function (url) {
            return url || fallback || '';
        });
    }

    function resolveContactAvatarUrl(contact) {
        if (!contact) return '';
        var av = String(contact.avatar || '').trim();
        if (av) return av;
        var blobId = String(contact.avatarBlobId || '').trim();
        if (blobId) {
            var st = global.miyaChatStore;
            if (st && typeof st.getCachedBlobUrl === 'function') {
                var cached = st.getCachedBlobUrl(blobId);
                if (cached) return cached;
            }
            if (st && typeof st.getAvatarUrl === 'function') {
                st.getAvatarUrl(blobId).catch(function () {});
            }
        }
        var cs = global.miyaContactsStore;
        if (!cs || typeof cs.findCharacter !== 'function') return '';
        var chronicleId = String(contact.chronicleId || '').trim();
        var characterId = String(contact.characterId || '').trim();
        var row =
            (chronicleId && cs.findCharacter(chronicleId)) ||
            (characterId && cs.findCharacter(characterId)) ||
            null;
        return row && row.avatar ? String(row.avatar).trim() : '';
    }

    function getContactAvatarUrl(contact) {
        var direct = resolveContactAvatarUrl(contact);
        if (direct) return Promise.resolve(direct);
        return Promise.resolve('');
    }

    function getProfileAvatarUrl(profile) {
        if (!profile) return Promise.resolve('');
        return getAvatarUrl(profile.avatarId, '');
    }

    function setRingAvatar(url, contact) {
        var ringAva = $('mc-call-ring-ava');
        if (!ringAva) return;
        var fallback = $('mc-call-ring-fallback');
        if (url) {
            ringAva.src = url;
            ringAva.hidden = false;
            if (fallback) fallback.hidden = true;
        } else {
            ringAva.removeAttribute('src');
            ringAva.hidden = true;
            if (fallback) {
                fallback.textContent = String(
                    (contact && (contact.remarkName || contact.name)) || 'TA'
                )
                    .trim()
                    .charAt(0) || 'TA';
                fallback.hidden = false;
            }
        }
    }

    function buildCallHostHtml() {
        return (
            '<div class="mc-call-host" id="mc-call-host" aria-hidden="true">' +
            '<div class="mc-call-stage" id="mc-call-stage">' +
            '<div class="mc-call-viewport" id="mc-call-viewport" data-call-tap-swap>' +
            '<div class="mc-call-bg-base"></div>' +
            '<img class="mc-call-hero-avatar" id="mc-call-hero-avatar" alt="" hidden>' +
            '<video class="mc-call-main-video" id="mc-call-main-video" playsinline muted autoplay hidden></video>' +
            '<div class="mc-call-viewport-shade"></div></div>' +
            '<div class="mc-call-ring" id="mc-call-ring" hidden>' +
            '<div class="mc-call-ring-body">' +
            '<div class="mc-call-ring-avatar-box">' +
            '<img class="mc-call-ring-avatar" id="mc-call-ring-ava" alt="" width="96" height="96">' +
            '<span class="mc-call-ring-fallback" id="mc-call-ring-fallback" hidden></span></div>' +
            '<p class="mc-call-ring-label" id="mc-call-ring-label">来电中…</p>' +
            '<p class="mc-call-ring-sub">视频来电</p>' +
            '<div class="mc-call-ring-actions">' +
            '<button type="button" class="mc-call-ring-btn mc-call-ring-btn--decline" data-call-ring="decline" aria-label="拒绝">' +
            '<span class="mc-call-ring-icon">✕</span><span>拒绝</span></button>' +
            '<button type="button" class="mc-call-ring-btn mc-call-ring-btn--accept" data-call-ring="accept" aria-label="接听">' +
            '<span class="mc-call-ring-icon">✓</span><span>接听</span></button></div></div></div>' +
            '<header class="mc-call-topbar">' +
            '<div class="mc-call-topbar-center">' +
            '<h1 class="mc-call-name" id="mc-call-name">—</h1>' +
            '<p class="mc-call-status" id="mc-call-status">连接中</p></div>' +
            '<span class="mc-call-timer" id="mc-call-timer">00:00</span></header>' +
            '<div class="mc-call-pip" id="mc-call-pip" hidden>' +
            '<img class="mc-call-pip-hero-avatar" id="mc-call-pip-hero-avatar" alt="" hidden>' +
            '<video id="mc-call-pip-video" playsinline muted autoplay hidden></video>' +
            '<div class="mc-call-pip-ava" id="mc-call-pip-ava">我</div></div>' +
            '<section class="mc-call-chat" id="mc-call-chat">' +
            '<div class="mc-call-scroll" id="mc-call-scroll">' +
            '<div class="mc-call-lines" id="mc-call-lines"></div>' +
            '<div class="mc-call-typing" id="mc-call-typing" hidden aria-label="对方正在说话">' +
            '<span class="mc-call-typing-bubble">…</span></div></div></section>' +
            '<footer class="mc-call-footer">' +
            '<div class="mc-call-input-row" id="mc-call-input-row">' +
            '<button type="button" class="mc-call-icon-btn" data-call-act="ask-role" aria-label="请对方说话">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 3C7.03 3 3 6.58 3 11c0 1.89.73 3.63 1.97 5.03L4 21l5.2-3.2C9.44 17.93 10.69 18 12 18c4.97 0 9-3.58 9-8s-4.03-8-9-8zm-1 11H8v-2h3v2zm0-4H8V8h3v2zm5 4h-3v-2h3v2zm0-4h-3V8h3v2z"/></svg></button>' +
            '<input type="text" class="mc-call-input" id="mc-call-input" placeholder="说点什么…" autocomplete="off">' +
            '<button type="button" class="mc-call-icon-btn" data-call-act="voice-record" id="mc-call-voice-btn" aria-label="语音">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg></button>' +
            '<button type="button" class="mc-call-icon-btn mc-call-icon-btn--send" data-call-act="send-user" aria-label="发送">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button></div>' +
            '<nav class="mc-call-tools" aria-label="通话控制">' +
            '<button type="button" class="mc-call-tool-btn" data-call-act="flip-cam" id="mc-call-flip-btn" aria-label="翻转镜头">' +
            '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7h12a4 4 0 0 1 4 4v1M20 17H8a4 4 0 0 1-4-4v-1M16 5l4 2-4 2M8 19l-4-2 4-2"/></svg></button>' +
            '<button type="button" class="mc-call-tool-btn" data-call-act="toggle-cam" id="mc-call-cam-btn" aria-label="关闭摄像头" aria-pressed="true">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3 8.5A1.5 1.5 0 0 1 4.5 7h9A1.5 1.5 0 0 1 15 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 15.5v-7z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M15 10.5l5-2.5v8l-5-2.5"/><path class="mc-call-cam-slash" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M3.5 4.5l17 15"/></svg></button>' +
            '<button type="button" class="mc-call-tool-btn mc-call-tool-btn--hangup" data-call-act="hangup" aria-label="挂断">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.07 21 3 13.93 3 5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"/></svg></button>' +
            '</nav></footer>' +
            '<div class="mc-call-voice-overlay" id="mc-call-voice-overlay" hidden aria-hidden="true"></div>' +
            '</div></div>'
        );
    }

    function buildArchiveHtml() {
        return (
            '<div class="mc-call-archive" id="mc-call-archive" hidden aria-hidden="true">' +
            '<div class="mc-call-archive-backdrop" data-call-archive-close></div>' +
            '<div class="mc-call-archive-panel" role="dialog">' +
            '<header class="mc-call-archive-head">' +
            '<h2 id="mc-call-archive-title">通话记录</h2>' +
            '<button type="button" class="mc-call-archive-close" data-call-archive-close aria-label="关闭">×</button></header>' +
            '<div class="mc-call-archive-body" id="mc-call-archive-body"></div></div></div>'
        );
    }

    function ensureArchiveHost() {
        if (archiveEl && document.body.contains(archiveEl)) return archiveEl;
        var wrap = document.createElement('div');
        wrap.innerHTML = buildArchiveHtml();
        archiveEl = wrap.firstElementChild;
        document.body.appendChild(archiveEl);
        if (!archiveEl.dataset.bound) {
            archiveEl.dataset.bound = '1';
            archiveEl.addEventListener('click', function (e) {
                if (e.target.closest('[data-call-archive-close]')) closeCallArchive();
                var userRec = e.target.closest('[data-call-play-user-voice]');
                if (userRec) {
                    playUserVoiceAudio(
                        userRec.getAttribute('data-audio-key'),
                        userRec.getAttribute('data-audio-dur'),
                        userRec
                    );
                    return;
                }
                var play = e.target.closest('[data-call-play-text]');
                if (play) {
                    playCallText(
                        play.getAttribute('data-call-play-text'),
                        play.getAttribute('data-call-chat-id')
                    );
                }
            });
        }
        return archiveEl;
    }

    function ensureCallHost() {
        if (
            hostEl &&
            document.body.contains(hostEl) &&
            (!hostEl.querySelector('.mc-call-viewport') ||
                !hostEl.querySelector('.mc-call-pip-hero-avatar') ||
                !hostEl.querySelector('#mc-call-voice-overlay') ||
                !hostEl.querySelector('[data-call-act="voice-record"]') ||
                !hostEl.querySelector('[data-call-act="toggle-cam"]'))
        ) {
            try {
                hostEl.remove();
            } catch (_) {}
            hostEl = null;
        }
        if (hostEl && document.body.contains(hostEl)) return hostEl;
        var wrap = document.createElement('div');
        wrap.innerHTML = buildCallHostHtml();
        hostEl = wrap.firstElementChild;
        document.body.appendChild(hostEl);
        bindHostEvents();
        bindCallKeyboardInset();
        ensureArchiveHost();
        return hostEl;
    }

    function $(id) {
        return hostEl ? hostEl.querySelector('#' + id) : null;
    }

    function $archive(id) {
        return archiveEl ? archiveEl.querySelector('#' + id) : null;
    }

    function applyCallBackground(chatId) {
        ensureCallHost();
        var hero = $('mc-call-hero-avatar');
        if (!hostEl || !chatId) return;
        var ctx = getChatContext(chatId);
        hostEl.classList.remove('is-has-custom-bg', 'is-preset-dark', 'is-preset-bg');
        if (!ctx || !ctx.contact) {
            hostEl.classList.remove('is-hero-avatar');
            if (hero) hero.hidden = true;
            return;
        }
        getContactAvatarUrl(ctx.contact).then(function (avaUrl) {
            if (active) active.roleAvatarUrl = avaUrl || '';
            if (avaUrl && hero) {
                hero.src = avaUrl;
                hero.hidden = false;
                hostEl.classList.add('is-hero-avatar');
            } else {
                if (hero) hero.hidden = true;
                hostEl.classList.remove('is-hero-avatar');
            }
            syncViewports();
        });
    }

    function isIOSCall() {
        return document.documentElement.classList.contains('is-ios');
    }

    function isCallInputFocused() {
        var inp = $('mc-call-input');
        return !!(inp && document.activeElement === inp);
    }

    function cancelCallKbRecovery() {
        callKbRecoveryTimers.forEach(function (id) {
            clearTimeout(id);
        });
        callKbRecoveryTimers = [];
    }

    function clearCallKeyboardState() {
        if (!hostEl) return;
        hostEl.classList.remove('mc-call--keyboard');
        hostEl.style.removeProperty('--mc-call-kb-top');
        hostEl.style.removeProperty('--mc-call-kb-height');
        callIosKeyboardWasOpen = false;
    }

    function recoverCallViewportAfterKeyboard() {
        if (!isIOSCall()) return;
        cancelCallKbRecovery();
        [0, 80, 180, 360].forEach(function (delay) {
            callKbRecoveryTimers.push(
                setTimeout(function () {
                    if (isCallInputFocused()) return;
                    clearCallKeyboardState();
                    window.scrollTo(0, 0);
                    if (global.__miyaSetAppHeight) global.__miyaSetAppHeight(true);
                    syncCallKeyboardInset();
                }, delay)
            );
        });
    }

    function syncCallKeyboardInset() {
        if (!hostEl || !hostEl.classList.contains('is-open')) return;
        if (!active || active.kind !== 'video') {
            clearCallKeyboardState();
            return;
        }
        if (!isIOSCall()) return;
        var vv = window.visualViewport;
        var inset = 0;
        if (vv) {
            inset = Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
        }
        var open = inset > 40;
        if (!open && isCallInputFocused() && vv) open = true;

        if (callIosKeyboardWasOpen && !open) recoverCallViewportAfterKeyboard();
        callIosKeyboardWasOpen = open;

        hostEl.classList.toggle('mc-call--keyboard', open);
        if (open && vv) {
            hostEl.style.setProperty('--mc-call-kb-top', Math.round(vv.offsetTop || 0) + 'px');
            hostEl.style.setProperty('--mc-call-kb-height', Math.round(vv.height) + 'px');
            if ((vv.offsetTop || 0) > 0) window.scrollTo(0, 0);
        } else if (!open) {
            hostEl.style.removeProperty('--mc-call-kb-top');
            hostEl.style.removeProperty('--mc-call-kb-height');
        }
    }

    function bindCallKeyboardInset() {
        if (callKeyboardInsetBound) return;
        callKeyboardInsetBound = true;
        var vv = window.visualViewport;
        function onViewportChange() {
            syncCallKeyboardInset();
        }
        if (vv) {
            vv.addEventListener('resize', onViewportChange);
            vv.addEventListener('scroll', onViewportChange);
        }
        window.addEventListener('resize', onViewportChange);
    }

    function setHostOpen(on) {
        ensureCallHost();
        if (!hostEl) return;
        hostEl.classList.toggle('is-open', !!on);
        hostEl.setAttribute('aria-hidden', on ? 'false' : 'true');
        var isVideo = !!(active && active.kind === 'video');
        hostEl.classList.toggle('is-video', isVideo);
        if (!on) clearCallKeyboardState();
        syncViewports();
        var pip = $('mc-call-pip');
        if (pip) pip.hidden = !isVideo || !on;
        if (on && isVideo) syncCallKeyboardInset();
    }

    function applyPipAvatarFallback(el, url, fallbackText) {
        if (!el) return;
        if (url) {
            el.style.backgroundImage = 'url("' + String(url).replace(/"/g, '') + '")';
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center';
            el.textContent = '';
        } else {
            el.style.backgroundImage = '';
            el.textContent = String(fallbackText || '?').charAt(0) || '?';
        }
    }

    function syncViewports() {
        if (!hostEl || !active) return;
        var focusSelf = active.mainView === 'self';
        hostEl.classList.toggle('is-focus-self', focusSelf);
        var hero = $('mc-call-hero-avatar');
        var mainVid = $('mc-call-main-video');
        var pipVid = $('mc-call-pip-video');
        var pipHero = $('mc-call-pip-hero-avatar');
        var pipAva = $('mc-call-pip-ava');
        var hasHero = hostEl.classList.contains('is-hero-avatar');
        var ctx = getChatContext(active.chatId);
        var roleFallback =
            String(displayContactName(ctx && ctx.contact) || 'TA')
                .trim()
                .charAt(0) || 'TA';
        var userFallback =
            String((ctx && ctx.profile && ctx.profile.name) || '我')
                .trim()
                .charAt(0) || '我';
        var roleAvatarUrl =
            active.roleAvatarUrl || (hero && hero.src ? hero.src : '');

        if (active.kind !== 'video') {
            if (mainVid) {
                mainVid.srcObject = null;
                mainVid.hidden = true;
            }
            if (pipVid) pipVid.hidden = true;
            if (pipHero) pipHero.hidden = true;
            return;
        }

        function showMainCamera(on) {
            if (!mainVid) return;
            if (on && active.cameraOn && cameraStream) {
                mainVid.srcObject = cameraStream;
                mainVid.hidden = false;
                mainVid.style.transform =
                    active.cameraFacing !== 'environment' ? 'scaleX(-1)' : '';
                if (typeof mainVid.play === 'function') mainVid.play().catch(function () {});
            } else {
                mainVid.srcObject = null;
                mainVid.hidden = true;
                mainVid.style.transform = '';
            }
        }

        function showPipCamera(on) {
            if (!pipVid) return;
            if (on && active.cameraOn && cameraStream) {
                pipVid.srcObject = cameraStream;
                pipVid.hidden = false;
                pipVid.style.transform =
                    active.cameraFacing !== 'environment' ? 'scaleX(-1)' : '';
                if (typeof pipVid.play === 'function') pipVid.play().catch(function () {});
                if (pipHero) pipHero.hidden = true;
                if (pipAva) pipAva.hidden = true;
            } else {
                pipVid.srcObject = null;
                pipVid.hidden = true;
            }
        }

        function showPipRoleAvatar() {
            if (pipVid) {
                pipVid.srcObject = null;
                pipVid.hidden = true;
            }
            if (roleAvatarUrl && pipHero) {
                pipHero.src = roleAvatarUrl;
                pipHero.hidden = false;
                if (pipAva) pipAva.hidden = true;
            } else {
                if (pipHero) {
                    pipHero.removeAttribute('src');
                    pipHero.hidden = true;
                }
                if (pipAva) {
                    pipAva.hidden = false;
                    applyPipAvatarFallback(pipAva, roleAvatarUrl, roleFallback);
                }
            }
        }

        if (focusSelf) {
            showMainCamera(true);
            if (hero) hero.hidden = true;
            showPipRoleAvatar();
            return;
        }

        showMainCamera(false);
        if (hero && hasHero) hero.hidden = false;
        if (pipHero) {
            pipHero.removeAttribute('src');
            pipHero.hidden = true;
        }
        if (active.cameraOn && cameraStream) {
            showPipCamera(true);
        } else {
            showPipCamera(false);
            if (pipAva) {
                pipAva.hidden = false;
                applyPipAvatarFallback(pipAva, active.userAvatarUrl, userFallback);
            }
        }
    }

    function updateHeader() {
        if (!active) return;
        var ctx = getChatContext(active.chatId);
        var nameEl = $('mc-call-name');
        var statusEl = $('mc-call-status');
        if (nameEl && ctx && ctx.contact) nameEl.textContent = displayContactName(ctx.contact);
        if (statusEl) {
            if (active.status === 'ringing') statusEl.textContent = '等待接听';
            else if (active.status === 'active') statusEl.textContent = '通话中';
            else statusEl.textContent = '连接中';
        }
        syncCamToggleBtn();
        var inputRow = $('mc-call-input-row');
        if (inputRow) inputRow.hidden = active.status !== 'active';
        var tools = hostEl ? hostEl.querySelector('.mc-call-tools') : null;
        if (tools) tools.hidden = active.status !== 'active';
    }

    function syncCamToggleBtn() {
        var camBtn = $('mc-call-cam-btn');
        if (!camBtn) return;
        var on = !!(active && active.cameraOn && !active.cameraClosedByUser);
        camBtn.classList.toggle('is-cam-off', !on);
        camBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        camBtn.setAttribute('aria-label', on ? '关闭摄像头' : '开启摄像头');
    }

    function toggleCamera() {
        if (!active) return;
        if (active.cameraOn && !active.cameraClosedByUser) {
            active.cameraClosedByUser = true;
            stopCamera();
            syncCamToggleBtn();
            return;
        }
        active.cameraClosedByUser = false;
        startCamera().then(function () {
            syncCamToggleBtn();
        });
    }

    function hydrateAvatars() {
        if (!active) return;
        var ctx = getChatContext(active.chatId);
        if (!ctx) return;
        if (ctx.contact) {
            getContactAvatarUrl(ctx.contact).then(function (url) {
                active.roleAvatarUrl = url || '';
                setRingAvatar(url, ctx.contact);
                applyCallBackground(active.chatId);
            });
        }
        var pipAva = $('mc-call-pip-ava');
        if (pipAva && ctx.profile) {
            pipAva.textContent = String(ctx.profile.name || '我').charAt(0);
            pipAva.style.backgroundImage = '';
            getProfileAvatarUrl(ctx.profile).then(function (u) {
                if (u && pipAva) {
                    active.userAvatarUrl = u;
                    pipAva.style.backgroundImage = 'url("' + String(u).replace(/"/g, '') + '")';
                    pipAva.style.backgroundSize = 'cover';
                    pipAva.textContent = '';
                }
                syncViewports();
            });
        }
    }

    function startTimer() {
        stopTimer();
        if (!active) return;
        active.startedAt = active.startedAt || Date.now();
        active.status = 'active';
        forceTypingOff();
        timerIv = setInterval(function () {
            var el = $('mc-call-timer');
            if (!el || !active || !active.startedAt) return;
            el.textContent = formatCallDuration((Date.now() - active.startedAt) / 1000);
        }, 500);
        updateHeader();
    }

    function stopTimer() {
        if (timerIv) clearInterval(timerIv);
        timerIv = null;
    }

    function showRingUI(show, label) {
        var ring = $('mc-call-ring');
        var labelEl = $('mc-call-ring-label');
        if (ring) ring.hidden = !show;
        if (labelEl && label) labelEl.textContent = label;
        forceTypingOff();
        updateHeader();
    }

    function setTyping(on) {
        var el = $('mc-call-typing');
        if (on) {
            apiPending += 1;
        } else {
            apiPending = Math.max(0, apiPending - 1);
        }
        if (active) active.typing = apiPending > 0;
        if (el) el.hidden = apiPending <= 0;
        var sc = $('mc-call-scroll');
        if (sc && on && apiPending > 0) sc.scrollTop = sc.scrollHeight;
    }

    function forceTypingOff() {
        apiPending = 0;
        if (active) active.typing = false;
        var el = $('mc-call-typing');
        if (el) el.hidden = true;
    }

    function pushTranscriptEntry(entry) {
        if (!active || !entry || !entry.text) return;
        var item = {
            role: entry.role === 'user' ? 'user' : 'assistant',
            text: String(entry.text).trim(),
            ts: Date.now()
        };
        if (entry.voiceAudioIdbKey) item.voiceAudioIdbKey = String(entry.voiceAudioIdbKey);
        if (
            typeof entry.voiceDurationSec === 'number' &&
            Number.isFinite(entry.voiceDurationSec) &&
            entry.voiceDurationSec > 0
        ) {
            item.voiceDurationSec = entry.voiceDurationSec;
        }
        active.lines.push(item);
    }

    function buildUserRecPlayBtn(entry) {
        var key = String((entry && entry.voiceAudioIdbKey) || '').trim();
        if (!key) return '';
        var dur =
            typeof entry.voiceDurationSec === 'number' && entry.voiceDurationSec > 0
                ? String(entry.voiceDurationSec)
                : '';
        return (
            '<button type="button" class="mc-call-bubble-play mc-call-bubble-play--rec" data-call-play-user-voice data-audio-key="' +
            esc(key) +
            '" data-audio-dur="' +
            esc(dur) +
            '" aria-label="播放录音">▶</button>'
        );
    }

    function buildArchiveUserRecPlayBtn(it) {
        var key = String((it && it.voiceAudioIdbKey) || '').trim();
        if (!key) return '';
        var dur =
            typeof it.voiceDurationSec === 'number' && it.voiceDurationSec > 0
                ? String(it.voiceDurationSec)
                : '';
        return (
            '<button type="button" class="mc-call-archive-play mc-call-archive-play--rec" data-call-play-user-voice data-audio-key="' +
            esc(key) +
            '" data-audio-dur="' +
            esc(dur) +
            '" aria-label="播放录音">▶</button>'
        );
    }

    function appendTranscriptLine(entry, skipStore) {
        if (!active) return;
        var text = String((entry && entry.text) || '').trim();
        if (!text) return;
        if (!skipStore) pushTranscriptEntry(entry);
        var box = $('mc-call-lines');
        if (!box) return;
        var ctx = getChatContext(active.chatId);
        var isUser = entry.role === 'user';
        var playBtn = isUser
            ? buildUserRecPlayBtn(entry)
            : '<button type="button" class="mc-call-bubble-play" data-call-play-text="' +
              esc(text) +
              '" aria-label="播放">▶</button>';
        var row = document.createElement('div');
        row.className = 'mc-call-bubble' + (isUser ? ' is-me' : ' is-other');
        row.innerHTML =
            '<div class="mc-call-bubble-inner">' +
            '<p class="mc-call-bubble-text">' +
            esc(text) +
            '</p>' +
            playBtn +
            '</div>';
        box.appendChild(row);
        var sc = $('mc-call-scroll');
        if (sc) sc.scrollTop = sc.scrollHeight;
    }

    function clearTranscriptUi() {
        var box = $('mc-call-lines');
        if (box) box.innerHTML = '';
        forceTypingOff();
    }

    function playCallText(text, chatId) {
        var t = String(text || '').trim();
        if (!t) return;
        var tts = global.MiyaChatVoiceTts;
        if (!tts || typeof tts.playPlainText !== 'function') {
            toast('未配置语音 API，请阅读文字');
            return;
        }
        var st = store();
        var cs = st && st.getChatSettings ? st.getChatSettings(chatId) : null;
        if (!String((cs && cs.minimaxVoiceId) || '').trim()) {
            toast('未配置音色，仅显示文字（可在聊天设置填写）');
            return;
        }
        tts.playPlainText(t, chatId);
    }

    function playUserVoiceAudio(audioKey, durationSec, anchorEl) {
        var key = String(audioKey || '').trim();
        if (!key) {
            toast('本条没有录音文件');
            return;
        }
        var rec = global.MiyaChatVoiceRecord;
        var tts = global.MiyaChatVoiceTts;
        if (!rec || typeof rec.loadStoredVoiceBlob !== 'function') {
            toast('播放模块未加载');
            return;
        }
        var host =
            anchorEl && anchorEl.closest('.mc-call-bubble-inner, .mc-call-archive-bubble');
        if (!host) host = document.createElement('div');
        var btn = anchorEl && anchorEl.closest('[data-call-play-user-voice]');
        if (btn && btn.getAttribute('data-voice-rec-busy') === '1') return;
        if (btn) btn.setAttribute('data-voice-rec-busy', '1');
        var durNum = Number(durationSec);
        rec.loadStoredVoiceBlob(key)
            .then(function (blob) {
                if (tts && typeof tts.playFromBlob === 'function') {
                    tts.playFromBlob(
                        host,
                        blob,
                        Number.isFinite(durNum) && durNum > 0 ? durNum : undefined
                    );
                } else {
                    toast('播放模块未加载');
                }
            })
            .catch(function () {
                toast('音频加载失败');
            })
            .finally(function () {
                if (btn) btn.removeAttribute('data-voice-rec-busy');
            });
    }

    function openCallVoiceOverlay(html) {
        var ov = $('mc-call-voice-overlay');
        if (!ov) return;
        ov.innerHTML = html;
        ov.hidden = false;
        ov.setAttribute('aria-hidden', 'false');
    }

    function closeCallVoiceOverlay() {
        var ov = $('mc-call-voice-overlay');
        if (!ov) return;
        ov.innerHTML = '';
        ov.hidden = true;
        ov.setAttribute('aria-hidden', 'true');
    }

    function openCallVoiceRecord() {
        if (!active || active.status !== 'active') return;
        var rec = global.MiyaChatVoiceRecord;
        if (!rec || typeof rec.openPanel !== 'function' || !rec.supportsRecording()) {
            toast('当前浏览器不支持录音');
            return;
        }
        var overlayEl = $('mc-call-voice-overlay');
        rec.openPanel({
            openOverlay: openCallVoiceOverlay,
            closeOverlay: closeCallVoiceOverlay,
            overlayRoot: overlayEl,
            onSend: function (payload) {
                appendTranscriptLine({
                    role: 'user',
                    text: payload.voiceText,
                    voiceAudioIdbKey: payload.voiceAudioIdbKey,
                    voiceDurationSec: payload.voiceDurationSec
                });
            }
        });
    }

    function isCallDialCommandLine(text) {
        var t = String(text || '').trim();
        if (!t) return false;
        return /^(?:发起(?:语音|视频)通话|【拨打(?:语音|视频)电话】)\s*[。．.!！?？…~～]*$/.test(t);
    }

    function getActiveChatId() {
        return active && active.status !== 'ended' ? String(active.chatId || '') : '';
    }

    function parseCallApiLines(lines, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var mode = opts.mode || 'turn';
        var arr = Array.isArray(lines) ? lines : [];
        var out = [];

        if (mode === 'ring') {
            var joined = arr.join('\n');
            var first = arr[0] ? String(arr[0]).trim() : '';
            if (/^通话拒接/.test(first) || /^通话拒接/.test(joined)) {
                return {
                    bubbles: [],
                    ringRejected: true,
                    rejectNote: arr.slice(1).join(' ').trim() || '对方未接听'
                };
            }
            var accepted = /^通话接听/.test(first) || joined.indexOf('通话接听') >= 0;
            arr.forEach(function (ln) {
                var t = String(ln || '').trim();
                if (!t || /^通话接听/.test(t) || isCallDialCommandLine(t)) return;
                out.push({ role: 'assistant', callLine: t });
            });
            return {
                bubbles: out,
                ringAccepted: accepted || out.length > 0,
                ringRejected: !accepted && !out.length
            };
        }

        arr.forEach(function (ln) {
            var t = String(ln || '').trim();
            if (!t) return;
            if (/^通话拒接/.test(t) || /^通话接听/.test(t)) return;
            if (isCallDialCommandLine(t) || /^发起(?:语音|视频)通话/.test(t)) return;
            out.push({ role: 'assistant', callLine: t });
        });
        return { bubbles: out };
    }

    function extractTextFromApiItem(item) {
        if (!item) return '';
        if (item.text) return String(item.text).trim();
        if (item.callLine) return String(item.callLine).trim();
        if (item.voiceText) return String(item.voiceText).trim();
        return String(item.content || '')
            .replace(/^语音[-－—]\s*/, '')
            .trim();
    }

    function ingestFromApiResult(res) {
        var list = (res && res.messages) || [];
        list.forEach(function (item) {
            var text = extractTextFromApiItem(item);
            if (text && isCallDialCommandLine(text)) return;
            if (text) {
                appendTranscriptLine({
                    role: item.role === 'user' ? 'user' : 'assistant',
                    text: text
                });
            }
        });
        forceTypingOff();
        return Promise.resolve();
    }

    function buildActiveTranscriptSystemBlock(callId) {
        if (!active || !active.lines.length) return '';
        if (callId && String(active.callId) !== String(callId)) return '';
        var ctx = getChatContext(active.chatId);
        var userName = (ctx && ctx.profile && ctx.profile.name) || '用户';
        var roleName = (ctx && ctx.contact && displayContactName(ctx.contact)) || '角色';
        var lines = [
            '〔视频通话·进行中〕',
            '【以下为本次视频通话已发生的实时口语，不是微信文字聊天；请延续通话情境】'
        ];
        if (active.cameraClosedByUser) {
            lines.push(
                '【摄像头】用户已关闭摄像头；你看不到任何画面，禁止描述或编造用户外貌、表情、动作、穿着、环境等视觉内容。'
            );
        } else if (active.cameraOn) {
            lines.push('【摄像头】用户摄像头开启中，可结合本轮注入的画面信息回应。');
        }
        active.lines.forEach(function (it) {
            var who = it.role === 'user' ? userName : roleName;
            lines.push(who + '：' + it.text);
        });
        lines.push('〔视频通话·进行中·对白止〕');
        return lines.join('\n');
    }

    function waitVideoFrameReady(vid, timeoutMs) {
        return new Promise(function (resolve) {
            if (!vid) {
                resolve(false);
                return;
            }
            if (vid.readyState >= 2 && vid.videoWidth > 0 && vid.videoHeight > 0) {
                resolve(true);
                return;
            }
            var done = false;
            function finish(ok) {
                if (done) return;
                done = true;
                vid.removeEventListener('loadeddata', onReady);
                vid.removeEventListener('loadedmetadata', onReady);
                resolve(!!ok);
            }
            function onReady() {
                finish(vid.videoWidth > 0 && vid.videoHeight > 0);
            }
            vid.addEventListener('loadeddata', onReady);
            vid.addEventListener('loadedmetadata', onReady);
            setTimeout(function () {
                finish(vid.videoWidth > 0 && vid.videoHeight > 0);
            }, timeoutMs || 900);
        });
    }

    function pickCameraVideoEl() {
        if (!active) return null;
        if (active.mainView === 'self') {
            var main = $('mc-call-main-video');
            if (main && !main.hidden) return main;
        }
        pipVideoEl = $('mc-call-pip-video');
        return pipVideoEl;
    }

    function captureCameraFrame() {
        return new Promise(function (resolve) {
            if (!cameraStream || !active || !active.cameraOn || active.cameraClosedByUser) {
                resolve('');
                return;
            }
            var vid = pickCameraVideoEl();
            if (!vid) {
                resolve('');
                return;
            }
            waitVideoFrameReady(vid, 700).then(function (ok) {
                if (!ok || !vid.videoWidth) {
                    resolve('');
                    return;
                }
                try {
                    var srcW = Math.max(1, Math.floor(vid.videoWidth));
                    var srcH = Math.max(1, Math.floor(vid.videoHeight));
                    var maxEdge = 640;
                    var scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
                    var c = document.createElement('canvas');
                    c.width = Math.max(1, Math.floor(srcW * scale));
                    c.height = Math.max(1, Math.floor(srcH * scale));
                    var ctx = c.getContext('2d');
                    if (!ctx) {
                        resolve('');
                        return;
                    }
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    var mirror =
                        active.cameraFacing !== 'environment' &&
                        (vid.style.transform === 'scaleX(-1)' ||
                            vid.classList.contains('is-mirror') ||
                            active.cameraFacing === 'user');
                    if (mirror) {
                        ctx.translate(c.width, 0);
                        ctx.scale(-1, 1);
                    }
                    ctx.drawImage(vid, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/jpeg', 0.62));
                } catch (e) {
                    resolve('');
                }
            });
        });
    }

    function captureCameraVision() {
        // 有画面时直接交给通话模型，禁止再额外跑一轮识图（会把回复拖死）
        return captureCameraFrame().then(function (dataUrl) {
            return { dataUrl: dataUrl || '', note: '' };
        });
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(function (t) {
                try {
                    t.stop();
                } catch (_) {}
            });
        }
        cameraStream = null;
        pipVideoEl = $('mc-call-pip-video');
        if (pipVideoEl) {
            pipVideoEl.srcObject = null;
            pipVideoEl.hidden = true;
            pipVideoEl.style.transform = '';
        }
        var mainVid = $('mc-call-main-video');
        if (mainVid) {
            mainVid.srcObject = null;
            mainVid.hidden = true;
            mainVid.style.transform = '';
        }
        if (active) active.cameraOn = false;
        syncViewports();
        syncCamToggleBtn();
    }

    function startCamera() {
        if (!active || active.kind !== 'video') return Promise.resolve();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            toast('当前环境不支持摄像头');
            return Promise.resolve();
        }
        var facing = active.cameraFacing === 'environment' ? 'environment' : 'user';
        return navigator.mediaDevices
            .getUserMedia({
                video: {
                    facingMode: { ideal: facing },
                    width: { ideal: 720 },
                    height: { ideal: 1280 }
                },
                audio: false
            })
            .then(function (stream) {
                stopCamera();
                cameraStream = stream;
                active.cameraOn = true;
                pipVideoEl = $('mc-call-pip-video');
                var pipAva = $('mc-call-pip-ava');
                if (!pipVideoEl) return;
                syncViewports();
                syncCamToggleBtn();
            })
            .catch(function () {
                toast('无法访问摄像头');
                syncCamToggleBtn();
            });
    }

    function requestCallApi(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var eng = engine();
        if (!eng || !active) return Promise.reject(new Error('no_active'));
        if (eng.isChatApiBusy && eng.isChatApiBusy(active.chatId)) {
            toast('请等待上一轮请求完成');
            return Promise.reject(new Error('busy'));
        }
        setTyping(true);
        var chain = Promise.resolve({ dataUrl: '', note: '' });
        var userClosedCam = !!active.cameraClosedByUser;
        if (!userClosedCam && active.cameraOn && cameraStream) {
            chain = captureCameraVision();
        }
        return chain
            .then(function (vision) {
                vision = vision && typeof vision === 'object' ? vision : { dataUrl: '', note: '' };
                return eng.sendChat(active.chatId, opts.userText || '', {
                    skipUserMessage: true,
                    callMode: true,
                    callEphemeral: true,
                    callKind: active.kind,
                    callId: active.callId,
                    callParseMode: opts.callParseMode || 'turn',
                    systemLead: opts.systemLead || '',
                    cameraOff: userClosedCam,
                    cameraVisionNote: '',
                    cameraFrameDataUrl: userClosedCam ? '' : vision.dataUrl || ''
                });
            })
            .then(function (res) {
                forceTypingOff();
                return res;
            })
            .catch(function (err) {
                forceTypingOff();
                throw err;
            });
    }

    function beginActiveCall(chatId, kind, callId, direction, keepLines) {
        var prevLines = keepLines && active && active.lines ? active.lines.slice() : [];
        active = {
            chatId: chatId,
            callId: callId || newCallId(),
            kind: 'video',
            status: 'active',
            direction: direction || 'outgoing',
            startedAt: null,
            lines: prevLines,
            cameraOn: false,
            cameraClosedByUser: false,
            cameraFacing: 'user',
            mainView: 'role',
            typing: false
        };
        setHostOpen(true);
        showRingUI(false);
        if (!keepLines) {
            clearTranscriptUi();
            active.lines = [];
        } else {
            active.lines = prevLines.slice();
            var box = $('mc-call-lines');
            if (box) box.innerHTML = '';
            prevLines.forEach(function (it) {
                appendTranscriptLine({ role: it.role, text: it.text }, true);
            });
        }
        applyCallBackground(chatId);
        hydrateAvatars();
        updateHeader();
        startTimer();
        startCamera();
    }

    function saveCallCapsule() {
        if (!active || !active.startedAt) return Promise.resolve();
        var st = store();
        if (!st) return Promise.resolve();
        var dur = Math.floor((Date.now() - active.startedAt) / 1000);
        return st.addMessage(active.chatId, {
            role: 'system',
            type: 'call_capsule',
            callId: active.callId,
            callKind: active.kind,
            content: formatCallDuration(dur),
            callCapsule: {
                kind: active.kind,
                status: 'ended',
                durationSec: dur,
                startedAt: active.startedAt || Date.now(),
                endedAt: Date.now(),
                callId: active.callId,
                items: active.lines.slice()
            }
        });
    }

    function endCall() {
        if (!active) return Promise.resolve();
        stopTimer();
        stopCamera();
        forceTypingOff();
        if (global.MiyaChatVoiceRecord && typeof global.MiyaChatVoiceRecord.destroyActive === 'function') {
            global.MiyaChatVoiceRecord.destroyActive();
        }
        closeCallVoiceOverlay();
        var chatId = active.chatId;
        var eng = engine();
        if (eng && typeof eng.releaseChatApi === 'function') {
            try {
                eng.releaseChatApi(chatId);
            } catch (_) {}
        }
        var hadSession = !!active.startedAt;
        var done = (hadSession ? saveCallCapsule() : Promise.resolve()).then(function () {
            active = null;
            setHostOpen(false);
            if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === chatId) {
                if (typeof global.miyaChatRoom.refresh === 'function') {
                    global.miyaChatRoom.refresh();
                }
            }
            if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
                global.miyaChatApp.refreshLists();
            }
        });
        return done;
    }

    function finishOutgoingRing(chatId, kind, callId, res) {
        var meta = res && res.callApiMeta;
        if (meta && meta.ringRejected) {
            toast(meta.rejectNote || '对方未接听');
            active = null;
            setHostOpen(false);
            return;
        }
        return ingestFromApiResult(res).then(function () {
            beginActiveCall(chatId, kind, callId, 'outgoing', true);
        });
    }

    function userOutgoingRing(chatId) {
        var kind = 'video';
        var eng = engine();
        if (!eng) {
            toast('引擎未就绪');
            return;
        }
        if (isActive()) {
            toast('当前已在通话中');
            return;
        }
        var ctx = getChatContext(chatId);
        if (!ctx) return;
        var callId = newCallId();
        active = {
            chatId: chatId,
            callId: callId,
            kind: 'video',
            status: 'ringing',
            direction: 'outgoing',
            lines: [],
            cameraOn: false,
            cameraClosedByUser: false,
            cameraFacing: 'user',
            mainView: 'role'
        };
        setHostOpen(true);
        clearTranscriptUi();
        showRingUI(false);
        applyCallBackground(chatId);
        hydrateAvatars();
        updateHeader();
        var statusEl = $('mc-call-status');
        if (statusEl) statusEl.textContent = '正在呼叫…';

        var ringRules =
            typeof eng.buildCallRingRules === 'function'
                ? eng.buildCallRingRules(ctx.contact, ctx.profile, kind)
                : '用户正在发起视频通话，请决定接听或拒接。';

        function runRingRequest(retryLeft) {
            requestCallApi({ systemLead: ringRules, callParseMode: 'ring' })
                .then(function (res) {
                    return finishOutgoingRing(chatId, kind, callId, res);
                })
                .catch(function () {
                    if (retryLeft > 0) {
                        runRingRequest(retryLeft - 1);
                        return;
                    }
                    toast('视频连接失败，请稍后再试');
                    if (eng && typeof eng.releaseChatApi === 'function') {
                        try {
                            eng.releaseChatApi(chatId);
                        } catch (_) {}
                    }
                    active = null;
                    setHostOpen(false);
                });
        }

        runRingRequest(1);
    }

    function roleIncomingRing(chatId) {
        var kind = 'video';
        if (isActive()) return;
        var ctx = getChatContext(chatId);
        if (!ctx) return;
        var callId = newCallId();
        active = {
            chatId: chatId,
            callId: callId,
            kind: 'video',
            status: 'ringing',
            direction: 'incoming',
            lines: [],
            cameraOn: false,
            cameraClosedByUser: false,
            cameraFacing: 'user',
            mainView: 'role'
        };
        setHostOpen(true);
        clearTranscriptUi();
        applyCallBackground(chatId);
        hydrateAvatars();
        showRingUI(true, displayContactName(ctx.contact) + ' · 视频来电');
        updateHeader();
    }

    function acceptIncoming() {
        if (!active || active.status !== 'ringing' || active.direction !== 'incoming') return;
        var chatId = active.chatId;
        var kind = active.kind;
        var callId = active.callId;
        beginActiveCall(chatId, kind, callId, 'incoming', false);
        requestCallApi({
            systemLead:
                '【通话已接通】用户已接听你的来电。请先开口说口语（每行一句，1–15 行，由你根据人设与情境自行决定），遵守通话格式规则。'
        })
            .then(function (res) {
                return ingestFromApiResult(res);
            })
            .catch(function () {});
    }

    function declineIncoming() {
        if (!active) return;
        toast('已拒接');
        active = null;
        setHostOpen(false);
    }

    function startOutgoing(chatId) {
        var st = store();
        if (!st) return;
        userOutgoingRing(chatId);
    }

    function onRoleCallIntent(chatId, kind) {
        if (kind !== 'video') return;
        var st = store();
        if (st) {
            var s = st.getChatSettings(chatId);
            var caps = (s && s.promptCapabilities) || {};
            if (caps.call === false) return;
        }
        roleIncomingRing(chatId);
    }

    function sendUserLine() {
        if (!active || active.status !== 'active') return;
        var inp = $('mc-call-input');
        var text = inp ? String(inp.value || '').trim() : '';
        if (!text) return;
        appendTranscriptLine({ role: 'user', text: text });
        if (inp) inp.value = '';
    }

    function askRoleSpeak() {
        if (!active || active.status !== 'active') return;
        if (apiPending > 0) return;
        requestCallApi({})
            .then(function (res) {
                return ingestFromApiResult(res);
            })
            .catch(function () {
                toast('对方暂时没有回应，可再试一次');
            });
    }

    function findCapsuleMessage(chatId, callId) {
        var st = store();
        if (!st) return null;
        var list = st.getMessages(chatId) || [];
        for (var i = list.length - 1; i >= 0; i--) {
            var m = list[i];
            if (!m || m.deleted || m.type !== 'call_capsule') continue;
            var cid = (m.callCapsule && m.callCapsule.callId) || m.callId;
            if (String(cid) === String(callId)) return m;
        }
        return null;
    }

    function openCallArchive(chatId, callId) {
        var m = findCapsuleMessage(chatId, callId);
        if (!m || !m.callCapsule) {
            toast('未找到通话记录');
            return;
        }
        ensureArchiveHost();
        if (!archiveEl) return;
        var cap = m.callCapsule;
        var title = $archive('mc-call-archive-title');
        var body = $archive('mc-call-archive-body');
        if (title) title.textContent = formatCallDuration(cap.durationSec);
        var items = Array.isArray(cap.items) ? cap.items : [];
        var ctx = getChatContext(chatId);
        if (!body) return;
        if (!items.length) {
            body.innerHTML = '<p class="mc-call-archive-empty">本次通话无文字记录</p>';
        } else {
            body.innerHTML = items
                .map(function (it) {
                    var isUser = it.role === 'user';
                    var who = isUser
                        ? (ctx && ctx.profile && ctx.profile.name) || '我'
                        : ctx && ctx.contact
                          ? displayContactName(ctx.contact)
                          : '对方';
                    var play = isUser
                        ? buildArchiveUserRecPlayBtn(it)
                        : '<button type="button" class="mc-call-archive-play" data-call-play-text="' +
                          esc(it.text) +
                          '" data-call-chat-id="' +
                          esc(chatId) +
                          '" aria-label="播放">▶</button>';
                    return (
                        '<div class="mc-call-archive-msg' +
                        (isUser ? ' is-me' : ' is-other') +
                        '">' +
                        '<span class="mc-call-archive-who">' +
                        esc(who) +
                        '</span>' +
                        '<div class="mc-call-archive-bubble">' +
                        '<p class="mc-call-archive-text">' +
                        esc(it.text) +
                        '</p>' +
                        play +
                        '</div></div>'
                    );
                })
                .join('');
        }
        archiveEl.hidden = false;
        archiveEl.setAttribute('aria-hidden', 'false');
        archiveEl.classList.add('is-open');
    }

    function closeCallArchive() {
        if (!archiveEl) return;
        archiveEl.classList.remove('is-open');
        archiveEl.hidden = true;
        archiveEl.setAttribute('aria-hidden', 'true');
    }

    function bindPipDrag() {
        var pip = $('mc-call-pip');
        if (!pip || pip.dataset.dragBound) return;
        pip.dataset.dragBound = '1';
        var dragging = false;
        var sx = 0;
        var sy = 0;
        var sl = 0;
        var st = 0;
        function onStart(e) {
            dragging = true;
            pip.classList.add('is-dragging');
            var p = e.touches ? e.touches[0] : e;
            sx = p.clientX;
            sy = p.clientY;
            var rect = pip.getBoundingClientRect();
            sl = rect.left;
            st = rect.top;
            e.preventDefault();
        }
        function onMove(e) {
            if (!dragging) return;
            var p = e.touches ? e.touches[0] : e;
            pip.style.left = sl + (p.clientX - sx) + 'px';
            pip.style.top = st + (p.clientY - sy) + 'px';
            pip.style.right = 'auto';
            pip.style.bottom = 'auto';
        }
        function onEnd() {
            dragging = false;
            pip.classList.remove('is-dragging');
        }
        pip.addEventListener('mousedown', onStart);
        pip.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchend', onEnd);
    }

    function bindHostEvents() {
        if (!hostEl || hostEl.dataset.bound) return;
        hostEl.dataset.bound = '1';
        bindPipDrag();
        hostEl.addEventListener('click', function (e) {
            var act = e.target.closest('[data-call-act]');
            if (act) {
                var key = act.getAttribute('data-call-act');
                if (key === 'hangup') endCall();
                else if (key === 'ask-role') askRoleSpeak();
                else if (key === 'send-user') sendUserLine();
                else if (key === 'voice-record') openCallVoiceRecord();
                else if (key === 'flip-cam') {
                    if (!active) return;
                    active.cameraFacing =
                        active.cameraFacing === 'environment' ? 'user' : 'environment';
                    if (active.cameraOn) startCamera();
                } else if (key === 'toggle-cam') {
                    toggleCamera();
                }
                return;
            }
            var ring = e.target.closest('[data-call-ring]');
            if (ring) {
                if (ring.getAttribute('data-call-ring') === 'accept') acceptIncoming();
                else declineIncoming();
                return;
            }
            var play = e.target.closest('[data-call-play-text]');
            if (play) {
                playCallText(play.getAttribute('data-call-play-text'), active && active.chatId);
                return;
            }
            var userRec = e.target.closest('[data-call-play-user-voice]');
            if (userRec) {
                playUserVoiceAudio(
                    userRec.getAttribute('data-audio-key'),
                    userRec.getAttribute('data-audio-dur'),
                    userRec
                );
                return;
            }
            if (
                active &&
                active.kind === 'video' &&
                e.target.closest('.mc-call-stage') &&
                !e.target.closest(
                    '[data-call-act], [data-call-ring], [data-call-play-text], [data-call-play-user-voice], .mc-call-bubble, .mc-call-bubble-play, .mc-call-pip, .mc-call-input, .mc-call-topbar, .mc-call-ring, .mc-call-voice-overlay, button, input, a'
                )
            ) {
                active.mainView = active.mainView === 'self' ? 'role' : 'self';
                syncViewports();
                return;
            }
        });
        var inp = $('mc-call-input');
        if (inp) {
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    sendUserLine();
                }
            });
            inp.addEventListener('focus', function () {
                if (!active || active.kind !== 'video') return;
                cancelCallKbRecovery();
                callIosKeyboardWasOpen = true;
                syncCallKeyboardInset();
                requestAnimationFrame(syncCallKeyboardInset);
                setTimeout(syncCallKeyboardInset, 80);
                setTimeout(syncCallKeyboardInset, 180);
            });
            inp.addEventListener('blur', function () {
                requestAnimationFrame(syncCallKeyboardInset);
                if (isIOSCall()) recoverCallViewportAfterKeyboard();
            });
        }
    }

    function openCallPicker(chatId) {
        startOutgoing(chatId);
    }

    function handleClick(e) {
        var cap = e.target.closest('[data-qq-call-capsule]');
        if (cap) {
            e.preventDefault();
            e.stopPropagation();
            var cid = cap.getAttribute('data-chat-id');
            var callId = cap.getAttribute('data-call-id');
            if (cid && callId) openCallArchive(cid, callId);
            return true;
        }
        return false;
    }

    global.MiyaChatCalls = {
        ensureCallHost: ensureCallHost,
        isActive: isActive,
        getActiveChatId: getActiveChatId,
        isCallDialCommandLine: isCallDialCommandLine,
        handleClick: handleClick,
        formatCallDuration: formatCallDuration,
        startOutgoing: startOutgoing,
        openCallPicker: openCallPicker,
        onRoleCallIntent: onRoleCallIntent,
        parseCallApiLines: parseCallApiLines,
        buildActiveTranscriptSystemBlock: buildActiveTranscriptSystemBlock,
        endCall: endCall
    };
})(window);
