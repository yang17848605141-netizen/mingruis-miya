/**
 * miya-deep-todo-store.js — 深入 · 角色手机 待办数据
 */
(function (global) {
  'use strict';

  var DB_NAME = 'miya-deep-phone-v1';
  var DB_VERSION = 1;
  var PHONES_STORE = 'phones';

  var dbPromise = null;
  var cache = Object.create(null);

  function todoKey(contactId) {
    return 'todo:' + String(contactId || '').trim();
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
        reject(req.error || new Error('deep_todo_idb_open_failed'));
      };
      req.onblocked = function () {
        settled = true;
        invalidateDb(dbPromise);
        reject(new Error('deep_todo_idb_blocked'));
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

  function defaultTodoData(contactId) {
    return {
      version: 1,
      contactId: String(contactId || ''),
      updatedAt: 0,
      refreshStatus: 'idle',
      refreshMessage: '',
      refreshStartedAt: 0,
      lastRefreshedAt: 0,
      todo: null
    };
  }

  function normalizeTag(raw) {
    var t = String(raw == null ? '' : raw).trim();
    return t || null;
  }

  function normalizeSubtask(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'st-' + (index + 1), text: raw.trim(), done: false };
      }
      return null;
    }
    var text = String(raw.text || raw.title || raw.content || '').trim();
    if (!text) return null;
    return {
      id: String(raw.id || 'st-' + (index + 1)),
      text: text,
      done: !!raw.done
    };
  }

  function normalizeTask(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.text || '').trim();
    if (!title) return null;
    var tags = Array.isArray(raw.tags)
      ? raw.tags.map(normalizeTag).filter(Boolean)
      : [];
    var subtasks = Array.isArray(raw.subtasks)
      ? raw.subtasks.map(normalizeSubtask).filter(Boolean)
      : (Array.isArray(raw.checklist) ? raw.checklist.map(normalizeSubtask).filter(Boolean) : []);
    var priority = String(raw.priority || raw.level || 'soft').trim().toLowerCase();
    if (['urgent', 'soft', 'later', 'secret', 'wish', 'routine'].indexOf(priority) < 0) {
      priority = 'soft';
    }
    var status = String(raw.status || '').trim().toLowerCase();
    if (status !== 'done' && status !== 'paused' && status !== 'open') {
      status = raw.done ? 'done' : 'open';
    }
    var style = String(raw.style || raw.layout || '').trim();
    return {
      id: String(raw.id || 'td-' + (index + 1)),
      title: title,
      when: String(raw.when || raw.time || raw.timeLabel || '').trim(),
      where: String(raw.where || raw.place || raw.location || '').trim(),
      priority: priority,
      status: status,
      energy: String(raw.energy || raw.cost || '').trim(),
      tags: tags,
      detail: String(raw.detail || raw.description || raw.body || '').trim(),
      privateNote: String(raw.privateNote || raw.secret || raw.memo || '').trim(),
      subtasks: subtasks,
      relatedToUser: !!(raw.relatedToUser || raw.withUser || raw.userLink),
      userWhisper: String(raw.userWhisper || raw.whisper || raw.toUser || '').trim(),
      stamp: String(raw.stamp || raw.badge || '').trim(),
      style: style,
      section: String(raw.section || raw.bucket || raw.column || '').trim()
    };
  }

  function normalizeRitual(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || raw.text || '').trim();
    if (!title) return null;
    return {
      id: String(raw.id || 'rt-' + (index + 1)),
      title: title,
      cadence: String(raw.cadence || raw.freq || raw.when || '').trim(),
      note: String(raw.note || raw.detail || '').trim(),
      pinned: !!raw.pinned
    };
  }

  function normalizeSpark(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'sp-' + (index + 1), text: raw.trim(), mood: '' };
      }
      return null;
    }
    var text = String(raw.text || raw.content || raw.title || '').trim();
    if (!text) return null;
    return {
      id: String(raw.id || 'sp-' + (index + 1)),
      text: text,
      mood: String(raw.mood || raw.tag || '').trim()
    };
  }

  function normalizeSealed(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var content = String(raw.content || raw.text || raw.body || '').trim();
    if (!content) return null;
    return {
      id: String(raw.id || 'se-' + (index + 1)),
      title: String(raw.title || raw.label || '密封笺').trim(),
      content: content,
      seal: String(raw.seal || 'SEALED').trim()
    };
  }

  function normalizeColumn(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var title = String(raw.title || raw.name || '').trim();
    if (!title) return null;
    var tasks = Array.isArray(raw.tasks)
      ? raw.tasks.map(normalizeTask).filter(Boolean)
      : [];
    return {
      id: String(raw.id || 'col-' + (index + 1)),
      title: title,
      kicker: String(raw.kicker || raw.label || '').trim(),
      tone: String(raw.tone || '').trim(),
      tasks: tasks
    };
  }

  function normalizeSeed(raw, index) {
    if (!raw || typeof raw !== 'object') {
      if (typeof raw === 'string' && raw.trim()) {
        return { id: 'tm-' + (index + 1), text: raw.trim() };
      }
      return null;
    }
    var text = String(raw.text || raw.title || raw.content || '').trim();
    if (!text) return null;
    return {
      id: String(raw.id || 'tm-' + (index + 1)),
      text: text
    };
  }

  function normalizeTodoPayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var tasks = Array.isArray(raw.tasks)
      ? raw.tasks.map(normalizeTask).filter(Boolean)
      : [];
    var columns = Array.isArray(raw.columns)
      ? raw.columns.map(normalizeColumn).filter(Boolean)
      : [];
    // 若只有 columns 里的 tasks，扁平合并一份供进度统计（不丢弃任何返回）
    if (!tasks.length && columns.length) {
      columns.forEach(function (col) {
        (col.tasks || []).forEach(function (t) { tasks.push(t); });
      });
    }
    var hero = raw.hero && typeof raw.hero === 'object' ? {
      greeting: String(raw.hero.greeting || '').trim(),
      mood: String(raw.hero.mood || raw.hero.status || '').trim(),
      loadLevel: Math.max(0, Math.min(100, Number(raw.hero.loadLevel != null ? raw.hero.loadLevel : raw.hero.load) || 0)),
      loadLabel: String(raw.hero.loadLabel || '').trim(),
      focus: String(raw.hero.focus || raw.hero.mainline || '').trim()
    } : {
      greeting: '',
      mood: '',
      loadLevel: 0,
      loadLabel: '',
      focus: ''
    };
    return {
      dateLabel: String(raw.dateLabel || raw.date || '').trim(),
      caseNo: String(raw.caseNo || raw.fileNo || raw.dossierId || '').trim(),
      hero: hero,
      summary: String(raw.summary || raw.overallNote || raw.note || '').trim(),
      columns: columns,
      tasks: tasks,
      rituals: Array.isArray(raw.rituals) ? raw.rituals.map(normalizeRitual).filter(Boolean) : [],
      inboxSparks: Array.isArray(raw.inboxSparks)
        ? raw.inboxSparks.map(normalizeSpark).filter(Boolean)
        : (Array.isArray(raw.sparks) ? raw.sparks.map(normalizeSpark).filter(Boolean) : []),
      sealedNotes: Array.isArray(raw.sealedNotes)
        ? raw.sealedNotes.map(normalizeSealed).filter(Boolean)
        : (Array.isArray(raw.sealed) ? raw.sealed.map(normalizeSealed).filter(Boolean) : []),
      tomorrowSeeds: Array.isArray(raw.tomorrowSeeds)
        ? raw.tomorrowSeeds.map(normalizeSeed).filter(Boolean)
        : (Array.isArray(raw.tomorrow) ? raw.tomorrow.map(normalizeSeed).filter(Boolean) : []),
      footerNote: String(raw.footerNote || raw.closing || '').trim()
    };
  }

  function normalizeTodoData(raw, contactId) {
    var base = defaultTodoData(contactId);
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
      todo: normalizeTodoPayload(raw.todo)
    };
  }

  function getCached(contactId) {
    var key = todoKey(contactId);
    return cache[key] ? normalizeTodoData(cache[key], contactId) : null;
  }

  function setCached(contactId, data) {
    var key = todoKey(contactId);
    cache[key] = normalizeTodoData(data, contactId);
    return cache[key];
  }

  function getTodo(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(defaultTodoData(''));
    var hit = getCached(id);
    if (hit) return Promise.resolve(hit);
    return idbGet(todoKey(id)).then(function (raw) {
      var data = normalizeTodoData(raw, id);
      setCached(id, data);
      return data;
    }).catch(function () {
      return defaultTodoData(id);
    });
  }

  function saveTodo(contactId, data) {
    var id = String(contactId || '').trim();
    if (!id) return Promise.resolve(null);
    var next = normalizeTodoData(Object.assign({}, data, {
      contactId: id,
      updatedAt: Date.now()
    }), id);
    setCached(id, next);
    return idbPut(todoKey(id), next).then(function () { return next; });
  }

  function patchTodo(contactId, patch) {
    return getTodo(contactId).then(function (cur) {
      return saveTodo(contactId, Object.assign({}, cur, patch || {}));
    });
  }

  global.miyaDeepTodoStore = {
    defaultTodoData: defaultTodoData,
    normalizeTodoData: normalizeTodoData,
    normalizeTodoPayload: normalizeTodoPayload,
    getTodo: getTodo,
    saveTodo: saveTodo,
    patchTodo: patchTodo,
    getCached: getCached
  };
})(typeof window !== 'undefined' ? window : global);
