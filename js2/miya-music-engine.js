/**
 * miya-music-engine.js — 音乐数据、网易云 API、播放核心
 */
(function (global) {
    'use strict';

    var LS_KEY = 'miya-music-data-v1';
    var APPEARANCE_BACKUP_KEY = 'miya-music-appearance-backup-v1';
    var APPEARANCE_PRESETS_KEY = 'miya-music-appearance-presets-v1';
    var APPEARANCE_RECOVER_KEYS = [
        'minePageBg', 'profileAvatar', 'profileNickname', 'mineStatusText',
        'playerBg', 'vinylCover', 'playerLyricsColor', 'playerLyricsFontSize'
    ];
    var LOCAL_AUDIO_DB = 'miya-music-local-audio-v1';
    var LOCAL_AUDIO_STORE = 'blobs';
    var localAudioBlobUrls = Object.create(null);

    var musicData = {
        library: [],
        playlists: [],
        nowPlaying: null,
        lastQuery: '',
        playMode: 'order',
        activePlaylistId: '',
        recentPlayIds: []
    };

    var saveChain = Promise.resolve();
    var dataReady = null;
    var dataHydrated = false;
    var pendingIdbHydrate = false;
    var musicAudio = null;
    var parsedLrc = [];
    var lyricsActiveIndex = -1;
    var neteaseUrlCache = { sid: '', url: '', at: 0 };
    var NETEASE_API = 'https://music.miruis.top';
    var NETEASE_SESSION_KEY = 'miya-netease-session-v1';
    var neteaseSession = null;
    var neteaseSessionReady = null;
    var lyricsPrefetchQueue = [];
    var lyricsPrefetchPending = {};
    var lyricsPrefetchRunning = 0;
    var LYRICS_PREFETCH_CONCURRENCY = 3;
    var coverPrefetchQueue = [];
    var coverPrefetchPending = {};
    var coverPrefetchRunning = 0;
    var COVER_PREFETCH_CONCURRENCY = 3;
    var onStatus = null;
    var onStateChange = null;
    var audioUiTick = null;
    var tickThrottleLast = 0;
    var tickThrottleTimer = null;
    var advancePlaybackChain = Promise.resolve();
    var playbackErrorRetries = 0;
    var playTrackInFlight = false;
    var playTrackGeneration = 0;
    var shuffleOrder = [];
    var shufflePos = -1;
    var shuffleQueueKey = '';
    var positionSaveTimer = null;
    var lastSavedPosition = -1;

    function isMobileDevice() {
        return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
            (navigator.maxTouchPoints > 1 && window.matchMedia('(hover: none)').matches);
    }

    function getTickThrottleMs() {
        if (!isMobileDevice()) return 280;
        if (document.documentElement && document.documentElement.classList.contains('is-low-end')) return 520;
        return 400;
    }

    var tickThrottleMs = getTickThrottleMs();

    function scheduleBackgroundPrefetch(fn) {
        if (document.hidden) return;
        var delay = isMobileDevice() ? 15000 : 1500;
        setTimeout(function () {
            if (document.hidden) return;
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(fn, { timeout: isMobileDevice() ? 20000 : 4000 });
            } else {
                fn();
            }
        }, delay);
    }

    function shouldPrefetchLibraryNow() {
        if (document.hidden) return false;
        if (!isMobileDevice()) return true;
        var musicApp = document.getElementById('miya-music-app');
        return !!(musicApp && musicApp.classList.contains('is-open'));
    }

    function prefetchLibraryOnIdle() {
        if (!shouldPrefetchLibraryNow()) return;
        var limit = isMobileDevice() ? 40 : 200;
        scheduleBackgroundPrefetch(function () {
            if (!shouldPrefetchLibraryNow()) return;
            prefetchLibraryLyricsMissing(limit);
            prefetchLibraryCoversMissing(limit);
        });
    }

    function uuid() {
        return 'music-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function setStatus(text, kind) {
        if (typeof onStatus === 'function') onStatus(text, kind);
    }

    function emitState() {
        var snap = buildSnapshot();
        if (typeof onStateChange === 'function') onStateChange(snap);
        try {
            global.dispatchEvent(new CustomEvent('miya-music-state', { detail: snap }));
        } catch (e) {}
    }

    function isAudioPlaying() {
        return !!(musicAudio && !musicAudio.paused && musicAudio.src);
    }

    function getPrefetchConcurrency(base) {
        if (isAudioPlaying()) return 1;
        if (isMobileDevice()) return 1;
        return base;
    }

    function getSavedPlaybackPosition() {
        var now = musicData.nowPlaying;
        if (!now) return 0;
        var pos = now.positionSec;
        return typeof pos === 'number' && isFinite(pos) && pos > 0 ? pos : 0;
    }

    function setNowPlayingPosition(sec) {
        if (!musicData.nowPlaying) return;
        var pos = typeof sec === 'number' && isFinite(sec) && sec > 0 ? sec : 0;
        musicData.nowPlaying.positionSec = pos;
    }

    function persistPlaybackPosition(force) {
        if (!musicData.nowPlaying || !musicAudio) return;
        var ct = musicAudio.currentTime;
        if (!isFinite(ct) || ct < 0) return;
        if (isFinite(musicAudio.duration) && musicAudio.duration > 1 && ct >= musicAudio.duration - 1) {
            setNowPlayingPosition(0);
            lastSavedPosition = 0;
            if (force) saveData();
            return;
        }
        var rounded = Math.round(ct * 10) / 10;
        if (!force && Math.abs(rounded - lastSavedPosition) < 0.5) return;
        lastSavedPosition = rounded;
        setNowPlayingPosition(rounded);
        saveData();
    }

    function schedulePersistPlaybackPosition() {
        if (positionSaveTimer) return;
        positionSaveTimer = setTimeout(function () {
            positionSaveTimer = null;
            persistPlaybackPosition(false);
        }, 2000);
    }

    function invokeAudioUiTick(immediate) {
        if (typeof audioUiTick !== 'function') return;
        if (musicAudio && !musicAudio.paused && musicAudio.src) schedulePersistPlaybackPosition();
        if (immediate) {
            if (tickThrottleTimer) {
                clearTimeout(tickThrottleTimer);
                tickThrottleTimer = null;
            }
            tickThrottleLast = Date.now();
            audioUiTick();
            return;
        }
        var now = Date.now();
        var elapsed = now - tickThrottleLast;
        if (elapsed >= tickThrottleMs) {
            tickThrottleLast = now;
            audioUiTick();
            return;
        }
        if (tickThrottleTimer) return;
        tickThrottleTimer = setTimeout(function () {
            tickThrottleTimer = null;
            tickThrottleLast = Date.now();
            if (typeof audioUiTick === 'function') audioUiTick();
        }, tickThrottleMs - elapsed);
    }

    function defaultAppearance() {
        return {
            minePageBg: null,
            profileAvatar: null,
            profileNickname: '',
            mineStatusText: '',
            playerBg: null,
            vinylCover: null,
            playerLyricsColor: '',
            playerLyricsFontSize: 0,
            desktopLyricsCss: '',
            desktopLyricsPresetName: ''
        };
    }

    function normalizeAppearance(raw) {
        var d = defaultAppearance();
        if (!raw || typeof raw !== 'object') return Object.assign({}, d);
        var minePageBg = raw.minePageBg || raw.homeBg || null;
        var fontSize = parseInt(raw.playerLyricsFontSize, 10);
        return {
            minePageBg: minePageBg ? String(minePageBg) : null,
            profileAvatar: raw.profileAvatar ? String(raw.profileAvatar) : null,
            profileNickname: String(raw.profileNickname || '').trim().slice(0, 32),
            mineStatusText: String(raw.mineStatusText || '').trim().slice(0, 32),
            playerBg: raw.playerBg ? String(raw.playerBg) : null,
            vinylCover: raw.vinylCover ? String(raw.vinylCover) : null,
            playerLyricsColor: String(raw.playerLyricsColor || '').trim().slice(0, 32),
            playerLyricsFontSize: Number.isFinite(fontSize) && fontSize >= 10 && fontSize <= 28 ? fontSize : 0,
            desktopLyricsCss: String(raw.desktopLyricsCss || ''),
            desktopLyricsPresetName: String(raw.desktopLyricsPresetName || '').trim().slice(0, 32)
        };
    }

    function appearanceHasAssets(ap) {
        if (!ap || typeof ap !== 'object') return false;
        return !!(ap.minePageBg || ap.profileAvatar || ap.playerBg || ap.vinylCover);
    }

    function snapshotAppearanceBackup(ap) {
        var snap = normalizeAppearance(ap);
        if (!appearanceHasAssets(snap) && !snap.profileNickname && !snap.mineStatusText) return;
        try {
            localStorage.setItem(APPEARANCE_BACKUP_KEY, JSON.stringify(snap));
        } catch (e) { /* ignore */ }
    }

    function readAppearanceBackup() {
        try {
            var raw = localStorage.getItem(APPEARANCE_BACKUP_KEY);
            return raw ? normalizeAppearance(JSON.parse(raw)) : null;
        } catch (e) {
            return null;
        }
    }

    function readAppearancePresets() {
        try {
            var raw = localStorage.getItem(APPEARANCE_PRESETS_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function mergeMissingAppearanceFields(target, source) {
        if (!source || typeof source !== 'object') return normalizeAppearance(target);
        var out = Object.assign({}, normalizeAppearance(target));
        APPEARANCE_RECOVER_KEYS.forEach(function (k) {
            if (out[k]) return;
            var v = source[k];
            if (k === 'minePageBg' || k === 'profileAvatar' || k === 'playerBg' || k === 'vinylCover') {
                if (v) out[k] = String(v);
            } else if (k === 'playerLyricsFontSize') {
                var n = parseInt(v, 10);
                if (Number.isFinite(n) && n >= 10 && n <= 28) out[k] = n;
            } else if (v != null && v !== '') {
                out[k] = String(v).trim().slice(0, 32);
            }
        });
        return normalizeAppearance(out);
    }

    function recoverAppearance(ap, rawAppearance) {
        var out = normalizeAppearance(ap);
        if (appearanceHasAssets(out)) {
            snapshotAppearanceBackup(out);
            return out;
        }
        out = mergeMissingAppearanceFields(out, rawAppearance);
        if (!appearanceHasAssets(out)) {
            out = mergeMissingAppearanceFields(out, readAppearanceBackup());
        }
        if (!appearanceHasAssets(out)) {
            var presets = readAppearancePresets();
            if (presets.length) {
                var pick = null;
                if (out.desktopLyricsPresetName) {
                    pick = presets.find(function (p) { return p && p.name === out.desktopLyricsPresetName; });
                }
                if (!pick) {
                    presets.slice().sort(function (a, b) {
                        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
                    });
                    pick = presets.find(function (p) {
                        return p && (p.minePageBg || p.profileAvatar || p.playerBg || p.vinylCover);
                    });
                }
                out = mergeMissingAppearanceFields(out, pick);
            }
        }
        if (appearanceHasAssets(out)) snapshotAppearanceBackup(out);
        return out;
    }

    function normalizeData(data) {
        var obj = data && typeof data === 'object' ? data : {};
        var out = {
            library: Array.isArray(obj.library) ? obj.library : [],
            playlists: Array.isArray(obj.playlists) ? obj.playlists : [],
            nowPlaying: obj.nowPlaying && typeof obj.nowPlaying === 'object' ? obj.nowPlaying : null,
            lastQuery: typeof obj.lastQuery === 'string' ? obj.lastQuery : '',
            playMode: obj.playMode === 'random' || obj.playMode === 'single' ? obj.playMode : 'order',
            activePlaylistId: typeof obj.activePlaylistId === 'string' ? obj.activePlaylistId : '',
            recentPlayIds: Array.isArray(obj.recentPlayIds)
                ? obj.recentPlayIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean).slice(0, 20)
                : [],
            desktopLyrics: !!obj.desktopLyrics,
            desktopLyricsMinimized: !!obj.desktopLyricsMinimized,
            desktopLyricsPos: obj.desktopLyricsPos && typeof obj.desktopLyricsPos === 'object'
                ? {
                    xPct: typeof obj.desktopLyricsPos.xPct === 'number'
                        ? Math.max(4, Math.min(96, obj.desktopLyricsPos.xPct))
                        : 50,
                    yPct: typeof obj.desktopLyricsPos.yPct === 'number'
                        ? Math.max(4, Math.min(88, obj.desktopLyricsPos.yPct))
                        : 14
                }
                : { xPct: 50, yPct: 14 },
            appearance: recoverAppearance(
                normalizeAppearance(obj.appearance),
                obj.appearance
            )
        };
        if (out.nowPlaying) {
            var savedPos = out.nowPlaying.positionSec;
            out.nowPlaying.positionSec =
                typeof savedPos === 'number' && isFinite(savedPos) && savedPos > 0 ? savedPos : 0;
        }
        out.library = out.library
            .map(function (item) {
                if (!item || typeof item !== 'object') return null;
                return {
                    id: item.id || uuid(),
                    title: String(item.title || '').trim() || '未命名歌曲',
                    artist: String(item.artist || '').trim(),
                    url: String(item.url || '').trim(),
                    lrc: typeof item.lrc === 'string' ? item.lrc : '',
                    neteaseSongId: String(item.neteaseSongId || '').trim(),
                    localAudioKey: String(item.localAudioKey || '').trim(),
                    durationSec:
                        typeof item.durationSec === 'number' && item.durationSec > 0
                            ? Math.round(item.durationSec)
                            : 0,
                    coverUrl: String(item.coverUrl || '').trim(),
                    addedAt: Number(item.addedAt || Date.now()),
                    lastPlayedAt: Number(item.lastPlayedAt || 0) || 0
                };
            })
            .filter(function (item) {
                if (!item) return false;
                if (String(item.localAudioKey || '').trim()) return true;
                if (String(item.url || '').trim()) return true;
                return /^\d{4,}$/.test(String(item.neteaseSongId || '').trim());
            });
        out.playlists = out.playlists
            .map(function (pl) {
                if (!pl || typeof pl !== 'object') return null;
                var name = String(pl.name || '').trim();
                var ids = Array.isArray(pl.trackIds) ? pl.trackIds.map(function (x) { return String(x || '').trim(); }).filter(Boolean) : [];
                return {
                    id: String(pl.id || uuid()),
                    name: name || '未命名歌单',
                    trackIds: ids,
                    createdAt: Number(pl.createdAt || Date.now()),
                    updatedAt: Number(pl.updatedAt || pl.createdAt || Date.now())
                };
            })
            .filter(Boolean);
        return out;
    }

    function trySyncHydrate() {
        loadNeteaseSession();
        try {
            if (typeof global.miyaSyncReadJsonKey === 'function') {
                var parsed = global.miyaSyncReadJsonKey(LS_KEY);
                if (parsed != null) {
                    var apBefore = normalizeAppearance((parsed.appearance) || {});
                    var data = normalizeData(parsed);
                    if (!appearanceHasAssets(apBefore) && appearanceHasAssets(data.appearance)) {
                        try {
                            localStorage.setItem(LS_KEY, JSON.stringify(data));
                        } catch (e) { /* ignore */ }
                        try {
                            global.dispatchEvent(new CustomEvent('miya-music-appearance-recovered'));
                        } catch (e2) { /* ignore */ }
                    }
                    return data;
                }
            }
            var raw = localStorage.getItem(LS_KEY);
            if (raw && typeof global.miyaLsIsIdbPlaceholder === 'function' && global.miyaLsIsIdbPlaceholder(raw)) {
                pendingIdbHydrate = true;
                return null;
            }
            return normalizeData(raw ? JSON.parse(raw) : {});
        } catch (e) {
            return normalizeData({});
        }
    }

    function applyHydratedData(raw) {
        var apBefore = null;
        if (raw && raw.appearance) {
            apBefore = normalizeAppearance(raw.appearance);
        }
        if (raw && typeof raw === 'object') {
            musicData = mergeMemAppearanceIntoData(raw);
            dataHydrated = true;
            pendingIdbHydrate = false;
            restoreNowPlayingUiState();
            if (!appearanceHasAssets(apBefore) && appearanceHasAssets(musicData.appearance)) {
                persistMusicData();
                try {
                    global.dispatchEvent(new CustomEvent('miya-music-appearance-recovered'));
                } catch (e) { /* ignore */ }
            }
            return true;
        }
        var sync = trySyncHydrate();
        if (sync) {
            musicData = mergeMemAppearanceIntoData(sync);
            dataHydrated = true;
            pendingIdbHydrate = false;
            restoreNowPlayingUiState();
            return true;
        }
        if (pendingIdbHydrate) return false;
        musicData = mergeMemAppearanceIntoData(musicData || {});
        dataHydrated = true;
        restoreNowPlayingUiState();
        return true;
    }

    function restoreNowPlayingUiState() {
        var now = musicData.nowPlaying;
        if (!now) {
            parsedLrc = [];
            lyricsActiveIndex = -1;
            lastSavedPosition = -1;
            return;
        }
        parsedLrc = parseLrcText(now.lrc || '');
        var pos = getSavedPlaybackPosition();
        lastSavedPosition = pos > 0 ? pos : -1;
        if (pos > 0 && parsedLrc.length) updateLyricsActive(pos);
        else lyricsActiveIndex = -1;
    }

    function loadData() {
        var sync = trySyncHydrate();
        if (sync) {
            musicData = mergeMemAppearanceIntoData(sync);
            dataHydrated = true;
            pendingIdbHydrate = false;
            restoreNowPlayingUiState();
            emitState();
            prefetchLibraryOnIdle();
        } else if (!pendingIdbHydrate) {
            musicData = mergeMemAppearanceIntoData({});
            dataHydrated = true;
            restoreNowPlayingUiState();
            emitState();
            prefetchLibraryOnIdle();
        }
        return musicData;
    }

    function loadDataWithTimeout(ms) {
        if (dataReady && dataHydrated) return dataReady;
        var timeoutMs = ms || 8000;
        var loadPromise =
            typeof global.miyaReadLsJsonKey === 'function'
                ? global.miyaReadLsJsonKey(LS_KEY, null).then(function (raw) {
                      if (!applyHydratedData(raw)) {
                          musicData = mergeMemAppearanceIntoData(musicData || {});
                      }
                      emitState();
                      prefetchLibraryOnIdle();
                      return musicData;
                  })
                : Promise.resolve(loadData());
        dataReady = Promise.race([
            loadPromise,
            new Promise(function (_, reject) {
                setTimeout(function () { reject(new Error('timeout')); }, timeoutMs);
            })
        ]).catch(function () {
            if (pendingIdbHydrate && !dataHydrated) {
                return loadPromise.then(function () {
                    emitState();
                    return musicData;
                });
            }
            dataReady = null;
            emitState();
            return musicData;
        });
        return dataReady;
    }

    function persistMusicData() {
        musicData = normalizeData(musicData);
        if (typeof global.miyaWriteLsJsonKey === 'function') {
            return global.miyaWriteLsJsonKey(LS_KEY, musicData).then(function (ok) {
                if (!ok) setStatus('曲库保存失败，空间可能不足', 'err');
            });
        }
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(musicData));
        } catch (e) {
            setStatus('曲库保存失败，空间可能不足', 'err');
        }
        return Promise.resolve();
    }

    function appearanceUserPatch(ap) {
        var src = normalizeAppearance(ap);
        var patch = {};
        if (src.minePageBg) patch.minePageBg = src.minePageBg;
        if (src.profileAvatar) patch.profileAvatar = src.profileAvatar;
        if (src.playerBg) patch.playerBg = src.playerBg;
        if (src.vinylCover) patch.vinylCover = src.vinylCover;
        if (src.profileNickname) patch.profileNickname = src.profileNickname;
        if (src.mineStatusText) patch.mineStatusText = src.mineStatusText;
        if (src.playerLyricsColor) patch.playerLyricsColor = src.playerLyricsColor;
        if (src.playerLyricsFontSize) patch.playerLyricsFontSize = src.playerLyricsFontSize;
        if (src.desktopLyricsCss) patch.desktopLyricsCss = src.desktopLyricsCss;
        if (src.desktopLyricsPresetName) patch.desktopLyricsPresetName = src.desktopLyricsPresetName;
        return patch;
    }

    function mergeMemAppearanceIntoData(data) {
        var memApPatch = appearanceUserPatch(musicData.appearance);
        var next = normalizeData(data);
        if (Object.keys(memApPatch).length) {
            next.appearance = normalizeAppearance(
                Object.assign({}, next.appearance, memApPatch)
            );
            if (appearanceHasAssets(next.appearance)) {
                snapshotAppearanceBackup(next.appearance);
            }
        }
        return next;
    }

    function saveData() {
        saveChain = saveChain.catch(function () {}).then(function () {
            var memApPatch = appearanceUserPatch(musicData.appearance);
            if (pendingIdbHydrate && !dataHydrated) {
                return loadDataWithTimeout(8000).then(function () {
                    if (Object.keys(memApPatch).length) {
                        musicData.appearance = normalizeAppearance(
                            Object.assign({}, musicData.appearance, memApPatch)
                        );
                        if (appearanceHasAssets(musicData.appearance)) {
                            snapshotAppearanceBackup(musicData.appearance);
                        }
                    }
                    return persistMusicData();
                });
            }
            return persistMusicData();
        });
        return saveChain;
    }

    function firstUrlFromText(text) {
        var m = String(text || '').match(/https?:\/\/[^\s)）\]】;；,，]+/i);
        return m ? m[0] : '';
    }

    function formatTime(sec) {
        if (!isFinite(sec) || sec < 0) sec = 0;
        var m = Math.floor(sec / 60);
        var s = Math.floor(sec % 60);
        return m + ':' + String(s).padStart(2, '0');
    }

    function parseArtistTitle(name) {
        var s = String(name || '').trim();
        var m = s.match(/^(.+?)\s*[-–—:：]\s*(.+)$/);
        if (m) return { artist: m[1].trim(), title: m[2].trim() };
        return { artist: '', title: s };
    }

    function guessTitleFromAudioUrl(url) {
        try {
            var u = new URL(String(url || '').trim());
            var seg = u.pathname.split('/').pop() || '';
            seg = decodeURIComponent(seg.replace(/\+/g, ' ')).trim();
            return seg.replace(/\.(mp3|m4a|flac|aac|ogg|wav|opus)$/i, '').trim();
        } catch (e) {
            return '';
        }
    }

    function normalizeAudioUrl(url) {
        var s = String(url || '').trim();
        if (!s) return '';
        if (/^data:/i.test(s) || /^blob:/i.test(s)) return s;
        if (!/^https?:\/\//i.test(s)) return '';
        return s.replace(/^http:\/\//i, 'https://');
    }

    function openLocalAudioDb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(LOCAL_AUDIO_DB, 1);
            req.onerror = function () { reject(req.error); };
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(LOCAL_AUDIO_STORE)) {
                    db.createObjectStore(LOCAL_AUDIO_STORE);
                }
            };
            req.onsuccess = function () { resolve(req.result); };
        });
    }

    function idbPutLocalAudio(key, blob) {
        return openLocalAudioDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(LOCAL_AUDIO_STORE, 'readwrite');
                tx.objectStore(LOCAL_AUDIO_STORE).put(blob, key);
                tx.oncomplete = function () { resolve(key); };
                tx.onerror = function () { reject(tx.error); };
            });
        });
    }

    function idbGetLocalAudio(key) {
        return openLocalAudioDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(LOCAL_AUDIO_STORE, 'readonly');
                var req = tx.objectStore(LOCAL_AUDIO_STORE).get(key);
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function isLocalAudioFile(file) {
        if (!file) return false;
        var name = String(file.name || '').toLowerCase();
        if (/\.(mp3|m4a|flac|aac|ogg|wav|opus|webm|mp4)(\?.*)?$/.test(name)) return true;
        var mime = String(file.type || '').toLowerCase();
        return mime.indexOf('audio/') === 0;
    }

    function probeAudioDurationSec(file) {
        if (!file || typeof URL === 'undefined' || typeof Audio === 'undefined') {
            return Promise.resolve(0);
        }
        var url = URL.createObjectURL(file);
        return new Promise(function (resolve) {
            var audio = new Audio();
            var done = false;
            function finish(sec) {
                if (done) return;
                done = true;
                try { URL.revokeObjectURL(url); } catch (e) {}
                resolve(sec);
            }
            audio.preload = 'metadata';
            audio.addEventListener('loadedmetadata', function () {
                var d = Number(audio.duration);
                finish(isFinite(d) && d > 0 ? Math.round(d) : 0);
            });
            audio.addEventListener('error', function () { finish(0); });
            audio.src = url;
            setTimeout(function () { finish(0); }, 8000);
        });
    }

    function resolveLocalAudioPlayUrl(track) {
        var key = track && String(track.localAudioKey || '').trim();
        if (!key) return Promise.resolve('');
        var cacheKey = String(track.id || key);
        if (localAudioBlobUrls[cacheKey]) return Promise.resolve(localAudioBlobUrls[cacheKey]);
        return idbGetLocalAudio(key).then(function (blob) {
            if (!blob) return '';
            var url = URL.createObjectURL(blob);
            localAudioBlobUrls[cacheKey] = url;
            return url;
        });
    }

    function isDirectAudioUrl(url) {
        var raw = String(url || '').trim();
        if (/^data:audio\//i.test(raw) || /^blob:/i.test(raw)) return true;
        var u = normalizeAudioUrl(url);
        if (!u) return false;
        return /\.(mp3|m4a|flac|aac|ogg|wav|opus)(\?|$)/i.test(u) || /\/song\/media\/outer\/url/i.test(u);
    }

    function parseLrcText(text) {
        if (!text || !String(text).trim()) return [];
        var lines = [];
        var re = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/;
        String(text)
            .split(/\n/)
            .forEach(function (line) {
                var m = line.trim().match(re);
                if (!m) return;
                var min = parseInt(m[1], 10);
                var sec = parseInt(m[2], 10);
                var frac = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
                var t = min * 60 + sec + frac / 1000;
                var txt = String(m[4] || '').trim();
                if (txt) lines.push({ t: t, text: txt });
            });
        lines.sort(function (a, b) { return a.t - b.t; });
        return lines;
    }

    function extractNeteaseSongId(input) {
        var raw = String(input || '').trim();
        if (!raw) return '';
        if (/^data:/i.test(raw) || /^blob:/i.test(raw)) return '';
        var orpheus = raw.match(/orpheus:\/\/song\/(\d{4,})\/(\d{4,})(?=autoplay=|$)/i);
        if (orpheus) return orpheus[2] || orpheus[1] || '';
        var urlId = raw.match(/[?&]id=(\d{4,})/i);
        if (urlId) return urlId[1];
        var pathId = raw.match(/\/song\/(\d{4,})/i) || raw.match(/\/song\?id=(\d{4,})/i);
        if (pathId) return pathId[1];
        return /^\d{4,}$/.test(raw) ? raw : '';
    }

    function extractNeteasePlaylistId(input) {
        var raw = String(input || '').trim();
        if (!raw) return '';
        var orpheusPid = raw.match(/orpheus:\/\/song\/\d+\/(\d{5,})/i);
        if (orpheusPid) return orpheusPid[1];
        var normalized = firstUrlFromText(raw) || raw;
        if (/^\d{5,}$/.test(normalized)) return normalized;
        var idFromText = normalized.match(/(?:playlist|list)\s*id[=:：\s]+(\d{5,})/i);
        if (idFromText) return idFromText[1];
        try {
            var u = new URL(normalized);
            var qid = u.searchParams.get('id');
            if (qid && /^\d{5,}$/.test(qid)) return qid;
            var m = u.pathname.match(/playlist\/(\d{5,})/i);
            if (m) return m[1];
        } catch (e) {}
        var any = normalized.match(/(\d{5,})/);
        return any ? any[1] : '';
    }

    async function fetchJsonWithTimeout(url, timeoutMs) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = null;
        if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
        try {
            var res = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'application/json' },
                signal: ctrl ? ctrl.signal : undefined
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    async function fetchTextWithTimeout(url, timeoutMs) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = null;
        if (ctrl) timer = setTimeout(function () { ctrl.abort(); }, timeoutMs || 12000);
        try {
            var res = await fetch(url, {
                method: 'GET',
                headers: { Accept: 'text/plain, text/html, application/json' },
                signal: ctrl ? ctrl.signal : undefined
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.text();
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

    function parseJsonFromBracketSlice(text) {
        var t = String(text || '').trim();
        if (!t) throw new Error('no-json');
        if (t.charAt(0) === '{' || t.charAt(0) === '[') {
            try { return JSON.parse(t); } catch (e) {}
        }
        var a0 = t.indexOf('[');
        var a1 = t.lastIndexOf(']');
        if (a0 >= 0 && a1 > a0) {
            try { return JSON.parse(t.slice(a0, a1 + 1)); } catch (e2) {}
        }
        var b0 = t.indexOf('{');
        var b1 = t.lastIndexOf('}');
        if (b0 >= 0 && b1 > b0) return JSON.parse(t.slice(b0, b1 + 1));
        throw new Error('no-json');
    }

    function parseNeteaseSession(raw) {
        if (!raw || typeof raw !== 'object') return null;
        if (typeof raw.cookie !== 'string' || !raw.cookie.trim()) return null;
        return {
            cookie: raw.cookie.trim(),
            uid: String(raw.uid || '').trim(),
            nickname: String(raw.nickname || '').trim(),
            avatar: String(raw.avatar || '').trim(),
            loginAt: Number(raw.loginAt || 0) || Date.now()
        };
    }

    function loadNeteaseSession() {
        if (neteaseSession) return neteaseSession;
        try {
            if (typeof global.miyaSyncReadJsonKey === 'function') {
                var parsed = global.miyaSyncReadJsonKey(NETEASE_SESSION_KEY);
                neteaseSession = parseNeteaseSession(parsed);
                if (neteaseSession) return neteaseSession;
            }
            var raw = localStorage.getItem(NETEASE_SESSION_KEY);
            if (raw && typeof global.miyaLsIsIdbPlaceholder === 'function' && global.miyaLsIsIdbPlaceholder(raw)) {
                return null;
            }
            neteaseSession = parseNeteaseSession(raw ? JSON.parse(raw) : null);
        } catch (e) {
            neteaseSession = null;
        }
        return neteaseSession;
    }

    function hydrateNeteaseSessionFromIdb() {
        if (neteaseSessionReady) return neteaseSessionReady;
        neteaseSessionReady = (typeof global.miyaReadLsJsonKey === 'function'
            ? global.miyaReadLsJsonKey(NETEASE_SESSION_KEY, null)
            : Promise.resolve(null)
        ).then(function (parsed) {
            neteaseSession = parseNeteaseSession(parsed);
            return neteaseSession;
        }).catch(function () {
            neteaseSession = null;
            return null;
        });
        return neteaseSessionReady;
    }

    function saveNeteaseSession(sess) {
        if (sess && sess.cookie) {
            neteaseSession = {
                cookie: String(sess.cookie).trim(),
                uid: String(sess.uid || '').trim(),
                nickname: String(sess.nickname || '').trim(),
                avatar: String(sess.avatar || '').trim(),
                loginAt: Number(sess.loginAt || Date.now())
            };
            if (typeof global.miyaWriteLsJsonKey === 'function') {
                global.miyaWriteLsJsonKey(NETEASE_SESSION_KEY, neteaseSession).catch(function () {});
            } else {
                try {
                    localStorage.setItem(NETEASE_SESSION_KEY, JSON.stringify(neteaseSession));
                } catch (e2) {}
            }
        } else {
            neteaseSession = null;
            neteaseSessionReady = null;
            if (typeof global.miyaWidgetKvIdbDelete === 'function') {
                global.miyaWidgetKvIdbDelete(NETEASE_SESSION_KEY).catch(function () {});
            }
            try {
                localStorage.removeItem(NETEASE_SESSION_KEY);
            } catch (e3) {}
        }
    }

    function getNeteaseSession() {
        if (!neteaseSession) loadNeteaseSession();
        return neteaseSession;
    }

    function isNeteaseLoggedIn() {
        var s = getNeteaseSession();
        return !!(s && s.cookie);
    }

    function neteaseApiUrl(path, params) {
        var p = params && typeof params === 'object' ? Object.assign({}, params) : {};
        var sess = getNeteaseSession();
        if (sess && sess.cookie && !p.cookie) p.cookie = sess.cookie;
        var qs = Object.keys(p)
            .filter(function (k) {
                return p[k] != null && String(p[k]).trim() !== '';
            })
            .map(function (k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k]).trim());
            })
            .join('&');
        var base = NETEASE_API + (path.charAt(0) === '/' ? path : '/' + path);
        return qs ? base + (base.indexOf('?') >= 0 ? '&' : '?') + qs : base;
    }

    function neteaseQrImageUrl(qrurl) {
        var u = String(qrurl || '').trim();
        if (!u) return '';
        return (
            'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=' + encodeURIComponent(u)
        );
    }

    function extractNeteaseCookie(data) {
        if (!data || typeof data !== 'object') return '';
        if (typeof data.cookie === 'string' && data.cookie.trim()) return data.cookie.trim();
        if (data.data && typeof data.data.cookie === 'string' && data.data.cookie.trim()) return data.data.cookie.trim();
        return '';
    }

    function extractNeteaseProfile(data) {
        var p = (data && data.profile) || (data && data.data && data.data.profile) || null;
        if (!p || typeof p !== 'object') return null;
        return {
            uid: String(p.userId != null ? p.userId : p.uid || '').trim(),
            nickname: String(p.nickname || p.nickName || '').trim(),
            avatar: String(p.avatarUrl || p.avatar || '').trim()
        };
    }

    function extractUserPlaylistsFromJson(data) {
        var list =
            data && Array.isArray(data.playlist)
                ? data.playlist
                : data && data.data && Array.isArray(data.data.playlist)
                  ? data.data.playlist
                  : [];
        return list
            .map(function (pl) {
                if (!pl || typeof pl !== 'object') return null;
                return {
                    id: String(pl.id || '').trim(),
                    name: String(pl.name || '').trim() || '未命名歌单',
                    trackCount: Number(pl.trackCount != null ? pl.trackCount : pl.trackNumber) || 0,
                    cover: String(pl.coverImgUrl || pl.coverImg || '').trim()
                };
            })
            .filter(function (x) {
                return x && /^\d{5,}$/.test(x.id);
            });
    }

    async function neteaseLoginStatus() {
        try {
            var data = await fetchJsonWithCorsFallback(neteaseApiUrl('/login/status'), 8000);
            var code = data && data.data && data.data.code != null ? data.data.code : data && data.code;
            if (code === 200 && data.data && data.data.account && data.data.profile) {
                var prof = extractNeteaseProfile(data);
                var cookie = extractNeteaseCookie(data);
                if (!cookie && getNeteaseSession()) cookie = getNeteaseSession().cookie;
                if (prof && cookie) {
                    saveNeteaseSession({
                        cookie: cookie,
                        uid: prof.uid,
                        nickname: prof.nickname,
                        avatar: prof.avatar,
                        loginAt: Date.now()
                    });
                    return { loggedIn: true, profile: prof };
                }
            }
            if (isNeteaseLoggedIn()) {
                var sess = getNeteaseSession();
                return {
                    loggedIn: true,
                    profile: { uid: sess.uid, nickname: sess.nickname, avatar: sess.avatar }
                };
            }
            return { loggedIn: false, profile: null };
        } catch (e) {
            if (isNeteaseLoggedIn()) {
                var s = getNeteaseSession();
                return {
                    loggedIn: true,
                    profile: { uid: s.uid, nickname: s.nickname, avatar: s.avatar }
                };
            }
            return { loggedIn: false, profile: null };
        }
    }

    async function neteaseQrLoginStart() {
        var keyData = await fetchJsonWithCorsFallback(neteaseApiUrl('/login/qr/key'), 8000);
        var key =
            (keyData && keyData.data && keyData.data.unikey) ||
            (keyData && keyData.unikey) ||
            '';
        key = String(key || '').trim();
        if (!key) throw new Error('无法获取登录二维码');
        var createData = await fetchJsonWithCorsFallback(neteaseApiUrl('/login/qr/create', { key: key, qrimg: true }), 8000);
        var qrurl =
            (createData && createData.data && createData.data.qrurl) ||
            (createData && createData.qrurl) ||
            'https://music.163.com/login?codekey=' + encodeURIComponent(key);
        var qrimg =
            (createData && createData.data && createData.data.qrimg) ||
            (createData && createData.qrimg) ||
            '';
        if (qrimg && !/^https?:\/\//i.test(qrimg)) {
            if (qrimg.indexOf('data:') !== 0) qrimg = 'data:image/png;base64,' + qrimg;
        } else if (!qrimg) {
            qrimg = neteaseQrImageUrl(qrurl);
        }
        return { key: key, qrurl: qrurl, qrimg: qrimg };
    }

    async function neteaseQrLoginPoll(key) {
        var k = String(key || '').trim();
        if (!k) throw new Error('二维码已失效');
        var data = await fetchJsonWithCorsFallback(neteaseApiUrl('/login/qr/check', { key: k, timestamp: Date.now() }), 8000);
        var code = data && data.code != null ? Number(data.code) : data && data.data && data.data.code != null ? Number(data.data.code) : 0;
        var cookie = extractNeteaseCookie(data);
        var profile = extractNeteaseProfile(data);
        if ((code === 803 || code === 200) && cookie) {
            saveNeteaseSession({
                cookie: cookie,
                uid: profile ? profile.uid : '',
                nickname: profile ? profile.nickname : '网易云用户',
                avatar: profile ? profile.avatar : '',
                loginAt: Date.now()
            });
            return { status: 'success', code: code, profile: profile || { uid: '', nickname: '网易云用户', avatar: '' } };
        }
        if (code === 800) return { status: 'expired', code: code };
        if (code === 802) return { status: 'scanned', code: code };
        if (code === 801) return { status: 'waiting', code: code };
        return { status: 'waiting', code: code };
    }

    function neteaseLogout() {
        saveNeteaseSession(null);
        neteaseUrlCache = { sid: '', url: '', at: 0 };
        fetchJsonWithCorsFallback(neteaseApiUrl('/logout'), 5000).catch(function () {});
    }

    async function refreshNeteaseUidFromAccount() {
        try {
            var data = await fetchJsonWithCorsFallback(neteaseApiUrl('/user/account'), 8000);
            var acc = (data && data.account) || (data && data.data && data.data.account) || (data && data.profile) || null;
            var uid = acc ? String(acc.id != null ? acc.id : acc.userId || '').trim() : '';
            if (!uid) {
                var prof = extractNeteaseProfile(data);
                uid = prof ? prof.uid : '';
            }
            if (uid && getNeteaseSession()) {
                var s = getNeteaseSession();
                saveNeteaseSession({
                    cookie: s.cookie,
                    uid: uid,
                    nickname: (acc && String(acc.nickname || '').trim()) || s.nickname,
                    avatar: (acc && String(acc.avatarUrl || '').trim()) || s.avatar,
                    loginAt: s.loginAt
                });
            }
            return uid;
        } catch (e) {
            return '';
        }
    }

    async function fetchUserNeteasePlaylists() {
        var sess = getNeteaseSession();
        if (!sess || !sess.cookie) throw new Error('请先登录网易云');
        var uid = String(sess.uid || '').trim();
        if (!uid) {
            await neteaseLoginStatus();
            uid = String(getNeteaseSession().uid || '').trim();
        }
        if (!uid) uid = await refreshNeteaseUidFromAccount();
        if (!uid) throw new Error('无法获取用户 ID，请重新登录');
        var data = await fetchJsonWithCorsFallback(
            neteaseApiUrl('/user/playlist', { uid: uid, limit: 1000, offset: 0 }),
            15000
        );
        var list = extractUserPlaylistsFromJson(data);
        if (!list.length) throw new Error('未读取到歌单，请确认账号下有自建或收藏歌单');
        return list;
    }

    async function fetchJsonWithCorsFallback(url, timeoutMs) {
        try {
            return await fetchJsonWithTimeout(url, timeoutMs);
        } catch (e) {
            var tmo = timeoutMs || 12000;
            var allOriginsGet = 'https://api.allorigins.win/get?url=' + encodeURIComponent(url);
            try {
                var outer = await fetchJsonWithTimeout(allOriginsGet, tmo);
                if (outer && typeof outer.contents === 'string' && outer.contents) {
                    return parseJsonFromBracketSlice(outer.contents);
                }
            } catch (e2) {}
            var allOriginsRaw = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
            try {
                var text = await fetchTextWithTimeout(allOriginsRaw, tmo);
                return parseJsonFromBracketSlice(text);
            } catch (e3) {}
            var jinaUrl = 'https://r.jina.ai/' + url;
            var jinaText = await fetchTextWithTimeout(jinaUrl, tmo);
            return parseJsonFromBracketSlice(jinaText);
        }
    }

    function deepFindAudioUrl(value) {
        if (!value) return '';
        if (typeof value === 'string') {
            var s = normalizeAudioUrl(value);
            if (!s) return '';
            if (
                /\.(mp3|m4a|flac|aac|ogg|wav|opus)(\?|$)/i.test(s) ||
                /\.m3u8(\?|$)/i.test(s) ||
                /\/song\/media\/outer\/url/i.test(s) ||
                /music\.126\.net/i.test(s)
            ) {
                return s;
            }
            return '';
        }
        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) {
                var got = deepFindAudioUrl(value[i]);
                if (got) return got;
            }
            return '';
        }
        if (typeof value === 'object') {
            var keys = ['url', 'playUrl', 'play_url', 'musicUrl', 'music_url', 'src', 'audio', 'songUrl'];
            for (var j = 0; j < keys.length; j++) {
                if (Object.prototype.hasOwnProperty.call(value, keys[j])) {
                    var hit = deepFindAudioUrl(value[keys[j]]);
                    if (hit) return hit;
                }
            }
            var allKeys = Object.keys(value);
            for (var k = 0; k < allKeys.length; k++) {
                var nested = deepFindAudioUrl(value[allKeys[k]]);
                if (nested) return nested;
            }
        }
        return '';
    }

    function deepFindTitle(value) {
        if (!value || typeof value !== 'object') return '';
        var keys = ['title', 'name', 'songName', 'song_name'];
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
        }
        if (Array.isArray(value)) {
            for (var j = 0; j < value.length; j++) {
                var arrHit = deepFindTitle(value[j]);
                if (arrHit) return arrHit;
            }
            return '';
        }
        var objKeys = Object.keys(value);
        for (var n = 0; n < objKeys.length; n++) {
            var hit = deepFindTitle(value[objKeys[n]]);
            if (hit) return hit;
        }
        return '';
    }

    function looksLikeLrcBody(text) {
        var s = String(text || '').trim();
        if (!s) return false;
        return /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(s);
    }

    function deepFindLyric(value, depth) {
        if (!value || (depth || 0) > 8) return '';
        if (typeof value === 'string') {
            return looksLikeLrcBody(value) ? value.trim() : '';
        }
        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) {
                var arrHit = deepFindLyric(value[i], (depth || 0) + 1);
                if (arrHit) return arrHit;
            }
            return '';
        }
        if (typeof value === 'object') {
            var keys = ['lyric', 'tlyric', 'klyric', 'lrc', 'syncedLyrics', 'plainLyrics'];
            for (var j = 0; j < keys.length; j++) {
                if (Object.prototype.hasOwnProperty.call(value, keys[j])) {
                    var hit = deepFindLyric(value[keys[j]], (depth || 0) + 1);
                    if (hit) return hit;
                }
            }
            var allKeys = Object.keys(value);
            for (var k = 0; k < allKeys.length; k++) {
                var nested = deepFindLyric(value[allKeys[k]], (depth || 0) + 1);
                if (nested) return nested;
            }
        }
        return '';
    }

    function parseLyricFromPayload(data) {
        if (!data || typeof data !== 'object') return '';
        if (typeof data.lyric === 'string' && data.lyric.trim()) return data.lyric.trim();
        if (data.lrc && typeof data.lrc === 'object') {
            var keys = ['lyric', 'tlyric', 'klyric'];
            for (var i = 0; i < keys.length; i++) {
                var v = data.lrc[keys[i]];
                if (typeof v === 'string' && v.trim()) return v.trim();
            }
        }
        return deepFindLyric(data, 0);
    }

    function lrclibPickLyrics(j) {
        if (!j || typeof j !== 'object') return '';
        if (typeof j.syncedLyrics === 'string' && j.syncedLyrics.trim()) return j.syncedLyrics.trim();
        if (typeof j.plainLyrics === 'string' && j.plainLyrics.trim()) {
            return j.plainLyrics
                .split(/\r?\n/)
                .map(function (x, i) {
                    var txt = String(x || '').trim();
                    if (!txt) return '';
                    var sec = i * 5;
                    return '[' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + '.00] ' + txt;
                })
                .filter(Boolean)
                .join('\n');
        }
        return '';
    }

    async function fetchLrclibLrc(trackName, artistName) {
        var t = String(trackName || '').trim();
        var a = String(artistName || '').trim();
        if (!t) return '';
        try {
            var u =
                'https://lrclib.net/api/get?track_name=' +
                encodeURIComponent(t) +
                '&artist_name=' +
                encodeURIComponent(a);
            var r = await fetch(u, { method: 'GET', mode: 'cors' });
            if (r.ok) {
                var got = lrclibPickLyrics(await r.json());
                if (got) return got;
            }
        } catch (e) {}
        try {
            var q = [t, a].filter(Boolean).join(' ');
            var su = 'https://lrclib.net/api/search?q=' + encodeURIComponent(q);
            var sr = await fetch(su, { method: 'GET', mode: 'cors' });
            if (!sr.ok) return '';
            var list = await sr.json();
            if (!Array.isArray(list) || !list.length) return '';
            var best = list[0];
            for (var i = 0; i < list.length; i++) {
                var row = list[i];
                if (!row) continue;
                var tn = String(row.trackName || row.name || '').trim().toLowerCase();
                var an = String(row.artistName || row.artist || '').trim().toLowerCase();
                if (tn === t.toLowerCase() && (!a || !an || an.indexOf(a.toLowerCase()) >= 0 || a.toLowerCase().indexOf(an) >= 0)) {
                    best = row;
                    break;
                }
            }
            return lrclibPickLyrics(best);
        } catch (e2) {}
        return '';
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

    function extractSongCoverUrl(song) {
        if (!song || typeof song !== 'object') return '';
        var album = song.al || song.album;
        if (album && album.picUrl) return normalizeCoverUrl(album.picUrl);
        if (song.picUrl) return normalizeCoverUrl(song.picUrl);
        if (album && album.blurPicUrl) return normalizeCoverUrl(album.blurPicUrl);
        return '';
    }

    async function fetchNeteaseCoversBySongIds(sids) {
        var map = {};
        var list = (Array.isArray(sids) ? sids : [])
            .map(function (x) { return String(x || '').trim(); })
            .filter(function (x) { return /^\d{4,}$/.test(x); });
        if (!list.length) return map;
        var unique = [];
        var seen = {};
        list.forEach(function (sid) {
            if (seen[sid]) return;
            seen[sid] = true;
            unique.push(sid);
        });
        for (var off = 0; off < unique.length; off += 50) {
            var chunk = unique.slice(off, off + 50);
            try {
                var data = await fetchJsonWithCorsFallback(
                    neteaseApiUrl('/song/detail', { ids: chunk.join(',') }),
                    10000
                );
                var songs =
                    data && data.songs ? data.songs :
                    data && data.data && data.data.songs ? data.data.songs : [];
                if (!Array.isArray(songs)) continue;
                songs.forEach(function (song) {
                    var sid = String(song && song.id || '').trim();
                    var cover = extractSongCoverUrl(song);
                    if (sid && cover) map[sid] = cover;
                });
            } catch (e) {}
        }
        return map;
    }

    async function fillMissingNeteaseCovers(tracks) {
        var list = Array.isArray(tracks) ? tracks : [];
        var need = [];
        list.forEach(function (t) {
            if (!t) return;
            var sid = String(t.neteaseSongId || '').trim();
            if (!/^\d{4,}$/.test(sid)) return;
            if (String(t.coverUrl || '').trim()) return;
            need.push(sid);
        });
        if (!need.length) return list;
        var coverMap = await fetchNeteaseCoversBySongIds(need);
        list.forEach(function (t) {
            if (!t) return;
            var sid = String(t.neteaseSongId || '').trim();
            if (coverMap[sid]) t.coverUrl = coverMap[sid];
        });
        return list;
    }

    function extractNeteaseSongRow(song) {
        if (!song || typeof song !== 'object') return null;
        var sid = String(song.id || '').trim();
        if (!/^\d{4,}$/.test(sid)) return null;
        var artist = '';
        if (Array.isArray(song.ar)) artist = song.ar.map(function (x) { return x && x.name ? x.name : ''; }).filter(Boolean).join(' / ');
        else if (Array.isArray(song.artists)) artist = song.artists.map(function (x) { return x && x.name ? x.name : ''; }).filter(Boolean).join(' / ');
        var durMs = Number(song.dt != null ? song.dt : song.duration);
        return {
            id: sid,
            title: String(song.name || song.title || '').trim() || '网易云 ' + sid,
            artist: artist,
            duration: isFinite(durMs) && durMs > 0 ? durMs : 0,
            coverUrl: extractSongCoverUrl(song)
        };
    }

    function extractNeteaseSearchSongsFromJson(data) {
        var songs =
            data && data.result && data.result.songs ? data.result.songs :
            data && data.data && data.data.result && data.data.result.songs ? data.data.result.songs :
            data && data.songs ? data.songs : [];
        if (!Array.isArray(songs)) return [];
        return songs
            .map(extractNeteaseSongRow)
            .filter(Boolean);
    }

    async function searchNeteaseKeywords(keywords) {
        var q = String(keywords || '').trim();
        if (!q) return [];
        var url = neteaseApiUrl('/search', { keywords: q, type: 1, limit: 30 });
        try {
            var data = await fetchJsonWithCorsFallback(url, 9000);
            return extractNeteaseSearchSongsFromJson(data);
        } catch (e) {
            return [];
        }
    }

    async function fetchNeteaseSongTitleById(songId) {
        var sid = String(songId || '').trim();
        if (!/^\d{4,}$/.test(sid)) return '';
        try {
            var data = await fetchJsonWithCorsFallback(neteaseApiUrl('/song/detail', { ids: sid }), 8000);
            var songs = data && data.songs ? data.songs : data && data.data && data.data.songs ? data.data.songs : [];
            var first = Array.isArray(songs) ? songs[0] : null;
            if (!first) return deepFindTitle(data);
            var artist = '';
            if (Array.isArray(first.ar)) artist = first.ar.map(function (x) { return x && x.name ? x.name : ''; }).filter(Boolean).join(' / ');
            if (Array.isArray(first.artists)) artist = first.artists.map(function (x) { return x && x.name ? x.name : ''; }).filter(Boolean).join(' / ');
            var name = String(first.name || first.title || '').trim();
            return artist && name ? artist + ' - ' + name : name;
        } catch (e) {
            return '';
        }
    }

    async function fetchNeteaseLrcBySongId(songId) {
        var sid = String(songId || '').trim();
        if (!/^\d{4,}$/.test(sid)) return '';
        try {
            var data = await fetchJsonWithCorsFallback(neteaseApiUrl('/lyric', { id: sid }), 9000);
            return parseLyricFromPayload(data);
        } catch (e) {
            return '';
        }
    }

    var NETEASE_MEMBER_LEVELS = ['jymaster', 'hires', 'lossless', 'exhigh', 'higher', 'standard'];

    function isPlayableAudioUrl(url) {
        var s = normalizeAudioUrl(url);
        if (!s) return false;
        if (/^data:|^blob:/i.test(s)) return true;
        if (/\.(mp3|m4a|flac|aac|ogg|wav|opus)(\?|$)/i.test(s)) return true;
        if (/\.m3u8(\?|$)/i.test(s)) return true;
        if (/\/song\/media\/outer\/url/i.test(s)) return true;
        if (/music\.126\.net/i.test(s)) return true;
        return false;
    }

    function extractNeteasePlayUrlsFromPayload(data) {
        var urls = [];
        var seen = {};
        function push(u) {
            u = normalizeAudioUrl(u);
            if (!u || seen[u] || !isPlayableAudioUrl(u)) return;
            seen[u] = true;
            urls.push(u);
        }
        var rows = [];
        if (data && Array.isArray(data.data)) rows = data.data;
        else if (data && data.data && Array.isArray(data.data.data)) rows = data.data.data;
        else if (Array.isArray(data)) rows = data;
        rows.forEach(function (row) {
            if (!row || typeof row !== 'object') return;
            var u = String(row.url || row.playUrl || row.play_url || '').trim();
            if (u) push(u);
        });
        if (!urls.length) {
            var hit = deepFindAudioUrl(data);
            if (hit) push(hit);
        }
        return urls;
    }

    async function fetchNeteasePlayUrlsFromEndpoint(path, params, timeoutMs) {
        try {
            var data = await fetchJsonWithCorsFallback(neteaseApiUrl(path, params), timeoutMs || 8000);
            return extractNeteasePlayUrlsFromPayload(data);
        } catch (e) {
            return [];
        }
    }

    async function resolveNeteasePlayUrlCandidates(songId) {
        var sid = String(songId || '').trim();
        if (!/^\d{4,}$/.test(sid)) return [];
        var now = Date.now();
        if (neteaseUrlCache.sid === sid && neteaseUrlCache.url && now - neteaseUrlCache.at < 30000) {
            return [neteaseUrlCache.url];
        }
        var out = [];
        var seen = {};
        function addAll(list) {
            (list || []).forEach(function (u) {
                u = normalizeAudioUrl(u);
                if (!u || seen[u]) return;
                seen[u] = true;
                out.push(u);
            });
        }

        if (isNeteaseLoggedIn()) {
            for (var i = 0; i < NETEASE_MEMBER_LEVELS.length; i++) {
                var level = NETEASE_MEMBER_LEVELS[i];
                var hits = await fetchNeteasePlayUrlsFromEndpoint(
                    '/song/url/v1',
                    { id: sid, ids: sid, level: level },
                    8000
                );
                if (hits.length) {
                    addAll(hits);
                    break;
                }
            }
        }

        if (!out.length) {
            var brTiers = isNeteaseLoggedIn() ? [999000, 320000, 192000, 128000] : [320000, 192000, 128000];
            for (var b = 0; b < brTiers.length && !out.length; b++) {
                addAll(await fetchNeteasePlayUrlsFromEndpoint('/song/url', { id: sid, ids: sid, br: brTiers[b] }, 7000));
            }
        }
        if (!out.length) {
            try {
                var data = await fetchJsonWithCorsFallback(
                    NETEASE_API + '/song/url?id=' + encodeURIComponent(sid),
                    6000
                );
                addAll(extractNeteasePlayUrlsFromPayload(data));
            } catch (e2) {}
        }

        var outer = neteaseOuterPlayUrl(sid);
        if (outer) addAll([outer]);
        return out;
    }

    async function resolveNeteaseAudioUrlQuick(songId) {
        var list = await resolveNeteasePlayUrlCandidates(songId);
        if (!list.length) throw new Error('no-audio-url');
        return list[0];
    }

    function neteaseOuterPlayUrl(songId) {
        var sid = String(songId || '').trim();
        return /^\d{4,}$/.test(sid) ? 'https://music.163.com/song/media/outer/url?id=' + encodeURIComponent(sid) + '.mp3' : '';
    }

    async function resolveFreshNeteasePlayUrlCached(songId) {
        var sid = String(songId || '').trim();
        if (!/^\d{4,}$/.test(sid)) return '';
        var now = Date.now();
        if (neteaseUrlCache.sid === sid && neteaseUrlCache.url && now - neteaseUrlCache.at < 30000) return neteaseUrlCache.url;
        var url = '';
        try {
            url = await resolveNeteaseAudioUrlQuick(sid);
        } catch (e) {
            url = neteaseOuterPlayUrl(sid);
        }
        neteaseUrlCache = { sid: sid, url: url, at: Date.now() };
        return url;
    }

    function tryPlayAudioUrl(audio, url, timeoutMs, startAtSec) {
        return new Promise(function (resolve, reject) {
            if (!audio || !url) {
                reject(new Error('no-audio'));
                return;
            }
            var seekTo =
                typeof startAtSec === 'number' && isFinite(startAtSec) && startAtSec > 0 ? startAtSec : 0;
            var done = false;
            var timer = setTimeout(function () {
                if (done) return;
                done = true;
                cleanup();
                reject(new Error('audio-load-timeout'));
            }, timeoutMs || 14000);

            function cleanup() {
                clearTimeout(timer);
                audio.removeEventListener('canplay', onReady);
                audio.removeEventListener('error', onErr);
            }

            function onReady() {
                if (done) return;
                done = true;
                cleanup();
                if (seekTo > 0) {
                    try {
                        if (isFinite(audio.duration) && audio.duration > 0) {
                            audio.currentTime = Math.min(seekTo, Math.max(0, audio.duration - 0.25));
                        } else {
                            audio.currentTime = seekTo;
                        }
                    } catch (eSeek) {}
                }
                audio.play().then(function () { resolve(url); }).catch(reject);
            }

            function onErr() {
                if (done) return;
                done = true;
                cleanup();
                reject(new Error('audio-load-error'));
            }

            audio.addEventListener('canplay', onReady);
            audio.addEventListener('error', onErr);
            audio.src = url;
            try {
                audio.load();
            } catch (eLoad) {
                onErr();
            }
        });
    }

    function neteaseSearchRowToTrack(row) {
        var sid = String((row && row.id) || '').trim();
        if (!/^\d{4,}$/.test(sid)) throw new Error('单曲ID无效');
        var title = String((row && row.title) || '').trim() || '网易云歌曲 ' + sid;
        var parts = parseArtistTitle(title);
        return {
            id: uuid(),
            title: parts.title || title,
            artist: parts.artist || String((row && row.artist) || '').trim(),
            url: neteaseOuterPlayUrl(sid),
            lrc: '',
            neteaseSongId: sid,
            coverUrl: String((row && row.coverUrl) || '').trim(),
            addedAt: Date.now()
        };
    }

    function neteaseSearchRowCustomTitle(row) {
        if (!row) return '';
        return (row.artist ? row.artist + ' - ' : '') + (row.title || '');
    }

    async function resolveNeteaseSingleSong(songId, customTitle) {
        var sid = String(songId || '').trim();
        if (!/^\d{4,}$/.test(sid)) throw new Error('单曲ID无效');
        var results = await Promise.all([
            resolveFreshNeteasePlayUrlCached(sid),
            customTitle ? Promise.resolve(String(customTitle).trim()) : fetchNeteaseSongTitleById(sid),
            fetchNeteaseLrcBySongId(sid)
        ]);
        var title = results[1] || '网易云歌曲 ' + sid;
        var parts = parseArtistTitle(title);
        var coverUrl = '';
        try {
            var detailData = await fetchJsonWithCorsFallback(neteaseApiUrl('/song/detail', { ids: sid }), 6000);
            var songs = detailData && detailData.songs ? detailData.songs : detailData && detailData.data && detailData.data.songs ? detailData.data.songs : [];
            if (Array.isArray(songs) && songs[0]) coverUrl = extractSongCoverUrl(songs[0]);
        } catch (eCover) {}
        return {
            id: uuid(),
            title: parts.title || title,
            artist: parts.artist,
            url: results[0] || neteaseOuterPlayUrl(sid),
            lrc: results[2] || '',
            neteaseSongId: sid,
            coverUrl: coverUrl,
            addedAt: Date.now()
        };
    }

    async function enrichDirectAudioTrack(normalizedUrl, customTitle) {
        var sid = extractNeteaseSongId(normalizedUrl);
        var title = String(customTitle || '').trim();
        var lrc = sid ? await fetchNeteaseLrcBySongId(sid).catch(function () { return ''; }) : '';
        if (!title && sid) title = await fetchNeteaseSongTitleById(sid).catch(function () { return ''; });
        if (!title) title = guessTitleFromAudioUrl(normalizedUrl) || '导入单曲';
        var parts = parseArtistTitle(title);
        if (!lrc && (parts.title || title)) lrc = await fetchLrclibLrc(parts.title || title, parts.artist);
        var coverUrl = '';
        if (sid) {
            try {
                var coverMap = await fetchNeteaseCoversBySongIds([sid]);
                coverUrl = coverMap[sid] || '';
            } catch (eCover) {}
        }
        return {
            id: uuid(),
            title: title,
            artist: parts.artist,
            url: normalizedUrl,
            lrc: lrc || '',
            neteaseSongId: sid,
            coverUrl: coverUrl,
            addedAt: Date.now()
        };
    }

    async function resolveSingleTrackByApiUrl(apiUrl, customTitle) {
        var url = String(apiUrl || '').trim();
        if (!/^https?:\/\//i.test(url)) throw new Error('接口URL无效');
        try {
            var data = await fetchJsonWithCorsFallback(url, 10000);
            var audioUrl = deepFindAudioUrl(data);
            if (audioUrl) return enrichDirectAudioTrack(audioUrl, String(customTitle || '').trim() || deepFindTitle(data) || '导入单曲');
        } catch (e) {}
        var txt = await fetchTextWithTimeout(url, 10000);
        var m = txt.match(/https?:\/\/[^\s"'<>]+?\.(?:mp3|m4a|flac|aac|ogg|wav|opus)(?:\?[^\s"'<>]*)?/i);
        if (m && m[0]) return enrichDirectAudioTrack(normalizeAudioUrl(m[0]), customTitle || '导入单曲');
        throw new Error('未从接口中解析到可播放音频地址');
    }

    async function resolveSingleTrackFromInput(rawInput, customTitle) {
        var raw = String(rawInput || '').trim();
        if (!raw) throw new Error('请输入单曲链接/ID/接口URL');
        var maybeUrl = firstUrlFromText(raw) || raw;
        if (isDirectAudioUrl(maybeUrl)) return enrichDirectAudioTrack(normalizeAudioUrl(maybeUrl), customTitle);
        var sid = extractNeteaseSongId(raw);
        if (sid) return resolveNeteaseSingleSong(sid, customTitle);
        if (/^https?:\/\//i.test(maybeUrl)) return resolveSingleTrackByApiUrl(maybeUrl, customTitle);
        throw new Error('无法识别输入');
    }

    async function resolveNeteasePlaylistIdFromInput(input) {
        var pid = extractNeteasePlaylistId(input);
        if (pid) return pid;
        var url = firstUrlFromText(input);
        if (!url) return '';
        try {
            var host = new URL(url).hostname.toLowerCase();
            if (host !== '163cn.tv') return '';
            var html = await fetchTextWithTimeout(url, 10000);
            var m = html.match(/playlist\?id=(\d{5,})/i);
            return m ? m[1] : '';
        } catch (e) {
            return '';
        }
    }

    async function resolveGenericPlaylistFromApiUrl(apiUrl) {
        var data = await fetchJsonWithCorsFallback(apiUrl, 12000);
        var candidates = [];
        (function walk(value, depth) {
            if (!value || depth > 6) return;
            if (Array.isArray(value)) { value.forEach(function (it) { walk(it, depth + 1); }); return; }
            if (typeof value !== 'object') return;
            var hasTitle = !!deepFindTitle(value);
            var hasAudio = !!deepFindAudioUrl(value);
            var maybeId = String(value.id || value.songid || value.songId || '');
            if (hasTitle || hasAudio || /^\d{4,}$/.test(maybeId)) candidates.push(value);
            Object.keys(value).forEach(function (k) { walk(value[k], depth + 1); });
        })(data, 0);
        var seen = {};
        var out = [];
        for (var i = 0; i < candidates.length && out.length < 500; i++) {
            var item = candidates[i];
            var titleGuess = deepFindTitle(item) || ('导入歌曲 ' + (i + 1));
            var audioUrl = deepFindAudioUrl(item);
            var sid = String(item.id || item.songid || item.songId || '');
            if (!audioUrl && /^\d{4,}$/.test(sid)) {
                var nk = 'netease:' + sid;
                if (seen[nk]) continue;
                seen[nk] = true;
                var parts = parseArtistTitle(titleGuess);
                out.push({
                    id: uuid(),
                    title: parts.title || titleGuess || ('网易云 ' + sid),
                    artist: parts.artist || '',
                    url: '',
                    lrc: '',
                    neteaseSongId: sid,
                    addedAt: Date.now()
                });
                continue;
            }
            audioUrl = normalizeAudioUrl(audioUrl);
            if (!audioUrl) continue;
            var uk = 'url:' + audioUrl;
            if (seen[uk]) continue;
            seen[uk] = true;
            out.push(await enrichDirectAudioTrack(audioUrl, titleGuess));
        }
        if (!out.length) throw new Error('未解析出可播放链接');
        await fillMissingNeteaseCovers(out);
        return out;
    }

    async function resolveNeteasePlaylistTracks(playlistId) {
        var pid = String(playlistId || '').trim();
        if (!/^\d{5,}$/.test(pid)) throw new Error('歌单ID无效');
        var data = await fetchJsonWithCorsFallback(neteaseApiUrl('/playlist/track/all', { id: pid }), 12000);
        var songs = data && data.songs ? data.songs : data && data.playlist && data.playlist.tracks ? data.playlist.tracks : data && data.data && data.data.songs ? data.data.songs : [];
        if (!Array.isArray(songs) || !songs.length) throw new Error('未读取到歌单歌曲');
        var out = [];
        var seenSid = {};
        for (var i = 0; i < songs.length; i++) {
            var row = songs[i];
            if (!row) continue;
            var sid = String(row.id || '');
            if (!/^\d{4,}$/.test(sid) || seenSid[sid]) continue;
            seenSid[sid] = true;
            var artist = Array.isArray(row.ar) ? row.ar.map(function (x) { return x && x.name ? x.name : ''; }).filter(Boolean).join(' / ') : '';
            var name = String(row.name || '').trim() || '网易云 ' + sid;
            out.push({
                id: uuid(),
                title: name,
                artist: artist,
                url: '',
                lrc: '',
                neteaseSongId: sid,
                coverUrl: extractSongCoverUrl(row),
                addedAt: Date.now()
            });
        }
        if (!out.length) throw new Error('歌单歌曲解析失败');
        await fillMissingNeteaseCovers(out);
        return out;
    }

    function extractTopPlaylistsFromJson(data, limit) {
        var list =
            data && Array.isArray(data.playlists) ? data.playlists :
            data && data.data && Array.isArray(data.data.playlists) ? data.data.playlists :
            data && data.result && Array.isArray(data.result.playlists) ? data.result.playlists : [];
        return list.slice(0, limit || 6).map(function (pl) {
            if (!pl || typeof pl !== 'object') return null;
                return {
                    id: String(pl.id || '').trim(),
                    name: String(pl.name || '').trim() || '歌单',
                    cover: normalizeCoverUrl(pl.coverImgUrl || pl.picUrl || ''),
                    trackCount: Number(pl.trackCount) || 0,
                    playCount: Number(pl.playCount) || 0
                };
        }).filter(function (x) { return x && /^\d{5,}$/.test(x.id); });
    }

    function extractToplistsFromJson(data) {
        var list = data && Array.isArray(data.list) ? data.list : data && data.data && Array.isArray(data.data.list) ? data.data.list : [];
        return list.map(function (pl) {
            if (!pl || typeof pl !== 'object') return null;
            return {
                id: String(pl.id || '').trim(),
                name: String(pl.name || '').trim() || '排行榜',
                cover: normalizeCoverUrl(pl.coverImgUrl || pl.coverImg || ''),
                updateFrequency: String(pl.updateFrequency || '').trim(),
                trackCount: Number(pl.trackCount) || 0
            };
        }).filter(function (x) { return x && /^\d{5,}$/.test(x.id); });
    }

    async function fetchNeteaseToplistSongs(toplistId) {
        var tid = String(toplistId || '').trim();
        if (!/^\d{5,}$/.test(tid)) throw new Error('排行榜ID无效');
        var data = await fetchJsonWithCorsFallback(neteaseApiUrl('/toplist/detail', { id: tid }), 12000);
        var songs = data && data.playlist && data.playlist.tracks ? data.playlist.tracks : data && data.data && data.data.playlist && data.data.playlist.tracks ? data.data.playlist.tracks : [];
        if (!Array.isArray(songs) || !songs.length) throw new Error('排行榜暂无歌曲');
        var out = [];
        var seen = {};
        songs.forEach(function (row) {
            var item = extractNeteaseSongRow(row);
            if (!item || seen[item.id]) return;
            seen[item.id] = true;
            out.push(item);
        });
        return out;
    }

    async function fetchNeteaseRecommendSongs() {
        try {
            var data = await fetchJsonWithCorsFallback(neteaseApiUrl('/recommend/songs'), 10000);
            var songs = data && data.data && data.data.dailySongs ? data.data.dailySongs : data && data.recommend ? data.recommend : data && data.data && data.data.recommend ? data.data.recommend : [];
            if (!Array.isArray(songs)) songs = [];
            var out = [];
            var seen = {};
            songs.forEach(function (row) {
                var item = extractNeteaseSongRow(row);
                if (!item || seen[item.id]) return;
                seen[item.id] = true;
                out.push(item);
            });
            if (out.length) return out;
        } catch (e) {}
        var searchFallback = await searchNeteaseKeywords('每日推荐');
        return searchFallback.slice(0, 20);
    }

    async function fetchNeteaseDiscoverHome() {
        var personalized = null;
        var newsong = null;
        var toplists = [];
        var squarePl = [];
        var cnPl = [];
        var lovePl = [];
        try {
            personalized = await fetchJsonWithCorsFallback(neteaseApiUrl('/personalized', { limit: 6 }), 10000);
        } catch (e1) {}
        try {
            newsong = await fetchJsonWithCorsFallback(neteaseApiUrl('/personalized/newsong', { limit: 10 }), 10000);
        } catch (e2) {}
        try {
            var topData = await fetchJsonWithCorsFallback(neteaseApiUrl('/toplist'), 10000);
            toplists = extractToplistsFromJson(topData);
        } catch (e3) {}
        try {
            squarePl = extractTopPlaylistsFromJson(await fetchJsonWithCorsFallback(neteaseApiUrl('/top/playlist', { cat: '全部', limit: 1 }), 8000), 1);
        } catch (e4) {}
        try {
            cnPl = extractTopPlaylistsFromJson(await fetchJsonWithCorsFallback(neteaseApiUrl('/top/playlist', { cat: '华语', limit: 1 }), 8000), 1);
        } catch (e5) {}
        try {
            lovePl = extractTopPlaylistsFromJson(await fetchJsonWithCorsFallback(neteaseApiUrl('/top/playlist', { cat: '情歌', limit: 1 }), 8000), 1);
        } catch (e6) {}

        var quickCards = [];
        var pList = personalized && Array.isArray(personalized.result) ? personalized.result : [];
        pList.slice(0, 3).forEach(function (pl, i) {
            if (!pl || !pl.id) return;
            quickCards.push({
                kind: 'playlist',
                id: String(pl.id),
                title: String(pl.name || '推荐歌单').trim(),
                sub: String(pl.copywriter || pl.description || (pl.trackCount ? pl.trackCount + ' 首' : '为你推荐')).trim(),
                cover: normalizeCoverUrl(pl.picUrl || '')
            });
        });

        if (!quickCards.length) {
            var newsongList = newsong && Array.isArray(newsong.result) ? newsong.result : [];
            newsongList.slice(0, 3).forEach(function (item) {
                var song = item && item.song ? item.song : item;
                var row = extractNeteaseSongRow(song);
                if (!row) return;
                quickCards.push({
                    kind: 'song',
                    id: row.id,
                    title: row.title,
                    sub: row.artist || '新歌速递',
                    cover: row.coverUrl
                });
            });
        }

        var hotTop = toplists.find(function (t) { return /热歌|飙升/.test(t.name); }) || toplists[0] || null;
        var browseCards = [
            {
                key: 'roam',
                kind: 'roam',
                title: '漫游',
                sub: '每日推荐 · 无限畅听',
                cover: hotTop && hotTop.cover ? hotTop.cover : (quickCards[0] && quickCards[0].cover) || ''
            },
            {
                key: 'square',
                kind: 'playlist',
                id: squarePl[0] ? squarePl[0].id : '',
                title: squarePl[0] ? squarePl[0].name : '歌单广场',
                sub: squarePl[0] ? (squarePl[0].trackCount + ' 首 · 精选歌单') : '发现更多好歌单',
                cover: squarePl[0] ? squarePl[0].cover : ''
            },
            {
                key: 'cn',
                kind: 'playlist',
                id: cnPl[0] ? cnPl[0].id : '',
                title: cnPl[0] ? cnPl[0].name : '华语',
                sub: cnPl[0] ? '华语流行 · ' + cnPl[0].trackCount + ' 首' : '华语流行 音乐坐标',
                cover: cnPl[0] ? cnPl[0].cover : ''
            },
            {
                key: 'love',
                kind: 'playlist',
                id: lovePl[0] ? lovePl[0].id : '',
                title: lovePl[0] ? lovePl[0].name : '情歌',
                sub: lovePl[0] ? '心动精选 · ' + lovePl[0].trackCount + ' 首' : '心动或心碎 这里总有你的歌',
                cover: lovePl[0] ? lovePl[0].cover : ''
            },
            {
                key: 'hot',
                kind: 'toplist',
                id: hotTop ? hotTop.id : '3778678',
                title: hotTop ? hotTop.name : '热歌榜',
                sub: hotTop && hotTop.updateFrequency ? hotTop.updateFrequency : '云音乐官方排行榜',
                cover: hotTop ? hotTop.cover : ''
            },
            {
                key: 'rank',
                kind: 'toplists',
                title: '排行榜',
                sub: toplists.length ? toplists.length + ' 个官方榜' : '云音乐官方排行榜',
                cover: toplists[1] ? toplists[1].cover : (toplists[0] && toplists[0].cover) || ''
            }
        ];

        return { quickCards: quickCards, browseCards: browseCards, toplists: toplists };
    }

    async function fetchNeteaseDiscoverTracks(kind, id) {
        var k = String(kind || '').trim();
        if (k === 'roam') return fetchNeteaseRecommendSongs();
        if (k === 'toplist') return fetchNeteaseToplistSongs(id);
        if (k === 'playlist') {
            var tracks = await resolveNeteasePlaylistTracks(id);
            return tracks.map(function (t) {
                return {
                    id: String(t.neteaseSongId || ''),
                    title: t.title,
                    artist: t.artist,
                    coverUrl: t.coverUrl || ''
                };
            }).filter(function (x) { return x.id; });
        }
        throw new Error('未知内容类型');
    }

    async function importPlaylistFromInput(rawInput) {
        var raw = String(rawInput || '').trim();
        if (!raw) throw new Error('请输入歌单链接/ID/接口URL');
        var pid = await resolveNeteasePlaylistIdFromInput(raw);
        if (pid) return resolveNeteasePlaylistTracks(pid);
        var url = firstUrlFromText(raw) || raw;
        if (/^https?:\/\//i.test(url)) return resolveGenericPlaylistFromApiUrl(url);
        throw new Error('无法识别歌单输入');
    }

    function looksLikePlaylistInput(raw) {
        var s = String(raw || '').trim();
        if (!s) return false;
        return /playlist|歌单|#\/playlist|\/playlist\//i.test(s) || /(?:playlist|list)\s*id[=:：\s]+/i.test(s);
    }

    async function importFromExternalInput(rawInput) {
        var raw = String(rawInput || '').trim();
        if (!raw) throw new Error('请输入网易云歌曲/歌单 ID 或链接');
        if (looksLikePlaylistInput(raw)) {
            var pl0 = await importPlaylistFromInput(raw);
            if (!pl0 || !pl0.length) throw new Error('歌单为空或无法解析');
            return { type: 'playlist', tracks: pl0 };
        }
        if (/\/song\/|orpheus:\/\/song/i.test(raw) && !looksLikePlaylistInput(raw)) {
            var single0 = await resolveSingleTrackFromInput(raw, '');
            return { type: 'song', tracks: [single0] };
        }
        /* 纯数字 ID：先按歌单解析（与 page-music 歌单输入一致），再回退单曲 */
        if (/^\d{5,}$/.test(raw)) {
            try {
                var plNum = await importPlaylistFromInput(raw);
                if (plNum && plNum.length) return { type: 'playlist', tracks: plNum };
            } catch (ePl) {}
            var singleNum = await resolveSingleTrackFromInput(raw, '');
            return { type: 'song', tracks: [singleNum] };
        }
        try {
            var one = await resolveSingleTrackFromInput(raw, '');
            return { type: 'song', tracks: [one] };
        } catch (songErr) {
            var plTracks = await importPlaylistFromInput(raw);
            if (!plTracks || !plTracks.length) throw songErr;
            return { type: 'playlist', tracks: plTracks };
        }
    }

    function libraryItemKey(item) {
        if (!item) return '';
        var localKey = String(item.localAudioKey || '').trim();
        if (localKey) return 'local:' + localKey;
        var u = String(item.url || '').trim();
        if (u) return 'url:' + u;
        var sid = String(item.neteaseSongId || '').trim();
        if (/^\d{4,}$/.test(sid)) return 'netease:' + sid;
        var id = String(item.id || '').trim();
        if (id) return 'id:' + id;
        return '';
    }

    function trackNeedsLyricsHydration(track) {
        if (!track) return false;
        var cached = String(track.lrc || '').trim();
        return !(cached && parseLrcText(cached).length);
    }

    function mergeIncomingLibraryFields(existing, incoming) {
        if (!existing || !incoming) return existing;
        var inLrc = String(incoming.lrc || '').trim();
        if (inLrc && trackNeedsLyricsHydration(existing)) existing.lrc = inLrc;
        if (!String(existing.neteaseSongId || '').trim() && incoming.neteaseSongId) {
            existing.neteaseSongId = String(incoming.neteaseSongId).trim();
        }
        if (!String(existing.url || '').trim() && incoming.url) existing.url = String(incoming.url).trim();
        if (!String(existing.localAudioKey || '').trim() && incoming.localAudioKey) {
            existing.localAudioKey = String(incoming.localAudioKey).trim();
        }
        if (
            !(typeof existing.durationSec === 'number' && existing.durationSec > 0) &&
            typeof incoming.durationSec === 'number' &&
            incoming.durationSec > 0
        ) {
            existing.durationSec = Math.round(incoming.durationSec);
        }
        if (!String(existing.artist || '').trim() && incoming.artist) existing.artist = String(incoming.artist).trim();
        var inTitle = String(incoming.title || '').trim();
        if (inTitle && (!String(existing.title || '').trim() || existing.title === '未命名歌曲')) {
            existing.title = inTitle;
        }
        if (!String(existing.coverUrl || '').trim() && incoming.coverUrl) {
            existing.coverUrl = String(incoming.coverUrl).trim();
        }
        return existing;
    }

    function findLibraryTrackByRef(track) {
        if (!track) return null;
        if (track.id) {
            var byId = musicData.library.find(function (x) { return x && x.id === track.id; });
            if (byId) return byId;
        }
        var k = libraryItemKey(track);
        if (!k) return null;
        return musicData.library.find(function (x) { return libraryItemKey(x) === k; }) || null;
    }

    function resolveTrackForPlayback(track) {
        if (!track) return null;
        var lib = findLibraryTrackByRef(track) || track;
        var sid =
            String(lib.neteaseSongId || track.neteaseSongId || '').trim() ||
            extractNeteaseSongId(lib.url || track.url || '');
        return {
            id: lib.id || track.id || uuid(),
            title: lib.title || track.title || '未命名歌曲',
            artist: lib.artist || track.artist || parseArtistTitle(lib.title || track.title || '').artist,
            url: lib.url || track.url || '',
            localAudioKey: String(lib.localAudioKey || track.localAudioKey || '').trim(),
            durationSec:
                typeof lib.durationSec === 'number' && lib.durationSec > 0
                    ? lib.durationSec
                    : typeof track.durationSec === 'number' && track.durationSec > 0
                      ? track.durationSec
                      : 0,
            lrc: lib.lrc || track.lrc || '',
            neteaseSongId: sid,
            coverUrl: String(lib.coverUrl || track.coverUrl || '').trim(),
            addedAt: lib.addedAt || track.addedAt || Date.now()
        };
    }

    function applyLyricsToNowPlayingIfMatch(track, lrc) {
        if (!lrc || !track || !musicData.nowPlaying || musicData.nowPlaying.id !== track.id) return;
        musicData.nowPlaying.lrc = lrc;
        parsedLrc = parseLrcText(lrc);
        lyricsActiveIndex = -1;
        emitState();
    }

    function drainLyricsPrefetchQueue() {
        if (document.hidden) return;
        var limit = getPrefetchConcurrency(LYRICS_PREFETCH_CONCURRENCY);
        while (lyricsPrefetchRunning < limit && lyricsPrefetchQueue.length) {
            var tr = lyricsPrefetchQueue.shift();
            if (!tr || !trackNeedsLyricsHydration(tr)) continue;
            var tid = String(tr.id || '');
            if (!tid) continue;
            lyricsPrefetchRunning++;
            (function (trackRef) {
                hydrateLyrics(trackRef)
                    .then(function (lrc) {
                        applyLyricsToNowPlayingIfMatch(trackRef, lrc);
                    })
                    .catch(function () {})
                    .finally(function () {
                        delete lyricsPrefetchPending[tid];
                        lyricsPrefetchRunning--;
                        drainLyricsPrefetchQueue();
                    });
            })(tr);
        }
    }

    function scheduleLyricsPrefetch(tracks) {
        var list = Array.isArray(tracks) ? tracks : [];
        list.forEach(function (t) {
            if (!t) return;
            var lib = findLibraryTrackByRef(t) || t;
            if (!trackNeedsLyricsHydration(lib)) return;
            var tid = String(lib.id || '');
            if (!tid || lyricsPrefetchPending[tid]) return;
            lyricsPrefetchPending[tid] = true;
            lyricsPrefetchQueue.push(lib);
        });
        drainLyricsPrefetchQueue();
    }

    function getPlaylistTracks(plId) {
        var pl = musicData.playlists.find(function (x) { return x && x.id === plId; });
        if (!pl || !Array.isArray(pl.trackIds)) return [];
        return pl.trackIds
            .map(function (tid) { return musicData.library.find(function (t) { return t && t.id === tid; }); })
            .filter(Boolean);
    }

    function prefetchLyricsForPlaylist(plId) {
        scheduleLyricsPrefetch(getPlaylistTracks(plId));
    }

    function prefetchLibraryLyricsMissing(limit) {
        var max = Math.max(1, Math.min(500, limit || 200));
        var need = [];
        musicData.library.forEach(function (t) {
            if (need.length >= max) return;
            if (trackNeedsLyricsHydration(t)) need.push(t);
        });
        scheduleLyricsPrefetch(need);
    }

    function trackNeedsCoverHydration(track) {
        if (!track) return false;
        if (String(track.coverUrl || '').trim()) return false;
        var sid = String(track.neteaseSongId || '').trim() || extractNeteaseSongId(track.url || '');
        return /^\d{4,}$/.test(sid);
    }

    function applyCoverToNowPlayingIfMatch(track, coverUrl) {
        if (!coverUrl || !track || !musicData.nowPlaying || musicData.nowPlaying.id !== track.id) return;
        musicData.nowPlaying.coverUrl = coverUrl;
        emitState();
    }

    async function hydrateCover(track) {
        if (!track || !trackNeedsCoverHydration(track)) return '';
        var sid = String(track.neteaseSongId || '').trim() || extractNeteaseSongId(track.url || '');
        if (!/^\d{4,}$/.test(sid)) return '';
        try {
            var map = await fetchNeteaseCoversBySongIds([sid]);
            var coverUrl = map[sid] || '';
            if (coverUrl) {
                track.coverUrl = coverUrl;
                var libItem = musicData.library.find(function (x) { return x && x.id === track.id; });
                if (libItem) libItem.coverUrl = coverUrl;
                applyCoverToNowPlayingIfMatch(track, coverUrl);
                saveData();
                try {
                    if (typeof global !== 'undefined' && typeof global.dispatchEvent === 'function') {
                        global.dispatchEvent(new CustomEvent('miya-music-cover-update', { detail: { trackId: track.id } }));
                    }
                } catch (eEv) {}
            }
            return coverUrl;
        } catch (e) {
            return '';
        }
    }

    function drainCoverPrefetchQueue() {
        if (document.hidden) return;
        var limit = getPrefetchConcurrency(COVER_PREFETCH_CONCURRENCY);
        while (coverPrefetchRunning < limit && coverPrefetchQueue.length) {
            var tr = coverPrefetchQueue.shift();
            if (!tr || !trackNeedsCoverHydration(tr)) continue;
            var tid = String(tr.id || '');
            if (!tid) continue;
            coverPrefetchRunning++;
            (function (trackRef) {
                hydrateCover(trackRef)
                    .catch(function () {})
                    .finally(function () {
                        delete coverPrefetchPending[tid];
                        coverPrefetchRunning--;
                        drainCoverPrefetchQueue();
                    });
            })(tr);
        }
    }

    function scheduleCoverPrefetch(tracks) {
        var list = Array.isArray(tracks) ? tracks : [];
        list.forEach(function (t) {
            if (!t) return;
            var lib = findLibraryTrackByRef(t) || t;
            if (!trackNeedsCoverHydration(lib)) return;
            var tid = String(lib.id || '');
            if (!tid || coverPrefetchPending[tid]) return;
            coverPrefetchPending[tid] = true;
            coverPrefetchQueue.push(lib);
        });
        drainCoverPrefetchQueue();
    }

    function prefetchCoversForPlaylist(plId) {
        scheduleCoverPrefetch(getPlaylistTracks(plId));
    }

    function prefetchLibraryCoversMissing(limit) {
        var max = Math.max(1, Math.min(500, limit || 200));
        var need = [];
        musicData.library.forEach(function (t) {
            if (need.length >= max) return;
            if (trackNeedsCoverHydration(t)) need.push(t);
        });
        scheduleCoverPrefetch(need);
    }

    function prefetchActiveQueueCovers() {
        scheduleCoverPrefetch(getPlaybackQueue());
    }

    function prefetchActiveQueueLyrics() {
        scheduleLyricsPrefetch(getPlaybackQueue());
    }

    function addToLibrary(tracks) {
        var list = Array.isArray(tracks) ? tracks : [];
        var seen = {};
        var byKey = {};
        var resolved = [];
        musicData.library.forEach(function (item) {
            var k = libraryItemKey(item);
            if (!k) return;
            seen[k] = true;
            byKey[k] = item;
        });
        list.forEach(function (item) {
            if (!item) return;
            var k = libraryItemKey(item);
            if (!k) return;
            if (seen[k]) {
                if (byKey[k]) {
                    mergeIncomingLibraryFields(byKey[k], item);
                    resolved.push(byKey[k]);
                }
                return;
            }
            seen[k] = true;
            var created = {
                id: item.id || uuid(),
                title: item.title || '未命名歌曲',
                artist: item.artist || parseArtistTitle(item.title || '').artist,
                url: String(item.url || '').trim(),
                localAudioKey: String(item.localAudioKey || '').trim(),
                durationSec:
                    typeof item.durationSec === 'number' && item.durationSec > 0
                        ? Math.round(item.durationSec)
                        : 0,
                lrc: item.lrc || '',
                neteaseSongId: String(item.neteaseSongId || '').trim(),
                coverUrl: String(item.coverUrl || '').trim(),
                addedAt: item.addedAt || Date.now()
            };
            byKey[k] = created;
            musicData.library.push(created);
            resolved.push(created);
        });
        saveData();
        emitState();
        scheduleLyricsPrefetch(resolved.filter(trackNeedsLyricsHydration));
        scheduleCoverPrefetch(resolved.filter(trackNeedsCoverHydration));
        return resolved;
    }

    function ensureDefaultPlaylists() {
        if (!Array.isArray(musicData.playlists)) musicData.playlists = [];
    }

    function createPlaylist(name) {
        ensureDefaultPlaylists();
        var pl = {
            id: uuid(),
            name: String(name || '').trim() || '未命名歌单',
            trackIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        musicData.playlists.unshift(pl);
        saveData();
        return pl;
    }

    function addTrackIdToPlaylist(plId, trackId) {
        ensureDefaultPlaylists();
        var pl = musicData.playlists.find(function (x) { return x && x.id === plId; });
        if (!pl) return false;
        var tid = String(trackId || '').trim();
        if (!tid) return false;
        if (!Array.isArray(pl.trackIds)) pl.trackIds = [];
        if (pl.trackIds.indexOf(tid) >= 0) return false;
        pl.trackIds.push(tid);
        pl.updatedAt = Date.now();
        saveData();
        var libTrack = musicData.library.find(function (x) { return x && x.id === tid; });
        if (libTrack) {
            scheduleLyricsPrefetch([libTrack]);
            scheduleCoverPrefetch([libTrack]);
        }
        return true;
    }

    function removeTrackIdFromPlaylist(plId, trackId) {
        ensureDefaultPlaylists();
        var pl = musicData.playlists.find(function (x) { return x && x.id === plId; });
        if (!pl || !Array.isArray(pl.trackIds)) return false;
        var tid = String(trackId || '').trim();
        if (!tid) return false;
        var idx = pl.trackIds.indexOf(tid);
        if (idx < 0) return false;
        pl.trackIds.splice(idx, 1);
        pl.updatedAt = Date.now();
        saveData();
        emitState();
        return true;
    }

    function getLibrarySorted() {
        return musicData.library.slice().sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
    }

    function recordRecentPlay(trackId) {
        var id = String(trackId || '').trim();
        if (!id) return;
        var arr = (musicData.recentPlayIds || []).filter(function (x) { return x !== id; });
        arr.unshift(id);
        musicData.recentPlayIds = arr.slice(0, 20);
        var item = musicData.library.find(function (x) { return x && x.id === id; });
        if (item) item.lastPlayedAt = Date.now();
        saveData();
    }

    function getRecentVaultTracks(limit) {
        var max = Math.max(1, Math.min(20, limit || 20));
        var out = [];
        var seen = {};
        (musicData.recentPlayIds || []).forEach(function (tid) {
            if (out.length >= max) return;
            var t = musicData.library.find(function (x) { return x && x.id === tid; });
            if (t && !seen[t.id]) {
                seen[t.id] = true;
                out.push(t);
            }
        });
        if (out.length < max) {
            musicData.library
                .slice()
                .sort(function (a, b) {
                    return (b.lastPlayedAt || b.addedAt || 0) - (a.lastPlayedAt || a.addedAt || 0);
                })
                .forEach(function (t) {
                    if (out.length >= max || !t || seen[t.id]) return;
                    seen[t.id] = true;
                    out.push(t);
                });
        }
        return out.slice(0, max);
    }

    function getPlaybackQueue() {
        if (musicData.activePlaylistId) {
            var pl = musicData.playlists.find(function (x) { return x && x.id === musicData.activePlaylistId; });
            if (pl && Array.isArray(pl.trackIds) && pl.trackIds.length) {
                return pl.trackIds
                    .map(function (tid) { return musicData.library.find(function (t) { return t && t.id === tid; }); })
                    .filter(Boolean);
            }
        }
        return musicData.library.slice().sort(function (a, b) { return (a.addedAt || 0) - (b.addedAt || 0); });
    }

    function getShuffleQueueKey() {
        var list = getPlaybackQueue();
        return (musicData.activePlaylistId || '__library__') + '|' + list.map(function (t) { return t && t.id; }).join('\u0001');
    }

    function shuffleArray(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    function resetShuffleQueue(keepCurrentId) {
        var list = getPlaybackQueue();
        var ids = list.map(function (t) { return t && t.id; }).filter(Boolean);
        shuffleQueueKey = getShuffleQueueKey();
        if (!ids.length) {
            shuffleOrder = [];
            shufflePos = -1;
            return;
        }
        shuffleOrder = shuffleArray(ids.slice());
        var cur = String(keepCurrentId || (musicData.nowPlaying && musicData.nowPlaying.id) || '').trim();
        shufflePos = cur ? shuffleOrder.indexOf(cur) : -1;
    }

    function ensureShuffleQueue() {
        var key = getShuffleQueueKey();
        if (key !== shuffleQueueKey || !shuffleOrder.length) {
            resetShuffleQueue(musicData.nowPlaying && musicData.nowPlaying.id);
        }
    }

    function syncShufflePosition(trackId) {
        if (musicData.playMode !== 'random') return;
        var id = String(trackId || '').trim();
        if (!id) return;
        ensureShuffleQueue();
        var at = shuffleOrder.indexOf(id);
        if (at >= 0) shufflePos = at;
    }

    function invalidateShuffleQueue() {
        shuffleOrder = [];
        shufflePos = -1;
        shuffleQueueKey = '';
    }

    var SILENT_PRIME_URL = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    var audioPrimed = false;

    function isAutoplayBlockedError(e) {
        var msg = (e && e.message ? e.message : String(e || '')).toLowerCase();
        var name = (e && e.name ? e.name : '').toLowerCase();
        return name === 'notallowederror' ||
            /not allowed by the user agent|user denied permission|play\(\) failed because the user|autoplay/i.test(msg);
    }

    function formatPlaybackError(e) {
        if (isAutoplayBlockedError(e)) {
            return '浏览器阻止自动播放，请再点一次播放按钮';
        }
        return e && e.message ? e.message : '播放失败';
    }

    function primeAudioPlayback() {
        var audio = getAudio();
        if (!audio) return false;
        if (audioPrimed && !audio.paused && audio.src) return true;
        try {
            var prevSrc = String(audio.currentSrc || audio.src || '').trim();
            var prevTime = audio.currentTime || 0;
            var wasPlaying = !audio.paused && !!prevSrc;
            if (wasPlaying) {
                audioPrimed = true;
                return true;
            }
            audio.src = SILENT_PRIME_URL;
            try { audio.load(); } catch (eLoad) {}
            var playPromise = audio.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.then(function () {
                    audioPrimed = true;
                    try { audio.pause(); } catch (ePause) {}
                    try { audio.currentTime = 0; } catch (eTime) {}
                    if (prevSrc && prevSrc !== SILENT_PRIME_URL) {
                        audio.src = prevSrc;
                        try { audio.currentTime = prevTime; } catch (eTime2) {}
                    } else {
                        try {
                            audio.removeAttribute('src');
                            audio.load();
                        } catch (eReset) {}
                    }
                }).catch(function () {
                    if (prevSrc && prevSrc !== SILENT_PRIME_URL) {
                        audio.src = prevSrc;
                        try { audio.currentTime = prevTime; } catch (eTime3) {}
                    }
                });
            } else {
                audioPrimed = true;
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    function getAudio(onTick) {
        if (typeof onTick === 'function') audioUiTick = onTick;
        if (!musicAudio) {
            musicAudio = new Audio();
            musicAudio.preload = 'auto';
            musicAudio.addEventListener('timeupdate', function () {
                invokeAudioUiTick(false);
            });
            musicAudio.addEventListener('play', function () {
                invokeAudioUiTick(true);
                drainLyricsPrefetchQueue();
                drainCoverPrefetchQueue();
            });
            musicAudio.addEventListener('pause', function () {
                persistPlaybackPosition(true);
                invokeAudioUiTick(true);
                drainLyricsPrefetchQueue();
                drainCoverPrefetchQueue();
            });
            musicAudio.addEventListener('loadedmetadata', function () { invokeAudioUiTick(true); });
            musicAudio.addEventListener('playing', function () { playbackErrorRetries = 0; });
            musicAudio.addEventListener('error', function () {
                if (!musicData.nowPlaying || playTrackInFlight) return;
                var audio = musicAudio;
                var nearEnd = audio && isFinite(audio.duration) && audio.duration > 0 &&
                    audio.currentTime >= Math.max(0, audio.duration - 1.5);
                if (!nearEnd && playbackErrorRetries < 2) {
                    playbackErrorRetries += 1;
                    var sid = String(musicData.nowPlaying.neteaseSongId || '').trim() ||
                        extractNeteaseSongId(musicData.nowPlaying.url || '');
                    if (sid) neteaseUrlCache = { sid: '', url: '', at: 0 };
                    playTrack(musicData.nowPlaying, audioUiTick).catch(function () {
                        advanceAfterPlaybackError(audioUiTick);
                    });
                    return;
                }
                playbackErrorRetries = 0;
                advanceAfterPlaybackError(audioUiTick);
            });
            musicAudio.addEventListener('ended', function () {
                if (playTrackInFlight) return;
                if (musicData.playMode === 'single' && musicData.nowPlaying) {
                    setNowPlayingPosition(0);
                    lastSavedPosition = 0;
                    musicAudio.currentTime = 0;
                    musicAudio.play().catch(function () {});
                    return;
                }
                setNowPlayingPosition(0);
                lastSavedPosition = 0;
                playAdjacent(1, true, audioUiTick).catch(function () {});
            });
        }
        return musicAudio;
    }

    function getCurrentLyricLineText(currentTime) {
        if (!parsedLrc.length) return '';
        var idx = -1;
        for (var i = 0; i < parsedLrc.length; i++) {
            if (parsedLrc[i].t <= currentTime) idx = i;
            else break;
        }
        if (idx < 0) idx = 0;
        var row = parsedLrc[idx];
        return row && row.text ? String(row.text) : '';
    }

    function buildSnapshot() {
        var audio = musicAudio;
        var now = musicData.nowPlaying;
        var ct =
            audio && isFinite(audio.currentTime) && audio.src
                ? audio.currentTime
                : getSavedPlaybackPosition();
        var dur =
            audio && isFinite(audio.duration) && audio.duration > 0
                ? audio.duration
                : now && typeof now.durationSec === 'number' && now.durationSec > 0
                  ? now.durationSec
                  : 0;
        return {
            title: now ? now.title || '' : '',
            artist: now ? now.artist || '' : '',
            coverUrl: now ? String(now.coverUrl || '').trim() : '',
            isPlaying: !!(audio && !audio.paused && audio.src),
            playing: !!(audio && !audio.paused && audio.src),
            currentTime: ct,
            duration: dur,
            lyricLine: getCurrentLyricLineText(ct),
            parsedLrc: parsedLrc,
            lyricsActiveIndex: lyricsActiveIndex,
            playMode: musicData.playMode,
            activePlaylistId: musicData.activePlaylistId
        };
    }

    function isBenignPlayError(e) {
        if (isAutoplayBlockedError(e)) return false;
        var msg = (e && e.message ? e.message : String(e || '')).toLowerCase();
        return /play\(\) request was interrupted|interrupted by a call to pause|interrupted by a new load|the operation was aborted|aborterror/i.test(msg);
    }

    async function hydrateLyrics(track) {
        if (!track) return '';
        var cached = String(track.lrc || '').trim();
        if (cached && parseLrcText(cached).length) return cached;
        var sid = String(track.neteaseSongId || '').trim() || extractNeteaseSongId(track.url || '');
        var parts = parseArtistTitle(track.title || '');
        var title = parts.title || track.title || '';
        var artist = parts.artist || track.artist || '';
        var lrc = '';
        if (sid) lrc = await fetchNeteaseLrcBySongId(sid);
        if (!lrc) {
            lrc = await fetchLrclibLrc(title || track.title || '', artist || track.artist || '');
        }
        if (lrc) {
            track.lrc = lrc;
            var libItem = musicData.library.find(function (x) { return x.id === track.id; });
            if (libItem) libItem.lrc = lrc;
            applyLyricsToNowPlayingIfMatch(track, lrc);
            saveData();
        }
        return lrc;
    }

    function isPlayTrackStale(gen) {
        return gen !== playTrackGeneration;
    }

    function interruptCurrentPlayback() {
        var audio = musicAudio;
        if (!audio) return;
        try { audio.pause(); } catch (e) {}
        try {
            audio.removeAttribute('src');
            audio.load();
        } catch (e2) {}
    }

    function commitNowPlayingEarly(playing, startAt) {
        playing.positionSec = startAt > 0 ? startAt : 0;
        var prevId = musicData.nowPlaying && musicData.nowPlaying.id;
        musicData.nowPlaying = playing;
        lastSavedPosition = playing.positionSec;
        recordRecentPlay(playing.id);
        parsedLrc = parseLrcText(playing.lrc || '');
        lyricsActiveIndex = -1;
        if (!prevId || prevId !== playing.id) {
            interruptCurrentPlayback();
        }
        emitState();
    }

    function buildQuickPlayCandidates(playing, sid) {
        var out = [];
        var seen = {};
        function add(u) {
            u = normalizeAudioUrl(u);
            if (!u || seen[u]) return;
            seen[u] = true;
            out.push(u);
        }
        if (sid) {
            var now = Date.now();
            if (neteaseUrlCache.sid === sid && neteaseUrlCache.url && now - neteaseUrlCache.at < 30000) {
                add(neteaseUrlCache.url);
            }
        } else if (String(playing.localAudioKey || '').trim()) {
            add(playing.url);
        } else {
            add(playing.url);
        }
        return out;
    }

    function mergePlayCandidates(quick, fetched) {
        var out = [];
        var seen = {};
        function add(u) {
            u = normalizeAudioUrl(u);
            if (!u || seen[u]) return;
            seen[u] = true;
            out.push(u);
        }
        (fetched || []).forEach(function (u) { add(u); });
        (quick || []).forEach(function (u) { add(u); });
        return out;
    }

    async function tryPlayCandidateList(audio, candidates, sid, startAt, gen) {
        var played = false;
        var lastErr = null;
        var playedUrl = '';
        for (var i = 0; i < candidates.length; i++) {
            if (isPlayTrackStale(gen)) return { played: false, stale: true, lastErr: null, playedUrl: '' };
            try {
                playedUrl = await tryPlayAudioUrl(audio, candidates[i], 14000, startAt);
                played = true;
                if (sid) {
                    neteaseUrlCache = { sid: sid, url: playedUrl, at: Date.now() };
                }
                break;
            } catch (e2) {
                lastErr = e2;
                if (isBenignPlayError(e2) && audio && !audio.paused && audio.src) {
                    playedUrl = candidates[i];
                    played = true;
                    break;
                }
            }
        }
        return { played: played, stale: false, lastErr: lastErr, playedUrl: playedUrl };
    }

    async function playTrack(track, onTick, options) {
        if (!track) return;
        var myGen = ++playTrackGeneration;
        playTrackInFlight = true;
        try {
        var opts = options && typeof options === 'object' ? options : {};
        var startAt = 0;
        if (typeof opts.startAt === 'number' && isFinite(opts.startAt) && opts.startAt > 0) {
            startAt = opts.startAt;
        } else if (opts.resume) {
            startAt = getSavedPlaybackPosition();
        }
        var audio = getAudio(onTick);
        var playing = resolveTrackForPlayback(track);
        if (!playing) return;
        var libTarget = findLibraryTrackByRef(playing) || playing;
        var rawUrl0 = String(playing.url || '').trim();
        var sid = /^data:/i.test(rawUrl0) || /^blob:/i.test(rawUrl0) ? '' : String(playing.neteaseSongId || '').trim() || extractNeteaseSongId(playing.url);
        var hydratePromise = trackNeedsLyricsHydration(libTarget) ? hydrateLyrics(libTarget) : Promise.resolve(playing.lrc || '');
        var coverPromise = trackNeedsCoverHydration(libTarget) ? hydrateCover(libTarget) : Promise.resolve(playing.coverUrl || '');

        commitNowPlayingEarly(playing, startAt);
        if (typeof onTick === 'function') onTick();
        if (isPlayTrackStale(myGen)) return;

        var candidates = buildQuickPlayCandidates(playing, sid);
        var apiFetch = sid
            ? resolveNeteasePlayUrlCandidates(sid).catch(function () { return []; })
            : Promise.resolve([]);

        if (String(playing.localAudioKey || '').trim()) {
            var localUrl = await resolveLocalAudioPlayUrl(playing);
            if (isPlayTrackStale(myGen)) return;
            if (localUrl) candidates.push(localUrl);
            var directLocal = normalizeAudioUrl(playing.url);
            if (directLocal && directLocal !== localUrl) candidates.push(directLocal);
        }

        if (sid && !candidates.length) {
            var apiListFirst = await apiFetch;
            if (isPlayTrackStale(myGen)) return;
            candidates = mergePlayCandidates([], apiListFirst);
            if (!candidates.length) {
                var outerFallback = neteaseOuterPlayUrl(sid);
                if (outerFallback) candidates.push(outerFallback);
            }
        }

        if (!candidates.length) throw new Error('没有拿到可播放链接');
        playing.url = candidates[0];

        var playResult = await tryPlayCandidateList(audio, candidates, sid, startAt, myGen);
        if (playResult.stale) return;

        var played = playResult.played;
        var lastErr = playResult.lastErr;
        if (playResult.playedUrl) playing.url = playResult.playedUrl;

        if (!played && sid) {
            var apiList = await apiFetch;
            if (isPlayTrackStale(myGen)) return;
            candidates = mergePlayCandidates(candidates, apiList);
            if (!candidates.length) {
                var outerOnly = neteaseOuterPlayUrl(sid);
                if (outerOnly) candidates.push(outerOnly);
            }
            playResult = await tryPlayCandidateList(audio, candidates, sid, startAt, myGen);
            if (playResult.stale) return;
            played = playResult.played;
            lastErr = playResult.lastErr;
            if (playResult.playedUrl) playing.url = playResult.playedUrl;
        }

        if (!played && audio && !audio.paused && audio.src) played = true;
        if (!played) {
            if (sid) {
                neteaseUrlCache = { sid: '', url: '', at: 0 };
                if (isNeteaseLoggedIn()) {
                    neteaseLoginStatus().catch(function () {});
                }
            }
            throw lastErr || new Error('播放失败，请确认已登录网易云会员账号');
        }
        if (isPlayTrackStale(myGen)) return;
        var libHit = musicData.library.find(function (x) { return x && x.id === playing.id; });
        if (libHit && !String(libHit.url || '').trim() && playing.url) {
            libHit.url = playing.url;
            saveData();
        }
        hydratePromise
            .then(function (lrc) {
                applyLyricsToNowPlayingIfMatch(playing, lrc);
                if (typeof onTick === 'function') onTick();
            })
            .catch(function () {});
        coverPromise
            .then(function (coverUrl) {
                if (coverUrl) applyCoverToNowPlayingIfMatch(playing, coverUrl);
                if (typeof onTick === 'function') onTick();
            })
            .catch(function () {});
        scheduleLyricsPrefetch(getPlaybackQueue());
        scheduleCoverPrefetch(getPlaybackQueue());
        syncShufflePosition(playing.id);
        if (startAt > 0) updateLyricsActive(startAt);
        saveData();
        if (typeof onTick === 'function') onTick();
        } finally {
            if (myGen === playTrackGeneration) playTrackInFlight = false;
        }
    }

    function resolveAdjacentTrackIndex(list, direction, currentId) {
        if (!list.length) return -1;
        if (musicData.playMode === 'random') {
            ensureShuffleQueue();
            if (!shuffleOrder.length) return 0;
            if (direction > 0) {
                shufflePos += 1;
                if (shufflePos >= shuffleOrder.length) {
                    var lastId = shuffleOrder[shuffleOrder.length - 1] || '';
                    resetShuffleQueue();
                    if (shuffleOrder.length > 1 && shuffleOrder[0] === lastId) {
                        var swap = 1 + Math.floor(Math.random() * (shuffleOrder.length - 1));
                        var tmp = shuffleOrder[0];
                        shuffleOrder[0] = shuffleOrder[swap];
                        shuffleOrder[swap] = tmp;
                    }
                    shufflePos = 0;
                }
            } else {
                shufflePos -= 1;
                if (shufflePos < 0) shufflePos = shuffleOrder.length - 1;
            }
            var targetId = shuffleOrder[shufflePos];
            var hit = list.findIndex(function (x) { return x && x.id === targetId; });
            if (hit >= 0) return hit;
            resetShuffleQueue(currentId);
            shufflePos = 0;
            return list.findIndex(function (x) { return x && x.id === shuffleOrder[0]; });
        }
        var idx = currentId ? list.findIndex(function (x) { return x.id === currentId; }) : -1;
        if (idx < 0) idx = 0;
        return (idx + direction + list.length) % list.length;
    }

    async function playAdjacentOnce(direction, onTick) {
        var list = getPlaybackQueue();
        if (!list.length) return;
        var currentId = musicData.nowPlaying && musicData.nowPlaying.id;
        var idx = resolveAdjacentTrackIndex(list, direction, currentId);
        if (idx < 0) return;
        var tried = {};
        var maxTries = Math.min(list.length, 6);
        for (var attempt = 0; attempt < maxTries; attempt++) {
            if (attempt > 0) {
                if (musicData.playMode === 'random') {
                    idx = resolveAdjacentTrackIndex(list, direction, currentId);
                } else {
                    idx = (idx + (direction >= 0 ? 1 : -1) + list.length) % list.length;
                }
            }
            var track = list[idx];
            if (!track || tried[track.id]) continue;
            tried[track.id] = true;
            currentId = track.id;
            try {
                await playTrack(track, onTick);
                return;
            } catch (e) {
                var sid = String(track.neteaseSongId || '').trim() || extractNeteaseSongId(track.url || '');
                if (sid) neteaseUrlCache = { sid: '', url: '', at: 0 };
            }
        }
        setStatus('连续播放失败，请检查网络或换一首', 'warn');
    }

    function advanceAfterPlaybackError(onTick) {
        return playAdjacent(1, true, onTick);
    }

    function playAdjacent(direction, byEnded, onTick) {
        var dir = direction >= 0 ? 1 : -1;
        if (!byEnded) {
            playTrackGeneration += 1;
            advancePlaybackChain = Promise.resolve();
        }
        var run = function () {
            return playAdjacentOnce(dir, onTick);
        };
        advancePlaybackChain = advancePlaybackChain.then(run, run);
        return advancePlaybackChain;
    }

    function setPlayMode(mode) {
        musicData.playMode = mode === 'random' || mode === 'single' ? mode : 'order';
        if (musicData.playMode === 'random') {
            resetShuffleQueue(musicData.nowPlaying && musicData.nowPlaying.id);
        } else {
            invalidateShuffleQueue();
        }
        saveData();
        emitState();
        return musicData.playMode;
    }

    function cyclePlayMode() {
        var now = musicData.playMode || 'order';
        return setPlayMode(now === 'order' ? 'single' : now === 'single' ? 'random' : 'order');
    }

    function getPlayModeIcon(mode) {
        if (mode === 'single') return '🔂';
        if (mode === 'random') return '🔀';
        return '↻';
    }

    function getPlayModeSvg(mode) {
        if (mode === 'single') {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/><path d="M12 10v4" stroke-width="2"/><path d="M10 12h4" stroke-width="2"/></svg>';
        }
        if (mode === 'random') {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>';
        }
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>';
    }

    function getPlayModeLabel(mode) {
        if (mode === 'single') return '单曲循环';
        if (mode === 'random') return '随机播放';
        return '顺序播放';
    }

    async function importLocalAudioFile(file, meta) {
        if (!file) return [];
        if (!isLocalAudioFile(file)) {
            setStatus('请选择 mp3、m4a、wav 等音频', 'warn');
            return [];
        }
        if (file.size > 25 * 1024 * 1024) {
            setStatus('文件超过 25MB 上限', 'warn');
            return [];
        }
        meta = meta && typeof meta === 'object' ? meta : {};
        var parsed = parseArtistTitle(
            String(meta.title || '').trim() ||
                String(file.name || '').replace(/\.(mp3|m4a|flac|aac|ogg|wav|opus|webm|mp4)$/i, '').trim()
        );
        var title = parsed.title || '本地音频';
        var artist = String(meta.artist || '').trim() || parsed.artist || '本地上传';
        var durationSec = Number(meta.durationSec) || 0;
        if (!durationSec) durationSec = await probeAudioDurationSec(file);
        var trackId = uuid();
        var audioKey = 'local-' + trackId;
        var url = '';
        try {
            await idbPutLocalAudio(audioKey, file);
        } catch (idbErr) {
            if (file.size > 8 * 1024 * 1024) throw idbErr;
            url = await new Promise(function (resolve, reject) {
                var reader = new FileReader();
                reader.onload = function () { resolve(String(reader.result || '')); };
                reader.onerror = function () { reject(new Error('read-failed')); };
                reader.readAsDataURL(file);
            });
            audioKey = '';
        }
        var tracks = await addToLibrary([
            {
                id: trackId,
                title: title,
                artist: artist,
                url: url,
                localAudioKey: audioKey,
                durationSec: durationSec,
                lrc: '',
                neteaseSongId: '',
                addedAt: Date.now()
            }
        ]);
        var plId = String(meta.playlistId || '').trim();
        var added = tracks.length ? tracks[0] : null;
        if (plId && added && added.id) {
            var joined = addTrackIdToPlaylist(plId, added.id);
            if (!joined) {
                setStatus('这首歌已在该歌单里', 'warn');
            }
        }
        return tracks;
    }

    function updateLyricsActive(currentTime) {
        if (!parsedLrc.length) {
            lyricsActiveIndex = -1;
            return -1;
        }
        var idx = -1;
        for (var i = 0; i < parsedLrc.length; i++) {
            if (parsedLrc[i].t <= currentTime) idx = i;
            else break;
        }
        lyricsActiveIndex = idx;
        return idx;
    }

    function pausePlayback() {
        var audio = musicAudio;
        if (audio && !audio.paused) {
            try { audio.pause(); } catch (e) {}
            persistPlaybackPosition(true);
        }
    }

    async function resumeOrTogglePlayback(onTick) {
        var audio = getAudio(onTick);
        if (audio && audio.src) {
            if (audio.paused) {
                try { await audio.play(); } catch (ePlay) {}
            } else {
                pausePlayback();
            }
            if (typeof onTick === 'function') onTick();
            return;
        }
        var now = musicData.nowPlaying;
        if (now) {
            var track = resolveTrackForPlayback(now);
            if (track) {
                await playTrack(track, onTick, { resume: true });
                return;
            }
        }
        var list = getPlaybackQueue();
        if (list.length) await playTrack(list[0], onTick);
    }

    async function resolveTrackPlayUrl(track) {
        var playing = resolveTrackForPlayback(track);
        if (!playing) throw new Error('no-track');
        if (String(playing.localAudioKey || '').trim()) {
            var localUrl = await resolveLocalAudioPlayUrl(playing);
            if (localUrl) return localUrl;
        }
        var rawUrl0 = String(playing.url || '').trim();
        var sid =
            /^data:/i.test(rawUrl0) || /^blob:/i.test(rawUrl0)
                ? ''
                : String(playing.neteaseSongId || '').trim() || extractNeteaseSongId(playing.url);
        if (sid) {
            var outer = neteaseOuterPlayUrl(sid);
            try {
                var freshList = await resolveNeteasePlayUrlCandidates(sid);
                return freshList.length ? freshList[0] : outer;
            } catch (e) {
                return outer;
            }
        }
        var direct = normalizeAudioUrl(playing.url);
        if (!direct) throw new Error('no-play-url');
        return direct;
    }

    function invalidateMusicCache() {
        musicData = normalizeData({});
        dataReady = null;
        dataHydrated = false;
        pendingIdbHydrate = false;
        neteaseSession = null;
        neteaseSessionReady = null;
        emitState();
    }

    global.miyaMusicEngine = {
        LS_KEY: LS_KEY,
        NETEASE_SESSION_KEY: NETEASE_SESSION_KEY,
        invalidateCache: invalidateMusicCache,
        PRESET_SONGS: [
            { key: 'eu-pop', title: '欧美流行精选', keyword: '欧美流行' },
            { key: 'cn-classic', title: '华语经典老歌', keyword: '华语经典' },
            { key: 'focus', title: '轻音乐专注', keyword: '轻音乐' }
        ],
        PRESET_PLAYLISTS: [
            { id: '3778678', title: '深夜emo必备' },
            { id: '19723756', title: '2024热歌' },
            { id: '5059642708', title: '摇滚精选' },
            { id: '4953800322', title: '电子氛围' }
        ],
        getData: function () { return musicData; },
        getParsedLrc: function () { return parsedLrc; },
        getLyricsActiveIndex: function () { return lyricsActiveIndex; },
        setParsedLrc: function (lrc) {
            parsedLrc = parseLrcText(lrc || '');
            lyricsActiveIndex = -1;
        },
        loadDataWithTimeout: loadDataWithTimeout,
        saveData: saveData,
        ensureDataReady: function (ms) {
            return loadDataWithTimeout(ms || 8000).catch(function () { return musicData; });
        },
        flushSave: function () { return saveData(); },
        searchNeteaseKeywords: searchNeteaseKeywords,
        neteaseSearchRowToTrack: neteaseSearchRowToTrack,
        neteaseSearchRowCustomTitle: neteaseSearchRowCustomTitle,
        resolveNeteaseSingleSong: resolveNeteaseSingleSong,
        resolveSingleTrackFromInput: resolveSingleTrackFromInput,
        importPlaylistFromInput: importPlaylistFromInput,
        importFromExternalInput: importFromExternalInput,
        resolveNeteasePlaylistTracks: resolveNeteasePlaylistTracks,
        fetchNeteaseDiscoverHome: fetchNeteaseDiscoverHome,
        fetchNeteaseDiscoverTracks: fetchNeteaseDiscoverTracks,
        fetchNeteaseToplistSongs: fetchNeteaseToplistSongs,
        fetchNeteaseRecommendSongs: fetchNeteaseRecommendSongs,
        NETEASE_API: NETEASE_API,
        isNeteaseLoggedIn: isNeteaseLoggedIn,
        getNeteaseSession: getNeteaseSession,
        neteaseLoginStatus: neteaseLoginStatus,
        neteaseQrLoginStart: neteaseQrLoginStart,
        neteaseQrLoginPoll: neteaseQrLoginPoll,
        neteaseLogout: neteaseLogout,
        fetchUserNeteasePlaylists: fetchUserNeteasePlaylists,
        addToLibrary: addToLibrary,
        createPlaylist: createPlaylist,
        addTrackIdToPlaylist: addTrackIdToPlaylist,
        removeTrackIdFromPlaylist: removeTrackIdFromPlaylist,
        ensureDefaultPlaylists: ensureDefaultPlaylists,
        getLibrarySorted: getLibrarySorted,
        getRecentVaultTracks: getRecentVaultTracks,
        getPlaybackQueue: getPlaybackQueue,
        playTrack: playTrack,
        playAdjacent: playAdjacent,
        setPlayMode: setPlayMode,
        cyclePlayMode: cyclePlayMode,
        getAudio: getAudio,
        primeAudioPlayback: primeAudioPlayback,
        isAutoplayBlockedError: isAutoplayBlockedError,
        formatPlaybackError: formatPlaybackError,
        importLocalAudioFile: importLocalAudioFile,
        isLocalAudioFile: isLocalAudioFile,
        probeAudioDurationSec: probeAudioDurationSec,
        hydrateLyrics: hydrateLyrics,
        updateLyricsActive: updateLyricsActive,
        pausePlayback: pausePlayback,
        resumeOrTogglePlayback: resumeOrTogglePlayback,
        persistPlaybackPosition: persistPlaybackPosition,
        resolveTrackPlayUrl: resolveTrackPlayUrl,
        buildSnapshot: buildSnapshot,
        formatTime: formatTime,
        parseArtistTitle: parseArtistTitle,
        getPlayModeIcon: getPlayModeIcon,
        getPlayModeSvg: getPlayModeSvg,
        getPlayModeLabel: getPlayModeLabel,
        setStatusCallback: function (fn) { onStatus = fn; },
        setStateCallback: function (fn) { onStateChange = fn; },
        setActivePlaylistId: function (id) {
            musicData.activePlaylistId = String(id || '');
            if (musicData.playMode === 'random') {
                resetShuffleQueue(musicData.nowPlaying && musicData.nowPlaying.id);
            } else {
                invalidateShuffleQueue();
            }
            saveData();
            emitState();
            if (id) {
                prefetchLyricsForPlaylist(id);
                prefetchCoversForPlaylist(id);
            } else {
                prefetchLibraryLyricsMissing(80);
                prefetchLibraryCoversMissing(80);
            }
        },
        prefetchLyricsForPlaylist: prefetchLyricsForPlaylist,
        prefetchLibraryLyricsMissing: prefetchLibraryLyricsMissing,
        prefetchCoversForPlaylist: prefetchCoversForPlaylist,
        prefetchLibraryCoversMissing: prefetchLibraryCoversMissing,
        prefetchLibraryOnIdle: prefetchLibraryOnIdle,
        prefetchActiveQueueLyrics: prefetchActiveQueueLyrics,
        prefetchActiveQueueCovers: prefetchActiveQueueCovers,
        scheduleLyricsPrefetch: scheduleLyricsPrefetch,
        scheduleCoverPrefetch: scheduleCoverPrefetch,
        setLastQuery: function (q) {
            musicData.lastQuery = String(q || '');
            saveData();
        },
        getDesktopLyricsEnabled: function () { return !!musicData.desktopLyrics; },
        setDesktopLyricsEnabled: function (on) {
            musicData.desktopLyrics = !!on;
            saveData();
            emitState();
        },
        getDesktopLyricsPos: function () {
            return musicData.desktopLyricsPos || { xPct: 50, yPct: 14 };
        },
        setDesktopLyricsPos: function (pos) {
            if (!pos || typeof pos !== 'object') return;
            musicData.desktopLyricsPos = {
                xPct: typeof pos.xPct === 'number' ? Math.max(4, Math.min(96, pos.xPct)) : 50,
                yPct: typeof pos.yPct === 'number' ? Math.max(4, Math.min(88, pos.yPct)) : 14
            };
            saveData();
        },
        getDesktopLyricsMinimized: function () { return !!musicData.desktopLyricsMinimized; },
        setDesktopLyricsMinimized: function (on) {
            musicData.desktopLyricsMinimized = !!on;
            saveData();
        },
        defaultAppearance: defaultAppearance,
        normalizeAppearance: normalizeAppearance,
        getAppearance: function () {
            return Object.assign({}, normalizeAppearance(musicData.appearance));
        },
        setAppearance: function (partial) {
            if (!partial || typeof partial !== 'object') return musicData.appearance;
            snapshotAppearanceBackup(musicData.appearance);
            musicData.appearance = normalizeAppearance(Object.assign({}, musicData.appearance, partial));
            if (appearanceHasAssets(musicData.appearance)) snapshotAppearanceBackup(musicData.appearance);
            saveData();
            emitState();
            return musicData.appearance;
        },
        clearAppearanceField: function (key) {
            var k = String(key || '').trim();
            if (!k) return musicData.appearance;
            var patch = {};
            if (k === 'minePageBg' || k === 'profileAvatar' || k === 'playerBg' || k === 'vinylCover') patch[k] = null;
            else if (k === 'homeBg') patch.minePageBg = null;
            else if (k === 'profileNickname') patch.profileNickname = '';
            else if (k === 'mineStatusText') patch.mineStatusText = '';
            else if (k === 'playerLyricsColor') patch.playerLyricsColor = '';
            else if (k === 'playerLyricsFontSize') patch.playerLyricsFontSize = 0;
            else if (k === 'desktopLyricsCss') {
                patch.desktopLyricsCss = '';
                patch.desktopLyricsPresetName = '';
            }
            else return musicData.appearance;
            return global.miyaMusicEngine.setAppearance(patch);
        }
    };

    if (global.miyaRegisterKvStore) {
        global.miyaRegisterKvStore({
            whenReady: function () {
                return Promise.all([
                    loadDataWithTimeout(8000),
                    hydrateNeteaseSessionFromIdb()
                ]);
            }
        });
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            persistPlaybackPosition(true);
            return;
        }
        drainLyricsPrefetchQueue();
        drainCoverPrefetchQueue();
    });

    window.addEventListener('pagehide', function () {
        persistPlaybackPosition(true);
        musicData = normalizeData(musicData);
        if (typeof global.miyaSyncFlushJsonKey === 'function') {
            global.miyaSyncFlushJsonKey(LS_KEY, musicData);
        } else {
            persistMusicData();
        }
    });

    /* 播放列表等数据改由 whenReady / 空闲 bootstrap 加载，避免阻塞首屏 */
})(window);
