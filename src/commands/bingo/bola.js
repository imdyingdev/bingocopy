/**
 * /bola command handler
 */

const { InputFile } = require("grammy");
const fs = require("fs");
const path = require("path");
const { fisherYatesShuffle } = require("../../utils/helpers");
const { DATA } = require("../../data/defaultData");
const { SPONGEBOB_DATA } = require("../../data/themes/spongebobDefaultData");
const { COMICS_DATA } = require("../../data/themes/comicsDefaultData");
const { TOY_STORY_DATA } = require("../../data/themes/toystoryDefaultData");
const { THEME_EMOJIS } = require("../../constants/themeEmojis");
const { getPremiumStatus } = require("./sharedState");
const { GROUP_SPECIFIC_COMMANDS } = require("../../utils/constants");
const { IMAGE_ENABLED } = require("../../utils/imageSettings");

function normalizeThemeValue(value) {
  return String(value || "").trim().toLowerCase();
}

function getBinguloBetaSource(value) {
  const normalized = normalizeThemeValue(value);
  const { BINGULO_BETA_DATA } = require("../data/themes/binguloBetaDefaultData");

  // Check nested structure for theme source
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

  return "calendar"; // Default to calendar for numbers
}

function getBinguloBetaSourceFromCategory(category) {
  // Extract theme from category name (e.g., "spongebob_S" -> "spongebob")
  const match = category.match(/^([a-z_]+)_([A-Z])$/);
  if (match) {
    return match[1]; // Return the theme part
  }
  return null;
}

function stripThemePrefixFromCategory(category) {
  // Strip theme prefix from category name for display (e.g., "spongebob_S" -> "S")
  const match = category.match(/^([a-z_]+)_([A-Z])$/);
  if (match) {
    return match[2]; // Return the category letter
  }
  return category; // Return original if no match
}

function pickBinguloBetaDraws(unselected, count) {
  const remaining = [...unselected];
  const draws = [];
  const sources = ["calendar", "spongebob", "comics", "toy_story"];

  // Shuffle sources to randomize which themes get priority
  const shuffledSources = sources.sort(() => Math.random() - 0.5);

  // Distribute draws across themes to allow multiple from same theme
  let attempts = 0;
  const maxAttempts = count * 3; // Allow multiple attempts to find items

  while (draws.length < count && attempts < maxAttempts) {
    attempts++;

    // Pick a random source from shuffled order
    const source = shuffledSources[Math.floor(Math.random() * shuffledSources.length)];

    // Find an item from this source using category name
    const index = remaining.findIndex((item) => {
      const themeFromCategory = getBinguloBetaSourceFromCategory(item.category);
      console.log(`Checking item ${item.value} with category ${item.category}, themeFromCategory: ${themeFromCategory}, source: ${source}`);
      return themeFromCategory === source;
    });
    if (index >= 0) {
      const [picked] = remaining.splice(index, 1);
      draws.push(picked);
    }
  }

  // Fallback to random selection if we still need more items
  while (draws.length < count && remaining.length > 0) {
    const index = Math.floor(Math.random() * remaining.length);
    const [picked] = remaining.splice(index, 1);
    draws.push(picked);
  }

  return draws;
}

async function handleBola(ctx, gameStateService, groupConfigService, gameLogger, imageGenerationService, bingoFundsService, bingoGameSessionModel, gameWinnerModel, autoBolaManager) {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "🚫 This command can only be used in groups, not in private messages.",
    );
    return;
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from.id;

  if (autoBolaManager && autoBolaManager.isActive(groupId) && !ctx.isAutoBola) {
    await ctx.reply("Auto-bola is currently active. Use /autobola stop first.");
    return;
  }

  // Check if this command is allowed in the current group
  const allowedGroups = GROUP_SPECIFIC_COMMANDS.bola || [];
  if (allowedGroups.length > 0) {
    const isAllowed = await groupConfigService.isCommandAllowedInGroup(groupId, allowedGroups);
    if (!isAllowed) {
      // Silently ignore attempts from unauthorized groups
      return;
    }
  }

  // Check if user is admin (stored or current Telegram admin)
  const isStoredAdmin = await groupConfigService.isAdmin(groupId, userId);
  let isVerifiedAdmin = isStoredAdmin;
  
  if (!isStoredAdmin) {
    try {
      const member = await ctx.api.getChatMember(groupId, userId);
      const status = member?.status;
      isVerifiedAdmin = status === "administrator" || status === "creator";
    } catch (apiError) {
      console.error("Error checking admin status for /bola:", apiError);
      isVerifiedAdmin = false;
    }
  }

  // Only admins can use /bola
  if (!isVerifiedAdmin) {
    // Silently ignore non-admin attempts
    return;
  }

  const isFundsOnly = await bingoFundsService.isFundsOnlyGroup(groupId);
  if (isFundsOnly) {
    const fundsGroupName = await bingoFundsService.getFundsGroupName(groupId);
    await ctx.reply(
      `🚫 <b>Gameplay Not Allowed</b>\n\n` +
      `This group (<b>${fundsGroupName || 'Funds Group'}</b>) is configured as a funds management group only.\n\n` +
      `Bingo gameplay commands are disabled here. Please use the main gameplay group to play bingo.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const chatId = ctx.chat.id;

  const game = gameStateService.getBingoGame(chatId);
  if (!game) {
    await ctx.reply("No active game. Start with /bingostart first!");
    return;
  }

  if (game.sessionId) {
    const sessionInfo = await bingoGameSessionModel.findById(game.sessionId);
    if (!sessionInfo || sessionInfo.status !== "active") {
      await ctx.reply("❌ The game has not been started yet. Use /bingoforce to start the game first.");
      return;
    }
  }

  const args = ctx.match;
  const num = parseInt(args, 10);

  if (!args || isNaN(num)) {
    await ctx.reply("Usage: /bola <1-15>");
    return;
  }

  // After the special rules (bola 10/15 at start), only allow 1-5
  const isGameStart = game.round === 1 && (!game.drawOrder || game.drawOrder.length === 0);
  const maxAllowed = isGameStart ? 15 : 5;

  if (num < 1 || num > maxAllowed) {
    await ctx.reply(`Only 1 to ${maxAllowed} allowed.`);
    return;
  }

  // Bola 10 and 15 only work at the start of the game and are mutually exclusive
  if ((num === 10 || num === 15) && !isGameStart) {
    await ctx.reply("Bola 10 and 15 can only be used once at the start of the game.");
    return;
  }

  // Check for Toy Story promotional bola after round 20
  const themeId = gameStateService.getTheme(chatId);
  if (themeId === "toy_story" && game.round === 20) {
    if (!IMAGE_ENABLED) {
      await ctx.reply("<b>Who's already bingo?</b>\n\n<a href=\"https://pixelframe.design/toy-story-font-generator/\">TOY STORY TEXT GEN</a>", { parse_mode: "HTML" });
      game.round++;
      if (!game.drawMessages) game.drawMessages = [];
      game.drawMessages[game.round - 2] = { message_id: null, round: game.round - 1 };
      return;
    }

    await ctx.replyWithChatAction("upload_photo");
    
    try {
      const promoImagePath = path.join(__dirname, "../../assets/themes/toy_story/bingo.jpg");
      if (fs.existsSync(promoImagePath)) {
        const promoBuffer = fs.readFileSync(promoImagePath);
        
        await ctx.replyWithPhoto(new InputFile(promoBuffer), {
          caption: `<b>Who's already bingo?</b>\n\n<a href="https://pixelframe.design/toy-story-font-generator/">TOY STORY TEXT GEN</a>`,
          parse_mode: "HTML",
        });
        
        // Increment round to 21 after promotional bola
        game.round++;
        
        // Store the message for this round
        if (!game.drawMessages) {
          game.drawMessages = [];
        }
        game.drawMessages[game.round - 2] = {
          message_id: null, // No message_id needed for promotional bola
          round: game.round - 1,
        };
        
        return;
      }
    } catch (error) {
      console.error("Error sending Toy Story promotional bola:", error);
      // Fall through to regular bola if promo fails
    }
  }

  if (IMAGE_ENABLED) await ctx.replyWithChatAction("upload_photo");

  try {
    let patternCount = 0;
    let winnersCount = 0;

    if (game.sessionId) {
      try {
        const sessionInfo = await bingoGameSessionModel.findById(game.sessionId);
        patternCount = Number(sessionInfo?.pattern_count || 0);
        const winners = await gameWinnerModel.getWinnersBySession(game.sessionId);
        winnersCount = Array.isArray(winners) ? winners.length : 0;
      } catch (error) {
        console.error("Failed to load session winner limit:", error);
      }
    }

    const unselected = [];
    game.card.forEach((col, colIdx) => {
      col.items.forEach((item, rowIdx) => {
        if (!item.selected) {
          unselected.push({
            colIdx,
            rowIdx,
            category: col.category,
            value: item.value,
          });
        }
      });
    });

    if (unselected.length === 0) {
      await ctx.reply("🎉 All items already selected! Game complete!");
      return;
    }

    const draws = [];
    const toDraw = Math.min(num, unselected.length);

    if (toDraw < num) {
      await ctx.reply(
        `Only ${toDraw} item${toDraw === 1 ? "" : "s"} remaining! Drawing ${toDraw} instead of ${num}.`,
      );
    }

    const themeId = gameStateService.getTheme(chatId);
    const shuffledUnselected = fisherYatesShuffle(unselected);
    const selectionPool = themeId === "bingulo_beta" && toDraw > 1
      ? pickBinguloBetaDraws(shuffledUnselected, toDraw)
      : shuffledUnselected.slice(0, toDraw);

    // Track theme source for each draw for BINGULO BETA mixed rendering
    const drawsWithTheme = [];
    for (const picked of selectionPool) {
      game.card[picked.colIdx].items[picked.rowIdx].selected = true;
      const displayCategory = stripThemePrefixFromCategory(picked.category);
      game.selected.add(`${displayCategory}-${picked.value}`);

      const themeSource = themeId === "bingulo_beta" ? getBinguloBetaSource(picked.value) : null;
      draws.push([displayCategory, picked.value]);
      drawsWithTheme.push({
        category: picked.category,
        value: picked.value,
        themeSource: themeSource
      });
    }

    if (!game.drawOrder) {
      game.drawOrder = [];
    }
    // Store stripped category names in drawOrder for display
    game.drawOrder.push(...draws);

    // Save game state to database after each draw so it survives restarts
    await gameStateService.markGameDirty(chatId);

    let buffer;
    if (IMAGE_ENABLED && themeId === "bingulo_beta" && toDraw > 1) {
      // Check if all draws are from the same theme
      const allSameTheme = drawsWithTheme.every(draw => draw.themeSource === drawsWithTheme[0].themeSource);

      if (allSameTheme) {
        // Use native theme rendering for single theme
        buffer = await imageGenerationService.generateBolaImageForDrawsCanvas(draws, chatId, gameStateService.getBingoGame.bind(gameStateService));
      } else {
        // Use mixed theme rendering for BINGULO BETA with multiple themes
        buffer = await imageGenerationService.generateMixedThemeBolaImage(drawsWithTheme, chatId, gameStateService.getBingoGame.bind(gameStateService));
      }
    } else if (IMAGE_ENABLED) {
      // Use standard single-theme rendering
      buffer = await imageGenerationService.generateBolaImageForDrawsCanvas(draws, chatId, gameStateService.getBingoGame.bind(gameStateService));
    }
    const caption = draws
      .map(([cat, val]) => `<b>${stripThemePrefixFromCategory(cat)}</b> - ${val}`)
      .join("\n");

// Build reply markup with "Previous Draw" button if there's a prior round
    let replyMarkup;
    if (game.round > 1 && game.drawMessages && game.drawMessages.length >= game.round - 1) {
      const prevDraw = game.drawMessages[game.round - 2];
      if (prevDraw && prevDraw.message_id) {
        // Check if we're sending to channel
        const bolaChannelEnabled = await groupConfigService.getBolaChannelEnabled(chatId);
        const channelId = await groupConfigService.getChannelId(chatId);
        
        let prevUrl;
        if (bolaChannelEnabled && channelId) {
          // Use channel link for previous draw
          const channelStr = String(channelId);
          const linkChannelId = channelStr.startsWith("-100") ? channelStr.replace("-100", "") : channelStr;
          prevUrl = `https://t.me/c/${linkChannelId}/${prevDraw.message_id}`;
        } else {
          // Use group chat link for previous draw
          const chatIdStr = String(chatId);
          const linkChatId = chatIdStr.startsWith("-100") ? chatIdStr.replace("-100", "") : chatIdStr;
          prevUrl = `https://t.me/c/${linkChatId}/${prevDraw.message_id}`;
        }

        // 50/50 chance of showing a sponsor button next to Previous Draw
        const showSponsor = (Math.floor(Math.random() * 2) + 1) === 2;

        // Check premium status and theme for custom emoji
        const usePremiumEmoji = await getPremiumStatus();
        const themeId = await groupConfigService.getTheme(chatId);
        
        let buttonsRow;
        let previousButtonText;
        let previousButtonEmojiId;
        if (usePremiumEmoji && THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].previousDraw) {
          previousButtonText = "Previous Draw";
          previousButtonEmojiId = THEME_EMOJIS[themeId].previousDraw;
          buttonsRow = [
            { text: previousButtonText, url: prevUrl, icon_custom_emoji_id: previousButtonEmojiId, style: "primary" },
          ];
        } else {
          previousButtonText = showSponsor ? "◀️ Previous " : "◀️ Previous Draw";
          buttonsRow = [
            { text: previousButtonText, url: prevUrl, style: "primary" },
          ];
        }

        if (showSponsor) {
          buttonsRow.push({
            text: "😢 Ads",
            url: "https://omg10.com/4/8686653",
            style: "danger",
          });
        }

        replyMarkup = {
          reply_markup: {
            inline_keyboard: [buttonsRow],
          },
        };
      }
    }

    // Check if bola should be sent to channel instead of group
    const bolaChannelEnabled = await groupConfigService.getBolaChannelEnabled(chatId);
    let sentMessage;
    let sentToChannel = false;

    if (bolaChannelEnabled) {
      const channelId = await groupConfigService.getChannelId(chatId);
      if (channelId) {
        try {
          sentMessage = IMAGE_ENABLED
            ? await ctx.api.sendPhoto(channelId, new InputFile(buffer), { caption, parse_mode: "HTML", ...(replyMarkup || {}) })
            : await ctx.api.sendMessage(channelId, caption, { parse_mode: "HTML", ...(replyMarkup || {}) });
          sentToChannel = true;
          console.log(`Bola sent to channel ${channelId} instead of group`);
        } catch (error) {
          console.error(`Failed to send bola to channel ${channelId}, falling back to group:`, error);
          // Fallback to group if channel send fails
          sentMessage = IMAGE_ENABLED
            ? await ctx.replyWithPhoto(new InputFile(buffer), { caption, parse_mode: "HTML", ...(replyMarkup || {}) })
            : await ctx.reply(caption, { parse_mode: "HTML", ...(replyMarkup || {}) });
        }
      } else {
        // No channel configured, send to group
        sentMessage = IMAGE_ENABLED
          ? await ctx.replyWithPhoto(new InputFile(buffer), { caption, parse_mode: "HTML", ...(replyMarkup || {}) })
          : await ctx.reply(caption, { parse_mode: "HTML", ...(replyMarkup || {}) });
      }
    } else {
      // Send to group chat when channel mode is disabled (default)
      sentMessage = IMAGE_ENABLED
        ? await ctx.replyWithPhoto(new InputFile(buffer), { caption, parse_mode: "HTML", ...(replyMarkup || {}) })
        : await ctx.reply(caption, { parse_mode: "HTML", ...(replyMarkup || {}) });
    }

    // Store the message_id for this round
    if (!game.drawMessages) {
      game.drawMessages = [];
    }
    game.drawMessages[game.round - 1] = {
      message_id: sentMessage.message_id,
      round: game.round,
    };

    game.round++;

    try {
      if (gameLogger?.logGameDraw) {
        await gameLogger.logGameDraw(ctx, {
          draws: draws,
          round: game.round - 1,
          itemsRemaining: unselected.length - toDraw,
        });
      }
    } catch (error) {
      console.error("Failed to log game draw:", error);
    }
  } catch (error) {
    console.error("Error in bola command:", error);
    await ctx.reply(
      "❌ An error occurred while drawing items. Please try again.",
    );
  }
}

module.exports = { handleBola };
