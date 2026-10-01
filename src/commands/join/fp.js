/**
 * Join FP command - allows players to join with Free Pass (FP)
 * Usage: /join FP
 */

const { THEME_EMOJIS } = require("../../constants/themeEmojis");
const { playerListMessages, getPremiumStatus } = require("../bingo/sharedState");
const { formatPlayerWithIndicators } = require("../../utils/playerUtils");
const { buildJoinRichMessage, buildJoinPlainMessage } = require("../bingo/helpers");

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

const JOIN_SUCCESS_EMOJIS = ["🧁", "🎉", "✨", "🎊", "🥳", "🌟", "🎈", "🎁", "🏆", "👏"];

function getRandomJoinSuccessEmoji() {
  return JOIN_SUCCESS_EMOJIS[Math.floor(Math.random() * JOIN_SUCCESS_EMOJIS.length)];
}

function getRandomNoActiveSessionReply() {
  return NO_ACTIVE_SESSION_REPLIES[Math.floor(Math.random() * NO_ACTIVE_SESSION_REPLIES.length)];
}

async function handleJoinFP(ctx, bingoGameSession, bingoGamePlayer, user, gameStateService, groupConfigService) {
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

    // Check if session is already active (game started drawing items)
    if (session.status === "active") {
      await ctx.reply(
        "❌ The game has already started. Free Pass can only be used before the game starts."
      );
      return;
    }

    // Check if user has Free Pass (FP)
    const existingUser = await user.findByTelegramId(userId);
    if (!existingUser) {
      await ctx.reply("❌ User not found. Please try /start first.");
      return;
    }

    const userBacCards = existingUser?.bac_cards || [];
    const hasFP = userBacCards.includes('FP');
    
    if (!hasFP) {
      await ctx.reply(
        "❌ You don't have a Free Pass (FP) card."
      );
      return;
    }

    // Check if bet is exactly 20
    const sessionBet = Number(session.bet_per_player || 5);
    if (sessionBet !== 20) {
      await ctx.reply(
        `❌ Free Pass can only be used for games with ₱20 bet. Current bet is ₱${sessionBet}.`
      );
      return;
    }

    // Check if game is sponsored or free play
    const isSponsored = session.is_sponsored === true;
    if (isSponsored) {
      await ctx.reply(
        "❌ Free Pass cannot be used in sponsored games."
      );
      return;
    }

    const { isFreePlaySession } = require("../../utils/playerUtils");
    if (isFreePlaySession(session)) {
      await ctx.reply(
        "❌ Free Pass cannot be used in free play games."
      );
      return;
    }

    // Check if user is already in the session
    const alreadyJoined = await bingoGamePlayer.isPlayerInSession(
      session.id,
      userId
    );
    if (alreadyJoined) {
      await ctx.reply(
        "⚠️ You have already joined this game session.",
        {
          reply_to_message_id: ctx.message?.message_id,
        }
      );
      return;
    }

    // Update user profile
    const profilePhoto = await user.getProfilePhotoData(ctx.api, userId);
    await user.createOrUpdate({
      telegramId: userId,
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
      profilePhotoUrl: profilePhoto.profilePhotoUrl,
      profilePhotoFileId: profilePhoto.profilePhotoFileId,
    });

    // Check admin funds for FP deduction (₱20)
    const adminFunds = await groupConfigService.getAdminFunds(groupId);
    if (adminFunds < 20) {
      await ctx.reply(
        "❌ Insufficient admin funds for Free Pass join. Admin needs at least ₱20.",
        {
          reply_to_message_id: ctx.message?.message_id,
        }
      );
      return;
    }

    // Add player to session with FP flag
    await bingoGamePlayer.addPlayer(session.id, userId, false, true);

    // Deduct ₱20 from admin funds
    try {
      await groupConfigService.updateAdminFunds(groupId, -20);
      console.log(`[join-fp] FP admin funds deducted | group=${groupId} amount=20 user=${userId}`);
    } catch (error) {
      console.error(`[join-fp] FP admin funds deduction failed | group=${groupId} user=${userId}`, error);
    }

    // Remove FP from user's inventory
    try {
      await user.removeBacCard(userId, 'FP');
      console.log(`[join-fp] FP consumed | user=${userId}`);
    } catch (error) {
      console.error(`[join-fp] FP removal failed | user=${userId}`, error);
    }

    // Get updated player count and list
    const players = await bingoGamePlayer.getPlayersBySession(session.id);
    const playersWithIndicators = await Promise.all(players.map(async (player) => ({
      ...player,
      has_bbs: await user.isBacActivated(player.user_id, 'BBS'),
      has_mcp: (await user.getBacCardQuantity(player.user_id, 'MCP')) > 0,
    })));
    const playerCount = players.length;
    console.log(`[join-fp] Player joined | group=${groupId} session=${session.id} user=${userId} players=${playerCount}`);

    const rawFirstName = String(ctx.from.first_name || "").trim();
    const rawUsername = String(ctx.from.username || "").trim();
    const displayName =
      rawFirstName ||
      (rawUsername ? `@${rawUsername}` : "Player");

    // Send join success message
    await ctx.reply(
      `${getRandomJoinSuccessEmoji()} ${displayName}, joined with Free Pass!`,
      {
        reply_to_message_id: ctx.message?.message_id,
      }
    );

    // Format players list with hyperlinks and bet amount
    const groupConfig = await groupConfigService.getGroupConfig(groupId);
    const themeId = groupConfig?.theme_id || (gameStateService ? gameStateService.getTheme(groupId) : null);
    const isFrozen = themeId === "frozen";
    const isSpongeBob = themeId === "spongebob";
    
    const usePremiumEmoji = await getPremiumStatus();
    
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
      const are = validPremiumIds.slice(0, 3).map(emojiTag).join('');
      const you = validPremiumIds.slice(3, 6).map(emojiTag).join('');
      const ready = validPremiumIds.slice(6, 11).map(emojiTag).join('');
      const kids = validPremiumIds.slice(11).map(emojiTag).join('');
      const spacer = '     ';
      headerText = are + spacer + you + '\n' + ready + spacer + kids;
    } else {
      headerText = '🎯 <b>Bingo Game Started!</b>';
    }
    
    const potEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.pot}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.pot}">⭐</tg-emoji>` : '💰');
    const playersEmoji = (usePremiumEmoji && isFrozen) ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.players[Math.floor(Math.random() * THEME_EMOJIS.frozen.players.length)]}">⭐</tg-emoji>` : ((usePremiumEmoji && isSpongeBob) ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.players}">⭐</tg-emoji>` : '👥');
    
    let playersList = [
      headerText,
      "",
      `<b>${potEmoji} Pot: ₱${Number(players.length * sessionBet).toLocaleString()}</b>`,
      "",
      `${playersEmoji} Players Joined:`,
      ...playersWithIndicators.sort((a, b) => {
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
    
    let messageId = messageInfo ? messageInfo.message_id : null;
    let messageChat = messageInfo ? messageInfo.chat_id : groupId;
    
    if (!messageId) {
      try {
        const sessionInfo = await bingoGameSession.findById(session.id);
        if (sessionInfo?.player_list_message_id && sessionInfo?.player_list_chat_id) {
          messageId = sessionInfo.player_list_message_id;
          messageChat = sessionInfo.player_list_chat_id;
          console.log(`[join-fp] Player list message loaded | session=${session.id} message=${messageId} chat=${messageChat}`);
        }
      } catch (dbError) {
        console.error(`[join-fp] Player list message lookup failed | session=${session.id}`, dbError);
      }
    }

    if (messageId) {
      const groupConfig = await groupConfigService.getGroupConfig(groupId);
      const themeId = groupConfig?.theme_id || (gameStateService ? gameStateService.getTheme(groupId) : null);
      const joinButtonText = (THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].joinButtonText)
        ? THEME_EMOJIS[themeId].joinButtonText
        : "🎮 Join Game";

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
            return;
          } catch (error) {
            if (error.error_code === 429 && error.parameters?.retry_after) {
              const retryAfter = error.parameters.retry_after;
              console.warn(`[join-fp] Player list rate limited | retryAfter=${retryAfter}s attempt=${attempt + 1}/${maxRetries}`);
              if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                continue;
              }
            }
            throw error;
          }
        }
      };

      editWithRetry().catch((error) => {
        console.error(`[join-fp] Player list update failed | group=${groupId} session=${session.id}`, error);
      });
      return;
    }

    await ctx.reply(
      playersList,
      { parse_mode: "HTML" }
    );
  } catch (error) {
    console.error(`[join-fp] Command failed | group=${ctx.chat?.id} user=${ctx.from?.id}`, error);
    await ctx.reply("❌ Error joining game with Free Pass. Please try again.");
  }
}

module.exports = { handleJoinFP };
