/**
 * Channel callback handler
 * Handles bingochannel_* callback queries
 */

const {
  setPendingChannelLink,
  getPendingChannelLink,
  clearPendingChannelLink,
} = require("../../commands/config/main");

async function handleSelectBingoChannelGroupCallback(ctx, groupConfigService) {
  const callbackData = ctx.callbackQuery.data;
  const groupId = parseInt(callbackData.replace("select_bingochannel_group_", ""), 10);
  const userId = ctx.from.id;
  try {
    const existingConfig = await groupConfigService.getGroupConfig(groupId);
    let isVerifiedAdmin = existingConfig && String(existingConfig.admin_id) === String(userId);

    if (!isVerifiedAdmin) {
      try {
        const member = await ctx.api.getChatMember(groupId, userId);
        const status = member?.status;
        const isCurrentAdmin = status === "administrator" || status === "creator";
        if (!isCurrentAdmin) {
          await ctx.answerCallbackQuery({ text: "⚠️ You are not authorized to configure this group.", show_alert: true });
          return;
        }
        isVerifiedAdmin = true;
      } catch (apiError) {
        await ctx.answerCallbackQuery({ text: "⚠️ Could not verify admin status. Ensure the bot has access.", show_alert: true });
        return;
      }
    }

    await ctx.answerCallbackQuery();

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

    await ctx.editMessageText(
      `🔗 <b>What channel do you want to connect in ${title}?</b>\n\nYou can forward a message from the channel to this chat, or enter the channel's @username or numeric ID.`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } },
    );
  } catch (error) {
    console.error("Error handling select_bingochannel_group_ callback:", error);
    await ctx.answerCallbackQuery({ text: "❌ Failed to process selection.", show_alert: true });
  }
}

async function handleBingoChannelForwardCallback(ctx) {
  const callbackData = ctx.callbackQuery.data;
  const groupId = parseInt(callbackData.replace("bingochannel_forward_", ""), 10);
  const userId = ctx.from.id;
  try {
    await ctx.answerCallbackQuery();
    setPendingChannelLink(userId, { groupId, mode: "forward" });
    await ctx.reply("📨 Please forward a message from the channel to this private chat now. I will capture the channel ID from the forwarded message.");
  } catch (error) {
    console.error("Error initiating forward-based channel link:", error);
    await ctx.answerCallbackQuery({ text: "❌ Failed to start forward flow.", show_alert: true });
  }
}

async function handleBingoChannelManualCallback(ctx) {
  const callbackData = ctx.callbackQuery.data;
  const groupId = parseInt(callbackData.replace("bingochannel_manual_", ""), 10);
  const userId = ctx.from.id;
  try {
    await ctx.answerCallbackQuery();
    setPendingChannelLink(userId, { groupId, mode: "manual" });
    await ctx.reply("⌨️ Please send the channel username (e.g. @mychannel) or numeric channel ID now.");
  } catch (error) {
    console.error("Error initiating manual channel link:", error);
    await ctx.answerCallbackQuery({ text: "❌ Failed to start manual flow.", show_alert: true });
  }
}

async function handleBingoChannelClearCallback(ctx, groupConfigService) {
  const callbackData = ctx.callbackQuery.data;
  const groupId = parseInt(callbackData.replace("bingochannel_clear_", ""), 10);
  try {
    await ctx.answerCallbackQuery();
    const updated = await groupConfigService.updateGroupChannel(groupId, null);
    if (updated) {
      await ctx.reply(`✅ Channel cleared for group ${groupId}.`);
    } else {
      await ctx.reply(`❌ Failed to clear channel for group ${groupId}.`);
    }
  } catch (error) {
    console.error("Error clearing channel for group:", error);
    await ctx.answerCallbackQuery({ text: "❌ Failed to clear channel.", show_alert: true });
  }
}

async function handleBingoChannelCancelCallback(ctx) {
  const callbackData = ctx.callbackQuery.data;
  const groupId = parseInt(callbackData.replace("bingochannel_cancel_", ""), 10);
  const userId = ctx.from.id;
  try {
    clearPendingChannelLink(userId);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("❌ Channel linking cancelled.");
  } catch (error) {
    console.error("Error cancelling channel link:", error);
    await ctx.answerCallbackQuery({ text: "❌ Failed to cancel.", show_alert: true });
  }
}

module.exports = {
  handleSelectBingoChannelGroupCallback,
  handleBingoChannelForwardCallback,
  handleBingoChannelManualCallback,
  handleBingoChannelClearCallback,
  handleBingoChannelCancelCallback,
};
