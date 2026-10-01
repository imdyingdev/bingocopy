/**
 * Toy Story theme — red polygon containers, sky gradient background, STORY labels, agent-red font
 */

const path = require("path");
const fs = require("fs");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { compareSortableValues } = require("../../utils/helpers");

const colors = {
  background: ["#1E5FBF", "#3E86D6", "#7FBBEB", "#BFE1F7"], // Sky gradient blue
  cardBg: ["#FFFFFF", "#FFFFFF"],
  headerText: ["#FFEE8C", "#FFC800", "#FFA300"], // Gold gradient for header
  cellText: "#FFD400",
  badgeText: "#FFD84D",
  badgeStroke: "#1D4FA0",
  polygonFill: "#E4362C", // Red container
};

const fonts = {
  badge: "Peace Sans",
  text: "Peace Sans",
  header: "Peace Sans",
  cell: "Peace Sans",
};

let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  try {
    GlobalFonts.registerFromPath(
      path.join(__dirname, "../../../assets/fonts/toy_story/peace-sans.otf"),
      "Peace Sans",
    );
    GlobalFonts.registerFromPath(
      path.join(__dirname, "../../../assets/fonts/toy_story/NewWaltDisneyFontRegular-BPen.ttf"),
      "Disney",
    );
    GlobalFonts.registerFromPath(
      path.join(__dirname, "../../../assets/fonts/toy_story/CharlemagneStd-Bold.otf"),
      "Charlemagne",
    );
    GlobalFonts.registerFromPath(
      path.join(__dirname, "../../../assets/fonts/toy_story/raleway.bold.ttf"),
      "Raleway",
    );
    fontsRegistered = true;
  } catch (error) {
    console.error("Failed to register Toy Story fonts:", error);
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

function measureText(ctx, text, font) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * Generate random tilt angle between 2° and 7° (in radians)
 */
function randomTilt() {
  const minDeg = 2;
  const maxDeg = 7;
  const deg = minDeg + Math.random() * (maxDeg - minDeg);
  return (deg * Math.PI) / 180;
}

/**
 * Generate random height difference between 16-18px
 */
function randomHeightDiff() {
  const minDiff = 16;
  const maxDiff = 18;
  return minDiff + Math.random() * (maxDiff - minDiff);
}

/**
 * Draw a tilted red polygon container with box shadow and border radius
 * Width depends on text length
 * 
 * CUSTOMIZATION OPTIONS:
 * - TILT_RANGE: Change min/max degrees for tilt (currently 2°-7°)
 * - HEIGHT_DIFF_RANGE: Change height difference range (currently 16-18px)
 * - PADDING: Adjust padding around text (currently 40px)
 * - MIN_WIDTH: Minimum polygon width (currently 200px)
 * - DIRECTION: Force tilt direction (remove random for consistent direction)
 * - BORDER_RADIUS: Adjust corner rounding (currently 12px)
 * - SHADOW_OFFSET: Adjust shadow offset (currently 4px)
 * - SHADOW_BLUR: Adjust shadow blur (currently 8px)
 */
function drawTiltedPolygon(ctx, centerX, centerY, textWidth, baseHeight = 80, noTilt = false, selected = true, forceWidth = null) {
  // ===== CUSTOMIZATION: Tilt angle range (2°-7°) =====
  const tilt = noTilt ? 0 : randomTilt();
  
  // ===== CUSTOMIZATION: Height difference range (16-18px) =====
  const heightDiff = noTilt ? 0 : randomHeightDiff();
  
  // ===== CUSTOMIZATION: Padding around text =====
  const padding = 40; // Increased for thicker appearance
  
  // ===== CUSTOMIZATION: Minimum polygon width =====
  const minPolygonWidth = 200;
  
  // Use forceWidth if provided, otherwise calculate from textWidth
  const polygonWidth = forceWidth || Math.max(textWidth + padding, minPolygonWidth);
  
  // ===== CUSTOMIZATION: Random tilt direction (remove for consistent direction) =====
  const direction = Math.random() > 0.5 ? 1 : -1;
  const actualTilt = noTilt ? 0 : tilt * direction;
  
  // ===== CUSTOMIZATION: Border radius =====
  const borderRadius = 6; // Reduced for less rounded corners
  
  // ===== CUSTOMIZATION: Thickness (solid extension, not drop shadow) =====
  const thickness = 4; // Thickness of the solid extension
  const thicknessColor = "#8B1E1A"; // Darker red for thickness
  
  // Polygon color based on selection state
  // For lista (noTilt), use glassmorphism effect instead of solid color
  const polygonColor = selected ? colors.polygonFill : "transparent";
  
  // Glassmorphism settings for lista cells
  const useGlassmorphism = noTilt && !selected;
  const glassColor = "rgba(255, 255, 255, 0.3)"; // Increased opacity for more visibility
  const glassBorder = "rgba(255, 255, 255, 0.5)"; // Light border
  
  // Calculate polygon points with tilt and height difference
  const halfWidth = polygonWidth / 2;
  const halfHeight = baseHeight / 2;
  
  // Top-left and top-right
  const tlX = centerX - halfWidth;
  const tlY = centerY - halfHeight;
  const trX = centerX + halfWidth;
  const trY = centerY - halfHeight + (heightDiff / 2) * direction;
  
  // Bottom-left and bottom-right
  const blX = centerX - halfWidth + (heightDiff / 2) * direction;
  const blY = centerY + halfHeight;
  const brX = centerX + halfWidth;
  const brY = centerY + halfHeight - (heightDiff / 2) * direction;
  
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(actualTilt);
  ctx.translate(-centerX, -centerY);
  
  // Draw thickness extension (bottom only with curved corners) - only if not noTilt
  if (!noTilt) {
    ctx.beginPath();
    ctx.moveTo(tlX + borderRadius, tlY);
    ctx.lineTo(trX - borderRadius, trY);
    ctx.quadraticCurveTo(trX, trY, trX, trY + borderRadius);
    ctx.lineTo(brX, brY - borderRadius);
    ctx.quadraticCurveTo(brX, brY, brX - borderRadius, brY + thickness);
    ctx.lineTo(blX + borderRadius, blY + thickness);
    ctx.quadraticCurveTo(blX, blY + thickness, blX, blY + thickness - borderRadius);
    ctx.lineTo(tlX, tlY + borderRadius);
    ctx.quadraticCurveTo(tlX, tlY, tlX + borderRadius, tlY);
    ctx.closePath();
    ctx.fillStyle = thicknessColor;
    ctx.fill();
  }
  
  // Draw main polygon (solid rectangle, no border radius)
  ctx.beginPath();
  ctx.moveTo(tlX, tlY);
  ctx.lineTo(trX, trY);
  ctx.lineTo(brX, brY);
  ctx.lineTo(blX, blY);
  ctx.closePath();
  
  if (useGlassmorphism) {
    // Glassmorphism effect for non-selected lista cells
    ctx.save();
    ctx.filter = "blur(4px)"; // Add blur effect
    ctx.fillStyle = glassColor;
    ctx.fill();
    ctx.filter = "none"; // Reset filter for border
    ctx.strokeStyle = glassBorder;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.fillStyle = polygonColor;
    ctx.fill();
  }
  
  ctx.restore();
  
  return { polygonWidth, actualTilt };
}

/**
 * Draw badge (category letter) with beveled stroke and inset text
 */
function drawBadge(ctx, x, y, text, size = 78) {
  ctx.save();
  ctx.font = `800 ${size}px Peace Sans, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  
  const bevelOffset = 2;
  const strokeColor = colors.badgeStroke;
  const lightColor = "#6B9BD1"; // Lighter blue for highlight
  const darkColor = "#0D2A5A"; // Darker blue for shadow
  
  // Draw bevel effect - light highlight (top-left)
  ctx.strokeStyle = lightColor;
  ctx.lineWidth = 15;
  ctx.lineJoin = "miter";
  ctx.strokeText(text, x - bevelOffset, y - bevelOffset);
  
  ctx.strokeStyle = darkColor;
  ctx.strokeText(text, x + bevelOffset, y + bevelOffset);

  ctx.strokeStyle = strokeColor;
  ctx.strokeText(text, x, y);

  const insetOffset = 1;
  const textLight = "#ffdb64"; 
  const textDark = "#462d03";

  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = colors.badgeText;
  ctx.fillText(text, x, y);
 
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = textDark;
  ctx.fillText(text, x + insetOffset, y + insetOffset);
  
  ctx.fillStyle = textLight;
  ctx.fillText(text, x - insetOffset, y - insetOffset);
  
  ctx.fillStyle = colors.badgeText;
  ctx.fillText(text, x, y);
  
  ctx.restore();
}

/**
 * Draw value text with inset bevel effect
 */
function drawValueText(ctx, x, y, text, baseSize = 34) {
  ctx.save();
  ctx.font = `700 ${baseSize}px Peace Sans, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  
  // Inset bevel effect
  const insetOffset = 1;
  const textLight = "#ffffff0e"; // Lighter yellow for inset highlight
  const textDark = "#583800"; // Darker yellow for inset shadow
  
  // Draw soft shadow (drop shadow)
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = colors.cellText;
  ctx.fillText(text, x, y);
  
  // Reset shadow for inset effect
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  
  // Draw inset shadow (bottom-right, darker)
  ctx.fillStyle = textDark;
  ctx.fillText(text, x + insetOffset, y + insetOffset);
  
  // Draw inset highlight (top-left, lighter)
  ctx.fillStyle = textLight;
  ctx.fillText(text, x - insetOffset, y - insetOffset);
  
  // Draw main text fill
  ctx.fillStyle = colors.cellText;
  ctx.fillText(text, x, y);
  
  ctx.restore();
}

/**
 * Draw STORY header with Disney and Charlemagne fonts
 * Format: "Disney • Story X"
 */
function drawStoryHeader(ctx, x, y, roundNumber) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff"; // White color
  
  // Gap between elements (equal for both gaps)
  const gap = 8;
  
  // Measure text widths
  ctx.font = "700 24px Disney, Arial, sans-serif";
  const disneyWidth = ctx.measureText("Disney").width;
  
  ctx.font = "700 18px Charlemagne, Arial, sans-serif";
  const storyText = `Story ${roundNumber}`;
  const storyWidth = ctx.measureText(storyText).width;
  
  ctx.font = "700 12px Arial, sans-serif"; // Bullet font
  const bulletWidth = ctx.measureText("•").width;
  
  const totalWidth = disneyWidth + gap + bulletWidth + gap + storyWidth;
  const startX = x - totalWidth / 2;
  
  // Draw "Disney" in Disney font
  ctx.font = "700 24px Disney, Arial, sans-serif";
  ctx.fillText("Disney", startX + disneyWidth / 2, y);
  
  // Draw "•" in Arial
  const bulletX = startX + disneyWidth + gap + bulletWidth / 2;
  ctx.font = "700 12px Arial, sans-serif";
  ctx.fillText("•", bulletX, y);
  
  // Draw "Story X" in Charlemagne font
  const storyX = startX + disneyWidth + gap + bulletWidth + gap + storyWidth / 2;
  ctx.font = "700 18px Charlemagne, Arial, sans-serif";
  ctx.fillText(storyText, storyX, y + 4);
  
  ctx.restore();
}

/**
 * Draw DISNEY YEYEYS header for lista
 * Format: "Disney • YEYEYS" with different fonts
 */
function drawDisneyPixarHeader(ctx, x, y) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff"; // White color
  
  // Gap between elements
  const gap = 8;
  
  // Measure text widths
  ctx.font = "700 32px Disney, Arial, sans-serif";
  const disneyWidth = ctx.measureText("Disney").width;
  
  ctx.font = "700 24px Charlemagne, Arial, sans-serif";
  const yeyeysWidth = ctx.measureText("YEYEYS").width;
  
  ctx.font = "700 14px Arial, sans-serif"; // Bullet font
  const bulletWidth = ctx.measureText("•").width;
  
  const totalWidth = disneyWidth + gap + bulletWidth + gap + yeyeysWidth;
  const startX = x - totalWidth / 2;
  
  // Draw "Disney" in Disney font
  ctx.font = "700 32px Disney, Arial, sans-serif";
  ctx.fillText("Disney", startX + disneyWidth / 2, y);
  
  // Draw "•" in Arial
  const bulletX = startX + disneyWidth + gap + bulletWidth / 2;
  ctx.font = "700 14px Arial, sans-serif";
  ctx.fillText("•", bulletX, y);
  
  // Draw "YEYEYS" in Charlemagne font
  const yeyeysX = startX + disneyWidth + gap + bulletWidth + gap + yeyeysWidth / 2;
  ctx.font = "700 24px Charlemagne, Arial, sans-serif";
  ctx.fillText("YEYEYS", yeyeysX, y + 4);
  
  ctx.restore();
}

function generateBingoImageCanvas(game, themeId = null) {
  registerFonts();

  const numRows = game.card[0]?.items?.length || 15;
  const headerHeight = 60;
  const cellHeight = 80;
  const minColWidth = 160;
  const maxColWidth = 400;

  // Create a temporary canvas to measure text
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");

  // Calculate column widths dynamically based on content
  const colWidths = game.card.map((column) => {
    let maxW = 0;
    const headerW = measureText(measureCtx, String(column.category), "700 30px Peace Sans, Arial, sans-serif");
    if (headerW > maxW) maxW = headerW;
    
    column.items.forEach((item) => {
      const w = measureText(measureCtx, String(item.value || ""), "600 30px Peace Sans, Arial, sans-serif");
      if (w > maxW) maxW = w;
    });
    
    return Math.max(minColWidth, Math.min(maxColWidth, Math.ceil(maxW + 40)));
  });
  
  const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const height = headerHeight + cellHeight * numRows;

  const canvas = createCanvas(totalWidth, height);
  const ctx = canvas.getContext("2d");

  drawBackground(ctx, totalWidth, height);

  // Draw header only if NOT bingulo_beta theme
  if (themeId !== "bingulo_beta") {
    drawStoryHeader(ctx, totalWidth / 2, headerHeight / 2, 1);
  }

  game.card.forEach((column, colIndex) => {
    const colWidth = colWidths[colIndex];
    const x = colWidths.slice(0, colIndex).reduce((sum, w) => sum + w, 0);
    const header = column.category;

    // Sort items by value
    const sortedItems = [...column.items].sort((a, b) => {
      return compareSortableValues(a.value, b.value);
    });

    sortedItems.forEach((item, rowIndex) => {
      const y = headerHeight + rowIndex * cellHeight;
      const centerX = x + colWidth / 2;
      const centerY = y + cellHeight / 2;

      // Measure text for polygon width
      const text = String(item.value || "");
      const textSize = measureText(ctx, text, "700 34px Peace Sans, Arial, sans-serif");
      
      // Check if item is selected (marked)
      const isSelected = item.marked === true;
      
      // Draw polygon container (no tilt for bingo card, based on selection state)
      drawTiltedPolygon(ctx, centerX, centerY, textSize, cellHeight - 10, true, isSelected);
      
      // Draw badge (category letter)
      const badgeY = centerY - 25;
      drawBadge(ctx, centerX, badgeY, header.charAt(0), 78);
      
      // Draw value text centered
      const valueY = centerY + 25;
      const valueSize = text.length > 5 ? 28 : 34;
      drawValueText(ctx, centerX, valueY, text, valueSize);
    });
  });

  return canvas.toBuffer("image/png");
}

function generateBolaImageForDrawsCanvas(draws, roundNumber, themeId = null) {
  registerFonts();

  const rowHeight = 140;
  const outerPad = 12;
  const topGap = 20;
  const bottomGap = 20;
  const headerToItemsGap = 20; // keep some gap from top edge
  const headerHeight = 60; // Space for Disney Pixar header
  
  // Calculate dynamic width based on text content
  const measureCanvas = createCanvas(1, 1);
  const measureCtx = measureCanvas.getContext("2d");
  let maxTextWidth = 0;
  draws.forEach(([cat, val]) => {
    const text = String(val);
    const textSize = measureText(measureCtx, text, "700 34px Peace Sans, Arial, sans-serif");
    if (textSize > maxTextWidth) maxTextWidth = textSize;
  });
  
  const cardWidth = Math.max(300, maxTextWidth + 100); // Dynamic width with padding
  const cardHeight = outerPad * 2 + topGap + bottomGap + headerToItemsGap + headerHeight + (rowHeight * draws.length);
  const startY = outerPad + topGap + headerToItemsGap + headerHeight;

  const RENDER_SCALE = 2;
  const canvas = createCanvas(cardWidth * RENDER_SCALE, cardHeight * RENDER_SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  drawBackground(ctx, cardWidth, cardHeight);

  // Draw Disney Pixar header only if NOT bingulo_beta theme
  if (themeId !== "bingulo_beta") {
    drawDisneyPixarHeader(ctx, cardWidth / 2, outerPad + topGap + headerHeight / 2);
  }

  draws.forEach(([cat, val], i) => {
    const y = startY + i * rowHeight;
    const centerX = cardWidth / 2;
    const centerY = y + rowHeight / 2;

    // Measure text for polygon width
    const text = String(val);
    const textSize = measureText(ctx, text, "700 34px Peace Sans, Arial, sans-serif");
    
    // Draw tilted polygon container
    drawTiltedPolygon(ctx, centerX, centerY, textSize, 80);
    
    // Draw badge (category letter)
    const badgeY = centerY - 45;
    drawBadge(ctx, centerX, badgeY, cat, 78);
    
    // Draw value text positioned lower to avoid badge overlap
    const valueY = centerY + 10;
    const valueSize = text.length > 5 ? 28 : 34;
    drawValueText(ctx, centerX, valueY, text, valueSize);
  });

  return canvas.toBuffer("image/png");
}

async function generateBingoDrawnItemsImage(game) {
  registerFonts();

  const drawnItems = game.drawOrder || [];
  
  // Create a set of drawn items for quick lookup
  const drawnSet = new Set(drawnItems.map(([cat, val]) => `${cat}:${val}`));

  // Use all categories from the card
  const categoryOrder = game.card.map((col) => col.category);

  const headerHeight = 180; // Increased to push table down more to not block header
  const cellHeight = 80;
  const cellGap = 6; // Gap between cells
  const colGap = 6; // Horizontal gap between columns
  const fixedColWidth = 180; // Fixed equal width for all columns
  const padding = 20; // Padding around the entire image (increased for visibility)
  const headerToTableGap = 22; // Extra gap between header badges and first row

  const numCols = categoryOrder.length;
  const width = fixedColWidth * numCols + colGap * (numCols - 1) + padding * 2; // Add padding
  
  // Calculate max rows across all columns
  const maxRows = Math.max(...game.card.map((col) => col.items.length));
  const height = headerHeight + headerToTableGap + (cellHeight + cellGap) * maxRows + padding * 2; // Add padding and header gap

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Use tsbg.png as background for lista
  const bgImage = await loadImage(path.join(__dirname, "../../../assets/themes/toy_story/tsbg.png"));
  ctx.drawImage(bgImage, 0, 0, width, height);
  
  // Add dark overlay to make background darker
  ctx.fillStyle = "rgba(0, 0, 0, 0.1)"; // Semi-transparent black overlay
  ctx.fillRect(0, 0, width, height);

  // Draw DISNEY PIXAR header (moved up to reduce gap with top edge, with padding offset)
  drawDisneyPixarHeader(ctx, width / 2, headerHeight / 3 + padding);

  // Draw column headers with badges (moved down to not block header, with padding offset)
  categoryOrder.forEach((cat, colIndex) => {
    const x = padding + colIndex * (fixedColWidth + colGap);
    const centerX = x + fixedColWidth / 2;
    const centerY = headerHeight - 30 + padding; // Moved up to increase gap with first row
    
    // Draw badge in column header (reduced size to not block header)
    drawBadge(ctx, centerX, centerY, cat.charAt(0), 30);
  });

  // Draw all items from the card (with padding offset)
  for (let colIndex = 0; colIndex < numCols; colIndex++) {
    const col = game.card[colIndex];
    const cat = col.category;
    const x = padding + colIndex * (fixedColWidth + colGap);
    
    // Sort items using compareSortableValues for proper numeric/alphanumeric sorting
    const sortedItems = [...col.items].sort((a, b) => 
      compareSortableValues(a.value, b.value)
    );
    
    sortedItems.forEach((item, rowIndex) => {
      const y = padding + headerHeight + headerToTableGap + rowIndex * (cellHeight + cellGap);
      const centerX = x + fixedColWidth / 2;
      const centerY = y + cellHeight / 2;

      // Measure text for polygon width
      const text = String(item.value || "");
      
      // Check if item is drawn
      const isDrawn = drawnSet.has(`${cat}:${text}`);
      
      // Draw polygon container (no tilt, red if drawn, white if not, force width/height for gaps)
      const polygonWidth = colGap > 0 ? fixedColWidth - colGap : fixedColWidth;
      const polygonHeight = cellGap > 0 ? cellHeight - cellGap : cellHeight;
      drawTiltedPolygon(ctx, centerX, centerY, fixedColWidth - 40, polygonHeight, true, isDrawn, polygonWidth);
      
      // Draw value text centered (use Raleway font for lista with wrap)
      const valueSize = 22; // Increased from 20 to 22
      ctx.save();
      ctx.font = `500 ${valueSize}px Raleway, Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // Use dark blue for non-selected items, yellow for selected
      ctx.fillStyle = isDrawn ? colors.cellText : "#1E3A8A"; // Dark blue for non-selected
      
      // Wrap text if too long
      const maxTextWidth = fixedColWidth - 20;
      const textWidth = ctx.measureText(text).width;
      if (textWidth > maxTextWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        words.forEach((word) => {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = ctx.measureText(testLine).width;
          if (testWidth > maxTextWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        if (currentLine) lines.push(currentLine);
        
        // Draw wrapped lines
        const lineHeight = valueSize + 4;
        const totalHeight = lines.length * lineHeight;
        const startY = centerY - totalHeight / 2 + lineHeight / 2;
        lines.forEach((line, i) => {
          ctx.fillText(line, centerX, startY + i * lineHeight);
        });
      } else {
        ctx.fillText(text, centerX, centerY);
      }
      
      ctx.restore();
    });
  }

  return canvas.toBuffer("image/png");
}

module.exports = {
  registerFonts,
  generateBingoImageCanvas,
  generateBolaImageForDrawsCanvas,
  generateBingoDrawnItemsImage,
};
