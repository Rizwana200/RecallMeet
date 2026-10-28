# Local-disk storage for uploaded recordings (replaces S3).

import uuid
from pathlib import Path

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"


def generate_upload_key() -> str:
    """
    Always generate our own internal filename - never use anything
    from the user (original filename, extension, etc).
    """
    return f"audio/{uuid.uuid4()}"


def local_path(storage_key: str) -> Path:
    path = (UPLOAD_DIR / storage_key).resolve()
    if UPLOAD_DIR.resolve() not in path.parents:
        raise ValueError("Invalid storage key")
    return path


def generate_download_url(storage_key: str) -> str:
    return ""


def delete_object(storage_key: str) -> None:
    local_path(storage_key).unlink(missing_ok=True)