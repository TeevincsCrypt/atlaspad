CREATE TABLE IF NOT EXISTS "nation_socials" (
	"nation_id" integer PRIMARY KEY NOT NULL,
	"x" text DEFAULT '' NOT NULL,
	"telegram" text DEFAULT '' NOT NULL,
	"website" text DEFAULT '' NOT NULL,
	"signer" text NOT NULL,
	"updated_at" bigint NOT NULL
);
