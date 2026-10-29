// Exact approved lead-time wiring deltas, composed before older historical
// source guards. Unexpected changes still fail the exact historical comparison.
import assert from 'node:assert/strict';
import { beforeAwgCurrentContext } from './awg-current-context-source.mjs';

const reviewedDeltas = [
  [
    "  // YARD TURN END: delivery sets\n  client.onDelivered = (events) => {\n    if (autobiographicalMemory) autobiographicalMemory.acknowledgeJournalCues(events);\n    if (acknowledgeDayRollovers(vitals, events)) urgentVitalsDirty = true;\n    if (acknowledgeExerciseDeliveries(vitals.locationRegime, events)) urgentVitalsDirty = true;\n",
    "  // YARD TURN END: delivery sets\n  client.onDelivered = (events) => {\n    if (acknowledgeDayRollovers(vitals, events)) urgentVitalsDirty = true;\n    if (acknowledgeExerciseDeliveries(vitals.locationRegime, events)) urgentVitalsDirty = true;\n"
  ],
  [
    "  }\n  let autobiographicalMemory = null;\n  let journalCueObservationReady = false;\n  let memoryFormationTurns = 0;\n  let memoryExpressionBuffer = [];\n",
    "  }\n  let autobiographicalMemory = null;\n  let pendingMemoryQuery = null;\n  let memoryFormationTurns = 0;\n  let memoryExpressionBuffer = [];\n"
  ],
  [
    "  }\n\n  function rememberEnvironmentRecord(record, recallRecord = record) {\n    if (autobiographicalMemory) {\n      if (journalCueObservationReady && recallRecord) autobiographicalMemory.observeJournalCue(recallRecord);\n      const source = sourceFromEnvironmentRecord(record);\n      if (source) {\n",
    "  }\n\n  function rememberEnvironmentRecord(record) {\n    const event = record.world_event;\n    if (autobiographicalMemory) {\n      const source = sourceFromEnvironmentRecord(record);\n      if (source) {\n"
  ],
  [
    "        // episode stages are not separately formed (one coherent episode -> one\n        // representative source). Significant/adverse occurrences are always kept.\n        // This gates ONLY generic ENVIRONMENT_EVENT formation enqueue; cue\n        // preparation has its separate canonical delivery acknowledgement.\n        const admission = environmentFormationAdmission(record);\n        if (admission.admit) {\n",
    "        // episode stages are not separately formed (one coherent episode -> one\n        // representative source). Significant/adverse occurrences are always kept.\n        // This gates ONLY generic ENVIRONMENT_EVENT formation enqueue; the\n        // retrieval/surfacing query below is deliberately left unchanged.\n        const admission = environmentFormationAdmission(record);\n        if (admission.admit) {\n"
  ],
  [
    "          });\n        }\n      }\n    }\n",
    "          });\n        }\n        pendingMemoryQuery = {\n          text: source.text,\n          tags: source.tags,\n          location: event.world.context.location || null,\n          publicSituation: source.text,\n          // Retrieval-cue provenance only: labels this query as cued by a\n          // world event, and snapshots Cy's own recent expression from just\n          // before the cue arrived, so a later analysis can tell whether the\n          // event's own content or Cy's own words explain any resulting\n          // memory match. Never used to fetch/rank/select memories.\n          querySourceType: 'ENVIRONMENT_EVENT',\n          recentExpressionText: contextText().slice(-640),\n        };\n      }\n    }\n"
  ],
  [
    "    attempt = 'initial', admittedAwgSlot = false, format = null,\n    isEligible = null, providerOverride = null, genericFormation = false,\n    journalPreparationReservation = null,\n  }) {\n    let startedAtMs = null;\n",
    "    attempt = 'initial', admittedAwgSlot = false, format = null,\n    isEligible = null, providerOverride = null, genericFormation = false,\n  }) {\n    let startedAtMs = null;\n"
  ],
  [
    "          // Bounded generic formation is also expendable when interactive\n          // Feddit work arrives. Sender formation routing remains unchanged.\n          preemptible: awgInReservedIdle || genericFormation\n            || (background && purpose === 'memory_surfacing'\n              && autobiographicalMemory.validJournalReservation(journalPreparationReservation)),\n        }));\n      }\n",
    "          // Bounded generic formation is also expendable when interactive\n          // Feddit work arrives. Sender formation routing remains unchanged.\n          preemptible: awgInReservedIdle || genericFormation,\n        }));\n      }\n"
  ],
  [
    "    provenanceSource = null,\n    memoryCandidates = [],\n    journalMemory = null,\n    postcardMemory = null,\n    actionOptions = [],\n",
    "    provenanceSource = null,\n    memoryCandidates = [],\n    postcardMemory = null,\n    actionOptions = [],\n"
  ],
  [
    "      for (const item of postcardSenderMemoryItems(postcardMemory.sender)) add(item);\n    }\n    const memories = postcardMemory ? postcardMemory.enrichment.selected : journalMemory ? journalMemory.selected : memoryCandidates.length ? memoryCandidates\n      : (autobiographicalMemory && autobiographicalMemory.working.selected || []);\n    for (const memory of memories) {\n",
    "      for (const item of postcardSenderMemoryItems(postcardMemory.sender)) add(item);\n    }\n    const memories = postcardMemory ? postcardMemory.enrichment.selected : memoryCandidates.length ? memoryCandidates\n      : (autobiographicalMemory && autobiographicalMemory.working.selected || []);\n    for (const memory of memories) {\n"
  ],
  [
    "    makeId: randomUUID,\n    genericAvailability: genericMemoryAvailability,\n    journalPreparationContext: () => {\n      const nowMs = Date.now();\n      const slotAnchorMs = vitals.expressiveCadence.lastOpportunityAtMs;\n      return {\n        eligible: running && !client.paused && !pendingPostcards.length\n          && !pendingWarden.length && !pendingDrawRequests.length\n          && currentMode !== 'letter' && currentMode !== 'warden'\n          && vitals.locationRegime.current.id === LOCATIONS.CELL\n          && !effectiveAsleep(londonParts().mins),\n        slotAnchorMs,\n        dueAtMs: nowMs + wakingOpportunityWaitMs(slotAnchorMs, nowMs, client.tempo.speed),\n      };\n    },\n    onGenericService: (detail) => recordInferenceDiagnostic({ event: 'generic-memory-service', ...detail }),\n    senderFormationGenerate: ({ job, call, localGenerate }) => senderFormationInference.generate({\n",
    "    makeId: randomUUID,\n    genericAvailability: genericMemoryAvailability,\n    onGenericService: (detail) => recordInferenceDiagnostic({ event: 'generic-memory-service', ...detail }),\n    senderFormationGenerate: ({ job, call, localGenerate }) => senderFormationInference.generate({\n"
  ],
  [
    "      background: !!call.background,\n      genericFormation: !!call.genericFormation,\n      journalPreparationReservation: call.journalPreparationReservation || null,\n      isEligible: call.journalPreparationReservation\n        ? () => autobiographicalMemory.validJournalReservation(call.journalPreparationReservation)\n          && genericMemoryAvailability({ ownInference: true }).allowed\n          && vitals.locationRegime.current.id === LOCATIONS.CELL\n          && !effectiveAsleep(londonParts().mins)\n        : call.genericFormation\n        ? () => genericMemoryAvailability({ ownInference: true }).allowed : null,\n      // Foreground calls through this shared callback get the same ceiling as\n",
    "      background: !!call.background,\n      genericFormation: !!call.genericFormation,\n      isEligible: call.genericFormation\n        ? () => genericMemoryAvailability({ ownInference: true }).allowed : null,\n      // Foreground calls through this shared callback get the same ceiling as\n"
  ],
  [
    "    canRunBackground: (kind) => kind === 'sender_formation'\n      ? !client.paused\n      : kind === 'journal_preparation'\n        ? inferPhase === 'idle' && genericMemoryAvailability().allowed\n          && vitals.locationRegime.current.id === LOCATIONS.CELL\n          && !effectiveAsleep(londonParts().mins)\n      : inferPhase === 'idle'\n      && inferenceTempoPacer.remaining(Date.now(), client.tempo.speed) <= 0\n",
    "    canRunBackground: (kind) => kind === 'sender_formation'\n      ? !client.paused\n      : inferPhase === 'idle'\n      && inferenceTempoPacer.remaining(Date.now(), client.tempo.speed) <= 0\n"
  ],
  [
    "  };\n\n  async function formMemoryAfterVisibleOutput(groundedContext = null, force = false) {\n    memoryFormationTurns++;\n",
    "  };\n\n  function refreshPendingMemory(generationRef = null, groundedContext = null) {\n    if (!pendingMemoryQuery) return autobiographicalMemory.working;\n    const query = pendingMemoryQuery;\n    pendingMemoryQuery = null;\n    void autobiographicalMemory.requestWorkingContext({\n      ...query, groundedContext, generationRef,\n    }, { scheduleDelayMs: 1000 })\n      .catch((error) => console.warn(`[cy] memory surfacing deferred: ${error.message}`));\n    return autobiographicalMemory.working;\n  }\n\n  async function formMemoryAfterVisibleOutput(groundedContext = null, force = false) {\n    memoryFormationTurns++;\n"
  ],
  [
    "      ? { context: cognition.groundedContext, directive: cognition.groundedDirective }\n      : soma.groundedDirective({ now: Date.now() });\n    const memory = brokerOptions.journalMemory || (brokerOptions.postcardMemory ? {\n      directive: postcardMemoryDirective(brokerOptions.postcardMemory),\n      inspection: postcardMemoryReadiness(brokerOptions.postcardMemory.sender, brokerOptions.postcardMemory.enrichment),\n",
    "      ? { context: cognition.groundedContext, directive: cognition.groundedDirective }\n      : soma.groundedDirective({ now: Date.now() });\n    const memory = brokerOptions.postcardMemory ? {\n      directive: postcardMemoryDirective(brokerOptions.postcardMemory),\n      inspection: postcardMemoryReadiness(brokerOptions.postcardMemory.sender, brokerOptions.postcardMemory.enrichment),\n"
  ],
  [
    "      brokerOptions.generationRef || `generation:${Date.now()}`,\n      brokerOptions.currentSenderId || null,\n    ));\n    const ctx = {\n      wakingJournalContext: brokerOptions.wakingJournalContext === true,\n",
    "      brokerOptions.generationRef || `generation:${Date.now()}`,\n      brokerOptions.currentSenderId || null,\n    );\n    const ctx = {\n      wakingJournalContext: brokerOptions.wakingJournalContext === true,\n"
  ],
  [
    "    vitals.lastWingNoiseMs = now;\n    recordIncident('wing', { line, phase, mins }); // real, dated, in the ledger\n    autobiographicalMemory.interruptJournalPreparation('wing-noise');\n\n    let mid = false;\n",
    "    vitals.lastWingNoiseMs = now;\n    recordIncident('wing', { line, phase, mins }); // real, dated, in the ledger\n\n    let mid = false;\n"
  ],
  [
    "      enqueue: (event) => client.enqueueYardContactEvent(event),\n      enqueued: yardEnqueued,\n      remember: (record, snapshot) => rememberEnvironmentRecord(record,\n        snapshot.pendingEvents.find((event) => event.kind === 'world_event_record'\n          && event.payload?.world_event?.id === record.world_event.id)?.payload || null),\n      remembered: yardRemembered,\n    });\n",
    "      enqueue: (event) => client.enqueueYardContactEvent(event),\n      enqueued: yardEnqueued,\n      remember: (record) => rememberEnvironmentRecord(record),\n      remembered: yardRemembered,\n    });\n"
  ],
  [
    "  // YARD TURN END: startup reconciliation\n\n  journalCueObservationReady = true;\n  const tickTimer = setInterval(async () => {\n    // Draining work retains ordinary timers. Once held, do not evolve the world\n",
    "  // YARD TURN END: startup reconciliation\n\n  const tickTimer = setInterval(async () => {\n    // Draining work retains ordinary timers. Once held, do not evolve the world\n"
  ],
  [
    "            || effectiveAsleep(londonParts().mins)) continue;\n        nowMs = Date.now();\n        autobiographicalMemory.beginJournalOpportunity(vitals.expressiveCadence.lastOpportunityAtMs);\n        vitals.expressiveCadence = recordExpressiveOpportunity(vitals.expressiveCadence, { nowMs });\n      }\n",
    "            || effectiveAsleep(londonParts().mins)) continue;\n        nowMs = Date.now();\n        vitals.expressiveCadence = recordExpressiveOpportunity(vitals.expressiveCadence, { nowMs });\n      }\n"
  ],
  [
    "        rnd: () => 0,\n      });\n      const cycleInferenceStart = Date.now();\n      if (hasDrawRequest) {\n        autobiographicalMemory.finishJournalOpportunity({ closeUpcoming: true });\n        const drawOutcome = (await doDraw({ cognition, incidentContext })) || 'empty';\n        await recordOutcome(drawOutcome);\n",
    "        rnd: () => 0,\n      });\n      if (pendingMemoryQuery) {\n        pendingMemoryQuery.publicSituation = pendingMemoryQuery.publicSituation || incidentContext;\n        await refreshPendingMemory(`journal:${nowMs}`, cognition.groundedDirective);\n      }\n\n      const cycleInferenceStart = Date.now();\n      if (hasDrawRequest) {\n        const drawOutcome = (await doDraw({ cognition, incidentContext })) || 'empty';\n        await recordOutcome(drawOutcome);\n"
  ],
  [
    "      // event marks its end. Provisional rest/fatigue does not change duration.\n      if (selectedAction === 'silence') {\n        autobiographicalMemory.finishJournalOpportunity();\n        const seconds = AUTONOMOUS_SILENCE_SECONDS;\n        const busyEndedAtMs = Date.now();\n",
    "      // event marks its end. Provisional rest/fatigue does not change duration.\n      if (selectedAction === 'silence') {\n        const seconds = AUTONOMOUS_SILENCE_SECONDS;\n        const busyEndedAtMs = Date.now();\n"
  ],
  [
    "\n      if (selectedAction === 'draw') {\n        autobiographicalMemory.finishJournalOpportunity();\n        const drawOutcome = (await doDraw({ cognition, incidentContext })) || 'empty';\n        await recordOutcome(drawOutcome);\n",
    "\n      if (selectedAction === 'draw') {\n        const drawOutcome = (await doDraw({ cognition, incidentContext })) || 'empty';\n        await recordOutcome(drawOutcome);\n"
  ],
  [
    "      let burstJournalTurn = null;\n      {\n        burstJournalTurn = selectJournalTurn(vitals.ledger, {\n          lastJournalAtMs: vitals.lastJournalAtMs,\n          worldEvents: recentWorldHistory,\n          seenKeys: vitals.journalSubjectKeys,\n        });\n        const journalMemory = autobiographicalMemory.consumeJournalPreparation({\n          sourceEventId: burstJournalTurn.sourceEventId,\n          generationRef: `journal-prose:${nowMs}`,\n          eligible: running && !client.paused && !pendingPostcards.length\n            && !pendingWarden.length && !pendingDrawRequests.length\n            && vitals.locationRegime.current.id === LOCATIONS.CELL\n            && !effectiveAsleep(londonParts().mins),\n        });\n        const ctx = buildCtx(cognition, {\n          generationRef: `journal-prose:${nowMs}`,\n          incidentContext,\n          wakingJournalContext: true,\n          journalMemory,\n        });\n        burstGroundedContext = ctx.groundedSomaContext;\n",
    "      let burstJournalTurn = null;\n      {\n        const ctx = buildCtx(cognition, {\n          generationRef: `journal-prose:${nowMs}`,\n          incidentContext,\n          wakingJournalContext: true,\n        });\n        burstGroundedContext = ctx.groundedSomaContext;\n"
  ],
  [
    "        // the last one, or steer off re-announcing an unchanged state. Structural\n        // (real world timing), not a phrase ban. Computed once per burst.\n        ctx.turn = turnDirective(burstJournalTurn);\n        ctx.journalSubject = burstJournalTurn;\n",
    "        // the last one, or steer off re-announcing an unchanged state. Structural\n        // (real world timing), not a phrase ban. Computed once per burst.\n        burstJournalTurn = selectJournalTurn(vitals.ledger, {\n          lastJournalAtMs: vitals.lastJournalAtMs,\n          worldEvents: recentWorldHistory,\n          seenKeys: vitals.journalSubjectKeys,\n        });\n        ctx.turn = turnDirective(burstJournalTurn);\n        ctx.journalSubject = burstJournalTurn;\n"
  ],
  [
    "        directives = buildDirectives(vitals, 'journal', ctx);\n      }\n      autobiographicalMemory.finishJournalOpportunity();\n      const baseOpts = { ...targetOpts, num_predict: completionBudget(targetOpts.num_predict) };\n      // Explicit one-shot wording can opt out of the within-burst repeat guard,\n",
    "        directives = buildDirectives(vitals, 'journal', ctx);\n      }\n      const baseOpts = { ...targetOpts, num_predict: completionBudget(targetOpts.num_predict) };\n      // Explicit one-shot wording can opt out of the within-burst repeat guard,\n"
  ],
  [
    "        await sleep(700);\n      }\n      } finally {\n        autobiographicalMemory.finishJournalOpportunity();\n        releaseMaintenance();\n      }\n    }\n  }\n",
    "        await sleep(700);\n      }\n      } finally { releaseMaintenance(); }\n    }\n  }\n"
  ]
];

const reviewedClientDeltas = [["  async queryMemories({\n    query, visitorId = null, limit = 10, recentExpressionText = '', querySourceType = null,\n    journalPreparation = null,\n  } = {}) {\n    return this._memoryRequest('query', {\n","  async queryMemories({\n    query, visitorId = null, limit = 10, recentExpressionText = '', querySourceType = null,\n  } = {}) {\n    return this._memoryRequest('query', {\n"],["      recent_expression_text: recentExpressionText || '',\n      query_source_type: querySourceType || null,\n      ...(journalPreparation ? { journal_preparation: journalPreparation } : {}),\n    });\n  }\n","      recent_expression_text: recentExpressionText || '',\n      query_source_type: querySourceType || null,\n    });\n  }\n"],["  }\n\n  async getPreparedMemorySet({ contextFingerprint, visitorId = null, journalPreparation = null } = {}) {\n    return this._memoryRequest('prepared_get', {\n      context_fingerprint: contextFingerprint,\n      visitor_id: visitorId,\n      ...(journalPreparation ? { journal_preparation: journalPreparation } : {}),\n    });\n  }\n\n  async consumePreparedMemorySet({ preparedSetId, generationRef, visitorId = null, journalPreparation = null } = {}) {\n    return this._memoryRequest('consume_prepared', {\n      prepared_set_id: preparedSetId,\n      generation_ref: generationRef,\n      visitor_id: visitorId,\n      ...(journalPreparation ? { journal_preparation: journalPreparation } : {}),\n    });\n  }\n","  }\n\n  async getPreparedMemorySet({ contextFingerprint, visitorId = null } = {}) {\n    return this._memoryRequest('prepared_get', {\n      context_fingerprint: contextFingerprint,\n      visitor_id: visitorId,\n    });\n  }\n\n  async consumePreparedMemorySet({ preparedSetId, generationRef, visitorId = null } = {}) {\n    return this._memoryRequest('consume_prepared', {\n      prepared_set_id: preparedSetId,\n      generation_ref: generationRef,\n      visitor_id: visitorId,\n    });\n  }\n"]];

export function beforeJournalMemoryLeadtime(source) {
  source = beforeAwgCurrentContext(source);
  const deltas = source.includes('    journalPreparationContext: () => {') ? reviewedDeltas
    : source.includes('async getPreparedMemorySet({ contextFingerprint, visitorId = null, journalPreparation = null }')
      ? reviewedClientDeltas : null;
  if (!deltas) return source;
  for (const [after, before] of deltas) {
    assert.equal(source.split(after).length - 1, 1, 'exact approved journal preparation wiring delta');
    source = source.replace(after, before);
  }
  return source;
}

export function beforeJournalPreparationFormation(source) {
  return source.replace('    // A known local formation may change canonical rows. Do not keep a private\n'
    + '    // READY snapshot through that mutation; formation itself is unchanged.\n'
    + '    this.journalPreparation?.invalidateReady();\n', '');
}

export function assertUnchangedMemoryBoundaries(source, old) {
  const formation = text => text.slice(text.indexOf('  async processFormation('));
  assert.equal(formation(beforeJournalPreparationFormation(source('runner/memory-runtime.js'))),
    formation(old('runner/memory-runtime.js')), 'canonical formation and operations remain identical');
  const library = text => text.slice(text.indexOf('function captive_memory_formation_retry('));
  assert.equal(library(source('lib/autobiographical_memory.php')), library(old('lib/autobiographical_memory.php')),
    'formation, privacy, eligibility, canonical rows, ranking and memory application remain identical');
  const api = original => {
    const text = original.replace("        $journalBinding = $input['journal_preparation'] ?? null;\n"
      + "        if (array_key_exists('journal_preparation', $input)) {\n"
      + "            if (!is_array($journalBinding)) throw new InvalidArgumentException('invalid journal preparation query');\n"
      + "            captive_journal_preparation_validate($db, [\n"
      + "                'generationRef' => 'journal:' . ($journalBinding['slotAnchorMs'] ?? ''),\n"
      + "                'journalPreparation' => $journalBinding,\n"
      + "            ], (string)($journalBinding['slotKey'] ?? ''), $visitorId);\n"
      + "        }\n", '')
      .replace("            ...($journalBinding !== null ? ['journal_candidate_versions' => (object)array_column($candidates, 'version', 'id')] : []),\n", '')
      .replace("'formation claim conflict','journal preparation slot conflict'", "'formation claim conflict'");
    return [text.slice(text.indexOf("    if ($action === 'enqueue_source')"),
    text.indexOf("    if ($action === 'enqueue_surfacing')")),
    text.slice(text.indexOf("    if ($action === 'sender_continuity')"))];
  };
  assert.deepEqual(api(source('public/api/memory.php')), api(old('public/api/memory.php')),
    'existing formation, sender, postcard, query, application and inspection API branches remain identical');
}
