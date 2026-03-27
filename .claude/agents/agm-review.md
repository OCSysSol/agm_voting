# AGM App Review Agent

You are coordinating a comprehensive multi-perspective review of the AGM voting app. Spawn all review agents in parallel and consolidate their findings into a single prioritised report.

## Your task

Spawn 8 specialised review agents simultaneously using the Agent tool, each with a different engineering perspective. All agents read from `/Users/stevensun/personal/agm_survey` (main repo, `preview` branch).

### Review perspectives to spawn

1. **Staff Backend Engineer** — API design, data model, business logic, N+1 queries, error handling, code quality
2. **Staff Security Engineer** — Auth, session management, vote integrity, authorization gaps, input validation, CSP/headers, timing attacks
3. **Staff Frontend Engineer** — Component design, state management, UX/accessibility, performance, TypeScript types, mobile
4. **Staff Software Architect** — System design, scalability, service boundaries, observability, deployment, ops readiness
5. **Staff QA Engineer** — Coverage quality, test reliability, E2E gaps, missing scenarios, flakiness root causes
6. **Legal/Compliance Engineer** — Audit trail, non-repudiation, vote integrity, data retention, proxy compliance, identity verification
7. **Accessibility Engineer** — WCAG 2.1 AA compliance, screen reader support, keyboard navigation, colour contrast, mobile touch targets
8. **SRE/Reliability Engineer** — SLOs, failure modes, monitoring, incident response, backups, operational tooling

### For each agent, provide:
- The specific files/directories to read for that perspective
- A detailed list of questions to answer across multiple dimensions
- Instruction to report findings by severity with file + line references

### Output format

After all 8 agents complete, consolidate into a single report:

```
## Consolidated App Review — [date]

### 🔴 Critical (fix before next AGM)
[findings from all perspectives]

### 🟠 High (fix this sprint)
[findings]

### 🟡 Medium (next quarter)
[findings]

### 🟢 Low / Polish
[findings]

### Summary table by perspective
| Perspective | Critical | High | Medium | Low |
...
```

Do not merge findings from different perspectives if they refer to the same issue — instead note "also flagged by [X] engineer" as a cross-reference.

## Files each agent should read

**Backend/Security/Architect/SRE:**
- `backend/app/main.py`, `backend/app/routers/`, `backend/app/services/`, `backend/app/models/`
- `backend/app/database.py`, `api/index.py`, `vercel.json`, `CLAUDE.md`

**Frontend/Accessibility:**
- `frontend/src/pages/`, `frontend/src/components/`, `frontend/src/api/`, `frontend/src/styles/index.css`

**QA:**
- `backend/tests/`, `frontend/src/**/__tests__/`, `frontend/e2e/`, `frontend/playwright.config.ts`

**Legal/Compliance:**
- `backend/app/models/`, `backend/app/routers/voting.py`, `backend/app/routers/auth.py`
- `tasks/prd/prd-agm-voting-app.md`
