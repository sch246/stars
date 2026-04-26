# 目录代码导出

> 导出目录: `E:\code\stars\webapp\src`

## `app.css`

```css
:root {
  color-scheme: dark;
  --bg: #050508;
  --panel: #111114;
  --panel-soft: #161619;
  --panel-ink: #0a0a0c;
  --line: #2a2a30;
  --line-soft: #222;
  --text: #ddd;
  --muted: #777;
  --accent: #4facfe;
  --warn: #ff4d4d;
  --sidebar-width: 340px;
  font-family: 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
}

html,
body,
#app {
  margin: 0;
  width: 100%;
  min-height: 100%;
  background: var(--bg);
}

body {
  overflow: hidden;
}

button,
input,
textarea {
  font: inherit;
}

button {
  background: #1a1a1d;
  color: var(--muted);
  border: 1px solid #333;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 11px;
  border-radius: 3px;
  transition: background 0.2s, color 0.2s, border-color 0.2s;
}

button:hover {
  background: #333;
  color: #fff;
  border-color: #555;
}

input,
textarea {
  width: 100%;
  border: none;
  outline: none;
  color: #eee;
  background: transparent;
  display: block;
}

input::placeholder,
textarea::placeholder {
  color: #444;
  font-style: italic;
}
```

## `App.svelte`

```
<script lang="ts">
  import { get } from 'svelte/store';
  import { onMount, tick } from 'svelte';
  import { isStarsActionId, type StarsActionId, type StarsUserPreferences } from './lib/core/preferences';
  import { getFocusToken, resolveKeyboardInputTreeAction, type StarsInputTree } from './lib/input/inputTree';
  import CanvasStage from './lib/ui/CanvasStage.svelte';
  import CreatePanel from './lib/ui/CreatePanel.svelte';
  import Hud from './lib/ui/Hud.svelte';
  import PreferencesPanel from './lib/ui/PreferencesPanel.svelte';
  import Sidebar from './lib/ui/Sidebar.svelte';
  import { createGraphController } from './lib/stores/graph';

  type GraphController = ReturnType<typeof createGraphController> & {
    focusRoot: () => void;
    updateGraphConfig: (patch: Parameters<ReturnType<typeof createGraphController>['updateGraphConfig']>[0]) => void;
    renameSelectedNodeLabel: (label: string) => Promise<void>;
    importWorkspaceFile: (pathOrUri: string) => Promise<void>;
    createFileNode: (path: string) => Promise<void>;
    createTypedNode: (type: string, label: string, linkToFocus?: boolean) => void;
    updateInputTree: (inputTree: StarsInputTree) => Promise<void>;
    updateLinkedFileOpenMode: (mode: StarsUserPreferences['linkedFileOpenMode']) => Promise<void>;
  };

  const controller = createGraphController() as GraphController;
  const document = controller.document;
  const selectedNode = controller.selectedNode;
  const selectedEdge = controller.selectedEdge;
  const selectedEdges = controller.selectedEdges;
  const preferences = controller.preferences;
  const ready = controller.ready;
  const saving = controller.saving;
  const error = controller.error;
  let canvasStage: CanvasStage;
  let sidebar: Sidebar;
  let showCreatePanel = false;
  let showPreferencesPanel = false;
  let showHudInfo = true;
  let showSidebar = true;

  const getDocument = () => get(document);

  function runAction(actionId: StarsActionId) {
    switch (actionId) {
      case 'createLinkedNode':
        controller.createLinkedNode();
        break;
      case 'deleteSelectedNode':
        controller.deleteFocusedTarget();
        break;
      case 'openSelectedFile':
        void controller.openSelectedTarget();
        break;
      case 'editSelectedNode':
        showSidebar = true;
        void tick().then(() => sidebar?.focusLabel());
        break;
      case 'navigateBack':
        controller.navigateBack();
        break;
      case 'navigateUp':
        canvasStage?.navigateDirection(-Math.PI / 2, false);
        break;
      case 'navigateDown':
        canvasStage?.navigateDirection(Math.PI / 2, false);
        break;
      case 'navigateLeft':
        canvasStage?.navigateDirection(Math.PI, false);
        break;
      case 'navigateRight':
        canvasStage?.navigateDirection(0, false);
        break;
      case 'focusRoot':
        controller.focusRoot();
        break;
      case 'togglePreferencesPanel':
        showPreferencesPanel = !showPreferencesPanel;
        break;
      case 'toggleCreatePanel':
        showCreatePanel = !showCreatePanel;
        break;
      case 'toggleInfoPanel':
        showHudInfo = !showHudInfo;
        break;
      case 'toggleSidebarPanel':
        showSidebar = !showSidebar;
        break;
      case 'undo':
        controller.undo();
        break;
      case 'redo':
        controller.redo();
        break;
      case 'resetGraph':
        void controller.reset();
        break;
    }
  }

  onMount(() => {
    void controller.hydrate();

    const onKeydown = (event: KeyboardEvent) => {
      const actionId = resolveKeyboardInputTreeAction(event, get(preferences).inputTree, getFocusToken(get(document).view));
      if (!isStarsActionId(actionId)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      runAction(actionId);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data?.command === 'graphChanged' && event.data.document) {
        controller.replaceFromHost(event.data.document);
      }

      if (event.data?.command === 'activeWorkspaceFileChanged' && event.data.path) {
        controller.selectLinkedFile(event.data.path);
      }

      if (event.data?.command === 'preferencesChanged' && event.data.preferences) {
        controller.replacePreferences(event.data.preferences as StarsUserPreferences);
      }
    };

    window.addEventListener('keydown', onKeydown, { capture: true });
    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('keydown', onKeydown, { capture: true });
      window.removeEventListener('message', onMessage);
    };
  });
</script>

<div class="app-shell" style:--sidebar-width={showSidebar ? '340px' : '0px'}>
  <CanvasStage
    bind:this={canvasStage}
    getDocument={getDocument}
    inputTree={$preferences.inputTree}
    onSelectNode={controller.selectNode}
    onSelectEdge={controller.selectEdge}
    onClearFocus={controller.clearFocus}
    onCreateEdge={controller.createEdge}
    onDeleteNode={controller.deleteNode}
    onDeleteEdge={controller.deleteEdge}
    onOpenNode={controller.openNodeTarget}
    onNavigateBack={controller.navigateBack}
    onImportFile={(pathOrUri) => void controller.importWorkspaceFile(pathOrUri)}
  />
  <Hud
    nodeCount={Object.keys($document.graph.nodes).length}
    edgeCount={Object.keys($document.graph.edges).length}
    revision={$document.graph.revision}
    selectedLabel={$selectedNode?.label ?? ($selectedEdge ? `关系: ${$selectedEdge.label ?? $selectedEdge.type}` : '-')}
    saving={$saving}
    showInfo={showHudInfo}
    onTogglePreferences={() => (showPreferencesPanel = !showPreferencesPanel)}
    onReset={controller.reset}
  />
  {#if showSidebar}
    <Sidebar
      bind:this={sidebar}
      node={$selectedNode}
      edges={$selectedEdges}
      onPatch={controller.updateSelectedNode}
      onRenameLabel={(label: string) => void controller.renameSelectedNodeLabel(label)}
      onOpenFile={controller.openSelectedTarget}
      onCreateLinkedNode={controller.createLinkedNode}
      onDeleteNode={controller.deleteFocusedTarget}
      onDeleteEdge={controller.deleteEdge}
    />
  {/if}

  {#if showCreatePanel}
    <CreatePanel
      onCreateTypedNode={controller.createTypedNode}
      onCreateFileNode={(path: string) => void controller.createFileNode(path)}
      onClose={() => (showCreatePanel = false)}
    />
  {/if}

  {#if showPreferencesPanel}
    <PreferencesPanel
      config={$document.graph.config}
      preferences={$preferences}
      onPatchConfig={controller.updateGraphConfig}
      onUpdateInputTree={(inputTree: StarsInputTree) => void controller.updateInputTree(inputTree)}
      onUpdateLinkedFileOpenMode={(mode) => void controller.updateLinkedFileOpenMode(mode)}
      onClose={() => (showPreferencesPanel = false)}
    />
  {/if}

  {#if !$ready}
    <div class="overlay">正在载入图元文件…</div>
  {/if}

  {#if $error}
    <div class="error-banner">{$error}</div>
  {/if}
</div>

<style>
  .app-shell {
    position: relative;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: #050508;
  }

  .overlay {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(5, 5, 8, 0.72);
    color: #4facfe;
    font-family: monospace;
    font-size: 13px;
    letter-spacing: 1px;
    z-index: 20;
  }

  .error-banner {
    position: fixed;
    left: 24px;
    bottom: 20px;
    max-width: calc(100vw - var(--sidebar-width) - 48px);
    background: rgba(255, 0, 0, 0.14);
    color: #ff8080;
    border: 1px solid rgba(255, 77, 77, 0.5);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12px;
    z-index: 15;
  }
</style>
```

## `main.ts`

```typescript
import { mount } from 'svelte';
import App from './App.svelte';
import './app.css';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
```

## `vite-env.d.ts`

```typescript
/// <reference types="vite/client" />
```

## `lib\core\defaults.ts`

```typescript
import type { EdgeTypeDefinition, GraphConfig, GraphDocument, GraphFile, NodeTypeDefinition } from './schema';

const now = () => Date.now();

export const DEFAULT_NODE_TYPES: Record<string, NodeTypeDefinition> = {
  concept: {
    id: 'concept',
    label: '概念',
    style: {
      color: '#4facfe',
      radius: 3,
      labelVisible: 'auto',
    },
  },
  file: {
    id: 'file',
    label: '文件',
    style: {
      color: '#33ffff',
      radius: 4,
      labelVisible: 'auto',
    },
  },
  subgraph: {
    id: 'subgraph',
    label: '子空间',
    style: {
      color: '#bd00ff',
      radius: 5,
      labelVisible: 'auto',
    },
  },
};

export const DEFAULT_EDGE_TYPES: Record<string, EdgeTypeDefinition> = {
  related: {
    id: 'related',
    label: '关联',
    style: {
      color: '#666666',
      width: 1.5,
      labelVisible: 'hover',
      arrow: 'none',
    },
  },
  dependsOn: {
    id: 'dependsOn',
    label: '依赖',
    style: {
      color: '#ffaa00',
      width: 1.8,
      dash: [6, 4],
      labelVisible: 'hover',
      arrow: 'target',
    },
  },
};

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
  layout: {
    engine: 'force',
    linkDistance: 220,
    linkStrength: 0.1,
    chargeStrength: -180,
    chargeDistanceMax: 2500,
    collisionPadding: 0,
    collisionStrength: 0.9,
    centerStrength: 0.001,
    alphaFloor: 0.1,
    alphaDecay: 0.0228,
    velocityDecay: 0.4,
  },
  rendering: {
    baseNodeRadius: 3,
    contentLengthDivisor: 10,
    degreeRadiusBoost: 0,
    minNodePixelSize: 3,
    minFocusNodePixelSize: 6,
    focusRadius: 20,
    proximityRange: 300,
    hoverStopRange: 30,
    edgeHoverDistance: 10,
    maxNodeScaleMultiplier: 4,
    maxTextScaleMultiplier: 2,
    baseLabelFontSize: 11,
    minLabelPixelSize: 5,
    labelZoomThreshold: 1,
    dimmedOpacity: 0.3,
    relatedOpacity: 0.7,
    pulseSpeed: 0.002,
  },
  behaviors: {
    defaults: {
      primary: 'selectNode',
      open: 'noop',
      hover: 'noop',
    },
    nodeTypes: {
      file: {
        primary: 'selectNode',
        open: 'openLinkedFile',
      },
      subgraph: {
        primary: 'selectNode',
        open: 'enterSubgraph',
      },
    },
  },
};

export function createInitialGraph(): GraphFile {
  const createdAt = now();
  const rootNodeId = 'origin-root';

  return {
    format: 'stars.graph.v1',
    graphId: 'main',
    revision: 0,
    rootNodeId,
    nodes: {
      [rootNodeId]: {
        id: rootNodeId,
        label: '起源',
        summary: '工作区根节点',
        type: 'concept',
        color: '#ffffff',
        createdAt,
        updatedAt: createdAt,
      },
    },
    edges: {},
    adjacency: {
      [rootNodeId]: [],
    },
    nodeTypes: DEFAULT_NODE_TYPES,
    edgeTypes: DEFAULT_EDGE_TYPES,
    config: structuredClone(DEFAULT_GRAPH_CONFIG),
    meta: {
      createdAt,
      updatedAt: createdAt,
    },
  };
}

export function createInitialDocument(): GraphDocument {
  const graph = createInitialGraph();

  return {
    graph,
    view: {
      selectedNodeId: graph.rootNodeId,
      selectedEdgeId: null,
      sidebarWidth: 340,
    },
  };
}
```

## `lib\core\markdown.ts`

```typescript
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderSummaryMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .split(/\n{2,}/)
    .map((block) => renderBlock(block.trim()))
    .join('');
}

function renderBlock(block: string): string {
  const lines = block.split(/\n/);
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    const items = lines
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .map((line) => `<li>${renderInline(line)}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  }

  return `<p>${renderInline(lines.join('\n')).replace(/\n/g, '<br>')}</p>`;
}

function renderInline(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
      const safeHref = sanitizeHref(href);
      return safeHref ? `<a href="${safeHref}">${label}</a>` : label;
    });
}

function sanitizeHref(href: string): string {
  if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) {
    return escapeHtml(href);
  }

  return '';
}
```

## `lib\core\operations.ts`

```typescript
import type { EdgeId, EdgeMeta, GraphConfig, GraphFile, NodeId, NodeMeta, WorkspaceFileRef, SubgraphRef } from './schema';

export type GraphConfigPatch = {
  layout?: Partial<GraphConfig['layout']>;
  rendering?: Partial<GraphConfig['rendering']>;
  behaviors?: GraphConfig['behaviors'];
};

export type GraphOperation =
  | { kind: 'createNode'; node: NodeMeta }
  | { kind: 'restoreNode'; node: NodeMeta; edges: EdgeMeta[] }
  | { kind: 'deleteNode'; nodeId: NodeId; deletedNode?: NodeMeta; deletedEdges?: EdgeMeta[] }
  | { kind: 'patchNode'; nodeId: NodeId; patch: Partial<Pick<NodeMeta, 'label' | 'summary' | 'type' | 'color' | 'file' | 'subgraph' | 'metrics'>>; previous?: Partial<NodeMeta> }
  | { kind: 'createEdge'; edge: EdgeMeta }
  | { kind: 'deleteEdge'; edgeId: EdgeId; deletedEdge?: EdgeMeta }
  | { kind: 'attachFile'; nodeId: NodeId; file: WorkspaceFileRef; previous?: WorkspaceFileRef }
  | { kind: 'detachFile'; nodeId: NodeId; previous?: WorkspaceFileRef }
  | { kind: 'attachSubgraph'; nodeId: NodeId; subgraph: SubgraphRef; previous?: SubgraphRef }
  | { kind: 'detachSubgraph'; nodeId: NodeId; previous?: SubgraphRef }
  | { kind: 'patchGraphConfig'; patch: GraphConfigPatch; previous?: GraphConfigPatch };

export interface AppliedGraphOperation {
  graph: GraphFile;
  inverse: GraphOperation;
}

export class GraphOperationConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphOperationConflict';
  }
}

export function applyGraphOperation(graph: GraphFile, operation: GraphOperation): AppliedGraphOperation {
  const draft = structuredClone(graph) as GraphFile;
  const inverse = applyToDraft(draft, operation);
  draft.revision += 1;
  draft.meta.updatedAt = Date.now();

  return {
    graph: draft,
    inverse,
  };
}

function applyToDraft(graph: GraphFile, operation: GraphOperation): GraphOperation {
  switch (operation.kind) {
    case 'createNode': {
      if (graph.nodes[operation.node.id]) {
        throw new GraphOperationConflict(`节点已存在: ${operation.node.id}`);
      }

      graph.nodes[operation.node.id] = operation.node;
      graph.adjacency[operation.node.id] = [];
      return { kind: 'deleteNode', nodeId: operation.node.id };
    }

    case 'restoreNode': {
      if (graph.nodes[operation.node.id]) {
        throw new GraphOperationConflict(`节点已存在: ${operation.node.id}`);
      }

      graph.nodes[operation.node.id] = operation.node;
      graph.adjacency[operation.node.id] = [];
      operation.edges.forEach((edge) => {
        if (!graph.nodes[edge.sourceId] || !graph.nodes[edge.targetId]) {
          throw new GraphOperationConflict(`无法恢复关系，端点不存在: ${edge.id}`);
        }
        graph.edges[edge.id] = edge;
        addAdjacency(graph, edge.sourceId, edge.id);
        addAdjacency(graph, edge.targetId, edge.id);
      });

      return { kind: 'deleteNode', nodeId: operation.node.id };
    }

    case 'deleteNode': {
      const node = graph.nodes[operation.nodeId];
      if (!node) {
        throw new GraphOperationConflict(`节点不存在: ${operation.nodeId}`);
      }
      if (operation.nodeId === graph.rootNodeId) {
        throw new GraphOperationConflict('不能删除根节点');
      }

      const incidentEdges = Object.values(graph.edges).filter((edge) => {
        return edge.sourceId === operation.nodeId || edge.targetId === operation.nodeId;
      });

      incidentEdges.forEach((edge) => removeEdge(graph, edge.id));
      delete graph.nodes[operation.nodeId];
      delete graph.adjacency[operation.nodeId];

      return { kind: 'restoreNode', node, edges: incidentEdges };
    }

    case 'patchNode': {
      const node = graph.nodes[operation.nodeId];
      if (!node) {
        throw new GraphOperationConflict(`节点不存在: ${operation.nodeId}`);
      }

      const previous: Partial<NodeMeta> = {};
      Object.keys(operation.patch).forEach((key) => {
        const typedKey = key as keyof typeof operation.patch;
        previous[typedKey] = node[typedKey] as never;
      });

      Object.assign(node, operation.patch, { updatedAt: Date.now() });
      return { kind: 'patchNode', nodeId: operation.nodeId, patch: previous };
    }

    case 'createEdge': {
      if (graph.edges[operation.edge.id]) {
        throw new GraphOperationConflict(`关系已存在: ${operation.edge.id}`);
      }
      if (!graph.nodes[operation.edge.sourceId]) {
        throw new GraphOperationConflict(`关系起点不存在: ${operation.edge.sourceId}`);
      }
      if (!graph.nodes[operation.edge.targetId]) {
        throw new GraphOperationConflict(`关系终点不存在: ${operation.edge.targetId}`);
      }

      graph.edges[operation.edge.id] = operation.edge;
      addAdjacency(graph, operation.edge.sourceId, operation.edge.id);
      addAdjacency(graph, operation.edge.targetId, operation.edge.id);
      return { kind: 'deleteEdge', edgeId: operation.edge.id };
    }

    case 'deleteEdge': {
      const edge = graph.edges[operation.edgeId];
      if (!edge) {
        throw new GraphOperationConflict(`关系不存在: ${operation.edgeId}`);
      }

      removeEdge(graph, operation.edgeId);
      return { kind: 'createEdge', edge };
    }

    case 'attachFile': {
      const node = requireNode(graph, operation.nodeId);
      const previous = node.file;
      node.file = operation.file;
      node.updatedAt = Date.now();
      return previous
        ? { kind: 'attachFile', nodeId: node.id, file: previous }
        : { kind: 'detachFile', nodeId: node.id };
    }

    case 'detachFile': {
      const node = requireNode(graph, operation.nodeId);
      const previous = node.file;
      if (!previous) {
        throw new GraphOperationConflict(`节点未关联文件: ${operation.nodeId}`);
      }
      delete node.file;
      node.updatedAt = Date.now();
      return { kind: 'attachFile', nodeId: node.id, file: previous };
    }

    case 'attachSubgraph': {
      const node = requireNode(graph, operation.nodeId);
      const previous = node.subgraph;
      node.subgraph = operation.subgraph;
      node.updatedAt = Date.now();
      return previous
        ? { kind: 'attachSubgraph', nodeId: node.id, subgraph: previous }
        : { kind: 'detachSubgraph', nodeId: node.id };
    }

    case 'detachSubgraph': {
      const node = requireNode(graph, operation.nodeId);
      const previous = node.subgraph;
      if (!previous) {
        throw new GraphOperationConflict(`节点未关联子图: ${operation.nodeId}`);
      }
      delete node.subgraph;
      node.updatedAt = Date.now();
      return { kind: 'attachSubgraph', nodeId: node.id, subgraph: previous };
    }

    case 'patchGraphConfig': {
      const previous = collectPreviousConfig(graph.config, operation.patch);
      graph.config = mergeGraphConfig(graph.config, operation.patch);
      return { kind: 'patchGraphConfig', patch: previous };
    }
  }
}

function collectPreviousConfig(config: GraphConfig, patch: GraphConfigPatch): GraphConfigPatch {
  return {
    layout: patch.layout ? pickExisting(config.layout, patch.layout) : undefined,
    rendering: patch.rendering ? pickExisting(config.rendering, patch.rendering) : undefined,
    behaviors: patch.behaviors ? structuredClone(config.behaviors) : undefined,
  };
}

function mergeGraphConfig(config: GraphConfig, patch: GraphConfigPatch): GraphConfig {
  return {
    ...config,
    layout: {
      ...config.layout,
      ...(patch.layout ?? {}),
    },
    rendering: {
      ...config.rendering,
      ...(patch.rendering ?? {}),
    },
    behaviors: patch.behaviors ?? config.behaviors,
  };
}

function pickExisting<T extends object>(source: T, patch: Partial<T>): Partial<T> {
  const previous: Partial<T> = {};
  (Object.keys(patch) as Array<keyof T>).forEach((key) => {
    previous[key] = source[key];
  });
  return previous;
}

function requireNode(graph: GraphFile, nodeId: NodeId): NodeMeta {
  const node = graph.nodes[nodeId];
  if (!node) {
    throw new GraphOperationConflict(`节点不存在: ${nodeId}`);
  }
  return node;
}

function addAdjacency(graph: GraphFile, nodeId: NodeId, edgeId: EdgeId) {
  graph.adjacency[nodeId] ??= [];
  if (!graph.adjacency[nodeId].includes(edgeId)) {
    graph.adjacency[nodeId].push(edgeId);
  }
}

function removeEdge(graph: GraphFile, edgeId: EdgeId) {
  const edge = graph.edges[edgeId];
  if (!edge) {
    return;
  }

  graph.adjacency[edge.sourceId] = (graph.adjacency[edge.sourceId] ?? []).filter((id) => id !== edgeId);
  graph.adjacency[edge.targetId] = (graph.adjacency[edge.targetId] ?? []).filter((id) => id !== edgeId);
  delete graph.edges[edgeId];
}
```

## `lib\core\preferences.ts`

```typescript
import { DEFAULT_INPUT_TREE, cloneInputTree, sanitizeInputTree, type StarsInputTree } from '../input/inputTree';

export type StarsActionId =
  | 'createLinkedNode'
  | 'deleteSelectedNode'
  | 'openSelectedFile'
  | 'editSelectedNode'
  | 'navigateBack'
  | 'navigateUp'
  | 'navigateDown'
  | 'navigateLeft'
  | 'navigateRight'
  | 'focusRoot'
  | 'togglePreferencesPanel'
  | 'toggleCreatePanel'
  | 'toggleInfoPanel'
  | 'toggleSidebarPanel'
  | 'undo'
  | 'redo'
  | 'resetGraph';

export type LinkedFileOpenMode = 'manual' | 'existingColumn' | 'always';

export type StarsPointerActionId =
  | 'selectNode'
  | 'selectEdge'
  | 'clearFocus'
  | 'rotateCanvas'
  | 'panCanvas'
  | 'dragNode'
  | 'createEdge'
  | 'deleteTarget'
  | 'openNodeTarget'
  | 'navigateBack';

export type StarsCommandId = StarsActionId | StarsPointerActionId;

export type PointerTarget = 'background' | 'node' | 'link' | 'any';
export type PointerButton = 'left' | 'right' | 'middle' | 'back' | 'forward';
export type PointerModifier = 'shift' | 'ctrl' | 'alt' | 'meta';

export interface PointerTargetRef {
  kind: PointerTarget;
  id?: string;
}

export interface StarsUserPreferences {
  inputTree: StarsInputTree;
  linkedFileOpenMode: LinkedFileOpenMode;
}

export const STARS_ACTION_IDS: StarsActionId[] = [
  'createLinkedNode',
  'deleteSelectedNode',
  'openSelectedFile',
  'editSelectedNode',
  'navigateBack',
  'navigateUp',
  'navigateDown',
  'navigateLeft',
  'navigateRight',
  'focusRoot',
  'togglePreferencesPanel',
  'toggleCreatePanel',
  'toggleInfoPanel',
  'toggleSidebarPanel',
  'undo',
  'redo',
  'resetGraph',
];

export const STARS_POINTER_ACTION_IDS: StarsPointerActionId[] = [
  'selectNode',
  'selectEdge',
  'clearFocus',
  'rotateCanvas',
  'panCanvas',
  'dragNode',
  'createEdge',
  'deleteTarget',
  'openNodeTarget',
  'navigateBack',
];

export const DEFAULT_USER_PREFERENCES: StarsUserPreferences = {
  inputTree: cloneInputTree(DEFAULT_INPUT_TREE),
  linkedFileOpenMode: 'existingColumn',
};

export function mergeUserPreferences(preferences: Partial<StarsUserPreferences> | null | undefined): StarsUserPreferences {
  return {
    inputTree: sanitizeInputTree(preferences?.inputTree),
    linkedFileOpenMode: isLinkedFileOpenMode(preferences?.linkedFileOpenMode)
      ? preferences.linkedFileOpenMode
      : DEFAULT_USER_PREFERENCES.linkedFileOpenMode,
  };
}

export function isLinkedFileOpenMode(value: unknown): value is LinkedFileOpenMode {
  return value === 'manual' || value === 'existingColumn' || value === 'always';
}

export function isStarsActionId(value: string | null | undefined): value is StarsActionId {
  return Boolean(value && STARS_ACTION_IDS.includes(value as StarsActionId));
}

export function isStarsPointerActionId(value: string | null | undefined): value is StarsPointerActionId {
  return Boolean(value && STARS_POINTER_ACTION_IDS.includes(value as StarsPointerActionId));
}
```

## `lib\core\schema.ts`

```typescript
export type GraphFormat = 'stars.graph.v1';
export type NodeId = string;
export type EdgeId = string;
export type NodeTypeId = string;
export type EdgeTypeId = string;

export interface WorkspaceFileRef {
  kind: 'workspace-file';
  path: string;
}

export interface SubgraphRef {
  kind: 'subgraph';
  path: string;
}

export interface NodeMeta {
  id: NodeId;
  label: string;
  summary?: string;
  type?: NodeTypeId;
  color?: string;
  file?: WorkspaceFileRef;
  subgraph?: SubgraphRef;
  metrics?: {
    contentLength?: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface EdgeMeta {
  id: EdgeId;
  sourceId: NodeId;
  targetId: NodeId;
  type: EdgeTypeId;
  label?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NodeTypeStyle {
  color?: string;
  radius?: number;
  labelVisible?: 'always' | 'hover' | 'focus' | 'auto';
}

export interface EdgeTypeStyle {
  color?: string;
  width?: number;
  dash?: number[];
  labelVisible?: 'always' | 'hover' | 'focus' | 'never';
  arrow?: 'none' | 'target' | 'source' | 'both';
}

export interface NodeTypeDefinition {
  id: NodeTypeId;
  label: string;
  style: NodeTypeStyle;
}

export interface EdgeTypeDefinition {
  id: EdgeTypeId;
  label: string;
  style: EdgeTypeStyle;
}

export type GraphTargetAction = 'selectNode' | 'openLinkedFile' | 'enterSubgraph' | 'noop';

export interface GraphTargetActionBindings {
  hover?: GraphTargetAction;
  primary?: GraphTargetAction;
  open?: GraphTargetAction;
}

export interface GraphBehaviorConfig {
  defaults?: GraphTargetActionBindings;
  nodeTypes?: Record<NodeTypeId, GraphTargetActionBindings>;
  edgeTypes?: Record<EdgeTypeId, GraphTargetActionBindings>;
}

export interface GraphConfig {
  layout: {
    engine: 'force';
    linkDistance: number;
    linkStrength: number;
    chargeStrength: number;
    chargeDistanceMax: number;
    collisionPadding: number;
    collisionStrength: number;
    centerStrength: number;
    alphaFloor: number;
    alphaDecay: number;
    velocityDecay: number;
  };
  rendering: {
    baseNodeRadius: number;
    contentLengthDivisor: number;
    degreeRadiusBoost: number;
    minNodePixelSize: number;
    minFocusNodePixelSize: number;
    focusRadius: number;
    proximityRange: number;
    hoverStopRange: number;
    edgeHoverDistance: number;
    maxNodeScaleMultiplier: number;
    maxTextScaleMultiplier: number;
    baseLabelFontSize: number;
    minLabelPixelSize: number;
    labelZoomThreshold: number;
    dimmedOpacity: number;
    relatedOpacity: number;
    pulseSpeed: number;
  };
  behaviors?: GraphBehaviorConfig;
}

export interface GraphFileMeta {
  createdAt: number;
  updatedAt: number;
}

export interface GraphFile {
  format: GraphFormat;
  graphId: string;
  revision: number;
  rootNodeId: NodeId;
  nodes: Record<NodeId, NodeMeta>;
  edges: Record<EdgeId, EdgeMeta>;
  adjacency: Record<NodeId, EdgeId[]>;
  nodeTypes: Record<NodeTypeId, NodeTypeDefinition>;
  edgeTypes: Record<EdgeTypeId, EdgeTypeDefinition>;
  config: GraphConfig;
  meta: GraphFileMeta;
}

export interface RuntimeViewState {
  selectedNodeId: NodeId | null;
  selectedEdgeId: EdgeId | null;
  sidebarWidth: number;
}

export interface GraphDocument {
  graph: GraphFile;
  view: RuntimeViewState;
}

export type NodeInteractionTrigger = 'hover' | 'primary' | 'open';

export function resolveNodeAction(
  document: GraphDocument,
  node: NodeMeta,
  trigger: NodeInteractionTrigger,
): GraphTargetAction {
  if (trigger === 'open') {
    if (node.file) {
      return 'openLinkedFile';
    }
    if (node.subgraph) {
      return 'enterSubgraph';
    }
  }

  const typeBehavior = node.type ? document.graph.config.behaviors?.nodeTypes?.[node.type]?.[trigger] : undefined;
  const defaultBehavior = document.graph.config.behaviors?.defaults?.[trigger];
  return typeBehavior ?? defaultBehavior ?? (trigger === 'primary' ? 'selectNode' : 'noop');
}

export function assertGraphDocumentConfig(document: GraphDocument): void {
  const missingFields: string[] = [];
  const layout = document.graph.config?.layout;
  const rendering = document.graph.config?.rendering;

  if (!layout || typeof layout !== 'object') {
    missingFields.push('config.layout');
  } else {
    collectMissingNumberFields(layout, 'config.layout', [
      'linkDistance',
      'linkStrength',
      'chargeStrength',
      'chargeDistanceMax',
      'collisionPadding',
      'collisionStrength',
      'centerStrength',
      'alphaFloor',
      'alphaDecay',
      'velocityDecay',
    ], missingFields);
  }

  if (!rendering || typeof rendering !== 'object') {
    missingFields.push('config.rendering');
  } else {
    collectMissingNumberFields(rendering, 'config.rendering', [
      'baseNodeRadius',
      'contentLengthDivisor',
      'degreeRadiusBoost',
      'minNodePixelSize',
      'minFocusNodePixelSize',
      'focusRadius',
      'proximityRange',
      'hoverStopRange',
      'edgeHoverDistance',
      'maxNodeScaleMultiplier',
      'maxTextScaleMultiplier',
      'baseLabelFontSize',
      'minLabelPixelSize',
      'labelZoomThreshold',
      'dimmedOpacity',
      'relatedOpacity',
      'pulseSpeed',
    ], missingFields);
  }

  if (missingFields.length > 0) {
    throw new Error(`图元文件配置不完整，缺少: ${missingFields.join(', ')}。这是显式格式变更，请使用“重置图谱”写入新格式，或手动补齐配置。`);
  }
}

function collectMissingNumberFields(
  target: object,
  prefix: string,
  fields: string[],
  missingFields: string[],
): void {
  const record = target as Record<string, unknown>;
  fields.forEach((field) => {
    if (typeof record[field] !== 'number' || Number.isNaN(record[field])) {
      missingFields.push(`${prefix}.${field}`);
    }
  });
}
```

## `lib\input\inputConstraints.ts`

```typescript
import type { StarsCommandId } from '../core/preferences';

const LETTER_KEYS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGIT_KEYS = '0123456789'.split('');
const FUNCTION_KEYS = Array.from({ length: 12 }, (_value, index) => `f${index + 1}`);
const NAVIGATION_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown'];
const CONTROL_KEYS = ['tab', 'enter', 'space', 'escape', 'backspace', 'delete', 'insert'];
const PUNCTUATION_KEYS = ['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'];

export const INPUT_TOKEN_GROUPS = {
  modifiers: ['ctrl', 'alt', 'shift', 'meta'],
  focus: ['focusNone', 'focusNode', 'focusLink'],
  pointers: [
    'click1', 'click2', 'click3', 'click4', 'click5',
    'dblclick1', 'dblclick2', 'dblclick3', 'dblclick4', 'dblclick5',
    'drag1', 'drag2', 'drag3', 'drag4', 'drag5',
  ],
  targets: ['node', 'link', 'background', 'any'],
  keys: [
    ...LETTER_KEYS,
    ...DIGIT_KEYS,
    ...FUNCTION_KEYS,
    ...CONTROL_KEYS,
    ...NAVIGATION_KEYS,
    ...PUNCTUATION_KEYS,
  ],
} as const;

export const INPUT_TRIGGER_OPTIONS = [
  ...INPUT_TOKEN_GROUPS.focus,
  ...INPUT_TOKEN_GROUPS.modifiers,
  ...INPUT_TOKEN_GROUPS.pointers,
  ...INPUT_TOKEN_GROUPS.targets,
  ...INPUT_TOKEN_GROUPS.keys,
];

export interface PathContext {
  modifiers: string[];
  focus?: string;
  pointer?: string;
  targets: string[];
  key?: string;
}

export type CommandScope = 'keyboard' | 'pointer' | 'either';

export interface CommandPattern {
  scope: CommandScope;
  tokens: string[];
}

export interface CommandConstraint {
  id: StarsCommandId;
  label: string;
  patterns: CommandPattern[];
}

export const COMMANDS: CommandConstraint[] = [
  { id: 'selectNode', label: '选择节点', patterns: [{ scope: 'pointer', tokens: ['node'] }] },
  { id: 'selectEdge', label: '选择关系', patterns: [{ scope: 'pointer', tokens: ['link'] }] },
  { id: 'clearFocus', label: '清空焦点', patterns: [{ scope: 'pointer', tokens: ['background'] }] },
  { id: 'rotateCanvas', label: '旋转视角', patterns: [
    { scope: 'pointer', tokens: ['drag', 'background'] },
    { scope: 'pointer', tokens: ['drag', 'link'] },
    { scope: 'pointer', tokens: ['drag', 'any'] },
  ] },
  { id: 'panCanvas', label: '拖动画布', patterns: [{ scope: 'pointer', tokens: ['drag'] }] },
  { id: 'dragNode', label: '拖动节点', patterns: [{ scope: 'pointer', tokens: ['node'] }] },
  { id: 'createEdge', label: '创建关系', patterns: [{ scope: 'pointer', tokens: ['node', 'node'] }] },
  { id: 'deleteTarget', label: '删除目标', patterns: [
    { scope: 'pointer', tokens: ['node'] },
    { scope: 'pointer', tokens: ['link'] },
  ] },
  { id: 'openNodeTarget', label: '打开节点目标', patterns: [{ scope: 'pointer', tokens: ['dblclick', 'node'] }] },
  { id: 'createLinkedNode', label: '创建关联节点', patterns: [{ scope: 'keyboard', tokens: [] }] },
  { id: 'deleteSelectedNode', label: '删除焦点目标', patterns: [
    { scope: 'keyboard', tokens: ['focusNode'] },
    { scope: 'keyboard', tokens: ['focusLink'] },
  ] },
  { id: 'openSelectedFile', label: '打开当前节点', patterns: [{ scope: 'keyboard', tokens: ['focusNode'] }] },
  { id: 'editSelectedNode', label: '编辑节点名称', patterns: [{ scope: 'keyboard', tokens: ['focusNode'] }] },
  { id: 'navigateBack', label: '返回焦点历史', patterns: [
    { scope: 'keyboard', tokens: [] },
    { scope: 'pointer', tokens: ['click'] },
  ] },
  { id: 'navigateUp', label: '向上跳转', patterns: [{ scope: 'keyboard', tokens: ['focusNode'] }] },
  { id: 'navigateDown', label: '向下跳转', patterns: [{ scope: 'keyboard', tokens: ['focusNode'] }] },
  { id: 'navigateLeft', label: '向左跳转', patterns: [{ scope: 'keyboard', tokens: ['focusNode'] }] },
  { id: 'navigateRight', label: '向右跳转', patterns: [{ scope: 'keyboard', tokens: ['focusNode'] }] },
  { id: 'focusRoot', label: '回到根节点', patterns: [{ scope: 'keyboard', tokens: [] }] },
  { id: 'togglePreferencesPanel', label: '切换偏好面板', patterns: [{ scope: 'keyboard', tokens: [] }] },
  { id: 'toggleCreatePanel', label: '切换创建面板', patterns: [{ scope: 'keyboard', tokens: [] }] },
  { id: 'toggleInfoPanel', label: '切换信息提示', patterns: [{ scope: 'keyboard', tokens: [] }] },
  { id: 'toggleSidebarPanel', label: '切换右侧侧边栏', patterns: [{ scope: 'keyboard', tokens: [] }] },
  { id: 'undo', label: '撤回', patterns: [{ scope: 'keyboard', tokens: [] }] },
  { id: 'redo', label: '重做', patterns: [{ scope: 'keyboard', tokens: [] }] },
  { id: 'resetGraph', label: '重置图谱', patterns: [{ scope: 'keyboard', tokens: [] }] },
];

export function analyzePath(path: string[]): PathContext {
  const context: PathContext = { modifiers: [], targets: [] };

  for (const token of path.map((item) => item.trim()).filter(Boolean)) {
    if (INPUT_TOKEN_GROUPS.modifiers.includes(token as (typeof INPUT_TOKEN_GROUPS.modifiers)[number])) {
      if (!context.modifiers.includes(token)) {
        context.modifiers.push(token);
      }
      continue;
    }
    if (INPUT_TOKEN_GROUPS.focus.includes(token as (typeof INPUT_TOKEN_GROUPS.focus)[number])) {
      context.focus = token;
      continue;
    }
    if (INPUT_TOKEN_GROUPS.pointers.includes(token as (typeof INPUT_TOKEN_GROUPS.pointers)[number])) {
      context.pointer = token;
      continue;
    }
    if (INPUT_TOKEN_GROUPS.targets.includes(token as (typeof INPUT_TOKEN_GROUPS.targets)[number])) {
      context.targets.push(token);
      continue;
    }
    if (INPUT_TOKEN_GROUPS.keys.includes(token as (typeof INPUT_TOKEN_GROUPS.keys)[number])) {
      context.key = token;
    }
  }

  return context;
}

export function getValidNextTokens(path: string[]): string[] {
  const context = analyzePath(path);
  if (!isValidPartialPath(context)) {
    return [];
  }

  if (context.key) {
    return [];
  }

  if (context.pointer) {
    if (context.targets.length === 0) {
      return dedupeTokens(INPUT_TOKEN_GROUPS.targets);
    }

    if (context.pointer.startsWith('drag') && context.targets.length === 1) {
      return dedupeTokens(INPUT_TOKEN_GROUPS.targets);
    }

    return [];
  }

  return dedupeTokens([
    ...(!context.focus ? INPUT_TOKEN_GROUPS.focus : []),
    ...INPUT_TOKEN_GROUPS.modifiers.filter((modifier) => !context.modifiers.includes(modifier)),
    ...INPUT_TOKEN_GROUPS.pointers,
    ...INPUT_TOKEN_GROUPS.keys,
  ]);
}

export function getValidCommands(path: string[]): CommandConstraint[] {
  const pathTokens = path.map((token) => token.trim()).filter(Boolean);
  const context = analyzePath(path);
  if (!isValidPartialPath(context)) {
    return [];
  }

  return COMMANDS
    .map((command) => ({
      command,
      score: getBestCommandPatternScore(command, pathTokens, context),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.command);
}

export function getCommandLabel(commandId: StarsCommandId): string {
  return COMMANDS.find((command) => command.id === commandId)?.label ?? commandId;
}

function isValidPartialPath(context: PathContext): boolean {
  if (context.pointer && context.key) {
    return false;
  }
  if (context.targets.length > 0 && !context.pointer) {
    return false;
  }
  if (context.pointer && !context.pointer.startsWith('drag') && context.targets.length > 1) {
    return false;
  }
  if (context.targets.length > 2) {
    return false;
  }
  return true;
}

function dedupeTokens(tokens: readonly string[]): string[] {
  return [...new Set(tokens)];
}

function getBestCommandPatternScore(command: CommandConstraint, pathTokens: string[], context: PathContext): number {
  return command.patterns.reduce((bestScore, pattern) => {
    if (!matchesScope(pattern.scope, context)) {
      return bestScore;
    }

    const patternScore = getPatternMatchScore(pattern.tokens, pathTokens);
    return Math.max(bestScore, patternScore);
  }, -1);
}

function matchesScope(scope: CommandScope, context: PathContext): boolean {
  if (scope === 'either') {
    return true;
  }
  if (scope === 'pointer') {
    return Boolean(context.pointer);
  }
  return Boolean(context.key) && !context.pointer && context.targets.length === 0;
}

function getPatternMatchScore(requirements: string[], pathTokens: string[]): number {
  if (requirements.length === 0) {
    return 1;
  }

  let searchStart = 0;
  let score = requirements.length * 100;

  for (const requirement of requirements) {
    const matchIndex = findNextMatchingTokenIndex(pathTokens, requirement, searchStart);
    if (matchIndex === -1) {
      return -1;
    }

    score += requirement.length * 10;
    score -= matchIndex - searchStart;
    searchStart = matchIndex + 1;
  }

  return score;
}

function findNextMatchingTokenIndex(pathTokens: string[], requirement: string, searchStart: number): number {
  for (let index = searchStart; index < pathTokens.length; index += 1) {
    if (tokenMatchesRequirement(pathTokens[index], requirement)) {
      return index;
    }
  }
  return -1;
}

function tokenMatchesRequirement(token: string, requirement: string): boolean {
  return token === requirement || token.startsWith(requirement);
}
```

## `lib\input\inputTree.ts`

```typescript
import type { PointerButton, PointerModifier, PointerTargetRef, StarsActionId, StarsPointerActionId } from '../core/preferences';
import type { RuntimeViewState } from '../core/schema';
import { getValidCommands, getValidNextTokens } from './inputConstraints';

export interface InputRouteNode {
  trigger: string;
  children?: InputRouteNode[];
  command?: string;
}

export type StarsInputTree = InputRouteNode[];
export type InputFocusToken = 'focusNode' | 'focusLink' | 'focusNone';
export type InputTreeValidationIssue = { path: string; message: string };

export interface PointerResolveContext {
  gesture: 'click' | 'dblclick' | 'drag';
  button: PointerButton;
  modifiers: PointerModifier[];
  start: PointerTargetRef;
  end?: PointerTargetRef;
  focus?: InputFocusToken;
}

const MODIFIER_ORDER: PointerModifier[] = ['ctrl', 'alt', 'shift', 'meta'];

const BUTTON_TO_NUMBER: Record<PointerButton, string> = {
  left: '1',
  right: '2',
  middle: '3',
  back: '4',
  forward: '5',
};

export const DEFAULT_INPUT_TREE: StarsInputTree = [
  { trigger: 'tab', command: 'createLinkedNode' satisfies StarsActionId },
  { trigger: 'b', command: 'navigateBack' satisfies StarsActionId },
  { trigger: 'h', command: 'focusRoot' satisfies StarsActionId },
  { trigger: 'p', command: 'togglePreferencesPanel' satisfies StarsActionId },
  { trigger: 'n', command: 'toggleCreatePanel' satisfies StarsActionId },
  { trigger: 'i', command: 'toggleInfoPanel' satisfies StarsActionId },
  { trigger: 'o', command: 'toggleSidebarPanel' satisfies StarsActionId },
  { trigger: 'focusNode', children: [
    { trigger: 'd', command: 'deleteSelectedNode' satisfies StarsActionId },
    { trigger: 'delete', command: 'deleteSelectedNode' satisfies StarsActionId },
    { trigger: 'enter', command: 'openSelectedFile' satisfies StarsActionId },
    { trigger: 'space', command: 'editSelectedNode' satisfies StarsActionId },
    { trigger: 'f2', command: 'editSelectedNode' satisfies StarsActionId },
    { trigger: 'arrowup', command: 'navigateUp' satisfies StarsActionId },
    { trigger: 'arrowdown', command: 'navigateDown' satisfies StarsActionId },
    { trigger: 'arrowleft', command: 'navigateLeft' satisfies StarsActionId },
    { trigger: 'arrowright', command: 'navigateRight' satisfies StarsActionId },
  ] },
  { trigger: 'focusLink', children: [
    { trigger: 'd', command: 'deleteSelectedNode' satisfies StarsActionId },
    { trigger: 'delete', command: 'deleteSelectedNode' satisfies StarsActionId },
  ] },
  { trigger: 'ctrl', children: [
    { trigger: 'z', command: 'undo' satisfies StarsActionId },
    { trigger: 'y', command: 'redo' satisfies StarsActionId },
    { trigger: 'shift', children: [
      { trigger: 'z', command: 'redo' satisfies StarsActionId },
      { trigger: 'r', command: 'resetGraph' satisfies StarsActionId },
    ] },
  ] },
  { trigger: 'click1', children: [
    { trigger: 'node', command: 'selectNode' satisfies StarsPointerActionId },
    { trigger: 'link', command: 'selectEdge' satisfies StarsPointerActionId },
    { trigger: 'background', command: 'clearFocus' satisfies StarsPointerActionId },
  ] },
  { trigger: 'click4', children: [{ trigger: 'any', command: 'navigateBack' satisfies StarsPointerActionId }] },
  { trigger: 'dblclick1', children: [{ trigger: 'node', command: 'openNodeTarget' satisfies StarsPointerActionId }] },
  { trigger: 'shift', children: [
    { trigger: 'click2', children: [
      { trigger: 'node', command: 'deleteTarget' satisfies StarsPointerActionId },
      { trigger: 'link', command: 'deleteTarget' satisfies StarsPointerActionId },
    ] },
  ] },
  { trigger: 'drag1', children: [
    { trigger: 'background', children: [{ trigger: 'any', command: 'rotateCanvas' satisfies StarsPointerActionId }] },
    { trigger: 'link', children: [{ trigger: 'any', command: 'rotateCanvas' satisfies StarsPointerActionId }] },
    { trigger: 'node', children: [{ trigger: 'any', command: 'dragNode' satisfies StarsPointerActionId }] },
  ] },
  { trigger: 'drag2', children: [
    { trigger: 'background', children: [{ trigger: 'any', command: 'panCanvas' satisfies StarsPointerActionId }] },
    { trigger: 'node', children: [{ trigger: 'node', command: 'createEdge' satisfies StarsPointerActionId }] },
  ] },
  { trigger: 'drag3', children: [{ trigger: 'any', children: [{ trigger: 'any', command: 'panCanvas' satisfies StarsPointerActionId }] }] },
];

export function cloneInputTree(tree: StarsInputTree): StarsInputTree {
  return structuredClone(tree);
}

export function sanitizeInputTree(rawTree: unknown): StarsInputTree {
  if (!Array.isArray(rawTree)) {
    return cloneInputTree(DEFAULT_INPUT_TREE);
  }

  const nodes = rawTree.map(sanitizeInputRouteNode).filter((node): node is InputRouteNode => Boolean(node));
  return nodes.length > 0 ? nodes : cloneInputTree(DEFAULT_INPUT_TREE);
}

export function validateInputTree(tree: StarsInputTree): InputTreeValidationIssue[] {
  const issues: InputTreeValidationIssue[] = [];

  function visit(nodes: InputRouteNode[], path: string[]) {
    const siblingTriggers = new Set<string>();
    nodes.forEach((node) => {
      const trigger = normalizeInputTrigger(node.trigger);
      const nextPath = [...path, trigger || '?'];
      const pathLabel = nextPath.join(' > ');
      const routePath = trigger ? [...path, trigger] : path;
      const isBranch = Array.isArray(node.children);
      const hasChildren = Boolean(node.children?.length);
      const hasCommand = Boolean(node.command?.trim());
      const validNextTokens = getValidNextTokens(path);
      const validCommands = getValidCommands(routePath).map((command) => command.id);

      if (!trigger) {
        issues.push({ path: pathLabel, message: 'trigger 不能为空' });
      } else if (!validNextTokens.includes(trigger)) {
        issues.push({ path: pathLabel, message: '当前上下文不能使用这个 trigger' });
      } else if (siblingTriggers.has(trigger)) {
        issues.push({ path: pathLabel, message: '同一层不能出现重复 trigger' });
      }
      siblingTriggers.add(trigger);

      if (isBranch && hasCommand) {
        issues.push({ path: pathLabel, message: '节点不能同时拥有子条件和 command' });
      }
      if (!isBranch && !hasCommand) {
        issues.push({ path: pathLabel, message: '叶子节点需要指定 command' });
      }
      if (hasCommand && node.command && !validCommands.some((commandId) => commandId === node.command)) {
        issues.push({ path: pathLabel, message: '当前路径不能绑定这个 command' });
      }
      if (hasChildren && trigger && getValidNextTokens(routePath).length === 0) {
        issues.push({ path: pathLabel, message: '当前路径不能继续添加子条件' });
      }
      if (node.children) {
        visit(node.children, routePath);
      }
    });
  }

  visit(tree, []);
  return issues;
}

export function stringifyInputTreeDsl(tree: StarsInputTree): string {
  return tree.map((node) => stringifyInputRouteNode(node, 0)).join('\n');
}

export function parseInputTreeDsl(source: string): StarsInputTree {
  const roots: StarsInputTree = [];
  const stack: Array<{ depth: number; children: InputRouteNode[] }> = [{ depth: -1, children: roots }];

  source
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, '  '))
    .forEach((rawLine, lineIndex) => {
      if (!rawLine.trim()) {
        return;
      }

      const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
      if (indent % 2 !== 0) {
        throw new Error(`第 ${lineIndex + 1} 行缩进必须是 2 的倍数`);
      }

      const depth = indent / 2;
      const line = rawLine.trim();
      const match = /^(.*?)\s*(?:->\s*(.+))?$/.exec(line);
      if (!match) {
        throw new Error(`第 ${lineIndex + 1} 行无法解析`);
      }

      const trigger = normalizeInputTrigger(match[1] ?? '');
      const command = match[2]?.trim();
      if (!trigger) {
        throw new Error(`第 ${lineIndex + 1} 行缺少 trigger`);
      }

      while (stack.at(-1) && stack.at(-1)!.depth >= depth) {
        stack.pop();
      }

      const parent = stack.at(-1);
      if (!parent || depth > parent.depth + 1) {
        throw new Error(`第 ${lineIndex + 1} 行缩进层级不连续`);
      }

      const node: InputRouteNode = command ? { trigger, command } : { trigger, children: [] };
      parent.children.push(node);
      if (!command) {
        stack.push({ depth, children: node.children ?? [] });
      }
    });

  return cleanupParsedInputTree(roots);
}

export function getInputRouteCommandBindings(tree: StarsInputTree): Record<string, string[]> {
  const bindings: Record<string, string[]> = {};

  function visit(nodes: InputRouteNode[], path: string[]) {
    nodes.forEach((node) => {
      const trigger = normalizeInputTrigger(node.trigger);
      const nextPath = [...path, trigger];
      if (node.command) {
        bindings[node.command] = [...(bindings[node.command] ?? []), nextPath.join(' + ')];
      }
      if (node.children) {
        visit(node.children, nextPath);
      }
    });
  }

  visit(tree, []);
  return bindings;
}

export function resolveKeyboardInputTreeAction(event: KeyboardEvent, tree: StarsInputTree, focus: InputFocusToken = 'focusNone'): string | null {
  if (isEditableTarget(event.target)) {
    return null;
  }

  const keyPath = [...getKeyboardModifiers(event), normalizeKeyboardKey(event.key)];
  return resolveInputRouteCandidates(tree, [[focus, ...keyPath], keyPath]);
}

export function resolvePointerInputTreeAction(context: PointerResolveContext, tree: StarsInputTree): string | null {
  return resolveInputRouteCandidates(tree, getPointerRouteCandidates(context));
}

export function resolvePointerInputTreeStartAction(context: Omit<PointerResolveContext, 'end'>, tree: StarsInputTree): string | null {
  for (const candidate of getPointerRouteCandidates(context)) {
    const node = findRouteNode(tree, candidate);
    const command = node ? findFirstCommand(node) : null;
    if (command) {
      return command;
    }
  }
  return null;
}

export function normalizeMouseButton(button: number): PointerButton | null {
  switch (button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    case 3:
      return 'back';
    case 4:
      return 'forward';
    default:
      return null;
  }
}

export function getPointerModifiers(event: MouseEvent | WheelEvent): PointerModifier[] {
  const modifiers: PointerModifier[] = [];
  if (event.ctrlKey) {
    modifiers.push('ctrl');
  }
  if (event.altKey) {
    modifiers.push('alt');
  }
  if (event.shiftKey) {
    modifiers.push('shift');
  }
  if (event.metaKey) {
    modifiers.push('meta');
  }
  return MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
}

export function getFocusToken(view: RuntimeViewState): InputFocusToken {
  if (view.selectedNodeId) {
    return 'focusNode';
  }
  if (view.selectedEdgeId) {
    return 'focusLink';
  }
  return 'focusNone';
}

export function normalizeInputTrigger(trigger: string): string {
  const lower = trigger.trim().toLowerCase();
  switch (lower) {
    case 'control':
      return 'ctrl';
    case 'cmd':
    case 'command':
      return 'meta';
    case 'esc':
      return 'escape';
    case 'del':
      return 'delete';
    case ' ':
    case 'spacebar':
      return 'space';
    case 'dbclick1':
      return 'dblclick1';
    case 'dbclick2':
      return 'dblclick2';
    case 'dbclick3':
      return 'dblclick3';
    case 'dbclick4':
      return 'dblclick4';
    case 'dbclick5':
      return 'dblclick5';
    case 'focusnode':
      return 'focusNode';
    case 'focuslink':
      return 'focusLink';
    case 'focusnone':
      return 'focusNone';
    default:
      return lower;
  }
}

function sanitizeInputRouteNode(rawNode: unknown): InputRouteNode | null {
  if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
    return null;
  }

  const record = rawNode as Record<string, unknown>;
  if (typeof record.trigger !== 'string') {
    return null;
  }

  const trigger = normalizeInputTrigger(record.trigger);
  if (!trigger) {
    return null;
  }

  const children = Array.isArray(record.children)
    ? record.children.map(sanitizeInputRouteNode).filter((node): node is InputRouteNode => Boolean(node))
    : undefined;
  const command = typeof record.command === 'string' && record.command.trim() ? record.command.trim() : undefined;

  if (Array.isArray(record.children)) {
    if ((children?.length ?? 0) > 0 || !command) {
      return { trigger, children: children ?? [] };
    }
  }
  if (command) {
    return { trigger, command };
  }
  return { trigger, command: '' };
}

function stringifyInputRouteNode(node: InputRouteNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const header = node.command
    ? `${indent}${normalizeInputTrigger(node.trigger)} -> ${node.command}`
    : `${indent}${normalizeInputTrigger(node.trigger)}`;
  const children = node.children?.map((child) => stringifyInputRouteNode(child, depth + 1)).join('\n') ?? '';
  return children ? `${header}\n${children}` : header;
}

function cleanupParsedInputTree(nodes: StarsInputTree): StarsInputTree {
  return nodes.map((node) => {
    const cleanedChildren = node.children ? cleanupParsedInputTree(node.children) : undefined;
    return {
      trigger: node.trigger,
      ...(node.command ? { command: node.command } : {}),
      ...(cleanedChildren && cleanedChildren.length > 0 ? { children: cleanedChildren } : {}),
    };
  });
}

function resolveInputRouteCandidates(tree: StarsInputTree, candidates: string[][]): string | null {
  for (const candidate of candidates) {
    const node = findRouteNode(tree, candidate);
    if (node?.command) {
      return node.command;
    }
  }
  return null;
}

function findRouteNode(tree: StarsInputTree, path: string[]): InputRouteNode | null {
  let nodes = tree;
  let current: InputRouteNode | null = null;

  for (const rawToken of path) {
    const token = normalizeInputTrigger(rawToken);
    const match = nodes.find((node) => triggerMatches(node.trigger, token));
    if (!match) {
      return null;
    }

    current = match;
    nodes = match.children ?? [];
  }

  return current;
}

function findFirstCommand(node: InputRouteNode): string | null {
  if (node.command) {
    return node.command;
  }

  for (const child of node.children ?? []) {
    const command = findFirstCommand(child);
    if (command) {
      return command;
    }
  }
  return null;
}

function triggerMatches(routeTrigger: string, actual: string): boolean {
  const expected = normalizeInputTrigger(routeTrigger);
  return expected === actual || expected === 'any';
}

function getKeyboardModifiers(event: KeyboardEvent): PointerModifier[] {
  const modifiers: PointerModifier[] = [];
  if (event.ctrlKey) {
    modifiers.push('ctrl');
  }
  if (event.altKey) {
    modifiers.push('alt');
  }
  if (event.shiftKey) {
    modifiers.push('shift');
  }
  if (event.metaKey) {
    modifiers.push('meta');
  }
  return MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
}

function normalizeKeyboardKey(key: string): string {
  return normalizeInputTrigger(key);
}

function getPointerRouteCandidates(context: Omit<PointerResolveContext, 'end'> & { end?: PointerTargetRef }): string[][] {
  const operation = `${context.gesture}${BUTTON_TO_NUMBER[context.button]}`;
  const modifierPath = MODIFIER_ORDER.filter((modifier) => context.modifiers.includes(modifier));
  const targetPath = context.end && context.gesture === 'drag'
    ? [context.start.kind, context.end.kind]
    : [context.start.kind];
  const path = [...modifierPath, operation, ...targetPath];
  return context.focus ? [[context.focus, ...path], path] : [path];
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return target.matches('input, textarea, select');
}
```

## `lib\persistence\defaultrepository.ts`

```typescript
import { IndexedDbGraphRepository } from './indexeddb';
import type { GraphRepository } from './repository';
import { isVsCodeWebview, VsCodeGraphRepository } from './vscoderepository';

export function createDefaultRepository(): GraphRepository {
  if (isVsCodeWebview()) {
    return new VsCodeGraphRepository();
  }

  return new IndexedDbGraphRepository();
}
```

## `lib\persistence\indexeddb.ts`

```typescript
import type { GraphDocument } from '../core/schema';
import type { GraphRepository } from './repository';

const DB_NAME = 'stars-local';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const SNAPSHOT_KEY = 'graph';

export class IndexedDbGraphRepository implements GraphRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
    });

    return this.dbPromise;
  }

  async load(): Promise<GraphDocument | null> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(SNAPSHOT_KEY);

      request.onsuccess = () => resolve((request.result as GraphDocument | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 读取失败'));
    });
  }

  async save(snapshot: GraphDocument): Promise<void> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(snapshot, SNAPSHOT_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 写入失败'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入中止'));
    });
  }

  async reset(): Promise<void> {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(SNAPSHOT_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 重置失败'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 重置中止'));
    });
  }
}
```

## `lib\persistence\repository.ts`

```typescript
import type { GraphDocument } from '../core/schema';
import type { RuntimeViewState } from '../core/schema';
import type { GraphOperation } from '../core/operations';
import type { LinkedFileOpenMode, StarsUserPreferences } from '../core/preferences';

export interface WorkspaceFileInfo {
  path: string;
  label: string;
  metrics: {
    contentLength: number;
  };
}

export interface GraphCommitResult {
  document: GraphDocument;
  inverse: GraphOperation;
}

export interface GraphRepository {
  load(): Promise<GraphDocument | null>;
  save(document: GraphDocument): Promise<void>;
  reset(): Promise<void>;
  applyOperation?(operation: GraphOperation, baseRevision: number, view: RuntimeViewState): Promise<GraphCommitResult>;
  openWorkspaceFile?(path: string): Promise<void>;
  revealWorkspaceFile?(path: string, mode: LinkedFileOpenMode): Promise<boolean>;
  resolveWorkspaceFile?(pathOrUri: string): Promise<WorkspaceFileInfo>;
  createWorkspaceFile?(path: string): Promise<WorkspaceFileInfo>;
  renameWorkspaceFile?(path: string, name: string): Promise<WorkspaceFileInfo>;
  loadPreferences?(): Promise<StarsUserPreferences>;
  savePreferences?(preferences: StarsUserPreferences): Promise<void>;
}
```

## `lib\persistence\vscoderepository.ts`

```typescript
import type { GraphDocument } from '../core/schema';
import type { RuntimeViewState } from '../core/schema';
import type { GraphOperation } from '../core/operations';
import type { LinkedFileOpenMode, StarsUserPreferences } from '../core/preferences';
import type { GraphCommitResult, GraphRepository, WorkspaceFileInfo } from './repository';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface ResponseMessage {
  command: 'response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

declare const acquireVsCodeApi: undefined | (() => VsCodeApi);

let api: VsCodeApi | null = null;

function getVsCodeApi(): VsCodeApi | null {
  if (api) {
    return api;
  }

  if (typeof acquireVsCodeApi !== 'function') {
    return null;
  }

  api = acquireVsCodeApi();
  return api;
}

export function isVsCodeWebview(): boolean {
  return getVsCodeApi() !== null;
}

export class VsCodeGraphRepository implements GraphRepository {
  private readonly api: VsCodeApi;

  constructor() {
    const nextApi = getVsCodeApi();
    if (!nextApi) {
      throw new Error('VS Code Webview API 不可用');
    }
    this.api = nextApi;
  }

  load(): Promise<GraphDocument | null> {
    return this.request<GraphDocument>('loadGraph');
  }

  save(document: GraphDocument): Promise<void> {
    return this.request<void>('saveGraph', { document });
  }

  reset(): Promise<void> {
    return this.request<void>('resetGraph');
  }

  applyOperation(operation: GraphOperation, baseRevision: number, view: RuntimeViewState): Promise<GraphCommitResult> {
    return this.request<GraphCommitResult>('applyOperation', { operation, baseRevision, view });
  }

  openWorkspaceFile(path: string): Promise<void> {
    return this.request<void>('openWorkspaceFile', { path });
  }

  revealWorkspaceFile(path: string, mode: LinkedFileOpenMode): Promise<boolean> {
    return this.request<boolean>('revealWorkspaceFile', { path, mode });
  }

  resolveWorkspaceFile(pathOrUri: string): Promise<WorkspaceFileInfo> {
    return this.request<WorkspaceFileInfo>('resolveWorkspaceFile', { path: pathOrUri });
  }

  createWorkspaceFile(path: string): Promise<WorkspaceFileInfo> {
    return this.request<WorkspaceFileInfo>('createWorkspaceFile', { path });
  }

  renameWorkspaceFile(path: string, name: string): Promise<WorkspaceFileInfo> {
    return this.request<WorkspaceFileInfo>('renameWorkspaceFile', { path, name });
  }

  loadPreferences(): Promise<StarsUserPreferences> {
    return this.request<StarsUserPreferences>('loadPreferences');
  }

  savePreferences(preferences: StarsUserPreferences): Promise<void> {
    return this.request<void>('savePreferences', { preferences });
  }

  private request<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<ResponseMessage>) => {
        const message = event.data;
        if (!message || message.command !== 'response' || message.requestId !== requestId) {
          return;
        }

        window.removeEventListener('message', onMessage as EventListener);
        if (message.ok) {
          resolve(message.result as T);
        } else {
          reject(new Error(message.error ?? `${command} 失败`));
        }
      };

      window.addEventListener('message', onMessage as EventListener);
      this.api.postMessage({ command, requestId, ...payload });
    });
  }
}
```

## `lib\runtime\graphRuntime.ts`

```typescript
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { quadtree, type Quadtree } from 'd3-quadtree';
import { escapeHtml, renderSummaryMarkdown } from '../core/markdown';
import { isStarsPointerActionId, type PointerButton, type PointerModifier, type PointerTargetRef, type StarsPointerActionId } from '../core/preferences';
import type { EdgeMeta, GraphDocument, GraphConfig, NodeMeta } from '../core/schema';
import {
  getFocusToken,
  getPointerModifiers,
  normalizeMouseButton,
  resolvePointerInputTreeAction,
  resolvePointerInputTreeStartAction,
  type StarsInputTree,
} from '../input/inputTree';

interface GraphRuntimeOptions {
  getDocument: () => GraphDocument;
  getInputTree: () => StarsInputTree;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onClearFocus: () => void;
  onCreateEdge: (sourceId: string, targetId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onOpenNode: (nodeId: string) => void;
  onNavigateBack: () => void;
  onImportFile: (pathOrUri: string) => void;
}

interface RuntimeNodeState extends SimulationNodeDatum {
  nodeId: string;
  radius: number;
}

interface RuntimeLinkState extends SimulationLinkDatum<RuntimeNodeState> {
  edgeId: string;
  type: string;
}

interface CameraState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface DoubleClickCandidate {
  nodeId: string;
  clientX: number;
  clientY: number;
  timestamp: number;
}

interface PointerDownState {
  button: PointerButton;
  modifiers: PointerModifier[];
  start: PointerTargetRef;
  clientX: number;
  clientY: number;
}

const DOUBLE_CLICK_TARGET_MAX_AGE_MS = 700;
const DOUBLE_CLICK_TARGET_RADIUS_PX = 8;
const DRAG_START_THRESHOLD_PX = 5;

export class GraphRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly options: GraphRuntimeOptions;
  private animationFrame = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private graphSignature = '';
  private lastFrameTime = 0;
  private didPan = false;
  private didClearFocusForPan = false;
  private isPanning = false;
  private panButton: number | null = null;
  private isRotating = false;
  private hoveredNodeId: string | null = null;
  private hoveredEdgeId: string | null = null;
  private draggedNodeId: string | null = null;
  private dragTarget: ScreenPoint | null = null;
  private linkDragSourceId: string | null = null;
  private pendingClickNodeId: string | null = null;
  private pendingClickEdgeId: string | null = null;
  private pointerDownState: PointerDownState | null = null;
  private activePointerAction: StarsPointerActionId | null = null;
  private doubleClickCandidate: DoubleClickCandidate | null = null;
  private pointer: ScreenPoint | null = null;
  private lastPointer = { x: 0, y: 0 };
  private simulation: Simulation<RuntimeNodeState, RuntimeLinkState> | null = null;
  private quadtreeIndex: Quadtree<RuntimeNodeState> | null = null;
  private readonly camera: CameraState = { x: 0, y: 0, scale: 1, rotation: 0 };
  private cameraLookAt: ScreenPoint | null = null;
  private tooltipElement: HTMLDivElement | null = null;
  private readonly runtimeNodes = new Map<string, RuntimeNodeState>();
  private readonly resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, options: GraphRuntimeOptions) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D 上下文不可用');
    }

    this.canvas = canvas;
    this.context = context;
    this.options = options;
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  start() {
    this.resize();
    this.createTooltipElement();
    this.resizeObserver.observe(this.canvas);
    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('dblclick', this.handleDoubleClick);
    this.canvas.addEventListener('mousemove', this.handlePointerMove);
    this.canvas.addEventListener('mouseleave', this.handlePointerLeave);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('dragover', this.handleDragOver);
    this.canvas.addEventListener('drop', this.handleDrop);
    window.addEventListener('mousemove', this.handleWindowMouseMove);
    window.addEventListener('mouseup', this.handleWindowMouseUp);
    this.frame();
  }

  destroy() {
    cancelAnimationFrame(this.animationFrame);
    this.simulation?.stop();
    this.tooltipElement?.remove();
    this.tooltipElement = null;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('dblclick', this.handleDoubleClick);
    this.canvas.removeEventListener('mousemove', this.handlePointerMove);
    this.canvas.removeEventListener('mouseleave', this.handlePointerLeave);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('dragover', this.handleDragOver);
    this.canvas.removeEventListener('drop', this.handleDrop);
    window.removeEventListener('mousemove', this.handleWindowMouseMove);
    window.removeEventListener('mouseup', this.handleWindowMouseUp);
  }

  navigateDirection(targetAngle: number, rotateView = false) {
    const document = this.options.getDocument();
    const selectedNodeId = document.view.selectedNodeId;
    if (!selectedNodeId) {
      return;
    }

    const source = this.runtimeNodes.get(selectedNodeId);
    if (!source) {
      return;
    }

    let bestNodeId: string | null = null;
    let bestRawAngle = 0;
    let bestDiff = 1.2;

    (document.graph.adjacency[selectedNodeId] ?? []).forEach((edgeId) => {
      const edge = document.graph.edges[edgeId];
      if (!edge) {
        return;
      }

      const otherNodeId = edge.sourceId === selectedNodeId ? edge.targetId : edge.sourceId;
      const target = this.runtimeNodes.get(otherNodeId);
      if (!target) {
        return;
      }

      const rawAngle = Math.atan2((target.y ?? 0) - (source.y ?? 0), (target.x ?? 0) - (source.x ?? 0));
      const viewAngle = normalizeAngle(rawAngle + this.camera.rotation);
      const diff = Math.abs(normalizeAngle(viewAngle - targetAngle));
      if (diff < bestDiff) {
        bestDiff = diff;
        bestRawAngle = rawAngle;
        bestNodeId = otherNodeId;
      }
    });

    if (!bestNodeId) {
      return;
    }

    if (rotateView) {
      const center = this.currentCameraLookAt();
      this.camera.rotation = normalizeAngle(targetAngle - bestRawAngle);
      this.setCameraOffsetForWorldPoint(center, this.width / 2, this.height / 2);
    }

    this.options.onSelectNode(bestNodeId);
  }

  setInputTree(_inputTree: StarsInputTree) {
    // The tree is read lazily through options so the runtime follows Svelte store updates.
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private readonly handlePointerMove = (event: MouseEvent) => {
    this.pointer = { x: event.offsetX, y: event.offsetY };
    if (this.isPanning || this.isRotating || this.draggedNodeId || this.linkDragSourceId) {
      return;
    }

    this.refreshHoverState();
    this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
  };

  private readonly handlePointerLeave = () => {
    this.pointer = null;
    this.hoveredNodeId = null;
    this.hoveredEdgeId = null;
    if (!this.isPanning && !this.isRotating && !this.draggedNodeId && !this.linkDragSourceId) {
      this.canvas.style.cursor = 'crosshair';
    }
  };

  private readonly handleMouseDown = (event: MouseEvent) => {
    this.canvas.focus();
    this.pointer = { x: event.offsetX, y: event.offsetY };
    this.didPan = false;
    this.didClearFocusForPan = false;
    this.pendingClickNodeId = null;
    this.pendingClickEdgeId = null;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.activePointerAction = null;

    const button = normalizeMouseButton(event.button);
    if (!button) {
      return;
    }

    const modifiers = getPointerModifiers(event);
    const start = this.pickPointerTarget(event.offsetX, event.offsetY);
    this.pointerDownState = {
      button,
      modifiers,
      start,
      clientX: event.clientX,
      clientY: event.clientY,
    };

    const clickAction = this.resolvePointerAction('click', button, modifiers, start, start);
    if (clickAction === 'deleteTarget') {
      event.preventDefault();
      this.deletePointerTarget(start);
      this.pointerDownState = null;
      return;
    }
    if (clickAction === 'navigateBack') {
      event.preventDefault();
      this.options.onNavigateBack();
      this.pointerDownState = null;
      return;
    }

    if (button === 'left') {
      const repeatedNodeId = this.getDoubleClickCandidateNodeId(event);
      if (repeatedNodeId) {
        event.preventDefault();
        this.pendingClickNodeId = repeatedNodeId;
        this.canvas.style.cursor = 'pointer';
        return;
      }

      if (start.kind === 'link') {
        this.pendingClickEdgeId = start.id ?? null;
      }

      const dragAction = this.resolvePointerStartAction('drag', button, modifiers, start);
      if (dragAction === 'rotateCanvas') {
        event.preventDefault();
        this.canvas.style.cursor = 'alias';
        return;
      }

      if (dragAction !== 'dragNode' || start.kind !== 'node' || !start.id) {
        return;
      }

      event.preventDefault();
      this.rememberDoubleClickCandidate(start.id, event);
      this.pendingClickNodeId = start.id;
      this.canvas.style.cursor = 'pointer';
      return;
    }

    const dragAction = this.resolvePointerStartAction('drag', button, modifiers, start);
    if (dragAction === 'panCanvas') {
      event.preventDefault();
      this.canvas.style.cursor = 'move';
      return;
    }

    if (dragAction === 'createEdge' && start.kind === 'node' && start.id) {
      event.preventDefault();
      this.hoveredNodeId = start.id;
      this.hoveredEdgeId = null;
      this.canvas.style.cursor = 'grabbing';
    }
  };

  private readonly handleWindowMouseMove = (event: MouseEvent) => {
    if (this.linkDragSourceId) {
      this.pointer = this.clientToCanvasPoint(event.clientX, event.clientY);
      this.refreshHoverState();
      this.didPan = true;
      return;
    }

    if (this.draggedNodeId) {
      const point = this.clientToCanvasPoint(event.clientX, event.clientY);
      this.dragTarget = this.screenToWorld(point.x, point.y);
      this.simulation?.alpha(0.18).restart();
      this.didPan = true;
      return;
    }

    if (this.isRotating) {
      const previous = this.clientToCanvasPoint(this.lastPointer.x, this.lastPointer.y);
      const next = this.clientToCanvasPoint(event.clientX, event.clientY);
      const center = this.currentCameraLookAt();
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.camera.rotation += getRotationDeltaAroundCenter(previous, next, this.width, this.height);
      this.setCameraOffsetForWorldPoint(center, this.width / 2, this.height / 2);
      this.didPan ||= Math.hypot(next.x - previous.x, next.y - previous.y) > 2;
      return;
    }

    if (this.pointerDownState && !this.activePointerAction) {
      const distance = Math.hypot(
        event.clientX - this.pointerDownState.clientX,
        event.clientY - this.pointerDownState.clientY,
      );
      if (distance < DRAG_START_THRESHOLD_PX) {
        return;
      }

      const dragAction = this.resolvePointerStartAction(
        'drag',
        this.pointerDownState.button,
        this.pointerDownState.modifiers,
        this.pointerDownState.start,
      );
      if (!dragAction) {
        return;
      }

      this.didPan = true;
      this.activePointerAction = dragAction;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      const point = this.clientToCanvasPoint(event.clientX, event.clientY);

      if (dragAction === 'dragNode' && this.pointerDownState.start.kind === 'node' && this.pointerDownState.start.id) {
        this.draggedNodeId = this.pointerDownState.start.id;
        this.dragTarget = this.screenToWorld(point.x, point.y);
        this.options.onSelectNode(this.pointerDownState.start.id);
        this.canvas.style.cursor = 'grabbing';
        this.simulation?.alpha(0.3).restart();
        return;
      }

      if (dragAction === 'createEdge' && this.pointerDownState.start.kind === 'node' && this.pointerDownState.start.id) {
        this.linkDragSourceId = this.pointerDownState.start.id;
        this.hoveredNodeId = this.pointerDownState.start.id;
        this.hoveredEdgeId = null;
        this.canvas.style.cursor = 'grabbing';
        this.simulation?.alpha(0.3).restart();
        return;
      }

      if (dragAction === 'rotateCanvas') {
        this.isRotating = true;
        this.canvas.style.cursor = 'alias';
        return;
      }

      if (dragAction === 'panCanvas') {
        this.isPanning = true;
        this.panButton = this.pointerDownState.button === 'middle' ? 1 : this.pointerDownState.button === 'right' ? 2 : 0;
        if (!this.didClearFocusForPan) {
          this.didClearFocusForPan = true;
          this.options.onClearFocus();
        }
        this.canvas.style.cursor = 'move';
        return;
      }
    }

    if (!this.isPanning) {
      return;
    }

    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.camera.x += dx;
    this.camera.y += dy;
    this.didPan ||= Math.abs(dx) + Math.abs(dy) > 2;
    if (this.didPan && !this.didClearFocusForPan) {
      this.didClearFocusForPan = true;
      this.options.onClearFocus();
    }
  };

  private readonly handleWindowMouseUp = (event: MouseEvent) => {
    if (this.linkDragSourceId) {
      const sourceId = this.linkDragSourceId;
      const point = this.clientToCanvasPoint(event.clientX, event.clientY);
      const target = this.pickNode(point.x, point.y);
      const end = this.pickPointerTarget(point.x, point.y);
      const shouldCreateEdge = this.pointerDownState
        && this.activePointerAction === 'createEdge'
        && this.resolvePointerAction('drag', this.pointerDownState.button, this.pointerDownState.modifiers, this.pointerDownState.start, end) === 'createEdge';
      if (shouldCreateEdge && target && target.nodeId !== sourceId) {
        this.options.onCreateEdge(sourceId, target.nodeId);
      }
      this.linkDragSourceId = null;
      this.activePointerAction = null;
      this.pointerDownState = null;
      this.hoveredNodeId = target?.nodeId ?? null;
      this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
      return;
    }

    if (this.draggedNodeId) {
      this.draggedNodeId = null;
      this.activePointerAction = null;
      this.pointerDownState = null;
      this.dragTarget = null;
      this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
      return;
    }

    if (this.isRotating) {
      this.isRotating = false;
      this.activePointerAction = null;
      this.pointerDownState = null;
      this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
      return;
    }

    if (!this.isPanning) {
      return;
    }

    if (this.panButton !== null && event.button !== this.panButton) {
      return;
    }

    this.isPanning = false;
    this.panButton = null;
    this.activePointerAction = null;
    this.pointerDownState = null;
    this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
  };

  private readonly handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private readonly handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.pointer = { x: event.offsetX, y: event.offsetY };
    const before = this.screenToWorld(event.offsetX, event.offsetY);
    const nextScale = clamp(this.camera.scale * (event.deltaY > 0 ? 0.9 : 1.1), 0.18, 3.2);
    this.camera.scale = nextScale;
    this.setCameraOffsetForWorldPoint(before, event.offsetX, event.offsetY);
  };

  private readonly handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  private readonly handleDrop = (event: DragEvent) => {
    event.preventDefault();
    extractDroppedFileReferences(event.dataTransfer).forEach((pathOrUri) => {
      this.options.onImportFile(pathOrUri);
    });
  };

  private readonly handleClick = (event: MouseEvent) => {
    if (this.didPan) {
      this.didPan = false;
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      this.doubleClickCandidate = null;
      this.pointerDownState = null;
      return;
    }

    const button = normalizeMouseButton(event.button) ?? this.pointerDownState?.button ?? 'left';
    const modifiers = this.pointerDownState?.modifiers ?? getPointerModifiers(event);
    const start = this.pointerDownState?.start ?? this.pickPointerTarget(event.offsetX, event.offsetY);
    const end = this.pickPointerTarget(event.offsetX, event.offsetY);
    const action = this.resolvePointerAction('click', button, modifiers, start, end);
    this.pointerDownState = null;

    if (action === 'selectNode' && this.pendingClickNodeId && this.runtimeNodes.has(this.pendingClickNodeId)) {
      this.options.onSelectNode(this.pendingClickNodeId);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    const document = this.options.getDocument();
    if (action === 'selectEdge' && this.pendingClickEdgeId && document.graph.edges[this.pendingClickEdgeId]) {
      this.options.onSelectEdge(this.pendingClickEdgeId);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    const repeatedNodeId = this.getDoubleClickCandidateNodeId(event);
    if (action === 'selectNode' && repeatedNodeId) {
      this.options.onSelectNode(repeatedNodeId);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    if (action === 'selectNode' && start.kind === 'node' && start.id) {
      this.options.onSelectNode(start.id);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    if (action === 'selectEdge' && start.kind === 'link' && start.id) {
      this.options.onSelectEdge(start.id);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    this.pendingClickNodeId = null;
    this.pendingClickEdgeId = null;
    if (event.detail < 2) {
      this.doubleClickCandidate = null;
    }
    if (action === 'clearFocus') {
      this.options.onClearFocus();
    }
  };

  private readonly handleDoubleClick = (event: MouseEvent) => {
    const hit = this.pickNode(event.offsetX, event.offsetY);
    const nodeId = hit?.nodeId ?? this.getDoubleClickCandidateNodeId(event);
    const target = nodeId ? { kind: 'node', id: nodeId } satisfies PointerTargetRef : this.pickPointerTarget(event.offsetX, event.offsetY);
    const button = normalizeMouseButton(event.button) ?? 'left';
    const action = this.resolvePointerAction('dblclick', button, getPointerModifiers(event), target, target);
    if (action !== 'openNodeTarget' || !nodeId) {
      return;
    }

    event.preventDefault();
    this.doubleClickCandidate = null;
    this.options.onOpenNode(nodeId);
  };

  private resolvePointerAction(
    gesture: 'click' | 'dblclick' | 'drag',
    button: PointerButton,
    modifiers: PointerModifier[],
    start: PointerTargetRef,
    end: PointerTargetRef,
  ): StarsPointerActionId | null {
    const document = this.options.getDocument();
    const command = resolvePointerInputTreeAction({
      gesture,
      button,
      modifiers,
      start,
      end,
      focus: getFocusToken(document.view),
    }, this.options.getInputTree());
    return isStarsPointerActionId(command) ? command : null;
  }

  private resolvePointerStartAction(
    gesture: 'drag',
    button: PointerButton,
    modifiers: PointerModifier[],
    start: PointerTargetRef,
  ): StarsPointerActionId | null {
    const document = this.options.getDocument();
    const command = resolvePointerInputTreeStartAction({
      gesture,
      button,
      modifiers,
      start,
      focus: getFocusToken(document.view),
    }, this.options.getInputTree());
    return isStarsPointerActionId(command) ? command : null;
  }

  private pickPointerTarget(screenX: number, screenY: number): PointerTargetRef {
    const node = this.pickNode(screenX, screenY);
    if (node) {
      return { kind: 'node', id: node.nodeId };
    }

    const edge = this.pickEdge(screenX, screenY);
    if (edge) {
      return { kind: 'link', id: edge.id };
    }

    return { kind: 'background' };
  }

  private deletePointerTarget(target: PointerTargetRef) {
    if (target.kind === 'node' && target.id) {
      this.options.onDeleteNode(target.id);
      return;
    }

    if (target.kind === 'link' && target.id) {
      this.options.onDeleteEdge(target.id);
    }
  }

  private rememberDoubleClickCandidate(nodeId: string, event: MouseEvent) {
    this.doubleClickCandidate = {
      nodeId,
      clientX: event.clientX,
      clientY: event.clientY,
      timestamp: performance.now(),
    };
  }

  private getDoubleClickCandidateNodeId(event: MouseEvent): string | null {
    if (event.detail < 2 || !this.doubleClickCandidate) {
      return null;
    }

    if (performance.now() - this.doubleClickCandidate.timestamp > DOUBLE_CLICK_TARGET_MAX_AGE_MS) {
      this.doubleClickCandidate = null;
      return null;
    }

    if (!this.options.getDocument().graph.nodes[this.doubleClickCandidate.nodeId]) {
      this.doubleClickCandidate = null;
      return null;
    }

    const distance = Math.hypot(
      event.clientX - this.doubleClickCandidate.clientX,
      event.clientY - this.doubleClickCandidate.clientY,
    );
    return distance <= DOUBLE_CLICK_TARGET_RADIUS_PX ? this.doubleClickCandidate.nodeId : null;
  }

  private frame = () => {
    this.render(performance.now());
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private render(now: number) {
    const deltaTime = this.lastFrameTime ? now - this.lastFrameTime : 16.67;
    this.lastFrameTime = now;
    const document = this.options.getDocument();
    this.syncRuntimeGraph(document);
    this.rebuildQuadtree();
    this.applyPointerDragForce();
    this.applyFocusCamera(document, deltaTime);
    this.refreshHoverState();

    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);

    const background = ctx.createLinearGradient(0, 0, 0, this.height);
    background.addColorStop(0, '#07070b');
    background.addColorStop(1, '#030305');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawNoise(ctx);
    this.drawLinks(ctx, document);
    this.drawLinkDragPreview(ctx);
    this.drawNodes(ctx, document, now);
    this.updateTooltip(document);
    this.keepSimulationAlive(document.graph.config);
  }

  private createTooltipElement() {
    if (this.tooltipElement) {
      return;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';
    tooltip.hidden = true;
    (this.canvas.parentElement ?? document.body).appendChild(tooltip);
    this.tooltipElement = tooltip;
  }

  private updateTooltip(document: GraphDocument) {
    if (!this.tooltipElement || !this.pointer || !this.hoveredNodeId || this.draggedNodeId || this.linkDragSourceId) {
      this.hideTooltip();
      return;
    }

    const node = document.graph.nodes[this.hoveredNodeId];
    if (!node) {
      this.hideTooltip();
      return;
    }

    const summaryHtml = renderSummaryMarkdown(node.summary ?? '');
    this.tooltipElement.innerHTML = [
      `<div class="graph-tooltip-title">${escapeHtml(node.label)}</div>`,
      summaryHtml ? `<div class="graph-tooltip-summary">${summaryHtml}</div>` : '',
    ].join('');
    this.tooltipElement.hidden = false;

    const tooltipWidth = this.tooltipElement.offsetWidth;
    const tooltipHeight = this.tooltipElement.offsetHeight;
    const left = Math.min(this.pointer.x + 18, Math.max(12, this.width - tooltipWidth - 12));
    const top = Math.min(this.pointer.y + 18, Math.max(12, this.height - tooltipHeight - 12));
    this.tooltipElement.style.left = `${left}px`;
    this.tooltipElement.style.top = `${top}px`;
  }

  private hideTooltip() {
    if (this.tooltipElement) {
      this.tooltipElement.hidden = true;
    }
  }

  private syncRuntimeGraph(document: GraphDocument) {
    const nodes = Object.values(document.graph.nodes);
    const nodeIds = new Set(nodes.map((node) => node.id));

    [...this.runtimeNodes.keys()].forEach((nodeId) => {
      if (!nodeIds.has(nodeId)) {
        this.runtimeNodes.delete(nodeId);
      }
    });

    const shouldSeedNewNodesAtViewCenter = this.runtimeNodes.size > 0;

    nodes.forEach((node, index) => {
      const radius = this.getNodeWorldRadius(node, document);
      const existing = this.runtimeNodes.get(node.id);
      if (existing) {
        existing.radius = radius;
        return;
      }

      const angle = index * 2.399963229728653;
      const distance = Math.sqrt(index + 1) * 82;
      const center = shouldSeedNewNodesAtViewCenter ? this.currentCameraLookAt() : null;
      this.runtimeNodes.set(node.id, {
        nodeId: node.id,
        x: center ? center.x : Math.cos(angle) * distance,
        y: center ? center.y : Math.sin(angle) * distance,
        radius,
      });
    });

    const signature = createGraphSignature(document);
    if (signature !== this.graphSignature) {
      this.graphSignature = signature;
      this.rebuildSimulation(document);
    }
  }

  private rebuildSimulation(document: GraphDocument) {
    const layout = document.graph.config.layout;
    const nodes = [...this.runtimeNodes.values()];
    const links: RuntimeLinkState[] = Object.values(document.graph.edges)
      .filter((edge) => this.runtimeNodes.has(edge.sourceId) && this.runtimeNodes.has(edge.targetId))
      .map((edge) => ({
        edgeId: edge.id,
        type: edge.type,
        source: edge.sourceId,
        target: edge.targetId,
      }));

    this.simulation?.stop();
    const rendering = document.graph.config.rendering;
    this.simulation = forceSimulation<RuntimeNodeState, RuntimeLinkState>(nodes)
      .force('link', forceLink<RuntimeNodeState, RuntimeLinkState>(links)
        .id((node) => node.nodeId)
        .distance(layout.linkDistance)
        .strength(layout.linkStrength))
      .force('charge', forceManyBody<RuntimeNodeState>()
        .strength(layout.chargeStrength)
        .distanceMax(layout.chargeDistanceMax))
      .force('collide', forceCollide<RuntimeNodeState>()
        .radius((node) => Math.max(
          node.radius + (rendering.focusRadius - rendering.baseNodeRadius) + layout.collisionPadding,
          rendering.focusRadius,
        ))
        .strength(layout.collisionStrength))
      .force('centerX', forceX<RuntimeNodeState>(0).strength(layout.centerStrength))
      .force('centerY', forceY<RuntimeNodeState>(0).strength(layout.centerStrength))
      .alphaDecay(layout.alphaDecay)
      .alphaMin(0)
      .velocityDecay(layout.velocityDecay)
      .alpha(Math.max(0.8, layout.alphaFloor))
      .restart();
  }

  private keepSimulationAlive(config: GraphConfig) {
    if (!this.simulation) {
      return;
    }

    if (this.simulation.alpha() < config.layout.alphaFloor) {
      this.simulation.alpha(config.layout.alphaFloor).restart();
    }
  }

  private rebuildQuadtree() {
    this.quadtreeIndex = quadtree<RuntimeNodeState>()
      .x((node) => node.x ?? 0)
      .y((node) => node.y ?? 0)
      .addAll([...this.runtimeNodes.values()]);
  }

  private refreshHoverState() {
    if (!this.pointer) {
      this.hoveredNodeId = null;
      this.hoveredEdgeId = null;
      return;
    }

    const node = this.pickNode(this.pointer.x, this.pointer.y);
    this.hoveredNodeId = node?.nodeId ?? null;
    this.hoveredEdgeId = node ? null : this.pickEdge(this.pointer.x, this.pointer.y)?.id ?? null;
  }

  private drawNoise(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#4facfe';

    for (let index = 0; index < 40; index += 1) {
      const x = (index * 173) % Math.max(this.width, 1);
      const y = (index * 97) % Math.max(this.height, 1);
      ctx.fillRect(x, y, 1.2, 1.2);
    }

    ctx.restore();
  }

  private drawLinks(ctx: CanvasRenderingContext2D, document: GraphDocument) {
    const subjects = this.getNodeSubjectIds(document);
    const related = this.getRelatedNodeIds(document, subjects);

    ctx.save();

    Object.values(document.graph.edges).forEach((edge) => {
      const source = this.runtimeNodes.get(edge.sourceId);
      const target = this.runtimeNodes.get(edge.targetId);
      if (!source || !target) {
        return;
      }

      const from = this.worldToScreen(source.x ?? 0, source.y ?? 0);
      const to = this.worldToScreen(target.x ?? 0, target.y ?? 0);
      const sourceIsSubject = subjects.has(edge.sourceId);
      const targetIsSubject = subjects.has(edge.targetId);
      const sourceIsRelated = related.has(edge.sourceId);
      const targetIsRelated = related.has(edge.targetId);
      const isDirectFocus = sourceIsSubject || targetIsSubject;
      const focused = edge.id === document.view.selectedEdgeId;
      const isTarget = focused || edge.id === this.hoveredEdgeId;
      const isNearby = isDirectFocus || sourceIsRelated || targetIsRelated;
      const style = document.graph.edgeTypes[edge.type]?.style;
      const color = style?.color ?? '#666666';
      const opacity = isTarget
        ? 1
        : isDirectFocus
          ? document.graph.config.rendering.relatedOpacity
          : isNearby
            ? document.graph.config.rendering.relatedOpacity
            : 0.3;

      const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'rgba(255,255,255,0.24)');

      ctx.setLineDash(style?.dash ?? []);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = (isTarget ? 4 : isDirectFocus ? 2.5 : style?.width ?? 1.5) * Math.sqrt(this.camera.scale);
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      if (this.shouldDrawEdgeLabel(edge, style?.labelVisible, isTarget)) {
        this.drawEdgeLabel(ctx, edge, from, to, color);
      }
    });

    ctx.restore();
  }

  private drawLinkDragPreview(ctx: CanvasRenderingContext2D) {
    if (!this.linkDragSourceId || !this.pointer) {
      return;
    }

    const source = this.runtimeNodes.get(this.linkDragSourceId);
    if (!source) {
      return;
    }

    const from = this.worldToScreen(source.x ?? 0, source.y ?? 0);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = this.hoveredNodeId && this.hoveredNodeId !== this.linkDragSourceId ? '#ffffff' : '#666666';
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(this.pointer.x, this.pointer.y);
    ctx.stroke();
    ctx.restore();
  }

  private shouldDrawEdgeLabel(edge: EdgeMeta, labelVisible: string | undefined, isDirectFocus: boolean): boolean {
    if (!edge.label && !edge.type) {
      return false;
    }
    if (labelVisible === 'never') {
      return false;
    }
    if (labelVisible === 'always') {
      return true;
    }
    return isDirectFocus;
  }

  private drawEdgeLabel(
    ctx: CanvasRenderingContext2D,
    edge: EdgeMeta,
    from: ScreenPoint,
    to: ScreenPoint,
    color: string,
  ) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.font = '11px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(edge.label ?? edge.type, (from.x + to.x) / 2, ((from.y + to.y) / 2) - 8);
    ctx.restore();
  }

  private drawNodes(ctx: CanvasRenderingContext2D, document: GraphDocument, now: number) {
    const rendering = document.graph.config.rendering;
    const pulse = Math.sin(now * rendering.pulseSpeed) * 0.5 + 1;

    ctx.save();

    Object.values(document.graph.nodes).forEach((node) => {
      const runtime = this.runtimeNodes.get(node.id);
      if (!runtime) {
        return;
      }

      const selected = node.id === document.view.selectedNodeId;
      const hovered = node.id === this.hoveredNodeId;
      const focusLike = selected || hovered;
      const style = node.type ? document.graph.nodeTypes[node.type]?.style : undefined;
      const point = this.worldToScreen(runtime.x ?? 0, runtime.y ?? 0);
      const baseWorldRadius = this.getRenderBaseWorldRadius(runtime.radius, selected, rendering);
      const basePixelRadius = baseWorldRadius * this.camera.scale;
      const nodeScale = this.getNodeScale(point, baseWorldRadius, rendering.maxNodeScaleMultiplier, rendering, true);
      const textScale = focusLike
        ? rendering.maxTextScaleMultiplier
        : this.getProximityScale(point, rendering.maxTextScaleMultiplier, rendering, false);
      const color = node.color ?? style?.color ?? '#4facfe';
      const minRadius = selected ? rendering.minFocusNodePixelSize : rendering.minNodePixelSize;
      let radius = Math.max(basePixelRadius, minRadius) * nodeScale;
      const glowRadius = Math.max(selected ? 10 : 5, (selected ? 35 : 15) * this.camera.scale) * nodeScale;

      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowBlur = selected ? glowRadius * pulse : glowRadius;
      ctx.shadowColor = color;
      ctx.fill();

      ctx.shadowBlur = 0;
      if (this.shouldDrawNodeLabel(node, selected, hovered, style?.labelVisible, textScale, rendering)) {
        const fontSize = rendering.baseLabelFontSize * Math.sqrt(this.camera.scale) * textScale;
        if (fontSize > rendering.minLabelPixelSize) {
          ctx.globalAlpha = selected || hovered ? 1 : 0.82;
          ctx.fillStyle = selected || hovered ? '#ffffff' : 'rgba(220,220,220,0.82)';
          ctx.font = `${selected ? 'bold' : 'normal'} ${fontSize}px Segoe UI`;
          ctx.textAlign = 'center';
          ctx.fillText(node.label, point.x, point.y + radius + fontSize + 2);

          if ((selected || hovered) && node.metrics?.contentLength) {
            ctx.fillStyle = 'rgba(160,160,160,0.72)';
            ctx.font = `${Math.max(9, fontSize * 0.78)}px Segoe UI`;
            ctx.fillText(`${node.metrics.contentLength}`, point.x, point.y + radius + (fontSize * 2.15) + 4);
          }
        }
      }
    });

    ctx.restore();
  }

  private shouldDrawNodeLabel(
    node: NodeMeta,
    selected: boolean,
    hovered: boolean,
    labelVisible: string | undefined,
    textScale: number,
    rendering: GraphConfig['rendering'],
  ): boolean {
    if (!node.label) {
      return false;
    }
    if (selected || hovered) {
      return true;
    }
    if (labelVisible === 'always') {
      return true;
    }
    if (labelVisible === 'focus' || labelVisible === 'hover') {
      return false;
    }
    return this.camera.scale > rendering.labelZoomThreshold || textScale > 1.1;
  }

  private getNodeWorldRadius(node: NodeMeta, document: GraphDocument): number {
    const rendering = document.graph.config.rendering;
    const style = node.type ? document.graph.nodeTypes[node.type]?.style : undefined;
    const typeRadius = Math.min(style?.radius ?? rendering.baseNodeRadius, rendering.baseNodeRadius);
    const contentLength = node.metrics?.contentLength ?? 0;
    const degree = document.graph.adjacency[node.id]?.length ?? 0;
    return typeRadius
      + Math.sqrt(contentLength / rendering.contentLengthDivisor)
      + (Math.sqrt(degree) * rendering.degreeRadiusBoost);
  }

  private getRenderBaseWorldRadius(
    baseWorldRadius: number,
    selected: boolean,
    rendering: GraphConfig['rendering'],
  ): number {
    if (!selected || baseWorldRadius >= rendering.focusRadius) {
      return baseWorldRadius;
    }

    return Math.min(rendering.maxNodeScaleMultiplier * baseWorldRadius, rendering.focusRadius);
  }

  private getProximityScale(
    point: ScreenPoint,
    maxScale: number,
    rendering: GraphConfig['rendering'],
    compensateZoom: boolean,
  ): number {
    if (!this.pointer || maxScale <= 1) {
      return 1;
    }

    const dx = point.x - this.pointer.x;
    const dy = point.y - this.pointer.y;
    const zoomFactor = compensateZoom ? Math.sqrt(this.camera.scale) : this.camera.scale;
    const distance = Math.hypot(dx, dy) / Math.max(zoomFactor, 0.001);
    if (distance < rendering.hoverStopRange) {
      return maxScale;
    }
    if (distance >= rendering.proximityRange) {
      return 1;
    }

    const ratio = 1 - ((distance - rendering.hoverStopRange) / (rendering.proximityRange - rendering.hoverStopRange));
    return 1 + ((maxScale - 1) * ratio * ratio);
  }

  private getNodeScale(
    point: ScreenPoint,
    baseWorldRadius: number,
    maxScale: number,
    rendering: GraphConfig['rendering'],
    compensateZoom: boolean,
  ): number {
    if (baseWorldRadius >= rendering.focusRadius) {
      return 1;
    }

    const cappedMaxScale = Math.max(1, Math.min(maxScale, rendering.focusRadius / Math.max(baseWorldRadius, 0.001)));
    return this.getProximityScale(point, cappedMaxScale, rendering, compensateZoom);
  }

  private getNodeSubjectIds(document: GraphDocument): Set<string> {
    const subjects = new Set<string>();
    if (document.view.selectedNodeId) {
      subjects.add(document.view.selectedNodeId);
    }
    if (this.hoveredNodeId) {
      subjects.add(this.hoveredNodeId);
    }
    return subjects;
  }

  private getRelatedNodeIds(document: GraphDocument, subjects: Set<string>): Set<string> {
    const related = new Set<string>();
    subjects.forEach((nodeId) => {
      (document.graph.adjacency[nodeId] ?? []).forEach((edgeId) => {
        const edge = document.graph.edges[edgeId];
        if (!edge) {
          return;
        }
        related.add(edge.sourceId === nodeId ? edge.targetId : edge.sourceId);
      });
    });
    return related;
  }

  private screenToWorld(screenX: number, screenY: number) {
    const cos = Math.cos(this.camera.rotation);
    const sin = Math.sin(this.camera.rotation);
    const cameraX = (screenX - (this.width / 2) - this.camera.x) / this.camera.scale;
    const cameraY = (screenY - (this.height / 2) - this.camera.y) / this.camera.scale;

    return {
      x: (cameraX * cos) + (cameraY * sin),
      y: (-cameraX * sin) + (cameraY * cos),
    };
  }

  private worldToScreen(worldX: number, worldY: number) {
    const projected = this.projectWorldToCameraPlane({ x: worldX, y: worldY });
    return {
      x: (this.width / 2) + this.camera.x + (projected.x * this.camera.scale),
      y: (this.height / 2) + this.camera.y + (projected.y * this.camera.scale),
    };
  }

  private projectWorldToCameraPlane(point: ScreenPoint): ScreenPoint {
    const cos = Math.cos(this.camera.rotation);
    const sin = Math.sin(this.camera.rotation);
    return {
      x: (point.x * cos) - (point.y * sin),
      y: (point.x * sin) + (point.y * cos),
    };
  }

  private setCameraOffsetForWorldPoint(point: ScreenPoint, screenX: number, screenY: number) {
    const projected = this.projectWorldToCameraPlane(point);
    this.camera.x = screenX - (this.width / 2) - (projected.x * this.camera.scale);
    this.camera.y = screenY - (this.height / 2) - (projected.y * this.camera.scale);
  }

  private applyPointerDragForce() {
    if (!this.draggedNodeId || !this.dragTarget) {
      return;
    }

    const runtime = this.runtimeNodes.get(this.draggedNodeId);
    if (!runtime) {
      return;
    }

    const dx = this.dragTarget.x - (runtime.x ?? 0);
    const dy = this.dragTarget.y - (runtime.y ?? 0);
    const distance = Math.hypot(dx, dy);
    const strength = 0.02 * (1 - Math.exp(-distance / 120));
    runtime.vx = (runtime.vx ?? 0) + (dx * strength);
    runtime.vy = (runtime.vy ?? 0) + (dy * strength);
  }

  private applyFocusCamera(document: GraphDocument, deltaTime: number) {
    const focusedPoint = this.getFocusedWorldPoint(document);
    if (!focusedPoint) {
      this.cameraLookAt = this.currentCameraLookAt();
      return;
    }

    if (this.isPanning) {
      this.cameraLookAt = this.currentCameraLookAt();
      return;
    }

    if (!this.cameraLookAt) {
      this.cameraLookAt = this.currentCameraLookAt();
    }

    const ease = 1 - Math.pow(0.9, deltaTime / 16.67);
    this.cameraLookAt.x += (focusedPoint.x - this.cameraLookAt.x) * ease;
    this.cameraLookAt.y += (focusedPoint.y - this.cameraLookAt.y) * ease;
    this.setCameraOffsetForWorldPoint(this.cameraLookAt, this.width / 2, this.height / 2);
  }

  private currentCameraLookAt(): ScreenPoint {
    return this.screenToWorld(this.width / 2, this.height / 2);
  }

  private getFocusedWorldPoint(document: GraphDocument): ScreenPoint | null {
    if (document.view.selectedNodeId) {
      const node = this.runtimeNodes.get(document.view.selectedNodeId);
      return node ? { x: node.x ?? 0, y: node.y ?? 0 } : null;
    }

    if (document.view.selectedEdgeId) {
      const edge = document.graph.edges[document.view.selectedEdgeId];
      const source = edge ? this.runtimeNodes.get(edge.sourceId) : null;
      const target = edge ? this.runtimeNodes.get(edge.targetId) : null;
      if (source && target) {
        return {
          x: ((source.x ?? 0) + (target.x ?? 0)) / 2,
          y: ((source.y ?? 0) + (target.y ?? 0)) / 2,
        };
      }
    }

    return null;
  }

  private clientToCanvasPoint(clientX: number, clientY: number): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private pickNode(screenX: number, screenY: number) {
    const document = this.options.getDocument();
    const rendering = document.graph.config.rendering;
    const world = this.screenToWorld(screenX, screenY);
    const searchRadius = Math.max(rendering.hoverStopRange / this.camera.scale, rendering.focusRadius);
    const nearest = this.quadtreeIndex?.find(world.x, world.y, searchRadius);
    if (!nearest) {
      return null;
    }

    const dx = world.x - (nearest.x ?? 0);
    const dy = world.y - (nearest.y ?? 0);
    const hitRadius = nearest.radius + (rendering.hoverStopRange / this.camera.scale);
    return (dx * dx) + (dy * dy) <= hitRadius * hitRadius ? nearest : null;
  }

  private pickEdge(screenX: number, screenY: number): EdgeMeta | null {
    const document = this.options.getDocument();
    const world = this.screenToWorld(screenX, screenY);
    const hitDistance = document.graph.config.rendering.edgeHoverDistance / Math.max(this.camera.scale, 0.001);

    for (const edge of Object.values(document.graph.edges)) {
      const source = this.runtimeNodes.get(edge.sourceId);
      const target = this.runtimeNodes.get(edge.targetId);
      if (!source || !target) {
        continue;
      }

      const distance = distanceToSegment(
        world.x,
        world.y,
        source.x ?? 0,
        source.y ?? 0,
        target.x ?? 0,
        target.y ?? 0,
      );
      if (distance <= hitDistance) {
        return edge;
      }
    }

    return null;
  }
}

function createGraphSignature(document: GraphDocument): string {
  const nodePart = Object.values(document.graph.nodes)
    .map((node) => `${node.id}:${node.type ?? ''}:${node.metrics?.contentLength ?? 0}`)
    .sort()
    .join('|');
  const edgePart = Object.values(document.graph.edges)
    .map((edge) => `${edge.id}:${edge.sourceId}->${edge.targetId}:${edge.type}`)
    .sort()
    .join('|');
  const layout = document.graph.config.layout;
  const rendering = document.graph.config.rendering;
  return [
    nodePart,
    edgePart,
    layout.linkDistance,
    layout.linkStrength,
    layout.chargeStrength,
    layout.chargeDistanceMax,
    layout.collisionPadding,
    layout.collisionStrength,
    layout.centerStrength,
    layout.alphaFloor,
    layout.alphaDecay,
    layout.velocityDecay,
    rendering.baseNodeRadius,
    rendering.contentLengthDivisor,
    rendering.degreeRadiusBoost,
  ].join('::');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const ratio = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (x1 + ratio * dx), py - (y1 + ratio * dy));
}

function getRotationDeltaAroundCenter(previous: ScreenPoint, next: ScreenPoint, width: number, height: number): number {
  const centerX = width / 2;
  const centerY = height / 2;
  const previousDx = previous.x - centerX;
  const previousDy = previous.y - centerY;
  const nextDx = next.x - centerX;
  const nextDy = next.y - centerY;

  if (Math.hypot(previousDx, previousDy) < 24 || Math.hypot(nextDx, nextDy) < 24) {
    return clamp((next.x - previous.x) * 0.006, -0.18, 0.18);
  }

  return clamp(normalizeAngle(Math.atan2(nextDy, nextDx) - Math.atan2(previousDy, previousDx)), -0.18, 0.18);
}

function normalizeAngle(angle: number): number {
  let nextAngle = angle;
  while (nextAngle > Math.PI) {
    nextAngle -= Math.PI * 2;
  }
  while (nextAngle < -Math.PI) {
    nextAngle += Math.PI * 2;
  }
  return nextAngle;
}

function extractDroppedFileReferences(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) {
    return [];
  }

  const references = new Set<string>();
  const uriList = dataTransfer.getData('text/uri-list');
  uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => references.add(line));

  const plainText = dataTransfer.getData('text/plain').trim();
  if (plainText && !plainText.includes('\n')) {
    references.add(plainText);
  }

  Array.from(dataTransfer.files).forEach((file) => {
    if (file.name) {
      references.add(file.name);
    }
  });

  return [...references];
}
```

## `lib\stores\graph.ts`

```typescript
import { derived, get, writable } from 'svelte/store';
import { createInitialDocument } from '../core/defaults';
import { applyGraphOperation, type GraphOperation } from '../core/operations';
import { DEFAULT_USER_PREFERENCES, mergeUserPreferences } from '../core/preferences';
import type { LinkedFileOpenMode, StarsUserPreferences } from '../core/preferences';
import type { StarsInputTree } from '../input/inputTree';
import {
  assertGraphDocumentConfig,
  resolveNodeAction,
  type EdgeId,
  type EdgeMeta,
  type GraphDocument,
  type GraphFile,
  type NodeId,
  type NodeInteractionTrigger,
  type NodeMeta,
  type RuntimeViewState,
} from '../core/schema';
import { createDefaultRepository } from '../persistence/defaultrepository';
import type { GraphRepository } from '../persistence/repository';
import type { WorkspaceFileInfo } from '../persistence/repository';

type NodePatch = Partial<Pick<NodeMeta, 'label' | 'summary' | 'type' | 'color' | 'subgraph'>>;
type GraphConfigPatch = Extract<GraphOperation, { kind: 'patchGraphConfig' }>['patch'];
type FocusTarget = { kind: 'node'; id: NodeId } | { kind: 'edge'; id: EdgeId };

const NAVIGATION_STACK_LIMIT = 50;

export function createGraphController(repository: GraphRepository = createDefaultRepository()) {
  const document = writable<GraphDocument>(createInitialDocument());
  const ready = writable(false);
  const saving = writable(false);
  const error = writable<string | null>(null);
  const preferences = writable<StarsUserPreferences>(DEFAULT_USER_PREFERENCES);

  const undoStack = writable<GraphOperation[]>([]);
  const redoStack = writable<GraphOperation[]>([]);
  const navigationStack = writable<FocusTarget[]>([]);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let operationQueue = Promise.resolve();

  const selectedNode = derived(document, ($document) => {
    const selectedNodeId = $document.view.selectedNodeId;
    return selectedNodeId ? ($document.graph.nodes[selectedNodeId] ?? null) : null;
  });

  const selectedEdge = derived(document, ($document) => {
    const selectedEdgeId = $document.view.selectedEdgeId;
    return selectedEdgeId ? ($document.graph.edges[selectedEdgeId] ?? null) : null;
  });

  const selectedEdges = derived(document, ($document) => {
    const selectedNodeId = $document.view.selectedNodeId;
    if (!selectedNodeId) {
      return [];
    }
    return ($document.graph.adjacency[selectedNodeId] ?? [])
      .map((edgeId) => $document.graph.edges[edgeId])
      .filter((edge): edge is EdgeMeta => Boolean(edge));
  });

  async function hydrate() {
    try {
      const saved = await repository.load();
      if (saved) {
        assertGraphDocumentConfig(saved);
        document.set(repairFocus(saved, getFocusTarget(saved.view)));
      } else {
        const initial = createInitialDocument();
        document.set(initial);
        navigationStack.set([]);
        await repository.save(initial);
      }
      if (repository.loadPreferences) {
        preferences.set(mergeUserPreferences(await repository.loadPreferences()));
      }
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '载入数据失败');
      document.set(createInitialDocument());
      navigationStack.set([]);
    } finally {
      ready.set(true);
    }
  }

  function scheduleSave(next: GraphDocument) {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }

    saving.set(true);
    saveTimer = setTimeout(async () => {
      try {
        await repository.save(next);
        error.set(null);
      } catch (reason) {
        error.set(reason instanceof Error ? reason.message : '保存失败');
      } finally {
        saving.set(false);
      }
    }, 180);
  }

  function transact(mutator: (draft: GraphDocument) => void) {
    const draft = structuredClone(get(document)) as GraphDocument;
    mutator(draft);
    document.set(draft);
    scheduleSave(draft);
  }

  function applyLocalOperation(operation: GraphOperation, onCommitted: (inverse: GraphOperation) => void) {
    const current = get(document);
    const applied = applyGraphOperation(current.graph, operation);
    const next = repairFocus({
      ...current,
      graph: applied.graph,
    }, getFocusTarget(current.view));

    document.set(next);
    onCommitted(applied.inverse);
    scheduleSave(next);
  }

  async function commitOperation(operation: GraphOperation, onCommitted: (inverse: GraphOperation) => void) {
    try {
      if (!repository.applyOperation) {
        applyLocalOperation(operation, onCommitted);
        return;
      }

      const current = get(document);
      saving.set(true);
      const result = await repository.applyOperation(operation, current.graph.revision, current.view);
      assertGraphDocumentConfig(result.document);
      document.set(repairFocus(result.document, getFocusTarget(current.view)));
      onCommitted(result.inverse);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '操作失败');
      const latest = await repository.load().catch(() => null);
      if (latest) {
        replaceFromHost(latest);
      }
    } finally {
      saving.set(false);
    }
  }

  function enqueueOperation(operation: GraphOperation, onCommitted: (inverse: GraphOperation) => void) {
    operationQueue = operationQueue.then(() => commitOperation(operation, onCommitted));
    void operationQueue;
  }

  function submit(operation: GraphOperation) {
    enqueueOperation(operation, (inverse) => {
      undoStack.update((items) => [...items, inverse]);
      redoStack.set([]);
    });
  }

  function selectNode(nodeId: string, recordHistory = true, revealLinkedFile = true) {
    const current = get(document);
    const node = current.graph.nodes[nodeId];
    if (!node) {
      return;
    }

    focusTarget({ kind: 'node', id: nodeId }, recordHistory);
    if (revealLinkedFile) {
      void revealLinkedFileOnSelect(node);
    }
  }

  function selectEdge(edgeId: string, recordHistory = true) {
    const current = get(document);
    if (!current.graph.edges[edgeId]) {
      return;
    }

    focusTarget({ kind: 'edge', id: edgeId }, recordHistory);
  }

  function clearFocus(recordHistory = true) {
    const current = get(document);
    if (!current.view.selectedNodeId && !current.view.selectedEdgeId) {
      return;
    }

    const currentTarget = getFocusTarget(current.view);
    if (recordHistory && currentTarget && targetExists(current.graph, currentTarget)) {
      pushNavigationTarget(currentTarget, current.graph);
    }

    document.set({
      ...current,
      view: {
        ...current.view,
        selectedNodeId: null,
        selectedEdgeId: null,
      },
    });
  }

  function selectLinkedFile(path: string) {
    const normalizedPath = normalizeWorkspacePath(path);
    const current = get(document);
    const linkedNode = Object.values(current.graph.nodes).find((node) => {
      return node.file?.path && normalizeWorkspacePath(node.file.path) === normalizedPath;
    });

    if (!linkedNode) {
      return;
    }

    selectNode(linkedNode.id, true, false);
  }

  async function revealLinkedFileOnSelect(node: NodeMeta) {
    const mode = get(preferences).linkedFileOpenMode;
    if (mode === 'manual' || !node.file?.path || !repository.revealWorkspaceFile) {
      return;
    }

    try {
      await repository.revealWorkspaceFile(node.file.path, mode);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '切换关联文件失败');
    }
  }

  function replaceFromHost(nextDocument: GraphDocument) {
    try {
      assertGraphDocumentConfig(nextDocument);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '宿主推送的图元文件配置不完整');
      return;
    }

    const current = get(document);
    document.set(repairFocus({
      graph: nextDocument.graph,
      view: current.view,
    }, getFocusTarget(current.view)));
    undoStack.set([]);
    redoStack.set([]);
  }

  function replacePreferences(nextPreferences: Partial<StarsUserPreferences>) {
    preferences.set(mergeUserPreferences(nextPreferences));
  }

  async function updateInputTree(inputTree: StarsInputTree) {
    const nextPreferences = mergeUserPreferences({
      ...get(preferences),
      inputTree,
    });
    preferences.set(nextPreferences);

    if (!repository.savePreferences) {
      return;
    }

    try {
      await repository.savePreferences(nextPreferences);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '保存输入树失败');
    }
  }

  async function updateLinkedFileOpenMode(mode: LinkedFileOpenMode) {
    const nextPreferences = mergeUserPreferences({
      ...get(preferences),
      linkedFileOpenMode: mode,
    });
    preferences.set(nextPreferences);

    if (!repository.savePreferences) {
      return;
    }

    try {
      await repository.savePreferences(nextPreferences);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '保存偏好失败');
    }
  }

  function updateSelectedNode(patch: NodePatch) {
    const selectedNodeId = get(document).view.selectedNodeId;
    if (!selectedNodeId) {
      return;
    }

    submit({
      kind: 'patchNode',
      nodeId: selectedNodeId,
      patch,
    });
  }

  function updateGraphConfig(patch: GraphConfigPatch) {
    submit({
      kind: 'patchGraphConfig',
      patch,
    });
  }

  async function renameSelectedNodeLabel(label: string) {
    const nextLabel = label.trim();
    const selected = get(selectedNode);
    if (!selected || !nextLabel || nextLabel === selected.label) {
      return;
    }

    if (!selected.file) {
      updateSelectedNode({ label: nextLabel });
      return;
    }

    if (!repository.renameWorkspaceFile) {
      error.set('当前运行环境不能重命名工作区文件');
      return;
    }

    try {
      const info = await repository.renameWorkspaceFile(selected.file.path, nextLabel);
      submit({
        kind: 'patchNode',
        nodeId: selected.id,
        patch: {
          label: info.label,
          file: { kind: 'workspace-file', path: info.path },
          metrics: info.metrics,
        },
      });
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '重命名文件节点失败');
    }
  }

  async function importWorkspaceFile(pathOrUri: string) {
    const rawValue = pathOrUri.trim();
    if (!rawValue) {
      return;
    }

    try {
      const info = repository.resolveWorkspaceFile
        ? await repository.resolveWorkspaceFile(rawValue)
        : createLocalFileInfo(rawValue);
      ensureFileNode(info);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '导入文件节点失败');
    }
  }

  async function createFileNode(path: string) {
    const rawPath = path.trim();
    if (!rawPath) {
      error.set('请输入要创建的文件路径');
      return;
    }

    try {
      const info = repository.createWorkspaceFile
        ? await repository.createWorkspaceFile(rawPath)
        : createLocalFileInfo(rawPath);
      ensureFileNode(info);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '创建文件节点失败');
    }
  }

  function ensureFileNode(info: WorkspaceFileInfo) {
    const normalizedPath = normalizeWorkspacePath(info.path);
    const current = get(document);
    const sourceNodeId = current.view.selectedNodeId;
    const existing = Object.values(current.graph.nodes).find((node) => {
      return node.file?.path && normalizeWorkspacePath(node.file.path) === normalizedPath;
    });

    if (existing) {
      if (sourceNodeId && sourceNodeId !== existing.id) {
        createEdge(sourceNodeId, existing.id);
      }
      selectNode(existing.id);
      return;
    }

    const createdAt = Date.now();
    const node: NodeMeta = {
      id: crypto.randomUUID(),
      label: info.label,
      type: 'file',
      color: '#33ffff',
      file: { kind: 'workspace-file', path: info.path },
      metrics: info.metrics,
      createdAt,
      updatedAt: createdAt,
    };

    submit({
      kind: 'createNode',
      node,
    });

    if (sourceNodeId && current.graph.nodes[sourceNodeId]) {
      const edge: EdgeMeta = {
        id: crypto.randomUUID(),
        sourceId: sourceNodeId,
        targetId: node.id,
        type: 'related',
        createdAt,
        updatedAt: createdAt,
      };

      submit({
        kind: 'createEdge',
        edge,
      });
    }

    operationQueue = operationQueue.then(() => {
      selectNode(node.id);
    });
    void operationQueue;
  }

  function createLinkedNode() {
    createTypedNode('concept', '新节点', true);
  }

  function createTypedNode(type = 'concept', label = '新节点', linkToFocus = true) {
    const current = get(document);
    const sourceNodeId = current.view.selectedNodeId;
    const createdAt = Date.now();
    const node: NodeMeta = {
      id: crypto.randomUUID(),
      label: label.trim() || '新节点',
      type: type.trim() || 'concept',
      color: '#4facfe',
      createdAt,
      updatedAt: createdAt,
    };

    submit({
      kind: 'createNode',
      node,
    });

    if (linkToFocus && sourceNodeId && current.graph.nodes[sourceNodeId]) {
      const edge: EdgeMeta = {
        id: crypto.randomUUID(),
        sourceId: sourceNodeId,
        targetId: node.id,
        type: 'related',
        createdAt,
        updatedAt: createdAt,
      };

      submit({
        kind: 'createEdge',
        edge,
      });
    }

    operationQueue = operationQueue.then(() => {
      selectNode(node.id);
    });
    void operationQueue;
  }

  function createEdge(sourceId: string, targetId: string, type = 'related') {
    const current = get(document);
    if (sourceId === targetId) {
      error.set('不能创建自环关系');
      return;
    }
    if (!current.graph.nodes[sourceId] || !current.graph.nodes[targetId]) {
      error.set('无法创建关系，端点节点不存在');
      return;
    }

    const existingEdge = Object.values(current.graph.edges).find((edge) => {
      return edge.type === type
        && ((edge.sourceId === sourceId && edge.targetId === targetId)
          || (edge.sourceId === targetId && edge.targetId === sourceId));
    });
    if (existingEdge) {
      return;
    }

    const createdAt = Date.now();
    const edge: EdgeMeta = {
      id: crypto.randomUUID(),
      sourceId,
      targetId,
      type,
      createdAt,
      updatedAt: createdAt,
    };

    submit({
      kind: 'createEdge',
      edge,
    });

    void operationQueue;
  }

  function focusRoot() {
    const current = get(document);
    if (current.graph.nodes[current.graph.rootNodeId]) {
      selectNode(current.graph.rootNodeId);
    }
  }

  function deleteSelectedNode() {
    const current = get(document);
    const selectedNodeId = current.view.selectedNodeId;
    if (!selectedNodeId) {
      return;
    }

    deleteNode(selectedNodeId);
  }

  function deleteNode(nodeId: string) {
    const current = get(document);
    if (nodeId === current.graph.rootNodeId) {
      error.set('不能删除根节点');
      return;
    }
    if (!current.graph.nodes[nodeId]) {
      return;
    }

    submit({
      kind: 'deleteNode',
      nodeId,
    });
  }

  function deleteFocusedTarget() {
    const current = get(document);
    if (current.view.selectedEdgeId) {
      deleteEdge(current.view.selectedEdgeId);
      return;
    }

    deleteSelectedNode();
  }

  function deleteEdge(edgeId: string) {
    submit({
      kind: 'deleteEdge',
      edgeId,
    });
  }

  function navigateBack() {
    const current = get(document);
    const currentTarget = getFocusTarget(current.view);
    const stack = get(navigationStack);

    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const target = stack[index];
      if (targetsEqual(target, currentTarget)) {
        continue;
      }
      if (!targetExists(current.graph, target)) {
        continue;
      }

      navigationStack.set(stack.slice(0, index + 1));
      focusTarget(target, false);
      return;
    }

    error.set('没有可返回的焦点');
  }

  function undo() {
    const inverse = get(undoStack).at(-1);
    if (!inverse) {
      return;
    }

    enqueueOperation(inverse, (redoOperation) => {
      undoStack.update((items) => items.slice(0, -1));
      redoStack.update((items) => [...items, redoOperation]);
    });
  }

  function redo() {
    const operation = get(redoStack).at(-1);
    if (!operation) {
      return;
    }

    enqueueOperation(operation, (inverse) => {
      redoStack.update((items) => items.slice(0, -1));
      undoStack.update((items) => [...items, inverse]);
    });
  }

  async function reset() {
    const initial = createInitialDocument();
    document.set(initial);
    saving.set(true);
    try {
      await repository.reset();
      await repository.save(initial);
      error.set(null);
      undoStack.set([]);
      redoStack.set([]);
      navigationStack.set([]);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '重置失败');
    } finally {
      saving.set(false);
    }
  }

  async function openSelectedFile() {
    const selected = get(selectedNode);
    const filePath = selected?.file?.path;
    if (!filePath) {
      error.set('当前节点没有关联文件');
      return;
    }

    if (!repository.openWorkspaceFile) {
      error.set('当前运行环境不能打开 VS Code 文件编辑器');
      return;
    }

    try {
      await repository.openWorkspaceFile(filePath);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '打开关联文件失败');
    }
  }

  async function openSelectedTarget() {
    const selected = get(selectedNode);
    if (!selected) {
      error.set('当前没有选中节点');
      return;
    }

    await runNodeAction(selected.id, 'open');
  }

  async function openNodeTarget(nodeId: string) {
    selectNode(nodeId);
    await runNodeAction(nodeId, 'open');
  }

  async function runNodeAction(nodeId: string, trigger: NodeInteractionTrigger) {
    const current = get(document);
    const node = current.graph.nodes[nodeId];
    if (!node) {
      return;
    }

    const action = resolveNodeAction(current, node, trigger);
    switch (action) {
      case 'selectNode':
        selectNode(nodeId);
        return;
      case 'openLinkedFile':
        await openNodeFile(node);
        return;
      case 'enterSubgraph':
        error.set(node.subgraph ? `进入子空间尚未实现: ${node.subgraph.path}` : '当前节点没有关联子图');
        return;
      case 'noop':
        return;
    }
  }

  async function openNodeFile(node: NodeMeta) {
    const filePath = node.file?.path;
    if (!filePath) {
      error.set('当前节点没有关联文件');
      return;
    }

    if (!repository.openWorkspaceFile) {
      error.set('当前运行环境不能打开 VS Code 文件编辑器');
      return;
    }

    try {
      await repository.openWorkspaceFile(filePath);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '打开关联文件失败');
    }
  }

  function focusTarget(target: FocusTarget, recordHistory: boolean) {
    const current = get(document);
    if (!targetExists(current.graph, target)) {
      return;
    }

    const currentTarget = getFocusTarget(current.view);
    if (targetsEqual(currentTarget, target)) {
      return;
    }

    if (recordHistory && currentTarget && targetExists(current.graph, currentTarget)) {
      pushNavigationTarget(currentTarget, current.graph);
    }

    document.set({
      ...current,
      view: viewWithFocus(current.view, target),
    });
  }

  function repairFocus(nextDocument: GraphDocument, previousTarget: FocusTarget | null = getFocusTarget(nextDocument.view)): GraphDocument {
    pruneNavigationStack(nextDocument.graph);

    const currentTarget = getFocusTarget(nextDocument.view);
    if (currentTarget && targetExists(nextDocument.graph, currentTarget)) {
      return {
        ...nextDocument,
        view: viewWithFocus(nextDocument.view, currentTarget),
      };
    }

    if (!previousTarget) {
      return nextDocument;
    }

    const fallback = getBackTarget(nextDocument.graph, previousTarget) ?? getFallbackNodeTarget(nextDocument.graph, previousTarget);
    if (!fallback) {
      return {
        ...nextDocument,
        view: {
          ...nextDocument.view,
          selectedNodeId: null,
          selectedEdgeId: null,
        },
      };
    }

    return {
      ...nextDocument,
      view: viewWithFocus(nextDocument.view, fallback),
    };
  }

  function pushNavigationTarget(target: FocusTarget, graph: GraphFile) {
    navigationStack.update((items) => {
      const nextItems = items.filter((item) => targetExists(graph, item));
      if (targetsEqual(nextItems.at(-1) ?? null, target)) {
        return nextItems;
      }
      return [...nextItems, target].slice(-NAVIGATION_STACK_LIMIT);
    });
  }

  function pruneNavigationStack(graph: GraphFile) {
    navigationStack.update((items) => items.filter((item) => targetExists(graph, item)).slice(-NAVIGATION_STACK_LIMIT));
  }

  function getBackTarget(graph: GraphFile, currentTarget: FocusTarget | null): FocusTarget | null {
    const stack = get(navigationStack);
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const target = stack[index];
      if (targetsEqual(target, currentTarget)) {
        continue;
      }
      if (targetExists(graph, target)) {
        return target;
      }
    }
    return null;
  }

  function getFallbackNodeTarget(graph: GraphFile, previousTarget: FocusTarget | null): FocusTarget | null {
    if (graph.nodes[graph.rootNodeId] && previousTarget?.id !== graph.rootNodeId) {
      return { kind: 'node', id: graph.rootNodeId };
    }

    const node = Object.values(graph.nodes).find((item) => item.id !== previousTarget?.id) ?? Object.values(graph.nodes)[0];
    return node ? { kind: 'node', id: node.id } : null;
  }

  return {
    document,
    navigationStack,
    selectedNode,
    selectedEdge,
    selectedEdges,
    preferences,
    ready,
    saving,
    error,
    hydrate,
    submit,
    replaceFromHost,
    replacePreferences,
    updateInputTree,
    updateLinkedFileOpenMode,
    selectNode,
    selectEdge,
    clearFocus,
    focusRoot,
    navigateBack,
    selectLinkedFile,
    updateSelectedNode,
    updateGraphConfig,
    renameSelectedNodeLabel,
    importWorkspaceFile,
    createFileNode,
    createLinkedNode,
    createTypedNode,
    createEdge,
    deleteNode,
    deleteSelectedNode,
    deleteFocusedTarget,
    deleteEdge,
    openSelectedFile,
    openSelectedTarget,
    openNodeTarget,
    undo,
    redo,
    reset,
  };
}

function getFocusTarget(view: RuntimeViewState): FocusTarget | null {
  if (view.selectedNodeId) {
    return { kind: 'node', id: view.selectedNodeId };
  }
  if (view.selectedEdgeId) {
    return { kind: 'edge', id: view.selectedEdgeId };
  }
  return null;
}

function viewWithFocus(view: RuntimeViewState, target: FocusTarget): RuntimeViewState {
  return {
    ...view,
    selectedNodeId: target.kind === 'node' ? target.id : null,
    selectedEdgeId: target.kind === 'edge' ? target.id : null,
  };
}

function targetExists(graph: GraphFile, target: FocusTarget): boolean {
  return target.kind === 'node'
    ? Boolean(graph.nodes[target.id])
    : Boolean(graph.edges[target.id]);
}

function targetsEqual(left: FocusTarget | null, right: FocusTarget | null): boolean {
  return Boolean(left && right && left.kind === right.kind && left.id === right.id);
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function createLocalFileInfo(path: string): WorkspaceFileInfo {
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return {
    path: normalizedPath,
    label: normalizedPath.split('/').filter(Boolean).at(-1) ?? normalizedPath,
    metrics: {
      contentLength: 0,
    },
  };
}
```

## `lib\ui\CanvasStage.svelte`

```
<script lang="ts">
  import { onMount } from 'svelte';
  import type { GraphDocument } from '../core/schema';
  import type { StarsInputTree } from '../input/inputTree';
  import { GraphRuntime } from '../runtime/graphRuntime';

  export let getDocument: () => GraphDocument;
  export let inputTree: StarsInputTree;
  export let onSelectNode: (nodeId: string) => void;
  export let onSelectEdge: (edgeId: string) => void;
  export let onClearFocus: () => void;
  export let onCreateEdge: (sourceId: string, targetId: string) => void;
  export let onDeleteNode: (nodeId: string) => void;
  export let onDeleteEdge: (edgeId: string) => void;
  export let onOpenNode: (nodeId: string) => void;
  export let onNavigateBack: () => void;
  export let onImportFile: (pathOrUri: string) => void;

  type NavigableGraphRuntime = GraphRuntime & {
    navigateDirection: (targetAngle: number, rotateView?: boolean) => void;
    setInputTree: (inputTree: StarsInputTree) => void;
  };

  let canvas: HTMLCanvasElement;
  let runtime: NavigableGraphRuntime | null = null;

  export function navigateDirection(targetAngle: number, rotateView = false) {
    runtime?.navigateDirection(targetAngle, rotateView);
  }

  $: runtime?.setInputTree(inputTree);

  onMount(() => {
    const runtimeOptions = {
      getDocument,
      getInputTree: () => inputTree,
      onSelectNode,
      onSelectEdge,
      onClearFocus,
      onCreateEdge,
      onDeleteNode,
      onDeleteEdge,
      onOpenNode,
      onNavigateBack,
      onImportFile,
    };

    runtime = new GraphRuntime(canvas, runtimeOptions) as NavigableGraphRuntime;
    runtime.start();

    return () => {
      runtime?.destroy();
    };
  });
</script>

<canvas bind:this={canvas} class="canvas" tabindex="0"></canvas>

<style>
  .canvas {
    display: block;
    width: calc(100vw - var(--sidebar-width));
    height: 100vh;
    cursor: crosshair;
    outline: none;
  }

  :global(.graph-tooltip) {
    position: absolute;
    z-index: 100;
    box-sizing: border-box;
    max-width: 280px;
    padding: 10px 14px;
    pointer-events: none;
    background: rgba(0, 0, 0, 0.9);
    border-left: 3px solid #4facfe;
    border-radius: 4px;
    color: #ddd;
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6);
    font-size: 12px;
    line-height: 1.5;
    transition: opacity 0.15s;
  }

  :global(.graph-tooltip[hidden]) {
    display: none;
  }

  :global(.graph-tooltip-title) {
    margin-bottom: 4px;
    color: #ffffff;
    font-weight: 700;
  }

  :global(.graph-tooltip-summary p) {
    margin: 0 0 7px;
  }

  :global(.graph-tooltip-summary p:last-child) {
    margin-bottom: 0;
  }

  :global(.graph-tooltip-summary ul) {
    margin: 0;
    padding-left: 16px;
  }

  :global(.graph-tooltip-summary code) {
    padding: 1px 4px;
    border-radius: 4px;
    background: #16161b;
    color: #33ffff;
  }

  :global(.graph-tooltip-summary a) {
    color: #4facfe;
  }
</style>
```

## `lib\ui\CreatePanel.svelte`

```
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
```

## `lib\ui\DismissibleOverlay.svelte`

```
<script lang="ts">
  import { onMount } from 'svelte';

  export let ariaLabel: string;
  export let closeLabel = '关闭弹窗';
  export let panelClass = '';
  export let onClose: () => void;

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', handleKeydown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeydown, { capture: true });
  });
</script>

<div class="overlay" role="presentation">
  <button class="backdrop" type="button" aria-label={closeLabel} on:click={onClose}></button>
  <div class={['panel', panelClass].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={ariaLabel}>
    <slot />
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 18;
    display: grid;
    place-items: center;
    padding: 24px;
  }

  .backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    background: rgba(5, 5, 8, 0.38);
    border: 0;
    border-radius: 0;
    cursor: default;
  }

  .backdrop:hover {
    background: rgba(5, 5, 8, 0.38);
    border: 0;
  }

  .panel {
    position: relative;
    z-index: 1;
    max-width: calc(100vw - 48px);
    max-height: calc(100vh - 48px);
  }
</style>
```

## `lib\ui\Hud.svelte`

```
<script lang="ts">
  export let nodeCount = 0;
  export let edgeCount = 0;
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
      <div>关系总数: <strong>{edgeCount}</strong></div>
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
```

## `lib\ui\InputTreeNodeRow.svelte`

```
<script lang="ts">
  import { fade, slide } from 'svelte/transition';
  import type { StarsCommandId } from '../core/preferences';
  import { normalizeInputTrigger, type InputRouteNode } from '../input/inputTree';
  import { COMMANDS, getValidCommands, getValidNextTokens } from '../input/inputConstraints';

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
            <span>{selectedCommand?.label ?? '选择命令'}</span>
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
                  <span>{command.label}</span>
                  <span class="command-id">{command.id}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {:else if node.command}
        <span class="error-text">当前命令 {node.command} 在这个路径下无效</span>
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
```

## `lib\ui\PreferencesPanel.svelte`

```
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

  const pointerActions: Array<{ id: StarsPointerActionId; label: string }> = [
    { id: 'selectNode', label: '选择节点' },
    { id: 'selectEdge', label: '选择关系' },
    { id: 'clearFocus', label: '清空焦点' },
    { id: 'rotateCanvas', label: '旋转视角' },
    { id: 'panCanvas', label: '拖动画布' },
    { id: 'dragNode', label: '拖动节点' },
    { id: 'createEdge', label: '创建关系' },
    { id: 'deleteTarget', label: '删除目标' },
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
```

## `lib\ui\Sidebar.svelte`

```
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
```

