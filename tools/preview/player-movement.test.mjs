import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const player = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/player.script"), "utf8");

test("avatar tile interpolation matches the authoritative movement cadence", () => {
	const interval = player.match(/local MOVE_REQUEST_INTERVAL\s*=\s*([0-9.]+)/)?.[1];
	assert.ok(interval, "movement request interval is declared");
	assert.match(player, /local MOVE_STEP_DURATION\s*=\s*MOVE_REQUEST_INTERVAL/);
	assert.match(player, /go\.animate\("\/"\s*\.\.\s*self\.avatar_id,\s*"position"[\s\S]*?MOVE_STEP_DURATION\)/);
	assert.equal(Number(interval), 0.18);
});

test("WASD movement stays serialized and waits for server authority", () => {
	assert.match(player, /if self\.awaiting_authority or self\.request_elapsed < MOVE_REQUEST_INTERVAL then return end/);
	assert.match(player, /self\.awaiting_authority = true\s+msg\.post\("\/local_connection#connection", "world_move_request"/);
	assert.match(player, /elseif message_id == hash\("world_move_confirmed"\) then\s+set_authoritative_position\(self, message\.x, message\.y\)\s+self\.awaiting_authority = false/);
	assert.doesNotMatch(player, /world_move_request[\s\S]{0,160}go\.set_position\("\/"\s*\.\.\s*self\.avatar_id/);
});

test("movement rejection stops the walk animation and permits a later request", () => {
	assert.match(player, /elseif message_id == hash\("world_move_rejected"\) then\s+self\.awaiting_authority = false\s+set_avatar_animation\(self, "Idle_Loop"\)/);
	assert.match(player, /if not code then\s+set_avatar_animation\(self, "Idle_Loop"\)\s+return/);
});
