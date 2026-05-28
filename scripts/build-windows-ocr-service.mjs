import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OCR_DIR = path.join(ROOT, "tools", "ocr");
const VENV_DIR = path.join(ROOT, ".venv-ocr-build");
const VENV_PYTHON = path.join(VENV_DIR, "Scripts", "python.exe");
const DIST_DIR = path.join(OCR_DIR, "dist");
const WORK_DIR = path.join(OCR_DIR, "build");
const MODEL_CACHE_DIR = path.join(OCR_DIR, "models", "paddlex");
const ENTRYPOINT = path.join(OCR_DIR, "openscreen_ocr_service_entry.py");
const OUTPUT_DIR = path.join(DIST_DIR, "openscreen-ocr-service");
const OUTPUT_EXE = path.join(OUTPUT_DIR, "openscreen-ocr-service.exe");
const REQUIRED_MODEL_NAMES = ["PP-OCRv5_mobile_det", "latin_PP-OCRv5_mobile_rec"];

if (process.platform !== "win32") {
	console.log("Skipping Windows OCR service build on non-Windows host.");
	process.exit(0);
}

function run(command, args, options = {}) {
	console.log(`> ${command} ${args.join(" ")}`);
	execFileSync(command, args, {
		cwd: ROOT,
		stdio: "inherit",
		...options,
	});
}

function ensureVenv() {
	if (fs.existsSync(VENV_PYTHON)) {
		return;
	}
	run(process.env.PYTHON ?? "python", ["-m", "venv", VENV_DIR]);
}

function installDependencies() {
	run(VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "pip"]);
	run(VENV_PYTHON, ["-m", "pip", "install", "-r", path.join(OCR_DIR, "requirements.txt")]);
	run(VENV_PYTHON, ["-m", "pip", "install", "pyinstaller>=6.0"]);
}

function prepareModelCache() {
	const officialModelsDir = path.join(MODEL_CACHE_DIR, "official_models");
	const hasRequiredModels = REQUIRED_MODEL_NAMES.every((modelName) =>
		fs.existsSync(path.join(officialModelsDir, modelName)),
	);
	if (hasRequiredModels) {
		return;
	}

	fs.mkdirSync(officialModelsDir, { recursive: true });
	run(
		VENV_PYTHON,
		[
			"-c",
			[
				"import sys",
				`sys.path.insert(0, ${JSON.stringify(OCR_DIR)})`,
				"from paddle_ocr_service import _create_engine",
				"_create_engine('latin')",
			].join("; "),
		],
		{
			env: {
				...process.env,
				PADDLE_PDX_CACHE_HOME: MODEL_CACHE_DIR,
				PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
				PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT: "False",
				PADDLEOCR_DEVICE: "cpu",
				PADDLEOCR_ENABLE_MKLDNN: "0",
				PADDLEOCR_LANG: "latin",
				PADDLEOCR_USE_MOBILE: "1",
				PYTHONUTF8: "1",
			},
		},
	);
}

function buildService() {
	fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
	fs.mkdirSync(DIST_DIR, { recursive: true });
	fs.mkdirSync(WORK_DIR, { recursive: true });
	run(VENV_PYTHON, [
		"-m",
		"PyInstaller",
		"--noconfirm",
		"--clean",
		"--onedir",
		"--name",
		"openscreen-ocr-service",
		"--distpath",
		DIST_DIR,
		"--workpath",
		WORK_DIR,
		"--specpath",
		WORK_DIR,
		"--paths",
		OCR_DIR,
		"--collect-all",
		"paddleocr",
		"--collect-all",
		"paddle",
		"--collect-all",
		"paddlex",
		"--collect-all",
		"cv2",
		"--collect-all",
		"shapely",
		"--collect-all",
		"pyclipper",
		"--collect-all",
		"pypdfium2",
		"--collect-all",
		"bidi",
		"--copy-metadata",
		"paddleocr",
		"--copy-metadata",
		"paddlex",
		"--copy-metadata",
		"paddlepaddle",
		"--copy-metadata",
		"opencv-contrib-python",
		"--copy-metadata",
		"shapely",
		"--copy-metadata",
		"pyclipper",
		"--copy-metadata",
		"pypdfium2",
		"--copy-metadata",
		"python-bidi",
		"--hidden-import",
		"uvicorn.logging",
		"--hidden-import",
		"uvicorn.loops",
		"--hidden-import",
		"uvicorn.loops.auto",
		"--hidden-import",
		"uvicorn.protocols",
		"--hidden-import",
		"uvicorn.protocols.http",
		"--hidden-import",
		"uvicorn.protocols.http.auto",
		"--hidden-import",
		"uvicorn.lifespan",
		"--hidden-import",
		"uvicorn.lifespan.on",
		ENTRYPOINT,
	]);

	if (!fs.existsSync(OUTPUT_EXE)) {
		throw new Error(`OCR service build did not produce ${OUTPUT_EXE}`);
	}
	console.log(`Built OCR service: ${OUTPUT_EXE}`);
}

ensureVenv();
installDependencies();
prepareModelCache();
buildService();
