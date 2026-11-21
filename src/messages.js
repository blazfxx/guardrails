// Turn an OpenAI- or Anthropic-style request into a flat list of { role, text }.
function partText(p) {
  if (p == null) return '';
  if (typeof p === 'string') return p;
  if (Array.isArray(p)) return p.map(partText).filter(Boolean).join('\n');
  if (typeof p !== 'object') return String(p);
  if (p.type === 'image' || p.type === 'image_url') return '';
  let out = typeof p.text === 'string' ? p.text : '';
  if (p.content != null) out += (out ? '\n' : '') + partText(p.content);
  return out;
}

export function extractMessages({ system, messages = [] }) {
  const out = [];
  const sys = partText(system);
  if (sys.trim()) out.push({ role: 'system', text: sys });
  for (const m of messages) {
    const text = partText(m && m.content);
    if (text.trim()) out.push({ role: String(m.role || 'user'), text });
  }
  return out;
}
