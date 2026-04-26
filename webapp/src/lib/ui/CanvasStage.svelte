<script lang="ts">
  import { onMount } from 'svelte';
  import type { GraphDocument } from '../core/schema';
  import type { StarsInputTree } from '../input/inputTree';
  import { GraphRuntime } from '../runtime/graphRuntime';

  export let getDocument: () => GraphDocument;
  export let inputTree: StarsInputTree;
  export let onSelectNode: (nodeId: string) => void;
  export let onSelectLink: (linkId: string) => void;
  export let onClearFocus: () => void;
  export let onCreateLink: (sourceId: string, targetId: string) => void;
  export let onDeleteNode: (nodeId: string) => void;
  export let onDeleteLink: (linkId: string) => void;
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
      onSelectLink,
      onClearFocus,
      onCreateLink,
      onDeleteNode,
      onDeleteLink,
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