"use client";

import { useEffect, useState } from "react";

/** Per browser tab/session — shows again each time the site is freshly opened. */
const STORAGE_KEY = "designflow_session_started";

export default function WelcomeGate({ children }: { children: React.ReactNode }) {
  const [started, setStarted] = useState<boolean | null>(null);

  useEffect(() => {
    // Drop the old forever-flag so prior visits don't skip the welcome.
    try {
      localStorage.removeItem("designflow_visited");
    } catch {
      /* ignore */
    }
    setStarted(sessionStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  if (started === null) return null;

  if (!started) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight">Welcome to DesignFlow</h1>
          <p className="mx-auto max-w-md text-sm text-cream-muted">
            AI proposes a garment concept at every stage of the pipeline — a human always decides.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(STORAGE_KEY, "1");
            setStarted(true);
          }}
          className="rounded-lg bg-accent-blue px-6 py-3 text-sm font-semibold text-navy transition hover:brightness-110"
        >
          Get Started →
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
