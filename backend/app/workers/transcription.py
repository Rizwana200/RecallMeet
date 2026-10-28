# Celery task that loads media from local disk, converts it to 16 kHz mono WAV with ffmpeg, and transcribes with Whisper.

import glob
import os
import shutil
import subprocess
import tempfile
import wave

import numpy as np
from faster_whisper import WhisperModel

from app.workers.celery_app import celery_app
from app.db.session import SessionLocal
from app.models.meeting import Meeting
from app.services.s3 import local_path

# "base" is much faster on CPU for local testing. Change to "medium" for better accuracy.
_model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=2)

EXTENSION_BY_MIME = {
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/ogg": ".ogg",
    "audio/webm": ".webm",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}


def _find_ffmpeg() -> str:
    """
    Find the ffmpeg executable: FFMPEG_PATH env var, then PATH, then the
    default WinGet install location on Windows. Falls back to plain "ffmpeg".
    """
    from_env = os.environ.get("FFMPEG_PATH")
    if from_env and os.path.exists(from_env):
        return from_env

    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        pattern = os.path.join(
            local_app_data, "Microsoft", "WinGet", "Packages",
            "Gyan.FFmpeg*", "**", "bin", "ffmpeg.exe",
        )
        matches = glob.glob(pattern, recursive=True)
        if matches:
            return matches[0]

    return "ffmpeg"


def convert_to_wav(input_path: str, output_path: str) -> None:
    """
    Decode any audio/video file with ffmpeg to 16 kHz mono 16-bit WAV, the
    format faster-whisper likes best. Raises subprocess.CalledProcessError if
    ffmpeg can't handle the file (e.g. a video with no audio stream).
    """
    subprocess.run(
        [
            _find_ffmpeg(),
            "-y",
            "-i", input_path,
            "-vn",
            "-ac", "1",
            "-ar", "16000",
            "-c:a", "pcm_s16le",
            output_path,
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def load_wav_as_array(wav_path: str) -> np.ndarray:
    """Read a 16 kHz mono 16-bit WAV into a float32 array in [-1, 1]."""
    with wave.open(wav_path, "rb") as wav_file:
        frames = wav_file.readframes(wav_file.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


@celery_app.task(name="transcribe_meeting")
def transcribe_meeting(meeting_id: str):
    db = SessionLocal()
    meeting = None
    try:
        meeting = db.get(Meeting, meeting_id)
        if meeting is None:
            return

        meeting.status = "transcribing"
        db.commit()

        extension = EXTENSION_BY_MIME.get(meeting.content_type, ".bin")

        with tempfile.TemporaryDirectory() as tmp_dir:
            source_path = os.path.join(tmp_dir, f"media_file{extension}")
            shutil.copyfile(local_path(meeting.storage_key), source_path)

            if meeting.source_media_type == "video":
                meeting.status = "converting"
                db.commit()

            wav_path = os.path.join(tmp_dir, "converted_audio.wav")
            convert_to_wav(source_path, wav_path)

            if meeting.source_media_type == "video":
                meeting.status = "transcribing"
                db.commit()

            audio = load_wav_as_array(wav_path)

            segments, _info = _model.transcribe(audio, task="translate")
            full_text = " ".join(segment.text.strip() for segment in segments)

        meeting.transcript_text = full_text
        meeting.status = "validating"
        db.commit()

        from app.workers.embedding import embed_meeting
        embed_meeting.delay(str(meeting.id))

    except Exception as exc:
        if meeting is not None:
            meeting.status = "failed"
            meeting.error_message = _friendly_error(exc)
            db.commit()
        raise
    finally:
        db.close()


def _friendly_error(exc: Exception) -> str:
    """Map low-level pipeline failures to a human-readable reason."""
    if isinstance(exc, subprocess.CalledProcessError):
        return (
            "We couldn't process this recording — it may not contain an audio track "
            "or may use an unsupported codec."
        )
    if isinstance(exc, FileNotFoundError):
        return "A required file or tool (such as ffmpeg) could not be found on the server."
    return "An unexpected error occurred while processing this meeting."