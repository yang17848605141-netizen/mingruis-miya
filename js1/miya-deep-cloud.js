/**
 * miya-deep-cloud.js — 深入 · 角色手机 网盘（韩系浅灰 · 文件袋柜）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var KIND_LABEL = {
    note: '备忘',
    image: '图片',
    video: '视频',
    audio: '音频',
    doc: '文档',
    zip: '压缩包',
    link: '链接',
    secret: '密件'
  };

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    cloudData: null,
    refreshing: false,
    built: false,
    activeBagId: ''
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function cloudStore() { return global.miyaDeepCloudStore || null; }
  function cloudBridge() { return global.miyaDeepCloudBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function toast(msg) {
    var el = $('dp-cloud-toast');
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
    var text = $('dp-cloud-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的网盘数据');
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

  function updateStatusBar() {
    var bar = $('dp-cloud-status');
    var text = $('dp-cloud-status-text');
    if (!bar || !text) return;
    var data = state.cloudData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的网盘数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '网盘已同步';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-cloud__status';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-cloud__status is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-cloud-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.cloudData && state.cloudData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.cloudData && state.cloudData.cloud ? state.cloudData.cloud : null;
  }

  function hasContent(cl) {
    if (!cl) return false;
    return !!(
      (cl.bags && cl.bags.length) ||
      (cl.recent && cl.recent.length) ||
      (cl.secrets && cl.secrets.length) ||
      (cl.shared && cl.shared.length) ||
      (cl.voices && cl.voices.length) ||
      (cl.drafts && cl.drafts.length) ||
      (cl.recycle && cl.recycle.length) ||
      trim(cl.driveName) ||
      trim(cl.ownerLine) ||
      trim(cl.footerNote)
    );
  }

  function persistPayload() {
    var ts = cloudStore();
    if (!ts || !state.contactId || !state.cloudData) return Promise.resolve(null);
    return ts.patchCloud(state.contactId, { cloud: state.cloudData.cloud }).then(function (saved) {
      state.cloudData = saved;
      return saved;
    });
  }

  function findIn(list, id) {
    var found = null;
    (list || []).forEach(function (item) {
      if (item && item.id === id) found = item;
    });
    return found;
  }

  function ensureActiveBag(cl) {
    if (!cl || !cl.bags || !cl.bags.length) {
      state.activeBagId = '';
      return null;
    }
    var hit = findIn(cl.bags, state.activeBagId);
    if (hit) return hit;
    state.activeBagId = cl.bags[0].id;
    return cl.bags[0];
  }

  function kindMark(kind) {
    var map = {
      note: 'N',
      image: 'P',
      video: 'V',
      audio: 'A',
      doc: 'D',
      zip: 'Z',
      link: 'L',
      secret: '·'
    };
    return map[kind] || '·';
  }

  function captureScroll() {
    var sc = $('dp-cloud-scroll');
    return sc ? sc.scrollTop : 0;
  }

  function restoreScroll(top) {
    var sc = $('dp-cloud-scroll');
    if (sc) sc.scrollTop = top || 0;
  }

  function buildMast(cl) {
    var pct = Math.max(0, Math.min(100, Number(cl.usedPercent) || 0));
    var used = trim(cl.usedLabel) || '—';
    var total = trim(cl.totalLabel) || '—';
    return (
      '<section class="dp-cloud__mast">' +
        '<div class="dp-cloud__mast-top">' +
          '<div class="dp-cloud__mast-copy">' +
            '<span class="dp-cloud__kicker">Private Drive</span>' +
            '<h1 class="dp-cloud__drive-name">' + esc(trim(cl.driveName) || '私人网盘') + '</h1>' +
            (trim(cl.ownerLine) ? '<p class="dp-cloud__owner">' + esc(cl.ownerLine) + '</p>' : '') +
          '</div>' +
          '<div class="dp-cloud__cap">' +
            '<span class="dp-cloud__cap-num">' + esc(String(pct)) + '<small>%</small></span>' +
            '<span class="dp-cloud__cap-label">已用</span>' +
          '</div>' +
        '</div>' +
        '<div class="dp-cloud__meter" aria-hidden="true">' +
          '<span class="dp-cloud__meter-fill" style="width:' + pct + '%"></span>' +
        '</div>' +
        '<div class="dp-cloud__mast-meta">' +
          '<span>' + esc(used) + ' / ' + esc(total) + '</span>' +
          (trim(cl.syncNote) ? '<span>' + esc(cl.syncNote) + '</span>' : '') +
        '</div>' +
      '</section>'
    );
  }

  function buildSheetHtml(active) {
    if (!active) return '';
    var files = active.files || [];
    return (
      '<div class="dp-cloud__sheet">' +
        '<header class="dp-cloud__sheet-head">' +
          '<div>' +
            '<span class="dp-cloud__sheet-kicker">File Bag</span>' +
            '<h2 class="dp-cloud__sheet-title">' + esc(active.name) + '</h2>' +
            (trim(active.desc) ? '<p class="dp-cloud__sheet-desc">' + esc(active.desc) + '</p>' : '') +
          '</div>' +
          (active.locked ? '<span class="dp-cloud__seal">LOCKED</span>' : '') +
        '</header>' +
        '<div class="dp-cloud__leaves">' +
          (files.length ? files.map(function (f, i) {
            return (
              '<article class="dp-cloud__leaf' + (f.opened ? ' is-open' : '') + (f.pinned ? ' is-pin' : '') +
                '" data-file-id="' + esc(f.id) + '" style="--i:' + i + '">' +
                '<button type="button" class="dp-cloud__leaf-main" data-act="toggle-file" data-id="' + esc(f.id) + '">' +
                  '<span class="dp-cloud__leaf-mark" data-kind="' + esc(f.kind) + '">' + esc(kindMark(f.kind)) + '</span>' +
                  '<span class="dp-cloud__leaf-copy">' +
                    '<span class="dp-cloud__leaf-name">' + esc(f.name) + '</span>' +
                    '<span class="dp-cloud__leaf-sub">' +
                      '<em>' + esc(KIND_LABEL[f.kind] || f.kind) + '</em>' +
                      (f.size ? '<i>' + esc(f.size) + '</i>' : '') +
                      (f.updated ? '<i>' + esc(f.updated) + '</i>' : '') +
                    '</span>' +
                    ((!f.opened && trim(f.preview)) ? '<span class="dp-cloud__leaf-prev">' + esc(f.preview) + '</span>' : '') +
                  '</span>' +
                '</button>' +
                '<button type="button" class="dp-cloud__leaf-pin" data-act="pin-file" data-id="' + esc(f.id) + '" aria-label="置顶">' +
                  (f.pinned ? '●' : '○') +
                '</button>' +
                (f.opened && trim(f.body)
                  ? '<div class="dp-cloud__leaf-body">' + esc(f.body) + '</div>'
                  : '') +
              '</article>'
            );
          }).join('') : '<p class="dp-cloud__empty-line">这只文件袋还是空的</p>') +
        '</div>' +
      '</div>'
    );
  }

  function buildBagRail(cl, active) {
    var bags = cl.bags || [];
    if (!bags.length) return '';
    var rail = bags.map(function (bag) {
      var on = active && bag.id === active.id;
      return (
        '<button type="button" class="dp-cloud__pouch' + (on ? ' is-on' : '') +
          (bag.locked ? ' is-locked' : '') + '" data-act="select-bag" data-id="' + esc(bag.id) + '" data-tone="' + esc(bag.tone || 'ash') + '">' +
          '<span class="dp-cloud__pouch-flap" aria-hidden="true"></span>' +
          '<span class="dp-cloud__pouch-body">' +
            '<span class="dp-cloud__pouch-name">' + esc(bag.name) + '</span>' +
            '<span class="dp-cloud__pouch-meta">' +
              (bag.tag ? '<em>' + esc(bag.tag) + '</em>' : '') +
              '<i>' + esc(String(bag.count || (bag.files && bag.files.length) || 0)) + '</i>' +
            '</span>' +
          '</span>' +
          (bag.locked ? '<span class="dp-cloud__pouch-lock" aria-hidden="true"></span>' : '') +
        '</button>'
      );
    }).join('');

    return (
      '<section class="dp-cloud__cabinet">' +
        '<div class="dp-cloud__rail" id="dp-cloud-rail">' + rail + '</div>' +
        '<div class="dp-cloud__panel" id="dp-cloud-panel">' + buildSheetHtml(active) + '</div>' +
      '</section>'
    );
  }

  function buildRecent(cl) {
    var list = cl.recent || [];
    if (!list.length) return '';
    return (
      '<section class="dp-cloud__block">' +
        '<header class="dp-cloud__block-head">' +
          '<span class="dp-cloud__block-no">01</span>' +
          '<h3>最近上传</h3>' +
          '<span class="dp-cloud__block-hint">timeline</span>' +
        '</header>' +
        '<div class="dp-cloud__timeline">' +
          list.map(function (f, i) {
            return (
              '<button type="button" class="dp-cloud__tl-item' + (f.opened ? ' is-open' : '') +
                '" data-act="toggle-recent" data-id="' + esc(f.id) + '" style="--i:' + i + '">' +
                '<span class="dp-cloud__tl-dot" aria-hidden="true"></span>' +
                '<span class="dp-cloud__tl-copy">' +
                  '<span class="dp-cloud__tl-name">' + esc(f.name) + '</span>' +
                  '<span class="dp-cloud__tl-meta">' +
                    esc(KIND_LABEL[f.kind] || f.kind) +
                    (f.updated ? ' · ' + esc(f.updated) : '') +
                    (f.size ? ' · ' + esc(f.size) : '') +
                  '</span>' +
                  (f.opened && trim(f.body)
                    ? '<span class="dp-cloud__tl-body">' + esc(f.body) + '</span>'
                    : (trim(f.preview) ? '<span class="dp-cloud__tl-prev">' + esc(f.preview) + '</span>' : '')) +
                '</span>' +
              '</button>'
            );
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildSecrets(cl) {
    var list = cl.secrets || [];
    if (!list.length) return '';
    return (
      '<section class="dp-cloud__block">' +
        '<header class="dp-cloud__block-head">' +
          '<span class="dp-cloud__block-no">02</span>' +
          '<h3>上锁信封</h3>' +
          '<span class="dp-cloud__block-hint">sealed</span>' +
        '</header>' +
        '<div class="dp-cloud__envelopes">' +
          list.map(function (s) {
            return (
              '<article class="dp-cloud__env' + (s.unlocked ? ' is-open' : '') + '">' +
                '<button type="button" class="dp-cloud__env-face" data-act="unlock-secret" data-id="' + esc(s.id) + '">' +
                  '<span class="dp-cloud__env-wax" aria-hidden="true"></span>' +
                  '<span class="dp-cloud__env-title">' + esc(s.title) + '</span>' +
                  '<span class="dp-cloud__env-seal">' + esc(s.seal || '仅自己') + '</span>' +
                  (s.updated ? '<span class="dp-cloud__env-time">' + esc(s.updated) + '</span>' : '') +
                  '<span class="dp-cloud__env-cta">' + (s.unlocked ? '收起' : '拆开') + '</span>' +
                '</button>' +
                (s.unlocked && trim(s.content)
                  ? '<div class="dp-cloud__env-body">' + esc(s.content) + '</div>'
                  : '') +
              '</article>'
            );
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildShared(cl) {
    var list = cl.shared || [];
    if (!list.length) return '';
    return (
      '<section class="dp-cloud__block">' +
        '<header class="dp-cloud__block-head">' +
          '<span class="dp-cloud__block-no">03</span>' +
          '<h3>关于对方</h3>' +
          '<span class="dp-cloud__block-hint">private shelf</span>' +
        '</header>' +
        '<div class="dp-cloud__shelf">' +
          list.map(function (s) {
            return (
              '<button type="button" class="dp-cloud__shelf-item' + (s.opened ? ' is-open' : '') +
                '" data-act="toggle-shared" data-id="' + esc(s.id) + '">' +
                '<span class="dp-cloud__shelf-bar" aria-hidden="true"></span>' +
                '<span class="dp-cloud__shelf-copy">' +
                  '<span class="dp-cloud__shelf-title">' + esc(s.title) + '</span>' +
                  (s.withWhom ? '<span class="dp-cloud__shelf-who">for ' + esc(s.withWhom) + '</span>' : '') +
                  (trim(s.note) && !s.opened ? '<span class="dp-cloud__shelf-note">' + esc(s.note) + '</span>' : '') +
                  (s.opened && trim(s.content) ? '<span class="dp-cloud__shelf-body">' + esc(s.content) + '</span>' : '') +
                '</span>' +
              '</button>'
            );
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildVoices(cl) {
    var list = cl.voices || [];
    if (!list.length) return '';
    return (
      '<section class="dp-cloud__block">' +
        '<header class="dp-cloud__block-head">' +
          '<span class="dp-cloud__block-no">04</span>' +
          '<h3>语音备忘</h3>' +
          '<span class="dp-cloud__block-hint">memos</span>' +
        '</header>' +
        '<div class="dp-cloud__voices">' +
          list.map(function (v) {
            return (
              '<button type="button" class="dp-cloud__voice' + (v.played ? ' is-open' : '') +
                '" data-act="toggle-voice" data-id="' + esc(v.id) + '">' +
                '<span class="dp-cloud__wave" aria-hidden="true">' +
                  '<i></i><i></i><i></i><i></i><i></i><i></i><i></i>' +
                '</span>' +
                '<span class="dp-cloud__voice-copy">' +
                  '<span class="dp-cloud__voice-title">' + esc(v.title) + '</span>' +
                  (v.duration ? '<span class="dp-cloud__voice-dur">' + esc(v.duration) + '</span>' : '') +
                  (v.played && trim(v.transcript)
                    ? '<span class="dp-cloud__voice-text">' + esc(v.transcript) + '</span>'
                    : '<span class="dp-cloud__voice-hint">点开听转写</span>') +
                '</span>' +
              '</button>'
            );
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildDrafts(cl) {
    var list = cl.drafts || [];
    if (!list.length) return '';
    return (
      '<section class="dp-cloud__block">' +
        '<header class="dp-cloud__block-head">' +
          '<span class="dp-cloud__block-no">05</span>' +
          '<h3>未发出</h3>' +
          '<span class="dp-cloud__block-hint">drafts</span>' +
        '</header>' +
        '<div class="dp-cloud__drafts">' +
          list.map(function (d) {
            return (
              '<button type="button" class="dp-cloud__draft' + (d.opened ? ' is-open' : '') +
                '" data-act="toggle-draft" data-id="' + esc(d.id) + '">' +
                '<span class="dp-cloud__draft-label">DRAFT</span>' +
                '<span class="dp-cloud__draft-title">' + esc(d.title) + '</span>' +
                (d.updated ? '<span class="dp-cloud__draft-time">' + esc(d.updated) + '</span>' : '') +
                (d.opened && trim(d.content)
                  ? '<span class="dp-cloud__draft-body">' + esc(d.content) + '</span>'
                  : '') +
              '</button>'
            );
          }).join('') +
        '</div>' +
      '</section>'
    );
  }

  function buildRecycle(cl) {
    var list = cl.recycle || [];
    if (!list.length) return '';
    return (
      '<section class="dp-cloud__block dp-cloud__block--mute">' +
        '<header class="dp-cloud__block-head">' +
          '<span class="dp-cloud__block-no">06</span>' +
          '<h3>回收站</h3>' +
          '<span class="dp-cloud__block-hint">trash</span>' +
        '</header>' +
        '<ul class="dp-cloud__trash">' +
          list.map(function (r) {
            return (
              '<li>' +
                '<span class="dp-cloud__trash-name">' + esc(r.name) + '</span>' +
                (r.deletedAt ? '<span class="dp-cloud__trash-when">' + esc(r.deletedAt) + '</span>' : '') +
                (trim(r.reason) ? '<span class="dp-cloud__trash-why">' + esc(r.reason) + '</span>' : '') +
              '</li>'
            );
          }).join('') +
        '</ul>' +
      '</section>'
    );
  }

  function buildFooter(cl) {
    if (!trim(cl.footerNote)) return '';
    return (
      '<footer class="dp-cloud__footer">' +
        '<span class="dp-cloud__footer-rule" aria-hidden="true"></span>' +
        '<p>' + esc(cl.footerNote) + '</p>' +
      '</footer>'
    );
  }

  function renderStream(cl, keepScroll) {
    var el = $('dp-cloud-stream');
    if (!el) return;
    var snap = keepScroll ? captureScroll() : null;
    var active = ensureActiveBag(cl);
    el.innerHTML = [
      buildMast(cl),
      buildBagRail(cl, active),
      buildRecent(cl),
      buildSecrets(cl),
      buildShared(cl),
      buildVoices(cl),
      buildDrafts(cl),
      buildRecycle(cl),
      buildFooter(cl)
    ].join('');
    if (snap != null) {
      restoreScroll(snap);
      requestAnimationFrame(function () { restoreScroll(snap); });
    }
  }

  function buildFullUI() {
    var cl = getPayload();
    var empty = $('dp-cloud-empty');
    var stream = $('dp-cloud-stream');
    var has = hasContent(cl);
    if (empty) empty.hidden = !!has;
    if (stream) {
      stream.hidden = !has;
      if (has) renderStream(cl);
      else stream.innerHTML = '';
    }
    state.built = true;
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadCloudData(contactId) {
    var ts = cloudStore();
    if (!ts) return Promise.resolve(null);
    return ts.getCloud(contactId).then(function (data) {
      state.cloudData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-cloud-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = cloudStore();
    var br = cloudBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchCloud(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的网盘数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.cloudData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
      }
      return br.generateCloud(contactId, phoneData, {});
    }).then(function (result) {
      return ts.patchCloud(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        cloud: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.cloudData = saved;
        state.refreshing = false;
        state.activeBagId = '';
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
      return ts.patchCloud(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.cloudData = saved;
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
    if (state.refreshing || (state.cloudData && state.cloudData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function findFileInBags(cl, id) {
    var found = null;
    var bagHit = null;
    (cl.bags || []).forEach(function (bag) {
      (bag.files || []).forEach(function (f) {
        if (f && f.id === id) {
          found = f;
          bagHit = bag;
        }
      });
    });
    return { file: found, bag: bagHit };
  }

  function findByDataId(selector, id) {
    var nodes = document.querySelectorAll(selector);
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-id') === id) return nodes[i];
    }
    return null;
  }

  function patchLeaf(file) {
    if (!file) return;
    var leaf = null;
    var nodes = document.querySelectorAll('#dp-cloud-panel .dp-cloud__leaf');
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-file-id') === file.id) { leaf = nodes[i]; break; }
    }
    if (!leaf) return;
    leaf.classList.toggle('is-open', !!file.opened);
    leaf.classList.toggle('is-pin', !!file.pinned);
    var pinBtn = leaf.querySelector('.dp-cloud__leaf-pin');
    if (pinBtn) pinBtn.textContent = file.pinned ? '●' : '○';
    var copy = leaf.querySelector('.dp-cloud__leaf-copy');
    if (copy) {
      var prev = copy.querySelector('.dp-cloud__leaf-prev');
      if (!file.opened && trim(file.preview)) {
        if (!prev) {
          prev = document.createElement('span');
          prev.className = 'dp-cloud__leaf-prev';
          copy.appendChild(prev);
        }
        prev.textContent = file.preview;
      } else if (prev) {
        prev.remove();
      }
    }
    var body = leaf.querySelector('.dp-cloud__leaf-body');
    if (file.opened && trim(file.body)) {
      if (!body) {
        body = document.createElement('div');
        body.className = 'dp-cloud__leaf-body';
        leaf.appendChild(body);
      }
      body.textContent = file.body;
    } else if (body) {
      body.remove();
    }
  }

  function patchRecent(item) {
    if (!item) return;
    var el = findByDataId('#dp-cloud-stream [data-act="toggle-recent"]', item.id);
    if (!el) return;
    el.classList.toggle('is-open', !!item.opened);
    var copy = el.querySelector('.dp-cloud__tl-copy');
    if (!copy) return;
    var body = copy.querySelector('.dp-cloud__tl-body');
    var prev = copy.querySelector('.dp-cloud__tl-prev');
    if (item.opened && trim(item.body)) {
      if (prev) prev.remove();
      if (!body) {
        body = document.createElement('span');
        body.className = 'dp-cloud__tl-body';
        copy.appendChild(body);
      }
      body.textContent = item.body;
    } else {
      if (body) body.remove();
      if (trim(item.preview)) {
        if (!prev) {
          prev = document.createElement('span');
          prev.className = 'dp-cloud__tl-prev';
          copy.appendChild(prev);
        }
        prev.textContent = item.preview;
      } else if (prev) {
        prev.remove();
      }
    }
  }

  function patchSecret(item) {
    if (!item) return;
    var btn = findByDataId('#dp-cloud-stream [data-act="unlock-secret"]', item.id);
    var el = btn && btn.closest ? btn.closest('.dp-cloud__env') : null;
    if (!el) return;
    el.classList.toggle('is-open', !!item.unlocked);
    var cta = el.querySelector('.dp-cloud__env-cta');
    if (cta) cta.textContent = item.unlocked ? '收起' : '拆开';
    var body = el.querySelector('.dp-cloud__env-body');
    if (item.unlocked && trim(item.content)) {
      if (!body) {
        body = document.createElement('div');
        body.className = 'dp-cloud__env-body';
        el.appendChild(body);
      }
      body.textContent = item.content;
    } else if (body) {
      body.remove();
    }
  }

  function patchShared(item) {
    if (!item) return;
    var el = findByDataId('#dp-cloud-stream [data-act="toggle-shared"]', item.id);
    if (!el) return;
    el.classList.toggle('is-open', !!item.opened);
    var copy = el.querySelector('.dp-cloud__shelf-copy');
    if (!copy) return;
    var note = copy.querySelector('.dp-cloud__shelf-note');
    var body = copy.querySelector('.dp-cloud__shelf-body');
    if (item.opened) {
      if (note) note.remove();
      if (trim(item.content)) {
        if (!body) {
          body = document.createElement('span');
          body.className = 'dp-cloud__shelf-body';
          copy.appendChild(body);
        }
        body.textContent = item.content;
      } else if (body) {
        body.remove();
      }
    } else {
      if (body) body.remove();
      if (trim(item.note)) {
        if (!note) {
          note = document.createElement('span');
          note.className = 'dp-cloud__shelf-note';
          copy.appendChild(note);
        }
        note.textContent = item.note;
      } else if (note) {
        note.remove();
      }
    }
  }

  function patchVoice(item) {
    if (!item) return;
    var el = findByDataId('#dp-cloud-stream [data-act="toggle-voice"]', item.id);
    if (!el) return;
    el.classList.toggle('is-open', !!item.played);
    var copy = el.querySelector('.dp-cloud__voice-copy');
    if (!copy) return;
    var text = copy.querySelector('.dp-cloud__voice-text');
    var hint = copy.querySelector('.dp-cloud__voice-hint');
    if (item.played && trim(item.transcript)) {
      if (hint) hint.remove();
      if (!text) {
        text = document.createElement('span');
        text.className = 'dp-cloud__voice-text';
        copy.appendChild(text);
      }
      text.textContent = item.transcript;
    } else {
      if (text) text.remove();
      if (!hint) {
        hint = document.createElement('span');
        hint.className = 'dp-cloud__voice-hint';
        copy.appendChild(hint);
      }
      hint.textContent = '点开听转写';
    }
  }

  function patchDraft(item) {
    if (!item) return;
    var el = findByDataId('#dp-cloud-stream [data-act="toggle-draft"]', item.id);
    if (!el) return;
    el.classList.toggle('is-open', !!item.opened);
    var body = el.querySelector('.dp-cloud__draft-body');
    if (item.opened && trim(item.content)) {
      if (!body) {
        body = document.createElement('span');
        body.className = 'dp-cloud__draft-body';
        el.appendChild(body);
      }
      body.textContent = item.content;
    } else if (body) {
      body.remove();
    }
  }

  function selectBag(cl, id) {
    if (state.activeBagId === id) return;
    state.activeBagId = id;
    var active = ensureActiveBag(cl);
    var rail = $('dp-cloud-rail');
    if (rail) {
      var pouches = rail.querySelectorAll('.dp-cloud__pouch');
      var i;
      for (i = 0; i < pouches.length; i++) {
        pouches[i].classList.toggle('is-on', pouches[i].getAttribute('data-id') === id);
      }
    }
    var panel = $('dp-cloud-panel');
    if (panel) panel.innerHTML = buildSheetHtml(active);
  }

  function onRootClick(ev) {
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!btn) return;
    ev.preventDefault();
    var act = btn.getAttribute('data-act');
    var id = btn.getAttribute('data-id');
    var cl = getPayload();

    if (act === 'cloud-back') { close(); return; }
    if (act === 'cloud-refresh') { handleRefresh(); return; }

    if (!cl) return;

    if (act === 'select-bag') {
      selectBag(cl, id);
      return;
    }

    if (act === 'toggle-file' || act === 'pin-file') {
      var hit = findFileInBags(cl, id);
      if (!hit.file) return;
      if (act === 'pin-file') hit.file.pinned = !hit.file.pinned;
      else hit.file.opened = !hit.file.opened;
      patchLeaf(hit.file);
      persistPayload();
      return;
    }

    if (act === 'toggle-recent') {
      var rf = findIn(cl.recent, id);
      if (!rf) return;
      rf.opened = !rf.opened;
      patchRecent(rf);
      persistPayload();
      return;
    }

    if (act === 'unlock-secret') {
      var sec = findIn(cl.secrets, id);
      if (!sec) return;
      sec.unlocked = !sec.unlocked;
      patchSecret(sec);
      persistPayload();
      return;
    }

    if (act === 'toggle-shared') {
      var sh = findIn(cl.shared, id);
      if (!sh) return;
      sh.opened = !sh.opened;
      patchShared(sh);
      persistPayload();
      return;
    }

    if (act === 'toggle-voice') {
      var vc = findIn(cl.voices, id);
      if (!vc) return;
      vc.played = !vc.played;
      patchVoice(vc);
      persistPayload();
      return;
    }

    if (act === 'toggle-draft') {
      var dr = findIn(cl.drafts, id);
      if (!dr) return;
      dr.opened = !dr.opened;
      patchDraft(dr);
      persistPayload();
    }
  }

  function bindEvents() {
    var root = $('dp-cloud');
    if (!root || root._dpCloudBound) return;
    root._dpCloudBound = true;
    root.addEventListener('click', onRootClick);

    global.addEventListener('miya-deep-cloud-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      if (activeJobs[cid] || state.refreshing) return;
      loadCloudData(cid).then(function () { buildFullUI(); });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-cloud');
    if (!layer) return;
    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.activeBagId = '';
    state.refreshing = !!activeJobs[state.contactId];
    layer.removeAttribute('hidden');
    requestAnimationFrame(function () { layer.classList.add('is-open'); });
    loadCloudData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          cloudStore().patchCloud(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.cloudData = fixed;
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
    var layer = $('dp-cloud');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
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

  global.miyaDeepCloud = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
