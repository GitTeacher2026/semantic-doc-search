const previewUrlCache = new Map();

let lightboxReady = false;
let scale = 1;
let translateX = 0;
let translateY = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOriginX = 0;
let dragOriginY = 0;
let pinchStartDistance = 0;
let pinchStartScale = 1;

let activeObjectUrl = "";

function releaseActiveObjectUrl() {
  if (!activeObjectUrl) return;
  URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = "";
}

let modalEl;
let stageEl;
let imgEl;
let titleEl;
let zoomLevelEl;

const MIN_SCALE = 1;
const MAX_SCALE = 5;

export function ensurePreviewUrl(file) {
  if (!file || previewUrlCache.has(file)) {
    return previewUrlCache.get(file) || "";
  }
  const url = URL.createObjectURL(file);
  previewUrlCache.set(file, url);
  return url;
}

export function revokePreviewUrl(file) {
  const url = previewUrlCache.get(file);
  if (!url) return;
  URL.revokeObjectURL(url);
  previewUrlCache.delete(file);
}

export function revokeAllPreviewUrls() {
  for (const file of previewUrlCache.keys()) {
    revokePreviewUrl(file);
  }
}

export function syncPreviewUrls(files, isImage) {
  const next = new Set(files);
  for (const file of previewUrlCache.keys()) {
    if (!next.has(file)) revokePreviewUrl(file);
  }
  for (const file of files) {
    if (isImage(file.name)) ensurePreviewUrl(file);
  }
}

function clampScale(value) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function updateTransform() {
  if (!imgEl) return;
  imgEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
  }
  stageEl?.classList.toggle("is-zoomed", scale > 1.01);
}

function resetView() {
  scale = 1;
  translateX = 0;
  translateY = 0;
  updateTransform();
}

function setScale(nextScale, originX, originY) {
  const prev = scale;
  scale = clampScale(nextScale);
  if (scale === prev) return;

  if (originX != null && originY != null && stageEl) {
    const rect = stageEl.getBoundingClientRect();
    const cx = originX - rect.left - rect.width / 2 - translateX;
    const cy = originY - rect.top - rect.height / 2 - translateY;
    const ratio = scale / prev;
    translateX -= cx * (ratio - 1);
    translateY -= cy * (ratio - 1);
  }

  if (scale <= 1.01) {
    translateX = 0;
    translateY = 0;
    scale = 1;
  }
  updateTransform();
}

function zoomBy(delta, originX, originY) {
  setScale(scale + delta, originX, originY);
}

function fitImage() {
  resetView();
}

function closeLightbox() {
  modalEl?.classList.add("hidden");
  document.body.classList.remove("image-preview-open");
  if (imgEl) {
    imgEl.removeAttribute("src");
    imgEl.alt = "";
  }
  releaseActiveObjectUrl();
  resetView();
}

function openLightbox(url, filename = "") {
  ensureLightbox();
  if (!modalEl || !imgEl) return;

  resetView();
  imgEl.src = url;
  imgEl.alt = filename;
  if (titleEl) titleEl.textContent = filename;
  modalEl.classList.remove("hidden");
  document.body.classList.add("image-preview-open");
}

export function openImagePreview(url, filename = "") {
  openLightbox(url, filename);
}

export function openBlobImagePreview(blob, filename = "") {
  if (!blob) return;
  releaseActiveObjectUrl();
  activeObjectUrl = URL.createObjectURL(blob);
  openLightbox(activeObjectUrl, filename);
}

function onPointerDown(event) {
  if (!stageEl || scale <= 1) return;
  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragOriginX = translateX;
  dragOriginY = translateY;
  stageEl.setPointerCapture?.(event.pointerId);
  stageEl.classList.add("is-dragging");
}

function onPointerMove(event) {
  if (!isDragging) return;
  translateX = dragOriginX + (event.clientX - dragStartX);
  translateY = dragOriginY + (event.clientY - dragStartY);
  updateTransform();
}

function onPointerUp(event) {
  if (!isDragging) return;
  isDragging = false;
  stageEl?.classList.remove("is-dragging");
  stageEl?.releasePointerCapture?.(event.pointerId);
}

function onWheel(event) {
  if (!modalEl || modalEl.classList.contains("hidden")) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 0.2 : -0.2;
  zoomBy(delta, event.clientX, event.clientY);
}

function onDoubleClick(event) {
  if (scale > 1.01) {
    fitImage();
    return;
  }
  setScale(2.5, event.clientX, event.clientY);
}

function touchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function onTouchStart(event) {
  if (event.touches.length !== 2) return;
  pinchStartDistance = touchDistance(event.touches);
  pinchStartScale = scale;
}

function onTouchMove(event) {
  if (event.touches.length !== 2 || !pinchStartDistance) return;
  event.preventDefault();
  const distance = touchDistance(event.touches);
  const midpointX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
  const midpointY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
  setScale(pinchStartScale * (distance / pinchStartDistance), midpointX, midpointY);
}

function onTouchEnd() {
  pinchStartDistance = 0;
}

function onKeyDown(event) {
  if (!modalEl || modalEl.classList.contains("hidden")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeLightbox();
  }
  if (event.key === "+" || event.key === "=") zoomBy(0.25);
  if (event.key === "-") zoomBy(-0.25);
  if (event.key === "0") fitImage();
}

function ensureLightbox() {
  if (lightboxReady) return;

  modalEl = document.getElementById("image-preview-modal");
  stageEl = document.getElementById("image-preview-stage");
  imgEl = document.getElementById("image-preview-img");
  titleEl = document.getElementById("image-preview-title");
  zoomLevelEl = document.getElementById("image-preview-zoom-level");

  if (!modalEl || !stageEl || !imgEl) return;

  document.getElementById("image-preview-close")?.addEventListener("click", closeLightbox);
  document.getElementById("image-preview-zoom-in")?.addEventListener("click", () => zoomBy(0.35));
  document.getElementById("image-preview-zoom-out")?.addEventListener("click", () => zoomBy(-0.35));
  document.getElementById("image-preview-zoom-reset")?.addEventListener("click", fitImage);
  modalEl.querySelector("[data-close]")?.addEventListener("click", closeLightbox);

  stageEl.addEventListener("pointerdown", onPointerDown);
  stageEl.addEventListener("pointermove", onPointerMove);
  stageEl.addEventListener("pointerup", onPointerUp);
  stageEl.addEventListener("pointercancel", onPointerUp);
  stageEl.addEventListener("dblclick", onDoubleClick);
  stageEl.addEventListener("wheel", onWheel, { passive: false });
  stageEl.addEventListener("touchstart", onTouchStart, { passive: true });
  stageEl.addEventListener("touchmove", onTouchMove, { passive: false });
  stageEl.addEventListener("touchend", onTouchEnd);

  document.addEventListener("keydown", onKeyDown);
  lightboxReady = true;
}

export function initImagePreview() {
  ensureLightbox();
}
