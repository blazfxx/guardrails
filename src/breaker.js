// Circuit breaker: after repeated failures, stop calling a dependency for a while instead of making every request wait on it.
export function createBreaker({ failures = 3, windowMs = 20000, openMs = 45000 } = {}) {
  let until = 0;
  let recent = [];
  return {
    isOpen: () => Date.now() < until,
    success() { recent = []; },
    failure(retryAfterMs) {
      const now = Date.now();
      recent = recent.filter((t) => now - t < windowMs);
      recent.push(now);
      if (retryAfterMs) until = now + retryAfterMs;
      else if (recent.length >= failures) until = now + openMs;
    },
  };
}
