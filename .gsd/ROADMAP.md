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
- [x] Quick Drop driverName stored and retained (Bug 6)
- [x] `/accept-passenger` and `/reject-passenger` work on in_progress rides (Bug 7)
- [x] `my-trips` shows paid passenger rides and all Quick Drop rides (Bug 8)

## Phases

### Phase 1: Critical Ride Lifecycle Bug Fixes
**Status**: ✅ Complete
**Objective**: Fix all 8 critical bugs blocking driver phase navigation, map routing, passenger session restore, and trip history.
**Files changed**: `backend/index.js`, `frontend/script.js`

### Phase 2: Stability & Polish
**Status**: ⬜ Not Started
**Objective**: Address tech debt — Quick Drop fare, trip history missing QD rides, rate limiting, input validation

### Phase 3: Testing & Monitoring
**Status**: ⬜ Not Started
**Objective**: Add basic automated tests, structured logging, error tracking
