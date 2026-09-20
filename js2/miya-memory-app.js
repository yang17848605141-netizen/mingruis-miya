/**
 * miya-memory-app.js — 各角色对话记忆总结 · 漫画阅览室
 * 分镜/合卷（MiyaChatSummary）与角色记忆提炼（MiyaChatMemoryExtract）并列展示
 */
(function (global) {
  'use strict';

  var selectedChatId = null;
  /** @type {{ type: 'sum'|'mega'|'cmem', id: string }|null} */
  var editingClip = null;

  function $(id) { return document.getElementById(id); }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('miya-mem-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function voidHtml(lines) {
    var text = Array.isArray(lines) ? lines.join('<br>') : String(lines || '');
    return '<div class="mm-void">' + text + '</div>';
  }

  function ensureStore() {
    if (global.miyaChatContactsSync && global.miyaChatContactsSync.ensureBootstrap) {
      return global.miyaChatContactsSync.ensureBootstrap();
    }
    var chain = Promise.resolve();
    if (global.miyaContactsStore && global.miyaContactsStore.whenReady) {
      chain = chain.then(function () { return global.miyaContactsStore.whenReady(); });
    }
    if (global.miyaChatStore && global.miyaChatStore.init) {
      chain = chain.then(function () { return global.miyaChatStore.init(); });
    }
    if (global.miyaChatContactsSync && global.miyaChatContactsSync.syncAll) {
      chain = chain.then(function () {
        return global.miyaChatContactsSync.syncAll({ prune: false });
      });
    }
    return chain;
  }

  function renderRoleList() {
    var list = $('miya-mem-roles');
    if (!list) return;
    var st = global.miyaChatStore;
    if (!st) {
      list.innerHTML = '<p class="mm-index__hint">载入中…</p>';
      return;
    }
    var chats = st.getChats('all').slice().filter(function (chat) {
      return chat && chat.type !== 'group';
    }).sort(function (a, b) {
      return (b.lastAt || 0) - (a.lastAt || 0);
    });
    if (!chats.length) {
      list.innerHTML = '<p class="mm-index__hint">暂无会话<br>先在聊天中添加联系人</p>';
      return;
    }
    list.innerHTML =
      '<div class="mm-index__track">' +
      chats
        .map(function (chat, idx) {
          var contact = st.findContact(chat.contactId);
          var name = (contact && (contact.remarkName || contact.name)) || '未命名';
          var settings = st.getChatSettings(chat.id);
          var sumCount = (settings.summaryList || []).length;
          var megaCount = (settings.megaSummaryList || []).length;
          var memCount = (settings.charMemoryList || []).length;
          var memTrigger = settings.memoryAutoRoundTrigger != null ? settings.memoryAutoRoundTrigger : 0;
          var memChip =
            memTrigger > 0
              ? '<em class="mm-ticket__chip mm-ticket__chip--auto">记忆' + memTrigger + '轮</em>'
              : '';
          var active = selectedChatId === chat.id ? ' is-active' : '';
          var num = String(idx + 1).padStart(2, '0');
          return (
            '<button type="button" class="mm-ticket' +
            active +
            '" data-mem-chat="' +
            esc(chat.id) +
            '" data-mm-idx="' +
            num +
            '">' +
            '<span class="mm-ticket__name">' +
            esc(name) +
            '</span>' +
            '<span class="mm-ticket__meta">' +
            memChip +
            '<em class="mm-ticket__chip">分镜 ' +
            sumCount +
            '</em>' +
            '<em class="mm-ticket__chip mm-ticket__chip--mega">合卷 ' +
            megaCount +
            '</em>' +
            '<em class="mm-ticket__chip mm-ticket__chip--char">忆 ' +
            memCount +
            '</em>' +
            '</span>' +
            '</button>'
          );
        })
        .join('') +
      '</div>';
    enableRoleStripScroll();
  }

  function emptyInline(text) {
    return '<p class="mm-empty">' + esc(text) + '</p>';
  }

  function escTextarea(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function clipHeadActions(editAttr, delAttr, id, extraTag) {
    return (extraTag || '') +
      '<span class="mm-clip__acts">' +
        '<button type="button" class="mm-clip__edit" ' + editAttr + '="' + esc(id) + '">编辑</button>' +
        '<button type="button" class="mm-clip__del" ' + delAttr + '="' + esc(id) + '">删除</button>' +
      '</span>';
  }

  function renderClipContent(row, type, id) {
    if (editingClip && editingClip.type === type && editingClip.id === id) {
      return '<div class="mm-clip__edit-wrap">' +
        '<textarea class="mm-clip__textarea" id="miya-mem-edit-area" rows="8">' +
          escTextarea(row.content || '') +
        '</textarea>' +
        '<div class="mm-clip__edit-actions">' +
          '<button type="button" class="mm-btn mm-btn--fill" data-save-edit="' + esc(type) + '" data-edit-id="' + esc(id) + '">保存</button>' +
          '<button type="button" class="mm-btn" data-cancel-edit>取消</button>' +
        '</div>' +
      '</div>';
    }
    return '<div class="mm-clip__body">' + esc(row.content || '').replace(/\n/g, '<br>') + '</div>';
  }

  function buildTimelineCards(items, opts) {
    if (!items.length) {
      return emptyInline(opts.emptyLabel);
    }
    var html = '<div class="mm-timeline">';
    items.forEach(function (block, i) {
      if (i > 0) {
        html += '<span class="mm-clip__connector" aria-hidden="true"></span>';
      }
      html += block;
    });
    html += '</div>';
    return html;
  }

  function renderSummaryDetail(chatId) {
    var panel = $('miya-mem-detail');
    if (!panel) return;
    var st = global.miyaChatStore;
    if (!st || !chatId) {
      panel.innerHTML = voidHtml(['选择左侧票根', '阅览分镜、合卷与角色记忆']);
      return;
    }
    var chat = st.findChat(chatId);
    var contact = chat && st.findContact(chat.contactId);
    var name = (contact && (contact.remarkName || contact.name)) || '未命名';
    var settings = st.getChatSettings(chatId);
    var historyLen = st.getMessages(chatId).length;
    var sumList = settings.summaryList || [];
    var megaList = settings.megaSummaryList || [];
    var charMemList = settings.charMemoryList || [];

    var sumMod = global.MiyaChatSummary;
    var covered = sumMod && sumMod.summaryIdsCoveredByMega
      ? sumMod.summaryIdsCoveredByMega(megaList) : {};

    var memMod = global.MiyaChatMemoryExtract;
    var memTrigger = settings.memoryAutoRoundTrigger != null ? settings.memoryAutoRoundTrigger : 0;
    var lastMemEnd = memMod && memMod.lastCharMemoryEnd ? memMod.lastCharMemoryEnd(settings) : 0;
    var pendingRounds = memMod && memMod.countAssistantRounds
      ? memMod.countAssistantRounds(st.getMessages(chatId), lastMemEnd) : 0;

    var sumBlocks = sumList.map(function (row, i) {
      var coveredTag = covered[row.id]
        ? '<em class="mm-tag">已并入合卷</em>' : '';
      return '<article class="mm-clip" data-sum-id="' + esc(row.id) + '">' +
        '<header class="mm-clip__head">' +
          '<strong>§' + (i + 1) + ' · 第 ' + row.startIndex + '–' + row.endIndex + ' 条</strong>' +
          coveredTag +
          clipHeadActions('data-edit-sum', 'data-del-sum', row.id) +
        '</header>' +
        renderClipContent(row, 'sum', row.id) +
      '</article>';
    });

    var megaBlocks = megaList.map(function (row, i) {
      return '<article class="mm-clip mm-clip--mega" data-mega-id="' + esc(row.id) + '">' +
        '<header class="mm-clip__head">' +
          '<strong>合卷 · 第 ' + (i + 1) + ' 幕</strong>' +
          clipHeadActions('data-edit-mega', 'data-del-mega', row.id) +
        '</header>' +
        renderClipContent(row, 'mega', row.id) +
      '</article>';
    });

    var charMemBlocks = charMemList.map(function (row, i) {
      return '<article class="mm-clip mm-clip--char" data-cmem-id="' + esc(row.id) + '">' +
        '<header class="mm-clip__head">' +
          '<strong>忆 · 第 ' + row.startIndex + '–' + row.endIndex + ' 条</strong>' +
          clipHeadActions('data-edit-cmem', 'data-del-cmem', row.id) +
        '</header>' +
        renderClipContent(row, 'cmem', row.id) +
      '</article>';
    });

    panel.innerHTML =
      '<header class="mm-hero">' +
        '<h2 class="mm-hero__name">' + esc(name) + '</h2>' +
        '<p class="mm-hero__stats">' +
          '<span class="mm-hero__stat">消息<em>' + historyLen + '</em></span>' +
          '<span class="mm-hero__stat">分镜<em>' + sumList.length + '</em></span>' +
          '<span class="mm-hero__stat">合卷<em>' + megaList.length + '</em></span>' +
          '<span class="mm-hero__stat">角色记忆<em>' + charMemList.length + '</em></span>' +
        '</p>' +
      '</header>' +
      '<section class="mm-console mm-console--auto" aria-label="角色记忆自动提炼">' +
        '<span class="mm-console__label">记忆提炼</span>' +
        '<div class="mm-console__row">' +
          '<label class="mm-console__field mm-console__field--wide">每<input type="number" id="miya-mem-auto-trigger" min="0" max="500" value="' + memTrigger + '">轮对话</label>' +
          '<div class="mm-console__actions">' +
            '<button type="button" class="mm-btn mm-btn--fill" id="miya-mem-save-auto">保存</button>' +
          '</div>' +
        '</div>' +
        '<p class="mm-console__hint">' +
          (memTrigger > 0
            ? '已开启：每完成 ' + memTrigger + ' 轮角色回复后，自动提炼该段对话中对角色重要的记忆（进度 ' + pendingRounds + '/' + memTrigger + ' 轮）。与上方「分镜/合卷」总结互不影响。'
            : '设为 0 关闭。与聊天设置里的「自动总结触发」无关；此处仅控制角色记忆提炼。') +
        '</p>' +
      '</section>' +
      '<section class="mm-console" aria-label="提炼分镜与合卷">' +
        '<span class="mm-console__label">提炼台</span>' +
        '<div class="mm-console__row">' +
          '<label class="mm-console__field">起始<input type="number" id="miya-mem-sum-start" min="1" max="' + historyLen + '" value="1"></label>' +
          '<label class="mm-console__field">结束<input type="number" id="miya-mem-sum-end" min="1" max="' + historyLen + '" value="' + historyLen + '"></label>' +
          '<div class="mm-console__actions">' +
            '<button type="button" class="mm-btn mm-btn--fill" id="miya-mem-run-sum">生成分镜</button>' +
            '<button type="button" class="mm-btn" id="miya-mem-run-mega">生成合卷</button>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="mm-chapter">' +
        '<div class="mm-chapter__head">' +
          '<span class="mm-chapter__no">01</span>' +
          '<h3 class="mm-chapter__title">分镜</h3>' +
          '<span class="mm-chapter__sub">' + sumList.length + ' 则 · 对话总结</span>' +
        '</div>' +
        buildTimelineCards(sumBlocks, { emptyLabel: '尚无分镜' }) +
      '</section>' +
      '<section class="mm-chapter">' +
        '<div class="mm-chapter__head">' +
          '<span class="mm-chapter__no">02</span>' +
          '<h3 class="mm-chapter__title">合卷</h3>' +
          '<span class="mm-chapter__sub">' + megaList.length + ' 卷 · 分镜合并</span>' +
        '</div>' +
        buildTimelineCards(megaBlocks, { emptyLabel: '尚无合卷' }) +
      '</section>' +
      '<section class="mm-chapter">' +
        '<div class="mm-chapter__head">' +
          '<span class="mm-chapter__no">03</span>' +
          '<h3 class="mm-chapter__title">角色记忆</h3>' +
          '<span class="mm-chapter__sub">' + charMemList.length + ' 条 · 自动/角色视角</span>' +
        '</div>' +
        buildTimelineCards(charMemBlocks, { emptyLabel: '尚无角色记忆' }) +
      '</section>';
  }

  var roleStripScrollBound = false;

  function enableRoleStripScroll() {
    var el = $('miya-mem-roles');
    if (!el) return;
    if (!roleStripScrollBound) {
      roleStripScrollBound = true;
      var dragging = false;
      var moved = false;
      var startX = 0;
      var startScroll = 0;
      el.addEventListener(
        'touchstart',
        function (e) {
          if (e.touches.length !== 1) return;
          dragging = false;
          moved = false;
          startX = e.touches[0].clientX;
          startScroll = el.scrollLeft;
        },
        { passive: true }
      );
      el.addEventListener(
        'touchmove',
        function (e) {
          if (e.touches.length !== 1) return;
          var dx = e.touches[0].clientX - startX;
          if (!dragging) {
            if (Math.abs(dx) < 6) return;
            dragging = true;
            moved = true;
          }
          el.scrollLeft = startScroll - dx;
          if (e.cancelable) e.preventDefault();
        },
        { passive: false }
      );
      el.addEventListener(
        'touchend',
        function () {
          if (moved) el.dataset.mmDragged = '1';
          dragging = false;
          setTimeout(function () {
            delete el.dataset.mmDragged;
          }, 120);
        },
        { passive: true }
      );
    }
    requestAnimationFrame(function () {
      if (!selectedChatId || !el.querySelector) return;
      var active = el.querySelector('.mm-ticket.is-active');
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
      }
    });
  }

  function bindEvents() {
    var app = $('miya-memory-app');
    if (!app || app.dataset.bound) return;
    app.dataset.bound = '1';

    $('miya-mem-back').addEventListener('click', closeMemoryApp);

    app.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var roleBtn = t.closest('[data-mem-chat]');
      if (roleBtn) {
        var rolesEl = $('miya-mem-roles');
        if (rolesEl && rolesEl.dataset.mmDragged) return;
        editingClip = null;
        selectedChatId = roleBtn.getAttribute('data-mem-chat');
        renderRoleList();
        renderSummaryDetail(selectedChatId);
        return;
      }
      if (t.id === 'miya-mem-run-sum' || t.closest('#miya-mem-run-sum')) {
        runSummary();
        return;
      }
      if (t.id === 'miya-mem-save-auto' || t.closest('#miya-mem-save-auto')) {
        saveAutoMemoryTrigger();
        return;
      }
      if (t.id === 'miya-mem-run-mega' || t.closest('#miya-mem-run-mega')) {
        runMegaSummary();
        return;
      }
      var editSum = t.closest('[data-edit-sum]');
      if (editSum) {
        startEditClip('sum', editSum.getAttribute('data-edit-sum'));
        return;
      }
      var editMega = t.closest('[data-edit-mega]');
      if (editMega) {
        startEditClip('mega', editMega.getAttribute('data-edit-mega'));
        return;
      }
      var editCmem = t.closest('[data-edit-cmem]');
      if (editCmem) {
        startEditClip('cmem', editCmem.getAttribute('data-edit-cmem'));
        return;
      }
      if (t.closest('[data-cancel-edit]')) {
        cancelEditClip();
        return;
      }
      var saveEdit = t.closest('[data-save-edit]');
      if (saveEdit) {
        saveEditClip(saveEdit.getAttribute('data-save-edit'), saveEdit.getAttribute('data-edit-id'));
        return;
      }
      var delSum = t.closest('[data-del-sum]');
      if (delSum) {
        deleteSummary(delSum.getAttribute('data-del-sum'));
        return;
      }
      var delMega = t.closest('[data-del-mega]');
      if (delMega) {
        deleteMegaSummary(delMega.getAttribute('data-del-mega'));
        return;
      }
      var delCmem = t.closest('[data-del-cmem]');
      if (delCmem) {
        deleteCharMemory(delCmem.getAttribute('data-del-cmem'));
      }
    });
  }

  function startEditClip(type, id) {
    if (!selectedChatId || !id) return;
    editingClip = { type: type, id: String(id) };
    renderSummaryDetail(selectedChatId);
    var area = $('miya-mem-edit-area');
    if (area) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
  }

  function cancelEditClip() {
    editingClip = null;
    if (selectedChatId) renderSummaryDetail(selectedChatId);
  }

  function saveEditClip(type, id) {
    if (!selectedChatId || !id) return;
    var st = global.miyaChatStore;
    if (!st) return;
    var area = $('miya-mem-edit-area');
    var text = area ? String(area.value || '').trim() : '';
    if (!text) {
      toast('内容不能为空');
      return;
    }
    var settings = st.getChatSettings(selectedChatId);
    var patch = {};
    if (type === 'sum') {
      patch.summaryList = (settings.summaryList || []).map(function (r) {
        return r.id === id ? Object.assign({}, r, { content: text, updatedAt: Date.now() }) : r;
      });
    } else if (type === 'mega') {
      patch.megaSummaryList = (settings.megaSummaryList || []).map(function (r) {
        return r.id === id ? Object.assign({}, r, { content: text, updatedAt: Date.now() }) : r;
      });
    } else if (type === 'cmem') {
      patch.charMemoryList = (settings.charMemoryList || []).map(function (r) {
        return r.id === id ? Object.assign({}, r, { content: text, updatedAt: Date.now() }) : r;
      });
    } else {
      return;
    }
    st.saveChatSettings(selectedChatId, patch).then(function () {
      editingClip = null;
      toast('已保存');
      renderSummaryDetail(selectedChatId);
      renderRoleList();
    });
  }

  function deleteSummary(sumId) {
    if (!selectedChatId) return;
    if (editingClip && editingClip.id === sumId) editingClip = null;
    var st = global.miyaChatStore;
    if (!st) return;
    var settings = st.getChatSettings(selectedChatId);
    var list = (settings.summaryList || []).filter(function (r) { return r.id !== sumId; });
    st.saveChatSettings(selectedChatId, { summaryList: list }).then(function () {
      renderSummaryDetail(selectedChatId);
      renderRoleList();
    });
  }

  function deleteMegaSummary(megaId) {
    if (!selectedChatId) return;
    if (editingClip && editingClip.id === megaId) editingClip = null;
    var st = global.miyaChatStore;
    if (!st) return;
    var settings = st.getChatSettings(selectedChatId);
    var list = (settings.megaSummaryList || []).filter(function (r) { return r.id !== megaId; });
    st.saveChatSettings(selectedChatId, { megaSummaryList: list }).then(function () {
      renderSummaryDetail(selectedChatId);
      renderRoleList();
    });
  }

  function deleteCharMemory(memId) {
    if (!selectedChatId) return;
    if (editingClip && editingClip.id === memId) editingClip = null;
    var st = global.miyaChatStore;
    if (!st) return;
    var settings = st.getChatSettings(selectedChatId);
    var list = (settings.charMemoryList || []).filter(function (r) { return r.id !== memId; });
    st.saveChatSettings(selectedChatId, { charMemoryList: list }).then(function () {
      renderSummaryDetail(selectedChatId);
      renderRoleList();
    });
  }

  function saveAutoMemoryTrigger() {
    if (!selectedChatId) return;
    var st = global.miyaChatStore;
    if (!st) return;
    var input = $('miya-mem-auto-trigger');
    var raw = input ? parseInt(input.value, 10) : 0;
    var val = Number.isFinite(raw) ? Math.min(500, Math.max(0, raw)) : 0;
    st.saveChatSettings(selectedChatId, { memoryAutoRoundTrigger: val }).then(function () {
      toast(val > 0 ? '已设置每 ' + val + ' 轮自动提炼角色记忆' : '已关闭角色记忆自动提炼');
      renderSummaryDetail(selectedChatId);
      renderRoleList();
    });
  }

  function runSummary() {
    if (!selectedChatId || !global.MiyaChatSummary) return;
    var start = parseInt(($('miya-mem-sum-start') || {}).value, 10) || 1;
    var end = parseInt(($('miya-mem-sum-end') || {}).value, 10) || 1;
    toast('正在生成分镜…');
    global.MiyaChatSummary.performSummary(selectedChatId, { start: start, end: end })
      .then(function (ok) {
        if (ok) toast('分镜完成');
        renderSummaryDetail(selectedChatId);
        renderRoleList();
      });
  }

  function runMegaSummary() {
    if (!selectedChatId || !global.MiyaChatSummary) return;
    var st = global.miyaChatStore;
    if (!st) return;
    var settings = st.getChatSettings(selectedChatId);
    var list = settings.summaryList || [];
    var sumMod = global.MiyaChatSummary;
    var covered = sumMod && sumMod.summaryIdsCoveredByMega
      ? sumMod.summaryIdsCoveredByMega(settings.megaSummaryList || []) : {};
    var indices = [];
    list.forEach(function (row, i) {
      if (!row || !row.id || covered[row.id]) return;
      indices.push(i);
    });
    if (!indices.length) {
      toast('没有可合并的分镜');
      return;
    }
    toast('正在生成合卷…');
    global.MiyaChatSummary.performMegaSummary(selectedChatId, { sourceIndices: indices })
      .then(function (ok) {
        if (ok) toast('合卷完成');
        renderSummaryDetail(selectedChatId);
        renderRoleList();
      });
  }

  function openMemoryApp() {
    var el = $('miya-memory-app');
    if (!el) return;
    ensureStore().then(function () {
      selectedChatId = null;
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      requestAnimationFrame(function () {
        renderRoleList();
        renderSummaryDetail(null);
        enableRoleStripScroll();
      });
    });
  }

  function closeMemoryApp() {
    var el = $('miya-memory-app');
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-worldbook-app.is-open') &&
        !document.querySelector('.miya-music-app.is-open') &&
        !document.querySelector('.miya-chat-app.is-open') &&
        !document.querySelector('.miya-memory-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  function onCharMemoryUpdated(chatId) {
    if (selectedChatId === chatId) {
      renderSummaryDetail(chatId);
      renderRoleList();
    }
  }

  bindEvents();

  global.miyaMemoryApp = {
    open: openMemoryApp,
    close: closeMemoryApp,
    onCharMemoryUpdated: onCharMemoryUpdated
  };
})(window);
