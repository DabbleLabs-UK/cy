#!/usr/bin/env python3
"""Offline, model-pinned ASCII LLAMA3/BPE accounting. No weights, server or network.

Port of the exact GGUF tokenizer method validated by the neutral-gate preparation.
Unsupported Unicode/special-token/request/template shapes FAIL CLOSED; no estimates.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

if not __debug__:
    raise RuntimeError('OPTIMIZED_PYTHON_UNSUPPORTED: preflight assertions must remain active')

MODEL = 'hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M'
BLOB_SHA = '7afb333a43c3cd660e0a9720828ae963336796377dbf189c6a33a403527c6785'
MANIFEST_SHA = 'c6ec899cdf5f8e3f55350f7fc28735be2f77556c011f71a5bf6402556aba1cc8'
TEMPLATE_SHA = '62fbfd9ed093d6e5ac83190c86eec5369317919f4b149598d2dbb38900e9faef'
PARAMS_SHA = 'b78301c0df4d16b2d9ad21cc9448817c816e2efe94fc2ed072cb85b0928e4030'
VOCAB_SHA = '0a6e094b8438fcc9373603e3521bb998bee9f8981ebcee988ba8de80aeb5b404'
MERGES_SHA = '0cd100e0ab7dbd83c3b668a7cfb2aed1f63f2aec66dae6ec4b63de2c552bb82d'
METHOD = 'cy-llama-bpe-ascii.v1'
OLLAMA_BINARY_SHA = '1ff56c8b2c791bff69b6457d25aa63ed11073562cd47b14f42dd16dfa4353e05'
TEMPLATE = ('{{ if .System }}<|im_start|>system\n{{ .System }}<|im_end|>\n'
            '{{ end }}{{ if .Prompt }}<|im_start|>user\n{{ .Prompt }}<|im_end|>\n'
            '{{ end }}<|im_start|>assistant\n{{ .Response }}<|im_end|>\n')
PRE = re.compile(r"(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])"
                 r'|[^\r\nA-Za-z0-9]?[A-Za-z]+'
                 r'|[0-9]{1,3}| ?[^\sA-Za-z0-9]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_metadata(blob):
    """Read GGUF metadata only, never tensor data or model weights."""
    scalar = {0: '<B', 1: '<b', 2: '<H', 3: '<h', 4: '<I', 5: '<i', 6: '<f',
              7: '<?', 10: '<Q', 11: '<q', 12: '<d'}
    with open(blob, 'rb') as file:
        def number(fmt):
            return struct.unpack(fmt, file.read(struct.calcsize(fmt)))[0]

        def string():
            return file.read(number('<Q')).decode('utf-8')

        def value(kind):
            if kind in scalar:
                return number(scalar[kind])
            if kind == 8:
                return string()
            if kind == 9:
                item_type, count = number('<I'), number('<Q')
                return [value(item_type) for _ in range(count)]
            raise ValueError('UNSUPPORTED_GGUF_TYPE')

        assert file.read(4) == b'GGUF', 'NOT_GGUF'
        assert number('<I') == 3, 'UNSUPPORTED_GGUF_VERSION'
        number('<Q')
        count = number('<Q')
        result = {}
        for _ in range(count):
            key = string()
            item = value(number('<I'))
            if key.startswith('tokenizer.') or key in ('general.architecture', 'llama.vocab_size'):
                result[key] = item
        result['metadataBytesRead'] = file.tell()
        return result


def byte_unicode():
    byte_values = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
    codepoints = byte_values[:]
    extra = 0
    for byte in range(256):
        if byte not in byte_values:
            byte_values.append(byte)
            codepoints.append(256 + extra)
            extra += 1
    return dict(zip(byte_values, map(chr, codepoints)))


class Tokenizer:
    def __init__(self, blob):
        self.meta = read_metadata(blob)
        m = self.meta
        assert m['general.architecture'] == 'llama', 'UNSUPPORTED_ARCHITECTURE'
        assert m['tokenizer.ggml.model'] == 'gpt2' and m['tokenizer.ggml.pre'] == 'llama-bpe', 'UNSUPPORTED_TOKENIZER'
        self.tokens = m['tokenizer.ggml.tokens']
        assert len(self.tokens) == m['llama.vocab_size'] == 128256, 'UNSUPPORTED_VOCABULARY'
        assert sha('\n'.join(self.tokens).encode()) == VOCAB_SHA, 'VOCABULARY_MISMATCH'
        merges = m['tokenizer.ggml.merges']
        assert sha('\n'.join(merges).encode()) == MERGES_SHA, 'MERGES_MISMATCH'
        assert m['tokenizer.ggml.bos_token_id'] == 128000, 'BOS_MISMATCH'
        assert not m.get('tokenizer.ggml.add_eos_token', False), 'UNSUPPORTED_EOS_ADDITION'
        self.vocab = {token: index for index, token in enumerate(self.tokens)}
        self.ranks = {tuple(merge.split(' ', 1)): index for index, merge in enumerate(merges)}
        self.b2u = byte_unicode()
        self.u2b = {value: key for key, value in self.b2u.items()}
        self.special = [token for token, kind in zip(self.tokens, m['tokenizer.ggml.token_type']) if kind in (3, 4)]

    def tokenize(self, text, bos=True):
        assert text.isascii(), 'UNSUPPORTED_NON_ASCII_EXACT_TOKENIZATION_REQUIRED'
        assert all(c in '\t\r\n' or 32 <= ord(c) < 127 for c in text), 'UNSUPPORTED_CONTROL_CHARACTER'
        assert not any(token in text for token in self.special), 'UNSUPPORTED_EMBEDDED_SPECIAL_TOKEN'
        ids, position = ([128000] if bos else []), 0
        while position < len(text):
            match = PRE.match(text, position)
            assert match and match.end() > position, 'PRETOKENIZER_FAILED'
            position = match.end()
            encoded = ''.join(self.b2u[byte] for byte in match.group().encode('utf-8'))
            if encoded in self.vocab:  # llama-bpe ignore_merges
                ids.append(self.vocab[encoded])
                continue
            pieces = list(encoded)
            while len(pieces) > 1:
                candidates = [(self.ranks[(pieces[i], pieces[i + 1])], i) for i in range(len(pieces) - 1)
                              if (pieces[i], pieces[i + 1]) in self.ranks]
                if not candidates:
                    break
                _, index = min(candidates)
                pieces[index:index + 2] = [pieces[index] + pieces[index + 1]]
            ids.extend(self.vocab[piece] for piece in pieces)
        return ids

    def decode(self, ids):
        return b''.join(bytes(self.u2b[c] for c in self.tokens[index]) for index in ids).decode('utf-8')


def render(request):
    assert request.get('model') == MODEL, 'UNSUPPORTED_MODEL'
    assert set(request) <= {'model', 'system', 'prompt', 'format', 'options', 'stream', 'keep_alive', 'truncate'}, 'UNSUPPORTED_REQUEST_FIELD'
    assert isinstance(request.get('system'), str) and request['system'], 'EXPLICIT_SYSTEM_REQUIRED'
    assert isinstance(request.get('prompt'), str) and request['prompt'], 'EXPLICIT_PROMPT_REQUIRED'
    return ('<|im_start|>system\n' + request['system'] + '<|im_end|>\n<|im_start|>user\n'
            + request['prompt'] + '<|im_end|>\n<|im_start|>assistant\n')


def budget(input_tokens, context, output, keep=4):
    assert isinstance(context, int) and context > 1 and isinstance(output, int) and output > 0
    keep = max(0, min(keep, context - 1))
    overflow = input_tokens > context - 1
    shift_limit = context - max((context - keep) // 2, 1)
    return {'inputTokens': input_tokens, 'effectiveContext': context, 'outputAllowance': output,
            'initialTruncation': overflow, 'initialTruncationLimit': shift_limit if overflow else None,
            'remainingTokens': context - input_tokens, 'reservedTerminalTokens': 1,
            'spareAfterFullOutput': context - input_tokens - output - 1,
            'fits': not overflow and input_tokens + output + 1 <= context}


def inspect(request_bytes, store, include_tokens=False):
    request = json.loads(request_bytes)
    # Pin the audited executable without starting it. A replacement build must
    # be audited again, even if its displayed version string is unchanged.
    binary = store.parent / 'ollama/ollama.exe'
    assert sha(binary.read_bytes()) == OLLAMA_BINARY_SHA, 'OLLAMA_BINARY_MISMATCH'
    manifest_bytes = (store / 'manifests/hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF/Q5_K_M').read_bytes()
    assert sha(manifest_bytes) == MANIFEST_SHA, 'MODEL_MANIFEST_MISMATCH'
    manifest = json.loads(manifest_bytes)
    assert [layer['digest'].split(':')[1] for layer in manifest['layers']] == [BLOB_SHA, TEMPLATE_SHA, PARAMS_SHA], 'UNSUPPORTED_MODEL_LAYERS'
    template = (store / ('blobs/sha256-' + TEMPLATE_SHA)).read_bytes()
    assert sha(template) == TEMPLATE_SHA and template.decode() == TEMPLATE, 'TEMPLATE_MISMATCH'
    config_digest = manifest['config']['digest'].split(':')[1]
    assert sha((store / ('blobs/sha256-' + config_digest)).read_bytes()) == config_digest, 'MODEL_CONFIG_MISMATCH'
    params = (store / ('blobs/sha256-' + PARAMS_SHA)).read_bytes()
    assert sha(params) == PARAMS_SHA, 'MODEL_PARAMS_MISMATCH'
    assert json.loads(params) == {'stop': ['<|im_start|>', '<|im_end|>']}, 'UNSUPPORTED_MODEL_DEFAULTS'
    blob = store / ('blobs/sha256-' + BLOB_SHA)
    assert blob.stat().st_size == 5732987968, 'MODEL_BLOB_SIZE_MISMATCH'
    tokenizer = Tokenizer(blob)
    text = render(request)
    ids = tokenizer.tokenize(text)
    options = request['options']
    assert options['num_ctx'] == 3072, 'PRODUCTION_CONTEXT_MISMATCH'
    assert options['num_predict'] == 420, 'PRODUCTION_OUTPUT_ALLOWANCE_MISMATCH'
    # s.tokenizerAddsBOS uses the explicit GGUF flag, unlike the engine default BOS.
    keep = options.get('num_keep', 4) + int(bool(tokenizer.meta.get('tokenizer.ggml.add_bos_token', False)))
    result = {'method': METHOD, 'model': MODEL, 'requestFingerprint': sha(request_bytes),
              'ollamaBinarySha256': OLLAMA_BINARY_SHA,
              'ollamaSourceRevision': '38fdb5dd58c761f850cddd6ba1e78a7954646b4f',
              'modelManifestSha256': MANIFEST_SHA, 'modelBlobSha256': BLOB_SHA,
              'templateSha256': TEMPLATE_SHA, 'vocabSha256': VOCAB_SHA, 'mergesSha256': MERGES_SHA,
              'tokenizerPre': 'llama-bpe', 'addSpecialBOS': True, 'renderedCharacters': len(text),
              'systemTextTokens': len(tokenizer.tokenize(request['system'], bos=False)),
              'promptTextTokens': len(tokenizer.tokenize(request['prompt'], bos=False)),
              'metadataBytesRead': tokenizer.meta['metadataBytesRead'], 'weightsLoaded': False,
              'inferenceExecuted': False, 'serverStarted': False, **budget(len(ids), 3072, 420, keep)}
    if include_tokens:
        result['renderedPrompt'] = text
        result['tokenIds'] = ids
        if result['initialTruncation']:
            limit = result['initialTruncationLimit']
            discard = len(ids) - limit
            result['discardedPrompt'] = tokenizer.decode(ids[keep:keep + discard])
            result['retainedPrompt'] = tokenizer.decode(ids[:keep] + ids[keep + discard:])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-store', required=True, type=Path)
    parser.add_argument('--inspect-only', action='store_true', help='Report a failed budget without approving it')
    parser.add_argument('--include-tokens', action='store_true', help='Local audit only; rendered input and exact token IDs')
    args = parser.parse_args()
    result = inspect(sys.stdin.buffer.read(), args.model_store, args.include_tokens)
    print(json.dumps(result, ensure_ascii=True))
    if not result['fits'] and not args.inspect_only:
        raise SystemExit('CONTEXT_PREFLIGHT_REJECTED: full input + output allowance + terminal token exceed production context')


if __name__ == '__main__':
    main()
