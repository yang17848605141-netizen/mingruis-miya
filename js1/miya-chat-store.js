(function (global) {
    'use strict';

    var DB_NAME = 'miya-chat-media';
    var STORE = 'blobs';
    var META_LS = 'miya-chat-meta';
    var META_BACKUP_LS = 'miya-chat-meta:backup';
    var META_EMERGENCY_SS = 'miya-chat-meta:emergency';
    /** 超过此大小仅写 IndexedDB，localStorage 只保留占位指针 */
    var META_LS_SOFT_MAX = Math.floor(0.75 * 1024 * 1024);

    var metaCache = null;
    var urlCache = {};
    var initPromise = null;
    var initSettled = false;
    var chatDbPromise = null;
    var lookupRev = 0;
    var contactLookupCache = null;
    var chatLookupCache = null;
    /**
     * 冷启动时 LS 已是 IDB 占位符，但主键/备份均未读到有效 meta。
     * 此时禁止把空壳写回 IDB，否则会永久覆盖真实聊天记录与房间美化。
     */
    var metaHydrateFailedWithPlaceholder = false;
    var metaBgRecoverTimer = null;
    var metaBgRecoverAttempts = 0;
    var META_BG_RECOVER_MAX = 24;

    function invalidateLookupCache() {
        lookupRev += 1;
        contactLookupCache = null;
        chatLookupCache = null;
    }

    function ensureContactLookupCache() {
        if (contactLookupCache && contactLookupCache.rev === lookupRev) return contactLookupCache;
        var normalized = (metaCache.contacts || []).map(normalizeContact);
        var byId = Object.create(null);
        var byChronicle = Object.create(null);
        var byCharacterId = Object.create(null);
        normalized.forEach(function (c) {
            byId[c.id] = c;
            if (c.chronicleId) byChronicle[c.chronicleId] = c;
            if (c.characterId) byCharacterId[c.characterId] = c;
        });
        contactLookupCache = {
            rev: lookupRev,
            list: normalized,
            byId: byId,
            byChronicle: byChronicle,
            byCharacterId: byCharacterId
        };
        return contactLookupCache;
    }

    function ensureChatLookupCache() {
        if (chatLookupCache && chatLookupCache.rev === lookupRev) return chatLookupCache;
        var normalized = (metaCache.chats || []).map(normalizeChat);
        var byId = Object.create(null);
        var privateByContact = Object.create(null);
        normalized.forEach(function (ch) {
            byId[ch.id] = ch;
            if (ch.type === 'private' && ch.contactId) {
                if (!privateByContact[ch.contactId]) privateByContact[ch.contactId] = [];
                privateByContact[ch.contactId].push(ch);
            }
        });
        var bestPrivateByContact = Object.create(null);
        Object.keys(privateByContact).forEach(function (cid) {
            bestPrivateByContact[cid] = pickBestPrivateChat(privateByContact[cid]);
        });
        chatLookupCache = {
            rev: lookupRev,
            list: normalized,
            byId: byId,
            privateByContact: privateByContact,
            bestPrivateByContact: bestPrivateByContact
        };
        return chatLookupCache;
    }

    function uid(prefix) {
        return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
    }

    function openDb() {
        if (chatDbPromise) return chatDbPromise;
        chatDbPromise = new Promise(function (resolve, reject) {
            var req;
            try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
            var settled = false;
            req.onerror = function () {
                settled = true;
                chatDbPromise = null;
                reject(req.error);
            };
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = function () {
                var db = req.result;
                db.onversionchange = function () {
                    try { db.close(); } catch (e) {}
                    chatDbPromise = null;
                };
                db.onclose = function () { chatDbPromise = null; };
                if (settled) {
                    try { db.close(); } catch (e2) {}
                    return;
                }
                resolve(db);
            };
        });
        return chatDbPromise;
    }

    function idbPut(key, value) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = function () { resolve(key); };
                tx.onerror = function () {
                    reject(tx.error || new Error('idb_write_failed'));
                };
            });
        });
    }

    function idbGet(key) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).get(key);
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function idbDelete(key) {
        return openDb().then(function (db) {
            return new Promise(function (resolve) {
                try {
                    var tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).delete(key);
                    tx.oncomplete = function () { resolve(); };
                    tx.onerror = function () { resolve(); };
                } catch (e) { resolve(); }
            });
        });
    }

    function defaultMeta() {
        return {
            version: 2,
            activeProfileId: null,
            profiles: [],
            emojiGroups: [{ id: 'default', name: '默认', sort: 0, scope: 'global', contactIds: [] }],
            emojiPacks: [],
            savedMessages: [],
            contactGroups: [{ id: 'ct-default', name: '默认', sort: 0, createdAt: Date.now() }],
            contacts: [],
            chats: [],
            messagesByChat: {},
            shopCatalog: null,
            cstoreMystical: null,
            chatWallpapers: []
        };
    }

    function normalizeChatWallpaper(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var blobId = raw.blobId ? String(raw.blobId).trim() : '';
        var url = String(raw.url || '').trim();
        if (!blobId && !url) return null;
        return {
            id: String(raw.id || uid('cwp')).trim(),
            blobId: blobId || null,
            url: url,
            name: String(raw.name || '').trim().slice(0, 80),
            createdAt: Number(raw.createdAt) || Date.now()
        };
    }

    function defaultShopCatalog() {
        return {
            mode: 'takeout',
            refreshedAt: 0,
            searchQuery: '',
            items: []
        };
    }

    function normalizeShopItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var name = String(raw.name || '').trim();
        if (!name) return null;
        var price = Number(raw.price);
        if (!Number.isFinite(price) || price <= 0) price = 9.9;
        var kind = String(raw.kind || '').trim() === 'takeout' ? 'takeout' : 'gift';
        return {
            id: String(raw.id || uid('shop')).trim(),
            name: name.slice(0, 80),
            shop: String(raw.shop || '').trim().slice(0, 60) || '精选铺',
            price: Math.round(price * 100) / 100,
            category: String(raw.category || '').trim().slice(0, 40) || (kind === 'takeout' ? '外卖' : '礼品'),
            tag: String(raw.tag || '').trim().slice(0, 4).toUpperCase(),
            emoji: String(raw.emoji || '').trim().slice(0, 4) || (kind === 'takeout' ? '🍱' : '🎁'),
            desc: String(raw.desc || '').trim().slice(0, 160),
            kind: kind
        };
    }

    function normalizeShopCatalog(raw) {
        var d = defaultShopCatalog();
        if (!raw || typeof raw !== 'object') return d;
        var items = Array.isArray(raw.items)
            ? raw.items.map(normalizeShopItem).filter(Boolean)
            : [];
        return {
            mode: String(raw.mode || '').trim() === 'gift' ? 'gift' : 'takeout',
            refreshedAt: Number(raw.refreshedAt) || 0,
            searchQuery: String(raw.searchQuery || '').trim().slice(0, 80),
            items: items
        };
    }

    function normalizeGiftParcel(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var items = Array.isArray(raw.items)
            ? raw.items
                  .map(function (it) {
                      if (!it || typeof it !== 'object') return null;
                      var nm = String(it.name || '').trim();
                      if (!nm) return null;
                      var qty = Math.max(1, Math.min(99, Math.round(Number(it.qty) || 1)));
                      var price = Number(it.price);
                      if (!Number.isFinite(price) || price < 0) price = 0;
                      return {
                          name: nm.slice(0, 80),
                          qty: qty,
                          price: Math.round(price * 100) / 100,
                          shop: String(it.shop || '').trim().slice(0, 60),
                          emoji: String(it.emoji || '').trim().slice(0, 4) || '🎁'
                      };
                  })
                  .filter(Boolean)
            : [];
        if (!items.length) return null;
        var total = Number(raw.total);
        if (!Number.isFinite(total) || total <= 0) {
            total = items.reduce(function (s, it) {
                return s + (Number(it.price) || 0) * (Number(it.qty) || 1);
            }, 0);
        }
        return {
            items: items,
            total: Math.round(total * 100) / 100,
            note: String(raw.note || '').trim().slice(0, 200),
            ribbon: String(raw.ribbon || '').trim().slice(0, 40) || 'GIFT PARCEL',
            status: String(raw.status || 'delivered').trim() || 'delivered'
        };
    }

    function readFileAsArrayBuffer(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(r.error); };
            r.readAsArrayBuffer(file);
        });
    }

    function kvGet() {
        if (typeof global.miyaReadLsJsonKey === 'function') {
            return global.miyaReadLsJsonKey(META_LS).then(function (v) { return v || null; });
        }
        return Promise.resolve(null);
    }

    function kvPut(obj) {
        if (typeof global.miyaWriteLsJsonKey === 'function') {
            return global.miyaWriteLsJsonKey(META_LS, obj);
        }
        return Promise.resolve(false);
    }

    function kvGetBackup() {
        if (typeof global.miyaReadLsJsonKey === 'function') {
            return global.miyaReadLsJsonKey(META_BACKUP_LS).then(function (v) { return v || null; });
        }
        return Promise.resolve(null);
    }

    function kvPutBackup(obj) {
        if (typeof global.miyaWriteLsJsonKey === 'function') {
            return global.miyaWriteLsJsonKey(META_BACKUP_LS, obj);
        }
        return Promise.resolve(false);
    }

    function metaIsValidSnapshot(raw) {
        return !!(raw && typeof raw === 'object' && (raw.version || raw.contacts || raw.chats));
    }

    function metaRichness(raw) {
        if (!metaIsValidSnapshot(raw)) return 0;
        var score = 0;
        var chats = Array.isArray(raw.chats) ? raw.chats : [];
        var contacts = Array.isArray(raw.contacts) ? raw.contacts : [];
        var profiles = Array.isArray(raw.profiles) ? raw.profiles : [];
        var mbc = raw.messagesByChat && typeof raw.messagesByChat === 'object' ? raw.messagesByChat : {};
        score += chats.length * 10;
        score += contacts.length * 5;
        score += profiles.length * 2;
        chats.forEach(function (ch) {
            if (!ch || typeof ch !== 'object') return;
            var bf = ch.chatSettings && ch.chatSettings.chatBeautify;
            if (!bf || typeof bf !== 'object') return;
            if (bf.customCss || bf.presetName || (bf.wallpaper && (bf.wallpaper.url || bf.wallpaper.blobId))) {
                score += 3;
            }
        });
        Object.keys(mbc).forEach(function (cid) {
            var arr = mbc[cid];
            if (Array.isArray(arr)) score += arr.length;
        });
        return score;
    }

    function pickRicherMetaSnapshot(a, b) {
        var sa = metaRichness(a);
        var sb = metaRichness(b);
        if (sb > sa) return b;
        if (sa > sb) return a;
        return b || a;
    }

    function readEmergencyMeta() {
        try {
            var raw = sessionStorage.getItem(META_EMERGENCY_SS);
            if (!raw) return null;
            var p = JSON.parse(raw);
            return metaIsValidSnapshot(p) ? p : null;
        } catch (e) { return null; }
    }

    function writeEmergencyMeta(snapshot) {
        if (!snapshot) return;
        try {
            sessionStorage.setItem(META_EMERGENCY_SS, JSON.stringify(snapshot));
        } catch (e) {}
    }

    /** 落盘守卫：占位符水合失败期间禁止把空壳/稀疏数据写回，避免冲掉真实 IDB */
    function shouldBlockSparsePersist(normalized) {
        if (!metaHydrateFailedWithPlaceholder) return false;
        return true;
    }

    function clearMetaHydrateGuard() {
        metaHydrateFailedWithPlaceholder = false;
        metaBgRecoverAttempts = 0;
        if (metaBgRecoverTimer) {
            try { clearTimeout(metaBgRecoverTimer); } catch (e) {}
            metaBgRecoverTimer = null;
        }
    }

    function notifyMetaRecovered() {
        try {
            if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
                global.miyaChatApp.refreshLists({ force: true });
            }
            if (
                global.miyaChatRoom &&
                typeof global.miyaChatRoom.getOpenChatId === 'function' &&
                global.miyaChatRoom.getOpenChatId() &&
                typeof global.miyaChatRoom.refresh === 'function'
            ) {
                global.miyaChatRoom.refresh({ toBottom: true });
            }
        } catch (e) {}
    }

    function applyRecoveredMeta(snapshot) {
        if (!metaIsValidSnapshot(snapshot) || metaRichness(snapshot) <= 0) return false;
        metaCache = normalizeMeta(snapshot);
        invalidateLookupCache();
        clearMetaHydrateGuard();
        writeEmergencyMeta(metaCache);
        notifyMetaRecovered();
        return true;
    }

    function scheduleBackgroundMetaRecover() {
        if (!metaHydrateFailedWithPlaceholder) return;
        if (metaBgRecoverTimer) return;
        if (metaBgRecoverAttempts >= META_BG_RECOVER_MAX) {
            /* IDB 多次仍空：判定存储已被系统清掉，解除守卫以免新会话永远无法落盘 */
            console.warn('[miyaChatStore] meta recovery exhausted; allowing new persist');
            clearMetaHydrateGuard();
            return;
        }
        var delay = metaBgRecoverAttempts === 0
            ? 800
            : Math.min(30000, Math.floor(1200 * Math.pow(1.35, metaBgRecoverAttempts)));
        metaBgRecoverTimer = setTimeout(function () {
            metaBgRecoverTimer = null;
            metaBgRecoverAttempts += 1;
            Promise.all([kvGet(), kvGetBackup()])
                .then(function (pair) {
                    var best = pickRicherMetaSnapshot(pair[0], pair[1]);
                    var emergency = readEmergencyMeta();
                    best = pickRicherMetaSnapshot(best, emergency);
                    if (applyRecoveredMeta(best)) {
                        return kvPut(metaCache).then(function () {
                            if (metaRichness(metaCache) > 0) return kvPutBackup(metaCache);
                        }).catch(function () {});
                    }
                    scheduleBackgroundMetaRecover();
                })
                .catch(function () {
                    scheduleBackgroundMetaRecover();
                });
        }, delay);
    }

    var lastEmergencyWriteAt = 0;
    var EMERGENCY_WRITE_MIN_GAP_MS = 1800;

    function writeEmergencyMetaThrottled(snapshot, force) {
        if (!snapshot) return;
        var now = Date.now();
        if (!force && now - lastEmergencyWriteAt < EMERGENCY_WRITE_MIN_GAP_MS) return;
        lastEmergencyWriteAt = now;
        writeEmergencyMeta(snapshot);
    }

    function persistMetaSnapshot(normalized, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        writeEmergencyMetaThrottled(normalized, !!opts.forceEmergency);
        return kvPut(normalized).then(function (ok) {
            /* 常规热路径跳过备份双写；pagehide / flush 再写备份 */
            if (opts.withBackup && metaRichness(normalized) > 0) {
                return kvPutBackup(normalized).then(function () { return ok; }, function () { return ok; });
            }
            return ok;
        });
    }

    function loadMeta() {
        if (metaCache) return Promise.resolve(metaCache);
        var fromLs = null;
        var lsPlaceholder = false;
        try {
            var raw = localStorage.getItem(META_LS);
            if (raw) {
                if (global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw)) {
                    lsPlaceholder = true;
                } else {
                    var p = JSON.parse(raw);
                    if (p && p.__storedInIdb) lsPlaceholder = true;
                    else fromLs = p;
                }
            }
        } catch (e) {}
        function hydrateFromSnapshots(idb) {
            var idbOk = metaIsValidSnapshot(idb);
            var emergency = readEmergencyMeta();
            var emergencyOk = metaIsValidSnapshot(emergency);
            if (idbOk) {
                var picked = emergencyOk ? pickRicherMetaSnapshot(idb, emergency) : idb;
                metaCache = normalizeMeta(picked);
                invalidateLookupCache();
                clearMetaHydrateGuard();
                if (emergencyOk && metaRichness(emergency) > metaRichness(idb)) {
                    metaCache = normalizeMeta(emergency);
                    invalidateLookupCache();
                    return persistMetaSnapshot(metaCache, { withBackup: true, forceEmergency: true })
                        .then(function () { return metaCache; });
                }
                if (metaRichness(metaCache) > 0) {
                    kvPutBackup(metaCache).catch(function () {});
                }
                return metaCache;
            }
            if (emergencyOk) {
                metaCache = normalizeMeta(emergency);
                invalidateLookupCache();
                clearMetaHydrateGuard();
                return persistMetaSnapshot(metaCache, { withBackup: true, forceEmergency: true })
                    .then(function () { return metaCache; });
            }
            if (fromLs && !lsPlaceholder) {
                metaCache = normalizeMeta(fromLs);
                invalidateLookupCache();
                clearMetaHydrateGuard();
                return persistMetaSnapshot(metaCache, { withBackup: true, forceEmergency: true })
                    .then(function () { return metaCache; });
            }
            if (lsPlaceholder) {
                return Promise.reject(new Error('meta_idb_hydrate_failed'));
            }
            metaCache = defaultMeta();
            invalidateLookupCache();
            return metaCache;
        }
        function fetchPrimaryWithRetry(attempt) {
            return Promise.all([kvGet(), kvGetBackup()]).then(function (pair) {
                var best = pickRicherMetaSnapshot(pair[0], pair[1]);
                if (lsPlaceholder && !metaIsValidSnapshot(best) && attempt < 6) {
                    var delay = attempt === 0 ? 120
                        : attempt === 1 ? 280
                            : attempt === 2 ? 500
                                : attempt === 3 ? 900
                                    : attempt === 4 ? 1600
                                        : 2800;
                    return new Promise(function (resolve) {
                        setTimeout(function () { resolve(fetchPrimaryWithRetry(attempt + 1)); }, delay);
                    });
                }
                return hydrateFromSnapshots(best);
            });
        }
        return fetchPrimaryWithRetry(0).catch(function (err) {
            if (err && err.message === 'meta_idb_hydrate_failed') throw err;
            return hydrateFromSnapshots(null);
        });
    }

    function normalizeMeta(m) {
        var d = defaultMeta();
        if (!m || typeof m !== 'object') return d;
        m.version = m.version || 2;
        m.profiles = Array.isArray(m.profiles) ? m.profiles : [];
        m.emojiGroups = Array.isArray(m.emojiGroups) && m.emojiGroups.length
            ? m.emojiGroups
            : d.emojiGroups;
        m.emojiGroups.forEach(function (g) {
            if (!g || typeof g !== 'object') return;
            if (g.id === 'default') {
                g.scope = 'global';
                g.contactIds = [];
            } else {
                if (!g.scope) g.scope = 'global';
                if (!Array.isArray(g.contactIds)) g.contactIds = [];
            }
        });
        m.emojiPacks = Array.isArray(m.emojiPacks) ? m.emojiPacks : [];
        m.savedMessages = Array.isArray(m.savedMessages) ? m.savedMessages : [];
        m.contactGroups = Array.isArray(m.contactGroups) && m.contactGroups.length
            ? m.contactGroups
            : d.contactGroups;
        m.contacts = Array.isArray(m.contacts) ? m.contacts : [];
        m.chats = Array.isArray(m.chats) ? m.chats : [];
        m.messagesByChat = m.messagesByChat && typeof m.messagesByChat === 'object' ? m.messagesByChat : {};
        m.shopCatalog = normalizeShopCatalog(m.shopCatalog);
        m.cstoreMystical = normalizeCstoreMystical(m.cstoreMystical);
        m.chatWallpapers = Array.isArray(m.chatWallpapers)
            ? m.chatWallpapers.map(normalizeChatWallpaper).filter(Boolean)
            : [];
        m.profiles.forEach(function (p) {
            if (!p || typeof p !== 'object') return;
            if (!Array.isArray(p.inventory)) p.inventory = [];
        });
        m.contactGroups.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
        return m;
    }

    var CSTORE_MYSTICAL_CATS = { timeline: true, wish: true, antique: true, intel: true };

    function normalizeCstoreMysticalItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var name = String(raw.name || '').trim();
        if (!name) return null;
        var cat = String(raw.category || '').trim();
        if (!CSTORE_MYSTICAL_CATS[cat]) cat = 'antique';
        var rarity = String(raw.rarity || '').trim();
        if (rarity !== 'rare' && rarity !== 'legendary') rarity = 'common';
        return {
            id: String(raw.id || uid('cst')).trim(),
            name: name.slice(0, 80),
            category: cat,
            tag: String(raw.tag || '').trim().slice(0, 4).toUpperCase() || (
                cat === 'timeline' ? 'CHR' : cat === 'wish' ? 'WSH' : cat === 'intel' ? 'INT' : 'REL'
            ),
            emoji: String(raw.emoji || '').trim().slice(0, 4) || '✦',
            desc: String(raw.desc || '').trim().slice(0, 200),
            exchangeHint: String(raw.exchangeHint || raw.exchange || '').trim().slice(0, 120),
            rarity: rarity
        };
    }

    function normalizeCstoreMystical(raw) {
        var d = { refreshedAt: 0, items: [] };
        if (!raw || typeof raw !== 'object') return d;
        var items = Array.isArray(raw.items)
            ? raw.items.map(normalizeCstoreMysticalItem).filter(Boolean)
            : [];
        return { refreshedAt: Number(raw.refreshedAt) || 0, items: items };
    }

    function inventoryContentRaw(raw) {
        if (raw == null) return null;
        if (typeof raw === 'object') return raw;
        var s = String(raw).trim();
        if (!s || s === '[object Object]') return null;
        if ((s.charAt(0) === '{' && s.charAt(s.length - 1) === '}') ||
            (s.charAt(0) === '[' && s.charAt(s.length - 1) === ']')) {
            try { return JSON.parse(s); } catch (e) {}
        }
        return s;
    }

    function inventoryContentText(raw) {
        var fn = global.miyaCstoreBridge && global.miyaCstoreBridge.normalizeContent;
        var val = inventoryContentRaw(raw);
        if (val == null) return '';
        if (typeof val === 'object') {
            if (fn) return fn(val).slice(0, 4000);
            try { return JSON.stringify(val, null, 2).slice(0, 4000); } catch (e2) { return ''; }
        }
        return String(val).slice(0, 4000);
    }

    function normalizeInventoryItem(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var name = String(raw.name || '').trim();
        if (!name) return null;
        var price = Number(raw.price);
        if (!Number.isFinite(price) || price < 0) price = 0;
        var kind = String(raw.kind || '').trim() === 'mystical' ? 'mystical' : 'normal';
        var cat = String(raw.category || '').trim().slice(0, 40) || '物品';
        var mysticalType = String(raw.mysticalType || '').trim();
        if (kind === 'mystical' && !CSTORE_MYSTICAL_CATS[mysticalType]) mysticalType = 'antique';
        return {
            id: String(raw.id || uid('inv')).trim(),
            name: name.slice(0, 80),
            tag: String(raw.tag || '').trim().slice(0, 4).toUpperCase(),
            emoji: String(raw.emoji || '').trim().slice(0, 4) || '📦',
            desc: String(raw.desc || '').trim().slice(0, 200),
            price: Math.round(price * 100) / 100,
            category: cat,
            kind: kind,
            mysticalType: kind === 'mystical' ? mysticalType : '',
            purchasedAt: Number(raw.purchasedAt) || Date.now(),
            content: inventoryContentRaw(raw.content),
            targetContactId: String(raw.targetContactId || '').trim(),
            targetName: String(raw.targetName || '').trim().slice(0, 40)
        };
    }

    function defaultChatSettings() {
        var tz = 'Asia/Shanghai';
        try {
            tz =
                (Intl && Intl.DateTimeFormat && Intl.DateTimeFormat().resolvedOptions().timeZone) ||
                tz;
        } catch (eTz) {}
        return {
            memoryCount: 40,
            attachCount: 200,
            messageRenderLimit: 100,
            summaryTrigger: 0,
            summaryPrompt: '',
            summaryLength: '100-300字',
            summaryList: [],
            megaSummaryList: [],
            charMemoryList: [],
            memoryAutoRoundTrigger: 0,
            memoryAutoPrompt: '',
            megaSummaryPrompt: '',
            roleReplyBubbleMin: 1,
            roleReplyBubbleMax: 5,
            replyBannerEnabled: true,
            muteNotifications: false,
            onlineNarrationEnabled: false,
            onlineNarrationInjectContext: true,
            onlineNarrationCharPerson: '3',
            onlineNarrationUserPerson: '2',
            autoTranslate: false,
            translateMode: 'semantic',
            translateTarget: 'zh-CN',
            momentsTranslate: false,
            relationship: '',
            background: '',
            backgroundId: null,
            chatBeautify: {
                wallpaperMode: 'none',
                wallpaperId: null,
                wallpaperUrl: '',
                themeId: 'gallery',
                customCss: '',
                bubbleMeCss: '',
                bubbleThemCss: '',
                hvCustomCss: '',
                presetName: ''
            },
            timeAwareness: { enabled: false, mode: 'real', real: { userTz: tz, roleTz: tz, strength: 'strong' } },
            weatherAwareness: {
                enabled: false,
                placeUser: '',
                placeRole: '',
                realLocUser: '',
                realLocRole: ''
            },
            locationAwareness: { enabled: false, label: '' },
            backgroundMessage: {
                activeEnabled: false,
                activeIntervalMin: 30,
                activityEnabled: false,
                lastAutoPushAt: 0,
                lastProactiveAttemptAt: 0,
                lastPushFailAt: 0,
                quietEnabled: false,
                quietStartMin: 1380,
                quietEndMin: 420,
                offlineEnabled: false,
                offlineIntervalMin: 60,
                offlineIntervalMax: 240,
                lastOfflineAt: 0,
                offlineRollAnchor: 0,
                offlineRollGapMs: 0,
                proactiveBaselineAt: 0,
                activeEnabledAt: 0,
                lifeLikeEnabled: false,
                lifeLikeNextPushAt: 0,
                lifeLikeNextPushAnchorTs: 0,
                lifeLikeEnabledAt: 0
            },
            videoCallEnabled: true,
            callBackground: { mode: 'none', url: '', blobId: '' },
            blocked: false,
            promptCapabilities: {
                gift: true,
                takeout: true,
                song: true,
                shop: true,
                call: true,
                countdown: true
            },
            minimaxVoiceId: '',
            minimaxLanguageBoost: 'auto',
            memberRemarks: {},
            groupOwnerId: '__user__',
            groupAdminIds: [],
            memberTitles: {},
            groupWorldbookEntryIds: [],
            groupWorldbookDisabledEntryIds: [],
            groupHeartVoice: null,
            groupTheaterPresets: [],
            groupTheaterHistory: [],
            groupTheaterLastId: '',
            groupAvatar: '',
            groupAvatarBlobId: null,
            memoryInterop: true,
            avatarRecognition: {
                enabled: false,
                contactDesc: '',
                profileDesc: '',
                contactImageId: null,
                profileImageId: null,
                updatedAt: 0
            },
            chatDisplayAvatars: {
                contactUrl: '',
                contactBlobId: null,
                contactDesc: '',
                contactSourceMsgId: '',
                profileUrl: '',
                profileBlobId: null,
                profileDesc: '',
                profileSourceMsgId: ''
            },
            dynamicAvatar: {
                charEnabled: false,
                userEnabled: false
            },
            imageGen: {
                enabled: false,
                customPrompt: '',
                refUrl: '',
                refBlobId: null
            },
            operationRulesPreset: '',
            thinkingRulesPreset: '',
            heartVoicePreset: '',
            heartVoicePresetSnapshot: null
        };
    }

    var AVATAR_RECOGNITION_DESC_MAX = 8000;

    function defaultDisplayAvatar() {
        return { url: '', blobId: null, desc: '', sourceMsgId: '' };
    }

    function normalizeDisplayAvatar(raw) {
        var d = defaultDisplayAvatar();
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        return {
            url: String(raw.url || '').trim(),
            blobId: raw.blobId ? String(raw.blobId) : null,
            desc: String(raw.desc || '').trim().slice(0, 800),
            sourceMsgId: String(raw.sourceMsgId || '').trim()
        };
    }

    function displayAvatarHasData(da) {
        da = normalizeDisplayAvatar(da);
        return !!(da.url || da.blobId || da.desc);
    }

    function legacyContactDisplayFromChatSettings(da) {
        da = normalizeChatDisplayAvatars(da);
        if (!da.contactUrl && !da.contactBlobId && !da.contactDesc) return null;
        return normalizeDisplayAvatar({
            url: da.contactUrl,
            blobId: da.contactBlobId,
            desc: da.contactDesc,
            sourceMsgId: da.contactSourceMsgId
        });
    }

    function legacyProfileDisplayFromChatSettings(da) {
        da = normalizeChatDisplayAvatars(da);
        if (!da.profileUrl && !da.profileBlobId && !da.profileDesc) return null;
        return normalizeDisplayAvatar({
            url: da.profileUrl,
            blobId: da.profileBlobId,
            desc: da.profileDesc,
            sourceMsgId: da.profileSourceMsgId
        });
    }

    function resolveDisplayAvatarSync(da) {
        da = normalizeDisplayAvatar(da);
        var url = String(da.url || '').trim();
        if (url) return url;
        var blobId = da.blobId ? String(da.blobId) : '';
        if (blobId && urlCache[blobId]) return urlCache[blobId];
        return '';
    }

    /** 同步解析展示头像：URL、已缓存 blob，或未缓存时的 blobId（供懒加载） */
    function resolveDisplayAvatarKey(da) {
        da = normalizeDisplayAvatar(da);
        var url = String(da.url || '').trim();
        if (url) return url;
        var blobId = da.blobId ? String(da.blobId) : '';
        if (!blobId) return '';
        if (urlCache[blobId]) return urlCache[blobId];
        return blobId;
    }

    function resolveDisplayAvatarAsync(da) {
        var sync = resolveDisplayAvatarSync(da);
        if (sync) return Promise.resolve(sync);
        da = normalizeDisplayAvatar(da);
        if (!da.blobId) return Promise.resolve('');
        return store.getAvatarUrl(da.blobId).then(function (url) {
            return url || '';
        }).catch(function () {
            return '';
        });
    }

    function findLegacyContactDisplayAvatar(contactId) {
        var cid = String(contactId || '').trim();
        if (!cid || !metaCache) return null;
        var best = null;
        var bestAt = 0;
        (metaCache.chats || []).forEach(function (ch) {
            if (String(ch.contactId || '') !== cid) return;
            var legacy = legacyContactDisplayFromChatSettings(
                ch.chatSettings && ch.chatSettings.chatDisplayAvatars
            );
            if (!legacy) return;
            var at = Number(ch.lastAt) || 0;
            if (!best || at >= bestAt) {
                best = legacy;
                bestAt = at;
            }
        });
        return best;
    }

    function findLegacyProfileDisplayAvatar(profileId) {
        var pid = String(profileId || '').trim();
        if (!pid || !metaCache) return null;
        var best = null;
        var bestAt = 0;
        (metaCache.chats || []).forEach(function (ch) {
            if (String(ch.profileId || '') !== pid) return;
            var legacy = legacyProfileDisplayFromChatSettings(
                ch.chatSettings && ch.chatSettings.chatDisplayAvatars
            );
            if (!legacy) return;
            var at = Number(ch.lastAt) || 0;
            if (!best || at >= bestAt) {
                best = legacy;
                bestAt = at;
            }
        });
        return best;
    }

    function getContactDisplayAvatarRecord(contact) {
        if (!contact) return normalizeDisplayAvatar(null);
        var own = normalizeDisplayAvatar(contact.displayAvatar);
        if (displayAvatarHasData(own)) return own;
        var legacy = findLegacyContactDisplayAvatar(contact.id);
        return legacy || own;
    }

    function getProfileDisplayAvatarRecord(profile) {
        if (!profile) return normalizeDisplayAvatar(null);
        var own = normalizeDisplayAvatar(profile.displayAvatar);
        if (displayAvatarHasData(own)) return own;
        var legacy = findLegacyProfileDisplayAvatar(profile.id);
        return legacy || own;
    }

    function migrateLegacyChatDisplayAvatars() {
        if (!metaCache) return Promise.resolve(false);
        var dirty = false;
        (metaCache.contacts || []).forEach(function (ct, idx) {
            var cur = metaCache.contacts[idx];
            if (!cur || displayAvatarHasData(cur.displayAvatar)) return;
            var legacy = findLegacyContactDisplayAvatar(cur.id);
            if (!legacy) return;
            metaCache.contacts[idx] = normalizeContact(Object.assign({}, cur, { displayAvatar: legacy }));
            dirty = true;
        });
        (metaCache.profiles || []).forEach(function (prof, idx) {
            var cur = metaCache.profiles[idx];
            if (!cur || displayAvatarHasData(cur.displayAvatar)) return;
            var legacy = findLegacyProfileDisplayAvatar(prof.id);
            if (!legacy) return;
            metaCache.profiles[idx] = normalizeProfile(Object.assign({}, cur, { displayAvatar: legacy }));
            dirty = true;
        });
        if (!dirty) return Promise.resolve(false);
        return saveMeta().then(function () { return true; });
    }

    function normalizeChatDisplayAvatars(raw) {
        var d = defaultChatSettings().chatDisplayAvatars;
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        return {
            contactUrl: String(raw.contactUrl || '').trim(),
            contactBlobId: raw.contactBlobId ? String(raw.contactBlobId) : null,
            contactDesc: String(raw.contactDesc || '').trim().slice(0, 800),
            contactSourceMsgId: String(raw.contactSourceMsgId || '').trim(),
            profileUrl: String(raw.profileUrl || '').trim(),
            profileBlobId: raw.profileBlobId ? String(raw.profileBlobId) : null,
            profileDesc: String(raw.profileDesc || '').trim().slice(0, 800),
            profileSourceMsgId: String(raw.profileSourceMsgId || '').trim()
        };
    }

    function normalizeDynamicAvatar(raw) {
        var d = defaultChatSettings().dynamicAvatar;
        if (global.MiyaChatDynamicAvatar && typeof global.MiyaChatDynamicAvatar.normalizeDynamicAvatar === 'function') {
            return global.MiyaChatDynamicAvatar.normalizeDynamicAvatar(raw || d);
        }
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        return {
            charEnabled: !!raw.charEnabled,
            userEnabled: !!raw.userEnabled
        };
    }

    function normalizeContactImageGen(raw) {
        var d = defaultChatSettings().imageGen;
        if (global.MiyaImageGen && typeof global.MiyaImageGen.normalizeContactImageGen === 'function') {
            return global.MiyaImageGen.normalizeContactImageGen(raw || d);
        }
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        return {
            enabled: !!raw.enabled,
            customPrompt: String(raw.customPrompt || '').trim().slice(0, 4000),
            refUrl: String(raw.refUrl || '').trim(),
            refBlobId: raw.refBlobId ? String(raw.refBlobId) : null
        };
    }

    function normalizeAvatarRecognition(raw) {
        var d = defaultChatSettings().avatarRecognition;
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        var at = Number(raw.updatedAt);
        return {
            enabled: !!raw.enabled,
            contactDesc: String(raw.contactDesc || '').trim().slice(0, AVATAR_RECOGNITION_DESC_MAX),
            profileDesc: String(raw.profileDesc || '').trim().slice(0, AVATAR_RECOGNITION_DESC_MAX),
            contactImageId: raw.contactImageId ? String(raw.contactImageId) : null,
            profileImageId: raw.profileImageId ? String(raw.profileImageId) : null,
            updatedAt: Number.isFinite(at) && at > 0 ? at : 0
        };
    }

    function normalizeChatBeautify(raw) {
        var d = defaultChatSettings().chatBeautify;
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        var themeId =
            ['gallery', 'ins', 'blossom', 'custom'].indexOf(raw.themeId) >= 0 ? raw.themeId : d.themeId;
        return {
            wallpaperMode: ['none', 'idb', 'url'].indexOf(raw.wallpaperMode) >= 0 ? raw.wallpaperMode : d.wallpaperMode,
            wallpaperId: raw.wallpaperId ? String(raw.wallpaperId) : null,
            wallpaperUrl: String(raw.wallpaperUrl || '').trim(),
            themeId: raw.customCss ? 'custom' : (themeId === 'custom' ? 'custom' : themeId),
            customCss: String(raw.customCss || ''),
            bubbleMeCss: '',
            bubbleThemCss: '',
            hvCustomCss: String(raw.hvCustomCss || ''),
            presetName: String(raw.presetName || '').trim()
        };
    }

    function normalizePromptCapabilities(raw) {
        var d = defaultChatSettings().promptCapabilities;
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        return {
            gift: raw.gift !== false,
            takeout: raw.takeout !== false,
            song: raw.song !== false,
            shop: raw.shop !== false,
            call: raw.call !== false,
            countdown: raw.countdown !== false
        };
    }

    function normalizeChatSettings(raw) {
        var d = defaultChatSettings();
        if (!raw || typeof raw !== 'object') return d;
        var out = Object.assign({}, d, raw);
        out.memoryCount = Math.min(500, Math.max(1, Number(out.memoryCount) || d.memoryCount));
        out.attachCount = Math.min(500, Math.max(1, Number(out.attachCount) || d.attachCount));
        out.messageRenderLimit = Math.min(500, Math.max(20, Number(out.messageRenderLimit) || d.messageRenderLimit));
        out.roleReplyBubbleMin = Math.min(15, Math.max(1, Number(out.roleReplyBubbleMin) || 1));
        out.roleReplyBubbleMax = Math.min(15, Math.max(out.roleReplyBubbleMin, Number(out.roleReplyBubbleMax) || 5));
        out.replyBannerEnabled = out.replyBannerEnabled !== false;
        out.muteNotifications = !!out.muteNotifications;
        out.onlineNarrationEnabled = !!out.onlineNarrationEnabled;
        out.onlineNarrationInjectContext = out.onlineNarrationInjectContext !== false;
        out.onlineNarrationCharPerson =
            ['1', '2', '3'].indexOf(String(out.onlineNarrationCharPerson || '').trim()) >= 0
                ? String(out.onlineNarrationCharPerson).trim()
                : '3';
        out.onlineNarrationUserPerson =
            ['1', '2', '3'].indexOf(String(out.onlineNarrationUserPerson || '').trim()) >= 0
                ? String(out.onlineNarrationUserPerson).trim()
                : '2';
        out.autoTranslate = !!out.autoTranslate;
        out.translateMode = 'semantic';
        out.translateTarget =
            ['zh-CN', 'yue', 'zh-TW', 'wuu'].indexOf(String(out.translateTarget || 'zh-CN').trim()) >= 0
                ? String(out.translateTarget || 'zh-CN').trim()
                : 'zh-CN';
        out.momentsTranslate = !!out.momentsTranslate;
        out.summaryTrigger = Math.min(500, Math.max(0, parseInt(out.summaryTrigger, 10) || 0));
        if (out.summaryTrigger === 'off') out.summaryTrigger = 0;
        out.summaryPrompt = String(out.summaryPrompt || '').trim();
        out.summaryLength = String(out.summaryLength || d.summaryLength).trim() || d.summaryLength;
        if (!Array.isArray(out.summaryList)) out.summaryList = [];
        if (!Array.isArray(out.megaSummaryList)) out.megaSummaryList = [];
        if (!Array.isArray(out.charMemoryList)) out.charMemoryList = [];
        out.memoryAutoRoundTrigger = Math.min(500, Math.max(0, parseInt(out.memoryAutoRoundTrigger, 10) || 0));
        out.memoryAutoPrompt = String(out.memoryAutoPrompt || '').trim();
        out.megaSummaryPrompt = String(out.megaSummaryPrompt || '').trim();
        if (!Array.isArray(out.momentsMemoryList)) out.momentsMemoryList = [];
        out.momentsMemoryInterop = out.momentsMemoryInterop !== false;
        if (out.momentsAuto && typeof out.momentsAuto === 'object') {
            out.momentsAuto = Object.assign(
                { mode: 'off', roundInterval: 0, hourInterval: 0, roundAnchorEnd: 0 },
                out.momentsAuto
            );
            var maMode = String(out.momentsAuto.mode || 'off').trim().toLowerCase();
            if (maMode === 'low') {
                maMode = 'hours';
                out.momentsAuto.hourInterval = 72;
            } else if (maMode === 'medium') {
                maMode = 'hours';
                out.momentsAuto.hourInterval = 36;
            } else if (maMode === 'high') {
                maMode = 'hours';
                out.momentsAuto.hourInterval = 16;
            } else if (maMode === 'custom') {
                var maLegacyMin = parseInt(out.momentsAuto.customMinH, 10);
                var maLegacyMax = parseInt(out.momentsAuto.customMaxH, 10);
                if (maLegacyMin > 0 && maLegacyMax > 0) {
                    maMode = 'hours';
                    if (maLegacyMax < maLegacyMin) {
                        var maLegacySwap = maLegacyMin;
                        maLegacyMin = maLegacyMax;
                        maLegacyMax = maLegacySwap;
                    }
                    out.momentsAuto.hourInterval = Math.min(720, Math.max(1, maLegacyMin));
                } else {
                    maMode = 'off';
                }
            }
            if (maMode === 'rounds') {
                out.momentsAuto.roundInterval = Math.min(
                    500,
                    Math.max(1, parseInt(out.momentsAuto.roundInterval, 10) || 0)
                );
                if (out.momentsAuto.roundInterval <= 0) maMode = 'off';
            } else if (maMode === 'hours') {
                out.momentsAuto.hourInterval = Math.min(
                    720,
                    Math.max(1, parseInt(out.momentsAuto.hourInterval, 10) || 0)
                );
                if (out.momentsAuto.hourInterval <= 0) maMode = 'off';
            } else {
                maMode = 'off';
            }
            out.momentsAuto.mode = maMode;
            out.momentsAuto.roundAnchorEnd = Math.max(0, parseInt(out.momentsAuto.roundAnchorEnd, 10) || 0);
            if (maMode === 'off') {
                out.momentsAuto.roundInterval = 0;
                out.momentsAuto.hourInterval = 0;
            }
        } else {
            out.momentsAuto = { mode: 'off', roundInterval: 0, hourInterval: 0, roundAnchorEnd: 0 };
        }
        out.momentsMemoryList = out.momentsMemoryList.map(function (row, i) {
            if (!row || typeof row !== 'object') return row;
            var id = String(row.id || '').trim();
            if (!id) id = 'mmem_' + Date.now().toString(36) + '_' + i;
            return Object.assign({}, row, { id: id });
        });
        out.charMemoryList = out.charMemoryList.map(function (row, i) {
            if (!row || typeof row !== 'object') return row;
            var id = String(row.id || '').trim();
            if (!id) id = 'cmem_' + Date.now().toString(36) + '_' + i;
            return Object.assign({}, row, { id: id });
        });
        out.summaryList = out.summaryList.map(function (row, i) {
            if (!row || typeof row !== 'object') return row;
            var id = String(row.id || '').trim();
            if (!id) {
                /* 稳定 id：避免每次 normalize 用 Date.now 换新 id，导致合卷 sourceSummaryIds 对不上 */
                id =
                    'sum_s' +
                    String(row.startIndex || 0) +
                    '_e' +
                    String(row.endIndex || 0) +
                    '_c' +
                    String(row.createdAt || 0) +
                    '_i' +
                    i +
                    '_n' +
                    String(row.content || '').length;
            }
            return Object.assign({}, row, { id: id });
        });
        out.megaSummaryList = out.megaSummaryList.map(function (row, i) {
            if (!row || typeof row !== 'object') return row;
            var id = String(row.id || '').trim();
            if (!id) {
                id =
                    'mega_s' +
                    String(row.startIndex || 0) +
                    '_e' +
                    String(row.endIndex || 0) +
                    '_c' +
                    String(row.createdAt || 0) +
                    '_i' +
                    i +
                    '_n' +
                    String(row.content || '').length;
            }
            var src = Array.isArray(row.sourceSummaryIds)
                ? row.sourceSummaryIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
                : [];
            return Object.assign({}, row, { id: id, sourceSummaryIds: src });
        });

        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.normalizeTimeAwareness === 'function') {
            out.timeAwareness = aw.normalizeTimeAwareness(out.timeAwareness);
        } else if (!out.timeAwareness || typeof out.timeAwareness !== 'object') {
            out.timeAwareness = d.timeAwareness;
        }
        if (aw && typeof aw.normalizeWeatherAwareness === 'function') {
            out.weatherAwareness = aw.normalizeWeatherAwareness(out.weatherAwareness);
        } else if (!out.weatherAwareness || typeof out.weatherAwareness !== 'object') {
            out.weatherAwareness = d.weatherAwareness;
        }
        if (!out.locationAwareness || typeof out.locationAwareness !== 'object') out.locationAwareness = d.locationAwareness;
        out.promptCapabilities = normalizePromptCapabilities(out.promptCapabilities);
        out.chatBeautify = normalizeChatBeautify(out.chatBeautify);
        out.operationRulesPreset = String(
            out.operationRulesPreset != null
                ? out.operationRulesPreset
                : (out.operationRules && out.operationRules.presetName) || ''
        ).trim();
        out.thinkingRulesPreset = String(
            out.thinkingRulesPreset != null
                ? out.thinkingRulesPreset
                : (out.thinkingRules && out.thinkingRules.presetName) || ''
        ).trim();
        out.heartVoicePreset = String(
            out.heartVoicePreset != null ? out.heartVoicePreset : ''
        ).trim();
        if (!out.heartVoicePreset) {
            out.heartVoicePresetSnapshot = null;
        } else if (out.heartVoicePresetSnapshot && typeof out.heartVoicePresetSnapshot === 'object') {
            var hvSnapMod = global.MiyaChatHeartVoiceTemplates;
            if (hvSnapMod && typeof hvSnapMod.buildSnapshotFromPreset === 'function') {
                out.heartVoicePresetSnapshot = hvSnapMod.buildSnapshotFromPreset(
                    Object.assign({}, out.heartVoicePresetSnapshot, { name: out.heartVoicePreset })
                );
            } else {
                out.heartVoicePresetSnapshot = {
                    name: out.heartVoicePreset,
                    customPrompt: String(out.heartVoicePresetSnapshot.customPrompt || ''),
                    fields: Array.isArray(out.heartVoicePresetSnapshot.fields)
                        ? out.heartVoicePresetSnapshot.fields
                        : [],
                    htmlTemplate: String(out.heartVoicePresetSnapshot.htmlTemplate || ''),
                    savedAt: out.heartVoicePresetSnapshot.savedAt || Date.now()
                };
                if (!out.heartVoicePresetSnapshot.fields.length) out.heartVoicePresetSnapshot = null;
            }
        } else {
            out.heartVoicePresetSnapshot = null;
        }

        if (!out.backgroundMessage || typeof out.backgroundMessage !== 'object') out.backgroundMessage = {};
        var bm = Object.assign({}, d.backgroundMessage, out.backgroundMessage);
        if (typeof bm.activeEnabled !== 'boolean') {
            if (bm.mode === 'active') bm.activeEnabled = true;
            if (bm.mode === 'off' || bm.mode === 'none') bm.activeEnabled = false;
        }
        bm.activeEnabled = !!bm.activeEnabled;
        bm.activityEnabled = !!bm.activityEnabled;
        bm.offlineEnabled = !!bm.offlineEnabled;
        if (!bm.activeEnabled) bm.mode = 'off';
        else if (bm.mode === 'off' || bm.mode === 'none') bm.mode = 'active';
        if (!Number.isFinite(Number(bm.lastProactiveAttemptAt))) bm.lastProactiveAttemptAt = 0;
        if (!Number.isFinite(Number(bm.lastPushFailAt))) bm.lastPushFailAt = 0;
        if (!Number.isFinite(Number(bm.proactiveBaselineAt))) bm.proactiveBaselineAt = 0;
        if (!Number.isFinite(Number(bm.activeEnabledAt))) bm.activeEnabledAt = 0;
        bm.activeIntervalMin = Math.min(1440, Math.max(1, parseInt(bm.activeIntervalMin, 10) || 30));
        bm.offlineIntervalMin = Math.min(10080, Math.max(5, parseInt(bm.offlineIntervalMin, 10) || 60));
        bm.offlineIntervalMax = Math.min(
            10080,
            Math.max(bm.offlineIntervalMin, parseInt(bm.offlineIntervalMax, 10) || 240)
        );
        bm.quietEnabled = !!bm.quietEnabled;
        bm.quietStartMin = Math.min(1439, Math.max(0, parseInt(bm.quietStartMin, 10) || 1380));
        bm.quietEndMin = Math.min(1439, Math.max(0, parseInt(bm.quietEndMin, 10) || 420));
        if (global.MiyaChatLifeLike && typeof global.MiyaChatLifeLike.normalizeLifeLikeFields === 'function') {
            bm = global.MiyaChatLifeLike.normalizeLifeLikeFields(bm);
        } else {
            bm.lifeLikeEnabled = !!bm.lifeLikeEnabled;
            if (!Number.isFinite(Number(bm.lifeLikeNextPushAt))) {
                bm.lifeLikeNextPushAt = Number(bm.lifeLikeNextCheckAt) || 0;
            }
            if (!Number.isFinite(Number(bm.lifeLikeEnabledAt))) bm.lifeLikeEnabledAt = 0;
        }
        if (bm.lifeLikeEnabled) {
            bm.activeEnabled = false;
            bm.offlineEnabled = false;
        }
        out.backgroundMessage = bm;
        out.minimaxVoiceId = String(out.minimaxVoiceId || '').trim();
        out.minimaxLanguageBoost = String(out.minimaxLanguageBoost || 'auto').trim() || 'auto';
        if (!out.memberRemarks || typeof out.memberRemarks !== 'object') out.memberRemarks = {};
        else {
            var mr = {};
            Object.keys(out.memberRemarks).forEach(function (k) {
                var v = String(out.memberRemarks[k] || '').trim();
                if (v) mr[String(k).trim()] = v;
            });
            out.memberRemarks = mr;
        }
        var ownerRaw = String(out.groupOwnerId || '').trim();
        out.groupOwnerId = ownerRaw || '__user__';
        if (!Array.isArray(out.groupAdminIds)) out.groupAdminIds = [];
        else {
            var adminSeen = {};
            out.groupAdminIds = out.groupAdminIds
                .map(function (id) {
                    return String(id || '').trim();
                })
                .filter(function (id) {
                    if (!id || adminSeen[id]) return false;
                    adminSeen[id] = true;
                    return true;
                });
        }
        if (!out.memberTitles || typeof out.memberTitles !== 'object') out.memberTitles = {};
        else {
            var mt = {};
            Object.keys(out.memberTitles).forEach(function (k) {
                var row = out.memberTitles[k];
                if (!row || typeof row !== 'object') return;
                var nm = String(row.name || '').trim();
                if (!nm) return;
                var col = String(row.color || '').trim();
                mt[String(k).trim()] = {
                    name: nm.slice(0, 16),
                    color: /^#[0-9a-fA-F]{6}$/.test(col) ? col : '#8b7355'
                };
            });
            out.memberTitles = mt;
        }
        if (!Array.isArray(out.groupWorldbookEntryIds)) out.groupWorldbookEntryIds = [];
        else {
            var wbSeen = {};
            out.groupWorldbookEntryIds = out.groupWorldbookEntryIds
                .map(function (id) {
                    return String(id || '').trim();
                })
                .filter(function (id) {
                    if (!id || wbSeen[id]) return false;
                    wbSeen[id] = true;
                    return true;
                });
        }
        if (!Array.isArray(out.groupWorldbookDisabledEntryIds)) out.groupWorldbookDisabledEntryIds = [];
        else {
            var wbOffSeen = {};
            out.groupWorldbookDisabledEntryIds = out.groupWorldbookDisabledEntryIds
                .map(function (id) {
                    return String(id || '').trim();
                })
                .filter(function (id) {
                    if (!id || wbOffSeen[id]) return false;
                    wbOffSeen[id] = true;
                    return true;
                });
        }
        if (out.groupHeartVoice && typeof out.groupHeartVoice === 'object') {
            var ghv = out.groupHeartVoice;
            out.groupHeartVoice = {
                id: String(ghv.id || '').trim() || '',
                updatedAt: Number(ghv.updatedAt) || 0,
                inner: Array.isArray(ghv.inner) ? ghv.inner : [],
                banter: Array.isArray(ghv.banter) ? ghv.banter : []
            };
        } else {
            out.groupHeartVoice = null;
        }
        if (!Array.isArray(out.groupTheaterPresets)) out.groupTheaterPresets = [];
        else {
            out.groupTheaterPresets = out.groupTheaterPresets
                .map(function (row, i) {
                    if (!row || typeof row !== 'object') return null;
                    var prompt = String(row.prompt || '').trim();
                    if (!prompt) return null;
                    return {
                        id: String(row.id || '').trim() || 'gtp_' + i,
                        name: String(row.name || '').trim() || '预设',
                        prompt: prompt.slice(0, 2000),
                        createdAt: Number(row.createdAt) || 0
                    };
                })
                .filter(Boolean)
                .slice(0, 30);
        }
        if (!Array.isArray(out.groupTheaterHistory)) out.groupTheaterHistory = [];
        else {
            out.groupTheaterHistory = out.groupTheaterHistory
                .map(function (row, i) {
                    if (!row || typeof row !== 'object') return null;
                    var html = String(row.html || '').trim();
                    if (!html && !row.iframeSrcdoc) return null;
                    return {
                        id: String(row.id || '').trim() || 'gth_' + i,
                        prompt: String(row.prompt || '').trim().slice(0, 2000),
                        html: html,
                        raw: String(row.raw || '').trim(),
                        useIframe: !!row.useIframe,
                        iframeSrcdoc: String(row.iframeSrcdoc || ''),
                        createdAt: Number(row.createdAt) || 0
                    };
                })
                .filter(Boolean);
        }
        out.groupTheaterLastId = String(out.groupTheaterLastId || '').trim();
        out.avatarRecognition = normalizeAvatarRecognition(out.avatarRecognition);
        out.imageGen = normalizeContactImageGen(out.imageGen);
        out.chatDisplayAvatars = normalizeChatDisplayAvatars(out.chatDisplayAvatars);
        out.dynamicAvatar = normalizeDynamicAvatar(out.dynamicAvatar);
        out.groupAvatar = String(out.groupAvatar || '').trim();
        out.groupAvatarBlobId = String(out.groupAvatarBlobId || '').trim() || null;
        if (out.memoryInterop === undefined) out.memoryInterop = d.memoryInterop !== false;
        else out.memoryInterop = !!out.memoryInterop;
        var cb = raw.callBackground && typeof raw.callBackground === 'object' ? raw.callBackground : d.callBackground;
        out.callBackground = {
            mode: String(cb.mode || 'none').trim() || 'none',
            url: String(cb.url || '').trim(),
            blobId: String(cb.blobId || '').trim()
        };
        return out;
    }

    function chatBeautifyScore(raw) {
        var bf = normalizeChatBeautify(raw && raw.chatBeautify);
        var score = 0;
        if (bf.themeId && bf.themeId !== 'gallery') score += 2;
        if (String(bf.customCss || '').trim()) score += 5;
        if (bf.wallpaperMode && bf.wallpaperMode !== 'none') score += 3;
        if (String(bf.wallpaperUrl || '').trim() || bf.wallpaperId) score += 2;
        if (String(bf.hvCustomCss || '').trim()) score += 1;
        if (String(bf.presetName || '').trim()) score += 1;
        return score;
    }

    function mergeDupChatSettings(keepSettings, dupSettings) {
        var merged = normalizeChatSettings(keepSettings);
        var dup = normalizeChatSettings(dupSettings);
        if (chatBeautifyScore(dup) > chatBeautifyScore(merged)) {
            merged.chatBeautify = dup.chatBeautify;
        }
        if (!String(merged.background || '').trim() && String(dup.background || '').trim()) {
            merged.background = dup.background;
        }
        if (!merged.backgroundId && dup.backgroundId) merged.backgroundId = dup.backgroundId;
        if (!String(merged.relationship || '').trim() && String(dup.relationship || '').trim()) {
            merged.relationship = dup.relationship;
        }
        return normalizeChatSettings(merged);
    }

    function normalizeQuoteRef(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var text = String(raw.text || '').trim();
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.stripQuotePromptLeakage === 'function') {
            text = aw.stripQuotePromptLeakage(text);
        }
        if (!text) return null;
        var out = {
            dir: raw.dir === 'out' ? 'out' : 'in',
            text: text.slice(0, 200),
            ts: Number(raw.ts) || 0,
            msgId: String(raw.msgId || '').trim()
        };
        if (raw.imageDataKey) out.imageDataKey = String(raw.imageDataKey);
        if (raw.imageKind) out.imageKind = String(raw.imageKind);
        if (raw.msgType) out.msgType = String(raw.msgType);
        if (raw.stickerBlobId) out.stickerBlobId = String(raw.stickerBlobId);
        if (raw.stickerUrl) out.stickerUrl = String(raw.stickerUrl);
        if (raw.stickerName) out.stickerName = String(raw.stickerName);
        if (raw.speakerName) out.speakerName = String(raw.speakerName).trim().slice(0, 64);
        if (raw.senderContactId) out.senderContactId = String(raw.senderContactId).trim();
        return out;
    }

    function trimContactAvatarForStore(avatar) {
        var av = String(avatar || '').trim();
        if (!av) return '';
        if (av.length > 400000 && /^data:/i.test(av)) return '';
        return av;
    }

    function dataUrlToBlob(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string') return null;
        var parts = dataUrl.split(',');
        if (parts.length < 2) return null;
        var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
        try {
            var bin = atob(parts[1]);
            var u8 = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            return new Blob([u8], { type: mime });
        } catch (e) {
            return null;
        }
    }

    function spillLargeContactAvatarPatch(patch) {
        if (!patch || typeof patch !== 'object') return Promise.resolve(patch || {});
        var av = String(patch.avatar || '').trim();
        if (!av || !/^data:/i.test(av) || av.length <= 80000) return Promise.resolve(patch);
        var blob = dataUrlToBlob(av);
        if (!blob) return Promise.resolve(patch);
        return storeMediaBlob(blob, 'avatar').then(function (blobId) {
            var next = Object.assign({}, patch);
            next.avatar = '';
            next.avatarBlobId = blobId;
            return next;
        });
    }

    function normalizeContact(raw) {
        var walletRaw = raw && raw.wallet && typeof raw.wallet === 'object' ? raw.wallet : null;
        return {
            id: String(raw && raw.id ? raw.id : uid('ct')),
            chronicleId: String((raw && raw.chronicleId) || '').trim(),
            characterId: String((raw && raw.characterId) || '').trim(),
            groupId: String((raw && raw.groupId) || 'ct-default').trim() || 'ct-default',
            name: String((raw && raw.name) || '').trim(),
            remarkName: String((raw && raw.remarkName) || '').trim(),
            relationship: String((raw && raw.relationship) || '').trim(),
            avatar: trimContactAvatarForStore(raw && raw.avatar),
            avatarBlobId: String((raw && raw.avatarBlobId) || '').trim() || null,
            displayAvatar: normalizeDisplayAvatar(raw && raw.displayAvatar),
            defaultProfileId: String((raw && raw.defaultProfileId) || '').trim(),
            chatSettings: normalizeChatSettings(raw && raw.chatSettings),
            blocked: !!(raw && raw.blocked),
            pinned: !!(raw && raw.pinned),
            emojiGroupIds: Array.isArray(raw && raw.emojiGroupIds)
                ? raw.emojiGroupIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
                : [],
            worldbookEntryOrder: Array.isArray(raw && raw.worldbookEntryOrder)
                ? raw.worldbookEntryOrder.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
                : [],
            wallet: {
                balance: roundMoney(Number(walletRaw && walletRaw.balance) || 0)
            },
            updatedAt: Number(raw && raw.updatedAt) || Date.now()
        };
    }

    function roundMoney(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    function normalizePromptMeta(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var at = Number(raw.updatedAt);
        return {
            estimated_prompt_tokens: Math.max(0, Math.floor(Number(raw.estimated_prompt_tokens) || 0)),
            total_prompt_chars: Math.max(0, Math.floor(Number(raw.total_prompt_chars) || 0)),
            system_chars: Math.max(0, Math.floor(Number(raw.system_chars) || 0)),
            history_chars: Math.max(0, Math.floor(Number(raw.history_chars) || 0)),
            message_count: Math.max(0, Math.floor(Number(raw.message_count) || 0)),
            system_message_count: Math.max(0, Math.floor(Number(raw.system_message_count) || 0)),
            has_heartvoice_rules: !!raw.has_heartvoice_rules,
            worldbook_matched: Math.max(0, Math.floor(Number(raw.worldbook_matched) || 0)),
            worldbook_chars: Math.max(0, Math.floor(Number(raw.worldbook_chars) || 0)),
            updatedAt: Number.isFinite(at) && at > 0 ? at : 0
        };
    }

    function normalizePromptDebug(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var at = Number(raw.updatedAt);
        return {
            messagesJson: String(raw.messagesJson || '').slice(0, 1200000),
            hasHeartVoiceRules: !!raw.hasHeartVoiceRules,
            heartVoiceRulesSnippet: String(raw.heartVoiceRulesSnippet || '').slice(0, 4000),
            total_chars: Math.max(0, Math.floor(Number(raw.total_chars) || 0)),
            estimated_tokens: Math.max(0, Math.floor(Number(raw.estimated_tokens) || 0)),
            message_count: Math.max(0, Math.floor(Number(raw.message_count) || 0)),
            updatedAt: Number.isFinite(at) && at > 0 ? at : 0
        };
    }

    /** 自定义心声字段：禁止短截断（仅极端上限防撑爆） */
    var HEART_VOICE_FIELD_VALUE_MAX = 100000;
    var HEART_VOICE_FIELD_COUNT_MAX = 80;
    var HEART_VOICE_LEGACY_LINE_MAX = 20000;

    function normalizeHeartVoiceFieldsMap(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        var out = {};
        var keys = Object.keys(raw);
        var i;
        var kept = 0;
        for (i = 0; i < keys.length && kept < HEART_VOICE_FIELD_COUNT_MAX; i++) {
            var k = String(keys[i] || '').trim().slice(0, 40);
            if (!k) continue;
            var val = String(raw[keys[i]] == null ? '' : raw[keys[i]]);
            out[k] =
                val.length > HEART_VOICE_FIELD_VALUE_MAX
                    ? val.slice(0, HEART_VOICE_FIELD_VALUE_MAX)
                    : val;
            kept += 1;
        }
        return kept ? out : null;
    }

    function normalizeHeartVoiceParse(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var at = Number(raw.updatedAt);
        var ext = raw.extracted && typeof raw.extracted === 'object' ? raw.extracted : null;
        function clampScore(n) {
            var v = Math.round(Number(n));
            if (!Number.isFinite(v)) return null;
            return Math.min(100, Math.max(0, v));
        }
        var extracted = null;
        if (ext) {
            extracted = {
                affection: clampScore(ext.affection),
                desire: clampScore(ext.desire),
                action: String(ext.action || '').slice(0, HEART_VOICE_LEGACY_LINE_MAX),
                monologue: String(ext.monologue || '').slice(0, HEART_VOICE_LEGACY_LINE_MAX),
                demeanor: String(ext.demeanor || '').slice(0, HEART_VOICE_LEGACY_LINE_MAX),
                fantasy: String(ext.fantasy || '').slice(0, HEART_VOICE_LEGACY_LINE_MAX),
                dreams: String(ext.dreams || '').slice(0, HEART_VOICE_LEGACY_LINE_MAX)
            };
            if (ext.mode === 'custom') extracted.mode = 'custom';
            var parseFields = normalizeHeartVoiceFieldsMap(ext.fields);
            if (parseFields) extracted.fields = parseFields;
        }
        return {
            rawHasHeartVoiceTag: !!raw.rawHasHeartVoiceTag,
            extractedOk: !!raw.extractedOk,
            extracted: extracted,
            updatedAt: Number.isFinite(at) && at > 0 ? at : 0
        };
    }

    function normalizeHeartVoiceLogEntry(raw, i) {
        if (!raw || typeof raw !== 'object') return null;
        function clampScore(n) {
            var v = Math.round(Number(n));
            if (!Number.isFinite(v)) return null;
            return Math.min(100, Math.max(0, v));
        }
        var at = Number(raw.updatedAt);
        var entry = {
            id: String(raw.id || '').trim() || 'hv_' + (i || 0),
            msgId: String(raw.msgId || '').trim(),
            affection: clampScore(raw.affection),
            desire: clampScore(raw.desire),
            action: String(raw.action || '').slice(0, HEART_VOICE_LEGACY_LINE_MAX),
            monologue: String(raw.monologue || '').slice(0, HEART_VOICE_LEGACY_LINE_MAX),
            updatedAt: Number.isFinite(at) && at > 0 ? at : 0
        };
        var fields = normalizeHeartVoiceFieldsMap(raw.fields);
        var htmlTemplate = String(raw.htmlTemplate || '').slice(0, 200000);
        var isCustom =
            raw.mode === 'custom' ||
            !!fields ||
            (!!htmlTemplate && raw.fields && typeof raw.fields === 'object');
        if (isCustom) {
            entry.mode = 'custom';
            entry.presetName = String(raw.presetName || '').trim().slice(0, 60);
            entry.fields = fields || {};
            entry.htmlTemplate = htmlTemplate;
        }
        return entry;
    }

    function normalizeTokenUsage(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (raw.missing) {
            return {
                missing: true,
                estimated_prompt_tokens: Math.max(0, Math.floor(Number(raw.estimated_prompt_tokens) || 0)),
                updatedAt: Number(raw.updatedAt) || 0
            };
        }
        var pc = Number(raw.prompt_chars);
        var cc = Number(raw.completion_chars);
        var tc = Number(raw.total_chars);
        var p = Number(raw.prompt_tokens);
        var c = Number(raw.completion_tokens);
        var t = Number(raw.total_tokens);
        var at = Number(raw.updatedAt);
        var useChars =
            raw.source === 'local_chars' ||
            Number.isFinite(pc) ||
            Number.isFinite(cc) ||
            Number.isFinite(tc);
        if (useChars) {
            var outC = {
                prompt_chars: Number.isFinite(pc)
                    ? Math.max(0, Math.floor(pc))
                    : Number.isFinite(p)
                      ? Math.max(0, Math.floor(p))
                      : 0,
                completion_chars: Number.isFinite(cc)
                    ? Math.max(0, Math.floor(cc))
                    : Number.isFinite(c)
                      ? Math.max(0, Math.floor(c))
                      : 0,
                total_chars: Number.isFinite(tc) ? Math.max(0, Math.floor(tc)) : 0,
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
                source: String(raw.source || 'local_chars'),
                updatedAt: Number.isFinite(at) && at > 0 ? at : 0
            };
            if (!outC.total_chars && (outC.prompt_chars || outC.completion_chars)) {
                outC.total_chars = outC.prompt_chars + outC.completion_chars;
            }
            outC.prompt_tokens = outC.prompt_chars;
            outC.completion_tokens = outC.completion_chars;
            outC.total_tokens = outC.total_chars;
            return outC;
        }
        if (!Number.isFinite(p) && !Number.isFinite(c) && !Number.isFinite(t)) return null;
        var out = {
            prompt_chars: Number.isFinite(p) ? Math.max(0, Math.floor(p)) : 0,
            completion_chars: Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 0,
            total_chars: Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0,
            prompt_tokens: Number.isFinite(p) ? Math.max(0, Math.floor(p)) : 0,
            completion_tokens: Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 0,
            total_tokens: Number.isFinite(t) ? Math.max(0, Math.floor(t)) : 0,
            updatedAt: Number.isFinite(at) && at > 0 ? at : 0
        };
        if (!out.total_tokens && (out.prompt_tokens || out.completion_tokens)) {
            out.total_tokens = out.prompt_tokens + out.completion_tokens;
        }
        if (!out.total_chars && (out.prompt_chars || out.completion_chars)) {
            out.total_chars = out.prompt_chars + out.completion_chars;
        }
        return out;
    }

    function normalizeChat(raw) {
        return {
            id: String(raw && raw.id ? raw.id : uid('chat')),
            contactId: String((raw && raw.contactId) || '').trim(),
            profileId: String((raw && raw.profileId) || '').trim(),
            groupId: String((raw && raw.groupId) || 'ct-default').trim() || 'ct-default',
            type: raw && raw.type === 'group' ? 'group' : 'private',
            memberIds: Array.isArray(raw && raw.memberIds)
                ? raw.memberIds
                      .map(function (id) {
                          return String(id || '').trim();
                      })
                      .filter(Boolean)
                : [],
            title: String((raw && raw.title) || '').trim(),
            lastPreview: String((raw && raw.lastPreview) || '').trim(),
            lastAt: Number(raw && raw.lastAt) || Date.now(),
            unread: Number(raw && raw.unread) || 0,
            activeThinking: String((raw && raw.activeThinking) || '').trim(),
            activeThinkingMsgId: String((raw && raw.activeThinkingMsgId) || '').trim(),
            activeHeartVoiceMsgId: String((raw && raw.activeHeartVoiceMsgId) || '').trim(),
            heartVoiceLog: Array.isArray(raw && raw.heartVoiceLog)
                ? raw.heartVoiceLog
                      .map(function (row, i) {
                          return normalizeHeartVoiceLogEntry(row, i);
                      })
                      .filter(Boolean)
                      .slice(0, 100)
                : [],
            lastTokenUsage: normalizeTokenUsage(raw && raw.lastTokenUsage),
            lastPromptMeta: normalizePromptMeta(raw && raw.lastPromptMeta),
            lastRawAssistantReply: String((raw && raw.lastRawAssistantReply) || '').slice(0, 600000),
            lastPromptDebug: normalizePromptDebug(raw && raw.lastPromptDebug),
            lastHeartVoiceParse: normalizeHeartVoiceParse(raw && raw.lastHeartVoiceParse),
            chatSettings: normalizeChatSettings(raw && raw.chatSettings),
            createdAt: Number(raw && raw.createdAt) || Date.now()
        };
    }

    function stripThinkingTags(text) {
        var eng = global.miyaChatEngine;
        if (eng && typeof eng.stripThinkingForApi === 'function') {
            return eng.stripThinkingForApi(text);
        }
        return String(text || '')
            .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
            .replace(/＜thinking＞[\s\S]*?＜\/thinking＞/gi, '')
            .replace(/\<think\>[\s\S]*?<\/think>/gi, '')
            .replace(/＜think＞[\s\S]*?＜\/think＞/gi, '')
            .replace(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
            .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
            .trim();
    }

    function stripApiTimelinePrefix(text) {
        var aw = global.MiyaChatAwareness;
        if (aw && typeof aw.stripTimelinePrefixForDisplay === 'function') {
            return aw.stripTimelinePrefixForDisplay(text);
        }
        return String(text || '').trim();
    }

    function normalizeMessage(raw) {
        var role =
            raw && raw.role === 'assistant' ? 'assistant' : raw && raw.role === 'system' ? 'system' : 'user';
        var content = stripApiTimelinePrefix(String((raw && raw.content) || ''));
        if (role === 'assistant') content = stripThinkingTags(content);
        var type = String((raw && raw.type) || 'text').trim() || 'text';
        var loc = raw && raw.locationCard && typeof raw.locationCard === 'object' ? raw.locationCard : null;
        var rp = raw && raw.redPacket && typeof raw.redPacket === 'object' ? raw.redPacket : null;
        var to = raw && raw.takeoutOrder && typeof raw.takeoutOrder === 'object' ? raw.takeoutOrder : null;
        var gp = raw && raw.giftParcel && typeof raw.giftParcel === 'object' ? raw.giftParcel : null;
        var grp = raw && raw.groupRedPacket && typeof raw.groupRedPacket === 'object' ? raw.groupRedPacket : null;
        var out = {
            id: String(raw && raw.id ? raw.id : uid('msg')),
            role: role,
            type: type,
            content: content,
            createdAt: Number(raw && raw.createdAt) || Date.now(),
            deleted: !!(raw && raw.deleted),
            edited: !!(raw && raw.edited),
            editedAt: Number(raw && raw.editedAt) || 0,
            recalled: !!(raw && raw.recalled),
            quoteRef: normalizeQuoteRef(raw && raw.quoteRef),
            imageDataKey: String((raw && raw.imageDataKey) || '').trim(),
            imageKind: String((raw && raw.imageKind) || '').trim(),
            imageVisionText: stripApiTimelinePrefix(String((raw && raw.imageVisionText) || '')),
            stickerBlobId: String((raw && raw.stickerBlobId) || '').trim(),
            stickerUrl: String((raw && raw.stickerUrl) || '').trim(),
            stickerName: String((raw && raw.stickerName) || '').trim(),
            locationCard: loc
                ? {
                      name: String(loc.name || '').trim(),
                      address: String(loc.address || '').trim(),
                      lat: Number(loc.lat) || 0,
                      lng: Number(loc.lng) || 0
                  }
                : null,
            redPacket: rp
                ? {
                      amount: Number(rp.amount) || 0,
                      note: String(rp.note || '').trim(),
                      status: String(rp.status || 'pending'),
                      dir:
                          String(rp.dir || '').trim() === 'in'
                              ? 'in'
                              : String(rp.dir || '').trim() === 'out'
                                ? 'out'
                                : role === 'assistant'
                                  ? 'in'
                                  : 'out',
                      scope: String(rp.scope || '').trim(),
                      claims: Array.isArray(rp.claims)
                          ? rp.claims
                                .map(function (c) {
                                    if (!c || typeof c !== 'object') return null;
                                    return {
                                        who: String(c.who || '').trim(),
                                        amount: Number(c.amount) || 0,
                                        at: Number(c.at) || 0
                                    };
                                })
                                .filter(Boolean)
                          : [],
                      resolvedAt: Number(rp.resolvedAt) || 0,
                      walletHeld: !!(rp && rp.walletHeld),
                      walletSettled: !!(rp && rp.walletSettled)
                  }
                : null,
            takeoutOrder: to
                ? {
                      shop: String(to.shop || '').trim(),
                      items: String(to.items || '').trim(),
                      amount: Number(to.amount) || 0,
                      note: String(to.note || '').trim(),
                      status: String(to.status || 'ordered').trim() || 'ordered'
                  }
                : null,
            giftParcel: normalizeGiftParcel(gp),
            voiceText: stripApiTimelinePrefix(String((raw && raw.voiceText) || ''))
        };
        if (grp) {
            var grpRp = global.MiyaChatGroupRedPacket;
            out.groupRedPacket =
                grpRp && typeof grpRp.normalizeGroupRedPacket === 'function'
                    ? grpRp.normalizeGroupRedPacket(grp)
                    : grp;
            out.type = 'group_red_packet';
        } else {
            out.groupRedPacket = null;
            var grpRpRecover = global.MiyaChatGroupRedPacket;
            if (
                grpRpRecover &&
                typeof grpRpRecover.resolveMessageGroupRedPacket === 'function' &&
                (type === 'group_red_packet' || /^红包[-－—](拼手气|专属)/.test(content))
            ) {
                var recoveredGrp = grpRpRecover.resolveMessageGroupRedPacket({ content: content, groupRedPacket: null });
                if (recoveredGrp) {
                    out.groupRedPacket = recoveredGrp;
                    out.type = 'group_red_packet';
                }
            }
        }
        if (out.type === 'group_red_packet' && out.groupRedPacket) {
            var grpRpShort = global.MiyaChatGroupRedPacket;
            if (grpRpShort && typeof grpRpShort.formatGroupRedPacketForApi === 'function') {
                var shortContent = grpRpShort.formatGroupRedPacketForApi(out.groupRedPacket);
                if (shortContent) out.content = shortContent;
            }
        }
        if (raw && raw.groupRedPacketRef && typeof raw.groupRedPacketRef === 'object') {
            out.groupRedPacketRef = raw.groupRedPacketRef;
        }
        if (raw && raw.callId) out.callId = String(raw.callId);
        if (raw && raw.senderContactId) out.senderContactId = String(raw.senderContactId).trim();
        if (raw && raw.callKind) out.callKind = String(raw.callKind) === 'video' ? 'video' : 'voice';
        if (raw && raw.callSeq != null) out.callSeq = Number(raw.callSeq) || 0;
        if (raw && raw.callCapsule && typeof raw.callCapsule === 'object') {
            out.callCapsule = {
                kind: String(raw.callCapsule.kind) === 'video' ? 'video' : 'voice',
                status: String(raw.callCapsule.status || 'ended'),
                durationSec: Number(raw.callCapsule.durationSec) || 0,
                startedAt: Number(raw.callCapsule.startedAt) || 0,
                endedAt: Number(raw.callCapsule.endedAt) || 0,
                callId: String(raw.callCapsule.callId || raw.callId || ''),
                items: Array.isArray(raw.callCapsule.items)
                    ? raw.callCapsule.items
                          .map(function (it) {
                              if (!it || typeof it !== 'object') return null;
                              var t = String(it.text || '').trim();
                              if (!t) return null;
                              var row = {
                                  role: String(it.role) === 'assistant' ? 'assistant' : 'user',
                                  text: t,
                                  ts: Number(it.ts) || 0
                              };
                              if (it.voiceAudioIdbKey) row.voiceAudioIdbKey = String(it.voiceAudioIdbKey);
                              if (
                                  typeof it.voiceDurationSec === 'number' &&
                                  Number.isFinite(it.voiceDurationSec) &&
                                  it.voiceDurationSec > 0
                              ) {
                                  row.voiceDurationSec = it.voiceDurationSec;
                              }
                              return row;
                          })
                          .filter(Boolean)
                    : []
            };
        }
        if (raw && raw.coupleSpaceInvite && typeof raw.coupleSpaceInvite === 'object') {
            var csi = raw.coupleSpaceInvite;
            var csiStatus = String(csi.status || 'pending').trim();
            if (csiStatus !== 'accepted' && csiStatus !== 'declined' && csiStatus !== 'expired') {
                csiStatus = 'pending';
            }
            out.coupleSpaceInvite = {
                inviteId: String(csi.inviteId || '').trim(),
                contactId: String(csi.contactId || '').trim(),
                profileId: String(csi.profileId || '').trim(),
                profileName: String(csi.profileName || '').trim(),
                charName: String(csi.charName || '').trim(),
                status: csiStatus,
                sentAt: Number(csi.sentAt) || 0,
                decidedAt: Number(csi.decidedAt) || 0,
                responseNote: String(csi.responseNote || '').trim()
            };
        }
        if (raw && raw.lovePoem && typeof raw.lovePoem === 'object') {
            var lpLines = Array.isArray(raw.lovePoem.lines)
                ? raw.lovePoem.lines.map(function (ln) {
                      return String(ln || '').trim();
                  }).filter(Boolean)
                : [];
            if (lpLines.length) {
                out.lovePoem = {
                    style: String(raw.lovePoem.style || '').trim() || '情诗',
                    title: String(raw.lovePoem.title || '').trim() || '（无题）',
                    lines: lpLines.slice(0, 12)
                };
            }
        }
        if (raw && raw.matchRecord && typeof raw.matchRecord === 'object') {
            var mr = raw.matchRecord;
            out.type = 'match_record';
            out.matchRecord = {
                sessionId: String(mr.sessionId || '').trim(),
                eventName: String(mr.eventName || '').trim(),
                eventItemName: String(mr.eventItemName || '').trim(),
                mode: mr.mode === 'team' ? 'team' : 'solo',
                highlight: String(mr.highlight || '').trim(),
                narrative: String(mr.narrative || ''),
                beats: Array.isArray(mr.beats)
                    ? mr.beats.map(function (b) { return String(b || ''); }).filter(Boolean)
                    : [],
                rankings: Array.isArray(mr.rankings)
                    ? mr.rankings.map(function (r) {
                        if (!r || typeof r !== 'object') return null;
                        return {
                            contactId: String(r.contactId || '').trim(),
                            rank: Math.max(1, Number(r.rank) || 1),
                            note: String(r.note || '').trim()
                        };
                    }).filter(Boolean)
                    : null,
                winnerTeam: String(mr.winnerTeam || '').trim(),
                mvpContactId: String(mr.mvpContactId || '').trim(),
                prizes: mr.prizes && typeof mr.prizes === 'object' ? mr.prizes : {},
                participants: Array.isArray(mr.participants)
                    ? mr.participants.map(function (p) {
                        if (!p || typeof p !== 'object') return null;
                        return {
                            contactId: String(p.contactId || '').trim(),
                            name: String(p.name || '').trim(),
                            avatar: String(p.avatar || '').trim(),
                            team: p.team === 'B' ? 'B' : p.team === 'A' ? 'A' : undefined
                        };
                    }).filter(Boolean)
                    : [],
                reactions: Array.isArray(mr.reactions)
                    ? mr.reactions.map(function (rx) {
                        if (!rx || typeof rx !== 'object') return null;
                        var text = String(rx.text || '').trim();
                        if (!text) return null;
                        return {
                            contactId: String(rx.contactId || '').trim(),
                            name: String(rx.name || '').trim(),
                            text: text
                        };
                    }).filter(Boolean)
                    : [],
                profileName: String(mr.profileName || '').trim(),
                profileId: String(mr.profileId || '').trim(),
                profileAvatar: String(mr.profileAvatar || '').trim(),
                createdAt: Number(mr.createdAt) || 0
            };
        }
        if (raw && raw.sayguessRecord && typeof raw.sayguessRecord === 'object') {
            var sg = raw.sayguessRecord;
            out.type = 'sayguess_record';
            out.sayguessRecord = {
                sessionId: String(sg.sessionId || '').trim(),
                mode: sg.mode === 'other_lead' ? 'other_lead' : 'user_lead',
                totalRounds: Math.max(0, Number(sg.totalRounds) || 0),
                bankName: String(sg.bankName || '').trim(),
                profileId: String(sg.profileId || '').trim(),
                profileName: String(sg.profileName || '').trim(),
                profileAvatar: String(sg.profileAvatar || '').trim(),
                players: Array.isArray(sg.players)
                    ? sg.players.map(function (p) {
                        if (!p || typeof p !== 'object') return null;
                        return {
                            id: String(p.id || '').trim(),
                            kind: p.kind === 'user' ? 'user' : 'char',
                            contactId: String(p.contactId || '').trim(),
                            name: String(p.name || '').trim(),
                            avatar: String(p.avatar || '').trim(),
                            score: Math.max(0, Number(p.score) || 0)
                        };
                    }).filter(Boolean)
                    : [],
                scores: sg.scores && typeof sg.scores === 'object' ? sg.scores : {},
                rankings: Array.isArray(sg.rankings)
                    ? sg.rankings.map(function (r) {
                        if (!r || typeof r !== 'object') return null;
                        return {
                            playerId: String(r.playerId || '').trim(),
                            name: String(r.name || '').trim(),
                            rank: Math.max(1, Number(r.rank) || 1),
                            score: Math.max(0, Number(r.score) || 0)
                        };
                    }).filter(Boolean)
                    : [],
                prizes: sg.prizes && typeof sg.prizes === 'object' ? sg.prizes : {},
                rounds: Array.isArray(sg.rounds)
                    ? sg.rounds.map(function (r) {
                        if (!r || typeof r !== 'object') return null;
                        return {
                            index: Number(r.index) || 0,
                            word: String(r.word || '').trim(),
                            describerId: String(r.describerId || '').trim(),
                            description: String(r.description || ''),
                            dialogue: Array.isArray(r.dialogue) ? r.dialogue : [],
                            review: Array.isArray(r.review) ? r.review : [],
                            guesses: Array.isArray(r.guesses) ? r.guesses : []
                        };
                    }).filter(Boolean)
                    : [],
                reactions: Array.isArray(sg.reactions)
                    ? sg.reactions.map(function (rx) {
                        if (!rx || typeof rx !== 'object') return null;
                        var text = String(rx.text || '').trim();
                        if (!text) return null;
                        return {
                            contactId: String(rx.contactId || '').trim(),
                            playerId: String(rx.playerId || '').trim(),
                            name: String(rx.name || '').trim(),
                            text: text
                        };
                    }).filter(Boolean)
                    : [],
                createdAt: Number(sg.createdAt) || 0
            };
        }
        if (raw && raw.listenTogetherCapsule && typeof raw.listenTogetherCapsule === 'object') {
            out.listenTogetherCapsule = {
                sessionId: String(raw.listenTogetherCapsule.sessionId || raw.sessionId || ''),
                status: String(raw.listenTogetherCapsule.status || 'ended'),
                durationSec: Number(raw.listenTogetherCapsule.durationSec) || 0,
                startedAt: Number(raw.listenTogetherCapsule.startedAt) || 0,
                endedAt: Number(raw.listenTogetherCapsule.endedAt) || 0,
                trackTitle: String(raw.listenTogetherCapsule.trackTitle || '').trim(),
                trackArtist: String(raw.listenTogetherCapsule.trackArtist || '').trim(),
                items: Array.isArray(raw.listenTogetherCapsule.items)
                    ? raw.listenTogetherCapsule.items
                          .map(function (it) {
                              if (!it || typeof it !== 'object') return null;
                              var t = String(it.text || '').trim();
                              if (!t) return null;
                              var role = String(it.role || '');
                              if (role !== 'user' && role !== 'assistant' && role !== 'system') role = 'assistant';
                              return { role: role, text: t, type: String(it.type || 'text') };
                          })
                          .filter(Boolean)
                    : []
            };
        }
        if (raw && raw.sessionId) out.sessionId = String(raw.sessionId).trim();
        if (raw && raw.voiceTtsIdbKey) out.voiceTtsIdbKey = String(raw.voiceTtsIdbKey);
        if (raw && raw.voiceTtsVoiceId != null) out.voiceTtsVoiceId = String(raw.voiceTtsVoiceId);
        if (raw && raw.voiceTtsLanguageBoost != null) out.voiceTtsLanguageBoost = String(raw.voiceTtsLanguageBoost);
        if (raw && raw.voiceTtsModel != null) out.voiceTtsModel = String(raw.voiceTtsModel);
        if (
            typeof (raw && raw.voiceTtsDurationSec) === 'number' &&
            Number.isFinite(raw.voiceTtsDurationSec) &&
            raw.voiceTtsDurationSec > 0
        ) {
            out.voiceTtsDurationSec = raw.voiceTtsDurationSec;
        }
        if (raw && raw.voiceAudioIdbKey) out.voiceAudioIdbKey = String(raw.voiceAudioIdbKey);
        if (
            typeof (raw && raw.voiceDurationSec) === 'number' &&
            Number.isFinite(raw.voiceDurationSec) &&
            raw.voiceDurationSec > 0
        ) {
            out.voiceDurationSec = raw.voiceDurationSec;
        }
        if (raw && raw.offlineMeet) out.offlineMeet = true;
        if (raw && raw.momentsMemory) out.momentsMemory = true;
        if (raw && raw.appointmentSessionId) out.appointmentSessionId = String(raw.appointmentSessionId).trim();
        if (raw && raw.appointmentMsgId) out.appointmentMsgId = String(raw.appointmentMsgId).trim();
        if (raw && raw.chatMirrorId) out.chatMirrorId = String(raw.chatMirrorId).trim();
        if (raw && raw.tajiePostShare && typeof raw.tajiePostShare === 'object') {
            out.tajiePostShare = raw.tajiePostShare;
        }
        if (raw && raw.tajieProfileShare && typeof raw.tajieProfileShare === 'object') {
            out.tajieProfileShare = raw.tajieProfileShare;
        }
        if (raw && raw.weijiePostShare && typeof raw.weijiePostShare === 'object') {
            out.weijiePostShare = raw.weijiePostShare;
        }
        if (raw && raw.weijieProfileShare && typeof raw.weijieProfileShare === 'object') {
            out.weijieProfileShare = raw.weijieProfileShare;
        }
        if (raw && raw.translationZh) out.translationZh = String(raw.translationZh).trim();
        if (raw && raw.translationSrcHash) out.translationSrcHash = String(raw.translationSrcHash).trim();
        if (raw && raw.translationAt) out.translationAt = Number(raw.translationAt) || 0;
        if (raw && raw.translationPending) out.translationPending = true;
        if (raw && raw.translationFailed) out.translationFailed = true;
        if (raw && raw.translationError) out.translationError = String(raw.translationError).trim().slice(0, 120);
        if (raw && raw.translationTarget) {
            out.translationTarget = String(raw.translationTarget).trim();
        }
        if (type === 'html' || (raw && raw.renderAsHtml)) {
            out.type = 'html';
            out.renderAsHtml = true;
            out.htmlRaw = String((raw && raw.htmlRaw) || content || '').trim();
            out.content = '[HTML]';
        }
        if (raw && raw.systemKind) out.systemKind = String(raw.systemKind).trim();
        if (raw && raw.titleChange && typeof raw.titleChange === 'object') {
            var tc = raw.titleChange;
            out.titleChange = {
                actorId: String(tc.actorId || '').trim(),
                actorName: String(tc.actorName || '').trim(),
                targetId: String(tc.targetId || '').trim(),
                targetName: String(tc.targetName || '').trim(),
                title: String(tc.title || '').trim(),
                color: String(tc.color || '').trim(),
                prevTitle: String(tc.prevTitle || '').trim()
            };
        }
        if (raw && raw.narrationFrom) out.narrationFrom = String(raw.narrationFrom).trim();
        if (raw && raw.excludedFromContext) out.excludedFromContext = true;
        if (raw && raw.replyBatchId) out.replyBatchId = String(raw.replyBatchId).trim();
        if (raw && raw.recallMeta && typeof raw.recallMeta === 'object') {
            out.recallMeta = {
                by: String(raw.recallMeta.by || '').trim(),
                byName: String(raw.recallMeta.byName || '').trim(),
                preview: String(raw.recallMeta.preview || '').trim(),
                at: Number(raw.recallMeta.at) || 0
            };
        }
        var fmtTakeout = global.MiyaChatOnlineFormat;
        if (fmtTakeout && typeof fmtTakeout.normalizeTakeoutFields === 'function') {
            var toPatch = fmtTakeout.normalizeTakeoutFields(out);
            if (toPatch) {
                if (toPatch.type) out.type = toPatch.type;
                if (toPatch.content) out.content = toPatch.content;
                if (toPatch.takeoutOrder) out.takeoutOrder = toPatch.takeoutOrder;
                if (toPatch.takeoutOrder === null) out.takeoutOrder = null;
            }
        }
        if (fmtTakeout && typeof fmtTakeout.normalizeGiftFields === 'function') {
            var gpPatch = fmtTakeout.normalizeGiftFields(out);
            if (gpPatch) {
                if (gpPatch.type) out.type = gpPatch.type;
                if (gpPatch.content) out.content = gpPatch.content;
                if (gpPatch.giftParcel) out.giftParcel = gpPatch.giftParcel;
                if (gpPatch.giftParcel === null) out.giftParcel = null;
            }
        }
        if (type === 'karaoke') {
            out.karaokeTitle = String((raw && raw.karaokeTitle) || '').trim();
            out.karaokeArtist = String((raw && raw.karaokeArtist) || '').trim();
            out.karaokeMode = String((raw && raw.karaokeMode) || 'follow').trim() || 'follow';
            out.karaokeLrcText = String((raw && raw.karaokeLrcText) || '');
            out.karaokeSungLrcText = String((raw && raw.karaokeSungLrcText) || '');
            out.karaokeIdbKey = String((raw && raw.karaokeIdbKey) || '').trim();
            out.karaokeTakeId = String((raw && raw.karaokeTakeId) || '').trim();
            if (
                typeof (raw && raw.karaokeDurationSec) === 'number' &&
                Number.isFinite(raw.karaokeDurationSec) &&
                raw.karaokeDurationSec > 0
            ) {
                out.karaokeDurationSec = raw.karaokeDurationSec;
            }
        }
        if (raw && raw.imageGenPending) out.imageGenPending = true;
        if (raw && raw.imageGenFailed) out.imageGenFailed = true;
        return out;
    }

    function callCapsulePreviewText(m) {
        if (!m || m.type !== 'call_capsule') return '';
        var cap = m.callCapsule || {};
        var sec = Number(cap.durationSec) || 0;
        if (!sec) return '';
        var calls = global.MiyaChatCalls;
        if (calls && typeof calls.formatCallDuration === 'function') {
            return calls.formatCallDuration(sec);
        }
        return (
            String(Math.floor(sec / 60)).padStart(2, '0') +
            ':' +
            String(sec % 60).padStart(2, '0')
        );
    }

    function listenTogetherCapsulePreviewText(m) {
        if (!m || m.type !== 'listen_together_capsule') return '';
        var cap = m.listenTogetherCapsule || {};
        var sec = Number(cap.durationSec) || 0;
        var lt = global.MiyaMusicListenTogether;
        var dur = lt && typeof lt.formatDuration === 'function'
            ? lt.formatDuration(sec)
            : (sec
                ? String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0')
                : '');
        if (!dur && !cap.trackTitle) return String(m.content || '').trim();
        var out = dur ? '[一起听] ' + dur : '[一起听]';
        if (cap.trackTitle) out += ' · ' + cap.trackTitle;
        return out;
    }

    function messagePreview(m) {
        if (!m || m.deleted) return '';
        if (m.recalled && m.recallMeta) {
            if (m.recallMeta.by === 'user') return '你撤回了一条消息';
            return (String(m.recallMeta.byName || '').trim() || 'TA') + '撤回了一条消息';
        }
        if (m.type === 'call_capsule') return callCapsulePreviewText(m);
        if (m.type === 'listen_together_capsule') return listenTogetherCapsulePreviewText(m);
        if (m.type === 'couple_space_invite' && m.coupleSpaceInvite) {
            var csp = m.coupleSpaceInvite;
            if (csp.status === 'accepted') return '[情侣空间] 已同意开通';
            if (csp.status === 'declined') return '[情侣空间] 已婉拒邀请';
            if (csp.status === 'expired') return '[情侣空间] 邀请已失效';
            return '[情侣空间] 邀请开通专属空间';
        }
        if (m.role === 'system') return String(m.content || '').trim();
        if (m.type === 'image') {
            if (m.imageKind === 'text') {
                var tcap = stripApiTimelinePrefix(String(m.content || '')).replace(/^图片[-－—]\s*/, '');
                return tcap ? '[图片] ' + tcap.slice(0, 80) : '[图片]';
            }
            return '[图片]';
        }
        if (m.type === 'sticker') return '[表情]' + (m.stickerName ? ' ' + m.stickerName : '');
        if (m.type === 'location') {
            if (!m.locationCard || !m.locationCard.name) return '[位置]';
            var locPrev = m.locationCard.name;
            if (m.locationCard.address) locPrev += '｜' + String(m.locationCard.address).slice(0, 48);
            return '[位置] ' + locPrev;
        }
        if (m.type === 'transfer' && m.redPacket) {
            var trPrev = '¥' + (m.redPacket.amount || 0);
            if (m.redPacket.note) trPrev += ' · ' + m.redPacket.note;
            return '[转账] ' + trPrev;
        }
        if (m.type === 'transfer') return '[转账]';
        if (m.type === 'takeout' && m.takeoutOrder) {
            var toPrev = m.takeoutOrder.shop || '外卖';
            if (m.takeoutOrder.amount) toPrev += ' ¥' + m.takeoutOrder.amount;
            return '[外卖] ' + toPrev;
        }
        if (m.type === 'takeout') return '[外卖]';
        if (m.type === 'gift' && m.giftParcel) {
            var gpPrev = (m.giftParcel.items || [])
                .map(function (it) {
                    return (it.name || '') + (it.qty > 1 ? '×' + it.qty : '');
                })
                .join('、');
            return '[礼品] ' + (gpPrev || '礼盒');
        }
        if (m.type === 'gift') return '[礼品]';
        if (m.type === 'group_red_packet' && m.groupRedPacket) {
            var grpListPrev =
                (m.groupRedPacket.mode === 'exclusive' ? '专属' : '拼手气') +
                ' ¥' +
                (m.groupRedPacket.totalAmount || 0);
            if (m.groupRedPacket.note) grpListPrev += ' · ' + m.groupRedPacket.note;
            return '[红包] ' + grpListPrev;
        }
        if (m.type === 'group_red_packet') return '[红包]';
        if (m.type === 'love_poem' && m.lovePoem) {
            var lpStyle = String(m.lovePoem.style || '情诗').trim();
            var lpTitle = String(m.lovePoem.title || '').trim();
            if (lpTitle && lpTitle !== '（无题）') return '[情诗] ' + lpStyle + ' · ' + lpTitle;
            return '[情诗] ' + lpStyle;
        }
        if (m.type === 'love_poem') return '[情诗]';
        if (m.type === 'match_record' && m.matchRecord) {
            var mrPrev = String(m.matchRecord.eventName || '赛事').trim();
            if (m.matchRecord.eventItemName) mrPrev += ' · ' + m.matchRecord.eventItemName;
            return '[赛事记录] ' + mrPrev;
        }
        if (m.type === 'match_record') return '[赛事记录]';
        if (m.type === 'sayguess_record' && m.sayguessRecord) {
            var sgPrev = '你说我猜';
            if (m.sayguessRecord.bankName) sgPrev += ' · ' + m.sayguessRecord.bankName;
            return '[你说我猜] ' + sgPrev;
        }
        if (m.type === 'sayguess_record') return '[你说我猜]';
        if (m.type === 'voice') return '[语音]' + (m.voiceText || stripApiTimelinePrefix(m.content) || '');
        if (m.type === 'html' || m.renderAsHtml) return '[HTML]';
        if (m.type === 'karaoke') {
            var kTitle = m.karaokeTitle || stripApiTimelinePrefix(m.content).replace(/^【K歌[^】]*】\s*/, '') || 'K歌';
            var kDur =
                typeof m.karaokeDurationSec === 'number' && m.karaokeDurationSec > 0
                    ? ' · ' + Math.round(m.karaokeDurationSec) + '秒'
                    : '';
            return '[K歌] ' + kTitle + kDur;
        }
        var body = stripApiTimelinePrefix(m.content) || '';
        if (m.role === 'assistant') body = stripThinkingTags(body);
        return body;
    }

    function snapshotMessageForFavorite(raw) {
        if (!raw || typeof raw !== 'object') return null;
        var m = normalizeMessage(raw);
        m.deleted = false;
        m.recalled = false;
        m.recallMeta = null;
        return m;
    }

    function savedMessageHasBody(m) {
        if (!m) return false;
        if (m.type === 'transfer' && m.redPacket) return true;
        if (m.type === 'location' && m.locationCard) return true;
        if (m.type === 'takeout' && m.takeoutOrder) return true;
        if (m.type === 'gift' && m.giftParcel) return true;
        if (m.type === 'group_red_packet' && m.groupRedPacket) return true;
        if (m.type === 'love_poem' && m.lovePoem) return true;
        if (m.type === 'match_record' && m.matchRecord) return true;
        if (m.type === 'sayguess_record' && m.sayguessRecord) return true;
        if (m.type === 'voice') return !!(m.voiceText || m.content || m.voiceAudioIdbKey);
        if (m.type === 'image' || m.imageDataKey) return true;
        if (m.type === 'sticker') return !!(m.stickerBlobId || m.stickerUrl || m.stickerName || m.content);
        if (m.type === 'html' || m.renderAsHtml) return !!(m.htmlRaw || m.content);
        if (m.coupleSpaceInvite) return true;
        return !!(m.content || m.voiceText);
    }

    function isMomentsMemoryRow(m) {
        if (!m) return false;
        if (m.momentsMemory) return true;
        return m.role === 'system' && String(m.content || '').indexOf('【朋友圈·留痕·') === 0;
    }

    function getOpenChatIdForUnread() {
        if (global.miyaChatRoom && typeof global.miyaChatRoom.getOpenChatId === 'function') {
            return String(global.miyaChatRoom.getOpenChatId() || '').trim();
        }
        return '';
    }

    function isUnreadCountableMessage(m) {
        if (!m || m.deleted || m.recalled) return false;
        if (m.role !== 'assistant') return false;
        if (m.offlineMeet || isMomentsMemoryRow(m)) return false;
        return true;
    }

    function bumpChatUnread(chatId, delta) {
        if (!delta || !metaCache || !Array.isArray(metaCache.chats)) return 0;
        var cid = String(chatId || '').trim();
        if (!cid) return 0;
        var idx = metaCache.chats.findIndex(function (ch) {
            return ch && ch.id === cid;
        });
        if (idx < 0) return 0;
        var next = (Number(metaCache.chats[idx].unread) || 0) + delta;
        metaCache.chats[idx].unread = next > 0 ? next : 0;
        invalidateLookupCache();
        return metaCache.chats[idx].unread;
    }

    function previewFromMessage(m, chat) {
        if (!m) return '';
        if (
            chat &&
            chat.type === 'group' &&
            global.MiyaChatGroup &&
            typeof global.MiyaChatGroup.formatPreview === 'function'
        ) {
            return global.MiyaChatGroup.formatPreview(store, chat, m);
        }
        return m.role === 'user' ? '我: ' + messagePreview(m) : messagePreview(m);
    }

    function findLastPreviewMessage(list) {
        var arr = Array.isArray(list) ? list : [];
        var fmt = global.MiyaChatOnlineFormat;
        var i;
        for (i = arr.length - 1; i >= 0; i--) {
            var m = arr[i];
            if (!m || m.deleted) continue;
            if (fmt && typeof fmt.isRoomInvisibleMessage === 'function' && fmt.isRoomInvisibleMessage(m)) continue;
            return m;
        }
        return null;
    }

    /** 低语簿列表预览/排序：仅依据线上可见消息，不含线下镜像 */
    function refreshChatPreviewFromVisible(chatId, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var cid = String(chatId || '').trim();
        if (!cid || !metaCache) return Promise.resolve();
        var idx = metaCache.chats.findIndex(function (ch) {
            return ch && ch.id === cid;
        });
        if (idx < 0) return Promise.resolve();
        var list = store.getMessages(cid);
        var last = findLastPreviewMessage(list);
        var chatRow = metaCache.chats[idx];
        var preview = previewFromMessage(last, chatRow).slice(0, 120);
        metaCache.chats[idx].lastPreview = preview;
        if (opts.bumpNow) {
            metaCache.chats[idx].lastAt = Date.now();
        } else if (last && last.createdAt) {
            metaCache.chats[idx].lastAt = last.createdAt;
        }
        return scheduleSaveMeta();
    }

    function repairLedgerPreviewsFromVisible() {
        if (!metaCache || !Array.isArray(metaCache.chats)) return Promise.resolve(false);
        var dirty = false;
        metaCache.chats.forEach(function (ch) {
            if (!ch || !ch.id) return;
            var list = store.getMessages(ch.id);
            var last = findLastPreviewMessage(list);
            var preview = previewFromMessage(last, ch).slice(0, 120);
            if (String(ch.lastPreview || '') !== preview) {
                ch.lastPreview = preview;
                dirty = true;
            }
            if (last && last.createdAt) {
                var wantAt = last.createdAt;
                if ((ch.lastAt || 0) > wantAt + 3000) {
                    ch.lastAt = wantAt;
                    dirty = true;
                }
            }
        });
        return dirty ? saveMeta() : Promise.resolve(false);
    }

    function privateChatScore(ch) {
        var msgs = (metaCache.messagesByChat[ch.id] || []);
        var count = msgs.length;
        var lastAt = Number(ch.lastAt) || 0;
        msgs.forEach(function (m) {
            var t = m && m.createdAt;
            if (t && t > lastAt) lastAt = t;
        });
        return { count: count, lastAt: lastAt };
    }

    function pickBestPrivateChat(chats, profileHint) {
        if (!chats || !chats.length) return null;
        if (chats.length === 1) return chats[0];
        var pid = String(profileHint || '').trim();
        if (pid) {
            var match = chats.find(function (ch) { return String(ch.profileId || '') === pid; });
            if (match) return match;
        }
        return chats.slice().sort(function (a, b) {
            var sa = privateChatScore(a);
            var sb = privateChatScore(b);
            if (sb.count !== sa.count) return sb.count - sa.count;
            return sb.lastAt - sa.lastAt;
        })[0];
    }

    function contactActivityScore(c) {
        if (!c || !c.id || !metaCache) return 0;
        var score = 0;
        if (c.pinned) score += 10000;
        if (c.chronicleId) score += 50;
        if (c.characterId) score += 20;
        if (c.remarkName) score += 10;
        if (String(c.avatar || '').trim() || c.avatarBlobId) score += 5;
        (metaCache.chats || []).forEach(function (ch) {
            if (!ch || ch.contactId !== c.id) return;
            var msgs = metaCache.messagesByChat[ch.id] || [];
            score += msgs.length * 100;
            score += Number(ch.lastAt) || 0;
        });
        score += Number(c.updatedAt) || 0;
        return score;
    }

    function pickBestContact(list) {
        if (!list || !list.length) return null;
        if (list.length === 1) return list[0];
        return list.slice().sort(function (a, b) {
            return contactActivityScore(b) - contactActivityScore(a);
        })[0];
    }

    function remapMemberIds(memberIds, fromId, toId) {
        if (!Array.isArray(memberIds)) return memberIds;
        var seen = Object.create(null);
        var out = [];
        memberIds.forEach(function (id) {
            var next = id === fromId ? toId : id;
            next = String(next || '').trim();
            if (!next || seen[next]) return;
            seen[next] = true;
            out.push(next);
        });
        return out;
    }

    /**
     * 同一档案角色只保留一个联系人（并发同步/缓存未失效时会产生多个 ct_*）。
     * 合并后 remap 会话 contactId / 群成员，再交给 migrateDuplicatePrivateChats 收口。
     */
    function migrateDuplicateContacts() {
        if (!metaCache || !Array.isArray(metaCache.contacts)) return Promise.resolve(false);
        var contacts = metaCache.contacts;
        var parent = Object.create(null);
        function find(x) {
            var id = String(x || '');
            if (!id) return id;
            if (parent[id] == null) parent[id] = id;
            if (parent[id] !== id) parent[id] = find(parent[id]);
            return parent[id];
        }
        function union(a, b) {
            var ra = find(a);
            var rb = find(b);
            if (ra && rb && ra !== rb) parent[rb] = ra;
        }

        var byChronicle = Object.create(null);
        var byCharacterId = Object.create(null);
        contacts.forEach(function (c) {
            if (!c || !c.id) return;
            find(c.id);
            var chr = String(c.chronicleId || '').trim();
            var cid = String(c.characterId || '').trim();
            if (chr) {
                if (byChronicle[chr]) union(c.id, byChronicle[chr]);
                byChronicle[chr] = c.id;
            }
            if (cid) {
                if (byCharacterId[cid]) union(c.id, byCharacterId[cid]);
                byCharacterId[cid] = c.id;
            }
        });

        var groups = Object.create(null);
        contacts.forEach(function (c) {
            if (!c || !c.id) return;
            var root = find(c.id);
            if (!groups[root]) groups[root] = [];
            groups[root].push(c);
        });

        var dirty = false;
        Object.keys(groups).forEach(function (root) {
            var list = groups[root];
            if (!list || list.length <= 1) return;
            var keep = pickBestContact(list);
            if (!keep) return;
            list.forEach(function (dup) {
                if (!dup || dup.id === keep.id) return;
                if (!keep.chronicleId && dup.chronicleId) keep.chronicleId = dup.chronicleId;
                if (!keep.characterId && dup.characterId) keep.characterId = dup.characterId;
                if (!keep.remarkName && dup.remarkName) keep.remarkName = dup.remarkName;
                if (!keep.relationship && dup.relationship) keep.relationship = dup.relationship;
                if (!String(keep.avatar || '').trim() && !keep.avatarBlobId) {
                    if (dup.avatarBlobId) keep.avatarBlobId = dup.avatarBlobId;
                    else if (dup.avatar) keep.avatar = dup.avatar;
                }
                if (dup.pinned) keep.pinned = true;
                if (!keep.defaultProfileId && dup.defaultProfileId) {
                    keep.defaultProfileId = dup.defaultProfileId;
                }
                keep.chatSettings = mergeDupChatSettings(keep.chatSettings, dup.chatSettings);
                if (dup.wallet && keep.wallet) {
                    keep.wallet.balance = Math.max(
                        roundMoney(Number(keep.wallet.balance) || 0),
                        roundMoney(Number(dup.wallet.balance) || 0)
                    );
                }
                keep.updatedAt = Math.max(Number(keep.updatedAt) || 0, Number(dup.updatedAt) || 0);
                (metaCache.chats || []).forEach(function (ch) {
                    if (!ch) return;
                    if (ch.contactId === dup.id) ch.contactId = keep.id;
                    if (Array.isArray(ch.memberIds)) {
                        ch.memberIds = remapMemberIds(ch.memberIds, dup.id, keep.id);
                    }
                });
                metaCache.contacts = metaCache.contacts.filter(function (c) {
                    return c && c.id !== dup.id;
                });
                dirty = true;
            });
        });
        if (dirty) invalidateLookupCache();
        return dirty ? saveMeta() : Promise.resolve(false);
    }

    /** 同一联系人只保留一条私聊；合并历史重复会话（曾按用户面具拆成多条） */
    function migrateDuplicatePrivateChats() {
        if (!metaCache || !Array.isArray(metaCache.chats)) return Promise.resolve(false);
        var byContact = {};
        metaCache.chats.forEach(function (ch) {
            if (!ch || ch.type === 'group') return;
            var cid = String(ch.contactId || '').trim();
            if (!cid) return;
            if (!byContact[cid]) byContact[cid] = [];
            byContact[cid].push(ch);
        });
        var dirty = false;
        Object.keys(byContact).forEach(function (cid) {
            var list = byContact[cid];
            if (list.length <= 1) return;
            var keep = pickBestPrivateChat(list, '');
            if (!keep) return;
            var keepMsgs = (metaCache.messagesByChat[keep.id] || []).slice();
            var seenMsgIds = {};
            keepMsgs.forEach(function (m) {
                if (m && m.id) seenMsgIds[m.id] = true;
            });
            list.forEach(function (dup) {
                if (!dup || dup.id === keep.id) return;
                keep.chatSettings = mergeDupChatSettings(keep.chatSettings, dup.chatSettings);
                (metaCache.messagesByChat[dup.id] || []).forEach(function (m) {
                    if (!m) return;
                    if (m.id && seenMsgIds[m.id]) return;
                    if (m.id) seenMsgIds[m.id] = true;
                    keepMsgs.push(m);
                });
                delete metaCache.messagesByChat[dup.id];
                metaCache.chats = metaCache.chats.filter(function (ch) { return ch.id !== dup.id; });
                dirty = true;
            });
            keepMsgs.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
            metaCache.messagesByChat[keep.id] = keepMsgs;
            keep.chatSettings = normalizeChatSettings(keep.chatSettings);
            var last = keepMsgs.length ? keepMsgs[keepMsgs.length - 1] : null;
            if (last) {
                keep.lastAt = last.createdAt || keep.lastAt || Date.now();
                keep.lastPreview = previewFromMessage(last, keep).slice(0, 120);
            }
            keep.unread = list.reduce(function (sum, ch) {
                return sum + (Number(ch.unread) || 0);
            }, 0);
        });
        if (dirty) invalidateLookupCache();
        return dirty ? saveMeta() : Promise.resolve(false);
    }

    function dedupeContactsAndPrivateChats() {
        return migrateDuplicateContacts().then(function () {
            return migrateDuplicatePrivateChats();
        });
    }

    var createChatChainByKey = Object.create(null);
    var addContactChainByKey = Object.create(null);
    function enqueueByKey(map, key, fn) {
        var k = String(key || '__default__');
        var prev = map[k] || Promise.resolve();
        var job = prev.then(fn, fn);
        map[k] = job.then(
            function () {},
            function () {}
        );
        return job;
    }

    function migrateBackgroundMessageFlags() {
        if (!metaCache || !Array.isArray(metaCache.chats)) return Promise.resolve(false);
        var dirty = false;
        metaCache.chats.forEach(function (ch) {
            if (!ch || !ch.chatSettings || !ch.chatSettings.backgroundMessage) return;
            var bm = ch.chatSettings.backgroundMessage;
            if (!bm.activeEnabled && bm.mode === 'active') {
                ch.chatSettings.backgroundMessage = Object.assign({}, bm, { mode: 'off' });
                dirty = true;
            }
        });
        return dirty ? saveMeta() : Promise.resolve(false);
    }

    function stripEphemeralCallApiFieldsFromStore() {
        if (!metaCache || !metaCache.messagesByChat) return Promise.resolve(false);
        var dirty = false;
        Object.keys(metaCache.messagesByChat).forEach(function (cid) {
            var list = metaCache.messagesByChat[cid];
            if (!Array.isArray(list)) return;
            list.forEach(function (m, idx) {
                if (!m || (!m._apiCallPrefix && !m._apiCallSuffix)) return;
                var next = Object.assign({}, m);
                delete next._apiCallPrefix;
                delete next._apiCallSuffix;
                list[idx] = next;
                dirty = true;
            });
        });
        return dirty ? saveMeta() : Promise.resolve(false);
    }

    /**
     * 串行落盘：每次真正写入前再快照「当前」metaCache。
     * 禁止用旧快照回写 live metaCache（并发 addMessage + saveChatSettings
     * 会把刚发的用户/角色消息冲掉，UI 气泡还在但 API 读不到）。
     *
     * 热路径用 scheduleSaveMeta 合并多次写入；UI 立刻拿到内存结果，
     * 避免每次换背景/保存设置都整库深拷贝 + IDB 双写卡数秒。
     */
    var metaSaveChain = Promise.resolve();
    var META_SAVE_DEBOUNCE_MS = 120;
    var metaSaveTimer = 0;
    var metaSavePending = false;

    function snapshotMetaForPersist() {
        if (!metaCache) return null;
        try {
            var clone = typeof global.miyaDeepClone === 'function'
                ? global.miyaDeepClone(metaCache)
                : JSON.parse(JSON.stringify(metaCache));
            return normalizeMeta(clone);
        } catch (e) {
            return null;
        }
    }

    function saveMeta(opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        if (!metaCache) return Promise.reject(new Error('store_not_ready'));
        metaSavePending = false;
        var job = metaSaveChain.then(function () {
            var normalized = snapshotMetaForPersist();
            if (!normalized) throw new Error('save_serialize_failed');
            if (shouldBlockSparsePersist(normalized)) {
                console.warn('[miyaChatStore] skip meta persist while hydrate guard active');
                return false;
            }
            return persistMetaSnapshot(normalized, {
                withBackup: !!opts.withBackup,
                forceEmergency: !!opts.forceEmergency
            });
        });
        metaSaveChain = job.then(
            function () {},
            function () {}
        );
        return job;
    }

    /** 合并短时间内的多次 meta 变更；内存已更新，落盘稍后一次完成 */
    function scheduleSaveMeta() {
        if (!metaCache) return Promise.reject(new Error('store_not_ready'));
        metaSavePending = true;
        if (!metaSaveTimer) {
            metaSaveTimer = setTimeout(function () {
                metaSaveTimer = 0;
                if (!metaSavePending) return;
                saveMeta().catch(function () {});
            }, META_SAVE_DEBOUNCE_MS);
        }
        return Promise.resolve(true);
    }

    function flushSaveMeta(opts) {
        if (metaSaveTimer) {
            clearTimeout(metaSaveTimer);
            metaSaveTimer = 0;
        }
        if (!metaCache) return Promise.resolve(false);
        return saveMeta(opts || { withBackup: true, forceEmergency: true });
    }

    function saveMetaSync() {
        if (!metaCache) return;
        if (metaSaveTimer) {
            clearTimeout(metaSaveTimer);
            metaSaveTimer = 0;
        }
        metaSavePending = false;
        var normalized = snapshotMetaForPersist();
        if (!normalized) return;
        if (shouldBlockSparsePersist(normalized)) return;
        writeEmergencyMetaThrottled(normalized, true);
        if (typeof global.miyaSyncFlushJsonKey === 'function') {
            global.miyaSyncFlushJsonKey(META_LS, normalized);
            if (metaRichness(normalized) > 0) {
                global.miyaSyncFlushJsonKey(META_BACKUP_LS, normalized);
            }
        } else {
            try {
                var str = JSON.stringify(normalized);
                if (str.length > META_LS_SOFT_MAX) {
                    localStorage.setItem(META_LS, JSON.stringify({ __storedInIdb: true }));
                } else {
                    localStorage.setItem(META_LS, str);
                }
            } catch (e2) {}
            kvPut(normalized).catch(function () {});
            if (metaRichness(normalized) > 0) {
                kvPutBackup(normalized).catch(function () {});
            }
        }
    }

    function revokeUrl(id) {
        if (urlCache[id]) {
            try { URL.revokeObjectURL(urlCache[id]); } catch (e) {}
            delete urlCache[id];
        }
    }

    function storeBlob(file, kind) {
        return readFileAsArrayBuffer(file).then(function (buf) {
            var id = uid(kind || 'blob');
            var mime = file.type || 'image/jpeg';
            var blob = new Blob([buf], { type: mime });
            return idbPut(id, {
                kind: kind || 'image',
                mime: mime,
                blob: blob,
                size: blob.size,
                createdAt: Date.now()
            }).then(function () { return id; });
        });
    }

    function storeMediaBlob(blob, kind) {
        if (!blob || typeof blob.size !== 'number') return Promise.reject(new Error('no_blob'));
        var id = uid(kind || 'blob');
        var mime = String(blob.type || '').trim() || 'application/octet-stream';
        var out =
            blob.type === mime
                ? blob
                : new Blob([blob], { type: mime });
        return idbPut(id, {
            kind: kind || 'media',
            mime: mime,
            blob: out,
            size: out.size,
            createdAt: Date.now()
        }).then(function () {
            return id;
        });
    }

    function getBlobUrl(blobId) {
        if (!blobId) return Promise.resolve('');
        if (urlCache[blobId]) return Promise.resolve(urlCache[blobId]);
        return idbGet(blobId).then(function (rec) {
            if (!rec || !rec.blob) return '';
            var b = rec.blob;
            var mime = String(rec.mime || b.type || '').trim();
            if (mime && b.type !== mime) {
                b = new Blob([b], { type: mime });
            }
            var url = URL.createObjectURL(b);
            urlCache[blobId] = url;
            return url;
        }).catch(function () { return ''; });
    }

    function prefetchBlobUrls(blobIds) {
        var seen = {};
        var list = [];
        (blobIds || []).forEach(function (id) {
            id = String(id || '').trim();
            if (!id || seen[id]) return;
            seen[id] = true;
            list.push(id);
        });
        if (!list.length) return Promise.resolve({});
        return Promise.all(list.map(function (id) {
            return getBlobUrl(id).then(function (url) {
                return { id: id, url: url };
            });
        })).then(function (rows) {
            var map = {};
            rows.forEach(function (row) {
                if (row && row.id) map[row.id] = row.url || '';
            });
            return map;
        });
    }

    function defaultWallet() {
        return { balance: 0, kinCards: [] };
    }

    function defaultProfile(name) {
        return {
            id: uid('prof'),
            name: name || '未命名',
            gender: '',
            birthday: '',
            persona: '',
            avatarId: null,
            displayAvatar: defaultDisplayAvatar(),
            wallet: defaultWallet(),
            inventory: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    function normalizeProfile(raw) {
        if (!raw || typeof raw !== 'object') return defaultProfile('我');
        return {
            id: String(raw.id || uid('prof')),
            name: String(raw.name || '').trim() || '未命名',
            gender: String(raw.gender || '').trim(),
            birthday: String(raw.birthday || '').trim(),
            persona: String(raw.persona || '').trim(),
            avatarId: raw.avatarId ? String(raw.avatarId) : null,
            displayAvatar: normalizeDisplayAvatar(raw.displayAvatar),
            wallet: raw.wallet && typeof raw.wallet === 'object' ? raw.wallet : defaultWallet(),
            inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
            createdAt: Number(raw.createdAt) || Date.now(),
            updatedAt: Number(raw.updatedAt) || Date.now()
        };
    }

    function getActiveProfile() {
        var m = metaCache || defaultMeta();
        if (!m.profiles.length) return null;
        var id = m.activeProfileId;
        var p = m.profiles.find(function (x) { return x.id === id; });
        return p ? normalizeProfile(p) : normalizeProfile(m.profiles[0]);
    }

    var store = {
        clearBlobUrlCache: function () {
            Object.keys(urlCache).forEach(function (id) {
                revokeUrl(id);
            });
        },

        reloadMeta: function () {
            metaCache = null;
            invalidateLookupCache();
            Object.keys(urlCache).forEach(function (id) {
                revokeUrl(id);
            });
            return loadMeta();
        },

        flushMeta: function () {
            return flushSaveMeta({ withBackup: true, forceEmergency: true });
        },

        init: function () {
            if (initSettled && metaCache) return Promise.resolve(metaCache);
            if (initPromise) return initPromise;
            initPromise = loadMeta()
                .catch(function (err) {
                    if (!err || err.message !== 'meta_idb_hydrate_failed') throw err;
                    metaCache = null;
                    return new Promise(function (resolve) {
                        setTimeout(resolve, 350);
                    }).then(function () {
                        return loadMeta();
                    });
                })
                .catch(function (err) {
                    if (!err || err.message !== 'meta_idb_hydrate_failed') throw err;
                    return kvGetBackup().then(function (backup) {
                        if (metaIsValidSnapshot(backup) && metaRichness(backup) > 0) {
                            console.warn('[miyaChatStore] meta IDB hydrate failed; restored from durable backup');
                            metaCache = normalizeMeta(backup);
                            invalidateLookupCache();
                            clearMetaHydrateGuard();
                            return persistMetaSnapshot(metaCache, { withBackup: true, forceEmergency: true })
                                .then(function () { return metaCache; });
                        }
                        var emergency = readEmergencyMeta();
                        if (metaIsValidSnapshot(emergency) && metaRichness(emergency) > 0) {
                            console.warn('[miyaChatStore] meta IDB hydrate failed; restored from emergency snapshot');
                            metaCache = normalizeMeta(emergency);
                            invalidateLookupCache();
                            clearMetaHydrateGuard();
                            return persistMetaSnapshot(metaCache, { withBackup: true, forceEmergency: true })
                                .then(function () { return metaCache; });
                        }
                        console.warn('[miyaChatStore] meta hydrate failed; keeping empty shell (data not wiped)');
                        metaHydrateFailedWithPlaceholder = true;
                        metaCache = defaultMeta();
                        invalidateLookupCache();
                        scheduleBackgroundMetaRecover();
                        return metaCache;
                    });
                })
                .then(function () {
                    return stripEphemeralCallApiFieldsFromStore();
                })
                .then(function () {
                    return migrateBackgroundMessageFlags();
                })
                .then(function () {
                    return dedupeContactsAndPrivateChats();
                })
                .then(function () {
                    return repairLedgerPreviewsFromVisible();
                })
                .then(function () {
                    return migrateLegacyChatDisplayAvatars();
                })
                .then(function () {
                if (!metaCache.profiles.length) {
                    var p = defaultProfile('我');
                    metaCache.profiles.push(p);
                    metaCache.activeProfileId = p.id;
                    /* 水合失败守卫期间只补内存档案，禁止空壳落盘覆盖真实数据 */
                    if (metaHydrateFailedWithPlaceholder) return;
                    return saveMeta();
                }
                var renamed = false;
                metaCache.profiles.forEach(function (prof) {
                    if (prof && (prof.name === '旅人' || prof.name === 'Traveler')) {
                        prof.name = '我';
                        prof.updatedAt = Date.now();
                        renamed = true;
                    }
                });
                if (renamed) {
                    if (metaHydrateFailedWithPlaceholder) return;
                    return saveMeta();
                }
                if (!metaCache.activeProfileId && metaCache.profiles[0]) {
                    metaCache.activeProfileId = metaCache.profiles[0].id;
                    if (metaHydrateFailedWithPlaceholder) return;
                    return saveMeta();
                }
            })
                .then(function () {
                    initSettled = true;
                    return metaCache;
                })
                .catch(function (err) {
                    initPromise = null;
                    throw err;
                });
            return initPromise;
        },

        getMeta: function () { return metaCache || defaultMeta(); },

        /** 聊天消息 imageDataKey 集合（仅用户/角色在对话里发送的图片） */
        collectMessageImageBlobKeys: function () {
            var keys = {};
            var m = metaCache || defaultMeta();
            Object.keys(m.messagesByChat || {}).forEach(function (chatId) {
                (m.messagesByChat[chatId] || []).forEach(function (msg) {
                    if (!msg || msg.deleted) return;
                    if (msg.type !== 'image') return;
                    var id = String(msg.imageDataKey || '').trim();
                    if (id) keys[id] = true;
                });
            });
            return keys;
        },

        getProfiles: function () {
            return (metaCache && metaCache.profiles)
                ? metaCache.profiles.map(normalizeProfile)
                : [];
        },

        hasContactDisplayAvatarOverride: function (contact) {
            return displayAvatarHasData(getContactDisplayAvatarRecord(contact));
        },

        hasProfileDisplayAvatarOverride: function (profile) {
            return displayAvatarHasData(getProfileDisplayAvatarRecord(profile));
        },

        resolveContactDisplayAvatarSync: function (contact) {
            return resolveDisplayAvatarSync(getContactDisplayAvatarRecord(contact));
        },

        resolveContactDisplayAvatarKey: function (contact) {
            return resolveDisplayAvatarKey(getContactDisplayAvatarRecord(contact));
        },

        resolveContactDisplayAvatarAsync: function (contact) {
            return resolveDisplayAvatarAsync(getContactDisplayAvatarRecord(contact));
        },

        resolveProfileDisplayAvatarSync: function (profile) {
            return resolveDisplayAvatarSync(getProfileDisplayAvatarRecord(profile));
        },

        resolveProfileDisplayAvatarKey: function (profile) {
            return resolveDisplayAvatarKey(getProfileDisplayAvatarRecord(profile));
        },

        resolveProfileDisplayAvatarAsync: function (profile) {
            return resolveDisplayAvatarAsync(getProfileDisplayAvatarRecord(profile));
        },

        mergeContactDisplayAvatar: function (contactId, patch) {
            var c = store.findContact(contactId);
            if (!c) return Promise.reject(new Error('not_found'));
            patch = patch && typeof patch === 'object' ? patch : {};
            var cur = normalizeDisplayAvatar(c.displayAvatar);
            var next = patch.reset ? defaultDisplayAvatar() : Object.assign({}, cur);
            if (!patch.reset) {
                if (patch.url !== undefined) next.url = String(patch.url || '').trim();
                if (patch.blobId !== undefined) next.blobId = patch.blobId ? String(patch.blobId) : null;
                if (patch.desc !== undefined) next.desc = String(patch.desc || '').trim().slice(0, 800);
                if (patch.sourceMsgId !== undefined) next.sourceMsgId = String(patch.sourceMsgId || '').trim();
            }
            return store.updateContact(contactId, { displayAvatar: next });
        },

        mergeProfileDisplayAvatar: function (profileId, patch) {
            var idx = metaCache.profiles.findIndex(function (p) { return p.id === profileId; });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            patch = patch && typeof patch === 'object' ? patch : {};
            var cur = normalizeDisplayAvatar(metaCache.profiles[idx].displayAvatar);
            var next = patch.reset ? defaultDisplayAvatar() : Object.assign({}, cur);
            if (!patch.reset) {
                if (patch.url !== undefined) next.url = String(patch.url || '').trim();
                if (patch.blobId !== undefined) next.blobId = patch.blobId ? String(patch.blobId) : null;
                if (patch.desc !== undefined) next.desc = String(patch.desc || '').trim().slice(0, 800);
                if (patch.sourceMsgId !== undefined) next.sourceMsgId = String(patch.sourceMsgId || '').trim();
            }
            return store.updateProfile(profileId, { displayAvatar: next });
        },

        getActiveProfile: getActiveProfile,

        setActiveProfile: function (id) {
            if (!metaCache.profiles.some(function (p) { return p.id === id; })) return Promise.resolve(false);
            metaCache.activeProfileId = id;
            return saveMeta().then(function () { return true; });
        },

        createProfile: function (name) {
            var n = String(name || '').trim();
            if (!n) return Promise.reject(new Error('name_required'));
            var p = defaultProfile(n);
            metaCache.profiles.push(p);
            if (!metaCache.activeProfileId) metaCache.activeProfileId = p.id;
            return saveMeta().then(function () { return p; });
        },

        updateProfile: function (id, patch) {
            var idx = metaCache.profiles.findIndex(function (p) { return p.id === id; });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            var cur = normalizeProfile(metaCache.profiles[idx]);
            var next = Object.assign({}, cur, patch || {});
            var name = String(next.name || '').trim();
            if (!name) return Promise.reject(new Error('name_required'));
            next.name = name;
            next.updatedAt = Date.now();
            if (!next.wallet || typeof next.wallet !== 'object') next.wallet = defaultWallet();
            if (patch && patch.displayAvatar !== undefined) {
                next.displayAvatar = normalizeDisplayAvatar(
                    Object.assign({}, cur.displayAvatar, patch.displayAvatar)
                );
            } else {
                next.displayAvatar = normalizeDisplayAvatar(next.displayAvatar);
            }
            metaCache.profiles[idx] = next;
            return saveMeta().then(function () { return next; });
        },

        deleteProfile: function (id) {
            var p = metaCache.profiles.find(function (x) { return x.id === id; });
            if (!p) return Promise.resolve();
            if (metaCache.profiles.length <= 1) return Promise.reject(new Error('last_profile'));
            if (p.avatarId) {
                revokeUrl(p.avatarId);
                idbDelete(p.avatarId);
            }
            metaCache.profiles = metaCache.profiles.filter(function (x) { return x.id !== id; });
            if (metaCache.activeProfileId === id) {
                metaCache.activeProfileId = metaCache.profiles[0] ? metaCache.profiles[0].id : null;
            }
            return saveMeta();
        },

        setProfileAvatar: function (profileId, file) {
            if (!file) return Promise.reject(new Error('no_file'));
            var idx = metaCache.profiles.findIndex(function (p) { return p.id === profileId; });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            var old = metaCache.profiles[idx].avatarId;
            return storeBlob(file, 'avatar').then(function (blobId) {
                metaCache.profiles[idx].avatarId = blobId;
                metaCache.profiles[idx].updatedAt = Date.now();
                if (old && old !== blobId) {
                    revokeUrl(old);
                    idbDelete(old);
                }
                return saveMeta().then(function () { return blobId; });
            });
        },

        getAvatarUrl: getBlobUrl,

        getCachedBlobUrl: function (blobId) {
            var id = String(blobId || '').trim();
            return id && urlCache[id] ? urlCache[id] : '';
        },

        getShopCatalog: function () {
            var m = metaCache || defaultMeta();
            return normalizeShopCatalog(m.shopCatalog);
        },

        saveShopCatalog: function (catalog) {
            metaCache.shopCatalog = normalizeShopCatalog(catalog);
            return saveMeta().then(function () {
                return metaCache.shopCatalog;
            });
        },

        getCstoreMystical: function () {
            var m = metaCache || defaultMeta();
            return normalizeCstoreMystical(m.cstoreMystical);
        },

        saveCstoreMystical: function (catalog) {
            metaCache.cstoreMystical = normalizeCstoreMystical(catalog);
            return saveMeta().then(function () {
                return metaCache.cstoreMystical;
            });
        },

        getProfileInventory: function (profileId) {
            var pid = String(profileId || '').trim();
            var p = metaCache.profiles.find(function (x) { return x.id === pid; });
            if (!p) return [];
            if (!Array.isArray(p.inventory)) p.inventory = [];
            return p.inventory.map(normalizeInventoryItem).filter(Boolean);
        },

        addInventoryItem: function (profileId, item) {
            var pid = String(profileId || '').trim();
            if (!pid) return Promise.reject(new Error('profile_missing'));
            var norm = normalizeInventoryItem(item);
            if (!norm) return Promise.reject(new Error('invalid_item'));
            var idx = metaCache.profiles.findIndex(function (x) { return x.id === pid; });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            if (!Array.isArray(metaCache.profiles[idx].inventory)) {
                metaCache.profiles[idx].inventory = [];
            }
            metaCache.profiles[idx].inventory.unshift(norm);
            metaCache.profiles[idx].updatedAt = Date.now();
            return saveMeta().then(function () { return norm; });
        },

        getWallet: function (profileId) {
            var p = metaCache.profiles.find(function (x) { return x.id === profileId; });
            if (!p) return defaultWallet();
            if (!p.wallet || typeof p.wallet !== 'object') p.wallet = defaultWallet();
            return JSON.parse(JSON.stringify(p.wallet));
        },

        saveWallet: function (profileId, wallet) {
            var idx = metaCache.profiles.findIndex(function (p) { return p.id === profileId; });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            metaCache.profiles[idx].wallet = wallet || defaultWallet();
            metaCache.profiles[idx].updatedAt = Date.now();
            return saveMeta();
        },

        adjustWalletBalance: function (profileId, delta) {
            var pid = String(profileId || '').trim();
            if (!pid) return Promise.reject(new Error('profile_missing'));
            var d = Number(delta);
            if (!Number.isFinite(d) || !d) return Promise.reject(new Error('invalid_delta'));
            var w = store.getWallet(pid);
            var bal = Number(w.balance) || 0;
            var next = Math.round((bal + d) * 100) / 100;
            if (next < -0.0001) return Promise.reject(new Error('insufficient_balance'));
            w.balance = next < 0 ? 0 : next;
            return store.saveWallet(pid, w).then(function () {
                return w.balance;
            });
        },

        addKinCard: function (profileId, card) {
            var w = store.getWallet(profileId);
            w.kinCards = w.kinCards || [];
            w.kinCards.push({
                id: uid('kin'),
                name: String((card && card.name) || '亲属卡').trim() || '亲属卡',
                balance: Number((card && card.balance) || 0) || 0,
                limit: Number((card && card.limit) || 0) || 0
            });
            return store.saveWallet(profileId, w);
        },

        removeKinCard: function (profileId, cardId) {
            var w = store.getWallet(profileId);
            w.kinCards = (w.kinCards || []).filter(function (c) { return c.id !== cardId; });
            return store.saveWallet(profileId, w);
        },

        getContactWallet: function (contactId) {
            var c = store.findContact(contactId);
            if (!c) return { balance: 0 };
            if (!c.wallet || typeof c.wallet !== 'object') c.wallet = { balance: 0 };
            return JSON.parse(JSON.stringify(c.wallet));
        },

        saveContactWallet: function (contactId, wallet) {
            return store.updateContact(contactId, {
                wallet: wallet && typeof wallet === 'object' ? wallet : { balance: 0 }
            });
        },

        adjustContactWalletBalance: function (contactId, delta) {
            var cid = String(contactId || '').trim();
            if (!cid) return Promise.reject(new Error('contact_missing'));
            var d = Number(delta);
            if (!Number.isFinite(d) || !d) return Promise.reject(new Error('invalid_delta'));
            var w = store.getContactWallet(cid);
            var bal = Number(w.balance) || 0;
            var next = roundMoney(bal + d);
            if (next < -0.0001) return Promise.reject(new Error('insufficient_balance'));
            w.balance = next < 0 ? 0 : next;
            return store.saveContactWallet(cid, w).then(function () {
                return w.balance;
            });
        },

        setWalletBalance: function (profileId, balance) {
            var pid = String(profileId || '').trim();
            if (!pid) return Promise.reject(new Error('profile_missing'));
            var w = store.getWallet(pid);
            w.balance = roundMoney(balance);
            if (w.balance < 0) w.balance = 0;
            return store.saveWallet(pid, w).then(function () {
                return w.balance;
            });
        },

        setContactWalletBalance: function (contactId, balance) {
            var cid = String(contactId || '').trim();
            if (!cid) return Promise.reject(new Error('contact_missing'));
            var w = store.getContactWallet(cid);
            w.balance = roundMoney(balance);
            if (w.balance < 0) w.balance = 0;
            return store.saveContactWallet(cid, w).then(function () {
                return w.balance;
            });
        },

        getChatWallpapers: function () {
            return (metaCache && metaCache.chatWallpapers ? metaCache.chatWallpapers : [])
                .slice()
                .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
        },

        getChatWallpaperUrl: function (wp) {
            if (!wp) return Promise.resolve('');
            if (wp.url) return Promise.resolve(wp.url);
            if (wp.blobId) return getBlobUrl(wp.blobId);
            return Promise.resolve('');
        },

        addChatWallpapersFromFiles: function (files) {
            if (!metaCache) return Promise.reject(new Error('store_not_ready'));
            if (!Array.isArray(metaCache.chatWallpapers)) metaCache.chatWallpapers = [];
            var arr = Array.prototype.slice.call(files || []).filter(function (f) {
                return f && String(f.type || '').indexOf('image') === 0;
            });
            if (!arr.length) return Promise.reject(new Error('no_images'));
            var added = [];
            var chain = Promise.resolve();
            arr.forEach(function (file, i) {
                chain = chain.then(function () {
                    return store.storeChatMedia(file, 'wall').then(function (blobId) {
                        var baseName = String(file.name || '').replace(/\.[^.]+$/, '').trim();
                        var wp = normalizeChatWallpaper({
                            id: uid('cwp'),
                            blobId: blobId,
                            url: '',
                            name: baseName || ('壁纸' + (metaCache.chatWallpapers.length + added.length + 1)),
                            createdAt: Date.now()
                        });
                        if (!wp) return;
                        metaCache.chatWallpapers.unshift(wp);
                        added.push(wp);
                    });
                });
            });
            return chain.then(function () {
                return saveMeta().then(function () { return added; });
            });
        },

        removeChatWallpaper: function (id) {
            var wid = String(id || '').trim();
            if (!wid) return Promise.reject(new Error('invalid'));
            if (!metaCache) return Promise.reject(new Error('store_not_ready'));
            metaCache.chatWallpapers = (metaCache.chatWallpapers || []).filter(function (w) {
                return w && w.id !== wid;
            });
            return saveMeta();
        },

        getEmojiGroups: function () {
            return (metaCache.emojiGroups || []).slice().sort(function (a, b) {
                return (a.sort || 0) - (b.sort || 0);
            });
        },

        addEmojiGroup: function (name, scope, contactIds) {
            var n = String(name || '').trim();
            if (!n) return Promise.reject(new Error('name_required'));
            if (!metaCache) return Promise.reject(new Error('store_not_ready'));
            if (!Array.isArray(metaCache.emojiGroups)) {
                metaCache.emojiGroups = defaultMeta().emojiGroups.slice();
            }
            var g = {
                id: uid('grp'),
                name: n,
                sort: metaCache.emojiGroups.length,
                scope: 'global',
                contactIds: []
            };
            metaCache.emojiGroups.push(g);
            return saveMeta().then(function () { return g; });
        },

        emojiGroupAppliesToContact: function (group, contactId) {
            var g = group && typeof group === 'object' ? group : {};
            var gid = String(g.id || '').trim();
            if (!gid) return false;
            var cid = String(contactId || '').trim();
            if (!cid) return true;
            var contact = store.findContact(cid);
            var bound =
                contact && Array.isArray(contact.emojiGroupIds) ? contact.emojiGroupIds : [];
            if (!bound.length) return true;
            return bound.some(function (x) { return String(x || '').trim() === gid; });
        },

        setContactEmojiGroups: function (contactId, groupIds) {
            var cid = String(contactId || '').trim();
            if (!cid) return Promise.reject(new Error('not_found'));
            var ids = Array.isArray(groupIds)
                ? groupIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
                : [];
            return store.updateContact(cid, { emojiGroupIds: ids });
        },

        setContactWorldbookEntryOrder: function (contactId, entryIds) {
            var cid = String(contactId || '').trim();
            if (!cid) return Promise.reject(new Error('not_found'));
            var ids = Array.isArray(entryIds)
                ? entryIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean)
                : [];
            return store.updateContact(cid, { worldbookEntryOrder: ids });
        },

        setEmojiGroupScope: function (groupId, scope, contactIds) {
            if (String(groupId || '').trim() === 'default') {
                return Promise.reject(new Error('default_group_scope'));
            }
            var g = metaCache.emojiGroups.find(function (x) { return x.id === groupId; });
            if (!g) return Promise.reject(new Error('not_found'));
            var sc = String(scope || '').trim() === 'role' ? 'role' : 'global';
            g.scope = sc;
            g.contactIds =
                sc === 'role'
                    ? (Array.isArray(contactIds) ? contactIds : [])
                          .map(function (x) { return String(x || '').trim(); })
                          .filter(Boolean)
                    : [];
            return saveMeta();
        },

        renameEmojiGroup: function (id, name) {
            var g = metaCache.emojiGroups.find(function (x) { return x.id === id; });
            if (!g) return Promise.reject(new Error('not_found'));
            g.name = String(name || '').trim() || g.name;
            return saveMeta();
        },

        deleteEmojiGroup: function (id) {
            if (id === 'default') return Promise.reject(new Error('default_group'));
            metaCache.emojiGroups = metaCache.emojiGroups.filter(function (g) { return g.id !== id; });
            metaCache.emojiPacks.forEach(function (p) {
                if (p.groupId === id) p.groupId = 'default';
            });
            return saveMeta();
        },

        getEmojiPacks: function (groupId) {
            var list = metaCache.emojiPacks || [];
            if (groupId) list = list.filter(function (p) { return p.groupId === groupId; });
            return list.slice();
        },

        getEmojiPacksForContact: function (contactId) {
            var cid = String(contactId || '').trim();
            return (metaCache.emojiPacks || []).filter(function (pk) {
                var g = metaCache.emojiGroups.find(function (x) { return x.id === pk.groupId; });
                return store.emojiGroupAppliesToContact(g, cid);
            });
        },

        getAllEmojiItemsFlat: function () {
            var rows = [];
            (metaCache.emojiPacks || []).forEach(function (pk) {
                var grp = metaCache.emojiGroups.find(function (g) { return g.id === pk.groupId; });
                (pk.items || []).forEach(function (it) {
                    if (!it) return;
                    rows.push({
                        packId: pk.id,
                        packName: pk.name || '',
                        groupId: pk.groupId,
                        groupName: grp && grp.name ? grp.name : '',
                        item: it
                    });
                });
            });
            return rows;
        },

        collectEmojiNameSet: function () {
            var taken = {};
            (metaCache.emojiPacks || []).forEach(function (pk) {
                (pk.items || []).forEach(function (it) {
                    var n = String((it && it.name) || '').trim();
                    if (n) taken[n] = true;
                });
            });
            return taken;
        },

        getEmojiItemDisplayUrl: function (item) {
            if (!item) return Promise.resolve('');
            if (item.url) return Promise.resolve(String(item.url));
            if (item.blobId) return getBlobUrl(item.blobId);
            return Promise.resolve('');
        },

        moveEmojiPack: function (packId, groupId) {
            var pk = metaCache.emojiPacks.find(function (p) { return p.id === packId; });
            if (!pk) return Promise.reject(new Error('not_found'));
            pk.groupId = groupId || 'default';
            return saveMeta();
        },

        deleteEmojiPack: function (packId) {
            var pk = metaCache.emojiPacks.find(function (p) { return p.id === packId; });
            if (!pk) return Promise.resolve();
            (pk.items || []).forEach(function (it) {
                if (it && it.blobId) {
                    revokeUrl(it.blobId);
                    idbDelete(it.blobId);
                }
            });
            metaCache.emojiPacks = metaCache.emojiPacks.filter(function (p) { return p.id !== packId; });
            return saveMeta();
        },

        deleteEmojiItem: function (packId, itemId) {
            var pk = metaCache.emojiPacks.find(function (p) { return p.id === packId; });
            if (!pk) return Promise.reject(new Error('not_found'));
            var key = String(itemId || '').trim();
            var hit = (pk.items || []).find(function (it) { return it && it.id === key; });
            if (!hit) return Promise.reject(new Error('item_not_found'));
            if (hit.blobId) {
                revokeUrl(hit.blobId);
                idbDelete(hit.blobId);
            }
            pk.items = (pk.items || []).filter(function (it) { return it && it.id !== key; });
            if (!pk.items.length) {
                metaCache.emojiPacks = metaCache.emojiPacks.filter(function (p) { return p.id !== packId; });
            }
            return saveMeta();
        },

        renameEmojiItem: function (packId, itemId, newName) {
            var parser = global.miyaChatEmojiUrl;
            var norm =
                parser && typeof parser.normalizeEmojiStickerName === 'function'
                    ? parser.normalizeEmojiStickerName
                    : function (s) { return String(s || '').trim(); };
            var pk = metaCache.emojiPacks.find(function (p) { return p.id === packId; });
            if (!pk) return Promise.reject(new Error('not_found'));
            var key = String(itemId || '').trim();
            var hit = (pk.items || []).find(function (it) { return it && it.id === key; });
            if (!hit) return Promise.reject(new Error('item_not_found'));
            var nm = norm(newName);
            if (!nm) return Promise.reject(new Error('name_required'));
            var taken = store.collectEmojiNameSet();
            if (taken[nm] && String(hit.name || '').trim() !== nm) {
                return Promise.reject(new Error('name_conflict'));
            }
            hit.name = nm;
            return saveMeta();
        },

        importEmojiPackFromRows: function (groupId, packName, rows) {
            var parser = global.miyaChatEmojiUrl;
            var resolve =
                parser && typeof parser.resolveEmojiImportName === 'function'
                    ? parser.resolveEmojiImportName
                    : null;
            var gid = groupId || 'default';
            if (!metaCache.emojiGroups.some(function (g) { return g.id === gid; })) gid = 'default';
            var label = String(packName || '').trim() || 'URL导入';
            var taken = store.collectEmojiNameSet();
            var items = [];
            (rows || []).forEach(function (row, i) {
                if (!row) return;
                var url = String(row.url || '').trim();
                if (!url) return;
                var preset = String(row.name || '').trim();
                var finalName;
                if (preset && !taken[preset]) {
                    finalName = preset;
                    taken[preset] = true;
                } else if (resolve) {
                    finalName = resolve(preset, url, taken, { fallback: '表情' + (i + 1) });
                } else {
                    finalName = preset || '表情' + (i + 1);
                    taken[finalName] = true;
                }
                items.push({
                    id: uid('emo'),
                    name: finalName,
                    url: url,
                    source: 'url'
                });
            });
            if (!items.length) return Promise.reject(new Error('no_items'));
            var packId = uid('pack');
            metaCache.emojiPacks.push({
                id: packId,
                groupId: gid,
                name: label,
                items: items,
                createdAt: Date.now()
            });
            return saveMeta().then(function () {
                return {
                    pack: metaCache.emojiPacks.find(function (p) { return p.id === packId; }),
                    added: items.length
                };
            });
        },

        importEmojiPackFromFilesWithNames: function (groupId, packName, entries) {
            var parser = global.miyaChatEmojiUrl;
            var gid = groupId || 'default';
            if (!metaCache.emojiGroups.some(function (g) { return g.id === gid; })) gid = 'default';
            var label = String(packName || '').trim() || '未命名表情包';
            var arr = (entries || []).filter(function (e) {
                return e && e.file && (e.file.type || '').indexOf('image') === 0;
            });
            if (!arr.length) return Promise.reject(new Error('no_images'));
            var resolve =
                parser && typeof parser.resolveEmojiImportName === 'function'
                    ? parser.resolveEmojiImportName
                    : null;
            var norm =
                parser && typeof parser.normalizeEmojiStickerName === 'function'
                    ? parser.normalizeEmojiStickerName
                    : function (s) { return String(s || '').trim(); };
            var taken = store.collectEmojiNameSet();
            var packId = uid('pack');
            var items = [];
            var chain = Promise.resolve();
            arr.forEach(function (entry, i) {
                chain = chain.then(function () {
                    var file = entry.file;
                    var preferred =
                        entry.name ||
                        norm((file.name || '表情' + (i + 1)).replace(/\.[^.]+$/, '')) ||
                        '表情' + (i + 1);
                    var finalName = resolve
                        ? resolve(preferred, null, taken, { fallback: '表情' + (i + 1) })
                        : preferred;
                    return storeBlob(file, 'emoji').then(function (blobId) {
                        items.push({
                            id: uid('emo'),
                            name: finalName,
                            blobId: blobId,
                            source: 'file'
                        });
                    });
                });
            });
            return chain.then(function () {
                metaCache.emojiPacks.push({
                    id: packId,
                    groupId: gid,
                    name: label,
                    items: items,
                    createdAt: Date.now()
                });
                return saveMeta().then(function () {
                    return metaCache.emojiPacks.find(function (p) { return p.id === packId; });
                });
            });
        },

        getEmojiItemUrl: getBlobUrl,
        prefetchBlobUrls: prefetchBlobUrls,

        getSavedMessages: function () {
            return (metaCache.savedMessages || []).slice().sort(function (a, b) {
                return (b.savedAt || 0) - (a.savedAt || 0);
            });
        },

        addSavedMessage: function (msg) {
            var chatId = String((msg && msg.chatId) || '').trim();
            var messageId = String((msg && msg.messageId) || '').trim();
            if (chatId && messageId) {
                var dup = (metaCache.savedMessages || []).find(function (m) {
                    return m.chatId === chatId && m.messageId === messageId;
                });
                if (dup) return Promise.resolve(dup);
            }
            var snapshot = null;
            if (msg && msg.msgSnapshot && typeof msg.msgSnapshot === 'object') {
                snapshot = msg.msgSnapshot;
            } else if (msg && msg.message) {
                snapshot = snapshotMessageForFavorite(msg.message);
            }
            var entry = {
                id: uid('save'),
                chatId: chatId,
                messageId: messageId,
                text: String((msg && msg.text) || '').trim(),
                from: String((msg && msg.from) || '').trim(),
                chatName: String((msg && msg.chatName) || '').trim(),
                role: String((msg && msg.role) || '').trim(),
                msgType: String((msg && msg.msgType) || (snapshot && snapshot.type) || 'text').trim(),
                msgSnapshot: snapshot,
                savedAt: Date.now()
            };
            if (!entry.text && snapshot) {
                entry.text = messagePreview(snapshot);
            }
            if (!entry.text && !savedMessageHasBody(snapshot)) {
                return Promise.reject(new Error('empty'));
            }
            metaCache.savedMessages.unshift(entry);
            return saveMeta().then(function () { return entry; });
        },

        isMessageFavorited: function (chatId, messageId) {
            var cid = String(chatId || '').trim();
            var mid = String(messageId || '').trim();
            if (!cid || !mid) return false;
            return (metaCache.savedMessages || []).some(function (m) {
                return m.chatId === cid && m.messageId === mid;
            });
        },

        removeSavedMessage: function (id) {
            metaCache.savedMessages = (metaCache.savedMessages || []).filter(function (m) {
                return m.id !== id;
            });
            return saveMeta();
        },

        removeSavedMessageByRef: function (chatId, messageId) {
            var cid = String(chatId || '').trim();
            var mid = String(messageId || '').trim();
            metaCache.savedMessages = (metaCache.savedMessages || []).filter(function (m) {
                return !(m.chatId === cid && m.messageId === mid);
            });
            return saveMeta();
        },

        getContactGroups: function () {
            return (metaCache.contactGroups || []).slice().sort(function (a, b) {
                return (a.sort || 0) - (b.sort || 0);
            });
        },

        addContactGroup: function (name) {
            var n = String(name || '').trim();
            if (!n) return Promise.reject(new Error('name_required'));
            var g = { id: uid('ctg'), name: n, sort: metaCache.contactGroups.length, createdAt: Date.now() };
            metaCache.contactGroups.push(g);
            return saveMeta().then(function () { return g; });
        },

        renameContactGroup: function (id, name) {
            var g = metaCache.contactGroups.find(function (x) { return x.id === id; });
            if (!g) return Promise.reject(new Error('not_found'));
            g.name = String(name || '').trim() || g.name;
            return saveMeta();
        },

        deleteContactGroup: function (id) {
            if (id === 'ct-default') return Promise.reject(new Error('default_group'));
            metaCache.contactGroups = metaCache.contactGroups.filter(function (g) { return g.id !== id; });
            metaCache.contacts.forEach(function (c) {
                if (c.groupId === id) c.groupId = 'ct-default';
            });
            metaCache.chats.forEach(function (ch) {
                if (ch.groupId === id) ch.groupId = 'ct-default';
            });
            return saveMeta();
        },

        getContacts: function (groupId) {
            if (!metaCache) return [];
            var list = ensureContactLookupCache().list;
            if (!groupId || groupId === 'all') return list.slice();
            return list.filter(function (c) { return c.groupId === String(groupId); });
        },

        findContact: function (id) {
            if (!metaCache) return null;
            var key = String(id || '').trim();
            return ensureContactLookupCache().byId[key] || null;
        },

        findContactByChronicle: function (chronicleId) {
            var key = String(chronicleId || '').trim();
            if (!key || !metaCache) return null;
            return ensureContactLookupCache().byChronicle[key] || null;
        },

        findContactByArchiveCharacter: function (row) {
            if (!row || !metaCache) return null;
            var cl = ensureContactLookupCache();
            var key = String(row.id || '').trim();
            if (key && cl.byChronicle[key]) return cl.byChronicle[key];
            var cid = String(row.characterId || row.id || '').trim();
            if (cid && cl.byCharacterId[cid]) return cl.byCharacterId[cid];
            return null;
        },

        buildContactsTabLookup: function () {
            if (!metaCache) {
                return { byChronicle: {}, byCharacterId: {}, chatByContact: {} };
            }
            var cl = ensureContactLookupCache();
            var chl = ensureChatLookupCache();
            return {
                byChronicle: cl.byChronicle,
                byCharacterId: cl.byCharacterId,
                chatByContact: chl.bestPrivateByContact
            };
        },

        addContactFromChronicle: function (chronicleRow, groupId, profileId) {
            if (!metaCache) return Promise.reject(new Error('store_not_ready'));
            if (!chronicleRow || !chronicleRow.id) return Promise.reject(new Error('invalid_character'));
            var lockKey = String(chronicleRow.id || '') + '|' + String(chronicleRow.characterId || chronicleRow.id || '');
            return enqueueByKey(addContactChainByKey, lockKey, function () {
                var existing = store.findContactByArchiveCharacter(chronicleRow);
                if (existing) {
                    return store.updateContact(existing.id, {
                        groupId: groupId || existing.groupId,
                        defaultProfileId: profileId || existing.defaultProfileId,
                        chronicleId: chronicleRow.id,
                        characterId: chronicleRow.characterId || chronicleRow.id,
                        name: chronicleRow.name || existing.name,
                        avatar: trimContactAvatarForStore(chronicleRow.avatar || existing.avatar)
                    });
                }
                var c = normalizeContact({
                    chronicleId: chronicleRow.id,
                    characterId: chronicleRow.characterId || chronicleRow.id,
                    groupId: groupId || 'ct-default',
                    name: chronicleRow.name,
                    avatar: trimContactAvatarForStore(chronicleRow.avatar),
                    defaultProfileId: profileId || metaCache.activeProfileId || '',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
                if (!c.name) return Promise.reject(new Error('name_required'));
                metaCache.contacts.push(c);
                invalidateLookupCache();
                return saveMeta().then(function () { return c; });
            });
        },

        updateContact: function (id, patch) {
            var idx = metaCache.contacts.findIndex(function (c) { return c.id === id; });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            return spillLargeContactAvatarPatch(patch || {}).then(function (resolvedPatch) {
                var prev = metaCache.contacts[idx];
                if (resolvedPatch && resolvedPatch.avatarBlobId && prev.avatarBlobId && prev.avatarBlobId !== resolvedPatch.avatarBlobId) {
                    revokeUrl(prev.avatarBlobId);
                    idbDelete(prev.avatarBlobId);
                }
                var next = normalizeContact(
                    Object.assign({}, prev, resolvedPatch || {}, { updatedAt: Date.now() })
                );
                metaCache.contacts[idx] = next;
                invalidateLookupCache();
                return scheduleSaveMeta().then(function () { return next; });
            });
        },

        removeContact: function (id) {
            var key = String(id || '');
            metaCache.contacts = metaCache.contacts.filter(function (c) { return c.id !== key; });
            var chatIds = metaCache.chats.filter(function (ch) { return ch.contactId === key; }).map(function (ch) { return ch.id; });
            metaCache.chats = metaCache.chats.filter(function (ch) { return ch.contactId !== key; });
            chatIds.forEach(function (cid) { delete metaCache.messagesByChat[cid]; });
            invalidateLookupCache();
            return saveMeta();
        },

        getChats: function (groupId) {
            if (!metaCache) return [];
            var cl = ensureContactLookupCache();
            var list = ensureChatLookupCache().list.slice();
            list.sort(function (a, b) {
                var pinA = a.type !== 'group' && cl.byId[a.contactId] && cl.byId[a.contactId].pinned ? 1 : 0;
                var pinB = b.type !== 'group' && cl.byId[b.contactId] && cl.byId[b.contactId].pinned ? 1 : 0;
                if (pinB !== pinA) return pinB - pinA;
                return (b.lastAt || 0) - (a.lastAt || 0);
            });
            if (!groupId || groupId === 'all') return list;
            return list.filter(function (ch) { return ch.groupId === String(groupId); });
        },

        findChat: function (id) {
            var key = String(id || '').trim();
            if (!key || !metaCache) return null;
            return ensureChatLookupCache().byId[key] || null;
        },

        findChatByContact: function (contactId, profileId) {
            var cid = String(contactId || '').trim();
            if (!cid || !metaCache) return null;
            var chl = ensureChatLookupCache();
            var privates = chl.privateByContact[cid];
            if (!privates || !privates.length) return null;
            return pickBestPrivateChat(privates, profileId);
        },

        createChat: function (opts) {
            var o = opts && typeof opts === 'object' ? opts : {};
            if (o.type === 'group') {
                return store.createGroupChat(o);
            }
            var contactKey = String(o.contactId || '').trim() || '__missing__';
            return enqueueByKey(createChatChainByKey, contactKey, function () {
                var contact = store.findContact(o.contactId);
                if (!contact) return Promise.reject(new Error('contact_not_found'));
                var existing = store.findChatByContact(o.contactId);
                if (existing) return existing;
                var live = (metaCache.chats || []).find(function (ch) {
                    return ch && ch.type !== 'group' && String(ch.contactId || '') === String(o.contactId || '');
                });
                if (live) return normalizeChat(live);
                var ch = normalizeChat({
                    contactId: o.contactId || '',
                    profileId: o.profileId || metaCache.activeProfileId || '',
                    groupId: o.groupId || (contact && contact.groupId) || 'ct-default',
                    type: 'private',
                    title: o.title || (contact && contact.name) || '',
                    lastPreview: '',
                    lastAt: Date.now(),
                    unread: 0,
                    createdAt: Date.now()
                });
                metaCache.chats.unshift(ch);
                if (!metaCache.messagesByChat[ch.id]) metaCache.messagesByChat[ch.id] = [];
                invalidateLookupCache();
                return saveMeta().then(function () { return ch; });
            });
        },

        createGroupChat: function (opts) {
            var o = opts && typeof opts === 'object' ? opts : {};
            var memberIds = (Array.isArray(o.memberIds) ? o.memberIds : [])
                .map(function (id) {
                    return String(id || '').trim();
                })
                .filter(Boolean);
            var uniq = [];
            var seen = {};
            memberIds.forEach(function (id) {
                if (seen[id]) return;
                seen[id] = true;
                if (store.findContact(id)) uniq.push(id);
            });
            if (uniq.length < 2) return Promise.reject(new Error('need_two_members'));
            var title = String(o.title || '').trim() || '群聊';
            var ch = normalizeChat({
                type: 'group',
                memberIds: uniq,
                contactId: '',
                profileId: o.profileId || metaCache.activeProfileId || '',
                groupId: o.groupId || 'ct-default',
                title: title,
                lastPreview: '',
                lastAt: Date.now(),
                unread: 0,
                createdAt: Date.now()
            });
            ch.chatSettings = normalizeChatSettings(
                Object.assign({}, ch.chatSettings || {}, {
                    groupOwnerId: '__user__',
                    groupAdminIds: [],
                    memberTitles: {},
                    groupWorldbookEntryIds: []
                })
            );
            metaCache.chats.unshift(ch);
            if (!metaCache.messagesByChat[ch.id]) metaCache.messagesByChat[ch.id] = [];
            invalidateLookupCache();
            return saveMeta().then(function () { return ch; });
        },

        addGroupMembers: function (chatId, memberIds) {
            var chat = store.findChat(chatId);
            if (!chat || chat.type !== 'group') return Promise.reject(new Error('not_group'));
            var add = (Array.isArray(memberIds) ? memberIds : [])
                .map(function (id) {
                    return String(id || '').trim();
                })
                .filter(function (id) {
                    return id && store.findContact(id);
                });
            if (!add.length) return Promise.reject(new Error('no_members'));
            var mids = Array.isArray(chat.memberIds) ? chat.memberIds.slice() : [];
            var seen = {};
            mids.forEach(function (id) {
                seen[id] = true;
            });
            add.forEach(function (id) {
                if (!seen[id]) {
                    seen[id] = true;
                    mids.push(id);
                }
            });
            return store.updateChat(chatId, { memberIds: mids });
        },

        removeGroupMember: function (chatId, memberId) {
            var chat = store.findChat(chatId);
            if (!chat || chat.type !== 'group') return Promise.reject(new Error('not_group'));
            var mid = String(memberId || '').trim();
            if (!mid) return Promise.reject(new Error('invalid_member'));
            var mids = (Array.isArray(chat.memberIds) ? chat.memberIds : []).filter(function (id) {
                return String(id) !== mid;
            });
            if (mids.length < 2) return Promise.reject(new Error('min_members'));
            var settings = store.getChatSettings(chatId);
            var ownerId = String((settings && settings.groupOwnerId) || '__user__').trim() || '__user__';
            if (ownerId === mid) return Promise.reject(new Error('owner_cannot_leave'));
            var patch = {};
            if (settings) {
                var adminIds = (settings.groupAdminIds || []).filter(function (id) {
                    return String(id) !== mid;
                });
                if (adminIds.length !== (settings.groupAdminIds || []).length) patch.groupAdminIds = adminIds;
                if (settings.memberRemarks && settings.memberRemarks[mid]) {
                    var remarks = Object.assign({}, settings.memberRemarks);
                    delete remarks[mid];
                    patch.memberRemarks = remarks;
                }
                if (settings.memberTitles && settings.memberTitles[mid]) {
                    var titles = Object.assign({}, settings.memberTitles);
                    delete titles[mid];
                    patch.memberTitles = titles;
                }
            }
            var chain = store.updateChat(chatId, { memberIds: mids });
            if (Object.keys(patch).length) {
                chain = chain.then(function () {
                    return store.saveChatSettings(chatId, patch);
                });
            }
            return chain;
        },

        getGroupMembers: function (chatId) {
            var chat = store.findChat(chatId);
            if (!chat || chat.type !== 'group') return [];
            return (chat.memberIds || [])
                .map(function (id) {
                    return store.findContact(id);
                })
                .filter(Boolean);
        },

        findGroupChatsForContact: function (contactId, profileId) {
            var cid = String(contactId || '').trim();
            var pid = String(profileId || '').trim();
            if (!cid) return [];
            return metaCache.chats.filter(function (ch) {
                if (!ch || ch.type !== 'group') return false;
                if (pid && String(ch.profileId || '') !== pid) return false;
                var mids = Array.isArray(ch.memberIds) ? ch.memberIds : [];
                return mids.indexOf(cid) >= 0;
            });
        },

        updateChat: function (id, patch) {
            var idx = metaCache.chats.findIndex(function (ch) { return ch.id === id; });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            var next = normalizeChat(Object.assign({}, metaCache.chats[idx], patch || {}));
            metaCache.chats[idx] = next;
            invalidateLookupCache();
            return scheduleSaveMeta().then(function () { return next; });
        },

        deleteChat: function (chatId) {
            var cid = String(chatId || '').trim();
            if (!cid) return Promise.reject(new Error('invalid'));
            var idx = metaCache.chats.findIndex(function (ch) { return ch.id === cid; });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            metaCache.chats.splice(idx, 1);
            if (metaCache.messagesByChat[cid]) delete metaCache.messagesByChat[cid];
            invalidateLookupCache();
            return saveMeta();
        },

        dedupeContactsAndPrivateChats: function () {
            if (!metaCache) return Promise.resolve(false);
            return dedupeContactsAndPrivateChats();
        },

        touchChat: function (chatId, preview, bumpNow) {
            var explicit = preview != null && String(preview).trim();
            if (explicit) {
                var idx = metaCache.chats.findIndex(function (ch) { return ch.id === chatId; });
                if (idx < 0) return Promise.resolve();
                metaCache.chats[idx].lastPreview = String(preview).slice(0, 120);
                if (bumpNow !== false) metaCache.chats[idx].lastAt = Date.now();
                return scheduleSaveMeta();
            }
            return refreshChatPreviewFromVisible(chatId, { bumpNow: bumpNow !== false });
        },

        refreshChatPreviewFromVisible: function (chatId, opts) {
            return refreshChatPreviewFromVisible(chatId, opts);
        },

        getMessages: function (chatId) {
            if (!metaCache) return [];
            var arr = metaCache.messagesByChat && metaCache.messagesByChat[chatId];
            if (!Array.isArray(arr)) return [];
            return arr
                .filter(function (m) {
                    return m && !m.deleted && !m.offlineMeet && !isMomentsMemoryRow(m);
                })
                .map(normalizeMessage)
                .sort(function (a, b) {
                    return (a.createdAt || 0) - (b.createdAt || 0);
                });
        },

        /** 聊天 UI：只 normalize 最近 N 条，避免大线程进入时卡顿 */
        getRecentVisibleMessages: function (chatId, limit) {
            var arr = metaCache.messagesByChat && metaCache.messagesByChat[chatId];
            if (!Array.isArray(arr) || !arr.length) {
                return { visible: [], total: 0, hidden: 0, limit: limit };
            }
            var lim = Math.min(500, Math.max(20, Number(limit) || 100));
            var total = 0;
            var picked = [];
            var i;
            for (i = arr.length - 1; i >= 0; i--) {
                var raw = arr[i];
                if (!raw || raw.deleted || raw.offlineMeet || isMomentsMemoryRow(raw)) continue;
                total++;
                if (picked.length < lim) picked.push(raw);
            }
            picked.reverse();
            var visible = picked.map(normalizeMessage).sort(function (a, b) {
                return (a.createdAt || 0) - (b.createdAt || 0);
            });
            return {
                visible: visible,
                total: total,
                hidden: Math.max(0, total - visible.length),
                limit: lim
            };
        },

        /** API 上下文：含线下镜像消息（线上 UI 不展示）；排除朋友圈留痕占位 */
        getMessagesForApi: function (chatId) {
            var arr = metaCache.messagesByChat && metaCache.messagesByChat[chatId];
            if (!Array.isArray(arr)) return [];
            return arr
                .filter(function (m) {
                    return m && !m.deleted && !isMomentsMemoryRow(m);
                })
                .map(normalizeMessage)
                .sort(function (a, b) {
                    return (a.createdAt || 0) - (b.createdAt || 0);
                });
        },

        /**
         * API 上下文（合并同联系人私聊线程）：避免多面具/历史重复会话导致
         * UI 可见消息与 buildApiMessages 读取线程不一致（续写/重回/主动消息等全链路）。
         */
        getMergedMessagesForApi: function (chatId) {
            var cid = String(chatId || '').trim();
            if (!cid) return [];
            var chat = store.findChat(cid);
            if (!chat || chat.type === 'group' || !chat.contactId) {
                return store.getMessagesForApi(cid);
            }
            var contactId = String(chat.contactId).trim();
            var chl = ensureChatLookupCache();
            var siblings = chl.privateByContact[contactId] || [];
            if (siblings.length <= 1) return store.getMessagesForApi(cid);
            var order = [cid];
            siblings.forEach(function (ch) {
                if (ch && ch.id && order.indexOf(ch.id) < 0) order.push(ch.id);
            });
            var merged = [];
            var seenId = Object.create(null);
            order.forEach(function (id) {
                (store.getMessagesForApi(id) || []).forEach(function (m) {
                    if (!m) return;
                    if (m.id) {
                        if (seenId[m.id]) return;
                        seenId[m.id] = true;
                    }
                    merged.push(m);
                });
            });
            merged.sort(function (a, b) {
                return (a.createdAt || 0) - (b.createdAt || 0);
            });
            return merged;
        },

        findMirrorByAppointmentMsgId: function (chatId, appointmentMsgId) {
            var arr = metaCache.messagesByChat && metaCache.messagesByChat[chatId];
            if (!Array.isArray(arr)) return null;
            var aid = String(appointmentMsgId || '').trim();
            if (!aid) return null;
            for (var i = 0; i < arr.length; i++) {
                var m = arr[i];
                if (
                    m &&
                    !m.deleted &&
                    m.offlineMeet &&
                    String(m.appointmentMsgId || '').trim() === aid
                ) {
                    return normalizeMessage(m);
                }
            }
            return null;
        },

        /** 线下镜像：同步写入内存线程供 API 立即读取；落盘防抖，避免发送时整库深拷贝卡顿 */
        mirrorOfflineMessage: function (chatId, msg) {
            if (!metaCache.messagesByChat[chatId]) metaCache.messagesByChat[chatId] = [];
            var entry = normalizeMessage(
                Object.assign({}, msg || {}, {
                    id: (msg && msg.id) || uid('msg'),
                    createdAt: (msg && msg.createdAt) || Date.now(),
                    offlineMeet: true
                })
            );
            if (!entry.content && entry.role !== 'system') return null;
            metaCache.messagesByChat[chatId].push(entry);
            scheduleSaveMeta().catch(function () {});
            return entry;
        },

        addMessage: function (chatId, msg) {
            var entry = store.addMessageImmediate(chatId, msg);
            if (!entry) return Promise.reject(new Error('empty'));
            return Promise.resolve(entry);
        },

        addMessageImmediate: function (chatId, msg) {
            var rows = store.addMessagesImmediate(chatId, [msg]);
            return rows.length ? rows[0] : null;
        },

        addMessages: function (chatId, msgs) {
            var rows = store.addMessagesImmediate(chatId, msgs);
            return Promise.resolve(rows);
        },

        addMessagesImmediate: function (chatId, msgs) {
            if (!metaCache.messagesByChat[chatId]) metaCache.messagesByChat[chatId] = [];
            var list = Array.isArray(msgs) ? msgs : [];
            var added = [];
            var baseTs = Date.now();
            list.forEach(function (msg, i) {
                var entry = normalizeMessage(Object.assign({}, msg || {}, { id: uid('msg'), createdAt: baseTs + i }));
                var hasBody =
                    entry.content ||
                    entry.role === 'system' ||
                    entry.type === 'image' ||
                    entry.type === 'sticker' ||
                    entry.type === 'location' ||
                    entry.type === 'transfer' ||
                    entry.type === 'takeout' ||
                    entry.type === 'gift' ||
                    entry.type === 'group_red_packet' ||
                    entry.type === 'love_poem' ||
                    entry.type === 'match_record' ||
                    (entry.matchRecord && typeof entry.matchRecord === 'object') ||
                    entry.type === 'sayguess_record' ||
                    (entry.sayguessRecord && typeof entry.sayguessRecord === 'object') ||
                    (entry.type === 'html' && (entry.htmlRaw || entry.content)) ||
                    (entry.type === 'karaoke' && entry.karaokeIdbKey) ||
                    (entry.tajiePostShare && typeof entry.tajiePostShare === 'object') ||
                    (entry.tajieProfileShare && typeof entry.tajieProfileShare === 'object') ||
                    (entry.weijiePostShare && typeof entry.weijiePostShare === 'object') ||
                    (entry.weijieProfileShare && typeof entry.weijieProfileShare === 'object');
                if (!hasBody) return;
                metaCache.messagesByChat[chatId].push(entry);
                added.push(entry);
            });
            if (!added.length) return [];
            var openChatId = getOpenChatIdForUnread();
            var viewingThisChat = openChatId && String(openChatId) === String(chatId);
            var unreadDelta = 0;
            if (!viewingThisChat) {
                added.forEach(function (entry) {
                    if (isUnreadCountableMessage(entry)) unreadDelta++;
                });
            }
            if (unreadDelta > 0) {
                bumpChatUnread(chatId, unreadDelta);
                if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
                    global.miyaChatApp.refreshLists();
                }
            }
            var bumpNow = !added.some(function (m) {
                return m && (m.offlineMeet || m.momentsMemory);
            });
            refreshChatPreviewFromVisible(chatId, { bumpNow: bumpNow }).catch(function () {});
            return added;
        },

        findMessage: function (chatId, msgId) {
            var list = store.getMessages(chatId);
            var key = String(msgId || '').trim();
            return list.find(function (m) { return m.id === key; }) || null;
        },

        collectRecentRecallableMessages: function (chatId, role, opts) {
            var arr = metaCache.messagesByChat && metaCache.messagesByChat[chatId];
            if (!Array.isArray(arr)) return [];
            opts = opts && typeof opts === 'object' ? opts : {};
            var fmt = global.MiyaChatOnlineFormat;
            var limit = Math.max(
                1,
                Number(opts.limit) ||
                    (fmt && fmt.RECALL_RECENT_LIMIT) ||
                    20
            );
            var wantRole = role === 'user' ? 'user' : 'assistant';
            var out = [];
            var i;
            for (i = arr.length - 1; i >= 0 && out.length < limit; i--) {
                var m = arr[i];
                if (!m || m.deleted || m.recalled) continue;
                if (String(m.role) !== wantRole) continue;
                if (wantRole === 'assistant' && opts.senderContactId) {
                    if (String(m.senderContactId || '') !== String(opts.senderContactId)) continue;
                }
                out.push(normalizeMessage(m));
            }
            return out;
        },

        isRecentRecallableMessage: function (chatId, role, msgId, opts) {
            var recent = store.collectRecentRecallableMessages(chatId, role, opts);
            var key = String(msgId || '').trim();
            return recent.some(function (m) {
                return String(m.id) === key;
            });
        },

        findRecallableMessageByTarget: function (chatId, role, opts) {
            opts = opts && typeof opts === 'object' ? opts : {};
            var fmt = global.MiyaChatOnlineFormat;
            var recent = store.collectRecentRecallableMessages(chatId, role, opts);
            var i;
            for (i = 0; i < recent.length; i++) {
                if (
                    fmt &&
                    typeof fmt.messageMatchesRecallTarget === 'function' &&
                    fmt.messageMatchesRecallTarget(recent[i], opts.targetText)
                ) {
                    return recent[i];
                }
            }
            return null;
        },

        recallMessage: function (chatId, msgId, opts) {
            opts = opts && typeof opts === 'object' ? opts : {};
            var arr = metaCache.messagesByChat && metaCache.messagesByChat[chatId];
            if (!Array.isArray(arr)) return Promise.reject(new Error('not_found'));
            var idx = arr.findIndex(function (m) {
                return String(m && m.id) === String(msgId);
            });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            var msg = arr[idx];
            if (!msg || msg.deleted || msg.recalled) return Promise.reject(new Error('already_recalled'));
            var by = opts.by === 'user' ? 'user' : 'assistant';
            if (by === 'user' && !store.isRecentRecallableMessage(chatId, 'user', msgId)) {
                return Promise.reject(new Error('not_recent'));
            }
            var fmt = global.MiyaChatOnlineFormat;
            var preview =
                fmt && typeof fmt.formatMessageBodyOnly === 'function'
                    ? fmt.formatMessageBodyOnly(msg)
                    : String(msg.content || '').trim();
            var by = opts.by === 'user' ? 'user' : 'assistant';
            return store.updateMessage(chatId, msgId, {
                recalled: true,
                recallMeta: {
                    by: by,
                    byName: String(opts.byName || '').trim(),
                    preview: preview,
                    at: Date.now()
                }
            });
        },

        recallMessageByTarget: function (chatId, opts) {
            opts = opts && typeof opts === 'object' ? opts : {};
            var role = opts.role === 'user' ? 'user' : 'assistant';
            var target = store.findRecallableMessageByTarget(chatId, role, opts);
            if (!target) return Promise.resolve(null);
            return store.recallMessage(chatId, target.id, {
                by: role,
                byName: opts.byName || ''
            });
        },

        updateMessage: function (chatId, msgId, patch) {
            if (!metaCache.messagesByChat[chatId]) return Promise.reject(new Error('not_found'));
            var idx = metaCache.messagesByChat[chatId].findIndex(function (m) {
                return String(m.id) === String(msgId);
            });
            if (idx < 0) return Promise.reject(new Error('not_found'));
            var prevRow = metaCache.messagesByChat[chatId][idx];
            var merged = Object.assign({}, prevRow, patch || {});
            if (patch && patch.content != null && !String(patch.imageDataKey || '').trim()) {
                var fmtInfer = global.MiyaChatOnlineFormat;
                if (fmtInfer && typeof fmtInfer.inferFieldsFromContent === 'function') {
                    var inferred = fmtInfer.inferFieldsFromContent(prevRow, patch.content);
                    if (inferred) {
                        var keepGrpRp = patch && patch.groupRedPacket;
                        Object.assign(merged, inferred);
                        if (keepGrpRp) merged.groupRedPacket = keepGrpRp;
                    }
                }
            }
            var next = normalizeMessage(merged);
            metaCache.messagesByChat[chatId][idx] = next;
            var touchOffline = !!(prevRow && prevRow.offlineMeet) || !!next.offlineMeet;
            var touchMoments = !!(prevRow && prevRow.momentsMemory) || !!next.momentsMemory;
            return refreshChatPreviewFromVisible(chatId, { bumpNow: !touchOffline && !touchMoments }).then(function () {
                return next;
            });
        },

        deleteMessage: function (chatId, msgId) {
            if (!metaCache.messagesByChat[chatId]) return Promise.resolve();
            var key = String(msgId || '').trim();
            metaCache.messagesByChat[chatId] = metaCache.messagesByChat[chatId].filter(function (m) {
                return String(m.id) !== key;
            });
            return refreshChatPreviewFromVisible(chatId, { bumpNow: false }).then(function () {
                return true;
            });
        },

        findMessageChatId: function (msgId) {
            var mid = String(msgId || '').trim();
            if (!mid || !metaCache || !metaCache.messagesByChat) return '';
            var keys = Object.keys(metaCache.messagesByChat);
            for (var i = 0; i < keys.length; i++) {
                var cid = keys[i];
                var list = metaCache.messagesByChat[cid];
                if (!Array.isArray(list)) continue;
                for (var j = 0; j < list.length; j++) {
                    if (list[j] && String(list[j].id) === mid) return cid;
                }
            }
            return '';
        },

        deleteMessages: function (chatId, msgIds) {
            if (!metaCache.messagesByChat[chatId]) return Promise.resolve(0);
            var drop = {};
            (Array.isArray(msgIds) ? msgIds : []).forEach(function (id) {
                var key = String(id || '').trim();
                if (key) drop[key] = true;
            });
            if (!Object.keys(drop).length) return Promise.resolve(0);
            var before = metaCache.messagesByChat[chatId].length;
            metaCache.messagesByChat[chatId] = metaCache.messagesByChat[chatId].filter(function (m) {
                return m && !drop[String(m.id)];
            });
            var removed = before - metaCache.messagesByChat[chatId].length;
            if (!removed) return Promise.resolve(0);
            var removedIdList = (Array.isArray(msgIds) ? msgIds : [])
                .map(function (id) {
                    return String(id || '').trim();
                })
                .filter(Boolean);
            var chain = refreshChatPreviewFromVisible(chatId, { bumpNow: false });
            chain = chain.then(function () {
                var chat = store.findChat(chatId);
                if (!chat || !removedIdList.length) return;
                var patch = {};
                if (Array.isArray(chat.heartVoiceLog)) {
                    var nextLog = chat.heartVoiceLog.filter(function (entry) {
                        return removedIdList.indexOf(String(entry && entry.msgId)) < 0;
                    });
                    if (nextLog.length !== chat.heartVoiceLog.length) {
                        patch.heartVoiceLog = nextLog;
                        patch.lastHeartVoiceParse = null;
                    }
                }
                if (removedIdList.indexOf(String(chat.activeHeartVoiceMsgId)) >= 0) {
                    patch.activeHeartVoiceMsgId = '';
                    patch.lastHeartVoiceParse = null;
                }
                if (removedIdList.indexOf(String(chat.activeThinkingMsgId)) >= 0) {
                    patch.activeThinking = '';
                    patch.activeThinkingMsgId = '';
                }
                if (Object.keys(patch).length) return store.updateChat(chatId, patch);
            });
            return chain.then(function () {
                return removed;
            });
        },

        purgeMessagesRange: function (chatId, start, end) {
            var cid = String(chatId || '').trim();
            if (!cid) return Promise.reject(new Error('invalid'));
            var visible = store.getMessages(cid);
            if (!visible.length) return Promise.resolve({ removed: 0 });
            var lo = Math.max(1, parseInt(start, 10) || 1);
            var hi = Math.max(lo, parseInt(end, 10) || visible.length);
            lo = Math.min(lo, visible.length);
            hi = Math.min(hi, visible.length);
            var slice = visible.slice(lo - 1, hi);
            if (!slice.length) return Promise.resolve({ removed: 0 });
            var removeIds = {};
            slice.forEach(function (m) {
                if (m && m.id) removeIds[String(m.id)] = true;
            });
            var mediaKeys = [];
            slice.forEach(function (m) {
                if (!m) return;
                ['imageDataKey', 'karaokeIdbKey', 'voiceTtsIdbKey', 'voiceAudioIdbKey'].forEach(function (field) {
                    var k = String(m[field] || '').trim();
                    if (k && mediaKeys.indexOf(k) < 0) mediaKeys.push(k);
                });
            });
            if (!metaCache.messagesByChat[cid]) metaCache.messagesByChat[cid] = [];
            metaCache.messagesByChat[cid] = metaCache.messagesByChat[cid].filter(function (m) {
                return m && !removeIds[String(m.id)];
            });
            var settings = store.getChatSettings(cid);
            var sumMod = global.MiyaChatSummary;
            var nextSummary =
                sumMod && typeof sumMod.adjustSummaryIndicesAfterPurge === 'function'
                    ? sumMod.adjustSummaryIndicesAfterPurge(settings.summaryList, lo, hi)
                    : settings.summaryList;
            var nextMega =
                sumMod && typeof sumMod.adjustMegaSummaryIndicesAfterPurge === 'function'
                    ? sumMod.adjustMegaSummaryIndicesAfterPurge(settings.megaSummaryList, lo, hi)
                    : settings.megaSummaryList;
            var memMod = global.MiyaChatMemoryExtract;
            var nextCharMem =
                memMod && typeof memMod.adjustCharMemoryIndicesAfterPurge === 'function'
                    ? memMod.adjustCharMemoryIndicesAfterPurge(settings.charMemoryList, lo, hi)
                    : settings.charMemoryList;
            var removedIds = slice.map(function (m) {
                return m.id;
            });
            var chain = refreshChatPreviewFromVisible(cid, { bumpNow: false });
            if (
                JSON.stringify(nextSummary) !== JSON.stringify(settings.summaryList) ||
                JSON.stringify(nextMega) !== JSON.stringify(settings.megaSummaryList) ||
                JSON.stringify(nextCharMem) !== JSON.stringify(settings.charMemoryList)
            ) {
                chain = chain.then(function () {
                    return store.saveChatSettings(cid, {
                        summaryList: nextSummary,
                        megaSummaryList: nextMega,
                        charMemoryList: nextCharMem
                    });
                });
            }
            chain = chain.then(function () {
                var chat = store.findChat(cid);
                if (!chat) return;
                var patch = {};
                if (removedIds.length && Array.isArray(chat.heartVoiceLog)) {
                    patch.heartVoiceLog = chat.heartVoiceLog.filter(function (entry) {
                        return removedIds.indexOf(String(entry && entry.msgId)) < 0;
                    });
                }
                if (removedIds.indexOf(String(chat.activeHeartVoiceMsgId)) >= 0) {
                    patch.activeHeartVoiceMsgId = '';
                }
                if (removedIds.indexOf(String(chat.activeThinkingMsgId)) >= 0) {
                    patch.activeThinking = '';
                    patch.activeThinkingMsgId = '';
                }
                if (Object.keys(patch).length) return store.updateChat(cid, patch);
            });
            mediaKeys.forEach(function (k) {
                revokeUrl(k);
                idbDelete(k);
            });
            return chain
                .then(function () {
                    return saveMeta();
                })
                .then(function () {
                    return { removed: slice.length, start: lo, end: hi };
                });
        },

        getChatSettings: function (chatId) {
            var chat = store.findChat(chatId);
            if (!chat) return defaultChatSettings();
            var contact = store.findContact(chat.contactId);
            var rawWa = chat.chatSettings && chat.chatSettings.weatherAwareness;
            var base = normalizeChatSettings(chat.chatSettings);
            if (contact) {
                if (contact.relationship) base.relationship = contact.relationship;
                if (contact.chatSettings && typeof contact.chatSettings === 'object') {
                    rawWa =
                        (chat.chatSettings && chat.chatSettings.weatherAwareness) ||
                        contact.chatSettings.weatherAwareness;
                    base = normalizeChatSettings(Object.assign({}, contact.chatSettings, chat.chatSettings || {}));
                    // 自动发动态按角色生效：优先读联系人级配置，避免多面具会话互相覆盖
                    var roleMoments = normalizeChatSettings(contact.chatSettings).momentsAuto;
                    var chatMoments = normalizeChatSettings(chat.chatSettings).momentsAuto;
                    if (roleMoments && roleMoments.mode && roleMoments.mode !== 'off') {
                        base.momentsAuto = roleMoments;
                    } else if (chatMoments && chatMoments.mode && chatMoments.mode !== 'off') {
                        base.momentsAuto = chatMoments;
                    } else if (roleMoments) {
                        base.momentsAuto = roleMoments;
                    }
                }
            }
            if (
                chat.type !== 'group' &&
                global.miyaChatGlobalSettings &&
                typeof global.miyaChatGlobalSettings.applyToChatSettings === 'function'
            ) {
                base = normalizeChatSettings(
                    global.miyaChatGlobalSettings.applyToChatSettings(base, contact && contact.id)
                );
            }
            // 单聊：主动/离线开关与间隔由全局或联系人单独配置决定；会话里只保留 lifeLike 与调度运行时字段
            var rawChatBg = chat.chatSettings && chat.chatSettings.backgroundMessage;
            if (rawChatBg && typeof rawChatBg === 'object' && chat.type !== 'group') {
                var chatLevelBgKeys = [
                    'lifeLikeEnabled',
                    'lifeLikeNextPushAt',
                    'lifeLikeNextPushAnchorTs',
                    'lifeLikeEnabledAt',
                    'lastAutoPushAt',
                    'lastProactiveAttemptAt',
                    'lastPushFailAt',
                    'proactiveBaselineAt',
                    'lastOfflineAt',
                    'offlineRollAnchor',
                    'offlineRollGapMs'
                ];
                var chatBgPatch = {};
                chatLevelBgKeys.forEach(function (k) {
                    if (rawChatBg[k] != null) chatBgPatch[k] = rawChatBg[k];
                });
                if (Object.keys(chatBgPatch).length) {
                    base.backgroundMessage = Object.assign({}, base.backgroundMessage || {}, chatBgPatch);
                    base = normalizeChatSettings(base);
                }
            }
            if (
                rawWa &&
                Number(rawWa.settingsUiVersion) !== 2 &&
                base.weatherAwareness &&
                Number(base.weatherAwareness.settingsUiVersion) === 2
            ) {
                store.saveChatSettings(chatId, { weatherAwareness: base.weatherAwareness }).catch(function () {});
            }
            if (
                base.heartVoicePreset &&
                !base.heartVoicePresetSnapshot &&
                global.MiyaChatHeartVoiceTemplates &&
                typeof global.MiyaChatHeartVoiceTemplates.findPreset === 'function' &&
                typeof global.MiyaChatHeartVoiceTemplates.buildSnapshotFromPreset === 'function'
            ) {
                var hvFill = global.MiyaChatHeartVoiceTemplates.findPreset(base.heartVoicePreset);
                if (hvFill) {
                    base.heartVoicePresetSnapshot = global.MiyaChatHeartVoiceTemplates.buildSnapshotFromPreset(hvFill);
                }
            }
            return base;
        },

        saveChatSettings: function (chatId, patch) {
            var chat = store.findChat(chatId);
            if (!chat) return Promise.reject(new Error('not_found'));
            var chatIdx = metaCache.chats.findIndex(function (ch) { return ch && ch.id === chatId; });
            if (chatIdx < 0) return Promise.reject(new Error('not_found'));
            var merged = Object.assign({}, chat.chatSettings, patch || {});
            if (patch && patch.weatherAwareness) {
                merged.weatherAwareness = Object.assign(
                    {},
                    (chat.chatSettings && chat.chatSettings.weatherAwareness) || {},
                    patch.weatherAwareness
                );
            }
            if (patch && patch.backgroundMessage) {
                var prevBm = (chat.chatSettings && chat.chatSettings.backgroundMessage) || {};
                merged.backgroundMessage = Object.assign({}, prevBm, patch.backgroundMessage);
                if (patch.backgroundMessage.activeEnabled === true && !prevBm.activeEnabled) {
                    merged.backgroundMessage.activeEnabledAt = Date.now();
                    merged.backgroundMessage.proactiveBaselineAt = Date.now();
                    merged.backgroundMessage.lastPushFailAt = 0;
                } else if (patch.backgroundMessage.activeEnabled === false && prevBm.activeEnabled) {
                    merged.backgroundMessage.activeEnabledAt = 0;
                }
            }
            if (patch && patch.momentsAuto) {
                var prevMaSave = (chat.chatSettings && chat.chatSettings.momentsAuto) || {};
                merged.momentsAuto = Object.assign({}, prevMaSave, patch.momentsAuto);
                if (merged.momentsAuto.mode && merged.momentsAuto.mode !== 'off' && !merged.momentsAuto.enabledAt) {
                    merged.momentsAuto.enabledAt = Date.now();
                }
            }
            var next = normalizeChatSettings(merged);
            /* 内存一次写完 chat + contact（及同联系人 sibling），再合并一次落盘 */
            metaCache.chats[chatIdx] = normalizeChat(
                Object.assign({}, metaCache.chats[chatIdx], { chatSettings: next })
            );
            var contact = store.findContact(metaCache.chats[chatIdx].contactId);
            if (contact) {
                var cIdx = metaCache.contacts.findIndex(function (c) { return c && c.id === contact.id; });
                if (cIdx >= 0) {
                    var cp = Object.assign({}, metaCache.contacts[cIdx], { updatedAt: Date.now() });
                    if (patch && patch.relationship != null) cp.relationship = patch.relationship;
                    if (patch && patch.remarkName != null) cp.remarkName = patch.remarkName;
                    cp.chatSettings = Object.assign({}, contact.chatSettings || {}, next);
                    if (patch && patch.momentsAuto) cp.chatSettings.momentsAuto = next.momentsAuto;
                    cp.chatSettings = normalizeChatSettings(cp.chatSettings);
                    metaCache.contacts[cIdx] = normalizeContact(cp);
                }
                if (patch && patch.momentsAuto) {
                    (metaCache.chats || []).forEach(function (c, i) {
                        if (!c || c.type === 'group' || String(c.contactId) !== String(contact.id)) return;
                        if (String(c.id) === String(chatId)) return;
                        var sibMerged = Object.assign({}, c.chatSettings || {}, { momentsAuto: next.momentsAuto });
                        metaCache.chats[i] = normalizeChat(
                            Object.assign({}, c, { chatSettings: normalizeChatSettings(sibMerged) })
                        );
                    });
                }
            }
            invalidateLookupCache();
            return scheduleSaveMeta().then(function () { return next; });
        },

        storeChatMedia: function (file, kind) {
            if (!file) return Promise.reject(new Error('no_file'));
            if (file instanceof Blob && typeof file.arrayBuffer === 'function' && !(file instanceof File)) {
                return storeMediaBlob(file, kind || 'chat');
            }
            return storeBlob(file, kind || 'chat');
        },

        storeMediaBlob: function (blob, kind) {
            return storeMediaBlob(blob, kind || 'media');
        },

        clearChatMessages: function (chatId) {
            metaCache.messagesByChat[chatId] = [];
            return store
                .updateChat(chatId, {
                    activeThinking: '',
                    activeThinkingMsgId: '',
                    activeHeartVoiceMsgId: ''
                })
                .then(function () {
                return saveMeta();
            });
        },

        deleteContactAndData: function (contactId) {
            return store.removeContact(contactId);
        },

        importChatMessages: function (chatId, messages) {
            var cid = String(chatId || '').trim();
            if (!cid || !Array.isArray(messages)) return Promise.reject(new Error('invalid'));
            var imported = [];
            messages.forEach(function (m) {
                if (!m || typeof m !== 'object') return;
                imported.push(normalizeMessage(m));
            });
            metaCache.messagesByChat[cid] = imported;
            return store
                .updateChat(cid, {
                    activeThinking: '',
                    activeThinkingMsgId: '',
                    activeHeartVoiceMsgId: ''
                })
                .then(function () {
                    return refreshChatPreviewFromVisible(cid, { bumpNow: false });
                })
                .then(function () {
                    return saveMeta();
                })
                .then(function () {
                    return imported.length;
                });
        },

        defaultChatSettings: defaultChatSettings,

        flushMeta: function () {
            return flushSaveMeta({ withBackup: true, forceEmergency: true });
        },

        ensureArchiveVolumeGroups: function (archiveGroups) {
            if (!metaCache) return Promise.resolve();
            var groups = metaCache.contactGroups || [];
            var byId = {};
            groups.forEach(function (g) { byId[g.id] = g; });
            if (!byId['ct-default']) {
                groups.push({ id: 'ct-default', name: '我的好友', sort: 0, createdAt: Date.now() });
            }
            (archiveGroups || []).forEach(function (ag, i) {
                if (!ag || ag.id === 'ct_default') return;
                var chatGid = 'arch-' + String(ag.id || '').trim();
                if (!chatGid || chatGid === 'arch-') return;
                var hit = groups.find(function (x) { return x.id === chatGid; });
                if (hit) {
                    hit.name = String(ag.name || hit.name).trim() || hit.name;
                } else {
                    groups.push({
                        id: chatGid,
                        name: String(ag.name || '未命名卷').trim() || '未命名卷',
                        sort: (i + 1) * 10,
                        createdAt: Date.now()
                    });
                }
            });
            metaCache.contactGroups = groups.sort(function (a, b) {
                return (a.sort || 0) - (b.sort || 0);
            });
            return saveMeta();
        },

        idbPutRecord: function (key, value) {
            return idbPut(key, value);
        },
        idbGetRecord: function (key) {
            return idbGet(key);
        },
        idbDeleteRecord: function (key) {
            return idbDelete(key);
        },
        invalidateBlobUrl: function (blobId) {
            revokeUrl(blobId);
        },
        invalidateCache: function () {
            metaCache = null;
            Object.keys(urlCache).forEach(revokeUrl);
        }
    };

    global.miyaChatStore = store;

    (function bindMetaPersistLifecycle() {
        if (global.__miyaChatMetaPersistBound) return;
        global.__miyaChatMetaPersistBound = true;
        function flushSoon(opts) {
            if (metaHydrateFailedWithPlaceholder) return;
            /* 切后台用轻量异步刷盘；pagehide/杀进程才同步深拷贝，避免切回前台卡数秒 */
            var soft = opts && opts.urgent === false;
            if (soft) {
                if (metaCache) flushSaveMeta({ withBackup: true, forceEmergency: true }).catch(function () {});
                return;
            }
            saveMetaSync();
            if (metaCache) flushSaveMeta({ withBackup: true, forceEmergency: true }).catch(function () {});
        }
        function onShowAgain() {
            if (!metaHydrateFailedWithPlaceholder) return;
            scheduleBackgroundMetaRecover();
        }
        if (global.miyaRegisterPagehideFlush) {
            global.miyaRegisterPagehideFlush(flushSoon);
        } else {
            window.addEventListener('pagehide', function () { flushSoon({ urgent: true }); });
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'hidden') flushSoon({ urgent: false });
            });
        }
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') onShowAgain();
        });
        window.addEventListener('pageshow', onShowAgain);
        window.addEventListener('focus', onShowAgain);
        window.addEventListener('storage', function (ev) {
            if (ev.key !== META_LS || ev.newValue == null) return;
            if (!initSettled) return;
            store.reloadMeta()
                .then(function () {
                    if (global.miyaChatApp && typeof global.miyaChatApp.refreshLists === 'function') {
                        global.miyaChatApp.refreshLists({ force: true });
                    }
                    if (
                        global.miyaChatRoom &&
                        typeof global.miyaChatRoom.getOpenChatId === 'function' &&
                        global.miyaChatRoom.getOpenChatId() &&
                        typeof global.miyaChatRoom.refresh === 'function'
                    ) {
                        global.miyaChatRoom.refresh({ toBottom: true });
                    }
                })
                .catch(function () {});
        });
    })();

    global.miyaExportChatMediaDb = function () {
        return global.miyaExportNamedDbBlobs(DB_NAME, STORE);
    };

    global.miyaImportChatMediaDb = function (src) {
        Object.keys(urlCache).forEach(revokeUrl);
        return global.miyaImportNamedDbBlobs(DB_NAME, STORE, src);
    };
})(window);
