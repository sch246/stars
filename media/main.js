/* eslint-disable curly */
/**
 * Stars v5.6
 */

const vscode = acquireVsCodeApi();
const App = {};

// ==========================================
// 0. Utils
// ==========================================
App.Utils = {
    t(key, params = {}) {
        // eslint-disable-next-line no-undef
        if (typeof t === 'function') return t(key, params);
        let str = key;
        Object.keys(params).forEach(k => { str = str.replace(new RegExp(`{${k}}`, 'g'), params[k]); });
        return str;
    },

    debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    },

    getRandomColor() {
        const h = Math.random(); const s = Math.random(); const v = 1; let r, g, b;
        const i = Math.floor(h * 6); const f = h * 6 - i; const p = v * (1 - s); const q = v * (1 - f * s); const t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break;
            case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break;
        }
        const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0'); return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    },

    // Reachability Analysis (BFS)
    findReachable(allNodes, allLinks, startNodes) {
        const reachable = new Set();
        const queue = [];
        startNodes.forEach(s => {
            if (s && !reachable.has(s.uuid)) {
                const exists = allNodes.find(n => n.uuid === s.uuid);
                if(exists) { reachable.add(s.uuid); queue.push(exists); }
            }
        });
        const adj = {};
        allLinks.forEach(l => {
            const s = (typeof l.source === 'object') ? l.source.uuid : l.source;
            const t = (typeof l.target === 'object') ? l.target.uuid : l.target;
            if(!adj[s]) adj[s] = []; adj[s].push(t);
            if(!adj[t]) adj[t] = []; adj[t].push(s);
        });
        let head = 0;
        while(head < queue.length) {
            const curr = queue[head++];
            const neighbors = adj[curr.uuid] || [];
            neighbors.forEach(nid => {
                if (!reachable.has(nid)) {
                    reachable.add(nid);
                    const nodeObj = allNodes.find(n => n.uuid === nid);
                    if(nodeObj) queue.push(nodeObj);
                }
            });
        }
        return reachable;
    }
};

// ==========================================
// 1. UI / Dialogs
// ==========================================
App.UI = {
    els: {},

    init() {
        this.initElements();
        this.initBindings();
        this.Dialog.init();
        this.I18n.apply();
    },

    initElements() {
        this.els = {
            label: document.getElementById('node-label'),
            uuid: document.getElementById('node-uuid'),
            linkStatus: document.getElementById('link-status'),
            summary: document.getElementById('node-summary'),
            content: document.getElementById('node-content'),
            colorInput: document.getElementById('node-color-input'),
            colorHex: document.getElementById('node-color-hex')
        };
    },

    initBindings() {
        // Sidebar Inputs
        this.els.label.addEventListener('input', () => this.onNodeEdit('label', this.els.label.value));
        this.els.label.addEventListener('keydown', (e) => this.handleEditorTab(e, 'node-summary', 'node-content'));

        this.els.summary.addEventListener('input', () => this.onNodeEdit('summary', this.els.summary.value));
        this.els.summary.addEventListener('keydown', (e) => this.handleEditorTab(e, 'node-content', 'node-label'));

        this.els.content.addEventListener('input', () => this.onNodeEdit('content', this.els.content.value));
        this.els.content.addEventListener('keydown', (e) => this.handleEditorTab(e, 'node-label', 'node-summary'));

        this.els.colorInput.addEventListener('input', () => {
            this.els.colorHex.value = this.els.colorInput.value;
            this.onNodeEdit('color', this.els.colorInput.value);
            this.updateSlotUI();
        });

        this.els.colorHex.addEventListener('input', () => {
            if(/^#[0-9A-F]{6}$/i.test(this.els.colorHex.value)) {
                this.els.colorInput.value = this.els.colorHex.value;
                this.onNodeEdit('color', this.els.colorHex.value);
                this.updateSlotUI();
            }
        });

        // dialog Background Click to Close
        const dialog = document.getElementById('custom-dialog-overlay');
        dialog.addEventListener('mousedown', (e) => {
            if (e.target === dialog) App.UI.Dialog.close();
        });

        // Modal Background Click to Close
        const modal = document.getElementById('content-modal');
        modal.addEventListener('mousedown', (e) => {
            if (e.target === modal) App.UI.Modal.close();
        });

        // Slot Click Listeners (Dynamic)
        for(let i=0; i<4; i++) {
            const slotEl = document.getElementById(`slot-${i+1}`);
            if(slotEl) {
                slotEl.addEventListener('click', (e) => {
                    // Shift detection fix
                    App.Input.handleSlotClick(i, e.shiftKey);
                });
                slotEl.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    App.Input.clearSlot(i);
                });
            }
        }

        // Resizer
        let isResizing = false;
        const resizer = document.getElementById('sidebar-resizer');
        resizer.addEventListener('mousedown', (e) => { isResizing = true; e.preventDefault(); App.Renderer.canvas.style.pointerEvents = 'none'; document.body.style.cursor = 'ew-resize'; });
        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const newWidth = Math.max(250, Math.min(window.innerWidth - e.clientX, window.innerWidth * 0.6));
            document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
            App.Renderer.resize();
        });
        document.addEventListener('mouseup', () => { if(isResizing) { isResizing = false; App.Renderer.canvas.style.pointerEvents = 'auto'; document.body.style.cursor = 'default'; } });
        window.addEventListener('resize', () => App.Renderer.resize());


        // --- 新增：绑定右下角三个输入框 ---
        const inpJump = document.getElementById('inp-jump');
        const inpFilterNode = document.getElementById('inp-filter-node');
        const inpFilterLink = document.getElementById('inp-filter-link');

        // 1. 跳转功能
        inpJump.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = inpJump.value.trim().toLowerCase();
                if (!val) return;
                // 简单的模糊搜索
                const target = App.Store.state.nodes.find(n => n.label.toLowerCase().includes(val));
                if (target) {
                    App.Input.navigate(target);
                    // 可选：清空输入框
                    // inpJump.value = '';
                    App.UI.showFlash(t('flash.jumpedTo', {label: target.label}));
                    // 失去焦点，回到画布
                    inpJump.blur();
                    App.Renderer.canvas.focus();
                } else {
                    App.UI.showFlash(t('alert.nodeNotFound'), "warn");
                }
            }
        });

        // 2. 节点筛选 (回车触发)
        inpFilterNode.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                App.Store.state.filterNodeStr = inpFilterNode.value;
                // 强制刷新渲染
                App.Renderer.visCache.lastSignature = null;
                App.Renderer.restartSim();
                App.UI.showFlash(t('flash.nodeFiltered'));
                inpFilterNode.blur();
            }
        });

        // 3. 连线筛选 (回车触发)
        inpFilterLink.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                App.Store.state.filterLinkStr = inpFilterLink.value;
                // 强制刷新渲染
                App.Renderer.visCache.lastSignature = null;
                App.Renderer.restartSim();
                App.UI.showFlash(t('flash.linkFiltered'));
                inpFilterLink.blur();
            }
        });

        // 防止按键事件冒泡触发全局快捷键 (如删除、移动等)
        [inpJump, inpFilterNode, inpFilterLink].forEach(el => {
            el.addEventListener('keydown', (e) => e.stopPropagation());
        });
    },

    onNodeEdit(field, value) {
        if(App.Store.state.focusNode) {
            App.Store.state.focusNode[field] = value;
            App.Store.saveDebounced();
        }
    },

    handleEditorTab(e, nextId, prevId) {
        if (e.key === 'Tab') {
            e.preventDefault();
            const targetId = e.shiftKey ? prevId : nextId;
            const el = document.getElementById(targetId);
            el.focus(); if(el.tagName!=='DIV') el.select();
        }
    },

    updateSidebar() {
        const node = App.Store.state.focusNode;
        if(!node) return;
        this.els.label.value = node.label;
        this.els.uuid.innerText = "UUID: " + node.uuid;
        this.els.summary.value = node.summary || "";
        this.els.content.value = node.content || "";
        this.els.colorInput.value = node.color || "#4facfe";
        this.els.colorHex.value = node.color || "#4facfe";
        const count = App.Store.state.links.filter(l => l.source.uuid === node.uuid || l.target.uuid === node.uuid).length;
        this.els.linkStatus.innerText = `Links: ${count}`;
    },

    updateSlotUI() {
        const { slots } = App.Store.state;
        for(let i=0; i<4; i++) {
            const el = document.getElementById(`slot-${i+1}`);
            const node = slots[i];
            const circle = el.querySelector('.slot-circle');
            const nameEl = el.querySelector('.slot-name');
            if (node) {
                el.classList.add('active');
                nameEl.innerText = node.label;
                circle.style.background = node.color || "#4facfe";
                circle.style.boxShadow = `0 0 8px ${node.color || "#4facfe"}`;
            } else {
                el.classList.remove('active');
                nameEl.innerText = "-";
                circle.style.background = "#222";
                circle.style.boxShadow = "none";
            }
        }
    },

    showFlash(msg, type = 'info') {
        const el = document.getElementById('flash-message');
        el.innerText = msg; el.className = type; el.style.opacity = 1;
        setTimeout(() => { el.style.opacity = 0; }, 2000);
    },

    // --- Async Dialogs ---
    Dialog: {
        overlay: document.getElementById('custom-dialog-overlay'),
        msgEl: document.getElementById('custom-dialog-msg'),
        inputEl: document.getElementById('custom-dialog-input'),
        btnConfirm: document.getElementById('btn-confirm'),
        btnCancel: document.getElementById('btn-cancel'),
        isActive: false,

        // 用于存储当前正在运行的关闭回调，以便外部强行关闭
        _currentCleanup: null,
        init() {},
        /**
         * 强行关闭当前对话框
         * 这等同于用户点击了“取消”按钮
         */
        close() {
            if (this.isActive && this.btnCancel) {
                // 模拟点击取消按钮，这样可以复用已有的 Promise resolve(false/null) 逻辑
                // 并且会自动调用 cleanup 清理事件监听
                this.btnCancel.click();
            } else if (this.isActive && this._currentCleanup) {
                // 如果 DOM 还没准备好或者发生了其他异常，但在逻辑上是 Active
                // 此时直接调用清理函数作为备选方案
                this._currentCleanup();
            }
        },
        _show(msg, needsInput = false, placeholder = '') {
            return new Promise((resolve) => {
                // 如果当前已经有一个窗口打开，先关掉它，防止冲突
                if (this.isActive) this.close();
                this.isActive = true;
                this.msgEl.innerText = msg;
                this.inputEl.style.display = needsInput ? 'block' : 'none';
                this.inputEl.value = '';
                this.inputEl.placeholder = placeholder;

                // 使用 I18n 获取按钮文本 (假设 t 函数存在)
                this.btnConfirm.innerText = typeof t !== 'undefined' ? t('dialog.confirm') : 'Confirm';
                this.btnCancel.innerText = typeof t !== 'undefined' ? t('dialog.cancel') : 'Cancel';
                this.overlay.classList.add('active');
                // 焦点管理
                if (needsInput) setTimeout(() => this.inputEl.focus(), 50);
                else setTimeout(() => this.btnConfirm.focus(), 50);
                // 键盘辅助导航
                const handleBtnKey = (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.btnConfirm.click(); }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.btnCancel.click(); }
                };
                // 清理与关闭闭包
                const cleanup = (e) => {
                    if(e) { e.preventDefault(); e.stopPropagation(); }

                    // 解绑事件
                    this.btnConfirm.onclick = null;
                    this.btnCancel.onclick = null;
                    this.inputEl.onkeydown = null;
                    this.btnConfirm.removeEventListener('keydown', handleBtnKey);
                    this.btnCancel.removeEventListener('keydown', handleBtnKey);

                    // 隐藏 UI
                    this.overlay.classList.remove('active');
                    this.isActive = false;
                    this._currentCleanup = null; // 清空引用
                    // 归还焦点
                    if (App && App.Renderer && App.Renderer.canvas) {
                        App.Renderer.canvas.focus();
                    }
                };
                // 将 cleanup 暴露给实例，以防万一需要强制直接调用
                this._currentCleanup = () => { cleanup(); resolve(needsInput ? null : false); };
                // 事件绑定
                this.btnConfirm.onclick = (e) => {
                    const val = this.inputEl.value;
                    cleanup(e);
                    resolve(needsInput ? val : true);
                };

                this.btnCancel.onclick = (e) => {
                    cleanup(e);
                    resolve(needsInput ? null : false);
                };
                this.inputEl.onkeydown = (e) => {
                    if(e.key === 'Enter') { e.preventDefault(); this.btnConfirm.click(); }
                    if(e.key === 'Escape') { e.preventDefault(); this.btnCancel.click(); }
                };
                // 防止 ESC 关闭弹窗时误触其他逻辑
                this.btnConfirm.addEventListener('keydown', handleBtnKey);
                this.btnCancel.addEventListener('keydown', handleBtnKey);
            });
        },
        confirm(msg) { return this._show(msg, false); },
        prompt(msg, ph = '') { return this._show(msg, true, ph); }
    },

    I18n: {
        getLanguage() {
            const langCode = localStorage.getItem('stars_lang')
            if (langCode) return langCode;
            else if (typeof getLanguage !== 'undefined') return getLanguage();
            else return 'en';
        },

        toggle() {
            // 切换状态
            if (typeof getLanguage !== 'undefined' && typeof setLanguage !== undefined) {
                const currentLang = this.getLanguage();
                let nextLang = currentLang === 'zh-cn' ? 'en' : 'zh-cn';
                setLanguage(nextLang);
                localStorage.setItem('stars_lang', nextLang);
                this.apply();
                App.UI.showFlash((nextLang === 'zh-cn' ? "语言: 中文" : "Language: English"))
            }
        },

        apply() {
            const setText = (id, key) => { const el = document.getElementById(id); if(el) el.innerHTML = t(key); };
            const setPh = (id, key) => { const el = document.getElementById(id); if(el) el.placeholder = t(key); };

            setText('app-title', 'hud.title');
            setText('txt-view-range', 'hud.viewLayers');
            setText('txt-layers', 'hud.layers');
            setText('txt-adjust', 'hud.adjust');
            setText('txt-visible', 'hud.visible');
            setText('txt-nodes', 'hud.nodes');
            setText('key-controls', 'hud.controls');

            setText('btn-save', 'btn.save');
            setText('btn-export', 'btn.export');
            setText('btn-reset', 'btn.reset');
            setText('btn-import', 'btn.import');
            setText('btn-lang', 'btn.language');
            setText('btn-preset', 'btn.presets');

            setPh('node-label', 'sidebar.placeholder.label');
            setPh('node-summary', 'sidebar.placeholder.summary');
            setPh('node-content', 'sidebar.placeholder.content');

            setText('pe-title', 'preset.menuTitle');
            setText('pe-desc', 'preset.menuDesc');
            setText('pe-btn-add', 'preset.btnAdd');
            setText('pe-btn-save', 'preset.btnSave');

            App.Input.updateLinkModeIndicator();

            setPh('inp-jump', 'input.jump');
            setPh('inp-filter-node', 'input.filterNode');
            setPh('inp-filter-link', 'input.filterLink');
        }
    },

    Modal: {
        el: document.getElementById('content-modal'),
        body: document.getElementById('modal-body'),
        show() {
            const node = App.Store.state.focusNode;
            if (!node) return;
            if(App.Runtime.activeInstances[node.uuid]) App.Runtime.unmount(node.uuid);

            this.body.innerHTML = '';

            const raw = node.content || t('modal.noContent');
            const html = typeof marked !== 'undefined' ? marked.parse(raw) : raw;
            const containerId = `node-content-host-${node.uuid}`;

            this.body.innerHTML = `
                <div style="font-size:2em; font-weight:bold; color:#4facfe; margin-bottom:10px;">${node.label}</div>
                <div style="color:#666; font-style:italic; margin-bottom:20px; border-left:3px solid #555; padding-left:10px;">
                    ${node.summary ? (typeof marked !== 'undefined' ? marked.parse(node.summary) : node.summary) : ''}
                </div>
                <hr style="border:0; border-bottom:1px solid #333; margin-bottom:20px;">
                <div id="${containerId}" class="node-content-host" style="line-height:1.8; font-size:16px;">${html}</div>
                <div id="modal-close-btn" style="margin-top:50px; text-align:center; font-size:12px; color:#444; cursor:pointer;">
                    ${t('modal.close')} (Esc)
                </div>
            `;

            document.getElementById('modal-close-btn').addEventListener('click', () => App.UI.Modal.close());

            if (typeof hljs !== 'undefined') this.body.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
            App.Runtime.mount(node, containerId);

            this.el.classList.add('active');

            this._escHandler = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
            };
            window.addEventListener('keydown', this._escHandler);
        },
        close() {
            this.el.classList.remove('active');
            const node = App.Store.state.focusNode;
            if(node) App.Runtime.unmount(node.uuid);
            this.body.innerHTML = '';
            if(this._escHandler) window.removeEventListener('keydown', this._escHandler);
        }
    },

    RelationPicker: {
        el: document.getElementById('relation-picker'),
        active: false, resolve: null, reject: null, allowDelete: false,
        show(allowDelete = false) {
            this.allowDelete = allowDelete;
            return new Promise((res, rej) => {
                const presets = App.Store.state.presets;
                // 注意这里，原先的 preset.title 只有一个占位符，现在需要适配
                const deleteFragment = allowDelete ? t('preset.delete') : '';
                let html = `<div class="menu-title">${t('preset.title', {deleteFragment})}</div>`;

                html += presets.slice(0, 9).map((p, i) =>
                    `<div class="menu-opt" data-val="${p.val}"><span class="menu-key" style="color:${p.color}">[${i+1}]</span>${p.label || p.val}</div>`
                ).join('');

                if (presets.length > 9) {
                    html += `<div class="menu-title" style="margin-top:10px;">${t('preset.more')}</div>` +
                    presets.slice(9).map(p => `<div class="menu-opt" data-val="${p.val}"><span class="menu-key" style="visibility:hidden;">[]</span>${p.label}</div>`).join('');
                }

                if (allowDelete) {
                    html += `<div class="menu-opt delete-opt" data-val="DELETE" style="margin-top:5px; border-top:1px solid #333">
                    <span class="menu-key" style="color:#e74c3c">[D]</span>${t('linkMode.deleteLabel')}</div>`;
                }

                this.el.innerHTML = html;
                this.el.classList.add('active'); this.active = true;
                this.resolve = res; this.reject = rej;

                this.el.querySelectorAll('.menu-opt').forEach(el => {
                    el.addEventListener('click', () => this.pick(el.getAttribute('data-val')));
                });
            });
        },
        handleInput(e) {
            if(!this.active) return;
            const num = parseInt(e.key);
            const presets = App.Store.state.presets;
            if (!isNaN(num) && num >= 1 && num <= Math.min(9, presets.length)) { e.preventDefault(); this.pick(presets[num-1].val); }
            else if (e.key === ' ') { e.preventDefault(); this.pick('CUSTOM'); }
            else if (e.key === 'Enter' && presets.length>0) { e.preventDefault(); this.pick(presets[0].val); }
            else if (this.allowDelete && ['x','X','Delete'].includes(e.key)) { e.preventDefault(); this.pick('DELETE'); }
            else if (e.key === 'Escape') { e.preventDefault(); this.reject(); this.close(); }
        },
        pick(val) { if(this.resolve) { this.resolve({ val }); this.resolve=null; this.reject=null; } this.close(); },
        close() { this.el.classList.remove('active'); this.active = false; if(this.reject) { this.reject(); this.resolve=null; this.reject=null; } }
    },

    PresetEditor: {
        el: document.getElementById('preset-editor'),
        listEl: document.getElementById('preset-list-container'),
        active: false, tempPresets: [],
        open() {
            if(this.active) return;
            this.tempPresets = JSON.parse(JSON.stringify(App.Store.state.presets));
            this.renderList();
            this.el.classList.add('active'); this.active = true;
        },
        renderList() {
            this.listEl.innerHTML = '';
            this.tempPresets.forEach((p, i) => {
                const row = document.createElement('div'); row.className = 'preset-row';
                row.innerHTML = `
                    <span class="preset-idx">${i+1}</span>
                    <input type="color" class="preset-color" value="${p.color}" data-idx="${i}" data-field="color">
                    <input type="text" class="preset-input" style="width:120px" placeholder="${t('preset.input.label')}" value="${p.label}" data-idx="${i}" data-field="label">
                    <input type="text" class="preset-input" style="flex:1; color:#aaa;" placeholder="${t('preset.input.value')}" value="${p.val}" data-idx="${i}" data-field="val">
                    <span class="preset-del" data-idx="${i}">✕</span>`;
                this.listEl.appendChild(row);
            });

            this.listEl.querySelectorAll('input').forEach(input => {
                const idx = input.getAttribute('data-idx');
                const field = input.getAttribute('data-field');
                input.addEventListener('input', (e) => this.update(idx, field, e.target.value));
                if(input.type === 'text') input.addEventListener('keydown', (e) => this.handleListKey(e));
            });
            this.listEl.querySelectorAll('.preset-del').forEach(btn => {
                btn.addEventListener('click', (e) => this.remove(btn.getAttribute('data-idx')));
            });
        },
        handleListKey: function(e) { if (e.key === 'Enter') { e.preventDefault(); this.saveAndClose(); } },
        update(idx, field, val) { this.tempPresets[idx][field] = val; },
        remove(idx) { this.tempPresets.splice(idx, 1); this.renderList(); },
        add() {
            if (this.tempPresets.length >= 20) { App.UI.showFlash(t('alert.presetExceedMax'), 'warn'); return; }
            this.tempPresets.push({label: t('fallback.newRelationship'), val:'new', color: App.Utils.getRandomColor()});
            this.renderList(); setTimeout(() => this.listEl.scrollTop = this.listEl.scrollHeight, 10);
        },
        saveAndClose() {
            if (this.tempPresets.some(p => !p.val || !p.val.trim())) { App.UI.showFlash(t('alert.presetValueEmpty'), 'warn'); return; }
            const values = this.tempPresets.map(p => p.val.trim());
            if (new Set(values).size !== values.length) { App.UI.showFlash(t('alert.presetValueDuplicate'), 'warn'); return; }
            App.Store.state.presets = JSON.parse(JSON.stringify(this.tempPresets));
            App.Store.save(); App.Renderer.restartSim();
            this.close();
            App.UI.showFlash(t('flash.presetUpdated'));
        },
        close() { this.el.classList.remove('active'); this.active = false; }
    }
};

// ==========================================
// 2. Store (Fixed: ExecuteSafeAction Logic)
// ==========================================
App.Store = {
    state: {
        nodes: [],
        links: [],
        slots: [null,null,null,null],
        envNodes: [],
        focusNode: null,
        viewLayers: 1,
        navHistory: [],
        presets: [],
        filterNodeStr: "",
        filterLinkStr: "",
    },

    DEFAULT_PRESETS: [
        { label: t('preset.default.includes'), val: 'comp', color: '#0062ff' },
        { label: t('preset.default.definedAs'), val: 'def', color: '#00ff00' },
        { label: t('preset.default.intuitive'), val: 'ins', color: '#33ffff' },
        { label: t('preset.default.calculates'), val: 'calc', color: '#ffaa00' },
        { label: t('preset.default.implies'), val: 'impl', color: '#bd00ff' },
        { label: t('preset.default.orthogonalTo'), val: 'orth', color: '#ff0055' },
    ],

    pushHistory(node) {
        if(node) {
            this.state.navHistory.push(node);
            if(this.state.navHistory.length > 50) {
                this.state.navHistory.shift();
            }
        }
    },

    getBackNodeIndex() {
        let {focusNode, navHistory, nodes} = this.state;
        // 策略：倒序遍历历史，找到第一个“既不是当前的节点，又真实存在于 nodes 列表”的节点
        for (let i = navHistory.length - 1; i >= 0; i--) {
            const hNode = navHistory[i];
            // 排除掉自己
            if (hNode.uuid === focusNode.uuid) continue;
            // 确保这个历史节点还“活着”
            if (nodes.find(n => n.uuid === hNode.uuid)) return i;
        }
        return -1;
    },

    loadState(payload, shouldSave = false) {
        // 1. 清理旧状态
        App.Runtime.clearAllStorage();
        this.state.navHistory = [];
        // 2. 处理空数据情况 (回退到创建根节点)
        if (!payload || !payload.data || !payload.data.nodes) {
            this.createRoot();
            if (shouldSave) this.save();
            return;
        }
        // 3. 解析基础数据
        // 兼容两种 presets 写法
        this.state.presets = (payload.presets && Array.isArray(payload.presets))
            ? payload.presets
            : this.DEFAULT_PRESETS;
        this.state.viewLayers = payload.viewLayers || 1;
        // 4. 重建对象引用 (核心逻辑)
        // 无论数据源是对象还是字符串，这里都统一处理
        // 使用 Map 确保 O(1) 查找
        const nodeMap = new Map(payload.data.nodes.map(n => [n.uuid, { ...n }])); // 浅拷贝防止污染源数据
        // 初始化节点物理状态
        nodeMap.forEach(n => {
            if (n.x == null || isNaN(n.x)) n.x = (Math.random() - 0.5) * 50;
            if (n.y == null || isNaN(n.y)) n.y = (Math.random() - 0.5) * 50;
            n.alpha = 0; n.vx = 0; n.vy = 0; n.fx = null; n.fy = null;
            if (n.isRoot) { n.fx = 0; n.fy = 0; }
        });

        // 恢复 envNodes 引用
        this.state.envNodes = (payload.envNodes || [])
            .map(uuid => nodeMap.get(uuid))
            .filter(n => n);
        // 确保这些节点的 isEnv 标记为 true，且不透明
        this.state.envNodes.forEach(n => {
            n.isEnv = true;
            n.alpha = 1;
        });

        this.state.nodes = Array.from(nodeMap.values());
        // 恢复连线引用
        this.state.links = (payload.data.links || []).map(l => ({
            source: nodeMap.get(typeof l.source === 'object' ? l.source.uuid : l.source) || l.source,
            target: nodeMap.get(typeof l.target === 'object' ? l.target.uuid : l.target) || l.target,
            type: l.type,
            alpha: 0
        })).filter(l => l.source && l.target && typeof l.source !== 'string' && typeof l.target !== 'string');
        // 恢复插槽引用
        this.state.slots = (payload.slots || [null, null, null, null])
            .map(uuid => uuid ? nodeMap.get(uuid) : null);
        // 5. 设置焦点节点 (Focus Node)
        this.state.focusNode = payload.focusNodeUuid
            ? nodeMap.get(payload.focusNodeUuid)
            : (this.state.nodes.find(n => n.isRoot) || this.state.nodes[0]);
        // 兜底：如果没有焦点节点，创建一个
        if (!this.state.focusNode) {
            this.createRoot();
        } else {
            this.state.focusNode.alpha = 1;
        }
        // 6. 计算初始可见性 (BFS)
        // 这一步是为了让首屏渲染不至于全黑，且不需要等物理模拟跑太久
        if (this.state.focusNode) {
            const initVis = new Set([this.state.focusNode.uuid]);
            const q = [{n: this.state.focusNode, d: 0}];
            let h = 0;

            // 建立临时邻接表加速查找
            const adj = {};
            this.state.links.forEach(l => {
                const s = l.source.uuid, t = l.target.uuid;
                if(!adj[s]) adj[s] = []; adj[s].push(t);
                if(!adj[t]) adj[t] = []; adj[t].push(s);
            });
            while(h < q.length) {
                const {n, d} = q[h++];
                if(d >= this.state.viewLayers) continue;
                (adj[n.uuid] || []).forEach(neighborUuid => {
                    if (!initVis.has(neighborUuid)) {
                        initVis.add(neighborUuid);
                        const neighborNode = nodeMap.get(neighborUuid);
                        if (neighborNode) {
                            neighborNode.alpha = 1;
                            q.push({n: neighborNode, d: d+1});
                        }
                    }
                });
            }
        }
        // 7. 重置视图位置 (Camera)
        if (App.Renderer.width > 0 && this.state.focusNode) {
            if (this.state.focusNode.isEnv) {
                // 如果焦点是环境节点，则将相机定位到世界原点，显示正常画布中心
                App.Renderer.viewX = App.Renderer.width / 2;
                App.Renderer.viewY = App.Renderer.height / 2;
            } else {
                // 否则，正常地将相机定位到焦点节点
                App.Renderer.viewX = -this.state.focusNode.x * App.Renderer.viewK + App.Renderer.width / 2;
                App.Renderer.viewY = -this.state.focusNode.y * App.Renderer.viewK + App.Renderer.height / 2;
            }
        }
        // 8. 刷新 UI 和 模拟器
        App.UI.updateSidebar();
        App.UI.updateSlotUI();
        App.Renderer.adjustZoomByLayer(); // 确保缩放级别正确
        App.Renderer.restartSim();

        // 预热模拟 (让节点稍微散开一点)
        for(let i=0; i<30; i++) App.Renderer.simulation.tick();
        this.save();
    },

    createRoot() {
        const rootUUID = uuid.v4();
        const root = {
            uuid: rootUUID,
            label: t('fallback.origin'),
            isRoot: true,
            x: 0, y: 0,
            fx: 0, fy: 0,
            summary: t('fallback.summary'),
            content: t('fallback.content'),
            color: "#ffffff",
            alpha: 1
        };
        this.state.nodes = [root];
        this.state.links = [];
        this.state.slots = [null,null,null,null];
        this.state.focusNode = root;
        this.state.viewLayers = 1;
        this.state.navHistory = []; // 新建根节点时清空历史记录
        this.state.presets = this.DEFAULT_PRESETS; // 新建根节点时重置预设
    },

    // 核心安全执行器 (Anchor-based Safety Check)
    async executeSafeAction(simulator, onApplied = null) {
        const { nodes, focusNode, slots, links, envNodes } = this.state;

        // 1. 获取当前锚点集合 (Origin + Focus + Slots)
        const getAnchorUUIDs = (nList, fNode, sList, eList) => {
            const root = nList.find(n => n.isRoot);
            // 过滤空值并提取UUID
            const sources = [root, fNode, ...sList, ...(eList || [])].filter(n => n);
            return new Set(sources.map(n => n.uuid));
        };
        const currentAnchorUUIDs = getAnchorUUIDs(nodes, focusNode, slots);

        // 2. 模拟未来状态
        const nextState = simulator();
        // 注意：simulator 可能没有返回 nextEnvNodes，如果没返回则认为 envNodes 未变
        const nextEnvNodes = nextState.nextEnvNodes || envNodes;
        const nextAnchorUUIDs = getAnchorUUIDs(
            nextState.nodes,
            nextState.nextFocus,
            nextState.nextSlots,
            nextEnvNodes
        );

        // 3. 快速放行判定
        // 条件 A: 结构未受损 (节点数未减少 且 连线数未减少)
        const isStructureIntact = nextState.nodes.length >= nodes.length && nextState.links.length >= links.length;

        // 条件 B: 锚点完整性 (Anchor Integrity)
        // 原逻辑要求完全相等，现在改为：只要新的锚点集合包含旧集合的所有元素（即锚点没有丢失，只增不减），由于结构也未丢失，则判定为安全。
        // 这对于 "升舱 (Docking)" 操作特别有效。
        let isAnchorsSafe = true;
        for (let id of currentAnchorUUIDs) {
            if (!nextAnchorUUIDs.has(id)) {
                isAnchorsSafe = false;
                break;
            }
        }

        const applyState = () => {
            if (this.state.focusNode !== nextState.nextFocus) {
                App.Input.onFocusMove(this.state.focusNode, nextState.nextFocus);
            }
            this.state.nodes = nextState.nodes;
            this.state.links = nextState.links;
            this.state.focusNode = nextState.nextFocus;
            this.state.slots = nextState.nextSlots;
            if (typeof onApplied === 'function') {
                onApplied();
            }
            App.UI.updateSidebar();
            App.UI.updateSlotUI();
            this.save();
            App.Renderer.restartSim();
        };

        if (isStructureIntact && isAnchorsSafe) {
            applyState();
            return true;
        }

        // 4. 连通性检查 (Reachability)
        const anchorsObjects = nextState.nodes.filter(n => nextAnchorUUIDs.has(n.uuid));
        const reachableUUIDs = App.Utils.findReachable(nextState.nodes, nextState.links, anchorsObjects);
        const lostNodes = nextState.nodes.filter(n => !reachableUUIDs.has(n.uuid));

        if (lostNodes.length > 0) {
            const label = lostNodes[0].label;
            const msg = t('alert.deleteConfirm', { n: lostNodes.length, label: label });

            if (await App.UI.Dialog.confirm(msg)) {
                // Apply simulation result first
                applyState();

                // Then cleanup lost nodes
                const deadSet = new Set(lostNodes.map(n => n.uuid));
                this.state.nodes = this.state.nodes.filter(n => !deadSet.has(n.uuid));
                this.state.links = this.state.links.filter(l => !deadSet.has(l.source.uuid) && !deadSet.has(l.target.uuid));
                this.state.slots = this.state.slots.map(s => (s && deadSet.has(s.uuid)) ? null : s);
                this.state.navHistory = this.state.navHistory.filter(n => !deadSet.has(n.uuid));
                lostNodes.forEach(n => App.Runtime.clearStorage(n.uuid));

                this.save();
                App.Renderer.restartSim();
                return true;
            }
            return false;
        } else {
            applyState();
            return true;
        }
    },

    save() {
        const payload = {
            data: {
                nodes: this.state.nodes.map(n => ({
                    uuid: n.uuid, label: n.label, isRoot: n.isRoot, x: n.x, y: n.y,
                    summary: n.summary, content: n.content, color: n.color
                })),
                links: this.state.links.map(l => ({
                    source: (typeof l.source === 'object') ? l.source.uuid : l.source,
                    target: (typeof l.target === 'object') ? l.target.uuid : l.target,
                    type: l.type
                }))
            },
            focusNodeUuid: this.state.focusNode ? this.state.focusNode.uuid : null,
            slots: this.state.slots.map(s => s ? s.uuid : null),
            envNodes: this.state.envNodes.map(n => n.uuid),
            viewLayers: this.state.viewLayers,
            presets: this.state.presets
        };
        vscode.postMessage({ command: 'saveData', data: payload });
        return payload;
    },
    saveDebounced: null,

    exportData() {
        const data = this.save();

        const b = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'stars_v5.json';
        a.click();
    },

    importData(inp) {
        const f = inp.files[0];
        if(f) {
            const r = new FileReader();
            r.onload = e => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data && data.data && Array.isArray(data.data.nodes)) {
                        vscode.postMessage({ command: 'saveData', data: data });
                        App.Store.loadState(data, true);
                        App.UI.showFlash(t('alert.importSuccess'));
                    } else App.UI.showFlash(t('alert.importFail'), 'warn');
                } catch(e) {
                    console.error(t('alert.parseFail'), e);
                    App.UI.showFlash(t('alert.parseFail'), 'warn');
                };
            };
            r.readAsText(f);
            inp.value = '';
        }
    },

    async resetSystem() {
        if(await App.UI.Dialog.confirm(t('alert.resetConfirm'))) {
            App.Runtime.clearAllStorage();
            vscode.postMessage({ command: 'resetSystem' });
        }
    },

    toggleEnvNode(node) {
        if (!node || node.isRoot) return; // 根节点不能飞
        node.isEnv = !node.isEnv;
        if (node.isEnv) {
            // 升舱：加入 envNodes 列表
            if (!this.state.envNodes.find(n => n.uuid === node.uuid)) {
                this.state.envNodes.push(node);
            }
            // 物理重置：停止它的运动，防止它带着速度飞走
            node.vx = 0; node.vy = 0;
        } else {
            // 降舱：从列表移除
            this.state.envNodes = this.state.envNodes.filter(n => n.uuid !== node.uuid);
            // 物理重置：释放它的固定位置
            node.fx = null;
            node.fy = null;
        }

        this.save();
        App.Renderer.restartSim(); // 重启物理引擎以剔除/接纳节点
    },
};
App.Store.saveDebounced = App.Utils.debounce(() => App.Store.save(), 1000);

// ==========================================
// 3. Runtime (节点脚本沙箱) - Unified Version
// ==========================================
App.Runtime = {
    activeInstances: {}, // { uuid: { unmountFn: ... } }
    mount(node, containerId) {
        // 1. 清理旧实例
        this.unmount(node.uuid);
        const container = document.getElementById(containerId);
        if (!container) return;
        // 2. 提取并移除 script 标签
        const scriptsToExecute = [];
        // 使用 Array.from 转换 NodeList 以便安全遍历
        Array.from(container.querySelectorAll('script')).forEach(script => {
            scriptsToExecute.push(script.textContent);
            script.remove();
        });
        let unmountCallbacks = [];
        // 3. 创建 API 沙箱环境
        const api = {
            // DOM 操作仅限于容器内部
            $: (sel) => container.querySelector(sel),
            $$: (sel) => container.querySelectorAll(sel),

            // 数据存储
            storage: this._createStorageApi(node.uuid),

            // 节点元数据
            node: { uuid: node.uuid, label: node.label, color: node.color },

            // 生命周期
            onMount: (cb) => {
                try { cb(); } catch(e) { console.error(`[Node ${node.uuid}] onMount error:`, e); }
            },
            onUnmount: (cb) => { unmountCallbacks.push(cb); },
            // 全局对象访问 (保留 VSCode 版的能力，如果追求绝对安全可移除)
            window: window,
            document: document,

            // 辅助工具
            container: container
        };
        // 4. 注册销毁函数
        this.activeInstances[node.uuid] = {
            unmountFn: () => {
                unmountCallbacks.forEach(cb => {
                    try { cb(); } catch(e) { console.error(`[Node ${node.uuid}] onUnmount error:`, e); }
                });
                unmountCallbacks = [];
            }
        };
        // 5. 执行脚本
        scriptsToExecute.forEach((code) => {
            try {
                // 使用 "use strict" 模式 (来自 VSCode 版优化)
                new Function('api', `(function(Runtime){ "use strict"; ${code} })(arguments[0])`)(api);
            } catch (e) {
                console.error(`Script error in node ${node.uuid}:`, e);
                this._renderError(container, e.message);
            }
        });
    },
    unmount(uuid) {
        if (this.activeInstances[uuid]) {
            try {
                this.activeInstances[uuid].unmountFn();
            } catch (e) {
                console.warn(`Error unmounting node ${uuid}:`, e);
            }
            delete this.activeInstances[uuid];
        }
    },
    _renderError(container, message) {
        const errDiv = document.createElement('div');
        Object.assign(errDiv.style, {
            color: '#ff4d4f',
            fontSize: '12px',
            marginTop: '8px',
            padding: '4px',
            background: 'rgba(255,0,0,0.05)',
            borderLeft: '2px solid #ff4d4f'
        });
        errDiv.innerText = `Script Error: ${message}`;
        container.appendChild(errDiv);
    },
    _createStorageApi(uuid) {
        const prefix = `node_storage_${uuid}_`;
        // 保留 Web 版的 try-catch，防止隐私模式或配额已满导致崩溃
        return {
            set: (k, v) => {
                try { localStorage.setItem(prefix + k, JSON.stringify(v)); return true; }
                catch(e) { console.warn('Storage set failed:', e); return false; }
            },
            get: (k, def) => {
                try { const i = localStorage.getItem(prefix + k); return i ? JSON.parse(i) : def; }
                catch(e) { return def; }
            },
            remove: (k) => localStorage.removeItem(prefix + k),
            clear: () => this.clearStorage(uuid)
        };
    },
    clearStorage(uuid) {
        const prefix = `node_storage_${uuid}_`;
        this._clearStorageByPrefix(prefix);
    },
    clearAllStorage() {
        this._clearStorageByPrefix("node_storage_");
    },
    // 统一的清理逻辑 (结合 VSCode 的简洁和 Web 的倒序遍历思想避免索引塌陷)
    _clearStorageByPrefix(prefix) {
        Object.keys(localStorage)
            .filter(k => k.startsWith(prefix))
            .forEach(k => localStorage.removeItem(k));
    }
};

// ==========================================
// 5. Renderer (渲染与物理模拟 - 最终优化注释版)
// ==========================================
App.Renderer = {
    // --- 核心 DOM 引用 ---
    canvas: document.getElementById('canvas'),
    ctx: document.getElementById('canvas').getContext('2d'),

    // --- 视口与相机状态 ---
    width: 0, height: 0,        // 画布的逻辑宽高
    viewX: 0, viewY: 0,         // 相机当前位置（世界坐标的偏移量）
    viewK: 1,                   // 相机缩放比例 (Scale)
    viewRotation: 0,            // 当前视口的旋转角度 (弧度)
    targetRotation: 0,          // 目标旋转角度 (用于平滑动画)

    // --- 物理引擎相关 ---
    simulation: null,           // D3 力导向图实例
    pointerForce: null,         // 鼠标拖拽产生的引力

    // --- 动画循环变量 ---
    lastRenderTime: 0,          // 上一帧的时间戳 (用于计算 deltaTime)
    cameraLookAtX: undefined,   // 相机正在盯着的目标点 X (用于平滑飞行)
    cameraLookAtY: undefined,   // 相机正在盯着的目标点 Y

    // --- [优化] DOM 元素缓存 ---
    // 避免在每帧 render 循环中反复调用 document.getElementById，提高性能
    uiRefs: {
        layerIndicator: null,   // 左下角显示的层级数 DOM
        visibleCount: null      // 左下角显示的可见节点数 DOM
    },

    // --- [优化] 可视性计算缓存 (脏检查机制) ---
    // 只有当焦点、鼠标悬停或数据发生变化时，才重新计算 BFS，而不是每帧都算
    visCache: {
        nodes: new Set(),       // 当前可见节点的 UUID 集合
        links: new Set(),       // 当前可见连线的对象集合
        lastSignature: ""       // 状态指纹，用于比对是否需要更新
    },

    // --- [修复] 样式映射表 ---
    // 将数组格式的 presets 转换为 Map，使颜色查找从 O(n) 变为 O(1)
    presetMap: new Map(),
    lastPresetsRef: null,       // 用于检测数据源是否发生变更

    // --- 常量配置 ---
    FADE_DURATION: 400,         // 节点显示/隐藏的渐变时间 (毫秒)
    DEFAULT_NODE_COLOR: "#4facfe",
    LINK_DISTANCE: 220,         // 物理连线的理想长度
    MIN_NODE_PIXEL_SIZE: 3,     // 节点在屏幕上的最小像素尺寸 (防消失)
    MIN_FOCUS_NODE_PIXEL_SIZE: 6,     // 节点在屏幕上的最小像素尺寸 (防消失)
    PROXIMITY_RANGE: 300,       // 鼠标接近时的感应半径
    HOVER_STOP_RANGE: 30,       // 鼠标进入此半径后，节点保持最大放大倍数
    MAX_SCALE_MULT: 1.8,        // 鼠标接近时的最大放大倍数

    // ==========================================
    // 初始化函数
    // ==========================================
    init() {
        // 1. 缓存 UI 元素引用
        this.uiRefs.layerIndicator = document.getElementById('layer-indicator');
        this.uiRefs.visibleCount = document.getElementById('visible-count');

        // 2. 初始化画布大小 (处理高清屏)
        this.resize();

        // 3. 初始化 D3 物理模拟引擎
        // forceLink: 连线拉力
        // forceCharge: 节点间的斥力 (负值表示排斥)
        // forceCollide: 防止节点重叠
        this.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.uuid).distance(this.LINK_DISTANCE).strength(0.1))
            .force("charge", d3.forceManyBody().strength(-80))
            .force("collide", d3.forceCollide(10))
            // 产生微弱的中心引力，防止图散开太远
            .force("center", d3.forceX(0).strength(0.005))
            .force("centerY", d3.forceY(0).strength(0.005))
            .alphaDecay(0.05).alphaMin(0.05); // 衰减系数，决定了物理停止的快慢

        // 4. 自定义鼠标力 (让被拖拽的节点跟随鼠标)
        const force = (() => {
            let node, target, strength = 0.02;
            function f(alpha) {
                if (!node || !target) return;
                const dx = target.x - node.x, dy = target.y - node.y;
                // 使用指数衰减公式，让拖拽手感更像橡皮筋
                const k = strength * (1 - Math.exp(-Math.hypot(dx, dy) / 120));
                node.vx += dx * k; node.vy += dy * k;
            }
            f.initialize = () => {};
            f.node = (n) => { node = n; return f; };
            f.target = (x, y) => { target = {x,y}; return f; };
            return f;
        })();
        this.pointerForce = force;
        this.simulation.force('pointerDrag', this.pointerForce);

        // 5. 启动渲染循环
        requestAnimationFrame((t) => this.render(t));
    },

    // ==========================================
    // 窗口大小调整 (处理高清屏 DPR)
    // ==========================================
    resize() {
        const sidebarW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 340;
        const logicalWidth = window.innerWidth - sidebarW;
        const logicalHeight = window.innerHeight;

        // 逻辑宽高 (CSS 像素)
        this.width = logicalWidth;
        this.height = logicalHeight;

        // 物理像素 (设备像素 = 逻辑像素 * DPR)
        // 这一步是为了让 Canvas 在 Retina 屏幕上不模糊
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = logicalWidth * dpr;
        this.canvas.height = logicalHeight * dpr;

        // 强制 CSS 尺寸匹配逻辑尺寸
        this.canvas.style.width = `${logicalWidth}px`;
        this.canvas.style.height = `${logicalHeight}px`;

        // 缩放 Context，使得后续绘图可以直接使用逻辑坐标
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
    },

    // 根据层级自动调整缩放比例 (层级越深，看的越远/越小)
    adjustZoomByLayer() {
        this.viewK = 2.0 / Math.pow(App.Store.state.viewLayers, 0.7);
    },

    // ==========================================
    // 重启物理模拟 (性能优化版)
    // ==========================================
    restartSim() {
        const { nodes, links, focusNode, filterNodeStr, filterLinkStr } = App.Store.state;

        // --- 准备筛选规则 ---
        let nodeRegex = null;
        if (filterNodeStr && filterNodeStr.trim() !== "") {
            try { nodeRegex = new RegExp(filterNodeStr, 'i'); } catch (e) { console.warn("Invalid Node Regex"); }
        }
        let linkRegex = null;
        if (filterLinkStr && filterLinkStr.trim() !== "") {
            try { linkRegex = new RegExp(filterLinkStr, 'i'); } catch (e) { console.warn("Invalid Link Regex"); }
        }
        // 节点保留规则：焦点永远保留，或者是环境接口，或者符合正则
        const isNodeValid = (n) => {
            if (n === focusNode) return true;
            if (n.isEnv) return true; // 接口节点通常也保留，或者你可以看情况去掉这行
            if (!nodeRegex) return true;
            return nodeRegex.test(n.label);
        };
        // 连线保留规则
        const isLinkValid = (l) => {
            if (!linkRegex) return true;
            const preset = this.presetMap.get(l.type);
            const label = preset ? preset.label : l.type;
            return linkRegex.test(label);
        };

        // 固定根节点位置
        const root = nodes.find(n => n.isRoot);
        if (root) { root.fx = 0; root.fy = 0; }

        // --- 第一阶段：无差别的拓扑搜索 (Reachability) ---
        // 目的：找出距离内所有的“候选节点”，不管它是否符合正则。
        // 这样可以确保：“A -> B(被屏蔽) -> C(正常)”，当我们关注 A 时，C 依然能被找到。

        const SIM_LAYERS = Math.max(7, App.Store.state.viewLayers);
        const targets = new Set();

        // 从 FocusNode 开始，找出周围 N 层节点加入物理模拟
        if (focusNode) {
            targets.add(focusNode.uuid);
            let queue = [{n: focusNode, d: 0}], head = 0;

            // 临时构建邻接表加速查找 (O(Edges))
            const adj = {};
            for (let i = 0; i < links.length; i++) {
                const l = links[i];
                const s = l.source.uuid;
                const t = l.target.uuid;
                if(!adj[s]) adj[s]=[]; adj[s].push(t);
                if(!adj[t]) adj[t]=[]; adj[t].push(s);
            }

            // BFS 搜索
            while(head < queue.length) {
                const {n, d} = queue[head++];
                if (d >= SIM_LAYERS) continue;
                const neighbors = adj[n.uuid] || [];
                for (let i = 0; i < neighbors.length; i++) {
                    const nid = neighbors[i];
                    if(!targets.has(nid)) {
                        targets.add(nid);
                        const obj = nodes.find(x=>x.uuid===nid);
                        if(obj) queue.push({n:obj, d:d+1});
                    }
                }
            }
        }

        // --- 第二阶段：严格的物理准入筛选 (Admission Control) ---
        // 目的：在刚才找到的一大堆候选节点中，把不符合正则的踢出物理世界。

        const activeNodes = nodes.filter(n =>
            targets.has(n.uuid) &&
            !n.isEnv &&
            isNodeValid(n)
        );
        // 建立一个快速查找表，用于下方筛选连线
        const activeNodeIds = new Set(activeNodes.map(n => n.uuid));
        const activeLinks = links.filter(l =>
            activeNodeIds.has(l.source.uuid) && !l.source.isEnv &&
            activeNodeIds.has(l.target.uuid) && !l.target.isEnv &&
            isLinkValid(l)
        );

        // 将活跃节点注入 D3
        this.simulation.nodes(activeNodes);
        this.simulation.force("link").links(activeLinks);
    },

    // ==========================================
    // [核心优化] 可视性计算 (BFS + 缓存)
    // ==========================================
    updateVisibility(focusNode, hoverNode, previewNode, viewLayers, nodes, links) {
        // 获取筛选正则字符串
        const { filterNodeStr, filterLinkStr } = App.Store.state;

        // 1. 生成状态签名 (Signature)
        // 包括：关键节点ID、层级、数据长度。如果这些都没变，说明可视范围没变。
        // 加入 filterNodeStr 和 filterLinkStr 到签名中，以便变化时重新计算
        const focusId = focusNode ? focusNode.uuid : 'null';
        const hoverId = hoverNode ? hoverNode.uuid : 'null';
        const previewId = previewNode ? previewNode.uuid : 'null';
        const signature = `${focusId}|${hoverId}|${previewId}|${viewLayers}|${links.length}|${nodes.length}|${filterNodeStr}|${filterLinkStr}`;

        // 2. 脏检查：如果签名一致，直接复用上次计算结果，跳过 BFS
        if (this.visCache.lastSignature === signature) {
            return;
        }

        const visibleNodes = new Set();
        const visibleLinks = new Set();

        // 3. [优化] 构建临时邻接表
        // 原生遍历 Links 是 O(N*L)，构建邻接表后是 O(N+L)，在大数据量下快几十倍
        const adj = new Map();
        for (let i = 0; i < links.length; i++) {
            const l = links[i];
            const src = l.source;
            const tgt = l.target;

            if (!adj.has(src.uuid)) adj.set(src.uuid, []);
            if (!adj.has(tgt.uuid)) adj.set(tgt.uuid, []);

            // 保存 Link 对象的引用，以便稍后直接标记 Link 可见
            adj.get(src.uuid).push({ node: tgt, link: l });
            adj.get(tgt.uuid).push({ node: src, link: l });
        }

        // 4. 执行 BFS (广度优先搜索)
        const queue = [];
        const runBFS = (startNode, maxDepth) => {
            if (!startNode) return;
            visibleNodes.add(startNode.uuid);
            queue.length = 0;
            queue.push({ n: startNode, d: 0 });

            let head = 0;
            while(head < queue.length) {
                const { n, d } = queue[head++];
                if (d >= maxDepth) continue;

                const neighbors = adj.get(n.uuid);
                if (neighbors) {
                    for (let i = 0; i < neighbors.length; i++) {
                        const { node: neighbor, link } = neighbors[i];

                        // 只要连到了当前可见节点，这条线就应该显示
                        visibleLinks.add(link);

                        // 如果邻居还没遍历过，加入队列
                        if (!visibleNodes.has(neighbor.uuid)) {
                            visibleNodes.add(neighbor.uuid);
                            queue.push({ n: neighbor, d: d + 1 });
                        }
                    }
                }
            }
        };

        // 对三个关键点分别运行 BFS
        if(focusNode) runBFS(focusNode, viewLayers);
        if(hoverNode && hoverNode !== focusNode) runBFS(hoverNode, 1);
        if(previewNode && previewNode !== focusNode) runBFS(previewNode, 1);

        // ==========================================
        // 新增：基于正则表达式的“减法”筛选
        // ==========================================

        // 5.1 节点正则筛选
        if (filterNodeStr && filterNodeStr.trim() !== "") {
            try {
                const nodeRegex = new RegExp(filterNodeStr, 'i'); // 'i' 忽略大小写
                // 遍历当前可见节点，不符合的剔除
                // 注意：不能直接在这个循环里删 visibleNodes，因为后面要处理连线
                const toRemoveNodes = new Set();
                visibleNodes.forEach(uuid => {
                    const node = nodes.find(n => n.uuid === uuid);
                    // 如果节点不存在或者不匹配正则 (且不是焦点节点，焦点节点通常不应该被筛选掉)
                    if (node && node !== focusNode && !nodeRegex.test(node.label)) {
                        toRemoveNodes.add(uuid);
                    }
                });
                toRemoveNodes.forEach(uuid => visibleNodes.delete(uuid));
            } catch (e) { console.warn("Invalid Node Regex", e); }
        }

        // 5.2 连线正则筛选
        if (filterLinkStr && filterLinkStr.trim() !== "") {
            try {
                const linkRegex = new RegExp(filterLinkStr, 'i');
                const toRemoveLinks = new Set();
                visibleLinks.forEach(l => {
                    // 获取连线的显示名称 (优先 Preset Label，否则用 raw type)
                    const preset = this.presetMap.get(l.type);
                    const label = preset ? preset.label : l.type;
                    if (!linkRegex.test(label)) {
                        toRemoveLinks.add(l);
                    }
                });
                toRemoveLinks.forEach(l => visibleLinks.delete(l));
            } catch (e) { console.warn("Invalid Link Regex", e); }
        }

        // 5.3 一致性清理：如果节点被隐藏了，连接该节点的线也必须隐藏
        // 这一步必须最后做
        const finalLinksToRemove = new Set();
        visibleLinks.forEach(l => {
            const canRemove =
                !this.subjectNodes.has(l.source.uuid) &&
                !this.subjectNodes.has(l.target.uuid);
            const shouldRemove =
                l.source.isEnv && canRemove ||
                l.target.isEnv && canRemove ||
                !visibleNodes.has(l.source.uuid) ||
                !visibleNodes.has(l.target.uuid);
            if (shouldRemove) finalLinksToRemove.add(l);
        });
        finalLinksToRemove.forEach(l => visibleLinks.delete(l));

        // 6. 更新缓存
        this.visCache.nodes = visibleNodes;
        this.visCache.links = visibleLinks;
        this.visCache.lastSignature = signature;
    },

    // ==========================================
    // [核心] 主渲染循环 (每秒约 60 次)
    // ==========================================
    render(currentTime) {
        // 获取输入状态和 Store 数据
        const { keyState, dragNode, mouseX, mouseY, hoverNode, previewNode, linkMode } = App.Input.state;
        const { nodes, links, focusNode, viewLayers, slots, presets } = App.Store.state;
        this.subjectNodes = new Set();
        if (focusNode) this.subjectNodes.add(focusNode.uuid);
        if (hoverNode) this.subjectNodes.add(hoverNode.uuid);
        if (previewNode) this.subjectNodes.add(previewNode.uuid);

        // --- [修复] 异步数据同步 ---
        // 因为 presets 数据可能是异步加载的，这里检测引用变化，动态更新 Map
        if (presets && presets !== this.lastPresetsRef) {
            this.presetMap.clear();
            presets.forEach(p => {
                this.presetMap.set(p.val, { color: p.color, label: p.label });
            });
            this.lastPresetsRef = presets;
        }

        // --- 处理键盘旋转 ---
        if (keyState['<'] || keyState['Q']) {
            this.targetRotation += 0.05;
            // 旋转时隐藏临时的预览提示，避免眼花
            if(previewNode) { App.Input.state.previewNode = null; App.Input.hideTooltip(); }
        }
        if (keyState['>'] || keyState['E']) {
            this.targetRotation -= 0.05;
            if(previewNode) { App.Input.state.previewNode = null; App.Input.hideTooltip(); }
        }

        // --- 计算时间增量 (Delta Time) ---
        // 使得动画速度在不同刷新率的显示器上保持一致
        if (!this.lastRenderTime) this.lastRenderTime = currentTime;
        const deltaTime = currentTime - this.lastRenderTime;
        this.lastRenderTime = currentTime;

        // --- 物理交互更新 ---
        // [优化] 优先将鼠标屏幕坐标 -> 世界坐标
        const wMouse = this.screenToWorld(mouseX, mouseY);
        if (dragNode) {
            this.pointerForce.node(dragNode).target(wMouse.x, wMouse.y);
        }

        // --- 相机平滑飞行逻辑 ---
        const halfW = this.width / 2;
        const halfH = this.height / 2;

        if(focusNode && !focusNode.isEnv && !App.Input.state.isPanning) { //如果当前焦点是接口节点，不要自动跟随飞行！
            // 初始化相机位置
            if (this.cameraLookAtX === undefined) {
                this.cameraLookAtX = focusNode.x;
                this.cameraLookAtY = focusNode.y;
            }
            // 缓动公式: 当前 += (目标 - 当前) * 速度系数
            this.cameraLookAtX += (focusNode.x - this.cameraLookAtX) * 0.1;
            this.cameraLookAtY += (focusNode.y - this.cameraLookAtY) * 0.1;

            // 计算最终 View 偏移 (相机在世界坐标的反方向)
            this.viewX = -this.cameraLookAtX * this.viewK + halfW;
            this.viewY = -this.cameraLookAtY * this.viewK + halfH;
        }

        // 旋转角度缓动
        let diff = this.targetRotation - this.viewRotation;
        // 确保按最近路径旋转 (比如从 350度 到 10度，只转20度而不是340度)
        while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        this.viewRotation += diff * 0.1;

        // --- Canvas 绘制准备 ---
        const ctx = this.ctx;
        ctx.save();
        ctx.clearRect(0, 0, this.width, this.height);

        // 应用全局变换矩阵 (Transform Matrix)
        // 顺序：移到中心 -> 旋转 -> 移回 -> 平移 -> 缩放
        ctx.translate(halfW, halfH);
        ctx.rotate(this.viewRotation);
        ctx.translate(-halfW, -halfH);
        ctx.translate(this.viewX, this.viewY);
        ctx.scale(this.viewK, this.viewK);

        // --- 更新可见性 ---
        this.updateVisibility(focusNode, hoverNode, previewNode, viewLayers, nodes, links);
        const { nodes: visibleNodeSet, links: visibleLinkSet } = this.visCache;

        // ==========================================
        // 绘制连线 (Links)
        // ==========================================
        const fadeStep = deltaTime / this.FADE_DURATION;
        const linksLen = links.length;
        const hoverLink = App.Input.state.hoverLink;

        for (let i = 0; i < linksLen; i++) {
            const l = links[i];
            const isVis = visibleLinkSet.has(l);

            // Alpha 渐变插值
            if(isVis && l.alpha < 1) l.alpha += fadeStep;
            else if(!isVis && l.alpha > 0) l.alpha -= fadeStep;
            // 钳位 (Clamp) 防止越界
            if (l.alpha > 1) l.alpha = 1;
            if (l.alpha < 0) l.alpha = 0;

            // 只绘制可见度 > 1% 的线
            if(l.alpha > 0.01) {
                const src = l.source, tgt = l.target;

                // 判断是否需要高亮
                const isTarget = l === hoverLink;
                const isFocus = (src===focusNode || tgt===focusNode) ||
                    (hoverNode && (src===hoverNode||tgt===hoverNode)) ||
                    (previewNode && (src===previewNode||tgt===previewNode));

                // 调整透明度和线宽
                const mult = isTarget ? 1.0 : isFocus ? 0.7 : 0.3;
                ctx.globalAlpha = l.alpha * mult;
                ctx.lineWidth = isTarget ? 4.0 : isFocus ? 2.5 : 1.5;
                if (l.source.isEnv || l.target.isEnv) {
                    // 除以缩放
                    ctx.lineWidth /= this.viewK;
                }

                // [优化] O(1) 查找颜色
                const preset = this.presetMap.get(l.type);
                const typeColor = preset ? preset.color : '#666';

                // 绘制渐变线
                const grad = ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y);
                grad.addColorStop(0, typeColor);
                grad.addColorStop(1, "#88888888"); // 尾端半透明

                ctx.strokeStyle = grad;
                ctx.beginPath();
                ctx.moveTo(src.x, src.y);
                ctx.lineTo(tgt.x, tgt.y);
                ctx.stroke();

                // 绘制文字标签
                if (l.type && (isFocus || isTarget)) {
                     const mx = (src.x+tgt.x)/2, my = (src.y+tgt.y)/2;
                     ctx.save();
                     ctx.translate(mx, my);
                     ctx.rotate(-this.viewRotation); // 文字始终保持水平，抵消画布旋转
                     ctx.fillStyle = typeColor;
                     ctx.font = "11px Arial";
                     ctx.textAlign="center";
                     // 优先显示 Label，没有则显示 Type
                     ctx.fillText(preset ? preset.label : l.type, 0, -8);
                     ctx.restore();
                }
            }
        }
        ctx.restore(); // 连线绘制完毕，恢复矩阵

        // --- 新增: 绘制拖拽连线预览 ---
        const dragLink = App.Input.state.dragLink;
        if (dragLink) {
            ctx.globalAlpha = 1.0;
            const src = dragLink.source;
            let endX, endY;

            // 2. 吸附逻辑：如果有吸附目标，直接使用目标的物理坐标
            if (dragLink.targetNode) {
                endX = dragLink.targetNode.x;
                endY = dragLink.targetNode.y;
            } else {
                // 否则使用鼠标的世界坐标
                const mouseWorld = this.screenToWorld(dragLink.currentX, dragLink.currentY);
                endX = mouseWorld.x;
                endY = mouseWorld.y;
            }

            ctx.save();
            // 应用变换以确保在世界坐标系下绘制
            ctx.translate(this.width/2, this.height/2);
            ctx.rotate(this.viewRotation);
            ctx.translate(-this.width/2, -this.height/2);
            ctx.translate(this.viewX, this.viewY);
            ctx.scale(this.viewK, this.viewK);

            // ctx.strokeStyle = "#4facfe";
            const grad = ctx.createLinearGradient(src.x, src.y, endX, endY);
            grad.addColorStop(0, "#4facfe");
            grad.addColorStop(1, "#88888888"); // 尾端半透明
            ctx.strokeStyle = grad;

            ctx.lineWidth = 2.5; // 稍微加粗一点
            ctx.setLineDash([6 / this.viewK, 4 / this.viewK]); // 虚线

            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            // 只有在未吸附时才绘制末端小圆点（吸附时圆点在节点中心，被节点覆盖，没必要画）
            if (!dragLink.targetNode) {
                ctx.beginPath();
                ctx.arc(endX, endY, 4 / this.viewK, 0, 2 * Math.PI);
                ctx.fillStyle = "#4facfe";
                ctx.fill();
            }

            ctx.restore();
        }

        // ==========================================
        // 绘制节点 (Nodes)
        // ==========================================
        // [优化] 预计算三角函数，供循环内使用
        const cos = Math.cos(this.viewRotation);
        const sin = Math.sin(this.viewRotation);
        // 呼吸灯效果 (Sine Wave)
        const pulse = Math.sin(currentTime * 0.002) * 0.5 + 1;
        let visibleCount = 0;

        const sqrtViewK = Math.sqrt(this.viewK);
        const stopRangeScaled = this.HOVER_STOP_RANGE;
        const rangeDiff = this.PROXIMITY_RANGE - stopRangeScaled;

        const nodesLen = nodes.length;
        for (let i = 0; i < nodesLen; i++) {
            const n = nodes[i];
            if (n.isEnv) continue;
            const isVis = visibleNodeSet.has(n.uuid);

            // 焦点永远不透明，其他节点渐变
            if(n === focusNode) n.alpha = 1;
            else {
                if(isVis && n.alpha < 1) n.alpha += fadeStep;
                else if(!isVis && n.alpha > 0) n.alpha -= fadeStep;
                if (n.alpha > 1) n.alpha = 1;
                if (n.alpha < 0) n.alpha = 0;
            }

            if (n.alpha > 0.01) {
                visibleCount++;

                // --- [关键优化] 手动计算屏幕坐标 ---
                // 为什么不让 canvas 处理？因为我们需要 n._screenX 来做鼠标交互检测和文字排版
                // 公式: 先缩放平移 -> 再绕中心点旋转
                const p_unrotated_x = n.x * this.viewK + this.viewX;
                const p_unrotated_y = n.y * this.viewK + this.viewY;
                const p_shifted_x = p_unrotated_x - halfW;
                const p_shifted_y = p_unrotated_y - halfH;

                // 旋转变换公式: x' = x*cos - y*sin
                const screen_x_rotated = p_shifted_x * cos - p_shifted_y * sin;
                const screen_y_rotated = p_shifted_x * sin + p_shifted_y * cos;
                n._screenX = screen_x_rotated + halfW;
                n._screenY = screen_y_rotated + halfH;

                // 状态判断
                const isFocus = (n === focusNode);
                const isPreview = (n === previewNode);
                const isHover = (n === hoverNode);
                const isSlot = slots.includes(n);
                // [修改] 高亮检测：如果是吸附的目标节点
                const isDragTarget = dragLink && dragLink.targetNode && dragLink.targetNode.uuid === n.uuid;

                // --- 鼠标接近放大算法 ---
                let proximityScale = 1.0;
                if (isFocus) {
                    proximityScale = 1.0; // 焦点本身不放大
                } else if (isPreview) {
                    proximityScale = this.MAX_SCALE_MULT; // 键盘选中时最大化
                } else {
                    // 计算鼠标距离
                    const dx = n._screenX - mouseX;
                    const dy = n._screenY - mouseY;
                    const dist = Math.hypot(dx, dy) / sqrtViewK;

                    if (dist < stopRangeScaled) {
                        // 进入核心区，最大放大
                        proximityScale = this.MAX_SCALE_MULT;
                    } else if (dist < this.PROXIMITY_RANGE) {
                        // 在感应区，使用插值平滑放大
                        const effectiveDist = dist - stopRangeScaled;
                        const ratio = 1 - (effectiveDist / rangeDiff);
                        // 乘平方让变化曲线更顺滑
                        proximityScale = 1 + (this.MAX_SCALE_MULT - 1) * (ratio * ratio);
                    }
                }

                // --- 半径与光晕计算 ---
                let baseRadius = isFocus ? 20 : 10;
                let rawRadius = baseRadius * this.viewK;
                // 确保节点不会缩到看不见
                let coreRadius = isFocus
                    ? (rawRadius < this.MIN_FOCUS_NODE_PIXEL_SIZE ? this.MIN_FOCUS_NODE_PIXEL_SIZE : rawRadius)
                    : ((rawRadius < this.MIN_NODE_PIXEL_SIZE ? this.MIN_NODE_PIXEL_SIZE : rawRadius));

                let baseBlur = isFocus ? 35 : 15;
                let minBlur = isFocus ? 10 : 5;
                let glowRadius = baseBlur * this.viewK;
                if (glowRadius < minBlur) glowRadius = minBlur;

                // 应用鼠标放大
                coreRadius *= proximityScale;
                glowRadius *= proximityScale;
                n._renderRadius = coreRadius + (glowRadius * 0.2); // 供外部使用的交互半径

                // --- 绘制圆形与阴影 ---
                ctx.globalAlpha = (isFocus ? 1 : n.alpha);
                ctx.beginPath();
                ctx.arc(n._screenX, n._screenY, coreRadius, 0, 2*Math.PI);
                ctx.fillStyle = n.color || this.DEFAULT_NODE_COLOR;

                // 光晕处理 (ShadowBlur 较耗性能，但效果好)
                if(isFocus && linkMode.active) {
                    ctx.shadowBlur = glowRadius * pulse; // 连线模式下呼吸
                    ctx.shadowColor = linkMode.color || '#fff';
                } else {
                    ctx.shadowBlur = glowRadius;
                    ctx.shadowColor = (isFocus || isPreview) ? ctx.fillStyle : (n.color || this.DEFAULT_NODE_COLOR);
                }

                // 边框绘制
                if (isFocus && linkMode.active) {
                    ctx.strokeStyle = linkMode.color || '#fff'; ctx.lineWidth = 3; ctx.stroke();
                } else if (isDragTarget) {
                    // [修改] 吸附目标的白色边框
                    ctx.strokeStyle = "#fff"; ctx.lineWidth = 5; ctx.stroke();
                } else if(isSlot && !isFocus) {
                    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
                }

                ctx.fill(); // 填充实心圆
                ctx.shadowBlur = 0; // 重置阴影，避免影响文字

                // --- 文字绘制 (性能优化) ---
                // 只有当节点足够大，或者鼠标靠近时才画字，否则只画圆点
                const showText = (this.viewK > 0.4) || (proximityScale > 1.1) || isFocus || isPreview;
                if (showText) {
                    ctx.fillStyle = (isFocus || isPreview || isHover) ? "#fff" : "rgba(200,200,200,0.8)";

                    let baseFontSize = isFocus ? 22 : 11;
                    const scaledFontSize = baseFontSize * sqrtViewK * proximityScale;

                    if(scaledFontSize > 5) { // 字体太小就不渲染了
                        const fontWeight = (isFocus) ? "bold" : "normal";
                        ctx.font = `${fontWeight} ${scaledFontSize}px Arial`;
                        ctx.textAlign = "center";
                        const textY = n._screenY + coreRadius + scaledFontSize + 2;
                        ctx.fillText(n.label, n._screenX, textY);

                        // 绘制快捷键槽位索引 [1], [2]...
                        if (isSlot) {
                            const sIdx = slots.indexOf(n);
                            if (sIdx >= 0) {
                                ctx.fillStyle = "#4facfe";
                                ctx.font = `bold ${scaledFontSize}px monospace`;
                                ctx.fillText(`[${sIdx+1}]`, n._screenX, n._screenY - coreRadius - (scaledFontSize*0.5));
                            }
                        }
                    }
                }
            }
        }

        // 绘制顶部接口槽及连线
        this.renderEnvDock(this.ctx, links);

        // --- 更新 DOM 计数器 ---
        if (this.uiRefs.layerIndicator) this.uiRefs.layerIndicator.innerText = viewLayers;
        if (this.uiRefs.visibleCount) this.uiRefs.visibleCount.innerText = visibleCount;

        // 这确保了即使鼠标不动，当节点飘过鼠标下方时，也能触发 hover
        App.Input.updateHoverState();

        // 保持物理引擎活跃 (实现无限飘动效果)
        if (this.simulation.alpha() < 0.1) this.simulation.alpha(0.1).restart();

        // 请求下一帧
        requestAnimationFrame((t) => this.render(t));
    },

    // 【新增】绘制顶部接口槽
    renderEnvDock(ctx, links) {
        const envNodes = App.Store.state.envNodes;
        if (!envNodes || envNodes.length === 0) return;
        // 获取 Canvas 在浏览器中的位置信息（用于坐标修正）
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const slotRadius = 18;
        const gap = 50;
        const topMargin = 60;

        // --- 修复 1：使用逻辑宽度 (CSS像素) 计算布局 ---
        // this.width 是物理像素，除以 dpr 得到逻辑像素
        const logicalWidth = this.width / dpr;
        const totalWidth = envNodes.length * gap;
        let startX = (logicalWidth / 2) - (totalWidth / 2) + (gap / 2);
        // 切换到屏幕坐标系
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // 重置矩阵
        ctx.scale(dpr, dpr); // 缩放以适配高分屏，后续绘图单位均为 CSS 像素
        envNodes.forEach((n, i) => {
            const x = startX + i * gap;
            const y = topMargin;
            // --- 修复 2：坐标交互修正 ---

            // A. 屏幕交互坐标 (用于鼠标 Hover 检测)
            // 如果 input 系统的 mouseX 是全局 clientX，这里需要是 x + rect.left
            // 如果 input 系统的 mouseX 是相对于 canvas 的 offsetX，这里直接是 x
            // 根据你的 screenToWorld 实现推断，App.Input 里的 mouseX 应该是 clientX (全局)，
            // 但 render 主循环里的 _screenX 通常是局部坐标。
            // 建议：此处保持 x 为局部坐标供绘制，但 screenToWorld 传入全局坐标。
            n._screenX = x + rect.left; // 修正为全局坐标以匹配 mouseX (如果 mouseX 是 clientX)
            n._screenY = y + rect.top;
            n._renderRadius = slotRadius;
            // B. 世界物理坐标 (用于连线物理计算)
            // screenToWorld 内部会执行 (sx - rect.left)，所以我们需要传入 (x + rect.left) 来抵消
            const worldPos = this.screenToWorld(x + rect.left, y + rect.top);
            n.fx = worldPos.x;
            n.fy = worldPos.y;
            n.x = worldPos.x;
            n.y = worldPos.y;
            n.vx = 0;
            n.vy = 0;
            // --- 1. 状态判定 (不变) ---
            const isSubject = this.subjectNodes.has(n.uuid);
            const isRelated = !!links.find(l =>
                l.source.uuid === n.uuid && this.subjectNodes.has(l.target.uuid) ||
                l.target.uuid === n.uuid && this.subjectNodes.has(l.source.uuid));
            // --- 3. 绘制节点 (不变) ---
            ctx.globalAlpha = (isSubject || isRelated) ? 1.0 : 0.3;
            if (isSubject) {
                ctx.shadowBlur = 20;
                ctx.shadowColor = n.color || "#4facfe";
            } else {
                ctx.shadowBlur = 0;
            }
            ctx.beginPath();
            ctx.arc(x, y, slotRadius, 0, 2 * Math.PI);
            ctx.fillStyle = "#1a1a1d";
            ctx.fill();
            // 边框
            ctx.lineWidth = isSubject ? 2 : 1.5;
            ctx.strokeStyle = isSubject ? "#fff" : (n.color || "#4facfe");
            ctx.stroke();
            // 内部点
            ctx.beginPath();
            // 注意：slotRadius - 5 可能太小，导致看不见，如果 dpr 很高
            ctx.arc(x, y, slotRadius - 5, 0, 2 * Math.PI);
            ctx.fillStyle = n.color || "#4facfe";
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = isSubject ? "#fff" : "#aaa";
            ctx.font = isSubject ? "bold 11px Arial" : "11px Arial";
            ctx.textAlign = "center";
            ctx.fillText(n.label.substring(0, 8), x, y + 14);
        });
        ctx.restore();
    },

    // 【新增】供 Input 模块调用，平移相机
    panCamera(dx, dy) {
        // 1. 计算逆向旋转
        // 因为 viewX/viewY 是在 Canvas 旋转之后应用的，所以坐标轴已经旋转了。
        // 我们需要将屏幕上的鼠标位移向量 (dx, dy) 逆向旋转，使其与当前的相机坐标轴对齐。
        const cos = Math.cos(-this.viewRotation);
        const sin = Math.sin(-this.viewRotation);
        // 旋转向量公式
        const rDx = dx * cos - dy * sin;
        const rDy = dx * sin + dy * cos;
        // 2. 应用旋转后的增量
        this.viewX += rDx;
        this.viewY += rDy;
        // 3.【关键】反向更新相机目标点 (LookAt)
        // 因为 View = -LookAt * K + ScreenCenter
        // 所以 LookAt = (ScreenCenter - View) / K
        const halfW = this.width / 2;
        const halfH = this.height / 2;
        this.cameraLookAtX = (halfW - this.viewX) / this.viewK;
        this.cameraLookAtY = (halfH - this.viewY) / this.viewK;
    },

    // ==========================================
    // 坐标转换: 屏幕(鼠标) -> 世界(物理)
    // ==========================================
    screenToWorld(sx, sy) {
        const rect = this.canvas.getBoundingClientRect();
        const halfW = this.width / 2;
        const halfH = this.height / 2;

        // 1. 归一化到以 Canvas 中心为原点
        let x = (sx - rect.left) - halfW;
        let y = (sy - rect.top) - halfH;

        // 2. 逆向旋转 (World = Screen * ReverseRotation)
        const cos = Math.cos(-this.viewRotation);
        const sin = Math.sin(-this.viewRotation);
        let rx = x * cos - y * sin;
        let ry = x * sin + y * cos;

        // 3. 逆向平移和缩放
        return {
            x: (rx + halfW - this.viewX) / this.viewK,
            y: (ry + halfH - this.viewY) / this.viewK
        };
    },

    // 设置目标旋转角度 (供外部调用)
    setTargetRotation(rad) {
        let diff = rad - this.targetRotation;
        // 确保走最短旋转路径
        while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
        this.targetRotation += diff;
    }
};

// ==========================================
// 5. Input
// ==========================================
App.Input = {
    state: {
        hoverNode: null,
        hoverLink: null,
        previewNode: null,
        linkMode: { active: false },
        dragNode: null,
        click: { startTime: 0, startX: 0, startY: 0 },
        keyState: {},
        keyControlsVisible: true,
        mouseX: 0,
        mouseY: 0,
        dragLink: null, // { source: null, currentX: 0, currentY: 0, targetNode: null, locked: false }
    },

    init() {
        const C = App.Renderer.canvas;
        C.addEventListener('mousedown', this.onMouseDown.bind(this));
        window.addEventListener('mouseup', this.onMouseUp.bind(this));
        C.addEventListener('mousemove', this.onMouseMove.bind(this));
        C.addEventListener('dblclick', this.onMouseDoubleClick.bind(this));
        C.addEventListener('wheel', this.onWheel.bind(this), {passive:false});
        C.addEventListener('contextmenu', this.onContextMenu.bind(this));
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', e => {
            this.state.keyState[e.key] = false;
            if(e.key==='Shift') this.state.keyState['Shift'] = false;
        });

        document.getElementById('btn-save').addEventListener('click', () => App.Store.save());
        document.getElementById('btn-export').addEventListener('click', () => App.Store.exportData());
        document.getElementById('btn-reset').addEventListener('click', () => App.Store.resetSystem());
        document.getElementById('btn-import').addEventListener('click', () => document.getElementById('importFile').click());
        document.getElementById('importFile').addEventListener('change', (e) => App.Store.importData(e.target));
        document.getElementById('btn-lang').addEventListener('click', () => App.UI.I18n.toggle());
        document.getElementById('btn-preset').addEventListener('click', () => App.UI.PresetEditor.open());
        document.getElementById('preset-editor-close-btn').addEventListener('click', () => App.UI.PresetEditor.close());
        document.getElementById('pe-btn-add').addEventListener('click', () => App.UI.PresetEditor.add());
        document.getElementById('pe-btn-save').addEventListener('click', () => App.UI.PresetEditor.saveAndClose());
    },

    handleSlotClick(idx, isShift) {
        if (isShift) this.handleSlotStore(idx);
        else this.handleSlot(idx);
    },

    handleSlot(idx) {
        const { slots, focusNode } = App.Store.state;
        const slotNode = slots[idx];
        if (slotNode === focusNode) return;

        if (slotNode) {
            slots[idx] = focusNode;
            App.UI.updateSlotUI();
            this.navigate(slotNode, true);
        } else {
            // Store logic
            slots[idx] = focusNode;
            App.UI.updateSlotUI();
            App.Store.save();
        }
    },

    handleSlotStore(idx) {
        const { slots, focusNode, nodes, links } = App.Store.state;
        if (slots[idx] === focusNode) return;
        App.Store.executeSafeAction(() => ({
            nodes,
            links,
            nextFocus: focusNode,
            nextSlots: slots.map((s,i)=>i===idx?focusNode:s)
        }));
    },

    clearSlot(idx) {
        const { slots, focusNode, nodes, links } = App.Store.state;
        if(!slots[idx]) return;
        App.Store.executeSafeAction(() => ({
            nodes,
            links,
            nextFocus: focusNode,
            nextSlots: slots.map((s,i)=>i===idx?null:s)
        }));
    },

    // --- Safe Navigation Wrapper ---

    onFocusMove(src, tgt) {
        if (App.UI.RelationPicker.active) {
            App.UI.RelationPicker.close();
        }
    },

    // Replaces simple navigateTo to ensure orphan checking
    safeNavigate(node, recordHistory = true) {
        if (!node) return;
        if (this.state.linkMode.active && this.state.linkMode.type === 'DELETE') {
            const { focusNode, nodes, links } = App.Store.state;
            const linkIndex = links.findIndex(l =>
                (l.source.uuid===focusNode.uuid && l.target.uuid===node.uuid) ||
                (l.source.uuid===node.uuid && l.target.uuid===focusNode.uuid)
            );
            if (linkIndex !== -1) {
                App.Store.executeSafeAction(() => ({
                    nodes: nodes,
                    links: links.filter(l => l !== links[linkIndex]),
                    nextFocus: node,
                    nextSlots: App.Store.state.slots
                }), () => {
                    if (recordHistory) App.Store.pushHistory(focusNode);
                    this.exitLinkMode();
                });
                return;
            } else {
                this.exitLinkMode();
            }
        }
        if (this.state.linkMode.active) {
            this.navigate(node, recordHistory);
            return;
        }
        // Wrap in Safe Action
        const { focusNode } = App.Store.state;
        App.Store.executeSafeAction(() => ({
            nodes: App.Store.state.nodes,
            links: App.Store.state.links,
            nextFocus: node,
            nextSlots: App.Store.state.slots
        }), () => {
            if (recordHistory) {
                App.Store.pushHistory(focusNode);
            }
            this.state.previewNode = null;
            this.hideTooltip();
        });
        // Note: executeSafeAction will call navigateTo if safe via its applyState
    },

    // Internal Navigate (State Update)
    // Called by executeSafeAction or Link Mode
    navigate(node, recordHistory = true) {
        if(!node) return;
        this.onFocusMove(App.Store.state.focusNode, node);
        const { linkMode } = this.state;
        if (linkMode.active && linkMode.source && linkMode.source.uuid !== node.uuid) {
            this.executeLinkAction(linkMode.source, node);
            this.exitLinkMode();
        }
        const { focusNode } = App.Store.state;
        if(recordHistory) {
            App.Store.pushHistory(focusNode);
        }
        App.Store.state.focusNode = node;
        node.alpha = 1;
        this.state.previewNode = null; this.hideTooltip();
        App.UI.updateSidebar(); App.Store.save(); App.Renderer.restartSim();
    },

    async enterLinkMode() {
        if(this.state.linkMode.active) return;
        try {
            const res = await App.UI.RelationPicker.show(true);
            if(!App.UI.RelationPicker.active && !res) return;
            const mode = { active: true, source: App.Store.state.focusNode, type: res.val, color: '#fff' };
            if (res.val === 'CUSTOM') {
                const cLabel = await App.UI.Dialog.prompt(t('linkMode.prompt'), t('linkMode.promptPlaceholder'));
                if(!cLabel) { this.exitLinkMode(); return; }
                const preset = App.Store.state.presets.find(p=>p.label===cLabel);
                mode.type = preset ? preset.val : cLabel;
            } else if (res.val === 'DELETE') { mode.color = '#ff4d4d'; }
            else { const p = App.Store.state.presets.find(x => x.val === res.val); if(p) mode.color = p.color; }
            this.state.linkMode = mode;
            this.updateLinkModeIndicator();
        } catch(e) { this.exitLinkMode(); }
    },

    exitLinkMode() {
        this.state.linkMode = { active: false, source: null, type: null, color: null };
        this.updateLinkModeIndicator();
    },

    updateLinkModeIndicator() {
        const el = document.getElementById('link-mode-indicator');
        if (this.state.linkMode.active) {
            el.innerHTML = t('linkMode.typeIndicator', {color: this.state.linkMode.color, type: this.state.linkMode.type});
            el.classList.add('active');
        } else {
            el.innerHTML = t('hud.linkMode');
            el.classList.remove('active');
        }
    },

    executeLinkAction(source, target, specificType = null) {
        const { links } = App.Store.state;
        const existing = links.find(l => (l.source.uuid===source.uuid && l.target.uuid===target.uuid) || (l.source.uuid===target.uuid && l.target.uuid===source.uuid));
        const type = specificType || this.state.linkMode.type;

        if (type === 'DELETE') {
            if(existing) {
                App.Store.executeSafeAction(() => ({
                    nodes: App.Store.state.nodes,
                    links: links.filter(l=>l!==existing),
                    nextFocus: target,
                    nextSlots: App.Store.state.slots
                }));
                App.UI.showFlash(t('flash.linkCut')); // 添加提示
            } else App.UI.showFlash(t('alert.noLinkToBreak'), 'info');
        } else {
            if(existing) { existing.type = type; existing.source = source; existing.target = target; }
            else links.push({source, target, type, alpha: 0});
            App.Renderer.restartSim();
        }
    },

    createDefaultLinkedNode(node) {
        const { focusNode, presets } = App.Store.state;
        if (!focusNode) return;
        // 1. 获取第一个预设关系 (对应 "回车选择第一个")
        // 如果没有预设，兜底使用 "comp"
        const defaultPreset = presets.length > 0
            ? presets[0]
            : App.Store.DEFAULT_PRESETS[0];
        // 2. 手动激活连线模式状态 (对应 "按L")
        // 我们不需要真的打开UI，只需要设置状态，因为 createNode 会读取这个状态
        if (!this.state.linkMode.active) {
            this.state.linkMode = {
                active: true,
                source: focusNode,
                type: defaultPreset.val,
                color: defaultPreset.color
            };
        }
        // 3. 调用原有的创建逻辑 (对应 "按N")
        // createNode 内部检测到 linkMode.active 为 true 时，
        // 会自动建立连接、退出连线模式并跳转焦点
        this.createNode(node);
    },

    createNode(node) {
        const { focusNode, nodes, links, slots } = App.Store.state;

        // 固定长度随机一个角度进行偏移
        const distance = App.Renderer.LINK_DISTANCE;
        const angle = Math.random() * 2 * Math.PI;
        const [ offsetX, offsetY ] = [ distance * Math.cos(angle), distance * Math.sin(angle) ];

        const newNode = {
            uuid: uuid.v4(), label: t('fallback.newNode'),
            x: focusNode.x + 150, y: focusNode.y + 50,
            summary: "", content: "", color: App.Utils.getRandomColor(), alpha: 0,
            ...node,
        };

        // If LinkMode, we skip safe check because we create a link immediately
        if (this.state.linkMode.active && this.state.linkMode.type !== 'DELETE') {
            nodes.push(newNode);
            App.Renderer.restartSim();
            this.executeLinkAction(this.state.linkMode.source, newNode);
            this.exitLinkMode();
            this.navigate(newNode, true);
            // setTimeout(() => { App.UI.els.label.focus(); App.UI.els.label.select(); }, 50);
        } else {
            // Safe Create
            const { focusNode } = App.Store.state;
            App.Store.executeSafeAction(() => ({
                nodes: [...nodes, newNode],
                links,
                nextFocus: newNode,
                nextSlots: slots
            }),  () => {
                App.Store.pushHistory(focusNode);
                // setTimeout(() => { App.UI.els.label.focus(); App.UI.els.label.select(); }, 50);
            });
        }
    },

    deleteNode(target = null) {
        const node = target || App.Store.state.focusNode;
        if(node.isRoot) { App.UI.showFlash(t('alert.rootCannotDelete'), 'warn'); return; }

        const { focusNode, navHistory, nodes, links, slots } = App.Store.state;

        let nextFocus = null;
        if (focusNode && node !== focusNode) {
            nextFocus = focusNode;
        } else {
            // --- 预判下一跳 ---
            const backIdx = App.Store.getBackNodeIndex();

            if (backIdx >= 0) {
                // 用历史记录的 UUID 去找“活体”节点，防止使用过期的历史快照
                const uuid = navHistory[backIdx].uuid;
                nextFocus = nodes.find(n => n.uuid === uuid);
            }

            // 兜底逻辑
            if (!nextFocus) {
                nextFocus = nodes.find(n => n.isRoot) || nodes.find(n => n.uuid !== node.uuid);
            }
        }

        App.Store.executeSafeAction(
            () => ({
                nodes: nodes.filter(n => n.uuid !== node.uuid),
                links: links.filter(l => l.source.uuid !== node.uuid && l.target.uuid !== node.uuid),
                nextFocus: nextFocus,
                nextSlots: slots.map(s => (s && s.uuid === node.uuid) ? null : s)
            }),
            () => {
                App.Store.state.navHistory = App.Store.state.navHistory.filter(n => n.uuid !== node.uuid);
            }
        );
    },

    deleteLink(link) {
        App.Store.executeSafeAction(() => ({
            nodes: App.Store.state.nodes,
            links: App.Store.state.links.filter(l=>l!==link),
            nextFocus: App.Store.state.focusNode,
            nextSlots: App.Store.state.slots
        }));
    },

    safeNavigateBack() {
        const backIdx = App.Store.getBackNodeIndex();
        const { navHistory, nodes } = App.Store.state;

        if (backIdx >= 0) {
            const targetUUID = navHistory[backIdx].uuid;
            App.Store.state.navHistory.splice(backIdx + 1);
            const targetNode = nodes.find(n => n.uuid === targetUUID);
            if (targetNode) {
                this.safeNavigate(targetNode, false);
            }
        } else {
            App.UI.showFlash(t('flash.noHistory'), 'info');
        }
    },


    // 【新增】核心方法：每帧都会被调用，用于更新悬停状态
    updateHoverState() {
        // 1. 阻断检查：如果正在拖拽节点或者打开了弹窗，不执行悬停检测
        if (this.state.dragNode ||
            App.UI.Dialog.isActive ||
            App.UI.Modal.el.classList.contains('active')) {
            return;
        }
        // 2. 获取当前的鼠标坐标 (由 onMouseMove 更新)
        const { mouseX, mouseY } = this.state;
        // 3. 尝试拾取节点
        const node = this.pickNode(mouseX, mouseY);
        if (node) {
            App.Renderer.canvas.style.cursor = 'pointer';

            // 只有当悬停的节点发生变化时，才重新渲染 Tooltip
            if (this.state.hoverNode !== node) {
                this.state.hoverNode = node;
                this.state.hoverLink = null;
                this.state.previewNode = null; // 鼠标操作优先于键盘预览
                const html = typeof marked !== 'undefined'
                    ? marked.parse(node.summary || '')
                    : node.summary;

                // 显示提示框
                this.showTooltip(t('tooltip.nodeHover', {label: node.label, summary: html}), mouseX, mouseY, 'mouse');
            }
        }
        else {
            // 4. 如果没碰到节点，尝试拾取连线
            const link = this.pickLink(mouseX, mouseY);
            if (link) {
                App.Renderer.canvas.style.cursor = 'pointer';
                if (this.state.hoverLink !== link) {
                    this.state.hoverLink = link;
                    this.state.hoverNode = null;
                    this.state.previewNode = null;
                    if(!this.state.previewNode) this.hideTooltip();
                }
            } else {
                // 5. 什么都没碰到
                // 只有当前有悬停对象才需要清理，避免每帧都在操作 DOM 隐藏 tooltip
                if (this.state.hoverNode || this.state.hoverLink) {
                    this.state.hoverNode = null;
                    this.state.hoverLink = null;
                    App.Renderer.canvas.style.cursor = 'crosshair';
                    if(!this.state.previewNode) this.hideTooltip();
                }
                // 确保光标复位
                if(App.Renderer.canvas.style.cursor !== 'crosshair') {
                     App.Renderer.canvas.style.cursor = 'crosshair';
                }
            }
        }
    },

    // --- Mouse ---
    onMouseDown(e) {
        if(App.UI.Modal.el.classList.contains('active') || App.UI.Dialog.isActive) return;
        if (e.button === 1) {
            const node = this.pickNode(e.clientX, e.clientY);
            // 【新增】中键拖拽 进入连线模式
            if (node) {
                this.state.dragLink = {
                    source: node,
                    targetNode: null,
                    locked: false,
                    currentX: e.clientX,
                    currentY: e.clientY
                };
                this.hideTooltip(); // 隐藏提示框防止遮挡
                return;
            } else {
                e.preventDefault();
                this.state.isPanning = true;
                this.state.lastPanX = e.clientX;
                this.state.lastPanY = e.clientY;
                App.Renderer.canvas.style.cursor = 'move';
                return;
            }
        }
        if(e.button===3) { e.preventDefault(); this.safeNavigateBack(); return; }
        if(e.button===4) { e.preventDefault(); this.enterLinkMode(); return; }
        if(e.button!==0) return;

        const node = this.pickNode(e.clientX, e.clientY);
        // dragNode Logic
        this.state.mouseX = e.clientX; this.state.mouseY = e.clientY;
        this.state.dragNode = node;
        this.state.click = {
            startX: e.clientX, startY: e.clientY,
            startTime: performance.now(),
        };

        if(node) {
            this.state.hoverNode=null; this.state.previewNode=null; this.hideTooltip();
            App.Renderer.canvas.style.cursor = 'grabbing';
        } else {
            App.UI.RelationPicker.close();
            App.UI.PresetEditor.close();
        }
    },

    onMouseMove(e) {
        this.state.mouseX = e.clientX; this.state.mouseY = e.clientY;
        // 【新增】处理平移
        if (this.state.isPanning) {
            const dx = e.clientX - this.state.lastPanX;
            const dy = e.clientY - this.state.lastPanY;

            App.Renderer.panCamera(dx, dy);

            this.state.lastPanX = e.clientX;
            this.state.lastPanY = e.clientY;
            return; // 平移时不处理 hover
        }
        // 【新增】拖拽连线逻辑
        if (this.state.dragLink && !this.state.dragLink.locked) {
            this.state.dragLink.currentX = e.clientX;
            this.state.dragLink.currentY = e.clientY;

            // 实时检测鼠标下是否有目标节点
            const target = this.pickNode(e.clientX, e.clientY);
            // 如果有节点，且不是起点本身，则记录为吸附目标
            if (target && target.uuid !== this.state.dragLink.source.uuid) {
                this.state.dragLink.targetNode = target;
            } else {
                this.state.dragLink.targetNode = null;
            }
            return;
        }
        if(App.UI.Modal.el.classList.contains('active') || App.UI.Dialog.isActive) return;
        if(this.state.dragNode) return;
    },

    onMouseUp(e) {
        // 【新增】拖拽连线逻辑
        if (this.state.dragLink && !this.state.dragLink.locked) {
            const source = this.state.dragLink.source;
            // 优先使用吸附的目标，如果没有吸附，再尝试 pick 一次（双重保险）
            // 因为这里会松开后触发行为
            const target = e.target === App.Renderer.canvas
                ? (this.state.dragLink.targetNode || this.pickNode(e.clientX, e.clientY))
                : null;
            this.state.dragLink.locked = true;

            if (target && target.uuid !== source.uuid) {
                // 弹出菜单 -> 等待选择 -> 执行连线
                App.UI.RelationPicker.show(true).then(res => {
                    if (res.val === 'CUSTOM') {
                        App.UI.Dialog.prompt(t('linkMode.prompt'), t('linkMode.promptPlaceholder'))
                        .then(cLabel => { if(cLabel) this.executeLinkAction(source, target, cLabel); });
                    } else {
                        this.executeLinkAction(source, target, res.val);
                    }
                })
                .catch(e => console.log(e))
                .finally(() => {
                    this.state.dragLink = null;
                });
            } else {
                // [补充] 如果没有命中目标，或者在 UI 上松开，立即清除拖拽状态
                this.state.dragLink = null;
            }
            return;
        }
        // 【新增】结束平移
        if (e.button === 1) {
            this.state.isPanning = false;
            App.Renderer.canvas.style.cursor = 'crosshair';
            return;
        }
        if(e.button!==0 || !this.state.dragNode) return;
        const node = this.state.dragNode;
        if(node) {
            App.Renderer.pointerForce.node(null).target(null);
            App.Store.save();
            App.Renderer.canvas.style.cursor = 'crosshair';
        }
        this.state.dragNode = null;

        // Click Threshold Logic
        if (e.target === App.Renderer.canvas) {
            const {startTime, startX, startY} = this.state.click;
            move = Math.hypot(e.clientX - startX, e.clientY - startY);
            if(performance.now() - startTime < 200 && move < 8) {
                const target = node || this.pickNode(e.clientX, e.clientY);
                if(target) {
                    if(target !== App.Store.state.focusNode) this.safeNavigate(target);
                    else App.UI.Modal.show();
                }
            }
        }
    },

    onMouseDoubleClick(e) {
        if(App.UI.Modal.el.classList.contains('active') || App.UI.Dialog.isActive) return;
        if(e.button===3) { e.preventDefault(); this.safeNavigateBack(); return; }
        if(e.button===4) { e.preventDefault(); this.enterLinkMode(); return; }
        if(e.button!==0) return;

        const node = this.pickNode(e.clientX, e.clientY);

        if(node) {
        } else {
            this.createDefaultLinkedNode(App.Renderer.screenToWorld(e.clientX, e.clientY));
        }
    },

    onContextMenu(e) {
        e.preventDefault();
        const node = App.Input.state.hoverNode;
        if(node) {
            // 逻辑 A: 如果是顶部接口节点 (isEnv 为 true)
            // 无论是否按 Shift，右键都应该把它“拉下来” (Undock)
            // 或者你也可以保留 Shift 限制，看你习惯。这里建议直接右键就还原，操作更流畅。
            if (node.isEnv) {
                App.Store.toggleEnvNode(node);
                return;
            }
            // 逻辑 B: 如果是普通节点
            // Shift + 右键 = 升舱 (Dock)
            if (e.shiftKey) {
                App.Store.toggleEnvNode(node);
                return;
            }
            // 逻辑 C: 普通右键 = 删除节点
            this.deleteNode(node); return;
        }
        const link = App.Input.state.hoverLink;
        if(link) { this.deleteLink(link); return; }
    },

    onWheel(e) {
        e.preventDefault();
        const scaleFactor = 1.05;
        const delta = e.deltaY < 0 ? scaleFactor : (1 / scaleFactor);
        const newK = Math.min(10, App.Renderer.viewK * delta);
        if (!App.Store.state.focusNode.isEnv) {
            App.Renderer.viewK = newK;
            return;
        }
        // 2. 核心修正：计算缩放对 viewX/viewY 的补偿
        // 也就是：Zoom Toward Mouse (鼠标指向的世界点不变) 或者 Zoom Toward Center (屏幕中心的世界点不变)

        // 获取参考点（这里使用屏幕中心，这在聚焦模式下最自然）
        // 如果你更喜欢“鼠标指哪里缩放哪里”，可以用 e.clientX / e.clientY
        // const rect = App.Renderer.canvas.getBoundingClientRect();
        const centerX = e.clientX;
        const centerY = e.clientY;
        // 计算参考点当前对应的世界物理偏移 (WorldOffset)
        // 公式推导：Screen = (World + View) * K  =>  World = Screen/K - View
        // 但这里我们只需要计算相对偏移量，简化为：
        // 旧的世界中心偏移 = (CenterX - ViewX_Old) / K_Old
        const worldOffsetX = (centerX - App.Renderer.viewX) / App.Renderer.viewK;
        const worldOffsetY = (centerY - App.Renderer.viewY) / App.Renderer.viewK;
        // 3. 应用新的缩放比例
        App.Renderer.viewK = newK;
        // 4. 反向计算新的 ViewX/ViewY，使得世界中心偏移保持不变
        // ViewX_New = CenterX - (WorldOffset * K_New)
        App.Renderer.viewX = centerX - (worldOffsetX * newK);
        App.Renderer.viewY = centerY - (worldOffsetY * newK);

        // // 【特殊修正】如果是 EnvNode 聚焦或锁定状态
        // // 这一步确保相机目标点（cameraLookAt）同步更新，防止下一帧 render 里的缓动逻辑把画面又拉回去
        // const { focusNode } = App.Store.state;
        // if (focusNode) {
        //     // 反算出当前的 LookAt 位置
        //     // View = -LookAt * K + ScreenCenter
        //     // LookAt = (ScreenCenter - View) / K
        //     App.Renderer.cameraLookAtX = (App.Renderer.width / 2 - App.Renderer.viewX) / App.Renderer.viewK;
        //     App.Renderer.cameraLookAtY = (App.Renderer.height / 2 - App.Renderer.viewY) / App.Renderer.viewK;
        // }
    },

    // --- Keyboard ---
    onKeyDown(e) {
        if(App.UI.Dialog.isActive) return;
        if(App.UI.Modal.el.classList.contains('active')) return;
        if(App.UI.PresetEditor.active) { if(e.key==='Escape' || e.key==='`') App.UI.PresetEditor.close(); return; }
        if(App.UI.RelationPicker.active) { App.UI.RelationPicker.handleInput(e); return; }

        if(['INPUT','TEXTAREA'].includes(e.target.tagName)) {
            if(e.key==='Escape') e.target.blur();
            if(e.key==='Enter' && e.target.id==='node-label') { e.preventDefault(); e.target.blur(); }
            return;
        }

        this.state.keyState[e.key] = true; if(e.shiftKey) this.state.keyState['Shift']=true;

        const isSlot = (e.key>='1' && e.key<='4');
        if(['!','@','#','$'].includes(e.key)) { this.handleSlotStore({'!':0,'@':1,'#':2,'$':3}[e.key]); return; }
        if(!e.shiftKey && isSlot) { this.handleSlot(parseInt(e.key)-1); return; }

        switch(e.key) {
            case '/': this.jumpDirection(-Math.PI/2, true); break;
            case '?': this.jumpDirection(Math.PI/2, true); break;
            case 'w': case 'W': case 'ArrowUp': this.jumpDirection(-Math.PI/2, e.shiftKey); break;
            case 's': case 'S': case 'ArrowDown': this.jumpDirection(Math.PI/2, e.shiftKey); break;
            case 'a': case 'A': case 'ArrowLeft': this.jumpDirection(Math.PI, e.shiftKey); break;
            case 'd': case 'D': case 'ArrowRight': this.jumpDirection(0, e.shiftKey); break;
            case 'q': case ',': this.cyclePreview(-1); break;
            case 'e': case '.': this.cyclePreview(1); break;
            case '=': case '+':
                App.Store.state.viewLayers = Math.max(1, App.Store.state.viewLayers-1);
                App.Renderer.restartSim();
                App.Store.saveDebounced();
                break;
            case '-': case '_':
                App.Store.state.viewLayers = App.Store.state.viewLayers+1;
                App.Renderer.restartSim();
                App.Store.saveDebounced();
                break;
            case 'Tab': e.preventDefault(); this.createDefaultLinkedNode(); break;
            case 'n': case 'N': e.preventDefault(); this.createNode(); break;
            case 'F2': e.preventDefault(); App.UI.els.label.focus(); App.UI.els.label.select(); break;
            case ' ': e.preventDefault(); App.UI.els.label.focus(); App.UI.els.label.select(); break;
            case 'Enter': if(App.Store.state.focusNode) App.UI.Modal.show(); break;
            case 'l': case 'L': this.enterLinkMode(); break;
            case 'h': case 'H': const root = App.Store.state.nodes.find(n=>n.isRoot); if(root) this.safeNavigate(root); break;
            case 'Escape': if(this.state.linkMode.active) this.exitLinkMode(); break;
            case 'b': case 'B': this.safeNavigateBack(); break;
            case 'Delete': case 'x': case 'X': this.deleteNode(); break;
            case 'i': case 'I': e.preventDefault(); this.state.keyControlsVisible=!this.state.keyControlsVisible; document.getElementById('key-controls').style.display=this.state.keyControlsVisible?'block':'none'; break;
            case '`': e.preventDefault(); App.UI.PresetEditor.open(); break;
            case 't': case 'T': if (App.Store.state.focusNode) App.Store.toggleEnvNode(App.Store.state.focusNode); break;
        }
    },

    // --- Helpers ---
    getNeighbors() {
        const { links, focusNode } = App.Store.state;
        const list = [];
        links.forEach(l => {
            let other = null;
            if(l.source.uuid===focusNode.uuid) other = l.target;
            else if(l.target.uuid===focusNode.uuid) other = l.source;
            if(other) {
                const dx = other.x - focusNode.x, dy = other.y - focusNode.y;
                const rawAng = Math.atan2(dy, dx);
                let vAng = rawAng + App.Renderer.viewRotation;
                while(vAng > Math.PI) vAng -= 2*Math.PI; while(vAng <= -Math.PI) vAng += 2*Math.PI;
                list.push({ node: other, vAngle: vAng, rawAngle: rawAng });
            }
        });
        return list.sort((a,b) => a.vAngle - b.vAngle);
    },

    cyclePreview(dir) {
        const neighbors = this.getNeighbors();
        if(!neighbors.length) return;
        this.hideTooltip();
        const UP = -Math.PI/2, THRESHOLD = 0.087;
        const exact = neighbors.find(n => Math.abs(n.vAngle - UP) < THRESHOLD);
        const curIsExact = exact && this.state.previewNode && this.state.previewNode.uuid === exact.node.uuid;
        if (exact && !curIsExact) { this.setPreview(exact); return; }
        let target = null;
        if (dir > 0) {
            target = neighbors.find(n => n.vAngle > UP && (!exact || n.node.uuid !== exact.node.uuid));
            if (!target) target = neighbors.find(n => (!exact || n.node.uuid !== exact.node.uuid));
        } else {
            for(let i=neighbors.length-1; i>=0; i--) if(neighbors[i].vAngle < UP && (!exact || neighbors[i].node.uuid !== exact.node.uuid)) { target=neighbors[i]; break; }
            if(!target) for(let i=neighbors.length-1; i>=0; i--) if(!exact || neighbors[i].node.uuid !== exact.node.uuid) { target=neighbors[i]; break; }
        }
        if(target) this.setPreview(target);
    },

    setPreview(wrapper) {
        this.state.previewNode = wrapper.node;
        App.Renderer.setTargetRotation(-Math.PI/2 - wrapper.rawAngle);
        const html = (typeof marked!=='undefined' ? marked.parse(wrapper.node.summary||'') : wrapper.node.summary) || '';
        this.showTooltip(t('tooltip.preview', {label: wrapper.node.label, summary: html}), 0, 0, 'fixed');
    },

    jumpDirection(targetAng, shiftKey) {
        const neighbors = this.getNeighbors();
        let best = null, minDiff = 1.2; // Threshold ~68 deg
        let rawAngle = 0, vAngle = 0;
        neighbors.forEach(n => {
            let diff = Math.abs(n.vAngle - targetAng);
            if (diff > Math.PI) diff = 2*Math.PI - diff;
            if (diff < minDiff) {
                minDiff = diff;
                best = n.node;
                rawAngle = n.rawAngle;
                vAngle = n.vAngle;
            }
        });
        if(best) {
            if (shiftKey) {
                App.Renderer.setTargetRotation(targetAng - rawAngle);
            }
            this.safeNavigate(best);
        }
    },

    pickNode(sx, sy) {
        const nodes = App.Store.state.nodes;
        // 获取鼠标相对于 Canvas 元素的坐标 (CSS 像素)
        const rect = App.Renderer.canvas.getBoundingClientRect();
        const mouseCanvasX = sx - rect.left;
        const mouseCanvasY = sy - rect.top;
        // 倒序遍历：从最上层的节点开始判断
        for(let i = nodes.length - 1; i >= 0; i--) {
            const n = nodes[i];
            // 1. 过滤不可见节点 (alpha <= 0.01 也可以，根据需要调整)
            if(n.alpha <= 0.01 && !n.isEnv) continue;
            // 2. 安全检查：确保节点已经经过至少一次渲染，拥有 _screenX 和 _renderRadius
            if (n._screenX === undefined || n._renderRadius === undefined) continue;
            // 3. 计算鼠标点击位置与节点【屏幕位置】的距离
            const dx = mouseCanvasX - n._screenX;
            const dy = mouseCanvasY - n._screenY;
            const distSq = dx * dx + dy * dy; // 使用平方距离，避免 Math.sqrt，性能更好
            // 4. 获取判定半径 (已经在 render 中考虑了缩放和交互因素，是节点当前的视觉半径)
            const hitRadius = n._renderRadius;
            // 5. 判定：如果鼠标距离节点中心小于或等于其视觉半径
            if (distSq <= hitRadius * hitRadius) {
                return n; // 返回被点击的节点
            }
        }
        return null; // 没有节点被点击
    },

    pickLink(sx, sy) {
        const w = App.Renderer.screenToWorld(sx, sy);
        const links = App.Store.state.links;
        for(let l of links) {
            if(l.alpha < 0.3) continue;
            const x1 = l.source.x, y1 = l.source.y, x2 = l.target.x, y2 = l.target.y;
            const A = x2-x1, B = y2-y1;
            const lenSq = A*A+B*B;
            let t = ((w.x-x1)*A + (w.y-y1)*B) / lenSq;
            t = Math.max(0, Math.min(1, t));
            const dist = Math.hypot(w.x - (x1+t*A), w.y - (y1+t*B));
            if(dist < 10/App.Renderer.viewK) return l;
        }
        return null;
    },

    showTooltip(html, x, y, mode) {
        const t = document.getElementById('tooltip');
        t.innerHTML = html; t.style.opacity = 1;
        if(mode==='mouse') { t.className=''; t.style.left=(x+15)+'px'; t.style.top=(y+15)+'px'; t.style.transform='none'; }
        else t.className='fixed-mode';
    },
    hideTooltip() {
        const t = document.getElementById('tooltip');
        t.style.opacity=0; t.className=''; t.style.left=''; t.style.top=''; t.style.transform='';
    }
};

window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.command) {
        case 'setLanguage':
            if(typeof setLanguage !== 'undefined') setLanguage(msg.lang);
            if(App.UI.I18n) App.UI.I18n.apply();
            break;
        case 'loadData':
            console.log("Stars: Data received.");
            if(!App.Renderer.simulation) { App.Renderer.init(); App.UI.init(); App.Input.init(); }
            App.Store.loadState(msg.data, false);
            break;
    }
});

window.onload = () => {
    App.Renderer.init(); App.UI.init(); App.Input.init();
    vscode.postMessage({ command: 'ready' });
    console.log("Stars: Webview Ready.");
};
