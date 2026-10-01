/**
 * Minions theme — dark bingo cards and borderless bola draws with the Roundo font
 */

const path = require("path");
const fs = require("fs");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { compareSortableValues } = require("../../utils/helpers");

const fontPath = path.join(__dirname, "../../../assets/fonts/minions/Roundo.ttf");
const eyePath = path.join(__dirname, "../../../assets/themes/minions/minion-eye.png");
const fontFamily = "Roundo";
const EYE_SOURCE = { x: 38, y: 160, width: 1146, height: 893 };

const colors = {
  background: "#C87900",
  monsterBackground: "#780B0B",
  lensBlue: "#1976d2",
  minionYellow: "#ffd21f",
  cardBg: "#2a2a2a",
  headerBg: "#2a2a2a",
  headerText: "#ffffff",
  cellText: "#ffffff",
  cellTextEmpty: "#3a3a3a",
  borderColor: "#333",
  headerBorder: "#333",
  cellBorder: "#2e2e2e",
  selectedBg: "#4a4a4a",
  freeBg: "#3a3a3a",
};

const fonts = {
  badge: `700 32px ${fontFamily}`,
  text: `600 28px ${fontFamily}`,
  label: `700 14px ${fontFamily}`,
  header: `700 30px ${fontFamily}`,
  cell: `600 30px ${fontFamily}`,
  empty: `600 20px ${fontFamily}`,
};

const PAD = 12; // horizontal padding inside each cell

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  try {
    GlobalFonts.registerFromPath(fontPath, fontFamily);
    fontsRegistered = true;
  } catch (error) {
    console.error("Failed to register Roundo font:", error);
  }
}

function drawBackground(ctx, width, height, monsterMode = false) {
  // Use the active Minions palette for the circular background gradient.
  try {
    const radius = Math.max(width, height) * 0.82;
    const gradient = ctx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      0,
      width * 0.5,
      height * 0.5,
      radius,
    );
    const palette = monsterMode
      ? ["#FF4A32", "#D91E18", "#780B0B"]
      : ["#FFE84A", "#F5B800", "#C87900"];
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(0.48, palette[1]);
    gradient.addColorStop(1, palette[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  } catch (err) {
    // fallback to solid fill
    try {
      ctx.fillStyle = colors.background || '#1a1a1a';
      ctx.fillRect(0, 0, width, height);
    } catch (e) {
      console.error('Failed to draw background fallback:', e);
    }
  }
}

function drawCellBackground(ctx, x, y, width, height, item) {
  if (item.selected) {
    ctx.fillStyle = colors.selectedBg;
  } else if (item.value === "FREE") {
    ctx.fillStyle = colors.freeBg;
  } else {
    ctx.fillStyle = colors.cardBg;
  }
  ctx.fillRect(x, y, width, height);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawBadge(ctx, cx, cy, radius, text, eyeImage = null) {
  // Deterministic hue based on text so script and bot produce same color
  let hash = 0;
  for (let i = 0; i < (text || '').length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const baseColor = `hsl(${hue}, 70%, 40%)`;
  const highlightColor = `hsl(${hue}, 70%, 60%)`;
  const shadowColor = `hsl(${hue}, 70%, 25%)`;

  const badgeGradient = ctx.createRadialGradient(cx - 10, cy - 10, 2, cx, cy, radius);
  badgeGradient.addColorStop(0, highlightColor);
  badgeGradient.addColorStop(0.3, baseColor);
  badgeGradient.addColorStop(0.7, shadowColor);
  badgeGradient.addColorStop(1, `hsl(${hue}, 70%, 15%)`);

  if (eyeImage) {
    const frameWidth = 106;
    const frameHeight = 82;
    ctx.drawImage(
      eyeImage,
      EYE_SOURCE.x,
      EYE_SOURCE.y,
      EYE_SOURCE.width,
      EYE_SOURCE.height,
      cx - frameWidth / 2,
      cy - frameHeight / 2,
      frameWidth,
      frameHeight,
    );
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = badgeGradient;
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = "transparent";
  }

  ctx.font = fonts.badge;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = eyeImage ? colors.minionYellow : "#ffffff";
  const labelX = text === "C" ? cx - 2 : cx;
  ctx.fillText(text, labelX, cy);
}

async function loadMinionEye() {
  if (!fs.existsSync(eyePath)) return null;
  try {
    return await loadImage(eyePath);
  } catch (error) {
    console.error("Failed to load Minions eye asset:", error);
    return null;
  }
}

function drawImageCover(ctx, image, targetWidth, targetHeight, offsetX = 0, offsetY = 0) {
  if (!image) return;

  const imageRatio = image.width / image.height;
  const targetRatio = targetWidth / targetHeight;

  let drawWidth = targetWidth;
  let drawHeight = targetHeight;

  if (imageRatio > targetRatio) {
    drawHeight = targetHeight;
    drawWidth = targetHeight * imageRatio;
  } else {
    drawWidth = targetWidth;
    drawHeight = targetWidth / imageRatio;
  }

  const x = offsetX + (targetWidth - drawWidth) / 2;
  const y = offsetY + (targetHeight - drawHeight) / 2;
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
}

/**
 * Measure text width using canvas context
 */
function measureText(ctx, text) {
  return ctx.measureText(text).width;
}

/**
 * Truncate text with ellipsis if it exceeds maxWidth
 */
function truncateText(ctx, text, maxWidth) {
  if (measureText(ctx, text) <= maxWidth) {
    return text;
  }
  let truncated = text;
  while (truncated.length > 0 && measureText(ctx, truncated + "…") > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "…";
}

/**
 * Calculate the ideal column width based on the longest header or cell value in a column.
 * Returns the width, clamped to [minColWidth, maxColWidth].
 */
function calcColWidth(ctx, header, items, minColWidth, maxColWidth) {
  ctx.font = fonts.header;
  const headerW = measureText(ctx, String(header));

  ctx.font = fonts.cell;
  let maxItemW = 0;
  for (const item of items) {
    const w = measureText(ctx, String(item.value || ""));
    if (w > maxItemW) maxItemW = w;
  }

  const needed = Math.max(headerW, maxItemW) + PAD * 2;
  return Math.max(minColWidth, Math.min(maxColWidth, Math.ceil(needed)));
}

function generateBingoImageCanvas(game, themeId = null) {
  registerFonts();

  const numRows = game.card[0]?.items?.length || 15;
  const headerHeight = 78;
  const cellHeight = 70;
  const minColWidth = 160;
  const maxColWidth = 400;

  // Create a temporary canvas to measure text
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");

  // Calculate column widths dynamically based on content
  const colWidths = game.card.map((column) => {
    return calcColWidth(measureCtx, column.category, column.items, minColWidth, maxColWidth);
  });
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const height = headerHeight + cellHeight * numRows;

  const canvas = createCanvas(totalWidth, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, totalWidth, height);

  game.card.forEach((column, colIndex) => {
    const colWidth = colWidths[colIndex];
    const x = colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
    const header = column.category;

    // Draw header background
    ctx.fillStyle = colors.headerBg;
    ctx.fillRect(x, 0, colWidth, headerHeight);

    ctx.strokeStyle = colors.headerBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 0, colWidth, headerHeight);

    ctx.beginPath();
    ctx.moveTo(x, headerHeight);
    ctx.lineTo(x + colWidth, headerHeight);
    ctx.strokeStyle = colors.headerBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = colors.headerText;
    ctx.font = fonts.header;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const displayHeader = truncateText(ctx, header, colWidth - PAD * 2);
    ctx.fillText(displayHeader, x + colWidth / 2, headerHeight / 2);

    // Sort items by value
    const sortedItems = [...column.items].sort((a, b) => {
      return compareSortableValues(a.value, b.value);
    });

    // Draw cells
    sortedItems.forEach((item, rowIndex) => {
      const y = headerHeight + rowIndex * cellHeight;

      drawCellBackground(ctx, x, y, colWidth, cellHeight, item);

      ctx.strokeStyle = colors.cellBorder;
      ctx.lineWidth = 1;

      if (colIndex < game.card.length - 1) {
        ctx.beginPath();
        ctx.moveTo(x + colWidth, y);
        ctx.lineTo(x + colWidth, y + cellHeight);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(x, y + cellHeight);
      ctx.lineTo(x + colWidth, y + cellHeight);
      ctx.strokeStyle = colors.cellBorder;
      ctx.stroke();

      ctx.fillStyle = item.value === "FREE" || !item.value ? colors.cellTextEmpty : colors.cellText;
      ctx.font = fonts.cell;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const displayText = truncateText(ctx, item.value || "", colWidth - PAD * 2);
      ctx.fillText(displayText || "", x + colWidth / 2, y + cellHeight / 2);
    });
  });

  return canvas.toBuffer("image/png");
}

async function generateBolaImageForDrawsCanvas(draws, roundNumber, themeId = null, monsterMode = false) {
  registerFonts();
  const eyeImage = await loadMinionEye();

  const SIDE_PAD = 20;
  const TOP_PAD = 16;
  const BOTTOM_PAD = 20;
  const ROW_GAP = 12;
  const GAP = 16;
  const FRAME_WIDTH = 106;
  const FRAME_HEIGHT = 82;
  const RENDER_SCALE = 2;
  const rowH = FRAME_HEIGHT;
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = fonts.text;
  const maxTextW = Math.max(...draws.map(([, val]) => measureCtx.measureText(String(val)).width));
  const contentW = FRAME_WIDTH + GAP + maxTextW;
  const cardH = rowH * draws.length + ROW_GAP * Math.max(0, draws.length - 1);

  const W = contentW + SIDE_PAD * 2;
  const H = TOP_PAD + cardH + BOTTOM_PAD;

  const canvas = createCanvas(W * RENDER_SCALE, H * RENDER_SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  // Keep the draw area open; the eye frames are the only visual containers.
  drawBackground(ctx, W, H, monsterMode);

  draws.forEach(([cat, val], i) => {
    const y = TOP_PAD + i * (rowH + ROW_GAP);
    const cy = y + rowH / 2;
    const badgeCx = SIDE_PAD + FRAME_WIDTH / 2;
    const textX = SIDE_PAD + FRAME_WIDTH + GAP;

    drawBadge(ctx, badgeCx, cy, 30, cat, eyeImage);

    ctx.font = fonts.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffd21f";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 5;
    ctx.strokeText(String(val), textX, cy);
    ctx.fillText(String(val), textX, cy);
  });

  const buf = canvas.toBuffer("image/png");
  return buf;
}

// Note: rainy canvas renderer removed — Playwright-based rainy template will be used instead.

async function generateBingoDrawnItemsImage(game) {
  registerFonts();

  const categoryOrder = game.card.map((column) => column.category);
  const drawnSet = new Set((game.drawOrder || []).map(([category, value]) => `${category}:${value}`));
  const headerHeight = 64;
  const cellHeight = 78;
  const cellGap = 6;
  const colGap = 6;
  const colWidth = 190;
  const padding = 24;
  const headerToTableGap = 12;
  const itemFont = '600 24px "Trebuchet MS", "Segoe UI", sans-serif';
  const numCols = categoryOrder.length;
  const maxRows = Math.max(...game.card.map((column) => column.items.length));
  const width = colWidth * numCols + colGap * (numCols - 1) + padding * 2;
  const height = headerHeight + headerToTableGap + (cellHeight + cellGap) * maxRows + padding * 2;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const bgPath = path.join(__dirname, "../../../assets/themes/minions/bg.jpg");
  const bobPath = path.join(__dirname, "../../../assets/themes/minions/bob.png");
  const bobImage = fs.existsSync(bobPath) ? await loadImage(bobPath) : null;
  if (fs.existsSync(bgPath)) {
    drawImageCover(ctx, await loadImage(bgPath), width, height);
  } else {
    drawBackground(ctx, width, height);
  }
  ctx.fillStyle = "rgba(255, 210, 31, 0.18)";
  ctx.fillRect(0, 0, width, height);

  categoryOrder.forEach((category, colIndex) => {
    const column = game.card[colIndex];
    const x = padding + colIndex * (colWidth + colGap);
    const centerX = x + colWidth / 2;
    const badgeY = padding + headerHeight / 2;
    const labelY = category === "C" ? badgeY + 3 : badgeY;
    ctx.font = `700 42px ${fontFamily}`;
    ctx.fillStyle = "#ffd21f";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 8;
    ctx.strokeText(category, centerX, labelY);
    ctx.fillText(category, centerX, labelY);

    const sortedItems = [...column.items].sort((a, b) => compareSortableValues(a.value, b.value));
    sortedItems.forEach((item, rowIndex) => {
      const y = padding + headerHeight + headerToTableGap + rowIndex * (cellHeight + cellGap);
      const isDrawn = drawnSet.has(`${category}:${item.value}`) || item.selected;
      ctx.fillStyle = isDrawn ? "#ffd21f" : "rgba(255, 255, 255, 0.58)";
      ctx.shadowColor = isDrawn ? "transparent" : "rgba(120, 11, 11, 0.18)";
      ctx.shadowBlur = isDrawn ? 0 : 8;
      ctx.shadowOffsetY = isDrawn ? 0 : 2;
      ctx.fillRect(x, y, colWidth, cellHeight);
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = isDrawn ? "#a86f00" : "rgba(255, 255, 255, 0.72)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, colWidth, cellHeight);

      const text = String(item.value);
      if (text === "Bob" && bobImage) {
        const imageHeight = cellHeight * 1.2;
        const imageWidth = bobImage.width * (imageHeight / bobImage.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, colWidth, cellHeight);
        ctx.clip();
        ctx.drawImage(
          bobImage,
          x + (colWidth - imageWidth) / 2,
          y + cellHeight - imageHeight + 30,
          imageWidth,
          imageHeight,
        );
        ctx.restore();
        return;
      }

      ctx.font = itemFont;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isDrawn ? "#000000" : "#5f120d";
      const maxTextWidth = colWidth - 20;
      if (ctx.measureText(text).width <= maxTextWidth) {
        ctx.fillText(text, centerX, y + cellHeight / 2);
      } else {
        const words = text.split(" ");
        const lines = [];
        let current = "";
        words.forEach((word) => {
          const candidate = current ? `${current} ${word}` : word;
          if (current && ctx.measureText(candidate).width > maxTextWidth) {
            lines.push(current);
            current = word;
          } else {
            current = candidate;
          }
        });
        if (current) lines.push(current);
        const lineHeight = 26;
        const startY = y + cellHeight / 2 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, lineIndex) => ctx.fillText(line, centerX, startY + lineIndex * lineHeight));
      }
    });
  });

  return canvas.toBuffer("image/png");
}

module.exports = {
  generateBingoImageCanvas,
  generateBolaImageForDrawsCanvas,
  generateBingoDrawnItemsImage,
};