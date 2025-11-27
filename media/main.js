/**
 * Stars v5.0 Refactored
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

        init() {},

        _show(msg, needsInput = false, placeholder = '') {
            return new Promise((resolve) => {
                this.isActive = true;
                this.msgEl.innerText = msg;
                this.inputEl.style.display = needsInput ? 'block' : 'none';
                this.inputEl.value = '';
                this.inputEl.placeholder = placeholder;

                this.btnConfirm.innerText = App.Utils.t('dialog.confirm');
                this.btnCancel.innerText = App.Utils.t('dialog.cancel');

                this.overlay.classList.add('active');
                if (needsInput) setTimeout(() => this.inputEl.focus(), 50);
                else this.btnConfirm.focus();

                const cleanup = (e) => {
                    if(e) { e.preventDefault(); e.stopPropagation(); }
                    this.btnConfirm.onclick = null;
                    this.btnCancel.onclick = null;
                    this.inputEl.onkeydown = null;
                    this.btnConfirm.removeEventListener('keydown', handleBtnKey);
                    this.btnCancel.removeEventListener('keydown', handleBtnKey);

                    this.overlay.classList.remove('active');
                    this.isActive = false;
                    App.Renderer.canvas.focus();
                };

                const handleBtnKey = (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.btnConfirm.click(); }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.btnCancel.click(); }
                };

                this.btnConfirm.onclick = (e) => { const val = this.inputEl.value; cleanup(e); resolve(needsInput ? val : true); };
                this.btnCancel.onclick = (e) => { cleanup(e); resolve(needsInput ? null : false); };

                this.inputEl.onkeydown = (e) => {
                    if(e.key === 'Enter') { e.preventDefault(); this.btnConfirm.click(); }
                    if(e.key === 'Escape') { e.preventDefault(); this.btnCancel.click(); }
                };

                this.btnConfirm.addEventListener('keydown', handleBtnKey);
                this.btnCancel.addEventListener('keydown', handleBtnKey);
            });
        },
        confirm(msg) { return this._show(msg, false); },
        prompt(msg, ph = '') { return this._show(msg, true, ph); }
    },

    I18n: {
        apply() {
            const setText = (id, key) => { const el = document.getElementById(id); if(el) el.innerHTML = App.Utils.t(key); };
            const setPh = (id, key) => { const el = document.getElementById(id); if(el) el.placeholder = App.Utils.t(key); };

            setText('txt-hud-title', 'hud.title');
            setText('txt-view-range', 'hud.viewLayers');
            setText('txt-layers', 'hud.layers');
            setText('txt-adjust', 'hud.adjust');
            setText('txt-visible', 'hud.visible');
            setText('txt-nodes', 'hud.nodes');
            const ctrlDiv = document.getElementById('key-controls');
            if(ctrlDiv) ctrlDiv.innerHTML = App.Utils.t('hud.controls');

            setText('save-btn', 'btn.save');
            setText('export-btn', 'btn.export');
            setText('reset-system-btn', 'btn.reset');
            setText('import-btn', 'btn.import');
            setText('manage-presets-btn', 'btn.presets');

            setPh('node-label', 'sidebar.placeholder.label');
            setPh('node-summary', 'sidebar.placeholder.summary');
            setPh('node-content', 'sidebar.placeholder.content');

            setText('txt-preset-editor-title', 'preset.menuTitle');
            setText('txt-preset-editor-desc', 'preset.menuDesc');
            setText('add-preset-btn', 'preset.btnAdd');
            setText('save-presets-btn', 'preset.btnSave');

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

            const raw = node.content || App.Utils.t('modal.noContent');
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
                    ${App.Utils.t('modal.close')} (Esc)
                </div>
            `;

            // CSP Safe Binding
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
                const deleteFragment = allowDelete ? App.Utils.t('preset.delete') : '';
                let html = `<div class="menu-title">${App.Utils.t('preset.title', {deleteFragment})}</div>`;

                html += presets.slice(0, 9).map((p, i) =>
                    `<div class="menu-opt" data-val="${p.val}"><span class="menu-key" style="color:${p.color}">[${i+1}]</span>${p.label || p.val}</div>`
                ).join('');

                if (presets.length > 9) {
                    html += `<div class="menu-title" style="margin-top:10px;">${App.Utils.t('preset.more')}</div>` +
                    presets.slice(9).map(p => `<div class="menu-opt" data-val="${p.val}"><span class="menu-key" style="visibility:hidden;">[]</span>${p.label}</div>`).join('');
                }

                if (allowDelete) {
                    html += `<div class="menu-opt delete-opt" data-val="DELETE" style="margin-top:5px; border-top:1px solid #333">
                    <span class="menu-key" style="color:#e74c3c">[D]</span>${App.Utils.t('linkMode.deleteLabel')}</div>`;
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
                    <input type="text" class="preset-input" style="width:120px" placeholder="${App.Utils.t('preset.input.label')}" value="${p.label}" data-idx="${i}" data-field="label">
                    <input type="text" class="preset-input" style="flex:1; color:#aaa;" placeholder="${App.Utils.t('preset.input.value')}" value="${p.val}" data-idx="${i}" data-field="val">
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
            if (this.tempPresets.length >= 20) { App.UI.showFlash(App.Utils.t('alert.presetExceedMax'), 'warn'); return; }
            this.tempPresets.push({label: App.Utils.t('fallback.newNode'), val:'new', color: App.Utils.getRandomColor()});
            this.renderList(); setTimeout(() => this.listEl.scrollTop = this.listEl.scrollHeight, 10);
        },
        saveAndClose() {
            if (this.tempPresets.some(p => !p.val || !p.val.trim())) { App.UI.showFlash(App.Utils.t('alert.presetValueEmpty'), 'warn'); return; }
            const values = this.tempPresets.map(p => p.val.trim());
            if (new Set(values).size !== values.length) { App.UI.showFlash(App.Utils.t('alert.presetValueDuplicate'), 'warn'); return; }
            App.Store.state.presets = JSON.parse(JSON.stringify(this.tempPresets));
            App.Store.save(); App.Renderer.restartSim();
            this.close();
            App.UI.showFlash(App.Utils.t('flash.presetUpdated'));
        },
        close() { this.el.classList.remove('active'); this.active = false; }
    }
};

// ==========================================
// 2. Store (Fixed: ExecuteSafeAction Logic)
// ==========================================
App.Store = {
    state: { nodes: [], links: [], slots: [null,null,null,null], focusNode: null, viewLayers: 1, navHistory: [], presets: [] },

    pushHistory(node) {
        if(node) {
            this.state.navHistory.push(node);
            if(this.state.navHistory.length > 50) {
                this.state.navHistory.shift();
            }
        }
    },

    loadFromExtension(payload) {
        App.Runtime.clearAllStorage();
        if (!payload || !payload.data || !payload.data.nodes) {
            this.createRoot();
        } else {
            this.state.nodes = []; this.state.links = []; this.state.navHistory = [];
            this.state.viewLayers = payload.viewLayers || 1;
            const DEFAULT_PRESETS = [
                { label: App.Utils.t('preset.default.includes'), val: 'comp', color: '#0062ff' },
                { label: App.Utils.t('preset.default.definedAs'), val: 'def', color: '#00ff00' },
                { label: App.Utils.t('preset.default.intuitive'), val: 'ins', color: '#33ffff' },
                { label: App.Utils.t('preset.default.calculates'), val: 'calc', color: '#ffaa00' },
                { label: App.Utils.t('preset.default.implies'), val: 'impl', color: '#bd00ff' },
                { label: App.Utils.t('preset.default.orthogonalTo'), val: 'orth', color: '#ff0055' },
            ];
            this.state.presets = (payload.presets && Array.isArray(payload.presets)) ? payload.presets : DEFAULT_PRESETS;

            const nodeMap = new Map(payload.data.nodes.map(n => [n.uuid, { ...n }]));
            this.state.nodes = Array.from(nodeMap.values());
            this.state.links = payload.data.links.map(l => ({
                source: nodeMap.get(l.source) || l.source,
                target: nodeMap.get(l.target) || l.target,
                type: l.type,
                alpha: 0
            })).filter(l => l.source && l.target);

            this.state.focusNode = payload.focusNodeUuid ? nodeMap.get(payload.focusNodeUuid) : (this.state.nodes.find(n => n.isRoot) || this.state.nodes[0]);
            if (!this.state.focusNode) this.createRoot();

            this.state.nodes.forEach(n => {
                if(n.x==null || isNaN(n.x)) n.x = (Math.random()-0.5)*50;
                if(n.y==null || isNaN(n.y)) n.y = (Math.random()-0.5)*50;
                n.alpha = 0; n.vx = 0; n.vy = 0; n.fx = null; n.fy = null;
                if(n.isRoot) { n.fx=0; n.fy=0; }
            });

            if (this.state.focusNode) {
                this.state.focusNode.alpha = 1;
                const initVis = new Set([this.state.focusNode.uuid]);
                const q = [{n:this.state.focusNode, d:0}]; let h=0;
                while(h < q.length) {
                    const {n, d} = q[h++];
                    if(d >= this.state.viewLayers) continue;
                    this.state.links.forEach(l => {
                        const sId = l.source.uuid||l.source, tId = l.target.uuid||l.target;
                        if(sId === n.uuid && !initVis.has(tId)) {
                            const t = this.state.nodes.find(x=>x.uuid===tId);
                            if(t) { initVis.add(tId); t.alpha=1; q.push({n:t, d:d+1}); }
                        } else if(tId === n.uuid && !initVis.has(sId)) {
                            const s = this.state.nodes.find(x=>x.uuid===sId);
                            if(s) { initVis.add(sId); s.alpha=1; q.push({n:s, d:d+1}); }
                        }
                    });
                }
                if(App.Renderer.width > 0) {
                    App.Renderer.viewX = -this.state.focusNode.x * App.Renderer.viewK + App.Renderer.width/2;
                    App.Renderer.viewY = -this.state.focusNode.y * App.Renderer.viewK + App.Renderer.height/2;
                }
            }
            this.state.slots = (payload.slots || [null,null,null,null]).map(uuid => uuid ? nodeMap.get(uuid) : null);
        }
        App.UI.updateSidebar();
        App.UI.updateSlotUI();
        App.Renderer.restartSim();
        for(let i=0; i<30; i++) App.Renderer.simulation.tick();
    },

    createRoot() {
        const rootUUID = uuid.v4();
        const root = { uuid: rootUUID, label: App.Utils.t('fallback.origin'), isRoot: true, x: 0, y: 0, fx: 0, fy: 0, summary: App.Utils.t('fallback.summary'), content: App.Utils.t('fallback.content'), color: "#ffffff", alpha: 1 };
        this.state.nodes = [root];
        this.state.links = [];
        this.state.slots = [null,null,null,null];
        this.state.focusNode = root;
        this.state.viewLayers = 1;
    },

    // --- Critical Fix: Execute Safe Action ---
    // Now correctly applies changes regardless of unsafe/safe path
    async executeSafeAction(simulator, onApplied = null) {
        const { nodes, focusNode, slots } = this.state;
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
            const msg = App.Utils.t('alert.deleteConfirm', { n: lost.length, label: label });

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
        // 不要读 localStorage，直接获取内存数据
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
                        App.Store.loadFromExtension(data);
                        App.UI.showFlash(App.Utils.t('alert.importSuccess'));
                    } else App.UI.showFlash(App.Utils.t('alert.importFail'), 'warn');
                } catch(e) { App.UI.showFlash(App.Utils.t('alert.parseFail'), 'warn'); }
            };
            r.readAsText(f);
            inp.value = '';
        }
    },

    async resetSystem() {
        if(await App.UI.Dialog.confirm(App.Utils.t('alert.resetConfirm'))) {
            App.Runtime.clearAllStorage();
            vscode.postMessage({ command: 'resetSystem' });
        }
    }
};
App.Store.saveDebounced = App.Utils.debounce(() => App.Store.save(), 1000);

// ==========================================
// 3. Runtime
// ==========================================
App.Runtime = {
    activeInstances: {},
    mount(node, containerId) {
        this.unmount(node.uuid);
        const container = document.getElementById(containerId);
        if (!container) return;
        const scripts = [];
        container.querySelectorAll('script').forEach(s => { scripts.push(s.textContent); s.remove(); });
        let unmountCbs = [];
        const api = {
            $: (s) => container.querySelector(s),
            $$: (s) => container.querySelectorAll(s),
            storage: this._createStorageApi(node.uuid),
            node: { uuid: node.uuid, label: node.label, color: node.color },
            onMount: (cb) => { try{cb()}catch(e){console.error(e)} },
            onUnmount: (cb) => { unmountCbs.push(cb) },
            window: window, document: document
        };
        this.activeInstances[node.uuid] = { unmountFn: () => unmountCbs.forEach(cb => cb()) };
        scripts.forEach((code, idx) => {
            try {
                new Function('api', `(function(Runtime){ "use strict"; ${code} })(arguments[0])`)(api);
            } catch(e) {
                const err = document.createElement('div');
                err.style.color = 'red'; err.innerText = `Script Error: ${e.message}`;
                container.appendChild(err);
            }
        });
    },
    unmount(uuid) {
        if(this.activeInstances[uuid]) {
            try { this.activeInstances[uuid].unmountFn(); } catch(e){}
            delete this.activeInstances[uuid];
        }
    },
    _createStorageApi(uuid) {
        const p = `node_storage_${uuid}_`;
        return {
            set: (k, v) => { localStorage.setItem(p+k, JSON.stringify(v)); return true; },
            get: (k, d) => { const i=localStorage.getItem(p+k); return i?JSON.parse(i):d; },
            remove: (k) => localStorage.removeItem(p+k),
            clear: () => this.clearStorage(uuid)
        };
    },
    clearStorage(uuid) {
        const p = `node_storage_${uuid}_`;
        Object.keys(localStorage).forEach(k => { if(k.startsWith(p)) localStorage.removeItem(k); });
    },
    clearAllStorage() {
        Object.keys(localStorage).forEach(k => { if(k.startsWith('node_storage_')) localStorage.removeItem(k); });
    }
};

// ==========================================
// 4. Renderer
// ==========================================
App.Renderer = {
    canvas: document.getElementById('canvas'),
    ctx: document.getElementById('canvas').getContext('2d'),
    width: 0, height: 0, viewX: 0, viewY: 0, viewK: 1, viewRotation: 0, targetRotation: 0,
    simulation: null, pointerForce: null, lastRenderTime: 0, FADE_DURATION: 400, DEFAULT_NODE_COLOR: "#4facfe",

    init() {
        this.resize();
        this.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.uuid).distance(220).strength(0.1))
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

        const SIM_LAYERS = 7;
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
                const mult = isFocus ? 0.9 : (isHigh ? 0.6 : 0.4);
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
    state: { hoverNode: null, previewNode: null, linkMode: { active: false }, dragNode: null, click: {}, keyState: {}, mouseX: 0, mouseY: 0 },

    init() {
        const C = App.Renderer.canvas;
        C.addEventListener('mousedown', this.onMouseDown.bind(this));
        C.addEventListener('mouseup', this.onMouseUp.bind(this));
        C.addEventListener('mousemove', this.onMouseMove.bind(this));
        C.addEventListener('wheel', this.onWheel.bind(this), {passive:false});
        C.addEventListener('contextmenu', this.onContextMenu.bind(this));
        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', e => {
            this.state.keyState[e.key] = false;
            if(e.key==='Shift') this.state.keyState['Shift'] = false;
        });

        document.getElementById('save-btn').addEventListener('click', () => App.Store.save());
        document.getElementById('export-btn').addEventListener('click', () => App.Store.exportData()); 
        document.getElementById('reset-system-btn').addEventListener('click', () => App.Store.resetSystem());
        document.getElementById('import-btn').addEventListener('click', () => document.getElementById('importFile').click());
        document.getElementById('importFile').addEventListener('change', (e) => App.Store.importData(e.target));
        document.getElementById('manage-presets-btn').addEventListener('click', () => App.UI.PresetEditor.open());
        document.getElementById('preset-editor-close-btn').addEventListener('click', () => App.UI.PresetEditor.close());
        document.getElementById('add-preset-btn').addEventListener('click', () => App.UI.PresetEditor.add());
        document.getElementById('save-presets-btn').addEventListener('click', () => App.UI.PresetEditor.saveAndClose());
    },

    handleSlotClick(idx, isShift) {
        if (isShift) this.handleSlotStore(idx);
        else this.handleSlot(idx);
    },

    handleSlot(idx) {
        const { slots, focusNode } = App.Store.state;
        if (slots[idx] === focusNode) return;
        if (slots[idx]) {
            const targetNode = slots[idx];
            slots[idx] = focusNode;
            App.UI.updateSlotUI();
            this.navigateTo(targetNode, true);
        } else {
            slots[idx] = focusNode; App.UI.updateSlotUI(); App.Store.save();
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
            this.navigateTo(node, recordHistory);
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
        });
        // Note: executeSafeAction will call navigateTo if safe via its applyState
    },

    // Internal Navigate (State Update)
    // Called by executeSafeAction or Link Mode
    navigateTo(node, recordHistory = true) {
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
                const cLabel = await App.UI.Dialog.prompt(App.Utils.t('linkMode.prompt'), App.Utils.t('linkMode.promptPlaceholder'));
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
            el.innerHTML = App.Utils.t('linkMode.typeIndicator', {color: this.state.linkMode.color, type: this.state.linkMode.type});
            el.classList.add('active');
        } else {
            el.innerHTML = App.Utils.t('hud.linkMode');
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
            } else App.UI.showFlash(App.Utils.t('alert.noLinkToBreak'), 'info');
        } else {
            if(existing) { existing.type = type; existing.source = source; existing.target = target; }
            else links.push({source, target, type, alpha: 0});
            App.Renderer.restartSim();
        }
    },

    createNode() {
        const { focusNode, nodes, links, slots } = App.Store.state;
        const newNode = {
            uuid: uuid.v4(), label: App.Utils.t('fallback.newNode'),
            x: focusNode.x + 150, y: focusNode.y + 50,
            summary: "", content: "", color: App.Utils.getRandomColor(), alpha: 0
        };

        // If LinkMode, we skip safe check because we create a link immediately
        if (this.state.linkMode.active && this.state.linkMode.type !== 'DELETE') {
            nodes.push(newNode);
            App.Renderer.restartSim();
            this.executeLinkAction(this.state.linkMode.source, newNode);
            this.exitLinkMode();
            this.navigateTo(newNode, true);
            setTimeout(() => { App.UI.els.label.focus(); App.UI.els.label.select(); }, 50);
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
                setTimeout(() => { App.UI.els.label.focus(); App.UI.els.label.select(); }, 50);
            });
        }
    },

    deleteNode(target = null) {
        const node = target || App.Store.state.focusNode;
        if(node.isRoot) { App.UI.showFlash(App.Utils.t('alert.rootCannotDelete'), 'warn'); return; }
        const { navHistory, nodes, links, slots } = App.Store.state
        let next = App.Store.state.focusNode;
        if(node === next) {
            next = navHistory.length > 0 ? navHistory[navHistory.length-1] : nodes.find(n=>n.isRoot);
            if (next === node) next = nodes.find(n=>n.isRoot);
        }
        App.Store.executeSafeAction(() => ({
            nodes: nodes.filter(n=>n.uuid!==node.uuid),
            links: links.filter(l=>l.source.uuid!==node.uuid && l.target.uuid!==node.uuid),
            nextFocus: next,
            nextSlots: slots.map(s=>(s&&s.uuid===node.uuid)?null:s)
        }), () => {
            App.Store.state.navHistory = App.Store.state.navHistory.filter(n => n.uuid !== node.uuid);
        });
    },

    deleteLink(link) {
        App.Store.executeSafeAction(() => ({
            nodes: App.Store.state.nodes,
            links: App.Store.state.links.filter(l=>l!==link),
            nextFocus: App.Store.state.focusNode,
            nextSlots: App.Store.state.slots
        }));
    },

    navigateBack() {
        const h = App.Store.state.navHistory;

        // Loop and Pop until we find a valid previous node
        while (h.length > 0) {
            const prev = h.pop(); // Remove from stack so we don't go back to it again
            const exists = App.Store.state.nodes.find(n => n.uuid === prev.uuid);

            // Ensure node exists and we aren't just reloading the current node
            if (exists && exists.uuid !== App.Store.state.focusNode.uuid) {
                // Move to it, but DO NOT record history (recordHistory = false)
                this.safeNavigate(exists, false);
                return;
            }
        }
        // Optional feedback
        App.UI.showFlash(App.Utils.t('flash.noHistory') || "No History", 'info');
    },

    // --- Mouse ---
    onMouseDown(e) {
        if(App.UI.Modal.el.classList.contains('active') || App.UI.Dialog.isActive) return;
        if(e.button===3) { e.preventDefault(); this.navigateBack(); return; }
        if(e.button===4) { e.preventDefault(); this.enterLinkMode(); return; }
        if(e.button!==0) return;

        const node = this.pickNode(e.clientX, e.clientY);
        this.state.mouseX = e.clientX; this.state.mouseY = e.clientY;
        this.state.dragNode = node;
        this.state.click = { start: performance.now(), x: e.clientX, y: e.clientY };

        if(node) {
            this.state.hoverNode=null; this.state.previewNode=null; this.hideTooltip();
            App.Renderer.canvas.style.cursor = 'grabbing';
        } else App.UI.RelationPicker.close();
    },

    onMouseMove(e) {
        this.state.mouseX = e.clientX; this.state.mouseY = e.clientY;
        if(App.UI.Modal.el.classList.contains('active') || App.UI.Dialog.isActive) return;
        if(this.state.dragNode) return;

        const node = this.pickNode(e.clientX, e.clientY);
        if(node) {
            this.state.hoverNode = node; this.state.previewNode = null;
            const html = typeof marked!=='undefined' ? marked.parse(node.summary||'') : node.summary;
            this.showTooltip(App.Utils.t('tooltip.nodeHover', {label: node.label, summary: html}), e.clientX, e.clientY, 'mouse');
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
        if(App.UI.PresetEditor.active) { if(e.key==='Escape') App.UI.PresetEditor.close(); return; }
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
            case '=': case '+': App.Store.state.viewLayers = Math.max(1, App.Store.state.viewLayers-1); App.Renderer.adjustZoomByLayer(); document.getElementById('layer-indicator').innerText=App.Store.state.viewLayers; break;
            case '-': case '_': App.Store.state.viewLayers = Math.min(7, App.Store.state.viewLayers+1); App.Renderer.adjustZoomByLayer(); document.getElementById('layer-indicator').innerText=App.Store.state.viewLayers; break;
            case 'Tab': case 'n': case 'N': e.preventDefault(); this.createNode(); break;
            case 'F2': e.preventDefault(); App.UI.els.label.focus(); App.UI.els.label.select(); break;
            case ' ': e.preventDefault(); App.UI.els.summary.focus(); App.UI.els.summary.select(); break;
            case 'Enter': if(App.Store.state.focusNode) App.UI.Modal.show(); break;
            case 'l': case 'L': this.enterLinkMode(); break;
            case 'e': case 'E': App.UI.showFlash(App.Utils.t('hud.linkMode'), 'info'); break;
            case 'h': case 'H': const root = App.Store.state.nodes.find(n=>n.isRoot); if(root) this.safeNavigate(root); break;
            case 'Escape': if(this.state.linkMode.active) this.exitLinkMode(); break;
            case 'b': case 'B': this.navigateBack(); break;
            case 'Delete': case 'd': case 'D': this.deleteNode(); break;
            case 'i': case 'I': e.preventDefault(); this.state.hudVisible=!this.state.hudVisible; document.getElementById('key-controls').style.display=this.state.hudVisible?'block':'none'; break;
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
        const html = typeof marked!=='undefined' ? marked.parse(wrapper.node.summary||'') : wrapper.node.summary || ''; // 确保summary为空时不会报错
        this.showTooltip(App.Utils.t('tooltip.preview', {label: wrapper.node.label, summary: html}), 0, 0, 'fixed');
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
            App.Store.loadFromExtension(msg.data);
            break;
    }
});

window.onload = () => {
    App.Renderer.init(); App.UI.init(); App.Input.init();
    vscode.postMessage({ command: 'ready' });
    console.log("Stars: Webview Ready.");
};
