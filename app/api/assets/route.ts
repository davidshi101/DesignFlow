import { NextRequest, NextResponse } from "next/server";
import {
  getAsset,
  getAssets,
  createAsset,
  updateAsset,
  type AssetStage,
  type AssetStatus,
} from "@/lib/store";

/** GET /api/assets — list all; GET /api/assets?id=… — fetch one */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");

    if (id) {
      const asset = await getAsset(id);
      if (!asset) {
        return NextResponse.json({ error: "Asset not found" }, { status: 404 });
      }
      return NextResponse.json({ asset });
    }

    const assets = await getAssets();
    return NextResponse.json({ assets });
  } catch (err) {
    console.error("[assets GET]", err);
    return NextResponse.json(
      { error: "Failed to read assets" },
      { status: 500 }
    );
  }
}

/** POST /api/assets — create one */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const asset = await createAsset({
      stage: (body.stage as AssetStage) || "sketch",
      parentId: body.parentId ?? null,
      imageUrl: body.imageUrl ?? null,
      status: (body.status as AssetStatus) || "draft",
      meta: body.meta ?? {},
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    console.error("[assets POST]", err);
    return NextResponse.json(
      { error: "Failed to create asset" },
      { status: 500 }
    );
  }
}

/** PATCH /api/assets — update one (used by stage pages) */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, ...updates } = body as { id?: string } & Record<string, unknown>;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const asset = await updateAsset(id, updates);
    if (!asset) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }
    return NextResponse.json({ asset });
  } catch (err) {
    console.error("[assets PATCH]", err);
    return NextResponse.json(
      { error: "Failed to update asset" },
      { status: 500 }
    );
  }
}
