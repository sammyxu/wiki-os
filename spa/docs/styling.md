# Styling

Every visual style of the mind map: the design tokens, the custom classes, each element of the chrome, the two canvases, and how the CSS is built. Values come from the source. Pixel values were measured in Chrome from the built SPA, at 1280 × 800 unless a phone width (390 × 844) is stated.

## Where Styles Come From

| Layer | Source | Styles |
| --- | --- | --- |
| Design tokens | `:root` in [spa.css](../src/spa.css) (SPA and library) or [globals.css](../../src/client/globals.css) (WikiOS app); the shared values are identical | The chrome |
| Custom classes | `.surface`, `.surface-raised` and `.font-display`, in the same files | The chrome |
| Tailwind utilities | `className` strings in the components, compiled by Tailwind CSS 4 | The chrome |
| Inline styles | `style={{ … }}` in the components | The root background, computed positions, colour dots |
| JavaScript constants | [graph-view-shared.ts](../../src/components/graph-view-shared.ts), [graph-3d-view.tsx](../../src/components/graph-3d-view.tsx) and the sigma settings in [graph-explorer.tsx](../../src/components/graph-explorer.tsx) | The canvases |
| Library defaults | sigma, three.js, 3d-force-graph, three-spritetext | Canvas details the code doesn't set |

The canvases never read CSS variables, and the chrome reads only two canvas-side values: `BG_COLOR` for the root background and `getCategoryColor` for its colour dots. A retheme therefore needs both halves. See [Retheming](#retheming).

## Design Tokens

### Colour Variables

| Variable | Value | Used By |
| --- | --- | --- |
| `--background` | `#faf7f3` | Text on dark buttons in the explorer; the SPA page background. The canvases use the same value through `BG_COLOR` |
| `--foreground` | `#15131a` | Primary text; the active mode button and "Open article →" backgrounds |
| `--muted-foreground` | `#6b6673` | Secondary text, placeholders, inactive mode buttons |
| `--border` | `rgba(21, 19, 26, 0.08)` | Info panel dividers; the default border colour of every element |
| `--secondary` | `#f1ede6` | Close button hover background |
| `--lavender` | `#c4a7e7` | The dot in the stats pill |
| `--teal` | `#85b9c9` | "Open article →" hover background. In the SPA: "Choose a folder" hover, the demo link, the drop zone's drag-over border |
| `--teal-soft` | `#d4ebf2` | Search result hover background (at 50%). In the SPA: the drop zone's drag-over background (at 40%) |
| `--peach-soft` | `#fde5d0` | The SPA's error message background |
| `--ring` | `rgba(132, 185, 201, 0.45)` | The focus ring on the search box and the SPA's URL box. In the WikiOS app, also the global rule `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }` in `globals.css` |
| `--background-tint`, `--card`, `--card-foreground`, `--peach`, `--lavender-soft`, `--primary`, `--primary-foreground`, `--secondary-foreground`, `--muted`, `--accent`, `--accent-foreground` | See [spa.css](../src/spa.css) | Defined for the wider WikiOS theme; the graph doesn't use them |

### Typography

| Token | Value |
| --- | --- |
| `--font-sans` | `"Urbanist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. The body font |
| `--font-display` | `"Playfair Display", "Iowan Old Style", "Palatino Linotype", Georgia, serif`. Used through `.font-display` |

- **Loading.** `spa.css` imports two Google Fonts stylesheets with `display=swap`: Playfair Display at weights 300, 400, 500 and 600, and Urbanist at 300 to 800. Offline, text falls back to the system fonts in the stacks.
- **Weights in use.** Urbanist 400 (body), 500 (`font-medium`) and 600 (`font-semibold`); Playfair Display 300 (`.font-display`).
- **Canvas fonts** are hard-coded strings, not CSS: 2D labels use `500 11px "Urbanist", -apple-system, BlinkMacSystemFont, sans-serif`, and 3D labels use Urbanist, sans-serif at weight 500.

### Motion Tokens

| Token | Value | Note |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | The chrome uses the same curve directly, through `ease-[cubic-bezier(0.23,1,0.32,1)]` |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Not used by the graph |
| Tailwind's default duration | 150 ms | Applies wherever a `transition-*` class has no `duration-*` |
| Tailwind's default curve | `cubic-bezier(0.4, 0, 0.2, 1)` | Applies wherever there is no `ease-*` class |

### Tailwind Scale Values

The utilities resolve against Tailwind 4's default theme. The spacing unit is `--spacing: 0.25rem`, so `p-4` is 1rem (16 px).

| Token | Value | Token | Value |
| --- | --- | --- | --- |
| `text-xs` | 0.75rem, line height 1.333 (12/16 px) | `radius-2xl` (`rounded-2xl`) | 1rem |
| `text-sm` | 0.875rem, line height 1.429 (14/20 px) | `radius-3xl` (`rounded-3xl`) | 1.5rem |
| `text-lg` | 1.125rem, line height 1.556 (18/28 px) | `rounded-full` | 3.40282e38 px (a pill; browsers clamp it) |
| `text-xl` | 1.25rem, line height 1.4 (20/28 px) | `container-xs` (`max-w-xs`) | 20rem |
| `font-medium` / `font-semibold` | 500 / 600 | `leading-relaxed` | 1.625 |
| `tracking-wide` / `tracking-wider` | 0.025em / 0.05em | Breakpoint `sm` | `@media (min-width: 40rem)`, 640 px |

## Custom Classes

In `spa.css` they sit in Tailwind's `components` layer, as below. `globals.css` (the WikiOS app) declares the same three classes outside any layer.

```css
@layer components {
  .font-display {
    font-family: var(--font-display);
    font-weight: 300;
  }

  /* Glass surface for cards — subtle tint with backdrop blur. The prefixed
     backdrop-filter goes first: the production CSS optimizer keeps only the
     last of the pair. */
  .surface {
    background: rgba(255, 255, 255, 0.72);
    -webkit-backdrop-filter: blur(20px) saturate(1.1);
    backdrop-filter: blur(20px) saturate(1.1);
    border: 1px solid rgba(255, 255, 255, 0.8);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.9) inset,
      0 8px 24px -12px rgba(21, 19, 26, 0.12);
  }

  .surface-raised {
    background: rgba(255, 255, 255, 0.88);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
    backdrop-filter: blur(24px) saturate(1.2);
    border: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 1) inset,
      0 12px 40px -16px rgba(21, 19, 26, 0.18),
      0 4px 12px -6px rgba(196, 167, 231, 0.2);
  }
}
```

| Class | Look | Used On |
| --- | --- | --- |
| `.surface` | 72% white over a blurred, slightly saturated backdrop; a white hairline border; a 1 px inner highlight along the top; a soft, tight drop shadow | Stats pill, mode switch, search box, motion button. In the SPA: the "Change data" button, drop zone, URL box and "Load" button |
| `.surface-raised` | Whiter (88%) and blurrier, with a deeper shadow plus a faint lavender glow underneath | Search results, info panel, tooltip. In the SPA: the loading card |
| `.font-display` | Playfair Display, weight 300 | Titles in the header, tooltip, search results, info panel and connections list |

Tailwind emits its layers in the order `theme`, `base`, `components`, `utilities`, and a later layer wins regardless of specificity. A utility on the same element therefore overrides these classes. The SPA's drop zone relies on this: `border-2 border-dashed`, and during drag-over `border-[var(--teal)] bg-[var(--teal-soft)]/40`, replace `.surface`'s border and background.

Unlayered CSS beats every layer. That is why the classes must stay in `components`: written without a layer, `.surface` would win over the drop zone's utilities, and its dashed border and drag-over highlight would never show. In the WikiOS app, where the classes are unlayered, no element currently combines a glass class with a conflicting utility.

## Global Rules

`spa.css` also sets page-level rules, in Tailwind's `base` layer. The library injects them into any page it is mounted on (see the [Porting Guide](porting-guide.md#option-b-load-the-library)). Because they are layered, a host page's own unlayered CSS takes precedence over them.

| Rule | Effect |
| --- | --- |
| `@import "tailwindcss"` | Tailwind's theme variables, its preflight reset (box-sizing, zero margins, unstyled buttons, headings and lists, and so on) and the utilities |
| `* { border-color: var(--border); -webkit-tap-highlight-color: transparent }` | A faint default border colour everywhere, which any `border-*` colour utility can override. No tap flash on mobile |
| `html, body, #root { height: 100% }` | Lets `h-full` chains reach the viewport |
| `body { margin: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans) }` | The page's base look |
| `button, a, [role="button"] { cursor: pointer; touch-action: manipulation }` | A pointer cursor on every control, and no double-tap-zoom delay |
| `::-webkit-scrollbar { width: 0; height: 0; background: transparent }` | Hides scrollbars in Chromium and Safari, including the connections list's |

## Element Reference

Each entry lists the classes from the source, then what they resolve to.

### Explorer Root

- **Classes:** `relative h-full w-full overflow-hidden`, with an inline `background: #faf7f3` (`BG_COLOR`).
- **Inherited text:** Urbanist 16 px, line height 24 px, `#15131a`.

### Header

- **Classes:** `absolute left-0 right-0 top-0 z-10 flex items-center justify-between gap-2 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:gap-3 sm:px-6 sm:pb-4 sm:pt-[calc(env(safe-area-inset-top)+1.25rem)]`.
- **Desktop:** padding 20 px 24 px 16 px (plus the top safe-area inset), gap 12 px. It is 74 px tall with the SPA's content. It has no background and floats over the canvas.
- **Phone:** padding 24 px 16 px 12 px, gap 8 px.
- **Left group:** `min-w-0`, so the title can shrink. The SPA's and the library's title span is `block`, because `truncate` doesn't apply to inline boxes. A long title therefore ends in an ellipsis before the right-hand controls.
- **Right group:** `flex items-center gap-1.5 sm:gap-2.5` (6 px, then 10 px from 640 px).

### Header Slot Content

| Host | `headerStart` | `headerEnd` |
| --- | --- | --- |
| SPA | `font-display block truncate text-lg text-[var(--foreground)] sm:text-xl`: Playfair 300 at 18 px, 20 px from 640 px | "Change data": `surface rounded-full px-3.5 py-2 text-sm font-medium text-[var(--foreground)] transition-[scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] sm:px-4`, 38 px tall, padding 8 × 16 px, 14 px weight 500. Shrinks to 96% while pressed, over 200 ms |
| Library | The `title` option with the same classes as the SPA's title | Nothing |
| WikiOS | Site title link: `font-display text-lg text-[var(--foreground)] sm:text-xl` | "Back to wiki" link with the SPA button's classes, reading "Back" below 640 px |

### Stats Pill

- **Pill:** `surface hidden items-center gap-2 rounded-full px-3.5 py-2 text-xs text-[var(--muted-foreground)] sm:flex`. It is 34 px tall, with padding 8 × 14 px, gap 8 px and 12/16 px text in `#6b6673`. Hidden below 640 px.
- **Dot:** `h-1.5 w-1.5 rounded-full bg-[var(--lavender)]`, a 6 px lavender circle.
- **Numbers:** `font-semibold tabular-nums text-[var(--foreground)]`: weight 600, tabular figures, `#15131a`.
- **Words and the "·" separator** inherit the pill's muted colour.

### Mode Switch

- **Track:** `surface flex items-center gap-0.5 rounded-full p-1`. 34 px tall, padding 4 px, gap 2 px.
- **Buttons:** `rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors duration-200`. Each is 24 px tall with padding 4 × 12 px, 12/16 px weight 600, uppercase, letter spacing 0.3 px. Colours ease over 200 ms on Tailwind's default curve.
- **Pressed** (`aria-pressed="true"`): `bg-[var(--foreground)] text-[var(--background)]`, so `#15131a` with `#faf7f3` text.
- **Not pressed:** `text-[var(--muted-foreground)] hover:text-[var(--foreground)]`, so `#6b6673`, darkening to `#15131a` on hover.

### Search

- **Wrapper:** `absolute left-4 right-4 z-10 sm:right-auto sm:w-64`, with an inline `top: calc(env(safe-area-inset-top) + 4.75rem)` (76 px). On desktop it is 256 px wide at 16 px from the left. On phones it spans the width minus 16 px on each side.
- **Input:** `surface w-full rounded-full px-4 py-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-[var(--ring)]`. 42 px tall, padding 10 × 16 px, 14/20 px text, placeholder in `#6b6673`. While focused, it shows a 2 px solid `--ring` outline, offset 2 px; text inputs match `:focus-visible` however they are focused. It is the same ring the WikiOS app's global rule draws.
- **Results panel:** `surface-raised mt-2 overflow-hidden rounded-2xl`: 8 px below the input, 16 px radius.
- **Result rows:** `block w-full px-4 py-2 text-left text-sm font-display text-[var(--foreground)] transition-colors hover:bg-[var(--teal-soft)]/50`. 36 px tall, padding 8 × 16 px, Playfair 300 at 14/20 px. On hover, the background becomes `#d4ebf2` at 50% (mixed in OKLab where supported), easing over 150 ms.

### Tooltip

- **Box:** `surface-raised pointer-events-none absolute z-20 max-w-xs rounded-2xl px-4 py-2.5`, with inline `left: x + 14px` and `top: y − 12px`. Padding 10 × 16 px, radius 16 px, at most 20rem wide.
- **Title:** `font-display text-[0.95rem] text-[var(--foreground)]`, Playfair 300 at 15.2/22.8 px.
- **Stats row:** `mt-1 flex items-center gap-1.5 text-[0.7rem] font-medium text-[var(--muted-foreground)]`. 4 px below the title, gap 6 px, 11.2 px weight 500.
- **Category row:** `mt-1.5 flex items-center gap-1.5`, 6 px below.
  - The dot is `h-1.5 w-1.5 rounded-full` with inline `backgroundColor: colour` and `boxShadow: 0 0 8px {colour}80` (a glow at 50% alpha).
  - The text is `text-[0.7rem] font-semibold text-[var(--muted-foreground)]`, 11.2 px weight 600.

### Info Panel

- **Panel:** `surface-raised absolute left-4 right-4 z-20 overflow-hidden rounded-3xl sm:left-auto sm:right-4 sm:w-80`, with an inline `top: calc(env(safe-area-inset-top) + 4.75rem)`. On desktop it is 320 px wide at 16 px from the right. On phones it is full width with 16 px margins. Radius 24 px.
- **Header section:** `border-b border-[var(--border)] px-5 py-4`. Padding 16 × 20 px, with a 1 px `rgba(21, 19, 26, 0.08)` divider below.
  - The row is `flex items-start justify-between gap-2`, and the text column is `min-w-0`.
  - **Title:** an `h3` with `truncate font-display text-[1.1rem] text-[var(--foreground)]`, Playfair 300 at 17.6/26.4 px, on one line with an ellipsis.
  - **Meta row:** `mt-1.5 flex items-center gap-2`, 6 px below, gap 8 px.
  - **Category:** `flex items-center gap-1.5`. The dot matches the tooltip's, with the `0 0 8px {colour}80` glow. The label is `text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]`: 10/15 px, weight 600, uppercase, letter spacing 0.5 px.
  - **Counts:** `text-[10px] text-[var(--muted-foreground)]`.
  - **Close button:** `shrink-0 rounded-full p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)]`, with `aria-label="Close"`. 22 px square with padding 4 px, around a 14 px × icon. On hover, it gets a `#f1ede6` circle and dark icon.
- **Summary section:** `border-b border-[var(--border)] px-5 py-3`, padding 12 × 20 px. The text is `line-clamp-3 text-[0.8rem] leading-relaxed text-[var(--muted-foreground)]`: 12.8/20.8 px, at most three lines, then an ellipsis.
- **Open-article section:** `border-b border-[var(--border)] px-5 py-3`. The button is `w-full rounded-full bg-[var(--foreground)] px-4 py-2 text-xs font-semibold text-[var(--background)] transition-[background,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--teal)] active:scale-[0.97]`. Full width, 32 px tall, 12/16 px weight 600, light text on ink. It eases to teal on hover and shrinks to 97% while pressed, both over 200 ms. Tailwind 4 scales with the separate `scale` property, which is why the transition lists `scale` rather than `transform`.
- **Connections list:** `max-h-56 overflow-y-auto` (at most 224 px, then it scrolls).
  - **Heading:** `px-5 pb-1.5 pt-3 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--muted-foreground)]`. Padding 12 px 20 px 6 px, 10.4/15.6 px, weight 600, uppercase, letter spacing 1.66 px.
  - **Rows:** `group flex w-full items-center gap-2.5 px-5 py-2 text-left transition-colors hover:bg-white/60`. 36 px tall, padding 8 × 20 px, gap 10 px, 60% white on hover.
  - **Dot:** `h-1.5 w-1.5 shrink-0 rounded-full transition-all duration-200 group-hover:scale-125`, with inline colour and `boxShadow: 0 0 6px {colour}60` (about 38% alpha). It grows by 25% when its row is hovered.
  - **Title:** `truncate font-display text-[0.85rem] text-[var(--foreground)]`, Playfair 300 at 13.6/20.4 px.

### Motion Button

- **Classes:** `surface absolute bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full text-[var(--foreground)] transition-transform duration-200 active:scale-95`.
- **Result:** a 40 px glass circle, 16 px from the right and bottom (plus the bottom safe-area inset). It shrinks to 95% while pressed, over 200 ms.

### Icons

All icons are inline SVG drawn in `currentColor`:

| Icon | Size | Markup |
| --- | --- | --- |
| Close (×) | 14 × 14, `viewBox="0 0 14 14"`, `fill="none"` on the `<svg>` | `<path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>` |
| Pause | 12 × 12, `viewBox="0 0 12 12"` | Two filled `<rect>`s: `x="2"` and `x="7"`, `y="1.5"`, `width="3"`, `height="9"`, `rx="1"` |
| Play | 12 × 12, `viewBox="0 0 12 12"` | A filled `<path d="M3.2 1.9a1 1 0 0 1 1.52-.86l6.4 4.1a1 1 0 0 1 0 1.72l-6.4 4.1a1 1 0 0 1-1.52-.86z"/>` |

### Canvas Containers

Both views render `<div class="h-full w-full">` and let their library fill it. Sigma adds seven stacked canvases (edges, nodes, edge labels, labels, hovers, hovered nodes and a mouse layer). 3d-force-graph adds one WebGL canvas.

## Inline Styles

| Element | Property | Value |
| --- | --- | --- |
| Explorer root | `background` | `BG_COLOR` (`#faf7f3`) |
| Search wrapper, info panel | `top` | `calc(env(safe-area-inset-top) + 4.75rem)` |
| Tooltip | `left`, `top` | Pointer position relative to the root, plus 14 px across and minus 12 px down |
| Tooltip and info panel category dots | `backgroundColor`, `boxShadow` | The category colour; `0 0 8px {colour}80` |
| Connection dots | `backgroundColor`, `boxShadow` | The neighbour's colour; `0 0 6px {colour}60` |
| Library error message | Several | `display: flex; height: 100%; align-items: center; justify-content: center; font-family: sans-serif; font-size: 14px; color: #6b6673` |

The glows append a two-digit alpha to the colour string, which only works for six-digit hex colours. An alias colour written any other way, such as `rgb(…)`, a colour name or three-digit hex, produces an invalid `box-shadow` and silently loses its glow.

## Layering

| Z-Index | Elements |
| --- | --- |
| 20 | Info panel, tooltip (never shown together) |
| 10 | Header, search, motion button |
| auto | The canvas container, under everything |

On phones, the info panel (20) sits over the search box (10) at the same position.

## Responsive Rules

| Element | Below 640 px | From 640 px |
| --- | --- | --- |
| Header padding | 24 px top, 16 px sides, 12 px bottom | 20 px top, 24 px sides, 16 px bottom |
| Header gap | 8 px | 12 px |
| Header right group gap | 6 px | 10 px |
| SPA or library title | 18 px | 20 px |
| Stats pill | Hidden | Shown |
| Search | `left: 16px; right: 16px` | `left: 16px; width: 256px` |
| Info panel | `left: 16px; right: 16px` | `right: 16px; width: 320px` |
| Host buttons | Padding 8 × 14 px | Padding 8 × 16 px |

- **Viewport, not container.** The breakpoint is a media query on the browser window's width. A narrow embed on a wide screen gets the "From 640 px" layout, and there the 16rem search box and the 20rem info panel can overlap. Container queries would make a port follow the embed's own width.
- **Safe areas.** Only the top and bottom insets are used, and browsers only report them when the page's viewport tag includes `viewport-fit=cover`. The WikiOS app and the SPA set it; a page hosting the library has to set it itself.
- **Hover.** Hover styles only apply on devices that can hover: Tailwind 4 wraps every `hover:` utility in `@media (hover: hover)`.

## Transitions and Feedback

| Element | Transitions | Duration | Curve | Feedback |
| --- | --- | --- | --- | --- |
| Mode buttons | Colours | 200 ms | Tailwind default | Text darkens on hover |
| Search result rows | Colours | 150 ms | Tailwind default | Teal tint on hover |
| Close button | Colours | 150 ms | Tailwind default | Grey circle on hover |
| "Open article →" | Background, scale | 200 ms | `cubic-bezier(0.23, 1, 0.32, 1)` | Teal on hover, 97% while pressed |
| Connection rows | Colours | 150 ms | Tailwind default | White tint on hover |
| Connection dots | All | 200 ms | Tailwind default | 125% while the row is hovered |
| Motion button | Transform | 200 ms | Tailwind default | 95% while pressed |
| Host buttons (SPA, WikiOS) | Scale | 200 ms | `cubic-bezier(0.23, 1, 0.32, 1)` | 96% while pressed |

## 2D Canvas

| Item | Style |
| --- | --- |
| Background | `#faf7f3`, from the root element behind sigma's transparent canvases |
| Node fill | The category colour, or `#c4c0cc` without categories, or `#e8e3d4` when dimmed |
| Node size | `clamp(2.5 + 2 × √backlinks, 2.5, 16)`, scaled by √zoom on screen; 1.3× for the active node |
| Edges | Straight lines of size 0.3 in `#ece5d2`. Sigma's `minEdgeThickness` (1.7 px) applies, and on screen the width is max(size ÷ √ratio, 1.7) px, so at normal zoom every edge is 1.7 px wide |
| Highlighted edges | Size 1 in `rgba(132, 185, 201, 0.85)`; every other edge is hidden while a node is active. They only draw wider than 1.7 px below a camera ratio of about 0.35, so highlighting shows as colour, and as the other edges disappearing, rather than as width |
| Labels | `500 11px "Urbanist", -apple-system, BlinkMacSystemFont, sans-serif` in `#6b6673`. Drawn at x = node x + node size + 3 and y = node y + 11 ÷ 3, for nodes drawn at size 6 or more, thinned by sigma's label grid |
| Active node's label box | Sigma's default hover drawing. A white (`#FFF`) keyhole shape: a circle of radius max(node size, 5.5) + 2 around the node, joined to a rectangle to its right that is (label width + 5) px wide and 15 px tall. It has a black shadow blurred 8 px with no offset, and the label is drawn on top |
| Padding | 60 px kept clear around the fitted graph (`stagePadding`) |
| Cursor | `pointer` over nodes, set on the container |

## 3D Canvas

| Item | Style |
| --- | --- |
| Background | `#faf7f3` (the renderer's clear colour) |
| Lights | 3d-force-graph's defaults: an ambient light `#cccccc` at intensity π, and a directional light `#ffffff` at 0.6π |
| Camera | Perspective, 50° vertical field of view, starting 1,000 units out on the z axis (see [Motion and Rotation](motion.md#simulation)) |
| Nodes | Spheres with 16 × 16 segments, `MeshLambertMaterial`, opacity 1, radius 4 × ∛(1 + 0.55 × backlinks). The category colour, `#c4c0cc` without categories, or `#e8e3d4` when dimmed |
| Links | 1 px GL lines (`LineBasicMaterial`) in `#d8d2c2` at 35% opacity |
| Highlighted links | Tubes 1.2 units across (cylinders with 6 radial segments, `MeshLambertMaterial`) in `#84b9c9`, also at 35% opacity. Transparent links don't write depth |
| Labels | three-spritetext sprites for nodes with 4 or more backlinks: Urbanist at weight 500 in `#6b6673`, 3.4 units tall, no background, border or outline. The texture is drawn at the library's 90 px font size for sharpness. Placed 3.5 units above the sphere, always facing the camera, drawn without depth writes. Opacity 1; while a node is active, 0.15 for every node except the active node and its neighbours |
| Cursors | 3d-force-graph shows a pointer over nodes and links and, once something has been hovered, over empty space too, because all three are clickable. It shows a grab cursor while a node is dragged |
| Library chrome | Its navigation hint is hidden (`showNavInfo(false)`), and its HTML tooltip is switched off (`nodeLabel(() => "")`) |

## Build Pipeline

- **SPA.** `spa.css` goes through `@tailwindcss/postcss`, set up in the repo-root [postcss.config.mjs](../../postcss.config.mjs). Vite emits it as `dist/spa/assets/index-*.css`, linked from `index.html`.
- **Library.** [lib.tsx](../src/lib.tsx) imports `./spa.css?inline`, so the same compiled CSS arrives as a string that `ensureStyles()` puts in a `<style data-wiki-graph-styles>` element.
- **Class detection.** Tailwind scans for class names from the working directory, which is the repo root when you build through npm. The SPA's stylesheet (41 kB) therefore also contains classes used elsewhere in WikiOS. `spa.css` and `globals.css` both have an `@source not` line that skips `spa/docs`, so class names quoted in these docs don't generate CSS. In the SPA the extra classes cost a little size but style nothing. The library, though, injects the whole stylesheet into its host page, so every generated utility (`hidden`, `flex`, `truncate` and the rest) also applies to any host element with the same class name.
- **Optimization.** Tailwind's Lightning CSS pass (minifying, merging and prefixing) runs only when `NODE_ENV` is `production`. That includes a dev server started from a shell that exports `NODE_ENV=production`.

### Prefixed Properties

When the optimizer meets a standard property and its `-webkit-` twin in the same rule, it keeps only the last of the two, plus any prefixes its browser targets need:

| Source Order | Optimized Output |
| --- | --- |
| `backdrop-filter`, then `-webkit-backdrop-filter` | `-webkit-backdrop-filter` only: Chromium and Firefox lose the blur |
| `-webkit-backdrop-filter`, then `backdrop-filter` | Both |
| `backdrop-filter` only | Both (the optimizer adds the prefix) |

`spa.css` and `globals.css` therefore list the prefixed property first. With the other order, every `.surface` and `.surface-raised` element renders in Chromium and Firefox as plain translucent white, without the frosted blur. Keep the prefixed-first order in any CSS you port.

## Retheming

| To Change | Edit |
| --- | --- |
| Chrome colours and fonts | The CSS variables, and `.surface` and `.surface-raised` for the glass |
| Canvas background, grey, dimmed, edge, highlight and label colours | `BG_COLOR`, `DEFAULT_NODE_COLOR`, `DIMMED_NODE_COLOR`, `EDGE_DEFAULT`, `EDGE_HOVER` and `LABEL_COLOR` in [graph-view-shared.ts](../../src/components/graph-view-shared.ts); `EDGE_3D_DEFAULT` and `EDGE_3D_HIGHLIGHT` in [graph-3d-view.tsx](../../src/components/graph-3d-view.tsx) |
| Canvas fonts | `labelFont`, `labelSize` and `labelWeight` in the sigma settings; `fontFace`, `fontWeight` and `textHeight` on the 3D sprites |
| 2D label box | Sigma's default `drawDiscNodeHover` hard-codes the `#FFF` fill and `#000` shadow; pass your own `defaultDrawNodeHover` in the sigma settings |
| Category colours | `TOPIC_COLOR_PALETTE` in [wiki-config.ts](../../src/lib/wiki-config.ts), or aliases per category (see [Data](data.md#colours)) |

A dark theme needs both halves. Changing `--background` alone leaves both canvases light, because they paint `BG_COLOR`.

## SPA Shell

The standalone SPA's own screens, from [app.tsx](../src/app.tsx):

| Element | Classes | Result |
| --- | --- | --- |
| Page | `flex min-h-full items-center justify-center bg-[var(--background)] p-6` | Centred column, 24 px padding |
| Column | `w-full max-w-lg` | Up to 512 px wide |
| Heading "Knowledge Graph" | `font-display text-center text-3xl text-[var(--foreground)]` | Playfair 300, 30/36 px |
| Introduction | `mt-2 text-center text-sm text-[var(--muted-foreground)]` | 14/20 px, 8 px below |
| Loading card | `surface-raised mt-8 rounded-3xl px-6 py-10 text-center text-sm text-[var(--muted-foreground)]` | 24 px radius, padding 40 × 24 px |
| Drop zone | `surface mt-8 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition-colors`, plus `border-transparent`, or `border-[var(--teal)] bg-[var(--teal-soft)]/40` during drag-over | Glass card, 24 px radius, padding 40 × 24 px, with a 2 px dashed border. At rest the border is transparent; during drag-over it turns teal and the card takes a 40% teal-soft tint. This works because `.surface` sits in the components layer (see [Custom Classes](#custom-classes)) |
| Drop zone title | `text-sm font-medium text-[var(--foreground)]` | 14 px weight 500 |
| Drop zone hint | `mt-1 text-xs text-[var(--muted-foreground)]` | 12 px, 4 px below |
| "Choose a folder" | `mt-4 rounded-full bg-[var(--foreground)] px-5 py-2 text-xs font-semibold text-[var(--background)] transition-[background,scale] duration-200 hover:bg-[var(--teal)] active:scale-[0.97]` | 32 px ink pill, 12 px weight 600. Eases to teal on hover and to 97% while pressed |
| URL form | `mt-4 flex gap-2` | 16 px below, 8 px gap |
| URL box | `surface w-full rounded-full px-4 py-2.5 text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-[var(--ring)]` | Same as the search box, focus ring included |
| "Load" | `surface shrink-0 rounded-full px-4 py-2 text-sm font-medium text-[var(--foreground)] active:scale-[0.96]` | 42 px glass pill, 14 px weight 500; the press to 96% is instant |
| Demo link | `text-sm font-medium text-[var(--teal)] underline-offset-4 hover:underline` | Teal 14 px weight 500, underlined on hover |
| Error message | `mt-4 rounded-2xl bg-[var(--peach-soft)] px-4 py-3 text-center text-xs text-[var(--foreground)]` | Peach card, 16 px radius, 12 px text |
| Graph wrapper | `fixed inset-0` | The explorer fills the window |
