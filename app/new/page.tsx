"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StageStepper from "@/components/StageStepper";
import type { Asset } from "@/lib/store";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

type UploadKind = "garment" | "sketch";

export default function NewDesignPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadKind, setUploadKind] = useState<UploadKind>("garment");
  const [sketches, setSketches] = useState<Asset[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/assets")
      .then((r) => r.json())
      .then((data) => {
        const all: Asset[] = data.assets ?? [];
        setSketches(
          all.filter(
            (a) =>
              a.stage === "sketch" && a.imageUrl && a.status !== "discarded"
          )
        );
        setLoadingList(false);
      })
      .catch(() => setLoadingList(false));
  }, []);

  async function createAsset(payload: {
    stage: "garment" | "sketch";
    status: "draft" | "approved";
    imageUrl: string | null;
    parentId?: string | null;
    meta?: Record<string, unknown>;
  }) {
    const res = await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: payload.stage,
        status: payload.status,
        parentId: payload.parentId ?? null,
        imageUrl: payload.imageUrl,
        meta: payload.meta ?? {},
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create asset");
    return data.asset as Asset;
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);

      if (uploadKind === "garment") {
        const asset = await createAsset({
          stage: "garment",
          status: "draft",
          imageUrl: dataUrl,
          meta: { source: "upload", fileName: file.name },
        });
        router.push(`/sketch/${asset.id}`);
      } else {
        const asset = await createAsset({
          stage: "sketch",
          status: "approved",
          imageUrl: dataUrl,
          meta: { source: "upload-sketch", fileName: file.name },
        });
        router.push(`/cad/${asset.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setBusy(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handlePickSketch(sketch: Asset) {
    setBusy(true);
    setError(null);
    try {
      // Reuse as a fresh draft to regenerate/tweak — mirrors "redo this
      // stage" navigation elsewhere rather than skipping straight to CAD.
      const asset = await createAsset({
        stage: "sketch",
        status: "draft",
        imageUrl: sketch.imageUrl,
        parentId: sketch.id,
        meta: { source: "existing-sketch", parentId: sketch.id },
      });
      router.push(`/sketch/${asset.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <StageStepper current="garment" />

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Garment</h1>
        <p className="text-sm text-cream-muted">
          Upload a photo or continue from an existing sketch.
        </p>
      </div>

      {error && <p className="text-sm text-accent-orange">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Upload a photo or sketch */}
        <section className="flex flex-col gap-4 rounded-lg border border-navy-50 bg-navy-100 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Upload an image</h2>
            <p className="text-sm text-cream-muted">
              Tell us what this image is so we route it to the right stage.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="sr-only">What is this image?</legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-navy-50 p-3 text-sm transition hover:border-accent-blue has-[:checked]:border-accent-blue has-[:checked]:bg-accent-blue/10">
              <input
                type="radio"
                name="uploadKind"
                value="garment"
                checked={uploadKind === "garment"}
                onChange={() => setUploadKind("garment")}
                disabled={busy}
                className="mt-0.5 accent-accent-blue"
              />
              <span>
                <span className="block font-medium">Garment photo</span>
                <span className="block text-xs text-cream-muted">
                  Needs AI conversion into a line-art sketch first.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-navy-50 p-3 text-sm transition hover:border-accent-blue has-[:checked]:border-accent-blue has-[:checked]:bg-accent-blue/10">
              <input
                type="radio"
                name="uploadKind"
                value="sketch"
                checked={uploadKind === "sketch"}
                onChange={() => setUploadKind("sketch")}
                disabled={busy}
                className="mt-0.5 accent-accent-blue"
              />
              <span>
                <span className="block font-medium">
                  Already a line sketch
                </span>
                <span className="block text-xs text-cream-muted">
                  Skips straight to CAD Fill — no AI conversion needed.
                </span>
              </span>
            </label>
          </fieldset>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={handleFileChange}
            className="block w-full text-sm text-cream-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent-blue file:px-3 file:py-2 file:text-sm file:font-semibold file:text-navy hover:file:brightness-110 disabled:opacity-40"
          />

          {busy && (
            <p className="text-xs text-cream-muted">Creating asset…</p>
          )}
        </section>

        {/* Start from existing sketch */}
        <section className="flex flex-col gap-4 rounded-lg border border-navy-50 bg-navy-100 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Start from an existing sketch</h2>
            <p className="text-sm text-cream-muted">
              Reuse a previous sketch as the base for a new draft — goes
              straight to CAD Fill.
            </p>
          </div>

          {loadingList ? (
            <p className="text-sm text-cream-muted">Loading sketches…</p>
          ) : sketches.length === 0 ? (
            <p className="text-sm text-cream-muted">
              No sketches yet. Upload a photo to create your first one.
            </p>
          ) : (
            <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
              {sketches.map((sketch) => (
                <button
                  key={sketch.id}
                  type="button"
                  disabled={busy}
                  onClick={() => handlePickSketch(sketch)}
                  className="group relative aspect-square overflow-hidden rounded-md border border-navy-50 bg-navy transition hover:border-accent-blue disabled:opacity-40"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={sketch.imageUrl!}
                    alt="Existing sketch"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-navy/80 px-1 py-0.5 text-[10px] text-cream-muted opacity-0 transition group-hover:opacity-100">
                    Use this
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
