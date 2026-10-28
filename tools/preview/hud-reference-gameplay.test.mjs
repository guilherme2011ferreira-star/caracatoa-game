import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hudPath = join(repoRoot, "work", "caracatoa-defold-prototype", "main", "hud.gui_script");
const inputPath = join(repoRoot, "work", "caracatoa-defold-prototype", "input", "game.input_binding");
const connectionPath = join(repoRoot, "work", "caracatoa-defold-prototype", "main", "local_connection.script");
const hud = await readFile(hudPath, "utf8");
const input = await readFile(inputPath, "utf8");
const connection = await readFile(connectionPath, "utf8");

function assertSeparated(first, second, label) {
	const horizontalGap = Math.max(first.left - second.right, second.left - first.right, 0);
	const verticalGap = Math.max(first.bottom - second.top, second.bottom - first.top, 0);
	assert.ok(horizontalGap > 0 || verticalGap > 0, `${label} must not overlap`);
}

test("player status bars are framed and use authoritative HP/MP snapshots", () => {
	assert.ok(hud.includes('add_metal_frame(self, "world", 240, 640, 460, 130'));
	assert.ok(hud.includes('self.world_hp_fill = add_pill(self, "world", 240, 630, 406, 8, COLOR_HP_FILL'));
	assert.ok(hud.includes('self.world_mp_fill = add_pill(self, "world", 240, 603, 406, 8, COLOR_MP_FILL'));
	assert.match(hud, /message_id == hash\("world_resources_updated"\) then\s+set_world_vitals\(self, message\.current_hp, message\.max_hp, message\.current_mp, message\.max_mp\)/);
	assert.match(hud, /local function set_ratio_fill\(pill, current, maximum\)[\s\S]*?math\.max\(0, math\.min\(maximum, current\)\)[\s\S]*?pill\.width \* value \/ maximum/);
});

test("target panel shows server HP proportion and clears when deselected", () => {
	assert.ok(hud.includes('add_metal_frame(self, "world", 1020, 640, 420, 130'));
	assert.ok(hud.includes('self.world_target_fill = add_pill(self, "world", 1020, 630, 346, 8, COLOR_TARGET_FILL'));
	assert.match(hud, /message_id == hash\("world_target_updated"\) then[\s\S]*?set_world_target_health\(self, message\.current_hp, message\.max_hp\)[\s\S]*?set_world_target_health\(self, nil, nil\)/);
	assert.match(hud, /if message\.target_hp then set_world_target_health\(self, message\.target_hp, self\.world_target_max_hp\) end/);
});

test("compact player and target frames stay separate from detail panels", () => {
	const player = { left: 10, right: 470, bottom: 575, top: 705 };
	const target = { left: 810, right: 1230, bottom: 575, top: 705 };
	const attributes = { left: 35, right: 505, bottom: 307, top: 513 };
	const inventory = { left: 820, right: 1260, bottom: 109, top: 559 };
	const skills = { left: 805, right: 1235, bottom: 285, top: 565 };
	assertSeparated(player, target, "Player and target frames");
	assertSeparated(player, attributes, "Player frame and attributes panel");
	assertSeparated(player, inventory, "Player frame and inventory panel");
	assertSeparated(target, skills, "Target frame and skills panel");
	assertSeparated(target, inventory, "Target frame and inventory panel");
	assert.ok(hud.includes('add_metal_frame(self, "world", 270, 410, 460, 196'));
	assert.ok(hud.includes('add_metal_frame(self, "world", 1020, 425, 420, 270'));
});

test("gameplay HUD follows a safe, reference-style bottom action strip", () => {
	const rect = (x, y, width, height) => ({
		left: x - width / 2,
		right: x + width / 2,
		bottom: y - height / 2,
		top: y + height / 2,
	});
	const leftTabs = [70, 190, 310].map((x) => rect(x, 92, 104, 32));
	const actionBar = rect(640, 92, 372, 64);
	const rightTabs = [878, 986, 1094, 1202].map((x) => rect(x, 92, 100, 32));
	const bottomControls = [...leftTabs, actionBar, ...rightTabs];
	for (let first = 0; first < bottomControls.length; first += 1) {
		for (let second = first + 1; second < bottomControls.length; second += 1) {
			assertSeparated(bottomControls[first], bottomControls[second], "Bottom HUD controls");
		}
	}
	for (const button of bottomControls) {
		assert.ok(button.left >= 0 && button.right <= 1280, "Bottom HUD control must fit the 1280px canvas");
		assert.ok(button.bottom >= 0 && button.top <= 720, "Bottom HUD control must fit the 720px canvas");
	}
	assert.ok(hud.includes('add_metal_frame(self, "world", 640, 92, 372, 64'));
	assert.ok(hud.includes('"skill_cast_primary", "1 · —", 520, 92, 112, 42'));
	assert.ok(hud.includes('"skill_cast_secondary", "2 · —", 640, 92, 112, 42'));
	assert.ok(hud.includes('"skill_cast_tertiary", "3 · —", 760, 92, 112, 42'));
	assert.ok(hud.includes('"attributes_toggle", "Atributos", 70, 92, 104, 32'));
	assert.ok(hud.includes('"inventory_toggle", "Inventário", 190, 92, 104, 32'));
	assert.ok(hud.includes('"skills_toggle", "Habilidades", 310, 92, 104, 32'));
	assert.ok(hud.includes('"mount_toggle", "Montarias", 878, 92, 100, 32'));
	assert.ok(hud.includes('"logout", "Sair", 1202, 92, 100, 32'));
	assert.ok(hud.includes('world_screen and 142 or 42'));
});

test("inventory uses a right-docked 5 by 4 grid for all 60 server slots", () => {
	assert.ok(hud.includes("local INVENTORY_SLOT_COUNT = 60"));
	assert.ok(hud.includes("local INVENTORY_PAGE_SIZE = 20"));
	assert.ok(hud.includes("local INVENTORY_GRID_COLUMNS = 5"));
	assert.ok(hud.includes("local INVENTORY_CELL_WIDTH = 56"));
	assert.ok(hud.includes("local INVENTORY_CELL_HEIGHT = 52"));
	assert.ok(hud.includes("local INVENTORY_GRID_GAP_X = 12"));
	assert.ok(hud.includes('add_metal_frame(self, "world", 1040, 334, 430, 450'));
	assert.ok(hud.includes('"EQUIPAMENTO E MOCHILA", COLOR_GOLD'));
	assert.ok(hud.includes('"01–20 / 60"'));
	assert.ok(hud.includes('button.hit_rect.width = INVENTORY_CELL_WIDTH'));
	assert.ok(hud.includes('button.hit_rect.height = INVENTORY_CELL_HEIGHT'));
	assert.ok(hud.includes('button.hit_rect.width = 44'));
	assert.ok(hud.includes('button.hit_rect.height = 26'));
	assert.ok(hud.includes('button.hit_rect.width = 180'));
	assert.ok(hud.includes('button.hit_rect.height = 24'));
	assert.ok(hud.includes('math.ceil(INVENTORY_SLOT_COUNT / INVENTORY_PAGE_SIZE) - 1'));
	assert.ok(hud.includes('elseif action:sub(1, 15) == "inventory_slot_" then'));
	assert.ok(hud.includes('select_inventory_slot(self, tonumber(action:sub(16)))'));
	assert.match(hud, /local item_label = string\.format\("%s%s ×%d%s", truncate_utf8\(name, 4\), refinement, item\.stack_count or 1/);
	assert.ok(hud.includes('INVENTORY_RARITY_TEXT_COLORS[itemization.rarity_id]'));
});

test("quick actions identify each learned skill and use matching number keys", () => {
	assert.ok(hud.includes('string.format("%d · %s", slot, truncate_utf8(definition.name, 10))'));
	for (const slot of [1, 2, 3]) {
		assert.match(input, new RegExp(`input: KEY_${slot}\\s+action: "skill_slot_${slot}"`));
	}
	assert.match(hud, /action_id == hash\("skill_slot_1"\)[\s\S]*?cast_skill_slot\(self, slot\)/);
	assert.match(hud, /local function cast_skill_slot\(self, slot\)[\s\S]*?self\.world_skill_learned\[skill_id\] ~= true[\s\S]*?world_skill_cast/);
});

test("combat popups use only server-confirmed damage, healing, and experience", () => {
	assert.ok(hud.includes("local COMBAT_FEEDBACK_COUNT = 3"));
	assert.ok(hud.includes("local COMBAT_FEEDBACK_DURATION = 0.85"));
	assert.match(hud, /local function show_world_combat_feedback\(self, value, color\)[\s\S]*?self\.screen ~= "world"[\s\S]*?popup\.active = true/);
	assert.match(hud, /message_id == hash\("world_skill_result"\) then[\s\S]*?type\(message\.healed\) == "number" and message\.healed > 0[\s\S]*?COLOR_COMBAT_HEAL[\s\S]*?type\(message\.damage\) == "number" and message\.damage > 0[\s\S]*?COLOR_COMBAT_DAMAGE/);
	assert.match(hud, /message_id == hash\("world_progression_updated"\) then[\s\S]*?experience_gained > 0[\s\S]*?" EXP", COLOR_COMBAT_EXPERIENCE/);
	assert.match(connection, /elseif opcode == 0x39d then[\s\S]*?Session\.parse_skill_attack_result\(body\)[\s\S]*?post_ui\("world_skill_result"/);
});

test("reference comparison checklist records implemented and pending criteria", async () => {
	const report = await readFile(join(repoRoot, "docs", "art", "analise-comparativa-referencias-gameplay.md"), "utf8");
	for (const term of ["Diferenças observáveis", "Lista priorizada e estado de aplicação", "Aplicação desta revisão", "Validação e limites"]) {
		assert.ok(report.includes(term), `Missing comparison section: ${term}`);
	}
	for (const term of ["TransKnight", "Foema", "BeastMaster", "Huntress", "movimento do Golem", "sem derrubar a sessão"]) {
		assert.ok(report.includes(term), `Missing comparison evidence: ${term}`);
	}
});
