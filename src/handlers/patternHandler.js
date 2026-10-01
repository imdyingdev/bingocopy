/**
 * Pattern configuration handler
 */

async function startPatternConfig(ctx, groupId, groupTitle = null, gameStateService) {
  const userId = ctx.from.id;

  gameStateService.setPatternConfigurationState(userId, {
    step: "awaiting_json",
    groupId: groupId,
  });

  let displayTitle = groupTitle;
  if (!displayTitle) {
    try {
      const chat = await ctx.api.getChat(groupId);
      displayTitle = chat.title || `Group ${groupId}`;
    } catch (e) {
      displayTitle = `Group ${groupId}`;
    }
  }

  const messageText =
    `🎯 <b>Configuring pattern for:</b> ${displayTitle}\n\n` +
    `📝 <b>Send your JSON pattern:</b>\n\n` +
    "Example format (you can use any categories/emojis):\n" +
    "<pre><code>{\n" +
    '  "🕷️": ["Miles Morales", "Gwen Stacy"],\n' +
    '  "🌍": ["E. 1610", "E. 65"],\n' +
    '  "⚡": ["Thwip", "Snikt"],\n' +
    '  "🦹": ["Green Goblin", "Venom"],\n' +
    '  "🎯": ["Responsibility", "Webshooters"]\n' +
    "}</code></pre>";

  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { parse_mode: "HTML" });
  } else {
    await ctx.reply(messageText, { parse_mode: "HTML" });
  }
}

async function handlePatternInput(ctx, groupConfigService, gameStateService) {
  const userId = ctx.from.id;
  const state = gameStateService.getPatternConfigurationState(userId);

  if (!state || state.step !== "awaiting_json") {
    return;
  }

  if (ctx.chat.type !== "private") {
    return;
  }

  const jsonInput = ctx.message.text;

  try {
    const validation = await groupConfigService.validatePattern(jsonInput);

    if (!validation.valid) {
      await ctx.reply(
        `❌ <b>Invalid pattern:</b>\n\n${validation.error}\n\n` +
          "Please check your JSON and try again.",
        { parse_mode: "HTML" },
      );
      return;
    }

    const game = gameStateService.getBingoGame(state.groupId);
    if (game) {
      await ctx.reply(
        "❌ <b>Cannot update pattern while game is ongoing!</b>\n\n" +
          "Please end the current game with /bingostop first.",
        { parse_mode: "HTML" },
      );
      return;
    }

    await groupConfigService.updateGroupPattern(
      state.groupId,
      validation.pattern,
    );

    gameStateService.clearPatternConfigurationState(userId);

    await ctx.reply(
      "✅ <b>Pattern updated successfully!</b>\n\n" +
        "You can now start playing Bingo with /bingostart in the group.",
      { parse_mode: "HTML" },
    );
  } catch (error) {
    console.error("Error updating pattern:", error);
    await ctx.reply("❌ Failed to update pattern. Please try again.");
  }
}

module.exports = {
  startPatternConfig,
  handlePatternInput,
};
