(function (global) {
  'use strict';

  var KV_DB = 'miya-kv-store';
  var KV_STORE = 'kv';
  var WIDGET_PREFIX = 'widgetKV:';
  var SPILL_BYTES = 49152;
  var LS_PLACEHOLDER = '{"__storedInIdb":true}';

  /** 内存热缓存：bootstrap / 写入后立即可用，供 miyaSyncReadJsonKey 同步读 */
  global.__miyaKvMem = global.__miyaKvMem || Object.create(null);

  var dbPromise = null;

  function invalidateDbPromise(promise) {
    if (dbPromise === promise) dbPromise = null;
  }

  function openKvDb() {
    if (dbPromise) return dbPromise;
    function attemptOpen(retryLeft) {
      return new Promise(function (resolve, reject) {
        var req;
        try { req = indexedDB.open(KV_DB, 1); } catch (e) { reject(e); return; }
        var settled = false;
        req.onerror = function () {
          settled = true;
          reject(req.error);
        };
        req.onblocked = function () {
          settled = true;
          reject(new Error('miya-kv-store blocked'));
        };
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(KV_STORE)) {
            db.createObjectStore(KV_STORE);
          }
        };
        req.onsuccess = function () {
          var db = req.result;
          db.onversionchange = function () {
            try { db.close(); } catch (e) {}
            invalidateDbPromise(dbPromise);
          };
          db.onclose = function () { invalidateDbPromise(dbPromise); };
          if (settled) {
            try { db.close(); } catch (e2) {}
            return;
          }
          resolve(db);
        };
      }).catch(function (err) {
        if (retryLeft <= 0) {
          invalidateDbPromise(dbPromise);
          throw err;
        }
        return new Promise(function (r) { setTimeout(r, 120 + (3 - retryLeft) * 180); })
          .then(function () { return attemptOpen(retryLeft - 1); });
      });
    }
    dbPromise = attemptOpen(3);
    return dbPromise;
  }

  function kvGet(key) {
    return openKvDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(KV_STORE, 'readonly');
        var req = tx.objectStore(KV_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function kvPut(key, value) {
    return openKvDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(KV_STORE, 'readwrite');
        tx.objectStore(KV_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function kvDelete(key) {
    return openKvDb().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(KV_STORE, 'readwrite');
          tx.objectStore(KV_STORE).delete(key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    }).catch(function () {});
  }

  function utf8Bytes(str) {
    try {
      return new Blob([str == null ? '' : String(str)]).size;
    } catch (e) {
      return String(str || '').length;
    }
  }

  function memSet(key, value) {
    if (!key) return;
    global.__miyaKvMem[key] = value;
  }

  function memGet(key) {
    if (!key) return undefined;
    if (Object.prototype.hasOwnProperty.call(global.__miyaKvMem, key)) {
      return global.__miyaKvMem[key];
    }
    return undefined;
  }

  function writeLsMirror(key, value) {
    var str = '';
    try { str = JSON.stringify(value); } catch (e) { return false; }
    try {
      if (utf8Bytes(str) > SPILL_BYTES) {
        localStorage.setItem(key, LS_PLACEHOLDER);
      } else {
        localStorage.setItem(key, str);
      }
      return true;
    } catch (e2) {
      if (e2 && (e2.name === 'QuotaExceededError' || e2.code === 22)) {
        try { localStorage.setItem(key, LS_PLACEHOLDER); return true; } catch (e3) {}
      }
      return false;
    }
  }

  global.miyaLsIsIdbPlaceholder = function (raw) {
    var s = String(raw || '').trim();
    if (!s || s.length > 120 || s.charAt(0) !== '{') return false;
    return /"__storedInIdb"\s*:\s*true/.test(s);
  };

  global.miyaLsSpillBytes = SPILL_BYTES;

  global.miyaWidgetKvIdbGet = function (logicalKey) {
    if (!logicalKey) return Promise.resolve(null);
    return kvGet(WIDGET_PREFIX + String(logicalKey)).catch(function () { return null; });
  };

  global.miyaWidgetKvIdbPut = function (logicalKey, value) {
    if (!logicalKey) return Promise.resolve(false);
    return kvPut(WIDGET_PREFIX + String(logicalKey), value).then(function () { return true; })
      .catch(function () { return false; });
  };

  global.miyaWidgetKvIdbDelete = function (logicalKey) {
    if (!logicalKey) return Promise.resolve();
    return kvDelete(WIDGET_PREFIX + String(logicalKey));
  };

  /** 同步读：内存热缓存 → localStorage（跳过 IDB 占位符） */
  global.miyaSyncReadJsonKey = function (key) {
    var k = String(key || '');
    if (!k) return null;
    var mem = memGet(k);
    if (mem !== undefined) return mem;
    var raw = null;
    try { raw = localStorage.getItem(k); } catch (e) { return null; }
    if (raw == null) return null;
    if (global.miyaLsIsIdbPlaceholder(raw)) return null;
    try {
      var parsed = JSON.parse(raw);
      memSet(k, parsed);
      return parsed;
    } catch (e2) { return null; }
  };

  global.miyaKvKeyNeedsAsyncHydrate = function (key) {
    var k = String(key || '');
    if (!k) return false;
    if (memGet(k) !== undefined) return false;
    try {
      var raw = localStorage.getItem(k);
      if (raw == null) return true;
      return !!(global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw));
    } catch (e) {
      return true;
    }
  };

  /** 异步读：IndexedDB 为主 → legacy widgetKV 前缀 → localStorage 迁移兜底 */
  global.miyaReadLsJsonKey = async function (key, fallback) {
    var k = String(key || '');
    var fb = fallback !== undefined ? fallback : null;
    if (!k) return fb;

    var mem = memGet(k);
    if (mem !== undefined) return mem;

    var idbVal = null;
    try { idbVal = await kvGet(k); } catch (eIdb) { idbVal = null; }
    /* 异步读期间若已有写入（如图标/布局保存），优先用内存中的较新数据，避免旧 IDB 覆盖 */
    mem = memGet(k);
    if (mem !== undefined) return mem;
    if (idbVal == null) {
      try { idbVal = await global.miyaWidgetKvIdbGet(k); } catch (eLeg) { idbVal = null; }
      mem = memGet(k);
      if (mem !== undefined) return mem;
      if (idbVal != null) {
        try { await kvPut(k, idbVal); } catch (eMigr) {}
      }
    }
    mem = memGet(k);
    if (mem !== undefined) return mem;
    if (idbVal != null) {
      memSet(k, idbVal);
      return idbVal;
    }

    var raw = null;
    try { raw = localStorage.getItem(k); } catch (e) {}
    mem = memGet(k);
    if (mem !== undefined) return mem;
    if (raw == null) return fb;
    if (global.miyaLsIsIdbPlaceholder(raw)) return fb;

    try {
      var parsed = JSON.parse(raw);
      mem = memGet(k);
      if (mem !== undefined) return mem;
      memSet(k, parsed);
      try { await kvPut(k, parsed); } catch (eMigr2) {}
      return parsed;
    } catch (e4) { return fb; }
  };

  /** 异步写：IndexedDB 为主，成功后写 localStorage 镜像/占位符 */
  global.miyaWriteLsJsonKey = async function (key, value) {
    var k = String(key || '');
    if (!k) return false;
    memSet(k, value);
    try {
      await kvPut(k, value);
      try { await global.miyaWidgetKvIdbDelete(k); } catch (eDel) {}
      writeLsMirror(k, value);
      return true;
    } catch (eIdb) {
      var ok = await global.miyaWidgetKvIdbPut(k, value);
      if (ok) {
        writeLsMirror(k, value);
        return true;
      }
      var str = '';
      try { str = JSON.stringify(value); } catch (e) { return false; }
      try {
        localStorage.setItem(k, str);
        return true;
      } catch (e2) {
        return false;
      }
    }
  };

  /**
   * 同步刷盘（pagehide 用）：更新内存 + localStorage 镜像，并触发 IDB 写入。
   * IDB put 失败时回退 widgetKV，并再试一次，降低部分机型杀进程前写丢概率。
   */
  global.miyaSyncFlushJsonKey = function (key, value) {
    var k = String(key || '');
    if (!k) return false;
    memSet(k, value);
    writeLsMirror(k, value);
    function putOnce() {
      return kvPut(k, value).catch(function () {
        return global.miyaWidgetKvIdbPut(k, value).then(function (ok) {
          if (ok) return true;
          throw new Error('kv_flush_failed');
        });
      });
    }
    putOnce().catch(function () {
      setTimeout(function () {
        putOnce().catch(function () {});
      }, 40);
    });
    return true;
  };

  global.miyaKvIdbExportAllEntries = function () {
    return openKvDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(KV_STORE, 'readonly');
        var store = tx.objectStore(KV_STORE);
        var out = {};
        var req = store.openCursor();
        req.onsuccess = function (e) {
          var c = e.target.result;
          if (c) {
            try { out[String(c.key)] = c.value; } catch (err) {}
            c.continue();
          } else resolve(out);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  };

  /** 游标导出 KV 为 JSON Blob，避免整表对象 + stringify 双峰内存 */
  global.miyaKvIdbExportToJsonBlob = function (onProgress) {
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    return openKvDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(KV_STORE, 'readonly');
        var store = tx.objectStore(KV_STORE);
        var countReq = store.count();
        countReq.onsuccess = function () {
          var total = countReq.result || 0;
          var parts = ['{'];
          var first = true;
          var count = 0;
          var cur = store.openCursor();
          cur.onsuccess = function (ev) {
            var c = ev.target.result;
            if (!c) {
              parts.push('}');
              onProgress(total, total);
              var blob = new Blob(parts, { type: 'application/json' });
              parts = null;
              resolve(blob);
              return;
            }
            if (!first) parts.push(',');
            first = false;
            var k = String(c.key);
            var v;
            try { v = JSON.stringify(c.value); } catch (e) { v = 'null'; }
            parts.push(JSON.stringify(k), ':', v);
            count += 1;
            onProgress(count, total);
            c.continue();
          };
          cur.onerror = function () { reject(cur.error); };
        };
        countReq.onerror = function () { reject(countReq.error); };
      });
    }).catch(function () {
      return new Blob(['{}'], { type: 'application/json' });
    });
  };

  global.miyaKvIdbReplaceAllEntries = function (entriesObj, onProgress) {
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    var src = entriesObj && typeof entriesObj === 'object' ? entriesObj : {};
    var keys = Object.keys(src);
    var BATCH = 30;
    function tick() {
      return new Promise(function (r) { setTimeout(r, 0); });
    }
    return openKvDb().then(function (db) {
      function clearAll() {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(KV_STORE, 'readwrite');
          tx.objectStore(KV_STORE).clear();
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error || new Error('miya-kv-store clear failed')); };
        });
      }
      function putSlice(start) {
        if (start >= keys.length) {
          onProgress(keys.length, keys.length);
          return Promise.resolve();
        }
        var end = Math.min(start + BATCH, keys.length);
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(KV_STORE, 'readwrite');
          var store = tx.objectStore(KV_STORE);
          for (var i = start; i < end; i++) {
            store.put(src[keys[i]], keys[i]);
          }
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error || new Error('miya-kv-store write failed')); };
        }).then(function () {
          onProgress(end, keys.length);
          return tick().then(function () { return putSlice(end); });
        });
      }
      return clearAll().then(function () { return putSlice(0); });
    });
  };

  global.miyaKvExportNamedDbKv = function (dbName, storeName) {
    var dn = String(dbName || '');
    var sn = String(storeName || '');
    if (!dn || !sn) return Promise.resolve({});
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(dn, 1); } catch (e) { resolve({}); return; }
      req.onerror = function () { resolve({}); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) db.createObjectStore(sn);
      };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) { resolve({}); return; }
        var tx = db.transaction(sn, 'readonly');
        var store = tx.objectStore(sn);
        var out = {};
        var cur = store.openCursor();
        cur.onsuccess = function (ev) {
          var c = ev.target.result;
          if (c) {
            try { out[String(c.key)] = c.value; } catch (err) {}
            c.continue();
          } else resolve(out);
        };
        cur.onerror = function () { resolve(out); };
      };
    });
  };

  global.miyaKvReplaceNamedDbKv = function (dbName, storeName, entries) {
    var dn = String(dbName || '');
    var sn = String(storeName || '');
    var src = entries && typeof entries === 'object' ? entries : {};
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(dn, 1); } catch (e) { reject(e); return; }
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) db.createObjectStore(sn);
      };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) {
          var v = db.version + 1;
          db.close();
          var req2 = indexedDB.open(dn, v);
          req2.onupgradeneeded = function () {
            req2.result.createObjectStore(sn);
          };
          req2.onsuccess = function () {
            replaceInDb(req2.result).then(resolve, reject);
          };
          req2.onerror = function () { reject(req2.error); };
          return;
        }
        replaceInDb(db).then(resolve, reject);
      };
    });

    function replaceInDb(db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(sn, 'readwrite');
        var store = tx.objectStore(sn);
        store.clear();
        Object.keys(src).forEach(function (k) { store.put(src[k], k); });
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    }
  };

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    var parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    try {
      var bin = atob(parts[1]);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: mime });
    } catch (e) { return null; }
  }

  function isSerializedBlobEntry(val) {
    return !!(val && typeof val === 'object' &&
      (val.__miyaBlob === 'dataUrl' || val.__blob === 'dataUrl') &&
      val.blobDataUrl);
  }

  function isMediaRefEntry(val) {
    return !!(val && typeof val === 'object' && val.__miyaMediaRef === true && val.mediaPath);
  }

  function looksLikeMediaRecord(val) {
    return !!(val && typeof val === 'object' &&
      (val.kind || val.mime || val.createdAt != null || val.size != null || val.__miyaBlobWrap === 'record'));
  }

  /** ZIP 路径安全编码，避免 key 含 / 等破坏目录结构 */
  global.miyaEncodeBackupMediaKey = function (key) {
    return encodeURIComponent(String(key || '')).replace(/%/g, '_');
  };

  global.miyaSerializeIdbBlobValue = function (val) {
    if (val instanceof Blob) {
      return blobToDataUrl(val).then(function (dataUrl) {
        return {
          __miyaBlob: 'dataUrl',
          __miyaBlobWrap: 'raw',
          blobDataUrl: dataUrl,
          mime: val.type || 'application/octet-stream'
        };
      });
    }
    if (val && typeof val === 'object' && val.blob instanceof Blob) {
      return blobToDataUrl(val.blob).then(function (dataUrl) {
        var out = Object.assign({}, val);
        out.__miyaBlob = 'dataUrl';
        out.__miyaBlobWrap = 'record';
        out.blobDataUrl = dataUrl;
        delete out.blob;
        return out;
      });
    }
    if (val && typeof val === 'object') return Promise.resolve(Object.assign({}, val));
    return Promise.resolve(val);
  };

  /**
   * 将 Blob 抽成 ZIP 外挂二进制引用（不转 base64），显著降低峰值内存。
   * addMedia(path, blob) 由调用方写入 zip。
   */
  global.miyaSerializeIdbBlobValueToMediaRef = function (val, mediaPath, addMedia) {
    var path = String(mediaPath || '');
    if (val instanceof Blob) {
      return Promise.resolve(addMedia(path, val)).then(function () {
        return {
          __miyaMediaRef: true,
          __miyaBlobWrap: 'raw',
          mediaPath: path,
          mime: val.type || 'application/octet-stream',
          size: val.size || 0
        };
      });
    }
    if (val && typeof val === 'object' && val.blob instanceof Blob) {
      var blob = val.blob;
      return Promise.resolve(addMedia(path, blob)).then(function () {
        var out = Object.assign({}, val);
        out.__miyaMediaRef = true;
        out.__miyaBlobWrap = 'record';
        out.mediaPath = path;
        out.mime = blob.type || out.mime || 'application/octet-stream';
        out.size = blob.size || out.size || 0;
        delete out.blob;
        delete out.blobDataUrl;
        delete out.__miyaBlob;
        delete out.__blob;
        return out;
      });
    }
    if (val && typeof val === 'object') return Promise.resolve(Object.assign({}, val));
    return Promise.resolve(val);
  };

  global.miyaDeserializeIdbBlobValue = function (val, mediaBlob) {
    if (!val || typeof val !== 'object') return val;

    if (isMediaRefEntry(val) || (val.__miyaMediaRef === true && mediaBlob)) {
      var refBlob = mediaBlob || null;
      var mime = String(val.mime || '').trim();
      /* record 形态只挂引用，禁止 new Blob 整份拷贝（主题壁纸大会因此卡死） */
      if (val.__miyaBlobWrap === 'raw') {
        /* 无 type 时也不整份拷贝，调用方靠外层 mime 字段即可 */
        return refBlob || new Blob([], { type: mime || 'application/octet-stream' });
      }
      var refCopy = Object.assign({}, val);
      delete refCopy.__miyaMediaRef;
      delete refCopy.__miyaBlobWrap;
      delete refCopy.mediaPath;
      if (refBlob) refCopy.blob = refBlob;
      if (mime) refCopy.mime = mime;
      return refCopy;
    }

    if (!isSerializedBlobEntry(val)) return val;
    var blob = dataUrlToBlob(val.blobDataUrl);
    var mime2 = String(val.mime || '').trim();
    if (blob && mime2 && blob.type !== mime2) {
      blob = new Blob([blob], { type: mime2 });
    }
    if (val.__miyaBlobWrap === 'raw') return blob;
    if (val.__miyaBlobWrap === 'record' || val.__blob === 'dataUrl' || looksLikeMediaRecord(val)) {
      var copy = Object.assign({}, val);
      delete copy.__miyaBlob;
      delete copy.__miyaBlobWrap;
      delete copy.__blob;
      delete copy.blobDataUrl;
      if (blob) copy.blob = blob;
      return copy;
    }
    return blob;
  };

  global.miyaClearNamedDbStore = function (dbName, storeName) {
    var dn = String(dbName || '');
    var sn = String(storeName || '');
    if (!dn || !sn) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(dn, 1); } catch (e) { reject(e); return; }
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) db.createObjectStore(sn);
      };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) { resolve(); return; }
        var tx = db.transaction(sn, 'readwrite');
        tx.objectStore(sn).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  };

  global.miyaPutNamedDbKey = function (dbName, storeName, key, value) {
    var dn = String(dbName || '');
    var sn = String(storeName || '');
    if (!dn || !sn) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(dn, 1); } catch (e) { reject(e); return; }
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) db.createObjectStore(sn);
      };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) {
          var v = db.version + 1;
          db.close();
          var req2 = indexedDB.open(dn, v);
          req2.onupgradeneeded = function () { req2.result.createObjectStore(sn); };
          req2.onsuccess = function () {
            var tx = req2.result.transaction(sn, 'readwrite');
            tx.objectStore(sn).put(value, String(key));
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
          };
          req2.onerror = function () { reject(req2.error); };
          return;
        }
        var tx = db.transaction(sn, 'readwrite');
        tx.objectStore(sn).put(value, String(key));
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  };

  function openNamedDbReadwrite(dbName, storeName) {
    var dn = String(dbName || '');
    var sn = String(storeName || '');
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(dn, 1); } catch (e) { reject(e); return; }
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(sn)) db.createObjectStore(sn);
      };
      req.onsuccess = function () {
        var db = req.result;
        if (db.objectStoreNames.contains(sn)) {
          resolve(db);
          return;
        }
        var v = db.version + 1;
        db.close();
        var req2 = indexedDB.open(dn, v);
        req2.onupgradeneeded = function () { req2.result.createObjectStore(sn); };
        req2.onsuccess = function () { resolve(req2.result); };
        req2.onerror = function () { reject(req2.error); };
      };
    });
  }

  function isIOSBrowser() {
    try {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    } catch (e) { return false; }
  }

  /**
   * iOS 上 File/zip.slice 的 Blob 直接 put 进 IndexedDB 会永久挂起。
   * 必须先 arrayBuffer 物化成内存 Blob 再写入。
   */
  function materializeBlobForIdb(blob) {
    if (!blob || typeof blob.arrayBuffer !== 'function') return Promise.resolve(blob || null);
    return blob.arrayBuffer().then(function (buf) {
      return new Blob([buf], { type: (blob.type || 'application/octet-stream') });
    }).catch(function () {
      return null;
    });
  }

  /**
   * 导入 blob store。iOS：逐条物化 + 单条事务（稳）；其它：小批量。
   */
  global.miyaImportNamedDbBlobsSequential = function (dbName, storeName, src, resolveMedia, onProgress, opts) {
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    opts = opts || {};
    if (!src || typeof src !== 'object') return Promise.resolve();
    var keys = Object.keys(src);
    if (!keys.length) return Promise.resolve();
    var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

    return openNamedDbReadwrite(dbName, storeName).then(function (db) {
      function clearStore() {
        if (opts.append) return Promise.resolve();
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).clear();
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      }

      function putOne(key, value) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(value, String(key));
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      }

      function loadValue(k) {
        var raw = src[k];
        var p = Promise.resolve(null);
        if (isMediaRefEntry(raw) && typeof resolveMedia === 'function') {
          p = Promise.resolve(resolveMedia(raw.mediaPath)).catch(function () { return null; });
        } else if (isSerializedBlobEntry(raw) && raw.blobDataUrl) {
          /* 旧版 base64：deserialize 内部 atob，无需 resolveMedia */
          return Promise.resolve(global.miyaDeserializeIdbBlobValue(raw));
        }
        return p.then(function (mediaBlob) {
          if (!mediaBlob) {
            return global.miyaDeserializeIdbBlobValue(raw, undefined);
          }
          /* 关键端一律物化，避免 File.slice 挂死 IDB */
          return materializeBlobForIdb(mediaBlob).then(function (solid) {
            return global.miyaDeserializeIdbBlobValue(raw, solid || undefined);
          });
        });
      }

      var i = 0;
      return clearStore().then(function () {
        function next() {
          if (i >= keys.length) {
            onProgress(keys.length, keys.length);
            try { db.close(); } catch (e0) {}
            return Promise.resolve();
          }
          var k = keys[i];
          return loadValue(k).then(function (value) {
            return putOne(k, value).then(function () {
              i += 1;
              onProgress(i, keys.length);
              value = null;
              return tick().then(next);
            });
          });
        }
        return next();
      }).catch(function (err) {
        try { db.close(); } catch (e1) {}
        throw err;
      });
    });
  };

  /**
   * 游标导出 blob store 到 zip：索引 JSON + 二进制（STORE）。
   * 不转 base64。返回 { index, bytes }。
   */
  global.miyaExportIdbBlobStoreToZip = function (zip, dbName, storeName, mediaDir, onProgress) {
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    mediaDir = String(mediaDir || ('media/' + dbName)).replace(/\/$/, '');
    return openNamedDbReadonly(dbName, storeName).then(function (db) {
      if (!db.objectStoreNames.contains(storeName)) {
        onProgress(0, 0);
        return { index: {}, bytes: 0 };
      }
      return global.miyaCountIdbStoreEntries(dbName, storeName).then(function (total) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var store = tx.objectStore(storeName);
          var cur = store.openCursor();
          var index = {};
          var count = 0;
          var bytes = 0;
          var chain = Promise.resolve();

          cur.onsuccess = function (ev) {
            var c = ev.target.result;
            if (!c) {
              chain.then(function () {
                onProgress(total, total);
                resolve({ index: index, bytes: bytes });
              }).catch(reject);
              return;
            }
            var key = String(c.key);
            var val = c.value;
            c.continue();
            chain = chain.then(function () {
              var enc = global.miyaEncodeBackupMediaKey(key);
              var path = mediaDir + '/' + enc + '.bin';
              return global.miyaSerializeIdbBlobValueToMediaRef(val, path, function (p, blob) {
                zip.file(p, blob, { compression: 'STORE' });
                bytes += blob && blob.size ? blob.size : 0;
              }).then(function (serialized) {
                if (serialized != null) index[key] = serialized;
                count += 1;
                onProgress(count, total);
                if (count % 2 === 0) return exportYield(0);
              });
            });
          };
          cur.onerror = function () { reject(cur.error); };
        });
      });
    }).catch(function () {
      onProgress(0, 0);
      return { index: {}, bytes: 0 };
    });
  };

  /**
   * 按体积上限分片导出 blob store（默认 18MB，适配 iOS）。
   * 优先写入 STORE builder；无 builder 时回退 JSZip。
   * onChunk(builderOrZip, index, meta) — builder 时需调用方 finish；JSZip 时为 JSZip 实例。
   */
  global.miyaExportIdbBlobStoreChunked = function (dbName, storeName, mediaDir, maxBytes, onChunk, onProgress) {
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    onChunk = typeof onChunk === 'function' ? onChunk : function () { return Promise.resolve(); };
    maxBytes = maxBytes > 0 ? maxBytes : (18 * 1024 * 1024);
    mediaDir = String(mediaDir || ('media/' + dbName)).replace(/\/$/, '');
    var useStore = typeof global.miyaZipCreateStoreBuilder === 'function';

    function getAllKeys() {
      return openNamedDbReadonly(dbName, storeName).then(function (db) {
        if (!db.objectStoreNames.contains(storeName)) return [];
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var req = tx.objectStore(storeName).getAllKeys();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function () { return []; });
    }

    function getOne(key) {
      return openNamedDbReadonly(dbName, storeName).then(function (db) {
        if (!db.objectStoreNames.contains(storeName)) return null;
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var req = tx.objectStore(storeName).get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function () { return null; });
    }

    return getAllKeys().then(function (keys) {
      var total = keys.length;
      if (!total) {
        onProgress(0, 0);
        return { chunks: 0, total: 0 };
      }
      var pack = null;
      var index = {};
      var chunkBytes = 0;
      var chunkIndex = 0;
      var finishedChunks = 0;
      var i = 0;

      function ensurePack() {
        if (pack) return pack;
        if (useStore) {
          pack = { kind: 'store', builder: global.miyaZipCreateStoreBuilder() };
        } else if (global.JSZip) {
          pack = { kind: 'jszip', zip: new global.JSZip() };
        } else {
          throw new Error('zip_builder_missing');
        }
        return pack;
      }

      function addMedia(path, blob) {
        var p = ensurePack();
        if (p.kind === 'store') return p.builder.addFile(path, blob);
        p.zip.file(path, blob, { compression: 'STORE' });
        return Promise.resolve();
      }

      function flushChunk() {
        if (!pack) return Promise.resolve();
        var keyCount = Object.keys(index).length;
        if (!keyCount) {
          pack = null;
          index = {};
          chunkBytes = 0;
          return Promise.resolve();
        }
        var thisPack = pack;
        var thisIndex = index;
        var thisChunk = chunkIndex;
        pack = null;
        index = {};
        chunkBytes = 0;
        chunkIndex += 1;
        finishedChunks += 1;
        var handle = thisPack.kind === 'store' ? thisPack.builder : thisPack.zip;
        return Promise.resolve(onChunk(handle, thisIndex, {
          kind: thisPack.kind,
          chunkIndex: thisChunk,
          keys: keyCount,
          done: i,
          total: total
        }));
      }

      function next() {
        if (i >= keys.length) {
          return flushChunk().then(function () {
            onProgress(total, total);
            return { chunks: finishedChunks, total: total };
          });
        }
        var key = keys[i];
        return getOne(key).then(function (val) {
          var enc = global.miyaEncodeBackupMediaKey(String(key));
          var path = mediaDir + '/' + enc + '.bin';
          var addedSize = 0;
          return global.miyaSerializeIdbBlobValueToMediaRef(val, path, function (p, blob) {
            addedSize = blob && blob.size ? blob.size : 0;
            return addMedia(p, blob);
          }).then(function (serialized) {
            if (serialized != null) index[String(key)] = serialized;
            chunkBytes += addedSize;
            i += 1;
            onProgress(i, total);
            val = null;
            var shouldFlush = chunkBytes >= maxBytes && Object.keys(index).length > 0;
            var step = shouldFlush ? flushChunk() : Promise.resolve();
            return step.then(function () {
              return exportYield(0);
            }).then(next);
          });
        });
      }

      return next();
    });
  };

  /** 逐条序列化 blob，避免 Promise.all 并行读入大量 base64 导致移动端 OOM 闪退 */
  global.miyaExportNamedDbBlobs = function (dbName, storeName) {
    return global.miyaKvExportNamedDbKv(dbName, storeName).then(function (raw) {
      var out = {};
      var keys = Object.keys(raw || {});
      var i = 0;
      function next() {
        if (i >= keys.length) return Promise.resolve(out);
        var k = keys[i++];
        return global.miyaSerializeIdbBlobValue(raw[k]).then(function (s) {
          if (s != null) out[k] = s;
          return next();
        });
      }
      return next();
    });
  };

  global.miyaSafeJsonStringify = function (value) {
    try { return JSON.stringify(value); } catch (e) { return null; }
  };

  function exportYield(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms == null ? 0 : ms); });
  }

  function openNamedDbReadonly(dbName, storeName) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(dbName, 1); } catch (e) { reject(e); return; }
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = function () { resolve(req.result); };
    });
  }

  /** 游标逐条写入 JSON 片段，不在内存中堆积整库对象 */
  global.miyaAppendJsonObjectFromIdbCursor = function (parts, fieldName, dbName, storeName, serializeFn) {
    serializeFn = serializeFn || function (v) { return Promise.resolve(v); };
    return openNamedDbReadonly(dbName, storeName).then(function (db) {
      if (!db.objectStoreNames.contains(storeName)) return false;
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var cur = store.openCursor();
        var started = false;
        var first = true;
        var chain = Promise.resolve();
        var count = 0;

        cur.onsuccess = function (ev) {
          var c = ev.target.result;
          if (!c) {
            chain.then(function () {
              if (started) parts.push('}');
              resolve(started);
            }).catch(reject);
            return;
          }
          var key = String(c.key);
          var val = c.value;
          c.continue();
          chain = chain.then(function () {
            if (!started) {
              parts.push(',', JSON.stringify(fieldName), ':{');
              started = true;
            }
            return serializeFn(val).then(function (serialized) {
              if (!first) parts.push(',');
              first = false;
              var js;
              try { js = JSON.stringify(serialized); } catch (e) { js = 'null'; }
              parts.push(JSON.stringify(key), ':', js);
              count += 1;
              if (count % 4 === 0) return exportYield();
            });
          });
        };
        cur.onerror = function () { reject(cur.error); };
      });
    });
  };

  global.miyaAppendKvIdbToJsonParts = function (parts, fieldName) {
    return openKvDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(KV_STORE, 'readonly');
        var store = tx.objectStore(KV_STORE);
        var cur = store.openCursor();
        var first = true;
        parts.push(',', JSON.stringify(fieldName), ':{');
        cur.onsuccess = function (ev) {
          var c = ev.target.result;
          if (!c) {
            parts.push('}');
            resolve();
            return;
          }
          if (!first) parts.push(',');
          first = false;
          var k = String(c.key);
          var v;
          try { v = JSON.stringify(c.value); } catch (e) { v = 'null'; }
          parts.push(JSON.stringify(k), ':', v);
          c.continue();
        };
        cur.onerror = function () { reject(cur.error); };
      });
    });
  };

  /** 统计指定 IDB store 条目数，用于备份进度条 */
  global.miyaCountIdbStoreEntries = function (dbName, storeName) {
    return openNamedDbReadonly(dbName, storeName).then(function (db) {
      if (!db.objectStoreNames.contains(storeName)) return 0;
      return new Promise(function (resolve) {
        var tx = db.transaction(storeName, 'readonly');
        var req = tx.objectStore(storeName).count();
        req.onsuccess = function () { resolve(req.result || 0); };
        req.onerror = function () { resolve(0); };
      });
    }).catch(function () { return 0; });
  };

  /** 游标逐条导出 IDB store 为 JSON 字符串，支持进度回调 */
  global.miyaExportIdbStoreToJsonString = function (dbName, storeName, serializeFn, onProgress) {
    serializeFn = serializeFn || function (v) { return Promise.resolve(v); };
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    return openNamedDbReadonly(dbName, storeName).then(function (db) {
      if (!db.objectStoreNames.contains(storeName)) {
        onProgress(0, 0);
        return '{}';
      }
      return global.miyaCountIdbStoreEntries(dbName, storeName).then(function (total) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var store = tx.objectStore(storeName);
          var cur = store.openCursor();
          var parts = ['{'];
          var first = true;
          var count = 0;
          var chain = Promise.resolve();

          cur.onsuccess = function (ev) {
            var c = ev.target.result;
            if (!c) {
              chain.then(function () {
                parts.push('}');
                onProgress(total, total);
                resolve(parts.join(''));
              }).catch(reject);
              return;
            }
            var key = String(c.key);
            var val = c.value;
            c.continue();
            chain = chain.then(function () {
              return serializeFn(val).then(function (serialized) {
                if (!first) parts.push(',');
                first = false;
                var js;
                try { js = JSON.stringify(serialized); } catch (e) { js = 'null'; }
                parts.push(JSON.stringify(key), ':', js);
                count += 1;
                onProgress(count, total);
                if (count % 4 === 0) return exportYield();
              });
            });
          };
          cur.onerror = function () { reject(cur.error); };
        });
      });
    });
  };

  /** 同 miyaExportIdbStoreToJsonString，但返回 Blob（不 join 成巨型字符串） */
  global.miyaExportIdbStoreToJsonBlob = function (dbName, storeName, serializeFn, onProgress) {
    serializeFn = serializeFn || function (v) { return Promise.resolve(v); };
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    return openNamedDbReadonly(dbName, storeName).then(function (db) {
      if (!db.objectStoreNames.contains(storeName)) {
        onProgress(0, 0);
        return new Blob(['{}'], { type: 'application/json' });
      }
      return global.miyaCountIdbStoreEntries(dbName, storeName).then(function (total) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var store = tx.objectStore(storeName);
          var cur = store.openCursor();
          var parts = ['{'];
          var first = true;
          var count = 0;
          var chain = Promise.resolve();

          cur.onsuccess = function (ev) {
            var c = ev.target.result;
            if (!c) {
              chain.then(function () {
                parts.push('}');
                onProgress(total, total);
                var blob = new Blob(parts, { type: 'application/json' });
                parts = null;
                resolve(blob);
              }).catch(reject);
              return;
            }
            var key = String(c.key);
            var val = c.value;
            c.continue();
            chain = chain.then(function () {
              return serializeFn(val).then(function (serialized) {
                if (!first) parts.push(',');
                first = false;
                var js;
                try { js = JSON.stringify(serialized); } catch (e) { js = 'null'; }
                parts.push(JSON.stringify(key), ':', js);
                count += 1;
                onProgress(count, total);
                if (count % 2 === 0) return exportYield(0);
              });
            });
          };
          cur.onerror = function () { reject(cur.error); };
        });
      });
    }).catch(function () {
      onProgress(0, 0);
      return new Blob(['{}'], { type: 'application/json' });
    });
  };

  /**
   * 把 blob store 写入 STORE ZIP 构建器：逐条短事务读、逐条 addFile，并生成小索引 JSON。
   */
  global.miyaExportIdbBlobStoreToZipBuilder = function (builder, dbName, storeName, mediaDir, onProgress) {
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    mediaDir = String(mediaDir || ('media/' + dbName)).replace(/\/$/, '');

    function getAllKeys() {
      return openNamedDbReadonly(dbName, storeName).then(function (db) {
        if (!db.objectStoreNames.contains(storeName)) return [];
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var req = tx.objectStore(storeName).getAllKeys();
          req.onsuccess = function () { resolve(req.result || []); };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function () { return []; });
    }

    function getOne(key) {
      return openNamedDbReadonly(dbName, storeName).then(function (db) {
        if (!db.objectStoreNames.contains(storeName)) return null;
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(storeName, 'readonly');
          var req = tx.objectStore(storeName).get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      }).catch(function () { return null; });
    }

    return getAllKeys().then(function (keys) {
      var total = keys.length;
      var index = {};
      var i = 0;
      function next() {
        if (i >= keys.length) {
          onProgress(total, total);
          return Promise.resolve(index);
        }
        var key = keys[i];
        return getOne(key).then(function (val) {
          var enc = global.miyaEncodeBackupMediaKey(String(key));
          var path = mediaDir + '/' + enc + '.bin';
          return global.miyaSerializeIdbBlobValueToMediaRef(val, path, function (p, blob) {
            return builder.addFile(p, blob);
          }).then(function (serialized) {
            if (serialized != null) index[String(key)] = serialized;
            i += 1;
            onProgress(i, total);
            val = null;
            if (i % 1 === 0) return exportYield(0);
          }).then(next);
        });
      }
      if (!total) {
        onProgress(0, 0);
        return {};
      }
      return next();
    });
  };

  function downloadBlobViaAnchor(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); } catch (e0) {}
      try { URL.revokeObjectURL(url); } catch (e1) {}
    }, 60000);
    return true;
  }

  /** 经 Service Worker 从 OPFS 拉流下载（适合几百 MB 单文件，不整包进分享内存） */
  function downloadOpfsViaServiceWorker(fileName) {
    if (!('serviceWorker' in navigator)) return Promise.resolve(false);
    return navigator.serviceWorker.ready.then(function () {
      var url = new URL('./miya-opfs-dl/' + encodeURIComponent(fileName), location.href);
      url.searchParams.set('t', String(Date.now()));
      var a = document.createElement('a');
      a.href = url.href;
      a.download = fileName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { document.body.removeChild(a); } catch (e0) {}
      }, 2000);
      return true;
    }).catch(function () { return false; });
  }

  global.miyaDownloadBlobAsync = function (blob, filename) {
    if (!blob) return Promise.resolve(false);
    filename = String(filename || 'download.bin');
    var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var size = blob.size || 0;
    var LARGE = 24 * 1024 * 1024;

    /* 大文件：禁止 share / new File 拷贝。OPFS File 用 download 拉流；SW 作备选 */
    if (size >= LARGE && blob instanceof File) {
      try {
        downloadBlobViaAnchor(blob, filename);
        return Promise.resolve(true);
      } catch (eAnchor) {
        return downloadOpfsViaServiceWorker(blob.name || filename);
      }
    }

    if (isIOS && typeof File !== 'undefined' && typeof navigator.share === 'function' && size < LARGE) {
      var file;
      try {
        if (blob instanceof File && blob.name === filename) file = blob;
        else file = new File([blob], filename, { type: blob.type || 'application/zip' });
      } catch (eMake) {
        return Promise.resolve(false);
      }
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        return Promise.resolve(downloadBlobViaAnchor(blob, filename));
      }
      return navigator.share({ files: [file], title: filename }).then(function () {
        return true;
      }).catch(function (err) {
        if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return false;
        try { return downloadBlobViaAnchor(blob, filename); } catch (e1) { return false; }
      });
    }

    return Promise.resolve(downloadBlobViaAnchor(blob, filename));
  };

  global.miyaDownloadBlob = function (blob, filename) {
    var done = false;
    global.miyaDownloadBlobAsync(blob, filename).then(function (ok) { done = ok; }).catch(function () { done = false; });
    return true;
  };

  global.miyaDownloadJson = function (value, filename) {
    var json = typeof value === 'string' ? value : global.miyaSafeJsonStringify(value);
    if (json == null) return false;
    return global.miyaDownloadBlob(
      new Blob([json], { type: 'application/json;charset=utf-8' }),
      filename || 'download.json'
    );
  };

  global.miyaImportNamedDbBlobs = function (dbName, storeName, src) {
    if (!src || typeof src !== 'object' || !Object.keys(src).length) return Promise.resolve();
    var fixed = {};
    Object.keys(src).forEach(function (k) {
      fixed[k] = global.miyaDeserializeIdbBlobValue(src[k]);
    });
    return global.miyaKvReplaceNamedDbKv(dbName, storeName, fixed);
  };

  global.__miyaKvStores = global.__miyaKvStores || [];
  global.__miyaPagehideFlushers = global.__miyaPagehideFlushers || [];

  global.miyaRegisterKvStore = function (entry) {
    if (!entry || typeof entry.whenReady !== 'function') return;
    var list = global.__miyaKvStores;
    if (list.indexOf(entry) >= 0) return;
    list.push(entry);
  };

  global.miyaRegisterPagehideFlush = function (fn) {
    if (typeof fn !== 'function') return;
    var list = global.__miyaPagehideFlushers;
    if (list.indexOf(fn) >= 0) return;
    list.push(fn);
  };

  /** 启动：仅预加载标记为 critical 的 store（默认无） */
  global.miyaBootstrapKvStores = function (opts) {
    var list = global.__miyaKvStores || [];
    var onlyCritical = !!(opts && opts.critical);
    var targets = onlyCritical ? list.filter(function (e) { return e.critical; }) : list;
    if (!targets.length) return Promise.resolve();
    return Promise.all(targets.map(function (entry) {
      return entry.whenReady().catch(function () {});
    }));
  };

  /** 空闲时预加载其余 KV store，避免阻塞首屏 */
  global.miyaBootstrapKvStoresIdle = function () {
    var run = function () {
      global.miyaBootstrapKvStores().catch(function () {});
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 400);
    }
  };

  /** 请求持久化存储，降低 iOS 驱逐 IndexedDB 概率 */
  global.miyaRequestPersistentStorage = function () {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage &&
          typeof navigator.storage.persist === 'function') {
        return navigator.storage.persist().catch(function () { return false; });
      }
    } catch (e) {}
    return Promise.resolve(false);
  };

  if (!global.__miyaPagehideFlushBound) {
    global.__miyaPagehideFlushBound = true;
    function runPagehideFlush(opts) {
      (global.__miyaPagehideFlushers || []).forEach(function (fn) {
        try { fn(opts); } catch (e) {}
      });
    }
    window.addEventListener('pagehide', function () {
      runPagehideFlush({ urgent: true });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        runPagehideFlush({ urgent: false });
      }
    });
  }

  global.miyaTriggerFileInput = function (input) {
    if (!input || input.disabled) return;
    var wasHidden = input.hasAttribute('hidden');
    var origParent = input.parentNode;
    input.removeAttribute('hidden');
    var s = input.style;
    var prev = {
      position: s.position,
      top: s.top,
      left: s.left,
      width: s.width,
      height: s.height,
      opacity: s.opacity,
      pointerEvents: s.pointerEvents,
      zIndex: s.zIndex,
      overflow: s.overflow
    };
    if (input.classList.contains('ins-file')) {
      input.classList.remove('ins-file');
      input._miyaRestoreInsFile = true;
    }
    s.position = 'fixed';
    s.top = '0';
    s.left = '0';
    s.width = '100%';
    s.height = '100%';
    s.opacity = '0';
    s.pointerEvents = 'auto';
    s.zIndex = '2147483646';
    s.overflow = 'hidden';
    if (origParent !== document.body) document.body.appendChild(input);
    try {
      input.click();
    } catch (e) { /* ignore */ }
    setTimeout(function () {
      if (input._miyaRestoreInsFile) {
        input.classList.add('ins-file');
        delete input._miyaRestoreInsFile;
      }
      s.position = prev.position;
      s.top = prev.top;
      s.left = prev.left;
      s.width = prev.width;
      s.height = prev.height;
      s.opacity = prev.opacity;
      s.pointerEvents = prev.pointerEvents;
      s.zIndex = prev.zIndex;
      s.overflow = prev.overflow;
      if (origParent && input.parentNode === document.body) origParent.appendChild(input);
      if (wasHidden) input.setAttribute('hidden', '');
    }, 600);
  };
})(window);
