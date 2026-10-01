/**
 * Ban command - /ban [target]
 * Allows users to use BAC card to ban a player from joining a game
 * Only works in private chat and before game starts
 * Shows inline buttons for group selection
 */

// Store pending bans (target_user_id, group_id, banner_user_id)
const pendingBans = new Map();

async function handleBan(ctx, userModel, bingoGameSessionModel, groupConfigService) {
  // Only work in private chat, ignore silently in groups
  if (ctx.chat.type !== "private") {
    return;
  }

  const userId = ctx.from?.id;
  const args = ctx.message.text.split(' ').slice(1);
  
  if (args.length < 1) {
    await ctx.reply(
      "❌ Usage: /ban [target]\n\nTarget can be:\n- Username (e.g., @username)\n- User ID\n- Display name",
      { reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  const targetInput = args[0];

  try {
    // Check if user has BAC card
    const user = await userModel.findByTelegramId(userId);
    if (!user) {
      await ctx.reply("❌ User not found. Please try /start first.", { reply_to_message_id: ctx.message.message_id });
      return;
    }

    const userBacCards = user.bac_cards || [];
    if (!userBacCards.includes('BAN')) {
      await ctx.reply(
        "❌ You don't have the <a href=\"tg://user?id=0\"><b>Ban a Player</b></a> card.",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Find target user
    let targetUser;
    
    // Try as username (with or without @)
    if (targetInput.startsWith('@')) {
      targetUser = await userModel.findByUsername(targetInput.slice(1));
    } else {
      targetUser = await userModel.findByUsername(targetInput);
    }
    
    // Try as user ID
    if (!targetUser && !isNaN(targetInput)) {
      targetUser = await userModel.findByTelegramId(Number(targetInput));
    }
    
    // Try as display name (first name)
    if (!targetUser) {
      const allUsers = await userModel.getAllUsers();
      targetUser = allUsers.find(u => 
        u.first_name?.toLowerCase() === targetInput.toLowerCase() ||
        `${u.first_name} ${u.last_name}`.toLowerCase() === targetInput.toLowerCase()
      );
    }

    if (!targetUser) {
      await ctx.reply(
        `❌ User "${targetInput}" not found.`,
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // Check if target is the same as banner
    if (targetUser.telegram_id === userId) {
      await ctx.reply(
        "❌ You cannot ban yourself.",
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // Send loading message
    const loadingMessage = await ctx.reply("🏃 Wait for a sec...");

    // Get all group configs where user is a member
    const groupConfigs = await groupConfigService.getAllGroupConfigs();
    
    // Filter groups where user is a member
    const userGroups = [];
    for (const config of groupConfigs) {
      try {
        const member = await ctx.api.getChatMember(config.group_id, userId);
        if (member && ['member', 'administrator', 'creator'].includes(member.status)) {
          userGroups.push(config);
        }
      } catch (error) {
        // User not in this group, skip
      }
    }

    if (userGroups.length === 0) {
      await ctx.reply(
        "❌ You are not a member of any bingo groups.",
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // Check if target is in any of these groups
    const targetGroups = [];
    for (const config of userGroups) {
      try {
        const member = await ctx.api.getChatMember(config.group_id, targetUser.telegram_id);
        if (member && ['member', 'administrator', 'creator'].includes(member.status)) {
          targetGroups.push(config);
        }
      } catch (error) {
        // Target not in this group
      }
    }

    if (targetGroups.length === 0) {
      // Delete loading message
      try {
        await ctx.api.deleteMessage(ctx.chat.id, loadingMessage.message_id);
      } catch (deleteError) {
        // Ignore delete errors
      }
      
      await ctx.reply(
        `❌ ${targetUser.first_name || targetUser.username || 'User'} is not in any of the groups you're a member of.`,
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // Build inline keyboard with numbered buttons
    const inlineKeyboard = targetGroups.map((group, index) => [
      {
        text: `${index + 1}`,
        callback_data: `ban_${targetUser.telegram_id}_${group.group_id}`
      }
    ]);

    // Build group list for message
    const groupList = targetGroups.map((group, index) => 
      `${index + 1}. ${group.group_name || 'Group'}`
    ).join('\n');

    const targetName = targetUser.first_name || targetUser.username || 'User';
    
    // Delete loading message
    try {
      await ctx.api.deleteMessage(ctx.chat.id, loadingMessage.message_id);
    } catch (deleteError) {
      // Ignore deletion errors
    }
    
    // Send actual message with group list
    await ctx.reply(
      `Select the group where you want to ban ${targetName}:\n\n${groupList}`,
      {
        reply_markup: {
          inline_keyboard: inlineKeyboard
        }
      }
    );

  } catch (error) {
    console.error("Error in /ban command:", error);
    
    // Delete loading message if it exists
    try {
      if (typeof loadingMessage !== 'undefined' && loadingMessage?.message_id) {
        await ctx.api.deleteMessage(ctx.chat.id, loadingMessage.message_id);
      }
    } catch (deleteError) {
      // Ignore delete errors
    }
    
    await ctx.reply("❌ Failed to process ban. Please try again.", { reply_to_message_id: ctx.message.message_id });
  }
}

async function handleBanCallback(ctx, userModel, bingoGameSessionModel, bingoGamePlayer) {
  const callbackData = ctx.callbackQuery.data;
  const match = callbackData.match(/^ban_(\d+)_(\-?\d+)$/);
  
  if (!match) {
    await ctx.answerCallbackQuery({ text: "Invalid callback data", show_alert: true });
    return;
  }

  const targetUserId = Number(match[1]);
  const groupId = Number(match[2]);
  const bannerUserId = ctx.from.id;

  try {
    // Check if user has BAC card
    const user = await userModel.findByTelegramId(bannerUserId);
    if (!user) {
      await ctx.answerCallbackQuery({ text: "User not found", show_alert: true });
      return;
    }

    const userBacCards = user.bac_cards || [];
    if (!userBacCards.includes('BAN')) {
      await ctx.answerCallbackQuery({ text: "You don't have the Ban a Player card", show_alert: true });
      return;
    }

    // Get target user info
    const targetUser = await userModel.findByTelegramId(targetUserId);
    if (!targetUser) {
      await ctx.answerCallbackQuery({ text: "Target user not found", show_alert: true });
      return;
    }

    // Get game session for the group
    const session = await bingoGameSessionModel.findByGroupId(groupId);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "No active game session in this group", show_alert: true });
      return;
    }

    // Check if game has already started
    if (session.status !== 'waiting') {
      await ctx.answerCallbackQuery({ text: "Ban a Player card can only be used before the game starts", show_alert: true });
      return;
    }

    // Check if target is already banned
    const isBanned = await bingoGameSessionModel.isPlayerBanned(session.id, targetUserId);
    if (isBanned) {
      await ctx.answerCallbackQuery({ text: `${targetUser.first_name || targetUser.username || 'User'} is already banned from this game`, show_alert: true });
      return;
    }

    // Check ban count for target (max 2)
    const banCount = await bingoGameSessionModel.getBanCountForPlayer(session.id, targetUserId);
    if (banCount >= 2) {
      await ctx.answerCallbackQuery({ text: `${targetUser.first_name || targetUser.username || 'User'} has already been banned 2 times in this game. Maximum reached`, show_alert: true });
      return;
    }

    // Check if target is already joined and remove them from the session
    const isPlayerInSession = await bingoGamePlayer.isPlayerInSession(session.id, targetUserId);
    if (isPlayerInSession) {
      await bingoGamePlayer.removePlayer(session.id, targetUserId);
      console.log(`[ban] Removed ${targetUserId} from session ${session.id} as they were already joined`);
    }

    // Add ban to session
    await bingoGameSessionModel.addBannedPlayer(session.id, targetUserId, bannerUserId);

    // Decrement BAN quantity instead of activating it
    await userModel.decrementBacCard(bannerUserId, 'BAN');
    
    // Check if BAN quantity is now 0, deactivate it
    const bacQuantity = await userModel.getBacCardQuantity(bannerUserId, 'BAN');
    if (bacQuantity === 0) {
      await userModel.deactivateBac(bannerUserId, 'BAN');
    }

    // Get target display name
    const targetName = targetUser.first_name || targetUser.username || 'User';
    const targetHyperlink = `<a href="tg://user?id=${targetUserId}">${targetName}</a>`;

    // Send announcement to group
    const announcement = `Someone used their <b>BAN CARD</b> against ${targetHyperlink}!

<b>Card Used:</b> "BAN A PLAYER"
<b>Player Banned:</b> ${targetHyperlink}

${targetHyperlink} is officially <b>BANNED from the game</b> for this round. Good luck everyone! 🔨`;

    try {
      await ctx.api.sendMessage(groupId, announcement, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Error sending ban announcement to group:", error);
    }

    // Edit the message to show confirmation
    await ctx.editMessageText(`✅ Successfully banned ${targetName} from the game.`);
    await ctx.answerCallbackQuery({ text: `Banned ${targetName} from the game`, show_alert: false });

  } catch (error) {
    console.error("Error in ban callback:", error);
    await ctx.answerCallbackQuery({ text: "Failed to process ban", show_alert: true });
  }
}

module.exports = { handleBan, handleBanCallback };
