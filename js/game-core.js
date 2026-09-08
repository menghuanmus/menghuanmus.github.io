// ================================================================
//  js/game-core.js — 游戏核心逻辑 (JS-2)
//  卡牌槽初始化与渲染、拖拽交换、倒计时/能量/气绝/灵咒系统、战场自适应布局
//  依赖: network.js (syncSlotToPeer等), CardDB
// ================================================================

    //  JS-2：游戏核心逻辑 —— 卡牌槽初始化与渲染
    // ================================================================
    const imageInput = document.getElementById('image-input');
    const avatarInput = document.getElementById('avatar-input');
    let activeSlotForImage = null;
    // 供外部（BonusPanel）设置当前上传目标
    window._setActiveSlotForImage = function(slot) { activeSlotForImage = slot; };
    let activeAvatarPlayer = null;
    let draggedSlot = null;
    let pointerOrigin = null;
    const DRAG_THRESHOLD = 8;

    const CARD_INNER_HTML = `
      <div class="card-art"><span class="placeholder-hint">点击添加图片</span></div>
      <label class="card-badge card-badge--level" title="等级">
        <input type="text" class="card-level" placeholder="级" aria-label="等级">
      </label>
      <div class="card-badge card-badge--awakened-frame"></div>
      <button type="button" class="card-badge card-badge--bonus" title="加成" aria-label="加成弹窗">💠</button>
      <label class="card-badge card-status-badge card-status-badge--power" title="战力/乏力" hidden>
        <input type="text" class="card-power" placeholder="战" aria-label="战力/乏力">
      </label>
      <label class="card-badge card-status-badge card-status-badge--armor" title="护甲/破甲" hidden>
        <input type="text" class="card-armor" placeholder="甲" aria-label="护甲/破甲">
      </label>
      <label class="card-badge card-badge--attack" title="攻击">
        <input type="text" class="card-attack" placeholder="攻" aria-label="攻击">
      </label>
      <label class="card-badge card-badge--hp" title="生命">
        <input type="text" class="card-hp" placeholder="命" aria-label="生命">
      </label>
      <img class="card-faction-icon" src="" alt="" style="display:none;">
      <label class="card-badge card-badge--name" title="卡牌名称">
        <input type="text" class="card-name" placeholder="名称" maxlength="12" aria-label="卡牌名称">
      </label>
    `;

    document.querySelectorAll('.card-slot').forEach(slot => {
      slot.innerHTML = CARD_INNER_HTML;
    });

    /* 为每个卡牌槽分配索引（0-4），方便联机同步定位 */
    document.querySelectorAll('.player-zone').forEach(zone => {
      const playerId = zone.dataset.player;
      zone.querySelectorAll('.card-slot').forEach((slot, index) => {
        slot.dataset.slotIndex = index;
        slot.dataset.slotPlayer = playerId;
      });
    });

    // ---- JS-1.4：状态同步 —— 卡牌槽 ----
    function getSlotByIndex(playerId, slotIndex) {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (!zone) return null;
      return zone.querySelectorAll('.card-slot')[slotIndex] || null;
    }

    /* 卡牌槽同步：防重入标志 */
    let slotSyncSuppress = false;

    /* 同步单个卡牌槽状态到对方 */
    function syncSlotToPeer(slot) {
      if (slotSyncSuppress || !window._gameSocket || !window._gameSocket.connected) return;
      const playerId = slot.dataset.slotPlayer;
      const slotIndex = parseInt(slot.dataset.slotIndex, 10);
      const state = getSlotState(slot);
      sendToPeer({
        type: 'slot-update',
        playerId,
        slotIndex,
        state,
      });
    }

    /* 应用远程卡牌槽更新 */
    function applyRemoteSlotUpdate(playerId, slotIndex, state) {
      slotSyncSuppress = true;
      const slot = getSlotByIndex(playerId, slotIndex);
      if (slot) {
        setSlotState(slot, state);
      }
      slotSyncSuppress = false;
    }

    // ---- JS-1.5：状态同步 —— 牌库/手牌 ----

    /* 发送牌库/手牌计数给对方（仅己方） */
    function syncDeckState(playerId) {
      if (!window._gameSocket || !window._gameSocket.connected) return;
      if (!isMyZone(playerId)) return;
      _sendDeckUpdate(playerId);
    }

    /* 强制同步牌库/手牌（跨玩家操作如烹饪也需同步） */
    function syncDeckStateForce(playerId) {
      if (!window._gameSocket || !window._gameSocket.connected) return;
      _sendDeckUpdate(playerId);
    }

    function _sendDeckUpdate(playerId) {
      const { deck, hand, grave } = getPlayerCardState(playerId);
      try {
        sendToPeer({
          type: 'deck-update',
          playerId,
          deckCount: deck.length,
          handCount: hand.length,
          deckData: deck.filter(c => c && typeof c === 'object'),
          handData: hand.filter(c => c && typeof c === 'object'),
          graveData: (grave || []).filter(c => c && typeof c === 'object'),
        });
      } catch(e) {
        console.error('[SyncDeck] 发送失败:', e);
      }
    }

    /* 接收对方的牌库/手牌/坟场计数，更新本地按钮 */
    function applyRemoteDeckState(playerId, deckCount, handCount, deckData, handData, graveData) {
      try {
        const state = getPlayerCardState(playerId);
        state.deck = Array.isArray(deckData) ? deckData.filter(c => c && typeof c === 'object') : [];
        state.hand = Array.isArray(handData) ? handData.filter(c => c && typeof c === 'object') : [];
        state.grave = Array.isArray(graveData) ? graveData.filter(c => c && typeof c === 'object') : (state.grave || []);
        if (typeof updateCardIdCounter === 'function') updateCardIdCounter();
        updateDeckButtons(playerId);
        if (typeof window.refreshGraveButtons === 'function') window.refreshGraveButtons();
      } catch(e) {
        console.error('[RemoteDeck] 更新失败:', e);
      }
    }

    // ---- JS-1.6：状态同步 —— 效果面板 ----

    function getEffectsState(playerId) {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (!zone) return [];
      const items = zone.querySelectorAll('.effect-item');
      return Array.from(items).map(item => ({
        name: item.querySelector('.effect-name').value,
        value: item.querySelector('.effect-value').value,
      }));
    }

    function syncEffectsState(playerId) {
      if (!window._gameSocket || !window._gameSocket.connected) return;
      sendToPeer({
        type: 'effects-update',
        playerId,
        effects: getEffectsState(playerId),
      });
    }

    function applyRemoteEffectsState(playerId, effects) {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (!zone) return;
      const panel = zone.querySelector('.effects-panel');
      panel.innerHTML = '';
      effects.forEach(eff => {
        const item = createEffectItem();
        item.querySelector('.effect-name').value = eff.name;
        item.querySelector('.effect-value').value = eff.value;
        panel.appendChild(item);
      });
      if (typeof applyStackLimitEffects === 'function') applyStackLimitEffects(playerId, false);
    }

    // ---- JS-1.7：状态同步 —— 玩家名称/生命值 ----

    function getPlayerInfo(playerId) {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (!zone) return { name: '', hp: '' };
      const nameInput = zone.querySelector('.player-name-input');
      const hpInput = zone.querySelector('.player-hp-input');
      return {
        name: nameInput ? nameInput.value : '',
        hp: hpInput ? hpInput.value : '',
      };
    }

    function syncPlayerInfo(playerId) {
      if (!window._gameSocket || !window._gameSocket.connected) return;
      const info = getPlayerInfo(playerId);
      sendToPeer({
        type: 'player-info',
        playerId,
        name: info.name,
        hp: info.hp,
      });
    }

    function applyRemotePlayerInfo(playerId, name, hp) {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (!zone) return;
      const nameInput = zone.querySelector('.player-name-input');
      const hpInput = zone.querySelector('.player-hp-input');
      if (nameInput) nameInput.value = name;
      if (hpInput) hpInput.value = hp;
    }

    function createEffectItem() {
      const item = document.createElement('div');
      item.className = 'effect-item';
      item.innerHTML = `
        <button type="button" class="btn-effect-drag" title="按住拖动排序">⠿</button>
        <input type="text" class="effect-name" placeholder="名称/描述">
        <input type="text" class="effect-value" placeholder="数值">
        <button type="button" class="btn-remove-effect">移除</button>
      `;
      item.querySelector('.btn-remove-effect').addEventListener('click', () => {
        if (typeof isSpectator !== 'undefined' && isSpectator) return;
        const playerId = item.closest('.player-zone').dataset.player;
        const name = item.querySelector('.effect-name').value || '未命名';
        item.remove();
        syncEffectsState(playerId);
        if (typeof applyStackLimitEffects === 'function') applyStackLimitEffects(playerId, true);
        broadcastSystemMsg(`【系统】${getPlayerName(playerId)}移除了幻境/效果「${name}」`);
      });
      // 观众视角下视觉变灰
      if (typeof isSpectator !== 'undefined' && isSpectator) {
        item.querySelector('.btn-remove-effect').disabled = true;
        item.querySelector('.btn-remove-effect').style.opacity = '0.4';
        item.querySelector('.btn-effect-drag').disabled = true;
        item.querySelector('.btn-effect-drag').style.opacity = '0.35';
        item.querySelectorAll('input').forEach(inp => { inp.readOnly = true; inp.style.opacity = '0.6'; });
      }
      return item;
    }

    // ---- 幻境/效果 拖动排序（按住条目前方手柄换序） ----
    function _initEffectsPanelDrag(panel) {
      if (panel.dataset.effectDragInit) return;
      panel.dataset.effectDragInit = '1';
      let grip = null, dragItem = null;
      const itemSelector = ':scope > .effect-item';
      const items = () => Array.from(panel.querySelectorAll(itemSelector));

      function endDrag(commit) {
        if (!dragItem) return;
        const spec = (typeof isSpectator !== 'undefined' && isSpectator);
        if (commit && !spec) {
          const playerId = panel.closest('.player-zone')?.dataset.player;
          if (playerId && typeof syncEffectsState === 'function') syncEffectsState(playerId);
        }
        dragItem.classList.remove('effect-dragging');
        if (grip) { grip.style.cursor = ''; }
        dragItem = null; grip = null;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
      }
      function onMove(e) {
        if (!dragItem) return;
        e.preventDefault();
        const y = e.clientY;
        const list = items();
        const cur = list.indexOf(dragItem);
        if (cur < 0) return;
        const rect = dragItem.getBoundingClientRect();
        // 向上拖：把拖动项逐个挪到指针上方的条目之前
        if (y < rect.top) {
          for (let i = cur - 1; i >= 0; i--) {
            if (y < list[i].getBoundingClientRect().bottom) list[i].before(dragItem);
            else break;
          }
        } else if (y > rect.bottom) {
          // 向下拖：把拖动项逐个挪到指针下方的条目之后
          for (let i = cur + 1; i < list.length; i++) {
            if (y > list[i].getBoundingClientRect().top) list[i].after(dragItem);
            else break;
          }
        }
      }
      function onUp() { endDrag(true); }
      function startDrag(g, item) {
        if (typeof isSpectator !== 'undefined' && isSpectator) return;
        grip = g; dragItem = item;
        item.classList.add('effect-dragging');
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onUp, true);
      }
      panel.addEventListener('pointerdown', (e) => {
        const g = e.target.closest('.btn-effect-drag');
        if (!g || !panel.contains(g)) return;
        const item = g.closest('.effect-item');
        if (!item) return;
        e.preventDefault();
        startDrag(g, item);
      });
    }

    document.querySelectorAll('.btn-add-effect').forEach(btn => {
      btn.addEventListener('click', () => {
        if (typeof isSpectator !== 'undefined' && isSpectator) return;
        const zone = btn.closest('.player-zone');
        const panel = zone.querySelector('.effects-panel');
        panel.appendChild(createEffectItem());
        syncEffectsState(zone.dataset.player);
        if (typeof applyStackLimitEffects === 'function') applyStackLimitEffects(zone.dataset.player, true);
        broadcastSystemMsg(`【系统】${getPlayerName(zone.dataset.player)}添加了幻境/效果`);
      });
    });

    // 为两个幻境/效果面板挂上拖拽排序委托
    document.querySelectorAll('.effects-panel').forEach(panel => _initEffectsPanelDrag(panel));

    // ---- JS-1.6b：特定效果「堆叠上限：卡牌名」 ----

    /** 应用堆叠上限效果：效果名称「堆叠上限：卡牌名」+ 数值（最低 1） */
    function applyStackLimitEffects(playerId, doSync) {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (!zone) return;
      const state = getPlayerCardState(playerId);
      if (!state) return;
      const deck = state.deck || [];
      const hand = state.hand || [];

      // 收集规则：卡牌名 -> 上限（同名多条取最后一条；数值最低 1；未填数值不生效）
      const limits = {};
      zone.querySelectorAll('.effect-item').forEach(function(item) {
        const name = (item.querySelector('.effect-name')?.value || '').trim();
        const m = name.match(/^堆叠上限[：:](.+)$/);
        if (!m) return;
        const cardName = m[1].trim();
        if (!cardName) return;
        const rawVal = (item.querySelector('.effect-value')?.value || '').trim();
        if (!rawVal) return;
        let val = parseInt(rawVal, 10);
        if (Number.isNaN(val)) return;
        if (val < 1) val = 1;
        limits[cardName] = val;
      });

      let splitCount = 0;
      const splitNames = [];
      const applyTo = function(card, isHand) {
        if (!card || typeof card !== 'object') return;
        const db = (typeof CardDB !== 'undefined' && CardDB.lookup) ? CardDB.lookup(card.name) : null;
        const dbMax = (db && db.maxStack) ? db.maxStack : 0;
        const newMax = (limits[card.name] !== undefined) ? limits[card.name] : dbMax;
        if (newMax <= 0) { card._maxStack = 0; return; }
        if (!card._stack) card._stack = 1;
        card._maxStack = newMax;
        if (!isHand || card._stack <= newMax) return;
        // 超上限：拆成多个堆叠（每叠 <= 新上限，余数单独成叠，最低 1 层）
        const parts = [];
        let remain = card._stack;
        while (remain > 0) {
          const layer = Math.min(remain, newMax);
          parts.push(layer);
          remain -= layer;
        }
        card._stack = parts[0];
        const baseIdx = hand.indexOf(card);
        for (let i = 1; i < parts.length; i++) {
          const nc = createCard(card.name);
          nc._stack = parts[i];
          nc._maxStack = newMax;
          hand.splice(baseIdx + i, 0, nc);
          splitCount++;
        }
        if (splitNames.indexOf(card.name) === -1) splitNames.push(card.name);
      };
      deck.forEach(function(c) { applyTo(c, false); });
      hand.slice().forEach(function(c) { applyTo(c, true); });

      updateDeckButtons(playerId);
      if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
      if (doSync) {
        if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId);
        else if (typeof syncDeckState === 'function') syncDeckState(playerId);
      }
      if (splitCount > 0) {
        const names = splitNames.join('、');
        broadcastSystemMsg(`【系统】${getPlayerName(playerId)}的「${names}」堆叠上限调整，超出的${splitCount}叠已拆分`);
      }
    }

    // ---- 特定效果说明书（后续可继续加条目） ----
    const EFFECT_MANUAL = [
      {
        title: '堆叠上限：卡牌名',
        body: '仅对具有堆叠的卡牌有效。\n填写该效果后，数值则为该卡牌新的堆叠上限。数值留空则不生效。\n若手牌中已有堆叠超过新上限，多出的层数会自动拆分为新的堆叠。删除效果后恢复为卡牌数据中的默认上限。\n【示例】堆叠上限：生命精华',
      },
    ];

    function openEffectManual() {
      let ov = document.getElementById('effect-manual-overlay');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'effect-manual-overlay';
        ov.className = 'effect-manual-overlay';
        ov.hidden = true;
        ov.innerHTML = '<div class="effect-manual-dialog">' +
          '<div class="effect-manual-header"><span>📖 特定效果说明</span><button type="button" class="effect-manual-close">✕</button></div>' +
          '<div class="effect-manual-body"></div></div>';
        document.body.appendChild(ov);
        ov.querySelector('.effect-manual-close').addEventListener('click', function() { ov.hidden = true; });
        ov.addEventListener('click', function(e) { if (e.target === ov) ov.hidden = true; });
        const body = ov.querySelector('.effect-manual-body');
        EFFECT_MANUAL.forEach(function(sec) {
          const secEl = document.createElement('div');
          secEl.className = 'effect-manual-sec';
          const t = document.createElement('div');
          t.className = 'effect-manual-sec__title';
          t.textContent = sec.title;
          const b = document.createElement('div');
          b.className = 'effect-manual-sec__body';
          b.textContent = sec.body;
          secEl.appendChild(t);
          secEl.appendChild(b);
          body.appendChild(secEl);
        });
      }
      ov.hidden = false;
    }
    window.openEffectManual = openEffectManual;

    document.addEventListener('click', function(e) {
      const b = e.target.closest ? e.target.closest('.btn-effect-manual') : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      openEffectManual();
    });

    function getCardArt(slot) {
      return slot.querySelector('.card-art');
    }

    function setSlotImage(slot, src) {
      // 相对路径当场转为完整 URL，不等 MutationObserver，确保 sync 拿到正确 URL
      if (src && (src.startsWith('images/') || src.startsWith('../images/'))) {
        src = (window._IMAGE_BASE || '') + '/' + src.replace('../','');
      }
      const art = getCardArt(slot);
      let img = art.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '卡牌';
        art.appendChild(img);
      }
      img.src = src;
      // 加载失败回退到无图
      img.onerror = function() {
        if (this.src !== _noImagePath()) {
          this.src = _noImagePath();
          this.onerror = null; // 防止无限循环
        }
      };
      slot.classList.add('has-image');
    }

    function _noImagePath() {
      // 相对于 images/ 目录，与式神文件夹同级
      return 'images/无图.png';
    }

    function clearSlotImage(slot) {
      const img = getCardArt(slot).querySelector('img');
      if (img) img.remove();
      slot.classList.remove('has-image');
    }

    function getSlotImageSrc(slot) {
      const img = getCardArt(slot).querySelector('img');
      return img ? img.src : null;
    }

    /** 自动切换卡图：形态优先 → 觉醒 → 默认（仅当图片存在时切换，否则保持原图） */
    function autoUpdateSlotImage(slot) {
      // 手动上传的卡图（base64 data URL）不参与自动切换，全程保留
      var curSrc = getSlotImageSrc(slot);
      if (curSrc && curSrc.startsWith('data:')) return;
      const baseName = slot.querySelector('.card-name')?.value?.trim();
      if (!baseName) return;
      const baseUrl = (window._IMAGE_BASE || '') + '/';

      // 召唤物的卡图放在所属式神文件夹下（images/式神名/召唤物名.png）
      const dbCard = (typeof CardDB !== 'undefined' && CardDB.lookup) ? CardDB.lookup(baseName) : null;
      const isSummon = slot.dataset.slotType === 'summon' || (dbCard && dbCard.type === 'summon');
      const folder = (isSummon && dbCard && dbCard.owner) ? dbCard.owner : baseName;

      const paths = [];
      if (slot._formName) paths.push(baseUrl + 'images/' + folder + '/' + slot._formName + '.png');
      // 觉醒图：优先用式神管理里填写的觉醒牌名，其次查数据库，均不依赖属性
      if (slot.classList.contains('awakened')) {
        const customAwaken = slot._awakenCardName || '';
        if (customAwaken) paths.push(baseUrl + 'images/' + folder + '/' + customAwaken + '.png');
        if (typeof CardDB !== 'undefined' && CardDB.getAll) {
          const awakenDefs = CardDB.getAll().filter(c => c && c.awakened && c.owner === baseName);
          if (awakenDefs.length && awakenDefs[0].name !== customAwaken) {
            paths.push(baseUrl + 'images/' + folder + '/' + awakenDefs[0].name + '.png');
          }
        }
      }
      const mods = slot._permAtkMods || [];
      for (let i = mods.length - 1; i >= 0; i--) {
        const src = mods[i].source || '';
        if (src.includes('觉醒')) {
          const awakenCard = src.endsWith('（觉醒）') ? src.slice(0, -4) : src;
          paths.push(baseUrl + 'images/' + folder + '/' + awakenCard + '.png');
          break;
        }
      }
      paths.push(baseUrl + 'images/' + folder + '/' + baseName + '.png');

      // 依次尝试加载，第一个成功的就用它，都不成功则不动
      _trySetImage(slot, paths, 0);
    }

    function _trySetImage(slot, paths, idx) {
      if (idx >= paths.length) {
        // 全部路径都加载失败，最后一招：显示"无图"
        setSlotImage(slot, _noImagePath());
        if (typeof syncSlotToPeer === 'function' && !slotSyncSuppress) syncSlotToPeer(slot);
        return;
      }
      const testImg = new Image();
      testImg.onload = () => {
        setSlotImage(slot, paths[idx]);
        if (typeof syncSlotToPeer === 'function' && !slotSyncSuppress) syncSlotToPeer(slot);
      };
      testImg.onerror = () => _trySetImage(slot, paths, idx + 1);
      testImg.src = paths[idx];
    }

    function getSlotState(slot) {
      const cdBadge = slot.querySelector('.card-badge--countdown');
      const enBadge = slot.querySelector('.card-badge--energy');
      return {
        imageSrc: getSlotImageSrc(slot),
        level: slot.querySelector('.card-level').value,
        attack: slot.querySelector('.card-attack').value,
        hp: slot.querySelector('.card-hp').value,
        name: slot.querySelector('.card-name').value,
        countdown: cdBadge ? (cdBadge.querySelector('input').value || '') : '',
        energy: enBadge ? (enBadge.querySelector('input').value || '') : '',
        baseCountdown: slot._baseCountdown || 0,
        baseEnergy: slot._baseEnergy || 0,
        ko: slot.querySelector('.ko-overlay') ? (slot.querySelector('.ko-circle input').value || '1') : '',
        curses: getSlotCurses(slot),
        awakened: slot.classList.contains('awakened'),
        awakenName: slot._awakenCardName || '',
        permAtkMods: slot._permAtkMods || [],
        permHpMods: slot._permHpMods || [],
        permAbility: slot._permAbility || '',
        permEffects: slot._permEffects || [],
        formName: slot._formName || '',
        formAtk: slot._formAtk || 0,
        formHp: slot._formHp || 0,
        formAbility: slot._formAbility || '',
        tempAtkMods: slot._tempAtkMods || [],
        tempHpMods: slot._tempHpMods || [],
        baseAbility: slot._baseAbility || '',
        slotType: slot.dataset.slotType || 'shikigami',
        slotFaction: slot.dataset.slotFaction || '',
        chargedCount: (slot._chargedCards || []).length,
        baseAtk: slot._baseAtk !== undefined ? slot._baseAtk : 0,
        baseHp: slot._baseHp !== undefined ? slot._baseHp : 0,
        armor: slot._armor || 0,
        power: slot._power || 0,
      };
    }

    function setSlotState(slot, state) {
      if (state.imageSrc) setSlotImage(slot, state.imageSrc);
      else clearSlotImage(slot);
      slot.querySelector('.card-level').value = state.level;
      slot.querySelector('.card-attack').value = state.attack;
      slot.querySelector('.card-hp').value = state.hp;
      slot.querySelector('.card-name').value = state.name;
      updateSlotCountdownBadge(slot, state.countdown || '');
      updateSlotEnergyBadge(slot, state.energy || '');
      updateKoOverlay(slot, state.ko || '');
      // 基础倒计时/能量数值（回合开始到期重置用）
      if (state.baseCountdown !== undefined) slot._baseCountdown = state.baseCountdown;
      if (state.baseEnergy !== undefined) slot._baseEnergy = state.baseEnergy;
      setSlotCurses(slot, state.curses || []);
      // 觉醒标记
      if (state.awakened) { slot.classList.add('awakened'); } else { slot.classList.remove('awakened'); }
      // 永久属性
      slot._permAtkMods = state.permAtkMods || [];
      slot._permHpMods = state.permHpMods || [];
      slot._permAbility = state.permAbility || '';
      slot._permEffects = state.permEffects || [];
      // 形态
      slot._formName = state.formName || '';
      slot._formAtk = state.formAtk || 0;
      slot._formHp = state.formHp || 0;
      slot._formAbility = state.formAbility || '';
      // 基础能力（觉醒能力仍在 _permAbility）
      if (state.baseAbility !== undefined) slot._baseAbility = state.baseAbility;
      // 临时属性
      slot._tempAtkMods = state.tempAtkMods || [];
      slot._tempHpMods = state.tempHpMods || [];
      // 类型 / 派系
      if (state.slotType) slot.dataset.slotType = state.slotType;
      if (state.awakenName !== undefined) slot._awakenCardName = state.awakenName;
      if (state.slotFaction) slot.dataset.slotFaction = state.slotFaction;
      // 基础攻/命（玩家在式神管理中设置，用于重置/复活）
      if (state.baseAtk !== undefined) slot._baseAtk = state.baseAtk;
      if (state.baseHp !== undefined) slot._baseHp = state.baseHp;
      // 护甲/战力状态（正=护甲/战力，负=破甲/乏力）
      if (state.armor !== undefined) slot._armor = state.armor;
      if (state.power !== undefined) slot._power = state.power;
      updateStatusBadges(slot);
      // 蓄力数量：智能合并真实卡牌（cardId≠-1）和 placeholder
      if (typeof state.chargedCount === 'number') {
        if (!slot._chargedCards) slot._chargedCards = [];
        const realCards = slot._chargedCards.filter(c => c.cardId !== -1);
        const targetPlaceholders = Math.max(0, state.chargedCount - realCards.length);
        const placeholders = Array.from({ length: targetPlaceholders }, () => ({
          cardId: -1, cardName: '?', cardData: {}, chargedBy: '?'
        }));
        slot._chargedCards = realCards.concat(placeholders);
        if (typeof Charge !== 'undefined' && Charge.updateIndicator) Charge.updateIndicator(slot);
      }
      // 同步派系图标
      const factionIcon = slot.querySelector('.card-faction-icon');
      if (factionIcon) {
        const fac = slot.dataset.slotFaction;
        if (fac && fac !== '无相') {
          factionIcon.src = (window._IMAGE_BASE || '') + '/images/派系/' + fac + '.png';
          factionIcon.style.display = '';
        } else {
          factionIcon.style.display = 'none';
        }
      }
      // 召唤物隐藏等级徽章
      const levelBadge = slot.querySelector('.card-badge--level');
      if (levelBadge) levelBadge.style.display = (slot.dataset.slotType === 'summon') ? 'none' : '';
      if (!slotSyncSuppress) updateAwakenedMark(slot);
      // 自动切换卡图：形态 > 觉醒 > 默认（仅当没有显式设置 imageSrc 时）
      if (!state.imageSrc) autoUpdateSlotImage(slot);
      if (!slotSyncSuppress) syncSlotToPeer(slot);
      renderFormBadge(slot);
    }

    // 渲染形态标签（卡牌名下方）
    function renderFormBadge(slot) {
      var formName = slot._formName || '';
      var existing = slot.querySelector('.card-form-badge');
      if (formName) {
        if (!existing) {
          existing = document.createElement('div');
          existing.className = 'card-form-badge';
          slot.appendChild(existing);
        }
        existing.textContent = formName;
      } else {
        if (existing) existing.remove();
      }
    }

    imageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const slot = activeSlotForImage;
      imageInput.value = '';
      activeSlotForImage = null;
      if (!file || !slot) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        // 压缩卡图：限制宽400px，JPEG质量0.8，减少体积
        const img = new Image();
        img.onload = function() {
          var w = img.width, h = img.height;
          var maxW = 400;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          var dataUrl = c.toDataURL('image/jpeg', 0.8);
          setSlotImage(slot, dataUrl);
          // 初次上传卡图且未设派系：默认归入无相
          if (!slot.dataset.slotFaction) slot.dataset.slotFaction = '无相';
          // 新式神（还没填名字）：攻/命保持空，等级默认 1；首次修改攻/命时自动记为“基础值”
          const nameInp0 = slot.querySelector('.card-name');
          if (!nameInp0 || !nameInp0.value.trim()) {
            const aInp0 = slot.querySelector('.card-attack');
            const hInp0 = slot.querySelector('.card-hp');
            const lInp0 = slot.querySelector('.card-level');
            if (aInp0) aInp0.value = '';
            if (hInp0) hInp0.value = '';
            if (lInp0) lInp0.value = '1';
          }
          syncSlotToPeer(slot);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    /* 头像系统 */
    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      const playerId = activeAvatarPlayer;
      avatarInput.value = '';
      activeAvatarPlayer = null;
      if (!file || !playerId) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setAvatarImage(playerId, ev.target.result);
        if (isConnected()) {
          sendToPeer({ type: 'avatar-update', playerId, imageSrc: ev.target.result });
        }
      };
      reader.readAsDataURL(file);
    });

    function setAvatarImage(playerId, src) {
      const avatar = document.querySelector(`.player-avatar[data-avatar-player="${playerId}"]`);
      if (!avatar) return;
      let img = avatar.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '头像';
        avatar.appendChild(img);
      }
      img.src = src;
      avatar.classList.add('has-avatar');
    }

    document.querySelectorAll('.player-avatar').forEach(av => {
      av.addEventListener('click', () => {
        if (typeof isTargeting !== 'undefined' && isTargeting) return;
        if (!isMyElement(av)) return;
        activeAvatarPlayer = av.dataset.avatarPlayer;
        avatarInput.click();
      });
    });

    /* 交换卡牌槽内容 */
    function swapSlotContents(a, b) {
      const stateA = getSlotState(a);
      const stateB = getSlotState(b);
      // 交换蓄力数据，确保蓄力状态跟式神走
      const chargedA = a._chargedCards;
      const chargedB = b._chargedCards;
      slotSyncSuppress = true;
      setSlotState(a, stateB);
      setSlotState(b, stateA);
      a._chargedCards = chargedB;
      b._chargedCards = chargedA;
      if (typeof Charge !== 'undefined' && Charge.updateIndicator) {
        Charge.updateIndicator(a);
        Charge.updateIndicator(b);
      }
      slotSyncSuppress = false;
      syncSlotToPeer(a);
      syncSlotToPeer(b);
    }

    // ---- 倒计时 / 能量 / 气绝 徽章渲染 ----
    const ICON_CD = '<span class="badge-icon">⏳</span>';
    const ICON_EN = '<span class="badge-icon">🏮</span>';

    function createCountdownBadge(value) {
      const div = document.createElement('div');
      div.className = 'card-badge card-badge--countdown';
      div.innerHTML = ICON_CD + '<input type="text" value="' + (value || '1') + '" placeholder="" aria-label="倒计时">';
      div.querySelector('input').addEventListener('change', () => {
        const slot = div.closest('.card-slot');
        if (slot) syncSlotToPeer(slot);
      });
      return div;
    }

    function createEnergyBadge(value) {
      const div = document.createElement('div');
      div.className = 'card-badge card-badge--energy';
      div.innerHTML = ICON_EN + '<input type="text" value="' + (value || '1') + '" placeholder="" aria-label="能量">';
      div.querySelector('input').addEventListener('change', () => {
        const slot = div.closest('.card-slot');
        if (slot) syncSlotToPeer(slot);
      });
      return div;
    }

    function updateSlotCountdownBadge(slot, value) {
      const existing = slot.querySelector('.card-badge--countdown');
      if (value) {
        if (existing) {
          existing.querySelector('input').value = value;
        } else {
          slot.appendChild(createCountdownBadge(value));
        }
      } else {
        if (existing) existing.remove();
      }
      _fixBadgePositions(slot);
    }

    function updateKoOverlay(slot, value) {
      var existing = slot.querySelector('.ko-overlay');
      if (value) {
        if (!existing) {
          var overlay = document.createElement('div');
          overlay.className = 'ko-overlay';
          overlay.innerHTML = '<div class="ko-circle"><input type="text" value="' + value + '" aria-label="气绝倒计时"></div>';
          overlay.querySelector('input').addEventListener('change', function() {
            syncSlotToPeer(slot);
          });
          slot.appendChild(overlay);
        } else {
          var inp = existing.querySelector('input');
          if (inp) inp.value = value;
        }
      } else {
        if (existing) existing.remove();
      }
    }

    function updateSlotEnergyBadge(slot, value) {
      const existing = slot.querySelector('.card-badge--energy');
      if (value) {
        if (existing) {
          existing.querySelector('input').value = value;
        } else {
          slot.appendChild(createEnergyBadge(value));
        }
      } else {
        if (existing) existing.remove();
      }
      _fixBadgePositions(slot);
    }

    function _fixBadgePositions(slot) {
      var cd = slot.querySelector('.card-badge--countdown');
      var en = slot.querySelector('.card-badge--energy');
      if (cd && en) {
        // 两者都在：倒计时在右上角，能量在左侧
        cd.style.right = '0';
        en.style.right = '48px';
      } else if (cd) {
        cd.style.right = '0';
      } else if (en) {
        en.style.right = '0';
      }
    }

    /** 护甲/破甲伤害结算：护甲抵伤、破甲加伤并消耗。返回 { final, absorb, extra, newHp }（已扣血） */
    window.dealDamageToSlot = function(slot, amount) {
      const hpInput = slot.querySelector('.card-hp');
      const currentHp = hpInput ? (parseInt(hpInput.value, 10) || 0) : 0;
      let armor = slot._armor || 0;
      let final = amount, absorb = 0, extra = 0;
      if (armor > 0) {
        absorb = Math.min(armor, amount);
        armor -= absorb;
        final = amount - absorb;
      } else if (armor < 0) {
        extra = Math.abs(armor);
        final = amount + extra;
        armor = 0;
      }
      slot._armor = armor;
      if (typeof updateStatusBadges === 'function') updateStatusBadges(slot);
      const newHp = Math.max(0, currentHp - final);
      if (hpInput) hpInput.value = newHp || '';
      return { final: final, absorb: absorb, extra: extra, newHp: newHp };
    };

    /** 治疗结算：最多恢复到上限（基础+永久+临时），不会超过上限。返回 { actual, newHp, cap }（已加血） */
    window.healSlot = function(slot, amount) {
      const hpInput = slot.querySelector('.card-hp');
      const currentHp = hpInput ? (parseInt(hpInput.value, 10) || 0) : 0;
      const cap = (typeof calcFullHp === 'function') ? calcFullHp(slot) : currentHp;
      const newHp = Math.min(currentHp + amount, Math.max(currentHp, cap));
      const actual = newHp - currentHp;
      if (hpInput) hpInput.value = newHp || '';
      return { actual: actual, newHp: newHp, cap: cap };
    };

    /** 更新护甲/战力状态徽章（0 时隐藏；正=护甲/战力，负=破甲/乏力；图片底+可编辑输入框） */
    function updateStatusBadges(slot) {
      if (!slot) return;
      const armor = slot._armor || 0;
      const power = slot._power || 0;
      const armorEl = slot.querySelector('.card-status-badge--armor');
      const powerEl = slot.querySelector('.card-status-badge--power');
      if (armorEl) {
        const inp = armorEl.querySelector('input');
        if (armor > 0) {
          armorEl.className = 'card-badge card-status-badge card-status-badge--armor card-status-badge--armor-pos';
          armorEl.hidden = false;
          if (inp) inp.value = armor;
        } else if (armor < 0) {
          armorEl.className = 'card-badge card-status-badge card-status-badge--armor card-status-badge--armor-neg';
          armorEl.hidden = false;
          if (inp) inp.value = Math.abs(armor);
        } else {
          armorEl.hidden = true;
          if (inp) inp.value = '';
        }
      }
      if (powerEl) {
        const inp = powerEl.querySelector('input');
        if (power > 0) {
          powerEl.className = 'card-badge card-status-badge card-status-badge--power card-status-badge--power-pos';
          powerEl.hidden = false;
          if (inp) inp.value = power;
        } else if (power < 0) {
          powerEl.className = 'card-badge card-status-badge card-status-badge--power card-status-badge--power-neg';
          powerEl.hidden = false;
          if (inp) inp.value = Math.abs(power);
        } else {
          powerEl.hidden = true;
          if (inp) inp.value = '';
        }
      }
    }

    function removeCountdownBadge(slot) {
      const b = slot.querySelector('.card-badge--countdown');
      if (b) b.remove();
    }

    function removeEnergyBadge(slot) {
      const b = slot.querySelector('.card-badge--energy');
      if (b) b.remove();
    }

    // ---- 灵咒系统 JS ----
    function getSlotCurses(slot) {
      const container = slot.querySelector('.card-curses');
      if (!container) return [];
      const badges = container.querySelectorAll('.curse-badge');
      return Array.from(badges).map(b => {
        const nameEl = b.querySelector('.curse-badge__name');
        const layersEl = b.querySelector('.curse-badge__layers');
        const name = nameEl ? nameEl.textContent : '';
        const layers = layersEl ? (parseInt(layersEl.textContent.replace('×',''), 10) || 1) : 1;
        return { name, layers };
      });
    }

    function setSlotCurses(slot, curses) {
      const existing = slot.querySelector('.card-curses');
      if (existing) existing.remove();
      if (!curses || !curses.length) return;
      const container = document.createElement('div');
      container.className = 'card-curses';
      curses.forEach(c => {
        const badge = document.createElement('span');
        badge.className = 'curse-badge';
        badge.innerHTML = '<span class="curse-badge__name">' + escapeHTML(c.name) + '</span><span class="curse-badge__layers">×' + c.layers + '</span>';
        badge.addEventListener('click', (e) => { e.stopPropagation(); openCursePanel(_curseTargetForSlot(slot)); });
        container.appendChild(badge);
      });
      slot.appendChild(container);
    }

    // ---- 灵咒管理面板（通用：卡牌槽 / 手牌 / 牌库） ----
    let cursePanelTarget = null;

    /** 为战场卡牌槽创建灵咒操作对象 */
    function _curseTargetForSlot(slot) {
      return {
        _slot: slot,
        getCurses: () => getSlotCurses(slot),
        setCurses: (curses) => { setSlotCurses(slot, curses); syncSlotToPeer(slot); },
        getLabel: () => slot.querySelector('.card-name').value || '未命名',
        getPlayerId: () => slot.dataset.slotPlayer,
        isReadOnly: () => (typeof isSpectator !== 'undefined' && isSpectator),
      };
    }

    /** 为手牌/牌库卡牌创建灵咒操作对象 */
    function _curseTargetForCard(playerId, card, location) {
      return {
        getCurses: () => card.curses || [],
        setCurses: (curses) => {
          card.curses = curses;
          refreshOpenListDialog(playerId);
          syncDeckState(playerId);
        },
        getLabel: () => card.name,
        getLocation: () => location || '',
        getPlayerId: () => playerId,
        isReadOnly: () => !isMyZone(playerId),
      };
    }

    function openCursePanel(target) {
      if (target.isReadOnly()) return;
      cursePanelTarget = target;
      let overlay = document.getElementById('curse-panel-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'curse-panel-overlay';
        overlay.hidden = true;
        overlay.innerHTML = '<div class="curse-panel">'
          + '<h3>⛓️ 灵咒管理</h3>'
          + '<div class="curse-panel__add">'
          + '<input class="inp-name" placeholder="灵咒名称" maxlength="12">'
          + '<input class="inp-layers" type="number" value="1" min="1" max="99">'
          + '<button class="btn-add-curse">添加</button>'
          + '</div>'
          + '<div class="curse-panel__list"></div>'
          + '<button class="curse-panel__close">关闭</button>'
          + '</div>';
        document.body.appendChild(overlay);
        overlay.querySelector('.btn-add-curse').addEventListener('click', () => _cursePanelAdd());
        overlay.querySelector('.inp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') _cursePanelAdd(); });
        overlay.querySelector('.curse-panel__close').addEventListener('click', closeCursePanel);
      }
      overlay.hidden = false;
      _refreshCursePanel();
      overlay.querySelector('.inp-name').focus();
    }

    function _cursePanelAdd() {
      if (!cursePanelTarget) return;
      const overlay = document.getElementById('curse-panel-overlay');
      const name = overlay.querySelector('.inp-name').value.trim();
      if (!name) return;
      const layers = Math.max(1, parseInt(overlay.querySelector('.inp-layers').value, 10) || 1);
      const curses = cursePanelTarget.getCurses();
      const existing = curses.find(c => c.name === name);
      if (existing) { existing.layers += layers; }
      else { curses.push({ name, layers }); }
      cursePanelTarget.setCurses(curses);
      const targetLoc = cursePanelTarget.getLocation ? cursePanelTarget.getLocation() : '';
      const targetPid = cursePanelTarget.getPlayerId();
      const actorName = (typeof localPlayerId !== 'undefined') ? getPlayerName(localPlayerId) : '玩家';
      const targetName = getPlayerName(targetPid);
      // 区分己方/对方：如 "玩家一为玩家二手牌中的一张牌结附了..."
      const locFull = (String(targetPid) === String(localPlayerId))
        ? ('己方' + targetLoc)
        : (targetName + targetLoc);
      broadcastSystemMsg('【系统】' + actorName + '为' + locFull + '一张牌结附了灵咒「' + name + '」×' + layers);
      overlay.querySelector('.inp-name').value = '';
      overlay.querySelector('.inp-layers').value = '1';
      _refreshCursePanel();
      overlay.querySelector('.inp-name').focus();
    }

    function closeCursePanel() {
      const overlay = document.getElementById('curse-panel-overlay');
      if (overlay) overlay.hidden = true;
      cursePanelTarget = null;
    }

    function _refreshCursePanel() {
      const overlay = document.getElementById('curse-panel-overlay');
      if (!overlay || !cursePanelTarget) return;
      overlay.querySelector('.curse-panel h3').textContent = '⛓️ 灵咒管理 — ' + cursePanelTarget.getLabel();
      const list = overlay.querySelector('.curse-panel__list');
      list.innerHTML = '';
      cursePanelTarget.getCurses().forEach((c, i) => {
        const item = document.createElement('div');
        item.className = 'curse-panel__item';
        item.innerHTML = '<span class="curse-panel__item-name">' + escapeHTML(c.name) + '</span>'
          + '<div class="curse-panel__item-actions">'
          + '<button class="btn-layer-minus">−</button>'
          + '<span class="curse-panel__item-layers">' + c.layers + '</span>'
          + '<button class="btn-layer-plus">+</button>'
          + '<button class="btn-curse-remove" style="margin-left:6px;background:#6a2a2a;border-color:#a04040;">✕</button>'
          + '</div>';
        item.querySelector('.btn-layer-minus').addEventListener('click', () => _changeCurseLayers(i, -1));
        item.querySelector('.btn-layer-plus').addEventListener('click', () => _changeCurseLayers(i, 1));
        item.querySelector('.btn-curse-remove').addEventListener('click', () => _removeCurse(i));
        list.appendChild(item);
      });
    }

    function _changeCurseLayers(index, delta) {
      if (!cursePanelTarget) return;
      const curses = cursePanelTarget.getCurses();
      curses[index].layers = Math.max(0, curses[index].layers + delta);
      if (curses[index].layers <= 0) curses.splice(index, 1);
      cursePanelTarget.setCurses(curses);
      _refreshCursePanel();
    }

    function _removeCurse(index) {
      if (!cursePanelTarget) return;
      const curses = cursePanelTarget.getCurses();
      const removed = curses[index];
      curses.splice(index, 1);
      cursePanelTarget.setCurses(curses);
      if (removed) {
        broadcastSystemMsg('【系统】' + getPlayerName(cursePanelTarget.getPlayerId()) + '移除了「' + cursePanelTarget.getLabel() + '」的灵咒「' + removed.name + '」');
      }
      _refreshCursePanel();
    }

    function openImagePicker(slot) {
      activeSlotForImage = slot;
      imageInput.click();
    }

    function isInteractiveTarget(el) {
      return el.closest('.card-badge, input, label, button, .charge-indicator');
    }

    /** 判断点击坐标是否落在卡图区域内（card-art 有 pointer-events:none，不能用 closest 判断） */
    function _pointInCardArt(slot, x, y) {
      const art = slot.querySelector('.card-art');
      if (!art) return false;
      const r = art.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    function getSlotUnderPoint(x, y) {
      const el = document.elementFromPoint(x, y);
      return el ? el.closest('.card-slot') : null;
    }

    function clearDragHighlights() {
      document.querySelectorAll('.card-slot').forEach(s => s.classList.remove('drag-over', 'dragging'));
    }

    // ---- JS-2.1：卡牌拖拽系统 ----
    function initCardSlots() {
      document.querySelectorAll('.card-slot').forEach(slot => {
        slot.addEventListener('pointerdown', (e) => {
          if (typeof isSpectator !== 'undefined' && isSpectator) return;
          if (e.button !== 0 || isInteractiveTarget(e.target) || e.target.closest('.curse-badge')) return;
          pointerOrigin = { x: e.clientX, y: e.clientY, slot };
          slot.setPointerCapture(e.pointerId);
        });

        slot.addEventListener('pointermove', (e) => {
          if (!pointerOrigin || pointerOrigin.slot !== slot) return;

          if (!draggedSlot) {
            const dx = e.clientX - pointerOrigin.x;
            const dy = e.clientY - pointerOrigin.y;
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            draggedSlot = slot;
            slot.classList.add('dragging');
          }

          document.querySelectorAll('.card-slot').forEach(s => s.classList.remove('drag-over'));
          const hover = getSlotUnderPoint(e.clientX, e.clientY);
          if (hover && hover !== draggedSlot) {
            hover.classList.add('drag-over');
          }
        });

        slot.addEventListener('pointerup', (e) => {
          if (!pointerOrigin || pointerOrigin.slot !== slot) return;

          try {
            slot.releasePointerCapture(e.pointerId);
          } catch (_) { /* already released */ }

          if (draggedSlot) {
            const target = getSlotUnderPoint(e.clientX, e.clientY);
            if (target && target !== draggedSlot) {
              swapSlotContents(draggedSlot, target);
            }
            draggedSlot = null;
            clearDragHighlights();
          } else if (e.target.closest('.card-form-badge')) {
            // 点击形态标签 → 打开式神管理
            if (typeof BonusPanel !== 'undefined') BonusPanel.open(slot);
          } else if (!isInteractiveTarget(e.target) && _pointInCardArt(slot, e.clientX, e.clientY) && !isTargeting && !slot.querySelector('.ko-overlay') && !e.target.closest('.curse-badge')) {
            // 只有点击卡图区域才触发上传（信息栏等其他区域不触发）；没有卡图时点击上传，有卡图时不响应
            if ((typeof isSpectator === 'undefined' || !isSpectator) && !slot.classList.contains('has-image')) {
              openImagePicker(slot);
            }
          }

          pointerOrigin = null;
        });

        slot.addEventListener('pointercancel', () => {
          pointerOrigin = null;
          draggedSlot = null;
          clearDragHighlights();
        });
      });
    }

    initCardSlots();

    /* 鬼火加减按钮（0~5个火焰图标） */
    document.querySelectorAll('.player-fire-area').forEach(area => {
      const playerId = area.closest('.player-zone').dataset.player;
      const iconsRow = area.querySelector('.fire-icons-row');
      const minusBtn = area.querySelector('.fire-minus');
      const plusBtn = area.querySelector('.fire-plus');

      function render() {
        const count = playerFire[playerId];
        iconsRow.innerHTML = Array.from({ length: 5 }, (_, i) =>
          `<span class="fire-icon" style="visibility:${i >= count ? 'hidden' : 'visible'}">🔥</span>`
        ).join('');
      }

      minusBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (playerFire[playerId] > 0) { playerFire[playerId]--; render(); syncFireState(playerId); }
      });

      plusBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (playerFire[playerId] < 5) { playerFire[playerId]++; render(); syncFireState(playerId); }
      });

      render();
    });

    /* 卡牌徽章输入框变化 → 同步到对方（change 事件在失焦时触发） */
    document.addEventListener('change', (e) => {
      // 首次修改攻/命（有效非 0 数字）→ 自动记为“基础值”
      if (e.target.classList.contains('card-attack') || e.target.classList.contains('card-hp')) {
        const bSlot = e.target.closest('.card-slot');
        if (bSlot) {
          const bv = parseInt(e.target.value, 10);
          if (!Number.isNaN(bv) && bv !== 0) {
            // 注意：同步后基础值可能是 0，0 也当作“未设定”
            if (e.target.classList.contains('card-attack') && !bSlot._baseAtk) bSlot._baseAtk = bv;
            if (e.target.classList.contains('card-hp') && !bSlot._baseHp) bSlot._baseHp = bv;
          }
        }
      }
      // 护甲/战力徽章：直接改数值（正=护甲/战力，负=破甲/乏力，0=清除）
      if (e.target.classList.contains('card-armor') || e.target.classList.contains('card-power')) {
        const slot = e.target.closest('.card-slot');
        if (slot) {
          const val = parseInt(e.target.value, 10) || 0;
          if (e.target.classList.contains('card-armor')) slot._armor = val;
          else slot._power = val;
          updateStatusBadges(slot);
          syncSlotToPeer(slot);
        }
        return;
      }
      // 卡牌徽章
      if (e.target.closest('.card-badge')) {
        const slot = e.target.closest('.card-slot');
        if (slot) syncSlotToPeer(slot);
        return;
      }
      // 效果面板输入
      if (e.target.closest('.effect-item')) {
        const zone = e.target.closest('.player-zone');
        if (zone) {
          // 填「堆叠上限：卡牌名」且数值为空 → 自动带入数据库默认上限
          if (e.target.classList.contains('effect-name')) {
            const item = e.target.closest('.effect-item');
            const valueInput = item.querySelector('.effect-value');
            const m = (e.target.value || '').trim().match(/^堆叠上限[：:](.+)$/);
            if (m && !(valueInput.value || '').trim()) {
              const db = (typeof CardDB !== 'undefined' && CardDB.lookup) ? CardDB.lookup(m[1].trim()) : null;
              if (db && db.maxStack) valueInput.value = String(db.maxStack);
            }
          }
          syncEffectsState(zone.dataset.player);
          if (typeof applyStackLimitEffects === 'function') applyStackLimitEffects(zone.dataset.player, true);
        }
        return;
      }
      // 玩家名称 / 生命值
      if (e.target.classList.contains('player-name-input') || e.target.classList.contains('player-hp-input')) {
        const zone = e.target.closest('.player-zone');
        if (zone) syncPlayerInfo(zone.dataset.player);
      }
    });

    // ---- JS-2.2：战场动态布局（自适应窗口大小）----
    const BATTLE_WIDTH_RATIO = 158 / 148;
    const BATTLE_HEIGHT_RATIO = 221 / 207;
    const PREP_ASPECT = 207 / 148;
    const MIN_FIELD_GAP = 18;
    const MIN_CARD_W = 84;
    const MAX_CARD_W = 158;
    const layoutRoot = document.documentElement;
    const gameBoard = document.querySelector('.game-board');
    const chatSidebar = document.querySelector('.chat-sidebar');

    function measureZoneCenterWidth() {
      const zoneCenter = document.querySelector('.zone-center');
      if (!zoneCenter) return 0;
      const style = getComputedStyle(zoneCenter);
      return zoneCenter.clientWidth
        - parseFloat(style.paddingLeft)
        - parseFloat(style.paddingRight);
    }

    function updateBattlefieldLayout() {
      const effectsEl = document.querySelector('.zone-effects');
      const available = measureZoneCenterWidth();
      if (!available || !effectsEl || !chatSidebar) return;

      const effectsWidth = effectsEl.getBoundingClientRect().width;
      const chatWidth = chatSidebar.getBoundingClientRect().width;
      const boardWidth = gameBoard.getBoundingClientRect().width;
      const battlefieldWidth = boardWidth - effectsWidth - chatWidth
        - parseFloat(getComputedStyle(gameBoard).gap || '0')
        - parseFloat(getComputedStyle(gameBoard).paddingLeft)
        - parseFloat(getComputedStyle(gameBoard).paddingRight);

      layoutRoot.style.setProperty('--effects-panel-width', `${Math.round(effectsWidth)}px`);
      layoutRoot.style.setProperty('--chat-panel-width', `${Math.round(chatWidth)}px`);
      layoutRoot.style.setProperty('--battlefield-width', `${Math.round(Math.max(available, battlefieldWidth))}px`);

      // 5 张牌 + 6 段等距空白：边距、准备区间隙、战斗区两侧、准备区内部
      const denom = 4 + BATTLE_WIDTH_RATIO;
      let cardW = Math.min(MAX_CARD_W, (available - MIN_FIELD_GAP * 6) / denom);
      cardW = Math.max(MIN_CARD_W, cardW);
      let gap = (available - denom * cardW) / 6;

      if (gap < MIN_FIELD_GAP && cardW > MIN_CARD_W) {
        cardW = Math.max(MIN_CARD_W, (available - MIN_FIELD_GAP * 6) / denom);
        gap = (available - denom * cardW) / 6;
      }

      gap = Math.max(0, gap);

      const battleW = cardW * BATTLE_WIDTH_RATIO;
      const cardH = cardW * PREP_ASPECT;
      const battleH = cardH * BATTLE_HEIGHT_RATIO;

      layoutRoot.style.setProperty('--field-gap', `${gap.toFixed(1)}px`);
      layoutRoot.style.setProperty('--card-w-prep', `${cardW.toFixed(1)}px`);
      layoutRoot.style.setProperty('--card-h-prep', `${cardH.toFixed(1)}px`);
      layoutRoot.style.setProperty('--card-w-battle', `${battleW.toFixed(1)}px`);
      layoutRoot.style.setProperty('--card-h-battle', `${battleH.toFixed(1)}px`);
    }

    let layoutFrame = null;
    function scheduleBattlefieldLayout() {
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = null;
        updateBattlefieldLayout();
      });
    }

    window.addEventListener('resize', scheduleBattlefieldLayout);
    if (typeof ResizeObserver !== 'undefined') {
      const layoutObserver = new ResizeObserver(scheduleBattlefieldLayout);
      layoutObserver.observe(gameBoard);
      layoutObserver.observe(chatSidebar);
      document.querySelectorAll('.zone-effects, .zone-center').forEach(el => layoutObserver.observe(el));
    }
    scheduleBattlefieldLayout();

    // ================================================================
    //  加成弹窗 💠 按钮事件
    // ================================================================
    document.addEventListener('click', (e) => {
      const bonusBtn = e.target.closest('.card-badge--bonus');
      if (!bonusBtn) return;
      e.stopPropagation();
      // 观众禁止打开加成弹窗
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      const slot = bonusBtn.closest('.card-slot');
      if (!slot) return;
      if (typeof BonusPanel !== 'undefined') BonusPanel.open(slot);
    });

    /** 记录永久基础值（取自卡牌数据库，自定义卡用当前值） */
    function recordPermBase(slot) {
      if (slot._permBaseAtk !== undefined) return;
      const cardName = slot.querySelector('.card-name').value.trim();
      const dbCard = cardName ? CardDB.lookup(cardName) : null;
      if (dbCard && dbCard.attack !== undefined) {
        slot._permBaseAtk = dbCard.attack || 0;
        slot._permBaseHp = dbCard.hp || 0;
      } else {
        // 自定义卡牌或无数据，用当前显示值作为基础
        slot._permBaseAtk = parseInt(slot.querySelector('.card-attack').value, 10) || 0;
        slot._permBaseHp = parseInt(slot.querySelector('.card-hp').value, 10) || 0;
      }
    }

    /** 获取有效基础（有形态→形态值，玩家设的基础→基础值，无→CardDB原始值） */
    function effectiveBaseAtk(slot) {
      if (slot._formName) return slot._formAtk || 0;
      if (slot._baseAtk !== undefined && slot._baseAtk !== null) return slot._baseAtk;
      return slot._permBaseAtk !== undefined ? slot._permBaseAtk : 0;
    }
    function effectiveBaseHp(slot) {
      if (slot._formName) return slot._formHp || 0;
      if (slot._baseHp !== undefined && slot._baseHp !== null) return slot._baseHp;
      return slot._permBaseHp !== undefined ? slot._permBaseHp : 0;
    }

    /** 计算永久属性 = 有效基础 + 永久加成×层数 */
    function calcPermAtk(slot) {
      return effectiveBaseAtk(slot) + (slot._permAtkMods || []).reduce((s, m) => s + (m.value || 0) * (m.layers || 1), 0);
    }
    function calcPermHp(slot) {
      return effectiveBaseHp(slot) + (slot._permHpMods || []).reduce((s, m) => s + (m.value || 0) * (m.layers || 1), 0);
    }

    /** 计算临时属性总值 */
    function calcTempAtk(slot) { return (slot._tempAtkMods || []).reduce((s, m) => s + (m.value || 0) * (m.layers || 1), 0); }
    function calcTempHp(slot) { return (slot._tempHpMods || []).reduce((s, m) => s + (m.value || 0) * (m.layers || 1), 0); }

    /** 计算完整属性 = 永久 + 临时 */
    function calcFullAtk(slot) { return calcPermAtk(slot) + calcTempAtk(slot); }
    function calcFullHp(slot) { return calcPermHp(slot) + calcTempHp(slot); }

    /** 结附/替换形态（PRD：攻=形态攻+永久+临时+手动攻差值；命回满=形态命+永久+临时） */
    window.equipFormOnSlot = function(slot, formName, formAtk, formHp, formAbility) {
      if (!slot) return null;
      recordPermBase(slot);                              // 确保基础值已记录（结附前）
      const atkIn = slot.querySelector('.card-attack');
      const hpIn = slot.querySelector('.card-hp');
      const curAtk = atkIn ? (parseInt(atkIn.value, 10) || 0) : 0;
      const manualAtk = curAtk - calcFullAtk(slot);      // 结附前的手动攻差值
      slot._formName = formName || '';
      slot._formAtk = formAtk || 0;
      slot._formHp = formHp || 0;
      slot._formAbility = formAbility || '';
      const newAtk = calcFullAtk(slot) + manualAtk;
      const newHp = calcFullHp(slot);                    // 生命回满
      if (atkIn) atkIn.value = newAtk || '';
      if (hpIn) hpIn.value = newHp || '';
      if (typeof syncSlotToPeer === 'function') syncSlotToPeer(slot);
      if (typeof autoUpdateSlotImage === 'function') autoUpdateSlotImage(slot);
      if (typeof renderFormBadge === 'function') renderFormBadge(slot);
      return { newAtk: newAtk, newHp: newHp, manualAtk: manualAtk };
    };

    /** 失去形态（PRD：攻=基础+永久+临时+手动攻差值；命回满=基础+永久+临时） */
    window.loseFormOnSlot = function(slot) {
      if (!slot) return null;
      recordPermBase(slot);
      const atkIn = slot.querySelector('.card-attack');
      const hpIn = slot.querySelector('.card-hp');
      const curAtk = atkIn ? (parseInt(atkIn.value, 10) || 0) : 0;
      const manualAtk = curAtk - calcFullAtk(slot);      // 失去形态前（含形态）的差值
      slot._formName = ''; slot._formAtk = 0; slot._formHp = 0; slot._formAbility = '';
      const newAtk = calcFullAtk(slot) + manualAtk;
      const newHp = calcFullHp(slot);                    // 生命回满
      if (atkIn) atkIn.value = newAtk || '';
      if (hpIn) hpIn.value = newHp || '';
      if (typeof syncSlotToPeer === 'function') syncSlotToPeer(slot);
      if (typeof autoUpdateSlotImage === 'function') autoUpdateSlotImage(slot);
      if (typeof renderFormBadge === 'function') renderFormBadge(slot);
      return { newAtk: newAtk, newHp: newHp, manualAtk: manualAtk };
    };

    /** 重置：清除临时属性+手动差值，设当前=永久值 */
    function resetToPermStats(slot) {
      recordPermBase(slot);
      slot._tempAtkMods = []; slot._tempHpMods = [];
      slot.querySelector('.card-attack').value = calcPermAtk(slot) || '';
      slot.querySelector('.card-hp').value = calcPermHp(slot) || '';
      syncSlotToPeer(slot);
    }

    /** 应用永久属性变化，保留临时属性和手动差值 */
    function applyPermStats(slot, oldPermAtk, oldPermHp) {
      recordPermBase(slot);
      if (oldPermAtk === undefined) oldPermAtk = calcPermAtk(slot);
      if (oldPermHp === undefined) oldPermHp = calcPermHp(slot);
      const curAtk = parseInt(slot.querySelector('.card-attack').value, 10) || 0;
      const curHp = parseInt(slot.querySelector('.card-hp').value, 10) || 0;
      const oldFullAtk = oldPermAtk + calcTempAtk(slot);
      const oldFullHp = oldPermHp + calcTempHp(slot);
      const manualAtk = curAtk - oldFullAtk;
      const manualHp = curHp - oldFullHp;
      const newFullAtk = calcPermAtk(slot) + calcTempAtk(slot);
      const newFullHp = calcPermHp(slot) + calcTempHp(slot);
      slot.querySelector('.card-attack').value = (newFullAtk + manualAtk) || '';
      slot.querySelector('.card-hp').value = (newFullHp + manualHp) || '';
      updateAwakenedMark(slot);
      syncSlotToPeer(slot);
    }

    /** 应用任意属性变化（保留手动差值），用于临时属性变化 */
    function applyStatsChange(slot, oldFullAtk, oldFullHp) {
      const curAtk = parseInt(slot.querySelector('.card-attack').value, 10) || 0;
      const curHp = parseInt(slot.querySelector('.card-hp').value, 10) || 0;
      const manualAtk = curAtk - oldFullAtk;
      const manualHp = curHp - oldFullHp;
      const newFullAtk = calcFullAtk(slot);
      const newFullHp = calcFullHp(slot);
      slot.querySelector('.card-attack').value = (newFullAtk + manualAtk) || '';
      slot.querySelector('.card-hp').value = (newFullHp + manualHp) || '';
      syncSlotToPeer(slot);
    }
    function updateAwakenedMark(slot) {
      // 觉醒状态由“式神管理勾选框 / 使用觉醒牌”直接控制（slot.awakened class），不再根据属性来源自动切换
    }

    /* ================================================================
       重置游戏状态：退出房间回大厅时调用，清空全部对局数据
       （式神/手牌/商店/赏金/灵咒等），防止上一局残留到新房间
       ================================================================ */
    function resetGameState() {
      // 1) 卡槽：重建初始结构，清掉形态/灵咒/蓄力/气绝等动态内容
      document.querySelectorAll('.card-slot').forEach(slot => {
        slot.innerHTML = CARD_INNER_HTML;
        ['_formName', '_formAtk', '_formHp', '_formAbility', '_permAbility', '_baseAbility',
         '_permAtkMods', '_permHpMods', '_permEffects', '_awakenCardName',
         '_tempAtkMods', '_tempHpMods', '_chargedCards'].forEach(function(k) { delete slot[k]; });
        slot.classList.remove('has-image', 'charging', 'awakened');
        delete slot.dataset.slotFaction;
        delete slot.dataset.slotType;
      });

      // 2) 牌库/手牌/坟场
      if (typeof playerCards !== 'undefined') {
        ['1', '2'].forEach(function(pid) { playerCards[pid] = { deck: [], hand: [], grave: [] }; });
      }
      // 2.1) 坟场入口按钮与开关
      document.querySelectorAll('.btn-deck--grave').forEach(function(b) { b.remove(); });
      if (typeof window.applyGraveTargets === 'function') window.applyGraveTargets({});
      // 3) 赏金 / 商店 / 库存
      if (typeof playerBounty !== 'undefined') { playerBounty['1'] = 0; playerBounty['2'] = 0; }
      if (typeof playerShops !== 'undefined') { delete playerShops['1']; delete playerShops['2']; }
      if (typeof playerCardStocks !== 'undefined') { playerCardStocks['1'] = {}; playerCardStocks['2'] = {}; }
      if (typeof stockInitialized !== 'undefined') { stockInitialized['1'] = false; stockInitialized['2'] = false; }
      if (typeof customShopDefs !== 'undefined') { customShopDefs['1'] = {}; customShopDefs['2'] = {}; }
      // 4) 鬼火
      if (typeof playerFire !== 'undefined') { playerFire['1'] = 0; playerFire['2'] = 0; }

      // 4.1) 赏金 / 入夜开关状态（防止新房间第一次按变"关闭"）
      if (typeof bountyActive !== 'undefined') { bountyActive['1'] = false; bountyActive['2'] = false; }
      if (typeof nightfallActive !== 'undefined') { nightfallActive['1'] = false; nightfallActive['2'] = false; }

      // 5) 玩家区：生命/名字/效果面板/赏金入夜图标/连接状态条
      document.querySelectorAll('.player-zone').forEach(function(zone) {
        const hp = zone.querySelector('.player-hp-input'); if (hp) hp.value = '';
        const ni = zone.querySelector('.player-name-input'); if (ni) ni.value = '';
        const panel = zone.querySelector('.effects-panel'); if (panel) panel.innerHTML = '';
        zone.querySelectorAll('.bounty-indicator, .nightfall-indicator').forEach(function(el) { el.remove(); });
        zone.classList.remove('realm-open');
        // 幻境面板的添加按钮如果被移进面板，放回原位
        const addBtn = zone.querySelector('.btn-add-effect');
        if (addBtn && panel && addBtn.parentElement === panel && panel.parentElement) {
          panel.parentElement.insertBefore(addBtn, panel.nextSibling);
        }
        const conn = zone.querySelector('.player-conn-status'); if (conn) conn.remove();
        zone.querySelectorAll('.card-curses').forEach(function(el) { el.remove(); });
      });

      // 6) 头像
      document.querySelectorAll('.player-avatar').forEach(function(av) {
        av.innerHTML = '';
        av.classList.remove('has-avatar');
      });

      // 7) 启悟按钮/状态
      if (typeof oracleActive !== 'undefined') { oracleActive['1'] = false; oracleActive['2'] = false; }
      document.querySelectorAll('.btn-deck--oracle').forEach(function(b) { b.hidden = true; });

      // 8) 聊天清空
      ['chat-system-log', 'chat-player-log'].forEach(function(id) {
        const el = document.getElementById(id); if (el) el.innerHTML = '';
      });

      // 9) 退出瞄准/目标选择模式
      if (typeof exitTargetingMode === 'function') { try { exitTargetingMode(); } catch(_) {} }

      // 10) 关闭还开着的弹窗
      ['shop-dialog-overlay', 'card-text-dialog-overlay'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      });
      const bonusOv = document.querySelector('.bonus-overlay');
      if (bonusOv) { bonusOv.hidden = true; }
      // 聊天放大弹窗：把消息区放回原位再关闭
      const chatExpand = document.getElementById('chat-expand-overlay');
      if (chatExpand && !chatExpand.hidden) {
        const moved = chatExpand.querySelector('.chat-expand-body .chat-section-body');
        if (moved) {
          const home = moved.id === 'chat-system-log'
            ? document.querySelector('.chat-section--system')
            : document.querySelector('.chat-section--player');
          if (home) home.appendChild(moved);
        }
        chatExpand.hidden = true;
      }

      // 11) 牌库按钮计数刷新
      if (typeof updateAllDeckButtons === 'function') updateAllDeckButtons();
    }
