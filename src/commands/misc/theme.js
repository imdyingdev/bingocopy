/**
 * Theme command handler - /theme for selecting bingo themes
 */

const { THEMES } = require("../../constants/themes");
const { THEME_EMOJIS } = require("../../constants/themeEmojis");

async function showThemePicker(ctx, groupId, groupName, gameStateService, botSettingsService) {
  if (gameStateService.getBingoGame(groupId)) {
    await ctx.reply(
      "❌ <b>Cannot change theme during an active game.</b>\n\n" +
        "Use /bingostop to end the current game first, then set your theme before the next /bingostart.",
      { parse_mode: "HTML" },
    );
    return;
  }

  // Check premium status for custom emoji support
  const usePremiumEmoji = await botSettingsService.getPremiumEmojiEnabled();

  // Filter out bingulo_beta from the theme picker (keep code intact, just hide from UI)
  const visibleThemes = THEMES.filter(theme => theme.id !== 'bingulo_beta');

  const keyboard = [];
  for (let i = 0; i < visibleThemes.length; i += 2) {
    const row = [];
    
    // First button in row
    const theme1 = visibleThemes[i];
    let button1 = {
      text: `${visibleThemes[i].emoji} ${visibleThemes[i].name}`,
      callback_data: `select_theme_${groupId}_${visibleThemes[i].id}`,
    };
    
    // Add custom emoji icon if premium is enabled and theme has themeIcon
    if (usePremiumEmoji && THEME_EMOJIS[theme1.id] && THEME_EMOJIS[theme1.id].themeIcon) {
      const themeIcon = THEME_EMOJIS[theme1.id].themeIcon;
      const iconId = Array.isArray(themeIcon) 
        ? themeIcon[Math.floor(Math.random() * themeIcon.length)] 
        : themeIcon;
      button1.icon_custom_emoji_id = iconId;
      button1.text = theme1.name; // Remove default emoji when using custom icon
    }
    
    row.push(button1);
    
    // Second button in row (if exists)
    if (visibleThemes[i + 1]) {
      const theme2 = visibleThemes[i + 1];
      let button2 = {
        text: `${visibleThemes[i + 1].emoji} ${visibleThemes[i + 1].name}`,
        callback_data: `select_theme_${groupId}_${visibleThemes[i + 1].id}`,
      };
      
      // Add custom emoji icon if premium is enabled and theme has themeIcon
      if (usePremiumEmoji && THEME_EMOJIS[theme2.id] && THEME_EMOJIS[theme2.id].themeIcon) {
        const themeIcon = THEME_EMOJIS[theme2.id].themeIcon;
        const iconId = Array.isArray(themeIcon) 
          ? themeIcon[Math.floor(Math.random() * themeIcon.length)] 
          : themeIcon;
        button2.icon_custom_emoji_id = iconId;
        button2.text = theme2.name; // Remove default emoji when using custom icon
      }
      
      row.push(button2);
    }
    
    keyboard.push(row);
  }

  // Build header text with custom emoji if premium is enabled
  let headerText = `🎨 <b>Select a Theme for ${groupName}</b>`;
  if (usePremiumEmoji && THEME_EMOJIS.themePickerHeader) {
    const placeholderEmoji = '🎨';
    headerText = `<tg-emoji emoji-id="${THEME_EMOJIS.themePickerHeader}">${placeholderEmoji}</tg-emoji> <b>Select a Theme for ${groupName}</b>`;
  }

  await ctx.reply(
    `${headerText}\n\n` +
      "Set your theme <b>before</b> starting a game. After choosing, use /bingostart to begin playing.",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: keyboard,
      },
    },
  );
}

async function handleTheme(ctx, gameStateService, groupConfigService, botSettingsService) {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "🚫 This command can only be used in groups, not in private messages.\n\n" +
        "Please go to your group and use /theme there to change the theme.",
      { parse_mode: "HTML" },
    );
    return;
  }

  const groupId = ctx.chat.id;
  const groupName = ctx.chat.title || `Group ${groupId}`;
  const userId = ctx.from.id;

  try {
    const member = await ctx.api.getChatMember(groupId, userId);
    const status = member?.status;
    const isAdmin = status === "administrator" || status === "creator";

    if (!isAdmin) {
      await ctx.reply(
        "⚠️ Only group administrators can change the theme for this group.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const existingConfig = await groupConfigService.getGroupConfig(groupId);
    if (!existingConfig) {
      await ctx.reply(
        "❌ This group hasn't been set up yet.\n\n" +
          "An admin must use /bingoset first to initialize bingo for this group.",
        { parse_mode: "HTML" },
      );
      return;
    }

    await showThemePicker(ctx, groupId, groupName, gameStateService, botSettingsService);
  } catch (error) {
    console.error("Error in /theme:", error);
    if (error.code === 403) {
      await ctx.reply(
        "⚠️ I need admin permissions to work properly. Please make me an admin first.",
      );
    } else {
      await ctx.reply(
        "❌ Failed to check admin status. Make sure the bot is in the group and you are an admin.",
      );
    }
  }
}

module.exports = {
  handleTheme,
  showThemePicker,
};
