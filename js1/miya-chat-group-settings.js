/**
 * Miya 聊天 · 群聊设置
 */
(function (global) {
  'use strict';

  var store = null;
  var pageEl = null;
  var state = { chatId: null, activeTab: 'info', zoneOpen: {} };
  var DEFAULT_ZONE_OPEN = { basic: true };
  /** @type {{ type: 'sum'|'mega', id: string }|null} */
  var editingSummary = null;
  var renderRaf = 0;
  var ctxUsageGen = 0;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaChatApp && global.miyaChatApp.toast) global.miyaChatApp.toast(msg);
    else if (pageEl) {
      var el = pageEl.querySelector('.mi-toast');
      if (el) {
        el.textContent = msg;
        el.classList.add('is-show');
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
      }
    }
  }

  function dialog(opts) {
    if (global.miyaDialog) {
      if (opts.mode === 'confirm' && global.miyaDialog.confirm) return global.miyaDialog.confirm(opts);
      if (global.miyaDialog.prompt) return global.miyaDialog.prompt(opts);
    }
    return Promise.resolve(null);
  }

  function triggerFileInput(input) {
    if (!input) return;
    if (global.miyaTriggerFileInput) global.miyaTriggerFileInput(input);
    else input.click();
  }

  function gg() { return global.MiyaChatGroup; }

  function ctx() {
    if (!store || !state.chatId) return null;
    var chat = store.findChat(state.chatId);
    if (!chat || chat.type !== 'group') return null;
    var settings = store.getChatSettings(state.chatId);
    var profiles = store.getProfiles();
    var profile = profiles.find(function (p) { return p.id === chat.profileId; }) || store.getActiveProfile();
    var members = gg() && gg().getMembers ? gg().getMembers(store, chat) : store.getGroupMembers(state.chatId);
    return { chat: chat, settings: settings, profiles: profiles, profile: profile, members: members };
  }

  function isZoneOpen(id) {
    if (Object.prototype.hasOwnProperty.call(state.zoneOpen, id)) {
      return !!state.zoneOpen[id];
    }
    return !!DEFAULT_ZONE_OPEN[id];
  }

  function captureZoneOpenState(body) {
    if (!body) return;
    body.querySelectorAll('[data-mq-set-zone]').forEach(function (el) {
      var id = el.getAttribute('data-mq-set-zone');
      if (id) state.zoneOpen[id] = el.classList.contains('is-open');
    });
  }

  function toggleZone(panel) {
    if (!panel) return;
    var body = panel.querySelector('.mi-set-zone__body');
    var toggle = panel.querySelector('[data-mq-set-zone-toggle]');
    if (!body) return;
    var nextOpen = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', nextOpen);
    body.hidden = !nextOpen;
    var id = panel.getAttribute('data-mq-set-zone');
    if (id) state.zoneOpen[id] = nextOpen;
    if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
  }

  function renderZone(id, title, hint, content) {
    var open = isZoneOpen(id);
    return '<section class="mi-set-zone' + (open ? ' is-open' : '') + '" data-mq-set-zone="' + esc(id) + '">' +
      '<button type="button" class="mi-set-zone__head" data-mq-set-zone-toggle aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<div class="mi-set-zone__text">' +
          '<strong class="mi-set-zone__title">' + esc(title) + '</strong>' +
          (hint ? '<span class="mi-set-zone__hint">' + esc(hint) + '</span>' : '') +
        '</div>' +
        '<svg class="st-chevron mi-set-zone__chev" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
      '</button>' +
      '<div class="mi-set-zone__body"' + (open ? '' : ' hidden') + '>' + content + '</div>' +
    '</section>';
  }

  function subBlock(title, sub, inner) {
    return '<div class="mi-set-sub">' +
      (title ? '<div class="mi-set-sub__head">' +
        '<span class="mi-set-sub__title">' + esc(title) + '</span>' +
        (sub ? '<span class="mi-set-sub__hint">' + esc(sub) + '</span>' : '') +
      '</div>' : '') +
      inner +
    '</div>';
  }

  function formCard(inner, extraClass) {
    return '<div class="st-form-card ins-form-block' + (extraClass ? ' ' + extraClass : '') + '">' + inner + '</div>';
  }

  function toggleRow(id, label, sub, on) {
    return '<div class="st-toggle-in-form">' +
      '<div class="st-toggle-in-form__text">' +
        '<strong>' + esc(label) + '</strong>' +
        (sub ? '<span>' + esc(sub) + '</span>' : '') +
      '</div>' +
      '<button type="button" class="ins-toggle' + (on ? ' is-on' : '') + '" id="' + esc(id) + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"></button>' +
    '</div>';
  }

  function fieldBlock(label, sub, inner) {
    return '<label class="mi-set-field">' +
      '<span class="ins-field-label">' + esc(label) + '</span>' +
      (sub ? '<span class="st-form-hint mi-set-field__sub">' + esc(sub) + '</span>' : '') +
      '<div class="mi-set-field__box">' + inner + '</div>' +
    '</label>';
  }

  function isToggleOn(root, sel) {
    var el = root ? root.querySelector(sel) : $(sel.replace(/^#/, ''));
    return el && el.classList.contains('is-on');
  }

  function syncTranslateExtrasVisibility(root) {
    if (!root) return;
    var on = isToggleOn(root, '#mq-grp-trans');
    var wrap = root.querySelector('[data-mq-grp-trans-extra]');
    if (wrap) wrap.hidden = !on;
  }

  function escTextarea(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escAttr(s) {
    return esc(s).replace(/[\r\n\u2028\u2029]/g, '');
  }

  function mediaPickBlock(label, previewData, pickData, resetData, urlInputData, urlApplyData, sub) {
    return fieldBlock(label, sub || '',
      '<button type="button" class="mi-bg-pick" ' + pickData + '>' +
        '<div class="mi-bg-stage mi-bg-stage--sm" ' + previewData + '><span class="mi-bg-stage__placeholder">+</span></div>' +
      '</button>' +
      '<div class="mi-img-pick-tools">' +
        '<button type="button" class="st-foot-btn" ' + resetData + '>恢复默认</button>' +
        '<div class="ins-inline-field">' +
          '<input type="url" class="ins-text-input" ' + urlInputData + ' placeholder="图片链接" autocomplete="off">' +
          '<button type="button" class="ins-icon-btn" ' + urlApplyData + ' title="应用">✓</button>' +
        '</div>' +
      '</div>'
    );
  }

  function renderChatWallpaperLibrary(currentBf) {
    var picker = global.MiyaChatWallpaperPicker;
    if (!picker || !picker.renderLibrary) return '';
    return picker.renderLibrary(currentBf || {}, {
      libAttr: 'data-mq-grp-wall-lib',
      manageAttr: 'data-mq-grp-wall-manage',
      urlAttr: 'data-mq-grp-wall-lib-url',
      blobAttr: 'data-mq-grp-wall-lib-blob'
    });
  }

  function buildChatWallpaperSection(s) {
    return formCard(
      mediaPickBlock('聊天背景',
        'data-mq-grp-bg-preview',
        'data-mq-grp-bg-pick',
        'data-mq-grp-bg-reset',
        'data-mq-grp-bg-url-input',
        'data-mq-grp-bg-url-apply') +
      renderChatWallpaperLibrary(s.chatBeautify || {})
    );
  }

  function buildSummaryClipContent(row, type, id) {
    if (editingSummary && editingSummary.type === type && editingSummary.id === id) {
      return '<div class="mi-grp-sum-edit">' +
        '<textarea class="ins-text-input mi-input--area" data-mq-grp-sum-edit rows="6">' +
          escTextarea(row.content || '') +
        '</textarea>' +
        '<div class="mi-btn-row">' +
          '<button type="button" class="st-foot-btn" data-mq-grp-sum-save="' + esc(type) + '" data-mq-grp-sum-id="' + esc(id) + '">保存</button>' +
          '<button type="button" class="st-foot-btn" data-mq-grp-sum-cancel>取消</button>' +
        '</div>' +
      '</div>';
    }
    return '<div class="mi-grp-sum-body">' + esc(row.content || '').replace(/\n/g, '<br>') + '</div>';
  }

  function buildSummaryListHtml(settings) {
    var sumMod = global.MiyaChatSummary;
    var sumList = settings.summaryList || [];
    var megaList = settings.megaSummaryList || [];
    var covered = sumMod && sumMod.summaryIdsCoveredByMega
      ? sumMod.summaryIdsCoveredByMega(megaList) : {};
    if (!sumList.length && !megaList.length) {
      return '';
    }
    var html = '<div class="mi-grp-sum-list">';
    sumList.forEach(function (row) {
      if (!row) return;
      var tag = covered[row.id] ? '<span class="mi-grp-sum-tag">已合卷</span>' : '';
      html += '<article class="mi-grp-sum-clip">' +
        '<header class="mi-grp-sum-head">' +
          '<strong>分镜 · 第 ' + row.startIndex + '–' + row.endIndex + ' 条</strong>' +
          tag +
          '<span class="mi-grp-sum-acts">' +
            '<button type="button" class="st-foot-btn" data-mq-grp-edit-sum="' + esc(row.id) + '">编辑</button>' +
            '<button type="button" class="st-foot-btn" data-mq-grp-del-sum="' + esc(row.id) + '">删除</button>' +
          '</span>' +
        '</header>' +
        buildSummaryClipContent(row, 'sum', row.id) +
      '</article>';
    });
    megaList.forEach(function (row, i) {
      if (!row) return;
      html += '<article class="mi-grp-sum-clip mi-grp-sum-clip--mega">' +
        '<header class="mi-grp-sum-head">' +
          '<strong>合卷 · 第 ' + (i + 1) + ' 幕</strong>' +
          '<span class="mi-grp-sum-acts">' +
            '<button type="button" class="st-foot-btn" data-mq-grp-edit-mega="' + esc(row.id) + '">编辑</button>' +
            '<button type="button" class="st-foot-btn" data-mq-grp-del-mega="' + esc(row.id) + '">删除</button>' +
          '</span>' +
        '</header>' +
        buildSummaryClipContent(row, 'mega', row.id) +
      '</article>';
    });
    html += '</div>';
    return html;
  }

  function buildSummaryModuleHtml(c, s) {
    var historyLen = store.getMessages(state.chatId).filter(function (m) { return m && !m.deleted; }).length;
    var trigger = s.summaryTrigger != null ? s.summaryTrigger : 0;
    return formCard(
      fieldBlock('自动总结', '达到条数后自动触发', '<input type="number" class="ins-text-input" data-mq-grp-summary-trigger min="0" max="500" value="' + esc(trigger) + '">') +
      '<div class="mi-inline-nums mi-grp-sum-console">' +
        '<label class="mi-set-field mi-field--inline">' +
          '<span class="ins-field-label">起始</span>' +
          '<input type="number" class="ins-text-input mi-input--xs" data-mq-grp-sum-start min="1" max="' + historyLen + '" value="1">' +
        '</label>' +
        '<label class="mi-set-field mi-field--inline">' +
          '<span class="ins-field-label">结束</span>' +
          '<input type="number" class="ins-text-input mi-input--xs" data-mq-grp-sum-end min="1" max="' + historyLen + '" value="' + historyLen + '">' +
        '</label>' +
        '<button type="button" class="st-foot-btn" data-mq-grp-run-sum>生成分镜</button>' +
        '<button type="button" class="st-foot-btn" data-mq-grp-run-mega>生成合卷</button>' +
      '</div>' +
      buildSummaryListHtml(s)
    );
  }

  function buildBackgroundModuleHtml(s) {
    var bg = s.backgroundMessage || {};
    return formCard(
      toggleRow('mq-grp-bg-active', '主动发消息', '距最后一条消息达到间隔即触发，不论谁发的', !!bg.activeEnabled) +
      fieldBlock('间隔（分钟）', '从群内最后一条消息起算', '<input type="number" class="ins-text-input" data-mq-grp-bg-active-min min="5" max="1440" value="' + esc(bg.activeIntervalMin != null ? bg.activeIntervalMin : 30) + '">')
    );
  }

  function runGroupSummary() {
    if (!state.chatId || !global.MiyaChatSummary) return;
    var body = pageEl && pageEl.querySelector('[data-mq-grp-body]');
    var start = readNum(body, '[data-mq-grp-sum-start]', 1);
    var end = readNum(body, '[data-mq-grp-sum-end]', 1);
    toast('正在生成分镜…');
    global.MiyaChatSummary.performSummary(state.chatId, { start: start, end: end })
      .then(function (ok) {
        if (ok) toast('分镜完成');
        render();
      });
  }

  function runGroupMegaSummary() {
    if (!state.chatId || !global.MiyaChatSummary) return;
    var settings = store.getChatSettings(state.chatId);
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
    global.MiyaChatSummary.performMegaSummary(state.chatId, { sourceIndices: indices })
      .then(function (ok) {
        if (ok) toast('合卷完成');
        render();
      });
  }

  function saveSummaryEdit(type, id) {
    if (!state.chatId || !id) return;
    var area = pageEl && pageEl.querySelector('[data-mq-grp-sum-edit]');
    var text = area ? String(area.value || '').trim() : '';
    if (!text) {
      toast('内容不能为空');
      return;
    }
    var settings = store.getChatSettings(state.chatId);
    var patch = {};
    if (type === 'sum') {
      patch.summaryList = (settings.summaryList || []).map(function (r) {
        return r.id === id ? Object.assign({}, r, { content: text, updatedAt: Date.now() }) : r;
      });
    } else if (type === 'mega') {
      patch.megaSummaryList = (settings.megaSummaryList || []).map(function (r) {
        return r.id === id ? Object.assign({}, r, { content: text, updatedAt: Date.now() }) : r;
      });
    } else {
      return;
    }
    store.saveChatSettings(state.chatId, patch).then(function () {
      editingSummary = null;
      toast('已保存');
      render();
    });
  }

  function deleteSummaryItem(type, id) {
    if (!state.chatId || !id) return;
    if (editingSummary && editingSummary.id === id) editingSummary = null;
    var settings = store.getChatSettings(state.chatId);
    var patch = {};
    if (type === 'sum') {
      patch.summaryList = (settings.summaryList || []).filter(function (r) { return r.id !== id; });
    } else {
      patch.megaSummaryList = (settings.megaSummaryList || []).filter(function (r) { return r.id !== id; });
    }
    store.saveChatSettings(state.chatId, patch).then(function () {
      render();
    });
  }

  function formatNum(n) {
    return Number(n || 0).toLocaleString('zh-CN');
  }

  function contextUsageErrorText(code) {
    if (code === 'engine_missing') return '对话引擎未就绪';
    if (code === 'not_group') return '群聊不存在';
    if (code === 'group_members_missing') return '群成员不完整';
    if (code === 'profile_missing') return '请先选择面具';
    return '无法计算上下文用量';
  }

  function ensureContextUsageDeps() {
    if (global.miyaBootstrapKvStores) {
      return global.miyaBootstrapKvStores();
    }
    var chain = Promise.resolve();
    var wb = global.miyaWorldbookStore;
    var cs = global.miyaContactsStore;
    if (wb && typeof wb.whenReady === 'function') {
      chain = chain.then(function () { return wb.whenReady(); });
    }
    if (cs && typeof cs.whenReady === 'function') {
      chain = chain.then(function () { return cs.whenReady(); });
    }
    return chain;
  }

  function collectContextUsage(chatId) {
    var eng = global.miyaChatEngine;
    if (!eng || typeof eng.buildApiMessages !== 'function') return { error: 'engine_missing' };
    var built = eng.buildApiMessages(chatId, '', {});
    if (!built || built.error) return { error: (built && built.error) || 'build_failed' };
    var pm = built.promptMeta || {};
    var wb = built.worldbookMeta || {};
    var entries = Array.isArray(wb.matchedSummary) ? wb.matchedSummary : [];
    var wbStore = global.miyaWorldbookStore;
    var totalInStore = wbStore && typeof wbStore.listEntries === 'function' ? wbStore.listEntries().length : 0;
    var breakdown = typeof eng.buildPromptSourceBreakdown === 'function'
      ? eng.buildPromptSourceBreakdown(built.messages, wb) : null;
    var chat = store && store.findChat ? store.findChat(chatId) : null;
    var lastUsage = chat && chat.lastTokenUsage ? chat.lastTokenUsage : null;
    var activeThinking = chat && chat.activeThinking ? String(chat.activeThinking).trim() : '';
    var thinkingChars = activeThinking.length;
    var thinkingTokens =
      eng && typeof eng.estimateTokensFromText === 'function'
        ? eng.estimateTokensFromText(activeThinking)
        : Math.max(0, Math.ceil(thinkingChars / 1.6));
    var completionChars = lastUsage
      ? Number(lastUsage.completion_chars != null ? lastUsage.completion_chars : lastUsage.completion_tokens) || 0
      : 0;
    var completionTokens =
      eng && typeof eng.estimateTokensFromCharCount === 'function'
        ? eng.estimateTokensFromCharCount(completionChars)
        : Math.max(0, Math.ceil(completionChars / 1.6));
    return {
      estimatedTokens: pm.estimated_prompt_tokens || (breakdown && breakdown.promptTokens) || 0,
      totalChars: pm.total_prompt_chars || (breakdown && breakdown.promptChars) || 0,
      worldbookCount: pm.worldbook_matched || entries.length || 0,
      worldbookInSystem: pm.worldbook_in_system !== false,
      entries: entries,
      totalInStore: totalInStore,
      breakdown: breakdown,
      messageCount: pm.message_count || 0,
      lastTokenUsage: lastUsage,
      activeThinking: activeThinking,
      thinkingChars: thinkingChars,
      thinkingTokens: thinkingTokens,
      completionChars: completionChars,
      completionTokens: completionTokens
    };
  }

  function renderContextSourceRow(label, chars, tokens, sub) {
    return '<div class="mi-ctx-src-row">' +
      '<span class="mi-ctx-src-row__label">' + esc(label) +
        (sub ? '<span class="mi-ctx-src-row__sub">' + esc(sub) + '</span>' : '') +
      '</span>' +
      '<span class="mi-ctx-src-row__val">' +
        esc(formatNum(chars)) + ' 字' +
        '<span class="mi-ctx-src-row__tok">≈ ' + esc(formatNum(tokens)) + ' tok</span>' +
      '</span>' +
    '</div>';
  }

  function renderWorldbookEntryList(entries) {
    if (!entries || !entries.length) {
      return '<p class="mi-empty-hint mi-empty-hint--inline">当前无命中条目</p>';
    }
    return '<ul class="mi-ctx-wb__list">' +
      entries.map(function (e) {
        var tag = e.scope && e.scope !== 'global' ? ' · ' + e.scope : '';
        return '<li class="mi-ctx-wb__item">' +
          esc(e.name || '未命名') + tag +
          ' <span class="mi-ctx-wb__tag">' + esc(formatNum(e.charCount || 0)) + ' 字</span>' +
        '</li>';
      }).join('') +
    '</ul>';
  }

  function renderContextUsageDetailPop(snapshot, open) {
    var grouped = snapshot.breakdown && Array.isArray(snapshot.breakdown.grouped)
      ? snapshot.breakdown.grouped
      : [];
    var promptRows = grouped.map(function (g) {
      var sub = g.count > 1 ? '×' + g.count : '';
      return renderContextSourceRow(g.label, g.chars, g.tokens, sub);
    }).join('');

    var roundRows = '';
    if (snapshot.completionChars > 0) {
      roundRows += renderContextSourceRow(
        '上轮模型完整回复（API 返回原文）',
        snapshot.completionChars,
        snapshot.completionTokens,
        '含思维链/正文'
      );
    }
    if (snapshot.thinkingChars > 0) {
      roundRows += renderContextSourceRow(
        '思维链',
        snapshot.thinkingChars,
        snapshot.thinkingTokens
      );
    }
    if (!roundRows) {
      roundRows = '<p class="mi-empty-hint mi-empty-hint--inline">尚无上一轮回复记录，发送一条消息后更新</p>';
    }

    var wbNote = snapshot.worldbookInSystem === false
      ? '<p class="mi-ctx-inject mi-ctx-inject--warn">世界书文本可能未完全写入系统提示，请检查绑定与关键词。</p>'
      : (snapshot.worldbookCount > 0
        ? '<p class="mi-ctx-inject mi-ctx-inject--ok">世界书已注入系统提示 · 命中 ' +
          esc(formatNum(snapshot.worldbookCount)) + ' / 库内 ' + esc(formatNum(snapshot.totalInStore)) + ' 条</p>'
        : '<p class="mi-ctx-inject">库内共 ' + esc(formatNum(snapshot.totalInStore)) + ' 条，当前上下文未命中世界书。</p>');

    return '<div class="mi-ctx-detail-pop' + (open ? ' is-open' : '') + '" data-mq-grp-ctx-pop aria-hidden="' + (open ? 'false' : 'true') + '">' +
      '<div class="mi-ctx-detail-pop__sheet" role="region" aria-label="Token 来源明细">' +
        '<header class="mi-ctx-detail-pop__head">' +
          '<h3 class="mi-ctx-detail-pop__title">Token 来源明细</h3>' +
        '</header>' +
        '<div class="mi-ctx-detail-pop__body">' +
          '<section class="mi-ctx-detail__section">' +
            '<h4 class="mi-ctx-detail__heading">下次请求 · Prompt 注入（' + esc(formatNum(snapshot.messageCount || 0)) + ' 条 message）</h4>' +
            '<p class="mi-ctx-detail__hint">以下为当前设置下，下一条消息将发往 API 的上下文构成。字符数按实际 request body 统计；Token 为本地粗算（中文约 1.6 字/token，与 API 账单可能略有出入）。</p>' +
            '<div class="mi-ctx-src-list">' + (promptRows || '<p class="mi-empty-hint mi-empty-hint--inline">无数据</p>') + '</div>' +
          '</section>' +
          '<section class="mi-ctx-detail__section">' +
            '<h4 class="mi-ctx-detail__heading">世界书命中条目</h4>' +
            wbNote +
            renderWorldbookEntryList(snapshot.entries) +
          '</section>' +
          '<section class="mi-ctx-detail__section">' +
            '<h4 class="mi-ctx-detail__heading">上一轮 · 模型回复消耗</h4>' +
            '<div class="mi-ctx-src-list">' + roundRows + '</div>' +
          '</section>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderContextUsageBody(snapshot, detailOpen) {
    if (!snapshot || snapshot.error) {
      return '<p class="mi-empty-hint">' + esc(contextUsageErrorText(snapshot && snapshot.error)) + '</p>';
    }
    var open = !!detailOpen;
    var injectNote = snapshot.worldbookCount > 0
      ? '世界书命中 ' + formatNum(snapshot.worldbookCount) + ' 条'
      : '世界书未命中';
    return '<div class="mi-ctx-panel" data-mq-grp-ctx-panel>' +
      '<button type="button" class="mi-ctx-stats mi-ctx-stats--clickable" data-mq-grp-ctx-toggle aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<div class="mi-ctx-stat mi-ctx-stat--main">' +
          '<span class="mi-ctx-stat__label">Prompt 注入</span>' +
          '<strong class="mi-ctx-stat__val">' + esc(formatNum(snapshot.totalChars)) + '<span class="mi-ctx-stat__unit"> 字</span></strong>' +
        '</div>' +
        '<p class="mi-ctx-stat__sub">≈ ' + esc(formatNum(snapshot.estimatedTokens)) + ' token · ' + esc(injectNote) + '</p>' +
        '<p class="mi-ctx-stat__note">' + (open ? '再次点击收起明细' : '点击查看 Token 来源分区') + '</p>' +
      '</button>' +
      renderContextUsageDetailPop(snapshot, open) +
    '</div>';
  }

  function isContextUsageDetailOpen() {
    if (!pageEl) return false;
    var pop = pageEl.querySelector('[data-mq-grp-ctx-pop]');
    return !!(pop && pop.classList.contains('is-open'));
  }

  function refreshContextUsagePanel() {
    if (!pageEl || !state.chatId) return;
    var box = pageEl.querySelector('[data-mq-grp-ctx-usage]');
    if (!box) return;
    var detailOpen = isContextUsageDetailOpen();
    box.innerHTML = '<p class="mi-empty-hint">正在计算…</p>';
    var chatId = state.chatId;
    ensureContextUsageDeps().then(function () {
      if (!state.chatId || String(state.chatId) !== String(chatId)) return;
      setTimeout(function () {
        if (!pageEl || !state.chatId || String(state.chatId) !== String(chatId)) return;
        var snap = collectContextUsage(chatId);
        box.innerHTML = renderContextUsageBody(snap, detailOpen);
      }, 0);
    }).catch(function () {
      if (!pageEl || String(state.chatId) !== String(chatId)) return;
      box.innerHTML = '<p class="mi-empty-hint">世界书加载失败，请刷新后重试</p>';
    });
  }

  function scheduleContextUsageRefresh() {
    var gen = ++ctxUsageGen;
    var run = function () {
      if (gen !== ctxUsageGen) return;
      refreshContextUsagePanel();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 1600 });
    } else {
      setTimeout(run, 48);
    }
  }

  function toggleContextUsageDetail(forceClose) {
    if (!pageEl) return;
    var pop = pageEl.querySelector('[data-mq-grp-ctx-pop]');
    var toggle = pageEl.querySelector('[data-mq-grp-ctx-toggle]');
    if (!pop) return;
    var nextOpen = forceClose ? false : !pop.classList.contains('is-open');
    pop.classList.toggle('is-open', nextOpen);
    pop.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');
    if (toggle) toggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    var note = pageEl.querySelector('.mi-ctx-stat__note');
    if (note) {
      note.textContent = nextOpen ? '再次点击收起明细' : '点击查看 Token 来源分区';
    }
  }

  function titleColorPresets(selected) {
    var gmod = gg();
    var presets = (gmod && gmod.TITLE_COLOR_PRESETS) || ['#8b7355', '#e74c3c', '#3498db', '#9b59b6'];
    var sel = String(selected || '#8b7355');
    return presets.map(function (c) {
      return '<button type="button" class="mi-grp-color-swatch' + (c === sel ? ' is-active' : '') + '" data-mq-grp-title-color="' + esc(c) + '" style="--sw:' + esc(c) + '" aria-label="颜色 ' + esc(c) + '"></button>';
    }).join('');
  }

  function buildUserSelfCard(profile, settings) {
    var g = gg();
    var uid = (g && g.USER_OWNER_ID) || '__user__';
    var name = (g && g.userDisplayName) ? g.userDisplayName(profile) : ((profile && profile.name) || '我');
    var title = g && g.getMemberTitle ? g.getMemberTitle(settings, uid) : null;
    var titleName = title ? title.name : '';
    var titleColor = title ? title.color : ((g && g.DEFAULT_TITLE_COLOR) || '#8b7355');
    return '<article class="mi-grp-member-card mi-grp-member-card--user" data-mq-grp-member="' + esc(uid) + '">' +
      '<div class="mi-grp-member-card__head">' +
        '<strong class="mi-grp-member-card__name">' + esc(name) + '</strong>' +
        '<span class="mi-grp-role-badge mi-grp-role-badge--user">我</span>' +
      '</div>' +
      fieldBlock('群头衔', '', '<div class="mi-grp-title-edit">' +
        '<input type="text" class="ins-text-input" data-mq-grp-title-name="' + esc(uid) + '" value="' + esc(titleName) + '" placeholder="如：课代表、潜水员" maxlength="16">' +
        '<input type="hidden" data-mq-grp-title-color-val="' + esc(uid) + '" value="' + esc(titleColor) + '">' +
        '<div class="mi-grp-color-row" data-mq-grp-title-colors="' + esc(uid) + '">' + titleColorPresets(titleColor) + '</div>' +
      '</div>') +
    '</article>';
  }

  function buildMemberCard(contact, settings, members, userIsOwner) {
    var g = gg();
    var real = g && g.memberRealName ? g.memberRealName(contact) : (contact.name || '成员');
    var rm = (settings.memberRemarks && settings.memberRemarks[contact.id]) || '';
    var role = g && g.getMemberRole ? g.getMemberRole(settings, contact.id) : 'member';
    var roleTxt = g && g.roleLabel ? g.roleLabel(role) : '';
    var title = g && g.getMemberTitle ? g.getMemberTitle(settings, contact.id) : null;
    var titleName = title ? title.name : '';
    var titleColor = title ? title.color : ((g && g.DEFAULT_TITLE_COLOR) || '#8b7355');
    var ownerId = g && g.normalizeOwnerId ? g.normalizeOwnerId(settings) : '__user__';
    var isOwnerMember = ownerId === contact.id;
    var roleBadge = roleTxt
      ? '<span class="mi-grp-role-badge mi-grp-role-badge--' + esc(role) + '">' + esc(roleTxt) + '</span>'
      : '';
    var adminToggle = '';
    if (userIsOwner && !isOwnerMember && role !== 'owner') {
      var isAdmin = role === 'admin';
      adminToggle = '<button type="button" class="st-foot-btn' + (isAdmin ? ' is-active' : '') + '" data-mq-grp-admin-toggle="' + esc(contact.id) + '">' +
        (isAdmin ? '取消管理员' : '设为管理员') +
      '</button>';
    }
    var transferBtn = userIsOwner && !isOwnerMember
      ? '<button type="button" class="st-foot-btn" data-mq-grp-transfer-owner="' + esc(contact.id) + '">转让群主</button>'
      : '';
    var canRemove = members.length > 2 && !isOwnerMember;
    return '<article class="mi-grp-member-card" data-mq-grp-member="' + esc(contact.id) + '">' +
      '<div class="mi-grp-member-card__head">' +
        '<strong class="mi-grp-member-card__name">' + esc(real) + '</strong>' +
        roleBadge +
      '</div>' +
      fieldBlock('群内显示名', '', '<input type="text" class="ins-text-input" data-mq-grp-remark="' + esc(contact.id) + '" value="' + esc(rm) + '" placeholder="' + esc(real) + '">') +
      fieldBlock('群头衔', '', '<div class="mi-grp-title-edit">' +
        '<input type="text" class="ins-text-input" data-mq-grp-title-name="' + esc(contact.id) + '" value="' + esc(titleName) + '" placeholder="如：学霸、气氛组" maxlength="16">' +
        '<input type="hidden" data-mq-grp-title-color-val="' + esc(contact.id) + '" value="' + esc(titleColor) + '">' +
        '<div class="mi-grp-color-row" data-mq-grp-title-colors="' + esc(contact.id) + '">' + titleColorPresets(titleColor) + '</div>' +
      '</div>') +
      '<div class="mi-grp-member-card__acts">' + adminToggle + transferBtn +
        (canRemove ? '<button type="button" class="st-foot-btn st-foot-btn--warn" data-mq-grp-remove-member="' + esc(contact.id) + '">移出群聊</button>' : '') +
      '</div>' +
    '</article>';
  }

  function buildMembersSection(c, s) {
    var g = gg();
    var userIsOwner = g && g.isUserOwner ? g.isUserOwner(s) : true;
    var ownerId = g && g.normalizeOwnerId ? g.normalizeOwnerId(s) : '__user__';
    var ownerNote = userIsOwner
      ? '<p class="st-form-hint">你是本群群主，可设置管理员与转让群主。</p>'
      : '<p class="st-form-hint">群主：' + esc(
          ownerId === (g && g.USER_OWNER_ID)
            ? '你'
            : (function () {
                var oc = c.members.find(function (m) { return m.id === ownerId; });
                return oc ? (g.memberRealName(oc) || oc.name) : '成员';
              })()
        ) + '</p>';
    var cards = buildUserSelfCard(c.profile, s) + c.members.map(function (contact) {
      return buildMemberCard(contact, s, c.members, userIsOwner);
    }).join('');
    return formCard(
      ownerNote +
      '<div class="mi-grp-member-list">' + cards + '</div>' +
      '<div class="mi-btn-row">' +
        '<button type="button" class="st-action-btn st-action-btn--primary" data-mq-grp-invite>邀请成员</button>' +
      '</div>'
    );
  }

  function renderWorldbookToggleRows(entries, disabled) {
    if (!entries || !entries.length) return '';
    return '<div class="mi-grp-wb-list">' + entries.map(function (e) {
      var on = !disabled[e.id];
      var labels = Array.isArray(e.boundMemberLabels) ? e.boundMemberLabels.filter(Boolean) : [];
      return '<div class="mi-grp-wb-row">' +
        '<div class="mi-grp-wb-row__text">' +
          '<span class="mi-grp-wb-row__name">' + esc(e.name || e.id) + '</span>' +
          (labels.length
            ? '<span class="mi-grp-wb-row__sub">绑定：' + esc(labels.join('、')) + '</span>'
            : '') +
        '</div>' +
        '<button type="button" class="ins-toggle' + (on ? ' is-on' : '') + '" data-mq-grp-wb-id="' + esc(e.id) + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"></button>' +
      '</div>';
    }).join('') + '</div>';
  }

  function buildWorldbookSection(s) {
    var disabled = {};
    (s.groupWorldbookDisabledEntryIds || []).forEach(function (id) { disabled[id] = true; });
    var g = gg();
    var c = ctx();
    var globalEntries = g && typeof g.listOnlineGlobalWorldbookEntries === 'function'
      ? g.listOnlineGlobalWorldbookEntries()
      : [];
    var localEntries = g && typeof g.listMemberBoundLocalWorldbookEntries === 'function' && c
      ? g.listMemberBoundLocalWorldbookEntries(c.members, store, state.chatId)
      : [];
    var globalRows = globalEntries.length
      ? renderWorldbookToggleRows(globalEntries, disabled)
      : '<p class="mi-empty-hint">暂无线上全局世界书词条</p>';
    var localRows = localEntries.length
      ? renderWorldbookToggleRows(localEntries, disabled)
      : '<p class="mi-empty-hint">当前成员暂无绑定的局部世界书</p>';
    return formCard(
      '<p class="st-form-hint">关闭后仅本群不再注入该词条；单聊与其它群不受影响。默认开启。</p>' +
      '<p class="mi-grp-wb-subhead">全局世界书</p>' +
      globalRows +
      '<p class="mi-grp-wb-subhead">成员局部世界书</p>' +
      '<p class="st-form-hint">下列为群成员已绑定的局部词条；群聊里默认会注入，可单独关掉以省 Token。</p>' +
      localRows
    );
  }

  function buildContextSection() {
    return formCard('<div class="mi-ctx-usage" data-mq-grp-ctx-usage><p class="mi-empty-hint">正在计算…</p></div>');
  }

  function buildChatBehaviorSection(s) {
    var transOn = !!s.autoTranslate;
    return formCard(
      toggleRow('mq-grp-trans', '自动翻译', '同一轮随 API 输出意译译文', transOn) +
      '<div class="mi-trans-extra"' + (transOn ? '' : ' hidden') + ' data-mq-grp-trans-extra>' +
        fieldBlock('译文语言', '支持普通话、粤语、繁体、吴语等', '<select class="ins-select" data-mq-grp-trans-target>' +
          (global.MiyaChatTranslate && global.MiyaChatTranslate.buildTargetOptionsHtml
            ? global.MiyaChatTranslate.buildTargetOptionsHtml(s.translateTarget)
            : '<option value="zh-CN" selected>中文（普通话）</option>') +
        '</select>') +
      '</div>'
    );
  }

  function buildGroupAvatarBlock(c, s) {
    var g = gg();
    var custom = g && g.resolveGroupAvatarFromSettings ? g.resolveGroupAvatarFromSettings(s, store) : '';
    var collage = g && g.renderGroupCollageHtml
      ? g.renderGroupCollageHtml(c.members, function (ct) { return ct.avatar || ''; }, 'mq-grp-set')
      : '';
    return '<div class="mi-grp-avatar-pick">' +
      '<div class="mi-grp-avatar-frame">' +
        (custom
          ? '<img class="mi-grp-avatar-img" data-mq-grp-avatar-preview src="' + esc(custom) + '" alt="">'
          : '<span class="mi-grp-avatar-collage" data-mq-grp-collage-preview>' + collage + '</span>') +
      '</div>' +
      '<div class="mi-btn-row">' +
        '<button type="button" class="st-foot-btn" data-mq-grp-avatar-pick>更换群头像</button>' +
        (custom ? '<button type="button" class="st-foot-btn" data-mq-grp-avatar-clear>恢复拼贴</button>' : '') +
      '</div>' +
      '<input type="file" accept="image/*" hidden data-mq-grp-avatar-file>' +
    '</div>';
  }

  function renderPage() {
    var c = ctx();
    if (!c) return '<div class="mi-empty-hint">群聊不存在</div>';
    var chat = c.chat;
    var s = c.settings;
    var ta = s.timeAwareness || {};
    var profileName = (c.profile && c.profile.name) || '我';
    var msgCount = store.getMessages(state.chatId).filter(function (m) { return m && !m.deleted; }).length;

    return '<div class="st-container mi-set-flow">' +
      '<div class="st-deco-ornament" style="top: 80px; right: -20px;">§</div>' +
      '<div class="st-deco-ornament" style="bottom: 280px; left: -40px; font-size: 100px;">¶</div>' +

      '<header class="mi-set-title-bar">' +
        '<h1 class="mi-set-title-bar__name">' + esc(chat.title || '群聊') + '</h1>' +
        '<p class="mi-set-title-bar__meta">' + esc(profileName) + ' · ' + c.members.length + ' 位成员 · ' + formatNum(msgCount) + ' 条消息</p>' +
      '</header>' +

      renderZone('basic', '基础', '群信息与成员',
        subBlock('群信息', '', formCard(
          fieldBlock('群名称', '', '<input type="text" class="ins-text-input" data-mq-grp-title value="' + esc(chat.title || '') + '" maxlength="32" placeholder="给这群起个名字">') +
          buildGroupAvatarBlock(c, s)
        )) +
        subBlock('成员', c.members.length + ' 人', buildMembersSection(c, s))
      ) +

      renderZone('look', '外观与背景', '壁纸、CSS 主题与预设',
        subBlock('聊天背景', '', buildChatWallpaperSection(s)) +
        subBlock('聊天样式', 'CSS 主题与预设', formCard(
          (global.MiyaChatBeautify ? global.MiyaChatBeautify.buildChatSettingsBeautifyHtml(s.chatBeautify) : ''),
          'mi-set-bf-card'
        ))
      ) +

      renderZone('dialogue', '对话表现', '渲染、气泡、翻译与弹窗',
        subBlock('显示与回复', '', formCard(
          fieldBlock('消息渲染条数', '进入聊天时加载最近多少条，数值越大越慢', '<input type="number" class="ins-text-input" data-mq-grp-render-limit min="20" max="500" value="' + esc(s.messageRenderLimit || 100) + '">') +
          toggleRow('mq-grp-reply-banner', '角色消息弹窗', '', s.replyBannerEnabled !== false) +
          fieldBlock('单成员气泡条数', '', '<div class="mi-inline-nums">' +
            '<input type="number" class="ins-text-input mi-input--xs" data-mq-grp-bubble-min min="1" max="15" value="' + esc(s.roleReplyBubbleMin || 1) + '">' +
            '<span class="mi-inline-nums__sep">~</span>' +
            '<input type="number" class="ins-text-input mi-input--xs" data-mq-grp-bubble-max min="1" max="30" value="' + esc(s.roleReplyBubbleMax || 5) + '">' +
          '</div>')
        )) +
        subBlock('翻译', '', buildChatBehaviorSection(s))
      ) +

      renderZone('sense', '世界书', '本群可单独关闭的词条',
        subBlock('注入开关', '仅本群生效', buildWorldbookSection(s))
      ) +

      renderZone('memory', '记忆与后台', '上下文、互通、总结与主动消息',
        subBlock('记忆', '', formCard(
          toggleRow('mq-grp-mem-interop', '记忆互通', '', s.memoryInterop !== false) +
          fieldBlock('上下文条数', '每次调用 API 读取本群最近多少条', '<input type="number" class="ins-text-input" data-mq-grp-memory-count min="1" max="500" value="' + esc(s.memoryCount || 40) + '">')
        )) +
        subBlock('记忆总结', '', buildSummaryModuleHtml(c, s)) +
        subBlock('后台', '群聊主动消息', buildBackgroundModuleHtml(s))
      ) +

      renderZone('model', '模型高级', '时间感知与 Token 用量',
        subBlock('运转', '', formCard(
          toggleRow('mq-grp-time-en', '时间感知', '', !!ta.enabled)
        )) +
        subBlock('上下文用量', '点按卡片查看 Token 分区来源', buildContextSection())
      ) +

      renderZone('data', '数据管理', '导入导出、清空与解散',
        subBlock('聊天记录', '共 ' + formatNum(msgCount) + ' 条', formCard(
          '<div class="mi-btn-row">' +
            '<button type="button" class="st-action-btn" data-mq-grp-export>导出 JSON</button>' +
            '<button type="button" class="st-action-btn" data-mq-grp-import>导入 JSON</button>' +
            '<input type="file" accept="application/json,.json" hidden data-mq-grp-import-file>' +
            '<button type="button" class="st-action-btn" data-mq-grp-clear>清空聊天记录</button>' +
          '</div>'
        )) +
        subBlock('解散群聊', '删除后无法恢复', formCard(
          '<p class="mi-danger-text">解散后群聊、会话与全部消息将永久删除，无法恢复。</p>' +
          '<button type="button" class="st-action-btn st-action-btn--danger" data-mq-grp-delete>解散群聊</button>',
          'mi-set-danger-card'
        ))
      ) +

      '<footer class="st-footer">' +
        '<div class="st-footer-brand">Group Preferences</div>' +
        '<div class="st-footer-version">miya 小手机 · 2026</div>' +
      '</footer>' +
    '</div>';
  }

  function ensurePage() {
    if (pageEl) return pageEl;
    pageEl = document.createElement('div');
    pageEl.id = 'mq-group-settings';
    pageEl.className = 'mi-set-page';
    pageEl.hidden = true;
    pageEl.setAttribute('aria-hidden', 'true');
    pageEl.innerHTML =
      '<div class="st-ambient-bg" aria-hidden="true"></div>' +
      '<header class="st-navbar mi-set-navbar">' +
        '<button type="button" class="st-navback" data-mq-grp-back aria-label="返回">' +
          '<svg width="10" height="18" viewBox="0 0 10 18" fill="none" aria-hidden="true"><path d="M9 1L1 9l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '<span>返回</span>' +
        '</button>' +
        '<h1 class="st-navtitle">群聊设置</h1>' +
        '<button type="button" class="mi-set-navsave" data-mq-grp-save>保存</button>' +
      '</header>' +
      '<div class="st-scroll mi-set-body" data-mq-grp-body></div>' +
      '<div class="mi-toast" aria-live="polite"></div>';
    var app = $('miya-chat-app');
    if (app) app.appendChild(pageEl);
    else document.body.appendChild(pageEl);
    bindPageEvents();
    return pageEl;
  }

  function hydrateCollageAvatars(root) {
    if (!root || !store) return;
    var c = ctx();
    if (!c) return;
    root.querySelectorAll('[data-mq-mid]').forEach(function (node) {
      var mid = node.getAttribute('data-mq-mid');
      if (!mid) return;
      var contact = store.findContact(mid);
      if (!contact) return;
      if (contact.avatar) { node.src = contact.avatar; return; }
      if (contact.avatarBlobId && store.getAvatarUrl) {
        store.getAvatarUrl(contact.avatarBlobId).then(function (url) {
          if (url) node.src = url;
        });
      }
    });
  }

  function hydrateChatWallpaper(root) {
    var c = ctx();
    if (!c || !root) return;
    var bf = c.settings.chatBeautify || {};
    var bfMod = global.MiyaChatBeautify;
    var preview = root.querySelector('[data-mq-grp-bg-preview]');
    if (preview && bfMod) {
      bfMod.resolveWallpaperUrl(bf).then(function (url) {
        if (url) {
          preview.style.backgroundImage = 'url("' + url.replace(/"/g, '') + '")';
          preview.classList.add('has-image');
          var ph = preview.querySelector('.mi-bg-stage__placeholder');
          if (ph) ph.hidden = true;
        }
      });
    }
    if (global.MiyaChatWallpaperPicker && global.MiyaChatWallpaperPicker.hydrateThumbs) {
      global.MiyaChatWallpaperPicker.hydrateThumbs(root, {
        urlAttr: 'data-mq-grp-wall-lib-url',
        blobAttr: 'data-mq-grp-wall-lib-blob'
      });
    }
  }

  function render(opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (!pageEl) return;
    var body = pageEl.querySelector('[data-mq-grp-body]');
    if (!body) return;
    var prevScroll = body.scrollTop;
    captureZoneOpenState(body);
    body.innerHTML = renderPage();
    hydrateCollageAvatars(body);
    hydrateChatWallpaper(body);
    syncTranslateExtrasVisibility(body);
    var bfMod = global.MiyaChatBeautify;
    var bfWrap = body.querySelector('.mi-bf-wrap');
    if (bfMod && bfWrap && state.chatId) {
      bfMod.bindAtelierRoot(bfWrap, state.chatId, function () { render(); });
      bfMod.hydrateCssPreview(bfWrap);
    }
    body.scrollTop = prevScroll;
    if (!opts.skipContextUsage) scheduleContextUsageRefresh();
  }

  function markWallpaperLibActive(wpId) {
    if (!pageEl) return;
    var id = wpId != null ? String(wpId) : '';
    pageEl.querySelectorAll('[data-mq-grp-wall-lib]').forEach(function (btn) {
      var on = !!(id && btn.getAttribute('data-mq-grp-wall-lib') === id);
      btn.classList.toggle('is-active', on);
      var check = btn.querySelector('.mi-wall-lib-cell__check');
      if (on && !check) {
        btn.insertAdjacentHTML('beforeend', '<span class="mi-wall-lib-cell__check" aria-hidden="true">✓</span>');
      } else if (!on && check) {
        check.remove();
      }
    });
  }

  function scheduleRender(opts) {
    var gen = ++renderRaf;
    requestAnimationFrame(function () {
      if (gen !== renderRaf || !pageEl || !state.chatId) return;
      render(opts);
    });
  }

  function contactsBoundToProfile(st, profileId) {
    if (!st || !profileId) return [];
    return st.getContacts('all').filter(function (c) {
      var priv = st.findChatByContact(c.id, profileId);
      return !!priv;
    });
  }

  function showInviteMemberPicker() {
    if (!store || !state.chatId || !pageEl) return;
    var c = ctx();
    if (!c) return;
    var chat = c.chat;
    var existing = {};
    c.members.forEach(function (m) { existing[m.id] = true; });
    var bound = contactsBoundToProfile(store, chat.profileId).filter(function (ct) {
      return !existing[ct.id];
    });
    if (!bound.length) {
      toast('没有可邀请的联系人');
      return;
    }
    var old = pageEl.querySelector('[data-mq-grp-invite-sheet]');
    if (old) old.remove();
    var sheet = document.createElement('div');
    sheet.className = 'mi-grp-invite-sheet is-open';
    sheet.setAttribute('data-mq-grp-invite-sheet', '1');
    sheet.innerHTML =
      '<div class="mi-grp-invite-sheet__panel">' +
        '<header class="mi-grp-invite-sheet__head">' +
          '<h3>邀请成员</h3>' +
          '<button type="button" class="mi-grp-invite-sheet__close" data-mq-grp-invite-close aria-label="关闭">×</button>' +
        '</header>' +
        '<div class="mi-grp-invite-sheet__list">' +
          bound.map(function (ct, i) {
            return '<button type="button" class="mq-grp-pick-row" data-mq-grp-invite-pick="' + esc(ct.id) + '" style="--mq-i:' + i + '">' +
              '<span class="mq-grp-pick-name">' + esc(ct.remarkName || ct.name) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    pageEl.appendChild(sheet);
    sheet.addEventListener('click', function (e) {
      if (e.target.closest('[data-mq-grp-invite-close]') || e.target === sheet) {
        sheet.remove();
        return;
      }
      var pick = e.target.closest('[data-mq-grp-invite-pick]');
      if (!pick) return;
      var id = pick.getAttribute('data-mq-grp-invite-pick');
      store.addGroupMembers(state.chatId, [id]).then(function () {
        toast('已邀请');
        sheet.remove();
        render();
        if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
      }).catch(function () { toast('邀请失败'); });
    });
  }

  function toggleGroupAdmin(contactId) {
    if (!store || !state.chatId || !contactId) return;
    var c = ctx();
    if (!c) return;
    var g = gg();
    if (!g || !g.isUserOwner || !g.isUserOwner(c.settings)) {
      toast('仅群主可设置管理员');
      return;
    }
    var admins = (c.settings.groupAdminIds || []).slice();
    var idx = admins.indexOf(contactId);
    if (idx >= 0) admins.splice(idx, 1);
    else admins.push(contactId);
    store.saveChatSettings(state.chatId, { groupAdminIds: admins }).then(function () {
      toast(idx >= 0 ? '已取消管理员' : '已设为管理员');
      render();
    });
  }

  function transferGroupOwner(contactId) {
    if (!store || !state.chatId || !contactId) return;
    var c = ctx();
    if (!c) return;
    var g = gg();
    if (!g || !g.isUserOwner || !g.isUserOwner(c.settings)) {
      toast('仅群主可转让');
      return;
    }
    dialog({
      mode: 'confirm',
      title: '转让群主',
      message: '确定将群主转让给该成员？转让后你将无法设置管理员。',
      confirmText: '转让',
      cancelText: '取消'
    }).then(function (ok) {
      if (!ok) return;
      var admins = (c.settings.groupAdminIds || []).filter(function (id) {
        return id !== contactId;
      });
      store.saveChatSettings(state.chatId, {
        groupOwnerId: contactId,
        groupAdminIds: admins
      }).then(function () {
        toast('群主已转让');
        render();
      });
    });
  }

  function removeGroupMember(contactId) {
    if (!store || !state.chatId || !contactId) return;
    dialog({
      mode: 'confirm',
      title: '移出成员',
      message: '确定将该成员移出群聊？',
      confirmText: '移出',
      cancelText: '取消'
    }).then(function (ok) {
      if (!ok) return;
      store.removeGroupMember(state.chatId, contactId).then(function () {
        toast('已移出');
        render();
        if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
        if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === state.chatId) {
          global.miyaChatRoom.refresh();
        }
      }).catch(function (err) {
        var code = err && err.message;
        if (code === 'min_members') toast('至少保留 2 位成员');
        else if (code === 'owner_cannot_leave') toast('请先转让群主再移除');
        else toast('移除失败');
      });
    });
  }

  function readVal(root, sel) {
    var el = root.querySelector(sel);
    return el ? String(el.value || '').trim() : '';
  }

  function readNum(root, sel, fallback) {
    var n = parseInt(readVal(root, sel), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function titleDisplayNameForId(id, c) {
    var g = gg();
    var uid = (g && g.USER_OWNER_ID) || '__user__';
    if (id === uid) {
      return (g && g.userDisplayName) ? g.userDisplayName(c.profile) : ((c.profile && c.profile.name) || '用户');
    }
    var contact = c.members.find(function (m) { return m.id === id; });
    if (!contact) return '成员';
    return (g && g.memberDisplayName) ? g.memberDisplayName(store, contact, c.chat.id) : (contact.name || '成员');
  }

  function collectTitleChangeMessages(prevTitles, nextTitles, c) {
    var g = gg();
    if (!g || typeof g.formatTitleChangeContent !== 'function') return [];
    var actorName = (g.userDisplayName ? g.userDisplayName(c.profile) : ((c.profile && c.profile.name) || '用户'));
    var uid = g.USER_OWNER_ID || '__user__';
    var ids = {};
    Object.keys(prevTitles || {}).forEach(function (k) { ids[k] = true; });
    Object.keys(nextTitles || {}).forEach(function (k) { ids[k] = true; });
    var out = [];
    Object.keys(ids).forEach(function (id) {
      var prevName = prevTitles && prevTitles[id] && prevTitles[id].name ? String(prevTitles[id].name).trim() : '';
      var nextName = nextTitles && nextTitles[id] && nextTitles[id].name ? String(nextTitles[id].name).trim() : '';
      if (prevName === nextName) return;
      var targetName = titleDisplayNameForId(id, c);
      var content = g.formatTitleChangeContent(actorName, targetName, nextName, prevName);
      out.push({
        role: 'system',
        type: 'group_title_change',
        systemKind: 'group_title_change',
        content: content,
        titleChange: {
          actorId: uid,
          actorName: actorName,
          targetId: id,
          targetName: targetName,
          title: nextName,
          color: (nextTitles[id] && nextTitles[id].color) || g.DEFAULT_TITLE_COLOR || '#8b7355',
          prevTitle: prevName
        }
      });
    });
    return out;
  }

  function saveForm() {
    if (!store || !state.chatId || !pageEl) return;
    var body = pageEl.querySelector('[data-mq-grp-body]');
    var c = ctx();
    if (!c) return;
    var prev = c.settings;
    var aw = global.MiyaChatAwareness;
    var ta = aw && typeof aw.normalizeTimeAwareness === 'function'
      ? aw.normalizeTimeAwareness(prev.timeAwareness)
      : Object.assign({}, prev.timeAwareness || {});
    ta.enabled = isToggleOn(body, '#mq-grp-time-en');
    ta.mode = 'real';
    if (ta.real) ta.real.strength = 'strong';
    var memberRemarks = {};
    body.querySelectorAll('[data-mq-grp-remark]').forEach(function (inp) {
      var id = inp.getAttribute('data-mq-grp-remark');
      var v = String(inp.value || '').trim();
      if (id && v) memberRemarks[id] = v;
    });
    var memberTitles = Object.assign({}, prev.memberTitles || {});
    body.querySelectorAll('[data-mq-grp-title-name]').forEach(function (inp) {
      var id = inp.getAttribute('data-mq-grp-title-name');
      if (!id) return;
      var nm = String(inp.value || '').trim();
      var colorInp = body.querySelector('[data-mq-grp-title-color-val="' + id + '"]');
      var col = colorInp ? String(colorInp.value || '').trim() : '';
      if (!nm) {
        delete memberTitles[id];
      } else {
        memberTitles[id] = {
          name: nm.slice(0, 16),
          color: /^#[0-9a-fA-F]{6}$/.test(col) ? col : '#8b7355'
        };
      }
    });
    var groupWorldbookDisabledEntryIds = [];
    body.querySelectorAll('[data-mq-grp-wb-id]').forEach(function (btn) {
      if (btn.classList.contains('is-on')) return;
      var wid = btn.getAttribute('data-mq-grp-wb-id');
      if (wid) groupWorldbookDisabledEntryIds.push(wid);
    });
    var titleChangeMessages = collectTitleChangeMessages(prev.memberTitles || {}, memberTitles, c);
    var title = readVal(body, '[data-mq-grp-title]') || '群聊';
    var prevBg = prev.backgroundMessage || {};
    var patch = {
      memoryCount: readNum(body, '[data-mq-grp-memory-count]', 40),
      messageRenderLimit: readNum(body, '[data-mq-grp-render-limit]', 100),
      roleReplyBubbleMin: readNum(body, '[data-mq-grp-bubble-min]', 1),
      roleReplyBubbleMax: readNum(body, '[data-mq-grp-bubble-max]', 5),
      replyBannerEnabled: isToggleOn(body, '#mq-grp-reply-banner'),
      memoryInterop: isToggleOn(body, '#mq-grp-mem-interop'),
      summaryTrigger: readNum(body, '[data-mq-grp-summary-trigger]', 0),
      memberRemarks: memberRemarks,
      memberTitles: memberTitles,
      groupWorldbookDisabledEntryIds: groupWorldbookDisabledEntryIds,
      autoTranslate: isToggleOn(body, '#mq-grp-trans'),
      translateMode: 'semantic',
      translateTarget: String((body.querySelector('[data-mq-grp-trans-target]') || {}).value || 'zh-CN').trim(),
      timeAwareness: ta,
      backgroundMessage: Object.assign({}, prevBg, {
        activeEnabled: isToggleOn(body, '#mq-grp-bg-active'),
        activeIntervalMin: readNum(body, '[data-mq-grp-bg-active-min]', 30),
        offlineEnabled: false,
        quietEnabled: false
      })
    };
    var bfMod = global.MiyaChatBeautify;
    if (bfMod) {
      patch.chatBeautify = bfMod.readChatBeautifyFromRoot(body, prev.chatBeautify);
    }
    store.updateChat(state.chatId, { title: title }).then(function () {
      return store.saveChatSettings(state.chatId, patch);
    }).then(function () {
      if (!titleChangeMessages.length) return null;
      return titleChangeMessages.reduce(function (chain, msg) {
        return chain.then(function () {
          return store.addMessage(state.chatId, msg);
        });
      }, Promise.resolve());
    }).then(function () {
      toast('已保存');
      if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
      if (typeof scheduleRender === 'function') {
        scheduleRender({ fromStore: true });
      } else {
        render();
      }
      if (global.miyaChatApp && global.miyaChatApp.refreshLists) {
        if (typeof global.miyaScheduleIdle === 'function') {
          global.miyaScheduleIdle(function () { global.miyaChatApp.refreshLists(); }, 700);
        } else {
          setTimeout(function () { global.miyaChatApp.refreshLists(); }, 0);
        }
      }
      if (global.MiyaChatBackground && typeof global.MiyaChatBackground.kickScan === 'function') {
        if (typeof global.miyaScheduleIdle === 'function') {
          global.miyaScheduleIdle(function () { global.MiyaChatBackground.kickScan(); }, 1400);
        } else {
          setTimeout(function () { global.MiyaChatBackground.kickScan(); }, 0);
        }
      }
    }).catch(function () { toast('保存失败'); });
  }

  function open(chatId) {
    store = global.miyaChatStore;
    if (!store || !chatId) return Promise.resolve();

    state.chatId = chatId;
    state.zoneOpen = {};
    editingSummary = null;
    ensurePage();
    pageEl.hidden = false;
    pageEl.classList.add('is-open');
    pageEl.setAttribute('aria-hidden', 'false');
    var app = $('miya-chat-app');
    if (app) app.classList.add('mi-set-open');

    var scroll = pageEl.querySelector('[data-mq-grp-body]');
    if (scroll) scroll.scrollTop = 0;

    var chat = store.findChat(chatId);
    var body = pageEl.querySelector('[data-mq-grp-body]');
    if (chat && chat.type === 'group') {
      scheduleRender({ skipContextUsage: true });
      scheduleContextUsageRefresh();
    } else if (body) {
      body.innerHTML = '<p class="mi-empty-hint">加载中…</p>';
    }

    var chain = Promise.resolve();
    if (global.MiyaChatBeautify && global.MiyaChatBeautify.whenPresetsReady) {
      chain = chain.then(function () { return global.MiyaChatBeautify.whenPresetsReady(); });
    }
    if (global.miyaWorldbookStore && global.miyaWorldbookStore.whenReady) {
      chain = chain.then(function () { return global.miyaWorldbookStore.whenReady(); });
    }
    return chain.then(function () {
      return store.init();
    }).then(function () {
      if (String(state.chatId) !== String(chatId)) return;
      var loaded = store.findChat(chatId);
      if (!loaded || loaded.type !== 'group') return;
      scheduleRender();
    });
  }

  function close() {
    state.chatId = null;
    editingSummary = null;
    if (pageEl) {
      pageEl.classList.remove('is-open');
      pageEl.hidden = true;
      pageEl.setAttribute('aria-hidden', 'true');
    }
    var app = $('miya-chat-app');
    if (app) app.classList.remove('mi-set-open');
    if (global.miyaChatRoom && typeof global.miyaChatRoom.restoreCompose === 'function') {
      global.miyaChatRoom.restoreCompose();
    }
  }

  function bindPageEvents() {
    if (!pageEl || pageEl.dataset.grpBound) return;
    pageEl.dataset.grpBound = '1';

    pageEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-mq-grp-back]')) { close(); return; }
      if (e.target.closest('[data-mq-grp-save]')) { saveForm(); return; }

      var zoneToggle = e.target.closest('[data-mq-set-zone-toggle]');
      if (zoneToggle) {
        toggleZone(zoneToggle.closest('[data-mq-set-zone]'));
        return;
      }

      if (e.target.closest('[data-mq-grp-invite]')) { showInviteMemberPicker(); return; }
      if (e.target.closest('[data-mq-grp-ctx-toggle]')) {
        toggleContextUsageDetail(false);
        return;
      }

      var colorSw = e.target.closest('[data-mq-grp-title-color]');
      if (colorSw) {
        var col = colorSw.getAttribute('data-mq-grp-title-color');
        var row = colorSw.closest('[data-mq-grp-title-colors]');
        if (row && col) {
          var mid = row.getAttribute('data-mq-grp-title-colors');
          var hidden = pageEl.querySelector('[data-mq-grp-title-color-val="' + mid + '"]');
          if (hidden) hidden.value = col;
          row.querySelectorAll('[data-mq-grp-title-color]').forEach(function (b) {
            b.classList.toggle('is-active', b === colorSw);
          });
        }
        return;
      }

      var adminBtn = e.target.closest('[data-mq-grp-admin-toggle]');
      if (adminBtn) {
        toggleGroupAdmin(adminBtn.getAttribute('data-mq-grp-admin-toggle'));
        return;
      }
      var transferBtn = e.target.closest('[data-mq-grp-transfer-owner]');
      if (transferBtn) {
        transferGroupOwner(transferBtn.getAttribute('data-mq-grp-transfer-owner'));
        return;
      }
      var removeBtn = e.target.closest('[data-mq-grp-remove-member]');
      if (removeBtn) {
        removeGroupMember(removeBtn.getAttribute('data-mq-grp-remove-member'));
        return;
      }

      var sw = e.target.closest('.ins-toggle');
      if (sw && !sw.classList.contains('is-disabled')) {
        var on = !sw.classList.contains('is-on');
        sw.classList.toggle('is-on', on);
        sw.setAttribute('aria-checked', on ? 'true' : 'false');
        if (sw.id === 'mq-grp-trans') {
          syncTranslateExtrasVisibility(pageEl.querySelector('[data-mq-grp-body]'));
        }
        return;
      }

      if (e.target.closest('[data-mq-grp-run-sum]')) { runGroupSummary(); return; }
      if (e.target.closest('[data-mq-grp-run-mega]')) { runGroupMegaSummary(); return; }

      var editSum = e.target.closest('[data-mq-grp-edit-sum]');
      if (editSum) {
        editingSummary = { type: 'sum', id: editSum.getAttribute('data-mq-grp-edit-sum') };
        render();
        return;
      }
      var editMega = e.target.closest('[data-mq-grp-edit-mega]');
      if (editMega) {
        editingSummary = { type: 'mega', id: editMega.getAttribute('data-mq-grp-edit-mega') };
        render();
        return;
      }
      if (e.target.closest('[data-mq-grp-sum-cancel]')) {
        editingSummary = null;
        render();
        return;
      }
      var saveSum = e.target.closest('[data-mq-grp-sum-save]');
      if (saveSum) {
        saveSummaryEdit(saveSum.getAttribute('data-mq-grp-sum-save'), saveSum.getAttribute('data-mq-grp-sum-id'));
        return;
      }
      var delSum = e.target.closest('[data-mq-grp-del-sum]');
      if (delSum) {
        deleteSummaryItem('sum', delSum.getAttribute('data-mq-grp-del-sum'));
        return;
      }
      var delMega = e.target.closest('[data-mq-grp-del-mega]');
      if (delMega) {
        deleteSummaryItem('mega', delMega.getAttribute('data-mq-grp-del-mega'));
        return;
      }

      if (e.target.closest('[data-mq-grp-clear]')) {
        dialog({ mode: 'confirm', title: '清空消息', message: '确定清空本群全部聊天记录？', confirmText: '清空', cancelText: '取消' }).then(function (ok) {
          if (!ok || !state.chatId) return;
          store.clearChatMessages(state.chatId).then(function () {
            toast('已清空');
            if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === state.chatId) global.miyaChatRoom.refresh();
            render();
          });
        });
        return;
      }

      if (e.target.closest('[data-mq-grp-delete]')) {
        dialog({ mode: 'confirm', title: '解散群聊', message: '确定解散本群并删除全部记录？', confirmText: '解散', cancelText: '取消' }).then(function (ok) {
          if (!ok || !state.chatId) return;
          var cid = state.chatId;
          store.deleteChat(cid).then(function () {
            toast('群聊已解散');
            close();
            if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === cid) global.miyaChatRoom.close();
            if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
          });
        });
        return;
      }

      if (e.target.closest('[data-mq-grp-export]')) {
        var msgs = store.getMessages(state.chatId).filter(function (m) { return m && !m.deleted; });
        var blob = new Blob([JSON.stringify(msgs, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.download = 'miya-group-' + state.chatId + '.json';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
        toast('已导出 ' + msgs.length + ' 条');
        return;
      }

      if (e.target.closest('[data-mq-grp-import]')) {
        var finp = pageEl.querySelector('[data-mq-grp-import-file]');
        triggerFileInput(finp);
        return;
      }

      if (e.target.closest('[data-mq-grp-avatar-pick]')) {
        var af = pageEl.querySelector('[data-mq-grp-avatar-file]');
        triggerFileInput(af);
        return;
      }

      if (e.target.closest('[data-mq-grp-avatar-clear]')) {
        store.saveChatSettings(state.chatId, { groupAvatar: '', groupAvatarBlobId: null }).then(function () {
          toast('已恢复拼贴头像');
          render();
          if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
          if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === state.chatId) global.miyaChatRoom.refresh();
        });
        return;
      }

      function ensureGrpBgFileInput() {
        var finp = pageEl.querySelector('[data-mq-grp-bg-file]');
        if (finp) return finp;
        finp = document.createElement('input');
        finp.type = 'file';
        finp.accept = 'image/*';
        finp.hidden = true;
        finp.setAttribute('data-mq-grp-bg-file', '');
        pageEl.appendChild(finp);
        finp.addEventListener('change', function (ev) {
          var file = ev.target.files && ev.target.files[0];
          ev.target.value = '';
          if (!file || !state.chatId) return;
          store.storeChatMedia(file, 'wall').then(function (blobId) {
            return store.saveChatSettings(state.chatId, {
              chatBeautify: Object.assign({}, store.getChatSettings(state.chatId).chatBeautify, {
                wallpaperMode: 'idb', wallpaperId: blobId, wallpaperUrl: ''
              })
            });
          }).then(function () {
            toast('背景已更新');
            if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
            markWallpaperLibActive(null);
            if (typeof scheduleRender === 'function') scheduleRender({ fromStore: true });
            else render();
          });
        });
        return finp;
      }

      if (e.target.closest('[data-mq-grp-bg-pick]')) {
        triggerFileInput(ensureGrpBgFileInput());
        return;
      }

      if (e.target.closest('[data-mq-grp-wall-manage]')) {
        if (global.MiyaChatWallpaperPicker && global.MiyaChatWallpaperPicker.openManage) {
          global.MiyaChatWallpaperPicker.openManage();
        }
        return;
      }

      if (e.target.closest('[data-mq-grp-wall-lib]')) {
        var libBtn = e.target.closest('[data-mq-grp-wall-lib]');
        var wpId = libBtn.getAttribute('data-mq-grp-wall-lib');
        var picker = global.MiyaChatWallpaperPicker;
        var wp = picker && picker.findWallpaper ? picker.findWallpaper(wpId) : null;
        if (!wp || !state.chatId || !picker || !picker.applyWallpaperToChat) return;
        markWallpaperLibActive(wpId);
        toast('背景已更新');
        picker.applyWallpaperToChat(state.chatId, wp).then(function () {
          if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
        }).catch(function () {
          toast('背景更新失败');
          if (typeof scheduleRender === 'function') scheduleRender({ fromStore: true });
          else render();
        });
        return;
      }

      if (e.target.closest('[data-mq-grp-bg-reset]')) {
        store.saveChatSettings(state.chatId, {
          background: '',
          chatBeautify: Object.assign({}, store.getChatSettings(state.chatId).chatBeautify, {
            wallpaperMode: 'none', wallpaperId: null, wallpaperUrl: ''
          })
        }).then(function () {
          toast('已恢复默认');
          if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
          markWallpaperLibActive(null);
          if (typeof scheduleRender === 'function') scheduleRender({ fromStore: true });
          else render();
        });
        return;
      }

      if (e.target.closest('[data-mq-grp-bg-url-apply]')) {
        var bgUrlIn = pageEl.querySelector('[data-mq-grp-bg-url-input]');
        var bgUrl = bgUrlIn ? String(bgUrlIn.value || '').trim() : '';
        if (!bgUrl || !state.chatId) return;
        store.saveChatSettings(state.chatId, {
          chatBeautify: Object.assign({}, store.getChatSettings(state.chatId).chatBeautify, {
            wallpaperMode: 'url', wallpaperUrl: bgUrl, wallpaperId: null
          })
        }).then(function () {
          toast('背景已更新');
          if (global.MiyaChatBeautify) global.MiyaChatBeautify.applyForChat(state.chatId);
          markWallpaperLibActive(null);
          if (typeof scheduleRender === 'function') scheduleRender({ fromStore: true });
          else render();
        });
        return;
      }
    });

    pageEl.addEventListener('change', function (e) {
      if (e.target.matches('[data-mq-grp-import-file]')) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file || !state.chatId) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var parsed = JSON.parse(reader.result);
            if (!Array.isArray(parsed)) throw new Error('invalid');
            store.importChatMessages(state.chatId, parsed).then(function (n) {
              toast('已导入 ' + n + ' 条');
              render();
              if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === state.chatId) global.miyaChatRoom.refresh();
            });
          } catch (err) { toast('JSON 无效'); }
        };
        reader.readAsText(file, 'utf-8');
        return;
      }
      if (e.target.matches('[data-mq-grp-avatar-file]')) {
        var imgFile = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!imgFile || !state.chatId) return;
        var imgApi = global.MiyaChatImage;
        var chain = imgApi && imgApi.readFileAsDataUrl
          ? (imgApi.compressImageFile
            ? imgApi.compressImageFile(imgFile).then(function (c) { return imgApi.readFileAsDataUrl(c); })
            : imgApi.readFileAsDataUrl(imgFile))
          : Promise.reject(new Error('no_image'));
        chain.then(function (dataUrl) {
          return store.saveChatSettings(state.chatId, { groupAvatar: dataUrl, groupAvatarBlobId: null });
        }).then(function () {
          toast('群头像已更新');
          render();
          if (global.miyaChatApp && global.miyaChatApp.refreshLists) global.miyaChatApp.refreshLists();
          if (global.miyaChatRoom && global.miyaChatRoom.getOpenChatId() === state.chatId) global.miyaChatRoom.refresh();
        }).catch(function () { toast('上传失败'); });
      }
    });
  }

  global.miyaChatGroupSettings = { open: open, close: close };
})(window);
