import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import * as C from './wf-05-code.mjs';

const OUT = process.argv[2] || new URL('../WF-05-generate-drafts.json', import.meta.url).pathname;
const stableId = (seed) => { const h = createHash('sha256').update(seed).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
const nodes = []; const connections = {};
const add = (node) => { nodes.push({ id: stableId('WF05:' + node.name), ...node }); return node.name; };
const connect = (from,to,output=0) => { connections[from] ??= { main: [] }; while (connections[from].main.length <= output) connections[from].main.push([]); connections[from].main[output].push({ node: to, type: 'main', index: 0 }); };
const pos = (x,y) => [x*240, 300+y*180];
const code = (name,x,y,jsCode) => add({ name, type:'n8n-nodes-base.code', typeVersion:2, position:pos(x,y), parameters:{jsCode} });
const route = (name,x,y) => add({ name, type:'n8n-nodes-base.switch', typeVersion:3.4, position:pos(x,y), parameters:{mode:'expression',numberOutputs:3,output:'={{ $json.route }}',looseTypeValidation:false} });
const pgCred = { postgres:{ id:stableId('credential:PipeDesign Postgres'), name:'PipeDesign Postgres' } };
const pg = (name,x,y,query,replacements,extra={}) => add({ name,type:'n8n-nodes-base.postgres',typeVersion:2.5,position:pos(x,y),credentials:pgCred,alwaysOutputData:true,onError:'continueRegularOutput',parameters:{operation:'executeQuery',query,options:{queryBatching:'independently',queryReplacement:replacements}},...extra });
const http = (name,x,y,url,body,auth=false) => add({ name,type:'n8n-nodes-base.httpRequest',typeVersion:4.5,position:pos(x,y),parameters:{method:'POST',url,authentication:'none',sendHeaders:true,specifyHeaders:'keypair',headerParameters:{parameters:[...(auth?[{name:'Authorization',value:"={{ 'Bearer ' + $env.OPENAI_API_KEY }}"}]:[]),{name:'Content-Type',value:'application/json'}]},sendBody:true,contentType:'json',specifyBody:'json',jsonBody:body,options:{timeout:120000,response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}}} });

const A1=add({name:'A1 · Form Generate Drafts',type:'n8n-nodes-base.formTrigger',typeVersion:2.2,webhookId:stableId('WF05:webhook'),position:pos(0,0),parameters:{formTitle:'GERAR RASCUNHOS',formDescription:'Informe o Job ID criado no briefing. O fluxo recupera fotos da marca, cria e valida o plano, e gera um PPTX editável. Não envia ao Canva.',formFields:{values:[{fieldLabel:'Job ID',fieldType:'text',requiredField:true,placeholder:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}]},responseMode:'lastNode',options:{path:'gerar-rascunhos',buttonLabel:'Gerar PPTX',appendAttribution:false}}});
const A2=code('A2 · Planning Config',1,0,C.CONFIG); const A3=route('A3 · Config OK?',2,0);
const B1=pg('B1 · Load Job',3,0,`SELECT j.id::text AS job_id, j.status, j.content_type, j.brief_json, b.slug AS brand_id FROM jobs j JOIN brands b ON b.id=j.brand_id WHERE j.id=$1::uuid LIMIT 1;`,"={{ [$json.job_id] }}");
const B2=code('B2 · Check Job',4,0,C.CHECK_JOB); const B3=route('B3 · Job Ready?',5,0);
const C1=pg('C1 · Mark Planning',6,0,`UPDATE jobs SET status='PLANNING', updated_at=now() WHERE id=$1::uuid AND status='READY_FOR_PLANNING' RETURNING id::text AS job_id, status;`,"={{ [$json.job_id] }}");
const C2=code('C2 · Build Retrieval',7,0,C.BUILD_RETRIEVAL); const C3=route('C3 · Lock OK?',8,0);
const C4=http('C4 · Embed Brief Locally',9,0,"={{ $('A2 · Planning Config').first().json.ollama_base_url + '/api/embed' }}",'={{ JSON.stringify($json.embedding_request) }}');
const C5=code('C5 · Parse Brief Embedding',10,0,C.PARSE_BRIEF_EMBEDDING); const C6=route('C6 · Embedding OK?',11,0);
const D1=pg('D1 · Retrieve Assets',12,0,`SELECT a.file_path, a.analysis_json, 1 - (a.embedding <=> $1::vector) AS similarity FROM assets a JOIN brands b ON b.id=a.brand_id WHERE b.slug=$2 AND a.is_active=true ORDER BY a.embedding <=> $1::vector LIMIT 30;`,"={{ [$json.embedding_vector, $json.brand_id] }}");
const D2=code('D2 · Build Stock Request',13,0,C.BUILD_STOCK_REQUEST);
const D3=http('D3 · Prepare Stock Scenes',14,0,"={{ $('A2 · Planning Config').first().json.renderer_url + '/stock/prepare' }}",'={{ JSON.stringify($json.stock_request) }}');
const D4=code('D4 · Build Art Director',15,0,C.BUILD_ART_DIRECTOR); const D5=route('D5 · Assets OK?',16,0);
const E1=http('E1 · Art Director',17,0,"={{ $('A2 · Planning Config').first().json.api_base + '/chat/completions' }}",'={{ JSON.stringify($json.art_director_request) }}',true);
const E2=code('E2 · Parse Plan',18,0,C.PARSE_PLAN); const E3=route('E3 · Plan Envelope?',19,0);
const F1=http('F1 · Validate Plan',20,0,"={{ $('A2 · Planning Config').first().json.renderer_url + '/validate' }}",'={{ JSON.stringify({ plan: $json.plan }) }}');
const F2=code('F2 · Check Validation',21,0,C.CHECK_VALIDATION); const F3=route('F3 · Valid or Repair?',22,0);
const G1=code('G1 · Build Repair',20,1,C.BUILD_REPAIR);
const G2=http('G2 · Repair Plan',21,1,"={{ $('A2 · Planning Config').first().json.api_base + '/chat/completions' }}",'={{ JSON.stringify($json.repair_request) }}',true);
const G3=code('G3 · Parse Repair',22,1,C.PARSE_REPAIR); const G4=route('G4 · Repair Envelope?',23,1);
const G5=http('G5 · Validate Repaired',24,1,"={{ $('A2 · Planning Config').first().json.renderer_url + '/validate' }}",'={{ JSON.stringify({ plan: $json.plan }) }}');
const G6=code('G6 · Check Repaired',25,1,C.CHECK_REPAIRED_VALIDATION); const G7=route('G7 · Repaired Valid?',26,1);
const H1=http('H1 · Render PPTX',27,0,"={{ $('A2 · Planning Config').first().json.renderer_url + '/render' }}",'={{ JSON.stringify({ job_id: $json.job_id, plan: $json.plan }) }}');
const H2=code('H2 · Check Render',28,0,C.CHECK_RENDER); const H3=route('H3 · Render OK?',29,0);
const I1=pg('I1 · Persist Plan',30,0,`WITH next_version AS (SELECT COALESCE(MAX(version),0)+1 AS version FROM creative_plans WHERE job_id=$1::uuid), inserted AS (INSERT INTO creative_plans (job_id,version,plan_json,model_provider,model_name,prompt_version) SELECT $1::uuid,version,$2::jsonb,'openai',$3,$4 FROM next_version RETURNING id::text AS plan_id,version), updated AS (UPDATE jobs SET status='PLAN_READY',updated_at=now() WHERE id=$1::uuid AND status='PLANNING' RETURNING id) SELECT inserted.plan_id,inserted.version FROM inserted JOIN updated ON true;`,"={{ [$json.job_id, $json.plan, $('A2 · Planning Config').first().json.art_director_model, $('A2 · Planning Config').first().json.prompt_version] }}");
const I2=code('I2 · Check Persist',31,0,C.CHECK_PERSIST); const I3=route('I3 · Persist OK?',32,0);
const J1=add({name:'J1 · Form Ending',type:'n8n-nodes-base.form',typeVersion:2.3,webhookId:stableId('WF05:ending'),position:pos(33,0),parameters:{operation:'completion',respondWith:'text',completionTitle:'Rascunho gerado',completionMessage:'={{ "Job " + $json.job_id + " em PLAN_READY.\\n\\nPPTX: " + $json.pptx_path + "\\nPlano: " + $json.plan_path + "\\nTelas: " + $json.slides + "\\nModelo: " + $json.model + "\\nTokens OpenAI: " + Object.values($json.openai_usage || {}).reduce((sum, usage) => sum + Number(usage.total_tokens || 0), 0) + ($json.stock_images ? "\\nFotos externas: " + $json.stock_images + " (Pexels: https://www.pexels.com)\\nCréditos: " + $json.credits_path : "\\nFotos externas: 0") + ($json.repaired ? "\\nPlano corrigido uma vez antes do render." : "") }}',options:{}}});
const X1=code('X1 · Failure Context',24,3,C.FAILURE_CONTEXT);
const X2=pg('X2 · Mark Plan Failed',25,3,`UPDATE jobs SET status='PLAN_FAILED',updated_at=now() WHERE id=$1::uuid AND status='PLANNING' RETURNING id;`,"={{ [$json.job_id] }}");
const X3=add({name:'X3 · Stop With Error',type:'n8n-nodes-base.stopAndError',typeVersion:1,position:pos(26,3),parameters:{errorType:'errorObject',errorObject:"={{ JSON.stringify($('X1 · Failure Context').first().json.error) }}"}});

connect(A1,A2); connect(A2,A3); connect(A3,B1,0); connect(A3,X1,2); connect(B1,B2); connect(B2,B3); connect(B3,C1,0); connect(B3,X1,2);
connect(C1,C2); connect(C2,C3); connect(C3,C4,0); connect(C3,X1,2); connect(C4,C5); connect(C5,C6); connect(C6,D1,0); connect(C6,X1,2);
connect(D1,D2); connect(D2,D3); connect(D3,D4); connect(D4,D5); connect(D5,E1,0); connect(D5,X1,2); connect(E1,E2); connect(E2,E3); connect(E3,F1,0); connect(E3,G1,1); connect(E3,X1,2);
connect(F1,F2); connect(F2,F3); connect(F3,H1,0); connect(F3,G1,1); connect(F3,X1,2); connect(G1,G2); connect(G2,G3); connect(G3,G4); connect(G4,G5,0); connect(G4,X1,2);
connect(G5,G6); connect(G6,G7); connect(G7,H1,0); connect(G7,X1,2); connect(H1,H2); connect(H2,H3); connect(H3,I1,0); connect(H3,X1,2);
connect(I1,I2); connect(I2,I3); connect(I3,J1,0); connect(I3,X1,2); connect(X1,X2); connect(X2,X3);

nodes.push({id:stableId('WF05:note'),name:'Nota · WF-05',type:'n8n-nodes-base.stickyNote',typeVersion:1,position:[-40,-180],parameters:{width:1100,height:300,color:5,content:'## WF-05 Gerar Rascunhos\n`/form/gerar-rascunhos` recebe o Job ID do WF-04. Prioriza fotos locais recuperadas por `embeddinggemma`; quando uma cena não existe, consulta o Pexels pelo renderer, baixa a foto para o workspace e registra os créditos. O Art Director `gpt-4o-mini` nunca pode tratar uma roupa Pexels como produto verificado da marca. O DNA de cada marca vem de `brands/<slug>/brand.json` no build. Validação, no máximo um repair e saída PPTX.'}});

const workflow={id:stableId('workflow:WF-05 Generate Drafts'),name:'WF-05 Generate Drafts',nodes,connections,pinData:{},active:false,settings:{executionOrder:'v1',saveManualExecutions:true,saveDataErrorExecution:'all',saveDataSuccessExecution:'all',callerPolicy:'workflowsFromSameOwner'},meta:{templateCredsSetupCompleted:true},tags:[]};
writeFileSync(OUT,JSON.stringify(workflow,null,2)+'\n');
console.log(`wrote ${OUT}: ${nodes.length} nodes`);
