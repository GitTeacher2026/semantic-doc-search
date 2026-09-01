const previewUrlCache = new Map();

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

let lightboxReady = false;
let scale = 1;
let translateX = 0;
let translateY = 0;
let baseWidth = 0;
let baseHeight = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOriginX = 0;
let dragOriginY = 0;
let pinchStartDistance = 0;
let pinchStartScale = 1;
let stageResizeObserver = null;

let activeObjectUrl = "";
let previewContext = {
  docId: null,
  comment: "",
  onSaveComment: null,
};

function releaseActiveObjectUrl() {
  if (!activeObjectUrl) return;
  URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = "";
}

let modalEl;
let stageEl;
let frameEl;
let imgEl;
let titleEl;
let zoomLevelEl;
let zoomOutBtn;
let zoomInBtn;
let commentsPanel;
let commentInput;
let commentSaveBtn;
let commentStatus;

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

function getStageRect() {
  return stageEl?.getBoundingClientRect() || { width: 0, height: 0, left: 0, top: 0 };
}

function getStageCenter() {
  const rect = getStageRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function computeFitSize() {
  const naturalWidth = imgEl?.naturalWidth || 0;
  const naturalHeight = imgEl?.naturalHeight || 0;
  const { width: stageWidth, height: stageHeight } = getStageRect();

  if (!naturalWidth || !naturalHeight || !stageWidth || !stageHeight) {
    return { width: 0, height: 0 };
  }

  const ratio = Math.min(stageWidth / naturalWidth, stageHeight / naturalHeight);
  return {
    width: Math.max(1, Math.round(naturalWidth * ratio)),
    height: Math.max(1, Math.round(naturalHeight * ratio)),
  };
}

function updateZoomButtons() {
  if (zoomOutBtn) zoomOutBtn.disabled = scale <= MIN_SCALE + 0.001;
  if (zoomInBtn) zoomInBtn.disabled = scale >= MAX_SCALE - 0.001;
}

function updateTransform() {
  if (!frameEl) return;
  frameEl.style.transform =
    `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px)) scale(${scale})`;
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${Math.round(scale * 100)}%`;
  }
  stageEl?.classList.toggle("is-zoomed", scale > 1.01);
  stageEl?.classList.toggle("is-dragging", isDragging);
  updateZoomButtons();
}

function resetPan() {
  translateX = 0;
  translateY = 0;
}

function resetView() {
  scale = 1;
  resetPan();
  updateTransform();
}

function setFrameSize(width, height) {
  if (!frameEl) return;
  baseWidth = width;
  baseHeight = height;
  frameEl.style.width = `${width}px`;
  frameEl.style.height = `${height}px`;
}

function applyImageLayout({ preserveScale = false } = {}) {
  if (!imgEl || !frameEl || !stageEl) return;

  const previousScale = scale;
  const fit = computeFitSize();
  if (!fit.width || !fit.height) return;

  setFrameSize(fit.width, fit.height);

  if (!preserveScale) {
    scale = 1;
    resetPan();
  } else {
    scale = clampScale(previousScale);
  }

  updateTransform();
}

function scheduleImageLayout({ preserveScale = false } = {}) {
  requestAnimationFrame(() => {
    applyImageLayout({ preserveScale });
    requestAnimationFrame(() => applyImageLayout({ preserveScale }));
  });
}

function setScale(nextScale, originX, originY) {
  const prev = scale;
  scale = clampScale(nextScale);
  if (Math.abs(scale - prev) < 0.0001) return;

  const center = getStageCenter();
  const ox = originX ?? center.x;
  const oy = originY ?? center.y;
  const focalX = ox - center.x;
  const focalY = oy - center.y;
  const ratio = scale / prev;

  translateX = (translateX - focalX) * ratio + focalX;
  translateY = (translateY - focalY) * ratio + focalY;

  if (scale <= 1.01) {
    resetPan();
  }

  updateTransform();
}

function zoomBy(delta, originX, originY) {
  setScale(scale + delta, originX, originY);
}

function fitImage() {
  applyImageLayout({ preserveScale: false });
}

function updateCommentsPanel() {
  if (!commentsPanel || !commentInput) return;
  const show = Boolean(previewContext.docId);
  commentsPanel.classList.toggle("hidden", !show);
  if (!show) return;
  commentInput.value = previewContext.comment || "";
  if (commentStatus) {
    commentStatus.textContent = "";
    commentStatus.classList.add("hidden");
  }
}

async function saveComment() {
  if (!previewContext.docId || !commentInput) return;
  const nextComment = commentInput.value.trim();
  if (!previewContext.onSaveComment) return;

  commentSaveBtn.disabled = true;
  try {
    await previewContext.onSaveComment(nextComment);
    previewContext.comment = nextComment;
    if (commentStatus) {
      commentStatus.textContent = "تم حفظ التعليق.";
      commentStatus.classList.remove("hidden", "error");
    }
  } catch (error) {
    if (commentStatus) {
      commentStatus.textContent = error.message || "تعذّر حفظ التعليق.";
      commentStatus.classList.remove("hidden");
      commentStatus.classList.add("error");
    }
  } finally {
    commentSaveBtn.disabled = false;
  }
}

function closeLightbox() {
  modalEl?.classList.add("hidden");
  document.body.classList.remove("image-preview-open");
  if (imgEl) {
    imgEl.removeAttribute("src");
    imgEl.alt = "";
    imgEl.onload = null;
  }
  if (frameEl) {
    frameEl.removeAttribute("style");
  }
  releaseActiveObjectUrl();
  previewContext = { docId: null, comment: "", onSaveComment: null };
  updateCommentsPanel();
  scale = 1;
  baseWidth = 0;
  baseHeight = 0;
  resetPan();
}

function handleImageReady() {
  scheduleImageLayout({ preserveScale: false });
}

function openLightbox(url, filename = "", options = {}) {
  ensureLightbox();
  if (!modalEl || !imgEl || !frameEl) return;

  previewContext = {
    docId: options.docId || null,
    comment: options.comment || "",
    onSaveComment: options.onSaveComment || null,
  };
  updateCommentsPanel();

  scale = 1;
  resetPan();
  setFrameSize(1, 1);
  updateTransform();

  imgEl.onload = handleImageReady;
  imgEl.src = url;
  imgEl.alt = filename;
  if (titleEl) titleEl.textContent = filename;

  modalEl.classList.remove("hidden");
  document.body.classList.add("image-preview-open");

  if (imgEl.complete && imgEl.naturalWidth > 0) {
    handleImageReady();
  } else {
    scheduleImageLayout({ preserveScale: false });
  }

  updateZoomButtons();
}

export function openImagePreview(url, filename = "", options = {}) {
  openLightbox(url, filename, options);
}

export function openBlobImagePreview(blob, filename = "", options = {}) {
  if (!blob) return;
  releaseActiveObjectUrl();
  activeObjectUrl = URL.createObjectURL(blob);
  openLightbox(activeObjectUrl, filename, options);
}

function onPointerDown(event) {
  if (!stageEl || scale <= 1.01) return;
  isDragging = true;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragOriginX = translateX;
  dragOriginY = translateY;
  stageEl.setPointerCapture?.(event.pointerId);
  updateTransform();
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
  stageEl?.releasePointerCapture?.(event.pointerId);
  updateTransform();
}

function onWheel(event) {
  if (!modalEl || modalEl.classList.contains("hidden")) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 0.15 : -0.15;
  zoomBy(delta, event.clientX, event.clientY);
}

function onDoubleClick(event) {
  if (scale > 1.01) {
    fitImage();
    return;
  }
  const center = getStageCenter();
  setScale(2.5, center.x, center.y);
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
  const center = getStageCenter();
  if (event.key === "+" || event.key === "=") zoomBy(0.25, center.x, center.y);
  if (event.key === "-") zoomBy(-0.25, center.x, center.y);
  if (event.key === "0") fitImage();
}

function onStageResize() {
  if (!modalEl || modalEl.classList.contains("hidden")) return;
  if (!imgEl?.naturalWidth) return;
  applyImageLayout({ preserveScale: true });
}

function ensureLightbox() {
  if (lightboxReady) return;

  modalEl = document.getElementById("image-preview-modal");
  stageEl = document.getElementById("image-preview-stage");
  frameEl = document.getElementById("image-preview-frame");
  imgEl = document.getElementById("image-preview-img");
  titleEl = document.getElementById("image-preview-title");
  zoomLevelEl = document.getElementById("image-preview-zoom-level");
  zoomOutBtn = document.getElementById("image-preview-zoom-out");
  zoomInBtn = document.getElementById("image-preview-zoom-in");
  commentsPanel = document.getElementById("image-preview-comments");
  commentInput = document.getElementById("image-preview-comment");
  commentSaveBtn = document.getElementById("image-preview-save-comment");
  commentStatus = document.getElementById("image-preview-comment-status");

  if (!modalEl || !stageEl || !frameEl || !imgEl) return;

  document.getElementById("image-preview-close")?.addEventListener("click", closeLightbox);
  zoomInBtn?.addEventListener("click", () => {
    const center = getStageCenter();
    zoomBy(0.25, center.x, center.y);
  });
  zoomOutBtn?.addEventListener("click", () => {
    const center = getStageCenter();
    zoomBy(-0.25, center.x, center.y);
  });
  document.getElementById("image-preview-zoom-reset")?.addEventListener("click", fitImage);
  commentSaveBtn?.addEventListener("click", () => saveComment());
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
  modalEl.addEventListener("wheel", onWheel, { passive: false });

  if (typeof ResizeObserver !== "undefined" && stageEl) {
    stageResizeObserver = new ResizeObserver(() => onStageResize());
    stageResizeObserver.observe(stageEl);
  }

  document.addEventListener("keydown", onKeyDown);
  lightboxReady = true;
}

export function initImagePreview() {
  ensureLightbox();
}
