/**
 * Activate BAC command - /activate [code]
 * Allows users to activate their BAC cards (BAFM, DPC, FP, LEP)
 */

async function handleActivateBac(ctx, userModel, groupConfigService, bingoGameSession) {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  
  if (!userId || !chatId) {
    await ctx.reply("❌ Unable to verify user.");
    return;
  }

  // Parse command arguments
  const args = ctx.message.text.split(' ').slice(1);
  const bacCode = args[0]?.toUpperCase();
  
  if (!bacCode) {
    await ctx.reply(
      "❌ Please specify which BAC card to activate.\n\nUsage: /activate [code]\n\nValid codes: BAFM, DPC, FP, LEP, BBS",
      { reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  const activatableCodes = ['BAFM', 'FP', 'LEP', 'BBS', 'DP', 'MCP', 'BBP'];
  if (!activatableCodes.includes(bacCode)) {
    await ctx.reply(
      `❌ Invalid code. Only BAFM, FP, LEP, BBS, DP, MCP, and BBP can be activated. BAN is automatically activated when used to ban a player.`,
      { reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  try {
    // Get user data
    const user = await userModel.findByTelegramId(userId);
    if (!user) {
      await ctx.reply("❌ User not found. Please try /start first.", { reply_to_message_id: ctx.message.message_id });
      return;
    }

    // Check if user has the BAC card
    const userBacCards = user.bac_cards || [];
    if (!userBacCards.includes(bacCode)) {
      await ctx.reply(
        `❌ You don't have the ${bacCode} BAC card.`,
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // For FP, check if quantity is at least 1
    if (bacCode === 'FP') {
      const fpQuantity = await userModel.getBacCardQuantity(userId, 'FP');
      if (fpQuantity < 1) {
        await ctx.reply(
          "❌ You don't have any Free Pass cards left.",
          { reply_to_message_id: ctx.message.message_id }
        );
        return;
      }
    }

    // Check if already activated
    const isActivated = await userModel.isBacActivated(userId, bacCode);
    if (isActivated) {
      await ctx.reply(
        `⚠️ ${bacCode} is already activated.`,
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    if (bacCode === 'FP' || bacCode === 'DPC') {
      const oppositeCode = bacCode === 'FP' ? 'DPC' : 'FP';
      if (await userModel.isBacActivated(userId, oppositeCode)) {
        await ctx.reply(
          `❌ You cannot activate ${bacCode} while ${oppositeCode} is active. Deactivate ${oppositeCode} first.`,
          { reply_to_message_id: ctx.message.message_id }
        );
        return;
      }
    }

    // Check if DP can only be activated before game starts
    if (bacCode === 'DP') {
      if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        const session = await bingoGameSession.findByGroupId(chatId);
        if (session && session.status !== 'waiting') {
          await ctx.reply(
            "❌ Discount Pass can only be activated before the game starts.",
            { reply_to_message_id: ctx.message.message_id }
          );
          return;
        }
      }
    }

    // Handle BAFM activation with inline buttons
    if (bacCode === 'BAFM') {
      if (!user.temp_admin_until) {
        await ctx.reply(
          "❌ BAFM expiry not set. Please contact an admin.",
          { reply_to_message_id: ctx.message.message_id }
        );
        return;
      }

      const expiry = new Date(user.temp_admin_until);
      const now = new Date();
      const diffMs = expiry - now;
      
      if (diffMs <= 0) {
        await ctx.reply(
          "❌ BAFM has expired.",
          { reply_to_message_id: ctx.message.message_id }
        );
        return;
      }

      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      let timeText;
      if (diffDays > 0) {
        const hoursText = diffHours === 1 ? '1hr' : `${diffHours}hrs`;
        timeText = `${diffDays}d ${hoursText}`;
      } else {
        const hoursText = diffHours === 1 ? '1hr' : `${diffHours}hrs`;
        timeText = hoursText;
      }

      await ctx.reply(
        `⚠️ Are you sure you want to activate BAFM?\n\nYou will be promoted to admin for ${timeText}.`,
        {
          reply_to_message_id: ctx.message.message_id,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Yes", callback_data: `activate_bafm_yes_${userId}` },
                { text: "❌ No", callback_data: `activate_bafm_no_${userId}` }
              ]
            ]
          }
        }
      );
      return;
    }

    // Handle DPC, FP, LEP, DP, MCP, and BBP activation (no confirmation needed)
    const result = await userModel.activateBac(userId, bacCode);
    if (result) {
      const cardNames = {
        'FP': 'Free Pass',
        'DPC': 'Double Prize Card',
        'LEP': 'Late Entry Pass',
        'BBS': 'Bingo Bank Shield',
        'DP': 'Discount Pass',
        'MCP': 'Missed Call Protection',
        'BBP': 'Bad Bingo Protection'
      };
      await ctx.reply(
        `✅ ${cardNames[bacCode]} activated!`,
        { reply_to_message_id: ctx.message.message_id }
      );
    } else {
      await ctx.reply(
        "❌ Failed to activate BAC card. Please try again.",
        { reply_to_message_id: ctx.message.message_id }
      );
    }
  } catch (error) {
    console.error("Error in /activate command:", error);
    await ctx.reply("❌ Failed to activate BAC card. Please try again.", { reply_to_message_id: ctx.message.message_id });
  }
}

async function handleBafmActivationCallback(ctx, userModel) {
  const callbackData = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  
  if (!callbackData || !userId || !chatId) {
    await ctx.answerCallbackQuery("❌ Invalid request");
    return;
  }

  const [action, _, targetUserId] = callbackData.split('_');
  
  if (action === 'activate_bafm_yes') {
    // Check if the user clicking is an admin
    try {
      const chatMember = await ctx.api.getChatMember(chatId, userId);
      const isAdmin = chatMember?.status === "administrator" || chatMember?.status === "creator";
      
      if (!isAdmin) {
        await ctx.answerCallbackQuery("❌ Only admins can approve BAFM activation");
        await ctx.editMessageText(
          "❌ Only admins can approve BAFM activation. Please ask an admin to click the Yes button.",
          { reply_markup: { inline_keyboard: [] } }
        );
        return;
      }
    } catch (error) {
      console.error("Error checking admin status:", error);
      await ctx.answerCallbackQuery("❌ Failed to verify admin status");
      return;
    }
    
    // Proceed with activation
    try {
      const user = await userModel.findByTelegramId(Number(targetUserId));
      if (!user) {
        await ctx.answerCallbackQuery("❌ User not found");
        return;
      }

      // Check if user has BAFM
      const userBacCards = user.bac_cards || [];
      if (!userBacCards.includes('BAFM')) {
        await ctx.answerCallbackQuery("❌ User doesn't have BAFM");
        return;
      }

      // Check if already activated
      const isActivated = await userModel.isBacActivated(Number(targetUserId), 'BAFM');
      if (isActivated) {
        await ctx.answerCallbackQuery("⚠️ BAFM is already activated");
        await ctx.editMessageText("⚠️ BAFM is already activated.", { reply_markup: { inline_keyboard: [] } });
        return;
      }

      // Activate BAFM
      const result = await userModel.activateBac(Number(targetUserId), 'BAFM');
      if (result) {
        // Promote user to admin
        try {
          await ctx.api.promoteChatMember(chatId, Number(targetUserId), {
            can_change_info: false,
            can_post_messages: true,
            can_edit_messages: true,
            can_delete_messages: true,
            can_invite_users: true,
            can_restrict_members: true,
            can_pin_messages: true,
            can_manage_topics: false,
            can_promote_members: false,
            can_manage_video_chats: false,
            can_manage_chat: false,
          });
          
          const expiry = new Date(user.temp_admin_until);
          await ctx.editMessageText(
            `✅ BAFM activated! User has been promoted to admin until ${expiry.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}.`,
            { reply_markup: { inline_keyboard: [] } }
          );
          await ctx.answerCallbackQuery("✅ BAFM activated successfully");
        } catch (promoError) {
          console.error("Error promoting user to admin:", promoError);
          await ctx.editMessageText(
            `✅ BAFM activated! However, the bot couldn't promote the user to admin. Please promote manually.`,
            { reply_markup: { inline_keyboard: [] } }
          );
          await ctx.answerCallbackQuery("⚠️ BAFM activated but promotion failed");
        }
      } else {
        await ctx.answerCallbackQuery("❌ Failed to activate BAFM");
        await ctx.editMessageText("❌ Failed to activate BAFM. Please try again.", { reply_markup: { inline_keyboard: [] } });
      }
    } catch (error) {
      console.error("Error in BAFM activation callback:", error);
      await ctx.answerCallbackQuery("❌ Failed to activate BAFM");
    }
  } else if (action === 'activate_bafm_no') {
    await ctx.editMessageText("❌ BAFM activation cancelled.", { reply_markup: { inline_keyboard: [] } });
    await ctx.answerCallbackQuery("❌ Activation cancelled");
  }
}

module.exports = { handleActivateBac, handleBafmActivationCallback };
