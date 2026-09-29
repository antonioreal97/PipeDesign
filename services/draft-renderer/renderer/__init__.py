"""draft-renderer: transforma um Creative Plan (JSON) em PPTX importável pelo Canva.

Regras de compatibilidade com a importação do Canva (docs/spike-results/canva-import-fidelity.md):
- slide 1080x1350 px (9525 EMU por px);
- cada bloco de texto na sua própria caixa;
- entrelinha sempre explícita em pontos;
- peso por flag de negrito (Regular/Bold) ou nome Light/Medium; nunca "SemiBold" no nome.
"""
__version__ = "0.1.0"
