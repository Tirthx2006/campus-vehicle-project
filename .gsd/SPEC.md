# SPEC.md — Project Specification

> **Status**: `FINALIZED`

## Vision

Campus Vehicle is a real-time ride-sharing platform for Ganpat University students. The platform connects campus drivers with passengers through two modes: **Quick Drop** (short on-campus hops) and **Route Share** (long-distance rides with seat-sharing and fare-splitting). The system uses Socket.io for zero-latency coordination and Leaflet + OSRM for open-source map routing.

The current objective is to eliminate critical lifecycle bugs that prevent drivers from progressing through phases and cause passengers to be incorrectly kicked out of active rides.

## Goals

1. Fix all 5 critical ride lifecycle bugs blocking core driver and passenger flows
2. Ensure Command Center map always shows a meaningful A→B route
3. Ensure passenger refresh never incorrectly terminates an in-progress session
4. Ensure driver can progress through all mission phases without being blocked

## Non-Goals (Out of Scope)

- New features (auth, payments, social login)
- Codebase restructuring or file splitting
- Test infrastructure
- UI redesign

## Users

- **Drivers**: Ganpat University students with vehicles who publish routes or offer quick drops
- **Passengers**: Students who book seats on published routes or request campus drops

## Constraints

- No build step — vanilla HTML/CSS/JS frontend
- Single-file backend (index.js)
- Deployed on Render.com (backend) + Cloudflare (frontend)

## Success Criteria

- [ ] Command Center map shows A→B route using departure city, not destination-as-origin
- [ ] Driver refresh restores correct map origin (not CAMPUS_COORDS for intercity routes)
- [ ] Driver can press "Proceed to Pickup Phase" without being blocked
- [ ] Driver can press "Start Trajectory" → navigates to Journey In Progress
- [ ] After page refresh with in_progress status, action button onclick is correct
- [ ] `/arrive-passenger` succeeds even when ride status is `in_progress`
- [ ] Quick Drop passenger refresh does not show "ride ended" incorrectly
- [ ] Passenger sees a route line (not just a destination dot) after driver accepts
