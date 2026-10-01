/**
 * Lista command: /lista - display drawn items image
 */

const { InputFile } = require("grammy");
const { IMAGE_ENABLED } = require("../../utils/imageSettings");
const { formatDrawnItemsText } = require("./helpers");

async function handleListaV2(ctx, gameStateService, imageGenerationService, bingoFundsService, overrideThemeId = null, filteredGame = null) {
  if (ctx.chat.type === "private") {
    // Allow private chat for viewing list
    const game = filteredGame || gameStateService.getBingoGame(ctx.chat.id);

    if (!game) {
      await ctx.reply("No active bingo game. Start one with /bingostart");
      return;
    }

    if (!IMAGE_ENABLED) {
      await ctx.reply(formatDrawnItemsText(game), { parse_mode: "HTML" });
      return;
    }

    await ctx.replyWithChatAction("upload_photo");

    try {
      const buffer = await imageGenerationService.generateBingoDrawnItemsImage(game, ctx.chat.id, overrideThemeId);
      await ctx.replyWithPhoto(new InputFile(buffer));
    } catch (error) {
      console.error("Error generating lista image:", error);
      await ctx.reply(`Error: ${error.message}`);
    }
    return;
  }

  const chatId = ctx.chat.id;

  // Check if group is using BINGULO BETA theme - show theme stats instead of blocking
  const activeThemeId = gameStateService.getTheme(chatId);
  if (activeThemeId === "bingulo_beta" && !overrideThemeId) {
    const game = gameStateService.getBingoGame(chatId);
    if (!game) {
      await ctx.reply("No active bingo game. Start one with /bingostart");
      return;
    }

    // Calculate theme stats for BINGULO BETA
    const { BINGULO_BETA_DATA } = require("../../data/themes/binguloBetaDefaultData");
    
    // Count total items per theme
    const themeTotals = {};
    for (const [theme, categories] of Object.entries(BINGULO_BETA_DATA)) {
      let total = 0;
      for (const items of Object.values(categories)) {
        total += items.length;
      }
      themeTotals[theme] = total;
    }

    // Count drawn items per theme
    const themeDrawn = {
      spongebob: 0,
      toy_story: 0,
      comics: 0,
      calendar: 0,
    };

    // Use the getBinguloBetaSource function from bola.js
    function normalizeThemeValue(value) {
      return String(value || "").trim().toLowerCase();
    }

    function getBinguloBetaSource(value) {
      const normalized = normalizeThemeValue(value);
      for (const theme of Object.keys(BINGULO_BETA_DATA)) {
        const themeData = BINGULO_BETA_DATA[theme];
        if (typeof themeData === 'object' && !Array.isArray(themeData)) {
          for (const category of Object.keys(themeData)) {
            const items = themeData[category];
            if (Array.isArray(items) && items.some((item) => normalizeThemeValue(item) === normalized)) {
              return theme;
            }
          }
        }
      }
      return "calendar";
    }

    // Count drawn items by theme
    game.card.forEach((col) => {
      col.items.forEach((item) => {
        if (item.selected) {
          const themeSource = getBinguloBetaSource(item.value);
          if (themeDrawn.hasOwnProperty(themeSource)) {
            themeDrawn[themeSource]++;
          }
        }
      });
    });

    // Build stats message
    const themeNames = {
      spongebob: "SPONGEBOB",
      toy_story: "TOY STORY",
      comics: "FINO❤️",
      calendar: "CALENDAR",
    };

    let statsMessage = "📊 <b>Theme Stats</b>\n\n";
    for (const [theme, name] of Object.entries(themeNames)) {
      const drawn = themeDrawn[theme];
      const total = themeTotals[theme];
      statsMessage += `<b>${name}:</b> ${drawn}/${total}\n`;
    }

    await ctx.reply(statsMessage, { parse_mode: "HTML" });
    return;
  }

  const isFundsOnly = await bingoFundsService.isFundsOnlyGroup(chatId);
  if (isFundsOnly) {
    const fundsGroupName = await bingoFundsService.getFundsGroupName(chatId);
    await ctx.reply(
      `🚫 <b>Gameplay Not Allowed</b>\n\n` +
      `This group (<b>${fundsGroupName || 'Funds Group'}</b>) is configured as a funds management group only.\n\n` +
      `Bingo gameplay commands are disabled here. Please use the main gameplay group to play bingo.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const game = filteredGame || gameStateService.getBingoGame(chatId);

  if (!game) {
    await ctx.reply("No active bingo game. Start one with /bingostart");
    return;
  }

  if (!IMAGE_ENABLED) {
    await ctx.reply(formatDrawnItemsText(game), { parse_mode: "HTML" });
    return;
  }

  await ctx.replyWithChatAction("upload_photo");

  try {
    const buffer = await imageGenerationService.generateBingoDrawnItemsImage(game, ctx.chat.id, overrideThemeId);
    await ctx.replyWithPhoto(new InputFile(buffer));
  } catch (error) {
    console.error("Error generating lista image:", error);
    await ctx.reply(`Error: ${error.message}`);
  }
}

module.exports = { handleListaV2 };
