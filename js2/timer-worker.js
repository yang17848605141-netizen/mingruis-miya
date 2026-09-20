// Background-safe timer using Web Worker.
// Main thread: { type: "start-interval"|"start-timeout", id, ms } | { type: "stop", id } | { type: "stop-all" }
// Worker replies: { type: "tick", id }

var timers = new Map();

self.onmessage = function (e) {
  var type = e.data.type;
  var id = e.data.id;
  var ms = e.data.ms;
  if (type === 'start-interval') {
    if (timers.has(id)) clearInterval(timers.get(id));
    timers.set(id, setInterval(function () { self.postMessage({ type: 'tick', id: id }); }, ms));
  } else if (type === 'start-timeout') {
    if (timers.has(id)) clearTimeout(timers.get(id));
    timers.set(id, setTimeout(function () {
      timers.delete(id);
      self.postMessage({ type: 'tick', id: id });
    }, ms));
  } else if (type === 'stop') {
    if (timers.has(id)) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  } else if (type === 'stop-all') {
    timers.forEach(function (t) { clearTimeout(t); });
    timers.clear();
  }
};
