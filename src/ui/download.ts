/** Saves bytes as a file in the browser's downloads. */
export function downloadBytes(name: string, bytes: Uint8Array | ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
