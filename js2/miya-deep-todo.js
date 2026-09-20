/**
 * miya-deep-todo.js — 深入 · 角色手机 待办（黑白极简 · 局部更新防闪烁）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var PRIORITY_LABEL = {
    urgent: '急',
    soft: '轻',
    later: '后',
    secret: '密',
    wish: '愿',
    routine: '常'
  };

  var FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'urgent', label: '急' },
    { id: 'soft', label: '轻' },
    { id: 'secret', label: '密' },
    { id: 'wish', label: '愿' },
    { id: 'open', label: '未完' },
    { id: 'done', label: '已完' }
  ];

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    todoData: null,
    refreshing: false,
    filter: 'all',
    sheetTaskId: '',
    unsealed: Object.create(null),
    built: false
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function todoStore() { return global.miyaDeepTodoStore || null; }
  function todoBridge() { return global.miyaDeepTodoBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dp-todo-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-todo-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的待办数据');
    statusDotsTimer = setInterval(function () {
      statusDotsFrame = (statusDotsFrame + 1) % 4;
      text.textContent = base + '.'.repeat(statusDotsFrame);
    }, 420);
  }

  function clearSuccessFlash() {
    clearTimeout(successFlashTimer);
    successFlashTimer = 0;
  }

  function showSuccessFlash() {
    clearSuccessFlash();
    updateStatusBar();
    successFlashTimer = setTimeout(function () {
      successFlashTimer = 0;
      updateStatusBar();
    }, 2000);
  }

  function titleRowHtml(dateLabel) {
    return (
      '<div class="dp-todo__title-row">' +
        '<button type="button" class="dp-todo__icon-btn" data-act="todo-back" aria-label="返回">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6 9 12l6 6"/></svg>' +
        '</button>' +
        '<h1 class="dp-todo__mast-date">' + esc(dateLabel || 'Today') + '</h1>' +
        '<button type="button" class="dp-todo__icon-btn" data-act="todo-refresh" id="dp-todo-refresh" aria-label="刷新待办数据">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 7.5A8.5 8.5 0 1 0 21 12"/><path d="M21 3v5h-5"/></svg>' +
        '</button>' +
      '</div>'
    );
  }

  function updateStatusBar() {
    var bar = $('dp-todo-status');
    var text = $('dp-todo-status-text');
    if (!bar || !text) return;
    var data = state.todoData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的待办数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '已成功读取';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-todo__reading';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-todo__reading is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-todo-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.todoData && state.todoData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.todoData && state.todoData.todo ? state.todoData.todo : null;
  }

  function collectAllTasks(todo) {
    if (!todo) return [];
    var list = Array.isArray(todo.tasks) ? todo.tasks.slice() : [];
    if (!list.length && Array.isArray(todo.columns)) {
      todo.columns.forEach(function (col) {
        (col.tasks || []).forEach(function (t) { list.push(t); });
      });
    }
    return list;
  }

  function progressStats(todo) {
    var tasks = collectAllTasks(todo);
    var total = tasks.length;
    var done = 0;
    tasks.forEach(function (t) { if (t && t.status === 'done') done++; });
    return { total: total, done: done, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function findTask(taskId) {
    var todo = getPayload();
    if (!todo) return null;
    var found = null;
    function scan(list) {
      (list || []).forEach(function (t) {
        if (t && t.id === taskId) found = t;
      });
    }
    scan(todo.tasks);
    if (!found && todo.columns) {
      todo.columns.forEach(function (c) { scan(c && c.tasks); });
    }
    return found;
  }

  function persistTodoPayload() {
    var ts = todoStore();
    if (!ts || !state.contactId || !state.todoData) return Promise.resolve(null);
    return ts.patchTodo(state.contactId, { todo: state.todoData.todo }).then(function (saved) {
      state.todoData = saved;
      return saved;
    });
  }

  function matchFilter(task) {
    var f = state.filter;
    if (f === 'all') return true;
    if (f === 'open') return task.status !== 'done';
    if (f === 'done') return task.status === 'done';
    return task.priority === f;
  }

  /* ── 局部更新：进度条 ── */
  function patchProgressOnly() {
    var todo = getPayload();
    if (!todo) return;
    var stats = progressStats(todo);
    var hero = todo.hero || {};
    var load = Math.max(0, Math.min(100, Number(hero.loadLevel) || stats.pct || 0));
    var left = Math.max(0, stats.total - stats.done);
    var fill = document.querySelector('#dp-todo-hero .dp-todo__progress-fill');
    var text = document.querySelector('#dp-todo-hero .dp-todo__progress-text');
    var numDone = document.querySelector('#dp-todo-hero [data-stat="done"]');
    var numLoad = document.querySelector('#dp-todo-hero [data-stat="load"]');
    var numLeft = document.querySelector('#dp-todo-hero [data-stat="left"]');
    if (fill) fill.style.width = stats.pct + '%';
    if (text) text.textContent = stats.done + ' / ' + stats.total;
    if (numDone) numDone.textContent = String(stats.done);
    if (numLoad) numLoad.textContent = String(load);
    if (numLeft) numLeft.textContent = String(left);
  }

  function safeAttrSelector(attr, value) {
    return '[' + attr + '="' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]';
  }

  /* ── 局部更新：单条任务勾选态 ── */
  function patchTaskDoneUI(taskId) {
    var task = findTask(taskId);
    if (!task) return;
    var done = task.status === 'done';
    var item = document.querySelector('#dp-todo-columns ' + safeAttrSelector('data-task-id', taskId));
    if (item) {
      item.classList.toggle('is-done', done);
      var check = item.querySelector('.dp-todo__check');
      if (check) check.classList.toggle('is-on', done);
    }
    if (state.sheetTaskId === taskId) {
      var sheetCheck = document.querySelector('#dp-todo-sheet-panel .dp-todo__check');
      if (sheetCheck) sheetCheck.classList.toggle('is-on', done);
    }
    patchProgressOnly();
    applyFilterVisibility();
  }

  function patchSubDoneUI(taskId, subIndex) {
    var task = findTask(taskId);
    if (!task || !task.subtasks || !task.subtasks[subIndex]) return;
    if (state.sheetTaskId !== taskId) return;
    var btns = document.querySelectorAll('#dp-todo-sheet-panel .dp-todo__sheet-sub');
    var btn = btns[subIndex];
    if (btn) btn.classList.toggle('is-done', !!task.subtasks[subIndex].done);
  }

  function applyFilterVisibility() {
    var items = document.querySelectorAll('#dp-todo-columns [data-task-id]');
    items.forEach(function (el) {
      var id = el.getAttribute('data-task-id');
      var task = findTask(id);
      if (!task) {
        el.hidden = true;
        return;
      }
      el.hidden = !matchFilter(task);
    });
    var chips = document.querySelectorAll('#dp-todo-filters .dp-todo__chip');
    chips.forEach(function (chip) {
      chip.classList.toggle('is-on', chip.getAttribute('data-filter') === state.filter);
    });
  }

  function renderMast(todo) {
    var el = $('dp-todo-hero');
    if (!el) return;
    if (!todo) {
      el.innerHTML =
        titleRowHtml('Today') +
        '<p class="dp-todo__mast-kicker">TODO</p>' +
        '<p class="dp-todo__mast-mood" style="margin:0">点右侧刷新，读取 ta 的今日待办</p>';
      updateRefreshBtn();
      return;
    }
    var hero = todo.hero || {};
    var stats = progressStats(todo);
    var load = Math.max(0, Math.min(100, Number(hero.loadLevel) || stats.pct || 0));
    var left = Math.max(0, stats.total - stats.done);
    var moodLine = hero.mood || hero.greeting || '';
    var focusLine = hero.focus || '';
    var briefHtml = '';
    if (moodLine || focusLine) {
      briefHtml =
        '<div class="dp-todo__brief">' +
          (moodLine
            ? '<div class="dp-todo__brief-row">' +
                '<span class="dp-todo__brief-key">心情</span>' +
                '<p class="dp-todo__mast-mood">' + esc(moodLine) + '</p>' +
              '</div>'
            : '') +
          (moodLine && focusLine ? '<div class="dp-todo__brief-split" aria-hidden="true"></div>' : '') +
          (focusLine
            ? '<div class="dp-todo__brief-row">' +
                '<span class="dp-todo__brief-key">主线</span>' +
                '<p class="dp-todo__mast-focus">' + esc(focusLine) + '</p>' +
              '</div>'
            : '') +
        '</div>';
    }
    el.innerHTML =
      titleRowHtml(todo.dateLabel || '今日') +
      '<p class="dp-todo__mast-kicker">' + esc(todo.caseNo || 'AGENDA') + '</p>' +
      briefHtml +
      '<div class="dp-todo__mosaic">' +
        '<div class="dp-todo__tile dp-todo__tile--hero">' +
          '<span class="dp-todo__tile-label">Load</span>' +
          '<div>' +
            '<div class="dp-todo__tile-num" data-stat="load">' + load + '</div>' +
            '<div class="dp-todo__tile-sub">' + esc(hero.loadLabel || '今日负荷') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="dp-todo__tile dp-todo__tile--a">' +
          '<span class="dp-todo__tile-label">Done</span>' +
          '<div class="dp-todo__tile-num" data-stat="done">' + stats.done + '</div>' +
          '<div class="dp-todo__tile-sub">已完成</div>' +
        '</div>' +
        '<div class="dp-todo__tile dp-todo__tile--b">' +
          '<span class="dp-todo__tile-label">Left</span>' +
          '<div class="dp-todo__tile-num" data-stat="left">' + left + '</div>' +
          '<div class="dp-todo__tile-sub">剩余</div>' +
        '</div>' +
      '</div>' +
      '<div class="dp-todo__progress">' +
        '<div class="dp-todo__progress-track"><span class="dp-todo__progress-fill" style="width:' + stats.pct + '%"></span></div>' +
        '<span class="dp-todo__progress-text">' + stats.done + ' / ' + stats.total + '</span>' +
      '</div>' +
      (todo.summary ? '<p class="dp-todo__mast-note">' + esc(todo.summary) + '</p>' : '');
    updateRefreshBtn();
  }

  function renderFilters(todo) {
    var el = $('dp-todo-filters');
    if (!el) return;
    var tasks = collectAllTasks(todo);
    if (!tasks.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = FILTERS.map(function (f) {
      return (
        '<button type="button" class="dp-todo__chip' + (state.filter === f.id ? ' is-on' : '') + '" data-act="filter" data-filter="' + f.id + '">' +
          esc(f.label) +
        '</button>'
      );
    }).join('');
  }

  function renderStream(todo) {
    var el = $('dp-todo-columns');
    if (!el) return;
    var tasks = collectAllTasks(todo);
    if (!tasks.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var html = tasks.map(function (task, i) {
      var done = task.status === 'done';
      var pri = task.priority || 'soft';
      var accent = pri === 'urgent' || pri === 'secret';
      var hidden = matchFilter(task) ? '' : ' hidden';
      return (
        '<li class="dp-todo__item' + (done ? ' is-done' : '') + '"' + hidden + ' data-task-id="' + esc(task.id) + '" data-priority="' + esc(pri) + '">' +
          '<div class="dp-todo__item-rail"><span class="dp-todo__item-dot" aria-hidden="true"></span></div>' +
          '<div class="dp-todo__card' + (accent && !done ? ' is-accent' : '') + '">' +
            '<button type="button" class="dp-todo__check' + (done ? ' is-on' : '') + '" data-act="toggle" data-task="' + esc(task.id) + '" aria-label="勾选">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>' +
            '</button>' +
            '<button type="button" class="dp-todo__card-main" data-act="open-sheet" data-task="' + esc(task.id) + '">' +
              '<div class="dp-todo__card-meta">' +
                (task.when ? '<span>' + esc(task.when) + '</span>' : '') +
                '<span>' + esc(PRIORITY_LABEL[pri] || pri) + '</span>' +
                (task.energy ? '<span>' + esc(task.energy) + '</span>' : '') +
              '</div>' +
              '<h3 class="dp-todo__card-title">' + esc(task.title) + '</h3>' +
              (task.where ? '<p class="dp-todo__card-where">' + esc(task.where) + '</p>' : '') +
            '</button>' +
          '</div>' +
        '</li>'
      );
    }).join('');
    el.innerHTML =
      '<div class="dp-todo__stream-head"><h2>Schedule</h2><span>' + tasks.length + ' items</span></div>' +
      '<ul class="dp-todo__stream-list">' + html + '</ul>';
  }

  function renderOrbit(todo) {
    var el = $('dp-todo-rituals');
    if (!el) return;
    var items = todo && todo.rituals || [];
    if (!items.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<p class="dp-todo__sec-title">仪式</p>' +
      '<div class="dp-todo__orbit-track">' +
        items.map(function (r, i) {
          return (
            '<button type="button" class="dp-todo__orbit-item' + (r.pinned ? ' is-pinned' : '') + '" data-act="pin-ritual" data-idx="' + i + '">' +
              '<strong>' + esc(r.title) + '</strong>' +
              (r.cadence ? '<em>' + esc(r.cadence) + '</em>' : '') +
              (r.note ? '<p>' + esc(r.note) + '</p>' : '') +
            '</button>'
          );
        }).join('') +
      '</div>';
  }

  function renderMargin(todo) {
    var el = $('dp-todo-sparks');
    if (!el) return;
    var items = todo && todo.inboxSparks || [];
    if (!items.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<p class="dp-todo__sec-title">闪念</p>' +
      '<div class="dp-todo__spark-list">' +
        items.map(function (s) {
          return (
            '<div class="dp-todo__spark">' +
              (s.mood ? '<span>' + esc(s.mood) + '</span>' : '') +
              '<p>' + esc(s.text) + '</p>' +
            '</div>'
          );
        }).join('') +
      '</div>';
  }

  function renderEnvelopes(todo) {
    var el = $('dp-todo-sealed');
    if (!el) return;
    var items = todo && todo.sealedNotes || [];
    if (!items.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<p class="dp-todo__sec-title">密封</p>' +
      items.map(function (n) {
        var open = !!state.unsealed[n.id];
        return (
          '<button type="button" class="dp-todo__env' + (open ? ' is-open' : '') + '" data-act="unseal" data-id="' + esc(n.id) + '">' +
            '<strong>' + esc(n.title) + '</strong>' +
            '<p data-sealed-body="' + esc(n.id) + '">' + (open ? esc(n.content) : '轻触查看') + '</p>' +
          '</button>'
        );
      }).join('');
  }

  function patchUnsealUI(id) {
    var open = !!state.unsealed[id];
    var btn = document.querySelector('#dp-todo-sealed [data-id="' + String(id).replace(/"/g, '\\"') + '"]');
    if (!btn) return;
    btn.classList.toggle('is-open', open);
    var todo = getPayload();
    var note = null;
    (todo && todo.sealedNotes || []).forEach(function (n) {
      if (n && n.id === id) note = n;
    });
    var p = btn.querySelector('p');
    if (p && note) p.textContent = open ? note.content : '轻触查看';
  }

  function patchPinRitualUI(idx) {
    var todo = getPayload();
    if (!todo || !todo.rituals || !todo.rituals[idx]) return;
    var items = document.querySelectorAll('#dp-todo-rituals .dp-todo__orbit-item');
    var btn = items[idx];
    if (btn) btn.classList.toggle('is-pinned', !!todo.rituals[idx].pinned);
  }

  function renderDawn(todo) {
    var el = $('dp-todo-seeds');
    if (!el) return;
    var items = todo && todo.tomorrowSeeds || [];
    if (!items.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML =
      '<p class="dp-todo__sec-title">明日</p>' +
      '<ol>' + items.map(function (s) {
        return '<li>' + esc(s.text) + '</li>';
      }).join('') + '</ol>';
  }

  function renderSign(todo) {
    var el = $('dp-todo-footer');
    if (!el) return;
    if (!todo || !todo.footerNote) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = '<p>' + esc(todo.footerNote) + '</p>';
  }

  function renderSheet() {
    var sheet = $('dp-todo-sheet');
    var panel = $('dp-todo-sheet-panel');
    if (!sheet || !panel) return;
    var task = state.sheetTaskId ? findTask(state.sheetTaskId) : null;
    if (!task) {
      sheet.hidden = true;
      return;
    }
    var tags = (task.tags || []).map(function (t) {
      return '<span>' + esc(t) + '</span>';
    }).join('');
    var subs = (task.subtasks || []).map(function (st, i) {
      return (
        '<button type="button" class="dp-todo__sheet-sub' + (st.done ? ' is-done' : '') + '" data-act="sub" data-task="' + esc(task.id) + '" data-sub="' + i + '">' +
          '<i aria-hidden="true"></i>' + esc(st.text) +
        '</button>'
      );
    }).join('');
    panel.innerHTML =
      '<div class="dp-todo__sheet-handle" aria-hidden="true"></div>' +
      '<div class="dp-todo__sheet-head">' +
        '<h3>' + esc(task.title) + '</h3>' +
        '<button type="button" class="dp-todo__check' + (task.status === 'done' ? ' is-on' : '') + '" data-act="toggle" data-task="' + esc(task.id) + '" aria-label="勾选">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="dp-todo__sheet-meta">' +
        (task.when ? '<span>' + esc(task.when) + '</span>' : '') +
        (task.where ? '<span>' + esc(task.where) + '</span>' : '') +
        (task.energy ? '<span>' + esc(task.energy) + '</span>' : '') +
        '<span>' + esc(PRIORITY_LABEL[task.priority] || task.priority || '') + '</span>' +
      '</div>' +
      (tags ? '<div class="dp-todo__sheet-tags">' + tags + '</div>' : '') +
      (task.detail ? '<p class="dp-todo__sheet-detail">' + esc(task.detail) + '</p>' : '') +
      (subs ? '<div class="dp-todo__sheet-subs">' + subs + '</div>' : '') +
      (task.relatedToUser && task.userWhisper
        ? '<div class="dp-todo__sheet-whisper"><span>WHISPER</span><p>' + esc(task.userWhisper) + '</p></div>'
        : '') +
      (task.privateNote ? '<p class="dp-todo__sheet-private">' + esc(task.privateNote) + '</p>' : '');
    sheet.hidden = false;
  }

  function closeSheet() {
    state.sheetTaskId = '';
    var sheet = $('dp-todo-sheet');
    if (sheet) sheet.hidden = true;
  }

  function renderEmpty(hasData) {
    var empty = $('dp-todo-empty');
    if (!empty) return;
    empty.hidden = !!hasData;
  }

  /** 仅在打开 / 刷新成功时整页构建一次 */
  function buildFullUI() {
    var todo = getPayload();
    var has = !!(todo && (
      collectAllTasks(todo).length ||
      (todo.rituals && todo.rituals.length) ||
      (todo.inboxSparks && todo.inboxSparks.length) ||
      (todo.sealedNotes && todo.sealedNotes.length) ||
      todo.summary
    ));
    renderMast(todo);
    renderFilters(todo);
    renderStream(todo);
    renderOrbit(todo);
    renderMargin(todo);
    renderEnvelopes(todo);
    renderDawn(todo);
    renderSign(todo);
    renderEmpty(has);
    if (state.sheetTaskId) renderSheet();
    else closeSheet();
    state.built = true;
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadTodoData(contactId) {
    var ts = todoStore();
    if (!ts) return Promise.resolve(null);
    return ts.getTodo(contactId).then(function (data) {
      state.todoData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-todo-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = todoStore();
    var br = todoBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchTodo(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的待办数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.todoData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
      }
      return br.generateTodo(contactId, phoneData, {});
    }).then(function (result) {
      state.sheetTaskId = '';
      state.filter = 'all';
      state.unsealed = Object.create(null);
      return ts.patchTodo(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        todo: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.todoData = saved;
        state.refreshing = false;
        if (state.open) {
          buildFullUI();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ts.patchTodo(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.todoData = saved;
          state.refreshing = false;
          if (state.open) {
            updateStatusBar();
            updateRefreshBtn();
          }
        }
        dispatchUpdated(contactId);
        throw err;
      });
    });

    activeJobs[contactId] = job;
    return job;
  }

  function handleRefresh() {
    if (!state.contactId) return;
    if (state.refreshing || (state.todoData && state.todoData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function handleToggleTask(taskId) {
    var task = findTask(taskId);
    if (!task) return;
    task.status = task.status === 'done' ? 'open' : 'done';
    patchTaskDoneUI(taskId);
    persistTodoPayload();
  }

  function handleToggleSub(taskId, subIndex) {
    var task = findTask(taskId);
    if (!task || !task.subtasks || !task.subtasks[subIndex]) return;
    task.subtasks[subIndex].done = !task.subtasks[subIndex].done;
    patchSubDoneUI(taskId, subIndex);
    persistTodoPayload();
  }

  function handlePinRitual(idx) {
    var todo = getPayload();
    if (!todo || !todo.rituals || !todo.rituals[idx]) return;
    todo.rituals[idx].pinned = !todo.rituals[idx].pinned;
    patchPinRitualUI(idx);
    persistTodoPayload();
  }

  function onRootClick(ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!btn) return;
    ev.preventDefault();
    var act = btn.getAttribute('data-act');
    var taskId = btn.getAttribute('data-task');
    if (act === 'toggle') handleToggleTask(taskId);
    else if (act === 'todo-back') close();
    else if (act === 'todo-refresh') handleRefresh();
    else if (act === 'open-sheet') {
      state.sheetTaskId = taskId;
      renderSheet();
    } else if (act === 'sheet-close') {
      closeSheet();
    } else if (act === 'sub') handleToggleSub(taskId, Number(btn.getAttribute('data-sub')));
    else if (act === 'unseal') {
      var id = btn.getAttribute('data-id');
      state.unsealed[id] = !state.unsealed[id];
      patchUnsealUI(id);
    } else if (act === 'pin-ritual') handlePinRitual(Number(btn.getAttribute('data-idx')));
    else if (act === 'filter') {
      state.filter = btn.getAttribute('data-filter') || 'all';
      applyFilterVisibility();
    }
  }

  function bindEvents() {
    var root = $('dp-todo');
    if (!root || root._dpTodoBound) return;
    root._dpTodoBound = true;

    root.addEventListener('click', onRootClick);

    global.addEventListener('miya-deep-todo-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      // 仅当本端无 active job 时同步（避免刷新过程二次整页闪）
      if (activeJobs[cid] || state.refreshing) return;
      loadTodoData(cid).then(function () { buildFullUI(); });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-todo');
    if (!layer) return;
    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.refreshing = !!activeJobs[state.contactId];
    layer.removeAttribute('hidden');
    requestAnimationFrame(function () { layer.classList.add('is-open'); });
    loadTodoData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          todoStore().patchTodo(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.todoData = fixed;
            buildFullUI();
          });
          return;
        }
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      buildFullUI();
    });
  }

  function close() {
    var layer = $('dp-todo');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    closeSheet();
    state.open = false;
    layer.classList.remove('is-open');
    layer.setAttribute('hidden', '');
  }

  function init() {
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.miyaDeepTodo = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
