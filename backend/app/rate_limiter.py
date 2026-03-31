"""
Simple in-memory rate limiter for FastAPI endpoints (RR3-33).

Uses a dictionary mapping (key) -> list[timestamp] to track requests within
a sliding window. Thread-safe for single-process deployments (Lambda/Uvicorn
with a single worker); not shared across multiple processes.

Usage:
    limiter = RateLimiter(max_requests=10, window_seconds=60)

    @router.post("/submit")
    async def submit(request: Request):
        await limiter.check(request.client.host)
        ...
"""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Callable

from fastapi import HTTPException, Request


class RateLimiter:
    """Sliding-window in-memory rate limiter."""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._timestamps: dict[str, list[float]] = defaultdict(list)

    def _evict_old(self, key: str, now: float) -> None:
        cutoff = now - self.window_seconds
        self._timestamps[key] = [t for t in self._timestamps[key] if t > cutoff]

    def check(self, key: str) -> None:
        """Raise 429 if key has exceeded the rate limit; otherwise record the request."""
        now = time.monotonic()
        self._evict_old(key, now)
        if len(self._timestamps[key]) >= self.max_requests:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again later.",
                headers={
                    "X-RateLimit-Limit": str(self.max_requests),
                    "X-RateLimit-Remaining": "0",
                    "Retry-After": str(self.window_seconds),
                },
            )
        self._timestamps[key].append(now)

    def get_remaining(self, key: str) -> int:
        """Return the number of remaining requests for key in the current window."""
        now = time.monotonic()
        self._evict_old(key, now)
        return max(0, self.max_requests - len(self._timestamps[key]))

    def reset(self, key: str) -> None:
        """Clear all recorded timestamps for key (useful in tests)."""
        self._timestamps.pop(key, None)


def get_client_ip(request: Request) -> str:
    """Return the real client IP, honouring X-Forwarded-For from Vercel proxy."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


# Singleton rate limiters — created once at module import time.
# Ballot submission: 10 requests per minute per voter_email.
ballot_submit_limiter = RateLimiter(max_requests=10, window_seconds=60)

# Public endpoints: 60 requests per minute per IP.
public_limiter = RateLimiter(max_requests=60, window_seconds=60)
