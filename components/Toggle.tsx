interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

/** A styled on/off switch — same boolean contract as a checkbox, just not
 * the native control, since Figma's spec calls for an animated pill switch
 * rather than a checkbox for boolean toggles like CAD's Mirror Print. */
export default function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent-blue" : "bg-navy-50",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-4 w-4 rounded-full bg-cream transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          ].join(" ")}
        />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}
