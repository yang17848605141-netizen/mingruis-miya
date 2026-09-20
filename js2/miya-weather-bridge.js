/**
 * miya-weather-bridge.js — 天气数据拉取、关心生成、同步到聊天天气感知
 * 天气 App 与聊天「天气感知」数据源分离；仅在用户点击同步时写入聊天设置。
 */
(function (global) {
  'use strict';

  var GEO_CACHE = Object.create(null);
  var FETCH_TIMEOUT = 10000;

  function store() {
    return global.miyaWeatherStore || null;
  }

  function fetchJson(url, opts) {
    opts = opts || {};
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    var p = fetch(url, {
      method: 'GET',
      signal: ctrl ? ctrl.signal : undefined,
      headers: opts.headers || {}
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
    if (ctrl) {
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (e) { /* ignore */ }
      }, opts.timeoutMs || FETCH_TIMEOUT);
    }
    return p.finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function weatherCodeToText(code) {
    var c = Number(code);
    if (!Number.isFinite(c)) return '';
    if (c === 0) return '晴';
    if (c === 1) return '晴间多云';
    if (c === 2) return '多云';
    if (c === 3) return '阴';
    if (c === 45 || c === 48) return '雾';
    if (c >= 51 && c <= 55) return '毛毛雨';
    if (c >= 56 && c <= 57) return '冻雨';
    if (c >= 61 && c <= 65) return '雨';
    if (c === 66 || c === 67) return '冻雨';
    if (c >= 71 && c <= 77) return '雪';
    if (c >= 80 && c <= 82) return '阵雨';
    if (c >= 85 && c <= 86) return '阵雪';
    if (c === 95) return '雷阵雨';
    if (c >= 96) return '雷暴';
    return '天气变化';
  }

  function weatherCodeToTheme(code) {
    var c = Number(code);
    if (!Number.isFinite(c)) return 'cloudy';
    if (c === 0 || c === 1) return 'clear';
    if (c === 2) return 'partly';
    if (c === 3) return 'overcast';
    if (c === 45 || c === 48) return 'fog';
    if (c >= 71 && c <= 77) return 'snow';
    if (c >= 85 && c <= 86) return 'snow';
    if (c >= 95) return 'thunder';
    if (c >= 51 && c <= 67) return 'rain';
    if (c >= 80 && c <= 82) return 'rain';
    return 'cloudy';
  }

  function weatherIcon(code) {
    var theme = weatherCodeToTheme(code);
    if (theme === 'clear') return '☀️';
    if (theme === 'partly') return '🌤';
    if (theme === 'overcast' || theme === 'cloudy') return '☁️';
    if (theme === 'fog') return '🌫';
    if (theme === 'rain') return '🌧';
    if (theme === 'snow') return '❄️';
    if (theme === 'thunder') return '⛈';
    return '🌤';
  }

  function roundTemp(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.round(v);
  }

  function parseHourly(data, limit) {
    var h = data && data.hourly ? data.hourly : {};
    var times = Array.isArray(h.time) ? h.time : [];
    var temps = Array.isArray(h.temperature_2m) ? h.temperature_2m : [];
    var codes = Array.isArray(h.weather_code) ? h.weather_code : [];
    var pops = Array.isArray(h.precipitation_probability) ? h.precipitation_probability : [];
    var now = Date.now();
    var out = [];
    var i;
    for (i = 0; i < times.length; i++) {
      var t = Date.parse(times[i]);
      if (!Number.isFinite(t)) continue;
      if (t < now - 45 * 60 * 1000) continue;
      out.push({
        time: times[i],
        ts: t,
        temp: roundTemp(temps[i]),
        code: Number(codes[i]),
        text: weatherCodeToText(codes[i]),
        theme: weatherCodeToTheme(codes[i]),
        pop: Number.isFinite(Number(pops[i])) ? Number(pops[i]) : null
      });
      if (out.length >= (limit || 24)) break;
    }
    return out;
  }

  function parseDaily(data, limit) {
    var d = data && data.daily ? data.daily : {};
    var times = Array.isArray(d.time) ? d.time : [];
    var mins = Array.isArray(d.temperature_2m_min) ? d.temperature_2m_min : [];
    var maxs = Array.isArray(d.temperature_2m_max) ? d.temperature_2m_max : [];
    var codes = Array.isArray(d.weather_code) ? d.weather_code : [];
    var pops = Array.isArray(d.precipitation_probability_max) ? d.precipitation_probability_max : [];
    var out = [];
    var i;
    for (i = 0; i < times.length && out.length < (limit || 10); i++) {
      out.push({
        date: times[i],
        tempMin: roundTemp(mins[i]),
        tempMax: roundTemp(maxs[i]),
        code: Number(codes[i]),
        text: weatherCodeToText(codes[i]),
        theme: weatherCodeToTheme(codes[i]),
        pop: Number.isFinite(Number(pops[i])) ? Number(pops[i]) : null
      });
    }
    return out;
  }

  function normalizeForecast(data) {
    if (!data) return null;
    var cur = data.current || {};
    var code = Number(cur.weather_code);
    var hourly = parseHourly(data, 24);
    var daily = parseDaily(data, 10);
    var tempNow = roundTemp(cur.temperature_2m);
    var tempMin = daily[0] ? daily[0].tempMin : null;
    var tempMax = daily[0] ? daily[0].tempMax : null;
    var wind = Number(cur.wind_speed_10m);
    return {
      tempNow: tempNow,
      tempMin: tempMin,
      tempMax: tempMax,
      code: code,
      text: weatherCodeToText(code),
      theme: weatherCodeToTheme(code),
      wind: Number.isFinite(wind) ? Math.round(wind) : null,
      hourly: hourly,
      daily: daily,
      timezone: String(data.timezone || ''),
      fetchedAt: Date.now()
    };
  }

  function fetchForecast(lat, lon, opts) {
    opts = opts || {};
    var st = store();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve(null);
    if (!opts.force && st) {
      var hit = st.getForecastCache(lat, lon);
      var maxAge = opts.maxAgeMs != null ? opts.maxAgeMs : 15 * 60 * 1000;
      if (hit && hit.data && Date.now() - (hit.fetchedAt || 0) < maxAge) {
        return Promise.resolve(hit.data);
      }
    }
    var url =
      'https://api.open-meteo.com/v1/forecast?latitude=' +
      encodeURIComponent(String(lat)) +
      '&longitude=' +
      encodeURIComponent(String(lon)) +
      '&current=temperature_2m,weather_code,wind_speed_10m' +
      '&hourly=temperature_2m,weather_code,precipitation_probability' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&forecast_days=10';
    return fetchJson(url).then(function (data) {
      var norm = normalizeForecast(data);
      if (norm && st) st.setForecastCache(lat, lon, norm);
      return norm;
    });
  }

  function searchPlaces(query) {
    var q = String(query || '').trim();
    if (!q) return Promise.resolve([]);
    var key = q.toLowerCase();
    var hit = GEO_CACHE[key];
    if (hit && Date.now() - hit.ts < 3600000) return Promise.resolve(hit.rows);

    function parse(data) {
      var rows = data && Array.isArray(data.results) ? data.results : [];
      return rows
        .map(function (r) {
          var lat = Number(r.latitude);
          var lon = Number(r.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
          var parts = [r.name, r.admin1, r.country].filter(Boolean);
          return {
            name: String(r.name || '').trim(),
            label: parts.join(' · '),
            lat: lat,
            lon: lon,
            country: String(r.country || ''),
            admin1: String(r.admin1 || '')
          };
        })
        .filter(Boolean);
    }

    var url =
      'https://geocoding-api.open-meteo.com/v1/search?count=8&language=zh&format=json&name=' +
      encodeURIComponent(q);
    return fetchJson(url)
      .then(parse)
      .then(function (rows) {
        if (rows.length) {
          GEO_CACHE[key] = { ts: Date.now(), rows: rows };
          return rows;
        }
        // 中文地名偶发需要加国家过滤再试一次
        return fetchJson(
          'https://geocoding-api.open-meteo.com/v1/search?count=8&language=zh&format=json&countryCode=CN&name=' +
            encodeURIComponent(q)
        ).then(function (data) {
          var rows2 = parse(data);
          GEO_CACHE[key] = { ts: Date.now(), rows: rows2 };
          return rows2;
        });
      })
      .catch(function () {
        return [];
      });
  }

  /**
   * 从反向地理编码结果拼出「市 + 区/县」级地名（天气 App 专用）。
   * BigDataCloud 的 city 多为地级市；区/县在 locality 或 adminLevel 6。
   */
  function formatReversePlaceName(data) {
    if (!data || typeof data !== 'object') return '';
    var admins =
      data.localityInfo && Array.isArray(data.localityInfo.administrative)
        ? data.localityInfo.administrative
        : [];
    var byLevel = Object.create(null);
    admins.forEach(function (a) {
      if (!a || !a.name) return;
      var lv = Number(a.adminLevel);
      var name = String(a.name || '').trim();
      if (!Number.isFinite(lv) || !name) return;
      byLevel[lv] = name;
    });

    var city = byLevel[5] || String(data.city || '').trim();
    var county = byLevel[6] || '';
    /* 少数地区区县落在 7；仅当 6 缺失时补用 */
    if (!county && byLevel[7]) county = byLevel[7];

    var locality = String(data.locality || '').trim();
    var province =
      byLevel[4] || String(data.principalSubdivision || '').trim();
    if (!county && locality && locality !== city && locality !== province) {
      county = locality;
    }

    if (city && county && city !== county) {
      if (county.indexOf(city) === 0) return county;
      return city + county;
    }
    return (
      county ||
      city ||
      locality ||
      province ||
      String(data.countryName || '').trim() ||
      ''
    );
  }

  function reverseGeocode(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve('');
    var url =
      'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
      encodeURIComponent(String(lat)) +
      '&longitude=' +
      encodeURIComponent(String(lon)) +
      '&localityLanguage=zh';
    return fetchJson(url)
      .then(function (data) {
        if (!data) return '';
        return formatReversePlaceName(data);
      })
      .catch(function () {
        return '';
      });
  }

  function requestMyLocation() {
    var st = store();
    if (!st) return Promise.reject(new Error('天气存储未加载'));
    if (!navigator.geolocation) {
      st.setMyLocation({ permission: 'denied' });
      return Promise.reject(new Error('当前环境不支持定位'));
    }
    return new Promise(function (resolve, reject) {
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          var lat = Number(pos.coords.latitude);
          var lon = Number(pos.coords.longitude);
          reverseGeocode(lat, lon).then(function (name) {
            var loc = st.setMyLocation({
              lat: lat,
              lon: lon,
              name: name || '我的位置',
              source: 'gps',
              permission: 'granted'
            });
            resolve(loc);
          });
        },
        function (err) {
          st.setMyLocation({ permission: 'denied' });
          reject(err || new Error('定位失败'));
        },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
      );
    });
  }

  function setMyLocationManual(place) {
    var st = store();
    if (!st || !place) return null;
    return st.setMyLocation({
      lat: Number(place.lat),
      lon: Number(place.lon),
      name: String(place.name || place.label || '已选位置').trim(),
      source: 'manual',
      permission: 'granted'
    });
  }

  function resolveProfileForContact(contact, chat) {
    var cs = global.miyaChatStore;
    if (!cs) return null;
    var profiles = cs.getProfiles ? cs.getProfiles() : [];
    var boundId = '';
    if (contact && contact.defaultProfileId) {
      boundId = String(contact.defaultProfileId).trim();
    }
    if (!boundId && chat && chat.profileId) {
      boundId = String(chat.profileId).trim();
    }
    if (boundId) {
      var found = profiles.find(function (p) {
        return p && p.id === boundId;
      });
      if (found) return found;
    }
    return cs.getActiveProfile ? cs.getActiveProfile() : null;
  }

  function resolveContactContext(contactId) {
    var cs = global.miyaChatStore;
    var contact = null;
    if (cs && cs.findContact) contact = cs.findContact(contactId);
    if (!contact && cs && cs.getContacts) {
      contact = (cs.getContacts() || []).find(function (c) {
        return c && String(c.id) === String(contactId);
      }) || null;
    }
    if (!contact) {
      return { contact: null, profile: null, chat: null, settings: {} };
    }
    var profileId = String(contact.defaultProfileId || '').trim();
    var chat = cs && cs.findChatByContact ? cs.findChatByContact(contact.id, profileId) : null;
    if (!chat && cs && cs.findChatByContact) chat = cs.findChatByContact(contact.id, '');
    var profile = resolveProfileForContact(contact, chat);
    var settings = {};
    if (chat && chat.id && cs.getChatSettings) {
      settings = cs.getChatSettings(chat.id) || {};
    } else {
      settings = Object.assign(
        {},
        contact.chatSettings && typeof contact.chatSettings === 'object' ? contact.chatSettings : {}
      );
      if (contact.relationship) settings.relationship = contact.relationship;
    }
    return { contact: contact, profile: profile, chat: chat, settings: settings };
  }

  function truncateStr(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    return s.slice(0, n) + '…';
  }

  function buildUserRelationBlock(contact, profile, settings) {
    var aw = global.MiyaChatAwareness;
    var eng = global.miyaChatEngine;
    var parts = [
      '【用户面具与双方关系】',
      '以下是绑定给该角色的用户身份（不是全局默认面具）及双方关系。'
    ];
    var userBlock =
      eng && typeof eng.renderProfileBlock === 'function'
        ? String(eng.renderProfileBlock(profile) || '').trim()
        : '';
    if (userBlock) {
      parts.push(userBlock);
    } else if (profile) {
      var userLines = ['【用户身份·我方·' + String(profile.name || '未命名') + '】'];
      if (profile.gender) userLines.push('- 性别: ' + profile.gender);
      if (profile.birthday) userLines.push('- 生日: ' + profile.birthday);
      if (profile.persona) userLines.push('- 人设: ' + profile.persona);
      if (userLines.length > 1) parts.push(userLines.join('\n'));
    }
    if (aw && typeof aw.buildRelationshipLine === 'function') {
      var relLine = aw.buildRelationshipLine(settings, contact);
      if (relLine) parts.push('【双方关系】\n' + relLine);
    } else if (settings && settings.relationship) {
      parts.push('【双方关系】\n你们当前的关系是：' + String(settings.relationship).trim());
    }
    if (contact && contact.remarkName) {
      parts.push('用户对角色的备注称呼：' + String(contact.remarkName).trim());
    }
    return parts.join('\n\n');
  }

  function buildCharacterBlock(contact) {
    var cts = global.miyaContactsStore;
    var parts = [];
    var roleId = String((contact && contact.characterId) || (contact && contact.chronicleId) || '').trim();
    parts.push('【角色名】' + String((contact && contact.name) || '未知'));
    if (roleId && cts && typeof cts.renderChronicleBlock === 'function') {
      var ch = String(cts.renderChronicleBlock(roleId) || '').trim();
      if (ch) parts.push(ch);
    }
    if (contact && contact.persona) {
      parts.push('【补充人设】\n' + truncateStr(contact.persona, 1000));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function loadForumBridgeIfNeeded() {
    if (global.miyaForumBridge && typeof global.miyaForumBridge.callItineraryCompletionsRaw === 'function') {
      return Promise.resolve();
    }
    if (global.miyaLazyEnsure) {
      return global.miyaLazyEnsure('weatherUi').catch(function () {
        return global.miyaLazyEnsure('theaterUi');
      });
    }
    return Promise.reject(new Error('对话 API 未加载'));
  }

  function callDialogueApi(systemHint, userContent) {
    return loadForumBridgeIfNeeded().then(function () {
      var br = global.miyaForumBridge;
      // 优先走对话（聊天）API，与日记/行程的专用配置区分
      if (br && typeof br.callMainChatCompletionsRaw === 'function') {
        return br.callMainChatCompletionsRaw(systemHint, userContent, undefined, {
          skipUniversalWorldbook: true,
          contentOnly: true,
          disableThinking: true
        });
      }
      if (br && typeof br.callChatCompletionsRaw === 'function') {
        return br.callChatCompletionsRaw(systemHint, userContent);
      }
      if (br && typeof br.callItineraryCompletionsRaw === 'function') {
        return br.callItineraryCompletionsRaw(systemHint, userContent);
      }
      return Promise.reject(new Error('对话 API 未加载，请先配置模型'));
    });
  }

  function cleanCareText(raw) {
    var t = String(raw || '').trim();
    if (!t) return '';
    t = t.replace(/^```[\s\S]*?```$/m, function (m) {
      return m.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    });
    t = t.replace(/^["「『]|["」』]$/g, '').trim();
    t = t.replace(/\n{3,}/g, '\n\n');
    if (t.length > 180) t = t.slice(0, 180).trim();
    return t;
  }

  function formatWeatherLine(forecast, placeName) {
    if (!forecast) return String(placeName || '') + '：暂无天气数据';
    var parts = [];
    if (placeName) parts.push(placeName);
    if (forecast.text) parts.push(forecast.text);
    if (forecast.tempNow != null) parts.push('当前' + forecast.tempNow + '°');
    if (forecast.tempMin != null && forecast.tempMax != null) {
      parts.push('今日' + forecast.tempMin + '°~' + forecast.tempMax + '°');
    }
    return parts.join('，');
  }

  /** 同一角色生成中互斥，避免后台扫描与打开天气 App 并发重复发 */
  var careInFlight = Object.create(null);
  var CARE_CLAIM_TTL_MS = 120000;

  function hasCharacterCareToday(contactId) {
    var st = store();
    if (!st) return false;
    if (typeof st.hasCharacterCareToday === 'function') {
      return !!st.hasCharacterCareToday(contactId);
    }
    var today = st.isoDate(new Date());
    var key = String(contactId || '');
    return (st.listCares({ contactId: key }) || []).some(function (c) {
      if (!c || String(c.date) !== today) return false;
      return String(c.text || '').indexOf('【我送出的关心】') !== 0;
    });
  }

  function claimDailyCareSlot(contactId) {
    var st = store();
    if (!st) return false;
    var key = String(contactId || '');
    if (!key) return false;
    if (careInFlight[key]) return false;
    if (hasCharacterCareToday(key)) return false;
    var today = st.isoDate(new Date());
    var setting = st.getCareSetting(key);
    if (setting.lastCareDate === today) {
      var age = Date.now() - (Number(setting.lastCareAt) || 0);
      /* 已有今日记录，或刚占位尚未写完：拒绝；超时且无记录允许补发 */
      if (hasCharacterCareToday(key)) return false;
      if (age < CARE_CLAIM_TTL_MS) return false;
    }
    careInFlight[key] = true;
    st.setCareSetting(key, { lastCareDate: today, lastCareAt: Date.now() });
    return true;
  }

  function releaseDailyCareSlot(contactId, ok) {
    var key = String(contactId || '');
    delete careInFlight[key];
    if (ok) return;
    var st = store();
    if (!st || hasCharacterCareToday(key)) return;
    var today = st.isoDate(new Date());
    var setting = st.getCareSetting(key);
    if (setting.lastCareDate === today) {
      st.setCareSetting(key, { lastCareDate: '', lastCareAt: 0 });
    }
  }

  function generateCareForContact(contactId, opts) {
    opts = opts || {};
    var st = store();
    if (!st) return Promise.reject(new Error('天气存储未加载'));
    var ctx = resolveContactContext(contactId);
    if (!ctx.contact) return Promise.reject(new Error('找不到角色'));

    var key = String(ctx.contact.id);
    /* 每人每天只发一次：生成前先占位，防止并发重复 */
    if (!opts.force && !claimDailyCareSlot(key)) {
      return Promise.reject(new Error('今天已经发过关心了'));
    }
    if (opts.force) {
      if (careInFlight[key]) return Promise.reject(new Error('正在生成中'));
      careInFlight[key] = true;
    }

    var me = st.getMyLocation();
    if (!Number.isFinite(me.lat) || !Number.isFinite(me.lon)) {
      releaseDailyCareSlot(key, false);
      return Promise.reject(new Error('请先在天气 App 授权或设置「我的位置」'));
    }

    return fetchForecast(me.lat, me.lon)
      .then(function (forecast) {
        var weatherLine = formatWeatherLine(forecast, me.name || '用户所在地');
        var systemHint =
          '你正在扮演下方角色，通过天气 App 给用户发一条简短关心问候。' +
          '这不是聊天消息，而是写在天气里的关心卡片。' +
          '要求：1～3 句口语、贴合人设与双方关系、结合用户当地天气；不要播报体；不要自称 AI；不要用标题或列表。';
        var userContent = [
          buildCharacterBlock(ctx.contact),
          buildUserRelationBlock(ctx.contact, ctx.profile, ctx.settings),
          '【用户当地天气】\n' + weatherLine,
          '请直接输出关心正文。'
        ]
          .filter(Boolean)
          .join('\n\n');

        return callDialogueApi(systemHint, userContent).then(function (raw) {
          var text = cleanCareText(raw);
          if (!text) throw new Error('关心生成结果为空');
          var name = String(ctx.contact.remarkName || ctx.contact.name || 'TA').trim();
          var care = st.addCare({
            contactId: key,
            contactName: name,
            date: st.isoDate(new Date()),
            text: text,
            weatherSnapshot: {
              name: me.name || '我的位置',
              text: forecast && forecast.text,
              temp: forecast && forecast.tempNow,
              high: forecast && forecast.tempMax,
              low: forecast && forecast.tempMin
            }
          });
          return care;
        });
      })
      .then(function (care) {
        releaseDailyCareSlot(key, true);
        return care;
      })
      .catch(function (err) {
        releaseDailyCareSlot(key, false);
        throw err;
      });
  }

  function formatCareThreadForPrompt(care) {
    var lines = [];
    var raw = String((care && care.text) || '').trim();
    var isUserSent = raw.indexOf('【我送出的关心】') === 0;
    var name = String((care && care.contactName) || 'TA').trim() || 'TA';
    if (raw) {
      if (isUserSent) lines.push('我：' + raw.replace(/^【我送出的关心】/, ''));
      else lines.push(name + '：' + raw);
    }
    (Array.isArray(care && care.replies) ? care.replies : []).forEach(function (r) {
      if (!r || !r.text) return;
      var who = r.from === 'char' ? name : '我';
      lines.push(who + '：' + String(r.text).trim());
    });
    return lines.join('\n');
  }

  /** 角色继续回应用户（天气关心线程，不进聊天） */
  function generateCharacterCareFollowUp(careId) {
    var st = store();
    if (!st) return Promise.reject(new Error('天气存储未加载'));
    var care = st.getCare(careId);
    if (!care) return Promise.reject(new Error('找不到这条关心'));
    var ctx = resolveContactContext(care.contactId);
    if (!ctx.contact) return Promise.reject(new Error('找不到角色'));

    var me = st.getMyLocation();
    var city = st.findCityByContact(care.contactId);
    var pack = { meFc: null, roleFc: null };
    var jobs = [];
    if (Number.isFinite(me.lat) && Number.isFinite(me.lon)) {
      jobs.push(
        fetchForecast(me.lat, me.lon).then(function (fc) {
          pack.meFc = fc;
        })
      );
    }
    if (city && Number.isFinite(city.lat) && Number.isFinite(city.lon)) {
      jobs.push(
        fetchForecast(city.lat, city.lon).then(function (fc) {
          pack.roleFc = fc;
        })
      );
    }

    return Promise.all(jobs).then(function () {
      var userWeather = formatWeatherLine(pack.meFc, me.name || '用户所在地');
      var roleWeather = city
        ? formatWeatherLine(pack.roleFc, city.name)
        : '角色城市未绑定。';
      var thread = formatCareThreadForPrompt(care);
      var name = String(ctx.contact.remarkName || ctx.contact.name || 'TA').trim();
      var systemHint =
        '你正在扮演下方角色，在天气 App 里继续回应用户刚才的话。' +
        '这不是聊天消息，而是天气关心卡片里的往返短对话。' +
        '要求：1～3 句口语、贴合人设与双方关系；可结合天气；不要播报体；不要自称 AI；不要用标题或列表。';
      var userContent = [
        buildCharacterBlock(ctx.contact),
        buildUserRelationBlock(ctx.contact, ctx.profile, ctx.settings),
        '【用户当地天气】\n' + userWeather,
        '【角色当地天气】\n' + roleWeather,
        '【天气关心对话】\n' + (thread || '（暂无）'),
        '请以「' + name + '」的口吻直接输出下一句回复正文。'
      ]
        .filter(Boolean)
        .join('\n\n');

      return callDialogueApi(systemHint, userContent).then(function (raw) {
        var text = cleanCareText(raw);
        if (!text) throw new Error('角色回复为空');
        st.addCareReply(careId, text, { from: 'char' });
        return text;
      });
    });
  }

  /**
   * 用户回复关心：先写入用户一句，再调用 API 让角色继续回。
   */
  function replyToCareWithFollowUp(careId, userText) {
    var st = store();
    if (!st) return Promise.reject(new Error('天气存储未加载'));
    var line = String(userText || '').trim();
    if (!line) return Promise.reject(new Error('请输入内容'));
    st.addCareReply(careId, line, { from: 'user' });
    return generateCharacterCareFollowUp(careId).then(function (charLine) {
      return { userText: line, charText: charLine };
    });
  }

  /** 用户主动送关心后，让角色立刻回一句 */
  function sendUserCareWithFollowUp(contactId, userText) {
    var st = store();
    if (!st) return Promise.reject(new Error('天气存储未加载'));
    var text = String(userText || '').trim();
    if (!text) return Promise.reject(new Error('请输入内容'));
    var ctx = resolveContactContext(contactId);
    if (!ctx.contact) return Promise.reject(new Error('找不到角色'));
    var name = String(ctx.contact.remarkName || ctx.contact.name || 'TA').trim();
    var city = st.findCityByContact(contactId);

    var chain = Promise.resolve(null);
    if (city && Number.isFinite(city.lat) && Number.isFinite(city.lon)) {
      chain = fetchForecast(city.lat, city.lon);
    }

    return chain.then(function (roleForecast) {
      var snap = null;
      if (city) {
        snap = {
          name: city.name,
          text: roleForecast && roleForecast.text,
          temp: roleForecast && roleForecast.tempNow,
          high: roleForecast && roleForecast.tempMax,
          low: roleForecast && roleForecast.tempMin
        };
      }
      var care = st.addCare({
        contactId: String(ctx.contact.id),
        contactName: name,
        date: st.isoDate(new Date()),
        text: '【我送出的关心】' + text,
        weatherSnapshot: snap,
        replies: []
      });
      if (!care) throw new Error('保存失败');
      return generateCharacterCareFollowUp(care.id).then(function (charLine) {
        return { care: care, charText: charLine };
      });
    });
  }

  /**
   * 将天气 App 的「我的位置 / 角色城市」写入当前聊天的天气感知字段。
   * 聊天设置里点「同步天气 App」后会继续自动感知拉取天气。
   */
  function syncAppToChatWeatherAwareness(chatId, contactId) {
    var st = store();
    var cs = global.miyaChatStore;
    if (!st || !cs || !cs.getChatSettings || !cs.saveChatSettings) {
      return Promise.reject(new Error('无法同步：模块未就绪'));
    }
    var settings = cs.getChatSettings(chatId) || {};
    var aw = global.MiyaChatAwareness;
    var wa = aw && aw.normalizeWeatherAwareness
      ? aw.normalizeWeatherAwareness(settings.weatherAwareness)
      : Object.assign({}, settings.weatherAwareness || {});

    var me = st.getMyLocation();
    var roleCity = contactId ? st.findCityByContact(contactId) : null;

    if (me && me.name) {
      wa.realLocUser = String(me.name).trim();
      if (!wa.placeUser) wa.placeUser = wa.realLocUser;
      if (Number.isFinite(me.lat)) wa.mappedLatUser = me.lat;
      if (Number.isFinite(me.lon)) wa.mappedLonUser = me.lon;
    }
    if (roleCity && roleCity.name) {
      wa.realLocRole = String(roleCity.name).trim();
      if (!wa.placeRole) wa.placeRole = wa.realLocRole;
      if (Number.isFinite(roleCity.lat)) wa.mappedLatRole = roleCity.lat;
      if (Number.isFinite(roleCity.lon)) wa.mappedLonRole = roleCity.lon;
    }

    wa.settingsUiVersion = 2;
    return cs.saveChatSettings(chatId, { weatherAwareness: wa }).then(function () {
      return wa;
    });
  }

  function parseHm(s) {
    var m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    var h = Number(m[1]);
    var min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function inCareWindow(setting, now) {
    now = now instanceof Date ? now : new Date();
    var start = parseHm(setting && setting.windowStart);
    var end = parseHm(setting && setting.windowEnd);
    if (start == null || end == null) return false;
    var cur = now.getHours() * 60 + now.getMinutes();
    if (start === end) return true;
    if (start < end) return cur >= start && cur < end;
    return cur >= start || cur < end;
  }

  function shouldSendCareToday(contactId) {
    var st = store();
    if (!st) return false;
    var key = String(contactId || '');
    var setting = st.getCareSetting(key);
    if (!setting.enabled) return false;
    if (!inCareWindow(setting, new Date())) return false;
    if (careInFlight[key]) return false;
    /* 已有今日角色关心 → 绝不重复 */
    if (hasCharacterCareToday(key)) return false;
    var today = st.isoDate(new Date());
    if (setting.lastCareDate === today) {
      var age = Date.now() - (Number(setting.lastCareAt) || 0);
      /* 占位中或刚发完：跳过；仅当占位超时且无记录时才允许补发 */
      if (age < CARE_CLAIM_TTL_MS) return false;
    }
    return true;
  }

  function listEligibleCareContacts() {
    var st = store();
    var cs = global.miyaChatStore;
    if (!st || !cs || !cs.getContacts) return [];
    return (cs.getContacts() || []).filter(function (c) {
      return c && !c.isGroup && shouldSendCareToday(c.id);
    });
  }

  function runDueCares(opts) {
    opts = opts || {};
    var list = listEligibleCareContacts();
    if (!list.length) return Promise.resolve([]);
    var results = [];
    var i = 0;

    function next() {
      if (i >= list.length) return Promise.resolve(results);
      if (!opts.force && i >= 3) return Promise.resolve(results);
      var contact = list[i++];
      return generateCareForContact(contact.id)
        .then(function (care) {
          results.push({ ok: true, care: care, contactId: contact.id });
        })
        .catch(function (err) {
          results.push({ ok: false, error: err, contactId: contact.id });
        })
        .then(next);
    }

    return next();
  }

  global.miyaWeatherBridge = {
    weatherCodeToText: weatherCodeToText,
    weatherCodeToTheme: weatherCodeToTheme,
    weatherIcon: weatherIcon,
    fetchForecast: fetchForecast,
    searchPlaces: searchPlaces,
    reverseGeocode: reverseGeocode,
    formatReversePlaceName: formatReversePlaceName,
    requestMyLocation: requestMyLocation,
    setMyLocationManual: setMyLocationManual,
    resolveContactContext: resolveContactContext,
    generateCareForContact: generateCareForContact,
    generateCharacterCareFollowUp: generateCharacterCareFollowUp,
    replyToCareWithFollowUp: replyToCareWithFollowUp,
    sendUserCareWithFollowUp: sendUserCareWithFollowUp,
    syncAppToChatWeatherAwareness: syncAppToChatWeatherAwareness,
    shouldSendCareToday: shouldSendCareToday,
    listEligibleCareContacts: listEligibleCareContacts,
    runDueCares: runDueCares,
    inCareWindow: inCareWindow,
    hasCharacterCareToday: hasCharacterCareToday,
    formatWeatherLine: formatWeatherLine
  };

  /* 后台扫描：在问候时段内自动生成关心（不进聊天） */
  var careScanTimer = null;
  var careScanBusy = false;

  /* 应用内顶部长条弹窗（与消息弹窗同位置） */
  var CARE_BANNER_SLOT_MS = 2600;
  var CARE_BANNER_LAST_HOLD_MS = 2200;
  var careBannerQueue = [];
  var careBannerBusy = false;
  var careBannerHideTimer = null;
  var careBannerRoot = null;
  var careBannerCard = null;

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function careAvatarSvg(name) {
    var ch = Array.from(String(name || '?').trim() || '?')[0] || '?';
    return (
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
          '<rect width="80" height="80" rx="16" fill="#EEF1F5"/>' +
          '<text x="40" y="48" text-anchor="middle" font-family="system-ui,sans-serif" font-size="28" fill="#8B919A">' +
          ch +
          '</text></svg>'
      )
    );
  }

  function resolveCareAvatar(care) {
    var cid = care && care.contactId ? String(care.contactId) : '';
    var name = (care && care.contactName) || 'TA';
    if (!cid) return careAvatarSvg(name);
    var cs = global.miyaChatStore;
    var contact = cs && cs.findContact ? cs.findContact(cid) : null;
    var extras = global.miyaChatRoomExtras;
    if (extras && typeof extras.resolveContactAvatarUrl === 'function' && contact) {
      var url = extras.resolveContactAvatarUrl(contact);
      if (url) return url;
    }
    if (contact && contact.avatar) return String(contact.avatar);
    return careAvatarSvg(name);
  }

  function systemNotifyEnabled() {
    var N = global.MiyaChatNotify;
    if (N && typeof N.systemNotifyEnabled === 'function') return !!N.systemNotifyEnabled();
    var Api = global.miyaGetNotificationApi ? global.miyaGetNotificationApi() : typeof Notification !== 'undefined' ? Notification : null;
    if (!Api) return false;
    try {
      if (Api.permission !== 'granted') return false;
    } catch (e) {
      return false;
    }
    if (global.miyaGetSystemPrefs) {
      var p = global.miyaGetSystemPrefs();
      return !!(p && p.notify);
    }
    return false;
  }

  function isWeatherAppOpen() {
    var el = document.getElementById('miya-weather-app');
    return !!(el && el.classList.contains('is-open') && !el.hasAttribute('hidden'));
  }

  function isWeatherCareDetailOpen(careId) {
    if (!isWeatherAppOpen() || !careId) return false;
    var app = global.miyaWeatherApp;
    if (app && typeof app.getOpenCareId === 'function') {
      return String(app.getOpenCareId() || '') === String(careId);
    }
    return false;
  }

  function shouldSystemNotifyCare(care) {
    void care;
    if (!systemNotifyEnabled()) return false;
    if (document.hidden) return true;
    /* 天气 App 已在前台时只走应用内顶栏，避免重复打扰 */
    if (isWeatherAppOpen()) return false;
    return true;
  }

  function shouldInAppCareBanner(care) {
    if (document.hidden) return false;
    if (care && isWeatherCareDetailOpen(care.id)) return false;
    return true;
  }

  function ensureCareBannerRoot() {
    if (careBannerRoot && careBannerRoot.parentNode) return careBannerRoot;
    careBannerRoot = document.getElementById('miya-wx-care-pop-root');
    if (!careBannerRoot) {
      careBannerRoot = document.createElement('div');
      careBannerRoot.id = 'miya-wx-care-pop-root';
      careBannerRoot.className = 'miya-wx-care-pop-root';
      careBannerRoot.setAttribute('aria-live', 'polite');
      careBannerRoot.hidden = true;
      document.body.appendChild(careBannerRoot);
    }
    return careBannerRoot;
  }

  function setCareBannerHostVisible(visible) {
    var root = ensureCareBannerRoot();
    if (visible) {
      root.hidden = false;
      root.removeAttribute('aria-hidden');
    } else {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
    }
  }

  function hideCareBannerCard(done) {
    if (!careBannerCard) {
      setCareBannerHostVisible(false);
      if (done) done();
      return;
    }
    careBannerCard.classList.remove('is-visible', 'is-swapping');
    careBannerCard.classList.add('is-leaving');
    setTimeout(function () {
      if (careBannerCard) careBannerCard.classList.remove('is-leaving');
      setCareBannerHostVisible(false);
      if (done) done();
    }, 280);
  }

  function renderCareBannerCard(care) {
    setCareBannerHostVisible(true);
    var root = ensureCareBannerRoot();
    if (!careBannerCard) {
      careBannerCard = document.createElement('button');
      careBannerCard.type = 'button';
      careBannerCard.className = 'miya-wx-care-pop';
      careBannerCard.setAttribute('aria-label', '打开天气关心');
      careBannerCard.addEventListener('click', function () {
        var id = careBannerCard.getAttribute('data-care-id');
        if (id) openWeatherCare(id);
      });
      root.appendChild(careBannerCard);
    }
    var name = String((care && care.contactName) || 'TA').trim() || 'TA';
    var body = String((care && care.text) || '').trim();
    if (body.length > 100) body = body.slice(0, 97) + '…';
    careBannerCard.setAttribute('data-care-id', String((care && care.id) || ''));
    careBannerCard.innerHTML =
      '<img class="miya-wx-care-pop__avatar" src="' +
      escHtml(resolveCareAvatar(care)) +
      '" alt="">' +
      '<span class="miya-wx-care-pop__body">' +
      '<span class="miya-wx-care-pop__head">' +
      '<span class="miya-wx-care-pop__name">' +
      escHtml(name) +
      '</span>' +
      '<span class="miya-wx-care-pop__badge">天气关心</span>' +
      '</span>' +
      '<span class="miya-wx-care-pop__text">' +
      escHtml(body) +
      '</span>' +
      '</span>';
    requestAnimationFrame(function () {
      careBannerCard.classList.add('is-visible');
    });
  }

  function drainCareBannerQueue() {
    clearTimeout(careBannerHideTimer);
    if (!careBannerQueue.length) {
      hideCareBannerCard(function () {
        careBannerBusy = false;
      });
      return;
    }
    var item = careBannerQueue.shift();
    renderCareBannerCard(item);
    var hold = careBannerQueue.length ? CARE_BANNER_SLOT_MS : CARE_BANNER_LAST_HOLD_MS;
    careBannerHideTimer = setTimeout(function () {
      if (careBannerQueue.length) {
        careBannerCard.classList.add('is-swapping');
        setTimeout(function () {
          if (careBannerCard) careBannerCard.classList.remove('is-swapping');
          drainCareBannerQueue();
        }, 280);
      } else {
        hideCareBannerCard(function () {
          careBannerBusy = false;
        });
      }
    }, hold);
  }

  function enqueueCareBanner(care) {
    if (!care || !care.id) return;
    careBannerQueue.push(care);
    if (!careBannerBusy) {
      careBannerBusy = true;
      drainCareBannerQueue();
    }
  }

  function dismissCareBanner() {
    clearTimeout(careBannerHideTimer);
    careBannerQueue = [];
    hideCareBannerCard(function () {
      careBannerBusy = false;
    });
  }

  function openWeatherCare(careId) {
    var id = String(careId || '').trim();
    dismissCareBanner();
    var go = function () {
      var app = global.miyaWeatherApp;
      if (app && typeof app.openCare === 'function') {
        app.openCare(id);
        return;
      }
      if (global.miyaLaunchApp) global.miyaLaunchApp('weather');
    };
    if (global.miyaLazyEnsureApp) {
      global.miyaLazyEnsureApp('weather').then(go).catch(go);
    } else {
      go();
    }
  }

  function fireSystemCareNotification(care) {
    if (!care || !global.miyaShowSystemNotification) return;
    var title = (care.contactName || 'TA') + ' 发来天气关心';
    var body = String(care.text || '').slice(0, 80);
    var careId = String(care.id || '');
    global
      .miyaShowSystemNotification(title, {
        body: body,
        tag: 'miya-weather-care-' + careId,
        data: { kind: 'weather_care', careId: careId }
      })
      .then(function (n) {
        if (!n || n._viaSw) return;
        n.onclick = function () {
          try {
            window.focus();
          } catch (e) {}
          try {
            n.close();
          } catch (e2) {}
          openWeatherCare(careId);
        };
      })
      .catch(function () {});
  }

  function notifyCare(care) {
    if (!care) return;
    if (shouldSystemNotifyCare(care)) fireSystemCareNotification(care);
    if (shouldInAppCareBanner(care)) enqueueCareBanner(care);
  }

  function handleWeatherNotifyClick(data) {
    if (!data) return;
    if (String(data.kind || '') !== 'weather_care') return;
    var careId = String(data.careId || '').trim();
    if (!careId) return;
    try {
      window.focus();
    } catch (e) {}
    openWeatherCare(careId);
  }

  (function consumeWeatherCareDeepLink() {
    var hash = String(location.hash || '');
    var m = hash.match(/(?:^|[#&])miya-open-weather-care=([^&]+)/);
    if (!m) return;
    var careId = decodeURIComponent(m[1] || '');
    if (!careId) return;
    history.replaceState(null, '', location.pathname + location.search);
    setTimeout(function () {
      openWeatherCare(careId);
    }, 320);
  })();

  /** 内存标记：今日是否已完成「上线先刷天气」 */
  var lastDailyWeatherDate = '';

  /**
   * 每日上线：只用已保存的「我的位置」强刷今日天气，绝不调用 GPS / 弹定位授权。
   * 地址变更仍由用户在天气 App 里手动定位或搜城市完成。
   */
  function refreshTodayWeatherForCare() {
    var st = store();
    if (!st) return Promise.resolve(null);
    var today = st.isoDate(new Date());
    var me = st.getMyLocation();
    if (!Number.isFinite(me.lat) || !Number.isFinite(me.lon)) {
      return Promise.resolve(null);
    }
    if (lastDailyWeatherDate === today) {
      return fetchForecast(me.lat, me.lon);
    }
    return fetchForecast(me.lat, me.lon, { force: true }).then(function (fc) {
      lastDailyWeatherDate = today;
      return fc;
    });
  }

  function tickCareScan() {
    if (careScanBusy) return;
    careScanBusy = true;
    /* 每日上线：先更新今日天气，再触发角色关心 */
    refreshTodayWeatherForCare()
      .catch(function () {})
      .then(function () {
        var list = listEligibleCareContacts();
        if (!list.length) return [];
        return runDueCares().then(function (results) {
          (results || []).forEach(function (r) {
            if (r && r.ok && r.care) notifyCare(r.care);
          });
          return results;
        });
      })
      .catch(function () {})
      .then(function () {
        careScanBusy = false;
      });
  }

  function startCareScan() {
    if (careScanTimer) return;
    var ms = 60000;
    if (global.miyaBgSetInterval) careScanTimer = global.miyaBgSetInterval(tickCareScan, ms);
    else careScanTimer = setInterval(tickCareScan, ms);
    setTimeout(tickCareScan, 4000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tickCareScan();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startCareScan);
  } else {
    startCareScan();
  }

  global.miyaWeatherBridge.notifyCare = notifyCare;
  global.miyaWeatherBridge.showCareBanner = enqueueCareBanner;
  global.miyaWeatherBridge.openWeatherCare = openWeatherCare;
  global.miyaWeatherBridge.dismissCareBanner = dismissCareBanner;
  global.miyaWeatherBridge.handleWeatherNotifyClick = handleWeatherNotifyClick;
  global.miyaWeatherBridge.refreshTodayWeatherForCare = refreshTodayWeatherForCare;
})(typeof window !== 'undefined' ? window : global);
