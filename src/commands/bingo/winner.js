/**
 * Bingo winner command - admin registers winners by pattern name
 */

// Pending confirmations map (key -> { sessionId, winnerUserId, patternName, addedBy })
const pendingWinnerConfirmations = new Map();

async function handleBingoWinner(ctx, bingoGameSession, bingoGamePlayer, gameWinnerModel, gameStateService, groupConfigService) {
  // Only work in groups
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("🚫 This command only works in groups.");
    return;
  }

  const groupId = ctx.chat.id;
  const senderId = ctx.from.id;

  // Check if user is admin (stored or current Telegram admin)
  const isStoredAdmin = await groupConfigService.isAdmin(groupId, senderId);
  let isVerifiedAdmin = isStoredAdmin;
  
  if (!isStoredAdmin) {
    try {
      const member = await ctx.api.getChatMember(groupId, senderId);
      const status = member?.status;
      isVerifiedAdmin = status === "administrator" || status === "creator";
    } catch (apiError) {
      console.error("Error checking admin status for /bingo:", apiError);
      isVerifiedAdmin = false;
    }
  }

  // Only admins can use /bingo to register winners
  if (!isVerifiedAdmin) {
    // Silently ignore non-admin attempts
    return;
  }
  const rawText = String(ctx.message?.text || "");
  const commandBody = rawText.replace(/^\/bingo(?:@[\w_]+)?\s*/i, "").trim();
  const repliedUser = ctx.message.reply_to_message?.from || null;
  const session = await bingoGameSession.findByGroupId(groupId);
  const sessionId = session?.id || null;

  const normalizeValue = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const findSessionPlayer = async (sessionId, identifier) => {
    if (!identifier) return null;
    const players = await bingoGamePlayer.getPlayersBySession(sessionId);
    const normalizedId = normalizeValue(identifier).replace(/^@+/, "");
    if (!normalizedId) return null;

    const numericId = Number(normalizedId);
    if (Number.isInteger(numericId) && String(numericId) === normalizedId) {
      const matchById = players.find((player) => String(player.user_id) === normalizedId || String(player.user_id) === String(numericId));
      if (matchById) return matchById;
    }

    const normalizedPlayers = players.map((player) => ({
      player,
      fullName: normalizeValue(`${player.first_name || ""} ${player.last_name || ""}`),
      firstName: normalizeValue(player.first_name),
      lastName: normalizeValue(player.last_name),
      username: normalizeValue(player.username),
    }));

    return normalizedPlayers.find(({ firstName, lastName, fullName, username }) =>
      username === normalizedId ||
      firstName === normalizedId ||
      lastName === normalizedId ||
      fullName === normalizedId
    )?.player || null;
  };

  let winnerUser = repliedUser;
  let patternName = commandBody;
  let prizeAmount = null;

  if (!winnerUser && commandBody) {
    const commaParts = commandBody.split(/\s*,\s*/);
    if (commaParts.length >= 2) {
      const [candidate, ...patternParts] = commaParts;
      const patternCandidate = patternParts.join(",").trim();

      // Check if the last part is a number (custom prize amount)
      const lastPart = patternParts[patternParts.length - 1].trim();
      const amountMatch = lastPart.match(/^(\d+)$/);

      if (amountMatch && patternParts.length >= 2) {
        const numericValue = parseInt(amountMatch[1], 10);

        // Format: /bingo @user, pattern, prize_amount
        prizeAmount = numericValue;
        patternName = patternParts.slice(0, -1).join(",").trim();
      } else if (!patternCandidate) {
        await ctx.reply(
          "❌ Please provide a pattern name after the comma, e.g. /bingo @user, <pattern>."
        );
        return;
      } else {
        // Format: /bingo @user, pattern
        const matchedPlayer = await findSessionPlayer(sessionId, candidate.trim());
        if (matchedPlayer) {
          winnerUser = matchedPlayer;
          patternName = patternCandidate;
        }
      }
    }
  }

  if (!winnerUser && commandBody) {
    const tokens = commandBody.split(/\s+/).filter(Boolean);
    for (let len = Math.min(tokens.length, 4); len > 0; len -= 1) {
      const candidate = tokens.slice(0, len).join(" ");
      const remaining = tokens.slice(len).join(" ");
      if (!remaining) continue;
      const matchedPlayer = await findSessionPlayer(sessionId, candidate);
      if (matchedPlayer) {
        winnerUser = matchedPlayer;
        patternName = remaining.trim();
        break;
      }
    }
  }

  const winnerUserId = repliedUser?.id || winnerUser?.user_id || winnerUser?.id || senderId;
  if (!winnerUser) {
    await ctx.reply(
      "😔 Could not identify the winner. Reply to a player or use @username/ID, comma, and pattern.",
      { reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  if (!patternName) {
    await ctx.reply("❌ Usage: /bingo <player> <pattern> or reply to a player with /bingo <pattern>");
    return;
  }

  try {
    // Get active session
    const session = await bingoGameSession.findByGroupId(groupId);
    if (!session) {
      await ctx.reply("❌ No active game session.");
      return;
    }

    if (session.is_free === true && !session.is_raid) {
      await ctx.reply("🎮 This is a free play game — no winners to register. Use /bingostop when you're done.");
      return;
    }

    if (session.is_raid === true) {
      // Raid mode: no winner registration, but don't show message
      return;
    }

    if (session.status !== "active") {
      await ctx.reply("❌ Game is not active yet. Use /bingoforce to start.");
      return;
    }

    const rawWinnerFirstName = String(winnerUser.first_name || winnerUser.firstName || "").trim();
    const rawWinnerUsername = String(winnerUser.username || "").trim();
    const winnerName = rawWinnerFirstName || (rawWinnerUsername ? `@${rawWinnerUsername}` : "Player");
    const isParticipant = await bingoGamePlayer.isPlayerInSession(session.id, winnerUserId);

    if (!isParticipant) {
      await ctx.reply(
        `❌ <b>${winnerName}</b> is not playing in this game yet. Only joined players can be marked as winners.`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    const updatedWinners = await gameWinnerModel.getWinnersBySession(session.id);
    const distinctPatterns = new Set(
      (updatedWinners || [])
        .map((winner) => String(winner.pattern_name || "").trim().toLowerCase())
        .filter(Boolean),
    );
    const patternCount = Number(session.pattern_count || 0);
    const normalizedPatternName = String(patternName).trim().toLowerCase();

    if (patternCount > 0 && !distinctPatterns.has(normalizedPatternName) && distinctPatterns.size >= patternCount) {
      await ctx.reply(
        `⏭️ Winner registration is already complete for this session. Only ${patternCount} distinct pattern${patternCount === 1 ? "" : "s"} allowed.`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // Check if session already has custom prize amounts and prevent mixing
    const hasCustomPrize = (updatedWinners || []).some(w => w.prize_amount && w.prize_amount > 0);
    if (hasCustomPrize && !prizeAmount) {
      await ctx.reply(
        `❌ This session already has custom prize amounts. You cannot mix custom and equal division in the same session.\n\nPlease use /bingo @user, pattern, <amount> for all winners.`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    if (!hasCustomPrize && prizeAmount) {
      await ctx.reply(
        `❌ This session is using equal division. You cannot mix custom and equal division in the same session.\n\nPlease use /bingo @user, pattern (without amount) for all winners.`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    // Queue a confirmation before persisting the winner
    // Generate a short key for this confirmation
    const key = `${session.id}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    pendingWinnerConfirmations.set(key, {
      sessionId: session.id,
      winnerUserId,
      patternName,
      prizeAmount,
      addedBy: senderId,
    });

    // Send confirmation message with styled Accept/Reject buttons
    try {
      const { InlineKeyboard } = require("grammy");
      const keyboard = new InlineKeyboard()
        .text("✅ Accept", `confirm_winner_${key}`).success()
        .text("❌ Reject", `reject_winner_${key}`).danger();

      const prizeText = prizeAmount ? ` (Prize: ₱${prizeAmount})` : "";
      await ctx.reply(
        `✅ <b>${winnerName}</b> won pattern <b>${patternName}</b>!${prizeText}\n\nClean Bingo?`,
        {
          parse_mode: "HTML",
          reply_markup: keyboard,
          reply_to_message_id: ctx.message.message_id,
        }
      );
    } catch (err) {
      console.error("Failed to send winner confirmation message:", err);
      await ctx.reply(
        `✅ <b>${winnerName}</b> won pattern <b>${patternName}</b>!\n\nClean Bingo?`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
      // Keep the pending confirmation in case callback arrives via another message
    }
  } catch (error) {
    console.error("Error in bingo winner command:", error);
    await ctx.reply("❌ Error registering winner. Please try again.");
  }
}

async function handleUnbingo(ctx, bingoGameSession, bingoGamePlayer, gameWinnerModel, gameStateService, groupConfigService) {
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("🚫 This command only works in groups.");
    return;
  }

  const groupId = ctx.chat.id;
  const senderId = ctx.from.id;
  let isAdmin = await groupConfigService.isAdmin(groupId, senderId);

  if (!isAdmin) {
    try {
      const member = await ctx.api.getChatMember(groupId, senderId);
      isAdmin = member?.status === "administrator" || member?.status === "creator";
    } catch (error) {
      console.error("Error checking admin status for /unbingo:", error);
    }
  }

  if (!isAdmin) return;

  const identifier = String(ctx.message?.text || "")
    .replace(/^\/unbingo(?:@[\w_]+)?\s*/i, "")
    .trim();
  if (!identifier) {
    await ctx.reply("❌ Usage: /unbingo <name, ID, or username>");
    return;
  }

  try {
    const session = await bingoGameSession.findByGroupId(groupId);
    if (!session) {
      await ctx.reply("❌ No active game session.");
      return;
    }

    if (session.is_free === true && !session.is_raid) {
      await ctx.reply("🎮 This is a free play game — no winners to remove.");
      return;
    }

    if (session.is_raid === true) {
      // Raid mode: no winner removal, but don't show message
      return;
    }

    if (session.status !== "active") {
      await ctx.reply("❌ Game is not active yet. Use /bingoforce to start.");
      return;
    }

    const players = await bingoGamePlayer.getPlayersBySession(session.id);
    const normalizedIdentifier = identifier.replace(/^@+/, "").replace(/\s+/g, " ").toLowerCase();
    const numericIdentifier = Number(normalizedIdentifier);
    const player = players.find((candidate) => {
      if (Number.isInteger(numericIdentifier) && String(numericIdentifier) === normalizedIdentifier) {
        return String(candidate.user_id) === normalizedIdentifier;
      }
      const fullName = `${candidate.first_name || ""} ${candidate.last_name || ""}`.replace(/\s+/g, " ").trim().toLowerCase();
      return [fullName, String(candidate.first_name || "").toLowerCase(), String(candidate.last_name || "").toLowerCase(), String(candidate.username || "").toLowerCase()]
        .includes(normalizedIdentifier);
    });

    if (!player) {
      await ctx.reply("❌ Could not find that player in the active game.");
      return;
    }

    const winners = await gameWinnerModel.getWinnersBySession(session.id);
    const playerWinners = winners.filter((winner) => String(winner.user_id) === String(player.user_id));
    const winner = playerWinners[playerWinners.length - 1];
    if (!winner) {
      await ctx.reply("❌ That player has no registered bingo to undo.");
      return;
    }

    const deletedWinner = await gameWinnerModel.deleteWinner(winner.id, session.id);
    if (!deletedWinner) {
      await ctx.reply("❌ That bingo registration could not be found. It may already be undone.");
      return;
    }

    const remainingWinners = await gameWinnerModel.getWinnersBySession(session.id);
    const game = gameStateService?.getBingoGame?.(groupId);
    if (game && Number(session.pattern_count || 0) > remainingWinners.length) {
      game.completedDrawCount = null;
    }

    const displayName = player.first_name || player.username || player.user_id;
    await ctx.reply(`↩️ Undid bingo for <b>${displayName}</b> (pattern: <b>${deletedWinner.pattern_name}</b>).`, {
      parse_mode: "HTML",
      reply_to_message_id: ctx.message?.message_id,
    });
  } catch (error) {
    console.error("Error in unbingo command:", error);
    await ctx.reply("❌ Error undoing bingo. Please try again.");
  }
}

// Export the handler and the pending confirmations map
module.exports = { handleBingoWinner, handleUnbingo, pendingWinnerConfirmations };
