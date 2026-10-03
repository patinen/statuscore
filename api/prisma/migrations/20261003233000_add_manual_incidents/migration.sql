-- CreateEnum
CREATE TYPE "ManualIncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ManualIncidentImpact" AS ENUM ('DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE');

-- CreateTable
CREATE TABLE "ManualIncident" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "status" "ManualIncidentStatus" NOT NULL,
    "impact" "ManualIncidentImpact" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualIncidentMonitor" (
    "manualIncidentId" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualIncidentMonitor_pkey" PRIMARY KEY ("manualIncidentId","monitorId")
);

-- CreateTable
CREATE TABLE "ManualIncidentUpdate" (
    "id" UUID NOT NULL,
    "manualIncidentId" UUID NOT NULL,
    "status" "ManualIncidentStatus" NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ManualIncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualIncident_userId_createdAt_idx" ON "ManualIncident"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ManualIncident_userId_status_startedAt_idx" ON "ManualIncident"("userId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "ManualIncident_userId_resolvedAt_idx" ON "ManualIncident"("userId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ManualIncidentMonitor_monitorId_manualIncidentId_idx" ON "ManualIncidentMonitor"("monitorId", "manualIncidentId");

-- CreateIndex
CREATE INDEX "ManualIncidentUpdate_manualIncidentId_createdAt_idx" ON "ManualIncidentUpdate"("manualIncidentId", "createdAt");

-- AddForeignKey
ALTER TABLE "ManualIncident" ADD CONSTRAINT "ManualIncident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualIncidentMonitor" ADD CONSTRAINT "ManualIncidentMonitor_manualIncidentId_fkey" FOREIGN KEY ("manualIncidentId") REFERENCES "ManualIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualIncidentMonitor" ADD CONSTRAINT "ManualIncidentMonitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualIncidentUpdate" ADD CONSTRAINT "ManualIncidentUpdate_manualIncidentId_fkey" FOREIGN KEY ("manualIncidentId") REFERENCES "ManualIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
