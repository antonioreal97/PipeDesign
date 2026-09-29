import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as C from './wf-02-code.mjs';

const OUT = process.argv[2] || new URL('../WF-02-index-assets.json', import.meta.url).pathname;
const stableId = (seed) => { const h = createHash('sha256').update(seed).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const nodes = []; const connections = {};
const add = (node) => { nodes.push({ id: stableId('WF02:' + node.name), ...node }); return node.name; };
const connect = (from, to, output = 0) => { connections[from] ??= { main: [] }; while (connections[from].main.length <= output) connections[from].main.push([]); connections[from].main[output].push({ node: to, type: 'main', index: 0 }); };
const pos = (x, y) => [x * 240, 300 + y * 180];
const code = (name, x, y, jsCode) => add({ name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos(x,y), parameters: { jsCode } });
const route = (name, x, y) => add({ name, type: 'n8n-nodes-base.switch', typeVersion: 3.4, position: pos(x,y), parameters: { mode: 'expression', numberOutputs: 3, output: '={{ $json.route }}', looseTypeValidation: false } });
const localOllamaHttp = (name, x, y, path, bodyExpr) => add({ name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.5, position: pos(x,y), parameters: {
  method: 'POST', url: `={{ $('A2 · Index Config').first().json.ollama_base_url + '${path}' }}`, authentication: 'none', sendHeaders: true, specifyHeaders: 'keypair',
  headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
  sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: bodyExpr,
  options: { timeout: 300000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } },
} });
const pgCred = { postgres: { id: stableId('credential:PipeDesign Postgres'), name: 'PipeDesign Postgres' } };

const A1 = add({ name: 'A1 · Start Index', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: pos(0,0), parameters: {} });
const A15 = add({ name: 'A1.5 · Load Brand', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: pos(0,1), credentials: pgCred, alwaysOutputData: true, onError: 'continueRegularOutput', parameters: {
  operation: 'executeQuery', query: `SELECT slug, name, workspace_path FROM brands WHERE slug = $1 LIMIT 1;`,
  options: { queryBatching: 'independently', queryReplacement: "={{ [$env.ASSET_INDEX_BRAND || 'exemplo'] }}" },
} });
const A2 = code('A2 · Index Config', 1, 0, C.CONFIG);
const A3 = route('A3 · Config OK?', 2, 0);
const B1 = add({ name: 'B1 · Read Brand Photos', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1.1, position: pos(3,0), parameters: { operation: 'read', fileSelector: "={{ $('A2 · Index Config').first().json.file_glob }}", options: { dataPropertyName: 'data' } }, onError: 'continueRegularOutput' });
const B15 = add({ name: 'B1.5 · Limit Sample', type: 'n8n-nodes-base.limit', typeVersion: 1, position: pos(4,0), parameters: { maxItems: '={{ Number($env.ASSET_INDEX_LIMIT || 3) }}' } });
const B16 = add({ name: 'B1.6 · One Photo at a Time', type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, position: pos(5,0), parameters: { batchSize: 1, options: {} } });
const B2 = code('B2 · Prepare Files', 6, 0, C.PREPARE_FILES);
const B3 = route('B3 · Files OK?', 7, 0);
const C1 = add({ name: 'C1 · Find Existing Asset', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: pos(6,0), credentials: pgCred, alwaysOutputData: true, onError: 'continueRegularOutput', parameters: {
  operation: 'executeQuery', query: `SELECT a.id, a.file_path, a.sha256 FROM assets a JOIN brands b ON b.id = a.brand_id WHERE b.slug = $1 AND a.sha256 = $2 LIMIT 1;`,
  options: { queryBatching: 'independently', queryReplacement: "={{ [$json.brand_id, $json.sha256] }}" },
} });
const C2 = code('C2 · Existing?', 7, 0, C.CHECK_EXISTING);
const C3 = route('C3 · Analyze or Skip?', 8, 0);
const D1 = localOllamaHttp('D1 · Ollama Vision', 9, 0, '/api/chat', '={{ JSON.stringify($json.vision_request) }}');
const D2 = code('D2 · Parse Analysis', 10, 0, C.PARSE_ANALYSIS);
const D3 = route('D3 · Analysis OK?', 11, 0);
const E1 = localOllamaHttp('E1 · Ollama Embedding', 12, 0, '/api/embed', '={{ JSON.stringify($json.embedding_request) }}');
const E2 = code('E2 · Parse Embedding', 13, 0, C.PARSE_EMBEDDING);
const E3 = route('E3 · Embedding OK?', 14, 0);
const F1 = add({ name: 'F1 · Upsert Asset', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: pos(15,0), credentials: pgCred, alwaysOutputData: true, onError: 'continueRegularOutput', parameters: {
  operation: 'executeQuery', query: `INSERT INTO assets (brand_id, file_path, sha256, file_name, mime_type, width, height, orientation, category, analysis_json, analysis_text, embedding, is_active, updated_at)
SELECT b.id, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::vector, true, now() FROM brands b WHERE b.slug = $1
ON CONFLICT (brand_id, sha256) DO UPDATE SET file_path = EXCLUDED.file_path, file_name = EXCLUDED.file_name, mime_type = EXCLUDED.mime_type, width = EXCLUDED.width, height = EXCLUDED.height, orientation = EXCLUDED.orientation, category = EXCLUDED.category, analysis_json = EXCLUDED.analysis_json, analysis_text = EXCLUDED.analysis_text, embedding = EXCLUDED.embedding, is_active = true, updated_at = now()
RETURNING id, file_path, sha256;`,
  options: { queryBatching: 'independently', queryReplacement: "={{ [$json.brand_id, $json.file_path, $json.sha256, $json.file_name, $json.mime_type, $json.width, $json.height, $json.orientation, $json.category, $json.analysis, $json.analysis_text, $json.embedding_vector] }}" },
} });
const F2 = code('F2 · Asset Result', 16, 0, C.CHECK_INSERT);
const F3 = route('F3 · Persist OK?', 17, 0);
const S1 = code('S1 · Skipped', 9, 1, 'return $input.all();');
const Z1 = code('Z1 · Index Complete', 18, 0, "return [{ json: { ok: true, status: 'completed', processed: $input.all().length } }];");
const X1 = add({ name: 'X · Stop With Error', type: 'n8n-nodes-base.stopAndError', typeVersion: 1, position: pos(10,2), parameters: { errorType: 'errorObject', errorObject: '={{ JSON.stringify($json.error) }}' } });

connect(A1,A15); connect(A15,A2); connect(A2,A3); connect(A3,B1,0); connect(A3,X1,2); connect(B1,B15); connect(B15,B16); connect(B16,Z1,0); connect(B16,B2,1); connect(B2,B3); connect(B3,C1,0); connect(B3,X1,2);
connect(C1,C2); connect(C2,C3); connect(C3,D1,0); connect(C3,S1,1); connect(C3,X1,2); connect(D1,D2); connect(D2,D3); connect(D3,E1,0); connect(D3,X1,2);
connect(E1,E2); connect(E2,E3); connect(E3,F1,0); connect(E3,X1,2); connect(F1,F2); connect(F2,F3); connect(F3,B16,0); connect(F3,X1,2); connect(S1,B16);

nodes.push({ id: stableId('WF02:note'), name: 'Nota · WF-02', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-40,-120], parameters: { width: 860, height: 300, color: 5, content: '## WF-02 Index Assets\nExecução manual e incremental por SHA-256. A marca vem de `ASSET_INDEX_BRAND` (slug na tabela `brands`, que fornece o `workspace_path`); padrão/limite vêm de `ASSET_INDEX_GLOB` e `ASSET_INDEX_LIMIT`. Visão e embeddings rodam localmente no Ollama (`gemma3:4b` + `embeddinggemma`), sem fallback externo. Toda query inclui a marca.' } });

const workflow = { id: stableId('workflow:WF-02 Index Assets'), name: 'WF-02 Index Assets', nodes, connections, pinData: {}, active: false, settings: { executionOrder: 'v1', saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'none', callerPolicy: 'workflowsFromSameOwner' }, meta: { templateCredsSetupCompleted: true }, tags: [] };
writeFileSync(OUT, JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote ${OUT}: ${nodes.length} nodes`);
