import hashlib
import hmac
import io
import os
import socket
import sys
import threading
import time
from pathlib import Path

print("LAMA_STATUS:loading-python-dependencies", flush=True)

import numpy as np
import torch
import uvicorn
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from PIL import Image, ImageOps

MODEL_SHA256 = "344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9"
MAX_IMAGE_PIXELS = 4_000_000
MAX_UPLOAD_BYTES = 32 * 1024 * 1024
SERVICE_TOKEN = os.environ.get("LAMA_SERVICE_TOKEN", "")
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
model = None
inference_lock = threading.Lock()
inference_started_at = None
inference_phase = None


def authorized(authorization: str = Header(default="")):
    expected = f"Bearer {SERVICE_TOKEN}"
    if not SERVICE_TOKEN or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def load_model():
    model_path = Path(os.environ.get("LAMA_MODEL_PATH", ""))
    if not model_path.is_file():
        raise RuntimeError("LaMa model file is missing.")
    print("LAMA_STATUS:verifying-model", flush=True)
    digest = hashlib.sha256()
    with model_path.open("rb") as weights:
        for chunk in iter(lambda: weights.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != MODEL_SHA256:
        raise RuntimeError("LaMa model checksum validation failed.")
    print("LAMA_STATUS:loading-model", flush=True)
    torch.set_num_threads(max(1, min(2, os.cpu_count() or 1)))
    torch.set_num_interop_threads(1)
    return torch.jit.load(str(model_path), map_location="cpu").eval()


def decode_image(data, mode):
    try:
        with Image.open(io.BytesIO(data)) as decoded:
            width, height = decoded.size
            if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="Image exceeds the model pixel limit.")
            image = ImageOps.exif_transpose(decoded).convert(mode)
            image.load()
            return image
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=415, detail="Invalid image input.") from error


def infer_and_encode(source, binary_mask, width, height, dilation, feather):
    global inference_started_at, inference_phase
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="LaMa is already processing another image.")
    try:
        inference_started_at = time.monotonic()
        inference_phase = "inference"
        import cv2

        print("LAMA_TASK:inference", flush=True)
        if dilation:
            kernel = cv2.getStructuringElement(
                cv2.MORPH_ELLIPSE, (dilation * 2 + 1, dilation * 2 + 1)
            )
            binary_mask = cv2.dilate(binary_mask, kernel)
        alpha_mask = (
            cv2.GaussianBlur(binary_mask, (0, 0), feather)
            if feather
            else binary_mask
        )

        pad_height = (-height) % 8
        pad_width = (-width) % 8
        padded_image = np.pad(
            source, ((0, pad_height), (0, pad_width), (0, 0)), mode="symmetric"
        )
        padded_mask = np.pad(
            binary_mask, ((0, pad_height), (0, pad_width)), mode="symmetric"
        )
        image_tensor = torch.from_numpy(
            np.transpose(padded_image.astype(np.float32) / 255, (2, 0, 1))
        ).unsqueeze(0)
        mask_tensor = torch.from_numpy((padded_mask > 0).astype(np.float32))[None, None]
        with torch.inference_mode():
            result = model(image_tensor, mask_tensor)[0].permute(1, 2, 0).cpu().numpy()
        generated = np.clip(result[:height, :width] * 255, 0, 255).astype(np.uint8)
        del image_tensor, mask_tensor, padded_image, padded_mask, result

        inference_phase = "encoding"
        print("LAMA_TASK:encoding", flush=True)
        alpha = alpha_mask[:, :, None].astype(np.float32) / 255
        composited = np.clip(
            generated.astype(np.float32) * alpha
            + source.astype(np.float32) * (1 - alpha),
            0,
            255,
        ).astype(np.uint8)
        output = io.BytesIO()
        Image.fromarray(composited, mode="RGB").save(output, format="PNG")
        return output.getvalue()
    finally:
        inference_started_at = None
        inference_phase = None
        inference_lock.release()


@app.get("/health", dependencies=[Depends(authorized)])
def health():
    task = None
    if inference_lock.locked() and inference_started_at is not None:
        task = {
            "phase": inference_phase,
            "elapsed_seconds": int(time.monotonic() - inference_started_at),
        }
    return {"ready": model is not None, "task": task}


@app.post("/inpaint", dependencies=[Depends(authorized)])
async def inpaint(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    dilation: int = Form(4),
    feather: int = Form(5),
):
    if not 0 <= dilation <= 30 or not 0 <= feather <= 30:
        raise HTTPException(status_code=400, detail="Invalid mask settings.")
    print("LAMA_TASK:validating", flush=True)
    image_bytes = await image.read(MAX_UPLOAD_BYTES + 1)
    mask_bytes = await mask.read(MAX_UPLOAD_BYTES + 1)
    if len(image_bytes) > MAX_UPLOAD_BYTES or len(mask_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image or mask is too large.")
    original = decode_image(image_bytes, "RGB")
    mask_image = decode_image(mask_bytes, "L")
    width, height = original.size
    if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=413, detail="Image exceeds the model pixel limit.")
    if mask_image.size != (width, height):
        raise HTTPException(status_code=400, detail="Image and mask dimensions do not match.")

    source = np.asarray(original, dtype=np.uint8)
    mask_data = np.asarray(mask_image, dtype=np.uint8)
    if not np.any(mask_data):
        raise HTTPException(status_code=400, detail="Mask is empty.")
    binary_mask = np.where(mask_data > 64, 255, 0).astype(np.uint8)
    if not np.any(binary_mask) or np.count_nonzero(binary_mask) >= width * height * 0.8:
        raise HTTPException(status_code=400, detail="Mask coverage is invalid.")
    output = await run_in_threadpool(
        infer_and_encode, source, binary_mask, width, height, dilation, feather
    )
    return Response(content=output, media_type="image/png")


def main():
    global model
    token = SERVICE_TOKEN
    if not token:
        raise RuntimeError("LAMA_SERVICE_TOKEN is required.")
    print("LAMA_STATUS:loading-model", flush=True)
    model = load_model()
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    port = listener.getsockname()[1]
    print("LAMA_STATUS:ready", flush=True)
    print(f"LAMA_READY:{port}", flush=True)
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    server.run(sockets=[listener])


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"LaMa service could not start: {error}", file=sys.stderr, flush=True)
        raise
