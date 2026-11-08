// src/export.js
//
// Render a mosaic layout to a PNG blob.

import { loadImage } from "./images.js";
import { t } from "./i18n.js";

const EXPORT_WIDTH = 2400;
const LABEL_MIN_SCREEN_PX = 96;

// Same result as CSS object-fit: cover.
function drawCover(ctx, image, x, y, size) {
  const scale = Math.max(size / image.width, size / image.height);
  const sw = size / scale;
  const sh = size / scale;

  ctx.drawImage(
    image,
    (image.width - sw) / 2,
    (image.height - sh) / 2,
    sw,
    sh,
    x,
    y,
    size,
    size
  );
}

function drawPlaceholder(ctx, album, x, y, size) {
  ctx.fillStyle = "#222";
  ctx.fillRect(x, y, size, size);

  ctx.fillStyle = "#888";
  ctx.font = `600 ${Math.max(10, size / 14)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(album.title, x + size / 2, y + size / 2, size * 0.9);
}

function drawLabel(ctx, album, x, y, size, scale) {
  const height = 34 * scale;
  const top = y + size - height;
  const gradient = ctx.createLinearGradient(0, top, 0, y + size);

  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, "rgba(0,0,0,0.75)");

  ctx.fillStyle = gradient;
  ctx.fillRect(x, top, size, height);

  ctx.fillStyle = "#fff";
  ctx.font = `${10 * scale}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(
    `${album.title} · ${album.artist}`,
    x + 7 * scale,
    y + size - 6 * scale,
    size - 14 * scale
  );
}

/**
 * @param layout     result of buildMosaic()
 * @param screenUnit on-screen size of one grid unit, used so labels
 *                   look the same as in the editor
 * @returns {{ blob: Blob, width: number, height: number, failed: number }}
 */
export async function renderMosaicPng(
  { tiles, columns, rows },
  { showLabels = false, screenUnit = 0 } = {}
) {
  const unit = Math.max(16, Math.round(EXPORT_WIDTH / columns));

  const canvas = document.createElement("canvas");
  canvas.width = columns * unit;
  canvas.height = rows * unit;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";

  const screen = screenUnit || unit;
  const labelScale = unit / screen;

  const images = await Promise.allSettled(
    tiles.map(tile => loadImage(tile.album.image))
  );

  let failed = 0;

  tiles.forEach((tile, i) => {
    const x = tile.x * unit;
    const y = tile.y * unit;
    const size = tile.size * unit;
    const image = images[i];

    if (image.status === "fulfilled") {
      drawCover(ctx, image.value, x, y, size);
      image.value.close();
    } else {
      failed++;
      drawPlaceholder(ctx, tile.album, x, y, size);
    }

    if (showLabels && tile.size * screen >= LABEL_MIN_SCREEN_PX) {
      drawLabel(ctx, tile.album, x, y, size, labelScale);
    }
  });

  const blob = await new Promise(resolve =>
    canvas.toBlob(resolve, "image/png")
  );

  if (!blob) {
    throw new Error(t("pngFailed"));
  }

  return { blob, width: canvas.width, height: canvas.height, failed };
}

export { LABEL_MIN_SCREEN_PX };
