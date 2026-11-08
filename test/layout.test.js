import test from "node:test";
import assert from "node:assert/strict";

import { buildMosaic, getAreaDistribution } from "../src/layout.js";

function makeAlbums(weights, prefix = "a") {
  return weights.map((weight, i) => ({
    id: `${prefix}${i}`,
    image: `https://example.com/${prefix}${i}.jpg`,
    weight
  }));
}

function randomWeights(count, seed) {
  let s = seed;
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647;

  return Array.from({ length: count }, () => 1 + Math.floor(next() ** 4 * 12));
}

function assertValidLayout(layout, expectedIds) {
  const { tiles, columns, rows } = layout;

  assert.deepEqual(
    tiles.map(t => t.id).sort(),
    [...expectedIds].sort(),
    "every album appears exactly once"
  );

  const grid = new Uint8Array(columns * rows);

  for (const t of tiles) {
    assert.ok(t.x >= 0 && t.y >= 0, "inside the grid");
    assert.ok(t.x + t.size <= columns && t.y + t.size <= rows, "inside the grid");

    for (let y = t.y; y < t.y + t.size; y++) {
      for (let x = t.x; x < t.x + t.size; x++) {
        assert.equal(grid[y * columns + x], 0, "tiles do not overlap");
        grid[y * columns + x] = 1;
      }
    }
  }
}

test("returns an empty layout for no albums", () => {
  assert.deepEqual(buildMosaic([]), { tiles: [], columns: 0, rows: 0 });
  assert.deepEqual(
    buildMosaic([{ id: "x", weight: 1, hidden: true }]),
    { tiles: [], columns: 0, rows: 0 }
  );
});

test("every album appears once, with no overlaps", () => {
  for (const count of [1, 2, 5, 12, 30, 80, 200]) {
    for (const seed of [1, 2, 3]) {
      const albums = makeAlbums(randomWeights(count, seed * 97 + count), `s${seed}-`);
      const layout = buildMosaic(albums, { seed });

      assertValidLayout(layout, albums.map(a => a.id));
    }
  }
});

test("hidden albums and repeated covers are skipped", () => {
  const albums = [
    { id: "a", image: "same.jpg", weight: 3 },
    { id: "b", image: "same.jpg", weight: 2 },
    { id: "a", image: "other.jpg", weight: 1 },
    { id: "c", image: "c.jpg", weight: 1, hidden: true },
    { id: "d", image: "d.jpg", weight: 1 }
  ];

  const layout = buildMosaic(albums, { seed: 4 });

  assert.deepEqual(layout.tiles.map(t => t.id).sort(), ["a", "d"]);
});

test("the same seed reproduces the same layout", () => {
  const weights = randomWeights(25, 11);

  const first = buildMosaic(makeAlbums(weights, "p"), { seed: 42 });
  const second = buildMosaic(makeAlbums(weights, "q"), { seed: 42 });

  const strip = layout =>
    layout.tiles.map(({ x, y, size }) => [x, y, size]);

  assert.deepEqual(strip(first), strip(second));
});

test("demo playlist forms a left-right symmetric outline", () => {
  const albums = makeAlbums([5, 4, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1], "demo");

  for (const seed of [1, 2, 3, 4, 5]) {
    const { tiles, columns, rows } = buildMosaic(albums, { seed });
    const grid = new Uint8Array(columns * rows);

    for (const t of tiles) {
      for (let y = t.y; y < t.y + t.size; y++) {
        for (let x = t.x; x < t.x + t.size; x++) grid[y * columns + x] = 1;
      }
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        assert.equal(
          grid[y * columns + x],
          grid[y * columns + (columns - 1 - x)],
          `seed ${seed}: outline is symmetric`
        );
      }
    }
  }
});

test("area distribution sums to 100%", () => {
  const distribution = getAreaDistribution(makeAlbums([1, 2, 3, 4]));
  const total = distribution.reduce((sum, d) => sum + d.percentage, 0);

  assert.ok(Math.abs(total - 100) < 1e-9);
});
