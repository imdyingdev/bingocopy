/**
 * Image generation service — loads themes and delegates rendering
 */

const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const { THEME_FILES } = require("../constants/themes");

// Simple in-memory cache with TTL
class Cache {
  constructor() {
    this.cache = new Map();
  }

  set(key, value, ttlMs = 3600000) { // Default 1 hour TTL
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  clear() {
    this.cache.clear();
  }
}

// Global cache instance
const cache = new Cache();

const FONT_DIR = path.join(__dirname, "..", "..", "assets", "fonts");
if (fs.existsSync(path.join(FONT_DIR, "fredoka-one-latin-400-normal.woff2"))) {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "fredoka-one-latin-400-normal.woff2"), "Fredoka One");
}
if (fs.existsSync(path.join(FONT_DIR, "slackey-latin-400-normal.ttf"))) {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "slackey-latin-400-normal.ttf"), "Slackey");
}
if (fs.existsSync(path.join(FONT_DIR, "..", "..", "node_modules", "@fontsource", "nunito", "files", "nunito-latin-700-normal.woff2"))) {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, "..", "..", "node_modules", "@fontsource", "nunito", "files", "nunito-latin-700-normal.woff2"), "Nunito");
}

// Register optional wide-coverage fallback fonts if present
if (fs.existsSync(path.join(FONT_DIR, 'Symbola.ttf'))) {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'Symbola.ttf'), 'Symbola');
}
if (fs.existsSync(path.join(FONT_DIR, 'NotoSansBengali-Regular.ttf'))) {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoSansBengali-Regular.ttf'), 'NotoBengali');
}
if (fs.existsSync(path.join(FONT_DIR, 'NotoColorEmoji.ttf'))) {
  GlobalFonts.registerFromPath(path.join(FONT_DIR, 'NotoColorEmoji.ttf'), 'NotoEmoji');
}

const GIPHY_API_KEY = process.env.GIPHY_API_KEY;
let playwright = null;
try {
  playwright = require("playwright");
} catch (error) {
  console.warn("Playwright not available, summary images will fall back to canvas rendering:", error.message);
}

const getCanvasFont = (size, family = "Nunito", weight = "bold") =>
  `${weight} ${size}px ${family}, 'Segoe UI Symbol', 'Arial Unicode MS', sans-serif`;

// Determine an appropriate fallback font name for a code point
function fontForCodePoint(cp) {
  // Math Alphanumeric Symbols (e.g. 𝓞, 𝟏)
  if (cp >= 0x1D400 && cp <= 0x1D7FF) return 'Symbola';
  // Warang Citi
  if (cp >= 0x118A0 && cp <= 0x118FF) return 'Symbola';
  // Egyptian Hieroglyphs
  if (cp >= 0x13000 && cp <= 0x1342F) return 'Symbola';
  // Bengali
  if (cp >= 0x0980 && cp <= 0x09FF) return 'NotoBengali';
  // Emoji / Misc pictographs
  if ((cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF)) return 'NotoEmoji';
  // Default to main name font
  return 'Nunito';
}

// Draw text by splitting into runs that share the same font, preserving spacing
function drawMixedText(ctx, text, x, y, fontSize, weight = 'bold') {
  if (!text || text.length === 0) return 0;

  const chars = [...text];
  let cursorX = x;
  let run = '';
  let runFont = null;

  const flush = () => {
    if (!run) return;
    ctx.font = getCanvasFont(fontSize, runFont || 'Nunito', weight);
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(run, cursorX, y);
    cursorX += ctx.measureText(run).width;
    run = '';
  };

  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const font = fontForCodePoint(cp) || 'Nunito';
    if (font !== runFont && run) {
      flush();
      runFont = font;
    }
    if (!runFont) runFont = font;
    run += ch;
  }
  flush();
  return cursorX;
}

const drawSummaryIcon = (ctx, type, x, y, size = 20, color = "#cfc8f0") => {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (type) {
    case "players":
      ctx.beginPath();
      ctx.arc(size / 2, size * 0.3, size * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(size * 0.18, size * 0.86);
      ctx.quadraticCurveTo(size / 2, size * 0.5, size * 0.82, size * 0.86);
      ctx.fill();
      break;
    case "coin":
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1e1440";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "pattern":
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.14, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "trophy":
      ctx.beginPath();
      ctx.moveTo(size * 0.2, size * 0.16);
      ctx.lineTo(size * 0.8, size * 0.16);
      ctx.lineTo(size * 0.68, size * 0.8);
      ctx.lineTo(size * 0.32, size * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(size * 0.3, size * 0.78, size * 0.4, size * 0.08);
      ctx.fillRect(size * 0.34, size * 0.86, size * 0.32, size * 0.06);
      break;
    case "balls":
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "clock":
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(size / 2, size * 0.36);
      ctx.lineTo(size * 0.68, size * 0.54);
      ctx.stroke();
      break;
    default:
      break;
  }

  ctx.restore();
};

class ImageGenerationService {
  constructor(spongebobMode, gameStateService = null) {
    this.spongebobMode = spongebobMode;
    this.gameStateService = gameStateService;
    this.themes = null; // Will store themes map
    this.themesPath = path.join(__dirname, "themes");
    this.browserType = "chromium";
    this.playwrightBrowser = null;
    this.playwrightPage = null;
  }

  setThemesMap(themesMap) {
    this.themes = themesMap;
  }

  loadTheme(themeName) {
    try {
      const themePath = path.join(this.themesPath, `${themeName}.js`);
      if (fs.existsSync(themePath)) {
        delete require.cache[require.resolve(themePath)];
        return require(themePath);
      }
    } catch (error) {
      console.error(`Failed to load theme "${themeName}":`, error);
    }
    return null;
  }

  resolveTheme(chatId, overrideThemeId) {
    // First check if a specific theme is set for this chat, unless an override is supplied.
    let themeId = overrideThemeId || "default";
    if (!overrideThemeId && this.themes) {
      themeId = this.themes.get(chatId) || "default";
    }
    
    const themeName = THEME_FILES[themeId] || THEME_FILES.default;
    return this.loadTheme(themeName) || this.loadTheme(THEME_FILES.default);
  }

  getTheme(chatId) {
    return this.themes ? this.themes.get(chatId) || "default" : "default";
  }

  async generateBingoImageCanvas(game, chatId, overrideThemeId = null) {
    const theme = this.resolveTheme(chatId, overrideThemeId);
    const themeId = overrideThemeId || this.getTheme(chatId);
    const buf = await theme.generateBingoImageCanvas(game, themeId);
    return this._ensureOpaquePng(buf);
  }

  async generateBolaImageForDrawsCanvas(draws, chatId, getBingoGame, overrideThemeId = null) {
    const game = getBingoGame(chatId);
    const roundNumber = game ? game.round : 1;
    const theme = this.resolveTheme(chatId, overrideThemeId);
    const themeId = overrideThemeId || this.getTheme(chatId);

    if (themeId === "default") {
      const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "rainy", "bola.html");
      if (playwright && fs.existsSync(templatePath)) {
        try {
          const buf = await this.generateBolaImageWithPlaywright(draws, roundNumber, templatePath);
          return this._ensureOpaquePng(buf);
        } catch (error) {
          console.warn("Playwright bola render failed, falling back to canvas:", error.message);
        }
      }
    }

    const monsterMode = themeId === "minions" && this.gameStateService
      ? this.gameStateService.getMinionMonsterMode(chatId)
      : false;
    const buf = await theme.generateBolaImageForDrawsCanvas(draws, roundNumber, themeId, monsterMode);
    return this._ensureOpaquePng(buf);
  }

  async generateMixedThemeBolaImage(drawsWithTheme, chatId, getBingoGame) {
    const { createCanvas, loadImage } = require("@napi-rs/canvas");
    const game = getBingoGame(chatId);
    const roundNumber = game ? game.round : 1;

    // Theme modules for mixed rendering
    const defaultTheme = require("./themes/defaultTheme");
    const spongebobTheme = require("./themes/spongebobTheme");
    const toyStoryTheme = require("./themes/toyStoryTheme");
    const calendarTheme = require("./themes/calendarTheme");

    const themeModules = {
      calendar: calendarTheme,
      spongebob: spongebobTheme,
      comics: defaultTheme, // Comics uses default theme style
      toy_story: toyStoryTheme,
    };

    // Group draws by theme to render them together
    const drawsByTheme = {};
    for (const draw of drawsWithTheme) {
      const theme = draw.themeSource || "calendar";
      if (!drawsByTheme[theme]) {
        drawsByTheme[theme] = [];
      }
      drawsByTheme[theme].push([draw.category, draw.value]);
    }

    // Render each group of draws with its corresponding theme
    const renderedImages = [];
    for (const [theme, themeDraws] of Object.entries(drawsByTheme)) {
      const themeModule = themeModules[theme] || defaultTheme;
      const buffer = await themeModule.generateBolaImageForDrawsCanvas(themeDraws, roundNumber);
      const img = await loadImage(buffer);
      renderedImages.push(img);
    }

    // Composite images vertically
    const width = Math.max(...renderedImages.map((img) => img.width));
    const height = renderedImages.reduce((sum, img) => sum + img.height, 0);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    let y = 0;
    for (const img of renderedImages) {
      const leftPad = Math.floor((width - img.width) / 2);
      const rightPad = width - img.width - leftPad;

      if (img.width < width) {
        const padded = createCanvas(width, img.height);
        const paddedCtx = padded.getContext("2d");

        if (leftPad > 0) {
          paddedCtx.drawImage(img, 0, 0, 1, img.height, 0, 0, leftPad, img.height);
        }
        if (rightPad > 0) {
          paddedCtx.drawImage(img, img.width - 1, 0, 1, img.height, leftPad + img.width, 0, rightPad, img.height);
        }

        paddedCtx.drawImage(img, leftPad, 0, img.width, img.height);
        ctx.drawImage(padded, 0, y);
      } else {
        ctx.drawImage(img, 0, y, img.width, img.height);
      }
      y += img.height;
    }

    return this._ensureOpaquePng(canvas.toBuffer("image/png"));
  }

  async generateBingoDrawnItemsImage(game, chatId, overrideThemeId = null) {
    const theme = this.resolveTheme(chatId, overrideThemeId);
    const themeId = overrideThemeId || this.getTheme(chatId);
    const buf = await theme.generateBingoDrawnItemsImage(game, themeId);
    return this._ensureOpaquePng(buf);
  }

  _ensureOpaquePng(buf) {
    if (!buf || !Buffer.isBuffer(buf)) return buf;
    try {
      const { PNG } = require('pngjs');
      const png = PNG.sync.read(buf);
      const pxCount = png.width * png.height;
      const channels = png.data.length / pxCount;
      if (channels === 4) {
        let anyTransparent = false;
        for (let i = 3; i < png.data.length; i += 4) {
          if (png.data[i] < 255) { anyTransparent = true; break; }
        }
        if (anyTransparent) {
          for (let i = 3; i < png.data.length; i += 4) {
            png.data[i] = 255;
          }
          return PNG.sync.write(png);
        }
      }
    } catch (err) {
      console.error('Failed to enforce opaque PNG:', err);
    }
    return buf;
  }

  getBirthdayBackgroundBase64() {
    const birthdayPath = path.join(__dirname, "..", "..", "assets", "images", "bday.png");
    if (!fs.existsSync(birthdayPath)) return null;
    return `data:image/png;base64,${fs.readFileSync(birthdayPath).toString("base64")}`;
  }

  getStrangersGifBase64() {
    const strangersPath = path.join(__dirname, "..", "..", "assets", "strngers.gif");
    if (!fs.existsSync(strangersPath)) return null;
    return `data:image/gif;base64,${fs.readFileSync(strangersPath).toString("base64")}`;
  }

  async generateGameSummaryImage(summary) {
    if (!summary || Number(summary.ballsDrawn || 0) === 0) {
      return this.generateNoItemsSummaryImage();
    }

    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "game-summary.html");
    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generateGameSummaryImageWithPlaywright(summary, templatePath);
      } catch (error) {
        console.warn("Playwright summary render failed, falling back to canvas:", error.message);
      }
    }

    const COLORS = {
      pageBg1: "#FBF3DF",
      pageBg2: "#EFDFB9",
      pageBg3: "#E4CE9C",
      cardBg: "#FFFBF0",
      cardBorder: "#E7D3A4",
      brand: "#E1613F",
      brandSub: "#A88A5C",
      ink: "#4A3A26",
      inkSoft: "#8A7454",
      label: "#7C6748",
      gold: "#C1892E",
      winGreen: "#2C8C6D",
      divider: "#E7D3A4",
      muted: "#7C6748",
    };

    const width = 640;
    const height = 760 + Math.max(0, (summary.winners?.length || 0) - 4) * 42;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const bgGradient = ctx.createRadialGradient(0, 0, 80, width, height, 900);
    bgGradient.addColorStop(0, COLORS.pageBg1);
    bgGradient.addColorStop(0.55, COLORS.pageBg2);
    bgGradient.addColorStop(1, COLORS.pageBg3);
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    const cardX = 24;
    const cardY = 24;
    const cardW = width - 48;
    const cardH = height - 48;

    ctx.fillStyle = COLORS.cardBg;
    ctx.fillRect(cardX, cardY, cardW, cardH);
    ctx.strokeStyle = COLORS.cardBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(cardX, cardY, cardW, cardH);

    ctx.textAlign = "center";
    ctx.fillStyle = COLORS.brand;
    ctx.font = getCanvasFont(32, "Fredoka One", "bold");
    ctx.fillText("BINGAGO!", width / 2, 78);

    ctx.fillStyle = COLORS.brandSub;
    ctx.font = getCanvasFont(13.5, "Nunito", "bold");
    ctx.fillText("GAME SUMMARY", width / 2, 102);

    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 12, cardY + 102);
    ctx.lineTo(cardX + cardW - 12, cardY + 102);
    ctx.stroke();
    ctx.setLineDash([]);

    const sectionTitle = (text, y, icon) => {
      ctx.fillStyle = COLORS.ink;
      ctx.font = getCanvasFont(21, "Baloo 2", "bold");
      ctx.textAlign = "left";
      if (icon) {
        drawSummaryIcon(ctx, icon, 44, y - 18, 24, COLORS.ink);
        ctx.fillText(text, 78, y);
      } else {
        ctx.fillText(text, 44, y);
      }
    };

    const statRow = (label, value, y, valueColor = COLORS.ink, icon = "players") => {
      ctx.fillStyle = COLORS.label;
      ctx.font = getCanvasFont(16.5, "Nunito", "700");
      ctx.textAlign = "left";
      drawSummaryIcon(ctx, icon, 44, y - 13, 20, COLORS.label);
      ctx.fillText(label, 74, y);

      ctx.fillStyle = valueColor;
      ctx.font = getCanvasFont(18, "Baloo 2", "700");
      ctx.textAlign = "right";
      ctx.fillText(value, width - 44, y);
    };

    sectionTitle("Session Summary", 160, "trophy");
    statRow("Players", String(summary.players || 0), 198, COLORS.ink, "players");
    statRow("Bet per Player", `₱${Number(summary.betPerPlayer || 0).toLocaleString()}`, 232, COLORS.gold, "coin");
    statRow("Total Pot", `₱${Number(summary.totalPot || 0).toLocaleString()}`, 266, COLORS.gold, "coin");
    statRow("Winning Patterns", String(summary.patterns || 0), 300, COLORS.ink, "pattern");
    statRow("Prize per Pattern", `₱${Number(summary.prizePerPattern || 0).toLocaleString()}`, 334, COLORS.gold, "coin");

    ctx.fillStyle = COLORS.divider;
    ctx.fillRect(36, 364, width - 72, 1);

    sectionTitle("Winners by Pattern", 398, "trophy");

    const winners = (summary.winners || []).map(w => ({ ...w }));
    // Normalize possible photo field names and attempt to inline avatars as data-URLs
    for (const w of winners) {
      // Normalize common DB column name variants
      w.profilePhotoUrl = w.profilePhotoUrl || w.profilephotourl || w.profile_photo_url || w.photoUrl || null;
      if (w.profilePhotoUrl) {
        try {
          const res = await fetch(w.profilePhotoUrl);
          if (res && res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const ct = res.headers.get("content-type") || "image/jpeg";
            w._inlinedProfilePhoto = `data:${ct};base64,${buf.toString("base64")}`;
          }
        } catch (e) {
          // ignore and leave URL as-is; renderer will fallback to initials
          if (process.env.DEBUG || process.env.NODE_ENV !== "production") {
            console.warn("[GameSummary] failed to inline avatar for", w.profilePhotoUrl, e && e.message);
          }
        }
      }
    }
    // Group winners by pattern for canvas rendering to calculate split prizes
    const winnersByPattern = {};
    for (const winner of winners) {
      const normalizedPattern = String(winner.patternName || "Pattern").trim().toLowerCase();
      if (!winnersByPattern[normalizedPattern]) {
        winnersByPattern[normalizedPattern] = [];
      }
      winnersByPattern[normalizedPattern].push(winner);
    }
    if (winners.length === 0) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = getCanvasFont(16, "Nunito", "600");
      ctx.textAlign = "left";
      ctx.fillText("No winners registered yet.", 44, 438);
    } else {
      let canvasIndex = 0;
      for (const [pattern, patternWinners] of Object.entries(winnersByPattern)) {
        if (canvasIndex >= 8) break;
        // prizeAmount is already the individual prize per winner (from settlement), don't divide again
        const prizePerWinner = patternWinners.length > 0 ? Math.floor(patternWinners[0].prizeAmount || 0) : 0;
        const playerNames = patternWinners.map(w => w.playerName || "Player").join(" / ");
        const y = 438 + canvasIndex * 42;
        ctx.fillStyle = COLORS.label;
        ctx.font = getCanvasFont(16, "Nunito", "700");
        ctx.textAlign = "left";
        ctx.fillText(patternWinners[0].patternName || "Pattern", 44, y);

        ctx.fillStyle = COLORS.gold;
        ctx.font = getCanvasFont(18, "Baloo 2", "700");
        ctx.textAlign = "right";
        ctx.fillText(`₱${prizePerWinner}`, width - 44, y);

        ctx.fillStyle = COLORS.winGreen;
        ctx.font = getCanvasFont(15, "Nunito", "700");
        ctx.textAlign = "right";
        ctx.fillText(playerNames, width - 160, y);
        canvasIndex++;
      }
    }

    ctx.fillStyle = COLORS.divider;
    ctx.fillRect(36, height - 132, width - 72, 1);

    const footerRow = (icon, label, value, y) => {
      ctx.fillStyle = COLORS.label;
      ctx.font = getCanvasFont(15, "Nunito", "700");
      ctx.textAlign = "left";
      drawSummaryIcon(ctx, icon, 44, y - 13, 18, COLORS.label);
      ctx.fillText(label, 74, y);

      ctx.fillStyle = COLORS.ink;
      ctx.font = getCanvasFont(16, "Baloo 2", "700");
      ctx.textAlign = "right";
      ctx.fillText(value, width - 44, y);
    };

    footerRow("balls", "Balls Drawn", `${summary.ballsDrawn || 0} / ${summary.totalBalls || 75}`, height - 92);
    footerRow("clock", "Duration", summary.duration || "—", height - 66);

    return canvas.toBuffer("image/png");
  }

  async ensurePlaywrightPage() {
    if (!playwright) {
      throw new Error("Playwright is not installed");
    }

    if (this.playwrightPage && this.playwrightBrowser) {
      return this.playwrightPage;
    }

    const launchOptions = {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--js-flags=--max-old-space-size=128",
      ],
    };

    if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    }

    this.playwrightBrowser = await playwright[this.browserType].launch(launchOptions);
    this.playwrightPage = await this.playwrightBrowser.newPage({
      viewport: { width: 640, height: 980 },
      deviceScaleFactor: 2,
    });
    await this.playwrightPage.setViewportSize({ width: 640, height: 980 });
    return this.playwrightPage;
  }

  getBase64Asset(assetPath, mimeType) {
    if (!fs.existsSync(assetPath)) return null;
    try {
      const buffer = fs.readFileSync(assetPath);
      return `data:${mimeType};base64,${buffer.toString("base64")}`;
    } catch (err) {
      console.warn(`Failed to inline asset ${assetPath}:`, err.message);
      return null;
    }
  }

  getPlaywrightFontBase64(filename) {
    const cacheKey = `font:${filename}`;
    const cachedFont = cache.get(cacheKey);
    if (cachedFont) {
      return cachedFont;
    }

    const fontPath = path.join(__dirname, "..", "..", "assets", "fonts", "Baloo2", filename);
    if (!fs.existsSync(fontPath)) return null;

    const fontBuffer = fs.readFileSync(fontPath);
    const base64Font = `data:font/truetype;base64,${fontBuffer.toString("base64")}`;
    cache.set(cacheKey, base64Font, 86400000);
    return base64Font;
  }

  async generateBolaImageWithPlaywright(draws, roundNumber, templatePath) {
    const html = fs.readFileSync(templatePath, "utf8");
    const fonts = {
      medium: this.getPlaywrightFontBase64("Baloo2-Medium.ttf"),
      semibold: this.getPlaywrightFontBase64("Baloo2-SemiBold.ttf"),
      bold: this.getPlaywrightFontBase64("Baloo2-Bold.ttf"),
      extrabold: this.getPlaywrightFontBase64("Baloo2-ExtraBold.ttf"),
    };

    let htmlWithBase64Fonts = html;
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(/{{BALO2_MEDIUM}}/g, fonts.medium || "");
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(/{{BALO2_SEMIBOLD}}/g, fonts.semibold || "");
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(/{{BALO2_BOLD}}/g, fonts.bold || "");
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(/{{BALO2_EXTRABOLD}}/g, fonts.extrabold || "");

    // Pick a random cloud asset if multiple exist (cloud.png, cloud1.png, cloud2.png)
    const cloudCandidates = ['cloud.png', 'cloud1.png', 'cloud2.png'];
    const existingClouds = cloudCandidates.filter((f) => fs.existsSync(path.join(__dirname, "..", "..", "assets", "themes", "default", f)));
    const chosenCloud = (existingClouds.length ? existingClouds[Math.floor(Math.random() * existingClouds.length)] : 'cloud.png');
    const cloudSrc = this.getBase64Asset(path.join(__dirname, "..", "..", "assets", "themes", "default", chosenCloud), "image/png");
    const dropletSrc = this.getBase64Asset(path.join(__dirname, "..", "..", "assets", "themes", "default", "droplet.png"), "image/png");

    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");

    const itemsMarkup = draws.map(([cat, val]) => {
      const category = escapeHtml(cat || "");
      const value = escapeHtml(String(val || ""));
      // remove duplicate small label and only show inside the badge plus the main value
      return `<div class="item"><div class="badge">${category}</div><div class="text-group"><div class="value">${value}</div></div></div>`;
    }).join("");

    // Compute expected canvas dimensions to match the napi-rs canvas output
    // Use the same layout constants as the canvas renderer so Playwright output matches
    const PAD_X = 16;
    const PAD_Y = 12;
    const GAP = 16;
    const BADGE = 60;
    const FONT = 28;
    const rowH = PAD_Y * 2 + BADGE;
    const maxTextW = Math.max(...draws.map(([, val]) => String(val).length * FONT * 0.62));
    const cardW = PAD_X * 2 + BADGE + GAP + maxTextW + 20;
    const outerPad = 12;
    const topBottomPad = 20;
    const W = cardW + outerPad * 2;
    const H = rowH * draws.length + outerPad * 2 + topBottomPad * 2;

    // Inject CSS to force the .card element to the same pixel dimensions and keep overflow visible
    const sizeOverrideStyle = `<style>
      html, body { margin: 0; padding: 0; }
      body { min-height: ${H}px; display: flex; justify-content: center; align-items: flex-start; }
      .card { width: ${W}px !important; height: ${H}px !important; min-width: ${W}px !important; min-height: ${H}px !important; box-sizing: border-box; overflow: visible !important; }
      .card img.cloud { top: -120px !important; }
    </style>`;

    const filled = htmlWithBase64Fonts
      .replace(/{{CLOUD_SRC}}/g, cloudSrc || "")
      .replace(/{{DROPLET_SRC}}/g, dropletSrc || "")
      .replace(/{{ROUND}}/g, String(roundNumber))
      .replace(/{{ITEMS}}/g, itemsMarkup);

    const page = await this.ensurePlaywrightPage();
    const filledWithStyle = filled.replace(/<head>/i, `<head>${sizeOverrideStyle}`);
    await page.setContent(filledWithStyle, { waitUntil: "networkidle" });

    try {
      await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => {
        if (img.complete) return Promise.resolve(true);
        return new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); });
      })));
    } catch (imgWaitErr) {
      console.warn("Image load wait error:", imgWaitErr && imgWaitErr.message);
    }

    // Ensure viewport is at least as large as the computed W/H so the card renders full-size
    await page.setViewportSize({ width: Math.max(W, 760), height: Math.max(H + 60, 760) });

    const cardHandle = await page.$('.card');
    if (cardHandle) {
      const buffer = await cardHandle.screenshot({ type: 'png' });
      await cardHandle.dispose();
      return buffer;
    }

    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight || document.body.scrollHeight);
    await page.setViewportSize({ width: Math.max(W, 760), height: Math.min(pageHeight + 60, 2600) });
    return page.screenshot({ type: 'png', fullPage: true });
  }

  async generateGameSummaryImageWithPlaywright(summary, templatePath) {
    // Load HTML template
    const html = fs.readFileSync(templatePath, "utf8");
    
    // Convert fonts to base64 and embed directly in CSS
    const fontsDir = path.join(__dirname, "..", "..", "assets", "fonts", "Baloo2");
    
    const fontToBase64 = (filename) => {
      const fontPath = path.join(fontsDir, filename);
      if (fs.existsSync(fontPath)) {
        const fontBuffer = fs.readFileSync(fontPath);
        return `data:font/truetype;base64,${fontBuffer.toString('base64')}`;
      }
      return null;
    };
    
    const fonts = {
      medium: fontToBase64('Baloo2-Medium.ttf'),
      semibold: fontToBase64('Baloo2-SemiBold.ttf'),
      bold: fontToBase64('Baloo2-Bold.ttf'),
      extrabold: fontToBase64('Baloo2-ExtraBold.ttf'),
    };
    
    // Replace font URLs with base64 data URLs
    let htmlWithBase64Fonts = html;
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Medium\.ttf'\)/g,
      `url('${fonts.medium}')`
    );
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-SemiBold\.ttf'\)/g,
      `url('${fonts.semibold}')`
    );
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Bold\.ttf'\)/g,
      `url('${fonts.bold}')`
    );
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-ExtraBold\.ttf'\)/g,
      `url('${fonts.extrabold}')`
    );
    
    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");

    // Normalize text to plain ASCII by removing special Unicode font characters
    const normalizeToPlainText = (text) => {
      if (!text) return text;
      return String(text)
        // Mathematical alphanumeric symbols (bold, italic, script, etc.)
        .replace(/[\u{1D400}-\u{1D7FF}]/gu, (char) => {
          const code = char.codePointAt(0);
          // Map mathematical alphanumeric to basic Latin
          if (code >= 0x1D400 && code <= 0x1D419) return String.fromCharCode(code - 0x1D400 + 0x41); // Bold capital
          if (code >= 0x1D41A && code <= 0x1D433) return String.fromCharCode(code - 0x1D41A + 0x61); // Bold small
          if (code >= 0x1D434 && code <= 0x1D44D) return String.fromCharCode(code - 0x1D434 + 0x41); // Italic capital
          if (code >= 0x1D44E && code <= 0x1D467) return String.fromCharCode(code - 0x1D44E + 0x61); // Italic small
          if (code >= 0x1D468 && code <= 0x1D481) return String.fromCharCode(code - 0x1D468 + 0x41); // Bold italic capital
          if (code >= 0x1D482 && code <= 0x1D49B) return String.fromCharCode(code - 0x1D482 + 0x61); // Bold italic small
          if (code >= 0x1D49C && code <= 0x1D4B5) return String.fromCharCode(code - 0x1D49C + 0x41); // Script capital
          if (code >= 0x1D4B6 && code <= 0x1D4CF) return String.fromCharCode(code - 0x1D4B6 + 0x61); // Script small
          if (code >= 0x1D4D0 && code <= 0x1D4E9) return String.fromCharCode(code - 0x1D4D0 + 0x41); // Bold script capital
          if (code >= 0x1D4EA && code <= 0x1D503) return String.fromCharCode(code - 0x1D4EA + 0x61); // Bold script small
          if (code >= 0x1D504 && code <= 0x1D51D) return String.fromCharCode(code - 0x1D504 + 0x41); // Fraktur capital
          if (code >= 0x1D51E && code <= 0x1D537) return String.fromCharCode(code - 0x1D51E + 0x61); // Fraktur small
          if (code >= 0x1D538 && code <= 0x1D551) return String.fromCharCode(code - 0x1D538 + 0x41); // Bold fraktur capital
          if (code >= 0x1D552 && code <= 0x1D56B) return String.fromCharCode(code - 0x1D552 + 0x61); // Bold fraktur small
          if (code >= 0x1D56C && code <= 0x1D585) return String.fromCharCode(code - 0x1D56C + 0x41); // Double-struck capital
          if (code >= 0x1D586 && code <= 0x1D59F) return String.fromCharCode(code - 0x1D586 + 0x61); // Double-struck small
          if (code >= 0x1D5A0 && code <= 0x1D5B9) return String.fromCharCode(code - 0x1D5A0 + 0x41); // Sans-serif capital
          if (code >= 0x1D5BA && code <= 0x1D5D3) return String.fromCharCode(code - 0x1D5BA + 0x61); // Sans-serif small
          if (code >= 0x1D5D4 && code <= 0x1D5ED) return String.fromCharCode(code - 0x1D5D4 + 0x41); // Bold sans-serif capital
          if (code >= 0x1D5EE && code <= 0x1D607) return String.fromCharCode(code - 0x1D5EE + 0x61); // Bold sans-serif small
          if (code >= 0x1D608 && code <= 0x1D621) return String.fromCharCode(code - 0x1D608 + 0x41); // Italic sans-serif capital
          if (code >= 0x1D622 && code <= 0x1D63B) return String.fromCharCode(code - 0x1D622 + 0x61); // Italic sans-serif small
          if (code >= 0x1D63C && code <= 0x1D655) return String.fromCharCode(code - 0x1D63C + 0x41); // Monospace capital
          if (code >= 0x1D656 && code <= 0x1D66F) return String.fromCharCode(code - 0x1D656 + 0x61); // Monospace small
          if (code >= 0x1D670 && code <= 0x1D689) return String.fromCharCode(code - 0x1D670 + 0x30); // Monospace digits
          return char;
        })
        // Fullwidth characters
        .replace(/[\u{FF01}-\u{FF5E}]/gu, (char) => {
          const code = char.codePointAt(0);
          if (code >= 0xFF01 && code <= 0xFF5E) {
            return String.fromCharCode(code - 0xFF01 + 0x21);
          }
          return char;
        })
        // Circled letters and numbers
        .replace(/[\u{2460}-\u{24FF}]/gu, '')
        // Enclosed alphanumerics
        .replace(/[\u{24B6}-\u{24E9}]/gu, (char) => {
          const code = char.codePointAt(0);
          if (code >= 0x24B6 && code <= 0x24CF) return String.fromCharCode(code - 0x24B6 + 0x41); // Circled capital
          if (code >= 0x24D0 && code <= 0x24E9) return String.fromCharCode(code - 0x24D0 + 0x61); // Circled small
          return char;
        })
        // Other decorative characters
        .replace(/[\u{2600}-\u{26FF}]/gu, '') // Symbols
        .replace(/[\u{2700}-\u{27BF}]/gu, '') // Dingbats
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, ''); // Emojis
    };

    const winners = summary.winners || [];
    if (process.env.DEBUG || process.env.NODE_ENV !== "production") {
      console.log("[GameSummary] winners payload:", JSON.stringify(winners, null, 2));
    }

    const groupedWinners = winners.reduce((acc, winner) => {
      const patternName = String(winner.patternName || "Pattern").trim();
      const normalizedPattern = patternName.toLowerCase();
      if (!acc[normalizedPattern]) {
        acc[normalizedPattern] = {
          patternName,
          prizeAmount: winner.prizeAmount || 0,
          players: new Set(),
          entries: [],
        };
      }
      const rawPlayerName = String(winner.playerName || winner.first_name || winner.username || "").trim();
      const playerName = normalizeToPlainText(rawPlayerName) || "Player";
      acc[normalizedPattern].players.add(playerName);
      const photoUrl = winner._inlinedProfilePhoto || winner.profilePhotoUrl || winner.photoUrl || null;
      acc[normalizedPattern].entries.push({ playerName, photoUrl, prizeAmount: winner.prizeAmount || 0 });
      return acc;
    }, {});

    if (process.env.DEBUG || process.env.NODE_ENV !== "production") {
      console.log("[GameSummary] grouped winners:", JSON.stringify(groupedWinners, null, 2));
    }

    const winnerGroups = Object.values(groupedWinners).map((group) => {
      const playerCount = group.entries.length;
      // prizeAmount is already the individual prize per winner (from settlement), don't divide again
      const prizePerWinner = playerCount > 0 ? Math.floor(group.prizeAmount) : 0;
      return {
        ...group,
        players: Array.from(group.players),
        prizePerWinner,
      };
    });
    const winnersMarkup = winnerGroups.length > 0
      ? winnerGroups.slice(0, 8).map((group) => {
          const playerNames = group.players.join(" / ");
          const avatarEntries = group.entries.slice(0, 4);
          const makeAvatar = (entry, index) => {
            const initials = String(entry.playerName || "")
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() || "")
              .join("");
            const backgroundColors = ["#E1613F", "#3F8CE1", "#43A67D", "#9C58D6", "#D76A2C"];
            const color = backgroundColors[index % backgroundColors.length];
            if (entry.photoUrl) {
              return `<div class="circle" style="background:transparent;"><img class="circle-img" src="${escapeHtml(entry.photoUrl)}" alt="${escapeHtml(entry.playerName)}" /></div>`;
            }
            if (initials) {
              return `<div class="circle" style="background:${color};">${escapeHtml(initials)}</div>`;
            }
            return `<div class="circle empty" style="background:${color};"></div>`;
          };

          let avatarMarkup = "";
          if (avatarEntries.length > 1) {
            avatarMarkup = `<span class="stack">${avatarEntries.map(makeAvatar).join("")}</span>`;
          } else {
            avatarMarkup = makeAvatar(avatarEntries[0] || { playerName: "", photoUrl: null }, 0);
          }

          return `
              <div class="winner-row">
                <div class="left">
                  <span class="pattern">${avatarMarkup}</span>
                  <span class="player-name">${escapeHtml(playerNames)}</span>
                  <span style="color:var(--label);"> - </span>
                  <span class="amount">₱${escapeHtml(group.prizePerWinner || 0)}</span>
                </div>
                <div class="right">Pattern : ${escapeHtml(String(group.patternName).toUpperCase())}</div>
              </div>`;
        }).join("")
      : '<div class="empty">No winners registered yet.</div>';

    const brandName = normalizeToPlainText(summary.groupName || "BINGAGO!").toUpperCase();
    const filled = htmlWithBase64Fonts
      .replace(/BINGAGO!/g, brandName)
      .replace(/\{\{PLAYERS\}\}/g, escapeHtml(summary.players || 0))
      .replace(/\{\{BET_PER_PLAYER\}\}/g, escapeHtml(`₱${summary.betPerPlayer || 0}`))
      .replace(/\{\{TOTAL_POT\}\}/g, escapeHtml(`₱${summary.totalPot || 0}`))
      .replace(/\{\{WINNING_PATTERNS\}\}/g, escapeHtml(summary.patterns || 0))
      .replace(/\{\{PRIZE_PER_PATTERN\}\}/g, escapeHtml(`₱${summary.prizePerPattern || 0}`))
      .replace(/\{\{BALLS_DRAWN\}\}/g, escapeHtml(`${summary.ballsDrawn || 0} / ${summary.totalBalls || 75}`))
      .replace(/\{\{DURATION\}\}/g, escapeHtml(summary.duration || "—"))
      .replace(/\{\{WINNERS\}\}/g, winnersMarkup);

    const page = await this.ensurePlaywrightPage();
    await page.setContent(filled, { waitUntil: "networkidle" });

    // Ensure external images are fully loaded (some servers may be slower in CI/VM)
    try {
      await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => {
        if (img.complete) return Promise.resolve(true);
        return new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); });
      })));
    } catch (imgWaitErr) {
      // continue - we'll log statuses below
      console.warn("Image load wait error:", imgWaitErr && imgWaitErr.message);
    }

    // Log image load status for debugging
    try {
      const imgStatus = await page.evaluate(() => Array.from(document.images).map(img => ({ src: img.src, complete: img.complete, naturalWidth: img.naturalWidth })));
      if (process.env.DEBUG || process.env.NODE_ENV !== "production") {
        console.log("[GameSummary] image statuses:", JSON.stringify(imgStatus, null, 2));
      }
    } catch (statusErr) {
      console.warn("Failed to read image statuses:", statusErr && statusErr.message);
    }

    // Prefer capturing only the `.card` element to avoid extra page padding below the card
    try {
      const cardHandle = await page.$('.card');
      if (cardHandle) {
        const cardBuffer = await cardHandle.screenshot({ type: 'png' });
        await cardHandle.dispose();
        return cardBuffer;
      }
    } catch (cardErr) {
      console.warn('Failed to screenshot .card element, falling back to full page:', cardErr && cardErr.message);
    }

    const contentHeight = await page.evaluate(() => {
      const body = document.body;
      return Math.max(body.scrollHeight, body.offsetHeight, 760);
    });

    await page.setViewportSize({ width: 720, height: Math.min(contentHeight + 120, 2200) });
    return await page.screenshot({ type: "png", fullPage: true });
  }

  generateNoItemsSummaryImage() {
    const width = 600;
    const height = 200;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#FFFFFF";
    ctx.font = getCanvasFont(24, "Nunito", "bold");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No Balls Have Been Drawn", width / 2, height / 2);

    return canvas.toBuffer("image/png");
  }

  async generateLeaderboardImage(stats, groupName) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "stats.html");
    
    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generateLeaderboardImageWithPlaywright(stats, groupName, templatePath);
      } catch (error) {
        console.warn("Playwright leaderboard render failed, falling back to canvas:", error.message);
      }
    }

    // Fallback to canvas rendering
    return this.generateLeaderboardImageCanvas(stats, groupName);
  }

  async generateLeaderboardImageWithPlaywright(stats, groupName, templatePath) {
    const html = fs.readFileSync(templatePath, "utf8");
    
    // Convert fonts to base64 and embed directly in CSS
    const fontsDir = path.join(__dirname, "..", "..", "assets", "fonts", "Baloo2");
    console.log("[Leaderboard] Fonts directory:", fontsDir);
    console.log("[Leaderboard] Fonts exist?", fs.existsSync(fontsDir));
    
    const fontToBase64 = (filename) => {
      const cacheKey = `font:${filename}`;
      const cachedFont = cache.get(cacheKey);
      if (cachedFont) {
        return cachedFont;
      }

      const fontPath = path.join(fontsDir, filename);
      if (fs.existsSync(fontPath)) {
        const fontBuffer = fs.readFileSync(fontPath);
        const base64Font = `data:font/truetype;base64,${fontBuffer.toString('base64')}`;
        // Cache permanently (fonts never change)
        cache.set(cacheKey, base64Font, 86400000); // 24 hours
        return base64Font;
      }
      return null;
    };
    
    const fonts = {
      regular: fontToBase64('Baloo2-Regular.ttf'),
      medium: fontToBase64('Baloo2-Medium.ttf'),
      semibold: fontToBase64('Baloo2-SemiBold.ttf'),
      bold: fontToBase64('Baloo2-Bold.ttf'),
    };
    
    // Replace font URLs with base64 data URLs
    let htmlWithBase64Fonts = html;
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Regular\.ttf'\)/g,
      `url('${fonts.regular}')`
    );
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Medium\.ttf'\)/g,
      `url('${fonts.medium}')`
    );
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-SemiBold\.ttf'\)/g,
      `url('${fonts.semibold}')`
    );
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Bold\.ttf'\)/g,
      `url('${fonts.bold}')`
    );
    
    console.log("[Leaderboard] Fonts converted to base64");
    
    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");

    // Inline profile photos in parallel with caching, but fall back to the original URL
    // if the fetch fails so the rendering can continue without noisy warnings.
    const photoPromises = stats.map(async (player) => {
      const photoUrl = player.profilePhotoUrl;
      if (!photoUrl) return;

      const normalizedPhotoUrl = /^data:/i.test(photoUrl) || /^https?:\/\//i.test(photoUrl)
        ? photoUrl
        : null;

      if (!normalizedPhotoUrl) return;

      // Check cache first
      const cacheKey = `photo:${normalizedPhotoUrl}`;
      const cachedPhoto = cache.get(cacheKey);
      if (cachedPhoto) {
        player._inlinedProfilePhoto = cachedPhoto;
        return;
      }

      // Fetch and cache
      try {
        const res = await fetch(normalizedPhotoUrl);
        if (res && res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const ct = res.headers.get("content-type") || "image/jpeg";
          const base64Photo = `data:${ct};base64,${buf.toString("base64")}`;
          player._inlinedProfilePhoto = base64Photo;
          // Cache for 1 hour
          cache.set(cacheKey, base64Photo, 3600000);
        } else {
          player._inlinedProfilePhoto = null;
        }
      } catch (e) {
        player._inlinedProfilePhoto = null;
      }
    });
    await Promise.all(photoPromises);

    // Inline trophy image as base64
    const trophyImgDir = path.join(__dirname, "..", "..", "assets", "images");
    const trophyBase64 = fs.existsSync(path.join(trophyImgDir, "trophy.png"))
      ? `data:image/png;base64,${fs.readFileSync(path.join(trophyImgDir, "trophy.png")).toString("base64")}`
      : null;

    // Inline badge images as base64
    const badgeDir = path.join(__dirname, "..", "..", "assets", "game-summary-template", "badge");
    const badgeFirstBase64 = fs.existsSync(path.join(badgeDir, "first.png"))
      ? `data:image/png;base64,${fs.readFileSync(path.join(badgeDir, "first.png")).toString("base64")}`
      : null;
    const badgeSecondBase64 = fs.existsSync(path.join(badgeDir, "second.png"))
      ? `data:image/png;base64,${fs.readFileSync(path.join(badgeDir, "second.png")).toString("base64")}`
      : null;
    const badgeThirdBase64 = fs.existsSync(path.join(badgeDir, "third.png"))
      ? `data:image/png;base64,${fs.readFileSync(path.join(badgeDir, "third.png")).toString("base64")}`
      : null;

    const tgSvg = `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M21.5 3.5 2.7 10.9c-1.1.45-1.1 1.1-.2 1.38l4.8 1.5 1.85 5.65c.22.6.37.85.76.85.3 0 .43-.14.6-.3l2.6-2.47 4.9 3.6c.9.5 1.55.24 1.78-.83l3.2-15.1c.32-1.3-.5-1.9-1.5-1.5z"/>
    </svg>`;

    // Replace trophy image src with base64 version in HTML
    if (trophyBase64) {
      htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
        /src="\.\.\/\.\.\/images\/trophy\.png"/g,
        `src="${trophyBase64}"`
      );
    }

    const birthdayBackground = this.getBirthdayBackgroundBase64();

    const playersData = stats.map((p, i) => {
      const wins = parseInt(p.wins) || 0;
      const losses = parseInt(p.losses) || 0;
      const games = wins + losses;
      const rank = i + 1;
      const isTopThree = rank <= 3;
      const isCelebration = p.is_celebration && typeof p.is_celebration === 'string' && p.is_celebration.trim().length > 0 && p.is_celebration.trim() !== 'false';
      const celebrationBadge = isCelebration ? ` ${p.is_celebration}` : '';
      const celebrationClass = isCelebration ? ' birthday' : '';
      const celebrationStyle = isCelebration && birthdayBackground
        ? `style="background-image:url('${birthdayBackground}');background-position:center center;background-size:cover;background-repeat:no-repeat;"`
        : '';
      
      // Use correct badge for each rank position (1st, 2nd, 3rd)
      let badgeStyle = "";
      if (rank === 1 && badgeFirstBase64) {
        badgeStyle = `background-image:url('${badgeFirstBase64}')`;
      } else if (rank === 2 && badgeSecondBase64) {
        badgeStyle = `background-image:url('${badgeSecondBase64}')`;
      } else if (rank === 3 && badgeThirdBase64) {
        badgeStyle = `background-image:url('${badgeThirdBase64}')`;
      }

      const cleanName = (name) => {
        if (!name || typeof name !== 'string') return null;
        // Trim and remove invisible/whitespace characters
        const trimmed = name.trim();
        // Check if it's not empty after trimming
        if (trimmed.length === 0) return null;
        return trimmed;
      };

      const displayName = cleanName(p.first_name) || cleanName(p.username) || `User ${p.rank}`;
      const photoUrl = p._inlinedProfilePhoto || null;
      
      // Generate random warm unsaturated color for avatar background
      const getRandomColor = () => {
        const colors = ['#D99A70', '#E0AF74', '#D18F7F', '#C1A78D', '#D8B86E', '#D7A78C', '#E3C28A'];
        return colors[Math.floor(Math.random() * colors.length)];
      };
      
      const avatarColor = getRandomColor();
      
      // Build badge class name for styling (second place gets "second" class, third place gets "third" class)
      let badgeClass = 'badge';
      if (rank === 2) {
        badgeClass = 'badge second';
      } else if (rank === 3) {
        badgeClass = 'badge third';
      }
      
      // Show profile photo if available, otherwise show a warm color-only circle
      const avatarHtml = photoUrl
        ? `<div class="icon-wrapper"><div class="tg-icon" style="background:transparent;"><img src="${escapeHtml(photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="${escapeHtml(displayName)}" />${badgeStyle ? `<div class="${badgeClass}" style="${badgeStyle}"></div>` : ''}</div></div>`
        : `<div class="icon-wrapper"><div class="tg-icon" style="background:${avatarColor};width:100%;height:100%;border-radius:50%;"></div>${badgeStyle ? `<div class="${badgeClass}" style="${badgeStyle}"></div>` : ''}</div>`;

      // Rank number - hidden for top 3 (badge shows rank instead)
      const rankHtml = `<span class="rank">${isTopThree ? '' : rank}</span>`;

      return {
        rankHtml,
        avatarHtml,
        name: displayName,
        celebrationBadge,
        celebrationClass,
        celebrationStyle,
        wins: wins,
        losses: losses,
        games: games,
        gt: parseInt(p.games_per_day) || 0,
        streak: p.streak || 0,
        isTopThree
      };
    });

    const rowsHtml = playersData.map(p => {
      const streak = p.streak || 0;
      const streakClass = streak > 0 ? 'win' : (streak < 0 ? 'loss' : 'games');
      const streakDisplay = streak > 0 ? `+${streak}` : String(streak);
      
      return `
      <div class="row${p.isTopThree ? ' top-three' : ''}${p.celebrationClass}" ${p.celebrationStyle}>
        ${p.rankHtml}
        <div class="player-col">
          ${p.avatarHtml}
          <div class="name">${escapeHtml(p.name)}${p.celebrationBadge}</div>
        </div>
        <span class="stat win">${p.wins}</span>
        <span class="stat games">${p.games}</span>
        <span class="stat gt">${p.gt}</span>
        <span class="stat ${streakClass}">${streakDisplay}</span>
      </div>
    `;
    }).join("");

    const filled = htmlWithBase64Fonts.replace(/\{\{ROWS\}\}/g, rowsHtml);

    const page = await this.ensurePlaywrightPage();
    await page.setContent(filled, { waitUntil: "networkidle" });

    // Wait for fonts to load
    try {
      await page.evaluate(() => document.fonts.ready);
      // Debug: check loaded fonts
      const loadedFonts = await page.evaluate(() => {
        return Array.from(document.fonts).map(f => f.family);
      });
      console.log("[Leaderboard] Loaded fonts:", loadedFonts);
    } catch (fontErr) {
      console.warn("Font load wait error:", fontErr && fontErr.message);
    }

    // Wait for images to load
    try {
      await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => {
        if (img.complete) return Promise.resolve(true);
        return new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); });
      })));
    } catch (imgWaitErr) {
      console.warn("Image load wait error:", imgWaitErr && imgWaitErr.message);
    }

    // Calculate content height and set a slightly larger viewport for better image fidelity
    const contentHeight = await page.evaluate(() => {
      const body = document.body;
      return Math.max(body.scrollHeight, body.offsetHeight, 760);
    });

    const scaledHeight = Math.ceil(contentHeight * 1.25) + 80;
    await page.setViewportSize({ width: 960, height: scaledHeight });

    // Screenshot the card element at the rendered device scale factor
    try {
      const cardHandle = await page.$('.card');
      if (cardHandle) {
        const cardBuffer = await cardHandle.screenshot({ type: 'png' });
        await cardHandle.dispose();
        return cardBuffer;
      }
    } catch (cardErr) {
      console.warn('Failed to screenshot .card element, falling back to full page:', cardErr && cardErr.message);
    }

    return await page.screenshot({ type: 'png', fullPage: true });
  }

  generateLeaderboardImageCanvas(stats, groupName, extraData = {}) {
    const COLORS = {
      cream: "#FBF3E3",
      card: "#FFFDF8",
      red: "#E4583C",
      gold: "#C99A3A",
      ink: "#3A3229",
      gray: "#9A9082",
      line: "#DECDA0",
      rowAlt: "#F6EDD9",
      winGreen: "#3E8E5A"
    };

    const subtitle = extraData.subtitle ? String(extraData.subtitle).trim() : "";
    const width = 480;
    const height = 520 + stats.length * 50 + (subtitle ? 20 : 0);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(0, 0, width, height);

    // Header
    ctx.fillStyle = COLORS.ink;
    ctx.font = getCanvasFont(38, "Fredoka One", "bold");
    ctx.textAlign = "center";
    ctx.fillText("LEADERBOARD", width / 2, 60);

    if (subtitle) {
      ctx.fillStyle = COLORS.gray;
      ctx.font = getCanvasFont(12, "Nunito", "normal");
      ctx.fillText(subtitle, width / 2, 90);
    }

    ctx.fillStyle = COLORS.gold;
    ctx.font = getCanvasFont(14, "Nunito", "bold");
    ctx.fillText("TOP PLAYERS", width / 2, subtitle ? 115 : 95);

    const dividerY = subtitle ? 130 : 110;
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(22, dividerY);
    ctx.lineTo(width - 22, dividerY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Column labels
    ctx.fillStyle = COLORS.gray;
    ctx.font = getCanvasFont(11, "Nunito", "bold");
    ctx.textAlign = "left";
    ctx.fillText("PLAYER", 30, 125);
    ctx.textAlign = "center";
    ctx.fillText("W", width - 130, 125);
    ctx.fillText("STRK", width - 95, 125);
    ctx.fillText("G", width - 60, 125);

    // Player rows
    const medals = ["🥇", "🥈", "🥉"];
    stats.forEach((player, index) => {
      const y = 150 + index * 50;
      const rank = index + 1;

      // Row background
      if (index % 2 === 1) {
        ctx.fillStyle = COLORS.rowAlt;
        ctx.fillRect(10, y - 35, width - 20, 45);
      }

      // Rank
      ctx.fillStyle = COLORS.gold;
      ctx.font = getCanvasFont(16, "Fredoka One", "bold");
      ctx.textAlign = "center";
      const rankText = rank <= 3 ? medals[rank - 1] : String(rank);
      ctx.fillText(rankText, 30, y - 10);

      // Player name
      ctx.fillStyle = COLORS.ink;
      ctx.font = getCanvasFont(14.5, "Nunito", "bold");
      ctx.textAlign = "left";
      const displayName = player.first_name || player.username || "Player";
      const photoUrl = player.profilePhotoUrl || null;
      
      // Generate initials from name (first letter only)
      const getInitials = (name) => {
        if (!name) return "?";
        return name.charAt(0).toUpperCase();
      };
      
      const initials = getInitials(displayName);
      
      // Generate random color for avatar background
      const getRandomColor = () => {
        const colors = ['#E4583C', '#C99A3A', '#3E8E5A', '#2AABEE', '#9B59B6', '#E91E63', '#009688', '#FF9800'];
        return colors[Math.floor(Math.random() * colors.length)];
      };
      
      const avatarColor = getRandomColor();
      
      // Draw avatar circle with initials (canvas fallback doesn't support photo loading easily)
      const avatarX = 60;
      const avatarY = y - 10;
      const avatarRadius = 16;
      
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
      ctx.fillStyle = avatarColor;
      ctx.fill();
      
      ctx.fillStyle = "white";
      ctx.font = getCanvasFont(12, "Nunito", "bold");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials, avatarX, avatarY);
      
      // Draw name next to avatar using mixed-font fallback for special unicode
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      drawMixedText(ctx, displayName.substring(0, 20), avatarX + avatarRadius + 12, y - 10, 14.5, 'bold');

      // Stats
      ctx.textAlign = "center";
      ctx.font = getCanvasFont(16, "Fredoka One", "bold");
      
      ctx.fillStyle = "#3E8E5A";
      ctx.fillText(String(player.wins), width - 130, y - 10);
      
      // Streak - green for positive, red for negative
      const streak = player.streak || 0;
      ctx.fillStyle = streak > 0 ? "#3E8E5A" : (streak < 0 ? COLORS.red : COLORS.gray);
      ctx.fillText(streak > 0 ? `+${streak}` : String(streak), width - 95, y - 10);

      // Games
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(String(player.wins + player.losses), width - 60, y - 10);
    });

    return canvas.toBuffer("image/png");
  }

  async generateLeaderboardImageV2(stats, groupName, startRank = 1) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "statsv2.html");
    
    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generateLeaderboardImageV2WithPlaywright(stats, groupName, templatePath, startRank);
      } catch (error) {
        console.warn("Playwright leaderboard v2 render failed, falling back to canvas:", error.message);
      }
    }

    // Fallback to canvas rendering
    return this.generateLeaderboardImageV2Canvas(stats, groupName, startRank);
  }

  async generateLeaderboardImageV2WithPlaywright(stats, groupName, templatePath, startRank = 1) {
    const html = fs.readFileSync(templatePath, "utf8");
    
    // Convert fonts to base64 and embed directly in CSS
    const fontsDir = path.join(__dirname, "..", "..", "assets", "fonts", "Baloo2");
    
    const fontToBase64 = (filename) => {
      const cacheKey = `font:${filename}`;
      const cachedFont = cache.get(cacheKey);
      if (cachedFont) {
        return cachedFont;
      }

      const fontPath = path.join(fontsDir, filename);
      if (fs.existsSync(fontPath)) {
        const fontBuffer = fs.readFileSync(fontPath);
        const base64Font = `data:font/truetype;base64,${fontBuffer.toString('base64')}`;
        // Cache permanently (fonts never change)
        cache.set(cacheKey, base64Font, 86400000); // 24 hours
        return base64Font;
      }
      return null;
    };
    
    const fonts = {
      medium: fontToBase64('Baloo2-Medium.ttf'),
      semibold: fontToBase64('Baloo2-SemiBold.ttf'),
      bold: fontToBase64('Baloo2-Bold.ttf'),
    };
    
    // Replace font URLs with base64 data URLs
    let htmlWithBase64Fonts = html;
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Medium\.ttf'\)/g,
      `url('${fonts.medium}')`
    );
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-SemiBold\.ttf'\)/g,
      `url('${fonts.semibold}')`
    );
    htmlWithBase64Fonts = htmlWithBase64Fonts.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Bold\.ttf'\)/g,
      `url('${fonts.bold}')`
    );
    
    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");

    // Inline profile photos in parallel with caching, but fall back gracefully
    // when the remote URL cannot be fetched so rendering still succeeds.
    const photoPromises = stats.map(async (player) => {
      const photoUrl = player.profilePhotoUrl;
      if (!photoUrl) return;

      const normalizedPhotoUrl = /^data:/i.test(photoUrl) || /^https?:\/\//i.test(photoUrl)
        ? photoUrl
        : null;

      if (!normalizedPhotoUrl) return;

      const cacheKey = `photo:${normalizedPhotoUrl}`;
      const cachedPhoto = cache.get(cacheKey);
      if (cachedPhoto) {
        player._inlinedProfilePhoto = cachedPhoto;
        return;
      }

      try {
        const res = await fetch(normalizedPhotoUrl);
        if (res && res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const ct = res.headers.get("content-type") || "image/jpeg";
          const base64Photo = `data:${ct};base64,${buf.toString("base64")}`;
          player._inlinedProfilePhoto = base64Photo;
          cache.set(cacheKey, base64Photo, 3600000);
        } else {
          player._inlinedProfilePhoto = null;
        }
      } catch (e) {
        player._inlinedProfilePhoto = null;
      }
    });
    await Promise.all(photoPromises);

    const birthdayBackground = this.getBirthdayBackgroundBase64();

    const playersData = stats.map((p, i) => {
      const wins = parseInt(p.wins) || 0;
      const losses = parseInt(p.losses) || 0;
      const games = wins + losses;
      const gt = parseInt(p.games_per_day) || 0;
      const rank = startRank + i;
      const isCelebration = p.is_celebration && typeof p.is_celebration === 'string' && p.is_celebration.trim().length > 0 && p.is_celebration.trim() !== 'false';
      const celebrationBadge = isCelebration ? ` ${p.is_celebration}` : '';
      const celebrationClass = isCelebration ? ' birthday' : '';
      const celebrationStyle = isCelebration && birthdayBackground
        ? `style="background-image:url('${birthdayBackground}');background-position:center center;background-size:cover;background-repeat:no-repeat;"`
        : '';
      
      const cleanName = (name) => {
        if (!name || typeof name !== 'string') return null;
        // Trim and remove invisible/whitespace characters
        const trimmed = name.trim();
        // Check if it's not empty after trimming
        if (trimmed.length === 0) return null;
        return trimmed;
      };

      const displayName = cleanName(p.first_name) || cleanName(p.username) || `User ${p.rank}`;
      const photoUrl = p._inlinedProfilePhoto || null;
      
      // Generate initials from name (first letter only)
      const getInitials = (name) => {
        if (!name) return "?";
        return name.charAt(0).toUpperCase();
      };
      
      const initials = getInitials(displayName);
      
      // Generate random color for avatar background
      const getRandomColor = () => {
        const colors = ['#E4583C', '#C99A3A', '#3E8E5A', '#2AABEE', '#9B59B6', '#E91E63', '#009688', '#FF9800'];
        return colors[Math.floor(Math.random() * colors.length)];
      };
      
      const avatarColor = getRandomColor();
      
      // Show profile photo if available, otherwise show initials with random color
      const avatarHtml = photoUrl
        ? `<div class="player-col"><div style="width:32px;height:32px;border-radius:50%;background:transparent;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-right:12px;"><img src="${escapeHtml(photoUrl)}" style="width:100%;height:100%;object-fit:cover;" alt="${escapeHtml(displayName)}" /></div><div class="name">${escapeHtml(displayName)}${celebrationBadge}</div></div>`
        : `<div class="player-col"><div style="width:32px;height:32px;border-radius:50%;background:${avatarColor};display:flex;align-items:center;justify-content:center;margin-right:12px;color:white;font-weight:bold;font-size:16px;">${initials}</div><div class="name">${escapeHtml(displayName)}${celebrationBadge}</div></div>`;

      return {
        rank,
        avatarHtml,
        celebrationBadge,
        celebrationClass,
        celebrationStyle,
        wins,
        losses,
        games,
        gt,
        streak: p.streak || 0,
      };
    });

    const rowsHtml = playersData.map(p => {
      const streak = p.streak || 0;
      const streakClass = streak > 0 ? 'win' : (streak < 0 ? 'loss' : 'games');
      const streakDisplay = streak > 0 ? `+${streak}` : String(streak);
      
      return `
      <div class="row${p.celebrationClass}" ${p.celebrationStyle}>
        <span class="rank">${p.rank}</span>
        ${p.avatarHtml}
        <span class="stat win">${p.wins}</span>
        <span class="stat games">${p.games}</span>
        <span class="stat gt">${p.gt}</span>
        <span class="stat ${streakClass}">${streakDisplay}</span>
      </div>
    `;
    }).join("");

    const filled = htmlWithBase64Fonts.replace(/\{\{ROWS\}\}/g, rowsHtml);

    const page = await this.ensurePlaywrightPage();
    await page.setContent(filled, { waitUntil: "networkidle" });

    // Wait for fonts to load
    try {
      await page.evaluate(() => document.fonts.ready);
    } catch (fontErr) {
      console.warn("Font load wait error:", fontErr && fontErr.message);
    }

    // Calculate content height
    const contentHeight = await page.evaluate(() => {
      const body = document.body;
      return Math.max(body.scrollHeight, body.offsetHeight, 400);
    });

    await page.setViewportSize({ width: 520, height: contentHeight + 50 });

    // Screenshot the card element
    try {
      const cardHandle = await page.$('.card');
      if (cardHandle) {
        const cardBuffer = await cardHandle.screenshot({ type: 'png' });
        await cardHandle.dispose();
        return cardBuffer;
      }
    } catch (cardErr) {
      console.warn('Failed to screenshot .card element, falling back to full page:', cardErr && cardErr.message);
    }

    return await page.screenshot({ type: "png", fullPage: true });
  }

  generateLeaderboardImageV2Canvas(stats, groupName, startRank = 1) {
    const COLORS = {
      cream: "#FBF3E3",
      card: "#FFFDF8",
      red: "#E4583C",
      gold: "#C99A3A",
      ink: "#3A3229",
      gray: "#9A9082",
      line: "#DECDA0",
      rowAlt: "#F6EDD9",
      winGreen: "#3E8E5A"
    };

    const width = 500;
    const height = 400 + stats.length * 45;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = COLORS.cream;
    ctx.fillRect(0, 0, width, height);

    // Header
    ctx.fillStyle = COLORS.ink;
    ctx.font = getCanvasFont(38, "Fredoka One", "bold");
    ctx.textAlign = "center";
    ctx.fillText("BINGO BOARD", width / 2, 60);

    ctx.fillStyle = COLORS.gold;
    ctx.font = getCanvasFont(14, "Nunito", "bold");
    ctx.fillText("LEADERBOARD", width / 2, 85);

    // Divider
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(22, 100);
    ctx.lineTo(width - 22, 100);
    ctx.stroke();
    ctx.setLineDash([]);

    // Column labels
    ctx.fillStyle = COLORS.gray;
    ctx.font = getCanvasFont(11, "Nunito", "bold");
    ctx.textAlign = "left";
    ctx.fillText("PLAYER", 30, 125);
    ctx.textAlign = "center";
    ctx.fillText("W", width - 130, 125);
    ctx.fillText("STRK", width - 95, 125);
    ctx.fillText("G", width - 60, 125);

    // Player rows
    stats.forEach((player, index) => {
      const y = 150 + index * 45;
      const rank = startRank + index;

      // Row background
      if (index % 2 === 1) {
        ctx.fillStyle = COLORS.rowAlt;
        ctx.fillRect(10, y - 35, width - 20, 40);
      }

      // Rank
      ctx.fillStyle = COLORS.gold;
      ctx.font = getCanvasFont(16, "Fredoka One", "bold");
      ctx.textAlign = "center";
      ctx.fillText(String(rank), 30, y - 10);

      // Player name
      ctx.fillStyle = COLORS.ink;
      ctx.font = getCanvasFont(14.5, "Nunito", "bold");
      ctx.textAlign = "left";
      const displayName = player.first_name || player.username || "Player";
      const photoUrl = player.profilePhotoUrl || null;
      
      // Generate initials from name (first letter only)
      const getInitials = (name) => {
        if (!name) return "?";
        return name.charAt(0).toUpperCase();
      };
      
      const initials = getInitials(displayName);
      
      // Generate random color for avatar background
      const getRandomColor = () => {
        const colors = ['#E4583C', '#C99A3A', '#3E8E5A', '#2AABEE', '#9B59B6', '#E91E63', '#009688', '#FF9800'];
        return colors[Math.floor(Math.random() * colors.length)];
      };
      
      const avatarColor = getRandomColor();
      
      // Draw avatar circle with initials (canvas fallback doesn't support photo loading easily)
      const avatarX = 60;
      const avatarY = y - 10;
      const avatarRadius = 16;
      
      ctx.beginPath();
      ctx.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
      ctx.fillStyle = avatarColor;
      ctx.fill();
      
      ctx.fillStyle = "white";
      ctx.font = getCanvasFont(12, "Nunito", "bold");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials, avatarX, avatarY);
      
      // Draw name next to avatar using mixed-font fallback for special unicode
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      drawMixedText(ctx, displayName.substring(0, 20), avatarX + avatarRadius + 12, y - 10, 14.5, 'bold');

      // Stats
      ctx.textAlign = "center";
      ctx.font = getCanvasFont(16, "Fredoka One", "bold");
      
      ctx.fillStyle = "#3E8E5A";
      ctx.fillText(String(player.wins), width - 130, y - 10);
      
      // Streak - green for positive, red for negative
      const streak = player.streak || 0;
      ctx.fillStyle = streak > 0 ? "#3E8E5A" : (streak < 0 ? COLORS.red : COLORS.gray);
      ctx.fillText(streak > 0 ? `+${streak}` : String(streak), width - 95, y - 10);

      // Games
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(String(player.wins + player.losses), width - 60, y - 10);
    });

    return canvas.toBuffer("image/png");
  }

  async generatePanaloMonthSummaryImage(stats, groupName, monthLabel) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generatePanaloMonthSummaryImageWithPlaywright(stats, groupName, monthLabel, templatePath);
      } catch (error) {
        console.warn("Playwright panalo summary render failed, falling back to leaderboard canvas:", error.message);
      }
    }

    return this.generateLeaderboardImageCanvas((stats || []).slice(0, 3), groupName);
  }

  async generatePanaloJulyMonthSummaryImage(stats, groupName, headerTitle, extraData = {}) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        console.log("Generating July panalo summary with Playwright", {
          templatePath,
          groupName,
          headerTitle,
          subtitle: extraData.subtitle,
          statsCount: (stats || []).length,
        });
        return await this.generatePanaloMonthSummaryImageWithPlaywright(stats, groupName, headerTitle, templatePath, extraData);
      } catch (error) {
        console.warn("Playwright July panalo summary render failed, falling back to leaderboard canvas:", error.message, {
          templatePath,
          subtitle: extraData.subtitle,
          statsCount: (stats || []).length,
          stack: error.stack,
        });
      }
    }

    return this.generateLeaderboardImageCanvas((stats || []).slice(0, 5), groupName, { title: headerTitle, ...extraData });
  }

  async generatePanaloJulyTotalGamesImage(stats, groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july-total-games.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generatePanaloMonthSummaryImageWithPlaywright(stats, groupName, headerTitle, templatePath, { subtitle: 'Wilson score lower bound shows how confident we are in a player’s true win rate.' });
      } catch (error) {
        console.warn("Playwright July total games render failed:", error.message);
      }
    }

    return this.generateLeaderboardImageCanvas((stats || []).slice(0, 3), groupName);
  }

  async generatePanaloJulyLongestStreaksImage(stats, groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july-longest-streaks.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        // Extract month from headerTitle (e.g., "Longest Win Streaks in August 2026" -> "August")
        const monthMatch = headerTitle.match(/in\s+(\w+)\s+\d+$/i);
        const monthName = monthMatch ? monthMatch[1] : "July";
        
        return await this.generatePanaloMonthSummaryImageWithPlaywright(stats, groupName, headerTitle, templatePath, { monthName });
      } catch (error) {
        console.warn("Playwright July longest streaks render failed:", error.message);
      }
    }

    return this.generateLeaderboardImageCanvas((stats || []).slice(0, 3), groupName);
  }

  async generatePanaloJulyMostConfidenceImage(stats, groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july-most-confidence.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generatePanaloMonthSummaryImageWithPlaywright(stats, groupName, headerTitle, templatePath, {
          subtitle: 'Wilson score gives a confident lower estimate of true win rate.',
        });
      } catch (error) {
        console.warn("Playwright July most confidence render failed:", error.message);
      }
    }

    return this.generateLeaderboardImageCanvas((stats || []).slice(0, 3), groupName);
  }

  async generatePanaloJulyGameTimeImage(gameTimeStats, groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july-gametime.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generatePanaloMonthSummaryImageWithPlaywright([], groupName, headerTitle, templatePath, gameTimeStats);
      } catch (error) {
        console.warn("Playwright July game time render failed:", error.message);
      }
    }

    return null;
  }

  async generatePanaloJulyCountImage(counts, groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july-counts.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generatePanaloMonthSummaryImageWithPlaywright([], groupName, headerTitle, templatePath, counts);
      } catch (error) {
        console.warn("Playwright July counts render failed:", error.message);
      }
    }

    return null;
  }

  async generatePanaloJulyNoWinsImage(stats, groupName, headerTitle, subtitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july-no-wins.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        // Extract month from headerTitle (e.g., "No Wins in August 2026" -> "August")
        const monthMatch = headerTitle.match(/in\s+(\w+)\s+\d+$/i);
        const monthName = monthMatch ? monthMatch[1] : "July";
        
        return await this.generatePanaloMonthSummaryImageWithPlaywright(stats, groupName, headerTitle, templatePath, { subtitle, monthName });
      } catch (error) {
        console.warn("Playwright July no wins render failed:", error.message);
      }
    }

    return this.generateLeaderboardImageCanvas((stats || []).slice(0, 5), groupName);
  }

  async generatePanaloAugustDayWinnersImage(morningStats, afternoonStats, groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-august-day-winners.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generatePanaloMonthSummaryImageWithPlaywright(morningStats, groupName, headerTitle, templatePath, { afternoonStats });
      } catch (error) {
        console.warn("Playwright August day winners render failed:", error.message);
      }
    }

    return this.generateLeaderboardImageCanvas((morningStats || []).slice(0, 3), groupName);
  }

  async generatePanaloAugustNightWinnersImage(eveningStats, midnightStats, groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-august-night-winners.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generatePanaloMonthSummaryImageWithPlaywright(eveningStats, groupName, headerTitle, templatePath, { midnightStats });
      } catch (error) {
        console.warn("Playwright August night winners render failed:", error.message);
      }
    }

    return this.generateLeaderboardImageCanvas((eveningStats || []).slice(0, 3), groupName);
  }

  async generatePanaloJulyAttendanceImage(stats, groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july-attendance.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        return await this.generatePanaloMonthSummaryImageWithPlaywright(stats, groupName, headerTitle, templatePath);
      } catch (error) {
        console.warn("Playwright July attendance render failed:", error.message);
      }
    }

    return this.generateLeaderboardImageCanvas((stats || []).slice(0, 5), groupName);
  }

  async generatePanaloJulyCoverImage(groupName, headerTitle) {
    const templatePath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "panalo-summary-july-cover.html");

    if (playwright && fs.existsSync(templatePath)) {
      try {
        // Extract month from headerTitle (e.g., "August 2026 Recap" -> "August")
        const monthMatch = headerTitle.match(/^(\w+)\s+\d+\s+Recap$/i);
        const monthName = monthMatch ? monthMatch[1] : "July";
        
        return await this.generatePanaloMonthSummaryImageWithPlaywright([], groupName, headerTitle, templatePath, { monthName });
      } catch (error) {
        console.warn("Playwright July recap cover render failed:", error.message);
      }
    }

    return null;
  }

  async generatePanaloMonthSummaryImageWithPlaywright(stats, groupName, monthLabel, templatePath, extraData = {}) {
    const html = fs.readFileSync(templatePath, "utf8");
    const fontsDir = path.join(__dirname, "..", "..", "assets", "fonts", "Baloo2");
    const statsFontPath = path.join(__dirname, "..", "..", "assets", "fonts", "Stats", "Stats.otf");
    const quickingFontPath = path.join(__dirname, "..", "..", "assets", "fonts", "Stats", "QuickingRegular.otf");

    const fontToBase64 = (filename) => {
      const fontPath = path.join(fontsDir, filename);
      if (!fs.existsSync(fontPath)) {
        return null;
      }

      const fontBuffer = fs.readFileSync(fontPath);
      return `data:font/truetype;base64,${fontBuffer.toString('base64')}`;
    };

    const bgPath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "bg.png");
    const bgImage = fs.existsSync(bgPath)
      ? `data:image/png;base64,${fs.readFileSync(bgPath).toString('base64')}`
      : null;
    const recapPath = path.join(__dirname, "..", "..", "assets", "game-summary-template", "panalo-summary", "recap.png");
    const recapImage = fs.existsSync(recapPath)
      ? `data:image/png;base64,${fs.readFileSync(recapPath).toString('base64')}`
      : null;

    const badgeDir = path.join(__dirname, "..", "..", "assets", "game-summary-template", "badge");
    const badgeFirstBase64 = fs.existsSync(path.join(badgeDir, "first.png"))
      ? `data:image/png;base64,${fs.readFileSync(path.join(badgeDir, "first.png")).toString("base64")}`
      : null;
    const badgeSecondBase64 = fs.existsSync(path.join(badgeDir, "second.png"))
      ? `data:image/png;base64,${fs.readFileSync(path.join(badgeDir, "second.png")).toString("base64")}`
      : null;
    const badgeThirdBase64 = fs.existsSync(path.join(badgeDir, "third.png"))
      ? `data:image/png;base64,${fs.readFileSync(path.join(badgeDir, "third.png")).toString("base64")}`
      : null;

    if (/panalo-summary-july\.html$/i.test(templatePath)) {
      console.log("July badge assets loaded:", {
        badgeFirst: !!badgeFirstBase64,
        badgeSecond: !!badgeSecondBase64,
        badgeThird: !!badgeThirdBase64,
      });
    }

    const fonts = {
      medium: fontToBase64('Baloo2-Medium.ttf'),
      semibold: fontToBase64('Baloo2-SemiBold.ttf'),
      bold: fontToBase64('Baloo2-Bold.ttf'),
      extrabold: fontToBase64('Baloo2-ExtraBold.ttf'),
      stats: fs.existsSync(statsFontPath) ? `data:font/otf;base64,${fs.readFileSync(statsFontPath).toString('base64')}` : null,
      quicking: fs.existsSync(quickingFontPath) ? `data:font/otf;base64,${fs.readFileSync(quickingFontPath).toString('base64')}` : null,
    };

    let htmlWithAssets = html;
    htmlWithAssets = htmlWithAssets.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Medium\.ttf'\)/g,
      `url('${fonts.medium}')`
    );
    htmlWithAssets = htmlWithAssets.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-SemiBold\.ttf'\)/g,
      `url('${fonts.semibold}')`
    );
    htmlWithAssets = htmlWithAssets.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-Bold\.ttf'\)/g,
      `url('${fonts.bold}')`
    );
    htmlWithAssets = htmlWithAssets.replace(
      /url\('\.\.\/\.\.\/assets\/fonts\/Baloo2\/Baloo2-ExtraBold\.ttf'\)/g,
      `url('${fonts.extrabold}')`
    );
    if (fonts.quicking) {
      htmlWithAssets = htmlWithAssets.replace(
        /url\('\.\.\/\.\.\/assets\/fonts\/Stats\/QuickingRegular\.otf'\)/g,
        `url('${fonts.quicking}')`
      );
    }
    if (fonts.stats) {
      htmlWithAssets = htmlWithAssets.replace(
        /url\('\.\.\/\.\.\/assets\/fonts\/Stats\/Stats\.otf'\)/g,
        `url('${fonts.stats}')`
      );
    }
    if (bgImage) {
      htmlWithAssets = htmlWithAssets.replace(
        /background:\s*url\('bg\.png'\)\s*center\/cover\s*no-repeat;/g,
        `background: url('${bgImage}') center/cover no-repeat;`
      );
    }
    if (recapImage) {
      htmlWithAssets = htmlWithAssets.replace(
        /background:\s*url\('recap\.png'\)\s*center\/cover\s*no-repeat;/g,
        `background: url('${recapImage}') center/cover no-repeat;`
      );
    }

    const escapeHtml = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");

    const photoPromises = (stats || []).map(async (player) => {
      const photoUrl = player.profilePhotoUrl;
      if (!photoUrl) return;

      const normalizedPhotoUrl = /^data:/i.test(photoUrl) || /^https?:\/\//i.test(photoUrl)
        ? photoUrl
        : null;

      if (!normalizedPhotoUrl) return;

      const cacheKey = `photo:${normalizedPhotoUrl}`;
      const cachedPhoto = cache.get(cacheKey);
      if (cachedPhoto) {
        player._inlinedProfilePhoto = cachedPhoto;
        return;
      }

      // Skip photo fetching if SKIP_PROFILE_PHOTOS is set (for testing)
      if (process.env.SKIP_PROFILE_PHOTOS === 'true') {
        player._inlinedProfilePhoto = null;
        return;
      }

      try {
        const res = await fetch(normalizedPhotoUrl);
        if (res && res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const ct = res.headers.get("content-type") || "image/jpeg";
          const base64Photo = `data:${ct};base64,${buf.toString("base64")}`;
          player._inlinedProfilePhoto = base64Photo;
          cache.set(cacheKey, base64Photo, 3600000);
        } else {
          player._inlinedProfilePhoto = null;
        }
      } catch (error) {
        player._inlinedProfilePhoto = null;
      }
    });
    await Promise.all(photoPromises);

    const isJulyTemplate = /panalo-summary-july\.html$/i.test(templatePath);
    const isJulyTotalGamesTemplate = /panalo-summary-july-total-games\.html$/i.test(templatePath);
    const isJulyLongestStreaksTemplate = /panalo-summary-july-longest-streaks\.html$/i.test(templatePath);
    const isJulyMostConfidenceTemplate = /panalo-summary-july-most-confidence\.html$/i.test(templatePath);
    const isJulyNoWinsTemplate = /panalo-summary-july-no-wins\.html$/i.test(templatePath);
    const isJulyAttendanceTemplate = /panalo-summary-july-attendance\.html$/i.test(templatePath);
    const isJulyGameTimeTemplate = /panalo-summary-july-gametime\.html$/i.test(templatePath);
    const isAugustDayWinnersTemplate = /panalo-summary-august-day-winners\.html$/i.test(templatePath);
    const isAugustNightWinnersTemplate = /panalo-summary-august-night-winners\.html$/i.test(templatePath);
    const warmAvatarColors = ['#D99A70', '#E0AF74', '#D18F7F', '#C1A78D', '#D8B86E', '#D7A78C', '#E3C28A'];
    const getRandomWarmColor = () => warmAvatarColors[Math.floor(Math.random() * warmAvatarColors.length)];

    const orderedStats = isJulyTotalGamesTemplate
      ? (stats || []).slice().sort((a, b) => Number(b.total_games) - Number(a.total_games))
      : isJulyLongestStreaksTemplate
      ? (stats || []).slice().sort((a, b) => Number(b.streak) - Number(a.streak))
      : isJulyMostConfidenceTemplate
      ? (stats || []).slice().sort((a, b) => Number(b.score) - Number(a.score))
      : isJulyAttendanceTemplate
      ? (stats || []).slice().sort((a, b) => Number(b.games_participated) - Number(a.games_participated))
      : isAugustDayWinnersTemplate || isAugustNightWinnersTemplate
      ? (stats || []).slice().sort((a, b) => Number(b.wins) - Number(a.wins))
      : (stats || []);

    const maxCards = isJulyMostConfidenceTemplate || isJulyAttendanceTemplate ? 5 : isJulyNoWinsTemplate ? orderedStats.length : isAugustDayWinnersTemplate || isAugustNightWinnersTemplate ? 3 : 3;
    const cardsHtml = orderedStats.slice(0, maxCards).map((player, index) => {
      const rank = index + 1;
      const displayName = player.first_name || player.username || "Player";
      const wins = Number(player.wins) || 0;
      const games = Number(player.total_games) || 0;
      const gamesPerDay = Number(player.games_per_day) || 0;
      const streak = Number(player.streak) || 0;
      const streakDisplay = streak > 0 ? `+${streak}` : String(streak);
      const order = rank === 1 ? 2 : rank === 2 ? 1 : 3;
      const photoUrl = player._inlinedProfilePhoto || null;
      const avatarHtml = photoUrl
        ? `<div class="icon-slot"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(displayName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" /></div>`
        : `<div class="icon-slot" style="background:${getRandomWarmColor()};"></div>`;

      if (isJulyTotalGamesTemplate || isJulyLongestStreaksTemplate || isJulyMostConfidenceTemplate || isJulyAttendanceTemplate) {
        const metricValue = isJulyTotalGamesTemplate
          ? games
          : isJulyLongestStreaksTemplate
          ? streak
          : isJulyMostConfidenceTemplate
          ? `${((Number(player.score) || 0) * 100).toFixed(2)}%`
          : isJulyAttendanceTemplate
          ? (player.attendance_ratio || `${games}/${games}`)
          : games;
        
        return `
        <div class="medal-col rank-${rank}">
          <div class="player-stack">
            ${avatarHtml}
            <div class="player-details">
              <div class="pname">${escapeHtml(displayName)}</div>
            </div>
          </div>
          <div class="count">${metricValue}</div>
        </div>
      `;
      }

      if (isJulyNoWinsTemplate) {
        return `
        <div class="player-item">
          ${avatarHtml}
          <div class="pname">${escapeHtml(displayName)}</div>
        </div>
      `;
      }

      if (isJulyTemplate) {
        let badgeStyle = "";
        if (rank === 1 && badgeFirstBase64) {
          badgeStyle = `background-image:url('${badgeFirstBase64}')`;
        } else if (rank === 2 && badgeSecondBase64) {
          badgeStyle = `background-image:url('${badgeSecondBase64}')`;
        } else if (rank === 3 && badgeThirdBase64) {
          badgeStyle = `background-image:url('${badgeThirdBase64}')`;
        }

        let badgeHtml = "";
        if (rank <= 3 && badgeStyle) {
          const badgeClass = rank === 2 ? 'badge second' : rank === 3 ? 'badge third' : 'badge';
          badgeHtml = `<div class="${badgeClass}" style="${badgeStyle}"></div>`;
        }

        const avatarWithBadge = photoUrl
          ? `<div class="icon-slot"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(displayName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />${badgeHtml}</div>`
          : `<div class="icon-slot" style="background:${getRandomWarmColor()};">${badgeHtml}</div>`;

        return `
        <div class="medal-col rank-${rank}" style="order:${order};">
          ${avatarWithBadge}
          <div class="podium-bar">
            <div class="count">${wins}</div>
            <div class="pname">${escapeHtml(displayName)}</div>
          </div>
        </div>
      `;
      }

      return `
        <div class="medal-col rank-${rank}" style="order:${order};">
          <div class="callout">
            <div class="stat-grid">
              <div class="lbl">W</div><div class="val">${wins}</div>
              <div class="lbl">G</div><div class="val">${games}</div>
              <div class="lbl">GT</div><div class="val">${gamesPerDay}</div>
              <div class="lbl">STRK</div><div class="val">${streakDisplay}</div>
            </div>
          </div>
          ${avatarHtml}
          <div class="podium-bar">
            <div class="num">${rank}</div>
            <div class="pname">${escapeHtml(displayName)}</div>
            <div class="recap">${wins} wins across ${games} games played.</div>
            <div class="streak">STREAK ${streakDisplay}</div>
          </div>
        </div>
      `;
    }).join("");

    // Handle special templates with multiple stats sections
    let morningCardsHtml = "";
    let afternoonCardsHtml = "";
    let eveningCardsHtml = "";
    let midnightCardsHtml = "";

    if (isAugustDayWinnersTemplate && extraData.afternoonStats) {
      // Generate morning cards from main stats - but override with row format
      const morningOrderedStats = (stats || []).slice().sort((a, b) => Number(b.wins) - Number(a.wins));
      morningCardsHtml = morningOrderedStats.slice(0, 3).map((player, index) => {
        const rank = index + 1;
        const displayName = player.first_name || player.username || "Player";
        const wins = Number(player.wins) || 0;
        const photoUrl = player._inlinedProfilePhoto || null;
        const avatarHtml = photoUrl
          ? `<div class="icon-slot"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(displayName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" /></div>`
          : `<div class="icon-slot" style="background:${getRandomWarmColor()};"></div>`;

        return `
        <div class="winners-row rank-${rank}">
          <div class="player-item">
            ${avatarHtml}
            <div class="player-info">
              <div class="player-name">${escapeHtml(displayName)}</div>
            </div>
          </div>
          <div class="player-count">${wins}</div>
        </div>
      `;
      }).join("");
      
      // Fetch photos for afternoon stats
      const afternoonPhotoPromises = (extraData.afternoonStats || []).map(async (player) => {
        const photoUrl = player.profilePhotoUrl;
        if (!photoUrl) return;

        const normalizedPhotoUrl = /^data:/i.test(photoUrl) || /^https?:\/\//i.test(photoUrl)
          ? photoUrl
          : null;

        if (!normalizedPhotoUrl) return;

        const cacheKey = `photo:${normalizedPhotoUrl}`;
        const cachedPhoto = cache.get(cacheKey);
        if (cachedPhoto) {
          player._inlinedProfilePhoto = cachedPhoto;
          return;
        }

        // Skip photo fetching if SKIP_PROFILE_PHOTOS is set (for testing)
        if (process.env.SKIP_PROFILE_PHOTOS === 'true') {
          player._inlinedProfilePhoto = null;
          return;
        }

        try {
          const res = await fetch(normalizedPhotoUrl);
          if (res && res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const ct = res.headers.get("content-type") || "image/jpeg";
            const base64Photo = `data:${ct};base64,${buf.toString("base64")}`;
            player._inlinedProfilePhoto = base64Photo;
            cache.set(cacheKey, base64Photo, 3600000);
          } else {
            player._inlinedProfilePhoto = null;
          }
        } catch (error) {
          player._inlinedProfilePhoto = null;
        }
      });
      await Promise.all(afternoonPhotoPromises);
      
      // Generate afternoon cards from extraData.afternoonStats
      const afternoonOrderedStats = (extraData.afternoonStats || []).slice().sort((a, b) => Number(b.wins) - Number(a.wins));
      afternoonCardsHtml = afternoonOrderedStats.slice(0, 3).map((player, index) => {
        const rank = index + 1;
        const displayName = player.first_name || player.username || "Player";
        const wins = Number(player.wins) || 0;
        const photoUrl = player._inlinedProfilePhoto || null;
        const avatarHtml = photoUrl
          ? `<div class="icon-slot"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(displayName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" /></div>`
          : `<div class="icon-slot" style="background:${getRandomWarmColor()};"></div>`;

        return `
        <div class="winners-row rank-${rank}">
          <div class="player-item">
            ${avatarHtml}
            <div class="player-info">
              <div class="player-name">${escapeHtml(displayName)}</div>
            </div>
          </div>
          <div class="player-count">${wins}</div>
        </div>
      `;
      }).join("");
    }

    if (isAugustNightWinnersTemplate && extraData.midnightStats) {
      // Generate evening cards from main stats - but override with row format
      const eveningOrderedStats = (stats || []).slice().sort((a, b) => Number(b.wins) - Number(a.wins));
      eveningCardsHtml = eveningOrderedStats.slice(0, 3).map((player, index) => {
        const rank = index + 1;
        const displayName = player.first_name || player.username || "Player";
        const wins = Number(player.wins) || 0;
        const photoUrl = player._inlinedProfilePhoto || null;
        const avatarHtml = photoUrl
          ? `<div class="icon-slot"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(displayName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" /></div>`
          : `<div class="icon-slot" style="background:${getRandomWarmColor()};"></div>`;

        return `
        <div class="winners-row rank-${rank}">
          <div class="player-item">
            ${avatarHtml}
            <div class="player-info">
              <div class="player-name">${escapeHtml(displayName)}</div>
            </div>
          </div>
          <div class="player-count">${wins}</div>
        </div>
      `;
      }).join("");
      
      // Fetch photos for midnight stats
      const midnightPhotoPromises = (extraData.midnightStats || []).map(async (player) => {
        const photoUrl = player.profilePhotoUrl;
        if (!photoUrl) return;

        const normalizedPhotoUrl = /^data:/i.test(photoUrl) || /^https?:\/\//i.test(photoUrl)
          ? photoUrl
          : null;

        if (!normalizedPhotoUrl) return;

        const cacheKey = `photo:${normalizedPhotoUrl}`;
        const cachedPhoto = cache.get(cacheKey);
        if (cachedPhoto) {
          player._inlinedProfilePhoto = cachedPhoto;
          return;
        }

        // Skip photo fetching if SKIP_PROFILE_PHOTOS is set (for testing)
        if (process.env.SKIP_PROFILE_PHOTOS === 'true') {
          player._inlinedProfilePhoto = null;
          return;
        }

        try {
          const res = await fetch(normalizedPhotoUrl);
          if (res && res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            const ct = res.headers.get("content-type") || "image/jpeg";
            const base64Photo = `data:${ct};base64,${buf.toString("base64")}`;
            player._inlinedProfilePhoto = base64Photo;
            cache.set(cacheKey, base64Photo, 3600000);
          } else {
            player._inlinedProfilePhoto = null;
          }
        } catch (error) {
          player._inlinedProfilePhoto = null;
        }
      });
      await Promise.all(midnightPhotoPromises);
      
      // Generate midnight cards from extraData.midnightStats
      const midnightOrderedStats = (extraData.midnightStats || []).slice().sort((a, b) => Number(b.wins) - Number(a.wins));
      midnightCardsHtml = midnightOrderedStats.slice(0, 3).map((player, index) => {
        const rank = index + 1;
        const displayName = player.first_name || player.username || "Player";
        const wins = Number(player.wins) || 0;
        const photoUrl = player._inlinedProfilePhoto || null;
        const avatarHtml = photoUrl
          ? `<div class="icon-slot"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(displayName)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" /></div>`
          : `<div class="icon-slot" style="background:${getRandomWarmColor()};"></div>`;

        return `
        <div class="winners-row rank-${rank}">
          <div class="player-item">
            ${avatarHtml}
            <div class="player-info">
              <div class="player-name">${escapeHtml(displayName)}</div>
            </div>
          </div>
          <div class="player-count">${wins}</div>
        </div>
      `;
      }).join("");
    }

    const formatNumber = (value) => new Intl.NumberFormat('en-US').format(Number(value || 0));

    const filled = htmlWithAssets
      .replace(/\{\{MONTH\}\}/g, escapeHtml(extraData.monthName || "July"))
      .replace(/\{\{MONTH_LABEL\}\}/g, escapeHtml(monthLabel || "Monthly Summary"))
      .replace(/\{\{HEADER_TITLE\}\}/g, escapeHtml(monthLabel || "Monthly Summary"))
      .replace(/\{\{SUBTITLE\}\}/g, escapeHtml(extraData.subtitle || ""))
      .replace(/\{\{TOTAL_GAMES\}\}/g, escapeHtml(formatNumber(extraData.totalGames)))
      .replace(/\{\{TOTAL_PLAYERS\}\}/g, escapeHtml(formatNumber(extraData.totalPlayers)))
      .replace(/\{\{TOTAL_BETS\}\}/g, escapeHtml(formatNumber(extraData.totalBets)))
      .replace(/\{\{TOTAL_BOLA_DRAWN\}\}/g, escapeHtml(formatNumber(extraData.totalBolaDrawn)))
      .replace(/\{\{LONGEST_GAME\}\}/g, escapeHtml(extraData.longest_game?.duration_formatted || "N/A"))
      .replace(/\{\{FASTEST_GAME\}\}/g, escapeHtml(extraData.fastest_game?.duration_formatted || "N/A"))
      .replace(/\{\{CARDS\}\}/g, cardsHtml)
      .replace(/\{\{MORNING_CARDS\}\}/g, morningCardsHtml)
      .replace(/\{\{AFTERNOON_CARDS\}\}/g, afternoonCardsHtml)
      .replace(/\{\{EVENING_CARDS\}\}/g, eveningCardsHtml)
      .replace(/\{\{MIDNIGHT_CARDS\}\}/g, midnightCardsHtml);

    const page = await this.ensurePlaywrightPage();
    await page.setContent(filled, { waitUntil: "networkidle" });

    try {
      await page.evaluate(() => document.fonts.ready);
    } catch (fontErr) {
      console.warn("Font load wait error:", fontErr && fontErr.message);
    }

    try {
      await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => {
        if (img.complete) return Promise.resolve(true);
        return new Promise((resolve) => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
        });
      })));
    } catch (imgErr) {
      console.warn("Image load wait error:", imgErr && imgErr.message);
    }

    const contentHeight = await page.evaluate(() => {
      const body = document.body;
      return Math.max(body.scrollHeight, body.offsetHeight, 760);
    });

    await page.setViewportSize({ width: 720, height: Math.min(contentHeight + 120, 2200) });

    try {
      const cardHandle = await page.$('.card');
      if (cardHandle) {
        const cardBuffer = await cardHandle.screenshot({ type: 'png' });
        await cardHandle.dispose();
        return cardBuffer;
      }
    } catch (cardErr) {
      console.warn('Failed to screenshot .card element, falling back to full page:', cardErr && cardErr.message);
    }

    return await page.screenshot({ type: 'png', fullPage: true });
  }

  async searchGiphy(theme) {
    const defaultGif = "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExMW15eDVqMGppOXhybXhseW95MTBhdTJ1MTc2YzZxaGJzMnk2cW8zNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/YGMthKPtoM9Ms/giphy.gif";

    // One Piece specific gif + search queries when that theme is selected
    const ONE_PIECE_GIF = "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExY2Z5Z2Rqd2N5b2V5b3VuZ2Z1eHd6cW9xZ2Z1eHd6cW9x/giphy.gif";
    const MIX_THEME_GIF = "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExMW15eDVqMGppOXhybXhseW95MTBhdTJ1MTc2YzZxaGJzMnk2cW8zNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/YGMthKPtoM9Ms/giphy.gif";
    const isOnePiece =
      (theme && /one\s*piece|onepiece/i.test(theme)) ||
      (typeof theme === "string" && theme.toLowerCase().trim() === "onepiece");
    const isMixTheme = typeof theme === "string" && theme.toLowerCase().trim() === "mix";
    if (isMixTheme) {
      if (!GIPHY_API_KEY) {
        return MIX_THEME_GIF;
      }
      const mixQueries = ["bingo mix", "bingo party", "funny bingo"];
      for (const query of mixQueries) {
        try {
          const offset = Math.floor(Math.random() * 25);
          const response = await fetch(
            `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=25&offset=${offset}&rating=pg`,
          );
          const data = await response.json();
          if (data.data && data.data.length > 0) {
            const randomGif = data.data[Math.floor(Math.random() * data.data.length)];
            return randomGif.images.fixed_height.url || randomGif.images.original.url;
          }
        } catch (error) {
          console.error("Failed to fetch Bingulo Beta Giphy GIF:", error);
        }
      }
      return MIX_THEME_GIF;
    }

    if (isOnePiece) {
      if (!GIPHY_API_KEY) {
        return ONE_PIECE_GIF;
      }
      const onePieceQueries = ["one piece anime", "luffy one piece", "one piece"];
      for (const query of onePieceQueries) {
        try {
          const offset = Math.floor(Math.random() * 25);
          const response = await fetch(
            `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=25&offset=${offset}&rating=pg`,
          );
          const data = await response.json();
          if (data.data && data.data.length > 0) {
            const randomGif = data.data[Math.floor(Math.random() * data.data.length)];
            return randomGif.images.fixed_height.url || randomGif.images.original.url;
          }
        } catch (error) {
          console.error("Failed to fetch One Piece Giphy GIF:", error);
        }
      }
      return ONE_PIECE_GIF;
    }

    if (!GIPHY_API_KEY) {
      return defaultGif;
    }

    const searchQueries = Array.from(
      new Set(
        [theme, theme && theme.toLowerCase().includes("bingo") ? "bingo" : null, "bingo"].filter(Boolean),
      ),
    );

    try {
      for (const query of searchQueries) {
        const offset = Math.floor(Math.random() * 50);
        const response = await fetch(
          `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=25&offset=${offset}&rating=pg`,
        );
        const data = await response.json();
        if (data.data && data.data.length > 0) {
          const randomGif = data.data[Math.floor(Math.random() * data.data.length)];
          // Use fixed_height URL instead of original for better Telegram compatibility
          // original URLs can be too long with complex encoding
          return randomGif.images.fixed_height.url || randomGif.images.original.url;
        }
      }
    } catch (error) {
      console.error("Failed to fetch Giphy GIF:", error);
    }

    return defaultGif;
  }
}

module.exports = ImageGenerationService;