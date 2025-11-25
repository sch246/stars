const vscode = acquireVsCodeApi();

// 🔴 确保全局可以使用 t() 和 setLanguage()
// 它们在 media/i18n.js 中定义
// eslint-disable-next-line no-undef
if (typeof t === 'undefined' || typeof setLanguage === 'undefined') {
    console.error("Stars: i18n.js was not loaded correctly.");
    // Fallback or error handling if i18n functions are not available
    window.t = (key, params) => {
        console.warn(`i18n function 't' not found. Key: ${key}`);
        let str = key;
        Object.keys(params).forEach(k => {
            str = str.replace(new RegExp(`{${k}}`, 'g'), params[k]);
        });
        return str;
    };
    window.setLanguage = (lang) => console.warn(`i18n function 'setLanguage' not found. Lang: ${lang}`);
}


window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'setLanguage':
            setLanguage(message.lang); // 设置语言
            applyTranslations(); // 应用翻译
            break;
        case 'loadData':
            console.log("Stars: Received data from Extension");
            initSystem(message.data);
            break;
    }
});

let animationFrameId = null;

// --- 新增：应用翻译到静态 HTML 元素 ---
function applyTranslations() {
    const setTxt = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = t(key);
    };
    const setPh = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.placeholder = t(key);
    };

    // HUD
    setTxt('txt-hud-title', 'hud.title');
    setTxt('txt-view-range', 'hud.viewLayers');
    setTxt('txt-layers', 'hud.layers');
    setTxt('txt-adjust', 'hud.adjust');
    setTxt('txt-visible', 'hud.visible');
    setTxt('txt-nodes', 'hud.nodes');
    document.getElementById('key-controls').innerHTML = t('hud.controls');

    // Buttons
    setTxt('save-btn', 'btn.save');
    setTxt('export-btn', 'btn.export');
    setTxt('reset-system-btn', 'btn.reset');
    setTxt('import-btn', 'btn.import');
    setTxt('manage-presets-btn', 'btn.presets');

    // Sidebar placeholders
    setPh('node-label', 'sidebar.placeholder.label');
    setPh('node-summary', 'sidebar.placeholder.summary');
    setPh('node-content', 'sidebar.placeholder.content');

    // Dialog buttons
    setTxt('btn-cancel', 'dialog.cancel');
    setTxt('btn-confirm', 'dialog.confirm');

    // Preset Editor
    setTxt('txt-preset-editor-title', 'preset.menuTitle');
    setTxt('txt-preset-editor-desc', 'preset.menuDesc');
    setTxt('add-preset-btn', 'preset.btnAdd');
    setTxt('save-presets-btn', 'preset.btnSave'); // 这里使用preset.btnSave

    // 更新连线模式指示器
    updateLinkModeIndicator();
}


// --- 0. Custom Dialogs (Replaces native confirm/prompt) ---
const CustomDialog = {
    overlay: document.getElementById('custom-dialog-overlay'),
    msgEl: document.getElementById('custom-dialog-msg'),
    inputEl: document.getElementById('custom-dialog-input'),
    btnConfirm: document.getElementById('btn-confirm'),
    btnCancel: document.getElementById('btn-cancel'),
    _show: function(msg, needsInput = false, placeholder = '') {
        return new Promise((resolve) => {
            this.msgEl.innerText = msg;
            this.inputEl.style.display = needsInput ? 'block' : 'none';
            this.inputEl.value = '';
            this.inputEl.placeholder = placeholder;
            this.overlay.classList.add('active');
            if (needsInput) setTimeout(() => this.inputEl.focus(), 50);
            const cleanup = (e = null) => { // 增加一个可选的事件参数
                if (e) {
                    e.preventDefault(); // 阻止默认行为
                    e.stopPropagation(); // 阻止事件冒泡
                }
                this.btnConfirm.onclick = null;
                this.btnCancel.onclick = null;
                this.inputEl.onkeydown = null;
                // 移除按钮上的keydown监听，避免冲突
                this.btnConfirm.removeEventListener('keydown', handleButtonKeydown);
                this.btnCancel.removeEventListener('keydown', handleButtonKeydown);
                this.overlay.classList.remove('active');
            };
            const handleButtonKeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.btnConfirm.click(); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.btnCancel.click(); }
            };
            this.btnConfirm.onclick = (e) => {
                const val = this.inputEl.value;
                cleanup(e); // 传递事件对象
                resolve(needsInput ? val : true);
            };
            this.btnCancel.onclick = (e) => {
                cleanup(e); // 传递事件对象
                resolve(needsInput ? null : false); // 对于 prompt，取消返回 null；对于 confirm，取消返回 false
            };
            this.inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault(); e.stopPropagation(); // 阻止事件穿透
                    this.btnConfirm.click();
                }
                if (e.key === 'Escape') {
                    e.preventDefault(); e.stopPropagation(); // 阻止事件穿透
                    this.btnCancel.click();
                }
            };
            
            // 确保焦点在按钮上时，Enter/Esc 也能触发
            // 使用addEventListener而不是直接赋值onclick，方便移除
            this.btnConfirm.addEventListener('keydown', handleButtonKeydown);
            this.btnCancel.addEventListener('keydown', handleButtonKeydown);
            this.btnConfirm.focus(); // 默认焦点在确认按钮上
        });
    },
    confirm: async function(msg) {
        return await this._show(msg, false);
    },
    prompt: async function(msg, placeholder = '') {
        return await this._show(msg, true, placeholder);
    }
};


// --- 1. Config ---
const DEFAULT_PRESETS = [
    { label: '包含...', val: 'comp', color: '#0062ff' },
    { label: '定义为...', val: 'def', color: '#00ff00' },
    { label: '直观理解', val: 'ins', color: '#33ffff' },
    { label: '计算...', val: 'calc', color: '#ffaa00' },
    { label: '意味着...', val: 'impl', color: '#bd00ff' },
    { label: '与...正交', val: 'orth', color: '#ff0055' },
];
let RELATION_PRESETS = JSON.parse(JSON.stringify(DEFAULT_PRESETS));

const DEFAULT_NODE_COLOR = "#4facfe";
const MAX_VIEW_LAYERS = 7;
const MIN_VIEW_LAYERS = 1;

let data = { nodes: [], links: [] };
let slots = [null, null, null, null];
let viewLayers = 1;
let focusNode = null, hoverNode = null, previewNode = null;
let navHistory = [];
let viewX = 0, viewY = 0, viewK = 1, viewRotation = 0, targetRotation = 0;
let lastRenderTime = 0;
const FADE_DURATION = 400;
const keyState = {};
let hudVisible = true;


// --- 连线模式状态 ---
let linkMode = {
    active: false,
    sourceNode: null,
    type: null,
    customLabel: null,
    color: null
};

function initSystem(payload) {
    if (!payload || !payload.data || !payload.data.nodes) {
        console.error("Stars: Invalid payload received. Fallback to local root.");
        createRootNodeLocally();
        focusNode = data.nodes[0];
        updateUI(); updateSlotUI(); restartSim(); adjustZoomByLayer();
        return;
    }

    // 重置全局状态
    data = { nodes: [], links: [] };
    slots = [null, null, null, null];
    navHistory = [];

    // 从 payload 恢复 viewLayers 和 presets
    viewLayers = payload.viewLayers || 1;
    RELATION_PRESETS = payload.presets && Array.isArray(payload.presets) ? payload.presets : JSON.parse(JSON.stringify(DEFAULT_PRESETS));

    // 重新构建节点和链接数据，解决 JSON 序列化丢失的引用
    const nodeMap = new Map(payload.data.nodes.map(n => [n.uuid, { ...n }]));
    data.nodes = Array.from(nodeMap.values());

    data.links = payload.data.links.map(l => ({
        source: nodeMap.get(l.source) || l.source,
        target: nodeMap.get(l.target) || l.target,
        type: l.type,
        alpha: 0
    })).filter(l => l.source && l.target); // 过滤掉损坏的链接（源或目标节点不存在）

    // 1. 确保 Focus Node 存在
    focusNode = data.nodes.find(n => n.isRoot);
    if (!focusNode && data.nodes.length > 0) focusNode = data.nodes[0];
    if (!focusNode) {
        console.warn("Stars: No focus node found from Extension data, creating a local Origin node as fallback.");
        createRootNodeLocally();
        focusNode = data.nodes[0];
    }

    // ------------------------------------------------------------
    // 🔴 修复核心：数据刚加载时，强制重置所有节点状态
    // ------------------------------------------------------------
    data.nodes.forEach(n => {
        // 如果没有坐标，给一个随机初始位置，防止堆叠导致爆炸
        if (n.x === undefined || isNaN(n.x) || n.x === null) n.x = (Math.random() - 0.5) * 50;
        if (n.y === undefined || isNaN(n.y) || n.y === null) n.y = (Math.random() - 0.5) * 50;

        // 重要：先全部设为透明，下面再计算谁该显示
        n.alpha = 0;
        // 重置速度，防止之前的动量残留
        n.vx = 0; n.vy = 0;
    });

    // 2. 立即计算初始视野内的节点，直接设为不透明 (跳过淡入动画)
    if (focusNode) {
        focusNode.alpha = 1;
        // 简单的广度优先搜索，找到初始邻居
        const initialVisible = new Set([focusNode.uuid]);
        const queue = [{n: focusNode, d: 0}];
        let head = 0;
        while(head < queue.length){
            const {n, d} = queue[head++];
            if(d >= viewLayers) continue;
            data.links.forEach(l => {
                const sId = (typeof l.source === 'object' && l.source !== null) ? l.source.uuid : l.source;
                const tId = (typeof l.target === 'object' && l.target !== null) ? l.target.uuid : l.target;

                if (sId === n.uuid && !initialVisible.has(tId)) {
                    const tNode = data.nodes.find(x=>x.uuid === tId);
                    if(tNode) { initialVisible.add(tId); tNode.alpha = 1; queue.push({n: tNode, d: d+1}); }
                } else if (tId === n.uuid && !initialVisible.has(sId)) {
                    const sNode = data.nodes.find(x=>x.uuid === sId);
                    if(sNode) { initialVisible.add(sId); sNode.alpha = 1; queue.push({n: sNode, d: d+1}); }
                }
            });
        }
    }

    // 3. 强制重置视图中心到 FocusNode
    viewX = 0; viewY = 0; viewK = 1; viewRotation = 0; targetRotation = 0;
    // 这一步至关重要：让视图瞬间对准焦点
    // 确保 width 和 height 已经初始化
    if (focusNode && width > 0 && height > 0) {
         // 模拟 render 中的逻辑，但立即执行
         const targetX = width/2; const targetY = height/2;
         viewX = -focusNode.x * viewK + targetX;
         viewY = -focusNode.y * viewK + targetY;
    }

    // 取消可能正在运行的渲染循环
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // 恢复槽位（UUID 转换为节点引用）
    slots = (payload.slots || [null, null, null, null]).map(uuid =>
        uuid ? nodeMap.get(uuid) : null
    );

    // 更新 UI 和重新启动模拟
    updateUI();
    updateSlotUI();
    updateCanvasSize(); // 确保尺寸正确，尤其是第一次加载时

    // 4. 给予模拟器高能量，并多迭代几次预热
    simulation.nodes(data.nodes);
    simulation.force("link").links(data.links);
    simulation.alpha(1).restart();
    // 预热 30 次 tick，让混乱的节点先散开一点，然后再开始渲染
    // 这有助于防止所有节点挤在一起，特别是新加载大量节点时
    for (let i = 0; i < 30; ++i) simulation.tick();

    adjustZoomByLayer();
    animationFrameId = requestAnimationFrame(render); // 启动渲染
    console.log("Stars: Graph initialized successfully with", data.nodes.length, "nodes from Extension data.");
}

function createRootNodeLocally() {
    const rootUUID = uuid.v4();
    // 确保x, y有初始值 // 🔴 国际化：使用 t()
    const root = { uuid: rootUUID, label: t('fallback.origin'), isRoot: true, x: 0, y: 0, summary: t('fallback.summary'), content: t('fallback.content'), color: "#ffffff", alpha: 1 };
    data = { nodes: [root], links: [] };
    slots = [null, null, null, null];
    focusNode = root;
    viewLayers = 1;
    RELATION_PRESETS = JSON.parse(JSON.stringify(DEFAULT_PRESETS));
    console.warn("Stars: Created a local Origin node as fallback.");
}

async function resetSystem() {
    // 🔴 国际化：使用 t()
    if (await CustomDialog.confirm(t('alert.resetConfirm'))) {
        // 通知 Extension 清空数据并重新加载默认
        vscode.postMessage({ command: 'resetSystem' });
    }
}

// --- 2. Core Logic ---

function getNodeLinkCount(nodeUuid) {
    return data.links.filter(l => l.source.uuid === nodeUuid || l.target.uuid === nodeUuid).length;
}

function showFlashMessage(msg, type = 'info') {
    const el = document.getElementById('flash-message');
    el.innerText = msg;
    el.className = type;
    el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 2000);
}

function findReachable(allNodes, allLinks, startNodes) {
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
        const s = (typeof l.source === 'object' && l.source !== null) ? l.source.uuid : l.source;
        const t = (typeof l.target === 'object' && l.target !== null) ? l.target.uuid : l.target;
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

async function executeSafeAction(simulator, executor) {
    const proposed = simulator();
    const { nodes, links, nextFocus, nextSlots } = proposed;
    const anchors = [];
    const root = nodes.find(n => n.isRoot);
    if (root) anchors.push(root);
    if (nextFocus) anchors.push(nextFocus);
    nextSlots.forEach(s => { if(s) anchors.push(s); });

    const reachableUUIDs = findReachable(nodes, links, anchors);
    const lostNodes = nodes.filter(n => !reachableUUIDs.has(n.uuid));

    if (lostNodes.length > 0) {
        // 🔴 国际化：使用 t()
        const confirmMsg = t('alert.deleteConfirm', { n: lostNodes.length, label: lostNodes[0].label });
        if (await CustomDialog.confirm(confirmMsg)) {
            executor();
            const deadUUIDs = new Set(lostNodes.map(n => n.uuid));
            data.nodes = data.nodes.filter(n => !deadUUIDs.has(n.uuid));
            data.links = data.links.filter(l => !deadUUIDs.has(l.source.uuid) && !deadUUIDs.has(l.target.uuid));
            navHistory = navHistory.filter(n => !deadUUIDs.has(n.uuid));
            slots = slots.map(s => (s && deadUUIDs.has(s.uuid)) ? null : s);
            restartSim();
            return true;
        }
        return false;
    } else {
        executor();
        restartSim();
        return true;
    }
}

// --- Action Handlers ---

function handleSlot(index) {
    const slotNode = slots[index];
    const currentFocus = focusNode;
    if (slotNode === currentFocus) return;
    if (slotNode) {
        const performJump = () => {
            slots[index] = currentFocus;
            navigateTo(slotNode, true, false);
            updateSlotUI();
        };
        if (linkMode.active) {
            performJump();
        } else {
            executeSafeAction(
                () => ({
                    nodes: data.nodes,
                    links: data.links,
                    nextFocus: slotNode,
                    nextSlots: slots.map((s,i) => i===index ? currentFocus : s)
                }),
                performJump
            );
        }
    } else {
        slots[index] = currentFocus; updateSlotUI(); saveToLocal();
    }
}

function clearSlot(index, e) {
    e.preventDefault();
    if(!slots[index]) return;
    executeSafeAction(
            () => ({ nodes: data.nodes, links: data.links, nextFocus: focusNode, nextSlots: slots.map((s,i)=>i===index?null:s) }),
            () => { slots[index] = null; updateSlotUI(); }
    );
}

function handleSlotStore(index) {
    const currentFocus = focusNode;
    if (slots[index] === currentFocus) return;
    executeSafeAction(
        () => ({ nodes: data.nodes, links: data.links, nextFocus: currentFocus, nextSlots: slots.map((s,i)=>i===index?currentFocus:s) }),
        () => { slots[index] = currentFocus; updateSlotUI(); saveToLocal(); }
    );
}

function safeNavigate(targetNode, isHistoryBack = false) {
    if(!targetNode) return;
    if (linkMode.active) {
        navigateTo(targetNode, !isHistoryBack, false);
        return;
    }
    executeSafeAction(
        () => ({ nodes: data.nodes, links: data.links, nextFocus: targetNode, nextSlots: slots }),
        () => { navigateTo(targetNode, !isHistoryBack, false); }
    );
}

function safeDeleteNode(target = null) {
    const nodeToDelete = target || focusNode;
    // 🔴 国际化：使用 t()
    if (nodeToDelete.isRoot) { showFlashMessage(t('alert.rootCannotDelete'), 'warn'); return; }

    let nextFocus = focusNode;
    if (nodeToDelete.uuid === focusNode.uuid) {
        let fallback = navHistory.length > 0 ? navHistory[navHistory.length - 1] : null;
        if (fallback && fallback.uuid === nodeToDelete.uuid) fallback = null;
        if (!fallback) fallback = data.nodes.find(n => n.isRoot);
        nextFocus = fallback;
    }

    executeSafeAction(
        () => ({
            nodes: data.nodes.filter(n => n.uuid !== nodeToDelete.uuid),
            links: data.links.filter(l => l.source.uuid !== nodeToDelete.uuid && l.target.uuid !== nodeToDelete.uuid),
            nextFocus: nextFocus,
            nextSlots: slots.map(s => (s && s.uuid === nodeToDelete.uuid) ? null : s)
        }),
        () => {
            slots = slots.map(s => (s && s.uuid === nodeToDelete.uuid) ? null : s);
            data.links = data.links.filter(l => l.source.uuid !== nodeToDelete.uuid && l.target.uuid !== nodeToDelete.uuid);
            data.nodes = data.nodes.filter(n => n.uuid !== nodeToDelete.uuid);
            if (nodeToDelete.uuid === focusNode.uuid) {
                navigateTo(nextFocus, false, false);
            } else {
                restartSim();
                updateSlotUI();
            }
        }
    );
}

function safeDeleteLink(link) {
    executeSafeAction(
        () => ({ nodes: data.nodes, links: data.links.filter(l => l !== link), nextFocus: focusNode, nextSlots: slots }),
        // 🔴 国际化：使用 t()
        () => { data.links = data.links.filter(l => l !== link); restartSim(); showFlashMessage(t('flash.linkCut'), 'warn'); }
    );
}

function updateSlotUI() {
    for(let i=0; i<4; i++) {
        const el = document.getElementById(`slot-${i+1}`);
        const node = slots[i];
        const circle = el.querySelector('.slot-circle');
        const nameEl = el.querySelector('.slot-name');
        if (node) {
            el.classList.add('active');
            nameEl.innerText = node.label;
            circle.style.background = node.color || DEFAULT_NODE_COLOR;
            circle.style.boxShadow = `0 0 8px ${node.color || DEFAULT_NODE_COLOR}`;
            circle.style.border = "1px solid rgba(255,255,255,0.3)";
        } else {
            el.classList.remove('active');
            nameEl.innerText = "-";
            circle.style.background = "#222";
            circle.style.boxShadow = "none";
            circle.style.border = "1px solid #333";
        }
    }
}

// --- 3. D3 & Render ---
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let width = 0, height = 0;

const simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(d => d.uuid).distance(220).strength(0.1))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("collide", d3.forceCollide(10))
    .force("center", d3.forceCenter(0, 0))
    .alphaDecay(0.05)
    .alphaMin(0.05);

const POINTER_FORCE_STRENGTH = 0.25;
const pointerForce = (() => {
    let node = null; let target = null; let strength = POINTER_FORCE_STRENGTH;
    function force(alpha) {
        if (!node || !target) return;
        const dx = target.x - node.x; const dy = target.y - node.y;
        const dist = Math.hypot(dx, dy);
        const falloff = 1 - Math.exp(-dist / 120);
        const k = strength * falloff * alpha;
        node.vx += dx * k; node.vy += dy * k;
    }
    force.initialize = () => {};
    force.node = function(n) { node = n || null; return force; };
    force.target = function(x, y) { target = (x!=null && y!=null) ? {x, y} : null; return force; };
    force.strength = function(s) { strength = s; return force; };
    return force;
})();
simulation.force('pointerDrag', pointerForce);

function adjustZoomByLayer() {
    const targetK = 1.0 / (Math.pow(viewLayers, 0.7));
    viewK = Math.max(0.15, Math.min(2.5, targetK));
}

function render(currentTime) {
    if (!focusNode || width === 0 || height === 0) {
        animationFrameId = requestAnimationFrame(render);
        return;
    }
    if (!lastRenderTime) lastRenderTime = currentTime;
    const deltaTime = currentTime - lastRenderTime;
    lastRenderTime = currentTime;

    const targetX = width/2; const targetY = height/2;
    viewX += ((-focusNode.x * viewK + targetX) - viewX) * 0.1;
    viewY += ((-focusNode.y * viewK + targetY) - viewY) * 0.1;
    if (keyState['<']) targetRotation += 0.05;
    if (keyState['>']) targetRotation -= 0.05;
    if ((keyState['<'] || keyState['>']) && previewNode) {
        previewNode = null;
        hideTooltip();
    }
    let diff = targetRotation - viewRotation;
    while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    viewRotation += diff * 0.1;

    ctx.save();
    ctx.clearRect(0, 0, width * window.devicePixelRatio, height * window.devicePixelRatio);

    // 应用设备像素比，确保在高 DPI 屏幕上绘制清晰
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // 应用视图变换
    ctx.translate(width/2, height/2);
    ctx.rotate(viewRotation);
    ctx.translate(-width/2, -height/2);
    ctx.translate(viewX, viewY);
    ctx.scale(viewK, viewK);

    const visibleTargets = new Set();
    const visibleLinksTarget = new Set();

    const addNeighbors = (startNode, depth) => {
        if(!startNode) return;
        let queue = [{n: startNode, d: 0}];
        visibleTargets.add(startNode.uuid);
        let head = 0;
        while(head < queue.length) {
            const {n, d} = queue[head++];
            if (d >= depth) continue;
            data.links.forEach(l => {
                const s = l.source, t = l.target;
                if (s.uuid === n.uuid) {
                    if(!visibleTargets.has(t.uuid)) { visibleTargets.add(t.uuid); queue.push({n: t, d: d+1}); }
                    visibleLinksTarget.add(`${s.uuid}-${t.uuid}`);
                } else if (t.uuid === n.uuid) {
                    if(!visibleTargets.has(s.uuid)) { visibleTargets.add(s.uuid); queue.push({n: s, d: d+1}); }
                    visibleLinksTarget.add(`${s.uuid}-${t.uuid}`);
                }
            });
        }
    };

    if (focusNode) addNeighbors(focusNode, viewLayers);
    if (hoverNode && hoverNode !== focusNode) addNeighbors(hoverNode, 1);
    if (previewNode && previewNode !== focusNode) addNeighbors(previewNode, 1);

    const SIMULATION_LAYERS = 7;
    const simulationTargets = new Set();
    const addSimulationNeighbors = (startNode, depth) => {
        if(!startNode) return;
        let queue = [{n: startNode, d: 0}];
        simulationTargets.add(startNode.uuid);
        let head = 0;
        while(head < queue.length) {
            const {n, d} = queue[head++];
            if (d >= depth) continue;
            data.links.forEach(l => {
                const s = l.source, t = l.target;
                if (s.uuid === n.uuid) {
                    if(!simulationTargets.has(t.uuid)) { simulationTargets.add(t.uuid); queue.push({n: t, d: d+1}); }
                } else if (t.uuid === n.uuid) {
                    if(!simulationTargets.has(s.uuid)) { simulationTargets.add(s.uuid); queue.push({n: s, d: d+1}); }
                }
            });
        }
    };
    if (focusNode) addSimulationNeighbors(focusNode, SIMULATION_LAYERS);
    const activeNodes = data.nodes.filter(n => simulationTargets.has(n.uuid));
    const activeLinks = data.links.filter(l => simulationTargets.has(l.source.uuid) && simulationTargets.has(l.target.uuid));
    simulation.nodes(activeNodes);
    simulation.force("link").links(activeLinks);
    // 只在模拟器 alpha 低于某个阈值时才重启，防止频繁重启导致不稳定
    if (simulation.alpha() < simulation.alphaMin() * 2) simulation.alpha(0.3).restart();

    let visibleCount = 0;

    data.links.forEach(link => {
        const key = `${link.source.uuid}-${link.target.uuid}`;
        const keyRev = `${link.target.uuid}-${link.source.uuid}`;
        const isTargetVisible = visibleLinksTarget.has(key) || visibleLinksTarget.has(keyRev);

        // 如果可见，增加透明度；如果不可见，降低透明度 (淡入淡出效果)
        if (isTargetVisible && link.alpha < 1) link.alpha += deltaTime / FADE_DURATION;
        else if (!isTargetVisible && link.alpha > 0) link.alpha -= deltaTime / FADE_DURATION;
        link.alpha = Math.max(0, Math.min(1, link.alpha)); // 限制在 0-1 之间

        if (link.alpha > 0.01) { // 只有足够可见时才绘制
            const src = link.source, tgt = link.target;
            const isFocusLink = (src === focusNode || tgt === focusNode);
            const isHoverLink = (hoverNode && (src === hoverNode || tgt === hoverNode));
            const isPreviewLink = (previewNode && (src === previewNode || tgt === previewNode));

            let linkAlphaMultiplier = 0.2; // 默认亮度
            if (isHoverLink || isPreviewLink) {
                linkAlphaMultiplier = 0.5;
            } else if (isFocusLink) {
                linkAlphaMultiplier = 0.9;
            }

            ctx.globalAlpha = link.alpha * linkAlphaMultiplier;
            ctx.lineWidth = 2.5;
            const typeColor = RELATION_PRESETS.find(p=>p.val===link.type)?.color || '#666';

            const grad = ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y);
            grad.addColorStop(0, typeColor); grad.addColorStop(0.7, "#444"); grad.addColorStop(1, "#222");
            ctx.strokeStyle = grad;
            ctx.beginPath(); ctx.moveTo(src.x, src.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();

            // 绘制连线类型标签
            if (link.type && isFocusLink) {
                    const mx = (src.x+tgt.x)/2, my = (src.y+tgt.y)/2;
                    ctx.save(); ctx.translate(mx, my); ctx.rotate(-viewRotation);
                    ctx.fillStyle = typeColor; ctx.font = "11px Arial"; ctx.textAlign="center";
                    const linkLabel = RELATION_PRESETS.find(p=>p.val===link.type)?.label || link.type;
                    ctx.fillText(linkLabel, 0, -8); ctx.restore();
            }
        }
    });

    // 光晕动画因子
    const pulse = (Math.sin(currentTime * 0.002) + 1) * 0.5 * 20 + 10;

    data.nodes.forEach(node => {
        const isTargetVisible = visibleTargets.has(node.uuid);

        // 节点透明度控制
        if (node === focusNode) node.alpha = 1; // 焦点节点始终完全可见
        else {
            if (isTargetVisible && node.alpha < 1) node.alpha += deltaTime / FADE_DURATION;
            else if (!isTargetVisible && node.alpha > 0) node.alpha -= deltaTime / FADE_DURATION;
            node.alpha = Math.max(0, Math.min(1, node.alpha));
        }

        if (node.alpha > 0.01) { // 只有足够可见时才绘制
            visibleCount++;
            const isSlot = slots.includes(node);
            const isFocus = (node === focusNode);
            const isPreview = (node === previewNode || node === hoverNode);

            ctx.globalAlpha = isFocus ? 1 : node.alpha; // 焦点节点不透明，其他节点按 alpha
            ctx.beginPath();
            let r = isFocus ? 20 : (isSlot ? 14 : 10);
            if (viewK < 0.5) r = r / viewK * 0.5; // 在缩放很小时，节点半径相对变大，保持可见性

            ctx.arc(node.x, node.y, r, 0, 2*Math.PI);
            ctx.fillStyle = node.color || DEFAULT_NODE_COLOR;

            // 阴影/光晕逻辑
            if(isFocus) {
                if (linkMode.active) {
                    // 连线模式下的特殊光晕
                    ctx.shadowBlur = pulse;
                    ctx.shadowColor = linkMode.color || '#fff';
                } else {
                    ctx.shadowBlur = 35; ctx.shadowColor = ctx.fillStyle;
                }
            } else if(isPreview) {
                ctx.shadowBlur = 20; ctx.shadowColor = ctx.fillStyle;
            }

            if (isFocus && linkMode.active) { ctx.strokeStyle = linkMode.color || '#fff'; ctx.lineWidth = 3; ctx.stroke(); }
            if(isSlot && !isFocus) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); }
            ctx.fill(); ctx.shadowBlur=0; ctx.strokeStyle = "transparent"; // 绘制后清除阴影和描边样式

            // 绘制节点标签
            if (isFocus || isPreview || node.alpha > 0.5) { // 只有在焦点/预览或足够可见时才绘制标签
                ctx.save(); ctx.translate(node.x, node.y); ctx.rotate(-viewRotation); // 标签反向旋转，保持文字朝上
                ctx.fillStyle = (isFocus || isPreview) ? "#fff" : "rgba(200,200,200,0.7)";
                ctx.font = (isFocus || isPreview) ? "bold 14px Arial" : "11px Arial";
                ctx.textAlign = "center";
                ctx.fillText(node.label, 0, r + 16); // 标签在节点下方
                const sIdx = slots.indexOf(node);
                if (sIdx >= 0) { // 如果是槽位节点，显示槽位编号
                    ctx.fillStyle = "#4facfe";
                    ctx.font = "bold 11px monospace";
                    ctx.fillText(`[${sIdx+1}]`, 0, -r - 6);
                }
                ctx.restore();
            }
        }
    });
    ctx.restore(); // 恢复 Canvas 状态
    document.getElementById('visible-count').innerText = visibleCount;
    animationFrameId = requestAnimationFrame(render); // 请求下一帧
}


// --- 4. Interaction ---

function getNeighborsWithAngle() {
    const neighbors = [];
    data.links.forEach(l => {
        let other = null; const sId = l.source.uuid, tId = l.target.uuid, fId = focusNode.uuid;
        if(sId === fId) other = l.target; if(tId === fId) other = l.source;
        if(other) {
            const rawAngle = Math.atan2(other.y - focusNode.y, other.x - focusNode.x);
            let visualAngle = rawAngle + viewRotation;
            while(visualAngle > Math.PI) visualAngle -= 2*Math.PI; while(visualAngle <= -Math.PI) visualAngle += 2*Math.PI;
            neighbors.push({ node: other, vAngle: visualAngle, rawAngle: rawAngle });
        }
    });
    neighbors.sort((a,b) => a.vAngle - b.vAngle);
    return neighbors;
}

function cyclePreview(dir) {
    const neighbors = getNeighborsWithAngle();
    if (neighbors.length === 0) return;
    hideTooltip()
    const UP_ANGLE = -Math.PI / 2;
    const EXACT_THRESHOLD = 5 * Math.PI / 180;
    const exactMatch = neighbors.find(n => Math.abs(n.vAngle - UP_ANGLE) < EXACT_THRESHOLD);
    const shouldSkipExact = exactMatch && previewNode && previewNode.uuid === exactMatch.node.uuid;

    if (exactMatch && !shouldSkipExact) {
        previewNode = exactMatch.node;
        setTargetRotation(-Math.PI/2 - exactMatch.rawAngle);
        // 🔴 国际化：使用 t()
        showTooltip(t('tooltip.preview', {label: previewNode.label, summary: previewNode.summary||''}), 0, 0, 'fixed');
        return;
    }

    let targetNode = null;
    if (dir > 0) {
        targetNode = neighbors.find(n => n.vAngle > UP_ANGLE && (!shouldSkipExact || n.node.uuid !== exactMatch.node.uuid));
        if (!targetNode) targetNode = neighbors.find(n => (!shouldSkipExact || !exactMatch || n.node.uuid !== exactMatch.node.uuid));
    } else {
        for (let i = neighbors.length - 1; i >= 0; i--) {
            if (neighbors[i].vAngle < UP_ANGLE && (!shouldSkipExact || neighbors[i].node.uuid !== exactMatch.node.uuid)) {
                targetNode = neighbors[i]; break;
            }
        }
        if (!targetNode) {
            for (let i = neighbors.length - 1; i >= 0; i--) {
                if (!shouldSkipExact || !exactMatch || neighbors[i].node.uuid !== exactMatch.node.uuid) {
                    targetNode = neighbors[i]; break;
                }
            }
        }
    }
    if (targetNode) {
        previewNode = targetNode.node;
        setTargetRotation(-Math.PI/2 - targetNode.rawAngle);
        // 🔴 国际化：使用 t()
        showTooltip(t('tooltip.preview', {label: previewNode.label, summary: previewNode.summary||''}), 0, 0, 'fixed');
    }
}

function setTargetRotation(target) {
    let current = targetRotation; let diff = target - current;
    while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    targetRotation = current + diff;
}

const tooltipEl = document.getElementById('tooltip');
function showTooltip(html, x, y, mode) {
    tooltipEl.innerHTML = html; tooltipEl.style.opacity = 1;
    if (mode === 'mouse') {
        tooltipEl.className = ''; tooltipEl.style.left = (x + 15) + 'px'; tooltipEl.style.top = (y + 15) + 'px'; tooltipEl.style.transform = 'none';
    } else { tooltipEl.className = 'fixed-mode'; }
}
function hideTooltip() {
    tooltipEl.style.opacity = 0; tooltipEl.className = ''; tooltipEl.style.left = ''; tooltipEl.style.top = ''; tooltipEl.style.transform = '';
}

function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = sx - rect.left;
    const canvasY = sy - rect.top;

    let x = canvasX - width/2;
    let y = canvasY - height/2;

    const cos = Math.cos(-viewRotation), sin = Math.sin(-viewRotation);
    let rx = x * cos - y * sin; let ry = x * sin + y * cos;
    return { x: (rx + width/2 - viewX) / viewK, y: (ry + height/2 - viewY) / viewK };
}

// --- Drag & Mouse State ---
const DRAG_HIT_RADIUS2 = 600;
let drag = { active: false, node: null, startSX: 0, startSY: 0, startTime: 0, maxMove: 0 };

function pickNodeAtScreen(sx, sy, alphaThresh = 0.5) {
    const pos = screenToWorld(sx, sy);
    for (let i = data.nodes.length - 1; i >= 0; i--) {
        const n = data.nodes[i];
        if (n.alpha <= alphaThresh) continue;
        const dx = n.x - pos.x, dy = n.y - pos.y;
        if ((dx*dx + dy*dy) < DRAG_HIT_RADIUS2) return n;
    }
    return null;
}

function pickLinkAtScreen(sx, sy) {
    const pos = screenToWorld(sx, sy);
    for (let i = 0; i < data.links.length; i++) {
        const l = data.links[i];
        if (l.alpha < 0.3) continue;
        const x1 = l.source.x, y1 = l.source.y;
        const x2 = l.target.x, y2 = l.target.y;
        const A = x2 - x1, B = y2 - y1;
        const lenSq = A*A + B*B;
        let dist = 0;
        if (lenSq === 0) dist = Math.hypot(pos.x - x1, pos.y - y1);
        else {
            let t = ((pos.x - x1) * A + (pos.y - y1) * B) / lenSq;
            t = Math.max(0, Math.min(1, t));
            dist = Math.hypot(pos.x - (x1 + t * A), pos.y - (y1 + t * B));
        }
        if (dist < 10 / viewK) return l;
    }
    return null;
}

canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    const node = pickNodeAtScreen(e.clientX, e.clientY);
    if (node) { safeDeleteNode(node); return; }
    const link = pickLinkAtScreen(e.clientX, e.clientY);
    if (link) { safeDeleteLink(link); return; }
});

canvas.addEventListener('mousemove', e => {
    if (document.getElementById('content-modal').classList.contains('active') || CustomDialog.overlay.classList.contains('active')) return;
    if (drag.active) {
        const dx = e.clientX - drag.startSX; const dy = e.clientY - drag.startSY;
        drag.maxMove = Math.max(drag.maxMove, Math.hypot(dx, dy));
        if (drag.node) {
            const w = screenToWorld(e.clientX, e.clientY);
            pointerForce.node(drag.node).target(w.x, w.y);
            hoverNode = null; previewNode = null; hideTooltip();
        }
        return;
    }
    const found = pickNodeAtScreen(e.clientX, e.clientY);
    if (found) {
        hoverNode = found; previewNode = null;
        const summaryText = found.summary || '';
        const summaryHtml = typeof marked !== 'undefined' ? marked.parse(summaryText) : summaryText;
        // 🔴 国际化：使用 t()
        showTooltip(`<strong>${found.label}</strong><br>${summaryHtml}<br>${t('tooltip.click')}`, e.clientX, e.clientY, 'mouse');
    } else {
        hoverNode = null;
        if (!previewNode) hideTooltip();
    }
});

canvas.addEventListener('mousedown', e => {
    if (document.getElementById('content-modal').classList.contains('active') || CustomDialog.overlay.classList.contains('active')) return;

    if (e.button === 3) {
            e.preventDefault();
            createIndependentNodeFlow();
            return;
    }
    if (e.button === 4) {
            e.preventDefault();
            enterLinkMode();
            return;
    }
    if (e.button !== 0) return;

    const node = pickNodeAtScreen(e.clientX, e.clientY);
    drag.active = true; drag.node = node || null;
    drag.startSX = e.clientX; drag.startSY = e.clientY;
    drag.startTime = performance.now(); drag.maxMove = 0;
    if (drag.node) {
        const w = screenToWorld(e.clientX, e.clientY);
        pointerForce.node(drag.node).target(w.x, w.y);
        simulation.alphaTarget(0.3).restart();
        hoverNode = null; previewNode = null; hideTooltip();
        canvas.style.cursor = 'grabbing';
    } else {
        relationPicker.close();
    }
});

canvas.addEventListener('mouseup', e => {
    if (e.button !== 0) return;
    if (!drag.active) return;
    const elapsed = performance.now() - drag.startTime;
    const moved = drag.maxMove;
    const node = drag.node;
    if (node) {
        pointerForce.node(null).target(null); simulation.alphaTarget(0);
        saveToLocal(); canvas.style.cursor = 'crosshair';
    }
    if (elapsed < 200 && moved < 8) {
        const target = node || pickNodeAtScreen(e.clientX, e.clientY);
        if (target) {
            if (target !== focusNode) safeNavigate(target);
            else showContentModal();
        };
    }
    drag.active = false; drag.node = null;
});

canvas.addEventListener('wheel', e => { e.preventDefault(); viewK -= e.deltaY * 0.001; viewK = Math.max(0.1, Math.min(5, viewK)); }, { passive: false });

window.addEventListener('keydown', e => {
    // 优先检查 CustomDialog 是否激活，如果是，则不处理后续的全局快捷键
    if (CustomDialog.overlay.classList.contains('active')) {
        return; // Custom dialog is active, let it handle keydowns
    }
    if (modal.classList.contains('active')) return;
    if (CustomDialog.overlay.classList.contains('active')) return; // Custom dialog active
    if (presetEditor.active) {
        if (e.key === 'Escape') presetEditor.close();
        return;
    }
    const tag = e.target.tagName;
    const isInput = (tag === 'INPUT' || tag === 'TEXTAREA');

    if (relationPicker.active) {
            relationPicker.handleInput(e);
            return;
    }

    if (isInput) {
        if (e.key === 'Escape') { e.target.blur(); canvas.focus(); return; }
        if (e.key === 'Enter' && e.target.id === 'node-label') { e.preventDefault(); e.target.blur(); canvas.focus(); return; }
        return;
    }

    keyState[e.key] = true; if (e.shiftKey) keyState['Shift'] = true;

    if (e.key === '`') { e.preventDefault(); presetEditor.open(); return; }

    const isSlotKey = (e.key >= '1' && e.key <= '4');
    const isShiftSymbol = ['!', '@', '#', '$'].includes(e.key);

    if (isShiftSymbol) { handleSlotStore({'!':0, '@':1, '#':2, '$':3}[e.key]); return; }
    if (!e.shiftKey && isSlotKey) { handleSlot(parseInt(e.key) - 1); return; }

    const neighbors = getNeighborsWithAngle();
    switch(e.key) {
        case 'ArrowUp': case '/': if (previewNode) safeNavigate(previewNode); else jumpDirection(-Math.PI/2, neighbors); break;
        case 'ArrowDown': case '?': jumpDirection(Math.PI/2, neighbors); break;
        case 'ArrowLeft': jumpDirection(-Math.PI, neighbors); break;
        case 'ArrowRight': jumpDirection(0, neighbors); break;
        case '.': cyclePreview(1); break; case ',': cyclePreview(-1); break;
        case '=': case '+': viewLayers = Math.max(MIN_VIEW_LAYERS, viewLayers - 1); adjustZoomByLayer(); document.getElementById('layer-indicator').innerText = viewLayers; break;
        case '-': case '_': viewLayers = Math.min(MAX_VIEW_LAYERS, viewLayers + 1); adjustZoomByLayer(); document.getElementById('layer-indicator').innerText = viewLayers; break;

        case 'Tab': case 'n': case 'N':
            e.preventDefault();
            createIndependentNodeFlow();
            break;
        case 'F2': e.preventDefault(); const labelInp = document.getElementById('node-label'); labelInp.focus(); labelInp.select(); break;
        case ' ': e.preventDefault(); const sumInp = document.getElementById('node-summary'); sumInp.focus(); sumInp.select(); break;
        case 'Enter': if(!isInput && focusNode) showContentModal(); break;

        case 'l': case 'L': enterLinkMode(); break;
        case 'e': case 'E': showFlashMessage(t('hud.linkMode'), 'info'); break; // 🔴 国际化：使用 t()
        case 'h': case 'H': const root = data.nodes.find(n=>n.isRoot); if(root) safeNavigate(root); break;
        case 'Escape':
            if (linkMode.active) { exitLinkMode(); }
            break;
        case 'b': case 'B':
            if(navHistory.length) {
                let target = null;
                for(let i = navHistory.length - 1; i >= 0; i--) {
                    if(data.nodes.find(n => n.uuid === navHistory[i].uuid) && navHistory[i].uuid !== focusNode.uuid) { target = navHistory[i]; break; }
                }
                if(target) safeNavigate(target, true);
            }
            break;
        case 'Delete': case 'd': case 'D': safeDeleteNode(); break;
        case 'i': case 'I': e.preventDefault(); hudVisible = !hudVisible; document.getElementById('key-controls').style.display = hudVisible ? 'block' : 'none'; break;
    }
});
window.addEventListener('keyup', e => { keyState[e.key] = false; if(e.key==='Shift') keyState['Shift']=false; });

function jumpDirection(targetAng, neighbors) {
    let best = null, minDiff = Infinity;
    neighbors.forEach(n => {
        let diff = Math.abs(n.vAngle - targetAng); if (diff > Math.PI) diff = 2*Math.PI - diff;
        if (diff < minDiff) { minDiff = diff; best = n.node; }
    });
    if (best && minDiff < 1.2) safeNavigate(best);
}

function navigateTo(node, record, resetRot) {
    if(!node) return;

    if (linkMode.active && linkMode.sourceNode && linkMode.sourceNode.uuid !== node.uuid) {
        executeLinkAction(linkMode.sourceNode, node);
        exitLinkMode(); // 每次链接后退出连线模式
    }

    if(focusNode && record && focusNode !== node) { navHistory.push(focusNode); if(navHistory.length>50) navHistory.shift(); }
    focusNode = node; focusNode.alpha = 1; previewNode = null; hideTooltip();
    if(resetRot) targetRotation = 0;
    updateUI(); saveToLocal();
}

// --- 5. New Link Mode Implementation ---

async function enterLinkMode() {
    if (linkMode.active) return;
    try {
        const result = await relationPicker.show(true);

        linkMode.active = true;
        linkMode.sourceNode = focusNode;
        linkMode.type = result.val;

        if (result.val === 'CUSTOM') {
            // 🔴 国际化：使用 t()
            let customType = await CustomDialog.prompt(t('linkMode.prompt'), t('linkMode.promptPlaceholder'));
            if (!customType) {
                exitLinkMode();
                return;
            }
            const matchedPreset = RELATION_PRESETS.find(p => p.label === customType);
            linkMode.type = matchedPreset ? matchedPreset.val : customType;
            linkMode.customLabel = linkMode.type;
            linkMode.color = '#fff';
        } else if (result.val === 'DELETE') {
            linkMode.color = '#ff4d4d';
        } else {
            const p = RELATION_PRESETS.find(pre => pre.val === result.val);
            linkMode.color = p ? p.color : '#fff';
        }

        updateLinkModeIndicator(); // 更新指示器

    } catch (e) {
       // Cancelled
    }
}

function exitLinkMode() {
    linkMode.active = false;
    linkMode.sourceNode = null;
    linkMode.type = null;
    linkMode.color = null;
    updateLinkModeIndicator(); // 更新指示器
}

function updateLinkModeIndicator() {
    const indicator = document.getElementById('link-mode-indicator');
    if (linkMode.active) {
        // 🔴 国际化：使用 t()
        indicator.innerHTML = t('linkMode.typeIndicator', {color: linkMode.color, type: linkMode.type});
        indicator.classList.add('active');
    } else {
        // 🔴 国际化：使用 t()
        indicator.innerHTML = t('hud.linkMode');
        indicator.classList.remove('active');
    }
}

function executeLinkAction(source, target) {
    const existingLink = data.links.find(l =>
        (l.source.uuid === source.uuid && l.target.uuid === target.uuid) ||
        (l.source.uuid === target.uuid && l.target.uuid === source.uuid)
    );

    if (linkMode.type === 'DELETE') {
        if (existingLink) {
            executeSafeAction(
                () => ({ nodes: data.nodes, links: data.links.filter(l => l !== existingLink), nextFocus: target, nextSlots: slots }),
                // 🔴 国际化：使用 t()
                () => {
                    data.links = data.links.filter(l => l !== existingLink);
                    restartSim();
                    showFlashMessage(t('flash.linkCut'), 'info');
                }
            );
        } else {
            // 🔴 国际化：使用 t()
            showFlashMessage(t('alert.noLinkToBreak'), 'info');
        }
        return;
    }

    if (existingLink) {
        existingLink.type = linkMode.type;
        existingLink.source = source;
        existingLink.target = target;
        restartSim();
    } else {
        data.links.push({ source: source, target: target, type: linkMode.type, alpha: 0 });
        restartSim();
    }
}

function createIndependentNodeFlow() {
    const newNode = {
        uuid: uuid.v4(),
        label: t('fallback.newNode'), // 🔴 国际化：使用 t()
        x: focusNode.x + 150, y: focusNode.y + 50, // 初始位置在焦点节点旁边
        summary: "", content: "", color: getRandomColor(), alpha: 0
    };

    const performCreate = () => {
        data.nodes.push(newNode);
        restartSim();
        navigateTo(newNode, true, false);
        focusTitle();
    };
    if (linkMode.active) {
        performCreate();
    } else {
        executeSafeAction(
            () => ({
                nodes: [...data.nodes, newNode],
                links: data.links,
                nextFocus: newNode,
                nextSlots: slots
            }),
            performCreate
        );
    }
}

function focusTitle() { setTimeout(() => { const el = document.getElementById('node-label'); el.focus(); el.select(); }, 50); }

const modal = document.getElementById('content-modal');
const modalBody = document.getElementById('modal-body');
let activeNodeScriptCleanups = [];
let activeNodeRunTimes = {};
let stopPropagationHandler = e => { e.stopPropagation(); }

function showContentModal() {
    if (!focusNode) return;
    if (activeNodeRunTimes[focusNode.uuid]) {
        activeNodeRunTimes[focusNode.uuid].unmountFn();
        delete activeNodeRunTimes[focusNode.uuid];
    }
    closeContentModal();
    // 🔴 国际化：使用 t()
    const rawMarkdown = focusNode.content || t('modal.noContent');
    const parsedHtml = marked.parse(rawMarkdown);
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = parsedHtml;
    const scriptsToExecute = [];
    const scriptElements = tempDiv.querySelectorAll('script');
    scriptElements.forEach(script => {
        scriptsToExecute.push(script.textContent);
        script.remove();
    });
    modalBody.innerHTML = `
        <div style="font-size:2em; font-weight:bold; color:#4facfe; margin-bottom:10px;">${focusNode.label}</div>
        <div style="color:#666; font-style:italic; margin-bottom:20px; border-left:3px solid #555; padding-left:10px;">
            ${focusNode.summary ? marked.parse(focusNode.summary) : t('modal.noContent')}
        </div>
        <hr style="border:0; border-bottom:1px solid #333; margin-bottom:20px;">
        <div id="node-content-host-${focusNode.uuid}" style="line-height:1.8; font-size:16px;">${tempDiv.innerHTML}</div>
        <div style="margin-top:50px; text-align:center; font-size:12px; color:#444;">${t('modal.close')}</div>
    `;
    if (typeof hljs !== 'undefined') {
        const codeBlocks = modalBody.querySelectorAll('pre code');
        codeBlocks.forEach((block) => {
            hljs.highlightElement(block);
        });
    }
    const nodeContentHost = document.getElementById(`node-content-host-${focusNode.uuid}`);
    if (!nodeContentHost) {
        console.error("无法找到节点内容容器，无法执行脚本。");
        return;
    }
    let nodeUnmountCallbacks = [];
    const NodeRuntime = {
        onMount: function(callback) {
            try { callback(); } catch(e) { console.error("onMount callback error:", e); }
        },
        onUnmount: function(callback) {
            nodeUnmountCallbacks.push(callback);
        },
        storage: {
            _prefix: `node_storage_${focusNode.uuid}_`,
            set: function(key, value) {
                try {
                    localStorage.setItem(this._prefix + key, JSON.stringify(value));
                    return true;
                } catch(e) { console.error("NodeStorage set error:", e); return false; }
            },
            get: function(key, defaultValue = null) {
                try {
                    const item = localStorage.getItem(this._prefix + key);
                    return item ? JSON.parse(item) : defaultValue;
                } catch(e) { console.error("NodeStorage get error:", e); return defaultValue; }
            },
            remove: function(key) {
                localStorage.removeItem(this._prefix + key);
            },
            clear: function() {
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const key = localStorage.key(i);
                    if (key.startsWith(this._prefix)) {
                        localStorage.removeItem(key);
                    }
                }
            }
        },
        hostElement: nodeContentHost,
        $: function(selector) {
            return nodeContentHost.querySelector(selector);
        },
        $$: function(selector) {
            return nodeContentHost.querySelectorAll(selector);
        },
        document: document,
        window: window,
        node: {
            uuid: focusNode.uuid,
            label: focusNode.label,
            color: focusNode.color
        }
    };
    activeNodeRunTimes[focusNode.uuid] = {
        instance: NodeRuntime,
        unmountFn: () => {
            nodeUnmountCallbacks.forEach(callback => {
                try { callback(); } catch(e) { console.error("onUnmount callback error:", e); }
            });
            nodeUnmountCallbacks = [];
        }
    };
    scriptsToExecute.forEach((scriptText, index) => {
        try {
            const wrappedScriptCode = `
                (function(nodeRuntimeApi) {
                    const Runtime = nodeRuntimeApi;
                    ${scriptText}
                })(arguments[0]);
            `;
            const dynamicScriptFunc = new Function('api', wrappedScriptCode);
            dynamicScriptFunc(NodeRuntime);
        } catch (e) {
            console.error(`执行节点脚本 (Node UUID: ${focusNode.uuid}, Index: ${index}) 时出错:`, e, scriptText);
        }
    });
    modal.classList.add('active');
    const closeModalHandler = (e) => {
        if (e.key === 'Escape') {
            closeContentModal();
            e.stopPropagation();
            e.preventDefault();
            window.removeEventListener('keydown', closeModalHandler);
        }
    };
    window.addEventListener('keydown', closeModalHandler);

    modal.addEventListener('click', closeContentModal)
    modalBody.addEventListener('click', stopPropagationHandler);
}

function closeContentModal() {
    modal.classList.remove('active');
    modal.removeEventListener('click', closeContentModal)
    modalBody.removeEventListener('click', stopPropagationHandler);
    if (focusNode && activeNodeRunTimes[focusNode.uuid]) {
        activeNodeRunTimes[focusNode.uuid].unmountFn();
        delete activeNodeRunTimes[focusNode.uuid];
    }
    modalBody.innerHTML = '';
}

function getRandomColor() {
    const h = Math.random(); const s = Math.random(); const v = 1; let r, g, b;
    const i = Math.floor(h * 6); const f = h * 6 - i; const p = v * (1 - s); const q = v * (1 - f * s); const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break; case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break; case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break;
    }
    const toHex = (c) => Math.round(c * 255).toString(16).padStart(2, '0'); return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const ui = {
    label: document.getElementById('node-label'),
    uuid: document.getElementById('node-uuid'),
    linkStatus: document.getElementById('link-status'),
    summary: document.getElementById('node-summary'),
    content: document.getElementById('node-content'),
    colorInput: document.getElementById('node-color-input'),
    colorHex: document.getElementById('node-color-hex')
};

function updateUI() {
    if(!focusNode) return;
    ui.label.value = focusNode.label;
    ui.uuid.innerText = "UUID: " + focusNode.uuid;
    ui.summary.value = focusNode.summary || "";
    ui.content.value = focusNode.content || "";
    ui.colorInput.value = focusNode.color || DEFAULT_NODE_COLOR;
    ui.colorHex.value = focusNode.color || DEFAULT_NODE_COLOR;
    const count = getNodeLinkCount(focusNode.uuid);
    ui.linkStatus.innerText = `Links: ${count}`;
}

function handleEditorTab(e, nextId, prevId) {
    if (e.key === 'Tab') {
        e.preventDefault(); const targetId = e.shiftKey ? prevId : nextId;
        if (targetId) { const el = document.getElementById(targetId); el.focus(); if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.select(); }
    }
}
ui.label.addEventListener('input', () => { if(focusNode) { focusNode.label = ui.label.value; updateSlotUI(); saveToLocalDebounced(); } });
ui.label.addEventListener('keydown', (e) => handleEditorTab(e, 'node-summary', 'node-content'));
ui.summary.addEventListener('input', () => { if(focusNode) { focusNode.summary = ui.summary.value; saveToLocalDebounced(); } });
ui.summary.addEventListener('keydown', (e) => handleEditorTab(e, 'node-content', 'node-label'));
ui.content.addEventListener('input', () => { if(focusNode) { focusNode.content = ui.content.value; saveToLocalDebounced(); } });
ui.content.addEventListener('keydown', (e) => handleEditorTab(e, 'node-label', 'node-summary'));
ui.colorInput.addEventListener('input', () => { if(focusNode) { focusNode.color = ui.colorInput.value; ui.colorHex.value = ui.colorInput.value; saveToLocalDebounced(); updateSlotUI(); } });
ui.colorHex.addEventListener('input', () => {
    if(focusNode && /^#[0-9A-F]{6}$/i.test(ui.colorHex.value)) {
            focusNode.color = ui.colorHex.value; ui.colorInput.value = ui.colorHex.value; saveToLocalDebounced(); updateSlotUI();
    }
});

function restartSim() { simulation.nodes(data.nodes); simulation.force("link").links(data.links); simulation.alpha(1).restart(); saveToLocal(); updateUI(); }

function saveToLocal() {
    const payload = {
        data: {
            nodes: data.nodes.map(n => ({
                uuid: n.uuid, label: n.label, isRoot: n.isRoot,
                x: n.x, y: n.y,
                summary: n.summary, content: n.content, color: n.color
            })),
            links: data.links.map(l => ({
                source: typeof l.source === 'object' ? l.source.uuid : l.source,
                target: typeof l.target === 'object' ? l.target.uuid : l.target,
                type: l.type
            }))
        },
        slots: slots.map(s => s ? s.uuid : null),
        viewLayers: viewLayers,
        presets: RELATION_PRESETS
    };
    vscode.postMessage({
        command: 'saveData',
        data: payload
    });
    console.log("Stars: Sent 'saveData' to Extension.");
    return payload;
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}
const saveToLocalDebounced = debounce(saveToLocal, 1000);

function exportData() { const b = new Blob([JSON.stringify(saveToLocal())], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'stars_data.json'; a.click(); }

function importData(inp) {
    const f = inp.files[0];
    if(f) {
        const r = new FileReader();
        r.onload = e => {
            try {
                const importedData = JSON.parse(e.target.result);
                // 严格校验格式
                if (importedData && importedData.data && Array.isArray(importedData.data.nodes)) {
                    console.log("Stars: Importing data...", importedData);

                    // 1. 先通知后端保存（为了下次打开能记住）
                    vscode.postMessage({ command: 'saveData', data: importedData });

                    // 2. 🔴 关键：直接在前端初始化，不要 reload！
                    // reload 会导致短暂的白屏和状态丢失
                    initSystem(importedData);

                    // 🔴 国际化：使用 t()
                    showFlashMessage(t('alert.importSuccess'));
                } else {
                    // 🔴 国际化：使用 t()
                    showFlashMessage(t('alert.importFail'), 'warn');
                }
            } catch (error) {
                console.error(error);
                // 🔴 国际化：使用 t()
                showFlashMessage(t('alert.parseFail'), 'warn');
            }
        };
        r.readAsText(f);
        // 清空 input，确保同一个文件能再次触发 change 事件
        inp.value = '';
    }
}

const relationPicker = {
    el: document.getElementById('relation-picker'), active: false, resolve: null, reject: null, allowDelete: false,
    show: function(allowDelete = false) {
        this.allowDelete = allowDelete;
        return new Promise((res, rej) => {
            // 🔴 国际化：使用 t()
            const delStr = allowDelete ? t('preset.delete') : '';
            let html = `<div class="menu-title">${t('preset.title', {delStr: delStr})}</div>`;
            const optionsHtml = RELATION_PRESETS.slice(0, 9).map((p, i) => {
                const idxKey = i + 1;
                return `<div class="menu-opt" data-value="${p.val}"><span class="menu-key" style="color:${p.color}">[${idxKey}]</span>${p.label}</div>`;
            }).join('');

            html += optionsHtml;

            if (RELATION_PRESETS.length > 9) {
                html += `<div class="menu-title" style="margin-top:10px;">${t('preset.more')}</div>`; // 🔴 国际化：新增 key "preset.more"
                html += RELATION_PRESETS.slice(9).map((p, i) => {
                    return `<div class="menu-opt" data-value="${p.val}"><span class="menu-key" style="visibility:hidden;">[]</span>${p.label}</div>`;
                }).join('');
            }
            if (allowDelete) {
                // 🔴 国际化：使用 t()
                html += t('preset.deleteOption', {text: t('linkMode.deleteLabel')});
            }

            this.el.innerHTML = html;
            this.el.classList.add('active');
            this.active = true;
            this.resolve = res;
            this.reject = rej;

            const currentPicker = this;
            this.el.querySelectorAll('.menu-opt').forEach(opt => {
                opt.addEventListener('click', () => currentPicker.pick(opt.dataset.value));
            });
        });
    },
    handleInput: function(e) {
        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 1 && num <= Math.min(9, RELATION_PRESETS.length)) {
            e.preventDefault(); this.pick(RELATION_PRESETS[num-1].val);
        }
        else if (e.key === ' ') { e.preventDefault(); this.pick('CUSTOM'); }
        else if (e.key === 'Enter') { e.preventDefault(); if(RELATION_PRESETS.length>0) this.pick(RELATION_PRESETS[0].val); }
        else if (this.allowDelete && (e.key === 'd' || e.key === 'D' || e.key === 'Delete')) { e.preventDefault(); this.pick('DELETE'); }
        else if (e.key === 'Escape') { e.preventDefault(); this.reject(); this.close(); }
    },
    pick: function(val) { this.close(); this.resolve({ val: val }); },
    close: function() {
        this.el.classList.remove('active');
        this.active = false;
        const currentPicker = this;
        this.el.querySelectorAll('.menu-opt').forEach(opt => {
            opt.removeEventListener('click', () => currentPicker.pick(opt.dataset.value));
        });
    }
};

const presetEditor = {
    el: document.getElementById('preset-editor'),
    listEl: document.getElementById('preset-list-container'),
    active: false,
    tempPresets: [],
    open: function() {
        if (this.active) return;
        this.tempPresets = JSON.parse(JSON.stringify(RELATION_PRESETS));
        this.renderList();
        this.el.classList.add('active');
        this.active = true;
    },
    renderList: function() {
        this.listEl.innerHTML = '';
        this.tempPresets.forEach((p, i) => {
            const row = document.createElement('div');
            row.className = 'preset-row';
            row.innerHTML = `
                <span class="preset-idx">${i+1}</span>
                <input type="color" class="preset-color" value="${p.color}" data-idx="${i}" data-field="color">
                <input type="text" class="preset-input" style="width:120px" placeholder="${t('preset.input.label')}" value="${p.label}"
                    data-idx="${i}" data-field="label">
                <input type="text" class="preset-input" style="flex:1; color:#aaa;" placeholder="${t('preset.input.value')}" value="${p.val}"
                    data-idx="${i}" data-field="val">
                <span class="preset-del" data-idx="${i}">✕</span>
            `;
            this.listEl.appendChild(row);
        });

        const currentEditor = this;
        this.listEl.querySelectorAll('.preset-color').forEach(input => {
            input.addEventListener('change', (e) => currentEditor.update(e.target.dataset.idx, e.target.dataset.field, e.target.value));
        });
        this.listEl.querySelectorAll('.preset-input').forEach(input => {
            input.addEventListener('input', (e) => currentEditor.update(e.target.dataset.idx, e.target.dataset.field, e.target.value));
            input.addEventListener('keydown', (e) => currentEditor.handleListKey(e, e.target.dataset.idx, e.target.dataset.field));
        });
        this.listEl.querySelectorAll('.preset-del').forEach(span => {
            span.addEventListener('click', (e) => currentEditor.remove(e.target.dataset.idx));
        });
    },
    handleListKey: function(e, idx, field) { if (e.key === 'Enter') { e.preventDefault(); this.saveAndClose(); } },
    update: function(idx, field, value) { this.tempPresets[idx][field] = value; },
    add: function() {
        // 🔴 国际化：使用 t()
        if (this.tempPresets.length >= 20) { showFlashMessage(t('alert.presetExceedMax'), 'warn'); return; }
        this.tempPresets.push({ label: t('fallback.newNode'), val: 'new_rel', color: getRandomColor() }); // 🔴 国际化：使用 t()
        this.renderList();
        setTimeout(() => this.listEl.scrollTop = this.listEl.scrollHeight, 10);
    },
    remove: function(idx) { this.tempPresets.splice(idx, 1); this.renderList(); },
    saveAndClose: function() {
        // 🔴 国际化：使用 t()
        if (this.tempPresets.some(p => !p.val.trim())) { showFlashMessage(t('alert.presetValueEmpty'), 'warn'); return; }
        const values = this.tempPresets.map(p => p.val.trim());
        if (new Set(values).size !== values.length) { showFlashMessage(t('alert.presetValueDuplicate'), 'warn'); return; }
        RELATION_PRESETS = JSON.parse(JSON.stringify(this.tempPresets));
        saveToLocal(); restartSim(); this.close(); showFlashMessage(t('flash.presetUpdated')); // 🔴 国际化：使用 t()
    },
    close: function() {
        this.el.classList.remove('active');
        this.active = false;
        const currentEditor = this;
        this.listEl.querySelectorAll('.preset-color').forEach(input => {
            input.removeEventListener('change', (e) => currentEditor.update(e.target.dataset.idx, e.target.dataset.field, e.target.value));
        });
        this.listEl.querySelectorAll('.preset-input').forEach(input => {
            input.removeEventListener('input', (e) => currentEditor.update(e.target.dataset.idx, e.target.dataset.field, e.target.value));
            input.removeEventListener('keydown', (e) => currentEditor.handleListKey(e, e.target.dataset.idx, e.target.dataset.field));
        });
        this.listEl.querySelectorAll('.preset-del').forEach(span => {
            span.removeEventListener('click', (e) => currentEditor.remove(e.target.dataset.idx));
        });
    }
};

document.getElementById('save-btn').addEventListener('click', saveToLocal);
document.getElementById('export-btn').addEventListener('click', exportData);
document.getElementById('reset-system-btn').addEventListener('click', resetSystem);
document.getElementById('import-btn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', (e) => importData(e.target));
document.getElementById('manage-presets-btn').addEventListener('click', () => presetEditor.open());

document.getElementById('preset-editor-close-btn').addEventListener('click', () => presetEditor.close());
document.getElementById('add-preset-btn').addEventListener('click', () => presetEditor.add());
document.getElementById('save-presets-btn').addEventListener('click', () => presetEditor.saveAndClose());


let currentSidebarWidth = 340;
document.documentElement.style.setProperty('--sidebar-width', `${currentSidebarWidth}px`);
let isResizing = false;
document.getElementById('sidebar-resizer').addEventListener('mousedown', (e) => { isResizing = true; e.preventDefault(); canvas.style.pointerEvents = 'none'; document.body.style.cursor = 'ew-resize'; });
document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    currentSidebarWidth = Math.max(250, Math.min(newWidth, window.innerWidth * 0.6));
    document.documentElement.style.setProperty('--sidebar-width', `${currentSidebarWidth}px`);
    updateCanvasSize();
});
document.addEventListener('mouseup', () => { if (!isResizing) return; isResizing = false; canvas.style.pointerEvents = 'auto'; document.body.style.cursor = 'default'; });

function updateCanvasSize() {
    const canvasElement = document.getElementById('canvas');
    if (canvasElement) {
        // 获取 canvas 元素的实际 DOM 尺寸
        width = canvasElement.clientWidth;
        height = canvasElement.clientHeight;

        // 设置 canvas 内部绘图缓冲区的尺寸，并考虑设备像素比 (DPR)
        const dpr = window.devicePixelRatio || 1;
        canvasElement.width = width * dpr;
        canvasElement.height = height * dpr;

        // 重置并应用上下文缩放，以确保绘制清晰
        ctx.setTransform(1, 0, 0, 1, 0, 0); // 重置任何之前的变换
        ctx.scale(dpr, dpr); // 应用 DPR 缩放
    }
}

window.addEventListener('resize', updateCanvasSize);


window.onload = () => {
    const canvasElement = document.getElementById('canvas');
    if (!canvasElement) {
        console.error("Stars: Canvas element not found!");
        return;
    }

    // 在 onload 时初始化 canvas 尺寸和上下文
    updateCanvasSize();

    // 请求 Extension 发送数据
    vscode.postMessage({ command: 'ready' });
    console.log("Stars: Webview DOM ready, sent 'ready' command to Extension.");
};
