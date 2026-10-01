/**
 * Theme callback handler
 * Handles select_group_for_theme_ and select_theme_ callback queries
 */

const { THEMES, THEME_NAMES } = require("../../constants/themes");
const { getDefaultPatternForTheme } = require("../../commands/config/main");

async function handleSelectGroupForThemeCallback(ctx, groupConfigService) {
  const callbackData = ctx.callbackQuery.data;
  const groupId = parseInt(callbackData.replace("select_group_for_theme_", ""), 10);
  const userId = ctx.from.id;

  try {
    // Verify admin access - check current admin status via Telegram API
    const member = await ctx.api.getChatMember(groupId, userId);
    const status = member?.status;
    const isCurrentAdmin = status === "administrator" || status === "creator";

    if (!isCurrentAdmin) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Only group administrators can configure themes for this group.",
        show_alert: true,
      });
      return;
    }

    const existingConfig = await groupConfigService.getGroupConfig(groupId);
    if (!existingConfig) {
      await ctx.answerCallbackQuery({
        text: "❌ This group hasn't been set up yet.\n\nAn admin must use /bingoset first to initialize bingo for this group.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    const visibleThemes = THEMES.filter((theme) => theme.id !== "bingulo_beta");
    const keyboard = [];
    for (let index = 0; index < visibleThemes.length; index += 2) {
      const row = visibleThemes.slice(index, index + 2).map((theme) => ({
        text: `${theme.emoji} ${theme.name}`,
        callback_data: `select_theme_${groupId}_${theme.id}`,
      }));
      keyboard.push(row);
    }

    await ctx.editMessageText(
      `🎨 <b>Select a Theme for Group ${groupId}</b>\n\n` +
        "Set your theme <b>before</b> starting a game. After choosing, use /bingostart to begin playing.\n\n" +
        "Available themes:\n" +
        visibleThemes.map((t) => `${t.emoji} <b>${t.name}</b>`).join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: keyboard,
        },
      },
    );
  } catch (error) {
    console.error("Error handling group theme select callback:", error);
    if (error.code === 403) {
      await ctx.answerCallbackQuery({
        text: "⚠️ I need admin permissions to work properly. Please make me an admin first.",
        show_alert: true,
      });
    } else {
      await ctx.answerCallbackQuery({
        text: "❌ Failed to process selection.",
        show_alert: true,
      });
    }
  }
}

async function handleSelectThemeCallback(ctx, groupConfigService, gameStateService) {
  const callbackData = ctx.callbackQuery.data;
  // Extract group ID and theme from callback_data like "select_theme_-1004423750809_toy_story"
  // Need to handle negative group IDs and theme IDs with underscores
  const rest = callbackData.replace("select_theme_", "");
  
  // Split by underscore - first part is group ID, rest is theme ID
  const parts = rest.split("_");
  
  // Group ID is the first part (could be negative like "-1004423750809")
  const groupIdStr = parts[0];
  // Theme ID is everything after the first part, joined by underscore
  const themeId = parts.slice(1).join("_");
  
  const groupId = parseInt(groupIdStr, 10);
  const userId = ctx.from.id;

  try {
    // Verify admin access - check both registered admin AND current admin status
    const existingConfig = await groupConfigService.getGroupConfig(groupId);
    let isVerifiedAdmin = existingConfig && String(existingConfig.admin_id) === String(userId);

    // If not registered admin, verify current admin status via Telegram API
    if (!isVerifiedAdmin) {
      try {
        const member = await ctx.api.getChatMember(groupId, userId);
        const status = member?.status;
        const isCurrentAdmin = status === "administrator" || status === "creator";
        
        if (!isCurrentAdmin) {
          await ctx.answerCallbackQuery({
            text: "⚠️ You are not authorized to configure this group.",
            show_alert: true,
          });
          return;
        }
        // User is a current admin, allow them to proceed
        isVerifiedAdmin = true;
      } catch (apiError) {
        // If API fails (e.g., bot lacks permissions), show helpful error
        await ctx.answerCallbackQuery({
          text: "⚠️ Could not verify admin status. Please ensure the bot has admin access and try again.",
          show_alert: true,
        });
        return;
      }
    }

    if (!isVerifiedAdmin) {
      await ctx.answerCallbackQuery({
        text: "⚠️ You are not authorized to configure this group.",
        show_alert: true,
      });
      return;
    }

    if (gameStateService.getBingoGame(groupId)) {
      await ctx.answerCallbackQuery({
        text: "Cannot change theme during an active game. Use /bingostop first.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    gameStateService.setTheme(groupId, themeId);
    await groupConfigService.updateGroupTheme(groupId, themeId);

    // Auto-set the default pattern for the theme
    const defaultPattern = getDefaultPatternForTheme(themeId);
    await groupConfigService.updateGroupPattern(groupId, JSON.stringify(defaultPattern));

    const themeLabel = THEME_NAMES[themeId] || themeId;

    await ctx.editMessageText(
      `✅ <b>Theme set to ${themeLabel}!</b>\n\n` +
        "You can now use /bingostart to begin playing.",
      { parse_mode: "HTML" },
    );
  } catch (error) {
    console.error("Error handling theme select callback:", error);
    await ctx.answerCallbackQuery({
      text: "❌ Failed to set theme.",
      show_alert: true,
    });
  }
}

module.exports = { handleSelectGroupForThemeCallback, handleSelectThemeCallback };
