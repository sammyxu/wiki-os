# Interactions

How people use the graph with a mouse, a touch screen and a keyboard, and what the graph tells its host. Motion that happens by itself is covered in [Motion and Rotation](motion.md).

## The State Model

The explorer has three interaction states. The *active node* is the focused node if there is one, otherwise the hovered node, and all highlighting follows it.

| State | Meaning |
| --- | --- |
| Idle | Nothing highlighted, no panel |
| Hovering | The pointer is over a node; it and its neighbours are highlighted and a tooltip shows |
| Focused | A node was clicked or picked; it stays highlighted, the camera has flown to it and the info panel is open |

Transitions work the same way in both views:

| In State | The User | Result |
| --- | --- | --- |
| Idle | Points at a node | **Hovering.** Highlight and tooltip. In 2D, the node also stops drifting |
| Hovering | Moves off the node | **Idle** |
| Any | Clicks a node that isn't focused and isn't a neighbour of the focused node | **Focused** on that node: info panel, highlight, camera flight |
| Focused | Clicks the focused node again, or one of its neighbours | Calls `onOpenArticle(slug)` for the clicked node. Focus doesn't change. Without `onOpenArticle`, nothing happens |
| Focused | Clicks empty space | **Idle.** The camera stays where it is |
| Focused | Presses × in the info panel | **Idle.** The camera stays where it is |
| Any | Picks a search result | **Focused** on that node, with a camera flight |
| Focused | Clicks an entry under Connections | **Focused** on that neighbour, with a camera flight |
| Focused | Points at another node | The tooltip stays hidden and the highlight stays on the focused node. In 2D, sigma still draws its white label box on the pointed node, and that node stops drifting |
| Any | Presses the 2D or 3D button, even the one already selected | **Idle.** Switching views also mounts the other view |

Only a press that barely moves counts as a click, so panning or orbiting doesn't change the focus. In 2D, a mouse press still clicks after up to 2 move events, and a touch still taps after moving less than 10 px. In 3D, any mouse movement, or a touch that moves more than about 1 px, cancels the click.

In 3D, hover is re-tested every 50 ms at the last known pointer position, and that position isn't reset when the pointer leaves the canvas. Nodes that orbit or drift under a still pointer therefore become hovered by themselves. After the pointer moves onto the header, the search box or the panel, nodes passing under its last canvas position keep showing tooltips.

## Mouse and Trackpad

| Action | 2D | 3D |
| --- | --- | --- |
| Point at a node | Hover, with a pointer cursor | Hover, with a pointer cursor. The cursor is a pointer over empty space too, because empty space is clickable |
| Click a node | Focus or open (see the state model) | Focus or open |
| Click empty space | Clear the focus | Clear the focus |
| Drag empty space | Pan, with a short glide after release | Orbit the camera |
| Click an edge | Counts as empty space, so it clears the focus | Nothing; links have no click handler, so the focus stays |
| Drag a node | Pans the view; nodes can't be moved | Moves the node. The orbit pauses while you drag, and the simulation is re-energized, so neighbours move too. On release the node is unpinned and the drift pulls it back towards its old place. In a view that mounted with motion off, it stays where you dropped it and nothing else reacts |
| Right-click | The browser's context menu (sigma doesn't suppress it) | Nothing |
| Right-drag, or Ctrl, ⌘ or Shift with a left-drag | Right-drag does nothing; with a modifier, a left-drag pans as usual | Pan |
| Middle-drag | Nothing | Zoom |
| Scroll wheel or two-finger scroll | Zoom towards the pointer, ×1.7 per step, eased over 250 ms | Zoom towards the orbit target |
| Double-click | Zoom in ×2.2 towards the pointer over 200 ms. On a node, the first click focuses it, and the zoom then replaces the focus flight, so the camera ends up zoomed towards the pointer rather than centred on the node | Two separate clicks. The first focuses the node and starts a camera flight. The second is tested against the moving scene, so unless the node was already near the centre it usually lands on empty space (clearing the focus) or on another node. It opens the node (if `onOpenArticle` is set) only when the node is still under the pointer |

While the pointer is over either view, the wheel zooms the graph instead of scrolling the page.

## Touch

| Gesture | 2D | 3D |
| --- | --- | --- |
| Tap a node | Focus or open (see the state model) | Focus or open |
| Tap empty space | Clear the focus | Clear the focus |
| One-finger drag | Pan | Orbit |
| Pinch | Zoom; a two-finger gesture also pans and rotates | Zoom, and pan by moving both fingers together |
| Two-finger twist | Rotates the camera (sigma's default touch rotation) | Nothing extra |
| Double-tap | Zoom in ×2.2 | Two separate taps, with the same outcome as a double-click |

- **Touch triggers hover, badly.** In 2D, sigma treats a finger press as hover: the node is highlighted, stops drifting and gets a tooltip. The tooltip, though, is positioned from mouse events, which sigma suppresses on touch, so it appears at the last mouse position (near the top left if there has been none). Nothing clears the hover when the finger lifts. If you tap a node and then close the panel with ×, that node stays highlighted with its tooltip showing. In 3D, hover is re-tested at the last touch point, so nodes moving through it show tooltips.
- A port should ignore hover for touch input and rely on taps and the info panel.
- Both views set `touch-action: none` on their canvases, so a finger on the graph never scrolls the page.

## Keyboard

- **The canvas has no keyboard support** in either view. Nodes can't be reached, selected or opened with the keyboard, and there is no arrow-key panning.
- **Tab reaches the chrome,** in page order: anything focusable in `headerStart`, the 2D and 3D buttons, anything focusable in `headerEnd`, the search box, the search results, the info panel's buttons (close, "Open article →", each connection) and the motion button. Enter or Space activates the focused button.
- **Search** filters as you type. There is no Enter-to-pick; press Tab to reach a result.
- **Escape** doesn't clear the focus; use the close button or click empty space. In the search box, most browsers clear the query on Escape, because it is a `type="search"` field.

## Search in Detail

1. Typing filters `data.nodes` by title, as a case-insensitive substring. An empty or whitespace-only query shows nothing. Otherwise the query is matched as typed, so leading or trailing spaces must match too.
2. Matches are sorted alphabetically (`localeCompare`) and cut to the first 8.
3. Picking a result focuses the node, clears the query and flies the camera to it: zoom ratio 0.3 over 400 ms in 2D, or the standard 900 ms flight in 3D.
4. In 3D, a flight only happens once the 3D libraries have loaded. Until then, picking a result still focuses the node.

## What the Host Receives

The graph never changes the URL or navigates by itself. Its only outgoing signal is the open-article request:

| Trigger | Result |
| --- | --- |
| Pressing "Open article →" in the info panel | `onOpenArticle(slug)` |
| Clicking the focused node again | `onOpenArticle(slug)` |
| Clicking a neighbour of the focused node on the canvas | `onOpenArticle(neighbourSlug)` |

Each host turns that into something different:

| Host | What Happens |
| --- | --- |
| WikiOS app | Navigates to `/wiki/{slug}` |
| Standalone SPA, inside an iframe | Posts `{ type: "wiki-graph:open-article", slug }` to the parent window |
| Standalone SPA, opened directly | Nothing; the button is hidden and the canvas clicks do nothing |
| Library | Calls the `onOpenArticle` option |

Hover and focus changes are internal state, with no callbacks. The [Porting Guide](porting-guide.md#adding-focus-events) shows where to add them.

## Known Quirks

These follow directly from the current code. Keep or fix them deliberately when porting.

1. **Neighbour clicks do nothing without `onOpenArticle`.** Once a node is focused, clicking one of its neighbours on the canvas is treated as "open", which is a no-op when the host provides no handler. In the standalone SPA, people must click empty space first or use the Connections list. A port without navigation should refocus instead.
2. **Double-click is unreliable.** In 2D, the zoom overrides the focus flight. In 3D, the second click usually misses the node, which is already moving towards the centre, and clears the focus instead.
3. **Flights reset the zoom.** The 2D zoom ratio is absolute, so clicking a node zooms back out to 0.5 if you had zoomed in further.
4. **The 2D layout changes on every mount.** Nodes start at random positions, so switching 2D → 3D → 2D, or changing the data, produces a new arrangement.
5. **The 3D orbit circles a fixed point.** A flight aims the camera at the node's position at that moment. The node keeps drifting away from that point while it is focused, and the orbit keeps circling it even after the focus is cleared, until the next flight.
6. **Resuming motion in a 3D view that started paused brings back only the orbit.** The drift returns the next time the 3D view mounts.
7. **On phones, the info panel can hide the focused node.** The camera centres the node, and a full-width panel with a long connections list reaches past the middle of the screen.
8. **"Connections" means three different numbers.** In the header it counts directed edges, in the tooltip it is the backlink count, and in the info panel's "Connections (N)" it counts distinct neighbours. For scientific-method in the sample vault, the tooltip says 42 and the panel says 22.
9. **The info panel's close button has no accessible name.** It contains only an icon.
10. **The search box has no visible focus ring in the SPA and the library.** It uses `outline-none`, and `spa.css` adds no replacement. In the WikiOS app, the global `:focus-visible` rule in `globals.css` draws a 2 px `--ring` outline instead.
11. **The canvas can't be used with a keyboard or a screen reader.** Offer another way to browse, such as a list of pages, if that matters for your audience.
12. **Touch hover sticks.** See [Touch](#touch): a tapped node can stay highlighted, with a misplaced tooltip, after its panel is closed.
13. **3D shows ghost hovers.** Nodes moving under a still pointer, or under the point where the pointer left the canvas, show tooltips by themselves.
14. **The layout switches with the window, not the embed.** The breakpoint is a media query, so a narrow embed on a wide screen gets the desktop layout, where the search box and the panel can overlap.
