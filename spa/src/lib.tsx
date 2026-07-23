import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { GraphExplorer } from "@/components/graph-explorer";
import type { TopicAliasConfig } from "@/lib/wiki-config";
import type { GraphData } from "@/lib/wiki-shared";
import {
  buildGraphDataFromMarkdown,
  isGraphData,
  normalizeGraphData,
  type MarkdownSourceFile,
} from "./markdown-graph";
import cssText from "./spa.css?inline";

export { buildGraphDataFromMarkdown, isGraphData, normalizeGraphData };
export type { GraphData, MarkdownSourceFile, TopicAliasConfig };

export interface WikiGraphMountOptions {
  /** Graph data in the WikiOS `/api/graph` shape. */
  data?: GraphData;
  /** URL returning graph JSON; fetched on mount. */
  url?: string;
  /** Raw markdown files to index in the browser instead of ready-made data. */
  markdownFiles?: MarkdownSourceFile[];
  /** Topic → color/emoji aliases. */
  aliases?: Record<string, TopicAliasConfig>;
  /** Title shown in the header. */
  title?: string;
  /** Invoked when the user asks to open a node's article. */
  onOpenArticle?: (slug: string) => void;
}

export interface WikiGraphHandle {
  /** Replace the rendered graph with new data. */
  update(data: GraphData): void;
  unmount(): void;
}

function ensureStyles() {
  if (document.querySelector("style[data-wiki-graph-styles]")) {
    return;
  }
  const style = document.createElement("style");
  style.dataset.wikiGraphStyles = "true";
  style.textContent = cssText;
  document.head.appendChild(style);
}

async function resolveData(options: WikiGraphMountOptions): Promise<GraphData> {
  if (options.data) {
    return normalizeGraphData(options.data);
  }
  if (options.markdownFiles) {
    return buildGraphDataFromMarkdown(options.markdownFiles);
  }
  if (options.url) {
    const response = await fetch(options.url);
    if (!response.ok) {
      throw new Error(`Failed to load graph data: HTTP ${response.status}`);
    }
    const json: unknown = await response.json();
    if (!isGraphData(json)) {
      throw new Error("The response is not WikiOS graph JSON ({ nodes, edges })");
    }
    return normalizeGraphData(json);
  }
  throw new Error("mountWikiGraph requires one of: data, url, markdownFiles");
}

/**
 * Mount the interactive 2D/3D graph into any host element. The element should
 * have an explicit size (the graph fills it). Styles are injected once into
 * document.head.
 */
export function mountWikiGraph(
  container: HTMLElement,
  options: WikiGraphMountOptions = {},
): WikiGraphHandle {
  ensureStyles();
  const root = createRoot(container);

  const render = (data: GraphData) => {
    root.render(
      <StrictMode>
        <GraphExplorer
          data={data}
          aliases={options.aliases}
          onOpenArticle={options.onOpenArticle}
          headerStart={
            options.title ? (
              <span className="font-display truncate text-lg text-[var(--foreground)] sm:text-xl">
                {options.title}
              </span>
            ) : undefined
          }
          storageKey="wiki-graph-embed-mode"
        />
      </StrictMode>,
    );
  };

  void resolveData(options)
    .then(render)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Failed to load graph data";
      root.render(
        <div
          style={{
            display: "flex",
            height: "100%",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "sans-serif",
            fontSize: "14px",
            color: "#6b6673",
          }}
        >
          {message}
        </div>,
      );
    });

  return {
    update(data: GraphData) {
      render(normalizeGraphData(data));
    },
    unmount() {
      root.unmount();
    },
  };
}
