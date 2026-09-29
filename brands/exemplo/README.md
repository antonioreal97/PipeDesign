# Marca Exemplo: padrão visual do feed

Esta pasta é o template de uma marca. Para cada empresa nova, copie `brands/exemplo` para `brands/<slug>` e substitua os valores pelas medidas tiradas dos posts publicados da marca, guardados em `workspace/clients/<slug>/Modelos/Instagram`. O renderer segue estas regras em todo rascunho da marca, e elas vivem em [`brand.json`](brand.json), a fonte que o código lê.

## O que preencher em `brand.json`

| Campo | O que é | Como medir |
|---|---|---|
| `brand_id` | Slug da marca, igual ao nome da pasta e ao `slug` da tabela `brands` | Minúsculas, números e hífen |
| `colors` | Paleta nomeada; os layouts usam `branco`, `texto_escuro` e `fundo_texturizado` | Conta-gotas nos posts publicados |
| `fonts` | `display` (manchetes) e `sans` (apoio), mais fontes de campanha do Brand Kit | Nome exato no Canva; marque `status` como `A_CONFIRMAR` até confirmar |
| `logo` | Caminhos relativos a `workspace/clients/<slug>` | PNG sem fundo; o ícone aparece na tela de assinatura |
| `styles` | Tamanho, entrelinha, caixa e tracking de cada texto | Medidas em px no canvas 1080×1350 |
| `geometry` | Posição de cada bloco por layout | Medidas em px no canvas 1080×1350 |
| `limits` | Limites de linhas e caracteres que mantêm a proporção do feed | Contagem nos posts publicados |
| `voice` | Pilares, taglines e estilo de escrita | Legendas e artes publicadas |

## Duas fases do feed

| Fase | Como é | Uso no fluxo |
|---|---|---|
| **Lançamento/promoção** | Preto texturizado, Poppins Medium/Light, logo horizontal, título grande na fonte de campanha | Só em campanha promocional |
| **Editorial** | Foto sangrada + serif itálica em caixa alta + notas curtas em sans; telas pretas de manifesto; quase sem logo | **Padrão dos rascunhos** (layouts abaixo) |

## Layouts (canvas 1080×1350)

| Layout | Estrutura |
|---|---|
| `capa_manchete` | Foto sangrada. Kicker sans espaçado (34 px, tracking 18%) em y≈132. Manchete serif itálica em caixa alta (108/100 px), centralizada, até 2 linhas. Opcional: frase num retângulo arredondado **só com contorno** (640 px, raio 22) |
| `foto_nota` | Foto sangrada. Nota sans de 27/37 px (ou 32/42 px no tamanho `large`), com negrito ou palavra serif itálica, em 6 posições medidas (margem de 80 a 140 px). Opcional: frase serif em caixa alta abaixo |
| `manifesto_preto` | Preto texturizado. Bloco em x=227, centralizado na vertical. Título serif em caixa alta (66/72 px) e texto sans (27/38 px) com trechos sublinhados ou em negrito |
| `manifesto_frase` | Preto texturizado, com frase serif itálica centralizada (60/68 px) |
| `beneficio_duplo` | Duas fotos de 1080×675. Rótulo serif em caixa alta (58/64 px) com descrição sans (26/36 px). O bloco de cima fica à direita, rente à divisão; o de baixo, à esquerda, logo abaixo dela |
| `manifesto_assinatura` | Preto texturizado. Frases sans (34/44 px, com negrito) e tagline serif itálica, linha fina em y=1150 (x de 120 a 740) e ícone da marca no canto inferior direito |
| `moodboard_cena` | Colagem de cena, produto e detalhe com horário e texto curto abaixo da linha divisória |

Sequência típica de carrossel: capa → foto com nota → manifesto preto → foto com nota → benefícios → assinatura.

## Regras fixas

- **Cor do texto:** vem da foto. Área clara recebe texto preto; área escura, texto branco. Se o fundo sob o texto misturar claro e escuro, o render avisa, e o plano deve ajustar `focus`, `zoom`, `extend` ou `position`.
- **Fotos:** sempre sangradas.
  - Proibido: moldura, sombra, faixa opaca, degradê ou pílula preenchida.
  - Em foto de estúdio, `extend` estende o fundo liso para abrir espaço de texto ou afastar o modelo.
- **Tipografia:**
  - No máximo 2 famílias por tela: display e sans.
  - Display sempre em itálico. Caixa alta só em manchete, rótulo e frase de fechamento.
  - Sans em frase normal, com pontuação.
  - Ênfase: `**negrito**`, `*serif itálica*` e `__sublinhado__`.
- **Logo:** só o ícone, pequeno, na tela de assinatura. O logo horizontal fica para lançamentos e promoções.
- **Voz:**
  - Frases curtas e rítmicas e termos técnicos explicados de forma simples.
  - Sem emoji na arte.
  - Sem CTA de venda em carrossel editorial.

## Como gerar um rascunho

```bash
cd services/draft-renderer
python -m renderer.render ../../brands/exemplo/plans/exemplo-carrossel-caimento.json \
  --client-root ../../workspace/clients/exemplo \
  --out ../../workspace/drafts/exemplo/carrossel.pptx --preview
```

Veja o formato do plano em [`plans/exemplo-carrossel-caimento.json`](plans/exemplo-carrossel-caimento.json) e os detalhes em [`services/draft-renderer/README.md`](../../services/draft-renderer/README.md).
