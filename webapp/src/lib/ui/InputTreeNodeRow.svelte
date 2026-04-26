<script lang="ts">
  import { fade, slide } from 'svelte/transition';
  import type { StarsCommandId } from '../core/preferences';
  import { normalizeInputTrigger, type InputRouteNode } from '../input/inputTree';
  import { COMMANDS, getCommandSignature, getValidCommands, getValidNextTokens } from '../input/inputConstraints';

  export let node: InputRouteNode;
  export let path: number[];
  export let tokenPath: string[] = [];
  export let depth = 0;
  export let collapsedPaths: Set<string> = new Set();
  export let onUpdateTrigger: (path: number[], value: string) => void;
  export let onSetCommand: (path: number[], value: string) => void;
  export let onAddChild: (path: number[]) => void;
  export let onAddSibling: (path: number[]) => void;
  export let onRemove: (path: number[]) => void;
  export let onTurnIntoBranch: (path: number[]) => void;
  export let onTurnIntoCommand: (path: number[], commandId?: string) => void;
  export let onToggleCollapse: (path: number[]) => void;

  let tokenDropdownOpen = false;
  let commandDropdownOpen = false;
  let tokenQuery = node.trigger;

  $: pathKey = path.join('.');
  $: isBranch = Boolean(node.children);
  $: hasChildren = Boolean(node.children?.length);
  $: collapsed = collapsedPaths.has(pathKey);
  $: normalizedTrigger = normalizeInputTrigger(node.trigger);
  $: currentPath = normalizedTrigger ? [...tokenPath, normalizedTrigger] : tokenPath;
  $: availableTokens = [...new Set(getValidNextTokens(tokenPath))];
  $: availableCommands = normalizedTrigger
    ? getValidCommands(currentPath).filter((command, index, commands) => commands.findIndex((item) => item.id === command.id) === index)
    : [];
  $: tokenFilter = normalizeInputTrigger(tokenQuery);
  $: filteredTokens = tokenFilter
    ? availableTokens.filter((token) => token.includes(tokenFilter))
    : availableTokens;
  $: selectedCommand = COMMANDS.find((command) => command.id === node.command);
  $: selectedCommandSignature = selectedCommand ? getCommandSignature(selectedCommand.id) : null;
  $: invalidTrigger = Boolean(node.trigger) && !availableTokens.includes(normalizedTrigger);
  $: invalidCommand = Boolean(node.command) && !availableCommands.some((command) => command.id === node.command);
  $: rowHasError = invalidTrigger || (!isBranch && Boolean(normalizedTrigger) && availableCommands.length === 0) || invalidCommand;
  $: if (!tokenDropdownOpen && tokenQuery !== node.trigger) {
    tokenQuery = node.trigger;
  }

  function openTokenDropdown() {
    tokenDropdownOpen = true;
    commandDropdownOpen = false;
  }

  function toggleCommandDropdown() {
    if (availableCommands.length === 0) {
      return;
    }
    commandDropdownOpen = !commandDropdownOpen;
    tokenDropdownOpen = false;
  }

  function closeDropdowns() {
    tokenDropdownOpen = false;
    commandDropdownOpen = false;
    tokenQuery = node.trigger;
  }

  function handleTokenInput(event: Event) {
    tokenQuery = event.currentTarget.value;
    tokenDropdownOpen = true;
    commandDropdownOpen = false;
  }

  function handleTokenKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDropdowns();
      return;
    }

    if (event.key === 'Enter') {
      const exactMatch = filteredTokens.find((token) => token === normalizeInputTrigger(tokenQuery));
      const fallbackMatch = filteredTokens[0];
      const nextToken = exactMatch ?? fallbackMatch;
      if (!nextToken) {
        return;
      }
      event.preventDefault();
      selectToken(nextToken);
    }
  }

  function selectToken(token: string) {
    tokenQuery = token;
    onUpdateTrigger(path, token);
    tokenDropdownOpen = false;

    const nextPath = [...tokenPath, token];
    const nextCommands = getValidCommands(nextPath);
    if (!isBranch && nextCommands.length === 0) {
      onTurnIntoBranch(path);
      return;
    }

    if (!isBranch && nextCommands.length > 0 && !nextCommands.some((command) => command.id === node.command)) {
      onSetCommand(path, nextCommands[0].id);
    }
  }

  function selectCommand(commandId: StarsCommandId) {
    onSetCommand(path, commandId);
    commandDropdownOpen = false;
  }

  function setAsCommand() {
    onTurnIntoCommand(path, availableCommands[0]?.id);
  }
</script>

{#if tokenDropdownOpen || commandDropdownOpen}
  <button type="button" class="dropdown-backdrop" aria-label="关闭下拉菜单" on:click={closeDropdowns} transition:fade={{ duration: 100 }}></button>
{/if}

<div class="tree-node" transition:slide={{ duration: 130 }}>
  <div class="tree-row" class:is-branch={isBranch} class:has-error={rowHasError}>
    {#if isBranch}
      <button
        class="tree-toggle"
        class:placeholder={!hasChildren}
        disabled={!hasChildren}
        aria-label={collapsed ? '展开输入路由' : '收起输入路由'}
        on:click={() => onToggleCollapse(path)}
      >{hasChildren ? (collapsed ? '›' : '⌄') : '⌄'}</button>
    {:else}
      <span class="tree-leaf" aria-hidden="true">▪</span>
    {/if}

    <div class="token-combobox">
      <input
        class="trigger-input"
        class:invalid={invalidTrigger}
        placeholder="选择 trigger"
        spellcheck="false"
        value={tokenQuery}
        on:focus={openTokenDropdown}
        on:click={openTokenDropdown}
        on:input={handleTokenInput}
        on:keydown={handleTokenKeydown}
      />

      {#if tokenDropdownOpen}
        <div class="dropdown-menu token-menu" transition:fade={{ duration: 100 }}>
          {#if filteredTokens.length > 0}
            {#each filteredTokens as token (token)}
              <button type="button" class="dropdown-item" on:click={() => selectToken(token)}>
                <span>{token}</span>
              </button>
            {/each}
          {:else}
            <div class="dropdown-empty">当前上下文没有可用 trigger</div>
          {/if}
        </div>
      {/if}
    </div>

    {#if isBranch}
      <span class="branch-label">继续匹配下级</span>
    {:else}
      <span class="route-arrow">→</span>
      {#if availableCommands.length > 0}
        <div class="command-combobox">
          <button
            class="dropdown-trigger"
            class:invalid={invalidCommand}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={commandDropdownOpen}
            on:click={toggleCommandDropdown}
          >
            <span>{selectedCommandSignature ?? '选择命令'}</span>
            <span class="caret" aria-hidden="true">⌄</span>
          </button>

          {#if commandDropdownOpen}
            <div class="dropdown-menu command-menu" role="listbox" transition:fade={{ duration: 100 }}>
              {#each availableCommands as command (command.id)}
                <button
                  type="button"
                  class="dropdown-item"
                  class:active={node.command === command.id}
                  role="option"
                  aria-selected={node.command === command.id}
                  on:click={() => selectCommand(command.id)}
                >
                  <span>{getCommandSignature(command.id)}</span>
                  <span class="command-id">{command.label}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else if node.command}
        <span class="error-text">当前命令 {getCommandSignature(node.command as StarsCommandId)} 在这个路径下无效</span>
      {:else}
        <span class="error-text">当前路径尚未完整，不能绑定命令</span>
      {/if}
    {/if}

    <div class="row-actions">
      {#if isBranch}
        <button type="button" title="添加子条件" on:click={() => onAddChild(path)}>+ 分支</button>
        <button type="button" class="warn" title="删除整个子树并转成命令节点" on:click={setAsCommand}>设为命令</button>
      {:else}
        {#if availableTokens.length > 0}
          <button type="button" title="向下拓展子条件" on:click={() => onTurnIntoBranch(path)}>+ 子级</button>
        {/if}
      {/if}
      <button type="button" title="在同层级添加" on:click={() => onAddSibling(path)}>+ 同级</button>
      <button type="button" class="danger" aria-label="删除" title="删除该节点" on:click={() => onRemove(path)}>×</button>
    </div>
  </div>

  {#if isBranch && hasChildren && !collapsed}
    <div class="children-block">
      {#each node.children ?? [] as child, index (`${pathKey}.${index}`)}
        <svelte:self
          node={child}
          path={[...path, index]}
          tokenPath={currentPath}
          depth={depth + 1}
          {collapsedPaths}
          {onUpdateTrigger}
          {onSetCommand}
          {onAddChild}
          {onAddSibling}
          {onRemove}
          {onTurnIntoBranch}
          {onTurnIntoCommand}
          {onToggleCollapse}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-node {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-family: Consolas, 'Cascadia Mono', monospace;
    font-size: 12px;
  }

  .tree-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid transparent;
    position: relative;
    overflow: visible;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .tree-row:hover,
  .tree-row:focus-within {
    background: rgba(255, 255, 255, 0.045);
    border-color: #26262d;
  }

  .tree-row.has-error {
    background: rgba(255, 72, 72, 0.05);
    border-color: rgba(255, 96, 96, 0.22);
  }

  .tree-toggle,
  .tree-leaf {
    width: 22px;
    height: 22px;
    padding: 0;
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
  }

  .tree-toggle {
    color: #7cc7ff;
    border-color: transparent;
    background: transparent;
    font-size: 15px;
  }

  .tree-toggle:hover,
  .tree-toggle:focus {
    border-color: transparent;
    background: transparent;
    color: #9ed6ff;
  }

  .tree-toggle.placeholder {
    opacity: 0.45;
  }

  .tree-leaf {
    color: #555;
    user-select: none;
  }

  .token-combobox,
  .command-combobox {
    position: relative;
    overflow: visible;
  }

  .token-combobox {
    flex: 0 1 170px;
    min-width: 120px;
  }

  .command-combobox {
    flex: 0 1 240px;
    min-width: 180px;
  }

  .trigger-input,
  .dropdown-trigger {
    box-sizing: border-box;
    width: 100%;
    min-height: 30px;
    padding: 6px 9px;
    border-radius: 5px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  }

  .trigger-input {
    background: #0d0d11;
    border: 1px solid #2b2b32;
    color: #62bdff;
  }

  .trigger-input:focus {
    border-color: #4facfe;
    box-shadow: 0 0 0 2px rgba(79, 172, 254, 0.16);
  }

  .trigger-input.invalid,
  .dropdown-trigger.invalid {
    border-color: rgba(255, 96, 96, 0.4);
    box-shadow: 0 0 0 2px rgba(255, 96, 96, 0.12);
  }

  .dropdown-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    background: #111116;
    border: 1px solid #303038;
    color: #d2d2d8;
    cursor: pointer;
    text-align: left;
  }

  .dropdown-trigger:hover,
  .dropdown-trigger:focus {
    background: #16161b;
    border-color: #4b4b56;
  }

  .dropdown-trigger span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    color: #777;
    font-size: 11px;
  }

  .route-arrow {
    color: #555;
    flex: 0 0 auto;
  }

  .branch-label {
    min-width: 0;
    color: #666;
    font-style: italic;
    white-space: nowrap;
  }

  .error-text {
    color: #ff8f8f;
    font-style: italic;
    white-space: nowrap;
  }

  .dropdown-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: transparent;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 100;
    max-height: 260px;
    overflow-y: auto;
    padding: 5px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: linear-gradient(180deg, #141419 0%, #0e0e12 100%);
    border: 1px solid #2e2e37;
    border-radius: 7px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.72);
  }

  .token-menu {
    width: max(100%, 170px);
  }

  .command-menu {
    width: max(100%, 260px);
  }

  .dropdown-menu::-webkit-scrollbar {
    width: 6px;
  }

  .dropdown-menu::-webkit-scrollbar-thumb {
    background: #33333a;
    border-radius: 999px;
  }

  .dropdown-item,
  .dropdown-empty {
    min-height: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 8px;
    border-radius: 5px;
    font-family: inherit;
  }

  .dropdown-item {
    border: 0;
    background: transparent;
    color: #aaa;
    cursor: pointer;
    text-align: left;
  }

  .dropdown-item:hover,
  .dropdown-item:focus {
    background: #1a1a20;
    color: #fff;
  }

  .dropdown-item.active {
    background: rgba(79, 172, 254, 0.15);
    color: #62bdff;
  }

  .dropdown-empty {
    color: #777;
  }

  .command-id {
    color: #5f5f68;
    font-size: 10px;
  }

  .dropdown-item:hover .command-id,
  .dropdown-item:focus .command-id {
    color: #8a8a94;
  }

  .row-actions {
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }

  .tree-row:hover .row-actions,
  .tree-row:focus-within .row-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .row-actions button {
    min-height: 24px;
    padding: 3px 8px;
    border: 1px solid #33333a;
    border-radius: 4px;
    background: #17171c;
    color: #9a9aa3;
    cursor: pointer;
    font-size: 11px;
    white-space: nowrap;
  }

  .row-actions button:hover,
  .row-actions button:focus {
    background: #26262d;
    color: #fff;
  }

  .row-actions button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: #17171c;
    color: #7a7a82;
  }

  .row-actions button.warn:hover,
  .row-actions button.warn:focus {
    border-color: #b9852f;
    background: rgba(255, 170, 0, 0.14);
    color: #ffbd5b;
  }

  .row-actions button.danger:hover,
  .row-actions button.danger:focus {
    border-color: #b94d4d;
    background: rgba(255, 77, 77, 0.14);
    color: #ff8080;
  }

  .children-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 2px 0 4px 19px;
    padding-left: 13px;
    border-left: 1px dashed #292932;
  }

  @media (max-width: 760px) {
    .tree-row {
      flex-wrap: wrap;
    }

    .token-combobox,
    .command-combobox {
      flex: 1 1 180px;
    }

    .row-actions {
      flex: 1 1 100%;
      opacity: 1;
      pointer-events: auto;
      margin-left: 30px;
    }
  }
</style>