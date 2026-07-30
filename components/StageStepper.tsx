import Link from "next/link";
import { STAGE_ORDER, type Stage } from "@/lib/chain";
import type { Asset } from "@/lib/store";

const STEPS: { key: Stage; label: string }[] = [
  { key: "garment", label: "Garment" },
  { key: "sketch", label: "Line Sketch" },
  { key: "cad", label: "CAD Fill" },
  { key: "minibody", label: "Minibody" },
];

const STAGE_INDEX: Record<Stage, number> = Object.fromEntries(
  STAGE_ORDER.map((s, i) => [s, i])
) as Record<Stage, number>;

interface StageStepperProps {
  current: Stage;
  /** Known assets in this design's chain (ancestors + generated descendants) —
   * when provided, any stage present in the chain becomes a clickable link. */
  chain?: Asset[];
}

const ARROW_BASE =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-navy-50 text-cream-muted transition sm:h-8 sm:w-8";
const ARROW_ENABLED = "hover:border-cream-muted hover:text-cream";
const ARROW_DISABLED = "cursor-not-allowed opacity-40";

export default function StageStepper({ current, chain }: StageStepperProps) {
  const currentIndex = STAGE_INDEX[current];

  // Maps each stage to a direct link to its own asset (not stageHref, which
  // resolves to "the input needed to redo this stage" — e.g. a sketch's
  // stageHref is its parentId, not its own id). Iterating root-first means
  // later (forward-walked) entries win, so each stage always points at its
  // most current asset — the same asset each page's own "← Back" link would
  // land you on, kept consistent here for the stepper's own circle-clicks
  // and the prev/next arrows below.
  const hrefByStage = new Map<Stage, string>();
  if (chain) {
    for (const asset of chain) {
      const navStage = STAGE_ORDER.includes(asset.stage as Stage)
        ? (asset.stage as Stage)
        : "minibody"; // legacy "approval"/"done" rows
      const routeStage = navStage === "garment" ? "sketch" : navStage;
      hrefByStage.set(navStage, `/${routeStage}/${asset.id}`);
    }
  }

  const prevHref =
    currentIndex > 0 ? hrefByStage.get(STEPS[currentIndex - 1].key) : undefined;
  const nextHref =
    currentIndex < STEPS.length - 1
      ? hrefByStage.get(STEPS[currentIndex + 1].key)
      : undefined;

  return (
    <nav aria-label="Pipeline stages" className="flex w-full items-center gap-3">
      {prevHref ? (
        <Link
          href={prevHref}
          aria-label="Previous stage"
          className={[ARROW_BASE, ARROW_ENABLED].join(" ")}
        >
          ‹
        </Link>
      ) : (
        <span
          aria-hidden
          className={[ARROW_BASE, ARROW_DISABLED].join(" ")}
        >
          ‹
        </span>
      )}

      <ol className="flex flex-1 items-center gap-0">
        {STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const href = hrefByStage.get(step.key);

          const circleAndLabel = (
            <div className="flex flex-col items-center gap-1.5 sm:gap-2">
              <div
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold transition-colors sm:h-8 sm:w-8 sm:text-xs",
                  isComplete && "bg-accent-blue text-cream",
                  isCurrent && "bg-cream-muted text-navy",
                  !isComplete &&
                    !isCurrent &&
                    "border border-navy-50 bg-transparent text-cream-muted",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {isComplete ? "✓" : index + 1}
              </div>
              <span
                className={[
                  "max-w-[4.5rem] text-center text-[10px] font-medium leading-tight tracking-wide sm:max-w-none sm:text-xs",
                  isCurrent && "text-cream",
                  isComplete && "text-accent-blue",
                  !isComplete && !isCurrent && "text-cream-muted",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {step.label}
              </span>
            </div>
          );

          return (
            <li
              key={step.key}
              className="flex flex-1 items-center last:flex-none"
            >
              {href && !isCurrent ? (
                <Link href={href} className="transition hover:opacity-80">
                  {circleAndLabel}
                </Link>
              ) : (
                circleAndLabel
              )}
              {index < STEPS.length - 1 && (
                <div
                  className={[
                    "mx-1 h-px flex-1 sm:mx-2",
                    index < currentIndex ? "bg-accent-blue" : "bg-navy-50",
                  ].join(" ")}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>

      {nextHref ? (
        <Link
          href={nextHref}
          aria-label="Next stage"
          className={[ARROW_BASE, ARROW_ENABLED].join(" ")}
        >
          ›
        </Link>
      ) : (
        <span
          aria-hidden
          className={[ARROW_BASE, ARROW_DISABLED].join(" ")}
        >
          ›
        </span>
      )}
    </nav>
  );
}
