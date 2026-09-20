(function (global) {
  'use strict';

  var API_CONFIG_KEY = 'miya-api-config';
  var API_PRESETS_KEY = 'miya-api-presets';
  var IMAGE_GEN_PRESETS_KEY = 'miya-image-gen-presets-v1';
  var SYSTEM_PREFS_KEY = 'miya-system-prefs-v1';
  var MSG_SOUND_SETTINGS_KEY = 'miya-msg-sound-v1';
  var GLOBAL_BREAK_KEY = 'miya-global-break-prompt';
  var THEME_META_KEY = 'miya-theme-meta';
  var THEME_PRESETS_KEY = 'miya-theme-presets';
  var BACKUP_VERSION = 4;
  var DEEP_PHONE_DB = 'miya-deep-phone-v1';
  var DEEP_PHONE_STORE = 'phones';
  var LS_PLACEHOLDER_JSON = '{"__storedInIdb":true}';
  var LS_SPILL_BYTES = global.miyaLsSpillBytes || 49152;

  var WORLDBOOK_KEY = 'miya-worldbook-v1';
  var CONTACTS_KEY = 'miya-contacts-v1';
  var CONTACTS_REL_KEY = 'miya-contacts-relationships';
  var CHAT_META_KEY = 'miya-chat-meta';
  var CHAT_GLOBAL_SETTINGS_KEY = 'miya-chat-global-settings-v1';
  var CHAT_MOMENTS_KEY = 'miya-moments-v1';
  var CHAT_BEAUTIFY_KEY = 'miya-chat-beautify-presets-v1';
  var CHAT_APP_BEAUTIFY_KEY = 'miya-chat-app-beautify-v1';
  var CHAT_APP_BEAUTIFY_PRESETS_KEY = 'miya-chat-app-beautify-presets-v1';
  var CHAT_META_BACKUP_KEY = 'miya-chat-meta:backup';
  var CHAT_OPERATION_RULES_KEY = 'miya-chat-operation-rules-presets-v1';
  var CHAT_THINKING_RULES_KEY = 'miya-chat-thinking-rules-presets-v1';
  var CHAT_UI_THEME_KEY = 'miya-chat-ui-theme';
  var CHAT_TIMESTAMPS_KEY = 'miya-chat-show-timestamps-v1';
  var MUSIC_DATA_KEY = 'miya-music-data-v1';
  var MUSIC_SESSION_KEY = 'miya-netease-session-v1';
  var MUSIC_LISTEN_KEY = 'miya-music-listen-together-v1';
  var MUSIC_APPEARANCE_PRESETS_KEY = 'miya-music-appearance-presets-v1';
  var MUSIC_APPEARANCE_BACKUP_KEY = 'miya-music-appearance-backup-v1';
  var DIARY_KEY = 'miya-diary-v1';
  var FORUM_KEY = 'miya-forum-v1';
  var TYPEWRITER_KEY = 'miya-typewriter-v1';
  var TYPEWRITER_SETTINGS_KEY = 'miya-typewriter-settings-v1';
  var TYPEWRITER_READ_KEY = 'miya-typewriter-read-together-v1';
  var APPOINTMENT_KEY = 'miya-appointment-v1';
  var APPOINTMENT_BACKUP_KEY = 'miya-appointment-v1-backup';
  var OFFLINE_BEAUTIFY_PRESETS_KEY = 'miya-offline-beautify-presets-v1';
  var ITINERARY_KEY = 'miya-itinerary-v1';
  var SIMULATOR_KEY = 'miya-simulator-v2';
  var SIMULATOR_KEY_LEGACY = 'miya-simulator-v1';
  var SIMULATOR_BACKUP_KEY = 'miya-simulator-v2-backup';
  var MATCH_SESSIONS_KEY = 'miya-match-sessions-v1';
  var MATCH_PRIZE_PRESETS_KEY = 'miya-match-prize-presets-v1';
  var MATCH_CUSTOM_ITEMS_KEY = 'miya-match-custom-items-v1';
  var WEATHER_KEY = 'miya-weather-v1';
  var COUPLE_KEY = 'miya-couple-v1';
  var COUPLE_WHISPER_KEY = 'miya-couple-whisper-v1';
  var THEATER_KEY = 'miya-theater-v1';
  var ALBUM_KEY = 'miya-album-v1';
  var LOCK_KEY = 'miya-lock-meta';
  var DESK_LAYOUT_KEY = 'miya-desk-layout-mode';
  var DESK_CUSTOM_KEY = 'miya-desk-custom-v1';
  var DESK_CUSTOM_PRESETS_KEY = 'miya-desk-custom-presets-v1';
  var DESK_WIDGET_PRESETS_KEY = 'miya-desk-custom-widget-presets-v1';
  var DESK_WIDGET_DRAFT_KEY = 'miya-desk-custom-widget-draft-v1';
  var UPDATE_NOTICE_KEY = 'miya-update-notice-v1';

  var STORAGE_CATALOG = [
    {
      id: 'theme',
      title: '外观与桌面',
      lsKeys: [
        THEME_META_KEY,
        THEME_PRESETS_KEY,
        LOCK_KEY,
        DESK_LAYOUT_KEY,
        DESK_CUSTOM_KEY,
        DESK_CUSTOM_PRESETS_KEY,
        DESK_WIDGET_PRESETS_KEY,
        DESK_WIDGET_DRAFT_KEY
      ],
      widgetKvKeys: [THEME_META_KEY, THEME_PRESETS_KEY, DESK_LAYOUT_KEY, DESK_CUSTOM_KEY, DESK_CUSTOM_PRESETS_KEY, DESK_WIDGET_PRESETS_KEY],
      themeMediaIdb: true
    },
    {
      id: 'api',
      title: '系统与接口',
      lsKeys: [API_CONFIG_KEY, API_PRESETS_KEY, IMAGE_GEN_PRESETS_KEY, GLOBAL_BREAK_KEY, SYSTEM_PREFS_KEY, MSG_SOUND_SETTINGS_KEY, UPDATE_NOTICE_KEY],
      widgetKvKeys: [API_CONFIG_KEY, API_PRESETS_KEY, IMAGE_GEN_PRESETS_KEY],
      msgSoundIdb: true
    },
    { id: 'worldbook', title: '典籍片段', lsKeys: [WORLDBOOK_KEY], widgetKvKeys: [WORLDBOOK_KEY] },
    { id: 'contacts', title: '联系人档案', lsKeys: [CONTACTS_KEY, CONTACTS_REL_KEY], widgetKvKeys: [CONTACTS_KEY, CONTACTS_REL_KEY] },
    {
      id: 'chat',
      title: '聊天与会话',
      lsKeys: [CHAT_META_KEY, CHAT_META_BACKUP_KEY, CHAT_GLOBAL_SETTINGS_KEY, CHAT_MOMENTS_KEY, CHAT_BEAUTIFY_KEY, CHAT_APP_BEAUTIFY_KEY, CHAT_APP_BEAUTIFY_PRESETS_KEY, CHAT_OPERATION_RULES_KEY, CHAT_THINKING_RULES_KEY, CHAT_UI_THEME_KEY, CHAT_TIMESTAMPS_KEY, ALBUM_KEY],
      widgetKvKeys: [CHAT_META_KEY, CHAT_META_BACKUP_KEY, CHAT_GLOBAL_SETTINGS_KEY, CHAT_MOMENTS_KEY, CHAT_BEAUTIFY_KEY, CHAT_APP_BEAUTIFY_KEY, CHAT_APP_BEAUTIFY_PRESETS_KEY, CHAT_OPERATION_RULES_KEY, CHAT_THINKING_RULES_KEY, CHAT_TIMESTAMPS_KEY, ALBUM_KEY],
      chatMediaIdb: true
    },
    {
      id: 'music',
      title: '网易云音乐',
      lsKeys: [MUSIC_DATA_KEY, MUSIC_SESSION_KEY, MUSIC_LISTEN_KEY, MUSIC_APPEARANCE_PRESETS_KEY, MUSIC_APPEARANCE_BACKUP_KEY],
      widgetKvKeys: [MUSIC_DATA_KEY, MUSIC_SESSION_KEY, MUSIC_LISTEN_KEY, MUSIC_APPEARANCE_PRESETS_KEY],
      musicLocalAudioIdb: true
    },
    { id: 'diary', title: '日记', lsKeys: [DIARY_KEY], widgetKvKeys: [DIARY_KEY] },
    { id: 'forum', title: '论坛', lsKeys: [FORUM_KEY], widgetKvKeys: [FORUM_KEY] },
    {
      id: 'typewriter',
      title: '打字机',
      lsKeys: [TYPEWRITER_KEY, TYPEWRITER_SETTINGS_KEY, TYPEWRITER_READ_KEY],
      widgetKvKeys: [TYPEWRITER_KEY, TYPEWRITER_SETTINGS_KEY, TYPEWRITER_READ_KEY]
    },
    {
      id: 'offline',
      title: '线下剧情',
      lsKeys: [APPOINTMENT_KEY, APPOINTMENT_BACKUP_KEY, OFFLINE_BEAUTIFY_PRESETS_KEY],
      widgetKvKeys: [APPOINTMENT_KEY, APPOINTMENT_BACKUP_KEY, OFFLINE_BEAUTIFY_PRESETS_KEY]
    },
    { id: 'itinerary', title: '行程轨迹', lsKeys: [ITINERARY_KEY], widgetKvKeys: [ITINERARY_KEY] },
    { id: 'weather', title: '天气', lsKeys: [WEATHER_KEY], widgetKvKeys: [WEATHER_KEY] },
    { id: 'couple', title: '情侣空间', lsKeys: [COUPLE_KEY, COUPLE_WHISPER_KEY], widgetKvKeys: [COUPLE_KEY, COUPLE_WHISPER_KEY] },
    { id: 'theater', title: '小剧场', lsKeys: [THEATER_KEY], widgetKvKeys: [THEATER_KEY] },
    { id: 'match', title: '赛事', lsKeys: [MATCH_SESSIONS_KEY, MATCH_PRIZE_PRESETS_KEY, MATCH_CUSTOM_ITEMS_KEY] },
    { id: 'simulator', title: '人生分镜馆', lsKeys: [SIMULATOR_KEY, SIMULATOR_KEY_LEGACY, SIMULATOR_BACKUP_KEY], widgetKvKeys: [SIMULATOR_KEY, SIMULATOR_BACKUP_KEY] },
    { id: 'deep', title: '深入角色手机', deepPhoneIdb: true }
  ];

  var BACKUP_IDB_STORES_BASE = [
    { file: 'idb/miya-theme-media_blobs.json', db: 'miya-theme-media', store: 'blobs', label: '主题素材', blob: true },
    { file: 'idb/miya-deep-phone-v1_phones.json', db: DEEP_PHONE_DB, store: DEEP_PHONE_STORE, label: '深入角色手机', blob: false }
  ];

  var BACKUP_IDB_STORES_HEAVY = [
    { file: 'idb/miya-chat-media_blobs.json', db: 'miya-chat-media', store: 'blobs', label: '聊天图片', blob: true },
    { file: 'idb/miya-music-local-audio-v1_blobs.json', db: 'miya-music-local-audio-v1', store: 'blobs', label: '本地音乐', blob: true },
    { file: 'idb/miya-msg-sound-v1_blobs.json', db: 'miya-msg-sound-v1', store: 'blobs', label: '提示音', blob: true }
  ];

  var systemPrefs = {
    notify: false,
    musicKeepAlive: false,
    apiFab: false,
    apiFabX: null,
    apiFabY: null,
    apiFabSize: 52,
    apiFabDock: '',
    apiFabActivePreset: '',
    apiFabActiveIgPreset: ''
  };
  var apiFabRoot = null;
  var apiFabVeil = null;
  var apiFabDrag = null;
  var FAB_SIZE_MIN = 36;
  var FAB_SIZE_MAX = 72;
  var FAB_SIZE_DEFAULT = 52;
  var keepAliveAudio = null;
  var mainListScrollPos = 0;
  var panelClosing = false;
  var keepAliveStopTimer = null;
  var keepAliveResumeTimer = null;
  var keepAliveWavUrl = null;
  var keepAliveAutoResumeBound = false;
  var keepAliveGen = 0;
  var keepAliveFgHold = 0;
  var keepAliveMediaSessionBound = false;
  var KEEP_ALIVE_DURATION_MS = 8 * 60 * 60 * 1000;
  var KEEP_ALIVE_RESET_KEY = 'miya-ka-reset-v46';
  var apiConfigCache = null;
  var apiConfigHydrated = false;
  var apiPresetsCache = null;
  var apiPresetsReady = null;
  var storageSummaryTimer = null;
  var storageContextCache = null;
  var storageContextPromise = null;
  var storageSummaryHydrated = false;

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    var div = document.createElement('div');
    div.className = 'ins-toast';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(function () { div.remove(); }, 2400);
  }

  function dialog(opts) {
    if (global.miyaDialog) {
      if (opts.mode === 'confirm') return global.miyaDialog.confirm(opts);
      if (opts.mode === 'prompt') return global.miyaDialog.prompt(opts);
      return global.miyaDialog.alert(opts);
    }
    if (opts.mode === 'confirm') return Promise.resolve(confirm((opts.title || '') + '\n' + (opts.message || '')));
    return Promise.resolve(alert((opts.title || '') + '\n' + (opts.message || '')));
  }

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function saveJson(key, obj) {
    localStorage.setItem(key, JSON.stringify(obj));
  }

  function isIdbPlaceholderConfig(obj) {
    return !!(obj && typeof obj === 'object' && obj.__storedInIdb === true);
  }

  function getApiConfig() {
    if (apiConfigCache && !isIdbPlaceholderConfig(apiConfigCache)) {
      return Object.assign({}, apiConfigCache);
    }
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var sync = global.miyaSyncReadJsonKey(API_CONFIG_KEY);
      if (sync && typeof sync === 'object' && !isIdbPlaceholderConfig(sync)) {
        apiConfigCache = sync;
        return Object.assign({}, apiConfigCache);
      }
    }
    var loaded = loadJson(API_CONFIG_KEY, {});
    if (isIdbPlaceholderConfig(loaded)) return {};
    apiConfigCache = loaded;
    return Object.assign({}, apiConfigCache);
  }

  function hydrateApiConfigFromIdb() {
    if (typeof global.miyaReadLsJsonKey !== 'function') return Promise.resolve();
    var needsAsync = global.miyaKvKeyNeedsAsyncHydrate && global.miyaKvKeyNeedsAsyncHydrate(API_CONFIG_KEY);
    if (apiConfigHydrated && apiConfigCache && !isIdbPlaceholderConfig(apiConfigCache) && !needsAsync) {
      return Promise.resolve();
    }
    return global.miyaReadLsJsonKey(API_CONFIG_KEY, null).then(function (v) {
      if (v && typeof v === 'object' && !isIdbPlaceholderConfig(v)) apiConfigCache = v;
      apiConfigHydrated = true;
    });
  }

  function setApiConfig(next) {
    apiConfigCache = Object.assign({}, getApiConfig(), next || {});
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      global.miyaWriteLsJsonKey(API_CONFIG_KEY, apiConfigCache).catch(function () {
        saveJson(API_CONFIG_KEY, apiConfigCache);
      });
    } else {
      saveJson(API_CONFIG_KEY, apiConfigCache);
    }
  }

  global.miyaGetApiConfigCached = getApiConfig;
  global.miyaSetApiConfig = setApiConfig;
  global.miyaEnsureApiConfigHydrated = hydrateApiConfigFromIdb;
  global.miyaInvalidateApiConfigCache = function () {
    apiConfigCache = null;
    apiConfigHydrated = false;
    hydrateApiConfigFromIdb();
  };

  global.miyaGetGlobalBreakPrompt = function () {
    try { return localStorage.getItem(GLOBAL_BREAK_KEY) || ''; } catch (e) { return ''; }
  };

  global.miyaGetSystemPrefs = function () {
    return Object.assign({}, systemPrefs);
  };

  function getNotificationApi() {
    try {
      if (typeof Notification !== 'undefined') return Notification;
      if (window.top && window.top !== window && typeof window.top.Notification !== 'undefined') {
        return window.top.Notification;
      }
      if (window.parent && window.parent !== window && typeof window.parent.Notification !== 'undefined') {
        return window.parent.Notification;
      }
    } catch (e) {}
    return null;
  }

  global.miyaGetNotificationApi = getNotificationApi;

  function getNotificationPermission() {
    var N = getNotificationApi();
    if (!N) return 'unsupported';
    try { return N.permission || 'default'; } catch (e) { return 'unsupported'; }
  }

  function requestNotificationPermission() {
    var N = getNotificationApi();
    if (!N || typeof N.requestPermission !== 'function') return Promise.resolve('unsupported');
    try {
      var p = N.requestPermission();
      if (p && typeof p.then === 'function') return p;
    } catch (e) {}
    return Promise.resolve(getNotificationPermission());
  }

  function normalizeNotificationOpts(opts) {
    opts = opts && typeof opts === 'object' ? Object.assign({}, opts) : {};
    if (opts.icon) {
      try {
        opts.icon = new URL(opts.icon, location.href).href;
      } catch (e) {
        delete opts.icon;
      }
    }
    if (opts.icon && /^data:/i.test(opts.icon)) delete opts.icon;
    if (!opts.data || typeof opts.data !== 'object') opts.data = {};
    if (!opts.data.url) {
      try {
        opts.data.url = location.href.split('#')[0];
      } catch (e2) {
        opts.data.url = './';
      }
    }
    return opts;
  }

  function showViaNotificationConstructor(N, title, opts) {
    try {
      return new N(String(title || 'miya小手机'), opts);
    } catch (e) {
      return null;
    }
  }

  function showSystemNotification(title, opts) {
    var N = getNotificationApi();
    if (!N || getNotificationPermission() !== 'granted') return Promise.resolve(null);
    var normalized = normalizeNotificationOpts(opts);
    var displayTitle = String(title || 'miya小手机');

    if ('serviceWorker' in navigator) {
      return navigator.serviceWorker.ready
        .then(function (reg) {
          if (reg && typeof reg.showNotification === 'function') {
            return reg
              .showNotification(displayTitle, normalized)
              .then(function () {
                return { _viaSw: true, close: function () {} };
              })
              .catch(function () {
                return showViaNotificationConstructor(N, displayTitle, normalized);
              });
          }
          return showViaNotificationConstructor(N, displayTitle, normalized);
        })
        .catch(function () {
          return showViaNotificationConstructor(N, displayTitle, normalized);
        });
    }
    return Promise.resolve(showViaNotificationConstructor(N, displayTitle, normalized));
  }

  global.miyaShowSystemNotification = showSystemNotification;

  async function loadApiPresetsArr() {
    if (typeof global.miyaReadLsJsonKey === 'function') {
      var v = await global.miyaReadLsJsonKey(API_PRESETS_KEY, []);
      return Array.isArray(v) ? v : [];
    }
    return loadJson(API_PRESETS_KEY, []);
  }

  async function saveApiPresetsArr(arr) {
    if (typeof global.miyaWriteLsJsonKey === 'function') {
      return !!(await global.miyaWriteLsJsonKey(API_PRESETS_KEY, arr));
    }
    try {
      saveJson(API_PRESETS_KEY, arr);
      return true;
    } catch (e) {
      return false;
    }
  }

  function commitApiPresetsCache(list) {
    apiPresetsCache = Array.isArray(list) ? list.slice() : [];
    renderApiPresetOptions(apiPresetsCache);
    refreshApiFabLists();
    return apiPresetsCache;
  }

  function invalidateApiPresetsCache() {
    apiPresetsCache = null;
    apiPresetsReady = null;
  }

  function renderApiPresetOptions(list) {
    var pick = $('miya-st-preset-pick');
    if (!pick) return;
    var names = (list || []).map(function (pr) { return pr && pr.name ? String(pr.name) : ''; }).filter(Boolean);
    var namesKey = names.join('\0');
    if (pick.dataset.presetNames === namesKey) return;
    var current = pick.value;
    pick.innerHTML = '<option value="">选择已存预设</option>';
    names.forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      pick.appendChild(opt);
    });
    if (current && names.indexOf(current) >= 0) pick.value = current;
    pick.dataset.presetNames = namesKey;
  }

  function loadSystemPrefs() {
    var p = loadJson(SYSTEM_PREFS_KEY, {});
    if (typeof p.notify === 'boolean') systemPrefs.notify = p.notify;
    if (typeof p.musicKeepAlive === 'boolean') systemPrefs.musicKeepAlive = p.musicKeepAlive;
    if (typeof p.apiFab === 'boolean') systemPrefs.apiFab = p.apiFab;
    if (typeof p.apiFabX === 'number' && Number.isFinite(p.apiFabX)) systemPrefs.apiFabX = p.apiFabX;
    if (typeof p.apiFabY === 'number' && Number.isFinite(p.apiFabY)) systemPrefs.apiFabY = p.apiFabY;
    if (typeof p.apiFabSize === 'number' && Number.isFinite(p.apiFabSize)) {
      systemPrefs.apiFabSize = Math.min(FAB_SIZE_MAX, Math.max(FAB_SIZE_MIN, Math.round(p.apiFabSize)));
    }
    if (p.apiFabDock === 'left' || p.apiFabDock === 'right') systemPrefs.apiFabDock = p.apiFabDock;
    else systemPrefs.apiFabDock = '';
    if (typeof p.apiFabActivePreset === 'string') systemPrefs.apiFabActivePreset = p.apiFabActivePreset;
    if (typeof p.apiFabActiveIgPreset === 'string') systemPrefs.apiFabActiveIgPreset = p.apiFabActiveIgPreset;
    var perm = getNotificationPermission();
    if (perm !== 'unsupported' && systemPrefs.notify && perm !== 'granted') {
      systemPrefs.notify = false;
      saveJson(SYSTEM_PREFS_KEY, systemPrefs);
    }
    /* One-shot: kill zombie keep-alive left by old 30s-loop builds. */
    try {
      if (!localStorage.getItem(KEEP_ALIVE_RESET_KEY)) {
        localStorage.setItem(KEEP_ALIVE_RESET_KEY, '1');
        systemPrefs.musicKeepAlive = false;
        saveJson(SYSTEM_PREFS_KEY, systemPrefs);
      }
    } catch (eReset) {}
    bindKeepAliveAutoResume();
    nukeAllKeepAliveAudio();
    if (systemPrefs.musicKeepAlive) resumeKeepAliveIfNeeded();
    else stopKeepAliveMusic();
    syncApiFabVisibility();
  }

  function writeWavChunkString(view, offset, str) {
    for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i) & 0xff);
  }

  /** All-zero silent WAV, duration = 8 hours (sampleRate 10 keeps payload small). */
  function buildSilentWavDataUrl(totalSeconds) {
    var sampleRate = 10;
    var numSamples = Math.max(2, Math.floor(sampleRate * totalSeconds));
    var dataSize = numSamples * 2;
    var buffer = new ArrayBuffer(44 + dataSize);
    var view = new DataView(buffer);
    writeWavChunkString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeWavChunkString(view, 8, 'WAVE');
    writeWavChunkString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeWavChunkString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    new Uint8Array(buffer, 44, dataSize).fill(0);
    var u8 = new Uint8Array(buffer);
    var CHUNK = 0x8000;
    var acc = [];
    for (var i = 0; i < u8.length; i += CHUNK) {
      acc.push(String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CHUNK, u8.length))));
    }
    return 'data:audio/wav;base64,' + btoa(acc.join(''));
  }

  function getKeepAliveLoopDataUrl() {
    if (!keepAliveWavUrl) keepAliveWavUrl = buildSilentWavDataUrl(8 * 3600);
    return keepAliveWavUrl;
  }

  function isKeepAlivePlaying() {
    return !!(keepAliveAudio && !keepAliveAudio.paused && !keepAliveAudio.ended);
  }

  var KEEP_ALIVE_MEDIA_ACTIONS = [
    'play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto',
    'previoustrack', 'nexttrack'
  ];

  function clearKeepAliveMediaSession() {
    if (!('mediaSession' in navigator)) return;
    keepAliveMediaSessionBound = false;
    for (var i = 0; i < KEEP_ALIVE_MEDIA_ACTIONS.length; i++) {
      try { navigator.mediaSession.setActionHandler(KEEP_ALIVE_MEDIA_ACTIONS[i], null); } catch (e) {}
    }
    try {
      if (typeof navigator.mediaSession.setPositionState === 'function') {
        navigator.mediaSession.setPositionState();
      }
    } catch (e2) {
      try { navigator.mediaSession.setPositionState({}); } catch (e3) {}
    }
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch (e4) {}
  }

  function nukeAudioEl(node) {
    if (!node) return;
    try {
      node.loop = false;
      node.autoplay = false;
      node.muted = true;
      node.volume = 0;
      try { node.pause(); } catch (e0) {}
      try { node.removeAttribute('src'); } catch (e1) {}
      try { node.src = ''; } catch (e2) {}
      try { node.load(); } catch (e3) {}
      try { node.pause(); } catch (e4) {}
      if (node.parentNode) node.parentNode.removeChild(node);
    } catch (e) {}
  }

  /** Kill every keep-alive audio node — including orphans from older builds. */
  function nukeAllKeepAliveAudio() {
    keepAliveAudio = null;
    try {
      var list = document.querySelectorAll('audio[data-miya-keepalive], audio[data-miya-keep-alive]');
      for (var i = 0; i < list.length; i++) nukeAudioEl(list[i]);
    } catch (e0) {}
    /* Also sweep hidden looping audio left by older unmarked builds. */
    try {
      var all = document.querySelectorAll('audio');
      for (var j = 0; j < all.length; j++) {
        var el = all[j];
        var src = '';
        try { src = String(el.currentSrc || el.src || ''); } catch (eSrc) {}
        if (src.indexOf('data:audio/wav') === 0 && (el.loop || el.style.display === 'none')) {
          nukeAudioEl(el);
        }
      }
    } catch (e1) {}
  }

  function bindKeepAliveMediaSession() {
    if (keepAliveMediaSessionBound || !('mediaSession' in navigator)) return;
    keepAliveMediaSessionBound = true;
    try { navigator.mediaSession.setActionHandler('play', function () {}); } catch (e) {}
    try {
      navigator.mediaSession.setActionHandler('pause', function () {
        disableKeepAliveCompletely();
      });
    } catch (e2) {}
    try {
      navigator.mediaSession.setActionHandler('stop', function () {
        disableKeepAliveCompletely();
      });
    } catch (e3) {}
  }

  function syncKeepAliveMediaSessionPlaying() {
    if (!('mediaSession' in navigator)) return;
    if (!systemPrefs.musicKeepAlive) {
      clearKeepAliveMediaSession();
      return;
    }
    try {
      bindKeepAliveMediaSession();
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'miya小手机',
        artist: '后台保活',
        album: '循环八小时'
      });
      navigator.mediaSession.playbackState = 'playing';
      if (typeof navigator.mediaSession.setPositionState === 'function' && keepAliveAudio) {
        var dur = Number(keepAliveAudio.duration);
        if (Number.isFinite(dur) && dur > 0) {
          navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: 1,
            position: Math.min(Number(keepAliveAudio.currentTime) || 0, dur)
          });
        }
      }
    } catch (e) {}
  }

  function stopKeepAliveMusic() {
    keepAliveGen += 1;
    var gen = keepAliveGen;
    keepAliveFgHold = 0;
    if (keepAliveStopTimer) {
      clearTimeout(keepAliveStopTimer);
      keepAliveStopTimer = null;
    }
    if (keepAliveResumeTimer) {
      clearTimeout(keepAliveResumeTimer);
      keepAliveResumeTimer = null;
    }
    nukeAllKeepAliveAudio();
    clearKeepAliveMediaSession();
    setTimeout(function () {
      if (systemPrefs.musicKeepAlive || keepAliveGen !== gen) return;
      nukeAllKeepAliveAudio();
      clearKeepAliveMediaSession();
    }, 100);
    setTimeout(function () {
      if (systemPrefs.musicKeepAlive || keepAliveGen !== gen) return;
      nukeAllKeepAliveAudio();
      clearKeepAliveMediaSession();
    }, 500);
    setTimeout(function () {
      if (systemPrefs.musicKeepAlive || keepAliveGen !== gen) return;
      clearKeepAliveMediaSession();
    }, 1500);
  }

  function disableKeepAliveCompletely() {
    systemPrefs.musicKeepAlive = false;
    try { persistSystemPrefs(); } catch (e) {}
    stopKeepAliveMusic();
    try { syncMainToggles(); } catch (e2) {}
  }

  function scheduleKeepAliveRetry() {
    if (!systemPrefs.musicKeepAlive || keepAliveFgHold > 0 || keepAliveResumeTimer) return;
    var gen = keepAliveGen;
    keepAliveResumeTimer = setTimeout(function () {
      keepAliveResumeTimer = null;
      if (!systemPrefs.musicKeepAlive || keepAliveGen !== gen || keepAliveFgHold > 0) return;
      resumeKeepAliveIfNeeded();
    }, 2000);
  }

  function holdKeepAliveForForegroundMedia() {
    if (!systemPrefs.musicKeepAlive) return;
    keepAliveFgHold += 1;
    if (keepAliveFgHold !== 1) return;
    if (keepAliveResumeTimer) {
      clearTimeout(keepAliveResumeTimer);
      keepAliveResumeTimer = null;
    }
    if (keepAliveAudio) {
      try { keepAliveAudio.pause(); } catch (e) {}
    }
  }

  function releaseKeepAliveForForegroundMedia() {
    if (keepAliveFgHold <= 0) return;
    keepAliveFgHold -= 1;
    if (keepAliveFgHold > 0) return;
    if (!systemPrefs.musicKeepAlive) return;
    resumeKeepAliveIfNeeded();
  }

  function startKeepAliveMusic() {
    if (!systemPrefs.musicKeepAlive) return;
    if (isKeepAlivePlaying() && keepAliveFgHold === 0) {
      syncKeepAliveMediaSessionPlaying();
      return;
    }
    stopKeepAliveMusic();
    if (!systemPrefs.musicKeepAlive) return;
    keepAliveGen += 1;
    var gen = keepAliveGen;
    if (!document.body) return;
    var a = document.createElement('audio');
    a.setAttribute('data-miya-keepalive', '1');
    a.src = getKeepAliveLoopDataUrl();
    /* Single 8-hour track — do NOT use a short looping clip. */
    a.loop = false;
    a.playsInline = true;
    a.setAttribute('playsinline', '');
    a.setAttribute('webkit-playsinline', '');
    a.controls = false;
    a.volume = 0;
    a.muted = false;
    a.preload = 'auto';
    a.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px;';
    a.setAttribute('aria-hidden', 'true');
    document.body.appendChild(a);
    keepAliveAudio = a;
    a.addEventListener('loadedmetadata', function () {
      if (keepAliveGen !== gen || keepAliveAudio !== a) return;
      syncKeepAliveMediaSessionPlaying();
    });
    a.addEventListener('ended', function () {
      if (!systemPrefs.musicKeepAlive || keepAliveGen !== gen) return;
      /* 8h track ended: turn off cleanly. */
      disableKeepAliveCompletely();
    });
    syncKeepAliveMediaSessionPlaying();
    var p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(function () {
        if (!systemPrefs.musicKeepAlive || keepAliveGen !== gen || keepAliveAudio !== a) {
          nukeAudioEl(a);
          return;
        }
        if (keepAliveFgHold > 0) {
          try { a.pause(); } catch (eP) {}
          return;
        }
        syncKeepAliveMediaSessionPlaying();
      }).catch(function () {
        if (!systemPrefs.musicKeepAlive || keepAliveGen !== gen || keepAliveFgHold > 0) return;
        scheduleKeepAliveRetry();
      });
    }
    keepAliveStopTimer = setTimeout(function () {
      if (keepAliveGen !== gen) return;
      disableKeepAliveCompletely();
    }, KEEP_ALIVE_DURATION_MS);
  }

  function resumeKeepAliveIfNeeded() {
    if (!systemPrefs.musicKeepAlive || keepAliveFgHold > 0) return;
    var gen = keepAliveGen;
    if (isKeepAlivePlaying()) {
      syncKeepAliveMediaSessionPlaying();
      return;
    }
    if (keepAliveAudio && keepAliveAudio.paused) {
      var a = keepAliveAudio;
      var p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          if (!systemPrefs.musicKeepAlive || keepAliveGen !== gen || keepAliveAudio !== a || keepAliveFgHold > 0) {
            try { a.pause(); } catch (eStop) {}
            return;
          }
          syncKeepAliveMediaSessionPlaying();
        }).catch(function () {
          if (!systemPrefs.musicKeepAlive || keepAliveGen !== gen || keepAliveFgHold > 0) return;
          scheduleKeepAliveRetry();
        });
      }
      return;
    }
    startKeepAliveMusic();
  }

  function bindKeepAliveAutoResume() {
    if (keepAliveAutoResumeBound) return;
    keepAliveAutoResumeBound = true;

    document.addEventListener('visibilitychange', function () {
      if (!systemPrefs.musicKeepAlive) {
        stopKeepAliveMusic();
        return;
      }
      if (!document.hidden && keepAliveFgHold === 0) resumeKeepAliveIfNeeded();
    });

    window.addEventListener('pageshow', function () {
      if (!systemPrefs.musicKeepAlive || keepAliveFgHold > 0) {
        if (!systemPrefs.musicKeepAlive) stopKeepAliveMusic();
        return;
      }
      resumeKeepAliveIfNeeded();
    });

    /* Leaving the page: tear down so Dynamic Island cannot outlive a closed tab.
       Keep preference; a fresh open can restart if still enabled. */
    window.addEventListener('pagehide', function (e) {
      if (!systemPrefs.musicKeepAlive || !e.persisted) {
        stopKeepAliveMusic();
      }
    });
    window.addEventListener('beforeunload', function () {
      stopKeepAliveMusic();
    });

    global.miyaForceStopKeepAlive = disableKeepAliveCompletely;
  }

  function persistSystemPrefs() {
    saveJson(SYSTEM_PREFS_KEY, systemPrefs);
  }

  function formatBytes(n) {
    var x = Number(n) || 0;
    if (x < 1024) return x + ' B';
    if (x < 1048576) return (x / 1024).toFixed(1) + ' KB';
    return (x / 1048576).toFixed(2) + ' MB';
  }

  function lsUtf8Bytes(s) {
    try { return new Blob([s == null ? '' : String(s)]).size; } catch (e) {
      return (s && String(s).length) || 0;
    }
  }

  function estimateValueBytes(val, seen) {
    if (val == null) return 0;
    if (typeof Blob !== 'undefined' && val instanceof Blob) return Number(val.size) || 0;
    if (typeof ArrayBuffer !== 'undefined' && val instanceof ArrayBuffer) return Number(val.byteLength) || 0;
    if (typeof val !== 'object') return lsUtf8Bytes(val);
    if (!seen && typeof WeakSet !== 'undefined') seen = new WeakSet();
    if (seen && seen.has(val)) return 0;
    if (seen) seen.add(val);
    if (Array.isArray(val)) {
      var sum = 0;
      for (var i = 0; i < val.length; i++) sum += estimateValueBytes(val[i], seen);
      return sum;
    }
    var objSum = 0;
    Object.keys(val).forEach(function (k) { objSum += estimateValueBytes(val[k], seen); });
    return objSum;
  }

  function isLsIdbPlaceholder(raw) {
    return global.miyaLsIsIdbPlaceholder ? global.miyaLsIsIdbPlaceholder(raw) : false;
  }

  function widgetKvFullKey(logical) {
    return 'widgetKV:' + String(logical || '');
  }

  /** 统计某逻辑键在 IDB KV 中的占用（含 plain key 与旧版 widgetKV: 前缀） */
  function estimateLogicalKvBytes(idbMap, logical, lsSizes, lsPlaceholder) {
    var key = String(logical || '');
    if (!key) return 0;
    var plain = estimateValueBytes(idbMap[key]);
    var legacy = estimateValueBytes(idbMap[widgetKvFullKey(key)]);
    var bytes = plain + legacy;
    if (!bytes) return 0;
    var lsB = Number(lsSizes[key]) || 0;
    var isPh = !!(lsPlaceholder && lsPlaceholder[key]);
    /* LS 已有完整镜像时只计 IDB 多出来的部分，避免双计；占位符则整段计入 IDB */
    if (!isPh && lsB > 0) return Math.max(0, bytes - lsB);
    return bytes;
  }

  function catalogLogicalKeys(cat) {
    var seen = {};
    var out = [];
    function push(k) {
      k = String(k || '');
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(k);
    }
    (cat.lsKeys || []).forEach(push);
    (cat.widgetKvKeys || []).forEach(push);
    return out;
  }

  async function collectStorageContext() {
    var lsSizes = {};
    var lsPlaceholder = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        var v = localStorage.getItem(k);
        lsSizes[k] = lsUtf8Bytes(v);
        if (isLsIdbPlaceholder(v)) lsPlaceholder[k] = true;
      }
    } catch (e) {}

    var idbMap = {};
    try {
      idbMap = await global.miyaKvIdbExportAllEntries();
    } catch (e2) {}

    var themeMediaBytes = 0;
    try {
      var tm = await global.miyaKvExportNamedDbKv('miya-theme-media', 'blobs');
      Object.keys(tm || {}).forEach(function (key) {
        themeMediaBytes += estimateValueBytes(tm[key]);
      });
    } catch (e3) {}

    var chatMediaBytes = 0;
    try {
      var cm = await global.miyaKvExportNamedDbKv('miya-chat-media', 'blobs');
      Object.keys(cm || {}).forEach(function (key) {
        chatMediaBytes += estimateValueBytes(cm[key]);
      });
    } catch (eChat) {}

    var musicLocalAudioBytes = 0;
    try {
      var ma = await global.miyaKvExportNamedDbKv('miya-music-local-audio-v1', 'blobs');
      Object.keys(ma || {}).forEach(function (key) {
        musicLocalAudioBytes += estimateValueBytes(ma[key]);
      });
    } catch (eMusic) {}

    var msgSoundBytes = 0;
    try {
      var ms = await global.miyaKvExportNamedDbKv('miya-msg-sound-v1', 'blobs');
      Object.keys(ms || {}).forEach(function (key) {
        msgSoundBytes += estimateValueBytes(ms[key]);
      });
    } catch (eMsgSound) {}

    var deepPhoneBytes = 0;
    try {
      var dp = await global.miyaKvExportNamedDbKv(DEEP_PHONE_DB, DEEP_PHONE_STORE);
      Object.keys(dp || {}).forEach(function (key) {
        deepPhoneBytes += estimateValueBytes(dp[key]);
      });
    } catch (eDeep) {}

    var groupLs = {};
    STORAGE_CATALOG.forEach(function (c) { groupLs[c.id] = 0; });
    STORAGE_CATALOG.forEach(function (c) {
      (c.lsKeys || []).forEach(function (k) {
        groupLs[c.id] += Number(lsSizes[k]) || 0;
      });
      catalogLogicalKeys(c).forEach(function (logical) {
        groupLs[c.id] += estimateLogicalKvBytes(idbMap, logical, lsSizes, lsPlaceholder);
      });
      if (c.themeMediaIdb) groupLs[c.id] += themeMediaBytes;
      if (c.chatMediaIdb) groupLs[c.id] += chatMediaBytes;
      if (c.musicLocalAudioIdb) groupLs[c.id] += musicLocalAudioBytes;
      if (c.msgSoundIdb) groupLs[c.id] += msgSoundBytes;
      if (c.deepPhoneIdb) groupLs[c.id] += deepPhoneBytes;
    });

    var stableTotal = 0;
    Object.keys(groupLs).forEach(function (gid) { stableTotal += groupLs[gid] || 0; });

    var quota = 0;
    if (navigator.storage && navigator.storage.estimate) {
      try {
        var est = await navigator.storage.estimate();
        quota = Number(est.quota) || 0;
      } catch (e4) {}
    }
    return { groupLs: groupLs, stableTotal: stableTotal, quota: quota };
  }

  function pushNotifyPreview(title, text) {
    var demo = $('miya-st-notify-demo');
    if (!demo) return;
    var item = document.createElement('div');
    item.className = 'st-notify-item';
    item.innerHTML =
      '<div class="st-notify-avatar"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>' +
      '<div class="st-notify-content"><div class="st-notify-title">' + title + '</div><div class="st-notify-text">' + text + '</div></div>' +
      '<div class="st-notify-time">刚刚</div>';
    demo.insertBefore(item, demo.firstChild);
    while (demo.children.length > 3) demo.removeChild(demo.lastChild);
  }

  function invalidateStorageCache() {
    storageContextCache = null;
    storageContextPromise = null;
    storageSummaryHydrated = false;
  }

  function getStorageContext(force) {
    if (!force && storageContextCache) return Promise.resolve(storageContextCache);
    if (!force && storageContextPromise) return storageContextPromise;
    storageContextPromise = collectStorageContext().then(function (ctx) {
      storageContextCache = ctx;
      storageContextPromise = null;
      return ctx;
    }).catch(function (err) {
      storageContextPromise = null;
      throw err;
    });
    return storageContextPromise;
  }

  function applyStorageSummary(ctx) {
    var el = $('miya-st-storage-summary');
    var pctEl = $('miya-st-storage-pct');
    var usedBar = $('miya-st-storage-used-bar');
    var pctBar = $('miya-st-storage-pct-bar');
    var quotaVal = $('miya-st-storage-quota-val');
    var quotaBar = $('miya-st-storage-quota-bar');
    if (!el || !ctx) return;
    var used = ctx.stableTotal || 0;
    el.textContent = formatBytes(used);
    var pct = 0;
    if (pctEl) {
      if (ctx.quota > 0) {
        pct = Math.min(99, Math.round((used / ctx.quota) * 100));
        pctEl.innerHTML = pct + '<em>%</em>';
      } else {
        pctEl.textContent = '—';
      }
    }
    if (quotaVal) {
      quotaVal.innerHTML = ctx.quota > 0 ? formatBytes(ctx.quota) : '—';
    }
    setTimeout(function () {
      if (usedBar) usedBar.style.width = (ctx.quota > 0 ? pct : Math.min(99, Math.round(used / (1024 * 1024 * 50)) * 2)) + '%';
      if (pctBar) pctBar.style.width = (pct || 0) + '%';
      if (quotaBar) quotaBar.style.width = ctx.quota > 0 ? '100%' : '0%';
    }, 300);
  }

  function scheduleStorageSummaryRefresh(force) {
    if (!force && storageSummaryHydrated && storageContextCache) {
      applyStorageSummary(storageContextCache);
      return;
    }
    if (storageSummaryTimer) clearTimeout(storageSummaryTimer);
    storageSummaryTimer = setTimeout(function () {
      storageSummaryTimer = null;
      var app = $('miya-settings-app');
      if (!app || !app.classList.contains('is-open') || app.classList.contains('has-panel')) return;
      refreshStorageSummary(force);
    }, force ? 0 : 600);
  }

  function refreshStorageSummary(force) {
    var el = $('miya-st-storage-summary');
    var pctEl = $('miya-st-storage-pct');
    var usedBar = $('miya-st-storage-used-bar');
    var pctBar = $('miya-st-storage-pct-bar');
    var quotaVal = $('miya-st-storage-quota-val');
    var quotaBar = $('miya-st-storage-quota-bar');
    if (!el) return;
    if (!force && storageSummaryHydrated && storageContextCache) {
      applyStorageSummary(storageContextCache);
      return;
    }
    if (!storageContextCache) {
      el.textContent = '计算中…';
      if (pctEl) pctEl.textContent = '—';
      if (quotaVal) quotaVal.textContent = '—';
      if (usedBar) usedBar.style.width = '0%';
      if (pctBar) pctBar.style.width = '0%';
      if (quotaBar) quotaBar.style.width = '0%';
    }
    getStorageContext(force).then(function (ctx) {
      applyStorageSummary(ctx);
      storageSummaryHydrated = true;
    }).catch(function () {
      el.textContent = '—';
      if (pctEl) pctEl.textContent = '—';
      if (quotaVal) quotaVal.textContent = '—';
    });
  }

  function invalidateAndRenderStoragePanel() {
    invalidateStorageCache();
    renderStoragePanel(true);
  }

  function renderStoragePanel(force) {
    var groupsEl = $('miya-st-storage-groups');
    var quotaEl = $('miya-st-storage-quota');
    var imagesEl = $('miya-st-storage-images');
    var clearEl = $('miya-st-storage-clear');
    if (!groupsEl) return;
    if (!force && storageContextCache) {
      renderStoragePanelFromContext(storageContextCache, groupsEl, quotaEl, imagesEl, clearEl);
      return;
    }
    groupsEl.innerHTML = '<p class="ins-vault-note">正在扫描…</p>';
    if (imagesEl) imagesEl.innerHTML = '';
    if (clearEl) clearEl.innerHTML = '';
    Promise.all([
      getStorageContext(force),
      collectChatMediaImages()
    ]).then(function (results) {
      var ctx = results[0];
      var imgCtx = results[1];
      renderStoragePanelFromContext(ctx, groupsEl, quotaEl, imagesEl, clearEl, imgCtx);
      applyStorageSummary(ctx);
      storageSummaryHydrated = true;
    }).catch(function () {
      groupsEl.innerHTML = '<p class="ins-vault-note">扫描失败</p>';
    });
  }

  function renderStoragePanelFromContext(ctx, groupsEl, quotaEl, imagesEl, clearEl, imgCtx) {
    if (!groupsEl || !ctx) return;
    var html = '';
    var maxB = 0;
    STORAGE_CATALOG.forEach(function (c) {
      maxB = Math.max(maxB, ctx.groupLs[c.id] || 0);
    });
    if (maxB <= 0) maxB = ctx.stableTotal || 1;
    STORAGE_CATALOG.forEach(function (c) {
      var b = ctx.groupLs[c.id] || 0;
      if (b <= 0) return;
      var pct = Math.min(100, Math.round((b / maxB) * 100));
      html +=
        '<div class="ins-meter-row">' +
        '<div class="ins-meter-label"><span>' + c.title + '</span><span>' + formatBytes(b) + '</span></div>' +
        '<div class="ins-meter-bar"><i style="width:' + pct + '%"></i></div></div>';
    });
    groupsEl.innerHTML = html || '<p class="ins-vault-note">尚无写入记录</p>';
    if (quotaEl) {
      quotaEl.textContent = ctx.quota > 0
        ? '小手机本地数据合计 ' + formatBytes(ctx.stableTotal) + ' / ' + formatBytes(ctx.quota)
        : '小手机本地数据合计 ' + formatBytes(ctx.stableTotal) + ' / —';
    }
    if (imgCtx) {
      renderStorageImagesPanel(imagesEl, imgCtx);
    } else if (imagesEl) {
      collectChatMediaImages().then(function (loaded) {
        renderStorageImagesPanel(imagesEl, loaded);
      });
    }
    renderStorageClearPanel(clearEl);
  }

  async function collectChatMediaImages() {
    var items = [];
    try {
      if (global.miyaChatStore && global.miyaChatStore.init) {
        await global.miyaChatStore.init();
      }
      var msgKeys = global.miyaChatStore && typeof global.miyaChatStore.collectMessageImageBlobKeys === 'function'
        ? global.miyaChatStore.collectMessageImageBlobKeys()
        : {};
      var raw = await global.miyaKvExportNamedDbKv('miya-chat-media', 'blobs');
      Object.keys(raw || {}).forEach(function (key) {
        if (!msgKeys[key]) return;
        var rec = raw[key];
        if (!rec || !rec.blob) return;
        var blob = rec.blob;
        var size = Number(rec.size) || (blob && blob.size) || estimateValueBytes(blob);
        items.push({ key: key, size: size, mime: String(rec.mime || (blob && blob.type) || ''), rec: rec });
      });
    } catch (e) {}
    items.sort(function (a, b) { return (b.size || 0) - (a.size || 0); });
    var totalBytes = 0;
    items.forEach(function (it) { totalBytes += it.size || 0; });
    return { items: items, totalBytes: totalBytes, count: items.length };
  }

  function renderStorageImagesPanel(el, imgCtx) {
    if (!el) return;
    imgCtx = imgCtx || { items: [], totalBytes: 0, count: 0 };
    if (!imgCtx.count) {
      el.innerHTML = '<div class="ins-storage-section"><p class="ins-field-label ins-field-label--section">聊天发送图片</p><p class="ins-vault-note">未检测到聊天消息中的图片</p></div>';
      return;
    }
    el.innerHTML =
      '<div class="ins-storage-section">' +
        '<p class="ins-field-label ins-field-label--section">聊天发送图片</p>' +
        '<p class="ins-vault-note">共 ' + imgCtx.count + ' 张（仅统计聊天消息里发送的真实图片）</p>' +
        '<div class="ins-storage-img-actions">' +
          '<button type="button" class="ins-chip" id="miya-st-img-compress">压缩聊天图片</button>' +
          '<button type="button" class="ins-chip ins-chip--dim" id="miya-st-img-delete">删除聊天图片</button>' +
        '</div>' +
      '</div>';
    var compressBtn = $('miya-st-img-compress');
    var deleteBtn = $('miya-st-img-delete');
    if (compressBtn) {
      compressBtn.addEventListener('click', function () {
        dialog({
          mode: 'confirm',
          title: '压缩聊天图片',
          message: '将重新压缩聊天中发送的 ' + imgCtx.count + ' 张图片，不影响头像、壁纸等。是否继续？',
          confirmText: '压缩',
          cancelText: '取消'
        }).then(function (ok) {
          if (!ok) return;
          compressAllChatImages(imgCtx.items).then(function (res) {
            toast('已压缩 ' + (res.ok || 0) + ' 张，节省约 ' + formatBytes(res.saved || 0));
            invalidateAndRenderStoragePanel();
          }).catch(function () { toast('压缩失败'); });
        });
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        dialog({
          mode: 'confirm',
          title: '删除聊天图片',
          message: '将删除聊天中发送的 ' + imgCtx.count + ' 张图片，消息里的图片可能无法显示。不影响头像与壁纸。是否继续？',
          confirmText: '删除',
          cancelText: '取消'
        }).then(function (ok) {
          if (!ok) return;
          deleteAllChatImages(imgCtx.items).then(function (n) {
            toast('已删除 ' + n + ' 张图片');
            invalidateAndRenderStoragePanel();
          }).catch(function () { toast('删除失败'); });
        });
      });
    }
  }

  function renderStorageClearPanel(el) {
    if (!el) return;
    var btns = STORAGE_CATALOG.map(function (c) {
      return '<button type="button" class="ins-chip ins-chip--dim ins-storage-clear-cat" data-cat="' + c.id + '">清空「' + c.title + '」</button>';
    }).join('');
    el.innerHTML =
      '<div class="ins-storage-section">' +
        '<p class="ins-field-label ins-field-label--section">清空数据</p>' +
        '<p class="ins-vault-note">按软件分类清空本地数据，操作不可撤销</p>' +
        '<div class="ins-storage-clear-grid">' + btns + '</div>' +
        '<button type="button" class="ins-chip ins-chip--danger ins-chip--block" id="miya-st-clear-all">清空全部数据</button>' +
      '</div>';
    el.querySelectorAll('.ins-storage-clear-cat').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var catId = btn.getAttribute('data-cat');
        var cat = STORAGE_CATALOG.filter(function (c) { return c.id === catId; })[0];
        if (!cat) return;
        dialog({
          mode: 'confirm',
          title: '清空「' + cat.title + '」',
          message: '将删除该分类下的全部本地数据，是否继续？',
          confirmText: '清空',
          cancelText: '取消'
        }).then(function (ok) {
          if (!ok) return;
          clearStorageCategory(catId).then(function () {
            toast('已清空「' + cat.title + '」');
            invalidateAndRenderStoragePanel();
          }).catch(function () { toast('清空失败'); });
        });
      });
    });
    var clearAllBtn = $('miya-st-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', function () {
        dialog({
          mode: 'confirm',
          title: '清空全部数据',
          message: '将删除本机全部 miya 数据（含聊天、联系人、主题等），是否继续？',
          confirmText: '全部清空',
          cancelText: '取消'
        }).then(function (ok) {
          if (!ok) return;
          clearAllStorageData().then(function () {
            toast('已全部清空，建议刷新页面');
            invalidateAndRenderStoragePanel();
          }).catch(function () { toast('清空失败'); });
        });
      });
    }
  }

  function idbDeleteNamedDbKey(dbName, storeName, key) {
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(dbName, 1); } catch (e) { resolve(); return; }
      req.onerror = function () { resolve(); };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(storeName)) { resolve(); return; }
        try {
          var tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).delete(key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e2) { resolve(); }
      };
    });
  }

  function idbPutNamedDbKey(dbName, storeName, key, value) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(dbName, 1); } catch (e) { reject(e); return; }
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(storeName)) { reject(new Error('no_store')); return; }
        var tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  }

  function compressBlobToJpeg(blob, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge != null ? opts.maxEdge : 1280;
    var quality = opts.quality != null ? opts.quality : 0.72;
    return new Promise(function (resolve, reject) {
      if (!blob || typeof blob.slice !== 'function') {
        reject(new Error('no_blob'));
        return;
      }
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) { reject(new Error('invalid')); return; }
        var scale = Math.min(1, maxEdge / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        var ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('canvas')); return; }
        ctx.drawImage(img, 0, 0, cw, ch);
        canvas.toBlob(function (out) {
          if (!out) { reject(new Error('compress')); return; }
          resolve(out);
        }, 'image/jpeg', quality);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('decode'));
      };
      img.src = url;
    });
  }

  async function compressAllChatImages(items) {
    var ok = 0;
    var saved = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var rec = it.rec || {};
      var blob = rec.blob;
      if (!blob || typeof blob.slice !== 'function') continue;
      try {
        var compressed = await compressBlobToJpeg(blob);
        if (compressed.size >= (it.size || blob.size)) continue;
        var nextRec = Object.assign({}, rec, {
          blob: compressed,
          mime: 'image/jpeg',
          size: compressed.size,
          updatedAt: Date.now()
        });
        await idbPutNamedDbKey('miya-chat-media', 'blobs', it.key, nextRec);
        if (global.miyaChatStore && typeof global.miyaChatStore.invalidateBlobUrl === 'function') {
          global.miyaChatStore.invalidateBlobUrl(it.key);
        }
        saved += Math.max(0, (it.size || blob.size) - compressed.size);
        ok++;
      } catch (e) {}
    }
    return { ok: ok, saved: saved };
  }

  async function deleteAllChatImages(items) {
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      await idbDeleteNamedDbKey('miya-chat-media', 'blobs', items[i].key);
      if (global.miyaChatStore && typeof global.miyaChatStore.invalidateBlobUrl === 'function') {
        global.miyaChatStore.invalidateBlobUrl(items[i].key);
      }
      n++;
    }
    return n;
  }

  async function clearStorageCategory(catId) {
    var cat = STORAGE_CATALOG.filter(function (c) { return c.id === catId; })[0];
    if (!cat) return;
    var logicals = catalogLogicalKeys(cat);
    logicals.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
      if (global.__miyaKvMem) {
        try { delete global.__miyaKvMem[k]; } catch (eMem) {}
      }
    });
    if (typeof global.miyaKvIdbExportAllEntries === 'function' && typeof global.miyaKvIdbReplaceAllEntries === 'function') {
      var idbMap = await global.miyaKvIdbExportAllEntries().catch(function () { return {}; });
      var next = Object.assign({}, idbMap);
      logicals.forEach(function (logical) {
        delete next[logical];
        delete next[widgetKvFullKey(logical)];
      });
      await global.miyaKvIdbReplaceAllEntries(next);
    }
    if (cat.themeMediaIdb && global.miyaKvReplaceNamedDbKv) {
      await global.miyaKvReplaceNamedDbKv('miya-theme-media', 'blobs', {});
    }
    if (cat.chatMediaIdb && global.miyaKvReplaceNamedDbKv) {
      await global.miyaKvReplaceNamedDbKv('miya-chat-media', 'blobs', {}).catch(function () {});
    }
    if (cat.musicLocalAudioIdb && global.miyaKvReplaceNamedDbKv) {
      await global.miyaKvReplaceNamedDbKv('miya-music-local-audio-v1', 'blobs', {}).catch(function () {});
    }
    if (cat.msgSoundIdb && global.miyaKvReplaceNamedDbKv) {
      await global.miyaKvReplaceNamedDbKv('miya-msg-sound-v1', 'blobs', {}).catch(function () {});
      if (global.MiyaMsgSound && typeof global.MiyaMsgSound.invalidateCache === 'function') {
        global.MiyaMsgSound.invalidateCache();
      }
    }
    if (cat.deepPhoneIdb && global.miyaKvReplaceNamedDbKv) {
      await global.miyaKvReplaceNamedDbKv(DEEP_PHONE_DB, DEEP_PHONE_STORE, {}).catch(function () {});
    }
    if (cat.id === 'api') {
      global.miyaInvalidateApiConfigCache && global.miyaInvalidateApiConfigCache();
      invalidateApiPresetsCache();
    }
    if (cat.id === 'worldbook' && global.miyaWorldbookStore) global.miyaWorldbookStore.invalidateCache && global.miyaWorldbookStore.invalidateCache();
    if (cat.id === 'contacts' && global.miyaContactsStore) global.miyaContactsStore.invalidateCache && global.miyaContactsStore.invalidateCache();
    if (cat.id === 'chat' && global.miyaChatStore && global.miyaChatStore.invalidateCache) global.miyaChatStore.invalidateCache();
    if (cat.id === 'chat' && global.miyaChatGlobalSettings) global.miyaChatGlobalSettings.invalidateCache && global.miyaChatGlobalSettings.invalidateCache();
    if (cat.id === 'chat' && global.MiyaChatAlbum && typeof global.MiyaChatAlbum.invalidateCache === 'function') {
      global.MiyaChatAlbum.invalidateCache();
    }
    if (cat.id === 'simulator' && global.MiyaSimulatorStore && global.MiyaSimulatorStore.invalidateCache) {
      global.MiyaSimulatorStore.invalidateCache();
    }
    if (cat.id === 'forum' && global.miyaForumStore && global.miyaForumStore.invalidateCache) {
      global.miyaForumStore.invalidateCache();
    }
    if (cat.id === 'typewriter') {
      if (global.miyaTypewriterStore && global.miyaTypewriterStore.invalidateCache) global.miyaTypewriterStore.invalidateCache();
      if (global.miyaTypewriterSettings && global.miyaTypewriterSettings.invalidateCache) global.miyaTypewriterSettings.invalidateCache();
      if (global.miyaTypewriterReadTogetherStore && global.miyaTypewriterReadTogetherStore.invalidateCache) {
        global.miyaTypewriterReadTogetherStore.invalidateCache();
      }
    }
    if (cat.id === 'music') {
      if (global.miyaMusicEngine && global.miyaMusicEngine.invalidateCache) global.miyaMusicEngine.invalidateCache();
      if (global.MiyaMusicListenTogether && global.MiyaMusicListenTogether.invalidateCache) {
        global.MiyaMusicListenTogether.invalidateCache();
      }
    }
    if (cat.id === 'diary' && global.miyaDiaryStore && global.miyaDiaryStore.invalidateCache) {
      global.miyaDiaryStore.invalidateCache();
    }
    if (cat.id === 'weather' && global.miyaWeatherStore && global.miyaWeatherStore.invalidateCache) {
      global.miyaWeatherStore.invalidateCache();
    }
    if (cat.id === 'couple') {
      if (global.miyaCoupleStore && global.miyaCoupleStore.invalidateCache) global.miyaCoupleStore.invalidateCache();
      if (global.miyaCoupleWhisperStore && global.miyaCoupleWhisperStore.invalidateCache) {
        global.miyaCoupleWhisperStore.invalidateCache();
      }
    }
    if (cat.id === 'theater' && global.miyaTheaterStore && global.miyaTheaterStore.invalidateCache) {
      global.miyaTheaterStore.invalidateCache();
    }
    if (cat.id === 'itinerary' && global.miyaItineraryStore && global.miyaItineraryStore.invalidateCache) {
      global.miyaItineraryStore.invalidateCache();
    }
    if (cat.id === 'offline' && global.MiyaAppointmentStore && global.MiyaAppointmentStore.invalidateCache) {
      global.MiyaAppointmentStore.invalidateCache();
    }
    if (cat.id === 'match' && global.miyaMatchStore && global.miyaMatchStore.invalidateCache) {
      global.miyaMatchStore.invalidateCache();
    }
  }

  async function clearAllStorageData() {
    try { localStorage.clear(); } catch (e) {}
    await global.miyaKvIdbReplaceAllEntries({}).catch(function () {});
    await global.miyaKvReplaceNamedDbKv('miya-theme-media', 'blobs', {}).catch(function () {});
    await global.miyaKvReplaceNamedDbKv('miya-chat-media', 'blobs', {}).catch(function () {});
    await global.miyaKvReplaceNamedDbKv('miya-music-local-audio-v1', 'blobs', {}).catch(function () {});
    await global.miyaKvReplaceNamedDbKv('miya-msg-sound-v1', 'blobs', {}).catch(function () {});
    await global.miyaKvReplaceNamedDbKv(DEEP_PHONE_DB, DEEP_PHONE_STORE, {}).catch(function () {});
    global.miyaInvalidateApiConfigCache && global.miyaInvalidateApiConfigCache();
    if (global.miyaWorldbookStore && global.miyaWorldbookStore.invalidateCache) global.miyaWorldbookStore.invalidateCache();
    if (global.miyaContactsStore && global.miyaContactsStore.invalidateCache) global.miyaContactsStore.invalidateCache();
    if (global.miyaChatStore && global.miyaChatStore.invalidateCache) global.miyaChatStore.invalidateCache();
    if (global.miyaChatGlobalSettings && global.miyaChatGlobalSettings.invalidateCache) global.miyaChatGlobalSettings.invalidateCache();
    if (global.MiyaSimulatorStore && global.MiyaSimulatorStore.invalidateCache) global.MiyaSimulatorStore.invalidateCache();
    if (global.miyaForumStore && global.miyaForumStore.invalidateCache) global.miyaForumStore.invalidateCache();
    if (global.miyaTypewriterStore && global.miyaTypewriterStore.invalidateCache) global.miyaTypewriterStore.invalidateCache();
    if (global.miyaTypewriterSettings && global.miyaTypewriterSettings.invalidateCache) global.miyaTypewriterSettings.invalidateCache();
    if (global.miyaTypewriterReadTogetherStore && global.miyaTypewriterReadTogetherStore.invalidateCache) {
      global.miyaTypewriterReadTogetherStore.invalidateCache();
    }
    if (global.miyaMusicEngine && global.miyaMusicEngine.invalidateCache) global.miyaMusicEngine.invalidateCache();
    if (global.MiyaMusicListenTogether && global.MiyaMusicListenTogether.invalidateCache) {
      global.MiyaMusicListenTogether.invalidateCache();
    }
    if (global.miyaDiaryStore && global.miyaDiaryStore.invalidateCache) global.miyaDiaryStore.invalidateCache();
    if (global.miyaWeatherStore && global.miyaWeatherStore.invalidateCache) global.miyaWeatherStore.invalidateCache();
    if (global.miyaCoupleStore && global.miyaCoupleStore.invalidateCache) global.miyaCoupleStore.invalidateCache();
    if (global.miyaCoupleWhisperStore && global.miyaCoupleWhisperStore.invalidateCache) {
      global.miyaCoupleWhisperStore.invalidateCache();
    }
    if (global.miyaTheaterStore && global.miyaTheaterStore.invalidateCache) global.miyaTheaterStore.invalidateCache();
    if (global.miyaItineraryStore && global.miyaItineraryStore.invalidateCache) global.miyaItineraryStore.invalidateCache();
    if (global.MiyaAppointmentStore && global.MiyaAppointmentStore.invalidateCache) {
      global.MiyaAppointmentStore.invalidateCache();
    }
    if (global.miyaMatchStore && global.miyaMatchStore.invalidateCache) global.miyaMatchStore.invalidateCache();
    if (global.MiyaChatAlbum && global.MiyaChatAlbum.invalidateCache) global.MiyaChatAlbum.invalidateCache();
    apiConfigCache = null;
    apiConfigHydrated = false;
    invalidateApiPresetsCache();
    loadSystemPrefs();
    syncFormsFromConfig();
  }

  function normalizeBaseUrl(s) {
    return String(s || '').trim().replace(/\/+$/, '');
  }

  function openAiCompatibleApiRoot(base) {
    var t = normalizeBaseUrl(base);
    if (!t) return '';
    try {
      var u = new URL(t);
      var path = (u.pathname || '/').replace(/\/+$/, '');
      var segs = path.split('/').filter(Boolean);
      if (segs.length && segs[segs.length - 1].toLowerCase() === 'v1') return u.origin + path;
      if (!path || path === '/') return u.origin + '/v1';
      return u.origin + path + '/v1';
    } catch (e) {
      return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
    }
  }

  async function fetchOpenAiModels(base, key) {
    var root = openAiCompatibleApiRoot(base);
    if (!root) throw new Error('empty');
    var r = await fetch(root + '/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + String(key || '').trim() }
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    if (!Array.isArray(j.data)) return [];
    return j.data.map(function (x) { return x && x.id ? String(x.id) : ''; }).filter(Boolean).sort();
  }

  function fillModelSelect(sel, ids, keepValue) {
    if (!sel) return;
    var cur = String(keepValue != null ? keepValue : sel.value || '').trim();
    var list = (ids || []).map(function (id) { return String(id || '').trim(); }).filter(Boolean);
    var idsKey = list.join('\0');
    if (sel.dataset.modelIds === idsKey && (!cur || sel.value === cur)) return;
    sel.innerHTML = '<option value="">选择模型</option>';
    list.forEach(function (id) {
      var op = document.createElement('option');
      op.value = id;
      op.textContent = id;
      sel.appendChild(op);
    });
    if (cur && list.indexOf(cur) >= 0) sel.value = cur;
    else if (cur) {
      var o = document.createElement('option');
      o.value = cur;
      o.textContent = cur;
      sel.appendChild(o);
      sel.value = cur;
      idsKey = idsKey + (idsKey ? '\0' : '') + cur;
    }
    sel.dataset.modelIds = idsKey;
  }

  function readChatApiForm() {
    return {
      baseUrl: ($('miya-st-chat-base') || {}).value ? $('miya-st-chat-base').value.trim() : '',
      apiKey: ($('miya-st-chat-key') || {}).value ? $('miya-st-chat-key').value.trim() : '',
      model: ($('miya-st-chat-model') || {}).value || '',
      temperature: ($('miya-st-chat-temp') || {}).value != null ? parseFloat($('miya-st-chat-temp').value) : 1
    };
  }

  function readSecondaryApiForm() {
    return {
      baseUrl: ($('miya-st-chat2-base') || {}).value ? $('miya-st-chat2-base').value.trim() : '',
      apiKey: ($('miya-st-chat2-key') || {}).value ? $('miya-st-chat2-key').value.trim() : '',
      model: ($('miya-st-chat2-model') || {}).value || '',
      temperature: ($('miya-st-chat2-temp') || {}).value != null ? parseFloat($('miya-st-chat2-temp').value) : 1
    };
  }

  function readScopedApiForm(prefix) {
    var chatTempEl = $('miya-st-chat-temp');
    var chatTemp = chatTempEl && chatTempEl.value != null ? parseFloat(chatTempEl.value) : 1;
    if (!Number.isFinite(chatTemp)) chatTemp = 1;
    var baseUrl = ($('miya-st-' + prefix + '-base') || {}).value ? $('miya-st-' + prefix + '-base').value.trim() : '';
    var apiKey = ($('miya-st-' + prefix + '-key') || {}).value ? $('miya-st-' + prefix + '-key').value.trim() : '';
    var model = ($('miya-st-' + prefix + '-model') || {}).value || '';
    var temp = ($('miya-st-' + prefix + '-temp') || {}).value != null ? parseFloat($('miya-st-' + prefix + '-temp').value) : chatTemp;
    if (!Number.isFinite(temp)) temp = chatTemp;
    var slice = {};
    if (baseUrl) slice.baseUrl = baseUrl;
    if (apiKey) slice.apiKey = apiKey;
    if (model) slice.model = model;
    if ((baseUrl || apiKey || model) && temp !== chatTemp) slice.temperature = temp;
    return slice;
  }

  function readForumApiForm() {
    return { forumApi: readScopedApiForm('forum') };
  }

  function readCstoreApiForm() {
    return { cstoreApi: readScopedApiForm('cstore') };
  }

  function readChatApiSavePayload() {
    var fb = $('miya-st-chat-fallback');
    return Object.assign({}, readChatApiForm(), {
      secondaryApi: readSecondaryApiForm(),
      fallbackToSecondary: !!(fb && fb.classList.contains('is-on'))
    });
  }

  function readSummaryApiForm() {
    return {
      summaryBaseUrl: ($('miya-st-sum-base') || {}).value ? $('miya-st-sum-base').value.trim() : '',
      summaryApiKey: ($('miya-st-sum-key') || {}).value ? $('miya-st-sum-key').value.trim() : '',
      summaryModel: ($('miya-st-sum-model') || {}).value || ''
    };
  }

  function readMinimaxForm() {
    var speedEl = $('miya-st-mm-speed');
    var speed = speedEl ? parseFloat(speedEl.value) : 1;
    if (!Number.isFinite(speed)) speed = 1;
    speed = Math.min(2, Math.max(0.5, speed));
    return {
      apiKey: ($('miya-st-mm-key') || {}).value ? $('miya-st-mm-key').value.trim() : '',
      groupId: ($('miya-st-mm-group') || {}).value ? $('miya-st-mm-group').value.trim() : '',
      model: ($('miya-st-mm-model') || {}).value || '',
      speed: speed,
      ttsPrompt: ($('miya-st-mm-prompt') || {}).value ? $('miya-st-mm-prompt').value.trim() : ''
    };
  }

  var MINIMAX_ENDPOINTS = ['https://api.minimax.io', 'https://api.minimaxi.com'];

  var MINIMAX_MODELS = [
    'speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo',
    'speech-02-hd', 'speech-02-turbo'
  ];

  function syncScopedApiForm(prefix, scoped, chatTemp) {
    scoped = scoped && typeof scoped === 'object' ? scoped : {};
    var baseEl = $('miya-st-' + prefix + '-base');
    var keyEl = $('miya-st-' + prefix + '-key');
    var tempEl = $('miya-st-' + prefix + '-temp');
    var tempLbl = $('miya-st-' + prefix + '-temp-lbl');
    var modelEl = $('miya-st-' + prefix + '-model');
    if (baseEl) baseEl.value = scoped.baseUrl || '';
    if (keyEl) keyEl.value = scoped.apiKey || '';
    var temp = scoped.temperature != null ? scoped.temperature : (chatTemp != null ? chatTemp : 1);
    if (tempEl) tempEl.value = temp;
    if (tempLbl) tempLbl.textContent = String(temp);
    fillModelSelect(modelEl, scoped.model ? [scoped.model] : [], scoped.model);
  }

  function syncChatApiPanelForms() {
    var cfg = getApiConfig();
    var sec = cfg.secondaryApi && typeof cfg.secondaryApi === 'object' ? cfg.secondaryApi : {};
    if ($('miya-st-chat-base')) $('miya-st-chat-base').value = cfg.baseUrl || '';
    if ($('miya-st-chat-key')) $('miya-st-chat-key').value = cfg.apiKey || '';
    if ($('miya-st-chat-temp')) $('miya-st-chat-temp').value = cfg.temperature != null ? cfg.temperature : 1;
    if ($('miya-st-chat-temp-lbl')) $('miya-st-chat-temp-lbl').textContent = String(cfg.temperature != null ? cfg.temperature : 1);
    fillModelSelect($('miya-st-chat-model'), cfg.model ? [cfg.model] : [], cfg.model);
    if ($('miya-st-chat2-base')) $('miya-st-chat2-base').value = sec.baseUrl || '';
    if ($('miya-st-chat2-key')) $('miya-st-chat2-key').value = sec.apiKey || '';
    if ($('miya-st-chat2-temp')) $('miya-st-chat2-temp').value = sec.temperature != null ? sec.temperature : 1;
    if ($('miya-st-chat2-temp-lbl')) $('miya-st-chat2-temp-lbl').textContent = String(sec.temperature != null ? sec.temperature : 1);
    fillModelSelect($('miya-st-chat2-model'), sec.model ? [sec.model] : [], sec.model);
    var fb = $('miya-st-chat-fallback');
    if (fb) {
      fb.classList.toggle('is-on', !!cfg.fallbackToSecondary);
      fb.setAttribute('aria-checked', cfg.fallbackToSecondary ? 'true' : 'false');
    }
  }

  function syncFormsFromConfig() {
    var cfg = getApiConfig();
    var mm = cfg.minimaxTts && typeof cfg.minimaxTts === 'object' ? cfg.minimaxTts : {};
    var forum = cfg.forumApi && typeof cfg.forumApi === 'object' ? cfg.forumApi : {};
    var cstore = cfg.cstoreApi && typeof cfg.cstoreApi === 'object' ? cfg.cstoreApi : {};
    var chatTemp = cfg.temperature != null ? cfg.temperature : 1;
    syncChatApiPanelForms();
    syncScopedApiForm('forum', forum, chatTemp);
    syncScopedApiForm('cstore', cstore, chatTemp);
    if ($('miya-st-mm-key')) $('miya-st-mm-key').value = mm.apiKey || '';
    if ($('miya-st-mm-group')) $('miya-st-mm-group').value = mm.groupId || '';
    var mmSpeed = mm.speed != null ? Number(mm.speed) : 1;
    if (!Number.isFinite(mmSpeed)) mmSpeed = 1;
    mmSpeed = Math.min(2, Math.max(0.5, mmSpeed));
    if ($('miya-st-mm-speed')) $('miya-st-mm-speed').value = String(mmSpeed);
    if ($('miya-st-mm-speed-lbl')) $('miya-st-mm-speed-lbl').textContent = mmSpeed.toFixed(1);
    if ($('miya-st-mm-prompt')) $('miya-st-mm-prompt').value = mm.ttsPrompt || '';
    fillModelSelect($('miya-st-mm-model'), MINIMAX_MODELS, mm.model);
    syncMainToggles();
  }

  function syncMainToggles() {
    var swN = $('miya-st-sw-notify');
    var swK = $('miya-st-sw-keepalive');
    var swFab = $('miya-st-sw-api-fab');
    if (swN) {
      swN.classList.toggle('is-on', systemPrefs.notify);
      swN.setAttribute('aria-checked', systemPrefs.notify ? 'true' : 'false');
    }
    if (swK) {
      swK.classList.toggle('is-on', systemPrefs.musicKeepAlive);
      swK.setAttribute('aria-checked', systemPrefs.musicKeepAlive ? 'true' : 'false');
    }
    if (swFab) {
      swFab.classList.toggle('is-on', !!systemPrefs.apiFab);
      swFab.setAttribute('aria-checked', systemPrefs.apiFab ? 'true' : 'false');
    }
    syncApiFabSizeControls();
    if (global.miyaUpdateNotice && global.miyaUpdateNotice.syncSettingsToggle) {
      global.miyaUpdateNotice.syncSettingsToggle();
    }
  }

  function escFabText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFabSize() {
    var n = Number(systemPrefs.apiFabSize);
    if (!Number.isFinite(n)) n = FAB_SIZE_DEFAULT;
    return Math.min(FAB_SIZE_MAX, Math.max(FAB_SIZE_MIN, Math.round(n)));
  }

  function syncApiFabSizeControls() {
    var size = getFabSize();
    var range = $('miya-st-api-fab-size');
    var lbl = $('miya-st-api-fab-size-lbl');
    var row = $('miya-st-api-fab-size-row');
    var preview = $('miya-st-api-fab-preview');
    if (range && String(range.value) !== String(size)) range.value = String(size);
    if (lbl) lbl.textContent = String(size);
    if (row) row.hidden = !systemPrefs.apiFab;
    if (preview) {
      preview.style.width = size + 'px';
      preview.style.height = size + 'px';
    }
    document.querySelectorAll('[data-st-fab-size]').forEach(function (chip) {
      var v = Number(chip.getAttribute('data-st-fab-size'));
      chip.classList.toggle('is-active', v === size);
    });
    if (apiFabRoot) {
      var panelRange = apiFabRoot.querySelector('[data-fab-size]');
      var panelLbl = apiFabRoot.querySelector('[data-fab-size-lbl]');
      if (panelRange && String(panelRange.value) !== String(size)) panelRange.value = String(size);
      if (panelLbl) panelLbl.textContent = String(size);
      apiFabRoot.querySelectorAll('[data-fab-size-preset]').forEach(function (chip) {
        var v = Number(chip.getAttribute('data-fab-size-preset'));
        chip.classList.toggle('is-active', v === size);
      });
    }
  }

  function applyApiFabSize() {
    var size = getFabSize();
    systemPrefs.apiFabSize = size;
    if (apiFabRoot) {
      apiFabRoot.style.setProperty('--fab-size', size + 'px');
    }
    syncApiFabSizeControls();
  }

  function setApiFabSize(next, persist) {
    var size = Math.min(FAB_SIZE_MAX, Math.max(FAB_SIZE_MIN, Math.round(Number(next) || FAB_SIZE_DEFAULT)));
    systemPrefs.apiFabSize = size;
    applyApiFabSize();
    applyApiFabPosition();
    if (persist !== false) persistSystemPrefs();
  }

  function clampFabPos(x, y) {
    var size = getFabSize();
    var padY = 8;
    var maxX = Math.max(0, window.innerWidth - size);
    var maxY = Math.max(padY, window.innerHeight - size - padY);
    return {
      x: Math.min(maxX, Math.max(0, x)),
      y: Math.min(maxY, Math.max(padY, y))
    };
  }

  function defaultFabPos() {
    var size = getFabSize();
    return clampFabPos(window.innerWidth - size - 12, window.innerHeight - size - 88);
  }

  function resolveFabDock(x) {
    var size = getFabSize();
    var edge = Math.max(20, Math.round(size * 0.42));
    if (x <= edge) return 'left';
    if (x >= window.innerWidth - size - edge) return 'right';
    return '';
  }

  function applyApiFabDockClass() {
    if (!apiFabRoot) return;
    var dock = systemPrefs.apiFabDock === 'left' || systemPrefs.apiFabDock === 'right'
      ? systemPrefs.apiFabDock
      : '';
    var hide = !!(dock && !apiFabRoot.classList.contains('is-open') && !apiFabRoot.classList.contains('is-dragging'));
    apiFabRoot.classList.toggle('is-dock-left', hide && dock === 'left');
    apiFabRoot.classList.toggle('is-dock-right', hide && dock === 'right');
  }

  function applyApiFabPanelPlacement() {
    if (!apiFabRoot) return;
    var size = getFabSize();
    var x = systemPrefs.apiFabX != null ? systemPrefs.apiFabX : 0;
    var y = systemPrefs.apiFabY != null ? systemPrefs.apiFabY : 0;
    var openLeft = x + size / 2 > window.innerWidth * 0.5 || systemPrefs.apiFabDock === 'right';
    apiFabRoot.classList.toggle('is-side-left', openLeft);
    apiFabRoot.classList.toggle('is-side-right', !openLeft);
    apiFabRoot.classList.remove('is-flip-x', 'is-flip-y');

    var panel = apiFabRoot.querySelector('.miya-api-fab__panel');
    var panelH = panel && panel.offsetHeight > 40
      ? panel.offsetHeight
      : Math.min(420, Math.max(180, window.innerHeight - 24));
    var idealAbsTop = y + size / 2 - Math.min(panelH, window.innerHeight - 24) * 0.38;
    var minAbs = 12;
    var maxAbs = Math.max(minAbs, window.innerHeight - panelH - 12);
    var clampedAbs = Math.min(maxAbs, Math.max(minAbs, idealAbsTop));
    apiFabRoot.style.setProperty('--fab-panel-y', (clampedAbs - y) + 'px');
  }

  function applyApiFabPosition() {
    if (!apiFabRoot) return;
    applyApiFabSize();
    var pos = (systemPrefs.apiFabX != null && systemPrefs.apiFabY != null)
      ? clampFabPos(systemPrefs.apiFabX, systemPrefs.apiFabY)
      : defaultFabPos();
    systemPrefs.apiFabX = pos.x;
    systemPrefs.apiFabY = pos.y;
    if (systemPrefs.apiFabDock === 'left') {
      pos.x = 0;
      systemPrefs.apiFabX = 0;
    } else if (systemPrefs.apiFabDock === 'right') {
      pos.x = Math.max(0, window.innerWidth - getFabSize());
      systemPrefs.apiFabX = pos.x;
    }
    apiFabRoot.style.left = pos.x + 'px';
    apiFabRoot.style.top = pos.y + 'px';
    apiFabRoot.style.right = 'auto';
    apiFabRoot.style.bottom = 'auto';
    applyApiFabPanelPlacement();
    applyApiFabDockClass();
  }

  function closeApiFabPanel() {
    if (apiFabRoot) apiFabRoot.classList.remove('is-open');
    if (apiFabVeil) apiFabVeil.hidden = true;
    var ball = apiFabRoot && apiFabRoot.querySelector('.miya-api-fab__ball');
    if (ball) ball.setAttribute('aria-expanded', 'false');
    applyApiFabDockClass();
  }

  function openApiFabPanel() {
    if (!apiFabRoot || !systemPrefs.apiFab) return;
    applyApiFabPosition();
    refreshApiFabLists();
    syncApiFabSizeControls();
    apiFabRoot.classList.add('is-open');
    apiFabRoot.classList.remove('is-dock-left', 'is-dock-right');
    if (apiFabVeil) apiFabVeil.hidden = false;
    var ball = apiFabRoot.querySelector('.miya-api-fab__ball');
    if (ball) ball.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(function () {
      applyApiFabPanelPlacement();
    });
  }

  function toggleApiFabPanel() {
    if (!apiFabRoot) return;
    if (apiFabRoot.classList.contains('is-open')) closeApiFabPanel();
    else openApiFabPanel();
  }

  function renderFabPresetList(host, list, activeName, kind) {
    if (!host) return;
    var rows = Array.isArray(list) ? list.filter(function (x) { return x && x.name; }) : [];
    if (!rows.length) {
      host.innerHTML = '<p class="miya-api-fab__empty">暂无已存预设</p>';
      return;
    }
    host.innerHTML = rows.map(function (row) {
      var name = String(row.name);
      var active = activeName && activeName === name ? ' is-active' : '';
      return '<button type="button" class="miya-api-fab__item' + active + '" data-fab-kind="' +
        escFabText(kind) + '" data-fab-name="' + escFabText(name) + '">' + escFabText(name) + '</button>';
    }).join('');
  }

  function refreshApiFabLists() {
    if (!apiFabRoot || !systemPrefs.apiFab) return;
    var apiList = apiFabRoot.querySelector('[data-fab-api-list]');
    var igList = apiFabRoot.querySelector('[data-fab-ig-list]');
    ensureApiPresetsReady().then(function (list) {
      renderFabPresetList(apiList, list, systemPrefs.apiFabActivePreset, 'api');
    });
    if (global.MiyaImageGen && typeof global.MiyaImageGen.ensurePresetsReady === 'function') {
      global.MiyaImageGen.ensurePresetsReady().then(function (list) {
        renderFabPresetList(igList, list, systemPrefs.apiFabActiveIgPreset, 'ig');
      }).catch(function () {
        renderFabPresetList(igList, [], systemPrefs.apiFabActiveIgPreset, 'ig');
      });
    } else {
      renderFabPresetList(igList, [], systemPrefs.apiFabActiveIgPreset, 'ig');
    }
  }

  function pickPrimaryChatApiConfig(cfg) {
    cfg = cfg && typeof cfg === 'object' ? cfg : {};
    var temp = cfg.temperature != null ? Number(cfg.temperature) : 1;
    if (!Number.isFinite(temp)) temp = 1;
    return {
      baseUrl: cfg.baseUrl != null ? String(cfg.baseUrl) : '',
      apiKey: cfg.apiKey != null ? String(cfg.apiKey) : '',
      model: cfg.model != null ? String(cfg.model) : '',
      temperature: temp
    };
  }

  function applyApiPresetByName(name) {
    var label = String(name || '').trim();
    if (!label) return Promise.resolve(false);
    return ensureApiPresetsReady().then(function (list) {
      var pr = (list || []).filter(function (x) { return x && x.name === label; })[0];
      if (!pr || !pr.config) {
        toast('未找到该预设');
        return false;
      }
      setApiConfig(pickPrimaryChatApiConfig(pr.config));
      syncChatApiPanelForms();
      var pick = $('miya-st-preset-pick');
      if (pick) pick.value = label;
      var nameInput = $('miya-st-preset-name');
      if (nameInput) nameInput.value = label;
      systemPrefs.apiFabActivePreset = label;
      persistSystemPrefs();
      refreshApiFabLists();
      toast('已切换对话主 API「' + label + '」');
      return true;
    });
  }

  function applyIgPresetByName(name) {
    var label = String(name || '').trim();
    if (!label) return Promise.resolve(false);
    if (!global.MiyaImageGen || typeof global.MiyaImageGen.loadPresetByName !== 'function') {
      toast('生图模块未就绪');
      return Promise.resolve(false);
    }
    return global.MiyaImageGen.loadPresetByName(label).then(function (ok) {
      if (ok) {
        systemPrefs.apiFabActiveIgPreset = label;
        persistSystemPrefs();
        refreshApiFabLists();
      }
      return !!ok;
    });
  }

  function ensureApiFabDom() {
    if (apiFabRoot) return apiFabRoot;
    apiFabVeil = document.createElement('div');
    apiFabVeil.className = 'miya-api-fab__veil';
    apiFabVeil.hidden = true;
    apiFabVeil.addEventListener('click', closeApiFabPanel);

    apiFabRoot = document.createElement('div');
    apiFabRoot.id = 'miya-api-fab';
    apiFabRoot.className = 'miya-api-fab';
    apiFabRoot.hidden = true;
    apiFabRoot.innerHTML =
      '<button type="button" class="miya-api-fab__ball" aria-label="快捷切换预设" aria-expanded="false">' +
        '<span class="miya-api-fab__glow" aria-hidden="true"></span>' +
        '<svg class="miya-api-fab__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
          '<path d="M8 7h11M8 12h11M8 17h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
          '<circle cx="5" cy="7" r="1.35" fill="currentColor"/>' +
          '<circle cx="5" cy="12" r="1.35" fill="currentColor"/>' +
          '<circle cx="5" cy="17" r="1.35" fill="currentColor"/>' +
        '</svg>' +
      '</button>' +
      '<div class="miya-api-fab__panel" role="dialog" aria-label="预设快捷切换">' +
        '<div class="miya-api-fab__head">' +
          '<p class="miya-api-fab__title">快捷切换</p>' +
          '<p class="miya-api-fab__sub">对话主 API · 生图预设</p>' +
        '</div>' +
        '<div class="miya-api-fab__body">' +
          '<section class="miya-api-fab__sec">' +
            '<h4 class="miya-api-fab__sec-title">对话主 API</h4>' +
            '<p class="miya-api-fab__sec-hint">仅切换主线路，不影响副线路/论坛等</p>' +
            '<div class="miya-api-fab__list" data-fab-api-list></div>' +
          '</section>' +
          '<section class="miya-api-fab__sec">' +
            '<h4 class="miya-api-fab__sec-title">生图预设</h4>' +
            '<p class="miya-api-fab__sec-hint">仅切换生图配置</p>' +
            '<div class="miya-api-fab__list" data-fab-ig-list></div>' +
          '</section>' +
        '</div>' +
        '<div class="miya-api-fab__foot">' +
          '<div class="miya-api-fab__size-row">' +
            '<div class="miya-api-fab__size-copy">' +
              '<span class="miya-api-fab__size-title">大小</span>' +
              '<span class="miya-api-fab__size-val"><em data-fab-size-lbl>52</em>px</span>' +
            '</div>' +
            '<div class="miya-api-fab__size-presets" role="group" aria-label="大小预设">' +
              '<button type="button" class="miya-api-fab__chip" data-fab-size-preset="40">小</button>' +
              '<button type="button" class="miya-api-fab__chip" data-fab-size-preset="52">中</button>' +
              '<button type="button" class="miya-api-fab__chip" data-fab-size-preset="64">大</button>' +
            '</div>' +
          '</div>' +
          '<div class="miya-api-fab__size-slider">' +
            '<span class="miya-api-fab__size-edge" aria-hidden="true"></span>' +
            '<input type="range" class="miya-api-fab__size" data-fab-size min="36" max="72" step="2" value="52" aria-label="悬浮球大小">' +
            '<span class="miya-api-fab__size-edge miya-api-fab__size-edge--lg" aria-hidden="true"></span>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(apiFabVeil);
    document.body.appendChild(apiFabRoot);
    applyApiFabSize();

    var ball = apiFabRoot.querySelector('.miya-api-fab__ball');
    if (ball) {
      ball.addEventListener('pointerdown', onApiFabPointerDown);
      ball.addEventListener('click', function (e) {
        if (apiFabDrag && apiFabDrag.moved) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        toggleApiFabPanel();
      });
    }

    var sizeInput = apiFabRoot.querySelector('[data-fab-size]');
    if (sizeInput) {
      sizeInput.addEventListener('input', function () {
        setApiFabSize(sizeInput.value, false);
      });
      sizeInput.addEventListener('change', function () {
        setApiFabSize(sizeInput.value, true);
      });
      sizeInput.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
      });
    }

    apiFabRoot.addEventListener('click', function (e) {
      var presetBtn = e.target && e.target.closest ? e.target.closest('[data-fab-size-preset]') : null;
      if (presetBtn && apiFabRoot.contains(presetBtn)) {
        setApiFabSize(presetBtn.getAttribute('data-fab-size-preset'), true);
        return;
      }
      var btn = e.target && e.target.closest ? e.target.closest('[data-fab-name]') : null;
      if (!btn || !apiFabRoot.contains(btn)) return;
      var kind = btn.getAttribute('data-fab-kind') || 'api';
      var name = btn.getAttribute('data-fab-name') || '';
      if (!name) return;
      var run = kind === 'ig' ? applyIgPresetByName(name) : applyApiPresetByName(name);
      run.then(function (ok) {
        if (ok) closeApiFabPanel();
      });
    });

    window.addEventListener('resize', function () {
      if (!systemPrefs.apiFab) return;
      applyApiFabPosition();
    });

    return apiFabRoot;
  }

  function onApiFabPointerDown(e) {
    if (!apiFabRoot || (e.button != null && e.button !== 0)) return;
    var ball = apiFabRoot.querySelector('.miya-api-fab__ball');
    if (!ball) return;
    var rect = apiFabRoot.getBoundingClientRect();
    var logicalX = systemPrefs.apiFabX != null ? systemPrefs.apiFabX : rect.left;
    var logicalY = systemPrefs.apiFabY != null ? systemPrefs.apiFabY : rect.top;
    if (systemPrefs.apiFabDock === 'left') logicalX = 0;
    else if (systemPrefs.apiFabDock === 'right') logicalX = Math.max(0, window.innerWidth - getFabSize());
    apiFabDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: logicalX,
      origY: logicalY,
      moved: false,
      wasDocked: systemPrefs.apiFabDock === 'left' || systemPrefs.apiFabDock === 'right'
    };
    apiFabRoot.classList.add('is-dragging');
    apiFabRoot.classList.remove('is-dock-left', 'is-dock-right');
    try { ball.setPointerCapture(e.pointerId); } catch (err) {}
    ball.addEventListener('pointermove', onApiFabPointerMove);
    ball.addEventListener('pointerup', onApiFabPointerUp);
    ball.addEventListener('pointercancel', onApiFabPointerUp);
  }

  function onApiFabPointerMove(e) {
    if (!apiFabDrag || e.pointerId !== apiFabDrag.pointerId) return;
    var dx = e.clientX - apiFabDrag.startX;
    var dy = e.clientY - apiFabDrag.startY;
    if (!apiFabDrag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      apiFabDrag.moved = true;
      closeApiFabPanel();
      systemPrefs.apiFabDock = '';
    }
    if (!apiFabDrag.moved) return;
    var pos = clampFabPos(apiFabDrag.origX + dx, apiFabDrag.origY + dy);
    systemPrefs.apiFabX = pos.x;
    systemPrefs.apiFabY = pos.y;
    applyApiFabPosition();
  }

  function onApiFabPointerUp(e) {
    if (!apiFabDrag || e.pointerId !== apiFabDrag.pointerId) return;
    var ball = apiFabRoot && apiFabRoot.querySelector('.miya-api-fab__ball');
    if (ball) {
      try { ball.releasePointerCapture(e.pointerId); } catch (err) {}
      ball.removeEventListener('pointermove', onApiFabPointerMove);
      ball.removeEventListener('pointerup', onApiFabPointerUp);
      ball.removeEventListener('pointercancel', onApiFabPointerUp);
    }
    if (apiFabRoot) apiFabRoot.classList.remove('is-dragging');
    if (apiFabDrag.moved) {
      var dock = resolveFabDock(systemPrefs.apiFabX);
      systemPrefs.apiFabDock = dock;
      if (dock === 'left') systemPrefs.apiFabX = 0;
      else if (dock === 'right') systemPrefs.apiFabX = Math.max(0, window.innerWidth - getFabSize());
      applyApiFabPosition();
      persistSystemPrefs();
    } else if (apiFabDrag.wasDocked) {
      setTimeout(function () {
        if (!apiFabRoot || apiFabRoot.classList.contains('is-open') || apiFabRoot.classList.contains('is-dragging')) return;
        applyApiFabDockClass();
      }, 260);
    } else {
      applyApiFabDockClass();
    }
    setTimeout(function () { apiFabDrag = null; }, 0);
  }

  function syncApiFabVisibility() {
    ensureApiFabDom();
    if (!apiFabRoot) return;
    var on = !!systemPrefs.apiFab;
    apiFabRoot.hidden = !on;
    syncApiFabSizeControls();
    if (!on) {
      closeApiFabPanel();
      return;
    }
    applyApiFabSize();
    applyApiFabPosition();
    refreshApiFabLists();
  }

  function setTopTitle(text) {
    var title = $('miya-st-top-title');
    if (title) title.textContent = text || '设置';
  }

  function ensureApiPresetsReady() {
    if (apiPresetsCache != null) {
      renderApiPresetOptions(apiPresetsCache);
      return Promise.resolve(apiPresetsCache);
    }
    if (apiPresetsReady) return apiPresetsReady;
    apiPresetsReady = loadApiPresetsArr().then(function (list) {
      return commitApiPresetsCache(list);
    }).catch(function () {
      return commitApiPresetsCache([]);
    });
    return apiPresetsReady;
  }

  function primeChatApiPanelPaint() {
    var app = $('miya-settings-app');
    var panel = $('miya-st-panel-chat');
    if (!app || !panel) return;
    app.classList.add('is-priming-chat-panel');
    try {
      panel.classList.add('is-active');
      void panel.offsetHeight;
      void panel.scrollHeight;
    } finally {
      panel.classList.remove('is-active');
      app.classList.remove('is-priming-chat-panel');
      panel.dataset.primed = '1';
    }
  }

  function prepareChatApiPanel() {
    syncChatApiPanelForms();
    if (apiPresetsCache != null) renderApiPresetOptions(apiPresetsCache);
    else ensureApiPresetsReady();
  }

  function openChatApiPanel() {
    prepareChatApiPanel();
    showPanel('miya-st-panel-chat');
  }

  var chatApiPrepareIdle = null;
  function scheduleChatApiPanelPrepare() {
    if (chatApiPrepareIdle != null) return;
    var run = function () {
      chatApiPrepareIdle = null;
      var app = $('miya-settings-app');
      if (!app || !app.classList.contains('is-open') || app.classList.contains('has-panel')) return;
      prepareChatApiPanel();
      primeChatApiPanelPaint();
    };
    if (typeof requestIdleCallback === 'function') chatApiPrepareIdle = requestIdleCallback(run, { timeout: 400 });
    else chatApiPrepareIdle = setTimeout(run, 0);
  }

  function showPanel(panelId) {
    var app = $('miya-settings-app');
    if (!app || panelClosing) return;
    var main = $('miya-st-main');
    if (main) mainListScrollPos = main.scrollTop;
    app.classList.remove('is-panel-returning');
    app.classList.add('has-panel');
    app.querySelectorAll('.ins-vault-panel').forEach(function (p) {
      p.classList.remove('is-active', 'is-leaving');
    });
    var panel = $(panelId);
    if (panel) {
      panel.classList.add('is-active');
      panel.scrollTop = 0;
    }
    setTopTitle(panel ? panel.getAttribute('data-panel-title') || '设置' : '设置');
  }

  function showMainList() {
    var app = $('miya-settings-app');
    if (!app || !app.classList.contains('has-panel') || panelClosing) return;
    var active = app.querySelector('.ins-vault-panel.is-active');
    if (!active) {
      app.classList.remove('has-panel', 'is-panel-returning');
      app.querySelectorAll('.ins-vault-panel').forEach(function (p) {
        p.classList.remove('is-active', 'is-leaving');
      });
      setTopTitle('设置');
      return;
    }
    panelClosing = true;
    active.classList.remove('is-active', 'is-leaving');
    app.classList.remove('has-panel', 'is-panel-returning');
    app.querySelectorAll('.ins-vault-panel').forEach(function (p) {
      p.classList.remove('is-active', 'is-leaving');
    });
    var main = $('miya-st-main');
    if (main) main.scrollTop = mainListScrollPos;
    setTopTitle('设置');
    panelClosing = false;
    if (active && active.id === 'miya-st-panel-chat') scheduleChatApiPanelPrepare();
  }

  function bindSwitch(el, onChange) {
    if (!el) return;
    el.addEventListener('click', function () {
      var on = !el.classList.contains('is-on');
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
      onChange(on);
    });
  }

  function exportYield(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms == null ? 0 : ms); });
  }

  var backupProgressUi = null;

  function ensureBackupProgress() {
    if (backupProgressUi) return backupProgressUi;
    var app = $('miya-settings-app');
    if (!app) return null;
    var root = document.createElement('div');
    root.className = 'st-backup-progress';
    root.id = 'miya-st-backup-progress';
    root.hidden = true;
    root.innerHTML =
      '<div class="st-backup-progress__veil"></div>' +
      '<div class="st-backup-progress__panel">' +
        '<p class="st-backup-progress__title" id="miya-st-backup-progress-title">正在导出</p>' +
        '<p class="st-backup-progress__status" id="miya-st-backup-progress-status">准备中…</p>' +
        '<div class="st-backup-progress__bar"><div class="st-backup-progress__fill" id="miya-st-backup-progress-fill"></div></div>' +
        '<p class="st-backup-progress__pct" id="miya-st-backup-progress-pct">0%</p>' +
      '</div>';
    document.body.appendChild(root);
    backupProgressUi = {
      root: root,
      title: root.querySelector('#miya-st-backup-progress-title'),
      status: root.querySelector('#miya-st-backup-progress-status'),
      fill: root.querySelector('#miya-st-backup-progress-fill'),
      pct: root.querySelector('#miya-st-backup-progress-pct')
    };
    return backupProgressUi;
  }

  function setBackupProgress(pct, status, title) {
    var panel = ensureBackupProgress();
    if (!panel) return;
    panel.root.hidden = false;
    panel.root.classList.add('is-show');
    var p = Math.max(0, Math.min(100, Math.round(pct || 0)));
    if (panel.fill) panel.fill.style.width = p + '%';
    if (panel.pct) panel.pct.textContent = p + '%';
    if (status && panel.status) panel.status.textContent = status;
    if (title && panel.title) panel.title.textContent = title;
  }

  function hideBackupProgress() {
    if (!backupProgressUi) return;
    backupProgressUi.root.classList.remove('is-show');
    backupProgressUi.root.hidden = true;
    if (backupProgressUi.fill) backupProgressUi.fill.style.width = '0%';
    if (backupProgressUi.pct) backupProgressUi.pct.textContent = '0%';
  }

  function collectLocalStorageForBackup() {
    var ls = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        var raw = localStorage.getItem(k);
        if (global.miyaLsIsIdbPlaceholder && global.miyaLsIsIdbPlaceholder(raw)) continue;
        ls[k] = raw;
      }
    } catch (e) {}
    return ls;
  }

  function getBackupIdbSpecs(includeHeavyMedia) {
    var specs = BACKUP_IDB_STORES_BASE.slice();
    if (includeHeavyMedia) specs = specs.concat(BACKUP_IDB_STORES_HEAVY);
    return specs;
  }

  async function exportIdbSpecToBuilder(builder, spec, rangeStart, rangeSize, onRangeProgress) {
    if (spec.blob && global.miyaExportIdbBlobStoreToZipBuilder) {
      var mediaDir = 'media/' + spec.db;
      var index = await global.miyaExportIdbBlobStoreToZipBuilder(
        builder,
        spec.db,
        spec.store,
        mediaDir,
        function (done, total) {
          var sub = total > 0 ? done / total : 0;
          var pct = rangeStart + sub * rangeSize * 0.9;
          var detail = total > 0 ? ' (' + done + '/' + total + ')' : '';
          onRangeProgress(pct, '正在导出' + spec.label + '…' + detail);
        }
      );
      var indexJson = global.miyaSafeJsonStringify ? global.miyaSafeJsonStringify(index) : JSON.stringify(index || {});
      if (indexJson == null) indexJson = '{}';
      var indexBlob = new Blob([indexJson], { type: 'application/json' });
      index = null;
      indexJson = null;
      await builder.addFile(spec.file, indexBlob);
      indexBlob = null;
      onRangeProgress(rangeStart + rangeSize, '已导出' + spec.label);
      await exportYield(30);
      return;
    }
    var jsonBlob = await global.miyaExportIdbStoreToJsonBlob(
      spec.db,
      spec.store,
      null,
      function (done, total) {
        var sub = total > 0 ? done / total : 0;
        var pct = rangeStart + sub * rangeSize;
        var detail = total > 0 ? ' (' + done + '/' + total + ')' : '';
        onRangeProgress(pct, '正在导出' + spec.label + '…' + detail);
      }
    );
    await builder.addFile(spec.file, jsonBlob);
    jsonBlob = null;
    await exportYield(30);
  }

  function makeZipMediaResolver(zipLike) {
    return function (mediaPath) {
      var entry = zipLike.file(String(mediaPath || ''));
      if (!entry) return Promise.resolve(null);
      try {
        var ret = entry.async('blob');
        if (ret && typeof ret.then === 'function') {
          return ret.then(function (b) { return b || null; }).catch(function () { return null; });
        }
        return Promise.resolve(ret || null);
      } catch (e) {
        return Promise.resolve(null);
      }
    };
  }

  async function importIdbJsonFile(data, spec, resolveMedia, onProgress, opts) {
    if (!data || typeof data !== 'object' || !Object.keys(data).length) return;
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    opts = opts || {};
    if (spec.blob) {
      if (global.miyaImportNamedDbBlobsSequential) {
        await global.miyaImportNamedDbBlobsSequential(
          spec.db,
          spec.store,
          data,
          resolveMedia,
          function (done, total) {
            var detail = total > 0 ? ' (' + done + '/' + total + ')' : '';
            var sub = total > 0 ? done / total : 1;
            onProgress('正在恢复' + spec.label + '…' + detail, sub);
          },
          { append: !!opts.append }
        );
      } else if (spec.file === 'idb/miya-theme-media_blobs.json' && global.miyaImportThemeMediaDb) {
        await global.miyaImportThemeMediaDb(data);
      } else if (spec.file === 'idb/miya-chat-media_blobs.json' && global.miyaImportChatMediaDb) {
        await global.miyaImportChatMediaDb(data);
      } else if (global.miyaImportNamedDbBlobs) {
        await global.miyaImportNamedDbBlobs(spec.db, spec.store, data);
      }
      return;
    }
    if (global.miyaKvReplaceNamedDbKv) {
      await global.miyaKvReplaceNamedDbKv(spec.db, spec.store, data);
    }
  }

  async function downloadBackupBlob(blob, fname) {
    var mb = blob && blob.size ? (blob.size / (1024 * 1024)).toFixed(1) : '';
    setBackupProgress(96, mb
      ? ('正在下载单个 ZIP（约 ' + mb + ' MB）…')
      : '正在触发下载…');
    var ok = false;
    if (global.miyaDownloadBlobAsync) {
      ok = await global.miyaDownloadBlobAsync(blob, fname);
    } else if (global.miyaDownloadBlob) {
      ok = global.miyaDownloadBlob(blob, fname);
    }
    return !!ok;
  }

  function backupStamp(iso) {
    return String(iso || new Date().toISOString()).slice(0, 19).replace(/[:T]/g, '-');
  }

  function finishBackupImport() {
    global.miyaInvalidateApiConfigCache();
    invalidateApiPresetsCache();
    if (global.MiyaImageGen && global.MiyaImageGen.invalidatePresetsCache) {
      global.MiyaImageGen.invalidatePresetsCache();
    }
    if (global.miyaWorldbookStore && typeof global.miyaWorldbookStore.invalidateCache === 'function') {
      global.miyaWorldbookStore.invalidateCache();
    }
    if (global.miyaChatStore && typeof global.miyaChatStore.invalidateCache === 'function') {
      global.miyaChatStore.invalidateCache();
    }
    if (global.miyaContactsStore && typeof global.miyaContactsStore.invalidateCache === 'function') {
      global.miyaContactsStore.invalidateCache();
    }
    if (global.miyaContactsRelationshipStore && typeof global.miyaContactsRelationshipStore.invalidateCache === 'function') {
      global.miyaContactsRelationshipStore.invalidateCache();
    }
    if (global.MiyaSimulatorStore && typeof global.MiyaSimulatorStore.invalidateCache === 'function') {
      global.MiyaSimulatorStore.invalidateCache();
    }
    if (global.miyaForumStore && typeof global.miyaForumStore.invalidateCache === 'function') {
      global.miyaForumStore.invalidateCache();
    }
    if (global.miyaTypewriterStore && typeof global.miyaTypewriterStore.invalidateCache === 'function') {
      global.miyaTypewriterStore.invalidateCache();
    }
    if (global.miyaTypewriterSettings && typeof global.miyaTypewriterSettings.invalidateCache === 'function') {
      global.miyaTypewriterSettings.invalidateCache();
    }
    if (global.miyaTypewriterReadTogetherStore && typeof global.miyaTypewriterReadTogetherStore.invalidateCache === 'function') {
      global.miyaTypewriterReadTogetherStore.invalidateCache();
    }
    if (global.miyaMusicEngine && typeof global.miyaMusicEngine.invalidateCache === 'function') {
      global.miyaMusicEngine.invalidateCache();
    }
    if (global.MiyaMusicListenTogether && typeof global.MiyaMusicListenTogether.invalidateCache === 'function') {
      global.MiyaMusicListenTogether.invalidateCache();
    }
    if (global.miyaDiaryStore && typeof global.miyaDiaryStore.invalidateCache === 'function') {
      global.miyaDiaryStore.invalidateCache();
    }
    if (global.MiyaMsgSound && typeof global.MiyaMsgSound.invalidateCache === 'function') {
      global.MiyaMsgSound.invalidateCache();
    }
    if (global.miyaWeatherStore && typeof global.miyaWeatherStore.invalidateCache === 'function') {
      global.miyaWeatherStore.invalidateCache();
    }
    if (global.miyaCoupleStore && typeof global.miyaCoupleStore.invalidateCache === 'function') {
      global.miyaCoupleStore.invalidateCache();
    }
    if (global.miyaCoupleWhisperStore && typeof global.miyaCoupleWhisperStore.invalidateCache === 'function') {
      global.miyaCoupleWhisperStore.invalidateCache();
    }
    if (global.miyaTheaterStore && typeof global.miyaTheaterStore.invalidateCache === 'function') {
      global.miyaTheaterStore.invalidateCache();
    }
    if (global.miyaItineraryStore && typeof global.miyaItineraryStore.invalidateCache === 'function') {
      global.miyaItineraryStore.invalidateCache();
    }
    if (global.MiyaAppointmentStore && typeof global.MiyaAppointmentStore.invalidateCache === 'function') {
      global.MiyaAppointmentStore.invalidateCache();
    }
    if (global.miyaMatchStore && typeof global.miyaMatchStore.invalidateCache === 'function') {
      global.miyaMatchStore.invalidateCache();
    }
    if (global.MiyaChatAlbum && typeof global.MiyaChatAlbum.invalidateCache === 'function') {
      global.MiyaChatAlbum.invalidateCache();
    }
    loadSystemPrefs();
    syncFormsFromConfig();
    ensureApiPresetsReady();
    if (typeof global.miyaHydrateTheme === 'function') {
      global.miyaHydrateTheme().catch(function () {});
    }
  }

  /**
   * 单个 ZIP 导出：OPFS 落盘（Safari 走 Worker sync handle），最终仍是一个文件。
   * 禁止为完整导出回退内存打包——那会在最后一步把几百 MB 塞进 RAM 闪退。
   */
  async function runExportBackup(opts) {
    opts = opts || {};
    var includeHeavyMedia = !!opts.includeHeavyMedia;
    if (typeof global.miyaZipCreateStoreWriter !== 'function' &&
        typeof global.miyaZipCreateStoreBuilder !== 'function') {
      toast('压缩组件未加载，请刷新页面后重试');
      return;
    }
    var title = includeHeavyMedia ? '完整导出' : '轻量导出';
    setBackupProgress(0, '准备导出…', title);
    var writer = null;
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        try { await navigator.storage.persist(); } catch (ePersist) {}
      }

      var exportedAt = new Date().toISOString();
      var stamp = backupStamp(exportedAt);
      var suffix = includeHeavyMedia ? 'full' : 'lite';
      var fname = 'miya-backup-' + suffix + '-' + stamp + '.zip';
      var idbSpecs = getBackupIdbSpecs(includeHeavyMedia);
      var idbRange = 78;
      var idbEach = idbSpecs.length ? idbRange / idbSpecs.length : idbRange;

      setBackupProgress(1, '正在打开磁盘写入…');
      if (typeof global.miyaZipCreateStoreWriter === 'function') {
        writer = await global.miyaZipCreateStoreWriter({
          fileName: fname,
          requireOpfs: !!includeHeavyMedia
        });
      } else {
        writer = global.miyaZipCreateStoreBuilder();
      }
      if (includeHeavyMedia && writer.backend === 'memory') {
        throw new Error('当前浏览器无法落盘写大文件，请用 Safari 打开本站后重试完整导出');
      }
      var backendHint = writer.backend && writer.backend.indexOf('opfs') === 0
        ? '（已落盘，可导出数百 MB）'
        : '';

      setBackupProgress(2, '正在收集本地设置…' + backendHint);
      var ls = collectLocalStorageForBackup();
      var lsBlob = new Blob([JSON.stringify(ls)], { type: 'application/json' });
      ls = null;
      await writer.addFile('localStorage.json', lsBlob);
      lsBlob = null;
      await exportYield(20);

      setBackupProgress(5, '正在导出扩展数据…');
      var kvBlob;
      if (global.miyaKvIdbExportToJsonBlob) {
        kvBlob = await global.miyaKvIdbExportToJsonBlob(function (done, total) {
          var sub = total > 0 ? done / total : 0;
          setBackupProgress(5 + sub * 4, '正在导出扩展数据…' + (total ? ' (' + done + '/' + total + ')' : ''));
        });
      } else {
        var kv = await global.miyaKvIdbExportAllEntries().catch(function () { return {}; });
        var kvJson = global.miyaSafeJsonStringify ? global.miyaSafeJsonStringify(kv) : JSON.stringify(kv);
        if (kvJson == null) throw new Error('stringify_failed');
        kvBlob = new Blob([kvJson], { type: 'application/json' });
        kv = null;
        kvJson = null;
      }
      await writer.addFile('indexedDB_kv.json', kvBlob);
      kvBlob = null;
      await exportYield(20);

      for (var i = 0; i < idbSpecs.length; i++) {
        await exportIdbSpecToBuilder(
          writer,
          idbSpecs[i],
          10 + i * idbEach,
          idbEach,
          function (pct, status) { setBackupProgress(pct, status); }
        );
        await exportYield(30);
      }

      var manifest = {
        v: BACKUP_VERSION,
        app: 'miya-mini-phone',
        format: 'zip',
        mediaLayout: 'bin',
        zipMethod: 'store',
        zipBackend: writer.backend || 'memory',
        exportedAt: exportedAt,
        includeHeavyMedia: includeHeavyMedia,
        files: ['manifest.json', 'localStorage.json', 'indexedDB_kv.json'].concat(
          idbSpecs.map(function (s) { return s.file; })
        )
      };
      await writer.addFile('manifest.json', new Blob([JSON.stringify(manifest)], { type: 'application/json' }));

      setBackupProgress(92, '正在封包…');
      await exportYield(40);
      var blob = await writer.finish();
      await exportYield(40);

      var mb = blob && blob.size ? (blob.size / (1024 * 1024)).toFixed(1) : '?';
      setBackupProgress(96, '正在保存单个 ZIP（约 ' + mb + ' MB）…');
      var ok = await downloadBackupBlob(blob, fname);
      await exportYield(Math.min(120000, Math.max(8000, Math.floor((blob && blob.size ? blob.size : 0) / (512 * 1024)))));
      blob = null;
      if (writer && typeof writer.cleanup === 'function') {
        await writer.cleanup().catch(function () {});
      }
      writer = null;
      hideBackupProgress();
      if (!ok) {
        toast('未保存成功：请允许下载，或到 Safari 下载列表里查看');
        return;
      }
      toast(includeHeavyMedia ? '完整 ZIP 已开始下载（单个文件）' : '轻量 ZIP 已导出');
    } catch (e) {
      if (writer && typeof writer.cleanup === 'function') {
        try { await writer.cleanup(); } catch (e0) {}
      }
      writer = null;
      hideBackupProgress();
      var msg = e && e.message ? String(e.message) : '';
      toast(msg && msg !== 'stringify_failed'
        ? ('导出失败：' + msg)
        : '导出失败：请用 Safari 打开后重试');
    }
  }

  function exportBackup() {
    runExportBackup({ includeHeavyMedia: false });
  }

  function exportBackupFull() {
    runExportBackup({ includeHeavyMedia: true });
  }

  function parseBackupJsonText(text) {
    try {
      return JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    } catch (e) {
      return null;
    }
  }

  function applyBackupLocalStorage(ls) {
    try { localStorage.clear(); } catch (e0) {}
    Object.keys(ls || {}).forEach(function (k) {
      try { localStorage.setItem(k, ls[k] == null ? '' : String(ls[k])); } catch (e1) {}
    });
  }

  async function restoreBackupPayload(raw, onProgress) {
    onProgress = typeof onProgress === 'function' ? onProgress : function () {};
    var ls = raw.localStorage || raw.ls;
    if (!ls || typeof ls !== 'object') throw new Error('invalid_localStorage');

    onProgress(8, '正在导入扩展数据…');
    var kv = raw.indexedDB_kv || raw.indexedDbKv || {};
    await global.miyaKvIdbReplaceAllEntries(kv);

    var idbSpecs = getBackupIdbSpecs(true);
    var legacyMap = {
      'idb/miya-theme-media_blobs.json': raw.indexedDB_miya_theme_media,
      'idb/miya-deep-phone-v1_phones.json': raw.indexedDB_miya_deep_phone,
      'idb/miya-chat-media_blobs.json': raw.indexedDB_miya_chat_media,
      'idb/miya-music-local-audio-v1_blobs.json': raw.indexedDB_miya_music_local_audio,
      'idb/miya-msg-sound-v1_blobs.json': raw.indexedDB_miya_msg_sound
    };
    var idbRange = 72;
    var idbEach = idbSpecs.length ? idbRange / idbSpecs.length : idbRange;

    for (var i = 0; i < idbSpecs.length; i++) {
      var spec = idbSpecs[i];
      var data = legacyMap[spec.file];
      if (!data) continue;
      onProgress(12 + i * idbEach, '正在恢复' + spec.label + '…');
      await importIdbJsonFile(data, spec, null, function (status) {
        onProgress(12 + i * idbEach, status);
      });
      await exportYield();
    }

    onProgress(88, '正在写入本地设置…');
    applyBackupLocalStorage(ls);
    finishBackupImport();
    onProgress(100, '导入完成');
  }

  function findSpecByMediaPart(manifest) {
    var all = BACKUP_IDB_STORES_BASE.concat(BACKUP_IDB_STORES_HEAVY);
    if (manifest && manifest.mediaFile) {
      for (var i = 0; i < all.length; i++) {
        if (all[i].file === manifest.mediaFile) return all[i];
      }
    }
    if (manifest && manifest.mediaDb) {
      for (var j = 0; j < all.length; j++) {
        if (all[j].db === manifest.mediaDb) return all[j];
      }
    }
    return null;
  }

  async function openBackupZip(file) {
    /* 优先低内存 STORE 读取；旧 DEFLATE 包再回退 JSZip */
    if (typeof global.miyaZipOpenFromBlob === 'function') {
      try {
        var storeZip = await global.miyaZipOpenFromBlob(file);
        if (storeZip && !storeZip.needsJszip) return storeZip;
      } catch (eStore) {}
    }
    if (!global.JSZip) throw new Error('jszip_missing');
    return global.JSZip.loadAsync(file);
  }

  async function importOneBackupZip(file) {
    var zip = await openBackupZip(file);
    var manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) throw new Error('missing_manifest');
    var manifest = parseBackupJsonText(await manifestEntry.async('string'));
    if (!manifest || manifest.app !== 'miya-mini-phone') throw new Error('invalid_manifest');

    var part = String(manifest.part || '');
    var isMediaPart = part.indexOf('media:') === 0;
    var resolveMedia = makeZipMediaResolver(zip);

    if (isMediaPart) {
      var mediaSpec = findSpecByMediaPart(manifest);
      if (!mediaSpec) throw new Error('unknown_media_part');
      var mediaEntry = zip.file(mediaSpec.file);
      if (!mediaEntry) throw new Error('missing_media_index');
      setBackupProgress(20, '正在恢复' + (mediaSpec.label || mediaSpec.db) + '…');
      var mediaData = parseBackupJsonText(await mediaEntry.async('string'));
      var append = !!(manifest.mediaChunkAppend || (manifest.mediaChunk > 0));
      await importIdbJsonFile(mediaData, mediaSpec, resolveMedia, function (status) {
        setBackupProgress(40, status);
      }, { append: append });
      return { manifest: manifest, kind: 'media' };
    }

    var lsEntry = zip.file('localStorage.json');
    if (!lsEntry) throw new Error('missing_localStorage');
    var ls = parseBackupJsonText(await lsEntry.async('string'));
    if (!ls || typeof ls !== 'object') throw new Error('invalid_localStorage');

    setBackupProgress(3, '正在读取扩展数据…');
    var kvEntry = zip.file('indexedDB_kv.json');
    var kv = {};
    if (kvEntry) {
      var kvText = await kvEntry.async('string');
      setBackupProgress(5, '正在解析扩展数据…');
      kv = parseBackupJsonText(kvText) || {};
      kvText = null;
    }
    setBackupProgress(6, '正在写入扩展数据…');
    await global.miyaKvIdbReplaceAllEntries(kv && typeof kv === 'object' ? kv : {}, function (done, total) {
      var sub = total > 0 ? done / total : 1;
      setBackupProgress(6 + sub * 6, '正在写入扩展数据…' + (total ? ' (' + done + '/' + total + ')' : ''));
    });
    kv = null;

    var idbSpecs = getBackupIdbSpecs(!!manifest.includeHeavyMedia);
    if (!manifest.includeHeavyMedia) {
      idbSpecs = BACKUP_IDB_STORES_BASE.slice();
    }
    var idbRange = 72;
    var idbEach = idbSpecs.length ? idbRange / idbSpecs.length : idbRange;
    for (var i = 0; i < idbSpecs.length; i++) {
      var spec = idbSpecs[i];
      var entry = zip.file(spec.file);
      if (!entry) continue;
      var rangeStart = 14 + i * idbEach;
      setBackupProgress(rangeStart, '正在读取' + spec.label + '索引…');
      var dataText = await entry.async('string');
      var data = parseBackupJsonText(dataText);
      dataText = null;
      var keyCount = data && typeof data === 'object' ? Object.keys(data).length : 0;
      setBackupProgress(rangeStart, '正在恢复' + spec.label + '…' + (keyCount ? ' (0/' + keyCount + ')' : ''));
      await importIdbJsonFile(data, spec, resolveMedia, function (status, sub) {
        var pct = rangeStart + (typeof sub === 'number' ? sub : 0) * idbEach * 0.95;
        setBackupProgress(pct, status);
      });
      data = null;
      await exportYield();
    }

    setBackupProgress(88, '正在写入本地设置…');
    applyBackupLocalStorage(ls);
    finishBackupImport();
    return { manifest: manifest, kind: 'full' };
  }

  async function importBackupZipFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(Boolean);
    if (!list.length) return;
    if (!global.JSZip && typeof global.miyaZipOpenFromBlob !== 'function') {
      toast('压缩库未加载，请刷新页面后重试');
      return;
    }

    var ok = await dialog({
      mode: 'confirm',
      title: '导入数据包',
      message: list.length > 1
        ? ('将导入 ' + list.length + ' 个备份文件并覆盖当前数据，是否继续？')
        : '将覆盖当前全部本地数据，是否继续？',
      confirmText: '继续导入',
      cancelText: '取消'
    });
    if (!ok) return;

    setBackupProgress(0, '正在读取 ZIP…', '导入数据');
    try {
      if (list.length === 1) {
        await importOneBackupZip(list[0]);
      } else {
        /* 兼容此前误导出的多分卷：按 partIndex 顺序合并导入 */
        var prepared = [];
        for (var fi = 0; fi < list.length; fi++) {
          setBackupProgress((fi / list.length) * 8, '解析文件 ' + (fi + 1) + '/' + list.length + '…');
          var z = await openBackupZip(list[fi]);
          var me = z.file('manifest.json');
          var man = me ? parseBackupJsonText(await me.async('string')) : null;
          if (!man || man.app !== 'miya-mini-phone') throw new Error('invalid_manifest');
          prepared.push({
            file: list[fi],
            manifest: man,
            partIndex: man.partIndex || (String(man.part || '').indexOf('media:') === 0 ? 99 : 1)
          });
          z = null;
          await exportYield();
        }
        prepared.sort(function (a, b) {
          var pa = a.partIndex || 0;
          var pb = b.partIndex || 0;
          if (pa !== pb) return pa - pb;
          return (a.manifest.mediaChunk || 0) - (b.manifest.mediaChunk || 0);
        });
        for (var pi = 0; pi < prepared.length; pi++) {
          setBackupProgress(8 + (pi / prepared.length) * 88, '导入 ' + (pi + 1) + '/' + prepared.length + '…');
          await importOneBackupZip(prepared[pi].file);
          await exportYield(40);
        }
      }

      hideBackupProgress();
      toast('ZIP 数据包已导入');
      dialog({
        mode: 'confirm',
        title: '导入完成',
        message: '建议刷新页面以加载全部模块。',
        confirmText: '刷新',
        cancelText: '稍后'
      }).then(function (reload) { if (reload) location.reload(); });
    } catch (e) {
      hideBackupProgress();
      toast('导入失败：' + (e && e.message ? e.message : '未知'));
    }
  }

  async function importBackupZip(file) {
    if (!file) return;
    return importBackupZipFiles([file]);
  }

  function importBackupJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var raw = parseBackupJsonText(reader.result);
      if (!raw) {
        toast('无效的数据包文件');
        return;
      }
      var ls = raw.localStorage || raw.ls;
      if (!ls || typeof ls !== 'object') {
        toast('数据包格式无效');
        return;
      }
      dialog({
        mode: 'confirm',
        title: '导入数据包',
        message: '将覆盖当前全部本地数据，是否继续？',
        confirmText: '继续导入',
        cancelText: '取消'
      }).then(function (ok) {
        if (!ok) return;
        setBackupProgress(0, '正在导入 JSON…', '导入数据');
        restoreBackupPayload(raw, function (pct, status) {
          setBackupProgress(pct, status);
        }).then(function () {
          hideBackupProgress();
          toast('数据包已导入');
          dialog({
            mode: 'confirm',
            title: '导入完成',
            message: '建议刷新页面以加载全部模块。',
            confirmText: '刷新',
            cancelText: '稍后'
          }).then(function (reload) { if (reload) location.reload(); });
        }).catch(function (err) {
          hideBackupProgress();
          toast('导入失败：' + (err && err.message ? err.message : '未知'));
        });
      });
    };
    reader.readAsText(file, 'utf-8');
  }

  function importBackup(fileOrFiles) {
    var files = null;
    if (fileOrFiles && fileOrFiles.length != null && typeof fileOrFiles !== 'string') {
      files = Array.prototype.slice.call(fileOrFiles);
    } else if (fileOrFiles) {
      files = [fileOrFiles];
    }
    if (!files || !files.length) return;

    var zips = [];
    var jsons = [];
    files.forEach(function (f) {
      var name = String(f.name || '').toLowerCase();
      var type = String(f.type || '').toLowerCase();
      if (name.slice(-4) === '.zip' || type.indexOf('zip') >= 0) zips.push(f);
      else jsons.push(f);
    });

    if (zips.length) {
      importBackupZipFiles(zips);
      return;
    }
    if (jsons.length) {
      importBackupJson(jsons[0]);
    }
  }

  function onClick(id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', fn);
  }

  function bindSettingsEvents() {
    var app = $('miya-settings-app');
    if (!app || app.dataset.bound) return;
    app.dataset.bound = '1';

    onClick('miya-st-back', function () {
      if (app.classList.contains('has-panel')) showMainList();
      else closeSettingsApp();
    });

    onClick('miya-st-header-back', function () {
      if (app.classList.contains('has-panel')) showMainList();
      else closeSettingsApp();
    });

    onClick('miya-st-panel-header-back', function () {
      showMainList();
    });

    onClick('miya-st-clear-chat-app-beautify', function () {
      dialog({
        mode: 'confirm',
        title: '清除聊天 App 美化',
        message: '将恢复默认橙主题，并清除当前自定义 CSS 与装饰。预设库不受影响，是否继续？',
        confirmText: '清除',
        cancelText: '取消'
      }).then(function (ok) {
        if (!ok) return;
        var mod = global.MiyaChatAppBeautify;
        if (!mod || typeof mod.clearCustomBeautify !== 'function') {
          toast('美化模块未加载，请刷新页面');
          return;
        }
        try {
          mod.clearCustomBeautify();
          toast('已清除聊天 App 美化');
        } catch (err) {
          toast('清除失败');
        }
      });
    });

    app.querySelectorAll('[data-st-nav]').forEach(function (row) {
      row.addEventListener('click', function () {
        var target = row.getAttribute('data-st-nav');
        if (target === 'export') { exportBackup(); return; }
        if (target === 'export-full') { exportBackupFull(); return; }
        if (target === 'import') { $('miya-st-backup-file').click(); return; }
        if (target === 'miya-st-panel-chat') {
          openChatApiPanel();
          return;
        }
        showPanel(target);
        if (target === 'miya-st-panel-storage') {
          requestAnimationFrame(renderStoragePanel);
        }
        if (target === 'miya-st-panel-contact-chat' && global.miyaChatSettingsPanel) {
          global.miyaChatSettingsPanel.onPanelOpen();
        }
        if (target === 'miya-st-panel-msg-sound' && global.MiyaMsgSound) {
          global.MiyaMsgSound.onPanelOpen();
        }
        if (target === 'miya-st-panel-imagegen' && global.MiyaImageGen) {
          global.MiyaImageGen.onSettingsPanelOpen();
        }
        if (target === 'miya-st-panel-operation-rules' && global.MiyaChatOperationRules) {
          global.MiyaChatOperationRules.onSettingsPanelOpen();
        }
        if (target === 'miya-st-panel-thinking-rules' && global.MiyaChatThinkingRules) {
          global.MiyaChatThinkingRules.onSettingsPanelOpen();
        }
        if (target === 'miya-st-panel-updates' && global.miyaUpdateNotice) {
          global.miyaUpdateNotice.renderHistoryPanel();
        }
      });
    });

    bindSwitch($('miya-st-sw-update-remind'), function (on) {
      if (global.miyaUpdateNotice && global.miyaUpdateNotice.setReminderEnabled) {
        global.miyaUpdateNotice.setReminderEnabled(on);
        toast(on ? '更新提醒已开启' : '更新提醒已关闭');
      }
    });

    bindSwitch($('miya-st-sw-notify'), function (on) {
      if (!getNotificationApi()) {
        toast('当前环境不支持通知');
        syncMainToggles();
        return;
      }
      if (on) {
        requestNotificationPermission().then(function (perm) {
          systemPrefs.notify = perm === 'granted';
          persistSystemPrefs();
          syncMainToggles();
          toast(systemPrefs.notify ? '通知已开启' : (perm === 'denied' ? '通知权限被拒绝' : '需要通知权限'));
        });
      } else {
        systemPrefs.notify = false;
        persistSystemPrefs();
      }
    });

    bindSwitch($('miya-st-sw-keepalive'), function (on) {
      if (on) {
        systemPrefs.musicKeepAlive = true;
        persistSystemPrefs();
        startKeepAliveMusic();
        toast('后台保活已开启（静音单曲八小时，非30秒循环）');
      } else {
        disableKeepAliveCompletely();
        toast('已关闭保活');
      }
    });

    bindSwitch($('miya-st-sw-api-fab'), function (on) {
      systemPrefs.apiFab = on;
      persistSystemPrefs();
      syncApiFabVisibility();
      syncApiFabSizeControls();
      toast(on ? 'API 悬浮球已开启' : 'API 悬浮球已关闭');
    });

    var fabSizeRange = $('miya-st-api-fab-size');
    if (fabSizeRange) {
      fabSizeRange.addEventListener('input', function () {
        setApiFabSize(fabSizeRange.value, false);
      });
      fabSizeRange.addEventListener('change', function () {
        setApiFabSize(fabSizeRange.value, true);
      });
    }

    var fabSizeWrap = $('miya-st-api-fab-size-row');
    if (fabSizeWrap) {
      fabSizeWrap.addEventListener('click', function (e) {
        var chip = e.target && e.target.closest ? e.target.closest('[data-st-fab-size]') : null;
        if (!chip) return;
        setApiFabSize(chip.getAttribute('data-st-fab-size'), true);
      });
    }

    var notifyTestBtn = $('miya-st-notify-test');
    if (notifyTestBtn) {
      notifyTestBtn.addEventListener('click', function () {
        if (!getNotificationApi()) {
          toast('当前环境不支持通知');
          return;
        }
        var perm = getNotificationPermission();
        if (perm === 'denied') {
          toast('通知权限被拒绝，请在浏览器设置中允许');
          return;
        }
        function fireTest() {
          var iconEl = document.querySelector('link[rel="icon"]');
          showSystemNotification('miya小手机', {
            body: '这是一条测试通知。',
            tag: 'miya-notify-test-' + String(Date.now()),
            icon: iconEl ? iconEl.href : undefined,
            data: { kind: 'test' }
          }).then(function (n) {
            if (n) {
              if (!n._viaSw) {
                n.onclick = function () {
                  try { window.focus(); } catch (e) {}
                  n.close();
                };
              }
              toast('测试通知已发送');
              pushNotifyPreview('测试提醒', '你的通知系统运行正常');
            } else {
              toast('发送失败，请确认已开启通知权限');
            }
          });
        }
        if (perm === 'granted') {
          fireTest();
          return;
        }
        requestNotificationPermission().then(function (nextPerm) {
          if (nextPerm === 'granted') {
            systemPrefs.notify = true;
            persistSystemPrefs();
            syncMainToggles();
            fireTest();
          } else {
            toast(nextPerm === 'denied' ? '通知权限被拒绝' : '需要允许通知权限');
          }
        });
      });
    }

    bindSwitch($('miya-st-chat-fallback'), function () {});

    var tempIn = $('miya-st-chat-temp');
    var tempLbl = $('miya-st-chat-temp-lbl');
    if (tempIn) {
      tempIn.addEventListener('input', function () {
        if (tempLbl) tempLbl.textContent = tempIn.value;
      });
    }

    var temp2In = $('miya-st-chat2-temp');
    var temp2Lbl = $('miya-st-chat2-temp-lbl');
    if (temp2In) {
      temp2In.addEventListener('input', function () {
        if (temp2Lbl) temp2Lbl.textContent = temp2In.value;
      });
    }

    ['forum', 'cstore'].forEach(function (prefix) {
      var tempIn = $('miya-st-' + prefix + '-temp');
      var tempLbl = $('miya-st-' + prefix + '-temp-lbl');
      if (tempIn) {
        tempIn.addEventListener('input', function () {
          if (tempLbl) tempLbl.textContent = tempIn.value;
        });
      }
    });

    function bindScopedFetch(prefix, emptyMsg) {
      var btn = $('miya-st-' + prefix + '-fetch');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var baseEl = $('miya-st-' + prefix + '-base');
        var keyEl = $('miya-st-' + prefix + '-key');
        var chatBaseEl = $('miya-st-chat-base');
        var chatKeyEl = $('miya-st-chat-key');
        var b = baseEl && baseEl.value ? baseEl.value.trim() : '';
        var k = keyEl && keyEl.value ? keyEl.value.trim() : '';
        if (!b) b = chatBaseEl && chatBaseEl.value ? chatBaseEl.value.trim() : '';
        if (!k) k = chatKeyEl && chatKeyEl.value ? chatKeyEl.value.trim() : '';
        if (!b || !k) { toast(emptyMsg); return; }
        fetchOpenAiModels(b, k).then(function (ids) {
          fillModelSelect($('miya-st-' + prefix + '-model'), ids, ($('miya-st-' + prefix + '-model') || {}).value);
          toast('已载入 ' + ids.length + ' 个模型');
        }).catch(function () { toast('连接失败'); });
      });
    }

    bindScopedFetch('forum', '请填写论坛 API 或对话 API 的地址与密钥');
    bindScopedFetch('cstore', '请填写便利店 API 或对话 API 的地址与密钥');

    var mmSpeedIn = $('miya-st-mm-speed');
    var mmSpeedLbl = $('miya-st-mm-speed-lbl');
    if (mmSpeedIn) {
      mmSpeedIn.addEventListener('input', function () {
        if (mmSpeedLbl) mmSpeedLbl.textContent = parseFloat(mmSpeedIn.value).toFixed(1);
      });
    }

    onClick('miya-st-chat-fetch', function () {
      var b = $('miya-st-chat-base').value.trim();
      var k = $('miya-st-chat-key').value.trim();
      if (!b || !k) { toast('请填写地址与密钥'); return; }
      fetchOpenAiModels(b, k).then(function (ids) {
        fillModelSelect($('miya-st-chat-model'), ids, $('miya-st-chat-model').value);
        toast('已载入 ' + ids.length + ' 个模型');
      }).catch(function () { toast('连接失败'); });
    });

    onClick('miya-st-chat2-fetch', function () {
      var b = $('miya-st-chat2-base').value.trim();
      var k = $('miya-st-chat2-key').value.trim();
      if (!b || !k) { toast('请填写副 API 地址与密钥'); return; }
      fetchOpenAiModels(b, k).then(function (ids) {
        fillModelSelect($('miya-st-chat2-model'), ids, $('miya-st-chat2-model').value);
        toast('已载入 ' + ids.length + ' 个模型');
      }).catch(function () { toast('连接失败'); });
    });

    onClick('miya-st-chat-save', function () {
      setApiConfig(Object.assign({}, getApiConfig(), readChatApiSavePayload()));
      toast('已保存');
    });

    var forumSaveBtn = $('miya-st-forum-save');
    if (forumSaveBtn) {
      forumSaveBtn.addEventListener('click', function () {
        setApiConfig(Object.assign({}, getApiConfig(), readForumApiForm()));
        toast('已保存论坛 API');
      });
    }

    var cstoreSaveBtn = $('miya-st-cstore-save');
    if (cstoreSaveBtn) {
      cstoreSaveBtn.addEventListener('click', function () {
        setApiConfig(Object.assign({}, getApiConfig(), readCstoreApiForm()));
        toast('已保存便利店 API');
      });
    }

    onClick('miya-st-mm-save', function () {
      var prev = getApiConfig();
      var prevMm = prev.minimaxTts && typeof prev.minimaxTts === 'object' ? prev.minimaxTts : {};
      setApiConfig(Object.assign({}, prev, { minimaxTts: Object.assign({}, prevMm, readMinimaxForm()) }));
      toast('已保存');
    });

    onClick('miya-st-storage-refresh', invalidateAndRenderStoragePanel);

    $('miya-st-backup-file').addEventListener('change', function () {
      var input = $('miya-st-backup-file');
      var selected = input && input.files ? Array.prototype.slice.call(input.files) : [];
      if (input) input.value = '';
      importBackup(selected);
    });

    onClick('miya-st-preset-save', function () {
      var name = ($('miya-st-preset-name') || {}).value ? $('miya-st-preset-name').value.trim() : '';
      if (!name) { toast('请输入预设名称'); return; }
      var cfg = Object.assign({}, getApiConfig(), readChatApiSavePayload(), readForumApiForm(), readCstoreApiForm(), { minimaxTts: readMinimaxForm() });
      var baseList = apiPresetsCache != null ? apiPresetsCache.slice() : null;
      var loadPromise = baseList ? Promise.resolve(baseList) : loadApiPresetsArr();
      loadPromise.then(function (list) {
        var next = (Array.isArray(list) ? list : []).filter(function (x) { return x && x.name !== name; });
        next.push({ name: name, config: cfg, savedAt: Date.now() });
        return saveApiPresetsArr(next).then(function (ok) {
          if (!ok) throw new Error('save_failed');
          return next;
        });
      }).then(function (list) {
        commitApiPresetsCache(list);
        var pick = $('miya-st-preset-pick');
        if (pick) pick.value = name;
        toast('API 预设已保存');
      }).catch(function () {
        toast('预设保存失败，请重试');
      });
    });

    onClick('miya-st-preset-delete', function () {
      var pick = $('miya-st-preset-pick');
      var nameInput = $('miya-st-preset-name');
      var name = (pick && pick.value ? pick.value.trim() : '') || (nameInput && nameInput.value ? nameInput.value.trim() : '');
      if (!name) { toast('请先选择要删除的预设'); return; }
      dialog({
        mode: 'confirm',
        title: '删除预设',
        message: '确定删除「' + name + '」？',
        confirmText: '删除',
        cancelText: '取消'
      }).then(function (ok) {
        if (!ok) return;
        var baseList = apiPresetsCache != null ? apiPresetsCache.slice() : null;
        var loadPromise = baseList ? Promise.resolve(baseList) : loadApiPresetsArr();
        return loadPromise.then(function (list) {
          var arr = Array.isArray(list) ? list : [];
          if (!arr.some(function (x) { return x && x.name === name; })) {
            toast('预设不存在');
            return null;
          }
          var next = arr.filter(function (x) { return !(x && x.name === name); });
          return saveApiPresetsArr(next).then(function (saved) {
            if (!saved) throw new Error('save_failed');
            return next;
          });
        }).then(function (list) {
          if (!list) return;
          commitApiPresetsCache(list);
          if (pick && pick.value === name) pick.value = '';
          toast('预设已删除');
        });
      }).catch(function () {
        toast('预设删除失败，请重试');
      });
    });

    var presetPick = $('miya-st-preset-pick');
    if (presetPick) {
      presetPick.addEventListener('change', function () {
        var name = presetPick.value;
        if (!name) return;
        ensureApiPresetsReady().then(function (list) {
          var pr = (list || []).filter(function (x) { return x && x.name === name; })[0];
          if (!pr || !pr.config) {
            toast('未找到该预设');
            return;
          }
          setApiConfig(pr.config);
          syncFormsFromConfig();
          systemPrefs.apiFabActivePreset = name;
          persistSystemPrefs();
          refreshApiFabLists();
          toast('已载入「' + name + '」');
        });
      });
    }
  }

  function openSettingsApp(panelId) {
    var app = $('miya-settings-app');
    if (!app) return;
    panelClosing = false;
    app.classList.remove('is-panel-returning');
    app.classList.add('is-open');
    app.setAttribute('aria-hidden', 'false');
    document.body.classList.add('miya-app-open');
    /* 主屏图标与列表行重叠时，安卓同一次触摸会穿透进二级页 */
    if (!panelId && global.miyaArmOpenClickGuard) global.miyaArmOpenClickGuard(app);
    if (panelId === 'miya-st-panel-chat') {
      prepareChatApiPanel();
      showPanel(panelId);
      ensureApiPresetsReady();
    } else if (panelId) {
      showPanel(panelId);
      if (panelId === 'miya-st-panel-contact-chat' && global.miyaChatSettingsPanel) {
        global.miyaChatSettingsPanel.onPanelOpen();
      }
      if (panelId === 'miya-st-panel-imagegen' && global.MiyaImageGen) {
        global.MiyaImageGen.onSettingsPanelOpen();
      }
      if (panelId === 'miya-st-panel-operation-rules' && global.MiyaChatOperationRules) {
        global.MiyaChatOperationRules.onSettingsPanelOpen();
      }
      if (panelId === 'miya-st-panel-thinking-rules' && global.MiyaChatThinkingRules) {
        global.MiyaChatThinkingRules.onSettingsPanelOpen();
      }
    } else {
      app.classList.remove('has-panel');
      setTopTitle('设置');
    }
    if (!panelId || panelId === 'miya-st-panel-chat') {
      syncFormsFromConfig();
    } else {
      syncMainToggles();
    }
    primeChatApiPanelPaint();
    ensureApiPresetsReady();
    if (!panelId && storageContextCache) {
      applyStorageSummary(storageContextCache);
      storageSummaryHydrated = true;
    }
    hydrateApiConfigFromIdb().then(function () {
      if (panelId === 'miya-st-panel-chat') prepareChatApiPanel();
      else if (!panelId) syncFormsFromConfig();
    });
  }

  function closeSettingsApp() {
    var app = $('miya-settings-app');
    if (!app) return;
    panelClosing = false;
    if (storageSummaryTimer) {
      clearTimeout(storageSummaryTimer);
      storageSummaryTimer = null;
    }
    if (chatApiPrepareIdle != null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(chatApiPrepareIdle);
      else clearTimeout(chatApiPrepareIdle);
      chatApiPrepareIdle = null;
    }
    app.classList.remove('is-open', 'has-panel', 'is-panel-returning', 'is-priming-chat-panel');
    app.setAttribute('aria-hidden', 'true');
    var chatPanel = $('miya-st-panel-chat');
    if (chatPanel) delete chatPanel.dataset.primed;
    if (!document.querySelector('.miya-beautify-app.is-open') &&
        !document.querySelector('.miya-worldbook-app.is-open') &&
        !document.querySelector('.miya-contacts-app.is-open') &&
        !document.querySelector('.miya-music-app.is-open')) {
      document.body.classList.remove('miya-app-open');
    }
  }

  loadSystemPrefs();
  bindSettingsEvents();

  if (global.miyaRegisterKvStore) {
    global.miyaRegisterKvStore({ whenReady: hydrateApiConfigFromIdb });
  }
  hydrateApiConfigFromIdb();
  ensureApiPresetsReady();

  global.miyaSettingsApp = {
    open: openSettingsApp,
    close: closeSettingsApp,
    toast: toast,
    refreshApiFab: refreshApiFabLists,
    syncApiFab: syncApiFabVisibility,
    holdKeepAliveForMedia: holdKeepAliveForForegroundMedia,
    releaseKeepAliveForMedia: releaseKeepAliveForForegroundMedia,
    disableKeepAlive: disableKeepAliveCompletely,
    isKeepAliveEnabled: function () { return !!systemPrefs.musicKeepAlive; },
    markIgPresetActive: function (name) {
      systemPrefs.apiFabActiveIgPreset = String(name || '');
      persistSystemPrefs();
      refreshApiFabLists();
    }
  };
})(window);
