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

    # ── Auth ─────────────────────────────────────────────────────────────────
    # Optional single-user API key. When set, all non-health endpoints require
    # the header  X-API-Key: <LNZ_API_KEY>  or  Authorization: Bearer <LNZ_API_KEY>.
    # Leave empty (default) to disable — safe for local / development use.
    LNZ_API_KEY: str = ""

    # ── Clerk multi-user auth ─────────────────────────────────────────────────
    # Required for multi-user mode. Leave empty to keep the old single-user mode.
    # CLERK_JWKS_URL: e.g. https://<your-clerk-domain>/.well-known/jwks.json
    CLERK_JWKS_URL: str = ""
    # CLERK_ISSUER: e.g. https://<your-clerk-domain>
    CLERK_ISSUER: str = ""
    # CLERK_WEBHOOK_SECRET: whsec_... from Clerk dashboard → Webhooks
    CLERK_WEBHOOK_SECRET: str = ""

    # ── Stripe billing ───────────────────────────────────────────────────────
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_ANALYST_PRICE_ID: str = ""
    STRIPE_COMMAND_PRICE_ID: str = ""
    STRIPE_ANALYST_TRIAL_DAYS: int = 7

    # ── API explorer ─────────────────────────────────────────────────────────
    # Set to true in production to hide /docs and /redoc endpoints.
    HIDE_DOCS: bool = False

    # ── Rate limiting ─────────────────────────────────────────────────────────
    # Max AI endpoint calls per minute per IP. 0 = disabled.
    # The pipeline makes 3 calls per round × 2 rounds × 2 retries = ~12 calls
    # per pipeline run. 60 gives headroom for concurrent usage (news page
    # auto-refresh, article briefs, chat) without false positives.
    AI_RATE_LIMIT_PER_MINUTE: int = 60

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
