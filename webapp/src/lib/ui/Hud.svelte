<script lang="ts">
  export let nodeCount = 0;
  export let linkCount = 0;
  export let revision = 0;
  export let selectedLabel = '-';
  export let saving = false;
  export let showInfo = true;
  export let onTogglePreferences: () => void;
  export let onReset: () => void;
</script>

{#if showInfo}
  <div class="hud-info">
    <h1>星罗 <span>VS Code / Svelte</span></h1>
    <div class="meta-block">
      <div>当前节点: <strong>{selectedLabel}</strong></div>
      <div>节点总数: <strong>{nodeCount}</strong></div>
      <div>关系总数: <strong>{linkCount}</strong></div>
      <div>修订号: <strong>{revision}</strong></div>
      <div>存储模式: <strong>VS Code 图元文件 / IndexedDB 备用</strong></div>
      <div>写入状态: <strong>{saving ? '保存中' : '空闲'}</strong></div>
    </div>
  </div>
{/if}

<div class="hud-actions">
  <button on:click={onTogglePreferences}>偏好</button>
  <button on:click={onReset}>重置图谱</button>
</div>

<style>
  .hud-info,
  .hud-actions {
    position: fixed;
    left: 25px;
    z-index: 5;
    pointer-events: auto;
    opacity: 0.94;
  }

  .hud-info {
    top: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .hud-actions {
    bottom: 20px;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  h1 {
    margin: 0;
    font-size: 18px;
    color: #555;
    letter-spacing: 2px;
    text-transform: uppercase;
  }

  h1 span {
    font-size: 10px;
    opacity: 0.5;
  }

  .meta-block {
    font-size: 12px;
    color: #888;
    line-height: 1.6;
    font-family: monospace;
  }

  strong {
    color: #4facfe;
  }

  button {
    align-self: flex-start;
  }
</style>