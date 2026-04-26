import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { quadtree, type Quadtree } from 'd3-quadtree';
import { escapeHtml, renderSummaryMarkdown } from '../core/markdown';
import type { EdgeMeta, GraphDocument, GraphConfig, NodeMeta } from '../core/schema';

interface GraphRuntimeOptions {
  getDocument: () => GraphDocument;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onClearFocus: () => void;
  onCreateEdge: (sourceId: string, targetId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onOpenNode: (nodeId: string) => void;
  onNavigateBack: () => void;
  onImportFile: (pathOrUri: string) => void;
}

interface RuntimeNodeState extends SimulationNodeDatum {
  nodeId: string;
  radius: number;
}

interface RuntimeLinkState extends SimulationLinkDatum<RuntimeNodeState> {
  edgeId: string;
  type: string;
}

interface CameraState {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface DoubleClickCandidate {
  nodeId: string;
  clientX: number;
  clientY: number;
  timestamp: number;
}

const DOUBLE_CLICK_TARGET_MAX_AGE_MS = 700;
const DOUBLE_CLICK_TARGET_RADIUS_PX = 8;

export class GraphRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly options: GraphRuntimeOptions;
  private animationFrame = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private graphSignature = '';
  private lastFrameTime = 0;
  private didPan = false;
  private didClearFocusForPan = false;
  private isPanning = false;
  private panButton: number | null = null;
  private isRotating = false;
  private hoveredNodeId: string | null = null;
  private hoveredEdgeId: string | null = null;
  private draggedNodeId: string | null = null;
  private dragTarget: ScreenPoint | null = null;
  private linkDragSourceId: string | null = null;
  private pendingClickNodeId: string | null = null;
  private pendingClickEdgeId: string | null = null;
  private doubleClickCandidate: DoubleClickCandidate | null = null;
  private pointer: ScreenPoint | null = null;
  private lastPointer = { x: 0, y: 0 };
  private simulation: Simulation<RuntimeNodeState, RuntimeLinkState> | null = null;
  private quadtreeIndex: Quadtree<RuntimeNodeState> | null = null;
  private readonly camera: CameraState = { x: 0, y: 0, scale: 1, rotation: 0 };
  private cameraLookAt: ScreenPoint | null = null;
  private tooltipElement: HTMLDivElement | null = null;
  private readonly runtimeNodes = new Map<string, RuntimeNodeState>();
  private readonly resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, options: GraphRuntimeOptions) {
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D 上下文不可用');
    }

    this.canvas = canvas;
    this.context = context;
    this.options = options;
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  start() {
    this.resize();
    this.createTooltipElement();
    this.resizeObserver.observe(this.canvas);
    this.canvas.addEventListener('click', this.handleClick);
    this.canvas.addEventListener('dblclick', this.handleDoubleClick);
    this.canvas.addEventListener('mousemove', this.handlePointerMove);
    this.canvas.addEventListener('mouseleave', this.handlePointerLeave);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('dragover', this.handleDragOver);
    this.canvas.addEventListener('drop', this.handleDrop);
    window.addEventListener('mousemove', this.handleWindowMouseMove);
    window.addEventListener('mouseup', this.handleWindowMouseUp);
    this.frame();
  }

  destroy() {
    cancelAnimationFrame(this.animationFrame);
    this.simulation?.stop();
    this.tooltipElement?.remove();
    this.tooltipElement = null;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('dblclick', this.handleDoubleClick);
    this.canvas.removeEventListener('mousemove', this.handlePointerMove);
    this.canvas.removeEventListener('mouseleave', this.handlePointerLeave);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('dragover', this.handleDragOver);
    this.canvas.removeEventListener('drop', this.handleDrop);
    window.removeEventListener('mousemove', this.handleWindowMouseMove);
    window.removeEventListener('mouseup', this.handleWindowMouseUp);
  }

  navigateDirection(targetAngle: number, rotateView = false) {
    const document = this.options.getDocument();
    const selectedNodeId = document.view.selectedNodeId;
    if (!selectedNodeId) {
      return;
    }

    const source = this.runtimeNodes.get(selectedNodeId);
    if (!source) {
      return;
    }

    let bestNodeId: string | null = null;
    let bestRawAngle = 0;
    let bestDiff = 1.2;

    (document.graph.adjacency[selectedNodeId] ?? []).forEach((edgeId) => {
      const edge = document.graph.edges[edgeId];
      if (!edge) {
        return;
      }

      const otherNodeId = edge.sourceId === selectedNodeId ? edge.targetId : edge.sourceId;
      const target = this.runtimeNodes.get(otherNodeId);
      if (!target) {
        return;
      }

      const rawAngle = Math.atan2((target.y ?? 0) - (source.y ?? 0), (target.x ?? 0) - (source.x ?? 0));
      const viewAngle = normalizeAngle(rawAngle + this.camera.rotation);
      const diff = Math.abs(normalizeAngle(viewAngle - targetAngle));
      if (diff < bestDiff) {
        bestDiff = diff;
        bestRawAngle = rawAngle;
        bestNodeId = otherNodeId;
      }
    });

    if (!bestNodeId) {
      return;
    }

    if (rotateView) {
      const center = this.currentCameraLookAt();
      this.camera.rotation = normalizeAngle(targetAngle - bestRawAngle);
      this.setCameraOffsetForWorldPoint(center, this.width / 2, this.height / 2);
    }

    this.options.onSelectNode(bestNodeId);
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private readonly handlePointerMove = (event: MouseEvent) => {
    this.pointer = { x: event.offsetX, y: event.offsetY };
    if (this.isPanning || this.isRotating || this.draggedNodeId || this.linkDragSourceId) {
      return;
    }

    this.refreshHoverState();
    this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
  };

  private readonly handlePointerLeave = () => {
    this.pointer = null;
    this.hoveredNodeId = null;
    this.hoveredEdgeId = null;
    if (!this.isPanning && !this.isRotating && !this.draggedNodeId && !this.linkDragSourceId) {
      this.canvas.style.cursor = 'crosshair';
    }
  };

  private readonly handleMouseDown = (event: MouseEvent) => {
    this.canvas.focus();
    this.pointer = { x: event.offsetX, y: event.offsetY };
    this.didPan = false;
    this.didClearFocusForPan = false;
    this.pendingClickNodeId = null;
    this.pendingClickEdgeId = null;
    this.lastPointer = { x: event.clientX, y: event.clientY };

    if (event.button === 0) {
      const repeatedNodeId = this.getDoubleClickCandidateNodeId(event);
      if (repeatedNodeId) {
        event.preventDefault();
        this.pendingClickNodeId = repeatedNodeId;
        this.options.onSelectNode(repeatedNodeId);
        this.canvas.style.cursor = 'pointer';
        return;
      }

      const hit = this.pickNode(event.offsetX, event.offsetY);
      if (!hit) {
        const edge = this.pickEdge(event.offsetX, event.offsetY);
        this.pendingClickEdgeId = edge?.id ?? null;
        event.preventDefault();
        this.isRotating = true;
        this.canvas.style.cursor = 'alias';
        return;
      }

      event.preventDefault();
      this.rememberDoubleClickCandidate(hit.nodeId, event);
      this.pendingClickNodeId = hit.nodeId;
      this.draggedNodeId = hit.nodeId;
      this.dragTarget = this.screenToWorld(event.offsetX, event.offsetY);
      this.options.onSelectNode(hit.nodeId);
      this.canvas.style.cursor = 'grabbing';
      this.simulation?.alpha(0.3).restart();
      return;
    }

    if (event.button === 1) {
      event.preventDefault();
      this.isPanning = true;
      this.panButton = event.button;
      this.canvas.style.cursor = 'move';
      return;
    }

    if (event.button === 2) {
      if (event.shiftKey) {
        event.preventDefault();
        const hit = this.pickNode(event.offsetX, event.offsetY);
        if (hit) {
          this.options.onDeleteNode(hit.nodeId);
          return;
        }

        const edge = this.pickEdge(event.offsetX, event.offsetY);
        if (edge) {
          this.options.onDeleteEdge(edge.id);
        }
        return;
      }

      const hit = this.pickNode(event.offsetX, event.offsetY);
      if (!hit) {
        event.preventDefault();
        this.isPanning = true;
        this.panButton = event.button;
        this.canvas.style.cursor = 'move';
        return;
      }

      event.preventDefault();
      this.linkDragSourceId = hit.nodeId;
      this.hoveredNodeId = hit.nodeId;
      this.hoveredEdgeId = null;
      this.canvas.style.cursor = 'grabbing';
      this.simulation?.alpha(0.3).restart();
      return;
    }

    if (event.button === 3) {
      event.preventDefault();
      this.options.onNavigateBack();
    }
  };

  private readonly handleWindowMouseMove = (event: MouseEvent) => {
    if (this.linkDragSourceId) {
      this.pointer = this.clientToCanvasPoint(event.clientX, event.clientY);
      this.refreshHoverState();
      this.didPan = true;
      return;
    }

    if (this.draggedNodeId) {
      const point = this.clientToCanvasPoint(event.clientX, event.clientY);
      this.dragTarget = this.screenToWorld(point.x, point.y);
      this.simulation?.alpha(0.18).restart();
      this.didPan = true;
      return;
    }

    if (this.isRotating) {
      const previous = this.clientToCanvasPoint(this.lastPointer.x, this.lastPointer.y);
      const next = this.clientToCanvasPoint(event.clientX, event.clientY);
      const center = this.currentCameraLookAt();
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.camera.rotation += getRotationDeltaAroundCenter(previous, next, this.width, this.height);
      this.setCameraOffsetForWorldPoint(center, this.width / 2, this.height / 2);
      this.didPan ||= Math.hypot(next.x - previous.x, next.y - previous.y) > 2;
      return;
    }

    if (!this.isPanning) {
      return;
    }

    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.camera.x += dx;
    this.camera.y += dy;
    this.didPan ||= Math.abs(dx) + Math.abs(dy) > 2;
    if (this.didPan && !this.didClearFocusForPan) {
      this.didClearFocusForPan = true;
      this.options.onClearFocus();
    }
  };

  private readonly handleWindowMouseUp = (event: MouseEvent) => {
    if (this.linkDragSourceId) {
      const sourceId = this.linkDragSourceId;
      const point = this.clientToCanvasPoint(event.clientX, event.clientY);
      const target = this.pickNode(point.x, point.y);
      if (target && target.nodeId !== sourceId) {
        this.options.onCreateEdge(sourceId, target.nodeId);
      }
      this.linkDragSourceId = null;
      this.hoveredNodeId = target?.nodeId ?? null;
      this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
      return;
    }

    if (this.draggedNodeId) {
      this.draggedNodeId = null;
      this.dragTarget = null;
      this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
      return;
    }

    if (this.isRotating) {
      this.isRotating = false;
      this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
      return;
    }

    if (!this.isPanning) {
      return;
    }

    if (this.panButton !== null && event.button !== this.panButton) {
      return;
    }

    this.isPanning = false;
    this.panButton = null;
    this.canvas.style.cursor = this.hoveredNodeId || this.hoveredEdgeId ? 'pointer' : 'crosshair';
  };

  private readonly handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private readonly handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.pointer = { x: event.offsetX, y: event.offsetY };
    const before = this.screenToWorld(event.offsetX, event.offsetY);
    const nextScale = clamp(this.camera.scale * (event.deltaY > 0 ? 0.9 : 1.1), 0.18, 3.2);
    this.camera.scale = nextScale;
    this.setCameraOffsetForWorldPoint(before, event.offsetX, event.offsetY);
  };

  private readonly handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  };

  private readonly handleDrop = (event: DragEvent) => {
    event.preventDefault();
    extractDroppedFileReferences(event.dataTransfer).forEach((pathOrUri) => {
      this.options.onImportFile(pathOrUri);
    });
  };

  private readonly handleClick = (event: MouseEvent) => {
    if (this.didPan) {
      this.didPan = false;
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      this.doubleClickCandidate = null;
      return;
    }

    if (this.pendingClickNodeId && this.runtimeNodes.has(this.pendingClickNodeId)) {
      this.options.onSelectNode(this.pendingClickNodeId);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    const document = this.options.getDocument();
    if (this.pendingClickEdgeId && document.graph.edges[this.pendingClickEdgeId]) {
      this.options.onSelectEdge(this.pendingClickEdgeId);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    const repeatedNodeId = this.getDoubleClickCandidateNodeId(event);
    if (repeatedNodeId) {
      this.options.onSelectNode(repeatedNodeId);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    const hit = this.pickNode(event.offsetX, event.offsetY);
    if (hit) {
      this.options.onSelectNode(hit.nodeId);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    const edge = this.pickEdge(event.offsetX, event.offsetY);
    if (edge) {
      this.options.onSelectEdge(edge.id);
      this.pendingClickNodeId = null;
      this.pendingClickEdgeId = null;
      return;
    }

    this.pendingClickNodeId = null;
    this.pendingClickEdgeId = null;
    if (event.detail < 2) {
      this.doubleClickCandidate = null;
    }
    this.options.onClearFocus();
  };

  private readonly handleDoubleClick = (event: MouseEvent) => {
    const hit = this.pickNode(event.offsetX, event.offsetY);
    const nodeId = hit?.nodeId ?? this.getDoubleClickCandidateNodeId(event);
    if (!nodeId) {
      return;
    }

    event.preventDefault();
    this.doubleClickCandidate = null;
    this.options.onOpenNode(nodeId);
  };

  private rememberDoubleClickCandidate(nodeId: string, event: MouseEvent) {
    this.doubleClickCandidate = {
      nodeId,
      clientX: event.clientX,
      clientY: event.clientY,
      timestamp: performance.now(),
    };
  }

  private getDoubleClickCandidateNodeId(event: MouseEvent): string | null {
    if (event.detail < 2 || !this.doubleClickCandidate) {
      return null;
    }

    if (performance.now() - this.doubleClickCandidate.timestamp > DOUBLE_CLICK_TARGET_MAX_AGE_MS) {
      this.doubleClickCandidate = null;
      return null;
    }

    if (!this.options.getDocument().graph.nodes[this.doubleClickCandidate.nodeId]) {
      this.doubleClickCandidate = null;
      return null;
    }

    const distance = Math.hypot(
      event.clientX - this.doubleClickCandidate.clientX,
      event.clientY - this.doubleClickCandidate.clientY,
    );
    return distance <= DOUBLE_CLICK_TARGET_RADIUS_PX ? this.doubleClickCandidate.nodeId : null;
  }

  private frame = () => {
    this.render(performance.now());
    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private render(now: number) {
    const deltaTime = this.lastFrameTime ? now - this.lastFrameTime : 16.67;
    this.lastFrameTime = now;
    const document = this.options.getDocument();
    this.syncRuntimeGraph(document);
    this.rebuildQuadtree();
    this.applyPointerDragForce();
    this.applyFocusCamera(document, deltaTime);
    this.refreshHoverState();

    const ctx = this.context;
    ctx.clearRect(0, 0, this.width, this.height);

    const background = ctx.createLinearGradient(0, 0, 0, this.height);
    background.addColorStop(0, '#07070b');
    background.addColorStop(1, '#030305');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);

    this.drawNoise(ctx);
    this.drawLinks(ctx, document);
    this.drawLinkDragPreview(ctx);
    this.drawNodes(ctx, document, now);
    this.updateTooltip(document);
    this.keepSimulationAlive(document.graph.config);
  }

  private createTooltipElement() {
    if (this.tooltipElement) {
      return;
    }

    const tooltip = document.createElement('div');
    tooltip.className = 'graph-tooltip';
    tooltip.hidden = true;
    (this.canvas.parentElement ?? document.body).appendChild(tooltip);
    this.tooltipElement = tooltip;
  }

  private updateTooltip(document: GraphDocument) {
    if (!this.tooltipElement || !this.pointer || !this.hoveredNodeId || this.draggedNodeId || this.linkDragSourceId) {
      this.hideTooltip();
      return;
    }

    const node = document.graph.nodes[this.hoveredNodeId];
    if (!node) {
      this.hideTooltip();
      return;
    }

    const summaryHtml = renderSummaryMarkdown(node.summary ?? '');
    this.tooltipElement.innerHTML = [
      `<div class="graph-tooltip-title">${escapeHtml(node.label)}</div>`,
      summaryHtml ? `<div class="graph-tooltip-summary">${summaryHtml}</div>` : '',
    ].join('');
    this.tooltipElement.hidden = false;

    const tooltipWidth = this.tooltipElement.offsetWidth;
    const tooltipHeight = this.tooltipElement.offsetHeight;
    const left = Math.min(this.pointer.x + 18, Math.max(12, this.width - tooltipWidth - 12));
    const top = Math.min(this.pointer.y + 18, Math.max(12, this.height - tooltipHeight - 12));
    this.tooltipElement.style.left = `${left}px`;
    this.tooltipElement.style.top = `${top}px`;
  }

  private hideTooltip() {
    if (this.tooltipElement) {
      this.tooltipElement.hidden = true;
    }
  }

  private syncRuntimeGraph(document: GraphDocument) {
    const nodes = Object.values(document.graph.nodes);
    const nodeIds = new Set(nodes.map((node) => node.id));

    [...this.runtimeNodes.keys()].forEach((nodeId) => {
      if (!nodeIds.has(nodeId)) {
        this.runtimeNodes.delete(nodeId);
      }
    });

    const shouldSeedNewNodesAtViewCenter = this.runtimeNodes.size > 0;

    nodes.forEach((node, index) => {
      const radius = this.getNodeWorldRadius(node, document);
      const existing = this.runtimeNodes.get(node.id);
      if (existing) {
        existing.radius = radius;
        return;
      }

      const angle = index * 2.399963229728653;
      const distance = Math.sqrt(index + 1) * 82;
      const center = shouldSeedNewNodesAtViewCenter ? this.currentCameraLookAt() : null;
      this.runtimeNodes.set(node.id, {
        nodeId: node.id,
        x: center ? center.x : Math.cos(angle) * distance,
        y: center ? center.y : Math.sin(angle) * distance,
        radius,
      });
    });

    const signature = createGraphSignature(document);
    if (signature !== this.graphSignature) {
      this.graphSignature = signature;
      this.rebuildSimulation(document);
    }
  }

  private rebuildSimulation(document: GraphDocument) {
    const layout = document.graph.config.layout;
    const nodes = [...this.runtimeNodes.values()];
    const links: RuntimeLinkState[] = Object.values(document.graph.edges)
      .filter((edge) => this.runtimeNodes.has(edge.sourceId) && this.runtimeNodes.has(edge.targetId))
      .map((edge) => ({
        edgeId: edge.id,
        type: edge.type,
        source: edge.sourceId,
        target: edge.targetId,
      }));

    this.simulation?.stop();
    const rendering = document.graph.config.rendering;
    this.simulation = forceSimulation<RuntimeNodeState, RuntimeLinkState>(nodes)
      .force('link', forceLink<RuntimeNodeState, RuntimeLinkState>(links)
        .id((node) => node.nodeId)
        .distance(layout.linkDistance)
        .strength(layout.linkStrength))
      .force('charge', forceManyBody<RuntimeNodeState>()
        .strength(layout.chargeStrength)
        .distanceMax(layout.chargeDistanceMax))
      .force('collide', forceCollide<RuntimeNodeState>()
        .radius((node) => Math.max(
          node.radius + (rendering.focusRadius - rendering.baseNodeRadius) + layout.collisionPadding,
          rendering.focusRadius,
        ))
        .strength(layout.collisionStrength))
      .force('centerX', forceX<RuntimeNodeState>(0).strength(layout.centerStrength))
      .force('centerY', forceY<RuntimeNodeState>(0).strength(layout.centerStrength))
      .alphaDecay(layout.alphaDecay)
      .alphaMin(0)
      .velocityDecay(layout.velocityDecay)
      .alpha(Math.max(0.8, layout.alphaFloor))
      .restart();
  }

  private keepSimulationAlive(config: GraphConfig) {
    if (!this.simulation) {
      return;
    }

    if (this.simulation.alpha() < config.layout.alphaFloor) {
      this.simulation.alpha(config.layout.alphaFloor).restart();
    }
  }

  private rebuildQuadtree() {
    this.quadtreeIndex = quadtree<RuntimeNodeState>()
      .x((node) => node.x ?? 0)
      .y((node) => node.y ?? 0)
      .addAll([...this.runtimeNodes.values()]);
  }

  private refreshHoverState() {
    if (!this.pointer) {
      this.hoveredNodeId = null;
      this.hoveredEdgeId = null;
      return;
    }

    const node = this.pickNode(this.pointer.x, this.pointer.y);
    this.hoveredNodeId = node?.nodeId ?? null;
    this.hoveredEdgeId = node ? null : this.pickEdge(this.pointer.x, this.pointer.y)?.id ?? null;
  }

  private drawNoise(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#4facfe';

    for (let index = 0; index < 40; index += 1) {
      const x = (index * 173) % Math.max(this.width, 1);
      const y = (index * 97) % Math.max(this.height, 1);
      ctx.fillRect(x, y, 1.2, 1.2);
    }

    ctx.restore();
  }

  private drawLinks(ctx: CanvasRenderingContext2D, document: GraphDocument) {
    const subjects = this.getNodeSubjectIds(document);
    const related = this.getRelatedNodeIds(document, subjects);

    ctx.save();

    Object.values(document.graph.edges).forEach((edge) => {
      const source = this.runtimeNodes.get(edge.sourceId);
      const target = this.runtimeNodes.get(edge.targetId);
      if (!source || !target) {
        return;
      }

      const from = this.worldToScreen(source.x ?? 0, source.y ?? 0);
      const to = this.worldToScreen(target.x ?? 0, target.y ?? 0);
      const sourceIsSubject = subjects.has(edge.sourceId);
      const targetIsSubject = subjects.has(edge.targetId);
      const sourceIsRelated = related.has(edge.sourceId);
      const targetIsRelated = related.has(edge.targetId);
      const isDirectFocus = sourceIsSubject || targetIsSubject;
      const focused = edge.id === document.view.selectedEdgeId;
      const isTarget = focused || edge.id === this.hoveredEdgeId;
      const isNearby = isDirectFocus || sourceIsRelated || targetIsRelated;
      const style = document.graph.edgeTypes[edge.type]?.style;
      const color = style?.color ?? '#666666';
      const opacity = isTarget
        ? 1
        : isDirectFocus
          ? document.graph.config.rendering.relatedOpacity
          : isNearby
            ? document.graph.config.rendering.relatedOpacity
            : 0.3;

      const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'rgba(255,255,255,0.24)');

      ctx.setLineDash(style?.dash ?? []);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = (isTarget ? 4 : isDirectFocus ? 2.5 : style?.width ?? 1.5) * Math.sqrt(this.camera.scale);
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      if (this.shouldDrawEdgeLabel(edge, style?.labelVisible, isTarget)) {
        this.drawEdgeLabel(ctx, edge, from, to, color);
      }
    });

    ctx.restore();
  }

  private drawLinkDragPreview(ctx: CanvasRenderingContext2D) {
    if (!this.linkDragSourceId || !this.pointer) {
      return;
    }

    const source = this.runtimeNodes.get(this.linkDragSourceId);
    if (!source) {
      return;
    }

    const from = this.worldToScreen(source.x ?? 0, source.y ?? 0);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = this.hoveredNodeId && this.hoveredNodeId !== this.linkDragSourceId ? '#ffffff' : '#666666';
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(this.pointer.x, this.pointer.y);
    ctx.stroke();
    ctx.restore();
  }

  private shouldDrawEdgeLabel(edge: EdgeMeta, labelVisible: string | undefined, isDirectFocus: boolean): boolean {
    if (!edge.label && !edge.type) {
      return false;
    }
    if (labelVisible === 'never') {
      return false;
    }
    if (labelVisible === 'always') {
      return true;
    }
    return isDirectFocus;
  }

  private drawEdgeLabel(
    ctx: CanvasRenderingContext2D,
    edge: EdgeMeta,
    from: ScreenPoint,
    to: ScreenPoint,
    color: string,
  ) {
    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.font = '11px Segoe UI';
    ctx.textAlign = 'center';
    ctx.fillText(edge.label ?? edge.type, (from.x + to.x) / 2, ((from.y + to.y) / 2) - 8);
    ctx.restore();
  }

  private drawNodes(ctx: CanvasRenderingContext2D, document: GraphDocument, now: number) {
    const rendering = document.graph.config.rendering;
    const pulse = Math.sin(now * rendering.pulseSpeed) * 0.5 + 1;

    ctx.save();

    Object.values(document.graph.nodes).forEach((node) => {
      const runtime = this.runtimeNodes.get(node.id);
      if (!runtime) {
        return;
      }

      const selected = node.id === document.view.selectedNodeId;
      const hovered = node.id === this.hoveredNodeId;
      const focusLike = selected || hovered;
      const style = node.type ? document.graph.nodeTypes[node.type]?.style : undefined;
      const point = this.worldToScreen(runtime.x ?? 0, runtime.y ?? 0);
      const baseWorldRadius = this.getRenderBaseWorldRadius(runtime.radius, selected, rendering);
      const basePixelRadius = baseWorldRadius * this.camera.scale;
      const nodeScale = this.getNodeScale(point, baseWorldRadius, rendering.maxNodeScaleMultiplier, rendering, true);
      const textScale = focusLike
        ? rendering.maxTextScaleMultiplier
        : this.getProximityScale(point, rendering.maxTextScaleMultiplier, rendering, false);
      const color = node.color ?? style?.color ?? '#4facfe';
      const minRadius = selected ? rendering.minFocusNodePixelSize : rendering.minNodePixelSize;
      let radius = Math.max(basePixelRadius, minRadius) * nodeScale;
      const glowRadius = Math.max(selected ? 10 : 5, (selected ? 35 : 15) * this.camera.scale) * nodeScale;

      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowBlur = selected ? glowRadius * pulse : glowRadius;
      ctx.shadowColor = color;
      ctx.fill();

      ctx.shadowBlur = 0;
      if (this.shouldDrawNodeLabel(node, selected, hovered, style?.labelVisible, textScale, rendering)) {
        const fontSize = rendering.baseLabelFontSize * Math.sqrt(this.camera.scale) * textScale;
        if (fontSize > rendering.minLabelPixelSize) {
          ctx.globalAlpha = selected || hovered ? 1 : 0.82;
          ctx.fillStyle = selected || hovered ? '#ffffff' : 'rgba(220,220,220,0.82)';
          ctx.font = `${selected ? 'bold' : 'normal'} ${fontSize}px Segoe UI`;
          ctx.textAlign = 'center';
          ctx.fillText(node.label, point.x, point.y + radius + fontSize + 2);

          if ((selected || hovered) && node.metrics?.contentLength) {
            ctx.fillStyle = 'rgba(160,160,160,0.72)';
            ctx.font = `${Math.max(9, fontSize * 0.78)}px Segoe UI`;
            ctx.fillText(`${node.metrics.contentLength}`, point.x, point.y + radius + (fontSize * 2.15) + 4);
          }
        }
      }
    });

    ctx.restore();
  }

  private shouldDrawNodeLabel(
    node: NodeMeta,
    selected: boolean,
    hovered: boolean,
    labelVisible: string | undefined,
    textScale: number,
    rendering: GraphConfig['rendering'],
  ): boolean {
    if (!node.label) {
      return false;
    }
    if (selected || hovered) {
      return true;
    }
    if (labelVisible === 'always') {
      return true;
    }
    if (labelVisible === 'focus' || labelVisible === 'hover') {
      return false;
    }
    return this.camera.scale > rendering.labelZoomThreshold || textScale > 1.1;
  }

  private getNodeWorldRadius(node: NodeMeta, document: GraphDocument): number {
    const rendering = document.graph.config.rendering;
    const style = node.type ? document.graph.nodeTypes[node.type]?.style : undefined;
    const typeRadius = Math.min(style?.radius ?? rendering.baseNodeRadius, rendering.baseNodeRadius);
    const contentLength = node.metrics?.contentLength ?? 0;
    const degree = document.graph.adjacency[node.id]?.length ?? 0;
    return typeRadius
      + Math.sqrt(contentLength / rendering.contentLengthDivisor)
      + (Math.sqrt(degree) * rendering.degreeRadiusBoost);
  }

  private getRenderBaseWorldRadius(
    baseWorldRadius: number,
    selected: boolean,
    rendering: GraphConfig['rendering'],
  ): number {
    if (!selected || baseWorldRadius >= rendering.focusRadius) {
      return baseWorldRadius;
    }

    return Math.min(rendering.maxNodeScaleMultiplier * baseWorldRadius, rendering.focusRadius);
  }

  private getProximityScale(
    point: ScreenPoint,
    maxScale: number,
    rendering: GraphConfig['rendering'],
    compensateZoom: boolean,
  ): number {
    if (!this.pointer || maxScale <= 1) {
      return 1;
    }

    const dx = point.x - this.pointer.x;
    const dy = point.y - this.pointer.y;
    const zoomFactor = compensateZoom ? Math.sqrt(this.camera.scale) : this.camera.scale;
    const distance = Math.hypot(dx, dy) / Math.max(zoomFactor, 0.001);
    if (distance < rendering.hoverStopRange) {
      return maxScale;
    }
    if (distance >= rendering.proximityRange) {
      return 1;
    }

    const ratio = 1 - ((distance - rendering.hoverStopRange) / (rendering.proximityRange - rendering.hoverStopRange));
    return 1 + ((maxScale - 1) * ratio * ratio);
  }

  private getNodeScale(
    point: ScreenPoint,
    baseWorldRadius: number,
    maxScale: number,
    rendering: GraphConfig['rendering'],
    compensateZoom: boolean,
  ): number {
    if (baseWorldRadius >= rendering.focusRadius) {
      return 1;
    }

    const cappedMaxScale = Math.max(1, Math.min(maxScale, rendering.focusRadius / Math.max(baseWorldRadius, 0.001)));
    return this.getProximityScale(point, cappedMaxScale, rendering, compensateZoom);
  }

  private getNodeSubjectIds(document: GraphDocument): Set<string> {
    const subjects = new Set<string>();
    if (document.view.selectedNodeId) {
      subjects.add(document.view.selectedNodeId);
    }
    if (this.hoveredNodeId) {
      subjects.add(this.hoveredNodeId);
    }
    return subjects;
  }

  private getRelatedNodeIds(document: GraphDocument, subjects: Set<string>): Set<string> {
    const related = new Set<string>();
    subjects.forEach((nodeId) => {
      (document.graph.adjacency[nodeId] ?? []).forEach((edgeId) => {
        const edge = document.graph.edges[edgeId];
        if (!edge) {
          return;
        }
        related.add(edge.sourceId === nodeId ? edge.targetId : edge.sourceId);
      });
    });
    return related;
  }

  private screenToWorld(screenX: number, screenY: number) {
    const cos = Math.cos(this.camera.rotation);
    const sin = Math.sin(this.camera.rotation);
    const cameraX = (screenX - (this.width / 2) - this.camera.x) / this.camera.scale;
    const cameraY = (screenY - (this.height / 2) - this.camera.y) / this.camera.scale;

    return {
      x: (cameraX * cos) + (cameraY * sin),
      y: (-cameraX * sin) + (cameraY * cos),
    };
  }

  private worldToScreen(worldX: number, worldY: number) {
    const projected = this.projectWorldToCameraPlane({ x: worldX, y: worldY });
    return {
      x: (this.width / 2) + this.camera.x + (projected.x * this.camera.scale),
      y: (this.height / 2) + this.camera.y + (projected.y * this.camera.scale),
    };
  }

  private projectWorldToCameraPlane(point: ScreenPoint): ScreenPoint {
    const cos = Math.cos(this.camera.rotation);
    const sin = Math.sin(this.camera.rotation);
    return {
      x: (point.x * cos) - (point.y * sin),
      y: (point.x * sin) + (point.y * cos),
    };
  }

  private setCameraOffsetForWorldPoint(point: ScreenPoint, screenX: number, screenY: number) {
    const projected = this.projectWorldToCameraPlane(point);
    this.camera.x = screenX - (this.width / 2) - (projected.x * this.camera.scale);
    this.camera.y = screenY - (this.height / 2) - (projected.y * this.camera.scale);
  }

  private applyPointerDragForce() {
    if (!this.draggedNodeId || !this.dragTarget) {
      return;
    }

    const runtime = this.runtimeNodes.get(this.draggedNodeId);
    if (!runtime) {
      return;
    }

    const dx = this.dragTarget.x - (runtime.x ?? 0);
    const dy = this.dragTarget.y - (runtime.y ?? 0);
    const distance = Math.hypot(dx, dy);
    const strength = 0.02 * (1 - Math.exp(-distance / 120));
    runtime.vx = (runtime.vx ?? 0) + (dx * strength);
    runtime.vy = (runtime.vy ?? 0) + (dy * strength);
  }

  private applyFocusCamera(document: GraphDocument, deltaTime: number) {
    const focusedPoint = this.getFocusedWorldPoint(document);
    if (!focusedPoint) {
      this.cameraLookAt = this.currentCameraLookAt();
      return;
    }

    if (this.isPanning) {
      this.cameraLookAt = this.currentCameraLookAt();
      return;
    }

    if (!this.cameraLookAt) {
      this.cameraLookAt = this.currentCameraLookAt();
    }

    const ease = 1 - Math.pow(0.9, deltaTime / 16.67);
    this.cameraLookAt.x += (focusedPoint.x - this.cameraLookAt.x) * ease;
    this.cameraLookAt.y += (focusedPoint.y - this.cameraLookAt.y) * ease;
    this.setCameraOffsetForWorldPoint(this.cameraLookAt, this.width / 2, this.height / 2);
  }

  private currentCameraLookAt(): ScreenPoint {
    return this.screenToWorld(this.width / 2, this.height / 2);
  }

  private getFocusedWorldPoint(document: GraphDocument): ScreenPoint | null {
    if (document.view.selectedNodeId) {
      const node = this.runtimeNodes.get(document.view.selectedNodeId);
      return node ? { x: node.x ?? 0, y: node.y ?? 0 } : null;
    }

    if (document.view.selectedEdgeId) {
      const edge = document.graph.edges[document.view.selectedEdgeId];
      const source = edge ? this.runtimeNodes.get(edge.sourceId) : null;
      const target = edge ? this.runtimeNodes.get(edge.targetId) : null;
      if (source && target) {
        return {
          x: ((source.x ?? 0) + (target.x ?? 0)) / 2,
          y: ((source.y ?? 0) + (target.y ?? 0)) / 2,
        };
      }
    }

    return null;
  }

  private clientToCanvasPoint(clientX: number, clientY: number): ScreenPoint {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }

  private pickNode(screenX: number, screenY: number) {
    const document = this.options.getDocument();
    const rendering = document.graph.config.rendering;
    const world = this.screenToWorld(screenX, screenY);
    const searchRadius = Math.max(rendering.hoverStopRange / this.camera.scale, rendering.focusRadius);
    const nearest = this.quadtreeIndex?.find(world.x, world.y, searchRadius);
    if (!nearest) {
      return null;
    }

    const dx = world.x - (nearest.x ?? 0);
    const dy = world.y - (nearest.y ?? 0);
    const hitRadius = nearest.radius + (rendering.hoverStopRange / this.camera.scale);
    return (dx * dx) + (dy * dy) <= hitRadius * hitRadius ? nearest : null;
  }

  private pickEdge(screenX: number, screenY: number): EdgeMeta | null {
    const document = this.options.getDocument();
    const world = this.screenToWorld(screenX, screenY);
    const hitDistance = document.graph.config.rendering.edgeHoverDistance / Math.max(this.camera.scale, 0.001);

    for (const edge of Object.values(document.graph.edges)) {
      const source = this.runtimeNodes.get(edge.sourceId);
      const target = this.runtimeNodes.get(edge.targetId);
      if (!source || !target) {
        continue;
      }

      const distance = distanceToSegment(
        world.x,
        world.y,
        source.x ?? 0,
        source.y ?? 0,
        target.x ?? 0,
        target.y ?? 0,
      );
      if (distance <= hitDistance) {
        return edge;
      }
    }

    return null;
  }
}

function createGraphSignature(document: GraphDocument): string {
  const nodePart = Object.values(document.graph.nodes)
    .map((node) => `${node.id}:${node.type ?? ''}:${node.metrics?.contentLength ?? 0}`)
    .sort()
    .join('|');
  const edgePart = Object.values(document.graph.edges)
    .map((edge) => `${edge.id}:${edge.sourceId}->${edge.targetId}:${edge.type}`)
    .sort()
    .join('|');
  const layout = document.graph.config.layout;
  const rendering = document.graph.config.rendering;
  return [
    nodePart,
    edgePart,
    layout.linkDistance,
    layout.linkStrength,
    layout.chargeStrength,
    layout.chargeDistanceMax,
    layout.collisionPadding,
    layout.collisionStrength,
    layout.centerStrength,
    layout.alphaFloor,
    layout.alphaDecay,
    layout.velocityDecay,
    rendering.baseNodeRadius,
    rendering.contentLengthDivisor,
    rendering.degreeRadiusBoost,
  ].join('::');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = (dx * dx) + (dy * dy);
  if (lengthSquared === 0) {
    return Math.hypot(px - x1, py - y1);
  }

  const ratio = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (x1 + ratio * dx), py - (y1 + ratio * dy));
}

function getRotationDeltaAroundCenter(previous: ScreenPoint, next: ScreenPoint, width: number, height: number): number {
  const centerX = width / 2;
  const centerY = height / 2;
  const previousDx = previous.x - centerX;
  const previousDy = previous.y - centerY;
  const nextDx = next.x - centerX;
  const nextDy = next.y - centerY;

  if (Math.hypot(previousDx, previousDy) < 24 || Math.hypot(nextDx, nextDy) < 24) {
    return clamp((next.x - previous.x) * 0.006, -0.18, 0.18);
  }

  return clamp(normalizeAngle(Math.atan2(nextDy, nextDx) - Math.atan2(previousDy, previousDx)), -0.18, 0.18);
}

function normalizeAngle(angle: number): number {
  let nextAngle = angle;
  while (nextAngle > Math.PI) {
    nextAngle -= Math.PI * 2;
  }
  while (nextAngle < -Math.PI) {
    nextAngle += Math.PI * 2;
  }
  return nextAngle;
}

function extractDroppedFileReferences(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) {
    return [];
  }

  const references = new Set<string>();
  const uriList = dataTransfer.getData('text/uri-list');
  uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .forEach((line) => references.add(line));

  const plainText = dataTransfer.getData('text/plain').trim();
  if (plainText && !plainText.includes('\n')) {
    references.add(plainText);
  }

  Array.from(dataTransfer.files).forEach((file) => {
    if (file.name) {
      references.add(file.name);
    }
  });

  return [...references];
}