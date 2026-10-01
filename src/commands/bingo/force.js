async function handleBingoForce(ctx, bingoGameSession, bingoGamePlayer, groupConfigService) {
  // Only work in groups
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("🚫 This command only works in groups.");
    return;
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from.id;

  try {
    // Check if group is configured
    const groupConfig = await groupConfigService.getGroupConfig(groupId);
    if (!groupConfig) {
      await ctx.reply(
        "❌ Bingo is not configured for this group. Please run /bingoset first."
      );
      return;
    }

    const groupTitle = ctx.chat.title;
    if (groupTitle) {
      await groupConfigService.updateGroupName(groupId, groupTitle);
    }

    // Check if user is admin
    if (String(groupConfig.admin_id) !== String(userId)) {
      await ctx.reply("❌ Only admins can force start a bingo game.");
      return;
    }

    // Check if there's a waiting session
    const session = await bingoGameSession.findByGroupId(groupId);
    if (!session) {
      await ctx.reply(
        "❌ No waiting game session. Please start a game with /bingostart first."
      );
      return;
    }

    // Check if session is already active
    if (session.status === "active") {
      await ctx.reply("❌ The game is already active.");
      return;
    }

    const players = await bingoGamePlayer.getPlayersBySession(session.id);
    const isFree = session.is_free === true;
    const isRaid = session.is_raid === true;
    const isFreePlay = isFree || isRaid;

    if (!isFreePlay && (!Array.isArray(players) || players.length < 2)) {
      await ctx.reply("❌ At least 2 players must join before you can force start the game.", {
        reply_to_message_id: ctx.message?.message_id,
      });
      return;
    }

    // Start the session
    await bingoGameSession.start(session.id);

    // Store the /bingoforce command message ID for deletion later
    await bingoGameSession.setForceCommandMessageId(session.id, ctx.message.message_id, groupId);
    console.log(`Stored force command message ID ${ctx.message.message_id} (chat ${groupId}) for session ${session.id}`);

    if (isRaid) {
      const startedMessage = await ctx.reply(
        "⚔️ <b>Bingo Raid started!</b>\n\nUse /bola to draw. Use /bingostop when you're done.",
        { parse_mode: "HTML", reply_to_message_id: ctx.message?.message_id }
      );
      if (startedMessage?.message_id) {
        await bingoGameSession.setPatternSelectorMessageId(session.id, startedMessage.message_id, groupId);
      }
      return;
    }

    if (isFree) {
      const startedMessage = await ctx.reply(
        "🎮 <b>Free play started.</b>\n\nUse /bola to draw. Use /bingostop when you're done.",
        { parse_mode: "HTML", reply_to_message_id: ctx.message?.message_id }
      );
      if (startedMessage?.message_id) {
        await bingoGameSession.setPatternSelectorMessageId(session.id, startedMessage.message_id, groupId);
      }
      return;
    }

    // Send pattern count selector using rich message
    const patternSelectorHtml = `
<p>🎯 <b>Choose the pattern count to start the game.</b></p>
<p>Select 1-6 patterns for winners.</p>
<tg-button-row align="left">
  <tg-button type="callback_data" style="default" data="select_patterns_${session.id}_1">1️⃣</tg-button>
  <tg-button type="callback_data" style="default" data="select_patterns_${session.id}_2">2️⃣</tg-button>
  <tg-button type="callback_data" style="default" data="select_patterns_${session.id}_3">3️⃣</tg-button>
  <tg-button type="callback_data" style="default" data="select_patterns_${session.id}_4">4️⃣</tg-button>
  <tg-button type="callback_data" style="default" data="select_patterns_${session.id}_5">5️⃣</tg-button>
  <tg-button type="callback_data" style="default" data="select_patterns_${session.id}_6">6️⃣</tg-button>
</tg-button-row>`.trim();

    const patternSelectorMessage = await ctx.api.sendRichMessage(groupId, {
      html: patternSelectorHtml
    });

    // Store the pattern selector message ID for deletion later
    if (patternSelectorMessage && patternSelectorMessage.message_id) {
      await bingoGameSession.setPatternSelectorMessageId(session.id, patternSelectorMessage.message_id, groupId);
      console.log(`Stored pattern selector message ID ${patternSelectorMessage.message_id} (chat ${groupId}) for session ${session.id}`);
    }
  } catch (error) {
    console.error("Error in bingoforce command:", error);
    await ctx.reply("❌ Error force starting game. Please try again.");
  }
}

module.exports = { handleBingoForce };
