(function (global) {
    'use strict';

    var HISTORY_LIMIT = 40;
    var MEMBER_PRIVATE_INTEROP_SNIPPET = 50;
    var USER_MSG_JOIN = ' / ';
    var USER_OWNER_ID = '__user__';
    var TITLE_COLOR_PRESETS = [
        '#e74c3c', '#e67e22', '#f39c12', '#2ecc71',
        '#3498db', '#9b59b6', '#1abc9c', '#8b7355'
    ];
    var DEFAULT_TITLE_COLOR = '#8b7355';

    function normalizeOwnerId(settings) {
        var id = trim((settings && settings.groupOwnerId) || USER_OWNER_ID);
        return id || USER_OWNER_ID;
    }

    function isUserOwner(settings) {
        var oid = normalizeOwnerId(settings);
        return oid === USER_OWNER_ID || oid === 'user' || oid === '__profile__';
    }

    function getMemberRole(settings, contactId) {
        if (!contactId) return 'member';
        var cid = trim(contactId);
        var ownerId = normalizeOwnerId(settings);
        if (ownerId === cid) return 'owner';
        var admins = Array.isArray(settings && settings.groupAdminIds) ? settings.groupAdminIds : [];
        if (admins.indexOf(cid) >= 0) return 'admin';
        return 'member';
    }

    function roleLabel(role) {
        if (role === 'owner') return '群主';
        if (role === 'admin') return '管理员';
        return '';
    }

    function canManageTitles(settings, contactId) {
        var role = getMemberRole(settings, contactId);
        return role === 'owner' || role === 'admin';
    }

    function getMemberTitle(settings, contactId) {
        if (!settings || !contactId) return null;
        var row = settings.memberTitles && settings.memberTitles[contactId];
        if (!row || !trim(row.name)) return null;
        return {
            name: trim(row.name),
            color: /^#[0-9a-fA-F]{6}$/.test(trim(row.color)) ? trim(row.color) : DEFAULT_TITLE_COLOR
        };
    }

    function userDisplayName(profile) {
        return trim(profile && profile.name) || '用户';
    }

    function isUserTitleLabel(label, profile) {
        var key = trim(label);
        if (!key) return false;
        var lower = key.toLowerCase();
        if (lower === '用户' || lower === '我') return true;
        var pn = userDisplayName(profile);
        return pn === key || pn.toLowerCase() === lower;
    }

    function resolveTitleTarget(label, members, store, groupChatId, profile) {
        if (isUserTitleLabel(label, profile)) {
            return { id: USER_OWNER_ID, isUser: true };
        }
        var contact = resolveMemberByLabel(label, members, store, groupChatId);
        if (!contact) return null;
        return { id: contact.id, isUser: false, contact: contact };
    }

    function titleTargetDisplayName(target, store, groupChatId, profile, members) {
        if (!target) return '成员';
        if (target.isUser || target.id === USER_OWNER_ID) return userDisplayName(profile);
        if (target.contact) return memberDisplayName(store, target.contact, groupChatId);
        var list = Array.isArray(members) ? members : [];
        var hit = list.find(function (c) {
            return c.id === target.id;
        });
        return hit ? memberDisplayName(store, hit, groupChatId) : '成员';
    }

    function canActorChangeTargetTitle(settings, actorContactId, targetId) {
        if (!actorContactId || !targetId) return false;
        if (canManageTitles(settings, actorContactId)) return true;
        return targetId === USER_OWNER_ID;
    }

    function buildGroupTitlesBlock(members, store, groupChatId, settings, profile) {
        if (!members.length && !profile) return '';
        var lines = ['【群头衔·当前】'];
        var any = false;
        if (profile) {
            var userTitle = getMemberTitle(settings, USER_OWNER_ID);
            if (userTitle) {
                any = true;
                lines.push('- ' + userDisplayName(profile) + '（用户）：「' + userTitle.name + '」');
            }
        }
        members.forEach(function (c) {
            var dn = memberDisplayName(store, c, groupChatId);
            var title = getMemberTitle(settings, c.id);
            var role = getMemberRole(settings, c.id);
            var roleTxt = roleLabel(role);
            if (title) {
                any = true;
                lines.push('- ' + dn + '：「' + title.name + '」' + (roleTxt ? '（' + roleTxt + '）' : ''));
            } else if (roleTxt) {
                any = true;
                lines.push('- ' + dn + '：（' + roleTxt + '，暂无头衔）');
            }
        });
        if (!any) return '';
        return lines.join('\n');
    }

    function buildGroupRolesRulesBlock(members, store, groupChatId, settings, profile) {
        var roster = members
            .filter(function (c) {
                return canManageTitles(settings, c.id);
            })
            .map(function (c) {
                return memberDisplayName(store, c, groupChatId) + '（' + roleLabel(getMemberRole(settings, c.id)) + '）';
            })
            .join('、');
        var userName = userDisplayName(profile);
        return (
            '【群头衔·规则】\n' +
            '- 本群成员与用户均可拥有自定义群头衔；变更后须自然有所反应。\n' +
            '- 用户可在群设置中自定义自己的群头衔。\n' +
            '- 任意群成员可在对话中为用户设置群头衔，例如：角色名：给用户设置群头衔「课代表」\n' +
            (roster
                ? '- 群主/管理员（' +
                  roster +
                  '）可在对话中修改任意成员或用户的群头衔，例如：角色名：把' +
                  userName +
                  '的群头衔改为学霸\n'
                : '') +
            '- 系统会解析并写入群头衔，同时生成系统提示「谁将谁的群头衔改为什么」。'
        );
    }

    function formatTitleChangeContent(actorName, targetName, title, prevTitle) {
        var act = trim(actorName) || '管理员';
        var tgt = trim(targetName) || '成员';
        var t = trim(title);
        if (!t) {
            return act + ' 移除了 ' + tgt + ' 的群头衔';
        }
        if (prevTitle) {
            return act + ' 将 ' + tgt + ' 的群头衔从「' + prevTitle + '」改为「' + t + '」';
        }
        return act + ' 将 ' + tgt + ' 的群头衔改为「' + t + '」';
    }

    function formatTitleChangeForApi(m) {
        if (!m) return '';
        if (m.titleChange && typeof m.titleChange === 'object') {
            var tc = m.titleChange;
            return formatTitleChangeContent(tc.actorName, tc.targetName, tc.title, tc.prevTitle);
        }
        return trim(m.content);
    }

    function parseTitleChangeText(text) {
        var s = trim(text);
        if (!s) return null;
        var patterns = [
            /^把(.+?)的群头衔改为(.+)$/,
            /^将(.+?)的群头衔改成(.+)$/,
            /^设置(.+?)的群头衔为(.+)$/,
            /^给(.+?)设置群头衔[「"'](.+?)[」"']?$/,
            /^给(.+?)的群头衔设为(.+)$/,
            /^取消(.+?)的群头衔$/,
            /^移除(.+?)的群头衔$/
        ];
        var i;
        for (i = 0; i < patterns.length; i++) {
            var m = s.match(patterns[i]);
            if (!m) continue;
            if (i >= 5) {
                return { targetLabel: trim(m[1]), title: '' };
            }
            return { targetLabel: trim(m[1]), title: trim(m[2]) };
        }
        return null;
    }

    function applyMemberTitlePatch(settings, targetId, titleName, color) {
        settings = settings || {};
        var titles = Object.assign({}, settings.memberTitles || {});
        var nm = trim(titleName);
        if (!nm) {
            delete titles[targetId];
        } else {
            titles[targetId] = {
                name: nm.slice(0, 16),
                color: /^#[0-9a-fA-F]{6}$/.test(trim(color)) ? trim(color) : DEFAULT_TITLE_COLOR
            };
        }
        return { memberTitles: titles };
    }

    function processAssistantBubbleForTitleChange(payload, ctx) {
        ctx = ctx && typeof ctx === 'object' ? ctx : {};
        var store = ctx.store;
        var chatId = ctx.chatId;
        var members = ctx.members || [];
        var profile = ctx.profile;
        if (!store || !chatId || !payload) return null;
        var settings = store.getChatSettings ? store.getChatSettings(chatId) : null;
        var sid = trim(payload.senderContactId);
        if (!sid) return null;
        var body = trim(payload.content || payload.voiceText || '');
        if (!body) return null;
        body = stripGroupSpeakerPrefixForDisplay(body, members, store, chatId, profile);
        var parsed = parseTitleChangeText(body);
        if (!parsed) return null;
        var target = resolveTitleTarget(parsed.targetLabel, members, store, chatId, profile);
        if (!target) return null;
        if (!canActorChangeTargetTitle(settings, sid, target.id)) return null;
        var actor = members.find(function (c) {
            return c.id === sid;
        });
        var prev = getMemberTitle(settings, target.id);
        var patch = applyMemberTitlePatch(settings, target.id, parsed.title, prev && prev.color);
        var actorName = actor ? memberDisplayName(store, actor, chatId) : '管理员';
        var targetName = titleTargetDisplayName(target, store, chatId, profile, members);
        var sysContent = formatTitleChangeContent(
            actorName,
            targetName,
            parsed.title,
            prev && prev.name
        );
        return {
            skipBubble: true,
            settingsPatch: patch,
            systemMessage: {
                role: 'system',
                type: 'group_title_change',
                systemKind: 'group_title_change',
                content: sysContent,
                titleChange: {
                    actorId: sid,
                    actorName: actorName,
                    targetId: target.id,
                    targetName: targetName,
                    title: trim(parsed.title),
                    color: (patch.memberTitles[target.id] && patch.memberTitles[target.id].color) || DEFAULT_TITLE_COLOR,
                    prevTitle: prev && prev.name ? prev.name : ''
                }
            }
        };
    }

    function interopSnippetLimit(settings) {
        if (settings && settings.memoryCount) {
            return Math.min(500, Math.max(1, settings.memoryCount));
        }
        return HISTORY_LIMIT;
    }

    function trim(s) {
        return String(s || '').trim();
    }

    function isGroupChat(chat) {
        return !!(chat && chat.type === 'group');
    }

    function getMemberIds(chat) {
        if (!chat) return [];
        return (Array.isArray(chat.memberIds) ? chat.memberIds : [])
            .map(function (id) {
                return trim(id);
            })
            .filter(Boolean);
    }

    function getMembers(store, chat) {
        if (!store || !chat) return [];
        var ids = getMemberIds(chat);
        var out = [];
        var seen = {};
        ids.forEach(function (cid) {
            if (seen[cid]) return;
            seen[cid] = true;
            var c = store.findContact(cid);
            if (c) out.push(c);
        });
        return out;
    }

    function memberRealName(contact) {
        if (!contact) return '成员';
        var name = trim(contact.name);
        if (name) return name;
        var cs = global.miyaContactsStore;
        if (cs && typeof cs.findCharacter === 'function') {
            var row = cs.findCharacter(contact.chronicleId || contact.characterId);
            if (row && trim(row.name)) return trim(row.name);
        }
        return '成员';
    }

    function memberDisplayName(store, contact, groupChatId) {
        if (!contact) return '';
        var settings =
            groupChatId && store && store.getChatSettings
                ? store.getChatSettings(groupChatId)
                : null;
        var remark = trim((settings && settings.memberRemarks && settings.memberRemarks[contact.id]) || '');
        if (remark) return remark;
        return memberRealName(contact);
    }

    function memberLabelAliases(store, contact, groupChatId) {
        var names = [memberDisplayName(store, contact, groupChatId), memberRealName(contact)];
        if (trim(contact.remarkName)) names.push(trim(contact.remarkName));
        if (store && store.findChatByContact && store.getChatSettings) {
            var priv = store.findChatByContact(contact.id, '');
            if (priv) {
                var ps = store.getChatSettings(priv.id);
                if (ps && trim(ps.remarkName)) names.push(trim(ps.remarkName));
            }
        }
        var seen = {};
        return names.filter(function (n) {
            if (!n || seen[n]) return false;
            seen[n] = true;
            return true;
        });
    }

    function resolveMemberByLabel(label, members, store, groupChatId) {
        var key = trim(label);
        if (!key || !members.length) return null;
        var lower = key.toLowerCase();
        for (var i = 0; i < members.length; i++) {
            var c = members[i];
            var names = memberLabelAliases(store, c, groupChatId);
            for (var j = 0; j < names.length; j++) {
                if (names[j] === key || names[j].toLowerCase() === lower) return c;
            }
        }
        return (
            members.find(function (c) {
                return trim(c.name).toLowerCase() === lower;
            }) || null
        );
    }

    function renderChronicleForContact(contact) {
        var cs = global.miyaContactsStore;
        if (!cs || !contact) return '';
        var row = cs.findCharacter(contact.chronicleId) || cs.findCharacter(contact.characterId);
        if (!row) return '';
        var lines = ['· ' + trim(row.name || contact.name)];
        if (row.gender) lines.push('  性别 ' + row.gender);
        if (row.age) lines.push('  年龄 ' + row.age);
        if (row.persona) lines.push('  人设 ' + row.persona);
        return lines.join('\n');
    }

    function renderProfileBlock(profile) {
        if (!profile) return '';
        var lines = ['【用户·' + trim(profile.name || '用户') + '】'];
        if (profile.gender) lines.push('- 性别: ' + profile.gender);
        if (profile.persona) lines.push('- 人设: ' + profile.persona);
        return lines.join('\n');
    }

    function chronicleGroupIdForMembers(members) {
        var cs = global.miyaContactsStore;
        if (!cs || !members.length) return '';
        for (var i = 0; i < members.length; i++) {
            var row = cs.findCharacter(members[i].chronicleId || members[i].characterId);
            if (row && row.groupId) return trim(row.groupId);
        }
        return trim(members[0].groupId) || '';
    }

    function buildPairwiseRelationsBlock(members) {
        var rs = global.miyaContactsRelationshipStore;
        if (!rs || members.length < 2) return '';
        var gid = chronicleGroupIdForMembers(members);
        if (!gid) return '';
        var lines = [];
        for (var i = 0; i < members.length; i++) {
            for (var j = i + 1; j < members.length; j++) {
                var a = members[i];
                var b = members[j];
                var rel = rs.getRelation(
                    a.characterId || a.chronicleId || a.id,
                    b.characterId || b.chronicleId || b.id,
                    gid
                );
                if (!rel) continue;
                lines.push('- ' + trim(a.name) + ' ↔ ' + trim(b.name) + '：' + rel);
            }
        }
        if (!lines.length) return '';
        return '【成员彼此关系】\n' + lines.join('\n');
    }

    function buildUserRelationsBlock(store, members, profileId, groupChatId) {
        var lines = [];
        members.forEach(function (c) {
            var rel = '';
            var priv = store.findChatByContact(c.id, profileId);
            if (priv && store.getChatSettings) {
                var ps = store.getChatSettings(priv.id);
                rel = trim((ps && ps.relationship) || '');
            }
            if (!rel) rel = trim(c.relationship || '');
            if (rel) lines.push('- ' + memberDisplayName(store, c, groupChatId) + ' 与用户的关系：' + rel);
        });
        if (!lines.length) return '';
        return '【各角色与用户关系】\n' + lines.join('\n');
    }

    function buildGroupNicknamesBlock(members, store, groupChatId) {
        if (!members.length) return '';
        var lines = ['【群昵称·与本群显示名】'];
        members.forEach(function (c) {
            var dn = memberDisplayName(store, c, groupChatId);
            var real = memberRealName(c);
            if (dn !== real) lines.push('- ' + real + ' → 群内称「' + dn + '」');
            else lines.push('- ' + dn);
        });
        return lines.join('\n');
    }

    function isMemoryInteropEnabled(settings) {
        return !settings || settings.memoryInterop !== false;
    }

    function escapeRegExp(s) {
        return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function stripGroupSpeakerPrefixForDisplay(text, members, store, groupChatId, profile) {
        var s = trim(text);
        if (!s) return '';
        var legacy = s.match(/^【([^】]+)】\s*([\s\S]*)$/);
        if (legacy) return trim(legacy[2]) || s;
        var userLegacy = s.match(/^【用户[·・]?([^】]*)】\s*([\s\S]*)$/);
        if (userLegacy) return trim(userLegacy[2]) || s;
        if (members && members.length && store) {
            var colon = s.match(/^([^：:\n|｜]{1,32})[：:]\s*([\s\S]+)$/);
            if (colon) {
                var label = trim(colon[1]);
                if (resolveMemberByLabel(label, members, store, groupChatId)) {
                    return trim(colon[2]) || s;
                }
            }
        }
        var userName = profile ? trim(profile.name || '用户') : '用户';
        if (userName) {
            var um = s.match(new RegExp('^' + escapeRegExp(userName) + '[：:]\\s*([\\s\\S]+)$'));
            if (um) return trim(um[1]) || s;
        }
        if (/^用户[：:]/.test(s)) {
            var ux = s.match(/^用户[：:]\s*([\s\S]+)$/);
            if (ux) return trim(ux[1]) || s;
        }
        return s;
    }

    function resolveGroupAvatarFromSettings(settings, store) {
        if (!settings) return '';
        var av = trim(settings.groupAvatar);
        if (av) return av;
        var blobId = trim(settings.groupAvatarBlobId);
        if (!blobId || !store) return '';
        if (typeof store.getCachedBlobUrl === 'function') {
            var hit = store.getCachedBlobUrl(blobId);
            if (hit) return hit;
        }
        return '';
    }

    function resolveGroupAvatarUrlAsync(store, chatId) {
        if (!store || !chatId) return Promise.resolve('');
        var settings = store.getChatSettings ? store.getChatSettings(chatId) : null;
        var sync = resolveGroupAvatarFromSettings(settings, store);
        if (sync) return Promise.resolve(sync);
        var blobId = trim(settings && settings.groupAvatarBlobId);
        if (!blobId || typeof store.getAvatarUrl !== 'function') return Promise.resolve('');
        return store.getAvatarUrl(blobId).catch(function () {
            return '';
        });
    }

    function resolveMemberAvatarUrl(contact) {
        if (!contact) return '';
        var st = global.miyaChatStore;
        if (st && typeof st.resolveContactDisplayAvatarSync === 'function') {
            var display = st.resolveContactDisplayAvatarSync(contact);
            if (display) return display;
        }
        if (st && typeof st.hasContactDisplayAvatarOverride === 'function' && st.hasContactDisplayAvatarOverride(contact)) {
            return '';
        }
        return trim(contact.avatar) || '';
    }

    function resolveMemberAvatarUrlAsync(contact, store) {
        if (!contact) return Promise.resolve('');
        var st = store || global.miyaChatStore;
        if (st && typeof st.resolveContactDisplayAvatarSync === 'function') {
            var sync = st.resolveContactDisplayAvatarSync(contact);
            if (sync) return Promise.resolve(sync);
        }
        if (st && typeof st.hasContactDisplayAvatarOverride === 'function' && st.hasContactDisplayAvatarOverride(contact)) {
            if (typeof st.resolveContactDisplayAvatarAsync === 'function') {
                return st.resolveContactDisplayAvatarAsync(contact);
            }
            return Promise.resolve('');
        }
        if (contact.avatar) return Promise.resolve(contact.avatar);
        if (contact.avatarBlobId && store && store.getAvatarUrl) {
            return store.getAvatarUrl(contact.avatarBlobId).catch(function () {
                return '';
            });
        }
        return Promise.resolve('');
    }

    function memberAvatarFallback(name) {
        var ch = Array.from(String(name || '群').trim() || '群')[0] || '群';
        return (
            'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
                '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
                '<stop offset="0%" stop-color="#EDE8E0"/><stop offset="100%" stop-color="#D8D0C4"/></linearGradient></defs>' +
                '<circle cx="40" cy="40" r="40" fill="url(#g)"/>' +
                '<text x="40" y="48" text-anchor="middle" font-family="Georgia,serif" font-size="28" fill="#7A7268" opacity="0.7">' +
                ch +
                '</text></svg>'
            )
        );
    }

    function renderGroupCollageHtml(members, resolveFn, cssPrefix) {
        var prefix = cssPrefix || 'mq-grp-head';
        var slice = (members || []).slice(0, 3);
        if (!slice.length) {
            return (
                '<img class="' +
                prefix +
                '-ava" src="' +
                memberAvatarFallback('群') +
                '" alt="群聊">'
            );
        }
        return (
            '<div class="' +
            prefix +
            '-stack" aria-hidden="true">' +
            slice
                .map(function (c, i) {
                    var src =
                        (typeof resolveFn === 'function' ? resolveFn(c) : '') ||
                        memberAvatarFallback(c && c.name);
                    return (
                        '<img class="' +
                        prefix +
                        '-ava" data-mq-mid="' +
                        (c && c.id ? String(c.id) : '') +
                        '" style="--gi:' +
                        i +
                        '" src="' +
                        src.replace(/"/g, '&quot;') +
                        '" alt="">'
                    );
                })
                .join('') +
            '</div>'
        );
    }

    function renderGroupListAvatarHtml(store, chat, contactAvatarFn) {
        var settings = store && store.getChatSettings ? store.getChatSettings(chat.id) : null;
        var custom = resolveGroupAvatarFromSettings(settings, store);
        if (custom) {
            return (
                '<img class="soft-thread__ava qq-chat-item__ava qq-chat-item__ava--group" data-mq-group-avatar="1" data-mq-chat-id="' +
                (chat && chat.id ? String(chat.id) : '') +
                '" src="' +
                custom.replace(/"/g, '&quot;') +
                '" alt="">'
            );
        }
        var members = getMembers(store, chat);
        var resolveFn = function (c) {
            if (contactAvatarFn) return contactAvatarFn(c) || memberAvatarFallback(c && c.name);
            return resolveMemberAvatarUrl(c) || memberAvatarFallback(c && c.name);
        };
        return (
            '<div class="qq-chat-item__ava-wrap qq-chat-item__ava-wrap--group">' +
            renderGroupCollageHtml(members, resolveFn, 'mq-grp-list') +
            '</div>'
        );
    }

    function buildPrivateMemoryBlock(store, members, profileId, groupChatId) {
        var settings = store && store.getChatSettings ? store.getChatSettings(groupChatId) : null;
        if (!isMemoryInteropEnabled(settings)) return '';
        var snippetLimit = MEMBER_PRIVATE_INTEROP_SNIPPET;
        var aw = global.MiyaChatAwareness;
        var fmt = global.MiyaChatOnlineFormat;
        var blocks = [];
        members.forEach(function (c) {
            var priv = store.findChatByContact(c.id, profileId);
            if (!priv) return;
            var name = memberDisplayName(store, c, groupChatId);
            var parts = ['### 单聊·' + name + '（会话 id:' + priv.id + '，非本群）'];
            if (store.getChatSettings && aw && typeof aw.buildSummaryContextBlock === 'function') {
                var sum = aw.buildSummaryContextBlock(store.getChatSettings(priv.id));
                if (sum) parts.push('〔单聊记忆总结〕\n' + sum);
            }
            var msgs =
                store.getMessagesForApi && typeof store.getMessagesForApi === 'function'
                    ? store.getMessagesForApi(priv.id)
                    : store.getMessages(priv.id);
            var tail = msgs.slice(-snippetLimit);
            if (tail.length) {
                parts.push('〔单聊近期原文摘录·' + snippetLimit + ' 条内〕');
                tail.forEach(function (m) {
                    if (!m || m.deleted) return;
                    var body =
                        fmt && typeof fmt.formatMessageForApi === 'function'
                            ? fmt.formatMessageForApi(m)
                            : trim(m.content);
                    if (!body) return;
                    var who = m.role === 'user' ? '用户' : name;
                    parts.push(who + '：' + body);
                });
            }
            if (parts.length > 1) blocks.push(parts.join('\n'));
        });
        if (!blocks.length) return '';
        return (
            '【互通·单聊记忆】\n' +
            '以下为各成员与用户私聊的总结/摘录，仅供群聊剧情参考；禁止在群里复述为众人皆知；禁止把单聊专属格式（含心声/单聊转账规则）代入本群。\n' +
            '本段不是让你输出单聊格式——群聊仍须「角色名：」且禁止 <heartvoice>。\n\n' +
            blocks.join('\n\n')
        );
    }

    function buildGroupMemberRolesBlock(members, store, groupChatId, settings, profile) {
        if (!members.length) return '';
        var ownerId = normalizeOwnerId(settings);
        var ownerName;
        if (isUserOwner(settings)) {
            ownerName = userDisplayName(profile) + '（用户）';
        } else {
            var ownerContact = members.find(function (c) {
                return c.id === ownerId;
            });
            ownerName = ownerContact
                ? memberDisplayName(store, ownerContact, groupChatId) + '（群主）'
                : '成员';
        }
        var adminNames = members
            .filter(function (c) {
                return getMemberRole(settings, c.id) === 'admin';
            })
            .map(function (c) {
                return memberDisplayName(store, c, groupChatId);
            });
        var lines = [
            '【本群身份·群主与管理员】',
            '- 群主：' + ownerName,
            '- 管理员：' + (adminNames.length ? adminNames.join('、') : '暂无')
        ];
        var privileged = members
            .filter(function (c) {
                var role = getMemberRole(settings, c.id);
                return role === 'owner' || role === 'admin';
            })
            .map(function (c) {
                return (
                    memberDisplayName(store, c, groupChatId) +
                    '（本群' +
                    roleLabel(getMemberRole(settings, c.id)) +
                    '）'
                );
            });
        if (privileged.length) {
            lines.push(
                '- 以下成员具管理身份：' +
                    privileged.join('、') +
                    '。当你以其身份发言时，须自知其为群主/管理员，可体现相应权责（如维护群秩序、修改群成员/用户群头衔等）。'
            );
        }
        return lines.join('\n');
    }

    function buildAllPersonasBlock(members, store, groupChatId, settings) {
        var lines = ['【本群成员人设】'];
        members.forEach(function (c) {
            var block = renderChronicleForContact(c);
            var role = settings ? getMemberRole(settings, c.id) : 'member';
            var roleTxt = roleLabel(role);
            var roleTag = roleTxt ? '【本群' + roleTxt + '·输出此角色时须自知此身份】' : '';
            if (block) {
                lines.push(roleTag ? roleTag + '\n' + block : block);
            } else {
                var dn = trim(c.name) || '成员';
                lines.push('· ' + dn + (roleTxt ? '（本群' + roleTxt + '）' : ''));
            }
        });
        return lines.join('\n');
    }

    function buildGroupModeBlock(chat, members, profile) {
        var names = members
            .map(function (c) {
                return trim(c.name);
            })
            .filter(Boolean)
            .join('、');
        return (
            '【对话模式·群聊】\n' +
            '场景：手机群聊，群名「' +
            trim(chat.title || '群聊') +
            '」。\n' +
            '成员：' +
            names +
            '。用户：' +
            trim(profile.name || '用户') +
            '。\n' +
            '- 下文「群聊上下文」仅含本群记录；「单聊记忆」仅含私聊，二者不可混用。\n' +
            '- 禁止在单聊场景复述本群台词；禁止把某成员单聊内容当成群里大家都说过的话。\n' +
            '- 【群聊硬性边界】禁止输出 <heartvoice> 或任何心声块；禁止套用单聊「线上格式规则」中的转账/收款/心声等单聊专属格式（群聊仅允许本提示中的群聊格式）。'
        );
    }

    function buildPerTurnGroupFormatReminder(members, store, groupChatId, settings) {
        var roster = (members || [])
            .map(function (c) {
                return memberDisplayName(store, c, groupChatId);
            })
            .join('、');
        var lines = [
            '【本轮输出格式·群聊·强制复核】',
            '当前为群聊，不是单聊：正文每行须「角色名：内容」，角色名仅限 ' +
                roster +
                '；禁止 <heartvoice> 与心声块；禁止单聊三段式（thinking+正文+心声）；类型行须写在对应角色名后的同一行内。'
        ];
        if (settings && settings.autoTranslate) {
            var tr = global.MiyaChatTranslate;
            if (tr && typeof tr.buildPerTurnAutoTranslateReminder === 'function') {
                lines.push(tr.buildPerTurnAutoTranslateReminder(settings.translateTarget || 'zh-CN'));
            }
        }
        return lines.join('\n');
    }

    function buildGroupRulesBlock(members, store, groupChatId) {
        var roster = members
            .map(function (c) {
                return memberDisplayName(store, c, groupChatId);
            })
            .join('、');
        return (
            '【群聊回复格式】\n' +
            '1、可用 <thinking>…</thinking> 写简短整体思考（一次即可）。\n' +
            '2、正文：每行「角色名：内容」，角色名须为：' +
            roster +
            ' 之一；每行一条气泡（用中文冒号「：」，勿用【】包裹角色名）。\n' +
            '3、仅上述成员可发言；禁止替用户发言；禁止 <heartvoice> 与任何心声块（心声仅存在于单聊，群聊永不输出）。\n' +
            '4、成员可发表情包、引用他人原话、发语音（均写在「角色名：」后的同一行内）：\n' +
            '   · 语音：角色名：语音-台词（例：肖闻：语音-你在哪）\n' +
            '   · 表情包：角色名：表情包-名称（名称须来自下方「群聊可用表情包」列表，含通用表情包与各成员专属包）\n' +
            '   · 引用：角色名：引用-被引用原话摘抄：你的回复（可引用用户或任意群成员说过的话，摘抄须与原文一致）\n' +
            '   · 红包：角色名：红包-拼手气-金额-份数-祝福语；角色名：红包-专属-金额-目标名-祝福语\n' +
            '   · 亦可：图片-描述（一行一条）\n' +
            '5、多人可接话，注意彼此关系与人设；勿复读群聊/单聊已有原句。'
        );
    }

    function collectRoleIds(members) {
        var set = {};
        members.forEach(function (c) {
            ['characterId', 'chronicleId', 'id'].forEach(function (k) {
                var v = trim(c[k]);
                if (v) set[v] = true;
            });
            var cs = global.miyaContactsStore;
            if (cs && typeof cs.findCharacter === 'function') {
                var row = cs.findCharacter(c.characterId || c.chronicleId);
                if (row && row.id) set[trim(row.id)] = true;
            }
        });
        return Object.keys(set);
    }

    function listOnlineGlobalWorldbookEntries() {
        var wb = global.miyaWorldbookStore;
        var matcher = global.miyaWorldbookMatcher;
        if (!wb || typeof wb.listEntries !== 'function' || !matcher) return [];
        var entries = wb.listEntries().filter(function (e) {
            return e && e.enabled !== false && String(e.scope || 'global') === 'global';
        });
        var seen = {};
        var out = [];
        function push(entry) {
            if (!entry || !entry.id || seen[entry.id]) return;
            seen[entry.id] = true;
            out.push(entry);
        }
        if (typeof matcher.collectUniversalGlobalEntries === 'function') {
            matcher.collectUniversalGlobalEntries(entries).forEach(push);
        }
        if (typeof matcher.collectReachGlobalEntries === 'function') {
            matcher.collectReachGlobalEntries(entries, 'online').forEach(push);
        }
        return out;
    }

    /** 本群成员绑定的局部世界书（仅列出；关闭注入走 groupWorldbookDisabledEntryIds） */
    function listMemberBoundLocalWorldbookEntries(members, store, groupChatId) {
        var wb = global.miyaWorldbookStore;
        var matcher = global.miyaWorldbookMatcher;
        if (!wb || typeof wb.listEntries !== 'function') return [];
        var roleIds = collectRoleIds(members || []);
        if (!roleIds.length) return [];
        var roleSet = {};
        roleIds.forEach(function (id) {
            roleSet[id] = true;
        });
        var cfg = { roleId: roleIds[0], roleIds: roleIds };
        var seen = {};
        var out = [];
        wb.listEntries().forEach(function (entry) {
            if (!entry || entry.enabled === false) return;
            if (String(entry.scope) !== 'local') return;
            var bound = Array.isArray(entry.boundRoleIds) ? entry.boundRoleIds : [];
            if (!bound.length) return;
            var matched = false;
            if (matcher && typeof matcher.roleMatches === 'function') {
                matched = matcher.roleMatches(entry, cfg);
            } else {
                matched = bound.some(function (bid) {
                    return !!roleSet[String(bid || '').trim()];
                });
            }
            if (!matched || !entry.id || seen[entry.id]) return;
            seen[entry.id] = true;
            var labels = [];
            var labelSeen = {};
            (members || []).forEach(function (c) {
                if (!c) return;
                var ids = [c.characterId, c.chronicleId, c.id]
                    .map(function (x) {
                        return trim(x);
                    })
                    .filter(Boolean);
                var hit = bound.some(function (bid) {
                    return ids.indexOf(String(bid || '').trim()) >= 0;
                });
                if (!hit) return;
                var label = memberDisplayName(store, c, groupChatId) || trim(c.name) || trim(c.id);
                if (!label || labelSeen[label]) return;
                labelSeen[label] = true;
                labels.push(label);
            });
            out.push({
                id: entry.id,
                name: entry.name || entry.id,
                boundMemberLabels: labels
            });
        });
        out.sort(function (a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
        });
        return out;
    }

    function buildGroupWorldbookBundle(members, contextText, settings) {
        var eng = global.miyaChatEngine;
        var roleIds = collectRoleIds(members);
        var disabledIds =
            settings && Array.isArray(settings.groupWorldbookDisabledEntryIds)
                ? settings.groupWorldbookDisabledEntryIds
                : [];
        if (eng && typeof eng.buildWorldbookBundle === 'function') {
            return eng.buildWorldbookBundle(null, contextText, null, {
                roleIds: roleIds,
                promptContext: 'online',
                includeAllBoundLocal: true,
                excludeEntryIds: disabledIds
            });
        }
        var builder = global.miyaWorldbookPrompt || global.miyaBuildWorldbookPrompt;
        if (!builder || typeof builder.buildWorldbookPrompt !== 'function') {
            return { universalLayer: '', frontLayers: [], layers: [], backLayers: [] };
        }
        var result = builder.buildWorldbookPrompt({
            roleIds: roleIds,
            contextText: contextText || '',
            skipChronicleProfile: true,
            promptContext: 'online'
        });
        var sec = result && result.sections ? result.sections : {};
        return {
            universalLayer: '',
            frontLayers: [sec.front].map(trim).filter(Boolean),
            layers: [sec.middle || sec.global, sec.local].map(trim).filter(Boolean),
            backLayers: [sec.back].map(trim).filter(Boolean)
        };
    }

    function buildWorldbookLayers(members, contextText, settings) {
        return buildGroupWorldbookBundle(members, contextText, settings).layers || [];
    }

    function formatGroupMessageBody(m, members, profile, store, groupChatId) {
        var fmt = global.MiyaChatOnlineFormat;
        if (m.role === 'system' && (m.type === 'group_title_change' || m.systemKind === 'group_title_change')) {
            return '〔系统·' + formatTitleChangeForApi(m) + '〕';
        }
        if (
            m.role === 'system' &&
            global.MiyaChatGroupRedPacket &&
            typeof global.MiyaChatGroupRedPacket.isGroupRedPacketSystem === 'function' &&
            global.MiyaChatGroupRedPacket.isGroupRedPacketSystem(m)
        ) {
            return '〔红包·' + global.MiyaChatGroupRedPacket.formatSystemForApi(m) + '〕';
        }
        var grpRpFmt = global.MiyaChatGroupRedPacket;
        if (
            m.type === 'group_red_packet' &&
            grpRpFmt &&
            typeof grpRpFmt.resolveMessageGroupRedPacket === 'function' &&
            typeof grpRpFmt.formatGroupRedPacketForApi === 'function'
        ) {
            var grpResolved = grpRpFmt.resolveMessageGroupRedPacket(m);
            if (grpResolved) {
                var grpBody = grpRpFmt.formatGroupRedPacketForApi(
                    grpResolved,
                    members,
                    profile,
                    store,
                    groupChatId
                );
                if (grpBody) {
                    if (m.role === 'user') {
                        return trim(profile.name || '用户') + '：' + grpBody;
                    }
                    if (m.role === 'assistant') {
                        var grpSid = trim(m.senderContactId);
                        var grpSpeaker = grpSid
                            ? members.find(function (c) {
                                  return c.id === grpSid;
                              })
                            : null;
                        var grpName = grpSpeaker
                            ? memberDisplayName(store, grpSpeaker, groupChatId)
                            : '成员';
                        return grpName + '：' + grpBody;
                    }
                    return grpBody;
                }
            }
        }
        var body =
            fmt && typeof fmt.formatMessageForApi === 'function'
                ? fmt.formatMessageForApi(m)
                : trim(m.content);
        if (!body && m.type !== 'image' && m.type !== 'sticker') return '';
        if (m.role === 'user') {
            return trim(profile.name || '用户') + '：' + body;
        }
        if (m.role === 'assistant') {
            var sid = trim(m.senderContactId);
            var speaker = null;
            if (sid) {
                speaker = members.find(function (c) {
                    return c.id === sid;
                });
            }
            var name = speaker ? memberDisplayName(store, speaker, groupChatId) : '成员';
            return name + '：' + body;
        }
        return body;
    }

    function appendGroupHistory(apiMessages, slice, members, profile, settings, store, groupChatId) {
        var aw = global.MiyaChatAwareness;
        var nowTs = Date.now();
        var userBuf = [];
        var asstBuf = [];
        function flushUser() {
            if (!userBuf.length) return;
            apiMessages.push({ role: 'user', content: userBuf.join(USER_MSG_JOIN) });
            userBuf = [];
        }
        function flushAssistant() {
            if (!asstBuf.length) return;
            apiMessages.push({ role: 'assistant', content: asstBuf.join('\n') });
            asstBuf = [];
        }
        slice.forEach(function (m) {
            if (!m || m.deleted) return;
            if (m.role === 'system') {
                if (m.type === 'group_title_change' || m.systemKind === 'group_title_change') {
                    var sysBody = formatGroupMessageBody(m, members, profile, store, groupChatId);
                    if (sysBody) {
                        flushUser();
                        asstBuf.push(sysBody);
                    }
                } else if (
                    global.MiyaChatGroupRedPacket &&
                    typeof global.MiyaChatGroupRedPacket.isGroupRedPacketSystem === 'function' &&
                    global.MiyaChatGroupRedPacket.isGroupRedPacketSystem(m)
                ) {
                    var rpSysBody = formatGroupMessageBody(m, members, profile, store, groupChatId);
                    if (rpSysBody) {
                        flushUser();
                        asstBuf.push(rpSysBody);
                    }
                }
                return;
            }
            var body = formatGroupMessageBody(m, members, profile, store, groupChatId);
            if (!body) return;
            if (aw && typeof aw.stampMessageForApi === 'function') {
                body = aw.stampMessageForApi(body, m, settings, nowTs);
            }
            if (m.role === 'user') {
                flushAssistant();
                userBuf.push(body);
            } else {
                flushUser();
                asstBuf.push(body);
            }
        });
        flushUser();
        flushAssistant();
    }

    function getGlobalPrompt() {
        if (typeof global.miyaGetGlobalBreakPrompt === 'function') {
            return trim(global.miyaGetGlobalBreakPrompt());
        }
        try {
            return trim(localStorage.getItem('miya-global-break-prompt') || '');
        } catch (e) {
            return '';
        }
    }

    function buildGroupSystemPrompt(input) {
        var cfg = input && typeof input === 'object' ? input : {};
        var chat = cfg.chat;
        var members = cfg.members || [];
        var profile = cfg.profile;
        var store = cfg.store;
        var parts = [];
        (cfg.worldbookFrontLayers || []).forEach(function (layer) {
            var t = trim(layer);
            if (t) parts.push(t);
        });
        var gp = trim(getGlobalPrompt());
        if (gp) parts.push('【全局】\n' + gp);
        parts.push(buildGroupModeBlock(chat, members, profile));
        var nickBlock = buildGroupNicknamesBlock(members, store, chat.id);
        if (nickBlock) parts.push(nickBlock);
        var settings =
            store && typeof store.getChatSettings === 'function'
                ? store.getChatSettings(chat.id)
                : null;
        var titlesBlock = buildGroupTitlesBlock(members, store, chat.id, settings, profile);
        if (titlesBlock) parts.push(titlesBlock);
        var rolesRules = buildGroupRolesRulesBlock(members, store, chat.id, settings, profile);
        if (rolesRules) parts.push(rolesRules);
        var memberRoles = buildGroupMemberRolesBlock(members, store, chat.id, settings, profile);
        if (memberRoles) parts.push(memberRoles);
        parts.push(buildAllPersonasBlock(members, store, chat.id, settings));
        var userBlock = renderProfileBlock(profile);
        if (userBlock) parts.push(userBlock);
        parts.push(buildUserRelationsBlock(store, members, chat.profileId, chat.id));
        var pair = buildPairwiseRelationsBlock(members);
        if (pair) parts.push(pair);
        var priv = buildPrivateMemoryBlock(store, members, chat.profileId, chat.id);
        if (priv) parts.push(priv);
        var aw = global.MiyaChatAwareness;
        if (aw) {
            var history = Array.isArray(cfg.history) ? cfg.history : [];
            if (typeof aw.buildTimeAwarenessRules === 'function') {
                var timeRules = aw.buildTimeAwarenessRules(settings, history, profile);
                if (timeRules) parts.push(timeRules);
            }
            if (typeof aw.buildGroupPlaceAwarenessRules === 'function') {
                var placeRules = aw.buildGroupPlaceAwarenessRules(
                    store,
                    members,
                    chat.profileId,
                    profile,
                    chat.id
                );
                if (placeRules) parts.push('【地点运转】\n' + placeRules);
            }
            if (typeof aw.buildGroupWeatherAwarenessRules === 'function') {
                var weatherRules = aw.buildGroupWeatherAwarenessRules(
                    store,
                    members,
                    chat.profileId,
                    profile,
                    chat.id
                );
                if (weatherRules) parts.push(weatherRules);
            }
        }
        (cfg.worldbookLayers || []).forEach(function (layer) {
            parts.push(layer);
        });
        parts.push(buildGroupRulesBlock(members, store, chat.id));
        if (settings && settings.autoTranslate) {
            var trRules = global.MiyaChatTranslate;
            if (trRules && typeof trRules.buildAutoTranslateRulesBlock === 'function') {
                parts.push(trRules.buildAutoTranslateRulesBlock(settings.translateTarget || 'zh-CN'));
            }
        }
        var fmt = global.MiyaChatOnlineFormat;
        if (fmt && typeof fmt.buildStickerAllowlistBlock === 'function') {
            var stickerCat = collectStickerCatalog(store, members);
            parts.push(fmt.buildStickerAllowlistBlock(stickerCat, '群聊成员'));
        }
        return parts.filter(Boolean).join('\n\n');
    }

    function buildApiMessages(chatId, userText, opts) {
        opts = opts && typeof opts === 'object' ? opts : {};
        var store = global.miyaChatStore;
        if (!store) return { error: 'store_missing', messages: [] };
        var chat = store.findChat(chatId);
        if (!chat || !isGroupChat(chat)) return { error: 'not_group', messages: [] };
        var members = getMembers(store, chat);
        if (members.length < 2) return { error: 'group_members_missing', messages: [] };
        var profile =
            store.getProfiles().find(function (p) {
                return p.id === chat.profileId;
            }) || store.getActiveProfile();
        if (!profile) return { error: 'profile_missing', messages: [] };

        var history =
            store.getMessagesForApi && typeof store.getMessagesForApi === 'function'
                ? store.getMessagesForApi(chatId)
                : store.getMessages(chatId);
        var settings = store.getChatSettings ? store.getChatSettings(chatId) : null;
        var limit =
            settings && settings.memoryCount
                ? Math.min(500, Math.max(1, settings.memoryCount))
                : HISTORY_LIMIT;
        /*
         * 群聊同单聊：按设定条数取时间线末尾最近可注入消息，完整顺序注入。
         * 分镜/合卷不剔窗口内原文（长期记忆另有系统块）。
         */
        function groupRowEligible(hm) {
            return !!(hm && !hm.deleted && formatGroupMessageBody(hm, members, profile, store, chatId));
        }
        var slice = [];
        for (var hi = (history || []).length - 1; hi >= 0 && slice.length < limit; hi--) {
            var hm = history[hi];
            if (!groupRowEligible(hm)) continue;
            slice.push(hm);
        }
        slice.reverse();
        var contextText = slice
            .map(function (m) {
                return formatGroupMessageBody(m, members, profile, store, chatId);
            })
            .filter(Boolean)
            .join('\n');
        var wbBundle = buildGroupWorldbookBundle(members, contextText + '\n' + trim(userText), settings);
        var systemContent = buildGroupSystemPrompt({
            chat: chat,
            members: members,
            profile: profile,
            store: store,
            history: slice,
            worldbookFrontLayers: wbBundle.frontLayers,
            worldbookLayers: wbBundle.layers
        });

        var apiMessages = [{ role: 'system', content: systemContent }];
        var aw = global.MiyaChatAwareness;
        var summaryBlock =
            aw && typeof aw.buildSummaryContextBlock === 'function'
                ? aw.buildSummaryContextBlock(settings)
                : '';
        if (summaryBlock) {
            apiMessages.push({
                role: 'system',
                content: '【本群·记忆总结】\n' + summaryBlock
            });
        }
        apiMessages.push({
            role: 'system',
            content:
                '【群聊上下文·必读】\n' +
                '以下消息均来自本群（非单聊）；阅读时留意每行开头的「角色名：」或「用户名：」。'
        });
        appendGroupHistory(apiMessages, slice, members, profile, settings, store, chatId);

        var grpTailState = 'empty';
        var bgMod = global.MiyaChatBackground;
        if (bgMod && typeof bgMod.getTrailingSpeakerStateFromStore === 'function') {
            grpTailState = bgMod.getTrailingSpeakerStateFromStore(store, chatId);
        } else if (slice.length) {
            for (var gi = slice.length - 1; gi >= 0; gi--) {
                var gr = slice[gi];
                if (!gr || gr.deleted) continue;
                if (gr.role === 'user') {
                    grpTailState = 'user_spoke_last';
                    break;
                }
                if (gr.role === 'assistant') {
                    grpTailState = 'assistant_spoke_last';
                    break;
                }
            }
        }
        /* 主动/离线 lead 放历史后，避免盖住对话时间线 */
        if (opts.systemLead) {
            apiMessages.push({ role: 'system', content: String(opts.systemLead) });
        } else if (grpTailState === 'assistant_spoke_last') {
            apiMessages.push({
                role: 'system',
                content:
                    '【紧挨上文·群聊末条状态】上下文中最后一条为成员发言、用户尚未回复：须从最近成员发言自然续写，禁止重答用户旧话或复读上轮相似内容。'
            });
        }

        var extra = trim(userText);
        if (extra) {
            var last = apiMessages[apiMessages.length - 1];
            if (last && last.role === 'user') {
                last.content = last.content
                    ? last.content + USER_MSG_JOIN + trim(profile.name || '用户') + '：' + extra
                    : trim(profile.name || '用户') + '：' + extra;
            } else {
                apiMessages.push({ role: 'user', content: trim(profile.name || '用户') + '：' + extra });
            }
        }

        var engWb = global.miyaChatEngine;
        if (engWb && typeof engWb.appendWorldbookBackMessages === 'function') {
            engWb.appendWorldbookBackMessages(apiMessages, wbBundle.backLayers);
        } else {
            (wbBundle.backLayers || []).forEach(function (layer) {
                var t = trim(layer);
                if (t) apiMessages.push({ role: 'system', content: t });
            });
        }

        apiMessages.push({
            role: 'system',
            content: buildPerTurnGroupFormatReminder(members, store, chatId, settings)
        });

        if (opts.isAutoPush || opts.isOffline) {
            var tail = apiMessages[apiMessages.length - 1];
            if (!tail || tail.role !== 'user') {
                var grpProactiveTail =
                    grpTailState === 'assistant_spoke_last'
                        ? '（群聊主动消息：上下文末条为成员发言、用户尚未回复；须从最近成员发言续写，禁止重答用户旧话或复读上轮；格式「角色名：内容」；可多成员接话）'
                        : grpTailState === 'user_spoke_last'
                          ? '（群聊主动消息：上下文末条为用户发言、成员尚未回复；须自然回应用户最新消息；格式「角色名：内容」）'
                          : '（群聊主动消息：请由合适成员主动发言，格式「角色名：内容」；须读全上文；可多成员接话，禁止复读近期原句）';
                apiMessages.push({ role: 'user', content: grpProactiveTail });
            }
        } else if (!opts.isAutoPush && !opts.isOffline) {
            if (opts.skipUserMessage && !extra) {
                var grpManualTail;
                if (grpTailState === 'assistant_spoke_last') {
                    grpManualTail =
                        '（请继续本群对话：上下文末条为成员发言、用户尚未回复；从最近成员发言续写，禁止重答用户旧话；格式「角色名：内容」）';
                } else if (grpTailState === 'user_spoke_last') {
                    grpManualTail =
                        '（请角色们根据上文回复：上下文末条为用户发言、成员尚未回复；须回应用户最新消息；格式「角色名：内容」，可多成员接话；禁止 <heartvoice>）';
                } else {
                    grpManualTail =
                        '（请角色们根据上文回复：格式「角色名：内容」，可多成员接话；禁止 <heartvoice>）';
                }
                apiMessages.push({ role: 'user', content: grpManualTail });
            }
        }

        var engPm = global.miyaChatEngine;
        var promptMeta = { scope: 'group', member_count: members.length, message_count: apiMessages.length };
        if (engPm && typeof engPm.estimateMessagesTokens === 'function') {
            promptMeta.estimated_prompt_tokens = engPm.estimateMessagesTokens(apiMessages);
        }
        var totalChars = 0;
        apiMessages.forEach(function (m) {
            if (m && m.content) totalChars += String(m.content).length;
        });
        promptMeta.total_prompt_chars = totalChars;

        return {
            messages: apiMessages,
            contact: null,
            profile: profile,
            chat: chat,
            members: members,
            isGroup: true,
            latestHumanRole: slice.length ? slice[slice.length - 1].role : '',
            htmlMode: false,
            promptMeta: promptMeta,
            worldbookMeta: Object.assign({ scope: 'group' }, wbBundle.meta || {}, {
                matchedSummary: wbBundle.meta && wbBundle.meta.matchedSummary
                    ? wbBundle.meta.matchedSummary
                    : (wbBundle.matched || []).map(function (e) {
                          return {
                              name: e && e.name,
                              scope: e && e.scope,
                              charCount: String((e && e.content) || '').length
                          };
                      })
            })
        };
    }

    function splitGroupQuoteReplyBoundary(body) {
        var raw = trim(body);
        if (!raw) return null;
        var seps = ['：', ':', '——', '—', '–', '→', '=>', '->', '｜', '|', '；', ';'];
        var i;
        for (i = 0; i < seps.length; i++) {
            var sep = seps[i];
            var idx = raw.lastIndexOf(sep);
            if (idx <= 0) continue;
            var quotedText = trim(raw.slice(0, idx));
            var replyText = trim(raw.slice(idx + sep.length));
            if (quotedText && replyText) {
                return { quotedText: quotedText, replyText: replyText };
            }
        }
        return null;
    }

    function stripInlineQuoteFromBubbleFields(b) {
        if (!b) return b;
        var fmt = global.MiyaChatOnlineFormat;
        var reQuote = fmt && fmt.RE_QUOTE ? fmt.RE_QUOTE : /^引用[-－—]\s*(.+)$/;
        var srcKey = b.type === 'voice' ? 'voiceText' : 'content';
        var c = trim(b[srcKey] || b.content || '');
        if (!c) return b;
        var qo = c.match(reQuote);
        if (!qo) return b;
        var boundary = splitGroupQuoteReplyBoundary(qo[1]);
        if (!boundary) return b;
        var next = Object.assign({}, b, {
            quoteRef: Object.assign({}, b.quoteRef || { dir: 'in' }, {
                text: trim(boundary.quotedText).slice(0, 200)
            })
        });
        if (b.type === 'voice') {
            next.voiceText = trim(boundary.replyText);
            next.content = '语音-' + next.voiceText;
        } else {
            next.content = trim(boundary.replyText);
        }
        return next;
    }

    function parseGroupOutputLines(lines, members, store, groupChatId, catalog, profile) {
        var fmt = global.MiyaChatOnlineFormat;
        var out = [];
        var lastSpeakerId = '';
        var batchLines = [];
        var batchSpeakerId = '';

        function pushGroupBubble(b, speakerId) {
            if (!b) return;
            b = stripInlineQuoteFromBubbleFields(b);
            var sid = trim(speakerId || b.senderContactId || lastSpeakerId);
            var row = Object.assign({}, b, {
                role: 'assistant',
                senderContactId: sid
            });
            if (row.quoteRef && sid) {
                row.quoteRef = enrichGroupMessageQuoteRef(
                    row.quoteRef,
                    store,
                    groupChatId,
                    members,
                    profile
                );
            }
            if (sid) lastSpeakerId = sid;
            out.push(row);
        }

        function flushBatch() {
            if (!batchLines.length || !batchSpeakerId) {
                batchLines = [];
                batchSpeakerId = '';
                return;
            }
            if (fmt && typeof fmt.parseRoleOutputLinesMeta === 'function') {
                var parsed = fmt.parseRoleOutputLinesMeta(batchLines, catalog);
                (parsed.bubbles || []).forEach(function (b) {
                    pushGroupBubble(b, batchSpeakerId);
                });
            } else {
                batchLines.forEach(function (raw) {
                    if (raw) pushGroupBubble({ type: 'text', content: raw }, batchSpeakerId);
                });
            }
            batchLines = [];
            batchSpeakerId = '';
        }

        function appendBatchLine(raw, speakerId) {
            var sid = trim(speakerId);
            if (!sid || !raw) return;
            if (batchSpeakerId && batchSpeakerId !== sid) flushBatch();
            batchSpeakerId = sid;
            lastSpeakerId = sid;
            batchLines.push(raw);
        }

        (lines || []).forEach(function (line) {
            var raw = trim(line);
            if (!raw) return;

            var m = raw.match(/^([^｜|:：]+)[｜|:：]\s*(.+)$/);
            if (!m) {
                var legacy = raw.match(/^【([^】]+)】\s*(.+)$/);
                if (legacy) {
                    m = [raw, legacy[1], legacy[2]];
                }
            }

            if (!m) {
                if (!lastSpeakerId) return;
                var trMatch = raw.match(/^译文[-－—：:]\s*(.+)$/);
                if (trMatch && out.length) {
                    flushBatch();
                    var lastBubble = out[out.length - 1];
                    var trMod = global.MiyaChatTranslate;
                    if (trMod && typeof trMod.attachTranslationToBubbleFields === 'function') {
                        trMod.attachTranslationToBubbleFields(lastBubble, trim(trMatch[1]));
                    } else {
                        lastBubble.translationZh = trim(trMatch[1]);
                    }
                    return;
                }
                appendBatchLine(raw, lastSpeakerId);
                return;
            }

            var contact = resolveMemberByLabel(trim(m[1]), members, store, groupChatId);
            if (!contact) return;
            var body = stripGroupSpeakerPrefixForDisplay(trim(m[2]), members, store, groupChatId, profile);
            if (!body) return;
            var grpRpMod = global.MiyaChatGroupRedPacket;
            if (grpRpMod && typeof grpRpMod.parseGroupRedPacketBody === 'function' && /^红包[-－—]/.test(body)) {
                flushBatch();
                var grpParsed = grpRpMod.parseGroupRedPacketBody(
                    body,
                    contact.id,
                    members,
                    store,
                    groupChatId,
                    profile
                );
                if (grpParsed) {
                    pushGroupBubble(grpParsed, contact.id);
                }
                return;
            }
            if (body) appendBatchLine(body, contact.id);
        });

        flushBatch();
        return out;
    }

    function collectStickerCatalog(store, members) {
        var fmt = global.MiyaChatOnlineFormat;
        if (!fmt) return [];
        var seen = {};
        var out = [];
        function pushList(list) {
            (list || []).forEach(function (it) {
                if (!it || !it.name || seen[it.name]) return;
                seen[it.name] = true;
                out.push(it);
            });
        }
        if (typeof fmt.collectStickerCatalogAll === 'function') {
            pushList(fmt.collectStickerCatalogAll(store));
        }
        if (typeof fmt.collectStickerCatalog === 'function') {
            (members || []).forEach(function (c) {
                pushList(fmt.collectStickerCatalog(store, c.id));
            });
        }
        return out;
    }

    function findGroupQuotedMessage(store, groupChatId, quoteRef, members, profile, beforeMsg) {
        if (!store || !groupChatId || !quoteRef) return null;
        if (quoteRef.msgId) {
            var byId = store.findMessage(groupChatId, quoteRef.msgId);
            if (byId && !byId.deleted) return byId;
        }
        var qt = trim(quoteRef.text);
        if (!qt) return null;
        var fmt = global.MiyaChatOnlineFormat;
        var getBody = function (row) {
            return fmt && typeof fmt.formatMessageBodyOnly === 'function'
                ? fmt.formatMessageBodyOnly(row)
                : row.content;
        };
        var matchQuote = fmt && typeof fmt.messageMatchesQuoteRef === 'function'
            ? fmt.messageMatchesQuoteRef
            : null;
        var list = store.getMessages(groupChatId);
        var endIdx = list.length - 1;
        if (beforeMsg && beforeMsg.id) {
            var j;
            for (j = list.length - 1; j >= 0; j--) {
                if (list[j] && list[j].id === beforeMsg.id) {
                    endIdx = j - 1;
                    break;
                }
            }
        }
        var i;
        for (i = endIdx; i >= 0; i--) {
            var row = list[i];
            if (!row || row.deleted) continue;
            if (matchQuote) {
                if (matchQuote(row, quoteRef, getBody)) return row;
            } else {
                var body = trim(getBody(row));
                if (body === qt) return row;
                if (
                    (qt === '[图片]' || qt.indexOf('图片') === 0) &&
                    row.type === 'image' &&
                    row.imageDataKey
                ) {
                    return row;
                }
            }
        }
        return null;
    }

    function groupQuoteSpeakerLabel(store, groupChatId, quotedMsg, members, profile) {
        if (!quotedMsg) return '成员';
        if (quotedMsg.role === 'user') return trim(profile && profile.name) || '用户';
        var sid = trim(quotedMsg.senderContactId);
        if (sid && members && members.length) {
            var sp = members.find(function (c) {
                return c.id === sid;
            });
            if (sp) return memberDisplayName(store, sp, groupChatId);
        }
        return '成员';
    }

    function enrichGroupMessageQuoteRef(quoteRef, store, groupChatId, members, profile) {
        if (!quoteRef || !trim(quoteRef.text)) return quoteRef;
        var next = Object.assign({}, quoteRef);
        var quoted = findGroupQuotedMessage(store, groupChatId, quoteRef, members, profile);
        if (!quoted) return next;
        if (!next.msgId) next.msgId = quoted.id;
        if (quoted.role === 'user') {
            next.dir = 'out';
            next.speakerName = trim(profile && profile.name) || '用户';
        } else {
            next.dir = 'in';
            next.senderContactId = trim(quoted.senderContactId);
            next.speakerName = groupQuoteSpeakerLabel(store, groupChatId, quoted, members, profile);
        }
        return next;
    }

    function formatPreview(store, chat, m) {
        if (!m) return '';
        if (m.type === 'group_red_packet' && m.groupRedPacket) {
            var prev =
                '[红包] ' +
                (m.groupRedPacket.mode === 'exclusive' ? '专属' : '拼手气') +
                ' ¥' +
                (m.groupRedPacket.totalAmount || 0);
            if (m.role === 'user') return '我: ' + prev;
            var members = getMembers(store, chat);
            var sid = trim(m.senderContactId);
            var c = sid
                ? members.find(function (x) {
                      return x.id === sid;
                  })
                : null;
            var name = c ? memberDisplayName(store, c, chat.id) : '成员';
            return name + ': ' + prev;
        }
        if (m.role === 'user') return '我: ' + trim(m.content).slice(0, 80);
        var members = getMembers(store, chat);
        var sid = trim(m.senderContactId);
        var c = sid
            ? members.find(function (x) {
                  return x.id === sid;
              })
            : null;
        var name = c ? memberDisplayName(store, c, chat.id) : '成员';
        var body = trim(m.content) || '[消息]';
        return name + ': ' + body.slice(0, 72);
    }

    function buildGroupMemoryBlockForPrivate(store, contact, profileId, privateChatId) {
        if (!store || !contact) return '';
        var groups =
            typeof store.findGroupChatsForContact === 'function'
                ? store.findGroupChatsForContact(contact.id, profileId)
                : [];
        if (!groups.length) return '';
        var aw = global.MiyaChatAwareness;
        var fmt = global.MiyaChatOnlineFormat;
        var blocks = [];
        groups.forEach(function (chat) {
            if (!chat || !isGroupChat(chat)) return;
            var gs = store.getChatSettings ? store.getChatSettings(chat.id) : null;
            if (!isMemoryInteropEnabled(gs)) return;
            var members = getMembers(store, chat);
            var parts = [
                '### 群聊·' +
                    trim(chat.title || '群聊') +
                    '（会话 id:' +
                    chat.id +
                    '，非本单聊）'
            ];
            if (aw && typeof aw.buildSummaryContextBlock === 'function') {
                var sum = aw.buildSummaryContextBlock(gs);
                if (sum) parts.push('〔群聊记忆总结〕\n' + sum);
            }
            var msgs =
                store.getMessagesForApi && typeof store.getMessagesForApi === 'function'
                    ? store.getMessagesForApi(chat.id)
                    : store.getMessages(chat.id);
            var snippetLimit = interopSnippetLimit(gs);
            var tail = msgs.slice(-snippetLimit);
            if (tail.length) {
                parts.push('〔群聊近期原文摘录·' + snippetLimit + ' 条内〕');
                tail.forEach(function (m) {
                    if (!m || m.deleted || m.role === 'system') return;
                    var body =
                        fmt && typeof fmt.formatMessageForApi === 'function'
                            ? fmt.formatMessageForApi(m)
                            : trim(m.content);
                    if (!body) return;
                    var who = '成员';
                    if (m.role === 'user') who = '用户';
                    else if (m.role === 'assistant') {
                        var sid = trim(m.senderContactId);
                        var sp = sid
                            ? members.find(function (x) {
                                  return x.id === sid;
                              })
                            : null;
                        who = sp ? memberDisplayName(store, sp, chat.id) : '成员';
                    }
                    parts.push('〔群·' + who + '｜' + body + '〕');
                });
            }
            if (parts.length > 1) blocks.push(parts.join('\n'));
        });
        if (!blocks.length) return '';
        return (
            '【互通·群聊记忆】\n' +
            '以下为该角色所在群聊的总结/摘录，仅供单聊剧情参考；禁止在单聊中复述群聊原句当作二人私事，禁止混淆场景。\n' +
            '【单聊格式边界】你正在单聊中回复用户：仍须遵守单聊三段式并输出 <heartvoice>；上方群聊摘录为〔群·名｜内容〕仅供剧情参考，不得模仿为「角色名：」群聊输出格式，不得省略心声。\n\n' +
            blocks.join('\n\n')
        );
    }

    global.MiyaChatGroup = {
        USER_OWNER_ID: USER_OWNER_ID,
        TITLE_COLOR_PRESETS: TITLE_COLOR_PRESETS,
        DEFAULT_TITLE_COLOR: DEFAULT_TITLE_COLOR,
        isGroupChat: isGroupChat,
        getMemberIds: getMemberIds,
        getMembers: getMembers,
        memberDisplayName: memberDisplayName,
        memberRealName: memberRealName,
        resolveMemberByLabel: resolveMemberByLabel,
        resolveTitleTarget: resolveTitleTarget,
        titleTargetDisplayName: titleTargetDisplayName,
        canActorChangeTargetTitle: canActorChangeTargetTitle,
        userDisplayName: userDisplayName,
        listOnlineGlobalWorldbookEntries: listOnlineGlobalWorldbookEntries,
        listMemberBoundLocalWorldbookEntries: listMemberBoundLocalWorldbookEntries,
        normalizeOwnerId: normalizeOwnerId,
        isUserOwner: isUserOwner,
        getMemberRole: getMemberRole,
        roleLabel: roleLabel,
        canManageTitles: canManageTitles,
        getMemberTitle: getMemberTitle,
        formatTitleChangeContent: formatTitleChangeContent,
        formatTitleChangeForApi: formatTitleChangeForApi,
        processAssistantBubbleForTitleChange: processAssistantBubbleForTitleChange,
        applyMemberTitlePatch: applyMemberTitlePatch,
        buildApiMessages: buildApiMessages,
        parseGroupOutputLines: parseGroupOutputLines,
        collectStickerCatalog: collectStickerCatalog,
        findGroupQuotedMessage: findGroupQuotedMessage,
        groupQuoteSpeakerLabel: groupQuoteSpeakerLabel,
        enrichGroupMessageQuoteRef: enrichGroupMessageQuoteRef,
        formatPreview: formatPreview,
        renderGroupListAvatarHtml: renderGroupListAvatarHtml,
        renderGroupCollageHtml: renderGroupCollageHtml,
        resolveGroupAvatarFromSettings: resolveGroupAvatarFromSettings,
        resolveGroupAvatarUrlAsync: resolveGroupAvatarUrlAsync,
        resolveMemberAvatarUrlAsync: resolveMemberAvatarUrlAsync,
        memberAvatarFallback: memberAvatarFallback,
        buildGroupMemoryBlockForPrivate: buildGroupMemoryBlockForPrivate,
        buildPerTurnGroupFormatReminder: buildPerTurnGroupFormatReminder,
        isMemoryInteropEnabled: isMemoryInteropEnabled,
        formatGroupMessageBody: formatGroupMessageBody,
        stripGroupSpeakerPrefixForDisplay: stripGroupSpeakerPrefixForDisplay
    };
})(window);
