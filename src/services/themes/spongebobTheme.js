/**
 * SpongeBob theme — colorful gradient bingo cards and bola draws
 */

const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const { compareSortableValues } = require("../../utils/helpers");

const colors = {
  background: ["#87CEEB", "#E0F6FF", "#FFF9C4"],
  cardBg: ["#FFFFFF", "#FFFFFF"], // White for unselected cells (listav2)
  headerBg: ["#FF6B9D", "#FF8FB1"],
  headerText: "#ffffff",
  cellText: "#4A90E2",
  cellTextEmpty: "#4A90E2",
  borderColor: "#FFD93D",
  headerBorder: "#FFD93D",
  cellBorder: "#FFD93D",
  selectedBg: "#FFD93D", // Light sand/gold for selected cells (listav2)
  freeBg: "#FFD93D",
  labelText: "#FF6B9D",
  separator: "#FFB7B2",
  cardShadow: "#FFB347",
};

const fonts = {
  badge: "Fredoka One",
  text: "Slackey",
  label: "Fredoka One",
  header: "700 30px Arial, sans-serif",
  cell: "600 30px Arial, sans-serif",
};

const PAD = 12; // horizontal padding inside each cell

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  try {
    GlobalFonts.registerFromPath(
      path.join(__dirname, "../../../assets/fonts/fredoka-one-latin-400-normal.woff2"),
      "Fredoka One",
    );
    GlobalFonts.registerFromPath(
      path.join(__dirname, "../../../assets/fonts/slackey-latin-400-normal.ttf"),
      "Slackey",
    );
    fontsRegistered = true;
  } catch (error) {
    console.error("Failed to register SpongeBob fonts:", error);
  }
}

function createLinearGradient(ctx, x, y, width, height, colorStops) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  colorStops.forEach((color, i) => {
    gradient.addColorStop(i / (colorStops.length - 1), color);
  });
  return gradient;
}

function drawBackground(ctx, width, height) {
  ctx.fillStyle = createLinearGradient(ctx, 0, 0, width, height, colors.background);
  ctx.fillRect(0, 0, width, height);
}

function drawCardBackground(ctx, x, y, width, height) {
  const cardGradient = ctx.createLinearGradient(x, y, x, y + height);
  colors.cardBg.forEach((color, i) => {
    cardGradient.addColorStop(i / (colors.cardBg.length - 1), color);
  });
  ctx.fillStyle = cardGradient;
  ctx.strokeStyle = colors.borderColor;
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 2, y + 2, width - 4, height - 4);
  ctx.fillRect(x + 4, y + 4, width - 8, height - 8);
}

function drawHeaderBackground(ctx, x, y, width, height) {
  const headerGradient = ctx.createLinearGradient(x, y, x, y + height);
  colors.headerBg.forEach((color, i) => {
    headerGradient.addColorStop(i / (colors.headerBg.length - 1), color);
  });
  ctx.fillStyle = headerGradient;
  ctx.fillRect(x, y, width, height);
}

function drawCellBackground(ctx, x, y, width, height, item) {
  if (item.selected) {
    ctx.fillStyle = colors.selectedBg;
  } else if (item.value === "FREE") {
    ctx.fillStyle = colors.freeBg;
  } else {
    ctx.fillStyle = colors.cardBg[0];
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

function drawBadge(ctx, cx, cy, radius, text) {
  const badgeGradient = ctx.createLinearGradient(
    cx - radius,
    cy - radius,
    cx + radius,
    cy + radius,
  );
  badgeGradient.addColorStop(0, "#FFD93D");
  badgeGradient.addColorStop(0.5, "#FFB347");
  badgeGradient.addColorStop(1, "#FF8C00");

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = badgeGradient;
  ctx.shadowColor = "rgba(255, 140, 0, 0.6)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 4;
  ctx.fill();
  ctx.shadowColor = "transparent";

  ctx.font = `26px ${fonts.badge}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FF1493";
  ctx.fillText(text, cx, cy);
}

function drawShadowText(ctx, text, x, y, fontSize) {
  ctx.font = `${fontSize}px ${fonts.text}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FFD93D";
  ctx.fillText(text, x + 2, y + 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = colors.cellText;
  ctx.fillText(text, x, y);
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
  drawCardBackground(ctx, 0, 0, totalWidth, height);

  game.card.forEach((column, colIndex) => {
    const colWidth = colWidths[colIndex];
    const x = colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
    const header = column.category;

    drawHeaderBackground(ctx, x, 0, colWidth, headerHeight);

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

function generateBolaImageForDrawsCanvas(draws, roundNumber, themeId = null) {
  registerFonts();

  const PAD_X = 16;
  const PAD_Y = 12;
  const GAP = 16;
  const BADGE = 60;
  const FONT = 28;
  const rowH = PAD_Y * 2 + BADGE;
  const maxTextW = Math.max(...draws.map(([, val]) => String(val).length * FONT * 0.62));
  const cardW = PAD_X * 2 + BADGE + GAP + maxTextW + 20;
  const cardH = rowH * draws.length;

  const outerPad = 12;
  const topBottomPad = 20;
  const W = cardW + outerPad * 2;
  const H = cardH + outerPad * 2 + topBottomPad * 2;

  const RENDER_SCALE = 2;
  const canvas = createCanvas(W * RENDER_SCALE, H * RENDER_SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  drawBackground(ctx, W, H);

  const cardY = outerPad + topBottomPad;

  ctx.fillStyle = "rgba(0,0,0,0.15)";
  roundRect(ctx, outerPad, cardY + 8, cardW, cardH, 20);
  ctx.fill();

  ctx.fillStyle = colors.cardShadow;
  roundRect(ctx, outerPad, cardY + 8, cardW, cardH, 20);
  ctx.fill();

  const cardGradient = ctx.createLinearGradient(0, cardY, 0, cardY + cardH);
  colors.cardBg.forEach((color, i) => {
    cardGradient.addColorStop(i / (colors.cardBg.length - 1), color);
  });
  ctx.fillStyle = cardGradient;
  roundRect(ctx, outerPad, cardY, cardW, cardH, 20);
  ctx.fill();
  ctx.strokeStyle = colors.borderColor;
  ctx.lineWidth = 4;
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
      ctx.strokeStyle = colors.separator;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    drawBadge(ctx, badgeCx, cy, 30, cat);
    drawShadowText(ctx, String(val), textX, cy, FONT);
  });

  return canvas.toBuffer("image/png");
}

function generateBingoDrawnItemsImage(game) {
  registerFonts();

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
  const colWidths = activeCategories.map((cat) => {
    const items = categoryItems[cat].map((val) => ({ value: val }));
    return calcColWidth(measureCtx, cat, items, minColWidth, maxColWidth);
  });
  const numCols = activeCategories.length;
  const width = colWidths.reduce((sum, w) => sum + w, 0);

  const maxRows = Math.max(...activeCategories.map((cat) => categoryItems[cat].length));
  const height = headerHeight + cellHeight * maxRows;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, width, height);
  drawCardBackground(ctx, 0, 0, width, height);

  // Draw headers using actual categories
  activeCategories.forEach((cat, displayColIndex) => {
    const colWidth = colWidths[displayColIndex];
    const x = colWidths.slice(0, displayColIndex).reduce((sum, w) => sum + w, 0);

    drawHeaderBackground(ctx, x, 0, colWidth, headerHeight);

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
    const displayHeader = truncateText(ctx, cat, colWidth - PAD * 2);
    ctx.fillText(displayHeader, x + colWidth / 2, headerHeight / 2);
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
      const x = colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
      const y = headerHeight + rowIndex * cellHeight;
      const itemObj = rowIndex < itemsSorted[colIndex].length ? itemsSorted[colIndex][rowIndex] : null;
      const item = itemObj?.value || null;

      // Use the selected flag from the sorted item object (more reliable than index matching)
      const isItemSelected = itemObj?.selected || false;

      ctx.fillStyle = isItemSelected ? colors.selectedBg : colors.cardBg[0];
      ctx.fillRect(x, y, colWidth, cellHeight);

      ctx.strokeStyle = colors.cellBorder;
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
      ctx.strokeStyle = colors.cellBorder;
      ctx.stroke();

      if (item) {
        ctx.fillStyle = isItemSelected ? colors.headerText : colors.cellText;
        ctx.font = fonts.cell;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const displayText = truncateText(ctx, item, colWidth - PAD * 2);
        ctx.fillText(displayText, x + colWidth / 2, y + cellHeight / 2);
      }
    }
  }

  return canvas.toBuffer("image/png");
}

module.exports = {
  registerFonts,
  generateBingoImageCanvas,
  generateBolaImageForDrawsCanvas,
  generateBingoDrawnItemsImage,
};