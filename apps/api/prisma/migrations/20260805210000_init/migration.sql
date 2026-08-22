-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "resource" TEXT,
    "resourceId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "includes" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "preset" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UpdateCheckCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "containerId" TEXT NOT NULL,
    "containerName" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "currentDigest" TEXT,
    "remoteDigest" TEXT,
    "updateAvailable" BOOLEAN NOT NULL DEFAULT false,
    "registry" TEXT NOT NULL,
    "currentTag" TEXT NOT NULL,
    "error" TEXT,
    "checkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LifetimeStats" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "trackingSince" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "samplesCount" INTEGER NOT NULL DEFAULT 0,
    "peakCpuPercent" REAL NOT NULL DEFAULT 0,
    "peakMemoryPercent" REAL NOT NULL DEFAULT 0,
    "peakDiskPercent" REAL NOT NULL DEFAULT 0,
    "sumCpuPercent" REAL NOT NULL DEFAULT 0,
    "sumMemoryPercent" REAL NOT NULL DEFAULT 0,
    "sumDiskPercent" REAL NOT NULL DEFAULT 0,
    "containerStarts" INTEGER NOT NULL DEFAULT 0,
    "containerStops" INTEGER NOT NULL DEFAULT 0,
    "containerDies" INTEGER NOT NULL DEFAULT 0,
    "containerRestarts" INTEGER NOT NULL DEFAULT 0,
    "maxContainersSeen" INTEGER NOT NULL DEFAULT 0,
    "lastSampleAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateCheckCache_containerId_key" ON "UpdateCheckCache"("containerId");

