<script lang="ts">
  import { DEFAULT_GRAPH_CONFIG } from '../core/defaults';
  import type { GraphConfig } from '../core/schema';
  import { DEFAULT_KEYMAP, DEFAULT_USER_PREFERENCES } from '../core/preferences';
  import type { LinkedFileOpenMode, StarsActionId, StarsKeyBinding, StarsUserPreferences } from '../core/preferences';
  import DismissibleOverlay from './DismissibleOverlay.svelte';

  export let config: GraphConfig;
  export let preferences: StarsUserPreferences;
  export let onPatchConfig: (patch: { layout?: Partial<GraphConfig['layout']>; rendering?: Partial<GraphConfig['rendering']> }) => void;
  export let onUpdateBinding: (actionId: StarsActionId, binding: StarsKeyBinding) => void;
  export let onResetKeymap: () => void;
  export let onUpdateLinkedFileOpenMode: (mode: LinkedFileOpenMode) => void;
  export let onClose: () => void;

  type TabId = 'preferences' | 'physics' | 'rendering' | 'shortcuts';

  let activeTab: TabId = 'preferences';

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'preferences', label: '偏好' },
    { id: 'physics', label: '物理' },
    { id: 'rendering', label: '渲染' },
    { id: 'shortcuts', label: '快捷键' },
  ];

  const fileOpenModes: Array<{ value: LinkedFileOpenMode; label: string }> = [
    { value: 'manual', label: '手动打开' },
    { value: 'existingColumn', label: '右侧已有文件栏时切换' },
    { value: 'always', label: '单击总是切换文件栏' },
  ];

  const shortcutActions: Array<{ id: StarsActionId; label: string }> = [
    { id: 'createLinkedNode', label: '创建关联节点' },
    { id: 'deleteSelectedNode', label: '删除焦点目标' },
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

  function resetBinding(actionId: StarsActionId) {
    onUpdateBinding(actionId, structuredClone(DEFAULT_KEYMAP[actionId]));
  }

  function stringifyBinding(binding: StarsKeyBinding | undefined): string {
    return Array.isArray(binding) ? binding.join(', ') : binding ?? '';
  }

  function parseBinding(value: string): StarsKeyBinding {
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
    return parts.length <= 1 ? parts[0] ?? '' : parts;
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
              <span>关系命中距离 {config.rendering.edgeHoverDistance}</span>
              <button on:click={() => resetRendering('edgeHoverDistance')}>重置</button>
            </div>
            <input type="range" min="4" max="24" step="1" value={config.rendering.edgeHoverDistance} on:change={(event) => patchRendering('edgeHoverDistance', event.currentTarget.valueAsNumber)} />
          </div>
          <div class="control-row">
            <div class="control-heading">
              <span>节点最大放大 {config.rendering.maxNodeScaleMultiplier}</span>
              <button on:click={() => resetRendering('maxNodeScaleMultiplier')}>重置</button>
            </div>
            <input type="range" min="1" max="8" step="0.25" value={config.rendering.maxNodeScaleMultiplier} on:change={(event) => patchRendering('maxNodeScaleMultiplier', event.currentTarget.valueAsNumber)} />
          </div>
        </div>
      {:else}
        <div class="section shortcuts-section">
          <div class="section-actions">
            <button on:click={onResetKeymap}>重置快捷键</button>
          </div>
          <div class="shortcut-rows">
            {#each shortcutActions as action (action.id)}
              <div class="shortcut-row">
                <span>{action.label}</span>
                <input
                  type="text"
                  value={stringifyBinding(preferences.keymap[action.id])}
                  on:change={(event) => onUpdateBinding(action.id, parseBinding(event.currentTarget.value))}
                />
                <button on:click={() => resetBinding(action.id)}>重置</button>
              </div>
            {/each}
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

  .control-heading button,
  .shortcut-row button {
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

  select,
  input[type="text"] {
    padding: 7px 8px;
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
    grid-template-columns: 150px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    color: #777;
    font-size: 11px;
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
