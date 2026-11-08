
// src/layout.js

/**
 * Build a mosaic where every album appears exactly once.
 *
 * Each album becomes one square tile whose side (in grid units)
 * grows with the square root of its weight, so area tracks weight.
 *
 * First target outlines are chosen: rectangles whose area roughly
 * matches the tiles, optionally with identical notches cut from the
 * two bottom corners or all four corners, so the shape stays symmetric.
 *
 * An outline is filled cell by cell. At each spot a tile size is
 * picked by how far that size lags behind the overall progress, which
 * spreads large covers evenly instead of stacking them on top. Tiles
 * may flex by a unit or two to close gaps, and a bounded backtracking
 * search looks for a perfect fill, with a greedy fill as fallback.
 *
 * Results are scored on their final outline and the tidiest is kept.
 * The same seed always produces the same layout.
 */

const MIN_TILE = 2;
const MAX_TILE = 8;
const COARSE_MAX_TILE = 5;
const SMALL_COLLECTION = 16;
const MAX_SHAPES = 24;
const LAG_PULL = 5;
const AREA_SLACK = 0.1;
const EXACT_SEARCH_LIMIT = 30;
const EXACT_RESTARTS = 4;
const EXACT_NODES = 2500;
const EXACT_SOLUTIONS = 6;
const DISCONNECTED_PENALTY = 1e6;

let cache = { key: "", result: null };

export function buildMosaic(items, { seed = 1, shape = "classic" } = {}) {
  const empty = { tiles: [], columns: 0, rows: 0 };

  if (!Array.isArray(items) || !items.length) return empty;

  const albums = uniqueAlbums(items);

  if (!albums.length) return empty;

  const preset = PRESETS[shape] ? shape : null;

  const key = `${seed}|${preset || "classic"}|` + albums
    .map(item => `${item.id}:${getSafeWeight(item.weight)}`)
    .join(",");

  if (cache.key === key) {
    const byId = new Map(albums.map(item => [item.id, item]));

    return {
      ...cache.result,
      tiles: cache.result.tiles.map(tile => ({
        ...tile,
        album: byId.get(tile.id)
      }))
    };
  }

  // Big collections use a coarser size scale so single-unit tiles
  // exist to plug the gaps between larger covers.
  const coarse = albums.length > SMALL_COLLECTION;
  const minTile = coarse ? 1 : MIN_TILE;
  const maxTile = coarse ? COARSE_MAX_TILE : MAX_TILE;

  const weights = albums.map(item => getSafeWeight(item.weight));
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);

  const spread = Math.sqrt(maxWeight / minWeight);
  const scale = Math.min(minTile, maxTile / spread);

  const sized = albums.map((item, i) => ({
    item,
    size: Math.max(
      1,
      Math.min(
        maxTile,
        Math.round(scale * Math.sqrt(weights[i] / minWeight))
      )
    )
  }));

  const random = mulberry32(seed);

  const totalArea = sized.reduce((sum, t) => sum + t.size * t.size, 0);
  const largest = Math.max(...sized.map(t => t.size));

  const exact = sized.length <= EXACT_SEARCH_LIMIT;

  // The greedy fill used for big collections works best when the
  // outline area matches the tiles exactly.
  const shapes = preset
    ? presetCandidates(preset, totalArea, largest, minTile, random)
    : shapeCandidates(totalArea, largest, random, exact ? 0 : 0.3);

  if (!shapes.length) {
    shapes.push(...shapeCandidates(totalArea, largest, random, 0.3));
  }

  const limits = { minTile, maxTile };

  let best = null;

  // Look for outlines that can be filled perfectly.
  let found = 0;

  const restarts = exact ? EXACT_RESTARTS : 2;
  const nodeLimit = EXACT_NODES + sized.length * 4;

  for (const shape of shapes) {
    for (let i = 0; i < restarts; i++) {
      const layout = solveShape(sized, shape, random, limits, nodeLimit);

      if (!layout) continue;

      found++;

      if (!best || layout.score < best.score) {
        best = layout;
      }

      break;
    }

    if (found >= EXACT_SOLUTIONS) break;
  }

  // Greedy fill: cheap extra candidates for small collections,
  // and the fallback when no perfect fill was found.
  const budget =
    sized.length > 250 ? 80 :
    sized.length > 30 ? 200 :
    400;

  const tries = Math.max(3, Math.floor(budget / shapes.length));
  const greedyShapes = exact || !best ? shapes : [];

  for (const shape of greedyShapes) {
    for (let i = 0; i < tries; i++) {
      const layout = fillShape(sized, shape, random, limits);

      if (!best || layout.score < best.score) {
        best = layout;
      }
    }
  }

  if (!best.connected) {
    best = gravityPack(sized, random);
  }

  const result = {
    tiles: best.tiles,
    columns: best.columns,
    rows: best.rows
  };

  cache = { key, result };

  return result;
}

/**
 * Drop hidden albums and any repeated album (same id or same cover).
 */
function uniqueAlbums(items) {
  const ids = new Set();
  const images = new Set();
  const result = [];

  for (const item of items) {
    if (!item || item.hidden) continue;
    if (ids.has(item.id)) continue;
    if (item.image && images.has(item.image)) continue;

    ids.add(item.id);
    if (item.image) images.add(item.image);

    result.push(item);
  }

  return result;
}

/**
 * List outlines whose area exactly equals the tile area.
 * Missing cells only ever come from mirrored corner notches.
 */
function shapeCandidates(area, largest, random, exactness) {
  const shapes = [];
  const base = Math.sqrt(area);

  const minW = Math.max(largest, Math.floor(base * 0.8));
  const maxW = Math.max(minW, Math.ceil(base * 1.25));

  // Tiles can flex a little, so the outline area may differ
  // slightly from the nominal tile area.
  const low = area * (1 - AREA_SLACK);
  const high = area * (1 + AREA_SLACK);

  for (let w = minW; w <= maxW; w++) {
    const minH = Math.max(largest, Math.floor(low / w));
    const maxH = Math.ceil(high / w) + 2;

    for (let h = minH; h <= maxH; h++) {
      if (Math.abs(w - h) > Math.max(w, h) * 0.4) continue;

      const full = w * h;

      if (full >= low && full <= high) {
        shapes.push({ w, h, corners: 0, nw: 0, nh: 0, space: full });
      }

      for (const corners of [2, 4]) {
        const rowsAvailable = Math.max(1, Math.ceil(h * 0.25));

        for (let nw = 1; nw <= w / 3; nw++) {
          for (let nh = 1; nh <= rowsAvailable; nh++) {
            if (Math.max(nw, nh) > Math.min(nw, nh) * 4) continue;

            const space = full - corners * nw * nh;

            if (space < low || space > high) continue;
            if (full - space > full * 0.14) continue;

            shapes.push({ w, h, corners, nw, nh, space });
          }
        }
      }
    }
  }

  if (!shapes.length) {
    const w = Math.max(largest, Math.ceil(base));
    const h = Math.max(largest, Math.ceil(area / w));

    shapes.push({ w, h, corners: 0, nw: 0, nh: 0, space: w * h });
  }

  // Prefer near-square outlines that match the tile area,
  // then keep a manageable number.
  return shapes
    .map(shape => ({
      shape,
      rank:
        Math.abs(shape.w - shape.h) +
        Math.abs(shape.space - area) * exactness +
        Math.abs(shape.space - area) / area * 25 +
        (shape.w * shape.h - shape.space) / (shape.w * shape.h) * 10 +
        (shape.corners ? 0.5 : 0) +
        random() * 1.5
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_SHAPES)
    .map(entry => entry.shape);
}

/**
 * Preset outlines. `inside(u, v)` gets coordinates in [-1, 1] with v
 * pointing down; every shape is left-right symmetric.
 */
const PRESETS = {
  heart: {
    aspect: 1.02,
    inside(u, v) {
      const x = u * 1.14;
      const y = 1.22 - (v + 1) * 1.11;
      const a = x * x + y * y - 1;
      return a * a * a - x * x * y * y * y <= 0;
    }
  },
  circle: {
    aspect: 1,
    inside: (u, v) => u * u + v * v <= 1
  },
  diamond: {
    aspect: 1,
    inside: (u, v) => Math.abs(u) + Math.abs(v) <= 1.04
  },
  hexagon: {
    aspect: 1.155,
    inside: (u, v) => Math.abs(u) + Math.abs(v) * 0.5 <= 1
  }
};

export const SHAPES = ["classic", ...Object.keys(PRESETS)];

/**
 * Rasterise a preset on a grid of `block`-sized cells, so outline
 * steps are never smaller than the smallest tile.
 */
function presetMask(preset, bw, bh, block) {
  const w = bw * block;
  const h = bh * block;
  const mask = new Uint8Array(w * h);
  let space = 0;

  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const u = ((i + 0.5) / bw) * 2 - 1;
      const v = ((j + 0.5) / bh) * 2 - 1;

      if (!preset.inside(u, v)) continue;

      for (let y = j * block; y < (j + 1) * block; y++) {
        for (let x = i * block; x < (i + 1) * block; x++) {
          mask[y * w + x] = 1;
        }
      }

      space += block * block;
    }
  }

  return { w, h, mask, space, preset: true };
}

function presetCandidates(name, area, largest, block, random) {
  const preset = PRESETS[name];
  const shapes = [];
  const seen = new Set();

  for (const stretch of [0.92, 1, 1.08]) {
    const aspect = preset.aspect * stretch;
    const sizeFor = bh => Math.max(1, Math.round(bh * aspect));

    let bestH = 2;
    let bestDiff = Infinity;

    for (let bh = 2; bh < 200; bh++) {
      const { space } = presetMask(preset, sizeFor(bh), bh, block);
      const diff = Math.abs(space - area);

      if (diff < bestDiff) {
        bestDiff = diff;
        bestH = bh;
      }

      if (space > area * 1.3) break;
    }

    for (const bh of [bestH - 1, bestH, bestH + 1]) {
      if (bh < 2) continue;

      const shape = presetMask(preset, sizeFor(bh), bh, block);
      const key = `${shape.w}x${shape.h}`;

      if (seen.has(key) || Math.max(shape.w, shape.h) < largest) continue;
      if (Math.abs(shape.space - area) > area * 0.25) continue;

      seen.add(key);
      shapes.push(shape);
    }
  }

  return shapes
    .map(shape => ({
      shape,
      rank: Math.abs(shape.space - area) / area * 25 + random()
    }))
    .sort((a, b) => a.rank - b.rank)
    .map(entry => entry.shape);
}

function buildMask({ w, h, corners, nw, nh, mask: preset }) {
  if (preset) return preset;

  const mask = new Uint8Array(w * h).fill(1);

  const cut = (x0, y0) => {
    for (let y = y0; y < y0 + nh; y++) {
      for (let x = x0; x < x0 + nw; x++) {
        mask[y * w + x] = 0;
      }
    }
  };

  if (corners >= 2) {
    cut(0, h - nh);
    cut(w - nw, h - nh);
  }

  if (corners === 4) {
    cut(0, 0);
    cut(w - nw, 0);
  }

  return mask;
}

/**
 * Sizes a tile may be drawn at: its nominal size first, then
 * slightly smaller or larger ones that can close a gap.
 */
function sizeVariants(s, { minTile, maxTile }) {
  const span = s >= 5 ? 2 : 1;
  const out = [s];

  for (let d = 1; d <= span; d++) out.push(s - d, s + d);

  return out.filter(t =>
    t >= Math.max(1, Math.min(s, minTile)) &&
    t <= Math.max(s, maxTile + 1)
  );
}

/**
 * Crop a layout to its bounding box and score how tidy its outline is.
 * Classic outlines: empty cells are fine only in mirrored corners;
 * holes inside the mosaic or dents in the middle of an edge are
 * penalised. Preset outlines: scored by how closely they match the
 * target mask. Disconnected layouts are always rejected.
 */
function finishLayout(tiles, deviation, random, target = null) {
  const mismatch = target ? maskMismatch(tiles, target) : 0;

  const minX = Math.min(...tiles.map(t => t.x));
  const minY = Math.min(...tiles.map(t => t.y));

  for (const tile of tiles) {
    tile.x -= minX;
    tile.y -= minY;
  }

  const w = Math.max(...tiles.map(t => t.x + t.size));
  const h = Math.max(...tiles.map(t => t.y + t.size));

  const filled = new Uint8Array(w * h);

  for (const t of tiles) {
    for (let y = t.y; y < t.y + t.size; y++) {
      for (let x = t.x; x < t.x + t.size; x++) {
        filled[y * w + x] = 1;
      }
    }
  }

  let empty = 0;
  let asymmetric = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = filled[y * w + x];

      if (!cell) empty++;
      if (cell !== filled[y * w + (w - 1 - x)]) asymmetric++;
    }
  }

  // Group empty cells into regions; only regions that touch a
  // corner of the bounding box count as clean notches.
  const seen = new Uint8Array(w * h);
  let misplaced = 0;
  let holes = 0;

  for (let start = 0; start < w * h; start++) {
    if (filled[start] || seen[start]) continue;

    const stack = [start];
    let size = 0;
    let border = false;
    let corner = false;

    seen[start] = 1;

    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i - x) / w;

      size++;

      const edgeX = x === 0 || x === w - 1;
      const edgeY = y === 0 || y === h - 1;

      if (edgeX || edgeY) border = true;
      if (edgeX && edgeY) corner = true;

      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;

        const j = ny * w + nx;

        if (!filled[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }

    if (!border) {
      holes += size;
      misplaced += size * 3;
    } else if (!corner) {
      misplaced += size;
    }
  }

  const connected = isConnected(tiles, filled, w, h);

  const outline = target
    ? holes * 24 + mismatch * 5 + asymmetric
    : misplaced * 8 + asymmetric * 3 + empty * 0.15 + Math.abs(w - h);

  const score =
    (connected ? 0 : DISCONNECTED_PENALTY) +
    outline +
    deviation * 6 +
    random() * 1.5;

  return { tiles, columns: w, rows: h, score, connected };
}

// Cells covered outside the target plus target cells left empty.
function maskMismatch(tiles, { w, h, mask, space }) {
  let outside = 0;
  let covered = 0;

  for (const t of tiles) {
    for (let y = t.y; y < t.y + t.size; y++) {
      for (let x = t.x; x < t.x + t.size; x++) {
        if (x < w && y < h && mask[y * w + x]) covered++;
        else outside++;
      }
    }
  }

  return outside + (space - covered);
}

/**
 * True when every tile can be reached from every other tile through
 * shared edges (touching corners do not count).
 */
function isConnected(tiles, filled, w, h) {
  if (tiles.length <= 1) return true;

  const owner = new Int32Array(w * h).fill(-1);

  tiles.forEach((t, k) => {
    for (let y = t.y; y < t.y + t.size; y++) {
      for (let x = t.x; x < t.x + t.size; x++) owner[y * w + x] = k;
    }
  });

  const neighbours = tiles.map(() => new Set());

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = owner[y * w + x];
      if (a < 0) continue;

      const right = x + 1 < w ? owner[y * w + x + 1] : -1;
      const below = y + 1 < h ? owner[(y + 1) * w + x] : -1;

      for (const b of [right, below]) {
        if (b >= 0 && b !== a) {
          neighbours[a].add(b);
          neighbours[b].add(a);
        }
      }
    }
  }

  const seen = new Set([0]);
  const queue = [0];

  while (queue.length) {
    for (const next of neighbours[queue.pop()]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return seen.size === tiles.length;
}

/**
 * Last-resort packer that is always connected: each tile drops to the
 * highest free row, leftmost first, so it touches the tile above it or
 * its left neighbour on the top row.
 */
function gravityPack(sized, random) {
  const area = sized.reduce((sum, t) => sum + t.size * t.size, 0);
  const largest = Math.max(...sized.map(t => t.size));
  const w = Math.max(largest, Math.round(Math.sqrt(area)));

  const rows = [];

  const free = (x, y, s) => {
    for (let yy = y; yy < y + s && yy < rows.length; yy++) {
      for (let xx = x; xx < x + s; xx++) {
        if (rows[yy][xx]) return false;
      }
    }

    return true;
  };

  const order = shuffle([...sized], random).sort((a, b) => b.size - a.size);
  const tiles = [];

  for (const { item, size } of order) {
    let spot = null;

    for (let y = 0; !spot; y++) {
      for (let x = 0; x + size <= w && !spot; x++) {
        if (free(x, y, size)) spot = { x, y };
      }
    }

    while (rows.length < spot.y + size) rows.push(new Uint8Array(w));

    for (let yy = spot.y; yy < spot.y + size; yy++) {
      for (let xx = spot.x; xx < spot.x + size; xx++) rows[yy][xx] = 1;
    }

    tiles.push({ id: item.id, album: item, x: spot.x, y: spot.y, size, area: size * size });
  }

  return finishLayout(tiles, 0, random);
}

/**
 * Bounded backtracking search that fills the outline exactly,
 * with no holes and no overflow. Returns null if none is found
 * within the node budget.
 */
function solveShape(sized, shape, random, limits, nodeLimit) {
  const { w, h } = shape;
  const mask = buildMask(shape);
  const cells = w * h;

  const grid = new Uint8Array(cells);
  let space = 0;

  for (let i = 0; i < cells; i++) {
    if (mask[i]) space++;
    else grid[i] = 1;
  }

  const spaceTotal = space;

  const bySize = new Map();

  for (const tile of sized) {
    if (!bySize.has(tile.size)) {
      const variants = sizeVariants(tile.size, limits);

      bySize.set(tile.size, {
        s: tile.size,
        items: [],
        total: 0,
        left: 0,
        variants,
        minA: Math.min(...variants) ** 2,
        maxA: Math.max(...variants) ** 2
      });
    }

    const group = bySize.get(tile.size);

    group.items.push(tile.item);
    group.total += tile.size ** 2;
    group.left += tile.size ** 2;
  }

  const groups = [...bySize.values()];

  for (const group of groups) shuffle(group.items, random);

  let remaining = sized.length;
  let minArea = 0;
  let maxArea = 0;

  for (const group of groups) {
    minArea += group.minA * group.items.length;
    maxArea += group.maxA * group.items.length;
  }

  const maxFlex = Math.max(2, Math.ceil(sized.length * 0.5));

  let flexCount = 0;
  let deviation = 0;
  let nodes = 0;

  const placed = [];

  const fits = (x, y, t) => {
    if (x + t > w || y + t > h) return false;

    for (let yy = y; yy < y + t; yy++) {
      for (let xx = x; xx < x + t; xx++) {
        if (grid[yy * w + xx]) return false;
      }
    }

    return true;
  };

  const mark = (x, y, t, value) => {
    for (let yy = y; yy < y + t; yy++) {
      for (let xx = x; xx < x + t; xx++) {
        grid[yy * w + xx] = value;
      }
    }
  };

  const smallestSide = () => {
    let min = Infinity;

    for (const group of groups) {
      if (group.items.length) {
        min = Math.min(min, ...group.variants);
      }
    }

    return min;
  };

  const search = start => {
    if (++nodes > nodeLimit) return false;

    let idx = start;
    while (idx < cells && grid[idx]) idx++;

    if (idx === cells) return remaining === 0;
    if (!remaining) return false;
    if (space < minArea || space > maxArea) return false;

    const x = idx % w;
    const y = (idx - x) / w;

    let run = 0;
    while (x + run < w && !grid[y * w + x + run]) run++;

    const progress = space / spaceTotal;
    const smallest = smallestSide();
    const options = [];

    for (const group of groups) {
      if (!group.items.length) continue;

      const lag = group.left / group.total - progress;

      for (const t of group.variants) {
        const flexed = t !== group.s;

        if (flexed && flexCount >= maxFlex) continue;
        if (t > run || !fits(x, y, t)) continue;

        const rest = run - t;
        if (rest > 0 && rest < smallest) continue;

        const flex = flexed ? 0.15 / Math.abs(t - group.s) : 1;

        options.push({
          group,
          t,
          weight:
            Math.exp(lag * LAG_PULL) *
            flex *
            (0.2 + random() * 1.6)
        });
      }
    }

    options.sort((a, b) => b.weight - a.weight);

    for (const { group, t } of options) {
      const item = group.items.pop();
      const flexed = t !== group.s;
      const dev = Math.abs(t - group.s) / group.s;

      remaining--;
      minArea -= group.minA;
      maxArea -= group.maxA;
      group.left -= group.s ** 2;
      space -= t * t;
      deviation += dev;
      if (flexed) flexCount++;

      mark(x, y, t, 1);
      placed.push({ item, x, y, t });

      if (search(idx + t)) return true;

      placed.pop();
      mark(x, y, t, 0);

      remaining++;
      minArea += group.minA;
      maxArea += group.maxA;
      group.left += group.s ** 2;
      space += t * t;
      deviation -= dev;
      if (flexed) flexCount--;

      group.items.push(item);

      if (nodes > nodeLimit) return false;
    }

    return false;
  };

  if (!search(0)) return null;

  const tiles = placed.map(({ item, x, y, t }) => ({
    id: item.id,
    album: item,
    x,
    y,
    size: t,
    area: t * t
  }));

  return finishLayout(tiles, deviation, random, shape.preset ? shape : null);
}

function fillShape(sized, shape, random, { minTile, maxTile }) {
  const { w, h } = shape;
  const mask = buildMask(shape);

  const inside = (x, y) =>
    x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x] === 1;

  // Occupancy grid that can grow below the outline for overflow.
  const rows = [];

  const ensureRows = count => {
    while (rows.length < count) rows.push(new Uint8Array(w));
  };

  ensureRows(h);

  const isFree = (x, y) => y >= rows.length || rows[y][x] === 0;

  const fitsInside = (x, y, s) => {
    if (x + s > w || y + s > h) return false;

    for (let yy = y; yy < y + s; yy++) {
      for (let xx = x; xx < x + s; xx++) {
        if (!inside(xx, yy) || rows[yy][xx]) return false;
      }
    }

    return true;
  };

  const occupy = (x, y, s, value = 1) => {
    ensureRows(y + s);

    for (let yy = y; yy < y + s; yy++) {
      for (let xx = x; xx < x + s; xx++) {
        rows[yy][xx] = value;
      }
    }
  };

  // Group tiles by size, shuffled within each group.
  const groups = new Map();

  for (const tile of sized) {
    if (!groups.has(tile.size)) {
      groups.set(tile.size, { items: [], total: 0, left: 0 });
    }

    const group = groups.get(tile.size);
    const area = tile.size * tile.size;

    group.items.push(tile.item);
    group.total += area;
    group.left += area;
  }

  for (const group of groups.values()) shuffle(group.items, random);

  const sizes = [...groups.keys()].sort((a, b) => a - b);

  let spaceTotal = 0;
  for (const cell of mask) spaceTotal += cell;

  let spaceLeft = spaceTotal;

  const tiles = [];

  const place = (item, x, y, s) => {
    occupy(x, y, s);
    tiles.push({ id: item.id, album: item, x, y, size: s, area: s * s });
  };

  const variants = s => sizeVariants(s, { minTile, maxTile });

  const smallestLeft = exclude => {
    for (const s of sizes) {
      const count = groups.get(s).items.length - (s === exclude ? 1 : 0);
      if (count > 0) return Math.min(...variants(s));
    }

    return Infinity;
  };

  let nominalLeft = 0;
  for (const group of groups.values()) nominalLeft += group.left;

  let deviation = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y) || rows[y][x]) continue;

      let run = 0;
      while (x + run < w && inside(x + run, y) && !rows[y][x + run]) {
        run++;
      }

      const progress = spaceLeft / spaceTotal;

      // Positive when there is more room left than tiles to fill it.
      const surplus = spaceLeft - nominalLeft;

      let choice = null;
      let bestWeight = -1;

      for (const s of sizes) {
        const group = groups.get(s);

        if (!group.items.length) continue;

        const lag = group.left / group.total - progress;
        const smallest = smallestLeft(s);

        for (const t of variants(s)) {
          if (!fitsInside(x, y, t)) continue;

          const rest = run - t;
          const strands = rest > 0 && rest < smallest;

          let flex = 1;

          if (t !== s) {
            const helps = (t > s) === (surplus > 0) && surplus !== 0;
            flex = helps ? 0.12 : 0.02;
          }

          // Hold back some of the smallest tiles for the final gaps.
          const reserve =
            s === sizes[0] && sizes.length > 1 && progress > 0.12
              ? 0.5
              : 1;

          const weight =
            Math.exp(lag * LAG_PULL) *
            flex *
            reserve *
            (strands ? 0.1 : 1) *
            (0.2 + random() * 1.6);

          if (weight > bestWeight) {
            bestWeight = weight;
            choice = { s, t };
          }
        }
      }

      if (!choice) {
        occupy(x, y, 1, 2);
        spaceLeft--;
        continue;
      }

      const { s, t } = choice;
      const group = groups.get(s);

      place(group.items.pop(), x, y, t);

      group.left -= s * s;
      nominalLeft -= s * s;
      spaceLeft -= t * t;
      deviation += Math.abs(t - s) / s;
    }
  }

  // Cells skipped as unfillable are open again for the leftovers.
  for (const row of rows) {
    for (let x = 0; x < w; x++) {
      if (row[x] === 2) row[x] = 0;
    }
  }

  // Anything that did not fit goes in the highest free spot, kept near
  // the middle. Taking the highest row means each leftover rests against
  // a tile above it, so the mosaic stays connected.
  const leftovers = sizes
    .flatMap(s => groups.get(s).items.map(item => ({ item, s })))
    .sort((a, b) => b.s - a.s);

  for (const { item, s } of leftovers) {
    let spot = null;

    for (let y = 0; !spot; y++) {
      let bestOffset = Infinity;

      for (let x = 0; x + s <= w; x++) {
        let ok = true;

        for (let yy = y; yy < y + s && ok; yy++) {
          for (let xx = x; xx < x + s && ok; xx++) {
            if (!isFree(xx, yy)) ok = false;
          }
        }

        const offset = Math.abs(x + s / 2 - w / 2);

        if (ok && offset < bestOffset) {
          bestOffset = offset;
          spot = { x, y };
        }
      }
    }

    place(item, spot.x, spot.y, s);
  }

  return finishLayout(tiles, deviation, random, shape.preset ? shape : null);
}

function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }

  return list;
}

/**
 * Small deterministic PRNG so a seed reproduces a layout.
 */
function mulberry32(seed) {
  let a = seed >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) >>> 0;

    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Calculate weight percentages.
 */
export function getAreaDistribution(items) {
  const visible = items.filter(
    item => !item.hidden
  );

  const total = visible.reduce(
    (sum, item) => sum + getSafeWeight(item.weight),
    0
  );

  if (!total) return [];

  return visible.map(item => ({
    id: item.id,
    weight: item.weight,
    percentage:
      getSafeWeight(item.weight) / total * 100
  }));
}

function getSafeWeight(value) {
  return Math.max(0.01, Number(value) || 0.01);
}
