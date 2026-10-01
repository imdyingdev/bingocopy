/**
 * Winner callback handler
 * Handles confirm_winner_ and reject_winner_ callback queries
 */

const { pendingWinnerConfirmations } = require("../../commands/bingo/winner");

async function handleWinnerConfirmationCallback(ctx, groupConfigService, bingoGameSession, bingoGamePlayer, userModel, gameWinnerModel, gameStateService) {
  const callbackData = ctx.callbackQuery.data;
  const isConfirm = callbackData.startsWith("confirm_winner_");
  const key = callbackData.replace(/^(confirm_winner_|reject_winner_)/, "");
  const pending = pendingWinnerConfirmations.get(key);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: "⚠️ Confirmation not found or already handled.", show_alert: false });
    return;
  }

  try {
    // Verify the user is group admin
    const session = await bingoGameSession.findById(pending.sessionId);
    const groupId = session?.group_id || null;
    let isAdmin = false;
    try {
      const groupConfig = await groupConfigService.getGroupConfig(groupId);
      if (groupConfig && String(groupConfig.admin_id) === String(ctx.from.id)) {
        isAdmin = true;
      }
    } catch (e) {
      console.error("Error checking group config for winner confirmation:", e);
    }
    if (!isAdmin) {
      try {
        const member = await ctx.api.getChatMember(groupId, ctx.from.id);
        const status = member?.status;
        if (status === "administrator" || status === "creator") isAdmin = true;
      } catch (e) {
        console.error("Failed to verify chat member for winner confirmation:", e);
      }
    }

    if (!isAdmin) {
      await ctx.answerCallbackQuery({ text: "⚠️ Only a group admin can confirm winners.", show_alert: true });
      return;
    }

    // Fetch player display name if possible
    let winnerName = `Player`;
    try {
      const players = await bingoGamePlayer.getPlayersBySession(pending.sessionId);
      const player = (players || []).find((p) => String(p.user_id) === String(pending.winnerUserId));
      if (player) {
        const raw = String(player.first_name || player.username || "").trim();
        winnerName = raw || `Player`;
      } else {
        const userRec = await userModel.findByTelegramId(pending.winnerUserId);
        winnerName = (userRec && (userRec.first_name || userRec.username)) || `Player`;
      }
    } catch (err) {
      console.error("Failed to resolve winner name:", err);
    }

    if (isConfirm) {
      // Persist the winner
      try {
        const prizeAmount = pending.prizeAmount || 0;
        await gameWinnerModel.addWinner(pending.sessionId, pending.winnerUserId, pending.patternName, prizeAmount);

        // If pattern_count logic completes the game, lock draw count
        const refreshedWinners = await gameWinnerModel.getWinnersBySession(pending.sessionId);
        const refreshedWinnersCount = Array.isArray(refreshedWinners) ? refreshedWinners.length : 0;
        const sessionRow = await bingoGameSession.findById(pending.sessionId);
        const patternCount = Number(sessionRow?.pattern_count || 0);
        if (patternCount > 0 && refreshedWinnersCount >= patternCount) {
          const game = gameStateService?.getBingoGame?.(groupId);
          if (game && !game.completedDrawCount) {
            game.completedDrawCount = game.selected?.size || 0;
          }
        }

        // Edit the confirmation message to show final registration with prize info
        try {
          const prizeText = pending.prizeAmount ? `Prize: ₱${pending.prizeAmount}` : "Prize will be calculated at game end";
          await ctx.editMessageText(`✅ <b>${winnerName}</b> won pattern <b>${pending.patternName}</b>!\n\n${prizeText}`, { parse_mode: "HTML" });
        } catch (e) {
          console.log("Could not edit confirmation message after persisting winner:", e && e.description ? e.description : e);
        }

        pendingWinnerConfirmations.delete(key);
        await ctx.answerCallbackQuery({ text: "✅ Winner confirmed.", show_alert: false });
        return;
      } catch (err) {
        console.error("Error persisting confirmed winner:", err);
        await ctx.answerCallbackQuery({ text: "❌ Failed to register winner. See logs.", show_alert: true });
        return;
      }
    } else {
      // Reject
      try {
        await ctx.editMessageText(`❌ Winner registration rejected.`, { parse_mode: "HTML" });
      } catch (e) {
        console.log("Could not edit rejection message:", e && e.description ? e.description : e);
      }
      pendingWinnerConfirmations.delete(key);
      await ctx.answerCallbackQuery({ text: "❌ Winner rejected.", show_alert: false });
      return;
    }
  } catch (error) {
    console.error("Error handling winner confirmation callback:", error);
    await ctx.answerCallbackQuery({ text: "❌ Error processing confirmation.", show_alert: true });
    return;
  }
}

module.exports = { handleWinnerConfirmationCallback };
