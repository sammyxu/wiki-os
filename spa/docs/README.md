# Knowledge Graph Explorer

WikiOS draws a vault as an interactive, gently moving mind map. Notes are nodes, wikilinks are edges, and the whole picture drifts, orbits and reacts to the pointer. These docs describe the graph in enough detail to embed it in another application or to rebuild it there.

The same component runs in three hosts:

| Host | Entry Point | Where Its Data Comes From |
| --- | --- | --- |
| WikiOS app | The `/graph` route, [graph-route.tsx](../../src/client/routes/graph-route.tsx) | `GET /api/graph` |
| Standalone SPA | `dist/spa/`, [app.tsx](../src/app.tsx) | A dropped or chosen folder, a JSON URL, the demo dataset, `?data=`, or `postMessage` |
| Embeddable library | `dist/spa-lib/wiki-graph.js`, [lib.tsx](../src/lib.tsx) | The options passed to `mountWikiGraph()` |

![The 2D view of the bundled sample vault](images/2d-overview.jpg)

## Contents

| Document | What It Covers |
| --- | --- |
| [Features](features.md) | Everything on screen, the visual encoding (size, colour, labels) and the highlighting rules. |
| [Motion and Rotation](motion.md) | The entrance, the ambient drift, the 3D orbit, camera flights, pausing and reduced motion, with every tuning constant. |
| [Interactions](interactions.md) | Mouse, touch and keyboard input in both views, the hover and focus model, and known quirks. |
| [Implementation](implementation.md) | How it's built: the component tree, state and refs, both rendering pipelines, the hosts, the build and the lifecycle of every resource. |
| [Styling](styling.md) | Every token, class and inline style, each element's resolved values, the canvas styling, and the CSS build. |
| [Data](data.md) | The `GraphData` contract, where data comes from, and how categories become colours. |
| [API Reference](api-reference.md) | `GraphExplorer` props, `mountWikiGraph()`, the SPA's URL and message protocol, and the exported helpers. |
| [Porting Guide](porting-guide.md) | Four ways to bring the graph into another application, the pitfalls of each, and a QA checklist. |

## At a Glance

- **Two views, one shell.** The 2D view uses sigma.js (WebGL), laid out once with ForceAtlas2. The 3D view uses 3d-force-graph (three.js plus a live d3-force-3d simulation). The header, search, tooltip, info panel and motion button are shared.
- **Always alive.** In 2D, the graph blooms out from a tight cluster on load, then its smaller nodes wobble slowly around their resting spots. In 3D, every node drifts and the camera circles the vertical axis about once every 109 seconds.
- **Hover to preview, click to focus.** Hovering highlights a node and its neighbours and shows a tooltip. Clicking focuses the node: the camera flies to it, unrelated nodes fade, and an info panel lists its connections.
- **The host owns navigation.** The graph never navigates by itself. Hosts pass `onOpenArticle(slug)`; without it, the "Open article →" action is hidden.
- **Motion can always be stopped.** Motion starts switched off for people who ask their operating system for reduced motion, and a pause button stops it at any time (WCAG 2.2.2).

## Source Map

| File | Contains |
| --- | --- |
| [graph-explorer.tsx](../../src/components/graph-explorer.tsx) | `GraphExplorer` (state and chrome), the 2D view, the 2D animator, search, the info panel and the tooltip |
| [graph-3d-view.tsx](../../src/components/graph-3d-view.tsx) | The 3D view. It ships with the explorer, but loads its three.js libraries only when it first mounts (the library build inlines them) |
| [graph-view-shared.ts](../../src/components/graph-view-shared.ts) | Shared colours, shared motion constants, and the props contract between the two views |
| [wiki-config.ts](../../src/lib/wiki-config.ts) | `getTopicColor()` and the category palette |
| [wiki-shared.ts](../../src/lib/wiki-shared.ts) | The `GraphData`, `GraphNode` and `GraphEdge` types |
| [markdown-graph.ts](../src/markdown-graph.ts) | Markdown files to `GraphData`, in the browser |
| [spa.css](../src/spa.css) | Theme variables and the `.surface`, `.surface-raised` and `.font-display` classes |

## Glossary

| Term | Meaning |
| --- | --- |
| Node, concept | One markdown page, identified by its `slug`: the vault-relative path without `.md`, with each segment URI-encoded. |
| Edge, connection | The links from one page to another page that exists. Repeated links between the same two pages make one edge, with the count as its weight. Stored with a direction; drawn without arrows. |
| Backlink count | How many times pages link to this one, counting repeated links. Drives node size. |
| Neighbour | A node joined to another by an edge, in either direction. |
| Active node | The focused node if there is one, otherwise the hovered node. Highlighting follows it. |
| Focus | The sticky selection made by clicking a node or picking a search result. Opens the info panel. |
| Drift | The slow ambient movement of nodes around their resting positions. |
| Orbit | The 3D camera's automatic rotation around the vertical axis. |

The screenshots show the bundled sample vault (99 concepts, 562 connections) in the standalone SPA.
