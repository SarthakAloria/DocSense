import { NextRequest, NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import { createPineconeIndex, updatePinecone } from "@/utils";
import { indexName } from "@/config";

export const runtime = "nodejs";

const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md"];
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // see note below re: Vercel limits

interface UploadResult {
  name: string;
  status: "ok" | "error";
  reason?: string;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const subfolder = ((formData.get("subfolder") as string) || "").replace(/\.\./g, "");

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided." }, { status: 400 });
    }

    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    await createPineconeIndex(pinecone, indexName, 1536); // no-op if it already exists

    const results: UploadResult[] = [];
    const docsToEmbed: { pageContent: string; metadata: { source: string } }[] = [];

    for (const file of files) {
      const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");

      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        results.push({ name: file.name, status: "error", reason: "Unsupported file type. Use .pdf, .txt, or .md" });
        continue;
      }
      if (file.size > MAX_SIZE_BYTES) {
        results.push({ name: file.name, status: "error", reason: "File exceeds 20 MB limit" });
        continue;
      }

      const relativePath = subfolder ? `${subfolder}/${file.name}` : file.name;

      try {
        let text: string;
        if (ext === ".pdf") {
          // PDFLoader accepts a Blob directly — File extends Blob, so we
          // never touch disk. It tags metadata.source as "blob" by default,
          // so we override it with the real path right after.
          const loader = new PDFLoader(file);
          const pdfDocs = await loader.load();
          text = pdfDocs.map((d) => d.pageContent).join("\n\n");
        } else {
          text = await file.text();
        }

        docsToEmbed.push({ pageContent: text, metadata: { source: relativePath } });
        results.push({ name: file.name, status: "ok" });
      } catch (e) {
        console.error(`Failed to parse ${file.name}:`, e);
        results.push({ name: file.name, status: "error", reason: "Failed to parse file" });
      }
    }

    if (docsToEmbed.length > 0) {
      await updatePinecone(pinecone, indexName, docsToEmbed);
    }

    const saved = results.filter((r) => r.status === "ok").length;

    return NextResponse.json({
      message: `${saved} of ${files.length} file(s) uploaded and indexed.`,
      results,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed. Check server logs." }, { status: 500 });
  }
}