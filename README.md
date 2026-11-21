# guardrails

A small, provider-agnostic pre-screening layer for LLM requests. It checks a request **before** it is sent to a model provider and returns `allow` or `block`.

## How it works

```
request ──► split into messages ──► (cache hit?) ──► local classifier ──► LLM judge ──► decision
                                        │                  │                  │
                                        └── verdict ───────┴─ confident ──────┴─ unavailable → fallback policy
```

1. **Split.** The request is broken into its messages (system, user, assistant, tool). Long messages are cut into overlapping chunks so nothing is skipped and nothing is split mid-phrase.
2. **Cache.** A message that was judged before is not judged again, so long agent conversations that resend their history only pay for new messages. The cache never stores message text: keys are HMAC-SHA256 hashes under a secret, and verdicts are AES-256-GCM encrypted (`src/store.js`).
3. **Local classifier.** A small, fast local model scores each chunk. A near-certain attack is blocked without any network call. Clearly harmless assistant and tool output (often most of an agent conversation) passes here; user and system text always goes on to the judge.
4. **LLM judge.** Text the local model is unsure about goes to an LLM with a classification prompt. Calls run in parallel with a concurrency cap.
5. **Whole-conversation pass (optional).** For very long requests, one extra call reads the conversation as a whole, because some problems only appear when the parts are combined.
6. **Fallback policy.** Every stage has a time budget. If the judge is down, slow or rate-limited, a circuit breaker opens and the local classifier decides alone. You choose per caller whether an unjudged request fails open or closed.

## Usage

```js
import { createGuard } from './src/index.js';

const guard = createGuard({
  local: myLocalClassifier,   // async (text) => score in [0, 1]
  judge: myLlmJudge,          // async (text) => { verdict: 'safe' | 'borderline' | 'unsafe', reason }
  failClosed: false,
});

const result = await guard.check(request.messages);
if (result.decision === 'block') return reply(400, result.reason);
```

See `examples/` for a runnable demo with stub classifiers.

## Privacy

- No message text is stored or sent anywhere by this library.
- The verdict cache holds only keyed hashes and encrypted verdicts. Without the secret it cannot be read or matched against guessed text.
- Nothing is logged.

## License

MIT
