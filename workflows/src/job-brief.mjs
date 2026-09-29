// Contrato JobBrief do WF-04. Usado nos testes e inlined no Code node do n8n
// (o build remove a palavra `export` antes de colar).

export const SLIDES_MIN = 2;
export const SLIDES_MAX = 10;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidV4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = Math.random() * 16 | 0;
    const v = ch === 'x' ? n : (n & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Slug da marca: nome da pasta em brands/ e coluna brands.slug.
export const BRAND_SLUG_RE = /^[a-z0-9-]+$/;

export const CONTENT_TYPE = {
  Carrossel: 'carousel',
  carousel: 'carousel',
};

export const CHANNEL = {
  'Instagram Feed': 'instagram_feed',
  instagram_feed: 'instagram_feed',
};

export const OBJECTIVE = {
  'Lançamento de coleção': 'collection_launch',
  collection_launch: 'collection_launch',
  'Destaque de produto': 'product_highlight',
  product_highlight: 'product_highlight',
  'Manifesto de marca': 'brand_manifesto',
  brand_manifesto: 'brand_manifesto',
  'Campanha / promoção': 'campaign_promo',
  campaign_promo: 'campaign_promo',
  Educativo: 'educational',
  educational: 'educational',
};

export const VISUAL_DIRECTION = {
  Editorial: 'editorial',
  editorial: 'editorial',
  'Foto dominante': 'photo_dominant',
  photo_dominant: 'photo_dominant',
  'Pouco texto': 'low_text',
  low_text: 'low_text',
  'Close de produto': 'product_closeup',
  product_closeup: 'product_closeup',
};

export const AVOID_CENTER_LABEL = 'Evitar sujeito no centro';

export const COPY_STATUS = {
  'Aprovada — não alterar': 'approved_locked',
  'Pode revisar mantendo o sentido': 'review_keep_meaning',
  'Rascunho — pode desenvolver': 'draft_expandable',
  approved_locked: 'approved_locked',
  review_keep_meaning: 'review_keep_meaning',
  draft_expandable: 'draft_expandable',
};

export const SUBJECT_CONTINUITY = {
  'Não se aplica': 'not_applicable',
  'Mesma pessoa em todas as telas': 'same_person_all_slides',
  'Pode variar entre as telas': 'may_vary',
  not_applicable: 'not_applicable',
  same_person_all_slides: 'same_person_all_slides',
  may_vary: 'may_vary',
};

export const MISSING_ASSET_FALLBACK = {
  'Interromper e pedir os assets': 'stop_and_request_assets',
  'Continuar só com alternativas aprovadas': 'approved_alternatives_only',
  stop_and_request_assets: 'stop_and_request_assets',
  approved_alternatives_only: 'approved_alternatives_only',
};

export function pick(input, keys) {
  if (!input || typeof input !== 'object') return undefined;
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') {
      return input[key];
    }
  }
  return undefined;
}

export function asList(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => asList(item));
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, selected]) => selected === true || selected === 'true' || selected === 1)
      .map(([label]) => label);
  }
  if (typeof value === 'string') {
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }
  return [String(value)];
}

export function isChecked(value, label) {
  if (value === true || value === 'true' || value === 1) return true;
  const list = asList(value);
  return list.includes(label) || list.includes('true') || list.includes('Sim');
}

export function mapEnum(value, table, field) {
  if (value === undefined || value === null || value === '') {
    return { error: field + ' é obrigatório' };
  }
  const raw = typeof value === 'string' ? value.trim() : value;
  const mapped = table[raw];
  if (!mapped) {
    return { error: field + ' inválido: ' + String(raw) };
  }
  return { value: mapped };
}

export function parseBrandSlug(value) {
  if (value === undefined || value === null || value === '') {
    return { error: 'marca é obrigatório' };
  }
  const raw = String(value).trim();
  if (!BRAND_SLUG_RE.test(raw)) {
    return { error: 'marca inválida: ' + raw + ' (use o slug da pasta brands/, ex.: exemplo)' };
  }
  return { value: raw };
}

export function mapVisualDirection(value) {
  const labels = asList(value);
  const mapped = [];
  const seen = new Set();
  const unknown = [];
  for (const label of labels) {
    const code = VISUAL_DIRECTION[label];
    if (!code) {
      unknown.push(label);
      continue;
    }
    if (!seen.has(code)) {
      seen.add(code);
      mapped.push(code);
    }
  }
  if (unknown.length) {
    return { error: 'abordagem visual inválida: ' + unknown.join(', ') };
  }
  if (mapped.length === 0) {
    return { error: 'abordagem visual é obrigatória (escolha ao menos uma)' };
  }
  return { value: mapped };
}

export function parseSlides(value) {
  if (value === undefined || value === null || value === '') {
    return { error: 'telas do carrossel é obrigatório' };
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n)) {
    return { error: 'telas do carrossel deve ser um inteiro' };
  }
  if (n < SLIDES_MIN || n > SLIDES_MAX) {
    return { error: 'telas do carrossel deve estar entre ' + SLIDES_MIN + ' e ' + SLIDES_MAX };
  }
  return { value: n };
}

export function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseUrl(value, field) {
  const raw = cleanText(value).replace(/\\&/g, '&');
  if (!raw) return { value: undefined };
  // O Code node do n8n roda em sandbox e não garante o construtor global URL.
  // Validação deliberadamente portátil: protocolo http(s), sem espaços e com host.
  if (!/^https?:\/\/[^/\s?#]+(?:[/?#][^\s]*)?$/i.test(raw)) {
    return { error: field + ' deve ser uma URL http(s) válida' };
  }
  return { value: raw };
}

export function parseReferenceUrls(value) {
  if (value === undefined || value === null || value === '') return { value: undefined };
  if (Array.isArray(value)) {
    const parsed = value.map((item) => parseUrl(item, 'referência visual'));
    const error = parsed.find((item) => item.error);
    return error || { value: [...new Set(parsed.map((item) => item.value).filter(Boolean))] };
  }
  const urls = [];
  for (const sourceLine of String(value).split(/\r?\n/)) {
    let line = sourceLine.trim();
    if (!line) continue;
    const markdown = line.match(/\[[^\]]*\]\((https?:\/\/[^)]+)\)/i);
    if (markdown) line = markdown[1];
    line = line.replace(/^[-*]\s+/, '').replace(/^<|>$/g, '');
    const parsed = parseUrl(line, 'referência visual');
    if (parsed.error) return parsed;
    urls.push(parsed.value);
  }
  return { value: urls.length ? [...new Set(urls)] : undefined };
}

export function parseSlideCopy(value, slides) {
  if (value === undefined || value === null || value === '') return { value: undefined };
  let items;
  if (Array.isArray(value)) {
    items = value.map((item) => ({
      slide: Number(item && item.slide),
      copy: cleanText(item && item.copy),
    }));
  } else {
    const raw = String(value).trim();
    const matches = [...raw.matchAll(/^\s*Tela\s+(\d+)\s*:\s*(.*)$/gim)];
    if (!matches.length) {
      return { error: 'roteiro por tela deve usar o formato “Tela 1: …”, “Tela 2: …”' };
    }
    if (raw.slice(0, matches[0].index).trim()) {
      return { error: 'roteiro por tela contém texto antes de “Tela 1:”' };
    }
    items = matches.map((match, index) => {
      const bodyStart = match.index + match[0].length;
      const bodyEnd = index + 1 < matches.length ? matches[index + 1].index : raw.length;
      const copy = [match[2].trim(), raw.slice(bodyStart, bodyEnd).trim()].filter(Boolean).join('\n');
      return { slide: Number(match[1]), copy };
    });
  }
  if (items.length !== slides) {
    return { error: 'roteiro por tela deve conter exatamente ' + slides + ' telas' };
  }
  for (let index = 0; index < items.length; index += 1) {
    const expected = index + 1;
    if (items[index].slide !== expected) {
      return { error: 'roteiro por tela deve ser sequencial; esperava Tela ' + expected };
    }
    if (!items[index].copy) {
      return { error: 'Tela ' + expected + ' está sem copy' };
    }
  }
  return { value: items };
}

export function buildAssetConstraints(input) {
  const avoidCenter = isChecked(
    pick(input, ['avoid_center', AVOID_CENTER_LABEL, 'Evitar sujeito no centro']),
    AVOID_CENTER_LABEL,
  );
  const notesRaw = pick(input, ['notes', 'Outras restrições', 'asset_constraints.notes']);
  const notes = typeof notesRaw === 'string' ? notesRaw.trim() : '';
  const constraints = {};
  if (avoidCenter) constraints.avoid_subject_position = ['center'];
  if (notes) constraints.notes = notes;
  return Object.keys(constraints).length ? constraints : undefined;
}

export function validateJobBrief(brief) {
  const errors = [];
  if (!brief || typeof brief !== 'object') {
    return { ok: false, errors: ['brief ausente'] };
  }
  if (typeof brief.job_id !== 'string' || !UUID_RE.test(brief.job_id)) {
    errors.push('job_id deve ser UUID');
  }
  if (typeof brief.brand_id !== 'string' || !brief.brand_id.trim()) {
    errors.push('brand_id é obrigatório');
  }
  if (brief.content_type !== 'carousel') {
    errors.push('content_type deve ser carousel');
  }
  if (!Number.isInteger(brief.slides) || brief.slides < SLIDES_MIN || brief.slides > SLIDES_MAX) {
    errors.push('slides deve ser inteiro entre ' + SLIDES_MIN + ' e ' + SLIDES_MAX);
  }
  if (brief.channel !== 'instagram_feed') {
    errors.push('channel deve ser instagram_feed');
  }
  const validObjectives = [...new Set(Object.values(OBJECTIVE))];
  if (!validObjectives.includes(brief.objective)) {
    errors.push('objective inválido');
  }
  if (!Array.isArray(brief.visual_direction) || brief.visual_direction.length === 0) {
    errors.push('visual_direction é obrigatório');
  } else {
    const valid = new Set(Object.values(VISUAL_DIRECTION));
    const seen = new Set();
    for (const item of brief.visual_direction) {
      if (!valid.has(item)) errors.push('visual_direction inválida: ' + item);
      if (seen.has(item)) errors.push('visual_direction duplicada: ' + item);
      seen.add(item);
    }
  }
  if (brief.status !== 'READY_FOR_PLANNING') {
    errors.push('status deve ser READY_FOR_PLANNING');
  }
  if (typeof brief.created_at !== 'string' || Number.isNaN(Date.parse(brief.created_at))) {
    errors.push('created_at deve ser data ISO-8601');
  }
  if (brief.asset_constraints !== undefined) {
    const ac = brief.asset_constraints;
    if (!ac || typeof ac !== 'object' || Array.isArray(ac)) {
      errors.push('asset_constraints deve ser objeto');
    } else {
      const keys = Object.keys(ac);
      if (keys.length === 0) errors.push('asset_constraints vazio deve ser omitido');
      for (const key of keys) {
        if (key !== 'avoid_subject_position' && key !== 'notes') {
          errors.push('asset_constraints.' + key + ' não é permitido');
        }
      }
      if (ac.avoid_subject_position !== undefined) {
        if (!Array.isArray(ac.avoid_subject_position) || ac.avoid_subject_position.length === 0) {
          errors.push('avoid_subject_position inválido');
        } else {
          const allowed = new Set(['center', 'left', 'right']);
          for (const pos of ac.avoid_subject_position) {
            if (!allowed.has(pos)) errors.push('avoid_subject_position inválido: ' + pos);
          }
        }
      }
      if (ac.notes !== undefined && (typeof ac.notes !== 'string' || !ac.notes.trim())) {
        errors.push('asset_constraints.notes deve ser string não vazia');
      }
    }
  }
  if (brief.campaign !== undefined) {
    const campaign = brief.campaign;
    if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) {
      errors.push('campaign deve ser objeto');
    } else {
      const allowedCampaign = new Set(['title', 'concept', 'key_message', 'cta', 'copy_status']);
      for (const key of Object.keys(campaign)) {
        if (!allowedCampaign.has(key)) errors.push('campaign.' + key + ' não é permitido');
      }
      for (const key of ['title', 'concept', 'key_message', 'cta']) {
        if (campaign[key] !== undefined && (typeof campaign[key] !== 'string' || !campaign[key].trim())) {
          errors.push('campaign.' + key + ' deve ser string não vazia');
        }
      }
      if (campaign.copy_status !== undefined && !new Set(Object.values(COPY_STATUS)).has(campaign.copy_status)) {
        errors.push('campaign.copy_status inválido');
      }
    }
  }
  if (brief.references !== undefined) {
    if (!Array.isArray(brief.references) || !brief.references.length) {
      errors.push('references deve ser array não vazio');
    } else {
      for (const reference of brief.references) {
        if (parseUrl(reference, 'references').error) errors.push('references contém URL inválida');
      }
    }
  }
  if (brief.product !== undefined) {
    const product = brief.product;
    if (!product || typeof product !== 'object' || Array.isArray(product)) {
      errors.push('product deve ser objeto');
    } else {
      const allowedProduct = new Set(['name', 'sku', 'color', 'url']);
      for (const key of Object.keys(product)) {
        if (!allowedProduct.has(key)) errors.push('product.' + key + ' não é permitido');
      }
      for (const key of ['name', 'sku', 'color']) {
        if (product[key] !== undefined && (typeof product[key] !== 'string' || !product[key].trim())) {
          errors.push('product.' + key + ' deve ser string não vazia');
        }
      }
      if (product.url !== undefined && parseUrl(product.url, 'product.url').error) {
        errors.push('product.url inválida');
      }
    }
  }
  if (brief.objective === 'product_highlight' && !brief.product) {
    errors.push('product é obrigatório para destaque de produto');
  }
  if (brief.slide_copy !== undefined) {
    const parsed = parseSlideCopy(brief.slide_copy, brief.slides);
    if (parsed.error) errors.push(parsed.error);
  }
  if (brief.production !== undefined) {
    const production = brief.production;
    if (!production || typeof production !== 'object' || Array.isArray(production)) {
      errors.push('production deve ser objeto');
    } else {
      const allowedProduction = new Set(['subject_continuity', 'asset_requirements', 'fallback_if_missing_assets']);
      for (const key of Object.keys(production)) {
        if (!allowedProduction.has(key)) errors.push('production.' + key + ' não é permitido');
      }
      if (production.subject_continuity !== undefined && !new Set(Object.values(SUBJECT_CONTINUITY)).has(production.subject_continuity)) {
        errors.push('production.subject_continuity inválido');
      }
      if (production.asset_requirements !== undefined && (typeof production.asset_requirements !== 'string' || !production.asset_requirements.trim())) {
        errors.push('production.asset_requirements deve ser string não vazia');
      }
      if (production.fallback_if_missing_assets !== undefined && !new Set(Object.values(MISSING_ASSET_FALLBACK)).has(production.fallback_if_missing_assets)) {
        errors.push('production.fallback_if_missing_assets inválido');
      }
    }
  }
  const allowed = new Set([
    'job_id', 'brand_id', 'content_type', 'slides', 'channel',
    'objective', 'visual_direction', 'campaign', 'references', 'product',
    'slide_copy', 'production', 'asset_constraints', 'status', 'created_at',
  ]);
  for (const key of Object.keys(brief)) {
    if (!allowed.has(key)) errors.push('campo extra: ' + key);
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export function buildJobBriefFromForm(input, opts) {
  const jobId = opts && opts.jobId;
  const createdAt = opts && opts.createdAt;
  if (!jobId || !UUID_RE.test(jobId)) {
    return { ok: false, error: { message: 'job_id interno inválido', context: { job_id: jobId } } };
  }
  if (!createdAt) {
    return { ok: false, error: { message: 'created_at interno ausente' } };
  }

  const brand = parseBrandSlug(pick(input, ['brand_id', 'Marca']));
  const contentType = mapEnum(pick(input, ['content_type', 'Tipo de peça']), CONTENT_TYPE, 'tipo de peça');
  const channel = mapEnum(pick(input, ['channel', 'Canal']), CHANNEL, 'canal');
  const objective = mapEnum(pick(input, ['objective', 'Motivo do post']), OBJECTIVE, 'motivo do post');
  const slides = parseSlides(pick(input, ['slides', 'Telas do carrossel']));
  const visual = mapVisualDirection(pick(input, ['visual_direction', 'Abordagem visual']));

  const fieldErrors = [brand, contentType, channel, objective, slides, visual]
    .filter((part) => part.error)
    .map((part) => part.error);
  if (fieldErrors.length) {
    return {
      ok: false,
      error: {
        message: fieldErrors.join('; '),
        context: { fields: fieldErrors },
      },
    };
  }

  const brief = {
    job_id: jobId,
    brand_id: brand.value,
    content_type: contentType.value,
    slides: slides.value,
    channel: channel.value,
    objective: objective.value,
    visual_direction: visual.value,
    status: 'READY_FOR_PLANNING',
    created_at: createdAt,
  };

  const campaign = {};
  const title = cleanText(pick(input, ['campaign.title', 'Título da demanda']));
  const concept = cleanText(pick(input, ['campaign.concept', 'Conceito criativo']));
  const keyMessage = cleanText(pick(input, ['campaign.key_message', 'Mensagem principal']));
  const cta = cleanText(pick(input, ['campaign.cta', 'CTA / fechamento']));
  const copyStatusRaw = pick(input, ['campaign.copy_status', 'Status da copy']);
  if (title) campaign.title = title;
  if (concept) campaign.concept = concept;
  if (keyMessage) campaign.key_message = keyMessage;
  if (cta) campaign.cta = cta;
  if (copyStatusRaw !== undefined) {
    const copyStatus = mapEnum(copyStatusRaw, COPY_STATUS, 'status da copy');
    if (copyStatus.error) return { ok: false, error: { message: copyStatus.error, context: { fields: [copyStatus.error] } } };
    campaign.copy_status = copyStatus.value;
  }
  if (Object.keys(campaign).length) brief.campaign = campaign;

  const references = parseReferenceUrls(pick(input, ['references', 'Referências visuais (uma URL por linha)']));
  if (references.error) return { ok: false, error: { message: references.error, context: { fields: [references.error] } } };
  if (references.value) brief.references = references.value;

  const product = {};
  const productName = cleanText(pick(input, ['product.name', 'Nome do produto']));
  const productSku = cleanText(pick(input, ['product.sku', 'SKU / código do produto']));
  const productColor = cleanText(pick(input, ['product.color', 'Cor / variação']));
  const productUrl = parseUrl(pick(input, ['product.url', 'Link do produto']), 'link do produto');
  if (productUrl.error) return { ok: false, error: { message: productUrl.error, context: { fields: [productUrl.error] } } };
  if (productName) product.name = productName;
  if (productSku) product.sku = productSku;
  if (productColor) product.color = productColor;
  if (productUrl.value) product.url = productUrl.value;
  if (Object.keys(product).length) brief.product = product;

  const slideCopy = parseSlideCopy(pick(input, ['slide_copy', 'Roteiro por tela']), slides.value);
  if (slideCopy.error) return { ok: false, error: { message: slideCopy.error, context: { fields: [slideCopy.error] } } };
  if (slideCopy.value) brief.slide_copy = slideCopy.value;

  const production = {};
  const continuityRaw = pick(input, ['production.subject_continuity', 'Continuidade de modelo/personagem']);
  const fallbackRaw = pick(input, ['production.fallback_if_missing_assets', 'Se faltarem fotos']);
  const assetRequirements = cleanText(pick(input, ['production.asset_requirements', 'Cenas e assets obrigatórios']));
  if (continuityRaw !== undefined) {
    const continuity = mapEnum(continuityRaw, SUBJECT_CONTINUITY, 'continuidade de modelo/personagem');
    if (continuity.error) return { ok: false, error: { message: continuity.error, context: { fields: [continuity.error] } } };
    production.subject_continuity = continuity.value;
  }
  if (assetRequirements) production.asset_requirements = assetRequirements;
  if (fallbackRaw !== undefined) {
    const fallback = mapEnum(fallbackRaw, MISSING_ASSET_FALLBACK, 'fallback de assets');
    if (fallback.error) return { ok: false, error: { message: fallback.error, context: { fields: [fallback.error] } } };
    production.fallback_if_missing_assets = fallback.value;
  }
  if (Object.keys(production).length) brief.production = production;

  const constraints = buildAssetConstraints(input);
  if (constraints) brief.asset_constraints = constraints;

  const check = validateJobBrief(brief);
  if (!check.ok) {
    return {
      ok: false,
      error: {
        message: check.errors.join('; '),
        context: { fields: check.errors },
      },
    };
  }
  return { ok: true, brief };
}
