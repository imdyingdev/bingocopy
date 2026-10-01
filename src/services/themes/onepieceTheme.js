/**
 * One Piece theme — simple bingo cards with One Piece font and background image
 */

const path = require("path");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");

const fontPath = path.join(__dirname, "../../../assets/fonts/one_piece/OnePiece.ttf");
// Japanese font supplied by the @fontsource/noto-sans-jp npm package (managed, full glyph coverage)
const japaneseFontPath = path.join(
  __dirname,
  "../../../node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2",
);
const fontFamily = "OnePiece";
const japaneseFontFamily = "NotoSansCJK";

const colors = {
  headerBg: "rgba(204, 0, 0, 1)", // Same red as sail 12 (letterIRed)
  headerText: "#ffffff",
  cellText: "#052558", // Dark blue for bingo text
  cellTextEmpty: "#999999",
  borderColor: "rgba(255, 255, 255, 0.1)", // White 10% opacity for bingo lines
  headerBorder: "rgba(255, 255, 255, 0.1)", // White 10% opacity for bingo lines
  cellBorder: "rgba(255, 255, 255, 0.1)", // White 10% opacity for bingo lines
  selectedBg: "rgba(255, 255, 255, 1)", // White 100% opacity for selected
  freeBg: "rgba(255, 255, 255, 1)", // White 100% opacity for free
  cardBg: "rgba(255, 255, 255, 0)", // Transparent - shows background
  textGradientTop: "#0a65aa", // Darker light blue
  textGradientBottom: "#052558", // Darker dark blue
  letterIRed: "#cc0000", // Darker red for letter I and sail badge
  textStroke: "#000000", // Black stroke for bingo
  textStrokeGold: "#d6ad08", // Gold stroke for draws/luffy
  textLightBlue: "#052558", // Dark blue for bingo text
};

const fonts = {
  badge: `bold 26px Arial, sans-serif`,
  drawsText: `bold 24px ${fontFamily}`, // Use OnePiece for draws text
  label: `bold 14px ${fontFamily}`,
  header: `bold 22px ${fontFamily}`, // Use OnePiece for bingo header
  cell: `bold 14px "Baloo 2", Arial, sans-serif`, // Use Baloo for bingo cells (reduced from 24px)
  empty: `bold 16px "Baloo 2", Arial, sans-serif`, // Use Baloo for bingo empty (reduced from 20px)
};

const PAD = 12;

let fontsRegistered = false;

// Register fonts immediately on module load
(function() {
  try {
    console.log("Pre-loading OnePiece font...");
    if (fs.existsSync(fontPath)) {
      GlobalFonts.registerFromPath(fontPath, fontFamily);
      fontsRegistered = true;
      console.log("✓ OnePiece font pre-loaded");
    }
    // Also register Japanese font for sail text
    if (fs.existsSync(japaneseFontPath)) {
      GlobalFonts.registerFromPath(japaneseFontPath, japaneseFontFamily);
      console.log("✓ Japanese font pre-loaded");
    }
  } catch (error) {
    console.error("Error pre-loading font:", error);
  }
})();

async function createBackgroundCanvas(targetWidth, targetHeight, useImage = true) {
  try {
    const bgCanvas = createCanvas(targetWidth, targetHeight);
    const bgCtx = bgCanvas.getContext("2d");

    if (useImage) {
      // Load and draw the One Piece background image
      const bgImagePath = path.join(__dirname, "../../../assets/themes/one_piece/opbg.png");
      
      if (fs.existsSync(bgImagePath)) {
        const bgImage = await loadImage(bgImagePath);
        
        // Calculate object-fit: cover behavior
        const imgRatio = bgImage.width / bgImage.height;
        const canvasRatio = targetWidth / targetHeight;
        
        let drawWidth, drawHeight, offsetX, offsetY;
        
        if (imgRatio > canvasRatio) {
          // Image is wider than canvas - fit to height
          drawHeight = targetHeight;
          drawWidth = bgImage.width * (targetHeight / bgImage.height);
          offsetX = (targetWidth - drawWidth) / 2;
          offsetY = 0;
        } else {
          // Image is taller than canvas - fit to width
          drawWidth = targetWidth;
          drawHeight = bgImage.height * (targetWidth / bgImage.width);
          offsetX = 0;
          offsetY = (targetHeight - drawHeight) / 2;
        }
        
        bgCtx.drawImage(bgImage, offsetX, offsetY, drawWidth, drawHeight);
        console.log("✓ Background canvas created with opbg.png (object-fit: cover)");
      } else {
        // Fallback to white if image doesn't exist
        bgCtx.fillStyle = "#ffffff";
        bgCtx.fillRect(0, 0, targetWidth, targetHeight);
        console.log("✓ Background canvas created with white (fallback)");
      }
    } else {
      // Use white background
      bgCtx.fillStyle = "#ffffff";
      bgCtx.fillRect(0, 0, targetWidth, targetHeight);
      console.log("✓ Background canvas created with white");
    }
    
    return bgCanvas;
  } catch (error) {
    console.error("Error creating background canvas:", error);
    return createGradientCanvas(targetWidth, targetHeight);
  }
}

function createGradientCanvas(width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0a2f51");
  gradient.addColorStop(1, "#1a7f8f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  return canvas;
}

async function drawBackground(ctx, width, height, useImage = true) {
  try {
    // Create and draw a pre-rendered background canvas
    const bgCanvas = await createBackgroundCanvas(width, height, useImage);
    
    if (bgCanvas) {
      ctx.drawImage(bgCanvas, 0, 0);
      console.log("✓ Background drawn");
    } else {
      // Fallback: solid color
      ctx.fillStyle = "#1a472a";
      ctx.fillRect(0, 0, width, height);
    }
  } catch (error) {
    console.error("Error drawing background:", error);
    ctx.fillStyle = "#1a472a";
    ctx.fillRect(0, 0, width, height);
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

/**
 * Measure text width using canvas context
 */
function measureText(ctx, text) {
  return ctx.measureText(text).width;
}

/**
 * Draw text with gradient fill (top to bottom)
 */
function drawGradientText(ctx, text, x, y, maxWidth) {
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  
  // Create gradient from top to bottom of text
  const gradient = ctx.createLinearGradient(x, y - textHeight / 2, x, y + textHeight / 2);
  gradient.addColorStop(0, colors.textGradientTop);
  gradient.addColorStop(1, colors.textGradientBottom);
  
  ctx.fillStyle = gradient;
  ctx.fillText(text, x, y);
}

/**
 * Draw text with stroke and gradient fill
 */
function drawTextWithStroke(ctx, text, x, y, maxWidth, scale = 1, strokeColor = null) {
  // Draw stroke first for the entire text
  ctx.strokeStyle = strokeColor || colors.textStroke;
  ctx.lineWidth = 2 * scale;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  
  // Use gradient for entire text
  const metrics = ctx.measureText(text);
  const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const gradient = ctx.createLinearGradient(x, y - textHeight / 2, x, y + textHeight / 2);
  gradient.addColorStop(0, colors.textGradientTop);
  gradient.addColorStop(1, colors.textGradientBottom);
  ctx.fillStyle = gradient;
  ctx.fillText(text, x, y);
}

/**
 * Draw text with stroke and solid light blue fill (for bingo)
 */
function drawTextWithStrokeSolid(ctx, text, x, y, maxWidth, scale = 1, strokeColor = null) {
  // Skip stroke for bingo sample
  // Draw stroke first for the entire text
  // ctx.strokeStyle = strokeColor || colors.textStroke;
  // ctx.lineWidth = 2 * scale;
  // ctx.lineJoin = "round";
  // ctx.strokeText(text, x, y);
  
  // Use solid light blue for entire text
  ctx.fillStyle = colors.textLightBlue;
  ctx.fillText(text, x, y);
}

/**
 * Build a rounded-rectangle path (shared by background clip and border stroke)
 */
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

/**
 * Wrap text to multiple lines if it exceeds maxWidth
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (measureText(ctx, testLine) <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Single word is too long, force wrap
        for (let i = 0; i < word.length; i++) {
          const testChar = currentLine + word[i];
          if (measureText(ctx, testChar) <= maxWidth) {
            currentLine = testChar;
          } else {
            if (currentLine) {
              lines.push(currentLine);
              currentLine = word[i];
            } else {
              // Character is too wide, just add it
              lines.push(word[i]);
            }
          }
        }
      }
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Truncate text if it exceeds maxWidth
 */
function truncateText(ctx, text, maxWidth) {
  const textW = measureText(ctx, text);
  if (textW <= maxWidth) {
    return text;
  }
  // Truncate and add ellipsis
  let truncated = text;
  while (measureText(ctx, truncated + "...") > maxWidth && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "...";
}

/**
 * Calculate the ideal column width
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

  // Draw background image (use opbg.png for bingo)
  await drawBackground(ctx, totalWidth, height, true);

  game.card.forEach((column, colIndex) => {
    const colWidth = colWidths[colIndex];
    const x = colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
    const header = column.category;

    // Draw header background
    ctx.fillStyle = colors.headerBg;
    ctx.fillRect(x, 0, colWidth, headerHeight);

    // Draw header borders
    ctx.strokeStyle = colors.headerBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 0, colWidth, headerHeight);

    // Draw header text
    const isEmoji = /\p{Emoji}/u.test(header);
    ctx.font = isEmoji ? `bold 22px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", Arial, sans-serif` : fonts.header;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = colors.headerText; // White color for header
    ctx.fillText(header, x + colWidth / 2, headerHeight / 2);

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
      ctx.strokeRect(x, y, colWidth, cellHeight);

      ctx.font = fonts.cell;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      
      if (item.value === "FREE" || !item.value) {
        ctx.fillStyle = colors.cellTextEmpty;
        ctx.fillText("FREE", x + colWidth / 2, y + cellHeight / 2);
      } else {
        const textToDraw = (item.value || "").toUpperCase();
        const lines = wrapText(ctx, textToDraw, colWidth - PAD * 2);
        
        if (lines.length === 1) {
          drawTextWithStrokeSolid(ctx, lines[0], x + colWidth / 2, y + cellHeight / 2);
        } else {
          // Draw multiple lines centered vertically
          const lineHeight = 16;
          const totalHeight = lines.length * lineHeight;
          const startY = y + (cellHeight - totalHeight) / 2 + lineHeight / 2;
          
          lines.forEach((line, lineIndex) => {
            const lineY = startY + lineIndex * lineHeight;
            drawTextWithStrokeSolid(ctx, line, x + colWidth / 2, lineY);
          });
        }
      }
    });
  });

  return canvas.toBuffer("image/png");
}

async function generateBolaImageForDrawsCanvas(draws, roundNumber, themeId = null) {
  // Layout constants (in CSS px, scaled up for resolution below)
  const PAD_X = 16; // inner left/right padding
  const PAD_Y = 10; // vertical padding inside each row
  const GAP = 12; // gap between category and value
  const FONT = 20; // base font size for category/value text
  const HEADER_H = 30; // space reserved for the SAIL - N header
  const outerPad = 12; // equal frame padding around the whole image

  // Scale factor for higher resolution
  const scale = 2;

  // Measure each draw's full line width at the actual scaled drawing fonts so the
  // canvas width matches the content exactly (no asymmetric slack on either side)
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

  const rowH = PAD_Y * 2 + FONT; // text height + equal vertical padding
  const contentW = PAD_X * 2 + maxLineW; // equal left/right padding
  const contentH = HEADER_H + rowH * draws.length;

  const W = contentW + outerPad * 2;
  const H = contentH + outerPad * 2;

  const canvas = createCanvas(W * scale, H * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // Load and draw background image (full canvas)
  await drawBackground(ctx, W, H);

  const scaledPadX = PAD_X;
  const scaledRowH = rowH;
  const scaledOuter = outerPad;
  const headerY = scaledOuter + 8; // small top margin for the header

  // Two-layer border drawn FIRST so the content (header + rows) sits on top of it:
  //  Layer 1 - a SOLID filled red rectangle covering the whole image (outer edge is a
  //            sharp square, no radius).
  //  Layer 2 - punch the inside back out as a rounded rectangle so the inner edge has a
  //            6px radius while the outer edge stays a perfect square. Because layer 1 is
  //            a fill (not a stroke), there are no missing corner pixels.
  const borderWidth = 4;
  const radius = 6;

  // Layer 1: solid red fill over the entire canvas
  ctx.fillStyle = colors.letterIRed;
  ctx.fillRect(0, 0, W, H);

  // Layer 2: re-draw the background clipped to the inner rounded rectangle,
  // which carves out the rounded interior and leaves a red square outer frame.
  ctx.save();
  roundRect(ctx, borderWidth, borderWidth, W - borderWidth * 2, H - borderWidth * 2, radius);
  ctx.clip();
  await drawBackground(ctx, W, H);
  ctx.restore();

  // Draw SAIL badge in top center (red, no border) - Japanese text
  ctx.font = `bold ${13}px "${japaneseFontFamily}", ${fontFamily}, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = colors.letterIRed;
  const sailText = `セール - ${roundNumber}`;
  ctx.fillText(sailText, W / 2, headerY);

  const cardTop = scaledOuter + HEADER_H;

  draws.forEach(([cat, val], i) => {
    const y = cardTop + i * scaledRowH;
    const cy = y + scaledRowH / 2;

    // When there's only a single draw, center the whole "cat - value" line
    // horizontally; for 2+ draws keep them left-aligned.
    let currentX = scaledOuter + scaledPadX;
    if (draws.length === 1) {
      let lineW = 0;
      const isEmoji = /\p{Emoji}/u.test(cat);
      ctx.font = isEmoji ? `bold ${Math.floor(FONT * scale)}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", Arial, sans-serif` : `bold ${Math.floor(FONT * scale)}px ${fontFamily}`;
      lineW += ctx.measureText(cat).width;
      ctx.font = `bold ${Math.floor(FONT * scale)}px Arial, sans-serif`;
      lineW += ctx.measureText(isEmoji ? "  -  " : "   -   ").width;
      ctx.font = `bold ${Math.floor(FONT * scale)}px ${fontFamily}`;
      lineW += ctx.measureText(val.toUpperCase()).width;
      const available = W - scaledOuter * 2;
      currentX = scaledOuter + (available - lineW) / 2;
    }

    // Draw category with appropriate font
    const isEmoji = /\p{Emoji}/u.test(cat);
    ctx.font = isEmoji ? `bold ${Math.floor(FONT * scale)}px "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", Arial, sans-serif` : `bold ${Math.floor(FONT * scale)}px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    // Emoji fonts don't render text strokes well, so skip stroke for emoji
    if (isEmoji) {
      ctx.fillText(cat, currentX, cy);
    } else {
      drawTextWithStroke(ctx, cat, currentX, cy, 0, scale, colors.textStrokeGold);
    }
    currentX += ctx.measureText(cat).width;

    // Draw dash with Arial (supports regular dash)
    // Use less spacing when category is emoji to prevent overlapping
    ctx.font = `bold ${Math.floor(FONT * scale)}px Arial, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const dashSpacing = isEmoji ? "  -  " : "   -   ";
    drawTextWithStroke(ctx, dashSpacing, currentX, cy, 0, scale, colors.textStrokeGold);
    currentX += ctx.measureText(dashSpacing).width;

    // Draw value with OnePiece font
    ctx.font = `bold ${Math.floor(FONT * scale)}px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    drawTextWithStroke(ctx, val.toUpperCase(), currentX, cy, 0, scale, colors.textStrokeGold);
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
    ctx.fillStyle = "#1a472a";
    ctx.fillRect(0, 0, 400, 200);
    ctx.fillStyle = "#ffffff";
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

  // Draw headers
  activeCategories.forEach((cat, displayColIndex) => {
    const colWidth = colWidths[displayColIndex];
    const x = colWidths.slice(0, displayColIndex).reduce((sum, w) => sum + w, 0);

    ctx.fillStyle = colors.headerBg;
    ctx.fillRect(x, 0, colWidth, headerHeight);

    ctx.strokeStyle = colors.headerBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 0, colWidth, headerHeight);

    ctx.font = fonts.header;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawTextWithStrokeSolid(ctx, cat.toUpperCase(), x + colWidth / 2, headerHeight / 2);
  });

  // Build and draw grid, keeping track of selected state
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
        drawTextWithStrokeSolid(ctx, displayText.toUpperCase(), x + colWidth / 2, y + cellHeight / 2);
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
