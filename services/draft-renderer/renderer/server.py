"""Servidor HTTP mínimo para validar e renderizar Creative Plans no n8n."""
from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .brand import load_brand
from .lint import lint
from .plan import validate
from .render import render
from .stock import PexelsProvider, StockError

JOB_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
BRAND_ID = re.compile(r"^[a-z0-9_-]+$")
MAX_BODY = 4 * 1024 * 1024


class RequestError(Exception):
    def __init__(self, status: int, code: str, message: str, context: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.context = context or {}


@dataclass(frozen=True)
class RenderService:
    brands_dir: Path
    workspace_root: Path
    pexels_api_key: str = ""
    stock_cache_ttl_seconds: int = 86400

    def client_root(self, brand_id: str) -> Path:
        if not BRAND_ID.fullmatch(brand_id):
            raise RequestError(400, "BRAND_INVALID", "brand inválida")
        candidates = [brand_id.upper(), brand_id]
        for name in candidates:
            path = self.workspace_root / "clients" / name
            if path.is_dir():
                return path
        raise RequestError(404, "BRAND_NOT_FOUND", f"workspace da marca não encontrado: {brand_id}")

    def validate_plan(self, plan: Any) -> dict:
        if not isinstance(plan, dict):
            raise RequestError(400, "PLAN_INVALID", "plan deve ser objeto JSON")
        brand_id = plan.get("brand")
        if not isinstance(brand_id, str) or not brand_id:
            raise RequestError(400, "PLAN_INVALID", "plan.brand é obrigatório")
        brand = load_brand(self.brands_dir, brand_id, self.client_root(brand_id))
        report = validate(plan, brand)
        return {
            "ok": report.ok,
            "brand": brand.id,
            "errors": report.errors,
            "warnings": report.warnings,
        }

    def prepare_stock(self, payload: Any) -> dict:
        if not isinstance(payload, dict):
            raise RequestError(400, "STOCK_REQUEST_INVALID", "requisição de banco de imagens deve ser objeto")
        brand_id = payload.get("brand")
        if not isinstance(brand_id, str) or not brand_id:
            raise RequestError(400, "BRAND_INVALID", "brand é obrigatória")
        scenes = payload.get("scenes") or []
        if not isinstance(scenes, list):
            raise RequestError(400, "STOCK_REQUEST_INVALID", "scenes deve ser array")
        if not self.pexels_api_key:
            return {
                "ok": True,
                "enabled": False,
                "provider": "pexels",
                "candidates": [],
                "warnings": ["PEXELS_API_KEY não configurada; usando somente assets locais"],
            }
        palette = payload.get("palette") or []
        if not isinstance(palette, list):
            palette = []
        provider = PexelsProvider(
            self.pexels_api_key,
            cache_ttl_seconds=self.stock_cache_ttl_seconds,
        )
        try:
            candidates = provider.prepare(self.client_root(brand_id), scenes, [str(value) for value in palette])
        except StockError as exc:
            return {
                "ok": True,
                "enabled": True,
                "provider": "pexels",
                "candidates": [],
                "warnings": [str(exc) + "; usando somente assets locais"],
            }
        return {
            "ok": True,
            "enabled": True,
            "provider": "pexels",
            "provider_url": "https://www.pexels.com",
            "candidates": candidates,
            "warnings": [],
        }

    def render_plan(self, plan: Any, job_id: Any) -> dict:
        if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
            raise RequestError(400, "JOB_ID_INVALID", "job_id deve ser UUID")
        if not isinstance(plan, dict):
            raise RequestError(400, "PLAN_INVALID", "plan deve ser objeto JSON")
        if plan.get("job_id") != job_id:
            raise RequestError(400, "PLAN_JOB_MISMATCH", "plan.job_id difere do job_id")

        checked = self.validate_plan(plan)
        if not checked["ok"]:
            raise RequestError(422, "PLAN_INVALID", "Creative Plan recusado", checked)

        brand_id = plan["brand"]
        brand = load_brand(self.brands_dir, brand_id, self.client_root(brand_id))
        jobs_dir = self.workspace_root / "jobs"
        jobs_dir.mkdir(parents=True, exist_ok=True)
        final_pptx = jobs_dir / f"{job_id}.pptx"
        final_plan = jobs_dir / f"{job_id}.plan.json"
        final_credits = jobs_dir / f"{job_id}.credits.json"

        with tempfile.TemporaryDirectory(prefix=f"render-{job_id}-", dir=jobs_dir) as temp_name:
            temp = Path(temp_name)
            candidate = temp / "candidate.pptx"
            rendered, layout_warnings = render(plan, brand, candidate, temp / "cache")
            problems = lint(rendered, brand)
            if problems:
                raise RequestError(422, "RENDER_LINT_FAILED", "PPTX violou regras da marca", {"lint": problems})
            plan_temp = temp / "plan.json"
            plan_temp.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            credits_temp = temp / "credits.json"
            credits_temp.write_text(json.dumps({
                "notice": "Photos provided by Pexels",
                "provider_url": "https://www.pexels.com",
                "photos": plan.get("credits", []),
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            os.replace(rendered, final_pptx)
            os.replace(plan_temp, final_plan)
            os.replace(credits_temp, final_credits)

        return {
            "ok": True,
            "job_id": job_id,
            "slides": len(plan["slides"]),
            "pptx_path": str(final_pptx),
            "plan_path": str(final_plan),
            "credits_path": str(final_credits),
            "stock_images": len(plan.get("credits", [])),
            "warnings": checked["warnings"] + layout_warnings,
            "lint": [],
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "PipeDesignRenderer/1.0"

    @property
    def service(self) -> RenderService:
        return self.server.service  # type: ignore[attr-defined]

    def _write(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise RequestError(400, "REQUEST_INVALID", "Content-Length inválido") from exc
        if length <= 0 or length > MAX_BODY:
            raise RequestError(413 if length > MAX_BODY else 400, "REQUEST_INVALID", "corpo JSON ausente ou grande demais")
        try:
            value = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RequestError(400, "REQUEST_INVALID", "corpo não é JSON válido") from exc
        if not isinstance(value, dict):
            raise RequestError(400, "REQUEST_INVALID", "corpo deve ser objeto JSON")
        return value

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._write(200, {"ok": True, "service": "draft-renderer"})
        else:
            self._write(404, {"ok": False, "error": {"code": "NOT_FOUND", "message": "rota não encontrada"}})

    def do_POST(self) -> None:  # noqa: N802
        try:
            body = self._body()
            if self.path == "/validate":
                self._write(200, self.service.validate_plan(body.get("plan")))
                return
            if self.path == "/render":
                self._write(200, self.service.render_plan(body.get("plan"), body.get("job_id")))
                return
            if self.path == "/stock/prepare":
                self._write(200, self.service.prepare_stock(body))
                return
            raise RequestError(404, "NOT_FOUND", "rota não encontrada")
        except RequestError as exc:
            self._write(exc.status, {"ok": False, "error": {"code": exc.code, "message": exc.message, "context": exc.context}})
        except Exception as exc:  # erro inesperado deve subir de forma observável
            self._write(500, {"ok": False, "error": {"code": "RENDER_FAILED", "message": str(exc)}})

    def log_message(self, fmt: str, *args: Any) -> None:
        print("renderer-http:", fmt % args, flush=True)


def serve() -> None:
    host = os.getenv("RENDERER_HOST", "0.0.0.0")
    port = int(os.getenv("RENDERER_PORT", "8080"))
    service = RenderService(
        brands_dir=Path(os.getenv("BRANDS_DIR", "/brands")),
        workspace_root=Path(os.getenv("WORKSPACE_ROOT", "/workspace")),
        pexels_api_key=os.getenv("PEXELS_API_KEY", ""),
        stock_cache_ttl_seconds=int(os.getenv("STOCK_CACHE_TTL_SECONDS", "86400")),
    )
    server = ThreadingHTTPServer((host, port), Handler)
    server.service = service  # type: ignore[attr-defined]
    print(f"draft-renderer ready on {host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    serve()
