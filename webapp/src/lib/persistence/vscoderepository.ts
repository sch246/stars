import type { GraphDocument } from '../core/schema';
import type { RuntimeViewState } from '../core/schema';
import type { GraphOperation } from '../core/operations';
import type { LinkedFileOpenMode, StarsUserPreferences } from '../core/preferences';
import type { GraphCommitResult, GraphRepository, WorkspaceFileInfo } from './repository';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

interface ResponseMessage {
  command: 'response';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

declare const acquireVsCodeApi: undefined | (() => VsCodeApi);

let api: VsCodeApi | null = null;

function getVsCodeApi(): VsCodeApi | null {
  if (api) {
    return api;
  }

  if (typeof acquireVsCodeApi !== 'function') {
    return null;
  }

  api = acquireVsCodeApi();
  return api;
}

export function isVsCodeWebview(): boolean {
  return getVsCodeApi() !== null;
}

export class VsCodeGraphRepository implements GraphRepository {
  private readonly api: VsCodeApi;

  constructor() {
    const nextApi = getVsCodeApi();
    if (!nextApi) {
      throw new Error('VS Code Webview API 不可用');
    }
    this.api = nextApi;
  }

  load(): Promise<GraphDocument | null> {
    return this.request<GraphDocument>('loadGraph');
  }

  save(document: GraphDocument): Promise<void> {
    return this.request<void>('saveGraph', { document });
  }

  reset(): Promise<void> {
    return this.request<void>('resetGraph');
  }

  applyOperation(operation: GraphOperation, baseRevision: number, view: RuntimeViewState): Promise<GraphCommitResult> {
    return this.request<GraphCommitResult>('applyOperation', { operation, baseRevision, view });
  }

  openWorkspaceFile(path: string): Promise<void> {
    return this.request<void>('openWorkspaceFile', { path });
  }

  revealWorkspaceFile(path: string, mode: LinkedFileOpenMode): Promise<boolean> {
    return this.request<boolean>('revealWorkspaceFile', { path, mode });
  }

  resolveWorkspaceFile(pathOrUri: string): Promise<WorkspaceFileInfo> {
    return this.request<WorkspaceFileInfo>('resolveWorkspaceFile', { path: pathOrUri });
  }

  createWorkspaceFile(path: string): Promise<WorkspaceFileInfo> {
    return this.request<WorkspaceFileInfo>('createWorkspaceFile', { path });
  }

  renameWorkspaceFile(path: string, name: string): Promise<WorkspaceFileInfo> {
    return this.request<WorkspaceFileInfo>('renameWorkspaceFile', { path, name });
  }

  loadPreferences(): Promise<StarsUserPreferences> {
    return this.request<StarsUserPreferences>('loadPreferences');
  }

  savePreferences(preferences: StarsUserPreferences): Promise<void> {
    return this.request<void>('savePreferences', { preferences });
  }

  private request<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<ResponseMessage>) => {
        const message = event.data;
        if (!message || message.command !== 'response' || message.requestId !== requestId) {
          return;
        }

        window.removeEventListener('message', onMessage as EventListener);
        if (message.ok) {
          resolve(message.result as T);
        } else {
          reject(new Error(message.error ?? `${command} 失败`));
        }
      };

      window.addEventListener('message', onMessage as EventListener);
      this.api.postMessage({ command, requestId, ...payload });
    });
  }
}