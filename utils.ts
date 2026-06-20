/**
 * utils.ts — Shared Pinecone + OpenAI helper functions
 *
 * Exports three async functions consumed by the API routes:
 *
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  createPineconeIndex   →  used by  /api/setup                  │
 *  │  updatePinecone        →  used by  /api/setup                  │
 *  │  queryPineconeVectorStoreAndQueryLLM  →  used by  /api/query   │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 * Dependencies:
 *   @langchain/openai              — OpenAIEmbeddings, ChatOpenAI
 *   @langchain/core/messages       — HumanMessage, SystemMessage
 *   langchain/text_splitter        — RecursiveCharacterTextSplitter
 *   @/config                       — indexName, timeout constants
 *
 * Environment variables required:
 *   OPENAI_API_KEY    — used implicitly by LangChain's OpenAI wrappers
 *   (PINECONE_API_KEY is passed in via the client argument from the routes)
 */

import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { indexName, timeout } from "./config";

// ─── Create Pinecone Index ────────────────────────────────────────────────────

/**
 * createPineconeIndex
 *
 * Checks whether a Pinecone index with the given name already exists.
 * - If it does not exist: creates it as a serverless index (AWS us-east-1)
 *   with cosine similarity and then waits `timeout` ms for it to initialise.
 * - If it already exists: logs a message and returns immediately.
 *
 * @param client          - Pinecone v5 client instance
 * @param indexName       - Name of the index to create / verify
 * @param vectorDimension - Embedding dimension (1536 for text-embedding-ada-002)
 */
export const createPineconeIndex = async (
  client: any,
  indexName: string,
  vectorDimension: number
) => {
  console.log(`Checking "${indexName}"...`);

  // List all existing indexes and check if ours is among them.
  const existingIndexes = await client.listIndexes();
  const exists = existingIndexes.indexes?.some(
    (i: any) => i.name === indexName
  );

  if (!exists) {
    console.log(`Creating "${indexName}"...`);

    // Create a serverless index — no pod sizing needed.
    await client.createIndex({
      name: indexName,
      dimension: vectorDimension,
      metric: "cosine",         // cosine similarity for text embeddings
      spec: {
        serverless: {
          cloud: "aws",
          region: "us-east-1",
        },
      },
    });

    // Pinecone indexes are not immediately queryable after creation;
    // wait for the configured timeout (from config.ts) before proceeding.
    console.log(`Index created. Waiting for initialization...`);
    await new Promise((resolve) => setTimeout(resolve, timeout));
  } else {
    console.log(`"${indexName}" already exists.`);
  }
};

// ─── Update Pinecone with Documents ──────────────────────────────────────────

/**
 * updatePinecone
 *
 * Iterates over an array of LangChain Document objects, splits each one into
 * 1000-character chunks, generates OpenAI embeddings for all chunks, and
 * upserts them into the Pinecone index in batches of 100.
 *
 * Vector metadata includes the original page content (for context retrieval)
 * and the source file path (for provenance).
 *
 * @param client    - Pinecone v5 client instance
 * @param indexName - Name of the target index
 * @param docs      - Array of LangChain Document objects (from DirectoryLoader)
 */
export const updatePinecone = async (
  client: any,
  indexName: string,
  docs: any[]
) => {
  // Retrieve the index handle using Pinecone v5 lowercase .index() API.
  const index = client.index(indexName);
  console.log(`Pinecone index retrieved: ${indexName}`);

  for (const doc of docs) {
    console.log(`Processing document: ${doc.metadata.source}`);
    const txtPath = doc.metadata.source;  // original file path (for metadata)
    const text = doc.pageContent;

    // ── Split ────────────────────────────────────────────────────────────────
    // Chunk the document into 1000-character segments with overlap so that
    // context is not lost at chunk boundaries.
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
    });

    console.log("Splitting text into chunks...");
    const chunks = await textSplitter.createDocuments([text]);
    console.log(`Text split into ${chunks.length} chunks`);

    // ── Embed ────────────────────────────────────────────────────────────────
    // Generate a 1536-dimensional vector for each chunk in a single API call.
    console.log(`Calling OpenAI embeddings for ${chunks.length} chunks...`);
    const embeddingsArray = await new OpenAIEmbeddings().embedDocuments(
      // Normalise newlines so the embedding model sees clean sentences.
      chunks.map((chunk) => chunk.pageContent.replace(/\n/g, " "))
    );

    // ── Upsert ───────────────────────────────────────────────────────────────
    // Send vectors to Pinecone in batches of 100 to stay within the upsert
    // payload size limit and avoid request timeouts.
    console.log(`Upserting ${chunks.length} vectors into Pinecone...`);

    const batchSize = 100;
    let batch: any[] = [];

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];

      // Build the vector record with all metadata needed for retrieval.
      const vector = {
        id: `${txtPath}#${idx}`,   // unique ID: source path + chunk index
        values: embeddingsArray[idx],
        metadata: {
          ...chunk.metadata,
          loc: JSON.stringify(chunk.metadata.loc), // Pinecone requires string metadata
          pageContent: chunk.pageContent,           // stored for context injection
          txtPath: txtPath,                         // source file path
        },
      };

      batch.push(vector);

      // Flush the batch when it reaches batchSize or on the last chunk.
      if (batch.length === batchSize || idx === chunks.length - 1) {
        await index.upsert(batch);
        batch = []; // reset for the next batch
      }
    }
  }
};

// ─── Query Pinecone + LLM ─────────────────────────────────────────────────────

/**
 * queryPineconeVectorStoreAndQueryLLM
 *
 * Full RAG (Retrieval-Augmented Generation) pipeline:
 *
 *  1. Embed the user's question with OpenAI.
 *  2. Query Pinecone for the top-10 most similar document chunks.
 *  3. Concatenate the matched pageContent strings as context.
 *  4. Send [SystemMessage + HumanMessage(context + question)] to ChatOpenAI.
 *  5. Return the model's response as a plain string.
 *
 * If no matches are found, returns a fallback message without calling the LLM.
 *
 * @param client    - Pinecone v5 client instance
 * @param indexName - Name of the index to query
 * @param question  - User's question (may include a document-context prefix)
 * @returns         - AI answer string
 */
export const queryPineconeVectorStoreAndQueryLLM = async (
  client: any,
  indexName: string,
  question: string
): Promise<string> => {
  console.log("Querying Pinecone vector store...");

  // ── Step 1: Get the index handle ─────────────────────────────────────────
  const index = client.index(indexName); // Pinecone v5 lowercase .index()

  // ── Step 2: Embed the question ───────────────────────────────────────────
  const queryEmbedding = await new OpenAIEmbeddings().embedQuery(question);

  // ── Step 3: Retrieve the top-10 nearest neighbours ───────────────────────
  const queryResponse = await index.query({
    topK: 10,               // retrieve up to 10 chunks
    vector: queryEmbedding,
    includeMetadata: true,  // we need pageContent from metadata
  });

  const matchCount = queryResponse.matches?.length ?? 0;
  console.log(`Found ${matchCount} matches...`);

  // ── Early exit: no context found ─────────────────────────────────────────
  if (matchCount === 0) {
    return "No relevant context found in the documents.";
  }

  // ── Step 4: Build the context string from matched chunks ─────────────────
  // Join all matched pageContent values with a blank line separator so the
  // LLM can distinguish between different source passages.
  const context = queryResponse.matches
    .map((match: any) => match.metadata?.pageContent ?? "")
    .filter(Boolean)
    .join("\n\n");

  // ── Step 5: Query the LLM with context + question ────────────────────────
  // temperature: 0 → deterministic, fact-based answers (no creative flair).
  const model = new ChatOpenAI({ temperature: 0 });

  const response = await model.invoke([
    // System prompt: strictly constrain the model to the provided context.
    new SystemMessage(
      "You are a helpful assistant. Answer the question based only on the provided context. " +
        "If the context does not contain enough information, say so clearly."
    ),
    // Human turn: inject the retrieved context and the user's question.
    new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
  ]);

  // ── Step 6: Normalise the response to a plain string ─────────────────────
  // ChatOpenAI can return a string or a structured content array.
  return typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
};