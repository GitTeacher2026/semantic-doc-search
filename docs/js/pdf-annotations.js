export const EDIT_TOOLS = {
  SELECT: "select",
  TEXT: "text",
  HIGHLIGHT: "highlight",
  WHITEOUT: "whiteout",
  PEN: "pen",
  RECT: "rect",
  IMAGE: "image",
  SIGNATURE: "signature",
};

export function createAnnotationStore() {
  return {
    byPage: {},
    selectedId: null,
    activeTool: EDIT_TOOLS.SELECT,
    penColor: "#dc2626",
    textColor: "#111827",
    textSize: 16,
    drawing: null,
  };
}

export function getPageAnnotations(store, pageIndex) {
  if (!store.byPage[pageIndex]) store.byPage[pageIndex] = [];
  return store.byPage[pageIndex];
}

export function addAnnotation(store, pageIndex, annotation) {
  const list = getPageAnnotations(store, pageIndex);
  list.push({ id: crypto.randomUUID(), ...annotation });
  store.selectedId = list[list.length - 1].id;
  return list[list.length - 1];
}

export function removeAnnotation(store, pageIndex, id) {
  const list = getPageAnnotations(store, pageIndex);
  store.byPage[pageIndex] = list.filter((item) => item.id !== id);
  if (store.selectedId === id) store.selectedId = null;
}

export function findAnnotation(store, pageIndex, id) {
  return getPageAnnotations(store, pageIndex).find((item) => item.id === id) || null;
}

export function hitTestAnnotation(store, pageIndex, x, y) {
  const list = getPageAnnotations(store, pageIndex);
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const ann = list[i];
    if (x >= ann.x && x <= ann.x + ann.width && y >= ann.y && y <= ann.y + ann.height) {
      return ann;
    }
  }
  return null;
}

function drawRect(ctx, ann, { selected = false } = {}) {
  if (ann.type === "highlight") {
    ctx.fillStyle = "rgba(255, 235, 59, 0.45)";
    ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
  } else if (ann.type === "whiteout") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ann.x, ann.y, ann.width, ann.height);
    ctx.strokeStyle = "#e5e7eb";
    ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
  } else if (ann.type === "rect") {
    ctx.strokeStyle = ann.color || "#2563eb";
    ctx.lineWidth = 2;
    ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);
  } else if (ann.type === "text") {
    ctx.fillStyle = ann.color || "#111827";
    ctx.font = `${ann.fontSize || 16}px "Noto Sans Arabic", sans-serif`;
    ctx.textAlign = "right";
    ctx.direction = "rtl";
    const lines = String(ann.text || "").split("\n");
    let lineY = ann.y + (ann.fontSize || 16);
    for (const line of lines) {
      ctx.fillText(line, ann.x + ann.width, lineY, ann.width);
      lineY += (ann.fontSize || 16) * 1.35;
    }
  } else if (ann.dataUrl) {
    if (!ann._image) {
      const img = new Image();
      img.src = ann.dataUrl;
      ann._image = img;
    }
    if (ann._image.complete) {
      ctx.drawImage(ann._image, ann.x, ann.y, ann.width, ann.height);
    } else {
      ann._image.onload = () => {};
    }
  }

  if (selected) {
    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(ann.x - 2, ann.y - 2, ann.width + 4, ann.height + 4);
    ctx.setLineDash([]);
  }
}

export function renderAnnotationsOverlay(ctx, store, pageIndex) {
  const list = getPageAnnotations(store, pageIndex);
  for (const ann of list) {
    drawRect(ctx, ann, { selected: ann.id === store.selectedId });
  }

  if (store.drawing) {
    const d = store.drawing;
    if (d.type === "box") {
      ctx.strokeStyle = d.previewColor || "#14b8a6";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(d.x, d.y, d.width, d.height);
      ctx.setLineDash([]);
    } else if (d.type === "pen" && d.points?.length > 1) {
      ctx.strokeStyle = d.color || "#dc2626";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(d.points[0].x, d.points[0].y);
      for (let i = 1; i < d.points.length; i += 1) {
        ctx.lineTo(d.points[i].x, d.points[i].y);
      }
      ctx.stroke();
    }
  }
}

function normalizeBox(x0, y0, x1, y1) {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

function penBounds(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX || 1,
    height: Math.max(...ys) - minY || 1,
    points,
  };
}

function rasterizePen(points, bounds, color) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(bounds.width));
  canvas.height = Math.max(1, Math.ceil(bounds.height));
  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = color || "#dc2626";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x - bounds.x, points[0].y - bounds.y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x - bounds.x, points[i].y - bounds.y);
  }
  ctx.stroke();
  return canvas.toDataURL("image/png");
}

export function bindAnnotationInteractions({
  overlay,
  getPageIndex,
  getViewportMeta,
  store,
  onChange,
  onRequestText,
  onRequestImage,
  onRequestSignature,
}) {
  function localPoint(event) {
    const rect = overlay.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  function finishBox(type, box, extra = {}) {
    if (box.width < 6 || box.height < 6) return;
    const pageIndex = getPageIndex();
    addAnnotation(store, pageIndex, { type, ...box, ...extra });
    store.drawing = null;
    onChange?.();
  }

  overlay.addEventListener("pointerdown", (event) => {
    if (!getViewportMeta()) return;
    const point = localPoint(event);
    const pageIndex = getPageIndex();
    overlay.setPointerCapture(event.pointerId);

    if (store.activeTool === EDIT_TOOLS.SELECT) {
      const hit = hitTestAnnotation(store, pageIndex, point.x, point.y);
      store.selectedId = hit?.id || null;
      onChange?.();
      return;
    }

    if (store.activeTool === EDIT_TOOLS.TEXT) {
      onRequestText?.(point, (text) => {
        if (!text?.trim()) return;
        addAnnotation(store, pageIndex, {
          type: "text",
          x: point.x,
          y: point.y,
          width: 240,
          height: (store.textSize || 16) * 3,
          text: text.trim(),
          fontSize: store.textSize || 16,
          color: store.textColor,
        });
        onChange?.();
      });
      return;
    }

    if (store.activeTool === EDIT_TOOLS.IMAGE) {
      onRequestImage?.((dataUrl, naturalWidth, naturalHeight) => {
        const maxW = 220;
        const scale = maxW / naturalWidth;
        addAnnotation(store, pageIndex, {
          type: "image",
          x: point.x,
          y: point.y,
          width: maxW,
          height: naturalHeight * scale,
          dataUrl,
        });
        onChange?.();
      });
      return;
    }

    if (store.activeTool === EDIT_TOOLS.SIGNATURE) {
      onRequestSignature?.((dataUrl, width, height) => {
        addAnnotation(store, pageIndex, {
          type: "signature",
          x: point.x,
          y: point.y,
          width,
          height,
          dataUrl,
        });
        onChange?.();
      });
      return;
    }

    if (
      store.activeTool === EDIT_TOOLS.HIGHLIGHT ||
      store.activeTool === EDIT_TOOLS.WHITEOUT ||
      store.activeTool === EDIT_TOOLS.RECT
    ) {
      store.drawing = {
        type: "box",
        startX: point.x,
        startY: point.y,
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        previewColor:
          store.activeTool === EDIT_TOOLS.HIGHLIGHT
            ? "#facc15"
            : store.activeTool === EDIT_TOOLS.WHITEOUT
              ? "#ffffff"
              : "#2563eb",
      };
      onChange?.();
      return;
    }

    if (store.activeTool === EDIT_TOOLS.PEN) {
      store.drawing = {
        type: "pen",
        color: store.penColor,
        points: [point],
      };
      onChange?.();
    }
  });

  overlay.addEventListener("pointermove", (event) => {
    if (!store.drawing) return;
    const point = localPoint(event);
    if (store.drawing.type === "box") {
      const box = normalizeBox(store.drawing.startX, store.drawing.startY, point.x, point.y);
      store.drawing = { ...store.drawing, ...box };
    } else if (store.drawing.type === "pen") {
      store.drawing.points.push(point);
    }
    onChange?.();
  });

  overlay.addEventListener("pointerup", () => {
    if (!store.drawing) return;
    const pageIndex = getPageIndex();
    if (store.drawing.type === "box") {
      const tool = store.activeTool;
      if (tool === EDIT_TOOLS.HIGHLIGHT) finishBox("highlight", store.drawing);
      else if (tool === EDIT_TOOLS.WHITEOUT) finishBox("whiteout", store.drawing);
      else if (tool === EDIT_TOOLS.RECT) finishBox("rect", store.drawing, { color: "#2563eb" });
      else store.drawing = null;
    } else if (store.drawing.type === "pen" && store.drawing.points?.length > 1) {
      const bounds = penBounds(store.drawing.points);
      const dataUrl = rasterizePen(store.drawing.points, bounds, store.drawing.color);
      addAnnotation(store, pageIndex, {
        type: "pen",
        ...bounds,
        dataUrl,
      });
      store.drawing = null;
      onChange?.();
    } else {
      store.drawing = null;
      onChange?.();
    }
  });
}

export function deleteSelectedAnnotation(store, pageIndex) {
  if (!store.selectedId) return false;
  removeAnnotation(store, pageIndex, store.selectedId);
  return true;
}

export function setActiveTool(store, tool) {
  store.activeTool = tool;
  store.drawing = null;
  if (tool !== EDIT_TOOLS.SELECT) store.selectedId = null;
}

export function exportAnnotationsByPage(store) {
  return store.byPage;
}
