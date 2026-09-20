/**
 * miya-typewriter-store.js — 打字机书库持久化
 */
(function (global) {
  'use strict';

  var LS_KEY = 'miya-typewriter-v1';
  var VESSELS = global.miyaTypewriterVessels
    ? global.miyaTypewriterVessels.ORDER.slice()
    : ['typewriter', 'watch', 'phone', 'inkwell', 'gramophone', 'candlestick', 'lunarium', 'telescope'];

  var data = { books: [] };
  var ready = false;
  var readyPromise = null;

  function trySyncHydrate() {
    if (ready) return data;
    if (typeof global.miyaSyncReadJsonKey === 'function') {
      var raw = global.miyaSyncReadJsonKey(LS_KEY);
      if (raw != null) {
        var books = (raw && raw.books) || [];
        data.books = books.map(normalizeBook).filter(Boolean);
        ready = true;
        return data;
      }
    }
    return null;
  }

  function invalidateCache() {
    data = { books: [] };
    ready = false;
    readyPromise = null;
  }

  function newId() {
    return 'tw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function normalizeChapter(raw) {
    if (!raw) return null;
    return {
      title: String(raw.title || '章节').slice(0, 80),
      content: String(raw.content || '')
    };
  }

  function normalizeRtProgress(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      var item = raw[key];
      if (!item || typeof item !== 'object') return;
      out[String(key)] = {
        page: Math.max(0, parseInt(item.page, 10) || 0),
        bookScroll: Math.max(0, parseInt(item.bookScroll, 10) || 0)
      };
    });
    return out;
  }

  function normalizeBook(raw) {
    if (!raw || !raw.id) return null;
    var vessel = String(raw.vessel || 'typewriter');
    if (VESSELS.indexOf(vessel) < 0) vessel = 'typewriter';
    var chapters = Array.isArray(raw.chapters)
      ? raw.chapters.map(normalizeChapter).filter(Boolean)
      : [];
    return {
      id: String(raw.id),
      title: String(raw.title || '未命名').slice(0, 120),
      content: String(raw.content || ''),
      chapters: chapters,
      vessel: vessel,
      progress: Math.max(0, parseInt(raw.progress, 10) || 0),
      rtProgress: normalizeRtProgress(raw.rtProgress),
      createdAt: raw.createdAt || Date.now()
    };
  }

  function save() {
    if (global.miyaWriteLsJsonKey) {
      return global.miyaWriteLsJsonKey(LS_KEY, data);
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      return Promise.resolve(true);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function load() {
    if (readyPromise) return readyPromise;
    readyPromise = (global.miyaReadLsJsonKey
      ? global.miyaReadLsJsonKey(LS_KEY, { books: [] })
      : Promise.resolve({ books: [] })
    ).then(function (raw) {
      var books = (raw && raw.books) || [];
      data.books = books.map(normalizeBook).filter(Boolean);
      ready = true;
      return data;
    }).catch(function () {
      data.books = [];
      ready = true;
      return data;
    });
    return readyPromise;
  }

  function getBooks() {
    trySyncHydrate();
    return data.books.slice().sort(function (a, b) {
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function getBook(id) {
    var bid = String(id || '');
    return data.books.find(function (b) { return b.id === bid; }) || null;
  }

  function pickVessel(index) {
    if (global.miyaTypewriterVessels) return global.miyaTypewriterVessels.pick(index);
    return VESSELS[index % VESSELS.length];
  }

  function addBook(title, content, chapters) {
    var parsed = global.miyaTypewriterText && global.miyaTypewriterText.parseImportedText
      ? global.miyaTypewriterText.parseImportedText(content)
      : { chapters: [], content: content };
    var book = normalizeBook({
      id: newId(),
      title: title,
      content: parsed.content || content,
      chapters: chapters || parsed.chapters || [],
      vessel: pickVessel(data.books.length),
      progress: 0,
      rtProgress: {},
      createdAt: Date.now()
    });
    if (!book) return null;
    data.books.unshift(book);
    save();
    return book;
  }

  function removeBook(id) {
    var bid = String(id || '');
    var before = data.books.length;
    data.books = data.books.filter(function (b) { return b.id !== bid; });
    if (data.books.length !== before) save();
    return before !== data.books.length;
  }

  function setProgress(id, page) {
    var book = getBook(id);
    if (!book) return false;
    book.progress = Math.max(0, parseInt(page, 10) || 0);
    save();
    return true;
  }

  function setRtProgress(id, contactId, page, bookScroll) {
    var book = getBook(id);
    if (!book || !contactId) return false;
    if (!book.rtProgress) book.rtProgress = {};
    book.rtProgress[String(contactId)] = {
      page: Math.max(0, parseInt(page, 10) || 0),
      bookScroll: Math.max(0, parseInt(bookScroll, 10) || 0)
    };
    save();
    return true;
  }

  function getRtProgress(id, contactId) {
    var book = getBook(id);
    if (!book || !contactId || !book.rtProgress) return null;
    return book.rtProgress[String(contactId)] || null;
  }

  global.miyaTypewriterStore = {
    LS_KEY: LS_KEY,
    VESSELS: VESSELS,
    load: load,
    whenReady: function () { return load(); },
    isReady: function () { return ready; },
    invalidateCache: invalidateCache,
    getBooks: getBooks,
    getBook: getBook,
    addBook: addBook,
    removeBook: removeBook,
    setProgress: setProgress,
    setRtProgress: setRtProgress,
    getRtProgress: getRtProgress,
    pickVessel: pickVessel
  };

  if (global.miyaRegisterKvStore) global.miyaRegisterKvStore(global.miyaTypewriterStore);
})(window);
