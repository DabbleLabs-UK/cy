// character-output.js - deterministic waking-prose validation and one safe retry.
//
// The provider sometimes treats Cy's continuation prompt as an editing exercise.
// This module keeps that failure out of every waking prose path. It never sends
// the rejected text back to the model: the retry receives the original Cy/world
// prompt plus one short output-only instruction.

import { assistantFrameHits, looksLikeAssistantFrame, malformedProseControlHits, normalizeWakingProse, sanitizeCharacterContext } from './warden.js';

export const CHARACTER_REPAIR_INSTRUCTION =
  "Return only the inmate's next in-character text. No commentary about writing, " +
  'rewriting, instructions, style, prompts or the task.';

export function characterRepairPrompt(originalPrompt) {
  return `${originalPrompt}\n\n${CHARACTER_REPAIR_INSTRUCTION}`;
}

export function validateCharacterCandidate(candidate) {
  const text = String(candidate || '');
  const malformedControls = malformedProseControlHits(text);
  const hasAssistantFrame = looksLikeAssistantFrame(text);
  if (!hasAssistantFrame && malformedControls.length === 0) return { ok: true, reasons: [] };
  const hits = hasAssistantFrame ? assistantFrameHits(text) : [];
  if (hasAssistantFrame && hits.length === 0) hits.push('assistant/meta writing frame');
  if (malformedControls.length) hits.push('malformed prose control fragment');
  return {
    ok: false,
    reasons: hits,
  };
}

// The observed journal leaks open a new clause after sentence punctuation or a
// pipe, then attach '<' directly to a tag-name-shaped word and another word.
// Match only that position (also output/line start), and only if no '>' closes
// the flat tag grammar before the next '<' or output end. This is not a rule
// about arbitrary unmatched angles, mathematical operands, or pipe punctuation.
const UNCLOSED_JOURNAL_CLAUSE_ANGLE = /(?:^|[.!?|\r\n])[ \t]*<[A-Za-z][A-Za-z0-9]*[ \t]+[A-Za-z][^<>]*(?=<|$)/;

export function validateJournalCandidate(candidate) {
  const validation = validateCharacterCandidate(candidate);
  if (!UNCLOSED_JOURNAL_CLAUSE_ANGLE.test(normalizeWakingProse(candidate))) return validation;
  return {
    ok: false,
    reasons: [...validation.reasons, 'unclosed clause-initial angle prefix'],
  };
}

// Counts reaching num_predict are not a provider termination reason. In
// particular, a normal stop can coincide with the configured token ceiling.
export function journalTerminationEvidence(stats) {
  const supplied = stats?.done_reason ?? stats?.finish_reason;
  const reason = typeof supplied === 'string' && supplied.trim()
    ? supplied.trim().toLowerCase() : null;
  return { reason, explicitLength: stats?.done !== false && reason === 'length' };
}

// A deliberately conservative surface-completion test, used ONLY when the
// provider explicitly reports length termination. It is not a grammar/fact
// checker. Ellipses do not establish completion of a mechanically stopped tail.
function hasCompleteJournalEnding(text) {
  const end = String(text || '').trimEnd();
  return /[\p{L}\p{N}][.!?]["')\]]*$/u.test(end)
    && !/(?:\.[ \t]*){2,}["')\]]*$/.test(end);
}

// Call on the exact staged publication, after all existing text filters. Check
// the original as well so filtering cannot disguise a length-truncated tail.
// This function never changes words, adds punctuation, or requests a repair.
export function validateJournalPublication(text, stats, originalText = text) {
  const termination = journalTerminationEvidence(stats);
  const validation = validateJournalCandidate(text);
  const reasons = [...validation.reasons];
  if (!String(text || '').trim()) reasons.push('empty final journal');
  if (sanitizeCharacterContext(text) !== text) {
    reasons.push('final journal would change under feedback sanitation');
  }
  if (termination.explicitLength
      && (!hasCompleteJournalEnding(originalText) || !hasCompleteJournalEnding(text))) {
    reasons.push('explicit length termination without a complete ending');
  }
  return { ok: reasons.length === 0, reasons, termination };
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

  const initialCandidate = normalizeWakingProse(initial.candidate);
  const initialValidation = validate(initialCandidate);
  if (initialValidation.ok) {
    return {
      ...initial,
      candidate: initialCandidate,
      characterValidation: {
        initial: initialValidation,
        repairAttempted: false,
        finalAction: 'accepted',
      },
    };
  }

  const repairPrompt = characterRepairPrompt(prompt);
  const repair = await generate(repairPrompt, { repair: true });
  const repairCandidate = normalizeWakingProse(repair.candidate);
  const repairValidation = repair.error || repair.refused || repair.aborted
    ? { ok: false, reasons: [repair.error ? 'provider error' : repair.refused ? 'provider refusal' : 'generation aborted'] }
    : validate(repairCandidate);
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
    candidate: repairCandidate,
    characterValidation: {
      initial: initialValidation,
      repair: repairValidation,
      repairAttempted: true,
      finalAction: 'accepted',
    },
  };
}
