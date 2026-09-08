// ================================================================
//  js/card-flight.js — 卡牌飞行动画模块
//  提供卡牌图标从一处飞往另一处的动画效果
//  依赖: GSAP 3.x (CDN)
// ================================================================

const CardFlight = (() => {

  /** 从 DOM 元素中心获取屏幕坐标 */
  function _centerOf(el) {
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** 创建飞行的卡牌 DOM 元素 */
  function _createCard() {
    const card = document.createElement('div');
    card.className = 'card-flight-icon';
    document.body.appendChild(card);
    return card;
  }

  /**
   * 单张卡牌飞行
   * @param {HTMLElement|{x:number,y:number}} fromEl - 来源元素或坐标
   * @param {HTMLElement|{x:number,y:number}} toEl   - 目标元素或坐标
   * @param {Object} [opts]
   * @param {number} [opts.duration=0.5]  - 飞行时长(秒)
   * @param {number} [opts.delay=0]       - 延迟(秒)
   * @param {number} [opts.arcHeight=50]  - 弧高(px)，正数向上
   */
  function fly(fromEl, toEl, opts = {}) {
    if (typeof gsap === 'undefined') { console.warn('[CardFlight] GSAP 未加载'); return; }

    const from = (fromEl && typeof fromEl.x === 'number') ? fromEl : _centerOf(fromEl);
    const to   = (toEl   && typeof toEl.x   === 'number') ? toEl   : _centerOf(toEl);
    const duration = opts.duration || 0.5;
    const delay    = opts.delay || 0;
    const arcH     = -(opts.arcHeight || 50);

    const card = _createCard();

    const tl = gsap.timeline({
      delay,
      onComplete: () => card.remove()
    });

    // 起始
    tl.set(card, { x: from.x - 24, y: from.y - 33, scale: 0.3, rotation: -25, opacity: 0 });

    // 弹出
    tl.to(card, {
      opacity: 1, scale: 1.1, rotation: 0,
      duration: 0.12, ease: 'back.out(2.5)'
    }, 0);

    // 飞行 x
    tl.to(card, {
      x: to.x - 24,
      duration: duration,
      ease: 'power1.inOut'
    }, 0.08);

    // 飞行 y 弧线
    tl.to(card, {
      y: from.y - 33 + arcH,
      duration: duration * 0.4,
      ease: 'power2.out'
    }, 0.08);

    tl.to(card, {
      y: to.y - 33,
      duration: duration * 0.6,
      ease: 'power2.in'
    }, 0.08 + duration * 0.4);

    // 旋转微调
    tl.to(card, {
      rotation: 8,
      duration: duration * 0.5,
      ease: 'power1.out'
    }, 0.08);

    tl.to(card, {
      rotation: 0,
      duration: duration * 0.5,
      ease: 'power1.in'
    }, 0.08 + duration * 0.5);

    // 到达消失
    tl.to(card, {
      scale: 0.5, opacity: 0,
      duration: 0.25,
      ease: 'power2.in'
    }, duration + 0.02);

    return tl;
  }

  /**
   * 多张卡牌依次飞行
   * @param {number} count - 卡牌数量
   * @param {HTMLElement|{x:number,y:number}} fromEl
   * @param {HTMLElement|{x:number,y:number}} toEl
   * @param {Object} [opts]
   * @param {number} [opts.interval=0.15] - 每张间隔(秒)
   */
  function flySequence(count, fromEl, toEl, opts = {}) {
    if (typeof gsap === 'undefined') return;
    if (count < 1) return;
    const interval = opts.interval || 0.15;
    const tl = gsap.timeline();
    for (let i = 0; i < count; i++) {
      tl.add(() => fly(fromEl, toEl, { ...opts, delay: 0 }), i * interval);
    }
    return tl;
  }

  /**
   * 获取指定玩家区域的按钮元素
   * @param {'1'|'2'} playerId
   * @param {'deck'|'hand'|'oracle'|'draw'|'addHand'|'addDeck'} btnType
   */
  function getPlayerBtn(playerId, btnType) {
    const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
    if (!zone) return null;
    const map = {
      deck:    '.btn-deck[data-action="deck"]',
      hand:    '.btn-deck[data-action="hand"]',
      oracle:  '.btn-deck[data-action="oracle-zone"]',
      draw:    '.btn-deck[data-action="draw"]',
      addHand: '.btn-deck[data-action="add-hand"]',
      addDeck: '.btn-deck[data-action="add-deck"]',
      grave:   '.btn-deck--grave',
    };
    return zone.querySelector(map[btnType] || '');
  }

  /**
   * 洗牌动画：三张牌从牌库按钮旋出成三角形，旋转几圈后旋回
   * @param {string} playerId - '1' 或 '2'
   */
  function shuffleDeckAnim(playerId, _skipBroadcast) {
    if (typeof gsap === 'undefined') return;
    const deckBtn = getPlayerBtn(playerId, 'deck');
    if (!deckBtn) return;
    if (!_skipBroadcast) _broadcastAnim({ action: 'shuffle', playerId });
    const center = _centerOf(deckBtn);

    const cards = [];
    for (let i = 0; i < 3; i++) {
      const c = _createCard();
      cards.push(c);
    }

    // 三角形偏移（相对牌库按钮中心）
    const offsets = [
      { x: 0, y: -55 },
      { x: -48, y: 35 },
      { x: 48, y: 35 },
    ];

    const master = gsap.timeline({
      onComplete: () => cards.forEach(c => c.remove())
    });

    // 阶段1：弹出到三角形
    cards.forEach((c, i) => {
      const tx = center.x - 24 + offsets[i].x;
      const ty = center.y - 33 + offsets[i].y;
      master.fromTo(c,
        { x: center.x - 24, y: center.y - 33, scale: 0, rotation: -30, opacity: 0 },
        { x: tx, y: ty, scale: 1, rotation: 0, opacity: 1,
          duration: 0.3, ease: 'back.out(1.8)'
        }, 0);
    });

    // 阶段2：每张牌绕自身旋转 + 三张交换绕圈
    master.to(cards, {
      rotation: 720,
      duration: 1.2,
      ease: 'power2.inOut',
    }, 0.2);

    // 公转交换位置：0→2→1→0, 1→0→2→1, 2→1→0→2
    master.to(cards[0], {
      keyframes: [
        { x: center.x - 24 + offsets[2].x, y: center.y - 33 + offsets[2].y, duration: 0.4, ease: 'power1.inOut' },
        { x: center.x - 24 + offsets[1].x, y: center.y - 33 + offsets[1].y, duration: 0.4, ease: 'power1.inOut' },
        { x: center.x - 24 + offsets[0].x, y: center.y - 33 + offsets[0].y, duration: 0.4, ease: 'power1.inOut' },
      ]
    }, 0.2);
    master.to(cards[1], {
      keyframes: [
        { x: center.x - 24 + offsets[0].x, y: center.y - 33 + offsets[0].y, duration: 0.4, ease: 'power1.inOut' },
        { x: center.x - 24 + offsets[2].x, y: center.y - 33 + offsets[2].y, duration: 0.4, ease: 'power1.inOut' },
        { x: center.x - 24 + offsets[1].x, y: center.y - 33 + offsets[1].y, duration: 0.4, ease: 'power1.inOut' },
      ]
    }, 0.2);
    master.to(cards[2], {
      keyframes: [
        { x: center.x - 24 + offsets[1].x, y: center.y - 33 + offsets[1].y, duration: 0.4, ease: 'power1.inOut' },
        { x: center.x - 24 + offsets[0].x, y: center.y - 33 + offsets[0].y, duration: 0.4, ease: 'power1.inOut' },
        { x: center.x - 24 + offsets[2].x, y: center.y - 33 + offsets[2].y, duration: 0.4, ease: 'power1.inOut' },
      ]
    }, 0.2);

    // 阶段3：旋回牌库按钮
    master.to(cards, {
      x: center.x - 24, y: center.y - 33,
      scale: 0, rotation: 360,
      opacity: 0,
      duration: 0.35,
      ease: 'power2.in'
    }, 1.4);

    return master;
  }

  /** 快捷飞行并广播 */
  function flyAndBroadcast(playerId, fromType, toType, opts) {
    const fromEl = _resolveAnimTarget(playerId, fromType, null);
    const toEl   = toType ? _resolveAnimTarget(playerId, toType, null) : null;
    fly(fromEl, toEl, opts);
    _broadcastAnim({ action: 'fly-single', playerId, fromType, toType: toType || null, fromCoord: null, toCoord: null, opts });
  }

  /** 快捷序列飞行并广播 */
  function flySeqAndBroadcast(playerId, count, fromType, fromCoord, toType, opts) {
    const toEl = _resolveAnimTarget(playerId, toType, null);
    flySequence(count, fromCoord, toEl, opts);
    _broadcastAnim({ action: 'fly-seq', playerId, count, fromType, fromCoord, toType, toCoord: null, opts });
  }

  /** 每个玩家的预展示时间线 + 飞行卡牌，互不干扰 */
  let _playerPreview = { '1': null, '2': null };
  let _playerCards  = { '1': [], '2': [] };

  /** 联机广播动画消息 */
  function _broadcastAnim(data) {
    if (typeof isSoloMode !== 'undefined' && isSoloMode) return;
    if (!window._gameSocket || !window._gameSocket.connected) return;
    if (typeof sendToPeer !== 'function') return;
    sendToPeer({ type: 'fx-anim', anim: data });
  }

  /**
   * 使用牌的动画：卡牌从手牌飞出放大 → 翻转 → 预展示出现
   *   若提供 targetEl，预展示1秒后卡牌飞向目标（缩小+粒子特效）
   * @param {string} playerId
   * @param {Object} handCard - 手牌中的卡牌对象（含 _stack/_maxStack）
   * @param {Object} [opts]
   * @param {HTMLElement} [opts.targetEl] - 飞行目标元素（觉醒→式神框、形态→式神框、幻境→条目）
   */
  function playUseCardAnim(playerId, handCard, opts = {}) {
    if (typeof gsap === 'undefined') return;
    const cardName = handCard.name;
    const db = (typeof CardDB !== 'undefined') ? CardDB.lookup(cardName) : null;
    const targetEl = opts.targetEl || null;

    const handBtn = getPlayerBtn(playerId, 'hand');
    if (!handBtn) return;
    const src = _centerOf(handBtn);

    // 玩家一预览在上方(top:100)，玩家二在下方(bottom:100)
    const overlay = document.getElementById('card-preview-overlay');
    const preview = document.getElementById('card-preview');
    if (!overlay || !preview) return;

    const isP1 = playerId === '1';
    const isMobile = (typeof window.matchMedia === 'function') && window.matchMedia('(max-width: 768px)').matches;
    let previewTop, previewLeft;
    if (isMobile) {
      // 手机端：预展示固定在中间栏偏左，距左边 5px（P1 在栏上方，P2 在栏下方）
      const bar = document.querySelector('.center-dice-bar');
      const barRect = bar ? bar.getBoundingClientRect() : null;
      previewLeft = 5;
      previewTop = barRect
        ? (isP1 ? Math.max(4, barRect.top - 280 - 8) : barRect.bottom + 8)
        : (isP1 ? 100 : window.innerHeight - 380);
      preview.style.left = previewLeft + 'px';
      preview.style.top = previewTop + 'px';
      preview.style.bottom = 'auto';
    } else {
      previewTop  = isP1 ? 100 : window.innerHeight - 380;
      previewLeft = 200;
      preview.style.left = previewLeft + 'px';
      preview.style.top = isP1 ? previewTop + 'px' : 'auto';
      preview.style.bottom = isP1 ? 'auto' : '100px';
    }
    const centerX = previewLeft + 100;
    const centerY = previewTop + 140;
    const dst = { x: centerX - 24, y: centerY - 33 };
    const previewCenter = { x: centerX, y: centerY };

    /** 恢复预览位置（clearProps 会清除内联样式） */
    function _restorePreviewPos() {
      if (isMobile) {
        preview.style.left = '5px';
        preview.style.top = previewTop + 'px';
        preview.style.bottom = 'auto';
      } else {
        preview.style.left = '200px';
        preview.style.top = isP1 ? '100px' : 'auto';
        preview.style.bottom = isP1 ? 'auto' : '100px';
      }
    }

    // 终止该玩家上一个预展示 + 清除残留飞行卡牌
    if (_playerPreview[playerId]) {
      _playerPreview[playerId].kill();
      _playerPreview[playerId] = null;
      gsap.set(preview, { clearProps: 'all' });
      _restorePreviewPos();
    }
    _playerCards[playerId].forEach(c => c.remove());
    _playerCards[playerId] = [];
    overlay.hidden = true;

    // 填充预展示内容
    _fillCardPreview(preview, db, handCard);

    const card = _createCard();
    _playerCards[playerId].push(card);
    card.style.transformOrigin = 'center center';

    const master = gsap.timeline({
      onComplete: () => {
        card.remove();
        _playerCards[playerId] = _playerCards[playerId].filter(c => c !== card);
        _playerPreview[playerId] = null;
      }
    });
    _playerPreview[playerId] = master;

    // 联机广播（含目标信息，供远端重建飞行到目标阶段）
    let targetInfo = null;
    if (targetEl) {
      if (targetEl.classList.contains('card-slot')) {
        targetInfo = { type: 'slot', playerId, slotName: targetEl.querySelector('.card-name')?.value || '' };
      } else if (targetEl.classList.contains('effect-item')) {
        targetInfo = { type: 'realm', playerId, realmName: targetEl.querySelector('.effect-name')?.value || '' };
      }
    }
    _broadcastAnim({
      action: 'play-card', playerId, cardName,
      stack: handCard._stack, maxStack: handCard._maxStack,
      target: targetInfo
    });

    // 阶段1：飞行 + 放大到预展示大小（~4x）
    master.fromTo(card,
      { x: src.x - 24, y: src.y - 33, scale: 1, rotation: 0, opacity: 1 },
      { x: dst.x, y: dst.y, scale: 4, rotation: 0, opacity: 1,
        duration: 0.5, ease: 'power2.inOut'
      }, 0);

    // 阶段2：翻转消失，同时预展示出现
    master.to(card, {
      rotationY: 90, opacity: 0,
      duration: 0.3, ease: 'power2.in'
    }, 0.5);

    master.set(overlay, { hidden: false }, 0.8);
    master.fromTo(preview,
      { scale: 0.8, opacity: 0, rotationY: -90 },
      { scale: 1, opacity: 1, rotationY: 0,
        duration: 0.35, ease: 'back.out(1.5)'
      }, 0.8);

    if (targetEl) {
      // 阶段3：预展示2秒后，卡牌从预展示飞向目标（保持式神槽大小 + 到达粒子特效）
      const targetCenter = _centerOf(targetEl);
      const flightCard = _createCard();
      _playerCards[playerId].push(flightCard);
      flightCard.style.transformOrigin = 'center center';

      const flightStart = 2.8;   // 预展示0.8s出现 + 2s
      const flightDur  = 0.55;
      const arriveTime = flightStart + flightDur; // 3.35s

      // 飞行：从预览中心飞到目标中心，从预览大缩小到式神槽大小（~1.6x）
      master.fromTo(flightCard,
        { x: previewCenter.x - 24, y: previewCenter.y - 33, scale: 3, rotation: 0, opacity: 0 },
        { x: targetCenter.x - 24, y: targetCenter.y - 33, scale: 1.6, rotation: 0, opacity: 0.9,
          duration: flightDur, ease: 'power2.in'
        }, flightStart);

      // 到达后粒子特效 + 消失
      master.call(() => {
        _burstParticles(targetEl);
      }, null, arriveTime);

      master.to(flightCard, {
        scale: 0.3, opacity: 0,
        duration: 0.2, ease: 'power2.in'
      }, arriveTime);

      master.call(() => {
        flightCard.remove();
        _playerCards[playerId] = _playerCards[playerId].filter(c => c !== flightCard);
      }, null, arriveTime + 0.2);

      // 预展示在飞行开始后渐隐
      master.to(preview, {
        scale: 0.85, opacity: 0,
        duration: 0.35, ease: 'power2.in'
      }, flightStart + 0.2);

      master.set(overlay, { hidden: true }, flightStart + 0.6);
    } else {
      // 无目标：手机端 1.5 秒后渐隐消失，桌面端 3 秒
      const holdTime = isMobile ? 1.5 : 3;
      master.to(preview, {
        scale: 0.9, opacity: 0,
        duration: 0.4, ease: 'power2.in'
      }, holdTime);

      master.set(overlay, { hidden: true }, holdTime + 0.4);
    }
  }

  /** 粒子爆发特效（到达目标时） */
  function _burstParticles(targetEl) {
    if (!targetEl) return;
    const rect = targetEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const count = 8;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'card-flight-particle';
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.setProperty('--dx', Math.cos(angle) * (25 + Math.random() * 20) + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * (25 + Math.random() * 20) + 'px');
      document.body.appendChild(p);
      p.addEventListener('animationend', () => p.remove());
    }
  }

  /** 填充预展示卡牌内容 */
  function _fillCardPreview(preview, db, handCard) {
    const typeNames = { shikigami:'式神', summon:'召唤物', spell:'法术', battle:'战斗', form:'形态', realm:'幻境', curse:'灵咒', bond:'协战' };
    const cardName = handCard ? handCard.name : (db ? db.name : '???');

    // 等级
    const levelEl = preview.querySelector('#cp-level');
    if (db && db.level) { levelEl.querySelector('span').textContent = db.level; levelEl.style.display = ''; }
    else { levelEl.style.display = 'none'; }

    // 名称（含堆叠）
    const nameEl = preview.querySelector('#cp-name');
    const stack = (handCard && handCard._maxStack > 0) ? ` [${handCard._stack || 1}/${handCard._maxStack}]` : '';
    nameEl.textContent = cardName + stack;

    // 效果
    const effectEl = preview.querySelector('#cp-effect');
    effectEl.textContent = db ? (db.effect || db.ability || '') : '';
    // 自适应缩字：超出时逐级缩小到10px
    let effSize = 18;
    effectEl.style.fontSize = effSize + 'px';
    requestAnimationFrame(() => {
      while (effectEl.scrollHeight > effectEl.clientHeight + 2 && effSize > 10) {
        effSize -= 1;
        effectEl.style.fontSize = effSize + 'px';
      }
    });

    // 底部
    const footerEl = preview.querySelector('#cp-footer');
    if (db) {
      const typeCN = typeNames[db.type] || db.type;
      footerEl.textContent = (db.owner || '中立') + ' - ' + typeCN;
    } else {
      footerEl.textContent = '未录入数据';
    }
    // 自适应缩字：以该栏当前可视宽度为准，放不下就逐级缩小（1px步进）
    let size = 16;
    footerEl.style.fontSize = size + 'px';
    requestAnimationFrame(() => {
      const avail = footerEl.clientWidth || 168;
      while (footerEl.scrollWidth > avail && size > 8) {
        size -= 1;
        footerEl.style.fontSize = size + 'px';
      }
    });

    // 角落属性
    const statBL = preview.querySelector('#cp-stat-bl');
    const statBR = preview.querySelector('#cp-stat-br');
    statBL.textContent = ''; statBR.textContent = '';
    statBL.style.display = 'none'; statBR.style.display = 'none';

    if (!db) return;

    switch (db.type) {
      case 'battle':
      case 'bond':
        if ((db.atkBonus || 0) > 0)  { statBL.textContent = '+' + db.atkBonus;  statBL.style.display = ''; statBL.style.borderColor = 'rgba(80,200,180,0.7)'; statBL.style.color = '#50c8b4'; }
        else if ((db.atkBonus || 0) < 0) { statBL.textContent = '' + db.atkBonus; statBL.style.display = ''; statBL.style.borderColor = 'rgba(255,110,110,0.7)'; statBL.style.color = '#ff6e6e'; }
        else if (db.atkPenalty > 0){ statBL.textContent = '-' + db.atkPenalty; statBL.style.display = ''; statBL.style.borderColor = 'rgba(255,110,110,0.7)'; statBL.style.color = '#ff6e6e'; }
        if ((db.shieldBonus || 0) > 0) { statBR.textContent = '+' + db.shieldBonus; statBR.style.display = ''; statBR.style.borderColor = 'rgba(100,210,100,0.7)'; statBR.style.color = '#64d264'; }
        else if ((db.shieldBonus || 0) < 0) { statBR.textContent = '' + db.shieldBonus; statBR.style.display = ''; statBR.style.borderColor = 'rgba(255,110,110,0.7)'; statBR.style.color = '#ff6e6e'; }
        else if (db.shieldPenalty > 0){ statBR.textContent = '-' + db.shieldPenalty; statBR.style.display = ''; statBR.style.borderColor = 'rgba(255,110,110,0.7)'; statBR.style.color = '#ff6e6e'; }
        break;
      case 'spell':
        if (db.atkBonus > 0) { statBL.textContent = '+' + db.atkBonus; statBL.style.display = ''; statBL.style.borderColor = 'rgba(80,200,180,0.7)'; statBL.style.color = '#50c8b4'; }
        if (db.hpBonus > 0)  { statBR.textContent = '+' + db.hpBonus;  statBR.style.display = ''; statBR.style.borderColor = 'rgba(100,210,100,0.7)'; statBR.style.color = '#64d264'; }
        break;
      case 'realm':
        if (db.durability > 0) { statBR.textContent = '' + db.durability; statBR.style.display = ''; statBR.style.borderColor = 'rgba(200,160,240,0.7)'; statBR.style.color = '#c8a0f0'; }
        break;
      case 'form':
        if (db.attack != null) { statBL.textContent = '' + db.attack; statBL.style.display = ''; statBL.style.borderColor = 'rgba(80,200,180,0.7)'; statBL.style.color = '#50c8b4'; }
        if (db.hp != null)     { statBR.textContent = '' + db.hp;     statBR.style.display = ''; statBR.style.borderColor = 'rgba(255,130,130,0.7)'; statBR.style.color = '#ff8282'; }
        break;
      case 'shikigami':
      case 'summon':
        if (db.attack != null) { statBL.textContent = '' + db.attack; statBL.style.display = ''; statBL.style.borderColor = 'rgba(80,200,180,0.7)'; statBL.style.color = '#50c8b4'; }
        if (db.hp != null)     { statBR.textContent = '' + db.hp;     statBR.style.display = ''; statBR.style.borderColor = 'rgba(255,130,130,0.7)'; statBR.style.color = '#ff8282'; }
        break;
    }
  }

  /** 远端动画调度：对手/观众收到fx-anim消息后调用 */
  function playRemoteAnim(data) {
    if (!data || typeof gsap === 'undefined') return;
    switch (data.action) {
      case 'fly-single': {
        const fromEl = _resolveAnimTarget(data.playerId, data.fromType, data.fromCoord);
        const toEl   = _resolveAnimTarget(data.playerId, data.toType, data.toCoord);
        fly(fromEl, toEl, data.opts || {});
        break;
      }
      case 'fly-seq': {
        const fromEl = _resolveAnimTarget(data.playerId, data.fromType, data.fromCoord);
        const toEl   = _resolveAnimTarget(data.playerId, data.toType, data.toCoord);
        flySequence(data.count || 1, fromEl, toEl, data.opts || {});
        break;
      }
      case 'shuffle':
        shuffleDeckAnim(data.playerId, true);
        break;
      case 'play-card': {
        const cardName = data.cardName || '?';
        const db = (typeof CardDB !== 'undefined') ? CardDB.lookup(cardName) : null;
        const handCard = { name: cardName, _stack: data.stack, _maxStack: data.maxStack };
        const overlay = document.getElementById('card-preview-overlay');
        const preview = document.getElementById('card-preview');
        if (!overlay || !preview) return;

        const handBtn = getPlayerBtn(data.playerId, 'hand');
        if (!handBtn) return;
        const src = _centerOf(handBtn);

        const isP1 = data.playerId === '1';
        const previewTop  = isP1 ? 100 : window.innerHeight - 380;
        const previewLeft = 200;
        const centerX = previewLeft + 100;
        const centerY = previewTop + 140;
        const dst = { x: centerX - 24, y: centerY - 33 };
        const previewCenter = { x: centerX, y: centerY };

        preview.style.left = previewLeft + 'px';
        preview.style.top = isP1 ? previewTop + 'px' : 'auto';
        preview.style.bottom = isP1 ? 'auto' : '100px';

        if (_playerPreview[data.playerId]) {
          _playerPreview[data.playerId].kill();
          _playerPreview[data.playerId] = null;
          gsap.set(preview, { clearProps: 'all' });
          preview.style.left = previewLeft + 'px';
          preview.style.top = isP1 ? previewTop + 'px' : 'auto';
          preview.style.bottom = isP1 ? 'auto' : '100px';
        }
        _playerCards[data.playerId].forEach(c => c.remove());
        _playerCards[data.playerId] = [];
        overlay.hidden = true;

        _fillCardPreview(preview, db, handCard);

        const card = _createCard();
        _playerCards[data.playerId].push(card);
        card.style.transformOrigin = 'center center';

        const master = gsap.timeline({
          onComplete: () => {
            card.remove();
            _playerCards[data.playerId] = _playerCards[data.playerId].filter(c => c !== card);
            _playerPreview[data.playerId] = null;
          }
        });
        _playerPreview[data.playerId] = master;

        master.fromTo(card,
          { x: src.x - 24, y: src.y - 33, scale: 1, rotation: 0, opacity: 1 },
          { x: dst.x, y: dst.y, scale: 4, rotation: 0, opacity: 1, duration: 0.5, ease: 'power2.inOut' }, 0);
        master.to(card, { rotationY: 90, opacity: 0, duration: 0.3, ease: 'power2.in' }, 0.5);
        master.set(overlay, { hidden: false }, 0.8);
        master.fromTo(preview, { scale: 0.8, opacity: 0, rotationY: -90 }, { scale: 1, opacity: 1, rotationY: 0, duration: 0.35, ease: 'back.out(1.5)' }, 0.8);

        // 远端也重建飞行到目标阶段
        let remoteTarget = null;
        if (data.target) {
          remoteTarget = _findRemoteTarget(data.target);
        }
        if (remoteTarget) {
          const targetCenter = _centerOf(remoteTarget);
          const flightCard = _createCard();
          _playerCards[data.playerId].push(flightCard);
          flightCard.style.transformOrigin = 'center center';
          const flightStart = 2.8;
          const flightDur  = 0.55;
          const arriveTime = flightStart + flightDur;

          master.fromTo(flightCard,
            { x: previewCenter.x - 24, y: previewCenter.y - 33, scale: 3, rotation: 0, opacity: 0 },
            { x: targetCenter.x - 24, y: targetCenter.y - 33, scale: 1.6, rotation: 0, opacity: 0.9,
              duration: flightDur, ease: 'power2.in'
            }, flightStart);

          master.call(() => { _burstParticles(remoteTarget); }, null, arriveTime);
          master.to(flightCard, { scale: 0.3, opacity: 0, duration: 0.2, ease: 'power2.in' }, arriveTime);
          master.call(() => {
            flightCard.remove();
            _playerCards[data.playerId] = _playerCards[data.playerId].filter(c => c !== flightCard);
          }, null, arriveTime + 0.2);

          master.to(preview, { scale: 0.85, opacity: 0, duration: 0.35, ease: 'power2.in' }, flightStart + 0.2);
          master.set(overlay, { hidden: true }, flightStart + 0.6);
        } else {
          master.to(preview, { scale: 0.9, opacity: 0, duration: 0.4, ease: 'power2.in' }, 6.8);
          master.set(overlay, { hidden: true }, 7.2);
        }
        break;
      }
    }
  }

  /** 远端根据目标信息找回 DOM 元素 */
  function _findRemoteTarget(info) {
    if (!info) return null;
    const zone = document.querySelector(`.player-zone[data-player="${info.playerId}"]`);
    if (!zone) return null;
    if (info.type === 'slot') {
      const slots = zone.querySelectorAll('.card-slot');
      for (const slot of slots) {
        if (slot.querySelector('.card-name')?.value === info.slotName) return slot;
      }
      return slots[0] || null;
    }
    if (info.type === 'realm') {
      const items = zone.querySelectorAll('.effect-item');
      for (const item of items) {
        if (item.querySelector('.effect-name')?.value === info.realmName) return item;
      }
      return items[items.length - 1] || null;
    }
    return null;
  }

  /** 将动画目标描述解析为元素或坐标 */
  function _resolveAnimTarget(playerId, type, coord) {
    if (coord) return coord;
    if (type === 'hand') return getPlayerBtn(playerId, 'hand');
    if (type === 'deck') return getPlayerBtn(playerId, 'deck');
    if (type === 'oracle') return document.getElementById('btn-oracle-zone-' + playerId);
    if (type === 'addHand') return getPlayerBtn(playerId, 'addHand');
    if (type === 'addDeck') return getPlayerBtn(playerId, 'addDeck');
    if (type === 'grave') return getPlayerBtn(playerId, 'grave');
    return null;
  }

  return { fly, flySequence, shuffleDeckAnim, playUseCardAnim, playRemoteAnim, flyAndBroadcast, flySeqAndBroadcast, _broadcastAnim, getPlayerBtn, _centerOf };
})();
