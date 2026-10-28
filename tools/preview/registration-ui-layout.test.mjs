import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hudPath = join(repoRoot, "work", "caracatoa-defold-prototype", "main", "hud.gui_script");
const hud = await readFile(hudPath, "utf8");
const playerPath = join(repoRoot, "work", "caracatoa-defold-prototype", "main", "player.script");
const player = await readFile(playerPath, "utf8");
const connectionPath = join(repoRoot, "work", "caracatoa-defold-prototype", "main", "local_connection.script");
const connection = await readFile(connectionPath, "utf8");
const inputBindingPath = join(repoRoot, "work", "caracatoa-defold-prototype", "input", "game.input_binding");
const inputBinding = await readFile(inputBindingPath, "utf8");

function fieldCall(screen, name, label, x, fieldY, width) {
	const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`add_field\\(self, \\"${screen}\\", \\"${name}\\", \\"${escapedLabel}\\", ${x}, \\d+, ${fieldY}, ${width}\\)`);
	assert.match(hud, pattern, `Missing ${screen} field ${name}`);
}

test("login prompts stay inside their own plates", () => {
	fieldCall("login", "account", "", 270, 430, 330);
	fieldCall("login", "password", "", 270, 362, 330);
	assert.ok(hud.includes('account = "ID da conta"'));
	assert.ok(hud.includes('password = "Senha do jogo"'));
});

test("registration fields use in-frame prompts instead of colliding row labels", () => {
  for (const name of ["account", "password", "password_confirm", "pin"]) {
		assert.match(hud, new RegExp(`add_field\\(self, \\"register\\", \\"${name}\\", \\"\\", 320, 0, \\d+, 360\\)`));
  }
	const registerBuild = hud.slice(hud.indexOf('add_entry_art(self, "register")'), hud.indexOf('add_panel(self, "pin"'));
	assert.ok(registerBuild.includes('add_text(self, "register", 320, 536, "Criar conta", COLOR_TEXT, true, 1.28)'));
	assert.ok(!registerBuild.includes('"CARACATOA"'), "The crest already carries the brand; avoid text over its silhouette");
	assert.ok(hud.includes('password = "Senha · 8 a 11 caracteres"'));
	assert.ok(hud.includes('pin = "PIN · 4 a 6 dígitos"'));
	assert.ok(hud.includes('screen == "register" and 1.12'));
});

test("registration submit button is wired to validation and has a distinct hit area", () => {
  assert.ok(hud.includes('add_button(self, "register", "register_confirm", "Criar conta", 320, 210, 282, 56)'));
  assert.match(hud, /elseif action == "register_confirm" then\r?\n\s*send_registration\(self\)/);
  assert.match(hud, /elseif self\.screen == "register" then\r?\n\s*send_registration\(self\)/);
	assert.match(hud, /local register_submit = screen == "register" and action == "register_confirm"/);
	assert.ok(hud.includes('y = y + (register_submit and 2 or 0)'));
	assert.ok(hud.includes('height = height + (register_submit and 8 or (screen == "register" and 2 or 10))'));
	const confirm = { y: 212, height: 64 };
  const back = { y: 150, height: 58 };
  assert.ok(confirm.y - confirm.height / 2 > back.y + back.height / 2,
    "Submit and back hit areas must not intercept each other");
	assert.ok(239.25 >= confirm.y - confirm.height / 2 && 239.25 <= confirm.y + confirm.height / 2,
		"the fractional canvas coordinate from the short browser click must reach Submit");
});

test("mouse clicks reach the focused HUD registration controls", () => {
	assert.match(inputBinding, /mouse_trigger\s*\{\s*input:\s*MOUSE_BUTTON_1\s*action:\s*"click"\s*\}/);
	assert.ok(hud.includes('msg.post(".", "acquire_input_focus")'));
	assert.match(hud, /local function handle_mouse_click\(self, action\)[\s\S]*?hit_rect_contains\(button\.hit_rect, action\.x, action\.y\)[\s\S]*?handle_button\(self, button\.action\)/);
	assert.match(hud, /local function hit_rect_contains\(hit_rect, x, y\)[\s\S]*?type\(x\) == "number" and type\(y\) == "number"/,
		"ignore pointer phases without valid coordinates instead of throwing in the GUI script");
	assert.match(hud, /elseif action_id == hash\("click"\) then[\s\S]*?if action\.released then return handle_mouse_click\(self, action\) end/,
		"dispatch a click once on release, using its final pointer coordinates");
	assert.doesNotMatch(hud, /mouse_press_handled/, "do not retain stale input state across short clicks");
	assert.match(hud, /message_id == hash\("hud_input_test_start"\)[\s\S]*?handle_mouse_click\(self, \{ x = 270, y = 215 \}\)[\s\S]*?handle_mouse_click\(self, \{ x = 320, y = 210 \}\)/);
});

test("covered 3D sets stay hidden on login and registration splash screens", () => {
	assert.match(hud, /elseif screen == "login" or screen == "register" then\s+msg\.post\("\/transknight#movement", "access_hide"\)/);
	assert.match(player, /message_id == hash\("access_hide"\) then\s+hide_preview\(self\)\s+go\.set_position\(HIDDEN_POSITION, "arena"\)\s+go\.set_position\(HIDDEN_POSITION, "altar"\)/);
});

test("native HUD registration and onboarding harness follows create, login, PIN, roster, character, and world", () => {
	const hudTest = hud.slice(hud.indexOf("local function begin_hud_registration_test"), hud.indexOf("function on_message", hud.indexOf("local function begin_hud_registration_test")));
	assert.match(hudTest, /handle_mouse_click\(self, \{ x = 270, y = 215 \}\)[\s\S]*?handle_mouse_click\(self, \{ x = 320, y = 210 \}\)/);
	assert.match(hud, /test\.phase = "login"[\s\S]*?handle_mouse_click\(self, \{ x = 270, y = 277 \}\)/);
	assert.match(hud, /test\.phase = "pin"[\s\S]*?handle_mouse_click\(self, \{ x = 270, y = 330 \}\)/);
	assert.match(hud, /report_hud_registration_test\(self, true, "roster"\)/);
	assert.match(hud, /HUD_ONBOARDING_TEST_MODE[\s\S]*?handle_mouse_click\(self, \{ x = 270, y = 185 \}\)[\s\S]*?handle_mouse_click\(self, \{ x = 792 \+ test\.class_id \* 138, y = 550 \}\)[\s\S]*?handle_mouse_click\(self, \{ x = 1000, y = 105 \}\)/);
	assert.match(hud, /test\.phase = "await-created-roster"/);
	assert.match(hud, /handle_mouse_click\(self, \{ x = 270, y = 485 \}\)/);
	assert.match(hud, /report_hud_registration_test\(self, passed, "world"\)/);
	assert.match(connection, /HUD_REGISTRATION_TEST_MODE[\s\S]*?post_ui\("hud_registration_test_start"/);
	assert.match(connection, /HUD_ONBOARDING_TEST_MODE[\s\S]*?local marker = prefix \.\. \(message\.passed == true and "PASS"/);
});

test("access-screen typography uses a visible shadow and readable field prompts", () => {
  const start = hud.indexOf("local function add_text(");
  const end = hud.indexOf("local function add_logo(", start);
  const addText = hud.slice(start, end);
  assert.equal((addText.match(/gui\.new_text_node/g) || []).length, 2,
    "Access text should have a single shadow plus the foreground node");
  assert.ok(!addText.includes("bevel"), "Offset bevel copies blur Cinzel glyphs at browser scale");
	assert.ok(hud.includes('account = "ID da conta"'));
	assert.ok(hud.includes('password = "Senha do jogo"'));
	assert.ok(addText.includes("x + 2, y - 2"), "The dark shadow must survive browser scaling");
  assert.ok(!hud.includes("Clique aqui e digite o ID"));
  assert.ok(!hud.includes("Clique aqui e digite a senha"));
});

test("login and registration status messages stay centered above the lower frame", () => {
	assert.match(hud, /local x = screen == "register" and 320 or 270\s+local y = screen == "register" and 108 or 130/);
	assert.match(hud, /local status_x = create_screen and 1000 or \(world_screen and 640 or 72\)/);
	assert.match(hud, /local status_y = create_screen and 26 or \(world_screen and 142 or 42\)/);
	assert.match(hud, /local scale = access and 0\.76 or \(create_screen and 0\.54 or \(world_screen and 0\.54 or 1\)\)/);
	assert.ok(hud.includes("self.status_shadow_node = gui.new_text_node"));
	assert.ok(hud.includes("gui.set_enabled(self.status_shadow_node, access or create_screen or world_screen)"));
});

test("character class details are split, shadowed, and sized for the framed panel", () => {
	const createBuild = hud.slice(hud.indexOf('add_framed_panel(self, "create"'), hud.indexOf('add_box(self, "world"'));
	assert.ok(createBuild.includes('self.creator_class_title = add_text(self, "create", 750, 508'));
	assert.ok(createBuild.includes('self.creator_class_subtitle = add_text(self, "create", 750, 485'));
	assert.ok(createBuild.includes('set_text_scale(self, button.text, CLASS_BUTTON_TEXT_SCALE)'));
	assert.ok(hud.includes('local CLASS_BUTTON_TEXT_SCALE = 0.60'));
	assert.ok(hud.includes('set_text(self, self.creator_class_subtitle, definition.title'));
	assert.match(hud, /if is_access_screen\(screen\) or screen == "create" or screen == "world" then/);
	assert.ok(hud.includes('self.text_shadow_by_node[node] = effects[1].node'));
	assert.ok(hud.includes('if shadow then gui.set_text(shadow, value) end'));
	const centers = [792, 930, 1068, 1206];
	for (const center of centers) {
		assert.ok(center - 66 >= 725 && center + 66 <= 1275, `class button at ${center} must remain inside panel`);
	}
});

test("skill and inventory HUD controls remain inside the 1280px canvas", () => {
	const cast = [520, 640, 760];
	for (const center of cast) assert.ok(center - 56 >= 0 && center + 56 <= 1280);
	for (const center of [1160, 1160, 1160]) assert.ok(center - 52 >= 0 && center + 52 <= 1280);
	assert.ok(hud.includes('add_button(self, "world", "skill_cast_tertiary", "3 · —", 760, 92, 112, 42)'));
	assert.ok(!hud.includes('"Usar", 1320, 104, 180, 40'));
	assert.ok(hud.includes('add_button(self, "world", "skill_learn_primary", "Aprender", 1160, 450, 104, 32)'));
	assert.ok(hud.includes('set_text_scale(self, button.text, 0.44)'));
	assert.ok(hud.includes('local item_label = string.format("%s%s ×%d%s", truncate_utf8(name, 4), refinement'));
	assert.ok(hud.includes('local INVENTORY_PAGE_SIZE = 20'));
	assert.ok(hud.includes('local INVENTORY_GRID_COLUMNS = 5'));
});

test("world detail panels open one at a time and hidden controls cannot steal clicks", () => {
	assert.ok(hud.includes('set_world_detail_panel(self, nil)'));
	assert.match(hud, /local function set_world_detail_panel\(self, panel\)[\s\S]*?name == panel[\s\S]*?refresh_inventory_panel\(self\)[\s\S]*?refresh_skill_panel\(self\)/);
	assert.match(hud, /elseif action == "attributes_toggle" then[\s\S]*?elseif action == "inventory_toggle" then[\s\S]*?elseif action == "skills_toggle" then/);
	assert.match(hud, /local function toggle_world_detail_panel\(self, panel\)[\s\S]*?set_mount_panel_open\(self, false\)[\s\S]*?set_trade_panel_open\(self, false\)[\s\S]*?set_shop_panel_open\(self, false\)/);
	assert.match(hud, /field\.screen == self\.screen and field_is_available\(self, field\)/);
	assert.match(hud, /button\.screen == self\.screen and button_is_available\(self, button\)/);
	const bottomActions = {
		attributes_toggle: [70, 104],
		inventory_toggle: [190, 104],
		skills_toggle: [310, 104],
		mount_toggle: [878, 100],
		trade_toggle: [986, 100],
		shop_toggle: [1094, 100],
		logout: [1202, 100],
	};
	for (const [action, [x, width]] of Object.entries(bottomActions)) {
		assert.ok(hud.includes(`"${action}"`), `${action} remains wired`);
		assert.match(hud, new RegExp(`"${action}"[^\\n]*, ${x}, 92, ${width}, 32`), `${action} should fit on the bottom command rail`);
	}
});

test("inventory and skill copy is constrained to the bronze panel interiors", () => {
	assert.ok(hud.includes('add_metal_frame(self, "world", 1040, 334, 430, 450'));
	assert.ok(hud.includes('truncate_utf8(string.format("%s · %d MP · %s", definition.name, definition.mana, effect_detail or target_detail), 34)'));
	assert.ok(hud.includes('truncate_utf8(#affix_labels > 0 and table.concat(affix_labels, " · ") or "Sem afixos", 38)'));
	assert.ok(hud.includes('self.world_itemization_stats = add_text(self, "world", 1040, 186'));
	assert.ok(hud.includes('local font = "cinzel"'));
	assert.ok(hud.includes('screen == "world" then'));
});

test("login button and Enter key both submit through the same server action", () => {
	assert.ok(hud.includes('add_button(self, "login", "login", "Entrar", 270, 277, 236, 52)'));
	assert.match(hud, /if action == "login" then\s+send_login\(self\)/);
	assert.match(hud, /if self\.screen == "login" then\s+send_login\(self\)/);
});

test("HTML5 idle throttling is limited to static access screens and never covers server requests", () => {
	assert.ok(hud.includes("local IDLE_ACCESS_THROTTLE_SECONDS = 1.25"));
	assert.match(hud, /self\.html5_preview = sys\.get_sys_info\(\)\.system_name == "HTML5"/);
	assert.match(hud, /local should_throttle = \(self\.screen == "login" or self\.screen == "register"\)\s+and not self\.login_pending and not self\.registration_pending/);
	const inputHandler = hud.slice(hud.indexOf("function on_input(self, action_id, action)"));
	assert.doesNotMatch(inputHandler, /set_access_idle_throttle\(self\)/,
		"do not reset idle throttling on every key or pointer event");
	assert.match(hud, /local function set_screen\(self, screen\)\s+self\.screen = screen\s+set_access_idle_throttle\(self\)/);
	assert.match(hud, /self\.login_pending = true\s+set_access_idle_throttle\(self\)\s+set_status\(self, "Conectando ao servidor Caracatoa local\.\.\."/);
	assert.match(hud, /self\.registration_pending = true\s+set_access_idle_throttle\(self\)\s+msg\.post\("\/local_connection#connection", "ui_register_account"/);
	assert.match(hud, /message_id == hash\("session_error"\) then\s+self\.login_pending = false\s+local screen = message\.screen or "login"/);
});

test("account-registration HTTP errors reach the visible registration status", () => {
	assert.ok(connection.includes('text = decoded.error'));
	assert.match(connection, /post_ui\("account_registration_result", \{ success = false, text = text \}\)/);
	assert.match(hud, /message_id == hash\("account_registration_result"\) then[\s\S]*?set_screen\(self, "register"\)[\s\S]*?set_status\(self, message\.text or "Não foi possível criar a conta local\."/);
});
