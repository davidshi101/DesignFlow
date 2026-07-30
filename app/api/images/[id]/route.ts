import { NextResponse } from "next/server";
import { getAssetImageBuffer } from "@/lib/store";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const image = await getAssetImageBuffer(params.id);
  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(image.buffer), {
    headers: { "Content-Type": image.mimeType },
  });
}
