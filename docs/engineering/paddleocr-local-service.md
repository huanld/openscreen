# PaddleOCR Local Service

OpenScreen calls OCR through a local HTTP service. The default endpoint is:

```text
http://127.0.0.1:8866/ocr
```

The app sends either `imageBase64` or `path`, plus optional `language` and `profile`, and expects OCR blocks:

```json
{
  "blocks": [
    {
      "text": "Settings",
      "confidence": 0.97,
      "box": { "x": 120, "y": 80, "width": 90, "height": 24 }
    }
  ]
}
```

## Install

Use a separate virtual environment because PaddleOCR and PaddlePaddle are large dependencies.

```powershell
python -m venv .venv-ocr
.\.venv-ocr\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r tools\ocr\requirements.txt
```

If `paddle` is still missing after installing `paddleocr`, install the CPU PaddlePaddle wheel that matches your Python and OS from the official PaddlePaddle install guide.

## Run

```powershell
.\.venv-ocr\Scripts\Activate.ps1
$env:PADDLEOCR_DEVICE="cpu"
$env:OPENSCREEN_OCR_PROFILE="vietnamese"
npm run ocr:paddle
```

Keep this terminal open while using the Guide OCR step in OpenScreen.

## Verify

```powershell
Invoke-WebRequest http://127.0.0.1:8866/health -UseBasicParsing
```

Expected healthy environment:

```json
{
  "ok": true,
  "paddleocrInstalled": true,
  "paddleInstalled": true,
  "engineReady": false,
  "defaultLanguage": "vi,en",
  "defaultProfile": "vietnamese"
}
```

`engineReady` becomes `true` after the first OCR request. The first request can be slow because PaddleOCR downloads and loads models.

## Configuration

- `PADDLEOCR_DEVICE`: `cpu`, `gpu:0`, or another PaddleOCR device string.
- `OPENSCREEN_OCR_PROFILE`: `fast`, `vietnamese`, or `hybrid`. The default `vietnamese` profile upscales and sharpens focused UI screenshots before OCR.
- `OPENSCREEN_GUIDE_OCR_LANGUAGE`: defaults to `vi,en`.
- `PADDLEOCR_LANG`: optional hard override. Leave unset for the app profile/language settings to work.
- `PADDLEOCR_VERSION`: defaults to `PP-OCRv5`.
- `PADDLEOCR_USE_MOBILE`: defaults to `1`; set to `0` to use the default/server models.
- `PADDLEOCR_REC_MODEL`: optional recognizer model override. The bundled profile uses `latin_PP-OCRv5_mobile_rec`, which supports Vietnamese Latin-script text.
- `OPENSCREEN_GUIDE_OCR_URL`: OpenScreen OCR endpoint override; defaults to `http://127.0.0.1:8866`.
