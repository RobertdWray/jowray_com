-- CreateIndex (foreign key column; Postgres does not index it automatically)
CREATE INDEX "Media_memoryId_idx" ON "Media"("memoryId");
