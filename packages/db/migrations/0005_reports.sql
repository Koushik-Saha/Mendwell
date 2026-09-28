CREATE TABLE "report_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"category" "fix_category" NOT NULL,
	"vote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_feedback_report_category_unique" UNIQUE("report_id","category"),
	CONSTRAINT "report_feedback_vote" CHECK ("report_feedback"."vote" in ('up', 'down'))
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "period_key" text;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_id_org_unique" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "report_feedback" ADD CONSTRAINT "report_feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_feedback" ADD CONSTRAINT "report_feedback_report_fk" FOREIGN KEY ("report_id","org_id") REFERENCES "public"."reports"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_feedback_org_id_idx" ON "report_feedback" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_site_period_unique" ON "reports" USING btree ("site_id","period_key") WHERE "reports"."site_id" is not null and "reports"."period_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_digest_period_unique" ON "reports" USING btree ("org_id","period_key") WHERE "reports"."site_id" is null and "reports"."period_key" is not null;