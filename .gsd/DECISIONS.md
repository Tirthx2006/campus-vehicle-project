# DECISIONS.md — Architecture Decision Records

> Auto-created by /new-project on 2026-04-14

## ADR-001: Quick Drop passengers distinguished by checking QuickRequest collection on refresh

**Date:** 2026-04-14  
**Status:** Accepted

**Context:** `/my-ride-status` only queried the `Ride` collection. Quick Drop passengers store a `QuickRequest._id` as their `passengerActiveRide`, which doesn't exist in `Ride`. This caused `driver_ended` to be returned and passengers were incorrectly kicked out on refresh.

**Decision:** `/my-ride-status` now tries `Ride.findById` first; on null result, tries `QuickRequest.findById`. Both are guarded with `.catch(() => null)` so a malformed ID won't throw a 500.

**Consequences:** Quick Drop passengers survive page refresh. No schema changes needed.

---

## ADR-002: `showPage()` allowlist expanded for driver mission phases

**Date:** 2026-04-14  
**Status:** Accepted

**Context:** The `isMissionActive` guard blocked all pages except `driver-command-center` and `profile`. This prevented the driver from progressing through `driver-picking-up`, `driver-ride-started`, and `driver-payment` — the driver was completely stuck.

**Decision:** Added an explicit `driverMissionPages` allowlist. Internal driver workflow navigation is always permitted; only passenger tabs and navigation to `home`/`about`/etc. are blocked during an active mission.

---

## ADR-003: Departure coordinates stored in RideSchema and forwarded to passenger

**Date:** 2026-04-14  
**Status:** Accepted

**Context:** `passengerRideDepartureLat/Lng` was read in the passenger map logic but never written. The backend never sent departure coords. Passengers always saw only a destination dot.

**Decision:** Added `fromLat: Number, fromLng: Number` to `RideSchema`. `/publish-route` accepts and stores them from the frontend. `/accept-passenger` includes them in the `ride_accepted` socket event. `/my-ride-status` returns them for refresh restore. Frontend stores them in localStorage on both `ride_accepted` and boot restore path.

---

## ADR-004: GPS-denied fallback uses typed departure city, not destination

**Date:** 2026-04-14  
**Status:** Accepted

**Context:** When GPS permission is denied in `publishRoute()`, the fallback origin was `{ lat: destLat, lng: destLng }` — OSRM routing from A→A produces no route. On refresh, `CAMPUS_COORDS` was always used as origin regardless of the actual departure location.

**Decision:** GPS-denied fallback priority: GPS position → `chosenFromPlace` coords → `CAMPUS_COORDS`. Departure coords are persisted to `activeMissionFromLat/Lng` in localStorage so the correct origin is used on refresh.
