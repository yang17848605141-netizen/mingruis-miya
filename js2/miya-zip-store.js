/**
 * 低内存 ZIP（仅 STORE）。
 * 写入优先级：
 * 1) OPFS createWritable（Chromium）
 * 2) Worker + createSyncAccessHandle（Safari / iOS —— 关键，否则会静默退回内存闪退）
 * 3) 内存 builder（仅小包兜底）
 * CRC32 固定 0，避免大文件二次扫描。
 */
(function (global) {
  'use strict';

  var WRITE_SLICE = 256 * 1024;

  function u16(n) {
    var b = new Uint8Array(2);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    return b;
  }

  function u32(n) {
    var b = new Uint8Array(4);
    b[0] = n & 0xff;
    b[1] = (n >>> 8) & 0xff;
    b[2] = (n >>> 16) & 0xff;
    b[3] = (n >>> 24) & 0xff;
    return b;
  }

  function encodeName(name) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(name || ''));
    var s = unescape(encodeURIComponent(String(name || '')));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function toBlob(data) {
    if (data instanceof Blob) return data;
    if (typeof data === 'string') return new Blob([data], { type: 'application/octet-stream' });
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return new Blob([data]);
    return new Blob([data == null ? '' : String(data)]);
  }

  function tick() {
    return new Promise(function (r) { setTimeout(r, 0); });
  }

  function safeZipName(fileName) {
    var safeName = String(fileName || ('miya-export-' + Date.now() + '.zip'))
      .replace(/[^\w.\-]+/g, '_')
      .slice(0, 120);
    if (!/\.zip$/i.test(safeName)) safeName += '.zip';
    return safeName;
  }

  function makeLocalAndCentral(fileName, size, offset) {
    var nameBytes = encodeName(fileName);
    var crc = 0;
    var localHeader = new Blob([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      nameBytes
    ]);
    var centralHeader = new Blob([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes
    ]);
    return {
      localHeader: localHeader,
      centralHeader: centralHeader,
      localSize: 30 + nameBytes.length
    };
  }

  function writeBlobSlicedToWritable(writable, blob) {
    if (!blob || !blob.size) return Promise.resolve();
    if (blob.size <= WRITE_SLICE) return Promise.resolve(writable.write(blob));
    var offset = 0;
    function next() {
      if (offset >= blob.size) return Promise.resolve();
      var end = Math.min(offset + WRITE_SLICE, blob.size);
      var slice = blob.slice(offset, end);
      offset = end;
      return Promise.resolve(writable.write(slice)).then(function () {
        slice = null;
        return tick().then(next);
      });
    }
    return next();
  }

  function blobToWorkerWrites(sendBuffer, blob) {
    if (!blob || !blob.size) return Promise.resolve();
    var offset = 0;
    function next() {
      if (offset >= blob.size) return Promise.resolve();
      var end = Math.min(offset + WRITE_SLICE, blob.size);
      return blob.slice(offset, end).arrayBuffer().then(function (buf) {
        offset = end;
        return sendBuffer(buf).then(function () {
          return tick().then(next);
        });
      });
    }
    return next();
  }

  function getOpfsFile(fileName) {
    return navigator.storage.getDirectory().then(function (root) {
      return root.getDirectoryHandle('miya-backup-tmp', { create: true }).then(function (dir) {
        return dir.getFileHandle(fileName).then(function (fh) {
          return fh.getFile();
        });
      });
    });
  }

  function removeOpfsFile(fileName) {
    if (!navigator.storage || !navigator.storage.getDirectory) return Promise.resolve();
    return navigator.storage.getDirectory().then(function (root) {
      return root.getDirectoryHandle('miya-backup-tmp', { create: true }).then(function (dir) {
        return dir.removeEntry(fileName).catch(function () {});
      });
    }).catch(function () {});
  }

  /** 内存 STORE ZIP（仅小数据兜底；完整导出不应走到这里） */
  global.miyaZipCreateStoreBuilder = function () {
    var parts = [];
    var central = [];
    var entries = [];
    var offset = 0;
    var pendingBytes = 0;

    function coalesce() {
      if (parts.length < 48 && pendingBytes < 8 * 1024 * 1024) return;
      var merged = new Blob(parts, { type: 'application/octet-stream' });
      parts = [merged];
      pendingBytes = merged.size;
    }

    return {
      backend: 'memory',
      addFile: function (name, data) {
        var fileName = String(name || '').replace(/^\/+/, '');
        var blob = toBlob(data);
        var size = blob.size >>> 0;
        var built = makeLocalAndCentral(fileName, size, offset);
        parts.push(built.localHeader, blob);
        pendingBytes += built.localSize + size;
        central.push(built.centralHeader);
        entries.push({ name: fileName, size: size });
        offset += built.localSize + size;
        coalesce();
        blob = null;
        return Promise.resolve(fileName);
      },
      approxBytes: function () { return pendingBytes; },
      finish: function () {
        var centralBlob = new Blob(central);
        var eocd = new Blob([
          u32(0x06054b50),
          u16(0),
          u16(0),
          u16(entries.length),
          u16(entries.length),
          u32(centralBlob.size),
          u32(offset),
          u16(0)
        ]);
        parts.push(centralBlob, eocd);
        var out = new Blob(parts, { type: 'application/zip' });
        parts = null;
        central = null;
        entries = null;
        return Promise.resolve(out);
      },
      cleanup: function () { return Promise.resolve(); },
      entryCount: function () { return entries.length; }
    };
  };

  function createWritableOpfsWriter(fileName) {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      return Promise.reject(new Error('opfs_unavailable'));
    }
    var safeName = safeZipName(fileName);
    return navigator.storage.getDirectory().then(function (root) {
      return root.getDirectoryHandle('miya-backup-tmp', { create: true }).then(function (dir) {
        return dir.removeEntry(safeName).catch(function () {}).then(function () {
          return dir.getFileHandle(safeName, { create: true }).then(function (fh) {
            if (typeof fh.createWritable !== 'function') {
              return Promise.reject(new Error('createWritable_unavailable'));
            }
            return fh.createWritable({ keepExistingData: false }).then(function (writable) {
              var central = [];
              var entries = [];
              var offset = 0;
              var closed = false;

              function addFile(name, data) {
                if (closed) return Promise.reject(new Error('writer_closed'));
                var inner = String(name || '').replace(/^\/+/, '');
                var blob = toBlob(data);
                var size = blob.size >>> 0;
                var built = makeLocalAndCentral(inner, size, offset);
                return Promise.resolve(writable.write(built.localHeader)).then(function () {
                  return writeBlobSlicedToWritable(writable, blob);
                }).then(function () {
                  central.push(built.centralHeader);
                  entries.push({ name: inner, size: size });
                  offset += built.localSize + size;
                  blob = null;
                  return tick().then(function () { return inner; });
                });
              }

              function finish() {
                if (closed) return Promise.reject(new Error('writer_closed'));
                var centralBlob = new Blob(central);
                var eocd = new Blob([
                  u32(0x06054b50),
                  u16(0),
                  u16(0),
                  u16(entries.length),
                  u16(entries.length),
                  u32(centralBlob.size),
                  u32(offset),
                  u16(0)
                ]);
                return Promise.resolve(writable.write(centralBlob)).then(function () {
                  return writable.write(eocd);
                }).then(function () {
                  return writable.close();
                }).then(function () {
                  closed = true;
                  writable = null;
                  central = null;
                  return fh.getFile();
                });
              }

              function cleanup() {
                var p = Promise.resolve();
                if (!closed && writable) {
                  p = Promise.resolve(writable.abort ? writable.abort() : writable.close()).catch(function () {});
                  closed = true;
                  writable = null;
                }
                return p.then(function () { return removeOpfsFile(safeName); });
              }

              return {
                backend: 'opfs-writable',
                addFile: addFile,
                finish: finish,
                cleanup: cleanup,
                approxBytes: function () { return offset; },
                entryCount: function () { return entries.length; },
                fileName: safeName
              };
            });
          });
        });
      });
    });
  }

  function createWorkerOpfsWriter(fileName) {
    if (typeof Worker === 'undefined') return Promise.reject(new Error('worker_unavailable'));
    var safeName = safeZipName(fileName);
    var workerUrl = 'js2/miya-opfs-writer-worker.js?v=1';
    var worker;
    try {
      worker = new Worker(workerUrl);
    } catch (e) {
      return Promise.reject(e);
    }

    var seq = 0;
    var pending = Object.create(null);
    var closed = false;
    var central = [];
    var entries = [];
    var offset = 0;

    function waitFor(type, id) {
      return new Promise(function (resolve, reject) {
        var key = type + ':' + (id == null ? '' : id);
        pending[key] = { resolve: resolve, reject: reject };
      });
    }

    worker.onmessage = function (ev) {
      var msg = ev.data || {};
      if (msg.type === 'error') {
        Object.keys(pending).forEach(function (k) {
          try { pending[k].reject(new Error(msg.message || 'opfs_worker_error')); } catch (e0) {}
        });
        pending = Object.create(null);
        return;
      }
      var key = msg.type + ':' + (msg.id == null ? '' : msg.id);
      if (msg.type === 'opened') key = 'opened:';
      if (msg.type === 'finished') key = 'finished:';
      if (msg.type === 'aborted') key = 'aborted:';
      var slot = pending[key];
      if (slot) {
        delete pending[key];
        slot.resolve(msg);
      }
    };
    worker.onerror = function (err) {
      Object.keys(pending).forEach(function (k) {
        try { pending[k].reject(err || new Error('worker_error')); } catch (e0) {}
      });
      pending = Object.create(null);
    };

    function sendBuffer(buffer) {
      var id = ++seq;
      var p = waitFor('written', id);
      worker.postMessage({ type: 'write', id: id, buffer: buffer }, [buffer]);
      return p;
    }

    function sendBlob(blob) {
      return blobToWorkerWrites(sendBuffer, blob);
    }

    var opened = waitFor('opened');
    worker.postMessage({ type: 'open', fileName: safeName });

    return opened.then(function () {
      function addFile(name, data) {
        if (closed) return Promise.reject(new Error('writer_closed'));
        var inner = String(name || '').replace(/^\/+/, '');
        var blob = toBlob(data);
        var size = blob.size >>> 0;
        var built = makeLocalAndCentral(inner, size, offset);
        return sendBlob(built.localHeader).then(function () {
          return sendBlob(blob);
        }).then(function () {
          central.push(built.centralHeader);
          entries.push({ name: inner, size: size });
          offset += built.localSize + size;
          blob = null;
          return tick().then(function () { return inner; });
        });
      }

      function finish() {
        if (closed) return Promise.reject(new Error('writer_closed'));
        var centralBlob = new Blob(central);
        var eocd = new Blob([
          u32(0x06054b50),
          u16(0),
          u16(0),
          u16(entries.length),
          u16(entries.length),
          u32(centralBlob.size),
          u32(offset),
          u16(0)
        ]);
        var done = waitFor('finished');
        return sendBlob(centralBlob).then(function () {
          return sendBlob(eocd);
        }).then(function () {
          worker.postMessage({ type: 'finish' });
          return done;
        }).then(function () {
          closed = true;
          central = null;
          try { worker.terminate(); } catch (e0) {}
          return getOpfsFile(safeName);
        });
      }

      function cleanup() {
        var p = Promise.resolve();
        if (!closed) {
          var aborted = waitFor('aborted').catch(function () {});
          try { worker.postMessage({ type: 'abort' }); } catch (e0) {}
          p = aborted.then(function () {
            try { worker.terminate(); } catch (e1) {}
          });
          closed = true;
        } else {
          try { worker.terminate(); } catch (e2) {}
        }
        return p.then(function () { return removeOpfsFile(safeName); });
      }

      return {
        backend: 'opfs-worker',
        addFile: addFile,
        finish: finish,
        cleanup: cleanup,
        approxBytes: function () { return offset; },
        entryCount: function () { return entries.length; },
        fileName: safeName
      };
    }).catch(function (err) {
      try { worker.terminate(); } catch (e0) {}
      throw err;
    });
  }

  /**
   * 完整导出必须走 OPFS（writable 或 worker）。
   * opts.requireOpfs=true 时禁止回退内存。
   */
  global.miyaZipCreateStoreWriter = function (opts) {
    opts = opts || {};
    if (opts.forceMemory) {
      return Promise.resolve(global.miyaZipCreateStoreBuilder());
    }
    var requireOpfs = !!opts.requireOpfs;
    return createWritableOpfsWriter(opts.fileName).catch(function () {
      return createWorkerOpfsWriter(opts.fileName);
    }).catch(function (err) {
      if (requireOpfs) return Promise.reject(err || new Error('opfs_required'));
      return global.miyaZipCreateStoreBuilder();
    });
  };

  /** 供下载：从临时目录取出已写好的 OPFS File */
  global.miyaZipGetOpfsBackupFile = getOpfsFile;
  global.miyaZipRemoveOpfsBackupFile = removeOpfsFile;

  function readU16(view, off) {
    return view.getUint16(off, true);
  }

  function readU32(view, off) {
    return view.getUint32(off, true);
  }

  function decodeName(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  global.miyaZipOpenFromBlob = function (blob) {
    if (!blob || !blob.size) return Promise.reject(new Error('empty_zip'));
    var size = blob.size;
    var tailLen = Math.min(65536 + 22, size);
    return blob.slice(size - tailLen).arrayBuffer().then(function (tailBuf) {
      var tail = new Uint8Array(tailBuf);
      var eocd = -1;
      for (var i = tail.length - 22; i >= 0; i--) {
        if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) return Promise.reject(new Error('invalid_zip_eocd'));
      var view = new DataView(tailBuf);
      var entriesCount = readU16(view, eocd + 10);
      var centralSize = readU32(view, eocd + 12);
      var centralOffset = readU32(view, eocd + 16);
      return blob.slice(centralOffset, centralOffset + centralSize).arrayBuffer().then(function (centralBuf) {
        var cv = new DataView(centralBuf);
        var cu = new Uint8Array(centralBuf);
        var files = Object.create(null);
        var list = [];
        var needsJszip = false;
        var pos = 0;
        for (var n = 0; n < entriesCount; n++) {
          if (readU32(cv, pos) !== 0x02014b50) break;
          var method = readU16(cv, pos + 10);
          var compSize = readU32(cv, pos + 20);
          var uncompSize = readU32(cv, pos + 24);
          var nameLen = readU16(cv, pos + 28);
          var extraLen = readU16(cv, pos + 30);
          var commentLen = readU16(cv, pos + 32);
          var localHeaderOffset = readU32(cv, pos + 42);
          var name = decodeName(cu.subarray(pos + 46, pos + 46 + nameLen));
          if (method !== 0) needsJszip = true;
          files[name] = {
            name: name,
            method: method,
            compSize: compSize,
            uncompSize: uncompSize,
            localHeaderOffset: localHeaderOffset,
            nameLen: nameLen,
            dataOffset: localHeaderOffset + 30 + nameLen
          };
          list.push(name);
          pos += 46 + nameLen + extraLen + commentLen;
        }

        return {
          needsJszip: needsJszip,
          list: function () { return list.slice(); },
          file: function (name) {
            var entry = files[String(name || '')];
            if (!entry) return null;
            return {
              async: function (type) {
                if (entry.method !== 0) {
                  return Promise.reject(new Error('deflate_needs_jszip'));
                }
                var slice = blob.slice(entry.dataOffset, entry.dataOffset + entry.compSize);
                if (type === 'blob') return Promise.resolve(slice);
                if (type === 'uint8array') {
                  return slice.arrayBuffer().then(function (b) { return new Uint8Array(b); });
                }
                if (slice.text) return slice.text();
                return slice.arrayBuffer().then(function (b) {
                  return new TextDecoder('utf-8').decode(new Uint8Array(b));
                });
              }
            };
          }
        };
      });
    });
  };
})(window);
