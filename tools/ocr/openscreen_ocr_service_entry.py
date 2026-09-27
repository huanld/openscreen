from __future__ import annotations

import os

import uvicorn

from paddle_ocr_service import app


def main() -> None:
    host = os.getenv("OPENSCREEN_OCR_HOST", "127.0.0.1")
    port = int(os.getenv("OPENSCREEN_OCR_PORT", "8866"))
    uvicorn.run(app, host=host, port=port, log_level=os.getenv("OPENSCREEN_OCR_LOG_LEVEL", "warning"))


if __name__ == "__main__":
    main()
