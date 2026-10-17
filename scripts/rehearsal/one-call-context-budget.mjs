// REHEARSAL ONLY. Exact offline tokenisation; never starts a server or loads weights.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './grounded-occurrence.mjs';

export const TOKENIZER_METHOD = 'cy-llama-bpe-ascii.v1';
export function validateContextReceipt(request, receipt) {
  const requireThat = (ok, reason) => { if (!ok) throw new Error(reason); };
  requireThat(receipt?.requestFingerprint === fingerprint(request), 'TOKEN_PREFLIGHT_REQUEST_MISMATCH');
  requireThat(receipt.method === TOKENIZER_METHOD && receipt.model === request.model,
    'TOKEN_PREFLIGHT_TOKENIZER_MISMATCH');
  requireThat(receipt.effectiveContext === 3072 && request.options?.num_ctx === 3072
    && receipt.outputAllowance === request.options.num_predict, 'TOKEN_PREFLIGHT_PROFILE_MISMATCH');
  requireThat(Number.isSafeInteger(receipt.inputTokens) && receipt.inputTokens > 0
    && Number.isSafeInteger(receipt.outputAllowance) && receipt.outputAllowance > 0,
  'TOKEN_PREFLIGHT_INVALID_COUNTS');
  requireThat(receipt.inputTokens <= receipt.effectiveContext - 1, 'TOKEN_PREFLIGHT_INPUT_TRUNCATION');
  requireThat(receipt.inputTokens + receipt.outputAllowance + 1 <= receipt.effectiveContext,
    'TOKEN_PREFLIGHT_OUTPUT_HEADROOM');
  return receipt;
}

export function exactContextPreflight(request, { modelStore = 'C:/cy-rehearsal/models',
  python = 'python', run = spawnSync } = {}) {
  const helper = fileURLToPath(new URL('./cy-context-preflight.py', import.meta.url));
  const result = run(python, ['-I', '-B', helper, '--model-store', modelStore], {
    input: JSON.stringify(request), encoding: 'utf8', timeout: 30000,
    maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (result.error) throw new Error(`TOKEN_PREFLIGHT_UNAVAILABLE:${result.error.message}`);
  if (result.status !== 0) throw new Error(`TOKEN_PREFLIGHT_FAILED:${result.stderr || result.stdout}`);
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { throw new Error('TOKEN_PREFLIGHT_INVALID_RECEIPT'); }
  return validateContextReceipt(request, receipt);
}
