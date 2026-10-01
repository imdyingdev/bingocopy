/**
 * Join command - allows players to join a waiting bingo game session
 */

const { THEME_EMOJIS } = require("../../constants/themeEmojis");
const { formatPlayerWithIndicators, isFreePlaySession } = require("../../utils/playerUtils");
const { buildJoinRichMessage, buildJoinPlainMessage } = require("../bingo/helpers");

const DEFAULT_BET_AMOUNT = 5; // Default bet in pesos
const { playerListMessages, getPremiumStatus } = require("../bingo/sharedState");

const JOIN_PRANK_MESSAGES = [
  "Send a photo of you touching grass taken within the last 3 hours.",
  "Send a photo of yourself touching grass from the last 3 hours.",
  "Upload a photo of you touching grass taken in the past 3 hours.",
  "Send proof you've touched grass in the last 3 hours.",
  "Show us a photo of you touching grass within the last 3 hours.",
  "Snap a photo of yourself touching grass and send it. Bingo na bingo yarn?",
  "Send a recent photo of you touching grass (within the last 3 hours).",
  "Upload a picture of you outside touching grass from the past 3 hours.",
  "Share a photo of yourself touching grass taken no more than 3 hours ago.",
  "Send a photo showing you touching real grass within the last 3 hours.",
  "Let's make sure you've gone outside—send a photo touching grass from the last 3 hours.",
  "Time to touch grass! Send a photo taken within the last 3 hours.",
  "Go touch some grass, then send a photo taken within the last 3 hours.",
  "Need proof! Send a photo of you touching grass from the past 3 hours.",
  "Verify your outdoor adventure with a photo of you touching grass taken within the last 3 hours.",
  "Send a grass-touching selfie taken in the last 3 hours.",
  "Show that you've been outside—send a photo touching grass from the last 3 hours.",
  "Upload your latest \"touching grass\" photo (taken within the last 3 hours).",
  "Touch grass check, send a photo touching grass taken within the last 3 hours.",
  "Send a photo of you touching grass outdoors, taken within the last 3 hours."
];

const ALREADY_JOINED_MESSAGES = [
  "⚠️ You have already joined this game session.",
  "⚠️ Nakasali ka na ah. Paulit-ulit ka?",
  "⚠️ Hoy, naka-join ka na. Isa ka lang, kalma.",
  "⚠️ Isang slot lang bawat tao.",
  "⚠️ Relax lang.",
  "⚠️ Naka-join na ngani!",
  "⚠️ Bes, kasali ka na. Wag mo nang i-spam.",
  "⚠️ Di po nadadagdagan ang swerte sa kaka-join.",
  "⚠️ Aba, gusto mo yata dalawang card? ge dalawang card sayo go",
];

const NO_FUNDS_MESSAGES = [
  "💸 Wala ka pera hoy!",
  "😭 Hahahah sasali ka wala ka funds?",
  "🤦 Paano ka sasali kung wala kang pera?",
  "🐷 Mag-ipon ka muna bes",
  "💼 Sorry, insufficient funds. Maghanap ng trabaho.",
  "🤡 wala naman pera gusto pa sumali.",
  "📉 Balance check: 0. Result: Rejected.",
  "Ang lungkot, wala kang pera para sa bingo.",
  "⏳ Baka next time na, pag may pera ka na.",
  "💀 Mukhang kailangan mong mag-OT pa bes.",
];

const JOIN_SUCCESS_EMOJIS = ["🧁", "🎉", "✨", "🎊", "🥳", "🌟", "🎈", "🎁", "🏆", "👏"];

function getRandomJoinPrankMessage() {
  return JOIN_PRANK_MESSAGES[Math.floor(Math.random() * JOIN_PRANK_MESSAGES.length)];
}

function getRandomAlreadyJoinedMessage() {
  return ALREADY_JOINED_MESSAGES[Math.floor(Math.random() * ALREADY_JOINED_MESSAGES.length)];
}

function getRandomNoFundsMessage() {
  return NO_FUNDS_MESSAGES[Math.floor(Math.random() * NO_FUNDS_MESSAGES.length)];
}

function getRandomJoinSuccessEmoji() {
  return JOIN_SUCCESS_EMOJIS[Math.floor(Math.random() * JOIN_SUCCESS_EMOJIS.length)];
}

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

const NO_ACTIVE_SESSION_REPLIES = [
  "😿 La pa, maya na.",
  "😪 Zzzzzzz",
  "😏 bingo na bingo na amputa",
  "😔 ayaw na ata nila",
  "😅 hee hee",
  "🤔 never grow old??",
  "😮 hahah papansin admin oh, start nyo na nga",
  "👄 hey fucking bingo na tayo baby",
  "😼 bingohan na ba?",
];

function getRandomNoActiveSessionReply() {
  return NO_ACTIVE_SESSION_REPLIES[Math.floor(Math.random() * NO_ACTIVE_SESSION_REPLIES.length)];
}

async function handleJoin(ctx, bingoGameSession, bingoGamePlayer, user, gameStateService, groupConfigService) {
  // Only work in groups
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("🚫 This command only works in groups.");
    return;
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from.id;

  try {
    // Check if there's a waiting or active session
    const session = await bingoGameSession.findByGroupId(groupId);
    if (!session) {
      await ctx.reply(getRandomNoActiveSessionReply(), {
        reply_to_message_id: ctx.message?.message_id,
      });
      return;
    }

    // Disabled channel subscription check
    // const missingChannels = await getMissingRequiredChannels(ctx, userId, groupId, groupConfigService);
    // if (missingChannels.length > 0) {
    //   const channelList = missingChannels.map((channel, index) => `${index + 1}. ${channel}`).join("\n");
    //   const reminderText =
    //     "❌ You must follow the required channel(s) before joining this game.\n\n" +
    //     "Please subscribe first:\n" +
    //     channelList +
    //     "\n\nThen try joining again.";

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
    const isBanned = await bingoGameSession.isPlayerBanned(session.id, userId);
    if (isBanned) {
      await ctx.reply(
        "❌ Someone used a BAN card to ban you from this current game. You cannot join.",
        { reply_to_message_id: ctx.message?.message_id }
      );
      return;
    }

    const isFree = isFreePlaySession(session);

    // Check if session is already active (game started drawing items)
    if (session.status === "active" && !isFree) {
      // Check if user has activated Late Entry Pass (LEP)
      const hasLEP = await user.isBacActivated(userId, 'LEP');
      
      if (!hasLEP) {
        await ctx.reply(
          "❌ The game has already started. You cannot join now."
        );
        return;
      }
      
      // Check if bola drawn is under 15
      const game = gameStateService?.getBingoGame(groupId);
      if (!game) {
        await ctx.reply("❌ Game state not found.");
        return;
      }
      
      const drawnCount = game.drawOrder ? game.drawOrder.length : 0;
      if (drawnCount >= 15) {
        await ctx.reply(
          "❌ Late Entry Pass can only be used if 15 or fewer names have been called. Currently " + drawnCount + " have been called."
        );
        return;
      }
      
      // User has activated LEP and can join late
      console.log(`[join] Late entry enabled | group=${groupId} user=${userId} drawn=${drawnCount}`);
    }

    // Check if user is already in the session
    const alreadyJoined = await bingoGamePlayer.isPlayerInSession(
      session.id,
      userId
    );
    if (alreadyJoined) {
      await ctx.reply(getRandomAlreadyJoinedMessage(), {
        reply_to_message_id: ctx.message?.message_id,
      });
      return;
    }

    const existingUser = await user.findByTelegramId(userId);

    let updatedUser = existingUser;

    // Check if current time is between 5pm-10pm PH time (UTC+8)
    const now = new Date();
    const phTime = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
    const phHour = phTime.getUTCHours();
    const isPrankTime = phHour >= 17 && phHour < 22; // 5pm-10pm

    if (isPrankTime) {
      const shouldPrank = Math.random() >= 0.7; // 30% chance
      if (shouldPrank) {
        const profilePhoto = await user.getProfilePhotoData(ctx.api, userId);
        await user.createOrUpdate({
          telegramId: userId,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          profilePhotoUrl: profilePhoto.profilePhotoUrl,
          profilePhotoFileId: profilePhoto.profilePhotoFileId,
        });

        await ctx.reply(getRandomJoinPrankMessage(), {
          reply_to_message_id: ctx.message?.message_id,
        });
        return;
      }
    }

    updatedUser = await user.createOrUpdate({
      telegramId: userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    const isSponsoredGame = session.is_sponsored === true;
    const sessionBet = (isFree || isSponsoredGame) ? 0 : Number(session.bet_per_player || DEFAULT_BET_AMOUNT);
    const userFunds = Number(updatedUser?.funds || 0);
    
    // Check if user has activated Free Pass (FP)
    const hasFP = isFree ? false : await user.isBacActivated(userId, 'FP');
    
    // Check if user has activated Discount Pass (DP)
    const hasDP = isFree ? false : await user.isBacActivated(userId, 'DP');
    
    if (hasFP) {
      // Check if bet is exactly 20 for FP
      if (sessionBet !== 20) {
        await ctx.reply(
          `❌ Free Pass can only be used for games with ₱20 bet. Current bet is ₱${sessionBet}.`,
          { reply_to_message_id: ctx.message?.message_id }
        );
        return;
      }
      
      // Check if game is sponsored
      const isSponsored = session.is_sponsored === true;
      if (isSponsored) {
        await ctx.reply(
          "❌ Free Pass cannot be used in sponsored games.",
          { reply_to_message_id: ctx.message?.message_id }
        );
        return;
      }
      
      // Check admin funds for FP deduction (₱20)
      const adminFunds = await groupConfigService.getAdminFunds(groupId);
      if (adminFunds < 20) {
        await ctx.reply(
          "❌ Insufficient admin funds for Free Pass join. Admin needs at least ₱20.",
          { reply_to_message_id: ctx.message?.message_id }
        );
        return;
      }
    } else if (hasDP) {
      // Check if bet is 20 or higher for DP
      if (sessionBet < 20) {
        await ctx.reply(
          `❌ Discount Pass can only be used for games with ₱20 or higher bet. Current bet is ₱${sessionBet}.`,
          { reply_to_message_id: ctx.message?.message_id }
        );
        return;
      }
      
      // Check if game is sponsored
      const isSponsored = session.is_sponsored === true;
      if (isSponsored) {
        await ctx.reply(
          "❌ Discount Pass cannot be used in sponsored games.",
          { reply_to_message_id: ctx.message?.message_id }
        );
        return;
      }
    }
    
    // Calculate effective bet amount
    let effectiveBet = sessionBet;
    if (hasDP) {
      effectiveBet = sessionBet - 5; // Reduce by ₱5
    }
    
    // Check user funds (unless using FP or free play)
    if (!hasFP && !isFree) {
      if (userFunds < effectiveBet) {
        await ctx.reply(
          `❌ Insufficient funds: ₱${effectiveBet} required, you have ₱${userFunds}.`,
          { reply_to_message_id: ctx.message?.message_id }
        );
        return;
      }
    }

    // Handle FP join - deduct from admin funds
    if (hasFP) {
      try {
        await groupConfigService.updateAdminFunds(groupId, -20);
        console.log(`[join] FP admin funds deducted | group=${groupId} amount=20 user=${userId}`);
      } catch (error) {
        console.error(`[join] FP admin funds deduction failed | group=${groupId} user=${userId}`, error);
      }
      
      // Decrement FP quantity and deactivate if 0
      try {
        await user.decrementBacCard(userId, 'FP');
        
        // Check if FP quantity is now 0
        const fpQuantity = await user.getBacCardQuantity(userId, 'FP');
        if (fpQuantity === 0) {
          await user.deactivateBac(userId, 'FP');
          console.log(`[join] FP deactivated | user=${userId} remaining=0`);
        }
        
        console.log(`[join] FP consumed | user=${userId} remaining=${fpQuantity}`);
      } catch (error) {
        console.error(`[join] FP consumption failed | user=${userId}`, error);
      }
    }

    // Handle DP join - deduct ₱5 from admin funds, decrement DP quantity, and deactivate if 0
    if (hasDP) {
      try {
        // Deduct ₱5 from admin funds
        await groupConfigService.updateAdminFunds(groupId, -5);
        console.log(`[join] DP admin funds deducted | group=${groupId} amount=5 user=${userId}`);
        
        // Decrement DP quantity
        await user.decrementBacCard(userId, 'DP');
        
        // Check if DP quantity is now 0
        const dpQuantity = await user.getBacCardQuantity(userId, 'DP');
        if (dpQuantity === 0) {
          await user.deactivateBac(userId, 'DP');
          console.log(`[join] DP deactivated | user=${userId} remaining=0`);
        }
        
        console.log(`[join] DP consumed | user=${userId} remaining=${dpQuantity}`);
      } catch (error) {
        console.error(`[join] DP handling failed | group=${groupId} user=${userId}`, error);
      }
    }

    // Add player to session
    const userBacCards = updatedUser?.bac_cards || [];
    const hasLEP = isFree ? false : await user.isBacActivated(userId, 'LEP');
    const hasDPC = isFree ? false : await user.isBacActivated(userId, 'DPC');
    const isLateJoin = !isFree && session.status === "active" && hasLEP;
    const isFPJoin = hasFP;
    const isDPJoin = hasDP;
    
    await bingoGamePlayer.addPlayer(session.id, userId, isLateJoin, isFPJoin, hasDPC, isDPJoin);

    const groupConfig = await groupConfigService.getGroupConfig(groupId);
    const themeId = groupConfig?.theme_id || (gameStateService ? gameStateService.getTheme(groupId) : null);

    // Get updated player count and list
    const players = await bingoGamePlayer.getPlayersBySession(session.id, themeId);
    
    // Check BBS activation for each player
    const playersWithBBS = await Promise.all(
      players.map(async (player) => {
        const hasBBS = await user.isBacActivated(player.user_id, 'BBS');
        const hasMCP = (await user.getBacCardQuantity(player.user_id, 'MCP')) > 0;
        return { ...player, has_bbs: hasBBS, has_mcp: hasMCP };
      })
    );
    
    const playerCount = playersWithBBS.length;
    console.log(`[join] Player joined | group=${groupId} session=${session.id} user=${userId} players=${playerCount}`);

    const rawFirstName = String(ctx.from.first_name || "").trim();
    const rawUsername = String(ctx.from.username || "").trim();
    const displayName =
      rawFirstName ||
      (rawUsername ? `@${rawUsername}` : "Player");

    // Format players list with hyperlinks and bet amount
    // Get theme for custom emoji support - use group config instead of gameStateService
    const isFrozen = themeId === "frozen";
    const isSpongeBob = themeId === "spongebob";
    
    // Check premium status for custom emoji support
    const usePremiumEmoji = await getPremiumStatus();
    console.log(`[join] Player list formatting | group=${groupId} session=${session.id} theme=${themeId} premiumEmoji=${usePremiumEmoji}`);
    
    let headerText;
    if (usePremiumEmoji && isFrozen) {
      // Build "FROZEN BINGO!" header with custom emojis
      const premiumIds = THEME_EMOJIS.frozen.header;
      const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
      const placeholderEmoji = '⭐';
      const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
      const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
      const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
      const spacer = '\u00A0'.repeat(5);
      headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
    } else if (usePremiumEmoji && isSpongeBob) {
      // SpongeBob: "ARE YOU" on first line, "READY KIDS?" on second line with 5 spaces between words
      const premiumIds = THEME_EMOJIS.spongebob.header;
      const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
      const placeholderEmoji = '⭐';
      const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
      const are = validPremiumIds.slice(0, 3).map(emojiTag).join('');
      const you = validPremiumIds.slice(3, 6).map(emojiTag).join('');
      const ready = validPremiumIds.slice(6, 11).map(emojiTag).join('');
      const kids = validPremiumIds.slice(11).map(emojiTag).join('');
      // Use a combination of spaces and thin space for better visibility
      const spacer = '     '; // 5 regular spaces
      headerText = are + spacer + you + '\n' + ready + spacer + kids;
    } else {
      headerText = '🎯 <b>Bingo Game Started!</b>';
    }
    
    const potEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.pot}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.pot}">⭐</tg-emoji>` : '💰');
    const playersEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.players[Math.floor(Math.random() * THEME_EMOJIS.frozen.players.length)]}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.players}">⭐</tg-emoji>` : '👥');
    
    let playersList = isFree
      ? [
          headerText.endsWith('Free Play') ? headerText : `${headerText} — 🎮 Free Play`,
          "",
          `<b>${playersEmoji} Players Joined: ${playersWithBBS.length}</b>`,
          ...playersWithBBS.sort((a, b) => {
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
          }).map((player, index) => formatPlayerWithIndicators(player, index, sessionBet)),
          "",
          "<b>Use /bingoforce to start the game</b>",
        ].join("\n")
      : [
      headerText,
      "",
      `<b>${potEmoji} Pot: ₱${Number(playersWithBBS.length * sessionBet).toLocaleString()}</b>`,
      "",
      `<b>${playersEmoji} Players Joined: ${playersWithBBS.length}</b>`,
      ...playersWithBBS.sort((a, b) => {
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
      }).map((player, index) => formatPlayerWithIndicators(player, index, sessionBet)),
      "",
      "<b>Use /bingoforce to start the game</b>",
    ].join("\n");
    
    const messageKey = `${groupId}_${session.id}`;
    const messageInfo = playerListMessages.get(messageKey);
    
    // Try to get message info from in-memory map first
    let messageId = messageInfo ? messageInfo.message_id : null;
    let messageChat = messageInfo ? messageInfo.chat_id : groupId;
    
    // If not found in memory, try to get from database
    if (!messageId) {
      try {
        const sessionInfo = await bingoGameSession.findById(session.id);
        if (sessionInfo?.player_list_message_id && sessionInfo?.player_list_chat_id) {
          messageId = sessionInfo.player_list_message_id;
          messageChat = sessionInfo.player_list_chat_id;
          console.log(`[join] Player list message loaded | session=${session.id} message=${messageId} chat=${messageChat}`);
        }
      } catch (dbError) {
        console.error(`[join] Player list message lookup failed | session=${session.id}`, dbError);
      }
    }

    if (messageId) {
      // Silent join - no confirmation message
      // await ctx.reply(`✅ ${displayName} has joined! (${playerCount} player${playerCount !== 1 ? "s" : ""})`);
      
      // Get theme for custom emoji support - use group config instead of gameStateService
      const groupConfig = await groupConfigService.getGroupConfig(groupId);
      const themeId = groupConfig?.theme_id || (gameStateService ? gameStateService.getTheme(groupId) : null);
      const joinButtonText = (THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].joinButtonText) 
        ? THEME_EMOJIS[themeId].joinButtonText 
        : "🎮 Join Game";

      
      // Helper function to retry on rate limit errors
      const editWithRetry = async (maxRetries = 3) => {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            // Use editMessageCaption for media messages, editMessageText for text-only
            const richMessage = buildJoinRichMessage(
              playersList,
              messageInfo.gif_url,
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
            return; // Success, exit retry loop
          } catch (error) {
            if (error.error_code === 429 && error.parameters?.retry_after) {
              const retryAfter = error.parameters.retry_after;
              console.warn(`[join] Player list rate limited | retryAfter=${retryAfter}s attempt=${attempt + 1}/${maxRetries}`);
              if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                continue;
              }
            }
            throw error; // Re-throw if not rate limit or max retries exceeded
          }
        }
      };
      
      editWithRetry().catch((error) => {
        console.error(`[join] Player list update failed | group=${groupId} session=${session.id}`, error);
      });
      return;
    }

    await ctx.reply(
      playersList,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    console.error(`[join] Command failed | group=${ctx.chat?.id} user=${ctx.from?.id}`, error);
    await ctx.reply("❌ Error joining game. Please try again.");
    
  }
}

module.exports = { handleJoin, isValidChannelMembershipStatus };
