import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as S from './code-snippets.mjs';

// uso: node workflows/src/build.mjs workflows/spike-canva-autofill.json
const OUT = process.argv[2] || new URL('../spike-canva-autofill.json', import.meta.url).pathname;
// IDs estáveis (derivados do nome) para diffs limpos entre builds.
const stableId = (seed) => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const nodes = [];
const connections = {};
const X = (col) => 0 + col * 240;
const Y = (row) => 300 + row * 180;

function add(node) {
  nodes.push({ id: stableId(node.name), ...node });
  return node.name;
}
function connect(from, to, output = 0) {
  connections[from] ??= { main: [] };
  const main = connections[from].main;
  while (main.length <= output) main.push([]);
  main[output].push({ node: to, type: 'main', index: 0 });
}

const CFG = `$('${S.CONFIG_NODE}').first().json`;
const TOKEN_NODE = 'B1 · Get Canva Token';
const bearer = `={{ 'Bearer ' + $('${TOKEN_NODE}').first().json.body.access_token }}`;

const code = (name, col, row, body, withHelpers = true) =>
  add({
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [X(col), Y(row)],
    parameters: { jsCode: (withHelpers ? S.HELPERS + '\n' : '') + body },
  });

const http = (name, col, row, { method = 'GET', url, headers = [], body }) => {
  const parameters = {
    method,
    url,
    authentication: 'none',
    sendHeaders: headers.length > 0,
    specifyHeaders: 'keypair',
    headerParameters: { parameters: headers.map(([n, v]) => ({ name: n, value: v })) },
    ...(body || {}),
    options: {
      timeout: 30000,
      response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } },
    },
  };
  return add({
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.5,
    position: [X(col), Y(row)],
    parameters,
    // Falha de rede vira item com { error } para o node de checagem classificar.
    onError: 'continueRegularOutput',
  });
};

const route = (name, col, row, outputs) =>
  add({
    name,
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.4,
    position: [X(col), Y(row)],
    parameters: { mode: 'expression', numberOutputs: outputs, output: '={{ $json.route }}', looseTypeValidation: false },
  });

const wait = (name, col, row) =>
  add({
    name,
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [X(col), Y(row)],
    webhookId: stableId(name + ':webhook'),
    parameters: { resume: 'timeInterval', amount: `={{ ${CFG}.poll.interval_seconds }}`, unit: 'seconds' },
  });

const note = (name, col, row, w, h, content, color = 7) =>
  add({
    name,
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [X(col) - 40, Y(row) - 120],
    parameters: { content, width: w, height: h, color },
  });

const canvaAuthHeader = ['Authorization', bearer];

// ---------------- Bloco A — Configuração
const A1 = add({ name: 'A1 · Start', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [X(0), Y(0)], parameters: {} });
const A2 = code(S.CONFIG_NODE, 1, 0, S.A2_CONFIG, false);

// ---------------- Bloco B — Token
const B1 = http(TOKEN_NODE, 2, 0, {
  url: `={{ ${CFG}.auth_token_url }}`,
  headers: [['x-api-key', "={{ $env.CANVA_AUTH_API_KEY || '' }}"]],
});
const B2 = code('B2 · Check Token', 3, 0, S.B2_CHECK_TOKEN);
const B3 = route('B3 · Modo?', 4, 0, 4); // 0 full · 1 upload_only · 2 falha · 3 import

// ---------------- Bloco C — Brand Template
const C1 = http('C1 · Find Brand Template', 5, -1, { url: `={{ ${CFG}.template_lookup.url }}`, headers: [canvaAuthHeader] });
const C2 = code('C2 · Select Brand Template', 6, -1, S.C2_SELECT_TEMPLATE);
const C3 = route('C3 · Template OK?', 7, -1, 3);

// ---------------- Bloco D — Dataset
const D1 = http('D1 · Get Template Dataset', 8, -1, {
  url: `={{ ${CFG}.api_base }}/brand-templates/{{ encodeURIComponent($json.brand_template_id) }}/dataset`,
  headers: [canvaAuthHeader],
});
const D2 = code('D2 · Validate Dataset', 9, -1, S.D2_VALIDATE_DATASET);
const D3 = route('D3 · Dataset OK?', 10, -1, 3);

// ---------------- Bloco E — Imagem local
const E1 = add({
  name: 'E1 · Read Local Image',
  type: 'n8n-nodes-base.readWriteFile',
  typeVersion: 1.1,
  position: [X(11), Y(0)],
  parameters: { operation: 'read', fileSelector: `={{ ${CFG}.image_path }}`, options: { dataPropertyName: 'data' } },
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
});
const E2 = code('E2 · Validate Local Image', 12, 0, S.E2_VALIDATE_IMAGE);
const E3 = route('E3 · Imagem OK?', 13, 0, 3);

// ---------------- Bloco F/G — Upload + polling
const F1 = http('F1 · Create Asset Upload Job', 14, 0, {
  method: 'POST',
  url: `={{ ${CFG}.api_base }}/asset-uploads`,
  headers: [canvaAuthHeader, ['Content-Type', 'application/octet-stream'], ['Asset-Upload-Metadata', '={{ $json.upload_metadata }}']],
  body: { sendBody: true, contentType: 'binaryData', inputDataFieldName: 'data' },
});
const F2 = code('F2 · Check Upload Job', 15, 0, S.F2_CHECK_UPLOAD);
const F3 = route('F3 · Upload pronto?', 16, 0, 4); // 0 full · 1 aguardar · 2 falha · 3 upload_only
const G0 = wait('G0 · Wait Upload', 16, 1);
const G1 = http('G1 · Get Upload Job', 15, 1, {
  url: `={{ ${CFG}.api_base }}/asset-uploads/{{ encodeURIComponent($json.upload_job_id) }}`,
  headers: [canvaAuthHeader],
});
const F9 = code('F9 · Resultado (upload_only)', 17, 2, S.F9_UPLOAD_RESULT);

// ---------------- Bloco H — AutofillRequest
const H1 = code('H1 · Build Autofill Request', 17, 0, S.H1_BUILD_REQUEST);
const H2 = route('H2 · Request OK?', 18, 0, 3);

// ---------------- Bloco I/J — Autofill + polling
const I1 = http('I1 · Create Autofill Job', 19, 0, {
  method: 'POST',
  url: `={{ ${CFG}.api_base }}/autofills`,
  headers: [canvaAuthHeader],
  body: { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.autofill_request) }}' },
});
const J1 = code('J1 · Check Autofill Job', 20, 0, S.J1_CHECK_AUTOFILL);
const J2 = route('J2 · Autofill pronto?', 21, 0, 3); // 0 pronto · 1 aguardar · 2 falha
const J0 = wait('J0 · Wait Autofill', 21, 1);
const J3 = http('J3 · Get Autofill Job', 20, 1, {
  url: `={{ ${CFG}.api_base }}/autofills/{{ encodeURIComponent($json.autofill_job_id) }}`,
  headers: [canvaAuthHeader],
});

// ---------------- Bloco K — Design
const K1 = http('K1 · Get Design', 22, 0, {
  url: `={{ ${CFG}.api_base }}/designs/{{ encodeURIComponent($json.design_id) }}`,
  headers: [canvaAuthHeader],
});
const K2 = code('K2 · Check Design', 23, 0, S.K2_RESULT);
const K3 = route('K3 · Design OK?', 24, 0, 3);
const K9 = code('K9 · Resultado Final', 25, 0, S.K9_FINAL, false);

// ---------------- Bloco M — Importação de arquivos (PDF/PPTX → design editável)
const M1 = add({
  name: 'M1 · Read Import Files',
  type: 'n8n-nodes-base.readWriteFile',
  typeVersion: 1.1,
  position: [X(5), Y(3)],
  parameters: { operation: 'read', fileSelector: `={{ ${CFG}.import_glob }}`, options: { dataPropertyName: 'data', literalBrackets: true } },
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
});
const M2 = code('M2 · Prepare Import Files', 6, 3, S.M2_PREPARE_IMPORTS);
const M3 = route('M3 · Arquivos OK?', 7, 3, 3);
const M4 = http('M4 · Create Design Import Job', 8, 3, {
  method: 'POST',
  url: `={{ ${CFG}.api_base }}/imports`,
  headers: [canvaAuthHeader, ['Import-Metadata', '={{ $json.import_metadata }}']],
  body: { sendBody: true, contentType: 'binaryData', inputDataFieldName: 'data' },
});
const M5 = code('M5 · Check Import Jobs', 9, 3, S.M5_CHECK_IMPORTS);
const M5r = route('M5 · Importações prontas?', 10, 3, 3);
const M6 = add({
  name: 'M6 · Wait Import',
  type: 'n8n-nodes-base.wait',
  typeVersion: 1.1,
  position: [X(10), Y(4)],
  webhookId: stableId('M6 · Wait Import:webhook'),
  parameters: { resume: 'timeInterval', amount: `={{ ${CFG}.poll.interval_seconds }}`, unit: 'seconds' },
});
const M7 = code('M7 · Expand Pending Jobs', 9, 4, S.M7_EXPAND_PENDING, false);
const M8 = http('M8 · Get Design Import Job', 8, 4, {
  url: `={{ ${CFG}.api_base }}/imports/{{ encodeURIComponent($json.job_id) }}`,
  headers: [canvaAuthHeader],
});
const M9 = code('M9 · Resultado (import)', 11, 3, S.K9_FINAL, false);

// ---------------- Falha única
const X9 = add({
  name: 'X · Stop With Error',
  type: 'n8n-nodes-base.stopAndError',
  typeVersion: 1,
  position: [X(13), Y(2)],
  parameters: { errorType: 'errorObject', errorObject: '={{ JSON.stringify($json.error) }}' },
});

// ---------------- Conexões
connect(A1, A2); connect(A2, B1); connect(B1, B2); connect(B2, B3);
connect(B3, C1, 0); connect(B3, E1, 1); connect(B3, X9, 2); connect(B3, M1, 3);
connect(M1, M2); connect(M2, M3);
connect(M3, M4, 0); connect(M3, X9, 2);
connect(M4, M5); connect(M5, M5r);
connect(M5r, M9, 0); connect(M5r, M6, 1); connect(M5r, X9, 2);
connect(M6, M7); connect(M7, M8); connect(M8, M5);
connect(C1, C2); connect(C2, C3);
connect(C3, D1, 0); connect(C3, X9, 2);
connect(D1, D2); connect(D2, D3);
connect(D3, E1, 0); connect(D3, X9, 2);
connect(E1, E2); connect(E2, E3);
connect(E3, F1, 0); connect(E3, X9, 2);
connect(F1, F2); connect(F2, F3);
connect(F3, H1, 0); connect(F3, G0, 1); connect(F3, X9, 2); connect(F3, F9, 3);
connect(G0, G1); connect(G1, F2);
connect(H1, H2);
connect(H2, I1, 0); connect(H2, X9, 2);
connect(I1, J1); connect(J1, J2);
connect(J2, K1, 0); connect(J2, J0, 1); connect(J2, X9, 2);
connect(J0, J3); connect(J3, J1);
connect(K1, K2); connect(K2, K3);
connect(K3, K9, 0); connect(K3, X9, 2);

// ---------------- Notas
note('Nota · Como usar', 0, -2, 700, 300,
`## SPIKE - Canva Autofill E2E
Spike técnico (docs/CANVA_INTEGRATION_SPIKE.md). Execute com **Execute Workflow**.

**Antes:** autorize em http://127.0.0.1:3001/auth/canva/start

**Modo** (\`SPIKE_MODE\` no .env ou OVERRIDES em A2):
- \`upload_only\` → token → imagem → upload → asset_id
- \`full\` → + template, dataset, Autofill e design (exige Autofill/Enterprise)
- \`import\` → PDF/PPTX de \`/workspace/spike/import-test\` → designs editáveis (sem Enterprise)

Toda falha termina em **X · Stop With Error** com o erro padronizado (§32). O resultado fica no último node executado.`, 5);
note('Nota · A/B', 1, -1, 900, 340, '### A–B · Config e token\nValores do .env. O token vem do canva-auth (renovado automaticamente); o client secret nunca passa pelo n8n.', 7);
note('Nota · C/D', 5, -2, 1450, 340, '### C–D · Brand Template e dataset\nBusca por `CANVA_TEST_BRAND_TEMPLATE_ID` ou pelo título. Valida COVER_IMAGE (image), HEADLINE e SUBHEADLINE (text) **antes** do upload.', 7);
note('Nota · E', 11, -1, 680, 340, '### E · Imagem local\nLê `SPIKE_IMAGE_PATH` (dentro do container: ./workspace = /workspace). Aceita JPEG/PNG/HEIC/TIFF/GIF/WEBP até 50 MB.', 7);
note('Nota · F/G', 14, -1, 920, 700, '### F–G · Upload assíncrono\nPOST /asset-uploads e polling a cada 2 s (máx. 30). 429/5xx/rede durante o polling = nova tentativa.', 7);
note('Nota · H–K', 17, -1, 2150, 700, '### H–K · Autofill e design\nAutofillRequest validado contra o dataset real → POST /autofills → polling → GET /designs/{id}. 403 no Autofill = BLOCKED_BY_PLAN (exige Enterprise ou acesso de dev).', 7);

note('Nota · M', 5, 2, 1700, 520, '### M · Importar PDF/PPTX (modo import)\nLê os arquivos de `SPIKE_IMPORT_GLOB`, cria um job `POST /imports` por arquivo e acompanha todos juntos (`GET /imports/{id}`). O resultado lista o `edit_url` de cada design. Não depende de Autofill.', 4);

const workflow = {
  name: 'SPIKE - Canva Autofill E2E',
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    saveDataErrorExecution: 'all',
    saveDataSuccessExecution: 'all',
    callerPolicy: 'workflowsFromSameOwner',
  },
  meta: { templateCredsSetupCompleted: true },
  tags: [],
};

writeFileSync(OUT, JSON.stringify(workflow, null, 2) + '\n');
console.log(`wrote ${OUT}: ${nodes.length} nodes`);
