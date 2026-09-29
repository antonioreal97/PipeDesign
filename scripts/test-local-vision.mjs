#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const defaultImage = 'workspace/clients/exemplo/Fotos/look-01.jpg';
const imagePath = resolve(process.argv[2] || defaultImage);
const endpoint = process.env.LOCAL_VISION_TEST_URL || 'http://127.0.0.1:11434/api/chat';
const model = process.env.LOCAL_VISION_MODEL || 'gemma3:4b';

const [image, schemaSource] = await Promise.all([
  readFile(imagePath),
  readFile(new URL('../schemas/asset-analysis.schema.json', import.meta.url), 'utf8'),
]);

const schema = JSON.parse(schemaSource);
for (const key of ['$schema', '$id', 'title', 'description']) delete schema[key];

const startedAt = Date.now();
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: 'system',
        content: 'Analise a foto para seleção de assets de design. Descreva somente o que está visível e responda estritamente no JSON Schema fornecido.',
      },
      {
        role: 'user',
        content: `Marca Exemplo. Arquivo: ${basename(imagePath)}. Identifique produto, pessoa, composição, espaço negativo e usos adequados.`,
        images: [image.toString('base64')],
      },
    ],
    format: schema,
    stream: false,
    options: { temperature: 0, num_predict: 800 },
  }),
  signal: AbortSignal.timeout(300_000),
});

const body = await response.json();
if (!response.ok) throw new Error(body.error || `Ollama HTTP ${response.status}`);

const analysis = JSON.parse(body.message?.content || '');
const required = schema.required || [];
const missing = required.filter((key) => analysis[key] === undefined);
if (missing.length) throw new Error(`Resposta sem campos obrigatórios: ${missing.join(', ')}`);

const duplicates = Object.fromEntries(
  ['subjects', 'products', 'dominant_colors', 'style_keywords', 'suitable_for']
    .filter((key) => Array.isArray(analysis[key]) && new Set(analysis[key]).size !== analysis[key].length)
    .map((key) => [key, analysis[key].length - new Set(analysis[key]).size]),
);

console.log(JSON.stringify({
  ok: true,
  endpoint,
  model,
  image: imagePath,
  elapsed_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  duplicate_items_detected: duplicates,
  analysis,
}, null, 2));
