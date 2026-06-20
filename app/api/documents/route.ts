import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import { indexName } from "@/config";

export const runtime = "nodejs";

interface DocNode {
  name: string;
  type: "folder" | "file";
  path: string;
  children?: DocNode[];
}

function buildTree(paths: string[]): DocNode[] {
  const root: DocNode[] = [];

  for (const fullPath of paths) {
    const parts = fullPath.split("/");
    let level = root;
    let currentPath = "";

    parts.forEach((part, i) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;
      let node = level.find((n) => n.name === part);

      if (!node) {
        node = isFile
          ? { name: part, type: "file", path: currentPath }
          : { name: part, type: "folder", path: currentPath, children: [] };
        level.push(node);
      }
      if (!isFile) level = node.children!;
    });
  }

  return root;
}

export async function GET() {
  try {
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

    const existing = await pinecone.listIndexes();
    const exists = existing.indexes?.some((i) => i.name === indexName);
    if (!exists) {
      return NextResponse.json({ documents: [], exists: false });
    }

    const index = pinecone.index(indexName);
    const sourcePaths = new Set<string>();
    let paginationToken: string | undefined;

    do {
      const page = await index.listPaginated({ limit: 100, paginationToken });
      for (const v of page.vectors ?? []) {
        const id = v.id ?? "";
        const lastHash = id.lastIndexOf("#");
        if (lastHash > -1) sourcePaths.add(id.slice(0, lastHash));
      }
      paginationToken = page.pagination?.next;
    } while (paginationToken);

    const documents = buildTree(Array.from(sourcePaths).sort());
    return NextResponse.json({ documents, exists: true });
  } catch (err) {
    console.error("Documents list error:", err);
    return NextResponse.json({ documents: [], exists: false });
  }
}