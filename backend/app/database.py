from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    # Pool settings tuned for the serverless Lambda environment.
    # Values are read from settings so they can be overridden via env vars
    # (DB_POOL_SIZE, DB_MAX_OVERFLOW, DB_POOL_TIMEOUT) without a code change.
    #
    # Defaults (pool_size=1, max_overflow=0, pool_timeout=10):
    # - pool_size=1: each Lambda instance holds at most 1 persistent connection.
    #   Lambda instances don't share connections, so a pool larger than 1 wastes
    #   connections and causes exhaustion under autoscaling (RR3-05).
    # - max_overflow=0: no burst capacity beyond pool_size — each Lambda serves
    #   one request at a time, so overflow is unnecessary and wastes connections.
    # - pool_timeout=10: raise an error if a connection cannot be acquired within
    #   10 seconds, preventing requests from hanging indefinitely under pool pressure.
    # - pool_pre_ping=True: detect stale connections before use (Neon idles connections
    #   after ~5 minutes of inactivity; pre-ping avoids "connection already closed" errors).
    # - pool_recycle=3600: recycle connections hourly to avoid Neon idle-timeout disconnects.
    #
    # Rationale: Neon's starter tier allows ~25 simultaneous connections. With
    # pool_size=5 (SQLAlchemy default) + max_overflow=10, each Lambda instance could
    # hold up to 15 connections, exhausting the limit with just 2 concurrent instances.
    # At pool_size=1 + max_overflow=0, each Lambda instance holds exactly 1 connection,
    # supporting up to 25 concurrent Lambda instances before nearing the Neon limit.
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout,
    pool_pre_ping=True,
    pool_recycle=3600,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
