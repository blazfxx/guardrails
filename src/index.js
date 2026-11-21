import { chunkText } from './chunk.js';
import { extractMessages } from './messages.js';
import { createBreaker } from './breaker.js';
import { mapLimit, withTimeout } from './limit.js';
import { createSecureStore } from './store.js';

/**
 * createGuard(options)
 *   local(text)  -> Promise<number>   score in [0, 1], higher = more likely an attack (optional)
 *   judge(text)  -> Promise<{ verdict: 'safe' | 'borderline' | 'unsafe', reason?: string }>
 *   store        -> verdict cache (default: createSecureStore(): HMAC-hashed keys, AES-256-GCM encrypted values, never the text)
 *   localSafeBelow / localBlockAbove -> local score cut-offs
 *   chunkSize, concurrency, budgetMs, judgeTimeoutMs
 *   failClosed   -> block when a message could not be judged in time
 */
export function createGuard({
  local = null,
  judge,
  store = createSecureStore(),
  localSafeBelow = 0.5,
  localBlockAbove = 0.99,
  chunkSize = 12000,
  concurrency = 4,
  budgetMs = 5000,
  judgeTimeoutMs = 5000,
  failClosed = false,
} = {}) {
  if (typeof judge !== 'function') throw new Error('createGuard: a judge function is required');
  const breaker = createBreaker();
  const keyOf = (m) => m.role + '\n' + m.text;   // only ever passed to the store, which hashes it

  // The local classifier can block anything, but it may only CLEAR assistant / tool text: user and system text always reaches the judge.
  async function judgeChunk(text, deadline, role) {
    if (local) {
      try {
        const score = await withTimeout(local(text), 3000);
        if (score >= localBlockAbove) return { verdict: 'unsafe', reason: 'local classifier' };
        if (score < localSafeBelow && role !== 'user' && role !== 'system') return { verdict: 'safe' };
      } catch { /* fall through to the judge */ }
    }
    if (breaker.isOpen() || Date.now() > deadline) return { verdict: 'unknown' };
    try {
      const v = await withTimeout(judge(text), judgeTimeoutMs);
      breaker.success();
      return v;
    } catch (e) {
      breaker.failure(e && e.retryAfterMs);
      return { verdict: 'unknown' };
    }
  }

  async function check(request) {
    const msgs = extractMessages(Array.isArray(request) ? { messages: request } : request);
    const deadline = Date.now() + budgetMs;
    const todo = [];
    for (const m of msgs) {
      const h = keyOf(m);
      const seen = store.get(h);
      if (seen) {
        if (seen.verdict === 'unsafe') return { decision: 'block', reason: seen.reason || 'flagged content' };
        continue;
      }
      todo.push({ h, m });
    }

    let unknown = false;
    const results = await mapLimit(todo, concurrency, async ({ h, m }) => {
      const parts = await Promise.all(chunkText(m.text, chunkSize).map((c) => judgeChunk(c, deadline, m.role)));
      const bad = parts.find((p) => p.verdict === 'unsafe');
      if (bad) { store.set(h, bad); return bad; }
      if (parts.some((p) => p.verdict === 'unknown')) { unknown = true; return null; }
      const v = { verdict: parts.some((p) => p.verdict === 'borderline') ? 'borderline' : 'safe' };
      store.set(h, v);
      return v;
    });

    const hit = results.find((r) => r && r.verdict === 'unsafe');
    if (hit) return { decision: 'block', reason: hit.reason || 'flagged content' };
    if (unknown && failClosed) return { decision: 'block', reason: 'screening unavailable' };
    return { decision: 'allow', unjudged: unknown };
  }

  return { check };
}
