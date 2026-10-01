/**
 * Panalo (Leaderboard) command - displays top players with win/loss stats
 */

const { InputFile } = require("grammy");
const ImageUploadService = require("../../../services/ImageUploadService");
const { GLOBAL_GROUP_ID } = require("../../utils/constants");
const { IMAGE_ENABLED } = require("../../utils/imageSettings");

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Cooldown tracking for /panalov2
const panaloV2Cooldowns = new Map();
const COOLDOWN_MS = 30000; // 30 seconds cooldown

async function handleBingoRecap(ctx, gameWinner, imageGenerationService, imageUploadService) {
  const userId = Number(ctx.from?.id);
  const authorizedUserId = 8442877660;
  const TARGET_GROUP_ID = -1004423750809; // Always use this group for data

  console.log("=== /bingorecap command called ===");
  console.log("Chat ID:", ctx.chat.id);
  console.log("Chat Type:", ctx.chat.type);
  console.log("User ID:", ctx.from?.id);
  console.log("Target Group ID for data:", TARGET_GROUP_ID);

  if (userId !== authorizedUserId) {
    console.log("Unauthorized /bingorecap call by user", userId);
    return;
  }

  const rawText = ctx.message?.text || "";
  const argsText = rawText.replace(/^\/bingorecap(?:@\w+)?\s*/i, "").trim();
  const parts = argsText.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
  const [monthRaw, secondRaw, thirdRaw] = parts;
  const monthLabel = monthRaw || "June";

  if (!monthRaw) {
    await ctx.reply("❌ Usage: /bingorecap <MONTH> [, <YEAR>]\nExample: /bingorecap july, 2026\nExample: /bingorecap august");
    return;
  }

  const yearArg = [secondRaw, thirdRaw].find((arg) => arg && /^\d{4}$/.test(arg));
  const year = yearArg || new Date().getFullYear();
  const groupId = TARGET_GROUP_ID; // Always use the target group ID

  const monthArg = `${monthLabel} ${year}`;

  try {
    const monthCounts = await gameWinner.getMonthlyGameAndBolaCounts(groupId, monthArg);

    if (!monthCounts || monthCounts.totalGames === 0) {
      await ctx.reply(`❌ No winner recap found for group ${groupId} in ${monthArg}.`);
      return;
    }

    if (!IMAGE_ENABLED) {
      const stats = await gameWinner.getMonthlyPlayerStatsWithLosses(groupId, 0, monthArg);
      const leaderboard = stats.slice(0, 10).map((player, index) => {
        const medals = ["🥇", "🥈", "🥉"];
        const rank = medals[index] || `${index + 1}.`;
        const name = escapeHtml(player.first_name || player.username || "Player");
        return `${rank} <b>${name}</b> | Wins: ${player.wins} | Games: ${player.total_games}`;
      });
      await ctx.reply(
        `<b>🎖 Bingo Recap - ${monthLabel} ${year}</b>\nGames: ${monthCounts.totalGames}\nBolas: ${monthCounts.totalBolas || 0}\n\n${leaderboard.join("\n") || "No player stats available."}`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const capitalizedMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1).toLowerCase();
    const statusMessage = await ctx.reply(
      `<b>🔄 Generating Recap for ${capitalizedMonth} ${year}!</b>`,
      { parse_mode: "HTML" }
    );

    const stats = await gameWinner.getMonthlyPlayerStatsWithLosses(groupId, 0, monthArg);
    const isJulyOrJuneOrAugust = ["july", "june", "august"].includes(monthLabel.toLowerCase());
    const coverBuffer = await imageGenerationService.generatePanaloJulyCoverImage(`Group ${groupId}`, `${monthLabel} ${year} Recap`);
    const top5Stats = stats.slice(0, 5);
    const fourthPlace = stats[3];
    const fourthPlaceName = fourthPlace ? (fourthPlace.first_name || fourthPlace.username || "A player") : null;
    const mostWinsSubtitle = fourthPlaceName
      ? `${fourthPlaceName} holds fourth place — keep playing and chase the next win!`
      : "Top performers this month — keep the momentum going!";

    console.log("Most Wins subtitle for summary:", mostWinsSubtitle);

    const top5Buffer = top5Stats.length > 0
      ? isJulyOrJuneOrAugust
        ? await imageGenerationService.generatePanaloJulyMonthSummaryImage(top5Stats, `Group ${groupId}`, `Most Wins in ${monthLabel} ${year}`, { subtitle: mostWinsSubtitle })
        : await imageGenerationService.generatePanaloMonthSummaryImage(top5Stats, `Group ${groupId}`, `Most Wins in ${monthLabel} ${year}`)
      : null;
    const countBuffer = await imageGenerationService.generatePanaloJulyCountImage(monthCounts, `Group ${groupId}`, `${monthLabel} ${year} Recap`);
    const totalGamesBuffer = await imageGenerationService.generatePanaloJulyTotalGamesImage(stats.slice(0, 5), `Group ${groupId}`, `Most Total Games in ${monthLabel} ${year}`);
    
    // New day/night winners images
    const morningStats = await gameWinner.getMonthlyTimeBasedWinners(groupId, "morning", 3, monthArg);
    const afternoonStats = await gameWinner.getMonthlyTimeBasedWinners(groupId, "afternoon", 3, monthArg);
    const dayBuffer = (morningStats.length > 0 || afternoonStats.length > 0)
      ? await imageGenerationService.generatePanaloAugustDayWinnersImage(morningStats, afternoonStats, `Group ${groupId}`, `Day Winners in ${monthLabel} ${year}`)
      : null;
    
    const eveningStats = await gameWinner.getMonthlyTimeBasedWinners(groupId, "evening", 3, monthArg);
    const midnightStats = await gameWinner.getMonthlyTimeBasedWinners(groupId, "midnight", 3, monthArg);
    const nightBuffer = (eveningStats.length > 0 || midnightStats.length > 0)
      ? await imageGenerationService.generatePanaloAugustNightWinnersImage(eveningStats, midnightStats, `Group ${groupId}`, `Night Winners in ${monthLabel} ${year}`)
      : null;
    
    const attendanceStats = await gameWinner.getMonthlyTopAttendance(groupId, 5, monthArg);
    const attendanceBuffer = await imageGenerationService.generatePanaloJulyAttendanceImage(attendanceStats, `Group ${groupId}`, `Top Attendance in ${monthLabel} ${year}`);
    
    const longestStreakStats = await gameWinner.getMonthlyPlayerLongestWinStreaks(groupId, 5, monthArg);
    const longestStreakBuffer = await imageGenerationService.generatePanaloJulyLongestStreaksImage(longestStreakStats, `Group ${groupId}`, `Longest Win Streaks in ${monthLabel} ${year}`);
    const confidenceStats = stats.slice().sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 5);
    const confidenceBuffer = await imageGenerationService.generatePanaloJulyMostConfidenceImage(confidenceStats, `Group ${groupId}`, `Most Confidence in ${monthLabel} ${year}`);

    const noWinStats = await gameWinner.getMonthlyPlayersWithNoWins(groupId, monthArg);
    const noWinsSubtitle = noWinStats.length === 1
      ? "1 Player Got No Wins"
      : noWinStats.length > 1 && noWinStats.length <= 3
      ? `${noWinStats.length} Players Got No Wins`
      : `Players with no wins in ${capitalizedMonth} ${year}`;
    const noWinsBuffer = noWinStats.length > 0
      ? await imageGenerationService.generatePanaloJulyNoWinsImage(noWinStats, `Group ${groupId}`, `No Wins in ${monthLabel} ${year}`, noWinsSubtitle)
      : null;

    const uploadedImages = [];
    const uploads = [
      { buffer: coverBuffer, label: `${monthLabel} ${year} Recap Cover` },
      { buffer: top5Buffer, label: `Most Wins ${monthLabel} ${year}` },
      { buffer: dayBuffer, label: `Day Winners ${monthLabel} ${year}` },
      { buffer: nightBuffer, label: `Night Winners ${monthLabel} ${year}` },
      { buffer: countBuffer, label: `${monthLabel} ${year} Counts` },
      { buffer: totalGamesBuffer, label: `Total Games ${monthLabel} ${year}` },
      { buffer: attendanceBuffer, label: `Attendance ${monthLabel} ${year}` },
      { buffer: longestStreakBuffer, label: `Longest Streaks ${monthLabel} ${year}` },
      { buffer: confidenceBuffer, label: `Confidence ${monthLabel} ${year}` },
      { buffer: noWinsBuffer, label: `No Wins ${monthLabel} ${year}` },
    ];

    const orderedUploads = uploads
      .filter((item) => item.buffer)
      .sort((a, b) => {
        const aIsNoWins = /^No Wins/i.test(a.label);
        const bIsNoWins = /^No Wins/i.test(b.label);
        if (aIsNoWins && !bIsNoWins) return 1;
        if (!aIsNoWins && bIsNoWins) return -1;
        return 0;
      });

    for (const item of orderedUploads) {
      const filename = `bingorecap-${groupId}-${monthLabel.toLowerCase()}-${year}-${Date.now()}.png`;
      const uploadResult = await imageUploadService.uploadImage(item.buffer, filename);
      uploadedImages.push({ url: uploadResult.url, fileId: uploadResult.fileId, label: item.label });
    }

    if (uploadedImages.length === 0) {
      await ctx.reply("❌ Failed to generate any recap slides.");
      return;
    }

    const recapCaption = `<h2><b>🎖BINGO RECAP —  ${monthLabel.toUpperCase()} ${year}</b></h2>`;
    const slideshowHtml = `
${recapCaption}
<tg-slideshow>
${uploadedImages.map((img) => `  <img src="${img.url}" alt="${img.label}" />`).join("\n")}
</tg-slideshow>
<p><i><a href="https://t.me/bingago/232122">Missed July Recap? Click Here.</a></i></p>
`.trim();

    await ctx.api.sendRichMessage(ctx.chat.id, { html: slideshowHtml });

    if (statusMessage && statusMessage.message_id) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, statusMessage.message_id);
      } catch (deleteError) {
        // Ignore deletion errors
      }
    }

    for (const img of uploadedImages) {
      if (img.fileId) {
        await imageUploadService.deleteImage(img.fileId);
      }
    }
  } catch (error) {
    console.error("Error in bingorecap command:", error);
    await ctx.reply("❌ Error generating recap. Please try again.");
  }
}

// Cooldown tracking for /panalo
const panaloCooldowns = new Map();
const PANALO_COOLDOWN_MS = 30000; // 30 seconds cooldown

async function handlePanalo(ctx, gameWinner, imageGenerationService, groupConfigService) {
  console.log("=== /panalo command called ===");
  console.log("Chat ID:", ctx.chat.id);
  console.log("Chat Type:", ctx.chat.type);
  console.log("User ID:", ctx.from?.id);

  // Only work in groups
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("🚫 This command only works in groups.");
    return;
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from?.id;

  const isGroupSetupConfirmed = await groupConfigService.isCommandAllowedInGroup(groupId, []);
  if (!isGroupSetupConfirmed) {
    return;
  }

  const now = Date.now();
  const messageText = ctx.message?.text || "";
  const rawArgs = typeof ctx.match === "string"
    ? ctx.match.trim()
    : messageText.replace(/^\/panalo(?:@\w+)?\s*/i, "").trim();
  const [monthArgRaw, groupArgRaw] = rawArgs.split(",").map((part) => part.trim()).filter(Boolean);
  const monthSelection = monthArgRaw ? gameWinner.parseMonthSelection(monthArgRaw) : null;
  const requestedGroupId = groupArgRaw && /^-?\d+$/.test(groupArgRaw) ? Number(groupArgRaw) : null;

  // Check cooldown
  const lastPanalo = panaloCooldowns.get(userId);
  if (lastPanalo && now - lastPanalo < PANALO_COOLDOWN_MS) {
    const remaining = Math.ceil((PANALO_COOLDOWN_MS - (now - lastPanalo)) / 1000);
    await ctx.reply(`⏳ Please wait ${remaining} seconds before using /panalo again.`);
    console.log(`Cooldown active for user ${userId}, ${remaining}s remaining`);
    return;
  }

  try {
    if (rawArgs && !monthSelection) {
      await ctx.reply("❌ Invalid month. Try `/panalo july` or `/panalo july 2026`.", { parse_mode: "Markdown" });
      return;
    }

    if (monthSelection) {
      const sourceGroupId = requestedGroupId || GLOBAL_GROUP_ID;
      const sourceGroupLabel = requestedGroupId ? `Group ${requestedGroupId}` : `Global Group ${GLOBAL_GROUP_ID}`;
      const isJulyOrAugustSelection = monthSelection.monthIndex === 6 || monthSelection.monthIndex === 7;
      const summaryTitle = isJulyOrAugustSelection ? `Most Wins in ${monthSelection.label}` : monthSelection.label;

      console.log(`Fetching player stats for ${monthSelection.label} from global group ${sourceGroupId}...`);
      const stats = await gameWinner.getMonthlyPlayerStatsWithLosses(sourceGroupId, 0, monthArgRaw);
      const top5Stats = stats.slice(0, 5);
      const fourthPlace = stats[3];
      const fourthPlaceName = fourthPlace ? (fourthPlace.first_name || fourthPlace.username || "A player") : null;
      const mostWinsSubtitle = fourthPlaceName
        ? `${fourthPlaceName} holds fourth place — keep pushing for next time!`
        : "";

      console.log(`Players fetched for ${monthSelection.label}:`, stats.length);

      panaloCooldowns.set(userId, now);

      if (stats.length === 0) {
        await ctx.reply(
          `📊 <b>${summaryTitle}</b>\n\n<i>No games played yet for this month.</i>`,
          { parse_mode: "HTML" }
        );
        return;
      }

      console.log("Generating monthly top 5 summary image...");
      const leaderboardBuffer = IMAGE_ENABLED && (isJulyOrAugustSelection
        ? await imageGenerationService.generatePanaloJulyMonthSummaryImage(top5Stats, sourceGroupLabel, summaryTitle, { subtitle: mostWinsSubtitle })
        : await imageGenerationService.generatePanaloMonthSummaryImage(top5Stats, sourceGroupLabel, monthSelection.label));

      if (leaderboardBuffer) {
        console.log("✅ Monthly summary image generated successfully (" + leaderboardBuffer.length + " bytes)");
        await ctx.replyWithPhoto(new InputFile(leaderboardBuffer));
        console.log("✅ Monthly summary image sent successfully");
      } else {
        console.log("❌ Monthly summary image generation failed, falling back to text");
        let message = `🏆 <b>${summaryTitle}</b>\n\n`;
        stats.slice(0, 3).forEach((player, index) => {
          const medals = ["🥇", "🥈", "🥉"];
          const rank = medals[index] || `${index + 1}.`;
          const displayName = escapeHtml(player.first_name || player.username || "Player");
          const username = player.username ? `@${escapeHtml(player.username)}` : "";

          message += `${rank} <b>${displayName}</b> ${username}\n`;
          message += `   Wins: ${player.wins} | Games: ${player.total_games} | GT: ${player.games_per_day || 0} | Streak: ${player.streak || 0}\n\n`;
        });

        await ctx.reply(message, { parse_mode: "HTML" });
      }

      return;
    }

    console.log("Fetching monthly player stats (PH time)...");
    const allStats = await gameWinner.getMonthlyPlayerStatsWithLosses(GLOBAL_GROUP_ID);
    console.log("Total players fetched for this month:", allStats.length);

    // Limit to top 10 for /panalo
    const stats = allStats.slice(0, 10);
    console.log("Players for /panalo (top 10 monthly):", stats.length);

    // Update cooldown
    panaloCooldowns.set(userId, now);

    if (stats.length === 0) {
      await ctx.reply(
        "📊 <b>Leaderboard</b>\n\n<i>No games played yet. Start a bingo game to see player statistics!</i>",
        { parse_mode: "HTML" }
      );
      return;
    }

    console.log("Generating leaderboard image...");
    // Generate leaderboard image
    const leaderboardBuffer = IMAGE_ENABLED
      ? await imageGenerationService.generateLeaderboardImage(stats, ctx.chat.title)
      : null;

    if (leaderboardBuffer) {
      console.log("✅ Leaderboard image generated successfully (" + leaderboardBuffer.length + " bytes)");
      await ctx.replyWithPhoto(new InputFile(leaderboardBuffer));
      console.log("✅ Leaderboard image sent successfully");
    } else {
      console.log("❌ Image generation failed, falling back to text");
      // Fallback to text if image generation fails
      let message = "🏆 <b>LEADERBOARD</b>\n\n";
      stats.forEach((player, index) => {
        const medals = ["🥇", "🥈", "🥉"];
        const rank = index < 3 ? medals[index] : `${index + 1}.`;
        
        const displayName = escapeHtml(player.first_name || player.username || "Player");
        const username = player.username ? `@${escapeHtml(player.username)}` : "";
        
        message += `${rank} <b>${displayName}</b> ${username}\n`;
        message += `   Wins: ${player.wins} | Losses: ${player.losses} | Games: ${player.total_games} | GT: ${player.games_per_day || 0}\n\n`;
      });

      await ctx.reply(message, { parse_mode: "HTML" });
    }
  } catch (error) {
    console.error("Error in panalo command:", error);
    await ctx.reply("❌ Error generating leaderboard. Please try again.");
  }
}

async function handlePanaloV2(ctx, gameWinner, imageGenerationService, imageUploadService) {
  console.log("=== /panalov2 command called ===");
  console.log("Chat ID:", ctx.chat.id);
  console.log("Chat Type:", ctx.chat.type);
  console.log("User ID:", ctx.from.id);

  // Only work in groups
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
    await ctx.reply("🚫 This command only works in groups.");
    return;
  }

  const userId = ctx.from.id;
  const now = Date.now();

  // Check cooldown
  const lastUsed = panaloV2Cooldowns.get(userId);
  if (lastUsed && now - lastUsed < COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
    await ctx.reply(`⏱️ Please wait ${remainingSeconds} seconds before using /panalov2 again.`);
    return;
  }

  console.log("Cooldown check passed, proceeding with panalov2");

  const groupId = ctx.chat.id;

  try {
    // Get monthly player stats for panalov2 so slideshow can include rank 11+
    console.log("Fetching monthly player stats (PH time)...");
    const stats = await gameWinner.getMonthlyPlayerStatsWithLosses(groupId, 100);
    console.log(`Total players fetched for this month: ${stats.length}`);

    if (stats.length === 0) {
      await ctx.reply(
        "📊 <b>Leaderboard</b>\n\n<i>No games played yet. Start a bingo game to see player statistics!</i>",
        { parse_mode: "HTML" }
      );
      return;
    }

    if (!IMAGE_ENABLED) {
      for (let index = 0; index < stats.length; index += 10) {
        const batch = stats.slice(index, index + 10);
        const lines = batch.map((player, batchIndex) => {
          const rank = index + batchIndex + 1;
          const medals = ["🥇", "🥈", "🥉"];
          const name = escapeHtml(player.first_name || player.username || "Player");
          return `${medals[rank - 1] || `${rank}.`} <b>${name}</b> | Wins: ${player.wins} | Losses: ${player.losses} | Games: ${player.total_games}`;
        });
        await ctx.reply(`<b>🏆 LEADERBOARD</b>\n\n${lines.join("\n")}`, { parse_mode: "HTML" });
      }
      panaloV2Cooldowns.set(userId, now);
      return;
    }

    // Get players 11+ for slideshow
    const playersForSlideshow = stats.length > 10 ? stats.slice(10) : [];
    console.log(`Players for slideshow (rank 11+): ${playersForSlideshow.length}`);

    if (playersForSlideshow.length === 0) {
      await ctx.reply("📊 Not enough players for slideshow. Use /panalo for the full leaderboard (top 10).");
      return;
    }

    // Split into batches of 10 for slideshow images
    const batchSize = 10;
    const batches = [];
    for (let i = 0; i < playersForSlideshow.length; i += batchSize) {
      batches.push(playersForSlideshow.slice(i, i + batchSize));
    }
    console.log(`Created ${batches.length} batches for slideshow`);
    batches.forEach((batch, i) => {
      const startRank = 11 + (i * batchSize);
      const endRank = Math.min(startRank + batchSize - 1, stats.length);
      console.log(`Batch ${i + 1}: ${batch.length} players (ranks ${startRank}-${endRank})`);
    });

    // Update cooldown
    panaloV2Cooldowns.set(userId, now);

    // Generate and upload images for each batch using V2 template (no badges/icons)
    console.log("Starting image generation and upload for batches...");
    const uploadedImages = [];
    const uploadService = new ImageUploadService();
    
    for (let i = 0; i < batches.length; i++) {
      try {
        const batch = batches[i];
        const startRank = 11 + (i * batchSize);
        const endRank = Math.min(startRank + batchSize - 1, stats.length);
        
        console.log(`Generating image for batch ${i + 1}/${batches.length} (ranks ${startRank}-${endRank})`);
        const imageBuffer = await imageGenerationService.generateLeaderboardImageV2(batch, ctx.chat.title, startRank);
        
        if (imageBuffer) {
          console.log(`✅ Batch ${i + 1} image generated successfully (${imageBuffer.length} bytes)`);
          
          const filename = `leaderboard-${startRank}-${endRank}-${Date.now()}.png`;
          console.log(`📤 Uploading batch ${i + 1} to ImageKit.io...`);
          
          const uploadResult = await uploadService.uploadImage(imageBuffer, filename);
          
          uploadedImages.push({
            url: uploadResult.url,
            rankRange: `${startRank}-${endRank}`,
            fileId: uploadResult.fileId
          });
          
          console.log(`✅ Batch ${i + 1} uploaded: ${uploadResult.url}`);
        } else {
          console.log(`❌ Batch ${i + 1} image generation failed`);
        }
      } catch (error) {
        console.error(`❌ Error generating/uploading image for batch ${i}:`, error);
      }
    }

    console.log(`Total images uploaded: ${uploadedImages.length}/${batches.length}`);

    if (uploadedImages.length === 0) {
      await ctx.reply("❌ Failed to generate slideshow images.");
      return;
    }

    // Create Rich Message with slideshow
    console.log("Creating Rich Message slideshow...");
    const slideshowHtml = uploadedImages.map(img => 
      `<img src="${img.url}" alt="Players ${img.rankRange}" />`
    ).join("\n");

    const richHtml = `
<tg-slideshow>
${slideshowHtml}
</tg-slideshow>
`.trim();

    try {
      console.log("📤 Sending Rich Message slideshow to Telegram...");

      await ctx.api.sendRichMessage(ctx.chat.id, { html: richHtml }, {
        reply_to_message_id: ctx.message.message_id,
      });

      console.log("✅ Rich Message slideshow sent successfully");
    } catch (error) {
      console.error("❌ Error sending Rich Message, falling back to media group:", error);
      // Fallback to media group if Rich Message fails
      const mediaGroup = uploadedImages.map(img => ({
        type: 'photo',
        media: img.url,
      }));
      await ctx.replyWithMediaGroup(mediaGroup, {
        reply_to_message_id: ctx.message.message_id,
      });
      console.log("✅ Fallback media group sent");
    }

    // Delete uploaded images after sending
    console.log("🗑️ Cleaning up uploaded images from ImageKit.io...");
    for (const img of uploadedImages) {
      if (img.fileId) {
        uploadService.deleteImage(img.fileId);
      }
    }
    console.log("✅ Cleanup completed");

  } catch (error) {
    console.error("❌ Error in panalov2 command:", error);
    await ctx.reply("❌ Error generating slideshow leaderboard. Please try again.");
  }
}

module.exports = { handlePanalo, handlePanaloV2, handleBingoRecap };
