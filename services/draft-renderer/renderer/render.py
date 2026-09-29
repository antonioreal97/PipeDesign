"""CLI: Creative Plan (JSON) -> PPTX editável para importar no Canva.

    python -m renderer.render plano.json --client-root workspace/clients/exemplo \
        --out workspace/drafts/exemplo/carrossel.pptx [--preview] [--strict]

Imprime um JSON com o resultado (para o n8n ler via Execute Command).
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from .brand import load_brand
from .layouts import LAYOUTS, Context
from .lint import lint
from .plan import validate
from .primitives import blank_slide, new_presentation

_MODULE_PATH = Path(__file__).resolve()
# In the repository this module is nested deeply enough for ``parents[3]`` to
# be the project root.  The container copies it to ``/app/renderer``, where
# only two parent directories exist.  Keep the CLI default useful in both
# layouts; the HTTP service passes explicit brand/client directories.
REPO = _MODULE_PATH.parents[3] if len(_MODULE_PATH.parents) > 3 else _MODULE_PATH.parents[1]


def render(plan: dict, brand, out: Path, work_dir: Path) -> tuple[Path, list[str]]:
    prs = new_presentation(brand.width, brand.height)
    ctx = Context(work_dir=work_dir)
    for n, spec in enumerate(plan["slides"], 1):
        ctx.slide_no = n
        slide = blank_slide(prs)
        LAYOUTS[spec["layout"]](slide, brand, spec, ctx)
    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))
    return out, ctx.warnings


def preview(pptx: Path, out_dir: Path) -> list[str]:
    """PNG por slide via LibreOffice + pdftoppm (só para conferência local)."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice or not shutil.which("pdftoppm"):
        return []
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", str(out_dir), str(pptx)],
                   check=True, capture_output=True, timeout=180)
    pdf = out_dir / (pptx.stem + ".pdf")
    prefix = out_dir / pptx.stem
    subprocess.run(["pdftoppm", "-png", "-r", "48", str(pdf), str(prefix)], check=True, timeout=180)
    return sorted(str(p) for p in out_dir.glob(pptx.stem + "-*.png"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("plan", type=Path)
    ap.add_argument("--client-root", type=Path, required=True, help="pasta do cliente (fotos/logos)")
    ap.add_argument("--brands-dir", type=Path, default=REPO / "brands")
    ap.add_argument("--brand", help="id da marca (padrão: campo 'brand' do plano)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--work-dir", type=Path, help="cache de fotos reduzidas e texturas")
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--strict", action="store_true", help="avisos de padrão também bloqueiam")
    a = ap.parse_args(argv)

    plan = json.loads(a.plan.read_text(encoding="utf-8"))
    brand = load_brand(a.brands_dir, a.brand or plan.get("brand"), a.client_root)
    rep = validate(plan, brand)
    result = {"ok": False, "brand": brand.id, "errors": rep.errors, "warnings": rep.warnings}
    if not rep.ok or (a.strict and rep.warnings):
        result["stage"] = "plan_validation"
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2

    work = a.work_dir or a.out.parent / ".render-cache"
    out, layout_warnings = render(plan, brand, a.out, work)
    problems = lint(out, brand)
    result["warnings"] = rep.warnings + layout_warnings
    result.update(ok=not problems, file=str(out), slides=len(plan["slides"]), lint=problems)
    if a.preview:
        result["preview"] = preview(out, work / "preview")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if problems:
        return 3
    return 4 if a.strict and layout_warnings else 0


if __name__ == "__main__":
    sys.exit(main())
