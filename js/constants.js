// ================================================================
//  js/constants.js — 全局常量与工具函数 
//  定义应用版本号、标题、HTML 转义、调试模式等基础工具
// ================================================================

    // ================================================================
    //  全局常量
    // ================================================================
    const APP_VERSION = 'v0.5.1';
    const APP_TITLE = '百闻牌模拟器';

    /** 调试模式：0=关闭 1=开启（显示隐藏的编辑器按钮） */
    const DEBUG_MODE = 0;

    /**
     * 服务器环境：1=正式服  2=测试服
     * 本地开发调试时改为 2，上传正式服时改回 1
     * 手机/远程测试：网址加 ?env=2 连测试服，?env=1 连正式服（URL 参数优先级最高）
     */
    const SERVER_ENV_DEFAULT = 1;
    let SERVER_ENV = SERVER_ENV_DEFAULT;
    try {
      const _urlEnv = new URLSearchParams(window.location.search).get('env');
      if (_urlEnv === '2' || _urlEnv === 'test') SERVER_ENV = 2;
      else if (_urlEnv === '1' || _urlEnv === 'prod') SERVER_ENV = 1;
      // 网址路径包含 /bwpemu-test/ 时自动按测试服处理（不用带 ?env=2）
      else if (window.location.pathname.indexOf('/bwpemu-test/') !== -1) SERVER_ENV = 2;
    } catch (_) { /* 旧浏览器不支持 URLSearchParams 时保持默认 */ }

    // 正式服关闭 console.log 输出（测试服保留）
    if (SERVER_ENV === 1) {
      var _noop = function() {};
      console.log = _noop;
      console.info = _noop;
      console.debug = _noop;
    }

    /** 联机服务器配置 */
    const SERVER_HOST = 'https://bwpemu.top';
    const SERVER_PATH = SERVER_ENV === 2 ? '/ws-test/socket.io' : '/ws/socket.io';
    const IMAGE_BASE = SERVER_HOST;
    window._IMAGE_BASE = IMAGE_BASE;  // 供 inline onerror 使用
    window._SERVER_HOST = SERVER_HOST;  // 供 auth.js 使用
    window._SERVER_PATH = SERVER_PATH;  // 供 auth.js 使用
    /** 自动将所有相对 images/ 路径改为服务端URL */
    (function() {
      function fixImg(img) {
        var s = img.getAttribute('src') || '';
        if (s.startsWith('images/')) { img.src = IMAGE_BASE + '/' + s; return; }
        if (s.startsWith('../images/')) { img.src = IMAGE_BASE + '/' + s.replace('../',''); return; }
      }
      function fixStyle(el) {
        var bg = el.style.backgroundImage;
        if (!bg || bg.indexOf(IMAGE_BASE) !== -1) return; // 已修复则跳过，防止死循环
        el.style.backgroundImage = bg.replace(/(["']?)(\.\.\/)?images\//g, '$1' + IMAGE_BASE + '/images/');
      }
      // 监听新元素和属性变化
      new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          m.addedNodes.forEach(function(node) {
            if (node.tagName === 'IMG') fixImg(node);
            if (node.style && node.style.backgroundImage && node.style.backgroundImage.indexOf('images/') !== -1 && node.style.backgroundImage.indexOf(IMAGE_BASE) === -1) fixStyle(node);
            if (node.querySelectorAll) {
              node.querySelectorAll('img').forEach(fixImg);
              node.querySelectorAll('[style*="images/"]').forEach(fixStyle);
            }
          });
          if (m.type === 'attributes') {
            if (m.target.tagName === 'IMG' && m.attributeName === 'src') fixImg(m.target);
            if (m.attributeName === 'style' && m.target.style && m.target.style.backgroundImage && m.target.style.backgroundImage.indexOf('images/') !== -1 && m.target.style.backgroundImage.indexOf(IMAGE_BASE) === -1) fixStyle(m.target);
          }
        });
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'] });
      // 修复已有图片
      document.addEventListener('DOMContentLoaded', function() {
        document.querySelectorAll('img').forEach(fixImg);
      });
    })();
    // 全局兜底：任何图片加载失败，自动加上服务器前缀重试一次
    document.addEventListener('error', function(e) {
      if (e.target.tagName !== 'IMG') return;
      var src = e.target.getAttribute('src') || '';
      if (!src || src.startsWith('data:') || src.indexOf(IMAGE_BASE) !== -1) return;
      // 把相对路径或错误域名路径修正为服务器路径
      var fixed = src.replace(/^.*?\/\/[^/]+\//, '').replace(/^(\.\.\/)?/, '');
      if (fixed.startsWith('images/')) {
        e.target.src = IMAGE_BASE + '/' + fixed;
      }
    }, true);
    function imgUrl(path) { return IMAGE_BASE + '/' + path; }

    // ================================================================
    //  手机端布局调整（≤768px）：移动 DOM 元素到新位置
    // ================================================================
    (function() {
      const MOBILE_MQ = window.matchMedia('(max-width: 768px)');

      // 1) 发言按钮：中间栏 → 聊天大厅标题栏右边
      function placeSpeakBtn() {
        var btn = document.getElementById('btn-speak-unified');
        if (!btn) return;
        var chatTitle = document.querySelector('.chat-section--player .chat-section-title');
        var centerBar = document.querySelector('.center-dice-bar');
        if (MOBILE_MQ.matches && chatTitle && btn.parentElement !== chatTitle) {
          chatTitle.appendChild(btn);
        } else if (!MOBILE_MQ.matches && centerBar && btn.parentElement !== centerBar) {
          centerBar.appendChild(btn);
        }
      }

      // 2) 灵咒面板：中间栏 → "机制"下拉菜单里（功能不丢）
      function placeCursePanel() {
        var panel = document.querySelector('.curse-target-panel');
        if (!panel) return;
        var menu = document.getElementById('dropdown-mechanic-menu');
        var bar = document.querySelector('.center-dice-bar');
        if (MOBILE_MQ.matches && menu && panel.parentElement !== menu) {
          menu.appendChild(panel);
        } else if (!MOBILE_MQ.matches && bar && panel.parentElement !== bar) {
          var mechanic = document.getElementById('dropdown-mechanic');
          bar.insertBefore(panel, mechanic);  // 恢复到机制按钮前面（原位置）
        }
      }

      // 2.5) 设置/退出按钮：聊天栏 → "其他"下拉菜单里（手机端）
      function placeToolbarButtons() {
        var settingsBtn = document.getElementById('game-btn-settings');
        var exitBtn = document.getElementById('game-btn-exit');
        var otherMenu = document.getElementById('dropdown-other-menu');
        var gameToolbar = document.querySelector('.game-toolbar');
        if (!settingsBtn || !exitBtn || !otherMenu || !gameToolbar) return;
        if (MOBILE_MQ.matches) {
          [settingsBtn, exitBtn].forEach(function(btn) {
            btn.classList.add('dropdown-other__item');
            btn.style.width = '100%';
            btn.style.textAlign = 'left';
            if (btn.parentElement !== otherMenu) otherMenu.appendChild(btn);
          });
          gameToolbar.style.display = 'none';
        } else {
          [settingsBtn, exitBtn].forEach(function(btn) {
            btn.classList.remove('dropdown-other__item');
            btn.style.width = '';
            btn.style.textAlign = '';
            if (btn.parentElement !== gameToolbar) gameToolbar.appendChild(btn);
          });
          gameToolbar.style.display = '';
        }
      }

      // 3) 手机端：去掉按钮/标题里的图标（emoji），桌面端恢复原文字
      function stripMobileIcons() {
        var isMobile = MOBILE_MQ.matches;
        var map = [
          ['#btn-mechanic-toggle', isMobile ? '机制 ▾' : '🔧 机制 ▾'],
          ['#btn-dropdown-toggle', isMobile ? '其他 ▾' : '📋 其他 ▾'],
          ['#btn-speak-unified', isMobile ? '发言' : '💬 发言'],
          ['#btn-curse-target', isMobile ? '灵咒' : '⛓️ 灵咒'],
          ['#game-btn-settings', isMobile ? '设置' : '⚙ 设置'],
          ['#game-btn-exit', isMobile ? '退出' : '🚪 退出'],
        ];
        map.forEach(function(entry) {
          var el = document.getElementById(entry[0].slice(1));
          if (el && el.textContent !== entry[1]) el.textContent = entry[1];
        });
        // 气绝按钮：手机端两行"气绝 / 复活"
        var koBtn = document.getElementById('btn-ko');
        if (koBtn) {
          if (isMobile) {
            if (!koBtn.getAttribute('data-mobile-lines')) {
              koBtn.setAttribute('data-mobile-lines', '1');
              koBtn.innerHTML = '气绝<br>复活';
            }
          } else {
            if (koBtn.getAttribute('data-mobile-lines')) {
              koBtn.removeAttribute('data-mobile-lines');
              koBtn.textContent = '💀 气绝/复活';
            }
          }
        }
        // 机制菜单项：手机端去图标
        var mechItems = document.querySelectorAll('.dropdown-mechanic__item');
        mechItems.forEach(function(item) {
          var orig = item.getAttribute('data-orig-text');
          if (isMobile) {
            if (orig === null) {
              orig = (item.textContent || '').trim();
              item.setAttribute('data-orig-text', orig);
            }
            var clean = orig.replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '').trim();
            if (item.textContent !== clean) item.textContent = clean;
          } else {
            if (orig !== null) {
              item.textContent = orig;
              item.removeAttribute('data-orig-text');
            }
          }
        });
        // 其他菜单项：手机端去图标（式神录、预设）
        ['.dropdown-other__item[data-action="shikigami-book"]', '#btn-preset-toggle'].forEach(function(sel) {
          var el = document.querySelector(sel);
          if (!el) return;
          var orig = el.getAttribute('data-orig-text');
          if (isMobile) {
            if (orig === null) {
              orig = (el.textContent || '').trim();
              el.setAttribute('data-orig-text', orig);
            }
            var cleanTxt = orig.replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '').trim();
            if (el.textContent !== cleanTxt) el.textContent = cleanTxt;
          } else {
            if (orig !== null) {
              el.textContent = orig;
              el.removeAttribute('data-orig-text');
            }
          }
        });
        // 说明书按钮：手机端去图标
        document.querySelectorAll('.btn-effect-manual').forEach(function(el) {
          var orig = el.getAttribute('data-orig-text');
          if (isMobile) {
            if (orig === null) {
              orig = (el.textContent || '').trim();
              el.setAttribute('data-orig-text', orig);
            }
            var cleanTxt = orig.replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '').trim();
            if (el.textContent !== cleanTxt) el.textContent = cleanTxt;
          } else {
            if (orig !== null) {
              el.textContent = orig;
              el.removeAttribute('data-orig-text');
            }
          }
        });
        // 聊天大厅标题
        var playerChatTitle = document.querySelector('.chat-section--player .chat-section-title');
        if (playerChatTitle && playerChatTitle.childNodes.length > 0 && playerChatTitle.childNodes[0].nodeType === 3) {
          playerChatTitle.childNodes[0].textContent = isMobile ? '聊天大厅' : '💬 聊天大厅';
        }
        // 骰子按钮文字
        var diceBtn = document.getElementById('btn-dice-roll');
        if (diceBtn) {
          if (isMobile) {
            var svg = diceBtn.querySelector('svg');
            if (svg) svg.style.display = 'none';
            if (diceBtn.childNodes[0] && diceBtn.childNodes[0].nodeType === 3) diceBtn.childNodes[0].textContent = '骰子';
          } else {
            var svg2 = diceBtn.querySelector('svg');
            if (svg2) svg2.style.display = '';
            if (diceBtn.childNodes[0] && diceBtn.childNodes[0].nodeType === 3) diceBtn.childNodes[0].textContent = '投掷';
          }
        }
      }

      // 4) 手机端：操作按钮排（牌库工具栏）文字两行、每行 2 字
      function formatDeckButtons() {
        var btns = document.querySelectorAll('.btn-deck');
        var isMobile = MOBILE_MQ.matches;
        btns.forEach(function(btn) {
          // 手牌/牌库/启悟区计数按钮交给 updateDeckButtons 渲染（手机端两行），这里跳过
          if (btn.dataset.action === 'hand' || btn.dataset.action === 'deck' || btn.dataset.action === 'oracle-zone') return;
          var orig = btn.getAttribute('data-orig-text');
          if (isMobile) {
            if (orig === null) {
              orig = (btn.textContent || '').trim();
              btn.setAttribute('data-orig-text', orig);
            }
            // 去掉 emoji 图标
            var clean = orig.replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '').trim();
            if (clean.length <= 2) {
              btn.textContent = clean;
            } else {
              var lines = [];
              for (var i = 0; i < clean.length; i += 2) lines.push(clean.slice(i, i + 2));
              btn.innerHTML = lines.join('<br>');
            }
          } else {
            if (orig !== null) {
              btn.textContent = orig;
              btn.removeAttribute('data-orig-text');
            }
          }
        });
      }

      // 5) 手机端：每位玩家信息条加"🏞"按钮，点击弹出该玩家的幻境/效果面板
      function _updateRealmBadge(zone) {
        var panel = zone.querySelector('.effects-panel');
        var btn = zone.querySelector('.btn-mobile-realm');
        if (!panel || !btn) return;
        var count = panel.querySelectorAll('.effect-item').length;
        var badge = btn.querySelector('.btn-mobile-realm__badge');
        if (count > 0) {
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'btn-mobile-realm__badge';
            btn.appendChild(badge);
          }
          badge.textContent = count;
        } else if (badge) {
          badge.remove();
        }
      }

      function placeRealmButtons() {
        var isMobile = MOBILE_MQ.matches;

        /** 收起幻境/效果弹层：按钮全部归位，清掉残留按钮行（防止下次展开顺序颠倒） */
        function _collapseRealm(zone) {
          var panel = zone.querySelector('.effects-panel');
          var addBtn = zone.querySelector('.btn-add-effect');
          var manualBtn = zone.querySelector('.btn-effect-manual');
          var btnsWrap = zone.querySelector('.zone-effects-btns');
          if (btnsWrap && addBtn && addBtn.parentElement !== btnsWrap) {
            btnsWrap.insertBefore(addBtn, btnsWrap.firstChild);
          }
          // 说明书按钮留弹层内（随弹层显隐），但移出按钮行
          if (panel && manualBtn && manualBtn.parentElement !== panel) panel.appendChild(manualBtn);
          var row = panel ? panel.querySelector('.realm-btns-row') : null;
          if (row) row.remove();
          if (addBtn) addBtn.style.display = '';
        }

        document.querySelectorAll('.player-zone').forEach(function(zone) {
          var bar = zone.querySelector('.player-id-area');
          var panel = zone.querySelector('.effects-panel');
          var addBtn = zone.querySelector('.btn-add-effect');
          var manualBtn = zone.querySelector('.btn-effect-manual');
          var btnsWrap = zone.querySelector('.zone-effects-btns');
          var btn = zone.querySelector('.btn-mobile-realm');
          if (!isMobile) {
            // 桌面端：移除按钮、收起面板、添加/说明书按钮回一行容器
            if (btn) btn.remove();
            zone.classList.remove('realm-open');
            if (btnsWrap) {
              if (addBtn && addBtn.parentElement !== btnsWrap) btnsWrap.insertBefore(addBtn, btnsWrap.firstChild);
              if (manualBtn && addBtn && (manualBtn.parentElement !== btnsWrap || manualBtn.previousElementSibling !== addBtn)) {
                addBtn.insertAdjacentElement('afterend', manualBtn);
              }
            }
            // 清掉手机端残留的空按钮行
            var realmRow = zone.querySelector('.realm-btns-row');
            if (realmRow && !realmRow.children.length) realmRow.remove();
            if (addBtn) addBtn.style.display = '';
            if (manualBtn) manualBtn.style.display = '';
            return;
          }
          if (!bar || !panel) return;
          // 手机端：说明书按钮收进弹层内（随弹层显隐）
          if (manualBtn && manualBtn.parentElement !== panel) panel.appendChild(manualBtn);
          if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-mobile-realm';
            btn.textContent = '✨';
            btn.title = '幻境/效果';
            bar.appendChild(btn);
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              var isOpen = zone.classList.contains('realm-open');
              document.querySelectorAll('.player-zone.realm-open').forEach(function(z) {
                z.classList.remove('realm-open');
                _collapseRealm(z);
              });
              if (isOpen) {
                // 关闭：按钮归位
                _collapseRealm(zone);
              } else {
                // 打开：添加/说明书按钮放进同一行容器（吸顶），固定顺序：添加在前、说明书在后
                var row = panel.querySelector('.realm-btns-row');
                if (!row) {
                  row = document.createElement('div');
                  row.className = 'realm-btns-row';
                }
                if (row.parentElement !== panel) panel.insertBefore(row, panel.firstChild);
                if (addBtn && addBtn.parentElement !== row) row.appendChild(addBtn);
                if (manualBtn && addBtn && (manualBtn.parentElement !== row || manualBtn.previousElementSibling !== addBtn)) {
                  addBtn.insertAdjacentElement('afterend', manualBtn);
                }
                if (typeof isSpectator !== 'undefined' && isSpectator) {
                  if (addBtn) addBtn.style.display = 'none';   // 观众只读，隐藏添加
                } else if (addBtn) {
                  addBtn.style.display = '';
                }
                zone.classList.add('realm-open');
              }
            });
          }
          // 角标显示幻境+效果总数（0 自动隐藏），监听面板变化实时刷新
          _updateRealmBadge(zone);
          if (!zone._realmObserver && typeof MutationObserver !== 'undefined') {
            zone._realmObserver = new MutationObserver(function() { _updateRealmBadge(zone); });
            zone._realmObserver.observe(panel, { childList: true });
          }
        });
        // 点击面板/按钮以外区域：收起弹层（只注册一次），同时归位按钮
        if (isMobile && !document._realmOutsideHandler) {
          document._realmOutsideHandler = true;
          document.addEventListener('pointerdown', function(e) {
            if (e.target.closest('.btn-mobile-realm') || e.target.closest('.effects-panel') || e.target.closest('.btn-add-effect')) return;
            document.querySelectorAll('.player-zone.realm-open').forEach(function(z) {
              z.classList.remove('realm-open');
              _collapseRealm(z);
            });
          }, true);
        }
      }

      // 7) 手机端：聊天区放大按钮 + 留边大弹窗（默认滚到最底部）
      var _chatExpandOrigin = null;

      function ensureChatExpandDialog() {
        if (document.getElementById('chat-expand-overlay')) return;
        var overlay = document.createElement('div');
        overlay.id = 'chat-expand-overlay';
        overlay.className = 'chat-expand-overlay';
        overlay.hidden = true;
        overlay.innerHTML =
          '<div class="chat-expand-dialog">' +
          '<div class="chat-expand-header"><span class="chat-expand-title" id="chat-expand-title">聊天</span>' +
          '<button type="button" class="chat-expand-close" aria-label="关闭">✕</button></div>' +
          '<div class="chat-expand-body"></div>' +
          '</div>';
        document.body.appendChild(overlay);
        overlay.querySelector('.chat-expand-close').addEventListener('click', closeChatExpand);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closeChatExpand(); });
      }

      function openChatExpand(section) {
        ensureChatExpandDialog();
        var overlay = document.getElementById('chat-expand-overlay');
        if (!overlay) return;
        var srcBody = section.querySelector('.chat-section-body');
        var title = section.querySelector('.chat-section-title');
        _chatExpandOrigin = section;
        var titleText = title ? title.textContent.replace(/[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\uFE0F\u200D⤢]/gu, '').trim() : '聊天';
        document.getElementById('chat-expand-title').textContent = titleText;
        var bodyWrap = overlay.querySelector('.chat-expand-body');
        if (srcBody && srcBody.parentElement !== bodyWrap) bodyWrap.appendChild(srcBody);
        overlay.hidden = false;
        if (srcBody) srcBody.scrollTop = srcBody.scrollHeight;
      }

      function closeChatExpand() {
        var overlay = document.getElementById('chat-expand-overlay');
        if (!overlay || overlay.hidden) return;
        var bodyWrap = overlay.querySelector('.chat-expand-body');
        var src = bodyWrap.querySelector('.chat-section-body');
        if (src && _chatExpandOrigin) _chatExpandOrigin.appendChild(src);
        _chatExpandOrigin = null;
        overlay.hidden = true;
      }

      function placeChatExpand() {
        var isMobile = MOBILE_MQ.matches;
        ['.chat-section--system', '.chat-section--player'].forEach(function(sel) {
          var section = document.querySelector(sel);
          if (!section) return;
          var title = section.querySelector('.chat-section-title');
          var btn = section.querySelector('.chat-expand-btn');
          if (!isMobile) {
            if (btn) btn.remove();
            return;
          }
          if (title && !btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chat-expand-btn';
            btn.textContent = '⤢';
            btn.title = '放大查看';
            title.appendChild(btn);
            btn.addEventListener('click', function(e) {
              e.stopPropagation();
              openChatExpand(section);
            });
          }
        });
        if (!isMobile) closeChatExpand();
        else ensureChatExpandDialog();
      }

      // 8) 手机端：商店按钮布局（库存移入第一排、按钮去图标）
      function placeShopButtons() {
        var isMobile = MOBILE_MQ.matches;
        var footerBtns = document.querySelector('.shop-dialog__footer-btns');
        var manageRow = document.querySelector('.shop-dialog__manage-row');
        var invBtn = document.getElementById('shop-inv-btn');
        var freeBtn = document.getElementById('shop-free-refresh-btn');
        var refreshBtn = document.getElementById('shop-refresh-btn');
        var addBtn = document.getElementById('shop-add-btn');
        if (!footerBtns || !manageRow || !invBtn) return;
        if (isMobile) {
          // 库存按钮移到第一排（刷新按钮旁边），三个均分
          if (invBtn.parentElement !== footerBtns) footerBtns.appendChild(invBtn);
          // 按钮去图标（保留刷新 1💰 的钱袋）
          if (freeBtn) { if (freeBtn.getAttribute('data-orig-text') === null) freeBtn.setAttribute('data-orig-text', freeBtn.textContent.trim()); freeBtn.textContent = '免费刷新'; }
          if (refreshBtn) { if (refreshBtn.getAttribute('data-orig-text') === null) refreshBtn.setAttribute('data-orig-text', refreshBtn.textContent.trim()); refreshBtn.textContent = '刷新 1💰'; }
          if (addBtn) { if (addBtn.getAttribute('data-orig-text') === null) addBtn.setAttribute('data-orig-text', addBtn.textContent.trim()); addBtn.textContent = '添加商品'; }
        } else {
          // 桌面端：库存按钮回到第二排原位（输入框、确定之后）
          if (invBtn.parentElement === footerBtns) {
            manageRow.insertBefore(invBtn, addBtn && addBtn.parentElement === manageRow ? addBtn : null);
          }
          [freeBtn, refreshBtn, addBtn].forEach(function(b) {
            if (b && b.getAttribute('data-orig-text') !== null) {
              b.textContent = b.getAttribute('data-orig-text');
              b.removeAttribute('data-orig-text');
            }
          });
        }
        if (typeof _refreshShopInvBtnText === 'function') _refreshShopInvBtnText();
      }

      // 9) 手机端：退出登录按钮移到"我的"页签标题右侧（桌面端留在侧栏底部）
      function placeLobbyLogout() {
        var isMobile = MOBILE_MQ.matches;
        var btn = document.getElementById('lobby-logout-btn');
        if (!btn) return;
        var footer = btn.closest('.lobby-sidebar-footer');
        var header = document.querySelector('#panel-profile .lobby-panel-header');
        if (!footer || !header) return;
        if (isMobile) {
          if (btn.parentElement !== header) header.appendChild(btn);
        } else {
          if (btn.parentElement === header) footer.appendChild(btn);
        }
      }

      function layoutMobile() { placeSpeakBtn(); placeCursePanel(); placeToolbarButtons(); stripMobileIcons(); formatDeckButtons(); placeRealmButtons(); if (typeof window.placeGraveButtons === 'function') window.placeGraveButtons(); placeChatExpand(); placeShopButtons(); placeLobbyLogout(); if (typeof updateAllDeckButtons === 'function') updateAllDeckButtons(); }
      if (MOBILE_MQ.addEventListener) MOBILE_MQ.addEventListener('change', layoutMobile);
      else if (MOBILE_MQ.addListener) MOBILE_MQ.addListener(layoutMobile);
      layoutMobile();
    })();

    const ENV_LABEL = SERVER_ENV === 2 ? '【测试服】' : '';
    document.title = `${ENV_LABEL}${APP_TITLE} ${APP_VERSION}`;
    const roomTitleEl = document.getElementById('room-title');
    if (roomTitleEl) roomTitleEl.textContent = `🎴 ${ENV_LABEL}${APP_TITLE} ${APP_VERSION}`;
    // 登录界面左下角版本号
    const versionEl = document.getElementById('auth-version');
    if (versionEl) versionEl.textContent = ENV_LABEL + APP_VERSION;

    // ================================================================
    //  工具函数
    // ================================================================

    /** HTML 转义 */
    function escapeHTML(str) {
      const div = document.createElement('div');
      div.appendChild(document.createTextNode(str));
      return div.innerHTML;
    }

    /** 调试模式初始化：显示/隐藏编辑器按钮 */
    function initDebugMode() {
      if (!DEBUG_MODE) return;
      console.log('[Debug] 🛠 调试模式已开启');
      // 显示"其他"下拉中的隐藏按钮
      const btns = document.querySelectorAll('.dropdown-other__item[hidden]');
      btns.forEach(btn => btn.removeAttribute('hidden'));
    }
    // 脚本加载时自动执行（位于 </body> 前，DOM 已就绪）
    initDebugMode();

    // ================================================================
    //  版本更新检测：页面加载后 / 切回前台时，对比服务器最新版本号，
    //  发现新版本 → 倒计时 3 秒自动刷新（刷新后自动登录并坐回对局）
    // ================================================================
    (function() {
      let _verChecked = false;
      let _verOverlay = false;

      function _checkVersion() {
        if (_verChecked || _verOverlay) return;
        _verChecked = true;
        try {
          fetch('js/constants.js?t=' + Date.now(), { cache: 'no-store' })
            .then(function(r) { if (!r.ok) throw new Error('http ' + r.status); return r.text(); })
            .then(function(txt) {
              const m = txt.match(/APP_VERSION\s*=\s*'([^']+)'/);
              if (m && m[1] && m[1] !== APP_VERSION) _showUpdate(m[1]);
            })
            .catch(function() { _verChecked = false; });  // 网络失败，下次再试
        } catch (e) { _verChecked = false; }
      }

      function _showUpdate(newVer) {
        _verOverlay = true;
        if (document.getElementById('version-update-overlay')) return;
        const ov = document.createElement('div');
        ov.id = 'version-update-overlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(8,10,18,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#fff;font-size:22px;font-weight:700;';
        ov.innerHTML = '<div>✨ 发现新版本 ' + escapeHTML(newVer) + '</div><div style="font-size:16px;color:#e8c86a;" id="version-update-count">3 秒后自动更新…</div>';
        document.body.appendChild(ov);
        let n = 3;
        const timer = setInterval(function() {
          n--;
          const el = document.getElementById('version-update-count');
          if (n <= 0) {
            clearInterval(timer);
            // 跳到带时间戳的新地址（不是原地刷新），保证浏览器拿到全新的页面和代码
            var u = window.location.href.split('#')[0];
            var sep = u.indexOf('?') >= 0 ? '&' : '?';
            window.location.replace(u + sep + '_update=' + encodeURIComponent(newVer) + '&t=' + Date.now());
          }
          else if (el) el.textContent = n + ' 秒后自动更新…';
        }, 1000);
      }

      window.addEventListener('load', function() { setTimeout(_checkVersion, 1500); });
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') { _verChecked = false; setTimeout(_checkVersion, 300); }
      });
    })();

