#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(0, 'utf8').trim());
const cache = new Map();

function revive(value) {
  if (typeof value === 'string' && /^\d+$/.test(value)) return reviveIndex(Number(value));
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]));
  return value;
}

function reviveIndex(index) {
  if (cache.has(index)) return cache.get(index);
  const source = table[index];
  if (!source || typeof source !== 'object') return revive(source);
  const target = Array.isArray(source) ? [] : {};
  cache.set(index, target);
  if (Array.isArray(source)) source.forEach((item) => target.push(revive(item)));
  else for (const [key, item] of Object.entries(source)) target[key] = revive(item);
  return target;
}

const root = reviveIndex(0);
const runData = root?.resultData?.runData || {};
const firstJson = (name) => runData[name]?.at(-1)?.data?.main?.flat(2)?.find((item) => item?.json)?.json;
const responseSummary = (name) => {
  const value = firstJson(name) || {};
  const content = value.body?.choices?.[0]?.message?.content;
  let parsed;
  try { parsed = JSON.parse(content); } catch { parsed = null; }
  return {
    status_code: value.statusCode,
    model: value.body?.model,
    usage: value.body?.usage,
    response_plan: parsed ? {
      keys: Object.keys(parsed),
      job_id: parsed.job_id,
      brand: parsed.brand,
      slides: Array.isArray(parsed.slides) ? parsed.slides.length : null,
      slide_shapes: Array.isArray(parsed.slides) ? parsed.slides.map((slide) => ({ layout: slide.layout, keys: Object.keys(slide) })) : null,
      first_slide: Array.isArray(parsed.slides) ? parsed.slides[0] : null,
      last_slide: Array.isArray(parsed.slides) ? parsed.slides.at(-1) : null,
    } : null,
  };
};
const codeSummary = (name) => {
  const value = firstJson(name) || {};
  return {
    route: value.route,
    step: value.step,
    repair_reason: value.repair_reason,
    error: value.error,
    plan: value.plan ? {
      keys: Object.keys(value.plan),
      job_id: value.plan.job_id,
      brand: value.plan.brand,
      slides: Array.isArray(value.plan.slides) ? value.plan.slides.length : null,
      slide_shapes: Array.isArray(value.plan.slides) ? value.plan.slides.map((slide) => ({ layout: slide.layout, keys: Object.keys(slide) })) : null,
      first_slide: Array.isArray(value.plan.slides) ? value.plan.slides[0] : null,
      last_slide: Array.isArray(value.plan.slides) ? value.plan.slides.at(-1) : null,
    } : null,
    openai_usage: value.openai_usage,
    validation: value.validation ? {
      ok: value.validation.ok,
      errors: value.validation.errors,
      warnings: value.validation.warnings,
    } : null,
  };
};
const rendererSummary = (name) => {
  const value = firstJson(name) || {};
  return {
    status_code: value.statusCode,
    ok: value.body?.ok,
    errors: value.body?.errors,
    warnings: value.body?.warnings,
  };
};

console.log(JSON.stringify({
  last_node: root?.resultData?.lastNodeExecuted,
  art_director_response: responseSummary('E1 · Art Director'),
  parsed_plan: codeSummary('E2 · Parse Plan'),
  renderer_validation: rendererSummary('F1 · Validate Plan'),
  parsed_validation: codeSummary('F2 · Check Validation'),
  repair_response: responseSummary('G2 · Repair Plan'),
  parsed_repair: codeSummary('G3 · Parse Repair'),
  failure: codeSummary('X1 · Failure Context'),
}, null, 2));
