/**
 * app/api/upload/route.ts
 *
 * POST /api/upload
 *
 * Purpose:
 *   Accepts a multipart/form-data upload of one or more files and saves
 *   them to <project>/documents/ (or a chosen subfolder).  The client
 *   calls this endpoint both from the upload button and on drag-and-drop.
 *
 * Request body (FormData):
 *   files     — one or more File objects (required)
 *   subfolder — optional relative subfolder within documents/ (string)
 *
 * Response shape:
 *   {
 *     message: string,          — "{n} of {total} file(s) uploaded."
 *     results: UploadResult[]   — per-file status + optional reason
 *   }
 *
 * Allowed file types:  .pdf  .txt  .md
 * Maximum file size:   20 MB per file
 *
 * Security notes:
 *   - Only whitelisted extensions are accepted.
 *   - The subfolder value is sanitised by stripping ".." segments to
 *     prevent path-traversal attacks.
 *   - `runtime = "nodejs"` is required to use the `fs` module.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Force the Node.js runtime; `fs` is not available in the Edge runtime.
export const runtime = "nodejs";

// ─── Constants ────────────────────────────────────────────────────────────────

/** MIME types the server will accept.  Used for documentation; actual
 *  validation is done via file extension to avoid spoofed Content-Type. */
const ALLOWED_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
];

/** Extensions that map to supported LangChain loaders. */
const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md"];

/** Hard upper-bound for a single uploaded file. */
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

// ─── Types ────────────────────────────────────────────────────────────────────

interface UploadResult {
  name: string;
  status: "ok" | "error";
  reason?: string;
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /api/upload
 *
 * Flow:
 *  1. Parse the multipart form-data.
 *  2. Validate that at least one file was provided.
 *  3. Resolve the target directory (documents/ or documents/<subfolder>),
 *     sanitising the subfolder to prevent path traversal.
 *  4. For each file:
 *       a. Reject unsupported extensions.
 *       b. Reject files over 20 MB.
 *       c. Write the buffer to disk.
 *       d. Record "ok" or "error" in the results array.
 *  5. Return the aggregated results and a summary message.
 */
export async function POST(req: NextRequest) {
  try {
    // Step 1 — Parse the multipart body.
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const subfolder = (formData.get("subfolder") as string) || "";

    // Step 2 — Must have at least one file.
    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided." }, { status: 400 });
    }

    // Step 3 — Resolve the upload target directory.
    const baseDir = path.join(process.cwd(), "documents");
    const targetDir = subfolder
      // Strip ".." path segments to prevent directory traversal.
      ? path.join(baseDir, subfolder.replace(/\.\./g, ""))
      : baseDir;

    // Create the target directory (and any parents) if it doesn't exist yet.
    fs.mkdirSync(targetDir, { recursive: true });

    const results: UploadResult[] = [];

    // Step 4 — Process each uploaded file.
    for (const file of files) {
      const ext = path.extname(file.name).toLowerCase();

      // 4a — Reject unsupported file types.
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        results.push({
          name: file.name,
          status: "error",
          reason: "Unsupported file type. Use .pdf, .txt, or .md",
        });
        continue;
      }

      // 4b — Reject files that exceed the size limit.
      if (file.size > MAX_SIZE_BYTES) {
        results.push({
          name: file.name,
          status: "error",
          reason: "File exceeds 20 MB limit",
        });
        continue;
      }

      // 4c — Convert the File to a Node Buffer and write it to disk.
      const buffer = Buffer.from(await file.arrayBuffer());
      const destPath = path.join(targetDir, file.name);
      fs.writeFileSync(destPath, buffer);

      // 4d — Record success.
      results.push({ name: file.name, status: "ok" });
    }

    // Step 5 — Build a summary and return the full results array.
    const saved = results.filter((r) => r.status === "ok").length;

    return NextResponse.json({
      message: `${saved} of ${files.length} file(s) uploaded.`,
      results,
    });
  } catch (err) {
    // Unexpected errors (disk full, permissions, etc.) are logged server-side.
    console.error("Upload error:", err);
    return NextResponse.json(
      { error: "Upload failed. Check server logs." },
      { status: 500 }
    );
  }
}