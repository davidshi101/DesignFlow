import Link from "next/link";
import { STAGE_ORDER, stageHref, type Stage } from "@/lib/chain";
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

export default function StageStepper({ current, chain }: StageStepperProps) {
  const currentIndex = STAGE_INDEX[current];

  const hrefByStage = new Map<Stage, string>();
  if (chain) {
    for (const asset of chain) {
      const navStage = STAGE_ORDER.includes(asset.stage as Stage)
        ? (asset.stage as Stage)
        : "minibody"; // legacy "approval"/"done" rows
      hrefByStage.set(navStage, stageHref(asset));
    }
  }

  return (
    <nav aria-label="Pipeline stages" className="w-full">
      <ol className="flex items-center gap-0">
        {STEPS.map((step, index) => {
          const isComplete = index < currentIndex;
          const isCurrent = index === currentIndex;
          const href = hrefByStage.get(step.key);

          const circleAndLabel = (
            <div className="flex flex-col items-center gap-1.5 sm:gap-2">
              <div
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold transition-colors sm:h-8 sm:w-8 sm:text-xs",
                  isComplete && "bg-accent-blue text-navy",
                  isCurrent &&
                    "bg-accent-orange text-navy ring-2 ring-accent-orange/40",
                  !isComplete &&
                    !isCurrent &&
                    "bg-navy-50 text-cream-muted",
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
    </nav>
  );
}
