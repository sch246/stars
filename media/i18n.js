/**
 * media/i18n.js
 * 简单的翻译字典和辅助函数
 */

const translations = {
    "en": {
        "hud.title": "Stars",
        "hud.viewLayers": "View Range:",
        "hud.layers": "Layers",
        "hud.adjust": "(+/- to adjust)",
        "hud.visible": "Visible:",
        "hud.nodes": "nodes",
        "hud.linkMode": "🔗 Link Mode: Jump to connect / Esc to cancel",
        "hud.controls": `
            <span class="key">L</span> <span class="key">Front Key</span> New Link <span class="key">N</span> New Node <span class="key">Tab</span> New Linked Node<br>
            <span class="key">Del</span> <span class="key">D</span> <span class="key">Right Click</span> Delete Link/Node<br>
            <span class="key">↑↓←→ /?</span> <span class="key">L-Click</span> Move <br>
            <span class="key">F2</span> Rename <span class="key">Space</span> Edit <span class="key">Enter</span> <span class="key">Focus</span> View<br>
            <span class="key">(Shift)1-4</span> Swap(Store) <span class="key">H</span> Home <span class="key">B</span> <span class="key">Back Key</span> Back<br>
            <span class="key">, .</span> Preview Neighbors <span class="key">< ></span> Rotate<br>
            <span class="key">\`</span> Presets <span class="key">I</span> Hide Help
        `,
        "btn.save": "Save",
        "btn.export": "Export",
        "btn.reset": "Reset System",
        "btn.import": "Import",
        "btn.language": "🌐 English",
        "btn.presets": "Manage Presets",
        "sidebar.placeholder.label": "Concept Name",
        "sidebar.placeholder.summary": "Short summary (Markdown/HTML)...",
        "sidebar.placeholder.content": "Detailed notes (Markdown supported)...",
        "modal.noContent": "*No content available*",
        "modal.close": "Press ESC to close",
        "alert.resetConfirm": "Resetting the system will clear all data. Are you sure?",
        "alert.deleteConfirm": "Warning: This action will cause {n} nodes to be lost (e.g., {label}...). Continue?",
        "alert.importSuccess": "Data imported successfully",
        "alert.importFail": "Invalid import file format",
        "alert.parseFail": "Failed to parse imported file.",
        "alert.presetValueEmpty": "Preset 'Value' cannot be empty.",
        "alert.presetValueDuplicate": "Preset 'Value' cannot be duplicated.",
        "alert.presetExceedMax": "Maximum number of presets reached.",
        "alert.noLinkToBreak": "No link to break.",
        "alert.rootCannotDelete": "The root node cannot be deleted.",
        "flash.presetUpdated": "Presets updated.",
        "flash.linkCut": "Link cut.",
        "flash.noHistory": "No more history to navigate back to.",
        "linkMode.prompt": "Enter link relationship name or val:",
        "linkMode.promptPlaceholder": "e.g., contains, defined as...",
        "linkMode.typeIndicator": "🔗 <span style='color:{color};'>Link Mode: {type} (Jump to connect / Esc to cancel)</span>",
        "linkMode.deleteLabel": "Delete/Break Link",
        "preset.title": "1. Select Type <span style='font-weight:normal; color:#888;'>(Space Custom{deleteFragment})</span>",
        "preset.menuTitle": "Preset Relationship Editor",
        "preset.menuDesc": "Define common connection types. Press Enter to save.",
        "preset.btnAdd": "+ Add Preset",
        "preset.btnSave": "Save & Apply",
        "preset.input.label": "Display Name (Label)",
        "preset.input.value": "Data Value (Value)",
        "preset.delete": ", D Delete",
        "preset.more": "More",
        "preset.default.includes": "Includes...",
        "preset.default.definedAs": "Defined as...",
        "preset.default.intuitive": "Intuitive understanding",
        "preset.default.calculates": "Calculates...",
        "preset.default.implies": "Implies...",
        "preset.default.orthogonalTo": "Orthogonal to...",
        "fallback.origin": "Origin",
        "fallback.summary": "Workspace Root",
        "fallback.content": "Welcome to Stars in VSCode. Start exploring!",
        "fallback.newNode": "New Concept",
        "fallback.newRelationship": "New Relationship",
        "dialog.confirm": "Confirm",
        "dialog.cancel": "Cancel",
        "tooltip.preview": "<strong>Preview: {label}</strong><br>{summary}<br><span style='color:#af4cae'>Press <span class=\"key\">↑</span> <span class=\"key\">/</span> to Jump</span>",
        "tooltip.click": "<span style='color:#666'>Click to Jump</span>",
        "tooltip.nodeHover": "<strong>{label}</strong><br>{summary}<br><span style='color:#666'>Click to Jump</span>",
        "status.saved": "Stars: Saved.",
        "status.noWorkspace": "Stars: Please open a folder to save data."
    },
    "zh-cn": {
        "hud.title": "星罗",
        "hud.viewLayers": "视野范围:",
        "hud.layers": "层",
        "hud.adjust": "(按 +/- 调整)",
        "hud.visible": "当前可见:",
        "hud.nodes": "节点",
        "hud.linkMode": "🔗 连线模式: 跳转以连接/Esc 取消",
        "hud.controls": `
            <span class="key">L</span> <span class="key">前侧键</span> 新建关系 <span class="key">N</span> 新建节点 <span class="key">Tab</span> 新建并连接节点<br>
            <span class="key">Del</span> <span class="key">D</span> <span class="key">右键</span> 删除关系/节点<br>
            <span class="key">↑↓←→ /?</span> <span class="key">左键</span> 移动 <br>
            <span class="key">F2</span> 改名 <span class="key">Space</span> 编辑 <span class="key">Enter</span> <span class="key">左键焦点</span> 查看<br>
            <span class="key">(Shift)1-4</span> (存入)交换 <span class="key">H</span> 回家 <span class="key">B</span> <span class="key">后侧键</span> 后退<br>
            <span class="key">, .</span> 预览邻居 <span class="key">< ></span> 自由旋转<br>
            <span class="key">\`</span> 关系预设 <span class="key">I</span> 隐藏此提示
        `,
        "btn.save": "保存",
        "btn.export": "导出",
        "btn.reset": "重置系统",
        "btn.import": "导入",
        "btn.language": "🌐 中文",
        "btn.presets": "预设管理",
        "sidebar.placeholder.label": "概念名称",
        "sidebar.placeholder.summary": "简短摘要 (Markdown/HTML)...",
        "sidebar.placeholder.content": "详细笔记 (Markdown支持)...",
        "modal.noContent": "*暂无正文内容*",
        "modal.close": "按 ESC 关闭",
        "alert.resetConfirm": "重置系统将清空所有数据，确定吗？",
        "alert.deleteConfirm": "警告：此操作将导致 {n} 个节点丢失（如 {label}...）。是否继续？",
        "alert.importSuccess": "数据导入成功",
        "alert.importFail": "导入文件格式不正确",
        "alert.parseFail": "解析导入文件失败。",
        "alert.presetValueEmpty": "预设的“数据值”不能为空。",
        "alert.presetValueDuplicate": "预设的“数据值”不能重复。",
        "alert.presetExceedMax": "预设数量已达上限。",
        "alert.noLinkToBreak": "无连接可断开。",
        "alert.rootCannotDelete": "初始奇点不可删除。",
        "flash.presetUpdated": "预设已更新。",
        "flash.linkCut": "链接已切断。",
        "flash.noHistory": "没有更多历史记录可回退。",
        "linkMode.prompt": "请输入链接关系名称或数据值:",
        "linkMode.promptPlaceholder": "例如: 包含, 定义为...",
        "linkMode.typeIndicator": "🔗 <span style='color:{color};'>连线模式: {type} (跳转以连接/Esc 取消)</span>",
        "linkMode.deleteLabel": "删除/断开连接",
        "preset.title": "1. 选择类型 <span style='font-weight:normal; color:#888;'>(Space 自定义{deleteFragment})</span>",
        "preset.menuTitle": "预设关系编辑器",
        "preset.menuDesc": "定义常用的连接类型。按 Enter 保存。",
        "preset.btnAdd": "+ 新增预设",
        "preset.btnSave": "保存并应用",
        "preset.input.label": "显示名称 (Label)",
        "preset.input.value": "数据值 (Value)",
        "preset.delete": ", D 删除",
        "preset.more": "更多",
        "preset.default.includes": "包含...",
        "preset.default.definedAs": "定义为...",
        "preset.default.intuitive": "直观理解",
        "preset.default.calculates": "计算...",
        "preset.default.implies": "意味着...",
        "preset.default.orthogonalTo": "与...正交",
        "fallback.origin": "起源",
        "fallback.summary": "工作区根节点",
        "fallback.content": "欢迎使用 VSCode 中的星罗系统。",
        "fallback.newNode": "新概念",
        "fallback.newRelationship": "新关系",
        "dialog.confirm": "确定",
        "dialog.cancel": "取消",
        "tooltip.preview": "<strong>预览: {label}</strong><br>{summary}<br><span style='color:#af4cae'>按 <span class=\"key\">↑</span> <span class=\"key\">/</span> 跳转</span>",
        "tooltip.click": "<span style='color:#666'>点击跳转</span>",
        "tooltip.nodeHover": "<strong>{label}</strong><br>{summary}<br><span style='color:#666'>点击跳转</span>",
        "status.saved": "星罗: 已保存。",
        "status.noWorkspace": "星罗: 请先打开一个文件夹以保存数据。"
    }
};

let currentLang = 'en'; // 默认语言

/**
 * 设置当前语言。
 * @param {string} langCode VS Code 返回的语言代码，例如 'en-US', 'zh-cn'。
 */
function setLanguage(langCode) {
    const normalized = langCode.toLowerCase();
    if (normalized.startsWith('zh')) {
        currentLang = 'zh-cn';
    } else {
        currentLang = 'en';
    }
    console.log(`Stars: Language set to ${currentLang} (from ${langCode}).`);
}

/**
 * 获取当前语言。
 * @returns {string} langCode VS Code 返回的语言代码，例如 'en-US', 'zh-cn'。
 */
function getLanguage() {
    return currentLang;
}

/**
 * 获取指定键的翻译文本。
 * @param {string} key 翻译字典中的键。
 * @param {Object} [params={}] 替换占位符的参数对象。例如 {n: 5, label: "Test"} 会替换 {n} 和 {label}。
 * @returns {string} 翻译后的文本。
 */
function t(key, params = {}) {
    const dict = translations[currentLang] || translations['en']; // 如果当前语言没有，则回退到英文
    let str = dict[key] || key; // 如果键不存在，直接返回键名本身

    // 替换占位符
    Object.keys(params).forEach(k => {
        str = str.replace(new RegExp(`{${k}}`, 'g'), params[k]);
    });
    return str;
}

// 确保在 main.js 中可以使用这些函数
window.t = t;
window.setLanguage = setLanguage;
window.getLanguage = getLanguage;
