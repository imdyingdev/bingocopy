const { SUPER_ADMIN_IDS } = require("../../utils/constants");

function getClickedTelegramId(ctx) {
  const fromId = ctx.from?.id ?? ctx.callbackQuery?.from?.id ?? ctx.update?.callback_query?.from?.id;
  return fromId == null ? null : String(fromId);
}

async function handleApproveGroupSetupCallback(ctx, groupConfigService) {
  const callbackData = ctx.callbackQuery?.data || "";
  const groupId = callbackData.replace("approve_group_setup_", "");
  const clickedBy = getClickedTelegramId(ctx);
  const allowedAdminIds = new Set(SUPER_ADMIN_IDS.map(String));

  console.log(`[callback-approve-group] groupId=${groupId} clickedBy=${clickedBy}`);

  if (!allowedAdminIds.has(String(clickedBy))) {
    await ctx.answerCallbackQuery("Only a super-admin can approve this setup.");
    return;
  }

  try {
    const updatedRow = await groupConfigService.approveGroupSetup(groupId, clickedBy);
    if (!updatedRow) {
      console.warn(`[callback-approve-group] No group_configs row matched groupId=${groupId}.`);
      await ctx.answerCallbackQuery("No matching group-config row was found. Request /bingoset again in the group.");
      return;
    }

    await ctx.answerCallbackQuery("Group setup approved.");
    await ctx.editMessageText("✅ OK na.", {
      reply_markup: { inline_keyboard: [] },
    });
  } catch (e) {
    console.error(`[callback-approve-group] Failed groupId=${groupId} clickedBy=${clickedBy}`, e);
    try {
      await ctx.answerCallbackQuery("❌ Failed to approve this group setup. Check logs.");
    } catch (_) {}
  }
}

async function handleRejectGroupSetupCallback(ctx, groupConfigService) {
  const callbackData = ctx.callbackQuery?.data || "";
  const groupId = callbackData.replace("reject_group_setup_", "");
  const clickedBy = getClickedTelegramId(ctx);
  const allowedAdminIds = new Set(SUPER_ADMIN_IDS.map(String));

  console.log(`[callback-reject-group] groupId=${groupId} clickedBy=${clickedBy}`);

  if (!allowedAdminIds.has(String(clickedBy))) {
    await ctx.answerCallbackQuery("Only a super-admin can reject this setup.");
    return;
  }

  try {
    const updatedRow = await groupConfigService.rejectGroupSetup(groupId, clickedBy);
    if (!updatedRow) {
      console.warn(`[callback-reject-group] No group_configs row matched groupId=${groupId}.`);
      await ctx.answerCallbackQuery("No matching group-config row was found. Request /bingoset again in the group.");
      return;
    }

    await ctx.answerCallbackQuery("Group setup rejected.");
    await ctx.editMessageText(`❌ Group ${groupId} setup rejected.`);
  } catch (e) {
    console.error(`[callback-reject-group] Failed groupId=${groupId} clickedBy=${clickedBy}`, e);
    try {
      await ctx.answerCallbackQuery("❌ Failed to reject this group setup. Check logs.");
    } catch (_) {}
  }
}

module.exports = {
  handleApproveGroupSetupCallback,
  handleRejectGroupSetupCallback,
};
