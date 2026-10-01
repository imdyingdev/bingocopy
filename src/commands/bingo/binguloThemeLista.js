/**
 * Bingulo Theme Lista command: handles theme-specific lista commands for BINGULO BETA
 */

const { InputFile } = require("grammy");
const { getBinguloOverrideTheme } = require("./sharedState");
const { createDrawnItemsTable, formatDrawnItemsText } = require("./helpers");
const { IMAGE_ENABLED } = require("../../utils/imageSettings");

async function handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, themeKey, isV2 = false) {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "🚫 This command can only be used in groups, not in private messages.",
    );
    return;
  }

  const chatId = ctx.chat.id;
  const activeThemeId = gameStateService.getTheme(chatId);
  if (activeThemeId !== "bingulo_beta") {
    await ctx.reply(
      "⚠️ This command only works when the group is configured with BINGULO BETA theme.",
    );
    return;
  }

  // For non-v2 commands, restrict to admins only in group chats
  if (!isV2) {
    let isAdmin = false;
    try {
      const groupConfig = await groupConfigService.getGroupConfig(chatId);
      if (groupConfig && String(groupConfig.admin_id) === String(ctx.from.id)) {
        isAdmin = true;
      }
    } catch (e) {
      console.error("Error checking group config for admin verification:", e);
    }
    if (!isAdmin) {
      try {
        const member = await ctx.api.getChatMember(chatId, ctx.from.id);
        const status = member?.status;
        if (status === "administrator" || status === "creator") isAdmin = true;
      } catch (e) {
        console.error("Failed to verify chat member for admin check:", e);
      }
    }
    if (!isAdmin) {
      await ctx.reply("🚫 This command can only be used by group admins. Use the v2 version (e.g., /listaspongebobv2) for private viewing.");
      return;
    }
  }

  const overrideThemeId = getBinguloOverrideTheme(themeKey);
  if (!overrideThemeId) {
    await ctx.reply("⚠️ Unsupported Bingulo Beta list theme.");
    return;
  }

  // Import theme data for filtering
  const { SPONGEBOB_DATA } = require("../../data/themes/spongebobDefaultData");
  const { TOY_STORY_DATA } = require("../../data/themes/toystoryDefaultData");
  const { COMICS_DATA } = require("../../data/themes/comicsDefaultData");
  const { DATA } = require("../../data/defaultData");
  const { BINGULO_BETA_DATA } = require("../../data/themes/binguloBetaDefaultData");

  const themeDataMap = {
    spongebob: SPONGEBOB_DATA,
    toy_story: TOY_STORY_DATA,
    comics: COMICS_DATA,
    calendar: DATA,
  };

  const themeData = themeDataMap[overrideThemeId];
  if (!themeData) {
    await ctx.reply("⚠️ Theme data not found.");
    return;
  }

  // Helper function to determine which theme a value belongs to in BINGULO BETA
  function getThemeForValue(value) {
    const normalized = String(value || "").trim().toLowerCase();
    for (const [theme, themeData] of Object.entries(BINGULO_BETA_DATA)) {
      if (typeof themeData === 'object' && !Array.isArray(themeData)) {
        for (const category of Object.keys(themeData)) {
          const items = themeData[category];
          if (Array.isArray(items) && items.some((item) => String(item).trim().toLowerCase() === normalized)) {
            return theme;
          }
        }
      }
    }
    return "calendar";
  }

  // Get the game and filter the card to show only items from the requested theme
  const game = gameStateService.getBingoGame(chatId);
  if (!game) {
    await ctx.reply("No active bingo game. Start one with /bingostart");
    return;
  }

  // Create a filtered game that only shows items from the requested theme
  // Reconstruct the card with ALL items from the theme, not just items on the mixed card
  // Map BINGULO categories (S,P,N,G,E) to calendar categories (B,I,N,G,O) if needed
  const categoryMap = overrideThemeId === "calendar" ? {
    S: "B",
    P: "I",
    N: "N",
    G: "G",
    E: "O",
  } : {};

  // Get the target theme's categories
  const targetCategories = Object.keys(themeData);

  // Flatten all theme items for easier lookup regardless of category
  const allThemeItems = new Set();
  Object.values(themeData).forEach(items => {
    items.forEach(item => allThemeItems.add(String(item)));
  });

  // Reconstruct the card with ALL items from the target theme
  const reconstructedCard = targetCategories.map(category => {
    const mappedCategory = categoryMap[category] || category;
    const items = themeData[category].map(value => {
      // Check if this item is selected in the game
      const isSelected = Array.from(game.selected).some(key => {
        const [cat, val] = key.split('-');
        return String(val) === String(value);
      });
      return {
        category: mappedCategory,
        value: value,
        selected: isSelected
      };
    });
    return {
      category: mappedCategory,
      items: items
    };
  });

  const filteredGame = {
    ...game,
    card: reconstructedCard,
    selected: new Set(
      Array.from(game.selected).filter(key => {
        const [cat, val] = key.split('-');
        return allThemeItems.has(String(val));
      }).map(key => {
        const [cat, val] = key.split('-');
        // Find which category this value belongs to in the target theme
        for (const [targetCat, targetItems] of Object.entries(themeData)) {
          if (Array.isArray(targetItems) && targetItems.some(item => String(item) === String(val))) {
            const mappedCat = categoryMap[targetCat] || targetCat;
            return `${mappedCat}-${val}`;
          }
        }
        // If not found, return original
        return key;
      })
    ),
    drawOrder: game.drawOrder ? game.drawOrder.filter(([cat, val]) => {
      return allThemeItems.has(String(val));
    }).map(([cat, val]) => {
      // For all themes, we need to find the correct category in the target theme
      // The drawOrder category might be from a different theme
      // Find which category this value belongs to in the target theme
      for (const [targetCat, targetItems] of Object.entries(themeData)) {
        if (Array.isArray(targetItems) && targetItems.some(item => String(item) === String(val))) {
          const mappedCat = categoryMap[targetCat] || targetCat;
          return [mappedCat, val];
        }
      }
      // If not found, return original (shouldn't happen if value is in theme)
      console.warn(`Value ${val} not found in theme ${overrideThemeId}, using original category ${cat}`);
      return [cat, val];
    }) : [],
  };

  if (!IMAGE_ENABLED) {
    const text = formatDrawnItemsText(filteredGame, `📊 Drawn Items - ${themeKey}`);
    if (isV2) {
      try {
        await ctx.deleteMessage();
      } catch (error) {
        console.error("Couldn't delete themed lista command:", error);
      }
      await ctx.api.sendMessage(ctx.from.id, text, { parse_mode: "HTML" });
    } else {
      const bolaChannelEnabled = await groupConfigService.getBolaChannelEnabled(chatId);
      const channelId = await groupConfigService.getChannelId(chatId);
      const targetChat = bolaChannelEnabled && channelId ? channelId : chatId;
      await ctx.api.sendMessage(targetChat, text, { parse_mode: "HTML" });
    }
    return;
  }

  if (isV2) {
    // /listav2 - ephemeral photo in group chat, regular photo in private chat
    if (ctx.chat.type !== "private") {
      // Delete the command message for cleaner UX in group chat
      try {
        await ctx.deleteMessage();
      } catch (err) {
        console.error("Couldn't delete command message:", err);
      }
    }

    await ctx.replyWithChatAction("upload_photo");

    try {
      const buffer = await imageGenerationService.generateBingoDrawnItemsImage(filteredGame, ctx.chat.id, overrideThemeId);

      // Send ephemeral photo in group chat, regular photo in private chat
      if (ctx.chat.type !== "private") {
        await ctx.replyWithPhoto(new InputFile(buffer), {
          receiver_user_id: ctx.from.id,
        });
      } else {
        await ctx.replyWithPhoto(new InputFile(buffer));
      }
    } catch (error) {
      console.error("Error generating lista image:", error);
      await ctx.reply(`Error: ${error.message}`);
    }
  } else {
    // /lista - rich message (table) in group chat, regular photo in private chat
    if (ctx.chat.type !== "private") {
      // Check if bola channel is enabled - send to channel instead of group
      const bolaChannelEnabled = await groupConfigService.getBolaChannelEnabled(chatId);
      const channelId = await groupConfigService.getChannelId(chatId);
      const themeId = gameStateService.getTheme(chatId);

      // Group chat - try rich message with table
      try {
        const drawnTable = createDrawnItemsTable(filteredGame);

        if (drawnTable) {
          try {
            // Send to channel if enabled AND theme is bingulo_beta, otherwise send to group
            const targetChat = (bolaChannelEnabled && channelId && themeId === "bingulo_beta") ? channelId : chatId;
            await ctx.api.sendRichMessage(targetChat, {
              html: `<h2>📊 Drawn Items</h2>
${drawnTable}`,
            });

            if (bolaChannelEnabled && channelId && themeId === "bingulo_beta") {
              console.log(`Lista sent to channel ${channelId} instead of group`);
            }
            return;
          } catch (richMsgError) {
            console.error("[tabla-error-rich] sendRichMessage failed:", richMsgError);
            // Fallback to image
            await ctx.replyWithChatAction("upload_photo");
            // Use channel ID for image generation when sending to channel
            const targetChatForImage = (bolaChannelEnabled && channelId && themeId === "bingulo_beta") ? channelId : chatId;
            const buffer = await imageGenerationService.generateBingoDrawnItemsImage(filteredGame, targetChatForImage, overrideThemeId);

            // Send to channel if enabled AND theme is bingulo_beta, otherwise send to group
            const targetChat = (bolaChannelEnabled && channelId && themeId === "bingulo_beta") ? channelId : chatId;
            if (targetChat !== chatId) {
              await ctx.api.sendPhoto(targetChat, new InputFile(buffer));
              console.log(`Lista sent to channel ${channelId} instead of group`);
            } else {
              await ctx.replyWithPhoto(new InputFile(buffer));
            }
          }
        } else {
          // No drawn items - show image
          await ctx.replyWithChatAction("upload_photo");
          // Use channel ID for image generation when sending to channel
          const targetChatForImage = (bolaChannelEnabled && channelId && themeId === "bingulo_beta") ? channelId : chatId;
          const buffer = await imageGenerationService.generateBingoDrawnItemsImage(filteredGame, targetChatForImage, overrideThemeId);

          // Send to channel if enabled AND theme is bingulo_beta, otherwise send to group
          const targetChat = (bolaChannelEnabled && channelId && themeId === "bingulo_beta") ? channelId : chatId;
          if (targetChat !== chatId) {
            await ctx.api.sendPhoto(targetChat, new InputFile(buffer));
            console.log(`Lista sent to channel ${channelId} instead of group`);
          } else {
            await ctx.replyWithPhoto(new InputFile(buffer));
          }
        }
      } catch (error) {
        console.error("[lista-error] Unexpected error:", error.message);
        // Last resort fallback
        await ctx.replyWithChatAction("upload_photo");
        // Use channel ID for image generation when sending to channel
        const targetChatForImage = (bolaChannelEnabled && channelId && themeId === "bingulo_beta") ? channelId : chatId;
        const buffer = await imageGenerationService.generateBingoDrawnItemsImage(filteredGame, targetChatForImage, overrideThemeId);

        // Send to channel if enabled AND theme is bingulo_beta, otherwise send to group
        const targetChat = (bolaChannelEnabled && channelId && themeId === "bingulo_beta") ? channelId : chatId;
        if (targetChat !== chatId) {
          await ctx.api.sendPhoto(targetChat, new InputFile(buffer));
          console.log(`Lista sent to channel ${channelId} instead of group`);
        } else {
          await ctx.replyWithPhoto(new InputFile(buffer));
        }
      }
    } else {
      // Private chat - show image
      await ctx.replyWithChatAction("upload_photo");
      try {
        const buffer = await imageGenerationService.generateBingoDrawnItemsImage(filteredGame, ctx.chat.id, overrideThemeId);
        await ctx.replyWithPhoto(new InputFile(buffer));
      } catch (error) {
        console.error("Error generating lista image:", error);
        await ctx.reply(`Error: ${error.message}`);
      }
    }
  }
}

module.exports = { handleBinguloThemeLista };
