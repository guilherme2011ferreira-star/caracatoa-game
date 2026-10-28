-- Caracatoa item instances and rolled affixes, database schema v13.
-- Reference form of the migration implemented by PlayerAccountStore v12 -> v13.
-- Runtime applies the equivalent statements in one BEGIN IMMEDIATE transaction.

BEGIN IMMEDIATE;

ALTER TABLE player_character_inventory
  ADD COLUMN item_instance_id TEXT
  CHECK (item_instance_id IS NULL OR length(item_instance_id) = 36);

-- SQLite unique indexes allow multiple NULL values, preserving all old stacks.
CREATE UNIQUE INDEX player_character_inventory_instance_unique
  ON player_character_inventory(item_instance_id);

CREATE TABLE player_character_item_rolls (
  item_instance_id TEXT PRIMARY KEY NOT NULL
    REFERENCES player_character_inventory(item_instance_id) ON DELETE CASCADE,
  client_item_id INTEGER NOT NULL CHECK (client_item_id BETWEEN 1 AND 65535),
  rarity TEXT NOT NULL CHECK (rarity IN ('normal', 'mystic', 'arcane', 'legendary', 'ancient')),
  item_level INTEGER NOT NULL CHECK (item_level BETWEEN 1 AND 400),
  refinement_level INTEGER NOT NULL DEFAULT 0 CHECK (refinement_level BETWEEN 0 AND 15),
  base_stats_json TEXT NOT NULL CHECK (json_valid(base_stats_json)),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('monster-drop', 'quest', 'craft', 'admin-grant')),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 96),
  catalog_version TEXT NOT NULL CHECK (length(catalog_version) BETWEEN 1 AND 64),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
) STRICT;

CREATE TABLE player_character_item_affixes (
  item_instance_id TEXT NOT NULL
    REFERENCES player_character_item_rolls(item_instance_id) ON DELETE CASCADE,
  affix_index INTEGER NOT NULL CHECK (affix_index BETWEEN 0 AND 3),
  client_affix_id INTEGER NOT NULL CHECK (client_affix_id BETWEEN 1 AND 255),
  affix_id TEXT NOT NULL CHECK (length(affix_id) BETWEEN 1 AND 64),
  stat_id TEXT NOT NULL CHECK (length(stat_id) BETWEEN 1 AND 64),
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 100000),
  value_unit TEXT NOT NULL CHECK (value_unit IN ('flat', 'basis-points')),
  PRIMARY KEY (item_instance_id, affix_index),
  UNIQUE (item_instance_id, affix_id),
  UNIQUE (item_instance_id, stat_id)
) STRICT;

CREATE INDEX player_character_item_rolls_by_rarity_level
  ON player_character_item_rolls(rarity, item_level);

CREATE TABLE player_character_itemization_kills (
  loot_event_id TEXT NOT NULL CHECK (length(loot_event_id) BETWEEN 1 AND 96),
  account_id TEXT NOT NULL,
  character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (loot_event_id, account_id, character_slot),
  FOREIGN KEY (account_id, character_slot)
    REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
) STRICT;

CREATE TABLE itemization_audit_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) = 36),
  account_id TEXT NOT NULL,
  character_slot INTEGER NOT NULL CHECK (character_slot BETWEEN 0 AND 3),
  item_instance_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('drop', 'equip', 'unequip', 'trade', 'reforge', 'destroy', 'admin-grant')),
  source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 96),
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  FOREIGN KEY (account_id, character_slot)
    REFERENCES player_characters(account_id, slot) ON DELETE CASCADE
) STRICT;

CREATE INDEX itemization_audit_events_by_character_time
  ON itemization_audit_events(account_id, character_slot, created_at_ms DESC);

PRAGMA user_version = 13;
COMMIT;
