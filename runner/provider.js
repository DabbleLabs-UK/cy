import { applySharedOllamaProfile, createSharedOllamaClient } from './shared-ollama-lease.js';

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
import { request as httpRequest } from 'node:http';

export const OLLAMA = 'ollama';
export const DEEPSEEK = 'deepseek';

// Node's global fetch (undici) enforces its own ~300s headers-timeout entirely
// independent of any AbortSignal/timeoutMs the caller supplies - it fires even
// when the caller's own timeout is set higher, well before the caller's logic
// ever gets a chance to matter. AWG's raw, non-streamed generate call can
// legitimately need longer than that on slow local hardware (see
// AWG_TIMEOUT_MS), so it posts via plain node:http instead of fetch here,
// giving the caller's own AbortSignal-based timeout sole authority with no
// hidden ceiling. Preserves the same {ok, status, text} contract as fetch.
function postJsonNoImplicitTimeout(urlString, body, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }
    const target = new URL(urlString);
    const payload = Buffer.from(JSON.stringify(body));
    const req = httpRequest({
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', reject);
    });
    req.on('error', (error) => {
      if (signal && signal.aborted) return; // the abort listener below already rejected
      reject(error);
    });
    if (signal) {
      const onAbort = () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        req.destroy();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      req.once('close', () => signal.removeEventListener('abort', onAbort));
    }
    req.end(payload);
  });
}

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);

// Resolve an optional local model route. Empty/missing routes deliberately fall
// back to the existing single `model`, so adding the config shape changes nothing
// until the Dell runner is given an installed model name for that purpose.
export function localModelFor(config, purpose) {
  const routes = (config && config.ollamaModels) || {};
  const rawKey = String(purpose || 'journal');
  const key = rawKey === 'letter' ? 'postcard' : rawKey === 'warden' ? 'notice' : rawKey;
  const routed = typeof routes[key] === 'string' ? routes[key].trim() : '';
  const journal = typeof routes.journal === 'string' ? routes.journal.trim() : '';
  return routed || journal || config.model;
}

// This deployed Q5 GGUF has a ChatML-style Ollama template. Its visible prose
// sometimes emits |im_end|> without the leading <, which the normal full-token
// stop cannot match. Stop at the provider boundary, while keeping the waking
// validator as the final safety check. Other models, providers, and non-prose
// requests retain their original options.
const MALFORMED_CHATML_MODEL = 'hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M';
const WAKING_PROSE_PURPOSES = new Set(['journal', 'drawing', 'postcard', 'warden']);

function ollamaWakingProseOptions(model, purpose, opts) {
  if (model !== MALFORMED_CHATML_MODEL || !WAKING_PROSE_PURPOSES.has(purpose)) return opts;
  const stops = Array.isArray(opts?.stop) ? opts.stop : [];
  if (stops.includes('|im_end|>')) return opts;
  const fullIndex = stops.indexOf('<|im_end|>');
  const withFull = fullIndex < 0 ? ['<|im_end|>', ...stops] : stops;
  const insertAfterFull = withFull.indexOf('<|im_end|>') + 1;
  return {
    ...(opts || {}),
    stop: [...withFull.slice(0, insertAfterFull), '|im_end|>', ...withFull.slice(insertAfterFull)],
  };
}

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
export function deepseekToNdjsonReader(srcReader, { model, priceRow, fx, requireCompletion = false }) {
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
      usage_reported: usage !== null,
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
          if (requireCompletion && !finishReason && !closed) {
            controller.error(new Error('postcard provider stream ended without completion'));
            return;
          }
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
  const sharedClient = createSharedOllamaClient(config.ollamaArbiterUrl);
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
      return localModelFor(config, 'journal');
    },
    modelFor(purpose) {
      return localModelFor(config, purpose);
    },
    available() {
      return true;
    },
    async acquireSharedLease({ purpose, signal, onLost, preemptible }) {
      return sharedClient ? sharedClient.acquire({ purpose, signal, onLost, preemptible,
        observeOwner: true }) : null;
    },
    applySharedProfile(opts, lease) {
      return applySharedOllamaProfile(opts, lease);
    },
    async openStream({ system, prompt, opts, signal, purpose }) {
      const model = localModelFor(config, purpose);
      const res = await fetch(`${url()}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, system, prompt,
          options: ollamaWakingProseOptions(model, purpose, opts), keep_alive: -1, stream: true }),
        signal,
      });
      if (!res.ok || !res.body) return { ok: false, status: res.status };
      return { ok: true, status: 200, reader: res.body.getReader(), model };
    },
    async rawGenerate({ system, prompt, opts, signal, purpose, format = null }) {
      const model = localModelFor(config, purpose);
      const res = await postJsonNoImplicitTimeout(`${url()}/api/generate`, {
        model, system, prompt, options: opts, keep_alive: -1, stream: false,
        ...(format ? { format } : {}),
      }, signal);
      if (!res.ok) return { ok: false, status: res.status, text: '' };
      const j = JSON.parse(res.text);
      return { ok: true, status: 200, text: j.response || '', stats: j, model };
    },
  };
}

// Sender formation alone uses DeepSeek's strict forced-tool contract. This is
// the schema-equivalent encoding accepted by the bounded synthetic evaluation;
// ordinary postcard/chat paths below keep their existing transport unchanged.
function formationStrictSchema(value) {
  if (Array.isArray(value)) return value.map(formationStrictSchema);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [name, item] of Object.entries(value)) {
    if (name === 'oneOf') out.anyOf = formationStrictSchema(item);
    else if (name === 'const') { out.type = typeof item; out.enum = [item]; }
    else if (name === 'enum') { out.type = 'string'; out.enum = item; }
    else if (name !== 'minLength' && name !== 'maxLength') out[name] = formationStrictSchema(item);
  }
  if (value.minLength === 1 && value.maxLength === 480) out.pattern = '^[\\s\\S]{1,480}$';
  return out;
}

export function deepseekFormationRequest({ system, prompt, format, opts, model }) {
  if (!Array.isArray(format?.oneOf) || !format.oneOf.length || !model
      || opts?.num_predict !== 260 || opts?.temperature !== 0.1) {
    throw new Error('bounded sender formation request required');
  }
  // oneOf -> anyOf is equivalent only because these action branches are
  // disjoint. Reject an unexpected schema rather than relaxing its meaning.
  const actions = format.oneOf.map(branch => branch?.properties?.decision?.const);
  if (actions.some(action => !['NOTHING', 'CREATE', 'UPDATE', 'RESOLVE'].includes(action))
      || new Set(actions).size !== actions.length) throw new Error('disjoint formation action schema required');
  return {
    model, stream: false, thinking: { type: 'disabled' },
    temperature: opts.temperature, top_p: opts.top_p, max_tokens: opts.num_predict,
    stop: opts.stop?.slice(0, 4),
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    tools: [{ type: 'function', function: { name: 'formation_decision', strict: true,
      description: 'Return the constrained formation decision.',
      parameters: { type: 'object', properties: { result: formationStrictSchema(format) },
        required: ['result'], additionalProperties: false } } }],
    tool_choice: { type: 'function', function: { name: 'formation_decision' } },
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
    modelFor() {
      return ds.model;
    },
    available() {
      return !!key;
    },
    async formationGenerate({ system, prompt, opts, signal, format, model = ds.model }) {
      if (!key) return { ok: false, status: 0, text: '', reason: 'credentials_missing', configuredModel: model };
      const body = deepseekFormationRequest({ system, prompt, opts, format, model });
      const base = apiBase.replace(/\/$/, '');
      const response = await fetch(`${base.endsWith('/beta') ? base : `${base}/beta`}/chat/completions`, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body), signal,
      });
      if (!response.ok) return { ok: false, status: response.status, text: '', configuredModel: model,
        reason: response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'provider_unavailable' : 'provider_error' };
      const result = await response.json();
      let text = '', transportValid = false;
      const tools = result.choices?.[0]?.message?.tool_calls;
      try {
        if (tools?.length !== 1 || tools[0].function?.name !== 'formation_decision') throw new Error('wrong tool');
        const envelope = JSON.parse(tools[0].function.arguments);
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
            || Object.keys(envelope).length !== 1 || !Object.hasOwn(envelope, 'result')) throw new Error('wrong envelope');
        text = JSON.stringify(envelope.result);
        transportValid = true;
      } catch { /* Empty text reaches the existing canonical invalid-decision boundary. */ }
      const usage = result.usage;
      const usageReported = Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens);
      const stats = { done: true, provider: DEEPSEEK, model: result.model || null,
        configured_model: model, done_reason: result.choices?.[0]?.finish_reason || null,
        formation_transport_valid: transportValid, usage_reported: usageReported,
        ...(usageReported ? { prompt_eval_count: usage.prompt_tokens, eval_count: usage.completion_tokens,
          usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens,
            cached_tokens: usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0 } } : {}),
      };
      return { ok: true, status: response.status, text, configuredModel: model, model: result.model || null, stats };
    },
    async openStream({ system, prompt, opts, signal, purpose }) {
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: ds.model,
          messages: messages(system, prompt),
          stream: true,
          stream_options: { include_usage: true }, // so the final chunk carries token usage
          ...(purpose === 'postcard' ? { thinking: { type: 'disabled' } } : {}),
          ...mapOptsToDeepSeek(opts, ds.maxTokens),
        }),
        signal,
      });
      if (!res.ok || !res.body) return { ok: false, status: res.status };
      return {
        ok: true,
        status: 200,
        reader: deepseekToNdjsonReader(res.body.getReader(), {
          model: ds.model, priceRow: priceRow(), fx, requireCompletion: purpose === 'postcard',
        }),
        model: ds.model,
      };
    },
    async rawGenerate({ system, prompt, opts, signal, purpose, format = null }) {
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: ds.model,
          messages: messages(system, prompt),
          stream: false,
          ...(format ? { response_format: { type: 'json_object' } } : {}),
          ...(purpose === 'postcard' ? { thinking: { type: 'disabled' } } : {}),
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
        usage_reported: !!j.usage,
        eval_count: c.tokensOut,
        usage: {
          prompt_tokens: c.tokensIn,
          completion_tokens: c.tokensOut,
          cached_tokens: c.cachedIn,
          uncached_tokens: c.uncachedIn,
        },
        cost: { usd: c.costUsd, gbp: c.costGbp },
      };
      return { ok: true, status: 200, text, stats, model: ds.model };
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
