<script lang="ts">
  import type { EdgeMeta, NodeMeta } from '../core/schema';

  export let node: NodeMeta | null;
  export let edges: EdgeMeta[] = [];
  export let onPatch: (patch: Partial<NodeMeta>) => void;
  export let onRenameLabel: (label: string) => void;
  export let onOpenFile: () => void;
  export let onCreateLinkedNode: () => void;
  export let onDeleteNode: () => void;
  export let onDeleteEdge: (edgeId: string) => void;

  let labelInput: HTMLInputElement;

  export function focusLabel() {
    if (!node) {
      return;
    }

    labelInput?.focus();
    labelInput?.select();
  }

  function handleLabelInput(event: Event) {
    if (node?.file) {
      return;
    }

    onRenameLabel((event.currentTarget as HTMLInputElement).value);
  }

  function handleLabelCommit(event: Event) {
    onRenameLabel((event.currentTarget as HTMLInputElement).value);
  }

  function handleLabelKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      (event.currentTarget as HTMLInputElement).blur();
    }
  }

  function handleSummaryInput(event: Event) {
    const summary = (event.currentTarget as HTMLTextAreaElement).value;
    onPatch({ summary: summary || undefined });
  }

</script>

<aside class="sidebar">
  <input
    bind:this={labelInput}
    class="node-label"
    type="text"
    placeholder="概念名称"
    value={node?.label ?? ''}
    on:input={handleLabelInput}
    on:change={handleLabelCommit}
    on:keydown={handleLabelKeydown}
    disabled={!node}
  />

  <div class="node-id">UUID: {node?.id ?? '-'}</div>

  <textarea
    class="node-summary"
    placeholder="简短摘要（Markdown）"
    value={node?.summary ?? ''}
    on:input={handleSummaryInput}
    disabled={!node}
  ></textarea>

  {#if node?.file}
    <div class="file-panel">
      <div class="panel-title">文件映射</div>
      <code>{node.file.path}</code>
      <div>权重: {node.metrics?.contentLength ?? 0}</div>
    </div>
  {/if}

  <input
    class="meta-input"
    type="text"
    placeholder="节点类型，例如 concept / file / subgraph"
    value={node?.type ?? ''}
    on:input={(event) => onPatch({ type: event.currentTarget.value || undefined })}
    disabled={!node || Boolean(node.file)}
  />

  <div class="color-row">
    <input
      class="node-color"
      type="color"
      value={node?.color ?? '#ffffff'}
      on:input={(event) => onPatch({ color: event.currentTarget.value })}
      disabled={!node}
    />
    <input
      class="color-hex"
      type="text"
      placeholder="#FFFFFF"
      value={node?.color ?? ''}
      on:input={(event) => onPatch({ color: event.currentTarget.value })}
      disabled={!node}
    />
  </div>

  <button class="open-file" on:click={onOpenFile} disabled={!node?.file?.path && !node?.subgraph?.path}>打开节点目标</button>

  <div class="topology-actions">
    <button on:click={onCreateLinkedNode} disabled={!node}>新增关联节点</button>
    <button class="danger" on:click={onDeleteNode} disabled={!node}>删除当前节点</button>
  </div>

  <input
    class="meta-input"
    type="text"
    placeholder="子图路径，例如 .stars/module.graph.json"
    value={node?.subgraph?.path ?? ''}
    on:input={(event) => onPatch({ subgraph: event.currentTarget.value ? { kind: 'subgraph', path: event.currentTarget.value } : undefined })}
    disabled={!node || Boolean(node.file)}
  />

  <div class="meta-panel">
    <div>创建: {node ? new Date(node.createdAt).toLocaleString() : '-'}</div>
    <div>更新: {node ? new Date(node.updatedAt).toLocaleString() : '-'}</div>
  </div>

  <div class="edges-panel">
    <div class="panel-title">关系</div>
    {#if edges.length}
      {#each edges as edge (edge.id)}
        <div class="edge-row">
          <span>{edge.type}</span>
          <code>{edge.sourceId} -> {edge.targetId}</code>
          <button aria-label="删除关系" on:click={() => onDeleteEdge(edge.id)}>删除</button>
        </div>
      {/each}
    {:else}
      <div class="empty-edge">暂无关系</div>
    {/if}
  </div>

  <div class="hint">
    vNext 节点只保存元信息。正文交给 VS Code 文件编辑器；子空间由节点指向另一个图元文件。
  </div>
</aside>

<style>
  .sidebar {
    position: fixed;
    right: 0;
    top: 0;
    width: var(--sidebar-width);
    height: 100vh;
    background: #111114;
    border-left: 1px solid #2a2a30;
    padding: 25px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    z-index: 10;
    box-shadow: -5px 0 20px rgba(0, 0, 0, 0.8);
  }

  .node-label {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 8px;
    color: #4facfe;
    border-bottom: 2px solid #2a2a30;
    padding-bottom: 8px;
  }

  .node-id {
    font-size: 10px;
    color: #444;
    font-family: monospace;
    margin-bottom: 12px;
    user-select: all;
  }

  .node-summary {
    box-sizing: border-box;
    min-height: 70px;
    max-height: 150px;
    margin-bottom: 14px;
    padding: 8px 10px;
    resize: vertical;
    background: #0d0d0f;
    border: 1px solid #222;
    border-radius: 6px;
    color: #aaa;
    font-size: 13px;
    line-height: 1.5;
  }

  .node-summary:focus {
    border-color: #333;
    background: #151518;
  }

  .meta-input {
    font-size: 14px;
    color: #aaa;
    margin-bottom: 14px;
    line-height: 1.5;
    background: #0d0d0f;
    border: 1px solid #222;
    border-radius: 6px;
    padding: 8px 10px;
  }

  .open-file {
    align-self: flex-start;
    margin: -4px 0 10px;
  }

  .topology-actions {
    display: flex;
    gap: 8px;
    margin: -4px 0 16px;
  }

  .danger {
    color: #ff8080;
    border-color: rgba(255, 77, 77, 0.45);
  }

  .color-row {
    display: flex;
    gap: 10px;
    margin-bottom: 20px;
    align-items: center;
  }

  .node-color {
    width: 30px;
    height: 30px;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  .color-hex {
    flex-grow: 1;
    background: #0a0a0c;
    border: 1px solid #222;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    color: #ccc;
    text-transform: uppercase;
  }

  .hint {
    margin-top: auto;
    font-size: 12px;
    line-height: 1.6;
    color: #666;
  }

  .meta-panel,
  .file-panel {
    margin-top: 16px;
    padding: 12px;
    border: 1px solid #222;
    border-radius: 6px;
    background: #0a0a0c;
    font-size: 12px;
    line-height: 1.6;
    color: #666;
  }

  .file-panel {
    margin: 0 0 14px;
  }

  .file-panel code {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #33ffff;
    margin-bottom: 8px;
  }

  .edges-panel {
    margin-top: 14px;
    padding: 12px;
    border: 1px solid #222;
    border-radius: 6px;
    background: #0a0a0c;
  }

  .panel-title {
    margin-bottom: 8px;
    font-size: 12px;
    color: #888;
    font-weight: 700;
  }

  .edge-row {
    display: grid;
    grid-template-columns: 54px 1fr auto;
    gap: 8px;
    align-items: center;
    padding: 7px 0;
    border-top: 1px solid #18181c;
    font-size: 11px;
    color: #777;
  }

  .edge-row code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #555;
  }

  .edge-row button {
    padding: 4px 8px;
  }

  .empty-edge {
    color: #555;
    font-size: 12px;
  }
</style>