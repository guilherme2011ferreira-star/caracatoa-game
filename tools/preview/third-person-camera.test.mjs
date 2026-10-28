import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const camera = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/preview_camera.script"), "utf8");
const hud = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/hud.gui_script"), "utf8");
const player = readFileSync(path.join(root, "work/caracatoa-defold-prototype/main/player.script"), "utf8");
const bindings = readFileSync(path.join(root, "work/caracatoa-defold-prototype/input/game.input_binding"), "utf8");

const modesBlock = camera.match(/local WORLD_CAMERA_MODES\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const modes = [...modesBlock.matchAll(/\{\s*name\s*=\s*"([^"]+)"\s*,\s*distance\s*=\s*([0-9.]+)\s*,\s*pitch\s*=\s*(-?[0-9.]+)\s*\}/g)]
	.map((match) => ({ name: match[1], distance: Number(match[2]), pitch: Number(match[3]) }));

test("gameplay camera provides three distinct third-person presets", () => {
	assert.equal(modes.length, 3);
	assert.deepEqual(modes.map(({ name }) => name), ["Próxima", "Clássica", "Ampla"]);
	assert.ok(modes[0].distance < modes[1].distance && modes[1].distance < modes[2].distance);
	assert.ok(modes[0].pitch > modes[1].pitch && modes[1].pitch > modes[2].pitch);
	assert.ok(modes[2].pitch < modes[0].pitch - 0.2, "wide and close presets use clearly different viewing angles");
	for (const mode of modes) {
		const cameraY = 1.0 - Math.tan(mode.pitch) * mode.distance;
		const targetHeight = cameraY + Math.tan(mode.pitch) * mode.distance;
		assert.ok(cameraY > 1.0 && cameraY < 8.0, `${mode.name} view stays above ground`);
		assert.ok(targetHeight >= 0.99 && targetHeight <= 1.01, `${mode.name} view aims near the torso`);
	}
	assert.match(camera, /self\.world_camera_mode_index\s*=\s*2/);
	assert.match(camera, /world_camera_mode_index\s*=\s*self\.world_camera_mode_index\s*%\s*#WORLD_CAMERA_MODES\s*\+\s*1/);
	assert.match(camera, /elseif message_id == hash\("world_follow"\)[\s\S]*?apply_world_camera\(self\)/);
});

test("mouse wheel zooms in and out within a bounded third-person range", () => {
	assert.match(camera, /WORLD_CAMERA_MIN_DISTANCE\s*=\s*4\.6/);
	assert.match(camera, /WORLD_CAMERA_MAX_DISTANCE\s*=\s*16\.0/);
	assert.match(camera, /WORLD_CAMERA_ZOOM_STEP\s*=\s*0\.9/);
	assert.match(camera, /math\.max\(WORLD_CAMERA_MIN_DISTANCE,[\s\S]*?math\.min\(WORLD_CAMERA_MAX_DISTANCE,[\s\S]*?message\.delta\s*\*\s*WORLD_CAMERA_ZOOM_STEP/);
	assert.match(bindings, /input:\s*MOUSE_WHEEL_UP\s+action:\s*"camera_zoom_in"/);
	assert.match(bindings, /input:\s*MOUSE_WHEEL_DOWN\s+action:\s*"camera_zoom_out"/);
	assert.match(hud, /action_id == hash\("camera_zoom_in"\) and action\.value == 1[\s\S]*?camera_zoom", \{ delta = -1 \}/);
	assert.match(hud, /action_id == hash\("camera_zoom_out"\) and action\.value == 1[\s\S]*?camera_zoom", \{ delta = 1 \}/);
});

test("camera shortcut is gameplay-only and leaves skill hotkeys unchanged", () => {
	assert.match(bindings, /input:\s*KEY_V\s+action:\s*"camera_mode_cycle"/);
	assert.match(hud, /self\.screen == "world" and action_id == hash\("camera_mode_cycle"\)[\s\S]*?camera_mode_next/);
	assert.match(bindings, /input:\s*KEY_1\s+action:\s*"skill_slot_1"/);
	assert.match(bindings, /input:\s*KEY_2\s+action:\s*"skill_slot_2"/);
	assert.match(bindings, /input:\s*KEY_3\s+action:\s*"skill_slot_3"/);
	assert.match(hud, /Câmera %s · %.1f m/);
});

test("leaving gameplay restores the authored overview camera", () => {
	assert.match(camera, /elseif message_id == hash\("selection_overview"\) then\s+move_camera\(self, self\.overview, self\.home_rotation\)/);
	assert.match(player, /elseif message_id == hash\("world_reset"\) then\s+restore_preview\(self\)/);
});
