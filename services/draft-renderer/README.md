# draft-renderer

Transforma um **Creative Plan** (JSON) em **PPTX editável**. O arquivo é importado no Canva pelo workflow n8n (modo `import`, `POST /v1/imports`). Esse caminho funciona no Canva Pro, sem Autofill.

```
plano.json ─► validação (padrão da marca) ─► layouts ─► PPTX ─► lint ─► n8n import ─► design no Canva
```

O endpoint `POST /stock/prepare` recebe cenas e paleta, consulta o Pexels quando `PEXELS_API_KEY` estiver configurada e salva os arquivos em `Fotos/BANCO/PEXELS/`. As buscas ficam em cache por 24 horas e cada foto usada mantém os créditos no Creative Plan e em `{job_id}.credits.json`.

## Uso

```bash
pip install -r requirements.txt
python -m renderer.render PLANO.json --client-root workspace/clients/<CLIENTE> --out saida.pptx [--preview] [--strict]
```

O comando imprime um JSON (`ok`, `errors`, `warnings`, `lint`, `file`, `preview`).

## Serviço HTTP para o n8n

O container `draft-renderer` expõe somente na rede interna do Compose:

- `GET /health`;
- `POST /stock/prepare` com `{ "brand": "exemplo", "scenes": [...], "palette": [...] }`;
- `POST /validate` com `{ "plan": { ... } }`;
- `POST /render` com `{ "job_id": "uuid", "plan": { ... } }`.

`/render` valida o plano, gera e executa o lint antes de mover os arquivos para
`/workspace/jobs/{job_id}.pptx` e `/workspace/jobs/{job_id}.plan.json`. O serviço
não recebe `OPENAI_API_KEY`. A única chamada externa opcional é ao Pexels no endpoint de stock, autenticada por `PEXELS_API_KEY` e com fallback seguro para a biblioteca local.

| Código de saída | Significado |
|---|---|
| 0 | Arquivo gerado |
| 2 | Plano recusado. Com `--strict`, qualquer aviso do plano também recusa |
| 3 | O PPTX gerado violou uma regra (lint) |
| 4 | Com `--strict`, aviso de layout (fundo misto, linha que não cabe) |

`--preview` gera um PNG por slide com LibreOffice e `pdftoppm`, só para conferência. A renderização final é a do Canva.

## Plano

```json
{
  "brand": "exemplo",
  "title": "…",
  "slides": [
    {"layout": "capa_manchete", "photo": "Fotos/…jpg", "kicker": "Por que o", "headline": "Caimento\nimporta?",
     "box": "…", "focus": [0.5, 0.0], "extend": {"top": 0.55, "left": 0.25, "right": 0.25}},
    {"layout": "foto_nota", "photo": "…", "position": "top_left", "size": "regular",
     "paragraphs": ["Um **caimento preciso**…"], "phrase": "E começa a pensar"},
    {"layout": "manifesto_preto", "title": "Uma modelagem\ninteligente", "paragraphs": ["acompanha a __amplitude__…"]},
    {"layout": "manifesto_frase", "text": "…"},
    {"layout": "beneficio_duplo", "top": {"photo": "…", "title": "Toque\nseco", "text": "…"}, "bottom": {"…": "…"}},
    {"layout": "manifesto_assinatura", "lines": ["**Tecnologia que você veste.**"], "tagline": "Elegância em movimento."}
  ]
}
```

- **Texto:**
  - `\n` quebra a linha.
  - Ênfase: `**negrito**`, `*serif itálica*` (fonte display) e `__sublinhado__`.
  - A caixa alta é aplicada pelo estilo, então o plano pode vir em caixa normal.
- **Foto:**
  - `focus` é o ponto da foto que fica no centro (valores de 0 a 1).
  - `zoom` (de 1 a 3) aproxima a foto.
  - `extend` estende o fundo de estúdio para `top`, `left` ou `right`. Use quando precisar de espaço para texto.
- **Cor do texto:** `tone` pode ser `auto` (padrão, decidido pela luminância da foto sob o texto), `light` ou `dark`.
- **Posições (`position`) no `foto_nota`:** `top_left`, `top_right`, `bottom_left`, `bottom_right`, `middle_left` e `middle_right`.

Os caminhos das fotos são relativos a `--client-root`.

## Organização

| Arquivo | Papel |
|---|---|
| `renderer/primitives.py` | Desenho em px: caixas de texto com entrelinha em pt, formas só com contorno, recorte *cover*, extensão de fundo e textura preta |
| `renderer/markup.py` | Marcação de ênfase |
| `renderer/brand.py` | Lê `brands/<id>/brand.json` (cores, fontes, estilos, geometria e limites) |
| `renderer/measure.py` | Estima a quebra de linha: usa a fonte instalada ou uma largura média por caractere |
| `renderer/layouts.py` | Os 6 layouts do padrão editorial |
| `renderer/plan.py` | Validação do plano: campos, limites, emoji, fotos existentes |
| `renderer/lint.py` | Confere o PPTX: tamanho, fontes, cores da paleta, formas sem preenchimento, entrelinha explícita e máximo de 2 famílias |
| `renderer/render.py` | CLI |

## Regras de importação no Canva

Resultado dos testes em `docs/spike-results/canva-import-fidelity.md`:

- slide de 1080×1350 px (9525 EMU por px);
- um bloco de texto por caixa;
- entrelinha sempre em pontos;
- negrito pelo flag;
- nomes Light e Medium funcionam; **SemiBold não**.

## Testes

```bash
python -m pytest -q
```
