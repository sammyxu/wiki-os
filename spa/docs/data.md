# Data

What the graph needs as input, where that input comes from, and how categories turn into colours. Types are defined in [wiki-shared.ts](../../src/lib/wiki-shared.ts).

## The Contract

```ts
interface GraphNode {
  slug: string;          // unique id: the vault-relative path without ".md", each segment URI-encoded
  title: string;
  backlinkCount: number;
  wordCount: number;
  categories: string[];  // the first entry picks the colour
  summary: string;
  neighbors: string[];   // slugs of connected nodes
}

interface GraphEdge {
  source: string;        // slug
  target: string;        // slug
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

### What Each Field Drives

| Field | Used For |
| --- | --- |
| `slug` | Identity everywhere, neighbour lookups, and the argument to `onOpenArticle`, which receives it in its URI-encoded form |
| `title` | Labels, the tooltip, search matching and the info panel |
| `backlinkCount` | Node size in both views, whether a node gets a label, the tooltip and info panel figures, and the order of the Connections list |
| `wordCount` | The tooltip and info panel |
| `categories` | Colour (first entry), the tooltip (all entries) and the info panel (first entry) |
| `summary` | The info panel, clamped to three lines |
| `neighbors` | The info panel's Connections list only |
| `edges[].source`, `edges[].target` | Drawing, highlighting and neighbour detection in both views |
| `edges[].weight` | The 2D layout only: heavier links pull pages closer. Never drawn |

### Rules the Explorer Relies On

- **Slugs are unique.**
- **Edges to unknown slugs are ignored** by both views.
- **Edges have a direction,** but highlighting and neighbour detection treat them both ways. Two pages that link to each other produce two edges. Both are counted in the header's "connections" figure and drawn on top of each other in 2D.
- **`neighbors` should match the edges.** Highlighting derives neighbours from `edges`, while the info panel lists `neighbors`, so a mismatch makes the two disagree.
- **`GraphExplorer` doesn't validate or fill in data.** The SPA and the library run `normalizeGraphData` first; do the same if you render `GraphExplorer` yourself.
- **Backlink counts matter.** With zero everywhere, every node is drawn at the minimum size. The 3D view then shows no labels at all. The 2D view labels only the hovered or focused node (in its label box) and a focused node's neighbours, until you zoom in below a camera ratio of about 0.17, where every node reaches the label threshold (2.5 ÷ √ratio ≥ 6). If your source has no counts, compute them from the edges before rendering.

## Where Data Comes From

### The WikiOS Server

`GET /api/graph` returns `GraphData` for the configured vault. The WikiOS app's `/graph` route loads it; hosts that sit on the same origin as a WikiOS server can point the SPA's `?data=` or the library's `url` at it. The server sends no CORS headers, so other origins can't read it.

### Markdown in the Browser

`buildGraphDataFromMarkdown(files, config?)` in [markdown-graph.ts](../src/markdown-graph.ts) produces the same output as the server's indexer, using the same `src/lib` functions. [tests/spa-markdown-graph.test.ts](../../tests/spa-markdown-graph.test.ts) checks this against the sample vault. The rules:

| Aspect | Rule |
| --- | --- |
| Files | Only `.md` files. Files and folders whose names start with `_` or `.` are skipped, so `.obsidian/` is ignored |
| Slug | The path without `.md`, with each segment URI-encoded: `My Notes/Big Idea.md` becomes `My%20Notes/Big%20Idea` |
| Title | The file name without `.md`. Frontmatter titles and headings are not used |
| Links | Wikilinks must use vault-relative targets such as `[[folder/note]]`, and matching is case-sensitive on the encoded path. A leading `sources/` is stripped from every target. `#heading` and `^block` suffixes are kept, so `[[note#Section]]` never resolves. Links to pages that don't exist are dropped |
| `weight` | How many times the source page links to the target |
| `backlinkCount` | The sum of those counts over every page that links to this one |
| `summary` | The first line longer than 30 characters that doesn't start with `#`, `-`, `*`, `[` or `!`, cut to 180 characters plus "..." |
| `wordCount` | Whitespace-separated words, counted after frontmatter removal, wikilink rewriting (rewritten links count as words) and removal of a leading `# ` title line |
| `categories` | Up to 5, gathered in this order: values of the frontmatter keys `tags`, `topics`, `topic`, `category` and `categories` (strings are split on commas), then the first two folder names left after dropping generic ones (topic, topics, note, notes, docs, documents, source, sources). Only if neither gives anything: up to three words of 4 or more characters that appear at least twice in the title and body, excluding stop words. Every value is formatted: a leading `#` is dropped, `/`, `\`, `_` and `-` become spaces, and words are capitalized unless already upper case (`machine_learning` becomes "Machine Learning", `ai` becomes "Ai", `AI` stays "AI"). Alias labels then apply, and duplicates are removed |
| Hidden categories | A page whose categories are all hidden (`config.categories.hidden`) is dropped, along with its edges. Backlink counts are computed before that filter, so visible pages keep the backlinks from dropped ones |

Configured frontmatter keys (`categories.frontmatterKeys`) aren't normalized, while the keys read from frontmatter are. Write configured keys in normalized form: lower case, with spaces instead of `-` and `_`. `Subject` or `sub_topic` would never match.

### Hand-Written JSON

Any JSON with `nodes` (each with a string `slug` and `title`) and `edges` arrays passes `isGraphData`. `normalizeGraphData` fills in everything else:

```json
{
  "nodes": [
    { "slug": "alpha", "title": "Alpha", "backlinkCount": 4 },
    { "slug": "beta", "title": "Beta", "categories": ["Ideas"] }
  ],
  "edges": [{ "source": "alpha", "target": "beta" }]
}
```

| Missing Field | Becomes |
| --- | --- |
| `backlinkCount`, `wordCount` | 0 |
| `categories` | `[]` (grey nodes) |
| `summary` | `""` (no summary block) |
| `weight` | 1 |
| `neighbors` | Derived from the edges, but only when no node lists any neighbours |
| Edges with unknown ends | Dropped |

### The Demo Dataset

[spa/public/demo-graph.json](../public/demo-graph.json) is the server's `/api/graph` output for [sample-vault/](../../sample-vault) (99 nodes, 562 edges). The SPA offers it as "Or explore the demo dataset →", and the parity test keeps it in step with the markdown pipeline.

## Colours

Every node takes one colour, from its first category, through `getCategoryColor(categories, aliases)`:

1. **No categories:** grey `#c4c0cc` (`DEFAULT_NODE_COLOR`).
2. **Normalize the name:** trim it, lower-case it, drop a leading `#`, turn `-` and `_` into spaces, and collapse runs of spaces. `#Machine_Learning` and `machine learning` are the same category.
3. **Alias colour:** if `aliases[normalizedName].color` is set, use it. Only the category name is normalized for this lookup, not the alias keys (see [Setting Aliases](#setting-aliases)).
4. **Palette:** otherwise hash the normalized name and take `palette[hash % 8]`. The hash starts at 0 and, for each code point, computes `hash = (hash × 31 + c) >>> 0`, where `c` is the code point's first UTF-16 code unit (`charCodeAt(0)` of the character). A port that iterates UTF-16 code units or full code points instead gives names containing emoji different palette slots.

| Index | Colour | Hex |
| --- | --- | --- |
| 0 | Teal | `#85b9c9` |
| 1 | Peach | `#f4b183` |
| 2 | Lavender | `#c4a7e7` |
| 3 | Sage | `#9cc5a6` |
| 4 | Ochre | `#d4a55c` |
| 5 | Rose | `#e28c8c` |
| 6 | Sea green | `#7db7a1` |
| 7 | Periwinkle | `#8aa7e1` |

- The same category name gets the same colour on every load and in every host.
- With only eight slots, different categories can share a colour. Use aliases to separate the important ones.
- Write alias colours as six-digit hex. The colour dots add an alpha suffix for their glow, which doesn't work with other formats (see [Styling](styling.md#inline-styles)).

### Setting Aliases

| Host | How |
| --- | --- |
| WikiOS app | `categories.aliases` in `wiki-os.config.ts` |
| Library | The `aliases` option of `mountWikiGraph()` |
| React | The `aliases` prop of `GraphExplorer` |
| Standalone SPA | Not configurable |

```ts
const aliases = {
  "space": { color: "#7db7a1" },
  "people": { color: "#8aa7e1", label: "People", emoji: "🧑" },
};
```

- **Key normalization.** WikiOS normalizes the keys in `wiki-os.config.ts` (and in the `configInput` of `buildGraphDataFromMarkdown`) when it loads them. The React prop and the library option are used exactly as given, so write their keys already normalized: lower case, no leading `#`, and spaces instead of `-` and `_`, such as `machine learning`. A key like `Machine_Learning` silently falls back to the palette.
- **Labels rename categories.** The renderer reads only `color`, but during indexing an alias `label` renames the category. The colour is then looked up under the new name. With `ml: { label: "Machine Learning", color: "#abcdef" }`, the category becomes "Machine Learning" and takes a palette colour, not `#abcdef`. Repeat the colour under the label's normalized key, as in `"machine learning": { color: "#abcdef" }`.
- **Emoji.** `emoji` is used elsewhere in WikiOS, not by the graph.
