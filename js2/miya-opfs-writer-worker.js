/**
 * Safari / iOS 专用：在 Worker 里用 createSyncAccessHandle 写 OPFS。
 * 主线程 createWritable 在 WebKit 上不可用，必须走这条路径才能写出几百 MB 的单文件 ZIP。
 */
(function () {
  'use strict';

  var handle = null;
  var writePos = 0;
  var fileName = '';

  function respond(msg) {
    self.postMessage(msg);
  }

  function respondError(err) {
    respond({
      type: 'error',
      message: err && err.message ? String(err.message) : String(err || 'opfs_worker_error')
    });
  }

  async function openFile(name) {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      throw new Error('opfs_unavailable');
    }
    fileName = String(name || 'export.zip').replace(/[^\w.\-]+/g, '_').slice(0, 120);
    if (!/\.zip$/i.test(fileName)) fileName += '.zip';

    var root = await navigator.storage.getDirectory();
    var dir = await root.getDirectoryHandle('miya-backup-tmp', { create: true });
    try { await dir.removeEntry(fileName); } catch (e0) {}
    var fh = await dir.getFileHandle(fileName, { create: true });
    if (typeof fh.createSyncAccessHandle !== 'function') {
      throw new Error('sync_access_unavailable');
    }
    handle = await fh.createSyncAccessHandle();
    try { handle.truncate(0); } catch (e1) {}
    writePos = 0;
    respond({ type: 'opened', fileName: fileName });
  }

  function writeBytes(buffer) {
    if (!handle) throw new Error('writer_not_open');
    var u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (!u8.byteLength) return writePos;
    handle.write(u8, { at: writePos });
    writePos += u8.byteLength;
    return writePos;
  }

  function finishWrite() {
    if (!handle) throw new Error('writer_not_open');
    try { handle.flush(); } catch (e0) {}
    try { handle.close(); } catch (e1) {}
    handle = null;
    var doneName = fileName;
    var size = writePos;
    writePos = 0;
    respond({ type: 'finished', fileName: doneName, size: size });
  }

  function abortWrite() {
    if (handle) {
      try { handle.flush(); } catch (e0) {}
      try { handle.close(); } catch (e1) {}
      handle = null;
    }
    writePos = 0;
    respond({ type: 'aborted' });
  }

  self.onmessage = function (ev) {
    var msg = ev.data || {};
    var type = msg.type;
    Promise.resolve().then(function () {
      if (type === 'open') return openFile(msg.fileName);
      if (type === 'write') {
        var size = writeBytes(msg.buffer);
        respond({ type: 'written', size: size, id: msg.id });
        return;
      }
      if (type === 'finish') return finishWrite();
      if (type === 'abort') return abortWrite();
      throw new Error('unknown_cmd');
    }).catch(respondError);
  };
})();
