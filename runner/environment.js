// environment.js - concrete, structured events in Cy's prison day.
//
// The clock decides when an opportunity happens. The selected outcome records
// what actually happened and carries explicit body/social meaning into Soma.
// Nothing here reads or writes language-model output.

const pick = (items, rnd) => items[Math.min(items.length - 1, Math.floor(rnd() * items.length))];

export const PRISON_SCHEDULE = [
  { kind: 'wake', mins: 6 * 60 + 30 },
  { kind: 'meal', meal: 'breakfast', mins: 7 * 60 + 30 },
  { kind: 'routine', routine: 'shower', mins: 9 * 60 + 15 },
  { kind: 'routine', routine: 'association', mins: 10 * 60 + 15 },
  { kind: 'meal', meal: 'lunch', mins: 11 * 60 + 45 },
  { kind: 'routine', routine: 'exercise', mins: 14 * 60 + 15 },
  { kind: 'meal', meal: 'tea', mins: 16 * 60 + 45 },
  { kind: 'routine', routine: 'phone', mins: 19 * 60 },
  { kind: 'sleep', mins: 22 * 60 + 30 },
];

const MEAL_LABELS = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  tea: 'tea',
};

export function chooseMealEvent(meal, rnd = Math.random) {
  const label = MEAL_LABELS[meal] || 'meal';
  const roll = rnd();
  let outcome = 'eaten';
  let amount = 1;
  let text = `${label} came and he ate it`;
  let appraisal = { deprivation: 0.02, controlLoss: 0.03 };
  if (roll >= 0.82 && roll < 0.93) {
    outcome = 'partial';
    amount = 0.45;
    text = `${label} came but he could only eat some of it`;
    appraisal = { deprivation: 0.24, controlLoss: 0.08 };
  } else if (roll >= 0.93 && roll < 0.98) {
    outcome = 'missed';
    amount = 0;
    text = `${label} did not reach him before the door shut`;
    appraisal = { deprivation: 0.72, controlLoss: 0.68 };
  } else if (roll >= 0.98) {
    outcome = 'refused';
    amount = 0;
    text = `${label} came but he could not make himself eat it`;
    appraisal = { deprivation: 0.5, controlLoss: 0.2 };
  }
  return {
    name: `${label}_${outcome}`,
    text,
    tags: ['meal', 'food', label, outcome],
    public: { meal: label, outcome },
    body: { meal: { name: label, outcome, amount } },
    appraisal,
    outcome: `${label} ${outcome}`,
  };
}

const ROUTINES = {
  shower: [
    {
      name: 'shower_warm',
      text: 'the shower stayed warm long enough to wash properly',
      tags: ['routine', 'shower', 'warm', 'relief'],
      effects: [
        { metric: 'pain', amount: -5, description: 'warm water eased bodily discomfort' },
        { metric: 'arousal', amount: -7, description: 'a quiet shower lowered immediate activation' },
      ],
      appraisal: { threat: 0.02, controlLoss: 0.04 },
    },
    {
      name: 'shower_cold',
      text: 'the shower ran cold before the soap was off',
      tags: ['routine', 'shower', 'cold', 'discomfort'],
      effects: [
        { metric: 'pain', amount: 5, description: 'cold water added bodily discomfort' },
        { metric: 'arousal', amount: 7, description: 'the cold shower caused a brief bodily jolt' },
      ],
      appraisal: { threat: 0.08, controlLoss: 0.32 },
    },
    {
      name: 'shower_missed',
      text: 'the shower list moved on before his turn',
      tags: ['routine', 'shower', 'missed', 'deprivation'],
      effects: [{ metric: 'anger', amount: 7, description: 'missing the shower felt unfair' }],
      appraisal: { deprivation: 0.28, controlLoss: 0.55 },
    },
  ],
  association: [
    {
      name: 'association_quiet_company',
      text: 'sat with the others for a while without any trouble',
      tags: ['routine', 'association', 'social', 'company'],
      social: { quality: 'ordinary', strength: 0.48 },
      appraisal: { affiliation: 0.48, threat: 0.04, controlLoss: 0.04 },
    },
    {
      name: 'association_shared_joke',
      text: 'someone made him laugh on association and did not make a thing of it',
      tags: ['routine', 'association', 'social', 'supportive'],
      social: { quality: 'supportive', strength: 0.72 },
      appraisal: { affiliation: 0.72, threat: 0.02, controlLoss: 0.02 },
    },
    {
      name: 'association_kept_apart',
      text: 'association happened around him but nobody made room',
      tags: ['routine', 'association', 'social', 'rejection'],
      social: { quality: 'rejecting', strength: 0.52 },
      appraisal: { affiliation: 0.02, deprivation: 0.46, controlLoss: 0.22 },
    },
  ],
  exercise: [
    {
      name: 'yard_exercise',
      text: 'got a turn round the yard and kept moving until bang-up',
      tags: ['routine', 'yard', 'exercise', 'movement'],
      effects: [
        { metric: 'arousal', amount: -9, description: 'movement in the yard discharged some activation' },
        { metric: 'rumination', amount: -6, description: 'walking interrupted the fixed train of thought' },
        { metric: 'fatigue', amount: 4, description: 'exercise left a short-lived physical tiredness' },
      ],
      appraisal: { threat: 0.03, controlLoss: 0.03 },
    },
    {
      name: 'yard_bench_company',
      text: 'shared the yard bench with someone who was easy enough company',
      tags: ['routine', 'yard', 'social', 'company'],
      social: { quality: 'ordinary', strength: 0.55 },
      appraisal: { affiliation: 0.55, threat: 0.04, controlLoss: 0.04 },
    },
    {
      name: 'yard_cancelled',
      text: 'yard was cancelled and the door stayed shut',
      tags: ['routine', 'yard', 'cancelled', 'deprivation'],
      effects: [
        { metric: 'anger', amount: 8, description: 'losing yard felt unfair' },
        { metric: 'rumination', amount: 5, description: 'another closed door left more time to fixate' },
      ],
      appraisal: { deprivation: 0.42, controlLoss: 0.65 },
    },
  ],
  phone: [
    {
      name: 'phone_call_connected',
      text: 'the phone call connected and the voice at the other end stayed for the whole slot',
      tags: ['routine', 'phone', 'social', 'supportive'],
      social: { quality: 'supportive', strength: 0.86 },
      appraisal: { affiliation: 0.86, threat: 0.02, controlLoss: 0.03 },
    },
    {
      name: 'phone_no_answer',
      text: 'the phone rang out until the slot ended',
      tags: ['routine', 'phone', 'social', 'rejection'],
      social: { quality: 'absent', strength: 0.62 },
      appraisal: { affiliation: 0, deprivation: 0.62, controlLoss: 0.36 },
    },
    {
      name: 'phone_queue_missed',
      text: 'the phone queue never reached him before bang-up',
      tags: ['routine', 'phone', 'missed', 'deprivation'],
      social: { quality: 'absent', strength: 0.48 },
      appraisal: { affiliation: 0, deprivation: 0.48, controlLoss: 0.58 },
    },
  ],
};

export function chooseRoutineEvent(routine, rnd = Math.random) {
  const choices = ROUTINES[routine];
  if (!choices || !choices.length) throw new Error(`unknown prison routine: ${routine}`);
  const chosen = pick(choices, rnd);
  return {
    ...chosen,
    tags: [...chosen.tags],
    effects: (chosen.effects || []).map((effect) => ({ ...effect })),
    social: chosen.social ? { ...chosen.social } : null,
    appraisal: { ...(chosen.appraisal || {}) },
    public: { routine, outcome: chosen.name },
    outcome: chosen.name,
  };
}

export function materialiseScheduledEvent(slot, rnd = Math.random) {
  if (slot.kind === 'meal') return chooseMealEvent(slot.meal, rnd);
  if (slot.kind === 'routine') return chooseRoutineEvent(slot.routine, rnd);
  if (slot.kind === 'wake') {
    return {
      name: 'lights_on', text: 'lights on and the night ended', tags: ['regime', 'sleep', 'wake'],
      body: { sleep: { outcome: 'ended' } }, public: {}, appraisal: { controlLoss: 0.08 }, outcome: 'awake',
    };
  }
  return {
    name: 'lights_out', text: 'lights out and the cell settled into night', tags: ['regime', 'sleep', 'night'],
    body: { sleep: { outcome: 'started' } }, public: {}, appraisal: { controlLoss: 0.05 }, outcome: 'asleep',
  };
}
