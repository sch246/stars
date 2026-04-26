import { DEFAULT_INPUT_TREE, cloneInputTree, sanitizeInputTree, type StarsInputTree } from '../input/inputTree';

export type StarsActionId =
  | 'createLinkedNode'
  | 'deleteSelectedNode'
  | 'deleteSelectedLink'
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
  | 'selectLink'
  | 'clearFocus'
  | 'rotateCanvas'
  | 'panCanvas'
  | 'dragNode'
  | 'createLink'
  | 'deleteNode'
  | 'deleteLink'
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
  'deleteSelectedLink',
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
  'selectLink',
  'clearFocus',
  'rotateCanvas',
  'panCanvas',
  'dragNode',
  'createLink',
  'deleteNode',
  'deleteLink',
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