import { NextRequest, NextResponse } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import { queryPineconeVectorStoreAndQueryLLM } from "@/utils";
import { indexName } from "@/config";

export async function POST(req: NextRequest) {
  try {
    const question = await req.json();

    if (!question || typeof question !== "string") {
      return NextResponse.json(
        { error: "A valid question string is required." },
        { status: 400 }
      );
    }

    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });

    const answer = await queryPineconeVectorStoreAndQueryLLM(
      pinecone,
      indexName,
      question
    );

    return NextResponse.json({ data: answer });
  } catch (err) {
    console.error("Query error:", err);
    return NextResponse.json(
      { error: "Failed to process query. Check server logs." },
      { status: 500 }
    );
  }
}