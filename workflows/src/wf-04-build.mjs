import { createHash } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import * as S from './wf-04-code.mjs';

// uso: node workflows/src/wf-04-build.mjs workflows/WF-04-creative-briefing.json
const OUT = process.argv[2] || new URL('../WF-04-creative-briefing.json', import.meta.url).pathname;
const BRAND_SLUGS = readdirSync(new URL('../../brands', import.meta.url), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (!BRAND_SLUGS.length) throw new Error('Nenhuma marca em brands/. Crie brands/<slug>/brand.json antes do build.');

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

const code = (name, col, row, body) =>
  add({
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [X(col), Y(row)],
    parameters: { jsCode: body },
  });

const route = (name, col, row, outputs) =>
  add({
    name,
    type: 'n8n-nodes-base.switch',
    typeVersion: 3.4,
    position: [X(col), Y(row)],
    parameters: { mode: 'expression', numberOutputs: outputs, output: '={{ $json.route }}', looseTypeValidation: false },
  });

const note = (name, col, row, w, h, content, color = 7) =>
  add({
    name,
    type: 'n8n-nodes-base.stickyNote',
    typeVersion: 1,
    position: [X(col) - 40, Y(row) - 120],
    parameters: { content, width: w, height: h, color },
  });

const option = (label) => ({ option: label });

const A1 = add({
  name: 'A1 · Form Briefing',
  type: 'n8n-nodes-base.formTrigger',
  typeVersion: 2.2,
  webhookId: stableId('A1 · Form Briefing:webhook'),
  position: [X(0), Y(0)],
  parameters: {
    formTitle: 'Briefing criativo',
    formDescription:
      'Preencha a demanda como ela deve chegar à criação. Separe conceito, referências, produto, copy por tela e necessidades de foto. Depois use GERAR RASCUNHOS com o Job ID.',
    formFields: {
      values: [
        {
          fieldLabel: 'Marca',
          fieldType: 'dropdown',
          requiredField: true,
          defaultValue: BRAND_SLUGS[0],
          fieldOptions: { values: BRAND_SLUGS.map(option) },
        },
        {
          fieldLabel: 'Tipo de peça',
          fieldType: 'dropdown',
          requiredField: true,
          defaultValue: 'Carrossel',
          fieldOptions: { values: [option('Carrossel')] },
        },
        {
          fieldLabel: 'Telas do carrossel',
          fieldType: 'number',
          requiredField: true,
          placeholder: '5',
          defaultValue: '5',
        },
        {
          fieldLabel: 'Canal',
          fieldType: 'dropdown',
          requiredField: true,
          defaultValue: 'Instagram Feed',
          fieldOptions: { values: [option('Instagram Feed')] },
        },
        {
          fieldLabel: 'Motivo do post',
          fieldType: 'dropdown',
          requiredField: true,
          fieldOptions: {
            values: [
              option('Lançamento de coleção'),
              option('Destaque de produto'),
              option('Manifesto de marca'),
              option('Campanha / promoção'),
              option('Educativo'),
            ],
          },
        },
        {
          fieldLabel: 'Título da demanda',
          fieldType: 'text',
          requiredField: true,
          placeholder: 'Ex.: Um dia inteiro com a mesma peça',
        },
        {
          fieldLabel: 'Conceito criativo',
          fieldType: 'textarea',
          requiredField: true,
          placeholder: 'Resuma a ideia da peça e a narrativa. Ex.: acompanhar o mesmo homem, com a mesma polo, do pré-treino ao jantar.',
        },
        {
          fieldLabel: 'Mensagem principal',
          fieldType: 'textarea',
          requiredField: true,
          placeholder: 'O que a pessoa deve entender ao terminar o carrossel?',
        },
        {
          fieldLabel: 'Status da copy',
          fieldType: 'dropdown',
          requiredField: true,
          defaultValue: 'Aprovada — não alterar',
          fieldOptions: {
            values: [
              option('Aprovada — não alterar'),
              option('Pode revisar mantendo o sentido'),
              option('Rascunho — pode desenvolver'),
            ],
          },
        },
        {
          fieldLabel: 'Roteiro por tela',
          fieldType: 'textarea',
          requiredField: true,
          placeholder: 'Use exatamente: Tela 1: ...\\nTela 2: ...\\nTela 3: ...',
        },
        {
          fieldLabel: 'CTA / fechamento',
          fieldType: 'text',
          requiredField: false,
          placeholder: 'Opcional. Ex.: Conheça a Polo Básica.',
        },
        {
          fieldLabel: 'Referências visuais (uma URL por linha)',
          fieldType: 'textarea',
          requiredField: false,
          placeholder: 'https://www.instagram.com/p/.../\\nhttps://www.instagram.com/p/.../',
        },
        {
          fieldLabel: 'Nome do produto',
          fieldType: 'text',
          requiredField: false,
          placeholder: 'Obrigatório para “Destaque de produto”. Ex.: Polo Básica',
        },
        {
          fieldLabel: 'SKU / código do produto',
          fieldType: 'text',
          requiredField: false,
          placeholder: 'Ex.: EX-001-CINZA',
        },
        {
          fieldLabel: 'Cor / variação',
          fieldType: 'text',
          requiredField: false,
          placeholder: 'Ex.: Cinza',
        },
        {
          fieldLabel: 'Link do produto',
          fieldType: 'text',
          requiredField: false,
          placeholder: 'https://www.suamarca.com.br/produto/...',
        },
        {
          fieldLabel: 'Abordagem visual',
          fieldType: 'checkbox',
          requiredField: true,
          limitSelection: 'range',
          minSelections: 1,
          maxSelections: 4,
          fieldOptions: {
            values: [
              option('Editorial'),
              option('Foto dominante'),
              option('Pouco texto'),
              option('Close de produto'),
            ],
          },
        },
        {
          fieldLabel: 'Continuidade de modelo/personagem',
          fieldType: 'dropdown',
          requiredField: true,
          defaultValue: 'Não se aplica',
          fieldOptions: {
            values: [
              option('Não se aplica'),
              option('Mesma pessoa em todas as telas'),
              option('Pode variar entre as telas'),
            ],
          },
        },
        {
          fieldLabel: 'Cenas e assets obrigatórios',
          fieldType: 'textarea',
          requiredField: false,
          placeholder: 'Ex.: mesmo homem usando a Polo Básica em casa, treino, trabalho, almoço, tênis e jantar.',
        },
        {
          fieldLabel: 'Se faltarem fotos',
          fieldType: 'dropdown',
          requiredField: true,
          defaultValue: 'Interromper e pedir os assets',
          fieldOptions: {
            values: [
              option('Interromper e pedir os assets'),
              option('Continuar só com alternativas aprovadas'),
            ],
          },
        },
        {
          fieldLabel: 'Evitar sujeito no centro',
          fieldType: 'checkbox',
          requiredField: false,
          fieldOptions: { values: [option('Evitar sujeito no centro')] },
        },
        {
          fieldLabel: 'Outras restrições',
          fieldType: 'textarea',
          requiredField: false,
          placeholder: 'Somente restrições adicionais. Não cole aqui copy, links ou orientação de cenas.',
        },
      ],
    },
    responseMode: 'lastNode',
    options: {
      path: 'briefing',
      buttonLabel: 'Salvar briefing',
      appendAttribution: false,
    },
  },
});

const B1 = code(S.MAP_NODE, 1, 0, S.B1_MAP);
const B2 = route('B2 · Brief OK?', 2, 0, 3);

const C1 = add({
  name: 'C1 · Insert Job',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.5,
  position: [X(3), Y(0)],
  credentials: {
    postgres: {
      id: stableId('credential:PipeDesign Postgres'),
      name: 'PipeDesign Postgres',
    },
  },
  parameters: {
    operation: 'executeQuery',
    query: `INSERT INTO jobs (id, brand_id, status, content_type, brief_json)
SELECT $1::uuid, b.id, $2, $3, $4::jsonb
FROM brands b
WHERE b.slug = $5
RETURNING id, brand_id, status, content_type, brief_json;`,
    options: {
      queryBatching: 'independently',
      queryReplacement: '={{ [$json.job_id, $json.status, $json.content_type, $json.brief, $json.brand_id] }}',
    },
  },
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
});

const C2 = code('C2 · Check Insert', 4, 0, S.C2_CHECK_INSERT);
const C3 = route('C3 · Insert OK?', 5, 0, 3);

const D1 = add({
  name: 'D1 · Write brief.json',
  type: 'n8n-nodes-base.readWriteFile',
  typeVersion: 1.1,
  position: [X(6), Y(0)],
  parameters: {
    operation: 'write',
    fileName: '={{ $json.brief_path }}',
    dataPropertyName: 'data',
    options: {},
  },
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
});

const D2 = code('D2 · Check Write', 7, 0, S.D2_CHECK_WRITE);
const D3 = route('D3 · Write OK?', 8, 0, 3);

const E1 = add({
  name: 'E1 · Form Ending',
  type: 'n8n-nodes-base.form',
  typeVersion: 2.3,
  webhookId: stableId('E1 · Form Ending:webhook'),
  position: [X(9), Y(0)],
  parameters: {
    operation: 'completion',
    respondWith: 'text',
    completionTitle: 'Briefing salvo',
    completionMessage: '={{ "Job " + $json.job_id + " em READY_FOR_PLANNING.\\n\\nArquivo: " + $json.brief_path + "\\n\\nPróximo passo: http://127.0.0.1:5678/form/gerar-rascunhos" }}',
    options: {},
  },
});

const X9 = add({
  name: 'X · Stop With Error',
  type: 'n8n-nodes-base.stopAndError',
  typeVersion: 1,
  position: [X(5), Y(2)],
  parameters: { errorType: 'errorObject', errorObject: '={{ JSON.stringify($json.error) }}' },
});

connect(A1, B1);
connect(B1, B2);
connect(B2, C1, 0);
connect(B2, X9, 2);
connect(C1, C2);
connect(C2, C3);
connect(C3, D1, 0);
connect(C3, X9, 2);
connect(D1, D2);
connect(D2, D3);
connect(D3, E1, 0);
connect(D3, X9, 2);

note(
  'Nota · Como usar',
  0,
  -2,
  720,
  340,
  `## WF-04 Creative Briefing
Form em http://127.0.0.1:5678/form/briefing (ative o workflow).

**Antes:** \`db/migrate.sh\` e credencial **PipeDesign Postgres** (\`host: postgres\`, banco \`pipedesign\`).

Um envio = um carrossel. O JSON vai para \`jobs.brief_json\` e \`/workspace/jobs/{id}.json\`. Status: \`READY_FOR_PLANNING\`. A página final aponta para o WF-05; o disparo continua manual.`,
  5,
);
note('Nota · B', 1, -1, 680, 280, '### B · Mapear e validar\nRótulos em português viram o JobBrief (`schemas/job-brief.schema.json`). Falha = `BRIEF_INVALID`.', 7);
note('Nota · C', 3, -1, 680, 280, '### C · Postgres\n`INSERT … SELECT` pelo slug da marca. 0 linhas = `BRAND_NOT_FOUND`. Erro de conexão = `BRIEF_PERSIST_FAILED`.', 7);
note('Nota · D/E', 6, -1, 920, 280, '### D–E · Arquivo e tela final\nEscreve `brief.json`. Se o arquivo falhar, o job no banco permanece. A página do Form confirma o `job_id`.', 7);

const workflow = {
  id: stableId('workflow:WF-04 Creative Briefing'),
  name: 'WF-04 Creative Briefing',
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
