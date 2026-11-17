#!/usr/bin/env python3
"""Project-scoped bridge to Codex CLI's built-in image generation."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]


def project_path(raw):
    path = Path(raw).expanduser()
    path = (ROOT / path).resolve() if not path.is_absolute() else path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError("Path must stay inside the project")
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--transparent", action="store_true")
    args = parser.parse_args()
    prompt_file, target = project_path(args.prompt_file), project_path(args.out)
    if target.suffix.lower() != ".png" or not any(
        target.is_relative_to(ROOT / base) for base in ("public/assets", "assets")
    ):
        raise ValueError("Output must be a PNG under public/assets or assets")
    art_prompt = prompt_file.read_text(encoding="utf-8")
    if not art_prompt.strip():
        raise ValueError("Empty image prompt")
    codex = shutil.which("codex")
    if not codex:
        raise RuntimeError("Codex CLI is not on PATH")
    runs = ROOT / ".local/art-runs"
    runs.mkdir(parents=True, exist_ok=True)
    run = runs / (dt.datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8])
    run.mkdir()
    target.parent.mkdir(parents=True, exist_ok=True)
    request = (
        "You are the image-generation collaborator for Claude Code in PROJECT: MEDIEVAL KINGDOMS. "
        "This is an image task only; do not implement the game or start Claude. "
        "Use the imagegen skill and the built-in image generation tool, which is enabled. "
        "Generate exactly one image. Do not use Python drawing, SVG placeholders, a direct API "
        "key or an alternate image service. If the built-in tool is unavailable, stop and report it. "
        "Inspect the result. Copy the generated PNG byte-for-byte to the exact requested output "
        "path without replacing an existing file. Keep generated alpha. Do not edit any other "
        "project files. End with the saved path, dimensions and any limitations.\n\n"
        f"Output path: {target}\n"
        f"Transparent background: {'true, require real alpha' if args.transparent else 'false'}\n"
        f"Original prompt file: {prompt_file}\n\n{art_prompt}\n"
    )
    (run / "request.txt").write_text(request, encoding="utf-8")
    command = [codex, "exec", "--enable", "image_generation", "--sandbox", "workspace-write",
               "-c", 'approval_policy="never"', "--cd", str(ROOT), "--json", "--color", "never",
               "--output-last-message", str(run / "report.md"), "-"]
    with (runs / "generation.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.exists():
            raise FileExistsError(f"Refusing to overwrite {target}")
        print(json.dumps({"status": "generating", "output": str(target), "run": str(run)}), flush=True)
        with (run / "events.jsonl").open("w") as stdout, (run / "stderr.log").open("w") as stderr:
            result = subprocess.run(command, input=request, text=True, cwd=ROOT,
                                    stdout=stdout, stderr=stderr, timeout=1800)
        if result.returncode:
            raise RuntimeError(f"Codex exited {result.returncode}; see {run}")
        if not target.is_file():
            raise RuntimeError(f"Codex returned without the requested image; see {run}")
        data = target.read_bytes()
        if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
            raise RuntimeError(f"Output is not a valid PNG header: {target}")
        width, height = struct.unpack(">II", data[16:24])
        metadata = {"status": "saved", "path": str(target), "width": width, "height": height,
                    "bytes": len(data), "transparent_requested": args.transparent,
                    "png_color_type": data[25], "run": str(run)}
        (run / "result.json").write_text(json.dumps(metadata, indent=2) + "\n")
        print(json.dumps(metadata), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        sys.exit(1)
