-- CreateTable
CREATE TABLE "MaintenanceWindow" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceWindowMonitor" (
    "maintenanceWindowId" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceWindowMonitor_pkey" PRIMARY KEY ("maintenanceWindowId","monitorId")
);

-- CreateIndex
CREATE INDEX "MaintenanceWindow_userId_createdAt_idx" ON "MaintenanceWindow"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceWindow_enabled_startsAt_endsAt_idx" ON "MaintenanceWindow"("enabled", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "MaintenanceWindowMonitor_monitorId_maintenanceWindowId_idx" ON "MaintenanceWindowMonitor"("monitorId", "maintenanceWindowId");

-- AddForeignKey
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindowMonitor" ADD CONSTRAINT "MaintenanceWindowMonitor_maintenanceWindowId_fkey" FOREIGN KEY ("maintenanceWindowId") REFERENCES "MaintenanceWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindowMonitor" ADD CONSTRAINT "MaintenanceWindowMonitor_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
