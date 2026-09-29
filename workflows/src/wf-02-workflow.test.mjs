import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(readFileSync(join(here, '../WF-02-index-assets.json'), 'utf8'));
const node = (name) => workflow.nodes.find((item) => item.name === name);

test('visão usa somente o Ollama local e não envia Authorization', () => {
  const vision = node('D1 · Ollama Vision');
  assert.ok(vision);
  assert.match(vision.parameters.url, /ollama_base_url.*\/api\/chat/);
  const headers = vision.parameters.headerParameters.parameters;
  assert.deepEqual(headers, [{ name: 'Content-Type', value: 'application/json' }]);
});

test('embedding textual usa o Ollama local sem Authorization', () => {
  const embedding = node('E1 · Ollama Embedding');
  assert.ok(embedding);
  assert.match(embedding.parameters.url, /ollama_base_url.*\/api\/embed/);
  assert.deepEqual(embedding.parameters.headerParameters.parameters, [{ name: 'Content-Type', value: 'application/json' }]);
});

test('config usa o workspace_path da marca carregada do banco', () => {
  assert.deepEqual(workflow.connections['A1 · Start Index'].main[0], [{ node: 'A1.5 · Load Brand', type: 'main', index: 0 }]);
  const run = (row, env = {}) => new Function('$input', '$env', node('A2 · Index Config').parameters.jsCode)(
    { first: () => ({ json: row }) }, env,
  )[0].json;
  const ok = run({ slug: 'exemplo', name: 'Marca Exemplo', workspace_path: '/workspace/clients/exemplo/' });
  assert.equal(ok.ok, true);
  assert.equal(ok.brand_id, 'exemplo');
  assert.equal(ok.client_root, '/workspace/clients/exemplo');
  assert.equal(ok.file_glob, '/workspace/clients/exemplo/Fotos/*.jpg');
  assert.equal(run({}).error.code, 'BRAND_NOT_FOUND');
  const outside = run({ slug: 'exemplo', name: 'Marca Exemplo', workspace_path: '/workspace/clients/exemplo' }, { ASSET_INDEX_GLOB: '/workspace/clients/outra/Fotos/*.jpg' });
  assert.equal(outside.error.code, 'CONFIG_INVALID');
});

test('config bloqueia endpoint visual que não seja local', () => {
  const config = node('A2 · Index Config');
  assert.match(config.parameters.jsCode, /OLLAMA_URL_INVALID/);
  assert.match(config.parameters.jsCode, /ollama\|host\\\.docker\\\.internal\|127/);
  assert.doesNotMatch(config.parameters.jsCode, /OPENAI_API_KEY_MISSING/);
});
