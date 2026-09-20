/**
 * miya-deep-cloud-store.js — 深入 · 角色手机 网盘数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  var BAG_TONES = ['ash', 'mist', 'ink', 'sand', 'slate'];
  var FILE_KINDS = ['note', 'image', 'video', 'audio', 'doc', 'zip', 'link', 'secret'];

  function cloudKey(contactId) {
    return 'cloud:' + String(contactId || '').trim();
  }

  function invalidateDb(promise) {
    if (dbPromise === promise) dbPromise = null;
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
      var settled = false;
      req.onerror = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(req.error || new Error('deep_cloud_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_cloud_idb_blocked'));
      };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(PHONES_STORE)) {
          db.createObjectStore(PHONES_STORE);
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () {
          try { db.close(); } catch (e) {}
          invalidateDb(dbPromise);
        };
        db.onclose = function () { invalidateDb(dbPromise); };
        if (settled) {
          try { db.close(); } catch (e2) {}
          return;
        }
        resolve(db);
      };
    });
    return dbPromise;
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHONES_STORE, 'readonly');
        var req = tx.objectStore(PHONES_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(PHONES_STORE, 'readwrite');
        tx.objectStore(PHONES_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function defaultCloudData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      cloud: null
    };
  }

  function pickTone(raw) {
    var t = String(raw || '').trim().toLowerCase();
    return BAG_TONES.indexOf(t) >= 0 ? t : 'ash';
  }

  function pickKind(raw) {
    var k = String(raw || '').trim().toLowerCase();
    if (k === 'photo' || k === 'pic' || k === 'img') k = 'image';
    if (k === 'voice' || k === '录音') k = 'audio';
    if (k === 'folder' || k === 'txt' || k === 'text') k = 'note';
    if (k === 'pdf' || k === 'word') k = 'doc';
    if (FILE_KINDS.indexOf(k) < 0) k = 'note';
    return k;
  }

  function normalizeFile(raw, index, prefix) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: (prefix || 'f') + '-' + (index + 1),
          name: '未命名',
          kind: 'note',
          size: '',
          updated: '',
          preview: '',
          body: raw.trim(),
          pinned: false,
          opened: false
        };
      }
      return null;
    }
    var name = String(raw.name || raw.title || raw.filename || '').trim();
    var body = String(raw.body || raw.content || raw.text || raw.detail || '').trim();
    var preview = String(raw.preview || raw.summary || raw.excerpt || '').trim();
    if (!name && !body && !preview) return null;
    return {
      id: String(raw.id || (prefix || 'f') + '-' + (index + 1)),
      name: name || ('文件 ' + (index + 1)),
      kind: pickKind(raw.kind || raw.type || raw.fileType),
      size: String(raw.size || raw.bytes || '').trim(),
      updated: String(raw.updated || raw.time || raw.when || raw.date || '').trim(),
      preview: preview,
      body: body,
      pinned: !!(raw.pinned || raw.pin || raw.starred),
      opened: !!raw.opened
    };
  }

  function normalizeBag(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.title || raw.label || '').trim();
    var desc = String(raw.desc || raw.description || raw.note || '').trim();
    var filesRaw = Array.isArray(raw.files) ? raw.files
      : (Array.isArray(raw.items) ? raw.items : (Array.isArray(raw.contents) ? raw.contents : []));
    var files = filesRaw.map(function (f, i) {
      return normalizeFile(f, i, 'bag' + (index + 1) + '-f');
    }).filter(Boolean);
    if (!name && !desc && !files.length) return null;
    return {
      id: String(raw.id || 'bag-' + (index + 1)),
      name: name || ('文件袋 ' + (index + 1)),
      tone: pickTone(raw.tone || raw.color || raw.skin),
      count: Math.max(files.length, Number(raw.count) || 0),
      locked: !!(raw.locked || raw.lock || raw.private),
      tag: String(raw.tag || raw.badge || '').trim(),
      desc: desc,
      files: files,
      selected: !!raw.selected
    };
  }

  function normalizeSecret(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'sec-' + (index + 1),
          title: '上锁文档',
          seal: '仅自己',
          content: raw.trim(),
          updated: '',
          unlocked: false
        };
      }
      return null;
    }
    var content = String(raw.content || raw.body || raw.text || raw.note || '').trim();
    var title = String(raw.title || raw.name || raw.label || '').trim();
    if (!content && !title) return null;
    return {
      id: String(raw.id || 'sec-' + (index + 1)),
      title: title || ('上锁文档 ' + (index + 1)),
      seal: String(raw.seal || raw.grade || raw.lock || '仅自己').trim() || '仅自己',
      content: content,
      updated: String(raw.updated || raw.time || '').trim(),
      unlocked: !!raw.unlocked
    };
  }

  function normalizeShared(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    var content = String(raw.content || raw.body || raw.text || raw.note || '').trim();
    if (!title && !content) return null;
    return {
      id: String(raw.id || 'sh-' + (index + 1)),
      title: title || ('共享项 ' + (index + 1)),
      withWhom: String(raw.withWhom || raw.partner || raw.alias || raw.with || '').trim(),
      note: String(raw.note || raw.preview || '').trim(),
      content: content,
      opened: !!raw.opened
    };
  }

  function normalizeVoice(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'vc-' + (index + 1),
          title: '语音备忘',
          duration: '',
          transcript: raw.trim(),
          played: false
        };
      }
      return null;
    }
    var transcript = String(raw.transcript || raw.content || raw.text || raw.body || '').trim();
    var title = String(raw.title || raw.name || '').trim();
    if (!transcript && !title) return null;
    return {
      id: String(raw.id || 'vc-' + (index + 1)),
      title: title || ('语音 ' + (index + 1)),
      duration: String(raw.duration || raw.length || raw.time || '').trim(),
      transcript: transcript,
      played: !!raw.played
    };
  }

  function normalizeDraft(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'dr-' + (index + 1),
          title: '未发送草稿',
          content: raw.trim(),
          updated: '',
          opened: false
        };
      }
      return null;
    }
    var content = String(raw.content || raw.body || raw.text || '').trim();
    var title = String(raw.title || raw.name || '').trim();
    if (!content && !title) return null;
    return {
      id: String(raw.id || 'dr-' + (index + 1)),
      title: title || ('草稿 ' + (index + 1)),
      content: content,
      updated: String(raw.updated || raw.time || '').trim(),
      opened: !!raw.opened
    };
  }

  function normalizeRecycle(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return {
          id: 'rc-' + (index + 1),
          name: '已删除',
          reason: raw.trim(),
          deletedAt: ''
        };
      }
      return null;
    }
    var name = String(raw.name || raw.title || '').trim();
    var reason = String(raw.reason || raw.note || raw.content || raw.text || '').trim();
    if (!name && !reason) return null;
    return {
      id: String(raw.id || 'rc-' + (index + 1)),
      name: name || ('已删 ' + (index + 1)),
      reason: reason,
      deletedAt: String(raw.deletedAt || raw.time || raw.updated || '').trim()
    };
  }

  function mapArr(raw, key, alt, fn) {
    if (Array.isArray(raw[key])) return raw[key].map(fn).filter(Boolean);
    if (alt && Array.isArray(raw[alt])) return raw[alt].map(fn).filter(Boolean);
    return [];
  }

  function normalizeCloudPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var bags = mapArr(raw, 'bags', 'folders', normalizeBag);
    if (!bags.length && Array.isArray(raw.pouches)) {
      bags = raw.pouches.map(normalizeBag).filter(Boolean);
    }
    var recent = mapArr(raw, 'recent', 'uploads', function (f, i) {
      return normalizeFile(f, i, 'rc');
    });
    var usedPct = Number(raw.usedPercent != null ? raw.usedPercent : raw.percent);
    if (!isFinite(usedPct)) usedPct = 0;
    usedPct = Math.max(0, Math.min(100, Math.round(usedPct)));

    return {
      driveName: String(raw.driveName || raw.name || raw.title || '').trim(),
      usedLabel: String(raw.usedLabel || raw.used || '').trim(),
      totalLabel: String(raw.totalLabel || raw.total || raw.capacity || '').trim(),
      usedPercent: usedPct,
      syncNote: String(raw.syncNote || raw.sync || raw.lastSync || '').trim(),
      ownerLine: String(raw.ownerLine || raw.tagline || raw.motto || '').trim(),
      bags: bags,
      recent: recent,
      secrets: mapArr(raw, 'secrets', 'locked', normalizeSecret),
      shared: mapArr(raw, 'shared', 'withPartner', normalizeShared),
      voices: mapArr(raw, 'voices', 'voiceMemos', normalizeVoice),
      drafts: mapArr(raw, 'drafts', 'unsent', normalizeDraft),
      recycle: mapArr(raw, 'recycle', 'trash', normalizeRecycle),
      footerNote: String(raw.footerNote || raw.sealNote || raw.closing || '').trim()
    };
  }

  function normalizeCloudData(raw, contactId) {
    var base = defaultCloudData(contactId);
    if (!raw || typeof raw !== 'object') return base;
    var status = String(raw.refreshStatus || 'idle');
    if (status !== 'loading' && status !== 'success' && status !== 'error') status = 'idle';
    return {
      version: 1,
      contactId: String(raw.contactId || contactId || ''),
      updatedAt: Number(raw.updatedAt) || 0,
      refreshStatus: status,
      refreshMessage: String(raw.refreshMessage || ''),
      refreshStartedAt: Number(raw.refreshStartedAt) || 0,
      lastRefreshedAt: Number(raw.lastRefreshedAt) || 0,
      cloud: normalizeCloudPayload(raw.cloud)
    };
  }

  function getCached(contactId) {
    var key = cloudKey(contactId);
    return cache[key] ? normalizeCloudData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = cloudKey(contactId);
    cache[key] = normalizeCloudData(data, contactId);
    return cache[key];
  }

  function getCloud(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultCloudData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(cloudKey(id)).then(function (raw) {
      var data = normalizeCloudData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultCloudData(id);
    });
  }

  function saveCloud(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeCloudData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(cloudKey(id), next).then(function () { return next; });
  }

  function patchCloud(contactId, patch) {
    return getCloud(contactId).then(function (cur) {
      return saveCloud(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepCloudStore = {
    defaultCloudData: defaultCloudData,
    normalizeCloudData: normalizeCloudData,
    normalizeCloudPayload: normalizeCloudPayload,
    getCloud: getCloud,
    saveCloud: saveCloud,
    patchCloud: patchCloud,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
