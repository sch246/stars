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

export type StarsKeyBinding = string | string[];

export type LinkedFileOpenMode = 'manual' | 'existingColumn' | 'always';

export interface StarsUserPreferences {
  keymap: Partial<Record<StarsActionId, StarsKeyBinding>>;
  linkedFileOpenMode: LinkedFileOpenMode;
}

export const DEFAULT_KEYMAP: Record<StarsActionId, StarsKeyBinding> = {
  createLinkedNode: 'tab',
  deleteSelectedNode: ['d', 'delete'],
  openSelectedFile: 'enter',
  editSelectedNode: ['space', 'f2'],
  navigateBack: 'b',
  navigateUp: 'arrowup',
  navigateDown: 'arrowdown',
  navigateLeft: 'arrowleft',
  navigateRight: 'arrowright',
  focusRoot: 'h',
  togglePreferencesPanel: 'p',
  toggleCreatePanel: 'n',
  toggleInfoPanel: 'i',
  toggleSidebarPanel: 'o',
  undo: 'ctrl+z',
  redo: ['ctrl+y', 'ctrl+shift+z'],
  resetGraph: 'ctrl+shift+r',
};

export const DEFAULT_USER_PREFERENCES: StarsUserPreferences = {
  keymap: DEFAULT_KEYMAP,
  linkedFileOpenMode: 'existingColumn',
};

export function mergeUserPreferences(preferences: Partial<StarsUserPreferences> | null | undefined): StarsUserPreferences {
  return {
    keymap: {
      ...DEFAULT_KEYMAP,
      ...(preferences?.keymap ?? {}),
    },
    linkedFileOpenMode: isLinkedFileOpenMode(preferences?.linkedFileOpenMode)
      ? preferences.linkedFileOpenMode
      : DEFAULT_USER_PREFERENCES.linkedFileOpenMode,
  };
}

export function isLinkedFileOpenMode(value: unknown): value is LinkedFileOpenMode {
  return value === 'manual' || value === 'existingColumn' || value === 'always';
}