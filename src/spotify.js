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

async function spotifyFetch(url) {
  const token = await getAccessToken();

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    disconnect();
    throw new NotConnectedError();
  }

  if (response.status === 403) {
    throw new Error(t("errForbidden"));
  }

  if (response.status === 404) {
    throw new Error(t("errNotFound"));
  }

  if (!response.ok) {
    throw new Error(
      data.error?.message || `Spotify API error ${response.status}`
    );
  }

  return data;
}

// --------------------------------------------------
// Playlist import
// --------------------------------------------------

// Accepts open.spotify.com URLs (including /intl-xx/ paths)
// and spotify:playlist:<id> URIs.
export function getPlaylistId(input) {
  const value = String(input || "").trim();

  if (!value) return null;

  const uriMatch = value.match(/^spotify:playlist:([a-zA-Z0-9]+)$/);

  if (uriMatch) return uriMatch[1];

  try {
    const url = new URL(value);

    if (/(^|\.)spotify\.com$/.test(url.hostname)) {
      return url.pathname.match(/\/playlist\/([a-zA-Z0-9]+)/)?.[1] || null;
    }
  } catch {
    // Not an absolute URL.
  }

  return null;
}

export async function fetchPlaylist(id) {
  if (!id) {
    throw new Error("Invalid Spotify playlist ID.");
  }

  const playlistUrl = `${API}/playlists/${encodeURIComponent(id)}`;

  const meta = await spotifyFetch(playlistUrl);

  const tracks = [];
  let next = `${playlistUrl}/items?limit=50`;

  while (next) {
    const page = await spotifyFetch(next);

    for (const entry of page.items || []) {
      const track = entry.item || entry.track;

      if (track?.type === "track" && track.album) {
        tracks.push(track);
      }
    }

    next = page.next;
  }

  // Group tracks by album. Albums that share the same cover image
  // (e.g. standard and deluxe editions) are merged, so a cover never
  // appears twice in the mosaic.
  const grouped = new Map();
  const keyByImage = new Map();

  for (const { album } of tracks) {
    const image = album.images?.[0]?.url || "";

    const key =
      (image && keyByImage.get(image)) ||
      album.id ||
      album.name;

    if (image && !keyByImage.has(image)) {
      keyByImage.set(image, key);
    }

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        title: album.name,
        artist: (album.artists || []).map(artist => artist.name).join(", "),
        image,
        spotifyUrl: album.external_urls?.spotify || "",
        count: 0,
        weight: 0,
        hidden: false,
        manual: false
      });
    }

    const item = grouped.get(key);

    item.count += 1;
    item.weight += 1;
  }

  return {
    name: meta.name || "Spotify Playlist",
    url: meta.external_urls?.spotify || `https://open.spotify.com/playlist/${id}`,
    trackCount: tracks.length,
    albums: [...grouped.values()].filter(album => album.image)
  };
}
