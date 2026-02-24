from __future__ import annotations

import os
from typing import List

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # ── Database ────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql://lnz:lnz_dev_password@localhost:5432/lnz_db"

    # ── Security ─────────────────────────────────────────────────────────────
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    # Must be exactly 32 bytes for AES-256-CBC
    FILE_ENCRYPTION_KEY: str = "dev-file-key-32-bytes-exactly!!"

    # ── CORS ─────────────────────────────────────────────────────────────────
    CORS_ORIGINS: str = "http://localhost:3000"

    # ── Upload ───────────────────────────────────────────────────────────────
    MAX_UPLOAD_SIZE_MB: int = 10
    UPLOAD_DIR: str = "uploads"

    # ── Providers ────────────────────────────────────────────────────────────
    MARKET_DATA_PROVIDER: str = "mock"  # "mock" | "http"
    NEWS_PROVIDER: str = "live"  # "mock" | "http" | "live"

    # Generic HTTP adapter config (populated via env, never hardcoded)
    MARKET_DATA_BASE_URL: str = ""
    MARKET_DATA_API_KEY: str = ""
    NEWS_BASE_URL: str = ""
    NEWS_API_KEY: str = ""

    # Optional LLM configuration (used for AI assistant).
    # AI_PROVIDER can be: "auto" | "gemini" | "openai" | "deterministic"
    AI_PROVIDER: str = "auto"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta/openai"

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_MODEL_CHAT: str = ""
    OPENAI_MODEL_INSIGHTS: str = ""
    OPENAI_MODEL_DASHBOARD: str = ""
    OPENAI_MODEL_NEWS: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024

    @property
    def encryption_key_bytes(self) -> bytes:
        key = self.FILE_ENCRYPTION_KEY.encode()
        # Pad / truncate to exactly 32 bytes
        return key[:32].ljust(32, b"\x00")

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
