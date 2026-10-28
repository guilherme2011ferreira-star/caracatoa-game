import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const player = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/player.script"), "utf8");
const camera = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/preview_camera.script"), "utf8");
const hud = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/hud.gui_script"), "utf8");
const avatar = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/avatar_animation.script"), "utf8");
const connection = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/local_connection.script"), "utf8");
const nativeHarness = readFileSync(path.join(root, "work/caracatoa-defold-prototype/tools/verify-native-registration.mjs"), "utf8");
const collection = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/main.collection"), "utf8");

function luaArray(source, name) {
	const match = source.match(new RegExp(`local ${name}\\s*=\\s*\\{([^}]+)\\}`));
	assert.ok(match, `expected local ${name} array`);
	return match[1].split(",").map((value) => Number(value.trim()));
}

function luaNumber(source, name) {
	const match = source.match(new RegExp(`local ${name}\\s*=\\s*(-?[0-9.]+)`));
	assert.ok(match, `expected local ${name} number`);
	return Number(match[1]);
}

test("creator opens a close, four-class lineup on the clear left side of its panel", () => {
	const positions = luaArray(player, "CREATOR_X");
	assert.equal(positions.length, 4);
	assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]));
	assert.match(player, /message_id == hash\("creator_show"\)[\s\S]*?CREATOR_X\[index\][\s\S]*?"creator_lineup"/);
	assert.match(hud, /local function select_creator_class\([\s\S]*?creator_focus/);
	assert.doesNotMatch(hud, /preview_camera", "creator_focus"/);
	assert.match(avatar, /local FOCUS_SCALE = 1\.52/);

	const creatorX = luaNumber(camera, "CREATOR_CAMERA_X");
	const cameraZ = luaNumber(camera, "CREATOR_CAMERA_Z");
	const fovMatch = collection.match(/fov: ([0-9.]+)/);
	const aspectMatch = collection.match(/aspect_ratio: ([0-9.]+)/);
	assert.ok(fovMatch && aspectMatch, "expected authored perspective camera settings");
	const halfWidth = cameraZ * Math.tan(Number(fovMatch[1]) / 2) * Number(aspectMatch[1]);
	const panelLeft = 1000 - 550 / 2;
	const panelWorldLeft = creatorX + (panelLeft / 1280 - 0.5) * 2 * halfWidth;
	const cameraWorldLeft = creatorX - halfWidth;
	const avatarHalfWidth = 0.55;
	assert.ok(positions[0] - avatarHalfWidth > cameraWorldLeft, "leftmost class silhouette stays on screen");
	assert.ok(positions.at(-1) + avatarHalfWidth < panelWorldLeft, "rightmost class silhouette stays clear of the creator panel");
});

test("leaving the creator restores the small four-class selection lineup and their base scale", () => {
	assert.match(player, /local function restore_preview\(self, keep_creator_camera\)[\s\S]*?PREVIEW_X\[index\][\s\S]*?if not keep_creator_camera then[\s\S]*?"creator_overview"/);
	assert.match(player, /if not keep_creator_camera then[\s\S]*?"selection_overview"/);
	assert.match(avatar, /message_id == hash\("creator_overview"\)[\s\S]*?go\.set_scale\(self\.home_scale\)/);
});

test("server-authoritative Golem movement updates its model instead of failing the player session", () => {
	assert.ok(connection.includes("local monster = state.world_monsters[movement.client_id]"));
	assert.ok(connection.includes("monster.position = movement.destination"));
	assert.ok(connection.includes('report_status("LOCAL_WORLD_MONSTER_MOVED:" .. tostring(monster.entity_id))'));
	assert.ok(nativeHarness.includes('"LOCAL_CHARACTER_CREATED"'));
	assert.ok(nativeHarness.includes('"LOCAL_WORLD_ENTRY_CONFIRMED"'));
	assert.ok(nativeHarness.includes('"LOCAL_WORLD_MONSTER_MOVED:64000"'));
});
