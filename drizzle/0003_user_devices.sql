CREATE TABLE "user_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"device_type" text NOT NULL,
	"cpu" text,
	"gpu" text,
	"gpu_vendor" text,
	"ram" text,
	"distribution" text,
	"kernel" text,
	"graphics_driver" text,
	"gpu_driver_detail" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_devices_type_check" CHECK ("user_devices"."device_type" in ('linux_desktop', 'steam_deck')),
	CONSTRAINT "user_devices_gpu_vendor_check" CHECK ("user_devices"."gpu_vendor" is null or "user_devices"."gpu_vendor" in ('NVIDIA', 'AMD', 'Intel', 'Apple', 'Multiple', 'Unknown'))
);
--> statement-breakpoint
ALTER TABLE "native_reports" ADD COLUMN "gpu_driver_detail" text;--> statement-breakpoint
ALTER TABLE "native_reports" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "native_reports" ADD COLUMN "device_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_devices_user_created_idx" ON "user_devices" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_devices_one_default_per_user_idx" ON "user_devices" USING btree ("user_id") WHERE "user_devices"."is_default";--> statement-breakpoint
ALTER TABLE "native_reports" ADD CONSTRAINT "native_reports_device_id_user_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."user_devices"("id") ON DELETE set null ON UPDATE no action;