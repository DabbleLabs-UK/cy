// Admin-only rendering for the structured environment-event pipeline.

export const INSPECTION_HEADINGS = [
  ['what_happened', 'WHAT HAPPENED'],
  ['what_cy_observed', 'WHAT CY OBSERVED'],
  ['what_soma_received', 'WHAT SOMA RECEIVED'],
  ['what_threat_learning_did', 'WHAT THREAT LEARNING DID'],
  ['what_current_defensive_context_did', 'WHAT CURRENT DEFENSIVE CONTEXT DID'],
  ['what_action_outcome_contingency_did', 'WHAT ACTION-OUTCOME CONTINGENCY DID'],
  ['what_instrumental_agency_did', 'WHAT INSTRUMENTAL AGENCY DID'],
  ['what_feeding_ledger_did', 'WHAT FEEDING LEDGER DID'],
  ['what_systems_consumed_it', 'WHAT SYSTEMS CONSUMED IT'],
];

export async function loadEnvironmentInspection(endpoint, eventId, fetchImpl = fetch) {
  if (!endpoint || !eventId) throw new Error('environment event inspector is unavailable');
  const res = await fetchImpl(`${endpoint}?id=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`environment event ${res.status}`);
  const data = await res.json();
  if (!data || !data.ok || !data.inspection) throw new Error('invalid environment event response');
  return data.inspection;
}

export function renderEnvironmentInspection(inspection, doc = document) {
  const root = doc.createElement('div');
  root.className = 'environment-inspector';
  for (const [key, heading] of INSPECTION_HEADINGS) {
    const section = doc.createElement('section');
    section.className = 'environment-inspector-section';
    const title = doc.createElement('h4');
    title.textContent = heading;
    const value = doc.createElement('pre');
    value.textContent = JSON.stringify(inspection && inspection[key] != null ? inspection[key] : null, null, 2);
    section.append(title, value);
    root.appendChild(section);
  }
  return root;
}
