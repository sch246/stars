import type { EdgeId, EdgeMeta, GraphConfig, GraphFile, NodeId, NodeMeta, SubgraphRef, WorkspaceFileRef } from './schema';

export type GraphConfigPatch = {
  layout?: Partial<GraphConfig['layout']>;
  rendering?: Partial<GraphConfig['rendering']>;
  behaviors?: GraphConfig['behaviors'];
};

export type GraphOperation =
  | { kind: 'createNode'; node: NodeMeta }
  | { kind: 'restoreNode'; node: NodeMeta; edges: EdgeMeta[] }
  | { kind: 'deleteNode'; nodeId: NodeId; deletedNode?: NodeMeta; deletedEdges?: EdgeMeta[] }
  | { kind: 'patchNode'; nodeId: NodeId; patch: Partial<Pick<NodeMeta, 'label' | 'summary' | 'type' | 'color' | 'file' | 'subgraph' | 'metrics'>>; previous?: Partial<NodeMeta> }
  | { kind: 'createEdge'; edge: EdgeMeta }
  | { kind: 'deleteEdge'; edgeId: EdgeId; deletedEdge?: EdgeMeta }
  | { kind: 'attachFile'; nodeId: NodeId; file: WorkspaceFileRef; previous?: WorkspaceFileRef }
  | { kind: 'detachFile'; nodeId: NodeId; previous?: WorkspaceFileRef }
  | { kind: 'attachSubgraph'; nodeId: NodeId; subgraph: SubgraphRef; previous?: SubgraphRef }
  | { kind: 'detachSubgraph'; nodeId: NodeId; previous?: SubgraphRef }
  | { kind: 'patchGraphConfig'; patch: GraphConfigPatch; previous?: GraphConfigPatch };

export interface AppliedGraphOperation {
  graph: GraphFile;
  inverse: GraphOperation;
}

export class GraphOperationConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphOperationConflict';
  }
}

export function applyGraphOperation(graph: GraphFile, operation: GraphOperation): AppliedGraphOperation {
  const draft = structuredClone(graph) as GraphFile;
  const inverse = applyToDraft(draft, operation);
  draft.revision += 1;
  draft.meta.updatedAt = Date.now();

  return {
    graph: draft,
    inverse,
  };
}

function applyToDraft(graph: GraphFile, operation: GraphOperation): GraphOperation {
  switch (operation.kind) {
    case 'createNode': {
      if (graph.nodes[operation.node.id]) {
        throw new GraphOperationConflict(`节点已存在: ${operation.node.id}`);
      }

      graph.nodes[operation.node.id] = operation.node;
      graph.adjacency[operation.node.id] = [];
      return { kind: 'deleteNode', nodeId: operation.node.id };
    }

    case 'restoreNode': {
      if (graph.nodes[operation.node.id]) {
        throw new GraphOperationConflict(`节点已存在: ${operation.node.id}`);
      }

      graph.nodes[operation.node.id] = operation.node;
      graph.adjacency[operation.node.id] = [];
      operation.edges.forEach((edge) => {
        if (!graph.nodes[edge.sourceId] || !graph.nodes[edge.targetId]) {
          throw new GraphOperationConflict(`无法恢复关系，端点不存在: ${edge.id}`);
        }
        graph.edges[edge.id] = edge;
        addAdjacency(graph, edge.sourceId, edge.id);
        addAdjacency(graph, edge.targetId, edge.id);
      });

      return { kind: 'deleteNode', nodeId: operation.node.id };
    }

    case 'deleteNode': {
      const node = graph.nodes[operation.nodeId];
      if (!node) {
        throw new GraphOperationConflict(`节点不存在: ${operation.nodeId}`);
      }
      if (operation.nodeId === graph.rootNodeId) {
        throw new GraphOperationConflict('不能删除根节点');
      }

      const incidentEdges = Object.values(graph.edges).filter((edge) => {
        return edge.sourceId === operation.nodeId || edge.targetId === operation.nodeId;
      });

      incidentEdges.forEach((edge) => removeEdge(graph, edge.id));
      delete graph.nodes[operation.nodeId];
      delete graph.adjacency[operation.nodeId];

      return { kind: 'restoreNode', node, edges: incidentEdges };
    }

    case 'patchNode': {
      const node = graph.nodes[operation.nodeId];
      if (!node) {
        throw new GraphOperationConflict(`节点不存在: ${operation.nodeId}`);
      }

      const previous: Partial<NodeMeta> = {};
      Object.keys(operation.patch).forEach((key) => {
        const typedKey = key as keyof typeof operation.patch;
        previous[typedKey] = node[typedKey] as never;
      });

      Object.assign(node, operation.patch, { updatedAt: Date.now() });
      return { kind: 'patchNode', nodeId: operation.nodeId, patch: previous };
    }

    case 'createEdge': {
      if (graph.edges[operation.edge.id]) {
        throw new GraphOperationConflict(`关系已存在: ${operation.edge.id}`);
      }
      if (!graph.nodes[operation.edge.sourceId]) {
        throw new GraphOperationConflict(`关系起点不存在: ${operation.edge.sourceId}`);
      }
      if (!graph.nodes[operation.edge.targetId]) {
        throw new GraphOperationConflict(`关系终点不存在: ${operation.edge.targetId}`);
      }

      graph.edges[operation.edge.id] = operation.edge;
      addAdjacency(graph, operation.edge.sourceId, operation.edge.id);
      addAdjacency(graph, operation.edge.targetId, operation.edge.id);
      return { kind: 'deleteEdge', edgeId: operation.edge.id };
    }

    case 'deleteEdge': {
      const edge = graph.edges[operation.edgeId];
      if (!edge) {
        throw new GraphOperationConflict(`关系不存在: ${operation.edgeId}`);
      }

      removeEdge(graph, operation.edgeId);
      return { kind: 'createEdge', edge };
    }

    case 'attachFile': {
      const node = requireNode(graph, operation.nodeId);
      const previous = node.file;
      node.file = operation.file;
      node.updatedAt = Date.now();
      return previous
        ? { kind: 'attachFile', nodeId: node.id, file: previous }
        : { kind: 'detachFile', nodeId: node.id };
    }

    case 'detachFile': {
      const node = requireNode(graph, operation.nodeId);
      const previous = node.file;
      if (!previous) {
        throw new GraphOperationConflict(`节点未关联文件: ${operation.nodeId}`);
      }
      delete node.file;
      node.updatedAt = Date.now();
      return { kind: 'attachFile', nodeId: node.id, file: previous };
    }

    case 'attachSubgraph': {
      const node = requireNode(graph, operation.nodeId);
      const previous = node.subgraph;
      node.subgraph = operation.subgraph;
      node.updatedAt = Date.now();
      return previous
        ? { kind: 'attachSubgraph', nodeId: node.id, subgraph: previous }
        : { kind: 'detachSubgraph', nodeId: node.id };
    }

    case 'detachSubgraph': {
      const node = requireNode(graph, operation.nodeId);
      const previous = node.subgraph;
      if (!previous) {
        throw new GraphOperationConflict(`节点未关联子图: ${operation.nodeId}`);
      }
      delete node.subgraph;
      node.updatedAt = Date.now();
      return { kind: 'attachSubgraph', nodeId: node.id, subgraph: previous };
    }

    case 'patchGraphConfig': {
      const previous = collectPreviousConfig(graph.config, operation.patch);
      graph.config = mergeGraphConfig(graph.config, operation.patch);
      return { kind: 'patchGraphConfig', patch: previous };
    }
  }
}

function collectPreviousConfig(config: GraphConfig, patch: GraphConfigPatch): GraphConfigPatch {
  return {
    layout: patch.layout ? pickExisting(config.layout, patch.layout) : undefined,
    rendering: patch.rendering ? pickExisting(config.rendering, patch.rendering) : undefined,
    behaviors: patch.behaviors ? structuredClone(config.behaviors) : undefined,
  };
}

function mergeGraphConfig(config: GraphConfig, patch: GraphConfigPatch): GraphConfig {
  return {
    ...config,
    layout: {
      ...config.layout,
      ...(patch.layout ?? {}),
    },
    rendering: {
      ...config.rendering,
      ...(patch.rendering ?? {}),
    },
    behaviors: patch.behaviors ?? config.behaviors,
  };
}

function pickExisting<T extends object>(source: T, patch: Partial<T>): Partial<T> {
  const previous: Partial<T> = {};
  (Object.keys(patch) as Array<keyof T>).forEach((key) => {
    previous[key] = source[key];
  });
  return previous;
}

function requireNode(graph: GraphFile, nodeId: NodeId): NodeMeta {
  const node = graph.nodes[nodeId];
  if (!node) {
    throw new GraphOperationConflict(`节点不存在: ${nodeId}`);
  }
  return node;
}

function addAdjacency(graph: GraphFile, nodeId: NodeId, edgeId: EdgeId) {
  graph.adjacency[nodeId] ??= [];
  if (!graph.adjacency[nodeId].includes(edgeId)) {
    graph.adjacency[nodeId].push(edgeId);
  }
}

function removeEdge(graph: GraphFile, edgeId: EdgeId) {
  const edge = graph.edges[edgeId];
  if (!edge) {
    return;
  }

  graph.adjacency[edge.sourceId] = (graph.adjacency[edge.sourceId] ?? []).filter((id) => id !== edgeId);
  graph.adjacency[edge.targetId] = (graph.adjacency[edge.targetId] ?? []).filter((id) => id !== edgeId);
  delete graph.edges[edgeId];
}