/**
 * miya-chat-moments.js — 朋友圈/动态
 * 记忆优化：写入 chatSettings.momentsMemoryList，由引擎注入上下文，不污染聊天消息列表
 */
(function (global) {
    'use strict';

    var STORE_KEY = 'miya-moments-v1';
    var MOMENTS_MEMORY_MAX = 12;
    var _cache = null;
    var _ready = null;
    var _generating = {};
    var _imageGenGenerating = {};
    var _autoQueue = [];
    var _autoQueued = {};
    var _autoWorker = false;
    var _autoInFlight = {};
    var _autoTickTimer = null;
    var _autoTickBooted = false;
    var MOMENTS_AUTO_FAIL_COOLDOWN_MS = 300000;
    var MOMENTS_AUTO_SCAN_MS = 5000;
    var MOMENTS_AUTO_SCAN_MS_MOBILE = 30000;
    var MOMENTS_AUTO_MIN_ATTEMPT_GAP_MS = 60000;

    function isMobileDevice() {
        return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
            (navigator.maxTouchPoints > 1 && window.matchMedia('(hover: none)').matches);
    }

    function getAutoScanMs() {
        return isMobileDevice() ? MOMENTS_AUTO_SCAN_MS_MOBILE : MOMENTS_AUTO_SCAN_MS;
    }

    function pickTs(v) {
        var n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function clampInt(v, lo, hi, fb) {
        var n = parseInt(v, 10);
        if (!Number.isFinite(n)) return fb;
        return Math.min(hi, Math.max(lo, n));
    }

    function trimMax(s, max) {
        var t = String(s || '');
        return t.length <= max ? t : t.slice(0, max);
    }

    function uid(prefix) {
        return String(prefix || 'id') + '_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    }

    function esc(t) {
        return String(t || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function avatarFallback(name) {
        var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
        return 'data:image/svg+xml,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0%" stop-color="#F0F0F0"/><stop offset="100%" stop-color="#E0E0E0"/></linearGradient></defs>' +
            '<rect width="80" height="80" rx="40" fill="url(#g)"/>' +
            '<text x="40" y="50" text-anchor="middle" font-family="Georgia,serif" font-size="30" fill="#999999">' + ch + '</text></svg>'
        );
    }

    function isDirectAvatarSrc(key) {
        return /^https?:\/\//i.test(key) || /^data:/i.test(key) || /^blob:/i.test(key);
    }

    function toast(msg) {
        if (global.miyaChatApp && global.miyaChatApp.toast) global.miyaChatApp.toast(msg);
    }

    function dialogPrompt(opts) {
        if (global.miyaDialog && global.miyaDialog.prompt) return global.miyaDialog.prompt(opts);
        var v = window.prompt((opts && opts.title) || '输入', (opts && opts.value) || '');
        return Promise.resolve(v);
    }

    function getStore() {
        return global.miyaChatStore;
    }

    function getApiConfig() {
        if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
        return {};
    }

    function normalizeBaseUrl(base) {
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

    function extractChatText(data) {
        var msg = data && data.choices && data.choices[0] && data.choices[0].message;
        if (!msg) return '';
        var text = msg.content;
        if (typeof text === 'string' && text.trim()) return text.trim();
        if (Array.isArray(text)) {
            return text.map(function (p) { return p && p.text ? String(p.text) : ''; }).join('').trim();
        }
        return '';
    }

    function parseMetaJsonText(raw) {
        var t = String(raw || '').trim();
        var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fence) t = fence[1].trim();
        var start = t.indexOf('{');
        var end = t.lastIndexOf('}');
        if (start >= 0 && end > start) t = t.slice(start, end + 1);
        try { return JSON.parse(t); } catch (e) { return null; }
    }

    function defaultState() {
        return { posts: [], profile: { nickname: '', signature: '', coverBlobId: '', updatedAt: 0 } };
    }

    function normalizePost(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var media = Array.isArray(raw.media) ? raw.media.slice(0, 9).map(function (m) {
            if (!m || typeof m !== 'object') return null;
            if (m.kind === 'real-image') {
                return {
                    kind: 'real-image',
                    imageKey: String(m.imageKey || '').trim(),
                    mime: String(m.mime || 'image/jpeg').trim(),
                    visionSummary: String(m.visionSummary || '').trim(),
                    visionSummaryUpdatedAt: Number(m.visionSummaryUpdatedAt) || 0,
                    sourceDesc: trimMax(String(m.sourceDesc || '').trim(), 2000)
                };
            }
            if (m.kind === 'text-image') {
                var out = { kind: 'text-image', textImageDesc: trimMax(String(m.textImageDesc || '').trim(), 2000) };
                if (m.imageGenPending) out.imageGenPending = true;
                if (m.imageGenFailed) out.imageGenFailed = true;
                return out;
            }
            return null;
        }).filter(Boolean) : [];
        return {
            id: String(raw.id || uid('mom')).trim(),
            createdAt: Number(raw.createdAt) || Date.now(),
            text: trimMax(String(raw.text || '').trim(), 5000),
            location: trimMax(String(raw.location || '').trim(), 80),
            media: media,
            likes: Array.isArray(raw.likes) ? raw.likes.slice() : [],
            comments: Array.isArray(raw.comments) ? raw.comments.slice() : [],
            summonRuns: Array.isArray(raw.summonRuns) ? raw.summonRuns.slice() : [],
            visibilityMode: ['all', 'allow', 'deny'].indexOf(String(raw.visibilityMode || 'all')) >= 0
                ? String(raw.visibilityMode || 'all') : 'all',
            visibilityIds: Array.isArray(raw.visibilityIds)
                ? raw.visibilityIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [],
            authorType: String(raw.authorType || '') === 'role' ? 'role' : 'profile',
            authorId: String(raw.authorId || '').trim(),
            profileId: String(raw.profileId || '').trim(),
            authorNameSnapshot: String(raw.authorNameSnapshot || '').trim(),
            authorAvatarSnapshot: String(raw.authorAvatarSnapshot || '').trim(),
            translationText: trimMax(String(raw.translationText || '').trim(), 5000),
            translationPending: !!raw.translationPending,
            translationFailed: !!raw.translationFailed,
            translationTarget: String(raw.translationTarget || '').trim(),
            translationAt: Number(raw.translationAt) || 0
        };
    }

    function readState() {
        if (_cache) return _cache;
        if (global.miyaSyncReadJsonKey) {
            var raw = global.miyaSyncReadJsonKey(STORE_KEY);
            _cache = normalizeState(raw);
            return _cache;
        }
        _cache = defaultState();
        return _cache;
    }

    function normalizeState(raw) {
        var st = defaultState();
        if (!raw || typeof raw !== 'object') return st;
        st.profile = Object.assign(st.profile, raw.profile || {});
        st.posts = (Array.isArray(raw.posts) ? raw.posts : [])
            .map(normalizePost).filter(function (p) {
                return p && (p.text || (p.media && p.media.length));
            });
        st.posts.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        return st;
    }

    function persist(st) {
        _cache = st;
        if (global.miyaWriteLsJsonKey) {
            return global.miyaWriteLsJsonKey(STORE_KEY, st).then(function () { return st; });
        }
        return Promise.resolve(st);
    }

    function whenReady() {
        if (_ready) return _ready;
        _ready = (global.miyaReadLsJsonKey
            ? global.miyaReadLsJsonKey(STORE_KEY).then(function (raw) {
                _cache = normalizeState(raw);
                return _cache;
            })
            : Promise.resolve(readState())
        ).catch(function () {
            _cache = defaultState();
            return _cache;
        });
        if (global.miyaRegisterKvStore) {
            global.miyaRegisterKvStore({ STORE_KEY: STORE_KEY, whenReady: whenReady });
        }
        return _ready;
    }

    function getPosts() {
        return readState().posts.slice();
    }

    function findPost(postId) {
        var pid = String(postId || '').trim();
        return getPosts().find(function (p) { return p && p.id === pid; }) || null;
    }

    function savePosts(posts) {
        var st = readState();
        st.posts = posts.map(normalizePost).filter(Boolean);
        return persist(st);
    }

    function mutatePost(postId, fn) {
        var st = readState();
        var idx = st.posts.findIndex(function (p) { return p && p.id === postId; });
        if (idx < 0) return Promise.resolve(null);
        var next = normalizePost(Object.assign({}, st.posts[idx]));
        fn(next);
        st.posts[idx] = next;
        return persist(st).then(function () { return next; });
    }

    /** 当前面具作为用户身份（发布/评论时） */
    function getCurrentProfile() {
        var st = getStore();
        return st && st.getActiveProfile ? st.getActiveProfile() : null;
    }

    function getUserIdForMoments(profile) {
        var p = profile || getCurrentProfile();
        return p && p.id ? String(p.id) : 'user';
    }

    function getUserNameForMoments(profile) {
        var p = profile || getCurrentProfile();
        return (p && p.name ? String(p.name).trim() : '') || '我';
    }

    function resolveContactName(contact) {
        if (!contact) return '';
        return String(contact.remarkName || contact.name || '').trim();
    }

    function resolveChronicleId(contact) {
        if (!contact) return '';
        return String(contact.chronicleId || contact.characterId || '').trim();
    }

    /** 动态仅展示联系人档案头像，不使用聊天内快捷更换的 displayAvatar */
    function resolveContactArchiveAvatarFromChronicle(contact) {
        var cs = global.miyaContactsStore;
        var cid = resolveChronicleId(contact);
        if (cs && cid && cs.findCharacter) {
            var row = cs.findCharacter(cid);
            if (row && row.avatar) return String(row.avatar).trim();
        }
        return '';
    }

    function resolveContactAvatarKey(st, contact) {
        if (!contact) return '';
        var av = String(contact.avatar || '').trim();
        if (av) return av;
        if (contact.avatarBlobId) return String(contact.avatarBlobId).trim();
        return resolveContactArchiveAvatarFromChronicle(contact);
    }

    function resolveProfileAvatarKey(st, profile) {
        if (!profile) return '';
        if (profile.avatarUrl) return String(profile.avatarUrl).trim();
        if (profile.avatarId) return String(profile.avatarId).trim();
        return '';
    }

    function resolveProfileArchiveAvatarAsync(st, profile) {
        if (!profile) return Promise.resolve('');
        var url = profile.avatarUrl ? String(profile.avatarUrl).trim() : '';
        if (url) return Promise.resolve(url);
        var avatarId = profile.avatarId ? String(profile.avatarId).trim() : '';
        if (avatarId && st && typeof st.getAvatarUrl === 'function') {
            return st.getAvatarUrl(avatarId).catch(function () { return ''; });
        }
        return Promise.resolve('');
    }

    function resolveContactArchiveAvatarAsync(st, contact) {
        if (!contact) return Promise.resolve('');
        var url = String(contact.avatar || '').trim();
        if (url && isDirectAvatarSrc(url)) return Promise.resolve(url);
        var blobId = contact.avatarBlobId ? String(contact.avatarBlobId).trim() : '';
        if (blobId && st && typeof st.getAvatarUrl === 'function') {
            return st.getAvatarUrl(blobId).then(function (u) {
                return u || resolveContactArchiveAvatarFromChronicle(contact);
            }).catch(function () {
                return resolveContactArchiveAvatarFromChronicle(contact);
            });
        }
        return Promise.resolve(resolveContactArchiveAvatarFromChronicle(contact));
    }

    function resolveContactTrueName(st, contactId) {
        var st0 = st || getStore();
        var c = st0 && st0.findContact ? st0.findContact(contactId) : null;
        if (!c) return '';
        var cs = global.miyaContactsStore;
        var cid = resolveChronicleId(c);
        if (cs && cid && cs.findCharacter) {
            var row = cs.findCharacter(cid);
            if (row && row.name) return String(row.name).trim();
        }
        return resolveContactName(c);
    }

    function resolvePostOwnerName(post) {
        if (!post) return '';
        if (post.authorType === 'role') {
            return post.authorNameSnapshot || resolveContactTrueName(null, post.authorId) || '角色';
        }
        return post.authorNameSnapshot || getUserNameForMoments();
    }

    function resolvePostOwnerId(post) {
        if (!post) return getUserIdForMoments();
        if (post.authorType === 'role') return String(post.authorId || '').trim();
        return String(post.authorId || post.profileId || getUserIdForMoments());
    }

    function summarizePostForMemory(post) {
        if (!post) return '';
        var parts = [trimMax(String(post.text || '').trim(), 120)];
        if (post.location) parts.push('📍' + post.location);
        if (Array.isArray(post.media) && post.media.length) {
            var md = post.media.map(function (m) {
                if (!m) return '';
                if (m.kind === 'text-image') return '文字图：' + (m.textImageDesc || '');
                if (m.kind === 'real-image') return '图片：' + (resolveRealImageSummary(m) || '真实图片');
                return '';
            }).filter(Boolean).join('；');
            if (md) parts.push(md);
        }
        return parts.filter(Boolean).join(' / ');
    }

    function resolveChatIdForContact(contactId, profileId) {
        var st = getStore();
        if (!st) return null;
        var pid = profileId || (getCurrentProfile() && getCurrentProfile().id) || '';
        var chat = st.findChatByContact ? st.findChatByContact(contactId, pid) : null;
        if (chat) return chat.id;
        var all = st.getChats ? st.getChats('all') : [];
        var hit = all.find(function (c) { return c && c.contactId === contactId; });
        return hit ? hit.id : null;
    }

    function hasChatWithContact(contactId, profileId) {
        return !!resolveChatIdForContact(contactId, profileId);
    }

    function isContactBoundToProfile(contactId, profileId) {
        var st = getStore();
        if (!st || !contactId || !profileId) return false;
        var contact = st.findContact ? st.findContact(contactId) : null;
        if (!contact) return false;
        return String(contact.defaultProfileId || '').trim() === String(profileId).trim();
    }

    function appendMomentsMemory(contactId, entry, profileId) {
        var st = getStore();
        if (!st || !contactId) return Promise.resolve();
        var chatId = resolveChatIdForContact(contactId, profileId);
        if (!chatId) return Promise.resolve();
        var settings = st.getChatSettings ? st.getChatSettings(chatId) : {};
        var list = Array.isArray(settings.momentsMemoryList) ? settings.momentsMemoryList.slice() : [];
        list.push({
            id: uid('mmem'),
            at: Number(entry.at) || Date.now(),
            kind: String(entry.kind || 'comment').trim(),
            perspective: String(entry.perspective || 'observer').trim(),
            postId: String(entry.postId || '').trim(),
            summary: trimMax(String(entry.summary || '').trim(), 280)
        });
        if (list.length > MOMENTS_MEMORY_MAX) list = list.slice(-MOMENTS_MEMORY_MAX);
        return st.saveChatSettings(chatId, { momentsMemoryList: list });
    }

    function buildMemorySummary(kind, post, text, opts) {
        opts = opts || {};
        var owner = resolvePostOwnerName(post);
        var content = summarizePostForMemory(post);
        var actor = String(opts.actorName || '').trim() || '某人';
        var tail = String(text || '').trim();
        if (kind === 'post') return '你发布了朋友圈【' + content + '】';
        if (kind === 'like') {
            if (opts.perspective === 'target') return actor + '点赞了你的朋友圈【' + content + '】';
            return '你点赞了' + owner + '的朋友圈【' + content + '】';
        }
        if (kind === 'comment') {
            if (opts.perspective === 'target') return actor + '评论了你的朋友圈【' + content + '】' + (tail ? ('：' + tail) : '');
            return '你评论了' + owner + '的朋友圈【' + content + '】' + (tail ? ('：' + tail) : '');
        }
        if (kind === 'reply') {
            var toName = String(opts.toAuthorName || '对方').trim();
            if (opts.perspective === 'target') return actor + '回复了你的评论【' + content + '】' + (tail ? ('：' + tail) : '');
            if (opts.isPostOwnerActor) {
                return '你在自己的朋友圈下回复了' + toName + '【' + content + '】' + (tail ? ('：' + tail) : '');
            }
            return '你回复了' + owner + '的朋友圈评论（回复' + toName + '）【' + content + '】' + (tail ? ('：' + tail) : '');
        }
        return '朋友圈互动【' + content + '】';
    }

    function injectMemoryForRole(roleId, kind, post, text, opts) {
        opts = opts || {};
        if (!roleId || !post) return Promise.resolve();
        if (!isPostVisibleToRole(post, roleId)) return Promise.resolve();
        var summary = buildMemorySummary(kind, post, text, opts);
        return appendMomentsMemory(roleId, {
            kind: kind, postId: post.id, summary: summary,
            perspective: opts.perspective || 'actor', at: Date.now()
        }, opts.profileId);
    }

    function injectMemoryForPostOwner(post, actorName, kind, text, toAuthorName, actorId) {
        if (!post) return Promise.resolve();
        var ownerId = resolvePostOwnerId(post);
        var uid0 = getUserIdForMoments();
        if (post.authorType !== 'role') return Promise.resolve();
        if (String(actorId || '') === ownerId) return Promise.resolve();
        return injectMemoryForRole(ownerId, kind, post, text, {
            perspective: 'target', actorName: actorName, toAuthorName: toAuthorName
        });
    }

    function injectMemoryForObserver(observerId, kind, post, text, actorId, actorName, toAuthorId, toAuthorName) {
        if (!observerId || !post) return Promise.resolve();
        var ownerId = resolvePostOwnerId(post);
        if (String(observerId) === ownerId) return Promise.resolve();
        if (String(observerId) === String(actorId || '')) return Promise.resolve();
        if (!isPostVisibleToRole(post, observerId)) return Promise.resolve();
        var summary = buildMemorySummary(kind, post, text, {
            perspective: 'observer', actorName: actorName, toAuthorName: toAuthorName
        });
        return appendMomentsMemory(observerId, {
            kind: kind, postId: post.id, summary: summary, perspective: 'observer', at: Date.now()
        });
    }

    function buildMomentsContextBlock(chatSettings) {
        if (chatSettings && chatSettings.momentsMemoryInterop === false) return '';
        var list = chatSettings && Array.isArray(chatSettings.momentsMemoryList)
            ? chatSettings.momentsMemoryList : [];
        if (!list.length) return '';
        var lines = list.slice(-MOMENTS_MEMORY_MAX).map(function (row, i) {
            var body = String((row && row.summary) || '').trim();
            if (!body) return '';
            return '【朋友圈记忆' + (i + 1) + '】\n' + body;
        }).filter(Boolean);
        if (!lines.length) return '';
        return '【朋友圈·近期互动记忆】\n以下为你近期在朋友圈的相关经历（非聊天消息，仅供延续关系与语气）：\n\n' + lines.join('\n\n');
    }

    function getRelStore() {
        return global.miyaContactsRelationshipStore;
    }

    function charIdForContact(contact) {
        return resolveChronicleId(contact);
    }

    function archiveGroupIdForContact(contact) {
        if (!contact) return '';
        var cs = global.miyaContactsStore;
        var cid = resolveChronicleId(contact);
        if (cs && cid && cs.findCharacter) {
            var row = cs.findCharacter(cid);
            if (row && row.groupId) return String(row.groupId).trim();
        }
        var chatGid = String(contact.groupId || '').trim();
        if (!chatGid) return '';
        if (chatGid === 'ct-default') return 'ct_default';
        if (chatGid.indexOf('arch-') === 0) return chatGid.slice(5);
        return '';
    }

    function relationBetweenContacts(aContact, bContact) {
        var rs = getRelStore();
        if (!rs || !aContact || !bContact) return '';
        var aChar = charIdForContact(aContact);
        var bChar = charIdForContact(bContact);
        if (!aChar || !bChar) return '';
        if (aContact.groupId && bContact.groupId && aContact.groupId !== bContact.groupId) return '';
        var gid = archiveGroupIdForContact(aContact) || archiveGroupIdForContact(bContact);
        return rs.getRelation ? rs.getRelation(aChar, bChar, gid) : '';
    }

    function hasRelationWithContact(aContactId, bContactId) {
        var st = getStore();
        if (!st || !aContactId || !bContactId) return false;
        if (String(aContactId) === String(bContactId)) return true;
        var a = st.findContact ? st.findContact(aContactId) : null;
        var b = st.findContact ? st.findContact(bContactId) : null;
        return !!relationBetweenContacts(a, b);
    }

    function canSummonCommentOnPost(post, commenterContactId) {
        if (!post || !commenterContactId) return false;
        var ownerId = resolvePostOwnerId(post);
        if (String(commenterContactId) === String(ownerId)) return false;
        if (post.authorType === 'profile') {
            var postProfileId = String(post.profileId || post.authorId || '').trim();
            return isContactBoundToProfile(commenterContactId, postProfileId);
        }
        if (post.authorType === 'role') {
            return hasRelationWithContact(commenterContactId, ownerId);
        }
        return false;
    }

    function listRelatedContactIds(contactId, contactById) {
        var c = contactById && contactById[contactId];
        if (!c) return [];
        var charId = charIdForContact(c);
        if (!charId) return [];
        var rs = getRelStore();
        if (!rs || !rs.listRelationsForCharacter) return [];
        var out = [];
        var seen = {};
        (rs.listRelationsForCharacter(charId) || []).forEach(function (e) {
            var toCharId = String(e.toId || '').trim();
            if (!toCharId) return;
            Object.keys(contactById).forEach(function (cid) {
                if (seen[cid] || String(cid) === String(contactId)) return;
                var row = contactById[cid];
                if (!row || charIdForContact(row) !== toCharId) return;
                if (row.groupId && c.groupId && row.groupId !== c.groupId) return;
                seen[cid] = true;
                out.push(cid);
            });
        });
        return out;
    }

    function canJoinExpandedCommentSection(post, contactId, seedIds) {
        if (!post || !contactId) return false;
        var ownerId = resolvePostOwnerId(post);
        if (String(contactId) === String(ownerId)) return false;
        if (post.authorType === 'profile') {
            var postProfileId = String(post.profileId || post.authorId || '').trim();
            if (!isContactBoundToProfile(contactId, postProfileId)) return false;
        }
        if (canSummonCommentOnPost(post, contactId)) return true;
        var seeds = Array.isArray(seedIds) ? seedIds : [];
        return seeds.some(function (sid) {
            return sid && hasRelationWithContact(contactId, sid);
        });
    }

    function expandAuthorIdsByNetwork(seedIds, contactById, post, postOwnerId, maxDepth) {
        var depthLimit = maxDepth == null ? 2 : maxDepth;
        var seen = {};
        var depth = {};
        var out = [];
        var queue = [];
        (seedIds || []).forEach(function (id) {
            var sid = String(id || '').trim();
            if (!sid || seen[sid]) return;
            seen[sid] = true;
            depth[sid] = 0;
            out.push(sid);
            queue.push(sid);
        });
        while (queue.length) {
            var cur = queue.shift();
            var curDepth = depth[cur] || 0;
            if (curDepth >= depthLimit) continue;
            listRelatedContactIds(cur, contactById).forEach(function (rid) {
                var ridStr = String(rid || '').trim();
                if (!ridStr || seen[ridStr]) return;
                if (!canJoinExpandedCommentSection(post, ridStr, seedIds)) return;
                seen[ridStr] = true;
                depth[ridStr] = curDepth + 1;
                out.push(ridStr);
                queue.push(ridStr);
            });
        }
        out = out.filter(function (id) { return String(id) !== String(postOwnerId); });
        if (post.authorType === 'role') {
            var roleOwnerId = String(postOwnerId || '').trim();
            if (roleOwnerId && contactById[roleOwnerId] && out.indexOf(roleOwnerId) < 0) {
                out.unshift(roleOwnerId);
            }
        }
        return out;
    }

    function buildVisibilityGraph(contacts) {
        var uid0 = getUserIdForMoments();
        var list = Array.isArray(contacts) ? contacts : [];
        var visibleByCid = {};
        var relLabelByPair = {};
        list.forEach(function (c) {
            if (!c || !c.id) return;
            var cid = String(c.id);
            var visible = {};
            visible[uid0] = true;
            visible[cid] = true;
            list.forEach(function (other) {
                if (!other || !other.id) return;
                var ocid = String(other.id);
                if (ocid === cid) return;
                if (c.groupId && other.groupId && c.groupId !== other.groupId) return;
                var label = relationBetweenContacts(c, other);
                if (!label) return;
                visible[ocid] = true;
                var pair = [cid, ocid].sort().join('↔');
                relLabelByPair[pair] = label;
            });
            visibleByCid[cid] = visible;
        });
        return { visibleByCid: visibleByCid, relLabelByPair: relLabelByPair };
    }

    function isVisibleToAuthor(visGraph, authorId, otherAuthorId) {
        var aid = String(authorId || '').trim();
        var oid = String(otherAuthorId || '').trim();
        if (!aid || !oid) return false;
        if (aid === oid) return true;
        var uid0 = getUserIdForMoments();
        if (oid === uid0 || aid === uid0) return true;
        var vis = visGraph && visGraph.visibleByCid ? visGraph.visibleByCid[aid] : null;
        return !!(vis && vis[oid]);
    }

    function isPostVisibleToRole(post, roleId) {
        if (!post || !roleId) return false;
        if (post.authorType === 'role' && String(post.authorId) === String(roleId)) return true;
        var st = getStore();
        var uid0 = getUserIdForMoments();
        var ownerId = resolvePostOwnerId(post);
        if (String(roleId) === uid0) return true;

        if (post.authorType === 'profile') {
            var postProfileId = String(post.profileId || post.authorId || '').trim();
            if (!isContactBoundToProfile(roleId, postProfileId)) return false;
            var mode0 = String(post.visibilityMode || 'all');
            var visSet0 = {};
            (post.visibilityIds || []).forEach(function (id) { visSet0[String(id)] = true; });
            if (mode0 === 'allow') return !!visSet0[String(roleId)];
            if (mode0 === 'deny') return !visSet0[String(roleId)];
            return true;
        }

        var contacts = st && st.getContacts ? st.getContacts() : [];
        var visGraph = buildVisibilityGraph(contacts);
        if (ownerId && visGraph.visibleByCid[ownerId] && visGraph.visibleByCid[ownerId][String(roleId)]) return true;
        if (visGraph.visibleByCid[String(roleId)] && visGraph.visibleByCid[String(roleId)][ownerId]) return true;
        var mode = String(post.visibilityMode || 'all');
        var visSet = {};
        (post.visibilityIds || []).forEach(function (id) { visSet[String(id)] = true; });
        if (mode === 'allow') return !!visSet[String(roleId)];
        if (mode === 'deny') return !visSet[String(roleId)];
        return true;
    }

    function filterPostsForFeed(posts) {
        var st = getStore();
        var contacts = st && st.getContacts ? st.getContacts() : [];
        var contactIds = {};
        contacts.forEach(function (c) { if (c && c.id) contactIds[c.id] = true; });
        return posts.filter(function (p) {
            if (!p) return false;
            if (p.authorType === 'role') return !!contactIds[p.authorId];
            if (p.authorType === 'profile') return true;
            return false;
        });
    }

    function formatRelativeTime(ts) {
        var t = Number(ts) || Date.now();
        var diff = Date.now() - t;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
        try {
            return new Date(t).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        } catch (e) {
            return '';
        }
    }

    function buildChronicleBlock(contact) {
        var eng = global.miyaChatEngine;
        if (eng && typeof eng.buildSystemPrompt === 'function') {
            /* use internal helper via contacts store */
        }
        var cs = global.miyaContactsStore;
        var cid = resolveChronicleId(contact);
        if (cs && cid && typeof cs.renderChronicleBlock === 'function') {
            return String(cs.renderChronicleBlock(cid) || '').trim();
        }
        return '';
    }

    function buildRecentChatContext(contactId, maxN) {
        var st = getStore();
        if (!st) return '无';
        var chatId = resolveChatIdForContact(contactId);
        if (!chatId) return '无';
        var rows = st.getMessagesForApi ? st.getMessagesForApi(chatId).slice(-(maxN || 20)) : [];
        if (!rows.length) return '无';
        var contact = st.findContact(contactId);
        var profile = getCurrentProfile();
        var fmt = global.MiyaChatOnlineFormat;
        return rows.map(function (m) {
            if (!m || m.deleted) return '';
            var body = fmt && fmt.formatMessageForApi ? fmt.formatMessageForApi(m) : String(m.content || '').trim();
            if (!body) return '';
            var who = m.role === 'user'
                ? (profile && profile.name ? profile.name : '我')
                : (contact && resolveContactName(contact)) || '角色';
            return who + '：' + body;
        }).filter(Boolean).join('\n') || '无';
    }

    function buildRelationshipLine(contact) {
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.buildRelationshipLine === 'function') {
            var st = getStore();
            var chatId = resolveChatIdForContact(contact && contact.id);
            var settings = chatId && st.getChatSettings ? st.getChatSettings(chatId) : {};
            return aw.buildRelationshipLine(settings, contact) || '';
        }
        return '你们当前的关系是：' + (String((contact && contact.relationship) || '朋友').trim() || '朋友');
    }

    function resolveRealImageSummary(m) {
        if (!m || m.kind !== 'real-image') return '';
        return String(m.visionSummary || m.sourceDesc || '').trim();
    }

    function isGeneratedRealImage(m) {
        return !!(m && m.kind === 'real-image' && String(m.sourceDesc || '').trim());
    }

    function realImageNeedsVision(m) {
        if (!m || m.kind !== 'real-image') return false;
        if (String(m.visionSummary || '').trim()) return false;
        if (isGeneratedRealImage(m)) return false;
        return !!String(m.imageKey || '').trim();
    }

    async function blobIdToDataUrl(blobKey) {
        var st = getStore();
        var imgApi = global.MiyaChatImage;
        var key = String(blobKey || '').trim();
        if (!key || !st || typeof st.getAvatarUrl !== 'function') return '';
        try {
            var url = await st.getAvatarUrl(key);
            if (!url) return '';
            var res = await fetch(url);
            if (!res.ok) return '';
            var blob = await res.blob();
            if (imgApi && typeof imgApi.readBlobAsDataUrl === 'function') {
                return await imgApi.readBlobAsDataUrl(blob);
            }
            return '';
        } catch (e) {
            return '';
        }
    }

    function applyVisionSummaryToMediaItem(m, summary) {
        var text = String(summary || '').trim();
        if (!m || !text) return false;
        m.visionSummary = text;
        m.visionSummaryUpdatedAt = Date.now();
        return true;
    }

    async function ensureVisionForMedia(post, apiCfg) {
        var imgApi = global.MiyaChatImage;
        var st = getStore();
        if (!imgApi || !st || typeof imgApi.recognizeImageBlobId !== 'function') {
            return { summaryUpdated: false, expectedRealImages: 0, summaryReadyCount: 0, missingSummaryIndices: [] };
        }
        var updated = false;
        var expected = 0;
        var ready = 0;
        var missing = [];
        var pending = [];
        var media = Array.isArray(post.media) ? post.media : [];
        for (var i = 0; i < media.length; i++) {
            var m = media[i];
            if (!m || m.kind !== 'real-image') continue;
            expected++;
            if (String(m.visionSummary || '').trim()) {
                ready++;
                continue;
            }
            if (isGeneratedRealImage(m)) {
                if (applyVisionSummaryToMediaItem(m, m.sourceDesc)) updated = true;
                ready++;
                continue;
            }
            var key = String(m.imageKey || '').trim();
            if (!key) {
                missing.push(i + 1);
                continue;
            }
            if (realImageNeedsVision(m)) pending.push({ index: i, key: key, media: m });
        }
        if (pending.length && typeof imgApi.recognizeImageBatchBlobIds === 'function') {
            try {
                var batchSummaries = await imgApi.recognizeImageBatchBlobIds(
                    st,
                    pending.map(function (row) { return row.key; }),
                    {}
                );
                pending.forEach(function (row, idx) {
                    var summary = batchSummaries && batchSummaries[idx];
                    if (applyVisionSummaryToMediaItem(row.media, summary)) {
                        updated = true;
                        ready++;
                    } else {
                        missing.push(row.index + 1);
                    }
                });
            } catch (eBatch) {
                for (var pi = 0; pi < pending.length; pi++) {
                    var rowOne = pending[pi];
                    try {
                        var summaryOne = await imgApi.recognizeImageBlobId(st, rowOne.key, {});
                        if (applyVisionSummaryToMediaItem(rowOne.media, summaryOne)) {
                            updated = true;
                            ready++;
                        } else {
                            missing.push(rowOne.index + 1);
                        }
                    } catch (eOne) {
                        missing.push(rowOne.index + 1);
                    }
                }
            }
        } else {
            for (var si = 0; si < pending.length; si++) {
                var rowSeq = pending[si];
                try {
                    var summarySeq = await imgApi.recognizeImageBlobId(st, rowSeq.key, {});
                    if (applyVisionSummaryToMediaItem(rowSeq.media, summarySeq)) {
                        updated = true;
                        ready++;
                    } else {
                        missing.push(rowSeq.index + 1);
                    }
                } catch (eSeq) {
                    missing.push(rowSeq.index + 1);
                }
            }
        }
        return { summaryUpdated: updated, expectedRealImages: expected, summaryReadyCount: ready, missingSummaryIndices: missing };
    }

    async function buildMediaBundle(post, apiCfg) {
        var textLines = [];
        var imageParts = [];
        var attached = 0;
        var media = Array.isArray(post.media) ? post.media : [];
        for (var i = 0; i < media.length; i++) {
            var m = media[i];
            if (!m) continue;
            if (m.kind === 'text-image') {
                textLines.push('配图' + (i + 1) + '（文字图）：' + (m.textImageDesc || ''));
            } else if (m.kind === 'real-image') {
                var fromGen = isGeneratedRealImage(m);
                var sum = resolveRealImageSummary(m);
                var lineSuffix = sum || (fromGen ? '未识别' : '见下方附件图片，请仔细观看后再评论');
                textLines.push('配图' + (i + 1) + (fromGen ? '（生图）' : '（真实图片）') + '：' + lineSuffix);
                if (!fromGen && m.imageKey) {
                    var dataUrl = await blobIdToDataUrl(m.imageKey);
                    if (dataUrl && /^data:image\//i.test(dataUrl)) {
                        imageParts.push({ type: 'image_url', image_url: { url: dataUrl } });
                        attached++;
                    }
                }
            }
        }
        var expectedRealImages = media.filter(function (x) {
            return x && x.kind === 'real-image' && !isGeneratedRealImage(x);
        }).length;
        return {
            textBlock: textLines.length ? ('【配图信息】\n' + textLines.join('\n')) : '',
            imageParts: imageParts,
            expectedRealImages: expectedRealImages,
            attachedRealImages: attached,
            strictNoGuess: attached < expectedRealImages
        };
    }

    function createRolePostFromIntent(contactId, intent, injectOpts) {
        injectOpts = injectOpts || {};
        var st = getStore();
        if (!st) return false;
        var cid = String(contactId || '').trim();
        var contact = st.findContact ? st.findContact(cid) : null;
        if (!contact || !intent) return false;
        var text = trimMax(String(intent.text || '').trim(), 5000);
        if (!text) return false;
        var images = Array.isArray(intent.images) ? intent.images : [];
        var albumRefs = Array.isArray(intent.albumRefs) ? intent.albumRefs : [];
        var profile = getCurrentProfile();
        var profileId = profile && profile.id ? String(profile.id) : '';
        var igEnabled = !!(
            global.MiyaImageGen &&
            typeof global.MiyaImageGen.isContactEnabled === 'function' &&
            global.MiyaImageGen.isContactEnabled(cid)
        );
        var media = [];
        var slotMap = {};
        images.slice(0, 9).forEach(function (desc, idx) {
            slotMap[idx + 1] = {
                kind: 'text-image',
                textImageDesc: trimMax(String(desc || '').trim(), 2000),
                imageGenPending: igEnabled
            };
        });
        albumRefs.forEach(function (ref) {
            if (!ref || !profileId || !global.MiyaChatAlbum) return;
            var slot = parseInt(ref.slot, 10);
            var albumIndex = parseInt(ref.albumIndex, 10);
            if (!slot || slot < 1 || slot > 9 || !albumIndex) return;
            var resolved = global.MiyaChatAlbum.resolveAlbumMediaForMoments(profileId, albumIndex, cid);
            if (resolved) slotMap[slot] = resolved;
        });
        Object.keys(slotMap)
            .sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); })
            .forEach(function (key) {
                var item = slotMap[key];
                if (!item) return;
                if (item.kind === 'text-image' && !item.textImageDesc) return;
                media.push(item);
            });
        var post = normalizePost({
            id: uid('mom'),
            createdAt: Date.now(),
            text: text,
            media: media,
            authorType: 'role',
            authorId: cid,
            authorNameSnapshot: resolveContactTrueName(st, cid) || resolveContactName(contact),
            authorAvatarSnapshot: '',
            visibilityMode: 'all'
        });
        post.authorAvatarSnapshot = resolveContactAvatarKey(st, contact);
        var trMod = global.MiyaChatTranslate;
        if (trMod && typeof trMod.applyMomentsTranslationOnCreate === 'function') {
            post = trMod.applyMomentsTranslationOnCreate(post, cid, intent);
        }
        var posts = getPosts();
        posts.unshift(post);
        var saveChain = savePosts(posts).then(function () {
            if (!injectOpts.skipAutoStateTouch) {
                touchMomentsAutoAfterRolePost(cid);
            }
            injectMemoryForRole(cid, 'post', post, '', { perspective: 'actor' });
            refreshFeedUI();
            if (!injectOpts.skipAutoSummon) {
                summonCommentsForPost(post.id).catch(function () {});
            }
            if (
                igEnabled &&
                global.MiyaImageGen &&
                typeof global.MiyaImageGen.processMomentTextImages === 'function' &&
                media.some(function (m) { return m && m.kind === 'text-image'; })
            ) {
                global.MiyaImageGen.processMomentTextImages(post.id, cid).catch(function () {});
            }
            return post;
        });
        return saveChain;
    }

    function optimisticToggleLikeUi(postId) {
        var listEl = document.getElementById('qq-feed-list');
        if (!listEl) return;
        var card = listEl.querySelector('[data-mm-post-id="' + cssAttrEscape(postId) + '"]');
        if (!card) return;
        var likeBtn = card.querySelector('[data-mm-like-post]');
        if (!likeBtn) return;
        var liked = likeBtn.classList.contains('is-liked');
        var nextLiked = !liked;
        likeBtn.classList.toggle('is-liked', nextLiked);
        replaceFeedActionIcon(likeBtn, mmIcon('heart', nextLiked));
        var countEl = likeBtn.querySelector('.mm-feed-action__count');
        var count = countEl ? parseInt(countEl.textContent, 10) || 0 : 0;
        setFeedActionCount(likeBtn, Math.max(0, count + (nextLiked ? 1 : -1)));
    }

    function toggleLike(postId) {
        var profile = getCurrentProfile();
        var uid0 = getUserIdForMoments(profile);
        var uname = getUserNameForMoments(profile);
        var wasLiked = false;
        var postBefore = findPost(postId);
        if (postBefore && postBefore.likes) {
            wasLiked = postBefore.likes.some(function (l) {
                return l && String(l.id || l.userId || '') === uid0;
            });
        }
        optimisticToggleLikeUi(postId);
        return mutatePost(postId, function (post) {
            if (!Array.isArray(post.likes)) post.likes = [];
            var idx = post.likes.findIndex(function (l) {
                return l && String(l.id || l.userId || '') === uid0;
            });
            if (idx >= 0) post.likes.splice(idx, 1);
            else post.likes.push({ id: uid0, name: uname, at: Date.now() });
        }).then(function (updated) {
            if (updated && !wasLiked && updated.likes.some(function (l) {
                return String(l.id || l.userId || '') === uid0;
            })) {
                injectMemoryForPostOwner(updated, uname, 'like', '', '', uid0);
            }
            refreshFeedUI({ postId: postId, mediaChanged: false, scroll: false });
        }).catch(function () {
            refreshFeedUI({ postId: postId, mediaChanged: false, scroll: false });
        });
    }

    function promptComment(postId, toCommentId) {
        var post = findPost(postId);
        if (!post) return Promise.resolve();
        var profile = getCurrentProfile();
        var uid0 = getUserIdForMoments(profile);
        var uname = getUserNameForMoments(profile);
        return dialogPrompt({
            title: toCommentId ? '回复评论' : '发表评论',
            placeholder: '写点什么…',
            value: ''
        }).then(function (raw) {
            if (raw == null) return;
            var text = String(raw || '').trim();
            if (!text) return;
            var replyTo = null;
            if (toCommentId) {
                replyTo = (post.comments || []).find(function (c) {
                    return c && String(c.id) === String(toCommentId);
                }) || null;
                if (replyTo && post.authorType === 'role') {
                    var targetAuthorId = String(replyTo.authorId || '').trim();
                    var isUser = targetAuthorId === uid0;
                    var st = getStore();
                    var isFriend = st && st.findContact && !!st.findContact(targetAuthorId);
                    if (!isUser && !isFriend) {
                        toast('你们还不是好友，无法评论哦');
                        return;
                    }
                }
            }
            var newId = uid('c');
            return mutatePost(postId, function (p) {
                if (!Array.isArray(p.comments)) p.comments = [];
                if (!Array.isArray(p.likes)) p.likes = [];
                p.comments.push({
                    id: newId,
                    authorId: uid0,
                    authorName: uname,
                    toCommentId: replyTo ? String(replyTo.id) : '',
                    toAuthorId: replyTo ? String(replyTo.authorId) : '',
                    toAuthorName: replyTo ? String(replyTo.authorName) : '',
                    text: text,
                    createdAt: Date.now()
                });
                if (!p.likes.some(function (l) { return String(l.id || l.userId || '') === uid0; })) {
                    p.likes.push({ id: uid0, name: uname, at: Date.now() });
                }
            }).then(function (updated) {
                refreshFeedUI({ postId: postId, mediaChanged: false, scroll: false });
                injectMemoryForPostOwner(updated, uname, replyTo ? 'reply' : 'comment', text, replyTo ? replyTo.authorName : '', uid0);
                var roleId = '';
                if (replyTo) roleId = String(replyTo.authorId || '').trim();
                else if (updated.authorType === 'role') roleId = String(updated.authorId || '').trim();
                if (roleId && roleId !== uid0 && getStore().findContact(roleId)) {
                    return generateRoleReplyToUserComment(postId, newId, roleId);
                }
            });
        });
    }

    function buildRoleWorldbookPromptBlocks(contact) {
        var eng = global.miyaChatEngine;
        if (!eng || !contact || typeof eng.buildWorldbookBundle !== 'function') {
            return [];
        }
        var bundle = eng.buildWorldbookBundle(contact, '', null, { promptContext: 'general' });
        return (bundle.layers || []).filter(Boolean);
    }

    async function generateRoleReplyToUserComment(postId, userCommentId, roleId) {
        var post = findPost(postId);
        if (!post) return;
        var profile = getCurrentProfile();
        var uid0 = getUserIdForMoments(profile);
        var uname = getUserNameForMoments(profile);
        var rid = String(roleId || '').trim();
        if (!rid || rid === uid0) return;
        var userC = (post.comments || []).find(function (c) { return c && c.id === userCommentId; });
        if (!userC) return;
        var cfg = getApiConfig();
        var base = normalizeBaseUrl(cfg.baseUrl);
        var model = String(cfg.model || '').trim();
        if (!base || !model || !cfg.apiKey) return;
        if (Array.isArray(post.media) && post.media.some(realImageNeedsVision)) {
            toast('正在识别配图…');
        }
        var vis = await ensureVisionForMedia(post, cfg);
        if (vis.summaryUpdated) await mutatePost(postId, function (p) { p.media = post.media; });
        var mediaBundle = await buildMediaBundle(post, cfg);
        var st = getStore();
        var contact = st.findContact(rid);
        var roleName = resolveContactTrueName(st, rid) || resolveContactName(contact);
        var roleProfile = buildChronicleBlock(contact);
        var wbBlocks = buildRoleWorldbookPromptBlocks(contact);
        var relLine = buildRelationshipLine(contact);
        var recentChat = buildRecentChatContext(rid, 20);
        var postOwnerName = resolvePostOwnerName(post);
        var postOwnerId = resolvePostOwnerId(post);
        var prompt = [
            '你正在模拟微信朋友圈评论区的角色回复。输出必须是合法 JSON，不要输出任何额外文本。',
            '只返回：{"reply":{"id":"","authorId":"","authorName":"","toCommentId":"","toAuthorId":"","text":""}}',
            '- authorId 必须等于 ' + rid + '；authorName 用 ' + roleName + '。',
            '- toCommentId=' + userCommentId + '；toAuthorId=' + uid0 + '（' + uname + '）。',
            '- 严格符合角色人设；发帖人是 ' + postOwnerName + '（id=' + postOwnerId + '）。',
            '- 本条动态 id=' + postId + '；回复须紧扣本条动态与用户本条评论，禁止复用其他动态下的回复文案。',
            '',
            '【角色档案】', roleProfile || '(无档案)',
            wbBlocks.length ? wbBlocks.join('\n\n') : '',
            relLine,
            '【最近私聊】', recentChat,
            '',
            '【动态】', String(post.text || ''),
            '定位：' + (post.location || '无'),
            mediaBundle.textBlock,
            '',
            '【用户评论】', uname + '：' + String(userC.text || '')
        ].join('\n');
        var req = (function () {
            var eng = global.miyaChatEngine;
            var msgs = [
                { role: 'system', content: '你是朋友圈评论生成器，不可串角色。' },
                {
                    role: 'user',
                    content: mediaBundle.imageParts.length
                        ? [{ type: 'text', text: prompt }].concat(mediaBundle.imageParts)
                        : prompt
                }
            ];
            return eng && typeof eng.prependUniversalWorldbookMessage === 'function'
                ? eng.prependUniversalWorldbookMessage(msgs)
                : msgs;
        })();
        var r = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
            body: JSON.stringify({ model: model, temperature: 0.75, messages: req })
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var parsed = parseMetaJsonText(extractChatText(await r.json()));
        var rep = parsed && parsed.reply;
        if (!rep || !String(rep.text || '').trim()) return;
        await mutatePost(postId, function (p) {
            if (!Array.isArray(p.comments)) p.comments = [];
            if (!Array.isArray(p.likes)) p.likes = [];
            p.comments.push({
                id: String(rep.id || uid('r')),
                authorId: rid,
                authorName: roleName,
                toCommentId: userCommentId,
                toAuthorId: uid0,
                toAuthorName: uname,
                text: String(rep.text).trim(),
                createdAt: Date.now()
            });
            if (!p.likes.some(function (l) { return String(l.id || l.userId || '') === rid; })) {
                p.likes.push({ id: rid, name: roleName, at: Date.now() });
            }
        });
        var updated = findPost(postId);
        injectMemoryForRole(rid, 'reply', updated, String(rep.text).trim(), { toAuthorName: uname });
        injectMemoryForPostOwner(updated, roleName, 'reply', String(rep.text).trim(), uname, rid);
        refreshFeedUI({ postId: postId, mediaChanged: false, scroll: false });
    }

    async function summonCommentsForPost(postId) {
        if (_generating[postId]) return;
        var post = findPost(postId);
        if (!post) return;
        var cfg = getApiConfig();
        var base = normalizeBaseUrl(cfg.baseUrl);
        var model = String(cfg.model || '').trim();
        if (!base || !model || !cfg.apiKey) {
            toast('请先在设置中配置 API');
            return;
        }
        _generating[postId] = true;
        setSummonGeneratingUi(postId, true);
        try {
            if (Array.isArray(post.media) && post.media.some(realImageNeedsVision)) {
                toast('正在识别配图…');
            }
            var visResult = await ensureVisionForMedia(post, cfg);
            if (visResult.summaryUpdated) await mutatePost(postId, function (p) { p.media = post.media; });
            var mediaBundle = await buildMediaBundle(post, cfg);
            if (visResult.expectedRealImages > 0 && visResult.summaryReadyCount < visResult.expectedRealImages) {
                if (mediaBundle.attachedRealImages > 0) {
                    toast('图片识别未完全成功，将直接发送图片生成评论');
                } else {
                    toast('配图加载失败，已中止召唤');
                    return;
                }
            } else if (visResult.missingSummaryIndices && visResult.missingSummaryIndices.length &&
                mediaBundle.attachedRealImages > 0) {
                toast('部分配图识别失败，将结合附件图片生成评论');
            }

            var st = getStore();
            var contacts = st && st.getContacts ? st.getContacts() : [];
            var uid0 = getUserIdForMoments();
            var uname = getUserNameForMoments();
            var postOwnerId = resolvePostOwnerId(post);
            var postOwnerName = resolvePostOwnerName(post);
            var visGraph = buildVisibilityGraph(contacts);
            var contactById = {};
            contacts.forEach(function (c) { if (c && c.id) contactById[c.id] = c; });
            var comments = Array.isArray(post.comments) ? post.comments.slice() : [];

            var baseAuthorIds = Object.keys(contactById);
            var ownerVisible = postOwnerId !== uid0 && visGraph.visibleByCid[postOwnerId]
                ? visGraph.visibleByCid[postOwnerId] : null;
            var allAuthorIds = ownerVisible
                ? baseAuthorIds.filter(function (id) {
                    return ownerVisible[id] && String(id) !== String(postOwnerId);
                })
                : baseAuthorIds.slice();
            var visMode = String(post.visibilityMode || 'all');
            var visSet = {};
            (post.visibilityIds || []).forEach(function (id) { visSet[String(id)] = true; });
            if (visMode === 'allow') allAuthorIds = allAuthorIds.filter(function (id) { return visSet[id]; });
            else if (visMode === 'deny') allAuthorIds = allAuthorIds.filter(function (id) { return !visSet[id]; });
            allAuthorIds = allAuthorIds.filter(function (id) { return String(id) !== String(postOwnerId); });
            allAuthorIds = allAuthorIds.filter(function (id) {
                return canSummonCommentOnPost(post, id);
            });
            var seedAuthorIds = allAuthorIds.slice();
            comments.forEach(function (cm) {
                if (!cm || !cm.authorId) return;
                var aid = String(cm.authorId).trim();
                if (aid === uid0 || aid === String(postOwnerId)) return;
                if (contactById[aid] && seedAuthorIds.indexOf(aid) < 0) seedAuthorIds.push(aid);
            });
            allAuthorIds = expandAuthorIdsByNetwork(seedAuthorIds, contactById, post, postOwnerId);
            var visMode2 = String(post.visibilityMode || 'all');
            var visSet2 = {};
            (post.visibilityIds || []).forEach(function (id) { visSet2[String(id)] = true; });
            if (visMode2 === 'allow') allAuthorIds = allAuthorIds.filter(function (id) { return visSet2[id]; });
            else if (visMode2 === 'deny') allAuthorIds = allAuthorIds.filter(function (id) { return !visSet2[id]; });
            if (post.authorType === 'role') {
                var roleOwnerId = String(postOwnerId || '').trim();
                if (roleOwnerId && contactById[roleOwnerId] &&
                    allAuthorIds.indexOf(roleOwnerId) < 0) {
                    allAuthorIds.unshift(roleOwnerId);
                }
            }

            if (!allAuthorIds.length) {
                toast(post.authorType === 'profile'
                    ? '暂无绑定该面具的角色可参与评论'
                    : '暂无与发帖人设定关系的角色可参与评论');
                return;
            }

            var likes = Array.isArray(post.likes) ? post.likes.slice() : [];

            function buildRoleBlock(authorId) {
                var c = contactById[authorId];
                if (!c) return '';
                var isPostOwnerAuthor = String(authorId) === String(postOwnerId);
                var relToUser = buildRelationshipLine(c);
                var relToOwner = '';
                if (postOwnerId !== uid0 && !isPostOwnerAuthor) {
                    var pair = [String(authorId), String(postOwnerId)].sort().join('↔');
                    relToOwner = visGraph.relLabelByPair[pair] || '未配置';
                }
                var visibleComments = isPostOwnerAuthor
                    ? comments.slice()
                    : comments.filter(function (cm) {
                        return cm && isVisibleToAuthor(visGraph, authorId, cm.authorId);
                    });
                var ownerRelLine = postOwnerId === uid0
                    ? '用户（' + uname + '）'
                    : (isPostOwnerAuthor
                        ? '本人即此动态发帖人（' + postOwnerName + '），须以楼主身份回评'
                        : postOwnerName + '（' + relToOwner + '）');
                var relRows = [];
                Object.keys(visGraph.relLabelByPair || {}).forEach(function (pair) {
                    if (pair.indexOf(String(authorId)) < 0) return;
                    relRows.push('- ' + pair.replace('↔', ' ↔ ') + '：' + visGraph.relLabelByPair[pair]);
                });
                var peerRelRows = [];
                allAuthorIds.forEach(function (otherId) {
                    if (String(otherId) === String(authorId)) return;
                    var peerPair = [String(authorId), String(otherId)].sort().join('↔');
                    var peerLabel = visGraph.relLabelByPair[peerPair];
                    if (!peerLabel) return;
                    var peer = contactById[otherId];
                    peerRelRows.push('- 与「' + (peer ? resolveContactName(peer) : otherId) + '」（id=' + otherId + '）：' + peerLabel);
                });
                return [
                    '[ROLE_START]',
                    'authorId=' + authorId + ' authorName=' + resolveContactName(c),
                    relToUser,
                    buildChronicleBlock(c),
                    '与发帖人关系：' + ownerRelLine,
                    '【共友关系】', relRows.join('\n') || '无',
                    '【与其他评论者关系】', peerRelRows.join('\n') || '无',
                    '【最近私聊】', buildRecentChatContext(authorId, 20),
                    '【可见评论】',
                    visibleComments.map(function (row) {
                        return '- [id=' + row.id + '] ' + (row.authorName || row.authorId) + '：' + row.text;
                    }).join('\n') || '无',
                    '[ROLE_END]'
                ].join('\n');
            }

            function buildMatrixBlock(participantIds) {
                var partSet = {};
                (participantIds || allAuthorIds || []).forEach(function (id) { partSet[String(id)] = true; });
                var rows = [];
                Object.keys(visGraph.relLabelByPair || {}).forEach(function (pair) {
                    var label = visGraph.relLabelByPair[pair];
                    var parts = pair.split('↔');
                    if (parts.length !== 2) return;
                    if (!partSet[parts[0]] || !partSet[parts[1]]) return;
                    var a = contactById[parts[0]];
                    var b = contactById[parts[1]];
                    rows.push('- ' + (a ? resolveContactName(a) : parts[0]) + ' ↔ ' +
                        (b ? resolveContactName(b) : parts[1]) + '：' + label);
                });
                return rows.length ? rows.join('\n') : '无';
            }

            function buildInterCharRule(authorIds) {
                var charIds = (authorIds || []).filter(function (id) {
                    return id && String(id) !== uid0 && String(id) !== String(postOwnerId);
                });
                if (charIds.length < 2) return '';
                var targetName = postOwnerId === uid0 ? '用户「' + uname + '」' : '发帖人「' + postOwnerName + '」';
                return '【角色互评】本轮有 ' + charIds.length + ' 位角色参与，彼此若存在【角色关系矩阵】中的关系，应互相接话、调侃或站队，' +
                    '用 reply 回复其他角色的评论形成楼中楼；不可全员只 comment 首层或只回复' + targetName + '。' +
                    '至少半数非发帖角色须用 reply 回复其他角色（含用户）的评论；关系亲密者可更活跃互怼。';
            }

            function buildPrompt(authorIds, isPatch) {
                var ownerMustReplyRule = post.authorType === 'role' && authorIds.some(function (id) {
                    return String(id) === String(postOwnerId);
                })
                    ? '【发帖人必回评】authorId=' + postOwnerId + ' 是本条动态的发帖角色本人：若【已有评论】或本轮其他角色已评论，必须用 reply 回复至少一条（优先回复用户「' +
                        uname + '」及好友评论），语气像博主回评；不可只点赞不回复，不可对已有评论视而不见。'
                    : '';
                return [
                    '你正在模拟微信朋友圈评论区。输出合法 JSON，不要额外文本。',
                    '{"byAuthor":[{"authorId":"","authorName":"","events":[{"type":"comment","text":"","id":""},{"type":"reply","text":"","toCommentId":"","toAuthorId":"","id":""},{"type":"like"}]}]}',
                    '规则：每个 authorId 至少 1 条 comment 或 reply；reply 只能回复该角色可见的评论；不可串角色；不可 OOC。',
                    '【评论顺序】同一 author 的 events 按时间顺序：先 comment，再 reply；reply 必须排在它所回复 comment 之后。',
                    '【回复对象】reply 的 toCommentId 必须精确等于【已有评论】中的 id，toAuthorId 必须与被回复评论的 authorId 一致；禁止回复错误对象。',
                    '【动态隔离】所有互动仅针对本条动态，禁止引用或复述其他动态的评论内容。',
                    buildInterCharRule(authorIds),
                    ownerMustReplyRule,
                    isPatch ? '补齐轮：只为缺失角色补 1 条。' : '',
                    '用户：' + uname + '（id=' + uid0 + '）',
                    '发帖人：' + postOwnerName + '（id=' + postOwnerId + '）',
                    '【角色关系矩阵（本轮参与者）】', buildMatrixBlock(authorIds),
                    '',
                    '【动态】', String(post.text || ''),
                    '定位：' + (post.location || '无'),
                    mediaBundle.textBlock,
                    mediaBundle.attachedRealImages > 0
                        ? '【真实图片 · 必读】上方附件为动态真实配图，请先观看图片再生成评论，评论须体现对画面内容的理解。'
                        : '',
                    '',
                    '【已有评论】',
                    comments.map(function (c) {
                        return '- [id=' + c.id + ' authorId=' + c.authorId + '] ' + (c.authorName || '') + '：' + c.text;
                    }).join('\n') || '无',
                    '',
                    '【本轮作者】',
                    authorIds.map(function (id) {
                        var c = contactById[id];
                        return '- ' + (c ? resolveContactName(c) : id) + '（id=' + id + '）';
                    }).join('\n'),
                    '',
                    '【角色上下文】',
                    authorIds.map(buildRoleBlock).join('\n\n')
                ].filter(Boolean).join('\n');
            }

            async function requestEvents(promptText) {
                var r = await fetch(base + '/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
                    body: JSON.stringify({
                        model: model,
                        temperature: 0.8,
                        messages: [
                            { role: 'system', content: '朋友圈批量互动生成器，严格按角色人设与可见性；多人评论区须模拟角色间互评与楼中楼。' },
                            {
                                role: 'user',
                                content: mediaBundle.imageParts.length
                                    ? [{ type: 'text', text: promptText }].concat(mediaBundle.imageParts)
                                    : promptText
                            }
                        ]
                    })
                });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return parseMetaJsonText(extractChatText(await r.json()));
            }

            function canReplyToCommentAuthor(authorId, commentAuthorId) {
                if (String(authorId) === String(postOwnerId)) return true;
                return isVisibleToAuthor(visGraph, authorId, commentAuthorId);
            }

            function applyEvents(curPost, parsed) {
                var spoken = {};
                var list = parsed && Array.isArray(parsed.byAuthor) ? parsed.byAuthor : [];
                list.forEach(function (row) {
                    var aid = String(row.authorId || '').trim();
                    if (!aid || !contactById[aid]) return;
                    var events = Array.isArray(row.events) ? row.events : [];
                    var an = resolveContactTrueName(st, aid) || resolveContactName(contactById[aid]);
                    events.forEach(function (ev) {
                        if (!ev || !ev.type) return;
                        if (ev.type === 'comment' && ev.text) {
                            curPost.comments.push({
                                id: String(ev.id || uid('c')),
                                authorId: aid, authorName: an,
                                toCommentId: '', toAuthorId: '', toAuthorName: '',
                                text: String(ev.text).trim(), createdAt: Date.now()
                            });
                            if (!curPost.likes.some(function (l) { return String(l.id || l.userId || '') === aid; })) {
                                curPost.likes.push({ id: aid, name: an, at: Date.now() });
                            }
                            injectMemoryForRole(aid, 'comment', curPost, String(ev.text).trim(), { perspective: 'actor' });
                            injectMemoryForPostOwner(curPost, an, 'comment', String(ev.text).trim(), '', aid);
                            allAuthorIds.forEach(function (obs) {
                                if (obs !== aid && obs !== postOwnerId && isVisibleToAuthor(visGraph, obs, aid)) {
                                    injectMemoryForObserver(obs, 'comment', curPost, String(ev.text).trim(), aid, an, '', '');
                                }
                            });
                            spoken[aid] = true;
                        } else if (ev.type === 'reply' && ev.text && ev.toCommentId) {
                            var target = curPost.comments.find(function (c) {
                                return c && String(c.id) === String(ev.toCommentId);
                            });
                            if (!target || !canReplyToCommentAuthor(aid, target.authorId)) return;
                            var toName = String(target.authorName || target.authorId || '');
                            curPost.comments.push({
                                id: String(ev.id || uid('r')),
                                authorId: aid, authorName: an,
                                toCommentId: String(ev.toCommentId),
                                toAuthorId: String(target.authorId || ''),
                                toAuthorName: toName,
                                text: String(ev.text).trim(), createdAt: Date.now()
                            });
                            if (!curPost.likes.some(function (l) { return String(l.id || l.userId || '') === aid; })) {
                                curPost.likes.push({ id: aid, name: an, at: Date.now() });
                            }
                            injectMemoryForRole(aid, 'reply', curPost, String(ev.text).trim(), {
                                perspective: 'actor',
                                toAuthorName: toName,
                                isPostOwnerActor: String(aid) === String(postOwnerId)
                            });
                            injectMemoryForPostOwner(curPost, an, 'reply', String(ev.text).trim(), toName, aid);
                            allAuthorIds.forEach(function (obs) {
                                if (obs !== aid && obs !== postOwnerId &&
                                    isVisibleToAuthor(visGraph, obs, aid) &&
                                    isVisibleToAuthor(visGraph, obs, target.authorId)) {
                                    injectMemoryForObserver(obs, 'reply', curPost, String(ev.text).trim(), aid, an, target.authorId, toName);
                                }
                            });
                            spoken[aid] = true;
                        } else if (ev.type === 'like') {
                            if (!curPost.likes.some(function (l) { return String(l.id || l.userId || '') === aid; })) {
                                curPost.likes.push({ id: aid, name: an, at: Date.now() });
                                injectMemoryForRole(aid, 'like', curPost, '', { perspective: 'actor' });
                                injectMemoryForPostOwner(curPost, an, 'like', '', '', aid);
                            }
                            spoken[aid] = true;
                        }
                    });
                });
                return spoken;
            }

            var spoken1 = {};
            var parsed1 = await requestEvents(buildPrompt(allAuthorIds, false));
            await mutatePost(postId, function (p) {
                spoken1 = applyEvents(p, parsed1);
                if (!Array.isArray(p.summonRuns)) p.summonRuns = [];
                p.summonRuns.push({ at: Date.now() });
            });

            var missing = allAuthorIds.filter(function (id) { return !spoken1[id]; });
            if (missing.length) {
                var parsed2 = await requestEvents(buildPrompt(missing, true));
                await mutatePost(postId, function (p) { applyEvents(p, parsed2); });
            }
            toast('召唤完成');
        } catch (e) {
            toast('召唤失败：' + ((e && e.message) || String(e)));
        } finally {
            delete _generating[postId];
            setSummonGeneratingUi(postId, false);
            refreshFeedUI({ postId: postId, mediaChanged: false });
        }
    }

    function deletePost(postId) {
        var posts = getPosts().filter(function (p) { return p && p.id !== postId; });
        return savePosts(posts).then(function () { refreshFeedUI(); });
    }

    async function publishUserPost(draft) {
        var profile = getCurrentProfile();
        if (!profile) { toast('请先设置面具'); return; }
        var text = trimMax(String(draft.text || '').trim(), 5000);
        var draftMedia = Array.isArray(draft.media) ? draft.media : [];
        if (!text && !draftMedia.length) { toast('请输入正文或添加图片'); return; }
        var st = getStore();
        if (!st) { toast('存储未就绪'); return; }
        var media = [];
        for (var i = 0; i < draftMedia.length && media.length < 9; i++) {
            var dm = draftMedia[i];
            if (!dm) continue;
            if (dm.kind === 'text-image' && dm.textImageDesc) {
                media.push({ kind: 'text-image', textImageDesc: trimMax(dm.textImageDesc, 2000) });
            } else if (dm.kind === 'real-image' && dm.file) {
                try {
                    var blob = dm.file;
                    if (global.MiyaChatImage && global.MiyaChatImage.compressImageFileToBlob) {
                        try {
                            blob = await global.MiyaChatImage.compressImageFileToBlob(dm.file);
                        } catch (compressErr) {
                            blob = dm.file instanceof Blob ? dm.file : null;
                        }
                    }
                    if (!blob || typeof blob.size !== 'number') throw new Error('invalid_blob');
                    var blobId = await st.storeMediaBlob(blob, 'moments');
                    if (!blobId) throw new Error('store_failed');
                    media.push({
                        kind: 'real-image',
                        imageKey: blobId,
                        mime: blob.type || dm.file.type || 'image/jpeg'
                    });
                } catch (e) {
                    toast('图片上传失败：' + ((e && e.message) || '请重试'));
                    return;
                }
            }
        }
        var post = normalizePost({
            id: uid('mom'),
            createdAt: Date.now(),
            text: text,
            location: trimMax(String(draft.location || '').trim(), 80),
            media: media,
            authorType: 'profile',
            authorId: profile.id,
            profileId: profile.id,
            authorNameSnapshot: getUserNameForMoments(profile),
            authorAvatarSnapshot: resolveProfileAvatarKey(getStore(), profile),
            visibilityMode: draft.visibilityMode || 'all',
            visibilityIds: draft.visibilityIds || []
        });
        var posts = getPosts();
        posts.unshift(post);
        await savePosts(posts);
        refreshFeedUI();
        toast('已发布');
    }

    /* ── UI ── */
    var _detailPostId = null;
    var _composeDraft = null;

    function mmIcon(name, filled) {
        var icons = {
            heart: filled
                ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.7-4.35-9.33-8.5C.5 9.5 2.5 5.5 6.5 5.5c2 0 3.2 1.2 3.8 2.2.6-1 1.8-2.2 3.8-2.2 4 0 6 4 3.83 7C18.7 16.65 12 21 12 21z" fill="currentColor" stroke="none"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 21s-6.7-4.35-9.33-8.5C.5 9.5 2.5 5.5 6.5 5.5c2 0 3.2 1.2 3.8 2.2.6-1 1.8-2.2 3.8-2.2 4 0 6 4 3.83 7C18.7 16.65 12 21 12 21z"/></svg>',
            comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            summon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 3l1.4 4.3L18 8.8l-3.5 2.6L15.8 16 12 13.8 8.2 16l1.3-4.6L6 8.8l4.6-1.5L12 3zM5 19l1 2M19 19l-1 2M12 19v2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v6M14 11v6" stroke-linecap="round"/></svg>',
            clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 21s-1.5-1.5-3-4.5c-1.5-3-1-6 3-9 4 3 4.5 6 3 9-1.5 3-3 4.5-3 4.5z" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>',
            spin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" class="mm-feed-spin"><path d="M12 3a9 9 0 1 0 9 9" stroke-linecap="round"/></svg>',
            compose: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>'
        };
        return icons[name] || '';
    }

    function isPostLikedByUser(post) {
        var uid0 = getUserIdForMoments();
        return (post.likes || []).some(function (l) {
            return l && String(l.id || l.userId || '') === uid0;
        });
    }

    function isPostOwner(post) {
        var uid0 = getUserIdForMoments();
        return post.authorType === 'profile' && String(post.authorId) === uid0;
    }

    function renderFeedActions(post) {
        var pid = esc(post.id);
        var liked = isPostLikedByUser(post);
        var likeCount = (post.likes || []).length;
        var commentCount = (post.comments || []).length;
        var html = '<div class="mm-feed-actions">';
        html += '<button type="button" class="mm-feed-action' + (liked ? ' is-liked' : '') +
            '" data-mm-like-post="' + pid + '" aria-label="点赞" title="点赞">' +
            mmIcon('heart', liked) +
            (likeCount ? '<span class="mm-feed-action__count">' + likeCount + '</span>' : '') +
            '</button>';
        html += '<button type="button" class="mm-feed-action" data-mm-comment-post="' + pid +
            '" aria-label="评论" title="评论">' + mmIcon('comment') +
            (commentCount ? '<span class="mm-feed-action__count">' + commentCount + '</span>' : '') +
            '</button>';
        html += '<button type="button" class="mm-feed-action mm-feed-action--accent' +
            (post._generating ? ' is-generating' : '') + '" data-mm-summon-post="' + pid + '"' +
            (post._generating ? ' disabled aria-busy="true"' : '') +
            ' aria-label="' + (post._generating ? '召唤中' : '召唤') + '" title="召唤">' +
            (post._generating ? mmIcon('spin') : mmIcon('summon')) + '</button>';
        if (isPostOwner(post)) {
            html += '<button type="button" class="mm-feed-action mm-feed-action--danger" data-mm-delete-post="' + pid +
                '" aria-label="删除" title="删除">' + mmIcon('trash') + '</button>';
        }
        html += '</div>';
        return html;
    }

    function renderFeedSocial(post) {
        var likes = post.likes || [];
        var comments = post.comments || [];
        if (!likes.length && !comments.length) return '';
        var html = '<div class="mm-feed-social">';
        if (likes.length) {
            html += '<div class="mm-feed-likes">' + mmIcon('heart', true) +
                '<span>' + likes.map(function (l) { return esc(l.name || l.id); }).join('、') + '</span></div>';
        }
        if (comments.length) {
            html += '<div class="mm-feed-comments">' + comments.map(function (c) {
                var reply = c.toAuthorName
                    ? '<span class="mm-feed-comment__reply">' + mmIcon('comment') + esc(c.toAuthorName) + '</span>'
                    : '';
                return '<button type="button" class="mm-feed-comment" data-mm-reply-comment="' + esc(c.id) + '">' +
                    '<span class="mm-feed-comment__who">' + esc(c.authorName || c.authorId) + '</span>' +
                    reply +
                    '<span class="mm-feed-comment__text">' + esc(c.text) + '</span></button>';
            }).join('') + '</div>';
        }
        html += '</div>';
        return html;
    }

    function setPostImageGenGenerating(postId, on) {
        var pid = String(postId || '').trim();
        if (!pid) return;
        if (on) _imageGenGenerating[pid] = true;
        else delete _imageGenGenerating[pid];
        refreshFeedUI({ postId: pid, mediaChanged: true });
    }

    var imageLightboxState = { url: '', filename: 'miya-moments-image.png' };

    function ensureImageLightbox() {
        var host = document.getElementById('qq-img-lightbox');
        if (host) return host;
        host = document.createElement('div');
        host.id = 'qq-img-lightbox';
        host.className = 'qq-img-lightbox';
        host.hidden = true;
        host.innerHTML =
            '<div class="qq-img-lightbox__backdrop" data-mq-img-lb-close aria-hidden="true"></div>' +
            '<div class="qq-img-lightbox__panel" role="dialog" aria-modal="true" aria-label="查看图片">' +
            '<img class="qq-img-lightbox__img" alt="大图预览">' +
            '<div class="qq-img-lightbox__bar">' +
            '<button type="button" class="qq-img-lightbox__btn" data-mq-img-lb-download>保存图片</button>' +
            '<button type="button" class="qq-img-lightbox__btn qq-img-lightbox__btn--ghost" data-mq-img-lb-close>关闭</button>' +
            '</div>' +
            '</div>';
        document.body.appendChild(host);
        return host;
    }

    function closeImageLightbox() {
        var host = document.getElementById('qq-img-lightbox');
        if (!host) return;
        host.hidden = true;
        document.documentElement.classList.remove('qq-img-lightbox-open');
        var img = host.querySelector('.qq-img-lightbox__img');
        if (img) img.removeAttribute('src');
        imageLightboxState.url = '';
    }

    function resolveMediaImageUrl(blobKey) {
        var st = getStore();
        if (!blobKey || !st) return Promise.resolve('');
        if (typeof st.getCachedBlobUrl === 'function') {
            var cached = st.getCachedBlobUrl(blobKey);
            if (cached) return Promise.resolve(cached);
        }
        if (typeof st.getAvatarUrl === 'function') {
            return st.getAvatarUrl(blobKey).then(function (url) { return url || ''; });
        }
        return Promise.resolve('');
    }

    function openImageLightbox(blobKey) {
        var key = String(blobKey || '').trim();
        if (!key) return;
        resolveMediaImageUrl(key).then(function (url) {
            if (!url) {
                toast('图片加载失败');
                return;
            }
            var host = ensureImageLightbox();
            var img = host.querySelector('.qq-img-lightbox__img');
            if (!img) return;
            imageLightboxState.url = url;
            imageLightboxState.filename = 'miya-moments-image-' + Date.now() + '.png';
            img.src = url;
            host.hidden = false;
            document.documentElement.classList.add('qq-img-lightbox-open');
        }).catch(function () {
            toast('图片加载失败');
        });
    }

    function getLightboxImageUrl() {
        if (imageLightboxState.url) return imageLightboxState.url;
        var host = document.getElementById('qq-img-lightbox');
        var img = host && host.querySelector('.qq-img-lightbox__img');
        return img && img.src ? img.src : '';
    }

    function downloadImageLightbox() {
        var url = getLightboxImageUrl();
        if (!url) return;
        var a = document.createElement('a');
        a.href = url;
        a.download = imageLightboxState.filename || 'miya-moments-image.png';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function bindMomentsImageLightbox() {
        if (document.documentElement.getAttribute('data-miya-mm-img-lb') === '1') return;
        document.documentElement.setAttribute('data-miya-mm-img-lb', '1');
        document.addEventListener('click', function (e) {
            var viewEl = e.target.closest('[data-mm-img-view]');
            if (viewEl) {
                e.preventDefault();
                e.stopPropagation();
                var blobKey = viewEl.getAttribute('data-mm-img-key') || viewEl.getAttribute('data-mm-lazy-img') || '';
                openImageLightbox(blobKey);
                return;
            }
            var dlBtn = e.target.closest('[data-mq-img-lb-download]');
            if (dlBtn) {
                e.preventDefault();
                e.stopPropagation();
                downloadImageLightbox();
                return;
            }
            if (e.target.closest('[data-mq-img-lb-close]')) {
                e.preventDefault();
                e.stopPropagation();
                closeImageLightbox();
            }
        }, true);
        document.addEventListener('keydown', function (e) {
            if (e.key !== 'Escape') return;
            var host = document.getElementById('qq-img-lightbox');
            if (host && !host.hidden) closeImageLightbox();
        });
    }

    function renderRealImageMediaHtml(imageKey, layout) {
        layout = layout === 'cell' ? 'cell' : 'full';
        var cellCls = layout === 'cell' ? ' mm-feed-card__media--cell' : '';
        var key = String(imageKey || '').trim();
        if (!key) return '';
        return '<div class="mm-feed-card__media mm-feed-card__media--real mm-feed-card__media--viewable' + cellCls + '"' +
            ' data-mm-img-view data-mm-lazy-img="' + esc(key) + '" data-mm-img-key="' + esc(key) + '"' +
            ' role="button" tabindex="0" aria-label="查看大图">' +
            '<div class="mm-feed-img-ph">◦</div></div>';
    }

    function renderTextImageMediaHtml(m, layout, postId, mediaIdx) {
        if (!m || m.kind !== 'text-image') return '';
        layout = layout === 'cell' ? 'cell' : 'full';
        var cellCls = layout === 'cell' ? ' mm-feed-card__media--cell' : '';
        var desc = esc(m.textImageDesc || '文字图');
        var pid = String(postId || '').trim();
        var idx = mediaIdx == null ? '' : String(mediaIdx);
        var retryAttrs = pid && idx !== ''
            ? ' data-mm-img-gen-retry data-mm-post-id="' + esc(pid) + '" data-mm-media-idx="' + esc(idx) + '"'
            : '';
        if (m.imageGenPending) {
            return '<div class="mm-feed-card__media mm-feed-card__media--text mm-feed-card__media--gen' + cellCls + '">' +
                '<div class="mm-feed-textimg mm-feed-textimg--gen">' +
                '<span class="mm-feed-textimg__kicker">生图中…</span>' +
                '<span class="qq-card-gen-spin" aria-hidden="true"></span>' +
                '<p class="mm-feed-text-img">' + desc + '</p>' +
                '</div></div>';
        }
        if (m.imageGenFailed) {
            return '<div class="mm-feed-card__media mm-feed-card__media--text mm-feed-card__media--fail' + cellCls + '">' +
                '<div class="mm-feed-textimg mm-feed-textimg--fail">' +
                '<span class="mm-feed-textimg__kicker mm-feed-textimg__kicker--fail">生图失败</span>' +
                '<p class="mm-feed-text-img">' + desc + '</p>' +
                '<button type="button" class="mm-feed-textimg__retry"' + retryAttrs + '>重试</button>' +
                '</div></div>';
        }
        return '<div class="mm-feed-card__media mm-feed-card__media--text' + cellCls + '">' +
            '<span class="mm-feed-text-img">' + desc + '</span></div>';
    }

    function renderMediaPreviewCell(m, postId, mediaIdx) {
        if (!m) return '';
        if (m.kind === 'text-image') {
            return renderTextImageMediaHtml(m, 'cell', postId, mediaIdx);
        }
        if (m.kind === 'real-image') {
            return renderRealImageMediaHtml(m.imageKey, 'cell');
        }
        return '';
    }

    function renderMediaPreviewHtml(media, postId) {
        if (!Array.isArray(media) || !media.length) return '';
        var items = media.slice(0, 9);
        if (items.length === 1) {
            var one = items[0];
            if (one.kind === 'text-image') {
                return renderTextImageMediaHtml(one, 'full', postId, 0);
            }
            if (one.kind === 'real-image') {
                return renderRealImageMediaHtml(one.imageKey, 'full');
            }
            return '';
        }
        var count = items.length;
        return '<div class="mm-feed-card__media-grid mm-feed-card__media-grid--' + count + '">' +
            items.map(function (m, i) { return renderMediaPreviewCell(m, postId, i); }).join('') + '</div>';
    }

    function resolvePostAuthorAvatarKey(post) {
        if (!post) return '';
        var st = getStore();
        if (post.authorType === 'role') {
            var contact = st && st.findContact ? st.findContact(post.authorId) : null;
            if (contact) {
                var roleLive = resolveContactAvatarKey(st, contact);
                if (roleLive) return roleLive;
            }
        } else {
            var profile = null;
            if (st && st.getProfiles) {
                var pid = String(post.profileId || post.authorId || '').trim();
                profile = (st.getProfiles() || []).find(function (p) { return p.id === pid; }) || getCurrentProfile();
            } else {
                profile = getCurrentProfile();
            }
            var profLive = resolveProfileAvatarKey(st, profile);
            if (profLive) return profLive;
        }
        return String(post.authorAvatarSnapshot || '').trim();
    }

    function softAuthorAvatarHtml(post) {
        var author = post.authorNameSnapshot || resolvePostOwnerName(post) || '?';
        var key = resolvePostAuthorAvatarKey(post);
        var metaAttrs =
            (post && post.authorType ? ' data-mm-author-type="' + esc(String(post.authorType)) + '"' : '') +
            (post && post.authorId ? ' data-mm-author-id="' + esc(String(post.authorId)) + '"' : '');
        if (key) {
            if (isDirectAvatarSrc(key)) {
                return (
                    '<img class="soft-feed-card__ava" src="' +
                    esc(key) +
                    '" alt="' +
                    esc(author) +
                    '"' +
                    metaAttrs +
                    '>'
                );
            }
            return (
                '<img class="soft-feed-card__ava" data-mm-author-ava="' +
                esc(key) +
                '" src="' +
                esc(avatarFallback(author)) +
                '" alt="' +
                esc(author) +
                '"' +
                metaAttrs +
                '>'
            );
        }
        return '<div class="soft-feed-card__ava soft-feed-card__ava--ph" aria-hidden="true">' + esc(String(author).charAt(0)) + '</div>';
    }

    function renderMomentsTranslationBlock(post) {
        var trMod = global.MiyaChatTranslate;
        if (!trMod || typeof trMod.buildMomentsTranslateHtml !== 'function') return '';
        return trMod.buildMomentsTranslateHtml(post);
    }

    function renderSoftCard(post, idx) {
        var author = post.authorNameSnapshot || '?';
        var timeTip = formatRelativeTime(post.createdAt);
        var loc = post.location ? trimMax(post.location, 40) : '';
        var transHtml = renderMomentsTranslationBlock(post);
        return '<article class="soft-feed-card mm-feed-card" data-mm-post-id="' + esc(post.id) + '">' +
            '<header class="soft-feed-card__head mm-feed-card__head">' +
            softAuthorAvatarHtml(post) +
            '<div class="soft-feed-card__meta">' +
            '<div class="soft-feed-card__name-row">' +
            '<span class="soft-feed-card__author mm-feed-card__author">' + esc(author) + '</span>' +
            '<span class="soft-feed-card__tag">特别关注</span>' +
            '</div>' +
            '<span class="soft-feed-card__time">' + esc(timeTip) + '</span>' +
            '</div>' +
            '</header>' +
            (post.text ? '<div class="soft-feed-card__text mm-feed-card__text">' + esc(post.text) + '</div>' : '') +
            transHtml +
            renderMediaPreviewHtml(post.media, post.id) +
            (loc ? '<div class="soft-feed-card__loc"><span class="soft-feed-card__loc-pill">' + esc(loc) + '</span></div>' : '') +
            renderFeedActions(post) +
            renderFeedSocial(post) +
            '</article>';
    }


    function hydrateAuthorAvatarEl(el, st) {
        if (!el || !st) return;
        var key = el.getAttribute('data-mm-author-ava');
        if (!key) return;
        var authorName = String(el.getAttribute('alt') || '?').trim() || '?';
        var fallback = avatarFallback(authorName);

        function applyUrl(url) {
            if (!url || !el.parentNode) return;
            if (!isDirectAvatarSrc(url)) return;
            el.onerror = function () {
                el.onerror = null;
                el.src = fallback;
            };
            el.src = url;
        }

        if (isDirectAvatarSrc(key)) {
            applyUrl(key);
            return;
        }

        var authorType = String(el.getAttribute('data-mm-author-type') || '').trim();
        var authorId = String(el.getAttribute('data-mm-author-id') || '').trim();

        if (authorType === 'role' && authorId) {
            var contact = st.findContact ? st.findContact(authorId) : null;
            if (contact) {
                resolveContactArchiveAvatarAsync(st, contact).then(applyUrl).catch(function () {});
                return;
            }
        }
        if (authorType === 'profile' && authorId) {
            var profile = (st.getProfiles ? st.getProfiles() : []).find(function (p) { return p && p.id === authorId; });
            if (profile) {
                resolveProfileArchiveAvatarAsync(st, profile).then(applyUrl).catch(function () {});
                return;
            }
        }

        st.getAvatarUrl(key).then(applyUrl).catch(function () {});
    }

    function hydrateLazyImages(root) {
        if (!root) return;
        var st = getStore();
        root.querySelectorAll('[data-mm-lazy-img]').forEach(function (el) {
            var key = el.getAttribute('data-mm-lazy-img');
            if (!key || !st) return;
            st.getAvatarUrl(key).then(function (url) {
                if (!url) return;
                el.innerHTML = '<img src="' + url + '" alt="" loading="lazy">';
            }).catch(function () {});
        });
        root.querySelectorAll('[data-mm-author-ava]').forEach(function (el) {
            hydrateAuthorAvatarEl(el, st);
        });
    }

    function cssAttrEscape(val) {
        var s = String(val || '');
        if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
        return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function getFeedScrollEl() {
        return document.querySelector('.qq-page--feed.is-active .qq-page__scroll--feed') ||
            document.querySelector('.qq-page--feed .qq-page__scroll--feed');
    }

    function captureFeedScrollAnchor() {
        var sc = getFeedScrollEl();
        if (!sc) return null;
        var top = sc.scrollTop;
        var anchorId = '';
        var offset = 0;
        var cards = sc.querySelectorAll('[data-mm-post-id]');
        for (var i = 0; i < cards.length; i++) {
            var card = cards[i];
            var cardTop = card.offsetTop;
            if (cardTop + card.offsetHeight > top + 1) {
                anchorId = card.getAttribute('data-mm-post-id') || '';
                offset = top - cardTop;
                break;
            }
        }
        return { sc: sc, top: top, anchorId: anchorId, offset: offset };
    }

    function restoreFeedScrollAnchor(anchor) {
        if (!anchor || !anchor.sc) return;
        var sc = anchor.sc;
        if (anchor.anchorId) {
            var row = sc.querySelector('[data-mm-post-id="' + cssAttrEscape(anchor.anchorId) + '"]');
            if (row) {
                sc.scrollTop = Math.max(0, row.offsetTop + anchor.offset);
                return;
            }
        }
        sc.scrollTop = Math.max(0, anchor.top);
    }

    function applyFeedScrollAfterLayout(anchor) {
        if (!anchor) return;
        restoreFeedScrollAnchor(anchor);
        requestAnimationFrame(function () {
            restoreFeedScrollAnchor(anchor);
            requestAnimationFrame(function () {
                restoreFeedScrollAnchor(anchor);
            });
        });
    }

    function setFeedActionCount(btn, count) {
        if (!btn) return;
        var countEl = btn.querySelector('.mm-feed-action__count');
        if (count > 0) {
            if (countEl) countEl.textContent = String(count);
            else btn.insertAdjacentHTML('beforeend', '<span class="mm-feed-action__count">' + count + '</span>');
        } else if (countEl) {
            countEl.remove();
        }
    }

    function replaceFeedActionIcon(btn, iconHtml) {
        if (!btn || !iconHtml) return;
        var iconEl = btn.querySelector('svg');
        if (!iconEl) return;
        var tmp = document.createElement('span');
        tmp.innerHTML = iconHtml;
        var nextIcon = tmp.firstElementChild;
        if (nextIcon) iconEl.replaceWith(nextIcon);
    }

    function patchSummonGeneratingInPlace(cardEl, generating) {
        if (!cardEl) return;
        var summonBtn = cardEl.querySelector('[data-mm-summon-post]');
        var statusEl = cardEl.querySelector('.mm-feed-action--status');
        if (statusEl) statusEl.remove();
        if (summonBtn) {
            summonBtn.disabled = !!generating;
            summonBtn.classList.toggle('is-generating', !!generating);
            if (generating) summonBtn.setAttribute('aria-busy', 'true');
            else summonBtn.removeAttribute('aria-busy');
            summonBtn.setAttribute('aria-label', generating ? '召唤中' : '召唤');
            replaceFeedActionIcon(summonBtn, mmIcon(generating ? 'spin' : 'summon'));
        }
    }

    function setSummonGeneratingUi(postId, on) {
        var listEl = document.getElementById('qq-feed-list');
        if (!listEl) return;
        var card = listEl.querySelector('[data-mm-post-id="' + cssAttrEscape(postId) + '"]');
        if (!card) return;
        patchSummonGeneratingInPlace(card, !!on);
    }

    /** 就地更新操作栏，避免替换整块 DOM 导致滚动丢失 */
    function patchFeedActionsInPlace(cardEl, post) {
        if (!cardEl || !post) return;
        var likeBtn = cardEl.querySelector('[data-mm-like-post]');
        if (likeBtn) {
            var liked = isPostLikedByUser(post);
            likeBtn.classList.toggle('is-liked', liked);
            replaceFeedActionIcon(likeBtn, mmIcon('heart', liked));
            setFeedActionCount(likeBtn, (post.likes || []).length);
        }
        var commentBtn = cardEl.querySelector('[data-mm-comment-post]');
        if (commentBtn) {
            setFeedActionCount(commentBtn, (post.comments || []).length);
        }
        patchSummonGeneratingInPlace(cardEl, !!post._generating);
        var deleteBtn = cardEl.querySelector('[data-mm-delete-post]');
        if (isPostOwner(post) && !deleteBtn) {
            var actionsRoot = cardEl.querySelector('.mm-feed-actions');
            if (actionsRoot) {
                actionsRoot.insertAdjacentHTML('beforeend',
                    '<button type="button" class="mm-feed-action mm-feed-action--danger" data-mm-delete-post="' +
                    esc(post.id) + '" aria-label="删除" title="删除">' + mmIcon('trash') + '</button>');
            }
        } else if (!isPostOwner(post) && deleteBtn) {
            deleteBtn.remove();
        }
    }

    function patchFeedSocialBlock(cardEl, post) {
        if (!cardEl || !post) return;
        var socialEl = cardEl.querySelector('.mm-feed-social');
        var socialHtml = renderFeedSocial(post);
        if (socialHtml) {
            if (socialEl) {
                if (socialEl.outerHTML === socialHtml) return;
                socialEl.outerHTML = socialHtml;
            } else {
                var anchor = cardEl.querySelector('.mm-feed-actions');
                if (anchor) anchor.insertAdjacentHTML('afterend', socialHtml);
            }
        } else if (socialEl) {
            socialEl.remove();
        }
    }

    function patchFeedMediaInPlace(cardEl, post) {
        if (!cardEl || !post) return;
        var old = cardEl.querySelector('.mm-feed-card__media, .mm-feed-card__media-grid');
        var html = renderMediaPreviewHtml(post.media, post.id);
        if (!html) {
            if (old) old.remove();
            return;
        }
        if (old) {
            old.outerHTML = html;
        } else {
            var anchor = cardEl.querySelector('.mm-feed-card__text, .soft-feed-card__text') ||
                cardEl.querySelector('.soft-feed-card__head, .mm-feed-card__head');
            if (anchor) anchor.insertAdjacentHTML('afterend', html);
        }
        hydrateLazyImages(cardEl);
    }

    /** 只更新操作栏与互动区，避免整卡替换导致列表滚回顶部 */
    function patchFeedPostCard(cardEl, post, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!cardEl || !post) return false;
        if (opts.mediaChanged) patchFeedMediaInPlace(cardEl, post);
        patchFeedActionsInPlace(cardEl, post);
        if (opts.socialChanged !== false) patchFeedSocialBlock(cardEl, post);
        return true;
    }

    function patchFeedPost(postId, opts) {
        if (!postId) return false;
        opts = opts && typeof opts === 'object' ? opts : {};
        var listEl = document.getElementById('qq-feed-list');
        var posts = filterPostsForFeed(getPosts());
        var post = null;
        for (var i = 0; i < posts.length; i++) {
            if (posts[i] && posts[i].id === postId) {
                post = posts[i];
                break;
            }
        }
        if (!post || !listEl) return false;
        post._generating = !!_generating[postId];
        var sel = '[data-mm-post-id="' + cssAttrEscape(postId) + '"]';
        var card = listEl.querySelector(sel);
        if (!card) return false;
        if (opts.scroll === false) {
            patchFeedPostCard(card, post, opts);
            return true;
        }
        var scrollAnchor = captureFeedScrollAnchor();
        patchFeedPostCard(card, post, opts);
        applyFeedScrollAfterLayout(scrollAnchor);
        return true;
    }

    function renderFeedInto(listEl, _cinListEl, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (opts.postId && patchFeedPost(opts.postId, opts)) return;
        if (!listEl) return;
        var scrollAnchor = captureFeedScrollAnchor();
        var posts = filterPostsForFeed(getPosts());
        posts.forEach(function (p) {
            p._generating = !!_generating[p.id];
        });
        if (!posts.length) {
            listEl.innerHTML =
                '<div class="mm-feed-card mm-feed-card--empty">' +
                '<div class="mm-feed-card__empty-icon">' + mmIcon('compose') + '</div>' +
                '<p class="mm-feed-card__empty-tip">尚无动态</p>' +
                '</div>';
            applyFeedScrollAfterLayout(scrollAnchor);
            return;
        }
        listEl.innerHTML = posts.map(function (p, i) {
            return renderSoftCard(p, i);
        }).join('');
        hydrateLazyImages(listEl);
        applyFeedScrollAfterLayout(scrollAnchor);
    }

    function ensureOverlay() {
        var el = document.getElementById('mm-detail-overlay');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'mm-detail-overlay';
        el.className = 'mm-overlay';
        el.hidden = true;
        el.innerHTML =
            '<div class="mm-overlay__backdrop" data-mm-close></div>' +
            '<div class="mm-overlay__sheet" role="dialog" aria-modal="true">' +
            '<header class="mm-overlay__head">' +
            '<button type="button" class="mm-overlay__close" data-mm-close aria-label="关闭">×</button>' +
            '<span class="mm-overlay__title">动态</span>' +
            '</header>' +
            '<div class="mm-overlay__body" id="mm-detail-body"></div>' +
            '<footer class="mm-overlay__foot" id="mm-detail-foot"></footer>' +
            '</div>';
        var app = document.getElementById('miya-chat-app');
        (app || document.body).appendChild(el);
        return el;
    }

    function ensureComposeOverlay() {
        var el = document.getElementById('mm-compose-overlay');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'mm-compose-overlay';
        el.className = 'mm-overlay mm-overlay--compose';
        el.hidden = true;
        el.innerHTML =
            '<div class="mm-overlay__backdrop" data-mm-compose-close></div>' +
            '<div class="mm-overlay__sheet" role="dialog">' +
            '<header class="mm-overlay__head">' +
            '<button type="button" class="mm-overlay__close" data-mm-compose-close>×</button>' +
            '<span class="mm-overlay__title">发布动态</span>' +
            '<button type="button" class="mm-overlay__publish" data-mm-compose-publish>发布</button>' +
            '</header>' +
            '<div class="mm-overlay__body">' +
            '<textarea class="mm-compose-input" data-mm-compose-text placeholder="写点什么…" rows="5"></textarea>' +
            '<input type="text" class="mm-compose-loc" data-mm-compose-loc placeholder="定位（可选）">' +
            '<div class="mm-compose-media" data-mm-compose-media></div>' +
            '<div class="mm-compose-tools">' +
            '<button type="button" class="mm-compose-btn" data-mm-compose-pick-img>添加图片</button>' +
            '<button type="button" class="mm-compose-btn" data-mm-compose-text-img>文字图</button>' +
            '</div>' +
            '<input type="file" accept="image/*,.heic,.heif" multiple hidden data-mm-compose-file>' +
            '</div></div>';
        var app = document.getElementById('miya-chat-app');
        (app || document.body).appendChild(el);
        return el;
    }

    function refreshDetailBody(postId) {
        if (!postId || _detailPostId !== postId) return;
        var post = findPost(postId);
        var body = document.getElementById('mm-detail-body');
        if (!post || !body) return;
        body.innerHTML = renderDetailBody(post);
        hydrateLazyImages(body);
    }

    function renderDetailBody(post) {
        if (!post) return '';
        var uid0 = getUserIdForMoments();
        var isOwner = (post.authorType === 'profile' && String(post.authorId) === uid0) ||
            (post.authorType === 'role' && false);
        var mediaHtml = '';
        if (post.media && post.media.length) {
            mediaHtml = '<div class="mm-detail-media">' + post.media.map(function (m, i) {
                if (m.kind === 'text-image') {
                    if (m.imageGenPending) {
                        return '<div class="mm-detail-text-img mm-detail-text-img--gen">' +
                            '<span class="mm-feed-textimg__kicker">生图中…</span>' +
                            '<span class="qq-card-gen-spin" aria-hidden="true"></span>' +
                            '<p class="mm-detail-text-img__desc">' + esc(m.textImageDesc) + '</p></div>';
                    }
                    if (m.imageGenFailed) {
                        return '<div class="mm-detail-text-img mm-detail-text-img--fail">' +
                            '<span class="mm-feed-textimg__kicker mm-feed-textimg__kicker--fail">生图失败</span>' +
                            '<p class="mm-detail-text-img__desc">' + esc(m.textImageDesc) + '</p>' +
                            '<button type="button" class="mm-feed-textimg__retry" data-mm-img-gen-retry data-mm-post-id="' +
                            esc(post.id) + '" data-mm-media-idx="' + esc(String(i)) + '">重试</button></div>';
                    }
                    return '<div class="mm-detail-text-img">' + esc(m.textImageDesc) + '</div>';
                }
                var imgKey = String(m.imageKey || '').trim();
                return '<div class="mm-detail-img mm-detail-img--real mm-detail-img--viewable"' +
                    ' data-mm-img-view data-mm-lazy-img="' + esc(imgKey) + '" data-mm-img-key="' + esc(imgKey) + '"' +
                    ' role="button" tabindex="0" aria-label="查看大图"></div>';
            }).join('') + '</div>';
        }
        var likes = post.likes || [];
        var likesHtml = likes.length
            ? '<div class="mm-detail-likes">♡ ' + likes.map(function (l) { return esc(l.name || l.id); }).join('、') + '</div>'
            : '';
        var commentsHtml = (post.comments || []).map(function (c) {
            var reply = c.toAuthorName ? (' 回复 ' + esc(c.toAuthorName) + '：') : '：';
            return '<div class="mm-detail-comment" data-mm-reply-comment="' + esc(c.id) + '">' +
                '<span class="mm-detail-comment__who">' + esc(c.authorName || c.authorId) + '</span>' +
                reply + esc(c.text) + '</div>';
        }).join('');
        return '<div class="mm-detail-post">' +
            '<div class="mm-detail-author">' + esc(post.authorNameSnapshot || '?') + '</div>' +
            '<div class="mm-detail-time">' + esc(formatRelativeTime(post.createdAt)) +
            (post.location ? ' · ' + esc(post.location) : '') + '</div>' +
            '<div class="mm-detail-text">' + esc(post.text) + '</div>' +
            mediaHtml + likesHtml +
            '<div class="mm-detail-comments">' + (commentsHtml || '<p class="mm-detail-empty">暂无评论</p>') + '</div>' +
            (isOwner ? '<button type="button" class="mm-detail-delete" data-mm-delete-post="' + esc(post.id) + '">删除</button>' : '') +
            '</div>';
    }

    function openDetail(postId) {
        var post = findPost(postId);
        if (!post) return;
        _detailPostId = postId;
        var overlay = ensureOverlay();
        var body = overlay.querySelector('#mm-detail-body');
        var foot = overlay.querySelector('#mm-detail-foot');
        if (body) body.innerHTML = renderDetailBody(post);
        if (foot) {
            foot.innerHTML =
                '<button type="button" class="mm-foot-btn" data-mm-like-post="' + esc(postId) + '">♡ 赞</button>' +
                '<button type="button" class="mm-foot-btn" data-mm-comment-post="' + esc(postId) + '">◦ 评论</button>' +
                '<button type="button" class="mm-foot-btn mm-foot-btn--accent" data-mm-summon-post="' + esc(postId) + '">✦ 召唤</button>';
        }
        overlay.hidden = false;
        overlay.classList.add('is-open');
        hydrateLazyImages(body);
    }

    function closeDetail() {
        var overlay = document.getElementById('mm-detail-overlay');
        if (overlay) {
            overlay.hidden = true;
            overlay.classList.remove('is-open');
        }
        _detailPostId = null;
    }

    function openCompose() {
        _composeDraft = { text: '', location: '', media: [], visibilityMode: 'all', visibilityIds: [] };
        var overlay = ensureComposeOverlay();
        var ta = overlay.querySelector('[data-mm-compose-text]');
        var loc = overlay.querySelector('[data-mm-compose-loc]');
        var mediaBox = overlay.querySelector('[data-mm-compose-media]');
        if (ta) ta.value = '';
        if (loc) loc.value = '';
        if (mediaBox) mediaBox.innerHTML = '';
        overlay.hidden = false;
        overlay.classList.add('is-open');
    }

    function closeCompose() {
        var overlay = document.getElementById('mm-compose-overlay');
        if (overlay) {
            overlay.hidden = true;
            overlay.classList.remove('is-open');
        }
        _composeDraft = null;
    }

    function refreshFeedUI(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (global.miyaChatApp && global.miyaChatApp.refreshFeed) {
            global.miyaChatApp.refreshFeed(opts);
        }
        if (opts.postId) refreshDetailBody(opts.postId);
    }

    function renderComposeMediaPreview() {
        var box = document.querySelector('[data-mm-compose-media]');
        if (!box || !_composeDraft || !Array.isArray(_composeDraft.media)) {
            if (box) box.innerHTML = '';
            return;
        }
        box.innerHTML = _composeDraft.media.map(function (m, i) {
            if (m.kind === 'real-image' && m.file) {
                var url = '';
                try { url = URL.createObjectURL(m.file); } catch (e0) {}
                if (url) {
                    return '<div class="mm-compose-thumb"><img src="' + url + '" alt=""></div>';
                }
            }
            return '<span class="mm-compose-chip">' + esc(m.textImageDesc || '图片' + (i + 1)) + '</span>';
        }).join('');
    }

    function bindEvents(app) {
        if (!app || app._mmBound) return;
        app._mmBound = true;
        bindMomentsImageLightbox();
        ensureComposeOverlay();

        app.addEventListener('mousedown', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('[data-mm-like-post], [data-mm-comment-post], [data-mm-reply-comment], [data-mm-summon-post], [data-mm-delete-post], [data-mm-img-gen-retry], .mm-feed-comment')) {
                e.preventDefault();
            }
        }, true);

        app.addEventListener('change', function (e) {
            var fileInput = e.target && e.target.closest ? e.target.closest('[data-mm-compose-file]') : null;
            if (!fileInput) return;
            var files = Array.from(fileInput.files || []);
            fileInput.value = '';
            if (!files.length) return;
            if (!_composeDraft) _composeDraft = { media: [] };
            if (!_composeDraft.media) _composeDraft.media = [];
            files.forEach(function (f) {
                var imgApi = global.MiyaChatImage;
                var ok = imgApi && typeof imgApi.isLikelyImageFile === 'function'
                    ? imgApi.isLikelyImageFile(f)
                    : f && (String(f.type || '').indexOf('image') === 0 ||
                        /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(String(f.name || '')));
                if (!ok) return;
                if (_composeDraft.media.length >= 9) return;
                _composeDraft.media.push({ kind: 'real-image', file: f });
            });
            if (_composeDraft.media.length >= 9) toast('最多 9 张图片');
            renderComposeMediaPreview();
        });

        app.addEventListener('click', function (e) {
            var t = e.target;
            if (!t || !t.closest) return;

            if (t.closest('[data-mm-close]')) {
                e.preventDefault();
                closeDetail();
                return;
            }

            if (t.closest('[data-mm-compose-close]')) {
                e.preventDefault();
                closeCompose();
                return;
            }

            if (t.closest('[data-mm-compose-open]')) {
                e.preventDefault();
                openCompose();
                return;
            }

            var likeBtn = t.closest('[data-mm-like-post]');
            if (likeBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (likeBtn.blur) likeBtn.blur();
                toggleLike(likeBtn.getAttribute('data-mm-like-post'));
                return;
            }

            var commentBtn = t.closest('[data-mm-comment-post]');
            if (commentBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (commentBtn.blur) commentBtn.blur();
                promptComment(commentBtn.getAttribute('data-mm-comment-post'));
                return;
            }

            var replyBtn = t.closest('[data-mm-reply-comment]');
            if (replyBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (replyBtn.blur) replyBtn.blur();
                var cid = replyBtn.getAttribute('data-mm-reply-comment');
                var card = replyBtn.closest('[data-mm-post-id]');
                var postId = card && card.getAttribute('data-mm-post-id');
                if (postId && cid) promptComment(postId, cid);
                return;
            }

            var summonBtn = t.closest('[data-mm-summon-post]');
            if (summonBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (summonBtn.blur) summonBtn.blur();
                summonCommentsForPost(summonBtn.getAttribute('data-mm-summon-post'));
                return;
            }

            var delBtn = t.closest('[data-mm-delete-post]');
            if (delBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (delBtn.blur) delBtn.blur();
                deletePost(delBtn.getAttribute('data-mm-delete-post'));
                return;
            }

            var retryBtn = t.closest('[data-mm-img-gen-retry]');
            if (retryBtn) {
                e.preventDefault();
                e.stopPropagation();
                var retryPostId = retryBtn.getAttribute('data-mm-post-id') || '';
                var mediaIdx = parseInt(retryBtn.getAttribute('data-mm-media-idx'), 10);
                var ig = global.MiyaImageGen;
                if (!retryPostId || !Number.isFinite(mediaIdx) || !ig || typeof ig.retryMomentMediaItem !== 'function') return;
                retryBtn.disabled = true;
                ig.retryMomentMediaItem(retryPostId, mediaIdx).catch(function () {
                    toast('重试失败');
                }).then(function () {
                    retryBtn.disabled = false;
                });
                return;
            }

            if (t.closest('[data-mm-compose-pick-img]')) {
                e.preventDefault();
                var fileInput = ensureComposeOverlay().querySelector('[data-mm-compose-file]');
                if (fileInput) fileInput.click();
                return;
            }

            if (t.closest('[data-mm-compose-text-img]')) {
                e.preventDefault();
                dialogPrompt({ title: '文字图', placeholder: '描述这张文字图…' }).then(function (txt) {
                    txt = String(txt || '').trim();
                    if (!txt) return;
                    if (!_composeDraft) _composeDraft = { media: [] };
                    if (!_composeDraft.media) _composeDraft.media = [];
                    _composeDraft.media.push({ kind: 'text-image', textImageDesc: txt });
                    renderComposeMediaPreview();
                });
                return;
            }

            if (t.closest('[data-mm-compose-publish]')) {
                e.preventDefault();
                var overlay = document.getElementById('mm-compose-overlay');
                var ta = overlay && overlay.querySelector('[data-mm-compose-text]');
                var locEl = overlay && overlay.querySelector('[data-mm-compose-loc]');
                publishUserPost({
                    text: ta ? ta.value : '',
                    location: locEl ? locEl.value : '',
                    media: (_composeDraft && _composeDraft.media) || [],
                    visibilityMode: 'all'
                }).then(closeCompose);
                return;
            }
        });
    }

    /* ── 角色定时发朋友圈 ── */
    function getMomentsAutoFromChat(chatId) {
        var st = getStore();
        if (!st || !chatId) return null;
        var cs = st.getChatSettings ? st.getChatSettings(chatId) : {};
        var ma = cs && cs.momentsAuto;
        if (!ma || !ma.mode || ma.mode === 'off') return null;
        return { chatId: String(chatId), ma: ma };
    }

    function getMomentsAutoSettings(contact) {
        var ctx = resolveMomentsAutoContext(contact);
        return ctx ? ctx.ma : null;
    }

    function countRoundsSinceAnchor(st, chatId, ma) {
        if (!st || !chatId) return 0;
        var history = st.getMessages(chatId);
        if (!history || !history.length) return 0;
        var anchor = clampInt(ma && ma.roundAnchorEnd, 0, history.length, 0);
        var memExt = global.MiyaChatMemoryExtract;
        if (!memExt || typeof memExt.countAssistantRounds !== 'function') return 0;
        return memExt.countAssistantRounds(history, anchor);
    }

    function isMomentsAutoDue(contact, ctx, now) {
        if (!contact || !ctx || !ctx.ma || !ctx.chatId) return false;
        var ma = ctx.ma;
        if (!ma.mode || ma.mode === 'off') return false;
        now = now || Date.now();
        if (shouldThrottleMomentsAuto(ma, now)) return false;
        if (ma.mode === 'hours') {
            var anchorTs = lastPostTsForContact(contact.id);
            var hourInterval = clampInt(ma.hourInterval, 1, 720, 0);
            if (!hourInterval) return false;
            if (!anchorTs) return true;
            return now - anchorTs >= hourInterval * 3600000;
        }
        if (ma.mode === 'rounds') {
            var stR = getStore();
            if (!stR) return false;
            var roundInterval = clampInt(ma.roundInterval, 1, 500, 0);
            if (!roundInterval) return false;
            var maxRounds = countRoundsSinceAnchor(stR, ctx.chatId, ma);
            (stR.getChats('all') || []).forEach(function (chat) {
                if (!chat || chat.type === 'group' || String(chat.contactId) !== String(contact.id)) return;
                if (String(chat.id) === String(ctx.chatId)) return;
                var rounds = countRoundsSinceAnchor(stR, chat.id, ma);
                if (rounds > maxRounds) maxRounds = rounds;
            });
            return maxRounds >= roundInterval;
        }
        return false;
    }

    function resolveMomentsAutoContext(contact) {
        if (!contact || !contact.id) return null;
        var st = getStore();
        if (!st) return null;
        var cid = String(contact.id);
        var chats = st.getChats ? st.getChats('all') : [];
        var hitChatId = '';
        chats.forEach(function (chat) {
            if (!chat || chat.type === 'group' || String(chat.contactId) !== cid) return;
            if (!hitChatId || String(chat.profileId || '') === String(contact.defaultProfileId || '')) {
                hitChatId = chat.id;
            }
        });
        if (!hitChatId) return null;
        var cs = st.getChatSettings ? st.getChatSettings(hitChatId) : {};
        var ma = cs && cs.momentsAuto;
        if (!ma || !ma.mode || ma.mode === 'off') return null;
        return { chatId: hitChatId, contactId: cid, ma: ma };
    }

    function patchMomentsAuto(chatId, maPatch) {
        var st = getStore();
        if (!st || !st.saveChatSettings || !chatId) return Promise.resolve();
        var cs = st.getChatSettings ? st.getChatSettings(chatId) : {};
        var prev = (cs && cs.momentsAuto) || {};
        return st.saveChatSettings(chatId, {
            momentsAuto: Object.assign({}, prev, maPatch || {})
        });
    }

    function lastPostTsForContact(contactId) {
        var posts = getPosts();
        var cid = String(contactId || '').trim();
        if (!cid) return 0;
        var latest = 0;
        for (var i = 0; i < posts.length; i++) {
            var p = posts[i];
            if (!p || p.authorType !== 'role' || String(p.authorId) !== cid) continue;
            var ts = Number(p.createdAt) || 0;
            if (ts > latest) latest = ts;
        }
        return latest;
    }

    function maxHistoryLengthForContact(st, contactId) {
        var maxLen = 0;
        if (!st || !contactId) return 0;
        (st.getChats('all') || []).forEach(function (chat) {
            if (!chat || chat.type === 'group' || String(chat.contactId) !== String(contactId)) return;
            var h = st.getMessages(chat.id);
            if (h && h.length > maxLen) maxLen = h.length;
        });
        return maxLen;
    }

    function touchMomentsAutoAfterRolePost(contactId) {
        var st = getStore();
        if (!st) return;
        var ctx = resolveMomentsAutoContext(st.findContact(contactId));
        if (!ctx || !ctx.chatId) return;
        var patch = {
            lastMomentsAutoAt: Date.now(),
            roundAnchorEnd: maxHistoryLengthForContact(st, contactId)
        };
        if (ctx.ma) Object.assign(ctx.ma, patch);
        patchMomentsAuto(ctx.chatId, patch);
    }

    function shouldThrottleMomentsAuto(ma, now) {
        now = now || Date.now();
        var lastFail = pickTs(ma && ma.lastFailedAt);
        if (lastFail && now - lastFail < MOMENTS_AUTO_FAIL_COOLDOWN_MS) return true;
        var lastAttempt = pickTs(ma && ma.lastMomentsAutoAttemptAt);
        if (lastAttempt && now - lastAttempt < MOMENTS_AUTO_MIN_ATTEMPT_GAP_MS) return true;
        return false;
    }

    function queueMomentsAuto(contactId) {
        var key = String(contactId || '');
        if (!key || _autoQueued[key] || _autoInFlight[key]) return;
        _autoQueued[key] = true;
        _autoQueue.push(key);
        runAutoWorker();
    }

    function runAutoWorker() {
        if (_autoWorker) return;
        _autoWorker = true;
        (function next() {
            if (!_autoQueue.length) { _autoWorker = false; return; }
            var cid = _autoQueue.shift();
            if (_autoInFlight[cid]) return next();
            _autoInFlight[cid] = true;
            triggerRoleMomentsAuto(cid).finally(function () {
                delete _autoInFlight[cid];
                delete _autoQueued[cid];
                next();
            });
        })();
    }

    function parseMomentsIntentFromRaw(raw) {
        var fmt = global.MiyaChatOnlineFormat;
        if (!fmt || typeof fmt.parseRoleMomentsPostIntentFromLine !== 'function') return null;
        raw = String(raw || '').trim();
        if (!raw) return null;
        var lines = raw.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
        var i;
        for (i = lines.length - 1; i >= 0; i--) {
            var intent = fmt.parseRoleMomentsPostIntentFromLine(lines[i]);
            if (intent) return intent;
        }
        var embedded = raw.match(/【发朋友圈[：:][\s\S]*?】/);
        if (embedded && embedded[0]) {
            var embeddedIntent = fmt.parseRoleMomentsPostIntentFromLine(embedded[0]);
            if (embeddedIntent) return embeddedIntent;
        }
        if (typeof fmt.stripRoleMomentsFromLines === 'function') {
            var stripped = fmt.stripRoleMomentsFromLines(lines);
            if (stripped && stripped.intent) return stripped.intent;
        }
        return null;
    }

    async function awaitCreateRolePost(contactId, intent, injectOpts) {
        var result = createRolePostFromIntent(contactId, intent, injectOpts || {});
        if (result && typeof result.then === 'function') {
            try {
                return await result;
            } catch (eSave) {
                return null;
            }
        }
        return result || null;
    }

    async function triggerRoleMomentsAuto(contactId) {
        var chatId = '';
        try {
            var st = getStore();
            if (!st) return false;
            var contact = st.findContact(contactId);
            if (!contact) return false;
            var ctx = resolveMomentsAutoContext(contact);
            if (!ctx) return false;
            var ma = ctx.ma;
            chatId = ctx.chatId;
            if (!ma || ma.mode === 'off') return false;
            await patchMomentsAuto(chatId, { lastMomentsAutoAttemptAt: Date.now() });
            var cfg = getApiConfig();
            var base = normalizeBaseUrl(cfg.baseUrl);
            var model = String(cfg.model || '').trim();
            if (!base || !model || !cfg.apiKey) {
                await patchMomentsAuto(chatId, { lastMomentsAutoAttemptAt: Date.now() });
                return false;
            }
            var eng = global.miyaChatEngine;
            if (!eng || typeof eng.buildApiMessages !== 'function') {
                await patchMomentsAuto(chatId, { lastMomentsAutoAttemptAt: Date.now() });
                return false;
            }
            var built = null;
            try {
                built = eng.buildApiMessages(chatId, '（定时触发 · 请现在仅输出一行朋友圈指令，不要输出其它任何内容。）', {
                    isMomentsAuto: true
                });
            } catch (eBuild) {
                built = null;
            }
            if (!built || built.error || !Array.isArray(built.messages)) {
                await patchMomentsAuto(chatId, { lastFailedAt: Date.now(), lastMomentsAutoAttemptAt: Date.now() });
                return false;
            }
            var messages = built.messages.slice();
            var r = await fetch(base + '/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
                body: JSON.stringify({ model: model, temperature: 0.85, messages: messages })
            });
            if (!r.ok) {
                await patchMomentsAuto(chatId, { lastFailedAt: Date.now(), lastMomentsAutoAttemptAt: Date.now() });
                return false;
            }
            var raw = extractChatText(await r.json());
            var engStrip = global.miyaChatEngine;
            if (engStrip && typeof engStrip.stripThinkingForApi === 'function') {
                raw = engStrip.stripThinkingForApi(raw);
            }
            if (engStrip && typeof engStrip.stripHeartVoiceTags === 'function') {
                raw = engStrip.stripHeartVoiceTags(raw);
            }
            var intent = parseMomentsIntentFromRaw(raw);
            if (!intent) {
                await patchMomentsAuto(chatId, { lastFailedAt: Date.now(), lastMomentsAutoAttemptAt: Date.now() });
                return false;
            }
            var savedPost = await awaitCreateRolePost(contactId, intent, {
                skipChatSystemLine: true,
                skipAutoStateTouch: true
            });
            if (!savedPost) {
                await patchMomentsAuto(chatId, { lastFailedAt: Date.now(), lastMomentsAutoAttemptAt: Date.now() });
                return false;
            }
            await patchMomentsAuto(chatId, {
                lastFailedAt: 0,
                lastMomentsAutoAt: Date.now(),
                lastMomentsAutoAttemptAt: Date.now(),
                roundAnchorEnd: maxHistoryLengthForContact(st, contactId)
            });
            return true;
        } catch (errAuto) {
            if (chatId) {
                await patchMomentsAuto(chatId, { lastFailedAt: Date.now(), lastMomentsAutoAttemptAt: Date.now() });
            }
            return false;
        }
    }

    function maybeAutoMomentsAfterRound(chatId) {
        var st = getStore();
        if (!st) return;
        var chat = st.findChat(chatId);
        if (!chat || !chat.contactId) return;
        var contact = st.findContact(chat.contactId);
        if (!contact) return;
        var ctx = getMomentsAutoFromChat(chatId);
        if (!ctx || !ctx.ma || ctx.ma.mode !== 'rounds') return;
        if (!isMomentsAutoDue(contact, ctx)) return;
        queueMomentsAuto(chat.contactId);
    }

    function checkMomentsAutoForContact(contactId) {
        var st = getStore();
        if (!st) return;
        var contact = st.findContact(contactId);
        if (!contact) return;
        var ctx = resolveMomentsAutoContext(contact);
        if (!ctx || !isMomentsAutoDue(contact, ctx)) return;
        queueMomentsAuto(contact.id);
    }

    function checkMomentsAutoForAllContacts() {
        var st = getStore();
        if (!st || typeof st.getContacts !== 'function') return;
        var contacts;
        try {
            contacts = st.getContacts();
        } catch (eContacts) {
            return;
        }
        if (!contacts || !contacts.length) return;
        var now = Date.now();
        contacts.forEach(function (contact) {
            if (!contact || !contact.id) return;
            var ctx = resolveMomentsAutoContext(contact);
            if (!ctx || !isMomentsAutoDue(contact, ctx, now)) return;
            queueMomentsAuto(contact.id);
        });
    }

    function stopAutoTick() {
    if (!_autoTickTimer) return;
    if (typeof _autoTickTimer === 'function') {
      _autoTickTimer();
    } else {
      clearInterval(_autoTickTimer);
    }
    _autoTickTimer = null;
  }

  function startIntervalTick(ms) {
    if (global.miyaBgSetInterval) return global.miyaBgSetInterval(checkMomentsAutoForAllContacts, ms);
    return setInterval(checkMomentsAutoForAllContacts, ms);
  }

    function startAutoTick() {
        if (_autoTickBooted) return;
        _autoTickBooted = true;
        checkMomentsAutoForAllContacts();
        if (!document.hidden) {
            _autoTickTimer = startIntervalTick(getAutoScanMs());
        }
        if (!global.__miyaMomentsAutoVisBound) {
            global.__miyaMomentsAutoVisBound = true;
            function onMomentsForeground() {
                checkMomentsAutoForAllContacts();
                if (_autoTickBooted && !_autoTickTimer) {
                    _autoTickTimer = startIntervalTick(getAutoScanMs());
                }
            }
            if (typeof global.miyaBindForeground === 'function') {
                document.addEventListener('visibilitychange', function () {
                    if (document.hidden) stopAutoTick();
                });
                global.miyaBindForeground(onMomentsForeground);
            } else {
                document.addEventListener('visibilitychange', function () {
                    if (document.hidden) {
                        stopAutoTick();
                        return;
                    }
                    onMomentsForeground();
                });
                window.addEventListener('pageshow', function () {
                    if (!document.hidden) onMomentsForeground();
                });
            }
        }
    }

    function bootAutoTick() {
        var st = getStore();
        var chain = Promise.resolve();
        if (global.miyaBootstrapKvStores) {
            chain = chain.then(function () { return global.miyaBootstrapKvStores(); });
        }
        if (st && typeof st.init === 'function') {
            chain = chain.then(function () { return st.init(); });
        }
        chain.then(function () { return whenReady(); }).then(function () {
            startAutoTick();
            if (global.MiyaImageGen && typeof global.MiyaImageGen.resumeMomentsImageGeneration === 'function') {
                global.MiyaImageGen.resumeMomentsImageGeneration().catch(function () {});
            }
        }).catch(function () {
            startAutoTick();
        });
    }

    global.MiyaChatMoments = {
        STORE_KEY: STORE_KEY,
        whenReady: whenReady,
        getPosts: getPosts,
        findPost: findPost,
        mutatePost: mutatePost,
        mutatePostMedia: mutatePost,
        setPostImageGenGenerating: setPostImageGenGenerating,
        createRolePostFromIntent: createRolePostFromIntent,
        renderFeedInto: renderFeedInto,
        bindEvents: bindEvents,
        refreshFeedUI: refreshFeedUI,
        buildMomentsContextBlock: buildMomentsContextBlock,
        checkMomentsAutoForAllContacts: checkMomentsAutoForAllContacts,
        checkMomentsAutoForContact: checkMomentsAutoForContact,
        getLastRolePostTs: lastPostTsForContact,
        maybeAutoMomentsAfterRound: maybeAutoMomentsAfterRound,
        startAutoTick: startAutoTick,
        summonCommentsForPost: summonCommentsForPost,
        toggleLike: toggleLike,
        promptComment: promptComment,
        publishUserPost: publishUserPost,
        deletePost: deletePost
    };

    bootAutoTick();
})(window);
