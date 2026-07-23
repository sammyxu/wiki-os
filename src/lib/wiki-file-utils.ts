import { promises as fs } from "node:fs";

// Pure path helpers live in wiki-shared so browser code (e.g. the embeddable
// SPA) can use them without pulling in node:fs; re-exported here so existing
// server/lib imports keep working.
export {
  isIgnoredDirectoryName,
  normalizeRelativePath,
  shouldIndexRelativeFile,
} from "./wiki-shared";

export async function quarantineCorruptIndexFiles(indexDbPath: string, timestampMs: number) {
  const paths = [indexDbPath, `${indexDbPath}-wal`, `${indexDbPath}-shm`];

  for (const filePath of paths) {
    for (let attempts = 0; attempts < 5; attempts++) {
      try {
        await fs.rename(filePath, `${filePath}.corrupt-${timestampMs}`);
        break;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          break;
        }

        if (attempts < 4) {
          await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, attempts)));
          continue;
        }

        if (filePath !== indexDbPath) {
          console.warn(`Failed to quarantine sidecar file ${filePath}:`, error);
          break;
        }

        throw error;
      }
    }
  }
}
