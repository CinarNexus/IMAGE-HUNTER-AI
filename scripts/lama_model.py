import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

MODEL_URL = "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt"
MODEL_SHA256 = "344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9"
MODEL_MD5 = "e3aa4aaa15225a33ec84f9f4bc47e500"
MODEL_SIZE = 205669692
MODEL_PATH = Path(__file__).resolve().parents[1] / ".models" / "lama" / "big-lama.pt"


def file_hash(path, algorithm):
    digest = hashlib.new(algorithm)
    with path.open("rb") as model:
        for chunk in iter(lambda: model.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def valid_model(path):
    return (
        path.is_file()
        and path.stat().st_size == MODEL_SIZE
        and file_hash(path, "sha256") == MODEL_SHA256
    )


def download_model(path=MODEL_PATH):
    if valid_model(path):
        print(f"LaMa modeli doğrulandı: {path}")
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(path.name + ".part")
    try:
        curl = shutil.which("curl.exe") or shutil.which("curl")
        if curl:
            subprocess.run(
                [
                    curl,
                    "--fail",
                    "--location",
                    "--retry",
                    "2",
                    "--connect-timeout",
                    "30",
                    "--max-time",
                    "1200",
                    "--progress-bar",
                    "--output",
                    str(temporary_path),
                    MODEL_URL,
                ],
                check=True,
                timeout=1220,
            )
            total = temporary_path.stat().st_size
        else:
            request = urllib.request.Request(
                MODEL_URL, headers={"User-Agent": "IMAGE-HUNTER-AI/1.0"}
            )
            with urllib.request.urlopen(
                request, timeout=30
            ) as response, temporary_path.open("wb") as target:
                total = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MODEL_SIZE:
                        raise ValueError("Model indirmesi beklenen boyutu aştı.")
                    target.write(chunk)
        if total != MODEL_SIZE or file_hash(temporary_path, "sha256") != MODEL_SHA256:
            raise ValueError("Model SHA-256 doğrulaması başarısız.")
        if file_hash(temporary_path, "md5") != MODEL_MD5:
            raise ValueError("Model MD5 doğrulaması başarısız.")
        os.replace(temporary_path, path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    print(f"LaMa modeli indirildi ve doğrulandı: {path}")
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if not args.download:
        parser.error("--download is required")
    try:
        download_model()
    except Exception as error:
        print(f"LaMa modeli kurulamadı: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
