export type NodeId = string;
export type EdgeId = string;

export interface WorkspaceFileRef {
  kind: 'workspace-file';
  path: string;
}

export interface SubgraphRef {
  kind: 'subgraph';
  path: string;
}

export interface NodeMeta {
  id: NodeId;
  label: string;
  summary?: string;
  type?: string;
  color?: string;
  file?: WorkspaceFileRef;
  subgraph?: SubgraphRef;
  metrics?: {
    contentLength?: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface EdgeMeta {
  id: EdgeId;
  sourceId: NodeId;
  targetId: NodeId;
  type: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
}

export interface GraphConfig {
  layout: {
    engine: 'force';
    linkDistance: number;
    linkStrength: number;
    chargeStrength: number;
    chargeDistanceMax: number;
    collisionPadding: number;
    collisionStrength: number;
    centerStrength: number;
    alphaFloor: number;
    alphaDecay: number;
    velocityDecay: number;
  };
  rendering: {
    baseNodeRadius: number;
    contentLengthDivisor: number;
    degreeRadiusBoost: number;
    minNodePixelSize: number;
    minFocusNodePixelSize: number;
    focusRadius: number;
    proximityRange: number;
    hoverStopRange: number;
    edgeHoverDistance: number;
    maxNodeScaleMultiplier: number;
    maxTextScaleMultiplier: number;
    baseLabelFontSize: number;
    minLabelPixelSize: number;
    labelZoomThreshold: number;
    dimmedOpacity: number;
    relatedOpacity: number;
    pulseSpeed: number;
  };
  behaviors?: Record<string, unknown>;
}

export interface GraphFile {
  format: 'stars.graph.v1';
  graphId: string;
  revision: number;
  rootNodeId: NodeId;
  nodes: Record<NodeId, NodeMeta>;
  edges: Record<EdgeId, EdgeMeta>;
  adjacency: Record<NodeId, EdgeId[]>;
  nodeTypes: Record<string, unknown>;
  edgeTypes: Record<string, unknown>;
  config: GraphConfig;
  meta: {
    createdAt: number;
    updatedAt: number;
  };
}

export interface RuntimeViewState {
  selectedNodeId: NodeId | null;
  selectedEdgeId: EdgeId | null;
  sidebarWidth: number;
}

export interface GraphDocument {
  graph: GraphFile;
  view: RuntimeViewState;
}