import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const align = (value) => Math.ceil(value / 4) * 4;

const createTriangleGlb = (color) => {
  const positions = [
    -0.5, 0, 0,
    0.5, 0, 0,
    0, 1, 0,
  ];
  const binaryLength = 42;
  const paddedBinaryLength = align(binaryLength);
  const binary = Buffer.alloc(paddedBinaryLength);
  positions.forEach((value, index) => {
    binary.writeFloatLE(value, index * 4);
  });
  [0, 1, 2].forEach((value, index) => {
    binary.writeUInt16LE(value, 36 + (index * 2));
  });

  const gltf = {
    asset: {
      version: "2.0",
      generator: "tileset-scope-versioner example",
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        material: 0,
      }],
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: 0,
        roughnessFactor: 1,
      },
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-0.5, 0, 0],
        max: [0.5, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: "SCALAR",
        min: [0],
        max: [2],
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: 36,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: 36,
        byteLength: 6,
        target: 34963,
      },
    ],
    buffers: [{ byteLength: binaryLength }],
  };

  const json = Buffer.from(JSON.stringify(gltf), "utf8");
  const paddedJsonLength = align(json.length);
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinaryLength;
  const glb = Buffer.alloc(totalLength, 0x20);
  glb.write("glTF", 0, "ascii");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(paddedJsonLength, 12);
  glb.write("JSON", 16, "ascii");
  json.copy(glb, 20);
  const binaryHeader = 20 + paddedJsonLength;
  glb.writeUInt32LE(paddedBinaryLength, binaryHeader);
  glb.write("BIN\0", binaryHeader + 4, "ascii");
  binary.copy(glb, binaryHeader + 8);
  return glb;
};

const models = [
  ["data/north/model.glb", [0.15, 0.45, 0.95, 1]],
  ["data/south/model.glb", [0.95, 0.45, 0.15, 1]],
];

for (const [relativePath, color] of models) {
  const target = fileURLToPath(new URL(relativePath, import.meta.url));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, createTriangleGlb(color));
}
