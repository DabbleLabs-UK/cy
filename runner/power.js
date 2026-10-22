// power.js - the electricity meter.
//
// CY runs on a Dell OptiPlex 3070 (i5-9500T). This estimates the machine's power
// draw continuously from real CPU utilisation, integrates it into kWh over time,
// prices it at a tariff, and PERSISTS the cumulative total so it accumulates over
// the whole life of the project - across restarts. These are application-side
// estimates for accounting and public telemetry, not observations made by Cy.
//
//   watts = idleWatts + loadFraction * (loadWatts - idleWatts)
//   loadFraction = CPU busy fraction sampled from os.cpus() deltas
//   kWh += watts/1000 * hoursElapsed;  cost = kWh * tariff

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import os from 'node:os';

const DEFAULTS = { idleWatts: 25, loadWatts: 55, tariff: 0.245 };

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const t in c.times) total += c.times[t];
    idle += c.times.idle;
  }
  return { idle, total };
}

export class PowerMeter {
  constructor(config, statePath) {
    const pw = (config && config.power) || {};
    this.idleWatts = pw.idleWatts ?? DEFAULTS.idleWatts;
    this.loadWatts = pw.loadWatts ?? DEFAULTS.loadWatts;
    this.tariff = pw.tariff ?? DEFAULTS.tariff;
    this.statePath = statePath;

    this.kwhTotal = 0;
    this.costTotal = 0;
    this.startTs = null; // life-of-project switch-on time
    this.lastTs = null; // last integration instant
    this.prevCpu = cpuTimes();
    this.loadFraction = 0;
    this.watts = this.idleWatts;
  }

  async load() {
    try {
      const j = JSON.parse(await readFile(this.statePath, 'utf8'));
      this.kwhTotal = Number(j.kwh_total) || 0;
      this.costTotal = Number(j.cost_total) || 0;
      this.startTs = Number(j.start_ts) || null;
    } catch {
      /* first run */
    }
    const now = Date.now();
    if (!this.startTs) this.startTs = now;
    this.lastTs = now;
    this.prevCpu = cpuTimes();
  }

  // Sample CPU and integrate the interval since the last call into kWh/cost.
  integrate(now = Date.now()) {
    const cur = cpuTimes();
    const idleD = cur.idle - this.prevCpu.idle;
    const totalD = cur.total - this.prevCpu.total;
    this.prevCpu = cur;
    const busy = totalD > 0 ? Math.max(0, Math.min(1, 1 - idleD / totalD)) : this.loadFraction;
    this.loadFraction = busy;
    this.watts = this.idleWatts + busy * (this.loadWatts - this.idleWatts);

    const dtH = Math.max(0, now - (this.lastTs || now)) / 3600000;
    this.lastTs = now;
    const kwh = (this.watts / 1000) * dtH;
    this.kwhTotal += kwh;
    this.costTotal = this.kwhTotal * this.tariff;
    return kwh;
  }

  snapshot(now = Date.now()) {
    return {
      watts: Number(this.watts.toFixed(1)),
      kwh_total: Number(this.kwhTotal.toFixed(6)),
      cost_total: Number(this.costTotal.toFixed(4)),
      cost_per_hour: Number(((this.watts / 1000) * this.tariff).toFixed(4)),
      uptime_s: Math.round((now - (this.startTs || now)) / 1000),
    };
  }

  async save() {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(
      this.statePath,
      JSON.stringify(
        { kwh_total: this.kwhTotal, cost_total: this.costTotal, start_ts: this.startTs, last_ts: this.lastTs },
        null,
        2,
      ),
    );
  }
}

// Compatibility hook shared by live prompt assembly and diagnostic tools.
// No world mechanic establishes Cy's access to the host's power/cost figures or
// billing. Omit them rather than inventing a meter, explanation or sensation.
// Keeping the hook leaves existing call cadence and power consequences intact.
export function costInjection(_snap) {
  return '';
}
