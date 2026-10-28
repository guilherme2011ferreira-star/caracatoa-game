import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gearRoot = join(projectRoot, "assets", "models", "quaternius", "class-gear");
const classRoot = join(projectRoot, "assets", "models", "quaternius", "classes");
const manifest = JSON.parse(await readFile(join(projectRoot, "assets", "class-gear-manifest.json"), "utf8"));

function accessorData(gltf, binary, index) {
	const accessor = gltf.accessors[index];
	const view = gltf.bufferViews[accessor.bufferView];
	const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
	return { accessor, view, offset };
}

test("all four classes have distinct skinned face and equipment meshes", async () => {
	assert.deepEqual(manifest.classes.map(({ class: name }) => name), ["TK", "Foema", "BM", "HT"]);
	for (const entry of manifest.classes) {
		assert.ok(entry.triangleCount >= 1500, `${entry.class} has a readable set of authored gear`);
		const gltf = JSON.parse(await readFile(join(gearRoot, `${entry.outputFile}.gltf`), "utf8"));
		const binary = await readFile(join(gearRoot, `${entry.outputFile}.bin`));
		assert.equal(gltf.asset.version, "2.0");
		assert.equal(gltf.buffers[0].byteLength, binary.length);
		assert.ok(gltf.skins[0].joints.length < 255, "skin indices fit UBYTE");
		assert.ok(gltf.materials.some(({ name }) => name === `Caracatoa_Face_${entry.class === "Foema" || entry.class === "HT" ? "female" : "male"}`));
		assert.ok(gltf.materials.some(({ name }) => name === "Caracatoa_Eyes"));
		assert.ok(gltf.materials.some(({ name }) => name === `Caracatoa_Hair_${entry.outputFile}`));
		assert.ok(entry.licensedHead.faceTriangles > 1800, `${entry.class} has a textured head and neck`);
		assert.ok(entry.licensedHead.hairTriangles > 700, `${entry.class} has an authored hairstyle`);
		const additions = gltf.nodes.filter(({ name }) => name?.startsWith("Caracatoa_") && name.endsWith("_skinned"));
		assert.ok(additions.length >= 8, `${entry.class} includes face and class gear nodes`);
		for (const node of additions) {
			assert.equal(node.skin, 0);
			const mesh = gltf.meshes[node.mesh];
			assert.ok(mesh?.primitives?.length === 1);
			const primitive = mesh.primitives[0];
			for (const attributeName of ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]) {
				assert.ok(Number.isInteger(primitive.attributes[attributeName]), `${node.name}: ${attributeName}`);
			}
			const { accessor, view } = accessorData(gltf, binary, primitive.indices);
			assert.ok(accessor.count >= 6 && view.byteOffset + view.byteLength <= binary.length);
			const vertexCount = gltf.accessors[primitive.attributes.POSITION].count;
			for (const attr of Object.values(primitive.attributes)) {
				const data = accessorData(gltf, binary, attr);
				assert.ok(data.view.byteOffset + data.view.byteLength <= binary.length, `${node.name}: accessor in buffer range`);
				if ([primitive.attributes.JOINTS_0, primitive.attributes.WEIGHTS_0].includes(attr)) assert.equal(data.accessor.count, vertexCount);
			}
		}
		const model = await readFile(join(classRoot, `${entry.outputFile}.model`), "utf8");
		for (const materialData of gltf.materials.filter(({ name }) => name.startsWith("Caracatoa_"))) {
			const { name: material } = materialData;
			assert.match(model, new RegExp(`name: "${material}"`));
			const textureIndex = materialData.pbrMetallicRoughness?.baseColorTexture?.index;
			if (Number.isInteger(textureIndex)) {
				const image = gltf.images[gltf.textures[textureIndex].source];
				assert.ok(image.uri.startsWith("../heads/"), `${material}: licensed face material uses the head asset folder`);
				assert.ok(await stat(join(projectRoot, "assets", "models", "quaternius", "heads", image.uri.slice("../heads/".length))));
			} else {
				assert.ok(await stat(join(projectRoot, "assets", "models", "quaternius", "palettes", `${material}.png`)));
			}
		}
	}
});
