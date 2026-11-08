import test from "node:test";
import assert from "node:assert/strict";

// Minimal browser globals used by spotify.js / i18n.js.
const store = new Map();
globalThis.localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key)
};

const {
  parseSpotifyLinks,
  hasSpotifyLinks,
  fetchCollection,
  PlaylistNotOwnedError
} = await import("../src/spotify.js");

const id = char => char.repeat(22);

test("finds every kind of Spotify link, deduplicated", () => {
  const text = [
    `https://open.spotify.com/playlist/${id("p")}?si=abc`,
    `https://open.spotify.com/intl-zh/album/${id("a")}`,
    `spotify:track:${id("t")}`,
    // Desktop copy pasted into a single-line input: links run together.
    `https://open.spotify.com/track/${id("u")}https://open.spotify.com/track/${id("t")}`,
    `https://open.spotify.com/artist/${id("r")}`
  ].join("\n");

  assert.deepEqual(parseSpotifyLinks(text), {
    playlist: [id("p")],
    album: [id("a")],
    track: [id("t"), id("u")],
    artist: [id("r")]
  });

  assert.equal(hasSpotifyLinks(parseSpotifyLinks("hello")), false);
});

// --- Mocked Web API ---------------------------------------------------

const album = (key, tracks, image = `https://img/${key}`) => ({
  id: id(key),
  name: `Album ${key}`,
  artists: [{ name: "Artist" }],
  images: [{ url: image }],
  total_tracks: tracks,
  external_urls: { spotify: `https://open.spotify.com/album/${id(key)}` }
});

const routes = new Map();

globalThis.fetch = async url => {
  const path = new URL(url).pathname.replace("/v1/", "");
  const body = routes.get(path);

  return {
    ok: body !== undefined,
    status: body !== undefined ? 200 : 404,
    headers: { get: () => null },
    json: async () => body ?? {}
  };
};

store.set(
  "sat_token",
  JSON.stringify({ accessToken: "x", refreshToken: "", expiresAt: Date.now() + 3600e3 })
);

routes.set(`albums/${id("a")}`, album("a", 10));
routes.set(`albums/${id("b")}`, album("b", 7));
routes.set(`tracks/${id("t")}`, { album: album("a", 10) });
routes.set(`tracks/${id("u")}`, { album: album("c", 12) });
routes.set(`tracks/${id("v")}`, { album: album("c", 12) });
routes.set(`playlists/${id("o")}`, { name: "Someone's mix" }); // no items

test("album links count their full track list; tracks group by album", async () => {
  const progress = [];

  const result = await fetchCollection(
    [`spotify:album:${id("a")}`, `spotify:album:${id("b")}`,
     `spotify:track:${id("t")}`, `spotify:track:${id("u")}`, `spotify:track:${id("v")}`].join(" "),
    { onProgress: (done, total) => progress.push(`${done}/${total}`) }
  );

  const counts = Object.fromEntries(result.albums.map(a => [a.title, a.count]));

  // Album a: full album (10) already covers the single track from it.
  assert.deepEqual(counts, { "Album a": 10, "Album b": 7, "Album c": 2 });
  assert.equal(result.trackCount, 19);
  assert.equal(progress.at(-1), "5/5");
});

test("a single album link is named after the album", async () => {
  const result = await fetchCollection(`https://open.spotify.com/album/${id("b")}`);

  assert.equal(result.name, "Album b");
});

test("someone else's playlist explains the copy-paste workaround", async () => {
  await assert.rejects(
    fetchCollection(`https://open.spotify.com/playlist/${id("o")}`),
    error => error instanceof PlaylistNotOwnedError && error.message.includes("Someone's mix")
  );

  // Mixed with readable links, it is skipped instead.
  const result = await fetchCollection(
    `https://open.spotify.com/playlist/${id("o")} spotify:album:${id("a")}`
  );

  assert.equal(result.skippedPlaylists, 1);
  assert.equal(result.albums.length, 1);
});
