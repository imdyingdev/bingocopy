/**
 * Bingo Start command: /bingostart
 */

const { InputFile } = require("grammy");
const path = require("path");
const fs = require("fs");
const { extractThemeFromPattern } = require("../../utils/helpers");
const { THEME_EMOJIS } = require("../../constants/themeEmojis");
const { playerListMessages, BOT_OWNER_ID, getPremiumStatus, setPremiumStatus, isPremiumCacheExpired } = require("./sharedState");
const { testPremiumEmojiStatus, buildRichMessage, buildPlainMessage, buildJoinRichMessage, buildJoinPlainMessage } = require("./helpers");

async function handleBingoStart(ctx, gameStateService, groupConfigService, gameLogger, imageGenerationService, bingoFundsService, bingoGameSession, userModel, bingoGamePlayer) {
  try {
    console.log("=== /bingostart called ===");
    console.log("Chat ID:", ctx.chat.id);
    console.log("Chat Type:", ctx.chat.type);
    console.log("User ID:", ctx.from.id);

    if (ctx.chat.type === "private") {
      console.log("Rejected: Private chat");
      await ctx.reply(
        "🚫 This command can only be used in groups, not in private messages.",
      );
      return;
    }

    const chatId = ctx.chat.id;
    const userId = ctx.from.id;

    const isGroupSetupConfirmed = await groupConfigService.isCommandAllowedInGroup(chatId, []);
    if (!isGroupSetupConfirmed) {
      return;
    }

    const isAnonymousAdmin = !!ctx.message?.sender_chat ||
      String(ctx.from.username || "").toLowerCase().includes("groupanonymous") ||
      String(ctx.from.first_name || "").toLowerCase() === "group";

    const rawStarterName = String(ctx.from.first_name || "").trim() ||
      (String(ctx.from.username || "").trim() ? `@${String(ctx.from.username || "").trim()}` : "Player");
    const starterDisplayName = isAnonymousAdmin ? "Starter" : rawStarterName;

    const shouldAutoAddStarter = !isAnonymousAdmin;

    const isFundsOnly = await bingoFundsService.isFundsOnlyGroup(chatId);
    console.log(`Group ${chatId} isFundsOnly: ${isFundsOnly}`);

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

    console.log("Getting group config for:", chatId);

    const existingGame = gameStateService.getBingoGame(chatId);
    if (existingGame) {
      console.log("Game already exists - rejecting");
      await ctx.reply(
        "❌ <b>Game already in progress!</b>\n\n" +
          "A bingo game is already active in this group. Use /bingostop to end the current game first.",
        { parse_mode: "HTML" },
      );
      return;
    }

    let groupConfig = await groupConfigService.getGroupConfig(chatId);

    // Backfill admin if not anonymous
    if (!isAnonymousAdmin) {
      try {
        const shouldBackfillAdmin = !groupConfig || !groupConfig.admin_id || String(groupConfig.admin_id) !== String(userId);
        if (shouldBackfillAdmin) {
          await groupConfigService.createGroupConfig(chatId, userId);
          groupConfig = await groupConfigService.getGroupConfig(chatId);
        }
      } catch (configError) {
        console.error("Failed to backfill group admin for /bingostart:", configError);
      }
    }

    if (groupConfig) {
      const groupTitle = ctx.chat.title;
      if (groupTitle) {
        await groupConfigService.updateGroupName(chatId, groupTitle);
      }
    }
    console.log("Group config found:", !!groupConfig);
    console.log("Pattern found:", !!groupConfig?.pattern);
    console.log("Full group config:", JSON.stringify(groupConfig, null, 2));

    if (!groupConfig || !groupConfig.pattern) {
      console.log("No pattern configured - rejecting");
      await ctx.reply(
        "❌ <b>No pattern configured!</b>\n\n" +
          "Please configure a pattern first using /bingoset followed by /bingopattern in private chat.",
        { parse_mode: "HTML" },
      );
      return;
    }

    // Create or update user in database and persist profile photo metadata
    if (!isAnonymousAdmin) {
      try {
        const profilePhoto = await userModel.getProfilePhotoData(ctx.api, userId);
        await userModel.createOrUpdate({
          telegramId: userId,
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          profilePhotoUrl: profilePhoto.profilePhotoUrl,
          profilePhotoFileId: profilePhoto.profilePhotoFileId,
        });
        console.log("User created/updated in database with profile photo metadata");
      } catch (error) {
        console.error("Error creating/updating user:", error);
      }
    } else {
      console.log("Anonymous admin detected; skipping user creation/update for starter.");
    }

    // Determine bet amount from command text: /bingostart <bet>
    // Or parse sponsor command: /bingostart sponsor, pondo/cash, amount, patterns
    // Or free play: /bingostart free
    // Or raid play: /bingostart raid
    let betPerPlayer = 5;
    let isSponsored = false;
    let isFree = false;
    let isRaid = false;
    let sponsorId = null;
    let sponsorName = null;
    let sponsorAmount = null;
    let sponsorFundingType = null;

    const startText = String(ctx.message?.text || "").trim();

    const freeMatch = startText.match(/^\/bingostart(?:@[\w_]+)?\s+free\s*$/i);
    const raidMatch = startText.match(/^\/bingostart(?:@[\w_]+)?\s+raid\s*$/i);
    // Check for sponsor format: /bingostart sponsor, pondo/cash, amount, patterns, [sponsor_name_or_id]
    const sponsorMatch = startText.match(/^\/bingostart(?:@[\w_]+)?\s+sponsor\s*,\s*(pondo|cash)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*(.+))?/i);
    if (freeMatch) {
      isFree = true;
      betPerPlayer = 0;
      console.log("Free play command detected: no funds, no winners, no pattern selection");
    } else if (raidMatch) {
      isRaid = true;
      isFree = true;
      betPerPlayer = 0;
      console.log("Raid play command detected: no funds, no winners, no pattern selection, using raid video");
    } else if (sponsorMatch) {
      isSponsored = true;
      sponsorFundingType = sponsorMatch[1].toLowerCase(); // 'pondo' or 'cash'
      sponsorAmount = parseInt(sponsorMatch[2], 10); // e.g., 100
      const patterns = parseInt(sponsorMatch[3], 10); // e.g., 1
      const optionalSponsor = sponsorMatch[4] ? sponsorMatch[4].trim() : null; // Optional sponsor name or ID
      
      // If sponsor parameter is provided, try to resolve it
      if (optionalSponsor) {
        // Check if it's a numeric user ID
        const numericId = parseInt(optionalSponsor, 10);
        if (!isNaN(numericId)) {
          sponsorId = numericId;
          try {
            const sponsorUser = await userModel.findByTelegramId(sponsorId);
            if (sponsorUser) {
              sponsorName = String(sponsorUser.first_name || "").trim() ||
                (String(sponsorUser.username || "").trim() ? `@${String(sponsorUser.username || "").trim()}` : "Sponsor");
            } else {
              sponsorName = "Sponsor";
            }
          } catch (error) {
            console.error("Error resolving sponsor by ID:", error);
            sponsorName = "Sponsor";
          }
        } else {
          // Assume it's a username (with or without @)
          const username = optionalSponsor.startsWith('@') ? optionalSponsor.slice(1) : optionalSponsor;
          try {
            const sponsorUser = await userModel.findByUsername(username);
            if (sponsorUser) {
              sponsorId = sponsorUser.telegram_id;
              sponsorName = String(sponsorUser.first_name || "").trim() ||
                (String(sponsorUser.username || "").trim() ? `@${String(sponsorUser.username || "").trim()}` : "Sponsor");
            } else {
              // If user not found, default to command sender
              sponsorId = userId;
              sponsorName = String(ctx.from.first_name || "").trim() ||
                (String(ctx.from.username || "").trim() ? `@${String(ctx.from.username || "").trim()}` : "Sponsor");
            }
          } catch (error) {
            console.error("Error resolving sponsor by username:", error);
            sponsorId = userId;
            sponsorName = String(ctx.from.first_name || "").trim() ||
              (String(ctx.from.username || "").trim() ? `@${String(ctx.from.username || "").trim()}` : "Sponsor");
          }
        }
      } else {
        // Default to command sender
        const rawSponsorName = String(ctx.from.first_name || "").trim() ||
          (String(ctx.from.username || "").trim() ? `@${String(ctx.from.username || "").trim()}` : "Sponsor");
        sponsorId = userId;
        sponsorName = rawSponsorName;
      }
      betPerPlayer = 0; // Free join for sponsored games
      
      console.log(`Sponsor command detected: funding=${sponsorFundingType}, amount=${sponsorAmount}, patterns=${patterns}, sponsorId=${sponsorId}, sponsorName=${sponsorName}`);

      // For pondo sponsors, check they have sufficient funds
      if (sponsorFundingType === "pondo") {
        try {
          const sponsorUser = await userModel.findByTelegramId(userId);
          const sponsorFunds = Number(sponsorUser?.funds ?? 0);
          if (sponsorFunds < sponsorAmount) {
            await ctx.reply(
              `❌ Insufficient funds to sponsor pondo game!\n\n` +
              `Required: ₱${sponsorAmount}\n` +
              `Available: ₱${sponsorFunds}`,
              { parse_mode: "HTML" },
            );
            return;
          }
          console.log(`✅ Sponsor ${userId} verified with ₱${sponsorFunds} (needs ₱${sponsorAmount})`);
        } catch (error) {
          console.error("Error checking sponsor funds:", error);
          await ctx.reply("❌ Error verifying sponsor funds. Please try again.");
          return;
        }
      }
    } else {
      // Regular bet parsing: /bingostart <bet>
      const startMatch = startText.match(/^\/bingostart(?:@[\w_]+)?(?:\s+(\d+))?/i);
      if (startMatch && startMatch[1]) {
        const parsedBet = parseInt(startMatch[1], 10);
        if (Number.isFinite(parsedBet) && parsedBet >= 1) {
          betPerPlayer = parsedBet;
        }
      }
    }

    // Create game session in database
    let sessionId = null;
    try {
      let session;
      if (isFree) {
        session = await bingoGameSession.createFree(
          chatId,
          userId,
          groupConfig.pattern,
          userId,
          isRaid
        );
      } else if (isSponsored) {
        session = await bingoGameSession.createSponsored(
          chatId,
          userId,
          groupConfig.pattern,
          sponsorId,
          sponsorName,
          sponsorAmount,
          sponsorFundingType,
          userId
        );
      } else {
        session = await bingoGameSession.create(
          chatId,
          userId,
          groupConfig.pattern,
          betPerPlayer,
          userId
        );
      }
      sessionId = session.id;
      console.log("Game session created with ID:", sessionId);

      if (shouldAutoAddStarter) {
        const starterHasDPC = isFree ? false : await userModel.isBacActivated(userId, 'DPC');
        await bingoGamePlayer.addPlayer(session.id, userId, false, false, starterHasDPC);
        console.log("Starter added to session players:", session.id);
      } else {
        console.log("Anonymous starter detected; skipping auto-add to session players.");
      }
    } catch (error) {
      console.error("Error creating game session:", error);
    }

    console.log("Creating bingo card with pattern...");
    const game = {
      selected: new Set(),
      card: gameStateService.generateBingoCard(groupConfig.pattern, groupConfig.pattern_order),
      round: 1,
      drawOrder: [],
      sessionId: sessionId, // Store session ID for later reference
      startedAt: Date.now(),
      isFree,
      isRaid,
    };
    gameStateService.setBingoGame(chatId, game);
    console.log("Bingo game created successfully");

    try {
      await gameLogger.logGameStart(ctx, game);
    } catch (error) {
      console.error("Failed to log game start:", error);
    }

    // Get theme from new theme system (checks both themes map and legacy spongebob mode)
    const themeId = gameStateService.getTheme(chatId);
    console.log(`[bingostart] Theme check: chatId=${chatId}, themeId=${themeId}`);
    let theme;
    if (themeId === "spongebob") {
      theme = "spongebob squarepants";
    } else if (themeId === "onepiece") {
      theme = "one piece";
    } else if (themeId === "toy_story") {
      theme = "toy story";
    } else if (themeId === "frozen") {
      theme = "frozen";
    } else if (themeId === "minions") {
      theme = "minions";
    } else if (themeId === "lovers_soiree") {
      theme = "red aesthetic";
    } else if (themeId === "bingulo_beta") {
      theme = "mix";
    } else {
      theme = extractThemeFromPattern(
        groupConfig.pattern,
        groupConfig.pattern_order,
      );
    }
    console.log("Searching Giphy for theme:", theme);
    let gifUrl = await imageGenerationService.searchGiphy(theme);
    console.log("GIF URL:", gifUrl);

    // Get audio URL for theme (not for raid mode)
    let audioUrl = null;
    if (themeId === "toy_story" && !isRaid) {
      audioUrl = "https://56676gy9ro.ufs.sh/f/DtvupcCWPBzZ5i489KvAcjdSC4qw0WNkOh6ZGi5vYmQ2rFJ3";
    }
    console.log("Audio URL:", audioUrl);

    // Build players list from DB so display names come from persisted user records
    let playersText = isRaid
      ? "" // Header will be added in rich message builder
      : isFree
      ? "🎯 <b>Bingo Game Started! — 🎮 Free Play</b>\n\n"
      : "🎯 <b>Bingo Game Started!</b>\n\n";
    let initialPlayers = [];
    try {
      initialPlayers = await bingoGamePlayer.getPlayersBySession(sessionId, themeId);
      initialPlayers = await Promise.all(initialPlayers.map(async (player) => ({
        ...player,
        has_mcp: (await userModel.getBacCardQuantity(player.user_id, 'MCP')) > 0,
      })));
      
      if (isRaid || isFree) {
        playersText += `<b>👥 Players Joined: ${initialPlayers.length}</b>\n`;

        if (initialPlayers && initialPlayers.length) {
          playersText += initialPlayers.map((player) => {
            const rawPlayerFirstName = String(player.first_name || "").trim();
            const rawPlayerLastName = String(player.last_name || "").trim();
            const rawPlayerUsername = String(player.username || "").trim();

            let name;
            let userIdForLink = player.user_id;
            if (String(player.user_id) === String(userId)) {
              name = starterDisplayName;
              userIdForLink = ctx.from.id;
            } else {
              const fullName = [rawPlayerFirstName, rawPlayerLastName].filter(Boolean).join(" ");
              name = fullName || rawPlayerUsername || "Player";
            }

            const sanitizedName = name.replace(/[<>]/g, "");
            const hyperlink = `<a href="tg://user?id=${userIdForLink}"><b>${sanitizedName}</b></a>`;
            const cardIndicator = player.card_link
              ? ` <a href="${player.card_link}">${Math.random() < 0.5 ? "📓" : "📔"}</a>`
              : "";

            return `${cardIndicator}${hyperlink}`;
          }).join("\n");
        } else {
          playersText += "No players have joined yet. Press the button below to join the game.";
        }
      } else if (isSponsored) {
        // Sponsored game format
        const sponsorNameUpper = sponsorName.toUpperCase();
        const sponsorNameSanitized = sponsorName.replace(/[<>]/g, "");
        const sponsorHyperlink = `<a href="tg://user?id=${sponsorId}"><b>${sponsorNameUpper}</b></a>`;
        playersText += `— SPONSORED BY ${sponsorHyperlink}\n\n`;
        playersText += `<b>💰 Pot: ₱${Number(sponsorAmount).toLocaleString()}</b>\n\n`;
        playersText += `<b>👥 Players Joined: ${initialPlayers.length}</b>\n`;
        
        if (initialPlayers && initialPlayers.length) {
          playersText += initialPlayers.map((player, index) => {
            const rawPlayerFirstName = String(player.first_name || "").trim();
            const rawPlayerLastName = String(player.last_name || "").trim();
            const rawPlayerUsername = String(player.username || "").trim();

            let name;
            let userIdForLink = player.user_id;
            if (String(player.user_id) === String(userId)) {
              name = starterDisplayName;
              userIdForLink = ctx.from.id;
            } else {
              const fullName = [rawPlayerFirstName, rawPlayerLastName].filter(Boolean).join(" ");
              name = fullName || rawPlayerUsername || "Player";
            }

            const sanitizedName = name.replace(/[<>]/g, "");
            const hyperlink = `<a href="tg://user?id=${userIdForLink}"><b>${sanitizedName}</b></a>`;
            const cardIndicator = player.card_link
              ? ` <a href="${player.card_link}">${Math.random() < 0.5 ? "📓" : "📔"}</a>`
              : "";
            
            // Add alarm emoji if player used Late Entry Pass
            const lepIndicator = player.used_lep ? " ⏰" : "";
            const mcpIndicator = player.has_mcp ? " 🛡️" : "";
            
            return `${cardIndicator}${hyperlink}${mcpIndicator}${lepIndicator}`;
          }).join("\n");
        } else {
          playersText += "No players have joined yet. Press the button below to join the game.";
        }
      } else {
        // Regular game format
        const potAmount = (initialPlayers && initialPlayers.length) ? initialPlayers.length * betPerPlayer : betPerPlayer;
        playersText += `<b>💰 Pot: ₱${Number(potAmount).toLocaleString()}</b>\n\n`;
        playersText += `<b>👥 Players Joined: ${initialPlayers.length}</b>\n`;
        if (initialPlayers && initialPlayers.length) {
          playersText += initialPlayers.map((player, index) => {
            const rawPlayerFirstName = String(player.first_name || "").trim();
            const rawPlayerLastName = String(player.last_name || "").trim();
            const rawPlayerUsername = String(player.username || "").trim();

            let name;
            let userIdForLink = player.user_id;
            if (String(player.user_id) === String(userId)) {
              name = starterDisplayName;
              userIdForLink = ctx.from.id;
            } else {
              const fullName = [rawPlayerFirstName, rawPlayerLastName].filter(Boolean).join(" ");
              name = fullName || rawPlayerUsername || "Player";
            }

            const sanitizedName = name.replace(/[<>]/g, "");
            const hyperlink = `<a href="tg://user?id=${userIdForLink}"><b>${sanitizedName}</b></a>`;
            const cardIndicator = player.card_link
              ? ` <a href="${player.card_link}">${Math.random() < 0.5 ? "📓" : "📔"}</a>`
              : "";
            
            // Add alarm emoji if player used Late Entry Pass
            const lepIndicator = player.used_lep ? " ⏰" : "";
            const mcpIndicator = player.has_mcp ? " 🛡️" : "";
            
            return `${cardIndicator}${hyperlink}${mcpIndicator}${lepIndicator} - ₱${betPerPlayer}`;
          }).join("\n");
        } else {
          if (isAnonymousAdmin) {
            playersText += "No players have joined yet. Press the button below to join the game.";
          } else {
            const sanitizedStarterName = starterDisplayName.replace(/[<>]/g, "");
            playersText += `1. <a href="tg://user?id=${userId}"><b>${sanitizedStarterName}</b></a> - ₱${betPerPlayer}`;
          }
        }
      }
      playersText += "\n\n<b>Use /bingoforce to start the game</b>";
    } catch (err) {
      console.error("Failed to build initial players list from DB:", err);
      // Fallback to simple starter display
      const rawStarterFirstName = String(ctx.from.first_name || "").trim();
      const rawStarterUsername = String(ctx.from.username || "").trim();
      const starterName = rawStarterFirstName || (rawStarterUsername ? `@${rawStarterUsername}` : "Player");
      const starterHyperlink = `<a href="tg://user?id=${userId}"><b>${starterName}</b></a>`;
      
      if (isRaid) {
        playersText = [
          `1. ${starterHyperlink}`,
          "",
          "<b>Use /bingoforce to start the game</b>",
        ].join("\n");
      } else if (isFree) {
        playersText = [
          "🎯 <b>Bingo Game Started! — 🎮 Free Play</b>",
          "",
          `1. ${starterHyperlink}`,
          "",
          "<b>Use /bingoforce to start the game</b>",
        ].join("\n");
      } else if (isSponsored) {
        const sponsorNameUpper = sponsorName.toUpperCase();
        playersText = [
          "🎯 <b>Bingo Game Started!</b>",
          "",
          `— SPONSORED BY ${starterHyperlink}`,
          "",
          `<b>💰 Pot: ₱${Number(sponsorAmount).toLocaleString()}</b>`,
          "",
          `1. ${starterHyperlink}`,
          "",
          "<b>Use /bingoforce to start the game</b>",
        ].join("\n");
      } else {
        playersText = [
          "🎯 <b>Bingo Game Started!</b>",
          "",
          `<b>Players Joined:</b> 💰 <b>Pot: ₱${Number(betPerPlayer).toLocaleString()}</b>`,
          "",
          `1. ${starterHyperlink} - ₱${betPerPlayer}`,
          "",
          "<b>Use /bingoforce to start the game</b>",
        ].join("\n");
      }
    }

    // Always send join card to the group (for custom emoji support)
    // If channel is configured, we'll send a hyperlink message to the channel later
    const targetChat = chatId;
    let actualPostChat = targetChat;

    // Check Premium status for custom emoji support
    let usePremiumEmoji = false;
    const cachedPremiumStatus = await getPremiumStatus();

    if (cachedPremiumStatus === null) {
      // Cache expired or not set, run test
      console.log("[premium-check] Cache expired, running test...");
      usePremiumEmoji = await testPremiumEmojiStatus(ctx, BOT_OWNER_ID);
      await setPremiumStatus(usePremiumEmoji);
    } else {
      usePremiumEmoji = cachedPremiumStatus;
      console.log("[premium-check] Using cached status:", usePremiumEmoji);
    }

    // If no Premium and channel is configured, send the plain message to channel instead of group
    console.log(`[premium-check] Checking channel redirect: usePremiumEmoji=${usePremiumEmoji}, groupConfig.channel_id=${groupConfig?.channel_id}, chatId=${chatId}`);
    if (!usePremiumEmoji && groupConfig?.channel_id && groupConfig.channel_id !== chatId) {
      actualPostChat = groupConfig.channel_id;
      console.log(`[premium-check] No Premium, sending plain message to channel ${actualPostChat}`);
    }
    
    try {
      // Use raid video for raid mode (overrides all theme-specific GIFs)
      if (isRaid) {
        gifUrl = "https://56676gy9ro.ufs.sh/f/DtvupcCWPBzZCCz0CGi9pjLomYH6Z5GuqnbKRW8BU1IMvyCr";
        console.log("Using raid video URL:", gifUrl);
      } else {
        // Fetch theme-specific GIF for frozen (regardless of premium status)
        if (themeId === 'frozen') {
          try {
            const frozenCharacters = ['frozen elsa', 'frozen olaf', 'frozen anna'];
            const randomCharacter = frozenCharacters[Math.floor(Math.random() * frozenCharacters.length)];
            const frozenGif = await imageGenerationService.searchGiphy(randomCharacter);
            if (frozenGif) {
              gifUrl = frozenGif;
            }
          } catch (gifErr) {
            console.warn('Failed to fetch frozen-specific GIF, keeping defaults:', gifErr && gifErr.message ? gifErr.message : gifErr);
          }
        }
      }

      // Build message based on Premium status and theme
      if (usePremiumEmoji && (themeId === 'frozen' || themeId === 'spongebob')) {
        // Use rich message with custom emoji
        playersText = buildRichMessage(playersText, themeId);
        console.log(`[premium-check] Using rich message for theme: ${themeId}`);
        
        // Fetch theme-specific GIF for spongebob (premium only)
        if (themeId === 'spongebob' && !isRaid) {
          try {
            const spongebobCharacters = ['spongebob squarepants', 'patrick star', 'spongebob'];
            const randomCharacter = spongebobCharacters[Math.floor(Math.random() * spongebobCharacters.length)];
            const spongebobGif = await imageGenerationService.searchGiphy(randomCharacter);
            if (spongebobGif) {
              gifUrl = spongebobGif;
            }
          } catch (gifErr) {
            console.warn('Failed to fetch spongebob-specific GIF, keeping defaults:', gifErr && gifErr.message ? gifErr.message : gifErr);
          }
        }
      } else {
        // Use plain message
        playersText = buildPlainMessage(playersText, themeId);
        console.log(`[premium-check] Using plain message for theme: ${themeId}`);
      }
      
      // Build join button with custom emoji for themes (only if Premium is active)
      const joinButtonText = (THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].joinButtonText) 
        ? THEME_EMOJIS[themeId].joinButtonText 
        : "🎮 Join Game";
      playersMessage = await ctx.api.sendRichMessage(actualPostChat, {
        html: buildJoinRichMessage(
          playersText,
          gifUrl,
          joinButtonText,
          sessionId,
          usePremiumEmoji ? THEME_EMOJIS[themeId]?.joinButton : null,
          audioUrl,
          isRaid,
        ).html,
      });
    } catch (sendErr) {
      console.error(`Failed to post join card to ${actualPostChat}:`, sendErr && sendErr.description ? sendErr.description : sendErr);
      // If posting to a configured channel failed due to bot not being a member or forbidden,
      // fall back to posting in the group and inform admins in the group about the issue.
      if (actualPostChat !== chatId && sendErr && (sendErr.error_code === 403 || (sendErr.description && /bot is not a member|forbidden/i.test(sendErr.description)))) {
        try {
          await ctx.reply(
            `⚠️ Could not post the join card to the configured channel (${actualPostChat}).\n` +
            `Reason: the bot is not a member of that channel or lacks permission.\n` +
            `I've posted the join card to this group instead. To fix this, add the bot to the channel and give it permission to post, or re-run /bingochannel.`
          );
        } catch (notifyErr) {
          console.error("Failed to notify about channel posting issue:", notifyErr);
        }

        // Try posting to the group instead
        try {
          actualPostChat = chatId;
          
          // Build join button with custom emoji for themes (only if Premium is active)
          const joinButtonText = (THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].joinButtonText) 
            ? THEME_EMOJIS[themeId].joinButtonText 
            : "🎮 Join Game";
          playersMessage = await ctx.api.sendRichMessage(actualPostChat, {
            html: buildJoinRichMessage(
              playersText,
              gifUrl,
              joinButtonText,
              sessionId,
              usePremiumEmoji ? THEME_EMOJIS[themeId]?.joinButton : null,
              audioUrl,
              isRaid,
            ).html,
          });
        } catch (groupErr) {
          console.error("Failed to post join card to group as fallback:", groupErr);
          throw sendErr; // rethrow original error to be handled by outer catch
        }
      } else {
        throw sendErr;
      }
    }

    // Store the player list message ID for later editing when players join
    const messageKey = `${chatId}_${sessionId}`;
    // Clear any stale in-memory entry for this key
    playerListMessages.delete(messageKey);
    
    if (playersMessage && playersMessage.message_id) {
      try {
        playerListMessages.set(messageKey, { chat_id: actualPostChat, message_id: playersMessage.message_id, gif_url: gifUrl });
        console.log(`Stored player list message ID: ${playersMessage.message_id} (chat ${actualPostChat}) for key: ${messageKey}`);

        await bingoGameSession.setPlayerListMessageId(sessionId, playersMessage.message_id, actualPostChat, gifUrl);
        console.log(`Persisted player list message ID ${playersMessage.message_id} (chat ${actualPostChat}) for session ${sessionId}`);

        // Store the /bingostart command message ID for deletion later
        await bingoGameSession.setStartCommandMessageId(sessionId, ctx.message.message_id, chatId);
        console.log(`Stored start command message ID ${ctx.message.message_id} (chat ${chatId}) for session ${sessionId}`);

        // If channel is configured, send hyperlink message to channel
        if (groupConfig?.channel_id && groupConfig.channel_id !== chatId) {
          try {
            const channelId = groupConfig.channel_id;
            // Build the message link - if message is in channel, point to itself; if in group, point to group message
            const groupInfo = actualPostChat === channelId ? null : await ctx.api.getChat(chatId);
            const chatIdentifier = actualPostChat === channelId
              ? `https://t.me/c/${String(channelId).replace(/^-100/, "")}/${playersMessage.message_id}`
              : (groupInfo?.username
                ? `https://t.me/${groupInfo.username}/${playersMessage.message_id}`
                : `https://t.me/c/${String(chatId).replace(/^-100/, "")}/${playersMessage.message_id}`);

            const channelMessage = `<a href="${chatIdentifier}"><b>— REPLY YOUR CARDS HERE</b></a>`;
            
            const channelMessageResult = await ctx.api.sendMessage(channelId, channelMessage, {
              parse_mode: "HTML",
              disable_web_page_preview: true,
            });
            console.log(`Sent hyperlink message to channel ${channelId} pointing to message ${playersMessage.message_id} in ${actualPostChat === channelId ? 'channel' : 'group'}`);
            
            // Store the channel hyperlink message ID for deletion later
            if (channelMessageResult && channelMessageResult.message_id) {
              await bingoGameSession.setChannelHyperlinkMessageId(sessionId, channelMessageResult.message_id, channelId);
              console.log(`Stored channel hyperlink message ID ${channelMessageResult.message_id} (chat ${channelId}) for session ${sessionId}`);
            }
          } catch (channelErr) {
            console.error("Failed to send hyperlink message to channel:", channelErr);
          }
        }
      } catch (error) {
        console.error("Error in bingostart command:", error);
        await ctx.reply(
          "❌ An error occurred while starting the game. Check the logs for details.",
        );
      }
    }

    // Notify registered users via private message if they haven't joined this session
    // Skip users who participated in the last ended session to avoid messaging recent players
    // Skip DMs for free play and raid mode — they're just for fun
    if (isFree || isRaid) {
      return;
    }

    (async () => {
      try {
        const allUsers = (typeof userModel.getAllUsers === 'function') ? await userModel.getAllUsers() : [];
        const joinedPlayers = (initialPlayers || []).map(p => String(p.user_id));
        const joinedSet = new Set(joinedPlayers);
        const starterIdStr = String(userId);

        // Determine players of the last ended session for this group
        let lastPlayersSet = new Set();
        try {
          const lastSession = await bingoGameSession.findLastEndedSession(chatId);
          if (lastSession && lastSession.id) {
            const lastPlayers = await bingoGamePlayer.getPlayersBySession(lastSession.id);
            lastPlayersSet = new Set((lastPlayers || []).map(p => String(p.user_id)));
          }
        } catch (e) {
          console.error("Failed to fetch last session players for notification logic:", e);
        }

        const messages = [
          "Tara bingo na.",
          "Bingo na, tangina mo. 😂",
          "Hoy, bingo na. Wag ka nang patay-patayan.",
          "Bingo na, tamad amp.",
          "Kung buhay ka pa, tara bingo.",
          "Ano papagawa nyo si yeyeys ng ganito tas di ka sasali?",
          "Bingo na. Di ka naman busy, umamin ka.",
          "Tigil kaka-overthink. Bingo muna.",
          "Hoy kupal, pasok na sa bingo.",
          "Bingo na, wag ka nang mahiyang matalo.",
          "Wag ka nang magpanggap na productive. Bingo na.",
          "Bingo na, baka ikaw na naman ang walang panalo.",
          "Kung nandito ka para magbasa, edi sumali ka na rin.",
          "Send a photo of you touching grass taken within the last 3 hours.",
          "Bingo na. Libre mangarap, hindi manalo.",
          "Sige nga, patunayan mong hindi ka malas.",
          "Bingo na, love. Sayang yung oras mo kung 'di ka makakasali.",
          "Miss ka na namin dito sa laro, halika na.",
          "Kahit ilang round ka lang, okay na. Basta kasama ka.",
          "Sumali ka na, gusto ka lang naming makasama.",
          "Bingo na kung may time ka. Walang rush.",
          "May bingo ngayon ha, in case gusto mong sumali.",
          "Sumali ka kung kaya, chill lang naman 'to.",
          "Bingo time. Sali ka kung gusto, walang required.",
          "Nag-aannounce lang, bingo na po tayo.",
          "Heads up, bingo na. Free ka ba sumali?",
          "Bingo na. Alam kong nandiyan ka lang, nagpapanggap kang busy.",
          "Di ka champion sa totoong buhay, dito mo na lang subukan.",
          "Bingo na. Kahit malas ka, at least sumali ka, di ba?",
        ];
        const voiceFiles = [
          path.join(__dirname, "..", "..", "assets", "voice", "bingostart.ogg"),
        ];
        const availableVoiceFiles = voiceFiles.filter((voiceFile) => fs.existsSync(voiceFile));
        if (availableVoiceFiles.length === 0) {
          console.warn(
            `[bingostart-notify] Voice files unavailable, skipping voice DMs. Checked: ${voiceFiles.join(", ")}`,
          );
        }

        for (const u of allUsers) {
          try {
            const tid = String(u.telegram_id || u.telegramId || u.telegramId);
            if (!tid) continue;
            if (tid === starterIdStr) continue; // skip starter
            if (joinedSet.has(tid)) continue; // skip users who already joined
            if (lastPlayersSet.has(tid)) continue; // skip users who played in last ended session

            // Check if user is actually a member of this group chat
            try {
              const member = await ctx.api.getChatMember(chatId, Number(tid));
              const status = member?.status;
              // Only notify if user is member, administrator, or creator (not left/banned)
              if (!status || status === 'left' || status === 'kicked') {
                continue;
              }
            } catch (memberErr) {
              // If getChatMember fails, user is likely not in the group
              continue;
            }

            const shouldSendVoice = Math.random() < 0.15; // 15% chance to send voice
            if (shouldSendVoice && availableVoiceFiles.length > 0) {
              const voicePath = availableVoiceFiles[Math.floor(Math.random() * availableVoiceFiles.length)];
              try {
                await ctx.api.sendVoice(Number(tid), new InputFile(voicePath));
                console.log(`[bingostart-notify] Sent voice DM to ${tid}: ${voicePath}`);
                continue;
              } catch (sendErr) {
                if (sendErr && (sendErr.error_code === 403 || /bot was blocked|user is deactivated|Forbidden/.test(String(sendErr)))) {
                  console.log(`[bingostart-notify] Could not send voice DM to ${tid} (probably blocked or cannot be messaged).`);
                  continue;
                }
                console.error(`[bingostart-notify] Failed to send voice DM to ${tid}:`, sendErr);
              }
            }

            // Pick a random text message
            const text = messages[Math.floor(Math.random() * messages.length)];

            try {
              await ctx.api.sendMessage(Number(tid), text);
              console.log(`[bingostart-notify] Sent DM to ${tid}`);
            } catch (sendErr) {
              // Ignore if the user blocked the bot or cannot be messaged
              if (sendErr && (sendErr.error_code === 403 || /bot was blocked|user is deactivated|Forbidden/.test(String(sendErr)))) {
                console.log(`[bingostart-notify] Could not send DM to ${tid} (probably blocked or cannot be messaged).`);
                continue;
              }
              console.error(`[bingostart-notify] Failed to send DM to ${tid}:`, sendErr);
            }
          } catch (inner) {
            console.error("Error preparing DM for user:", inner);
          }
        }
      } catch (notifyErr) {
        console.error("Error during bingostart notification loop:", notifyErr);
      }
    })();
  } catch (error) {
    console.error("Unexpected error in /bingostart handler:", error);
  }
}

module.exports = { handleBingoStart };
