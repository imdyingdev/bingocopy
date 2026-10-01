/**
 * Bingo Stop command: /bingostop
 */

const { InputFile } = require("grammy");
const { IMAGE_ENABLED } = require("../../utils/imageSettings");
const { formatDuration } = require("./helpers");
const FundsLogger = require("../../utils/fundsLogger");
const { isFreePlaySession } = require("../../utils/playerUtils");

async function deleteSessionMessages(api, ctx, sessionInfo) {
  try {
    await api.deleteMessage(ctx.chat.id, ctx.message.message_id);
    console.log("Deleted /bingostop command message");
  } catch (deleteStopErr) {
    if (deleteStopErr.error_code !== 400 || deleteStopErr.description !== "Bad Request: message can't be deleted") {
      console.error("Failed to delete stop command message:", deleteStopErr.message);
    }
  }

  const deletions = [
    ["start command", sessionInfo?.start_command_chat_id, sessionInfo?.start_command_message_id],
    ["force command", sessionInfo?.force_command_chat_id, sessionInfo?.force_command_message_id],
    ["pattern selector", sessionInfo?.pattern_selector_chat_id, sessionInfo?.pattern_selector_message_id],
    ["player list", sessionInfo?.player_list_chat_id, sessionInfo?.player_list_message_id],
    ["channel hyperlink", sessionInfo?.channel_hyperlink_chat_id, sessionInfo?.channel_hyperlink_message_id],
  ];

  for (const [label, chatId, messageId] of deletions) {
    if (!chatId || !messageId) continue;
    try {
      await api.deleteMessage(chatId, messageId);
      console.log(`Deleted ${label} message ${messageId} from chat ${chatId}`);
    } catch (deleteErr) {
      if (deleteErr.error_code !== 400 || deleteErr.description !== "Bad Request: message can't be deleted") {
        console.error(`Failed to delete ${label} message:`, deleteErr.message);
      }
    }
  }
}

async function handleBingoStop(ctx, gameStateService, gameLogger, imageGenerationService, bingoFundsService, bingoGameSession, bingoGamePlayer, gameWinnerModel, userModel, groupConfigService) {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "🚫 This command can only be used in groups, not in private messages.",
    );
    return;
  }

  const chatId = ctx.chat.id;

  try {
    const member = await ctx.api.getChatMember(chatId, ctx.from.id);
    const status = member?.status;
    if (status !== "administrator" && status !== "creator") {
      await ctx.reply("🚫 Only group admins can end the bingo game.");
      return;
    }
  } catch (error) {
    console.error("Failed admin verification for /bingostop:", error);
    await ctx.reply("🚫 Unable to verify admin status. Only group admins can end the game.");
    return;
  }

  const isFundsOnly = await bingoFundsService.isFundsOnlyGroup(chatId);
  if (isFundsOnly) {
    const fundsGroupName = await bingoFundsService.getFundsGroupName(chatId);
    await ctx.reply(
      `🚫 <b>Gameplay Not Allowed</b>\n\n` +
      `This group (<b>${fundsGroupName || 'Funds Group'}</b>) is configured as a funds management group only.\n\n` +
      `Bingo gameplay commands are disabled here. Please use the main gameplay group to play bingo.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const game = gameStateService.getBingoGame(chatId);

  if (!game) {
    await ctx.reply("No active bingo game.");
    return;
  }

  let sessionInfo = null;
  if (game.sessionId) {
    try {
      sessionInfo = await bingoGameSession.findById(game.sessionId);
    } catch (error) {
      console.error("Error loading session for stop:", error);
    }
  }

  const hasExplicitGameMode = typeof game.isFree === "boolean" || typeof game.isRaid === "boolean";
  const isFreeOrRaid = hasExplicitGameMode
    ? game.isFree === true || game.isRaid === true
    : isFreePlaySession(sessionInfo);

  if (isFreeOrRaid) {
    try {
      const selectedItems = [];
      game.card.forEach((col) => {
        col.items.forEach((item) => {
          if (item.selected) {
            selectedItems.push({
              category: col.category,
              value: item.value,
            });
          }
        });
      });

      await gameLogger.logGameEnd(ctx, {
        round: game.round,
        totalDraws: game.selected.size,
        selectedItems: selectedItems,
      });
    } catch (error) {
      console.error("Failed to log free play game end:", error);
    }

    if (game.sessionId) {
      try {
        await bingoGameSession.end(game.sessionId);
        console.log("Free play session ended with ID:", game.sessionId);
      } catch (error) {
        console.error("Error ending free play session:", error);
      }
    }

    gameStateService.clearBingoGame(chatId);

    try {
      await deleteSessionMessages(ctx.api, ctx, sessionInfo);
    } catch (deleteError) {
      console.error("Error deleting free play messages:", deleteError);
    }

    // Send confirmation message for raid/free play
    const isRaid = typeof game.isRaid === "boolean"
      ? game.isRaid
      : sessionInfo?.is_raid === true;
    const stopMessage = isRaid 
      ? "⚔️ <b>Bingo Raid has ended!</b>" 
      : "🎮 <b>Free play has ended!</b>";
    
    await ctx.reply(stopMessage, { parse_mode: "HTML" });
    return;
  }

  try {
    const selectedItems = [];
    game.card.forEach((col) => {
      col.items.forEach((item) => {
        if (item.selected) {
          selectedItems.push({
            category: col.category,
            value: item.value,
          });
        }
      });
    });

    await gameLogger.logGameEnd(ctx, {
      round: game.round,
      totalDraws: game.selected.size,
      selectedItems: selectedItems,
    });
  } catch (error) {
    console.error("Failed to log game end:", error);
  }

  let players = [];
  let winners = [];

  if (game.sessionId) {
    try {
      if (!sessionInfo) {
        sessionInfo = await bingoGameSession.findById(game.sessionId);
      }
      players = await bingoGamePlayer.getPlayersBySession(game.sessionId);
      winners = await gameWinnerModel.getWinnersBySession(game.sessionId);
    } catch (error) {
      console.error("Error loading summary data:", error);
    }
  }

  const betPerPlayer = Number(sessionInfo?.bet_per_player || 5);
  const shouldSettleFunds = Array.isArray(winners) && winners.length > 0;
  const playersCount = players.length || 0;
  const isSponsored = sessionInfo?.is_sponsored === true;
  
  let totalPot;
  if (isSponsored) {
    totalPot = Number(sessionInfo?.sponsor_amount || 0);
  } else {
    totalPot = playersCount * betPerPlayer;
  }
  
  const patternCount = Number(sessionInfo?.pattern_count || 0);
  const distinctPatternCount = new Set(
    (winners || [])
      .map((winner) => String(winner.pattern_name || "").trim().toLowerCase())
      .filter(Boolean)
  ).size || 1;
  const realPatternCount = patternCount > 0 ? patternCount : distinctPatternCount;
  const prizePerPattern = totalPot > 0 ? Math.floor(totalPot / realPatternCount) : 0;
  const startTime = Number(game.startedAt || Date.now());
  const duration = formatDuration(Date.now() - startTime);

  // Group winners by pattern to calculate split prizes for display
  const winnersByPattern = {};
  for (const winner of winners || []) {
    const normalizedPattern = String(winner.pattern_name || "").trim().toLowerCase();
    if (!winnersByPattern[normalizedPattern]) {
      winnersByPattern[normalizedPattern] = [];
    }
    winnersByPattern[normalizedPattern].push(winner);
  }
  const winnerPrizes = {};
  const dpcPlayers = new Set(
    players.filter((player) => player.used_dpc === true).map((player) => String(player.user_id))
  );
  for (const [pattern, patternWinners] of Object.entries(winnersByPattern)) {
    // Check if any winner has a registered prize amount (same logic as settlement)
    let patternPrizeAmount = 0;
    for (const winner of patternWinners) {
      if (winner.prize_amount && winner.prize_amount > 0) {
        patternPrizeAmount = winner.prize_amount;
        break;
      }
    }
    
    // Fall back to equal division if no registered prize
    if (patternPrizeAmount === 0) {
      patternPrizeAmount = prizePerPattern;
    }
    
    const prizePerWinner = patternWinners.length > 0 ? Math.floor(patternPrizeAmount / patternWinners.length) : 0;
    for (const winner of patternWinners) {
      const userId = String(winner.user_id);
      winnerPrizes[userId] = dpcPlayers.has(userId) ? prizePerWinner * 2 : prizePerWinner;
    }
  }

  // Consume DPC for winners (decrement quantity and deactivate if 0)
  for (const winner of winners) {
    const userId = winner.user_id;
    if (dpcPlayers.has(String(userId))) {
      try {
        // Decrement DPC quantity
        await userModel.decrementBacCard(userId, 'DPC');
        
        // Check if DPC quantity is now 0
        const dpcQuantity = await userModel.getBacCardQuantity(userId, 'DPC');
        if (dpcQuantity === 0) {
          await userModel.deactivateBac(userId, 'DPC');
          console.log(`[stop] DPC quantity reached 0, deactivated for user ${userId}`);
        }
        
        console.log(`[stop] Decremented DPC for winner ${userId}, remaining: ${dpcQuantity}`);
      } catch (error) {
        console.error(`[stop] Failed to consume DPC for winner ${userId}:`, error);
      }
    }
  }

  // Calculate total balls based on theme
  let totalBalls = 75; // Default for regular games
  if (game.themeId === "bingulo_beta") {
    const { BINGULO_BETA_DATA } = require("../../data/themes/binguloBetaDefaultData");
    // Calculate total items across all themes in BINGULO_BETA_DATA
    totalBalls = 0;
    for (const theme of Object.values(BINGULO_BETA_DATA)) {
      if (typeof theme === 'object' && !Array.isArray(theme)) {
        for (const category of Object.values(theme)) {
          if (Array.isArray(category)) {
            totalBalls += category.length;
          }
        }
      }
    }
  }

    const summaryBuffer = IMAGE_ENABLED ? await imageGenerationService.generateGameSummaryImage({
    groupName: ctx.chat.title || "BINGAGO!",
    players: playersCount,
    betPerPlayer,
    totalPot,
    patterns: realPatternCount,
    prizePerPattern,
      winners: winners.map((winner) => {
      const rawWinnerFirstName = String(winner.first_name || "").trim();
      const rawWinnerUsername = String(winner.username || "").trim();
      const playerName = rawWinnerFirstName || rawWinnerUsername || "Player";
      const splitPrize = winnerPrizes[String(winner.user_id)] || 0;
      
      // Special case: use strangers.gif for user 7745354842 when sponsoring a game
      let profilePhotoUrl = null;
      if (winner.user_id === 7745354842 && isSponsored) {
        profilePhotoUrl = imageGenerationService.getStrangersGifBase64();
      } else {
        profilePhotoUrl = winner.profile_photo_url || winner.profilePhotoUrl || winner.profilephotourl || null;
      }
      
      return {
        patternName: winner.pattern_name,
        prizeAmount: splitPrize,
        playerName,
        profilePhotoUrl,
      };
    }),
    ballsDrawn: game.completedDrawCount !== undefined ? game.completedDrawCount : (game.selected ? game.selected.size : 0),
    totalBalls,
    duration,
  }) : null;

  let settlementResult = null;
  if (game.sessionId && shouldSettleFunds) {
    try {
      const { settleBingoFundsForSession } = require("../../utils/bingoSettlement");
      settlementResult = await settleBingoFundsForSession({
        userModel,
        bingoGameSession,
        bingoGamePlayer,
        gameWinnerModel,
        groupId: chatId,
        sessionId: game.sessionId,
        groupConfigService,
      });
      console.log("Funds settlement complete", settlementResult);
    } catch (error) {
      console.error("Error settling bingo funds:", error);
    }
  } else if (game.sessionId) {
    console.log("No winners found; skipping funds settlement.");
    for (const player of players) {
      if (player.used_dpc === true) {
        try {
          await userModel.deactivateBac(player.user_id, 'DPC');
        } catch (error) {
          console.error(`[stop] Failed to deactivate DPC for user ${player.user_id}:`, error);
        }
      }
    }
  }

  // Send fund log to the configured log chat only if game has draws and winners
  const hasDraws = (game.drawOrder && game.drawOrder.length > 0) || (game.selected && game.selected.size > 0) || (game.completedDrawCount && game.completedDrawCount > 0);
  const hasWinners = Array.isArray(winners) && winners.length > 0;
  
  if (game.sessionId && hasDraws && hasWinners) {
    try {
      const logChatId = await groupConfigService.getLogChatId(chatId);
      if (logChatId) {
        const fundsLogger = new FundsLogger();
        try {
          // Send sticker first
          const stickerId = "CAACAgIAAxkBAAEGcWxqkWfM_0hBErVY34p2_jWH8Nr0NAACHTIAAkWxuUnfSddTVa9lJj0E";
          try {
            await ctx.api.sendSticker(logChatId, stickerId);
            console.log(`[funds-log] Sent sticker to chat ${logChatId}`);
          } catch (stickerError) {
            console.error("[funds-log] Error sending sticker:", stickerError);
            // Continue with log message even if sticker fails
          }

          const fundsData = await fundsLogger.getFundsWithChanges(
            chatId, 
            game.sessionId, 
            betPerPlayer, 
            players, 
            winners, 
            settlementResult
          );
          const logMessage = fundsLogger.formatFundLogMessage(fundsData);
          
          await ctx.api.sendMessage(logChatId, logMessage, { parse_mode: "HTML" });
          console.log(`[funds-log] Sent fund log to chat ${logChatId}`);
        } catch (logError) {
          console.error("[funds-log] Error sending fund log:", logError);
        } finally {
          await fundsLogger.close();
        }
      }
    } catch (error) {
      console.error("[funds-log] Error checking log chat ID:", error);
    }
  } else if (game.sessionId) {
    console.log(`[funds-log] Skipping fund log - hasDraws: ${hasDraws}, hasWinners: ${hasWinners}`);
  }

  // End the database session
  if (game.sessionId) {
    try {
      await bingoGameSession.end(game.sessionId);
      console.log("Game session ended with ID:", game.sessionId);
    } catch (error) {
      console.error("Error ending game session:", error);
    }
  }

  // clearBingoGame keeps the group theme — theme is configured before each game
  gameStateService.clearBingoGame(chatId);

  // Check if no draws and no winners - if so, delete messages instead of sending summary
  // hasDraws and hasWinners are already declared above

  if (!hasDraws && !hasWinners) {
    try {
      await deleteSessionMessages(ctx.api, ctx, sessionInfo);
      return;
    } catch (deleteError) {
      console.error("Error deleting messages:", deleteError);
      // If deletion fails, continue with normal flow
    }
  }

  if (IMAGE_ENABLED) {
    try {
      await ctx.replyWithChatAction("upload_photo");
    } catch (chatActionError) {
      console.warn("sendChatAction failed, continuing without it:", chatActionError.message);
    }
  }

  try {
    // Get the configured channel from group config
    const groupConfig = await groupConfigService.getGroupConfig(chatId);
    const configuredChannelId = groupConfig?.channel_id;

    // If no balls were drawn, send summary to group. If draws happened and channel is configured, send to channel.
    // hasDraws is already declared above
    const targetChatForSummary = (hasDraws && configuredChannelId) ? configuredChannelId : ctx.chat.id;
    let summaryCaption = "🛑 Bingo game ended.";

    if (targetChatForSummary !== ctx.chat.id &&
        sessionInfo?.channel_hyperlink_message_id) {
      try {
        const channelInfo = await ctx.api.getChat(targetChatForSummary);
        const chatIdentifier = channelInfo?.username
          ? `https://t.me/${channelInfo.username}/${sessionInfo.channel_hyperlink_message_id}`
          : `https://t.me/c/${String(targetChatForSummary).replace(/^-100/, "")}/${sessionInfo.channel_hyperlink_message_id}`;

        summaryCaption = `<a href="${chatIdentifier}"><b>🛑 Bingo game ended.</b></a>`;
      } catch (linkError) {
        console.error("Failed to build channel link for summary caption:", linkError);
      }
    }

    const replyOpts = {
      caption: summaryCaption,
      parse_mode: "HTML",
    };
    if (targetChatForSummary === ctx.chat.id) {
      replyOpts.reply_to_message_id = ctx.message.message_id;
    }
    if (IMAGE_ENABLED && summaryBuffer) {
      await ctx.api.sendPhoto(targetChatForSummary, new InputFile(summaryBuffer), replyOpts);
    } else {
      const escapeHtml = (value) => String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const winnersText = winners.map((winner) => {
        const name = escapeHtml(winner.first_name || winner.username || "Player");
        const pattern = escapeHtml(winner.pattern_name || "Bingo");
        return `• ${name} - ${pattern}: ${winnerPrizes[String(winner.user_id)] || 0}`;
      }).join("\n");
      const summaryText = `${summaryCaption}\nPlayers: ${playersCount}\nTotal pot: ${totalPot}\nBalls drawn: ${game.completedDrawCount !== undefined ? game.completedDrawCount : (game.selected ? game.selected.size : 0)}\n\n${winnersText || "No winners."}`;
      await ctx.api.sendMessage(targetChatForSummary, summaryText, {
        parse_mode: "HTML",
        ...(targetChatForSummary === ctx.chat.id ? { reply_to_message_id: ctx.message.message_id } : {}),
      });
    }
  } catch (photoError) {
    console.error("Failed to send summary photo:", photoError);
    await ctx.reply("🛑 Bingo game ended.", { reply_to_message_id: ctx.message.message_id });
  }
}

module.exports = { handleBingoStop };
