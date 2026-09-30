# API Reference

The programming interfaces of the graph: the React component, the library build, the standalone SPA's URL and message protocol, and the helper functions.

## GraphExplorer (React)

Defined in [graph-explorer.tsx](../../src/components/graph-explorer.tsx).

```tsx
import { GraphExplorer } from "@/components/graph-explorer";

<div style={{ position: "fixed", inset: 0 }}>
  <GraphExplorer
    data={graphData}
    aliases={aliases}
    onOpenArticle={(slug) => navigate(`/wiki/${slug}`)}
    headerStart={<a href="/">My Wiki</a>}
  />
</div>
```

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `GraphData` | Required | Nodes and edges to draw (see [Data](data.md)) |
| `aliases` | `Record<string, TopicAliasConfig>` | `{}` | Category colour overrides. Used as given, so write the keys in normalized form (see [Setting Aliases](data.md#setting-aliases)) |
| `conceptsLabel` | `string` | `"concepts"` | The word after the node count in the header |
| `connectionsLabel` | `string` | `"connections"` | The word after the edge count in the header |
| `onOpenArticle` | `(slug: string) => void` | None | Called when someone asks to open a node. Without it, "Open article →" is hidden and the canvas's open gestures do nothing |
| `headerStart` | `ReactNode` | None | Content at the left of the header |
| `headerEnd` | `ReactNode` | None | Content after the stats and the 2D/3D switch |
| `storageKey` | `string` | `"wikios-graph-mode"` | The `localStorage` key that remembers the 2D/3D choice |

- **Size.** The explorer fills its parent (`h-full w-full`), so the parent needs a definite height.
- **Stable inputs.** A change to `data` or `aliases` by reference rebuilds the active view, with a new 2D layout or a new 3D simulation. Keep both stable, for example with `useMemo`. `onOpenArticle`, the labels and the header slots can change freely.
- **Browser only.** The first render reads `localStorage` and `window.matchMedia`, and the views need WebGL, so it can't be rendered on a server.
- **Other exports:** the `GraphExplorerProps` type, and the `GraphAnimator` interface of the 2D animator.

## GraphViewProps (Internal)

The contract between `GraphExplorer` and its two views, defined in [graph-view-shared.ts](../../src/components/graph-view-shared.ts). Implement it to add another view:

```ts
interface GraphViewProps {
  data: GraphData;
  aliases: Record<string, TopicAliasConfig>;
  focusedSlug: string | null;
  motionEnabled: boolean;
  onFocusNode: (slug: string) => void;
  onClearFocus: () => void;
  onNavigateNode: (slug: string) => void;
  onHoverNode: (node: TooltipNode | null) => void;
  flyToRef: MutableRefObject<((slug: string, zoomRatio?: number) => void) | null>;
}

interface TooltipNode {
  label: string;
  categories: string[];
  backlinkCount: number;
  wordCount: number;
}
```

A view must:

1. Draw `data` into an element that fills its parent.
2. Highlight the active node (`focusedSlug`, or its own hovered node) and its neighbours.
3. Report hover changes through `onHoverNode`.
4. On a click on the focused node or one of its neighbours, call `onNavigateNode`. On a click on any other node, call `onFocusNode` and fly its camera there. On a click on empty space, call `onClearFocus`.
5. Put a camera-flight function in `flyToRef.current` while mounted, and clear it on unmount.
6. Apply `motionEnabled` changes without rebuilding.

[Implementation](implementation.md#the-view-contract) describes the ref pattern both existing views use.

## mountWikiGraph (Library)

The library build, `dist/spa-lib/wiki-graph.js`, is a single ES module with React and the 3D stack bundled in.

```html
<div id="graph" style="height: 600px"></div>
<script type="module">
  import { mountWikiGraph } from "./wiki-graph.js";

  const handle = mountWikiGraph(document.getElementById("graph"), {
    url: "/api/graph",
    title: "My Wiki",
    onOpenArticle: (slug) => location.assign(`/wiki/${slug}`),
  });

  // Later:
  handle.update(newGraphData);
  handle.unmount();
</script>
```

### Options

| Option | Type | Description |
| --- | --- | --- |
| `data` | `GraphData` | Ready-made graph data |
| `markdownFiles` | `MarkdownSourceFile[]` | `{ path, content }` files to index in the browser |
| `url` | `string` | A URL returning graph JSON, fetched on mount |
| `aliases` | `Record<string, TopicAliasConfig>` | Category colour overrides, with keys in normalized form (see [Setting Aliases](data.md#setting-aliases)) |
| `title` | `string` | Shown in the header, in the display font |
| `onOpenArticle` | `(slug: string) => void` | Called when someone asks to open a node |

- **One source wins.** The first present of `data`, `markdownFiles` and `url` is used, in that order.
- **Errors show in the element** as centred plain text:

  | Situation | Message |
  | --- | --- |
  | No data source given | "mountWikiGraph requires one of: data, url, markdownFiles" |
  | The URL answers with an error status | "Failed to load graph data: HTTP {status}" |
  | The URL returns JSON of the wrong shape | "The response is not WikiOS graph JSON ({ nodes, edges })" |
  | The URL returns something that isn't JSON | The browser's JSON parse error |
  | The request fails outright (network or CORS) | The browser's fetch error, such as "Failed to fetch" in Chromium. This is the likeliest failure for a cross-origin `url` |

### Handle

| Method | Description |
| --- | --- |
| `update(data: GraphData)` | Normalizes the data and renders it. `title`, `aliases` and `onOpenArticle` stay as they were at mount. The initial render is always asynchronous, even for `data` and `markdownFiles`. Any `update()` made before the initial source resolves, even in the same tick as mounting, is replaced by it, or by the error message if loading fails |
| `unmount()` | Unmounts the React root. The injected stylesheet stays in `document.head` |

### Behaviour

- **Styles.** The first mount on a page appends `<style data-wiki-graph-styles="true">` to `document.head`, with Tailwind's reset and page-level rules included. Later mounts reuse it. See the [Porting Guide](porting-guide.md#option-b-load-the-library).
- **Rendering.** The explorer renders inside React `StrictMode`, with `storageKey="wiki-graph-embed-mode"`.
- **Size.** The host element must have an explicit size.

### Other Exports

| Export | Kind |
| --- | --- |
| `buildGraphDataFromMarkdown`, `isGraphData`, `normalizeGraphData` | Functions (see [Helpers](#helpers)) |
| `GraphData`, `MarkdownSourceFile`, `TopicAliasConfig`, `WikiGraphMountOptions`, `WikiGraphHandle` | Types, in the [lib.tsx](../src/lib.tsx) source only. The build emits `wiki-graph.js` without a `.d.ts` file, and `WikiOsConfigInput`, the type of `buildGraphDataFromMarkdown`'s second parameter, isn't re-exported |

## Standalone SPA

`dist/spa/` is a static site with relative asset paths, so it works from any folder, sub-path or iframe.

### URL Parameter

| Parameter | Effect |
| --- | --- |
| `?data=<url>` | Fetches graph JSON from `<url>` on load. Relative URLs resolve against the page; other origins need CORS |

### Messages

| Direction | Message | Notes |
| --- | --- | --- |
| Host → SPA | `{ type: "wiki-graph:set-data", data: GraphData }` | Accepted from any origin when `data` passes `isGraphData`. Replaces whatever is shown |
| SPA → host | `{ type: "wiki-graph:open-article", slug: string }` | Sent only when the SPA is framed, to `window.parent` with target origin `"*"` |

```js
const frame = document.querySelector("iframe");
frame.contentWindow.postMessage({ type: "wiki-graph:set-data", data }, "https://graph.example.org");

window.addEventListener("message", (event) => {
  if (event.origin !== "https://graph.example.org") return;
  if (event.data?.type === "wiki-graph:open-article") openPage(event.data.slug);
});
```

### The Picker

Until it has data, the SPA shows its own start screen. It offers a drop zone for a folder or markdown files, "Choose a folder", a URL box with "Load", and "Or explore the demo dataset →". Its error messages are:

| Situation | Message |
| --- | --- |
| The source had no pages or nodes | "No markdown pages or graph nodes were found in that source." |
| A URL failed | "Could not load graph data: {reason}" |
| Indexing markdown failed | "Could not build the graph: {reason}" |

Once a graph shows, "Change data" in the header returns to the start screen. The 2D/3D choice is stored under `wiki-graph-spa-mode`.

## Helpers

Exported from [markdown-graph.ts](../src/markdown-graph.ts) and re-exported by the library.

| Function | Description |
| --- | --- |
| `buildGraphDataFromMarkdown(files: MarkdownSourceFile[], configInput?: WikiOsConfigInput): GraphData` | Indexes markdown in the browser, exactly like the server. `configInput` accepts the same category settings as `wiki-os.config.ts` (aliases, hidden categories, folder depth, frontmatter keys). Write the frontmatter keys in normalized form, lower case with spaces instead of `-` and `_` (see [Data](data.md#markdown-in-the-browser)) |
| `isGraphData(value: unknown): value is GraphData` | True when `nodes` and `edges` are arrays and every node has a string `slug` and `title`. Edges are not inspected |
| `normalizeGraphData(value: GraphData): GraphData` | Fills in defaults and drops edges with unknown ends (see [Data](data.md#hand-written-json)) |

```ts
interface MarkdownSourceFile {
  path: string;    // vault-relative, such as "topics/turing-machine.md"
  content: string;
}
```

Colour helpers live in [wiki-config.ts](../../src/lib/wiki-config.ts): `getTopicColor(topic, aliases)` and `normalizeTopicKey(value)`. `getCategoryColor(categories, aliases)` lives in [graph-view-shared.ts](../../src/components/graph-view-shared.ts).
