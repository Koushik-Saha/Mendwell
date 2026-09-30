-- Before the index: if a site has several scans queued/running (left behind by lost runs), keep the newest and fail the rest.
UPDATE "scans" SET "status" = 'failed', "error" = 'stale', "finished_at" = now()
WHERE "site_id" IS NOT NULL AND "status" IN ('queued', 'running')
  AND "id" NOT IN (SELECT DISTINCT ON ("site_id") "id" FROM "scans" WHERE "site_id" IS NOT NULL AND "status" IN ('queued', 'running') ORDER BY "site_id", "created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX "scans_site_in_flight_unique" ON "scans" USING btree ("site_id") WHERE "scans"."status" in ('queued', 'running');
