# Porting Guide

Four ways to bring the mind map into another application, from least to most work. Each option lists what you get, what to watch for, and how to wire it up. The [QA Checklist](#qa-checklist) at the end applies to all of them.

## Choose an Approach

| Option | Effort | Host Needs | Isolation From the Host Page | What You Can Customize |
| --- | --- | --- | --- | --- |
| [A. Iframe the SPA](#option-a-iframe-the-spa) | Lowest | Static file hosting | Complete (separate document) | Data in, open-article events out |
| [B. Load the library](#option-b-load-the-library) | Low | ES modules; tolerance for global CSS | None: the stylesheet is global | Mount options only |
| [C. Copy the React component](#option-c-copy-the-react-component) | Medium | React 19, a bundler, Tailwind CSS 4 or equivalent CSS | Normal component | Everything |
| [D. Rebuild in another stack](#option-d-rebuild-in-another-stack) | High | Any framework | Normal component | Everything |

## Option A: Iframe the SPA

1. Run `npm run build:spa` and copy `dist/spa/` to any folder on your site. Asset paths are relative, so any sub-path works.
2. Embed it, giving the frame an explicit size:

   ```html
   <iframe
     src="/graph/index.html?data=/api/graph"
     title="Knowledge Graph"
     style="width: 100%; height: 640px; border: 0">
   </iframe>
   ```

3. Handle open-article requests from the frame, checking where they come from:

   ```js
   window.addEventListener("message", (event) => {
     if (event.origin !== "https://graph.example.org") return; // the SPA's origin
     if (event.data?.type === "wiki-graph:open-article") {
       openPage(event.data.slug);
     }
   });
   ```

4. Or push data instead of using `?data=`, naming the frame's origin:

   ```js
   frame.contentWindow.postMessage(
     { type: "wiki-graph:set-data", data: graphData },
     "https://graph.example.org",
   );
   ```

**Watch for:**

- **Same-origin data.** `?data=` uses `fetch()`, so a cross-origin URL needs CORS headers. The WikiOS server sends none.
- **The start screen.** Until data arrives, the SPA shows its drop zone. Prefer `?data=`, or post the data as soon as the frame fires `load`.
- **Fixed chrome.** The header title ("Knowledge Graph"), the "Change data" button, the labels and the category colours can't be changed without editing [app.tsx](../src/app.tsx).
- **Message trust.** The SPA accepts `set-data` from any origin and posts `open-article` with target origin `"*"`. That is acceptable for public, display-only data. If you fork `app.tsx`, check `event.origin` and name the parent's origin.

## Option B: Load the Library

```html
<div id="graph" style="height: 640px"></div>
<script type="module">
  import { mountWikiGraph } from "/assets/wiki-graph.js";

  const handle = mountWikiGraph(document.getElementById("graph"), {
    url: "/api/graph",
    title: "Team Wiki",
    aliases: { research: { color: "#8aa7e1" } },
    onOpenArticle: (slug) => location.assign(`/wiki/${slug}`),
  });

  // Call handle.unmount() when you remove the element.
</script>
```

**Watch for:**

- **Global CSS.** The injected stylesheet restyles the whole page, not just the graph. It includes Tailwind's preflight reset, which removes margins and default heading, list and button styles. It also includes these rules from `spa.css`:
  - `body { margin: 0; background; colour; font-family }`;
  - `html, body, #root { height: 100% }`;
  - a border colour on every element;
  - a pointer cursor on every button and link;
  - `:root` variables with common names such as `--background`, `--foreground` and `--border`;
  - `::-webkit-scrollbar { width: 0; height: 0 }`, which hides scrollbars page-wide in Chromium and Safari;
  - preflight's `img, svg, video, canvas { display: block }`, which can break inline icons in the host page;
  - the Google Fonts `@import`s, so the host page requests fonts.googleapis.com, which a strict Content Security Policy blocks;
  - every utility Tailwind generated, such as `hidden`, `flex` and `truncate`, plus classes for any class-like name found anywhere in the repo outside `spa/docs`. They are live in the host page and apply to host elements with the same class names.

  All of these rules except the `:root` variables sit in Tailwind's cascade layers, so the host page's own unlayered CSS wins over them. That cuts both ways. A host rule such as `button { background: … }` also beats the graph's own layered styles and can restyle its controls.

  To contain it, mount the library in an iframe. Alternatively, fork [lib.tsx](../src/lib.tsx) to inject the CSS into a Shadow DOM root and render there (untested; the theme variables would also need a `:host` selector).
- **One big file.** 3,097 kB (682 kB gzipped), and only partly minified, because Vite doesn't strip whitespace in ES-format library builds. It carries its own copy of React and the entire 3D stack, with no lazy loading.
- **Explicit size.** The element must have a height before mounting.

## Option C: Copy the React Component

### Files

| Copy | Why |
| --- | --- |
| `src/components/graph-explorer.tsx` | The component, the 2D view and the chrome |
| `src/components/graph-3d-view.tsx` | The 3D view |
| `src/components/graph-view-shared.ts` | Colours, motion constants, view contract |
| `src/lib/wiki-shared.ts` | The `GraphData` types. The explorer only needs the graph types |
| `src/lib/wiki-config.ts` | `getTopicColor`, `normalizeTopicKey` and `TopicAliasConfig`. `getTopicColor` depends on private helpers (`getTopicAlias`, `hashString` and `TOPIC_COLOR_PALETTE`), so copy the whole file, or at least those together |
| `spa/src/markdown-graph.ts` with `src/lib/markdown.ts` and `src/lib/wiki-classification.ts` | Only if you want to index markdown in the browser. Copy `wiki-config.ts` and `wiki-shared.ts` whole in that case, because `markdown-graph.ts` and `wiki-classification.ts` import several of their helpers. If you only need `normalizeGraphData` and `isGraphData`, move those two functions into their own file: they depend on nothing but the types, whereas importing them from `markdown-graph.ts` pulls in its other imports |
| The tokens and classes from `spa/src/spa.css` | See [Styling](styling.md) |

The imports use the `@/` alias for `src/`. Map it in your bundler and TypeScript config, or rewrite the paths.

### Dependencies

| Package | Version in WikiOS |
| --- | --- |
| `react`, `react-dom` | 19.2.0 (the version this was built and tested with) |
| `sigma` | ^3.0.2 |
| `graphology` | ^0.26.0 |
| `graphology-types` | ^0.24.8 |
| `graphology-layout-forceatlas2` | ^0.10.1 |
| `3d-force-graph` | ^1.80.0 (brings `three` 0.185) |
| `three-spritetext` | ^1.10.0 |
| `@types/three` (dev) | ^0.185.1 |
| `tailwindcss`, `@tailwindcss/postcss` (dev) | ^4 |

### Wiring

```tsx
import { useMemo } from "react";
import { GraphExplorer } from "./graph/graph-explorer";
import { normalizeGraphData } from "./graph/graph-data"; // normalizeGraphData moved to its own file
import type { GraphData } from "./graph/wiki-shared";

// Defined once, so its reference never changes.
const ALIASES = { research: { color: "#8aa7e1" } };

export function GraphPage({ raw, onOpen }: { raw: GraphData; onOpen: (slug: string) => void }) {
  const data = useMemo(() => normalizeGraphData(raw), [raw]);

  return (
    <div style={{ height: "calc(100vh - 64px)" }}>
      <GraphExplorer
        data={data}
        aliases={ALIASES}
        onOpenArticle={onOpen}
        storageKey="myapp-graph-mode"
      />
    </div>
  );
}
```

1. **Give the parent a definite height.** The explorer fills it.
2. **Keep `data` and `aliases` stable.** A new object on every render rebuilds the view on every render.
3. **Render only in the browser.** In a server-rendering framework, load the component on the client only; in Next.js, for example, use `dynamic(…, { ssr: false })` inside a client component.
4. **Keep the dynamic `import()`s** in `graph-3d-view.tsx`, so the 3D stack (about 1.4 MB) loads only when someone opens 3D.
5. **Decide on navigation.** Pass `onOpenArticle` to open pages. Without it, the explorer moves the focus when someone clicks a neighbour (see [Interactions](interactions.md#the-state-model)).
6. **Pick your own `storageKey`,** so your app's 2D/3D choice doesn't collide with other hosts on the same origin.
7. **Normalize external data** with `normalizeGraphData`, and compute `backlinkCount` from the edges if your data lacks it: `normalizeGraphData` only fills in 0.

### Styling Without Tailwind

The chrome uses Tailwind 4 utility classes, including arbitrary values such as `text-[var(--foreground)]`. Without Tailwind, either compile these classes into a stylesheet with Tailwind's CLI, or replace them with your own CSS using the resolved values in [Styling](styling.md#element-reference). Those values assume Tailwind's preflight reset (`box-sizing: border-box`, `border: 0 solid`, `svg { display: block }`), so carry that over too. The canvases draw without CSS, but they still need their containers sized: both views mount into `h-full w-full` elements inside the root's `relative h-full w-full overflow-hidden`, and without those rules the containers have no size.

## Option D: Rebuild in Another Stack

Only the chrome is React. sigma, graphology, ForceAtlas2 and 3d-force-graph are plain JavaScript libraries that work in any framework, so a Vue, Svelte, Angular or vanilla port can reuse the renderer code almost line for line.

### 2D Skeleton

```ts
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";

// Copy buildGraph, runLayout and createGraphAnimator from graph-explorer.tsx.
const graph = buildGraph(data, aliases);
runLayout(graph);
const sigma = new Sigma(graph, container, settings); // the same settings and reducers
let animator = motionOn ? createGraphAnimator(graph, sigma, { entrance: true }) : null;

sigma.on("enterNode", ({ node }) => { /* set hovered, animator?.holdNode(node), sigma.refresh() */ });
sigma.on("leaveNode", () => { /* clear hovered, animator?.releaseNode(), sigma.refresh() */ });
sigma.on("clickNode", ({ node }) => { /* focus or open, then fly the camera */ });
sigma.on("clickStage", () => { /* clear focus */ });

// Teardown:
animator?.stop();
sigma.kill();
```

The reducers read the current focus and hover through variables that your store updates. Call `sigma.refresh()` after each change.

### 3D Skeleton

```ts
const [{ default: ForceGraph3D }, { default: SpriteText }] = await Promise.all([
  import("3d-force-graph"),
  import("three-spritetext"),
]);
const fg = new ForceGraph3D(container, { controlType: "orbit" });
// Copy the force settings, the configuration chain, the drift force, the stretch,
// the camera fit, the controls wiring and the ResizeObserver from graph-3d-view.tsx.
fg.graphData({ nodes, links });

// Teardown: clear the timers, remove the listeners, disconnect the observer, then:
fg._destructor();
container.replaceChildren();
```

### Checklist for a Faithful Rebuild

1. **Data preparation:** node sizes, colours, neighbour sets in both directions, and label eligibility (4 or more backlinks). See [Features](features.md#visual-encoding) and [Data](data.md).
2. **2D:** the ForceAtlas2 settings, the sigma settings, the reducers, the animator (entrance, drift, label anchoring, hover hold, 30 fps throttle) and camera flights to rest positions. See [Motion and Rotation](motion.md#2d-layout-entrance-and-drift).
3. **3D:** the forces, the lazy loading, the sprite cache, the drift force, the stretch, the custom fit, the orbit with its 6-second resume, flights, and the camera-touched rule. See [Motion and Rotation](motion.md#3d-simulation-drift-and-orbit).
4. **Interaction:** the state model, including the "click again to open" rule. See [Interactions](interactions.md#the-state-model).
5. **Chrome:** the header, search, tooltip, info panel and motion button, with their responsive rules. See [Styling](styling.md#element-reference).
6. **Accessibility:** reduced motion, the pause button, and ideally the gaps listed [below](#accessibility).

## Adding Focus Events

`GraphExplorer` reports nothing but `onOpenArticle`. To let a host follow the focus (for example, to sync a sidebar or the URL), add a prop and an effect. This is a suggested change, not existing code:

```tsx
// In GraphExplorerProps:
onFocusChange?: (slug: string | null) => void;

// In GraphExplorer, after the focusedSlug state:
useEffect(() => {
  onFocusChange?.(focusedSlug);
}, [focusedSlug, onFocusChange]);
```

An effect catches every path that changes the focus: canvas clicks, search, the Connections list, the close button, empty-space clicks and mode switches. Hover can be exposed the same way from `handleHoverNode`.

## Pitfalls

| Pitfall | Symptom | Fix |
| --- | --- | --- |
| `data` or `aliases` rebuilt on every render | The graph re-lays out and flickers constantly | Memoize them |
| Parent without a height | A blank area; sigma is told to tolerate an empty container | Give the parent an explicit height |
| Container resized while motion is paused (2D) | The 2D canvas keeps its old size until the next redraw | Add a `ResizeObserver` that calls `sigma.refresh()`; the 3D view already has one |
| Graph embedded in a scrolling page | The wheel and touch gestures zoom the graph instead of scrolling the page | Leave scrollable margins, or add a click-to-activate overlay |
| Narrow embed on a wide screen | The layout breakpoint is a viewport media query (640 px), so the embed gets the desktop layout, where the 16rem search box and the 20rem panel can overlap | Use container queries in the port, keyed to the explorer's own width |
| Notched phones | Safe-area insets only take effect when the page's viewport tag includes `viewport-fit=cover`. The WikiOS app and the SPA set it; a page hosting the library may not | Add `viewport-fit=cover` to the host page's viewport tag |
| Library in a styled host page | Host margins, fonts, colours and scrollbars change | Use an iframe (or try a Shadow DOM fork) |
| No backlink counts in the data | Tiny nodes. No labels in 3D; in 2D, labels only on the hovered or focused node and its neighbours until zoomed far in | Compute counts from the edges |
| Many graphs on one page | Browsers limit live WebGL contexts, and each 2D view uses several | Mount one graph at a time |
| 3D view mounted before the fonts load | 3D labels keep the fallback font, because each sprite texture is drawn once | Self-host the fonts, or wait for `document.fonts.ready` |
| Large vaults | A long synchronous 2D layout, and no ambient drift above 600 nodes (the 3D orbit still runs) | Precompute positions, or move ForceAtlas2 to a worker (`graphology-layout-forceatlas2/worker` ships with the package) |
| 3D view kept mounted while hidden | Continuous GPU use, because it redraws every frame | Unmount it, or call the instance's `pauseAnimation()` while hidden |
| Alias colours not in six-digit hex | Colour dots lose their glow | Use `#rrggbb` |
| Custom CSS moved out of its layer | Utilities on the same element stop working, as the drop zone's did | Keep global rules in `@layer base` and component classes in `@layer components`, as `spa.css` does |
| Standard property before its `-webkit-` twin | The blur disappears in production builds | Put the prefixed property first, as `spa.css` and `globals.css` do, or omit it |

## Security

- **Keep text as text.** Titles, summaries and categories are rendered as React text, canvas text or WebGL sprites, never as HTML. Keep it that way in a port: note titles are user-written.
- **Keep 3d-force-graph's tooltip off.** Its built-in `nodeLabel` tooltip inserts its string as HTML. The component disables it with `nodeLabel(() => "")`; don't re-enable it with raw titles.
- **Check message origins.** Verify `event.origin` in any `message` listener, and name a specific target origin when posting.
- **Treat `?data=` as untrusted input.** The SPA fetches whatever URL it's given and displays the result as text. Its shape check, `isGraphData`, only confirms that `nodes` and `edges` are arrays and that each node has a string `slug` and `title`. Other malformed fields, such as non-string categories or `null` edges, pass the check and then throw during rendering. With no error boundary, that can blank the SPA, so validate data fully in a port.

## Accessibility

Carry these over:

- Motion starts off under `prefers-reduced-motion: reduce`, and the pause button follows WCAG 2.2.2.
- The mode buttons expose `aria-pressed`, and the motion button and the info panel's close button have spoken labels ("Pause graph motion" or "Resume graph motion", and "Close").
- The search box shows a 2 px `--ring` focus outline instead of the browser's default.

Consider fixing this:

- The canvas can't be reached or used from the keyboard, and screen readers get nothing from it. Offer a list or search-driven alternative.

## QA Checklist

- [ ] The graph loads with your data, and the header counts match your node and edge totals.
- [ ] 2D: the graph blooms out from the centre on load, small nodes drift, and labelled nodes stay still.
- [ ] Hovering highlights the node and its neighbours, shows the tooltip, and stops the node drifting.
- [ ] Clicking a node opens the info panel, flies the camera to it and labels its neighbours.
- [ ] Clicking the focused node or a neighbour calls `onOpenArticle`. Without it, clicking a neighbour moves the focus there.
- [ ] Double-clicking a node in 3D calls `onOpenArticle`, even when the second click lands after the camera has started moving.
- [ ] On a touch screen, tapping a node and then closing its panel leaves no highlight or tooltip behind.
- [ ] Clicking empty space, or ×, clears the focus.
- [ ] Search is case-insensitive, shows at most 8 results, and flies to the chosen node.
- [ ] Choosing an entry under Connections refocuses and flies there.
- [ ] 3D loads on the first switch, unfolds, stretches at about 4.5 s and reframes by about 6.7 s. Don't touch the canvas while checking: even a plain click cancels the reframing.
- [ ] 3D orbits at about 109 s per turn, with the near side sliding right.
- [ ] Dragging in 3D stops the orbit, and it resumes about 6 s after release.
- [ ] Dragging a node in 3D moves it, and the node rejoins the layout when released.
- [ ] The 2D/3D choice survives a reload.
- [ ] Pause stops all motion in both views, and resume restarts it.
- [ ] With the OS set to reduce motion, the graph loads paused.
- [ ] Resizing the window and the container works, including while paused.
- [ ] At phone width: the stats pill is hidden, and the search box and panel are full width.
- [ ] Touch: tap, pan, pinch, and a two-finger twist in 2D.
- [ ] The frosted-glass blur shows in Chrome, Firefox and Safari.
- [ ] No console errors, and unmounting leaves no canvases, timers or listeners behind.
