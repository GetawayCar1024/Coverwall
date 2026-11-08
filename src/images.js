// src/images.js

// Fetch with CORS and no cache so a canvas drawing the image is not
// tainted by a cached, non-CORS copy of the image shown on screen.
export async function loadImage(src) {
  const response = await fetch(src, { mode: "cors", cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Image request failed: ${response.status}`);
  }

  return createImageBitmap(await response.blob());
}
