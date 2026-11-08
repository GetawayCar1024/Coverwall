// src/main.js

import {
  buildMosaic,
  randomSeed,
  getAreaDistribution
} from "./layout.js";

import {
  fetchPlaylist,
  getPlaylistId,
  hasCustomClientId,
  setCustomClientId,
  isConnected,
  disconnect,
  loginWithSpotify,
  handleOAuthCallback,
  NotConnectedError
} from "./spotify.js";

import { renderMosaicPng, LABEL_MIN_SCREEN_PX } from "./export.js";

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
  selectedId: null
};

let showLabels = false;
let keepManualWeights = false;

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
  $("playlistMeta").textContent =
    `Playlist · ${state.trackCount} tracks · ${albums.length} albums`;

  $("trackCount").textContent = state.trackCount;
  $("albumCount").textContent = albums.length;
  $("artistCount").textContent = new Set(albums.map(a => a.artist)).size;
  $("shownCount").textContent = `${visibleAlbums().length} shown`;

  renderMosaic();
  renderList();
  renderInspector();
  updateHistoryButtons();
}

function renderMosaic() {
  const container = $("treemap");

  lastLayout = buildMosaic(visibleAlbums(), { seed: state.layoutSeed });

  const { tiles, columns, rows } = lastLayout;

  $("ratioLabel").textContent = columns ? `${columns} × ${rows} grid` : "";
  $("gridInfo").textContent = columns ? `${columns} × ${rows}` : "—";

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
    tile.setAttribute("aria-label", `${album.title}, ${album.count} tracks`);

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
    artist.textContent = album.artist;

    copy.append(title, artist);

    const count = document.createElement("span");

    count.className = "count-pill";
    count.textContent = album.hidden ? "Hidden" : album.weight;

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
  $("hideBtn").textContent = album.hidden ? "Show this album" : "Hide this album";

  syncWeightControls(album);
}

function syncWeightControls(album) {
  $("weightRange").value = Math.min(100, album.weight);
  $("weightNumber").value = album.weight;
  $("weightOutput").textContent = album.weight;

  const entry = getAreaDistribution(state.albums).find(
    item => item.id === album.id
  );

  $("areaInfo").textContent =
    `Approx. area share: ${(entry?.percentage || 0).toFixed(1)}% · ` +
    `Track count: ${album.count}`;
}

// Labels depend on the on-screen tile size.
new ResizeObserver(() => {
  if (showLabels) renderMosaic();
}).observe($("treemap"));

// --------------------------------------------------
// Weight editing
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

function finishWeightEdit() {
  weightEditStarted = false;
}

const weightRange = $("weightRange");

weightRange.addEventListener("pointerdown", beginWeightEdit);
weightRange.addEventListener("keydown", beginWeightEdit);
weightRange.addEventListener("input", e => {
  beginWeightEdit();
  setWeight(e.target.value);
});
weightRange.addEventListener("change", finishWeightEdit);

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

// Back to track counts; optionally keep hand-tuned weights.
$("autoBtn").onclick = () => {
  snapshot();

  for (const album of state.albums) {
    if (keepManualWeights && album.manual) continue;

    album.weight = album.count;
    album.manual = false;
  }

  render();

  toast(
    keepManualWeights
      ? "已按歌曲数量重置权重（保留了手动设置的权重）。"
      : "已按歌曲数量重置权重。"
  );
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

// --------------------------------------------------
// Display controls
// --------------------------------------------------

$("labelsCheck").onchange = e => {
  showLabels = e.target.checked;
  renderMosaic();
};

$("keepManualCheck").onchange = e => {
  keepManualWeights = e.target.checked;
};

$("shuffleBtn").onclick = () => {
  snapshot();

  state.layoutSeed = randomSeed();

  renderMosaic();
  updateHistoryButtons();
};

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

  $("message").textContent = "演示歌单已载入。";
};

// --------------------------------------------------
// Spotify
// --------------------------------------------------

function renderSpotifyStatus() {
  const connected = isConnected();

  $("spotifyStatus").hidden = !connected;
  $("disconnectBtn").hidden = !connected;

  $("clientIdBtn").textContent = hasCustomClientId()
    ? "正在使用自定义 Client ID · 修改"
    : "使用自己的 Client ID";
}

$("disconnectBtn").onclick = () => {
  disconnect();
  renderSpotifyStatus();
  toast("已断开 Spotify。");
};

$("clientIdBtn").onclick = () => {
  const value = prompt(
    "输入你在 Spotify Developer Dashboard 创建的应用 Client ID。\n" +
    `需要把 ${location.origin}${location.pathname.replace(/index\.html$/, "")} 加入该应用的 Redirect URIs。\n` +
    "留空则恢复使用内置 Client ID。",
    hasCustomClientId() ? localStorage.getItem("sat_client_id") : ""
  );

  if (value === null) return;

  setCustomClientId(value);
  renderSpotifyStatus();

  toast(value.trim() ? "已切换到自定义 Client ID。" : "已恢复内置 Client ID。");
};

async function importPlaylist(input) {
  const id = getPlaylistId(input);

  if (!id) {
    toast("请输入有效的 Spotify playlist URL。");
    return;
  }

  // Not logged in yet: remember the playlist and come back after login.
  if (!isConnected()) {
    sessionStorage.setItem(PENDING_IMPORT_KEY, input);
    $("message").textContent = "正在跳转到 Spotify 登录…";
    await loginWithSpotify();
    return;
  }

  const button = $("importBtn");

  button.disabled = true;
  button.textContent = "Loading…";

  try {
    const result = await fetchPlaylist(id);

    if (!result.albums.length) {
      throw new Error("没有读取到专辑封面。");
    }

    snapshot();

    setPlaylist({
      name: result.name,
      trackCount: result.trackCount,
      albums: result.albums.map(album => ({ ...album, source: "spotify" }))
    });

    render();

    $("message").textContent = "Spotify 歌单导入成功。";
  } catch (error) {
    if (error instanceof NotConnectedError) {
      // Session expired: log in again and resume.
      sessionStorage.setItem(PENDING_IMPORT_KEY, input);
      await loginWithSpotify();
      return;
    }

    toast(error.message);
    $("message").textContent = "导入失败。";
  } finally {
    button.disabled = false;
    button.textContent = "Import ↗";
    renderSpotifyStatus();
  }
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
      .slice(0, 80) || "album-art"
  );
}

$("saveLayoutBtn").onclick = () => {
  const payload = {
    version: 3,
    layout: "random-mosaic",
    layoutSeed: state.layoutSeed,
    columns: lastLayout.columns,
    rows: lastLayout.rows,
    playlistName: state.playlistName,
    trackCount: state.trackCount,
    showLabels,
    albums: state.albums.map(
      ({ id, title, artist, count, weight, hidden, manual, image, spotifyUrl, source }) =>
        ({ id, title, artist, count, weight, hidden, manual, image, spotifyUrl, source })
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
    const data = JSON.parse(await file.text());

    if (!Array.isArray(data.albums)) {
      throw new Error("JSON 文件格式不正确。");
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
      name: data.playlistName || "Imported layout",
      trackCount:
        data.trackCount || albums.reduce((sum, album) => sum + album.count, 0),
      albums
    });

    if (Number.isInteger(data.layoutSeed)) {
      state.layoutSeed = data.layoutSeed;
    }

    showLabels = !!data.showLabels;
    $("labelsCheck").checked = showLabels;

    render();

    toast("布局已载入。");
  } catch (error) {
    toast(error.message);
  } finally {
    e.target.value = "";
  }
};

$("exportPngBtn").onclick = async () => {
  const button = $("exportPngBtn");
  const label = button.textContent;

  if (!lastLayout.tiles.length) {
    toast("没有可以导出的封面。");
    return;
  }

  button.disabled = true;
  button.textContent = "Exporting…";

  try {
    const { blob, width, height, failed } = await renderMosaicPng(lastLayout, {
      showLabels,
      screenUnit: $("treemap").clientWidth / lastLayout.columns
    });

    downloadBlob(`${safeFilename(state.playlistName)}.png`, blob);

    toast(
      failed
        ? `已导出 PNG，其中 ${failed} 张封面无法加载，已用占位图代替。`
        : `已导出 PNG（${width} × ${height}）。`
    );
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
};

// --------------------------------------------------
// Startup
// --------------------------------------------------

async function init() {
  loadDemo();
  renderSpotifyStatus();

  try {
    if (await handleOAuthCallback()) {
      $("message").textContent = "Spotify 已连接。";
    }
  } catch (error) {
    toast(error.message);
  }

  renderSpotifyStatus();

  const pending = sessionStorage.getItem(PENDING_IMPORT_KEY);

  if (pending) {
    sessionStorage.removeItem(PENDING_IMPORT_KEY);
    $("playlistUrl").value = pending;

    if (isConnected()) {
      await importPlaylist(pending);
    }
  }
}

init();
