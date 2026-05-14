/**
 * app/api/query/route.ts
 *
 * POST /api/query
 *
 * Purpose:
 *   Accepts a plain-text question, embeds it with OpenAI, queries the
 *   Pinecone vector store for the top-10 most relevant document chunks,
 *   and asks the LLM to answer the question using only that context.
 *
 * Request body:
 *   A raw JSON string — the question text (including any document-context
 *   prefix prepended by the client, e.g. "[Context: …]\n<question>").
 *
 * Response shape (success):
 *   { data: string }          — the AI's answer
 *
 * Response shape (error):
 *   { error: string }         — human-readable error message
 *
 * Dependencies:
 *   @pinecone-database/pinecone  — vector store client
 *   @langchain/openai            — embeddings + chat model (via utils.ts)
 *   PINECONE_API_KEY             — environment variable
 */

import { NextRequest, NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import { queryPineconeVectorStoreAndQueryLLM } from "@/utils";
import { indexName } from "@/config";

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * POST /api/query
 *
 * Flow:
 *  1. Parse the raw JSON string body as the question.
 *  2. Validate that it is a non-empty string.
 *  3. Initialise the Pinecone client with the API key from env.
 *  4. Delegate to queryPineconeVectorStoreAndQueryLLM (utils.ts) which:
 *       a. Embeds the question via OpenAI.
 *       b. Runs a topK=10 similarity query against the index.
 *       c. Concatenates the matched chunks as context.
 *       d. Sends context + question to the ChatOpenAI model.
 *  5. Return the answer string wrapped in { data }.
 */
export async function POST(req: NextRequest) {
  try {
    // Step 1 — Parse the body; the client sends a JSON-encoded string.
    const question = await req.json();

    // Step 2 — Validate: must be a non-empty string.
    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "A valid question string is required." },
        { status: 400 }
      );
    }

    // Step 3 — Initialise the Pinecone client.
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });

    // Step 4 — Embed the question, retrieve context, and query the LLM.
    const answer = await queryPineconeVectorStoreAndQueryLLM(
      pinecone,
      indexName,
      question
    );

    // Step 5 — Return the answer.
    return NextResponse.json({ data: answer });
  } catch (err) {
    // Unexpected errors (network, API quota, etc.) are logged server-side
    // and a generic message is returned to avoid leaking internals.
    console.error("Query error:", err);
    return NextResponse.json(
      { error: "Failed to process query. Check server logs." },
      { status: 500 }
    );
  }
}