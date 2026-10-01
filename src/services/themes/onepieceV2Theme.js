/**
 * One Piece V2 theme — uses opbgv2.png as background, same fonts as onepieceTheme,
 * but with no text stroke/border and no image border/frame.
 */

const path = require("path");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const { compareSortableValues } = require("../../utils/helpers");

const fontPath = path.join(__dirname, "../../../assets/fonts/one_piece/OnePiece.ttf");
const japaneseFontPath = path.join(
  __dirname,
  "../../../node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2",
);
const fontFamily = "OnePiece";
const japaneseFontFamily = "NotoSansCJK";

const colors = {
  headerBg: "rgba(204, 0, 0, 1)",
  headerText: "#ffffff",
  // Use dark-brown tones for V2 text
  cellText: "#5C3719",
  cellTextEmpty: "#999999",
  borderColor: "rgba(255, 255, 255, 0.05)",
  headerBorder: "rgba(255, 255, 255, 0.05)",
  cellBorder: "rgba(255, 255, 255, 0.05)",
  selectedBg: "rgba(255, 255, 255, 1)",
  freeBg: "rgba(255, 255, 255, 1)",
  cardBg: "rgba(255, 255, 255, 0)",
  // Brown gradient for OnePiece V2
  textGradientTop: "#8B5A33",
  textGradientBottom: "#5C3719",
  letterIRed: "#cc0000",
  // Primary text color used in bola1 and other text elements
  textLightBlue: "#5C3719",
};

const fonts = {
  badge: `bold 26px Arial, sans-serif`,
  drawsText: `bold 24px ${fontFamily}`,
  label: `bold 14px ${fontFamily}`,
  header: `bold 22px ${fontFamily}`,
  cell: `bold 14px "Baloo 2", Arial, sans-serif`,
  empty: `bold 16px "Baloo 2", Arial, sans-serif`,
};

const PAD = 12;
let fontsRegistered = false;

(function() {
  try {
    if (fs.existsSync(fontPath)) {
      GlobalFonts.registerFromPath(fontPath, fontFamily);
      fontsRegistered = true;
    }
    if (fs.existsSync(japaneseFontPath)) {
      GlobalFonts.registerFromPath(japaneseFontPath, japaneseFontFamily);
    }
  } catch (error) {
    console.error("Error pre-loading OnePiece fonts:", error);
  }
})();

async function createBackgroundCanvas(targetWidth, targetHeight, useImage = true) {
  try {
    const bgCanvas = createCanvas(targetWidth, targetHeight);
    const bgCtx = bgCanvas.getContext("2d");

    if (useImage) {
      const bgImagePath = path.join(__dirname, "../../../assets/themes/one_piece/opbgv2.png");
      if (fs.existsSync(bgImagePath)) {
        const bgImage = await loadImage(bgImagePath);
        const imgRatio = bgImage.width / bgImage.height;
        const canvasRatio = targetWidth / targetHeight;
        let drawWidth, drawHeight, offsetX, offsetY;
        if (imgRatio > canvasRatio) {
          drawHeight = targetHeight;
          drawWidth = bgImage.width * (targetHeight / bgImage.height);
          offsetX = (targetWidth - drawWidth) / 2;
          offsetY = 0;
        } else {
          drawWidth = targetWidth;
          drawHeight = bgImage.height * (targetWidth / bgImage.width);
          offsetX = 0;
          offsetY = (targetHeight - drawHeight) / 2;
        }
        bgCtx.drawImage(bgImage, offsetX, offsetY, drawWidth, drawHeight);
      } else {
        bgCtx.fillStyle = "#ffffff";
        bgCtx.fillRect(0, 0, targetWidth, targetHeight);
      }
    } else {
      bgCtx.fillStyle = "#ffffff";
      bgCtx.fillRect(0, 0, targetWidth, targetHeight);
    }
    return bgCanvas;
  } catch (error) {
    console.error("Error creating background canvas:", error);
    const canvas = createCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    return canvas;
  }
}

async function drawBackground(ctx, width, height, useImage = true) {
  const bgCanvas = await createBackgroundCanvas(width, height, useImage);
  if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0);
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

function measureText(ctx, text) {
  return ctx.measureText(text).width;
}

function truncateText(ctx, text, maxWidth) {
  let truncated = String(text || "");
  while (measureText(ctx, truncated + "…") > maxWidth && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "…";
}

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

function drawGradientText(ctx, text, x, y) {
  const metrics = ctx.measureText(text);
  const textHeight = (metrics.actualBoundingBoxAscent || 14) + (metrics.actualBoundingBoxDescent || 6);
  const gradient = ctx.createLinearGradient(x, y - textHeight / 2, x, y + textHeight / 2);
  gradient.addColorStop(0, colors.textGradientTop);
  gradient.addColorStop(1, colors.textGradientBottom);
  ctx.fillStyle = gradient;
  ctx.fillText(text, x, y);
}

async function generateBingoImageCanvas(game, themeId = null) {
  const numRows = game.card[0]?.items?.length || 15;
  const headerHeight = 50;
  const cellHeight = 50;
  const minColWidth = 120;
  const maxColWidth = 300;

  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");

  const colWidths = game.card.map((column) => {
    return calcColWidth(measureCtx, column.category, column.items, minColWidth, maxColWidth);
  });
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const height = headerHeight + cellHeight * numRows;

  const canvas = createCanvas(totalWidth, height);
  const ctx = canvas.getContext("2d");

  await drawBackground(ctx, totalWidth, height, true);

  game.card.forEach((column, colIndex) => {
    const colWidth = colWidths[colIndex];
    const x = colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
    const header = column.category;

    ctx.fillStyle = colors.headerBg;
    ctx.fillRect(x, 0, colWidth, headerHeight);

    ctx.font = fonts.header;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colors.headerText;
    ctx.fillText(header, x + colWidth / 2, headerHeight / 2);

    const sortedItems = [...column.items].sort((a, b) => {
      return compareSortableValues(a.value, b.value);
    });

    sortedItems.forEach((item, rowIndex) => {
      const y = headerHeight + rowIndex * cellHeight;
      drawCellBackground(ctx, x, y, colWidth, cellHeight, item);

      ctx.strokeStyle = colors.cellBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, colWidth, cellHeight);

      ctx.font = fonts.cell;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (item.value === "FREE" || !item.value) {
        ctx.fillStyle = colors.cellTextEmpty;
        ctx.fillText("FREE", x + colWidth / 2, y + cellHeight / 2);
      } else {
        const textToDraw = (item.value || "").toUpperCase();
        const displayText = truncateText(ctx, textToDraw, colWidth - PAD * 2);
        drawGradientText(ctx, displayText, x + colWidth / 2, y + cellHeight / 2);
      }
    });
  });

  return canvas.toBuffer("image/png");
}

async function generateBolaImageForDrawsCanvas(draws, roundNumber, themeId = null) {
  const PAD_X = 16;
  const PAD_Y = 10;
  const GAP = 12;
  const FONT = 20;
  const HEADER_H = 30;
  const outerPad = 12;
  const scale = 2;

  const measureCanvas = createCanvas(1, 1);
  const mctx = measureCanvas.getContext("2d");

  const lineWidths = draws.map(([cat, val]) => {
    const isEmoji = /\p{Emoji}/u.test(cat);
    let x = 0;
    mctx.font = isEmoji
      ? `bold ${Math.floor(FONT * scale)}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", Arial, sans-serif`
      : `bold ${Math.floor(FONT * scale)}px ${fontFamily}`;
    x += mctx.measureText(cat).width;
    mctx.font = `bold ${Math.floor(FONT * scale)}px Arial, sans-serif`;
    x += mctx.measureText(isEmoji ? "  -  " : "   -   ").width;
    mctx.font = `bold ${Math.floor(FONT * scale)}px ${fontFamily}`;
    x += mctx.measureText(val.toUpperCase()).width;
    return x;
  });
  const maxLineW = Math.max(...lineWidths);

  const rowH = PAD_Y * 2 + FONT;
  const contentW = PAD_X * 2 + maxLineW;
  const contentH = HEADER_H + rowH * draws.length;

  const W = contentW + outerPad * 2;
  const H = contentH + outerPad * 2;

  const canvas = createCanvas(W * scale, H * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // Draw background only (no outer image border/frame)
  await drawBackground(ctx, W, H, true);

  const scaledPadX = PAD_X;
  const scaledRowH = rowH;
  const scaledOuter = outerPad;
  const headerY = scaledOuter + 8;

  // Draw SAIL badge text
  ctx.font = `bold 13px "${japaneseFontFamily}", ${fontFamily}, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = colors.letterIRed;
  const sailText = `セール - ${roundNumber}`;
  ctx.fillText(sailText, W / 2, headerY);

  const cardTop = scaledOuter + HEADER_H;

  draws.forEach(([cat, val], i) => {
    const y = cardTop + i * scaledRowH;
    const cy = y + scaledRowH / 2;

    let currentX = scaledOuter + scaledPadX;
    if (draws.length === 1) {
      let lineW = 0;
      const isEmoji = /\p{Emoji}/u.test(cat);
      ctx.font = isEmoji ? `bold ${FONT}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", Arial, sans-serif` : `bold ${FONT}px ${fontFamily}`;
      lineW += ctx.measureText(cat).width;
      ctx.font = `bold ${FONT}px Arial, sans-serif`;
      lineW += ctx.measureText(isEmoji ? "  -  " : "   -   ").width;
      ctx.font = `bold ${FONT}px ${fontFamily}`;
      lineW += ctx.measureText(val.toUpperCase()).width;
      const available = W - scaledOuter * 2;
      currentX = scaledOuter + (available - lineW) / 2;
    }

    const isEmoji = /\p{Emoji}/u.test(cat);
    ctx.font = isEmoji ? `bold ${FONT}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", Arial, sans-serif` : `bold ${FONT}px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // Draw category and value without stroke (plain gradient or fill)
    ctx.fillStyle = colors.textLightBlue;
    ctx.fillText(cat, currentX, cy);
    currentX += ctx.measureText(cat).width;

    ctx.font = `bold ${Math.floor(FONT * scale)}px Arial, sans-serif`;
    ctx.fillStyle = colors.textLightBlue;
    const dashSpacing = isEmoji ? "  -  " : "   -   ";
    ctx.fillText(dashSpacing, currentX, cy);
    currentX += ctx.measureText(dashSpacing).width;

    ctx.font = `bold ${Math.floor(FONT * scale)}px ${fontFamily}`;
    ctx.fillStyle = colors.textLightBlue;
    ctx.fillText(val.toUpperCase(), currentX, cy);
  });

  return canvas.toBuffer("image/png");
}

async function generateBingoDrawnItemsImage(game) {
  const drawnItems = game.drawOrder || [];
  const categoryOrder = game.card.map((col) => col.category);
  const categoryItems = {};
  categoryOrder.forEach((cat) => {
    categoryItems[cat] = [];
  });
  drawnItems.forEach(([cat, val]) => {
    if (categoryItems[cat]) {
      categoryItems[cat].push(val);
    }
  });
  const activeCategories = categoryOrder.filter((cat) => categoryItems[cat].length > 0);
  if (activeCategories.length === 0) {
    const canvas = createCanvas(400, 200);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = "#000000";
    ctx.font = fonts.empty;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No items drawn yet", 200, 100);
    return canvas.toBuffer("image/png");
  }

  const headerHeight = 50;
  const cellHeight = 50;
  const minColWidth = 120;
  const maxColWidth = 300;

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

  await drawBackground(ctx, width, height, true);

  activeCategories.forEach((cat, displayColIndex) => {
    const colWidth = colWidths[displayColIndex];
    const x = colWidths.slice(0, displayColIndex).reduce((sum, w) => sum + w, 0);

    ctx.fillStyle = colors.headerBg;
    ctx.fillRect(x, 0, colWidth, headerHeight);

    ctx.font = fonts.header;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colors.headerText;
    ctx.fillText(cat.toUpperCase(), x + colWidth / 2, headerHeight / 2);
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
      const isItemSelected = itemObj?.selected || false;

      ctx.fillStyle = isItemSelected ? colors.selectedBg : colors.cardBg;
      ctx.fillRect(x, y, colWidth, cellHeight);

      ctx.strokeStyle = colors.cellBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, colWidth, cellHeight);

      if (item) {
        ctx.font = fonts.cell;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const displayText = truncateText(ctx, item, colWidth - PAD * 2);
        ctx.fillStyle = colors.cellText;
        ctx.fillText(displayText.toUpperCase(), x + colWidth / 2, y + cellHeight / 2);
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
