<script lang="ts">
  import { DEFAULT_GRAPH_CONFIG } from '../core/defaults';
  import type { GraphConfig } from '../core/schema';
  import { DEFAULT_USER_PREFERENCES } from '../core/preferences';
  import type {
    LinkedFileOpenMode,
    StarsActionId,
    StarsPointerActionId,
    StarsUserPreferences,
  } from '../core/preferences';
  import {
    DEFAULT_INPUT_TREE,
    cloneInputTree,
    getInputRouteCommandBindings,
    normalizeInputTrigger,
    parseInputTreeDsl,
    stringifyInputTreeDsl,
    validateInputTree,
    type InputRouteNode,
    type StarsInputTree,
  } from '../input/inputTree';
  import { getValidCommands } from '../input/inputConstraints';
  import DismissibleOverlay from './DismissibleOverlay.svelte';
  import InputTreeNodeRow from './InputTreeNodeRow.svelte';

  export let config: GraphConfig;
  export let preferences: StarsUserPreferences;
  export let onPatchConfig: (patch: { layout?: Partial<GraphConfig['layout']>; rendering?: Partial<GraphConfig['rendering']> }) => void;
  export let onUpdateInputTree: (inputTree: StarsInputTree) => void;
  export let onUpdateLinkedFileOpenMode: (mode: LinkedFileOpenMode) => void;
  export let onClose: () => void;

  type TabId = 'preferences' | 'physics' | 'rendering' | 'shortcuts' | 'pointer' | 'inputTree';

  let activeTab: TabId = 'preferences';
  let inputTreeError: string | null = null;
  let inputTreeStatus: string | null = null;
  let inputTreeDraft: StarsInputTree = cloneInputTree(preferences.inputTree);
  let inputTreeDslDraft = stringifyInputTreeDsl(inputTreeDraft);
  let inputTreeDslFocused = false;
  let lastPreferenceTree = preferences.inputTree;
  let collapsedInputTreePaths = new Set<string>();

  $: inputTreeIssues = validateInputTree(inputTreeDraft);
  $: commandBindings = getInputRouteCommandBindings(inputTreeDraft);
  $: if (activeTab === 'inputTree' && !inputTreeDslFocused) {
    inputTreeDslDraft = stringifyInputTreeDsl(inputTreeDraft);
  }
  $: if (preferences.inputTree !== lastPreferenceTree) {
    lastPreferenceTree = preferences.inputTree;
    inputTreeDraft = cloneInputTree(preferences.inputTree);
    collapsedInputTreePaths = new Set<string>();
    inputTreeError = null;
    inputTreeStatus = null;
    inputTreeDslDraft = stringifyInputTreeDsl(inputTreeDraft);
    inputTreeDslFocused = false;
  }

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'preferences', label: '偏好' },
    { id: 'physics', label: '物理' },
    { id: 'rendering', label: '渲染' },
    { id: 'shortcuts', label: '快捷键' },
    { id: 'pointer', label: '鼠标' },
    { id: 'inputTree', label: '输入树' },
  ];

  const fileOpenModes: Array<{ value: LinkedFileOpenMode; label: string }> = [
    { value: 'manual', label: '手动打开' },
    { value: 'existingColumn', label: '右侧已有文件栏时切换' },
    { value: 'always', label: '单击总是切换文件栏' },
  ];

  const shortcutActions: Array<{ id: StarsActionId; label: string }> = [
    { id: 'createLinkedNode', label: '创建关联节点' },
    { id: 'deleteSelectedNode', label: '删除焦点节点' },
    { id: 'deleteSelectedLink', label: '删除焦点关系' },
    { id: 'openSelectedFile', label: '打开节点目标' },
    { id: 'editSelectedNode', label: '编辑节点名称' },
    { id: 'navigateBack', label: '返回焦点历史' },
    { id: 'navigateUp', label: '向上跳转' },
    { id: 'navigateDown', label: '向下跳转' },
    { id: 'navigateLeft', label: '向左跳转' },
    { id: 'navigateRight', label: '向右跳转' },
    { id: 'focusRoot', label: '回到根节点' },
    { id: 'togglePreferencesPanel', label: '切换偏好面板' },
    { id: 'toggleCreatePanel', label: '切换创建面板' },
    { id: 'toggleInfoPanel', label: '切换信息提示' },
    { id: 'toggleSidebarPanel', label: '切换右侧侧边栏' },
    { id: 'undo', label: '撤回' },
    { id: 'redo', label: '重做' },
    { id: 'resetGraph', label: '重置图谱' },
  ];

  const pointerActions: Array<{ id: StarsPointerActionId; label: string }> = [
    { id: 'selectNode', label: '选择节点' },
    { id: 'selectLink', label: '选择关系' },
    { id: 'clearFocus', label: '清空焦点' },
    { id: 'rotateCanvas', label: '旋转视角' },
    { id: 'panCanvas', label: '拖动画布' },
    { id: 'dragNode', label: '拖动节点' },
    { id: 'createLink', label: '创建关系' },
    { id: 'deleteNode', label: '删除节点' },
    { id: 'deleteLink', label: '删除关系' },
    { id: 'openNodeTarget', label: '打开节点目标' },
    { id: 'navigateBack', label: '返回焦点历史' },
  ];

  function patchLayout<K extends keyof GraphConfig['layout']>(key: K, value: GraphConfig['layout'][K]) {
    onPatchConfig({ layout: { [key]: value } as Partial<GraphConfig['layout']> });
  }

  function patchRendering<K extends keyof GraphConfig['rendering']>(key: K, value: GraphConfig['rendering'][K]) {
    onPatchConfig({ rendering: { [key]: value } as Partial<GraphConfig['rendering']> });
  }

  function resetLayout<K extends keyof GraphConfig['layout']>(key: K) {
    patchLayout(key, structuredClone(DEFAULT_GRAPH_CONFIG.layout[key]));
  }

  function resetRendering<K extends keyof GraphConfig['rendering']>(key: K) {
    patchRendering(key, structuredClone(DEFAULT_GRAPH_CONFIG.rendering[key]));
  }

  function resetInputTreeDraft() {
    inputTreeError = null;
    inputTreeStatus = null;
    collapsedInputTreePaths = new Set<string>();
    inputTreeDraft = cloneInputTree(preferences.inputTree);
    inputTreeDslDraft = stringifyInputTreeDsl(inputTreeDraft);
    inputTreeDslFocused = false;
  }

  function resetInputTreeToDefault() {
    inputTreeError = null;
    inputTreeStatus = null;
    collapsedInputTreePaths = new Set<string>();
    inputTreeDraft = cloneInputTree(DEFAULT_INPUT_TREE);
    inputTreeDslDraft = stringifyInputTreeDsl(inputTreeDraft);
    inputTreeDslFocused = false;
  }

  function saveInputTreeDraft() {
    const issues = validateInputTree(inputTreeDraft);
    if (issues.length > 0) {
      inputTreeError = issues[0].message;
      return;
    }

    onUpdateInputTree(cloneInputTree(inputTreeDraft));
    inputTreeError = null;
    inputTreeStatus = '输入树已保存';
  }

  function addRootInputRoute() {
    inputTreeDraft.push(createDraftInputRoute());
    touchInputTreeDraft();
  }

  function addInputTreeChild(path: number[]) {
    const node = getInputTreeNode(path);
    if (!node) {
      return;
    }

    delete node.command;
    node.children ??= [];
    node.children.push(createDraftInputRoute());
    collapsedInputTreePaths.delete(getInputTreePathKey(path));
    collapsedInputTreePaths = new Set(collapsedInputTreePaths);
    touchInputTreeDraft();
  }

  function addInputTreeSibling(path: number[]) {
    const siblings = getInputTreeChildren(path.slice(0, -1));
    const index = path.at(-1);
    if (!siblings || index === undefined) {
      return;
    }

    siblings.splice(index + 1, 0, createDraftInputRoute());
    touchInputTreeDraft();
  }

  function removeInputTreeNode(path: number[]) {
    const parentPath = path.slice(0, -1);
    const index = path.at(-1);
    if (index === undefined) {
      return;
    }

    const parentChildren = getInputTreeChildren(parentPath);
    if (!parentChildren) {
      return;
    }

    parentChildren.splice(index, 1);

    if (parentPath.length > 0) {
      const parentNode = getInputTreeNode(parentPath);
      if (parentNode?.children && parentNode.children.length === 0) {
        delete parentNode.children;
        parentNode.command = getValidCommands(getInputTreeTokenPath(parentPath))[0]?.id ?? 'selectNode';
      }
    }

    touchInputTreeDraft();
  }

  function turnInputTreeNodeIntoBranch(path: number[], shouldTouch = true) {
    const node = getInputTreeNode(path);
    if (!node) {
      return;
    }

    delete node.command;
    node.children = node.children?.length ? node.children : [createDraftInputRoute()];
    collapsedInputTreePaths.delete(getInputTreePathKey(path));
    collapsedInputTreePaths = new Set(collapsedInputTreePaths);
    if (shouldTouch) {
      touchInputTreeDraft();
    }
  }

  function turnInputTreeNodeIntoCommand(path: number[], commandId?: string, shouldTouch = true) {
    const node = getInputTreeNode(path);
    if (!node) {
      return;
    }

    delete node.children;
    node.command = commandId ?? getValidCommands(getInputTreeTokenPath(path))[0]?.id ?? 'selectNode';
    collapsedInputTreePaths.delete(getInputTreePathKey(path));
    collapsedInputTreePaths = new Set(collapsedInputTreePaths);
    if (shouldTouch) {
      touchInputTreeDraft();
    }
  }

  function toggleInputTreeCollapse(path: number[]) {
    const pathKey = getInputTreePathKey(path);
    if (collapsedInputTreePaths.has(pathKey)) {
      collapsedInputTreePaths.delete(pathKey);
    } else {
      collapsedInputTreePaths.add(pathKey);
    }
    collapsedInputTreePaths = new Set(collapsedInputTreePaths);
  }

  function getInputTreePathKey(path: number[]): string {
    return path.join('.') || 'root';
  }

  function updateInputTreeTrigger(path: number[], value: string) {
    const node = getInputTreeNode(path);
    if (!node) {
      return;
    }

    const trigger = normalizeInputTrigger(value);
    if (!trigger) {
      inputTreeError = 'trigger 不能为空';
      return;
    }

    node.trigger = trigger;
    inputTreeError = null;
    touchInputTreeDraft();
  }

  function setInputTreeCommand(path: number[], command: string) {
    const node = getInputTreeNode(path);
    if (!node) {
      return;
    }

    if (command) {
      delete node.children;
      node.command = command;
    } else {
      delete node.command;
    }
    touchInputTreeDraft();
  }

  function handleInputTreeDslInput() {
    inputTreeError = null;
    inputTreeStatus = null;
  }

  async function copyInputTreeDsl() {
    try {
      await navigator.clipboard.writeText(inputTreeDslDraft);
      inputTreeStatus = 'DSL 已复制到剪贴板';
      inputTreeError = null;
    } catch {
      inputTreeError = '复制 DSL 失败';
    }
  }

  function resetInputTreeDslDraft() {
    inputTreeDslDraft = stringifyInputTreeDsl(inputTreeDraft);
    inputTreeDslFocused = false;
    inputTreeError = null;
    inputTreeStatus = 'DSL 文本已恢复为当前输入树';
  }

  function importInputTreeDslDraft() {
    try {
      const parsedTree = parseInputTreeDsl(inputTreeDslDraft);
      const issues = validateInputTree(parsedTree);
      if (issues.length > 0) {
        inputTreeError = `${issues[0].path}: ${issues[0].message}`;
        inputTreeStatus = null;
        return;
      }

      inputTreeDraft = parsedTree;
      collapsedInputTreePaths = new Set<string>();
      inputTreeDslFocused = false;
      inputTreeDslDraft = stringifyInputTreeDsl(parsedTree);
      inputTreeError = null;
      inputTreeStatus = 'DSL 已导入到输入树';
    } catch (error) {
      inputTreeError = error instanceof Error ? error.message : '导入 DSL 失败';
      inputTreeStatus = null;
    }
  }

  function getInputTreeTokenPath(path: number[]): string[] {
    const tokens: string[] = [];
    let children = inputTreeDraft;

    for (const index of path) {
      const node = children[index];
      if (!node) {
        break;
      }
      const trigger = normalizeInputTrigger(node.trigger);
      if (trigger) {
        tokens.push(trigger);
      }
      children = node.children ?? [];
    }

    return tokens;
  }

  function getInputTreeNode(path: number[]): InputRouteNode | null {
    let children = inputTreeDraft;
    let node: InputRouteNode | undefined;

    for (const index of path) {
      node = children[index];
      if (!node) {
        return null;
      }
      children = node.children ?? [];
    }

    return node ?? null;
  }

  function getInputTreeChildren(path: number[]): InputRouteNode[] | null {
    if (path.length === 0) {
      return inputTreeDraft;
    }

    const node = getInputTreeNode(path);
    return node?.children ?? null;
  }

  function createDraftInputRoute(): InputRouteNode {
    return { trigger: '' };
  }

  function touchInputTreeDraft() {
    inputTreeStatus = null;
    inputTreeDraft = structuredClone(inputTreeDraft);
  }

  function stringifyCommandBindings(commandId: string): string {
    return commandBindings[commandId]?.join(', ') ?? '未绑定';
  }
</script>

<DismissibleOverlay ariaLabel="偏好设置" closeLabel="关闭偏好面板" panelClass="settings-panel" {onClose}>
    <header>
      <h2>偏好</h2>
      <button aria-label="关闭偏好面板" on:click={onClose}>×</button>
    </header>

    <nav class="tabs" aria-label="偏好分类">
      {#each tabs as tab (tab.id)}
        <button class:active={activeTab === tab.id} on:click={() => (activeTab = tab.id)}>{tab.label}</button>
      {/each}
    </nav>

    <div class="content">
      {#if activeTab === 'preferences'}
        <div class="section">
          <div class="section-actions">
            <button on:click={() => onUpdateLinkedFileOpenMode(DEFAULT_USER_PREFERENCES.linkedFileOpenMode)}>重置偏好</button>
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>文件节点单击</span>
              <button on:click={() => onUpdateLinkedFileOpenMode(DEFAULT_USER_PREFERENCES.linkedFileOpenMode)}>重置</button>
            </div>
            <select
              value={preferences.linkedFileOpenMode}
              on:change={(event) => onUpdateLinkedFileOpenMode(event.currentTarget.value as LinkedFileOpenMode)}
            >
              {#each fileOpenModes as mode (mode.value)}
                <option value={mode.value}>{mode.label}</option>
              {/each}
            </select>
          </div>
        </div>
      {:else if activeTab === 'physics'}
        <div class="section">
          <div class="section-actions">
            <button on:click={() => onPatchConfig({ layout: structuredClone(DEFAULT_GRAPH_CONFIG.layout) })}>重置物理</button>
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>连线距离 {config.layout.linkDistance}</span>
              <button on:click={() => resetLayout('linkDistance')}>重置</button>
            </div>
            <input type="range" min="80" max="420" step="10" value={config.layout.linkDistance} on:change={(event) => patchLayout('linkDistance', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>斥力 {config.layout.chargeStrength}</span>
              <button on:click={() => resetLayout('chargeStrength')}>重置</button>
            </div>
            <input type="range" min="-420" max="-20" step="10" value={config.layout.chargeStrength} on:change={(event) => patchLayout('chargeStrength', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>斥力距离 {config.layout.chargeDistanceMax}</span>
              <button on:click={() => resetLayout('chargeDistanceMax')}>重置</button>
            </div>
            <input type="range" min="600" max="4000" step="100" value={config.layout.chargeDistanceMax} on:change={(event) => patchLayout('chargeDistanceMax', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>碰撞边距 {config.layout.collisionPadding}</span>
              <button on:click={() => resetLayout('collisionPadding')}>重置</button>
            </div>
            <input type="range" min="0" max="40" step="1" value={config.layout.collisionPadding} on:change={(event) => patchLayout('collisionPadding', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>速度衰减 {config.layout.velocityDecay}</span>
              <button on:click={() => resetLayout('velocityDecay')}>重置</button>
            </div>
            <input type="range" min="0.05" max="0.8" step="0.01" value={config.layout.velocityDecay} on:change={(event) => patchLayout('velocityDecay', event.currentTarget.valueAsNumber)} />
          </div>
        </div>
      {:else if activeTab === 'rendering'}
        <div class="section">
          <div class="section-actions">
            <button on:click={() => onPatchConfig({ rendering: structuredClone(DEFAULT_GRAPH_CONFIG.rendering) })}>重置渲染</button>
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>空点半径 {config.rendering.baseNodeRadius}</span>
              <button on:click={() => resetRendering('baseNodeRadius')}>重置</button>
            </div>
            <input type="range" min="2" max="18" step="1" value={config.rendering.baseNodeRadius} on:change={(event) => patchRendering('baseNodeRadius', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>权重缩放 {config.rendering.contentLengthDivisor}</span>
              <button on:click={() => resetRendering('contentLengthDivisor')}>重置</button>
            </div>
            <input type="range" min="4" max="200" step="2" value={config.rendering.contentLengthDivisor} on:change={(event) => patchRendering('contentLengthDivisor', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>聚焦半径 {config.rendering.focusRadius}</span>
              <button on:click={() => resetRendering('focusRadius')}>重置</button>
            </div>
            <input type="range" min="8" max="42" step="1" value={config.rendering.focusRadius} on:change={(event) => patchRendering('focusRadius', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>邻近范围 {config.rendering.proximityRange}</span>
              <button on:click={() => resetRendering('proximityRange')}>重置</button>
            </div>
            <input type="range" min="80" max="600" step="10" value={config.rendering.proximityRange} on:change={(event) => patchRendering('proximityRange', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>关系命中距离 {config.rendering.linkHoverDistance}</span>
              <button on:click={() => resetRendering('linkHoverDistance')}>重置</button>
            </div>
            <input type="range" min="4" max="24" step="1" value={config.rendering.linkHoverDistance} on:change={(event) => patchRendering('linkHoverDistance', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>节点最大放大 {config.rendering.maxNodeScaleMultiplier}</span>
              <button on:click={() => resetRendering('maxNodeScaleMultiplier')}>重置</button>
            </div>
            <input type="range" min="1" max="8" step="0.25" value={config.rendering.maxNodeScaleMultiplier} on:change={(event) => patchRendering('maxNodeScaleMultiplier', event.currentTarget.valueAsNumber)} />
          </div>
        </div>
      {:else if activeTab === 'shortcuts'}
        <div class="section shortcuts-section">
          <div class="shortcut-rows">
            {#each shortcutActions as action (action.id)}
              <div class="shortcut-row">
                <span>{action.label}</span>
                <code>{stringifyCommandBindings(action.id)}</code>
              </div>
            {/each}
          </div>
        </div>
      {:else if activeTab === 'pointer'}
        <div class="section pointer-section">
          <div class="shortcut-rows">
            {#each pointerActions as action (action.id)}
              <div class="shortcut-row">
                <span>{action.label}</span>
                <code>{stringifyCommandBindings(action.id)}</code>
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div class="section input-tree-section">
          <div class="section-actions">
            <button on:click={addRootInputRoute}>添加根条件</button>
            <button on:click={saveInputTreeDraft} disabled={inputTreeIssues.length > 0}>保存输入树</button>
            <button on:click={resetInputTreeDraft}>放弃更改</button>
            <button on:click={resetInputTreeToDefault}>重置默认</button>
          </div>
          <div class="input-tree-editor">
            {#each inputTreeDraft as node, index (index)}
              <InputTreeNodeRow
                {node}
                path={[index]}
                tokenPath={[]}
                depth={0}
                collapsedPaths={collapsedInputTreePaths}
                onUpdateTrigger={updateInputTreeTrigger}
                onSetCommand={setInputTreeCommand}
                onAddChild={addInputTreeChild}
                onAddSibling={addInputTreeSibling}
                onRemove={removeInputTreeNode}
                onTurnIntoBranch={turnInputTreeNodeIntoBranch}
                onTurnIntoCommand={turnInputTreeNodeIntoCommand}
                onToggleCollapse={toggleInputTreeCollapse}
              />
            {/each}
          </div>
          {#if inputTreeError}
            <div class="inline-error">{inputTreeError}</div>
          {/if}
          {#if inputTreeStatus}
            <div class="inline-note">{inputTreeStatus}</div>
          {/if}
          {#each inputTreeIssues as issue (`${issue.path}:${issue.message}`)}
            <div class="inline-error">{issue.path}: {issue.message}</div>
          {/each}
          <div class="input-tree-dsl-panel">
            <div class="control-heading">
              <span>DSL 批量编辑（导入 / 导出）</span>
              <div class="input-tree-dsl-actions">
                <button on:click={copyInputTreeDsl}>复制文本</button>
                <button on:click={importInputTreeDslDraft}>应用 DSL</button>
                <button on:click={resetInputTreeDslDraft}>覆盖为当前树</button>
              </div>
            </div>
            <textarea
              class="input-tree-dsl"
              class:error={Boolean(inputTreeError)}
              spellcheck="false"
              bind:value={inputTreeDslDraft}
              on:focus={() => (inputTreeDslFocused = true)}
              on:blur={() => (inputTreeDslFocused = false)}
              on:input={handleInputTreeDslInput}
            ></textarea>
          </div>
        </div>
      {/if}
    </div>
</DismissibleOverlay>

<style>
  :global(.settings-panel) {
    box-sizing: border-box;
    width: min(720px, calc(100vw - var(--sidebar-width) - 64px));
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 72px);
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    background: rgba(10, 10, 12, 0.97);
    border: 1px solid #2a2a30;
    border-radius: 7px;
    box-shadow: 0 18px 42px rgba(0, 0, 0, 0.56);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid #202026;
  }

  h2 {
    margin: 0;
    font-size: 13px;
    color: #aaa;
  }

  header button {
    padding: 2px 8px;
    font-size: 16px;
  }

  .tabs {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid #202026;
    overflow-x: auto;
  }

  .tabs button {
    min-width: 66px;
    border-color: transparent;
    background: transparent;
  }

  .tabs button.active {
    color: #ffffff;
    background: #202026;
    border-color: #3a3a42;
  }

  .content {
    min-height: 0;
    overflow: auto;
  }

  .section {
    display: grid;
    gap: 12px;
    padding: 16px;
  }

  .section-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .control-row {
    display: grid;
    gap: 6px;
    color: #777;
    font-size: 11px;
  }

  .control-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .control-heading button {
    padding: 4px 8px;
    font-size: 10px;
  }

  input,
  select {
    box-sizing: border-box;
    width: 100%;
    background: #0d0d0f;
    border: 1px solid #222;
    border-radius: 5px;
    color: #ccc;
  }

  select {
    padding: 7px 8px;
  }

  .inline-error {
    color: #ff8080;
    font-size: 11px;
  }

  .inline-note {
    color: #7cc7ff;
    font-size: 11px;
  }

  input[type="range"] {
    accent-color: #4facfe;
  }

  .shortcut-rows {
    display: grid;
    gap: 8px;
  }

  .shortcut-row {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    color: #777;
    font-size: 11px;
  }

  .shortcut-row code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #c8d7ff;
    font-family: Consolas, 'Cascadia Mono', monospace;
  }

  .input-tree-editor {
    display: grid;
    gap: 2px;
    padding: 4px;
    border: 1px solid #202026;
    border-radius: 5px;
    background: #0b0b0d;
  }

  .input-tree-dsl {
    box-sizing: border-box;
    width: 100%;
    min-height: 220px;
    resize: vertical;
    padding: 10px;
    border: 1px solid #222;
    border-radius: 5px;
    background: #08080a;
    color: #aaa;
    font-family: Consolas, 'Cascadia Mono', monospace;
    font-size: 11px;
    line-height: 1.45;
  }

  .input-tree-dsl.error {
    border-color: #ff4d4d;
    background: rgba(255, 0, 0, 0.05);
  }

  .input-tree-dsl-panel {
    display: grid;
    gap: 8px;
  }

  .input-tree-dsl-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  @media (max-width: 860px) {
    :global(.settings-panel) {
      width: min(640px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
    }

    .shortcut-row {
      grid-template-columns: 1fr;
    }

  }
</style>
