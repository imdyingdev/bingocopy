/**
 * Pattern callback handler
 * Handles select_group_pattern_ and select_patterns_ callback queries
 */

const { buildJoinRichMessage, buildJoinPlainMessage } = require("../../commands/bingo/helpers");

async function handleSelectGroupPatternCallback(ctx, groupConfigService, gameStateService) {
  const callbackData = ctx.callbackQuery.data;
  const groupId = parseInt(callbackData.replace("select_group_pattern_", ""), 10);
  const userId = ctx.from.id;

  try {
    // First check if registered as admin in database
    const existingConfig = await groupConfigService.getGroupConfig(groupId);
    let isVerifiedAdmin = existingConfig && String(existingConfig.admin_id) === String(userId);

    // If not registered admin, verify current admin status via Telegram API
    if (!isVerifiedAdmin) {
      try {
        const member = await ctx.api.getChatMember(groupId, userId);
        const status = member?.status;
        const isCurrentAdmin = status === "administrator" || status === "creator";
        
        if (!isCurrentAdmin) {
          await ctx.answerCallbackQuery({
            text: "⚠️ You are not authorized to configure this group.",
            show_alert: true,
          });
          return;
        }
        // User is a current admin, allow them to proceed
        isVerifiedAdmin = true;
      } catch (apiError) {
        // If API fails (e.g., bot lacks permissions), show helpful error
        await ctx.answerCallbackQuery({
          text: "⚠️ Could not verify admin status. Please ensure the bot has admin access and try again.",
          show_alert: true,
        });
        return;
      }
    }

    if (!isVerifiedAdmin) {
      await ctx.answerCallbackQuery({
        text: "⚠️ You are not authorized to configure this group.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    const { startPatternConfig } = require("../patternHandler");
    await startPatternConfig(ctx, groupId, null, gameStateService);
  } catch (error) {
    console.error("Error handling group select callback:", error);
    await ctx.answerCallbackQuery({
      text: "❌ Failed to process selection.",
      show_alert: true,
    });
  }
}

async function handleSelectPatternsCallback(ctx, groupConfigService, gameStateService, bingoGameSession, bingoGamePlayer) {
  const callbackData = ctx.callbackQuery.data;
  const parts = callbackData.replace("select_patterns_", "").split("_");
  const sessionId = parseInt(parts[0], 10);
  const patternCount = parseInt(parts[1], 10);
  const userId = ctx.from.id;

  try {
    // Get the session
    const session = await bingoGameSession.findById(sessionId);
    if (!session) {
      await ctx.answerCallbackQuery({
        text: "❌ Game session not found.",
        show_alert: true,
      });
      return;
    }

    // Verify user is the game starter or configured admin
    console.log(`[DEBUG] Pattern selector - userId=${userId}, starter_id=${session.starter_id}`);
    let isAuthorized = Number(session.starter_id) === Number(userId);
    try {
      const groupConfig = await groupConfigService.getGroupConfig(session.group_id);
      if (groupConfig && String(groupConfig.admin_id) === String(userId)) {
        isAuthorized = true;
      }
    } catch (configError) {
      console.error("Error checking group admin for pattern selection:", configError);
    }

    if (!isAuthorized) {
      console.log(`[DEBUG] Not authorized - user ${userId} is not starter ${session.starter_id} nor admin for group ${session.group_id}`);
      await ctx.answerCallbackQuery({
        text: "⚠️ Only the game starter or group admin can select patterns.",
        show_alert: false,
      });
      return;
    }

    console.log(`[DEBUG] User is authorized, setting pattern count to ${patternCount}`);

    // Set pattern count in database
    await bingoGameSession.setPatternCount(sessionId, patternCount);

    await ctx.answerCallbackQuery({
      text: `✅ Pattern Count Set to ${patternCount} and Game Started!`,
      show_alert: false,
    });

    // Edit the pattern selector message to show confirmation using rich message
    try {
      const confirmationHtml = `
<p>✅ <b>Pattern Count Set to ${patternCount} and Game Started!</b></p>`.trim();
      await ctx.api.raw.editMessageText({
        chat_id: session.group_id,
        message_id: ctx.callbackQuery.message.message_id,
        rich_message: { html: confirmationHtml }
      });
    } catch (e) {
      // Non-fatal: ignore if editing the selector message fails
      console.log("Could not edit pattern selector confirmation message (non-fatal):", e && e.description ? e.description : e);
    }

    let playerListCaption = `🎯 <b>Bingo Game Started!</b>\n\n`;
    const players = await bingoGamePlayer.getPlayersBySession(sessionId);
    const betPerPlayer = Number(session.bet_per_player || 5);
    const isSponsored = session.is_sponsored === true;
    
    if (isSponsored) {
      // Sponsored game format
      const sponsorNameUpper = String(session.sponsor_name || "Sponsor").toUpperCase();
      const sponsorHyperlink = `<a href="tg://user?id=${session.sponsor_id}"><b>${sponsorNameUpper}</b></a>`;
      playerListCaption += `— SPONSORED BY ${sponsorHyperlink}\n\n`;
      playerListCaption += `<b>💰 Pot: ₱${Number(session.sponsor_amount).toLocaleString()}</b>\n`;
    } else {
      // Regular game format
      const potAmount = (players && players.length) ? players.length * betPerPlayer : betPerPlayer;
      playerListCaption += `<b>💰 Pot: ₱${Number(potAmount).toLocaleString()}</b>\n`;
    }
    
    playerListCaption += `🎲 Pattern: ${patternCount}\n\n`;
    playerListCaption += "👥 Players Joined:\n";
    if (players && players.length) {
      // Sort players alphabetically
      const sortedPlayers = players.sort((a, b) => {
        const rawPlayerFirstNameA = String(a.first_name || "").trim();
        const rawPlayerLastNameA = String(a.last_name || "").trim();
        const rawPlayerUsernameA = String(a.username || "").trim();
        const fullNameA = [rawPlayerFirstNameA, rawPlayerLastNameA].filter(Boolean).join(" ");
        const nameA = (fullNameA || rawPlayerUsernameA || "Player").toLowerCase();

        const rawPlayerFirstNameB = String(b.first_name || "").trim();
        const rawPlayerLastNameB = String(b.last_name || "").trim();
        const rawPlayerUsernameB = String(b.username || "").trim();
        const fullNameB = [rawPlayerFirstNameB, rawPlayerLastNameB].filter(Boolean).join(" ");
        const nameB = (fullNameB || rawPlayerUsernameB || "Player").toLowerCase();

        return nameA.localeCompare(nameB);
      });

      playerListCaption += sortedPlayers.map((player, index) => {
        const rawPlayerFirstName = String(player.first_name || "").trim();
        const rawPlayerLastName = String(player.last_name || "").trim();
        const rawPlayerUsername = String(player.username || "").trim();
        const fullName = [rawPlayerFirstName, rawPlayerLastName].filter(Boolean).join(" ");
        const name = fullName || rawPlayerUsername || "Player";
        const sanitizedName = name.replace(/[<>]/g, "");
        const hyperlink = `<a href="tg://user?id=${player.user_id}"><b>${sanitizedName}</b></a>`;
        
        // Add alarm emoji if player used Late Entry Pass
        const lepIndicator = player.used_lep ? " ⏰" : "";
        
        if (isSponsored) {
          return `${index + 1}. ${hyperlink}${lepIndicator}`;
        } else {
          return `${index + 1}. ${hyperlink}${lepIndicator} - ₱${betPerPlayer}`;
        }
      }).join("\n");
    } else {
      playerListCaption += "No players have joined yet.";
    }

    const messageChat = session.player_list_chat_id || session.group_id || ctx.chat.id;
    const messageId = session.player_list_message_id;
    const messageGifUrl = session.player_list_gif_url || null;
    
    console.log(`[DEBUG] Attempting to edit player list message: chat=${messageChat}, message_id=${messageId}, has_gif=${!!messageGifUrl}`);
    try {
      if (messageId) {
        // Use plain HTML format for editing (rich message tags don't work with editMessageCaption/editMessageText)
        const { THEME_EMOJIS } = require("../../constants/themeEmojis");
        const { getPremiumStatus } = require("../../commands/bingo/sharedState");
        const usePremiumEmoji = await getPremiumStatus();
        const groupConfig = await groupConfigService.getGroupConfig(session.group_id);
        const themeId = groupConfig?.theme_id || null;
        const joinButtonText = (THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].joinButtonText)
          ? THEME_EMOJIS[themeId].joinButtonText
          : "🎮 Join Game";

        const richMessage = buildJoinRichMessage(
          playerListCaption,
          messageGifUrl,
          joinButtonText,
          session.id,
          usePremiumEmoji ? THEME_EMOJIS[themeId]?.joinButton || null : null,
          null,
        );
        
        // Try to edit rich message using raw API call with rich_message parameter (Bot API 10.1)
        await ctx.api.raw.editMessageText({
          chat_id: messageChat,
          message_id: messageId,
          rich_message: { html: richMessage.html }
        });
      } else {
        // No stored message — edit the callback message (pattern selector) as fallback
        await ctx.editMessageText(playerListCaption, { parse_mode: "HTML" });
      }
    } catch (editError) {
      const description = editError?.description || "";
      if (editError?.error_code === 400 && /message is not modified/i.test(description)) {
        console.log("Pattern count selection edit skipped: message not modified.");
      } else {
        console.error("Error editing player list message after pattern selection:", editError);
      }
    }
  } catch (error) {
    console.error("Error handling pattern count selection:", error);
    await ctx.answerCallbackQuery({
      text: "❌ Error setting pattern count.",
      show_alert: true,
    });
  }
}

module.exports = { handleSelectGroupPatternCallback, handleSelectPatternsCallback };
