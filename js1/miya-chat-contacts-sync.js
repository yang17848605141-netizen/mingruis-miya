/**
 * 档案联系人 (miya-contacts-store) ↔ 聊天联系人 (miya-chat-store) 双向同步
 */
(function (global) {
  'use strict';

  var ARCHIVE_DEFAULT = 'ct_default';
  var CHAT_DEFAULT = 'ct-default';
  var syncing = false;
  var syncTail = Promise.resolve();
  var lastSyncFingerprint = '';
  var bootstrapReady = null;

  function archiveFingerprint(archive) {
    var chars = Array.isArray(archive && archive.characters) ? archive.characters : [];
    var groups = Array.isArray(archive && archive.groups) ? archive.groups : [];
    var parts = [String(groups.length)];
    chars.forEach(function (ch) {
      if (!ch || !ch.id) return;
      parts.push(
        ch.id + ':' + String(ch.updatedAt || 0) + ':' +
        String(ch.name || '') + ':' + String(ch.groupId || '') + ':' +
        String(ch.avatar || '').slice(0, 64)
      );
    });
    return parts.join('|');
  }

  function contactNeedsSync(existing, character, chatGroupId) {
    if (!existing) return true;
    return existing.chronicleId !== character.id ||
      existing.characterId !== (character.characterId || character.id) ||
      existing.groupId !== chatGroupId ||
      existing.name !== character.name ||
      String(existing.avatar || '').trim() !== String(character.avatar || '').trim();
  }

  function archiveGroupToChat(archiveGroupId) {
    var gid = String(archiveGroupId || '').trim();
    if (!gid || gid === ARCHIVE_DEFAULT) return CHAT_DEFAULT;
    return 'arch-' + gid;
  }

  function contactsStore() { return global.miyaContactsStore; }
  function chatStore() { return global.miyaChatStore; }

  function findArchiveContact(chatStoreApi, row) {
    if (!chatStoreApi || !row) return null;
    if (typeof chatStoreApi.findContactByArchiveCharacter === 'function') {
      return chatStoreApi.findContactByArchiveCharacter(row);
    }
    var key = String(row.id || '').trim();
    var cid = String(row.characterId || row.id || '').trim();
    return (chatStoreApi.getContacts('all') || []).find(function (c) {
      if (c.chronicleId && c.chronicleId === key) return true;
      if (cid && c.characterId === cid) return true;
      return false;
    }) || null;
  }

  function ensureChatGroups(meta, archiveGroups) {
    var groups = meta.contactGroups || [];
    var byId = {};
    groups.forEach(function (g) { byId[g.id] = g; });
    if (!byId[CHAT_DEFAULT]) {
      groups.push({ id: CHAT_DEFAULT, name: '我的好友', sort: 0, createdAt: Date.now() });
      byId[CHAT_DEFAULT] = true;
    }
    (archiveGroups || []).forEach(function (ag, i) {
      if (!ag || ag.id === ARCHIVE_DEFAULT) return;
      var chatGid = archiveGroupToChat(ag.id);
      if (byId[chatGid]) {
        var g = groups.find(function (x) { return x.id === chatGid; });
        if (g) g.name = String(ag.name || g.name).trim() || g.name;
        return;
      }
      groups.push({
        id: chatGid,
        name: String(ag.name || '未命名卷').trim() || '未命名卷',
        sort: (i + 1) * 10,
        createdAt: Date.now()
      });
      byId[chatGid] = true;
    });
    meta.contactGroups = groups.sort(function (a, b) {
      return (a.sort || 0) - (b.sort || 0);
    });
  }

  function upsertOne(st, cs, character, profileId) {
    if (!character || !character.name) return Promise.resolve(null);
    var existing = findArchiveContact(st, character);
    var chatGroupId = archiveGroupToChat(character.groupId);
    if (existing && !contactNeedsSync(existing, character, chatGroupId)) {
      return ensureChatForContact(st, existing, profileId);
    }
    var patch = {
      chronicleId: character.id,
      characterId: character.characterId || character.id,
      name: character.name,
      avatar: String(character.avatar || '').trim(),
      groupId: chatGroupId
    };

    if (existing) {
      return st.updateContact(existing.id, patch).then(function (contact) {
        return ensureChatForContact(st, contact, profileId);
      });
    }
    return st.addContactFromChronicle(character, chatGroupId, profileId).then(function (contact) {
      return ensureChatForContact(st, contact, profileId);
    });
  }

  var SYNC_BATCH = 10;

  function runBatchedUpserts(st, cs, characters, profileId) {
    var queue = characters.slice();
    function nextBatch() {
      if (!queue.length) return Promise.resolve();
      var batch = queue.splice(0, SYNC_BATCH);
      // 串行 upsert，避免并发创建同一角色联系人/会话
      var chain = Promise.resolve();
      batch.forEach(function (ch) {
        chain = chain.then(function () {
          return upsertOne(st, cs, ch, profileId);
        });
      });
      return chain.then(nextBatch);
    }
    return nextBatch();
  }

  function ensureChatForContact(st, contact, profileId) {
    if (!contact || !contact.id) return Promise.resolve(contact);
    var pid = profileId || (st.getActiveProfile && st.getActiveProfile() && st.getActiveProfile().id) || '';
    var chat = st.findChatByContact(contact.id, pid);
    if (chat) return Promise.resolve(contact);
    return st.createChat({ contactId: contact.id, profileId: pid }).then(function () {
      return contact;
    }).catch(function () {
      return contact;
    });
  }

  function pruneOrphans(st, archiveIdSet) {
    var removed = [];
    var keep = [];
    (st.getContacts('all') || []).forEach(function (c) {
      var key = String(c.chronicleId || '').trim();
      if (!key) {
        keep.push(c);
        return;
      }
      if (archiveIdSet[key]) keep.push(c);
      else removed.push(c.id);
    });
    var chain = Promise.resolve();
    removed.forEach(function (id) {
      chain = chain.then(function () {
        return st.removeContact(id);
      });
    });
    return chain.then(function () { return { removed: removed.length, keep: keep.length }; });
  }

  function runDedupe(st) {
    if (st && typeof st.dedupeContactsAndPrivateChats === 'function') {
      return st.dedupeContactsAndPrivateChats().catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  function enqueueSync(fn) {
    var result;
    syncTail = syncTail.then(function () {
      result = fn();
      return Promise.resolve(result).then(
        function (v) { return v; },
        function (err) {
          result = { error: err };
          return result;
        }
      );
    });
    return syncTail.then(function () { return result; });
  }

  function runSyncAll(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    var cs = contactsStore();
    var st = chatStore();
    if (!cs || !st) return Promise.resolve({ error: 'store_missing' });

    syncing = true;
    var chain = Promise.resolve();
    if (typeof cs.whenReady === 'function') chain = chain.then(function () { return cs.whenReady(); });
    if (typeof st.init === 'function') chain = chain.then(function () { return st.init(); });

    return chain
      .then(function () {
        var archive = cs.getState ? cs.getState() : { groups: [], characters: [] };
        var fingerprint = archiveFingerprint(archive);
        if (!opts.force && opts.prune === false && fingerprint === lastSyncFingerprint) {
          /* 指纹未变：跳过 upsert / dedupe / flush，打开聊天 App 才不会每次扫全库 */
          return { skipped: true, reason: 'unchanged' };
        }
        var characters = Array.isArray(archive.characters) ? archive.characters : [];
        var groups = Array.isArray(archive.groups) ? archive.groups : [];
        var profile = st.getActiveProfile ? st.getActiveProfile() : null;
        var profileId = profile && profile.id ? profile.id : '';
        var meta = st.getMeta ? st.getMeta() : null;
        if (meta) ensureChatGroups(meta, groups);
        var archiveIds = {};
        characters.forEach(function (ch) {
          if (ch && ch.id) archiveIds[ch.id] = true;
        });
        return runBatchedUpserts(st, cs, characters, profileId)
          .then(function () {
            if (opts.prune !== false) return pruneOrphans(st, archiveIds);
          })
          .then(function () {
            return runDedupe(st);
          })
          .then(function () {
            return st.flushMeta ? st.flushMeta() : Promise.resolve();
          })
          .then(function () {
            lastSyncFingerprint = fingerprint;
            return { synced: characters.length };
          });
      })
      .finally(function () {
        syncing = false;
      });
  }

  /**
   * 全量同步：档案角色 → 聊天联系人 + 会话占位
   */
  function syncAll(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    return enqueueSync(function () {
      return runSyncAll(opts);
    });
  }

  function syncOne(characterId) {
    lastSyncFingerprint = '';
    return enqueueSync(function () {
      var cs = contactsStore();
      var st = chatStore();
      if (!cs || !st) return Promise.resolve();
      return (cs.whenReady ? cs.whenReady() : Promise.resolve())
        .then(function () { return st.init ? st.init() : null; })
        .then(function () {
          var row = cs.findCharacter(characterId);
          if (!row) return runSyncAll({ prune: true });
          var profile = st.getActiveProfile ? st.getActiveProfile() : null;
          return upsertOne(st, cs, row, profile && profile.id).then(function (contact) {
            return runDedupe(st).then(function () { return contact; });
          });
        });
    });
  }

  /** 聊天相关 App 共用：KV → chatStore.init → syncAll（指纹未变则跳过） */
  function ensureBootstrap(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (bootstrapReady && !opts.force) return bootstrapReady;
    var chain = Promise.resolve();
    if (global.miyaBootstrapKvStores) {
      chain = chain.then(function () { return global.miyaBootstrapKvStores(); });
    }
    var st = chatStore();
    if (st && typeof st.init === 'function') {
      chain = chain.then(function () { return st.init(); });
    }
    chain = chain.then(function () {
      return syncAll({ prune: false, force: !!opts.force });
    });
    bootstrapReady = chain.catch(function (err) {
      bootstrapReady = null;
      throw err;
    });
    return bootstrapReady;
  }

  function invalidateBootstrap() {
    bootstrapReady = null;
    lastSyncFingerprint = '';
  }

  global.miyaChatContactsSync = {
    syncAll: syncAll,
    syncOne: syncOne,
    ensureBootstrap: ensureBootstrap,
    invalidateBootstrap: invalidateBootstrap,
    archiveGroupToChat: archiveGroupToChat,
    invalidateSyncFingerprint: function () { lastSyncFingerprint = ''; }
  };
})(window);
