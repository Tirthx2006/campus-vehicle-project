# STATE.md — Project Memory

> Last updated: 2026-04-14

## Current Status

Codebase mapping complete. Project initialized.

## Last Session Summary

Codebase mapping complete via `/map`.
- 5 components identified (backend server, frontend SPA, 3 MongoDB collections)
- 7 production dependencies analyzed
- 12 technical debt items found
- No tests exist

## Active Context

- No active phase
- Run `/new-project` → questioning phase next to formally capture SPEC

## Key Decisions Made

- Real-time architecture: Socket.io event-push (no polling)
- Auth: JWT Bearer (localStorage) + emergency query-param variant for sendBeacon
- Maps: Leaflet + Nominatim + OSRM (fully open-source, no API keys)
- Deployment: Render.com (backend) + Cloudflare static (frontend)

## Blockers / Risks

- Backend is a single monolithic file (1015 lines) — hard to extend cleanly
- No automated tests — makes refactoring risky
- Quick Drop fare hardcoded at ₹10
- Trip history missing Quick Drop rides
