# ROADMAP.md

> **Current Phase**: Phase 1 ✅ Complete
> **Milestone**: v1.1 — Ride Lifecycle Bug Fixes

## Must-Haves (from SPEC)

- [x] Command Center map shows correct A→B route (Bug 1)
- [x] Driver phase navigation unblocked (Bug 3)
- [x] cmd-action-btn onclick restored on refresh (Bug 4)
- [x] `/arrive-passenger` works on in_progress rides (Bug 2b)
- [x] Quick Drop passenger refresh handled correctly (Bug 2a)
- [x] Departure coords forwarded to passenger map (Bug 5)

## Phases

### Phase 1: Critical Ride Lifecycle Bug Fixes
**Status**: ✅ Complete
**Objective**: Fix all 5 critical bugs blocking driver phase navigation, map routing, and passenger session restore
**Files changed**: `backend/index.js`, `frontend/script.js`

### Phase 2: Stability & Polish
**Status**: ⬜ Not Started
**Objective**: Address tech debt — Quick Drop fare, trip history missing QD rides, rate limiting, input validation

### Phase 3: Testing & Monitoring
**Status**: ⬜ Not Started
**Objective**: Add basic automated tests, structured logging, error tracking
