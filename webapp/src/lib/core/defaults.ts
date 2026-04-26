import type { EdgeTypeDefinition, GraphConfig, GraphDocument, GraphFile, NodeTypeDefinition } from './schema';

const now = () => Date.now();

export const DEFAULT_NODE_TYPES: Record<string, NodeTypeDefinition> = {
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
};

export const DEFAULT_EDGE_TYPES: Record<string, EdgeTypeDefinition> = {
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
};

export const DEFAULT_GRAPH_CONFIG: GraphConfig = {
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
    edgeHoverDistance: 10,
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
};

export function createInitialGraph(): GraphFile {
  const createdAt = now();
  const rootNodeId = 'origin-root';

  return {
    format: 'stars.graph.v1',
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
        createdAt,
        updatedAt: createdAt,
      },
    },
    edges: {},
    adjacency: {
      [rootNodeId]: [],
    },
    nodeTypes: DEFAULT_NODE_TYPES,
    edgeTypes: DEFAULT_EDGE_TYPES,
    config: structuredClone(DEFAULT_GRAPH_CONFIG),
    meta: {
      createdAt,
      updatedAt: createdAt,
    },
  };
}

export function createInitialDocument(): GraphDocument {
  const graph = createInitialGraph();

  return {
    graph,
    view: {
      selectedNodeId: graph.rootNodeId,
      selectedEdgeId: null,
      sidebarWidth: 340,
    },
  };
}