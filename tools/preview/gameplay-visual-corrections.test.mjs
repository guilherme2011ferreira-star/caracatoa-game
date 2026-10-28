import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gabledRoofSurfaces } from "../../work/caracatoa-defold-prototype/tools/caracatoa-town-geometry.mjs";
import { createCaracatoaNavigationFromTownLayout } from "../../server/caracatoa/caracatoa-town-layout.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const client = resolve(root, "work/caracatoa-defold-prototype");
const read = (path) => readFile(resolve(client, path), "utf8");

function glbJson(bytes) {
	assert.equal(bytes.toString("ascii", 0, 4), "glTF");
	let offset = 12;
	while (offset + 8 <= bytes.length) {
		const length = bytes.readUInt32LE(offset);
		const kind = bytes.readUInt32LE(offset + 4);
		offset += 8;
		if (kind === 0x4e4f534a) return JSON.parse(bytes.toString("utf8", offset, offset + length).trimEnd());
		offset += length;
	}
	throw new Error("GLB JSON chunk missing");
}

function surfaceNormal(face) {
	const [a, b, c] = face;
	const ab = b.map((value, axis) => value - a[axis]);
	const ac = c.map((value, axis) => value - a[axis]);
	return [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
}

test("gable roof covers both eaves and both facades with outward faces", () => {
	const { roof, gable, eaveLeft, eaveRight } = gabledRoofSurfaces(4, 3, 7, 8, 10, 4);
	assert.equal(roof.length, 2);
	assert.equal(gable.length, 2);
	assert.equal(eaveLeft[0][2], 2);
	assert.equal(eaveLeft[1][2], 12);
	assert.equal(eaveRight[0][2], 2);
	assert.equal(eaveRight[1][2], 12);
	assert.ok(surfaceNormal(roof[0]).every(Number.isFinite));
	assert.ok(surfaceNormal(roof[0])[0] < 0, "left roof slope faces outward");
	assert.ok(surfaceNormal(roof[1])[0] > 0, "right roof slope faces outward");
	assert.ok(surfaceNormal(gable[0])[2] > 0, "front gable faces the courtyard");
	assert.ok(surfaceNormal(gable[1])[2] < 0, "rear gable faces the street");
});

test("Defold window requests four-sample antialiasing", async () => {
	const project = await read("game.project");
	assert.match(project, /\[display\][\s\S]*?samples\s*=\s*4/);
});

test("town fountain stays clear of the central route and its obstacle moves with the 3D layout", async () => {
	const [layout, maps, navigationFile] = await Promise.all([
		readFile(resolve(root, "server/caracatoa/data/world/bastiao-layout.json"), "utf8").then(JSON.parse),
		readFile(resolve(root, "server/caracatoa/data/world/maps.json"), "utf8").then(JSON.parse),
		readFile(resolve(root, "server/caracatoa/data/world/navigation.json"), "utf8").then(JSON.parse),
	]);
	const map = maps.entries.find(({ mapId }) => mapId === layout.mapId);
	const navigation = createCaracatoaNavigationFromTownLayout(layout, map.bounds);
	assert.deepEqual(navigation, navigationFile);
	assert.ok(layout.fountain.center[0] - layout.fountain.size[0] / 2 > layout.terrain.ceremonialRoute.center[0] + layout.terrain.ceremonialRoute.cloth.size[0] / 2);
	const fountainZone = navigation.entries[0].blockedZones.find(({ id }) => id === layout.fountain.id);
	assert.ok(fountainZone.bounds[0] <= 144 && fountainZone.bounds[2] >= 144);
	assert.ok(fountainZone.bounds[1] <= 121 && fountainZone.bounds[3] >= 121);
});

test("Golem root and authority updates keep its feet on the paved plane", async () => {
	const player = await read("main/player.script");
	const collection = await read("main/main.collection");
	assert.match(player, /MONSTER_FLOOR_Y\s*=\s*-0\.08/);
	assert.match(collection, /id: "stone_monster"[\s\S]*?y:\s*-0\.08[\s\S]*?x:\s*1\.25[\s\S]*?y:\s*1\.25[\s\S]*?z:\s*1\.25/);
});

test("Golem GLB has UVs on every primitive and uses the painted stone maps", async () => {
	const bytes = await readFile(resolve(client, "assets/models/stone_monster.glb"));
	const json = glbJson(bytes);
	const primitives = json.meshes.flatMap((mesh) => mesh.primitives);
	assert.equal(primitives.length, 13);
	assert.ok(primitives.every((primitive) => Number.isInteger(primitive.attributes.TEXCOORD_0)));
	assert.ok(json.materials.filter(({ name }) => name === "monster" || name === "monsterLight")
		.every(({ pbrMetallicRoughness }) => pbrMetallicRoughness.baseColorFactor.every((value) => value === 1)));
	for (const name of ["stone_monster_monster.png", "stone_monster_monsterLight.png"]) {
		const png = await readFile(resolve(client, "assets/models/palettes", name));
		assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [512, 512]);
	}
});

test("accepted movement turns the selected avatar and successful hits animate it", async () => {
	const player = await read("main/player.script");
	const connection = await read("main/local_connection.script");
	const animation = await read("main/avatar_animation.script");
	assert.match(player, /movement_yaw\(dx, dy\)[\s\S]*?go\.animate\([^\n]*rotation/);
	assert.match(connection, /Session\.parse_skill_attack_result\(body\)[\s\S]*?msg\.post\("\/transknight#movement", "world_attack_confirmed"/);
	assert.match(player, /world_attack_confirmed[\s\S]*?"combat_attack"/);
	assert.match(animation, /combat_attack[\s\S]*?perform_attack\(self, message\.animation/);
	assert.match(animation, /model\.play_anim\("#model", attack_animation, go\.PLAYBACK_ONCE_FORWARD/);
	assert.doesNotMatch(animation, /go\.animate\(/, "skeletal attacks must not override root movement");
	assert.match(player, /if not has_direction\(self\) and not self\.awaiting_authority then[\s\S]*?self\.facing_yaw = yaw/);
});

test("class armor palette textures contain painted variation instead of one flat pixel", async () => {
	const palette = await readFile(resolve(client, "assets/models/quaternius/palettes/Caracatoa_Gold.png"));
	assert.equal(palette.toString("ascii", 1, 4), "PNG");
	assert.deepEqual([palette.readUInt32BE(16), palette.readUInt32BE(20)], [128, 128]);
	const generator = await read("tools/generate-caracatoa-class-gear.mjs");
	assert.match(generator, /function texturePng\(rgba, materialName\)[\s\S]*?128[\s\S]*?smoothNoise/);
});
