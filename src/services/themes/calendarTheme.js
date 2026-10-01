/**
 * Calendar theme — draw card layout from sample.html
 * Red/blue-violet on white, sharp corners, Bebas-style header
 */

const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const { compareSortableValues } = require("../../utils/helpers");

const bebasPath = path.join(
  __dirname,
  "../../../node_modules/@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2",
);

const colors = {
  background: "#ffffff",
  cardBg: "#ffffff",
  accent: "#1c19d2",
  headerBg: "#dc2626",
  headerText: "#ffffff",
  letterBg: "#ea3323",
  letterText: "#ffffff",
  holidayText: "#ea3323",
  tableHeaderBg: "#dc2626",
  tableHeaderText: "#ffffff",
  selectedBg: "#ede9fe",
  freeBg: "#fee2e2",
  cellTextEmpty: "#a5b4fc",
};

const fonts = {
  header: "400 24px Bebas Neue",
  letter: "900 32px Arial",
  number: "900 34px Arial",
  timestamp: "800 11px Arial",
  tableHeader: "700 30px Arial",
  cell: "700 30px Arial",
  empty: "700 20px Arial",
};

const PAD = 12;
const LETTER_W = 70;
const NUMBER_MIN_W = 110;
const ROW_H = 70;
const HEADER_GAP = 10;
const FOOTER_H = 22;
const BORDER = 2;

let fontsRegistered = false;

function drawHLine(ctx, x, y, width) {
  ctx.fillStyle = colors.accent;
  ctx.fillRect(x, y, width, BORDER);
}

function drawVLine(ctx, x, y, height) {
  ctx.fillStyle = colors.accent;
  ctx.fillRect(x, y, BORDER, height);
}

function drawBorderBox(ctx, x, y, width, height) {
  ctx.fillStyle = colors.accent;
  ctx.fillRect(x, y, width, BORDER);
  ctx.fillRect(x, y + height - BORDER, width, BORDER);
  ctx.fillRect(x, y, BORDER, height);
  ctx.fillRect(x + width - BORDER, y, BORDER, height);
}

function registerFonts() {
  if (fontsRegistered) return;
  try {
    GlobalFonts.registerFromPath(bebasPath, "Bebas Neue");
    fontsRegistered = true;
  } catch (error) {
    console.error("Failed to register Bebas Neue for Calendar theme:", error);
  }
}

function isHolidayNumber(value) {
  const n = parseInt(String(value), 10);
  return n === 1 || n === 25;
}

function formatPhTimestamp() {
  return (
    new Date().toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }) + " PHT"
  );
}

function measureText(ctx, text) {
  return ctx.measureText(text).width;
}

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

function calcColWidth(ctx, header, items, minColWidth, maxColWidth) {
  ctx.font = fonts.tableHeader;
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

function drawBackground(ctx, width, height) {
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);
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

function generateBolaImageForDrawsCanvas(draws, roundNumber, themeId = null) {
  registerFonts();

  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = fonts.number;

  const numberWidths = draws.map(([, val]) =>
    Math.max(NUMBER_MIN_W, Math.ceil(measureText(measureCtx, String(val)) + PAD * 2)),
  );
  const maxNumberW = Math.max(...numberWidths);
  const innerW = LETTER_W + BORDER + maxNumberW;
  const innerH = ROW_H * draws.length + FOOTER_H;
  const cardW = innerW + BORDER * 2;
  const cardH = innerH + BORDER * 2;

  const outerPad = 12;
  const W = cardW + outerPad * 2;
  const H = cardH + outerPad * 2;

  const RENDER_SCALE = 2;
  const canvas = createCanvas(W * RENDER_SCALE, H * RENDER_SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  drawBackground(ctx, W, H);

  const cardX = outerPad;
  const cardY = outerPad;
  const innerX = cardX + BORDER;
  const innerY = cardY + BORDER;

  ctx.fillStyle = colors.cardBg;
  ctx.fillRect(innerX, innerY, innerW, innerH);

  draws.forEach(([cat, val], i) => {
    const rowY = innerY + i * ROW_H;
    const numberW = numberWidths[i];

    ctx.fillStyle = colors.letterBg;
    ctx.fillRect(innerX, rowY, LETTER_W, ROW_H);

    drawVLine(ctx, innerX + LETTER_W, rowY, ROW_H);

    ctx.fillStyle = colors.cardBg;
    ctx.fillRect(innerX + LETTER_W + BORDER, rowY, numberW, ROW_H);

    ctx.fillStyle = colors.letterText;
    ctx.font = fonts.letter;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cat, innerX + LETTER_W / 2, rowY + ROW_H / 2);

    ctx.fillStyle = isHolidayNumber(val) ? colors.holidayText : colors.accent;
    ctx.font = fonts.number;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const displayVal = truncateText(ctx, String(val), numberW - PAD * 2);
    ctx.fillText(displayVal, innerX + LETTER_W + BORDER + numberW / 2, rowY + ROW_H / 2);
  });

  for (let i = 1; i < draws.length; i++) {
    drawHLine(ctx, innerX, innerY + i * ROW_H, innerW);
  }

  const footerY = innerY + ROW_H * draws.length;
  drawHLine(ctx, innerX, footerY, innerW);

  ctx.fillStyle = colors.accent;
  ctx.font = fonts.timestamp;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(formatPhTimestamp(), innerX + innerW / 2, footerY + FOOTER_H / 2);

  drawBorderBox(ctx, cardX, cardY, cardW, cardH);

  return canvas.toBuffer("image/png");
}

function generateBingoImageCanvas(game, themeId = null) {
  registerFonts();

  const numRows = game.card[0]?.items?.length || 15;
  const headerHeight = 78;
  const cellHeight = 70;
  const minColWidth = 160;
  const maxColWidth = 400;

  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");

  const colWidths = game.card.map((column) =>
    calcColWidth(measureCtx, column.category, column.items, minColWidth, maxColWidth),
  );
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const height = headerHeight + cellHeight * numRows;

  const canvas = createCanvas(totalWidth, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, totalWidth, height);
  drawBorderBox(ctx, 0, 0, totalWidth, height);
  drawHLine(ctx, 0, headerHeight, totalWidth);

  game.card.forEach((column, colIndex) => {
    const colWidth = colWidths[colIndex];
    const x = colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
    const header = column.category;

    ctx.fillStyle = colors.tableHeaderBg;
    ctx.fillRect(x, 0, colWidth, headerHeight);

    ctx.fillStyle = colors.tableHeaderText;
    ctx.font = fonts.tableHeader;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(truncateText(ctx, header, colWidth - PAD * 2), x + colWidth / 2, headerHeight / 2);

    const sortedItems = [...column.items].sort((a, b) => {
      return compareSortableValues(a.value, b.value);
    });

    sortedItems.forEach((item, rowIndex) => {
      const y = headerHeight + rowIndex * cellHeight;

      drawCellBackground(ctx, x, y, colWidth, cellHeight, item);

      if (colIndex < game.card.length - 1) {
        drawVLine(ctx, x + colWidth - BORDER, y, cellHeight);
      }

      if (rowIndex > 0) {
        drawHLine(ctx, x, y, colWidth);
      }

      const textColor =
        item.value === "FREE" || !item.value
          ? colors.cellTextEmpty
          : isHolidayNumber(item.value)
            ? colors.holidayText
            : colors.accent;

      ctx.fillStyle = textColor;
      ctx.font = fonts.cell;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        truncateText(ctx, item.value || "", colWidth - PAD * 2) || "",
        x + colWidth / 2,
        y + cellHeight / 2,
      );
    });
  });

  return canvas.toBuffer("image/png");
}

function generateBingoDrawnItemsImage(game) {
  registerFonts();

  const drawnItems = game.drawOrder || [];
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

  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");

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
  drawBorderBox(ctx, 0, 0, width, height);
  drawHLine(ctx, 0, headerHeight, width);

  activeCategories.forEach((cat, displayColIndex) => {
    const colWidth = colWidths[displayColIndex];
    const x = colWidths.slice(0, displayColIndex).reduce((sum, w) => sum + w, 0);

    ctx.fillStyle = colors.tableHeaderBg;
    ctx.fillRect(x, 0, colWidth, headerHeight);

    ctx.fillStyle = colors.tableHeaderText;
    ctx.font = fonts.tableHeader;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(truncateText(ctx, cat, colWidth - PAD * 2), x + colWidth / 2, headerHeight / 2);
  });

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

      ctx.fillStyle = isItemSelected ? colors.selectedBg : colors.cardBg;
      ctx.fillRect(x, y, colWidth, cellHeight);

      if (colIndex < numCols - 1) {
        drawVLine(ctx, x + colWidth - BORDER, y, cellHeight);
      }

      if (rowIndex > 0) {
        drawHLine(ctx, x, y, colWidth);
      }

      if (item) {
        ctx.fillStyle = isItemSelected ? colors.headerText : (isHolidayNumber(item) ? colors.holidayText : colors.accent);
        ctx.font = fonts.cell;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(truncateText(ctx, item, colWidth - PAD * 2), x + colWidth / 2, y + cellHeight / 2);
      }
    }
  }

  return canvas.toBuffer("image/png");
}

module.exports = {
  generateBingoImageCanvas,
  generateBolaImageForDrawsCanvas,
  generateBingoDrawnItemsImage,
};
