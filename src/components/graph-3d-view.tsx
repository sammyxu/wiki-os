import { useEffect, useRef } from "react";
import type { ForceGraph3DInstance, LinkObject, NodeObject } from "3d-force-graph";
import type { Object3D } from "three";
import type SpriteText from "three-spritetext";

import {
  AMBIENT_AMPLITUDE_RATIO,
  AMBIENT_CYCLE_MS,
  BG_COLOR,
  DIMMED_NODE_COLOR,
  GOLDEN_ANGLE,
  LABEL_COLOR,
  MAX_ANIMATED_NODES,
  getCategoryColor,
  hash01,
  type GraphViewProps,
} from "./graph-view-shared";

const EDGE_3D_DEFAULT = "#d8d2c2";
const EDGE_3D_HIGHLIGHT = "#84b9c9";
const AUTO_ROTATE_SPEED = 0.55;
const AUTO_ROTATE_RESUME_MS = 6000;
const FOCUS_CAMERA_DISTANCE = 130;
// Matches the 2D view: labels appear on nodes whose sigma size would reach
// labelRenderedSizeThreshold (2.5 + 2·√backlinks ≥ 6 ⇒ backlinks ≥ 4).
const LABEL_MIN_BACKLINKS = 4;
// three-forcegraph's default nodeRelSize; sphere radius = relSize · ∛val.
const NODE_REL_SIZE = 4;
// How long the force layout gets to settle before drift anchors are captured.
const DRIFT_SETTLE_MS = 4500;
// Gain of the velocity controller steering nodes toward their drift targets.
const DRIFT_SPRING = 0.03;

interface Node3D extends NodeObject {
  id: string;
  label: string;
  color: string;
  val: number;
  categories: string[];
  backlinkCount: number;
  wordCount: number;
}

type Link3D = LinkObject<Node3D>;

interface OrbitControlsLike {
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

function linkEndpointId(endpoint: Link3D["source"]): string | null {
  if (endpoint === undefined || endpoint === null) {
    return null;
  }
  return typeof endpoint === "object" ? String(endpoint.id) : String(endpoint);
}

export function Graph3DView({
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
  const fgRef = useRef<ForceGraph3DInstance<Node3D, Link3D> | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const focusedRef = useRef<string | null>(focusedSlug);
  const motionEnabledRef = useRef(motionEnabled);
  const controlsRef = useRef<OrbitControlsLike | null>(null);

  const callbacksRef = useRef({ onFocusNode, onClearFocus, onNavigateNode, onHoverNode });
  useEffect(() => {
    callbacksRef.current = { onFocusNode, onClearFocus, onNavigateNode, onHoverNode };
  });

  useEffect(() => {
    focusedRef.current = focusedSlug;
    fgRef.current?.refresh();
  }, [focusedSlug]);

  // Pause/resume the slow orbit without tearing the scene down.
  useEffect(() => {
    motionEnabledRef.current = motionEnabled;
    const controls = controlsRef.current;
    if (controls) {
      controls.autoRotate = motionEnabled;
    }
  }, [motionEnabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let fg: ForceGraph3DInstance<Node3D, Link3D> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resumeTimer: number | null = null;
    let driftTimer: number | null = null;
    let controlsCleanup: (() => void) | null = null;

    const nodeIds = new Set(data.nodes.map((n) => n.slug));
    const neighbors = new Map<string, Set<string>>();
    const addNeighbor = (a: string, b: string) => {
      const set = neighbors.get(a) ?? new Set<string>();
      set.add(b);
      neighbors.set(a, set);
    };
    for (const edge of data.edges) {
      if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
        addNeighbor(edge.source, edge.target);
        addNeighbor(edge.target, edge.source);
      }
    }
    const isNeighborOfActive = (active: string, id: string) =>
      neighbors.get(active)?.has(id) ?? false;

    void Promise.all([import("3d-force-graph"), import("three-spritetext")]).then(
      ([{ default: ForceGraph3D }, { default: SpriteTextCtor }]) => {
      if (disposed || !containerRef.current) return;

      // Reflects both the OS reduce-motion preference and the on-page pause
      // control (the route folds the former into motionEnabled).
      const motionAtInit = motionEnabledRef.current;

      const nodes: Node3D[] = data.nodes.map((n) => ({
        id: n.slug,
        label: n.title,
        color: getCategoryColor(n.categories, aliases),
        val: 1 + n.backlinkCount * 0.55,
        categories: n.categories,
        backlinkCount: n.backlinkCount,
        wordCount: n.wordCount,
      }));
      const links: Link3D[] = data.edges
        .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
        .map((e) => ({ source: e.source, target: e.target }));

      // The exported constructor is typed against the default NodeObject
      // generics; rebind it to our node/link shapes.
      const TypedForceGraph3D = ForceGraph3D as unknown as new (
        element: HTMLElement,
        config?: { controlType?: "trackball" | "orbit" | "fly" },
      ) => ForceGraph3DInstance<Node3D, Link3D>;

      const instance = new TypedForceGraph3D(container, { controlType: "orbit" });
      fg = instance;
      fgRef.current = instance;

      // Once the user has moved the camera (orbit/zoom or focusing a node),
      // the delayed engine-stop auto-fit must not yank it away.
      let cameraTouched = false;

      const flyToNode = (slug: string) => {
        const node = instance.graphData().nodes.find((n) => n.id === slug);
        if (!node || node.x === undefined || node.y === undefined || node.z === undefined) {
          return;
        }
        const radius = Math.hypot(node.x, node.y, node.z);
        const target = { x: node.x, y: node.y, z: node.z };
        const position =
          radius > 0
            ? {
                x: node.x * (1 + FOCUS_CAMERA_DISTANCE / radius),
                y: node.y * (1 + FOCUS_CAMERA_DISTANCE / radius),
                z: node.z * (1 + FOCUS_CAMERA_DISTANCE / radius),
              }
            : { x: 0, y: 0, z: FOCUS_CAMERA_DISTANCE };
        instance.cameraPosition(position, target, 900);
      };

      // Text labels are cached per node so hover/focus refreshes (which
      // rebuild scene objects) never regenerate the canvas textures.
      const spriteCache = new Map<string, SpriteText>();

      // Ambient drift: once the layout settles, a custom d3 force steers each
      // node toward a slowly moving Lissajous target around its rest position
      // (same rhythm constants as the 2D view). The physics engine then keeps
      // links, spheres, and labels in sync for free.
      interface DriftTarget {
        node: Node3D;
        baseX: number;
        baseY: number;
        baseZ: number;
        freqX: number;
        freqY: number;
        freqZ: number;
        phaseX: number;
        phaseY: number;
        phaseZ: number;
        amplitude: number;
      }
      let driftTargets: DriftTarget[] | null = null;
      let driftStartedAt = 0;

      const driftForce = () => {
        if (!driftTargets || !motionEnabledRef.current) return;
        const t = performance.now() - driftStartedAt;
        for (const d of driftTargets) {
          const n = d.node;
          // Nodes pinned by dragging (fx set) stay where the user put them.
          if (n.fx != null || n.x === undefined || n.y === undefined || n.z === undefined) {
            continue;
          }
          const tx = d.baseX + Math.sin(t * d.freqX + d.phaseX) * d.amplitude;
          const ty = d.baseY + Math.cos(t * d.freqY + d.phaseY) * d.amplitude;
          const tz = d.baseZ + Math.sin(t * d.freqZ + d.phaseZ) * d.amplitude;
          n.vx = (n.vx ?? 0) + (tx - n.x) * DRIFT_SPRING;
          n.vy = (n.vy ?? 0) + (ty - n.y) * DRIFT_SPRING;
          n.vz = (n.vz ?? 0) + (tz - n.z) * DRIFT_SPRING;
        }
      };

      const enableDrift = () => {
        if (disposed) return;
        const settled = instance
          .graphData()
          .nodes.filter(
            (n): n is Node3D & { x: number; y: number; z: number } =>
              n.x !== undefined && n.y !== undefined && n.z !== undefined,
          );
        if (settled.length === 0) return;

        let extent = 0;
        for (const axis of ["x", "y", "z"] as const) {
          let min = Infinity;
          let max = -Infinity;
          for (const n of settled) {
            min = Math.min(min, n[axis]);
            max = Math.max(max, n[axis]);
          }
          extent = Math.max(extent, max - min);
        }
        // The spring tracks the moving target with lag, so drive it a little
        // harder than the 2D amplitude to land on a similar visible sway.
        const amplitude = (extent || 1) * AMBIENT_AMPLITUDE_RATIO * 1.4;
        const baseFreq = (Math.PI * 2) / AMBIENT_CYCLE_MS;

        driftStartedAt = performance.now();
        driftTargets = settled.map((n, i) => {
          const phase = i * GOLDEN_ANGLE;
          return {
            node: n,
            baseX: n.x,
            baseY: n.y,
            baseZ: n.z,
            freqX: baseFreq * (0.75 + 0.5 * hash01(i + 0.1)),
            freqY: baseFreq * (0.85 + 0.5 * hash01(i + 0.2)),
            freqZ: baseFreq * (0.8 + 0.5 * hash01(i + 0.3)),
            phaseX: phase,
            phaseY: phase * 1.7 + 1.3,
            phaseZ: phase * 2.3 + 0.7,
            amplitude: amplitude * (0.7 + 0.6 * hash01(i + 0.4)),
          };
        });

        // The engine never stops in drift mode, so the initial camera fit
        // happens here instead of onEngineStop.
        if (!cameraTouched) {
          instance.zoomToFit(800, 90);
        }
      };

      instance.backgroundColor(BG_COLOR)
        .showNavInfo(false)
        .nodeResolution(16)
        .nodeOpacity(1)
        .nodeLabel(() => "")
        .nodeThreeObjectExtend(true)
        .nodeThreeObject((node) => {
          if (node.backlinkCount < LABEL_MIN_BACKLINKS) {
            return undefined as unknown as Object3D;
          }
          let sprite = spriteCache.get(node.id);
          if (!sprite) {
            sprite = new SpriteTextCtor(node.label);
            sprite.color = LABEL_COLOR;
            sprite.textHeight = 3.4;
            sprite.fontFace = "Urbanist, sans-serif";
            sprite.fontWeight = "500";
            sprite.material.depthWrite = false;
            sprite.material.transparent = true;
            sprite.position.y = NODE_REL_SIZE * Math.cbrt(node.val) + 3.5;
            spriteCache.set(node.id, sprite);
          }
          const active = focusedRef.current ?? hoveredRef.current;
          sprite.material.opacity =
            !active || node.id === active || isNeighborOfActive(active, node.id) ? 1 : 0.15;
          return sprite;
        })
        .nodeColor((node) => {
          const active = focusedRef.current ?? hoveredRef.current;
          if (!active || node.id === active || isNeighborOfActive(active, node.id)) {
            return node.color;
          }
          return DIMMED_NODE_COLOR;
        })
        .linkColor((link) => {
          const active = focusedRef.current ?? hoveredRef.current;
          if (active) {
            const src = linkEndpointId(link.source);
            const tgt = linkEndpointId(link.target);
            if (src === active || tgt === active) {
              return EDGE_3D_HIGHLIGHT;
            }
          }
          return EDGE_3D_DEFAULT;
        })
        .linkWidth((link) => {
          const active = focusedRef.current ?? hoveredRef.current;
          if (active) {
            const src = linkEndpointId(link.source);
            const tgt = linkEndpointId(link.target);
            if (src === active || tgt === active) {
              return 1.2;
            }
          }
          return 0;
        })
        .linkOpacity(0.35)
        .onNodeHover((node) => {
          hoveredRef.current = node ? String(node.id) : null;
          instance.refresh();
          callbacksRef.current.onHoverNode(
            node
              ? {
                  label: node.label,
                  categories: node.categories,
                  backlinkCount: node.backlinkCount,
                  wordCount: node.wordCount,
                }
              : null,
          );
        })
        .onNodeClick((node) => {
          const id = String(node.id);
          const focused = focusedRef.current;
          if (focused === id || (focused && isNeighborOfActive(focused, id))) {
            callbacksRef.current.onNavigateNode(id);
            return;
          }
          focusedRef.current = id;
          callbacksRef.current.onFocusNode(id);
          instance.refresh();
          cameraTouched = true;
          flyToNode(id);
        })
        .onBackgroundClick(() => {
          if (focusedRef.current) {
            focusedRef.current = null;
            callbacksRef.current.onClearFocus();
            instance.refresh();
          }
        });

      const animatable = nodes.length <= MAX_ANIMATED_NODES;

      if (!motionAtInit) {
        // Settle the layout off-screen so the graph appears already at rest.
        instance.warmupTicks(160).cooldownTicks(0);
      } else if (animatable) {
        // Keep the engine ticking so the drift force can keep steering nodes;
        // the camera fit for this path fires from enableDrift instead of
        // onEngineStop.
        instance.cooldownTime(Infinity);
        instance.d3Force("drift", driftForce);
        driftTimer = window.setTimeout(enableDrift, DRIFT_SETTLE_MS);
      }

      let didFitCamera = false;
      instance.onEngineStop(() => {
        if (!didFitCamera && !cameraTouched) {
          didFitCamera = true;
          instance.zoomToFit(800, 90);
        }
      });

      instance.graphData({ nodes, links });

      const controls = instance.controls() as OrbitControlsLike;
      if (controls && typeof controls.addEventListener === "function") {
        controlsRef.current = controls;
        controls.autoRotate = motionAtInit;
        controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
        const handleInteractionStart = () => {
          cameraTouched = true;
          controls.autoRotate = false;
          if (resumeTimer !== null) {
            window.clearTimeout(resumeTimer);
            resumeTimer = null;
          }
        };
        const handleInteractionEnd = () => {
          if (resumeTimer !== null) {
            window.clearTimeout(resumeTimer);
          }
          resumeTimer = window.setTimeout(() => {
            controls.autoRotate = motionEnabledRef.current;
          }, AUTO_ROTATE_RESUME_MS);
        };
        controls.addEventListener("start", handleInteractionStart);
        controls.addEventListener("end", handleInteractionEnd);
        controlsCleanup = () => {
          controls.removeEventListener("start", handleInteractionStart);
          controls.removeEventListener("end", handleInteractionEnd);
        };
      }

      resizeObserver = new ResizeObserver(() => {
        if (!containerRef.current) return;
        instance.width(containerRef.current.clientWidth).height(containerRef.current.clientHeight);
      });
      resizeObserver.observe(container);

      flyToRef.current = (slug) => {
        cameraTouched = true;
        flyToNode(slug);
      };
    });

    return () => {
      disposed = true;
      if (flyToRef.current) {
        flyToRef.current = null;
      }
      if (resumeTimer !== null) {
        window.clearTimeout(resumeTimer);
      }
      if (driftTimer !== null) {
        window.clearTimeout(driftTimer);
      }
      controlsCleanup?.();
      resizeObserver?.disconnect();
      controlsRef.current = null;
      fgRef.current = null;
      fg?._destructor();
      fg = null;
      container.replaceChildren();
    };
  }, [aliases, data, flyToRef]);

  return <div ref={containerRef} className="h-full w-full" />;
}
