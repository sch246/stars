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
        controller.deleteSelectedNode();
        break;
      case 'deleteSelectedLink':
        controller.deleteSelectedLink();
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