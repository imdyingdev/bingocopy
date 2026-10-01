/**
 * Funds callback handler
 * Handles select_funds_group_ callback queries
 */

async function handleSelectFundsGroupCallback(ctx, groupConfigService, bingoFundsService, gameStateService) {
  const callbackData = ctx.callbackQuery.data;
  const fundsGroupId = parseInt(callbackData.replace("select_funds_group_", ""), 10);
  const currentGroupId = ctx.chat.id;
  const userId = ctx.from.id;

  try {
    await ctx.answerCallbackQuery();

    gameStateService.clearPatternConfigurationState(userId);

    const existingConfig = await groupConfigService.getGroupConfig(currentGroupId);
    if (!existingConfig) {
      await groupConfigService.createGroupConfig(currentGroupId, userId);
    }

    await bingoFundsService.setFundsGroupMapping(currentGroupId, fundsGroupId);

    let groupName = `Group ${fundsGroupId}`;
    let selectedGroup = null;
    try {
      const fundsGroups = await bingoFundsService.getRegisteredFundsGroups();
      selectedGroup = fundsGroups.find((g) => String(g.group_id) === String(fundsGroupId));
      if (selectedGroup && selectedGroup.group_name) {
        groupName = selectedGroup.group_name;
      }

      const chat = await ctx.api.getChat(fundsGroupId);
      if (chat && chat.title) {
        groupName = chat.title;
      }
    } catch (e) {
      if (!selectedGroup) {
        console.error("Error resolving funds group name:", e);
      }
    }

    await ctx.reply(
      `✅ Funds group linked to <b>${groupName}</b>. This group will now use the selected group's funds.`,
      { parse_mode: "HTML" },
    );
  } catch (error) {
    console.error("Error handling funds group select callback:", error);
    await ctx.answerCallbackQuery({
      text: "❌ Failed to link funds group.",
      show_alert: true,
    });
  }
}

module.exports = { handleSelectFundsGroupCallback };
