/**
 * miya-deep-music.js — 深入 · 角色手机 Music 界面
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    open: false,
    contactId: '',
    contactName: '',
    phoneData: null,
    musicData: null,
    refreshing: false,
    activePlaylistId: '',
    expandedPlaylistId: ''
  };

  var activeJobs = Object.create(null);
  var toastTimer = 0;
  var statusDotsTimer = 0;
  var statusDotsFrame = 0;
  var successFlashTimer = 0;
  var resolvingTrackId = '';

  var PL_GRADIENTS = ['dm-grad-0', 'dm-grad-1', 'dm-grad-2'];

  var PEAK_SLOTS = {
    '清晨': { left: 4, width: 14 },
    '上午': { left: 18, width: 18 },
    '午后': { left: 38, width: 16 },
    '傍晚': { left: 56, width: 18 },
    '深夜': { left: 76, width: 20 }
  };

  function musicStore() { return global.miyaDeepMusicStore || null; }
  function musicBridge() { return global.miyaDeepMusicBridge || null; }
  function musicEngine() { return global.miyaMusicEngine || null; }

  function primePlaybackOnGesture() {
    var eng = musicEngine();
    if (eng && typeof eng.primeAudioPlayback === 'function') {
      eng.primeAudioPlayback();
    }
  }

  function formatPlayError(err) {
    var eng = musicEngine();
    if (eng && typeof eng.formatPlaybackError === 'function') {
      return eng.formatPlaybackError(err);
    }
    return err && err.message ? err.message : '播放失败';
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var el = $('dp-music-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function formatMinutes(n) {
    var m = Math.max(0, Math.round(Number(n) || 0));
    if (m >= 60) {
      var h = Math.floor(m / 60);
      var r = m % 60;
      return h + 'h' + (r ? ' ' + r + 'm' : '');
    }
    return m + ' min';
  }

  function stopStatusDots() {
    clearInterval(statusDotsTimer);
    statusDotsTimer = 0;
    statusDotsFrame = 0;
  }

  function startStatusDots(baseText) {
    stopStatusDots();
    var text = $('dp-music-status-text');
    if (!text) return;
    var base = String(baseText || '正在读取ta的music，');
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
    var bar = $('dp-music-status');
    var text = $('dp-music-status-text');
    if (!bar || !text) return;
    var data = state.musicData;
    var msg = '';
    var kind = 'idle';
    if (state.refreshing || (data && data.refreshStatus === 'loading')) {
      msg = '正在读取ta的music，';
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
      bar.className = 'dp-music__status';
      return;
    }
    bar.hidden = false;
    bar.className = 'dp-music__status is-' + kind;
    if (kind === 'loading') {
      startStatusDots(msg);
    } else {
      stopStatusDots();
      text.textContent = msg;
    }
  }

  function updateRefreshBtn() {
    var btn = $('dp-music-refresh');
    if (!btn) return;
    var busy = state.refreshing || (state.musicData && state.musicData.refreshStatus === 'loading');
    btn.disabled = !!busy;
    btn.classList.toggle('is-spinning', !!busy);
  }

  function plGradClass(index) {
    return PL_GRADIENTS[index % PL_GRADIENTS.length];
  }

  function renderHeroWave() {
    var bars = '';
    for (var i = 0; i < 12; i++) bars += '<span aria-hidden="true"></span>';
    return '<div class="dp-music__hero-wave" aria-hidden="true">' + bars + '</div>';
  }

  function renderVinyl(coverHtml, spinning) {
    return (
      '<div class="dp-music__hero-vinyl-wrap">' +
        '<div class="dp-music__hero-vinyl' + (spinning ? ' is-spinning' : '') + '">' +
          '<div class="dp-music__hero-vinyl-label">' + coverHtml + '</div>' +
        '</div>' +
        '<span class="dp-music__hero-vinyl-arm" aria-hidden="true"></span>' +
      '</div>'
    );
  }

  function findTopSongTrack(topSong) {
    if (!topSong || !topSong.title) return null;
    var list = state.musicData && state.musicData.playlists || [];
    var titleLower = String(topSong.title).toLowerCase();
    var artistLower = String(topSong.artist || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      var tracks = list[i].tracks || [];
      for (var j = 0; j < tracks.length; j++) {
        var tr = tracks[j];
        var trTitle = String(tr.title || '').toLowerCase();
        var trArtist = String(tr.artist || '').toLowerCase();
        if (trTitle === titleLower || trTitle.indexOf(titleLower) >= 0 || titleLower.indexOf(trTitle) >= 0) {
          if (!artistLower || !trArtist || trArtist.indexOf(artistLower) >= 0 || artistLower.indexOf(trArtist) >= 0) {
            return tr;
          }
        }
      }
    }
    return null;
  }

  function playlistCoverHtml(pl, index) {
    var tracks = pl.tracks || [];
    for (var i = 0; i < tracks.length; i++) {
      if (tracks[i].coverUrl) {
        return '<img src="' + esc(tracks[i].coverUrl) + '" alt="" referrerpolicy="no-referrer">';
      }
    }
    return '<span aria-hidden="true">♪</span>';
  }

  function trackThumbHtml(track) {
    if (track && track.coverUrl) {
      return '<img src="' + esc(track.coverUrl) + '" alt="" referrerpolicy="no-referrer">';
    }
    return '<span aria-hidden="true">♪</span>';
  }

  function peakTimelineMarkup(peakPeriod) {
    var slot = PEAK_SLOTS[peakPeriod] || PEAK_SLOTS['深夜'];
    var markers = ['清晨', '上午', '午后', '傍晚', '深夜'].map(function (label) {
      return '<span class="' + (label === peakPeriod ? 'is-active' : '') + '">' + label + '</span>';
    }).join('');
    return (
      '<div class="dp-music__timeline">' +
        '<span class="dp-music__timeline-label">Listening Rhythm · 听歌时段</span>' +
        '<div class="dp-music__timeline-track">' +
          '<span class="dp-music__timeline-fill" style="left:' + slot.left + '%;width:' + slot.width + '%"></span>' +
        '</div>' +
        '<div class="dp-music__timeline-markers">' + markers + '</div>' +
      '</div>'
    );
  }

  function isAudioPlaying() {
    var eng = musicEngine();
    if (!eng || typeof eng.getAudio !== 'function') return false;
    var audio = eng.getAudio(function () {});
    return !!(audio && !audio.paused);
  }

  function renderHero() {
    var el = $('dp-music-hero');
    if (!el) return;
    var ws = state.musicData && state.musicData.weekStats;
    var hasTop = ws && ws.topSong && ws.topSong.title;
    var spinning = isAudioPlaying();

    if (!hasTop) {
      el.innerHTML =
        '<div class="dp-music__hero-stage dp-music__hero-empty">' +
          '<span class="dp-music__hero-kicker">Now Spinning · ' + esc(state.contactName) + '</span>' +
          '<div class="dp-music__hero-body">' +
            renderVinyl('<span aria-hidden="true">♪</span>', false) +
            '<div class="dp-music__hero-copy">' +
              '<span class="dp-music__hero-tag">Private Library</span>' +
              '<h2 class="dp-music__hero-song">等待读取<br>ta 的音乐品味</h2>' +
              '<p class="dp-music__hero-note">点击右上角 ↻ 生成歌单与本周听歌明细</p>' +
            '</div>' +
          '</div>' +
          renderHeroWave() +
        '</div>';
      return;
    }

    var topTrack = findTopSongTrack(ws.topSong);
    var coverInner = topTrack && topTrack.coverUrl
      ? '<img src="' + esc(topTrack.coverUrl) + '" alt="" referrerpolicy="no-referrer">'
      : '<span aria-hidden="true">♪</span>';
    var gradClass = plGradClass(0);
    if (topTrack) {
      var hit = findTrack(topTrack.id);
      if (hit) gradClass = plGradClass(hit.plIndex);
    }

    el.innerHTML =
      '<div class="dp-music__hero-stage ' + gradClass + '">' +
        '<span class="dp-music__hero-kicker">Now Spinning · ' + esc(state.contactName) + '</span>' +
        '<div class="dp-music__hero-body">' +
          renderVinyl(coverInner, spinning) +
          '<div class="dp-music__hero-copy">' +
            '<span class="dp-music__hero-tag">本周循环最多</span>' +
            '<h2 class="dp-music__hero-song">' + esc(ws.topSong.title) + '</h2>' +
            '<p class="dp-music__hero-artist">' + esc(ws.topSong.artist || '—') + '</p>' +
            (ws.topSong.playCount
              ? '<span class="dp-music__hero-plays">本周播放 <b>' + ws.topSong.playCount + '</b> 次</span>'
              : '') +
          '</div>' +
        '</div>' +
        renderHeroWave() +
      '</div>';
  }

  function renderFeatured() {
    var el = $('dp-music-featured');
    if (!el) return;
    var list = state.musicData && state.musicData.playlists || [];
    if (!list.length) {
      el.innerHTML = '';
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var cards = list.map(function (pl, idx) {
      var grad = plGradClass(idx);
      var active = state.expandedPlaylistId === pl.id || (!state.expandedPlaylistId && idx === 0);
      return (
        '<button type="button" class="dp-music__feat-card ' + grad + (active ? ' is-active' : '') + '" data-dp-music-toggle="' + esc(pl.id) + '">' +
          '<div class="dp-music__feat-cover">' +
            playlistCoverHtml(pl, idx) +
            '<span class="dp-music__feat-no">' + String(idx + 1).padStart(2, '0') + '</span>' +
            (pl.mood ? '<span class="dp-music__feat-mood">' + esc(pl.mood) + '</span>' : '') +
          '</div>' +
          '<span class="dp-music__feat-name">' + esc(pl.title) + '</span>' +
          (pl.subtitle ? '<span class="dp-music__feat-sub">' + esc(pl.subtitle) + '</span>' : '') +
          '<span class="dp-music__feat-count">' + (pl.tracks ? pl.tracks.length : 0) + ' tracks</span>' +
        '</button>'
      );
    }).join('');

    el.innerHTML =
      '<div class="dp-music__featured-head">' +
        '<span class="dp-music__featured-kicker">Curated</span>' +
        '<h3 class="dp-music__featured-title">精选歌单</h3>' +
      '</div>' +
      '<div class="dp-music__featured-scroll">' + cards + '</div>';
  }

  function renderWeekStats() {
    var el = $('dp-music-week');
    if (!el) return;
    var ws = state.musicData && state.musicData.weekStats;
    if (!ws || !ws.topSong || !ws.topSong.title) {
      el.innerHTML =
        '<div class="dp-music__week-empty">' +
          '<span class="dp-music__week-kicker">This Week</span>' +
          '<p>点击右上角刷新，读取 ta 的听歌明细</p>' +
        '</div>';
      return;
    }
    el.innerHTML =
      '<div class="dp-music__week-grid">' +
        '<div class="dp-music__week-head">' +
          '<span class="dp-music__week-kicker">This Week</span>' +
          '<h3 class="dp-music__week-title">本周听歌档案</h3>' +
        '</div>' +
        '<div class="dp-music__week-cell dp-music__week-cell--wide dp-music__week-cell--a">' +
          '<span class="dp-music__week-icon" aria-hidden="true">♫</span>' +
          '<div class="dp-music__week-cell-body">' +
            '<span class="dp-music__week-label">Top Track</span>' +
            '<strong class="dp-music__week-val">' + esc(ws.topSong.title) + '</strong>' +
            '<em class="dp-music__week-sub">' + esc(ws.topSong.artist) +
              (ws.topSong.playCount ? ' · ' + ws.topSong.playCount + ' 次' : '') +
            '</em>' +
          '</div>' +
        '</div>' +
        '<div class="dp-music__week-cell dp-music__week-cell--stat dp-music__week-cell--b">' +
          '<span class="dp-music__week-icon" aria-hidden="true">⏱</span>' +
          '<div class="dp-music__week-cell-body">' +
            '<span class="dp-music__week-label">总时长</span>' +
            '<strong class="dp-music__week-val">' + esc(formatMinutes(ws.totalMinutes)) + '</strong>' +
          '</div>' +
        '</div>' +
        '<div class="dp-music__week-cell dp-music__week-cell--stat dp-music__week-cell--c">' +
          '<span class="dp-music__week-icon" aria-hidden="true">☾</span>' +
          '<div class="dp-music__week-cell-body">' +
            '<span class="dp-music__week-label">高峰</span>' +
            '<strong class="dp-music__week-val">' + esc(ws.peakPeriod || '—') + '</strong>' +
            '<em class="dp-music__week-sub">' + esc(ws.peakPeriodLabel || '') + '</em>' +
          '</div>' +
        '</div>' +
        peakTimelineMarkup(ws.peakPeriod) +
      '</div>';
  }

  function renderPlaylists() {
    var el = $('dp-music-playlists');
    var empty = $('dp-music-empty');
    if (!el) return;
    var list = state.musicData && state.musicData.playlists || [];
    if (!list.length) {
      el.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    el.innerHTML = list.map(function (pl, idx) {
      var expanded = state.expandedPlaylistId === pl.id || (!state.expandedPlaylistId && idx === 0);
      var offsetClass = 'dp-music__pl--off' + ((idx % 3) + 1);
      var tracksHtml = (pl.tracks || []).map(function (tr, ti) {
        var playing = state.musicData && state.musicData.nowPlayingId === tr.id;
        var resolving = resolvingTrackId === tr.id;
        var num = String(ti + 1).padStart(2, '0');
        return (
          '<button type="button" class="dp-music__track' +
            (playing ? ' is-playing' : '') +
            (resolving ? ' is-resolving' : '') +
            '" data-dp-music-track="' + esc(tr.id) + '" data-dp-music-pl="' + esc(pl.id) + '">' +
            '<span class="dp-music__track-no">' + num + '</span>' +
            '<span class="dp-music__track-thumb">' + trackThumbHtml(tr) + '</span>' +
            '<span class="dp-music__track-main">' +
              '<b>' + esc(tr.title) + '</b>' +
              '<em>' + esc(tr.artist || '—') + '</em>' +
            '</span>' +
            '<span class="dp-music__track-play" aria-hidden="true">' +
              (resolving ? '…' : (playing ? '◼' : '▷')) +
            '</span>' +
          '</button>'
        );
      }).join('');

      return (
        '<article class="dp-music__pl ' + offsetClass + ' ' + plGradClass(idx) + (expanded ? ' is-open' : '') + '" data-dp-music-pl="' + esc(pl.id) + '">' +
          '<button type="button" class="dp-music__pl-head" data-dp-music-toggle="' + esc(pl.id) + '">' +
            '<div class="dp-music__pl-cover">' + playlistCoverHtml(pl, idx) + '</div>' +
            '<div class="dp-music__pl-info">' +
              '<div class="dp-music__pl-meta">' +
                '<span class="dp-music__pl-idx">' + String(idx + 1).padStart(2, '0') + '</span>' +
                (pl.mood ? '<span class="dp-music__pl-mood">' + esc(pl.mood) + '</span>' : '') +
              '</div>' +
              '<h4 class="dp-music__pl-title">' + esc(pl.title) + '</h4>' +
              (pl.subtitle ? '<p class="dp-music__pl-sub">' + esc(pl.subtitle) + '</p>' : '') +
              '<span class="dp-music__pl-count">' + (pl.tracks ? pl.tracks.length : 0) + ' tracks</span>' +
            '</div>' +
          '</button>' +
          '<div class="dp-music__pl-body">' + tracksHtml + '</div>' +
        '</article>'
      );
    }).join('');
  }

  function findTrack(trackId) {
    var list = state.musicData && state.musicData.playlists || [];
    for (var i = 0; i < list.length; i++) {
      var pl = list[i];
      var tracks = pl.tracks || [];
      for (var j = 0; j < tracks.length; j++) {
        if (tracks[j].id === trackId) return { playlist: pl, track: tracks[j], plIndex: i, trIndex: j };
      }
    }
    return null;
  }

  function persistResolvedTrack(trackId, resolved) {
    var hit = findTrack(trackId);
    if (!hit || !state.musicData) return Promise.resolve();
    var pl = state.musicData.playlists[hit.plIndex];
    if (!pl || !pl.tracks || !pl.tracks[hit.trIndex]) return Promise.resolve();
    pl.tracks[hit.trIndex] = Object.assign({}, pl.tracks[hit.trIndex], {
      neteaseSongId: resolved.neteaseSongId || pl.tracks[hit.trIndex].neteaseSongId,
      coverUrl: resolved.coverUrl || pl.tracks[hit.trIndex].coverUrl,
      artist: resolved.artist || pl.tracks[hit.trIndex].artist,
      durationSec: resolved.durationSec || pl.tracks[hit.trIndex].durationSec
    });
    var ms = musicStore();
    if (!ms) return Promise.resolve();
    return ms.saveMusic(state.contactId, state.musicData);
  }

  function updateMiniPlayer() {
    var bar = $('dp-music-mini');
    if (!bar) return;
    var npId = state.musicData && state.musicData.nowPlayingId;
    var hit = npId ? findTrack(npId) : null;
    if (!hit) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    var titleEl = $('dp-music-mini-title');
    var artistEl = $('dp-music-mini-artist');
    var coverEl = $('dp-music-mini-cover');
    if (titleEl) titleEl.textContent = hit.track.title || '—';
    if (artistEl) artistEl.textContent = hit.track.artist || '—';
    if (coverEl) {
      if (hit.track.coverUrl) {
        coverEl.innerHTML = '<img src="' + esc(hit.track.coverUrl) + '" alt="" referrerpolicy="no-referrer">';
      } else {
        coverEl.innerHTML = '<span aria-hidden="true">♪</span>';
      }
    }
    var eng = musicEngine();
    var audio = eng && eng.getAudio ? eng.getAudio(tickMiniPlayer) : null;
    var playBtn = $('dp-music-mini-play');
    if (playBtn) {
      var playing = !!(audio && !audio.paused);
      playBtn.textContent = playing ? '❚❚' : '▷';
      playBtn.setAttribute('aria-label', playing ? '暂停' : '播放');
    }
  }

  function tickMiniPlayer() {
    updateMiniPlayer();
  }

  function renderAll() {
    renderHero();
    renderWeekStats();
    renderFeatured();
    renderPlaylists();
    updateStatusBar();
    updateRefreshBtn();
    updateMiniPlayer();
  }

  function loadMusicData(contactId) {
    var ms = musicStore();
    if (!ms) return Promise.resolve(null);
    return ms.getMusic(contactId).then(function (data) {
      state.musicData = data;
      return data;
    });
  }

  function dispatchUpdated(contactId) {
    try {
      global.dispatchEvent(new CustomEvent('miya-deep-music-updated', {
        detail: { contactId: contactId || state.contactId }
      }));
    } catch (e) {}
  }

  function runRefreshJob(contactId, phoneData) {
    if (activeJobs[contactId]) return activeJobs[contactId];

    var ms = musicStore();
    var br = musicBridge();
    if (!ms || !br) return Promise.reject(new Error('模块未就绪'));

    var job = ms.patchMusic(contactId, {
      refreshStatus: 'loading',
      refreshMessage: '正在读取ta的music，',
      refreshStartedAt: Date.now()
    }).then(function (data) {
      if (state.contactId === contactId) {
        state.musicData = data;
        state.refreshing = true;
        renderAll();
      }
      return br.generateMusicLibrary(contactId, phoneData, {
        onProgress: function (p) {
          var msg = p && p.message ? p.message : '正在读取ta的music，';
          ms.patchMusic(contactId, {
            refreshStatus: 'loading',
            refreshMessage: msg
          }).then(function (patched) {
            if (state.contactId === contactId && state.open) {
              state.musicData = patched;
              updateStatusBar();
              updateRefreshBtn();
            }
          }).catch(function () {});
        }
      });
    }).then(function (result) {
      return ms.patchMusic(contactId, {
        refreshStatus: 'idle',
        refreshMessage: '',
        lastRefreshedAt: Date.now(),
        playlists: result.playlists,
        weekStats: result.weekStats
      });
    }).then(function (saved) {
      delete activeJobs[contactId];
      if (state.contactId === contactId) {
        state.musicData = saved;
        state.refreshing = false;
        if (state.open) {
          renderAll();
          showSuccessFlash();
        }
      }
      dispatchUpdated(contactId);
      return saved;
    }).catch(function (err) {
      delete activeJobs[contactId];
      var msg = err && err.message ? err.message : '读取失败';
      return ms.patchMusic(contactId, {
        refreshStatus: 'error',
        refreshMessage: msg
      }).then(function (saved) {
        if (state.contactId === contactId) {
          state.musicData = saved;
          state.refreshing = false;
          if (state.open) renderAll();
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
    if (state.refreshing || (state.musicData && state.musicData.refreshStatus === 'loading')) return;
    if (activeJobs[state.contactId]) return;

    state.refreshing = true;
    renderAll();

    runRefreshJob(state.contactId, state.phoneData).catch(function (err) {
      if (state.open) toast(err && err.message ? err.message : '读取失败');
    });
  }

  function buildPlayableTrack(resolved) {
    var eng = musicEngine();
    if (!eng) return Promise.reject(new Error('音乐模块未加载'));
    var sid = String(resolved.neteaseSongId || '').trim();
    var customTitle = (resolved.artist ? resolved.artist + ' - ' : '') + resolved.title;
    if (/^\d{4,}$/.test(sid) && typeof eng.resolveNeteaseSingleSong === 'function') {
      return eng.resolveNeteaseSingleSong(sid, customTitle);
    }
    if (typeof eng.searchNeteaseKeywords !== 'function') {
      return Promise.reject(new Error('未找到可播放歌曲'));
    }
    var keyword = (resolved.artist ? resolved.artist + ' ' : '') + resolved.title;
    return eng.searchNeteaseKeywords(keyword).then(function (rows) {
      if (!rows || !rows.length) throw new Error('未找到歌曲');
      var br = musicBridge();
      var best = br && br.pickBestSearchRow ? br.pickBestSearchRow(rows, resolved) : rows[0];
      if (!best || !best.id) throw new Error('未找到歌曲');
      resolved.neteaseSongId = String(best.id);
      if (!resolved.coverUrl && best.coverUrl) resolved.coverUrl = best.coverUrl;
      if (typeof eng.resolveNeteaseSingleSong === 'function') {
        return eng.resolveNeteaseSingleSong(best.id, customTitle);
      }
      if (typeof eng.neteaseSearchRowToTrack === 'function') {
        return eng.neteaseSearchRowToTrack(best);
      }
      throw new Error('播放模块未就绪');
    });
  }

  function playTrack(trackId, playlistId) {
    var hit = findTrack(trackId);
    if (!hit) return;
    primePlaybackOnGesture();
    var eng = musicEngine();
    if (!eng) {
      toast('音乐模块未加载');
      return;
    }
    if (resolvingTrackId) return;

    state.activePlaylistId = playlistId || hit.playlist.id;
    state.musicData.nowPlayingId = trackId;
    var ms = musicStore();
    if (ms) ms.patchMusic(state.contactId, { nowPlayingId: trackId }).catch(function () {});

    resolvingTrackId = trackId;
    renderPlaylists();

    var chain = typeof eng.ensureDataReady === 'function'
      ? eng.ensureDataReady(8000)
      : Promise.resolve();

    chain.then(function () {
      var br = musicBridge();
      var resolved = hit.track;
      if (br && typeof br.resolveTrackViaNetease === 'function') {
        return br.resolveTrackViaNetease(resolved);
      }
      return resolved;
    }).then(function (resolved) {
      return persistResolvedTrack(trackId, resolved).then(function () {
        return buildPlayableTrack(resolved);
      });
    }).then(function (trackObj) {
      return eng.playTrack(trackObj, tickMiniPlayer);
    }).then(function () {
      resolvingTrackId = '';
      renderPlaylists();
      renderHero();
      updateMiniPlayer();
    }).catch(function (err) {
      resolvingTrackId = '';
      renderPlaylists();
      renderHero();
      updateMiniPlayer();
      toast(formatPlayError(err));
    });
  }

  function toggleMiniPlayback() {
    primePlaybackOnGesture();
    var eng = musicEngine();
    if (!eng) return;
    if (typeof eng.resumeOrTogglePlayback === 'function') {
      eng.resumeOrTogglePlayback(tickMiniPlayer);
      updateMiniPlayer();
      renderHero();
    }
  }

  function bindEvents() {
    var root = $('dp-music');
    if (!root || root._dpMusicBound) return;
    root._dpMusicBound = true;

    var back = $('dp-music-back');
    if (back) back.addEventListener('click', close);

    var refresh = $('dp-music-refresh');
    if (refresh) refresh.addEventListener('click', handleRefresh);

    root.addEventListener('click', function (e) {
      var toggle = e.target.closest('[data-dp-music-toggle]');
      if (toggle) {
        var plId = toggle.getAttribute('data-dp-music-toggle');
        state.expandedPlaylistId = state.expandedPlaylistId === plId ? '' : plId;
        renderFeatured();
        renderPlaylists();
        return;
      }
      var trackBtn = e.target.closest('[data-dp-music-track]');
      if (trackBtn) {
        primePlaybackOnGesture();
        playTrack(
          trackBtn.getAttribute('data-dp-music-track'),
          trackBtn.getAttribute('data-dp-music-pl')
        );
      }
    });

    var miniPlay = $('dp-music-mini-play');
    if (miniPlay) miniPlay.addEventListener('click', toggleMiniPlayback);

    global.addEventListener('miya-deep-music-updated', function (ev) {
      var cid = ev && ev.detail && ev.detail.contactId;
      if (!cid || cid !== state.contactId || !state.open) return;
      loadMusicData(cid).then(function () {
        renderAll();
      });
    });

    global.addEventListener('miya-music-state', function () {
      if (state.open) {
        updateMiniPlayer();
        renderHero();
      }
    });
  }

  function open(contactId, phoneData, contactName) {
    var layer = $('dp-music');
    if (!layer) return;

    primePlaybackOnGesture();

    state.contactId = String(contactId || '').trim();
    state.phoneData = phoneData || null;
    state.contactName = String(contactName || '').trim() || 'ta';
    state.open = true;
    state.refreshing = !!activeJobs[state.contactId];

    layer.removeAttribute('hidden');
    requestAnimationFrame(function () {
      layer.classList.add('is-open');
    });

    loadMusicData(state.contactId).then(function (data) {
      if (data && data.refreshStatus === 'loading' && !activeJobs[state.contactId]) {
        var started = Number(data.refreshStartedAt) || 0;
        if (started && Date.now() - started > 300000) {
          musicStore().patchMusic(state.contactId, {
            refreshStatus: 'idle',
            refreshMessage: ''
          }).then(function (fixed) {
            state.musicData = fixed;
            renderAll();
          });
        }
      }
      if (data && data.refreshStatus === 'success') {
        musicStore().patchMusic(state.contactId, {
          refreshStatus: 'idle',
          refreshMessage: ''
        }).then(function (fixed) {
          state.musicData = fixed;
        }).catch(function () {});
      }
      state.refreshing = !!activeJobs[state.contactId] || (data && data.refreshStatus === 'loading');
      renderAll();
    });
  }

  function close() {
    var layer = $('dp-music');
    if (!layer) return;
    stopStatusDots();
    clearSuccessFlash();
    resolvingTrackId = '';
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

  global.miyaDeepMusic = {
    open: open,
    close: close,
    refresh: handleRefresh,
    isOpen: function () { return state.open; }
  };
})(typeof window !== 'undefined' ? window : global);
