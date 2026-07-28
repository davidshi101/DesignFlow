import { NextRequest, NextResponse } from "next/server";
import { createPrint, getPrints } from "@/lib/printStore";

export async function GET() {
  try {
    const prints = await getPrints();
    return NextResponse.json({ prints });
  } catch (err) {
    console.error("[prints GET]", err);
    return NextResponse.json(
      { error: "Failed to read prints" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { label, dataUrl } = body as { label?: string; dataUrl?: string };

    if (!dataUrl) {
      return NextResponse.json(
        { error: "dataUrl is required" },
        { status: 400 }
      );
    }

    const print = await createPrint(label || "Untitled print", dataUrl);
    return NextResponse.json({ print }, { status: 201 });
  } catch (err) {
    console.error("[prints POST]", err);
    return NextResponse.json(
      { error: "Failed to save print" },
      { status: 500 }
    );
  }
}
