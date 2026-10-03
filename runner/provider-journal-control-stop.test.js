// The deployed Q5 model's ChatML template can emit the malformed |im_end|>
// text. Prove the upstream stop is narrow and the waking validator remains the
// final authority if a provider nevertheless returns it.
import assert from 'node:assert/strict';
import { makeProviders } from './provider.js';
import { generateWithCharacterRepair, validateCharacterCandidate } from './character-output.js';
import { options } from './prompt.js';

const AFFECTED_MODEL = 'hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M';
const base = options({}, 4, 'journal', { num_predict: 93 });
const originalFetch = globalThis.fetch;
const requests = [];
let outputs = [];

globalThis.fetch = async (url, init) => {
  requests.push({ url: String(url), body: JSON.parse(init.body) });
  const response = outputs.shift() || 'plain words from cy';
  const ndjson = JSON.stringify({ response }) + '\n' + JSON.stringify({ done: true }) + '\n';
  return new Response(ndjson, { status: 200 });
};

async function candidate(provider, purpose, prompt = 'the tray is cold') {
  const response = await provider.openStream({
    system: 'Cy is writing privately', prompt, opts: base, purpose,
  });
  assert.equal(response.ok, true);
  const decoder = new TextDecoder();
  let body = '';
  for (;;) {
    const { done, value } = await response.reader.read();
    if (done) break;
    body += decoder.decode(value);
  }
  return body.split('\n').filter(Boolean).map(JSON.parse)
    .map((line) => line.response || '').join('');
}

try {
  const ollama = makeProviders({ ollamaUrl: 'http://ollama.test', model: AFFECTED_MODEL }).ollama;
  for (const purpose of ['journal', 'drawing', 'postcard', 'warden']) {
    await candidate(ollama, purpose);
    const sent = requests.at(-1).body;
    assert.equal(sent.model, AFFECTED_MODEL);
    assert.equal(requests.at(-1).url, 'http://ollama.test/api/generate');
    assert.equal(sent.stream, true);
    assert.equal(sent.system, 'Cy is writing privately');
    assert.equal(sent.options.stop.includes('<|im_end|>'), true);
    assert.equal(sent.options.stop.includes('|im_end|>'), true, purpose);
    assert.equal(sent.options.stop.filter((stop) => stop === '|im_end|>').length, 1);
    assert.deepEqual(sent.options.stop.filter((stop) => stop !== '|im_end|>'), base.stop);
    for (const key of ['temperature', 'top_p', 'repeat_penalty', 'repeat_last_n',
      'num_predict', 'num_ctx', 'num_thread']) {
      assert.equal(sent.options[key], base[key], key);
    }
  }

  // Repair calls the same provider path with the original system/options.
  requests.length = 0;
  outputs = ['first try |im_end|>', 'second try |im_end|>'];
  const discarded = await generateWithCharacterRepair({
    prompt: 'the tray is cold',
    generate: (prompt) => candidate(ollama, 'journal', prompt).then((text) => ({ candidate: text })),
  });
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.body.options.stop.includes('|im_end|>')), true);
  assert.equal(discarded.characterValidation.finalAction, 'discarded-to-silence');
  assert.equal(discarded.candidate, '');
  assert.equal(validateCharacterCandidate('still here |im_end|>').ok, false);

  requests.length = 0;
  outputs = ['first try |im_end|>', 'heard the door go, kept countin'];
  const repaired = await generateWithCharacterRepair({
    prompt: 'the tray is cold',
    generate: (prompt) => candidate(ollama, 'journal', prompt).then((text) => ({ candidate: text })),
  });
  assert.equal(requests.length, 2);
  assert.equal(repaired.candidate, 'heard the door go, kept countin');

  // Non-prose work and a different local model keep their exact old options.
  await candidate(ollama, 'dream');
  assert.deepEqual(requests.at(-1).body.options, base);
  const other = makeProviders({ ollamaUrl: 'http://ollama.test', model: 'llama3.2:3b' }).ollama;
  await candidate(other, 'journal');
  assert.deepEqual(requests.at(-1).body.options, base);

  // A separately routed drawing model is not mistaken for the affected one.
  const routed = makeProviders({
    ollamaUrl: 'http://ollama.test', model: AFFECTED_MODEL,
    ollamaModels: { drawing: 'llama3.2:3b' },
  }).ollama;
  await candidate(routed, 'drawing');
  assert.equal(requests.at(-1).body.model, 'llama3.2:3b');
  assert.deepEqual(requests.at(-1).body.options, base);

  const deepseek = makeProviders({
    deepseek: { apiBase: 'http://deepseek.test', model: 'deepseek-test' },
  }, { deepseekKey: 'test-only' }).deepseek;
  await deepseek.openStream({ system: 'system', prompt: 'prompt', opts: base });
  assert.equal(requests.at(-1).url, 'http://deepseek.test/chat/completions');
  assert.equal(requests.at(-1).body.stop.includes('|im_end|>'), false);

  assert.equal(base.stop.includes('|im_end|>'), false, 'caller options remain unchanged');
  console.log('provider-journal-control-stop.test.js: all checks passed');
} finally {
  globalThis.fetch = originalFetch;
}
