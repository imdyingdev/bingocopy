/**
 * Players info command - displays all players in current game session
 */

const DEFAULT_BET_AMOUNT = 5; // Default bet in pesos

async function handlePlayers(ctx, bingoGameSession, bingoGamePlayer) {
  // Only work in groups
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("🚫 This command only works in groups.");
    return;
  }

  const groupId = ctx.chat.id;

  try {
    // Check if there's a waiting or active session
    const session = await bingoGameSession.findByGroupId(groupId);
    if (!session) {
      await ctx.reply("❌ No active bingo game session.");
      return;
    }

    // Get all players in the session
    const players = await bingoGamePlayer.getPlayersBySession(session.id);

    if (players.length === 0) {
      await ctx.reply(
        "📋 <b>Players:</b>\n\n<i>No players have joined yet. Use the inline Join button in the game card to join.</i>",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Format players list with hyperlinks and bet amount
    let message = "📋 <b>Players Joined:</b>\n\n";
    players.forEach((player, index) => {
      const rawPlayerFirstName = String(player.first_name || "").trim();
      const rawPlayerLastName = String(player.last_name || "").trim();
      const rawPlayerUsername = String(player.username || "").trim();
      const fullName = [rawPlayerFirstName, rawPlayerLastName].filter(Boolean).join(" ");
      const name = fullName || (rawPlayerUsername ? `@${rawPlayerUsername}` : "Player");
      const hyperlink = `<a href="tg://user?id=${player.user_id}"><b>${name}</b></a>`;
      
      // Add alarm emoji if player used Late Entry Pass
      const lepIndicator = player.used_lep ? " ⏰" : "";
      
      message += `${index + 1}. ${hyperlink}${lepIndicator} - ₱${DEFAULT_BET_AMOUNT}\n`;
    });

    message += `\n<b>Total: ${players.length} player${players.length !== 1 ? "s" : ""}</b>`;

    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error in players command:", error);
    await ctx.reply("❌ Error retrieving players. Please try again.");
  }
}

module.exports = { handlePlayers };
