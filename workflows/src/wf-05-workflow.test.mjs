import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(readFileSync(join(here, '../WF-05-generate-drafts.json'), 'utf8'));
const node = (name) => workflow.nodes.find((item) => item.name === name);

test('briefing usa embedding local sem Authorization', () => {
  const embedding = node('C4 · Embed Brief Locally');
  assert.ok(embedding);
  assert.match(embedding.parameters.url, /ollama_base_url.*\/api\/embed/);
  assert.deepEqual(embedding.parameters.headerParameters.parameters, [{ name: 'Content-Type', value: 'application/json' }]);
});

test('Art Director continua separado e autenticado na OpenAI', () => {
  const director = node('E1 · Art Director');
  assert.ok(director);
  assert.match(director.parameters.url, /api_base.*\/chat\/completions/);
  assert.ok(director.parameters.headerParameters.parameters.some((header) => header.name === 'Authorization'));
  assert.match(node('A2 · Planning Config').parameters.jsCode, /gpt-4o-mini/);
  assert.match(node('J1 · Form Ending').parameters.completionMessage, /Tokens OpenAI/);
});

test('banco Pexels é preparado pelo renderer e assets locais mantêm prioridade', () => {
  const stock = node('D3 · Prepare Stock Scenes');
  assert.ok(stock);
  assert.match(stock.parameters.url, /renderer_url.*stock\/prepare/);
  assert.deepEqual(stock.parameters.headerParameters.parameters, [{ name: 'Content-Type', value: 'application/json' }]);
  assert.match(node('D2 · Build Stock Request').parameters.jsCode, /priority: 1/);
  assert.match(node('D4 · Build Art Director').parameters.jsCode, /mergeAssetCandidates/);
  assert.match(node('J1 · Form Ending').parameters.completionMessage, /Pexels/);
});

test('Check Job escolhe o DNA pelo slug e falha sem brand.json', () => {
  const run = (brandId) => new Function('$', '$input', node('B2 · Check Job').parameters.jsCode)(
    () => ({ first: () => ({ json: { job_id: 'c0a80100-0000-4000-8000-000000000005' } }) }),
    { first: () => ({ json: { job_id: 'c0a80100-0000-4000-8000-000000000005', status: 'READY_FOR_PLANNING', brand_id: brandId, brief_json: { slides: 2 } } }) },
  )[0].json;
  const ok = run('exemplo');
  assert.equal(ok.ok, true);
  assert.equal(ok.brand_dna.name, 'Marca Exemplo');
  const missing = run('sem-marca');
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'BRAND_DNA_NOT_FOUND');
  assert.deepEqual(missing.error.context.known_brands, ['exemplo']);
});

test('config limita Ollama a hosts locais e parser exige 768 dimensões', () => {
  assert.match(node('A2 · Planning Config').parameters.jsCode, /OLLAMA_URL_INVALID/);
  assert.match(node('C5 · Parse Brief Embedding').parameters.jsCode, /length !== 768/);
});
