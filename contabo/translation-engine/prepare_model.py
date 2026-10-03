from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import ctranslate2
import transformers
from huggingface_hub import snapshot_download
from transformers import AutoTokenizer

MODEL_ID = "google/madlad400-3b-mt"
MODEL_REVISION = "fa184c675da0b5c9e1c8694fccd4e12e2d422094"
COPY_FILES = [
    "spiece.model",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "generation_config.json",
]
ALLOW_PATTERNS = ["model.safetensors", "config.json", *COPY_FILES]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def smoke(output: Path) -> str:
    tokenizer = AutoTokenizer.from_pretrained(str(output), local_files_only=True)
    translator = ctranslate2.Translator(str(output), device="cpu", compute_type="int8", inter_threads=1, intra_threads=2)
    source = "<2ja> This translation model is running locally."
    ids = tokenizer.encode(source, add_special_tokens=True)
    tokens = tokenizer.convert_ids_to_tokens(ids)
    result = translator.translate_batch([tokens], beam_size=2, max_decoding_length=128, return_scores=False)[0]
    output_ids = tokenizer.convert_tokens_to_ids(result.hypotheses[0])
    translated = tokenizer.decode(output_ids, skip_special_tokens=True).strip()
    if not translated or "<unk>" in translated.lower():
        raise RuntimeError("converted model smoke translation failed")
    return translated


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare the pinned Astera MADLAD-400 CTranslate2 INT8 model.")
    parser.add_argument("--output", required=True, help="Destination directory for the converted runtime model.")
    parser.add_argument("--work", default="/tmp/astera-madlad400-source", help="Temporary pinned Hugging Face snapshot directory.")
    parser.add_argument("--remove-source", action="store_true", help="Delete the large source snapshot after verified conversion.")
    args = parser.parse_args()

    output = Path(args.output).resolve()
    work = Path(args.work).resolve()
    if output.exists() and any(output.iterdir()):
        raise RuntimeError(f"output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)

    snapshot = Path(snapshot_download(
        repo_id=MODEL_ID,
        revision=MODEL_REVISION,
        local_dir=str(work),
        allow_patterns=ALLOW_PATTERNS,
    ))
    source_model = snapshot / "model.safetensors"
    if not source_model.is_file():
        raise RuntimeError("pinned source model.safetensors was not downloaded")

    copy_files = [name for name in COPY_FILES if (snapshot / name).is_file()]
    command = [
        "ct2-transformers-converter",
        "--model", str(snapshot),
        "--output_dir", str(output),
        "--quantization", "int8",
        "--force",
    ]
    if copy_files:
        command.extend(["--copy_files", *copy_files])
    subprocess.run(command, check=True)

    converted_model = output / "model.bin"
    if not converted_model.is_file():
        raise RuntimeError("CTranslate2 conversion did not produce model.bin")

    manifest = {
        "schema_version": 1,
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "quantization": "int8",
        "source_model_sha256": sha256(source_model),
        "converted_model_sha256": sha256(converted_model),
        "ctranslate2_version": ctranslate2.__version__,
        "transformers_version": transformers.__version__,
        "runtime_external_api_calls": 0,
    }
    (output / "ASTERA_MODEL_MANIFEST.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    translated = smoke(output)
    print(json.dumps({
        "status": "verified",
        "model_id": MODEL_ID,
        "model_revision": MODEL_REVISION,
        "quantization": "int8",
        "converted_model_sha256": manifest["converted_model_sha256"],
        "smoke_translation": translated,
    }, ensure_ascii=False))

    if args.remove_source:
        shutil.rmtree(work)


if __name__ == "__main__":
    main()
