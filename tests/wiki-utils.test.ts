import { describe, expect, it } from "vitest";

import { prepareWikiMarkdown, transformObsidianLinks } from "../src/lib/markdown";
import { decodeSlugParts, slugFromFileName, titleFromFileName } from "../src/lib/wiki";
import { extractBacklinkReferences } from "../src/lib/wiki-classification";
import { getTopicColor, getTopicEmoji, getTopicLabel } from "../src/lib/wiki-config";

describe("wiki helpers", () => {
  it("builds stable slugs from file names", () => {
    expect(slugFromFileName("LLM Knowledge Bases.md")).toBe("LLM%20Knowledge%20Bases");
    expect(slugFromFileName("slides/The Algorithm - Slides.md")).toBe(
      "slides/The%20Algorithm%20-%20Slides",
    );
    expect(titleFromFileName("LLM Knowledge Bases.md")).toBe("LLM Knowledge Bases");
    expect(titleFromFileName("slides/The Algorithm - Slides.md")).toBe("The Algorithm - Slides");
  });

  it("converts obsidian wikilinks into internal markdown links", () => {
    expect(transformObsidianLinks("See [[LLMs]] and [[Andrej Karpathy|Karpathy]].")).toBe(
      "See [LLMs](/wiki/LLMs) and [Karpathy](/wiki/Andrej%20Karpathy).",
    );
    expect(transformObsidianLinks("Deck: [[slides/The Algorithm - Slides]].")).toBe(
      "Deck: [slides/The Algorithm - Slides](/wiki/slides/The%20Algorithm%20-%20Slides).",
    );
  });

  it("links heading and block wikilinks to their page", () => {
    expect(transformObsidianLinks("See [[LLMs#Scaling|scaling]] and [[LLMs#^quote]].")).toBe(
      "See [scaling](/wiki/LLMs) and [LLMs#^quote](/wiki/LLMs).",
    );
    expect(transformObsidianLinks("Jump to [[#Deep Dive|below]].")).toBe("Jump to below.");
  });

  it("counts heading and block wikilinks as backlinks to their page", () => {
    const references = extractBacklinkReferences(
      "[[notes/beta#Deep Dive]], [[notes/beta#^block]], [[sources/notes/beta]] and [[#Local]].",
    );
    expect(references.map((reference) => reference.targetSlug)).toEqual([
      "notes/beta",
      "notes/beta",
      "notes/beta",
    ]);
  });

  it("keeps an alias's colour and emoji when its label renames the topic", () => {
    const aliases = { ml: { label: "Machine Learning", color: "#abcdef", emoji: "🤖" } };
    expect(getTopicLabel("ml", aliases)).toBe("Machine Learning");
    expect(getTopicColor("Machine Learning", aliases)).toBe("#abcdef");
    expect(getTopicEmoji("Machine Learning", aliases)).toBe("🤖");
    // A key match still wins over a label match.
    expect(
      getTopicColor("Machine Learning", { ...aliases, "machine learning": { color: "#123456" } }),
    ).toBe("#123456");
  });

  it("decodes nested slug parts safely", () => {
    expect(decodeSlugParts(["slides", "The%20Algorithm%20-%20Slides"])).toEqual([
      "slides",
      "The Algorithm - Slides",
    ]);
  });

  it("prepares markdown once for article rendering", () => {
    expect(
      prepareWikiMarkdown(
        "---\n" +
          "tags:\n" +
          "  - demo\n" +
          "---\n\n" +
          "# Title\n\nSee [[LLMs]].\n\n## Deep Dive\n\n```ts\nconst x = 1;\n```",
      ),
    ).toEqual({
      contentMarkdown:
        "See [LLMs](/wiki/LLMs).\n\n## Deep Dive\n\n```ts\nconst x = 1;\n```",
      hasCodeBlocks: true,
      headings: [
        {
          text: "Deep Dive",
          id: "deep-dive",
          level: 2,
        },
      ],
    });
  });
});
