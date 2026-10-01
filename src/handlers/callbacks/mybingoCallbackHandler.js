/**
 * Mybingo callback handler
 * Handles toggle callbacks for collapsing/expanding mybingo stats
 */

const { resolveMyBingoUserStats, formatRankDisplay } = require("../../commands/misc/mybingo");

async function handleMybingoToggleCallback(ctx, userModel, gameWinnerModel) {
  const callbackData = ctx.callbackQuery.data;
  const parts = callbackData.replace("mybingo_toggle_", "").split("_");
  const userId = parseInt(parts[0], 10);
  const state = parts[1]; // "collapsed" or "expanded"

  try {
    // Verify the callback user matches the current user
    if (ctx.from.id !== userId) {
      await ctx.answerCallbackQuery({
        text: "⚠️ You can only toggle your own stats.",
        show_alert: true,
      });
      return;
    }

    const user = await userModel.findByTelegramId(userId);
    if (!user) {
      await ctx.answerCallbackQuery({
        text: "❌ User not found.",
        show_alert: true,
      });
      return;
    }

    let userStats = {
      rank: "N/A",
      totalGames: 0,
      wins: 0,
      losses: 0,
      gamesToday: 0,
    };

    try {
      const allStats = await gameWinnerModel.getGlobalPlayerStatsWithLosses();
      userStats = resolveMyBingoUserStats(allStats, userId);

      if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
        const gamesTodayMap = await gameWinnerModel.getPlayerGamesPerDay(ctx.chat.id);
        userStats.gamesToday = Number(gamesTodayMap.get(String(userId)) || 0);
      }
    } catch (error) {
      console.warn("Could not fetch all-time /mybingo statistics:", error.message);
    }

    const { rank: userRank, totalGames: totalGamesThisMonth, wins, losses, gamesToday } = userStats;
    const bacCards = user.bac_cards || [];

    // Format BAC cards with full names, emojis, and links
    const bacNames = {
      'BAFM': '<a href="https://t.me/bacstimech/7">👑 Be An Admin For a Month</a>',
      'DPC': '<a href="https://t.me/bacstimech/8">💰 Double Prize Card</a>',
      'FP': '<a href="https://t.me/bacstimech/9">🎫 Free Pass</a>',
      'DP': '<a href="https://t.me/bacstimech/10">🏷️ Discount Pass</a>',
      'LEP': '<a href="https://t.me/bacstimech/11">⏰ Late Entry Pass</a>',
      'MCP': '<a href="https://t.me/bacstimech/12">🛡️ Missed Call Protection</a>',
      'BBP': '<a href="https://t.me/bacstimech/13">🍀 Bad Bingo Protection</a>',
      'BLK': '<a href="https://t.me/bacstimech/14">🚫 Block a Player Card</a>',
      'BAN': '<a href="https://t.me/bacstimech/15">🔨 Ban a Player Card</a>',
      'BBS': '<a href="https://t.me/bacstimech/16">🏦 Bingo Bank Shield</a>'
    };

    // Build BAC section with expandable blockquote
    let bacSection = "";
    if (bacCards.length > 0) {
      const cardCounts = {};
      bacCards.forEach(code => {
        cardCounts[code] = (cardCounts[code] || 0) + 1;
      });

      const uniqueCards = Object.keys(cardCounts);

      const bacList = uniqueCards.map(async (code) => {
        let display = bacNames[code] || `🎴 ${code}`;
        const quantity = cardCounts[code];

        // Show quantity for cards that can have duplicates (FP, BAN, LEP, MCP, BLK, BBS)
        if (['FP', 'BAN', 'LEP', 'MCP', 'BLK', 'BBS'].includes(code) && quantity > 1) {
          display = `${display} (${quantity})`;
        }

        const isActivated = await userModel.isBacActivated(userId, code);

        if (code === 'BAFM' && user.temp_admin_until) {
          const now = new Date();
          const expiry = new Date(user.temp_admin_until);
          const diffMs = expiry - now;

          if (diffMs > 0) {
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

            if (diffDays > 0) {
              const hoursText = diffHours === 1 ? '1hr' : `${diffHours}hrs`;
              display = `${bacNames['BAFM']} (${diffDays}d ${hoursText})`;
            } else {
              const hoursText = diffHours === 1 ? '1hr' : `${diffHours}hrs`;
              display = `${bacNames['BAFM']} (${hoursText})`;
            }
          }
        }

        if (isActivated) {
          display = `<b>${display}</b>`;
        } else {
          display = `<i>${display}</i>`;
        }

        return display;
      });

      const resolvedBacList = await Promise.all(bacList);
      bacSection = `<blockquote expandable>${resolvedBacList.join('\n')}\n</blockquote>`;
    }

    let message;
    let buttonText;
    let callbackDataValue;

    if (state === "collapsed") {
      // Show collapsed version (only rank)
      message = "<b>📊 Your Bingo Stats</b>\n\n";
      message += "<b>Rank:</b> " + formatRankDisplay(userRank);
      buttonText = "Open";
      callbackDataValue = `mybingo_toggle_${userId}_expanded`;
    } else {
      // Show expanded version
      message = "<b>📊 Your Bingo Stats</b>\n\n";
      message += "<b>Rank:</b> " + formatRankDisplay(userRank) + "\n";
      message += "<b>Total Games:</b> " + totalGamesThisMonth + "\n";
      message += "<b>Games Today:</b> " + gamesToday + "\n";
      message += "<b>Wins:</b> " + wins + "\n";
      message += "<b>Loss:</b> " + losses + "\n";
      if (bacSection) {
        message += "<b>BAC Cards:</b>\n" + bacSection;
      }
      buttonText = "Close";
      callbackDataValue = `mybingo_toggle_${userId}_collapsed`;
    }

    // Build rich message with toggle button
    const formattedMessage = message.replace(/\r?\n/g, "<br>");
    const richMessage = {
      html: `<p>${formattedMessage}</p>
<tg-button-row>
  <tg-button type="callback_data" data="${callbackDataValue}">${buttonText}</tg-button>
</tg-button-row>`
    };

    try {
      await ctx.api.editMessageText(
        ctx.chat.id,
        ctx.callbackQuery.message.message_id,
        richMessage
      );
      await ctx.answerCallbackQuery();
    } catch (editError) {
      // Handle "message not modified" error gracefully
      if (editError?.error_code === 400 && editError?.description?.includes("message is not modified")) {
        console.log("Mybingo toggle: message content unchanged, skipping edit");
        await ctx.answerCallbackQuery();
        return;
      }
      throw editError; // Re-throw other errors
    }
  } catch (error) {
    console.error("Error handling mybingo toggle callback:", error);
    await ctx.answerCallbackQuery({
      text: "❌ Failed to toggle stats. Please try again.",
      show_alert: true,
    });
  }
}

module.exports = { handleMybingoToggleCallback };
