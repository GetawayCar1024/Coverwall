// src/spotify.js
//
// Spotify OAuth (Authorization Code with PKCE) and playlist import.
// PKCE needs no client secret, so the Client ID can safely ship in
// the front-end bundle.

import { t } from "./i18n.js";

const AUTH = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

// Built-in Client ID. Override at build time with VITE_SPOTIFY_CLIENT_ID,
// or per browser via setCustomClientId().
const DEFAULT_CLIENT_ID =
  import.meta.env?.VITE_SPOTIFY_CLIENT_ID ||
  "37817a12fd3a425495d4846808151e7b";

const CLIENT_ID_KEY = "sat_client_id";
const VERIFIER_KEY = "sat_code_verifier";
const STATE_KEY = "sat_oauth_state";
const TOKEN_KEY = "sat_token";

// --------------------------------------------------
// PKCE helpers
// --------------------------------------------------

function randomString(length = 64) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  const bytes = crypto.getRandomValues(new Uint8Array(length));

  return [...bytes].map(b => chars[b % chars.length]).join("");
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function sha256(value) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

// --------------------------------------------------
// Client ID
// --------------------------------------------------

export function getClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || DEFAULT_CLIENT_ID;
}

export function hasCustomClientId() {
  return !!localStorage.getItem(CLIENT_ID_KEY);
}

// Pass an empty value to go back to the built-in Client ID.
export function setCustomClientId(clientId) {
  const value = String(clientId || "").trim();

  if (value && value !== DEFAULT_CLIENT_ID) {
    localStorage.setItem(CLIENT_ID_KEY, value);
  } else {
    localStorage.removeItem(CLIENT_ID_KEY);
  }

  // Tokens belong to a specific app.
  disconnect();
}

// The page URL without query, hash or a trailing index.html.
// It must be registered as a Redirect URI in the Spotify app.
export function getRedirectUri() {
  const path = window.location.pathname.replace(/index\.html$/, "");
  return window.location.origin + path;
}

// --------------------------------------------------
// Login state
// --------------------------------------------------

function readToken() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
  } catch {
    return null;
  }
}

export function isConnected() {
  const saved = readToken();

  return !!saved?.accessToken &&
    (!!saved.refreshToken || saved.expiresAt > Date.now() + 60000);
}

export function disconnect() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function loginWithSpotify() {
  const clientId = getClientId();

  if (!clientId) {
    throw new Error(t("errMissingClientId"));
  }

  const verifier = randomString(64);
  const state = randomString(32);

  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    code_challenge_method: "S256",
    code_challenge: base64url(await sha256(verifier)),
    state,
    scope: "playlist-read-private playlist-read-collaborative"
  });

  window.location.assign(`${AUTH}/authorize?${params}`);
}

function clearCallbackUrl() {
  history.replaceState({}, "", getRedirectUri());
}

/**
 * Finish the OAuth redirect if the URL carries a code.
 * Returns true when a new token was stored.
 */
export async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);

  const error = params.get("error");

  if (error) {
    clearCallbackUrl();
    throw new Error(
      error === "access_denied"
        ? t("errAuthCancelled")
        : t("errAuthFailed", { error })
    );
  }

  const code = params.get("code");

  if (!code) return false;

  clearCallbackUrl();

  const state = params.get("state");
  const verifier = localStorage.getItem(VERIFIER_KEY);

  localStorage.removeItem(VERIFIER_KEY);

  if (!state || state !== localStorage.getItem(STATE_KEY) || !verifier) {
    localStorage.removeItem(STATE_KEY);
    throw new Error(t("errAuthState"));
  }

  localStorage.removeItem(STATE_KEY);

  const data = await requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier
  });

  saveToken(data);

  return true;
}

async function requestToken(fields) {
  const response = await fetch(`${AUTH}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: getClientId(), ...fields })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error_description || data.error || "Spotify token request failed"
    );
  }

  return data;
}

function saveToken(data, previous = {}) {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || previous.refreshToken || "",
      expiresAt: Date.now() + data.expires_in * 1000
    })
  );
}

async function getAccessToken() {
  const saved = readToken();

  if (!saved?.accessToken) {
    throw new NotConnectedError();
  }

  if (saved.expiresAt > Date.now() + 60000) {
    return saved.accessToken;
  }

  if (!saved.refreshToken) {
    disconnect();
    throw new NotConnectedError();
  }

  try {
    const data = await requestToken({
      grant_type: "refresh_token",
      refresh_token: saved.refreshToken
    });

    saveToken(data, saved);

    return data.access_token;
  } catch {
    disconnect();
    throw new NotConnectedError();
  }
}

export class NotConnectedError extends Error {
  constructor() {
    super(t("errNotConnected"));
    this.name = "NotConnectedError";
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function spotifyFetch(url, { allowNotFound = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken();

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    // Rate limited: wait as told (development mode quotas are small).
    if (response.status === 429 && attempt < 4) {
      const seconds = Number(response.headers.get("Retry-After")) || 2 ** attempt;
      await sleep(Math.min(30, seconds) * 1000);
      continue;
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      disconnect();
      throw new NotConnectedError();
    }

    if (response.status === 403) {
      throw new Error(t("errForbidden"));
    }

    if (response.status === 404 || response.status === 400) {
      if (allowNotFound) return null;
      throw new Error(t("errNotFound"));
    }

    if (!response.ok) {
      throw new Error(
        data.error?.message || `Spotify API error ${response.status}`
      );
    }

    return data;
  }
}

// Run `task` over `items` with a few requests in flight at once.
async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}

// --------------------------------------------------
// Link parsing
// --------------------------------------------------

const LINK_TYPES = ["playlist", "album", "track", "artist"];

const LINK_PATTERN = new RegExp(
  "(?:open\\.spotify\\.com/(?:intl-[a-z-]+/)?(" + LINK_TYPES.join("|") + ")/" +
  "|spotify:(" + LINK_TYPES.join("|") + "):)" +
  "([A-Za-z0-9]{22})",
  "g"
);

/**
 * Find every Spotify playlist / album / track / artist link or URI in a
 * block of text, e.g. a single URL or the track links copied from the
 * desktop app with Ctrl/Cmd+A, Ctrl/Cmd+C. Duplicates are dropped.
 */
export function parseSpotifyLinks(text) {
  const found = { playlist: [], album: [], track: [], artist: [] };
  const seen = new Set();

  for (const match of String(text || "").matchAll(LINK_PATTERN)) {
    const type = match[1] || match[2];
    const id = match[3];
    const key = `${type}:${id}`;

    if (!seen.has(key)) {
      seen.add(key);
      found[type].push(id);
    }
  }

  return found;
}

export function hasSpotifyLinks(links) {
  return LINK_TYPES.some(type => links[type].length);
}

export class PlaylistNotOwnedError extends Error {
  constructor(name) {
    super(t("errPlaylistNotOwned", { name }));
    this.name = "PlaylistNotOwnedError";
  }
}

// --------------------------------------------------
// Import
// --------------------------------------------------

function artistNames(album) {
  return (album.artists || []).map(artist => artist.name).join(", ");
}

/**
 * Collects albums and how many tracks each contributes. Albums that
 * share the same cover image (e.g. standard and deluxe editions) are
 * merged, so a cover never appears twice in the mosaic.
 */
class AlbumCollector {
  constructor() {
    this.albums = new Map();
    this.keyByImage = new Map();
    this.complete = new Set(); // albums added in full
    this.trackCount = 0;
  }

  key(album) {
    const image = album.images?.[0]?.url || "";
    const key = (image && this.keyByImage.get(image)) || album.id || album.name;

    if (image && !this.keyByImage.has(image)) this.keyByImage.set(image, key);

    if (!this.albums.has(key)) {
      this.albums.set(key, {
        id: key,
        title: album.name,
        artist: artistNames(album),
        image,
        spotifyUrl: album.external_urls?.spotify || "",
        count: 0,
        weight: 0,
        hidden: false,
        manual: false
      });
    }

    return key;
  }

  addTrack(album) {
    const item = this.albums.get(this.key(album));

    if (this.complete.has(item.id)) return;

    item.count += 1;
    item.weight += 1;
    this.trackCount += 1;
  }

  // A whole album counts all of its tracks.
  addAlbum(album) {
    const item = this.albums.get(this.key(album));
    const total = Math.max(1, Number(album.total_tracks) || album.tracks?.total || 1);
    const extra = Math.max(0, total - item.count);

    this.complete.add(item.id);
    item.count += extra;
    item.weight += extra;
    this.trackCount += extra;
  }

  result(name) {
    return {
      name,
      trackCount: this.trackCount,
      albums: [...this.albums.values()].filter(album => album.image)
    };
  }
}

async function readPlaylist(id, collector) {
  const url = `${API}/playlists/${encodeURIComponent(id)}`;
  const meta = await spotifyFetch(url);

  // Since February 2026 Spotify only returns the contents of playlists
  // the user owns or collaborates on; others come back as metadata only.
  if (!meta.items && !meta.tracks) {
    throw new PlaylistNotOwnedError(meta.name || "");
  }

  let next = `${url}/items?limit=50`;

  while (next) {
    const page = await spotifyFetch(next);

    for (const entry of page.items || []) {
      const track = entry.item || entry.track;

      if (track?.type === "track" && track.album) collector.addTrack(track.album);
    }

    next = page.next;
  }

  return meta.name;
}

async function readArtistAlbums(id, collector) {
  const artist = await spotifyFetch(`${API}/artists/${encodeURIComponent(id)}`);

  let next =
    `${API}/artists/${encodeURIComponent(id)}/albums?include_groups=album&limit=10`;

  while (next) {
    const page = await spotifyFetch(next);

    for (const album of page.items || []) collector.addAlbum(album);

    next = page.next;
  }

  return artist.name;
}

/**
 * Import everything referenced in `text`.
 * `onProgress(done, total)` reports per-item lookups (albums, tracks).
 * Returns { name, trackCount, albums, skippedPlaylists }.
 */
export async function fetchCollection(text, { onProgress = () => {} } = {}) {
  const links = parseSpotifyLinks(text);
  const collector = new AlbumCollector();
  const names = [];
  const skippedPlaylists = [];

  for (const id of links.playlist) {
    try {
      names.push(await readPlaylist(id, collector));
    } catch (error) {
      if (!(error instanceof PlaylistNotOwnedError)) throw error;
      skippedPlaylists.push(error);
    }
  }

  for (const id of links.artist) {
    names.push(await readArtistAlbums(id, collector));
  }

  const lookups = [
    ...links.album.map(id => ({ type: "album", id })),
    ...links.track.map(id => ({ type: "track", id }))
  ];

  let done = 0;
  if (lookups.length) onProgress(0, lookups.length);

  const results = await mapLimited(lookups, 4, async ({ type, id }) => {
    const data = await spotifyFetch(
      `${API}/${type}s/${encodeURIComponent(id)}`,
      { allowNotFound: true }
    );

    onProgress(++done, lookups.length);

    return data && { type, data };
  });

  // Add in input order so the collection list follows the pasted order.
  for (const result of results) {
    if (!result) continue;

    if (result.type === "album") collector.addAlbum(result.data);
    else if (result.data.album) collector.addTrack(result.data.album);
  }

  const collection = collector.result("");

  if (!collection.albums.length && skippedPlaylists.length) {
    throw skippedPlaylists[0];
  }

  const onlyAlbum =
    !names.length && links.album.length === 1 && !links.track.length;

  collection.name =
    names.length === 1 && !lookups.length ? names[0]
    : onlyAlbum ? collection.albums[0]?.title || ""
    : "";

  collection.skippedPlaylists = skippedPlaylists.length;

  return collection;
}