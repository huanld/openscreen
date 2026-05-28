from __future__ import annotations

import base64
import importlib.util
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from threading import Lock, Thread
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

app = FastAPI(title="OpenScreen PaddleOCR service")

_engines: dict[str, Any] = {}
_engine_lock = Lock()
_warmup_lock = Lock()
_warmup_started = False
_LATIN_RECOGNITION_LANGS = {
    "af",
    "az",
    "bs",
    "ca",
    "cs",
    "cy",
    "da",
    "de",
    "en",
    "es",
    "et",
    "eu",
    "fi",
    "fr",
    "ga",
    "gl",
    "hr",
    "hu",
    "id",
    "is",
    "it",
    "ku",
    "la",
    "latin",
    "lb",
    "lt",
    "lv",
    "mi",
    "ms",
    "mt",
    "nl",
    "no",
    "oc",
    "pi",
    "pl",
    "pt",
    "qu",
    "rm",
    "ro",
    "rs_latin",
    "rslatin",
    "sk",
    "sl",
    "sq",
    "sv",
    "sw",
    "tl",
    "tr",
    "uz",
    "vi",
}


@dataclass(frozen=True)
class PreparedImage:
    path: str
    scale: float = 1.0
    should_delete: bool = False


class OcrRequest(BaseModel):
    imageBase64: str | None = None
    path: str | None = None
    imagePath: str | None = None
    language: str | None = None
    profile: str | None = None


@app.on_event("startup")
def start_ocr_warmup() -> None:
    if os.getenv("OPENSCREEN_OCR_WARMUP", "0") != "1":
        return

    global _warmup_started
    with _warmup_lock:
        if _warmup_started:
            return
        _warmup_started = True

    Thread(target=_warmup_default_engines, name="openscreen-ocr-warmup", daemon=True).start()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "paddleocrInstalled": importlib.util.find_spec("paddleocr") is not None,
        "paddleInstalled": importlib.util.find_spec("paddle") is not None,
        "engineReady": bool(_engines),
        "defaultLanguage": os.getenv("PADDLEOCR_LANG") or "vi,en",
        "defaultProfile": os.getenv("OPENSCREEN_OCR_PROFILE") or "vietnamese",
        "loadedEngines": sorted(_engines.keys()),
    }


def _warmup_default_engines() -> None:
    try:
        profile = _resolve_ocr_profile(None)
        for paddle_lang in _resolve_paddle_languages(None, profile):
            _get_engine(paddle_lang)
    except Exception as error:
        print(f"OpenScreen OCR warmup failed: {error}", file=sys.stderr, flush=True)


@app.post("/ocr")
async def ocr(request: OcrRequest) -> dict[str, Any]:
    image_path, should_delete = _resolve_image_path(request)
    try:
        blocks = await run_in_threadpool(
            _recognize_profile_blocks,
            image_path,
            request.language,
            request.profile,
        )
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


def _get_engine(paddle_lang: str) -> Any:
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
        "use_textline_orientation": os.getenv("PADDLEOCR_USE_TEXTLINE_ORIENTATION", "0") == "1",
    }
    if os.getenv("PADDLEOCR_USE_MOBILE", "1") != "0":
        modern_kwargs.update(
            {
                "text_detection_model_name": os.getenv(
                    "PADDLEOCR_DET_MODEL",
                    "PP-OCRv5_mobile_det",
                ),
                "text_recognition_model_name": os.getenv("PADDLEOCR_REC_MODEL")
                or _mobile_recognition_model(paddle_lang),
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


def _recognize_profile_blocks(
    image_path: str,
    language: str | None,
    profile: str | None,
) -> list[dict[str, Any]]:
    ocr_profile = _resolve_ocr_profile(profile)
    languages = _resolve_paddle_languages(language, ocr_profile)
    prepared = _prepare_image_for_profile(image_path, ocr_profile)
    try:
        blocks: list[dict[str, Any]] = []
        for paddle_lang in languages:
            engine = _get_engine(paddle_lang)
            recognized = _recognize_blocks(engine, prepared.path)
            blocks.extend(_scale_blocks(recognized, prepared.scale))
        return _merge_blocks(blocks)
    finally:
        if prepared.should_delete:
            Path(prepared.path).unlink(missing_ok=True)


def _resolve_ocr_profile(profile: str | None) -> str:
    explicit = (os.getenv("OPENSCREEN_OCR_PROFILE") or "").strip().lower()
    value = explicit or (profile or "").strip().lower()
    if value in {"fast", "vietnamese", "hybrid"}:
        return value
    return "vietnamese"


def _resolve_paddle_languages(language: str | None, profile: str) -> list[str]:
    explicit = (os.getenv("PADDLEOCR_LANG") or "").strip().lower()
    if explicit:
        return [explicit]

    language_value = (language or "vi,en").lower()
    has_vietnamese = "vi" in _split_language_tags(language_value)
    if profile == "fast":
        return [_resolve_primary_paddle_language(language_value, prefer_vietnamese=False)]
    if profile == "hybrid":
        languages = ["vi"] if has_vietnamese else []
        languages.append("latin")
        return _dedupe_languages(languages)
    return [_resolve_primary_paddle_language(language_value, prefer_vietnamese=True)]


def _split_language_tags(language: str) -> set[str]:
    return {part.strip().lower() for part in language.split(",") if part.strip()}


def _dedupe_languages(languages: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for language in languages:
        if language not in seen:
            seen.add(language)
            result.append(language)
    return result


def _resolve_primary_paddle_language(language_value: str, *, prefer_vietnamese: bool) -> str:
    tags = _split_language_tags(language_value)
    if prefer_vietnamese and "vi" in tags:
        return "vi"
    if "latin" in tags or "vi" in tags or "en" in tags:
        return "latin"
    for tag in tags:
        return tag
    return "latin"


def _prepare_image_for_profile(image_path: str, profile: str) -> PreparedImage:
    if profile == "fast":
        return PreparedImage(image_path)

    try:
        from PIL import Image, ImageEnhance, ImageOps
    except Exception:
        return PreparedImage(image_path)

    try:
        with Image.open(image_path) as source:
            image = source.convert("RGB")
    except Exception:
        return PreparedImage(image_path)

    scale = _resolve_enhancement_scale(image.width, image.height)
    if scale <= 1:
        return PreparedImage(image_path)

    resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
    enhanced = image.resize((round(image.width * scale), round(image.height * scale)), resampling)
    enhanced = ImageOps.autocontrast(enhanced)
    enhanced = ImageEnhance.Contrast(enhanced).enhance(1.25)
    enhanced = ImageEnhance.Sharpness(enhanced).enhance(1.35)

    handle = tempfile.NamedTemporaryFile(prefix="openscreen-ocr-enhanced-", suffix=".png", delete=False)
    try:
        handle.close()
        enhanced.save(handle.name, format="PNG")
        return PreparedImage(handle.name, scale=scale, should_delete=True)
    except Exception:
        Path(handle.name).unlink(missing_ok=True)
        return PreparedImage(image_path)


def _resolve_enhancement_scale(width: int, height: int) -> float:
    try:
        requested_scale = float(os.getenv("OPENSCREEN_OCR_ENHANCE_SCALE", "2"))
    except ValueError:
        requested_scale = 2.0
    scale = max(1.0, min(3.0, requested_scale))
    try:
        max_side = int(os.getenv("OPENSCREEN_OCR_ENHANCE_MAX_SIDE", "2400"))
    except ValueError:
        max_side = 2400
    largest_side = max(width, height)
    if largest_side <= 0:
        return 1.0
    return max(1.0, min(scale, max_side / largest_side))


def _scale_blocks(blocks: list[dict[str, Any]], scale: float) -> list[dict[str, Any]]:
    if scale <= 1:
        return blocks

    scaled_blocks: list[dict[str, Any]] = []
    for block in blocks:
        box = block.get("box")
        if not isinstance(box, dict) or not _box_uses_pixels(box):
            scaled_blocks.append(block)
            continue
        scaled_box = {
            "x": float(box["x"]) / scale,
            "y": float(box["y"]) / scale,
            "width": float(box["width"]) / scale,
            "height": float(box["height"]) / scale,
        }
        scaled_blocks.append({**block, "box": scaled_box})
    return scaled_blocks


def _box_uses_pixels(box: dict[str, Any]) -> bool:
    try:
        x = float(box["x"])
        y = float(box["y"])
        width = float(box["width"])
        height = float(box["height"])
    except (KeyError, TypeError, ValueError):
        return False
    return x > 1 or y > 1 or width > 1 or height > 1 or x + width > 1 or y + height > 1


def _merge_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for block in sorted(blocks, key=_block_quality, reverse=True):
        box = block.get("box")
        if not isinstance(box, dict):
            continue
        overlapping_index = next(
            (
                index
                for index, existing in enumerate(merged)
                if _box_iou(box, existing.get("box")) >= 0.62
            ),
            None,
        )
        if overlapping_index is None:
            merged.append(block)
            continue
        if _block_quality(block) > _block_quality(merged[overlapping_index]):
            merged[overlapping_index] = block
    return sorted(merged, key=lambda block: _box_sort_key(block.get("box")))


def _block_quality(block: dict[str, Any]) -> float:
    text = str(block.get("text") or "")
    score = _score_to_float(block.get("confidence"))
    if _has_vietnamese_diacritics(text):
        score += 0.08
    if len(text) >= 2:
        score += min(0.04, len(text) * 0.002)
    return score


def _has_vietnamese_diacritics(text: str) -> bool:
    return any(
        character
        in "ăâđêôơưĂÂĐÊÔƠƯáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ"
        for character in text
    )


def _box_iou(left: Any, right: Any) -> float:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return 0.0
    try:
        left_x = float(left["x"])
        left_y = float(left["y"])
        left_width = float(left["width"])
        left_height = float(left["height"])
        right_x = float(right["x"])
        right_y = float(right["y"])
        right_width = float(right["width"])
        right_height = float(right["height"])
    except (KeyError, TypeError, ValueError):
        return 0.0

    intersection_left = max(left_x, right_x)
    intersection_top = max(left_y, right_y)
    intersection_right = min(left_x + left_width, right_x + right_width)
    intersection_bottom = min(left_y + left_height, right_y + right_height)
    intersection_width = max(0.0, intersection_right - intersection_left)
    intersection_height = max(0.0, intersection_bottom - intersection_top)
    intersection_area = intersection_width * intersection_height
    if intersection_area <= 0:
        return 0.0
    union_area = left_width * left_height + right_width * right_height - intersection_area
    return intersection_area / union_area if union_area > 0 else 0.0


def _box_sort_key(box: Any) -> tuple[float, float]:
    if not isinstance(box, dict):
        return (0.0, 0.0)
    try:
        return (float(box["y"]), float(box["x"]))
    except (KeyError, TypeError, ValueError):
        return (0.0, 0.0)


def _mobile_recognition_model(paddle_lang: str) -> str:
    if paddle_lang in _LATIN_RECOGNITION_LANGS:
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
