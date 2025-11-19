CREATE TABLE IF NOT EXISTS "daily_guess_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"fid" integer NOT NULL,
	"date" date NOT NULL,
	"free_allocated_base" integer DEFAULT 0 NOT NULL,
	"free_allocated_clankton" integer DEFAULT 0 NOT NULL,
	"free_allocated_share_bonus" integer DEFAULT 0 NOT NULL,
	"free_used" integer DEFAULT 0 NOT NULL,
	"paid_guess_credits" integer DEFAULT 0 NOT NULL,
	"paid_packs_purchased" integer DEFAULT 0 NOT NULL,
	"has_shared_today" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_guess_state_fid_date_unique" UNIQUE("fid","date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "game_rules_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guesses" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"fid" integer NOT NULL,
	"word" varchar(5) NOT NULL,
	"is_paid" boolean DEFAULT false NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "round_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"fid" integer NOT NULL,
	"amount_eth" numeric(20, 18) NOT NULL,
	"role" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "round_seed_words" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"word" varchar(5) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "round_seed_words_round_word_unique" UNIQUE("round_id","word")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"ruleset_id" integer NOT NULL,
	"answer" varchar(5) NOT NULL,
	"salt" varchar(64) NOT NULL,
	"commit_hash" varchar(64) NOT NULL,
	"prize_pool_eth" numeric(20, 18) DEFAULT '0' NOT NULL,
	"seed_next_round_eth" numeric(20, 18) DEFAULT '0' NOT NULL,
	"winner_fid" integer,
	"referrer_fid" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "system_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_balance_eth" numeric(20, 18) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"fid" integer NOT NULL,
	"username" varchar(100),
	"signer_wallet_address" varchar(42),
	"custody_address" varchar(42),
	"referrer_fid" integer,
	"spam_score" integer,
	"xp" integer DEFAULT 0 NOT NULL,
	"has_seen_intro" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_fid_unique" UNIQUE("fid")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "guesses" ADD CONSTRAINT "guesses_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "round_payouts" ADD CONSTRAINT "round_payouts_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "round_seed_words" ADD CONSTRAINT "round_seed_words_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rounds" ADD CONSTRAINT "rounds_ruleset_id_game_rules_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."game_rules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_guess_state_fid_date_idx" ON "daily_guess_state" USING btree ("fid","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guesses_round_fid_idx" ON "guesses" USING btree ("round_id","fid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guesses_round_word_idx" ON "guesses" USING btree ("round_id","word");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guesses_created_at_idx" ON "guesses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guesses_is_correct_idx" ON "guesses" USING btree ("is_correct");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "round_payouts_round_idx" ON "round_payouts" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "round_payouts_fid_idx" ON "round_payouts" USING btree ("fid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "round_seed_words_round_idx" ON "round_seed_words" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rounds_commit_hash_idx" ON "rounds" USING btree ("commit_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rounds_winner_fid_idx" ON "rounds" USING btree ("winner_fid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_fid_idx" ON "users" USING btree ("fid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_wallet_idx" ON "users" USING btree ("signer_wallet_address");