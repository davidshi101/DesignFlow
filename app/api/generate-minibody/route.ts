import { NextRequest, NextResponse } from "next/server";
import { createAsset, getAsset, getAssetImageBuffer } from "@/lib/store";
import { generateMinibody } from "@/lib/gemini";
import { DEFAULT_MINIBODY_PROMPT } from "@/lib/prompts";

export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { assetId, promptText } = body as {
      assetId?: string;
      promptText?: string;
    };

    if (!assetId) {
      return NextResponse.json(
        { error: "assetId is required" },
        { status: 400 }
      );
    }

    const source = await getAsset(assetId);
    if (!source) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    if (!source.imageUrl) {
      return NextResponse.json(
        { error: "Source asset has no imageUrl" },
        { status: 400 }
      );
    }

    const image = await getAssetImageBuffer(assetId);
    if (!image) {
      return NextResponse.json(
        { error: "Source asset's image file is missing on disk" },
        { status: 400 }
      );
    }
    const prompt = promptText?.trim() || DEFAULT_MINIBODY_PROMPT;

    const imageUrl = await generateMinibody(
      image.buffer.toString("base64"),
      image.mimeType,
      prompt
    );

    const asset = await createAsset({
      stage: "minibody",
      parentId: assetId,
      imageUrl,
      status: "draft",
      meta: {
        source: "gemini-minibody",
        prompt,
        sourceAssetId: assetId,
      },
    });

    return NextResponse.json({ asset });
  } catch (err) {
    console.error("[generate-minibody]", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate minibody";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
