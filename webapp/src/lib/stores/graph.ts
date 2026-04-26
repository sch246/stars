import { derived, get, writable } from 'svelte/store';
import { createInitialDocument } from '../core/defaults';
import { applyGraphOperation, type GraphOperation } from '../core/operations';
import { DEFAULT_USER_PREFERENCES, mergeUserPreferences } from '../core/preferences';
import type { LinkedFileOpenMode, StarsActionId, StarsKeyBinding, StarsUserPreferences } from '../core/preferences';
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

  async function updateKeyBinding(actionId: StarsActionId, binding: StarsKeyBinding) {
    const nextPreferences = mergeUserPreferences({
      ...get(preferences),
      keymap: {
        ...get(preferences).keymap,
        [actionId]: binding,
      },
    });
    preferences.set(nextPreferences);

    if (!repository.savePreferences) {
      return;
    }

    try {
      await repository.savePreferences(nextPreferences);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '保存快捷键失败');
    }
  }

  async function resetKeymap() {
    const nextPreferences = mergeUserPreferences({
      ...get(preferences),
      keymap: structuredClone(DEFAULT_USER_PREFERENCES.keymap),
    });
    preferences.set(nextPreferences);

    if (!repository.savePreferences) {
      return;
    }

    try {
      await repository.savePreferences(nextPreferences);
      error.set(null);
    } catch (reason) {
      error.set(reason instanceof Error ? reason.message : '重置快捷键失败');
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
    updateKeyBinding,
    resetKeymap,
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