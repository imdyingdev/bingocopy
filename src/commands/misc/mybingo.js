/**
 * My Bingo command - displays user stats and BAC cards
 */

const { InputFile } = require("grammy");
const { IMAGE_ENABLED } = require("../../utils/imageSettings");
const fs = require("fs");
const path = require("path");

// Helper function to get PH day start in UTC
function getPHDayStartUtcExpression() {
  return `(DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')) AT TIME ZONE 'Asia/Manila'`;
}

// Helper function to get PH month start in UTC
function getPHMonthStartUtcExpression() {
  return `(DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')) AT TIME ZONE 'Asia/Manila'`;
}

// Get current month info in PH timezone
function getCurrentMonthInfoPH() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

// Get days in month
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// Tier function matching the HTML template
function tierFor(count) {
  if (!count || count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  if (count <= 8) return 4;
  return 5; // 9-10 (and anything above caps here)
}

async function getPlayerGamesPerDay(pool, userId) {
  const client = await pool.connect();
  try {
    const monthStart = getPHMonthStartUtcExpression();
    
    // Count games per day for the player, only counting games that:
    // 1. Have winners (EXISTS in winners table)
    // 2. Have drawn items (game_events with GAME_DRAW and non-empty draws array)
    const query = `
      SELECT 
        DATE_TRUNC('day', bgs.created_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila' as game_date,
        COUNT(DISTINCT bgs.id) as game_count
      FROM game_players bgp
      JOIN games bgs ON bgp.session_id = bgs.id
      WHERE bgp.user_id = $1
        AND bgs.created_at >= ${monthStart}
        AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
        AND EXISTS (
          SELECT 1
          FROM game_events ge
          WHERE ge.group_id = bgs.group_id::text
            AND ge.event_type = 'GAME_DRAW'
            AND ge.timestamp >= COALESCE(bgs.started_at, bgs.created_at)
            AND ge.timestamp <= COALESCE(bgs.ended_at, NOW())
            AND jsonb_array_length(COALESCE(ge.session_data->'draws', '[]'::jsonb)) > 0
        )
      GROUP BY DATE_TRUNC('day', bgs.created_at AT TIME ZONE 'Asia/Manila') AT TIME ZONE 'Asia/Manila'
      ORDER BY game_date;
    `;
    
    const result = await client.query(query, [userId]);
    
    // Convert to map of day (1-31) -> count
    const gamesByDay = new Map();
    for (const row of result.rows) {
      const date = new Date(row.game_date);
      const day = date.getDate();
      gamesByDay.set(day, row.game_count);
    }
    
    return gamesByDay;
  } catch (error) {
    console.error("Error getting player games per day:", error);
    throw error;
  } finally {
    client.release();
  }
}

async function generateCalendarHTML(userId, gamesByDay) {
  const monthInfo = getCurrentMonthInfoPH();
  const daysInMonth = getDaysInMonth(monthInfo.year, monthInfo.month);
  
  // Build game counts array (index 0 = day 1)
  const gameCounts = [];
  for (let day = 1; day <= daysInMonth; day++) {
    gameCounts.push(gamesByDay.get(day) || 0);
  }
  
  // Read the HTML template
  const templatePath = path.join(__dirname, '..', '..', '..', 'mystats.txt');
  let html = fs.readFileSync(templatePath, 'utf8');
  
  // Replace the MONTH_INFO object
  const monthInfoString = JSON.stringify({
    year: monthInfo.year,
    month: monthInfo.month,
    gameCounts: gameCounts
  }, null, 2).replace(/"(\d+)"/g, '$1'); // Convert string numbers to actual numbers
  
  html = html.replace(
    /\/\/ ====== INJECT DATA HERE — replace this object from the bot ======.*?\/\/ ====== END INJECT ======/s,
    `// ====== INJECT DATA HERE — replace this object from the bot ======\n    // gameCounts index 0 = day 1, last index = last day of the month.\n    // Length should equal the number of days in that month (28-31).\n    const MONTH_INFO = ${monthInfoString};\n    // ====== END INJECT ======`
  );
  
  return html;
}

async function generateCalendarImageFromHTML(html) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  try {
    // Set the HTML content
    await page.setContent(html);
    
    // Take a screenshot of the #card element
    const card = await page.locator('#card');
    const screenshot = await card.screenshot();
    
    return screenshot;
  } finally {
    await browser.close();
  }
}

function formatRankDisplay(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return Number(rank) || rank;
}

function resolveMyBingoUserStats(stats, userId) {
  const normalizedStats = Array.isArray(stats) ? stats : [];
  const rankedStats = [...normalizedStats].sort((a, b) => {
    if ((b.wins ?? 0) !== (a.wins ?? 0)) return (b.wins ?? 0) - (a.wins ?? 0);
    if ((b.win_rate ?? 0) !== (a.win_rate ?? 0)) return (b.win_rate ?? 0) - (a.win_rate ?? 0);
    return (b.total_games ?? 0) - (a.total_games ?? 0);
  });

  const userEntry = rankedStats.find((player) =>
    String(player.user_id ?? player.telegram_id ?? "") === String(userId)
  );

  if (!userEntry) {
    return {
      rank: "N/A",
      totalGames: 0,
      wins: 0,
      losses: 0,
      gamesToday: 0,
    };
  }

  const rank = rankedStats.findIndex((player) =>
    String(player.user_id ?? player.telegram_id ?? "") === String(userId)
  ) + 1;

  return {
    rank,
    totalGames: Number(userEntry.total_games || 0),
    wins: Number(userEntry.wins || 0),
    losses: Number(userEntry.losses || 0),
    gamesToday: Number(userEntry.games_per_day || 0),
  };
}

async function handleMybingo(ctx, userModel, gameWinnerModel) {
  try {
    const userId = ctx.from.id;
    
    const user = await userModel.findByTelegramId(userId);
    if (!user) {
      await ctx.reply("❌ User not found. Please try /start first.");
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

    // Build BAC section
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
      bacSection = `\n<b>BAC Cards:</b>\n${resolvedBacList.join('\n')}`;
    }

    // Generate calendar image
    let calendarImage = null;
    try {
      const gamesByDay = await getPlayerGamesPerDay(gameWinnerModel.pool, userId);
      
      if (IMAGE_ENABLED && gamesByDay.size > 0) {
        const html = await generateCalendarHTML(userId, gamesByDay);
        calendarImage = await generateCalendarImageFromHTML(html);
      }
    } catch (error) {
      console.warn("Could not generate calendar image:", error.message);
    }

    // Build caption message
    const displayName = user.first_name || user.username || "Your";
    let caption = `<b>📊 ${displayName} Bingo Stats</b>\n\n`;
    caption += "<b>Rank:</b> " + formatRankDisplay(userRank) + "\n";
    caption += "<b>Total Games:</b> " + totalGamesThisMonth + "\n";
    caption += "<b>Games Today:</b> " + gamesToday + "\n";
    caption += "<b>Wins:</b> " + wins + "\n";
    caption += "<b>Loss:</b> " + losses;
    if (bacSection) {
      caption += bacSection;
    }

    // Send with calendar image if available, otherwise as text
    if (calendarImage) {
      await ctx.replyWithPhoto(
        new InputFile(calendarImage, 'stats.png'),
        {
          caption: caption,
          parse_mode: 'HTML',
          reply_to_message_id: ctx.message.message_id,
        }
      );
    } else {
      // Fallback to text message if calendar generation failed
      const formattedMessage = caption.replace(/\r?\n/g, "<br>");
      const richHtml = `<p>${formattedMessage}</p>
<tg-button-row>
  <tg-button type="callback_data" data="mybingo_toggle_${userId}_collapsed">Close</tg-button>
</tg-button-row>`;

      await ctx.api.sendRichMessage(ctx.chat.id, { html: richHtml }, {
        reply_to_message_id: ctx.message.message_id,
      });
    }

  } catch (error) {
    console.error("Error in /mybingo command:", error);
    const displayName = user?.first_name || user?.username || "your";
    await ctx.reply(`❌ Failed to load ${displayName} stats. Please try again.`);
  }
}

module.exports = { handleMybingo, resolveMyBingoUserStats, formatRankDisplay };
