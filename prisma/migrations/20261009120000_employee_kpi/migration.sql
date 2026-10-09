-- CreateTable
CREATE TABLE "EmployeeKpi" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "rating" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeKpi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeKpi_period_idx" ON "EmployeeKpi"("period");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeKpi_userId_period_key" ON "EmployeeKpi"("userId", "period");

-- AddForeignKey
ALTER TABLE "EmployeeKpi" ADD CONSTRAINT "EmployeeKpi_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
