import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GraphExplorer } from "@/components/graph-explorer";
import type { GraphData } from "@/lib/wiki-shared";
import {
  buildGraphDataFromMarkdown,
  isGraphData,
  normalizeGraphData,
  type MarkdownSourceFile,
} from "./markdown-graph";

type AppState =
  | { kind: "picker"; error: string | null }
  | { kind: "loading"; label: string }
  | { kind: "ready"; data: GraphData; label: string };

/* ── File loading helpers ── */

function stripCommonRootFolder(files: MarkdownSourceFile[]): MarkdownSourceFile[] {
  // Folder pickers include the selected folder itself as the first path
  // segment; drop it when every file shares it so paths are vault-relative.
  if (files.length === 0) return files;
  const firstSegment = (path: string) => path.split("/")[0];
  const root = firstSegment(files[0].path);
  if (!root || !files.every((f) => f.path.includes("/") && firstSegment(f.path) === root)) {
    return files;
  }
  return files.map((f) => ({ ...f, path: f.path.split("/").slice(1).join("/") }));
}

async function filesFromFileList(list: FileList | File[]): Promise<MarkdownSourceFile[]> {
  const out: MarkdownSourceFile[] = [];
  for (const file of Array.from(list)) {
    if (!file.name.toLowerCase().endsWith(".md")) continue;
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    out.push({ path: relativePath, content: await file.text() });
  }
  return stripCommonRootFolder(out);
}

async function readDirectoryEntries(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = directory.createReader();
  const all: FileSystemEntry[] = [];
  // readEntries returns results in batches; keep reading until it runs dry.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: MarkdownSourceFile[],
): Promise<void> {
  if (entry.isFile) {
    if (!entry.name.toLowerCase().endsWith(".md")) return;
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ path: prefix + entry.name, content: await file.text() });
    return;
  }
  if (entry.isDirectory) {
    const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
    for (const child of children) {
      await walkEntry(child, `${prefix}${entry.name}/`, out);
    }
  }
}

async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<MarkdownSourceFile[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry != null);

  if (entries.length === 0) {
    return filesFromFileList(dataTransfer.files);
  }

  const out: MarkdownSourceFile[] = [];
  if (entries.length === 1 && entries[0].isDirectory) {
    // A single dropped folder is the vault root — its own name stays out of
    // the relative paths.
    const children = await readDirectoryEntries(entries[0] as FileSystemDirectoryEntry);
    for (const child of children) {
      await walkEntry(child, "", out);
    }
  } else {
    for (const entry of entries) {
      await walkEntry(entry, "", out);
    }
  }
  return out;
}

/* ── App ── */

export function App() {
  const [state, setState] = useState<AppState>({ kind: "picker", error: null });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const applyGraphData = useCallback((data: GraphData, label: string) => {
    if (data.nodes.length === 0) {
      setState({ kind: "picker", error: "No markdown pages or graph nodes were found in that source." });
      return;
    }
    setState({ kind: "ready", data: normalizeGraphData(data), label });
  }, []);

  const loadFromUrl = useCallback(
    async (url: string, label?: string) => {
      setState({ kind: "loading", label: `Loading ${label ?? url}…` });
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json: unknown = await response.json();
        if (!isGraphData(json)) {
          throw new Error("the response is not WikiOS graph JSON ({ nodes, edges })");
        }
        applyGraphData(json, label ?? url);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        setState({ kind: "picker", error: `Could not load graph data: ${message}` });
      }
    },
    [applyGraphData],
  );

  const loadFromFiles = useCallback(
    async (files: MarkdownSourceFile[], label: string) => {
      setState({ kind: "loading", label: `Indexing ${files.length} markdown files…` });
      try {
        applyGraphData(buildGraphDataFromMarkdown(files), label);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        setState({ kind: "picker", error: `Could not build the graph: ${message}` });
      }
    },
    [applyGraphData],
  );

  // ?data=<url> lets hosts deep-link the SPA straight into a dataset.
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("data");
    if (url) {
      void loadFromUrl(url);
    }
  }, [loadFromUrl]);

  // Iframe integration: hosts can push data with
  //   iframe.contentWindow.postMessage({ type: "wiki-graph:set-data", data }, "*")
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: unknown; data?: unknown } | null;
      if (payload && payload.type === "wiki-graph:set-data" && isGraphData(payload.data)) {
        applyGraphData(payload.data, "embedded data");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyGraphData]);

  // When iframed, article-open intents are forwarded to the host page.
  const openArticleHandler = useMemo(() => {
    if (window.parent === window) {
      return undefined;
    }
    return (slug: string) => {
      window.parent.postMessage({ type: "wiki-graph:open-article", slug }, "*");
    };
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragActive(false);
      void filesFromDataTransfer(event.dataTransfer).then((files) =>
        loadFromFiles(files, "dropped markdown"),
      );
    },
    [loadFromFiles],
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const list = event.target.files;
      if (list && list.length > 0) {
        void filesFromFileList(list).then((files) => loadFromFiles(files, "selected folder"));
      }
      event.target.value = "";
    },
    [loadFromFiles],
  );

  const [urlDraft, setUrlDraft] = useState("");

  if (state.kind === "ready") {
    return (
      <div className="fixed inset-0">
        <GraphExplorer
          data={state.data}
          onOpenArticle={openArticleHandler}
          headerStart={
            <span className="font-display truncate text-lg text-[var(--foreground)] sm:text-xl">
              Knowledge Graph
            </span>
          }
          headerEnd={
            <button
              type="button"
              onClick={() => setState({ kind: "picker", error: null })}
              className="surface rounded-full px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition-[transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:px-4"
            >
              Change data
            </button>
          }
          storageKey="wiki-graph-spa-mode"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-[var(--background)] p-6">
      <div className="w-full max-w-lg">
        <h1 className="font-display text-center text-3xl text-[var(--foreground)]">
          Knowledge Graph
        </h1>
        <p className="mt-2 text-center text-sm text-[var(--muted-foreground)]">
          Turn a folder of markdown notes into an interactive 2D/3D graph — right in your
          browser, nothing leaves your machine.
        </p>

        {state.kind === "loading" ? (
          <div className="surface-raised mt-8 rounded-3xl px-6 py-10 text-center text-sm text-[var(--muted-foreground)]">
            {state.label}
          </div>
        ) : (
          <>
            {/* Markdown drop zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`surface mt-8 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragActive ? "border-[var(--teal)] bg-[var(--teal-soft)]/40" : "border-transparent"
              }`}
            >
              <p className="text-sm font-medium text-[var(--foreground)]">
                Drop an Obsidian vault or markdown folder here
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                [[wikilinks]] between notes become the edges of the graph
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 rounded-full bg-[var(--foreground)] px-5 py-2 text-xs font-semibold text-[var(--background)] transition-[background,transform] duration-200 hover:bg-[var(--teal)] active:scale-[0.97]"
              >
                Choose a folder
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                // @ts-expect-error webkitdirectory is a non-standard but universally supported attribute
                webkitdirectory=""
                className="hidden"
                onChange={handleFileInput}
              />
            </div>

            {/* JSON URL */}
            <form
              className="mt-4 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (urlDraft.trim()) void loadFromUrl(urlDraft.trim());
              }}
            >
              <input
                type="url"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="…or a graph JSON URL (e.g. /api/graph)"
                className="surface w-full rounded-full px-4 py-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
              <button
                type="submit"
                className="surface shrink-0 rounded-full px-4 py-2 text-sm font-medium text-[var(--foreground)] active:scale-[0.96]"
              >
                Load
              </button>
            </form>

            {/* Demo */}
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => void loadFromUrl("./demo-graph.json", "the demo dataset")}
                className="text-sm font-medium text-[var(--teal)] underline-offset-4 hover:underline"
              >
                Or explore the demo dataset →
              </button>
            </div>

            {state.error && (
              <p className="mt-4 rounded-2xl bg-[var(--peach-soft)] px-4 py-3 text-center text-xs text-[var(--foreground)]">
                {state.error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
