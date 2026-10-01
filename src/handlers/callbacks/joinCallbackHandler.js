/**
 * Join game callback handler
 * Handles join_game_ callback queries
 */

const { playerListMessages } = require("../../commands/bingo");
const { THEME_EMOJIS } = require("../../constants/themeEmojis");
const { formatPlayerWithIndicators, isFreePlaySession } = require("../../utils/playerUtils");
const { buildJoinRichMessage, buildJoinPlainMessage } = require("../../commands/bingo/helpers");

function isValidChannelMembershipStatus(status, isMember = false) {
  return ["member", "administrator", "creator", "owner", "subscriber"].includes(status) ||
    (status === "restricted" && isMember === true);
}

async function getMissingRequiredChannels(ctx, userId, groupId, groupConfigService) {
  const groupConfig = await groupConfigService.getGroupConfig(groupId);
  const requiredEntries = [];

  if (groupConfig?.channel_id) {
    requiredEntries.push({ type: "id", value: Number(groupConfig.channel_id) });
  }

  const defaultHandles = ["@bingagokabah", "@BingoForever"];
  for (const handle of defaultHandles) {
    requiredEntries.push({ type: "username", value: handle });
  }

  const missing = [];
  for (const entry of requiredEntries) {
    try {
      let chatId = entry.value;
      if (entry.type === "username") {
        const chat = await ctx.api.getChat(entry.value);
        chatId = chat?.id;
      }

      if (!chatId) continue;

      const member = await ctx.api.getChatMember(chatId, userId);
      const status = member?.status;
      const isMember = isValidChannelMembershipStatus(status, member?.is_member);

      if (!isMember) {
        const label = entry.type === "username"
          ? entry.value
          : `https://t.me/c/${String(chatId).replace(/^-100/, "")}`;
        missing.push(label);
      }
    } catch (error) {
      const label = entry.type === "username"
        ? entry.value
        : `https://t.me/c/${String(entry.value).replace(/^-100/, "")}`;
      missing.push(label);
    }
  }

  return [...new Set(missing)];
}

async function handleJoinGameCallback(ctx, groupConfigService, gameStateService, bingoGameSession, bingoGamePlayer, userModel) {
  const callbackData = ctx.callbackQuery.data;
  const sessionId = parseInt(callbackData.replace("join_game_", ""), 10);
  const userId = ctx.from.id;

  try {
    // Get the session
    const session = await bingoGameSession.findById(sessionId);
    if (!session) {
      try {
        await ctx.answerCallbackQuery({
          text: "❌ Game session not found.",
          show_alert: true,
        });
      } catch (e) {
        console.warn('[callback] Answer callback failed:', e.message);
      }
      return;
    }

    // Disabled channel subscription check
    // const missingChannels = await getMissingRequiredChannels(ctx, userId, session.group_id, groupConfigService);
    // if (missingChannels.length > 0) {
    //   const channelList = missingChannels.map((channel, index) => `${index + 1}. ${channel}`).join("\n");
    //   const reminderText =
    //     "❌ You must follow the required channel(s) before joining this game.\n\n" +
    //     "Please subscribe first:\n" +
    //     channelList +
    //     "\n\nThen try joining again.";

    //   try {
    //     await ctx.answerCallbackQuery({ text: reminderText, show_alert: true });
    //   } catch (e) {
    //     console.warn('[callback] Answer callback failed:', e.message);
    //   }

    //   try {
    //     await ctx.api.sendMessage(
    //       userId,
    //       "You are not subscribed to the required channel(s). Please follow them first before joining the game:\n\n" +
    //       channelList +
    //       "\n\nOnce you have followed them, you can join again."
    //     );
    //   } catch (dmError) {
    //     console.warn("Failed to DM subscription reminder:", dmError?.message || dmError);
    //   }
    //   return;
    // }

    // Check if user is banned from this game
    const isBanned = await bingoGameSession.isPlayerBanned(sessionId, userId);
    if (isBanned) {
      try {
        await ctx.answerCallbackQuery({
          text: "❌ Someone used a BAN card to ban you from this current game. You cannot join.",
          show_alert: true,
        });
      } catch (e) {
        console.warn('[callback] Answer callback failed:', e.message);
      }
      return;
    }

    const existingUser = await userModel.findByTelegramId(userId);
    if (!existingUser) {
      try {
        await ctx.answerCallbackQuery({
          text: "Please start the bot first in private chat by sending /start before joining the game.",
          show_alert: true,
        });
      } catch (e) {
        console.warn('[callback] Answer callback failed:', e.message);
      }
      return;
    }

    // Check if session is already active
    if (session.status === "active" && !isFreePlaySession(session)) {
      // Check if user has Late Entry Pass (LEP)
      const userBacCards = existingUser?.bac_cards || [];
      const hasLEP = userBacCards.includes('LEP');
      
      if (!hasLEP) {
        try {
          await ctx.answerCallbackQuery({
            text: "❌ The game has already started. You cannot join now.",
            show_alert: true,
          });
        } catch (e) {
          console.warn('[callback] Answer callback failed:', e.message);
        }
        return;
      }
      
      // Check if bola drawn is under 15
      const game = gameStateService?.getBingoGame(session.group_id);
      if (!game) {
        try {
          await ctx.answerCallbackQuery({
            text: "❌ Game state not found.",
            show_alert: true,
          });
        } catch (e) {
          console.warn('[callback] Answer callback failed:', e.message);
        }
        return;
      }
      
      const drawnCount = game.drawOrder ? game.drawOrder.length : 0;
      if (drawnCount >= 15) {
        try {
          await ctx.answerCallbackQuery({
            text: "❌ Late Entry Pass can only be used if 15 or fewer names have been called. Currently " + drawnCount + " have been called.",
            show_alert: true,
          });
        } catch (e) {
          console.warn('[callback] Answer callback failed:', e.message);
        }
        return;
      }
      
      console.log(`[join-callback] Late entry enabled | group=${session.group_id} user=${userId} drawn=${drawnCount}`);
    }

    const profilePhoto = await userModel.getProfilePhotoData(ctx.api, userId);

    // Update user profile data if needed
    const updatedUser = await userModel.createOrUpdate({
      telegramId: userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      profilePhotoUrl: profilePhoto.profilePhotoUrl,
      profilePhotoFileId: profilePhoto.profilePhotoFileId,
    });
    console.log(`[join-callback] User profile updated | group=${session.group_id} user=${userId}`);

    const betPerPlayer = Number(session.bet_per_player || 5);
    const isSponsored = session.is_sponsored === true;
    const isFree = isFreePlaySession(session);
    const groupConfig = await groupConfigService.getGroupConfig(session.group_id);
    const themeId = groupConfig?.theme_id || gameStateService.getTheme(session.group_id);

    // Check if user is already in the session
    const alreadyJoined = await bingoGamePlayer.isPlayerInSession(sessionId, userId);
    if (alreadyJoined) {
      const rawFirstName = String(ctx.from.first_name || "").trim();
      const rawUsername = String(ctx.from.username || "").trim();
      const displayName = rawFirstName || (rawUsername ? `@${rawUsername}` : "Player");

      const players = await bingoGamePlayer.getPlayersBySession(sessionId, themeId);
      const playersWithIndicators = await Promise.all(players.map(async (player) => ({
        ...player,
        has_bbs: await userModel.isBacActivated(player.user_id, 'BBS'),
        has_mcp: (await userModel.getBacCardQuantity(player.user_id, 'MCP')) > 0,
      })));
      const playerCount = players.length;
      
      // Get theme for custom emoji support
      const isFrozen = themeId === "frozen";
      const isSpongeBob = themeId === "spongebob";
      console.log(`[join-callback] Player list formatting | group=${session.group_id} session=${sessionId} theme=${themeId}`);
      
      let playersList;
      if (isFree) {
        let headerText;
        if (isFrozen) {
          const premiumIds = THEME_EMOJIS.frozen.header;
          const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
          const placeholderEmoji = '⭐';
          const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
          const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
          const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
          const spacer = '\u00A0'.repeat(5);
          headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
        } else if (isSpongeBob) {
          const premiumIds = THEME_EMOJIS.spongebob.header;
          const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
          const placeholderEmoji = '⭐';
          const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
          headerText = validPremiumIds.map(emojiTag).join('');
        } else {
          headerText = '🎯 <b>Bingo Game Started! — 🎮 Free Play</b>';
        }

        const playersEmoji = isFrozen ? '<tg-emoji emoji-id="5364118431320794549">⭐</tg-emoji>' : (isSpongeBob ? '<tg-emoji emoji-id="6041905321926991338">⭐</tg-emoji>' : '👥');

        playersList = [
          headerText.endsWith('Free Play') ? headerText : `${headerText} — 🎮 Free Play`,
          "",
          `<b>${playersEmoji} Players Joined: ${players.length}</b>`,
          ...playersWithIndicators.map((player, index) => formatPlayerWithIndicators(player, index, 0)),
          "",
          "<b>Use /bingoforce to start the game</b>",
        ].join("\n");
      } else if (isSponsored) {
        // Sponsored game format
        const sponsorNameUpper = String(session.sponsor_name || "Sponsor").toUpperCase();
        const sponsorNameSanitized = String(session.sponsor_name || "Sponsor").replace(/[<>]/g, "");
        const sponsorHyperlink = `<a href="tg://user?id=${session.sponsor_id}"><b>${sponsorNameUpper}</b></a>`;
        
        let headerText;
        if (isFrozen) {
          const premiumIds = THEME_EMOJIS.frozen.header;
          const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
          const placeholderEmoji = '⭐';
          const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
          const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
          const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
          const spacer = '\u00A0'.repeat(5);
          headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
        } else if (isSpongeBob) {
          const premiumIds = THEME_EMOJIS.spongebob.header;
          const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
          const placeholderEmoji = '⭐';
          const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
          headerText = validPremiumIds.map(emojiTag).join('');
        } else {
          headerText = '🎯 <b>Bingo Game Started!</b>';
        }
        
        const potEmoji = isFrozen ? '<tg-emoji emoji-id="5447172172428629426">⭐</tg-emoji>' : (isSpongeBob ? '<tg-emoji emoji-id="6044287731696148842">⭐</tg-emoji>' : '💰');
        const playersEmoji = isFrozen ? '<tg-emoji emoji-id="5364118431320794549">⭐</tg-emoji>' : (isSpongeBob ? '<tg-emoji emoji-id="6041905321926991338">⭐</tg-emoji>' : '👥');
        
        playersList = [
          headerText,
          "",
          `— SPONSORED BY ${sponsorHyperlink}`,
          "",
          `<b>${potEmoji} Pot: ₱${Number(session.sponsor_amount).toLocaleString()}</b>`,
          "",
          `<b>${playersEmoji} Players Joined: ${players.length}</b>`,
          ...playersWithIndicators.map((player, index) => formatPlayerWithIndicators(player, index, 0)),
          "",
          "<b>Use /bingoforce to start the game</b>",
        ].join("\n");
      } else {
        // Regular game format
        let headerText;
        if (isFrozen) {
          const premiumIds = THEME_EMOJIS.frozen.header;
          const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
          const placeholderEmoji = '⭐';
          const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
          const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
          const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
          const spacer = '\u00A0'.repeat(5);
          headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
        } else if (isSpongeBob) {
          const premiumIds = THEME_EMOJIS.spongebob.header;
          const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
          const placeholderEmoji = '⭐';
          const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
          headerText = validPremiumIds.map(emojiTag).join('');
        } else {
          headerText = '🎯 <b>Bingo Game Started!</b>';
        }
        
        const potEmoji = isFrozen ? '<tg-emoji emoji-id="5447172172428629426">⭐</tg-emoji>' : (isSpongeBob ? '<tg-emoji emoji-id="6044287731696148842">⭐</tg-emoji>' : '💰');
        const playersEmoji = isFrozen ? '<tg-emoji emoji-id="5364118431320794549">⭐</tg-emoji>' : (isSpongeBob ? '<tg-emoji emoji-id="6041905321926991338">⭐</tg-emoji>' : '👥');
        
        playersList = [
          headerText,
          "",
          `<b>${potEmoji} Pot: ₱${Number(players.length * betPerPlayer).toLocaleString()}</b>`,
          "",
          `<b>${playersEmoji} Players Joined: ${players.length}</b>`,
          ...playersWithIndicators.map((player, index) => formatPlayerWithIndicators(player, index, betPerPlayer)),
          "",
          "<b>Use /bingoforce to start the game</b>",
        ].join("\n");
      }

      const messageKey = `${session.group_id}_${sessionId}`;
      let messageInfo = playerListMessages.get(messageKey);
      
      // If not found in memory, try to get from database
      if (!messageInfo) {
        try {
          const sessionInfo = await bingoGameSession.findById(sessionId);
          if (sessionInfo?.player_list_message_id && sessionInfo?.player_list_chat_id) {
            messageInfo = { chat_id: sessionInfo.player_list_chat_id, message_id: sessionInfo.player_list_message_id };
            playerListMessages.set(messageKey, messageInfo);
            console.log(`[join-callback] Player list message loaded | session=${sessionId} message=${messageInfo.message_id} chat=${messageInfo.chat_id}`);
          }
        } catch (dbError) {
          console.error(`[join-callback] Player list message lookup failed | session=${sessionId}`, dbError);
        }
      }

      if (messageInfo && messageInfo.message_id) {
        try {
          const groupConfig = await groupConfigService.getGroupConfig(session.group_id);
          const themeId = groupConfig?.theme_id || gameStateService.getTheme(session.group_id);
          const { getPremiumStatus } = require("../../commands/bingo/sharedState");
          const usePremiumEmoji = await getPremiumStatus();
          const joinButtonText = (THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].joinButtonText) 
            ? THEME_EMOJIS[themeId].joinButtonText 
            : "🎮 Join Game";
          const richMessage = buildJoinRichMessage(
            playersList,
            messageInfo.gif_url,
            joinButtonText,
            sessionId,
            usePremiumEmoji ? THEME_EMOJIS[themeId]?.joinButton : null,
            null,
          );
          
          // Try to edit rich message using raw API call with rich_message parameter (Bot API 10.1)
          await ctx.api.raw.editMessageText({
            chat_id: messageInfo.chat_id,
            message_id: messageInfo.message_id,
            rich_message: { html: richMessage.html }
          });
        } catch (error) {
          const description = String(error?.description || "");
          if (error?.error_code !== 400 || !/message is not modified/i.test(description)) {
            console.error("Error editing player list message for already-joined user:", error);
          }
        }
      }

      try {
        await ctx.answerCallbackQuery({
          text: `✅ ${displayName}, your profile was updated and you are already joined.`,
          show_alert: false,
        });
      } catch (e) {
        console.warn('[callback] Answer callback failed:', e.message);
      }
      return;
    }

    if (!isSponsored && !isFree) {
      const userFunds = Number(updatedUser?.funds || 0);
      
      // Check if user has activated Free Pass (FP)
      const hasFP = await userModel.isBacActivated(userId, 'FP');
      
      // Check if user has activated Discount Pass (DP)
      const hasDP = await userModel.isBacActivated(userId, 'DP');
      
      if (hasFP) {
        // Check if bet is exactly 20 for FP
        if (betPerPlayer !== 20) {
          try {
            await ctx.answerCallbackQuery({
              text: `❌ Free Pass can only be used for games with ₱20 bet. Current bet is ₱${betPerPlayer}.`,
              show_alert: true,
            });
          } catch (e) {
            console.warn('[callback] Answer callback failed:', e.message);
          }
          return;
        }
        
        // Check admin funds for FP deduction (₱20)
        const adminFunds = await groupConfigService.getAdminFunds(session.group_id);
        if (adminFunds < 20) {
          try {
            await ctx.answerCallbackQuery({
              text: "❌ Insufficient admin funds for Free Pass join. Admin needs at least ₱20.",
              show_alert: true,
            });
          } catch (e) {
            console.warn('[callback] Answer callback failed:', e.message);
          }
          return;
        }
      } else if (hasDP) {
        // Check if bet is 20 or higher for DP
        if (betPerPlayer < 20) {
          try {
            await ctx.answerCallbackQuery({
              text: `❌ Discount Pass can only be used for games with ₱20 or higher bet. Current bet is ₱${betPerPlayer}.`,
              show_alert: true,
            });
          } catch (e) {
            console.warn('[callback] Answer callback failed:', e.message);
          }
          return;
        }
      }
      
      // Calculate effective bet amount
      let effectiveBet = betPerPlayer;
      if (hasDP) {
        effectiveBet = betPerPlayer - 5; // Reduce by ₱5
      }
      
      // Check user funds (unless using FP)
      if (!hasFP) {
        if (userFunds < effectiveBet) {
          try {
            await ctx.answerCallbackQuery({
              text: `❌ Insufficient funds: ₱${effectiveBet} required, you have ₱${Number(userFunds).toLocaleString()}.`,
              show_alert: true,
            });
          } catch (e) {
            console.warn('[callback] Answer callback failed:', e.message);
          }
          return;
        }
      }
    }

    // Add player to session
    const userBacCards = existingUser?.bac_cards || [];
    const hasLEP = userBacCards.includes('LEP');
    const isLateJoin = session.status === "active" && hasLEP;
    
    const hasDPC = isFree ? false : await userModel.isBacActivated(userId, 'DPC');
    const hasFP = isFree ? false : await userModel.isBacActivated(userId, 'FP');
    const hasDP = isFree ? false : await userModel.isBacActivated(userId, 'DP');
    
    await bingoGamePlayer.addPlayer(sessionId, userId, isLateJoin && !isFree, hasFP, hasDPC, hasDP);

    // Handle FP join - deduct from admin funds
    if (hasFP && !isFree) {
      try {
        await groupConfigService.updateAdminFunds(session.group_id, -20);
        console.log(`[join-callback] FP admin funds deducted | group=${session.group_id} amount=20 user=${userId}`);
      } catch (error) {
        console.error(`[join-callback] FP admin funds deduction failed | group=${session.group_id} user=${userId}`, error);
      }
      
      // Decrement FP quantity and deactivate if 0
      try {
        await userModel.decrementBacCard(userId, 'FP');
        
        // Check if FP quantity is now 0
        const fpQuantity = await userModel.getBacCardQuantity(userId, 'FP');
        if (fpQuantity === 0) {
          await userModel.deactivateBac(userId, 'FP');
          console.log(`[join-callback] FP deactivated | user=${userId} remaining=0`);
        }
        
        console.log(`[join-callback] FP consumed | user=${userId} remaining=${fpQuantity}`);
      } catch (error) {
        console.error(`[join-callback] FP consumption failed | user=${userId}`, error);
      }
    }

    // Handle DP join - deduct ₱5 from admin funds, decrement DP quantity, and deactivate if 0
    if (hasDP) {
      try {
        // Deduct ₱5 from admin funds
        await groupConfigService.updateAdminFunds(session.group_id, -5);
        console.log(`[join-callback] DP admin funds deducted | group=${session.group_id} amount=5 user=${userId}`);
        
        // Decrement DP quantity
        await userModel.decrementBacCard(userId, 'DP');
        
        // Check if DP quantity is now 0
        const dpQuantity = await userModel.getBacCardQuantity(userId, 'DP');
        if (dpQuantity === 0) {
          await userModel.deactivateBac(userId, 'DP');
          console.log(`[join-callback] DP deactivated | user=${userId} remaining=0`);
        }
        
        console.log(`[join-callback] DP consumed | user=${userId} remaining=${dpQuantity}`);
      } catch (error) {
        console.error(`[join-callback] DP handling failed | group=${session.group_id} user=${userId}`, error);
      }
    }

    // Remove LEP from user's inventory if used
    if (isLateJoin && !isFree) {
      try {
        await userModel.removeBacCard(userId, 'LEP');
        console.log(`[join-callback] LEP consumed | user=${userId}`);
      } catch (error) {
        console.error(`[join-callback] LEP removal failed | user=${userId}`, error);
      }
    }

    // Get updated player count
    const players = await bingoGamePlayer.getPlayersBySession(sessionId, themeId);
    const playersWithIndicators = await Promise.all(players.map(async (player) => ({
      ...player,
      has_bbs: await userModel.isBacActivated(player.user_id, 'BBS'),
      has_mcp: (await userModel.getBacCardQuantity(player.user_id, 'MCP')) > 0,
    })));
    const playerCount = players.length;
    console.log(`[join-callback] Player joined | group=${session.group_id} session=${sessionId} user=${userId} players=${playerCount}`);

    const rawFirstName = String(ctx.from.first_name || "").trim();
    const rawUsername = String(ctx.from.username || "").trim();
    const displayName = rawFirstName || (rawUsername ? `@${rawUsername}` : "Player");

    // Format players list and bet amount
    let playersList;
    
    const isFrozen = themeId === "frozen";
    const isSpongeBob = themeId === "spongebob";
    
    const { getPremiumStatus } = require("../../commands/bingo/sharedState");
    const usePremiumEmoji = await getPremiumStatus();
    console.log(`[join-callback] Player list formatting | group=${session.group_id} session=${sessionId} theme=${themeId} premiumEmoji=${usePremiumEmoji}`);
    
    if (isFree) {
      let headerText;
      if (usePremiumEmoji && isFrozen) {
        const premiumIds = THEME_EMOJIS.frozen.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
        const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
        const spacer = '\u00A0'.repeat(5);
        headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
      } else if (usePremiumEmoji && isSpongeBob) {
        const premiumIds = THEME_EMOJIS.spongebob.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        headerText = validPremiumIds.map(emojiTag).join('');
      } else {
        headerText = '🎯 <b>Bingo Game Started! — 🎮 Free Play</b>';
      }

      const playersEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.players[Math.floor(Math.random() * THEME_EMOJIS.frozen.players.length)]}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.players}">⭐</tg-emoji>` : '👥');

      playersList = [
        headerText.endsWith('Free Play') ? headerText : `${headerText} — 🎮 Free Play`,
        "",
        `<b>${playersEmoji} Players Joined: ${players.length}</b>`,
        ...playersWithIndicators.map((player, index) => formatPlayerWithIndicators(player, index, 0)),
        "",
        "<b>Use /bingoforce to start the game</b>",
      ].join("\n");
    } else if (isSponsored) {
      const sponsorNameUpper = String(session.sponsor_name || "Sponsor").toUpperCase();
      const sponsorNameSanitized = String(session.sponsor_name || "Sponsor").replace(/[<>]/g, "");
      const sponsorHyperlink = `<a href="tg://user?id=${session.sponsor_id}"><b>${sponsorNameUpper}</b></a>`;
      
      let headerText;
      if (usePremiumEmoji && isFrozen) {
        const premiumIds = THEME_EMOJIS.frozen.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
        const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
        const spacer = '\u00A0'.repeat(5);
        headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
      } else if (usePremiumEmoji && isSpongeBob) {
        const premiumIds = THEME_EMOJIS.spongebob.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        headerText = validPremiumIds.map(emojiTag).join('');
      } else {
        headerText = '🎯 <b>Bingo Game Started!</b>';
      }
      
      const potEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.pot}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.pot}">⭐</tg-emoji>` : '💰');
      const playersEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.players[Math.floor(Math.random() * THEME_EMOJIS.frozen.players.length)]}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.players}">⭐</tg-emoji>` : '👥');
      
      playersList = [
        headerText,
        "",
        `— SPONSORED BY ${sponsorHyperlink}`,
        "",
        `<b>${potEmoji} Pot: ₱${Number(session.sponsor_amount).toLocaleString()}</b>`,
        "",
        `<b>${playersEmoji} Players Joined: ${players.length}</b>`,
        ...playersWithIndicators.map((player, index) => formatPlayerWithIndicators(player, index, 0)),
        "",
        "<b>Use /bingoforce to start the game</b>",
      ].join("\n");
    } else {
      let headerText;
      if (usePremiumEmoji && isFrozen) {
        const premiumIds = THEME_EMOJIS.frozen.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
        const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
        const spacer = '\u00A0'.repeat(5);
        headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
      } else if (usePremiumEmoji && isSpongeBob) {
        const premiumIds = THEME_EMOJIS.spongebob.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        headerText = validPremiumIds.map(emojiTag).join('');
      } else {
        headerText = '🎯 <b>Bingo Game Started!</b>';
      }
      
      const potEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.pot}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.pot}">⭐</tg-emoji>` : '💰');
      const playersEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.players[Math.floor(Math.random() * THEME_EMOJIS.frozen.players.length)]}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.players}">⭐</tg-emoji>` : '👥');
      
      playersList = [
        headerText,
        "",
        `<b>${potEmoji} Pot: ₱${Number(players.length * betPerPlayer).toLocaleString()}</b>`,
        "",
        `<b>${playersEmoji} Players Joined: ${players.length}</b>`,
        ...playersWithIndicators.map((player, index) => formatPlayerWithIndicators(player, index, betPerPlayer)),
        "",
        "<b>Use /bingoforce to start the game</b>",
      ].join("\n");
    }

    try {
      await ctx.answerCallbackQuery({
        text: `✅ ${displayName} joined! (${playerCount} player${playerCount !== 1 ? "s" : ""})`,
        show_alert: false,
      });
    } catch (callbackError) {
      if (callbackError.description?.includes('query is too old') || callbackError.error_code === 400) {
        console.warn(`[join-callback] Callback query expired after successful join | session=${sessionId} user=${userId}`);
      } else {
        console.error(`[join-callback] Callback response failed | session=${sessionId} user=${userId}`, callbackError);
      }
    }

    const messageKey = `${session.group_id}_${sessionId}`;
    let messageInfo = playerListMessages.get(messageKey);
    
    if (!messageInfo) {
      try {
        const sessionInfo = await bingoGameSession.findById(sessionId);
        if (sessionInfo?.player_list_message_id && sessionInfo?.player_list_chat_id) {
          messageInfo = { chat_id: sessionInfo.player_list_chat_id, message_id: sessionInfo.player_list_message_id };
          playerListMessages.set(messageKey, messageInfo);
          console.log(`[callback-join-success] Retrieved message from database: message_id=${messageInfo.message_id}, chat_id=${messageInfo.chat_id}`);
        }
      } catch (dbError) {
        console.error("[callback-join-success] Failed to retrieve message from database:", dbError);
      }
    }

    if (messageInfo && messageInfo.message_id) {
      try {
        const groupConfig = await groupConfigService.getGroupConfig(session.group_id);
        const themeId = groupConfig?.theme_id || gameStateService.getTheme(session.group_id);
        const { getPremiumStatus } = require("../../commands/bingo/sharedState");
        const usePremiumEmoji = await getPremiumStatus();
        const joinButtonText = (THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].joinButtonText)
          ? THEME_EMOJIS[themeId].joinButtonText
          : "🎮 Join Game";
        const richMessage = buildJoinRichMessage(
          playersList,
          messageInfo.gif_url,
          joinButtonText,
          sessionId,
          usePremiumEmoji ? THEME_EMOJIS[themeId]?.joinButton : null,
          null,
        );
        const editWithRetry = async (maxRetries = 3) => {
          for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
              // Try to edit rich message using raw API call with rich_message parameter (Bot API 10.1)
              await ctx.api.raw.editMessageText({
                chat_id: messageInfo.chat_id,
                message_id: messageInfo.message_id,
                rich_message: { html: richMessage.html }
              });
              console.log(`[join-callback] Player list updated | session=${sessionId} message=${messageInfo.message_id}`);
              return;
            } catch (error) {
              if (error.error_code === 429 && error.parameters?.retry_after) {
                const retryAfter = error.parameters.retry_after;
                console.warn(`[join-callback] Player list rate limited | retryAfter=${retryAfter}s attempt=${attempt + 1}/${maxRetries}`);
                if (attempt < maxRetries - 1) {
                  await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                  continue;
                }
              }
              throw error;
            }
          }
        };
        
        await editWithRetry();
      } catch (error) {
        console.error("Error editing player list message:", error);
        try {
          await ctx.answerCallbackQuery({
            text: "❌ Could not update the join list. Please retry or restart the game.",
            show_alert: true,
          });
        } catch (e) {
          console.warn('[callback] Answer callback failed:', e.message);
        }
      }
    } else {
      console.error(`Missing player list message info for session ${sessionId} and group ${session.group_id}`);
      try {
        await ctx.answerCallbackQuery({
          text: "❌ Unable to update join list. The join card is unavailable.",
          show_alert: true,
        });
      } catch (e) {
        console.warn('[callback] Answer callback failed:', e.message);
      }
    }
  } catch (error) {
    console.error("Error handling join game callback:", error);
    try {
      await ctx.answerCallbackQuery({
        text: "❌ Error joining game. Please try again.",
        show_alert: true,
      });
    } catch (e) {
      console.warn('[callback] Answer callback failed:', e.message);
    }
  }
}

module.exports = { handleJoinGameCallback };
