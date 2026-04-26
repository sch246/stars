import type { PointerButton, PointerModifier, PointerTargetRef, StarsActionId, StarsPointerActionId } from '../core/preferences';
import type { RuntimeViewState } from '../core/schema';
import { getCommandSignature, getValidCommands, getValidNextTokens, parseCommandReference } from './inputConstraints';

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
    { trigger: 'd', command: 'deleteSelectedLink' satisfies StarsActionId },
    { trigger: 'delete', command: 'deleteSelectedLink' satisfies StarsActionId },
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
    { trigger: 'link', command: 'selectLink' satisfies StarsPointerActionId },
    { trigger: 'background', command: 'clearFocus' satisfies StarsPointerActionId },
  ] },
  { trigger: 'click4', children: [{ trigger: 'any', command: 'navigateBack' satisfies StarsPointerActionId }] },
  { trigger: 'dblclick1', children: [{ trigger: 'node', command: 'openNodeTarget' satisfies StarsPointerActionId }] },
  { trigger: 'shift', children: [
    { trigger: 'click2', children: [
      { trigger: 'node', command: 'deleteNode' satisfies StarsPointerActionId },
      { trigger: 'link', command: 'deleteLink' satisfies StarsPointerActionId },
    ] },
  ] },
  { trigger: 'drag1', children: [
    { trigger: 'background', children: [{ trigger: 'any', command: 'rotateCanvas' satisfies StarsPointerActionId }] },
    { trigger: 'link', children: [{ trigger: 'any', command: 'rotateCanvas' satisfies StarsPointerActionId }] },
    { trigger: 'node', children: [{ trigger: 'any', command: 'dragNode' satisfies StarsPointerActionId }] },
  ] },
  { trigger: 'drag2', children: [
    { trigger: 'background', children: [{ trigger: 'any', command: 'panCanvas' satisfies StarsPointerActionId }] },
    { trigger: 'node', children: [{ trigger: 'node', command: 'createLink' satisfies StarsPointerActionId }] },
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

      const commandId = command ? parseCommandReference(command) : null;
      if (command && !commandId) {
        throw new Error(`第 ${lineIndex + 1} 行命令无法识别: ${command}`);
      }

      while (stack.at(-1) && stack.at(-1)!.depth >= depth) {
        stack.pop();
      }

      const parent = stack.at(-1);
      if (!parent || depth > parent.depth + 1) {
        throw new Error(`第 ${lineIndex + 1} 行缩进层级不连续`);
      }

      const node: InputRouteNode = commandId ? { trigger, command: commandId } : { trigger, children: [] };
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
  if (view.selectedLinkId) {
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
    ? `${indent}${normalizeInputTrigger(node.trigger)} -> ${getCommandSignature(node.command as StarsPointerActionId | StarsActionId)}`
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