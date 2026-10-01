import assert from 'node:assert/strict';
import { Power, POWER_WINDOW_MS } from '../public/assets/power.js';

const T = Date.parse('2026-10-01T12:00:00Z');

function panel() {
  const nodes = new Map();
  const root = {
    classList: { add() {} },
    innerHTML: '',
    querySelector(selector) {
      if (!nodes.has(selector)) {
        nodes.set(selector, {
          textContent: '', style: {}, attributes: {},
          setAttribute(name, value) { this.attributes[name] = value; },
        });
      }
      return nodes.get(selector);
    },
  };
  return { power: new Power(root), nodes };
}

function sample(t, watts, cost = 1) {
  return {
    t_ms: t, watts, watts_min: watts - 1, watts_max: watts + 1,
    watts_inst: watts, cost_total: cost, cost_per_hour: 0.015, kwh_total: cost,
  };
}

function pointTimes(power) {
  return power.points.map((point) => point.t);
}

function chartXs(nodes) {
  return [...nodes.get('#pw-line').attributes.d.matchAll(/[ML]([\d.]+) /g)]
    .map((match) => Number(match[1]));
}

const { power, nodes } = panel();
power.push(sample(T, 40, 1.01));
power.push(sample(T + 3000, 45, 1.02));
assert.deepEqual(pointTimes(power), [T, T + 3000], 'normal samples are chronological');
assert.equal(nodes.get('#pw-watts').textContent, '45 W');

power.push(sample(T + 1000, 42, 1.015));
assert.deepEqual(pointTimes(power), [T, T + 1000, T + 3000],
  'late older measurement is inserted by measurement time');
assert.equal(nodes.get('#pw-watts').textContent, '45 W',
  'late arrival cannot replace the current measurement');
assert.equal(nodes.get('#pw-cost').textContent, '1.02');
assert.deepEqual(chartXs(nodes), [...chartXs(nodes)].sort((a, b) => a - b),
  'graph path follows chronological measurement order');

power.push(sample(T + 1000, 42, 1.015));
assert.equal(power.points.length, 3, 'identical live replay does not add a point');
power.push(sample(T + 3000, 50, 1.03));
assert.deepEqual(pointTimes(power), [T, T + 1000, T + 3000, T + 3000],
  'different measurements at the same millisecond are not collapsed');
assert.equal(nodes.get('#pw-watts').textContent, '50 W',
  'the later received distinct reading wins the equal-time headline tie');
power.push(sample(T + 3000, 45, 1.02));
assert.equal(power.points.length, 4, 'replaying one equal-time reading does not grow the chart');
assert.equal(nodes.get('#pw-watts').textContent, '50 W',
  'replaying an earlier equal-time reading does not change the tie winner');

const reconnected = panel();
reconnected.power.push(sample(T + 6000, 60, 1.06));
reconnected.power.loadHistory([
  { ts: '2026-10-01 12:00:03.000', payload: sample(T + 3000, 45, 1.02) },
  { ts: '2026-10-01 12:00:00.000', payload: sample(T, 40, 1.01) },
  { ts: '2026-10-01 12:00:06.000', payload: sample(T + 6000, 60, 1.06) },
]);
assert.deepEqual(pointTimes(reconnected.power), [T, T + 3000, T + 6000],
  'history/live overlap merges chronologically without duplicate points');
assert.equal(reconnected.nodes.get('#pw-watts').textContent, '60 W');
reconnected.power.push(sample(T + 3000, 45, 1.02));
assert.equal(reconnected.power.points.length, 3,
  'older stream replay after history load does not duplicate the sample');
assert.equal(reconnected.nodes.get('#pw-watts').textContent, '60 W');
for (let i = 0; i < 20; i += 1) {
  reconnected.power.loadHistory([{ payload: sample(T + 6000, 60, 1.06) }]);
  reconnected.power.push(sample(T + 6000, 60, 1.06));
}
assert.equal(reconnected.power.points.length, 3, 'repeated reconnect overlap stays bounded');
reconnected.power.push(sample(T + 6000 - POWER_WINDOW_MS - 1, 30, 0.5));
assert.deepEqual(pointTimes(reconnected.power), [T, T + 3000, T + 6000],
  'late samples outside the newest rolling window are discarded');

console.log('power_samples.test.js: all checks passed');
