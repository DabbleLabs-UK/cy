// Opt-in isolated MariaDB + actual HTTP endpoints. No provider calls are made.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('retry classification, claim fencing, cloud resumption and terminal history remain coherent',
  { skip: process.env.CY_TEST_DB_ISOLATED !== '1' }, async () => {
    const dbName = `cy_retry_${randomBytes(6).toString('hex')}`;
    const sql = (query, database = dbName) => {
      const result = spawnSync(process.env.CY_TEST_MARIADB_BIN, [
        `--defaults-file=${process.env.CY_TEST_DB_DEFAULTS}`, '-h', '127.0.0.1',
        '-P', process.env.CY_TEST_DB_PORT, '-u', 'root', '--batch', '--skip-column-names', '--raw',
        ...(database ? [database] : []),
      ], { input: query, encoding: 'utf8', timeout: 30000, windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    const web = await mkdtemp(join(tmpdir(), 'cy-retry-test-'));
    let server;
    try {
      sql(`CREATE DATABASE ${dbName}`, null);
      sql(await readFile(join(root, 'sql/schema.sql'), 'utf8'));
      // Real legacy terminal IDs/counters, synthetic bodies only. New counters
      // must not reinterpret migration-013's backfilled historical attempts.
      sql(`INSERT INTO postcards (id,body,posted_at,deliver_at,delivered_at,mail_class,reply_attempts)
        VALUES ${[8, 13, 18, 19, 27].map(id => `(${id},'synthetic legacy',NOW(),NOW(),NOW(),'fan_final',3)`).join(',')}`);
      const historic = () => sql('SELECT id,mail_class,reply_attempts,posted_at,deliver_at,delivered_at,replied_at FROM postcards WHERE id IN (8,13,18,19,27) ORDER BY id');
      const original = historic();
      // Restore the actual pre-030 column/index shape before applying the
      // migration, rather than testing only ADD IF NOT EXISTS no-ops.
      sql(`ALTER TABLE postcards DROP COLUMN claim_generation, DROP COLUMN processing_attempts,
        DROP COLUMN temporary_failures, DROP COLUMN quality_failures, DROP COLUMN retry_hold, DROP COLUMN arrival_event_id;
        ALTER TABLE postcard_inference_turns DROP COLUMN claim_generation;
        ALTER TABLE postcard_inference_attempts DROP INDEX postcard_claim_attempt,
          DROP COLUMN claim_generation, DROP COLUMN safe_retry,
          ADD UNIQUE INDEX postcard_attempt(postcard_id,provider,attempt);`);
      const migration = await readFile(join(root, 'sql/030_postcard_retry_lifecycle.sql'), 'utf8');
      sql(migration); sql(migration);
      assert.equal(historic(), original, 'additive/repeated migration leaves terminal history intact');
      assert.equal(sql('SELECT SUM(quality_failures) FROM postcards'), '0');
      await cp(join(root, 'lib'), join(web, 'lib'), { recursive: true });
      await cp(join(root, 'public/api'), join(web, 'public/api'), { recursive: true });
      await cp(join(root, 'config'), join(web, 'config'), { recursive: true });
      await writeFile(join(web, 'config/config.php'), `<?php return [
        'db'=>['host'=>'127.0.0.1;port=${process.env.CY_TEST_DB_PORT}','name'=>'${dbName}','user'=>'root','pass'=>'','charset'=>'utf8mb4'],
        'ingest_key'=>'retry-test-key','cookie_secret'=>'retry-test-cookie'];`);
      const listener = createServer();
      await new Promise(r => listener.listen(0, '127.0.0.1', r));
      const port = listener.address().port;
      await new Promise(r => listener.close(r));
      server = spawn(process.env.CY_TEST_PHP_BIN, ['-d', 'extension=pdo_mysql', '-S', `127.0.0.1:${port}`, '-t', join(web, 'public')],
        { cwd: web, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let errors = '';
      server.stderr.on('data', b => { errors += b; });
      const base = `http://127.0.0.1:${port}`;
      for (let n = 0; n < 50; n++) {
        try { await fetch(`${base}/api/postcard-inference.php`); break; }
        catch { await new Promise(r => setTimeout(r, 100)); }
      }
      const post = async (endpoint, body) => {
        const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Cy-Key': 'retry-test-key', Origin: base },
          body: JSON.stringify(body) });
        const result = await response.json();
        assert.equal(response.status, 200, JSON.stringify(result) + errors.slice(-1000));
        return result;
      };
      const inbox = async () => {
        const response = await fetch(`${base}/api/inbox.php?fan_mail=1`, { headers: { 'X-Cy-Key': 'retry-test-key' } });
        assert.equal(response.status, 200, await response.clone().text());
        return response.json();
      };
      const ingest = (kind, payload, deliveryId = randomUUID()) => post('ingest.php', {
        events: [{ delivery_id: deliveryId, ts: '2026-10-06 12:00:00.000', kind, payload }],
      });
      const api = (action, pc, extra = {}) => post('postcard-inference.php', {
        action, postcard_id: pc.id, claim_generation: pc.claim_generation, ...extra,
      });
      let nextId = 100;
      const create = (mailClass = 'reply') => {
        const id = nextId++;
        sql(`INSERT INTO postcards (id,body,posted_at,deliver_at,mail_class) VALUES (${id},'synthetic test',NOW(),NOW(),'${mailClass}')`);
        return id;
      };
      const claim = async id => {
        sql(`UPDATE postcards SET deliver_at=NOW()-INTERVAL 1 SECOND WHERE id=${id}`);
        const result = await inbox();
        assert.deepEqual(result.postcards.map(p => p.id), [id]);
        return result.postcards[0];
      };
      const defer = (pc, failureClass, reason) => ingest('postcard_deferred', {
        id: pc.id, claim_generation: pc.claim_generation, failure_class: failureClass, reason,
      });
      const finish = pc => ingest('postcard_out', {
        id: pc.id, reply_to: pc.id, claim_generation: pc.claim_generation, body: 'a synthetic reply',
      });
      const route = pc => api('route', pc, { cloud_available: true, cloud_healthy: true,
        model: 'deepseek-v4-flash', local_model: 'test-local' });
      const reserve = pc => api('reserve', pc, { provider: 'deepseek', model: 'deepseek-v4-flash',
        attempt: 'initial', input_tokens: 100, max_output_tokens: 40 });
      const settle = (pc, attempt, status) => api('settle', pc, {
        request_id: attempt.request_id, status, usage: null, latency_ms: 10,
      });

      // Reproduce card 27's three zero-output interruptions, then temporary
      // infrastructure outcomes. Each lease gets a fenced, durable retry.
      const interrupted = create();
      let stale;
      // Establish the same existing-owner network boundary as normal ingest
      // before setting this disposable test's explicit LOCAL route.
      await ingest('test_fixture', { synthetic: true });
      await api('settings', { id: 0, claim_generation: 0 }, { settings: { route: 'LOCAL' } });
      for (const [index, reason] of ['REGIME_CHANGE', 'REGIME_CHANGE', 'WING_NOISE_MID', 'provider_hold', 'transport_not_sent'].entries()) {
        const pc = await claim(interrupted);
        stale ??= pc;
        await ingest('postcard_in', { id: pc.id, claim_generation: pc.claim_generation });
        if (index < 3) {
          assert.equal((await route(pc)).provider, 'ollama');
          const local = await api('reserve', pc, { provider: 'ollama', model: 'test-local',
            attempt: 'initial', input_tokens: 100, max_output_tokens: 40 });
          assert.equal(local.execute, true);
          await settle(pc, local, 'aborted');
          await api('outcome', pc, { status: 'held', reason: 'interrupted' });
        }
        await defer(pc, 'temporary', reason);
        assert.equal(sql(`SELECT CONCAT(mail_class,':',quality_failures,':',temporary_failures,':',processing_attempts) FROM postcards WHERE id=${interrupted}`), `reply:0:${index + 1}:${index + 1}`);
        const delay = Number(sql(`SELECT TIMESTAMPDIFF(SECOND,NOW(),deliver_at) FROM postcards WHERE id=${interrupted}`));
        assert.ok(delay > 0 && delay <= 900, 'backoff is nonzero and bounded');
        assert.deepEqual((await inbox()).postcards, [], 'polls do not hot-loop during backoff');
      }
      const retried = await claim(interrupted);
      await defer(stale, 'quality', 'late stale failure');
      await finish(stale);
      assert.equal(sql(`SELECT CONCAT(quality_failures,':',replied_at IS NULL,':',delivered_at IS NOT NULL) FROM postcards WHERE id=${interrupted}`), '0:1:1', 'stale owner cannot fail or publish a reclaimed postcard');
      await finish(retried); await finish(retried);
      assert.equal(sql(`SELECT COUNT(*) FROM events WHERE kind='postcard_out' AND JSON_VALUE(payload,'$.reply_to')=${interrupted}`), '1');
      assert.equal(sql(`SELECT COUNT(*) FROM events WHERE kind='postcard_in' AND JSON_VALUE(payload,'$.id')=${interrupted}`), '1');

      // Only completed substantive failures consume terminal allowance.
      const invalid = create();
      for (let n = 1; n <= 3; n++) {
        const pc = await claim(invalid);
        await defer(pc, 'quality', 'completed invalid after repair');
        assert.equal(sql(`SELECT quality_failures FROM postcards WHERE id=${invalid}`), String(n));
      }
      assert.equal(sql(`SELECT CONCAT(mail_class,':',temporary_failures) FROM postcards WHERE id=${invalid}`), 'fan_final:0');
      await inbox();

      // Held before a provider call: same canonical turn, new claim/attempt.
      await api('settings', { id: 0, claim_generation: 0 }, { settings: { route: 'DEEPSEEK', enabled: true, requests_hour: 100, requests_day: 100, gbp_hour: 1, gbp_day: 1 } });
      const heldId = create();
      let pc = await claim(heldId);
      const held = await api('route', pc, { cloud_available: false, cloud_healthy: false, model: 'deepseek-v4-flash' });
      assert.equal(held.execute, false);
      const turnId = sql(`SELECT CONCAT(postcard_id,':',created_at) FROM postcard_inference_turns WHERE postcard_id=${heldId}`);
      await defer(pc, 'temporary', 'provider unavailable before call');
      pc = await claim(heldId);
      assert.equal((await route(pc)).execute, true);
      assert.equal(sql(`SELECT CONCAT(postcard_id,':',created_at) FROM postcard_inference_turns WHERE postcard_id=${heldId}`), turnId);
      const attempt = await reserve(pc);
      assert.equal(attempt.execute, true);
      assert.equal((await reserve(pc)).execute, false, 'reservation acknowledgement replay cannot pay twice');
      await settle(pc, attempt, 'not_sent');
      await api('outcome', pc, { status: 'held', reason: 'not_sent' });
      await defer(pc, 'temporary', 'transport_not_sent');
      pc = await claim(heldId);
      assert.equal((await route(pc)).execute, true);
      const successful = await reserve(pc);
      assert.equal(successful.execute, true);
      assert.notEqual(successful.request_id, attempt.request_id);
      await settle(pc, successful, 'generated');
      await api('outcome', pc, { status: 'generated' });
      assert.equal((await route(pc)).execute, false, 'definitive result does not rerun provider');
      await finish(pc); await finish(pc);
      assert.equal(sql(`SELECT COUNT(*) FROM events WHERE kind='postcard_out' AND JSON_VALUE(payload,'$.reply_to')=${heldId}`), '1');
      assert.equal(sql(`SELECT publication_result FROM postcard_inference_turns WHERE postcard_id=${heldId}`), 'published');

      // A configured request cap is also a pre-call hold, never quality failure.
      await api('settings', { id: 0, claim_generation: 0 }, { settings: { requests_hour: 1 } });
      const capId = create();
      let capPc = await claim(capId);
      const capped = await route(capPc);
      assert.equal(capped.execute, false);
      assert.match(capped.reason, /cap/);
      await defer(capPc, 'temporary', 'request_cap');
      assert.equal(sql(`SELECT CONCAT(quality_failures,':',temporary_failures) FROM postcards WHERE id=${capId}`), '0:1');
      await api('settings', { id: 0, claim_generation: 0 }, { settings: { requests_hour: 100 } });
      capPc = await claim(capId);
      assert.equal((await route(capPc)).execute, true, 'cap hold resumes the canonical turn after policy allows it');
      await finish(capPc);

      // The provider may complete before the final whole-buffer public screen
      // rejects empty/all-screened prose. Its paid usage remains recorded, but
      // generated status alone must not strand this definitive quality failure.
      const screenedId = create();
      let screenedPc = await claim(screenedId);
      assert.equal((await route(screenedPc)).execute, true);
      const screened = await reserve(screenedPc);
      await api('settle', screenedPc, { request_id: screened.request_id, status: 'generated',
        usage: { prompt_tokens: 100, completion_tokens: 20 }, latency_ms: 50 });
      const paid = sql(`SELECT actual_gbp FROM postcard_inference_attempts WHERE request_id='${screened.request_id}'`);
      assert.ok(Number(paid) > 0);
      await api('outcome', screenedPc, { status: 'validation_rejected', reason: 'empty_response' });
      await defer(screenedPc, 'quality', 'final_screen_empty');
      assert.equal(sql(`SELECT CONCAT(mail_class,':',quality_failures,':',retry_hold IS NULL) FROM postcards WHERE id=${screenedId}`), 'reply:1:1');
      assert.equal(sql(`SELECT actual_gbp FROM postcard_inference_attempts WHERE request_id='${screened.request_id}'`), paid, 'quality rejection never erases incurred usage');
      await api('settings', { id: 0, claim_generation: 0 }, { settings: { route: 'AUTO' } });
      screenedPc = await claim(screenedId);
      assert.equal((await route(screenedPc)).execute, true);
      const definitiveFailure = await reserve(screenedPc);
      await api('settle', screenedPc, { request_id: definitiveFailure.request_id,
        status: 'provider_error', definitive_provider_rejection: true, usage: null, latency_ms: 10 });
      assert.equal((await api('fallback', screenedPc, { reason: 'provider_unavailable' })).execute, true,
        'old-generation quality failure cannot block permitted fallback for a new definitive provider failure');
      await finish(screenedPc);
      await api('settings', { id: 0, claim_generation: 0 }, { settings: { route: 'DEEPSEEK' } });

      // An in-flight unknown hold can be released only after a late definitive
      // no-call settlement establishes safety. Settlement retains its receipt.
      const lateId = create();
      let latePc = await claim(lateId);
      await route(latePc);
      const lateAttempt = await reserve(latePc);
      sql(`UPDATE postcards SET delivered_at=NOW()-INTERVAL 31 MINUTE WHERE id=${lateId}`);
      await inbox();
      assert.equal(sql(`SELECT retry_hold FROM postcards WHERE id=${lateId}`), 'outcome_unknown');
      await settle(latePc, lateAttempt, 'not_sent');
      latePc = await claim(lateId);
      assert.equal(latePc.claim_generation, 2);
      assert.equal((await route(latePc)).execute, true, 'late safe settlement releases hold without resetting canonical turn');
      await finish(latePc);

      // Unknown paid outcome survives claim expiry without authorizing replay.
      const unknownId = create();
      const unknownPc = await claim(unknownId);
      assert.equal((await route(unknownPc)).execute, true);
      const unknown = await reserve(unknownPc);
      assert.equal(unknown.execute, true);
      sql(`UPDATE postcards SET delivered_at=NOW()-INTERVAL 31 MINUTE WHERE id=${unknownId}`);
      await inbox();
      assert.equal(sql(`SELECT CONCAT(mail_class,':',quality_failures,':',retry_hold) FROM postcards WHERE id=${unknownId}`), 'reply:0:outcome_unknown');
      sql(`UPDATE postcards SET deliver_at=NOW()-INTERVAL 1 SECOND WHERE id=${unknownId}`);
      assert.deepEqual((await inbox()).postcards, []);
      assert.equal((await route(unknownPc)).execute, false);
      assert.equal((await reserve(unknownPc)).execute, false);
      assert.equal(sql(`SELECT COUNT(*) FROM postcard_inference_attempts WHERE postcard_id=${unknownId}`), '1');
      await settle(unknownPc, unknown, 'unknown');

      // Pending durable publication is not another provider opportunity either.
      const generatedId = create();
      const generatedPc = await claim(generatedId);
      assert.equal((await route(generatedPc)).execute, true);
      const generated = await reserve(generatedPc);
      await settle(generatedPc, generated, 'generated');
      await api('outcome', generatedPc, { status: 'generated' });
      sql(`UPDATE postcards SET delivered_at=NOW()-INTERVAL 31 MINUTE WHERE id=${generatedId}`);
      await inbox();
      assert.equal(sql(`SELECT retry_hold FROM postcards WHERE id=${generatedId}`), 'publication_pending');
      await finish(generatedPc);
      assert.equal(sql(`SELECT replied_at IS NOT NULL FROM postcards WHERE id=${generatedId}`), '1', 'late already-generated durable publication is accepted for its unchanged generation');

      // Every-fifth promotion still distinguishes resumable fan from terminal.
      const fanId = create('fan');
      sql(`UPDATE postcards SET delivered_at=NOW() WHERE id=${fanId}`);
      sql('UPDATE postcard_queue_state SET completed_since_promotion=4 WHERE id=1');
      const promotionTrigger = create();
      await finish(await claim(promotionTrigger));
      assert.equal(sql(`SELECT mail_class FROM postcards WHERE id=${fanId}`), 'reply');
      assert.equal(historic(), original, 'all historical terminal rows remain unchanged through retries and promotions');
      assert.equal(sql('SELECT SUM(quality_failures) FROM postcards WHERE id IN (8,13,18,19,27)'), '0');
    } finally {
      if (server && server.exitCode === null) {
        const exited = new Promise(r => server.once('exit', r)); server.kill(); await exited;
      }
      sql(`DROP DATABASE IF EXISTS ${dbName}`, null);
      await rm(web, { recursive: true, force: true });
    }
  });
