import type { StarsCommandId } from '../core/preferences';

const LETTER_KEYS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGIT_KEYS = '0123456789'.split('');
const FUNCTION_KEYS = Array.from({ length: 12 }, (_value, index) => `f${index + 1}`);
const NAVIGATION_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown'];
const CONTROL_KEYS = ['tab', 'enter', 'space', 'escape', 'backspace', 'delete', 'insert'];
const PUNCTUATION_KEYS = ['\`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/'];

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

export interface CommandConstraint {
  id: StarsCommandId;
  label: string;
  patterns: string[][];
}

interface ParsedInteractionPath {
  decorators: string[];
  pointer?: string;
  key?: string;
  targets: string[];
  valid: boolean;
}

export const COMMANDS: CommandConstraint[] = [
  { id: 'selectNode', label: '选择节点', patterns: [['node']] },
  { id: 'selectEdge', label: '选择关系', patterns: [['link']] },
  { id: 'clearFocus', label: '清空焦点', patterns: [['background']] },
  { id: 'rotateCanvas', label: '旋转视角', patterns: [['drag']] },
  { id: 'panCanvas', label: '拖动画布', patterns: [['drag']] },
  { id: 'dragNode', label: '拖动节点', patterns: [['node']] },
  { id: 'createEdge', label: '创建关系', patterns: [['node', 'node']] },
  { id: 'deleteNode', label: '删除节点', patterns: [['node']] },
  { id: 'deleteLink', label: '删除关系', patterns: [['link']] },
  { id: 'openNodeTarget', label: '打开节点目标', patterns: [['dblclick', 'node']] },
  { id: 'createLinkedNode', label: '创建关联节点', patterns: [[]] },
  { id: 'deleteSelectedNode', label: '删除焦点节点', patterns: [['focusNode']] },
  { id: 'deleteSelectedLink', label: '删除焦点关系', patterns: [['focusLink']] },
  { id: 'openSelectedFile', label: '打开当前节点', patterns: [['focusNode']] },
  { id: 'editSelectedNode', label: '编辑节点名称', patterns: [['focusNode']] },
  { id: 'navigateBack', label: '返回焦点历史', patterns: [[]] },
  { id: 'navigateUp', label: '向上跳转', patterns: [['focusNode']] },
  { id: 'navigateDown', label: '向下跳转', patterns: [['focusNode']] },
  { id: 'navigateLeft', label: '向左跳转', patterns: [['focusNode']] },
  { id: 'navigateRight', label: '向右跳转', patterns: [['focusNode']] },
  { id: 'focusRoot', label: '回到根节点', patterns: [[]] },
  { id: 'togglePreferencesPanel', label: '切换偏好面板', patterns: [[]] },
  { id: 'toggleCreatePanel', label: '切换创建面板', patterns: [[]] },
  { id: 'toggleInfoPanel', label: '切换信息提示', patterns: [[]] },
  { id: 'toggleSidebarPanel', label: '切换右侧侧边栏', patterns: [[]] },
  { id: 'undo', label: '撤回', patterns: [[]] },
  { id: 'redo', label: '重做', patterns: [[]] },
  { id: 'resetGraph', label: '重置图谱', patterns: [[]] },
];

export function getValidNextTokens(path: string[]): string[] {
  const parsedPath = parseInteractionPath(path);
  if (!parsedPath.valid) {
    return [];
  }

  if (parsedPath.key) {
    return [];
  }

  if (parsedPath.pointer) {
    if (parsedPath.targets.length === 0) {
      return dedupeTokens(INPUT_TOKEN_GROUPS.targets);
    }

    if (parsedPath.pointer.includes('drag') && parsedPath.targets.length === 1) {
      return dedupeTokens(INPUT_TOKEN_GROUPS.targets);
    }

    return [];
  }

  const usedDecorators = new Set(parsedPath.decorators);
  const hasFocus = parsedPath.decorators.some((token) => isFocusToken(token));

  return dedupeTokens([
    ...(!hasFocus ? INPUT_TOKEN_GROUPS.focus : []),
    ...INPUT_TOKEN_GROUPS.modifiers.filter((modifier) => !usedDecorators.has(modifier)),
    ...INPUT_TOKEN_GROUPS.pointers,
    ...INPUT_TOKEN_GROUPS.keys,
  ]);
}

export function getValidCommands(path: string[]): CommandConstraint[] {
  const pathTokens = normalizePathTokens(path);
  const parsedPath = parseInteractionPath(pathTokens);
  if (!canBindCommand(parsedPath)) {
    return [];
  }

  return COMMANDS
    .map((command) => ({
      command,
      score: getBestCommandPatternScore(command, pathTokens),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.command.label.localeCompare(right.command.label, 'zh-CN'))
    .map((entry) => entry.command);
}

export function getCommandLabel(commandId: StarsCommandId): string {
  return COMMANDS.find((command) => command.id === commandId)?.label ?? commandId;
}

export function getCommandSignature(commandId: StarsCommandId): string {
  const command = COMMANDS.find((item) => item.id === commandId);
  return command ? formatCommandSignature(command) : `${commandId}()`;
}

export function parseCommandReference(value: string): StarsCommandId | null {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return null;
  }

  const directMatch = COMMANDS.find((command) => command.id === normalizedValue);
  if (directMatch) {
    return directMatch.id;
  }

  const signatureMatch = COMMANDS.find((command) => formatCommandSignature(command) === normalizedValue);
  if (signatureMatch) {
    return signatureMatch.id;
  }

  const functionNameMatch = /^([a-zA-Z0-9]+)\s*\(/.exec(normalizedValue)?.[1];
  if (!functionNameMatch) {
    return null;
  }

  return COMMANDS.find((command) => command.id === functionNameMatch)?.id ?? null;
}

function dedupeTokens(tokens: readonly string[]): string[] {
  return [...new Set(tokens)];
}

function normalizePathTokens(path: string[]): string[] {
  return path.map((token) => token.trim()).filter(Boolean);
}

function parseInteractionPath(path: string[]): ParsedInteractionPath {
  const pathTokens = normalizePathTokens(path);
  const decorators: string[] = [];
  const usedDecorators = new Set<string>();
  let pointer: string | undefined;
  let key: string | undefined;
  const targets: string[] = [];
  let state: 'decorators' | 'targets' | 'done' = 'decorators';

  for (const token of pathTokens) {
    if (state === 'decorators') {
      if (isFocusToken(token) || isModifierToken(token)) {
        if (usedDecorators.has(token)) {
          return { decorators, pointer, key, targets, valid: false };
        }
        if (isFocusToken(token) && decorators.some((item) => isFocusToken(item))) {
          return { decorators, pointer, key, targets, valid: false };
        }
        decorators.push(token);
        usedDecorators.add(token);
        continue;
      }

      if (isPointerToken(token)) {
        pointer = token;
        state = 'targets';
        continue;
      }

      if (isKeyboardToken(token)) {
        key = token;
        state = 'done';
        continue;
      }

      return { decorators, pointer, key, targets, valid: false };
    }

    if (state === 'targets') {
      if (!isTargetToken(token)) {
        return { decorators, pointer, key, targets, valid: false };
      }

      targets.push(token);
      if ((pointer?.includes('drag') && targets.length > 2) || (!pointer?.includes('drag') && targets.length > 1)) {
        return { decorators, pointer, key, targets, valid: false };
      }
      continue;
    }

    return { decorators, pointer, key, targets, valid: false };
  }

  return { decorators, pointer, key, targets, valid: true };
}

function canBindCommand(path: ParsedInteractionPath): boolean {
  if (!path.valid) {
    return false;
  }

  if (path.key) {
    return true;
  }

  return Boolean(path.pointer && path.targets.length > 0);
}

function getBestCommandPatternScore(command: CommandConstraint, pathTokens: string[]): number {
  return command.patterns.reduce((bestScore, pattern) => {
    const patternScore = getPatternMatchScore(pattern, pathTokens);
    return Math.max(bestScore, patternScore);
  }, -1);
}

function getPatternMatchScore(requirements: string[], pathTokens: string[]): number {
  if (requirements.length === 0) {
    return 0;
  }

  let searchStart = 0;
  let score = requirements.length * 1000;

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
  return token.includes(requirement);
}

function formatCommandSignature(command: CommandConstraint): string {
  const patternText = command.patterns
    .map((pattern) => pattern.join(', '))
    .join(' | ');
  return `${command.id}(${patternText})`;
}

function isModifierToken(token: string): boolean {
  return INPUT_TOKEN_GROUPS.modifiers.includes(token as (typeof INPUT_TOKEN_GROUPS.modifiers)[number]);
}

function isFocusToken(token: string): boolean {
  return INPUT_TOKEN_GROUPS.focus.includes(token as (typeof INPUT_TOKEN_GROUPS.focus)[number]);
}

function isPointerToken(token: string): boolean {
  return INPUT_TOKEN_GROUPS.pointers.includes(token as (typeof INPUT_TOKEN_GROUPS.pointers)[number]);
}

function isTargetToken(token: string): boolean {
  return INPUT_TOKEN_GROUPS.targets.includes(token as (typeof INPUT_TOKEN_GROUPS.targets)[number]);
}

function isKeyboardToken(token: string): boolean {
  return INPUT_TOKEN_GROUPS.keys.includes(token as (typeof INPUT_TOKEN_GROUPS.keys)[number]);
}
