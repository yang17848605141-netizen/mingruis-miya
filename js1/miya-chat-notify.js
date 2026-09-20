(function (global) {
    'use strict';

    var BANNER_SLOT_MS = 2600;
    var BANNER_LAST_HOLD_MS = 2000;
    var bannerQueue = [];
    var bannerBusy = false;
    var bannerHideTimer = null;
    var bannerRoot = null;
    var bannerCard = null;

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function systemNotifyEnabled() {
        var N = global.miyaGetNotificationApi ? global.miyaGetNotificationApi() : (typeof Notification !== 'undefined' ? Notification : null);
        if (!N) return false;
        try {
            if (N.permission !== 'granted') return false;
        } catch (e) {
            return false;
        }
        if (global.miyaGetSystemPrefs) {
            var p = global.miyaGetSystemPrefs();
            return !!(p && p.notify);
        }
        return false;
    }

    function inAppBannerEnabled(chatId) {
        var store = global.miyaChatStore;
        if (!store || !chatId) return false;
        var settings = store.getChatSettings(chatId);
        if (settings.muteNotifications) return false;
        return settings.replyBannerEnabled !== false;
    }

    function avatarSvg(name) {
        var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
        return (
            'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
                    '<rect width="80" height="80" rx="40" fill="#F0F0F0"/>' +
                    '<text x="40" y="48" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="28" fill="#8E8E93">' +
                    ch +
                    '</text></svg>'
            )
        );
    }

    function contactIcon(contact) {
        var extras = global.miyaChatRoomExtras;
        var url =
            extras && typeof extras.resolveContactAvatarUrl === 'function'
                ? extras.resolveContactAvatarUrl(contact)
                : String((contact && contact.avatar) || '').trim();
        if (url) return url;
        return avatarSvg((contact && contact.name) || 'TA');
    }

    function displayName(contact, chat) {
        void chat;
        return String((contact && contact.name) || 'TA').trim() || 'TA';
    }

    function previewOneMessage(m) {
        if (!m || m.deleted) return '';
        var fmt = global.MiyaChatOnlineFormat;
        if (fmt && typeof fmt.isRoomInvisibleMessage === 'function' && fmt.isRoomInvisibleMessage(m)) return '';
        var t = '';
        if (m.type === 'voice') t = String(m.voiceText || m.content || '').trim() || '[语音]';
        else if (m.type === 'image') t = String(m.content || '').trim() || '[图片]';
        else if (m.type === 'sticker') t = '[表情]';
        else if (m.type === 'transfer') t = '[转账]';
        else if (m.type === 'takeout') t = '[外卖]';
        else if (m.type === 'gift') t = '[礼品]';
        else if (m.type === 'love_poem') t = '[情诗]';
        else if (m.type === 'location') t = '[位置]';
        else if (m.type === 'call_capsule') {
            var cap = m.callCapsule || {};
            var sec = Number(cap.durationSec) || 0;
            var calls = global.MiyaChatCalls;
            if (calls && typeof calls.formatCallDuration === 'function' && sec) {
                t = calls.formatCallDuration(sec);
            } else if (sec) {
                t =
                    String(Math.floor(sec / 60)).padStart(2, '0') +
                    ':' +
                    String(sec % 60).padStart(2, '0');
            }
        } else if (m.type === 'listen_together_capsule') {
            var ltCap = m.listenTogetherCapsule || {};
            var ltSec = Number(ltCap.durationSec) || 0;
            var lt = global.MiyaMusicListenTogether;
            if (lt && typeof lt.formatDuration === 'function' && ltSec) {
                t = '[一起听] ' + lt.formatDuration(ltSec);
            } else if (ltSec) {
                t =
                    '[一起听] ' +
                    String(Math.floor(ltSec / 60)).padStart(2, '0') +
                    ':' +
                    String(ltSec % 60).padStart(2, '0');
            }
            if (ltCap.trackTitle) t += ' · ' + ltCap.trackTitle;
        } else if (m.type === 'couple_space_invite' && m.coupleSpaceInvite) {
            var cpn = m.coupleSpaceInvite;
            if (cpn.status === 'accepted') t = '[情侣空间] 已同意';
            else if (cpn.status === 'declined') t = '[情侣空间] 已婉拒';
            else t = '[情侣空间] 邀请开通';
        } else t = String(m.content || '').trim();
        if (!t) return '';
        return t.length > 120 ? t.slice(0, 117) + '…' : t;
    }

    function visibleAssistantMessages(msgs) {
        if (!Array.isArray(msgs)) return [];
        return msgs.filter(function (m) {
            return previewOneMessage(m);
        });
    }

    function isRoomOpenForChat(chatId) {
        return (
            global.miyaChatRoom &&
            typeof global.miyaChatRoom.getOpenChatId === 'function' &&
            global.miyaChatRoom.getOpenChatId() === chatId
        );
    }

    function getOverlayAppApis() {
        return [
            global.miyaBeautifyApp,
            global.miyaSettingsApp,
            global.miyaWorldbookApp,
            global.miyaContactsApp,
            global.miyaMusicApp,
            global.miyaMemoryApp,
            global.miyaForumApp,
            global.miyaCstoreApp,
            global.miyaItineraryApp,
            global.miyaCoupleApp,
            global.miyaTypewriterApp,
            global.miyaOfflineApp
        ];
    }

    var OVERLAY_APP_SELECTOR =
        '.miya-beautify-app.is-open, .miya-settings-app.is-open, .miya-worldbook-app.is-open, ' +
        '.miya-contacts-app.is-open, #miya-music-app.is-open, #miya-memory-app.is-open, ' +
        '#miya-forum-app.is-open, #miya-cstore-app.is-open, #miya-itinerary-app.is-open, ' +
        '#miya-couple-app.is-open, ' +
        '#miya-typewriter-app.is-open, #miya-offline-app.is-open';

    function isOverlayAppOpen(el) {
        return !!(el && el.classList.contains('is-open') && !el.hasAttribute('hidden'));
    }

    function isAnotherAppCoveringChat() {
        var covers = document.querySelectorAll(OVERLAY_APP_SELECTOR);
        for (var i = 0; i < covers.length; i++) {
            if (isOverlayAppOpen(covers[i])) return true;
        }
        return false;
    }

    function dismissOverlayApps() {
        getOverlayAppApis().forEach(function (api) {
            if (!api || typeof api.close !== 'function') return;
            try {
                api.close();
            } catch (e) {}
        });
    }

    function isChatRoomForeground(chatId) {
        if (!isRoomOpenForChat(chatId)) return false;
        var app = document.getElementById('miya-chat-app');
        var room = document.getElementById('qq-room');
        if (!app || app.hasAttribute('hidden') || !app.classList.contains('is-open')) return false;
        if (!room || room.hidden || !app.classList.contains('qq-room-open')) return false;
        if (isAnotherAppCoveringChat()) return false;
        return true;
    }

    function shouldSystemNotify(chatId) {
        var store = global.miyaChatStore;
        if (store && chatId) {
            var settings = store.getChatSettings(chatId);
            if (settings && settings.muteNotifications) return false;
        }
        if (!systemNotifyEnabled()) return false;
        if (document.hidden) return true;
        var app = document.getElementById('miya-chat-app');
        if (!app || app.hasAttribute('hidden') || !app.classList.contains('is-open')) return true;
        return false;
    }

    function shouldInAppBanner(chatId) {
        if (document.hidden) return false;
        if (!inAppBannerEnabled(chatId)) return false;
        if (isRoomOpenForChat(chatId)) return false;
        return !isChatRoomForeground(chatId);
    }

    function ensureBannerRoot() {
        if (bannerRoot && bannerRoot.parentNode) return bannerRoot;
        bannerRoot = document.getElementById('miya-msg-pop-root');
        if (!bannerRoot) {
            bannerRoot = document.createElement('div');
            bannerRoot.id = 'miya-msg-pop-root';
            bannerRoot.className = 'miya-msg-pop-root';
            bannerRoot.setAttribute('aria-live', 'polite');
            bannerRoot.hidden = true;
            document.body.appendChild(bannerRoot);
        }
        if (!bannerBusy && !bannerQueue.length) {
            bannerRoot.hidden = true;
            bannerRoot.setAttribute('aria-hidden', 'true');
        }
        return bannerRoot;
    }

    function setBannerHostVisible(visible) {
        var root = ensureBannerRoot();
        if (visible) {
            root.hidden = false;
            root.removeAttribute('aria-hidden');
        } else {
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
        }
    }

    function renderBannerCard(item) {
        setBannerHostVisible(true);
        var root = ensureBannerRoot();
        if (!bannerCard) {
            bannerCard = document.createElement('button');
            bannerCard.type = 'button';
            bannerCard.className = 'miya-msg-pop';
            bannerCard.setAttribute('aria-label', '打开对话');
            bannerCard.addEventListener('click', function () {
                var cid = bannerCard.getAttribute('data-chat-id');
                if (cid) openChat(cid);
            });
            root.appendChild(bannerCard);
        }
        bannerCard.setAttribute('data-chat-id', item.chatId);
        var avatarAttr = item.contactId
            ? ' data-avatar-contact="' + esc(item.contactId) + '"'
            : '';
        bannerCard.innerHTML =
            '<img class="miya-msg-pop__avatar" src="' +
            esc(item.icon) +
            '"' +
            avatarAttr +
            ' alt="">' +
            '<span class="miya-msg-pop__body">' +
            '<span class="miya-msg-pop__head">' +
            '<span class="miya-msg-pop__name">' +
            esc(item.title) +
            '</span>' +
            (item.badge
                ? '<span class="miya-msg-pop__badge">' + esc(item.badge) + '</span>'
                : '') +
            '</span>' +
            '<span class="miya-msg-pop__text">' +
            esc(item.body) +
            '</span>' +
            '</span>';
        if (item.contactId) hydrateBannerAvatar(item.contactId);
        requestAnimationFrame(function () {
            bannerCard.classList.add('is-visible');
        });
    }

    function hideBannerCard(done) {
        if (!bannerCard) {
            setBannerHostVisible(false);
            if (done) done();
            return;
        }
        bannerCard.classList.remove('is-visible', 'is-swapping');
        bannerCard.classList.add('is-leaving');
        setTimeout(function () {
            if (bannerCard) bannerCard.classList.remove('is-leaving');
            setBannerHostVisible(false);
            if (done) done();
        }, 280);
    }

    function drainBannerQueue() {
        clearTimeout(bannerHideTimer);
        if (!bannerQueue.length) {
            hideBannerCard(function () {
                bannerBusy = false;
            });
            return;
        }
        var item = bannerQueue.shift();
        renderBannerCard(item);
        var hold = bannerQueue.length ? BANNER_SLOT_MS : BANNER_LAST_HOLD_MS;
        bannerHideTimer = setTimeout(function () {
            if (bannerQueue.length) {
                bannerCard.classList.add('is-swapping');
                setTimeout(function () {
                    if (bannerCard) bannerCard.classList.remove('is-swapping');
                    drainBannerQueue();
                }, 280);
            } else {
                hideBannerCard(function () {
                    bannerBusy = false;
                });
            }
        }, hold);
    }

    function isGroupChat(chat) {
        return !!(chat && chat.type === 'group');
    }

    function groupDisplayTitle(chat) {
        return String((chat && chat.title) || '群聊').trim() || '群聊';
    }

    function groupIcon(store, chat) {
        var gg = global.MiyaChatGroup;
        if (!gg || !store || !chat) return avatarSvg(groupDisplayTitle(chat));
        var settings = store.getChatSettings ? store.getChatSettings(chat.id) : null;
        var custom =
            typeof gg.resolveGroupAvatarFromSettings === 'function'
                ? gg.resolveGroupAvatarFromSettings(settings, store)
                : '';
        if (custom) return custom;
        return avatarSvg(groupDisplayTitle(chat));
    }

    function groupIconAsync(store, chat) {
        var gg = global.MiyaChatGroup;
        if (!gg || !store || !chat) return Promise.resolve(groupIcon(store, chat));
        if (typeof gg.resolveGroupAvatarUrlAsync === 'function') {
            return gg.resolveGroupAvatarUrlAsync(store, chat.id).then(function (url) {
                return url || groupIcon(store, chat);
            });
        }
        return Promise.resolve(groupIcon(store, chat));
    }

    function resolveGroupSenderContact(store, chat, m) {
        var gg = global.MiyaChatGroup;
        if (!gg || !store || !chat || !m) return null;
        var members = typeof gg.getMembers === 'function' ? gg.getMembers(store, chat) : [];
        var sid = String(m.senderContactId || '').trim();
        if (sid) {
            for (var i = 0; i < members.length; i++) {
                if (members[i].id === sid) return members[i];
            }
        }
        var raw = String(m.content || '').trim();
        var labelMatch = raw.match(/^【([^】]+)】/);
        if (labelMatch && typeof gg.resolveMemberByLabel === 'function') {
            return gg.resolveMemberByLabel(labelMatch[1], members, store, chat.id);
        }
        var colonMatch = raw.match(/^([^：:\n|｜]{1,32})[：:]/);
        if (colonMatch && typeof gg.resolveMemberByLabel === 'function') {
            return gg.resolveMemberByLabel(colonMatch[1], members, store, chat.id);
        }
        return null;
    }

    function previewGroupBannerBody(store, chat, m) {
        var gg = global.MiyaChatGroup;
        if (gg && typeof gg.formatPreview === 'function') {
            var t = String(gg.formatPreview(store, chat, m) || '').trim();
            if (t) return t.length > 120 ? t.slice(0, 117) + '…' : t;
        }
        return previewOneMessage(m);
    }

    function visibleGroupBannerMessages(store, chat, msgs) {
        if (!Array.isArray(msgs)) return [];
        return msgs.filter(function (m) {
            return previewGroupBannerBody(store, chat, m);
        });
    }

    function buildGroupBannerItem(store, chat, m, title, fallbackIcon, badge) {
        var body = previewGroupBannerBody(store, chat, m);
        if (!body) return null;
        var sender = resolveGroupSenderContact(store, chat, m);
        var icon = fallbackIcon || groupIcon(store, chat);
        var contactId = '';
        if (sender) {
            contactId = String(sender.id || '');
            icon = contactIcon(sender);
        }
        return {
            chatId: chat.id,
            contactId: contactId,
            title: title,
            body: body,
            icon: icon || avatarSvg(title),
            badge: badge || ''
        };
    }

    function pushBannerQueueItems(items) {
        (Array.isArray(items) ? items : []).forEach(function (item) {
            if (!item || !item.body) return;
            bannerQueue.push(item);
        });
        if (!bannerBusy && bannerQueue.length) {
            bannerBusy = true;
            drainBannerQueue();
        }
    }

    function pushBannerItems(chatId, contact, title, icon, visible) {
        var items = [];
        visible.forEach(function (m, i) {
            var body = previewOneMessage(m);
            if (!body) return;
            items.push({
                chatId: chatId,
                contactId: contact && contact.id ? String(contact.id) : '',
                title: title,
                body: body,
                icon: icon || avatarSvg(title),
                badge: visible.length > 1 ? String(i + 1) + '/' + String(visible.length) : ''
            });
        });
        pushBannerQueueItems(items);
    }

    function pushGroupBannerItems(store, chat, visible, fallbackIcon) {
        var title = groupDisplayTitle(chat);
        var items = [];
        visible.forEach(function (m, i) {
            var item = buildGroupBannerItem(
                store,
                chat,
                m,
                title,
                fallbackIcon,
                visible.length > 1 ? String(i + 1) + '/' + String(visible.length) : ''
            );
            if (item) items.push(item);
        });
        pushBannerQueueItems(items);
    }

    function hydrateBannerAvatar(contactId) {
        if (!bannerCard || !contactId) return;
        var img = bannerCard.querySelector('.miya-msg-pop__avatar[data-avatar-contact]');
        if (!img || img.getAttribute('data-avatar-contact') !== String(contactId)) return;
        var st = global.miyaChatStore;
        if (!st) return;
        var contact = st.findContact(contactId);
        if (!contact) return;
        var extras = global.miyaChatRoomExtras;
        var done = function (url) {
            if (url && bannerCard && img.parentNode === bannerCard) img.src = url;
        };
        if (extras && typeof extras.resolveContactAvatarUrlAsync === 'function') {
            extras.resolveContactAvatarUrlAsync(contact).then(done);
            return;
        }
        var sync = contactIcon(contact);
        if (sync && !/^data:image\/svg/i.test(sync)) done(sync);
        else if (contact.avatarBlobId && st.getAvatarUrl) {
            st.getAvatarUrl(contact.avatarBlobId).then(done);
        }
    }

    function enqueueInAppBanner(chatId, msgs) {
        if (!shouldInAppBanner(chatId)) return;
        var store = global.miyaChatStore;
        if (!store) return;
        var chat = store.findChat(chatId);
        if (!chat) return;
        if (isGroupChat(chat)) {
            var visibleGroup = visibleGroupBannerMessages(store, chat, msgs);
            if (!visibleGroup.length) return;
            groupIconAsync(store, chat).then(function (icon) {
                pushGroupBannerItems(store, chat, visibleGroup, icon);
            });
            return;
        }
        var contact = store.findContact(chat.contactId);
        if (!contact) return;
        var title = displayName(contact, chat);
        var visible = visibleAssistantMessages(msgs);
        if (!visible.length) return;
        var extras = global.miyaChatRoomExtras;
        if (extras && typeof extras.resolveContactAvatarUrlAsync === 'function') {
            extras.resolveContactAvatarUrlAsync(contact).then(function (url) {
                pushBannerItems(chatId, contact, title, url ? url : contactIcon(contact), visible);
            });
            return;
        }
        pushBannerItems(chatId, contact, title, contactIcon(contact), visible);
    }

    function forceScrollChatToBottom() {
        var sc = document.getElementById('qq-room-scroll');
        if (!sc) return;
        var attempts = 0;
        function tick() {
            if (!sc.isConnected) return;
            sc.scrollTop = sc.scrollHeight;
            attempts += 1;
            if (attempts < 6) requestAnimationFrame(tick);
        }
        tick();
        setTimeout(function () {
            if (sc.isConnected) sc.scrollTop = sc.scrollHeight;
        }, 80);
        setTimeout(function () {
            if (sc.isConnected) sc.scrollTop = sc.scrollHeight;
        }, 180);
    }

    function ensureChatAppOpen() {
        dismissOverlayApps();
        var el = document.getElementById('miya-chat-app');
        if (el && el.classList.contains('is-open') && !el.hasAttribute('hidden')) {
            document.body.classList.add('miya-app-open');
            return Promise.resolve();
        }
        if (global.miyaChatApp && typeof global.miyaChatApp.open === 'function') {
            var opened = global.miyaChatApp.open();
            if (opened && typeof opened.then === 'function') return opened;
        }
        return new Promise(function (resolve) {
            setTimeout(resolve, 120);
        });
    }

    function openChat(chatId) {
        clearTimeout(bannerHideTimer);
        bannerQueue = [];
        setBannerHostVisible(false);
        if (bannerCard) {
            bannerCard.classList.remove('is-visible', 'is-swapping', 'is-leaving');
        }
        bannerBusy = false;

        var alreadyOpen = isRoomOpenForChat(chatId);
        var openOpts = { toBottom: true, forceRefresh: !alreadyOpen };
        ensureChatAppOpen()
            .then(function () {
                if (global.miyaChatApp && typeof global.miyaChatApp.openChatById === 'function') {
                    return global.miyaChatApp.openChatById(chatId, openOpts);
                }
                if (global.miyaChatRoom && typeof global.miyaChatRoom.open === 'function') {
                    return global.miyaChatRoom.open(chatId, openOpts);
                }
            })
            .then(function () {
                forceScrollChatToBottom();
            })
            .catch(function () {});
    }

    function notifyAssistantMessages(chatId, msgs, meta) {
        if (!chatId || !Array.isArray(msgs) || !msgs.length) return;
        meta = meta && typeof meta === 'object' ? meta : {};

        var store = global.miyaChatStore;
        var visible = visibleAssistantMessages(msgs);

        if (shouldInAppBanner(chatId)) {
            enqueueInAppBanner(chatId, msgs);
        }

        if (
            visible.length &&
            global.MiyaMsgSound &&
            typeof global.MiyaMsgSound.playForIncomingMessage === 'function'
        ) {
            global.MiyaMsgSound.playForIncomingMessage(chatId, visible);
        }

        if (!shouldSystemNotify(chatId)) return;
        if (!store) return;
        var chat = store.findChat(chatId);
        if (!chat) return;
        if (isGroupChat(chat)) {
            var visibleGroupSys = visibleGroupBannerMessages(store, chat, msgs);
            if (!visibleGroupSys.length) return;
            var groupTitle = groupDisplayTitle(chat);
            var groupFallbackIcon = groupIcon(store, chat);
            visibleGroupSys.forEach(function (m, i) {
                var item = buildGroupBannerItem(store, chat, m, groupTitle, groupFallbackIcon, '');
                if (!item || !item.body) return;
                var opts = {
                    body: item.body,
                    tag: 'miya-ch-' + chatId + '-' + String(m.id || i) + '-' + String(m.createdAt || Date.now()),
                    data: { chatId: chatId, kind: 'chat' }
                };
                if (item.icon && !/^data:/i.test(item.icon)) opts.icon = item.icon;
                var show =
                    global.miyaShowSystemNotification
                        ? global.miyaShowSystemNotification(item.title, opts)
                        : Promise.resolve(null);
                show
                    .then(function (n) {
                        if (!n || n._viaSw) return;
                        n.onclick = function () {
                            try {
                                window.focus();
                            } catch (e) {}
                            n.close();
                            openChat(chatId);
                        };
                    })
                    .catch(function (err) {
                        console.warn('[MiyaChatNotify]', err);
                    });
            });
            return;
        }
        var contact = store.findContact(chat.contactId);
        if (!contact) return;
        var title = displayName(contact, chat);
        if (!visible.length) return;
        var icon = contactIcon(contact);
        visible.forEach(function (m, i) {
            var body = previewOneMessage(m);
            if (!body) return;
            var opts = {
                body: body,
                tag: 'miya-ch-' + chatId + '-' + String(m.id || i) + '-' + String(m.createdAt || Date.now()),
                data: { chatId: chatId, kind: 'chat' }
            };
            if (icon && !/^data:/i.test(icon)) opts.icon = icon;
            var show =
                global.miyaShowSystemNotification
                    ? global.miyaShowSystemNotification(title, opts)
                    : Promise.resolve(null);
            show
                .then(function (n) {
                    if (!n || n._viaSw) return;
                    n.onclick = function () {
                        try {
                            window.focus();
                        } catch (e) {}
                        n.close();
                        openChat(chatId);
                    };
                })
                .catch(function (err) {
                    console.warn('[MiyaChatNotify]', err);
                });
        });
    }

    function handleServiceWorkerNotifyClick(data) {
        if (!data || data.type !== 'miya-notify-click') return;
        try {
            window.focus();
        } catch (e) {}
        if (String(data.kind || '') === 'weather_care' && data.careId) {
            if (global.miyaWeatherBridge && typeof global.miyaWeatherBridge.openWeatherCare === 'function') {
                global.miyaWeatherBridge.openWeatherCare(data.careId);
            }
            return;
        }
        if (data.chatId) openChat(data.chatId);
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', function (event) {
            handleServiceWorkerNotifyClick(event.data);
        });
    }

    (function bindForegroundChatSync() {
        if (global.__miyaNotifyFgSyncBound) return;
        global.__miyaNotifyFgSyncBound = true;
        function syncOpenChatFromStore() {
            var room = global.miyaChatRoom;
            if (!room || typeof room.getOpenChatId !== 'function') return;
            var cid = room.getOpenChatId();
            if (!cid) return;
            if (typeof room.open === 'function') {
                room.open(cid, { toBottom: true, forceRefresh: true }).catch(function () {});
            } else if (typeof room.refresh === 'function') {
                room.refresh({ toBottom: true });
            }
        }
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) syncOpenChatFromStore();
        });
        window.addEventListener('pageshow', function () {
            if (!document.hidden) syncOpenChatFromStore();
        });
        window.addEventListener('focus', function () {
            if (!document.hidden) syncOpenChatFromStore();
        });
    })();

    (function consumeNotifyDeepLink() {
        var hash = String(location.hash || '');
        var m = hash.match(/(?:^|[#&])miya-open-chat=([^&]+)/);
        if (!m) return;
        var chatId = decodeURIComponent(m[1] || '');
        if (!chatId) return;
        history.replaceState(null, '', location.pathname + location.search);
        setTimeout(function () {
            openChat(chatId);
        }, 300);
    })();

    global.MiyaChatNotify = {
        notifyAssistantMessages: notifyAssistantMessages,
        systemNotifyEnabled: systemNotifyEnabled,
        inAppBannerEnabled: inAppBannerEnabled,
        enqueueInAppBanner: enqueueInAppBanner,
        isChatRoomForeground: isChatRoomForeground,
        openChat: openChat
    };
})(window);
