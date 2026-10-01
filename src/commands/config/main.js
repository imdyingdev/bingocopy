/**
 * Configuration commands: /bingoset, /bingopattern, /bingofundsfrom, /spongebob
 */

const { THEMES } = require("../../constants/themes");
const { THEME_EMOJIS } = require("../../constants/themeEmojis");
const { ONEPIECE_DATA } = require("../../data/themes/onepieceDefaultData");
const { TOY_STORY_DATA } = require("../../data/themes/toystoryDefaultData");
const { SPONGEBOB_DATA } = require("../../data/themes/spongebobDefaultData");
const { COMICS_DATA } = require("../../data/themes/comicsDefaultData");
const { FROZEN_DATA } = require("../../data/themes/frozenDefaultData");
const { MINIONS_DATA } = require("../../data/themes/minionsDefaultData");
const { LOVERS_SOIREE_DATA } = require("../../data/themes/loversSoireeDefaultData");
const { BINGULO_BETA_DATA } = require("../../data/themes/binguloBetaDefaultData");
const { DATA } = require("../../data/defaultData");

const GROUP_SETUP_PROMPT_MESSAGES = [
  "Pwede ba to dito?",
  "Mas okay ba ito dito?",
  "Pwede bang gamitin dito?",
  "Gagamitin ba ito sa group na to?",
  "Puwede ba ang bot na ito sa GC na ito?",
  "Hmmmmmmmmmmmmmmmmmmmm",
  "Yeyeys ano na?",
  "Pwede ba dito?",
  "sakupin na ba tong gc na to?"
];

function getRandomGroupSetupPromptMessage() {
  return GROUP_SETUP_PROMPT_MESSAGES[
    Math.floor(Math.random() * GROUP_SETUP_PROMPT_MESSAGES.length)
  ];
}

function buildBinguloBetaPattern() {
  // Return the nested BINGULO Beta structure directly
  const { BINGULO_BETA_DATA } = require("../../data/themes/binguloBetaDefaultData");
  return BINGULO_BETA_DATA;
}

/**
 * Get default pattern for a theme
 */
function getDefaultPatternForTheme(themeId) {
  if (themeId === "spongebob") {
    return SPONGEBOB_DATA;
  }
  if (themeId === "comics") {
    return COMICS_DATA;
  }
  if (themeId === "onepiece" || themeId === "onepiece_v2") {
    return ONEPIECE_DATA;
  }
  if (themeId === "toy_story") {
    return TOY_STORY_DATA;
  }
  if (themeId === "frozen") {
    return FROZEN_DATA;
  }
  if (themeId === "minions") {
    return MINIONS_DATA;
  }
  if (themeId === "lovers_soiree") {
    return LOVERS_SOIREE_DATA;
  }
  if (themeId === "bingulo_beta") {
    return buildBinguloBetaPattern();
  }
  // Default theme
  return DATA;
}

async function handleBingoSet(ctx, groupConfigService, bingoFundsService, botSettingsService, gameStateService = null) {
  const userId = ctx.from.id;
  
  // Handle private message - show groups for admin to configure
  if (ctx.chat.type === "private") {
    const args = ctx.match ? ctx.match.trim() : "";
    const groupId = args ? parseInt(args, 10) : null;
    
    try {
      const adminGroups = await groupConfigService.getAdminGroups(userId);
      
      if (adminGroups.length === 0) {
        // No groups - prompt to run in a group first
        await ctx.reply(
          "❌ You are not registered as an admin for any group.\n\n" +
          "Use /bingoset in a group first, then come back to private chat to configure themes and patterns.",
          { parse_mode: "HTML" },
        );
        return;
      }
      
      // If groupId specified, show theme picker for that group
      if (groupId) {
        const hasConfig = adminGroups.some(g => Number(g.group_id) === Number(groupId));
        if (!hasConfig) {
          await ctx.reply(
            "❌ You are not registered as an admin for that group. Please run /bingoset in the group first.",
            { parse_mode: "HTML" },
          );
          return;
        }
        await showThemePickerForGroup(ctx, groupId, groupConfigService, bingoFundsService, botSettingsService);
        return;
      }
      
      // Multiple groups - show selection
      if (adminGroups.length === 1) {
        const targetGroupId = Number(adminGroups[0].group_id);
        await showThemePickerForGroup(ctx, targetGroupId, groupConfigService, bingoFundsService, botSettingsService);
      } else {
        const buttons = [];
        for (const groupConfig of adminGroups) {
          let title = `Group ${groupConfig.group_id}`;
          try {
            const chat = await ctx.api.getChat(groupConfig.group_id);
            if (chat && chat.title) {
              title = chat.title;
            }
          } catch (e) {
            console.error(
              `Could not fetch chat title for ${groupConfig.group_id}:`,
              e,
            );
          }
          buttons.push([
            {
              text: title,
              callback_data: `select_group_for_theme_${groupConfig.group_id}`,
            },
          ]);
        }
        
        await ctx.reply(
          "📂 <b>You are an admin of multiple groups.</b>\n\n" +
          "Please select which group you want to configure:",
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: buttons,
            },
          },
        );
      }
    } catch (error) {
      console.error("Error in /bingoset (private):", error);
      await ctx.reply("❌ Failed to load your admin groups. Please try again.");
    }
    return;
  }

  // Group chat flow
  const groupId = ctx.chat.id;

  // If the group already passed the approval gate, show the normal theme
  // picker flow instead of collapsing into a one-line reminder. That lets
  // the admin re-enter the /bingoset experience and pick a themed default
  // dataset the same way the original setup UI would.
  const existingGroupSetup = await groupConfigService.getGroupConfig(groupId);
  if (existingGroupSetup?.setup_confirmed === true) {
    await showThemePickerForGroup(ctx, groupId, groupConfigService, bingoFundsService, botSettingsService);
    return;
  }

  if (gameStateService) {
    gameStateService.resetMinionMonsterMode(groupId);
  }

  const isFundsOnly = await bingoFundsService.isFundsOnlyGroup(groupId);
  if (isFundsOnly) {
    const fundsGroupName = await bingoFundsService.getFundsGroupName(groupId);
    await ctx.reply(
      `🚫 <b>Configuration Not Allowed</b>\n\n` +
      `This group (<b>${fundsGroupName || 'Funds Group'}</b>) is configured as a funds management group only.\n\n` +
      `Bingo configuration commands are disabled here. Please use the main gameplay group to configure bingo.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  try {
    const member = await ctx.api.getChatMember(groupId, userId);

    if (
      !member ||
      (member.status !== "administrator" && member.status !== "creator")
    ) {
      await ctx.reply("⚠️ Only group administrators can use this command.");
      return;
    }

    const config = await groupConfigService.createGroupConfig(groupId, userId);
    const groupTitle = ctx.chat.title;
    if (groupTitle) {
      await groupConfigService.updateGroupName(groupId, groupTitle);
    }

    // Record the pending setup approval request in the group config table.
    await groupConfigService.requestGroupSetupApproval(groupId, userId);

    const groupSetupPrompt = getRandomGroupSetupPromptMessage();
    const approveKeyboard = {
      inline_keyboard: [
        [
          { text: "✅ Confirm", callback_data: `approve_group_setup_${groupId}` },
        ],
      ],
    };

    await ctx.reply(groupSetupPrompt, {
      reply_markup: approveKeyboard,
    });
  } catch (error) {
    console.error("Error in /bingoset:", error);
    console.error("Error code:", error.code || "No code");
    console.error("Error description:", error.description || error.message || "No description");
    
    if (error.code === 403) {
      await ctx.reply(
        "⚠️ I need admin permissions to work properly. Please make me an admin first.",
      );
    } else if (error.code === 400 || error.description?.includes("member not found")) {
      await ctx.reply(
        "⚠️ Could not verify admin status. Make sure the bot is still in the group and you are an admin.",
      );
    } else {
      await ctx.reply("❌ Failed to configure bingo. Please try again.");
    }
  }
}

/**
 * Show theme picker for a specific group
 * Uses the same 2-column layout and premium emoji support as /theme command
 * But with different description for /bingoset (initialization vs theme change)
 */
async function showThemePickerForGroup(ctx, groupId, groupConfigService, bingoFundsService, botSettingsService) {
  try {
    let title = `Group ${groupId}`;
    try {
      const chat = await ctx.api.getChat(groupId);
      if (chat && chat.title) {
        title = chat.title;
      }
    } catch (e) {}

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
    let headerText = `🎯 <b>Bingo initialized for: ${title}</b>`;
    if (usePremiumEmoji && THEME_EMOJIS.themePickerHeader) {
      const placeholderEmoji = '🎯';
      headerText = `<tg-emoji emoji-id="${THEME_EMOJIS.themePickerHeader}">${placeholderEmoji}</tg-emoji> <b>Bingo initialized for: ${title}</b>`;
    }

    await ctx.reply(
      `${headerText}\n\n` +
      "Select a theme below. Each theme includes default items so you can start playing immediately, or choose to set a custom pattern later.\n\n" +
      "After selecting a theme, use /bingostart to begin the game.",
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: keyboard,
        },
      },
    );
  } catch (error) {
    console.error("Error showing theme picker:", error);
    await ctx.reply("❌ Failed to show theme picker.");
  }
}

async function handleBingoPattern(ctx, groupConfigService, gameStateService) {
  if (ctx.chat.type !== "private") {
    await ctx.reply(
      "🚫 This command can only be used in private chat, not in groups.",
    );
    return;
  }

  const userId = ctx.from.id;
  const args = ctx.match ? ctx.match.trim() : "";

  try {
    if (args) {
      const targetGroupId = parseInt(args, 10);
      if (!isNaN(targetGroupId)) {
        const existingConfig = await groupConfigService.getGroupConfig(targetGroupId);
        const isGroupIdAdmin = existingConfig && String(existingConfig.admin_id) === String(userId);
        
        if (isGroupIdAdmin) {
          const { startPatternConfig } = require("../../handlers/patternHandler");
          await startPatternConfig(ctx, targetGroupId, null, gameStateService);
          return;
        }
      }
    }

    const adminGroups = await groupConfigService.getAdminGroups(userId);

    if (adminGroups.length === 0) {
      await ctx.reply(
        "❌ You are not registered as an admin for any group.\n\n" +
          "Use /bingoset in a group first to become an admin.",
        { parse_mode: "HTML" },
      );
      return;
    }

    if (adminGroups.length === 1) {
      const { startPatternConfig } = require("../../handlers/patternHandler");
      await startPatternConfig(ctx, parseInt(adminGroups[0].group_id, 10), null, gameStateService);
    } else {
      const buttons = [];
      for (const groupConfig of adminGroups) {
        let title = `Group ${groupConfig.group_id}`;
        try {
          const chat = await ctx.api.getChat(groupConfig.group_id);
          if (chat && chat.title) {
            title = chat.title;
          }
        } catch (e) {
          console.error(
            `Could not fetch chat title for ${groupConfig.group_id}:`,
            e,
          );
        }
        buttons.push([
          {
            text: title,
            callback_data: `select_group_pattern_${groupConfig.group_id}`,
          },
        ]);
      }

      await ctx.reply(
        "📂 <b>You are an admin of multiple groups.</b>\n\n" +
          "Please select which group you want to configure the pattern for:",
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: buttons,
          },
        },
      );
    }
  } catch (error) {
    console.error("Error in /bingopattern:", error);
    await ctx.reply("❌ Failed to start pattern configuration.");
  }
}

async function handleBingoFundsFrom(ctx, groupConfigService, bingoFundsService, gameStateService) {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "🚫 This command can only be used in groups, not in private messages.",
    );
    return;
  }

  if (!(await isAdmin(ctx))) {
    await ctx.reply("❌ Only admins can use this command.");
    return;
  }

  const currentGroupId = ctx.chat.id;
  const currentGroupName = ctx.chat.title;
  const userId = ctx.from.id;

  if (currentGroupName) {
    await groupConfigService.updateGroupName(currentGroupId, currentGroupName);
  }

  const isFundsOnly = await bingoFundsService.isFundsOnlyGroup(currentGroupId);
  if (isFundsOnly) {
    const fundsGroupName = await bingoFundsService.getFundsGroupName(currentGroupId);
    await ctx.reply(
      `🚫 <b>Command Not Allowed</b>\n\n` +
      `This group (<b>${fundsGroupName || 'Funds Group'}</b>) is configured as a funds management group only.\n\n` +
      `Funds linking commands are disabled here. Please use the main gameplay group to link funds.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  gameStateService.clearPatternConfigurationState(userId);

  try {
    const adminGroups = await groupConfigService.getAdminGroups(userId);

    if (adminGroups.length === 0) {
      await ctx.reply("❌ You are not configured as admin for any groups.");
      return;
    }

    for (const group of adminGroups) {
      let groupName = group.group_name || `Group ${group.group_id}`;
      try {
        const chat = await ctx.api.getChat(group.group_id);
        if (chat && chat.title) {
          groupName = chat.title;
          await groupConfigService.updateGroupName(group.group_id, groupName);
        }
      } catch (e) {}
      await bingoFundsService.registerFundsGroup(group.group_id, groupName);
    }

    const fundsGroups = await bingoFundsService.getRegisteredFundsGroups();

    if (fundsGroups.length === 0) {
      await ctx.reply("No funds groups available.");
      return;
    }

    const keyboard = fundsGroups.map((group) => [
      {
        text: group.group_name,
        callback_data: `select_funds_group_${group.group_id}`,
      },
    ]);

    const currentMapping = await bingoFundsService.getFundsGroupMapping(currentGroupId);
    let mappingInfo = "";
    if (currentMapping) {
      const mappedGroup = fundsGroups.find((g) => g.group_id === currentMapping.funds_group_id);
      if (mappedGroup) {
        mappingInfo = `\n\n🔗 Currently linked to: <b>${mappedGroup.group_name}</b>`;
      }
    }

    await ctx.reply(
      `📋 <b>Select Funds Group</b>\n\nCurrent group: <b>${currentGroupName}</b>${mappingInfo}\n\nChoose which group's funds to use:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: keyboard,
        },
      },
    );
  } catch (error) {
    console.error("Error in /bingofundsfrom:", error);
    await ctx.reply("❌ Failed to load funds groups.");
  }
}

async function handleSpongebob(ctx, gameStateService) {
  if (ctx.chat.type !== "private") {
    return;
  }

  const ALLOWED_USER_ID = 8442877660;
  if (ctx.from.id !== ALLOWED_USER_ID) {
    return;
  }

  const args = ctx.match ? ctx.match.trim() : "";
  const parts = args.split(" ");
  const action = parts[0] ? parts[0].toLowerCase() : "";
  const targetGroupId = parts[1] || "global";

  console.log("Spongebob command - Action:", action, "Target:", targetGroupId);

  if (action === "on") {
    gameStateService.setSpongebobMode(targetGroupId, true);
    if (targetGroupId === "global") {
      await ctx.reply(
        "🧽 <b>SpongeBob theme enabled globally!</b>\n\n" +
        "🍍 All /bola and /bingo commands will now use the SpongeBob-themed design!\n" +
        "Use /spongebob off to disable.",
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply(
        `🧽 <b>SpongeBob theme enabled for group ${targetGroupId}!</b>\n\n` +
        "🍍 /bola and /bingo commands in that group will use the SpongeBob-themed design!\n" +
        "Use /spongebob off " + targetGroupId + " to disable.",
        { parse_mode: "HTML" },
      );
    }
  } else if (action === "off") {
    gameStateService.setSpongebobMode(targetGroupId, false);
    if (targetGroupId === "global") {
      await ctx.reply(
        "🚫 <b>SpongeBob theme disabled globally!</b>\n\n" +
        "All /bola and /bingo commands will use the default design.\n" +
        "Use /spongebob on to enable again.",
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply(
        `🚫 <b>SpongeBob theme disabled for group ${targetGroupId}!</b>\n\n` +
        "/bola and /bingo commands in that group will use the default design.\n" +
        "Use /spongebob on " + targetGroupId + " to enable again.",
        { parse_mode: "HTML" },
      );
    }
  } else {
    const spongebobModeMap = gameStateService.getSpongebobModeMap();
    const globalStatus = spongebobModeMap.get("global") ? "ON" : "OFF";
    const testGroupStatus = spongebobModeMap.get("-1003748339504") ? "ON" : "OFF";
    await ctx.reply(
      `🧽 <b>SpongeBob Theme Status:</b>\n\n` +
      `Global: ${globalStatus}\n` +
      `Test Group (-1003748339504): ${testGroupStatus}\n\n` +
      `Usage:\n` +
      `/spongebob on - Enable globally\n` +
      `/spongebob off - Disable globally\n` +
      `/spongebob on -1003748339504 - Enable for test group\n` +
      `/spongebob off -1003748339504 - Disable for test group`,
      { parse_mode: "HTML" },
    );
  }
}

// Map of userId -> pending channel link info { groupId, mode: 'forward'|'manual' }
const pendingChannelLinks = new Map();

function setPendingChannelLink(userId, info) {
  pendingChannelLinks.set(String(userId), info);
}

function getPendingChannelLink(userId) {
  return pendingChannelLinks.get(String(userId)) || null;
}

function clearPendingChannelLink(userId) {
  pendingChannelLinks.delete(String(userId));
}

async function handleBolaChannel(ctx, groupConfigService) {
  if (ctx.chat.type === "private") {
    await ctx.reply("🚫 This command can only be used in groups, not in private messages.");
    return;
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from.id;

  // Check if user is admin
  let isAdmin = false;
  try {
    const groupConfig = await groupConfigService.getGroupConfig(groupId);
    if (groupConfig && String(groupConfig.admin_id) === String(userId)) {
      isAdmin = true;
    }
  } catch (e) {
    console.error("Error checking group config for admin verification:", e);
  }
  if (!isAdmin) {
    try {
      const member = await ctx.api.getChatMember(groupId, userId);
      const status = member?.status;
      if (status === "administrator" || status === "creator") isAdmin = true;
    } catch (e) {
      console.error("Failed to verify chat member for admin check:", e);
    }
  }
  if (!isAdmin) {
    await ctx.reply("🚫 This command can only be used by group admins.");
    return;
  }

  const args = ctx.message.text.split(" ").slice(1);
  const action = args[0]?.toLowerCase();

  if (action === "on") {
    await groupConfigService.setBolaChannelEnabled(groupId, true);
    await ctx.reply("✅ Bola channel enabled. /bola commands will now also send to the configured channel.");
  } else if (action === "off") {
    await groupConfigService.setBolaChannelEnabled(groupId, false);
    await ctx.reply("✅ Bola channel disabled. /bola commands will only send to the group chat.");
  } else {
    await ctx.reply("Usage: /bolachannel on or /bolachannel off");
  }
}

async function handleBolaTimer(ctx, groupConfigService, bolaTimerManager) {
  if (ctx.chat.type === "private") {
    await ctx.reply("🚫 This command can only be used in groups, not in private messages.");
    return;
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from.id;

  // Check if user is admin
  let isAdmin = false;
  try {
    const groupConfig = await groupConfigService.getGroupConfig(groupId);
    if (groupConfig && String(groupConfig.admin_id) === String(userId)) {
      isAdmin = true;
    }
  } catch (e) {
    console.error("Error checking group config for admin verification:", e);
  }
  if (!isAdmin) {
    try {
      const member = await ctx.api.getChatMember(groupId, userId);
      const status = member?.status;
      if (status === "administrator" || status === "creator") isAdmin = true;
    } catch (e) {
      console.error("Failed to verify chat member for admin check:", e);
    }
  }
  if (!isAdmin) {
    await ctx.reply("🚫 This command can only be used by group admins.");
    return;
  }

  const args = ctx.message.text.split(" ").slice(1);
  const action = args[0]?.toLowerCase();

  if (action === "off") {
    await groupConfigService.setBolaTimerConfig(groupId, false, 10);
    bolaTimerManager.stopTimer(groupId);
    await ctx.reply("✅ Bola timer disabled.");
    return;
  }

  const interval = parseInt(args[0], 10);
  if (isNaN(interval) || interval < 1) {
    await ctx.reply("Usage: /bolatimer <seconds> or /bolatimer off\nExample: /bolatimer 10");
    return;
  }

  await groupConfigService.setBolaTimerConfig(groupId, true, interval);
  bolaTimerManager.startTimer(groupId, interval);
  await ctx.reply(`✅ Bola timer enabled. Will send /bola every ${interval} seconds to the configured channel.`);
}

async function handleBingoChannel(ctx, groupConfigService, gameStateService) {
  if (ctx.chat.type !== "private") {
    await ctx.reply(
      "🔐 Please run this command in a private chat with the bot. Open a DM with me and use /bingochannel to configure a group's channel."
    );
    return;
  }

  const userId = ctx.from.id;
  const argsText = (ctx.message && ctx.message.text) ? ctx.message.text.split(" ").slice(1).join(" ").trim() : "";

  try {
    const adminGroups = await groupConfigService.getAdminGroups(userId);
    if (!adminGroups || adminGroups.length === 0) {
      await ctx.reply(
        "❌ You are not registered as an admin for any group.\n\nRun /bingoset in a group first to initialize bingo and register yourself as admin."
      );
      return;
    }

    // If the user provided a group id as argument, try to use it
    if (argsText) {
      const maybeGroupId = parseInt(argsText, 10);
      if (!isNaN(maybeGroupId)) {
        const isAdmin = adminGroups.some((g) => Number(g.group_id) === Number(maybeGroupId));
        if (isAdmin) {
          // Ask which channel to link for this group
          await promptChannelChoice(ctx, maybeGroupId, groupConfigService, gameStateService);
          return;
        }
      }
    }

    if (adminGroups.length === 1) {
      const targetGroupId = Number(adminGroups[0].group_id);
      await promptChannelChoice(ctx, targetGroupId, groupConfigService, gameStateService);
      return;
    }

    // If multiple groups, show a selection keyboard
    const buttons = [];
    for (const groupConfig of adminGroups) {
      let title = `Group ${groupConfig.group_id}`;
      try {
        const chat = await ctx.api.getChat(groupConfig.group_id);
        if (chat && chat.title) title = chat.title;
      } catch (e) {}
      buttons.push([
        { text: title, callback_data: `select_bingochannel_group_${groupConfig.group_id}` },
      ]);
    }

    await ctx.reply(
      "📂 <b>Select which group you want to configure a channel for:</b>",
      { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } },
    );
  } catch (error) {
    console.error("Error in /bingochannel (DM flow):", error);
    await ctx.reply("❌ Failed to start channel linking. Check logs.");
  }
}

async function promptChannelChoice(ctx, groupId, groupConfigService, gameStateService) {
  let title = `Group ${groupId}`;
  try {
    const chat = await ctx.api.getChat(groupId);
    if (chat && chat.title) title = chat.title;
  } catch (e) {}

  const keyboard = [
    [ { text: "📨 Forward a message from the channel", callback_data: `bingochannel_forward_${groupId}` } ],
    [ { text: "⌨️ Enter channel @username or ID", callback_data: `bingochannel_manual_${groupId}` } ],
    [ { text: "🗑️ Clear configured channel", callback_data: `bingochannel_clear_${groupId}` } ],
    [ { text: "❌ Cancel", callback_data: `bingochannel_cancel_${groupId}` } ],
  ];

  await ctx.reply(
    `🔗 <b>What channel do you want to connect in ${title}?</b>\n\n` +
    "You can forward a message from the channel to this chat, or enter the channel's @username or numeric ID.",
    { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } },
  );
}

async function handleAdminFunds(ctx, groupConfigService) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    await ctx.reply("❌ Invalid context.");
    return;
  }

  // Gate all non-setup commands behind the stored group approval row.
  const isGroupSetupConfirmed = await groupConfigService.isCommandAllowedInGroup(chatId, []);
  if (!isGroupSetupConfirmed) {
    await ctx.reply("❌ This command is not available in this group.");
    return;
  }

  // Check if user is admin
  const isUserAdmin = await isAdmin(ctx);
  if (!isUserAdmin) {
    await ctx.reply("❌ This command is only for admins.");
    return;
  }

  // Parse amount from command (supports +10, -10, or just 10 to set)
  const args = ctx.message.text.split(' ');
  const amountStr = args[1];

  if (!amountStr) {
    const currentFunds = await groupConfigService.getAdminFunds(chatId);
    await ctx.reply(`💰 Current Admin Funds: ₱${currentFunds.toLocaleString()}\n\nUsage: /adminfunds +10 (add) or /adminfunds -10 (subtract) or /adminfunds 100 (set)`);
    return;
  }

  const isAdd = amountStr.startsWith('+');
  const isSubtract = amountStr.startsWith('-');
  const amount = parseInt(amountStr.replace(/[+-]/, ''), 10);

  if (isNaN(amount)) {
    await ctx.reply("Usage: /adminfunds +10 (add) or /adminfunds -10 (subtract) or /adminfunds 100 (set)");
    return;
  }

  try {
    let newBalance;
    if (isAdd) {
      newBalance = await groupConfigService.updateAdminFunds(chatId, amount);
      await ctx.reply(`✅ Added ₱${amount} to admin funds. New balance: ₱${newBalance.toLocaleString()}`);
    } else if (isSubtract) {
      newBalance = await groupConfigService.updateAdminFunds(chatId, -amount);
      await ctx.reply(`✅ Subtracted ₱${amount} from admin funds. New balance: ₱${newBalance.toLocaleString()}`);
    } else {
      // Set absolute value - need to calculate difference
      const currentFunds = await groupConfigService.getAdminFunds(chatId);
      const difference = amount - currentFunds;
      newBalance = await groupConfigService.updateAdminFunds(chatId, difference);
      await ctx.reply(`✅ Admin funds set to ₱${amount.toLocaleString()}`);
    }
  } catch (error) {
    console.error("Error updating admin funds:", error);
    await ctx.reply("❌ Failed to update admin funds.");
  }
}

async function handleBingobankFunds(ctx, groupConfigService) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    await ctx.reply("❌ Invalid context.");
    return;
  }

  // Gate all non-setup commands behind the stored group approval row.
  const isGroupSetupConfirmed = await groupConfigService.isCommandAllowedInGroup(chatId, []);
  if (!isGroupSetupConfirmed) {
    await ctx.reply("❌ This command is not available in this group.");
    return;
  }

  // Check if user is admin
  const isUserAdmin = await isAdmin(ctx);
  if (!isUserAdmin) {
    await ctx.reply("❌ This command is only for admins.");
    return;
  }

  // Parse amount from command (supports +10, -10, or just 10 to set)
  const args = ctx.message.text.split(' ');
  const amountStr = args[1];

  if (!amountStr) {
    const currentFunds = await groupConfigService.getBingobankFunds(chatId);
    await ctx.reply(`💰 Current Bingo Bank: ₱${currentFunds.toLocaleString()}\n\nUsage: /bingobank +10 (add) or /bingobank -10 (subtract) or /bingobank 100 (set)`);
    return;
  }

  const isAdd = amountStr.startsWith('+');
  const isSubtract = amountStr.startsWith('-');
  const amount = parseInt(amountStr.replace(/[+-]/, ''), 10);

  if (isNaN(amount)) {
    await ctx.reply("Usage: /bingobank +10 (add) or /bingobank -10 (subtract) or /bingobank 100 (set)");
    return;
  }

  try {
    let newBalance;
    if (isAdd) {
      newBalance = await groupConfigService.updateBingobankFunds(chatId, amount);
      await ctx.reply(`✅ Added ₱${amount} to bingo bank. New balance: ₱${newBalance.toLocaleString()}`);
    } else if (isSubtract) {
      newBalance = await groupConfigService.updateBingobankFunds(chatId, -amount);
      await ctx.reply(`✅ Subtracted ₱${amount} from bingo bank. New balance: ₱${newBalance.toLocaleString()}`);
    } else {
      // Set absolute value - need to calculate difference
      const currentFunds = await groupConfigService.getBingobankFunds(chatId);
      const difference = amount - currentFunds;
      newBalance = await groupConfigService.updateBingobankFunds(chatId, difference);
      await ctx.reply(`✅ Bingo bank set to ₱${amount.toLocaleString()}`);
    }
  } catch (error) {
    console.error("Error updating bingobank funds:", error);
    await ctx.reply("❌ Failed to update bingo bank.");
  }
}

async function handleSetLog(ctx, groupConfigService) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (!userId || !chatId) {
    await ctx.reply("❌ Invalid context.");
    return;
  }

  // Check if user is admin
  const isUserAdmin = await isAdmin(ctx);
  if (!isUserAdmin) {
    await ctx.reply("❌ This command is only for admins.");
    return;
  }

  const args = ctx.message.text.split(' ');
  const logChatIdStr = args[1];

  if (!logChatIdStr) {
    const currentLogChatId = await groupConfigService.getLogChatId(chatId);
    if (currentLogChatId) {
      await ctx.reply(`📝 Current Log Chat ID: ${currentLogChatId}\n\nUsage: /setlog <chat_id> to set the log chat, or /setlog clear to remove it.`);
    } else {
      await ctx.reply(`📝 No log chat configured.\n\nUsage: /setlog <chat_id> to set where fund logs will be sent after each game, or /setlog clear to remove it.`);
    }
    return;
  }

  if (logChatIdStr.toLowerCase() === 'clear') {
    await groupConfigService.updateLogChatId(chatId, null);
    await ctx.reply("✅ Log chat cleared. Fund logs will no longer be sent.");
    return;
  }

  const logChatId = parseInt(logChatIdStr, 10);
  if (isNaN(logChatId)) {
    await ctx.reply("❌ Invalid chat ID. Please provide a valid numeric chat ID.");
    return;
  }

  try {
    await groupConfigService.updateLogChatId(chatId, logChatId);
    await ctx.reply(`✅ Log chat set to ${logChatId}. Fund logs will be sent to this chat after each game ends.`);
  } catch (error) {
    console.error("Error setting log chat ID:", error);
    await ctx.reply("❌ Failed to set log chat ID.");
  }
}

async function isAdmin(ctx) {
  try {
    const userId = ctx.from?.id;
    if (!userId) {
      console.error("No user ID in context");
      return false;
    }
    const chatMember = await ctx.getChatMember(userId);
    return chatMember.status === "administrator" || chatMember.status === "creator";
  } catch (error) {
    console.error("Error checking admin status:", error);
    return false;
  }
}

module.exports = {
  handleBingoSet,
  handleBingoPattern,
  handleBingoFundsFrom,
  handleSpongebob,
  handleBingoChannel,
  handleBolaChannel,
  handleBolaTimer,
  handleAdminFunds,
  handleBingobankFunds,
  handleSetLog,
  // pending channel linking helpers
  setPendingChannelLink,
  getPendingChannelLink,
  clearPendingChannelLink,
  // theme helpers
  getDefaultPatternForTheme,
};