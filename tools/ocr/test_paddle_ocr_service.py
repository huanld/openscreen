from __future__ import annotations

import os
import unittest
from typing import Any
from unittest.mock import patch

from paddle_ocr_service import (
    _engines,
    _get_engine,
    _mobile_recognition_model,
    _recognize_blocks,
    _resolve_ocr_profile,
)


class PredictEngine:
    def __init__(self, result: Any) -> None:
        self.result = result
        self.legacy_called = False

    def predict(self, _image_path: str) -> Any:
        return self.result

    def ocr(self, _image_path: str, *, cls: bool) -> Any:
        self.legacy_called = True
        raise AssertionError(f"legacy OCR must not run for PaddleOCR 3 (cls={cls})")


class LegacyEngine:
    def ocr(self, _image_path: str, *, cls: bool) -> Any:
        self.asserted_cls = cls
        return [[[[0, 0], [30, 0], [30, 10], [0, 10]], ["OpenScreen", 0.91]]]


class RecognizeBlocksTests(unittest.TestCase):
    def test_empty_predict_result_remains_a_valid_empty_result(self) -> None:
        engine = PredictEngine([])

        self.assertEqual(_recognize_blocks(engine, "blank.png"), [])
        self.assertFalse(engine.legacy_called)

    def test_predict_result_keeps_text_confidence_and_box(self) -> None:
        engine = PredictEngine(
            [
                {
                    "rec_texts": ["Xin chào"],
                    "rec_scores": [0.97],
                    "rec_boxes": [[10, 20, 110, 50]],
                }
            ]
        )

        self.assertEqual(
            _recognize_blocks(engine, "text.png"),
            [
                {
                    "text": "Xin chào",
                    "confidence": 0.97,
                    "box": {"x": 10.0, "y": 20.0, "width": 100.0, "height": 30.0},
                }
            ],
        )
        self.assertFalse(engine.legacy_called)

    def test_legacy_engine_still_uses_legacy_parser(self) -> None:
        engine = LegacyEngine()

        self.assertEqual(_recognize_blocks(engine, "legacy.png")[0]["text"], "OpenScreen")
        self.assertFalse(engine.asserted_cls)


class OcrProfileTests(unittest.TestCase):
    def test_request_profile_takes_precedence_over_process_default(self) -> None:
        with patch.dict(os.environ, {"OPENSCREEN_OCR_PROFILE": "vietnamese"}, clear=False):
            self.assertEqual(_resolve_ocr_profile("hybrid"), "hybrid")
            self.assertEqual(_resolve_ocr_profile(None), "vietnamese")

    def test_vietnamese_uses_v3_recognizer_and_general_latin_uses_v5(self) -> None:
        self.assertEqual(_mobile_recognition_model("vi"), "latin_PP-OCRv3_mobile_rec")
        self.assertEqual(_mobile_recognition_model("latin"), "latin_PP-OCRv5_mobile_rec")

    def test_engine_cache_separates_recognition_models(self) -> None:
        _engines.clear()
        created: list[str] = []

        def create_engine(language: str) -> object:
            created.append(language)
            return object()

        with patch("paddle_ocr_service._create_engine", side_effect=create_engine):
            with patch.dict(
                os.environ,
                {"PADDLEOCR_DEVICE": "cpu", "PADDLEOCR_REC_MODEL": "model-a"},
                clear=False,
            ):
                first = _get_engine("vi")
                self.assertIs(first, _get_engine("vi"))
            with patch.dict(
                os.environ,
                {"PADDLEOCR_DEVICE": "cpu", "PADDLEOCR_REC_MODEL": "model-b"},
                clear=False,
            ):
                second = _get_engine("vi")

        self.assertIsNot(first, second)
        self.assertEqual(created, ["vi", "vi"])
        _engines.clear()


if __name__ == "__main__":
    unittest.main()
