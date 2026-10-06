CREATE TABLE "excluded_addresses" (
	"address" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_action_events" (
	"proposal_id" integer PRIMARY KEY NOT NULL,
	"nation_id" integer NOT NULL,
	"action" integer NOT NULL,
	"arg" numeric(78, 0) NOT NULL,
	"text" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_actions" (
	"proposal_id" integer PRIMARY KEY NOT NULL,
	"nation_id" integer NOT NULL,
	"action" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"applied_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_alliance_invites" (
	"alliance_id" integer NOT NULL,
	"nation_id" integer NOT NULL,
	"invited_at" bigint NOT NULL,
	"proposal_id" integer NOT NULL,
	CONSTRAINT "game_alliance_invites_alliance_id_nation_id_pk" PRIMARY KEY("alliance_id","nation_id")
);
--> statement-breakpoint
CREATE TABLE "game_alliance_members" (
	"alliance_id" integer NOT NULL,
	"nation_id" integer NOT NULL,
	"joined_at" bigint NOT NULL,
	"left_at" bigint,
	CONSTRAINT "game_alliance_members_alliance_id_nation_id_joined_at_pk" PRIMARY KEY("alliance_id","nation_id","joined_at")
);
--> statement-breakpoint
CREATE TABLE "game_alliances" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"leader_id" integer NOT NULL,
	"created_at" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"dissolved_at" bigint
);
--> statement-breakpoint
CREATE TABLE "game_buildings" (
	"id" serial PRIMARY KEY NOT NULL,
	"nation_id" integer NOT NULL,
	"type" integer NOT NULL,
	"status" text NOT NULL,
	"proposal_id" integer NOT NULL,
	"started_at" bigint NOT NULL,
	"completes_at" bigint NOT NULL,
	"completed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "game_citizen_achievements" (
	"address" text NOT NULL,
	"code" text NOT NULL,
	"nation_id" integer,
	"unlocked_at" bigint NOT NULL,
	CONSTRAINT "game_citizen_achievements_address_code_pk" PRIMARY KEY("address","code")
);
--> statement-breakpoint
CREATE TABLE "game_citizen_xp" (
	"address" text NOT NULL,
	"ref" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"at" bigint NOT NULL,
	CONSTRAINT "game_citizen_xp_address_ref_pk" PRIMARY KEY("address","ref")
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"nation_id" integer,
	"target_nation_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tx_hash" text,
	"block_number" bigint,
	"created_at" bigint NOT NULL,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_nation_achievements" (
	"nation_id" integer NOT NULL,
	"code" text NOT NULL,
	"unlocked_at" bigint NOT NULL,
	CONSTRAINT "game_nation_achievements_nation_id_code_pk" PRIMARY KEY("nation_id","code")
);
--> statement-breakpoint
CREATE TABLE "game_nations" (
	"nation_id" integer PRIMARY KEY NOT NULL,
	"price_eth" double precision,
	"market_cap_eth" double precision,
	"liquidity_eth" double precision,
	"volume_24h_eth" double precision DEFAULT 0 NOT NULL,
	"trades_24h" integer DEFAULT 0 NOT NULL,
	"change_1h" double precision,
	"change_24h" double precision,
	"ath_market_cap_eth" double precision,
	"ath_liquidity_eth" double precision,
	"treasury_eth" double precision DEFAULT 0 NOT NULL,
	"citizens" integer DEFAULT 0 NOT NULL,
	"citizens_24h_ago" integer,
	"economic_power" real DEFAULT 0 NOT NULL,
	"military_power" real DEFAULT 0 NOT NULL,
	"defensive_power" real DEFAULT 0 NOT NULL,
	"influence_score" real DEFAULT 0 NOT NULL,
	"population_score" real DEFAULT 0 NOT NULL,
	"development_score" real DEFAULT 0 NOT NULL,
	"civilization_score" real DEFAULT 0 NOT NULL,
	"tier" integer DEFAULT 0 NOT NULL,
	"territory_cells" integer DEFAULT 6 NOT NULL,
	"rank" integer,
	"previous_rank" integer,
	"influence" integer DEFAULT 0 NOT NULL,
	"culture" integer DEFAULT 0 NOT NULL,
	"energy" integer DEFAULT 0 NOT NULL,
	"materials" integer DEFAULT 0 NOT NULL,
	"war_wins" integer DEFAULT 0 NOT NULL,
	"war_losses" integer DEFAULT 0 NOT NULL,
	"alliance_id" integer,
	"war_territory_bonus_until" bigint,
	"statuses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_fired" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_resource_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"nation_id" integer NOT NULL,
	"at" bigint NOT NULL,
	"influence" integer DEFAULT 0 NOT NULL,
	"culture" integer DEFAULT 0 NOT NULL,
	"energy" integer DEFAULT 0 NOT NULL,
	"materials" integer DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"ref" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_snapshots" (
	"nation_id" integer NOT NULL,
	"epoch" bigint NOT NULL,
	"price_eth" double precision,
	"market_cap_eth" double precision,
	"liquidity_eth" double precision,
	"volume_1h_eth" double precision NOT NULL,
	"volume_24h_eth" double precision NOT NULL,
	"trades_1h" integer NOT NULL,
	"citizens" integer NOT NULL,
	"treasury_eth" double precision NOT NULL,
	"civilization_score" real NOT NULL,
	"economic_power" real NOT NULL,
	"eth_usd" double precision,
	CONSTRAINT "game_snapshots_nation_id_epoch_pk" PRIMARY KEY("nation_id","epoch")
);
--> statement-breakpoint
CREATE TABLE "game_wars" (
	"id" integer PRIMARY KEY NOT NULL,
	"attacker_id" integer NOT NULL,
	"defender_id" integer NOT NULL,
	"declared_at" bigint NOT NULL,
	"ends_at" bigint NOT NULL,
	"status" text NOT NULL,
	"winner_id" integer,
	"attacker_start" jsonb NOT NULL,
	"defender_start" jsonb NOT NULL,
	"attacker_score" jsonb,
	"defender_score" jsonb,
	"spoils" integer,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holders" (
	"nation_id" integer NOT NULL,
	"address" text NOT NULL,
	"balance" numeric(78, 0) NOT NULL,
	"first_held_at" bigint NOT NULL,
	"updated_block" bigint NOT NULL,
	CONSTRAINT "holders_nation_id_address_pk" PRIMARY KEY("nation_id","address")
);
--> statement-breakpoint
CREATE TABLE "indexed_blocks" (
	"number" bigint PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_errors" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"resolved" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"last_block" bigint NOT NULL,
	"last_block_hash" text,
	"last_block_timestamp" bigint,
	"chain_head" bigint,
	"game_cursor" bigint DEFAULT 0 NOT NULL,
	"eth_usd" double precision,
	"eth_usd_updated_at" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nations" (
	"id" integer PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"pair" text NOT NULL,
	"founder" text NOT NULL,
	"name" text NOT NULL,
	"ticker" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"theme" integer NOT NULL,
	"emblem" numeric(78, 0) NOT NULL,
	"metadata_uri" text DEFAULT '' NOT NULL,
	"total_supply" numeric(78, 0) NOT NULL,
	"curve_supply" numeric(78, 0) NOT NULL,
	"lp_reserve" numeric(78, 0) NOT NULL,
	"founder_allocation" numeric(78, 0) NOT NULL,
	"initial_virtual_eth" numeric(78, 0) NOT NULL,
	"initial_virtual_tokens" numeric(78, 0) NOT NULL,
	"virtual_eth" numeric(78, 0) NOT NULL,
	"virtual_tokens" numeric(78, 0) NOT NULL,
	"real_eth" numeric(78, 0) NOT NULL,
	"curve_tokens_remaining" numeric(78, 0) NOT NULL,
	"graduated" boolean DEFAULT false NOT NULL,
	"graduated_at" bigint,
	"graduation_tx" text,
	"graduation_eth" numeric(78, 0),
	"token_is_token0" boolean,
	"pool_token_reserve" numeric(78, 0),
	"pool_weth_reserve" numeric(78, 0),
	"created_at" bigint NOT NULL,
	"created_block" bigint NOT NULL,
	"created_tx" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" integer PRIMARY KEY NOT NULL,
	"nation_id" integer NOT NULL,
	"proposer" text NOT NULL,
	"kind" integer NOT NULL,
	"payload" text NOT NULL,
	"description" text NOT NULL,
	"snapshot" bigint NOT NULL,
	"vote_end" bigint NOT NULL,
	"eta" bigint NOT NULL,
	"quorum" numeric(78, 0) NOT NULL,
	"for_votes" numeric(78, 0) DEFAULT '0' NOT NULL,
	"against_votes" numeric(78, 0) DEFAULT '0' NOT NULL,
	"abstain_votes" numeric(78, 0) DEFAULT '0' NOT NULL,
	"canceled" boolean DEFAULT false NOT NULL,
	"executed" boolean DEFAULT false NOT NULL,
	"executed_at" bigint,
	"executed_tx" text,
	"created_at" bigint NOT NULL,
	"created_block" bigint NOT NULL,
	"tx_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"nation_id" integer NOT NULL,
	"trader" text NOT NULL,
	"is_buy" boolean NOT NULL,
	"eth_amount" numeric(78, 0) NOT NULL,
	"token_amount" numeric(78, 0) NOT NULL,
	"fee" numeric(78, 0) NOT NULL,
	"price_eth" double precision NOT NULL,
	"market_cap_eth" double precision NOT NULL,
	"liquidity_eth" double precision NOT NULL,
	"venue" text NOT NULL,
	"block_number" bigint NOT NULL,
	"timestamp" bigint NOT NULL,
	CONSTRAINT "trades_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"nation_id" integer NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"block_number" bigint NOT NULL,
	"timestamp" bigint NOT NULL,
	CONSTRAINT "transfers_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "treasury_txs" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"nation_id" integer NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"counterparty" text NOT NULL,
	"kind" text NOT NULL,
	"proposal_id" integer,
	"block_number" bigint NOT NULL,
	"timestamp" bigint NOT NULL,
	CONSTRAINT "treasury_txs_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"proposal_id" integer NOT NULL,
	"voter" text NOT NULL,
	"nation_id" integer NOT NULL,
	"support" integer NOT NULL,
	"weight" numeric(78, 0) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"tx_hash" text NOT NULL,
	"block_number" bigint NOT NULL,
	"timestamp" bigint NOT NULL,
	CONSTRAINT "votes_proposal_id_voter_pk" PRIMARY KEY("proposal_id","voter")
);
--> statement-breakpoint
CREATE INDEX "game_action_events_time_idx" ON "game_action_events" USING btree ("timestamp","block_number","log_index");--> statement-breakpoint
CREATE INDEX "game_alliance_members_nation_idx" ON "game_alliance_members" USING btree ("nation_id");--> statement-breakpoint
CREATE INDEX "game_buildings_nation_idx" ON "game_buildings" USING btree ("nation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_buildings_proposal_idx" ON "game_buildings" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "game_citizen_achievements_time_idx" ON "game_citizen_achievements" USING btree ("unlocked_at");--> statement-breakpoint
CREATE INDEX "game_citizen_xp_at_idx" ON "game_citizen_xp" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_dedupe_idx" ON "game_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "game_events_created_idx" ON "game_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "game_events_nation_idx" ON "game_events" USING btree ("nation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_resource_ledger_ref_idx" ON "game_resource_ledger" USING btree ("nation_id","ref");--> statement-breakpoint
CREATE INDEX "game_resource_ledger_nation_idx" ON "game_resource_ledger" USING btree ("nation_id","at");--> statement-breakpoint
CREATE INDEX "game_wars_attacker_idx" ON "game_wars" USING btree ("attacker_id");--> statement-breakpoint
CREATE INDEX "game_wars_defender_idx" ON "game_wars" USING btree ("defender_id");--> statement-breakpoint
CREATE INDEX "holders_address_idx" ON "holders" USING btree ("address");--> statement-breakpoint
CREATE INDEX "holders_nation_balance_idx" ON "holders" USING btree ("nation_id","balance");--> statement-breakpoint
CREATE INDEX "indexer_errors_at_idx" ON "indexer_errors" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "nations_token_idx" ON "nations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "nations_pair_idx" ON "nations" USING btree ("pair");--> statement-breakpoint
CREATE INDEX "proposals_nation_idx" ON "proposals" USING btree ("nation_id");--> statement-breakpoint
CREATE INDEX "proposals_proposer_idx" ON "proposals" USING btree ("proposer");--> statement-breakpoint
CREATE INDEX "trades_nation_time_idx" ON "trades" USING btree ("nation_id","timestamp");--> statement-breakpoint
CREATE INDEX "trades_trader_idx" ON "trades" USING btree ("trader");--> statement-breakpoint
CREATE INDEX "trades_block_idx" ON "trades" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "transfers_nation_time_idx" ON "transfers" USING btree ("nation_id","timestamp");--> statement-breakpoint
CREATE INDEX "transfers_block_idx" ON "transfers" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX "treasury_nation_idx" ON "treasury_txs" USING btree ("nation_id","timestamp");--> statement-breakpoint
CREATE INDEX "votes_voter_idx" ON "votes" USING btree ("voter");--> statement-breakpoint
CREATE INDEX "votes_nation_time_idx" ON "votes" USING btree ("nation_id","timestamp");