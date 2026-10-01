/**
 * /start command handler
 */

const { GROUP_SPECIFIC_COMMANDS } = require("../../utils/constants");

async function handleStart(ctx, groupConfigService, gameStateService, userModel, bingoFundsService) {
  const text = String(ctx.message?.text || "").trim();
  const payload = text.split(" ").slice(1).join(" ") || null;

  // Check if this command is allowed in the current group
  if (ctx.chat.type !== "private") {
    const groupId = ctx.chat.id;
    const allowedGroups = GROUP_SPECIFIC_COMMANDS.start || [];
    if (allowedGroups.length > 0) {
      const isAllowed = await groupConfigService.isCommandAllowedInGroup(groupId, allowedGroups);
      if (!isAllowed) {
        // Silently ignore attempts from unauthorized groups
        return;
      }
    }
  }

  try {
    let profilePhoto = { profilePhotoUrl: null, profilePhotoFileId: null };
    try {
      profilePhoto = await userModel.getProfilePhotoData(ctx.api, ctx.from.id);
    } catch (photoErr) {
      console.error("Error fetching profile photo in /start:", photoErr);
    }

    await userModel.createOrUpdate({
      telegramId: ctx.from.id,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      profilePhotoUrl: profilePhoto.profilePhotoUrl || null,
      profilePhotoFileId: profilePhoto.profilePhotoFileId || null,
    });
    if (ctx.chat.type !== "private" && bingoFundsService) {
      await bingoFundsService.addUserToGroup(ctx.from.id, ctx.chat.id);
    }
    console.log(`Registered /start user: ${ctx.from.id} ${ctx.from.username || ctx.from.first_name}`);
  } catch (error) {
    console.error("Error registering user on /start:", error);
  }

  if (payload && payload.startsWith("configure_")) {
    const groupIdStr = payload.replace("configure_", "");
    const groupId = parseInt(groupIdStr, 10);
    if (!isNaN(groupId)) {
      const userId = ctx.from.id;
      try {
        const member = await ctx.api.getChatMember(groupId, userId);

        // Debug: log the full member object to understand its structure
        console.log("getChatMember response:", JSON.stringify(member));

        const status = member?.status;
        const isAdmin = status === "administrator" || status === "creator";

        if (!isAdmin) {
          await ctx.reply(
            "⚠️ Only group administrators can configure patterns for this group.",
          );
          return;
        }

        // Only create group config if it doesn't exist (preserve original admin from /bingoset)
        const existingConfig = await groupConfigService.getGroupConfig(groupId);
        if (!existingConfig) {
          await groupConfigService.createGroupConfig(groupId, userId);
        }
        await groupConfigService.updateGroupName(groupId, ctx.chat.title || `Group ${groupId}`);

        // Import here to avoid circular dependency
        const { startPatternConfig } = require("../handlers/patternHandler");
        await startPatternConfig(ctx, groupId, null, gameStateService);
        return;
      } catch (error) {
        console.error("Error in start deep link configuration:", error);
        // Log more details for debugging
        console.error("Error code:", error.code || "No code");
        console.error("Error description:", error.description || error.message || "No description");
        
        // Fallback 1: Check if the group config already exists and user is the admin
        try {
          const existingConfig = await groupConfigService.getGroupConfig(groupId);
          if (existingConfig && String(existingConfig.admin_id) === String(userId)) {
            // User is the registered admin, allow them to proceed even if getChatMember fails
            const { startPatternConfig } = require("../handlers/patternHandler");
            await startPatternConfig(ctx, groupId, null, gameStateService);
            return;
          }
        } catch (dbError) {
          console.error("Database check error:", dbError);
        }

        // Fallback 2: The error may be because the bot was recently added.
        // Try verifying the bot is in the group by fetching the group info.
        // If we can get the group and the user initiated /bingoset from that group,
        // try getChatMember one more time with the chat context.
        try {
          const chat = await ctx.api.getChat(groupId);
          if (chat && chat.type !== "private") {
            // Bot is confirmed to be in the group. Retry getChatMember.
            const retryMember = await ctx.api.getChatMember(groupId, userId);
            console.log("Retry getChatMember response:", JSON.stringify(retryMember));
            const retryStatus = retryMember?.status;
            if (retryStatus === "administrator" || retryStatus === "creator") {
              // Only create group config if it doesn't exist (preserve original admin from /bingoset)
              const existingConfig = await groupConfigService.getGroupConfig(groupId);
              if (!existingConfig) {
                await groupConfigService.createGroupConfig(groupId, userId);
              }
              const { startPatternConfig } = require("../handlers/patternHandler");
              await startPatternConfig(ctx, groupId, null, gameStateService);
              return;
            }
          }
        } catch (retryError) {
          console.error("Retry fallback also failed:", retryError);
        }
        
        await ctx.reply(
          "❌ Failed to verify admin status for that group. Ensure the bot is in the group and you are an admin.",
        );
        return;
      }
    }
  }

  await ctx.reply(
    "<b>Bingo Game:</b>\n" +
      "/bingostart - Start new game\n" +
      "/bingostart free - Fun game (no funds, no winners)\n" +
      "/bingostart raid - Raid game (no funds, no winners, raid video)\n" +
      "/bola 1|2|3 - Draw items\n" +
      "/bingo - View your card\n" +
      "/bingostop - End game\n\n" +
      "<b>Configuration:</b>\n" +
      "/bingoset - Configure bingo for group\n" +
      "/bingopattern - Set pattern (private chat)\n" +
      "/theme - Set theme in group (before /bingostart)\n\n" +
      "<b>Funds Tracking:</b>\n" +
      "/pondo - View funds list (sorted by name)\n" +
      ".rm &lt;name&gt; - Remove user\n" +
      ".name+amount - Add funds\n" +
      ".name-amount - Subtract funds\n\n" +
      "<b>Quick Draw:</b>\n" +
      "/bola 1 — draw 1\n" +
      "/bola 2 — draw 2\n" +
      "/bola 3 — draw 3",
    { parse_mode: "HTML" },
  );
}

module.exports = { handleStart };
