# Design: Backend Query Performance Improvements

**Status:** Implemented

PRD reference: none (internal performance improvement)

---

## Overview

The Neon compute tier runs at 0.25 CU. Every sequential DB round-trip on a hot path consumes compute time in series. Under parallel E2E shard load, many requests arrive simultaneously, saturating the shared compute and causing timeouts and 500s. This design reduces round-trips on five hot paths: the voter-state resolver used by every auth and session-restore call, the motions list endpoint hit on every voter page load, the admin meeting-detail tally computed by scanning all vote rows in Python, the session re-issue that inserts a new row on every `POST /api/auth/session` call, and the tenant-config lookup that hits the DB on every public page load.

None of these changes require schema migrations. They are pure query and in-process logic changes.

---

## Root Cause / Background

**Context:** Vercel Fluid Compute runs multiple concurrent requests inside the same Lambda instance. With `pool_size=20` the connection pool is large enough, but each sequential query within a single request occupies the same connection serially. Under concurrent E2E load the Neon 0.25 CU compute (which executes queries) is the bottleneck — not the connection pool. Reducing the number of sequential round-trips per request directly reduces per-request compute time and therefore the probability of timeout under load.

---

## Technical Design

### Improvement 1: `_resolve_voter_state` — 5 sequential queries → 3 parallel + 1 sequential

**File:** `backend/app/routers/auth.py`

**Current query sequence (5 sequential round-trips):**

1. `SELECT LotOwnerEmail WHERE email = ? AND building_id = ?`
2. `SELECT LotProxy WHERE proxy_email = ? AND building_id = ?`
3. `SELECT LotOwner WHERE id IN (?)`
4. `SELECT Motion WHERE general_meeting_id = ? AND is_visible = true`
5. `SELECT Vote.lot_owner_id, Vote.motion_id WHERE general_meeting_id = ? AND lot_owner_id IN (?) AND status = 'submitted'`

Queries 1 and 2 are independent of each other (both need only `voter_email` and `building_id`). Queries 3, 4, and 5 all depend on the results of queries 1+2 (need `all_lot_owner_ids` and `general_meeting_id`).

**Constraint: SQLAlchemy async session safety.** A single `AsyncSession` is backed by a single asyncpg connection. The SQLAlchemy asyncio documentation is explicit that a session must not be shared across concurrent coroutines — executing two `await session.execute(...)` calls concurrently on the same session corrupts the connection state. The correct pattern for parallelism is one of:

- **Separate sessions per coroutine** — each coroutine opens its own `AsyncSession` via `AsyncSessionLocal()`.
- **Remain sequential on one session** — no parallelism but no safety risk.

**Proposed approach — parallel queries 1+2 using separate sessions, sequential queries 3+4+5 on the request session:**

Queries 1 and 2 read independent tables with no shared write risk. Extract them into small coroutines that each open their own `AsyncSession`, run the query, close the session, and return the result. Use `asyncio.gather` to fire both concurrently. After the gather, continue on the original request session for queries 3, 4, and 5.

```python
async def _load_direct_lot_owner_ids(
    voter_email: str, building_id: uuid.UUID
) -> set[uuid.UUID]:
    async with AsyncSessionLocal() as s:
        r = await s.execute(
            select(LotOwnerEmail.lot_owner_id)
            .join(LotOwner, LotOwnerEmail.lot_owner_id == LotOwner.id)
            .where(
                LotOwnerEmail.email.isnot(None),
                LotOwnerEmail.email == voter_email,
                LotOwner.building_id == building_id,
            )
        )
        return {row[0] for row in r.all()}


async def _load_proxy_lot_owner_ids(
    voter_email: str, building_id: uuid.UUID
) -> set[uuid.UUID]:
    async with AsyncSessionLocal() as s:
        r = await s.execute(
            select(LotProxy.lot_owner_id)
            .join(LotOwner, LotProxy.lot_owner_id == LotOwner.id)
            .where(
                LotProxy.proxy_email == voter_email,
                LotOwner.building_id == building_id,
            )
        )
        return {row[0] for row in r.all()}


# Inside _resolve_voter_state:
direct_ids, proxy_ids = await asyncio.gather(
    _load_direct_lot_owner_ids(voter_email, building_id),
    _load_proxy_lot_owner_ids(voter_email, building_id),
)
all_lot_owner_ids = direct_ids | proxy_ids

# Queries 3, 4, 5 remain sequential on the existing `db` session
# (they depend on all_lot_owner_ids which is now available)
```

**Why not parallelize queries 3, 4, 5 as well?** Query 4 (motions) and query 5 (votes) are also independent of each other once `all_lot_owner_ids` is known. Query 3 (LotOwner load) is also independent. All three could be parallelized using separate sessions. However, the implementation complexity increases significantly (three more helper coroutines) while the marginal gain is smaller — these three queries run after the `asyncio.gather` result is available and are individually faster (smaller result sets, indexed lookups). The design below includes this optional further parallelization as a separate step.

**Optional further parallelization (queries 3, 4, 5):**

```python
async def _load_lot_owners(ids: frozenset[uuid.UUID]) -> dict[uuid.UUID, LotOwner]:
    async with AsyncSessionLocal() as s:
        r = await s.execute(select(LotOwner).where(LotOwner.id.in_(ids)))
        return {lo.id: lo for lo in r.scalars().all()}

async def _load_visible_motions(general_meeting_id: uuid.UUID) -> list[Motion]:
    async with AsyncSessionLocal() as s:
        r = await s.execute(
            select(Motion).where(
                Motion.general_meeting_id == general_meeting_id,
                Motion.is_visible == True,  # noqa: E712
            )
        )
        return list(r.scalars().all())

async def _load_submitted_votes(
    general_meeting_id: uuid.UUID, lot_owner_ids: frozenset[uuid.UUID]
) -> dict[uuid.UUID, set[uuid.UUID]]:
    async with AsyncSessionLocal() as s:
        r = await s.execute(
            select(Vote.lot_owner_id, Vote.motion_id).where(
                Vote.general_meeting_id == general_meeting_id,
                Vote.lot_owner_id.in_(lot_owner_ids),
                Vote.status == VoteStatus.submitted,
            )
        )
        result: dict[uuid.UUID, set[uuid.UUID]] = {}
        for lot_owner_id, motion_id in r.all():
            result.setdefault(lot_owner_id, set()).add(motion_id)
        return result

lot_owners, visible_motions, voted_by_lot = await asyncio.gather(
    _load_lot_owners(frozenset(all_lot_owner_ids)),
    _load_visible_motions(general_meeting_id),
    _load_submitted_votes(general_meeting_id, frozenset(all_lot_owner_ids)),
)
```

**Round-trips before → after:**
- Phase 1 only (queries 1+2 parallel): 5 sequential → 1 gather(2) + 3 sequential = **4 wall-clock round-trips** (the gather counts as 1 because both fire simultaneously)
- Phase 1 + optional phase 2: 5 sequential → 1 gather(2) + 1 gather(3) = **2 wall-clock round-trips**

**Session safety:** Each helper coroutine opens and closes its own `AsyncSessionLocal()` context manager. The original request session (`db`) is only used after the gather results are merged. No session is shared across concurrent coroutines.

**Risk:** Opening extra sessions per request increases the connection pool utilisation. With `pool_size=20` and `max_overflow=10`, each `_resolve_voter_state` call would consume up to 3 connections simultaneously (2 for the gather, 1 for the sequential remainder). Under heavy E2E load (20 concurrent voters) this is 60 connections total — within PgBouncer's capacity but approaching the Lambda pool limit. The optional phase-2 gather would add 2 more simultaneous connections per call. Monitor pool exhaustion metrics after deploying phase 1 before enabling phase 2.

**Existing `db` parameter:** The `db` session passed to `_resolve_voter_state` is still used for the LotOwner, Motion, and Vote queries (or for the optional gather helpers with separate sessions). The function signature does not change; callers are unaffected.

---

### Improvement 2: `list_motions` — 4 sequential queries → 2 parallel + 1 sequential

**File:** `backend/app/routers/voting.py`

**Current query sequence (4 sequential round-trips after session validation):**

1. `SELECT GeneralMeeting WHERE id = ?` (meeting existence check)
2. `SELECT LotOwnerEmail.lot_owner_id WHERE email = ? AND building_id = ?`
3. `SELECT LotProxy.lot_owner_id WHERE proxy_email = ? AND building_id = ?`
4. `SELECT Vote.motion_id, Vote.choice, Vote.motion_option_id WHERE general_meeting_id = ? AND lot_owner_id IN (?) AND status = 'submitted'`
5. `SELECT Motion WHERE general_meeting_id = ? AND (is_visible OR id IN (?))` (depends on query 4 result)
6. Conditional: `SELECT MotionOption WHERE motion_id IN (?)` if any multi-choice motions

Note: `get_session` (called before these) issues its own query (1 round-trip). So total is up to 6 sequential round-trips including session validation.

**Proposed approach:**

Queries 2 and 3 (direct and proxy lot ID lookups) are independent. They can be parallelized using the same separate-session helper pattern described in Improvement 1 (reuse `_load_direct_lot_owner_ids` and `_load_proxy_lot_owner_ids`). Query 1 (meeting existence check) and the gather(2,3) can also be parallelized since query 1 only needs `general_meeting_id`.

```python
# Fire meeting existence check and both lot-ID lookups concurrently.
# meeting_building_id comes from session.building_id or a prior join — see note below.
meeting_result_task = asyncio.create_task(
    _load_meeting(general_meeting_id)     # separate session helper
)
direct_ids_task = asyncio.create_task(
    _load_direct_lot_owner_ids(voter_email, meeting.building_id)
)
proxy_ids_task = asyncio.create_task(
    _load_proxy_lot_owner_ids(voter_email, meeting.building_id)
)
```

However, queries 2 and 3 need `meeting.building_id` which comes from query 1. There are two options:

**Option A — Keep meeting query sequential, parallelize lot-ID queries:**
```python
meeting_result = await db.execute(select(GeneralMeeting).where(...))
meeting = meeting_result.scalar_one_or_none()
# Now fire queries 2 and 3 in parallel using separate sessions
direct_ids, proxy_ids = await asyncio.gather(
    _load_direct_lot_owner_ids(voter_email, meeting.building_id),
    _load_proxy_lot_owner_ids(voter_email, meeting.building_id),
)
```

**Option B — Use `session.building_id` to skip the meeting query entirely.**
The `SessionRecord` already stores `building_id`. The `session` returned by `get_session()` has a `building_id` attribute. The meeting existence check in `list_motions` (`meeting_result.scalar_one_or_none()`) is currently described as "pragma: no cover" — it is unreachable in practice because the session FK guarantees the meeting exists. Remove this unreachable check and derive `building_id` directly from `session.building_id`.

Option B is cleaner — it eliminates query 1 entirely and allows queries 2 and 3 to be parallelized immediately. This is the recommended approach.

```python
# No meeting query needed — session guarantees meeting exists and provides building_id
building_id = session.building_id

direct_ids, proxy_ids = await asyncio.gather(
    _load_direct_lot_owner_ids(voter_email, building_id),
    _load_proxy_lot_owner_ids(voter_email, building_id),
)
all_lot_owner_ids = direct_ids | proxy_ids

# Query 4 (votes) and query 5 (motions) remain sequential on `db`
# They cannot be parallelized because query 5 needs voted_motion_ids from query 4
```

**Round-trips before → after (excluding `get_session` query which is unchanged):**
- Before: 4 sequential = 4 round-trips
- After (Option B): 1 gather(2) + 2 sequential = **3 wall-clock round-trips** (and one query eliminated entirely)

**SessionRecord model change:** Add `building_id` as a direct attribute on the object returned by `get_session()`. The `SessionRecord` model already has `building_id: Mapped[uuid.UUID]` — no schema change required. The endpoint simply accesses `session.building_id` instead of querying `GeneralMeeting`.

---

### Improvement 3: `get_general_meeting_detail` tally — SQL GROUP BY aggregation

**File:** `backend/app/services/admin_service.py`

**Current approach:**

The function loads every `Vote` row for the meeting into Python:
```python
votes_result = await db.execute(
    select(Vote).where(
        Vote.general_meeting_id == general_meeting_id,
        Vote.status == VoteStatus.submitted,
    )
)
submitted_votes = list(votes_result.scalars().all())
```
It then builds an in-memory index `votes_by_motion` and iterates over each motion scanning the index. For a meeting with V submitted votes and M motions, the index build is O(V) and each motion scan is O(V/M) amortized. The existing code comment (RR4-10) notes this has already been optimised from O(V×M) to O(V) via pre-indexing. However, the raw transfer of all `Vote` columns (id, general_meeting_id, motion_id, voter_email, lot_owner_id, choice, status, created_at, updated_at, motion_option_id) for every submitted vote is still expensive. For a 150-lot building with 20 motions, this is ~3,000 rows × 10 columns transferred over the wire from Neon.

**Proposed approach — SQL GROUP BY aggregation query:**

Replace the full `Vote` row load with a lightweight aggregation query that returns only what is needed for the tally: `(motion_id, motion_option_id, choice, lot_owner_id)`. Keep the per-lot voter list data (voter_email, lot_number, etc.) as a separate query that only runs for the admin detail view.

The core aggregation for standard (non-multi-choice) motions:

```sql
SELECT
    v.motion_id,
    v.choice,
    v.lot_owner_id
FROM votes v
WHERE
    v.general_meeting_id = :general_meeting_id
    AND v.status = 'submitted'
    AND v.motion_option_id IS NULL
```

For multi-choice motions:

```sql
SELECT
    v.motion_id,
    v.motion_option_id,
    v.choice,
    v.lot_owner_id
FROM votes v
WHERE
    v.general_meeting_id = :general_meeting_id
    AND v.status = 'submitted'
    AND v.motion_option_id IS NOT NULL
```

These two queries replace the single full-object load. The data volume is identical in row count but each row is 4 columns instead of 10, reducing transfer size by ~60%.

**Further optimisation — pure SQL tally for standard motions:**

For standard (yes/no/abstained/not_eligible) motions, the tally can be fully computed in the DB using a `GROUP BY` aggregation joined against `agm_lot_weights` for entitlement sums, avoiding any per-lot iteration in Python:

```sql
SELECT
    v.motion_id,
    v.choice,
    COUNT(DISTINCT v.lot_owner_id)                         AS voter_count,
    COALESCE(SUM(w.unit_entitlement_snapshot), 0)          AS entitlement_sum
FROM votes v
LEFT JOIN agm_lot_weights w
    ON w.lot_owner_id = v.lot_owner_id
    AND w.general_meeting_id = v.general_meeting_id
WHERE
    v.general_meeting_id = :general_meeting_id
    AND v.status = 'submitted'
    AND v.motion_option_id IS NULL
    AND v.lot_owner_id IN (
        SELECT lot_owner_id FROM agm_lot_weights
        WHERE general_meeting_id = :general_meeting_id
    )
GROUP BY v.motion_id, v.choice
```

This query returns at most `M × 4` rows (motions × choices) rather than all vote rows. For a 150-lot, 20-motion meeting: ~80 rows vs ~3,000 rows. The `lot_owner_id IN (SELECT ...)` subquery filters out votes from lots not in the snapshot (matching the existing `submitted_lot_owner_ids` filter).

**Important constraint:** The voter lists (per-lot detail for yes/no/abstained/not_eligible, shown in the admin UI) still require individual lot_owner_id rows. The aggregation query is used for the `tally` dict (voter_count + entitlement_sum). The voter list can be built from a separate lightweight query:

```sql
SELECT v.motion_id, v.choice, v.lot_owner_id
FROM votes v
WHERE
    v.general_meeting_id = :general_meeting_id
    AND v.status = 'submitted'
    AND v.motion_option_id IS NULL
    AND v.lot_owner_id IN (
        SELECT lot_owner_id FROM agm_lot_weights
        WHERE general_meeting_id = :general_meeting_id
    )
```

This is the same query but without the `GROUP BY` and without the entitlement join. The entitlement for each lot is already loaded into `lot_entitlement` from the `agm_lot_weights` load that already runs earlier in the function.

**Implementation note — snapshot columns on MotionOption.**
The existing code already uses snapshot columns (`opt.for_voter_count`, `opt.for_entitlement_sum`, etc.) on `MotionOption` for closed meetings, falling back to live computation for open meetings. The SQL aggregation approach applies to the live-computation path (open meetings). For closed meetings the snapshot columns remain the primary source and the aggregation query is not needed. The implementation should branch on `is_closed`:

```python
if is_closed:
    # Use snapshot columns on MotionOption (existing logic, unchanged)
    ...
else:
    # Use SQL aggregation query for tally; voter list from lightweight query
    ...
```

**Round-trips:** No change to round-trip count — the tally query replaces the existing `Vote` full-load query (still 1 round-trip). The improvement is in data transfer volume and in-Python computation, not round-trip count.

**Expected improvement:** ~60% reduction in bytes transferred from Neon for the tally query. In-Python iteration over votes drops from O(V) to O(M×4) for the tally path.

---

### Improvement 4: `restore_session` — extend existing session instead of creating a new one

**File:** `backend/app/routers/auth.py` (the `restore_session` handler) and `backend/app/services/auth_service.py` (the `create_session` function)

**Current behaviour:**

Every call to `POST /api/auth/session` calls `create_session(...)` which inserts a new `SessionRecord` row with a fresh random token and new `expires_at`. The old session row is NOT deleted — it remains in the DB until the background cleanup job runs. Over the course of a single voting session (voter loads the page, navigates between motions, submits), the voter may call `POST /api/auth/session` many times. Each call inserts a new row and issues a new cookie. The old rows accumulate until cleanup.

**Problem:**
1. Extra INSERT per session restore call (adds a write round-trip)
2. Proliferation of session rows per voter — cleanup must delete more rows
3. On the hot path under load, the INSERT contends on the `session_records` table

**Proposed approach — extend expiry on the existing valid session:**

Modify `restore_session` to update `expires_at` on the existing `SessionRecord` rather than inserting a new one. The signed token delivered via cookie remains the same (its signature is still valid since `itsdangerous` checks max_age against the time of signing, not the DB expiry). The DB `expires_at` is the authoritative expiry, so extending it in the DB effectively renews the session without a new token.

```python
# In restore_session, after session_record is found:
# Instead of calling create_session(...) (which inserts a new row):
new_expiry = datetime.now(UTC) + SESSION_DURATION
session_record.expires_at = new_expiry
await db.flush()
await db.commit()

# Re-sign the same raw token (reuse session_record.session_token)
new_signed_token = _sign_token(session_record.session_token)
```

**Cookie re-issue:** The cookie `max_age` on the client is reset to `_TOKEN_MAX_AGE_SECONDS` by setting the cookie with the updated signed token. Since `_sign_token` embeds the current timestamp (via itsdangerous), the new signed token has a fresh timestamp and will be valid for another `_TOKEN_MAX_AGE_SECONDS` seconds from now. The raw token in the DB is unchanged. The DB `expires_at` is extended to `now + SESSION_DURATION`.

**Session record cleanup:** With this change, each voter has at most one active `SessionRecord` at any time (the one issued on `verify_auth`). The `_cleanup_expired_sessions` job has far fewer rows to delete.

**Edge case — concurrent session restore calls:** Two concurrent `POST /api/auth/session` calls from the same client (e.g. two browser tabs) may both read the same `SessionRecord` and both attempt to UPDATE `expires_at`. SQLAlchemy's default row-level locking for UPDATE statements means the second UPDATE will apply after the first commits — both will set `expires_at` to approximately `now + SESSION_DURATION` which is correct (idempotent). No deadlock risk: both updates target the same row, one wins, the other overwrites with an equivalent value.

**`verify_auth` is unchanged:** It still creates a new session on initial login. Only `restore_session` is changed.

**`create_session` in `auth_service.py`:** The existing `create_session` function remains unchanged (still used by `verify_auth`). A new `extend_session` function is added:

```python
async def extend_session(
    db: AsyncSession,
    session_record: SessionRecord,
) -> str:
    """Extend the expiry of an existing session and return a freshly signed token.

    The raw token in the DB is reused; only expires_at is updated.
    The returned signed token is re-signed with a fresh timestamp so that
    the client cookie max_age resets from now.
    """
    session_record.expires_at = datetime.now(UTC) + SESSION_DURATION
    await db.flush()
    return _sign_token(session_record.session_token)
```

**Round-trips before → after:**
- Before: `restore_session` issues 1 SELECT (session lookup) + 1 SELECT (meeting) + 5 queries in `_resolve_voter_state` + 1 SELECT (building) + 1 INSERT (new session) = 9 sequential round-trips
- After: same but the INSERT becomes an UPDATE on the already-loaded `session_record` object — SQLAlchemy tracks the dirty attribute and issues the UPDATE on `flush()`. Net saving: 0 additional round-trips (the INSERT and UPDATE are both 1 round-trip each), but the UPDATE is faster than an INSERT (no sequence generation, no unique index insertion) and avoids row proliferation.

The primary benefit is correctness and hygiene rather than a raw round-trip reduction. The round-trip reduction from improvements 1 and 2 are more impactful for throughput.

---

### Improvement 5: `tenant_config` module-level cache with TTL and invalidation

**File:** `backend/app/services/config_service.py`

**Current behaviour:**

Every call to `GET /api/config` (public, no auth) calls `config_service.get_config(db)` which executes:
```sql
SELECT * FROM tenant_config WHERE id = 1
```
This is a trivial indexed PK lookup, but it still occupies a Neon compute slot for the duration of the query. Under concurrent E2E load, with many workers each loading the app home page simultaneously, every page load fires this query.

**Constraint — Vercel Lambda architecture:** Each Vercel Lambda instance runs in its own process. A module-level cache is per-instance, not global. Two Lambda instances serving requests concurrently will each have their own cache. This is acceptable: the worst case is two instances each independently fetching the config from the DB once after their cache expires. The config is read-heavy and write-rare (only changes when an admin saves branding settings), so cache staleness is not a correctness concern — at worst a voter sees the old logo for up to `TTL` seconds after an admin saves new branding.

**Proposed approach — simple module-level TTL cache:**

```python
import time
from dataclasses import dataclass, field

_CACHE_TTL_SECONDS = 60  # 60-second TTL — config changes are rare

@dataclass
class _ConfigCache:
    value: TenantConfig | None = None
    expires_at: float = field(default_factory=lambda: 0.0)

_config_cache = _ConfigCache()


async def get_config(db: AsyncSession) -> TenantConfig:
    """Return the singleton config row (id=1), served from in-process cache when fresh.

    Cache TTL: 60 seconds. Invalidated on every call to update_config().
    """
    now = time.monotonic()
    if _config_cache.value is not None and now < _config_cache.expires_at:
        return _config_cache.value

    result = await db.execute(select(TenantConfig).where(TenantConfig.id == 1))
    config = result.scalar_one_or_none()
    if config is None:
        config = TenantConfig(
            id=1,
            app_name=_DEFAULT_APP_NAME,
            logo_url="",
            favicon_url=None,
            primary_colour=_DEFAULT_PRIMARY_COLOUR,
            support_email="",
        )
        db.add(config)
        await db.flush()
        await db.commit()
        await db.refresh(config)

    _config_cache.value = config
    _config_cache.expires_at = now + _CACHE_TTL_SECONDS
    return config


async def update_config(data: TenantConfigUpdate, db: AsyncSession) -> TenantConfig:
    """Upsert the singleton config row (id=1). Invalidates the in-process cache."""
    # ... existing upsert logic unchanged ...

    # Invalidate cache so the next get_config() call re-reads from DB
    _config_cache.value = None
    _config_cache.expires_at = 0.0

    return config
```

**Thread/coroutine safety:** Python's GIL means simple attribute assignment is atomic for CPython. The read-check-write of `_config_cache` is not atomic, but the worst case of a race is two coroutines both seeing a stale cache and both issuing a DB fetch — both populate the cache with the same value. This is harmless (no corrupted state, no incorrect data). No lock is needed.

**SQLAlchemy session scope:** The cached `TenantConfig` object must be detached from its session before caching, because SQLAlchemy `expire_on_commit=False` (set in `AsyncSessionLocal`) means the attributes remain accessible after commit. However, the cached object must not be associated with any live session to avoid `DetachedInstanceError`. The fix is to call `db.expunge(config)` before caching or to cache a plain Python dataclass/dict copy rather than the ORM object.

Recommended: cache the ORM object after expunging it from the session:

```python
db.expunge(config)
_config_cache.value = config
```

Since `expire_on_commit=False`, all attributes are still populated after expunge. The cached object is a detached, fully-populated `TenantConfig` instance with no live session reference — safe to return to any caller.

**Alternative: cache a Pydantic model.** The public config endpoint immediately calls `TenantConfigOut.model_validate(config)`. The cache could store the `TenantConfigOut` schema instance instead of the ORM object, making the cache cheaper to return (no ORM machinery, just a dict-like object). This would require a small change in `get_public_config` and `get_admin_config` to accept either an ORM object or a pre-validated schema — adds complexity. Stick with caching the detached ORM object.

**Invalidation on admin settings save:** `update_config` is the only write path for `tenant_config`. It already lives in `config_service.py`. The cache invalidation (`_config_cache.value = None`) is added at the end of `update_config`, after the DB commit, before returning. The next `get_config` call will fetch fresh data.

**Round-trips before → after:**
- Before: every `GET /api/config` request = 1 DB round-trip
- After: first request per Lambda instance per TTL window = 1 DB round-trip; all subsequent requests within TTL = 0 DB round-trips

Under E2E load with 10 parallel workers, each Lambda instance may handle 10+ requests in a 60-second window. The cache converts those 10+ queries into 1. Under production load with more requests per Lambda lifetime, the savings are larger.

---

## Database changes

None. All five improvements are query and in-process logic changes only.

---

## Backend changes

| Area | Change |
|---|---|
| `_resolve_voter_state` in `auth.py` | Extract queries 1+2 into `_load_direct_lot_owner_ids` and `_load_proxy_lot_owner_ids` helpers; fire via `asyncio.gather` with separate `AsyncSessionLocal` sessions |
| `list_motions` in `voting.py` | Reuse `_load_direct_lot_owner_ids` / `_load_proxy_lot_owner_ids` (move to shared module); remove dead meeting-existence check; derive `building_id` from `session.building_id` |
| `get_general_meeting_detail` in `admin_service.py` | For open meetings: replace full `Vote` object load with a lightweight `(motion_id, choice, lot_owner_id, motion_option_id)` projection; add SQL GROUP BY tally query joined with `agm_lot_weights` |
| `restore_session` in `auth.py` | Replace `create_session(...)` INSERT with `extend_session(...)` UPDATE on the existing `SessionRecord` |
| `extend_session` in `auth_service.py` | New function: updates `expires_at` on existing session, re-signs raw token, returns new signed token |
| `get_config` in `config_service.py` | Add module-level `_ConfigCache` dataclass; cache the detached ORM object for 60s; call `db.expunge(config)` before caching |
| `update_config` in `config_service.py` | Add cache invalidation (`_config_cache.value = None`) after DB commit |
| Shared helper location | Move `_load_direct_lot_owner_ids` and `_load_proxy_lot_owner_ids` to `app/services/auth_service.py` so both `auth.py` and `voting.py` can import them |

---

## Frontend changes

None. All changes are backend-only.

---

## Performance and Scalability

**Improvement 1 (`_resolve_voter_state`):**
- Before: 5 sequential round-trips on every `POST /api/auth/verify` and `POST /api/auth/session`
- After (phase 1): 4 wall-clock round-trips (1 gather + 3 sequential)
- After (phase 2, optional): 2 wall-clock round-trips (1 gather + 1 gather)
- Connection pool: phase 1 uses 2 extra connections briefly per request; phase 2 uses 4 extra. With `pool_size=20` and `max_overflow=10`, up to ~6 concurrent session restores in phase 2 before pool pressure. Phase 1 is the safe starting point.

**Improvement 2 (`list_motions`):**
- Before: 4 sequential round-trips (plus 1 for `get_session`)
- After: 3 wall-clock round-trips (1 meeting query eliminated via `session.building_id`, 1 gather, 2 sequential)
- No new connection pool pressure beyond what improvement 1 already introduces (same helpers)

**Improvement 3 (tally aggregation):**
- Round-trips: unchanged (still 1 query for votes)
- Data transfer: ~60% reduction (4 columns instead of 10 per row)
- Compute: eliminates O(V) Python iteration for the tally path; replaced by DB-side GROUP BY
- Only affects `GET /api/admin/agms/{id}` (admin-only, not a voter hot path) — lower urgency than improvements 1 and 2

**Improvement 4 (session extend):**
- Round-trips: same (1 SELECT + 1 UPDATE vs 1 SELECT + 1 INSERT)
- UPDATE on an already-loaded in-memory object is faster than an INSERT (no PK generation, no unique-index write)
- Eliminates row proliferation: each voter has at most 1 active session row instead of N (one per restore call)
- Cleanup job runs in less time

**Improvement 5 (config cache):**
- Before: 1 DB round-trip per public page load
- After: 0 DB round-trips within 60s TTL per Lambda instance
- Risk: config staleness up to 60s after admin saves; acceptable for branding data

---

## Security Considerations

**Improvement 4 (session extend):** The extended session re-uses the same raw token. The `_unsign_token` call at the top of `restore_session` already validates the itsdangerous signature — a tampered or expired signed token is rejected before the DB lookup. The raw token in the DB is never exposed to the client. The extended `expires_at` is server-controlled. No new attack surface.

**Improvement 5 (config cache):** The cached config contains only public branding data (app_name, logo_url, primary_colour, support_email) — no secrets, no auth data. Cache staleness on admin update is up to 60s and limited to branding presentation only. No security implication.

**Improvements 1, 2, 3:** Pure query changes, no change to auth or access control logic.

---

## Files to Change

| File | Change |
|---|---|
| `backend/app/routers/auth.py` | `_resolve_voter_state`: add `asyncio.gather` for queries 1+2 using helper coroutines; `restore_session`: replace `create_session` call with `extend_session` call |
| `backend/app/services/auth_service.py` | Add `extend_session` function; add `_load_direct_lot_owner_ids` and `_load_proxy_lot_owner_ids` helper coroutines (shared with voting router) |
| `backend/app/routers/voting.py` | `list_motions`: remove dead meeting-existence query; use `session.building_id`; import and use `_load_direct_lot_owner_ids` / `_load_proxy_lot_owner_ids` from `auth_service`; fire via `asyncio.gather` |
| `backend/app/services/admin_service.py` | `get_general_meeting_detail`: replace full-row `Vote` load with projected columns; add SQL GROUP BY tally query for open-meeting path |
| `backend/app/services/config_service.py` | Add `_ConfigCache` dataclass and `_config_cache` module-level instance; add cache read/write in `get_config`; add `db.expunge(config)` before caching; add cache invalidation in `update_config` |

---

## Test Cases

### Unit / Integration

**Improvement 1 (`_resolve_voter_state` parallelism):**
- Verify the function returns the same result with asyncio.gather as with sequential queries (existing test suite covers the return value contract)
- Verify a voter with only direct lots, only proxy lots, and both types all resolve correctly
- Verify that if one of the parallel session fetches raises an exception, it propagates correctly (asyncio.gather re-raises the first exception)

**Improvement 2 (`list_motions` — session.building_id):**
- Verify `list_motions` returns the same motions with the meeting query removed
- Verify that `session.building_id` is used correctly when the voter has lots in a building with multiple meetings

**Improvement 3 (SQL tally aggregation):**
- Verify tally counts (voter_count, entitlement_sum) match existing tests for yes/no/abstained/not_eligible
- Verify multi-choice per-option tallies are unchanged
- Verify the open-meeting path uses the aggregation query and the closed-meeting path uses snapshots
- Verify fallback path (no snapshot) works correctly

**Improvement 4 (session extend):**
- Verify `restore_session` returns a valid signed token after extending
- Verify the DB has exactly 1 `SessionRecord` per voter after multiple `POST /api/auth/session` calls (was N, now 1)
- Verify the extended `expires_at` is approximately `now + SESSION_DURATION`
- Verify `verify_auth` still creates a new session (not an extend)
- Verify a concurrent second call to `restore_session` with the same token succeeds (idempotent UPDATE)

**Improvement 5 (config cache):**
- Verify `get_config` returns the cached value on the second call without hitting the DB (mock DB, check call count)
- Verify the cache is invalidated after `update_config` is called
- Verify the cache TTL expires and a fresh DB read occurs after `_CACHE_TTL_SECONDS`
- Verify `db.expunge(config)` is called before caching so no `DetachedInstanceError` occurs on subsequent reads

### E2E

- Existing voter journey E2E specs (`POST /api/auth/verify` → vote → confirm) must pass unchanged — these are the primary regression signal for improvements 1, 2, and 4
- Existing admin meeting-detail spec must pass for both open and closed meetings — regression signal for improvement 3
- Public config endpoint (`GET /api/config`) must return correct branding data on every page load — regression signal for improvement 5
- No new E2E scenarios are required; the improvements are internal query changes with identical external API behaviour

---

## E2E Test Scenarios

The following existing persona journeys are affected by these changes:

| Persona | Journey touched | Why |
|---|---|---|
| Voter | `auth → lot selection → voting → confirmation` | `_resolve_voter_state` (improvement 1), `list_motions` (improvement 2), `restore_session` (improvement 4), `GET /api/config` (improvement 5) |
| Proxy voter | `proxy auth → proxied lots → voting → confirmation` | Same as voter; proxy lot resolution via `asyncio.gather` |
| In-arrear lot | `auth → lot with in-arrear badge → not_eligible → confirmation` | `_resolve_voter_state` returns `financial_position` for each lot; must still work after parallel fetch |
| Admin | `login → building/meeting management → report viewing → close meeting` | `get_general_meeting_detail` tally (improvement 3) |

**Existing E2E specs that must be verified (not just new scenarios added):**

- Voter happy path spec (OTP → verify → lot select → motion list → submit → confirm)
- Proxy voter spec (proxy auth → submit on behalf)
- In-arrear lot spec (not_eligible motion handling)
- Admin meeting-detail report spec (tally counts correct for open meeting)
- Admin meeting-detail report spec (tally counts correct for closed meeting, snapshot path)
- Public config / branding spec (logo, app name visible on voter page)

---

## Vertical Slice Decomposition

These five improvements are independent of each other and can be implemented in parallel on separate branches:

| Slice | Files touched | Branch dependency |
|---|---|---|
| Slice A: `_resolve_voter_state` parallelism | `auth.py`, `auth_service.py` | None |
| Slice B: `list_motions` + session.building_id | `voting.py`, `auth_service.py` | Depends on Slice A (shares helper functions extracted to `auth_service.py`) — must be sequential after A or combined with A |
| Slice C: Tally SQL aggregation | `admin_service.py` | None (independent) |
| Slice D: Session extend | `auth.py`, `auth_service.py` | None (independent of Slice A; both touch `auth.py` so combine with Slice A or implement after A merges) |
| Slice E: Config cache | `config_service.py` | None (fully independent) |

**Recommended ordering:**
1. Slice A + D together (both touch `auth.py` and `auth_service.py` — combine into one PR to avoid merge conflicts)
2. Slice B after Slice A merges (imports helpers from `auth_service.py`)
3. Slices C and E in parallel (fully independent)

---

## Schema Migration Required

No
