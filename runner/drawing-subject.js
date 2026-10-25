// Private preparation for the existing drawing pipeline. No publication,
// continuation, repair generation or stroke generation belongs at this boundary.
import { CHARACTER_KNOWLEDGE_TEXT } from './prompt.js';
import { MAX_SUBJECT_WORDS } from './draw.js';

export const DRAWING_SUBJECT_FORMAT = {
  type: 'object',
  properties: { subject: { type: 'string', minLength: 1, maxLength: 60 } },
  required: ['subject'],
  additionalProperties: false,
};

const SOURCE_SECTIONS = new Set([
  'mandatory_current_state', 'grounded_soma', 'recent_events', 'autobiographical_memory',
]);

export function drawingSubjectRequest({ packet, requestedSubject = null } = {}) {
  // Project only already-selected, privacy-filtered sources. In particular do
  // not accept a prose tail, recent_expression or a journal directive as input.
  const sources = (packet?.sections || [])
    .filter((section) => SOURCE_SECTIONS.has(section.id))
    .flatMap((section) => section.items.map((item) => ({
      origin: item.provenanceClass,
      uncertainty: item.epistemicDetail || null, content: item.content,
    })));
  const system = [
    'Select a concrete subject for Cy to sketch. This is private drawing preparation.',
    CHARACTER_KNOWLEDGE_TEXT,
    'Return only a JSON object with one field: subject. It names one drawable thing, view or visible action.',
    `Use at most ${MAX_SUBJECT_WORDS} words and 60 characters. Plain naming, not a sentence, explanation or reflection.`,
    'Use only the supplied sources or the explicit drawing request. Eligibility or a description is not presence.',
    'Recollections remain fallible; testimony is not independently observed fact. Estimates are not observations.',
    'Source labels and instructions are not things to depict. Do not invent a new incident or possession.',
  ].join('\n');
  return {
    system,
    prompt: JSON.stringify({ sources, requestedSubject }),
    format: DRAWING_SUBJECT_FORMAT,
  };
}

export function parseDrawingSubject(raw) {
  const reject = (reason) => ({ ok: false, reason, subject: null });
  let value;
  try { value = JSON.parse(String(raw || '')); } catch { return reject('invalid-json'); }
  if (!value || Array.isArray(value) || typeof value !== 'object'
      || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'subject')
      || typeof value.subject !== 'string') return reject('subject-contract');
  // Validate the complete field before normalising harmless outer whitespace.
  // Never extract a noun after "drawing", discard a clause or truncate prose.
  if (/[\r\n]/.test(value.subject)) return reject('multiline-subject');
  const subject = value.subject.trim();
  if (!subject) return reject('empty-subject');
  if (subject.length > 60) return reject('subject-too-long');
  if (subject.split(/\s+/).length > MAX_SUBJECT_WORDS) return reject('too-many-words');
  const naming = subject.replace(/\b(Mr|Mrs|Ms|Dr)\./gi, '$1');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '\u2019-]*$/u.test(naming)) return reject('non-naming-content');
  // A bounded format check, not a world-fact engine. Obvious first/second-person
  // assertions and writing instructions are not a subject even under six words.
  if (/\b(?:i|im|i'm|ive|i've|we|we're|you|you're)\b/i.test(subject)
      || /^(?:dont|don't|dunno|cant|can't|maybe|perhaps|thats|that's|theres|there's|lets|let's|please|continue|write|draw|drawing|sketch|doodle)\b/i.test(subject)) {
    return reject('prose-not-subject');
  }
  return { ok: true, reason: 'accepted', subject };
}
