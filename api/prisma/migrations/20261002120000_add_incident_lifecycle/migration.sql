-- Ensure only one unresolved incident can exist for a monitor at a time.
CREATE UNIQUE INDEX "Incident_monitorId_active_unique"
ON "Incident" ("monitorId")
WHERE "resolvedAt" IS NULL;

-- Support efficient active-incident lookups and ordering.
CREATE INDEX "Incident_monitorId_resolvedAt_idx"
ON "Incident" ("monitorId", "resolvedAt");
