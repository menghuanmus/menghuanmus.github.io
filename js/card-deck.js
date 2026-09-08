// ================================================================
//  js/card-deck.js — 牌库与手牌系统 (JS-5)
//  牌库管理、手牌操作、抽牌/弃置/使用、牌库分组视图、占卜系统、随机灵咒
//  依赖: CardDB, network.js, game-core.js (createEffectItem等)
// ================================================================

    //  JS-5：牌库/手牌系统
    // ================================================================
    let cardIdCounter = 0;

    /** 根据当前所有卡牌更新 cardIdCounter，避免导入后ID冲突 */
    function updateCardIdCounter() {
      let maxId = 0;
      ['1', '2'].forEach(pid => {
        const st = getPlayerCardState(pid);
        [st.deck, st.hand, st.grave || []].forEach(arr => {
          (arr || []).forEach(c => { if (c && typeof c.id === 'number' && c.id > maxId) maxId = c.id; });
        });
      });
      cardIdCounter = Math.max(cardIdCounter, maxId);
    }

    const playerCards = {
      '1': { deck: [], hand: [], grave: [] },
      '2': { deck: [], hand: [], grave: [] },
    };

    // 玩家通过占卜揭示的对方卡牌ID（仅本地追踪，不同步）
    // { viewerPlayerId: Set of card ids }
    const playerRevealedCards = {
      '1': new Set(),
      '2': new Set(),
    };

    // 玩家通过命运抉择揭示的对方卡牌ID
    const playerFateRevealedCards = {
      '1': new Set(),
      '2': new Set(),
    };

    // 手牌展示状态（展示机制）：{ playerId: Set<cardId> }
    const playerHandShows = {
      '1': new Set(),
      '2': new Set(),
    };

    /** 获取当前查看者ID */
    function getViewerPlayerId() {
      if (typeof isSpectator !== 'undefined' && isSpectator) return '0';
      if (typeof localPlayerId !== 'undefined' && localPlayerId && localPlayerId !== '0') {
        return localPlayerId;
      }
      return '1';
    }

    /** 当前查看的牌库/手牌是否属于自己 */
    function isViewingOwnCards(playerId) {
      if (typeof isSoloMode !== 'undefined' && isSoloMode) return true;
      return String(playerId) === String(getViewerPlayerId());
    }

    const cardTextOverlay = document.getElementById('card-text-dialog-overlay');
    const cardTextTitle = document.getElementById('card-text-dialog-title');
    const cardTextInput = document.getElementById('card-text-dialog-input');
    const cardListOverlay = document.getElementById('card-list-dialog-overlay');
    const cardListTitle = document.getElementById('card-list-dialog-title');
    const cardListBody = document.getElementById('card-list-dialog-body');
    const cardListBreakdownBtn = document.getElementById('card-list-breakdown-btn');
    const deckBreakdownPanel = document.getElementById('deck-breakdown-panel');
    const deckBreakdownTitle = document.getElementById('deck-breakdown-title');
    const deckBreakdownBody = document.getElementById('deck-breakdown-body');
    const deckBreakdownClose = document.getElementById('deck-breakdown-close');

    let cardTextContext = null;
    let cardListContext = null;

    function getPlayerZone(playerId) {
      return document.querySelector(`.player-zone[data-player="${playerId}"]`);
    }

    function getPlayerCardState(playerId) {
      return playerCards[playerId];
    }

    function createCard(name) {
      return { id: ++cardIdCounter, name: name.trim(), curses: [] };
    }

    function shuffleCards(cards) {
      for (let i = cards.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      return cards;
    }

    function parseCardLines(text) {
      const out = [];
      String(text || '').split(/\r?\n/).forEach(line => {
        const s = line.trim();
        if (!s) return;
        // 整行就是【式神名】区段标记（标记之后各行/牌归它）
        const sec = s.match(/^【(.+)】$/);
        if (sec) { out.push(s); return; }
        // 行首带【式神名】且同行也要导牌，例如：【式神A】11 2  33
        const head = s.match(/^【(.+)】\s*(.*)$/);
        if (head) {
          out.push('【' + head[1] + '】');
          if (head[2].trim()) out.push(...head[2].trim().split(/\s+/));
          return;
        }
        // 普通行：空格分隔多张牌（无论多少空格都算一个分隔），换行即下一行
        out.push(...s.split(/\s+/));
      });
      return out;
    }

    /** 手牌/牌库计数按钮文案：手机端有牌时两行（括号+数字在下排） */
    function _setCountBtnText(btn, label, count) {
      if (!btn) return;
      const isMobile = window.matchMedia('(max-width: 768px)').matches;
      if (isMobile && count > 0) {
        btn.innerHTML = label + '<br>（' + count + '）';
      } else {
        btn.textContent = count > 0 ? label + '（' + count + '）' : label;
      }
    }

    function updateDeckButtons(playerId) {
      const zone = getPlayerZone(playerId);
      if (!zone) return;
      const spec = (typeof isSpectator !== 'undefined' && isSpectator);
      const own = (typeof isMyZone === 'function') ? isMyZone(playerId) : true;
      const { deck, hand } = getPlayerCardState(playerId);
      const drawBtn = zone.querySelector('.btn-deck[data-action="draw"]');
      const handBtn = zone.querySelector('.btn-deck[data-action="hand"]');
      const deckBtn = zone.querySelector('.btn-deck[data-action="deck"]');
      const shuffleBtn = zone.querySelector('.btn-deck[data-action="shuffle-deck"]');
      const addHandBtn = zone.querySelector('.btn-deck[data-action="add-hand"]');
      const addDeckBtn = zone.querySelector('.btn-deck[data-action="add-deck"]');
      const importBtn = zone.querySelector('.btn-deck[data-action="import-deck"]');
      // 非己方区域：禁用所有操作按钮，仅保留查看
      const lockActions = spec || !own;
      if (drawBtn)     drawBtn.disabled     = lockActions || deck.length === 0;
      if (shuffleBtn)  shuffleBtn.disabled  = lockActions || deck.length === 0;
      if (addHandBtn)  addHandBtn.disabled  = lockActions;
      if (addDeckBtn)  addDeckBtn.disabled  = lockActions;
      if (importBtn)   importBtn.disabled   = lockActions;
      // 启悟区按钮：观众也可点开查看（只读），操作按钮仅本人
      const oracleBtn = zone.querySelector('.btn-deck--oracle');
      if (oracleBtn) {
        oracleBtn.disabled = lockActions && !spec;
        const oracleCount = (typeof oracleHands !== 'undefined' && oracleHands && Array.isArray(oracleHands[playerId])) ? oracleHands[playerId].length : 0;
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
          // 手机端：0 张显示“启悟区”，>0 显示“启悟”，数量在第二排
          if (oracleCount > 0) oracleBtn.innerHTML = '启悟<br>（' + oracleCount + '）';
          else oracleBtn.textContent = '启悟区';
        } else {
          oracleBtn.textContent = oracleCount > 0 ? '✨ 启悟区（' + oracleCount + '）' : '✨ 启悟区';
        }
      }
      if (handBtn) {
        _setCountBtnText(handBtn, '手牌', hand.length);
      }
      if (deckBtn) {
        _setCountBtnText(deckBtn, '牌库', deck.length);
      }
    }

    function updateAllDeckButtons() {
      updateDeckButtons('1');
      updateDeckButtons('2');
    }

    function openCardTextDialog({ title, placeholder, multiline, onConfirm, hideQuantity, showLevel, deckPlacement, priorityOption, priceOption, rawQuantity, showHelp }) {
      cardTextContext = { onConfirm, deckPlacement: !!deckPlacement, rawQuantity: !!rawQuantity };
      cardTextTitle.textContent = title;
      cardTextInput.value = '';
      cardTextInput.placeholder = placeholder;
      cardTextInput.rows = multiline ? 6 : 2;
      cardTextOverlay.hidden = false;
      document.getElementById('card-text-dialog-quantity').value = '1';
      // 隐藏/显示置入数量行
      const qtyRow = document.querySelector('.card-text-quantity-row');
      if (qtyRow) qtyRow.style.display = hideQuantity ? 'none' : '';
      // 隐藏/显示商品等级行
      const levelRow = document.querySelector('.card-text-level-row');
      if (levelRow) levelRow.hidden = !showLevel;
      const levelEl = document.getElementById('card-text-dialog-level');
      if (levelEl) levelEl.value = '1';
      // 隐藏/显示"下次刷新必出"勾选行（仅商店添加商品使用）
      const priorityRow = document.getElementById('card-text-priority-row');
      if (priorityRow) priorityRow.hidden = !priorityOption;
      const priorityCheck = document.getElementById('card-text-priority-check');
      if (priorityCheck) priorityCheck.checked = false;
      // 隐藏/显示"商品价格"行（仅商店添加商品使用）
      const priceRow = document.getElementById('card-text-price-row');
      if (priceRow) priceRow.hidden = !priceOption;
      const priceEl = document.getElementById('card-text-dialog-price');
      if (priceEl) priceEl.value = '0';
      // 商店添加商品：数量支持 -1=无限，显示提示字
      const qtyHint = document.getElementById('card-text-qty-hint');
      if (qtyHint) qtyHint.hidden = !rawQuantity;
      // 置入牌库模式：隐藏 确定/取消，显示三个放置按钮
      const actionsRow = document.getElementById('card-text-dialog-actions');
      const placementRow = document.getElementById('card-text-placement-row');
      if (actionsRow) actionsRow.hidden = !!deckPlacement;
      if (placementRow) placementRow.hidden = !deckPlacement;
      // 导入模式才显示「导入格式」说明按钮
      const helpBtn = document.getElementById('card-text-help-btn');
      if (helpBtn) helpBtn.hidden = !showHelp;
      cardTextInput.focus();
    }

    function closeCardTextDialog() {
      cardTextOverlay.hidden = true;
      cardTextContext = null;
      cardTextInput.value = '';
      // 恢复置入数量行可见性
      const qtyRow = document.querySelector('.card-text-quantity-row');
      if (qtyRow) qtyRow.style.display = '';
      const levelRow = document.querySelector('.card-text-level-row');
      if (levelRow) levelRow.hidden = true;
      // 恢复 确定/取消 按钮行
      const actionsRow = document.getElementById('card-text-dialog-actions');
      const placementRow = document.getElementById('card-text-placement-row');
      if (actionsRow) actionsRow.hidden = false;
      if (placementRow) placementRow.hidden = true;
      // 隐藏"下次刷新必出"勾选行并取消勾选
      const priorityRow = document.getElementById('card-text-priority-row');
      if (priorityRow) priorityRow.hidden = true;
      const priorityCheck = document.getElementById('card-text-priority-check');
      if (priorityCheck) priorityCheck.checked = false;
      // 隐藏"商品价格"行
      const priceRow = document.getElementById('card-text-price-row');
      if (priceRow) priceRow.hidden = true;
      // 隐藏"-1则库存无限"提示字
      const qtyHint = document.getElementById('card-text-qty-hint');
      if (qtyHint) qtyHint.hidden = true;
    }

    function confirmCardTextDialog() {
      if (!cardTextContext) return;
      const value = cardTextInput.value;
      const qtyEl = document.getElementById('card-text-dialog-quantity');
      let qty;
      if (cardTextContext.rawQuantity) {
        qty = qtyEl ? qtyEl.value : '1';   // 原始值，由商店逻辑解析（-1=无限等）
      } else {
        qty = parseInt(qtyEl ? qtyEl.value : '1', 10);
        if (isNaN(qty) || qty < 1) qty = 1;
      }
      const levelEl = document.getElementById('card-text-dialog-level');
      let level = parseInt(levelEl ? levelEl.value : '1', 10);
      if (level !== 1 && level !== 2 && level !== 3) level = 1;
      const priorityCheck = document.getElementById('card-text-priority-check');
      const priority = !!(priorityCheck && priorityCheck.checked);
      const priceEl = document.getElementById('card-text-dialog-price');
      let price = parseInt(priceEl ? priceEl.value : '0', 10);
      if (isNaN(price) || price < 0) price = 0;
      cardTextContext.onConfirm(value, qty, level, priority, price);
      closeCardTextDialog();
    }

    function renderHandList(playerId) {
      try {
      let { hand } = getPlayerCardState(playerId);
      hand = (hand || []).filter(c => c && typeof c === 'object');
      getPlayerCardState(playerId).hand = hand;
      // 展示状态清理：已离开手牌的展示自动失效并同步
      if (playerHandShows[playerId] && playerHandShows[playerId].size) {
        const handIds = new Set(hand.map(c => c.id));
        let changed = false;
        playerHandShows[playerId].forEach(id => { if (!handIds.has(id)) { playerHandShows[playerId].delete(id); changed = true; } });
        if (changed && typeof isConnected === 'function' && isConnected() && typeof sendToPeer === 'function') {
          sendToPeer({ type: 'hand-shown', playerId, cardIds: [...playerHandShows[playerId]] });
        }
      }
      cardListBody.innerHTML = '';
      document.getElementById('deck-summary-header').hidden = true; // 隐藏牌库汇总
      if (!hand || !hand.length) {
        const empty = document.createElement('div');
        empty.className = 'card-list-empty';
        empty.textContent = '手牌为空';
        cardListBody.appendChild(empty);
        return;
      }
      const ownCards = isViewingOwnCards(playerId);
      const specView = (typeof isSpectator !== 'undefined' && isSpectator);
      hand.forEach((card, idx) => {
        if (!card || typeof card !== 'object') return;
        const item = document.createElement('div');
        item.className = 'card-list-item';
        const info = document.createElement('div');
        info.className = 'card-list-item__info';
        // 展示机制：该手牌是否被展示
        const isShown = !!(playerHandShows[playerId] && playerHandShows[playerId].has(card.id));
        // 查看对手手牌：隐藏灵咒数据（观众/被展示的牌可见全部内容）
        if ((ownCards || specView || isShown) && card.curses && card.curses.length) {
          info.dataset.cardCurses = JSON.stringify(card.curses);
        }
        const name = document.createElement('span');
        name.className = 'card-list-item__name';
        if (ownCards || specView || isShown) {
          name.textContent = card.name || '(未命名)';
          // 食材牌/佳肴：存储数据供浮窗显示
          if (card._food) {
            name.dataset.food = JSON.stringify(card);
          }
        } else {
          name.textContent = '未知';
          name.style.color = 'var(--text-muted, #888)';
        }
        info.appendChild(name);
        // 堆叠层数显示
        if ((ownCards || specView) && card._stack && card._maxStack) {
          const stackSpan = document.createElement('span');
          stackSpan.style.cssText = 'font-size:11px;color:#c0a860;margin-left:4px;white-space:nowrap;';
          stackSpan.textContent = '堆叠：' + card._stack + '/' + card._maxStack;
          info.appendChild(stackSpan);
        }
        // 灵咒标签 + 展示徽章（同行共享位置）
        const showCurses = card.curses && card.curses.length && (ownCards || specView || isShown);
        if (showCurses || isShown) {
          const curseTags = document.createElement('div');
          curseTags.className = 'card-list-item__curses';
          if (showCurses) {
            card.curses.forEach(c => {
              const tag = document.createElement('span');
              tag.className = 'card-list-curse-tag';
              tag.dataset.curseName = c.name;
              tag.textContent = '⛓️' + c.name + '×' + c.layers;
              // 仅牌主可点灵咒编辑；被展示给对手看时只读
              if (ownCards) {
                tag.addEventListener('click', (e) => { e.stopPropagation(); openCursePanel(_curseTargetForCard(playerId, card, '手牌中的')); });
              }
              curseTags.appendChild(tag);
            });
          }
          if (isShown) {
            const tag = document.createElement('span');
            tag.className = 'card-list-show-tag';
            tag.textContent = '👁 展示 ✕';
            tag.title = '点击取消展示';
            // 双方都能点关闭；观众只读
            if (!specView) {
              tag.addEventListener('click', (e) => { e.stopPropagation(); cancelHandShow(playerId, card); });
            }
            curseTags.appendChild(tag);
          }
          info.appendChild(curseTags);
        }
        item.appendChild(info);
        // 操作按钮（自己可见可点；观众可见但不可点）
        if (ownCards || specView) {
        const actions = document.createElement('div');
        actions.className = 'card-list-item__actions' + (specView && !ownCards ? ' card-list-item__actions--spec' : '');
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn-card-curse-add';
        addBtn.textContent = '➕';
        addBtn.title = '添加灵咒';
        addBtn.addEventListener('click', (e) => { e.stopPropagation(); openCursePanel(_curseTargetForCard(playerId, card, '手牌中的')); });
        actions.appendChild(addBtn);
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'btn-card-action btn-card-use';
        useBtn.textContent = '使用';
        useBtn.addEventListener('click', () => removeFromHand(playerId, card.id, 'use'));
        const chargeBtn = document.createElement('button');
        chargeBtn.type = 'button';
        chargeBtn.className = 'btn-card-action btn-card-charge';
        chargeBtn.textContent = '蓄力';
        chargeBtn.title = '蓄力使用：将牌暂存在式神身上，稍后完成使用';
        chargeBtn.hidden = true; // 默认隐藏，由左下角「蓄力使用」按钮切换
        chargeBtn.dataset.chargeBtn = 'true';
        chargeBtn.addEventListener('click', () => {
          if (typeof Charge !== 'undefined') {
            Charge.startFromHand(playerId, card);
          } else {
            broadcastSystemMsg('【系统】蓄力模块未加载');
          }
        });
        const renyinBtn = document.createElement('button');
        renyinBtn.type = 'button';
        renyinBtn.className = 'btn-card-action btn-card-renyin';
        renyinBtn.textContent = '连引';
        renyinBtn.title = '连引使用：设置搜索条件，从牌库连引其他卡牌';
        renyinBtn.hidden = true; // 默认隐藏，由左下角「连引使用」按钮切换
        renyinBtn.dataset.renyinBtn = 'true';
        renyinBtn.addEventListener('click', () => {
          if (typeof Renyin !== 'undefined') {
            Renyin.open(playerId, card);
          } else {
            broadcastSystemMsg('【系统】连引模块未加载');
          }
        });
        const discardBtn = document.createElement('button');
        discardBtn.type = 'button';
        discardBtn.className = 'btn-card-action btn-card-discard';
        discardBtn.textContent = '弃置';
        discardBtn.hidden = true; // 默认隐藏，手机端由互斥开关控制，桌面端由 _applyMobileHandMode 恢复
        discardBtn.dataset.discardBtn = 'true';
        discardBtn.addEventListener('click', () => removeFromHand(playerId, card.id, 'discard'));
        // 调度按钮：与牌库中随机一张牌交换位置
        const redrawBtn = document.createElement('button');
        redrawBtn.type = 'button';
        redrawBtn.className = 'btn-card-action btn-card-redraw';
        redrawBtn.textContent = '调度';
        redrawBtn.hidden = true;
        redrawBtn.dataset.redrawBtn = 'true';
        redrawBtn.addEventListener('click', () => swapHandWithDeck(playerId, card.id));
        actions.appendChild(useBtn);
        actions.appendChild(chargeBtn);
        actions.appendChild(renyinBtn);
        actions.appendChild(discardBtn);
        actions.appendChild(redrawBtn);
        // 置入牌库按钮
        const toDeckBtn = document.createElement('button');
        toDeckBtn.type = 'button';
        toDeckBtn.className = 'btn-card-action btn-card-to-deck';
        toDeckBtn.textContent = '置入牌库';
        toDeckBtn.hidden = true; // 默认隐藏，由互斥开关控制
        toDeckBtn.dataset.toDeckBtn = 'true';
        toDeckBtn.addEventListener('click', () => moveToDeckFromHand(playerId, card.id));
        actions.appendChild(toDeckBtn);
        // 启悟机制激活时，显示"置入启悟"按钮（默认隐藏，由互斥开关控制）
        if (typeof oracleActive !== 'undefined' && oracleActive[playerId] && typeof moveToOracle === 'function') {
          const oracleMoveBtn = document.createElement('button');
          oracleMoveBtn.type = 'button';
          oracleMoveBtn.className = 'btn-card-move-oracle';
          oracleMoveBtn.textContent = '置入启悟';
          oracleMoveBtn.hidden = true;
          oracleMoveBtn.dataset.toOracleBtn = 'true';
          oracleMoveBtn.addEventListener('click', () => moveToOracle(playerId, card.id));
          actions.appendChild(oracleMoveBtn);
        }
        item.appendChild(actions);
        } // end if (ownCards)
        cardListBody.appendChild(item);
      });
      if (typeof _applyMobileHandMode === 'function') _applyMobileHandMode();
      } catch(e) {
        console.error('[RenderHand] 渲染手牌失败:', e);
        cardListBody.innerHTML = '<div class="card-list-empty">手牌渲染出错，请查看控制台</div>';
      }
    }

    /** 取消某张手牌的展示（双方都能点徽章关闭） */
    function cancelHandShow(playerId, card) {
      const shows = playerHandShows[playerId];
      if (!shows || !shows.has(card.id)) return;
      shows.delete(card.id);
      if (typeof isConnected === 'function' && isConnected() && typeof sendToPeer === 'function') {
        sendToPeer({ type: 'hand-shown', playerId, cardIds: [...shows] });
      }
      const opPid = (typeof localPlayerId !== 'undefined' && localPlayerId && localPlayerId !== '0') ? localPlayerId : '1';
      const opName = getPlayerName(opPid);
      const tgtName = getPlayerName(playerId);
      const cardName = card.name || '(未命名)';
      if (String(opPid) === String(playerId)) {
        broadcastSystemMsg(`【系统】${opName}取消了「${cardName}」的展示`);
      } else {
        broadcastSystemMsg(`【系统】${opName}取消了${tgtName}的「${cardName}」的展示`);
      }
      refreshOpenListDialog(playerId);
    }

    function renderDeckList(playerId) {
      try {
      let { deck } = getPlayerCardState(playerId);
      // 过滤无效卡牌数据
      deck = (deck || []).filter(c => c && typeof c === 'object');
      getPlayerCardState(playerId).deck = deck;
      cardListBody.innerHTML = '';
      if (!deck.length) {
        const empty = document.createElement('div');
        empty.className = 'card-list-empty';
        empty.textContent = '牌库为空';
        cardListBody.appendChild(empty);
        document.getElementById('deck-summary-header').hidden = true;
        return;
      }

      const total = deck.length;
      const cursedCount = deck.filter(c => c.curses && c.curses.length).length;
      const viewerId = getViewerPlayerId();
      const revealedSet = playerRevealedCards[viewerId] || new Set();
      const specView = (typeof isSpectator !== 'undefined' && isSpectator);

      // 顶栏：总数 + 灵咒提示
      const summaryEl = document.getElementById('deck-summary-header');
      summaryEl.hidden = false;
      summaryEl.innerHTML = `<span class="deck-summary__total">📚 牌库（共${total}张）</span>`;
      if (cursedCount > 0) {
        summaryEl.innerHTML += `<span class="deck-summary__curse-hint">⚠ 牌库中有灵咒结附（${cursedCount}张）</span>`;
      }

      // ===== 统一按顺序排列（己方/对方均如此）=====
      const section = document.createElement('div');
      section.className = 'deck-group';
      const sectionHeader = document.createElement('div');
      sectionHeader.className = 'deck-group__header';
      sectionHeader.textContent = `▼ 牌库顺序（${total}）`;
      section.appendChild(sectionHeader);

      deck.forEach((card, idx) => {
        if (!card || typeof card !== 'object') return;
        const row = document.createElement('div');
        row.className = 'deck-group__row';

        const posSpan = document.createElement('span');
        posSpan.className = 'deck-group__count';
        posSpan.textContent = `#${idx + 1}`;
        posSpan.style.minWidth = '2.5em';
        row.appendChild(posSpan);

        const nameSpan = document.createElement('span');
        const isRevealed = revealedSet.has(card.id);
        const isFateRevealed = (playerFateRevealedCards[viewerId] && playerFateRevealedCards[viewerId].has(card.id));
        if (isRevealed || isFateRevealed || specView) {
          nameSpan.className = 'deck-group__name';
          const labels = [];
          if (isRevealed) labels.push('已占卜');
          if (isFateRevealed) labels.push('已命运抉择');
          nameSpan.textContent = card.name + (labels.length ? '（' + labels.join('，') + '）' : '');
          nameSpan.style.cursor = 'help';
          // 食材牌/佳肴：存储数据供浮窗显示
          if (card._food) {
            nameSpan.dataset.food = JSON.stringify(card);
          }
          // 已揭示的灵咒标签
          if (card.curses && card.curses.length) {
            const curseSpan = document.createElement('span');
            curseSpan.className = 'breakdown-card-row__curses';
            curseSpan.style.marginLeft = '6px';
            card.curses.forEach(c => {
              const tag = document.createElement('span');
              tag.className = 'breakdown-card-row__curse-tag';
              tag.textContent = '⛓️' + c.name + '×' + c.layers;
              curseSpan.appendChild(tag);
            });
            row.appendChild(curseSpan);
          }
        } else {
          nameSpan.className = 'deck-group__name';
          nameSpan.textContent = '未知';
          nameSpan.style.color = 'var(--text-muted, #888)';
        }
        row.appendChild(nameSpan);

        // 弃牌按钮（自己牌库可点；观众可见但不可点）
        if (isViewingOwnCards(playerId) || specView) {
          const discardBtn = document.createElement('button');
          discardBtn.type = 'button';
          discardBtn.className = 'btn-card-action btn-card-discard';
          discardBtn.textContent = '弃牌';
          discardBtn.style.cssText = 'font-size:10px;padding:2px 6px;flex-shrink:0;';
          if (specView && !isViewingOwnCards(playerId)) discardBtn.disabled = true;
          discardBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            discardFromDeckById(playerId, card.id);
          });
          row.appendChild(discardBtn);
        }

        section.appendChild(row);
      });
      cardListBody.appendChild(section);
      } catch(e) {
        console.error('[RenderDeck] 渲染牌库失败:', e);
        cardListBody.innerHTML = '<div class="card-list-empty">牌库渲染出错，请查看控制台</div>';
      }
    }

    // ---- 手牌/牌库弹窗拖拽 ----
    let cardListDragOffset = { x: 0, y: 0 };
    let cardListDragStart = null;
    const cardListDialogEl = cardListOverlay.querySelector('.speak-dialog');

    cardListTitle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      cardListDragStart = { x: e.clientX - cardListDragOffset.x, y: e.clientY - cardListDragOffset.y };
      cardListDialogEl.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!cardListDragStart || cardListOverlay.hidden) return;
      cardListDragOffset.x = e.clientX - cardListDragStart.x;
      cardListDragOffset.y = e.clientY - cardListDragStart.y;
      const tx = `translate(${cardListDragOffset.x}px, ${cardListDragOffset.y}px)`;
      cardListDialogEl.style.transform = tx;
      cardListDialogEl.style.transition = 'none';
      // 牌表侧窗跟随移动
      if (deckBreakdownPanel && !deckBreakdownPanel.hidden) {
        deckBreakdownPanel.style.transform = tx;
        deckBreakdownPanel.style.transition = 'none';
      }
    });

    document.addEventListener('mouseup', () => {
      if (!cardListDragStart) return;
      cardListDragStart = null;
      cardListDialogEl.style.cursor = '';
      if (deckBreakdownPanel) deckBreakdownPanel.style.cursor = '';
    });

    function openCardListDialog({ title, playerId, type }) {
      cardListContext = { playerId, type };
      // 重置连引/蓄力按钮状态
      renyinBtnsVisible = false;
      chargeBtnsVisible = false;
      _mobileHandMode = '';
      const chargeToggleBtn = document.getElementById('card-list-charge-toggle');
      if (chargeToggleBtn) {
        chargeToggleBtn.hidden = (type !== 'hand' || !isViewingOwnCards(playerId));
        chargeToggleBtn.style.background = 'linear-gradient(180deg,#3a2a10,#2a1a08)';
        chargeToggleBtn.style.color = '#c0a060';
        chargeToggleBtn.style.borderColor = 'rgba(200,160,60,0.4)';
      }
      const toggleBtn = document.getElementById('card-list-renyin-toggle');
      if (toggleBtn) {
        toggleBtn.hidden = (type !== 'hand' || !isViewingOwnCards(playerId));
        toggleBtn.style.background = 'linear-gradient(180deg,#4a3a6a,#3a2a5a)';
        toggleBtn.style.color = '#c0b0e0';
      }
      // 手机端互斥开关排：仅自己手牌显示
      const togglesRow = document.getElementById('hand-action-toggles');
      if (togglesRow) togglesRow.hidden = (type !== 'hand' || !isViewingOwnCards(playerId));
      // 观众：灵咒工具栏（输入框+随机结附+优先不重复）置灰禁点
      const specLock = (typeof isSpectator !== 'undefined' && isSpectator);
      const curseBar = document.getElementById('curse-random-bar');
      if (curseBar) {
        curseBar.classList.toggle('curse-random-bar--spec', !!specLock);
        curseBar.querySelectorAll('input, button').forEach(el => { el.disabled = !!specLock; });
      }
      // 置入启悟区开关：仅在该牌手已开启启悟机制时显示
      const toOracleToggle = document.querySelector('.hand-toggle-btn[data-hand-mode="tooracle"]');
      if (toOracleToggle) {
        toOracleToggle.hidden = !(type === 'hand' && isViewingOwnCards(playerId) && typeof oracleActive !== 'undefined' && oracleActive[playerId]);
      }
      cardListTitle.textContent = title;
      // 先清除牌库汇总（防止切换视图时残留）
      document.getElementById('deck-summary-header').hidden = true;
      document.getElementById('deck-summary-header').innerHTML = '';
      if (type === 'hand') renderHandList(playerId);
      else renderDeckList(playerId);
      // 牌表按钮：仅自己牌库可见（查看对手牌库时隐藏）
      cardListBreakdownBtn.hidden = (type !== 'deck' || !isViewingOwnCards(playerId));
      cardListBreakdownBtn.textContent = '📋 查看牌表';
      // 初始手牌按钮：仅在自己手牌弹窗中显示
      const initialHandBtn = document.getElementById('card-list-initial-hand-btn');
      if (initialHandBtn) {
        initialHandBtn.hidden = (type !== 'hand' || !isViewingOwnCards(playerId) || !getPlayerCardState(playerId).deck.length);
      }
      deckBreakdownPanel.hidden = true;
      // 重置拖拽偏移
      cardListDragOffset = { x: 0, y: 0 };
      cardListDialogEl.style.transform = '';
      cardListDialogEl.style.transition = '';
      if (deckBreakdownPanel) {
        deckBreakdownPanel.style.transform = '';
        deckBreakdownPanel.style.transition = '';
      }
      cardListOverlay.hidden = false;
      _applyMobileHandMode();
      _refreshCardListBtnTexts();
    }

    function closeCardListDialog() {
      cardListOverlay.hidden = true;
      cardListContext = null;
      cardListBody.innerHTML = '';
      document.getElementById('deck-summary-header').hidden = true;
      document.getElementById('deck-summary-header').innerHTML = '';
      deckBreakdownPanel.hidden = true;
      deckBreakdownBody.innerHTML = '';
    }

    function refreshOpenListDialog(playerId) {
      if (!cardListContext || cardListContext.playerId !== playerId) return;
      if (cardListContext.type === 'hand') renderHandList(playerId);
      else { renderDeckList(playerId); refreshDeckBreakdown(playerId); }
    }

    function drawCard(playerId) {
      const state = getPlayerCardState(playerId);
      if (!state.deck.length) {
        broadcastSystemMsg(`【系统】${getPlayerName(playerId)}试图抽牌，但牌库已空`);
        return;
      }
      const card = state.deck.shift();
      pushCardToHand(playerId, card);
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      broadcastSystemMsg(`【系统】${getPlayerName(playerId)}抽了一张牌`);
      // 飞行动画：牌库 → 手牌
      if (typeof CardFlight !== 'undefined') {
        CardFlight.flyAndBroadcast(playerId, 'deck', 'hand');
      }
    }

    /** 调度：手牌与牌库中随机一张牌交换（交换进牌库的牌保持被换走那张的位置） */
    function swapHandWithDeck(playerId, cardId) {
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      const state = getPlayerCardState(playerId);
      if (!state.deck.length) {
        broadcastSystemMsg('【系统】' + getPlayerName(playerId) + '试图调度，但牌库已空');
        return;
      }
      const hi = state.hand.findIndex(card => card.id === cardId);
      if (hi === -1) return;
      const di = Math.floor(Math.random() * state.deck.length);
      const handCard = state.hand[hi];
      const deckCard = state.deck[di];
      state.deck[di] = handCard;   // 手牌放入被换走那张牌的原位置
      state.hand[hi] = deckCard;
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      // 公开消息：对手只能看到“调度了一张手牌”；具体换了什么仅操作者可见
      broadcastSystemMsg('【系统】' + getPlayerName(playerId) + '调度了一张手牌');
      if (typeof addSystemChatMessage === 'function') {
        addSystemChatMessage('【系统】调度：手牌「' + handCard.name + '」与牌库「' + deckCard.name + '」交换（此信息仅你可见）');
      }
      // 调度动画：一张牌从手牌飞向牌库，一张从牌库飞向手牌（联机双方可见）
      if (typeof CardFlight !== 'undefined') {
        CardFlight.flyAndBroadcast(playerId, 'hand', 'deck', { duration: 0.55 });
        CardFlight.flyAndBroadcast(playerId, 'deck', 'hand', { duration: 0.55 });
      }
    }

    function removeFromHand(playerId, cardId, action) {
      // 观众禁止任何手牌操作
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      const state = getPlayerCardState(playerId);
      const index = state.hand.findIndex(card => card.id === cardId);
      if (index === -1) return;
      const card = state.hand[index];
      state.hand.splice(index, 1);

      // 加入坟场（使用/弃置都进；从坟场再使用时不再重复进坟场）
      if (window._graveUseInProgress) {
        card.used = true;
      } else {
        if (!state.grave) state.grave = [];
        card.used = (action === 'use');
        card._graveAdded = false;   // 重新进坟场的牌按“使用/弃置”归类
        state.grave.push(card);
      }

      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      if (typeof window.refreshGraveButtons === 'function') window.refreshGraveButtons();
      const verb = action === 'use' ? (window._chargeCompleting ? '完成了蓄力，使用了' : '使用了') : '弃置了';

      // 醉仙引：使用后回一张到商店库存并加入优先队列
      if (action === 'use' && card.name === '醉仙引' && typeof window.applyZuiXianYin === 'function') {
        window.applyZuiXianYin(playerId);
      }

      // 使用幻境牌时，自动添加到幻境/效果面板
      if (action === 'use') {
        const stackInfo = (card._maxStack > 0) ? `（${card._stack || 1}/${card._maxStack}）` : '';
        const curseInfo = (card.curses && card.curses.length) ? '（结附灵咒：' + card.curses.map(c => c.name + '×' + c.layers).join('、') + '）' : '';
        const mainMsg = `【系统】${getPlayerName(playerId)}${verb}「${card.name}」${stackInfo}${curseInfo}`;
        if (window._graveUseInProgress) {
          // 从坟场使用：由坟场逻辑统一播报，这里不重复
        } else if (window._searchUseInProgress) {
          // 从检索使用：由检索逻辑统一播报，这里不重复
        } else if (typeof startMessageGroup === 'function') {
          startMessageGroup(mainMsg, window.getFoodNote ? window.getFoodNote(card) : null);
        } else {
          broadcastSystemMsg(mainMsg);
        }

        const dbCard = CardDB.lookup(card.name, playerId);
        let animTarget = null;

        // 1) 形态牌：自动结附到所属式神
        if (dbCard && dbCard.type === 'form' && dbCard.owner) {
          const zone = getPlayerZone(playerId);
          if (zone) {
            const slots = zone.querySelectorAll('.card-slot');
            for (const slot of slots) {
              if (slot.querySelector('.card-name')?.value === dbCard.owner) {
                const oldForm = slot._formName || '';
                if (typeof window.equipFormOnSlot === 'function') {
                  window.equipFormOnSlot(slot, dbCard.name, dbCard.attack || 0, dbCard.hp || 0, dbCard.effect || '');
                } else {
                  slot._formName = dbCard.name;
                  slot._formAtk = dbCard.attack || 0;
                  slot._formHp = dbCard.hp || 0;
                  slot._formAbility = dbCard.effect || '';
                  syncSlotToPeer(slot);
                  if (typeof autoUpdateSlotImage === 'function') autoUpdateSlotImage(slot);
                  if (typeof renderFormBadge === 'function') renderFormBadge(slot);
                }
                const replaceMsg = oldForm ? `（替换了原有形态「${oldForm}」）` : '';
                broadcastSystemMsg(`【系统】${getPlayerName(playerId)}为「${dbCard.owner}」结附了形态「${dbCard.name}」${replaceMsg}`);
                animTarget = slot;
                break;
              }
            }
          }
        }

        // 2) 幻境牌：创建幻境条目
        if (dbCard && dbCard.type === 'realm') {
          const zone = getPlayerZone(playerId);
          if (zone) {
            const panel = zone.querySelector('.effects-panel');
            const item = createEffectItem();
            item.querySelector('.effect-name').value = dbCard.name;
            item.querySelector('.effect-value').value = String(dbCard.durability);
            panel.appendChild(item);
            syncEffectsState(playerId);
            broadcastSystemMsg(`${getPlayerName(playerId)}展开了幻境「${dbCard.name}」（耐久${dbCard.durability}）`);
            animTarget = item;
          }
        }

        // 3) 觉醒牌（含法术型和幻境型）：自动设置觉醒标记和永久属性
        if (dbCard && dbCard.awakened && (dbCard.type === 'spell' || dbCard.type === '法术' || dbCard.type === 'realm')) {
          const zone = getPlayerZone(playerId);
          if (zone) {
            const slots = zone.querySelectorAll('.card-slot');
            for (const slot of slots) {
              const slotName = slot.querySelector('.card-name')?.value;
              if (slotName === dbCard.owner) {
                slot.classList.add('awakened');
                if (typeof recordPermBase === 'function') recordPermBase(slot);
                const oldAtk = typeof calcPermAtk === 'function' ? calcPermAtk(slot) : 0;
                const oldHp = typeof calcPermHp === 'function' ? calcPermHp(slot) : 0;
                if (!slot._permAtkMods) slot._permAtkMods = [];
                if (!slot._permHpMods) slot._permHpMods = [];
                const awakenSource = dbCard.name.includes('觉醒') ? dbCard.name : `${dbCard.name}（觉醒）`;
                slot._permAtkMods.push({ source: awakenSource, value: dbCard.atkBonus || 0, layers: 1 });
                slot._permHpMods.push({ source: awakenSource, value: dbCard.hpBonus || 0, layers: 1 });
                if (typeof applyPermStats === 'function') applyPermStats(slot, oldAtk, oldHp);
                // 提取觉醒后的能力描述（"觉醒："之后的全部文本）
                const rawEffect = dbCard.effect || '';
                const awakenIdx = rawEffect.indexOf('觉醒：');
                if (awakenIdx >= 0) {
                  slot._permAbility = rawEffect.slice(awakenIdx + 3).trim();
                } else {
                  slot._permAbility = rawEffect;
                }
                syncSlotToPeer(slot);
                if (typeof autoUpdateSlotImage === 'function') autoUpdateSlotImage(slot);
                broadcastSystemMsg(`【系统】${getPlayerName(playerId)}为「${slotName}」使用了觉醒「${dbCard.name}」`);
                if (!animTarget) animTarget = slot;
                break;
              }
            }
          }
        }

        // 4) 使用牌动画：飞行→翻转→预展示（如果有目标则追加飞行到目标阶段）
        if (typeof CardFlight !== 'undefined') {
          CardFlight.playUseCardAnim(playerId, card, { targetEl: animTarget });
        }
        // 若卡牌有灵咒，转移到战场同名卡牌槽
        if (card.curses && card.curses.length) {
          const zone = getPlayerZone(playerId);
          if (zone) {
            const slots = zone.querySelectorAll('.card-slot');
            for (const slot of slots) {
              const slotName = slot.querySelector('.card-name').value;
              if (slotName === card.name) {
                const slotCurses = getSlotCurses(slot);
                card.curses.forEach(sc => {
                  const exist = slotCurses.find(c => c.name === sc.name);
                  if (exist) { exist.layers += sc.layers; }
                  else { slotCurses.push({ name: sc.name, layers: sc.layers }); }
                });
                setSlotCurses(slot, slotCurses);
                syncSlotToPeer(slot);
                break;
              }
            }
          }
        }

        // 【消息分组】结束：渲染可展开的消息组
        if (typeof endMessageGroup === 'function') {
          endMessageGroup();
        }
      } else {
        // 弃置：普通消息，不分组
        broadcastSystemMsg(`【系统】${getPlayerName(playerId)}${verb}「${card.name}」`);
        // 弃牌动画：P1向下、P2向上飞150px
        if (typeof CardFlight !== 'undefined') {
          const handBtn = CardFlight.getPlayerBtn(playerId, 'hand');
          if (handBtn) {
            const r = handBtn.getBoundingClientRect();
            const tgtY = playerId === '2' ? r.top - 150 : r.bottom + 150;
            CardFlight.fly(handBtn, { x: r.left + r.width / 2, y: tgtY }, { arcHeight: 20, duration: 0.45 });
            // 联机广播弃牌动画
            if (typeof CardFlight._broadcastAnim === 'function') {
              CardFlight._broadcastAnim({ action: 'fly-single', playerId, fromType: 'hand', toCoord: { x: r.left + r.width / 2, y: tgtY }, opts: { arcHeight: 20, duration: 0.45 } });
            }
          }
        }
      }
    }

    function insertCardAtRandomPosition(deck, card) {
      const index = Math.floor(Math.random() * (deck.length + 1));
      deck.splice(index, 0, card);
    }

    /** 将手牌中的某张牌放回牌库随机位置 */
    function moveToDeckFromHand(playerId, cardId) {
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      if (typeof isMyZone === 'function' && !isMyZone(playerId)) return;
      const state = getPlayerCardState(playerId);
      const index = state.hand.findIndex(card => card.id === cardId);
      if (index === -1) return;
      const [card] = state.hand.splice(index, 1);
      insertCardAtRandomPosition(state.deck, card);
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      broadcastSystemMsg(`【系统】${getPlayerName(playerId)}将「${card.name}」从手牌放回了牌库`);
      // 飞行动画：手牌 → 牌库
      if (typeof CardFlight !== 'undefined') {
        CardFlight.flyAndBroadcast(playerId, 'hand', 'deck');
      }
    }

    /** 从牌库弃置一张牌（按ID），带动画 */
    function discardFromDeckById(playerId, cardId) {
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      if (typeof isMyZone === 'function' && !isMyZone(playerId)) return;
      const state = getPlayerCardState(playerId);
      const idx = state.deck.findIndex(c => c && c.id === cardId);
      if (idx === -1) return;
      const [card] = state.deck.splice(idx, 1);
      if (!state.grave) state.grave = [];
      state.grave.push(card);
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      if (typeof window.refreshGraveButtons === 'function') window.refreshGraveButtons();
      broadcastSystemMsg(`【系统】${getPlayerName(playerId)}从牌库弃置了「${card.name}」`);
      // 弃牌动画：从牌库按钮飞出
      _playDiscardAnim(playerId);
    }

    /** 从牌库弃置一张牌（按牌名，用于牌表），带动画 */
    function discardFromDeckByName(playerId, cardName) {
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      if (typeof isMyZone === 'function' && !isMyZone(playerId)) return;
      const state = getPlayerCardState(playerId);
      const idx = state.deck.findIndex(c => c && c.name === cardName);
      if (idx === -1) return;
      const [card] = state.deck.splice(idx, 1);
      if (!state.grave) state.grave = [];
      state.grave.push(card);
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      if (typeof window.refreshGraveButtons === 'function') window.refreshGraveButtons();
      broadcastSystemMsg(`【系统】${getPlayerName(playerId)}从牌库弃置了「${cardName}」`);
      _playDiscardAnim(playerId);
    }

    /** 弃牌动画：卡牌从牌库按钮飞出 */
    function _playDiscardAnim(playerId) {
      if (typeof CardFlight === 'undefined') return;
      const deckBtn = CardFlight.getPlayerBtn(playerId, 'deck');
      if (!deckBtn) return;
      const r = deckBtn.getBoundingClientRect();
      const tgtY = playerId === '2' ? r.top - 150 : r.bottom + 150;
      CardFlight.fly(deckBtn, { x: r.left + r.width / 2, y: tgtY }, { arcHeight: 20, duration: 0.45 });
      // 联机广播
      if (typeof CardFlight._broadcastAnim === 'function') {
        CardFlight._broadcastAnim({ action: 'fly-single', playerId, fromType: 'deck', toCoord: { x: r.left + r.width / 2, y: tgtY }, opts: { arcHeight: 20, duration: 0.45 } });
      }
    }

    function shuffleDeck(playerId) {
      const state = getPlayerCardState(playerId);
      if (!state.deck.length) {
        broadcastSystemMsg(`【系统】${getPlayerName(playerId)}试图洗牌，但牌库为空`);
        return;
      }
      shuffleCards(state.deck);
      // 洗牌后：清除该牌库相关的占卜/命运抉择揭示，变回未知
      Object.keys(playerRevealedCards).forEach(function(k) { delete playerRevealedCards[k]; });
      Object.keys(playerFateRevealedCards).forEach(function(k) { delete playerFateRevealedCards[k]; });
      if (isConnected() && typeof sendToPeer === 'function') {
        // 同步清空双方已揭示记录（占卜/命运抉择揭示存在服务端状态里）
        ['1', '2'].forEach(function(pid) {
          sendToPeer({ type: 'revealed-cards', playerId: pid, cardIds: [] });
          sendToPeer({ type: 'fate-revealed-cards', playerId: pid, cardIds: [] });
        });
      }
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId); else syncDeckState(playerId);
      broadcastSystemMsg(`【系统】${getPlayerName(playerId)}洗了牌库`);
      // 洗牌动画
      if (typeof CardFlight !== 'undefined') {
        CardFlight.shuffleDeckAnim(playerId);
      }
    }

    // ---- 占卜系统 ----
    let divineContext = null; // { playerId, topGroup:[], bottomGroup:[], restDeck:[], x }
    let divineTempOpId = null; // 操作者ID（辅助对方时）

    const divineOverlay = document.getElementById('divine-dialog-overlay');
    const divineXRow = document.getElementById('divine-x-row');
    const divineXInput = document.getElementById('divine-x-input');
    const divineMain = document.getElementById('divine-main');
    const divineTopList = document.getElementById('divine-top-list');
    const divineBottomList = document.getElementById('divine-bottom-list');
    // 手机端：拦截占卜弹窗上的滑动，防止滚动穿透到背后的战场
    if (!window._divineOverlayTouchBound) {
      window._divineOverlayTouchBound = true;
      const divineOverlayEl = document.getElementById('divine-dialog-overlay');
      if (divineOverlayEl) {
        divineOverlayEl.addEventListener('touchmove', function(e) {
          // 弹窗内部允许滚动（弹窗自身可滚），弹窗外区域拦截，防止带动战场
          if (e.target.closest && e.target.closest('.divine-dialog')) return;
          e.preventDefault();
        }, { passive: false });
      }
    }
    const divineActions = document.getElementById('divine-actions');
    const divineTitle = document.getElementById('divine-dialog-title');

    /** 步骤1：弹出占卜X输入框 */
    function openDivineXPrompt(playerId, operatorId) {
      const state = getPlayerCardState(playerId);
      if (!state.deck.length) {
        broadcastSystemMsg(`【系统】${getPlayerName(playerId)}试图占卜，但牌库为空`);
        return;
      }
      // 存储操作者信息
      divineTempOpId = operatorId || playerId;
      divineXRow.hidden = false;
      divineMain.hidden = true;
      divineActions.hidden = true;
      divineTitle.textContent = `🔮 占卜 — ${getPlayerName(playerId)}`;
      divineXInput.max = state.deck.length;
      divineXInput.value = Math.min(3, state.deck.length);
      divineOverlay.hidden = false;
      divineXInput.focus();
      divineXInput.select();
      // 绑定一次性事件
      document.getElementById('divine-x-confirm').onclick = () => {
        const x = parseInt(divineXInput.value, 10);
        if (isNaN(x) || x < 1) { divineXInput.value = 1; return; }
        const clampedX = Math.min(x, state.deck.length);
        startDivine(playerId, clampedX);
      };
      // Enter 键确认，Esc 取消
      divineXInput.onkeydown = (e) => {
        if (e.key === 'Enter') document.getElementById('divine-x-confirm').click();
        if (e.key === 'Escape') closeDivineDialog(true);
      };
    }

    /** 步骤2：取牌库顶X张副本，展示占卜操作界面（不修改真实牌库，确认后才应用） */
    function startDivine(playerId, x) {
      const state = getPlayerCardState(playerId);
      if (!state.deck.length || x < 1) { closeDivineDialog(false); return; }
      const clampedX = Math.min(x, state.deck.length);
      // 复制顶部X张（深拷贝，避免引用问题）
      const divineCards = state.deck.slice(0, clampedX).map(c => ({
        id: c.id,
        name: c.name,
        curses: c.curses ? c.curses.map(cur => ({ name: cur.name, layers: cur.layers })) : [],
      }));
      // 标记这些牌为"已占卜揭示"（自己的牌库占卜后也能看到）
      const viewerId = getViewerPlayerId();
      if (!playerRevealedCards[viewerId]) playerRevealedCards[viewerId] = new Set();
      divineCards.forEach(c => playerRevealedCards[viewerId].add(c.id));
      // 同步到服务器（占卜揭示持久化，单人房/联机刷新重连后都能恢复）
      if (isConnected() && typeof sendToPeer === 'function') {
        sendToPeer({ type: 'revealed-cards', playerId: viewerId, cardIds: [...playerRevealedCards[viewerId]] });
      }
      divineContext = {
        playerId,
        topGroup: divineCards,
        bottomGroup: [],
        x: clampedX,
        operatorId: divineTempOpId || playerId,
      };
      divineTempOpId = null;
      // UI切换
      divineXRow.hidden = true;
      divineMain.hidden = false;
      divineActions.hidden = false;
      // 已展示占卜牌后：取消按钮置灰，只能点「确认占卜」
      const divineCancelBtn = document.getElementById('divine-cancel');
      if (divineCancelBtn) divineCancelBtn.disabled = true;
      divineTitle.textContent = `🔮 占卜 ${clampedX} — ${getPlayerName(playerId)}`;
      renderDivineLists();
      const opId = divineContext.operatorId;
      const isHelp = opId !== playerId;
      const tgtName = getPlayerName(playerId);
      const opName = getPlayerName(opId);
      const startMsg = isHelp
        ? `【系统】${opName}为${tgtName}开始占卜${clampedX}..`
        : `【系统】${tgtName}进行了占卜${clampedX}`;
      broadcastSystemMsg(startMsg);
    }

    // ---- 拖拽状态 ----
    let dragData = null; // { cardId, sourceGroup }

    /** 渲染顶部/底部两组卡牌 */
    function renderDivineLists() {
      if (!divineContext) return;
      const { topGroup, bottomGroup } = divineContext;
      // 顶部组
      divineTopList.innerHTML = '';
      topGroup.forEach((card, index) => {
        divineTopList.appendChild(createDivineCardItem(card, index, 'top'));
      });
      // 底部组
      divineBottomList.innerHTML = '';
      bottomGroup.forEach((card, index) => {
        divineBottomList.appendChild(createDivineCardItem(card, index, 'bottom'));
      });
    }

    /** 创建单个占卜卡牌条目（纯拖拽排序，无按钮） */
    function createDivineCardItem(card, index, group) {
      const item = document.createElement('div');
      item.className = 'divine-card-item';
      item.draggable = true;
      item.dataset.cardId = card.id;
      item.dataset.group = group;

      // ---- 拖拽事件 ----
      item.addEventListener('dragstart', (e) => {
        dragData = { cardId: card.id, sourceGroup: group };
        item.classList.add('divine-card-item--dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('divine-card-item--dragging');
        dragData = null;
        document.querySelectorAll('.divine-card-item--drag-over, .divine-card-item--drag-before, .divine-card-item--drag-after').forEach(el => {
          el.classList.remove('divine-card-item--drag-over', 'divine-card-item--drag-before', 'divine-card-item--drag-after');
        });
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        item.parentElement.querySelectorAll('.divine-card-item--drag-over, .divine-card-item--drag-before, .divine-card-item--drag-after').forEach(el => {
          el.classList.remove('divine-card-item--drag-over', 'divine-card-item--drag-before', 'divine-card-item--drag-after');
        });
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          item.classList.add('divine-card-item--drag-before');
        } else {
          item.classList.add('divine-card-item--drag-after');
        }
      });
      item.addEventListener('dragleave', (e) => {
        item.classList.remove('divine-card-item--drag-before', 'divine-card-item--drag-after');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('divine-card-item--drag-before', 'divine-card-item--drag-after');
        if (!dragData) return;
        const { cardId: srcId, sourceGroup: srcGroup } = dragData;
        if (srcId === card.id) return;
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;
        handleDivineDrop(srcId, srcGroup, group, card.id, insertBefore);
      });

      // 拖拽手柄图标
      const handle = document.createElement('span');
      handle.className = 'divine-card-item__handle';
      handle.textContent = '⋮⋮';
      handle.draggable = false;
      item.appendChild(handle);

      // 卡牌名称
      const nameEl = document.createElement('span');
      nameEl.className = 'divine-card-item__name';
      nameEl.textContent = card.name;
      nameEl.draggable = false;
      item.appendChild(nameEl);

      // 灵咒标签（占卜揭示了灵咒归属）
      if (card.curses && card.curses.length) {
        const cursesEl = document.createElement('span');
        cursesEl.className = 'divine-card-item__curses';
        cursesEl.draggable = false;
        card.curses.forEach(c => {
          const tag = document.createElement('span');
          tag.className = 'divine-curse-tag';
          tag.textContent = '⛓️' + c.name + '×' + c.layers;
          cursesEl.appendChild(tag);
        });
        item.appendChild(cursesEl);
      }

      return item;
    }

    /** 处理拖拽放置：将 srcId 从 srcGroup 移到 dstGroup，插入到 targetId 之前或之后 */
    function handleDivineDrop(srcId, srcGroup, dstGroup, targetId, insertBefore) {
      if (!divineContext) return;
      const srcArr = srcGroup === 'top' ? divineContext.topGroup : divineContext.bottomGroup;
      const dstArr = dstGroup === 'top' ? divineContext.topGroup : divineContext.bottomGroup;
      const srcIdx = srcArr.findIndex(c => c.id === srcId);
      if (srcIdx === -1) return;
      const [card] = srcArr.splice(srcIdx, 1);
      // 如果同组且目标在源之后（且源已被移除），需要调整索引
      let targetIdx = dstArr.findIndex(c => c.id === targetId);
      if (targetIdx === -1) { dstArr.push(card); renderDivineLists(); return; }
      if (srcGroup === dstGroup && srcIdx < targetIdx) {
        targetIdx -= 1; // 源移除后目标索引左移
      }
      const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
      dstArr.splice(insertIdx, 0, card);
      renderDivineLists();
    }

    /** 为空的拖放区域绑定事件（允许拖到空白处追加到末尾） */
    function setupDivineDropZone(listEl, group) {
      listEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        listEl.classList.add('divine-section__body--drag-over');
      });
      listEl.addEventListener('dragleave', (e) => {
        if (e.target === listEl) listEl.classList.remove('divine-section__body--drag-over');
      });
      listEl.addEventListener('drop', (e) => {
        e.preventDefault();
        listEl.classList.remove('divine-section__body--drag-over');
        if (!dragData) return;
        // 只有当直接拖到空白区域（不是某个item上）时才追加到末尾
        if (e.target === listEl || e.target.classList.contains('divine-section__body')) {
          const { cardId: srcId, sourceGroup: srcGroup } = dragData;
          if (srcGroup === group) return; // 同组拖到空白区，无变化
          handleDivineDropToEnd(srcId, srcGroup, group);
        }
      });
    }

    function handleDivineDropToEnd(srcId, srcGroup, dstGroup) {
      if (!divineContext || srcGroup === dstGroup) return;
      const srcArr = srcGroup === 'top' ? divineContext.topGroup : divineContext.bottomGroup;
      const dstArr = dstGroup === 'top' ? divineContext.topGroup : divineContext.bottomGroup;
      const srcIdx = srcArr.findIndex(c => c.id === srcId);
      if (srcIdx === -1) return;
      const [card] = srcArr.splice(srcIdx, 1);
      dstArr.push(card);
      renderDivineLists();
    }

    // ── 手机端：触摸拖动占卜卡牌排序（HTML5 拖拽在触屏上不可用） ──
    const DIVINE_MQ = window.matchMedia('(max-width: 768px)');
    let _divineDrag = null;
    let _divineDragRaf = null;
    function _divineDragClear() {
      if (_divineDrag && _divineDrag.ghost) _divineDrag.ghost.remove();
      _divineDrag = null;
      if (_divineDragRaf) { cancelAnimationFrame(_divineDragRaf); _divineDragRaf = null; }
      document.querySelectorAll('.divine-card-item--dragging').forEach(x => x.classList.remove('divine-card-item--dragging'));
      document.querySelectorAll('.divine-card-item--drag-before, .divine-card-item--drag-after, .divine-card-item--drag-over').forEach(x => {
        x.classList.remove('divine-card-item--drag-before', 'divine-card-item--drag-after', 'divine-card-item--drag-over');
      });
      document.querySelectorAll('.divine-section__body--drag-over').forEach(x => x.classList.remove('divine-section__body--drag-over'));
    }
    divineMain.addEventListener('pointerdown', function(e) {
      if (!DIVINE_MQ.matches) return;
      const item = e.target.closest ? e.target.closest('.divine-card-item') : null;
      if (!item) return;
      _divineDragClear();
      _divineDrag = {
        srcId: item.dataset.cardId, srcGroup: item.dataset.group,
        pointerId: e.pointerId, dragging: false, ghost: null,
        startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      };
    }, true);
    if (!window._divineMobileDragBound) {
      window._divineMobileDragBound = true;
      document.addEventListener('pointermove', function(e) {
        if (!_divineDrag || e.pointerId !== _divineDrag.pointerId) return;
        if (!_divineDrag.dragging) {
          if (Math.hypot(e.clientX - _divineDrag.startX, e.clientY - _divineDrag.startY) < 10) return;
          _divineDrag.dragging = true;
          const src = document.querySelector('.divine-card-item[data-card-id="' + _divineDrag.srcId + '"]');
          if (src) {
            src.classList.add('divine-card-item--dragging');
            const ghost = src.cloneNode(true);
            ghost.classList.remove('divine-card-item--dragging', 'divine-card-item--drag-before', 'divine-card-item--drag-after', 'divine-card-item--drag-over');
            ghost.style.cssText = 'position:fixed;left:0;top:0;width:' + src.offsetWidth + 'px;z-index:2500;pointer-events:none;opacity:0.92;transform:translate3d(0,0,0);will-change:transform;';
            document.body.appendChild(ghost);
            _divineDrag.ghost = ghost;
          }
        }
        if (!_divineDrag.ghost) return;
        _divineDrag.lastX = e.clientX;
        _divineDrag.lastY = e.clientY;
        if (!_divineDragRaf) {
          _divineDragRaf = requestAnimationFrame(function() {
            _divineDragRaf = null;
            if (!_divineDrag || !_divineDrag.ghost) return;
            _divineDrag.ghost.style.transform = 'translate3d(' + (_divineDrag.lastX + 10) + 'px,' + (_divineDrag.lastY + 10) + 'px,0)';
            // 高亮插入位置（黄线）
            document.querySelectorAll('.divine-card-item--drag-before, .divine-card-item--drag-after, .divine-card-item--drag-over, .divine-section__body--drag-over').forEach(x => {
              x.classList.remove('divine-card-item--drag-before', 'divine-card-item--drag-after', 'divine-card-item--drag-over', 'divine-section__body--drag-over');
            });
            const el = document.elementFromPoint(_divineDrag.lastX, _divineDrag.lastY);
            const item = el ? el.closest('.divine-card-item') : null;
            if (item && item.dataset.cardId !== _divineDrag.srcId) {
              const r = item.getBoundingClientRect();
              item.classList.add(_divineDrag.lastY < r.top + r.height / 2 ? 'divine-card-item--drag-before' : 'divine-card-item--drag-after');
            } else if (el && el.closest('.divine-section__body')) {
              el.closest('.divine-section__body').classList.add('divine-section__body--drag-over');
            }
          });
        }
      }, true);
      document.addEventListener('pointerup', function(e) {
        if (!_divineDrag || e.pointerId !== _divineDrag.pointerId) return;
        const d = _divineDrag;
        const wasDragging = d.dragging;
        _divineDragClear();
        if (!wasDragging) return;
        // 放置：落点在卡牌上则插入，否则跨组追加到空白组末尾
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const item = el ? el.closest('.divine-card-item') : null;
        const srcIdNum = parseInt(d.srcId, 10);   // dataset 存的是字符串，排序函数按数字比较
        if (item && item.dataset.cardId !== d.srcId) {
          const r = item.getBoundingClientRect();
          const insertBefore = e.clientY < r.top + r.height / 2;
          handleDivineDrop(srcIdNum, d.srcGroup, item.dataset.group, parseInt(item.dataset.cardId, 10), insertBefore);
        } else {
          const body = el ? el.closest('.divine-section__body') : null;
          if (body) {
            const dstGroup = body === divineTopList ? 'top' : 'bottom';
            handleDivineDropToEnd(srcIdNum, d.srcGroup, dstGroup);
          }
        }
      }, true);
      document.addEventListener('pointercancel', function(e) {
        if (!_divineDrag || e.pointerId !== _divineDrag.pointerId) return;
        _divineDragClear();
      }, true);
    }

    // 初始化两个拖放区域（允许跨组拖拽到空白处）
    setupDivineDropZone(divineTopList, 'top');
    setupDivineDropZone(divineBottomList, 'bottom');

    /** 确认占卜：将两组卡牌应用到真实牌库 */
    function confirmDivine() {
      if (!divineContext) return;
      const { playerId, topGroup, bottomGroup, x } = divineContext;
      const state = getPlayerCardState(playerId);
      // 从真实牌库中找到并移除占卜的X张牌（按id匹配）
      const divineIds = new Set();
      topGroup.forEach(c => divineIds.add(c.id));
      bottomGroup.forEach(c => divineIds.add(c.id));
      const remaining = state.deck.filter(c => !divineIds.has(c.id));
      // 重建牌库：顶部组（新顺序） + 剩余牌库 + 底部组（新顺序）
      // 同时把灵咒变更同步回真实卡牌
      const mergedTop = topGroup.map(tc => {
        const real = state.deck.find(rc => rc.id === tc.id);
        if (real) { real.curses = tc.curses; return real; }
        return tc;
      });
      const mergedBottom = bottomGroup.map(bc => {
        const real = state.deck.find(rc => rc.id === bc.id);
        if (real) { real.curses = bc.curses; return real; }
        return bc;
      });
      state.deck = [...mergedTop, ...remaining, ...mergedBottom];
      const savedOpId = divineContext.operatorId || playerId;
      const savedX = divineContext.x;
      divineContext = null;
      closeDivineDialog(false);
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId); else syncDeckState(playerId);
      const topNames = topGroup.map(c => c.name).join('、') || '（无）';
      const bottomNames = bottomGroup.map(c => c.name).join('、') || '（无）';
      const topCount = topGroup.length;
      const bottomCount = bottomGroup.length;
      const playerName = getPlayerName(playerId);
      const opId = savedOpId;
      const isHelp = opId !== playerId;
      const opName = getPlayerName(opId);
      const xVal = savedX;

      // 操作者和牌主自己看到详细信息（牌名）
      const prefix = isHelp ? `【系统】${opName}完成了对${playerName}的占卜${xVal}` : `【系统】${playerName}完成了占卜`;
      addSystemChatMessage(`${prefix} —— 牌库顶：[${topNames}]，牌库底：[${bottomNames}]`);

      // 其他人（对手/观众）看到摘要信息（只有数量，不知道牌名）
      if (!isSoloMode && isConnected() && typeof sendToPeer === 'function') {
        const topWord = topCount > 0 ? `${topCount}张` : '0张';
        const bottomWord = bottomCount > 0 ? `${bottomCount}张` : '0张';
        const summaryPrefix = isHelp ? `【系统】${opName}完成了对${playerName}的占卜${xVal}` : `【系统】${playerName}完成了占卜${xVal}`;
        const summaryMsg = `${summaryPrefix}，将${topWord}牌放在了牌库顶，将${bottomWord}牌放在了牌库底`;
        sendToPeer({ type: 'sysmsg', text: summaryMsg });
      }
    }

    /** 关闭占卜对话框（cancel=true 仅提示取消，不删除已揭示记录） */
    function closeDivineDialog(cancel) {
      if (divineContext) {
        const playerName = getPlayerName(divineContext.playerId);
        // 已占卜揭示的牌保持可见（只要不洗牌库，被看过的牌应一直带标签）
        divineContext = null;
        if (cancel) broadcastSystemMsg(`【系统】${playerName}取消了占卜`);
      }
      divineOverlay.hidden = true;
      divineXRow.hidden = false;
      divineMain.hidden = true;
      divineActions.hidden = true;
      // 恢复取消按钮（下次打开占卜输入时可取消）
      const divineCancelBtn = document.getElementById('divine-cancel');
      if (divineCancelBtn) divineCancelBtn.disabled = false;
      // 清空弹窗内容，下次打开是干净的
      divineTopList.innerHTML = '';
      divineBottomList.innerHTML = '';
      divineXInput.value = '3';
    }

    // 绑定占卜对话框按钮事件
    document.getElementById('divine-confirm').addEventListener('click', confirmDivine);
    document.getElementById('divine-cancel').addEventListener('click', () => closeDivineDialog(true));

    // 不再通过点击遮罩关闭（与其他弹窗行为一致）

    // Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !divineOverlay.hidden) {
        if (!divineMain.hidden) closeDivineDialog(true);
      }
    });

    function importDeck(playerId, text) {
      const rawNames = parseCardLines(text);
      if (!rawNames.length) return;
      // 支持【式神名】区段：区段内未命中的牌优先在玩家库中匹配该式神
      // 支持重复写法：卡名x2 / 卡名X9（x 与 X 均可）＝导入多张
      const myPid = (typeof localPlayerId !== 'undefined' && localPlayerId) ? String(localPlayerId) : '1';
      let sectionOwner = '';
      let unresolved = 0;
      const names = [];
      rawNames.forEach(function(tok) {
        const sec = tok.match(/^【(.+)】$/);
        if (sec) { sectionOwner = sec[1].trim(); return; }
        // 解析「卡名xN」：无 x/X 后缀时就是 1 张
        const m = tok.match(/^(.+?)[xX](\d{1,2})$/);
        const cardName = m ? m[1].trim() : tok;
        let qty = 1;
        if (m) {
          qty = parseInt(m[2], 10);
          if (Number.isNaN(qty) || qty < 1) qty = 1;
          if (qty > 99) qty = 99;
        }
        let resolved = (typeof CardDB !== 'undefined' && CardDB.isOfficialName) ? CardDB.isOfficialName(cardName) : false;
        if (!resolved && typeof CardDB !== 'undefined' && CardDB.findInPlayerLib) {
          resolved = !!CardDB.findInPlayerLib(myPid, cardName, sectionOwner);
        }
        if (!resolved) unresolved += qty;
        for (let i = 0; i < qty; i++) names.push(cardName);
      });
      const cards = shuffleCards(names.map(name => createCard(name)));
      getPlayerCardState(playerId).deck.push(...cards);
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      let msg = `【系统】${getPlayerName(playerId)}导入了卡组（${cards.length}张）`;
      if (unresolved > 0) msg += `；其中 ${unresolved} 张未在官方库与你的卡库中找到（按无归属导入）`;
      broadcastSystemMsg(msg);
    }

    function addToHand(playerId, text, qty) {
      const name = text.trim();
      if (!name) return;
      const count = Math.max(1, qty || 1);
      for (let i = 0; i < count; i++) {
        pushCardToHand(playerId, createCard(name));
      }
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      broadcastSystemMsg(`【系统】${getPlayerName(playerId)}将${count}张「${name}」置入了手牌`);
      // 飞行动画
      if (typeof CardFlight !== 'undefined') {
        const addBtn = CardFlight.getPlayerBtn(playerId, 'addHand');
        const handBtn = CardFlight.getPlayerBtn(playerId, 'hand');
        if (addBtn) {
          const r = addBtn.getBoundingClientRect();
          const srcY = playerId === '2' ? r.top - 150 : r.bottom + 150;
          CardFlight.flySeqAndBroadcast(playerId, count, 'addHand', { x: r.left + r.width / 2, y: srcY }, 'hand', { interval: 0.18, arcHeight: 60 });
        }
      }
    }

    /** 计算卡牌当前有效的堆叠上限：卡牌自带 > 效果面板规则 > 数据库默认 */
    function getCardMaxStack(playerId, card) {
      if (!card || !card.name) return 0;
      // 1) 卡牌对象已带上限（之前入手/效果改过）
      if (card._maxStack > 0) return card._maxStack;
      // 2) 效果面板规则「堆叠上限：卡牌名」
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (zone) {
        let limit = 0;
        zone.querySelectorAll('.effect-item').forEach(function(item) {
          const name = (item.querySelector('.effect-name')?.value || '').trim();
          const m = name.match(/^堆叠上限[：:](.+)$/);
          if (!m || m[1].trim() !== card.name) return;
          const rawVal = (item.querySelector('.effect-value')?.value || '').trim();
          if (!rawVal) return;
          const val = parseInt(rawVal, 10);
          if (!Number.isNaN(val) && val >= 1) limit = val;
        });
        if (limit > 0) return limit;
      }
      // 3) 数据库默认
      const db = (typeof CardDB !== 'undefined' && CardDB.lookup) ? CardDB.lookup(card.name) : null;
      return (db && db.maxStack) ? db.maxStack : 0;
    }

    /** 将卡牌置入手牌，自动处理最大堆叠 */
    function pushCardToHand(playerId, card, fromShop) {
      if (!card || !card.name) return;
      const state = getPlayerCardState(playerId);
      const maxStack = getCardMaxStack(playerId, card);

      if (maxStack > 0) {
        // 从商店购买时，卡牌本身可能已有层数
        const incomingStack = card._stack || 1;
        let remaining = incomingStack;

        // 先尝试填充手牌中已有的同名牌堆叠
        const existing = state.hand.filter(hc => hc.name === card.name && (hc._stack || 0) < maxStack);
        for (const hc of existing) {
          if (remaining <= 0) break;
          const space = maxStack - (hc._stack || 1);
          const add = Math.min(remaining, space);
          hc._stack = (hc._stack || 1) + add;
          hc._maxStack = maxStack;
          remaining -= add;
        }

        // 剩余的创建新堆叠
        while (remaining > 0) {
          const stack = Math.min(remaining, maxStack);
          const newCard = createCard(card.name);
          newCard._stack = stack;
          newCard._maxStack = maxStack;
          newCard._shop = card._shop || false;
          state.hand.push(newCard);
          remaining -= stack;
        }
      } else {
        // 无堆叠：直接加入
        state.hand.push(card);
      }
    }

    function addToDeck(playerId, text, qty, placement) {
      const name = text.trim();
      if (!name) return;
      const count = Math.max(1, qty || 1);
      const deck = getPlayerCardState(playerId).deck;
      for (let i = 0; i < count; i++) {
        const card = createCard(name);
        if (placement === 'top') deck.unshift(card);
        else if (placement === 'bottom') deck.push(card);
        else insertCardAtRandomPosition(deck, card);
      }
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);
      const placeLabel = placement === 'top' ? '牌库顶' : (placement === 'bottom' ? '牌库底' : '牌库随机位置');
      broadcastSystemMsg(`【系统】${getPlayerName(playerId)}将${count}张「${name}」置入了${placeLabel}`);
      // 飞行动画
      if (typeof CardFlight !== 'undefined') {
        const addDeckBtn = CardFlight.getPlayerBtn(playerId, 'addDeck');
        const deckBtn = CardFlight.getPlayerBtn(playerId, 'deck');
        if (addDeckBtn) {
          const r = addDeckBtn.getBoundingClientRect();
          const srcY = playerId === '2' ? r.top - 150 : r.bottom + 150;
          CardFlight.flySeqAndBroadcast(playerId, count, 'addDeck', { x: r.left + r.width / 2, y: srcY }, 'deck', { interval: 0.18, arcHeight: 60 });
        }
      }
    }

    function handleDeckAction(playerId, action) {
      const playerName = getPlayerName(playerId);
      switch (action) {
        case 'draw':
          drawCard(playerId);
          break;
        case 'hand':
          try { openCardListDialog({ title: `${playerName} 的手牌`, playerId, type: 'hand' }); }
          catch (e) { console.error('[DeckAction] 打开手牌失败:', e); }
          break;
        case 'add-hand':
          openCardTextDialog({
            title: `${playerName} 置入手牌`,
            placeholder: '输入卡牌名称…',
            multiline: false,
            onConfirm: (text, qty) => addToHand(playerId, text, qty),
          });
          break;
        case 'import-deck':
          openCardTextDialog({
            title: `${playerName} 导入卡组`,
            placeholder: '在这里输入或粘贴要导入的卡组…',
            multiline: true,
            hideQuantity: true,
            showHelp: true,
            onConfirm: (text) => importDeck(playerId, text),
          });
          break;
        case 'deck':
          try { openCardListDialog({ title: `${playerName} 的牌库`, playerId, type: 'deck' }); }
          catch (e) { console.error('[DeckAction] 打开牌库失败:', e); }
          break;
        case 'add-deck':
          openCardTextDialog({
            title: `${playerName} 置入牌库`,
            placeholder: '输入卡牌名称…',
            multiline: false,
            deckPlacement: true,
            onConfirm: (text, qty, level, placement) => addToDeck(playerId, text, qty, placement),
          });
          break;
        case 'shuffle-deck':
          // 二次确认，防止误点
          if (window.confirm('确定要洗牌吗？\n洗牌后，已占卜/命运抉择揭示的牌会重新变回未知。')) {
            shuffleDeck(playerId);
          }
          break;
        case 'divine':
          openDivineXPrompt(playerId);
          break;
        default:
          break;
      }
    }

    document.querySelectorAll('.player-zone').forEach(zone => {
      const playerId = zone.dataset.player;
      zone.querySelectorAll('.btn-deck').forEach(btn => {
        btn.addEventListener('click', () => handleDeckAction(playerId, btn.dataset.action));
      });
    });

    document.getElementById('card-text-dialog-cancel').addEventListener('click', closeCardTextDialog);
    document.getElementById('card-text-dialog-confirm').addEventListener('click', confirmCardTextDialog);
    // 导入格式说明抽屉：按钮打开 / ✕与遮罩关闭 / Esc关闭
    (function() {
      const helpBtn = document.getElementById('card-text-help-btn');
      const ov = document.getElementById('import-help-overlay');
      const closeBtn = document.getElementById('import-help-close');
      if (helpBtn) helpBtn.addEventListener('click', () => { if (ov) ov.hidden = false; });
      if (closeBtn) closeBtn.addEventListener('click', () => { if (ov) ov.hidden = true; });
      if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) ov.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov && !ov.hidden) ov.hidden = true; });
    })();
    // 置入牌库放置按钮（顶/底/随机）与取消
    document.querySelectorAll('.card-text-placement-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!cardTextContext || !cardTextContext.deckPlacement) return;
        const value = cardTextInput.value;
        if (!value.trim()) { closeCardTextDialog(); return; }
        const qtyEl = document.getElementById('card-text-dialog-quantity');
        let qty = parseInt(qtyEl ? qtyEl.value : '1', 10);
        if (isNaN(qty) || qty < 1) qty = 1;
        cardTextContext.onConfirm(value, qty, 1, btn.dataset.placement);
        closeCardTextDialog();
      });
    });
    document.querySelector('.card-text-placement-cancel').addEventListener('click', closeCardTextDialog);
    document.getElementById('card-list-dialog-close').addEventListener('click', closeCardListDialog);

    // 蓄力使用切换按钮
    const chargeToggleBtn = document.getElementById('card-list-charge-toggle');
    let chargeBtnsVisible = false;
    const MOBILE_HAND_MQ = window.matchMedia('(max-width: 768px)');
    let _mobileHandMode = '';   // 手机端互斥模式：'' / charge / renyin / discard / todeck / tooracle

    /** 按当前模式统一设置每张牌的按钮显隐（手机/电脑端同为互斥模式） */
    function _applyMobileHandMode() {
      document.querySelectorAll('.card-list-item__actions .btn-card-action, .card-list-item__actions .btn-card-move-oracle, .card-list-item__actions .btn-card-curse-add').forEach(btn => {
        if (btn.classList.contains('btn-card-use') || btn.classList.contains('btn-card-curse-add')) { btn.hidden = false; return; }
        if (_mobileHandMode === 'discard') btn.hidden = !btn.classList.contains('btn-card-discard');
        else if (_mobileHandMode === 'redraw') btn.hidden = !btn.classList.contains('btn-card-redraw');
        else if (_mobileHandMode === 'todeck') btn.hidden = !btn.classList.contains('btn-card-to-deck');
        else if (_mobileHandMode === 'tooracle') btn.hidden = !btn.classList.contains('btn-card-move-oracle');
        else if (_mobileHandMode === 'charge') btn.hidden = !(btn.dataset.chargeBtn === 'true');
        else if (_mobileHandMode === 'renyin') btn.hidden = !(btn.dataset.renyinBtn === 'true');
        else btn.hidden = true;
      });
      document.querySelectorAll('.hand-toggle-btn').forEach(b => {
        b.classList.toggle('active', _mobileHandMode === b.dataset.handMode);
      });
      if (chargeToggleBtn) chargeToggleBtn.classList.toggle('active', _mobileHandMode === 'charge');
      if (renyinToggleBtn) renyinToggleBtn.classList.toggle('active', _mobileHandMode === 'renyin');
    }

    /** 互斥切换（再点一次取消），手机/电脑端通用 */
    function _setHandActionMode(mode) {
      _mobileHandMode = (_mobileHandMode === mode) ? '' : mode;
      _applyMobileHandMode();
      _refreshCardListBtnTexts();
    }

    /** 按钮文字：手机端去掉 emoji 图标，电脑端保留 */
    function _refreshCardListBtnTexts() {
      const isMobile = MOBILE_HAND_MQ.matches;
      if (chargeToggleBtn) chargeToggleBtn.textContent = isMobile ? ('蓄力使用' + (_mobileHandMode === 'charge' ? ' ✓' : '')) : ('🔋 蓄力使用' + (_mobileHandMode === 'charge' ? ' ✓' : ''));
      if (renyinToggleBtn) renyinToggleBtn.textContent = isMobile ? ('连引使用' + (_mobileHandMode === 'renyin' ? ' ✓' : '')) : ('🔗 连引使用' + (_mobileHandMode === 'renyin' ? ' ✓' : ''));
      const initBtn = document.getElementById('card-list-initial-hand-btn');
      if (initBtn) initBtn.textContent = isMobile ? '初始手牌' : '🎴 初始手牌';
      const bcr = document.getElementById('btn-curse-random');
      if (bcr) bcr.textContent = isMobile ? '随机结附灵咒' : '🎲 随机结附灵咒';
      const bct = document.getElementById('btn-curse-toggle');
      if (bct) bct.textContent = (typeof curseRandomRepeat !== 'undefined' && curseRandomRepeat) ? (isMobile ? '全随机' : '🔁 全随机') : (isMobile ? '优先不重复' : '🔄 优先不重复');
    }

    // 互斥开关：调度 / 弃置 / 置入牌库 / 置入启悟区（手机/电脑端通用）
    document.querySelectorAll('.hand-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.handMode === 'tooracle') {
          const pid = cardListContext ? cardListContext.playerId : (localPlayerId || '1');
          if (!(typeof oracleActive !== 'undefined' && oracleActive[pid])) {
            if (typeof addSystemChatMessage === 'function') addSystemChatMessage('【系统】启悟机制未激活，无法置入启悟区');
            return;
          }
        }
        _setHandActionMode(btn.dataset.handMode);
      });
    });

    window.resetChargeToggle = function() {
      chargeBtnsVisible = false;
      _mobileHandMode = '';
      _refreshCardListBtnTexts();
      _applyMobileHandMode();
    };
    window.reapplyChargeToggle = function() {
      _applyMobileHandMode();
    };
    if (chargeToggleBtn) {
      chargeToggleBtn.style.background = 'linear-gradient(180deg,#3a2a10,#2a1a08)';
      chargeToggleBtn.style.color = '#c0a060';
      chargeToggleBtn.style.borderColor = 'rgba(200,160,60,0.4)';
      chargeToggleBtn.addEventListener('click', () => { _setHandActionMode('charge'); });
    }

    // 连引使用切换按钮
    const renyinToggleBtn = document.getElementById('card-list-renyin-toggle');
    let renyinBtnsVisible = false;
    if (renyinToggleBtn) {
      // 初始样式
      renyinToggleBtn.style.background = 'linear-gradient(180deg,#4a3a6a,#3a2a5a)';
      renyinToggleBtn.style.color = '#c0b0e0';
      renyinToggleBtn.addEventListener('click', () => { _setHandActionMode('renyin'); });
    }

    // 随机结附灵咒
    let curseRandomRepeat = false; // false=优先不重复, true=全随机
    document.getElementById('btn-curse-toggle').addEventListener('click', function() {
      curseRandomRepeat = !curseRandomRepeat;
      _refreshCardListBtnTexts();
    });

    document.getElementById('btn-curse-random').addEventListener('click', () => {
      if (!cardListContext) return;
      const name = document.getElementById('curse-random-input').value.trim();
      if (!name) return;
      const { playerId, type } = cardListContext;
      const state = getPlayerCardState(playerId);
      const cards = type === 'hand' ? state.hand : state.deck;
      if (!cards.length) return;
      let pool;
      if (curseRandomRepeat) {
        pool = cards;
      } else {
        const without = cards.filter(c => !(c.curses || []).some(cur => cur.name === name));
        pool = without.length ? without : cards;
      }
      const target = pool[Math.floor(Math.random() * pool.length)];
      if (!target.curses) target.curses = [];
      const existing = target.curses.find(c => c.name === name);
      if (existing) { existing.layers += 1; }
      else { target.curses.push({ name, layers: 1 }); }
      refreshOpenListDialog(playerId);
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId); else syncDeckState(playerId);
      const loc = type === 'hand' ? '手牌中的' : '牌库中的';
      broadcastSystemMsg('【系统】' + getPlayerName(playerId) + '为' + loc + '一张牌随机结附了灵咒「' + name + '」×1');
    });

    // ================================================================
    //  牌表侧窗：按所属式神分组展示牌库内容
    // ================================================================
    function renderDeckBreakdown(playerId) {
      const state = getPlayerCardState(playerId);
      const deck = (state.deck || []).filter(c => c && typeof c === 'object');
      const viewerId = getViewerPlayerId();
      const revealedSet = playerRevealedCards[viewerId] || new Set();
      deckBreakdownBody.innerHTML = '';

      if (!deck.length) {
        deckBreakdownBody.innerHTML = '<div class="breakdown-empty">牌库为空</div>';
        return;
      }

      deckBreakdownTitle.textContent = `📋 牌表（${deck.length}张）`;

      // 按所属式神分组：{ owner: { cards: [{name, count, cardRef}] } }
      const ownerMap = new Map();
      deck.forEach(card => {
        const db = CardDB.lookup(card.name);
        const owner = (db && db.owner) ? db.owner : '无归属';
        if (!ownerMap.has(owner)) ownerMap.set(owner, new Map());
        const nameMap = ownerMap.get(owner);
        const existing = nameMap.get(card.name);
        if (existing) {
          existing.count += 1;
          existing.cards.push(card);
        } else {
          nameMap.set(card.name, { count: 1, cards: [card], name: card.name });
        }
      });

      // 排序：按式神名
      const sortedOwners = [...ownerMap.keys()].sort((a, b) => a.localeCompare(b, 'zh'));

      sortedOwners.forEach(owner => {
        const group = document.createElement('div');
        group.className = 'breakdown-owner-group';

        const header = document.createElement('div');
        header.className = 'breakdown-owner-group__header';
        const totalInGroup = [...ownerMap.get(owner).values()].reduce((s, e) => s + e.count, 0);
        header.textContent = `▼ ${owner}（${totalInGroup}）`;
        group.appendChild(header);

        const nameMap = ownerMap.get(owner);
        const sortedNames = [...nameMap.keys()].sort((a, b) => a.localeCompare(b, 'zh'));

        sortedNames.forEach(name => {
          const entry = nameMap.get(name);
          const sampleCard = entry.cards[0];
          const isRevealed = revealedSet.has(sampleCard.id);
          const row = document.createElement('div');
          row.className = 'breakdown-card-row';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'breakdown-card-row__name';
          // 自己的牌表全部可见；对手的牌表仅揭示牌可见
          const showName = isViewingOwnCards(playerId) || isRevealed;
          nameSpan.textContent = showName ? name : '未知';
          if (!showName) {
            nameSpan.style.color = 'var(--text-muted, #888)';
            nameSpan.style.cursor = 'default';
          }
          // 食材牌/佳肴：存储数据供浮窗显示
          if (showName && sampleCard._food) {
            nameSpan.dataset.food = JSON.stringify(sampleCard);
          }
          row.appendChild(nameSpan);

          // 数量
          if (entry.count > 1) {
            const countSpan = document.createElement('span');
            countSpan.className = 'breakdown-card-row__count';
            countSpan.textContent = '×' + entry.count;
            row.appendChild(countSpan);
          }

          // 已揭示时显示灵咒
          if (isRevealed && sampleCard.curses && sampleCard.curses.length) {
            const cursesSpan = document.createElement('span');
            cursesSpan.className = 'breakdown-card-row__curses';
            sampleCard.curses.forEach(c => {
              const tag = document.createElement('span');
              tag.className = 'breakdown-card-row__curse-tag';
              tag.textContent = '⛓️' + c.name + '×' + c.layers;
              cursesSpan.appendChild(tag);
            });
            row.appendChild(cursesSpan);
          }

          // 弃牌按钮（仅自己牌表可见）
          if (isViewingOwnCards(playerId)) {
            const discardBtn = document.createElement('button');
            discardBtn.type = 'button';
            discardBtn.className = 'btn-card-action btn-card-discard';
            discardBtn.textContent = '弃牌';
            discardBtn.style.cssText = 'font-size:10px;padding:2px 6px;flex-shrink:0;';
            discardBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              discardFromDeckByName(playerId, name);
            });
            row.appendChild(discardBtn);
          }

          group.appendChild(row);
        });

        deckBreakdownBody.appendChild(group);
      });
    }

    function refreshDeckBreakdown(playerId) {
      if (deckBreakdownPanel.hidden) return;
      if (!cardListContext || cardListContext.playerId !== playerId) return;
      if (cardListContext.type !== 'deck') return;
      renderDeckBreakdown(playerId);
    }

    // 牌表按钮：切换侧窗
    cardListBreakdownBtn.addEventListener('click', () => {
      if (!cardListContext || cardListContext.type !== 'deck') return;
      const wasHidden = deckBreakdownPanel.hidden;
      deckBreakdownPanel.hidden = !wasHidden;
      if (!wasHidden) {
        deckBreakdownBody.innerHTML = '';
      } else {
        // 应用当前拖拽偏移，让牌表出现在牌库旁边
        if (cardListDragOffset.x !== 0 || cardListDragOffset.y !== 0) {
          deckBreakdownPanel.style.transform = `translate(${cardListDragOffset.x}px, ${cardListDragOffset.y}px)`;
          deckBreakdownPanel.style.transition = 'none';
        }
        renderDeckBreakdown(cardListContext.playerId);
      }
      cardListBreakdownBtn.textContent = deckBreakdownPanel.hidden ? '📋 查看牌表' : '📋 隐藏牌表';
    });

    deckBreakdownClose.addEventListener('click', () => {
      deckBreakdownPanel.hidden = true;
      deckBreakdownBody.innerHTML = '';
      cardListBreakdownBtn.textContent = '📋 查看牌表';
    });

    // ================================================================
    //  烹饪系统 (Cooking)
    // ================================================================
    const FOOD_TYPES = ['山珍', '海味', '时蔬'];
    const FOOD_LEVEL_SUFFIX = { 1: '良', 2: '优', 3: '极' };
    const FOOD_EFFECTS = {
      '山珍': { 1: '+1力量', 2: '+2力量', 3: '+3力量' },
      '海味': { 1: '+1生命', 2: '+2生命', 3: '+3生命' },
      '时蔬': { 1: ['昂扬'], 2: ['昂扬', '贯通'], 3: ['昂扬', '贯通', '迅捷'] },
    };
    const FOOD_TYPE_ICONS = { '山珍': '🍄', '海味': '🐟', '时蔬': '🥬', '佳肴': '🍲' };

    /** 判断是否为食材牌（不含佳肴） */
    function isFoodCard(card) {
      return card && card._food && card._foodType !== '佳肴';
    }

    /** 判断是否为佳肴 */
    function isFeastCard(card) {
      return card && card._food && card._foodType === '佳肴';
    }

    /** 判断任意食物牌（食材或佳肴） */
    function isAnyFoodCard(card) {
      return card && card._food;
    }

    /** 生成食物卡备注（隐藏数据，随系统消息传递，不展示；供悬浮窗实时生成真实效果） */
    window.getFoodNote = function(card) {
      if (!isAnyFoodCard(card)) return null;
      return {
        name: card.name,
        _food: true,
        _foodType: card._foodType,
        _foodLevel: card._foodLevel,
        _foodEffects: card._foodEffects || [],
        _foodIngredients: card._foodIngredients || '',
      };
    };

    /** 根据式神等级生成一张随机食材牌 */
    function generateFoodCard(level) {
      const lv = (level >= 1 && level <= 3) ? level : 1;
      const type = FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)];
      const suffix = FOOD_LEVEL_SUFFIX[lv] || '良';
      const name = type + '·' + suffix;
      let effectDesc;
      if (type === '时蔬') {
        const pool = FOOD_EFFECTS[type][lv] || FOOD_EFFECTS[type][1];
        effectDesc = pool[Math.floor(Math.random() * pool.length)];
      } else {
        effectDesc = FOOD_EFFECTS[type][lv] || FOOD_EFFECTS[type][1];
      }
      return {
        id: ++cardIdCounter,
        name: name,
        curses: [],
        _food: true,
        _foodType: type,
        _foodLevel: lv,
        _foodEffects: [effectDesc],
      };
    }

    /** 确定式神等级：从卡牌槽左上角 .card-level 读取 */
    function getShikigamiLevel(slot) {
      if (!slot) return 1;
      const levelInput = slot.querySelector('.card-level');
      if (levelInput) {
        const val = parseInt(levelInput.value, 10);
        if (val >= 1 && val <= 3) return val;
      }
      return 1;
    }

    /** 将3张食材牌合成为1张佳肴 */
    function synthesizeFood(playerId, cards) {
      const allEffects = [];
      cards.forEach(c => {
        if (c._foodEffects) allEffects.push(...c._foodEffects);
      });
      const nameCounts = new Map();
      cards.forEach(c => { nameCounts.set(c.name, (nameCounts.get(c.name) || 0) + 1); });
      const ingredients = [...nameCounts.entries()].map(([n, cnt]) => cnt > 1 ? `${n}×${cnt}` : n).join('、');
      return {
        id: ++cardIdCounter,
        name: '佳肴',
        curses: [],
        _food: true,
        _foodType: '佳肴',
        _foodLevel: 0,
        _foodEffects: allEffects,
        _foodIngredients: ingredients,
      };
    }

    /** 置入食材：选择式神 → 按等级置入一张食材牌（不检测三张合成佳肴） */
    function performInsertFood(slot) {
      const playerId = slot.dataset.slotPlayer;
      if (!playerId) return;
      const state = getPlayerCardState(playerId);
      if (!state) return;
      const cardName = (slot.querySelector('.card-name')?.value || '').trim();
      if (!cardName) return;
      const playerName = getPlayerName(playerId);
      const isMyOp = (typeof isMyZone === 'function') ? isMyZone(playerId) : true;

      // 置入食材专属特效动画（🥬🍖，与烹饪不同）
      if (typeof DamageEffects !== 'undefined' && DamageEffects.playInsertFoodEffect) {
        DamageEffects.playInsertFoodEffect(slot);
      }
      // 同步置入食材动画到对手/观众
      if (!isSoloMode && isConnected() && typeof sendToPeer === 'function') {
        sendToPeer({ type: 'cook-effect', kind: 'insertfood', playerId: slot.dataset.slotPlayer, slotIndex: slot.dataset.slotIndex });
      }

      // 确定式神等级，按等级生成食材牌
      const level = getShikigamiLevel(slot);
      const foodCard = generateFoodCard(level);
      pushCardToHand(playerId, foodCard);
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);

      if (typeof syncDeckStateForce === 'function') {
        syncDeckStateForce(playerId);
      } else {
        syncDeckState(playerId);
      }

      // 系统消息：自己看到详细，对手看到摘要
      const detailMsg = `【系统】${playerName}为「${cardName}」置入了一张食材牌「${foodCard.name}」`;
      const summaryMsg = `【系统】${playerName}为「${cardName}」置入了一张${level}级食材牌`;
      if (isMyOp) {
        addSystemChatMessage(detailMsg, window.getFoodNote ? window.getFoodNote(foodCard) : null);
        if (!isSoloMode && isConnected() && typeof sendToPeer === 'function') {
          sendToPeer({ type: 'sysmsg', text: summaryMsg });
        }
      } else {
        broadcastSystemMsg(summaryMsg);
      }
    }

    /** 执行烹饪：选择式神 → 获得食材牌 → 可能的佳肴合成 */
    function performCooking(slot) {
      const playerId = slot.dataset.slotPlayer;
      if (!playerId) return;
      const state = getPlayerCardState(playerId);
      if (!state) return;
      const cardName = (slot.querySelector('.card-name')?.value || '').trim();
      if (!cardName) return;
      const playerName = getPlayerName(playerId);
      const isMyOp = (typeof isMyZone === 'function') ? isMyZone(playerId) : true;

      // 烹饪特效动画（本地）
      if (typeof DamageEffects !== 'undefined' && DamageEffects.playCookEffect) {
        DamageEffects.playCookEffect(slot);
      }
      // 同步烹饪动画到对手/观众
      if (!isSoloMode && isConnected() && typeof sendToPeer === 'function') {
        sendToPeer({ type: 'cook-effect', playerId: slot.dataset.slotPlayer, slotIndex: slot.dataset.slotIndex });
      }

      // 确定式神等级（从卡牌槽左上角 .card-level 读取）
      const level = getShikigamiLevel(slot);

      // 生成食材牌
      const foodCard = generateFoodCard(level);
      pushCardToHand(playerId, foodCard);
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);

      // 联机同步：需要跨玩家强制同步
      if (typeof syncDeckStateForce === 'function') {
        syncDeckStateForce(playerId);
      } else {
        syncDeckState(playerId);
      }

      // 系统消息：自己看到详细，对手看到摘要
      const detailMsg = `【系统】${playerName}使「${cardName}」进行了一次烹饪，获得了「${foodCard.name}」`;
      const summaryMsg = `【系统】${playerName}使「${cardName}」进行了一次烹饪，获得了一张${level}级食材牌`;
      if (isMyOp) {
        // 我为自己烹饪：我看到详细，对手看到摘要
        addSystemChatMessage(detailMsg, window.getFoodNote ? window.getFoodNote(foodCard) : null);
        if (!isSoloMode && isConnected() && typeof sendToPeer === 'function') {
          sendToPeer({ type: 'sysmsg', text: summaryMsg });
        }
      } else {
        // 我为对手烹饪：双方都看到摘要
        broadcastSystemMsg(summaryMsg);
      }

      // 检查手中是否有≥3张食材牌（不含佳肴），有则合成
      const foodCards = state.hand.filter(c => isFoodCard(c));
      if (foodCards.length >= 3) {
        const shuffled = [...foodCards].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, 3);
        // 安全移除：逐张匹配，双重验证 isFoodCard 防止误删
        selected.forEach(card => {
          const idx = state.hand.findIndex(hc => hc.id === card.id && isFoodCard(hc));
          if (idx !== -1) state.hand.splice(idx, 1);
        });
        const feast = synthesizeFood(playerId, selected);
        pushCardToHand(playerId, feast);
        updateDeckButtons(playerId);
        refreshOpenListDialog(playerId);
        if (typeof syncDeckStateForce === 'function') {
          syncDeckStateForce(playerId);
        } else {
          syncDeckState(playerId);
        }
        // 仅合成方注册佳肴到CardDB并可查看效果
        const detailFeast = `【系统】${playerName}将3张食材牌合成为「佳肴」`;
        const summaryFeast = `【系统】${playerName}将3张食材牌合成为佳肴（不可查看）`;
        if (isMyOp) {
          // 注册佳肴到CardDB，使「佳肴」可悬浮查看
          if (typeof CardDB !== 'undefined' && typeof CardDB.addCustom === 'function') {
            const ingredientText = feast._foodIngredients ? '由' + feast._foodIngredients + '合成' : '';
            const feastDef = {
              type: 'curse', name: '佳肴', owner: '中立',
              effect: ingredientText + '\n' + feast._foodEffects.join('\n'),
              _food: true, _foodType: '佳肴', _foodLevel: 0,
              _foodEffects: feast._foodEffects, _foodIngredients: feast._foodIngredients,
            };
            CardDB.addCustom(feastDef);
            // 同步佳肴定义给对方，使对方也能悬浮查看正确效果
            if (!isSoloMode && isConnected() && typeof sendToPeer === 'function') {
              sendToPeer({ type: 'food-card-register', card: feastDef });
            }
          }
          addSystemChatMessage(detailFeast, window.getFoodNote ? window.getFoodNote(feast) : null);
          if (!isSoloMode && isConnected() && typeof sendToPeer === 'function') {
            sendToPeer({ type: 'sysmsg', text: summaryFeast });
          }
        } else {
          broadcastSystemMsg(summaryFeast);
        }
      }
    }
    const dropdownToggle = document.getElementById('btn-dropdown-toggle');
    const dropdownMenu = document.getElementById('dropdown-other-menu');

    dropdownToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      // 互斥：关闭另一个下拉
      const mechanicMenu = document.getElementById('dropdown-mechanic-menu');
      if (mechanicMenu) mechanicMenu.hidden = true;
      dropdownMenu.hidden = !dropdownMenu.hidden;
    });

    document.addEventListener('click', () => {
      dropdownMenu.hidden = true;
    });

    dropdownMenu.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      if (!action) {
        // 设置/退出按钮（手机端移入菜单，无 data-action）：点击后关闭菜单
        if (e.target.id === 'game-btn-settings' || e.target.id === 'game-btn-exit') {
          dropdownMenu.hidden = true;
        }
        return;
      }
      // 观众只能使用式神录
      if (typeof isSpectator !== 'undefined' && isSpectator && action !== 'shikigami-book') return;
      dropdownMenu.hidden = true;
      switch (action) {
        case 'save-game':
          _handleSaveGame();
          break;
        case 'load-game':
          _handleLoadGame();
          break;
        case 'shikigami-book':
          openShikigamiBook();
          break;
        case 'debug-panel':
          if (typeof DebugPanel !== 'undefined') {
            DebugPanel.toggle();
          }
          break;
      }
    });

    // ================================================================
    //  命运抉择系统
    // ================================================================
    const fateOverlay = document.getElementById('fate-dialog-overlay');
    const fateSlotTop = document.getElementById('fate-slot-top');
    const fateSlotBottom = document.getElementById('fate-slot-bottom');
    const fateBtnStart = document.getElementById('fate-btn-start');
    const fateBtnSwap = document.getElementById('fate-btn-swap');
    const fateBtnConfirm = document.getElementById('fate-dialog-confirm');
    const fateBtnCancel = document.getElementById('fate-dialog-cancel');

    let fateContext = null;

    function openFateDialog(playerId) {
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      const state = getPlayerCardState(playerId);
      if (state.deck.length < 2) {
        broadcastSystemMsg(`【系统】${getPlayerName(playerId)}牌库不足2张，无法进行命运抉择`);
        return;
      }
      const opId = (typeof localPlayerId !== 'undefined' && localPlayerId && localPlayerId !== '0') ? localPlayerId : '1';
      document.getElementById('fate-dialog-title').textContent = `🔀 命运抉择 - ${getPlayerName(playerId)}`;
      fateContext = { playerId, operatorId: opId, topCard: null, bottomCard: null, swapped: false };
      fateSlotTop.innerHTML = '<span class="fate-slot-placeholder">牌库顶</span>';
      fateSlotBottom.innerHTML = '<span class="fate-slot-placeholder">牌库底</span>';
      fateBtnStart.hidden = false;
      fateBtnSwap.hidden = true;
      fateBtnCancel.hidden = false;
      fateOverlay.hidden = false;
    }

    function closeFateDialog(cancel) {
      if (cancel && fateContext && fateContext.topCard) {
        broadcastSystemMsg(`【系统】${getPlayerName(fateContext.playerId)}取消了命运抉择..`);
      }
      fateOverlay.hidden = true;
      fateContext = null;
    }

    function startFate() {
      if (!fateContext) return;
      const { playerId } = fateContext;
      const state = getPlayerCardState(playerId);
      if (state.deck.length < 2) return;
      const topCard = state.deck[0];
      const bottomCard = state.deck[state.deck.length - 1];
      fateContext.topCard = topCard;
      fateContext.bottomCard = bottomCard;
      fateContext.swapped = false;

      // 为对手操作时，先揭示再渲染（仅命运抉择揭示，不混入占卜集）
      const opId = fateContext.operatorId || playerId;
      if (opId !== playerId) {
        if (!playerFateRevealedCards[opId]) playerFateRevealedCards[opId] = new Set();
        playerFateRevealedCards[opId].add(topCard.id);
        playerFateRevealedCards[opId].add(bottomCard.id);
        // 命运抉择揭示同步到服务器（刷新重连后可恢复）
        if (isConnected() && typeof sendToPeer === 'function') {
          sendToPeer({ type: 'fate-revealed-cards', playerId: opId, cardIds: [...playerFateRevealedCards[opId]] });
        }
      }

      _renderFateSlots(fateContext, playerId);
      fateBtnStart.hidden = true;
      fateBtnSwap.hidden = false;
      fateBtnCancel.hidden = true;

      const tgtName = getPlayerName(playerId);
      const opName = getPlayerName(opId);
      const msg = opId !== playerId
        ? `【系统】${opName}正在为${tgtName}命运抉择...`
        : `【系统】${tgtName}正在命运抉择...`;
      broadcastSystemMsg(msg);
    }

    function _renderFateSlots(ctx, playerId) {
      const own = isViewingOwnCards(playerId);
      _renderFateCardSlot(fateSlotTop, '牌库顶', ctx.topCard, own);
      _renderFateCardSlot(fateSlotBottom, '牌库底', ctx.bottomCard, own);
    }

    function _renderFateCardSlot(slotEl, title, card, own) {
      // 命运抉择揭示：操作者即使不是牌主也能看到
      const opId = fateContext ? (fateContext.operatorId || fateContext.playerId) : null;
      const viewerId = getViewerPlayerId();
      const isFateRevealed = opId && playerFateRevealedCards[viewerId] && playerFateRevealedCards[viewerId].has(card.id);
      const canSee = own || isFateRevealed;

      if (!canSee) {
        slotEl.innerHTML = `<div class="fate-card-title">${title}</div><div class="fate-card-name" style="color:#888">未知</div>`;
        return;
      }
      const db = (typeof CardDB !== 'undefined') ? CardDB.lookup(card.name) : null;
      const typeNames = { shikigami:'式神', summon:'召唤物', spell:'法术', battle:'战斗', form:'形态', realm:'幻境', curse:'灵咒', bond:'协战' };

      let html = `<div class="fate-card-title">${title}</div>`;

      // 等级菱形
      if (db && db.level) {
        html += `<span class="fate-mini-level"><span>${db.level}</span></span>`;
      }

      // 名称
      html += `<div class="fate-card-name">${card.name}</div>`;

      // 效果描述
      const eff = db ? (db.effect || db.ability || '') : '';
      if (eff) html += `<div class="fate-card-effect">${eff}</div>`;

      // 灵咒
      if (card.curses && card.curses.length) {
        html += '<div class="fate-card-curses">';
        card.curses.forEach(c => {
          html += `<span class="fate-curse-tag">⛓️${c.name}×${c.layers}</span>`;
        });
        html += '</div>';
      }

      // 底部
      if (db) {
        const typeCN = typeNames[db.type] || db.type;
        html += `<div class="fate-card-footer">${db.owner || '中立'} - ${typeCN}</div>`;
      } else {
        html += '<div class="fate-card-footer">未录入数据</div>';
      }

      // 左右下角属性
      if (db) {
        let bl = '', br = '', blColor = '', brColor = '';
        switch (db.type) {
          case 'battle': case 'bond':
            if ((db.atkBonus || 0) > 0) { bl = '+' + db.atkBonus; blColor = '#50c8b4'; }
            else if ((db.atkBonus || 0) < 0) { bl = '' + db.atkBonus; blColor = '#ff6e6e'; }
            else if (db.atkPenalty > 0) { bl = '-' + db.atkPenalty; blColor = '#ff6e6e'; }
            if ((db.shieldBonus || 0) > 0) { br = '+' + db.shieldBonus; brColor = '#64d264'; }
            else if ((db.shieldBonus || 0) < 0) { br = '' + db.shieldBonus; brColor = '#ff6e6e'; }
            else if (db.shieldPenalty > 0) { br = '-' + db.shieldPenalty; brColor = '#ff6e6e'; }
            break;
          case 'spell':
            if (db.atkBonus > 0) { bl = '+' + db.atkBonus; blColor = '#50c8b4'; }
            if (db.hpBonus > 0) { br = '+' + db.hpBonus; brColor = '#64d264'; }
            break;
          case 'realm':
            if (db.durability > 0) { br = '' + db.durability; brColor = '#c8a0f0'; }
            break;
          case 'form':
            if (db.attack != null) { bl = '' + db.attack; blColor = '#50c8b4'; }
            if (db.hp != null) { br = '' + db.hp; brColor = '#ff8282'; }
            break;
          case 'shikigami': case 'summon':
            if (db.attack != null) { bl = '' + db.attack; blColor = '#50c8b4'; }
            if (db.hp != null) { br = '' + db.hp; brColor = '#ff8282'; }
            break;
        }
        if (bl) html += `<span class="fate-stat fate-stat--bl" style="color:${blColor};border-color:${blColor}">${bl}</span>`;
        if (br) html += `<span class="fate-stat fate-stat--br" style="color:${brColor};border-color:${brColor}">${br}</span>`;
      }

      slotEl.innerHTML = html;

      // 自适应缩字：效果描述超出时缩小字号
      if (eff) {
        const effEl = slotEl.querySelector('.fate-card-effect');
        if (effEl) {
          let s = 15;
          effEl.style.fontSize = s + 'px';
          requestAnimationFrame(() => {
            while (effEl.scrollHeight > effEl.clientHeight + 2 && s > 9) {
              s -= 1;
              effEl.style.fontSize = s + 'px';
            }
          });
        }
      }
    }

    function swapFateCards() {
      if (!fateContext) return;
      fateContext.swapped = !fateContext.swapped;
      const tmp = fateContext.topCard;
      fateContext.topCard = fateContext.bottomCard;
      fateContext.bottomCard = tmp;
      if (typeof gsap !== 'undefined') {
        const topEl = fateSlotTop;
        const bottomEl = fateSlotBottom;
        const topY = topEl.getBoundingClientRect().top;
        const bottomY = bottomEl.getBoundingClientRect().top;
        const delta = bottomY - topY;
        const tl = gsap.timeline();
        tl.to(topEl, { y: delta, duration: 0.35, ease: 'power2.inOut' }, 0);
        tl.to(bottomEl, { y: -delta, duration: 0.35, ease: 'power2.inOut' }, 0);
        tl.call(() => {
          _renderFateSlots(fateContext, fateContext.playerId);
          gsap.set([topEl, bottomEl], { y: 0 });
        });
      }
    }

    function confirmFate() {
      if (!fateContext) return;
      const { playerId, swapped } = fateContext;
      const state = getPlayerCardState(playerId);
      if (swapped && state.deck.length >= 2) {
        const top = state.deck.shift();
        const bottom = state.deck.pop();
        state.deck.unshift(bottom);
        state.deck.push(top);
      }
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId); else syncDeckState(playerId);
      const opId = fateContext.operatorId || playerId;
      const isHelp = opId !== playerId;
      const tgtName = getPlayerName(playerId);
      const opName = getPlayerName(opId);
      const msg = isHelp
        ? `【系统】${opName}完成了对${tgtName}的命运抉择`
        : `【系统】${tgtName}完成了命运抉择`;
      broadcastSystemMsg(msg);
      closeFateDialog();
    }

    fateBtnStart.addEventListener('click', startFate);
    fateBtnSwap.addEventListener('click', swapFateCards);
    fateBtnConfirm.addEventListener('click', confirmFate);
    fateBtnCancel.addEventListener('click', () => closeFateDialog(true));

    // Esc 关闭命运抉择
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && fateOverlay && !fateOverlay.hidden) {
        closeFateDialog(true);
      }
    });

    // ================================================================
    //  初始手牌系统
    const initialHandOverlay = document.getElementById('initial-hand-overlay');
    const initialHandCountInput = document.getElementById('initial-hand-count-input');
    const initialHandDrawBtn = document.getElementById('initial-hand-draw-btn');
    const initialHandCardsBody = document.getElementById('initial-hand-cards-body');
    const initialHandCancelBtn = document.getElementById('initial-hand-cancel');
    const initialHandConfirmBtn = document.getElementById('initial-hand-confirm');
    const initialHandDrawHint = document.getElementById('initial-hand-draw-hint');

    /** 初始手牌上下文 */
    let initialHandContext = null; // { playerId, drawnCards: [], rejectedIndices: Set }

    /** 打开初始手牌弹窗 */
    function openInitialHandDialog(playerId) {
      const state = getPlayerCardState(playerId);
      if (!state.deck.length) {
        broadcastSystemMsg(`【系统】${getPlayerName(playerId)}的牌库为空，无法抽取初始手牌`);
        return;
      }
      initialHandContext = {
        playerId,
        drawnCards: [],
        rejectedIndices: new Set(),
      };
      initialHandCountInput.value = Math.min(3, state.deck.length);
      initialHandCountInput.max = state.deck.length;
      initialHandCardsBody.innerHTML = '';
      initialHandDrawHint.hidden = true;
      initialHandOverlay.hidden = false;
      initialHandCountInput.focus();
      initialHandCountInput.select();

      // 绑定标题拖拽
      const dialogEl = initialHandOverlay.querySelector('.speak-dialog');
      let dragStart = null;
      let dragOffset = { x: 0, y: 0 };
      const titleEl = document.getElementById('initial-hand-title');
      titleEl.style.cursor = 'grab';
      titleEl.onmousedown = function(e) {
        if (e.target.closest('button')) return;
        dragStart = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
        dialogEl.style.cursor = 'grabbing';
        e.preventDefault();
      };
      document.addEventListener('mousemove', function onMove(e) {
        if (!dragStart || initialHandOverlay.hidden) return;
        dragOffset.x = e.clientX - dragStart.x;
        dragOffset.y = e.clientY - dragStart.y;
        dialogEl.style.transform = `translate(${dragOffset.x}px, ${dragOffset.y}px)`;
        dialogEl.style.transition = 'none';
      });
      document.addEventListener('mouseup', function onUp() {
        if (!dragStart) return;
        dragStart = null;
        dialogEl.style.cursor = '';
      });
    }

    /** 关闭初始手牌弹窗 */
    function closeInitialHandDialog() {
      initialHandOverlay.hidden = true;
      initialHandContext = null;
      initialHandCardsBody.innerHTML = '';
      initialHandDrawHint.hidden = true;
      // 重置拖拽
      const dialogEl = initialHandOverlay.querySelector('.speak-dialog');
      if (dialogEl) {
        dialogEl.style.transform = '';
        dialogEl.style.transition = '';
        dialogEl.style.cursor = '';
      }
      document.getElementById('initial-hand-title').style.cursor = '';
    }

    /** 从牌库随机抽取 count 张牌（不改变牌库，返回副本） */
    function drawInitialCards(playerId, count) {
      const state = getPlayerCardState(playerId);
      const deck = state.deck.filter(c => c && typeof c === 'object');
      if (!deck.length) return [];
      const clamped = Math.min(count, deck.length);
      // 随机抽取 clamped 张（不改变牌库顺序）
      const indices = [...Array(deck.length).keys()];
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const selected = indices.slice(0, clamped).map(i => ({
        id: deck[i].id,
        name: deck[i].name,
        curses: deck[i].curses ? deck[i].curses.map(c => ({ name: c.name, layers: c.layers })) : [],
      }));
      return selected;
    }

    /** 渲染初始手牌卡牌列表 */
    function renderInitialHandCards() {
      if (!initialHandContext) return;
      const { drawnCards, rejectedIndices } = initialHandContext;
      initialHandCardsBody.innerHTML = '';

      if (!drawnCards.length) {
        return;
      }

      drawnCards.forEach((card, idx) => {
        const item = document.createElement('div');
        item.className = 'initial-hand-card';
        if (rejectedIndices.has(idx)) {
          item.classList.add('initial-hand-card--rejected');
        }
        item.dataset.displayIndex = idx;

        const indexSpan = document.createElement('span');
        indexSpan.className = 'initial-hand-card__index';
        indexSpan.textContent = `#${idx + 1}`;
        item.appendChild(indexSpan);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'initial-hand-card__name card-list-item__name';
        nameSpan.textContent = card.name || '(未命名)';
        item.appendChild(nameSpan);

        // X 标记覆盖层
        if (rejectedIndices.has(idx)) {
          const xMark = document.createElement('span');
          xMark.className = 'initial-hand-card__x-mark';
          xMark.textContent = '✕';
          item.appendChild(xMark);
        }

        // 点击切换 X 标记（基于数组索引，彻底避免 ID 碰撞）
        item.addEventListener('click', () => {
          if (rejectedIndices.has(idx)) {
            rejectedIndices.delete(idx);
          } else {
            rejectedIndices.add(idx);
          }
          renderInitialHandCards();
        });

        initialHandCardsBody.appendChild(item);
      });
    }

    /** 抽取按钮：从牌库随机抽牌展示 */
    initialHandDrawBtn.addEventListener('click', () => {
      if (!initialHandContext) return;
      const count = parseInt(initialHandCountInput.value, 10);
      if (isNaN(count) || count < 1) {
        initialHandCountInput.value = 1;
        return;
      }
      const state = getPlayerCardState(initialHandContext.playerId);
      const clamped = Math.min(count, state.deck.length);
      if (clamped < 1) return;
      initialHandCountInput.value = clamped;
      initialHandContext.drawnCards = drawInitialCards(initialHandContext.playerId, clamped);
      initialHandContext.rejectedIndices = new Set();
      initialHandDrawHint.hidden = false;
      broadcastSystemMsg(`【系统】${getPlayerName(initialHandContext.playerId)}观看了初始手牌...正在选择需要替换的卡牌..`);
      renderInitialHandCards();
    });

    /** 确定按钮：替换X牌，抽入手牌，发系统消息 */
    initialHandConfirmBtn.addEventListener('click', () => {
      if (!initialHandContext) return;
      const { playerId, drawnCards, rejectedIndices } = initialHandContext;
      if (!drawnCards.length) {
        closeInitialHandDialog();
        return;
      }
      const state = getPlayerCardState(playerId);
      const playerName = getPlayerName(playerId);

      // === 第1步：从牌库中找到每张展示牌的原件，移除并收集 ===
      // drawnCards 是 drawInitialCards 返回的独立副本（仅 id/name/curses），
      // 这里通过 id 在真实牌库 state.deck 中定位原件。
      const drawnOriginals = []; // 与 drawnCards 一一对应的牌库原件
      for (const drawn of drawnCards) {
        const idx = state.deck.findIndex(c => c && c.id === drawn.id);
        if (idx !== -1) {
          const [original] = state.deck.splice(idx, 1);
          drawnOriginals.push(original);
        } else {
          // 防御：原件已不在牌库（极端情况），用副本占位
          drawnOriginals.push(null);
        }
      }

      // === 第2步：按 X 标记拆分原件 ===
      const keptOriginals = [];    // 保留的牌库原件
      const rejectedOriginals = []; // 画X的牌库原件（将退回牌库）
      const keptNames = [];
      const rejectedNames = [];

      drawnOriginals.forEach((orig, idx) => {
        const displayCard = drawnCards[idx];
        if (!displayCard) return;
        if (rejectedIndices.has(idx)) {
          rejectedNames.push(displayCard.name);
          if (orig) rejectedOriginals.push(orig);
        } else {
          keptNames.push(displayCard.name);
          if (orig) keptOriginals.push(orig);
        }
      });

      // === 第3步：为每张画X的牌从剩余牌库随机换一张 ===
      // 此时 state.deck 已排除所有展示牌（含将被退回的X牌），从中选取替换
      const replacementNames = [];
      const replacementCards = [];
      if (rejectedOriginals.length > 0) {
        const pool = state.deck.filter(c => c && typeof c === 'object');
        const shuffled = [...pool].sort(() => Math.random() - 0.5);

        for (let i = 0; i < rejectedOriginals.length && i < shuffled.length; i++) {
          const replacement = shuffled[i];
          replacementNames.push(replacement.name);
          const realIdx = state.deck.findIndex(c => c && c.id === replacement.id);
          if (realIdx !== -1) {
            const [removed] = state.deck.splice(realIdx, 1);
            replacementCards.push(removed);
          }
        }
      }

      // 画X的牌原件退回牌库（交换而非丢弃，在替换选取之后放回）
      rejectedOriginals.forEach(orig => {
        state.deck.push(orig);
      });

      // === 第4步：所有保留原件 + 替换牌 → 抽入手牌 ===
      const allCardsToHand = [...keptOriginals, ...replacementCards];
      allCardsToHand.forEach(card => {
        if (card) pushCardToHand(playerId, card);
      });

      // === 第5步：更新UI ===
      updateDeckButtons(playerId);
      refreshOpenListDialog(playerId);
      syncDeckState(playerId);

      // 飞行动画：N张牌依次从牌库飞入手牌
      if (typeof CardFlight !== 'undefined') {
        CardFlight.flySeqAndBroadcast(playerId, allCardsToHand.length, 'deck', null, 'hand', { interval: 0.18, arcHeight: 60 });
      }

      // === 第6步：系统消息 ===
      const totalCount = drawnCards.length;

      // 自己看到详细消息
      let detailMsg = `【系统】${playerName}抽取了${totalCount}张初始手牌`;
      if (keptNames.length > 0) {
        detailMsg += ` —— 保留：「${keptNames.join('」、「')}」`;
      }
      if (rejectedNames.length > 0) {
        detailMsg += ` —— 放弃：「${rejectedNames.join('」、「')}」`;
        if (replacementNames.length > 0) {
          detailMsg += `，替换为：「${replacementNames.join('」、「')}」`;
        }
      }
      detailMsg += '（此消息仅自己可见）';

      // 对手只看到摘要
      const summaryMsg = `【系统】${playerName}抽了${totalCount}张初始手牌`;

      // 本地显示详细信息
      addSystemChatMessage(detailMsg);

      // 发送给对手：仅摘要
      if (!isSoloMode && isConnected() && typeof sendToPeer === 'function') {
        sendToPeer({ type: 'sysmsg', text: summaryMsg });
      }

      closeInitialHandDialog();
    });

    /** 取消按钮 */
    initialHandCancelBtn.addEventListener('click', closeInitialHandDialog);

    // Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && initialHandOverlay && !initialHandOverlay.hidden) {
        closeInitialHandDialog();
      }
    });

    // 点击遮罩关闭
    initialHandOverlay.addEventListener('click', (e) => {
      if (e.target === initialHandOverlay) {
        closeInitialHandDialog();
      }
    });

    /** "初始手牌"按钮点击事件 */
    document.getElementById('card-list-initial-hand-btn').addEventListener('click', () => {
      if (!cardListContext || cardListContext.type !== 'hand') return;
      openInitialHandDialog(cardListContext.playerId);
    });

    // 输入框回车触发抽取
    initialHandCountInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        initialHandDrawBtn.click();
      }
    });

    // ================================================================
    //  坟场系统（机制：🪦 坟场 → 选牌手 → 入口按钮 → 坟场弹窗）
    //  查看/筛选/换位/使用/移回手牌/移回牌库/永久删除
    // ================================================================
    let graveTargets = {};       // playerId -> true（入口按钮开关）
    let graveCtx = null;         // { playerId } 当前打开的坟场
    let graveFilters = { use: true, discard: true, add: true };
    let graveActionMode = '';    // '' | 'use' | 'hand' | 'deck-top' | 'deck-random' | 'deck-bottom' | 'delete'
    let graveReorder = false;    // 换位拖动模式
    let graveOverlay = null;
    let graveDrag = null;        // { item, cur, moved }

    function _graveIsMobile() {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    function _graveBtnOf(playerId) {
      return document.querySelector(`.btn-deck--grave[data-grave-player="${playerId}"]`);
    }

    /** 按钮文案：显示坟场牌数 */
    function _graveBtnText(playerId) {
      const st = typeof getPlayerCardState === 'function' ? getPlayerCardState(playerId) : null;
      const n = (st && Array.isArray(st.grave)) ? st.grave.length : 0;
      return _graveIsMobile() ? '🪦' + n : `🪦 坟场（${n}）`;
    }

    /** 刷新所有坟场入口按钮的牌数显示 */
    window.refreshGraveButtons = function() {
      document.querySelectorAll('.btn-deck--grave').forEach(function(b) {
        const pid = b.dataset.gravePlayer;
        if (!pid) return;
        b.textContent = _graveBtnText(pid);
      });
    };

    /** 机制：切换某玩家的坟场入口按钮（同步给双方） */
    window.setGraveyardTarget = function(playerId) {
      if (!playerId || playerId === '0') return;
      if (graveTargets[playerId]) {
        delete graveTargets[playerId];
        const b = _graveBtnOf(playerId);
        if (b) b.remove();
        if (graveCtx && graveCtx.playerId === playerId) _graveClose();
        broadcastSystemMsg(`【系统】玩家${getPlayerName(playerId)}关闭了坟场`);
        if (typeof sendToPeer === 'function') sendToPeer({ type: 'grave-target', playerId: playerId, enabled: false });
      } else {
        graveTargets[playerId] = true;
        _graveEnsureEntry(playerId);
        window.placeGraveButtons();
        broadcastSystemMsg(`【系统】玩家${getPlayerName(playerId)}开启了坟场`);
        if (typeof sendToPeer === 'function') sendToPeer({ type: 'grave-target', playerId: playerId, enabled: true });
      }
    };

    /** 远端应用坟场入口开关（不重复发系统消息） */
    window.applyRemoteGraveTarget = function(playerId, enabled) {
      if (!playerId || playerId === '0') return;
      if (enabled) {
        graveTargets[playerId] = true;
        _graveEnsureEntry(playerId);
      } else {
        delete graveTargets[playerId];
        const b = _graveBtnOf(playerId);
        if (b) b.remove();
        if (graveCtx && graveCtx.playerId === playerId) _graveClose();
      }
      window.placeGraveButtons();
    };

    /** 整局状态恢复（重连/观战）：按服务器保存的入口开关重建按钮 */
    window.applyGraveTargets = function(targets) {
      ['1', '2'].forEach(function(pid) {
        const on = !!(targets && targets[pid]);
        if (on && !graveTargets[pid]) {
          graveTargets[pid] = true;
          _graveEnsureEntry(pid);
        } else if (!on && graveTargets[pid]) {
          delete graveTargets[pid];
          const b = _graveBtnOf(pid);
          if (b) b.remove();
          if (graveCtx && graveCtx.playerId === pid) _graveClose();
        }
      });
      window.placeGraveButtons();
    };

    /** 导出用：当前坟场入口开关快照 */
    window.getGraveTargetsState = function() {
      return Object.assign({}, graveTargets);
    };

    /** 创建坟场入口按钮（初始位置） */
    function _graveEnsureEntry(playerId) {
      if (_graveBtnOf(playerId)) return;
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (!zone) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-deck btn-deck--grave';
      btn.dataset.gravePlayer = playerId;
      btn.textContent = _graveBtnText(playerId);
      btn.title = '打开坟场';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _graveOpen(playerId);
      });
      const deckBtn = zone.querySelector('.btn-deck[data-action="deck"]');
      if (deckBtn && deckBtn.parentElement) deckBtn.parentElement.insertBefore(btn, deckBtn.nextSibling);
      else zone.appendChild(btn);
    }

    /** 布局函数调用：手机端放到信息条幻境按钮右边，桌面端放到牌库按钮右边 */
    window.placeGraveButtons = function() {
      const mobile = _graveIsMobile();
      Object.keys(graveTargets).forEach(function(pid) {
        if (!graveTargets[pid]) return;
        const zone = document.querySelector(`.player-zone[data-player="${pid}"]`);
        const btn = _graveBtnOf(pid);
        if (!zone || !btn) return;
        btn.textContent = _graveBtnText(pid);
        if (mobile) {
          const bar = zone.querySelector('.player-id-area');
          const realm = zone.querySelector('.btn-mobile-realm');
          if (!bar) return;
          bar.appendChild(btn);
          if (realm && bar.contains(realm)) bar.insertBefore(btn, realm.nextSibling);
        } else {
          const deckBtn = zone.querySelector('.btn-deck[data-action="deck"]');
          if (deckBtn && deckBtn.parentElement) deckBtn.parentElement.insertBefore(btn, deckBtn.nextSibling);
        }
      });
    };

    // ── 坟场弹窗 ──
    function _graveEnsureOverlay() {
      if (graveOverlay) return;
      graveOverlay = document.createElement('div');
      graveOverlay.className = 'grave-overlay';
      graveOverlay.hidden = true;
      graveOverlay.innerHTML = `
        <div class="grave-dialog">
          <div class="grave-dialog__header">
            <span class="grave-dialog__title" id="grave-dialog-title">🪦 坟场</span>
            <button type="button" class="grave-dialog__close" title="关闭">✕</button>
          </div>
          <div class="grave-filters" id="grave-filters">
            <button type="button" class="grave-filter-btn active" data-filter="use"><span>显示使用</span><span>过的牌</span></button>
            <button type="button" class="grave-filter-btn active" data-filter="discard"><span>显示弃置</span><span>过的牌</span></button>
            <button type="button" class="grave-filter-btn active" data-filter="add"><span>显示置入</span><span>进来的牌</span></button>
          </div>
          <div class="grave-dialog__body" id="grave-body"></div>
          <div class="grave-actions" id="grave-actions">
            <button type="button" class="grave-action-btn" data-action="reorder">换位</button>
            <button type="button" class="grave-action-btn" data-action="use">使用</button>
            <button type="button" class="grave-action-btn" data-action="hand">移回<br>手牌</button>
            <button type="button" class="grave-action-btn" data-action="delete">永久<br>删除</button>
          </div>
          <div class="grave-deck-row" id="grave-deck-row">
            <span class="grave-deck-label">移回牌库：</span>
            <button type="button" class="grave-action-btn grave-deck-btn" data-action="deck-top">牌库顶</button>
            <button type="button" class="grave-action-btn grave-deck-btn" data-action="deck-random">随机位置</button>
            <button type="button" class="grave-action-btn grave-deck-btn" data-action="deck-bottom">牌库底</button>
          </div>
          <div class="grave-add-row">
            <button type="button" class="grave-action-btn grave-add-btn">向坟场置入卡牌</button>
            <span class="grave-add-colon">：</span>
            <input type="text" class="grave-add-input" placeholder="输入牌名" maxlength="24">
            <span class="grave-add-msg"></span>
          </div>
        </div>`;
      document.body.appendChild(graveOverlay);
      graveOverlay.querySelector('.grave-dialog__close').addEventListener('click', _graveClose);
      // 手机端：拦截弹窗外滑动，防止滚动穿透到主战场（关闭只能点 ✕）
      graveOverlay.addEventListener('touchmove', (e) => {
        if (e.target.closest && e.target.closest('.grave-dialog')) return;
        e.preventDefault();
      }, { passive: false });
      // 筛选开关
      graveOverlay.querySelector('#grave-filters').addEventListener('click', (e) => {
        const btn = e.target.closest('.grave-filter-btn');
        if (!btn) return;
        const f = btn.dataset.filter;
        graveFilters[f] = !graveFilters[f];
        btn.classList.toggle('active', graveFilters[f]);
        _graveRenderList();
      });
      // 操作按钮（互斥）
      graveOverlay.querySelector('#grave-actions').addEventListener('click', (e) => {
        const btn = e.target.closest('.grave-action-btn');
        if (!btn) return;
        const act = btn.dataset.action;
        if (act === 'reorder') {
          graveReorder = !graveReorder;
          graveActionMode = '';   // 换位与其他模式互斥，始终取消其他高亮
        } else {
          graveActionMode = (graveActionMode === act) ? '' : act;
          graveReorder = false;
        }
        _graveUpdateActionUI();
        _graveRenderList();
      });
      // 移回牌库：牌库顶 / 随机位置 / 牌库底（互斥，选中后每条牌出现对应按钮）
      graveOverlay.querySelector('#grave-deck-row').addEventListener('click', (e) => {
        const btn = e.target.closest('.grave-action-btn');
        if (!btn) return;
        const act = btn.dataset.action;
        graveActionMode = (graveActionMode === act) ? '' : act;
        graveReorder = false;
        _graveUpdateActionUI();
        _graveRenderList();
      });
      // 置入卡牌：按钮 + 输入框回车
      graveOverlay.querySelector('.grave-add-btn').addEventListener('click', _graveAddCard);
      graveOverlay.querySelector('.grave-add-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); _graveAddCard(); }
      });
      // 列表：卡牌操作按钮 / 灵咒管理 / 换位拖动
      const body = document.getElementById('grave-body');
      body.addEventListener('click', (e) => {
        const btn = e.target.closest('.grave-item-btn, .btn-card-curse-add');
        if (btn) {
          const idx = parseInt(btn.dataset.graveIdx, 10);
          if (btn.dataset.graveAct === 'curse') _graveOpenCurse(idx);
          else _graveDoAction(idx);
          return;
        }
      });
      body.addEventListener('pointerdown', (e) => {
        if (!graveReorder || !graveCtx) return;
        if (typeof isSpectator !== 'undefined' && isSpectator) return;
        if (e.target.closest('.grave-item-btn, .btn-card-curse-add')) return;
        const item = e.target.closest('.grave-item');
        if (!item) return;
        // 释放触摸指针的隐式捕获，否则 pointermove 永远只落在初始元素上（手机拖不动的根因）
        try {
          if (item.hasPointerCapture && item.hasPointerCapture(e.pointerId)) item.releasePointerCapture(e.pointerId);
        } catch (_) {}
        item.classList.add('grave-item--dragging');
        graveDrag = { item, cur: parseInt(item.dataset.graveIdx, 10), moved: false };
        e.preventDefault();
      });
      body.addEventListener('pointermove', (e) => {
        if (!graveDrag || !graveCtx) return;
        const state = getPlayerCardState(graveCtx.playerId);
        const grave = state.grave || [];
        // 手机端优先按坐标命中，桌面端用事件目标
        let hover = e.target && e.target.closest ? e.target.closest('.grave-item') : null;
        if (!hover || hover === graveDrag.item) {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          hover = el && el.closest ? el.closest('.grave-item') : null;
        }
        if (!hover || hover === graveDrag.item) return;
        const targetIdx = parseInt(hover.dataset.graveIdx, 10);
        if (targetIdx === graveDrag.cur || grave[targetIdx] === undefined) return;
        const oldCur = graveDrag.cur;
        graveDrag.moved = true;
        const tmp = grave[oldCur];
        grave[oldCur] = grave[targetIdx];
        grave[targetIdx] = tmp;
        graveDrag.cur = targetIdx;
        // 只移动 DOM 节点，不重建列表（重建会触发手机端 pointercancel 导致拖不动）
        const list = hover.parentElement;
        if (list) {
          if (targetIdx > oldCur) list.insertBefore(graveDrag.item, hover.nextSibling);
          else list.insertBefore(graveDrag.item, hover);
        }
      });
      document.addEventListener('pointerup', (e) => {
        if (!graveDrag) return;
        const moved = graveDrag.moved;
        const dragItem = graveDrag.item;
        graveDrag = null;
        if (dragItem) dragItem.classList.remove('grave-item--dragging');
        if (moved && graveCtx) {
          const state = getPlayerCardState(graveCtx.playerId);
          if (typeof syncDeckStateForce === 'function') syncDeckStateForce(graveCtx.playerId);
          else if (typeof syncDeckState === 'function') syncDeckState(graveCtx.playerId);
          broadcastSystemMsg(`【系统】${getPlayerName(graveCtx.playerId)}调整了坟场顺序`);
          _graveRenderList();
        }
      });
      document.addEventListener('pointercancel', () => {
        if (graveDrag && graveDrag.item) graveDrag.item.classList.remove('grave-item--dragging');
        graveDrag = null;
      });
    }

    function _graveOpen(playerId) {
      _graveEnsureOverlay();
      graveCtx = { playerId };
      graveFilters = { use: true, discard: true, add: true };
      graveActionMode = '';
      graveReorder = false;
      // 观众：可查看，操作区置灰禁点
      if (typeof isSpectator !== 'undefined' && isSpectator) graveOverlay.classList.add('spec-view');
      else graveOverlay.classList.remove('spec-view');
      graveOverlay.querySelectorAll('.grave-filter-btn').forEach(b => b.classList.add('active'));
      document.getElementById('grave-dialog-title').textContent = `🪦 ${getPlayerName(playerId)} 的坟场`;
      _graveUpdateActionUI();
      _graveRenderList();
      graveOverlay.hidden = false;
      graveOverlay.style.display = 'flex';
    }

    function _graveClose() {
      if (!graveOverlay) return;
      graveOverlay.hidden = true;
      graveOverlay.style.display = 'none';
      graveCtx = null;
      graveActionMode = '';
      graveReorder = false;
      // 关闭弹窗后清掉置入提示
      const msgEl = graveOverlay.querySelector('.grave-add-msg');
      if (msgEl) { msgEl.textContent = ''; msgEl.className = 'grave-add-msg'; }
      const input = graveOverlay.querySelector('.grave-add-input');
      if (input) input.value = '';
    }

    function _graveUpdateActionUI() {
      if (!graveOverlay) return;
      graveOverlay.classList.toggle('reorder-mode', graveReorder);
      graveOverlay.querySelectorAll('.grave-action-btn').forEach(b => {
        const act = b.dataset.action;
        b.classList.toggle('active', act === 'reorder' ? graveReorder : (graveActionMode === act));
      });
    }

    function _graveActLabel(act) {
      return { use: '使用', hand: '移回', 'deck-top': '牌库顶', 'deck-random': '随机位置', 'deck-bottom': '牌库底', delete: '删除' }[act] || '';
    }

    function _graveRenderList() {
      const body = document.getElementById('grave-body');
      if (!body || !graveCtx) return;
      const state = getPlayerCardState(graveCtx.playerId);
      const grave = state.grave || [];
      let viewNo = 0;
      let html = '';
      grave.forEach(function(card, idx) {
        if (!card) return;
        const added = !!card._graveAdded;
        const used = !!card.used;
        if (added) { if (!graveFilters.add) return; }
        else if (used) { if (!graveFilters.use) return; }
        else { if (!graveFilters.discard) return; }
        viewNo++;
        const tag = added
          ? '<span class="grave-tag grave-tag--add">置入</span>'
          : used
            ? '<span class="grave-tag grave-tag--use">使用</span>'
            : '<span class="grave-tag grave-tag--discard">弃置</span>';
        const actionBtn = graveActionMode && !graveReorder
          ? `<button type="button" class="grave-item-btn" data-grave-idx="${idx}" data-grave-act="${graveActionMode}">${_graveActLabel(graveActionMode)}</button>`
          : '';
        const curseTagsHtml = (card.curses && card.curses.length)
          ? `<span class="card-list-item__curses grave-item__curses">` + card.curses.map(c => `<span class="card-list-curse-tag">⛓️${escapeHTML(c.name)}×${c.layers}</span>`).join('') + `</span>`
          : '';
        const curseBtn = `<button type="button" class="btn-card-curse-add" data-grave-idx="${idx}" data-grave-act="curse" title="添加灵咒">➕</button>`;
        html += `<div class="grave-item${graveReorder ? ' grave-item--reorder' : ''}" data-grave-idx="${idx}">
          <span class="grave-item__no">${viewNo}</span>
          ${tag}
          <span class="grave-item__namewrap">
            <span class="card-list-item__name grave-item__name">${escapeHTML(card.name || '未知卡牌')}</span>
            ${curseTagsHtml}
          </span>
          ${curseBtn}
          ${actionBtn}
        </div>`;
      });
      body.innerHTML = html || '<div class="grave-empty">坟场为空</div>';
    }

    /** 坟场中某张牌的灵咒管理（复用通用灵咒面板） */
    function _graveOpenCurse(idx) {
      if (!graveCtx) return;
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      if (typeof openCursePanel !== 'function') return;
      const pid = graveCtx.playerId;
      const state = getPlayerCardState(pid);
      const card = (state.grave || [])[idx];
      if (!card) return;
      openCursePanel({
        getCurses: () => card.curses || [],
        setCurses: (curses) => {
          card.curses = curses;
          _graveRenderList();
          if (typeof syncDeckStateForce === 'function') syncDeckStateForce(pid);
          else if (typeof syncDeckState === 'function') syncDeckState(pid);
        },
        getLabel: () => card.name || '未知卡牌',
        getLocation: () => '坟场中的',
        getPlayerId: () => pid,
        isReadOnly: () => false,
      });
    }

    /** 向坟场置入卡牌（按钮/回车）：置入到最底部 */
    function _graveAddCard() {
      if (!graveCtx || !graveOverlay) return;
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      const input = graveOverlay.querySelector('.grave-add-input');
      const msgEl = graveOverlay.querySelector('.grave-add-msg');
      const name = (input && input.value) ? input.value.trim() : '';
      if (!name) {
        if (msgEl) { msgEl.textContent = '未输入卡牌名'; msgEl.className = 'grave-add-msg grave-add-msg--err'; }
        if (input) input.focus();
        return;
      }
      const pid = graveCtx.playerId;
      const state = getPlayerCardState(pid);
      if (!state.grave) state.grave = [];
      const card = createCard(name);
      card.used = false;           // 不按使用/弃置归类
      card._graveAdded = true;     // 标记为“置入”类型
      state.grave.push(card);      // 追加到最底部
      _graveFlyIn(pid);            // 动画：一张牌飞向坟场（双方同步）
      _graveRenderList();
      if (typeof window.refreshGraveButtons === 'function') window.refreshGraveButtons();
      if (typeof syncDeckStateForce === 'function') syncDeckStateForce(pid);
      else if (typeof syncDeckState === 'function') syncDeckState(pid);
      if (msgEl) { msgEl.textContent = '置入成功'; msgEl.className = 'grave-add-msg grave-add-msg--ok'; }
      if (input) input.value = '';
      broadcastSystemMsg(`【系统】${getPlayerName(pid)}向坟场置入了「${name}」`);
    }

    function _graveDoAction(idx) {
      if (!graveCtx) return;
      if (typeof isSpectator !== 'undefined' && isSpectator) return;
      const playerId = graveCtx.playerId;
      const state = getPlayerCardState(playerId);
      const grave = state.grave || [];
      const card = grave[idx];
      if (!card) return;
      const playerName = getPlayerName(playerId);
      const filterText = (!graveFilters.use && graveFilters.discard) ? '弃置'
        : (graveFilters.use && !graveFilters.discard) ? '使用' : '全部';
      const syncAfter = function() {
        if (typeof syncDeckStateForce === 'function') syncDeckStateForce(playerId);
        else if (typeof syncDeckState === 'function') syncDeckState(playerId);
        if (typeof window.refreshGraveButtons === 'function') window.refreshGraveButtons();
      };

      if (graveActionMode === 'use') {
        // 从坟场使用：放回手牌走现有“使用牌”流程（不再回坟场、不重复播报）
        grave.splice(idx, 1);
        state.hand.push(card);
        window._graveUseInProgress = true;
        try {
          removeFromHand(playerId, card.id, 'use');
        } finally {
          window._graveUseInProgress = false;
        }
        // 跨玩家操作时强制同步给对方（removeFromHand 内部只同步己方）
        if (typeof syncDeckStateForce === 'function' && typeof isMyZone === 'function' && !isMyZone(playerId)) {
          syncDeckStateForce(playerId);
        }
        broadcastSystemMsg(`【系统】${playerName}从坟场（${filterText}）使用了卡牌「${card.name}」`);
      } else if (graveActionMode === 'hand') {
        grave.splice(idx, 1);
        state.hand.push(card);
        if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
        if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
        syncAfter();
        broadcastSystemMsg(`【系统】${playerName}将「${card.name}」从坟场移回了手牌`);
        _graveFlyTo(playerId, 'hand');
      } else if (graveActionMode === 'deck-top') {
        grave.splice(idx, 1);
        state.deck.unshift(card);
        if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
        if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
        syncAfter();
        broadcastSystemMsg(`【系统】${playerName}将「${card.name}」从坟场移回了牌库顶`);
        _graveFlyTo(playerId, 'deck');
      } else if (graveActionMode === 'deck-random') {
        grave.splice(idx, 1);
        insertCardAtRandomPosition(state.deck, card);
        if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
        if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
        syncAfter();
        broadcastSystemMsg(`【系统】${playerName}将「${card.name}」从坟场移回了牌库随机位置`);
        _graveFlyTo(playerId, 'deck');
      } else if (graveActionMode === 'deck-bottom') {
        grave.splice(idx, 1);
        state.deck.push(card);
        if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
        if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
        syncAfter();
        broadcastSystemMsg(`【系统】${playerName}将「${card.name}」从坟场移回了牌库底`);
        _graveFlyTo(playerId, 'deck');
      } else if (graveActionMode === 'delete') {
        grave.splice(idx, 1);
        if (typeof updateDeckButtons === 'function') updateDeckButtons(playerId);
        if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
        syncAfter();
        broadcastSystemMsg(`【系统】${playerName}永久删除了坟场中的「${card.name}」`);
      }
      _graveRenderList();
    }

    /** 从坟场弹窗飞向手牌/牌库按钮（复用 CardFlight 通用飞行） */
    function _graveFlyTo(playerId, target) {
      if (typeof CardFlight === 'undefined' || !CardFlight.fly || !CardFlight._centerOf) return;
      const fromEl = document.querySelector('.grave-dialog');
      const toBtn = CardFlight.getPlayerBtn(playerId, target);
      if (!fromEl || !toBtn) return;
      const fromC = CardFlight._centerOf(fromEl);
      const toC = CardFlight._centerOf(toBtn);
      CardFlight.fly(fromC, toC, { duration: 0.5, arcHeight: 60 });
      if (CardFlight._broadcastAnim) {
        CardFlight._broadcastAnim({ action: 'fly-single', playerId: playerId, fromType: null, fromCoord: fromC, toType: null, toCoord: toC, opts: { duration: 0.5, arcHeight: 60 } });
      }
    }

    /** 置入坟场动画：从入口按钮下方飞入坟场按钮（复用置入手牌/牌库动画，双方同步） */
    function _graveFlyIn(playerId) {
      if (typeof CardFlight === 'undefined' || !CardFlight.flySeqAndBroadcast || !CardFlight.getPlayerBtn) return;
      const graveBtn = CardFlight.getPlayerBtn(playerId, 'grave');
      if (!graveBtn) return;
      const r = graveBtn.getBoundingClientRect();
      const srcY = playerId === '2' ? r.top - 150 : r.bottom + 150;
      CardFlight.flySeqAndBroadcast(playerId, 1, 'grave', { x: r.left + r.width / 2, y: srcY }, 'grave', { interval: 0.18, arcHeight: 60 });
    }

    // ================================================================
    //  检索系统（机制：🔍 检索 → 范围开关 → 发现/牌名 → 结果操作）
    //  检索来源：己方牌库。范围三组开关取交集。
    // ================================================================
    let searchOverlay = null;
    let searchMode = 'discover';   // '' | 'discover' | 'name'（勾选框二选一）
    let searchResults = [];        // 本次检索出的牌（牌库卡牌引用）
    let searchMethod = '发现';     // '发现' | '牌名'
    let searchHasResult = false;   // 是否已检索（控制「结束检索」按钮）
    let searchFilters = {
      shikigami: { all: true, neutral: false, names: [] },
      levels: { '1': true, '2': true, '3': true, '其他': true },
      types: { battle: true, spell: true, realm: true, form: true, '其他': true },
      rarities: { 'R': true, 'SR': true, 'SSR': true, '其他': true },
    };

    function _searchIsMobile() {
      return window.matchMedia('(max-width: 768px)').matches;
    }

    function _searchPid() {
      return (typeof localPlayerId !== 'undefined' && localPlayerId) ? localPlayerId : '1';
    }

    /** 己方场上的式神名（排除召唤物） */
    function _searchOwnShikigami() {
      const pid = _searchPid();
      const zone = document.querySelector(`.player-zone[data-player="${pid}"]`);
      if (!zone) return [];
      const names = [];
      zone.querySelectorAll('.card-slot').forEach(function(slot) {
        if (slot.dataset.slotType === 'summon') return;
        const ni = slot.querySelector('.card-name');
        const n = ni ? ni.value.trim() : '';
        if (n && names.indexOf(n) === -1) names.push(n);
      });
      return names;
    }

    /** 机制入口：打开检索弹窗（🔍 检索按钮调用） */
    window.openSearchDialog = function() {
      if (typeof isSpectator !== 'undefined' && isSpectator) {
        broadcastSystemMsg('【系统】观众不能使用检索');
        return;
      }
      _searchEnsureOverlay();
      searchOverlay.hidden = false;
      searchOverlay.style.display = 'flex';
      _searchSetMode(searchMode);
      _searchHideError();
      _searchRenderRanges();
      _searchRenderResults();
    };

    function _searchClose() {
      if (!searchOverlay) return;
      searchOverlay.hidden = true;
      searchOverlay.style.display = 'none';
      // 关闭弹窗并清空检索结果（保留范围设置）
      searchResults = [];
      searchHasResult = false;
      _searchRenderResults();
    }

    function _searchEnsureOverlay() {
      if (searchOverlay) return;
      searchOverlay = document.createElement('div');
      searchOverlay.className = 'search-overlay';
      searchOverlay.hidden = true;
      searchOverlay.innerHTML = `
        <div class="search-dialog">
          <div class="search-dialog__header">
            <span class="search-dialog__title">🔍 检索</span>
            <button type="button" class="search-dialog__close" title="结束检索并关闭">✕</button>
          </div>
          <div class="search-dialog__scroll">
            <div class="search-ranges">
              <div class="search-range-row">
                <span class="search-range-label">式神</span>
                <div class="search-range-opts" id="search-opts-shikigami"></div>
              </div>
              <div class="search-range-row">
                <span class="search-range-label">等级</span>
                <div class="search-range-opts" id="search-opts-level"></div>
              </div>
              <div class="search-range-row">
                <span class="search-range-label">类型</span>
                <div class="search-range-opts" id="search-opts-type"></div>
              </div>
              <div class="search-range-row">
                <span class="search-range-label">稀有度</span>
                <div class="search-range-opts" id="search-opts-rarity"></div>
              </div>
            </div>
            <div class="search-error" id="search-error" hidden></div>
            <div class="search-method" id="search-method-discover">
              <label class="search-method__check">
                <input type="checkbox" id="search-cb-discover"><span>发现</span>
              </label>
              <div class="search-method__body">
                <div class="search-method__row">
                  <label class="search-method__label">从 <input type="number" id="search-discover-count" min="1" value="1" disabled> 张牌中随机发现</label>
                </div>
                <div class="search-method__row search-method__row--go">
                  <button type="button" class="search-go-btn" id="search-go-discover" disabled>发现</button>
                </div>
              </div>
            </div>
            <div class="search-method" id="search-method-name">
              <label class="search-method__check">
                <input type="checkbox" id="search-cb-name"><span>牌名</span>
              </label>
              <div class="search-method__body">
                <div class="search-method__row">
                  <label class="search-method__label">检索具体牌：<input type="text" id="search-name-input" placeholder="具体牌名" disabled></label>
                </div>
                <div class="search-method__row search-method__row--go">
                  <button type="button" class="search-go-btn" id="search-go-name" disabled>确定</button>
                </div>
              </div>
            </div>
            <div class="search-dialog__body" id="search-body"></div>
          </div>
          <div class="search-footer">
            <button type="button" class="search-end-btn" id="search-end-btn" hidden>结束检索</button>
          </div>
        </div>`;
      document.body.appendChild(searchOverlay);

      // 关闭：✕ 与「结束检索」等价（清空结果、保留范围）
      searchOverlay.querySelector('.search-dialog__close').addEventListener('click', _searchClose);
      searchOverlay.querySelector('#search-end-btn').addEventListener('click', _searchClose);
      // 手机端：拦截弹窗外滑动，防止滚动穿透到主战场
      searchOverlay.addEventListener('touchmove', (e) => {
        if (e.target.closest && e.target.closest('.search-dialog')) return;
        e.preventDefault();
      }, { passive: false });
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && searchOverlay && !searchOverlay.hidden) _searchClose();
      });

      // 勾选框二选一：勾选后内容可输入可点，未勾选灰置
      const cbDiscover = document.getElementById('search-cb-discover');
      const cbName = document.getElementById('search-cb-name');
      if (cbDiscover) cbDiscover.addEventListener('change', function() { _searchSetMode(this.checked ? 'discover' : ''); });
      if (cbName) cbName.addEventListener('change', function() { _searchSetMode(this.checked ? 'name' : ''); });

      // 范围开关
      searchOverlay.querySelector('.search-ranges').addEventListener('click', (e) => {
        const b = e.target.closest('.search-range-btn');
        if (!b) return;
        _searchHideError();
        const rg = b.dataset.rg, v = b.dataset.v;
        if (rg === 'shikigami') {
          if (v === 'all') {
            searchFilters.shikigami.all = !searchFilters.shikigami.all;
            if (searchFilters.shikigami.all) { searchFilters.shikigami.neutral = false; searchFilters.shikigami.names = []; }
          } else if (v === 'neutral') {
            searchFilters.shikigami.neutral = !searchFilters.shikigami.neutral;
            if (searchFilters.shikigami.neutral) searchFilters.shikigami.all = false;
          } else {
            const arr = searchFilters.shikigami.names;
            const i = arr.indexOf(v);
            if (i === -1) { arr.push(v); searchFilters.shikigami.all = false; }
            else arr.splice(i, 1);
          }
        } else if (rg === 'level') {
          searchFilters.levels[v] = !searchFilters.levels[v];
        } else if (rg === 'type') {
          searchFilters.types[v] = !searchFilters.types[v];
        } else if (rg === 'rarity') {
          searchFilters.rarities[v] = !searchFilters.rarities[v];
        }
        _searchRenderRanges();
      });

      // 发现 / 牌名检索（按钮禁用时不响应）
      document.getElementById('search-go-discover').addEventListener('click', function() {
        if (searchMode === 'discover') _searchDiscover();
      });
      document.getElementById('search-go-name').addEventListener('click', function() {
        if (searchMode === 'name') _searchByName();
      });
      document.getElementById('search-discover-count').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (searchMode === 'discover') _searchDiscover(); }
      });
      document.getElementById('search-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (searchMode === 'name') _searchByName(); }
      });

      // 结果操作
      document.getElementById('search-body').addEventListener('click', (e) => {
        const btn = e.target.closest('.search-item-btn');
        if (!btn) return;
        const card = searchResults[parseInt(btn.dataset.si, 10)];
        if (!card) return;
        if (btn.dataset.act === 'use') _searchUseCard(card);
        else _searchAddHand(card);
      });
    }

    /** 勾选框二选一：同步勾选状态与输入框/按钮灰置，并展开/收起对应卡片 */
    function _searchSetMode(mode) {
      searchMode = mode || '';
      const cbD = document.getElementById('search-cb-discover');
      const cbN = document.getElementById('search-cb-name');
      const inD = document.getElementById('search-discover-count');
      const inN = document.getElementById('search-name-input');
      const goD = document.getElementById('search-go-discover');
      const goN = document.getElementById('search-go-name');
      const mdD = document.getElementById('search-method-discover');
      const mdN = document.getElementById('search-method-name');
      if (cbD) cbD.checked = (searchMode === 'discover');
      if (cbN) cbN.checked = (searchMode === 'name');
      if (inD) inD.disabled = (searchMode !== 'discover');
      if (inN) inN.disabled = (searchMode !== 'name');
      if (goD) goD.disabled = (searchMode !== 'discover');
      if (goN) goN.disabled = (searchMode !== 'name');
      if (mdD) mdD.classList.toggle('open', searchMode === 'discover');
      if (mdN) mdN.classList.toggle('open', searchMode === 'name');
    }

    function _searchRenderRanges() {
      const f = searchFilters;
      const optsShiki = document.getElementById('search-opts-shikigami');
      const optsLevel = document.getElementById('search-opts-level');
      const optsType = document.getElementById('search-opts-type');
      const optsRarity = document.getElementById('search-opts-rarity');
      if (!optsShiki || !optsLevel || !optsType || !optsRarity) return;
      let html = `<button type="button" class="search-range-btn${f.shikigami.all ? ' active' : ''}" data-rg="shikigami" data-v="all">全部</button>`;
      html += `<button type="button" class="search-range-btn${f.shikigami.neutral ? ' active' : ''}" data-rg="shikigami" data-v="neutral">中立牌</button>`;
      _searchOwnShikigami().forEach(function(n) {
        html += `<button type="button" class="search-range-btn${f.shikigami.names.indexOf(n) !== -1 ? ' active' : ''}" data-rg="shikigami" data-v="${escapeHTML(n)}">${escapeHTML(n)}</button>`;
      });
      optsShiki.innerHTML = html;

      html = '';
      ['1', '2', '3', '其他'].forEach(function(lv) {
        html += `<button type="button" class="search-range-btn${f.levels[lv] ? ' active' : ''}" data-rg="level" data-v="${lv}">${lv === '其他' ? '其他' : lv + '级'}</button>`;
      });
      optsLevel.innerHTML = html;

      html = '';
      const typeNames = { battle: '战斗', spell: '法术', realm: '幻境', form: '形态', '其他': '其他' };
      Object.keys(typeNames).forEach(function(t) {
        html += `<button type="button" class="search-range-btn${f.types[t] ? ' active' : ''}" data-rg="type" data-v="${t}">${typeNames[t]}</button>`;
      });
      optsType.innerHTML = html;

      html = '';
      ['R', 'SR', 'SSR', '其他'].forEach(function(r) {
        html += `<button type="button" class="search-range-btn${f.rarities[r] ? ' active' : ''}" data-rg="rarity" data-v="${r}">${r}</button>`;
      });
      optsRarity.innerHTML = html;
    }

    /** 三个维度范围取交集，筛己方牌库 */
    function _searchFilteredDeck() {
      const pid = _searchPid();
      const state = getPlayerCardState(pid);
      const deck = state.deck || [];
      const f = searchFilters;
      const KNOWN_TYPES = ['battle', 'spell', 'realm', 'form'];
      const out = [];
      deck.forEach(function(card) {
        if (!card || typeof card !== 'object') return;
        const db = (typeof CardDB !== 'undefined' && CardDB.lookup) ? CardDB.lookup(card.name) : null;
        const typeRaw = (db && db.type) || card.type || '';
        const levelRaw = (db && db.level) || card.level || null;
        const owner = (db && db.owner) || card.owner || '中立';
        const dbRarity = (db && db.rarity) || card.rarity || '';
        // 未记录的等级/类型/稀有度归入「其他」
        const type = KNOWN_TYPES.indexOf(typeRaw) !== -1 ? typeRaw : '其他';
        const level = (levelRaw === 1 || levelRaw === 2 || levelRaw === 3) ? String(levelRaw) : '其他';
        const rarity = (dbRarity === 'R' || dbRarity === 'SR' || dbRarity === 'SSR') ? dbRarity : '其他';
        if (!f.types[type]) return;
        if (!f.levels[level]) return;
        if (!f.rarities[rarity]) return;
        if (f.shikigami.all) { out.push(card); return; }
        const isNeutral = (!owner || owner === '中立' || owner === '无相');
        if (isNeutral) {
          if (f.shikigami.neutral) out.push(card);
          return;
        }
        if (f.shikigami.names.indexOf(owner) !== -1) out.push(card);
      });
      return out;
    }

    function _searchValidate() {
      const f = searchFilters;
      const anyLevel = f.levels['1'] || f.levels['2'] || f.levels['3'] || f.levels['其他'];
      const anyType = f.types.battle || f.types.spell || f.types.realm || f.types.form || f.types['其他'];
      const anyShiki = f.shikigami.all || f.shikigami.neutral || f.shikigami.names.length > 0;
      const anyRarity = f.rarities['R'] || f.rarities['SR'] || f.rarities['SSR'] || f.rarities['其他'];
      if (!anyLevel || !anyType || !anyShiki || !anyRarity) {
        _searchShowError('请每种范围至少选择一个');
        return false;
      }
      return true;
    }

    /** 界面内红字提示（不发系统消息） */
    function _searchShowError(text) {
      const el = document.getElementById('search-error');
      if (!el) return;
      el.textContent = text;
      el.hidden = false;
    }

    function _searchHideError() {
      const el = document.getElementById('search-error');
      if (el) el.hidden = true;
    }

    function _searchDiscover() {
      _searchHideError();
      if (!_searchValidate()) return;
      const input = document.getElementById('search-discover-count');
      let x = parseInt(input && input.value, 10);
      if (isNaN(x) || x < 1) x = 1;
      const pool = _searchFilteredDeck().slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      searchResults = pool.slice(0, x);
      searchMethod = '发现';
      searchHasResult = true;
      broadcastSystemMsg(`【系统】${getPlayerName(_searchPid())}通过发现检索了牌`);
      _searchRenderResults();
    }

    function _searchByName() {
      _searchHideError();
      if (!_searchValidate()) return;
      const input = document.getElementById('search-name-input');
      const name = (input && input.value) ? input.value.trim() : '';
      if (!name) {
        _searchShowError('请输入牌名');
        return;
      }
      const pool = _searchFilteredDeck().filter(function(c) { return c && c.name === name; });
      searchResults = pool.length ? [pool[Math.floor(Math.random() * pool.length)]] : [];
      searchMethod = '牌名';
      searchHasResult = true;
      broadcastSystemMsg(`【系统】${getPlayerName(_searchPid())}通过牌名检索了牌`);
      _searchRenderResults();
    }

    /** 检索结果：取卡牌的等级/类型/稀有度标签（查库优先，牌面兜底；没有的不显示） */
    function _searchCardMeta(card) {
      if (!card || typeof card !== 'object') return '';
      const db = (typeof CardDB !== 'undefined' && CardDB.lookup) ? CardDB.lookup(card.name) : null;
      const lv = (db && db.level != null) ? db.level : card.level;
      const tp = (db && db.type) ? db.type : card.type;
      const rr = (db && db.rarity) ? db.rarity : card.rarity;
      const out = [];
      if (lv === 1 || lv === 2 || lv === 3) out.push('Lv.' + lv);
      const tnames = { battle: '战斗', spell: '法术', realm: '幻境', form: '形态' };
      if (tp && tnames[tp]) out.push(tnames[tp]);
      if (rr === 'R' || rr === 'SR' || rr === 'SSR') out.push(rr);
      return out.map(function(t) { return '<span class="search-item__tag">' + escapeHTML(t) + '</span>'; }).join('');
    }

    function _searchRenderResults() {
      const body = document.getElementById('search-body');
      const endBtn = document.getElementById('search-end-btn');
      if (!body) return;
      if (endBtn) endBtn.hidden = !searchHasResult;
      if (!searchOverlay || searchOverlay.hidden) return;
      if (searchResults.length === 0) {
        body.innerHTML = `<div class="search-empty">${searchHasResult ? '检索完成，没有可检索的卡牌' : '设置范围后，点击「发现」或「牌名」开始检索'}</div>`;
        return;
      }
      let html = '';
      searchResults.forEach(function(card, i) {
        const tags = _searchCardMeta(card);
        html += `<div class="search-item">
          <span class="search-item__no">${i + 1}</span>
          <div class="search-item__main">
            <span class="search-item__name">${escapeHTML(card.name || '未知卡牌')}</span>
            ${tags ? '<span class="search-item__tags">' + tags + '</span>' : ''}
          </div>
          <span class="search-item__btns">
            <button type="button" class="search-item-btn search-item-btn--use" data-si="${i}" data-act="use">使用</button>
            <button type="button" class="search-item-btn" data-si="${i}" data-act="hand">加入手牌</button>
          </span>
        </div>`;
      });
      body.innerHTML = html;
    }

    /** 从结果中移除某张牌并刷新列表 */
    function _searchDropCard(card) {
      searchResults = searchResults.filter(function(c) { return c && c.id !== card.id; });
      _searchRenderResults();
    }

    function _searchUseCard(card) {
      const pid = _searchPid();
      const state = getPlayerCardState(pid);
      const idx = state.deck.findIndex(function(c) { return c && c.id === card.id; });
      if (idx === -1) { _searchDropCard(card); return; }
      state.deck.splice(idx, 1);
      state.hand.push(card);
      // 复用现有“使用牌”流程（形态/幻境/觉醒/进坟场等），播报由检索逻辑统一发
      window._searchUseInProgress = true;
      try {
        removeFromHand(pid, card.id, 'use');
      } finally {
        window._searchUseInProgress = false;
      }
      // 使用牌双方都能看到，公开播报具体牌名（「」内牌名自动高亮可点击查看）
      broadcastSystemMsg(`【系统】${getPlayerName(pid)}通过检索从牌库使用了卡牌「${card.name}」`);
      _searchDropCard(card);
    }

    function _searchAddHand(card) {
      const pid = _searchPid();
      const state = getPlayerCardState(pid);
      const idx = state.deck.findIndex(function(c) { return c && c.id === card.id; });
      if (idx === -1) { _searchDropCard(card); return; }
      state.deck.splice(idx, 1);
      state.hand.push(card);
      updateDeckButtons(pid);
      refreshOpenListDialog(pid);
      syncDeckState(pid);
      // 飞行动画：牌库 → 手牌（与抽牌动画一致）
      if (typeof CardFlight !== 'undefined') {
        CardFlight.flyAndBroadcast(pid, 'deck', 'hand');
      }
      // 加入手牌是隐藏信息：牌名仅自己可见，双方只看到“加入了一张手牌”
      broadcastSystemMsg(`【系统】${getPlayerName(pid)}从牌库通过${searchMethod}检索加入了一张手牌`);
      if (typeof addSystemChatMessage === 'function') {
        addSystemChatMessage(`【系统】检索：加入了手牌「${card.name}」（此信息仅你可见）`);
      }
      _searchDropCard(card);
    }
