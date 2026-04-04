from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.config import settings

# NullPool: no application-level connection pooling.
#
# This is the standard serverless pattern for Lambda + Neon:
# - Each request acquires a direct connection, uses it, and releases it immediately.
# - No persistent connections are held between requests.
# - Neon's built-in connection pooler (PgBouncer) handles multiplexing at the
#   infrastructure level, so application-side pooling adds no benefit and only
#   risks connection exhaustion under autoscaling.
#
# Neon's 115-connection limit comfortably supports up to 115 concurrent Lambda
# requests without any application-level pool management.
#
# statement_cache_size=0 is required for PgBouncer transaction mode compatibility.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    poolclass=NullPool,
    connect_args={"statement_cache_size": 0},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
