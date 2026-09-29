from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from PIL import Image

from renderer.server import RenderService, RequestError
from test_renderer import BRANDS, plan_all_layouts


@pytest.fixture()
def service_workspace(tmp_path: Path) -> tuple[RenderService, Path]:
    client = tmp_path / "clients/exemplo"
    photos = client / "Fotos"
    photos.mkdir(parents=True)
    Image.new("RGB", (600, 750), (205, 205, 205)).save(photos / "a.jpg")
    Image.new("RGB", (600, 750), (40, 40, 40)).save(photos / "b.jpg")
    logos = client / "Logos"
    logos.mkdir(parents=True)
    Image.new("RGBA", (100, 100), (255, 255, 255, 255)).save(logos / "ICONE BRANCO SEM FUNDO.png")
    return RenderService(BRANDS, tmp_path), tmp_path


def test_validate_endpoint_logic(service_workspace):
    service, _ = service_workspace
    result = service.validate_plan(plan_all_layouts())
    assert result["ok"] is True
    assert result["errors"] == []


def test_stock_sem_chave_preserva_fallback_local(service_workspace):
    service, _ = service_workspace
    result = service.prepare_stock({"brand": "exemplo", "scenes": [{"slide": 2, "query": "office"}]})
    assert result["ok"] is True
    assert result["enabled"] is False
    assert result["candidates"] == []
    assert "PEXELS_API_KEY" in result["warnings"][0]


def test_render_writes_plan_and_pptx(service_workspace):
    service, workspace = service_workspace
    job_id = "c0a80100-0000-4000-8000-000000000005"
    plan = plan_all_layouts()
    plan["job_id"] = job_id
    plan["title"] = "Teste exemplo"
    result = service.render_plan(plan, job_id)
    assert result["ok"] is True
    assert Path(result["pptx_path"]).is_file()
    assert Path(result["plan_path"]).is_file()
    assert json.loads(Path(result["plan_path"]).read_text())["job_id"] == job_id
    assert Path(result["credits_path"]).is_file()
    assert json.loads(Path(result["credits_path"]).read_text())["photos"] == []
    assert Path(result["pptx_path"]).parent == workspace / "jobs"


def test_render_rejects_job_mismatch(service_workspace):
    service, _ = service_workspace
    plan = copy.deepcopy(plan_all_layouts())
    plan["job_id"] = "c0a80100-0000-4000-8000-000000000005"
    with pytest.raises(RequestError, match="difere") as caught:
        service.render_plan(plan, "c0a80100-0000-4000-8000-000000000006")
    assert caught.value.code == "PLAN_JOB_MISMATCH"
