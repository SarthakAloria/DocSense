/**
 * app/api/setup/route.ts
 *
 * POST /api/setup
 *
 * Purpose:
 *   One-time (or on-demand) indexing pipeline.  Loads all .txt, .md, and
 *   .pdf files from <project>/documents/, splits them into chunks, generates
 *   OpenAI embeddings for each chunk, and upserts them into a Pinecone index.
 *
 * Response shape (success):
 *   { data: string }   — confirmation message with document count
 *
 * Response shape (error):
 *   { error: string }  — human-readable error message
 *
 * Dependencies:
 *   @pinecone-database/pinecone           — vector store client
 *   langchain/document_loaders/fs/*       — document loaders
 *   @/utils  (createPineconeIndex,
 *             updatePinecone)             — shared helpers
 *   @/config (indexName)                  — shared constants
 *   PINECONE_API_KEY                      — environment variable
 *
 * Notes:
 *   - `runtime = "nodejs"` is required because the LangChain PDF loader
 *     relies on Node.js native modules (fs, stream).
 *   - This route is idempotent: createPineconeIndex checks whether the index
 *     already exists before attempting to create it.
 */

import { NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { DirectoryLoader } from "langchain/document_loaders/fs/directory";
import { createPineconeIndex, updatePinecone } from "@/utils";
import { indexName } from "@/config";

// Force the Node.js runtime; PDF/text loaders require Node-only APIs.
export const runtime = "nodejs";

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /api/setup
 *
 * Flow:
 *  1. Instantiate a DirectoryLoader that handles .txt, .md, and .pdf files.
 *  2. Load all documents from ./documents into LangChain Document objects.
 *  3. Initialise the Pinecone client.
 *  4. createPineconeIndex — create the index if it doesn't exist yet.
 *     Uses text-embedding-ada-002 dimensions (1536).
 *  5. updatePinecone — split each document into 1000-char chunks, embed
 *     them, and upsert all vectors in batches of 100.
 *  6. Return the success message with the document count.
 */
export async function POST() {
  try {
    // Step 1 — Configure the directory loader with supported file types.
    const loader = new DirectoryLoader("./documents", {
      ".txt": (path) => new TextLoader(path),
      ".md":  (path) => new TextLoader(path),  // treat Markdown as plain text
      ".pdf": (path) => new PDFLoader(path),
    });

    // Step 2 — Load all documents; each file may produce multiple Document
    //          objects (e.g. one per PDF page).
    const docs = await loader.load();
    console.log(`Loaded ${docs.length} documents from ./documents`);

    // Step 3 — Initialise the Pinecone client with the API key from env.
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });

    // Step 4 — Dimension matches text-embedding-ada-002 (1536).
    const vectorDimensions = 1536;
    await createPineconeIndex(pinecone, indexName, vectorDimensions);

    // Step 5 — Chunk, embed, and upsert all documents.
    await updatePinecone(pinecone, indexName, docs);

    // Step 6 — Return a success message so the client can update its UI.
    return NextResponse.json({
      data: `Successfully created index and loaded ${docs.length} documents into Pinecone.`,
    });
  } catch (err) {
    // Log the full error server-side for debugging; return a generic message.
    console.error("Setup error:", err);
    return NextResponse.json(
      { error: "Failed to set up index. Check server logs." },
      { status: 500 }
    );
  }
}