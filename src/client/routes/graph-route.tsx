import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router-dom";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import SigmaLib from "sigma";

import { useWikiConfig } from "@/client/wiki-config";
import type { TopicAliasConfig } from "@/lib/wiki-config";
import type { GraphData, GraphNode } from "@/lib/wiki-shared";
import { Graph3DView } from "@/components/graph-3d-view";
import {
  AMBIENT_AMPLITUDE_RATIO,
  AMBIENT_CYCLE_MS,
  BG_COLOR,
  DEFAULT_NODE_COLOR,
  DIMMED_NODE_COLOR,
  EDGE_DEFAULT,
  EDGE_HOVER,
  GOLDEN_ANGLE,
  LABEL_COLOR,
  MAX_ANIMATED_NODES,
  getCategoryColor,
  hash01,
  prefersReducedMotion,
  type GraphViewProps,
  type TooltipNode,
} from "@/components/graph-view-shared";
import { fetchJson, isSetupRequiredResponse } from "../api";
import { RouteErrorBoundary } from "../route-error-boundary";

const GRAPH_MODE_STORAGE_KEY = "wikios-graph-mode";

type GraphMode = "2d" | "3d";

/* ── Graph building ── */

function buildGraph(
  data: GraphData,
  aliases: Record<string, TopicAliasConfig>,
): Graph {
  const graph = new Graph();

  for (const node of data.nodes) {
    const size = Math.max(2.5, Math.min(16, 2.5 + Math.sqrt(node.backlinkCount) * 2));
    graph.addNode(node.slug, {
      label: node.title,
      size,
      color: getCategoryColor(node.categories, aliases),
      originalColor: getCategoryColor(node.categories, aliases),
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      categories: node.categories,
      backlinkCount: node.backlinkCount,
      wordCount: node.wordCount,
    });
  }

  for (const edge of data.edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      const key = `${edge.source}->${edge.target}`;
      if (!graph.hasEdge(key)) {
        graph.addEdgeWithKey(key, edge.source, edge.target, {
          weight: edge.weight,
          size: 0.3,
          color: EDGE_DEFAULT,
        });
      }
    }
  }

  return graph;
}

function runLayout(graph: Graph) {
  forceAtlas2.assign(graph, {
    iterations: 500,
    settings: {
      gravity: 1,
      scalingRatio: 10,
      barnesHutOptimize: true,
      strongGravityMode: true,
      slowDown: 3,
      outboundAttractionDistribution: false,
      linLogMode: true,
    },
  });
}

/* ── Ambient motion ── */

const ENTRANCE_MS = 1400;
const ENTRANCE_STAGGER_MS = 600;
const ENTRANCE_COLLAPSE = 0.3;
// Past the entrance, drift is slow enough that 30fps looks identical and
// halves the per-frame reprocess cost.
const AMBIENT_FRAME_MS = 1000 / 30;
// Nodes big enough to carry a label (labelRenderedSizeThreshold) stay
// anchored at base so sigma's per-cell label selection never flickers.
const LABEL_ANCHOR_SIZE = 6;

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

interface AnimatedNodeMotion {
  baseX: number;
  baseY: number;
  spawnX: number;
  spawnY: number;
  delay: number;
  phaseX: number;
  phaseY: number;
  freqX: number;
  freqY: number;
  amplitude: number;
  pausedAt: number | null;
  timeShift: number;
}

export interface GraphAnimator {
  stop(): void;
  settle(): void;
  holdNode(node: string): void;
  releaseNode(): void;
  getBasePosition(node: string): { x: number; y: number } | null;
}

function createGraphAnimator(
  graph: Graph,
  sigma: SigmaLib,
  { entrance }: { entrance: boolean },
): GraphAnimator | null {
  if (graph.order === 0 || graph.order > MAX_ANIMATED_NODES) {
    return null;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;

  graph.forEachNode((_node, attrs) => {
    minX = Math.min(minX, attrs.x);
    maxX = Math.max(maxX, attrs.x);
    minY = Math.min(minY, attrs.y);
    maxY = Math.max(maxY, attrs.y);
    sumX += attrs.x;
    sumY += attrs.y;
  });

  const centerX = sumX / graph.order;
  const centerY = sumY / graph.order;
  const extent = Math.max(maxX - minX, maxY - minY) || 1;
  const amplitude = extent * AMBIENT_AMPLITUDE_RATIO;
  const baseFreq = (Math.PI * 2) / AMBIENT_CYCLE_MS;
  const collapse = entrance ? ENTRANCE_COLLAPSE : 1;

  const motions = new Map<string, AnimatedNodeMotion>();
  let index = 0;
  graph.forEachNode((node, attrs) => {
    const phase = index * GOLDEN_ANGLE;
    motions.set(node, {
      baseX: attrs.x,
      baseY: attrs.y,
      spawnX: centerX + (attrs.x - centerX) * collapse,
      spawnY: centerY + (attrs.y - centerY) * collapse,
      delay: hash01(index) * ENTRANCE_STAGGER_MS,
      phaseX: phase,
      phaseY: phase * 1.7 + 1.3,
      freqX: baseFreq * (0.75 + 0.5 * hash01(index + 0.1)),
      freqY: baseFreq * (0.85 + 0.5 * hash01(index + 0.2)),
      amplitude:
        (attrs.size ?? 0) >= LABEL_ANCHOR_SIZE
          ? 0
          : amplitude * (0.7 + 0.6 * hash01(index + 0.3)),
      pausedAt: null,
      timeShift: 0,
    });
    index += 1;
  });

  // Freeze the render frame on the settled layout so the camera does not
  // re-fit while nodes are collapsed at spawn or drifting around base.
  sigma.setCustomBBox(sigma.getBBox());

  const startedAt = performance.now();
  const entranceSpan = entrance ? ENTRANCE_MS + ENTRANCE_STAGGER_MS : 0;
  let heldNode: string | null = null;

  const applyFrame = (now: number) => {
    const elapsed = now - startedAt;
    graph.updateEachNodeAttributes(
      (node, attrs) => {
        const motion = motions.get(node);
        if (!motion) {
          return attrs;
        }
        // A held node's clock stands still, so it stays put under the cursor
        // and resumes seamlessly on release.
        const effective = motion.pausedAt ?? elapsed - motion.timeShift;
        const settle = entrance
          ? easeOutCubic(Math.min(Math.max((effective - motion.delay) / ENTRANCE_MS, 0), 1))
          : 1;
        const driftX =
          Math.sin(effective * motion.freqX + motion.phaseX) * motion.amplitude * settle;
        const driftY =
          Math.cos(effective * motion.freqY + motion.phaseY) * motion.amplitude * settle;
        attrs.x = motion.spawnX + (motion.baseX - motion.spawnX) * settle + driftX;
        attrs.y = motion.spawnY + (motion.baseY - motion.spawnY) * settle + driftY;
        return attrs;
      },
      { attributes: ["x", "y"] },
    );
  };

  if (entrance) {
    // Collapse toward the center before the first paint; the entrance then
    // eases every node back out to its settled position.
    applyFrame(startedAt);
  }

  let lastApplied = -Infinity;
  let rafId = requestAnimationFrame(function tick(now) {
    if (now - startedAt <= entranceSpan || now - lastApplied >= AMBIENT_FRAME_MS) {
      lastApplied = now;
      applyFrame(now);
    }
    rafId = requestAnimationFrame(tick);
  });

  return {
    stop() {
      cancelAnimationFrame(rafId);
    },
    settle() {
      graph.updateEachNodeAttributes(
        (node, attrs) => {
          const motion = motions.get(node);
          if (motion) {
            attrs.x = motion.baseX;
            attrs.y = motion.baseY;
          }
          return attrs;
        },
        { attributes: ["x", "y"] },
      );
    },
    holdNode(node: string) {
      this.releaseNode();
      const motion = motions.get(node);
      if (motion) {
        motion.pausedAt = performance.now() - startedAt - motion.timeShift;
        heldNode = node;
      }
    },
    releaseNode() {
      if (heldNode === null) {
        return;
      }
      const motion = motions.get(heldNode);
      if (motion && motion.pausedAt !== null) {
        motion.timeShift = performance.now() - startedAt - motion.pausedAt;
        motion.pausedAt = null;
      }
      heldNode = null;
    },
    getBasePosition(node: string) {
      const motion = motions.get(node);
      return motion ? { x: motion.baseX, y: motion.baseY } : null;
    },
  };
}

/* ── 2D view (sigma.js) ── */

function Graph2DView({
  data,
  aliases,
  focusedSlug,
  motionEnabled,
  onFocusNode,
  onClearFocus,
  onNavigateNode,
  onHoverNode,
  flyToRef,
}: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<SigmaLib | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const animatorRef = useRef<GraphAnimator | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const focusedRef = useRef<string | null>(focusedSlug);
  const motionEnabledRef = useRef(motionEnabled);

  const callbacksRef = useRef({ onFocusNode, onClearFocus, onNavigateNode, onHoverNode });
  useEffect(() => {
    callbacksRef.current = { onFocusNode, onClearFocus, onNavigateNode, onHoverNode };
  });

  useEffect(() => {
    focusedRef.current = focusedSlug;
    sigmaRef.current?.refresh();
  }, [focusedSlug]);

  // Pause/resume ambient motion without tearing down the sigma instance.
  useEffect(() => {
    motionEnabledRef.current = motionEnabled;
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    if (motionEnabled) {
      if (!animatorRef.current) {
        animatorRef.current = createGraphAnimator(graph, sigma, { entrance: false });
      }
    } else if (animatorRef.current) {
      animatorRef.current.stop();
      animatorRef.current.settle();
      animatorRef.current = null;
    }
  }, [motionEnabled]);

  useEffect(() => {
    if (!containerRef.current) return;

    const graph = buildGraph(data, aliases);
    runLayout(graph);

    const sigma = new SigmaLib(graph, containerRef.current, {
      allowInvalidContainer: true,
      renderLabels: true,
      renderEdgeLabels: false,
      labelColor: { color: LABEL_COLOR },
      labelFont: '"Urbanist", -apple-system, BlinkMacSystemFont, sans-serif',
      labelSize: 11,
      labelWeight: "500",
      labelRenderedSizeThreshold: 6,
      defaultEdgeColor: EDGE_DEFAULT,
      defaultEdgeType: "line",
      defaultNodeColor: DEFAULT_NODE_COLOR,
      stagePadding: 60,
      edgeReducer(edge, edgeData) {
        const active = focusedRef.current ?? hoveredRef.current;
        const res = { ...edgeData };

        if (active) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src === active || tgt === active) {
            res.color = EDGE_HOVER;
            res.size = 1;
          } else {
            res.hidden = true;
          }
        }
        return res;
      },
      nodeReducer(node, nodeData) {
        const active = focusedRef.current ?? hoveredRef.current;
        const res = { ...nodeData };

        if (active) {
          const isActive = node === active;
          const isNeighbor = graph.hasEdge(active, node) || graph.hasEdge(node, active);

          if (isActive) {
            res.highlighted = true;
            res.zIndex = 2;
            res.size = (res.size ?? 4) * 1.3;
          } else if (isNeighbor) {
            res.zIndex = 1;
            if (focusedRef.current) res.forceLabel = true;
          } else {
            res.color = DIMMED_NODE_COLOR;
            res.label = "";
            res.zIndex = 0;
          }
        }

        return res;
      },
    });

    sigmaRef.current = sigma;
    graphRef.current = graph;

    if (motionEnabledRef.current) {
      animatorRef.current = createGraphAnimator(graph, sigma, { entrance: true });
    }

    // Aim the camera at the node's settled base position: during the entrance
    // the live position is still in flight, and Camera.animate tweens toward a
    // fixed snapshot, so targeting the live position can miss entirely.
    const focusCamera = (slug: string, ratio: number, duration: number) => {
      const base = animatorRef.current?.getBasePosition(slug);
      const target = base
        ? sigma.viewportToFramedGraph(sigma.graphToViewport(base))
        : sigma.getNodeDisplayData(slug);
      if (target) {
        sigma.getCamera().animate({ x: target.x, y: target.y, ratio }, { duration });
      }
    };

    sigma.on("enterNode", ({ node }) => {
      hoveredRef.current = node;
      // Hold the hovered node still so the tooltip stays truthful and clicks
      // land even if the cursor rests in place.
      animatorRef.current?.holdNode(node);
      sigma.refresh();
      const attrs = graph.getNodeAttributes(node);
      callbacksRef.current.onHoverNode({
        label: attrs.label,
        categories: attrs.categories ?? [],
        backlinkCount: attrs.backlinkCount ?? 0,
        wordCount: attrs.wordCount ?? 0,
      });
      containerRef.current!.style.cursor = "pointer";
    });

    sigma.on("leaveNode", () => {
      hoveredRef.current = null;
      animatorRef.current?.releaseNode();
      sigma.refresh();
      callbacksRef.current.onHoverNode(null);
      containerRef.current!.style.cursor = "default";
    });

    sigma.on("clickNode", ({ node }) => {
      const focused = focusedRef.current;

      if (focused === node || (focused && (graph.hasEdge(focused, node) || graph.hasEdge(node, focused)))) {
        callbacksRef.current.onNavigateNode(node);
        return;
      }

      focusedRef.current = node;
      callbacksRef.current.onFocusNode(node);
      sigma.refresh();
      focusCamera(node, 0.5, 300);
    });

    sigma.on("clickStage", () => {
      if (focusedRef.current) {
        focusedRef.current = null;
        callbacksRef.current.onClearFocus();
        sigma.refresh();
      }
    });

    flyToRef.current = (slug, zoomRatio = 0.5) => {
      focusCamera(slug, zoomRatio, 400);
    };

    return () => {
      if (flyToRef.current) {
        flyToRef.current = null;
      }
      animatorRef.current?.stop();
      animatorRef.current = null;
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [aliases, data, flyToRef]);

  return <div ref={containerRef} className="h-full w-full" />;
}

/* ── Search ── */

function GraphSearch({
  nodes,
  onSelect,
}: {
  nodes: { slug: string; label: string }[];
  onSelect: (slug: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ slug: string; label: string }[]>([]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const q = query.toLowerCase();
    const matched = nodes.filter((n) => n.label.toLowerCase().includes(q));
    matched.sort((a, b) => a.label.localeCompare(b.label));
    setResults(matched.slice(0, 8));
  }, [nodes, query]);

  const handleSelect = (slug: string) => {
    onSelect(slug);
    setQuery("");
    setResults([]);
  };

  return (
    <div
      className="absolute left-4 right-4 z-10 sm:right-auto sm:w-64"
      style={{ top: "calc(env(safe-area-inset-top) + 4.75rem)" }}
    >
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a concept..."
        className="surface w-full rounded-full px-4 py-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
      />
      {results.length > 0 && (
        <div className="surface-raised mt-2 overflow-hidden rounded-2xl">
          {results.map((r) => (
            <button
              key={r.slug}
              type="button"
              onClick={() => handleSelect(r.slug)}
              className="block w-full px-4 py-2 text-left text-sm font-display text-[var(--foreground)] transition-colors hover:bg-[var(--teal-soft)]/50"
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Info panel (shown when a node is focused) ── */

function InfoPanel({
  node,
  neighborNodes,
  onClose,
  onClickNeighbor,
  onNavigate,
  aliases,
}: {
  node: GraphNode;
  neighborNodes: GraphNode[];
  onClose: () => void;
  onClickNeighbor: (slug: string) => void;
  onNavigate: (slug: string) => void;
  aliases: Record<string, TopicAliasConfig>;
}) {
  const catColor = getCategoryColor(node.categories, aliases);

  return (
    <div
      className="surface-raised absolute left-4 right-4 z-20 overflow-hidden rounded-3xl sm:left-auto sm:right-4 sm:w-80"
      style={{ top: "calc(env(safe-area-inset-top) + 4.75rem)" }}
    >
      {/* Header */}
      <div className="border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-display text-[1.1rem] text-[var(--foreground)]">
              {node.title}
            </h3>
            <div className="mt-1.5 flex items-center gap-2">
              {node.categories.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: catColor, boxShadow: `0 0 8px ${catColor}80` }}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                    {node.categories[0]}
                  </span>
                </div>
              )}
              <span className="text-[10px] text-[var(--muted-foreground)]">
                {node.backlinkCount} · {node.wordCount}w
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 3l8 8M11 3l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Summary */}
      {node.summary && (
        <div className="border-b border-[var(--border)] px-5 py-3">
          <p className="line-clamp-3 text-[0.8rem] leading-relaxed text-[var(--muted-foreground)]">
            {node.summary}
          </p>
        </div>
      )}

      {/* Open article button */}
      <div className="border-b border-[var(--border)] px-5 py-3">
        <button
          type="button"
          onClick={() => onNavigate(node.slug)}
          className="w-full rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)] transition-[background,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--teal)] active:scale-[0.97]"
        >
          Open article →
        </button>
      </div>

      {/* Connections list */}
      {neighborNodes.length > 0 && (
        <div className="max-h-56 overflow-y-auto">
          <p className="px-5 pb-1.5 pt-3 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]">
            Connections ({neighborNodes.length})
          </p>
          {neighborNodes.map((n) => (
            <button
              key={n.slug}
              type="button"
              onClick={() => onClickNeighbor(n.slug)}
              className="group flex w-full items-center gap-2.5 px-5 py-2 text-left transition-colors hover:bg-white/60"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-200 group-hover:scale-125"
                style={{
                  backgroundColor: getCategoryColor(n.categories, aliases),
                  boxShadow: `0 0 6px ${getCategoryColor(n.categories, aliases)}60`,
                }}
              />
              <span className="truncate font-display text-[0.85rem] text-[var(--foreground)]">
                {n.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Tooltip ── */

function NodeTooltip({
  node,
  position,
  aliases,
}: {
  node: TooltipNode | null;
  position: { x: number; y: number };
  aliases: Record<string, TopicAliasConfig>;
}) {
  if (!node) return null;
  const catColor = getCategoryColor(node.categories, aliases);

  return (
    <div
      className="surface-raised pointer-events-none absolute z-20 max-w-xs rounded-2xl px-4 py-2.5"
      style={{ left: position.x + 14, top: position.y - 12 }}
    >
      <p className="font-display text-[0.95rem] text-[var(--foreground)]">{node.label}</p>
      <div className="mt-1 flex items-center gap-1.5 text-[0.7rem] font-medium text-[var(--muted-foreground)]">
        <span>{node.backlinkCount} connections</span>
        <span>·</span>
        <span>{node.wordCount} words</span>
      </div>
      {node.categories.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: catColor, boxShadow: `0 0 8px ${catColor}80` }}
          />
          <span className="text-[0.7rem] font-semibold text-[var(--muted-foreground)]">
            {node.categories.join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */

export async function loader() {
  try {
    return await fetchJson<GraphData>("/api/graph");
  } catch (error) {
    if (isSetupRequiredResponse(error)) {
      throw redirect("/setup");
    }

    throw error;
  }
}

function loadInitialMode(): GraphMode {
  try {
    return localStorage.getItem(GRAPH_MODE_STORAGE_KEY) === "3d" ? "3d" : "2d";
  } catch {
    return "2d";
  }
}

export function Component() {
  const data = useLoaderData() as GraphData;
  const config = useWikiConfig();
  const navigate = useNavigate();
  const [mode, setMode] = useState<GraphMode>(loadInitialMode);
  const [motionEnabled, setMotionEnabled] = useState(() => !prefersReducedMotion());
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{
    node: TooltipNode;
    position: { x: number; y: number };
  } | null>(null);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const flyToRef = useRef<((slug: string, zoomRatio?: number) => void) | null>(null);

  // The ambient motion runs indefinitely, so honor mid-session changes to the
  // OS "reduce motion" preference, not just its value at mount.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => {
      if (mq.matches) setMotionEnabled(false);
    };
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  // Build a lookup map for node data
  const nodeMap = useRef(new Map<string, GraphNode>());
  useEffect(() => {
    const map = new Map<string, GraphNode>();
    for (const n of data.nodes) map.set(n.slug, n);
    nodeMap.current = map;
  }, [data]);

  const searchNodes = useMemo(
    () => data.nodes.map((n) => ({ slug: n.slug, label: n.title })),
    [data],
  );

  const focusedNode = focusedSlug ? nodeMap.current.get(focusedSlug) ?? null : null;
  const focusedNeighbors = focusedNode
    ? focusedNode.neighbors
        .map((s) => nodeMap.current.get(s))
        .filter((n): n is GraphNode => n !== undefined)
        .sort((a, b) => b.backlinkCount - a.backlinkCount)
    : [];

  const handleModeChange = useCallback((next: GraphMode) => {
    setMode(next);
    setFocusedSlug(null);
    setTooltip(null);
    try {
      localStorage.setItem(GRAPH_MODE_STORAGE_KEY, next);
    } catch {
      // Persisting the preference is best-effort only.
    }
  }, []);

  const handleFocusNode = useCallback((slug: string) => {
    setFocusedSlug(slug);
  }, []);

  const handleClearFocus = useCallback(() => {
    setFocusedSlug(null);
  }, []);

  const handleNavigateNode = useCallback(
    (slug: string) => {
      navigate(`/wiki/${slug}`);
    },
    [navigate],
  );

  const handleHoverNode = useCallback((node: TooltipNode | null) => {
    setTooltip(node ? { node, position: { ...mousePosRef.current } } : null);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mousePosRef.current = { x: e.clientX, y: e.clientY };
    setTooltip((current) =>
      current ? { ...current, position: { x: e.clientX, y: e.clientY } } : current,
    );
  }, []);

  const handleSearchSelect = useCallback((slug: string) => {
    setFocusedSlug(slug);
    flyToRef.current?.(slug, 0.3);
  }, []);

  const handleInfoClose = useCallback(() => {
    setFocusedSlug(null);
  }, []);

  const handleInfoNeighborClick = useCallback((slug: string) => {
    setFocusedSlug(slug);
    flyToRef.current?.(slug, 0.5);
  }, []);

  const viewProps: GraphViewProps = {
    data,
    aliases: config.categories.aliases,
    focusedSlug,
    motionEnabled,
    onFocusNode: handleFocusNode,
    onClearFocus: handleClearFocus,
    onNavigateNode: handleNavigateNode,
    onHoverNode: handleHoverNode,
    flyToRef,
  };

  return (
    <div className="fixed inset-0" style={{ background: BG_COLOR }} onMouseMove={handleMouseMove}>
      {/* Header */}
      <header className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:gap-3 sm:px-6 sm:pb-4 sm:pt-[calc(env(safe-area-inset-top)+1.25rem)]">
        <Link to="/" className="font-display text-lg text-[var(--foreground)] sm:text-xl">
          {config.siteTitle}
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <span className="surface hidden items-center gap-2 rounded-full px-3.5 py-2 text-xs text-[var(--muted-foreground)] sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--lavender)]" />
            <span className="font-semibold tabular-nums text-[var(--foreground)]">
              {data.nodes.length}
            </span>
            <span>{config.navigation.conceptsLabel}</span>
            <span>·</span>
            <span className="font-semibold tabular-nums text-[var(--foreground)]">
              {data.edges.length}
            </span>
            <span>{config.navigation.connectionsLabel}</span>
          </span>
          <div className="surface flex items-center gap-0.5 rounded-full p-1">
            {(["2d", "3d"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleModeChange(m)}
                aria-pressed={mode === m}
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-200 ${
                  mode === m
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <Link
            to="/"
            className="surface rounded-full px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition-[transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:px-4"
          >
            <span className="sm:hidden">Back</span>
            <span className="hidden sm:inline">{config.navigation.backToWikiLabel}</span>
          </Link>
        </div>
      </header>

      {/* Search */}
      <GraphSearch nodes={searchNodes} onSelect={handleSearchSelect} />

      {/* Tooltip (only when not focused) */}
      {!focusedSlug && (
        <NodeTooltip
          node={tooltip?.node ?? null}
          position={tooltip?.position ?? { x: 0, y: 0 }}
          aliases={config.categories.aliases}
        />
      )}

      {/* Info panel (when focused) */}
      {focusedNode && (
        <InfoPanel
          node={focusedNode}
          neighborNodes={focusedNeighbors}
          onClose={handleInfoClose}
          onClickNeighbor={handleInfoNeighborClick}
          onNavigate={handleNavigateNode}
          aliases={config.categories.aliases}
        />
      )}

      {/* Graph canvas */}
      {mode === "2d" ? <Graph2DView key="2d" {...viewProps} /> : <Graph3DView key="3d" {...viewProps} />}

      {/* Motion pause/resume (WCAG 2.2.2) */}
      <button
        type="button"
        onClick={() => setMotionEnabled((value) => !value)}
        aria-label={motionEnabled ? "Pause graph motion" : "Resume graph motion"}
        title={motionEnabled ? "Pause motion" : "Resume motion"}
        className="surface absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full text-[var(--foreground)] transition-transform duration-200 active:scale-95"
      >
        {motionEnabled ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <rect x="2" y="1.5" width="3" height="9" rx="1" />
            <rect x="7" y="1.5" width="3" height="9" rx="1" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M3.2 1.9a1 1 0 0 1 1.52-.86l6.4 4.1a1 1 0 0 1 0 1.72l-6.4 4.1a1 1 0 0 1-1.52-.86z" />
          </svg>
        )}
      </button>
    </div>
  );
}

export const ErrorBoundary = RouteErrorBoundary;
