ALTER TABLE "import_batches" ADD COLUMN "import_mode" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batches" ADD COLUMN "sample_limit" integer;--> statement-breakpoint
UPDATE "import_batches"
SET "import_mode" = 'sample', "sample_limit" = 1000
WHERE "status" = 'complete'
  AND "source_filename" IN ('reports_oct1_2019.tar.gz', 'reports_nov1_2026.tar.gz')
  AND "source_records" BETWEEN 1 AND 1000;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_mode_check" CHECK ("import_batches"."import_mode" in ('full', 'sample'));--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_sample_limit_check" CHECK (("import_batches"."import_mode" = 'full' and "import_batches"."sample_limit" is null) or ("import_batches"."import_mode" = 'sample' and "import_batches"."sample_limit" > 0));
