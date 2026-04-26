import type { StarsActionId, StarsKeyBinding } from '../core/preferences';

export function resolveKeymapAction(
  event: KeyboardEvent,
  keymap: Partial<Record<StarsActionId, StarsKeyBinding>>,
): StarsActionId | null {
  if (isEditableTarget(event.target)) {
    return null;
  }

  const shortcut = normalizeKeyboardEvent(event);
  const entries = Object.entries(keymap) as Array<[StarsActionId, StarsKeyBinding | undefined]>;

  for (const [actionId, binding] of entries) {
    if (!binding) {
      continue;
    }

    const bindings = Array.isArray(binding) ? binding : [binding];
    if (bindings.some((item) => normalizeShortcut(item) === shortcut)) {
      return actionId;
    }
  }

  return null;
}

function normalizeKeyboardEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) {
    parts.push('ctrl');
  }
  if (event.altKey) {
    parts.push('alt');
  }
  if (event.shiftKey) {
    parts.push('shift');
  }
  if (event.metaKey) {
    parts.push('meta');
  }

  parts.push(normalizeKey(event.key));
  return parts.join('+');
}

function normalizeShortcut(shortcut: string): string {
  const parts = shortcut
    .split('+')
    .map((part) => normalizeKey(part.trim()))
    .filter(Boolean);

  const modifiers = ['ctrl', 'alt', 'shift', 'meta'].filter((modifier) => parts.includes(modifier));
  const key = parts.find((part) => !modifiers.includes(part));
  return [...modifiers, key].filter(Boolean).join('+');
}

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
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
    default:
      return lower;
  }
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