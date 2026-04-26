import type { GraphDocument } from '../core/schema';
import type { RuntimeViewState } from '../core/schema';
import type { GraphOperation } from '../core/operations';
import type { LinkedFileOpenMode, StarsUserPreferences } from '../core/preferences';

export interface WorkspaceFileInfo {
  path: string;
  label: string;
  metrics: {
    contentLength: number;
  };
}

export interface GraphCommitResult {
  document: GraphDocument;
  inverse: GraphOperation;
}

export interface GraphRepository {
  load(): Promise<GraphDocument | null>;
  save(document: GraphDocument): Promise<void>;
  reset(): Promise<void>;
  applyOperation?(operation: GraphOperation, baseRevision: number, view: RuntimeViewState): Promise<GraphCommitResult>;
  openWorkspaceFile?(path: string): Promise<void>;
  revealWorkspaceFile?(path: string, mode: LinkedFileOpenMode): Promise<boolean>;
  resolveWorkspaceFile?(pathOrUri: string): Promise<WorkspaceFileInfo>;
  createWorkspaceFile?(path: string): Promise<WorkspaceFileInfo>;
  renameWorkspaceFile?(path: string, name: string): Promise<WorkspaceFileInfo>;
  loadPreferences?(): Promise<StarsUserPreferences>;
  savePreferences?(preferences: StarsUserPreferences): Promise<void>;
}