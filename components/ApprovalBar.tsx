"use client";

interface ApprovalBarProps {
  onApprove?: () => void;
  onRegenerate?: () => void;
  onDiscard?: () => void;
  approveLabel?: string;
  disabled?: boolean;
}

export default function ApprovalBar({
  onApprove,
  onRegenerate,
  onDiscard,
  approveLabel = "Approve",
  disabled = false,
}: ApprovalBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-navy-50 pt-4">
      <button
        type="button"
        disabled={disabled}
        onClick={onApprove}
        className="rounded-md bg-accent-blue px-4 py-2 text-sm font-semibold text-navy transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {approveLabel}
      </button>
      {onRegenerate && (
        <button
          type="button"
          disabled={disabled}
          onClick={onRegenerate}
          className="rounded-md border border-accent-orange/60 bg-transparent px-4 py-2 text-sm font-semibold text-accent-orange transition hover:bg-accent-orange/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Regenerate
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={onDiscard}
        className="rounded-md px-4 py-2 text-sm font-medium text-cream-muted transition hover:text-cream disabled:cursor-not-allowed disabled:opacity-40"
      >
        Discard
      </button>
    </div>
  );
}
