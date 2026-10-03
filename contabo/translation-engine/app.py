from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Sequence

import ctranslate2
from transformers import AutoTokenizer

from quality import normalize_target_candidates, translate_structured_lines

MODEL_ID = "google/madlad400-3b-mt"
MODEL_REVISION = "fa184c675da0b5c9e1c8694fccd4e12e2d422094"
DEFAULT_MODEL_PATH = "/models/madlad400-3b-mt-ct2"
DEFAULT_PORT = 8792
MAX_REQUEST_BYTES = 4 * 1024 * 1024
MAX_INPUT_TOKENS = 480
MAX_DECODING_LENGTH = 512


class EngineError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = HTTPStatus.UNPROCESSABLE_ENTITY):
        super().__init__(message)
        self.code = code
        self.status = int(status)


def _required_token() -> str:
    token = os.environ.get("ASTERA_TRANSLATION_INTERNAL_TOKEN", "").strip()
    if len(token) < 24:
        raise RuntimeError("ASTERA_TRANSLATION_INTERNAL_TOKEN must be configured with at least 24 characters")
    return token


def _model_path() -> Path:
    return Path(os.environ.get("ASTERA_TRANSLATION_MODEL_PATH", DEFAULT_MODEL_PATH)).resolve()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_model_manifest(model_path: Path) -> dict[str, Any]:
    manifest_path = model_path / "ASTERA_MODEL_MANIFEST.json"
    model_bin = model_path / "model.bin"
    if not manifest_path.is_file() or not model_bin.is_file():
        raise RuntimeError("translation model manifest/model.bin is missing")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("model_id") != MODEL_ID or manifest.get("model_revision") != MODEL_REVISION:
        raise RuntimeError("translation model identity does not match pinned Astera model")
    if manifest.get("quantization") != "int8":
        raise RuntimeError("translation model must use the reviewed int8 profile")
    expected = str(manifest.get("converted_model_sha256", ""))
    if not expected or not hmac.compare_digest(expected, _sha256(model_bin)):
        raise RuntimeError("translation model integrity check failed")
    return manifest


class MadladEngine:
    def __init__(self) -> None:
        model_path = _model_path()
        self.manifest = _verify_model_manifest(model_path)
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        self.tokenizer = AutoTokenizer.from_pretrained(str(model_path), local_files_only=True)
        self.translator = ctranslate2.Translator(
            str(model_path),
            device="cpu",
            compute_type="int8",
            inter_threads=max(1, int(os.environ.get("ASTERA_TRANSLATION_INTER_THREADS", "1"))),
            intra_threads=max(1, int(os.environ.get("ASTERA_TRANSLATION_INTRA_THREADS", "2"))),
        )
        self.beam_size = max(1, min(8, int(os.environ.get("ASTERA_TRANSLATION_BEAM_SIZE", "4"))))
        self._semaphore = threading.Semaphore(max(1, int(os.environ.get("ASTERA_TRANSLATION_MAX_CONCURRENCY", "1"))))

    def resolve_target(self, requested: str) -> str:
        unk = self.tokenizer.unk_token_id
        for candidate in normalize_target_candidates(requested):
            token = f"<2{candidate}>"
            token_id = self.tokenizer.convert_tokens_to_ids(token)
            if token_id is not None and token_id != unk:
                return candidate
        raise EngineError("TRANSLATION_TARGET_UNSUPPORTED", f"Target language is not supported by the pinned MADLAD model: {requested}")

    def _encode(self, text: str, target: str) -> list[str]:
        source = f"<2{target}> {text}"
        ids = self.tokenizer.encode(source, add_special_tokens=True)
        if len(ids) > MAX_INPUT_TOKENS:
            raise EngineError("TRANSLATION_INPUT_TOO_LONG", f"Translation unit exceeds {MAX_INPUT_TOKENS} model tokens.", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        return self.tokenizer.convert_ids_to_tokens(ids)

    def translate_many(self, texts: Sequence[str], target: str) -> tuple[list[str], int, int]:
        if not texts:
            return [], 0, 0
        encoded = [self._encode(value, target) for value in texts]
        input_tokens = sum(len(value) for value in encoded)
        with self._semaphore:
            results = self.translator.translate_batch(
                encoded,
                beam_size=self.beam_size,
                max_decoding_length=MAX_DECODING_LENGTH,
                return_scores=False,
            )
        outputs: list[str] = []
        output_tokens = 0
        for result in results:
            hypothesis = result.hypotheses[0]
            output_tokens += len(hypothesis)
            ids = self.tokenizer.convert_tokens_to_ids(hypothesis)
            decoded = self.tokenizer.decode(ids, skip_special_tokens=True).strip()
            if not decoded:
                raise EngineError("TRANSLATION_ENGINE_EMPTY", "MADLAD returned an empty translation.", HTTPStatus.BAD_GATEWAY)
            outputs.append(decoded)
        return outputs, input_tokens, output_tokens

    def translate(self, texts: Sequence[str], requested_target: str, strategy: str) -> dict[str, Any]:
        if strategy not in {"document", "lines"}:
            raise EngineError("TRANSLATION_STRATEGY_INVALID", "Translation strategy must be document or lines.")
        target = self.resolve_target(requested_target)
        input_tokens = 0
        output_tokens = 0
        outputs: list[str] = []
        strategy_used = strategy

        if strategy == "document":
            try:
                outputs, input_tokens, output_tokens = self.translate_many(texts, target)
            except EngineError as error:
                if error.code != "TRANSLATION_INPUT_TOO_LONG":
                    raise
                strategy_used = "lines"

        if strategy_used == "lines":
            for source in texts:
                local_input = 0
                local_output = 0

                def translate_batch(parts: Sequence[str]) -> Sequence[str]:
                    nonlocal local_input, local_output
                    translated, current_input, current_output = self.translate_many(parts, target)
                    local_input += current_input
                    local_output += current_output
                    return translated

                outputs.append(translate_structured_lines(source, translate_batch))
                input_tokens += local_input
                output_tokens += local_output

        return {
            "translations": outputs,
            "model": MODEL_ID,
            "model_revision": MODEL_REVISION,
            "target_language": target,
            "strategy_used": strategy_used,
            "backend": "ctranslate2-int8-cpu",
            "external_api_calls": 0,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "AsteraTranslation/1"

    @property
    def engine(self) -> MadladEngine:
        return self.server.engine  # type: ignore[attr-defined]

    @property
    def token(self) -> str:
        return self.server.internal_token  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: object) -> None:
        print(f"translation-engine {self.address_string()} {format % args}")

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        value = self.headers.get("authorization", "")
        if not value.startswith("Bearer "):
            return False
        return hmac.compare_digest(value[7:].strip(), self.token)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._json(HTTPStatus.NOT_FOUND, {"code": "NOT_FOUND", "message": "Not found."})
            return
        self._json(HTTPStatus.OK, {
            "status": "ready",
            "model": MODEL_ID,
            "model_revision": MODEL_REVISION,
            "backend": "ctranslate2-int8-cpu",
            "external_api_calls": 0,
        })

    def do_POST(self) -> None:
        if self.path != "/v1/translate":
            self._json(HTTPStatus.NOT_FOUND, {"code": "NOT_FOUND", "message": "Not found."})
            return
        if not self._authorized():
            self._json(HTTPStatus.UNAUTHORIZED, {"code": "TRANSLATION_ENGINE_UNAUTHORIZED", "message": "Unauthorized."})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"code": "TRANSLATION_REQUEST_SIZE_INVALID", "message": "Request size is invalid."})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            texts = payload.get("texts")
            target = payload.get("target_language")
            strategy = payload.get("strategy", "document")
            if not isinstance(texts, list) or not texts or not all(isinstance(item, str) for item in texts):
                raise EngineError("TRANSLATION_TEXTS_INVALID", "texts must be a non-empty string array.")
            if len(texts) > 64:
                raise EngineError("TRANSLATION_BATCH_TOO_LARGE", "A translation request may contain at most 64 texts.")
            if not isinstance(target, str) or not target.strip():
                raise EngineError("TRANSLATION_TARGET_REQUIRED", "target_language is required.")
            if not isinstance(strategy, str):
                raise EngineError("TRANSLATION_STRATEGY_INVALID", "strategy must be a string.")
            self._json(HTTPStatus.OK, self.engine.translate(texts, target, strategy))
        except EngineError as error:
            self._json(error.status, {"code": error.code, "message": str(error)})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._json(HTTPStatus.BAD_REQUEST, {"code": "TRANSLATION_JSON_INVALID", "message": "Request JSON is invalid."})
        except Exception as error:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"code": "TRANSLATION_ENGINE_INTERNAL", "message": type(error).__name__})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], engine: MadladEngine, internal_token: str):
        super().__init__(address, Handler)
        self.engine = engine
        self.internal_token = internal_token


def main() -> None:
    bind = os.environ.get("ASTERA_TRANSLATION_BIND", "127.0.0.1").strip()
    if bind not in {"127.0.0.1", "::1", "localhost"}:
        raise RuntimeError("translation engine must bind to loopback only")
    port = int(os.environ.get("PORT", str(DEFAULT_PORT)))
    token = _required_token()
    engine = MadladEngine()
    server = Server((bind, port), engine, token)
    print(f"translation-engine ready bind={bind}:{port} model={MODEL_ID}@{MODEL_REVISION} backend=ctranslate2-int8-cpu external_api_calls=0")
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
