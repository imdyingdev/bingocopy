/**
 * Bingo Flee command: /bingoflee - allows players to leave a waiting game session
 */

const { playerListMessages } = require("../bingo/sharedState");
const { THEME_EMOJIS } = require("../../constants/themeEmojis");
const { buildJoinRichMessage, buildJoinPlainMessage } = require("../bingo/helpers");
const { isFreePlaySession } = require("../../utils/playerUtils");

async function handleBingoFlee(ctx, bingoGameSession, bingoGamePlayer, gameStateService, groupConfigService, userModel) {
  // Only work in groups
  if (ctx.chat.type === "private") {
    await ctx.reply("🚫 This command can only be used in groups.");
    return;
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from.id;

  try {
    // Find active/waiting session for this group
    const session = await bingoGameSession.findByGroupId(groupId);
    if (!session) {
      await ctx.reply("❌ No active bingo game session in this group.");
      return;
    }

    // Determine if the session is active (game in progress)
    const inGame = session.status === "active";

    // Check if user is actually in the session
    const isPlayer = await bingoGamePlayer.isPlayerInSession(session.id, userId);
    if (!isPlayer) {
      await ctx.reply("⚠️ You are not part of this game session.");
      return;
    }

    // Prevent the starter from fleeing (they started the game)
    if (String(session.starter_id) === String(userId)) {
      await ctx.reply("❌ You started the game and cannot flee. Ask an admin to cancel the game if needed.");
      return;
    }

    // Remove player from session only if the game hasn't started yet
    if (!inGame) {
      await bingoGamePlayer.removePlayer(session.id, userId);
      if (userModel && await userModel.isBacActivated(userId, 'DPC')) {
        await userModel.deactivateBac(userId, 'DPC');
      }
      console.log(`[flee] User ${userId} fled from session ${session.id}`);
    } else {
      console.log(`[flee] User ${userId} attempted to flee during active session ${session.id}; not removed.`);
    }

    // Get updated player list
    const players = await bingoGamePlayer.getPlayersBySession(session.id);
    const playerCount = players.length;
    const betPerPlayer = Number(session.bet_per_player || 5);
    const isSponsored = session.is_sponsored === true;
    const isFree = isFreePlaySession(session);

    const rawFirstName = String(ctx.from.first_name || "").trim();
    const rawUsername = String(ctx.from.username || "").trim();
    const displayName = rawFirstName || (rawUsername ? `@${rawUsername}` : "Player");

    // Build updated players list
    let playersList;
    
    // Get theme for custom emoji support - use group config instead of gameStateService
    const groupConfig = await groupConfigService.getGroupConfig(groupId);
    const themeId = groupConfig?.theme_id || (gameStateService ? gameStateService.getTheme(groupId) : null);
    const isFrozen = themeId === "frozen";
    const isSpongeBob = themeId === "spongebob";
    console.log(`[bingoflee] Theme check: group=${groupId}, groupConfigThemeId=${groupConfig?.theme_id}, gameStateThemeId=${gameStateService ? gameStateService.getTheme(groupId) : null}, finalThemeId=${themeId}, isFrozen=${isFrozen}, isSpongeBob=${isSpongeBob}`);
    
    if (isSponsored) {
      const sponsorNameUpper = String(session.sponsor_name || "Sponsor").toUpperCase();
      const sponsorNameSanitized = String(session.sponsor_name || "Sponsor").replace(/[<>]/g, "");
      const sponsorHyperlink = `<a href="tg://user?id=${session.sponsor_id}"><b>${sponsorNameUpper}</b></a>`;
      
      let headerText;
      if (isFrozen) {
        // Build "FROZEN BINGO!" header with custom emojis
        const premiumIds = THEME_EMOJIS.frozen.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
        const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
        const spacer = '\u00A0'.repeat(5);
        headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
      } else if (isSpongeBob) {
        // SpongeBob: "ARE YOU" on first line, "READY KIDS?" on second line with 5 spaces between words
        const premiumIds = THEME_EMOJIS.spongebob.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        const are = validPremiumIds.slice(0, 3).map(emojiTag).join('');
        const you = validPremiumIds.slice(3, 6).map(emojiTag).join('');
        const ready = validPremiumIds.slice(6, 11).map(emojiTag).join('');
        const kids = validPremiumIds.slice(11).map(emojiTag).join('');
        const spacer = '     '; // 5 regular spaces
        headerText = are + spacer + you + '\n' + ready + spacer + kids;
      } else {
        headerText = '🎯 <b>Bingo Game Started!</b>';
      }
      
      const potEmoji = isFrozen ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.pot}">⭐</tg-emoji>` : (isSpongeBob ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.pot}">⭐</tg-emoji>` : '💰');
      const playersEmoji = isFrozen ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.players[Math.floor(Math.random() * THEME_EMOJIS.frozen.players.length)]}">⭐</tg-emoji>` : (isSpongeBob ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.players}">⭐</tg-emoji>` : '👥');
      
      playersList = [
        headerText,
        "",
        `— SPONSORED BY ${sponsorHyperlink}`,
        "",
        `<b>${potEmoji} Pot: ₱${Number(session.sponsor_amount).toLocaleString()}</b>`,
        "",
        `${playersEmoji} Players Joined:`,
        ...(players.length
          ? players.sort((a, b) => {
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
            }).map((player, index) => {
              const rawPlayerFirstName = String(player.first_name || "").trim();
              const rawPlayerLastName = String(player.last_name || "").trim();
              const rawPlayerUsername = String(player.username || "").trim();
              const fullName = [rawPlayerFirstName, rawPlayerLastName].filter(Boolean).join(" ");
              const name = fullName || rawPlayerUsername || "Player";
              const sanitizedName = name.replace(/[<>]/g, "");
              const hyperlink = `<a href="tg://user?id=${player.user_id}"><b>${sanitizedName}</b></a>`;
              
              // Add alarm emoji if player used Late Entry Pass
              const lepIndicator = player.used_lep ? " ⏰" : "";
              
              return `${index + 1}. ${hyperlink}${lepIndicator}`;
            })
          : ["No players have joined yet. Press the button below to join the game."]
        ),
        "",
        "<b>Use /bingoforce to start the game</b>",
      ].join("\n");
    } else {
      let headerText;
      if (isFrozen) {
        // Build "FROZEN BINGO!" header with custom emojis
        const premiumIds = THEME_EMOJIS.frozen.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
        const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
        const spacer = '\u00A0'.repeat(5);
        headerText = firstGroup + (secondGroup ? spacer + secondGroup : '');
      } else if (isSpongeBob) {
        // SpongeBob: "ARE YOU" on first line, "READY KIDS?" on second line with 5 spaces between words
        const premiumIds = THEME_EMOJIS.spongebob.header;
        const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
        const placeholderEmoji = '⭐';
        const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
        const are = validPremiumIds.slice(0, 3).map(emojiTag).join('');
        const you = validPremiumIds.slice(3, 6).map(emojiTag).join('');
        const ready = validPremiumIds.slice(6, 11).map(emojiTag).join('');
        const kids = validPremiumIds.slice(11).map(emojiTag).join('');
        const spacer = '     '; // 5 regular spaces
        headerText = are + spacer + you + '\n' + ready + spacer + kids;
      } else {
        headerText = '🎯 <b>Bingo Game Started!</b>';
      }
      
      const potEmoji = isFrozen ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.pot}">⭐</tg-emoji>` : (isSpongeBob ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.pot}">⭐</tg-emoji>` : '💰');
      const playersEmoji = isFrozen ? `<tg-emoji emoji-id="${THEME_EMOJIS.frozen.players[Math.floor(Math.random() * THEME_EMOJIS.frozen.players.length)]}">⭐</tg-emoji>` : (isSpongeBob ? `<tg-emoji emoji-id="${THEME_EMOJIS.spongebob.players}">⭐</tg-emoji>` : '👥');
      
      playersList = [
        isFree
          ? (headerText.endsWith('Free Play') ? headerText : `${headerText} — 🎮 Free Play`)
          : headerText,
        "",
        ...(isFree
          ? []
          : [`<b>${potEmoji} Pot: ₱${Number(players.length * betPerPlayer).toLocaleString()}</b>`, ""]),
        `${playersEmoji} Players Joined:`,
        ...(players.length
          ? players.sort((a, b) => {
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
            }).map((player, index) => {
              const rawPlayerFirstName = String(player.first_name || "").trim();
              const rawPlayerUsername = String(player.username || "").trim();
              const name = rawPlayerFirstName || rawPlayerUsername || "Player";
              const sanitizedName = name.replace(/[<>]/g, "");
              const hyperlink = `<a href="tg://user?id=${player.user_id}"><b>${sanitizedName}</b></a>`;
              
              // Add alarm emoji if player used Late Entry Pass
              const lepIndicator = player.used_lep ? " ⏰" : "";
              
              return `${index + 1}. ${hyperlink}${lepIndicator}${isFree ? "" : ` - ₱${betPerPlayer}`}`;
            })
          : ["No players have joined yet. Press the button below to join the game."]
        ),
        "",
        "<b>Use /bingoforce to start the game</b>",
      ].join("\n");
    }

    // Update the join card message if it exists and if we actually removed the player
    if (!inGame) {
      const messageKey = `${groupId}_${session.id}`;
      const messageInfo = playerListMessages.get(messageKey);
      if (messageInfo && messageInfo.message_id) {
        try {
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
                const { getPremiumStatus } = require("../bingo/sharedState");
                const usePremiumEmoji = await getPremiumStatus();
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
                  chat_id: messageInfo.chat_id,
                  message_id: messageInfo.message_id,
                  rich_message: { html: richMessage.html }
                });
                console.log(`[flee] Updated player list message ${messageInfo.message_id} after flee`);
                return; // Success, exit retry loop
              } catch (error) {
                if (error.error_code === 429 && error.parameters?.retry_after) {
                  const retryAfter = error.parameters.retry_after;
                  console.warn(`[flee] Rate limited, retrying after ${retryAfter}s (attempt ${attempt + 1}/${maxRetries})`);
                  if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    continue;
                  }
                }
                throw error; // Re-throw if not rate limited or max retries exceeded
              }
            }
          };
          
          await editWithRetry();
        } catch (error) {
          console.error("[flee] Error updating player list message:", error);
        }
      }
    }

    // Prank penalty messages (randomized) — no real funds change, just for fun
    const prankMessages = [
      'Penalty: -5 funds for leaving the game.',
      'You lost -5 funds for fleeing.',
      'Admin note: -5 funds applied for leaving mid-game.',
      'You were penalized -5 funds for fleeing.',
      'Penalty notice: -5 funds.',
      'You cannot play in the next game.',
      'You have been banned from the next game.',
      'Next game access denied.',
      'You are suspended from the next game.',
      'Game ban applied: 1 game.',
      'Penalty: -10 funds for fleeing.',
      'Penalty: -20 funds for abandoning the game.',
      'Fleeing penalty: -10 funds.',
      'Admin penalty: -20 funds deducted.',
      'You escaped the game, but lost -10 funds.',
      'Your fund has been charged -20.',
      'Flee detected. Penalty: -10 funds + next game ban.',
      'Leaving mid-game: -20 funds.',
      'You have been sentenced to a 1-game ban.',
      'Congratulations! You unlocked a -20 fund penalty.'
    ];

    if (inGame) {
      const rand = Math.floor(Math.random() * prankMessages.length);
      const prank = prankMessages[rand];

      await ctx.reply(
        `🏃 <b>${displayName}</b> attempted to flee during the game!\n\nCurrent players: <b>${playerCount}</b>\n\n<i>${prank}</i>`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message && ctx.message.message_id }
      );
    } else {
      await ctx.reply(
        `🏃 <b>${displayName}</b> has left the lobby.\n\nRemaining players: <b>${playerCount}</b>`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message && ctx.message.message_id }
      );
    }
  } catch (error) {
    console.error("Error in /bingoflee:", error);
    await ctx.reply("❌ Error leaving the game. Please try again.");
  }
}

module.exports = { handleBingoFlee };