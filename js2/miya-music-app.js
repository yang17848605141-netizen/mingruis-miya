/**
 * miya-music-app.js — 网易云 UI + miyaMusicEngine
 */
(function (global) {
  'use strict';

  var eng = global.miyaMusicEngine;
  if (!eng) return;

  var LIKED_PL_NAME = '我喜欢的音乐';
  var USER_LABEL = 'miya';

  var currentTab = 'home';
  var tabBeforeAppearance = 'home';
  var engineReady = false;
  var cloudPollTimer = null;
  var ui = {
    sheetMode: '',
    cloudPhase: 'login',
    cloudQr: {},
    cloudPlaylists: [],
    searchResults: [],
    searchBusy: false,
    importBusy: false,
    viewPlaylistId: '',
    localPendingFile: null,
    lyricsMode: false,
    discoverHome: null,
    discoverLoading: false,
    discoverTracks: [],
    discoverDetailTitle: ''
  };

  var statusTimer = null;
  var lyricsRenderKey = '';
  var progressScrubbing = false;
  var progressScrubRatio = 0;
  var uiCache = {};

  function $(id) { return document.getElementById(id); }

  function esc(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var div = document.createElement('div');
    div.className = 'ncm-toast';
    div.textContent = msg;
    document.body.appendChild(div);
    requestAnimationFrame(function () { div.classList.add('is-visible'); });
    setTimeout(function () {
      div.classList.remove('is-visible');
      setTimeout(function () { div.remove(); }, 350);
    }, 2200);
  }

  function isStatusLoading(msg) {
    return /(?:…|\.\.\.)$|[中在]…|正在|请稍候|拉取|上传中|搜索中|解析中|导入中/.test(msg);
  }

  function clearStatus() {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    var el = $('ncm-status');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  function isBenignPlayError(e) {
    var msg = (e && e.message ? e.message : String(e || '')).toLowerCase();
    return /play\(\) request was interrupted|interrupted by a call to pause|interrupted by a new load|the operation was aborted|aborterror/i.test(msg);
  }

  function isCompletionStatus(msg) {
    return /^(播放 ·|找到 \d+|已解析|已上传|歌单导入完成|导入完成)/.test(String(msg || '').trim());
  }

  function setStatus(text, kind) {
    var el = $('ncm-status');
    if (!el) return;
    var msg = String(text || '').trim();
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    if (kind === 'ok' || isCompletionStatus(msg)) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    if (kind === 'err' && isBenignPlayError(msg)) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.className = 'ncm-status ncm-status--' + (kind || 'info');
    if (kind === 'err') toast(msg);
    if (!isStatusLoading(msg)) {
      var delay = kind === 'err' ? 4000 : 2600;
      statusTimer = setTimeout(function () {
        statusTimer = null;
        if (el.textContent === msg) clearStatus();
      }, delay);
    }
  }

  function fmtErr(e) {
    if (!e) return '出错了';
    if (typeof e === 'string') return e;
    if (isBenignPlayError(e)) return '';
    return e.message || String(e);
  }

  function pauseSvg() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  }

  function playSvg() {
    return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }

  function coverStyle(track) {
    var hues = ['#e74c3c', '#3498db', '#9b59b6', '#27ae60', '#e67e22', '#1abc9c'];
    var h = 0;
    var s = String((track && track.id) || '');
    for (var i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % hues.length;
    return 'background:linear-gradient(135deg,' + hues[h] + ',' + hues[(h + 2) % hues.length] + ')';
  }

  function normalizeCoverUrl(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    if (u.indexOf('//') === 0) u = 'https:' + u;
    u = u.replace(/^http:\/\//i, 'https://');
    if (/music\.126\.net/i.test(u) && u.indexOf('param=') < 0) {
      u += (u.indexOf('?') >= 0 ? '&' : '?') + 'param=300y300';
    }
    return u;
  }

  function coverImgHtml(coverUrl, track, cls) {
    var u = normalizeCoverUrl(coverUrl);
    if (u) {
      return '<img class="' + cls + '" src="' + esc(u) + '" alt="" loading="lazy" referrerpolicy="no-referrer" crossorigin="anonymous">';
    }
    return '<span class="' + cls + ' ncm-track-cover--placeholder" style="' + coverStyle(track || { id: cls }) + '"></span>';
  }

  function cardCoverImgHtml(cover, cls) {
    var u = normalizeCoverUrl(cover);
    if (!u) return '';
    return '<img class="' + cls + '" src="' + esc(u) + '" alt="" loading="lazy" referrerpolicy="no-referrer" crossorigin="anonymous">';
  }

  function cardFallbackStyle(fallbackHue) {
    return 'background:linear-gradient(160deg,' + fallbackHue + ' 0%,#111 100%);';
  }

  function ensureLikedPlaylist() {
    var data = eng.getData();
    var pl = data.playlists.find(function (p) { return p && p.name === LIKED_PL_NAME; });
    if (!pl) pl = eng.createPlaylist(LIKED_PL_NAME);
    return pl;
  }

  function getUserName() {
    var ap = eng.getAppearance && eng.getAppearance();
    if (ap && ap.profileNickname) return ap.profileNickname;
    var ses = eng.getNeteaseSession();
    return ses && ses.nickname ? ses.nickname : USER_LABEL;
  }

  function selectPlayMode(mode, opts) {
    opts = opts || {};
    eng.setPlayMode(mode);
    toast('播放模式：' + eng.getPlayModeLabel(eng.getData().playMode));
    tickUi();
    if (opts.closeSheet) closeSheet();
  }

  function renderPlayModeSheetButtons() {
    var mode = eng.getData().playMode;
    return ['order', 'random', 'single'].map(function (m) {
      var label = eng.getPlayModeLabel(m);
      var active = mode === m ? ' ncm-sheet-btn--active' : '';
      var mark = mode === m ? ' ✓' : '';
      return '<button type="button" class="ncm-sheet-btn' + active + '" data-ncm-set-mode="' + m + '">' + esc(label) + mark + '</button>';
    }).join('');
  }

  function tickUi(force) {
    var snap = eng.buildSnapshot();
    var titleEl = $('ncm-song-title');
    var artistEl = $('ncm-song-artist');
    var tagEl = $('ncm-song-tag');
    var miniInfo = $('ncm-mini-info');
    var vinylLabel = $('ncm-vinyl-label');
    var durEl = $('ncm-progress-dur');
    var curEl = $('ncm-progress-cur');
    var fill = $('ncm-progress-fill');
    var dot = $('ncm-progress-dot');
    var vinyl = $('ncm-vinyl');
    var miniDisc = $('ncm-mini-disc');
    var playBtn = $('ncm-ctrl-play');
    var miniPlay = $('ncm-mini-play');
    var modeBtn = $('ncm-song-mode');
    var modeIcon = $('ncm-song-mode-icon');
    var vinylCoverImg = $('ncm-vinyl-cover-img');
    var vinylCover = document.querySelector('.ncm-vinyl__cover');

    var title = snap.title || '未在播放';
    var artist = snap.artist || '—';
    if (uiCache.title !== title) {
      uiCache.title = title;
      if (titleEl) titleEl.textContent = title;
    }
    if (uiCache.artist !== artist) {
      uiCache.artist = artist;
      if (artistEl) artistEl.textContent = artist;
    }
    var miniText = snap.title ? title + ' - ' + artist : '未在播放';
    if (uiCache.miniText !== miniText) {
      uiCache.miniText = miniText;
      if (miniInfo) miniInfo.textContent = miniText;
    }
    if (vinylLabel && snap.title) {
      var labelKey = title + '|' + artist;
      if (uiCache.vinylLabel !== labelKey) {
        uiCache.vinylLabel = labelKey;
        vinylLabel.innerHTML = esc(title).slice(0, 12) + '<br>' + esc(title) + ' | ' + esc(artist);
      }
    }
    if (tagEl) {
      var lyricLine = snap.lyricLine || '';
      if (uiCache.lyricLine !== lyricLine) {
        uiCache.lyricLine = lyricLine;
        if (lyricLine) {
          tagEl.hidden = false;
          tagEl.textContent = lyricLine;
        } else {
          tagEl.hidden = true;
        }
      }
    }

    var dur = snap.duration || 0;
    var cur = progressScrubbing ? progressScrubRatio * dur : (snap.currentTime || 0);
    var durText = eng.formatTime(dur);
    if (uiCache.durText !== durText) {
      uiCache.durText = durText;
      if (durEl) durEl.textContent = durText;
    }
    var curText = eng.formatTime(cur);
    var progressKey = progressScrubbing
      ? 'scrub|' + Math.round(progressScrubRatio * 1000)
      : 'play|' + Math.round(cur * 4) + '|' + Math.round(dur);
    if (force || progressScrubbing || uiCache.progressKey !== progressKey) {
      uiCache.progressKey = progressKey;
      if (curEl) curEl.textContent = curText;
      var pct = progressScrubbing
        ? Math.min(100, progressScrubRatio * 100)
        : (dur > 0 ? Math.min(100, (cur / dur) * 100) : 0);
      if (fill) fill.style.width = pct + '%';
      if (dot) dot.style.left = pct + '%';
    }

    var playing = snap.isPlaying;
    if (uiCache.playing !== playing) {
      uiCache.playing = playing;
      if (vinyl) vinyl.classList.toggle('is-paused', !playing);
      if (miniDisc) miniDisc.classList.toggle('is-paused', !playing);
      if (playBtn) playBtn.innerHTML = playing ? pauseSvg() : playSvg();
      if (miniPlay) miniPlay.innerHTML = playing ? pauseSvg() : playSvg();
    }
    var playMode = snap.playMode;
    if (uiCache.playMode !== playMode) {
      uiCache.playMode = playMode;
      if (modeIcon) modeIcon.innerHTML = eng.getPlayModeSvg(playMode);
      if (modeBtn) modeBtn.setAttribute('aria-label', eng.getPlayModeLabel(playMode));
    }
    if (vinylCoverImg && vinylCover) {
      var customVinyl = global.MiyaMusicBeautify && global.MiyaMusicBeautify.getVinylCoverUrl();
      var cover = customVinyl || normalizeCoverUrl(snap.coverUrl);
      if (uiCache.cover !== cover) {
        uiCache.cover = cover;
        if (cover) {
          vinylCoverImg.src = cover;
          vinylCoverImg.hidden = false;
          vinylCover.classList.add('has-artwork');
        } else {
          vinylCoverImg.removeAttribute('src');
          vinylCoverImg.hidden = true;
          vinylCover.classList.remove('has-artwork');
        }
      }
    }
    if (miniDisc) {
      var customVinylMini = global.MiyaMusicBeautify && global.MiyaMusicBeautify.getVinylCoverUrl();
      var miniCover = customVinylMini || (snap.coverUrl ? normalizeCoverUrl(snap.coverUrl) : '');
      if (uiCache.miniCover !== miniCover) {
        uiCache.miniCover = miniCover;
        if (miniCover) {
          miniDisc.style.backgroundImage = 'url(' + miniCover + ')';
          miniDisc.style.backgroundSize = 'cover';
          miniDisc.style.backgroundPosition = 'center';
        } else {
          miniDisc.style.backgroundImage = '';
        }
      }
    }
    eng.updateLyricsActive(cur);
    if (ui.lyricsMode) updateLyricsView();
    if (global.MiyaDesktopLyrics && global.MiyaDesktopLyrics.isEnabled()) global.MiyaDesktopLyrics.tick();
    if (global.MiyaMusicListenTogether) global.MiyaMusicListenTogether.onMusicTick();
  }

  function setLyricsMode(on) {
    ui.lyricsMode = !!on;
    lyricsRenderKey = '';
    updateLyricsView._lastIdx = -1;
    var wrap = document.querySelector('.ncm-vinyl-wrap');
    var vinyl = $('ncm-vinyl');
    if (wrap) wrap.classList.toggle('is-lyrics-mode', ui.lyricsMode);
    if (vinyl) vinyl.setAttribute('aria-label', ui.lyricsMode ? '返回唱片' : '查看歌词');
    if (ui.lyricsMode) updateLyricsView(true);
  }

  function toggleLyricsMode() {
    setLyricsMode(!ui.lyricsMode);
  }

  function updateLyricsView(forceScroll) {
    var panel = $('ncm-lyrics-panel');
    var listEl = $('ncm-lyrics-list');
    var scrollEl = $('ncm-lyrics-scroll');
    if (!panel || !listEl || !scrollEl || !ui.lyricsMode) return;

    var lines = eng.getParsedLrc();
    var nowId = (eng.getData().nowPlaying && eng.getData().nowPlaying.id) || '';
    var renderKey = nowId + '|' + lines.length + '|' + (lines[lines.length - 1] && lines[lines.length - 1].text || '');
    if (renderKey !== lyricsRenderKey) {
      lyricsRenderKey = renderKey;
      if (!lines.length) {
        listEl.innerHTML = '<p class="ncm-lyrics-empty">暂无歌词<br><span>点击返回唱片</span></p>';
      } else {
        listEl.innerHTML = lines.map(function (row, i) {
          return '<p class="ncm-lyrics-line" data-lrc-idx="' + i + '">' + esc(row.text) + '</p>';
        }).join('');
      }
    }

    var idx = eng.getLyricsActiveIndex();
    listEl.querySelectorAll('.ncm-lyrics-line').forEach(function (node) {
      var i = Number(node.getAttribute('data-lrc-idx'));
      node.classList.toggle('is-active', i === idx);
      node.classList.toggle('is-near', idx >= 0 && Math.abs(i - idx) === 1);
    });

    var activeEl = idx >= 0 ? listEl.querySelector('.ncm-lyrics-line.is-active') : null;
    if (activeEl && (forceScroll || idx !== updateLyricsView._lastIdx)) {
      updateLyricsView._lastIdx = idx;
      var top = activeEl.offsetTop - (scrollEl.clientHeight - activeEl.offsetHeight) / 2;
      scrollEl.scrollTop = Math.max(0, top);
    }
    if (idx < 0) updateLyricsView._lastIdx = -1;
  }

  function setTheme(tab) {
    var app = $('miya-music-app');
    if (!app) return;
    var theme = tab === 'home' ? 'player' : (tab === 'notes' ? 'listen' : 'light');
    app.setAttribute('data-theme', theme);
  }

  function closeAppearancePage() {
    if (global.MiyaMusicBeautify) global.MiyaMusicBeautify.closePage();
    var app = $('miya-music-app');
    if (app) app.classList.remove('is-appearance-open');
    switchTab(tabBeforeAppearance || 'home', { skipAppearanceClose: true });
  }

  function openAppearancePage() {
    tabBeforeAppearance = currentTab === 'appearance' ? tabBeforeAppearance : currentTab;
    currentTab = 'appearance';
    if (global.MiyaMusicBeautify) global.MiyaMusicBeautify.openPage();
    document.querySelectorAll('.ncm-page').forEach(function (page) {
      page.classList.remove('is-active');
    });
    setTheme('light');
  }

  function switchTab(tab, opts) {
    opts = opts || {};
    if (tab === 'appearance') {
      openAppearancePage();
      return;
    }
    if (!opts.skipAppearanceClose && currentTab === 'appearance') {
      if (global.MiyaMusicBeautify) global.MiyaMusicBeautify.closePage();
      var appEl = $('miya-music-app');
      if (appEl) appEl.classList.remove('is-appearance-open');
    }
    currentTab = tab;
    if (tab !== 'home' && ui.lyricsMode) setLyricsMode(false);
    setTheme(tab);
    document.querySelectorAll('.ncm-page').forEach(function (page) {
      page.classList.toggle('is-active', page.getAttribute('data-ncm-page') === tab);
    });
    document.querySelectorAll('.ncm-tabbar__item').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-ncm-tab') === tab);
    });
    if (tab === 'mine') {
      renderMinePlaylists();
    } else {
      setPlaylistDetailShell(false);
    }
    if (tab === 'search') {
      if ($('ncm-search-input')) $('ncm-search-input').focus();
      loadDiscoverHome();
    }
    if (tab === 'notes' && global.MiyaMusicListenTogether) {
      if (engineReady) global.MiyaMusicListenTogether.render();
      else {
        initEngine().then(function () {
          global.MiyaMusicListenTogether.render();
        }).catch(function () {
          global.MiyaMusicListenTogether.render();
        });
      }
    }
    if (global.MiyaMusicListenTogether && global.MiyaMusicListenTogether.syncShellChrome) {
      global.MiyaMusicListenTogether.syncShellChrome();
    }
  }

  function openSheet(title, html) {
    var ov = $('ncm-overlay');
    var body = $('ncm-sheet-body');
    var tit = $('ncm-sheet-title');
    if (!ov || !body) return;
    if (tit) tit.textContent = title || '';
    body.innerHTML = html || '';
    ov.hidden = false;
    bindSheetDynamic();
  }

  function closeSheet() {
    stopCloudPoll();
    var ov = $('ncm-overlay');
    if (ov) ov.hidden = true;
    ui.sheetMode = '';
    var body = $('ncm-sheet-body');
    if (body) body.innerHTML = '';
  }

  function stopCloudPoll() {
    if (cloudPollTimer) {
      clearInterval(cloudPollTimer);
      cloudPollTimer = null;
    }
  }

  function renderMinePlaylists() {
    var list = $('ncm-playlist-list');
    var countEl = $('ncm-pl-count');
    var nameEl = $('ncm-profile-name');
    if (!list) return;

    ensureLikedPlaylist();
    var data = eng.getData();
    var user = getUserName();
    if (nameEl) nameEl.textContent = user;

    var pls = data.playlists.slice();
    var liked = pls.find(function (p) { return p.name === LIKED_PL_NAME; });
    var others = pls.filter(function (p) { return p.name !== LIKED_PL_NAME; });
    if (countEl) countEl.textContent = '创建 ' + others.length;

    var html = '';
    if (liked) {
      var n = (liked.trackIds || []).length;
      html +=
        '<div class="ncm-playlist-item" data-ncm-open-pl="' + esc(liked.id) + '">' +
        '<div class="ncm-playlist-item__cover ncm-playlist-item__cover--heart">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.5-9-9a5.5 5.5 0 019-3 5.5 5.5 0 019 3c-2 4.5-9 9-9 9z"/></svg></div>' +
        '<div class="ncm-playlist-item__info"><p class="ncm-playlist-item__title">' + esc(LIKED_PL_NAME) + '</p>' +
        '<p class="ncm-playlist-item__meta">' + n + ' 首</p></div>' +
        '<div class="ncm-playlist-item__extra"><button type="button" class="ncm-playlist-item__mode" data-ncm-play-liked>心动模式</button></div></div>';
    }

    others.forEach(function (pl) {
      var cnt = (pl.trackIds || []).length;
      html +=
        '<div class="ncm-playlist-item" data-ncm-open-pl="' + esc(pl.id) + '">' +
        '<div class="ncm-playlist-item__cover" style="' + coverStyle({ id: pl.id }) + '"></div>' +
        '<div class="ncm-playlist-item__info"><p class="ncm-playlist-item__title">' + esc(pl.name) + '</p>' +
        '<p class="ncm-playlist-item__meta">歌单 · ' + cnt + ' 首 · ' + esc(user) + '</p></div>' +
        '<button type="button" class="ncm-playlist-item__more" data-ncm-pl-menu="' + esc(pl.id) + '" aria-label="更多">' +
        '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg></button></div>';
    });

    if (!html) {
      html = '<p class="ncm-empty">还没有歌单，点「新建」或「导入」开始吧</p>';
    }
    list.innerHTML = html;
    list.hidden = !!ui.viewPlaylistId;
    setPlaylistDetailShell(!!ui.viewPlaylistId);
  }

  function setPlaylistDetailShell(open) {
    var appEl = $('miya-music-app');
    if (appEl) appEl.classList.toggle('is-pl-detail', open);
    var detail = $('ncm-pl-detail');
    if (detail) detail.hidden = !open;
  }

  function openPlaylistDetail(plId) {
    var data = eng.getData();
    var pl = data.playlists.find(function (p) { return p.id === plId; });
    if (!pl) return;
    ui.viewPlaylistId = plId;
    eng.setActivePlaylistId(plId);
    var tracks = (pl.trackIds || [])
      .map(function (tid) { return data.library.find(function (t) { return t && t.id === tid; }); })
      .filter(Boolean);

    var list = $('ncm-playlist-list');
    var titleEl = $('ncm-pl-detail-title');
    var tracksEl = $('ncm-pl-detail-tracks');
    if (list) list.hidden = true;
    setPlaylistDetailShell(true);
    if (titleEl) titleEl.textContent = pl.name;
    if (!tracksEl) return;

    if (!tracks.length) {
      tracksEl.innerHTML = '<p class="ncm-empty">歌单是空的</p>';
      return;
    }

    tracksEl.innerHTML = tracks.map(function (t, i) {
      return (
        '<button type="button" class="ncm-track-row" data-ncm-play-id="' + esc(t.id) + '">' +
        coverImgHtml(t.coverUrl, t, 'ncm-track-row__cover') +
        '<span class="ncm-track-row__idx">' + (i + 1) + '</span>' +
        '<span class="ncm-track-row__main"><b>' + esc(t.title) + '</b><em>' + esc(t.artist || '未知歌手') + '</em></span>' +
        '<span class="ncm-track-row__play">▶</span></button>'
      );
    }).join('');
  }

  function showDiscoverDetail(show) {
    var detail = $('ncm-discover-detail');
    var home = $('ncm-discover-home');
    if (detail) detail.hidden = !show;
    if (home) home.hidden = !!show;
  }

  function closeDiscoverDetail() {
    ui.discoverTracks = [];
    ui.discoverDetailTitle = '';
    showDiscoverDetail(false);
  }

  function renderDiscoverTrackRows(tracks) {
    return tracks.map(function (row, i) {
      return (
        '<div class="ncm-search-item">' +
        coverImgHtml(row.coverUrl, row, 'ncm-search-item__cover') +
        '<button type="button" class="ncm-search-item__main ncm-search-item__main--btn" data-ncm-discover-play="' + i + '">' +
        '<b>' + esc(row.title) + '</b><em>' + esc(row.artist || '未知歌手') + '</em></button>' +
        '<div class="ncm-search-item__acts">' +
        '<button type="button" class="ncm-search-item__btn ncm-search-item__btn--play" data-ncm-discover-play="' + i + '">播放</button>' +
        '<button type="button" class="ncm-search-item__btn ncm-search-item__btn--solid" data-ncm-discover-add="' + i + '">加入</button>' +
        '</div></div>'
      );
    }).join('');
  }

  async function openDiscoverDetail(kind, id, title) {
    setStatus('加载中…');
    try {
      var tracks = await eng.fetchNeteaseDiscoverTracks(kind, id);
      if (!tracks.length) {
        setStatus('暂无内容', 'err');
        return;
      }
      ui.discoverTracks = tracks;
      ui.discoverDetailTitle = title || '推荐';
      var titleEl = $('ncm-discover-detail-title');
      var tracksEl = $('ncm-discover-detail-tracks');
      if (titleEl) titleEl.textContent = ui.discoverDetailTitle;
      if (tracksEl) tracksEl.innerHTML = renderDiscoverTrackRows(tracks);
      showDiscoverDetail(true);
      clearStatus();
    } catch (e) {
      setStatus(fmtErr(e), 'err');
    }
  }

  function renderDiscoverHome(data) {
    var box = $('ncm-discover-home');
    if (!box) return;
    data = data || ui.discoverHome;
    if (!data) {
      box.innerHTML = '<p class="ncm-discover-loading">加载推荐中…</p>';
      return;
    }

    var quickHtml = (data.quickCards || []).map(function (card, i) {
      var hues = ['#3d2a5c', '#4a1520', '#5c4030'];
      var hue = hues[i % hues.length];
      var hasCover = !!normalizeCoverUrl(card.cover);
      var style = hasCover ? '' : cardFallbackStyle(hue);
      var attrs = ' data-ncm-discover-card="' + i + '"';
      return (
        '<button type="button" class="ncm-quick-card"' + attrs + (style ? ' style="' + style + '"' : '') + '>' +
        cardCoverImgHtml(card.cover, 'ncm-quick-card__img') +
        '<div class="ncm-quick-card__text"><p class="ncm-quick-card__title">' + esc(card.title) + '</p>' +
        '<p class="ncm-quick-card__sub">' + esc(card.sub || '') + '</p></div></button>'
      );
    }).join('');

    var browseHtml = (data.browseCards || []).map(function (card, i) {
      var hues = ['#1a3a6e', '#606060', '#1a1a1a', '#c8a820', '#c03030', '#303030'];
      var hue = hues[i % hues.length];
      var hasCover = !!normalizeCoverUrl(card.cover);
      var style = hasCover ? '' : cardFallbackStyle(hue);
      return (
        '<button type="button" class="ncm-browse-card" data-ncm-browse-card="' + i + '"' + (style ? ' style="' + style + '"' : '') + '>' +
        cardCoverImgHtml(card.cover, 'ncm-browse-card__img') +
        '<p class="ncm-browse-card__title">' + esc(card.title) + '</p>' +
        '<p class="ncm-browse-card__sub">' + esc(card.sub || '') + '</p></button>'
      );
    }).join('');

    box.innerHTML =
      '<h2 class="ncm-section-title">快速发现</h2>' +
      '<div class="ncm-quick-cards">' + (quickHtml || '<p class="ncm-empty">暂无推荐</p>') + '</div>' +
      '<h2 class="ncm-section-title">浏览全部</h2>' +
      '<div class="ncm-browse-grid">' + browseHtml + '</div>';
  }

  async function loadDiscoverHome(force) {
    if (ui.discoverLoading) return;
    if (ui.discoverHome && !force) {
      renderDiscoverHome(ui.discoverHome);
      return;
    }
    ui.discoverLoading = true;
    var loadingEl = $('ncm-discover-loading');
    if (loadingEl) loadingEl.textContent = '加载推荐中…';
    try {
      await eng.neteaseLoginStatus();
      var data = await eng.fetchNeteaseDiscoverHome();
      ui.discoverHome = data;
      renderDiscoverHome(data);
    } catch (e) {
      var box = $('ncm-discover-home');
      if (box) box.innerHTML = '<p class="ncm-empty">加载失败，请检查网络后重试</p>';
    }
    ui.discoverLoading = false;
  }

  function handleDiscoverCard(card) {
    if (!card) return;
    if (card.kind === 'song') {
      playNeteaseRow({ id: card.id, title: card.title, artist: card.sub, coverUrl: card.cover });
      return;
    }
    if (card.kind === 'playlist' && card.id) {
      openDiscoverDetail('playlist', card.id, card.title);
      return;
    }
  }

  function handleBrowseCard(card) {
    if (!card) return;
    if (card.kind === 'toplists') {
      var list = (ui.discoverHome && ui.discoverHome.toplists) || [];
      if (!list.length) {
        toast('暂无排行榜');
        return;
      }
      var html = list.map(function (t) {
        return '<button type="button" class="ncm-sheet-btn" data-ncm-open-toplist="' + esc(t.id) + '" data-ncm-toplist-title="' + esc(t.name) + '">' + esc(t.name) + '</button>';
      }).join('');
      openSheet('官方排行榜', html);
      bindSheetDynamic();
      return;
    }
    if (card.kind === 'toplist' && card.id) {
      openDiscoverDetail('toplist', card.id, card.title);
      return;
    }
    if (card.kind === 'roam') {
      openDiscoverDetail('roam', '', card.title);
      return;
    }
    if (card.kind === 'playlist' && card.id) {
      openDiscoverDetail('playlist', card.id, card.title);
    }
  }

  async function playNeteaseRow(row) {
    if (!row || !row.id) return;
    setStatus('解析中…');
    try {
      var customTitle = row.artist ? row.artist + ' - ' + row.title : row.title;
      var track = await eng.resolveNeteaseSingleSong(row.id, customTitle);
      if (row.coverUrl && !track.coverUrl) track.coverUrl = normalizeCoverUrl(row.coverUrl);
      eng.addToLibrary([track]);
      await eng.playTrack(track, tickUi);
      clearStatus();
      switchTab('home');
    } catch (e) {
      var audio = eng.getAudio(tickUi);
      if (isBenignPlayError(e) && audio && !audio.paused) {
        clearStatus();
        switchTab('home');
        return;
      }
      clearStatus();
      var errMsg = fmtErr(e);
      if (errMsg) setStatus(errMsg, 'err');
    }
  }

  async function addSearchRow(idx) {
    addNeteaseRow(ui.searchResults[idx]);
  }

  async function addNeteaseRow(row) {
    if (!row || !row.id) return;
    setStatus('解析中…');
    try {
      var customTitle = row.artist ? row.artist + ' - ' + row.title : row.title;
      var track = await eng.resolveNeteaseSingleSong(row.id, customTitle);
      if (row.coverUrl && !track.coverUrl) track.coverUrl = normalizeCoverUrl(row.coverUrl);
      var added = eng.addToLibrary([track]);
      clearStatus();
      if (!added.length) {
        toast('已在曲库');
        return;
      }
      pickPlaylistSheet(added, '加入歌单');
    } catch (e) {
      clearStatus();
      var errMsg = fmtErr(e);
      if (errMsg) setStatus(errMsg, 'err');
    }
  }

  function closePlaylistDetail() {
    ui.viewPlaylistId = '';
    setPlaylistDetailShell(false);
    renderMinePlaylists();
  }

  function renderSearchResults(rows) {
    var box = $('ncm-search-results');
    if (!box) return;
    if (!rows || !rows.length) {
      box.hidden = true;
      box.innerHTML = '';
      var home = $('ncm-discover-home');
      if (home) home.hidden = false;
      return;
    }
    box.hidden = false;
    box.innerHTML =
      '<h2 class="ncm-section-title">搜索结果</h2>' +
      rows.map(function (row, i) {
        return (
          '<div class="ncm-search-item">' +
          coverImgHtml(row.coverUrl, row, 'ncm-search-item__cover') +
          '<div class="ncm-search-item__main"><b>' + esc(row.title) + '</b><em>' + esc(row.artist) + '</em></div>' +
          '<div class="ncm-search-item__acts">' +
          '<button type="button" class="ncm-search-item__btn ncm-search-item__btn--play" data-ncm-play-idx="' + i + '">播放</button>' +
          '<button type="button" class="ncm-search-item__btn ncm-search-item__btn--solid" data-ncm-add-idx="' + i + '">加入</button>' +
          '</div></div>'
        );
      }).join('');
    ui.searchResults = rows;
    var home = $('ncm-discover-home');
    if (home) home.hidden = true;
    closeDiscoverDetail();
  }

  async function runSearch() {
    var input = $('ncm-search-input');
    var q = input ? String(input.value || '').trim() : '';
    if (!q) {
      renderSearchResults([]);
      var home = $('ncm-discover-home');
      if (home) home.hidden = false;
      return;
    }
    ui.searchBusy = true;
    setStatus('搜索中…');
    eng.setLastQuery(q);
    try {
      var rows = await eng.searchNeteaseKeywords(q);
      renderSearchResults(rows);
      setStatus('找到 ' + rows.length + ' 首', 'ok');
    } catch (e) {
      renderSearchResults([]);
      setStatus('搜索失败：' + fmtErr(e), 'err');
    }
    ui.searchBusy = false;
  }

  function pickPlaylistSheet(tracks, title) {
    var data = eng.getData();
    var opts = data.playlists.map(function (pl) {
      return '<button type="button" class="ncm-sheet-btn" data-ncm-pick-pl="' + esc(pl.id) + '">' + esc(pl.name) + ' (' + (pl.trackIds || []).length + ')</button>';
    }).join('');
    ui.sheetMode = 'pick-pl';
    ui.pendingTracks = tracks;
    openSheet(title || '加入歌单', opts + '<button type="button" class="ncm-sheet-btn ncm-sheet-btn--ghost" data-ncm-new-pl-pick>新建歌单并加入</button>');
  }

  function openImportSheet() {
    ui.sheetMode = 'import';
    openSheet(
      '导入歌曲 / 歌单',
      '<p class="ncm-sheet-hint">粘贴网易云链接、歌单 ID，或音频直链</p>' +
      '<textarea class="ncm-sheet-input" id="ncm-import-text" rows="4" placeholder="https://music.163.com/playlist?id=…"></textarea>' +
      '<button type="button" class="ncm-sheet-btn ncm-sheet-btn--solid" id="ncm-import-go">开始导入</button>'
    );
  }

  async function doImport() {
    var ta = $('ncm-import-text');
    var raw = ta ? String(ta.value || '').trim() : '';
    if (!raw) {
      toast('请先粘贴内容');
      return;
    }
    if (ui.importBusy) return;
    ui.importBusy = true;
    setStatus('导入中，请稍候…');
    try {
      var result = await eng.importFromExternalInput(raw);
      var tracks = result.tracks || [];
      if (!tracks.length) {
        setStatus('没有解析到歌曲', 'err');
        ui.importBusy = false;
        return;
      }
      var added = eng.addToLibrary(tracks);
      closeSheet();
      pickPlaylistSheet(added, '导入完成 · 选择歌单');
      setStatus('已解析 ' + added.length + ' 首', 'ok');
    } catch (e) {
      setStatus('导入失败：' + fmtErr(e), 'err');
    }
    ui.importBusy = false;
  }

  function openCreatePlaylistSheet() {
    ui.sheetMode = 'create-pl';
    openSheet(
      '新建歌单',
      '<input type="text" class="ncm-sheet-input" id="ncm-new-pl-name" placeholder="歌单名称" maxlength="32">' +
      '<button type="button" class="ncm-sheet-btn ncm-sheet-btn--solid" id="ncm-new-pl-go">创建</button>'
    );
  }

  function openLocalMetaSheet(file) {
    ui.localPendingFile = file;
    ui.sheetMode = 'local-meta';
    openSheet(
      '上传本地歌曲',
      '<input type="text" class="ncm-sheet-input" id="ncm-local-title" placeholder="歌名（可留空自动识别）">' +
      '<input type="text" class="ncm-sheet-input" id="ncm-local-artist" placeholder="歌手">' +
      '<button type="button" class="ncm-sheet-btn ncm-sheet-btn--solid" id="ncm-local-go">上传并入库</button>'
    );
  }

  async function doLocalUpload() {
    var file = ui.localPendingFile;
    if (!file) return;
    var titleIn = $('ncm-local-title');
    var artistIn = $('ncm-local-artist');
    setStatus('上传中…');
    try {
      var tracks = await eng.importLocalAudioFile(file, {
        title: titleIn ? titleIn.value : '',
        artist: artistIn ? artistIn.value : ''
      });
      if (!tracks || !tracks.length) return;
      closeSheet();
      pickPlaylistSheet(tracks, '加入歌单');
      setStatus('已上传 · ' + tracks[0].title, 'ok');
      ui.localPendingFile = null;
    } catch (e) {
      setStatus(fmtErr(e), 'err');
    }
  }

  function renderCloudSheet() {
    if (eng.isNeteaseLoggedIn()) {
      ui.cloudPhase = 'list';
      ui.cloudPlaylistsLoading = true;
      openSheet('网易云账号', '<p class="ncm-sheet-hint">加载歌单中…</p>');
      eng.fetchUserNeteasePlaylists().then(function (list) {
        ui.cloudPlaylists = list || [];
        ui.cloudPlaylistsLoading = false;
        var html =
          '<p class="ncm-sheet-hint">已登录 · ' + esc(getUserName()) + '</p>' +
          '<button type="button" class="ncm-sheet-btn ncm-sheet-btn--ghost" data-ncm-cloud-logout>退出登录</button>' +
          '<div class="ncm-cloud-list">';
        ui.cloudPlaylists.forEach(function (pl) {
          html +=
            '<button type="button" class="ncm-cloud-item" data-ncm-cloud-import="' + esc(pl.id) + '">' +
            '<b>' + esc(pl.name) + '</b><em>' + (pl.trackCount || 0) + ' 首</em></button>';
        });
        html += '</div>';
        openSheet('导入网易云歌单', html);
        bindSheetDynamic();
      }).catch(function (e) {
        openSheet('网易云', '<p class="ncm-sheet-hint">加载失败：' + esc(fmtErr(e)) + '</p><button type="button" class="ncm-sheet-btn" data-ncm-cloud-retry>重试</button>');
        bindSheetDynamic();
      });
      return;
    }

    ui.cloudPhase = 'login';
    openSheet('登录网易云', '<p class="ncm-sheet-hint">请用网易云 App 扫描二维码</p><div class="ncm-qr-wrap" id="ncm-qr-wrap">加载中…</div>');
    eng.neteaseQrLoginStart().then(function (qr) {
      ui.cloudQr = qr || {};
      var wrap = $('ncm-qr-wrap');
      if (!wrap) return;
      var img = qr.qrimg || qr.qrurl || '';
      if (img) {
        wrap.innerHTML = '<img class="ncm-qr-img" src="' + esc(img) + '" alt="登录二维码">';
      } else {
        wrap.textContent = '二维码获取失败';
      }
      stopCloudPoll();
      cloudPollTimer = setInterval(pollCloudLogin, 2200);
      bindSheetDynamic();
    }).catch(function (e) {
      var wrap = $('ncm-qr-wrap');
      if (wrap) wrap.textContent = fmtErr(e);
    });
  }

  async function pollCloudLogin() {
    if (!ui.cloudQr.key || ui.cloudPhase !== 'login') return;
    try {
      var res = await eng.neteaseQrLoginPoll(ui.cloudQr.key);
      if (res.status === 'expired' || res.code === 800) {
        stopCloudPoll();
        toast('二维码已过期，请重试');
        renderCloudSheet();
        return;
      }
      if (res.status === 'success' || res.code === 803) {
        stopCloudPoll();
        toast('登录成功');
        renderMinePlaylists();
        renderCloudSheet();
      }
    } catch (e) { /* ignore poll errors */ }
  }

  async function importCloudPlaylist(pid) {
    setStatus('拉取歌单…');
    closeSheet();
    try {
      var tracks = await eng.resolveNeteasePlaylistTracks(pid);
      var added = eng.addToLibrary(tracks);
      pickPlaylistSheet(added, '导入 ' + added.length + ' 首');
      setStatus('歌单导入完成', 'ok');
    } catch (e) {
      setStatus(fmtErr(e), 'err');
    }
  }

  function renderDesktopLyricsSwitch() {
    var on = eng.getDesktopLyricsEnabled();
    return '<div class="ncm-sheet-row">' +
      '<div class="ncm-sheet-row__text"><b>桌面歌词</b><span>悬浮于所有界面之上，可拖动</span></div>' +
      '<button type="button" class="ncm-sheet-sw' + (on ? ' is-on' : '') + '" id="ncm-sw-desktop-lyrics" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" aria-label="桌面歌词"></button>' +
      '</div>';
  }

  function openMenuSheet() {
    openSheet(
      '更多',
      renderDesktopLyricsSwitch() +
      '<p class="ncm-sheet-hint">播放模式</p>' +
      renderPlayModeSheetButtons() +
      '<button type="button" class="ncm-sheet-btn" data-ncm-open-import>导入链接</button>' +
      '<button type="button" class="ncm-sheet-btn" data-ncm-open-cloud>网易云登录 / 导入</button>' +
      '<button type="button" class="ncm-sheet-btn" data-ncm-open-local>上传本地歌曲</button>' +
      '<button type="button" class="ncm-sheet-btn" data-ncm-create-pl>新建歌单</button>'
    );
  }

  function bindSheetDynamic() {
    var body = $('ncm-sheet-body');
    if (!body) return;

    body.querySelectorAll('[data-ncm-pick-pl]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var plId = btn.getAttribute('data-ncm-pick-pl');
        var tracks = ui.pendingTracks || [];
        tracks.forEach(function (t) { eng.addTrackIdToPlaylist(plId, t.id); });
        closeSheet();
        toast('已加入歌单');
        renderMinePlaylists();
      });
    });

    var newPick = body.querySelector('[data-ncm-new-pl-pick]');
    if (newPick) {
      newPick.addEventListener('click', function () {
        closeSheet();
        openCreatePlaylistSheet();
        ui.pendingTracksAfterCreate = ui.pendingTracks;
      });
    }

    var importGo = $('ncm-import-go');
    if (importGo) importGo.addEventListener('click', doImport);

    var newPlGo = $('ncm-new-pl-go');
    if (newPlGo) {
      newPlGo.addEventListener('click', function () {
        var inp = $('ncm-new-pl-name');
        var name = inp ? inp.value : '';
        var pl = eng.createPlaylist(name);
        var pending = ui.pendingTracksAfterCreate;
        if (pending && pending.length) {
          pending.forEach(function (t) { eng.addTrackIdToPlaylist(pl.id, t.id); });
          ui.pendingTracksAfterCreate = null;
        }
        closeSheet();
        toast('歌单已创建');
        renderMinePlaylists();
      });
    }

    var localGo = $('ncm-local-go');
    if (localGo) localGo.addEventListener('click', doLocalUpload);

    body.querySelectorAll('[data-ncm-cloud-import]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        importCloudPlaylist(btn.getAttribute('data-ncm-cloud-import'));
      });
    });

    var cloudLogout = body.querySelector('[data-ncm-cloud-logout]');
    if (cloudLogout) {
      cloudLogout.addEventListener('click', function () {
        eng.neteaseLogout();
        toast('已退出');
        renderMinePlaylists();
        renderCloudSheet();
      });
    }

    var cloudRetry = body.querySelector('[data-ncm-cloud-retry]');
    if (cloudRetry) cloudRetry.addEventListener('click', renderCloudSheet);

    body.querySelectorAll('[data-ncm-set-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectPlayMode(btn.getAttribute('data-ncm-set-mode'), { closeSheet: true });
      });
    });

    var deskLyricsSw = body.querySelector('#ncm-sw-desktop-lyrics');
    if (deskLyricsSw) {
      deskLyricsSw.addEventListener('click', function () {
        var on = !deskLyricsSw.classList.contains('is-on');
        deskLyricsSw.classList.toggle('is-on', on);
        deskLyricsSw.setAttribute('aria-checked', on ? 'true' : 'false');
        if (global.MiyaDesktopLyrics) {
          global.MiyaDesktopLyrics.setEnabled(on, { animate: true });
        } else {
          eng.setDesktopLyricsEnabled(on);
          toast(on ? '桌面歌词已开启' : '桌面歌词已关闭');
        }
      });
    }

    var openImport = body.querySelector('[data-ncm-open-import]');
    if (openImport) {
      openImport.addEventListener('click', function () {
        closeSheet();
        openImportSheet();
      });
    }

    var openCloud = body.querySelector('[data-ncm-open-cloud]');
    if (openCloud) {
      openCloud.addEventListener('click', function () {
        closeSheet();
        renderCloudSheet();
      });
    }

    var openLocal = body.querySelector('[data-ncm-open-local]');
    if (openLocal) {
      openLocal.addEventListener('click', function () {
        closeSheet();
        $('ncm-file-local') && $('ncm-file-local').click();
      });
    }

    var createPl = body.querySelector('[data-ncm-create-pl]');
    if (createPl) {
      createPl.addEventListener('click', function () {
        closeSheet();
        openCreatePlaylistSheet();
      });
    }

    body.querySelectorAll('[data-ncm-open-toplist]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tid = btn.getAttribute('data-ncm-open-toplist');
        var tit = btn.getAttribute('data-ncm-toplist-title') || '排行榜';
        closeSheet();
        openDiscoverDetail('toplist', tid, tit);
      });
    });
  }

  async function playLikedMode() {
    var pl = ensureLikedPlaylist();
    eng.setActivePlaylistId(pl.id);
    var q = eng.getPlaybackQueue();
    if (!q.length) {
      toast('红心歌单是空的，先加几首歌吧');
      return;
    }
    await eng.playTrack(q[Math.floor(Math.random() * q.length)], tickUi);
    switchTab('home');
  }

  function togglePlayPause() {
    eng.resumeOrTogglePlayback(tickUi);
  }

  function bindEvents() {
    var app = $('miya-music-app');
    if (!app) return;

    $('ncm-back') && $('ncm-back').addEventListener('click', function (e) {
      e.stopPropagation();
      closeMusicApp();
    });

    $('ncm-sheet-close') && $('ncm-sheet-close').addEventListener('click', closeSheet);
    $('ncm-overlay') && $('ncm-overlay').addEventListener('click', function (e) {
      if (e.target.id === 'ncm-overlay') closeSheet();
    });

    app.querySelectorAll('.ncm-tabbar__item[data-ncm-tab]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        switchTab(btn.getAttribute('data-ncm-tab'));
      });
    });

    app.querySelectorAll('[data-ncm-tab]:not(.ncm-tabbar__item)').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        switchTab(btn.getAttribute('data-ncm-tab'));
      });
    });

    $('ncm-search-submit') && $('ncm-search-submit').addEventListener('click', runSearch);
    var searchInput = $('ncm-search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') runSearch();
      });
      searchInput.addEventListener('search', function () {
        if (!String(searchInput.value || '').trim()) runSearch();
      });
    }

    $('ncm-discover-detail-back') && $('ncm-discover-detail-back').addEventListener('click', closeDiscoverDetail);

    $('ncm-discover-home') && $('ncm-discover-home').addEventListener('click', function (e) {
      var quick = e.target.closest('[data-ncm-discover-card]');
      if (quick) {
        var idx = Number(quick.getAttribute('data-ncm-discover-card'));
        var card = ui.discoverHome && ui.discoverHome.quickCards ? ui.discoverHome.quickCards[idx] : null;
        handleDiscoverCard(card);
        return;
      }
      var browse = e.target.closest('[data-ncm-browse-card]');
      if (browse) {
        var bIdx = Number(browse.getAttribute('data-ncm-browse-card'));
        var bCard = ui.discoverHome && ui.discoverHome.browseCards ? ui.discoverHome.browseCards[bIdx] : null;
        handleBrowseCard(bCard);
      }
    });

    $('ncm-discover-detail-tracks') && $('ncm-discover-detail-tracks').addEventListener('click', function (e) {
      var add = e.target.closest('[data-ncm-discover-add]');
      if (add) {
        addNeteaseRow(ui.discoverTracks[Number(add.getAttribute('data-ncm-discover-add'))]);
        return;
      }
      var btn = e.target.closest('[data-ncm-discover-play]');
      if (!btn) return;
      playNeteaseRow(ui.discoverTracks[Number(btn.getAttribute('data-ncm-discover-play'))]);
    });

    $('ncm-search-scroll') && $('ncm-search-scroll').addEventListener('click', function (e) {
      var add = e.target.closest('[data-ncm-add-idx]');
      if (add) {
        addNeteaseRow(ui.searchResults[Number(add.getAttribute('data-ncm-add-idx'))]);
        return;
      }
      var play = e.target.closest('[data-ncm-play-idx]');
      if (play) playNeteaseRow(ui.searchResults[Number(play.getAttribute('data-ncm-play-idx'))]);
    });

    $('ncm-btn-menu') && $('ncm-btn-menu').addEventListener('click', openMenuSheet);
    $('ncm-btn-import') && $('ncm-btn-import').addEventListener('click', openImportSheet);

    app.querySelectorAll('[data-ncm-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-ncm-action');
        if (act === 'local') $('ncm-file-local') && $('ncm-file-local').click();
        else if (act === 'cloud') renderCloudSheet();
        else if (act === 'create-pl') openCreatePlaylistSheet();
        else if (act === 'appearance') openAppearancePage();
        else if (act === 'more') openMenuSheet();
      });
    });

    $('ncm-file-local') && $('ncm-file-local').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (file) openLocalMetaSheet(file);
    });

    var vinylWrap = app.querySelector('.ncm-vinyl-wrap');
    if (vinylWrap) {
      vinylWrap.addEventListener('click', function (e) {
        if (e.target.closest('.ncm-vinyl-arm')) return;
        e.stopPropagation();
        toggleLyricsMode();
      });
    }

    $('ncm-ctrl-play') && $('ncm-ctrl-play').addEventListener('click', togglePlayPause);
    $('ncm-song-mode') && $('ncm-song-mode').addEventListener('click', function (e) {
      e.stopPropagation();
      eng.cyclePlayMode();
      toast('播放模式：' + eng.getPlayModeLabel(eng.getData().playMode));
      tickUi();
    });
    $('ncm-mini-play') && $('ncm-mini-play').addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlayPause();
    });
    $('ncm-ctrl-prev') && $('ncm-ctrl-prev').addEventListener('click', function () {
      eng.playAdjacent(-1, false, tickUi);
    });
    $('ncm-ctrl-next') && $('ncm-ctrl-next').addEventListener('click', function () {
      eng.playAdjacent(1, false, tickUi);
    });

    $('ncm-mini-player') && $('ncm-mini-player').addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      switchTab('home');
    });

    $('ncm-pl-detail-back') && $('ncm-pl-detail-back').addEventListener('click', closePlaylistDetail);

    $('ncm-playlist-list') && $('ncm-playlist-list').addEventListener('click', function (e) {
      var liked = e.target.closest('[data-ncm-play-liked]');
      if (liked) {
        e.stopPropagation();
        playLikedMode();
        return;
      }
      var menu = e.target.closest('[data-ncm-pl-menu]');
      if (menu) {
        e.stopPropagation();
        var plId = menu.getAttribute('data-ncm-pl-menu');
        openSheet('歌单', '<button type="button" class="ncm-sheet-btn" data-ncm-open-pl-detail="' + esc(plId) + '">查看歌曲</button>');
        bindSheetDynamic();
        var det = $('ncm-sheet-body') && $('ncm-sheet-body').querySelector('[data-ncm-open-pl-detail]');
        if (det) det.addEventListener('click', function () {
          closeSheet();
          switchTab('mine');
          openPlaylistDetail(plId);
        });
        return;
      }
      var row = e.target.closest('[data-ncm-open-pl]');
      if (row) {
        switchTab('mine');
        openPlaylistDetail(row.getAttribute('data-ncm-open-pl'));
      }
    });

    $('ncm-pl-detail-tracks') && $('ncm-pl-detail-tracks').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-ncm-play-id]');
      if (!btn) return;
      var id = btn.getAttribute('data-ncm-play-id');
      var t = eng.getData().library.find(function (x) { return x && x.id === id; });
      if (t) {
        eng.playTrack(t, tickUi).then(function () { switchTab('home'); });
      }
    });

    var progressBar = document.querySelector('.ncm-progress__bar');
    if (progressBar) {
      function progressRatioFromClientX(clientX) {
        var rect = progressBar.getBoundingClientRect();
        if (!rect.width) return 0;
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      }

      function previewProgressScrub(clientX) {
        progressScrubRatio = progressRatioFromClientX(clientX);
        tickUi();
      }

      function applyProgressSeek() {
        var audio = eng.getAudio(tickUi);
        if (!audio || !isFinite(audio.duration) || audio.duration <= 0) return;
        audio.currentTime = progressScrubRatio * audio.duration;
        eng.persistPlaybackPosition(true);
        tickUi();
      }

      function stopProgressScrub(apply) {
        if (!progressScrubbing) return;
        progressScrubbing = false;
        if (apply) applyProgressSeek();
        else tickUi();
      }

      progressBar.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        progressScrubbing = true;
        previewProgressScrub(e.clientX);

        function onMove(ev) {
          if (!progressScrubbing) return;
          ev.preventDefault();
          previewProgressScrub(ev.clientX);
        }

        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          stopProgressScrub(true);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      progressBar.addEventListener(
        'touchstart',
        function (e) {
          if (!e.touches || !e.touches.length) return;
          progressScrubbing = true;
          previewProgressScrub(e.touches[0].clientX);
        },
        { passive: true }
      );

      progressBar.addEventListener(
        'touchmove',
        function (e) {
          if (!progressScrubbing || !e.touches || !e.touches.length) return;
          previewProgressScrub(e.touches[0].clientX);
        },
        { passive: true }
      );

      progressBar.addEventListener('touchend', function () {
        stopProgressScrub(true);
      });

      progressBar.addEventListener('touchcancel', function () {
        stopProgressScrub(false);
      });

      progressBar.addEventListener('click', function (e) {
        if (progressScrubbing) return;
        var audio = eng.getAudio(tickUi);
        if (!audio || !isFinite(audio.duration)) return;
        progressScrubRatio = progressRatioFromClientX(e.clientX);
        applyProgressSeek();
      });
    }

    global.addEventListener('miya-music-cover-update', function () {
      if (ui.viewPlaylistId) openPlaylistDetail(ui.viewPlaylistId);
    });
  }

  function initEngine() {
    eng.setStatusCallback(setStatus);
    eng.setStateCallback(tickUi);
    eng.getAudio(tickUi);
    return eng.loadDataWithTimeout(8000).then(function () {
      ensureLikedPlaylist();
      engineReady = true;
      tickUi();
      renderMinePlaylists();
    });
  }

  function openMusicApp() {
    var el = $('miya-music-app');
    if (!el) return;
    el.removeAttribute('hidden');
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('miya-app-open');
    switchTab('home');
    function afterOpen() {
      if (global.miyaMusicEngine && global.miyaMusicEngine.prefetchLibraryOnIdle) {
        global.miyaMusicEngine.prefetchLibraryOnIdle();
      }
    }
    if (!engineReady) {
      initEngine().catch(function () { toast('曲库加载失败'); }).finally(afterOpen);
    } else {
      tickUi();
      renderMinePlaylists();
      afterOpen();
    }
  }

  function closeMusicApp() {
    var el = $('miya-music-app');
    if (!el) return;
    closeSheet();
    stopCloudPoll();
    el.classList.remove('is-open');
    el.setAttribute('hidden', '');
    el.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-settings-app.is-open') &&
        !document.querySelector('.miya-music-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  function invalidateCoverUi() {
    uiCache.cover = null;
    uiCache.miniCover = null;
    tickUi(true);
  }

  bindEvents();
  initEngine().catch(function () {});

  global.miyaMusicApp = {
    open: openMusicApp,
    close: closeMusicApp,
    switchTab: switchTab,
    openAppearancePage: openAppearancePage,
    closeAppearancePage: closeAppearancePage,
    renderMinePlaylists: renderMinePlaylists,
    toast: toast,
    openSheet: openSheet,
    closeSheet: closeSheet,
    _tickUi: tickUi,
    invalidateCoverUi: invalidateCoverUi,
    playTrackById: function (id) {
      var t = eng.getData().library.find(function (x) { return x && x.id === id; });
      if (t) return eng.playTrack(t, tickUi);
      return Promise.resolve();
    },
    togglePlay: togglePlayPause
  };
})(window);
