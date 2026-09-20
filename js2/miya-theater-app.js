/**
 * miya-theater-app.js — 剧场 · INS 极简小剧场
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    mode: 'solo',
    tab: 'stage',
    selectedContactIds: [],
    selectedTemplateId: '',
    playsFilter: 'all',
    editingTemplateId: '',
    currentPlayId: '',
    generating: false,
    htmlBlobUrl: ''
  };

  var toastTimer = 0;

  function store() { return global.miyaTheaterStore || null; }
  function bridge() { return global.miyaTheaterBridge || null; }
  function chatStore() { return global.miyaChatStore || null; }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('th-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function getContacts() {
    var cs = chatStore();
    if (!cs || !cs.getContacts) return [];
    return (cs.getContacts() || []).filter(function (c) {
      return c && c.id && c.type !== 'group';
    });
  }

  function getContact(id) {
    var cs = chatStore();
    if (!cs || !id) return null;
    if (cs.findContact) return cs.findContact(id);
    return getContacts().find(function (c) { return c && c.id === id; }) || null;
  }

  function displayName(contact) {
    if (!contact) return '未命名';
    return String(contact.remarkName || contact.name || '未命名').trim();
  }

  function chronicleAvatar(contact) {
    var cts = global.miyaContactsStore;
    if (!cts || !contact) return '';
    var roleId = String(contact.characterId || contact.chronicleId || '').trim();
    if (!roleId || typeof cts.findCharacter !== 'function') return '';
    var ch = cts.findCharacter(roleId);
    return ch && ch.avatar ? String(ch.avatar).trim() : '';
  }

  function resolveAvatarUrl(contact) {
    var cs = chatStore();
    if (!contact) return Promise.resolve('');
    var direct = String(contact.avatar || '').trim();
    if (direct) return Promise.resolve(direct);
    var blobId = String(contact.avatarBlobId || '').trim();
    if (cs && blobId) {
      if (typeof cs.getCachedBlobUrl === 'function') {
        var cached = cs.getCachedBlobUrl(blobId);
        if (cached) return Promise.resolve(cached);
      }
      if (typeof cs.getAvatarUrl === 'function') {
        return cs.getAvatarUrl(blobId).then(function (url) {
          return url || chronicleAvatar(contact) || '';
        }).catch(function () {
          return chronicleAvatar(contact) || '';
        });
      }
    }
    return Promise.resolve(chronicleAvatar(contact) || '');
  }

  function avatarHtml(contact) {
    var ch = String(displayName(contact)).charAt(0) || '?';
    return '<span class="th-chip__ava th-chip__ava--ph" data-th-ava="' + esc(contact.id) + '">' + esc(ch) + '</span>';
  }

  function hydrateAvatars(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-th-ava]').forEach(function (el) {
      var id = el.getAttribute('data-th-ava');
      var contact = getContact(id);
      if (!contact) return;
      resolveAvatarUrl(contact).then(function (url) {
        if (!url || !el.parentNode) return;
        el.outerHTML = '<img class="th-chip__ava" src="' + esc(url) + '" alt="" loading="lazy" data-th-ava="' + esc(id) + '">';
      });
    });
  }

  function excerpt(text, max) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    max = max || 48;
    return t.length <= max ? t : t.slice(0, max) + '…';
  }

  function formatTime(ts) {
    var d = new Date(Number(ts) || Date.now());
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function setMode(mode) {
    state.mode = mode === 'multi' ? 'multi' : 'solo';
    if (state.mode === 'solo' && state.selectedContactIds.length > 1) {
      state.selectedContactIds = state.selectedContactIds.slice(0, 1);
    }
    renderAll();
  }

  function setTab(tab) {
    state.tab = tab === 'templates' || tab === 'history' ? tab : 'stage';
    renderAll();
  }

  function revokeHtmlBlob() {
    if (state.htmlBlobUrl) {
      try { URL.revokeObjectURL(state.htmlBlobUrl); } catch (e) { /* ignore */ }
      state.htmlBlobUrl = '';
    }
  }

  /** 注入交互兜底：展开/收起等常见点击在 iframe 内可用 */
  function injectTheaterInteractiveHelper(html) {
    var doc = String(html || '');
    if (!doc || doc.indexOf('__miya_theater_ix') >= 0) return doc;
    var helper =
      '<script id="__miya_theater_ix">(function(){' +
      'if(window.__miyaTheaterIx)return;window.__miyaTheaterIx=1;' +
      'function visible(el){if(!el)return false;if(el.hidden)return false;var s=window.getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden";}' +
      'function setOpen(el,on){if(!el)return;if(on){el.hidden=false;el.removeAttribute("hidden");el.classList.remove("hidden","is-hidden","hide","collapsed");el.classList.add("is-open","is-expanded","show","expanded");if(el.style.display==="none")el.style.display="";if(!visible(el))el.style.display="block";}else{el.classList.remove("is-open","is-expanded","show","expanded");el.classList.add("is-hidden");if(visible(el))el.style.display="none";}}' +
      'function resolveTarget(btn){var sel=btn.getAttribute("data-target")||btn.getAttribute("data-expand")||btn.getAttribute("data-toggle")||btn.getAttribute("aria-controls")||"";if(sel){if(sel.charAt(0)!=="#")sel="#"+sel;try{var byId=document.querySelector(sel);if(byId)return byId;}catch(e){}}var root=btn.closest("[data-fold],.fold,.accordion,.card,.item,.row,.block,.panel")||btn.parentElement;if(root){var body=root.querySelector("[data-expand-panel],.fold-body,.accordion-body,.card-body,.detail,.more,.content,.body,.panel-body,.expand-panel");if(body&&body!==btn)return body;}return btn.nextElementSibling;}' +
      'function shouldHandle(btn){if(!btn||btn.closest("summary,input,textarea,select,label"))return false;if(btn.getAttribute("onclick"))return false;if(btn.hasAttribute("data-expand")||btn.hasAttribute("data-toggle")||btn.hasAttribute("data-target")||btn.getAttribute("aria-expanded")!=null)return true;if(/\\b(expand|toggle|fold|collapse|more-btn|btn-more)\\b/i.test(btn.className||""))return true;var t=String(btn.textContent||"").replace(/\\s+/g," ").trim();return /^(展开|收起|查看更多|显示更多|折叠|详情|更多|展开查看|点击展开)$/.test(t);}' +
      'document.addEventListener("click",function(ev){var btn=ev.target&&ev.target.closest?ev.target.closest("button,[role=button],.btn,a[href=\\"#\\"],a[href=\\"javascript:void(0)\\"],a[href=\\"javascript:;\\"]"):null;if(!btn||!shouldHandle(btn))return;var target=resolveTarget(btn);if(!target||target===btn)return;ev.preventDefault();var open=visible(target);setOpen(target,!open);var lab=String(btn.textContent||"").trim();if(lab==="展开")btn.textContent="收起";else if(lab==="收起")btn.textContent="展开";else if(lab==="查看更多"||lab==="显示更多"||lab==="更多"||lab==="展开查看"||lab==="点击展开")btn.textContent="收起";if(btn.hasAttribute("aria-expanded"))btn.setAttribute("aria-expanded",open?"false":"true");},false);' +
      '})();</script>';
    if (/<\/body>/i.test(doc)) {
      return doc.replace(/<\/body>/i, helper + '</body>');
    }
    return doc + helper;
  }

  function buildHtmlSrcdoc(rawHtml) {
    var htmlApi = global.MiyaChatHtml;
    var html = String(rawHtml || '').trim();
    if (!html) return '';
    if (htmlApi && typeof htmlApi.buildChatHtmlIframeSrcdoc === 'function') {
      html = htmlApi.buildChatHtmlIframeSrcdoc(html);
    } else if (!/<\s*!doctype\s+html\b/i.test(html) && !/<\s*html\b/i.test(html)) {
      html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '</head><body>' + html + '</body></html>';
    }
    return injectTheaterInteractiveHelper(html);
  }

  function mountHtmlIframe(iframe, srcdoc) {
    if (!iframe || !srcdoc) return;
    iframe.removeAttribute('src');
    iframe.removeAttribute('srcdoc');
    // 先 srcdoc（脚本更稳），失败再用 blob
    try {
      iframe.srcdoc = srcdoc;
      return;
    } catch (e0) { /* fall through */ }
    try {
      var blob = new Blob([srcdoc], { type: 'text/html;charset=utf-8' });
      var burl = URL.createObjectURL(blob);
      state.htmlBlobUrl = burl;
      iframe.src = burl;
    } catch (e1) {
      try { iframe.srcdoc = srcdoc; } catch (e2) { /* ignore */ }
    }
  }

  function showLoading(text) {
    var el = $('th-loading');
    var tip = $('th-loading-text');
    if (tip) tip.textContent = text || '正在生成小剧场…';
    if (el) el.hidden = false;
  }

  function hideLoading() {
    var el = $('th-loading');
    if (el) el.hidden = true;
  }

  function renderMode() {
    document.querySelectorAll('[data-th-mode]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-th-mode') === state.mode);
    });
  }

  function renderNav() {
    document.querySelectorAll('[data-th-tab]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-th-tab') === state.tab);
    });
    ['stage', 'templates', 'history'].forEach(function (name) {
      var panel = $('th-panel-' + name);
      if (panel) panel.hidden = state.tab !== name;
    });
  }

  function renderCastPicker() {
    var list = $('th-cast-list');
    if (!list) return;
    var contacts = getContacts();
    var multi = state.mode === 'multi';
    var hint = $('th-cast-hint');
    if (hint) {
      hint.textContent = multi ? '可多选' : '选一位';
    }

    if (!contacts.length) {
      list.innerHTML = '<div class="th-empty">暂无角色，请先添加联系人</div>';
      return;
    }

    list.innerHTML = contacts.map(function (c) {
      var on = state.selectedContactIds.indexOf(c.id) >= 0;
      return '<button type="button" class="th-chip' + (on ? ' is-on' : '') + '" data-th-cast="' + esc(c.id) + '">' +
        '<span class="th-chip__ring">' + avatarHtml(c) + '</span>' +
        '<span class="th-chip__name">' + esc(displayName(c)) + '</span>' +
        '</button>';
    }).join('');
    hydrateAvatars(list);
  }

  function toggleCast(contactId) {
    var id = String(contactId || '').trim();
    if (!id) return;
    var idx = state.selectedContactIds.indexOf(id);
    if (state.mode === 'solo') {
      state.selectedContactIds = idx >= 0 ? [] : [id];
    } else {
      if (idx >= 0) state.selectedContactIds.splice(idx, 1);
      else state.selectedContactIds.push(id);
    }
    renderCastPicker();
    renderStartButton();
  }

  function renderTemplatePicker() {
    var list = $('th-tpl-pick-list');
    if (!list) return;
    var st = store();
    var templates = st ? st.listTemplates(state.mode) : [];
    if (!templates.length) {
      list.innerHTML = '<div class="th-empty">还没有模版<br>去「模版」页添加一个吧</div>';
      return;
    }
    list.innerHTML = templates.map(function (t) {
      var on = state.selectedTemplateId === t.id;
      return '<button type="button" class="th-tpl-item' + (on ? ' is-on' : '') + '" data-th-pick-tpl="' + esc(t.id) + '">' +
        '<div class="th-tpl-item__main">' +
        '<p class="th-tpl-item__title">' + esc(t.title) + '</p>' +
        '<p class="th-tpl-item__sub">' + esc(excerpt(t.prompt, 56)) + '</p>' +
        '</div></button>';
    }).join('');
  }

  function renderStartButton() {
    var btn = $('th-start-btn');
    if (!btn) return;
    var okCast = state.mode === 'multi'
      ? state.selectedContactIds.length >= 2
      : state.selectedContactIds.length === 1;
    var okTpl = !!state.selectedTemplateId;
    btn.disabled = !(okCast && okTpl) || state.generating;
    if (state.mode === 'multi' && state.selectedContactIds.length === 1) {
      btn.textContent = '多人模式请至少选两位';
    } else if (!okCast) {
      btn.textContent = state.mode === 'multi' ? '请选择角色' : '请选择一位角色';
    } else if (!okTpl) {
      btn.textContent = '请选择模版';
    } else {
      btn.textContent = '开始剧目';
    }
  }

  function renderTemplatesManage() {
    var list = $('th-tpl-manage-list');
    if (!list) return;
    var st = store();
    var templates = st ? st.listTemplates() : [];
    if (!templates.length) {
      list.innerHTML = '<div class="th-empty">点击下方「新建模版」开始</div>';
      return;
    }
    var modeLabel = { solo: '单人', multi: '多人', any: '通用' };
    list.innerHTML = templates.map(function (t) {
      return '<div class="th-tpl-item" data-th-tpl-row="' + esc(t.id) + '">' +
        '<div class="th-tpl-item__main">' +
        '<p class="th-tpl-item__title">' + esc(t.title) + '</p>' +
        '<p class="th-tpl-item__sub">' + esc((modeLabel[t.mode] || '通用') + ' · ' + excerpt(t.prompt, 48)) + '</p>' +
        '</div>' +
        '<div class="th-tpl-item__acts">' +
        '<button type="button" class="th-icon-btn" data-th-tpl-edit="' + esc(t.id) + '" title="编辑">✎</button>' +
        '<button type="button" class="th-icon-btn th-icon-btn--danger" data-th-tpl-del="' + esc(t.id) + '" title="删除">⌫</button>' +
        '</div></div>';
    }).join('');
  }

  function renderHistory() {
    var list = $('th-play-list');
    if (!list) return;
    document.querySelectorAll('[data-th-plays-filter]').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-th-plays-filter') === state.playsFilter);
    });
    var st = store();
    var plays = st ? st.listPlays({
      mode: state.mode,
      favoritedOnly: state.playsFilter === 'fav'
    }) : [];
    if (!plays.length) {
      list.innerHTML = '<div class="th-empty">' +
        (state.playsFilter === 'fav' ? '还没有收藏的剧目' : '过去剧目会在这里出现') +
        '</div>';
      return;
    }
    list.innerHTML = plays.map(function (p) {
      var cast = (p.contactNames || []).join(' · ') || '未知角色';
      return '<button type="button" class="th-play-item" data-th-open-play="' + esc(p.id) + '">' +
        '<div class="th-play-item__main">' +
        '<p class="th-play-item__title">' + esc(p.title) + (p.favorited ? ' ★' : '') + '</p>' +
        '<p class="th-play-item__sub">' + esc(cast + ' · ' + formatTime(p.updatedAt || p.createdAt)) + '</p>' +
        '</div></button>';
    }).join('');
  }

  function renderAll() {
    renderMode();
    renderNav();
    renderCastPicker();
    renderTemplatePicker();
    renderStartButton();
    renderTemplatesManage();
    renderHistory();
  }

  function openTemplateEditor(id) {
    var sheet = $('th-tpl-sheet');
    var st = store();
    var tpl = id && st ? st.findTemplate(id) : null;
    state.editingTemplateId = tpl ? tpl.id : '';
    var titleEl = $('th-tpl-title');
    var promptEl = $('th-tpl-prompt');
    var modeEl = $('th-tpl-mode');
    var head = $('th-tpl-sheet-title');
    if (titleEl) titleEl.value = tpl ? tpl.title : '';
    if (promptEl) promptEl.value = tpl ? tpl.prompt : '';
    if (modeEl) modeEl.value = tpl ? (tpl.mode || 'any') : 'any';
    if (head) head.textContent = tpl ? '编辑模版' : '新建模版';
    if (sheet) sheet.hidden = false;
  }

  function closeTemplateEditor() {
    var sheet = $('th-tpl-sheet');
    if (sheet) sheet.hidden = true;
    state.editingTemplateId = '';
  }

  function saveTemplateFromEditor() {
    var st = store();
    if (!st) return;
    var title = String(($('th-tpl-title') && $('th-tpl-title').value) || '').trim();
    var prompt = String(($('th-tpl-prompt') && $('th-tpl-prompt').value) || '').trim();
    var mode = String(($('th-tpl-mode') && $('th-tpl-mode').value) || 'any').trim();
    if (!title) {
      toast('请填写标题');
      return;
    }
    if (!prompt) {
      toast('请填写生成要求');
      return;
    }
    var row = st.upsertTemplate({
      id: state.editingTemplateId || undefined,
      title: title,
      prompt: prompt,
      mode: mode
    });
    if (!row) {
      toast('保存失败');
      return;
    }
    if (!state.selectedTemplateId) state.selectedTemplateId = row.id;
    closeTemplateEditor();
    toast('模版已保存');
    renderAll();
  }

  function importPromptFile(file) {
    if (!file) return;
    var name = String(file.name || '').toLowerCase();
    if (!/\.(txt|docx)$/.test(name)) {
      toast('仅支持 txt / docx');
      return;
    }
    var extract = global.miyaWorldbookExtractFileText;
    if (typeof extract !== 'function') {
      toast('文件解析模块未加载');
      return;
    }
    showLoading('正在读取文件…');
    extract(file, {}).then(function (text) {
      hideLoading();
      var promptEl = $('th-tpl-prompt');
      if (!promptEl) return;
      var body = String(text || '').trim();
      if (!body) {
        toast('文件内容为空');
        return;
      }
      promptEl.value = body;
      toast('已填入生成要求');
    }).catch(function (err) {
      hideLoading();
      toast((err && err.message) || '读取失败');
    });
  }

  function openStage(play) {
    if (!play) return;
    state.currentPlayId = play.id;
    var stage = $('th-stage');
    var title = $('th-stage-title');
    var cast = $('th-stage-cast');
    var textEl = $('th-stage-text');
    var htmlWrap = $('th-stage-html');
    var iframe = $('th-stage-iframe');
    var foot = $('th-stage-foot');
    var enlargeBtn = $('th-act-enlarge');
    var favBtn = $('th-act-fav');

    if (title) title.textContent = play.title || '小剧场';
    if (cast) {
      var castText = (play.contactNames || []).join(' · ');
      var tplText = play.templateTitle ? ' · ' + play.templateTitle : '';
      cast.textContent = castText + tplText;
    }

    revokeHtmlBlob();
    var isHtml = play.contentType === 'html';
    if (textEl) textEl.hidden = isHtml;
    if (htmlWrap) htmlWrap.hidden = !isHtml;
    if (enlargeBtn) enlargeBtn.hidden = !isHtml;
    if (foot) foot.classList.toggle('is-html', isHtml);
    if (favBtn) favBtn.classList.toggle('is-on', !!play.favorited);

    if (isHtml) {
      var srcdoc = buildHtmlSrcdoc(play.content);
      if (iframe && srcdoc) {
        mountHtmlIframe(iframe, srcdoc);
      }
    } else if (textEl) {
      textEl.textContent = play.content || '';
    }

    if (stage) stage.hidden = false;
  }

  function closeStage(saveHint) {
    var stage = $('th-stage');
    var playId = state.currentPlayId;
    if (stage) stage.hidden = true;
    revokeHtmlBlob();
    var iframe = $('th-stage-iframe');
    if (iframe) {
      iframe.removeAttribute('src');
      iframe.removeAttribute('srcdoc');
    }
    state.currentPlayId = '';
    if (saveHint && playId) toast('已保存到过去剧目');
    renderHistory();
  }

  function openFullscreenHtml() {
    var st = store();
    var play = st && state.currentPlayId ? st.findPlay(state.currentPlayId) : null;
    if (!play || play.contentType !== 'html') return;
    var srcdoc = buildHtmlSrcdoc(play.content);
    if (!srcdoc) return;
    var htmlApi = global.MiyaChatHtml;
    if (htmlApi && typeof htmlApi.openChatHtmlFullscreen === 'function') {
      htmlApi.openChatHtmlFullscreen(srcdoc);
      return;
    }
    var fs = $('th-fs');
    var iframe = $('th-fs-iframe');
    if (!fs || !iframe) return;
    mountHtmlIframe(iframe, srcdoc);
    fs.hidden = false;
  }

  function closeFullscreenHtml() {
    var fs = $('th-fs');
    var iframe = $('th-fs-iframe');
    if (iframe) {
      var src = iframe.getAttribute('src') || '';
      if (src.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(src); } catch (e) { /* ignore */ }
      }
      iframe.removeAttribute('src');
      iframe.removeAttribute('srcdoc');
    }
    if (fs) fs.hidden = true;
  }

  function startPlay() {
    if (state.generating) return;
    var st = store();
    var br = bridge();
    if (!st || !br) {
      toast('剧场模块未就绪');
      return;
    }
    var need = state.mode === 'multi' ? 2 : 1;
    if (state.selectedContactIds.length < need) {
      toast(state.mode === 'multi' ? '请至少选择两位角色' : '请选择一位角色');
      return;
    }
    var template = st.findTemplate(state.selectedTemplateId);
    if (!template) {
      toast('请选择模版');
      return;
    }
    var contacts = state.selectedContactIds.map(getContact).filter(Boolean);
    if (!contacts.length) {
      toast('角色不存在');
      return;
    }

    state.generating = true;
    renderStartButton();
    showLoading('正在生成小剧场…');

    br.generatePlay({
      contacts: contacts,
      template: template
    }).then(function (play) {
      state.generating = false;
      hideLoading();
      renderStartButton();
      openStage(play);
      toast('生成完成');
    }).catch(function (err) {
      state.generating = false;
      hideLoading();
      renderStartButton();
      toast((err && err.message) || '生成失败');
    });
  }

  function regenerateCurrent() {
    if (state.generating || !state.currentPlayId) return;
    var st = store();
    var br = bridge();
    var play = st ? st.findPlay(state.currentPlayId) : null;
    if (!play || !br) return;
    var template = play.templateId ? st.findTemplate(play.templateId) : null;
    if (!template) {
      template = {
        id: play.templateId || '',
        title: play.templateTitle || '模版',
        prompt: ''
      };
    }
    if (!template.prompt) {
      toast('原模版已删除，无法重新生成');
      return;
    }
    var contacts = (play.contactIds || []).map(getContact).filter(Boolean);
    if (!contacts.length) {
      toast('原角色不存在');
      return;
    }

    state.generating = true;
    showLoading('正在重新生成…');
    br.generatePlay({
      contacts: contacts,
      template: template,
      replacePlayId: play.id
    }).then(function (next) {
      state.generating = false;
      hideLoading();
      openStage(next);
      toast('已重新生成');
    }).catch(function (err) {
      state.generating = false;
      hideLoading();
      toast((err && err.message) || '重新生成失败');
    });
  }

  function toggleFavoriteCurrent() {
    var st = store();
    if (!st || !state.currentPlayId) return;
    var play = st.findPlay(state.currentPlayId);
    if (!play) return;
    var next = st.setPlayFavorite(play.id, !play.favorited);
    if (next) {
      var favBtn = $('th-act-fav');
      if (favBtn) favBtn.classList.toggle('is-on', !!next.favorited);
      toast(next.favorited ? '已收藏' : '已取消收藏');
      renderHistory();
    }
  }

  function deleteCurrentPlay() {
    var st = store();
    if (!st || !state.currentPlayId) return;
    var ok = global.confirm ? global.confirm('确定删除这场剧目？') : true;
    if (!ok) return;
    st.removePlay(state.currentPlayId);
    closeStage(false);
    toast('已删除');
    renderHistory();
  }

  function otherAppsStillOpen() {
    return !!(
      document.querySelector('.miya-beautify-app.is-open') ||
      document.querySelector('.miya-settings-app.is-open') ||
      document.querySelector('.miya-worldbook-app.is-open') ||
      document.querySelector('.miya-contacts-app.is-open') ||
      document.querySelector('#miya-music-app.is-open') ||
      document.querySelector('#miya-chat-app.is-open') ||
      document.querySelector('#miya-memory-app.is-open') ||
      document.querySelector('#miya-diary-app.is-open') ||
      document.querySelector('#miya-offline-app.is-open') ||
      document.querySelector('#miya-typewriter-app.is-open') ||
      document.querySelector('#miya-forum-app.is-open') ||
      document.querySelector('.miya-cstore-app.is-open') ||
      document.querySelector('.miya-itinerary-app.is-open') ||
      document.querySelector('.miya-couple-app.is-open') ||
      document.querySelector('#miya-deep-app.is-open')
    );
  }

  function openTheaterApp() {
    var el = $('miya-theater-app');
    if (!el) return;
    var chain = Promise.resolve();
    var cs = chatStore();
    if (cs && cs.init) chain = chain.then(function () { return cs.init(); });
    var cts = global.miyaContactsStore;
    if (cts && cts.whenReady) chain = chain.then(function () { return cts.whenReady(); });
    chain.then(function () {
      el.removeAttribute('hidden');
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
      document.body.classList.add('miya-app-open');
      closeTemplateEditor();
      closeFullscreenHtml();
      var stage = $('th-stage');
      if (stage) stage.hidden = true;
      if (typeof global.miyaArmOpenClickGuard === 'function') {
        global.miyaArmOpenClickGuard(el);
      }
      requestAnimationFrame(function () { renderAll(); });
    });
  }

  function closeTheaterApp() {
    var el = $('miya-theater-app');
    if (!el) return;
    if (state.currentPlayId) {
      closeStage(true);
    }
    closeTemplateEditor();
    closeFullscreenHtml();
    hideLoading();
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (!otherAppsStillOpen()) {
      document.body.classList.remove('miya-app-open');
    }
  }

  function bindEvents() {
    var root = $('miya-theater-app');
    if (!root || root._thBound) return;
    root._thBound = true;

    var back = $('th-back');
    if (back) back.addEventListener('click', closeTheaterApp);

    root.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;

      var modeBtn = t.closest('[data-th-mode]');
      if (modeBtn) {
        setMode(modeBtn.getAttribute('data-th-mode'));
        return;
      }

      var tabBtn = t.closest('[data-th-tab]');
      if (tabBtn) {
        setTab(tabBtn.getAttribute('data-th-tab'));
        return;
      }

      var castBtn = t.closest('[data-th-cast]');
      if (castBtn) {
        toggleCast(castBtn.getAttribute('data-th-cast'));
        return;
      }

      var pickTpl = t.closest('[data-th-pick-tpl]');
      if (pickTpl) {
        state.selectedTemplateId = pickTpl.getAttribute('data-th-pick-tpl') || '';
        renderTemplatePicker();
        renderStartButton();
        return;
      }

      var filterBtn = t.closest('[data-th-plays-filter]');
      if (filterBtn) {
        state.playsFilter = filterBtn.getAttribute('data-th-plays-filter') === 'fav' ? 'fav' : 'all';
        renderHistory();
        return;
      }

      var openPlay = t.closest('[data-th-open-play]');
      if (openPlay) {
        var st = store();
        var play = st ? st.findPlay(openPlay.getAttribute('data-th-open-play')) : null;
        if (play) openStage(play);
        return;
      }

      var tplEdit = t.closest('[data-th-tpl-edit]');
      if (tplEdit) {
        openTemplateEditor(tplEdit.getAttribute('data-th-tpl-edit'));
        return;
      }

      var tplDel = t.closest('[data-th-tpl-del]');
      if (tplDel) {
        var delId = tplDel.getAttribute('data-th-tpl-del');
        var ok = global.confirm ? global.confirm('确定删除该模版？') : true;
        if (!ok) return;
        var storeApi = store();
        if (storeApi) storeApi.removeTemplate(delId);
        if (state.selectedTemplateId === delId) state.selectedTemplateId = '';
        toast('模版已删除');
        renderAll();
      }
    });

    var startBtn = $('th-start-btn');
    if (startBtn) startBtn.addEventListener('click', startPlay);

    var newTpl = $('th-tpl-new');
    if (newTpl) newTpl.addEventListener('click', function () { openTemplateEditor(''); });

    var tplBack = $('th-tpl-sheet-back');
    if (tplBack) tplBack.addEventListener('click', closeTemplateEditor);

    var tplSave = $('th-tpl-save');
    if (tplSave) tplSave.addEventListener('click', saveTemplateFromEditor);

    var importBtn = $('th-tpl-import');
    var fileInput = $('th-tpl-file');
    if (importBtn && fileInput) {
      importBtn.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = '';
        importPromptFile(file);
      });
    }

    var stageBack = $('th-stage-back');
    if (stageBack) {
      stageBack.addEventListener('click', function () {
        closeStage(true);
      });
    }

    var actRegen = $('th-act-regen');
    if (actRegen) actRegen.addEventListener('click', regenerateCurrent);

    var actFav = $('th-act-fav');
    if (actFav) actFav.addEventListener('click', toggleFavoriteCurrent);

    var actDel = $('th-act-del');
    if (actDel) actDel.addEventListener('click', deleteCurrentPlay);

    var actEnlarge = $('th-act-enlarge');
    if (actEnlarge) actEnlarge.addEventListener('click', openFullscreenHtml);

    var actExit = $('th-act-exit');
    if (actExit) {
      actExit.addEventListener('click', function () {
        closeStage(true);
      });
    }

    var fsBack = $('th-fs-back');
    if (fsBack) fsBack.addEventListener('click', closeFullscreenHtml);
  }

  bindEvents();

  global.miyaTheaterApp = {
    open: openTheaterApp,
    close: closeTheaterApp
  };
})(typeof window !== 'undefined' ? window : global);
