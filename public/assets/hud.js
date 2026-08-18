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
            <span class="hp-gk" title="${esc(TIP.ctx)}">context</span><span class="hp-gv" id="hp-ctx" title="${esc(TIP.ctx)}">--</span>
            <span class="hp-gk" title="${esc(TIP.duty)}">duty cycle</span><span class="hp-gv" id="hp-duty" title="${esc(TIP.duty)}">--</span>
            <span class="hp-gk" title="${esc(TIP.mode)}">mode</span><span class="hp-gv" id="hp-genmode" title="${esc(TIP.mode)}">--</span>
            <span class="hp-gk" title="${esc(TIP.anger)}">anger felt</span><span class="hp-gv" id="hp-anger" title="${esc(TIP.anger)}">--</span>
            <span class="hp-gk" title="${esc(TIP.expressed)}">expressed</span><span class="hp-gv" id="hp-expressed" title="${esc(TIP.expressed)}">--</span>
            <span class="hp-gk" title="${esc(TIP.threads)}">threads</span><span class="hp-gv" id="hp-threads" title="${esc(TIP.threads)}">--</span>
            <span class="hp-gk" title="${esc(TIP.nctx)}">num_ctx</span><span class="hp-gv" id="hp-nctx" title="${esc(TIP.nctx)}">--</span>
            <span class="hp-gk" title="${esc(TIP.poll)}">polls</span><span class="hp-gv" id="hp-poll" title="${esc(TIP.poll)}">--</span>
          </div>
          <div class="hp-modelrow" title="${esc(TIP.model)}"><span class="hp-gk">model</span>
            <span class="hp-model" id="hp-model">--</span></div>
          <div class="hp-errrow" id="hp-errrow" title="${esc(TIP.err)}" hidden><span class="hp-gk">last error</span>
            <span class="hp-err" id="hp-err"></span></div>
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
      'ctx', 'duty', 'genmode', 'anger', 'expressed', 'threads', 'nctx', 'poll', 'model', 'err', 'errrow',
    ]) {
      this.g[id] = this.hostEl.querySelector('#hp-' + id);
    }
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
  }

  // Live generation telemetry from the `gen` event. prompt_eval_count is given
  // prominence and an at-a-glance interpretation: a small value means the cached
  // prefix was reused; a large one means the cache was invalidated (slow burst).
  setGen(p) {
    if (!p) return;
    const g = this.g;
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
    setTxt(g.duty, num(p.duty), (v) => Math.round(v) + '%');
    if (p.mode) g.genmode.textContent = String(p.mode);
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
