# Archived issues: TIMSInternational/climate-tracking

Frozen snapshot taken before the migration tracker was consolidated into
`organizational-climate-platform`. The original issues were deleted after this
archive was committed. Numbers below refer to the ORIGINAL repo numbering.

Total: 2 issues

---

## #2 — bug: HallazgoCache is never populated — dead code path in CacheSyncWorker

- **State:** OPEN
- **Labels:** bug
- **Author:** tafurfede
- **Created:** 2026-07-30T16:52:11Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-tracking/issues/2

## Background
`CacheSyncWorker` polls nodos/personas/ciclos every 15 min but never syncs `HallazgoCache` — this is documented in-code (`CacheSyncWorker.cs:13-16`: "KNOWN GAP: HallazgoCache is not populated by this worker or by anything else in this PR... never wired up — IClimateProjectClient.GetHallazgosAsync exists but is currently unused.").

## Impact
- `IClimateProjectClient.GetHallazgosAsync` is defined but dead code.
- `PlanesAccionEndpoints.CreateAsync`'s optional hallazgo→ciclo lookup silently finds nothing until this is built.

## What's needed
Wire up hallazgo syncing in `CacheSyncWorker` (or a dedicated worker) against climate-project's `/internal/hallazgos` endpoint, matching the existing nodos/personas/ciclos sync pattern.

## Related
climate-project#16 (`resultado_anio_anterior_pct` always null) is a related but distinct gap in the same `/internal/hallazgos` data — that one is a missing prior-year Benchmark schema linkage, not a sync-worker gap.

---

## #3 — tech-debt: GeneratePlanCodeAsync has an accepted race window under concurrent plan creation

- **State:** OPEN
- **Labels:** tech-debt
- **Author:** tafurfede
- **Created:** 2026-07-30T16:52:13Z  **Closed:** -
- **Original URL:** https://github.com/TIMSInternational/climate-tracking/issues/3

## Background
`PlanesAccionEndpoints.cs`'s sequential per-year plan-code numbering has a documented (accepted-at-the-time) race window under concurrent plan creation — see the comment at `PlanesAccionEndpoints.cs:62`: "Sequential per-year numbering has a known race window under concurrent...".

## What's needed
Either add a DB-level uniqueness constraint + retry-on-conflict, or move numbering to an atomic sequence/counter, to close the race window. Low priority — flag if concurrent plan creation ever becomes a realistic scenario (e.g. multiple leaders in the same node creating plans simultaneously).

---

