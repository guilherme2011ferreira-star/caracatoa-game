-- Caracatoa: migration from player database schema v14 to v15.
-- Run inside BEGIN IMMEDIATE with foreign_keys=ON.
CREATE TABLE player_account_banks (
  account_id TEXT PRIMARY KEY NOT NULL
    REFERENCES player_accounts(account_id) ON DELETE CASCADE,
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold BETWEEN 0 AND 2147483647),
  updated_at_ms INTEGER NOT NULL DEFAULT 0 CHECK (updated_at_ms >= 0)
) STRICT;

CREATE TABLE player_account_bank_items (
  account_id TEXT NOT NULL
    REFERENCES player_account_banks(account_id) ON DELETE CASCADE,
  bank_slot INTEGER NOT NULL CHECK (bank_slot BETWEEN 0 AND 119),
  catalog_item_id TEXT NOT NULL CHECK (length(catalog_item_id) BETWEEN 1 AND 64),
  stack_count INTEGER NOT NULL CHECK (stack_count BETWEEN 1 AND 500),
  PRIMARY KEY (account_id, bank_slot)
) STRICT;
CREATE INDEX player_account_bank_items_by_catalog
  ON player_account_bank_items(catalog_item_id);

CREATE TABLE player_guilds (
  guild_id TEXT PRIMARY KEY NOT NULL CHECK (length(guild_id) = 36),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 24),
  normalized_name TEXT NOT NULL UNIQUE CHECK (length(normalized_name) BETWEEN 3 AND 24),
  leader_account_id TEXT NOT NULL,
  leader_character_slot INTEGER NOT NULL CHECK (leader_character_slot BETWEEN 0 AND 3),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  FOREIGN KEY (leader_account_id, leader_character_slot)
    REFERENCES player_characters(account_id, slot) ON DELETE RESTRICT
) STRICT;

CREATE TABLE player_guild_members (
  guild_id TEXT NOT NULL REFERENCES player_guilds(guild_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
  role TEXT NOT NULL CHECK (role IN ('leader', 'officer', 'member')),
  joined_at_ms INTEGER NOT NULL CHECK (joined_at_ms >= 0),
  PRIMARY KEY (account_id, character_slot),
  FOREIGN KEY (account_id, character_slot)
    REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
) STRICT;
CREATE INDEX player_guild_members_by_guild
  ON player_guild_members(guild_id, role, joined_at_ms);
CREATE UNIQUE INDEX player_guild_members_one_leader
  ON player_guild_members(guild_id) WHERE role = 'leader';

PRAGMA user_version = 15;
