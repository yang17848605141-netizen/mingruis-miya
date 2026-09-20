/**
 * Background-safe timers via Web Worker; falls back to native setInterval/setTimeout.
 */
(function (global) {
  'use strict';

  var worker = null;
  var callbacks = new Map();
  var idCounter = 0;

  function ensureWorker() {
    if (worker) return worker;
    if (typeof Worker === 'undefined') return null;
    try {
      worker = new Worker('js2/timer-worker.js');
      worker.onmessage = function (e) {
        if (e.data && e.data.type === 'tick') {
          var cb = callbacks.get(e.data.id);
          if (cb) cb();
        }
      };
      worker.onerror = function () { worker = null; };
      return worker;
    } catch (err) {
      return null;
    }
  }

  function bgSetInterval(callback, ms) {
    var w = ensureWorker();
    var id = 'bgi_' + (++idCounter);
    if (w) {
      callbacks.set(id, callback);
      w.postMessage({ type: 'start-interval', id: id, ms: ms });
      return function stop() {
        callbacks.delete(id);
        w.postMessage({ type: 'stop', id: id });
      };
    }
    var nativeId = setInterval(callback, ms);
    return function stop() { clearInterval(nativeId); };
  }

  global.miyaBgSetInterval = bgSetInterval;
})(typeof window !== 'undefined' ? window : self);
