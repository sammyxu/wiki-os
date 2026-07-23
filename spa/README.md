# WikiOS Graph SPA

A self-contained single-page app (and embeddable library) for the interactive
WikiOS 2D/3D knowledge graph. It converts a set of markdown files into a graph
entirely in the browser — same parsing, wikilink extraction, and classification
code as the WikiOS server — or renders ready-made graph JSON.

## Build

```bash
npm run build:spa
```

- `dist/spa/` — the standalone SPA (relative asset paths; host it anywhere, at
  any sub-path, or inside an iframe). `npm run dev:spa` serves it on :5214
  during development.
- `dist/spa-lib/wiki-graph.js` — a single self-contained ES module exporting
  the mount API (React, sigma, and the 3D stack are bundled; styles are
  injected at mount).

## Using the SPA (`dist/spa/`)

Open it directly and either drop a markdown folder / Obsidian vault on the
page, paste a graph JSON URL, or load the bundled demo dataset.

Integration hooks:

- **Deep link**: `index.html?data=<url>` loads graph JSON from `<url>` on
  startup (e.g. `?data=/api/graph` when hosted next to a WikiOS server).
- **Iframe push**: hosts can inject data without any URL:

  ```js
  iframe.contentWindow.postMessage({ type: "wiki-graph:set-data", data: graphData }, "*");
  ```

- **Iframe events**: when the user asks to open a note's article, the SPA
  emits to its parent:

  ```js
  window.addEventListener("message", (e) => {
    if (e.data?.type === "wiki-graph:open-article") console.log(e.data.slug);
  });
  ```

## Using the library (`dist/spa-lib/wiki-graph.js`)

```html
<div id="graph" style="height: 600px"></div>
<script type="module">
  import { mountWikiGraph, buildGraphDataFromMarkdown } from "./wiki-graph.js";

  // From ready-made data (the WikiOS /api/graph shape) …
  const handle = mountWikiGraph(document.getElementById("graph"), {
    url: "/api/graph",
    title: "My Wiki",
    onOpenArticle: (slug) => location.assign(`/wiki/${slug}`),
  });

  // … or from raw markdown, indexed client-side:
  const data = buildGraphDataFromMarkdown([
    { path: "notes/alpha.md", content: "# Alpha\nLinks to [[notes/beta]]." },
    { path: "notes/beta.md", content: "# Beta\nBack to [[notes/alpha]]." },
  ]);
  handle.update(data);

  // handle.unmount() when done.
</script>
```

`mountWikiGraphOptions` accepts exactly one data source (`data`, `url`, or
`markdownFiles`) plus optional `title`, `aliases` (topic → color), and
`onOpenArticle`. The host element must have an explicit size.

## Data contract

```ts
interface GraphData {
  nodes: {
    slug: string;          // unique id (vault-relative path without .md)
    title: string;
    backlinkCount: number; // drives node size
    wordCount: number;
    categories: string[];  // first entry drives node color
    summary: string;
    neighbors: string[];   // slugs; derived from edges if omitted
  }[];
  edges: { source: string; target: string; weight: number }[];
}
```

`backlinkCount`, `wordCount`, `categories`, `summary`, and `neighbors` are
optional in hand-written JSON — `normalizeGraphData` fills sensible defaults.

## Notes

- Markdown wikilinks must use vault-relative targets (`[[folder/note]]`) to
  resolve, mirroring the WikiOS indexer.
- Google Fonts are referenced from the stylesheet; offline hosts fall back to
  system fonts.
- Both graph views respect `prefers-reduced-motion` and include a pause
  control for the ambient animation.
