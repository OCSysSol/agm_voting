# QA Gap Review (US-TCG-06)

Living document tracking known test scenarios that have no or incomplete coverage.
Reviewed: 2026-03-31.

## Legend

| Status | Meaning |
|--------|---------|
| Not implemented | No test at any level |
| Partial | Covered at one level but not all three |
| Complete | Unit + integration + E2E all pass |

---

## 1. Motion visibility toggle — edge cases

| Scenario | Level | Status | Priority |
|---|---|---|---|
| Show hidden motion (success) | Unit + Integration | Complete | P0 |
| Hide visible motion without votes (success) | Unit + Integration | Complete | P0 |
| Hide visible motion with submitted votes (409) | Unit + Integration | Complete | P0 |
| Toggle on closed meeting (409) | Unit + Integration | Complete | P0 |
| Motion not found (404) | Unit + Integration | Complete | P0 |
| Motion belonging to a different building context | Integration | Not implemented | P2 — no meeting-scoping in endpoint |
| Frontend: optimistic update on click | Unit | Complete | P0 |
| Frontend: revert on API error | Unit | Complete | P0 |
| E2E: toggle visibility affects voter view | E2E | Not implemented | P1 |

---

## 2. Concurrent ballot submission

| Scenario | Level | Status | Priority |
|---|---|---|---|
| Two simultaneous submits — one succeeds, one 409 | Integration | Complete (TestConcurrentBallotSubmission) | P0 |
| DB contains exactly one BallotSubmission after race | Integration | Complete | P0 |
| E2E: concurrent submit race | E2E | Not implemented | P2 — hard to reproduce in E2E reliably |

---

## 3. Email failure during AGM close

| Scenario | Level | Status | Priority |
|---|---|---|---|
| Meeting closes successfully when email fails | Integration | Complete (TestEmailFailureDuringClose) | P1 |
| EmailDelivery created with status=pending on close | Integration | Complete | P1 |
| Status transitions to failed after max attempts | Integration | Complete | P1 |
| resend-report transitions failed delivery to pending | Integration | Complete | P1 |
| Error is logged server-side (not exposed to client) | Unit (middleware) | Complete | P1 |
| E2E: admin sees email failure banner after close | E2E | Not implemented | P1 |

---

## 4. Closed meeting auth flow

| Scenario | Level | Status | Priority |
|---|---|---|---|
| Voter authenticates against closed meeting via OTP | Integration | Complete (test_verify_closed_agm) | P1 |
| Auth returns agm_status="closed" | Integration | Complete | P1 |
| Non-submitter routed to confirmation (not blocked) | E2E | Complete (TCG04-1) | P1 |
| Submitter routed to confirmation showing ballot | E2E | Complete (TCG04-2) | P1 |
| Session restore on closed meeting returns 401 | Integration | Complete | P1 |

---

## 5. Lot owner list N+1 performance

| Scenario | Level | Status | Priority |
|---|---|---|---|
| list_lot_owners uses batch query (no N+1) | Integration | Complete (TestListLotOwnersBatch) | P2 |
| Performance under 100+ lot owners | E2E | Not implemented | P2 |

---

## 6. Rate limiting

| Scenario | Level | Status | Priority |
|---|---|---|---|
| Ballot submit: 429 on 11th request/min per email | Unit | Complete (TestRateLimiter) | P1 |
| Public buildings: 429 on 61st request/min per IP | Unit | Complete | P1 |
| Rate limit headers in 429 response | Unit | Complete | P1 |
| Integration: 429 returned to HTTP client | Integration | Not implemented | P2 |
| E2E: rate limit smoke test | E2E | Not implemented | P2 |

---

## 7. File upload size limits

| Scenario | Level | Status | Priority |
|---|---|---|---|
| Import rejects files over 5 MB (413) | Integration | Not implemented | P2 |
| Logo upload rejects files over 5 MB (413) | Integration | Not implemented (existing test covers 400) | P2 |

---

## 8. Partial vote re-submission after session expiry

| Scenario | Level | Status | Priority |
|---|---|---|---|
| Submit partial votes, expire session, re-auth, re-submit | Integration | Complete (RR3-30) | P1 |
| Motion 1 not duplicated after re-submit | Integration | Complete | P1 |
| Motion 2 added correctly | Integration | Complete | P1 |
| E2E: end-to-end partial re-submission flow | E2E | Not implemented | P2 |

---

## 9. OTP expiry

| Scenario | Level | Status | Priority |
|---|---|---|---|
| OTP expires within 10 minutes | Unit (config) | Complete — OTP_EXPIRY_MINUTES=10 verified | P1 |
| Expired OTP returns 401 | Integration | Complete | P1 |
| Re-request OTP after expiry succeeds | Integration | Complete | P2 |

---

## 10. VotingPage building search error state

| Scenario | Level | Status | Priority |
|---|---|---|---|
| All building queries return empty (meeting not found) | Unit | Complete (RR3-27) | P1 |
| All building queries fail with errors | Unit | Complete | P1 |
| Error state shows user-friendly message | Unit | Complete | P1 |
| E2E: actual network error triggers error state | E2E | Not implemented | P2 |

---

## 11. Known gaps requiring future work

- **E2E: rate limiting** — in-memory limiters are per-process and reset between Lambda invocations; E2E tests cannot reliably trigger the limit in a single test run.
- **E2E: motion visibility toggle affects voter** — would require a multi-actor test (admin hides motion, voter sees it disappear in real time).
- **E2E: email failure banner** — admin UI must show email delivery status after close; no E2E coverage yet.
- **Performance: lot owner list under load** — no load test at any level.
