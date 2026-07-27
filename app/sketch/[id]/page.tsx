"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StageStepper from "@/components/StageStepper";
import ApprovalBar from "@/components/ApprovalBar";
import DownloadLink from "@/components/DownloadLink";
import type { Asset } from "@/lib/store";
import { getFullChain, stageHref } from "@/lib/chain";
import { DEFAULT_SKETCH_PROMPT } from "@/lib/prompts";

export default function SketchPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const router = useRouter();

  const [source, setSource] = useState<Asset | null>(null);
  const [result, setResult] = useState<Asset | null>(null);
  const [chain, setChain] = useState<Asset[]>([]);
  const [backHref, setBackHref] = useState("/");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptText, setPromptText] = useState(DEFAULT_SKETCH_PROMPT);

  const load = useCallback(async () => {
    try {
      const [oneRes, allRes] = await Promise.all([
        fetch(`/api/assets?id=${id}`),
        fetch("/api/assets"),
      ]);
      const oneData = await oneRes.json();
      const allData = await allRes.json();
      const allAssets: Asset[] = allData.assets ?? [];

      const src: Asset | null = oneData.asset ?? null;
      setSource(src);
      setChain(getFullChain(allAssets, id));

      const parent = src?.parentId
        ? allAssets.find((a) => a.id === src.parentId) ?? null
        : null;
      setBackHref(parent ? stageHref(parent) : "/");

      if (src?.meta?.prompt && typeof src.meta.prompt === "string") {
        setPromptText(src.meta.prompt);
      }

      const children: Asset[] = allAssets.filter(
        (a) =>
          a.parentId === id &&
          a.stage === "sketch" &&
          a.status !== "discarded"
      );
      children.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const latest = children[0] ?? null;
      setResult(latest);

      if (latest?.meta?.prompt && typeof latest.meta.prompt === "string") {
        setPromptText(latest.meta.prompt);
      }
    } catch {
      setSource(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-sketch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: id, promptText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setResult(data.asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove() {
    if (!result) return;
    setBusy(true);
    await fetch("/api/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: result.id, status: "approved" }),
    });
    router.push(`/cad/${result.id}`);
  }

  async function handleRegenerate() {
    await handleGenerate();
  }

  async function handleDiscard() {
    setBusy(true);
    const targetId = result?.id ?? id;
    await fetch("/api/assets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: targetId, status: "discarded" }),
    });
    router.push(backHref);
  }

  if (loading) {
    return <p className="text-sm text-cream-muted">Loading…</p>;
  }

  if (!source) {
    return <p className="text-sm text-accent-orange">Asset not found.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <StageStepper current="sketch" chain={chain} />

      <div className="space-y-2">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs font-medium text-cream-muted transition hover:text-cream"
        >
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Line Sketch</h1>
        <p className="text-sm text-cream-muted">
          Source garment → AI line-art flat sketch
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Source */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Source
            </h2>
            {source.imageUrl && (
              <DownloadLink
                dataUrl={source.imageUrl}
                filename={`source-${id.slice(0, 8)}.png`}
              />
            )}
          </div>
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-navy-50 bg-navy-100">
            {source.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={source.imageUrl}
                alt="Source photo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <p className="text-sm text-cream-muted">No source image</p>
            )}
          </div>
        </section>

        {/* Result */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Generated sketch
            </h2>
            {result?.imageUrl && (
              <DownloadLink
                dataUrl={result.imageUrl}
                filename={`sketch-${result.id.slice(0, 8)}.png`}
              />
            )}
          </div>
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-dashed border-navy-50 bg-navy-100">
            {generating ? (
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
                <p className="text-sm text-cream-muted">
                  Generating line sketch with Gemini…
                </p>
              </div>
            ) : result?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.imageUrl}
                alt="Generated sketch"
                className="max-h-full max-w-full object-contain bg-white"
              />
            ) : (
              <p className="px-4 text-center text-sm text-cream-muted">
                No sketch yet — click Generate to create a line-art flat
              </p>
            )}
          </div>
        </section>
      </div>

      <label className="block space-y-2">
        <span className="text-sm font-medium">Prompt</span>
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={3}
          disabled={generating || busy}
          className="w-full resize-y rounded-md border border-navy-50 bg-navy-100 px-3 py-2 text-sm text-cream placeholder:text-cream-muted/60 focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue disabled:opacity-50"
        />
      </label>

      {error && (
        <p className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
          {error}
        </p>
      )}

      {!result || generating ? (
        <div className="border-t border-navy-50 pt-4">
          <button
            type="button"
            disabled={generating || !source.imageUrl}
            onClick={handleGenerate}
            className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-navy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? "Generating…" : result ? "Regenerate" : "Generate"}
          </button>
        </div>
      ) : (
        <ApprovalBar
          disabled={busy || generating}
          onApprove={handleApprove}
          onRegenerate={handleRegenerate}
          onDiscard={handleDiscard}
          approveLabel="Approve → CAD Fill"
        />
      )}
    </div>
  );
}
