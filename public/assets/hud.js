// hud.js - host telemetry panel + the delivered-mail side column.
//
// The host panel reads the `host` event and renders it like a machine readout,
// split HONESTLY into SYSTEM (the whole machine, unrelated work included) and CY
// (only the ollama model process plus this runner). A collapsed `diagnostics`
// section reads the `gen` event and shows per-generation telemetry - most
// prominently prompt_eval_count, the single most diagnostic number. Every stat
// carries a plain-language tooltip. The mail column renders delivered inbound
// letters, CY's outbound replies, delivered images and news items as a shared
// feed so every viewer sees what the others sent and how 7734 answered.

// Plain-language tooltips for every diagnostics stat - no jargon dumps.
const TIP = {
  syscpu: 'Measured. Total CPU use across the whole machine, including work that has nothing to do with 7734.',
  sysmem: 'Measured. Total memory in use across the whole machine, including everything else running.',
  cycpu: 'Measured. CPU used by 7734 alone - the ollama model process. The honest figure; the SYSTEM line includes everything else.',
  model:
    "Measured. The model's REAL resident footprint, read from ollama's own ps report. llama.cpp memory-maps the GGUF weights, so they never show up in any process working set - so this ps figure, not the OLM line below, is the honest one.",
  olmws:
    'Measured. The ollama process working set. MISLEADING for the model: the weights are memory-mapped, so a multi-GB model shows only tens of MB here. The real footprint is the MODEL line above.',
  node: "Measured. The runner program's own memory: the small Node process that drives 7734.",
  othercpu: 'Derived. The rest of the machine that is NOT 7734: total CPU minus Cy. So SYSTEM = CY + OTHER.',
  othermem: 'Derived. The rest of the machine that is NOT 7734: memory used minus Cy (model + ollama + runner). So the lines add up.',
  proc: 'Measured. How ollama is running the model right now: all on CPU, all on GPU, or a split.',
  modelctx: 'Measured. The context window the model is loaded with (tokens), as ollama ps reports it.',
  peval:
    'How many tokens of its briefing the model had to read this time. Anything it already held in memory is skipped, so a small number means it reused its notes and a large number means it started over.',
  kv: 'KV = key/value: the model stores a key and a value for every token it reads - its working memory of what it has read. Reusing that store is what lets it skip re-reading.',
  tin: 'Tokens in: the size of the briefing the model read this burst (same as prompt_eval_count).',
  tout: 'Tokens out: how many tokens the model wrote in this burst - the length of what it produced.',
  ptoks:
    'How fast it read its briefing. Reading scales with CPU threads, because the whole briefing can be crunched in parallel.',
  gtoks:
    'How fast it wrote new text. Capped by memory speed, not threads, because each new token has to wait on the one before it.',
  ttft: 'Time to first token: from asking until the first character appeared - mostly the cost of reading the briefing.',
  total: 'Total wall-clock time this burst took, reading plus writing.',
  ctx: 'How much text is in the model\'s rolling context right now - its running memory of what it has written.',
  duty: 'Duty cycle: the share of time the machine is allowed to think. Lower means more silence between bursts (fewer viewers, throttled).',
  mode: 'What the model is doing: journal (writing to itself), letter (replying to mail), sleep, or warden.',
  threads: 'How many CPU threads the model is using to read and compute.',
  nctx: 'The most tokens the model can hold in context at once - its memory ceiling.',
  model: 'The exact model file driving 7734.',
  poll: 'Whether the last checks for new mail and for the viewer tempo reached the server.',
  err: 'The most recent error the runner hit talking to the server, if any.',
  anger: 'How angry he FEELS right now (0-1): fast to rise on a slight, slow to sulk back down.',
  expressed:
    'How much anger actually reaches the PAGE as shouting (0-1). It trails the felt anger through a lag - quick to rise, much slower to fall - so the shouting appears a beat after the feeling and the comedown outlasts the flare.',
  // LIVE group (continuously sampled - never a per-burst snapshot)
  live: 'LIVE readings, sampled continuously - not tied to any one generation. They keep moving between bursts and during a stall.',
  watts: 'Measured. The machine\'s instantaneous power draw right now, in watts.',
  viewers: 'How many people are watching live right now. More viewers speed the duty cycle up.',
  phase: 'What the model is doing this instant: reading its briefing (eval), writing (gen), or nothing (idle).',
  form: 'The form/shape directive that steered this burst (train of thought, list, a refrain, a reply, and so on).',
  // LAST GENERATION snapshot group
  snap: 'A SNAPSHOT frozen at the moment the last generation finished. It does NOT update between bursts - the age below counts up so you can see how stale it is.',
  age: 'How long ago the snapshot below was captured, counting up live. Past a couple of minutes the whole group fades and is marked STALE so old numbers never read as current.',
  when: 'The wall-clock time the snapshot below was taken.',
  cycles:
    'The outcome of each of the last N generation cycles, so a stall is visible here and not only in the log. emitted = text reached the page; discarded = a near-repeat was thrown away; empty (provider) = the provider returned no text at all; empty (stripped) = text arrived but the strip banks removed all of it; empty (draw) = a drawing pass produced nothing; blocked = the warden ate it; silent = a deliberate pause; throttled = duty-cycle quiet; aborted = interrupted or unreachable. All emitted at 0 with the rest climbing is a stall.',
};

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export class Hud {
  constructor({ host, mail }) {
    this.hostEl = host;
    this.mailEl = mail;
    this._seen = new Set(); // dedupe by kind:id so replays do not double up
    this._buildHost();
  }

  _buildHost() {
    this.hostEl.classList.add('hostpanel');
    this.hostEl.innerHTML = `
      <div class="hp-title">HMP ThinkPad &middot; Host</div>

      <div class="hp-sec" title="${esc(TIP.syscpu)}">SYSTEM <span class="hp-sec-note">whole machine, measured</span></div>
      <div class="hp-row" title="${esc(TIP.syscpu)}"><span class="hp-k">CPU</span>
        <span class="hp-bar"><i id="hp-cpu-bar"></i></span>
        <span class="hp-v" id="hp-cpu">--%</span></div>
      <div class="hp-row" title="${esc(TIP.sysmem)}"><span class="hp-k">MEM</span>
        <span class="hp-bar"><i id="hp-mem-bar"></i></span>
        <span class="hp-v" id="hp-mem">--%</span></div>
      <div class="hp-row hp-sub" title="${esc(TIP.sysmem)}"><span class="hp-k">USED</span>
        <span class="hp-v2" id="hp-memmb">---- MB</span></div>

      <div class="hp-sec" title="${esc(TIP.cycpu)}">CY <span class="hp-sec-note">7734 only</span></div>
      <div class="hp-row" title="${esc(TIP.cycpu)}"><span class="hp-k">CPU</span>
        <span class="hp-bar"><i id="hp-cycpu-bar"></i></span>
        <span class="hp-v" id="hp-cycpu">--%</span></div>
      <div class="hp-row hp-sub" title="${esc(TIP.model)}"><span class="hp-k">MODEL</span>
        <span class="hp-v2" id="hp-modelmb">---- MB</span></div>
      <div class="hp-row hp-sub hp-modelmeta" title="${esc(TIP.proc)}"><span class="hp-k"></span>
        <span class="hp-v3" id="hp-modelmeta">memory-mapped &middot; ps figure</span></div>
      <div class="hp-row hp-sub" title="${esc(TIP.olmws)}"><span class="hp-k">OLM</span>
        <span class="hp-v2 hp-dim" id="hp-cymemmb">---- MB</span></div>
      <div class="hp-row hp-sub" title="${esc(TIP.node)}"><span class="hp-k">NODE</span>
        <span class="hp-v2" id="hp-nodemb">--- MB</span></div>

      <div class="hp-sec" title="${esc(TIP.othercpu)}">OTHER <span class="hp-sec-note">not 7734, derived</span></div>
      <div class="hp-row" title="${esc(TIP.othercpu)}"><span class="hp-k">CPU</span>
        <span class="hp-bar"><i id="hp-othercpu-bar"></i></span>
        <span class="hp-v" id="hp-othercpu">--%</span></div>
      <div class="hp-row hp-sub" title="${esc(TIP.othermem)}"><span class="hp-k">MEM</span>
        <span class="hp-v2" id="hp-othermb">---- MB</span></div>

      <details class="hp-diag">
        <summary>diagnostics</summary>
        <div class="hp-diag-body">

          <div class="hp-sec hp-sec-live" title="${esc(TIP.live)}">LIVE <span class="hp-sec-note">continuously sampled</span></div>
          <div class="hp-grid">
            <span class="hp-gk" title="${esc(TIP.syscpu)}">cpu</span><span class="hp-gv" id="hp-live-cpu" title="${esc(TIP.syscpu)}">--</span>
            <span class="hp-gk" title="${esc(TIP.sysmem)}">memory</span><span class="hp-gv" id="hp-live-mem" title="${esc(TIP.sysmem)}">--</span>
            <span class="hp-gk" title="${esc(TIP.watts)}">watts</span><span class="hp-gv" id="hp-live-watts" title="${esc(TIP.watts)}">--</span>
            <span class="hp-gk" title="${esc(TIP.viewers)}">viewers</span><span class="hp-gv" id="hp-live-viewers" title="${esc(TIP.viewers)}">--</span>
            <span class="hp-gk" title="${esc(TIP.duty)}">duty cycle</span><span class="hp-gv" id="hp-live-duty" title="${esc(TIP.duty)}">--</span>
            <span class="hp-gk" title="${esc(TIP.phase)}">inference</span><span class="hp-gv" id="hp-live-phase" title="${esc(TIP.phase)}">--</span>
          </div>

          <div class="hp-cycles" id="hp-cycles" title="${esc(TIP.cycles)}">
            <div class="hp-cyc-head">cycle outcomes <span class="hp-cyc-note">last <span id="hp-cyc-n">--</span></span>
              <span class="hp-cyc-stall" id="hp-cyc-stall" hidden>STALL</span></div>
            <div class="hp-cyc-grid" id="hp-cyc-grid"></div>
          </div>

          <div class="hp-snap" id="hp-snap">
            <div class="hp-sec hp-snap-head" title="${esc(TIP.snap)}">LAST GENERATION
              <span class="hp-snap-age" id="hp-genage" title="${esc(TIP.age)}">--</span></div>
            <div class="hp-snap-when" id="hp-genwhen" title="${esc(TIP.when)}">no burst captured yet</div>

            <div class="hp-peval" title="${esc(TIP.peval)}">
              <div class="hp-peval-k">prompt_eval_count</div>
              <div class="hp-peval-v" id="hp-peval">--</div>
              <div class="hp-peval-note" id="hp-peval-note">waiting for a burst...</div>
            </div>
            <div class="hp-kvnote" title="${esc(TIP.kv)}">${esc(TIP.kv)}</div>
            <div class="hp-grid">
              <span class="hp-gk" title="${esc(TIP.tin)}">tokens in</span><span class="hp-gv" id="hp-tin" title="${esc(TIP.tin)}">--</span>
              <span class="hp-gk" title="${esc(TIP.tout)}">tokens out</span><span class="hp-gv" id="hp-tout" title="${esc(TIP.tout)}">--</span>
              <span class="hp-gk" title="${esc(TIP.ptoks)}">prompt tok/s</span><span class="hp-gv" id="hp-ptoks" title="${esc(TIP.ptoks)}">--</span>
              <span class="hp-gk" title="${esc(TIP.gtoks)}">gen tok/s</span><span class="hp-gv" id="hp-gtoks" title="${esc(TIP.gtoks)}">--</span>
              <span class="hp-gk" title="${esc(TIP.ttft)}">time to 1st tok</span><span class="hp-gv" id="hp-ttft" title="${esc(TIP.ttft)}">--</span>
              <span class="hp-gk" title="${esc(TIP.total)}">total time</span><span class="hp-gv" id="hp-total" title="${esc(TIP.total)}">--</span>
              <span class="hp-gk" title="${esc(TIP.mode)}">mode</span><span class="hp-gv" id="hp-genmode" title="${esc(TIP.mode)}">--</span>
              <span class="hp-gk" title="${esc(TIP.form)}">form</span><span class="hp-gv" id="hp-genform" title="${esc(TIP.form)}">--</span>
              <span class="hp-gk" title="${esc(TIP.anger)}">anger felt</span><span class="hp-gv" id="hp-anger" title="${esc(TIP.anger)}">--</span>
              <span class="hp-gk" title="${esc(TIP.expressed)}">expressed</span><span class="hp-gv" id="hp-expressed" title="${esc(TIP.expressed)}">--</span>
              <span class="hp-gk" title="${esc(TIP.ctx)}">context</span><span class="hp-gv" id="hp-ctx" title="${esc(TIP.ctx)}">--</span>
              <span class="hp-gk" title="${esc(TIP.threads)}">threads</span><span class="hp-gv" id="hp-threads" title="${esc(TIP.threads)}">--</span>
              <span class="hp-gk" title="${esc(TIP.nctx)}">num_ctx</span><span class="hp-gv" id="hp-nctx" title="${esc(TIP.nctx)}">--</span>
              <span class="hp-gk" title="${esc(TIP.poll)}">polls</span><span class="hp-gv" id="hp-poll" title="${esc(TIP.poll)}">--</span>
            </div>
            <div class="hp-modelrow" title="${esc(TIP.model)}"><span class="hp-gk">model</span>
              <span class="hp-model" id="hp-model">--</span></div>
            <div class="hp-errrow" id="hp-errrow" title="${esc(TIP.err)}" hidden><span class="hp-gk">last error</span>
              <span class="hp-err" id="hp-err"></span></div>
          </div>
        </div>
      </details>`;
    this.cpu = this.hostEl.querySelector('#hp-cpu');
    this.cpuBar = this.hostEl.querySelector('#hp-cpu-bar');
    this.mem = this.hostEl.querySelector('#hp-mem');
    this.memBar = this.hostEl.querySelector('#hp-mem-bar');
    this.memMb = this.hostEl.querySelector('#hp-memmb');
    this.cyCpu = this.hostEl.querySelector('#hp-cycpu');
    this.cyCpuBar = this.hostEl.querySelector('#hp-cycpu-bar');
    this.modelMb = this.hostEl.querySelector('#hp-modelmb');
    this.modelMeta = this.hostEl.querySelector('#hp-modelmeta');
    this.cyMemMb = this.hostEl.querySelector('#hp-cymemmb');
    this.nodeMb = this.hostEl.querySelector('#hp-nodemb');
    this.otherCpu = this.hostEl.querySelector('#hp-othercpu');
    this.otherCpuBar = this.hostEl.querySelector('#hp-othercpu-bar');
    this.otherMb = this.hostEl.querySelector('#hp-othermb');
    // diagnostics readouts
    this.g = {};
    for (const id of [
      'peval', 'peval-note', 'tin', 'tout', 'ptoks', 'gtoks', 'ttft', 'total',
      'ctx', 'genmode', 'genform', 'anger', 'expressed', 'threads', 'nctx', 'poll', 'model', 'err', 'errrow',
      // LIVE group
      'live-cpu', 'live-mem', 'live-watts', 'live-viewers', 'live-duty', 'live-phase',
      // LAST GENERATION snapshot: age + wall-clock
      'genage', 'genwhen',
      // cycle outcomes
      'cyc-n', 'cyc-grid', 'cyc-stall',
    ]) {
      this.g[id] = this.hostEl.querySelector('#hp-' + id);
    }
    this.snap = this.hostEl.querySelector('#hp-snap');
    this.cyclesBox = this.hostEl.querySelector('#hp-cycles');
    // the frozen snapshot's capture time (ms) and a 1s ticker that ages it live so
    // an owner can see at a glance how stale the LAST GENERATION figures are.
    this._genAt = null;
    this._ageTimer = setInterval(() => this._tickAge(), 1000);
  }

  // ---- LAST GENERATION snapshot age: count up live, fade when stale ----------
  // The main thing the owner asked for: it must be obvious at a glance how old the
  // snapshot is. Runs every second off the capture time stamped in setGen.
  _tickAge() {
    if (this._genAt == null || !this.g.genage) return;
    const age = Date.now() - this._genAt;
    this.g.genage.textContent = fmtAge(age) + ' ago';
    if (!this.snap) return;
    // past a couple of minutes the group is STALE - mark it and fade it so the old
    // numbers can never be mistaken for current readings. A gentle progressive fade
    // begins earlier and bottoms out at 0.45 so it stays just readable.
    const stale = age > 120000;
    this.snap.classList.toggle('stale', stale);
    const op = Math.max(0.45, 1 - Math.max(0, age - 15000) / 240000);
    this.snap.style.opacity = op.toFixed(2);
  }

  // Render the cycle-outcome tally (from the continuous host channel, so it updates
  // even while `gen` events have stopped - which is exactly what a stall is).
  _setCycles(c) {
    if (!c || !this.g['cyc-grid']) return;
    const counts = c.counts || {};
    if (this.g['cyc-n']) this.g['cyc-n'].textContent = String(c.window ?? '--');
    // priority order + short labels; the five the owner named first, then the rest.
    const ROWS = [
      ['emitted', 'emitted', 'good'],
      ['discarded-repeat', 'discarded', 'warm'],
      ['empty-provider', 'empty (provider)', 'warm'],
      ['empty-stripped', 'empty (stripped)', 'warm'],
      ['empty', 'empty (draw)', 'warm'],
      ['blocked-by-warden', 'blocked', 'warm'],
      ['deliberate-silence', 'silent', ''],
      ['throttled', 'throttled', ''],
      ['aborted', 'aborted', 'warm'],
    ];
    let html = '';
    for (const [key, label, cls] of ROWS) {
      const n = counts[key] || 0;
      const dim = n === 0 ? ' hp-cyc-zero' : '';
      const tone = n > 0 && cls ? ' ' + cls : '';
      html += `<span class="hp-cyc-k${dim}">${label}</span>` +
        `<span class="hp-cyc-v${tone}${dim}">${n}</span>`;
    }
    this.g['cyc-grid'].innerHTML = html;
    // STALL: over the whole window nothing emitted while other cycles happened.
    const others = Object.keys(counts).reduce((a, k) => a + (k === 'emitted' ? 0 : (counts[k] || 0)), 0);
    const stall = (counts.emitted || 0) === 0 && others > 0;
    if (this.g['cyc-stall']) this.g['cyc-stall'].hidden = !stall;
    if (this.cyclesBox) this.cyclesBox.classList.toggle('stall', stall);
  }

  setHost(p) {
    if (!p) return;
    // accept both runner (camelCase) and spec (snake_case) shapes
    const cpu = num(p.cpu);
    const memPct = num(p.memPct ?? p.mem_pct);
    const memMb = num(p.memMB ?? p.mem_mb);
    const memTotalMb = num(p.memTotalMB ?? p.mem_total_mb);
    const cyCpu = num(p.cyCpu ?? p.cy_cpu);
    const modelMb = num(p.modelMB ?? p.model_mb); // real footprint (ollama ps)
    const modelProc = p.modelProc ?? p.model_proc ?? null;
    const modelCtx = num(p.modelCtx ?? p.model_ctx);
    const cyMemMb = num(p.cyMemMB ?? p.cy_mem_mb); // ollama process WS (misleading)
    const nodeMb = num(p.nodeMB ?? p.node_mb);
    // SYSTEM (measured)
    if (cpu != null) {
      this.cpu.textContent = cpu.toFixed(0) + '%';
      this.cpuBar.style.width = clampPct(cpu) + '%';
      this.cpuBar.classList.toggle('hot', cpu > 85);
    }
    if (memPct != null) {
      this.mem.textContent = memPct.toFixed(0) + '%';
      this.memBar.style.width = clampPct(memPct) + '%';
      this.memBar.classList.toggle('hot', memPct > 85);
    }
    if (memMb != null) {
      this.memMb.textContent =
        Math.round(memMb).toLocaleString() +
        (memTotalMb != null ? ' / ' + Math.round(memTotalMb).toLocaleString() : '') +
        ' MB';
    }
    // CY (measured). Null until the first per-process / ps probe lands - leave the
    // dash placeholder rather than showing a dishonest 0.
    if (cyCpu != null) {
      this.cyCpu.textContent = cyCpu.toFixed(0) + '%';
      this.cyCpuBar.style.width = clampPct(cyCpu) + '%';
      this.cyCpuBar.classList.toggle('hot', cyCpu > 85);
    }
    if (modelMb != null) this.modelMb.textContent = Math.round(modelMb).toLocaleString() + ' MB';
    if (this.modelMeta) {
      // processor split + context length under the footprint - the rest of what
      // ollama ps reports, so the honest figure is fully sourced.
      const bits = ['memory-mapped'];
      if (modelProc) bits.push(String(modelProc));
      if (modelCtx != null) bits.push(Math.round(modelCtx).toLocaleString() + ' ctx');
      this.modelMeta.textContent = bits.join(' · ');
    }
    if (cyMemMb != null) this.cyMemMb.textContent = Math.round(cyMemMb).toLocaleString() + ' MB';
    if (nodeMb != null) this.nodeMb.textContent = Math.round(nodeMb).toLocaleString() + ' MB';
    // OTHER (derived): the remainder so SYSTEM = CY + OTHER visibly. Any missing
    // input -> '--' rather than a made-up number (honest accounting).
    if (this.otherCpu) {
      const oc = cpu != null && cyCpu != null ? Math.max(0, cpu - cyCpu) : null;
      if (oc != null) {
        this.otherCpu.textContent = oc.toFixed(0) + '%';
        this.otherCpuBar.style.width = clampPct(oc) + '%';
      } else {
        this.otherCpu.textContent = '--%';
        this.otherCpuBar.style.width = '0%';
      }
    }
    if (this.otherMb) {
      // system used minus Cy's three parts. The model footprint is the dominant
      // real number; the mmap'd pages ARE part of system used, so subtracting the
      // footprint (plus the small WS + runner RSS) leaves everything that is not Cy.
      const om =
        memMb != null && modelMb != null
          ? Math.max(0, memMb - modelMb - (cyMemMb || 0) - (nodeMb || 0))
          : null;
      this.otherMb.textContent = om != null ? Math.round(om).toLocaleString() + ' MB' : '-- MB';
    }

    // ---- LIVE diagnostics group (continuously sampled, not a snapshot) ----
    const g = this.g;
    setTxt(g['live-cpu'], cpu, (v) => v.toFixed(0) + '%');
    setTxt(g['live-mem'], memPct, (v) => v.toFixed(0) + '%');
    setTxt(g['live-watts'], num(p.watts), (v) => v.toFixed(0) + ' W');
    setTxt(g['live-viewers'], num(p.viewers), (v) => String(Math.round(v)));
    setTxt(g['live-duty'], num(p.duty), (v) => Math.round(v) + '%');
    if (g['live-phase'] && p.inferPhase != null) {
      const ph = String(p.inferPhase);
      g['live-phase'].textContent = ph;
      // eval = reading (amber), gen = writing (green), idle = nothing (dim)
      g['live-phase'].classList.toggle('good', ph === 'gen');
      g['live-phase'].classList.toggle('warm', ph === 'eval');
      g['live-phase'].classList.toggle('hp-cyc-zero', ph === 'idle');
    }
    // cycle outcomes ride the host channel so they keep updating during a stall
    if (p.cycles) this._setCycles(p.cycles);
  }

  // Live generation telemetry from the `gen` event. prompt_eval_count is given
  // prominence and an at-a-glance interpretation: a small value means the cached
  // prefix was reused; a large one means the cache was invalidated (slow burst).
  setGen(p) {
    if (!p) return;
    const g = this.g;
    // FREEZE THE SNAPSHOT CLOCK. A `gen` event arrives when a burst completes, so
    // stamp now as the capture time; the 1s ticker ages it live from here and the
    // wall-clock is shown alongside so staleness is obvious at a glance.
    this._genAt = Date.now();
    const d = new Date(this._genAt);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    if (g.genwhen) g.genwhen.textContent = `taken ${hh}:${mm}:${ss}`;
    if (this.snap) {
      this.snap.classList.remove('stale'); // fresh: clear any prior stale marking
      this.snap.style.opacity = '1';
    }
    if (g.genage) g.genage.textContent = '0m 00s ago';
    const tin = num(p.tokens_in ?? p.prompt_eval_count);
    if (tin != null) {
      g.peval.textContent = tin.toLocaleString();
      // rough expectation: a cached prefix re-reads only a few dozen tokens; a
      // few hundred+ means the KV cache was thrown away and the briefing re-read.
      const reused = tin <= 80;
      g.peval.classList.toggle('warm', !reused);
      g.peval.classList.toggle('good', reused);
      g['peval-note'].textContent = reused
        ? 'small -> cached notes reused (fast). expect a few dozen.'
        : 'large -> cache reset, whole briefing re-read (slow burst).';
    }
    setTxt(g.tin, num(p.tokens_in), (v) => v.toLocaleString());
    setTxt(g.tout, num(p.tokens_out), (v) => v.toLocaleString());
    setTxt(g.ptoks, num(p.prompt_tok_s), (v) => v.toFixed(0) + ' t/s');
    setTxt(g.gtoks, num(p.gen_tok_s), (v) => v.toFixed(1) + ' t/s');
    setTxt(g.ttft, num(p.ttft_ms), (v) => Math.round(v).toLocaleString() + ' ms');
    setTxt(g.total, num(p.total_ms), (v) => Math.round(v).toLocaleString() + ' ms');
    setTxt(g.ctx, num(p.ctx_chars), (v) => Math.round(v).toLocaleString() + ' ch');
    if (p.mode) g.genmode.textContent = String(p.mode);
    // the form directive that shaped this burst - trimmed to a short label
    if (g.genform && p.form != null) g.genform.textContent = shortForm(String(p.form));
    // felt anger vs the outward expressed value - the gap between them is the lag.
    setTxt(g.anger, num(p.anger), (v) => v.toFixed(2));
    setTxt(g.expressed, num(p.expressed), (v) => v.toFixed(2));
    if (g.expressed && num(p.anger) != null && num(p.expressed) != null) {
      g.expressed.classList.toggle('warm', p.expressed < p.anger - 0.05); // rising, page lagging behind
    }
    setTxt(g.threads, num(p.threads), (v) => String(Math.round(v)));
    setTxt(g.nctx, num(p.num_ctx), (v) => v.toLocaleString());
    if (p.inbox_ok != null || p.tempo_ok != null) {
      const mk = (ok) => (ok == null ? '?' : ok ? 'ok' : 'FAIL');
      g.poll.textContent = 'mail ' + mk(p.inbox_ok) + ' / tempo ' + mk(p.tempo_ok);
      g.poll.classList.toggle('warm', p.inbox_ok === false || p.tempo_ok === false);
    }
    if (p.model) g.model.textContent = shortModel(String(p.model));
    if (p.last_error) {
      g.err.textContent = String(p.last_error);
      g.errrow.hidden = false;
    } else {
      g.errrow.hidden = true;
    }
  }

  // ---- mail column ------------------------------------------------------

  _once(kind, id) {
    if (id == null) return true; // no id -> always show
    const key = kind + ':' + id;
    if (this._seen.has(key)) return false;
    this._seen.add(key);
    return true;
  }

  _push(node) {
    // newest at the top; cap the column so a long-open tab stays bounded
    this.mailEl.insertBefore(node, this.mailEl.firstChild);
    while (this.mailEl.children.length > 60) this.mailEl.lastChild.remove();
  }

  // An incoming postcard: text on one side, an image on the other (either may
  // be absent). image is a webroot-relative path; attrib is any credit line.
  addPostcardIn(p) {
    if (!this._once('postcard_in', p.id)) return;
    const el = document.createElement('div');
    el.className = 'mail postcard-in';
    const img = p.image
      ? `<img class="mail-img" loading="lazy" alt="a postcard picture" src="${esc(p.image)}">`
      : '';
    const attrib = p.image && p.attrib ? `<div class="mail-cap">${esc(p.attrib)}</div>` : '';
    const body = p.body ? `<div class="mail-body">${esc(p.body)}</div>` : '';
    el.innerHTML =
      `<div class="mail-h"><span class="mail-tag">POSTCARD</span>` +
      `<span class="mail-from">from ${esc(p.from || 'anonymous')}</span></div>` +
      img + attrib + body;
    this._push(el);
  }

  addPostcardOut(p) {
    if (!this._once('postcard_out', p.id)) return;
    const el = document.createElement('div');
    el.className = 'mail letter-out';
    el.innerHTML =
      `<div class="mail-h"><span class="mail-tag out">7734 REPLIES</span></div>` +
      `<div class="mail-body">${esc(p.body)}</div>`;
    this._push(el);
  }

  addNewsIn(p) {
    if (!this._once('news_in', p.id)) return;
    const el = document.createElement('div');
    el.className = 'mail news-in';
    el.innerHTML =
      `<div class="mail-h"><span class="mail-tag">NEWS</span>` +
      `<span class="mail-from">${esc(p.source || '')}</span></div>` +
      `<div class="mail-body">${esc(p.headline)}</div>`;
    this._push(el);
  }
}

function num(x) {
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(+x)) return +x;
  return null;
}
function clampPct(x) {
  return Math.max(0, Math.min(100, x));
}
// Write a formatted number into a cell, leaving the dash placeholder if null.
function setTxt(el, v, fmt) {
  if (!el || v == null) return;
  el.textContent = fmt ? fmt(v) : String(v);
}
// Trim the long ollama tag (org/repo path + quant) down to a readable label.
function shortModel(m) {
  let s = m.split('/').pop() || m; // drop any hf.co/org/ path
  s = s.replace(/-GGUF/i, '').replace(/\.gguf$/i, '');
  return s;
}
// A live-counting age: 'h m s' over an hour, 'm s' under it. Seconds always
// zero-padded so the readout does not jitter in width as it counts up.
function fmtAge(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${ss}s`;
  return `${m}m ${ss}s`;
}
// The form directive is a whole sentence ('FORM: a train of thought...'); keep a
// short readable label - drop the 'FORM:' lead and clip to the first clause.
function shortForm(f) {
  let s = f.replace(/^\s*FORM:\s*/i, '').trim();
  s = s.split(/[.;\n]/)[0].trim();
  return s.length > 40 ? s.slice(0, 39) + '...' : s || '--';
}
