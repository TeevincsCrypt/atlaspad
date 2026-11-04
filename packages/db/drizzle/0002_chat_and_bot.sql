CREATE TABLE IF NOT EXISTS "bot_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nation_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"nation_id" integer NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nation_messages_nation_idx" ON "nation_messages" USING btree ("nation_id","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nation_messages_author_idx" ON "nation_messages" USING btree ("author","created_at");