(function (global) {
  'use strict';

  var PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  var CHARA_KEYS = ['chara', 'ccv3', 'Chara', 'ccv2'];

  function extOf(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('read_failed')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('read_failed')); };
      reader.readAsDataURL(file);
    });
  }

  function isPngBuffer(buf) {
    var u8 = new Uint8Array(buf || []);
    if (u8.length < 8) return false;
    for (var i = 0; i < PNG_SIG.length; i++) {
      if (u8[i] !== PNG_SIG[i]) return false;
    }
    return true;
  }

  function readUint32BE(u8, offset) {
    return ((u8[offset] << 24) | (u8[offset + 1] << 16) | (u8[offset + 2] << 8) | u8[offset + 3]) >>> 0;
  }

  function chunkType(u8, offset) {
    return String.fromCharCode(u8[offset], u8[offset + 1], u8[offset + 2], u8[offset + 3]);
  }

  function parseTexChunk(data) {
    var nul = -1;
    for (var i = 0; i < data.length; i++) {
      if (data[i] === 0) { nul = i; break; }
    }
    if (nul < 0) return null;
    var keyword = String.fromCharCode.apply(null, data.subarray(0, nul));
    var text = new TextDecoder('latin1').decode(data.subarray(nul + 1));
    return { keyword: keyword, text: text };
  }

  function parseItxtChunk(data) {
    var nul = -1;
    for (var i = 0; i < data.length; i++) {
      if (data[i] === 0) { nul = i; break; }
    }
    if (nul < 0) return null;
    var keyword = String.fromCharCode.apply(null, data.subarray(0, nul));
    var rest = data.subarray(nul + 1);
    var off = 0;
    if (rest.length < 2) return null;
    off += 2;
    while (off < rest.length && rest[off] !== 0) off++;
    if (off >= rest.length) return null;
    off++;
    while (off < rest.length && rest[off] !== 0) off++;
    if (off >= rest.length) return null;
    off++;
    var text = new TextDecoder('utf-8').decode(rest.subarray(off));
    return { keyword: keyword, text: text };
  }

  function decodeUtf8Bytes(bytes) {
    if (!bytes || !bytes.length) return '';
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e1) {
      if (global.miyaDecodeGbkBuffer) {
        var gbk = global.miyaDecodeGbkBuffer(bytes);
        if (gbk) return gbk;
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  }

  function decodeBase64ToText(b64) {
    var clean = String(b64 || '').replace(/\s/g, '');
    if (!clean) return '';
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    return decodeUtf8Bytes(bytes);
  }

  function parseZtxtChunk(data) {
    var nul = -1;
    for (var i = 0; i < data.length; i++) {
      if (data[i] === 0) { nul = i; break; }
    }
    if (nul < 0) return null;
    var keyword = String.fromCharCode.apply(null, data.subarray(0, nul));
    var rest = data.subarray(nul + 1);
    if (rest.length < 2) return null;
    var compressed = rest[0] === 1;
    var method = rest[1];
    var off = 2;
    while (off < rest.length && rest[off] !== 0) off++;
    if (off >= rest.length) return null;
    off++;
    while (off < rest.length && rest[off] !== 0) off++;
    if (off >= rest.length) return null;
    off++;
    return {
      keyword: keyword,
      compressed: compressed,
      method: method,
      payload: rest.subarray(off)
    };
  }

  function inflateZlibBytes(payload) {
    payload = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
    if (!payload.length) return Promise.reject(new Error('empty_ztxt'));
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('no_inflate'));
    }
    try {
      var stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Response(stream).arrayBuffer().then(function (buf) {
        return new Uint8Array(buf);
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function decodeEmbeddedJson(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e1) {
      try {
        return JSON.parse(decodeBase64ToText(raw));
      } catch (e2) {
        return null;
      }
    }
  }

  function extractJsonFromPng(buf) {
    var u8 = new Uint8Array(buf);
    if (!isPngBuffer(buf)) return Promise.resolve(null);
    var offset = 8;
    var ztxtTasks = [];

    while (offset + 8 <= u8.length) {
      var length = readUint32BE(u8, offset);
      var type = chunkType(u8, offset + 4);
      var dataStart = offset + 8;
      var dataEnd = dataStart + length;
      if (dataEnd > u8.length) break;
      var chunkData = u8.subarray(dataStart, dataEnd);
      if (type === 'tEXt') {
        var tex = parseTexChunk(chunkData);
        if (tex && CHARA_KEYS.indexOf(tex.keyword) >= 0) {
          var parsed = decodeEmbeddedJson(tex.text);
          if (parsed) return Promise.resolve(parsed);
        }
      } else if (type === 'iTXt') {
        var itxt = parseItxtChunk(chunkData);
        if (itxt && CHARA_KEYS.indexOf(itxt.keyword) >= 0) {
          var parsed2 = decodeEmbeddedJson(itxt.text);
          if (parsed2) return Promise.resolve(parsed2);
        }
      } else if (type === 'zTXt') {
        var ztxt = parseZtxtChunk(chunkData);
        if (ztxt && CHARA_KEYS.indexOf(ztxt.keyword) >= 0) {
          ztxtTasks.push(ztxt);
        }
      }
      offset = dataEnd + 4;
    }

    if (!ztxtTasks.length) return Promise.resolve(null);

    var chain = Promise.resolve(null);
    ztxtTasks.forEach(function (ztxt) {
      chain = chain.then(function (found) {
        if (found) return found;
        var payloadPromise = ztxt.compressed
          ? inflateZlibBytes(ztxt.payload)
          : Promise.resolve(ztxt.payload);
        return payloadPromise.then(function (bytes) {
          var text = decodeUtf8Bytes(bytes);
          return decodeEmbeddedJson(text);
        }).catch(function () { return null; });
      });
    });
    return chain;
  }

  function looksLikeCharacterData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    var keys = [
      'name', 'char_name', 'description', 'char_persona', 'personality',
      'scenario', 'first_mes', 'char_greeting', 'mes_example', 'system_prompt',
      'character_book', 'creator_notes', 'post_history_instructions'
    ];
    for (var i = 0; i < keys.length; i++) {
      var val = obj[keys[i]];
      if (val != null && String(val).trim() !== '') return true;
    }
    if (Array.isArray(obj.alternate_greetings) && obj.alternate_greetings.length) return true;
    if (Array.isArray(obj.tags) && obj.tags.length) return true;
    return false;
  }

  function normalizeCharacterData(data) {
    if (!data || typeof data !== 'object') return null;
    var out = Object.assign({}, data);
    if (!String(out.name || '').trim() && out.char_name) out.name = out.char_name;
    if (!String(out.description || '').trim() && out.char_persona) out.description = out.char_persona;
    if (!String(out.first_mes || '').trim() && out.char_greeting) out.first_mes = out.char_greeting;
    if (!String(out.personality || '').trim() && out.char_personality) out.personality = out.char_personality;
    if (!String(out.scenario || '').trim() && out.world_scenario) out.scenario = out.world_scenario;
    if (!String(out.mes_example || '').trim() && out.example_dialogue) out.mes_example = out.example_dialogue;
    return out;
  }

  function parseMaybeJson(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    if (typeof value !== 'string') return null;
    var text = value.trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e1) {
      try {
        return JSON.parse(decodeBase64ToText(text));
      } catch (e2) {
        return null;
      }
    }
  }

  function unwrapCardRoot(raw) {
    if (raw == null) return null;

    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) {
        var fromArr = unwrapCardRoot(raw[i]);
        if (fromArr) return fromArr;
      }
      return null;
    }

    if (typeof raw !== 'object') {
      if (typeof raw === 'string') return unwrapCardRoot(parseMaybeJson(raw));
      return null;
    }

    var wrapKeys = ['character', 'card', 'char', 'chara_card', 'charaCard', 'chara_card_v2', 'chara_card_v3'];
    for (var w = 0; w < wrapKeys.length; w++) {
      var wrapped = raw[wrapKeys[w]];
      if (wrapped != null) {
        var fromWrap = unwrapCardRoot(wrapped);
        if (fromWrap) return fromWrap;
      }
    }

    if (raw.chara != null) {
      var fromChara = unwrapCardRoot(parseMaybeJson(raw.chara));
      if (fromChara) return fromChara;
    }
    if (raw.ccv3 != null) {
      var fromCcv3 = unwrapCardRoot(parseMaybeJson(raw.ccv3));
      if (fromCcv3) return fromCcv3;
    }

    if (raw.data != null) {
      var inner = parseMaybeJson(raw.data) || raw.data;
      if (inner && typeof inner === 'object') {
        var spec = String(raw.spec || '').toLowerCase();
        if (spec.indexOf('chara') >= 0 || spec.indexOf('ccv') >= 0 || raw.spec_version || looksLikeCharacterData(inner)) {
          return normalizeCharacterData(inner);
        }
      }
    }

    if (looksLikeCharacterData(raw)) {
      return normalizeCharacterData(raw);
    }

    return null;
  }

  function addSection(sections, label, val) {
    val = String(val || '').trim();
    if (val) sections.push('【' + label + '】\n' + val);
  }

  function buildPersonaFromCard(data) {
    var sections = [];
    addSection(sections, '描述', data.description);
    addSection(sections, '性格', data.personality);
    addSection(sections, '场景', data.scenario);
    addSection(sections, '系统提示', data.system_prompt);
    addSection(sections, '历史后指令', data.post_history_instructions);
    addSection(sections, '首条消息', data.first_mes);
    addSection(sections, '对话示例', data.mes_example);
    if (Array.isArray(data.alternate_greetings) && data.alternate_greetings.length) {
      addSection(sections, '备选开场', data.alternate_greetings.filter(Boolean).join('\n---\n'));
    }
    addSection(sections, '创作者备注', data.creator_notes);
    return sections.join('\n\n');
  }

  function extractWorldbook(data) {
    var book = data && data.character_book;
    if (!book || typeof book !== 'object') return null;
    var entries = Array.isArray(book.entries) ? book.entries : [];
    if (!entries.length) return null;
    return {
      name: String(book.name || book.description || '').trim(),
      entries: entries
    };
  }

  function mapCardToCharacter(data, avatar) {
    var persona = buildPersonaFromCard(data);
    var tags = Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean) : [];
    return {
      name: String(data.name || '').trim().slice(0, 32),
      persona: persona,
      avatar: avatar || '',
      tags: tags,
      gender: String(data.gender || (data.extensions && data.extensions.gender) || '').trim().slice(0, 16),
      age: data.age != null ? String(data.age).trim().slice(0, 8) : '',
      birthday: String(data.birthday || '').trim().slice(0, 24)
    };
  }

  function collectEntryKeywords(entry) {
    if (entry && entry.constant === true) return [];
    var keys = [];
    if (Array.isArray(entry.keys)) keys = keys.concat(entry.keys);
    else if (entry.key != null && entry.key !== '') keys.push(entry.key);
    if (Array.isArray(entry.secondary_keys)) keys = keys.concat(entry.secondary_keys);
    return keys.map(function (k) { return String(k || '').trim(); }).filter(Boolean);
  }

  function convertWorldbookEntry(entry, index, groupId, roleIds) {
    var keywords = collectEntryKeywords(entry);
    var name = String(entry.name || entry.comment || ('条目 ' + (index + 1))).trim() || ('条目 ' + (index + 1));
    return {
      name: name.slice(0, 48),
      keywords: keywords,
      content: String(entry.content || ''),
      scope: 'local',
      globalReach: 'all',
      depth: 'middle',
      groupId: groupId,
      boundRoleIds: roleIds.slice(),
      enabled: entry.enabled !== false
    };
  }

  function isValidUtf8(u8) {
    var i = 0;
    while (i < u8.length) {
      var b = u8[i];
      if (b <= 0x7F) { i++; continue; }
      if (b >= 0xC2 && b <= 0xDF) {
        if (i + 1 >= u8.length || (u8[i + 1] & 0xC0) !== 0x80) return false;
        i += 2;
        continue;
      }
      if (b >= 0xE0 && b <= 0xEF) {
        if (i + 2 >= u8.length) return false;
        var b1 = u8[i + 1];
        var b2 = u8[i + 2];
        if ((b1 & 0xC0) !== 0x80 || (b2 & 0xC0) !== 0x80) return false;
        if (b === 0xE0 && b1 < 0xA0) return false;
        if (b === 0xED && b1 >= 0xA0) return false;
        i += 3;
        continue;
      }
      if (b >= 0xF0 && b <= 0xF4) {
        if (i + 3 >= u8.length) return false;
        var c1 = u8[i + 1];
        var c2 = u8[i + 2];
        var c3 = u8[i + 3];
        if ((c1 & 0xC0) !== 0x80 || (c2 & 0xC0) !== 0x80 || (c3 & 0xC0) !== 0x80) return false;
        if (b === 0xF0 && c1 < 0x90) return false;
        if (b === 0xF4 && c1 >= 0x90) return false;
        i += 4;
        continue;
      }
      return false;
    }
    return true;
  }

  function decodeJsonTextBuffer(buf) {
    var u8 = new Uint8Array(buf || []);
    if (!u8.length) return '';

    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(u8.subarray(3));
    }
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(u8.subarray(2));
    }
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(u8.subarray(2));
    }

    if (isValidUtf8(u8)) {
      return new TextDecoder('utf-8').decode(u8);
    }
    return decodeUtf8Bytes(u8);
  }

  function parseJsonBuffer(buf) {
    var text = decodeJsonTextBuffer(buf).replace(/^\uFEFF/, '').trim();
    if (!text) return Promise.reject(new Error('empty_json'));
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return Promise.reject(new Error('invalid_json'));
    }
    var data = unwrapCardRoot(raw);
    if (!data) return Promise.reject(new Error('not_character_card'));
    return Promise.resolve(data);
  }

  function parseTavernCardFile(file) {
    if (!file) return Promise.reject(new Error('no_file'));
    var ext = extOf(file.name);
    var type = String(file.type || '').toLowerCase();

    if (ext === 'json' || type === 'application/json') {
      return readFileAsArrayBuffer(file).then(function (buf) {
        return parseJsonBuffer(buf).then(function (data) {
          return {
            character: mapCardToCharacter(data, ''),
            worldbook: extractWorldbook(data),
            source: 'json'
          };
        });
      });
    }

    if (ext === 'png' || type === 'image/png') {
      return Promise.all([
        readFileAsArrayBuffer(file),
        readFileAsDataUrl(file)
      ]).then(function (results) {
        var buf = results[0];
        var dataUrl = results[1];
        var embedded = extractJsonFromPng(buf);
        if (!embedded) return Promise.reject(new Error('png_no_chara'));
        return embedded.then(function (parsedRoot) {
          if (!parsedRoot) return Promise.reject(new Error('png_no_chara'));
          var data = unwrapCardRoot(parsedRoot);
          if (!data) return Promise.reject(new Error('not_character_card'));
          return {
            character: mapCardToCharacter(data, dataUrl || ''),
            worldbook: extractWorldbook(data),
            source: 'png'
          };
        });
      });
    }

    return readFileAsArrayBuffer(file).then(function (buf) {
      if (isPngBuffer(buf)) {
        return parseTavernCardFile(new File([buf], (file.name || 'card') + '.png', { type: 'image/png' }));
      }
      return parseJsonBuffer(buf).then(function (data) {
        return {
          character: mapCardToCharacter(data, ''),
          worldbook: extractWorldbook(data),
          source: 'json'
        };
      });
    });
  }

  function applyWorldbookForCharacter(characterRow, book) {
    var wbStore = global.miyaWorldbookStore;
    var cs = global.miyaContactsStore;
    if (!wbStore || !characterRow || !book) return Promise.resolve(null);
    var entries = Array.isArray(book.entries) ? book.entries : [];
    if (!entries.length) return Promise.resolve(null);

    var roleIds = [];
    var seen = {};
    [characterRow.id, characterRow.characterId].forEach(function (rid) {
      rid = String(rid || '').trim();
      if (!rid || seen[rid]) return;
      seen[rid] = true;
      roleIds.push(rid);
    });
    if (!roleIds.length) return Promise.resolve(null);

    var groupName = String(book.name || '').trim() || (String(characterRow.name || '').trim() + ' · 角色世界书');

    return wbStore.whenReady().then(function () {
      return wbStore.upsertGroup({ name: groupName, sort: Date.now() });
    }).then(function (group) {
      var chain = Promise.resolve(0);
      entries.forEach(function (entry, i) {
        chain = chain.then(function (count) {
          var next = convertWorldbookEntry(entry, i, group.id, roleIds);
          if (!next.content && !next.keywords.length) return count;
          return wbStore.upsertEntry(next).then(function () { return count + 1; });
        });
      });
      return chain.then(function (count) {
        if (cs && typeof cs.invalidateWbCountMap === 'function') cs.invalidateWbCountMap();
        return { groupId: group.id, groupName: group.name, count: count };
      });
    });
  }

  global.miyaTavernCardImport = {
    parseFile: parseTavernCardFile,
    applyWorldbookForCharacter: applyWorldbookForCharacter
  };
})(window);
