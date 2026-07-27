interface DownloadLinkProps {
  dataUrl: string;
  filename: string;
  label?: string;
  className?: string;
}

const DEFAULT_CLASS =
  "inline-flex items-center gap-1 text-xs font-medium text-accent-blue transition hover:brightness-110";

/** Data URLs support the `download` attribute natively — no blob conversion needed. */
export default function DownloadLink({
  dataUrl,
  filename,
  label = "Download",
  className = DEFAULT_CLASS,
}: DownloadLinkProps) {
  return (
    <a href={dataUrl} download={filename} className={className}>
      {label}
    </a>
  );
}
