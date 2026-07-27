"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StageStepper from "@/components/StageStepper";
import ApprovalBar from "@/components/ApprovalBar";
import DownloadLink from "@/components/DownloadLink";
import type { Asset } from "@/lib/store";
import { getFullChain } from "@/lib/chain";
import { DEFAULT_MINIBODY_PROMPT } from "@/lib/prompts";

export default function MinibodyPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;

  const [source, setSource] = useState<Asset | null>(null);
  const [result, setResult] = useState<Asset | null>(null);
  const [chain, setChain] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptText, setPromptText] = useState(DEFAULT_MINIBODY_PROMPT);

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

      if (src?.meta?.prompt && typeof src.meta.prompt === "string") {
        setPromptText(src.meta.prompt);
      }

      const children: Asset[] = allAssets.filter(
        (a) =>
          a.parentId === id &&
          a.stage === "minibody" &&
          a.status !== "discarded"
      );
      children.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const latest = children[0] ?? null;
      setResult(latest);
      setDone(latest?.status === "approved");

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
      const res = await fetch("/api/generate-minibody", {
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
    setDone(true);
    setBusy(false);
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
    setBusy(false);
    setResult(null);
  }

  if (loading) {
    return <p className="text-sm text-cream-muted">Loading…</p>;
  }

  if (!source) {
    return <p className="text-sm text-accent-orange">Asset not found.</p>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <StageStepper current="minibody" chain={chain} />

      <div className="space-y-2">
        <Link
          href={`/cad/${id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-cream-muted transition hover:text-cream"
        >
          ← Back to CAD Fill
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Minibody</h1>
        <p className="text-sm text-cream-muted">
          CAD-filled sketch → photorealistic dimensional render
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Source */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              CAD Fill
            </h2>
            {source.imageUrl && (
              <DownloadLink
                dataUrl={source.imageUrl}
                filename={`cad-${id.slice(0, 8)}.png`}
              />
            )}
          </div>
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-navy-50 bg-navy-100">
            {source.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={source.imageUrl}
                alt="CAD-filled sketch"
                className="max-h-full max-w-full object-contain bg-white"
              />
            ) : (
              <p className="text-sm text-cream-muted">No CAD image</p>
            )}
          </div>
        </section>

        {/* Result */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wider text-cream-muted">
              Minibody render
            </h2>
            {result?.imageUrl && (
              <DownloadLink
                dataUrl={result.imageUrl}
                filename={`minibody-${result.id.slice(0, 8)}.png`}
              />
            )}
          </div>
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-dashed border-navy-50 bg-navy-100">
            {generating ? (
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
                <p className="text-sm text-cream-muted">
                  Generating minibody render with Gemini…
                </p>
              </div>
            ) : result?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.imageUrl}
                alt="Generated minibody render"
                className="max-h-full max-w-full object-contain bg-white"
              />
            ) : (
              <p className="px-4 text-center text-sm text-cream-muted">
                No render yet — click Generate to create a minibody
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
          disabled={generating || busy || done}
          className="w-full resize-y rounded-md border border-navy-50 bg-navy-100 px-3 py-2 text-sm text-cream placeholder:text-cream-muted/60 focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue disabled:opacity-50"
        />
      </label>

      {error && (
        <p className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-3 py-2 text-sm text-accent-orange">
          {error}
        </p>
      )}

      {done ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-navy-50 pt-4">
          <p className="text-sm font-medium text-accent-blue">
            Pipeline complete.
          </p>
          <Link
            href="/"
            className="rounded-md px-4 py-2 text-sm font-medium text-cream-muted transition hover:text-cream"
          >
            Back home
          </Link>
        </div>
      ) : !result || generating ? (
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
          approveLabel="Approve"
        />
      )}
    </div>
  );
}
