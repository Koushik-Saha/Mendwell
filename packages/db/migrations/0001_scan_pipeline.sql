CREATE TABLE "uptime_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"up" boolean NOT NULL,
	"status" integer,
	"ms" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Backfill-safe: existing rows get a unique legacy key, then the default is dropped (schema has none).
ALTER TABLE "alerts" ADD COLUMN "dedupe_key" text NOT NULL DEFAULT ('legacy:' || gen_random_uuid()::text);--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "dedupe_key" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "progress" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scans" ADD COLUMN "trigger_run_id" text;--> statement-breakpoint
ALTER TABLE "uptime_checks" ADD CONSTRAINT "uptime_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_checks" ADD CONSTRAINT "uptime_checks_site_fk" FOREIGN KEY ("site_id","org_id") REFERENCES "public"."sites"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uptime_checks_org_id_idx" ON "uptime_checks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "uptime_checks_site_checked_idx" ON "uptime_checks" USING btree ("site_id","checked_at");--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_dedupe_unique" UNIQUE("site_id","dedupe_key");