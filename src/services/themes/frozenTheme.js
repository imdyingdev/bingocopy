/**
 * Frozen theme — canvas renderers using item.png mats and bg images.
 *
 * Behavior:
 * - Uses `assets/themes/frozen/item.png` as the per-item mat. When rendering
 *   multiple draws we place one full mat per item (stacked vertically for
 *   bola counts >= 2) and center text within each mat. No padding is added.
 * - bgL.png is used for single (bola1) full-bleed background; bgP.png for others.
 * - Registers `icekingdom-bold.ttf` if present for item text.
 */
const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  try {
    const fontPath = path.join(__dirname, '../../../assets/themes/frozen/icekingdom-bold.ttf');
    if (fs.existsSync(fontPath)) GlobalFonts.registerFromPath(fontPath, 'IceKingdom');
    // Also register Toy Story header fonts if available so header matches Toy Story
    const toyBase = path.join(__dirname, '../../../assets/fonts/toy_story');
    const disneyPath = path.join(toyBase, 'NewWaltDisneyFontRegular-BPen.ttf');
    const charlPath = path.join(toyBase, 'CharlemagneStd-Bold.otf');
    if (fs.existsSync(disneyPath)) GlobalFonts.registerFromPath(disneyPath, 'Disney');
    if (fs.existsSync(charlPath)) GlobalFonts.registerFromPath(charlPath, 'Charlemagne');
  } catch (err) {
    console.warn('frozenTheme: font register failed:', err && err.message ? err.message : err);
  }
  fontsRegistered = true;
}

function drawDisneyJellyHeader(ctx, width, headerH) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const gap = 6;
  // Reduced font multipliers to keep header compact
  ctx.font = `700 ${Math.round(headerH * 0.36)}px Disney, Arial, sans-serif`;
  const disneyWidth = ctx.measureText('Disney').width;
  ctx.font = `700 ${Math.round(headerH * 0.24)}px Charlemagne, Arial, sans-serif`;
  const jellyWidth = ctx.measureText('SHAWN').width;
  ctx.font = `700 ${Math.round(headerH * 0.14)}px Arial, sans-serif`;
  const bulletWidth = ctx.measureText('•').width;

  const totalWidth = disneyWidth + gap + bulletWidth + gap + jellyWidth;
  const startX = width / 2 - totalWidth / 2;

  // Disney (smaller)
  ctx.font = `700 ${Math.round(headerH * 0.36)}px Disney, Arial, sans-serif`;
  ctx.fillText('Disney', startX + disneyWidth / 2, headerH / 2 - 1);

  // bullet
  const bulletX = startX + disneyWidth + gap + bulletWidth / 2;
  ctx.font = `700 ${Math.round(headerH * 0.14)}px Arial, sans-serif`;
  ctx.fillText('•', bulletX, headerH / 2 - 1);

  // JELLY (smaller)
  const jellyX = startX + disneyWidth + gap + bulletWidth + gap + jellyWidth / 2;
  ctx.font = `700 ${Math.round(headerH * 0.24)}px Charlemagne, Arial, sans-serif`;
  ctx.fillText('JELLY', jellyX, headerH / 2 + 1);

  ctx.restore();
}

function drawImageCover(ctx, img, w, h) {
  const iw = img.width, ih = img.height;
  const scale = Math.max(w / iw, h / ih);
  const nw = iw * scale, nh = ih * scale;
  ctx.drawImage(img, (w - nw) / 2, (h - nh) / 2, nw, nh);
}

function drawImageContain(ctx, img, x, y, w, h) {
  const iw = img.width, ih = img.height;
  const scale = Math.min(w / iw, h / ih);
  const nw = iw * scale, nh = ih * scale;
  const dx = x + (w - nw) / 2;
  const dy = y + (h - nh) / 2;
  ctx.drawImage(img, dx, dy, nw, nh);
  return { dx, dy, nw, nh };
}

function drawPlaqueFixedByImage(ctx, img, boxX, boxY, boxW, boxH) {
  const iw = img.width, ih = img.height;
  let scale = boxH / ih;
  let w = Math.round(iw * scale), h = Math.round(ih * scale);
  if (w > boxW) {
    scale = boxW / iw; w = Math.round(iw * scale); h = Math.round(ih * scale);
  }
  const dx = Math.round(boxX + (boxW - w) / 2);
  const dy = Math.round(boxY + (boxH - h) / 2);
  ctx.drawImage(img, dx, dy, w, h);
  return { dx, dy, nw: w, nh: h };
}

async function loadThemeAsset(filename) {
  const base = path.join(__dirname, '../../../assets/themes/frozen');
  const tried = [];
  const exts = ['.png', '.jpg', '.jpeg', '.JPG', '.PNG'];
  // if filename already has extension, try it first
  if (path.extname(filename)) {
    const p = path.join(base, filename);
    if (fs.existsSync(p)) {
      try { return await loadImage(p); } catch (err) { console.warn('frozenTheme: load failed', filename, err && err.message ? err.message : err); return null; }
    }
    tried.push(filename);
  }
  const name = path.parse(filename).name;
  for (const ext of exts) {
    const p = path.join(base, name + ext);
    tried.push(name + ext);
    if (fs.existsSync(p)) {
      try { return await loadImage(p); } catch (err) { console.warn('frozenTheme: load failed', name + ext, err && err.message ? err.message : err); return null; }
    }
  }
  // not found
  // console.debug('frozenTheme: asset not found, tried:', tried.join(', '));
  return null;
}

function wrapTextCentered(ctx, text, centerX, y, maxWidth, lineHeight, maxLines = Infinity) {
  const words = String(text).split(' ').filter(Boolean);

  // If no explicit maxLines or maxLines > 2, use original greedy wrap
  if (!isFinite(maxLines) || maxLines > 2) {
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => ctx.fillText(l, centerX, startY + i * lineHeight));
    return lines.length;
  }

  // maxLines === 1 or 2 handling
  if (maxLines === 1) {
    // truncate to single line
    let line = words.join(' ');
    while (ctx.measureText(line + '…').width > maxWidth && line.length > 0) {
      line = line.replace(/\s+\S+$/, '');
    }
    if (line.length < words.join(' ').length) line = line.trim() + '…';
    ctx.fillText(line, centerX, y);
    return 1;
  }

  // maxLines === 2: try to find a split that keeps both lines within constraints.
  if (words.length <= 1) { ctx.fillText(words.join(' '), centerX, y); return 1; }
  // If only two words and they fit in one line, prefer a single line
  if (words.length === 2) {
    const full = words.join(' ');
    if (ctx.measureText(full).width <= maxWidth) { ctx.fillText(full, centerX, y); return 1; }
  }

  // Allow the second line to be wider than the first (better visual balance)
  const allowed1 = maxWidth;
  const allowed2 = Math.round(maxWidth * 1.35);

  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const wa = ctx.measureText(a).width;
    const wb = ctx.measureText(b).width;
    // Prefer splits where both lines fit their allowed widths
    const score = Math.max(wa / Math.max(1, allowed1), wb / Math.max(1, allowed2));
    if (!best || score < best.score) best = { i, a, b, wa, wb, score };
    if (wa <= allowed1 && wb <= allowed2) {
      // avoid choosing a single-word first line when the phrase has more than 2 words
      if (i === 1 && words.length > 2) {
        // skip this perfect split in hopes of finding a more balanced one
        continue;
      }
      best = { i, a, b, wa, wb, score, perfect: true };
      break;
    }
  }

  const lines = best ? [best.a, best.b] : [words.join(' ')];

  // If a line still exceeds its allowed width, truncate by characters (safer than chopping whole words)
  for (let idx = 0; idx < lines.length; idx++) {
    let ln = lines[idx];
    const allowed = idx === 0 ? allowed1 : allowed2;
    if (ctx.measureText(ln).width > allowed) {
      // remove characters until it fits, but keep at least 4 chars
      while (ln.length > 4 && ctx.measureText(ln + '…').width > allowed) ln = ln.slice(0, -1);
      if (ln.length <= 4) ln = ln.slice(0, 4);
      lines[idx] = ln.trim() + '…';
    }
  }

  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, centerX, startY + i * lineHeight));
  return lines.length;
}

/**
 * Generate bola image
 */
async function generateBolaImageForDrawsCanvas(draws = [], roundNumber = 1) {
  registerFonts();
  // Load plaque (item) first to allow canvas sizing driven by the image
  const plaqueImg = await loadThemeAsset('item.png');
    // Default canvas size
    let width = 1280, height = 720;
    // Default plaque box uses full canvas area
    let plaqueBox = { dx: 0, dy: 0, nw: width, nh: height };
  // Reserve header height (match Toy Story header proportions) and include in sizing
  const headerH =  Math.round(plaqueImg ? Math.min(120, (plaqueImg ? plaqueImg.height * 0.3 : 80)) : 80);
  if (plaqueImg) {
    // Make canvas width exactly the plaque (item) width and remove left/right padding
    const iw = plaqueImg.width, ih = plaqueImg.height;
    const drawsCount = Math.max(1, draws.length);
      // Use native image width but cap to a low-res maximum to keep output small
      const MAX_W = 960;
      let baseW = Math.min(iw, MAX_W);
      let scale = baseW / iw;
      let baseH = Math.round(ih * scale);
      const totalH = baseH * drawsCount;
      // Remove horizontal padding (left/right = 0) per user request
      const padX = 0;
      const padY = 0;
      width = baseW + padX * 2;
      height = headerH + totalH + padY * 2; // include header
      plaqueBox = { dx: padX, dy: headerH + padY, nw: baseW, nh: totalH };
  }
  const RENDER_SCALE = 2;
  const canvas = createCanvas(width * RENDER_SCALE, height * RENDER_SCALE); const ctx = canvas.getContext('2d');
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  const single = draws.length === 1;
  const bgFile = single ? 'bgL' : 'bgP';
  // try multiple exts via loadThemeAsset
  const bgImg = await loadThemeAsset(bgFile);
  if (bgImg) drawImageCover(ctx, bgImg, width, height);
  else { const g = ctx.createLinearGradient(0,0,0,height); g.addColorStop(0,'#e6f7ff'); g.addColorStop(1,'#cfe9ff'); ctx.fillStyle = g; ctx.fillRect(0,0,width,height); }
  const fontFamily = fontsRegistered ? 'IceKingdom' : 'Arial';

  // Draw header area background slightly darker and the logo
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, 0, width, headerH);
  drawDisneyJellyHeader(ctx, width, headerH);

  if (plaqueImg && draws.length >= 2) {
    // Stack mats vertically, one per draw, no gaps, width determined by image
    const iw = plaqueImg.width, ih = plaqueImg.height;
    // start with image native width, cap by plaqueBox.nw
    let baseW = Math.min(iw, plaqueBox.nw);
    let scale = baseW / iw; let baseH = Math.round(ih * scale);
    // shrink if total height exceeds plaque area
    let totalH = baseH * draws.length;
    if (totalH > plaqueBox.nh) { const shrink = plaqueBox.nh / totalH; scale *= shrink; baseW = Math.floor(iw * scale); baseH = Math.floor(ih * scale); totalH = baseH * draws.length; }
    const startX = plaqueBox.dx + Math.round((plaqueBox.nw - baseW) / 2);
    let y = plaqueBox.dy + Math.round((plaqueBox.nh - totalH) / 2);
    for (let i = 0; i < draws.length; i++) {
      const centered = drawPlaqueFixedByImage(ctx, plaqueImg, startX, y, baseW, baseH);
      const [category, value] = Array.isArray(draws[i]) ? draws[i] : [null, draws[i]];
      const centerX = centered.dx + centered.nw / 2;
      if (category) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const labelFontSize = Math.round(centered.nh * 0.34);
        ctx.font = `800 ${labelFontSize}px ${fontFamily}, Arial, sans-serif`;
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 8;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 4;
        ctx.fillText(category, centerX, centered.dy + Math.round(centered.nh * 0.18));
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      // slightly smaller than before (-4px)
      let valueFontSize = Math.max(10, Math.round(centered.nh * 0.14) - 4);
      ctx.font = `700 ${valueFontSize}px ${fontFamily}, Arial, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;
      const lineH = Math.round(valueFontSize * 1.15);
      // prefer two lines when possible and nudge the whole item up a little
      wrapTextCentered(ctx, String(value), centerX, centered.dy + Math.round(centered.nh * 0.56), Math.round(centered.nw * 0.65), lineH, 2);
      ctx.restore();
      y += baseH;
    }
    return canvas.toBuffer('image/png');
  }

  if (plaqueImg && draws.length === 1) {
    const centered = drawPlaqueFixedByImage(ctx, plaqueImg, plaqueBox.dx, plaqueBox.dy, plaqueBox.nw, plaqueBox.nh);
    const [category, value] = Array.isArray(draws[0]) ? draws[0] : [null, draws[0]];
    const centerX = centered.dx + centered.nw / 2;
    if (category) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelFontSize = Math.round(centered.nh * 0.34);
      ctx.font = `800 ${labelFontSize}px ${fontFamily}, Arial, sans-serif`;
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;
      ctx.fillText(category, centerX, centered.dy + Math.round(centered.nh * 0.18));
      ctx.restore();
    }
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    let valueFontSize = Math.max(10, Math.round(centered.nh * 0.14) - 4);
    ctx.font = `700 ${valueFontSize}px ${fontFamily}, Arial, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;
    const lineH = Math.round(valueFontSize * 1.15);
    // prefer two lines and nudge up slightly
    wrapTextCentered(ctx, String(value), centerX, centered.dy + Math.round(centered.nh * 0.56), Math.round(centered.nw * 0.65), lineH, 2);
    ctx.restore();
    return canvas.toBuffer('image/png');
  }

  // fallback: no item image
  draws.forEach((d,i)=>{
    const [category,value]=Array.isArray(d)?d:[null,d];
    const slotW = Math.floor(plaqueBox.nw / Math.max(draws.length,1));
    const centerX = plaqueBox.dx + slotW*(i+0.5);
    if (category) { ctx.save(); ctx.fillStyle='#ffffff'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=`700 ${Math.round(plaqueBox.nh*0.28)}px ${fontFamily}, Arial, sans-serif`; ctx.fillText(category, centerX, plaqueBox.dy + Math.round(plaqueBox.nh*0.32)); ctx.restore(); }
    ctx.save(); ctx.fillStyle='#ffffff'; ctx.textAlign='center'; ctx.font=`700 ${Math.round(plaqueBox.nh*0.09)}px ${fontFamily}, Arial, sans-serif`; wrapTextCentered(ctx, String(value), centerX, plaqueBox.dy + Math.round(plaqueBox.nh*0.62), Math.round(slotW*0.85), Math.round(plaqueBox.nh*0.1)); ctx.restore();
  });

  return canvas.toBuffer('image/png');
}

module.exports = {
  registerFonts,
  generateBolaImageForDrawsCanvas,
  generateBingoDrawnItemsImage,
};

/**
 * Generate lista-style drawn items image for Frozen theme
 * Layout mirrors Toy Story `generateBingoDrawnItemsImage` but uses frozen bgP and blue accents
 */
async function generateBingoDrawnItemsImage(game) {
  registerFonts();
  const draws = game.drawOrder || [];

  // Build category order and items from game.card
  const categoryOrder = game.card.map((c) => c.category);
  const categoryItems = {};
  categoryOrder.forEach((cat) => { categoryItems[cat] = []; });
  game.card.forEach((col) => { col.items.forEach((it) => categoryItems[col.category].push(it.value)); });

  // Layout params (based on Toy Story layout, adjusted colors)
  const headerHeight = 120;
  const cellHeight = 80;
  const cellGap = 6;
  const colGap = 6;
  const fixedColWidth = 180;
  const padding = 20;
  const headerToTableGap = 22;

  const numCols = categoryOrder.length;
  const width = fixedColWidth * numCols + colGap * (numCols - 1) + padding * 2;
  const maxRows = Math.max(...Object.values(categoryItems).map((a) => a.length));
  const height = headerHeight + headerToTableGap + (cellHeight + cellGap) * maxRows + padding * 2;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background: use bgP.jpg if available
  const bg = await loadThemeAsset('bgP');
  if (bg) {
    drawImageCover(ctx, bg, width, height);
  } else {
    const g = ctx.createLinearGradient(0,0,0,height); g.addColorStop(0,'#e6f7ff'); g.addColorStop(1,'#cfe9ff'); ctx.fillStyle = g; ctx.fillRect(0,0,width,height);
  }

  // overlay to ensure contrast
  ctx.fillStyle = 'rgba(0, 20, 60, 0.18)'; ctx.fillRect(0,0,width,height);

  // Draw header
  drawDisneyJellyHeader(ctx, width, headerHeight);

  // Badge drawing function (blue themed)
  function drawBlueBadge(cx, cy, txt, size=78) {
    ctx.save();
    ctx.font = `800 ${size}px ${fontsRegistered ? 'IceKingdom' : 'Arial'}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#DDEEFF'; ctx.strokeStyle = '#083776'; ctx.lineWidth = 10; ctx.strokeText(txt, cx, cy); ctx.fillText(txt, cx, cy);
    ctx.restore();
  }

  // Draw column headers badges
  categoryOrder.forEach((cat, colIndex) => {
    const x = padding + colIndex * (fixedColWidth + colGap);
    const centerX = x + fixedColWidth / 2;
    // Place badges below the header (bottom of Disney JELLY)
    const centerY = headerHeight + Math.round(headerToTableGap / 2);
    drawBlueBadge(centerX, centerY, cat.charAt(0), 30);
  });

  // Draw items grid
  const drawnSet = new Set(draws.map(([c,v]) => `${c}:${v}`));
  for (let colIndex = 0; colIndex < numCols; colIndex++) {
    const col = game.card[colIndex];
    const cat = col.category;
    const x = padding + colIndex * (fixedColWidth + colGap);
    const sorted = [...col.items].map(i=>i.value).sort();
    sorted.forEach((val, rowIndex) => {
      const y = padding + headerHeight + headerToTableGap + rowIndex * (cellHeight + cellGap);
      const centerX = x + fixedColWidth / 2;
      const centerY = y + cellHeight / 2;

      const isDrawn = drawnSet.has(`${cat}:${val}`);

      // Draw rectangle background (drawn items: solid blue, non-drawn: light/white)
      ctx.fillStyle = isDrawn ? '#1E5FBF' : 'rgba(255,255,255,0.95)';
      ctx.fillRect(x, y, fixedColWidth, cellHeight);
      ctx.strokeStyle = isDrawn ? '#154A8F' : '#9BC7FF'; ctx.lineWidth = 1; ctx.strokeRect(x, y, fixedColWidth, cellHeight);

      // Draw text (white on drawn, dark-blue otherwise)
      ctx.save();
      ctx.font = `500 22px ${fontsRegistered ? 'IceKingdom' : 'Arial'}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = isDrawn ? '#FFFFFF' : '#083776';
      const maxTextWidth = fixedColWidth - 20;
      const textWidth = ctx.measureText(String(val)).width;
      if (textWidth > maxTextWidth) {
        const words = String(val).split(' ');
        const lines = []; let cur='';
        for (const w of words) {
          const test = cur ? cur + ' ' + w : w;
          if (ctx.measureText(test).width > maxTextWidth && cur) { lines.push(cur); cur = w; } else cur = test;
        }
        if (cur) lines.push(cur);
        const lineH = 22 + 4; const totalH = lines.length * lineH; const startY = centerY - totalH/2 + lineH/2;
        lines.forEach((ln,i)=> ctx.fillText(ln, centerX, startY + i*lineH));
      } else {
        ctx.fillText(String(val), centerX, centerY);
      }
      ctx.restore();
    });
  }

  return canvas.toBuffer('image/png');
}
