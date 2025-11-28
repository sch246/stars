/**
 * Stars v5.2
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
            else if (this.allowDelete && ['d','D','Delete'].includes(e.key)) { e.preventDefault(); this.pick('DELETE'); }
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
        focusNode: null,
        viewLayers: 1,
        navHistory: [],
        presets: []
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
            App.Renderer.viewX = -this.state.focusNode.x * App.Renderer.viewK + App.Renderer.width/2;
            App.Renderer.viewY = -this.state.focusNode.y * App.Renderer.viewK + App.Renderer.height/2;
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
        const { nodes, focusNode, slots } = this.state;

        // 1. 获取当前锚点集合 (Origin + Focus + Slots)
        const getAnchors = (nl, fn, sl) => {
            const r = nl.find(n=>n.isRoot);
            return new Set([r, fn, ...sl].filter(x=>x).map(x=>x.uuid));
        };
        const curAnchors = getAnchors(nodes, focusNode, slots);

        // 1. Simulate Next State
        const next = simulator();
        const nextAnchors = getAnchors(next.nodes, next.nextFocus, next.nextSlots);

        // 2. Check Structural Integrity
        const structIntact = next.nodes.length >= nodes.length && next.links.length >= this.state.links.length;
        const anchorsSame = curAnchors.size === nextAnchors.size && [...curAnchors].every(id => nextAnchors.has(id));

        const applyState = () => {
            this.state.nodes = next.nodes;
            this.state.links = next.links;
            this.state.focusNode = next.nextFocus;
            this.state.slots = next.nextSlots;
            if (typeof onApplied === 'function') {
                onApplied();
            }
            App.UI.updateSidebar();
            App.UI.updateSlotUI();
            this.save();
            App.Renderer.restartSim();
        };

        if (structIntact && anchorsSame) {
            applyState();
            return true;
        }

        // 3. Reachability Check (Unsafe Path)
        const anchorObjs = next.nodes.filter(n => nextAnchors.has(n.uuid));
        const reachable = App.Utils.findReachable(next.nodes, next.links, anchorObjs);
        const lost = next.nodes.filter(n => !reachable.has(n.uuid));

        if (lost.length > 0) {
            const label = lost[0].label;
            const msg = t('alert.deleteConfirm', { n: lost.length, label: label });

            if (await App.UI.Dialog.confirm(msg)) {
                // Apply simulation result first
                applyState();

                // Then cleanup lost nodes
                const deadSet = new Set(lost.map(n => n.uuid));
                this.state.nodes = this.state.nodes.filter(n => !deadSet.has(n.uuid));
                this.state.links = this.state.links.filter(l => !deadSet.has(l.source.uuid) && !deadSet.has(l.target.uuid));
                this.state.slots = this.state.slots.map(s => (s && deadSet.has(s.uuid)) ? null : s);
                this.state.navHistory = this.state.navHistory.filter(n => !deadSet.has(n.uuid));
                lost.forEach(n => App.Runtime.clearStorage(n.uuid));

                // Re-save and Re-sim after cleanup
                this.save();
                App.Renderer.restartSim();
                return true;
            }
            return false;
        } else {
            // Safe Path (structure changed but no loss)
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
    }
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
// 4. Renderer
// ==========================================
App.Renderer = {
    canvas: document.getElementById('canvas'),
    ctx: document.getElementById('canvas').getContext('2d'),
    width: 0, height: 0,
    viewX: 0, viewY: 0, viewK: 1, viewRotation: 0, targetRotation: 0,
    simulation: null,
    pointerForce: null,
    lastRenderTime: 0,

    // Constants
    FADE_DURATION: 400,
    DEFAULT_NODE_COLOR: "#4facfe",

    LINK_DISTANCE: 220,

    init() {
        this.resize();
        this.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.uuid).distance(this.LINK_DISTANCE).strength(0.1))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("collide", d3.forceCollide(10))
            .force("x", d3.forceX(0).strength(0.01))
            .force("y", d3.forceY(0).strength(0.01))
            .alphaDecay(0.05).alphaMin(0.05);

        this.pointerForce = (() => {
            let node, target, strength=0.02;
            function f(alpha) {
                if (!node || !target) return;
                const dx = target.x - node.x, dy = target.y - node.y;
                const k = strength * (1 - Math.exp(-Math.hypot(dx, dy) / 120));
                node.vx += dx * k; node.vy += dy * k;
            }
            f.initialize=()=>{}; f.node=n=>{node=n; return f;}; f.target=(x,y)=>{target={x,y}; return f;};
            return f;
        })();
        this.simulation.force('pointerDrag', this.pointerForce);
        requestAnimationFrame(t => this.render(t));
    },

    resize() {
        const el = this.canvas;
        if (el) {
            this.width = el.clientWidth; this.height = el.clientHeight;
            const dpr = window.devicePixelRatio || 1;
            el.width = this.width * dpr; el.height = this.height * dpr;
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.scale(dpr, dpr);
        }
    },

    adjustZoomByLayer() {
        this.viewK = Math.max(0.3, Math.min(5, 2.0 / (Math.pow(App.Store.state.viewLayers, 0.7))));
    },

    restartSim() {
        const { nodes, links, focusNode } = App.Store.state;
        const root = nodes.find(n => n.isRoot);
        if(root) { root.fx=0; root.fy=0; }
        nodes.forEach(n => { if(!n.isRoot) { n.fx=null; n.fy=null; } });

        const SIM_LAYERS = Math.max(7, App.Store.state.viewLayers);
        const targets = new Set();
        if(focusNode) {
            targets.add(focusNode.uuid);
            let q = [{n:focusNode, d:0}], h=0;
            const adj = {};
            links.forEach(l => {
                const s=l.source.uuid||l.source, t=l.target.uuid||l.target;
                if(!adj[s]) adj[s]=[]; adj[s].push(t);
                if(!adj[t]) adj[t]=[]; adj[t].push(s);
            });
            while(h<q.length) {
                const {n,d} = q[h++];
                if(d>=SIM_LAYERS) continue;
                (adj[n.uuid]||[]).forEach(id => {
                    if(!targets.has(id)) { targets.add(id); const obj=nodes.find(x=>x.uuid===id); if(obj) q.push({n:obj, d:d+1}); }
                });
            }
        }
        const activeNodes = nodes.filter(n => targets.has(n.uuid));
        const activeLinks = links.filter(l => targets.has(l.source.uuid) && targets.has(l.target.uuid));
        this.simulation.nodes(activeNodes);
        this.simulation.force("link").links(activeLinks);
        this.simulation.alpha(1).restart();
    },

    render(t) {
        const { keyState, dragNode, mouseX, mouseY, hoverNode, previewNode, linkMode } = App.Input.state;
        if (keyState['<']) { this.targetRotation += 0.05; if(App.Input.state.previewNode) { App.Input.state.previewNode=null; App.Input.hideTooltip(); } }
        if (keyState['>']) { this.targetRotation -= 0.05; if(App.Input.state.previewNode) { App.Input.state.previewNode=null; App.Input.hideTooltip(); } }

        if (!this.lastRenderTime) this.lastRenderTime = t;
        const dt = t - this.lastRenderTime; this.lastRenderTime = t;

        if (dragNode) {
            const w = this.screenToWorld(mouseX, mouseY);
            this.pointerForce.node(dragNode).target(w.x, w.y);
        }

        const { nodes, links, focusNode, viewLayers } = App.Store.state;
        const tx = this.width/2, ty = this.height/2;
        if(focusNode) {
            this.viewX += ((-focusNode.x * this.viewK + tx) - this.viewX) * 0.1;
            this.viewY += ((-focusNode.y * this.viewK + ty) - this.viewY) * 0.1;
        }
        let diff = this.targetRotation - this.viewRotation;
        while(diff > Math.PI) diff -= 2*Math.PI; while(diff < -Math.PI) diff += 2*Math.PI;
        this.viewRotation += diff * 0.1;

        this.ctx.save();
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.translate(this.width/2, this.height/2);
        this.ctx.rotate(this.viewRotation);
        this.ctx.translate(-this.width/2, -this.height/2);
        this.ctx.translate(this.viewX, this.viewY);
        this.ctx.scale(this.viewK, this.viewK);

        const visNodes = new Set(); const visLinks = new Set();
        const addVis = (s, d) => {
            if(!s) return;
            visNodes.add(s.uuid);
            let q=[{n:s, d:0}], h=0;
            while(h<q.length){
                const {n,d:depth} = q[h++];
                if(depth>=d) continue;
                links.forEach(l => {
                    const src=l.source, tgt=l.target;
                    if(src.uuid===n.uuid) { if(!visNodes.has(tgt.uuid)) {visNodes.add(tgt.uuid); q.push({n:tgt,d:depth+1});} visLinks.add(l); }
                    else if(tgt.uuid===n.uuid) { if(!visNodes.has(src.uuid)) {visNodes.add(src.uuid); q.push({n:src,d:depth+1});} visLinks.add(l); }
                });
            }
        };
        if(focusNode) addVis(focusNode, viewLayers);
        if(hoverNode && hoverNode!==focusNode) addVis(hoverNode, 1);
        if(previewNode && previewNode!==focusNode) addVis(previewNode, 1);

        links.forEach(l => {
            const isVis = visLinks.has(l);
            if(isVis && l.alpha<1) l.alpha += dt/this.FADE_DURATION;
            else if(!isVis && l.alpha>0) l.alpha -= dt/this.FADE_DURATION;
            l.alpha = Math.max(0, Math.min(1, l.alpha));
            if(l.alpha > 0.01) {
                const src=l.source, tgt=l.target;
                const isFocus = (src===focusNode||tgt===focusNode);
                const isHigh = (hoverNode&&(src===hoverNode||tgt===hoverNode)) || (previewNode&&(src===previewNode||tgt===previewNode));
                const mult = isFocus ? 1.0 : (isHigh ? 0.7 : 0.4);
                this.ctx.globalAlpha = l.alpha * mult;
                this.ctx.lineWidth = (isFocus||isHigh) ? 2.5 : 1.5;
                const color = App.Store.state.presets.find(p=>p.val===l.type)?.color || '#666';
                const g = this.ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y);
                g.addColorStop(0, color); g.addColorStop(0.7, "#444"); g.addColorStop(1, "#222");
                this.ctx.strokeStyle = g;
                this.ctx.beginPath(); this.ctx.moveTo(src.x, src.y); this.ctx.lineTo(tgt.x, tgt.y); this.ctx.stroke();
                if(l.type && isFocus) {
                    const mx=(src.x+tgt.x)/2, my=(src.y+tgt.y)/2;
                    this.ctx.save(); this.ctx.translate(mx,my); this.ctx.rotate(-this.viewRotation);
                    this.ctx.fillStyle = color; this.ctx.font="11px Arial"; this.ctx.textAlign="center";
                    const label = App.Store.state.presets.find(p=>p.val===l.type)?.label || l.type;
                    this.ctx.fillText(label, 0, -8); this.ctx.restore();
                }
            }
        });

        const pulse = (Math.sin(t * 0.002) + 1) * 10 + 10;
        let vCount = 0;
        nodes.forEach(n => {
            const isVis = visNodes.has(n.uuid);
            if(n===focusNode) n.alpha = 1;
            else {
                if(isVis && n.alpha<1) n.alpha += dt/this.FADE_DURATION;
                else if(!isVis && n.alpha>0) n.alpha -= dt/this.FADE_DURATION;
                n.alpha = Math.max(0, Math.min(1, n.alpha));
            }
            if(n.alpha > 0.01) {
                vCount++;
                const isSlot = App.Store.state.slots.includes(n);
                const isFocus = (n===focusNode);
                const isPreview = (n===previewNode||n===hoverNode);
                this.ctx.globalAlpha = isFocus ? 1 : n.alpha;
                let r = isFocus ? 20 : (isSlot ? 14 : 10);
                if(this.viewK < 0.5) r = r / this.viewK * 0.5;
                this.ctx.beginPath(); this.ctx.arc(n.x, n.y, r, 0, 2*Math.PI);
                this.ctx.fillStyle = n.color || this.DEFAULT_NODE_COLOR;
                if(isFocus) {
                    if(linkMode.active) { this.ctx.shadowBlur=pulse; this.ctx.shadowColor=linkMode.color||'#fff'; }
                    else { this.ctx.shadowBlur=35; this.ctx.shadowColor=this.ctx.fillStyle; }
                } else if(isPreview) { this.ctx.shadowBlur=20; this.ctx.shadowColor=this.ctx.fillStyle; } else this.ctx.shadowBlur=0;
                if(isFocus && linkMode.active) { this.ctx.strokeStyle=linkMode.color||'#fff'; this.ctx.lineWidth=3; this.ctx.stroke(); }
                if(isSlot && !isFocus) { this.ctx.strokeStyle="#fff"; this.ctx.lineWidth=2; this.ctx.stroke(); }
                this.ctx.fill(); this.ctx.shadowBlur=0;
                if(isFocus || isPreview || n.alpha > 0.5) {
                    this.ctx.save(); this.ctx.translate(n.x, n.y); this.ctx.rotate(-this.viewRotation);
                    this.ctx.fillStyle = (isFocus||isPreview) ? "#fff" : "rgba(200,200,200,0.7)";
                    this.ctx.font = (isFocus||isPreview) ? "bold 14px Arial" : "11px Arial";
                    this.ctx.textAlign = "center";
                    this.ctx.fillText(n.label, 0, r + 16);
                    const sIdx = App.Store.state.slots.indexOf(n);
                    if(sIdx>=0) { this.ctx.fillStyle="#4facfe"; this.ctx.font="bold 11px monospace"; this.ctx.fillText(`[${sIdx+1}]`, 0, -r-6); }
                    this.ctx.restore();
                }
            }
        });
        this.ctx.restore();
        document.getElementById('layer-indicator').innerText=App.Store.state.viewLayers;
        document.getElementById('visible-count').innerText = vCount;
        if (this.simulation.alpha() < 0.3) this.simulation.alpha(0.3).restart();
        requestAnimationFrame(now => this.render(now));
    },

    screenToWorld(sx, sy) {
        const rect = this.canvas.getBoundingClientRect();
        let x = (sx - rect.left) - this.width/2;
        let y = (sy - rect.top) - this.height/2;
        const cos = Math.cos(-this.viewRotation), sin = Math.sin(-this.viewRotation);
        let rx = x * cos - y * sin, ry = x * sin + y * cos;
        return { x: (rx + this.width/2 - this.viewX) / this.viewK, y: (ry + this.height/2 - this.viewY) / this.viewK };
    },
    setTargetRotation(rad) {
        let diff = rad - this.targetRotation;
        while(diff > Math.PI) diff -= 2*Math.PI; while(diff < -Math.PI) diff += 2*Math.PI;
        this.targetRotation += diff;
    }
};

// ==========================================
// 5. Input
// ==========================================
App.Input = {
    state: {
        hoverNode: null,
        previewNode: null,
        linkMode: { active: false },
        dragNode: null,
        click: { startTime: 0, startX: 0, startY: 0 },
        keyState: {},
        keyControlsVisible: true,
        mouseX: 0,
        mouseY: 0
    },

    init() {
        const C = App.Renderer.canvas;
        C.addEventListener('mousedown', this.onMouseDown.bind(this));
        C.addEventListener('mouseup', this.onMouseUp.bind(this));
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

    executeLinkAction(source, target) {
        const { links } = App.Store.state;
        const existing = links.find(l => (l.source.uuid===source.uuid && l.target.uuid===target.uuid) || (l.source.uuid===target.uuid && l.target.uuid===source.uuid));
        const { type } = this.state.linkMode;

        if (type === 'DELETE') {
            if(existing) {
                App.Store.executeSafeAction(() => ({
                    nodes: App.Store.state.nodes,
                    links: links.filter(l=>l!==existing),
                    nextFocus: target,
                    nextSlots: App.Store.state.slots
                }));
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
            const targetNode = nodes.find(n => n.uuid === targetUUID)
            if (targetNode) {
                this.safeNavigate(targetNode, false);
            }
        } else {
            App.UI.showFlash(t('flash.noHistory'), 'info');
        }
    },

    // --- Mouse ---
    onMouseDown(e) {
        if(App.UI.Modal.el.classList.contains('active') || App.UI.Dialog.isActive) return;
        if(e.button===3) { e.preventDefault(); this.safeNavigateBack(); return; }
        if(e.button===4) { e.preventDefault(); this.enterLinkMode(); return; }
        if(e.button!==0) return;

        const node = this.pickNode(e.clientX, e.clientY);
        this.state.mouseX = e.clientX; this.state.mouseY = e.clientY;
        this.state.dragNode = node;
        this.state.click = { start: performance.now(), x: e.clientX, y: e.clientY };

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
        if(App.UI.Modal.el.classList.contains('active') || App.UI.Dialog.isActive) return;
        if(this.state.dragNode) return;

        const node = this.pickNode(e.clientX, e.clientY);
        if(node) {
            this.state.hoverNode = node; this.state.previewNode = null;
            const html = typeof marked!=='undefined' ? marked.parse(node.summary||'') : node.summary;
            this.showTooltip(t('tooltip.nodeHover', {label: node.label, summary: html}), e.clientX, e.clientY, 'mouse');
        } else {
            this.state.hoverNode = null;
            if(!this.state.previewNode) this.hideTooltip();
        }
    },

    onMouseUp(e) {
        if(e.button!==0 || !this.state.dragNode) return;
        const node = this.state.dragNode;
        if(node) {
            App.Renderer.pointerForce.node(null).target(null);
            App.Store.save();
            App.Renderer.canvas.style.cursor = 'crosshair';
        }
        this.state.dragNode = null;

        const dist = Math.hypot(e.clientX - this.state.click.x, e.clientY - this.state.click.y);
        if(performance.now() - this.state.click.start < 200 && dist < 8) {
            const target = node || this.pickNode(e.clientX, e.clientY);
            if(target) {
                if(target !== App.Store.state.focusNode) this.safeNavigate(target);
                else App.UI.Modal.show();
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
        const node = this.pickNode(e.clientX, e.clientY);
        if(node) { this.deleteNode(node); return; }
        const link = this.pickLink(e.clientX, e.clientY);
        if(link) { this.deleteLink(link); return; }
    },

    onWheel(e) {
        e.preventDefault();
        App.Renderer.viewK = Math.max(0.1, Math.min(5, App.Renderer.viewK - e.deltaY * 0.001));
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
            case 'ArrowUp': case '/': if(this.state.previewNode) this.safeNavigate(this.state.previewNode); else this.jumpDirection(-Math.PI/2); break;
            case 'ArrowDown': case '?': this.jumpDirection(Math.PI/2); break;
            case 'ArrowLeft': this.jumpDirection(Math.PI); break;
            case 'ArrowRight': this.jumpDirection(0); break;
            case '.': this.cyclePreview(1); break;
            case ',': this.cyclePreview(-1); break;
            case '=': case '+': App.Store.state.viewLayers = Math.max(1, App.Store.state.viewLayers-1); App.Renderer.adjustZoomByLayer(); break;
            case '-': case '_': App.Store.state.viewLayers = App.Store.state.viewLayers+1; App.Renderer.adjustZoomByLayer(); break;
            case 'Tab': e.preventDefault(); this.createDefaultLinkedNode(); break;
            case 'n': case 'N': e.preventDefault(); this.createNode(); break;
            case 'F2': e.preventDefault(); App.UI.els.label.focus(); App.UI.els.label.select(); break;
            case ' ': e.preventDefault(); App.UI.els.label.focus(); App.UI.els.label.select(); break;
            case 'Enter': if(App.Store.state.focusNode) App.UI.Modal.show(); break;
            case 'l': case 'L': this.enterLinkMode(); break;
            case 'h': case 'H': const root = App.Store.state.nodes.find(n=>n.isRoot); if(root) this.safeNavigate(root); break;
            case 'Escape': if(this.state.linkMode.active) this.exitLinkMode(); break;
            case 'b': case 'B': this.safeNavigateBack(); break;
            case 'Delete': case 'd': case 'D': this.deleteNode(); break;
            case 'i': case 'I': e.preventDefault(); this.state.keyControlsVisible=!this.state.keyControlsVisible; document.getElementById('key-controls').style.display=this.state.keyControlsVisible?'block':'none'; break;
            case '`': e.preventDefault(); App.UI.PresetEditor.open(); break;
            case '<': App.Renderer.targetRotation += 0.05; break;
            case '>': App.Renderer.targetRotation -= 0.05; break;
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

    jumpDirection(targetAng) {
        const neighbors = this.getNeighbors();
        let best = null, minDiff = 1.2;
        neighbors.forEach(n => {
            let diff = Math.abs(n.vAngle - targetAng); if (diff > Math.PI) diff = 2*Math.PI - diff;
            if (diff < minDiff) { minDiff = diff; best = n.node; }
        });
        if(best) this.safeNavigate(best);
    },

    pickNode(sx, sy) {
        const w = App.Renderer.screenToWorld(sx, sy);
        const nodes = App.Store.state.nodes;
        for(let i=nodes.length-1; i>=0; i--) {
            const n = nodes[i];
            if(n.alpha <= 0.5) continue;
            const dx = n.x - w.x, dy = n.y - w.y;
            if(dx*dx + dy*dy < 600) return n;
        }
        return null;
    },
    pickLink(sx, sy) {
        const w = App.Renderer.screenToWorld(sx, sy);
        const links = App.Store.state.links;
        for(let l of links) {
            if(l.alpha < 0.3) continue;
            const x1 = l.source.x, y1 = l.source.y, x2 = l.target.x, y2 = l.target.y;
            const A = x2-x1, B = y2-y1, lenSq = A*A+B*B;
            let t = ((w.x-x1)*A + (w.y-y1)*B) / lenSq;
            t = Math.max(0, Math.min(1, t));
            if(Math.hypot(w.x-(x1+t*A), w.y-(y1+t*B)) < 10/App.Renderer.viewK) return l;
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
