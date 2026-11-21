import crypto from 'node:crypto';

/**
 * Verdict cache that never holds message text and never holds a readable key.
 *  - Keys: HMAC-SHA256 of the message under a secret, so the stored key cannot be reversed or matched against a guessed text without the secret.
 *  - Values: AES-256-GCM encrypted under a key derived from the same secret, so a copy of the store reveals nothing.
 * Pass your own `secret` to keep verdicts across restarts; without one a random secret is made and the cache only lives in memory.
 * `backend` is any Map-like object (get/set/delete) holding strings, for example a Redis or SQLite wrapper.
 */
export function createSecureStore({ secret = crypto.randomBytes(32), backend = new Map(), ttlMs = 30 * 86400000 } = {}) {
  const root = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret));
  const macKey = crypto.createHmac('sha256', root).update('guardrails:mac').digest();
  const encKey = crypto.createHmac('sha256', root).update('guardrails:enc').digest();
  const id = (text) => crypto.createHmac('sha256', macKey).update(text).digest('hex');

  const seal = (obj) => {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey, iv);
    const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
  };
  const open = (s) => {
    try {
      const b = Buffer.from(s, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', encKey, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
    } catch { return null; }   // tampered or written under another secret
  };

  return {
    get(text) {
      const k = id(text), raw = backend.get(k); if (!raw) return undefined;
      const v = open(raw); if (!v || Date.now() > v.exp) { backend.delete(k); return undefined; }
      return v.verdict;
    },
    set(text, verdict) { backend.set(id(text), seal({ verdict, exp: Date.now() + ttlMs })); },
  };
}
