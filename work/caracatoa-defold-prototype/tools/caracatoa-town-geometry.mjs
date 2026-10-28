export function gabledRoofSurfaces(cx, y, cz, width, depth, height) {
	const x0 = cx - width / 2;
	const x1 = cx + width / 2;
	const z0 = cz - depth / 2;
	const z1 = cz + depth / 2;
	const ridge0 = [cx, y + height, z0];
	const ridge1 = [cx, y + height, z1];
	return {
		roof: [
			[[x0, y, z0], [x0, y, z1], ridge1, ridge0],
			[ridge0, ridge1, [x1, y, z1], [x1, y, z0]],
		],
		gable: [
			[[x0, y, z1], [x1, y, z1], ridge1],
			[[x1, y, z0], [x0, y, z0], ridge0],
		],
		eaveLeft: [[x0, y, z0], [x0, y, z1]],
		eaveRight: [[x1, y, z0], [x1, y, z1]],
	};
}
