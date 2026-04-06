-- CreateEnum
CREATE TYPE "RegionLevel" AS ENUM ('province', 'regency', 'district');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('tokopedia', 'shopee', 'grabfood', 'gofood', 'lazada', 'blibli');

-- CreateEnum
CREATE TYPE "ScrapeStatus" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'staff');

-- CreateTable
CREATE TABLE "Region" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "RegionLevel" NOT NULL,
    "parentId" INTEGER,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "regionId" INTEGER NOT NULL,
    "platform" "Platform" NOT NULL,
    "totalMerchants" INTEGER NOT NULL DEFAULT 0,
    "status" "ScrapeStatus" NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ScrapeSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'staff',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE INDEX "Region_code_level_idx" ON "Region"("code", "level");

-- CreateIndex
CREATE INDEX "Region_parentId_idx" ON "Region"("parentId");

-- CreateIndex
CREATE INDEX "ScrapeSession_userId_idx" ON "ScrapeSession"("userId");

-- CreateIndex
CREATE INDEX "ScrapeSession_regionId_idx" ON "ScrapeSession"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeSession" ADD CONSTRAINT "ScrapeSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeSession" ADD CONSTRAINT "ScrapeSession_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
