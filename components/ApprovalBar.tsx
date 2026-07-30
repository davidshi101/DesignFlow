"use client";

interface ApprovalBarProps {
  onDownload?: () => void;
  onContinue?: () => void;
  onRegenerate?: () => void;
  onDiscard?: () => void;
  continueLabel?: string;
  regenerateLabel?: string;
  discardLabel?: string;
  disabled?: boolean;
  /** Which button gets the filled/primary treatment when both Download and
   * Continue are present. Defaults to "continue". */
  primaryAction?: "continue" | "download";
}

export default function ApprovalBar({
  onDownload,
  onContinue,
  onRegenerate,
  onDiscard,
  continueLabel = "Continue",
  regenerateLabel = "Generate again",
  discardLabel = "Revert to original",
  disabled = false,
  primaryAction = "continue",
}: ApprovalBarProps) {
  const downloadIsPrimary = primaryAction === "download";
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-navy-50 pt-4">
      {onDownload && (
        <button
          type="button"
          disabled={disabled}
          onClick={onDownload}
          className={[
            "rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
            downloadIsPrimary
              ? "bg-accent-blue text-navy hover:brightness-110"
              : "border border-accent-blue/60 bg-transparent text-accent-blue hover:bg-accent-blue/10",
          ].join(" ")}
        >
          Download
        </button>
      )}
      {onContinue && (
        <button
          type="button"
          disabled={disabled}
          onClick={onContinue}
          className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-navy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {continueLabel}
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          disabled={disabled}
          onClick={onRegenerate}
          className="rounded-md border border-navy-50 bg-transparent px-4 py-2 text-sm font-semibold text-cream-muted transition hover:border-cream-muted hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
        >
          {regenerateLabel}
        </button>
      )}
      {onDiscard && (
        <button
          type="button"
          disabled={disabled}
          onClick={onDiscard}
          className="rounded-md px-4 py-2 text-sm font-medium text-cream-muted transition hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
        >
          {discardLabel}
        </button>
      )}
    </div>
  );
}
