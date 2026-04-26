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