CREATE TABLE "cleaning_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"user_id" text NOT NULL,
	"recipe" jsonb NOT NULL,
	"base_revision" integer NOT NULL,
	"result_revision" integer,
	"preview_summary" jsonb,
	"before_profile" jsonb,
	"after_profile" jsonb,
	"status" text DEFAULT 'previewed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"applied_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "data_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "profile_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "profile_status" text DEFAULT 'fresh' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "profiled_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "cleaning_runs" ADD CONSTRAINT "cleaning_runs_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cleaning_runs" ADD CONSTRAINT "cleaning_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cleaning_run_ds_idx" ON "cleaning_runs" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "cleaning_run_user_idx" ON "cleaning_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cleaning_run_created_idx" ON "cleaning_runs" USING btree ("created_at" DESC NULLS LAST);