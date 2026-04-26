<script lang="ts">
  import DismissibleOverlay from './DismissibleOverlay.svelte';

  export let onCreateTypedNode: (type: string, label: string, linkToFocus: boolean) => void;
  export let onCreateFileNode: (path: string) => void;
  export let onClose: () => void;

  let nodeLabel = '新节点';
  let nodeType = 'concept';
  let filePath = '';
  let linkToFocus = true;

  function createNode() {
    onCreateTypedNode(nodeType, nodeLabel, linkToFocus);
  }

  function createFile() {
    const path = filePath.trim();
    if (!path) {
      return;
    }
    onCreateFileNode(path);
    filePath = '';
  }
</script>

<DismissibleOverlay ariaLabel="创建" closeLabel="关闭创建面板" panelClass="create-panel" {onClose}>
  <header>
    <h2>创建</h2>
    <button aria-label="关闭创建面板" on:click={onClose}>×</button>
  </header>

  <label class="check-row">
    <input type="checkbox" bind:checked={linkToFocus} />
    <span>连接到当前焦点</span>
  </label>

  <div class="group">
    <input type="text" placeholder="节点名称" bind:value={nodeLabel} />
    <input type="text" placeholder="节点类型，例如 concept / subgraph" bind:value={nodeType} />
    <button on:click={createNode}>创建节点</button>
  </div>

  <div class="group">
    <input
      type="text"
      placeholder="文件路径，例如 notes/topic.md"
      bind:value={filePath}
      on:keydown={(event) => {
        if (event.key === 'Enter') {
          createFile();
        }
      }}
    />
    <button on:click={createFile} disabled={!filePath.trim()}>创建文件节点</button>
  </div>
</DismissibleOverlay>

<style>
  :global(.create-panel) {
    box-sizing: border-box;
    width: 300px;
    padding: 14px;
    background: rgba(10, 10, 12, 0.96);
    border: 1px solid #2a2a30;
    border-radius: 6px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
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

  .group {
    display: grid;
    gap: 8px;
    margin-top: 12px;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #777;
    font-size: 12px;
  }

  .check-row input {
    width: auto;
  }

  input[type="text"] {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    background: #0d0d0f;
    border: 1px solid #222;
    border-radius: 5px;
    color: #ccc;
  }
</style>
