# Celery application config for the transcribe/embed/summarize task chain.

from celery import Celery

from app.core.config import settings

import app.models  # noqa: F401

celery_app = Celery(
    "recallmeet",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.workers.transcription",
        "app.workers.embedding",
        "app.workers.summarization",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

# TLS options only apply to secure Redis URLs (rediss://, e.g. Upstash in production).
# A local plain redis:// URL must not have them or Celery refuses to start.
if settings.REDIS_URL.startswith("rediss://"):
    celery_app.conf.update(
        broker_use_ssl={"ssl_cert_reqs": "required"},
        redis_backend_use_ssl={"ssl_cert_reqs": "required"},
    )