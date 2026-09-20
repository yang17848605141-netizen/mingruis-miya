/**
 * miya-deep-album.js — 深入 · 角色手机 相册（iOS Photos 风）
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var CAT_LABEL = {
    favorite: '收藏',
    private: '私密',
    deleted: '已删除',
    memory: '回忆',
    recent: '最近',
    library: '图库'
  };

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    albumData: null,
    refreshing: false,
    tab: 'library',
    scale: 'all',
    filterType: '',
    flipPhotoId: ''
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;

  function albumStore() { return global.miyaDeepAlbumStore || null; }
  function albumBridge() { return global.miyaDeepAlbumBridge || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function trim(s) { return String(s || '').trim(); }

  function toast(msg) {
    var el = $('dp-album-toast');
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
    var text = $('dp-album-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的相册数据');
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
    var bar = $('dp-album-status');
    var text = $('dp-album-status-text');
    if (!bar || !text) return;
    var data = state.albumData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的相册数据';
      kind = 'loading';
    } else if (successFlashTimer) {
      msg = '相册已更新';
      kind = 'success';
    } else if (data && data.refreshStatus === 'error' && data.refreshMessage) {
      msg = data.refreshMessage;
      kind = 'error';
    }
    if (!msg) {
      stopStatusDots();
      bar.hidden = true;
      bar.className = 'dp-album__status';
      text.textContent = '';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-album__status is-' + kind;
    if (kind === 'loading') startStatusDots(msg);
    else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-album-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.albumData && state.albumData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function getPayload() {
    return state.albumData && state.albumData.album ? state.albumData.album : null;
  }

  function getPhotos() {
    var as = getPayload();
    return as && Array.isArray(as.photos) ? as.photos : [];
  }

  function hasContent() {
    return getPhotos().length > 0;
  }

  function findPhoto(id) {
    var found = null;
    getPhotos().forEach(function (p) {
      if (p && p.id === id) found = p;
    });
    return found;
  }

  function persistPayload() {
    var ts = albumStore();
    if (!ts || !state.contactId || !state.albumData) return Promise.resolve(null);
    return ts.patchAlbum(state.contactId, { album: state.albumData.album }).then(function (saved) {
      state.albumData = saved;
      return saved;
    });
  }

  function dateRangeLabel(photos) {
    var as = getPayload();
    if (as && trim(as.dateLabel)) return trim(as.dateLabel);
    var dates = (photos || []).map(function (p) { return trim(p.date); }).filter(Boolean);
    if (!dates.length) return '尚未读取';
    if (dates.length === 1) return dates[0];
    return dates[dates.length - 1] + ' - ' + dates[0];
  }

  function filterPhotos(photos) {
    var list = photos || [];
    if (state.filterType) {
      list = list.filter(function (p) { return p && p.category === state.filterType; });
    }
    if (state.scale === 'years') {
      var byYear = Object.create(null);
      list.forEach(function (p) {
        var y = (p.date || p.period || '').match(/(\d{4})/);
        var key = y ? y[1] : '未知';
        if (!byYear[key]) byYear[key] = p;
      });
      return Object.keys(byYear).sort().reverse().map(function (k) { return byYear[k]; });
    }
    if (state.scale === 'months') {
      var byMonth = Object.create(null);
      list.forEach(function (p) {
        var key = p.period || p.date || '未分期';
        if (!byMonth[key]) byMonth[key] = p;
      });
      return Object.keys(byMonth).map(function (k) { return byMonth[k]; });
    }
    return list;
  }

  function groupByPeriod(photos) {
    var groups = [];
    var map = Object.create(null);
    (photos || []).forEach(function (p) {
      var key = p.period || p.date || '未标注时间';
      if (!map[key]) {
        map[key] = { period: key, photos: [] };
        groups.push(map[key]);
      }
      map[key].photos.push(p);
    });
    return groups;
  }

  function photoBadge(p) {
    if (!p) return '';
    if (p.category === 'favorite') {
      return '<span class="dp-album__badge dp-album__badge--heart" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.2-4.6-9.4-8.1C.8 10.2 1.4 6.8 4.2 5.4 6.3 4.3 8.7 5 10 6.6 11.3 5 13.7 4.3 15.8 5.4c2.8 1.4 3.4 4.8 1.6 7.5C19.2 16.4 12 21 12 21z"/></svg>' +
      '</span>';
    }
    if (p.category === 'private') {
      return '<span class="dp-album__badge dp-album__badge--lock" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' +
      '</span>';
    }
    if (p.category === 'deleted') {
      return '<span class="dp-album__chip">已删除</span>';
    }
    return '';
  }

  function renderPhotoCell(p) {
    return (
      '<button type="button" class="dp-album__cell" data-act="open-photo" data-id="' + esc(p.id) + '" aria-label="' + esc(p.title || '照片') + '">' +
        '<span class="dp-album__cell-cover">' +
          photoBadge(p) +
          '<span class="dp-album__cell-grain" aria-hidden="true"></span>' +
        '</span>' +
      '</button>'
    );
  }

  function renderLibrary() {
    var el = $('dp-album-library');
    if (!el) return;
    var photos = filterPhotos(getPhotos());
    var as = getPayload();
    var hint = as && trim(as.storageHint) ? trim(as.storageHint) : '';

    if (!photos.length) {
      el.innerHTML =
        '<div class="dp-album__empty-inline">' +
          '<p>图库为空</p>' +
          '<span>点右上角刷新读取 ta 的相册</span>' +
        '</div>';
      return;
    }

    var groups = state.scale === 'all' ? groupByPeriod(photos) : [{ period: '', photos: photos }];
    var html =
      '<header class="dp-album__page-head">' +
        '<div class="dp-album__page-head-main">' +
          '<h1 class="dp-album__page-title">' + (state.filterType ? esc(CAT_LABEL[state.filterType] || '相簿') : '图库') + '</h1>' +
          '<p class="dp-album__page-sub">' + esc(dateRangeLabel(photos)) + '</p>' +
          (hint ? '<p class="dp-album__page-hint">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M7 18a5 5 0 0 1 0-10 6.5 6.5 0 0 1 12.5 2A4.5 4.5 0 0 1 18 18H7z"/></svg>' +
            esc(hint) +
          '</p>' : '') +
        '</div>' +
        '<div class="dp-album__page-actions">' +
          (state.filterType
            ? '<button type="button" class="dp-album__pill-btn" data-act="clear-filter">全部</button>'
            : '') +
          '<button type="button" class="dp-album__circle-btn" data-act="noop-filter" aria-label="视图">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h16M7 12h10M10 17h4"/></svg>' +
          '</button>' +
        '</div>' +
      '</header>';

    groups.forEach(function (g) {
      if (g.period) {
        html += '<div class="dp-album__period"><span>' + esc(g.period) + '</span><span>' + g.photos.length + '</span></div>';
      }
      html += '<div class="dp-album__grid">' + g.photos.map(renderPhotoCell).join('') + '</div>';
    });

    el.innerHTML = html;
  }

  function memoryCoverTone(i) {
    var tones = ['tone-a', 'tone-b', 'tone-c', 'tone-d'];
    return tones[i % tones.length];
  }

  function renderFeatured() {
    var el = $('dp-album-featured');
    if (!el) return;
    var as = getPayload();
    var photos = getPhotos();
    if (!photos.length) {
      el.innerHTML =
        '<div class="dp-album__empty-inline">' +
          '<p>精选集为空</p>' +
          '<span>点右上角刷新读取 ta 的相册</span>' +
        '</div>';
      return;
    }

    var memories = (as && as.memories) || [];
    var albums = (as && as.albums) || [];
    var pinned = albums.filter(function (a) {
      return a && (a.type === 'favorite' || a.type === 'recent' || a.type === 'private' || a.type === 'deleted');
    });
    if (!pinned.length) {
      pinned = [
        { id: 'pin-fav', name: '个人收藏', type: 'favorite', count: photos.filter(function (p) { return p.category === 'favorite'; }).length },
        { id: 'pin-recent', name: '最近保存', type: 'recent', count: photos.filter(function (p) { return p.category === 'recent'; }).length },
        { id: 'pin-private', name: '私密', type: 'private', count: photos.filter(function (p) { return p.category === 'private'; }).length },
        { id: 'pin-deleted', name: '最近删除', type: 'deleted', count: photos.filter(function (p) { return p.category === 'deleted'; }).length }
      ].filter(function (a) { return a.count > 0; });
    }

    var memPhotos = photos.filter(function (p) { return p.category === 'memory'; });
    if (!memories.length && memPhotos.length) {
      memories = memPhotos.slice(0, 4).map(function (p, i) {
        return {
          id: 'auto-mem-' + i,
          title: p.location || p.title || '回忆',
          subtitle: p.date || p.period || '',
          location: p.location || '',
          coverPhotoId: p.id
        };
      });
    }

    var hint = as && trim(as.storageHint) ? trim(as.storageHint) : '储存空间已满 · 获取更多储存空间';
    var html =
      '<header class="dp-album__page-head">' +
        '<div class="dp-album__page-head-main">' +
          '<h1 class="dp-album__page-title">精选集</h1>' +
          '<p class="dp-album__page-hint">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M7 18a5 5 0 0 1 0-10 6.5 6.5 0 0 1 12.5 2A4.5 4.5 0 0 1 18 18H7z"/></svg>' +
            esc(hint) +
          '</p>' +
        '</div>' +
      '</header>';

    if (memories.length) {
      html +=
        '<section class="dp-album__section">' +
          '<div class="dp-album__section-head">' +
            '<h2>回忆</h2>' +
            '<span class="dp-album__chev" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="dp-album__mem-rail">' +
            memories.map(function (m, i) {
              var cover = findPhoto(m.coverPhotoId) || memPhotos[i] || photos[i];
              return (
                '<button type="button" class="dp-album__mem-card ' + memoryCoverTone(i) + '" data-act="open-photo" data-id="' + esc(cover ? cover.id : '') + '">' +
                  '<span class="dp-album__mem-veil" aria-hidden="true"></span>' +
                  '<span class="dp-album__mem-meta">' +
                    '<strong>' + esc(m.location || m.title) + '</strong>' +
                    '<em>' + esc(m.subtitle || (cover && cover.date) || '') + '</em>' +
                  '</span>' +
                  '<span class="dp-album__mem-play" aria-hidden="true"></span>' +
                '</button>'
              );
            }).join('') +
          '</div>' +
        '</section>';
    }

    if (pinned.length) {
      html +=
        '<section class="dp-album__section">' +
          '<div class="dp-album__section-head">' +
            '<h2>固定</h2>' +
            '<span class="dp-album__edit-pill">编辑</span>' +
          '</div>' +
          '<div class="dp-album__pin-rail">' +
            pinned.map(function (a) {
              return (
                '<button type="button" class="dp-album__pin-card" data-act="filter-type" data-type="' + esc(a.type) + '">' +
                  '<span class="dp-album__pin-cover tone-' + esc(a.type) + '">' +
                    (a.type === 'favorite' ? '<span class="dp-album__pin-heart" aria-hidden="true"></span>' : '') +
                    (a.type === 'private' ? '<span class="dp-album__pin-lock" aria-hidden="true"></span>' : '') +
                  '</span>' +
                  '<span class="dp-album__pin-name">' + esc(a.name) + '</span>' +
                  '<span class="dp-album__pin-count">' + (a.count || 0) + '</span>' +
                '</button>'
              );
            }).join('') +
          '</div>' +
        '</section>';
    }

    html +=
      '<section class="dp-album__section">' +
        '<div class="dp-album__section-head">' +
          '<h2>相簿</h2>' +
          '<span class="dp-album__chev" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="dp-album__pin-rail">' +
          (albums.length ? albums : pinned).map(function (a) {
            return (
              '<button type="button" class="dp-album__pin-card" data-act="filter-type" data-type="' + esc(a.type || 'library') + '">' +
                '<span class="dp-album__pin-cover tone-' + esc(a.type || 'library') + '"></span>' +
                '<span class="dp-album__pin-name">' + esc(a.name) + '</span>' +
                '<span class="dp-album__pin-count">' + (a.count || 0) + '</span>' +
              '</button>'
            );
          }).join('') +
        '</div>' +
      '</section>';

    el.innerHTML = html;
  }

  function updateTabs() {
    var root = $('dp-album');
    if (!root) return;
    root.setAttribute('data-tab', state.tab);
    root.querySelectorAll('[data-act="tab"]').forEach(function (btn) {
      var t = btn.getAttribute('data-tab');
      btn.classList.toggle('is-active', t === state.tab);
      btn.setAttribute('aria-selected', t === state.tab ? 'true' : 'false');
    });
    var lib = $('dp-album-library');
    var feat = $('dp-album-featured');
    if (lib) lib.hidden = state.tab !== 'library';
    if (feat) feat.hidden = state.tab !== 'featured';
  }

  function updateScaleBar() {
    var bar = $('dp-album-scale');
    if (!bar) return;
    bar.hidden = state.tab !== 'library';
    bar.querySelectorAll('[data-act="scale"]').forEach(function (btn) {
      var s = btn.getAttribute('data-scale');
      btn.classList.toggle('is-active', s === state.scale);
    });
  }

  function closeFlip() {
    var overlay = $('dp-album-flip');
    if (!overlay) return;
    overlay.classList.remove('is-open', 'is-flipped');
    overlay.setAttribute('hidden', '');
    state.flipPhotoId = '';
  }

  function openFlip(photoId) {
    var photo = findPhoto(photoId);
    if (!photo) return;
    var overlay = $('dp-album-flip');
    var card = $('dp-album-flip-card');
    if (!overlay || !card) return;
    state.flipPhotoId = photoId;
    card.innerHTML =
      '<div class="dp-album__flip-face dp-album__flip-face--back">' +
        '<span class="dp-album__flip-gray" aria-hidden="true"></span>' +
      '</div>' +
      '<div class="dp-album__flip-face dp-album__flip-face--front">' +
        '<div class="dp-album__flip-body">' +
          '<div class="dp-album__flip-top">' +
            '<span class="dp-album__flip-cat">' + esc(CAT_LABEL[photo.category] || '照片') + '</span>' +
            '<span class="dp-album__flip-views">翻看 ' + esc(String(photo.viewCount || 0)) + ' 次</span>' +
          '</div>' +
          '<h3 class="dp-album__flip-title">' + esc(photo.title) + '</h3>' +
          '<p class="dp-album__flip-desc">' + esc(photo.description || '（无画面描写）') + '</p>' +
          (photo.mood ? '<div class="dp-album__flip-mood"><span>心境</span><p>' + esc(photo.mood) + '</p></div>' : '') +
          '<div class="dp-album__flip-meta">' +
            (photo.date ? '<span>' + esc(photo.date) + (photo.time ? ' · ' + esc(photo.time) : '') + '</span>' : '') +
            (photo.period ? '<span>' + esc(photo.period) + '</span>' : '') +
            (photo.location ? '<span>' + esc(photo.location) + '</span>' : '') +
          '</div>' +
          '<p class="dp-album__flip-hint">轻触任意处关闭</p>' +
        '</div>' +
      '</div>';

    overlay.removeAttribute('hidden');
    overlay.classList.add('is-open');
    overlay.classList.remove('is-flipped');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('is-flipped');
      });
    });

    photo.opened = true;
    persistPayload();
  }

  function buildFullUI() {
    var empty = $('dp-album-empty');
    var main = $('dp-album-main');
    var has = hasContent();
    if (empty) empty.hidden = !!has;
    if (main) main.hidden = !has;
    if (has) {
      renderLibrary();
      renderFeatured();
      updateTabs();
      updateScaleBar();
    } else {
      closeFlip();
    }
    updateStatusBar();
    updateRefreshBtn();
  }

  function loadAlbumData(contactId) {
    var ts = albumStore();
    if (!ts) return Promise.resolve(null);
    return ts.getAlbum(contactId).then(function (data) {
      state.albumData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-album-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];
    var ts = albumStore();
    var br = albumBridge();
    if (!ts || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ts.patchAlbum(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的相册数据',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.albumData = data;
        state.refreshing = true;
        updateStatusBar();
        updateRefreshBtn();
      }
      return br.generateAlbum(contactId, phoneData, {});
    }).then(function (result) {
      return ts.patchAlbum(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        album: result
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.albumData = saved;
        state.refreshing = false;
        state.filterType = '';
        if (state.open) {
          buildFullUI();
          showSuccessFlash();
          toast('已读取 ' + (saved.album && saved.album.photos ? saved.album.photos.length : 0) + ' 张照片');
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ts.patchAlbum(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.albumData = saved;
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
    if (state.refreshing || (state.albumData && state.albumData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;
    state.refreshing = true;
    updateStatusBar();
    updateRefreshBtn();
    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function onRootClick(ev) {
    var flip = $('dp-album-flip');
    if (flip && flip.classList.contains('is-open')) {
      ev.preventDefault();
      closeFlip();
      return;
    }

    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');

    if (act === 'album-back') { close(); return; }
    if (act === 'album-refresh') { handleRefresh(); return; }
    if (act === 'tab') {
      state.tab = btn.getAttribute('data-tab') || 'library';
      if (state.tab === 'featured') state.filterType = '';
      updateTabs();
      updateScaleBar();
      if (state.tab === 'library') renderLibrary();
      return;
    }
    if (act === 'scale') {
      state.scale = btn.getAttribute('data-scale') || 'all';
      updateScaleBar();
      renderLibrary();
      return;
    }
    if (act === 'open-photo') {
      var id = btn.getAttribute('data-id');
      if (id) openFlip(id);
      return;
    }
    if (act === 'filter-type') {
      state.filterType = btn.getAttribute('data-type') || '';
      state.tab = 'library';
      updateTabs();
      updateScaleBar();
      renderLibrary();
      return;
    }
    if (act === 'clear-filter') {
      state.filterType = '';
      renderLibrary();
    }
  }

  function bindEvents() {
    var root = $('dp-album');
    if (!root || root._dpAlbumBound) return;
    root._dpAlbumBound = true;
    root.addEventListener('click', onRootClick);

    global.addEventListener('miya-deep-album-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      if (activeJobs[cid] || state.refreshing) return;
      loadAlbumData(cid).then(function () { buildFullUI(); });
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-album');
    if (!layer) return;
    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.tab = 'library';
    state.scale = 'all';
    state.filterType = '';
    state.refreshing = !!activeJobs[state.contactId];
    layer.removeAttribute('hidden');
    requestAnimationFrame(function () { layer.classList.add('is-open'); });
    loadAlbumData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          albumStore().patchAlbum(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.albumData = fixed;
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
    var layer = $('dp-album');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    closeFlip();
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

  global.miyaDeepAlbum = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
