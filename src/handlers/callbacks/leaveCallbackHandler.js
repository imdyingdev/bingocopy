/**
 * Leave game callback handler
 * Handles leave_game_ callback queries
 */

const { playerListMessages } = require("../../commands/bingo");
const { isFreePlaySession } = require("../../utils/playerUtils");

async function handleLeaveGameCallback(ctx, bingoGameSession, bingoGamePlayer, userModel) {
  const callbackData = ctx.callbackQuery.data;
  const sessionId = parseInt(callbackData.replace("leave_game_", ""), 10);
  const userId = ctx.from.id;
  const groupId = ctx.chat.id;

  try {
    // Find the session
    const session = await bingoGameSession.findById(sessionId);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "❌ Game session not found", show_alert: true });
      return;
    }

    // Check if the session belongs to this group
    if (String(session.group_id) !== String(groupId)) {
      await ctx.answerCallbackQuery({ text: "❌ This game is not in your group", show_alert: true });
      return;
    }

    // Determine if the session is active (game in progress)
    const inGame = session.status === "active";

    // Check if user is actually in the session
    const isPlayer = await bingoGamePlayer.isPlayerInSession(sessionId, userId);
    if (!isPlayer) {
      await ctx.answerCallbackQuery({ text: "⚠️ You are not part of this game session", show_alert: true });
      return;
    }

    // Prevent the starter from leaving (they started the game)
    if (String(session.starter_id) === String(userId)) {
      await ctx.answerCallbackQuery({ text: "❌ You started the game and cannot leave. Ask an admin to cancel the game if needed.", show_alert: true });
      return;
    }

    // Remove player from session only if the game hasn't started yet
    if (!inGame) {
      await bingoGamePlayer.removePlayer(sessionId, userId);
      if (userModel && await userModel.isBacActivated(userId, 'DPC')) {
        await userModel.deactivateBac(userId, 'DPC');
      }
      console.log(`[leave-callback] User ${userId} left session ${sessionId}`);
      
      await ctx.answerCallbackQuery({ text: "✅ You left the game" });
      
      // Refresh the player list message
      const messageKey = `${groupId}_${sessionId}`;
      const messageInfo = playerListMessages.get(messageKey);
      if (messageInfo) {
        try {
          // Get updated player list
          const players = await bingoGamePlayer.getPlayersBySession(sessionId);
          const updatedPlayersText = `🎯 <b>Bingo Game Started!</b>\n\n<b>👥 Players Joined: ${players.length}</b>\n${players.map(p => {
            const name = p.first_name || (p.username ? `@${p.username}` : "Player");
            const sanitizedName = name.replace(/[<>]/g, "");
            const hyperlink = `<a href="tg://user?id=${p.user_id}"><b>${sanitizedName}</b></a>`;
            const cardIndicator = p.card_link ? ` <a href="${p.card_link}">${Math.random() < 0.5 ? "📓" : "📔"}</a>` : "";
            return `${cardIndicator}${hyperlink}`;
          }).join("\n")}\n\n<b>Use /bingoforce to start the game</b>`;
          
          // Update the message
          await ctx.api.editMessageText(messageInfo.chat_id, messageInfo.message_id, updatedPlayersText, {
            parse_mode: "HTML"
          });
        } catch (editError) {
          console.error("Failed to update player list after leave:", editError);
        }
      }
    } else {
      await ctx.answerCallbackQuery({ text: "❌ Cannot leave after game has started", show_alert: true });
    }
  } catch (error) {
    console.error("Error in leave game callback:", error);
    await ctx.answerCallbackQuery({ text: "❌ Failed to leave game", show_alert: true });
  }
}

module.exports = {
  handleLeaveGameCallback,
};