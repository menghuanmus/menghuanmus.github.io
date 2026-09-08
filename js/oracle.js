// ================================================================
//  js/oracle.js — 启悟系统
//  启悟机制切换、启悟手牌区管理、启悟弹窗
//  依赖: network.js, game-core.js, card-deck.js
// ================================================================

    //  启悟系统
    // ================================================================
    /** 每个玩家的启悟激活状态 */
    const oracleActive = { '1': false, '2': false };

    /** 每个玩家的启悟手牌区 */
    const oracleHands = { '1': [], '2': [] };

    // DOM引用
    const oracleOverlay = document.getElementById('oracle-dialog-overlay');
    const oracleDialog = document.getElementById('oracle-dialog');
    const oracleDialogHeader = document.getElementById('oracle-dialog-header');
    const oracleCloseBtn = document.getElementById('oracle-dialog-close');
    const oracleCardInput = document.getElementById('oracle-card-input');
    const oracleBtnAdd = document.getElementById('oracle-btn-add');
    const oracleBtnDraw = document.getElementById('oracle-btn-draw');
    const oracleCardsList = document.getElementById('oracle-cards-list');

    let _activeOraclePlayer = null;
    let _oracleActionMode = '';   // 启悟手牌操作互斥模式：'' / discard / tohand / todeck

    // 拖拽状态
    let _draggingOracle = false;
    let _dragOX = 0, _dragOY = 0, _dialogOX = 0, _dialogOY = 0;

    /** 获取启悟区按钮元素 */
    function getOracleZoneBtn(playerId) {
      return document.getElementById('btn-oracle-zone-' + playerId);
    }

    /** 切换启悟机制 */
    function toggleOracle(playerId, operatorId) {
      oracleActive[playerId] = !oracleActive[playerId];
      const active = oracleActive[playerId];
      const btn = getOracleZoneBtn(playerId);
      if (btn) {
        if (active) {
          btn.hidden = false;
          btn.classList.add('oracle-appear');
          setTimeout(() => btn.classList.remove('oracle-appear'), 600);
        } else {
          btn.hidden = true;
        }
      }
      refreshOpenListDialog(playerId);
      if (!active && !oracleOverlay.hidden && _activeOraclePlayer === playerId) {
        closeOracleDialog();
      }
      const tgtName = (typeof getPlayerName === 'function') ? getPlayerName(playerId) : ('玩家' + playerId);
      const verb = active ? '开启了' : '关闭了';
      let msg;
      if (operatorId && operatorId !== playerId) {
        const opName = (typeof getPlayerName === 'function') ? getPlayerName(operatorId) : ('玩家' + operatorId);
        msg = '【系统】' + opName + '为' + tgtName + verb + '启悟机制';
      } else {
        msg = '【系统】' + tgtName + verb + '启悟机制';
      }
      broadcastSystemMsg(msg);
      syncOracleToPeer(playerId);
    }

    /** 观众只读：隐藏启悟弹窗内全部操作区（保留列表查看 + 关闭按钮） */
    function _applyOracleSpecLock() {
      const spec = (typeof isSpectator !== 'undefined') ? isSpectator : false;
      ['#oracle-action-toggles', '.oracle-quick-row', '.oracle-input-row'].forEach(function(sel) {
        const el = document.querySelector(sel);
        if (el) el.style.display = spec ? 'none' : '';
      });
    }

    /** 打开启悟弹窗（本人可查看/操作；观众可查看双方启悟区，只读） */
    function openOracleDialog(playerId) {
      // 检查是否有权查看
      const own = (typeof isViewingOwnCards === 'function') ? isViewingOwnCards(playerId) : true;
      const solo = (typeof isSoloMode !== 'undefined') ? isSoloMode : false;
      const spec = (typeof isSpectator !== 'undefined') ? isSpectator : false;
      if (!own && !solo && !spec) return;
      _activeOraclePlayer = playerId;
      _applyOracleSpecLock();
      renderOracleCards(playerId);
      oracleOverlay.hidden = false;
    }

    /** 关闭启悟弹窗 */
    function closeOracleDialog() {
      oracleOverlay.hidden = true;
      _activeOraclePlayer = null;
    }

    /** 渲染启悟手牌列表 */
    function renderOracleCards(playerId) {
      const cards = oracleHands[playerId] || [];
      const own = (typeof isViewingOwnCards === 'function') ? isViewingOwnCards(playerId) : true;
      const solo = (typeof isSoloMode !== 'undefined') ? isSoloMode : false;
      const spec = (typeof isSpectator !== 'undefined') ? isSpectator : false;
      // 可查看详情：本人 / 单人 / 观众（观众只看，不做任何操作）
      const canView = own || solo || spec;
      oracleCardsList.innerHTML = '';
      if (!cards.length) return;

      cards.forEach((card, idx) => {
        if (!card || typeof card !== 'object') return;
        const item = document.createElement('div');
        item.className = 'oracle-card-item';

        // 信息区（含卡牌名、灵咒标签）
        const info = document.createElement('div');
        info.className = 'oracle-card-item__info';
        // 存储灵咒数据供浮窗显示
        if (canView && card.curses && card.curses.length) {
          info.dataset.cardCurses = JSON.stringify(card.curses);
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'oracle-card-item__name card-name';
        if (canView) {
          nameEl.textContent = card.name || '(未命名)';
          nameEl.value = card.name || '';
        } else {
          nameEl.textContent = '未知';
          nameEl.style.color = 'var(--text-muted, #888)';
        }
        info.appendChild(nameEl);

        // 堆叠层数显示
        if (canView && card._maxStack > 0) {
          const stackSpan = document.createElement('span');
          stackSpan.style.cssText = 'font-size:11px;color:#c0a860;margin-left:4px;white-space:nowrap;';
          stackSpan.textContent = (card._stack || 1) + '/' + card._maxStack;
          info.appendChild(stackSpan);
        }

        // 灵咒标签（本人可点开管理；观众只读查看）
        if (canView && card.curses && card.curses.length) {
          const curseTags = document.createElement('div');
          curseTags.className = 'card-list-item__curses';
          card.curses.forEach(c => {
            const tag = document.createElement('span');
            tag.className = 'card-list-curse-tag';
            tag.dataset.curseName = c.name;
            tag.textContent = '⛓️' + c.name + '×' + c.layers;
            if (own || solo) {
              tag.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof openCursePanel === 'function' && typeof _curseTargetForCard === 'function') {
                  openCursePanel(_curseTargetForCard(playerId, card, '启悟区中的'));
                }
              });
            }
            curseTags.appendChild(tag);
          });
          info.appendChild(curseTags);
        }
        item.appendChild(info);

        // 操作按钮仅自己可见
        if (own || solo) {
        const actions = document.createElement('div');
        actions.className = 'oracle-card-item__actions';

        // 添加灵咒按钮
        const addCurseBtn = document.createElement('button');
        addCurseBtn.type = 'button';
        addCurseBtn.className = 'btn-card-curse-add';
        addCurseBtn.textContent = '➕';
        addCurseBtn.title = '添加灵咒';
        addCurseBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof openCursePanel === 'function' && typeof _curseTargetForCard === 'function') {
            openCursePanel(_curseTargetForCard(playerId, card, '启悟区中的'));
          }
        });
        actions.appendChild(addCurseBtn);

        // 使用按钮
        const useBtn = document.createElement('button');
        useBtn.className = 'oracle-act--use';
        useBtn.textContent = '使用';
        useBtn.addEventListener('click', () => removeFromOracle(playerId, idx, 'use'));
        actions.appendChild(useBtn);

        // 弃置按钮
        const discardBtn = document.createElement('button');
        discardBtn.className = 'oracle-act--discard';
        discardBtn.textContent = '弃置';
        discardBtn.addEventListener('click', () => removeFromOracle(playerId, idx, 'discard'));
        actions.appendChild(discardBtn);

        // 置入手牌区按钮
        const moveBtn = document.createElement('button');
        moveBtn.className = 'oracle-act--move';
        moveBtn.textContent = '置入手牌';
        moveBtn.addEventListener('click', () => moveToHand(playerId, idx));
        actions.appendChild(moveBtn);

        // 置入牌库按钮
        const deckBtn = document.createElement('button');
        deckBtn.className = 'oracle-act--deck';
        deckBtn.textContent = '置入牌库';
        deckBtn.addEventListener('click', () => moveToDeck(playerId, idx));
        actions.appendChild(deckBtn);

        item.appendChild(actions);
        } // end if own
        oracleCardsList.appendChild(item);
      });
      _applyOracleActionMode();
    }

    /** 启悟手牌按钮互斥显隐：默认仅使用/➕，开关激活后仅显示对应按钮 */
    function _applyOracleActionMode() {
      document.querySelectorAll('.oracle-card-item__actions button').forEach(b => {
        if (b.classList.contains('oracle-act--use') || b.classList.contains('btn-card-curse-add')) {
          b.hidden = false;
          return;
        }
        if (_oracleActionMode === 'discard') b.hidden = !b.classList.contains('oracle-act--discard');
        else if (_oracleActionMode === 'tohand') b.hidden = !b.classList.contains('oracle-act--move');
        else if (_oracleActionMode === 'todeck') b.hidden = !b.classList.contains('oracle-act--deck');
        else b.hidden = true;
      });
      document.querySelectorAll('.oracle-toggle-btn').forEach(t => {
        t.classList.toggle('active', _oracleActionMode === t.dataset.oracleMode);
      });
    }

    /** 互斥切换（再点一次取消） */
    function _setOracleActionMode(mode) {
      _oracleActionMode = (_oracleActionMode === mode) ? '' : mode;
      _applyOracleActionMode();
    }

    /** 启悟相关系统消息：仅日月星诫暴露牌名，其余显示"一张牌" */
    function _oracleCardLabel(cardName) {
      const revealed = ['日诫', '月诫', '星诫'];
      const name = cardName || '未知牌';
      return revealed.includes(name) ? ('「' + name + '」') : '一张牌';
    }

    /** 从启悟区移除卡牌（使用/弃置）：除三诫外进入坟场 */
    function removeFromOracle(playerId, idx, reason) {
      const cards = oracleHands[playerId] || [];
      if (idx < 0 || idx >= cards.length) return;
      const card = cards[idx];
      cards.splice(idx, 1);
      const name = (typeof getPlayerName === 'function') ? getPlayerName(playerId) : ('玩家' + playerId);
      const verb = reason === 'use' ? '使用' : '弃置';
      const msg = '【系统】' + name + '从启悟区' + verb + '了「' + (card.name || '未知牌') + '」';
      broadcastSystemMsg(msg, typeof window.getFoodNote === 'function' ? window.getFoodNote(card) : null);
      // 使用/弃置后进入坟场（星诫/月诫/日诫除外）
      const TRIPLE = ['星诫', '月诫', '日诫'];
      if (TRIPLE.indexOf(card.name) === -1 && typeof getPlayerCardState === 'function') {
        const state = getPlayerCardState(playerId);
        if (!state.grave) state.grave = [];
        card.used = (reason === 'use');
        card._graveAdded = false;
        state.grave.push(card);
        if (typeof window.refreshGraveButtons === 'function') window.refreshGraveButtons();
        if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId);
        else if (typeof syncDeckState === 'function') syncDeckState(playerId);
      }
      // 使用动画
      if (reason === 'use' && typeof CardFlight !== 'undefined') {
        CardFlight.playUseCardAnim(playerId, card);
      }
      renderOracleCards(playerId);
      if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
      syncOracleToPeer(playerId);
    }

    /** 从启悟区移动到普通手牌区 */
    function moveToHand(playerId, idx) {
      const cards = oracleHands[playerId] || [];
      if (idx < 0 || idx >= cards.length) return;
      const card = cards.splice(idx, 1)[0];
      const name = (typeof getPlayerName === 'function') ? getPlayerName(playerId) : ('玩家' + playerId);
      const msg = '【系统】' + name + '将' + _oracleCardLabel(card.name) + '从启悟区移入手牌区';
      broadcastSystemMsg(msg);
      // 推入手牌
      if (typeof pushCardToHand === 'function') {
        pushCardToHand(playerId, card);
      } else {
        const state = (typeof getPlayerCardState === 'function') ? getPlayerCardState(playerId) : null;
        if (state) state.hand.push(card);
      }
      renderOracleCards(playerId);
      if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
      if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId);
      syncOracleToPeer(playerId);
      // 飞行动画：启悟 → 手牌
      if (typeof CardFlight !== 'undefined') {
        const oracleBtn = document.getElementById('btn-oracle-zone-' + playerId);
        const handBtn = CardFlight.getPlayerBtn(playerId, 'hand');
        CardFlight.flyAndBroadcast(playerId, 'oracle', 'hand');
      }
    }
    /** 从启悟区移动到牌库（随机位置） */
    function moveToDeck(playerId, idx) {
      const cards = oracleHands[playerId] || [];
      if (idx < 0 || idx >= cards.length) return;
      const card = cards.splice(idx, 1)[0];
      const state = (typeof getPlayerCardState === 'function') ? getPlayerCardState(playerId) : null;
      const name = (typeof getPlayerName === 'function') ? getPlayerName(playerId) : ('玩家' + playerId);
      const msg = '【系统】' + name + '将' + _oracleCardLabel(card.name) + '从启悟区置入了牌库';
      broadcastSystemMsg(msg);
      if (state) {
        const pos = Math.floor(Math.random() * (state.deck.length + 1));
        state.deck.splice(pos, 0, card);
      }
      renderOracleCards(playerId);
      if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId);
      syncOracleToPeer(playerId);
      // 飞行动画：启悟 → 牌库
      if (typeof CardFlight !== 'undefined') {
        const oracleBtn = document.getElementById('btn-oracle-zone-' + playerId);
        const deckBtn = CardFlight.getPlayerBtn(playerId, 'deck');
        CardFlight.flyAndBroadcast(playerId, 'oracle', 'deck');
      }
    }

    /** 从普通手牌区移动到启悟区 */
    function moveToOracle(playerId, cardId) {
      const state = (typeof getPlayerCardState === 'function') ? getPlayerCardState(playerId) : null;
      if (!state) return;
      const hand = state.hand;
      const idx = hand.findIndex(c => c && c.id === cardId);
      if (idx === -1) return;
      const card = hand.splice(idx, 1)[0];
      if (!oracleHands[playerId]) oracleHands[playerId] = [];
      pushCardToOracle(playerId, card);
      const name = (typeof getPlayerName === 'function') ? getPlayerName(playerId) : ('玩家' + playerId);
      const msg = '【系统】' + name + '将' + _oracleCardLabel(card.name) + '从手牌区移入启悟区';
      broadcastSystemMsg(msg);
      if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
      if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId);
      if (!oracleOverlay.hidden && _activeOraclePlayer === playerId) {
        renderOracleCards(playerId);
      }
      syncOracleToPeer(playerId);
      // 飞行动画：手牌 → 启悟
      if (typeof CardFlight !== 'undefined') {
        const handBtn = CardFlight.getPlayerBtn(playerId, 'hand');
        const oracleBtn = document.getElementById('btn-oracle-zone-' + playerId);
        CardFlight.flyAndBroadcast(playerId, 'hand', 'oracle');
      }
    }

    /** 将卡牌置入启悟区，自动处理最大堆叠 */
    function pushCardToOracle(playerId, card) {
      if (!card || !card.name) return;
      if (!oracleHands[playerId]) oracleHands[playerId] = [];
      const db = (typeof CardDB !== 'undefined') ? CardDB.lookup(card.name) : null;
      const maxStack = (db && db.maxStack) ? db.maxStack : 0;

      if (maxStack > 0) {
        const incomingStack = card._stack || 1;
        let remaining = incomingStack;
        const existing = oracleHands[playerId].filter(hc => hc.name === card.name && (hc._stack || 0) < maxStack);
        for (const hc of existing) {
          if (remaining <= 0) break;
          const space = maxStack - (hc._stack || 1);
          const add = Math.min(remaining, space);
          hc._stack = (hc._stack || 1) + add;
          hc._maxStack = maxStack;
          remaining -= add;
        }
        while (remaining > 0) {
          const stack = Math.min(remaining, maxStack);
          const newCard = (typeof createCard === 'function') ? createCard(card.name) : { id: Date.now(), name: card.name, curses: [] };
          newCard._stack = stack;
          newCard._maxStack = maxStack;
          oracleHands[playerId].push(newCard);
          remaining -= stack;
        }
      } else {
        oracleHands[playerId].push(card);
      }
    }

    /** 添加卡牌到启悟区（通过牌名），支持数量 */
    function addCardToOracle(playerId, cardName, qty) {
      const name = cardName.trim();
      if (!name) return;
      const count = Math.max(1, qty || 1);
      if (!oracleHands[playerId]) oracleHands[playerId] = [];
      for (let i = 0; i < count; i++) {
        const card = (typeof createCard === 'function') ? createCard(name) : { id: Date.now() + i, name: name, curses: [] };
        pushCardToOracle(playerId, card);
      }
      const pname = (typeof getPlayerName === 'function') ? getPlayerName(playerId) : ('玩家' + playerId);
      const msg = count > 1 ? ('【系统】' + pname + '将' + count + '张' + _oracleCardLabel(name) + '置入了启悟区')
                            : ('【系统】' + pname + '将' + _oracleCardLabel(name) + '置入了启悟区');
      broadcastSystemMsg(msg);
      renderOracleCards(playerId);
      if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
      syncOracleToPeer(playerId);
      if (typeof CardFlight !== 'undefined') {
        const oracleBtn = document.getElementById('btn-oracle-zone-' + playerId);
        if (oracleBtn) {
          const r = oracleBtn.getBoundingClientRect();
          const srcY = playerId === '2' ? r.top - 150 : r.bottom + 150;
          CardFlight.flySeqAndBroadcast(playerId, count, 'oracle', { x: r.left + r.width / 2, y: srcY }, 'oracle', { interval: 0.18, arcHeight: 60 });
        }
      }
    }

    /** 从牌库抽牌到启悟区 */
    function drawToOracle(playerId) {
      const state = (typeof getPlayerCardState === 'function') ? getPlayerCardState(playerId) : null;
      if (!state || !state.deck.length) {
        const pname = (typeof getPlayerName === 'function') ? getPlayerName(playerId) : ('玩家' + playerId);
        broadcastSystemMsg('【系统】' + pname + '的牌库已空，无法抽牌到启悟区');
        return;
      }
      const card = state.deck.shift();
      if (!oracleHands[playerId]) oracleHands[playerId] = [];
      pushCardToOracle(playerId, card);
      const pname = (typeof getPlayerName === 'function') ? getPlayerName(playerId) : ('玩家' + playerId);
      const msg = '【系统】' + pname + '从牌库抽' + _oracleCardLabel(card.name) + '到了启悟区';
      broadcastSystemMsg(msg);
      if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
      renderOracleCards(playerId);
      syncOracleToPeer(playerId);
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId);
      // 飞行动画：牌库 → 启悟
      if (typeof CardFlight !== 'undefined') {
        const deckBtn = CardFlight.getPlayerBtn(playerId, 'deck');
        const oracleBtn = document.getElementById('btn-oracle-zone-' + playerId);
        CardFlight.flyAndBroadcast(playerId, 'deck', 'oracle');
      }
    }

    /** 同步启悟状态到对手 */
    function syncOracleToPeer(playerId) {
      if (!window._gameSocket || !window._gameSocket.connected || typeof sendToPeer !== 'function') return;
      sendToPeer({
        type: 'oracle-update',
        playerId: playerId,
        active: oracleActive[playerId] || false,
        cards: (oracleHands[playerId] || []).map(c => ({
          id: c.id, name: c.name, curses: c.curses || [],
        })),
      });
    }

    /** 应用远程启悟状态 */
    function applyRemoteOracle(data) {
      if (!data.playerId) return;
      oracleActive[data.playerId] = data.active || false;
      const btn = getOracleZoneBtn(data.playerId);
      if (btn) {
        if (data.active) {
          btn.hidden = false;
          btn.classList.add('oracle-appear');
          setTimeout(() => btn.classList.remove('oracle-appear'), 600);
        } else {
          btn.hidden = true;
          // 远程关闭启悟时，若弹窗开着则一并关闭
          if (!oracleOverlay.hidden && _activeOraclePlayer === data.playerId) {
            closeOracleDialog();
          }
        }
      }
      if (Array.isArray(data.cards)) {
        oracleHands[data.playerId] = data.cards.map(c => ({
          id: c.id, name: c.name, curses: c.curses || [],
        }));
      }
      // 如果是当前打开的弹窗，刷新显示
      if (!oracleOverlay.hidden && _activeOraclePlayer === data.playerId) {
        renderOracleCards(data.playerId);
      }
      // 刷新启悟区按钮牌数（双方/观众同步）
      if (typeof updateDeckButtons === 'function') updateDeckButtons(data.playerId);
    }

    // ---- 拖拽支持 ----
    oracleDialogHeader.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return; // 不拦截关闭按钮
      _draggingOracle = true;
      _dragOX = e.clientX;
      _dragOY = e.clientY;
      _dialogOX = oracleDialog.offsetLeft;
      _dialogOY = oracleDialog.offsetTop;
      oracleDialog.style.transition = 'none';
      oracleDialogHeader.style.cursor = 'grabbing';
    });
    window.addEventListener('pointermove', (e) => {
      if (!_draggingOracle) return;
      const dx = e.clientX - _dragOX;
      const dy = e.clientY - _dragOY;
      let nx = _dialogOX + dx;
      let ny = _dialogOY + dy;
      const maxX = window.innerWidth - oracleDialog.offsetWidth - 10;
      const maxY = window.innerHeight - oracleDialog.offsetHeight - 10;
      nx = Math.max(10, Math.min(nx, maxX));
      ny = Math.max(10, Math.min(ny, maxY));
      oracleDialog.style.left = nx + 'px';
      oracleDialog.style.top = ny + 'px';
    });
    window.addEventListener('pointerup', () => {
      if (!_draggingOracle) return;
      _draggingOracle = false;
      oracleDialog.style.transition = '';
      oracleDialogHeader.style.cursor = '';
    });
    oracleDialogHeader.addEventListener('selectstart', (e) => e.preventDefault());

    // ---- 事件绑定 ----
    oracleCloseBtn.addEventListener('click', closeOracleDialog);

    // 操作互斥开关：弃置 / 置入手牌 / 置入牌库
    document.querySelectorAll('.oracle-toggle-btn').forEach(t => {
      t.addEventListener('click', () => {
        _setOracleActionMode(t.dataset.oracleMode);
      });
    });

    oracleBtnAdd.addEventListener('click', () => {
      if (_activeOraclePlayer && oracleCardInput.value.trim()) {
        const qtyEl = document.getElementById('oracle-card-qty');
        let qty = parseInt(qtyEl ? qtyEl.value : '1', 10);
        if (isNaN(qty) || qty < 1) qty = 1;
        addCardToOracle(_activeOraclePlayer, oracleCardInput.value.trim(), qty);
        oracleCardInput.value = '';
      }
    });

    oracleCardInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && _activeOraclePlayer && oracleCardInput.value.trim()) {
        const qtyEl = document.getElementById('oracle-card-qty');
        let qty = parseInt(qtyEl ? qtyEl.value : '1', 10);
        if (isNaN(qty) || qty < 1) qty = 1;
        addCardToOracle(_activeOraclePlayer, oracleCardInput.value.trim(), qty);
        oracleCardInput.value = '';
      }
    });

    oracleBtnDraw.addEventListener('click', () => {
      if (_activeOraclePlayer) drawToOracle(_activeOraclePlayer);
    });

    // 快速置入三诫按钮
    document.querySelectorAll('.oracle-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cardName = btn.dataset.oracleCard;
        if (_activeOraclePlayer && cardName) {
          addCardToOracle(_activeOraclePlayer, cardName);
        }
      });
    });

    // 两个启悟区按钮（玩家1和玩家2）
    document.querySelectorAll('.btn-deck--oracle[data-action="oracle-zone"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const playerId = btn.id.replace('btn-oracle-zone-', '');
        openOracleDialog(playerId);
      });
    });
