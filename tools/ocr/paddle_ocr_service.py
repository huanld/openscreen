from __future__ import annotations

import base64
import importlib.util
import os
import sys
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="OpenScreen PaddleOCR service")

_engines: dict[str, Any] = {}
_engine_lock = Lock()


class OcrRequest(BaseModel):
    imageBase64: str | None = None
    path: str | None = None
    imagePath: str | None = None
    language: str | None = None


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "paddleocrInstalled": importlib.util.find_spec("paddleocr") is not None,
        "paddleInstalled": importlib.util.find_spec("paddle") is not None,
        "engineReady": bool(_engines),
        "defaultLanguage": os.getenv("PADDLEOCR_LANG", "latin"),
    }


@app.post("/ocr")
async def ocr(request: OcrRequest) -> dict[str, Any]:
    image_path, should_delete = _resolve_image_path(request)
    try:
        engine = _get_engine(request.language)
        blocks = await run_in_threadpool(_recognize_blocks, engine, image_path)
        return {"blocks": blocks}
    finally:
        if should_delete:
            Path(image_path).unlink(missing_ok=True)


def _resolve_image_path(request: OcrRequest) -> tuple[str, bool]:
    path_value = request.path or request.imagePath
    if path_value:
        path = Path(path_value)
        if not path.exists():
            raise HTTPException(status_code=400, detail=f"Image path does not exist: {path}")
        return str(path), False

    if not request.imageBase64:
        raise HTTPException(status_code=400, detail="Request must include imageBase64 or path.")

    try:
        image_bytes = base64.b64decode(request.imageBase64, validate=True)
    except Exception as error:
        raise HTTPException(status_code=400, detail="imageBase64 is invalid.") from error

    handle = tempfile.NamedTemporaryFile(prefix="openscreen-ocr-", suffix=".png", delete=False)
    try:
        handle.write(image_bytes)
    finally:
        handle.close()
    return handle.name, True


def _get_engine(language: str | None) -> Any:
    paddle_lang = _resolve_paddle_language(language)
    cache_key = f"{paddle_lang}|{os.getenv('PADDLEOCR_DEVICE', 'cpu')}"
    with _engine_lock:
        if cache_key not in _engines:
            _engines[cache_key] = _create_engine(paddle_lang)
        return _engines[cache_key]


def _create_engine(paddle_lang: str) -> Any:
    try:
        _patch_paddlex_frozen_ocr_extra_gate()
        from paddleocr import PaddleOCR
    except ImportError as error:
        raise HTTPException(
            status_code=503,
            detail=(
                "PaddleOCR is not installed. Run: "
                "python -m pip install -r tools/ocr/requirements.txt"
            ),
        ) from error

    device = os.getenv("PADDLEOCR_DEVICE", "cpu")
    ocr_version = os.getenv("PADDLEOCR_VERSION", "PP-OCRv5")

    modern_kwargs: dict[str, Any] = {
        "lang": paddle_lang,
        "ocr_version": ocr_version,
        "device": device,
        "enable_mkldnn": os.getenv("PADDLEOCR_ENABLE_MKLDNN", "0") == "1",
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
    }
    if os.getenv("PADDLEOCR_USE_MOBILE", "1") != "0":
        modern_kwargs.update(
            {
                "text_detection_model_name": "PP-OCRv5_mobile_det",
                "text_recognition_model_name": _mobile_recognition_model(paddle_lang),
            }
        )

    try:
        return PaddleOCR(**modern_kwargs)
    except TypeError:
        legacy_lang = "en" if paddle_lang == "latin" else paddle_lang
        return PaddleOCR(lang=legacy_lang, use_angle_cls=False, show_log=False)


def _patch_paddlex_frozen_ocr_extra_gate() -> None:
    if not getattr(sys, "frozen", False):
        return
    try:
        import paddlex.utils.deps as deps
    except Exception:
        return
    if getattr(deps, "_openscreen_ocr_extra_patch", False):
        return

    original_is_extra_available = deps.is_extra_available
    original_require_extra = deps.require_extra

    def is_extra_available(extra: str) -> bool:
        if extra in {"ocr", "ocr-core"}:
            return True
        return original_is_extra_available(extra)

    def require_extra(extra: str, *, obj_name: str | None = None, alt: str | None = None) -> None:
        if extra in {"ocr", "ocr-core"} or alt in {"ocr", "ocr-core"}:
            return
        original_require_extra(extra, obj_name=obj_name, alt=alt)

    deps.is_extra_available = is_extra_available
    deps.require_extra = require_extra
    deps._openscreen_ocr_extra_patch = True


def _resolve_paddle_language(language: str | None) -> str:
    explicit = os.getenv("PADDLEOCR_LANG")
    if explicit:
        return explicit

    language_value = (language or "vi,en").lower()
    if "vi" in language_value or "latin" in language_value:
        return "latin"
    if "en" in language_value:
        return "en"
    return language_value.split(",")[0].strip() or "latin"


def _mobile_recognition_model(paddle_lang: str) -> str:
    if paddle_lang == "en":
        return "en_PP-OCRv5_mobile_rec"
    if paddle_lang == "latin":
        return "latin_PP-OCRv5_mobile_rec"
    return "PP-OCRv5_mobile_rec"


def _recognize_blocks(engine: Any, image_path: str) -> list[dict[str, Any]]:
    if hasattr(engine, "predict"):
        result = engine.predict(image_path)
        blocks = _blocks_from_v3_result(result)
        if blocks:
            return blocks

    result = engine.ocr(image_path, cls=False)
    return _blocks_from_legacy_result(result)


def _blocks_from_v3_result(result: Any) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for item in _as_list(result):
        data = _result_to_dict(item)
        if not data:
            continue

        texts = _as_list(_first_present(data, ("rec_texts", "texts")))
        scores = _as_list(_first_present(data, ("rec_scores", "scores")))
        boxes = _as_list(_first_present(data, ("rec_boxes", "rec_polys", "dt_polys")))
        for index, text_value in enumerate(texts):
            text = str(text_value).strip()
            if not text:
                continue
            box = _box_to_rect(boxes[index] if index < len(boxes) else None)
            if not box:
                continue
            blocks.append(
                {
                    "text": text,
                    "confidence": _score_to_float(scores[index] if index < len(scores) else None),
                    "box": box,
                }
            )
    return blocks


def _first_present(data: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    return None


def _blocks_from_legacy_result(result: Any) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    _collect_legacy_blocks(result, blocks)
    return blocks


def _collect_legacy_blocks(value: Any, blocks: list[dict[str, Any]]) -> None:
    if not isinstance(value, (list, tuple)):
        return

    if len(value) >= 2 and _looks_like_box(value[0]):
        rec = value[1]
        if isinstance(rec, (list, tuple)) and rec:
            text = str(rec[0]).strip()
            if text:
                box = _box_to_rect(value[0])
                if box:
                    blocks.append(
                        {
                            "text": text,
                            "confidence": _score_to_float(rec[1] if len(rec) > 1 else None),
                            "box": box,
                        }
                    )
        return

    for item in value:
        _collect_legacy_blocks(item, blocks)


def _result_to_dict(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        data = item
    elif hasattr(item, "res") and isinstance(item.res, dict):
        data = item.res
    elif hasattr(item, "to_dict"):
        data = item.to_dict()
    elif hasattr(item, "json") and isinstance(item.json, dict):
        data = item.json
    elif hasattr(item, "__dict__"):
        data = dict(item.__dict__)
    else:
        return {}

    nested = data.get("res")
    return nested if isinstance(nested, dict) else data


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _looks_like_box(value: Any) -> bool:
    box = _as_list(value)
    if len(box) == 4 and all(_is_number(item) for item in box):
        return True
    return bool(box) and all(isinstance(point, (list, tuple)) for point in box)


def _box_to_rect(value: Any) -> dict[str, float] | None:
    if value is None:
        return None

    box = _as_list(value)
    if len(box) == 4 and all(_is_number(item) for item in box):
        left, top, right, bottom = [float(item) for item in box]
        return _rect(left, top, right, bottom)

    points = [_as_list(point) for point in box]
    coordinates = [
        (float(point[0]), float(point[1]))
        for point in points
        if len(point) >= 2 and _is_number(point[0]) and _is_number(point[1])
    ]
    if not coordinates:
        return None

    xs = [point[0] for point in coordinates]
    ys = [point[1] for point in coordinates]
    return _rect(min(xs), min(ys), max(xs), max(ys))


def _rect(left: float, top: float, right: float, bottom: float) -> dict[str, float] | None:
    width = max(0.0, right - left)
    height = max(0.0, bottom - top)
    if width == 0 or height == 0:
        return None
    return {"x": left, "y": top, "width": width, "height": height}


def _score_to_float(value: Any) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.5
    return max(0.0, min(1.0, score / 100 if score > 1 else score))


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)
