-- Extend notification event types with manual incident lifecycle events.
ALTER TYPE "NotificationDeliveryEventType" ADD VALUE IF NOT EXISTS 'MANUAL_INCIDENT_OPENED';
ALTER TYPE "NotificationDeliveryEventType" ADD VALUE IF NOT EXISTS 'MANUAL_INCIDENT_UPDATED';
ALTER TYPE "NotificationDeliveryEventType" ADD VALUE IF NOT EXISTS 'MANUAL_INCIDENT_RESOLVED';

-- Add manual incident source references and immutable snapshots.
ALTER TABLE "NotificationDelivery"
  ALTER COLUMN "incidentId" DROP NOT NULL,
  ADD COLUMN "manualIncidentId" UUID,
  ADD COLUMN "manualIncidentUpdateId" UUID,
  ADD COLUMN "occurredAt" TIMESTAMP(3),
  ADD COLUMN "incidentTitleSnapshot" VARCHAR(150),
  ADD COLUMN "incidentImpactSnapshot" "ManualIncidentImpact",
  ADD COLUMN "incidentStatusSnapshot" "ManualIncidentStatus",
  ADD COLUMN "updateMessageSnapshot" VARCHAR(2000),
  ADD COLUMN "monitorNamesSnapshot" JSONB,
  ADD COLUMN "payloadSnapshot" JSONB;

-- Existing rows remain valid and retain historical timestamps.
UPDATE "NotificationDelivery"
SET "occurredAt" = COALESCE("occurredAt", "createdAt")
WHERE "occurredAt" IS NULL;

-- Keep automatic uniqueness and add manual update idempotency uniqueness.
CREATE UNIQUE INDEX "NotificationDelivery_channelId_manualIncidentUpdateId_eventType_key"
  ON "NotificationDelivery"("channelId", "manualIncidentUpdateId", "eventType");

-- At most one source type can be referenced; rows with deleted manual sources are allowed via null references.
ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_single_source_check"
  CHECK (
    ("incidentId" IS NOT NULL AND "manualIncidentId" IS NULL)
    OR ("incidentId" IS NULL AND "manualIncidentId" IS NOT NULL)
    OR ("incidentId" IS NULL AND "manualIncidentId" IS NULL)
  );

CREATE INDEX "NotificationDelivery_manualIncidentId_idx" ON "NotificationDelivery"("manualIncidentId");
CREATE INDEX "NotificationDelivery_manualIncidentUpdateId_idx" ON "NotificationDelivery"("manualIncidentUpdateId");

ALTER TABLE "NotificationDelivery"
  ADD CONSTRAINT "NotificationDelivery_manualIncidentId_fkey"
    FOREIGN KEY ("manualIncidentId") REFERENCES "ManualIncident"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "NotificationDelivery_manualIncidentUpdateId_fkey"
    FOREIGN KEY ("manualIncidentUpdateId") REFERENCES "ManualIncidentUpdate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
