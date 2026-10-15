// Downloads use the original File or a Worker-produced Blob, never React row data.
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to acquire the Blob before releasing our reference.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
