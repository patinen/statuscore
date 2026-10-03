-- Add snapshot columns for notification delivery ownership and channel metadata.
ALTER TABLE "NotificationDelivery"
  ADD COLUMN "userId" UUID,
  ADD COLUMN "channelName" VARCHAR(100),
  ADD COLUMN "channelType" "NotificationChannelType";

-- Backfill delivery ownership from the associated channel when it still exists.
UPDATE "NotificationDelivery" nd
SET
  "userId" = c."userId",
  "channelName" = c."name",
  "channelType" = c."type"
FROM "NotificationChannel" c
WHERE nd."channelId" = c."id";

-- Fill any orphaned rows from the parent incident's monitor owner so delivery history remains complete.
UPDATE "NotificationDelivery" nd
SET "userId" = m."userId"
FROM "Incident" i
JOIN "Monitor" m ON m."id" = i."monitorId"
WHERE nd."incidentId" = i."id"
  AND nd."userId" IS NULL;

-- The delivery history must retain a valid owner after backfill.
ALTER TABLE "NotificationDelivery"
  ALTER COLUMN "userId" SET NOT NULL;

-- Add the composite index required for user-scoped delivery queries and retry scheduling.
CREATE INDEX "NotificationDelivery_userId_status_nextAttemptAt_idx"
  ON "NotificationDelivery"("userId", "status", "nextAttemptAt");
