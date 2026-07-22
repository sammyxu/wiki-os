import type { MutableRefObject } from "react";

import { getTopicColor, type TopicAliasConfig } from "@/lib/wiki-config";
import type { GraphData } from "@/lib/wiki-shared";

/* ── Shared colors for the graph views ── */

export const DEFAULT_NODE_COLOR = "#c4c0cc";
export const DIMMED_NODE_COLOR = "#e8e3d4";
export const EDGE_DEFAULT = "#ece5d2";
export const EDGE_HOVER = "rgba(132, 185, 201, 0.85)";
export const LABEL_COLOR = "#6b6673";
export const BG_COLOR = "#faf7f3";

export function getCategoryColor(
  categories: string[],
  aliases: Record<string, TopicAliasConfig>,
): string {
  for (const cat of categories) {
    return getTopicColor(cat, aliases);
  }
  return DEFAULT_NODE_COLOR;
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ── Shared ambient-motion tuning (2D drift and 3D drift use the same
      rhythm so switching views feels continuous) ── */

export const AMBIENT_CYCLE_MS = 26000;
export const AMBIENT_AMPLITUDE_RATIO = 0.012;
export const GOLDEN_ANGLE = 2.399963;
// Above this the per-frame animation cost stops being trivial; large vaults
// get a static graph.
export const MAX_ANIMATED_NODES = 600;

/** Deterministic pseudo-random in [0, 1) from a numeric seed. */
export function hash01(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ── Shared contract between the 2D and 3D graph views ── */

export interface TooltipNode {
  label: string;
  categories: string[];
  backlinkCount: number;
  wordCount: number;
}

export interface GraphViewProps {
  data: GraphData;
  aliases: Record<string, TopicAliasConfig>;
  focusedSlug: string | null;
  /** Governs ambient motion (2D drift / 3D auto-rotate); WCAG pause control. */
  motionEnabled: boolean;
  onFocusNode: (slug: string) => void;
  onClearFocus: () => void;
  onNavigateNode: (slug: string) => void;
  onHoverNode: (node: TooltipNode | null) => void;
  /** The active view registers its camera fly-to handler here. */
  flyToRef: MutableRefObject<((slug: string, zoomRatio?: number) => void) | null>;
}
