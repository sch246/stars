import * as fs from 'node:fs';
import { TextDecoder, TextEncoder } from 'node:util';
import * as vscode from 'vscode';
import { applyGraphOperation, type GraphOperation } from './graph/operations';
import type { GraphDocument, GraphFile, RuntimeViewState } from './graph/schema';
import { getNonce } from './utilities/nonce';

interface WebviewRequest {
  command: string;
  requestId?: string;
  document?: GraphDocument;
  operation?: GraphOperation;
  baseRevision?: number;
  view?: RuntimeViewState;
  path?: string;
  mode?: LinkedFileOpenMode;
  name?: string;
  preferences?: StarsUserPreferences;
}

interface WorkspaceFileInfo {
  path: string;
  label: string;
  metrics: {
    contentLength: number;
  };
}

type LinkedFileOpenMode = 'manual' | 'existingColumn' | 'always';

interface InputRouteNode {
  trigger: string;
  children?: InputRouteNode[];
  command?: string;
}

type StarsInputTree = InputRouteNode[];

interface StarsUserPreferences {
  inputTree: StarsInputTree;
  linkedFileOpenMode: LinkedFileOpenMode;
}

const DEFAULT_INPUT_TREE: StarsInputTree = [
  { trigger: 'tab', command: 'createLinkedNode' },
  { trigger: 'b', command: 'navigateBack' },
  { trigger: 'h', command: 'focusRoot' },
  { trigger: 'p', command: 'togglePreferencesPanel' },
  { trigger: 'n', command: 'toggleCreatePanel' },
  { trigger: 'i', command: 'toggleInfoPanel' },
  { trigger: 'o', command: 'toggleSidebarPanel' },
  { trigger: 'focusNode', children: [
    { trigger: 'd', command: 'deleteSelectedNode' },
    { trigger: 'delete', command: 'deleteSelectedNode' },
    { trigger: 'enter', command: 'openSelectedFile' },
    { trigger: 'space', command: 'editSelectedNode' },
    { trigger: 'f2', command: 'editSelectedNode' },
    { trigger: 'arrowup', command: 'navigateUp' },
    { trigger: 'arrowdown', command: 'navigateDown' },
    { trigger: 'arrowleft', command: 'navigateLeft' },
    { trigger: 'arrowright', command: 'navigateRight' },
  ] },
  { trigger: 'focusLink', children: [
    { trigger: 'd', command: 'deleteSelectedLink' },
    { trigger: 'delete', command: 'deleteSelectedLink' },
  ] },
  { trigger: 'ctrl', children: [
    { trigger: 'z', command: 'undo' },
    { trigger: 'y', command: 'redo' },
    { trigger: 'shift', children: [
      { trigger: 'z', command: 'redo' },
      { trigger: 'r', command: 'resetGraph' },
    ] },
  ] },
  { trigger: 'click1', children: [
    { trigger: 'node', command: 'selectNode' },
    { trigger: 'link', command: 'selectLink' },
    { trigger: 'background', command: 'clearFocus' },
  ] },
  { trigger: 'click4', children: [{ trigger: 'any', command: 'navigateBack' }] },
  { trigger: 'dblclick1', children: [{ trigger: 'node', command: 'openNodeTarget' }] },
  { trigger: 'shift', children: [
    { trigger: 'click2', children: [
      { trigger: 'node', command: 'deleteNode' },
      { trigger: 'link', command: 'deleteLink' },
    ] },
  ] },
  { trigger: 'drag1', children: [
    { trigger: 'background', children: [{ trigger: 'any', command: 'rotateCanvas' }] },
    { trigger: 'link', children: [{ trigger: 'any', command: 'rotateCanvas' }] },
    { trigger: 'node', children: [{ trigger: 'any', command: 'dragNode' }] },
  ] },
  { trigger: 'drag2', children: [
    { trigger: 'background', children: [{ trigger: 'any', command: 'panCanvas' }] },
    { trigger: 'node', children: [{ trigger: 'node', command: 'createLink' }] },
  ] },
  { trigger: 'drag3', children: [{ trigger: 'any', children: [{ trigger: 'any', command: 'panCanvas' }] }] },
];

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('stars.openGraph', () => {
      StarsPanel.createOrShow(context.extensionUri);
    })
  );
}

export function deactivate() {}

class StarsPanel {
  public static currentPanel: StarsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private isSaving = false;
  private linkedFileViewColumn: vscode.ViewColumn | undefined;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.panel.webview.html = this.getWebviewContent(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message: WebviewRequest) => {
      void this.handleMessage(message);
    }, null, this.disposables);
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      void this.postActiveWorkspaceFile(editor);
    }, null, this.disposables);
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('stars.inputTree')
        || event.affectsConfiguration('stars.linkedFileOpenMode')) {
        void this.postUserPreferences();
      }
    }, null, this.disposables);
    vscode.workspace.onDidSaveTextDocument((document) => {
      void this.postGraphIfFileNodeChanged(document.uri);
    }, null, this.disposables);

    void this.setupFileWatcher();
    void this.postActiveWorkspaceFile(vscode.window.activeTextEditor);
  }

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (StarsPanel.currentPanel) {
      StarsPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'starsGraph',
      'Stars Graph',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webapp', 'dist'),
        ],
      }
    );

    StarsPanel.currentPanel = new StarsPanel(panel, extensionUri);
  }

  public dispose() {
    StarsPanel.currentPanel = undefined;
    this.panel.dispose();

    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private async handleMessage(message: WebviewRequest) {
    const requestId = message.requestId;

    try {
      switch (message.command) {
        case 'loadGraph': {
          const graph = await this.loadOrCreateGraphFile();
          this.respond(requestId, {
            graph: await this.withDerivedFileMetadata(graph),
            view: {
              selectedNodeId: graph.rootNodeId,
              selectedLinkId: null,
              sidebarWidth: 340,
            },
          } satisfies GraphDocument);
          return;
        }

        case 'saveGraph': {
          if (!message.document) {
            throw new Error('saveGraph 缺少 document');
          }

          await this.saveGraphFile(message.document.graph);
          this.respond(requestId, undefined);
          return;
        }

        case 'applyOperation': {
          if (!message.operation) {
            throw new Error('applyOperation 缺少 operation');
          }
          if (typeof message.baseRevision !== 'number') {
            throw new Error('applyOperation 缺少 baseRevision');
          }

          const current = await this.loadOrCreateGraphFile();
          if (current.revision !== message.baseRevision) {
            throw new Error(`图元文件已更新，请重新载入后再试。当前修订号: ${current.revision}`);
          }

          const applied = applyGraphOperation(current, message.operation);
          await this.saveGraphFile(applied.graph);
          this.respond(requestId, {
            document: {
              graph: await this.withDerivedFileMetadata(applied.graph),
              view: sanitizeView(message.view, applied.graph),
            } satisfies GraphDocument,
            inverse: applied.inverse,
          });
          return;
        }

        case 'resetGraph': {
          await this.saveGraphFile(createDefaultGraphFile());
          this.respond(requestId, undefined);
          return;
        }

        case 'openWorkspaceFile': {
          if (!message.path) {
            throw new Error('openWorkspaceFile 缺少 path');
          }

          await this.openWorkspaceFile(message.path);
          this.respond(requestId, undefined);
          return;
        }

        case 'revealWorkspaceFile': {
          if (!message.path) {
            throw new Error('revealWorkspaceFile 缺少 path');
          }
          if (!isLinkedFileOpenMode(message.mode)) {
            throw new Error('revealWorkspaceFile 缺少有效 mode');
          }

          this.respond(requestId, await this.revealWorkspaceFile(message.path, message.mode));
          return;
        }

        case 'resolveWorkspaceFile': {
          if (!message.path) {
            throw new Error('resolveWorkspaceFile 缺少 path');
          }

          this.respond(requestId, await this.resolveWorkspaceFile(message.path));
          return;
        }

        case 'createWorkspaceFile': {
          if (!message.path) {
            throw new Error('createWorkspaceFile 缺少 path');
          }

          this.respond(requestId, await this.createWorkspaceFile(message.path));
          return;
        }

        case 'renameWorkspaceFile': {
          if (!message.path || !message.name) {
            throw new Error('renameWorkspaceFile 缺少 path 或 name');
          }

          this.respond(requestId, await this.renameWorkspaceFile(message.path, message.name));
          return;
        }

        case 'loadPreferences': {
          this.respond(requestId, getUserPreferences());
          return;
        }

        case 'savePreferences': {
          if (!message.preferences) {
            throw new Error('savePreferences 缺少 preferences');
          }

          await vscode.workspace.getConfiguration('stars').update(
            'inputTree',
            sanitizeInputTree(message.preferences.inputTree),
            vscode.ConfigurationTarget.Workspace
          );
          await vscode.workspace.getConfiguration('stars').update(
            'linkedFileOpenMode',
            sanitizeLinkedFileOpenMode(message.preferences.linkedFileOpenMode),
            vscode.ConfigurationTarget.Workspace
          );
          this.respond(requestId, undefined);
          await this.postUserPreferences();
          return;
        }

        default:
          throw new Error(`未知 Webview 命令: ${message.command}`);
      }
    } catch (error) {
      this.respondError(requestId, error instanceof Error ? error.message : String(error));
    }
  }

  private respond(requestId: string | undefined, result: unknown) {
    if (!requestId) {
      return;
    }

    void this.panel.webview.postMessage({
      command: 'response',
      requestId,
      ok: true,
      result,
    });
  }

  private respondError(requestId: string | undefined, error: string) {
    if (!requestId) {
      void vscode.window.showErrorMessage(error);
      return;
    }

    void this.panel.webview.postMessage({
      command: 'response',
      requestId,
      ok: false,
      error,
    });
  }

  private async setupFileWatcher() {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      return;
    }

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '.stars/main.graph.json')
    );

    this.fileWatcher.onDidChange(async () => {
      if (this.isSaving) {
        this.isSaving = false;
        return;
      }

      try {
        const graph = await this.loadOrCreateGraphFile();
        await this.panel.webview.postMessage({
          command: 'graphChanged',
          document: {
            graph: await this.withDerivedFileMetadata(graph),
            view: {
              selectedNodeId: graph.rootNodeId,
              selectedLinkId: null,
              sidebarWidth: 340,
            },
          } satisfies GraphDocument,
        });
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });

    this.disposables.push(this.fileWatcher);
  }

  private async loadOrCreateGraphFile(): Promise<GraphFile> {
    const graphUri = await this.getGraphUri();

    try {
      const bytes = await vscode.workspace.fs.readFile(graphUri);
      const text = new TextDecoder().decode(bytes);
      const graph = JSON.parse(text) as GraphFile;

      if (graph.format !== 'stars.graph.v2') {
        throw new Error(`不支持的 Stars 图格式: ${String(graph.format)}`);
      }

      return graph;
    } catch (error) {
      if (isFileNotFound(error)) {
        const graph = createDefaultGraphFile();
        await this.saveGraphFile(graph);
        return graph;
      }

      throw error;
    }
  }

  private async saveGraphFile(graph: GraphFile) {
    const graphUri = await this.getGraphUri();
    graph.meta.updatedAt = Date.now();
    this.isSaving = true;

    await vscode.workspace.fs.writeFile(
      graphUri,
      new TextEncoder().encode(`${JSON.stringify(graph, null, 2)}\n`)
    );
    vscode.window.setStatusBarMessage('Stars: 图元文件已保存。', 2000);
  }

  private async getGraphUri(): Promise<vscode.Uri> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('Stars: 请先打开一个工作区。');
    }

    const starsDir = vscode.Uri.joinPath(workspaceRoot.uri, '.stars');
    await vscode.workspace.fs.createDirectory(starsDir);
    return vscode.Uri.joinPath(starsDir, 'main.graph.json');
  }

  private async openWorkspaceFile(relativePath: string) {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('Stars: 请先打开一个工作区。');
    }

    const fileUri = vscode.Uri.joinPath(workspaceRoot.uri, ...relativePath.split(/[\\/]+/).filter(Boolean));
    const document = await vscode.workspace.openTextDocument(fileUri);

    const existingEditor = vscode.window.visibleTextEditors.find((editor) => sameUri(editor.document.uri, fileUri));
    if (existingEditor) {
      this.linkedFileViewColumn = existingEditor.viewColumn;
      await vscode.window.showTextDocument(document, {
        viewColumn: existingEditor.viewColumn,
        preview: true,
        preserveFocus: false,
      });
      return;
    }

    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: this.linkedFileViewColumn ?? getLinkedFileViewColumn(this.panel.viewColumn),
      preview: true,
      preserveFocus: false,
    });
    this.linkedFileViewColumn = editor.viewColumn;
  }

  private async revealWorkspaceFile(relativePath: string, mode: LinkedFileOpenMode): Promise<boolean> {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error('Stars: 请先打开一个工作区。');
    }

    if (mode === 'manual') {
      return false;
    }

    const fileUri = vscode.Uri.joinPath(workspaceRoot.uri, ...relativePath.split(/[\\/]+/).filter(Boolean));
    const viewColumn = mode === 'always'
      ? this.getOrCreateLinkedFileViewColumn(fileUri)
      : this.getExistingLinkedFileViewColumn(fileUri);
    if (!viewColumn) {
      return false;
    }

    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn,
      preview: true,
      preserveFocus: true,
    });
    this.linkedFileViewColumn = editor.viewColumn;
    return true;
  }

  private getExistingLinkedFileViewColumn(fileUri: vscode.Uri): vscode.ViewColumn | undefined {
    const existingEditor = vscode.window.visibleTextEditors.find((editor) => sameUri(editor.document.uri, fileUri));
    if (existingEditor) {
      return existingEditor.viewColumn;
    }

    if (this.linkedFileViewColumn && hasVisibleEditorInColumn(this.linkedFileViewColumn)) {
      return this.linkedFileViewColumn;
    }

    const rightColumn = getLinkedFileViewColumn(this.panel.viewColumn);
    return hasVisibleEditorInColumn(rightColumn) ? rightColumn : undefined;
  }

  private getOrCreateLinkedFileViewColumn(fileUri: vscode.Uri): vscode.ViewColumn {
    return this.getExistingLinkedFileViewColumn(fileUri)
      ?? this.linkedFileViewColumn
      ?? getLinkedFileViewColumn(this.panel.viewColumn);
  }

  private async resolveWorkspaceFile(pathOrUri: string): Promise<WorkspaceFileInfo> {
    return this.getWorkspaceFileInfo(await resolveWorkspaceFileUri(pathOrUri));
  }

  private async createWorkspaceFile(relativePath: string): Promise<WorkspaceFileInfo> {
    const fileUri = getWorkspaceFileUriFromRelativePath(relativePath);

    try {
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.type === vscode.FileType.Directory) {
        throw new Error(`目标是文件夹，不能创建文件节点: ${relativePath}`);
      }
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }

      await vscode.workspace.fs.createDirectory(getParentUri(fileUri));
      await vscode.workspace.fs.writeFile(fileUri, new Uint8Array());
    }

    return this.getWorkspaceFileInfo(fileUri);
  }

  private async renameWorkspaceFile(relativePath: string, name: string): Promise<WorkspaceFileInfo> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('文件名不能为空');
    }
    if (/[\\/]/.test(trimmedName)) {
      throw new Error('文件节点改名只接受文件名，不接受路径分隔符');
    }

    const sourceUri = getWorkspaceFileUriFromRelativePath(relativePath);
    const normalizedPath = normalizeWorkspacePath(relativePath);
    const directoryParts = normalizedPath.split('/').slice(0, -1);
    const targetUri = getWorkspaceFileUriFromRelativePath([...directoryParts, trimmedName].filter(Boolean).join('/'));

    if (!sameUri(sourceUri, targetUri)) {
      try {
        await vscode.workspace.fs.stat(targetUri);
        throw new Error(`目标文件已存在: ${[...directoryParts, trimmedName].filter(Boolean).join('/')}`);
      } catch (error) {
        if (!isFileNotFound(error)) {
          throw error;
        }
      }

      await vscode.workspace.fs.rename(sourceUri, targetUri, { overwrite: false });
    }

    return this.getWorkspaceFileInfo(targetUri);
  }

  private async getWorkspaceFileInfo(fileUri: vscode.Uri): Promise<WorkspaceFileInfo> {
    const relativePath = getWorkspaceRelativePath(fileUri);
    if (!relativePath) {
      throw new Error('文件不在当前工作区内');
    }

    const stat = await vscode.workspace.fs.stat(fileUri);
    if (stat.type === vscode.FileType.Directory) {
      throw new Error(`目标是文件夹，不能作为文件节点: ${relativePath}`);
    }

    return {
      path: normalizeWorkspacePath(relativePath),
      label: getFileName(relativePath),
      metrics: {
        contentLength: await estimateWorkspaceFileWeight(fileUri, stat.size),
      },
    };
  }

  private async withDerivedFileMetadata(graph: GraphFile): Promise<GraphFile> {
    const nextGraph = structuredClone(graph) as GraphFile;

    await Promise.all(Object.values(nextGraph.nodes).map(async (node) => {
      if (!node.file?.path) {
        return;
      }

      try {
        const info = await this.resolveWorkspaceFile(node.file.path);
        node.type = 'file';
        node.label = info.label;
        node.file = { kind: 'workspace-file', path: info.path };
        node.metrics = info.metrics;
      } catch {
        node.type = 'file';
        node.metrics = { contentLength: 0 };
      }
    }));

    return nextGraph;
  }

  private async postGraphIfFileNodeChanged(fileUri: vscode.Uri) {
    const relativePath = getWorkspaceRelativePath(fileUri);
    if (!relativePath) {
      return;
    }

    const graph = await this.loadOrCreateGraphFile().catch(() => null);
    if (!graph || !graphReferencesFile(graph, relativePath)) {
      return;
    }

    await this.panel.webview.postMessage({
      command: 'graphChanged',
      document: {
        graph: await this.withDerivedFileMetadata(graph),
        view: {
          selectedNodeId: graph.rootNodeId,
          selectedLinkId: null,
          sidebarWidth: 340,
        },
      } satisfies GraphDocument,
    });
  }

  private async postActiveWorkspaceFile(editor: vscode.TextEditor | undefined) {
    const relativePath = getWorkspaceRelativePath(editor?.document.uri);
    if (!relativePath) {
      return;
    }

    await this.panel.webview.postMessage({
      command: 'activeWorkspaceFileChanged',
      path: relativePath,
    });
  }

  private async postUserPreferences() {
    await this.panel.webview.postMessage({
      command: 'preferencesChanged',
      preferences: getUserPreferences(),
    });
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'webapp', 'dist');
    const indexUri = vscode.Uri.joinPath(distUri, 'index.html');

    if (!fs.existsSync(indexUri.fsPath)) {
      return missingWebappHtml();
    }

    const nonce = getNonce();
    let html = fs.readFileSync(indexUri.fsPath, 'utf8');

    html = html.replace(
      /<(head)>/,
      `<$1>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource};">`
    );

    html = html.replace(/<(script)([^>]*?)>/g, `<$1 nonce="${nonce}"$2>`);
    html = html.replace(/(src|href)="\.\/([^"]+)"/g, (_match, attr: string, assetPath: string) => {
      const assetUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, ...assetPath.split('/')));
      return `${attr}="${assetUri}"`;
    });

    return html;
  }
}

function getWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

function getWorkspaceRelativePath(uri: vscode.Uri | undefined): string | undefined {
  if (!uri || uri.scheme !== 'file') {
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return undefined;
  }

  return vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
}

async function resolveWorkspaceFileUri(pathOrUri: string): Promise<vscode.Uri> {
  const trimmed = pathOrUri.trim();
  if (!trimmed) {
    throw new Error('文件路径不能为空');
  }

  const candidate = trimmed.startsWith('file:')
    ? vscode.Uri.parse(trimmed)
    : getWorkspaceFileUriFromRelativePath(trimmed);

  if (!getWorkspaceRelativePath(candidate)) {
    throw new Error('只能添加当前工作区内的文件');
  }

  return candidate;
}

function getWorkspaceFileUriFromRelativePath(relativePath: string): vscode.Uri {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error('Stars: 请先打开一个工作区。');
  }

  const normalizedPath = normalizeWorkspacePath(relativePath);
  if (!normalizedPath || normalizedPath.startsWith('../') || normalizedPath.includes('/../')) {
    throw new Error(`非法工作区相对路径: ${relativePath}`);
  }

  return vscode.Uri.joinPath(workspaceRoot.uri, ...normalizedPath.split('/').filter(Boolean));
}

function getParentUri(uri: vscode.Uri): vscode.Uri {
  const parts = uri.path.split('/').filter(Boolean);
  parts.pop();
  return uri.with({ path: `/${parts.join('/')}` });
}

function normalizeWorkspacePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function getFileName(path: string): string {
  return normalizeWorkspacePath(path).split('/').filter(Boolean).at(-1) ?? path;
}

async function estimateWorkspaceFileWeight(fileUri: vscode.Uri, size: number): Promise<number> {
  if (size <= 0) {
    return 0;
  }

  if (size > 2_000_000) {
    return Math.max(1, Math.round(size / 128));
  }

  const bytes = await vscode.workspace.fs.readFile(fileUri);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const words = text.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;
  return Math.max(words, Math.round(size / 128));
}

function graphReferencesFile(graph: GraphFile, relativePath: string): boolean {
  const normalizedPath = normalizeWorkspacePath(relativePath).toLowerCase();
  return Object.values(graph.nodes).some((node) => {
    return node.file?.path && normalizeWorkspacePath(node.file.path).toLowerCase() === normalizedPath;
  });
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString();
}

function hasVisibleEditorInColumn(viewColumn: vscode.ViewColumn): boolean {
  return vscode.window.visibleTextEditors.some((editor) => editor.viewColumn === viewColumn);
}

function getLinkedFileViewColumn(graphViewColumn: vscode.ViewColumn | undefined): vscode.ViewColumn {
  if (graphViewColumn && graphViewColumn >= vscode.ViewColumn.One && graphViewColumn < vscode.ViewColumn.Nine) {
    return (graphViewColumn + 1) as vscode.ViewColumn;
  }

  return vscode.ViewColumn.Beside;
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

function sanitizeView(view: RuntimeViewState | undefined, graph: GraphFile): RuntimeViewState {
  const selectedNodeId = view?.selectedNodeId && graph.nodes[view.selectedNodeId]
    ? view.selectedNodeId
    : null;
  const selectedLinkId = view?.selectedLinkId && graph.links[view.selectedLinkId]
    ? view.selectedLinkId
    : null;

  return {
    selectedNodeId,
    selectedLinkId: selectedNodeId ? null : selectedLinkId,
    sidebarWidth: view?.sidebarWidth ?? 340,
  };
}

function getUserPreferences(): StarsUserPreferences {
  const inputTree = vscode.workspace.getConfiguration('stars').get<unknown>('inputTree');
  const linkedFileOpenMode = vscode.workspace.getConfiguration('stars').get<unknown>('linkedFileOpenMode');

  return {
    inputTree: sanitizeInputTree(inputTree),
    linkedFileOpenMode: sanitizeLinkedFileOpenMode(linkedFileOpenMode),
  };
}

function isLinkedFileOpenMode(value: unknown): value is LinkedFileOpenMode {
  return value === 'manual' || value === 'existingColumn' || value === 'always';
}

function sanitizeLinkedFileOpenMode(value: unknown): LinkedFileOpenMode {
  return isLinkedFileOpenMode(value) ? value : 'existingColumn';
}

function sanitizeInputTree(rawTree: unknown): StarsInputTree {
  if (!Array.isArray(rawTree)) {
    return structuredClone(DEFAULT_INPUT_TREE);
  }

  const nodes = rawTree.map(sanitizeInputRouteNode).filter((node): node is InputRouteNode => Boolean(node));
  return nodes.length > 0 ? nodes : structuredClone(DEFAULT_INPUT_TREE);
}

function sanitizeInputRouteNode(rawNode: unknown): InputRouteNode | null {
  if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
    return null;
  }

  const record = rawNode as Record<string, unknown>;
  if (typeof record.trigger !== 'string' || !record.trigger.trim()) {
    return null;
  }

  const trigger = record.trigger.trim();
  const children = Array.isArray(record.children)
    ? record.children.map(sanitizeInputRouteNode).filter((node): node is InputRouteNode => Boolean(node))
    : undefined;
  const command = typeof record.command === 'string' && record.command.trim()
    ? record.command.trim()
    : undefined;

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

function createDefaultGraphFile(): GraphFile {
  const now = Date.now();
  const rootNodeId = 'origin-root';

  return {
    format: 'stars.graph.v2',
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
        createdAt: now,
        updatedAt: now,
      },
    },
    links: {},
    adjacency: {
      [rootNodeId]: [],
    },
    nodeTypes: {
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
    },
    linkTypes: {
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
    },
    config: {
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
        linkHoverDistance: 10,
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
    },
    meta: {
      createdAt: now,
      updatedAt: now,
    },
  };
}

function missingWebappHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Stars</title></head>
<body style="background:#050508;color:#ddd;font-family:Segoe UI,sans-serif;padding:24px">
  <h1 style="color:#4facfe">Stars Webview 尚未构建</h1>
  <p>请先在仓库根目录运行 <code>pnpm run build:webapp</code>，然后重新打开 Stars。</p>
</body>
</html>`;
}
