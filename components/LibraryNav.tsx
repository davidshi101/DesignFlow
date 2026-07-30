import Link from "next/link";
import { STAGE_ORDER, type Stage } from "@/lib/chain";

const LABELS: Record<Stage, string> = {
  garment: "Garment",
  sketch: "Line Sketch",
  cad: "CAD Fill",
  minibody: "Minibody",
};

interface LibraryNavProps {
  current?: Stage;
}

export default function LibraryNav({ current }: LibraryNavProps) {
  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-navy-50 pb-4">
      <Link
        href="/"
        className="text-xs font-medium text-cream-muted transition hover:text-cream"
      >
        ← Dashboard
      </Link>
      <span className="text-navy-50">|</span>
      {STAGE_ORDER.map((stage) => (
        <Link
          key={stage}
          href={`/library/${stage}`}
          className={[
            "rounded-md px-3 py-1.5 text-xs font-medium transition",
            current === stage
              ? "bg-accent-blue text-navy"
              : "text-cream-muted hover:text-cream",
          ].join(" ")}
        >
          {LABELS[stage]}
        </Link>
      ))}
    </nav>
  );
}
