/**
 * Shared state for bingo commands
 */

// Store player list message IDs: `${groupId}_${sessionId}` -> messageId
const playerListMessages = new Map();

// Premium emoji status
const BOT_OWNER_ID = 8442877660;
let premiumActive = false; // Default to false, will be verified on first check
let premiumLastChecked = 0; // Timestamp of last check
const PREMIUM_CACHE_DURATION = 3600000; // 1 hour in milliseconds
let botSettingsService = null; // Will be injected

const BINGULO_OVERRIDE_THEMES = {
  comics: "comics",
  spongebob: "spongebob",
  toy_story: "toy_story",
  toystory: "toy_story",
  numbers: "calendar",
};

function normalizeThemeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getBinguloOverrideTheme(themeName) {
  return BINGULO_OVERRIDE_THEMES[normalizeThemeValue(themeName)] || null;
}

function setBotSettingsService(service) {
  botSettingsService = service;
}

async function getPremiumStatus() {
  // If cache is expired, check database
  if (Date.now() - premiumLastChecked > PREMIUM_CACHE_DURATION) {
    if (botSettingsService) {
      try {
        premiumActive = await botSettingsService.getPremiumEmojiEnabled();
        premiumLastChecked = Date.now();
        console.log("[premium-check] Loaded from database:", premiumActive);
      } catch (error) {
        console.error("[premium-check] Error loading from database:", error);
      }
    }
    return null; // Indicate re-check needed
  }
  return premiumActive;
}

async function setPremiumStatus(active) {
  premiumActive = active;
  premiumLastChecked = Date.now();
  
  // Also update database if service is available
  if (botSettingsService) {
    try {
      await botSettingsService.setPremiumEmojiEnabled(active);
      console.log("[premium-check] Saved to database:", active);
    } catch (error) {
      console.error("[premium-check] Error saving to database:", error);
    }
  }
}

function isPremiumCacheExpired() {
  return Date.now() - premiumLastChecked > PREMIUM_CACHE_DURATION;
}

function forcePremiumCheck() {
  premiumLastChecked = 0; // Reset to force re-check
}

module.exports = {
  playerListMessages,
  BINGULO_OVERRIDE_THEMES,
  normalizeThemeValue,
  getBinguloOverrideTheme,
  BOT_OWNER_ID,
  setBotSettingsService,
  getPremiumStatus,
  setPremiumStatus,
  isPremiumCacheExpired,
  forcePremiumCheck,
};
