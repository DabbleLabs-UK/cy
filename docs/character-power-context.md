# Character power-context boundary

The application estimates host power from CPU utilisation, integrates kWh, and
prices it using the configured tariff. These are operator/public accounting
figures, not observations available to Cy. No existing world event establishes
a physical meter, billing explanation, payer, or technical transport for them.

## Narrow correction

`runner/power.js::costInjection` now returns an empty string for every snapshot.
The compatibility hook remains so its existing call sites and cadence do not
change. It no longer tells Cy that he is switched on, that his thoughts accrue
electricity charges, or that Warden Florian pays for his existence. No substitute
sensory claim is invented. No character-facing power information remains from
this hook.

The live shared context builder calls it for journal, postcard/letter, drawing
and warden generation. The diagnostic `selftest`, `livesample` and
`promptcachetest` use the same hook. Existing prompt builders omit empty cost
slots; dream/sleep paths already omit the injection.

## Deliberately unchanged

- The complete `PowerMeter` implementation, configured tariff and persisted
  totals/start time.
- One-second sampling, three-second public telemetry, thirty-second save timer,
  whole-pound crossing bookkeeping and the legacy injection-hook cadence.
- Public power/cost graph, history API and database, UI labels and calculations.
- The whole-pound Soma diagnostic remains private legacy evidence. It is not a
  canonical observed environment event, cannot form a grounded provisional
  memory, and is not emitted by the live grounded Soma prompt interface.
- Character knowledge, model/sampler, validators, journals, memory and AWG
  architecture, and historical records.

This removes the new explanatory injection, not historical text. Past public
entries and already-stored subjective material are not rewritten or keyword
filtered. It is not a general guarantee against model invention or against a
correspondent independently discussing electricity.

## Offline regression boundary

`runner/character-power-context.test.js` checks empty output for all accounting
snapshots; shared waking consumers; equivalence to an absent prompt slot;
exact fixed-power integration, tariff and persistence; private whole-pound
diagnostics; unchanged timer/publication wiring; and retained character/world
knowledge. No model call is needed to prove removal of this context source.

Only `runner/power.js` needs runtime deployment. No migration or state reset is
required.
