(function (global) {
    'use strict';

    var ui = {
        view: 'pick',
        chatId: '',
        contactId: '',
        sessionId: '',
        viewingArchive: false,
        streamingLines: [],
        streamingRaw: '',
        streamingRevealLen: 0,
        status: 'idle',
        summaryBusy: false,
        catalogNo: '',
        stableStoryKey: '',
        dockCollapsed: false,
        pickSelected: []
    };

    var streamUi = {
        raf: 0,
        scrollRaf: 0,
        revealRaf: 0,
        paraCount: 0,
        userPinnedBottom: true
    };

    var SCROLL_PIN_THRESHOLD = 72;

    /** 角色人称 × 用户人称 · 九种叙事组合 */
    var POV_COMBOS = [
        { rolePerson: 'third', userPerson: 'second', label: '他看她 · 对你', hint: '经典长篇：角色第三人称，对你用「你」' },
        { rolePerson: 'third', userPerson: 'third', label: '他看她 · 看他', hint: '双第三人称，像纸上小说旁观' },
        { rolePerson: 'third', userPerson: 'first', label: '他看她 · 我是你', hint: '角色第三人称，把你写成第一人称「我」' },
        { rolePerson: 'second', userPerson: 'second', label: '你就是她 · 你也是你', hint: '面对面第二人称，对白感强' },
        { rolePerson: 'second', userPerson: 'third', label: '你就是她 · 看他', hint: '角色对你用「你」，提及用户用第三人称' },
        { rolePerson: 'second', userPerson: 'first', label: '你就是她 · 我是你', hint: '角色第二人称，用户第一人称' },
        { rolePerson: 'first', userPerson: 'second', label: '我是她 · 对你', hint: '角色自述「我」，对你用「你」' },
        { rolePerson: 'first', userPerson: 'third', label: '我是她 · 看他', hint: '角色第一人称，用户第三人称' },
        { rolePerson: 'first', userPerson: 'first', label: '双「我」', hint: '角色与用户皆第一人称，慎用' }
    ];

    /* 统一简约 Ins 线框图标（stroke 1.5 / round） */
    var _I = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
    var ICON_BACK =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 5.5L9 12l6.5 6.5" ' + _I + '/></svg>';
    var ICON_EDIT =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5l4 4L8 20H4v-4L14.5 5.5z" ' + _I + '/><path d="M12.5 7.5l4 4" ' + _I + '/></svg>';
    var ICON_DELETE =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M8.5 7l.7 12.2a1.5 1.5 0 0 0 1.5 1.4h2.6a1.5 1.5 0 0 0 1.5-1.4L15.5 7" ' + _I + '/></svg>';
    var ICON_SET =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" ' + _I + '/><path d="M12 3v1.8M12 19.2V21M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M3 12h1.8M19.2 12H21M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3" ' + _I + '/></svg>';
    var ICON_ARCHIVE =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5V8z" ' + _I + '/><path d="M3 8l1.8-3.2A1.5 1.5 0 0 1 6.1 4h11.8a1.5 1.5 0 0 1 1.3.8L21 8M10 13h4" ' + _I + '/></svg>';
    var ICON_SEAL =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10A1.5 1.5 0 0 1 18.5 6v14.2l-6.5-3.4-6.5 3.4V6A1.5 1.5 0 0 1 7 4.5z" ' + _I + '/></svg>';
    var ICON_SWITCH =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h11M7 7l3-3M7 7l3 3M17 17H6M17 17l-3-3M17 17l-3 3" ' + _I + '/></svg>';
    var ICON_SEARCH =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" ' + _I + '/><path d="M16.2 16.2L21 21" ' + _I + '/></svg>';
    var ICON_MORE =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.35" fill="currentColor" stroke="none"/></svg>';
    var ICON_STYLE =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.35 4.05L17.5 9l-4.15 1.45L12 14.5l-1.35-4.05L6.5 9l4.15-1.45L12 3.5z" ' + _I + '/><path d="M18.2 14.2l.85 2.55L21.6 17.6l-2.55.85-.85 2.55-.85-2.55-2.55-.85 2.55-.85.85-2.55z" ' + _I + '/></svg>';
    var ICON_PLUS =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" ' + _I + '/></svg>';
    var ICON_EMOJI =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" ' + _I + '/><path d="M9 10.2h.01M15 10.2h.01M8.8 14.4c1.1 1.3 2.3 1.9 3.2 1.9s2.1-.6 3.2-1.9" ' + _I + '/></svg>';
    var ICON_UNDO =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8H4.5v4.5" ' + _I + '/><path d="M5 12.5a7 7 0 1 0 2.1-5" ' + _I + '/></svg>';
    var ICON_SEND =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 3.5L10.2 14.2" ' + _I + '/><path d="M21.5 3.5L14.8 21l-3.3-7.5L4 10.2 21.5 3.5z" ' + _I + '/></svg>';
    var ICON_RESEND =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 0 1 12.4-5.7" ' + _I + '/><path d="M19.5 12a7.5 7.5 0 0 1-12.4 5.7" ' + _I + '/><path d="M16.5 3.8V7h-3.2M7.5 20.2V17h3.2" ' + _I + '/></svg>';

    function $(id) {
        return document.getElementById(id);
    }

    function esc(t) {
        return String(t || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function escAttr(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    }

    function chatStore() {
        return global.miyaChatStore;
    }

    function apStore() {
        return global.MiyaAppointmentStore;
    }

    function apEngine() {
        return global.MiyaAppointmentEngine;
    }

    function dialog(opts) {
        if (global.miyaDialog) {
            if (opts.mode === 'prompt' && global.miyaDialog.prompt) return global.miyaDialog.prompt(opts);
            if (opts.mode === 'confirm' && global.miyaDialog.confirm) return global.miyaDialog.confirm(opts);
            if (global.miyaDialog.alert) return global.miyaDialog.alert(opts);
        }
        if (opts.mode === 'prompt') return Promise.resolve(prompt(opts.message || '', opts.defaultValue || ''));
        if (opts.mode === 'confirm') return Promise.resolve(confirm((opts.title || '') + '\n' + (opts.message || '')));
        return Promise.resolve(true);
    }

    function toast(msg) {
        var el = $('xw-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'xw-toast';
            el.className = 'xw-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('is-show');
        clearTimeout(el._t);
        el._t = setTimeout(function () {
            el.classList.remove('is-show');
        }, 2200);
    }

    function formatTs(ts) {
        try {
            return new Date(ts || Date.now()).toLocaleString('zh-CN', { hour12: false });
        } catch (e) {
            return '';
        }
    }

    function isJournalTheme() {
        var app = document.getElementById('miya-offline-app');
        return !!(app && app.classList.contains('xw-theme-korean'));
    }

    function activeContact() {
        var st = chatStore();
        var chat = st && ui.chatId && st.findChat(ui.chatId);
        return chat && st.findContact(chat.contactId);
    }

    /** 当前场次出演名单（含单人兜底） */
    function activeSessionCast() {
        if (!ui.chatId || !ui.sessionId) {
            if (ui.contactId) {
                return [{ contactId: ui.contactId, chatId: ui.chatId || '' }];
            }
            return [];
        }
        var sess = apStore().getSession(ui.chatId, ui.sessionId);
        if (!sess) {
            if (ui.contactId) {
                return [{ contactId: ui.contactId, chatId: ui.chatId || '' }];
            }
            return [];
        }
        var cast = Array.isArray(sess.cast) ? sess.cast : [];
        if (cast.length) return cast;
        var cid = String(sess.contactId || ui.contactId || '').trim();
        if (!cid) return [];
        return [{ contactId: cid, chatId: String(sess.chatId || ui.chatId || '') }];
    }

    function resolveCastContacts(cast) {
        var st = chatStore();
        if (!st) return [];
        var list = [];
        var seen = Object.create(null);
        (Array.isArray(cast) ? cast : []).forEach(function (row) {
            var cid = String((row && row.contactId) || '').trim();
            if (!cid || seen[cid]) return;
            var c = st.findContact(cid);
            if (!c) return;
            seen[cid] = true;
            list.push(c);
        });
        return list;
    }

    /** 导航栏用：最多 max 字，超出加省略号 */
    function ellipsizeChars(text, max) {
        var t = String(text || '').trim();
        var n = Math.max(0, Number(max) || 0);
        if (!n || t.length <= n) return t;
        return t.slice(0, n) + '…';
    }

    function castDisplayName(contacts, maxChars) {
        var joined = (Array.isArray(contacts) ? contacts : [])
            .map(function (c) {
                return characterRealName(c) || '';
            })
            .filter(Boolean)
            .join(' · ');
        if (maxChars == null) return joined;
        return ellipsizeChars(joined, maxChars);
    }

    /** 导航栏头像最多两个 */
    function castFacesHtml(contacts, imgClass, maxFaces) {
        var cls = imgClass || 'xw-cast-face';
        var all = Array.isArray(contacts) ? contacts : [];
        if (!all.length) return '';
        var limit = maxFaces == null ? all.length : Math.max(0, Number(maxFaces) || 0);
        var list = all.slice(0, limit);
        if (!list.length) return '';
        return (
            '<div class="xw-cast-faces" data-n="' +
            String(list.length) +
            '">' +
            list
                .map(function (c, i) {
                    return (
                        '<img class="' +
                        cls +
                        '" src="' +
                        escAttr(contactAvatar(c)) +
                        '" alt="" data-ap-cast-cid="' +
                        escAttr(c && c.id) +
                        '" style="--xw-fi:' +
                        String(i) +
                        '">'
                    );
                })
                .join('') +
            '</div>'
        );
    }

    /** 线下：优先用联系人绑定的用户面具，与引擎 / API 注入一致 */
    function resolveUserProfile() {
        var st = chatStore();
        if (!st) return null;
        var eng = global.MiyaAppointmentEngine;
        var chat = ui.chatId && st.findChat ? st.findChat(ui.chatId) : null;
        var contact = chat && st.findContact ? st.findContact(chat.contactId) : activeContact();
        if (eng && typeof eng.resolveProfileForContact === 'function') {
            return eng.resolveProfileForContact(st, contact, chat);
        }
        var profiles = st.getProfiles ? st.getProfiles() : [];
        var boundId = '';
        if (contact && contact.defaultProfileId) boundId = String(contact.defaultProfileId).trim();
        if (!boundId && chat && chat.profileId) boundId = String(chat.profileId).trim();
        if (boundId) {
            var found = profiles.find(function (p) {
                return p && p.id === boundId;
            });
            if (found) return found;
        }
        return st.getActiveProfile ? st.getActiveProfile() : null;
    }

    function profileAvatar(profile) {
        var st = chatStore();
        if (!profile) return contactAvatar({ name: '我' });
        if (profile.avatar) return profile.avatar;
        if (profile.avatarId && st && st.getCachedBlobUrl) {
            var cached = st.getCachedBlobUrl(profile.avatarId);
            if (cached) return cached;
        }
        return contactAvatar({ name: profile.name || '我' });
    }

    function userAvatar() {
        return profileAvatar(resolveUserProfile());
    }

    function isSvgAvatarSrc(src) {
        return /^data:image\/svg/i.test(String(src || '').trim());
    }

    function applyOfflineContactAvatar(contact, img, url) {
        if (!contact || !img || !url || isSvgAvatarSrc(url)) return;
        img.src = url;
        var scene = img.closest('.xw-scene');
        if (scene && img.classList.contains('xw-scene__face')) {
            scene.style.setProperty('--xw-face', 'url(' + url + ')');
        }
    }

    function hydrateOfflineContactAvatar(contact, img) {
        if (!contact || !img) return;
        var sync = contactAvatar(contact);
        if (sync && !isSvgAvatarSrc(sync)) {
            applyOfflineContactAvatar(contact, img, sync);
            return;
        }
        if (sync) img.src = sync;
        resolveOfflineContactAvatarAsync(contact).then(function (url) {
            applyOfflineContactAvatar(contact, img, url);
        });
    }

    function hydrateOfflineAvatars(root) {
        root = root || $('xw-root');
        if (!root) return;
        var st = chatStore();
        if (!st) return;

        root.querySelectorAll('[data-ap-toggle], [data-ap-contact]').forEach(function (node) {
            var cid =
                node.getAttribute('data-ap-toggle') ||
                node.getAttribute('data-ap-contact') ||
                '';
            var contact = cid && st.findContact ? st.findContact(cid) : null;
            var img =
                node.querySelector('.xw-cast-node__face') ||
                (node.tagName === 'IMG' ? node : null);
            hydrateOfflineContactAvatar(contact, img);
        });

        var contact = activeContact();
        root.querySelectorAll(
            '.xw-journal-bar__ava, .xw-scene__face, img.xw-chat__ava[data-ap-role-ava="1"]'
        ).forEach(function (img) {
            var cid = String(img.getAttribute('data-ap-cast-cid') || '').trim();
            var faceContact = cid && st.findContact ? st.findContact(cid) : contact;
            if (faceContact) hydrateOfflineContactAvatar(faceContact, img);
        });

        var profile = resolveUserProfile();
        if (profile && profile.avatarId && st.getAvatarUrl) {
            var cachedProfile = st.getCachedBlobUrl && st.getCachedBlobUrl(profile.avatarId);
            if (cachedProfile) {
                root.querySelectorAll('img.xw-chat__ava[data-ap-user-ava="1"]').forEach(function (img) {
                    img.src = cachedProfile;
                });
            } else {
                st.getAvatarUrl(profile.avatarId).then(function (url) {
                    if (!url) return;
                    root.querySelectorAll('img.xw-chat__ava[data-ap-user-ava="1"]').forEach(function (img) {
                        img.src = url;
                    });
                });
            }
        }
    }

    function userDisplayName() {
        var profile = resolveUserProfile();
        return String((profile && profile.name) || '我').trim();
    }

    function formatMsgTime(ts) {
        try {
            return new Date(ts || Date.now()).toLocaleString('zh-CN', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch (e) {
            return '';
        }
    }

    function formatDateDivider(ts) {
        try {
            var d = new Date(ts || Date.now());
            var date = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
            var time = d.toLocaleString('zh-CN', { hour: 'numeric', minute: '2-digit', hour12: true });
            return date + ' ' + time;
        } catch (e) {
            return '';
        }
    }

    function dayKeyFromTs(ts) {
        try {
            var d = new Date(ts || Date.now());
            return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
        } catch (e) {
            return '';
        }
    }

    function findContactsAppAvatar(contact) {
        if (!contact) return '';
        var cs = global.miyaContactsStore;
        if (!cs || typeof cs.findCharacter !== 'function') return '';
        var ids = [
            contact.chronicleId,
            contact.characterId,
            contact.id
        ];
        var i;
        for (i = 0; i < ids.length; i++) {
            var id = String(ids[i] || '').trim();
            if (!id) continue;
            try {
                var row = cs.findCharacter(id);
                var av = row && String(row.avatar || '').trim();
                if (av) return av;
            } catch (e) {}
        }
        return '';
    }

    function contactAvatar(contact) {
        /* 优先：联系人软件上传的头像 */
        var fromContacts = findContactsAppAvatar(contact);
        if (fromContacts) return fromContacts;

        var extras = global.miyaChatRoomExtras;
        if (extras && typeof extras.resolveContactAvatarUrl === 'function') {
            var url = extras.resolveContactAvatarUrl(contact);
            if (url && !isSvgAvatarSrc(url)) return url;
        }
        if (contact && contact.avatar && !isSvgAvatarSrc(contact.avatar)) {
            return contact.avatar;
        }
        var st = chatStore();
        var blobId = String((contact && contact.avatarBlobId) || '').trim();
        if (st && blobId && st.getCachedBlobUrl) {
            var cached = st.getCachedBlobUrl(blobId);
            if (cached) return cached;
        }
        var ch = Array.from(String((contact && contact.name) || '?').trim() || '?')[0];
        return (
            'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><circle cx="40" cy="40" r="40" fill="#f0e6d8"/>' +
                '<text x="40" y="48" text-anchor="middle" font-family="Georgia,serif" font-size="28" fill="#b88476">' +
                ch +
                '</text></svg>'
            )
        );
    }

    function resolveOfflineContactAvatarAsync(contact) {
        if (!contact) return Promise.resolve('');
        var sync = contactAvatar(contact);
        if (sync && !isSvgAvatarSrc(sync)) return Promise.resolve(sync);
        var extras = global.miyaChatRoomExtras;
        if (extras && typeof extras.resolveContactAvatarUrlAsync === 'function') {
            return extras.resolveContactAvatarUrlAsync(contact).then(function (url) {
                if (url && !isSvgAvatarSrc(url)) return url;
                return findContactsAppAvatar(contact) || sync || '';
            });
        }
        var st = chatStore();
        var blobId = String(contact.avatarBlobId || '').trim();
        if (st && blobId && st.getAvatarUrl) {
            return st.getAvatarUrl(blobId).then(function (url) {
                return url || findContactsAppAvatar(contact) || sync || '';
            });
        }
        return Promise.resolve(findContactsAppAvatar(contact) || sync || '');
    }

    function characterRealName(contact) {
        return String((contact && contact.name) || '未命名').trim();
    }

    /** 已发送或正在生成叙事（不含进入时的空白态） */
    function storyHasContent() {
        if (ui.view !== 'story' || !ui.chatId || !ui.sessionId) return false;
        if (ui.viewingArchive) return true;
        var msgs = apStore().getSessionMessages(ui.chatId, ui.sessionId);
        return msgs.length > 0 || ui.streamingLines.length > 0 || ui.status === 'coming';
    }

    function sessionHasUserMessages() {
        var msgs = apStore().getSessionMessages(ui.chatId, ui.sessionId);
        return msgs.some(function (m) {
            return m && m.role === 'user';
        });
    }

    function resendToolHtml(msgId) {
        return (
            '<button type="button" class="xw-block__tool" data-ap-msg-resend="' +
            esc(msgId) +
            '" title="重发" aria-label="重发">' +
            ICON_RESEND +
            '</button>'
        );
    }

    function openingBlockHtml(m, canEdit) {
        var body = String(m.content || '').trim();
        if (!body) return '';
        var tools = '';
        if (canEdit && !sessionHasUserMessages()) {
            tools =
                '<div class="xw-opening__tools">' +
                '<button type="button" class="xw-block__tool xw-block__tool--drop" data-ap-opening-del="' +
                esc(m.id) +
                '" title="移除" aria-label="移除">' +
                ICON_DELETE +
                '</button></div>';
        }
        return (
            '<div class="xw-opening" data-ap-opening-id="' +
            esc(m.id) +
            '">' +
            '<span class="xw-opening__tag">开场白</span>' +
            '<div class="xw-opening__body">' +
            esc(body).replace(/\n/g, '<br>') +
            '</div>' +
            tools +
            '</div>'
        );
    }

    function renderOpeningPicker() {
        var contact = activeContact();
        var name = characterRealName(contact);
        var presets =
            contact && apStore().getContactOpeningPresets
                ? apStore().getContactOpeningPresets(contact.id)
                : [];
        var listHtml = presets.length
            ? '<div class="xw-opening-pick__list">' +
              presets
                  .map(function (p) {
                      var preview = String(p.content || '').replace(/\s+/g, ' ').trim();
                      if (preview.length > 56) preview = preview.slice(0, 56) + '…';
                      return (
                          '<button type="button" class="xw-opening-pick__item" data-ap-apply-opening="' +
                          esc(p.id) +
                          '">' +
                          '<strong class="xw-opening-pick__name">' +
                          esc(p.name) +
                          '</strong>' +
                          '<span class="xw-opening-pick__preview">' +
                          esc(preview) +
                          '</span></button>'
                      );
                  })
                  .join('') +
              '</div>'
            : '';
        return (
            '<div class="xw-opening-pick">' +
            '<p class="xw-opening-pick__kicker">与 ' +
            esc(name) +
            ' · 新场景</p>' +
            '<h2 class="xw-opening-pick__title">选择开场白</h2>' +
            '<p class="xw-opening-pick__hint">系统注入的首条上下文，非任一方气泡；可在调参里添加预设，也可直接发送。</p>' +
            listHtml +
            '</div>'
        );
    }

    function applyOpeningPreset(presetId) {
        var contact = activeContact();
        if (!contact) return;
        var presets = apStore().getContactOpeningPresets(contact.id);
        var preset = presets.find(function (p) {
            return p.id === presetId;
        });
        if (!preset) {
            toast('预设不存在');
            return;
        }
        if (sessionHasUserMessages()) {
            toast('已有对话，不能再改开场白');
            return;
        }
        var row = apStore().setSessionOpeningMessage(ui.chatId, ui.sessionId, {
            content: preset.content,
            openingPresetId: preset.id
        });
        if (!row) {
            toast('开场白未能写入');
            return;
        }
        var eng = apEngine();
        if (!eng || eng.isBusy(ui.chatId, ui.sessionId)) {
            toast('等上一镜结束再说');
            render();
            return;
        }
        if (typeof persistAppointmentPresetFromSheet === 'function') {
            try {
                persistAppointmentPresetFromSheet();
            } catch (e) {}
        }
        render();
        var input = $('xw-writer-input');
        if (input) input.disabled = true;
        var sendBtn = $('xw-writer-go');
        if (sendBtn) sendBtn.disabled = true;
        pinScrollToBottom();
        scrollStoryToEnd(true);
        runStream(
            Promise.resolve()
                .then(function () {
                    return eng.regenerateAppointment(ui.chatId, ui.sessionId, streamHandlers());
                })
                .finally(function () {
                    if (input) {
                        input.disabled = false;
                        input.focus();
                    }
                    if (sendBtn) sendBtn.disabled = false;
                })
        );
    }

    function removeSessionOpening(openingId) {
        if (sessionHasUserMessages()) {
            toast('已有对话，不能移除开场白');
            return;
        }
        apStore().deleteMessage(ui.chatId, ui.sessionId, openingId);
        toast('已移除开场白');
        render();
    }

    function renderSheetOpeningPresetList(contactId) {
        var presets = apStore().getContactOpeningPresets(contactId);
        if (!presets.length) {
            return '<p class="xw-opening-sheet__empty">暂无预设</p>';
        }
        return presets
            .map(function (p) {
                var preview = String(p.content || '').replace(/\s+/g, ' ').trim();
                if (preview.length > 64) preview = preview.slice(0, 64) + '…';
                return (
                    '<div class="xw-opening-sheet__row" data-ap-opening-preset="' +
                    esc(p.id) +
                    '">' +
                    '<div class="xw-opening-sheet__copy">' +
                    '<strong>' +
                    esc(p.name) +
                    '</strong>' +
                    '<span>' +
                    esc(preview) +
                    '</span></div>' +
                    '<button type="button" class="xw-opening-sheet__del" data-ap-opening-preset-del="' +
                    esc(p.id) +
                    '" aria-label="删除">×</button></div>'
                );
            })
            .join('');
    }

    function ensureChatForContact(contactId) {
        var st = chatStore();
        if (!st) return null;
        var contact = st.findContact(contactId);
        if (!contact) return null;
        var existing = st.findChatByContact(contactId, contact.defaultProfileId);
        if (existing) return existing;
        existing = st.findChatByContact(contactId, '');
        if (existing) return existing;
        var profile = resolveUserProfile();
        var created = st.createChat({
            contactId: contactId,
            profileId: contact.defaultProfileId || (profile && profile.id),
            type: 'private'
        });
        if (created && typeof created.then === 'function') return null;
        return created;
    }

    function storyEditDialogOpts(title, message, defaultValue) {
        return {
            mode: 'prompt',
            multiline: true,
            size: 'large',
            rows: 14,
            title: title,
            message: message,
            defaultValue: defaultValue
        };
    }

    function renderBackdrop() {
        if (isJournalTheme()) return renderJournalBackdrop();
        return (
            '<div class="xw-bg" aria-hidden="true">' +
            '<span class="xw-bg__mesh"></span>' +
            '<span class="xw-bg__dots"></span></div>'
        );
    }

    function renderJournalBackdrop() {
        return '<div class="xw-bg xw-bg--journal" aria-hidden="true"></div>';
    }

    function renderExitBtn() {
        if (isJournalTheme()) return '';
        return '<button type="button" class="xw-exit" id="xw-exit" aria-label="离开现场">收起</button>';
    }

    function renderDockBeautifyBtn() {
        return (
            '<button type="button" class="xw-dock__btn" id="xw-dock-beautify" title="现场样式">' +
            '<span class="xw-dock__glyph">式</span><span class="xw-dock__lbl">样式</span></button>'
        );
    }

    function renderDockExpandBtn() {
        return (
            '<button type="button" class="xw-dock-expand" id="xw-dock-expand" title="展开工具栏" aria-label="展开工具栏">' +
            ICON_PLUS +
            '</button>'
        );
    }

    function syncDockCollapsedUi() {
        var app = document.getElementById('miya-offline-app');
        var collapsed = !isJournalTheme() && !!ui.dockCollapsed;
        if (app) app.classList.toggle('xw-dock-collapsed', collapsed);
        var dock = document.querySelector('#xw-root .xw-dock');
        var expand = $('xw-dock-expand');
        if (dock) {
            dock.classList.toggle('is-collapsed', collapsed);
            dock.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
        }
        if (expand) {
            expand.hidden = !collapsed;
            expand.setAttribute('aria-hidden', collapsed ? 'false' : 'true');
        }
    }

    function setDockCollapsed(collapsed) {
        ui.dockCollapsed = !!collapsed;
        syncDockCollapsedUi();
    }

    function renderDock() {
        if (isJournalTheme()) return '';
        var navInner = '';
        var aria = '现场工具';
        if (ui.view === 'pick') {
            navInner = renderDockBeautifyBtn();
        } else if (ui.view === 'history') {
            aria = '卷宗工具';
            navInner =
                renderDockBeautifyBtn() +
                '<button type="button" class="xw-dock__btn" id="xw-dock-vault" title="回场景">' +
                '<span class="xw-dock__glyph">场</span><span class="xw-dock__lbl">回去</span></button>';
        } else if (ui.view === 'story' && ui.viewingArchive) {
            aria = '卷宗工具';
            navInner =
                renderDockBeautifyBtn() +
                '<button type="button" class="xw-dock__btn" id="xw-dock-vault" title="回卷宗列表">' +
                '<span class="xw-dock__glyph">卷</span><span class="xw-dock__lbl">回去</span></button>';
        } else if (ui.view === 'story') {
            aria = '场景工具';
            navInner =
                renderDockBeautifyBtn() +
                '<button type="button" class="xw-dock__btn" id="xw-dock-prefs" title="现场参数">' +
                '<span class="xw-dock__glyph">参</span><span class="xw-dock__lbl">调参</span></button>' +
                '<button type="button" class="xw-dock__btn" id="xw-dock-seal" title="封存本场景">' +
                '<span class="xw-dock__glyph">封</span><span class="xw-dock__lbl">封存</span></button>' +
                '<button type="button" class="xw-dock__btn" id="xw-dock-vault" title="往日场景">' +
                '<span class="xw-dock__glyph">档</span><span class="xw-dock__lbl">卷宗</span></button>';
        } else {
            return '';
        }
        return (
            renderDockExpandBtn() +
            '<nav class="xw-dock" aria-label="' +
            aria +
            '" title="点击空白处收起">' +
            navInner +
            '</nav>'
        );
    }

    function renderJournalChrome() {
        var castContacts = resolveCastContacts(activeSessionCast());
        if (!castContacts.length) {
            var one = activeContact();
            if (one) castContacts = [one];
        }
        var showWho = castContacts.length && (ui.view === 'story' || ui.view === 'history');
        var statusLine = '在线';
        if (ui.view === 'story' && ui.viewingArchive) {
            var archSess = apStore().getSession(ui.chatId, ui.sessionId);
            statusLine = String((archSess && archSess.title) || '').trim() || '未命名场景';
        } else if (ui.view === 'history') {
            statusLine = '往日卷宗';
        } else if (castContacts.length > 1) {
            statusLine = String(castContacts.length) + ' 人同场';
        }
        var whoName = castDisplayName(castContacts, 6);
        var whoHtml = showWho
            ? (
                '<div class="xw-journal-bar__who">' +
                castFacesHtml(castContacts, 'xw-journal-bar__ava', 2) +
                '<div class="xw-journal-bar__id">' +
                '<strong class="xw-journal-bar__name" title="' +
                escAttr(castDisplayName(castContacts)) +
                '">' +
                esc(whoName) +
                (castContacts.length === 1 && whoName.indexOf('…') < 0 ? '.' : '') +
                '</strong>' +
                '<span class="xw-journal-bar__status"><i aria-hidden="true"></i>' + esc(statusLine) + '</span></div></div>'
            )
            : '<div class="xw-journal-bar__brand">手帐</div>';

        var toolHtml = '';
        if (ui.view === 'story' || ui.view === 'history') {
            toolHtml +=
                '<button type="button" class="xw-journal-bar__ico" id="xw-dock-vault" title="卷宗" aria-label="卷宗">' +
                ICON_ARCHIVE + '</button>';
        }
        if (ui.view === 'story' && !ui.viewingArchive) {
            toolHtml +=
                '<button type="button" class="xw-journal-bar__ico" id="xw-dock-seal" title="封存" aria-label="封存">' +
                ICON_SEAL + '</button>';
        }
        toolHtml +=
            '<button type="button" class="xw-journal-bar__ico" id="xw-dock-beautify" title="样式" aria-label="样式">' +
            ICON_STYLE + '</button>';

        return (
            '<header class="xw-journal-bar">' +
            '<button type="button" class="xw-journal-bar__back" id="xw-exit" aria-label="离开">' +
            ICON_BACK + '</button>' +
            whoHtml +
            '<div class="xw-journal-bar__tools">' + toolHtml + '</div></header>'
        );
    }

    function renderPick() {
        var st = chatStore();
        if (!st) return '<p class="xw-empty">聊天数据未就绪，请先打开聊天应用。</p>';
        var contacts = st.getContacts('all');
        if (!contacts.length) {
            return '<p class="xw-empty">还没有可登场的人。<br>请先在聊天里添加联系人。</p>';
        }
        var selected = Array.isArray(ui.pickSelected) ? ui.pickSelected : [];
        var cast = contacts
            .map(function (c, i) {
                var chat = ensureChatForContact(c.id);
                if (!chat) return '';
                var on = selected.indexOf(String(c.id)) >= 0;
                return (
                    '<button type="button" class="xw-cast-node' +
                    (on ? ' is-on' : '') +
                    '" data-ap-toggle="' +
                    esc(c.id) +
                    '" data-ap-contact="' +
                    esc(c.id) +
                    '" data-ap-chat="' +
                    esc(chat.id) +
                    '" style="--xw-i:' +
                    String(i) +
                    '">' +
                    '<span class="xw-cast-node__ring" aria-hidden="true"></span>' +
                    '<img class="xw-cast-node__face" src="' +
                    esc(contactAvatar(c)) +
                    '" alt="">' +
                    '<span class="xw-cast-node__name">' +
                    esc(characterRealName(c)) +
                    '</span></button>'
                );
            })
            .join('');
        var n = selected.length;
        return (
            '<div class="xw-hub' +
            (isJournalTheme() ? ' xw-hub--journal' : '') +
            '">' +
            (isJournalTheme()
                ? ''
                : '<p class="xw-hub__brand">miya · 现场</p>' +
                  '<h1 class="xw-hub__title">今天和谁见面</h1>') +
            '<div class="xw-cast" role="list">' +
            cast +
            '</div>' +
            '<div class="xw-hub__actions">' +
            '<button type="button" class="xw-hub__start" id="xw-pick-start"' +
            (n ? '' : ' disabled') +
            '>' +
            (n > 1 ? '开始线下 · ' + String(n) + ' 人' : n === 1 ? '开始线下' : '请选择角色') +
            '</button>' +
            '<p class="xw-hub__tip">可多选 · 点选后点开始</p></div>' +
            '<p class="xw-hub__foot">' +
            (isJournalTheme() ? '选中即开新对话 · 与线上记忆同步' : '开场后与线上记忆同步') +
            '</p></div>'
        );
    }

    function renderHistoryRecoverBanner() {
        var st = apStore();
        if (!st || typeof st.previewChatMirrorRecovery !== 'function') return '';
        var preview = st.previewChatMirrorRecovery();
        if (!preview || (!preview.sessions && !preview.messages)) return '';
        return (
            '<div class="xw-vault-recover">' +
            '<p class="xw-vault-recover__hint">聊天里仍存着 ' +
            String(preview.messages || 0) +
            ' 条线下镜像，可重建约 ' +
            String(preview.sessions || 0) +
            ' 卷封存记录（即线上 AI 记得的那些剧情）。</p>' +
            '<button type="button" class="xw-btn xw-btn--solid" data-ap-recover-mirrors>从线上记忆恢复</button></div>'
        );
    }

    function recoverFromOnlineMemory() {
        var st = apStore();
        if (!st || typeof st.restoreFromChatMirrors !== 'function') {
            toast('恢复模块未加载');
            return Promise.resolve();
        }
        toast('正在从线上记忆恢复…');
        return st
            .restoreFromChatMirrors()
            .then(function (res) {
                if (res && res.ok) {
                    toast(
                        '已恢复 ' +
                            String(res.sessions || 0) +
                            ' 卷 · 共 ' +
                            String(res.messages || 0) +
                            ' 条消息'
                    );
                    render();
                    return;
                }
                if (res && res.reason === 'no_mirror') {
                    toast('聊天里没有找到可恢复的线下镜像');
                    return;
                }
                if (res && res.reason === 'already_up_to_date') return;
                toast('封存记录已是最新');
            })
            .catch(function () {
                toast('恢复失败，请稍后再试');
            });
    }

    function renderHistory() {
        var st0 = chatStore();
        var chat0 = st0 && st0.findChat(ui.chatId);
        var contact0 = chat0 && st0.findContact(chat0.contactId);
        var castContacts = resolveCastContacts(activeSessionCast());
        if (!castContacts.length && contact0) castContacts = [contact0];
        var who = castDisplayName(castContacts) || characterRealName(contact0);
        var sessions = apStore().getSessions(ui.chatId);
        var recoverBanner = renderHistoryRecoverBanner();
        if (!sessions.length) {
            return (
                '<p class="xw-empty">「' +
                esc(who) +
                '」还没有保存过的场景。</p>' +
                recoverBanner
            );
        }
        return (
            '<div class="xw-vault">' +
            recoverBanner +
            '<header class="xw-vault__head">' +
            '<h2 class="xw-vault__title">' + esc(who) + ' · 往日卷宗</h2></header>' +
            '<div class="xw-vault__grid">' +
            sessions
                .map(function (s, i) {
                    var n = (s.messages || []).filter(function (m) {
                        return m && !m.deleted;
                    }).length;
                    var sumN = (s.summaryList || []).length;
                    var castN = Array.isArray(s.cast) ? s.cast.length : 0;
                    return (
                        '<article class="xw-vault-card" style="--xw-i:' + String(i) + '">' +
                        '<button type="button" class="xw-vault-card__open" data-ap-view-session="' + esc(s.id) + '">' +
                        '<time class="xw-vault-card__when">' + esc(formatTs(s.createdAt)) + '</time>' +
                        '<strong class="xw-vault-card__name">' + esc(s.title || '未命名场景') + '</strong>' +
                        '<span class="xw-vault-card__stat">' +
                        (castN > 1 ? castN + ' 人 · ' : '') +
                        n + ' 镜' +
                        (sumN ? ' · ' + sumN + ' 份纪要' : '') +
                        (!s.closedAt && n ? ' · 未封存' : '') +
                        '</span></button>' +
                        '<button type="button" class="xw-vault-card__drop" data-ap-del-session="' + esc(s.id) +
                        '" aria-label="删除此卷">删</button></article>'
                    );
                })
                .join('') +
            '</div></div>'
        );
    }

    function parseThinkingPayload(text) {
        var eng = apEngine();
        if (eng && typeof eng.parseThinkingPayload === 'function') {
            return eng.parseThinkingPayload(text);
        }
        return { thinking: '', content: String(text || '').trim() };
    }

    function resolveShowThinking() {
        if (!ui.chatId) return true;
        var st = chatStore();
        if (!st) return true;
        var chat = st.findChat(ui.chatId);
        if (!chat) return true;
        var preset = apStore().resolvePresetForContact(chat.contactId);
        return !preset || preset.showThinking !== false;
    }

    function resolveTextDecor() {
        if (!ui.chatId) return true;
        var st = chatStore();
        if (!st) return true;
        var chat = st.findChat(ui.chatId);
        if (!chat) return true;
        var preset = apStore().resolvePresetForContact(chat.contactId);
        return !preset || preset.textDecor !== false;
    }

    function thinkingToggleHtml(thinking, extraAttrs) {
        if (!resolveShowThinking()) return '';
        var t = String(thinking || '').trim();
        if (!t) return '';
        return (
            '<details class="xw-think"' +
            (extraAttrs ? ' ' + extraAttrs : '') +
            '>' +
            '<summary class="xw-think__toggle">展开推理过程</summary>' +
            '<div class="xw-think__body">' +
            esc(t).replace(/\n/g, '<br>') +
            '</div></details>'
        );
    }

    function decodeApHtmlSrcdocB64(encoded) {
        try {
            return decodeURIComponent(escape(atob(String(encoded || ''))));
        } catch (e) {
            return '';
        }
    }

    function encodeApHtmlSrcdocB64(text) {
        try {
            return btoa(unescape(encodeURIComponent(String(text || ''))));
        } catch (e) {
            return '';
        }
    }

    function hydrateAppointmentHtmlPanels(root) {
        if (!root || !root.querySelectorAll) return;
        var frames = root.querySelectorAll('iframe[data-ap-html-iframe="1"]');
        var i;
        for (i = 0; i < frames.length; i++) {
            var frame = frames[i];
            if (!frame || frame.getAttribute('data-ap-html-hydrated') === '1') continue;
            var srcdoc = decodeApHtmlSrcdocB64(frame.getAttribute('data-ap-html-srcdoc-b64'));
            if (!srcdoc) continue;
            try {
                var prev = frame.getAttribute('data-ap-html-blob');
                if (prev) {
                    try {
                        URL.revokeObjectURL(prev);
                    } catch (e0) {}
                }
                var blob = new Blob([srcdoc], { type: 'text/html;charset=utf-8' });
                var burl = URL.createObjectURL(blob);
                frame.src = burl;
                frame.setAttribute('data-ap-html-blob', burl);
                frame.setAttribute('data-ap-html-hydrated', '1');
            } catch (e) {}
        }
    }

    function buildHtmlPanelHtml(raw) {
        var htmlApi = global.MiyaChatHtml;
        var src = String(raw || '').trim();
        if (!src) return '';
        var hp =
            htmlApi && typeof htmlApi.buildHtmlPayloadFromText === 'function'
                ? htmlApi.buildHtmlPayloadFromText(src, true)
                : null;
        if (hp && hp.useIframe && hp.iframeSrcdoc) {
            return (
                '<div class="xw-embed is-interactive" data-ap-html-panel="1">' +
                '<div class="xw-embed__bar">' +
                '<button type="button" class="xw-embed__zoom" data-ap-html-fs="1">放大页面</button>' +
                '</div>' +
                '<iframe class="xw-embed__frame" data-ap-html-iframe="1" data-ap-html-srcdoc-b64="' +
                encodeApHtmlSrcdocB64(hp.iframeSrcdoc) +
                '" sandbox="allow-scripts allow-modals allow-same-origin" referrerpolicy="no-referrer" title="嵌入页面"></iframe>' +
                '</div>'
            );
        }
        var safe = hp && hp.html ? hp.html : esc(src);
        return (
            '<div class="xw-embed" data-ap-html-panel="1">' +
            '<div class="xw-embed__body">' +
            safe +
            '</div></div>'
        );
    }

    function splitStoryParagraphs(text) {
        var body = String(parseThinkingPayload(text).content || '').trim();
        var eng = apEngine();
        if (eng && typeof eng.splitDisplayParagraphs === 'function') {
            var parts = eng.splitDisplayParagraphs(body);
            if (parts.length) return parts;
        }
        var t = body;
        if (!t) return [];
        var blocks = t.split(/\n\s*\n+/).map(function (s) {
            return String(s || '').trim();
        }).filter(Boolean);
        if (blocks.length <= 1 && /\n/.test(t)) {
            var lines = t
                .split(/\n/)
                .map(function (s) {
                    return String(s || '').trim();
                })
                .filter(Boolean);
            if (lines.length > 1) return lines;
        }
        return blocks.length ? blocks : [t];
    }

    function wrapSymbolDecor(html) {
        var decor = global.MiyaOfflineTextDecor;
        if (decor && typeof decor.wrapGlyphs === 'function') return decor.wrapGlyphs(html);
        return String(html || '').replace(
            /([†✞✧*⊹⌂♡✦◇◆☆★])/g,
            '<span class="xw-sym xw-sym--glyph">$1</span>'
        );
    }

    function plainParagraphHtml(text, role) {
        var t = String(text || '').trim();
        if (!t) return '';
        var cls = role === 'user' ? 'xw-txt--mine' : 'xw-txt--theirs';
        return '<p class="xw-txt ' + cls + '">' + esc(t).replace(/\n/g, '<br>') + '</p>';
    }

    function decorateParagraph(text, role) {
        if (!resolveTextDecor()) return plainParagraphHtml(text, role);
        var decor = global.MiyaOfflineTextDecor;
        if (decor && typeof decor.decorateParagraph === 'function') {
            return decor.decorateParagraph(text, role);
        }
        var t = String(text || '').trim();
        if (!t) return '';
        if (/^†|✞|✧|THE SEASON/i.test(t) || (t.length < 48 && /[†✞✧⊹]/.test(t) && !/\*[^*]+\*/.test(t))) {
            return '<p class="xw-txt xw-txt--aside">' + wrapSymbolDecor(esc(t)) + '</p>';
        }
        if (/未接來電|未接来电|⌂|♡/.test(t)) {
            return (
                '<p class="xw-txt xw-txt--callout">' +
                '<span class="xw-sym xw-sym--quote">「</span> ' +
                wrapSymbolDecor(esc(t)) +
                ' <span class="xw-sym xw-sym--quote">」</span></p>'
            );
        }
        var cls = role === 'user' ? 'xw-txt--mine' : 'xw-txt--theirs';
        return '<p class="xw-txt ' + cls + '">' + esc(t).replace(/\n/g, '<br>') + '</p>';
    }

    function journalBodyHtml(m) {
        if (m.renderAsHtml) return buildHtmlPanelHtml(m.htmlRaw || m.content);
        var paras = splitStoryParagraphs(m.content);
        if (!paras.length) return '';
        if (!resolveTextDecor()) {
            var plain = paras
                .map(function (para) {
                    return esc(String(para || '').trim()).replace(/\n/g, '<br>');
                })
                .filter(Boolean)
                .join('<br><br>');
            return plain ? '<div class="xw-chat__text">' + plain + '</div>' : '';
        }
        var decor = global.MiyaOfflineTextDecor;
        if (decor && typeof decor.decorateJournalBody === 'function') {
            return decor.decorateJournalBody(paras);
        }
        var html = paras
            .map(function (para) {
                return esc(String(para || '').trim()).replace(/\n/g, '<br>');
            })
            .filter(Boolean)
            .join('<br><br>');
        return html ? '<div class="xw-chat__text">' + html + '</div>' : '';
    }

    function journalMessageBlockHtml(m, canEdit, thinkingHtml) {
        if (m.role === 'system' && m.type === 'opening') {
            return openingBlockHtml(m, canEdit);
        }
        var isUser = m.role === 'user';
        var contact = activeContact();
        var avaUrl = isUser ? userAvatar() : contactAvatar(contact);
        var ava = escAttr(avaUrl);
        var avaAttrs = isUser ? ' data-ap-user-ava="1"' : ' data-ap-role-ava="1"';
        var sign = esc(isUser ? userDisplayName() : characterRealName(contact)) + '.';
        var time = esc(formatMsgTime(m.createdAt || m.timestamp || Date.now()));
        var roleCls = isUser ? 'xw-chat--mine' : 'xw-chat--theirs';
        var body = journalBodyHtml(m);
        if (!body && !thinkingHtml) return '';
        var tools = '';
        if (canEdit) {
            tools =
                '<div class="xw-chat__tools">' +
                '<button type="button" class="xw-block__tool" data-ap-msg-edit="' +
                esc(m.id) +
                '" title="改" aria-label="改">' +
                ICON_EDIT +
                '</button>' +
                resendToolHtml(m.id) +
                '<button type="button" class="xw-block__tool xw-block__tool--drop" data-ap-msg-del="' +
                esc(m.id) +
                '" title="删除" aria-label="删除">' +
                ICON_DELETE +
                '</button></div>';
        }
        var deco =
            !isUser
                ? '<span class="xw-chat__deco" aria-hidden="true">' +
                  '<span class="xw-chat__deco-branch"></span></span>'
                : '';
        var bubbleInner =
            deco +
            (isUser
                ? '<span class="xw-chat__sign">' + sign + '</span>'
                : '<span class="xw-chat__quote" aria-hidden="true">“</span>') +
            (thinkingHtml ? '<div class="xw-chat__think">' + thinkingHtml + '</div>' : '') +
            body +
            '<time class="xw-chat__time">' +
            time +
            (isUser ? '<span class="xw-chat__ticks" aria-hidden="true">✓✓</span>' : '') +
            '</time>' +
            tools;
        var attrs =
            (canEdit ? ' data-ap-msg-id="' + esc(m.id) + '" data-ap-msg-role="' + esc(m.role) + '"' : '') +
            (canEdit ? ' tabindex="0"' : '');
        if (isUser) {
            return (
                '<div class="xw-chat ' + roleCls + '"' + attrs + '>' +
                '<div class="xw-chat__frame">' +
                '<div class="xw-chat__bubble">' + bubbleInner + '</div>' +
                '<img class="xw-chat__ava"' + avaAttrs + ' src="' + ava + '" alt="">' +
                '</div></div>'
            );
        }
        return (
            '<div class="xw-chat ' + roleCls + '"' + attrs + '>' +
            '<div class="xw-chat__frame">' +
            '<img class="xw-chat__ava"' + avaAttrs + ' src="' + ava + '" alt="">' +
            '<div class="xw-chat__bubble">' + bubbleInner + '</div>' +
            '</div></div>'
        );
    }

    function messageBlockHtml(m, canEdit) {
        if (m.role === 'system' && m.type === 'opening') {
            return openingBlockHtml(m, canEdit);
        }
        var thinkingHtml = m.role === 'assistant' ? thinkingToggleHtml(m.thinking) : '';
        if (isJournalTheme()) {
            return journalMessageBlockHtml(m, canEdit, thinkingHtml);
        }
        var lines = '';
        if (m.renderAsHtml) {
            lines = buildHtmlPanelHtml(m.htmlRaw || m.content);
        } else {
            lines = splitStoryParagraphs(m.content)
                .map(function (para) {
                    return decorateParagraph(para, m.role);
                })
                .filter(Boolean)
                .join('');
        }
        if (!lines) return '';
        if (!canEdit) {
            return (
                '<div class="xw-block xw-block--locked">' +
                thinkingHtml +
                lines +
                '</div>'
            );
        }
        return (
            '<div class="xw-block" data-ap-msg-id="' +
            esc(m.id) +
            '" data-ap-msg-role="' +
            esc(m.role) +
            '">' +
            thinkingHtml +
            '<div class="xw-block__lines">' +
            lines +
            '</div>' +
            '<div class="xw-block__tools">' +
            '<button type="button" class="xw-block__tool" data-ap-msg-edit="' +
            esc(m.id) +
            '" title="改" aria-label="改">' +
            ICON_EDIT +
            '</button>' +
            resendToolHtml(m.id) +
            '<button type="button" class="xw-block__tool xw-block__tool--drop" data-ap-msg-del="' +
            esc(m.id) +
            '" title="删除" aria-label="删除">' +
            ICON_DELETE +
            '</button></div></div>'
        );
    }

    function renderSummaryCard(row) {
        var body = String((row && row.content) || '').trim();
        if (!body) return '';
        return (
            '<article class="xw-note" data-ap-sum-id="' + esc(row.id) + '">' +
            '<header class="xw-note__head">' +
            '<span class="xw-note__tag">场次纪要</span>' +
            '<span class="xw-note__range">#' + esc(String(row.startIndex || '?')) +
            '–' + esc(String(row.endIndex || '?')) + '</span>' +
            '<time class="xw-note__time">' + esc(formatTs(row.createdAt)) + '</time>' +
            '</header>' +
            '<p class="xw-note__body">' + esc(body).replace(/\n/g, '<br>') + '</p>' +
            '</article>'
        );
    }

    function renderStoryLines(messages, summaries, extraStreaming, canEdit) {
        var live = (messages || []).filter(function (m) {
            return m && !m.deleted && String(m.content || '').trim();
        });
        var html = '';
        if (live.length && !isJournalTheme()) {
            html += '<div class="xw-script__mark" aria-hidden="true"><span>正片</span></div>';
        }
        var sums = (summaries || []).slice().sort(function (a, b) {
            return (a.endIndex || 0) - (b.endIndex || 0);
        });
        var sumPtr = 0;
        var lastDay = '';

        (messages || []).forEach(function (m, i) {
            if (!m || m.deleted) return;
            if (isJournalTheme()) {
                var dayKey = dayKeyFromTs(m.createdAt || m.timestamp || Date.now());
                if (dayKey && dayKey !== lastDay) {
                    html +=
                        '<div class="xw-chat-date"><span>' +
                        esc(formatDateDivider(m.createdAt || m.timestamp || Date.now())) +
                        '</span></div>';
                    lastDay = dayKey;
                }
            }
            var block = messageBlockHtml(m, canEdit);
            if (block) html += block;
            var idx = i + 1;
            while (sumPtr < sums.length && (sums[sumPtr].endIndex || 0) === idx) {
                html += renderSummaryCard(sums[sumPtr]);
                sumPtr += 1;
            }
        });
        while (sumPtr < sums.length) {
            html += renderSummaryCard(sums[sumPtr]);
            sumPtr += 1;
        }

        return html;
    }

    function hasVisibleStreamBody() {
        return !!streamingVisibleText().trim();
    }

    function shouldShowStreamWait() {
        if (ui.status !== 'coming') return false;
        if (hasVisibleStreamBody()) return false;
        if (resolveShowThinking() && streamingThinkingText()) return false;
        return true;
    }

    function renderComingHtml() {
        var label =
            String(ui.streamingRaw || '').trim() && !hasVisibleStreamBody() ? '构思中' : '书写中';
        return (
            '<div class="xw-wait"><span class="xw-wait__label">' +
            label +
            '</span>' +
            '<span class="xw-wait__dots"><i></i><i></i><i></i></span></div>'
        );
    }

    function patchStreamWait(mount) {
        var wait = mount.querySelector('.xw-wait');
        if (shouldShowStreamWait()) {
            if (!wait) {
                mount.insertAdjacentHTML('beforeend', renderComingHtml());
            } else {
                var label = wait.querySelector('.xw-wait__label');
                if (label) {
                    label.textContent =
                        String(ui.streamingRaw || '').trim() && !hasVisibleStreamBody()
                            ? '构思中'
                            : '书写中';
                }
            }
        } else if (wait) {
            wait.remove();
        }
    }

    function formatStreamParaHtml(para) {
        var htmlApi = global.MiyaChatHtml;
        if (htmlApi && typeof htmlApi.looksLikeHtmlReply === 'function' && htmlApi.looksLikeHtmlReply(para)) {
            return buildHtmlPanelHtml(para);
        }
        return esc(para).replace(/\n/g, '<br>');
    }

    function computeStableStoryKey(msgs, sums) {
        var m = msgs || [];
        var s = sums || [];
        var last = m.length ? m[m.length - 1] : null;
        var lastSum = s.length ? s[s.length - 1] : null;
        return (
            String(m.length) +
            ':' +
            (last
                ? String(last.id || '') +
                  '|' +
                  String(last.editedAt || '') +
                  '|' +
                  String(last.content || '').length
                : '') +
            '::' +
            String(s.length) +
            ':' +
            (lastSum
                ? String(lastSum.id || '') + '|' + String(lastSum.content || '').length
                : '') +
            ':td' +
            (resolveTextDecor() ? '1' : '0')
        );
    }

    function getStoryBodyEl() {
        var body = $('mol-story-body');
        if (!body || body.classList.contains('xw-script-host')) return null;
        return body;
    }

    function ensureStreamMount(body) {
        var mount = body.querySelector('[data-ap-stream-mount]');
        if (mount) return mount;
        mount = document.createElement('div');
        mount.className = 'xw-stream-mount';
        mount.setAttribute('data-ap-stream-mount', '');
        mount.setAttribute('aria-live', 'polite');
        mount.setAttribute('aria-atomic', 'false');
        body.appendChild(mount);
        return mount;
    }

    function clearStreamMount(body) {
        if (!body) body = getStoryBodyEl();
        if (!body) return;
        var mount = body.querySelector('[data-ap-stream-mount]');
        if (mount) mount.remove();
        streamUi.paraCount = 0;
    }

    function streamingTargetText() {
        return String(ui.streamingRaw || '');
    }

    function streamingDisplayTarget() {
        var body = String(parseThinkingPayload(streamingTargetText()).content || '');
        var statusApi = global.MiyaOfflineStatus;
        if (statusApi && typeof statusApi.stripStatusFromText === 'function') {
            body = statusApi.stripStatusFromText(body);
        }
        return body;
    }

    function streamingThinkingText() {
        if (!resolveShowThinking()) return '';
        return String(parseThinkingPayload(streamingTargetText()).thinking || '').trim();
    }

    function streamingVisibleText() {
        var raw = streamingDisplayTarget();
        var len = clampInt(ui.streamingRevealLen, 0, raw.length, 0);
        return raw.slice(0, len);
    }

    function resolveStreamingParagraphs() {
        var shown = streamingVisibleText().trim();
        if (!shown) return [];
        var htmlApi = global.MiyaChatHtml;
        if (
            htmlApi &&
            (htmlApi.looksLikeHtmlReply(shown) || /```(?:html|htm|xml)\b/i.test(shown))
        ) {
            return [shown];
        }
        var eng = apEngine();
        if (eng && typeof eng.splitDisplayParagraphs === 'function') {
            var parts = eng.splitDisplayParagraphs(shown);
            if (parts.length) return parts;
        }
        return [shown];
    }

    function startStreamRevealLoop() {
        if (streamUi.revealRaf) return;
        function tick() {
            var target = streamingDisplayTarget();
            var targetLen = target.length;
            if (ui.streamingRevealLen < targetLen) {
                var backlog = targetLen - ui.streamingRevealLen;
                /* backlog 大时加快追平，避免流式已到却还在「慢慢打字」 */
                var step =
                    backlog > 80
                        ? backlog
                        : Math.max(2, Math.min(24, Math.ceil(backlog / 6)));
                ui.streamingRevealLen = Math.min(targetLen, ui.streamingRevealLen + step);
                scheduleStreamMountPatch();
            }
            if (ui.status === 'coming' || ui.streamingRevealLen < targetLen) {
                streamUi.revealRaf = requestAnimationFrame(tick);
            } else {
                streamUi.revealRaf = 0;
            }
        }
        streamUi.revealRaf = requestAnimationFrame(tick);
    }

    function stopStreamRevealLoop() {
        if (streamUi.revealRaf) {
            cancelAnimationFrame(streamUi.revealRaf);
            streamUi.revealRaf = 0;
        }
    }

    function flushStreamReveal() {
        ui.streamingRevealLen = streamingDisplayTarget().length;
        stopStreamRevealLoop();
    }

    function clampInt(v, lo, hi, fb) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fb;
        return Math.min(hi, Math.max(lo, n));
    }

    function patchStreamThinking(mount) {
        if (!resolveShowThinking()) {
            var gone = mount.querySelector('[data-ap-stream-thinking]');
            if (gone) gone.remove();
            return;
        }
        var thinking = streamingThinkingText();
        var existing = mount.querySelector('[data-ap-stream-thinking]');
        if (!thinking) {
            if (existing) existing.remove();
            return;
        }
        var wasOpen = existing && existing.open;
        if (!existing) {
            mount.insertAdjacentHTML(
                'afterbegin',
                '<details class="xw-think xw-think--stream" data-ap-stream-thinking>' +
                    '<summary class="xw-think__toggle">查看思维链</summary>' +
                    '<div class="xw-think__body">' +
                    esc(thinking).replace(/\n/g, '<br>') +
                    '</div></details>'
            );
            existing = mount.querySelector('[data-ap-stream-thinking]');
        } else {
            var body = existing.querySelector('.xw-think__body');
            if (body) {
                var nextHtml = esc(thinking).replace(/\n/g, '<br>');
                if (body.innerHTML !== nextHtml) body.innerHTML = nextHtml;
            }
        }
        if (existing && wasOpen) existing.open = true;
    }

    function patchStreamMount() {
        var body = getStoryBodyEl();
        if (!body || ui.viewingArchive) return;
        var mount = ensureStreamMount(body);
        patchStreamThinking(mount);
        var lines = resolveStreamingParagraphs();

        var paraCount = lines.length;
        var existing = mount.querySelectorAll('[data-ap-stream]');

        if (paraCount > streamUi.paraCount) {
            for (var i = streamUi.paraCount; i < paraCount; i++) {
                var p = document.createElement('p');
                var isLive = i === paraCount - 1;
                p.className =
                    'xw-txt xw-txt--theirs is-stream' +
                    (isLive ? ' is-stream-live' : '');
                p.setAttribute('data-ap-stream', String(i));
                p.innerHTML = formatStreamParaHtml(lines[i]);
                mount.appendChild(p);
            }
            streamUi.paraCount = paraCount;
        } else if (paraCount < streamUi.paraCount) {
            for (var j = existing.length - 1; j >= paraCount; j--) {
                if (existing[j] && existing[j].parentNode) existing[j].parentNode.removeChild(existing[j]);
            }
            streamUi.paraCount = paraCount;
        }

        patchStreamWait(mount);

        if (paraCount > 0) {
            var live = mount.querySelector('[data-ap-stream="' + String(paraCount - 1) + '"]');
            if (live) {
                live.classList.add('is-stream-live');
                var nextHtml = formatStreamParaHtml(lines[paraCount - 1]);
                if (live.innerHTML !== nextHtml) live.innerHTML = nextHtml;
            }
            mount.querySelectorAll('[data-ap-stream]').forEach(function (node, idx) {
                if (idx < paraCount - 1) node.classList.remove('is-stream-live');
            });
        }

        scheduleStreamScroll();
        hydrateAppointmentHtmlPanels(mount);
    }

    function scheduleStreamMountPatch() {
        if (streamUi.raf) return;
        streamUi.raf = requestAnimationFrame(function () {
            streamUi.raf = 0;
            patchStreamMount();
        });
    }

    function isScrollNearBottom(sc, threshold) {
        if (!sc) return true;
        var gap = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
        return gap <= (threshold != null ? threshold : SCROLL_PIN_THRESHOLD);
    }

    function pinScrollToBottom() {
        streamUi.userPinnedBottom = true;
    }

    function bindScrollPin() {
        var sc = $('xw-main');
        if (!sc || ui.view !== 'story') return;
        if (sc._xwScrollPin) return;
        sc._xwScrollPin = true;
        sc.addEventListener(
            'scroll',
            function () {
                streamUi.userPinnedBottom = isScrollNearBottom(sc);
            },
            { passive: true }
        );
    }

    function scheduleStreamScroll() {
        if (!streamUi.userPinnedBottom) return;
        if (streamUi.scrollRaf) return;
        streamUi.scrollRaf = requestAnimationFrame(function () {
            streamUi.scrollRaf = 0;
            if (!streamUi.userPinnedBottom) return;
            scrollStoryToEnd(true);
        });
    }

    function resetStreamUi() {
        if (streamUi.raf) {
            cancelAnimationFrame(streamUi.raf);
            streamUi.raf = 0;
        }
        stopStreamRevealLoop();
        streamUi.paraCount = 0;
        ui.streamingRevealLen = 0;
    }

    function patchSummaryBusyUi() {
        var body = getStoryBodyEl();
        var busyEl = $('xw-note-busy');
        if (ui.summaryBusy) {
            if (body && !busyEl) {
                var el = document.createElement('div');
                el.id = 'xw-note-busy';
                el.className = 'xw-note-busy';
                el.setAttribute('role', 'status');
                el.textContent = '纪要生成中…';
                body.appendChild(el);
            } else if (busyEl) {
                busyEl.textContent = '纪要生成中…';
            }
        } else if (busyEl) {
            busyEl.remove();
        }
        var runBtn = $('xw-note-run');
        if (runBtn) {
            runBtn.disabled = !!ui.summaryBusy;
            runBtn.textContent = ui.summaryBusy ? '纪要生成中…' : '生成纪要';
        }
        var archBtn = $('xw-ribbon-sum');
        if (archBtn) {
            archBtn.disabled = !!ui.summaryBusy;
            archBtn.textContent = ui.summaryBusy ? '纪要生成中…' : '总结本期';
        }
    }

    function setSummaryBusy(busy) {
        ui.summaryBusy = !!busy;
        patchSummaryBusyUi();
    }

    function runManualSummary(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (ui.summaryBusy) return Promise.resolve(null);
        var eng = apEngine();
        if (!eng || typeof eng.appointmentSummary !== 'function') {
            return Promise.reject(new Error('engine_missing'));
        }
        setSummaryBusy(true);
        var callOpts = Object.assign({ silent: true }, opts);
        return eng
            .appointmentSummary(ui.chatId, ui.sessionId, callOpts)
            .then(function (sum) {
                if (!sum) {
                    toast('没有新的镜头可归档');
                    return sum;
                }
                if (!opts.silent) toast('纪要已写好');
                patchStoryBody();
                return sum;
            })
            .catch(function (err) {
                if (err && err.message === 'api_not_configured') toast('请先在「设置」里填好 API');
                else toast('纪要生成失败');
                throw err;
            })
            .finally(function () {
                setSummaryBusy(false);
            });
    }

    function patchStoryMeta() {
        var msgs = apStore().getSessionMessages(ui.chatId, ui.sessionId);
        var charCount = msgs.reduce(function (n, m) {
            return n + String(m.content || '').length;
        }, 0);
        var shots = document.querySelector('[data-xw-stat-shots]');
        var chars = document.querySelector('[data-xw-stat-chars]');
        if (shots) shots.textContent = String(msgs.length) + ' 镜';
        if (chars) chars.textContent = String(charCount) + ' 字';
    }

    function renderStory() {
        var st = chatStore();
        var chat = st && st.findChat(ui.chatId);
        var contact = chat && st.findContact(chat.contactId);
        var sess = apStore().getSession(ui.chatId, ui.sessionId);
        if (!sess) return '<p class="xw-empty">场景找不到了</p>';
        var msgs = apStore().getSessionMessages(ui.chatId, ui.sessionId);
        var sums = apStore().getSessionSummaries(ui.chatId, ui.sessionId);
        var castContacts = resolveCastContacts(
            Array.isArray(sess.cast) && sess.cast.length
                ? sess.cast
                : [{ contactId: (contact && contact.id) || ui.contactId, chatId: ui.chatId }]
        );
        if (!castContacts.length && contact) castContacts = [contact];
        var name = castDisplayName(castContacts, 6) || ellipsizeChars(characterRealName(contact), 6);
        var primaryFace = castContacts[0] || contact;
        var ava = esc(contactAvatar(primaryFace));
        var sceneTitle = String((sess && sess.title) || '').trim() || '未命名场景';
        var ribbon = ui.viewingArchive
            ? '<div class="xw-ribbon">' +
              '<div class="xw-ribbon__lead">' +
              '<span class="xw-ribbon__txt">旧卷只读</span>' +
              '<strong class="xw-ribbon__name">' + esc(sceneTitle) + '</strong></div>' +
              '<div class="xw-ribbon__acts">' +
              '<button type="button" class="xw-ribbon__act xw-ribbon__act--ghost" id="xw-ribbon-rename">命名</button>' +
              (msgs.length
                  ? '<button type="button" class="xw-ribbon__act" id="xw-ribbon-sum">归档成纪要</button>'
                  : '') +
              '</div></div>'
            : '';
        var hasStory =
            ui.viewingArchive ||
            msgs.length > 0 ||
            ui.streamingLines.length > 0 ||
            ui.status === 'coming';
        var charCount = msgs.reduce(function (n, m) {
            return n + String(m.content || '').length;
        }, 0);

        if (!hasStory) {
            return '<div id="mol-story-body" class="xw-script-host" hidden aria-hidden="true"></div>';
        }

        var streamingActive =
            !ui.viewingArchive && (ui.streamingLines.length > 0 || ui.status === 'coming');
        var scriptInner =
            '<article class="xw-script" id="mol-story-body">' +
            renderStoryLines(msgs, sums, [], !ui.viewingArchive) +
            (streamingActive
                ? '<div class="xw-stream-mount" data-ap-stream-mount aria-live="polite"></div>'
                : '') +
            '</article>';

        return (
            '<div class="xw-scene' + (isJournalTheme() ? ' xw-scene--journal' : '') + '"' +
            (isJournalTheme() ? ' style="--xw-stream-face:url(' + ava + ')"' : '') + '>' +
            ribbon +
            (isJournalTheme()
                ? ''
                : '<header class="xw-scene__band" style="--xw-face:url(' + ava + ')">' +
                  '<div class="xw-scene__band-shade" aria-hidden="true"></div>' +
                  castFacesHtml(castContacts, 'xw-scene__face', 2) +
                  '<div class="xw-scene__band-copy">' +
                  '<p class="xw-scene__with">与 <strong title="' +
                  escAttr(castDisplayName(castContacts)) +
                  '">' +
                  esc(name) +
                  '</strong></p>' +
                  '<p class="xw-scene__meta" id="xw-scene-meta">' +
                  '开镜 ' + esc(formatTs(sess.createdAt)) +
                  ' · ' +
                  '<span data-xw-stat-shots>' + String(msgs.length) + ' 镜</span> ' +
                  '<span data-xw-stat-chars>' + String(charCount) + ' 字</span></p></div></header>') +
            '<div class="xw-script-col">' + scriptInner + '</div></div>'
        );
    }

    function render() {
        var root = $('xw-root');
        if (!root) return;
        var body = '';
        if (ui.view === 'pick') body = renderPick();
        else if (ui.view === 'history') body = renderHistory();
        else if (ui.view === 'story') {
            if (!ui.viewingArchive && !storyHasContent()) body = renderOpeningPicker();
            else body = renderStory();
        }

        var mainCls = 'xw-main';
        if (ui.view === 'story' && !ui.viewingArchive && !storyHasContent()) {
            mainCls += ' xw-main--blank';
        }
        if (isJournalTheme()) mainCls += ' xw-main--journal';

        root.innerHTML =
            renderBackdrop() +
            '<div class="xw-shell' + (isJournalTheme() ? ' xw-shell--journal' : '') + '">' +
            (isJournalTheme() ? renderJournalChrome() : renderExitBtn()) +
            (isJournalTheme() ? '' : renderDock()) +
            '<main class="' + mainCls + '" id="xw-main">' + body + '</main>' +
            (ui.view === 'story' && !ui.viewingArchive
                ? isJournalTheme()
                    ? renderJournalWriter()
                    : renderWriter()
                : isJournalTheme()
                    ? renderJournalDockStubs()
                    : '') +
            '</div>';

        bindEvents();
        syncDockCollapsedUi();
        hydrateOfflineAvatars(root);
        if (ui.view === 'story' && ui.chatId && ui.sessionId) {
            var msgsR = apStore().getSessionMessages(ui.chatId, ui.sessionId);
            var sumsR = apStore().getSessionSummaries(ui.chatId, ui.sessionId);
            ui.stableStoryKey = computeStableStoryKey(msgsR, sumsR);
            if (
                !ui.viewingArchive &&
                (ui.status === 'coming' || String(ui.streamingRaw || '').length > 0)
            ) {
                startStreamRevealLoop();
                patchStreamMount();
            }
            patchSummaryBusyUi();
        }
        scrollStoryToEnd();
        syncStatusFab();
    }

    function syncStatusFab() {
        var statusApi = global.MiyaOfflineStatus;
        if (!statusApi || typeof statusApi.syncFab !== 'function') return;
        var enabled = typeof statusApi.isEnabled !== 'function' || statusApi.isEnabled();
        var show =
            enabled && ui.view === 'story' && !ui.viewingArchive && !!ui.chatId && !!ui.sessionId;
        statusApi.syncFab(show);
        if (!enabled && typeof statusApi.closePanel === 'function') statusApi.closePanel();
    }

    function getStatusContext() {
        return {
            chatId: ui.chatId,
            sessionId: ui.sessionId,
            contactId: ui.contactId
        };
    }

function renderWriter() {
        return (
            '<footer class="xw-writer">' +
            '<button type="button" class="xw-writer__undo" id="xw-writer-undo" title="重回" aria-label="重回">↶</button>' +
            '<textarea class="xw-writer__field" id="xw-writer-input" rows="1" placeholder="说台词，或写你会怎么做…"></textarea>' +
            '<button type="button" class="xw-writer__go" id="xw-writer-go" aria-label="推进场景">↑</button>' +
            '</footer>'
        );
    }

    function renderJournalDockStubs() {
        return (
            '<div class="xw-journal-dock-stubs" hidden aria-hidden="true">' +
            '<button type="button" id="xw-dock-prefs"></button>' +
            '<button type="button" id="xw-dock-beautify"></button>' +
            '<button type="button" id="xw-dock-vault"></button></div>'
        );
    }

    function renderJournalWriter() {
        return (
            '<footer class="xw-journal-writer">' +
            '<button type="button" class="xw-journal-writer__plus" id="xw-writer-undo" title="重回" aria-label="重回">' +
            ICON_UNDO + '</button>' +
            '<div class="xw-journal-writer__input">' +
            '<textarea class="xw-journal-writer__field" id="xw-writer-input" rows="1" placeholder="输入消息..."></textarea></div>' +
            '<button type="button" class="xw-journal-writer__ico" id="xw-dock-prefs" title="调参" aria-label="调参">' +
            ICON_SET + '</button>' +
            '<button type="button" class="xw-journal-writer__send" id="xw-writer-go" title="发送" aria-label="发送">' +
            ICON_SEND + '</button></footer>'
        );
    }

    function scrollStoryToEnd(force) {
        if (!force && !streamUi.userPinnedBottom) return;
        var sc = $('xw-main');
        if (!sc) return;
        requestAnimationFrame(function () {
            if (!force && !streamUi.userPinnedBottom) return;
            sc.scrollTop = sc.scrollHeight;
            streamUi.userPinnedBottom = isScrollNearBottom(sc);
        });
    }

    function patchStoryBody(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (ui.view !== 'story') return;
        var body = $('mol-story-body');
        if (!storyHasContent()) {
            render();
            return;
        }
        if (!body || body.classList.contains('xw-script-host')) {
            render();
            return;
        }
        var msgs = apStore().getSessionMessages(ui.chatId, ui.sessionId);
        if (!body) return;
        var sums = apStore().getSessionSummaries(ui.chatId, ui.sessionId);
        var stableKey = computeStableStoryKey(msgs, sums);
        var streaming = !ui.viewingArchive && (ui.streamingLines.length > 0 || ui.status === 'coming');

        if (!opts.streamOnly && stableKey !== ui.stableStoryKey) {
            ui.stableStoryKey = stableKey;
            var watermark = body.querySelector('.mol-story-watermark');
            var wmHtml = watermark ? watermark.outerHTML : '';
            body.innerHTML = wmHtml + renderStoryLines(msgs, sums, [], !ui.viewingArchive);
            hydrateAppointmentHtmlPanels(body);
            resetStreamUi();
            if (streaming) ensureStreamMount(body);
            else clearStreamMount(body);
            hydrateOfflineAvatars();
        }

        if (streaming) {
            scheduleStreamMountPatch();
        } else {
            clearStreamMount(body);
            resetStreamUi();
        }

        if (!opts.streamOnly && streamUi.userPinnedBottom) scrollStoryToEnd(true);
    }

    function syncSessionOnLeave() {
        if (!ui.chatId) return;
        var chatId = ui.chatId;
        var contactId = ui.contactId;
        if (typeof apStore().syncSessionCastToChats === 'function' && ui.sessionId) {
            apStore().syncSessionCastToChats(chatId, ui.sessionId);
        } else if (contactId && typeof apStore().syncAllSessionsToChat === 'function') {
            apStore().syncAllSessionsToChat(chatId, contactId);
        }
    }

    function sealActiveSession() {
        if (!ui.chatId) return false;
        var chatId = ui.chatId;
        var contactId = ui.contactId;
        var msgs = apStore().getSessionMessages(chatId, ui.sessionId);
        if (!msgs.length) {
            toast('还没有可封存的内容');
            return false;
        }
        var sess = apStore().getSession(chatId, ui.sessionId);
        var targets =
            typeof apStore().syncSessionCastToChats === 'function'
                ? apStore().syncSessionCastToChats(chatId, ui.sessionId)
                : null;
        if (!targets || !targets.length) {
            syncSessionOnLeave();
            targets = [{ contactId: contactId, chatId: chatId }];
        }
        if (typeof apStore().closeActiveSession === 'function') {
            apStore().closeActiveSession(chatId);
        }
        var eng = global.miyaChatEngine;
        var prompt =
            '【模式切换·线下→线上】你刚与用户完成一段线下长剧情会面，那些事你都亲身经历过、必须记得。现已回到线上聊天，请自然衔接，禁止表示不知情、没发生过或「我们只在线上聊过」。';
        if (eng && typeof eng.setPendingOnlineReturnPrompt === 'function') {
            targets.forEach(function (t) {
                var tid = String((t && t.chatId) || '').trim();
                if (tid) eng.setPendingOnlineReturnPrompt(tid, prompt);
            });
        }
        toast('本场景已封存');
        return true;
    }

    function leaveStoryToPick() {
        syncSessionOnLeave();
        ui.view = 'pick';
        ui.chatId = '';
        ui.sessionId = '';
        ui.contactId = '';
        ui.pickSelected = [];
        if (global.MiyaOfflineStatus && global.MiyaOfflineStatus.hideAll) {
            global.MiyaOfflineStatus.hideAll();
        }
        render();
    }

    function openWithChat(chatId, contactId, castOpt) {
        var mem = global.MiyaAppointmentMemory;
        var canonId =
            mem && typeof mem.resolveCanonicalChatId === 'function'
                ? mem.resolveCanonicalChatId(chatId)
                : chatId;
        if (canonId && contactId && typeof apStore().migrateSessionsToCanonicalChat === 'function') {
            apStore().migrateSessionsToCanonicalChat(canonId, contactId);
        }
        var hostChatId = canonId || chatId;
        var cast = Array.isArray(castOpt)
            ? castOpt
            : [{ contactId: contactId, chatId: hostChatId }];
        cast.forEach(function (row) {
            var cid = String((row && row.contactId) || '').trim();
            if (cid && typeof apStore().syncAllSessionsToChat === 'function') {
                var cChat = String((row && row.chatId) || '').trim() || hostChatId;
                apStore().syncAllSessionsToChat(cChat, cid);
            }
        });
        /* 未封存场次按出演名单续上（多人此前每次强制新开导致内容像“没保存”） */
        var active =
            typeof apStore().findResumableSessionByCast === 'function'
                ? apStore().findResumableSessionByCast(cast)
                : apStore().getActiveSession(hostChatId);
        var sess = active;
        if (!sess) {
            sess = apStore().startNewSession(hostChatId, contactId, cast);
        }
        if (!sess) return;
        if ((!sess.cast || !sess.cast.length) && cast.length) {
            sess.cast = cast;
            apStore()._writeSession(sess);
        }
        ui.chatId = String(sess.chatId || hostChatId);
        ui.contactId = String(sess.contactId || contactId || '').trim();
        ui.sessionId = sess.id;
        ui.viewingArchive = false;
        ui.streamingLines = [];
        ui.streamingRaw = '';
        ui.status = 'idle';
        if (ui.contactId) {
            apStore().setContactPresetId(ui.contactId, apStore().getContactPresetId(ui.contactId));
        }
        ui.view = 'story';
        render();
    }

    function startPickedCast() {
        var selected = Array.isArray(ui.pickSelected) ? ui.pickSelected.slice() : [];
        if (!selected.length) {
            toast('请先选择角色');
            return;
        }
        var cast = [];
        selected.forEach(function (cid) {
            var chat = ensureChatForContact(cid);
            if (!chat) return;
            cast.push({ contactId: String(cid), chatId: String(chat.id) });
        });
        if (!cast.length) {
            toast('无法创建会话，请稍后重试');
            return;
        }
        openWithChat(cast[0].chatId, cast[0].contactId, cast);
    }

    function openArchiveSession(sessionId) {
        ui.sessionId = sessionId;
        ui.viewingArchive = true;
        ui.view = 'story';
        ui.streamingLines = [];
        ui.streamingRaw = '';
        render();
    }

    function renameActiveSessionTitle() {
        if (!ui.chatId || !ui.sessionId) return;
        var sess = apStore().getSession(ui.chatId, ui.sessionId);
        if (!sess) return;
        dialog({
            mode: 'prompt',
            title: '场景命名',
            message: '给这一卷场景起个名字，保存后会出现在卷宗列表里',
            defaultValue: String(sess.title || '').trim(),
            confirmText: '保存',
            cancelText: '取消'
        }).then(function (name) {
            if (name == null) return;
            var trimmed = String(name || '').trim();
            if (typeof apStore().setSessionTitle === 'function') {
                apStore().setSessionTitle(ui.chatId, ui.sessionId, trimmed);
            } else {
                sess.title = trimmed;
                apStore()._writeSession(sess);
            }
            toast(trimmed ? '场景名称已保存' : '已恢复为未命名');
            render();
        });
    }

    function restoreToLiveStory() {
        ui.viewingArchive = false;
        ui.streamingLines = [];
        ui.streamingRaw = '';
        ui.status = 'idle';
        var active = apStore().getActiveSession(ui.chatId);
        if (active) {
            ui.sessionId = active.id;
        } else {
            var st = chatStore();
            var chat = st && st.findChat(ui.chatId);
            if (chat) {
                var sess = apStore().startNewSession(ui.chatId, chat.contactId);
                if (sess) ui.sessionId = sess.id;
            }
        }
        ui.view = 'story';
        render();
    }

    function runStream(handlers) {
        ui.streamingLines = [];
        ui.streamingRaw = '';
        ui.streamingRevealLen = 0;
        ui.status = 'coming';
        resetStreamUi();
        startStreamRevealLoop();
        patchStoryBody({ streamOnly: true });
        return handlers
            .then(function () {
                flushStreamReveal();
                patchStreamMount();
                ui.streamingLines = [];
                ui.streamingRaw = '';
                ui.status = 'idle';
                resetStreamUi();
                patchStoryBody();
                patchStoryMeta();
            })
            .catch(function (err) {
                ui.status = 'idle';
                ui.streamingLines = [];
                ui.streamingRaw = '';
                resetStreamUi();
                patchStoryBody();
                patchStoryMeta();
                if (err && err.message === 'api_not_configured') toast('请先在「设置」里填好 API');
                else if (err && err.message === 'session_not_found') toast('会话无效，请返回重选角色');
                else if (err && err.message === 'busy') toast('请稍候');
                else toast('这次没连上，稍后再试');
            });
    }

    function streamHandlers() {
        return {
            onStatus: function (s) {
                ui.status = s === 'coming' ? 'coming' : 'idle';
                if (s === 'idle') {
                    flushStreamReveal();
                    patchStoryBody();
                    resetStreamUi();
                    return;
                }
                startStreamRevealLoop();
                scheduleStreamMountPatch();
            },
            onDelta: function (full) {
                ui.streamingRaw = String(full || '');
                startStreamRevealLoop();
                scheduleStreamMountPatch();
            }
        };
    }

    var persistAppointmentPresetFromSheet = null;

    function isEnterToSend() {
        var chat = chatStore().findChat(ui.chatId);
        if (!chat) return true;
        var preset = apStore().resolvePresetForContact(chat.contactId);
        return !preset || preset.enterToSend !== false;
    }

    function sendMessage() {
        var input = $('xw-writer-input');
        if (!input) return;
        var text = String(input.value || '').trim();
        if (!text) return;
        if (typeof persistAppointmentPresetFromSheet === 'function') {
            try {
                persistAppointmentPresetFromSheet();
            } catch (e) {}
        }
        var eng = apEngine();
        if (!eng || eng.isBusy(ui.chatId, ui.sessionId)) {
            toast('等上一镜结束再说');
            return;
        }
        var wasEmpty = !storyHasContent();
        var userMsg = apStore().addMessage(ui.chatId, ui.sessionId, { role: 'user', content: text });
        if (!userMsg) {
            toast('没发出去，请退回重选角色');
            return;
        }
        input.value = '';
        input.disabled = true;
        var sendBtn = $('xw-writer-go');
        if (sendBtn) sendBtn.disabled = true;
        if (wasEmpty) {
            render();
        } else {
            patchStoryBody();
            patchStoryMeta();
        }

        pinScrollToBottom();
        scrollStoryToEnd(true);

        /* 先进入 runStream 显示「书写中」，再启动 completion，避免同步拼 prompt 卡住首帧 */
        var handlers = streamHandlers();
        runStream(
            Promise.resolve()
                .then(function () {
                    if (typeof eng.runAppointmentCompletion === 'function') {
                        return eng.runAppointmentCompletion(ui.chatId, ui.sessionId, handlers);
                    }
                    return eng.sendAppointment(ui.chatId, ui.sessionId, text, handlers);
                })
                .finally(function () {
                    input.disabled = false;
                    if (sendBtn) sendBtn.disabled = false;
                    input.focus();
                })
        );
    }

    function getTrailingAssistantRound(msgs) {
        var list = (msgs || []).filter(function (m) {
            return m && !m.deleted;
        });
        var round = [];
        var i;
        for (i = list.length - 1; i >= 0; i--) {
            if (list[i].role === 'assistant') round.unshift(list[i]);
            else break;
        }
        return round;
    }

    function quickRedoLastAssistant() {
        var eng = apEngine();
        if (!eng || eng.isBusy(ui.chatId, ui.sessionId)) {
            toast('等上一镜结束再说');
            return;
        }
        var msgs = apStore().getSessionMessages(ui.chatId, ui.sessionId);
        var round = getTrailingAssistantRound(msgs);
        if (!round.length) {
            toast('没有可重回的角色回复');
            return;
        }
        round.forEach(function (m) {
            apStore().deleteMessage(ui.chatId, ui.sessionId, m.id);
        });
        patchStoryBody();
        patchStoryMeta();
        var input = $('xw-writer-input');
        if (input) input.disabled = true;
        var sendBtn = $('xw-writer-go');
        if (sendBtn) sendBtn.disabled = true;
        runStream(
            Promise.resolve()
                .then(function () {
                    return eng.regenerateAppointment(ui.chatId, ui.sessionId, streamHandlers());
                })
                .finally(function () {
                    if (input) {
                        input.disabled = false;
                        input.focus();
                    }
                    if (sendBtn) sendBtn.disabled = false;
                })
        );
    }

    function openSettingsSheet() {
        var chat = chatStore().findChat(ui.chatId);
        if (!chat) return;
        var preset = apStore().resolvePresetForContact(chat.contactId);
        var sheet = document.createElement('div');
        sheet.className = 'xw-drawer xw-drawer--manga';
        sheet.id = 'xw-settings-sheet';

        var wbEntries = [];
        var wbs = global.miyaWorldbookStore;
        if (wbs && typeof wbs.listEntries === 'function') {
            wbEntries = wbs.listEntries();
        }

        var bindingRows = (preset.worldbookBindings || [])
            .map(function (b) {
                var ent = wbEntries.find(function (e) {
                    return e.id === b.entryId;
                });
                return { entryId: b.entryId, name: (ent && ent.name) || b.entryId, order: b.order };
            })
            .sort(function (a, b) {
                return a.order - b.order;
            });

        var summaries = apStore().getSessionSummaries(ui.chatId, ui.sessionId);

        function renderWbList() {
            return bindingRows
                .map(function (row) {
                    return (
                        '<div class="xw-wb-row" data-ap-wb-id="' +
                        esc(row.entryId) +
                        '"><span class="xw-wb-row__name">' +
                        esc(row.name) +
                        '</span><button type="button" data-ap-wb-rm="' +
                        esc(row.entryId) +
                        '" aria-label="移除">×</button></div>'
                    );
                })
                .join('');
        }

        function renderSumList() {
            if (!summaries.length) {
                return '<p class="xw-empty" style="padding:8px;font-size:11px">还没有纪要</p>';
            }
            return summaries
                .map(function (row) {
                    return (
                        '<article class="xw-note-entry" data-ap-sum-entry="' +
                        esc(row.id) +
                        '">' +
                        '<div class="xw-note-entry-meta">第 ' +
                        esc(String(row.startIndex)) +
                        '–' +
                        esc(String(row.endIndex)) +
                        ' 条 · ' +
                        esc(formatTs(row.createdAt)) +
                        '</div>' +
                        '<p class="xw-note-entry-body">' +
                        esc(row.content).replace(/\n/g, '<br>') +
                        '</p>' +
                        '<div class="xw-note-entry-actions">' +
                        '<button type="button" data-ap-sum-edit="' +
                        esc(row.id) +
                        '">改</button>' +
                        '<button type="button" data-ap-sum-redo="' +
                        esc(row.id) +
                        '">重写纪要</button>' +
                        '<button type="button" data-ap-sum-del="' +
                        esc(row.id) +
                        '">删除</button></div></article>'
                    );
                })
                .join('');
        }

        function renderPresetOptions() {
            var presets = apStore().getSavedParamPresets();
            return (
                '<option value="">读取参数预设…</option>' +
                presets
                    .map(function (p) {
                        return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
                    })
                    .join('')
            );
        }

        sheet.innerHTML =
            '<div class="xw-drawer__panel">' +
            '<div class="xw-drawer__head xw-manga-head">' +
            '<span class="xw-drawer__kicker">分镜 · 调参</span>' +
            '<h3>这一场怎么写</h3>' +
            '<p>叙事视角、篇幅与纪要在本场生效；记忆与线上互通。参数按角色保存，世界书绑定亦按角色独立。</p></div>' +
            '<section class="xw-manga-panel">' +
            '<div class="xw-field xw-field--panel"><label>参数预设</label>' +
            '<div class="xw-field--split">' +
            '<select id="mol-preset-load" class="xw-wb-add">' +
            renderPresetOptions() +
            '</select>' +
            '<button type="button" class="xw-btn" id="mol-preset-save">存为预设</button>' +
            '<button type="button" class="xw-btn" id="mol-preset-del">删预设</button></div>' +
            '<p class="xw-field__hint">预设不含世界书；读取后写入表单，须点「保存参数」才会绑定到当前角色。</p></div>' +
            '<div class="xw-field xw-field--panel"><label>叙事视角</label>' +
            '<select id="mol-pov-combo">' +
            personComboOptions(preset.rolePerson, preset.userPerson) +
            '</select>' +
            '<p class="xw-field__hint" id="mol-pov-hint"></p></div>' +
            '<div class="xw-field xw-field--panel"><label>写法说明</label>' +
            '<textarea id="mol-style" rows="5">' +
            esc(preset.styleGuide) +
            '</textarea></div>' +
            '<div class="xw-field xw-field--panel xw-field--split">' +
            '<div><label>每镜字数</label><input type="number" id="mol-word-count" min="80" max="4000" value="' +
            preset.outputWordCount +
            '"></div>' +
            '<div><label>自动纪要（0 关）</label><input type="number" id="xw-note-trigger" min="0" max="500" value="' +
            preset.summaryTrigger +
            '"></div></div>' +
            '<div class="xw-field xw-field--panel"><label>输出方式</label><select id="mol-stream-mode">' +
            (function () {
                var cfg =
                    typeof global.miyaGetApiConfigCached === 'function' ? global.miyaGetApiConfigCached() : {};
                var streamOn = cfg.appointmentStream !== false;
                return (
                    '<option value="true"' +
                    (streamOn ? ' selected' : '') +
                    '>流式</option><option value="false"' +
                    (streamOn ? '' : ' selected') +
                    '>非流式</option>'
                );
            })() +
            '</select></div>' +
            '<div class="xw-field xw-field--panel"><label>查看思维链</label>' +
            '<select id="mol-show-thinking">' +
            (preset.showThinking !== false
                ? '<option value="true" selected>开</option><option value="false">关</option>'
                : '<option value="true">开</option><option value="false" selected>关</option>') +
            '</select>' +
            '<p class="xw-field__hint">关则本场不显示推理过程（仍写入记录）</p></div>' +
            '<div class="xw-field xw-field--panel"><label>回车发送</label>' +
            '<select id="mol-enter-send">' +
            (preset.enterToSend !== false
                ? '<option value="true" selected>开</option><option value="false">关</option>'
                : '<option value="true">开</option><option value="false" selected>关</option>') +
            '</select></div>' +
            '<div class="xw-field xw-field--panel"><label>正文美化</label>' +
            '<select id="mol-text-decor">' +
            (preset.textDecor !== false
                ? '<option value="true" selected>开</option><option value="false">关</option>'
                : '<option value="true">开</option><option value="false" selected>关</option>') +
            '</select>' +
            '<p class="xw-field__hint">关则引号、括号等恢复为普通正文；按当前角色单独保存</p></div>' +
            '<div class="xw-field xw-field--panel"><label>状态栏悬浮球</label>' +
            '<select id="mol-status-fab">' +
            (function () {
                var sb =
                    typeof apStore().getStatusBar === 'function' ? apStore().getStatusBar() : { enabled: true };
                var on = !sb || sb.enabled !== false;
                return on
                    ? '<option value="true" selected>开</option><option value="false">关</option>'
                    : '<option value="true">开</option><option value="false" selected>关</option>';
            })() +
            '</select>' +
            '<p class="xw-field__hint">关则每轮不要求输出状态，也不显示悬浮球（单人/多人共用）</p>' +
            '<div class="xw-status-fab-preview" id="mol-status-fab-preview">' +
            '<div class="xw-status-fab-preview__face" id="mol-status-fab-face"></div>' +
            '<div class="xw-status-fab-preview__btns">' +
            '<button type="button" class="xw-btn" id="mol-status-fab-upload">更换图标</button>' +
            '<button type="button" class="xw-btn" id="mol-status-fab-reset">恢复默认</button>' +
            '<input type="file" id="mol-status-fab-file" accept="image/*" hidden>' +
            '</div></div>' +
            '<p class="xw-field__hint">默认简约圆环图标；可上传图片作为悬浮按钮</p></div>' +
            '<div class="xw-field xw-field--panel"><label>开场白预设</label>' +
            '<p class="xw-field__hint">按当前角色保存；新场景选用后作为系统上下文首条，非任一方气泡。</p>' +
            '<div class="xw-opening-sheet__list" id="xw-opening-preset-list">' +
            renderSheetOpeningPresetList(chat.contactId) +
            '</div>' +
            '<input type="text" id="xw-opening-preset-name" class="xw-wb-add" placeholder="预设名称" maxlength="32">' +
            '<textarea id="xw-opening-preset-content" class="xw-opening-sheet__input" rows="4" placeholder="场景、氛围或前情…"></textarea>' +
            '<button type="button" class="xw-btn" id="xw-opening-preset-add">存为开场白预设</button></div></section>' +
            '<section class="xw-manga-panel">' +
            '<div class="xw-field xw-field--panel"><label>额外挂世界书</label>' +
            '<div class="xw-wb-list" id="xw-wb-list">' +
            renderWbList() +
            '</div>' +
            '<select id="mol-wb-add" class="xw-wb-add"><option value="">＋ 绑定词条</option>' +
            wbEntries
                .map(function (e) {
                    return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>';
                })
                .join('') +
            '</select></div>' +
            '<div class="xw-field xw-field--panel"><label>本卷纪要</label>' +
            '<div class="xw-note-list" id="xw-note-list">' +
            renderSumList() +
            '</div></div></section>' +
            '<div class="xw-drawer__foot xw-manga-foot">' +
            '<button type="button" id="mol-params-save" class="xw-btn xw-btn--solid">保存参数</button>' +
            '<button type="button" id="xw-note-run" class="xw-btn">生成纪要</button>' +
            '<button type="button" id="mol-sheet-close">收起</button></div></div>';

        document.body.appendChild(sheet);
        requestAnimationFrame(function () {
            sheet.classList.add('is-open');
        });

        function bindWbRm() {
            sheet.querySelectorAll('[data-ap-wb-rm]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = btn.getAttribute('data-ap-wb-rm');
                    bindingRows = bindingRows.filter(function (r) {
                        return r.entryId !== id;
                    });
                    $('xw-wb-list').innerHTML = renderWbList();
                    bindWbRm();
                });
            });
        }
        bindWbRm();

        $('mol-wb-add').addEventListener('change', function () {
            var id = String(this.value || '').trim();
            this.value = '';
            if (!id) return;
            if (bindingRows.some(function (r) { return r.entryId === id; })) return;
            var ent = wbEntries.find(function (e) { return e.id === id; });
            bindingRows.push({
                entryId: id,
                name: (ent && ent.name) || id,
                order: bindingRows.length
            });
            $('xw-wb-list').innerHTML = renderWbList();
            bindWbRm();
        });

        function persistAppointmentStreamMode() {
            var sel = $('mol-stream-mode');
            if (!sel) return;
            var streamOn = sel.value !== 'false';
            if (typeof global.miyaSetApiConfig === 'function') {
                var prev =
                    typeof global.miyaGetApiConfigCached === 'function' ? global.miyaGetApiConfigCached() : {};
                global.miyaSetApiConfig(Object.assign({}, prev, { appointmentStream: streamOn }));
            } else if (typeof global.setFruitApiConfig === 'function') {
                var prev2 =
                    typeof global.getFruitApiConfigCached === 'function' ? global.getFruitApiConfigCached() : {};
                global.setFruitApiConfig(Object.assign({}, prev2, { appointmentStream: streamOn }));
            }
        }

        function defaultSummaryPrompt() {
            var builtin = apStore().getBuiltinPreset();
            return String((builtin && builtin.summaryPrompt) || '').trim();
        }

        function readFormParams() {
            persistAppointmentStreamMode();
            var pov = parsePovCombo($('mol-pov-combo').value);
            return {
                summaryTrigger: parseInt($('xw-note-trigger').value, 10) || 0,
                outputWordCount: parseInt($('mol-word-count').value, 10) || 2000,
                styleGuide: $('mol-style').value,
                rolePerson: pov.rolePerson,
                userPerson: pov.userPerson,
                summaryPrompt: defaultSummaryPrompt(),
                showThinking: $('mol-show-thinking').value !== 'false',
                enterToSend: $('mol-enter-send').value !== 'false',
                textDecor: $('mol-text-decor').value !== 'false'
            };
        }

        function readForm() {
            var params = readFormParams();
            return Object.assign({}, params, {
                id: preset.id,
                name: preset.name,
                worldbookBindings: bindingRows.map(function (r, i) {
                    return { entryId: r.entryId, order: i };
                })
            });
        }

        function applyParamsToForm(params) {
            if (!params) return;
            var povSel = $('mol-pov-combo');
            if (povSel) {
                povSel.value = povComboValue(params.rolePerson, params.userPerson);
                updatePovHint();
            }
            if ($('mol-style')) $('mol-style').value = params.styleGuide || '';
            if ($('mol-word-count')) $('mol-word-count').value = params.outputWordCount || 2000;
            if ($('xw-note-trigger')) $('xw-note-trigger').value = params.summaryTrigger != null ? params.summaryTrigger : 15;
            if ($('mol-show-thinking')) {
                $('mol-show-thinking').value = params.showThinking !== false ? 'true' : 'false';
            }
            if ($('mol-enter-send')) {
                $('mol-enter-send').value = params.enterToSend !== false ? 'true' : 'false';
            }
            if ($('mol-text-decor')) {
                $('mol-text-decor').value = params.textDecor !== false ? 'true' : 'false';
            }
        }

        function refreshPresetSelect(selectedId) {
            var sel = $('mol-preset-load');
            if (!sel) return;
            sel.innerHTML = renderPresetOptions();
            if (selectedId) sel.value = selectedId;
        }

        function persistPresetFromForm() {
            if (!chat || !chat.contactId) return false;
            var params = readFormParams();
            apStore().saveContactParams(chat.contactId, params);
            apStore().saveContactWorldbook(
                chat.contactId,
                bindingRows.map(function (r, i) {
                    return { entryId: r.entryId, order: i };
                })
            );
            var statusSel = $('mol-status-fab');
            if (statusSel && typeof apStore().saveStatusBar === 'function') {
                apStore().saveStatusBar({ enabled: statusSel.value !== 'false' });
            }
            syncStatusFab();
            ui.stableStoryKey = '';
            try {
                patchStoryBody();
            } catch (e) {}
            return true;
        }

        function paintStatusFabPreview() {
            var face = $('mol-status-fab-face');
            if (!face) return;
            var sb = typeof apStore().getStatusBar === 'function' ? apStore().getStatusBar() : {};
            var url = String((sb && sb.fabIconUrl) || '').trim();
            var statusApi = global.MiyaOfflineStatus;
            if (url) {
                face.innerHTML = '<img src="' + escAttr(url) + '" alt="">';
            } else if (statusApi && statusApi.defaultFabIconHtml) {
                face.innerHTML = statusApi.defaultFabIconHtml;
            } else {
                face.innerHTML =
                    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
            }
        }

        function readFabIconFile(file) {
            if (!file) return Promise.resolve('');
            var imgApi = global.MiyaChatImage;
            var maxEdge = 128;
            function toDataUrl(blobOrFile) {
                return new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function () {
                        resolve(String(reader.result || ''));
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blobOrFile);
                });
            }
            function shrinkDataUrl(dataUrl) {
                return new Promise(function (resolve) {
                    var img = new Image();
                    img.onload = function () {
                        var w = img.naturalWidth || img.width || maxEdge;
                        var h = img.naturalHeight || img.height || maxEdge;
                        var scale = Math.min(1, maxEdge / Math.max(w, h));
                        var cw = Math.max(1, Math.round(w * scale));
                        var ch = Math.max(1, Math.round(h * scale));
                        var canvas = document.createElement('canvas');
                        canvas.width = cw;
                        canvas.height = ch;
                        var ctx = canvas.getContext('2d');
                        if (!ctx) {
                            resolve(dataUrl);
                            return;
                        }
                        ctx.drawImage(img, 0, 0, cw, ch);
                        try {
                            resolve(canvas.toDataURL('image/png'));
                        } catch (e) {
                            resolve(dataUrl);
                        }
                    };
                    img.onerror = function () {
                        resolve(dataUrl);
                    };
                    img.src = dataUrl;
                });
            }
            var prep =
                imgApi && typeof imgApi.compressImageFileToBlob === 'function'
                    ? imgApi.compressImageFileToBlob(file, { maxEdge: maxEdge, quality: 0.85 }).catch(function () {
                          return file;
                      })
                    : Promise.resolve(file);
            return prep
                .then(toDataUrl)
                .then(shrinkDataUrl)
                .then(function (url) {
                    return String(url || '').slice(0, 350000);
                });
        }

        paintStatusFabPreview();

        var fabUpload = $('mol-status-fab-upload');
        var fabReset = $('mol-status-fab-reset');
        var fabFile = $('mol-status-fab-file');
        if (fabUpload && fabFile) {
            fabUpload.addEventListener('click', function () {
                fabFile.click();
            });
            fabFile.addEventListener('change', function () {
                var file = fabFile.files && fabFile.files[0];
                fabFile.value = '';
                if (!file) return;
                toast('处理图标中…');
                readFabIconFile(file)
                    .then(function (url) {
                        if (!url) {
                            toast('读取图片失败');
                            return;
                        }
                        apStore().saveStatusBar({ fabIconUrl: url });
                        paintStatusFabPreview();
                        if (global.MiyaOfflineStatus && global.MiyaOfflineStatus.applyFabAppearance) {
                            global.MiyaOfflineStatus.applyFabAppearance();
                        }
                        syncStatusFab();
                        toast('悬浮图标已更换');
                    })
                    .catch(function () {
                        toast('更换失败');
                    });
            });
        }
        if (fabReset) {
            fabReset.addEventListener('click', function () {
                apStore().saveStatusBar({ fabIconUrl: '' });
                paintStatusFabPreview();
                if (global.MiyaOfflineStatus && global.MiyaOfflineStatus.applyFabAppearance) {
                    global.MiyaOfflineStatus.applyFabAppearance();
                }
                syncStatusFab();
                toast('已恢复默认图标');
            });
        }

        persistAppointmentPresetFromSheet = persistPresetFromForm;

        function updatePovHint() {
            var hintEl = $('mol-pov-hint');
            var sel = $('mol-pov-combo');
            if (!hintEl || !sel) return;
            var combo = POV_COMBOS.find(function (c) {
                return povComboValue(c.rolePerson, c.userPerson) === sel.value;
            });
            hintEl.textContent = combo ? combo.hint : '';
        }

        $('mol-pov-combo').addEventListener('change', updatePovHint);
        updatePovHint();

        $('xw-note-run').addEventListener('click', function () {
            persistPresetFromForm();
            runManualSummary({})
                .then(function () {
                    refreshSumList();
                })
                .catch(function () {});
        });

        function refreshSumList() {
            summaries = apStore().getSessionSummaries(ui.chatId, ui.sessionId);
            var el = $('xw-note-list');
            if (el) el.innerHTML = renderSumList();
            bindSumActions();
        }

        function bindSumActions() {
            sheet.querySelectorAll('[data-ap-sum-edit]').forEach(function (btn) {
                btn.onclick = function () {
                    var sid = btn.getAttribute('data-ap-sum-edit');
                    var row = summaries.find(function (r) { return r.id === sid; });
                    if (!row) return;
                    dialog(storyEditDialogOpts('改总结', '修改总结内容', row.content)).then(function (val) {
                        if (val == null) return;
                        apStore().updateSummary(ui.chatId, ui.sessionId, sid, {
                            content: String(val).trim()
                        });
                        refreshSumList();
                        patchStoryBody();
                        toast('总结已更新');
                    });
                };
            });
            sheet.querySelectorAll('[data-ap-sum-redo]').forEach(function (btn) {
                btn.onclick = function () {
                    var sid = btn.getAttribute('data-ap-sum-redo');
                    runManualSummary({ replaceSummaryId: sid })
                        .then(function () {
                            refreshSumList();
                        })
                        .catch(function () {});
                };
            });
            sheet.querySelectorAll('[data-ap-sum-del]').forEach(function (btn) {
                btn.onclick = function () {
                    dialog({
                        mode: 'confirm',
                        title: '删除总结',
                        message: '删除后，对应段落将按原文参与记忆注入。',
                        confirmText: '删除',
                        cancelText: '取消'
                    }).then(function (ok) {
                        if (!ok) return;
                        apStore().deleteSummary(ui.chatId, ui.sessionId, btn.getAttribute('data-ap-sum-del'));
                        refreshSumList();
                        patchStoryBody();
                        toast('总结已删除');
                    });
                };
            });
        }
        bindSumActions();

        function refreshOpeningPresetList() {
            var el = $('xw-opening-preset-list');
            if (el && chat && chat.contactId) {
                el.innerHTML = renderSheetOpeningPresetList(chat.contactId);
            }
            bindOpeningPresetActions();
        }

        function bindOpeningPresetActions() {
            sheet.querySelectorAll('[data-ap-opening-preset-del]').forEach(function (btn) {
                btn.onclick = function () {
                    var pid = btn.getAttribute('data-ap-opening-preset-del');
                    dialog({
                        mode: 'confirm',
                        title: '删除开场白预设',
                        message: '确定删除这条开场白预设？',
                        confirmText: '删除',
                        cancelText: '取消'
                    }).then(function (ok) {
                        if (!ok || !chat || !chat.contactId) return;
                        apStore().deleteContactOpeningPreset(chat.contactId, pid);
                        refreshOpeningPresetList();
                        toast('已删除');
                    });
                };
            });
        }
        bindOpeningPresetActions();

        var openingAddBtn = $('xw-opening-preset-add');
        if (openingAddBtn) {
            openingAddBtn.addEventListener('click', function () {
                if (!chat || !chat.contactId) return;
                var name = String(($('xw-opening-preset-name') || {}).value || '').trim();
                var content = String(($('xw-opening-preset-content') || {}).value || '').trim();
                if (!content) {
                    toast('请输入开场白内容');
                    return;
                }
                apStore().upsertContactOpeningPreset(chat.contactId, {
                    name: name || '开场白',
                    content: content
                });
                if ($('xw-opening-preset-name')) $('xw-opening-preset-name').value = '';
                if ($('xw-opening-preset-content')) $('xw-opening-preset-content').value = '';
                refreshOpeningPresetList();
                toast('开场白预设已保存');
            });
        }

        $('mol-params-save').addEventListener('click', function () {
            if (persistPresetFromForm()) toast('已保存当前角色参数');
        });

        $('mol-preset-save').addEventListener('click', function () {
            dialog({
                mode: 'prompt',
                title: '存为参数预设',
                message: '预设名称（不含世界书绑定）',
                defaultValue: '',
                confirmText: '保存',
                cancelText: '取消'
            }).then(function (name) {
                if (name == null) return;
                var trimmed = String(name || '').trim();
                if (!trimmed) {
                    toast('请输入预设名称');
                    return;
                }
                var row = apStore().upsertSavedParamPreset(
                    Object.assign({}, readFormParams(), { name: trimmed })
                );
                if (row) {
                    refreshPresetSelect(row.id);
                    toast('预设已保存');
                }
            });
        });

        $('mol-preset-del').addEventListener('click', function () {
            var sel = $('mol-preset-load');
            var pid = sel ? String(sel.value || '').trim() : '';
            if (!pid) {
                toast('请先选择要删除的预设');
                return;
            }
            dialog({
                mode: 'confirm',
                title: '删除参数预设',
                message: '删除后不可恢复，确认删除？',
                confirmText: '删除',
                cancelText: '取消'
            }).then(function (ok) {
                if (!ok) return;
                apStore().deleteSavedParamPreset(pid);
                refreshPresetSelect('');
                toast('预设已删除');
            });
        });

        $('mol-preset-load').addEventListener('change', function () {
            var pid = String(this.value || '').trim();
            this.value = '';
            if (!pid) return;
            var hit = apStore().getSavedParamPresets().find(function (p) {
                return p.id === pid;
            });
            if (!hit) return;
            applyParamsToForm(hit);
            toast('已读取预设，点「保存参数」写入当前角色');
        });

        $('mol-sheet-close').addEventListener('click', closeSheet);
        sheet.addEventListener('click', function (e) {
            if (e.target === sheet) closeSheet();
        });

        function closeSheet() {
            try {
                persistPresetFromForm();
            } catch (e) {}
            persistAppointmentPresetFromSheet = null;
            sheet.classList.remove('is-open');
            setTimeout(function () {
                sheet.remove();
            }, 320);
        }
    }

    function povComboValue(rolePerson, userPerson) {
        return String(rolePerson || 'third') + '|' + String(userPerson || 'second');
    }

    function parsePovCombo(val) {
        var parts = String(val || '').split('|');
        var role = parts[0];
        var user = parts[1];
        var ok = function (p) {
            return ['first', 'second', 'third'].indexOf(p) >= 0;
        };
        if (!ok(role) || !ok(user)) {
            return { rolePerson: 'third', userPerson: 'second' };
        }
        return { rolePerson: role, userPerson: user };
    }

    function personComboOptions(rolePerson, userPerson) {
        var cur = povComboValue(rolePerson, userPerson);
        return POV_COMBOS.map(function (c) {
            var v = povComboValue(c.rolePerson, c.userPerson);
            return (
                '<option value="' +
                esc(v) +
                '"' +
                (v === cur ? ' selected' : '') +
                '>' +
                esc(c.label) +
                '</option>'
            );
        }).join('');
    }

    function deleteFromMessage(msgId) {
        var sess = apStore().getSession(ui.chatId, ui.sessionId);
        if (!sess) return;
        var idx = sess.messages.findIndex(function (m) {
            return m.id === msgId;
        });
        if (idx < 0) return;
        sess.messages.slice(idx).forEach(function (m) {
            apStore().deleteMessage(ui.chatId, ui.sessionId, m.id);
        });
        patchStoryBody();
    }

    function deleteSingleMessage(msgId) {
        apStore().deleteMessage(ui.chatId, ui.sessionId, msgId);
        patchStoryBody();
        toast('已删除');
    }

    function editMessage(msgId) {
        var sess = apStore().getSession(ui.chatId, ui.sessionId);
        if (!sess) return;
        var msg = (sess.messages || []).find(function (m) {
            return m.id === msgId;
        });
        if (!msg || msg.deleted) return;
        dialog(storyEditDialogOpts('改', '修改本条内容', msg.content)).then(function (val) {
            if (val == null) return;
            var text = String(val).trim();
            if (!text) {
                toast('内容不能为空');
                return;
            }
            apStore().updateMessage(ui.chatId, ui.sessionId, msgId, { content: text });
            patchStoryBody();
            toast('已保存');
        });
    }

    function assistantRoundStartId(sess, msg) {
        var list = (sess.messages || []).filter(function (m) {
            return m && !m.deleted;
        });
        var idx = list.findIndex(function (m) {
            return m.id === msg.id;
        });
        if (idx < 0) return msg.id;
        var start = idx;
        while (start > 0 && list[start - 1].role === 'assistant') start -= 1;
        return list[start].id;
    }

    function redoFromMessage(msg, autoSend) {
        var sess = apStore().getSession(ui.chatId, ui.sessionId);
        if (!sess || !msg) return;
        var idx = sess.messages.findIndex(function (m) {
            return m.id === msg.id;
        });
        if (idx < 0) return;

        if (msg.role === 'user') {
            var text = msg.content;
            deleteFromMessage(msg.id);
            patchStoryMeta();
            if (autoSend) {
                var eng = apEngine();
                if (!eng || eng.isBusy(ui.chatId, ui.sessionId)) {
                    toast('请稍候');
                    return;
                }
                var input = $('xw-writer-input');
                if (input) input.disabled = true;
                var sendBtn = $('xw-writer-go');
                if (sendBtn) sendBtn.disabled = true;
                runStream(
                    Promise.resolve()
                        .then(function () {
                            return eng.sendAppointment(ui.chatId, ui.sessionId, text, streamHandlers());
                        })
                        .finally(function () {
                            if (input) {
                                input.disabled = false;
                                input.focus();
                            }
                            if (sendBtn) sendBtn.disabled = false;
                        })
                );
            } else {
                var inp = $('xw-writer-input');
                if (inp) {
                    inp.value = text;
                    inp.focus();
                }
                toast('已回溯，可改后发送');
            }
            return;
        }

        if (msg.role === 'assistant') {
            var roundStartId = assistantRoundStartId(sess, msg);
            deleteFromMessage(roundStartId);
            patchStoryMeta();
            var eng2 = apEngine();
            if (!eng2 || eng2.isBusy(ui.chatId, ui.sessionId)) {
                toast('请稍候');
                return;
            }
            var input2 = $('xw-writer-input');
            if (input2) input2.disabled = true;
            var sendBtn2 = $('xw-writer-go');
            if (sendBtn2) sendBtn2.disabled = true;
            runStream(
                Promise.resolve()
                    .then(function () {
                        return eng2.regenerateAppointment(ui.chatId, ui.sessionId, streamHandlers());
                    })
                    .finally(function () {
                        if (input2) {
                            input2.disabled = false;
                            input2.focus();
                        }
                        if (sendBtn2) sendBtn2.disabled = false;
                    })
            );
        }
    }

    function bindEvents() {
        bindScrollPin();
        var back = $('xw-exit');
        if (back) {
            back.onclick = function () {
                if (ui.view === 'story' && ui.viewingArchive) {
                    ui.view = 'history';
                    ui.viewingArchive = false;
                    render();
                    return;
                }
                if (ui.view === 'history') {
                    restoreToLiveStory();
                    return;
                }
                if (ui.view === 'story') {
                    leaveStoryToPick();
                    return;
                }
                closeApp();
            };
        }

        document.querySelectorAll('[data-ap-toggle]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var cid = String(btn.getAttribute('data-ap-toggle') || '').trim();
                if (!cid) return;
                var list = Array.isArray(ui.pickSelected) ? ui.pickSelected.slice() : [];
                var idx = list.indexOf(cid);
                if (idx >= 0) list.splice(idx, 1);
                else list.push(cid);
                ui.pickSelected = list;
                render();
            });
        });
        var pickStart = $('xw-pick-start');
        if (pickStart) {
            pickStart.addEventListener('click', startPickedCast);
        }

        var dockEl = document.querySelector('#xw-root .xw-dock');
        if (dockEl) {
            dockEl.addEventListener('click', function (e) {
                if (e.target.closest('.xw-dock__btn')) return;
                setDockCollapsed(true);
            });
        }
        var dockExpand = $('xw-dock-expand');
        if (dockExpand) {
            dockExpand.addEventListener('click', function () {
                setDockCollapsed(false);
            });
        }

        var sealBtn = $('xw-dock-seal');
        if (sealBtn) {
            sealBtn.addEventListener('click', function () {
                if (ui.view !== 'story' || ui.viewingArchive) return;
                if (!sealActiveSession()) return;
                leaveStoryToPick();
            });
        }

        var histBtn = $('xw-dock-vault');
        if (histBtn) {
            histBtn.addEventListener('click', function () {
                if (ui.view === 'history') {
                    restoreToLiveStory();
                    return;
                }
                if (ui.viewingArchive) {
                    ui.view = 'history';
                    ui.viewingArchive = false;
                    render();
                    return;
                }
                ui.view = 'history';
                render();
            });
        }

        document.querySelectorAll('[data-ap-apply-opening]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                applyOpeningPreset(btn.getAttribute('data-ap-apply-opening'));
            });
        });

        var setBtn = $('xw-dock-prefs');
        if (setBtn) setBtn.addEventListener('click', openSettingsSheet);

        var bfBtn = $('xw-dock-beautify');
        if (bfBtn) {
            bfBtn.addEventListener('click', function () {
                if (global.MiyaOfflineBeautify && global.MiyaOfflineBeautify.openBeautifyDrawer) {
                    global.MiyaOfflineBeautify.openBeautifyDrawer();
                } else {
                    toast('样式模块未加载');
                }
            });
        }

        var archSumBtn = $('xw-ribbon-sum');
        if (archSumBtn) {
            archSumBtn.addEventListener('click', function () {
                runManualSummary({}).catch(function () {});
            });
        }

        var renameBtn = $('xw-ribbon-rename');
        if (renameBtn) {
            renameBtn.addEventListener('click', function () {
                renameActiveSessionTitle();
            });
        }

        document.querySelectorAll('[data-ap-view-session]').forEach(function (row) {
            row.addEventListener('click', function (e) {
                if (e.target.closest('[data-ap-del-session]')) return;
                openArchiveSession(row.getAttribute('data-ap-view-session'));
            });
        });

        document.querySelectorAll('[data-ap-del-session]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                dialog({
                    mode: 'confirm',
                    title: '删掉卷宗',
                    message: '确定删掉这一卷场景吗？',
                    confirmText: '删除',
                    cancelText: '取消'
                }).then(function (ok) {
                    if (!ok) return;
                    apStore().deleteSession(ui.chatId, btn.getAttribute('data-ap-del-session'));
                    render();
                });
            });
        });

        document.querySelectorAll('[data-ap-recover-mirrors]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                recoverFromOnlineMemory();
            });
        });

        var story = $('mol-story-body');
        if (story) {
            story.addEventListener('click', function (e) {
                if (ui.viewingArchive) return;
                var editBtn = e.target.closest('[data-ap-msg-edit]');
                if (editBtn) {
                    e.stopPropagation();
                    editMessage(editBtn.getAttribute('data-ap-msg-edit'));
                    return;
                }
                var htmlFs = e.target.closest('[data-ap-html-fs]');
                if (htmlFs) {
                    e.stopPropagation();
                    var panel = htmlFs.closest('[data-ap-html-panel]');
                    var frame = panel && panel.querySelector('iframe[data-ap-html-iframe]');
                    var srcdoc = frame && decodeApHtmlSrcdocB64(frame.getAttribute('data-ap-html-srcdoc-b64'));
                    var htmlApi = global.MiyaChatHtml;
                    if (htmlApi && srcdoc && typeof htmlApi.openChatHtmlFullscreen === 'function') {
                        htmlApi.openChatHtmlFullscreen(srcdoc);
                    }
                    return;
                }
                var delBtn = e.target.closest('[data-ap-msg-del]');
                if (delBtn) {
                    e.stopPropagation();
                    var delId = delBtn.getAttribute('data-ap-msg-del');
                    dialog({
                        mode: 'confirm',
                        title: '删除',
                        message: '确定删除这条消息？',
                        confirmText: '删除',
                        cancelText: '取消'
                    }).then(function (ok) {
                        if (!ok) return;
                        deleteSingleMessage(delId);
                    });
                    return;
                }
                var resendBtn = e.target.closest('[data-ap-msg-resend]');
                if (resendBtn) {
                    e.stopPropagation();
                    var resendId = resendBtn.getAttribute('data-ap-msg-resend');
                    var sessResend = apStore().getSession(ui.chatId, ui.sessionId);
                    var msgResend = sessResend
                        ? (sessResend.messages || []).find(function (m) {
                              return m && m.id === resendId && !m.deleted;
                          })
                        : null;
                    if (!msgResend || msgResend.role === 'system') return;
                    if (apEngine() && apEngine().isBusy(ui.chatId, ui.sessionId)) {
                        toast('等上一镜结束再说');
                        return;
                    }
                    redoFromMessage(msgResend, true);
                    return;
                }
                var openingDelBtn = e.target.closest('[data-ap-opening-del]');
                if (openingDelBtn) {
                    e.stopPropagation();
                    removeSessionOpening(openingDelBtn.getAttribute('data-ap-opening-del'));
                    return;
                }
            });
            story.addEventListener('click', function (e) {
                var sumCard = e.target.closest('[data-ap-sum-id]');
                if (!sumCard) return;
                var sid = sumCard.getAttribute('data-ap-sum-id');
                var sums = apStore().getSessionSummaries(ui.chatId, ui.sessionId);
                var row = sums.find(function (r) { return r.id === sid; });
                if (!row) return;
                if (ui.viewingArchive) {
                    dialog({
                        mode: 'confirm',
                        title: '往期总结',
                        message:
                            '第 ' +
                            row.startIndex +
                            '–' +
                            row.endIndex +
                            ' 条\n\n' +
                            String(row.content || '').slice(0, 800) +
                            (String(row.content || '').length > 800 ? '…' : '') +
                            '\n\n重写纪要将替换该段在记忆中的上下文。',
                        confirmText: '重写纪要',
                        cancelText: '收起'
                    }).then(function (ok) {
                        if (!ok) return;
                        runManualSummary({ replaceSummaryId: sid }).catch(function () {});
                    });
                    return;
                }
                dialog(
                    storyEditDialogOpts(
                        '改总结',
                        '第 ' + row.startIndex + '–' + row.endIndex + ' 条',
                        row.content
                    )
                ).then(function (val) {
                    if (val == null) return;
                    apStore().updateSummary(ui.chatId, ui.sessionId, sid, { content: String(val).trim() });
                    patchStoryBody();
                });
            });
        }

        var input = $('xw-writer-input');
        var sendBtn = $('xw-writer-go');
        if (input) {
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey && isEnterToSend()) {
                    e.preventDefault();
                    sendMessage();
                }
            });
        }
        if (sendBtn) sendBtn.addEventListener('click', sendMessage);

        var quickRedo = $('xw-writer-undo');
        if (quickRedo) quickRedo.addEventListener('click', quickRedoLastAssistant);
    }

    function applyOfflineBeautify() {
        if (global.MiyaOfflineBeautify && global.MiyaOfflineBeautify.applyBeautify) {
            global.MiyaOfflineBeautify.applyBeautify();
        }
    }

    function openApp() {
        var app = $('miya-offline-app');
        if (!app) return;
        var st = apStore();
        if (st) st.load();
        applyOfflineBeautify();
        ui.view = 'pick';
        ui.chatId = '';
        ui.sessionId = '';
        ui.viewingArchive = false;
        ui.streamingLines = [];
        ui.streamingRaw = '';
        ui.pickSelected = [];
        ui.catalogNo = '现场·' + String(Date.now()).slice(-6);
        render();
        if (global.MiyaOfflineStatus && global.MiyaOfflineStatus.hideAll) {
            global.MiyaOfflineStatus.hideAll();
        }
        app.removeAttribute('hidden');
        app.classList.add('is-open');
        app.setAttribute('aria-hidden', 'false');
        document.body.classList.add('miya-app-open');

        var hydrate = Promise.resolve();
        if (global.miyaChatStore && typeof global.miyaChatStore.init === 'function') {
            hydrate = global.miyaChatStore.init().catch(function () {});
        }
        if (st && typeof st.whenReady === 'function') {
            hydrate = hydrate.then(function () { return st.whenReady(); });
        }
        if (global.MiyaOfflineBeautify && global.MiyaOfflineBeautify.whenPresetsReady) {
            hydrate = hydrate.then(function () {
                return global.MiyaOfflineBeautify.whenPresetsReady();
            });
        }
        /* 封存记录以本地落盘为准；勿每次进入都从线上镜像自动重建。
         * 手动删除会同步清掉线上镜像；「从线上记忆恢复」仅用于本地丢失且镜像仍在的情况。 */
        hydrate
            .then(function () {
                render();
                applyOfflineBeautify();
            })
            .catch(function () {});
    }

    function closeApp() {
        syncSessionOnLeave();
        if (global.MiyaOfflineStatus && global.MiyaOfflineStatus.hideAll) {
            global.MiyaOfflineStatus.hideAll();
        }
        var app = $('miya-offline-app');
        if (!app) return;
        app.classList.remove('is-open');
        app.setAttribute('hidden', '');
        app.setAttribute('aria-hidden', 'true');
        if (!document.querySelector('.miya-beautify-app.is-open') &&
            !document.querySelector('.miya-settings-app.is-open') &&
            !document.querySelector('.miya-worldbook-app.is-open') &&
            !document.querySelector('#miya-music-app.is-open') &&
            !document.querySelector('#miya-chat-app.is-open') &&
            !document.querySelector('.miya-memory-app.is-open') &&
            !document.querySelector('.miya-contacts-app.is-open')) {
            document.body.classList.remove('miya-app-open');
        }
    }

    global.miyaOfflineApp = {
        open: openApp,
        close: closeApp,
        toast: toast,
        rerender: render,
        getStatusContext: getStatusContext,
        contactAvatar: contactAvatar,
        resolveOfflineContactAvatarAsync: resolveOfflineContactAvatarAsync,
        findContactsAppAvatar: findContactsAppAvatar
    };
})(window);
