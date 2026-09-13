// character-output.js - deterministic waking-prose validation and one safe retry.
//
// The provider sometimes treats Cy's continuation prompt as an editing exercise.
// This module keeps that failure out of every waking prose path. It never sends
// the rejected text back to the model: the retry receives the original Cy/world
// prompt plus one short output-only instruction.

import { assistantFrameHits, looksLikeAssistantFrame } from './warden.js';

export const CHARACTER_REPAIR_INSTRUCTION =
  "Return only the inmate's next in-character text. No commentary about writing, " +
  'rewriting, instructions, style, prompts or the task.';

export function characterRepairPrompt(originalPrompt) {
  return `${originalPrompt}\n\n${CHARACTER_REPAIR_INSTRUCTION}`;
}

export function validateCharacterCandidate(candidate) {
  const text = String(candidate || '');
  if (!looksLikeAssistantFrame(text)) return { ok: true, reasons: [] };
  const hits = assistantFrameHits(text);
  return {
    ok: false,
    reasons: hits.length ? hits : ['assistant/meta writing frame'],
  };
}

// `generate` returns a provider result with a `candidate` string. Error,
// refusal and abort results pass straight through: they are transport outcomes,
// not character failures, and should not trigger an expensive repair call.
export async function generateWithCharacterRepair({
  prompt,
  generate,
  validate = validateCharacterCandidate,
  onDiagnostic = async () => {},
}) {
  const initial = await generate(prompt, { repair: false });
  if (initial.error || initial.refused || initial.aborted) return initial;

  const initialValidation = validate(initial.candidate);
  if (initialValidation.ok) {
    return {
      ...initial,
      characterValidation: {
        initial: initialValidation,
        repairAttempted: false,
        finalAction: 'accepted',
      },
    };
  }

  const repairPrompt = characterRepairPrompt(prompt);
  const repair = await generate(repairPrompt, { repair: true });
  const repairValidation = repair.error || repair.refused || repair.aborted
    ? { ok: false, reasons: [repair.error ? 'provider error' : repair.refused ? 'provider refusal' : 'generation aborted'] }
    : validate(repair.candidate);
  const accepted = repairValidation.ok;
  const diagnostic = {
    initialCandidate: initial.candidate || '',
    initialValidation,
    repairInstruction: CHARACTER_REPAIR_INSTRUCTION,
    repairPrompt,
    repairCandidate: repair.candidate || '',
    repairValidation,
    finalAction: accepted ? 'accepted' : 'discarded-to-silence',
  };
  await onDiagnostic(diagnostic);

  if (!accepted) {
    return {
      ...repair,
      candidate: '',
      full: '',
      assistantFrame: true,
      characterDiscarded: true,
      characterValidation: {
        initial: initialValidation,
        repair: repairValidation,
        repairAttempted: true,
        finalAction: 'discarded-to-silence',
      },
    };
  }

  return {
    ...repair,
    characterValidation: {
      initial: initialValidation,
      repair: repairValidation,
      repairAttempted: true,
      finalAction: 'accepted',
    },
  };
}
