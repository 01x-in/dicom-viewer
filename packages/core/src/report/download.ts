/** How long a file's address stays valid after the click: long enough for any browser to start the download. */
export const REVOKE_AFTER_MS = 10_000;

/** Saves a file from the page: the browser asks where to put it, or puts it in the downloads folder. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Not at once: Safari and Firefox may not have begun to read the address when the click returns.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, REVOKE_AFTER_MS);
  }
}
