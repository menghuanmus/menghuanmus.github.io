// ================================================================
//  js/network.js — 联机状态管理（Socket.IO 客户端辅助）
//  暴露: sendToPeer(), handlePeerData(), applyFullState(), applyPermissionLock()
// ================================================================

    /* DOM 元素 */
    const ROOM_OVERLAY = document.getElementById('room-overlay');
    const ROOM_HOME = document.getElementById('room-home');
    const ROOM_WAITING = document.getElementById('room-waiting');
    const ROOM_ID_CODE = document.getElementById('room-id-code');
    const ROOM_JOIN_INPUT = document.getElementById('room-join-input');
    const CONN_STATUS_BAR = document.getElementById('conn-status-bar');
    const CONN_DOT = document.getElementById('conn-dot');
    const CONN_STATUS_TEXT = document.getElementById('conn-status-text');

    /* 状态变量 */
    let localPlayerId = null;
    let isHost = false;
    let isSpectator = false;
    let isSoloMode = false;
    let lastRoomCode = null;

    // ---- 心跳 ----
    let heartbeatTimer = null;
    let lastPongTime = 0;
    let consecutivePingFails = 0;
    const HEARTBEAT_INTERVAL = 15000;
    const HEARTBEAT_TIMEOUT = 45000;

    // ---- 重连 ----
    let reconnectTimer = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    let joinTimeout = null;
    let peerLeft = false;

    // ---- 观众 ----
    let spectatorNameCounter = 0;

    function generateRoomCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
      return code;
    }

    function clearJoinTimeout() {
      if (joinTimeout) { clearTimeout(joinTimeout); joinTimeout = null; }
    }

    function updateSysChatTitle() {
      const el = document.getElementById('sys-chat-title-text');
      if (!el) return;
      var isMobile = (typeof window.matchMedia === 'function') && window.matchMedia('(max-width: 768px)').matches;
      var icon = isMobile ? '' : '📢 ';
      if (isSoloMode) { el.textContent = icon + '系统信息（单人模式）'; }
      else if (lastRoomCode) { el.textContent = icon + '系统信息（房间号：' + lastRoomCode + '）'; }
      else { el.textContent = icon + '系统信息'; }
    }

    function setConnStatus(ok, text) {
      // 全局顶部横条弃用，拆分为双方玩家各自的状态条（名字下方）
      if (CONN_STATUS_BAR) CONN_STATUS_BAR.hidden = true;
      setPlayerConnStatus(localPlayerId, ok, text);
    }

    /** 更新指定玩家的连接状态条（名字栏下方） */
    function setPlayerConnStatus(playerId, ok, text) {
      if (!playerId || playerId === '0') return;
      const zone = document.querySelector('.player-zone[data-player="' + playerId + '"]');
      if (!zone) return;
      let el = zone.querySelector('.player-conn-status');
      if (!el) {
        el = document.createElement('div');
        el.className = 'player-conn-status';
        el.innerHTML = '<span class="player-conn-dot"></span><span class="player-conn-text"></span>';
        const col = zone.querySelector('.player-name-col');
        (col || zone).appendChild(el);
      }
      const dot = el.querySelector('.player-conn-dot');
      const txt = el.querySelector('.player-conn-text');
      if (dot) dot.className = 'player-conn-dot' + (ok ? ' conn-ok' : '');
      if (txt) txt.textContent = text;
    }

    // ================================================================
    //  消息发送（由 auth.js 覆盖为 Socket.IO 实现）
    // ================================================================

    function sendToPeer(data) {
      if (typeof sendToServer === 'function') sendToServer({ type: 'game', data: data });
    }

    function broadcastToAll(data) { sendToPeer(data); }

    // ================================================================
    //  心跳（Socket.IO 自带心跳，这里仅作为后备）
    // ================================================================

    function startHeartbeat() {
      stopHeartbeat();
      heartbeatTimer = setInterval(function() {}, HEARTBEAT_INTERVAL);
    }

    function stopHeartbeat() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    }

    // ================================================================
    //  游戏消息处理（由 auth.js Socket.IO 的 update 事件驱动）
    // ================================================================

    function handlePeerData(data) {
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'slot-update':
          applyRemoteSlotUpdate(data.playerId, data.slotIndex, data.state);
          break;
        case 'deck-update':
          applyRemoteDeckState(data.playerId, data.deckCount, data.handCount, data.deckData, data.handData, data.graveData);
          break;
        case 'revealed-cards':
          if (data.playerId && Array.isArray(data.cardIds) && typeof playerRevealedCards !== 'undefined') {
            playerRevealedCards[data.playerId] = new Set(data.cardIds.filter(function(id) { return typeof id === 'number'; }));
          }
          break;
        case 'fate-revealed-cards':
          if (data.playerId && Array.isArray(data.cardIds) && typeof playerFateRevealedCards !== 'undefined') {
            playerFateRevealedCards[data.playerId] = new Set(data.cardIds.filter(function(id) { return typeof id === 'number'; }));
          }
          break;
        case 'hand-shown':
          if (data.playerId && Array.isArray(data.cardIds) && typeof playerHandShows !== 'undefined') {
            playerHandShows[data.playerId] = new Set(data.cardIds.filter(function(id) { return typeof id === 'number'; }));
          }
          break;
        case 'grave-target':
          if (typeof window.applyRemoteGraveTarget === 'function') window.applyRemoteGraveTarget(data.playerId, !!data.enabled);
          break;
        case 'food-card-register':
          if (data.card && typeof CardDB !== 'undefined' && typeof CardDB.addCustom === 'function') {
            CardDB.addCustom(data.card);
          }
          break;
        case 'bounty-update':
          if (typeof applyRemoteBounty === 'function') applyRemoteBounty(data.playerId, data.amount);
          break;
        case 'bounty-toggle':
          if (typeof applyRemoteBountyToggle === 'function') applyRemoteBountyToggle(data.playerId, data.active);
          break;
        case 'oracle-update':
          if (typeof applyRemoteOracle === 'function') applyRemoteOracle(data);
          break;
        case 'shop-update':
          if (typeof applyRemoteShop === 'function') applyRemoteShop(data);
          break;
        case 'chat':
          addChatMessage(data.playerId, data.text, data.senderName);
          break;
        case 'dice':
          // 文字已由 sysmsg（broadcastSystemMsg）同步给对方，这里只播远端骰子动画
          playRemoteDiceAnim(data.result);
          break;
        case 'effects-update':
          applyRemoteEffectsState(data.playerId, data.effects);
          break;
        case 'player-info':
          applyRemotePlayerInfo(data.playerId, data.name, data.hp);
          break;
        case 'sysmsg':
          addSystemChatMessage(data.text, data.food);
          break;
        case 'sysmsg-group':
          if (data.mainMsg && Array.isArray(data.subMsgs) && typeof _renderGroupedMessage === 'function') {
            _renderGroupedMessage({ mainMsg: data.mainMsg, subMsgs: data.subMsgs, food: data.food || null });
          }
          break;
        case 'avatar-update':
          setAvatarImage(data.playerId, data.imageSrc);
          break;
        case 'spec-name':
          if (data.name) { spectatorCustomName = data.name; document.getElementById('spectator-name-input').value = data.name; }
          break;
        case 'spec-assign':
          if (isSpectator && data.specNum) {
            spectatorNameCounter = data.specNum;
            var si = document.getElementById('spectator-name-input');
            if (si && !spectatorCustomName) si.value = '观众' + data.specNum;
          }
          break;
        case 'spec-loaded':
          if (isSpectator) {
            setConnStatus(true, '观战中');
            addSystemChatMessage('【系统】✅ 对局数据加载完成');
          }
          break;
        case 'room-full':
          if (!isSpectator) {
            isSpectator = true; localPlayerId = '0';
            addSystemChatMessage('【系统】房间已满，自动切换为观战模式');
            applyPermissionLock();
            if (typeof window.setSpectatorDisplayName === 'function') window.setSpectatorDisplayName(window._gameNickname || '');
          }
          break;
        case 'card-damage':
          applyRemoteCardDamage(data.playerId, data.slotIndex, data.dmg);
          break;
        case 'card-heal':
          applyRemoteCardHeal(data.playerId, data.slotIndex, data.amount);
          break;
        case 'player-heal':
          applyRemotePlayerHeal(data.playerId, data.amount);
          break;
        case 'player-damage':
          applyRemotePlayerDamage(data.playerId, data.dmg);
          break;
        case 'fire-update':
          applyRemoteFireState(data.playerId, data.count);
          break;
        case 'cook-effect':
          if (typeof DamageEffects !== 'undefined') {
            var zone = document.querySelector('.player-zone[data-player="' + data.playerId + '"]');
            if (zone) {
              var slot = zone.querySelector('.card-slot[data-slot-index="' + data.slotIndex + '"]');
              if (slot) {
                if (data.kind === 'insertfood' && DamageEffects.playInsertFoodEffect) DamageEffects.playInsertFoodEffect(slot);
                else if (DamageEffects.playCookEffect) DamageEffects.playCookEffect(slot);
              }
            }
          }
          break;
        case 'nightfall-toggle':
          if (typeof applyRemoteNightfall === 'function') applyRemoteNightfall(data.playerId, data.active, data.value);
          break;
        case 'nightfall-value':
          if (typeof applyRemoteNightfall === 'function') applyRemoteNightfall(data.playerId, true, data.value);
          break;
        case 'fx-ko':
          (function() {
            var sl = getSlotByIndex(data.playerId, data.slotIndex);
            if (sl && typeof DamageEffects !== 'undefined' && DamageEffects.playKoEffect) DamageEffects.playKoEffect(sl);
          })();
          break;
        case 'fx-revive':
          (function() {
            var sl = getSlotByIndex(data.playerId, data.slotIndex);
            if (sl && typeof DamageEffects !== 'undefined' && DamageEffects.playReviveEffect) DamageEffects.playReviveEffect(sl, null);
          })();
          break;
        case 'fx-anim':
          if (data.anim && typeof CardFlight !== 'undefined' && typeof CardFlight.playRemoteAnim === 'function') {
            CardFlight.playRemoteAnim(data.anim);
          }
          break;
      }
    }

    // ---- 远端动画 ----
    function playDiceAnim(result, btnEl) {
      var r = btnEl.getBoundingClientRect();
      var x = r.left + r.width/2, y = r.top;
      var el = document.createElement('div');
      el.textContent = '🎲';
      el.style.cssText = 'position:fixed;z-index:9999;font-size:2rem;pointer-events:none;left:'+(x-20)+'px;top:'+(y-10)+'px;';
      document.body.appendChild(el);
      var start = performance.now(), dur = 1000, peakY = -170;
      function anim(ts) {
        var t = Math.min((ts - start) / dur, 1), dy, rot, sc;
        if (t < 0.42) { var p = t / 0.42; dy = peakY * (1 - Math.pow(1-p,3)); rot = 540*p; sc = 1+0.6*p; }
        else if (t < 0.75) { var p = (t-0.42)/0.33; dy = peakY + (-peakY+20)*Math.pow(p,2); rot = 540+300*p; sc = 1.6-0.4*p; }
        else { var p = (t-0.75)/0.25; dy=20; rot=0; sc=1.2+2*p;
          if(!el.querySelector('span')){el.textContent='';el.style.display='flex';el.style.alignItems='center';el.style.justifyContent='center';
            var sp=document.createElement('span');sp.textContent=result;sp.style.cssText='font-size:1.8rem;font-weight:900;color:#fff;text-shadow:0 0 14px #7C83FF,0 0 28px #5B5FEF;';el.appendChild(sp);}
        }
        el.style.transform = 'translateY('+dy+'px) rotate('+rot+'deg) scale('+sc+')';
        if (t < 1) requestAnimationFrame(anim);
        else { el.style.transform='translateY(20px) rotate(0deg) scale(3.2)'; el.style.transition='transform 2s ease-out, opacity 0.6s ease-out';
          requestAnimationFrame(function(){el.style.transform='translateY(20px) rotate(0deg) scale(5)';});
          setTimeout(function(){el.style.opacity='0';},2000); setTimeout(function(){el.remove();},2600); }
      }
      requestAnimationFrame(anim);
    }

    function playRemoteDiceAnim(result) {
      var btn = document.getElementById('btn-dice-roll');
      if (btn) playDiceAnim(result, btn);
    }

    function applyRemoteCardDamage(playerId, slotIndex, dmg) {
      var sl = getSlotByIndex(playerId, slotIndex); if (!sl) return;
      if (typeof DamageEffects !== 'undefined') DamageEffects.playDamage(sl, dmg, 'damage');
    }
    function applyRemoteCardHeal(playerId, slotIndex, amount) {
      var sl = getSlotByIndex(playerId, slotIndex); if (!sl) return;
      if (typeof DamageEffects !== 'undefined') DamageEffects.playDamage(sl, amount, 'heal');
    }
    function applyRemotePlayerHeal(playerId, amount) {
      var zone = document.querySelector('.player-zone[data-player="' + playerId + '"]');
      if (!zone || typeof DamageEffects === 'undefined') return;
      var avatar = zone.querySelector('.player-avatar');
      DamageEffects.playDamage(avatar || zone, amount, 'heal');
    }
    function applyRemotePlayerDamage(playerId, dmg) {
      var zone = document.querySelector('.player-zone[data-player="' + playerId + '"]');
      if (!zone || typeof DamageEffects === 'undefined') return;
      var avatar = zone.querySelector('.player-avatar');
      DamageEffects.playDamage(avatar || zone, dmg, 'damage');
    }

    // ---- 鬼火 ----
    var playerFire = { '1': 2, '2': 2 };
    function syncFireState(playerId) {
      sendToPeer({ type: 'fire-update', playerId: playerId, count: playerFire[playerId] });
    }
    function applyRemoteFireState(playerId, count) {
      playerFire[playerId] = Math.max(0, Math.min(5, count));
      var area = document.querySelector('.player-zone[data-player="' + playerId + '"] .player-fire-area');
      if (!area) return;
      var iconsRow = area.querySelector('.fire-icons-row');
      if (iconsRow) {
        iconsRow.innerHTML = Array.from({ length: 5 }, function(_, i) {
          return '<span class="fire-icon" style="visibility:' + (i >= playerFire[playerId] ? 'hidden' : 'visible') + '">🔥</span>';
        }).join('');
      }
    }

    // ================================================================
    //  权限（模拟器理念：表面UI双方可编辑，仅隐藏信息限己方）
    // ================================================================

    function isMyZone(playerId) {
      if (isSoloMode) return true;
      if (isSpectator) return false;
      if (!localPlayerId) return true;
      return String(playerId) === String(localPlayerId);
    }
    function isMyElement(el) {
      if (isSoloMode) return true;
      if (!localPlayerId || isSpectator) {
        var zone = el.closest('.player-zone');
        return zone ? false : true;
      }
      var zone = el.closest('.player-zone');
      if (!zone) return true;
      return zone.dataset.player === localPlayerId;
    }

    function applyPermissionLock() {
      if (isSoloMode) {
        var t1 = document.getElementById('tag-your'), t2 = document.getElementById('tag-opp');
        if (t1) { t1.className = 'zone-owner-tag zone-owner-tag--yours tag-above-bar'; t1.hidden = false; }
        if (t2) { t2.className = 'zone-owner-tag zone-owner-tag--opponent tag-below-bar'; t2.hidden = false; }
        resetPermissionLock();
        return;
      }
      if (!localPlayerId) return;
      var tagYour = document.getElementById('tag-your');
      var tagOpp = document.getElementById('tag-opp');
      var specRow = document.getElementById('spectator-name-row');

      if (isSpectator) {
        document.querySelectorAll('.player-zone').forEach(function(zone) {
          zone.classList.add('player-zone--locked');
          zone.setAttribute('data-locked', 'all');
          zone.querySelectorAll('input, textarea, button, select').forEach(function(el) {
            el.setAttribute('data-locked', 'true');
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { el.readOnly = true; el.style.opacity = '0.6'; }
            else { el.disabled = true; el.style.opacity = '0.4'; el.style.cursor = 'not-allowed'; }
          });
        });
        // 中间栏全部按钮灰置
        document.querySelectorAll('.center-dice-bar input, .center-dice-bar button, .center-dice-bar select').forEach(function(el) {
          el.setAttribute('data-locked', 'true');
          el.disabled = true; el.style.opacity = '0.4'; el.style.cursor = 'not-allowed';
        });
        // 观众只能发言 + 改自己的观众名 + 看式神录
        var speakBtn = document.getElementById('btn-speak-unified');
        if (speakBtn) { speakBtn.removeAttribute('data-locked'); speakBtn.disabled = false; speakBtn.style.opacity = ''; speakBtn.style.cursor = ''; }
        // 观众可以打开坟场查看（坟场内部操作已对观众禁止）
        document.querySelectorAll('.btn-deck--grave').forEach(function(el) {
          el.removeAttribute('data-locked'); el.disabled = false; el.style.opacity = ''; el.style.cursor = '';
        });
        // 观众可以打开手牌/牌库查看（内部操作按钮已灰置禁点）
        document.querySelectorAll('.btn-deck[data-action="hand"], .btn-deck[data-action="deck"]').forEach(function(el) {
          el.removeAttribute('data-locked'); el.disabled = false; el.style.opacity = ''; el.style.cursor = '';
        });
        // 观众可以打开启悟区查看（内部操作按钮仅本人可见，观众只读）
        document.querySelectorAll('.btn-deck--oracle[data-action="oracle-zone"]').forEach(function(el) {
          el.removeAttribute('data-locked'); el.disabled = false; el.style.opacity = ''; el.style.cursor = '';
        });
        // 观众可以打开幻境/效果面板查看（内部输入框保持只读，添加按钮已隐藏）
        document.querySelectorAll('.btn-mobile-realm').forEach(function(el) {
          el.removeAttribute('data-locked'); el.disabled = false; el.style.opacity = ''; el.style.cursor = '';
        });
        var specNameInput = document.getElementById('spectator-name-input');
        if (specNameInput) { specNameInput.removeAttribute('data-locked'); specNameInput.readOnly = false; specNameInput.style.opacity = ''; }
        // 解锁"其他"下拉开关 + 式神录按钮（其余下拉项保持灰置）
        var otherToggle = document.getElementById('btn-dropdown-toggle');
        if (otherToggle) { otherToggle.removeAttribute('data-locked'); otherToggle.disabled = false; otherToggle.style.opacity = ''; otherToggle.style.cursor = ''; }
        var shikigamiBookBtn = document.querySelector('.dropdown-other__item[data-action="shikigami-book"]');
        if (shikigamiBookBtn) { shikigamiBookBtn.removeAttribute('data-locked'); shikigamiBookBtn.disabled = false; shikigamiBookBtn.style.opacity = ''; shikigamiBookBtn.style.cursor = ''; }
        // 解锁"其他"菜单里的退出按钮（观众可以退出房间）
        var exitBtn = document.getElementById('game-btn-exit');
        if (exitBtn) { exitBtn.removeAttribute('data-locked'); exitBtn.disabled = false; exitBtn.style.opacity = ''; exitBtn.style.cursor = ''; }
        if (tagYour) { tagYour.hidden = true; }
        if (tagOpp) { tagOpp.hidden = true; }
        if (specRow) specRow.hidden = false;
      } else {
        // 先解锁中间栏（清除观战锁定残留），再按玩家身份锁定战场区域
        document.querySelectorAll('.center-dice-bar input, .center-dice-bar button, .center-dice-bar select').forEach(function(el) {
          el.removeAttribute('data-locked'); el.disabled = false; el.style.opacity = ''; el.style.cursor = '';
        });
        document.querySelectorAll('.player-zone[data-player="' + localPlayerId + '"]').forEach(function(zone) {
          zone.classList.remove('player-zone--locked');
          zone.removeAttribute('data-locked');
          zone.querySelectorAll('input, textarea, button, select').forEach(function(el) {
            el.removeAttribute('data-locked'); el.disabled = false; el.readOnly = false; el.style.opacity = ''; el.style.cursor = '';
          });
        });
        var oppId = localPlayerId === '1' ? '2' : '1';
        document.querySelectorAll('.player-zone[data-player="' + oppId + '"]').forEach(function(zone) {
          zone.classList.add('player-zone--locked');
          zone.setAttribute('data-locked', 'surface');
          // 模拟器模式：允许点击对方手牌/牌库查看，但禁用蓄力/连引
          zone.querySelectorAll('[data-charge-btn], [data-renyin-btn]').forEach(function(el) {
            el.disabled = true; el.style.opacity = '0.4'; el.style.cursor = 'not-allowed';
          });
        });
        if (localPlayerId === '1') { if (tagYour) { tagYour.className = 'zone-owner-tag zone-owner-tag--yours tag-above-bar'; tagYour.hidden = false; } if (tagOpp) { tagOpp.className = 'zone-owner-tag zone-owner-tag--opponent tag-below-bar'; tagOpp.hidden = false; } }
        else { if (tagYour) { tagYour.className = 'zone-owner-tag zone-owner-tag--yours tag-below-bar'; tagYour.hidden = false; } if (tagOpp) { tagOpp.className = 'zone-owner-tag zone-owner-tag--opponent tag-above-bar'; tagOpp.hidden = false; } }
        if (specRow) specRow.hidden = true;
      }
    }

    function resetPermissionLock() {
      document.querySelectorAll('.player-zone').forEach(function(zone) {
        zone.classList.remove('player-zone--locked');
        zone.removeAttribute('data-locked');
        zone.querySelectorAll('input, textarea, button, select').forEach(function(el) {
          el.removeAttribute('data-locked'); el.disabled = false; el.readOnly = false; el.style.opacity = ''; el.style.cursor = '';
        });
      });
      // 中间栏也要解锁（观战锁定的残留，否则进入单人/联机后中间栏仍不可用）
      document.querySelectorAll('.center-dice-bar input, .center-dice-bar button, .center-dice-bar select').forEach(function(el) {
        el.removeAttribute('data-locked'); el.disabled = false; el.style.opacity = ''; el.style.cursor = '';
      });
    }

    // ================================================================
    //  onPeerConnected / 状态同步
    // ================================================================

    function onPeerConnected() {
      ROOM_OVERLAY.hidden = true; ROOM_HOME.hidden = false; ROOM_WAITING.hidden = true;
      document.getElementById('room-joining').hidden = true;
      applyPermissionLock();
      setConnStatus(true, '已连接');
      addSystemChatMessage('【系统】连接成功，游戏开始！');
    }

    function syncFullState() {
      if (!isConnected()) return;
      document.querySelectorAll('.player-zone[data-player="' + localPlayerId + '"] .card-slot').forEach(function(slot) { syncSlotToPeer(slot); });
      syncDeckState(localPlayerId); syncEffectsState(localPlayerId); syncPlayerInfo(localPlayerId); syncFireState(localPlayerId);
    }

    function syncFullStateForSpec() {
      if (!isConnected() || !isHost) return;
      ['1', '2'].forEach(function(pid) {
        document.querySelectorAll('.player-zone[data-player="' + pid + '"] .card-slot').forEach(function(slot) {
          var state = getSlotState(slot);
          sendToPeer({ type: 'slot-update', playerId: pid, slotIndex: parseInt(slot.dataset.slotIndex, 10), state: state });
        });
        var cards = getPlayerCardState(pid);
        var dummies = function(arr) { return arr.map(function(c) { return { id: c.id, name: '未知', curses: c.curses || [] }; }); };
        sendToPeer({ type: 'deck-update', playerId: pid, deckCount: cards.deck.length, handCount: cards.hand.length, deckData: dummies(cards.deck), handData: dummies(cards.hand), graveData: (cards.grave || []).filter(function(c) { return c && typeof c === 'object'; }) });
        sendToPeer({ type: 'effects-update', playerId: pid, effects: getEffectsState(pid) });
        var info = getPlayerInfo(pid); sendToPeer({ type: 'player-info', playerId: pid, name: info.name, hp: info.hp });
        sendToPeer({ type: 'fire-update', playerId: pid, count: playerFire[pid] });
      });
    }

    // ================================================================
    //  applyFullState（由 auth.js 在收到 room-state 时调用）
    // ================================================================

    function applyFullState(state) {
      if (!state) return;
      if (typeof slotSyncSuppress !== 'undefined') slotSyncSuppress = true;

      if (state.slots) {
        ['1', '2'].forEach(function(pid) {
          var slots = state.slots[pid]; if (!slots) return;
          slots.forEach(function(s, i) { if (s) { var slot = getSlotByIndex(pid, i); if (slot) setSlotState(slot, s); } });
        });
      }
      if (state.playerCards) {
        ['1', '2'].forEach(function(pid) {
          var pc = state.playerCards[pid]; if (!pc) return;
          var local = getPlayerCardState(pid);
          local.deck = Array.isArray(pc.deck) ? pc.deck : [];
          local.hand = Array.isArray(pc.hand) ? pc.hand : [];
          local.grave = Array.isArray(pc.grave) ? pc.grave : [];
          updateDeckButtons(pid);
        });
        if (typeof updateCardIdCounter === 'function') updateCardIdCounter();
      }
      if (state.playerInfo) { ['1', '2'].forEach(function(pid) { if (state.playerInfo[pid]) applyRemotePlayerInfo(pid, state.playerInfo[pid].name, state.playerInfo[pid].hp); }); }
      if (state.playerFire) { ['1', '2'].forEach(function(pid) { if (state.playerFire[pid] !== undefined) applyRemoteFireState(pid, state.playerFire[pid]); }); }
      if (state.effects) { ['1', '2'].forEach(function(pid) { if (state.effects[pid]) applyRemoteEffectsState(pid, state.effects[pid]); }); }
      if (state.bounty) { ['1', '2'].forEach(function(pid) { if (state.bounty[pid]) { if (typeof playerBounty !== 'undefined') playerBounty[pid] = state.bounty[pid].amount || 0; if (typeof updateBountyInput === 'function') updateBountyInput(pid); if (typeof applyRemoteBountyToggle === 'function') applyRemoteBountyToggle(pid, !!state.bounty[pid].active); } }); }
      if (state.nightfall) { ['1', '2'].forEach(function(pid) { if (state.nightfall[pid] && state.nightfall[pid].active && typeof applyRemoteNightfall === 'function') applyRemoteNightfall(pid, true, state.nightfall[pid].value || '0'); }); }
      if (state.oracle && typeof oracleActive !== 'undefined') { ['1', '2'].forEach(function(pid) { var o = state.oracle[pid]; if (!o) return; oracleActive[pid] = !!o.active; if (typeof oracleHands !== 'undefined') oracleHands[pid] = Array.isArray(o.cards) ? o.cards : []; var btn = document.getElementById('btn-oracle-zone-' + pid); if (btn) btn.hidden = !oracleActive[pid]; }); }
      if (state.shop && typeof getShop === 'function') {
        ['1', '2'].forEach(function(pid) {
          var s = state.shop[pid];
          if (!s) return;
          // 完整恢复：货架/库存/新加商品/优先队列（applyRemoteShop 内部已处理）
          if (typeof applyRemoteShop === 'function') {
            applyRemoteShop(Object.assign({ playerId: pid }, s));
          } else {
            var shop = getShop(pid);
            if (shop) {
              shop.level = s.level || 1;
              shop.upgradeProgress = s.upgradeProgress || 0;
              shop.upgradeNeeded = s.upgradeNeeded || 5;
              shop.refreshCost = s.refreshCost || 1;
              if (s.slotCount != null) shop.slotCount = s.slotCount;
            }
          }
        });
      }
      if (state.avatars) { ['1', '2'].forEach(function(pid) { if (state.avatars[pid]) setAvatarImage(pid, state.avatars[pid]); }); }
      if (state.revealedCards && typeof playerRevealedCards !== 'undefined') { ['1', '2'].forEach(function(pid) { if (state.revealedCards[pid]) playerRevealedCards[pid] = new Set(state.revealedCards[pid]); }); }
      if (state.fateRevealedCards && typeof playerFateRevealedCards !== 'undefined') { ['1', '2'].forEach(function(pid) { if (state.fateRevealedCards[pid]) playerFateRevealedCards[pid] = new Set(state.fateRevealedCards[pid]); }); }
      if (state.handShows && typeof playerHandShows !== 'undefined') { ['1', '2'].forEach(function(pid) { if (state.handShows[pid]) playerHandShows[pid] = new Set(state.handShows[pid]); }); }
      if (state.graveTargets && typeof window.applyGraveTargets === 'function') window.applyGraveTargets(state.graveTargets);

      // 恢复聊天记录
      if (state.chatLog && Array.isArray(state.chatLog)) {
        var logEl = document.getElementById('chat-system-log');
        var playerLogEl = document.getElementById('chat-player-log');
        if (logEl) logEl.innerHTML = '';
        if (playerLogEl) playerLogEl.innerHTML = '';
        state.chatLog.forEach(function(entry) {
          if (entry.type === 'sysmsg') addSystemChatMessage(entry.text);
          else if (entry.type === 'chat') addChatMessage(entry.from, entry.text, entry.senderName);
        });
      }

      if (typeof slotSyncSuppress !== 'undefined') slotSyncSuppress = false;
      updateAllDeckButtons();
    }
