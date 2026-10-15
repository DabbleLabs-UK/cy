// REHEARSAL-ONLY. This module is NOT imported by any production AWG path
// (ambient-world-generator.js, run.js) and MUST NOT be. It exists solely so the
// occurrenceKind experiment can be run against a captured, production-faithful AWG
// request without touching the production generator, validator, materialiser or
// prompt.
//
// WHAT IT DOES
// A pure schema -> schema transform over the AWG proposal format (the `{ oneOf: [...] }`
// returned by buildAwgProposalFormat). It inserts a REQUIRED, REDUNDANT coarse
// discriminator `occurrenceKind` immediately after `decision` and before `eventFamily`
// on every EVENT/CONTINUATION branch, tied deterministically to that branch's
// eventFamily constraint:
//   - branch permits only SOCIAL_REQUEST        -> occurrenceKind const "SOCIAL_REQUEST"
//   - branch excludes SOCIAL_REQUEST            -> occurrenceKind const "OTHER"
//   - branch permits SOCIAL_REQUEST + others    -> SPLIT that branch only, into
//        { occurrenceKind "SOCIAL_REQUEST", eventFamily const "SOCIAL_REQUEST" }
//        { occurrenceKind "OTHER",          eventFamily enum = original set minus SOCIAL_REQUEST }
// NO_EVENT (and any family-less member) is passed through byte/structurally unchanged.
//
// occurrenceKind carries no new information (it is fully determined by eventFamily).
// Its only effect is to force the model to emit a coarse "SOCIAL_REQUEST or anything
// else?" commitment token BEFORE it chooses eventFamily. That ordering is the entire
// hypothesis, and it depends on the schema->GBNF converter emitting object keys in
// `properties` insertion order (see awg-occurrence-kind-order-check.mjs, which must
// confirm this empirically before any behavioural sampling is trusted).
//
// The input schema is never mutated; a fresh structure is returned.

export const OCCURRENCE_KIND_SOCIAL = 'SOCIAL_REQUEST';
export const OCCURRENCE_KIND_OTHER = 'OTHER';
const SOCIAL_FAMILY = 'SOCIAL_REQUEST';

function deepClone(value) {
  return structuredClone(value);
}

// Resolve the exact set of families a branch's eventFamily schema permits.
// Returns an array for { const } / { enum }, or null for any unrecognised shape
// (in which case the branch is left untouched rather than guessed at).
function allowedFamilies(eventFamilySchema) {
  if (eventFamilySchema && typeof eventFamilySchema === 'object') {
    if (Object.prototype.hasOwnProperty.call(eventFamilySchema, 'const')) {
      return [eventFamilySchema.const];
    }
    if (Array.isArray(eventFamilySchema.enum)) {
      return eventFamilySchema.enum.slice();
    }
  }
  return null;
}

// Rebuild a properties object so `occurrenceKind` sits immediately after `decision`
// (or, defensively, immediately before `eventFamily` when there is no `decision`
// key). Insertion order is what the grammar emission order follows, so this is
// positional, not a plain assignment. eventFamily is replaced only when a new
// schema is supplied (the split case); otherwise it is preserved verbatim.
function insertOccurrenceKind(properties, occConst, eventFamilySchema) {
  const keys = Object.keys(properties);
  const hasDecision = keys.includes('decision');
  const out = {};
  for (const key of keys) {
    if (!hasDecision && key === 'eventFamily') {
      out.occurrenceKind = { const: occConst };
    }
    out[key] = key === 'eventFamily' && eventFamilySchema ? eventFamilySchema : properties[key];
    if (hasDecision && key === 'decision') {
      out.occurrenceKind = { const: occConst };
    }
  }
  return out;
}

// Add 'occurrenceKind' to `required` immediately after 'decision' (position in
// `required` does not drive emission order, but occurrenceKind must be mandatory).
function insertRequired(required) {
  if (!Array.isArray(required)) return required;
  const out = [];
  let inserted = false;
  for (const name of required) {
    out.push(name);
    if (name === 'decision') {
      out.push('occurrenceKind');
      inserted = true;
    }
  }
  if (!inserted) out.unshift('occurrenceKind');
  return out;
}

function withOccurrenceKind(member, occConst, eventFamilySchema) {
  const next = deepClone(member);
  next.properties = insertOccurrenceKind(
    next.properties,
    occConst,
    eventFamilySchema ? deepClone(eventFamilySchema) : null,
  );
  next.required = insertRequired(next.required);
  return next;
}

// Preserve the original eventFamily schema shape (type and any other keywords) but
// restrict the enum to the supplied families. Used only for the OTHER half of a split.
function restrictedEventFamilySchema(originalEventFamilySchema, families) {
  const schema = deepClone(originalEventFamilySchema);
  delete schema.const;
  schema.enum = families.slice();
  return schema;
}

export function transformOccurrenceKind(schema) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.oneOf)) {
    throw new Error('AWG occurrenceKind transform expects a { oneOf: [...] } schema');
  }
  const members = [];
  for (const member of schema.oneOf) {
    const properties = member && member.properties;
    // NO_EVENT, and any member without an eventFamily, is passed through untouched.
    if (!properties || !Object.prototype.hasOwnProperty.call(properties, 'eventFamily')) {
      members.push(deepClone(member));
      continue;
    }
    const allowed = allowedFamilies(properties.eventFamily);
    if (allowed == null) {
      members.push(deepClone(member));
      continue;
    }
    const hasSocial = allowed.includes(SOCIAL_FAMILY);
    const others = allowed.filter((family) => family !== SOCIAL_FAMILY);
    if (hasSocial && others.length === 0) {
      // SOCIAL_REQUEST only.
      members.push(withOccurrenceKind(member, OCCURRENCE_KIND_SOCIAL, null));
    } else if (!hasSocial) {
      // No SOCIAL_REQUEST: a single coarse OTHER commitment, eventFamily unchanged.
      members.push(withOccurrenceKind(member, OCCURRENCE_KIND_OTHER, null));
    } else {
      // Mixed: SOCIAL_REQUEST plus other families. Split THIS branch only.
      members.push(withOccurrenceKind(member, OCCURRENCE_KIND_SOCIAL, { const: SOCIAL_FAMILY }));
      members.push(withOccurrenceKind(
        member,
        OCCURRENCE_KIND_OTHER,
        restrictedEventFamilySchema(properties.eventFamily, others),
      ));
    }
  }
  const result = deepClone(schema);
  result.oneOf = members;
  return result;
}
