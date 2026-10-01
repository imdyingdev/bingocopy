/**
 * Deactivate BAC command - /deactivate [code]
 * Allows users to deactivate their BAC cards (DPC, FP, LEP only - BAFM cannot be deactivated)
 */

async function handleDeactivateBac(ctx, userModel) {
  const userId = ctx.from?.id;
  
  if (!userId) {
    await ctx.reply("❌ Unable to verify user.");
    return;
  }

  // Parse command arguments
  const args = ctx.message.text.split(' ').slice(1);
  const bacCode = args[0]?.toUpperCase();
  
  if (!bacCode) {
    await ctx.reply(
      "❌ Please specify which BAC card to deactivate.\n\nUsage: /deactivate [code]\n\nValid codes: FP, LEP, BBS, DP, MCP, BBP",
      { reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  const deactivatableCodes = ['FP', 'LEP', 'BBS', 'DP', 'MCP', 'BBP'];
  if (!deactivatableCodes.includes(bacCode)) {
    if (bacCode === 'BAFM') {
      await ctx.reply(
        "❌ BAFM cannot be deactivated once activated.",
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (bacCode === 'BAN') {
      await ctx.reply(
        "❌ BAN is only for banning players and cannot be activated or deactivated.",
        { reply_to_message_id: ctx.message.message_id }
      );
    } else if (bacCode === 'DPC') {
      await ctx.reply(
        "❌ DPC cannot be deactivated. It will be automatically consumed when you win.",
        { reply_to_message_id: ctx.message.message_id }
      );
    } else {
      await ctx.reply(
        `❌ Invalid code. Only FP, LEP, BBS, DP, MCP, and BBP can be deactivated.`,
        { reply_to_message_id: ctx.message.message_id }
      );
    }
    return;
  }

  try {
    // Get user data
    const user = await userModel.findByTelegramId(userId);
    if (!user) {
      await ctx.reply("❌ User not found. Please try /start first.", { reply_to_message_id: ctx.message.message_id });
      return;
    }

    // Check if the BAC card is activated
    const isActivated = await userModel.isBacActivated(userId, bacCode);
    if (!isActivated) {
      await ctx.reply(
        `⚠️ ${bacCode} is not currently activated.`,
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // For FP, check if quantity is still available (don't deactivate if still has FP)
    if (bacCode === 'FP') {
      const fpQuantity = await userModel.getBacCardQuantity(userId, 'FP');
      if (fpQuantity > 0) {
        await ctx.reply(
          `⚠️ You still have ${fpQuantity} Free Pass card(s). Deactivation not needed.`,
          { reply_to_message_id: ctx.message.message_id }
        );
        return;
      }
    }

    // Deactivate the BAC card
    const result = await userModel.deactivateBac(userId, bacCode);
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
        `✅ ${cardNames[bacCode]} deactivated.`,
        { reply_to_message_id: ctx.message.message_id }
      );
    } else {
      await ctx.reply(
        "❌ Failed to deactivate BAC card. Please try again.",
        { reply_to_message_id: ctx.message.message_id }
      );
    }
  } catch (error) {
    console.error("Error in /deactivate command:", error);
    await ctx.reply("❌ Failed to deactivate BAC card. Please try again.", { reply_to_message_id: ctx.message.message_id });
  }
}

module.exports = { handleDeactivateBac };
