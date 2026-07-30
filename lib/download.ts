/** Triggers a browser download of a data URL — same underlying mechanism as
 * DownloadLink (an <a download> click), for cases where the URL must be
 * computed at click time (e.g. a live canvas snapshot) rather than passed
 * as a static prop. */
export function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}
