# Implementation

How the mind map is built, module by module. Read it with the source open: it follows the code in [graph-explorer.tsx](../../src/components/graph-explorer.tsx), [graph-3d-view.tsx](../../src/components/graph-3d-view.tsx) and [graph-view-shared.ts](../../src/components/graph-view-shared.ts), then the hosts and the build. The motion maths is in [Motion and Rotation](motion.md) and the visual values are in [Styling](styling.md).

## Architecture

```text
Hosts                                      Explorer                              Core (src/lib)
------------------------------------       -----------------------------------   ------------------------
src/client/routes/graph-route.tsx  --+
spa/src/app.tsx (via main.tsx)     --+-->  components/graph-explorer.tsx  ----->  wiki-config.ts (colours)
spa/src/lib.tsx                    --+       |  2D view, animator, chrome      +->  wiki-shared.ts (types)
                                             +--> components/graph-3d-view.tsx |
                                             +--> components/graph-view-shared.ts
spa/src/markdown-graph.ts  -------------------------------------------------->  markdown.ts,
                                                                                 wiki-classification.ts,
                                                                                 wiki-config.ts, wiki-shared.ts
```

- The explorer is framework-light: React owns the chrome and the component lifecycle, while sigma.js and 3d-force-graph (both plain JavaScript) own the canvases.
- Nothing in this tree imports Node.js APIs or server code; everything runs in the browser. The WikiOS route's loader fetches `/api/graph` over HTTP.
- The 3D stack is imported with `import()` at runtime and with `import type` at compile time, so it only loads when the 3D view first mounts: on the first switch to 3D, or at page load when 3D was the saved mode. The library build inlines it instead.

### Libraries

| Package | Version | Used For | Loaded |
| --- | --- | --- | --- |
| `react`, `react-dom` | 19.2.0 | Components and roots | With the page |
| `graphology` | 0.26.0 | The in-memory graph behind the 2D view | With the page |
| `graphology-layout-forceatlas2` | 0.10.1 | The 2D layout | With the page |
| `sigma` | 3.0.2 | 2D WebGL rendering, camera, pointer events | With the page |
| `3d-force-graph` | 1.80.0 | The 3D scene, simulation and controls | When the 3D view first mounts: on the first switch to 3D, or at page load when 3D was the saved mode |
| `three` | 0.185.1 | WebGL engine (a dependency of `3d-force-graph`) | With the 3D view |
| `three-forcegraph`, `three-render-objects`, `d3-force-3d` | 1.43.4, 1.42.0, 3.0.6 | Graph objects, render loop, physics. The first two are dependencies of `3d-force-graph`; `d3-force-3d` comes in through `three-forcegraph` | With the 3D view |
| `three-spritetext` | 1.10.0 | 3D text labels | With the 3D view |

## Component Tree

```text
GraphExplorer                state: mode, motionEnabled, focusedSlug, tooltip
|-- <header>                 headerStart | stats pill | 2D/3D switch | headerEnd
|-- GraphSearch              state: query, results
|-- NodeTooltip              rendered while nothing is focused
|-- InfoPanel                rendered while a node is focused
|-- Graph2DView key="2d"     or  Graph3DView key="3d"
`-- motion button
```

The view is keyed by mode, so switching between 2D and 3D unmounts one renderer completely and mounts the other from scratch.

## GraphExplorer

`GraphExplorer` owns the interaction state and renders the chrome. The views own their renderers and report back through callbacks.

### State, Refs and Derived Values

| Name | Kind | Purpose |
| --- | --- | --- |
| `mode` | State, `"2d" \| "3d"` | Initialized by `loadInitialMode(storageKey)`, which reads `localStorage` and falls back to `"2d"` on any error |
| `motionEnabled` | State, boolean | Initialized to `!prefersReducedMotion()` |
| `focusedSlug` | State, string or null | The focused node |
| `tooltip` | State | The hovered node's details and position, or null |
| `mousePosRef` | Ref | Last pointer position relative to the explorer's root |
| `flyToRef` | Ref | The active view's camera-flight function, registered by the view |
| `nodeMap` | Ref, `Map<slug, GraphNode>` | Rebuilt in an effect whenever `data` changes |
| `searchNodes` | Memo | `{ slug, label }` for every node, passed to `GraphSearch` |
| `focusedNode`, `focusedNeighbors` | Computed each render | Info panel content. Neighbours come from `node.neighbors`, sorted by `backlinkCount`, highest first |

### Handlers

| Handler | Does |
| --- | --- |
| `handleModeChange(mode)` | Sets the mode, clears the focus and the tooltip, writes the mode to `localStorage` (errors ignored) |
| `handleFocusNode(slug)` | Sets `focusedSlug` |
| `handleClearFocus()` | Clears `focusedSlug` |
| `handleNavigateNode(slug)` | Calls `onOpenArticle(slug)`. Without a handler, it focuses that node and flies there with ratio 0.5, unless the node is already focused |
| `handleHoverNode(node)` | Sets the tooltip at the last pointer position, or clears it |
| `handleMouseMove(event)` | Stores the pointer position relative to the root's bounding box, and moves a visible tooltip with it |
| `handleSearchSelect(slug)` | Focuses the node, then `flyToRef.current?.(slug, 0.3)` |
| `handleInfoClose()` | Clears the focus |
| `handleInfoNeighborClick(slug)` | Focuses the neighbour, then `flyToRef.current?.(slug, 0.5)` |

### Effects

- **Reduced motion.** A `matchMedia("(prefers-reduced-motion: reduce)")` change listener switches motion off when the preference becomes "reduce". It never switches motion back on.
- **Node lookup.** `nodeMap` is rebuilt when `data` changes.

### Render

- The root is a `div` with `relative h-full w-full overflow-hidden`, an inline background of `BG_COLOR` and the `onMouseMove` handler.
- A fresh `viewProps` object (typed `GraphViewProps`) is built on every render and spread into the active view.
- The tooltip renders only while `focusedSlug` is null. The info panel renders only while `focusedNode` exists.

## The View Contract

Both views implement `GraphViewProps` from [graph-view-shared.ts](../../src/components/graph-view-shared.ts):

| Prop | Direction | Meaning |
| --- | --- | --- |
| `data`, `aliases` | In | What to draw. A change of either (by reference) rebuilds the renderer |
| `focusedSlug` | In | The current focus, owned by `GraphExplorer` |
| `motionEnabled` | In | Whether ambient motion should run; applied without a rebuild |
| `onFocusNode(slug)` | Out | A node was clicked and should become focused |
| `onClearFocus()` | Out | Empty space was clicked |
| `onNavigateNode(slug)` | Out | The focused node or one of its neighbours was clicked again |
| `onHoverNode(node \| null)` | Out | The hovered node changed; carries the tooltip fields |
| `flyToRef` | Both | The view stores its camera-flight function here while mounted and clears it on unmount |

Both views follow the same pattern, which keeps the expensive renderer alive while React re-renders around it:

1. **One effect builds the renderer.** Its dependencies are `[aliases, data, flyToRef]`. Its cleanup destroys everything it created.
2. **Callbacks go through a ref.** `callbacksRef.current` is refreshed after every render by an effect with no dependency list. Renderer event handlers call `callbacksRef.current.onFocusNode(...)` and so on, so they always reach the latest props without rebuilding the renderer.
3. **Focus and hover live in refs.** `focusedRef` mirrors the `focusedSlug` prop (an effect copies it and calls `refresh()`), and `hoveredRef` is set by pointer events. Reducers and accessors read these refs whenever they run. On a click, the view also writes `focusedRef` immediately, so the highlight doesn't wait for the round trip through React state.
4. **Motion lives in a ref too.** `motionEnabledRef` mirrors the prop, and a separate effect applies changes to the running renderer.
5. **Redraws are explicit.** After changing a ref, the view calls `sigma.refresh()` or `instance.refresh()`, which re-runs the reducers or accessors.

## 2D View

### Building the Graph

`buildGraph(data, aliases)` creates `new Graph()` with graphology's defaults: a mixed graph, no parallel edges, self-loops allowed.

| Node Attribute | Value |
| --- | --- |
| `label` | `node.title` |
| `size` | `max(2.5, min(16, 2.5 + 2 × √backlinkCount))` |
| `color` | `getCategoryColor(node.categories, aliases)` |
| `originalColor` | The same colour. Set but never read |
| `x`, `y` | `Math.random() × 1000` |
| `categories`, `backlinkCount`, `wordCount` | Copied for the tooltip |

Each edge is added with the key `` `${source}->${target}` `` and the attributes `weight`, `size: 0.3` and `color: EDGE_DEFAULT`. An edge is skipped if either end is missing or the key already exists. A→B and B→A have different keys, so both are kept.

### Layout

`runLayout(graph)` calls `forceAtlas2.assign(graph, { iterations: 500, settings })`, which moves the `x` and `y` attributes in place, synchronously, before the first frame. The settings are listed in [Motion and Rotation](motion.md#layout).

### The Sigma Instance

`new SigmaLib(graph, container, settings)` with:

| Setting | Value | Note |
| --- | --- | --- |
| `allowInvalidContainer` | `true` | Don't throw if the container has no size yet |
| `renderLabels` / `renderEdgeLabels` | `true` / `false` | |
| `labelColor` | `{ color: "#6b6673" }` | `LABEL_COLOR` |
| `labelFont` | `"Urbanist", -apple-system, BlinkMacSystemFont, sans-serif` | |
| `labelSize` / `labelWeight` | 11 / `"500"` | |
| `labelRenderedSizeThreshold` | 6 | Minimum drawn size for a label |
| `defaultEdgeColor` / `defaultEdgeType` | `EDGE_DEFAULT` / `"line"` | No arrows |
| `defaultNodeColor` | `DEFAULT_NODE_COLOR` | |
| `stagePadding` | 60 | Pixels kept clear around the fitted graph (sigma's default is 30) |
| `nodeReducer`, `edgeReducer` | See below | Highlighting |

Sigma defaults that shape the behaviour and are left alone: `zIndex: false` (so the reducers' `zIndex` values have no effect), `labelDensity: 1`, `labelGridCellSize: 100`, `zoomToSizeRatioFunction: Math.sqrt`, `itemSizesReference: "screen"`, `enableCameraRotation: true`, `zoomingRatio: 1.7`, `doubleClickZoomingRatio: 2.2`, `minCameraRatio` and `maxCameraRatio: null` (unlimited zoom), `hideEdgesOnMove: false`, `enableEdgeEvents: false`.

### Reducers

Sigma calls the reducers for every node and edge whenever it re-processes the data: on `refresh()`, and on graph attribute updates, so each 2D drift frame re-reduces every node. Pan, zoom and camera-flight redraws reuse the cached results. The reducers return modified copies and never touch the stored graph.

```ts
const active = focusedRef.current ?? hoveredRef.current;

nodeReducer(node, data):
  if no active: return data
  if node === active:         highlighted = true, zIndex = 2, size = size * 1.3
  else if adjacent to active: zIndex = 1, and forceLabel = true while a node is focused
  else:                       color = DIMMED_NODE_COLOR, label = "", zIndex = 0

edgeReducer(edge, data):
  if no active: return data
  if the edge touches active: color = EDGE_HOVER, size = 1
  else:                       hidden = true
```

Adjacency is `graph.hasEdge(active, node) || graph.hasEdge(node, active)`. A `highlighted` node is drawn again on sigma's hover layer, with the white label box described in [Styling](styling.md#2d-canvas).

### The Animator

`createGraphAnimator(graph, sigma, { entrance })` returns `null` for an empty graph or one with more than `MAX_ANIMATED_NODES` nodes. Otherwise it:

1. Measures the settled layout: its bounding box, its centroid, and its extent (the larger of width and height).
2. Builds a `motions` map with one record per node:

   | Field | Meaning |
   | --- | --- |
   | `baseX`, `baseY` | The rest position from the layout |
   | `spawnX`, `spawnY` | Where the entrance starts: the centroid plus 30% of the offset, or the rest position when there is no entrance |
   | `delay` | `hash01(i) × 600` ms |
   | `phaseX`, `phaseY` | `i × GOLDEN_ANGLE`, and `phaseX × 1.7 + 1.3` |
   | `freqX`, `freqY` | The base angular speed times `0.75 + 0.5 × hash01(i + 0.1)` and `0.85 + 0.5 × hash01(i + 0.2)` |
   | `amplitude` | 0 for nodes of size 6 or more; otherwise `extent × 0.012 × (0.7 + 0.6 × hash01(i + 0.3))` |
   | `pausedAt`, `timeShift` | Clock bookkeeping for the hover hold |

3. Freezes sigma's framing with `sigma.setCustomBBox(sigma.getBBox())`.
4. With an entrance, applies the first frame immediately, so the collapsed state is what paints first.
5. Starts a `requestAnimationFrame` loop. The loop applies a frame on every tick during the entrance (1,400 + 600 ms), then only when at least 33.3 ms have passed since the last applied frame.

`applyFrame(now)` calls `graph.updateEachNodeAttributes(updater, { attributes: ["x", "y"] })`. The single batched update makes sigma schedule one refresh. The `attributes` hint saves nothing, though: sigma counts `x` and `y` as layout changes and re-indexes anyway. Each node's clock is `pausedAt ?? (elapsed − timeShift)`.

The returned object:

| Method | Does |
| --- | --- |
| `stop()` | Cancels the animation frame loop |
| `settle()` | Moves every node back to its rest position |
| `holdNode(node)` | Releases any held node, then freezes this node's clock (`pausedAt`) |
| `releaseNode()` | Adds the time spent held to `timeShift` and clears `pausedAt`, so the node resumes without a jump |
| `getBasePosition(node)` | Returns the rest position, for camera flights |

The animator is created when the view mounts with motion on (with an entrance) and when motion is resumed (without one). Pausing calls `stop()` and `settle()` and discards it; unmounting calls `stop()`.

### Pointer Events

| Sigma Event | Handler |
| --- | --- |
| `enterNode` | Ignored when `event.original` is a touch event (nothing would end that hover). Otherwise: set `hoveredRef`, hold the node, `refresh()`, report the tooltip fields, set the container's cursor to `pointer` |
| `leaveNode` | Clear `hoveredRef`, release the node, `refresh()`, report `null`, reset the cursor |
| `clickNode` | If the node is focused or adjacent to the focused node, call `onNavigateNode`. Otherwise set `focusedRef`, call `onFocusNode`, `refresh()` and fly the camera (ratio 0.5, 300 ms) |
| `clickStage` | If something is focused, clear `focusedRef`, call `onClearFocus` and `refresh()` |

### Camera Flights

`focusCamera(slug, ratio, duration)` aims at the node's rest position when an animator exists. Sigma's camera works in "framed graph" coordinates (the normalized space sigma fits to the viewport), while node attributes are raw graph coordinates. The code therefore converts twice: `sigma.viewportToFramedGraph(sigma.graphToViewport(base))`. Without an animator, it uses `sigma.getNodeDisplayData(slug)`, which is already in camera space. It then calls `camera.animate({ x, y, ratio }, { duration })`.

`flyToRef.current` is set to `(slug, zoomRatio = 0.5) => focusCamera(slug, zoomRatio, 400)`.

### Cleanup

The effect's cleanup clears `flyToRef`, stops the animator, calls `sigma.kill()` (which removes sigma's canvases, listeners and event handlers) and clears the refs.

## 3D View

### Lazy Loading

The main effect starts `Promise.all([import("3d-force-graph"), import("three-spritetext")])`. A `disposed` flag, set by the cleanup, drops a result that arrives after unmount. That also covers React StrictMode, which mounts, unmounts and remounts effects in development. `flyToRef` is only registered once the modules arrive, so camera flights do nothing until then.

`motionAtInit` is read from `motionEnabledRef` when the modules arrive rather than when the effect starts, so a toggle made while loading still counts.

### Data Mapping

- A `neighbors` map (slug to a set of slugs) is built from the edges, in both directions, skipping edges with unknown ends. `isNeighborOfActive(active, id)` reads it.
- Each node becomes `{ id, label, color, val: 1 + 0.55 × backlinkCount, categories, backlinkCount, wordCount }`.
- Each edge becomes `{ source, target }`. d3 replaces those ids with node objects once the simulation starts, so `linkEndpointId()` accepts either form.

### Instance Setup

The exported `ForceGraph3D` constructor is typed with the default node and link generics, so the code casts it once (`TypedForceGraph3D`) and creates `new TypedForceGraph3D(container, { controlType: "orbit" })`. Then:

1. **Forces.** `d3Force("link").distance(65)` and `d3Force("charge").strength(-140)`.
2. **Appearance and behaviour,** as one chain:

   | Method | Value | Why |
   | --- | --- | --- |
   | `backgroundColor` | `BG_COLOR` | Matches the 2D view |
   | `showNavInfo` | `false` | Hides the library's control hints |
   | `nodeResolution` | 16 | Sphere segments (the library default is 8) |
   | `nodeOpacity` | 1 | Solid spheres (the default is 0.75) |
   | `nodeLabel` | `() => ""` | Turns off the library's HTML tooltip; the shared `NodeTooltip` is used instead |
   | `nodeThreeObjectExtend` | `true` | Adds the label sprite next to the default sphere, instead of replacing it |
   | `nodeThreeObject` | Label sprite, or nothing | Nodes with fewer than 4 backlinks get no sprite |
   | `nodeColor` | Active and neighbours in colour, others `DIMMED_NODE_COLOR` | Highlighting |
   | `linkColor` | `EDGE_3D_HIGHLIGHT` when touching the active node, else `EDGE_3D_DEFAULT` | Highlighting |
   | `linkWidth` | 1.2 when touching the active node, else 0 | Width 0 draws a 1 px line; anything larger draws a tube |
   | `linkOpacity` | 0.35 | The default is 0.2 |
   | `onNodeHover`, `onNodeClick`, `onLinkClick`, `onBackgroundClick` | See below | The same rules as 2D, plus double-click handling |

3. **Engine mode,** chosen once:

   | Condition | Setup |
   | --- | --- |
   | Motion off at init | `warmupTicks(160).cooldownTicks(0)`: the layout settles before the first frame, then the engine stops |
   | Motion on, 600 nodes or fewer | `cooldownTime(Infinity)`, `d3Force("drift", driftForce)`, and `enableDrift` scheduled after 4,500 ms |
   | Motion on, more than 600 nodes | Library defaults: the engine stops after 15 seconds |

4. **Fit on stop.** `onEngineStop` calls `zoomToFit(800, 40)` once, unless the camera has been touched.
5. **Data.** `graphData({ nodes, links })` starts the simulation.
6. **Controls.** `instance.controls()` returns three.js `OrbitControls`. The code sets `autoRotate = motionAtInit` and `autoRotateSpeed = 0.55`, and listens to `start` (mark the camera touched, stop rotating, cancel any resume timer) and `end` (start a 6,000 ms timer that restores `autoRotate` from `motionEnabledRef`).
7. **Size.** A `ResizeObserver` on the container calls `instance.width(...)` and `instance.height(...)`.
8. **Flights.** `flyToRef.current = (slug) => { cameraTouched = true; flyToNode(slug); }`. The zoom ratio argument is ignored.

### Accessors and Refresh

`instance.refresh()` re-runs the node and link accessors, and the view calls it on every hover and focus change. Because `nodeThreeObject` runs again each time, label sprites are cached per node id in `spriteCache`. A sprite's canvas is generated when the sprite is created (its constructor and each property setter regenerate it). Later refreshes reuse the sprite and only change its opacity: 1 for the active node and its neighbours, otherwise 0.15 while something is active.

The cache doesn't save GPU work, though. `refresh()` sets three-forcegraph's `_flushObjects` flag, which removes and rebuilds every node and link object and disposes the old ones, including each cached sprite's material and texture. The textures are therefore re-uploaded after every hover or focus change.

A sprite is created with `new SpriteText(label)`. It then gets `color = LABEL_COLOR`, `textHeight = 3.4`, `fontFace = "Urbanist, sans-serif"`, `fontWeight = "500"`, `material.depthWrite = false`, `material.transparent = true` and `position.y = 4 × ∛val + 3.5` (just above the sphere).

### Hover and Clicks

| Callback | Handler |
| --- | --- |
| `onNodeHover(node)` | Treat the node as `null` unless a mouse or pen is over the canvas. Then set `hoveredRef`, `refresh()`, and report the tooltip fields or `null`, skipping the work when nothing changes |
| `onNodeClick(node)` | If this click completes a double-click, call `onNavigateNode` for the first click's node. Otherwise, if the node is focused or adjacent to the focused node, call `onNavigateNode`. Otherwise record the click for double-click detection, set `focusedRef`, call `onFocusNode`, `refresh()`, mark the camera touched and `flyToNode` |
| `onLinkClick()` | Only completes a double-click; a single link click does nothing |
| `onBackgroundClick()` | If this click completes a double-click, call `onNavigateNode` for the first click's node. Otherwise, if something is focused, clear it, call `onClearFocus` and `refresh()` |

- **Clicks.** The renderer only reports a click when the pointer didn't drag, so orbiting never changes the focus.
- **Double-clicks.** A focusing click is recorded with its time. `takeDoubleClick()` hands back that node if the next click, on anything, comes within `DOUBLE_CLICK_MS` (400 ms). The first click's camera flight sweeps the node out from under the pointer, so the second click can land on another node, a link or empty space.
- **Pointer tracking.** Capture-phase `pointerdown` and `pointermove` listeners on the container record the pointer's type and that it is over the canvas, and a `pointerleave` listener clears the hover at once. The renderer re-tests hover every 50 ms at the last pointer position, and without these listeners, nodes passing under a finger's last touch point or the point where the mouse left the canvas would show tooltips.

### Drift, Stretch and Fit

- **`driftForce`** is a closure registered as a d3 force. It does nothing until `driftTargets` exists, or while `motionEnabledRef` is false. Otherwise it steers every undragged node towards its moving target (see [Motion and Rotation](motion.md#drift-1)).
- **`enableDrift`** runs once after 4,500 ms. It collects the nodes that have positions, measures the container's aspect ratio, computes the stretch factors, the stretched extent and the amplitude, and builds `driftTargets`. Unless the camera has been touched, it then schedules `fitCameraToAnchors` for 1,400 ms later.
- **`fitCameraToAnchors`** computes the fit distance from the anchors and the camera's `fov` and `aspect`, then calls `cameraPosition(scaledPosition, { x: 0, y: 0, z: 0 }, 800)`.
- **`flyToNode(slug)`** finds the node's live position and calls `cameraPosition(node × (1 + 130 ÷ |node|), node, 900)`. The renderer eases the position with quadratic-out over 900 ms and the aim over 300 ms, and moves the orbit target to the node.

### The Camera-Touched Flag

A local `cameraTouched` flag records that a person has taken charge of the camera. It is set by a node click, by `flyToRef` and by the controls' `start` event. OrbitControls fires `start` on any pointer press on the canvas (any button, even without movement), on every wheel step and on touch start, so even a plain click counts. It suppresses both the delayed fit in `enableDrift` and the `zoomToFit` in `onEngineStop`.

### Cleanup

The cleanup sets `disposed`, clears `flyToRef`, cancels the resume, drift and fit timers, removes the controls and pointer listeners, disconnects the `ResizeObserver` and clears the refs. It then calls `fg._destructor()`, and finally `container.replaceChildren()`. The destructor cancels the animation loop, which stops both rendering and the simulation; three-forcegraph has no disposal step for the simulation itself. It then empties the graph data. Finally, through three-render-objects, it empties the scene (disposing geometries, materials and textures) and disposes the OrbitControls, the renderer and the post-processing composer. `renderer.dispose()` doesn't release the WebGL context itself, which is left to garbage collection. `sigma.kill()`, by contrast, does release its contexts.

## Search, Tooltip and Info Panel

- **`GraphSearch`** keeps `query` and `results` in local state. An effect recomputes the results when `nodes` or `query` changes. Picking a result calls `onSelect`, then resets both.
- **`NodeTooltip`** is a pure component. It renders nothing without a node and is positioned absolutely at `position.x + 14`, `position.y − 12`.
- **`InfoPanel`** is a pure component. It shows the "Open article →" block only when it receives an `onNavigate` prop, which `GraphExplorer` passes only when the host gave `onOpenArticle`.

## Hosts

### Standalone SPA

[main.tsx](../src/main.tsx) imports `spa.css` and renders `App` into `#root` inside `StrictMode`. [app.tsx](../src/app.tsx) is a small state machine:

| State | Shows |
| --- | --- |
| `picker` (with an optional error) | The drop zone, the folder picker, the URL form and the demo link |
| `loading` (with a label) | A card such as "Loading the demo dataset…" while a URL is fetched. The markdown paths set "Indexing N markdown files…", but indexing runs synchronously in the same tick and React batches the updates, so that card never appears. Files are read beforehand, while the state is still `picker` |
| `ready` (data and label) | `GraphExplorer` in a `fixed inset-0` wrapper, with `storageKey="wiki-graph-spa-mode"` |

- **Folder picker.** A hidden `<input type="file" multiple webkitdirectory>` returns a `FileList`. Only files ending in `.md` are read, as text, one after another. Paths come from `webkitRelativePath`. `stripCommonRootFolder` removes the picked folder's own name when every path starts with it.
- **Drag and drop.** For each dropped item, `webkitGetAsEntry()` is called. A single dropped folder is treated as the vault root, so its name stays out of the paths. Folders are walked recursively, calling `readEntries` until it returns an empty batch, because browsers return entries in batches. If no entries are available, it falls back to the plain file list.
- **Loading from a URL.** `fetch(url)`, then a status check, `response.json()` and `isGraphData()`. On success, `normalizeGraphData` runs and the state becomes `ready`. Graphs with no nodes go back to the picker with an error.
- **Deep link.** An effect reads `?data=` once on mount.
- **Messages.** A `message` listener accepts `{ type: "wiki-graph:set-data", data }` from any origin when `isGraphData(data)` passes.
- **Opening articles.** When `window.parent !== window`, the SPA passes an `onOpenArticle` that posts `{ type: "wiki-graph:open-article", slug }` to the parent with target origin `"*"`. Opened directly, it passes nothing.

### Library

[lib.tsx](../src/lib.tsx) imports `./spa.css?inline`, which Vite turns into the compiled stylesheet as a string. The `*.css?inline` module type is declared in `vite-env.d.ts`.

1. `ensureStyles()` appends `<style data-wiki-graph-styles="true">` to `document.head`, unless one already exists.
2. `createRoot(container)` creates a React root in the host element.
3. `resolveData(options)` returns `normalizeGraphData(data)`, `buildGraphDataFromMarkdown(markdownFiles)` or the checked result of `fetch(url)`, in that order of preference.
4. On success it renders `GraphExplorer` inside `StrictMode`, with `storageKey="wiki-graph-embed-mode"`, the given `aliases` and `onOpenArticle`, and the `title` in a `font-display` span as `headerStart`. On failure it renders the error message as centred plain text.
5. The returned handle's `update(data)` renders again with normalized data, and `unmount()` unmounts the React root.

### WikiOS Route

[graph-route.tsx](../../src/client/routes/graph-route.tsx) is a React Router data route. Its loader fetches `/api/graph` and redirects to `/setup` on any HTTP 409, which the server returns for both `SETUP_REQUIRED` and `CONFIG_ERROR`. The component renders `GraphExplorer` in a `fixed inset-0` wrapper with the site config's aliases and labels, and `onOpenArticle` navigating to `/wiki/{slug}`. It passes a site-title `Link` as `headerStart` and a `Link` as `headerEnd` whose text is `navigation.backToWikiLabel` (default "Back to wiki"), shortened to "Back" below 640 px.

## Markdown Pipeline

[markdown-graph.ts](../src/markdown-graph.ts) turns `{ path, content }` files into `GraphData` using the same functions as the server's indexer:

1. `normalizeRelativePath` and `shouldIndexRelativeFile` keep files ending in lower-case `.md` whose own name and folder names don't start with `_` or `.`. The SPA's file readers accept `.MD` too, so such files are read and then discarded here.
2. `titleFromFileName` sets the title, and `parseWikiFrontmatter` splits the frontmatter from the body.
3. `extractBacklinkReferences` and `aggregateBacklinkReferences` count the wikilinks in the raw body, before `prepareWikiMarkdown` rewrites them. `wikilinkPage` (in `wiki-shared.ts`) reduces each target to its page, so `[[note#Section]]` and `[[note#^block]]` count for `note`, and same-page `[[#Section]]` links are skipped.
4. `extractSummary`, a whitespace word count and `deriveCategoryNames` run on the prepared markdown.
5. Backlink counts are summed per target. Edges are kept only when the target page exists, with the link count as the weight.
6. Neighbours are collected in both directions.
7. Pages whose categories are all hidden are removed, along with their edges and neighbour entries.

[tests/spa-markdown-graph.test.ts](../../tests/spa-markdown-graph.test.ts) checks a small fixture and asserts that the pipeline's output for `sample-vault/` matches `spa/public/demo-graph.json`, the server's `/api/graph` output.

## Build and Packaging

| | SPA ([vite.config.ts](../vite.config.ts)) | Library ([vite.lib.config.ts](../vite.lib.config.ts)) |
| --- | --- | --- |
| Entry | `spa/index.html` (Vite `root` is `spa/`) | `spa/src/lib.tsx`, in library mode, ES module format only |
| Output | `dist/spa/`: `index.html`, hashed assets and `demo-graph.json` from `spa/public/` | `dist/spa-lib/wiki-graph.js` |
| Asset URLs | Relative (`base: "./"`), so the folder can be served from any path. Web fonts still load from fonts.googleapis.com at runtime | JavaScript, CSS and the 3D code are inlined. The web fonts still load from fonts.googleapis.com at runtime, which matters for CSP, offline use and privacy review |
| 3D code | Split into its own chunks by the dynamic import | Inlined (`inlineDynamicImports: true`) |
| React mode | Production when `NODE_ENV` is unset or `production`. Vite follows the shell's `NODE_ENV` otherwise, so `development` or `test` ships React's development build | `define` forces `process.env.NODE_ENV` to `"production"`, and `esbuild: { jsxDev: false }` keeps the JSX transform in step |
| Path alias | `@` → `src/` | `@` → `src/` |
| Dev server | `npm run dev:spa`, port 5214 (`WIKIOS_SPA_DEV_PORT`) | None |

- **CSS.** Tailwind CSS 4 runs through `@tailwindcss/postcss` from the repo-root [postcss.config.mjs](../../postcss.config.mjs). It scans for class names from the working directory (the repo root when run through npm), so the SPA's stylesheet also contains classes used elsewhere in the repo. Its Lightning CSS optimization runs only when `NODE_ENV` is `production`. See [Styling](styling.md#build-pipeline) for why declaration order and cascade layers matter there.
- **Types.** The root [tsconfig.json](../../tsconfig.json) includes `spa/`, so `npm run typecheck` covers it, and maps `@/*` to `src/*`.
- **Output sizes** from the current build:

  | File | Minified | Gzipped |
  | --- | --- | --- |
  | `dist/spa/assets/index-*.js` (app, React, sigma, graphology) | 401 kB | 114 kB |
  | `dist/spa/assets/index-*.css` | 41 kB | 8 kB |
  | `dist/spa/assets/3d-force-graph-*.js` | 813 kB | 232 kB |
  | `dist/spa/assets/three.module-*.js` | 566 kB | 142 kB |
  | `dist/spa/assets/three-spritetext-*.js` | 9 kB | 3 kB |
  | `dist/spa-lib/wiki-graph.js` (everything) | 3,097 kB | 682 kB |

## Lifecycle Summary

| Resource | Created | Released |
| --- | --- | --- |
| Sigma instance, its canvases and listeners | 2D view mount | `sigma.kill()` in the effect cleanup |
| 2D animation frame loop | Mount with motion on, or resume | `stop()` on pause or unmount |
| 3D modules | First 3D mount | Kept in the browser's module cache for the life of the page |
| ForceGraph3D instance and render loop | After the 3D modules load | `_destructor()` and `replaceChildren()` in the cleanup |
| 3D timers (drift, fit, orbit resume) | Setup, `enableDrift`, the controls' `end` event | Cleared in the cleanup |
| OrbitControls listeners | Setup | Removed in the cleanup |
| 3D pointer listeners (type, inside and leave tracking) | Setup | Removed in the cleanup |
| `ResizeObserver` | 3D setup | Disconnected in the cleanup |
| Label sprite cache | 3D setup | Dropped with the instance |
| Reduced-motion listener | `GraphExplorer` mount | Removed on unmount |
| SPA `message` listener | `App` mount | Removed on unmount |
| Library stylesheet | First `mountWikiGraph()` | Never; it stays in `document.head` |

## Extension Points

- **Another view,** such as a lighter canvas fallback, only needs to implement `GraphViewProps` and follow the patterns above. `GraphExplorer` would pick it by mode.
- **Focus and hover events** for the host can be added to `GraphExplorer`; see the [Porting Guide](porting-guide.md#adding-focus-events).
- **Theming** is split between CSS variables (the chrome) and JavaScript constants (the canvases); see [Styling](styling.md#retheming).
