// ================================================================
//  js/my-lib.js — 大厅「DIY 我的卡库」面板
//  服务器端个人卡库：式神（可含召唤物）/ 卡牌 / 其他（关键词、灵咒）
//  规则：合计 ≤ 1000 个单位；每个描述 ≤ 200 字；脏话只由服务器拦截；
//        与官方同名拦截；玩家库只能在大厅修改，对局/导入不写入
//  弹窗：只能点「取消」关闭，点弹窗外面不关闭
// ================================================================

var MyLib = (function () {
  var cache = { shikigami: [], cards: [], others: [] };
  var MAX_UNITS = 1000;
  var MAX_TEXT = 200;

  // ── 工具 ──
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function showError(msg, isOk) {
    var el = $('diy-error');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'block' : 'none';
    el.style.color = isOk ? '#7ed9a0' : '#ff9a9a';
  }

  function socket() {
    return (window._gameSocket && window._gameSocket.connected) ? window._gameSocket : null;
  }

  // ── 校验 ──
  function validateName(kind, name) {
    if (!name || !String(name).trim()) return kind + '缺少名称';
    var s = String(name).trim();
    if (s.length > 40) return '名称过长（最多 40 字）';
    if (typeof CardDB !== 'undefined' && CardDB.isOfficialName && CardDB.isOfficialName(s)) {
      return '「' + s + '」与官方卡牌同名，请换个名字';
    }
    return null;
  }

  function validateText(kind, name, text) {
    if (!text) return null;
    var s = String(text);
    if (s.length > MAX_TEXT) return kind + '「' + name + '」的描述超过 ' + MAX_TEXT + ' 字';
    return null;
  }

  /** 根据描述自动检测关键词（官方 + 玩家自定义：含当前DIY页签添加的关键词） */
  function detectKeywords(desc) {
    if (!desc) return [];
    var found = [];
    var list = [];
    // 官方关键词（对局中还会带上双方玩家关键词）
    if (typeof CardDB !== 'undefined' && CardDB.getAllKeywords) {
      list = list.concat(CardDB.getAllKeywords());
    }
    // 大厅DIY页签未开局，玩家自己的关键词在 cache.others 里，一并检测
    cache.others.forEach(function (o) {
      if (o && o.type !== 'curse' && o.name && desc.indexOf(o.name) !== -1) {
        if (found.indexOf(o.name) === -1) found.push(o.name);
      }
    });
    list.forEach(function (kw) {
      if (kw && kw.name && desc.indexOf(kw.name) !== -1 && found.indexOf(kw.name) === -1) {
        found.push(kw.name);
      }
    });
    return found;
  }

  /** 标签输入 → 数组（按逗号/顿号/空格切分） */
  function parseTags(text) {
    if (!text) return [];
    return String(text).split(/[,，、\s]+/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  // ── 弹窗基座 ──
  function openModal(titleHTML, bodyHTML) {
    var ov = document.createElement('div');
    ov.className = 'diy-modal-overlay';
    ov.innerHTML = '<div class="diy-modal">' +
      '<h3>' + titleHTML + '</h3>' +
      bodyHTML +
      '<div class="diy-modal-err" id="diy-modal-err"></div>' +
      '<div class="diy-modal-actions">' +
      '<button type="button" class="diy-btn diy-btn-ok" id="diy-modal-ok">保存</button>' +
      '<button type="button" class="diy-btn diy-btn-cancel" id="diy-modal-cancel">取消</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    // 只能点「取消」关闭（点弹窗外面不关闭）
    $('diy-modal-cancel').addEventListener('click', function () { ov.remove(); });
    return {
      ov: ov,
      err: $('diy-modal-err'),
      onOk: function (fn) { $('diy-modal-ok').addEventListener('click', fn); },
    };
  }

  function fieldHTML(label, id, inner, required) {
    return '<label class="diy-field"><span>' + label + (required ? ' <i style="color:#FB7185">*</i>' : '') + '</span>' + inner + '</label>';
  }
  function inputHTML(id, ph, type, extra) {
    return '<input type="' + (type || 'text') + '" id="' + id + '" placeholder="' + esc(ph || '') + '" ' + (extra || '') + '>';
  }

  // ═══════════════ 式神（含召唤物） ═══════════════
  function openShikigamiEdit(idx) {
    var unit = cache.shikigami[idx];
    var isSummon = !!(unit && unit.type === 'summon');
    var m = openModal('式神' + (idx >= 0 ? '编辑' : '新增'), [
      fieldHTML('名称', 'diy-f-name', inputHTML('diy-f-name', '必填，不能与官方卡牌同名', 'text', 'maxlength="40"'), true),
      '<div class="diy-row">' +
      fieldHTML('派系', 'diy-f-faction', '<select id="diy-f-faction">' + ['苍叶', '红莲', '青岚', '紫岩', '无相'].map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select>') +
      fieldHTML('攻击', 'diy-f-atk', inputHTML('diy-f-atk', '0', 'number', 'min="0" max="99"'), true) +
      fieldHTML('生命', 'diy-f-hp', inputHTML('diy-f-hp', '1', 'number', 'min="1" max="99"'), true) +
      '</div>',
      '<label class="diy-field diy-check"><input type="checkbox" id="diy-f-summon"><span style="display:inline;margin:0 6px 0 0;">是否为召唤物</span></label>',
      '<div id="diy-f-owner-wrap" style="display:none">' + fieldHTML('所属式神', 'diy-f-owner', inputHTML('diy-f-owner', '召唤物所属的式神（必填）', 'text', 'maxlength="40"'), true) + '</div>',
      fieldHTML('能力描述（≤200字）', 'diy-f-text', '<textarea id="diy-f-text" maxlength="200" rows="3" placeholder="能力/效果描述"></textarea>'),
    ].join(''));
    $('diy-f-name').value = unit ? (unit.name || '') : '';
    $('diy-f-faction').value = (unit && unit.faction) || '苍叶';
    $('diy-f-atk').value = (unit && unit.attack != null) ? unit.attack : '';
    $('diy-f-hp').value = (unit && unit.hp != null) ? unit.hp : '';
    $('diy-f-text').value = (unit && unit.ability) || '';
    $('diy-f-summon').checked = isSummon;
    function syncOwner() {
      var wrap = $('diy-f-owner-wrap');
      if (wrap) wrap.style.display = $('diy-f-summon').checked ? '' : 'none';
      var ownEl = $('diy-f-owner');
      if (ownEl) ownEl.value = isSummon && unit && unit.owner ? unit.owner : '';
    }
    syncOwner();
    $('diy-f-summon').addEventListener('change', syncOwner);

    m.onOk(function () {
      var name = $('diy-f-name').value.trim();
      var err = validateName('式神', name);
      if (!err) err = validateText('式神', name, $('diy-f-text').value);
      if (!err && $('diy-f-atk').value === '') err = '请填写攻击力';
      if (!err && !$('diy-f-hp').value) err = '请填写生命值';
      if (!err && $('diy-f-summon').checked) {
        var owner = $('diy-f-owner').value.trim();
        if (!owner) err = '请填写召唤物的所属式神';
      }
      if (err) { m.err.textContent = err; return; }
      var saved = {
        name: name,
        faction: $('diy-f-faction').value || '苍叶',
        attack: parseInt($('diy-f-atk').value, 10) || 0,
        hp: parseInt($('diy-f-hp').value, 10) || 1,
        ability: $('diy-f-text').value.trim()
      };
      if ($('diy-f-summon').checked) {
        saved.type = 'summon';
        saved.owner = $('diy-f-owner').value.trim();
      }
      if (idx >= 0) cache.shikigami[idx] = saved; else cache.shikigami.push(saved);
      m.ov.remove();
      render();
      saveToServer();
    });
  }

  // ═══════════════ 卡牌 ═══════════════
  var CARD_TYPES = [['spell', '法术'], ['battle', '战斗'], ['form', '形态'], ['realm', '幻境']];

  function openCardEdit(idx) {
    var unit = cache.cards[idx];
    var m = openModal('卡牌' + (idx >= 0 ? '编辑' : '新增'), [
      fieldHTML('名称', 'diy-f-name', inputHTML('diy-f-name', '必填，不能与官方卡牌同名', 'text', 'maxlength="40"'), true),
      fieldHTML('所属式神', 'diy-f-owner', inputHTML('diy-f-owner', '选填', 'text', 'maxlength="40"')),
      '<div class="diy-row">' +
      fieldHTML('等级', 'diy-f-level', '<select id="diy-f-level"><option>1</option><option>2</option><option>3</option></select>', true) +
      fieldHTML('类型', 'diy-f-type', '<select id="diy-f-type">' + CARD_TYPES.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('') + '</select>', true) +
      fieldHTML('稀有度', 'diy-f-rarity', '<select id="diy-f-rarity"><option value="R">R</option><option value="SR">SR</option><option value="SSR">SSR</option></select>', true) +
      '</div>',
      '<div class="diy-row">' +
      '<label class="diy-field diy-check"><input type="checkbox" id="diy-f-awakened"><span style="display:inline;margin:0;">觉醒</span></label>' +
      '<label class="diy-field diy-check"><input type="checkbox" id="diy-f-derivative"><span style="display:inline;margin:0;">衍生</span></label>' +
      '</div>',
      '<div id="diy-f-dynamic"></div>',
      fieldHTML('描述（≤200字）', 'diy-f-text', '<textarea id="diy-f-text" maxlength="200" rows="3" placeholder="卡牌效果描述，保存时自动检测关键词"></textarea>'),
      fieldHTML('标签', 'diy-f-tags', inputHTML('diy-f-tags', '额外类型，例如符咒、协战', 'text', 'maxlength="100"')),
    ].join(''));

    function renderDynamic() {
      var type = $('diy-f-type').value;
      var awakened = $('diy-f-awakened').checked;
      var html = '';
      if (type === 'spell') {
        if (awakened) {
          var ab = (unit && unit.atkBonus != null) ? unit.atkBonus : 0;
          var hb = (unit && unit.hpBonus != null) ? unit.hpBonus : 0;
          html = '<div class="diy-row">' +
            fieldHTML('+力量（觉醒加成）', 'diy-f-atkbonus', inputHTML('diy-f-atkbonus', '0', 'number', 'value="' + ab + '"'), true) +
            fieldHTML('+生命（觉醒加成）', 'diy-f-hpbonus', inputHTML('diy-f-hpbonus', '0', 'number', 'value="' + hb + '"'), true) +
            '</div>';
        }
      } else if (type === 'battle') {
        var ab2 = (unit && unit.atkBonus != null) ? unit.atkBonus : 0;
        var sb = (unit && unit.shieldBonus != null) ? unit.shieldBonus : 0;
        html = '<div class="diy-row">' +
          fieldHTML('+力量/乏力', 'diy-f-atkbonus', inputHTML('diy-f-atkbonus', '0', 'number', 'value="' + ab2 + '"'), true) +
          fieldHTML('+护盾/破甲', 'diy-f-shieldbonus', inputHTML('diy-f-shieldbonus', '0', 'number', 'value="' + sb + '"'), true) +
          '</div>';
      } else if (type === 'form') {
        var atk = (unit && unit.attack != null) ? unit.attack : 3;
        var hp = (unit && unit.hp != null) ? unit.hp : 6;
        html = '<div class="diy-row">' +
          fieldHTML('力量', 'diy-f-atk', inputHTML('diy-f-atk', '3', 'number', 'min="0" max="99" value="' + atk + '"'), true) +
          fieldHTML('生命', 'diy-f-hp', inputHTML('diy-f-hp', '6', 'number', 'min="0" max="99" value="' + hp + '"'), true) +
          '</div>';
      } else if (type === 'realm') {
        var dur = (unit && unit.durability != null) ? unit.durability : 1;
        html = fieldHTML('耐久', 'diy-f-durability', inputHTML('diy-f-durability', '1', 'number', 'min="1" max="99" value="' + dur + '"'), true);
      }
      $('diy-f-dynamic').innerHTML = html;
    }

    $('diy-f-name').value = unit ? (unit.name || '') : '';
    $('diy-f-owner').value = (unit && unit.owner) || '';
    $('diy-f-level').value = (unit && unit.level) || '1';
    $('diy-f-type').value = (unit && unit.type && ['spell', 'battle', 'form', 'realm'].indexOf(unit.type) !== -1) ? unit.type : 'spell';
    $('diy-f-rarity').value = (unit && ['R', 'SR', 'SSR'].indexOf(unit.rarity) !== -1) ? unit.rarity : 'R';
    $('diy-f-awakened').checked = !!(unit && unit.awakened);
    $('diy-f-derivative').checked = !!(unit && unit.derivative);
    $('diy-f-text').value = (unit && unit.effect) || '';
    $('diy-f-tags').value = (unit && Array.isArray(unit.tags)) ? unit.tags.join('、') : '';
    renderDynamic();
    $('diy-f-type').addEventListener('change', renderDynamic);
    $('diy-f-awakened').addEventListener('change', renderDynamic);

    m.onOk(function () {
      var name = $('diy-f-name').value.trim();
      var type = $('diy-f-type').value;
      var level = parseInt($('diy-f-level').value, 10) || 1;
      var err = validateName('卡牌', name);
      if (!err) err = validateText('卡牌', name, $('diy-f-text').value);
      if (err) { m.err.textContent = err; return; }
      var saved = {
        name: name,
        type: type,
        owner: $('diy-f-owner').value.trim(),
        level: level,
        rarity: $('diy-f-rarity').value,
        awakened: $('diy-f-awakened').checked,
        derivative: $('diy-f-derivative').checked,
        effect: $('diy-f-text').value.trim(),
        keywords: detectKeywords($('diy-f-text').value),
        tags: parseTags($('diy-f-tags').value)
      };
      if (type === 'spell') {
        if (saved.awakened) {
          if ($('diy-f-atkbonus').value.trim() === '') err = '请填写觉醒加成的力量';
          else if ($('diy-f-hpbonus').value.trim() === '') err = '请填写觉醒加成的生命';
          else {
            saved.atkBonus = parseInt($('diy-f-atkbonus').value, 10) || 0;
            saved.hpBonus = parseInt($('diy-f-hpbonus').value, 10) || 0;
          }
        }
      } else if (type === 'battle') {
        if ($('diy-f-atkbonus').value.trim() === '') err = '请填写战斗加成的力量';
        else if ($('diy-f-shieldbonus').value.trim() === '') err = '请填写战斗加成的护盾';
        else {
          saved.atkBonus = parseInt($('diy-f-atkbonus').value, 10) || 0;
          saved.shieldBonus = parseInt($('diy-f-shieldbonus').value, 10) || 0;
        }
      } else if (type === 'form') {
        if ($('diy-f-atk').value.trim() === '') err = '请填写形态力量';
        else if ($('diy-f-hp').value.trim() === '') err = '请填写形态生命';
        else {
          saved.attack = parseInt($('diy-f-atk').value, 10) || 0;
          saved.hp = parseInt($('diy-f-hp').value, 10) || 0;
        }
      } else if (type === 'realm') {
        if ($('diy-f-durability').value.trim() === '') err = '请填写幻境耐久';
        else saved.durability = parseInt($('diy-f-durability').value, 10) || 1;
      }
      if (err) { m.err.textContent = err; return; }
      if (idx >= 0) cache.cards[idx] = saved; else cache.cards.push(saved);
      m.ov.remove();
      render();
      saveToServer();
    });
  }

  // ═══════════════ 其他（关键词 / 灵咒） ═══════════════
  function openOtherEdit(idx) {
    var unit = cache.others[idx];
    var m = openModal('其他' + (idx >= 0 ? '编辑' : '新增'), [
      fieldHTML('类型', 'diy-f-otype', '<select id="diy-f-otype"><option value="keyword">关键词</option><option value="curse">灵咒</option></select>', true),
      fieldHTML('名称', 'diy-f-name', inputHTML('diy-f-name', '必填', 'text', 'maxlength="40"'), true),
      fieldHTML('效果（≤200字）', 'diy-f-text', '<textarea id="diy-f-text" maxlength="200" rows="3" placeholder="关键词/灵咒的效果说明"></textarea>'),
      fieldHTML('所属式神', 'diy-f-owner', inputHTML('diy-f-owner', '选填', 'text', 'maxlength="40"')),
    ].join(''));
    $('diy-f-otype').value = (unit && unit.type === 'curse') ? 'curse' : 'keyword';
    $('diy-f-name').value = unit ? (unit.name || '') : '';
    $('diy-f-text').value = (unit && unit.effect) || '';
    $('diy-f-owner').value = (unit && unit.owner) || '';

    m.onOk(function () {
      var type = $('diy-f-otype').value;
      var kind = type === 'keyword' ? '关键词' : '灵咒';
      var name = $('diy-f-name').value.trim();
      var err = validateName(kind, name);
      if (!err) err = validateText(kind, name, $('diy-f-text').value);
      if (!err && type === 'keyword' && typeof CardDB !== 'undefined' && CardDB.lookupKeyword && CardDB.lookupKeyword(name)) {
        err = '关键词「' + name + '」与官方关键词同名，请换个名字';
      }
      if (err) { m.err.textContent = err; return; }
      var saved = {
        type: type,
        name: name,
        effect: $('diy-f-text').value.trim(),
        owner: $('diy-f-owner').value.trim()
      };
      if (idx >= 0) cache.others[idx] = saved; else cache.others.push(saved);
      m.ov.remove();
      render();
      saveToServer();
    });
  }

  // ═══════════════ 渲染（页签 + 搜索 + 全部分组） ═══════════════
  var _tab = 'all';
  var _search = '';

  function matchesSearch(unit) {
    if (!_search) return true;
    var q = _search.toLowerCase();
    var name = String(unit.name || '').toLowerCase();
    var owner = String(unit.owner || '').toLowerCase();
    return name.indexOf(q) !== -1 || owner.indexOf(q) !== -1;
  }

  function itemHTMLFor(kind, unit, idx, indent) {
    var tags = '';
    if (kind === 'shikigami') {
      if (unit.type === 'summon') tags += '<span class="diy-tag diy-tag--summon">召唤物</span>';
      if (unit.faction) tags += '<span class="diy-tag">' + esc(unit.faction) + '</span>';
      if (unit.attack != null && unit.hp != null) tags += '<span class="diy-tag">' + esc(unit.attack) + '/' + esc(unit.hp) + '</span>';
    } else if (kind === 'card') {
      var typeNames = { spell: '法术', battle: '战斗', form: '形态', realm: '幻境' };
      var typeLabel = (typeNames[unit.type] || unit.type) + (unit.level ? '·Lv' + unit.level : '');
      var rar = (unit.rarity && ['R', 'SR', 'SSR'].indexOf(unit.rarity) !== -1) ? unit.rarity : 'R';
      tags += '<span class="diy-tag diy-tag--rar-' + esc(rar.toLowerCase()) + '">' + esc(rar) + '</span>';
      tags += '<span class="diy-tag diy-tag--' + esc(unit.type) + '">' + esc(typeLabel) + '</span>';
      if (unit.owner) tags += '<span class="diy-tag">' + esc(unit.owner) + '</span>';
      if (unit.awakened) tags += '<span class="diy-tag diy-tag--awakened">觉醒</span>';
      if (unit.derivative) tags += '<span class="diy-tag diy-tag--derivative">衍生</span>';
    } else {
      tags = '<span class="diy-tag">' + (unit.type === 'curse' ? '灵咒' : '关键词') + '</span>';
      if (unit.owner) tags += '<span class="diy-tag">' + esc(unit.owner) + '</span>';
    }
    return '<div class="diy-item' + (indent ? ' diy-item--indent' : '') + '" data-kind="' + kind + '" data-idx="' + idx + '">' +
      '<div class="diy-item-top">' +
      '<div class="diy-item-name">' + esc(unit.name) + '</div>' +
      '<div class="diy-item-actions">' +
      '<button type="button" class="diy-btn diy-btn-edit" data-kind="' + kind + '" data-idx="' + idx + '">✏️</button>' +
      '<button type="button" class="diy-btn diy-btn-del" data-kind="' + kind + '" data-idx="' + idx + '">🗑</button>' +
      '</div></div>' +
      '<div class="diy-item-tags">' + tags + '</div></div>';
  }

  function renderAllTab() {
    var shiNames = {};
    cache.shikigami.forEach(function (s) { shiNames[s.name] = true; });
    var html = '';
    // 每个式神分组内条目排序：卡牌(等级小→大) → 召唤物 → 关键词 → 灵咒
    function cardsByLevel() {
      return cache.cards.map(function (c, i) { return { u: c, i: i }; }).sort(function (a, b) {
        var la = parseInt(a.u.level, 10) || 99, lb = parseInt(b.u.level, 10) || 99;
        if (la !== lb) return la - lb;
        return String(a.u.name).localeCompare(String(b.u.name), 'zh');
      });
    }
    cache.shikigami.forEach(function (s, si) {
      if (s.type === 'summon') return; // 召唤物归到其所属式神下面展示
      var children = [];
      // 1) 卡牌（等级从小到大）
      cardsByLevel().forEach(function (e) {
        if (e.u.owner === s.name && matchesSearch(e.u)) children.push(itemHTMLFor('card', e.u, e.i, 1));
      });
      // 2) 召唤物
      cache.shikigami.forEach(function (sm, smi) {
        if (sm.type === 'summon' && sm.owner === s.name && matchesSearch(sm)) children.push(itemHTMLFor('shikigami', sm, smi, 1));
      });
      // 3) 关键词  4) 灵咒
      cache.others.forEach(function (o, oi) {
        if (o.owner === s.name && o.type !== 'curse' && matchesSearch(o)) children.push(itemHTMLFor('other', o, oi, 1));
      });
      cache.others.forEach(function (o, oi) {
        if (o.owner === s.name && o.type === 'curse' && matchesSearch(o)) children.push(itemHTMLFor('other', o, oi, 1));
      });
      var shiMatches = matchesSearch(s);
      if (shiMatches || children.length) {
        if (shiMatches) html += itemHTMLFor('shikigami', s, si, 0);
        html += children.join('');
      }
    });
    // 无归属（或所属式神不在库中）的卡牌 / 其他 / 召唤物
    var loose = [];
    // 无归属区同样排序：卡牌(等级小→大) → 召唤物 → 关键词 → 灵咒
    cardsByLevel().forEach(function (e) {
      if ((!e.u.owner || !shiNames[e.u.owner]) && matchesSearch(e.u)) loose.push(itemHTMLFor('card', e.u, e.i, 0));
    });
    cache.shikigami.forEach(function (sm, smi) {
      if (sm.type === 'summon' && (!sm.owner || !shiNames[sm.owner]) && matchesSearch(sm)) loose.push(itemHTMLFor('shikigami', sm, smi, 0));
    });
    cache.others.forEach(function (o, oi) {
      if ((!o.owner || !shiNames[o.owner]) && o.type !== 'curse' && matchesSearch(o)) loose.push(itemHTMLFor('other', o, oi, 0));
    });
    cache.others.forEach(function (o, oi) {
      if ((!o.owner || !shiNames[o.owner]) && o.type === 'curse' && matchesSearch(o)) loose.push(itemHTMLFor('other', o, oi, 0));
    });
    if (loose.length) html += '<div class="diy-group-sep">── 无归属 ──</div>' + loose.join('');
    return html;
  }

  function renderSimpleTab(kind) {
    var arr = kind === 'shikigami' ? cache.shikigami : (kind === 'card' ? cache.cards : cache.others);
    var html = '';
    arr.forEach(function (u, i) {
      if (matchesSearch(u)) html += itemHTMLFor(kind, u, i, 0);
    });
    return html;
  }

  function render() {
    var total = cache.shikigami.length + cache.cards.length + cache.others.length;
    var bar = $('diy-capacity-bar');
    if (bar) {
      bar.textContent = '容量：' + total + ' / ' + MAX_UNITS + ' 个单位';
      bar.style.color = total >= MAX_UNITS ? '#ff9a9a' : '';
    }
    var list = $('diy-list-container');
    if (!list) return;
    var html;
    if (_tab === 'all') html = renderAllTab();
    else if (_tab === 'shikigami') html = renderSimpleTab('shikigami');
    else if (_tab === 'card') html = renderSimpleTab('card');
    else html = renderSimpleTab('other');
    if (!html) {
      var emptyTexts = {
        all: '还没有内容，点上方按钮创建',
        shikigami: '还没有式神，点「➕ 式神」创建',
        card: '还没有卡牌，点「➕ 卡牌」创建',
        other: '还没有其他内容，点「➕ 其他」创建'
      };
      html = '<div class="diy-empty">' + (emptyTexts[_tab] || '暂无内容') + '</div>';
    }
    list.innerHTML = html;
  }

  // ═══════════════ 详情预览 ═══════════════
  function isMobile() { return window.matchMedia('(max-width: 768px)').matches; }

  function getUnit(kind, idx) {
    if (kind === 'shikigami') return cache.shikigami[idx];
    if (kind === 'card') return cache.cards[idx];
    return cache.others[idx];
  }

  function previewHTML(kind, unit) {
    if (!unit) return '';
    var typeNames = { shikigami: '式神', summon: '召唤物', spell: '法术', battle: '战斗', form: '形态', realm: '幻境', curse: '灵咒', keyword: '关键词' };
    function pill(text, mod) {
      return '<span class="diy-tag' + (mod ? ' ' + mod : '') + '">' + esc(text) + '</span>';
    }
    // 加成数字带符号：正/0 显示 +x，负值显示 -x（不再出现“+-1”）
    function signed(v) { return (v >= 0 ? '+' : '') + v; }
    var meta = [];
    var effect = '';
    if (kind === 'shikigami') {
      if (unit.type === 'summon') meta.push(pill('召唤物', 'diy-tag--summon'));
      else meta.push(pill('式神'));
      if (unit.faction) meta.push(pill(unit.faction));
      if (unit.attack != null && unit.hp != null) meta.push(pill(unit.attack + '/' + unit.hp));
      if (unit.type === 'summon' && unit.owner) meta.push(pill('所属：' + unit.owner));
      effect = unit.ability || '';
    } else if (kind === 'card') {
      var rarP = (unit.rarity && ['R', 'SR', 'SSR'].indexOf(unit.rarity) !== -1) ? unit.rarity : 'R';
      meta.push(pill(rarP, 'diy-tag--rar-' + rarP.toLowerCase()));
      var typeLabel = (typeNames[unit.type] || unit.type) + (unit.level ? '·Lv' + unit.level : '');
      meta.push(pill(typeLabel, 'diy-tag--' + unit.type));
      if (unit.owner) meta.push(pill('所属：' + unit.owner));
      // 觉醒（有加成合并为一个标签；法术觉醒两个数字都显示；都为 0 只显示“觉醒”）
      if (unit.awakened) {
        var ab = (unit.type === 'spell' && unit.atkBonus != null) ? unit.atkBonus : 0;
        var hb = (unit.type === 'spell' && unit.hpBonus != null) ? unit.hpBonus : 0;
        if (unit.type === 'spell' && (ab !== 0 || hb !== 0)) meta.push(pill('觉醒 ' + signed(ab) + '/' + signed(hb), 'diy-tag--awakened'));
        else meta.push(pill('觉醒', 'diy-tag--awakened'));
      }
      if (unit.derivative) meta.push(pill('衍生', 'diy-tag--derivative'));
      // 力量/生命/护盾：加成类统一 +x/+x（含 0），固定类显示 x/x
      if (unit.type === 'battle') meta.push(pill(signed(unit.atkBonus != null ? unit.atkBonus : 0) + '/' + signed(unit.shieldBonus != null ? unit.shieldBonus : 0)));
      if (unit.type === 'form') meta.push(pill((unit.attack != null ? unit.attack : 0) + '/' + (unit.hp != null ? unit.hp : 0)));
      if (unit.type === 'realm') meta.push(pill('耐久 ' + (unit.durability != null ? unit.durability : 1)));
      effect = unit.effect || '';
    } else {
      meta.push(pill(unit.type === 'curse' ? '灵咒' : '关键词'));
      if (unit.owner) meta.push(pill('所属：' + unit.owner));
      effect = unit.effect || '';
    }
    var html = '<div class="diy-preview__name">' + esc(unit.name) + '</div>' +
      '<div class="diy-preview__meta">' + meta.join('') + '</div>';
    if (effect) html += '<div class="diy-preview__effect">' + esc(effect) + '</div>';
    if (kind !== 'shikigami' && Array.isArray(unit.keywords) && unit.keywords.length) {
      html += '<div class="diy-preview__kws">关键词：' + esc(unit.keywords.join('、')) + '</div>';
    }
    if (kind !== 'shikigami' && Array.isArray(unit.tags) && unit.tags.length) {
      html += '<div class="diy-preview__kws">标签：' + esc(unit.tags.join('、')) + '</div>';
    }
    return html;
  }

  function closeMobileTip() {
    document.querySelectorAll('.diy-mobile-tip').forEach(function (t) { t.remove(); });
  }

  function showPreview(kind, idx, itemEl) {
    var unit = getUnit(kind, idx);
    if (!unit) return;
    var list = $('diy-list-container');
    if (list) {
      list.querySelectorAll('.diy-item--active').forEach(function (el) { el.classList.remove('diy-item--active'); });
    }
    if (itemEl) itemEl.classList.add('diy-item--active');
    var html = previewHTML(kind, unit);
    if (isMobile()) {
      // 手机端：悬浮窗（遮罩拦截点击，点悬浮窗或遮罩关闭）
      closeMobileTip();
      var tip = document.createElement('div');
      tip.className = 'diy-mobile-tip';
      tip.innerHTML = '<div class="diy-mobile-tip__card">' + html + '<div class="diy-mobile-tip__hint">点击关闭</div></div>';
      tip.addEventListener('click', function (ev) { ev.stopPropagation(); tip.remove(); });
      document.body.appendChild(tip);
    } else {
      var pane = $('diy-preview-pane');
      if (pane) pane.innerHTML = html;
    }
  }

  // ═══════════════ 保存 / 删除 ═══════════════
  function saveToServer() {
    var s = socket();
    if (!s) { showError('未连接服务器，无法保存'); return; }
    var total = cache.shikigami.length + cache.cards.length + cache.others.length;
    if (total > MAX_UNITS) { showError('超过容量上限：合计最多 ' + MAX_UNITS + ' 个单位'); return; }
    s.emit('save-my-cardlib', cache, function (res) {
      if (res && res.error) {
        showError(res.error);
        // 保存被拒绝：重新拉取服务器上的真实数据，界面与服务器保持一致
        s.emit('get-my-cardlib', {}, function (g) {
          if (g && g.ok) { cache = g.cardLib || { shikigami: [], cards: [], others: [] }; render(); }
        });
      }
      else if (res && res.ok) { showError('已保存', true); }
      else { showError('保存失败：服务端无响应'); }
    });
  }

  function delUnit(kind, idx) {
    var arr = kind === 'shikigami' ? cache.shikigami : (kind === 'card' ? cache.cards : cache.others);
    var unit = arr[idx];
    if (!unit) return;
    var msg;
    if (kind === 'shikigami') {
      var related = cache.cards.filter(function (c) { return c.owner === unit.name; }).length;
      msg = '确定删除' + (unit.type === 'summon' ? '召唤物' : '式神') + '「' + unit.name + '」？' + (related > 0 ? '其名下 ' + related + ' 张卡牌会一并删除。' : '');
    } else {
      msg = '确定删除「' + unit.name + '」？';
    }
    if (!window.confirm(msg)) return;
    if (kind === 'shikigami') {
      cache.cards = cache.cards.filter(function (c) { return c.owner !== unit.name; });
      cache.shikigami.splice(idx, 1);
    } else {
      arr.splice(idx, 1);
    }
    render();
    saveToServer();
  }

  // ═══════════════ 事件绑定 ═══════════════
  function bindEvents() {
    var addShi = $('diy-add-shikigami-btn');
    var addCard = $('diy-add-card-btn');
    var addOther = $('diy-add-other-btn');
    if (addShi) addShi.addEventListener('click', function () { openShikigamiEdit(-1); });
    if (addCard) addCard.addEventListener('click', function () { openCardEdit(-1); });
    if (addOther) addOther.addEventListener('click', function () { openOtherEdit(-1); });

    var tabs = $('diy-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (e) {
        var btn = e.target.closest('.diy-tab');
        if (!btn) return;
        _tab = btn.dataset.tab;
        tabs.querySelectorAll('.diy-tab').forEach(function (b) { b.classList.toggle('diy-tab--active', b === btn); });
        render();
      });
    }

    var search = $('diy-search-input');
    if (search) {
      search.addEventListener('input', function () {
        _search = search.value.trim();
        render();
      });
    }

    var list = $('diy-list-container');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('.diy-btn');
        if (btn) {
          var kind = btn.dataset.kind;
          var idx = parseInt(btn.dataset.idx, 10);
          if (btn.classList.contains('diy-btn-del')) delUnit(kind, idx);
          else if (btn.classList.contains('diy-btn-edit')) {
            if (kind === 'shikigami') openShikigamiEdit(idx);
            else if (kind === 'card') openCardEdit(idx);
            else openOtherEdit(idx);
          }
          return;
        }
        var item = e.target.closest('.diy-item');
        if (item) {
          showPreview(item.dataset.kind, parseInt(item.dataset.idx, 10), item);
        }
      });
    }
  }

  // ═══════════════ 页签打开 ═══════════════
  function onTabOpen() {
    var s = socket();
    if (!s) { showError('未连接服务器，请先登录'); renderEmpty(); return; }
    showError('');
    s.emit('get-my-cardlib', {}, function (res) {
      if (!res || res.error) { showError((res && res.error) || '读取失败'); renderEmpty(); return; }
      cache = res.cardLib || { shikigami: [], cards: [], others: [] };
      if (!Array.isArray(cache.others)) cache.others = [];
      closeMobileTip();
      var pane = $('diy-preview-pane');
      if (pane) pane.innerHTML = '<div class="diy-preview__placeholder">← 点击左侧条目查看详情</div>';
      render();
    });
  }

  function renderEmpty() {
    cache = { shikigami: [], cards: [], others: [] };
    render();
  }

  bindEvents();
  return { onTabOpen: onTabOpen };
})();
