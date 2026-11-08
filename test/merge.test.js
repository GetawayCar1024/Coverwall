import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeTitle,
  primaryArtist,
  findMergeGroups,
  mergeAlbums,
  selectVariant,
  splitAlbum
} from "../src/merge.js";

const album = (id, title, artist, count, extra = {}) => ({
  id,
  title,
  artist,
  count,
  weight: count,
  image: `${id}.jpg`,
  hidden: false,
  manual: false,
  ...extra
});

test("edition markers are ignored in titles", () => {
  assert.equal(normalizeTitle("Blonde (Deluxe Edition)"), "blonde");
  assert.equal(normalizeTitle("Currents [Remastered 2020]"), "currents");
  assert.equal(normalizeTitle("Rumours - Super Deluxe"), "rumours");
  assert.equal(normalizeTitle("Abbey Road (50th Anniversary)"), "abbey road");
  assert.equal(normalizeTitle("Björk: Homogenic"), "bjork homogenic");

  // Not edition markers, so the titles stay distinct.
  assert.notEqual(normalizeTitle("Live at Leeds"), normalizeTitle("Leeds"));
  assert.notEqual(normalizeTitle("Kid A (Kid A Mnesia)"), normalizeTitle("Kid A"));
});

test("primary artist ignores features and collaborators", () => {
  assert.equal(primaryArtist("Daft Punk, Pharrell Williams"), "daft punk");
  assert.equal(primaryArtist("Beyoncé"), "beyonce");
});

test("groups same-artist editions by title or by cover hash", () => {
  const albums = [
    album("a1", "Blonde", "Frank Ocean", 3),
    album("a2", "Blonde (Deluxe)", "Frank Ocean", 2),
    album("b1", "Blonde", "Someone Else", 1),
    album("c1", "Currents", "Tame Impala", 4),
    album("c2", "Currents B-Sides & Remixes", "Tame Impala", 1),
    album("d1", "Random Title", "Tame Impala", 1)
  ];

  const hashes = new Map([
    ["c1", Array(64).fill(0)],
    ["d1", [...Array(60).fill(0), 1, 1, 1, 1]],
    ["c2", Array(64).fill(1)]
  ]);

  const groups = findMergeGroups(albums, hashes).map(g => g.sort());

  assert.deepEqual(
    groups.sort(),
    [["a1", "a2"], ["c1", "d1"]]
  );
});

test("merging sums tracks and keeps every version", () => {
  const albums = [
    album("x", "Other", "Someone", 1),
    album("a1", "Blonde", "Frank Ocean", 1),
    album("a2", "Blonde (Deluxe)", "Frank Ocean", 3)
  ];

  const merged = mergeAlbums(albums, [["a1", "a2"]]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "x");

  const blonde = merged[1];

  assert.equal(blonde.id, "a2", "the edition with most tracks leads");
  assert.equal(blonde.count, 4);
  assert.equal(blonde.weight, 4);
  assert.deepEqual(blonde.variants.map(v => v.id), ["a1", "a2"]);

  selectVariant(blonde, "a1");
  assert.equal(blonde.image, "a1.jpg");
  assert.equal(blonde.title, "Blonde");

  const parts = splitAlbum(blonde);
  assert.deepEqual(parts.map(p => [p.id, p.count]), [["a1", 1], ["a2", 3]]);
});

test("merging an already merged album flattens versions", () => {
  const first = mergeAlbums(
    [album("a1", "Blonde", "Frank Ocean", 1), album("a2", "Blonde (Deluxe)", "Frank Ocean", 2)],
    [["a1", "a2"]]
  );

  const second = mergeAlbums(
    [...first, album("a3", "Blonde (Remastered)", "Frank Ocean", 1)],
    [["a2", "a3"]]
  );

  assert.equal(second.length, 1);
  assert.equal(second[0].count, 4);
  assert.deepEqual(second[0].variants.map(v => v.id).sort(), ["a1", "a2", "a3"]);
});
