import { parseWikiFrontmatter, prepareWikiMarkdown } from "@/lib/markdown";
import {
  aggregateBacklinkReferences,
  deriveCategoryNames,
  extractBacklinkReferences,
  extractSummary,
} from "@/lib/wiki-classification";
import {
  DEFAULT_WIKI_OS_CONFIG,
  isTopicHidden,
  resolveWikiOsConfig,
  type WikiOsConfig,
  type WikiOsConfigInput,
} from "@/lib/wiki-config";
import {
  normalizeRelativePath,
  shouldIndexRelativeFile,
  slugFromFileName,
  titleFromFileName,
  type GraphData,
  type GraphEdge,
} from "@/lib/wiki-shared";

export interface MarkdownSourceFile {
  /** Vault-relative path, e.g. "topics/turing-machine.md". */
  path: string;
  content: string;
}

/**
 * Browser-side counterpart of the WikiOS indexer + `/api/graph` query: turns a
 * set of markdown files into the same GraphData the server produces, using the
 * same parsing, link-extraction, and classification code from src/lib.
 */
export function buildGraphDataFromMarkdown(
  files: MarkdownSourceFile[],
  configInput?: WikiOsConfigInput,
): GraphData {
  const config: WikiOsConfig = configInput
    ? resolveWikiOsConfig(configInput)
    : DEFAULT_WIKI_OS_CONFIG;

  interface PipelinePage {
    file: string;
    slug: string;
    title: string;
    summary: string;
    wordCount: number;
    categories: string[];
    outbound: Map<string, number>; // targetSlug -> occurrence count
  }

  const pages: PipelinePage[] = [];
  for (const source of files) {
    const file = normalizeRelativePath(source.path);
    if (!shouldIndexRelativeFile(file)) {
      continue;
    }

    // Mirrors the server indexer: title from the file name, links extracted
    // from the raw body (before wikilinks are rewritten), everything else from
    // the prepared markdown.
    const title = titleFromFileName(file);
    const { data: frontmatter, body } = parseWikiFrontmatter(source.content);
    const prepared = prepareWikiMarkdown(body);
    const references = aggregateBacklinkReferences(extractBacklinkReferences(body));

    const outbound = new Map<string, number>();
    for (const [targetSlug, reference] of references) {
      outbound.set(targetSlug, reference.count);
    }

    pages.push({
      file,
      slug: slugFromFileName(file),
      title,
      summary: extractSummary(prepared.contentMarkdown),
      wordCount: prepared.contentMarkdown.split(/\s+/).filter(Boolean).length,
      categories: deriveCategoryNames(file, title, prepared.contentMarkdown, frontmatter, config),
      outbound,
    });
  }

  const pageBySlug = new Map(pages.map((page) => [page.slug, page]));

  // backlinkCount matches the server: sum of inbound occurrence counts.
  const backlinkCounts = new Map<string, number>();
  const edges: GraphEdge[] = [];
  for (const page of pages) {
    for (const [targetSlug, count] of page.outbound) {
      backlinkCounts.set(targetSlug, (backlinkCounts.get(targetSlug) ?? 0) + count);
      if (pageBySlug.has(targetSlug)) {
        edges.push({ source: page.slug, target: targetSlug, weight: count });
      }
    }
  }

  const neighborMap = new Map<string, Set<string>>();
  for (const edge of edges) {
    const sourceNeighbors = neighborMap.get(edge.source) ?? new Set<string>();
    sourceNeighbors.add(edge.target);
    neighborMap.set(edge.source, sourceNeighbors);

    const targetNeighbors = neighborMap.get(edge.target) ?? new Set<string>();
    targetNeighbors.add(edge.source);
    neighborMap.set(edge.target, targetNeighbors);
  }

  const visibleNodes = pages
    .map((page) => ({
      slug: page.slug,
      title: page.title,
      backlinkCount: backlinkCounts.get(page.slug) ?? 0,
      wordCount: page.wordCount,
      categories: page.categories,
      summary: page.summary,
      neighbors: [...(neighborMap.get(page.slug) ?? [])],
    }))
    .filter(
      (node) =>
        node.categories.length === 0 ||
        node.categories.some((category) => !isTopicHidden(category, config.categories.hidden)),
    );

  const visibleSlugs = new Set(visibleNodes.map((node) => node.slug));

  return {
    nodes: visibleNodes.map((node) => ({
      ...node,
      neighbors: node.neighbors.filter((slug) => visibleSlugs.has(slug)),
    })),
    edges: edges.filter(
      (edge) => visibleSlugs.has(edge.source) && visibleSlugs.has(edge.target),
    ),
  };
}

/** Basic shape check for externally supplied graph JSON. */
export function isGraphData(value: unknown): value is GraphData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { nodes?: unknown; edges?: unknown };
  return (
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    candidate.nodes.every(
      (node) =>
        typeof node === "object" &&
        node !== null &&
        typeof (node as { slug?: unknown }).slug === "string" &&
        typeof (node as { title?: unknown }).title === "string",
    )
  );
}

/** Fills in optional GraphData fields so hand-written JSON can stay minimal. */
export function normalizeGraphData(value: GraphData): GraphData {
  const nodes = value.nodes.map((node) => ({
    slug: node.slug,
    title: node.title,
    backlinkCount: typeof node.backlinkCount === "number" ? node.backlinkCount : 0,
    wordCount: typeof node.wordCount === "number" ? node.wordCount : 0,
    categories: Array.isArray(node.categories) ? node.categories : [],
    summary: typeof node.summary === "string" ? node.summary : "",
    neighbors: Array.isArray(node.neighbors) ? node.neighbors : [],
  }));
  const slugs = new Set(nodes.map((node) => node.slug));
  const edges = (value.edges ?? [])
    .filter((edge) => slugs.has(edge.source) && slugs.has(edge.target))
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: typeof edge.weight === "number" ? edge.weight : 1,
    }));

  // Derive neighbors from edges when the source JSON omitted them.
  const hasNeighbors = nodes.some((node) => node.neighbors.length > 0);
  if (!hasNeighbors && edges.length > 0) {
    const neighborMap = new Map<string, Set<string>>();
    const addNeighbor = (a: string, b: string) => {
      const set = neighborMap.get(a) ?? new Set<string>();
      set.add(b);
      neighborMap.set(a, set);
    };
    for (const edge of edges) {
      addNeighbor(edge.source, edge.target);
      addNeighbor(edge.target, edge.source);
    }
    for (const node of nodes) {
      node.neighbors = [...(neighborMap.get(node.slug) ?? [])];
    }
  }

  return { nodes, edges };
}
