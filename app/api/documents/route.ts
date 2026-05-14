/**
 * app/api/documents/route.ts
 *
 * GET /api/documents
 *
 * Purpose:
 *   Returns the full directory tree rooted at <project>/documents as a
 *   nested JSON structure.  The client-side DocTree component uses this to
 *   render the file explorer in the sidebar.
 *
 * Response shape:
 *   { documents: DocNode[], exists: boolean }
 *
 *   DocNode = { name, type: "folder"|"file", path, children?: DocNode[] }
 *
 * Notes:
 *   - Paths returned are relative to the documents/ root so they can be
 *     forwarded as query context without exposing the server's filesystem.
 *   - Hidden files/folders (name starts with ".") are excluded.
 *   - `runtime = "nodejs"` is required because `fs` is a Node-only module.
 */

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Force the Node.js runtime; `fs` is not available in the Edge runtime.
export const runtime = "nodejs";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocNode {
  name: string;
  type: "folder" | "file";
  path: string;
  children?: DocNode[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * readDir — Recursively reads a directory and builds a DocNode tree.
 *
 * @param dirPath      - Absolute path of the directory to scan.
 * @param relativePath - Path relative to the documents/ root, used as node.path.
 * @returns            - Flat-at-root array of DocNode (folders contain children).
 */
function readDir(dirPath: string, relativePath: string = ""): DocNode[] {
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    return items
      // Skip hidden files (e.g. .DS_Store, .gitkeep).
      .filter((item) => !item.name.startsWith("."))
      .map((item) => {
        // Build a slash-joined relative path for each item.
        const itemRelative = relativePath
          ? `${relativePath}/${item.name}`
          : item.name;

        if (item.isDirectory()) {
          // Recurse into sub-directories and attach their nodes as children.
          return {
            name: item.name,
            type: "folder" as const,
            path: itemRelative,
            children: readDir(path.join(dirPath, item.name), itemRelative),
          };
        }

        // Leaf node — regular file.
        return {
          name: item.name,
          type: "file" as const,
          path: itemRelative,
        };
      });
  } catch {
    // If the directory cannot be read (permissions, race condition, etc.)
    // return an empty array so the UI shows "No documents found."
    return [];
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/documents
 *
 * Reads the documents/ directory and returns its tree.
 * If the directory does not exist yet, returns an empty array with
 * exists: false so the client can prompt the user to run setup first.
 */
export async function GET() {
  const documentsPath = path.join(process.cwd(), "documents");

  // Guard: directory might not exist before the user runs /api/setup.
  if (!fs.existsSync(documentsPath)) {
    return NextResponse.json({ documents: [], exists: false });
  }

  const documents = readDir(documentsPath);
  return NextResponse.json({ documents, exists: true });
}