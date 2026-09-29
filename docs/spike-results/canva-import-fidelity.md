# Teste de conversão: arquivo gerado → design editável no Canva

**Data:** 17/09/2026
**Conta:** Canva Pro (antonioreal97@gmail.com), integração "PipeDesign Local" (Public, rascunho)
**Objetivo:** encontrar um caminho sem Canva Enterprise (sem Autofill) para entregar rascunhos editáveis.
**Como:** workflow `SPIKE - Canva Autofill E2E` com `SPIKE_MODE=import` → `POST /v1/imports` → polling de `GET /v1/imports/{id}`. A estrutura de cada design foi lida depois pelo conector do Canva.

## Resultado principal

**A importação de designs funciona na conta Pro.** Os 5 arquivos viraram designs editáveis. Não houve erro de permissão e cada importação levou 2 a 5 segundos.

**O formato vencedor é PPTX, com negrito e entrelinha em pontos (variante C2 + entrelinha de C3).**

## Arquivos testados

Post 1080×1350 com:
- foto de fundo;
- faixa escura semitransparente;
- marca (círculo + texto);
- headline de 2 linhas em Playfair Display;
- subheadline em Montserrat;
- botão (pílula + texto).

| Arquivo | Gerado com | Tamanho no Canva | Separação dos elementos | Fontes | Entrelinha | Veredito |
|---|---|---|---|---|---|---|
| A · `teste-A-chromium.pdf` | HTML/CSS → Chromium | 1080×**1351** | ⚠️ Headline e subheadline **fundidas numa só caixa**; faixa escura e pílula **fundidas num só elemento**; texto do CTA solto e alinhado à esquerda | ✅ Playfair / Montserrat, semibold preservado | ❌ 1,625 (original ≈1,05) → texto empurrado, subheadline sobre o botão | Não usar |
| B · `teste-B-reportlab.pdf` | ReportLab (1 pt = 1 px) | **1440×1800** (o Canva lê 1 pt = 1,333 px) | ❌ Mesma fusão de textos; faixa e círculo viraram **imagens** (sem troca de cor) | ✅ | ❌ 1,714 | Não usar |
| C · `teste-C-powerpoint.pptx` | python-pptx | ✅ 1080×1350 exato | ✅ Cada elemento separado, nas posições exatas; CTA como texto centralizado dentro de forma | ⚠️ Família correta, mas **SemiBold virou Regular** | ⚠️ 1,2 (padrão) → headline encosta na subheadline | Bom, com ajustes |
| C2 · `teste-C2-pptx-negrito-90.pptx` | python-pptx, família base + negrito, entrelinha 90% | ✅ 1080×1350 | ✅ igual a C | ✅ **Bold** preservado (Playfair Bold / Montserrat Bold) | ✅ 1,08 | **Melhor visual** |
| C3 · `teste-C3-pptx-semibold-exato.pptx` | python-pptx, família "… SemiBold", entrelinha exata em pt | ✅ 1080×1350 | ✅ igual a C | ❌ SemiBold virou Regular | ✅ **exata** (1,054 = 118 px / 112 px) | Entrelinha ideal |

Em todos os formatos:
- **Foto:** entrou como preenchimento de imagem substituível (`isMediaReplaceable: true`).
- **Cores:** foram mantidas.
- **Textos:** continuaram editáveis.

### Designs criados no Canva (IDs)

| Arquivo | Design |
|---|---|
| A | `DAHVdA-s4rs` |
| B | `DAHVdE9ItIg` |
| C | `DAHVdMfHxkk` |
| C2 | `DAHVdMAMBkA` |
| C3 | `DAHVdGGDd2E` |

Os títulos começam com "IMPORT TESTE". Podem ser apagados.

## Conclusões para o renderer

1. **Gerar PPTX, não PDF.** O PDF perde a separação entre blocos de texto e a entrelinha, e isso quebra o layout. O PPTX preserva cada caixa, a posição e o tamanho.
2. **Dimensão:** slide de 1080×1350 px, a 9.525 EMU por px.
3. **Peso da fonte:** usar o nome base da família (`Playfair Display`, `Montserrat`) e o flag de negrito. O Canva só reconheceu *Regular* e *Bold*; *SemiBold* pelo nome não funcionou.
   - **A testar com o kit real:** se a marca usar SemiBold, Medium ou fonte própria, ver se o envio da fonte ao Brand Kit resolve.
4. **Entrelinha:** sempre explícita e em pontos (`a:spcPts` = px × 0,75 × 100). O valor padrão vira 1,2 no Canva.
5. **Botões:** texto dentro de forma (ou caixa de texto sobre forma) funciona e mantém o centro.
6. **Transparência:** a faixa escura aparece semitransparente nas miniaturas, mas a API informa opacidade 1. Conferir no editor.

## Próximo teste (com kit real de cliente)

- Fontes da marca: instaladas no Canva? Precisam ir ao Brand Kit? Quais pesos sobrevivem?
- Logo em SVG/PNG → continua vetor ou vira imagem?
- Cores oficiais e layout de um post aprovado da marca.
- Carrossel com várias páginas: um PPTX com N slides → um design com N páginas.

## Rodada 4 — v2 pelo workflow n8n (17/09/2026, execução 20)

Modo `import` acionado por override no node A2 (`mode: 'import'`, `import_glob: '/workspace/spike/import-v2/*.pptx'`); override revertido depois da execução.

- Resultado do bloco M: `status: success`, 2 arquivos, 0 falhas, 1 tentativa de polling (~5 s de ponta a ponta).
- `carrossel-v2.pptx` → design com 7 páginas.
- `sonda-fontes-v2.pptx` → design com 1 página.

### Sonda de fontes (13 candidatas)

Fontes com `fontRef` próprio (reconhecidas pelo Canva na conta antonioreal97):

| Fonte | fontRef |
| --- | --- |
| DM Serif Display (itálico) | YAD1aYG82rc |
| Playfair Display (itálico) | YAFdJhem5V8 |
| Instrument Serif (itálico) | YAHFeOnZNEk |
| Cormorant Garamond (itálico) | YAFdJhX-538 |
| DM Sans | YAD1aU3sLnI |
| Inter | YAFdJvSyp_k |

Caíram no padrão da conta (`YACgEZ1cb1Q`, ou seja, **não reconhecidas**): Bodoni Moda, Gloock, Libre Caslon Display, Figtree, Figtree Light, Manrope, Plus Jakarta Sans.

Consequência: **Figtree (candidata a sans do padrão da marca) não sobrevive ao import.** Substitutas reconhecidas: DM Sans ou Inter. A serif candidata (DM Serif Display Italic) passa.

### Carrossel v2 (páginas 1–3 conferidas)

- Fotos entram como fill substituível (`isMediaReplaceable: true`), com o recorte/extensão do fundo preservado (ex.: `look-01-ext-l25-r25-t55.jpg`).
- Página 1 (capa_manchete): manchete em DM Serif Display itálico, 108 px, entrelinha 0.93; kicker e sublinha na fonte padrão (Figtree perdida); contorno arredondado 1.5 px sem preenchimento — de acordo com o padrão do feed.
- Página 2 (foto_nota): negrito parcial preservado dentro do mesmo bloco de texto.
- Página 3 (manifesto_preto): título itálico + corpo OK; há um trecho sublinhado ("amplitude dos movimentos") a conferir se é intencional no plano.
