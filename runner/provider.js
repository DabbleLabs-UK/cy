// provider.js - the switchable model provider abstraction.
//
// Generation is the ONLY thing that differs between models, so it is the only
// thing extracted here. Everything downstream in run.js - the prompt zones, the
// warden, the capitalisation, introspection, silence and tempo - is unchanged and
// never learns which model produced a token. Each provider presents the SAME
// streaming interface:
//
//   provider.openStream({ system, prompt, opts, signal })
//     -> { ok, status, reader }   reader.read() yields OLLAMA-SHAPED NDJSON bytes
//   provider.rawGenerate({ system, prompt, opts, signal })
//     -> { ok, status, text, stats }   one-shot, non-streamed (drawing DSL)
//
// The streaming `reader` is deliberately ollama-shaped for BOTH providers so
// run.js's existing readNdjsonStream / per-token emit path does not change: each
// line is `{ response: "<token>" }` and the final line is `{ done: true, ... }`
// carrying the counters. For DeepSeek (an OpenAI-compatible SSE stream) the SSE is
// transformed into that same NDJSON shape on the fly, and the final done line also
// carries `usage` (token counts) and the computed `cost` so run.js can meter spend.
//
// - OLLAMA: the local, abliterated model. No content restrictions, costs nothing
//   in API terms (its cost is electricity, metered separately by power.js).
// - DEEPSEEK: api.deepseek.com chat/completions, streamed. HAS content
//   restrictions, so run.js screens the opening of every DeepSeek burst for a
//   refusal and discards it (see looksLikeRefusal) rather than emitting it.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const OLLAMA = 'ollama';
export const DEEPSEEK = 'deepseek';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);

// ---- key loading -----------------------------------------------------------
//
// The DeepSeek key lives at runner/deepseek.key (gitignored). Missing file means
// DeepSeek is simply unavailable - not an error. Whitespace and newlines are
// trimmed. The key is NEVER logged or returned in any event; only its presence
// (a boolean) is ever surfaced.
export async function loadDeepSeekKey(dir) {
  try {
    const raw = await readFile(join(dir, 'deepseek.key'), 'utf8');
    const key = raw.trim();
    return key.length ? key : null;
  } catch {
    return null; // no key file -> DeepSeek unavailable
  }
}

// ---- cost (pure, unit-tested) ----------------------------------------------
//
// DeepSeek returns token usage per call. Cost is priced per MILLION tokens with a
// separate rate for cache-hit vs cache-miss prompt tokens, plus output tokens.
// When the cache split is not reported, all prompt tokens are treated as
// cache-miss (the more expensive assumption - never under-count spend).
//   priceRow: { input_cache_miss, input_cache_hit, output }  (USD per 1e6 tokens)
//   fxGbpPerUsd: GBP per 1 USD (an assumption; see config)
export function computeCost(usage, priceRow, fxGbpPerUsd) {
  const u = usage || {};
  const p = priceRow || { input_cache_miss: 0, input_cache_hit: 0, output: 0 };
  const fx = num(fxGbpPerUsd);
  const inTot = num(u.prompt_tokens);
  const out = num(u.completion_tokens);
  let hit = u.prompt_cache_hit_tokens;
  let miss = u.prompt_cache_miss_tokens;
  if (hit == null && miss == null) {
    miss = inTot; // cache split not reported: charge it all at the miss rate
    hit = 0;
  } else {
    hit = num(hit);
    miss = num(miss);
  }
  const per = (tokens, price) => (num(tokens) / 1e6) * num(price);
  const usd = per(miss, p.input_cache_miss) + per(hit, p.input_cache_hit) + per(out, p.output);
  const gbp = usd * fx;
  return { tokensIn: inTot, tokensOut: out, cachedIn: hit, uncachedIn: miss, costUsd: usd, costGbp: gbp };
}

// ---- refusal detection (pure, unit-tested) ---------------------------------
//
// The abliterated local model never refuses; DeepSeek does. A refusal almost
// always opens the response ("I'm sorry, but I can't..."), so run.js holds the
// first ~100 chars of a DeepSeek burst and checks them here. A match is treated
// like a blocked generation - discarded, never emitted, recorded as its own
// 'refused' cycle outcome. Conservative on purpose: it only fires on an actual
// refusal opener, not on ordinary prose that merely says "sorry".
// The verbs a refusal attaches to, shared by the "i can't/cannot" and
// "sorry but i can't/cannot" branches. Deliberately NOT a bare "i cannot", which
// would wrongly flag ordinary prose ("i cannot sleep in here").
const REFUSE_VERB = "(?:help|assist|comply|fulfil|fulfill|continue|create|provide|write|generate|do that|do this|complete)";
const REFUSAL_RE = new RegExp(
  "^(?:" +
    "i'?m sorry[,.]? but|" +
    "sorry[,.]? but i (?:can'?t|cannot) " + REFUSE_VERB + "|" +
    "i (?:can'?t|cannot) " + REFUSE_VERB + "|" +
    "i'?m (?:unable|not able) to|" +
    "i'?m not going to|" +
    "i won'?t (?:be able to|help|assist)|" +
    "i must decline|" +
    "i do(?:n'?t| not) feel comfortable|" +
    "as an ai|i'?m an ai(?: language model)?|" +
    "this request (?:goes against|violates)|" +
    "i'?m not comfortable" +
  ")",
  "i",
);
export function looksLikeRefusal(text) {
  if (!text) return false;
  // normalise curly apostrophes (U+2018/U+2019) to straight so the (ASCII) regex
  // matches a refusal whether the model wrote a straight or a typographic quote,
  // then collapse whitespace. The char class is built from char codes to keep this
  // source file pure ASCII.
  const curly = new RegExp('[' + String.fromCharCode(0x2018, 0x2019) + ']', 'g');
  const head = String(text)
    .slice(0, 240)
    .replace(curly, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!head) return false;
  return REFUSAL_RE.test(head);
}

// ---- DeepSeek SSE -> ollama-NDJSON transform -------------------------------
//
// Wrap the DeepSeek response body reader so its OpenAI SSE stream reads, to the
// caller, exactly like an ollama /api/generate NDJSON stream: one `{response}`
// line per content delta, then a final `{done:true, ...}` line carrying the
// counters plus `usage` and computed `cost`. This is what lets run.js consume both
// providers through the identical readNdjsonStream path.
export function deepseekToNdjsonReader(srcReader, { model, priceRow, fx }) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = '';
  let usage = null;
  let finishReason = null;
  let closed = false;

  const finalObj = () => {
    const c = computeCost(usage || {}, priceRow, fx);
    return {
      done: true,
      done_reason: finishReason || 'stop',
      finish_reason: finishReason || 'stop',
      // ollama-shaped counters so emitGen reads them with no special-casing
      prompt_eval_count: c.tokensIn,
      eval_count: c.tokensOut,
      provider: DEEPSEEK,
      model,
      usage: {
        prompt_tokens: c.tokensIn,
        completion_tokens: c.tokensOut,
        cached_tokens: c.cachedIn,
        uncached_tokens: c.uncachedIn,
      },
      cost: { usd: c.costUsd, gbp: c.costGbp },
    };
  };

  const stream = new ReadableStream({
    async pull(controller) {
      for (;;) {
        let chunk;
        try {
          chunk = await srcReader.read();
        } catch (err) {
          controller.error(err); // abort/network - surfaced to readNdjsonStream
          return;
        }
        const { done, value } = chunk;
        if (done) {
          if (!closed) {
            closed = true;
            controller.enqueue(enc.encode(JSON.stringify(finalObj()) + '\n'));
          }
          controller.close();
          return;
        }
        buf += dec.decode(value, { stream: true });
        let produced = false;
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            if (!closed) {
              closed = true;
              controller.enqueue(enc.encode(JSON.stringify(finalObj()) + '\n'));
            }
            controller.close();
            return;
          }
          let obj;
          try {
            obj = JSON.parse(data);
          } catch {
            continue; // partial/garbage SSE line - skip
          }
          if (obj.usage) usage = obj.usage;
          const ch = obj.choices && obj.choices[0];
          if (ch) {
            if (ch.finish_reason) finishReason = ch.finish_reason;
            const content = ch.delta && ch.delta.content;
            if (content) {
              controller.enqueue(enc.encode(JSON.stringify({ response: content }) + '\n'));
              produced = true;
            }
          }
        }
        if (produced) return; // hand tokens to the consumer promptly
      }
    },
    cancel(reason) {
      try {
        srcReader.cancel(reason);
      } catch {
        /* best effort */
      }
    },
  });
  return stream.getReader();
}

// Map ollama sampling options onto DeepSeek (OpenAI) parameters. Only the options
// with a meaningful OpenAI analogue are carried; ollama-only knobs (num_ctx,
// num_thread, repeat_penalty) have no equivalent and are dropped.
function mapOptsToDeepSeek(opts, maxTokensDefault) {
  const o = opts || {};
  const body = {};
  if (typeof o.temperature === 'number') body.temperature = o.temperature;
  if (typeof o.top_p === 'number') body.top_p = o.top_p;
  const maxTokens = typeof o.num_predict === 'number' ? o.num_predict : maxTokensDefault;
  if (typeof maxTokens === 'number' && maxTokens > 0) body.max_tokens = maxTokens;
  if (Array.isArray(o.stop) && o.stop.length) body.stop = o.stop.slice(0, 4); // OpenAI caps stop at 4
  return body;
}

// ---- providers -------------------------------------------------------------

function makeOllama(config) {
  const url = () => config.ollamaUrl;
  return {
    id: OLLAMA,
    costsMoney: false,
    // LOCAL vs METERED. `local` is the load-bearing flag the runner reads to decide
    // whether the full-tilt (speed 100) reading-cap bypass is allowed. It is true
    // ONLY for the on-box model, where generation itself is the brake (~55s TTFT,
    // ~4 tok/s) so 'no deliberate idle' is still a sane cadence. Any paid/remote
    // provider MUST set local:false so the reading cap always binds and a fast API
    // cannot be token-rinsed by back-to-back inferences. `metered` is the inverse,
    // spelled out so both intents read plainly at the call site. Adding a future
    // provider forces an explicit choice here rather than silently inheriting.
    local: true,
    metered: false,
    screensContent: false, // abliterated: no refusals to screen
    get model() {
      return config.model;
    },
    available() {
      return true;
    },
    async openStream({ system, prompt, opts, signal }) {
      const res = await fetch(`${url()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, system, prompt, options: opts, keep_alive: -1, stream: true }),
        signal,
      });
      if (!res.ok || !res.body) return { ok: false, status: res.status };
      return { ok: true, status: 200, reader: res.body.getReader() };
    },
    async rawGenerate({ system, prompt, opts, signal }) {
      const res = await fetch(`${url()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, system, prompt, options: opts, keep_alive: -1, stream: false }),
        signal,
      });
      if (!res.ok) return { ok: false, status: res.status, text: '' };
      const j = await res.json();
      return { ok: true, status: 200, text: j.response || '', stats: null };
    },
  };
}

function makeDeepSeek(config, key) {
  const ds = config.deepseek || {};
  const apiBase = ds.apiBase || 'https://api.deepseek.com';
  const fx = ds.fxGbpPerUsd ?? 0.79;
  const priceRow = () => (ds.prices && ds.prices[ds.model]) || { input_cache_miss: 0, input_cache_hit: 0, output: 0 };
  const messages = (system, prompt) => {
    const m = [];
    if (system) m.push({ role: 'system', content: system });
    m.push({ role: 'user', content: prompt });
    return m;
  };
  return {
    id: DEEPSEEK,
    costsMoney: true,
    // REMOTE + METERED: the API answers in ~1-2s, so there is NO generation brake.
    // local:false means the runner NEVER bypasses the reading cap for DeepSeek, at
    // any speed including 100 - see the full-tilt composition step in run.js. Do not
    // flip this to true for any provider that costs money or answers fast.
    local: false,
    metered: true,
    screensContent: true, // DeepSeek can refuse - run.js screens the opening
    get model() {
      return ds.model;
    },
    available() {
      return !!key;
    },
    async openStream({ system, prompt, opts, signal }) {
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: ds.model,
          messages: messages(system, prompt),
          stream: true,
          stream_options: { include_usage: true }, // so the final chunk carries token usage
          ...mapOptsToDeepSeek(opts, ds.maxTokens),
        }),
        signal,
      });
      if (!res.ok || !res.body) return { ok: false, status: res.status };
      return {
        ok: true,
        status: 200,
        reader: deepseekToNdjsonReader(res.body.getReader(), { model: ds.model, priceRow: priceRow(), fx }),
      };
    },
    async rawGenerate({ system, prompt, opts, signal }) {
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: ds.model,
          messages: messages(system, prompt),
          stream: false,
          ...mapOptsToDeepSeek(opts, ds.maxTokens),
        }),
        signal,
      });
      if (!res.ok) return { ok: false, status: res.status, text: '' };
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      const c = computeCost(j.usage || {}, priceRow(), fx);
      const stats = {
        done: true,
        provider: DEEPSEEK,
        model: ds.model,
        prompt_eval_count: c.tokensIn,
        eval_count: c.tokensOut,
        usage: {
          prompt_tokens: c.tokensIn,
          completion_tokens: c.tokensOut,
          cached_tokens: c.cachedIn,
          uncached_tokens: c.uncachedIn,
        },
        cost: { usd: c.costUsd, gbp: c.costGbp },
      };
      return { ok: true, status: 200, text, stats };
    },
  };
}

// Build the provider registry. `deepseekKey` is the trimmed key string or null.
export function makeProviders(config, { deepseekKey } = {}) {
  return {
    [OLLAMA]: makeOllama(config),
    [DEEPSEEK]: makeDeepSeek(config, deepseekKey || null),
  };
}
