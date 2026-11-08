// src/main.js

import {
  buildMosaic,
  randomSeed,
  getAreaDistribution,
  SHAPES
} from "./layout.js";

import {
  fetchPlaylist,
  getPlaylistId,
  getRedirectUri,
  hasCustomClientId,
  setCustomClientId,
  isConnected,
  disconnect,
  loginWithSpotify,
  handleOAuthCallback,
  NotConnectedError
} from "./spotify.js";

import {
  hashCovers,
  findMergeGroups,
  mergeAlbums,
  selectVariant,
  splitAlbum
} from "./merge.js";

import { renderMosaicPng, LABEL_MIN_SCREEN_PX } from "./export.js";

import {
  t,
  applyTranslations,
  toggleLanguage,
  onLanguageChange
} from "./i18n.js";

import "./style.css";

const $ = id => document.getElementById(id);

const PENDING_IMPORT_KEY = "sat_pending_playlist";
const HISTORY_LIMIT = 40;

// --------------------------------------------------
// Demo data (each album has its own placeholder cover)
// --------------------------------------------------

const demoCover = seed => `https://picsum.photos/seed/${seed}/600/600`;

const DEMO_PLAYLIST = {
  name: "Late Night Frequencies",
  trackCount: 32,
  albums: [
    ["Currents", "Tame Impala", 5, "currents"],
    ["Blonde", "Frank Ocean", 4, "blonde"],
    ["Depression Cherry", "Beach House", 4, "depression-cherry"],
    ["xx", "The xx", 4, "the-xx"],
    ["Dive", "Tycho", 3, "dive"],
    ["Presence", "Petit Biscuit", 3, "presence"],
    ["A Moment Apart", "ODESZA", 2, "a-moment-apart"],
    ["Immunity", "Jon Hopkins", 2, "immunity"],
    ["Lady Lady", "Masego", 1, "lady-lady"],
    ["Discovery", "Daft Punk", 1, "discovery"],
    ["Vespertine", "Björk", 1, "vespertine"],
    ["Selected Ambient Works", "Aphex Twin", 1, "selected-ambient-works"]
  ]
};

// --------------------------------------------------
// State
// --------------------------------------------------

const state = {
  albums: [],
  playlistName: "",
  trackCount: 0,
  layoutSeed: randomSeed(),
  shape: "classic",
  selectedId: null
};

let showLabels = false;

let undoStack = [];
let redoStack = [];
let weightEditStarted = false;

let lastLayout = { tiles: [], columns: 0, rows: 0 };

// --------------------------------------------------
// Helpers
// --------------------------------------------------

function toast(message) {
  const element = $("toast");

  element.textContent = message;
  element.hidden = !message;

  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.hidden = true;
  }, 4500);
}

function visibleAlbums() {
  return state.albums.filter(album => !album.hidden);
}

function getAlbum(id) {
  return state.albums.find(album => album.id === id);
}

function selectAlbum(id) {
  state.selectedId = id;
  render();
}

function setPlaylist({ name, trackCount, albums }) {
  state.albums = albums;
  state.playlistName = name;
  state.trackCount = trackCount;
  state.selectedId = null;
  state.layoutSeed = randomSeed();
}

// Run an async action with a busy label on its button.
async function withBusyButton(button, busyKey, action) {
  const labelKey = button.dataset.i18n;

  button.disabled = true;
  button.textContent = t(busyKey);

  try {
    await action();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = t(labelKey);
  }
}

// --------------------------------------------------
// Undo / redo (snapshots of the whole editable state)
// --------------------------------------------------

function snapshot() {
  undoStack.push(structuredClone(state));

  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();

  redoStack = [];
  updateHistoryButtons();
}

function restore(saved) {
  Object.assign(state, saved);

  if (!getAlbum(state.selectedId)) state.selectedId = null;

  render();
}

function updateHistoryButtons() {
  $("undoBtn").disabled = !undoStack.length;
  $("redoBtn").disabled = !redoStack.length;
}

$("undoBtn").onclick = () => {
  if (!undoStack.length) return;

  redoStack.push(structuredClone(state));
  restore(undoStack.pop());
};

$("redoBtn").onclick = () => {
  if (!redoStack.length) return;

  undoStack.push(structuredClone(state));
  restore(redoStack.pop());
};

// --------------------------------------------------
// Rendering
// --------------------------------------------------

function render() {
  const { albums } = state;

  $("playlistName").textContent = state.playlistName;
  $("trackCount").textContent = state.trackCount;
  $("albumCount").textContent = albums.length;
  $("artistCount").textContent = new Set(albums.map(a => a.artist)).size;
  $("shownCount").textContent = t("shownCount", {
    shown: visibleAlbums().length,
    total: albums.length
  });

  renderShapePicker();
  renderMosaic();
  renderList();
  renderInspector();
  updateHistoryButtons();
}

function renderShapePicker() {
  const buttons = SHAPES.map(shape => {
    const button = document.createElement("button");
    const active = shape === state.shape;

    button.type = "button";
    button.className = "segment";
    button.classList.toggle("active", active);
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(active));
    button.textContent = t(`shape_${shape}`);

    button.addEventListener("click", () => {
      if (state.shape === shape) return;

      snapshot();
      state.shape = shape;
      render();
    });

    return button;
  });

  $("shapePicker").replaceChildren(...buttons);
}

function renderMosaic() {
  const container = $("treemap");

  lastLayout = buildMosaic(visibleAlbums(), {
    seed: state.layoutSeed,
    shape: state.shape
  });

  const { tiles, columns, rows } = lastLayout;

  $("gridInfo").textContent = columns ? t("grid", { columns, rows }) : "";

  container.replaceChildren();

  if (!tiles.length) {
    container.style.aspectRatio = "";
    return;
  }

  container.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  container.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  container.style.aspectRatio = `${columns} / ${rows}`;

  const unitPx = container.clientWidth / columns;

  for (const { album, x, y, size } of tiles) {
    const tile = document.createElement("button");

    tile.type = "button";
    tile.className = "tile";
    tile.classList.toggle("selected", album.id === state.selectedId);
    tile.style.gridColumn = `${x + 1} / span ${size}`;
    tile.style.gridRow = `${y + 1} / span ${size}`;
    tile.setAttribute("aria-label", `${album.title} · ${album.artist}`);

    const img = document.createElement("img");

    img.src = album.image;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.draggable = false;

    tile.append(img);

    if (showLabels && size * unitPx >= LABEL_MIN_SCREEN_PX) {
      const label = document.createElement("span");

      label.className = "tile-label";
      label.textContent = `${album.title} · ${album.artist}`;

      tile.append(label);
    }

    tile.addEventListener("click", () => selectAlbum(album.id));

    container.append(tile);
  }
}

function renderList() {
  const rows = state.albums.map(album => {
    const row = document.createElement("button");

    row.type = "button";
    row.className = "album-row";
    row.classList.toggle("active", album.id === state.selectedId);
    row.classList.toggle("is-hidden", album.hidden);

    const img = document.createElement("img");

    img.src = album.image;
    img.alt = "";

    const copy = document.createElement("span");
    copy.className = "album-copy";

    const title = document.createElement("b");
    title.textContent = album.title;

    const artist = document.createElement("small");
    artist.textContent = album.variants?.length > 1
      ? `${album.artist} · ${t("versionsBadge", { count: album.variants.length })}`
      : album.artist;

    copy.append(title, artist);

    const count = document.createElement("span");

    count.className = "count-pill";
    count.textContent = album.hidden ? t("hidden") : album.weight;

    row.append(img, copy, count);
    row.addEventListener("click", () => selectAlbum(album.id));

    return row;
  });

  $("albumList").replaceChildren(...rows);
}

function renderInspector() {
  const album = getAlbum(state.selectedId);

  $("emptyInspector").hidden = !!album;
  $("inspector").hidden = !album;

  if (!album) return;

  const img = document.createElement("img");

  img.src = album.image;
  img.alt = album.title;

  $("selectedArt").replaceChildren(img);
  $("selectedTitle").textContent = album.title;
  $("selectedArtist").textContent = album.artist;
  $("hideBtn").textContent = t(album.hidden ? "show" : "hide");

  renderVersions(album);
  syncWeightControls(album);
}

function renderVersions(album) {
  const variants = album.variants || [];

  $("versionPicker").hidden = variants.length < 2;

  if (variants.length < 2) return;

  const buttons = variants.map(variant => {
    const button = document.createElement("button");

    button.type = "button";
    button.className = "version";
    button.classList.toggle("active", variant.image === album.image);
    button.title = `${variant.title} · ${t("versionTracks", { count: variant.count })}`;
    button.setAttribute("aria-label", button.title);

    const img = document.createElement("img");

    img.src = variant.image;
    img.alt = "";

    button.append(img);

    button.addEventListener("click", () => {
      if (variant.image === album.image) return;

      snapshot();
      selectVariant(album, variant.id);
      render();
    });

    return button;
  });

  $("versionList").replaceChildren(...buttons);
}

function syncWeightControls(album) {
  $("weightRange").value = Math.min(100, album.weight);
  $("weightNumber").value = album.weight;

  const entry = getAreaDistribution(state.albums).find(
    item => item.id === album.id
  );

  $("areaInfo").textContent = t("areaInfo", {
    percent: (entry?.percentage || 0).toFixed(1),
    count: album.count
  });
}

// Labels depend on the on-screen tile size.
new ResizeObserver(() => {
  if (showLabels) renderMosaic();
}).observe($("treemap"));

onLanguageChange(() => {
  render();
  renderSpotifyStatus();
});

$("langBtn").onclick = toggleLanguage;

// --------------------------------------------------
// Editing
// --------------------------------------------------

function setWeight(value) {
  const album = getAlbum(state.selectedId);

  if (!album) return;

  album.weight = Math.max(1, Math.min(10000, Math.round(Number(value)) || 1));
  album.manual = true;

  syncWeightControls(album);
  renderMosaic();
  renderList();
}

// One history entry per slider drag.
function beginWeightEdit() {
  if (weightEditStarted) return;

  snapshot();
  weightEditStarted = true;
}

const weightRange = $("weightRange");

weightRange.addEventListener("pointerdown", beginWeightEdit);
weightRange.addEventListener("keydown", beginWeightEdit);
weightRange.addEventListener("input", e => {
  beginWeightEdit();
  setWeight(e.target.value);
});
weightRange.addEventListener("change", () => {
  weightEditStarted = false;
});

$("weightNumber").addEventListener("change", e => {
  snapshot();
  setWeight(e.target.value);
});

$("resetWeightBtn").onclick = () => {
  const album = getAlbum(state.selectedId);

  if (!album) return;

  snapshot();

  album.weight = album.count;
  album.manual = false;

  render();
};

$("hideBtn").onclick = () => {
  const album = getAlbum(state.selectedId);

  if (!album) return;

  snapshot();

  album.hidden = !album.hidden;

  render();
};

$("splitBtn").onclick = () => {
  const album = getAlbum(state.selectedId);

  if (!album?.variants) return;

  snapshot();

  const parts = splitAlbum(album);
  const index = state.albums.indexOf(album);

  state.albums.splice(index, 1, ...parts);
  state.selectedId = parts[0].id;

  render();
  toast(t("split", { count: parts.length }));
};

$("resetAllBtn").onclick = () => {
  snapshot();

  for (const album of state.albums) {
    album.weight = album.count;
    album.hidden = false;
    album.manual = false;
  }

  render();
};

$("labelsCheck").onchange = e => {
  showLabels = e.target.checked;
  renderMosaic();
};

$("shuffleBtn").onclick = () => {
  snapshot();

  state.layoutSeed = randomSeed();

  renderMosaic();
  updateHistoryButtons();
};

$("mergeBtn").onclick = () =>
  withBusyButton($("mergeBtn"), "merging", async () => {
    const hashes = await hashCovers(state.albums);
    const groups = findMergeGroups(state.albums, hashes);

    if (!groups.length) {
      toast(t("nothingToMerge"));
      return;
    }

    snapshot();

    state.albums = mergeAlbums(state.albums, groups);

    if (!getAlbum(state.selectedId)) state.selectedId = null;

    render();
    toast(t("merged", { count: groups.length }));
  });

// --------------------------------------------------
// Demo
// --------------------------------------------------

function loadDemo() {
  setPlaylist({
    name: DEMO_PLAYLIST.name,
    trackCount: DEMO_PLAYLIST.trackCount,
    albums: DEMO_PLAYLIST.albums.map(([title, artist, count, seed], i) => ({
      id: `demo-${i}`,
      title,
      artist,
      count,
      weight: count,
      image: demoCover(seed),
      spotifyUrl: "",
      hidden: false,
      manual: false,
      source: "demo"
    }))
  });

  render();
}

$("demoBtn").onclick = () => {
  snapshot();
  loadDemo();
};

// --------------------------------------------------
// Spotify
// --------------------------------------------------

function renderSpotifyStatus() {
  const connected = isConnected();

  $("spotifyStatus").hidden = !connected;
  $("disconnectBtn").hidden = !connected;
  $("clientIdBtn").textContent = t(
    hasCustomClientId() ? "editOwnClientId" : "useOwnClientId"
  );
}

$("disconnectBtn").onclick = () => {
  disconnect();
  renderSpotifyStatus();
  toast(t("disconnected"));
};

$("clientIdBtn").onclick = () => {
  const value = prompt(
    t("clientIdPrompt", { uri: getRedirectUri() }),
    hasCustomClientId() ? localStorage.getItem("sat_client_id") : ""
  );

  if (value === null) return;

  setCustomClientId(value);
  renderSpotifyStatus();
  toast(t(value.trim() ? "clientIdSet" : "clientIdReset"));
};

async function startLogin(input) {
  sessionStorage.setItem(PENDING_IMPORT_KEY, input);
  toast(t("redirecting"));
  await loginWithSpotify();
}

async function importPlaylist(input) {
  const id = getPlaylistId(input);

  if (!id) {
    toast(t("invalidUrl"));
    return;
  }

  // Not signed in: remember the playlist and come back after login.
  if (!isConnected()) {
    await startLogin(input);
    return;
  }

  await withBusyButton($("importBtn"), "loading", async () => {
    try {
      const result = await fetchPlaylist(id);

      if (!result.albums.length) {
        throw new Error(t("noCovers"));
      }

      snapshot();

      setPlaylist({
        name: result.name,
        trackCount: result.trackCount,
        albums: result.albums.map(album => ({ ...album, source: "spotify" }))
      });

      render();
      toast(t("imported", { name: result.name }));
    } catch (error) {
      // Session expired: sign in again and resume.
      if (error instanceof NotConnectedError) {
        await startLogin(input);
        return;
      }

      throw error;
    } finally {
      renderSpotifyStatus();
    }
  });
}

$("importBtn").onclick = () => importPlaylist($("playlistUrl").value.trim());

$("playlistUrl").addEventListener("keydown", e => {
  if (e.key === "Enter") $("importBtn").click();
});

// --------------------------------------------------
// Save / load / export
// --------------------------------------------------

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(name) {
  return (
    String(name || "")
      .replace(/[\\/:*?"<>|]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "Coverwall"
  );
}

$("saveLayoutBtn").onclick = () => {
  const payload = {
    app: "Coverwall",
    version: 4,
    layoutSeed: state.layoutSeed,
    shape: state.shape,
    playlistName: state.playlistName,
    trackCount: state.trackCount,
    showLabels,
    albums: state.albums.map(
      ({ id, title, artist, count, weight, hidden, manual, image, spotifyUrl, source, variants }) =>
        ({ id, title, artist, count, weight, hidden, manual, image, spotifyUrl, source, variants })
    )
  };

  downloadBlob(
    `${safeFilename(state.playlistName)}.json`,
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
  );
};

$("loadLayoutInput").onchange = async e => {
  const file = e.target.files?.[0];

  if (!file) return;

  try {
    let data;

    try {
      data = JSON.parse(await file.text());
    } catch {
      data = null;
    }

    if (!Array.isArray(data?.albums)) {
      throw new Error(t("invalidLayout"));
    }

    snapshot();

    const albums = data.albums.map(album => ({
      ...album,
      count: Number(album.count) || 1,
      weight: Math.max(1, Number(album.weight) || Number(album.count) || 1),
      hidden: !!album.hidden,
      manual: !!album.manual
    }));

    setPlaylist({
      name: data.playlistName || "Coverwall",
      trackCount:
        data.trackCount || albums.reduce((sum, album) => sum + album.count, 0),
      albums
    });

    if (Number.isInteger(data.layoutSeed)) state.layoutSeed = data.layoutSeed;
    if (SHAPES.includes(data.shape)) state.shape = data.shape;

    showLabels = !!data.showLabels;
    $("labelsCheck").checked = showLabels;

    render();
    toast(t("layoutLoaded"));
  } catch (error) {
    toast(error.message);
  } finally {
    e.target.value = "";
  }
};

$("exportPngBtn").onclick = () => {
  if (!lastLayout.tiles.length) {
    toast(t("nothingToExport"));
    return;
  }

  return withBusyButton($("exportPngBtn"), "exporting", async () => {
    const { blob, width, height, failed } = await renderMosaicPng(lastLayout, {
      showLabels,
      screenUnit: $("treemap").clientWidth / lastLayout.columns
    });

    downloadBlob(`${safeFilename(state.playlistName)}.png`, blob);

    toast(
      failed
        ? t("exportedWithFailures", { count: failed })
        : t("exported", { width, height })
    );
  });
};

// --------------------------------------------------
// Startup
// --------------------------------------------------

async function init() {
  applyTranslations();
  loadDemo();
  renderSpotifyStatus();

  try {
    if (await handleOAuthCallback()) toast(t("connected"));
  } catch (error) {
    toast(error.message);
  }

  renderSpotifyStatus();

  const pending = sessionStorage.getItem(PENDING_IMPORT_KEY);

  if (pending) {
    sessionStorage.removeItem(PENDING_IMPORT_KEY);
    $("playlistUrl").value = pending;

    if (isConnected()) await importPlaylist(pending);
  }
}

init();
