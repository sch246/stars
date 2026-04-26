export type GraphFormat = 'stars.graph.v2';
export type NodeId = string;
export type LinkId = string;
export type NodeTypeId = string;
export type LinkTypeId = string;

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
  type?: NodeTypeId;
  color?: string;
  file?: WorkspaceFileRef;
  subgraph?: SubgraphRef;
  metrics?: {
    contentLength?: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface LinkMeta {
  id: LinkId;
  sourceId: NodeId;
  targetId: NodeId;
  type: LinkTypeId;
  label?: string;
  createdAt: number;
  updatedAt: number;
}

export interface NodeTypeStyle {
  color?: string;
  radius?: number;
  labelVisible?: 'always' | 'hover' | 'focus' | 'auto';
}

export interface LinkTypeStyle {
  color?: string;
  width?: number;
  dash?: number[];
  labelVisible?: 'always' | 'hover' | 'focus' | 'never';
  arrow?: 'none' | 'target' | 'source' | 'both';
}

export interface NodeTypeDefinition {
  id: NodeTypeId;
  label: string;
  style: NodeTypeStyle;
}

export interface LinkTypeDefinition {
  id: LinkTypeId;
  label: string;
  style: LinkTypeStyle;
}

export type GraphTargetAction = 'selectNode' | 'openLinkedFile' | 'enterSubgraph' | 'noop';

export interface GraphTargetActionBindings {
  hover?: GraphTargetAction;
  primary?: GraphTargetAction;
  open?: GraphTargetAction;
}

export interface GraphBehaviorConfig {
  defaults?: GraphTargetActionBindings;
  nodeTypes?: Record<NodeTypeId, GraphTargetActionBindings>;
  linkTypes?: Record<LinkTypeId, GraphTargetActionBindings>;
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
    linkHoverDistance: number;
    maxNodeScaleMultiplier: number;
    maxTextScaleMultiplier: number;
    baseLabelFontSize: number;
    minLabelPixelSize: number;
    labelZoomThreshold: number;
    dimmedOpacity: number;
    relatedOpacity: number;
    pulseSpeed: number;
  };
  behaviors?: GraphBehaviorConfig;
}

export interface GraphFileMeta {
  createdAt: number;
  updatedAt: number;
}

export interface GraphFile {
  format: GraphFormat;
  graphId: string;
  revision: number;
  rootNodeId: NodeId;
  nodes: Record<NodeId, NodeMeta>;
  links: Record<LinkId, LinkMeta>;
  adjacency: Record<NodeId, LinkId[]>;
  nodeTypes: Record<NodeTypeId, NodeTypeDefinition>;
  linkTypes: Record<LinkTypeId, LinkTypeDefinition>;
  config: GraphConfig;
  meta: GraphFileMeta;
}

export interface RuntimeViewState {
  selectedNodeId: NodeId | null;
  selectedLinkId: LinkId | null;
  sidebarWidth: number;
}

export interface GraphDocument {
  graph: GraphFile;
  view: RuntimeViewState;
}

export type NodeInteractionTrigger = 'hover' | 'primary' | 'open';

export function resolveNodeAction(
  document: GraphDocument,
  node: NodeMeta,
  trigger: NodeInteractionTrigger,
): GraphTargetAction {
  if (trigger === 'open') {
    if (node.file) {
      return 'openLinkedFile';
    }
    if (node.subgraph) {
      return 'enterSubgraph';
    }
  }

  const typeBehavior = node.type ? document.graph.config.behaviors?.nodeTypes?.[node.type]?.[trigger] : undefined;
  const defaultBehavior = document.graph.config.behaviors?.defaults?.[trigger];
  return typeBehavior ?? defaultBehavior ?? (trigger === 'primary' ? 'selectNode' : 'noop');
}

export function assertGraphDocumentConfig(document: GraphDocument): void {
  const missingFields: string[] = [];
  const layout = document.graph.config?.layout;
  const rendering = document.graph.config?.rendering;

  if (!layout || typeof layout !== 'object') {
    missingFields.push('config.layout');
  } else {
    collectMissingNumberFields(layout, 'config.layout', [
      'linkDistance',
      'linkStrength',
      'chargeStrength',
      'chargeDistanceMax',
      'collisionPadding',
      'collisionStrength',
      'centerStrength',
      'alphaFloor',
      'alphaDecay',
      'velocityDecay',
    ], missingFields);
  }

  if (!rendering || typeof rendering !== 'object') {
    missingFields.push('config.rendering');
  } else {
    collectMissingNumberFields(rendering, 'config.rendering', [
      'baseNodeRadius',
      'contentLengthDivisor',
      'degreeRadiusBoost',
      'minNodePixelSize',
      'minFocusNodePixelSize',
      'focusRadius',
      'proximityRange',
      'hoverStopRange',
      'linkHoverDistance',
      'maxNodeScaleMultiplier',
      'maxTextScaleMultiplier',
      'baseLabelFontSize',
      'minLabelPixelSize',
      'labelZoomThreshold',
      'dimmedOpacity',
      'relatedOpacity',
      'pulseSpeed',
    ], missingFields);
  }

  if (missingFields.length > 0) {
    throw new Error(`图元文件配置不完整，缺少: ${missingFields.join(', ')}。这是显式格式变更，请使用“重置图谱”写入新格式，或手动补齐配置。`);
  }
}

function collectMissingNumberFields(
  target: object,
  prefix: string,
  fields: string[],
  missingFields: string[],
): void {
  const record = target as Record<string, unknown>;
  fields.forEach((field) => {
    if (typeof record[field] !== 'number' || Number.isNaN(record[field])) {
      missingFields.push(`${prefix}.${field}`);
    }
  });
}