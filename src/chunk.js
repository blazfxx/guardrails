// Split long text into overlapping chunks so that a phrase crossing a boundary is seen whole in at least one chunk.
export function chunkText(text, size = 12000, overlap = 1500) {
  if (text.length <= size) return [text];
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > i + size * 0.6) end = nl + 1;
    }
    out.push(text.slice(i, end));
    if (end >= text.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}
