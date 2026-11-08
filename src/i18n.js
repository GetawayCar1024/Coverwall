// src/i18n.js
//
// Two UI languages. Static markup uses data-i18n attributes:
//   data-i18n="key"              -> textContent
//   data-i18n-placeholder="key"  -> placeholder
//   data-i18n-title="key"        -> title and aria-label

const LANG_KEY = "sat_lang";

const messages = {
  zh: {
    pageTitle: "Coverwall · 歌单封面墙",
    tagline: "歌单封面墙",
    switchLanguage: "EN",
    switchLanguageTitle: "Switch to English",
    spotifyConnected: "已连接 Spotify",

    importHeading: "导入",
    playlistPlaceholder: "粘贴 Spotify 歌单、专辑、歌曲或艺人链接（可多个）",
    importButton: "导入",
    sampleButton: "示例歌单",
    importNote: "导入需要登录 Spotify。",
    useOwnClientId: "使用自己的 Client ID",
    editOwnClientId: "自定义 Client ID（修改）",
    disconnect: "断开 Spotify",

    playlistLabel: "歌单",
    undo: "撤销",
    redo: "重做",
    tracks: "曲目",
    albums: "专辑",
    artists: "艺人",

    wallHeading: "封面墙",
    shapeLabel: "形状",
    shape_classic: "经典",
    shape_heart: "爱心",
    shape_circle: "圆形",
    shape_diamond: "菱形",
    shape_hexagon: "六边形",
    shuffle: "打乱",
    mergeSimilar: "合并相似专辑",
    grid: "{columns} × {rows}",

    editHeading: "编辑",
    editEmpty: "点击封面进行编辑。",
    weight: "权重",
    areaInfo: "面积占比 {percent}% · {count} 首",
    coverVersion: "封面版本",
    versionTracks: "{count} 首",
    splitVersions: "拆分版本",
    resetWeight: "恢复为曲目数",
    hide: "隐藏",
    show: "显示",

    settingsHeading: "显示",
    showLabels: "显示标签",
    resetAll: "全部重置",

    albumListHeading: "专辑列表",
    shownCount: "显示 {shown} / {total}",
    hidden: "已隐藏",
    versionsBadge: "{count} 个版本",

    exportHeading: "导出",
    exportPng: "导出 PNG",
    saveJson: "保存布局（JSON）",
    loadJson: "载入布局（JSON）",

    footer: "封面版权归各自所有者。本项目与 Spotify 无关。",

    loading: "加载中…",
    loadingProgress: "加载中 {done}/{total}",
    exporting: "导出中…",
    merging: "比较中…",

    invalidUrl: "没有识别到 Spotify 歌单、专辑、歌曲或艺人链接。",
    redirecting: "正在跳转到 Spotify…",
    imported: "已导入「{name}」。",
    importedSkipped: "已导入「{name}」，跳过了 {count} 个无法读取的歌单。",
    defaultCollectionName: "我的封面墙",
    noCovers: "没有读取到专辑封面。",
    connected: "已连接 Spotify。",
    disconnected: "已断开 Spotify。",
    clientIdPrompt:
      "输入你的 Spotify 应用 Client ID（留空恢复内置）。\n需要将 {uri} 加入该应用的 Redirect URIs。",
    clientIdSet: "已使用自定义 Client ID。",
    clientIdReset: "已恢复内置 Client ID。",
    layoutLoaded: "布局已载入。",
    invalidLayout: "布局文件格式不正确。",
    nothingToExport: "没有可导出的封面。",
    exported: "已导出 {width} × {height} PNG。",
    exportedWithFailures: "已导出 PNG，{count} 张封面加载失败，已用占位图代替。",
    pngFailed: "图片生成失败。",
    merged: "已合并 {count} 组专辑。",
    nothingToMerge: "没有找到可合并的专辑。",
    split: "已拆分为 {count} 个版本。",

    errNotConnected: "请先登录 Spotify。",
    errAuthCancelled: "已取消 Spotify 授权。",
    errAuthFailed: "Spotify 授权失败：{error}",
    errAuthState: "登录校验失败，请重试。",
    errMissingClientId: "缺少 Spotify Client ID。",
    errForbidden:
      "Spotify 拒绝访问：开发模式下只有加入应用用户名单的账号可用，且只能读取自己创建或协作的歌单。",
    errNotFound: "找不到该内容，或没有读取权限。",
    errPlaylistNotOwned:
      "Spotify 只开放你自己创建或协作的歌单内容，无法直接读取「{name}」。" +
      "可以在 Spotify 桌面版打开该歌单，按 Ctrl/⌘+A 全选歌曲、Ctrl/⌘+C 复制，然后粘贴到这里导入；" +
      "也可以粘贴到你自己的新歌单里，再导入那个歌单（更快）。"
  },

  en: {
    pageTitle: "Coverwall · Playlist cover wall",
    tagline: "Playlist cover wall",
    switchLanguage: "中文",
    switchLanguageTitle: "切换到中文",
    spotifyConnected: "Spotify connected",

    importHeading: "Import",
    playlistPlaceholder: "Paste Spotify playlist, album, song or artist links (one or more)",
    importButton: "Import",
    sampleButton: "Sample playlist",
    importNote: "Importing requires a Spotify sign-in.",
    useOwnClientId: "Use my own Client ID",
    editOwnClientId: "Custom Client ID (change)",
    disconnect: "Disconnect Spotify",

    playlistLabel: "Playlist",
    undo: "Undo",
    redo: "Redo",
    tracks: "Tracks",
    albums: "Albums",
    artists: "Artists",

    wallHeading: "Cover wall",
    shapeLabel: "Shape",
    shape_classic: "Classic",
    shape_heart: "Heart",
    shape_circle: "Circle",
    shape_diamond: "Diamond",
    shape_hexagon: "Hexagon",
    shuffle: "Shuffle",
    mergeSimilar: "Merge similar albums",
    grid: "{columns} × {rows}",

    editHeading: "Edit",
    editEmpty: "Click a cover to edit it.",
    weight: "Weight",
    areaInfo: "{percent}% of area · {count} tracks",
    coverVersion: "Cover version",
    versionTracks: "{count} tracks",
    splitVersions: "Split versions",
    resetWeight: "Reset to track count",
    hide: "Hide",
    show: "Show",

    settingsHeading: "Display",
    showLabels: "Show labels",
    resetAll: "Reset all",

    albumListHeading: "Albums",
    shownCount: "{shown} of {total} shown",
    hidden: "Hidden",
    versionsBadge: "{count} versions",

    exportHeading: "Export",
    exportPng: "Export PNG",
    saveJson: "Save layout (JSON)",
    loadJson: "Load layout (JSON)",

    footer: "Artwork belongs to its respective owners. Not affiliated with Spotify.",

    loading: "Loading…",
    loadingProgress: "Loading {done}/{total}",
    exporting: "Exporting…",
    merging: "Comparing…",

    invalidUrl: "No Spotify playlist, album, song or artist link found.",
    redirecting: "Redirecting to Spotify…",
    imported: "Imported “{name}”.",
    importedSkipped: "Imported “{name}”. Skipped {count} playlists that couldn't be read.",
    defaultCollectionName: "My cover wall",
    noCovers: "No album covers found.",
    connected: "Connected to Spotify.",
    disconnected: "Disconnected from Spotify.",
    clientIdPrompt:
      "Enter your Spotify app Client ID (leave empty to use the built-in one).\nAdd {uri} to the app's Redirect URIs.",
    clientIdSet: "Using your own Client ID.",
    clientIdReset: "Using the built-in Client ID.",
    layoutLoaded: "Layout loaded.",
    invalidLayout: "Invalid layout file.",
    nothingToExport: "Nothing to export.",
    exported: "Exported a {width} × {height} PNG.",
    exportedWithFailures:
      "Exported. {count} covers failed to load and were replaced with placeholders.",
    pngFailed: "Could not create the image.",
    merged: "Merged {count} album groups.",
    nothingToMerge: "No similar albums found.",
    split: "Split into {count} versions.",

    errNotConnected: "Please sign in to Spotify first.",
    errAuthCancelled: "Spotify sign-in was cancelled.",
    errAuthFailed: "Spotify sign-in failed: {error}",
    errAuthState: "Sign-in check failed, please try again.",
    errMissingClientId: "Missing Spotify Client ID.",
    errForbidden:
      "Spotify denied access. In development mode only allow-listed accounts can sign in, and only playlists you own or collaborate on can be read.",
    errNotFound: "Not found, or you don't have access to it.",
    errPlaylistNotOwned:
      "Spotify only shares the contents of playlists you own or collaborate on, so “{name}” can't be read directly. " +
      "Open it in the Spotify desktop app, press Ctrl/⌘+A to select all songs and Ctrl/⌘+C to copy them, then paste here. " +
      "Or paste them into a new playlist of your own and import that one (faster)."
  }
};

function detectLanguage() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved && messages[saved]) return saved;
  } catch {
    // Storage unavailable.
  }

  const preferred = globalThis.navigator?.language || "";

  return preferred.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let lang = detectLanguage();
const listeners = new Set();

export function t(key, params = {}) {
  const text = messages[lang][key] ?? messages.en[key] ?? key;

  return text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");
}

export function getLanguage() {
  return lang;
}

export function setLanguage(next) {
  if (!messages[next] || next === lang) return;

  lang = next;
  localStorage.setItem(LANG_KEY, next);

  applyTranslations();
  listeners.forEach(listener => listener(lang));
}

export function toggleLanguage() {
  setLanguage(lang === "zh" ? "en" : "zh");
}

export function onLanguageChange(listener) {
  listeners.add(listener);
}

export function applyTranslations(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }

  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }

  for (const el of root.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
    el.setAttribute("aria-label", el.title);
  }

  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = t("pageTitle");
}
