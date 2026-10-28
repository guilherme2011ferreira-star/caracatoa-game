import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const client = join(root, "work", "caracatoa-defold-prototype");
const clipRoot = join(client, "assets", "models", "quaternius", "animations", "clips");

function parseGlb(bytes) {
	assert.equal(bytes.toString("ascii", 0, 4), "glTF");
	assert.equal(bytes.readUInt32LE(4), 2);
	let offset = 12;
	let json;
	let binary;
	while (offset + 8 <= bytes.length) {
		const length = bytes.readUInt32LE(offset);
		const type = bytes.readUInt32LE(offset + 4);
		offset += 8;
		const chunk = bytes.subarray(offset, offset + length);
		if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8").trimEnd());
		if (type === 0x004e4942) binary = chunk;
		offset += length;
	}
	assert.ok(json && binary);
	return { json, binary };
}

function accessorValues(json, binary, index) {
	const accessor = json.accessors[index];
	const view = json.bufferViews[accessor.bufferView];
	const components = accessor.type === "VEC4" ? 4 : 1;
	const stride = view.byteStride ?? components * 4;
	const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	return Array.from({ length: accessor.count }, (_, row) =>
		Array.from({ length: components }, (_, component) => binary.readFloatLE(start + row * stride + component * 4)));
}

const expected = new Map([
	["Caracatoa_TK_Slash", ["spine_02", "upperarm_r", "lowerarm_r", "hand_r", "upperarm_l", "lowerarm_l"]],
	["Caracatoa_Foema_Cast", ["spine_02", "upperarm_r", "lowerarm_r", "hand_r", "upperarm_l", "lowerarm_l", "hand_l"]],
	["Caracatoa_BM_Heavy", ["spine_02", "upperarm_r", "lowerarm_r", "hand_r", "upperarm_l", "lowerarm_l"]],
	["Caracatoa_HT_Shot", ["spine_02", "upperarm_l", "lowerarm_l", "upperarm_r", "lowerarm_r", "hand_r"]],
]);

for (const [name, expectedBones] of expected) {
	test(`${name} is a valid one-shot animation with articulated class motion`, async () => {
		const { json, binary } = parseGlb(await readFile(join(clipRoot, `${name}.glb`)));
		const [animation] = json.animations;
		assert.equal(animation.name, name);
		const nodeNames = new Map(json.nodes.map((node, index) => [index, node.name]));
		const actualBones = animation.channels.map(({ target }) => nodeNames.get(target.node));
		assert.deepEqual(actualBones, expectedBones);
		for (const channel of animation.channels) {
			const sampler = animation.samplers[channel.sampler];
			const times = accessorValues(json, binary, sampler.input).map(([time]) => time);
			const rotations = accessorValues(json, binary, sampler.output);
			for (const [index, expectedTime] of [0, 0.11, 0.21, 0.35, 0.52].entries()) {
				assert.ok(Math.abs(times[index] - expectedTime) < 0.00001, `${name} keyframe ${index} has the wrong time`);
			}
			assert.equal(rotations.length, times.length);
			assert.ok(rotations.some((rotation, row) => row > 0 && rotation.some((value, component) => Math.abs(value - rotations[0][component]) > 0.03)));
		}
	});
}

test("all four attack clips are registered and selected by class before client animation", async () => {
	const [animationSet, player, animator] = await Promise.all([
		readFile(join(client, "assets", "models", "quaternius", "animations", "CaracatoaHumanoid.animationset"), "utf8"),
		readFile(join(client, "main", "player.script"), "utf8"),
		readFile(join(client, "main", "avatar_animation.script"), "utf8"),
	]);
	for (const name of expected.keys()) {
		const escapedName = name.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const references = animationSet.match(new RegExp(`/assets/models/quaternius/animations/clips/${escapedName}\\.glb`, "g")) ?? [];
		assert.equal(references.length, 1, `${name} should appear exactly once in the animation set`);
		assert.ok(player.includes(`hash("${name}")`), `${name} is not selected by gameplay`);
	}
	assert.match(animator, /go\.PLAYBACK_ONCE_FORWARD/);
	assert.match(animator, /model\.play_anim\("#model", attack_animation/);
	assert.match(animator, /model_animation_done/);
});
