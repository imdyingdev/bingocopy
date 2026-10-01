/**
 * Default theme — dark bingo cards and bola draws
 */

const path = require("path");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { compareSortableValues } = require("../../utils/helpers");

const fontBase = path.join(__dirname, "../../../node_modules/@fontsource/figtree/files");
const roundedFontBase = path.join(__dirname, "../../../node_modules/@fontsource/fredoka-one/files");
const fontFamily = "Figtree";
const roundedFontFamily = "Fredoka One";
const soireeFontPath = path.join(__dirname, "../../../assets/fonts/Soiree/elegant-wonderful.ttf");
const soireeFontFamily = "Elegant Wonderful";
const soireeListaBackgroundPath = path.join(__dirname, "../../../assets/themes/soiree/golden.jpg");
const soireeAespaImagePath = path.join(__dirname, "../../../assets/themes/soiree/aespa.jfif");

const colors = {
  background: "#1a1a1a",
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

const themeColors = {
  lovers_soiree: {
    background: "#32121c",
    cardBg: "#4b1b29",
    headerBg: "#7b293c",
    headerText: "#fff4f6",
    cellText: "#ffe8ed",
    cellTextEmpty: "#b97887",
    borderColor: "#642235",
    headerBorder: "#a94c62",
    cellBorder: "#6f2940",
    selectedBg: "#a94c62",
    freeBg: "#8c3d54",
    badgeHighlight: "#c96b82",
    badgeBase: "#7b293c",
    badgeShadow: "#4b1b29",
    badgeDark: "#32121c",
  },
};

function getThemeColors(themeId) {
  return themeColors[themeId] || colors;
}

const fonts = {
  badge: `700 26px "Segoe UI Emoji", "Noto Color Emoji", ${fontFamily}700, Arial, sans-serif`,
  text: `600 28px ${fontFamily}600`,
  label: `700 14px ${fontFamily}700`,
  header: `700 30px ${fontFamily}700`,
  cell: `600 30px ${fontFamily}600`,
  empty: `600 20px ${fontFamily}600`,
};

const themeFonts = {
  lovers_soiree: {
    badge: fonts.badge,
    text: `600 28px "${soireeFontFamily}"`,
    label: fonts.label,
    header: `700 30px "${soireeFontFamily}"`,
    cell: `600 30px "${soireeFontFamily}"`,
    empty: fonts.empty,
  },
};

const listaThemeFonts = {
  lovers_soiree: {
    ...themeFonts.lovers_soiree,
    cell: `400 24px "${roundedFontFamily}"`,
  },
};

function getThemeFonts(themeId, variant = "default") {
  if (variant === "lista") {
    return listaThemeFonts[themeId] || themeFonts[themeId] || fonts;
  }
  return themeFonts[themeId] || fonts;
}

const PAD = 12; // horizontal padding inside each cell

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  try {
    GlobalFonts.registerFromPath(
      path.join(fontBase, "figtree-latin-400-normal.woff2"),
      `${fontFamily}400`,
    );
    GlobalFonts.registerFromPath(
      path.join(fontBase, "figtree-latin-600-normal.woff2"),
      `${fontFamily}600`,
    );
    GlobalFonts.registerFromPath(
      path.join(fontBase, "figtree-latin-700-normal.woff2"),
      `${fontFamily}700`,
    );
    GlobalFonts.registerFromPath(
      path.join(roundedFontBase, "fredoka-one-latin-400-normal.woff2"),
      roundedFontFamily,
    );
    GlobalFonts.registerFromPath(soireeFontPath, soireeFontFamily);
    fontsRegistered = true;
  } catch (error) {
    console.error("Failed to register Figtree fonts:", error);
  }
}

function drawBackground(ctx, width, height, palette) {
  // Draw a subtle vertical gradient with a soft vignette for depth
  try {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, palette.background);
    g.addColorStop(1, palette.cardBg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    // soft vignette
    ctx.save();
    const vignette = ctx.createRadialGradient(width/2, height/2, Math.max(width, height)/6, width/2, height/2, Math.max(width, height)/1.1);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vignette;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } catch (err) {
    // fallback to solid fill
    try {
      ctx.fillStyle = palette.background || '#1a1a1a';
      ctx.fillRect(0, 0, width, height);
    } catch (e) {
      console.error('Failed to draw background fallback:', e);
    }
  }
}

function drawCellBackground(ctx, x, y, width, height, item, palette) {
  if (item.selected) {
    ctx.fillStyle = palette.selectedBg;
  } else if (item.value === "FREE") {
    ctx.fillStyle = palette.freeBg;
  } else {
    ctx.fillStyle = palette.cardBg;
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

function drawBadge(ctx, cx, cy, radius, text, palette, activeFonts) {
  // Deterministic hue based on text so script and bot produce same color
  let hash = 0;
  for (let i = 0; i < (text || '').length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const baseColor = palette.badgeBase || `hsl(${hue}, 70%, 40%)`;
  const highlightColor = palette.badgeHighlight || `hsl(${hue}, 70%, 60%)`;
  const shadowColor = palette.badgeShadow || `hsl(${hue}, 70%, 25%)`;

  const badgeGradient = ctx.createRadialGradient(cx - 10, cy - 10, 2, cx, cy, radius);
  badgeGradient.addColorStop(0, highlightColor);
  badgeGradient.addColorStop(0.3, baseColor);
  badgeGradient.addColorStop(0.7, shadowColor);
  badgeGradient.addColorStop(1, palette.badgeDark || `hsl(${hue}, 70%, 15%)`);

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = badgeGradient;
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.font = activeFonts.badge;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, cy);
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

function wrapTextLines(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (!currentLine || measureText(ctx, candidate) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  if (lines.length > maxLines) {
    lines.splice(maxLines - 1, lines.length - maxLines + 1, lines.slice(maxLines - 1).join(" "));
  }

  if (lines[maxLines - 1] && measureText(ctx, lines[maxLines - 1]) > maxWidth) {
    lines[maxLines - 1] = truncateText(ctx, lines[maxLines - 1], maxWidth);
  }

  return lines.length ? lines : [""];
}

/**
 * Calculate the ideal column width based on the longest header or cell value in a column.
 * Returns the width, clamped to [minColWidth, maxColWidth].
 */
function calcColWidth(ctx, header, items, minColWidth, maxColWidth, activeFonts) {
  ctx.font = activeFonts.header;
  const headerW = measureText(ctx, String(header));

  ctx.font = activeFonts.cell;
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
  const palette = getThemeColors(themeId);
  const activeFonts = getThemeFonts(themeId);

  const numRows = game.card[0]?.items?.length || 15;
  const headerHeight = 78;
  const cellHeight = themeId === "lovers_soiree" ? 86 : 70;
  const minColWidth = 160;
  const maxColWidth = 400;

  // Create a temporary canvas to measure text
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");

  // Calculate column widths dynamically based on content
  const colWidths = game.card.map((column) => {
    return calcColWidth(measureCtx, column.category, column.items, minColWidth, maxColWidth, activeFonts);
  });
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const height = headerHeight + cellHeight * numRows;

  const canvas = createCanvas(totalWidth, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, totalWidth, height, palette);

  game.card.forEach((column, colIndex) => {
    const colWidth = colWidths[colIndex];
    const x = colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
    const header = column.category;

    // Draw header background
    ctx.fillStyle = palette.headerBg;
    ctx.fillRect(x, 0, colWidth, headerHeight);

    ctx.strokeStyle = palette.headerBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 0, colWidth, headerHeight);

    ctx.beginPath();
    ctx.moveTo(x, headerHeight);
    ctx.lineTo(x + colWidth, headerHeight);
    ctx.strokeStyle = palette.headerBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = palette.headerText;
    ctx.font = activeFonts.header;
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

      drawCellBackground(ctx, x, y, colWidth, cellHeight, item, palette);

      ctx.strokeStyle = palette.cellBorder;
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
      ctx.strokeStyle = palette.cellBorder;
      ctx.stroke();

      ctx.fillStyle = item.value === "FREE" || !item.value ? palette.cellTextEmpty : palette.cellText;
      ctx.font = activeFonts.cell;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const displayText = truncateText(ctx, item.value || "", colWidth - PAD * 2);
      ctx.fillText(displayText || "", x + colWidth / 2, y + cellHeight / 2);
    });
  });

  return canvas.toBuffer("image/png");
}

function generateBolaImageForDrawsCanvas(draws, roundNumber, themeId = null) {
  registerFonts();
  const palette = getThemeColors(themeId);
  const activeFonts = getThemeFonts(themeId);

  const isCompactSoiree = themeId === "lovers_soiree";
  const PAD_X = isCompactSoiree ? 12 : 16;
  const PAD_Y = 12;
  const GAP = isCompactSoiree ? 24 : 16;
  const BADGE = isCompactSoiree ? 52 : 60;
  const FONT = 28;
  const rowH = PAD_Y * 2 + BADGE;
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = activeFonts.text;
  const maxTextW = Math.max(...draws.map(([, val]) => measureCtx.measureText(String(val)).width));
  const cardW = PAD_X * 2 + BADGE + GAP + maxTextW + (isCompactSoiree ? 8 : 20);
  const cardH = rowH * draws.length;

  const outerPad = 12;
  const topBottomPad = 0;
  const W = cardW + outerPad * 2;
  const H = cardH + outerPad * 2 + topBottomPad * 2;

  const RENDER_SCALE = 2;
  const canvas = createCanvas(W * RENDER_SCALE, H * RENDER_SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  // Draw the intended gradient background and add a subtle overlay
  drawBackground(ctx, W, H, palette);
  try {
    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.fillRect(0, 0, W, H);
  } catch (e) {
    // ignore
  }

  const cardY = outerPad + topBottomPad;
  ctx.fillStyle = palette.cardBg;
  roundRect(ctx, outerPad, cardY, cardW, cardH, 20);
  ctx.fill();
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 2;
  roundRect(ctx, outerPad, cardY, cardW, cardH, 20);
  ctx.stroke();

  draws.forEach(([cat, val], i) => {
    const y = cardY + i * rowH;
    const cy = y + rowH / 2;
    const badgeCx = outerPad + PAD_X + BADGE / 2;
    const textX = outerPad + PAD_X + BADGE + GAP;

    if (i < draws.length - 1) {
      ctx.beginPath();
      ctx.setLineDash([7, 6]);
      ctx.moveTo(outerPad, y + rowH);
      ctx.lineTo(outerPad + cardW, y + rowH);
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }

      drawBadge(ctx, badgeCx, cy, 30, cat, palette, activeFonts);

      ctx.font = activeFonts.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = palette.cellText;
      ctx.fillText(String(val), textX, cy + (isCompactSoiree ? 4 : 0));
  });

  const buf = canvas.toBuffer("image/png");
  return buf;
}

// Note: rainy canvas renderer removed — Playwright-based rainy template will be used instead.

async function generateBingoDrawnItemsImage(game, themeId = null) {
  registerFonts();
  const palette = getThemeColors(themeId);
  const activeFonts = getThemeFonts(themeId, "lista");

  const drawnItems = game.drawOrder || [];

  // Build a map of category -> items from the game's card columns
  // This uses the actual categories from the game data, not hardcoded BINGO
  const categoryOrder = game.card.map((col) => col.category);
  const categoryItems = {};
  categoryOrder.forEach((cat) => {
    categoryItems[cat] = [];
  });

  // Use all items from the card, not just drawn items
  game.card.forEach((col) => {
    const cat = col.category;
    col.items.forEach((item) => {
      if (categoryItems[cat]) {
        categoryItems[cat].push(item.value);
      }
    });
  });

  // Use all categories from the card (don't filter to only drawn items)
  const activeCategories = categoryOrder;

  const headerHeight = 78;
  const cellHeight = 70;
  const minColWidth = 160;
  const maxColWidth = 400;

  // Create a temporary canvas to measure text
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");

  // Calculate column widths dynamically
  const measuredColWidths = activeCategories.map((cat) => {
    const items = categoryItems[cat].map((val) => ({ value: val }));
    return calcColWidth(measureCtx, cat, items, minColWidth, maxColWidth, activeFonts);
  });
  const colWidths = themeId === "lovers_soiree"
    ? Array(activeCategories.length).fill(Math.min(Math.max(...measuredColWidths), 230))
    : measuredColWidths;
  const numCols = activeCategories.length;
  const contentWidth = colWidths.reduce((sum, w) => sum + w, 0);

  const maxRows = Math.max(...activeCategories.map((cat) => categoryItems[cat].length));
  const contentHeight = headerHeight + cellHeight * maxRows;
  const framePadding = themeId === "lovers_soiree" ? 16 : 0;
  const width = contentWidth + framePadding * 2;
  const height = contentHeight + framePadding * 2;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  if (themeId === "lovers_soiree") {
    const soireeBackground = await loadImage(soireeListaBackgroundPath);
    ctx.drawImage(soireeBackground, 0, 0, width, height);
  } else {
    drawBackground(ctx, width, height, palette);
  }

  const soireeAespaImage = themeId === "lovers_soiree"
    ? await loadImage(soireeAespaImagePath)
    : null;

  if (themeId === "lovers_soiree") {
    ctx.save();
    roundRect(ctx, framePadding, framePadding, contentWidth, contentHeight, 18);
    ctx.clip();
  }

  ctx.fillStyle = palette.cardBg;
  ctx.strokeStyle = palette.borderColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(framePadding + 2, framePadding + 2, contentWidth - 4, contentHeight - 4);
  ctx.fillRect(framePadding + 4, framePadding + 4, contentWidth - 8, contentHeight - 8);

  // Draw headers using actual categories
  activeCategories.forEach((cat, displayColIndex) => {
    const colWidth = colWidths[displayColIndex];
    const x = framePadding + colWidths.slice(0, displayColIndex).reduce((sum, w) => sum + w, 0);

    ctx.fillStyle = palette.headerBg;
    ctx.fillRect(x, framePadding, colWidth, headerHeight);

    ctx.strokeStyle = palette.headerBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, framePadding, colWidth, headerHeight);

    ctx.beginPath();
    ctx.moveTo(x, framePadding + headerHeight);
    ctx.lineTo(x + colWidth, framePadding + headerHeight);
    ctx.strokeStyle = palette.headerBorder;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = palette.headerText;
    ctx.font = activeFonts.header;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const displayHeader = truncateText(ctx, cat, colWidth - PAD * 2);
    ctx.fillText(displayHeader, x + colWidth / 2, framePadding + headerHeight / 2);
  });

  // Build grid: sort items within each category, keeping track of original item objects
  const itemsSorted = activeCategories.map((cat, colIndex) => {
    const itemsWithIndex = game.card[colIndex]?.items.map((item, originalIndex) => ({
      value: item.value,
      selected: item.selected,
      originalIndex,
    })) || [];
    return itemsWithIndex.sort((a, b) => compareSortableValues(a.value, b.value));
  });

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
    for (let colIndex = 0; colIndex < numCols; colIndex++) {
      const colWidth = colWidths[colIndex];
      const x = framePadding + colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
      const y = framePadding + headerHeight + rowIndex * cellHeight;
      const itemObj = rowIndex < itemsSorted[colIndex].length ? itemsSorted[colIndex][rowIndex] : null;
      const item = itemObj?.value || null;

      // Use the selected flag from the sorted item object (more reliable than value matching)
      const isItemSelected = itemObj?.selected || false;

      ctx.fillStyle = isItemSelected ? palette.selectedBg : palette.cardBg;
      ctx.fillRect(x, y, colWidth, cellHeight);

      ctx.strokeStyle = palette.cellBorder;
      ctx.lineWidth = 1;

      if (colIndex < numCols - 1) {
        ctx.beginPath();
        ctx.moveTo(x + colWidth, y);
        ctx.lineTo(x + colWidth, y + cellHeight);
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.moveTo(x, y + cellHeight);
      ctx.lineTo(x + colWidth, y + cellHeight);
      ctx.strokeStyle = palette.cellBorder;
      ctx.stroke();

      if (item) {
        if (soireeAespaImage && String(item).toLowerCase() === "aespa") {
          const imageX = x;
          const imageY = y + 6;
          const imageWidth = colWidth;
          const imageHeight = cellHeight;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, colWidth, cellHeight);
          ctx.clip();
          ctx.filter = isItemSelected ? "none" : "grayscale(100%) brightness(0.55)";
          drawImageCover(
            ctx,
            soireeAespaImage,
            imageWidth,
            imageHeight,
            imageX,
            imageY,
          );
          ctx.filter = "none";
          ctx.restore();
          continue;
        }

        ctx.fillStyle = isItemSelected ? palette.headerText : palette.cellText;
        ctx.font = activeFonts.cell;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const maxTextWidth = colWidth - PAD * 2;
        const textLines = themeId === "lovers_soiree"
          ? wrapTextLines(ctx, item, maxTextWidth)
          : [truncateText(ctx, item, maxTextWidth)];
        const lineHeight = 28;
        const firstLineY = y + cellHeight / 2 - ((textLines.length - 1) * lineHeight) / 2;
        textLines.forEach((line, lineIndex) => {
          ctx.fillText(line, x + colWidth / 2, firstLineY + lineIndex * lineHeight);
        });
      }
    }
  }

  if (themeId === "lovers_soiree") {
    ctx.restore();
    ctx.strokeStyle = palette.headerBorder;
    ctx.lineWidth = 2;
    roundRect(ctx, framePadding, framePadding, contentWidth, contentHeight, 18);
    ctx.stroke();
  }

  return canvas.toBuffer("image/png");
}

module.exports = {
  generateBingoImageCanvas,
  generateBolaImageForDrawsCanvas,
  generateBingoDrawnItemsImage,
};