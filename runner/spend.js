// spend.js - the MODEL-API money meter.
//
// The electricity meter (power.js) prices the machine being switched on. This
// meter prices the OTHER cost: paid model-provider API calls. They are SEPARATE
// series and must never be double counted - an ollama generation costs nothing in
// API terms (its cost is electricity, already metered), so only paid providers
// (DeepSeek) ever move this meter. Like the power meter, the cumulative total is
// PERSISTED so it accumulates over the whole life of the project, across restarts.
//
// Per-call cost is computed by the provider (provider.js computeCost) from the
// token usage DeepSeek returns, in GBP (via a configurable FX rate) so model spend
// and electricity spend share one currency and can sit on the same chart. This
// module only ACCUMULATES those per-call costs and persists the running total.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : Number(x) || 0);

export class SpendMeter {
  constructor(config, statePath) {
    this.statePath = statePath;
    this.totalGbp = 0;
    this.totalUsd = 0;
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.calls = 0;
    this.startTs = null; // life-of-project first-spend/switch-on time
    // NON-EMITTING BURN. The subset of the totals above spent on cycles that paid the
    // full prompt cost and produced NO prose on the page (a completed burst the warden
    // ate whole, or otherwise empty output). This is money for nothing, so it is
    // tracked as its OWN cumulative series alongside the grand total - never a parallel
    // meter - so the diagnostics can show how much of the spend was wasted. NB it can
    // only ever count cycles that COMPLETED (their usage arrived on the done line): a
    // refusal/abort is cut before the counters land, so its (small, early-aborted) cost
    // is unmeasurable here and shows instead in the 'refused'/'aborted' outcome counts.
    this.nonEmitGbp = 0;
    this.nonEmitUsd = 0;
    this.nonEmitTokensIn = 0;
    this.nonEmitTokensOut = 0;
    this.nonEmitCalls = 0;
  }

  async load() {
    try {
      const j = JSON.parse(await readFile(this.statePath, 'utf8'));
      this.totalGbp = num(j.total_gbp);
      this.totalUsd = num(j.total_usd);
      this.tokensIn = num(j.tokens_in);
      this.tokensOut = num(j.tokens_out);
      this.calls = num(j.calls);
      this.startTs = num(j.start_ts) || null;
      this.nonEmitGbp = num(j.nonemit_gbp);
      this.nonEmitUsd = num(j.nonemit_usd);
      this.nonEmitTokensIn = num(j.nonemit_tokens_in);
      this.nonEmitTokensOut = num(j.nonemit_tokens_out);
      this.nonEmitCalls = num(j.nonemit_calls);
    } catch {
      /* first run - nothing persisted yet */
    }
    if (!this.startTs) this.startTs = Date.now();
  }

  // Fold one paid generation into the running total. `usage` is the per-call token
  // usage and `cost` is the per-call { usd, gbp } the provider already computed.
  // `productive` (default true) is whether this call's generation actually put prose
  // on the page; when false the same cost is ALSO added to the non-emitting series so
  // the wasted spend is attributable. Returns the per-call facts plus the new
  // cumulative totals (grand and non-emitting), for the spend event.
  record({ provider, model, usage, cost, productive = true }) {
    const u = usage || {};
    const gbp = num(cost && cost.gbp);
    const usd = num(cost && cost.usd);
    const tin = num(u.prompt_tokens);
    const tout = num(u.completion_tokens);
    const cached = num(u.cached_tokens);
    const uncached = u.uncached_tokens != null ? num(u.uncached_tokens) : Math.max(0, tin - cached);
    this.totalGbp += gbp;
    this.totalUsd += usd;
    this.tokensIn += tin;
    this.tokensOut += tout;
    this.calls += 1;
    if (!productive) {
      this.nonEmitGbp += gbp;
      this.nonEmitUsd += usd;
      this.nonEmitTokensIn += tin;
      this.nonEmitTokensOut += tout;
      this.nonEmitCalls += 1;
    }
    return {
      provider,
      model,
      productive: !!productive,
      tokensIn: tin,
      tokensOut: tout,
      cachedIn: cached,
      uncachedIn: uncached,
      costUsd: Number(usd.toFixed(8)),
      costGbp: Number(gbp.toFixed(8)),
      totalGbp: Number(this.totalGbp.toFixed(8)),
      totalUsd: Number(this.totalUsd.toFixed(8)),
      // cumulative spend that produced nothing on the page - the burn made visible
      nonEmitGbp: Number(this.nonEmitGbp.toFixed(8)),
      nonEmitUsd: Number(this.nonEmitUsd.toFixed(8)),
      nonEmitCalls: this.nonEmitCalls,
    };
  }

  snapshot() {
    return {
      total_gbp: Number(this.totalGbp.toFixed(8)),
      total_usd: Number(this.totalUsd.toFixed(8)),
      tokens_in: this.tokensIn,
      tokens_out: this.tokensOut,
      calls: this.calls,
      // the non-emitting (wasted) subset of the totals above
      nonemit_gbp: Number(this.nonEmitGbp.toFixed(8)),
      nonemit_usd: Number(this.nonEmitUsd.toFixed(8)),
      nonemit_tokens_in: this.nonEmitTokensIn,
      nonemit_tokens_out: this.nonEmitTokensOut,
      nonemit_calls: this.nonEmitCalls,
    };
  }

  async save() {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(
      this.statePath,
      JSON.stringify(
        {
          total_gbp: this.totalGbp,
          total_usd: this.totalUsd,
          tokens_in: this.tokensIn,
          tokens_out: this.tokensOut,
          calls: this.calls,
          start_ts: this.startTs,
          nonemit_gbp: this.nonEmitGbp,
          nonemit_usd: this.nonEmitUsd,
          nonemit_tokens_in: this.nonEmitTokensIn,
          nonemit_tokens_out: this.nonEmitTokensOut,
          nonemit_calls: this.nonEmitCalls,
        },
        null,
        2,
      ),
    );
  }
}
