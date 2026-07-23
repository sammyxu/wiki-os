import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { buildGraphDataFromMarkdown } from "../spa/src/markdown-graph";
import type { GraphData } from "../src/lib/wiki-shared";

function readVaultFiles(root: string) {
  const files: { path: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else if (name.endsWith(".md")) {
        files.push({ path: relative(root, fullPath), content: readFileSync(fullPath, "utf8") });
      }
    }
  };
  walk(root);
  return files;
}

describe("spa markdown graph pipeline", () => {
  it("builds the expected graph from a small fixture", () => {
    const data = buildGraphDataFromMarkdown([
      {
        path: "notes/alpha.md",
        content:
          "---\ntitle: Alpha\ntags:\n  - demo\n---\n\n# Alpha\n\nAlpha links to [[notes/beta]] twice: [[notes/beta|Beta]]. And to a [[missing/page]].\n",
      },
      {
        path: "notes/beta.md",
        content: "# Beta\n\nBeta links back to [[notes/alpha]].\n",
      },
      {
        path: ".obsidian/config.md",
        content: "# Hidden\n\nShould be ignored entirely: [[notes/alpha]].\n",
      },
    ]);

    expect(data.nodes.map((n) => n.slug).sort()).toEqual(["notes/alpha", "notes/beta"]);

    const alpha = data.nodes.find((n) => n.slug === "notes/alpha");
    const beta = data.nodes.find((n) => n.slug === "notes/beta");
    // Backlink counts sum occurrence counts, like the server indexer.
    expect(alpha?.backlinkCount).toBe(1);
    expect(beta?.backlinkCount).toBe(2);
    expect(alpha?.neighbors).toEqual(["notes/beta"]);

    // Edges only exist where the target page exists; weights are occurrence counts.
    expect(data.edges).toEqual(
      expect.arrayContaining([
        { source: "notes/alpha", target: "notes/beta", weight: 2 },
        { source: "notes/beta", target: "notes/alpha", weight: 1 },
      ]),
    );
    expect(data.edges).toHaveLength(2);
  });

  it("matches the server-generated graph for the sample vault", () => {
    // spa/public/demo-graph.json is exported from the server's /api/graph for
    // the bundled sample vault. If this test fails after editing the sample
    // vault, regenerate the demo JSON (see spa/README.md) — keeping the SPA
    // demo dataset in sync is the point of this check.
    const files = readVaultFiles(join(__dirname, "..", "sample-vault"));
    const pipeline = buildGraphDataFromMarkdown(files);
    const server = JSON.parse(
      readFileSync(join(__dirname, "..", "spa", "public", "demo-graph.json"), "utf8"),
    ) as GraphData;

    expect(pipeline.nodes.length).toBe(server.nodes.length);

    const edgeKey = (e: GraphData["edges"][number]) => `${e.source}->${e.target}:${e.weight}`;
    expect(new Set(pipeline.edges.map(edgeKey))).toEqual(new Set(server.edges.map(edgeKey)));

    const nodeKey = (n: GraphData["nodes"][number]) =>
      `${n.slug}|${n.title}|${n.backlinkCount}|${n.wordCount}|${[...n.categories].sort().join(",")}|${n.summary}`;
    expect(new Set(pipeline.nodes.map(nodeKey))).toEqual(new Set(server.nodes.map(nodeKey)));

    const neighborsBySlug = new Map(server.nodes.map((n) => [n.slug, new Set(n.neighbors)]));
    for (const node of pipeline.nodes) {
      expect(new Set(node.neighbors)).toEqual(neighborsBySlug.get(node.slug));
    }
  });
});
