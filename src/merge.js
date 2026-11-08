// src/merge.js
//
// Find and merge albums that are really the same record: different
// editions (deluxe, remaster, anniversary...) with matching titles,
// or near-identical covers from the same artist.

import { loadImage } from "./images.js";

// Words that mark an edition rather than a different record.
// "live" is deliberately absent: a live album is a different record.
const EDITION_WORDS = new RegExp(
  "\\b(" +
    [
      "deluxe", "super deluxe", "expanded", "edition", "editions",
      "remaster", "remastered", "remasters", "anniversary", "version",
      "bonus", "bonus tracks?", "special", "collector'?s", "platinum",
      "complete", "explicit", "clean", "reissue", "mono", "stereo",
      "extended", "tour", "repackage", "\\d{4} mix", "\\d+(st|nd|rd|th)"
    ].join("|") +
  ")\\b",
  "i"
);

// Hamming distance (out of 64 bits) under which two covers count
// as the same artwork.
const HASH_THRESHOLD = 10;

function simplify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Strip edition markers: "Blonde (Deluxe Edition)" -> "blonde",
 * "1989 - Taylor's Version" stays distinct only if no edition word.
 */
export function normalizeTitle(title) {
  let text = String(title || "");

  // Bracketed parts that mention an edition.
  text = text.replace(/[([{]([^)\]}]*)[)\]}]/g, (part, inner) =>
    EDITION_WORDS.test(inner) ? " " : part
  );

  // Trailing " - Deluxe Edition" style suffixes.
  text = text.replace(/\s[-–—:]\s(.*)$/, (part, inner) =>
    EDITION_WORDS.test(inner) ? "" : part
  );

  return simplify(text);
}

export function primaryArtist(artist) {
  return simplify(String(artist || "").split(/,|&|\bfeat\.?\b/i)[0]);
}

export function hammingDistance(a, b) {
  let distance = 0;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }

  return distance;
}

/**
 * 64-bit difference hash of an image, as an array of 0/1.
 * Robust to resizing and recompression, so re-uploads of the same
 * artwork land within a few bits of each other.
 */
export async function coverHash(url) {
  const image = await loadImage(url);
  const canvas = document.createElement("canvas");

  canvas.width = 9;
  canvas.height = 8;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 9, 8);
  image.close();

  const { data } = ctx.getImageData(0, 0, 9, 8);
  const gray = [];

  for (let i = 0; i < data.length; i += 4) {
    gray.push(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
  }

  const bits = [];

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits.push(gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0);
    }
  }

  return bits;
}

/**
 * Hash every cover; failures are skipped (those albums are then
 * matched by title only).
 */
export async function hashCovers(albums) {
  const hashes = new Map();

  const results = await Promise.allSettled(
    albums.map(album => coverHash(album.image))
  );

  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      hashes.set(albums[i].id, result.value);
    }
  });

  return hashes;
}

/**
 * Group albums that should be merged. Only albums by the same primary
 * artist are compared; they match on normalised title or on cover hash.
 * Returns arrays of album ids, one per group of two or more.
 */
export function findMergeGroups(albums, hashes = new Map()) {
  const parent = albums.map((_, i) => i);

  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    parent[find(a)] = find(b);
  };

  const byArtist = new Map();

  albums.forEach((album, i) => {
    const key = primaryArtist(album.artist);

    if (!byArtist.has(key)) byArtist.set(key, []);
    byArtist.get(key).push(i);
  });

  for (const indexes of byArtist.values()) {
    for (let a = 0; a < indexes.length; a++) {
      for (let b = a + 1; b < indexes.length; b++) {
        const first = albums[indexes[a]];
        const second = albums[indexes[b]];

        const sameTitle =
          normalizeTitle(first.title) &&
          normalizeTitle(first.title) === normalizeTitle(second.title);

        const hashA = hashes.get(first.id);
        const hashB = hashes.get(second.id);

        const sameCover =
          hashA && hashB && hammingDistance(hashA, hashB) <= HASH_THRESHOLD;

        if (sameTitle || sameCover) union(indexes[a], indexes[b]);
      }
    }
  }

  const groups = new Map();

  albums.forEach((album, i) => {
    const root = find(i);

    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(album.id);
  });

  return [...groups.values()].filter(group => group.length > 1);
}

function asVariant(album) {
  return {
    id: album.id,
    title: album.title,
    artist: album.artist,
    image: album.image,
    spotifyUrl: album.spotifyUrl || "",
    count: album.count
  };
}

/**
 * Merge each group into one album that keeps every edition as a
 * selectable cover version. Track counts (and weights) are summed;
 * the merged album takes the place of its first member in the list.
 */
export function mergeAlbums(albums, groups) {
  const groupOf = new Map();

  groups.forEach((ids, g) => ids.forEach(id => groupOf.set(id, g)));

  const result = [];
  const done = new Set();

  for (const album of albums) {
    const g = groupOf.get(album.id);

    if (g === undefined) {
      result.push(album);
      continue;
    }

    if (done.has(g)) continue;
    done.add(g);

    const members = albums.filter(a => groupOf.get(a.id) === g);
    const primary = members.reduce((best, a) => (a.count > best.count ? a : best));

    const variants = [];
    const seen = new Set();

    for (const member of members) {
      for (const variant of member.variants || [asVariant(member)]) {
        if (!seen.has(variant.id)) {
          seen.add(variant.id);
          variants.push(variant);
        }
      }
    }

    const manual = members.some(a => a.manual);
    const count = members.reduce((sum, a) => sum + a.count, 0);

    result.push({
      ...primary,
      count,
      weight: manual ? members.reduce((sum, a) => sum + a.weight, 0) : count,
      manual,
      hidden: members.every(a => a.hidden),
      variants
    });
  }

  return result;
}

/** Show a different edition's cover (and title) for a merged album. */
export function selectVariant(album, variantId) {
  const variant = album.variants?.find(v => v.id === variantId);

  if (!variant) return album;

  album.image = variant.image;
  album.title = variant.title;
  album.spotifyUrl = variant.spotifyUrl;

  return album;
}

/** Undo a merge: one album per edition again. */
export function splitAlbum(album) {
  return (album.variants || []).map(variant => ({
    ...variant,
    weight: variant.count,
    hidden: album.hidden,
    manual: false,
    source: album.source
  }));
}
