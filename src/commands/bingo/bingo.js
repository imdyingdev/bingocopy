/**
 * Bingo command: /bingo - display drawn items table
 */

const { createDrawnItemsTable, streamDrawnItemsTable, displayBingoCard } = require("./helpers");

async function handleBingo(ctx, gameStateService, imageGenerationService, bingoFundsService, overrideThemeId = null, filteredGame = null) {
  if (ctx.chat.type === "private") {
    // In private chat - try streaming with animation
    const game = filteredGame || gameStateService.getBingoGame(ctx.chat.id);

    if (!game) {
      await ctx.reply("No active bingo game. Start one with /bingostart");
      return;
    }

    try {
      const streamed = await streamDrawnItemsTable(ctx, game);

      if (!streamed) {
        // Fallback: send simple message
        await ctx.reply("📊 Failed to load drawn items, but the game is still active!");
      }
    } catch (error) {
      console.error("[lista-private-error]", error.message);
      await ctx.reply("📊 Error loading drawn items");
    }
    return;
  }

  // Group chat - show table only (image only if table fails)
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

  // Try to display drawn items table using rich message (grammy 1.44+)
  try {
    const drawnTable = createDrawnItemsTable(game);

    if (drawnTable) {
      try {
        console.log("[tabla-debug] Sending rich message with table...");
        
        await ctx.api.sendRichMessage(chatId, {
          html: `<h2>📊 Drawn Items</h2>
${drawnTable}`,
        }, { reply_to_message_id: ctx.message.message_id });
        
        console.log("[tabla-success] Rich message table sent successfully");
        return; // Success - don't show image
      } catch (richMsgError) {
        console.error("[tabla-error-rich] sendRichMessage failed:", richMsgError.message);
        
        // Fallback: show the card with caption instead
        console.log("[tabla-fallback] Falling back to card with caption...");
        await displayBingoCard(ctx, game, imageGenerationService, overrideThemeId);
      }
    } else {
      // No drawn items yet - show card with caption
      await displayBingoCard(ctx, game, imageGenerationService, overrideThemeId);
    }
  } catch (error) {
    console.error("[tabla-error-outer] Unexpected error:", error.message);
    // Last resort fallback
    await displayBingoCard(ctx, game, imageGenerationService, overrideThemeId);
  }
}

async function handleRemainingItems(ctx, gameStateService) {
  const game = gameStateService.getBingoGame(ctx.chat.id);

  if (!game) {
    await ctx.reply("No active bingo game. Start one with /bingostart");
    return;
  }

  const remainingItems = (game.card || []).reduce(
    (total, column) => total + (column.items || []).filter((item) => !item.selected).length,
    0,
  );

  await ctx.reply(`Remaining Items: ${remainingItems}`);
}

module.exports = { handleBingo, handleRemainingItems };
