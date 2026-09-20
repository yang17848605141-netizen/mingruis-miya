(function (global) {
  'use strict';

  var MEDIA_DB = 'miya-theme-media';
  var MEDIA_STORE = 'blobs';
  var META_KEY = 'miya-theme-meta';
  var PRESETS_KEY = 'miya-theme-presets';
  var FONT_PRESETS_KEY = 'miya-font-presets-v1';
  var MAX_FONT_PRESETS = 12;

  var APP_KEYS = ['music', 'memo', 'set', 'book', 'memory', 'chat', 'beauty', 'store', 'contacts', 'pet', 'pen'];
  var P2_TILE_KEYS = ['tile_couple', 'tile_themeshop', 'tile_cstore', 'tile_rift'];
  var POLAROID_KEYS = ['polaroid_1', 'polaroid_2', 'polaroid_3'];
  var P2_WIDGET_KEYS = [
    'p2_scrap_base',
    'p2_polaroid_1', 'p2_polaroid_2', 'p2_polaroid_3',
    'p2_film_1', 'p2_film_2', 'p2_film_3', 'p2_film_4',
    'p2_canister', 'p2_memo_img', 'p2_tape_deco', 'p2_stamp_img', 'p2_ticket_bg'
  ];
  var P3_TILE_KEYS = ['tile_deep', 'tile_notes', 'tile_match', 'tile_fun', 'tile_echo', 'tile_log'];
  var P3_WIDGET_KEYS = ['folio_art', 'reel_a', 'reel_b', 'reel_c', 'lunar_bg'];
  var P3_WIDGET_LEGACY = P3_WIDGET_KEYS.slice();
  var P4_TILE_KEYS = ['tile_weather', 'tile_map', 'tile_apps', 'tile_theater'];
  var P4_WIDGET_KEYS = ['p4_mist_a', 'p4_mist_b', 'p4_chip', 'p4_mood'];
  var MEDIA_KEYS = APP_KEYS.concat(POLAROID_KEYS).concat([
    'memo_ava_1', 'memo_ava_2',
    'profile_bg', 'profile_ava', 'weekcal_bg',
    'player_cover', 'player_bg'
  ])
    .concat(P2_TILE_KEYS).concat(P2_WIDGET_KEYS)
    .concat(P3_TILE_KEYS).concat(P3_WIDGET_KEYS)
    .concat(P4_TILE_KEYS).concat(P4_WIDGET_KEYS);

  var P2_TILE_SELECTORS = {
    tile_couple: '.desk--p2 .tile--couple',
    tile_themeshop: '.desk--p2 .tile--itinerary',
    tile_cstore: '.desk--p2 .tile--cstore',
    tile_rift: '.desk--p2 .tile--rift'
  };

  var P3_TILE_SELECTORS = {
    tile_deep: '.desk--p3 .tile--deep',
    tile_notes: '.desk--p3 .tile--note',
    tile_match: '.desk--p3 .tile--match',
    tile_fun: '.desk--p3 .tile--fun .tile__film',
    tile_echo: '.desk--p3 .tile--echo',
    tile_log: '.desk--p3 .tile--log'
  };

  var P2_WIDGET_SELECTORS = {
    p2_scrap_base: '.desk--p2 .p2f-board__art',
    p2_polaroid_1: '.desk--p2 .p2f-polaroid--1 .p2f-polaroid__art',
    p2_polaroid_2: '.desk--p2 .p2f-polaroid--2 .p2f-polaroid__art',
    p2_polaroid_3: '.desk--p2 .p2f-polaroid--3 .p2f-polaroid__art',
    p2_film_1: '.desk--p2 .p2f-reel__frame--1 .p2f-reel__art',
    p2_film_2: '.desk--p2 .p2f-reel__frame--2 .p2f-reel__art',
    p2_film_3: '.desk--p2 .p2f-reel__frame--3 .p2f-reel__art',
    p2_film_4: '.desk--p2 .p2f-reel__frame--4 .p2f-reel__art',
    p2_canister: '.desk--p2 .p2f-canister__art',
    p2_memo_img: '.desk--p2 .p2f-memo__art',
    p2_tape_deco: '.desk--p2 .p2f-tape-deco__art',
    p2_stamp_img: '.desk--p2 .p2f-stamp-cluster__art',
    p2_ticket_bg: '.desk--p2 .p2f-ticket-stack__art'
  };

  var P2_WIDGET_LEGACY_MAP = {
    cal_bg: 'p2_scrap_base',
    deco_orbit: 'p2_tape_deco',
    deco_moon: 'p2_canister',
    deco_note: 'p2_memo_img',
    cal_art: 'p2_scrap_base'
  };

  var P3_WIDGET_SELECTORS = {
    folio_art: '.desk--p3 .wg-folio__art',
    reel_a: '.desk--p3 .wg-reel__frame--a',
    reel_b: '.desk--p3 .wg-reel__frame--b',
    reel_c: '.desk--p3 .wg-reel__frame--c',
    lunar_bg: '.desk--p3 .wg-ledger__face'
  };

  var P4_TILE_SELECTORS = {
    tile_weather: '.desk--p4 .p4-tag--weather .p4-tag__art',
    tile_map: '.desk--p4 .p4-tag--map .p4-tag__art',
    tile_apps: '.desk--p4 .p4-tag--apps .p4-tag__art',
    tile_theater: '.desk--p4 .p4-frame .p4-frame__art'
  };

  var P4_WIDGET_SELECTORS = {
    p4_mist_a: '.desk--p4 .p4-veil__art',
    p4_mist_b: '.desk--p4 .p4-glow__art',
    p4_chip: '.desk--p4 .p4-chip__art',
    p4_mood: '.desk--p4 .p4-polar__art'
  };

  var defaultCopy = {
    profileName: '半醒手记',
    profileBio: '白日太长，适合慢慢过',
    weekcalVol: 'WEEK · 06',
    weekcalIssue: '本周放映 · 晴',
    weekcalQuote: '把寻常日子，过成慢镜头',
    weekcalSig: 'miya · desk journal',
    heroBrand: 'miya小手机',
    memoLine1: '猫在键盘上踩字',
    memoLine2: '冰箱还有布丁',
    memoLine3: '别忘记交电费',
    playerTitle: '便利店关门了',
    playerArtist: '匿名电台 · vol.7',
    playerLyric: '把灯关小一点就好',
    playerFoot: '深夜食堂歌单 · 第12期 · 走夜路专用',
    polaroidCap1: '三楼拐角见',
    polaroidCap2: 'window seat',
    polaroidCap3: 'archive · 02',
    polaroidDate: '24.06.02',
    ledgerRow1: '夜间咖啡',
    ledgerRow2: '稿费入账',
    ledgerRow3: '胶片冲洗',
    ledgerBalance: '526.00',
    p2Script: 'still turning',
    p2fVol: 'Vol. 02 · Scrap',
    p2fTitle: '底片匣',
    p2fSub: 'Film Journal · 手帐拼贴',
    p2fPolaroidCap1: 'window seat',
    p2fPolaroidCap2: 'after rain',
    p2fPolaroidCap3: 'archive · 02',
    p2fPolaroidBack1: 'remember this light',
    p2fPolaroidBack2: 'keep every frame',
    p2fPolaroidBack3: 'developed with care',
    p2fFilmStamp: '35mm · Kodak',
    p2fFilmNote: 'DO NOT X-RAY',
    p2fTapeNote: '今日宜晒片',
    p2fScribble: 'light leaks & coffee stains',
    p2fTicketNo: 'A-0427',
    p2fStampText: '已显影',
    p2fCanisterLbl: '400TX',
    p2fTileCouple: 'Together',
    folioKicker: 'Late Night',
    folioHeadline: '无人阅读的最后一页',
    folioDate: 'Jun · 06',
    reelCap1: '走廊尽头的光',
    reelCap2: '雨停之前',
    reelCap3: 'cut to black',
    tileNoteScribble: '今日一页…',
    p4Vol: '{ 雾 }',
    p4Title: '雾笺',
    p4Sub: 'soft mist · iv',
    p4Quote: '雨把时间放慢了一点',
    p4WeatherTag: '天气',
    p4WeatherMeta: '19°',
    p4MapTag: '地图',
    p4MapMeta: '附近',
    p4AppsTag: '应用',
    p4AppsMeta: '全部',
    p4TheaterTag: '剧场',
    p4TheaterMeta: '夜场',
    p4ChipText: '慢'
  };

  var defaultTheme = {
    version: 1,
    wallpaper: null,
    icons: {},
    polaroids: {},
    memoAvas: {},
    p2Widgets: {},
    p2Tiles: {},
    p3Tiles: {},
    p3Widgets: {},
    p4Tiles: {},
    p4Widgets: {},
    profileBg: null,
    weekcalBg: null,
    playerCover: null,
    playerBg: null,
    textColor: 'rgba(0, 0, 0, 0.88)',
    textColorMode: 'black',
    fontId: null,
    fontName: null,
    splashEnabled: true,
    iconFrameless: false,
    altIconStyle: false,
    fontPreviewText: '',
    fontPreviewSize: 18,
    appFontSizes: {},
    copy: Object.assign({}, defaultCopy)
  };

  var DEFAULT_FONT_PREVIEW_SIZE = 18;
  var FONT_SIZE_SCALE_RATE = 0.007;

  var APP_FONT_TARGETS = [
    { key: 'chat', label: '聊天', selectors: ['.miya-chat-app'] },
    { key: 'chat-timestamp', label: '聊天时间戳' },
    { key: 'set', label: '设置', selectors: ['.miya-settings-app'] },
    { key: 'music', label: '音乐', selectors: ['.miya-music-app'] },
    { key: 'book', label: '世界书', selectors: ['.miya-worldbook-app'] },
    { key: 'memory', label: '记忆', selectors: ['.miya-memory-app'] },
    { key: 'memo', label: '论坛', selectors: ['.miya-forum-app'] },
    { key: 'store', label: '线下', selectors: ['.miya-offline-app'] },
    { key: 'contacts', label: '联系人', selectors: ['.miya-contacts-app'] },
    { key: 'pet', label: '打字机', selectors: ['.miya-typewriter-app'] },
    { key: 'pen', label: '模拟器', selectors: ['.miya-simulator-app'] },
    { key: 'couple', label: '情侣空间', selectors: ['.miya-couple-app'] },
    { key: 'itinerary', label: '行程轨迹', selectors: ['.miya-itinerary-app'] },
    { key: 'cstore', label: '便利店', selectors: ['.miya-cstore-app'] },
    { key: 'notes', label: '日记', selectors: ['.miya-diary-app'] },
    { key: 'theater', label: '剧场', selectors: ['.miya-theater-app'] },
    { key: 'deep', label: '深入', selectors: ['.miya-deep-app'] },
    { key: 'beauty', label: '美化', selectors: ['.miya-beautify-app'] },
    { key: 'lockscreen', label: '锁屏', selectors: ['.miya-lockscreen'] },
    { key: 'system', label: '系统弹窗', selectors: ['.miya-dialog-root', '.miya-upd-overlay', '.modal'] },
    { key: 'desk-widget', label: '组件编辑', selectors: ['.desk-custom-wg-picker', '.desk-custom-wg-editor'] }
  ];

  var DEFAULT_WALL = '#ffffff';

  var blobUrlCache = {};
  var themeState = null;
  var presetsCache = [];
  var copyEditBound = false;
  var activeCopyInput = null;
  var loadedFontFace = null;

  function openMediaDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(MEDIA_DB, 1);
      req.onerror = function () { reject(req.error); };
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE)) {
          db.createObjectStore(MEDIA_STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
    });
  }

  function mediaPut(id, value) {
    return openMediaDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(MEDIA_STORE, 'readwrite');
        tx.objectStore(MEDIA_STORE).put(value, id);
        tx.oncomplete = function () { resolve(id); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function mediaGet(id) {
    return openMediaDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(MEDIA_STORE, 'readonly');
        var req = tx.objectStore(MEDIA_STORE).get(id);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function mediaDelete(id) {
    return openMediaDb().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(MEDIA_STORE, 'readwrite');
          tx.objectStore(MEDIA_STORE).delete(id);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  function revokeUrl(id) {
    if (blobUrlCache[id]) {
      try { URL.revokeObjectURL(blobUrlCache[id]); } catch (e) {}
      delete blobUrlCache[id];
    }
  }

  function genId(prefix) {
    return (prefix || 'img') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function readFileAsBlob(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(new Blob([reader.result], { type: file.type || 'application/octet-stream' }));
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(file);
    });
  }

  function fileToBlob(file) {
    if (!file) return Promise.reject(new Error('no_file'));
    if (file instanceof File) {
      var mime = detectImageMime(file, file);
      try {
        return Promise.resolve(file.slice(0, file.size, mime));
      } catch (eSlice) {
        return readFileAsBlob(file);
      }
    }
    if (file instanceof Blob) {
      var t = String(file.type || '').trim();
      if (t) return Promise.resolve(file);
      return Promise.resolve(new Blob([file], { type: detectImageMime(null, file) }));
    }
    return readFileAsBlob(file);
  }

  function deleteMediaImage(id) {
    if (!id) return Promise.resolve();
    revokeUrl(id);
    return mediaDelete(id);
  }

  function fetchUrlAsBlob(url) {
    return fetch(url, { mode: 'cors', credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw new Error('fetch failed');
      return r.blob();
    });
  }

  function storeImageBlob(blob, mime) {
    var id = genId('miya_img');
    return mediaPut(id, {
      type: 'image',
      mime: mime || blob.type || 'image/jpeg',
      blob: blob,
      created: Date.now()
    }).then(function () { return id; });
  }

  function isLikelyImageFile(file) {
    if (!file) return false;
    var t = String(file.type || '').toLowerCase();
    if (t.indexOf('image/') === 0) return true;
    return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif|svg|ico|tiff?|jfif|jpe|x-icon|raw|dng)$/i.test(String(file.name || ''));
  }

  function detectImageMime(file, blob) {
    var mime = String((file && file.type) || (blob && blob.type) || '').toLowerCase();
    if (mime && mime.indexOf('image/') === 0) return mime;
    var ext = String((file && file.name) || '').split('.').pop().toLowerCase();
    var map = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg',
      png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      avif: 'image/avif', heic: 'image/heic', heif: 'image/heif',
      svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff'
    };
    return map[ext] || mime || 'application/octet-stream';
  }

  function isStorableImageFile(file) {
    return !!(file && file.size > 0);
  }

  function isQuotaError(err) {
    if (!err) return false;
    if (err.name === 'QuotaExceededError' || err.code === 22) return true;
    return /quota/i.test(String(err.message || ''));
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob || !blob.size) reject(new Error('compress_failed'));
        else resolve(blob);
      }, 'image/jpeg', quality != null ? quality : 0.82);
    });
  }

  function canvasToPngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob || !blob.size) reject(new Error('compress_failed'));
        else resolve(blob);
      }, 'image/png');
    });
  }

  function bitmapToJpegBlob(bitmap, maxEdge, quality) {
    var w = bitmap.width || 0;
    var h = bitmap.height || 0;
    if (!w || !h) {
      try { bitmap.close && bitmap.close(); } catch (e0) {}
      return Promise.reject(new Error('invalid_image'));
    }
    var scale = Math.min(1, maxEdge / w, maxEdge / h);
    var tw = Math.max(1, Math.round(w * scale));
    var th = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      try { bitmap.close && bitmap.close(); } catch (e1) {}
      return Promise.reject(new Error('canvas_unsupported'));
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, tw, th);
    try { bitmap.close && bitmap.close(); } catch (e2) {}
    return canvasToJpegBlob(canvas, quality);
  }

  function compressFileToJpegBlob(file, maxEdge, quality) {
    maxEdge = maxEdge || 1280;
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).then(function (bitmap) {
        return bitmapToJpegBlob(bitmap, maxEdge, quality);
      });
    }
    return fileToBlob(file).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error('invalid_image')); return; }
          var scale = Math.min(1, maxEdge / w, maxEdge / h);
          var tw = Math.max(1, Math.round(w * scale));
          var th = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) { reject(new Error('canvas_unsupported')); return; }
          ctx.drawImage(img, 0, 0, tw, th);
          canvasToJpegBlob(canvas, quality).then(resolve, reject);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('decode_failed'));
        };
        img.src = url;
      });
    });
  }

  function centerCropSquareFromSource(ctx, source, w, h, outSize) {
    var cropSize = Math.min(w, h);
    var sx = (w - cropSize) / 2;
    var sy = (h - cropSize) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, cropSize, cropSize, 0, 0, outSize, outSize);
  }

  function centerCropSquarePngFromBitmap(bitmap, maxEdge) {
    var w = bitmap.width || 0;
    var h = bitmap.height || 0;
    if (!w || !h) {
      try { bitmap.close && bitmap.close(); } catch (e0) {}
      return Promise.reject(new Error('invalid_image'));
    }
    var cropSize = Math.min(w, h);
    var outSize = Math.max(1, Math.min(maxEdge || 1024, cropSize));
    var canvas = document.createElement('canvas');
    canvas.width = outSize;
    canvas.height = outSize;
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      try { bitmap.close && bitmap.close(); } catch (e1) {}
      return Promise.reject(new Error('canvas_unsupported'));
    }
    centerCropSquareFromSource(ctx, bitmap, w, h, outSize);
    try { bitmap.close && bitmap.close(); } catch (e2) {}
    return canvasToPngBlob(canvas);
  }

  function centerCropSquarePng(file, maxEdge) {
    maxEdge = maxEdge || 1024;
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file).then(function (bitmap) {
        return centerCropSquarePngFromBitmap(bitmap, maxEdge);
      });
    }
    return fileToBlob(file).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error('invalid_image')); return; }
          var cropSize = Math.min(w, h);
          var outSize = Math.max(1, Math.min(maxEdge, cropSize));
          var canvas = document.createElement('canvas');
          canvas.width = outSize;
          canvas.height = outSize;
          var ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('canvas_unsupported')); return; }
          centerCropSquareFromSource(ctx, img, w, h, outSize);
          canvasToPngBlob(canvas).then(resolve, reject);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error('decode_failed'));
        };
        img.src = url;
      });
    });
  }

  function putImageBlobWithQuotaRetry(blob, mime, replaceId) {
    var freed = false;
    function attempt() {
      return storeImageBlob(blob, mime).catch(function (err) {
        if (!isQuotaError(err) || !replaceId || freed) return Promise.reject(err);
        freed = true;
        return deleteMediaImage(replaceId).catch(function () {}).then(attempt);
      });
    }
    return attempt();
  }

  var IMAGE_STORE_FALLBACKS = [
    null,
    { maxEdge: 2560, quality: 0.9 },
    { maxEdge: 1920, quality: 0.86 },
    { maxEdge: 1280, quality: 0.82 },
    { maxEdge: 960, quality: 0.78 },
    { maxEdge: 640, quality: 0.72 },
    { maxEdge: 480, quality: 0.65 }
  ];

  function storeImageFileRobust(file, replaceId) {
    var rid = replaceId ? String(replaceId).trim() : '';
    var step = 0;

    function nextStep(err) {
      step += 1;
      if (step >= IMAGE_STORE_FALLBACKS.length) return Promise.reject(err || new Error('store_failed'));
      return tryStep();
    }

    function tryStep() {
      var cfg = IMAGE_STORE_FALLBACKS[step];
      var blobP = cfg
        ? compressFileToJpegBlob(file, cfg.maxEdge, cfg.quality)
        : fileToBlob(file);
      return blobP.then(function (blob) {
        if (!blob || !blob.size) return Promise.reject(new Error('empty_file'));
        var mime = cfg ? 'image/jpeg' : detectImageMime(file, blob);
        return putImageBlobWithQuotaRetry(blob, mime, rid);
      }).catch(function (err) {
        if (err && err.message === 'empty_file') return Promise.reject(err);
        return nextStep(err);
      });
    }

    return tryStep().then(function (newId) {
      if (rid && rid !== newId) {
        return deleteMediaImage(rid).then(function () { return newId; }).catch(function () { return newId; });
      }
      return newId;
    });
  }

  global.miyaStoreImageFile = function (file, opts) {
    opts = opts && typeof opts === 'object' ? opts : {};
    if (!file) return Promise.reject(new Error('no_file'));
    if (!isStorableImageFile(file)) {
      return Promise.reject(new Error('empty_file'));
    }
    var replaceId = opts.replaceId ? String(opts.replaceId).trim() : '';
    return storeImageFileRobust(file, replaceId);
  };

  global.miyaAutoFitSquareIconFile = function (file) {
    if (!file) return Promise.reject(new Error('no_file'));
    return centerCropSquarePng(file, 1024).then(function (blob) {
      if (!blob || !blob.size) return Promise.reject(new Error('fit_failed'));
      var name = (file.name || 'icon').replace(/\.[^.]+$/, '') + '.png';
      try {
        return new File([blob], name, { type: 'image/png' });
      } catch (e) {
        blob.name = name;
        return blob;
      }
    });
  };

  global.miyaStoreAppearanceImageFile = global.miyaStoreImageFile;

  global.miyaStoreImageUrl = function (url) {
    return fetchUrlAsBlob(url).then(function (blob) {
      if (!blob || !blob.size) return Promise.reject(new Error('fetch_failed'));
      return storeImageBlob(blob, blob.type || 'image/jpeg');
    });
  };

  function fontExtFromUrl(url) {
    try {
      var path = decodeURIComponent(String(url || '').split('?')[0].split('#')[0]);
      var match = path.match(/\.(woff2?|ttf|otf)$/i);
      return match ? match[1].toLowerCase() : '';
    } catch (e) {
      return '';
    }
  }

  function fontMimeFromExt(ext) {
    var map = {
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      otf: 'font/otf'
    };
    return map[String(ext || '').toLowerCase()] || 'application/octet-stream';
  }

  function fontNameFromUrl(url) {
    try {
      var path = decodeURIComponent(String(url || '').split('?')[0].split('#')[0]);
      var seg = path.split('/').pop() || '';
      return seg.replace(/\.[^.]+$/, '') || 'Custom';
    } catch (e) {
      return 'Custom';
    }
  }

  function isFontUrlRef(ref) {
    return typeof ref === 'string' && /^https?:\/\//i.test(ref);
  }

  function normalizeFontBlob(blob, ext) {
    if (!blob) return blob;
    var mime = fontMimeFromExt(ext);
    if (!mime || mime === 'application/octet-stream') return blob;
    if (blob.type && blob.type !== 'application/octet-stream') return blob;
    try {
      return new Blob([blob], { type: mime });
    } catch (e) {
      return blob;
    }
  }

  function fontFaceSourceFromUrl(url) {
    return 'url("' + String(url || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '")';
  }

  function loadFontFaceFromUrl(url, fontName) {
    if (!url) return Promise.resolve(false);
    var ff = new FontFace(fontName || 'MiyaCustom', fontFaceSourceFromUrl(url), { display: 'swap' });
    return ff.load().then(function (loaded) {
      if (loadedFontFace) {
        try { document.fonts.delete(loadedFontFace); } catch (e) {}
      }
      document.fonts.add(loaded);
      loadedFontFace = loaded;
      return true;
    }).catch(function () { return false; });
  }

  function loadFontFaceFromRecord(rec, fontName) {
    if (!rec || rec.type !== 'font' || !rec.blob) return Promise.resolve(false);
    var blob = normalizeFontBlob(rec.blob, rec.ext);
    var url = URL.createObjectURL(blob);
    var ff = new FontFace(fontName || rec.name || 'MiyaCustom', 'url(' + url + ')', { display: 'swap' });
    return ff.load().then(function (loaded) {
      if (loadedFontFace) {
        try { document.fonts.delete(loadedFontFace); } catch (e) {}
      }
      document.fonts.add(loaded);
      loadedFontFace = loaded;
      setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 5000);
      return true;
    }).catch(function () {
      try { URL.revokeObjectURL(url); } catch (e) {}
      return false;
    });
  }

  global.miyaFontNameFromUrl = fontNameFromUrl;

  global.miyaStoreFontFile = function (file) {
    var id = genId('miya_font');
    var ext = (file.name || '').split('.').pop().toLowerCase() || 'woff2';
    return readFileAsBlob(file).then(function (blob) {
      blob = normalizeFontBlob(blob, ext);
      return mediaPut(id, {
        type: 'font',
        mime: blob.type || file.type || fontMimeFromExt(ext),
        name: (file.name || 'Custom').replace(/\.[^.]+$/, ''),
        ext: ext,
        blob: blob,
        created: Date.now()
      }).then(function () { return { id: id, name: (file.name || 'Custom').replace(/\.[^.]+$/, '') }; });
    });
  };

  global.miyaStoreFontUrl = function (url) {
    var clean = String(url || '').trim();
    if (!clean) return Promise.reject(new Error('empty_url'));
    var ext = fontExtFromUrl(clean);
    if (!ext) return Promise.reject(new Error('invalid_ext'));
    return fetchUrlAsBlob(clean).then(function (blob) {
      if (!blob || !blob.size) return Promise.reject(new Error('fetch_failed'));
      blob = normalizeFontBlob(blob, ext);
      var name = fontNameFromUrl(clean);
      var id = genId('miya_font');
      return mediaPut(id, {
        type: 'font',
        mime: blob.type || fontMimeFromExt(ext),
        name: name,
        ext: ext,
        blob: blob,
        created: Date.now()
      }).then(function () { return { id: id, name: name }; });
    });
  };

  global.miyaEnsureFontLoaded = function (fontId, fontName) {
    if (!fontId) return Promise.resolve(false);
    if (isFontUrlRef(fontId)) return loadFontFaceFromUrl(fontId, fontName);
    return mediaGet(fontId).then(function (rec) {
      return loadFontFaceFromRecord(rec, fontName);
    }).catch(function () { return false; });
  };

  global.miyaResolveMediaUrl = function (ref) {
    if (!ref) return Promise.resolve(null);
    if (typeof ref === 'string' && (/^https?:/.test(ref) || /^data:/.test(ref) || /^blob:/.test(ref))) {
      return Promise.resolve(ref);
    }
    var id = typeof ref === 'object' ? ref.id : ref;
    if (!id) return Promise.resolve(null);
    if (blobUrlCache[id]) return Promise.resolve(blobUrlCache[id]);
    return mediaGet(id).then(function (rec) {
      if (!rec || !rec.blob) return null;
      var url = URL.createObjectURL(rec.blob);
      blobUrlCache[id] = url;
      return url;
    }).catch(function () { return null; });
  };

  function normalizeIcons(icons) {
    var src = icons && typeof icons === 'object' ? icons : {};
    var out = Object.assign({}, src);
    if (out.phone && !out.contacts) out.contacts = out.phone;
    if (out.phone) delete out.phone;
    return out;
  }

  function resolveP3Widgets(theme) {
    var out = Object.assign({}, theme.p3Widgets || {});
    var legacy = theme.p2Widgets || {};
    P3_WIDGET_LEGACY.forEach(function (k) {
      if (!out[k] && legacy[k]) out[k] = legacy[k];
    });
    return out;
  }

  function resolveP2Widgets(theme) {
    var src = theme.p2Widgets || {};
    var out = {};
    P2_WIDGET_KEYS.forEach(function (k) {
      if (src[k]) out[k] = src[k];
    });
    Object.keys(P2_WIDGET_LEGACY_MAP).forEach(function (legacyKey) {
      var mapped = P2_WIDGET_LEGACY_MAP[legacyKey];
      if (!out[mapped] && src[legacyKey]) out[mapped] = src[legacyKey];
    });
    return out;
  }

  function resolveP3Tiles(theme) {
    var out = Object.assign({}, theme.p3Tiles || {});
    var legacy = theme.p2Tiles || {};
    P3_TILE_KEYS.forEach(function (k) {
      if (!out[k] && legacy[k]) out[k] = legacy[k];
    });
    return out;
  }

  function resolveP2Tiles(theme) {
    var out = Object.assign({}, theme.p2Tiles || {});
    var icons = theme.icons || {};
    P2_TILE_KEYS.forEach(function (k) {
      if (!out[k]) {
        var appKey = k.replace(/^tile_/, '');
        if (icons[appKey]) out[k] = icons[appKey];
      }
    });
    return out;
  }

  function normalizeDeskPageStorage(theme) {
    if (!theme) return theme;
    var p3Widgets = resolveP3Widgets(theme);
    var p2Widgets = resolveP2Widgets(theme);
    var p3Tiles = resolveP3Tiles(theme);
    var p2Tiles = resolveP2Tiles(theme);
    theme.p3Widgets = p3Widgets;
    theme.p2Widgets = p2Widgets;
    theme.p3Tiles = p3Tiles;
    theme.p2Tiles = p2Tiles;
    theme.p4Tiles = Object.assign({}, theme.p4Tiles || {});
    theme.p4Widgets = Object.assign({}, theme.p4Widgets || {});
    return theme;
  }

  function migrateDeskPages(theme) {
    return normalizeDeskPageStorage(theme);
  }

  var LEGACY_PROFILE_COPY = {
    profileName: ['NongillZove', '你的名字'],
    profileBio: ['温哥华是雨季 台湾今天天气很晴', '写一句简介吧']
  };

  function migrateProfileCopy(copy) {
    if (!copy || typeof copy !== 'object') return copy;
    var next = Object.assign({}, copy);
    var changed = false;

    if (LEGACY_PROFILE_COPY.profileName.indexOf(next.profileName) >= 0) {
      next.profileName = defaultCopy.profileName;
      changed = true;
    }
    if (LEGACY_PROFILE_COPY.profileBio.indexOf(next.profileBio) >= 0) {
      next.profileBio = defaultCopy.profileBio;
      changed = true;
    }

    ['profileHandle', 'profileLocation', 'profileTag', 'p4MoodCap'].forEach(function (key) {
      if (next[key] != null) {
        delete next[key];
        changed = true;
      }
    });

    ['p4Vol', 'p4Title', 'p4Sub', 'p4Quote', 'p4ChipText'].forEach(function (key) {
      if (next[key] === '留白') {
        next[key] = defaultCopy[key];
        changed = true;
      }
    });

    return changed ? next : copy;
  }

  function loadMeta() {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          var merged = Object.assign({}, defaultTheme, p);
          merged.copy = Object.assign({}, defaultCopy, p.copy || {});
          merged.copy = migrateProfileCopy(merged.copy);
          merged.splashEnabled = p.splashEnabled !== false;
          merged.iconFrameless = p.iconFrameless === true;
          merged.altIconStyle = p.altIconStyle === true;
          merged.fontPreviewText = String(p.fontPreviewText || '');
          merged.fontPreviewSize = clampPreviewSize(p.fontPreviewSize);
          merged.appFontSizes = normalizeAppFontSizes(p.appFontSizes);
          if (!merged.icons) merged.icons = {};
          merged.icons = normalizeIcons(merged.icons);
          if (!merged.polaroids) merged.polaroids = {};
          if (!merged.memoAvas) merged.memoAvas = {};
          if (!merged.profileBg && merged.playerBg) merged.profileBg = merged.playerBg;
          migrateDeskPages(merged);
          return merged;
        }
      }
    } catch (e) {}
    return Object.assign({}, defaultTheme);
  }

  function saveMeta(theme) {
    var lean = {
      version: 1,
      wallpaper: theme.wallpaper,
      icons: theme.icons || {},
      polaroids: theme.polaroids || {},
      memoAvas: theme.memoAvas || {},
      p2Widgets: theme.p2Widgets || {},
      p2Tiles: theme.p2Tiles || {},
      p3Tiles: theme.p3Tiles || {},
      p3Widgets: theme.p3Widgets || {},
      p4Tiles: theme.p4Tiles || {},
      p4Widgets: theme.p4Widgets || {},
      profileBg: theme.profileBg || null,
      weekcalBg: theme.weekcalBg || null,
      playerCover: theme.playerCover || null,
      playerBg: theme.playerBg || null,
      textColor: theme.textColor,
      textColorMode: theme.textColorMode === 'white' ? 'white' : 'black',
      fontId: theme.fontId,
      fontName: theme.fontName,
      splashEnabled: theme.splashEnabled !== false,
      iconFrameless: theme.iconFrameless === true,
      altIconStyle: theme.altIconStyle === true,
      fontPreviewText: String(theme.fontPreviewText || ''),
      fontPreviewSize: clampPreviewSize(theme.fontPreviewSize),
      appFontSizes: normalizeAppFontSizes(theme.appFontSizes),
      copy: Object.assign({}, defaultCopy, theme.copy || {})
    };
    localStorage.setItem(META_KEY, JSON.stringify(lean));
  }

  function clampPreviewSize(v) {
    var n = parseFloat(v);
    if (!Number.isFinite(n)) return DEFAULT_FONT_PREVIEW_SIZE;
    n = Math.round(n * 2) / 2;
    return Math.min(36, Math.max(12, n));
  }

  function sizeToFontScale(size) {
    return 1 + (clampPreviewSize(size) - DEFAULT_FONT_PREVIEW_SIZE) * FONT_SIZE_SCALE_RATE;
  }

  function formatFontSizeLabel(size) {
    size = clampPreviewSize(size);
    return size % 1 === 0 ? String(size) : size.toFixed(1);
  }

  function fontSizesEqual(a, b) {
    return Math.abs(clampPreviewSize(a) - clampPreviewSize(b)) < 0.001;
  }

  function normalizeAppFontSizes(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      if (raw[key] == null || raw[key] === '') return;
      out[key] = clampPreviewSize(raw[key]);
    });
    return out;
  }

  function getAppFontSize(theme, appKey) {
    theme = theme || {};
    var sizes = theme.appFontSizes || {};
    if (sizes[appKey] != null) return clampPreviewSize(sizes[appKey]);
    return clampPreviewSize(theme.fontPreviewSize);
  }

  function getResolvedCopy(theme) {
    return Object.assign({}, defaultCopy, (theme && theme.copy) || {});
  }

  global.miyaGetTheme = function () {
    if (!themeState) themeState = loadMeta();
    return Object.assign({}, themeState);
  };

  global.miyaSetTheme = function (partial) {
    var next = partial || {};
    if (next.copy) {
      next = Object.assign({}, next);
      next.copy = Object.assign({}, getResolvedCopy(global.miyaGetTheme()), next.copy);
    }
    if (next.appFontSizes) {
      next = Object.assign({}, next);
      var mergedSizes = Object.assign({}, (global.miyaGetTheme().appFontSizes || {}), next.appFontSizes);
      Object.keys(mergedSizes).forEach(function (key) {
        if (mergedSizes[key] == null || mergedSizes[key] === '') delete mergedSizes[key];
      });
      next.appFontSizes = normalizeAppFontSizes(mergedSizes);
    }
    themeState = Object.assign({}, global.miyaGetTheme(), next);
    if (themeState.fontPreviewSize != null) {
      themeState.fontPreviewSize = clampPreviewSize(themeState.fontPreviewSize);
    }
    if (!themeState.copy) themeState.copy = Object.assign({}, defaultCopy);
    if (themeState.icons) themeState.icons = normalizeIcons(themeState.icons);
    saveMeta(themeState);
    return themeState;
  };

  function applyHomeCopy(theme) {
    document.querySelectorAll('.p4-vert, [data-miya-copy="p4MoodCap"]').forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    var copy = getResolvedCopy(theme);
    document.querySelectorAll('[data-miya-copy]').forEach(function (el) {
      var key = el.getAttribute('data-miya-copy');
      if (key && copy[key] !== undefined) {
        if (el.classList.contains('wg-memo__bubble') || el.classList.contains('wg-memo__pill')) {
          var label = el.querySelector('.wg-memo__label');
          var labelHtml = label ? label.outerHTML + ' ' : '';
          el.innerHTML = labelHtml + copy[key];
        } else {
          el.textContent = copy[key];
        }
      }
    });
  }

  function copyMaxLen(key) {
    return key.indexOf('Lyric') >= 0 || key.indexOf('Foot') >= 0 || key.indexOf('Bio') >= 0 ? 96 : 48;
  }

  function placeCaretAtEnd(node) {
    var range = document.createRange();
    var sel = window.getSelection();
    if (!sel || !node) return;
    range.selectNodeContents(node);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function detachCopyEditorHandlers(editEl) {
    if (!editEl || !editEl._miyaCopyHandlers) return;
    var h = editEl._miyaCopyHandlers;
    editEl.removeEventListener('keydown', h.keydown);
    editEl.removeEventListener('blur', h.blur);
    editEl.removeEventListener('paste', h.paste);
    editEl.removeEventListener('input', h.input);
    delete editEl._miyaCopyHandlers;
  }

  function closeCopyInput(commit) {
    if (!activeCopyInput) return;
    var el = activeCopyInput.el;
    var editEl = activeCopyInput.editEl;
    var key = activeCopyInput.key;
    var maxLen = activeCopyInput.maxLen;
    detachCopyEditorHandlers(editEl);
    editEl.removeAttribute('contenteditable');
    el.classList.remove('is-editing');
    if (commit) {
      var val = String(editEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (!val) val = defaultCopy[key] || '';
      if (val.length > maxLen) val = val.slice(0, maxLen);
      var theme = global.miyaGetTheme();
      var nextCopy = Object.assign({}, getResolvedCopy(theme));
      nextCopy[key] = val;
      global.miyaSetTheme({ copy: nextCopy });
    }
    applyHomeCopy(global.miyaGetTheme());
    activeCopyInput = null;
  }

  function openCopyEditor(el) {
    if (!el || activeCopyInput) return;
    var key = el.getAttribute('data-miya-copy');
    if (!key || !defaultCopy.hasOwnProperty(key)) return;
    var theme = global.miyaGetTheme();
    var copy = getResolvedCopy(theme);
    var isMemo = el.classList.contains('wg-memo__bubble') || el.classList.contains('wg-memo__pill');
    var editEl = el;
    var maxLen = copyMaxLen(key);

    if (isMemo) {
      var label = el.querySelector('.wg-memo__label');
      var labelHtml = label ? label.outerHTML + ' ' : '';
      el.innerHTML = labelHtml + '<span class="miya-copy-edit-text"></span>';
      editEl = el.querySelector('.miya-copy-edit-text');
      editEl.textContent = copy[key] || '';
    } else {
      el.textContent = copy[key] || '';
    }

    el.classList.add('is-editing');
    editEl.setAttribute('contenteditable', 'plaintext-only');
    editEl.setAttribute('spellcheck', 'false');

    var onKeydown = function (e) {
      if (e.key === 'Enter') { e.preventDefault(); closeCopyInput(true); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCopyInput(false); }
    };
    var onBlur = function () {
      setTimeout(function () {
        if (activeCopyInput && activeCopyInput.editEl === editEl) closeCopyInput(true);
      }, 80);
    };
    var onPaste = function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      var cur = String(editEl.textContent || '');
      if (cur.length >= maxLen) return;
      document.execCommand('insertText', false, text.slice(0, maxLen - cur.length));
    };
    var onInput = function () {
      var text = String(editEl.textContent || '');
      if (text.length > maxLen) editEl.textContent = text.slice(0, maxLen);
    };

    editEl._miyaCopyHandlers = {
      keydown: onKeydown,
      blur: onBlur,
      paste: onPaste,
      input: onInput
    };
    editEl.addEventListener('keydown', onKeydown);
    editEl.addEventListener('blur', onBlur);
    editEl.addEventListener('paste', onPaste);
    editEl.addEventListener('input', onInput);

    activeCopyInput = { el: el, editEl: editEl, key: key, maxLen: maxLen };
    editEl.focus();
    placeCaretAtEnd(editEl);
  }

  function onHomeCopyPointer(e) {
    if (e.target.closest('.miya-beautify-app, .miya-settings-app, .miya-worldbook-app, .miya-music-app, .modal, #modal')) return;
    if (activeCopyInput) {
      if (activeCopyInput.el.contains(e.target)) return;
      closeCopyInput(true);
    }
    var el = e.target && e.target.closest ? e.target.closest('[data-miya-copy]') : null;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openCopyEditor(el);
  }

  global.miyaInitHomeCopyEdit = function () {
    applyHomeCopy(global.miyaGetTheme());
    if (copyEditBound) return;
    copyEditBound = true;
    document.addEventListener('click', onHomeCopyPointer, true);
  };

  var CHAT_FONT_SCOPE_VARS = [
    '--mc-font', '--mc-display', '--mc-script', '--mc-call-font', '--qq-font',
    '--soft-font', '--soft-serif', '--soft-script'
  ];

  var FONT_SCOPE_VARS = [
    '--font', '--mc-font', '--mc-display', '--mc-script', '--mc-call-font', '--qq-font',
    '--soft-font', '--soft-serif', '--soft-script',
    '--vf-ui', '--vf-display', '--vf-editorial', '--vf-script',
    '--fr-ui', '--fr-display', '--fr-serif', '--fr-script', '--fr-caps', '--fr-kr',
    '--tw-ui', '--tw-display', '--tw-serif', '--tw-script', '--tw-read-font',
    '--ncm-font', '--sp-round', '--sp-display',
    '--ins-ui', '--ins-display', '--mi-font', '--mi-display',
    '--mm-ui', '--mm-display',
    '--it-body', '--it-display', '--it-script', '--it-editorial', '--it-mono',
    '--mdl-font-ui', '--mdl-font-display',
    '--cs-body', '--cs-display', '--cs-mono', '--cs-script',
    '--xw-sans', '--xw-serif', '--xw-display', '--xw-script',
    '--lt-sans', '--lt-serif',
    '--mn-ui', '--mn-display',
    '--sim-sans', '--sim-serif', '--sim-mono'
  ];

  function applyFontSizeToElements(selectors, size) {
    var scale = sizeToFontScale(size);
    var label = formatFontSizeLabel(size);
    var list = Array.isArray(selectors) ? selectors : [selectors];
    list.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (Math.abs(scale - 1) < 0.0005) {
          el.style.removeProperty('--miya-font-size-scale');
          el.removeAttribute('data-miya-fs');
        } else {
          el.style.setProperty('--miya-font-size-scale', String(scale));
          el.dataset.miyaFs = label;
        }
      });
    });
  }

  function applyFontSizeForKey(appKey, theme) {
    theme = theme || global.miyaGetTheme();
    if (appKey === 'chat-timestamp') {
      syncChatTimestampFontScale(theme);
      return;
    }
    var target = APP_FONT_TARGETS.filter(function (t) { return t.key === appKey; })[0];
    if (!target || !target.selectors) return;
    applyFontSizeToElements(target.selectors, getAppFontSize(theme, appKey));
  }

  function applyFontSize(theme) {
    theme = theme || global.miyaGetTheme();
    APP_FONT_TARGETS.forEach(function (target) {
      if (target.key === 'chat-timestamp') {
        syncChatTimestampFontScale(theme);
        return;
      }
      if (!target.selectors) return;
      applyFontSizeToElements(target.selectors, getAppFontSize(theme, target.key));
    });
    syncChatBeautifyFontScale(theme);
  }

  function syncChatTimestampFontScale(theme) {
    theme = theme || global.miyaGetTheme();
    var size = getAppFontSize(theme, 'chat-timestamp');
    var scale = sizeToFontScale(size);
    var label = formatFontSizeLabel(size);
    var active = Math.abs(scale - 1) >= 0.0005;
    document.querySelectorAll('#qq-room, #mq-bf-preview-room, [data-mq-bf-css-preview]').forEach(function (el) {
      el.style.removeProperty('--miya-chat-ts-font-size-scale');
      el.removeAttribute('data-miya-ts-fs');
    });
    if (!active) return;
    document.querySelectorAll('#qq-room, #mq-bf-preview-room, [data-mq-bf-css-preview]').forEach(function (el) {
      el.style.setProperty('--miya-chat-ts-font-size-scale', String(scale));
      el.dataset.miyaTsFs = label;
    });
  }

  function syncChatBeautifyFontScale(theme) {
    theme = theme || global.miyaGetTheme();
    var size = getAppFontSize(theme, 'chat');
    var scale = sizeToFontScale(size);
    var label = formatFontSizeLabel(size);
    var active = Math.abs(scale - 1) >= 0.0005;
    var roomSelectors = [
      '#qq-room.mq-has-custom-css',
      '#mq-bf-preview-room.mq-has-custom-css',
      '[data-mq-bf-css-preview].mq-has-custom-css'
    ];
    document.querySelectorAll('#qq-room, #mq-bf-preview-room, [data-mq-bf-css-preview]').forEach(function (el) {
      el.style.removeProperty('--miya-font-size-scale');
      el.removeAttribute('data-miya-fs');
    });
    if (!active) return;
    roomSelectors.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        el.style.setProperty('--miya-font-size-scale', String(scale));
        el.dataset.miyaFs = label;
      });
    });
  }

  function syncChatAppFontScope(hasCustom) {
    var chatApp = document.getElementById('miya-chat-app');
    if (!chatApp) return;
    CHAT_FONT_SCOPE_VARS.forEach(function (name) {
      if (hasCustom) chatApp.style.setProperty(name, 'var(--miya-font)');
      else chatApp.style.removeProperty(name);
    });
  }

  function applyFont(theme) {
    applyFontSize(theme);
    var root = document.documentElement;
    var hasCustom = !!(theme.fontId && theme.fontName);
    var family = "'Jost', 'Noto Sans SC', sans-serif";
    if (hasCustom) {
      family = "'" + String(theme.fontName).replace(/'/g, '') + "', 'Jost', 'Noto Sans SC', sans-serif";
    }
    root.classList.toggle('miya-custom-font-active', hasCustom);
    root.style.setProperty('--miya-font', family);
    FONT_SCOPE_VARS.forEach(function (name) {
      if (hasCustom) root.style.setProperty(name, family);
      else root.style.removeProperty(name);
    });
    syncChatAppFontScope(hasCustom);
    document.body.style.fontFamily = hasCustom ? '' : family;

    if (!theme.fontId) {
      if (loadedFontFace) {
        try { document.fonts.delete(loadedFontFace); } catch (e) {}
      }
      loadedFontFace = null;
      return Promise.resolve();
    }

    if (isFontUrlRef(theme.fontId)) {
      return loadFontFaceFromUrl(theme.fontId, theme.fontName);
    }

    return mediaGet(theme.fontId).then(function (rec) {
      return loadFontFaceFromRecord(rec, theme.fontName);
    });
  }

  function applyWallToPhone(urlOrNull) {
    var wall = document.querySelector('.phone__wall');
    if (!wall) return;
    if (!urlOrNull) {
      wall.style.backgroundImage = '';
      wall.classList.remove('has-custom-wall');
      return;
    }
    wall.style.backgroundImage = 'url("' + String(urlOrNull).replace(/"/g, '%22') + '")';
    wall.style.backgroundSize = 'cover';
    wall.style.backgroundPosition = 'center';
    wall.classList.add('has-custom-wall');
  }

  function resolveTextColorMode(theme) {
    var t = theme || {};
    if (t.textColorMode === 'white' || t.textColorMode === 'black') return t.textColorMode;
    var c = String(t.textColor || '').toLowerCase();
    if (c.indexOf('255') >= 0 && c.indexOf('rgb') >= 0) return 'white';
    return 'black';
  }

  function applyTextColor(theme) {
    var mode = resolveTextColorMode(theme);
    var ink = mode === 'white' ? 'rgba(255, 255, 255, 0.92)' : 'rgba(0, 0, 0, 0.88)';
    var inkSoft = mode === 'white' ? 'rgba(255, 255, 255, 0.72)' : 'rgba(0, 0, 0, 0.65)';
    var inkFaint = mode === 'white' ? 'rgba(255, 255, 255, 0.52)' : 'rgba(0, 0, 0, 0.45)';
    document.documentElement.style.setProperty('--ink', ink);
    document.documentElement.style.setProperty('--ink-soft', inkSoft);
    document.documentElement.style.setProperty('--ink-faint', inkFaint);
    document.documentElement.style.setProperty('--miya-text', ink);
    document.documentElement.dataset.miyaTextMode = mode;
  }

  function iconApplyHost(btn) {
    if (!btn) return null;
    var box = btn.querySelector('.ic__box');
    if (box) return { host: box, mode: 'grid' };
    var dockBtn = btn.querySelector('.foot__dock-btn');
    if (dockBtn) return { host: dockBtn, mode: 'dock' };
    if (btn.classList.contains('foot__dock-btn')) return { host: btn, mode: 'dock' };
    var dockSpan = btn.querySelector('[data-i]');
    if (dockSpan) return { host: dockSpan, mode: 'dock-span' };
    return null;
  }

  function applyIconBg(btn, ref) {
    if (!btn) return Promise.resolve();
    var target = iconApplyHost(btn);
    if (!target) return Promise.resolve();
    var host = target.host;
    var existing = host.querySelector('.miya-icon-bg');
    if (!ref) {
      if (existing) existing.remove();
      btn.classList.remove('has-custom-icon');
      host.style.backgroundImage = '';
      if (target.mode !== 'grid') {
        btn.querySelectorAll('svg').forEach(function (svg) { svg.style.opacity = ''; });
      }
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      if (!existing) {
        existing = document.createElement('span');
        existing.className = 'miya-icon-bg';
        existing.setAttribute('aria-hidden', 'true');
        host.insertBefore(existing, host.firstChild);
      }
      existing.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      btn.classList.add('has-custom-icon');
      if (target.mode !== 'grid') {
        btn.querySelectorAll('svg').forEach(function (svg) { svg.style.opacity = '0'; });
      }
    });
  }

  function applyPolaroid(slot, ref) {
    var card = document.querySelector('.wg-polaroid__card--' + slot + ' .wg-polaroid__photo');
    if (!card) return Promise.resolve();
    if (!ref) {
      card.style.backgroundImage = '';
      card.classList.remove('has-custom-photo');
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      card.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      card.style.backgroundSize = 'cover';
      card.style.backgroundPosition = 'center';
      card.classList.add('has-custom-photo');
    });
  }

  function applyMemoAva(slot, ref) {
    var ava = document.querySelector('.wg-memo__person:nth-child(' + slot + ') .wg-memo__ava');
    if (!ava) return Promise.resolve();
    if (!ref) {
      ava.style.backgroundImage = '';
      ava.classList.remove('has-custom-ava');
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      ava.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      ava.style.backgroundSize = 'cover';
      ava.classList.add('has-custom-ava');
    });
  }

  function applyWidgetCustomBg(host, className, hasClass, ref) {
    if (!host) return Promise.resolve();
    var bg = host.querySelector('.' + className);
    if (!ref) {
      if (bg) bg.remove();
      host.classList.remove(hasClass);
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      if (!bg) {
        bg = document.createElement('div');
        bg.className = className;
        bg.setAttribute('aria-hidden', 'true');
        host.insertBefore(bg, host.firstChild);
      }
      bg.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      host.classList.add(hasClass);
    });
  }

  function applyProfileBg(ref) {
    var profile = document.getElementById('wg-profile');
    var cover = profile && profile.querySelector('.wg-profile__cover-bg');
    if (!cover) return Promise.resolve();
    if (!ref) {
      cover.style.background = '';
      cover.style.backgroundImage = '';
      if (profile) profile.classList.remove('has-custom-cover');
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      cover.style.background = 'url("' + url.replace(/"/g, '%22') + '") center/cover no-repeat';
      if (profile) profile.classList.add('has-custom-cover');
    });
  }

  function applyProfileAva(ref) {
    var ava = document.getElementById('wg-profile-avatar');
    if (!ava) return Promise.resolve();
    if (!ref) {
      ava.style.backgroundImage = '';
      ava.classList.remove('has-custom-ava');
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      ava.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      ava.style.backgroundSize = 'cover';
      ava.style.backgroundPosition = 'center';
      ava.classList.add('has-custom-ava');
    });
  }

  function applyWeekcalBg(ref) {
    return applyWidgetCustomBg(
      document.getElementById('wg-profile'),
      'wg-profile__custom-bg',
      'has-custom-bg',
      ref
    );
  }

  function applyPlayerCover(ref) {
    var cover = document.querySelector('.wg-player__cover');
    if (!cover) return Promise.resolve();
    if (!ref) {
      cover.style.backgroundImage = '';
      cover.classList.remove('has-custom-cover');
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      cover.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      cover.style.backgroundSize = 'cover';
      cover.classList.add('has-custom-cover');
    });
  }

  function applyPlayerBg(ref) {
    var player = document.getElementById('wg-player');
    if (!player) return Promise.resolve();
    var bg = player.querySelector('.wg-player__bg');
    if (!ref) {
      if (bg) bg.remove();
      player.classList.remove('has-custom-player-bg');
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      if (!bg) {
        bg = document.createElement('div');
        bg.className = 'wg-player__bg';
        bg.setAttribute('aria-hidden', 'true');
        player.insertBefore(bg, player.firstChild);
      }
      bg.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      player.classList.add('has-custom-player-bg');
    });
  }

  function applyCustomArt(selector, ref, opts) {
    opts = opts || {};
    var el = document.querySelector(selector);
    if (!el) return Promise.resolve();
    var tileBtn = opts.tileKey
      ? document.querySelector((opts.deskSel || '') + ' [data-app="' + opts.tileKey + '"]')
      : null;
    if (!ref) {
      el.style.backgroundImage = '';
      el.classList.remove('has-custom-art');
      if (tileBtn) {
        tileBtn.classList.remove('has-custom-tile-art');
        var oldBg = tileBtn.querySelector('.miya-tile-bg');
        if (oldBg) oldBg.remove();
      }
      return Promise.resolve();
    }
    return global.miyaResolveMediaUrl(ref).then(function (url) {
      if (!url) return;
      if (opts.asTileBg && tileBtn) {
        var bg = tileBtn.querySelector('.miya-tile-bg');
        if (!bg) {
          bg = document.createElement('span');
          bg.className = 'miya-tile-bg';
          bg.setAttribute('aria-hidden', 'true');
          tileBtn.insertBefore(bg, tileBtn.firstChild);
        }
        bg.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        tileBtn.classList.add('has-custom-tile-art');
        return;
      }
      el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.classList.add('has-custom-art');
    });
  }

  function applyP2Tile(key, ref) {
    var selector = P2_TILE_SELECTORS[key];
    if (!selector) return Promise.resolve();
    var appKey = key.replace(/^tile_/, '');
    return applyCustomArt(selector, ref, { asTileBg: true, tileKey: appKey, deskSel: '.desk--p2' });
  }

  function applyP3Tile(key, ref) {
    var selector = P3_TILE_SELECTORS[key];
    if (!selector) return Promise.resolve();
    var appKey = key.replace(/^tile_/, '');
    if (key === 'tile_fun') {
      return applyCustomArt(selector, ref, {});
    }
    return applyCustomArt(selector, ref, { asTileBg: true, tileKey: appKey, deskSel: '.desk--p3' });
  }

  function applyP2Widget(key, ref) {
    var selector = P2_WIDGET_SELECTORS[key];
    if (!selector) return Promise.resolve();
    return applyCustomArt(selector, ref, {});
  }

  function applyP3Widget(key, ref) {
    var selector = P3_WIDGET_SELECTORS[key];
    if (!selector) return Promise.resolve();
    return applyCustomArt(selector, ref, {});
  }

  function applyP4Tile(key, ref) {
    var selector = P4_TILE_SELECTORS[key];
    if (!selector) return Promise.resolve();
    return applyCustomArt(selector, ref, {});
  }

  function applyP4Widget(key, ref) {
    var selector = P4_WIDGET_SELECTORS[key];
    if (!selector) return Promise.resolve();
    return applyCustomArt(selector, ref, {});
  }

  function applyIconFrameless(theme) {
    var on = theme && theme.iconFrameless === true;
    document.documentElement.classList.toggle('miya-icon-frameless', on);
  }

  function applyAltIconStyle(theme) {
    var on = !!(theme && theme.altIconStyle);
    if (global.miyaSyncAppIconStyle) global.miyaSyncAppIconStyle(on);
    else document.documentElement.classList.toggle('miya-alt-app-icons', on);
  }

  global.miyaApplyFont = function (theme) {
    return applyFont(theme || global.miyaGetTheme());
  };

  global.miyaApplyFontSize = function (theme) {
    applyFontSize(theme || global.miyaGetTheme());
  };

  global.miyaApplyFontSizeForKey = function (appKey, theme) {
    theme = theme || global.miyaGetTheme();
    applyFontSizeForKey(appKey, theme);
    if (appKey === 'chat') syncChatBeautifyFontScale(theme);
    if (appKey === 'chat-timestamp') syncChatTimestampFontScale(theme);
  };

  global.miyaSyncChatBeautifyFontScale = function (theme) {
    syncChatBeautifyFontScale(theme || global.miyaGetTheme());
  };

  global.miyaSyncChatTimestampFontScale = function (theme) {
    syncChatTimestampFontScale(theme || global.miyaGetTheme());
  };

  global.miyaGetAppFontSize = function (appKey, theme) {
    return getAppFontSize(theme || global.miyaGetTheme(), appKey);
  };

  global.miyaFormatFontSizeLabel = formatFontSizeLabel;
  global.miyaFontSizesEqual = fontSizesEqual;
  global.miyaSizeToFontScale = sizeToFontScale;

  global.miyaAPP_FONT_TARGETS = APP_FONT_TARGETS;

  global.miyaApplyTheme = function (theme) {
    theme = theme || global.miyaGetTheme();
    var isCustom = global.miyaGetDeskLayoutMode && global.miyaGetDeskLayoutMode() === 'custom';
    if (!isCustom) {
      applyTextColor(theme);
      applyIconFrameless(theme);
      applyAltIconStyle(theme);
    }
    applyHomeCopy(theme);
    var promises = [];
    promises.push(applyFont(theme));
    if (!isCustom) {
      promises.push(
        global.miyaResolveMediaUrl(theme.wallpaper).then(function (url) {
          applyWallToPhone(url);
        })
      );
    }
    APP_KEYS.forEach(function (key) {
      var btn = document.querySelector('.desk-viewport [data-app="' + key + '"], .desk--p1 [data-app="' + key + '"]');
      promises.push(applyIconBg(btn, theme.icons && theme.icons[key]));
    });
    if (!isCustom) {
      ['contacts', 'pet', 'pen'].forEach(function (key) {
        var dockBtn = document.querySelector('.foot__dock [data-app="' + key + '"]');
        promises.push(applyIconBg(dockBtn, theme.icons && theme.icons[key]));
      });
    }
    POLAROID_KEYS.forEach(function (key) {
      var slot = key === 'polaroid_1' ? '1' : key === 'polaroid_2' ? '2' : '3';
      promises.push(applyPolaroid(slot, theme.polaroids && theme.polaroids[key]));
    });
    promises.push(applyMemoAva(1, theme.memoAvas && theme.memoAvas.memo_ava_1));
    promises.push(applyMemoAva(2, theme.memoAvas && theme.memoAvas.memo_ava_2));
    promises.push(applyProfileBg(theme.profileBg || theme.playerBg));
    promises.push(applyProfileAva(theme.memoAvas && theme.memoAvas.profile_ava));
    promises.push(applyWeekcalBg(theme.weekcalBg));
    promises.push(applyPlayerCover(theme.playerCover));
    promises.push(applyPlayerBg(theme.playerBg));
    P2_TILE_KEYS.forEach(function (key) {
      promises.push(applyP2Tile(key, theme.p2Tiles && theme.p2Tiles[key]));
    });
    P2_WIDGET_KEYS.forEach(function (key) {
      promises.push(applyP2Widget(key, theme.p2Widgets && theme.p2Widgets[key]));
    });
    P3_TILE_KEYS.forEach(function (key) {
      promises.push(applyP3Tile(key, theme.p3Tiles && theme.p3Tiles[key]));
    });
    P3_WIDGET_KEYS.forEach(function (key) {
      promises.push(applyP3Widget(key, theme.p3Widgets && theme.p3Widgets[key]));
    });
    P4_TILE_KEYS.forEach(function (key) {
      promises.push(applyP4Tile(key, theme.p4Tiles && theme.p4Tiles[key]));
    });
    P4_WIDGET_KEYS.forEach(function (key) {
      promises.push(applyP4Widget(key, theme.p4Widgets && theme.p4Widgets[key]));
    });
    return Promise.all(promises);
  };

  global.miyaHydrateTheme = function () {
    themeState = loadMeta();
    themeState = normalizeDeskPageStorage(themeState);
    saveMeta(themeState);
    return global.miyaApplyTheme(themeState).then(function () {
      global.miyaInitHomeCopyEdit();
      if (global.miyaInitCustomDesk) return global.miyaInitCustomDesk();
    });
  };

  function loadPresetsFromStorage() {
    try {
      var raw = localStorage.getItem(PRESETS_KEY);
      presetsCache = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(presetsCache)) presetsCache = [];
    } catch (e) {
      presetsCache = [];
    }
  }

  global.miyaGetPresets = function () {
    loadPresetsFromStorage();
    return presetsCache.slice();
  };

  global.miyaSavePreset = function (name) {
    var theme = global.miyaGetTheme();
    var preset = {
      id: genId('preset'),
      name: String(name || '未命名').trim() || '未命名',
      savedAt: Date.now(),
      theme: JSON.parse(JSON.stringify(theme))
    };
    var list = global.miyaGetPresets();
    list.push(preset);
    presetsCache = list;
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    return preset;
  };

  global.miyaLoadPreset = function (id) {
    var found = global.miyaGetPresets().filter(function (p) { return p.id === id; })[0];
    if (!found || !found.theme) return Promise.resolve(false);
    var presetTheme = Object.assign({}, found.theme);
    if (presetTheme.icons) presetTheme.icons = normalizeIcons(presetTheme.icons);
    global.miyaSetTheme(presetTheme);
    return global.miyaApplyTheme(presetTheme).then(function () { return true; });
  };

  global.miyaDeletePreset = function (id) {
    var list = global.miyaGetPresets().filter(function (p) { return p.id !== id; });
    presetsCache = list;
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
  };

  var fontPresetsCache = null;

  function loadFontPresetsFromStorage() {
    try {
      var raw = localStorage.getItem(FONT_PRESETS_KEY);
      fontPresetsCache = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(fontPresetsCache)) fontPresetsCache = [];
    } catch (e) {
      fontPresetsCache = [];
    }
  }

  global.miyaGetFontPresets = function () {
    loadFontPresetsFromStorage();
    return fontPresetsCache.slice();
  };

  global.miyaSaveFontPreset = function (fontId, fontName, name) {
    if (!fontId || !fontName) return { error: 'invalid' };
    loadFontPresetsFromStorage();
    if (fontPresetsCache.length >= MAX_FONT_PRESETS) return { error: 'max' };
    var preset = {
      id: genId('font_preset'),
      name: String(name || fontName || '自定义字体').trim() || '自定义字体',
      fontId: fontId,
      fontName: fontName,
      savedAt: Date.now()
    };
    fontPresetsCache.push(preset);
    localStorage.setItem(FONT_PRESETS_KEY, JSON.stringify(fontPresetsCache));
    return preset;
  };

  global.miyaDeleteFontPreset = function (id) {
    loadFontPresetsFromStorage();
    fontPresetsCache = fontPresetsCache.filter(function (p) { return p.id !== id; });
    localStorage.setItem(FONT_PRESETS_KEY, JSON.stringify(fontPresetsCache));
  };

  global.miyaSetWallpaper = function (ref) {
    global.miyaSetTheme({ wallpaper: ref });
    return global.miyaApplyTheme();
  };

  global.miyaSetIcon = function (key, ref) {
    var theme = global.miyaGetTheme();
    var icons = Object.assign({}, theme.icons || {});
    if (ref) icons[key] = ref; else delete icons[key];
    global.miyaSetTheme({ icons: icons });
    return global.miyaApplyTheme();
  };

  global.miyaSetPolaroid = function (key, ref) {
    var theme = global.miyaGetTheme();
    var pol = Object.assign({}, theme.polaroids || {});
    if (ref) pol[key] = ref; else delete pol[key];
    global.miyaSetTheme({ polaroids: pol });
    return global.miyaApplyTheme();
  };

  global.miyaSetMemoAva = function (key, ref) {
    var theme = global.miyaGetTheme();
    var avas = Object.assign({}, theme.memoAvas || {});
    if (ref) avas[key] = ref; else delete avas[key];
    global.miyaSetTheme({ memoAvas: avas });
    return global.miyaApplyTheme();
  };

  global.miyaSetProfileBg = function (ref) {
    global.miyaSetTheme({ profileBg: ref || null });
    return global.miyaApplyTheme();
  };

  global.miyaSetWeekcalBg = function (ref) {
    global.miyaSetTheme({ weekcalBg: ref || null });
    return global.miyaApplyTheme();
  };

  global.miyaSetPlayerCover = function (ref) {
    global.miyaSetTheme({ playerCover: ref || null });
    return global.miyaApplyTheme();
  };

  global.miyaSetPlayerBg = function (ref) {
    global.miyaSetTheme({ playerBg: ref || null });
    return global.miyaApplyTheme();
  };

  global.miyaSetP2Tile = function (key, ref) {
    var theme = global.miyaGetTheme();
    var tiles = Object.assign({}, theme.p2Tiles || {});
    if (ref) tiles[key] = ref; else delete tiles[key];
    global.miyaSetTheme({ p2Tiles: tiles });
    return global.miyaApplyTheme();
  };

  global.miyaSetP3Tile = function (key, ref) {
    var theme = global.miyaGetTheme();
    var tiles = Object.assign({}, theme.p3Tiles || {});
    if (ref) tiles[key] = ref; else delete tiles[key];
    global.miyaSetTheme({ p3Tiles: tiles });
    return global.miyaApplyTheme();
  };

  global.miyaSetP2Widget = function (key, ref) {
    var theme = global.miyaGetTheme();
    var widgets = Object.assign({}, theme.p2Widgets || {});
    if (ref) widgets[key] = ref; else delete widgets[key];
    global.miyaSetTheme({ p2Widgets: widgets });
    return global.miyaApplyTheme();
  };

  global.miyaSetP3Widget = function (key, ref) {
    var theme = global.miyaGetTheme();
    var widgets = Object.assign({}, theme.p3Widgets || {});
    if (ref) widgets[key] = ref; else delete widgets[key];
    global.miyaSetTheme({ p3Widgets: widgets });
    return global.miyaApplyTheme();
  };

  global.miyaSetP4Tile = function (key, ref) {
    var theme = global.miyaGetTheme();
    var tiles = Object.assign({}, theme.p4Tiles || {});
    if (ref) tiles[key] = ref; else delete tiles[key];
    global.miyaSetTheme({ p4Tiles: tiles });
    return global.miyaApplyTheme();
  };

  global.miyaSetP4Widget = function (key, ref) {
    var theme = global.miyaGetTheme();
    var widgets = Object.assign({}, theme.p4Widgets || {});
    if (ref) widgets[key] = ref; else delete widgets[key];
    global.miyaSetTheme({ p4Widgets: widgets });
    return global.miyaApplyTheme();
  };

  global.miyaAPP_KEYS = APP_KEYS;
  global.miyaP2_TILE_KEYS = P2_TILE_KEYS;
  global.miyaPOLAROID_KEYS = POLAROID_KEYS;
  global.miyaP2_WIDGET_KEYS = P2_WIDGET_KEYS;
  global.miyaP3_TILE_KEYS = P3_TILE_KEYS;
  global.miyaP3_WIDGET_KEYS = P3_WIDGET_KEYS;
  global.miyaP4_TILE_KEYS = P4_TILE_KEYS;
  global.miyaP4_WIDGET_KEYS = P4_WIDGET_KEYS;
  global.miyaMEDIA_KEYS = MEDIA_KEYS;
  global.miyaDefaultCopy = defaultCopy;

  function collectMediaIds(theme, bag) {
    bag = bag || {};
    if (!theme) return bag;
    function add(ref) {
      if (!ref) return;
      var id = typeof ref === 'string' ? ref : (ref.id || null);
      if (id && id.indexOf('miya_') === 0) bag[id] = true;
    }
    add(theme.wallpaper);
    add(theme.profileBg);
    add(theme.weekcalBg);
    add(theme.playerCover);
    add(theme.playerBg);
    add(theme.fontId);
    Object.keys(theme.icons || {}).forEach(function (k) { add(theme.icons[k]); });
    Object.keys(theme.polaroids || {}).forEach(function (k) { add(theme.polaroids[k]); });
    Object.keys(theme.memoAvas || {}).forEach(function (k) { add(theme.memoAvas[k]); });
    Object.keys(theme.p2Tiles || {}).forEach(function (k) { add(theme.p2Tiles[k]); });
    Object.keys(theme.p2Widgets || {}).forEach(function (k) { add(theme.p2Widgets[k]); });
    Object.keys(theme.p3Tiles || {}).forEach(function (k) { add(theme.p3Tiles[k]); });
    Object.keys(theme.p3Widgets || {}).forEach(function (k) { add(theme.p3Widgets[k]); });
    Object.keys(theme.p4Tiles || {}).forEach(function (k) { add(theme.p4Tiles[k]); });
    Object.keys(theme.p4Widgets || {}).forEach(function (k) { add(theme.p4Widgets[k]); });
    return bag;
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    var parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    try {
      var bin = atob(parts[1]);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return new Blob([u8], { type: mime });
    } catch (e) { return null; }
  }

  function serializeMediaRecord(rec) {
    if (!rec || !(rec.blob instanceof Blob)) {
      return Promise.resolve(rec ? Object.assign({}, rec) : null);
    }
    return blobToDataUrl(rec.blob).then(function (dataUrl) {
      var out = Object.assign({}, rec);
      out.__blob = 'dataUrl';
      out.blobDataUrl = dataUrl;
      delete out.blob;
      return out;
    });
  }

  function deserializeMediaRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    if (rec.__blob === 'dataUrl' && rec.blobDataUrl) {
      var blob = dataUrlToBlob(rec.blobDataUrl);
      var copy = Object.assign({}, rec);
      delete copy.__blob;
      delete copy.blobDataUrl;
      if (blob) copy.blob = blob;
      return copy;
    }
    return rec;
  }

  function scanForMediaRefs(val, add) {
    if (val == null) return;
    if (typeof val === 'string') {
      if (val.indexOf('miya_') === 0) add(val);
      return;
    }
    if (typeof val !== 'object') return;
    if (typeof val.id === 'string' && val.id.indexOf('miya_') === 0) {
      add(val);
      return;
    }
    if (Array.isArray(val)) {
      val.forEach(function (item) { scanForMediaRefs(item, add); });
      return;
    }
    Object.keys(val).forEach(function (k) {
      scanForMediaRefs(val[k], add);
    });
  }

  function collectCustomMediaIds(theme, bag) {
    bag = bag || {};
    if (!theme) return bag;
    function add(ref) {
      if (!ref) return;
      var id = typeof ref === 'string' ? ref : (ref.id || null);
      if (id && id.indexOf('miya_') === 0) bag[id] = true;
    }
    add(theme.wallpaper);
    add(theme.profileBg);
    Object.keys(theme.icons || {}).forEach(function (k) { add(theme.icons[k]); });
    Object.keys(theme.memoAvas || {}).forEach(function (k) { add(theme.memoAvas[k]); });
    Object.keys(theme.polaroids || {}).forEach(function (k) { add(theme.polaroids[k]); });
    scanForMediaRefs(theme.layout, add);
    return bag;
  }

  function serializePackMediaRecord(rec) {
    if (global.miyaSerializeIdbBlobValue) {
      return global.miyaSerializeIdbBlobValue(rec).then(function (s) { return s || null; });
    }
    return serializeMediaRecord(rec);
  }

  function deserializePackMediaRecord(rec) {
    if (global.miyaDeserializeIdbBlobValue) {
      return global.miyaDeserializeIdbBlobValue(rec);
    }
    return deserializeMediaRecord(rec);
  }

  global.miyaExportCustomDecorPack = function () {
    if (!global.miyaGetCustomDeskTheme) return Promise.reject(new Error('custom desk unavailable'));
    var theme = JSON.parse(JSON.stringify(global.miyaGetCustomDeskTheme()));
    var tpl = global.MiyaDeskCustomWidgetTemplates;
    if (tpl && typeof tpl.getLibrarySnapshot === 'function') {
      theme.customWidgetLibrary = tpl.getLibrarySnapshot();
    }
    var ids = Object.keys(collectCustomMediaIds(theme, {}));
    return Promise.all(ids.map(function (id) {
      return mediaGet(id).then(function (rec) {
        if (!rec) return null;
        return serializePackMediaRecord(rec).then(function (s) { return s ? { id: id, data: s } : null; });
      });
    })).then(function (rows) {
      var media = {};
      rows.forEach(function (row) {
        if (row) media[row.id] = row.data;
      });
      return JSON.stringify({
        miyaCustomDecorPack: true,
        version: 2,
        exportedAt: Date.now(),
        theme: theme,
        customWidgetPresets: theme.customWidgetLibrary || [],
        media: media
      }, null, 2);
    });
  };

  global.miyaImportCustomDecorPack = function (jsonStr) {
    var data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (!data || !data.theme) throw new Error('invalid pack');
    if (data.miyaDecorPack && !data.miyaCustomDecorPack) {
      throw new Error('fixed layout pack');
    }
    var media = data.media || {};
    var keys = Object.keys(media);
    Object.keys(blobUrlCache).forEach(revokeUrl);
    return Promise.all(keys.map(function (id) {
      var rec = deserializePackMediaRecord(media[id]);
      return rec ? mediaPut(id, rec) : Promise.resolve();
    })).then(function () {
      var theme = data.theme;
      var library = data.customWidgetPresets || theme.customWidgetLibrary || null;
      if (library && Array.isArray(library)) {
        theme = Object.assign({}, theme, { customWidgetLibrary: library });
      }
      if (!global.miyaSetCustomDeskTheme) return Promise.resolve();
      return Promise.resolve(global.miyaSetCustomDeskTheme(theme)).then(function () {
        if (global.miyaGetDeskLayoutMode && global.miyaGetDeskLayoutMode() === 'custom' && global.miyaApplyCustomDesk) {
          return global.miyaApplyCustomDesk();
        }
      });
    });
  };

  global.miyaExportDecorPack = function () {
    var theme = JSON.parse(JSON.stringify(global.miyaGetTheme()));
    var ids = Object.keys(collectMediaIds(theme, {}));
    return Promise.all(ids.map(function (id) {
      return mediaGet(id).then(function (rec) {
        if (!rec) return null;
        return serializeMediaRecord(rec).then(function (s) { return s ? { id: id, data: s } : null; });
      });
    })).then(function (rows) {
      var media = {};
      rows.forEach(function (row) {
        if (row) media[row.id] = row.data;
      });
      return JSON.stringify({
        miyaDecorPack: true,
        version: 1,
        exportedAt: Date.now(),
        theme: theme,
        media: media
      }, null, 2);
    });
  };

  global.miyaImportDecorPack = function (jsonStr) {
    var data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    if (!data || !data.theme) throw new Error('invalid pack');
    var media = data.media || {};
    var keys = Object.keys(media);
    Object.keys(blobUrlCache).forEach(revokeUrl);
    return Promise.all(keys.map(function (id) {
      var rec = deserializeMediaRecord(media[id]);
      return rec ? mediaPut(id, rec) : Promise.resolve();
    })).then(function () {
      var t = Object.assign({}, defaultTheme, data.theme);
      t.copy = Object.assign({}, defaultCopy, t.copy || {});
      t.copy = migrateProfileCopy(t.copy);
      migrateDeskPages(t);
      global.miyaSetTheme(t);
      return global.miyaApplyTheme(t);
    });
  };

  global.miyaExportThemeMediaDb = function () {
    return global.miyaExportNamedDbBlobs(MEDIA_DB, MEDIA_STORE);
  };

  global.miyaImportThemeMediaDb = function (src) {
    Object.keys(blobUrlCache).forEach(revokeUrl);
    return global.miyaImportNamedDbBlobs(MEDIA_DB, MEDIA_STORE, src);
  };
})(window);
