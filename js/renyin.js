// ================================================================
//  js/renyin.js — 连引系统（六步筛选面板）
//  步骤1: 选择连引对象式神  步骤2: 设定各对象数量
//  步骤3: 筛选等级          步骤4: 筛选类型
//  步骤5: 筛选稀有度        步骤6: 标签过滤（必须全含 / 至少含一）
//  依赖: CardDB, game-core (战场卡槽), card-deck, chat
// ================================================================

const Renyin = (() => {
  let ctx = null;
  let overlay, dialog;
  let activePicker = null; // 当前打开的选择器标记，如 'must:keyword'，关闭时为 null

  // ── 固定选项 ──
  const LEVELS = ['1级', '2级', '3级', '其他'];
  const TYPES = ['战斗', '法术', '形态', '幻境', '其他'];
  const BASIC_TYPES = ['战斗', '法术', '形态', '幻境'];
  const RARITIES = ['R', 'SR', 'SSR', '其他'];
  const BASIC_RARITIES = ['R', 'SR', 'SSR'];
  const TYPE_MAP = { 'battle':'战斗','spell':'法术','form':'形态','realm':'幻境','shikigami':'式神','summon':'召唤物','curse':'灵咒','bond':'协战' };

  /** 英→中 卡牌类型 */
  function cnType(t) { return TYPE_MAP[t] || t || ''; }

  /** 灵咒后缀文本 */
  function curseSuffix(card) {
    if (!card || !card.curses || !card.curses.length) return '';
    return '（结附灵咒：' + card.curses.map(c => c.name + '×' + c.layers).join('、') + '）';
  }

  /** 获取己方战场上已方所有式神名称 */
  function getShikigamiNames(playerId) {
    const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
    if (!zone) return [];
    const slots = zone.querySelectorAll('.card-slot');
    const names = [];
    slots.forEach(s => {
      const n = (s.querySelector('.card-name') || {}).value || '';
      if (n.trim()) names.push(n.trim());
    });
    return names;
  }

  /** 判断一张牌属于哪个式神 */
  function getCardOwnerName(card) {
    if (!card || !card.name) return null;
    const db = CardDB.lookup(card.name);
    if (!db) return null;
    if (db.type === 'shikigami') return db.name;
    if (db.owner) return db.owner;
    return null;
  }

  // ================================================================
  //  初始化 DOM
  // ================================================================
  function init() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'renyin-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="renyin-dialog">
        <div class="renyin-dialog__header">
          <span class="renyin-dialog__title">🔗 连引</span>
          <button type="button" class="renyin-dialog__close" title="关闭">✕</button>
        </div>
        <div class="renyin-dialog__body" id="renyin-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.renyin-dialog__close').addEventListener('click', () => close(false));
  }

  // ================================================================
  //  公开入口
  // ================================================================
  function open(playerId, card) {
    init();
    const shikigamiNames = getShikigamiNames(playerId); // 只取有名字的
    const cardOwner = getCardOwnerName(card);

    // 动态构建目标列表：实际式神 + 中立
    const targets = shikigamiNames.map(name => ({ name, isShikigami: true }));
    targets.push({ name: '中立', isShikigami: false, isNeutral: true });
    const totalCount = targets.length; // 式神数 + 1(中立)

    // ── 默认值 ──
    let defaultSelectedIdx = targets.length - 1; // 默认中立（最后一个）
    if (cardOwner) {
      const found = targets.findIndex((t, i) => i < targets.length - 1 && t.name === cardOwner);
      if (found >= 0) defaultSelectedIdx = found;
    }
    const selectedIndices = new Set([defaultSelectedIdx]);

    // 数量数组与 targets 等长
    const quantities = targets.map(() => 0);
    quantities[defaultSelectedIdx] = 1;

    // 默认全选等级、类型、稀有度（均含「其他」）
    const levelSelected = new Set([1, 2, 3, 4]);
    const typeSelected = new Set(TYPES);
    const rarSelected = new Set(RARITIES);
    const must = { keywords: [], cards: [], descs: [] };
    const any = { keywords: [], cards: [], descs: [] };

    ctx = {
      playerId, card,
      targets, totalCount, selectedIndices, quantities,
      levelSelected, typeSelected, rarSelected,
      must, any,
      phase: 'conditions',
      foundCards: [], selectedIndex: -1,
    };

    renderConditions();
    overlay.hidden = false;
    overlay.style.display = 'flex';
  }

  function close(silent) {
    if (!silent && ctx && ctx.phase === 'results') {
      broadcastSystemMsg(`【系统】${getPlayerName(ctx.playerId)}取消了连引`);
    }
    overlay.hidden = true;
    overlay.style.display = 'none';
    ctx = null;
    activePicker = null;
  }

  // ================================================================
  //  阶段一：条件面板
  // ================================================================
  function renderConditions() {
    const body = document.getElementById('renyin-body');
    const cardName = ctx.card.name || '(未命名)';
    const t = ctx.targets;
    activePicker = null; // 重建面板时重置选择器状态

    body.innerHTML = `
      <div class="renyin-used-card">
        <div class="renyin-used-card__label">正在连引使用</div>
        <div class="renyin-used-card__name">「${cardName}」</div>
      </div>
      <!-- 步骤1 -->
      <div class="renyin-step">
        <div class="renyin-step__label">📌 第一步：连引哪些式神的牌？<span class="renyin-step__hint">（选择1-${ctx.totalCount}个）</span></div>
        <div class="renyin-columns" id="renyin-targets" style="grid-template-columns: repeat(${ctx.totalCount}, 1fr);">
          ${t.map((item, i) => {
            const sel = ctx.selectedIndices.has(i) ? ' renyin-col-item--selected' : '';
            const icon = item.isNeutral ? '⚪' : (item.isShikigami ? '🃏' : '⬜');
            const name = item.name || '(空位)';
            return `<div class="renyin-col-item${sel}" data-idx="${i}">
              <div class="renyin-col-item__icon">${icon}</div>
              <div class="renyin-col-item__name">${name}</div></div>`;
          }).join('')}
        </div>
      </div>
      <!-- 步骤2 -->
      <div class="renyin-step">
        <div class="renyin-step__label">🔢 第二步：每个对象搜几张？</div>
        <div class="renyin-columns" id="renyin-quantities" style="grid-template-columns: repeat(${ctx.totalCount}, 1fr);">
          ${t.map((item, i) => {
            const val = ctx.quantities[i] || 0;
            const name = item.name || '(空位)';
            return `<div class="renyin-col-item" style="cursor:default;">
              <div class="renyin-col-item__name">${name}</div>
              <input type="number" class="renyin-qty-input" data-idx="${i}" value="${val}" min="0" max="20">
            </div>`;
          }).join('')}
        </div>
      </div>
      <!-- 步骤3 -->
      <div class="renyin-step">
        <div class="renyin-step__label">⭐ 第三步：等级范围 <span class="renyin-step__hint">（选择1-4个）</span></div>
        <div class="renyin-btn-group" id="renyin-levels">
          ${LEVELS.map((lv, i) => {
            const lvNum = i + 1;
            const active = ctx.levelSelected.has(lvNum) ? ' renyin-opt-btn--active' : '';
            return `<span class="renyin-opt-btn${active}" data-lv="${lvNum}">${lv}</span>`;
          }).join('')}
        </div>
      </div>
      <!-- 步骤4 -->
      <div class="renyin-step">
        <div class="renyin-step__label">🎴 第四步：卡牌类型 <span class="renyin-step__hint">（选择1-5个）</span></div>
        <div class="renyin-btn-group" id="renyin-types">
          ${TYPES.map(t => {
            const active = ctx.typeSelected.has(t) ? ' renyin-opt-btn--active' : '';
            return `<span class="renyin-opt-btn${active}" data-type="${t}">${t}</span>`;
          }).join('')}
        </div>
      </div>
      <!-- 步骤5（新增）：稀有度 -->
      <div class="renyin-step">
        <div class="renyin-step__label">💎 第五步：稀有度 <span class="renyin-step__hint">（选择1-4个）</span></div>
        <div class="renyin-btn-group" id="renyin-rarities">
          ${RARITIES.map(r => {
            const active = ctx.rarSelected.has(r) ? ' renyin-opt-btn--active' : '';
            return `<span class="renyin-opt-btn${active}" data-rar="${r}">${r}</span>`;
          }).join('')}
        </div>
      </div>
      <!-- 步骤6 -->
      <div class="renyin-step">
        <div class="renyin-step__label">🏷 第六步：标签过滤 <span class="renyin-step__hint">（关键词 / 卡牌名 / 描述）</span></div>
        <div class="renyin-filter-block">
          <div class="renyin-filter-block__label">🔒 必须全含（以下所有条件都要满足）</div>
          <div class="renyin-filter-btns">
            <button type="button" class="renyin-filter-add-btn" data-kind="must" data-mode="keyword">🔑 ＋关键词</button>
            <button type="button" class="renyin-filter-add-btn" data-kind="must" data-mode="card">🃏 ＋卡牌名</button>
            <button type="button" class="renyin-filter-add-btn" data-kind="must" data-mode="desc">📄 ＋描述</button>
          </div>
          <div class="renyin-tag-list" id="renyin-must-list">${renderChips('must')}</div>
          <div class="renyin-filter-picker" id="renyin-must-kw-picker" hidden></div>
          <div class="renyin-filter-picker" id="renyin-must-text-picker" hidden></div>
        </div>
        <div class="renyin-filter-block">
          <div class="renyin-filter-block__label">🔓 至少含一（满足其中任意一个条件即可）</div>
          <div class="renyin-filter-btns">
            <button type="button" class="renyin-filter-add-btn" data-kind="any" data-mode="keyword">🔑 ＋关键词</button>
            <button type="button" class="renyin-filter-add-btn" data-kind="any" data-mode="card">🃏 ＋卡牌名</button>
            <button type="button" class="renyin-filter-add-btn" data-kind="any" data-mode="desc">📄 ＋描述</button>
          </div>
          <div class="renyin-tag-list" id="renyin-any-list">${renderChips('any')}</div>
          <div class="renyin-filter-picker" id="renyin-any-kw-picker" hidden></div>
          <div class="renyin-filter-picker" id="renyin-any-text-picker" hidden></div>
        </div>
      </div>
      <div class="renyin-actions">
        <button type="button" class="renyin-btn renyin-btn--cancel" id="renyin-cancel">取消</button>
        <button type="button" class="renyin-btn renyin-btn--search" id="renyin-search-btn">🔍 搜索牌库</button>
      </div>
    `;
    bindConditionsEvents(body);
  }

  function renderChips(kind) {
    const g = ctx[kind];
    const parts = [];
    g.keywords.forEach((t, i) => parts.push(chipHtml('keyword', kind, i, '🔑', t)));
    g.cards.forEach((t, i) => parts.push(chipHtml('card', kind, i, '🃏', t)));
    g.descs.forEach((t, i) => parts.push(chipHtml('desc', kind, i, '📄', t)));
    return parts.join('');
  }

  function chipHtml(mode, kind, idx, icon, text) {
    const dataAttrs = `data-kind="${kind}" data-mode="${mode}" data-idx="${idx}"`;
    return `<span class="renyin-tag-chip renyin-tag-chip--${mode}" ${dataAttrs}>${icon} ${escapeHTML(text)}<span class="renyin-tag-chip__del" ${dataAttrs}>✕</span></span>`;
  }

  function bindConditionsEvents(body) {
    // 步骤1：点击式神列
    body.querySelectorAll('#renyin-targets .renyin-col-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        const wasSelected = ctx.selectedIndices.has(idx);
        if (wasSelected) {
          ctx.selectedIndices.delete(idx);
          // 取消勾选时，若数量>0则归零
          if ((ctx.quantities[idx] || 0) > 0) {
            ctx.quantities[idx] = 0;
            const qtyInput = document.querySelector(`.renyin-qty-input[data-idx="${idx}"]`);
            if (qtyInput) qtyInput.value = 0;
          }
        } else {
          ctx.selectedIndices.add(idx);
          // 优化3：选中式神时，若数量为0则自动改为1
          if ((ctx.quantities[idx] || 0) === 0) {
            ctx.quantities[idx] = 1;
            const qtyInput = document.querySelector(`.renyin-qty-input[data-idx="${idx}"]`);
            if (qtyInput) qtyInput.value = 1;
          }
        }
        el.classList.toggle('renyin-col-item--selected');
      });
    });
    // 步骤2：数量输入
    body.querySelectorAll('#renyin-quantities .renyin-qty-input').forEach(inp => {
      inp.addEventListener('input', () => {
        const idx = parseInt(inp.dataset.idx, 10);
        let val = parseInt(inp.value, 10) || 0;
        if (val < 0) val = 0; if (val > 20) val = 20;
        ctx.quantities[idx] = val; inp.value = val;
        // 优化2：数量>0自动选择，数量=0自动取消
        const targetEl = document.querySelector(`#renyin-targets .renyin-col-item[data-idx="${idx}"]`);
        if (val > 0) {
          ctx.selectedIndices.add(idx);
          if (targetEl) targetEl.classList.add('renyin-col-item--selected');
        } else {
          ctx.selectedIndices.delete(idx);
          if (targetEl) targetEl.classList.remove('renyin-col-item--selected');
        }
      });
    });
    body.querySelectorAll('#renyin-levels .renyin-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lv = parseInt(btn.dataset.lv, 10);
        ctx.levelSelected[lv ? (ctx.levelSelected.has(lv) ? 'delete' : 'add') : 'add'](lv);
        btn.classList.toggle('renyin-opt-btn--active');
      });
    });
    body.querySelectorAll('#renyin-types .renyin-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        ctx.typeSelected[ctx.typeSelected.has(type) ? 'delete' : 'add'](type);
        btn.classList.toggle('renyin-opt-btn--active');
      });
    });
    body.querySelectorAll('#renyin-rarities .renyin-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = btn.dataset.rar;
        ctx.rarSelected[ctx.rarSelected.has(r) ? 'delete' : 'add'](r);
        btn.classList.toggle('renyin-opt-btn--active');
      });
    });
    body.querySelectorAll('.renyin-filter-add-btn').forEach(btn => {
      btn.addEventListener('click', () => openFilterPicker(btn.dataset.kind, btn.dataset.mode));
    });
    refreshChips('must');
    refreshChips('any');
    const searchBtn = document.getElementById('renyin-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', () => {
      body.querySelectorAll('#renyin-quantities .renyin-qty-input').forEach(inp => {
        const idx = parseInt(inp.dataset.idx, 10); ctx.quantities[idx] = parseInt(inp.value, 10) || 0;
      });
      if (!validateConditions(body)) return;
      doSearch();
    });
    const cancelBtn = document.getElementById('renyin-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => close(false));
  }

  /** 关闭全部选择器窗口（must/any 两组的关键词与文本窗） */
  function closeAllPickers() {
    ['must', 'any'].forEach(k => {
      const kw = document.getElementById(`renyin-${k}-kw-picker`);
      const txt = document.getElementById(`renyin-${k}-text-picker`);
      if (kw) kw.hidden = true;
      if (txt) txt.hidden = true;
    });
  }

  /** 打开关键词网格 / 卡牌名 / 描述选择器（再次点击同一按钮才关闭，同一时间只开一个） */
  function openFilterPicker(kind, mode) {
    const group = ctx[kind];
    const kwPicker = document.getElementById(`renyin-${kind}-kw-picker`);
    const textPicker = document.getElementById(`renyin-${kind}-text-picker`);
    const pickerKey = kind + ':' + mode;
    // 重复点击同一个按钮：关闭自己的窗口
    if (activePicker === pickerKey) {
      closeAllPickers();
      activePicker = null;
      return;
    }
    closeAllPickers();
    activePicker = pickerKey;

    if (mode === 'keyword') {
      const officialList = (typeof KEYWORD_DB_DATA !== 'undefined' && Array.isArray(KEYWORD_DB_DATA)) ? KEYWORD_DB_DATA : [];
      const playerKw = (typeof CardDB !== 'undefined' && CardDB.getPlayerKeywords) ? CardDB.getPlayerKeywords() : [];
      const list = officialList.concat(playerKw.map(function (k) { return { name: k.name, effect: k.effect, _playerKw: true }; }));
      if (!list.length) {
        kwPicker.innerHTML = `<div class="renyin-picker-empty">关键词库未加载（请刷新页面）</div>`;
        kwPicker.hidden = false;
        return;
      }
      kwPicker.innerHTML = `
        <div class="renyin-picker__header">
          <span>选择关键词（可连续添加多个）</span>
          <button type="button" class="renyin-picker__close" data-close-kind="${kind}">✕</button>
        </div>
        <div class="renyin-kw-grid">
          ${list.map(kw => {
            const picked = group.keywords.includes(kw.name);
            const tip = kw.effect ? escapeHTML(kw.effect) : '';
            return `<button type="button" class="renyin-kw-btn${picked ? ' renyin-kw-btn--picked' : ''}${kw._playerKw ? ' renyin-kw-btn--player' : ''}" data-kw="${escapeHTML(kw.name)}" title="${tip}">${escapeHTML(kw.name)}</button>`;
          }).join('')}
        </div>`;
      kwPicker.hidden = false;
      kwPicker.querySelector('.renyin-picker__close').addEventListener('click', () => { kwPicker.hidden = true; activePicker = null; });
      kwPicker.querySelectorAll('.renyin-kw-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.kw;
          if (!group.keywords.includes(name)) {
            group.keywords.push(name);
            refreshChips(kind);
          }
          btn.classList.add('renyin-kw-btn--picked');
        });
      });
      return;
    }

    // 卡牌名 / 描述：输入框 + 添加按钮
    const isCard = mode === 'card';
    const limitHit = isCard && kind === 'must' && group.cards.length >= 1;
    textPicker.innerHTML = `
      <div class="renyin-picker__header">
        <span>${isCard ? '添加卡牌名（必须全匹配）' : '添加描述（半匹配）'}</span>
        <button type="button" class="renyin-picker__close" data-close-kind="${kind}">✕</button>
      </div>
      ${limitHit
        ? `<div class="renyin-picker-msg">「必须全含」的卡牌名最多只能加一个</div>`
        : `<div class="renyin-tag-row">
             <input type="text" class="renyin-text-picker__input" maxlength="30" placeholder="${isCard ? '输入完整卡牌名' : '输入描述片段'}">
             <button type="button" class="renyin-tag-add-btn renyin-text-picker__add">＋添加</button>
           </div>
           <div class="renyin-picker__tip">${isCard ? '搜索到的牌名必须与输入完全相同' : '牌描述中包含这段文字即可。例如输入「鬼火」，能匹配「不消耗鬼火」'}</div>`}`;
    textPicker.hidden = false;
    textPicker.querySelector('.renyin-picker__close').addEventListener('click', () => { textPicker.hidden = true; activePicker = null; });
    const input = textPicker.querySelector('.renyin-text-picker__input');
    const addBtn = textPicker.querySelector('.renyin-text-picker__add');
    if (input && addBtn) {
      const doAdd = () => {
        const val = input.value.trim();
        if (!val) return;
        const arr = isCard ? group.cards : group.descs;
        if (!arr.includes(val)) {
          arr.push(val);
          refreshChips(kind);
        }
        textPicker.hidden = true;
        activePicker = null;
      };
      addBtn.addEventListener('click', doAdd);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
      input.focus();
    }
  }

  /** 刷新某组（must/any）的条件 chips 并绑定删除 */
  function refreshChips(kind) {
    const list = document.getElementById(`renyin-${kind}-list`);
    if (!list) return;
    list.innerHTML = renderChips(kind);
    list.querySelectorAll('.renyin-tag-chip__del').forEach(del => {
      del.addEventListener('click', () => {
        const g = ctx[del.dataset.kind];
        const arr = del.dataset.mode === 'card' ? g.cards : (del.dataset.mode === 'desc' ? g.descs : g.keywords);
        arr.splice(parseInt(del.dataset.idx, 10), 1);
        refreshChips(del.dataset.kind);
        syncKwPickerHighlight(del.dataset.kind);
      });
    });
  }

  /** 关键词网格里「已选」高亮与当前选择保持同步（网格打开时） */
  function syncKwPickerHighlight(kind) {
    const kwPicker = document.getElementById(`renyin-${kind}-kw-picker`);
    if (!kwPicker || kwPicker.hidden) return;
    const group = ctx[kind];
    kwPicker.querySelectorAll('.renyin-kw-btn').forEach(btn => {
      btn.classList.toggle('renyin-kw-btn--picked', group.keywords.includes(btn.dataset.kw));
    });
  }

  // 验证条件
  function validateConditions(body) {
    const errors = [];
    // 清除旧标记
    body.querySelectorAll('.renyin-step--error').forEach(el => el.classList.remove('renyin-step--error'));
    body.querySelectorAll('.renyin-validate-msg').forEach(el => el.remove());

    const totalQty = ctx.quantities.reduce((a, b) => a + b, 0);

    if (ctx.selectedIndices.size === 0) {
      errors.push({ el: document.getElementById('renyin-targets'), msg: '请至少选择一个式神' });
    }
    if (totalQty === 0) {
      errors.push({ el: document.getElementById('renyin-quantities'), msg: '请至少为一个式神设置1张' });
    }
    if (ctx.levelSelected.size === 0) {
      errors.push({ el: document.getElementById('renyin-levels'), msg: '请至少选择一个等级' });
    }
    if (ctx.typeSelected.size === 0) {
      errors.push({ el: document.getElementById('renyin-types'), msg: '请至少选择一个类型' });
    }
    if (ctx.rarSelected.size === 0) {
      errors.push({ el: document.getElementById('renyin-rarities'), msg: '请至少选择一个稀有度' });
    }

    if (errors.length > 0) {
      errors.forEach(err => {
        const step = err.el.closest('.renyin-step');
        if (step) step.classList.add('renyin-step--error');
        const msg = document.createElement('div');
        msg.className = 'renyin-validate-msg';
        msg.textContent = err.msg;
        err.el.appendChild(msg);
      });
      // 抖动窗口
      const dialog = body.closest('.renyin-dialog');
      if (dialog) {
        dialog.classList.add('renyin-shake');
        setTimeout(() => dialog.classList.remove('renyin-shake'), 400);
      }
      return false;
    }
    return true;
  }

  // ================================================================
  //  牌库搜索（多式神 × 各自数量）
  // ================================================================
  function doSearch() {
    const playerId = ctx.playerId;
    const state = getPlayerCardState(playerId);
    const deck = state.deck || [];
    const body = document.getElementById('renyin-body');
    body.innerHTML = `<div class="renyin-searching"><span class="spinner"></span>正在搜索牌库…</div>`;

    setTimeout(() => {
      let allPicked = [];
      ctx.selectedIndices.forEach(idx => {
        const qty = ctx.quantities[idx] || 0;
        if (qty <= 0) return;
        const target = ctx.targets[idx];
        const shikigamiName = target.name;

        // 按所属式神筛
        let pool = deck.filter(c => {
          if (c.id === ctx.card.id) return false;
          const owner = getCardOwnerName(c);
          if (target.isNeutral) {
            if (!owner) return true;
            const onField = ctx.targets.slice(0, -1).some(t => t.name === owner);
            return !onField;
          }
          return owner === shikigamiName;
        });

        // 等级
        if (ctx.levelSelected.size > 0 && ctx.levelSelected.size < 4) {
          pool = pool.filter(c => {
            const db = CardDB.lookup(c.name); if (!db) return true;
            const lv = db.level || 1;
            if (ctx.levelSelected.has(4)) { if (lv < 1 || lv > 3) return true; }
            return ctx.levelSelected.has(lv);
          });
        }

        // 类型（「其他」= 战斗/法术/形态/幻境之外的所有类型）
        if (ctx.typeSelected.size > 0 && ctx.typeSelected.size < TYPES.length) {
          pool = pool.filter(c => {
            const db = CardDB.lookup(c.name); if (!db) return true;
            const t = cnType(db.type);
            if (BASIC_TYPES.includes(t)) return ctx.typeSelected.has(t);
            return ctx.typeSelected.has('其他');
          });
        }

        // 稀有度（「其他」= R/SR/SSR 之外，如未标注稀有度的DIY卡）
        if (ctx.rarSelected.size > 0 && ctx.rarSelected.size < RARITIES.length) {
          pool = pool.filter(c => {
            const db = CardDB.lookup(c.name);
            const rr = (db && db.rarity) ? db.rarity : (c.rarity || '其他');
            if (BASIC_RARITIES.includes(rr)) return ctx.rarSelected.has(rr);
            return ctx.rarSelected.has('其他');
          });
        }

        // 第六步条件过滤（关键词 / 卡牌名 / 描述）
        pool = filterByConditions(pool);

        // 随机抽
        if (pool.length > 0) {
          const shuffled = shuffleCards(pool.slice());
          const picked = shuffled.slice(0, Math.min(qty, shuffled.length));
          picked.forEach(c => { c._renyinFrom = shikigamiName; });
          allPicked = allPicked.concat(picked);
        }
      });

      ctx.foundCards = allPicked;
      ctx.selectedIndex = -1;
      ctx.phase = 'results';
      // 系统提示搜索结果
      const totalFound = allPicked.length;
      const srchPlayerName = getPlayerName(ctx.playerId);
      if (totalFound > 0) {
        broadcastSystemMsg(`【系统】${srchPlayerName}连引搜索完成，找到了 ${totalFound} 张符合条件的牌`);
      } else {
        broadcastSystemMsg(`【系统】${srchPlayerName}连引搜索完成，未找到符合条件的牌`);
      }
      renderResults();
    }, 600);
  }

  function filterByConditions(pool) {
    const must = ctx.must, any = ctx.any;
    const hasMust = must.keywords.length > 0 || must.cards.length > 0 || must.descs.length > 0;
    const hasAny = any.keywords.length > 0 || any.cards.length > 0 || any.descs.length > 0;
    if (!hasMust && !hasAny) return pool;
    return pool.filter(c => {
      const db = CardDB.lookup(c.name);
      const dbKeywords = (db && Array.isArray(db.keywords)) ? db.keywords : [];
      const descText = db ? [db.effect, db.ability].filter(Boolean).join(' ') : '';
      const cardName = (c.name || '').trim();

      // 必须全含：每类条件都要满足
      if (hasMust) {
        if (must.keywords.some(k => !dbKeywords.includes(k))) return false;
        if (must.cards.some(n => cardName !== n)) return false;
        if (must.descs.some(d => !descText.includes(d))) return false;
      }
      // 至少含一：任一条条件满足即可
      if (hasAny) {
        const hit = any.keywords.some(k => dbKeywords.includes(k))
          || any.cards.some(n => cardName === n)
          || any.descs.some(d => descText.includes(d));
        if (!hit) return false;
      }
      return true;
    });
  }

  // ================================================================
  //  阶段二：结果展示
  // ================================================================
  function renderResults() {
    const body = document.getElementById('renyin-body');
    const card = ctx.card;
    const cardName = card.name || '(未命名)';
    const found = ctx.foundCards;
    const resultCards = [
      { card, isUsed: true, from: '使用的牌' },
      ...found.map(c => ({ card: c, isUsed: false, from: c._renyinFrom || '' })),
    ];

    body.innerHTML = `
      <div class="renyin-used-card">
        <div class="renyin-used-card__label">连引结果 — 请选择一张打出</div>
        <div class="renyin-used-card__name">共 ${resultCards.length} 张牌可选</div>
      </div>
      <div class="renyin-result-area">
        <div class="renyin-result-card-list" id="renyin-result-list">
          ${resultCards.map((item, idx) => {
            const c = item.card, cName = c.name || '(未命名)';
            const dbCard = CardDB.lookup(cName);
            const tagsText = dbCard ? [cnType(dbCard.type), dbCard.faction].filter(Boolean).join('/') : '';
            const levelText = dbCard ? (dbCard.level || 1) + '级' : '';
            const rarityRaw = (dbCard && dbCard.rarity) ? dbCard.rarity : (c.rarity || '');
            const rarityText = (rarityRaw === 'R' || rarityRaw === 'SR' || rarityRaw === 'SSR') ? rarityRaw : '其他';
            const selClass = ctx.selectedIndex === idx ? ' renyin-result-card--selected' : '';
            const usedClass = item.isUsed ? ' renyin-result-card--used' : '';
            // 灵咒显示（支持悬停浮窗，与卡牌浮窗不冲突）
            const cursesHtml = (c.curses && c.curses.length) ? `<div class="renyin-result-card__curses">${c.curses.map(cu => `<span class="card-list-curse-tag" data-curse-name="${cu.name}">⛓️${cu.name}×${cu.layers}</span>`).join(' ')}</div>` : '';
            return `<div class="renyin-result-card${selClass}${usedClass}" data-result-idx="${idx}">
              <div class="renyin-result-card__icon">${item.isUsed ? '⭐' : '🃏'}</div>
              <div class="renyin-result-card__info">
                <div class="renyin-result-card__name card-list-item__name">${cName}</div>
                ${tagsText ? `<div class="renyin-result-card__tags">${tagsText}</div>` : ''}
                ${cursesHtml}
              </div>
              ${rarityText ? `<span class="renyin-result-card__badge">${rarityText}</span>` : ''}
              ${levelText ? `<span class="renyin-result-card__badge">${levelText}</span>` : ''}
              ${item.isUsed ? '<span class="renyin-result-card__badge" style="background:rgba(160,100,220,0.3);color:#d4b8f0;">使用的牌</span>' : ''}
              ${!item.isUsed && item.from ? `<span class="renyin-result-card__badge" style="background:rgba(80,140,180,0.2);color:#a0d0e0;">${item.from}</span>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="renyin-actions">
        <button class="renyin-btn renyin-btn--cancel" id="renyin-back-btn">← 返回条件</button>
        <button class="renyin-btn renyin-btn--confirm" id="renyin-confirm-btn" disabled>✅ 确认选择</button>
      </div>
    `;

    body.querySelectorAll('.renyin-result-card').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.resultIdx, 10);
        ctx.selectedIndex = idx;
        body.querySelectorAll('.renyin-result-card').forEach(e => {
          e.classList.remove('renyin-result-card--selected');
          // 恢复 used 标记（除当前选中项外）
          if (e.dataset.resultIdx === '0') {
            if (idx !== 0) e.classList.add('renyin-result-card--used');
            else e.classList.remove('renyin-result-card--used');
          }
        });
        el.classList.add('renyin-result-card--selected');
        const confirmBtn = document.getElementById('renyin-confirm-btn');
        if (confirmBtn) confirmBtn.disabled = false;
      });
    });
    const confirmBtn = document.getElementById('renyin-confirm-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmSelection);
    const backBtn = document.getElementById('renyin-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => {
      broadcastSystemMsg(`【系统】${getPlayerName(ctx.playerId)}返回了连引条件设置`);
      ctx.phase = 'conditions'; ctx.foundCards = []; ctx.selectedIndex = -1; renderConditions();
    });
  }

  // ================================================================
  //  确认选择
  // ================================================================
  function confirmSelection() {
    if (ctx.selectedIndex < 0) return;
    const playerId = ctx.playerId;
    const state = getPlayerCardState(playerId);
    const usedCard = ctx.card;
    const foundCards = ctx.foundCards;

    const allResultCards = [usedCard, ...foundCards];
    const selectedResult = allResultCards[ctx.selectedIndex];

    const handIdx = state.hand.findIndex(c => c.id === usedCard.id);
    if (handIdx >= 0) state.hand.splice(handIdx, 1);

    const playerName = getPlayerName(playerId);
    const isOwnView = typeof isViewingOwnCards === 'function' ? isViewingOwnCards(playerId) : true;
    let returnCount = 0;

    if (selectedResult.id === usedCard.id) {
      moveToGrave(playerId, usedCard);
      broadcastSystemMsg(`【系统】${playerName}连引使用了「${usedCard.name}」${curseSuffix(usedCard)}`);
      // 连引使用：处理幻境/形态/觉醒
      _applyUsedCardEffect(playerId, usedCard);
      // 连引出的牌本就在牌库中，不重复放回，仅打乱位置（等同洗回随机位置）
      const returnedNames = foundCards.map(c => c.name);
      returnCount = foundCards.length;
      shuffleCards(state.deck);
      // 广播通用版（不给牌名），本地显示详细版
      broadcastSystemMsg(`【系统】其余 ${returnCount} 张牌已随机洗回牌库`);
      if (isOwnView && returnCount > 0) {
        addSystemChatMessage(`【系统】洗回牌库：「${returnedNames.join('」、「')}」共 ${returnCount} 张（此信息仅你可见）`);
      }
    } else {
      const sel = foundCards.findIndex(c => c.id === selectedResult.id);
      if (sel >= 0) foundCards.splice(sel, 1);
      // 连引出的牌是牌库里的真实牌：从牌库中真正移除使用掉的这张
      for (let i = state.deck.length - 1; i >= 0; i--) {
        if (state.deck[i] && state.deck[i].id === selectedResult.id) state.deck.splice(i, 1);
      }
      moveToGrave(playerId, selectedResult);
      broadcastSystemMsg(`【系统】${playerName}连引使用了「${selectedResult.name}」${curseSuffix(selectedResult)}`);
      // 连引使用：处理幻境/形态/觉醒
      _applyUsedCardEffect(playerId, selectedResult);
      // 仅原使用的牌 A 洗回牌库；其余未选的连引牌本就在牌库，打乱位置即可
      const returnedNames = [usedCard.name, ...foundCards.map(c => c.name)];
      state.deck.push(usedCard);
      returnCount = 1 + foundCards.length;
      shuffleCards(state.deck);
      broadcastSystemMsg(`【系统】其余 ${returnCount} 张牌已随机洗回牌库`);
      if (isOwnView && returnCount > 0) {
        addSystemChatMessage(`【系统】洗回牌库：「${returnedNames.join('」、「')}」共 ${returnCount} 张（此信息仅你可见）`);
      }
    }

    // 洗牌后：清除占卜/命运抉择揭示（与手动洗牌一致，牌序已变，看过的不再有效）
    if (typeof playerRevealedCards !== 'undefined') {
      Object.keys(playerRevealedCards).forEach(k => { delete playerRevealedCards[k]; });
    }
    if (typeof playerFateRevealedCards !== 'undefined') {
      Object.keys(playerFateRevealedCards).forEach(k => { delete playerFateRevealedCards[k]; });
    }
    if (typeof isConnected === 'function' && isConnected() && typeof sendToPeer === 'function') {
      ['1', '2'].forEach(pid => {
        sendToPeer({ type: 'revealed-cards', playerId: pid, cardIds: [] });
        sendToPeer({ type: 'fate-revealed-cards', playerId: pid, cardIds: [] });
      });
    }

    updateDeckButtons(playerId);
    if (typeof refreshOpenListDialog === 'function') refreshOpenListDialog(playerId);
    if (typeof syncDeckState === 'function') syncDeckState(playerId);

    // 回牌库动画：广播给对手/观众
    if (returnCount > 0 && typeof CardFlight !== 'undefined') {
      const dialogEl = document.querySelector('.renyin-dialog');
      const deckBtn = CardFlight.getPlayerBtn ? CardFlight.getPlayerBtn(playerId, 'deck') : null;
      if (dialogEl && deckBtn) {
        const rect = dialogEl.getBoundingClientRect();
        const fromPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        // 使用广播版本，对手也能看到动画
        CardFlight.flySeqAndBroadcast(playerId, returnCount, null, fromPos, 'deck', { interval: 0.12, arcHeight: 60 });
      }
    }

    close(true);
    if (typeof CardFlight !== 'undefined') CardFlight.playUseCardAnim(playerId, selectedResult);
  }

  function moveToGrave(playerId, card) {
    const state = getPlayerCardState(playerId);
    if (!state.grave) state.grave = [];
    state.grave.push(card);
  }

  /** 连引使用牌后应用效果（幻境/形态/觉醒） */
  function _applyUsedCardEffect(playerId, card) {
    const dbCard = CardDB.lookup(card.name);
    if (!dbCard) return;
    const playerName = getPlayerName(playerId);

    // 幻境牌：添加到效果区
    if (dbCard.type === 'realm') {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (zone && typeof createEffectItem === 'function') {
        const panel = zone.querySelector('.effects-panel');
        if (panel) {
          const item = createEffectItem();
          item.querySelector('.effect-name').value = dbCard.name;
          item.querySelector('.effect-value').value = String(dbCard.durability || 1);
          panel.appendChild(item);
          if (typeof syncEffectsState === 'function') syncEffectsState(playerId);
          broadcastSystemMsg(`${playerName}展开了幻境「${dbCard.name}」（耐久${dbCard.durability || 1}）`);
        }
      }
    }

    // 形态牌：结附到所属式神
    if (dbCard.type === 'form' && dbCard.owner) {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (zone) {
        const slots = zone.querySelectorAll('.card-slot');
        for (const slot of slots) {
          if ((slot.querySelector('.card-name') || {}).value === dbCard.owner) {
            if (typeof window.equipFormOnSlot === 'function') {
              window.equipFormOnSlot(slot, dbCard.name, dbCard.attack || 0, dbCard.hp || 0, dbCard.effect || '');
            } else {
              slot._formName = dbCard.name;
              slot._formAtk = dbCard.attack || 0;
              slot._formHp = dbCard.hp || 0;
              slot._formAbility = dbCard.effect || '';
              if (typeof syncSlotToPeer === 'function') syncSlotToPeer(slot);
              if (typeof autoUpdateSlotImage === 'function') autoUpdateSlotImage(slot);
              if (typeof renderFormBadge === 'function') renderFormBadge(slot);
            }
            broadcastSystemMsg(`${playerName}为「${dbCard.owner}」结附了形态「${dbCard.name}」`);
            break;
          }
        }
      }
    }

    // 觉醒牌：设置觉醒标记和永久属性
    if (dbCard.awakened && dbCard.owner) {
      const zone = document.querySelector(`.player-zone[data-player="${playerId}"]`);
      if (zone) {
        const slots = zone.querySelectorAll('.card-slot');
        for (const slot of slots) {
          if ((slot.querySelector('.card-name') || {}).value === dbCard.owner) {
            slot.classList.add('awakened');
            if (!slot._permAtkMods) slot._permAtkMods = [];
            if (!slot._permHpMods) slot._permHpMods = [];
            slot._permAtkMods.push({ source: dbCard.name, value: dbCard.atkBonus || 0, layers: 1 });
            slot._permHpMods.push({ source: dbCard.name, value: dbCard.hpBonus || 0, layers: 1 });
            if (typeof syncSlotToPeer === 'function') syncSlotToPeer(slot);
            if (typeof autoUpdateSlotImage === 'function') autoUpdateSlotImage(slot);
            break;
          }
        }
      }
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }

  return { open, close };
})();
