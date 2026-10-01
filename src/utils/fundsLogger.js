/**
 * Utility for logging fund transactions at game end
 */

const { Pool } = require("pg");
const { getPostgresConnectionString } = require("./databaseConfig");

class FundsLogger {
  constructor() {
    const connectionString = getPostgresConnectionString();
    const config = connectionString
      ? { connectionString }
      : {
          host: process.env.PGHOST,
          port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined,
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE,
        };

    if (connectionString || process.env.PGHOST) {
      config.ssl = { rejectUnauthorized: false };
    }

    config.connectionTimeoutMillis = 10000;
    config.idleTimeoutMillis = 30000;
    config.max = 20;

    this.pool = new Pool(config);

    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  cleanName(value) {
    return String(value || "")
      .replace(/\u3164/g, "")
      .replace(/\u200B/g, "")
      .replace(/\u200C/g, "")
      .replace(/\u200D/g, "")
      .replace(/\uFEFF/g, "")
      .trim();
  }

  escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  buildNameLink(entry, displayName) {
    const name = displayName || entry.name || entry.first_name || entry.username || "User";
    const sanitized = name.replace(/[<>]/g, "");
    if (entry.telegram_id && Number(entry.telegram_id) > 0) {
      return `<a href="tg://user?id=${entry.telegram_id}">${sanitized}</a>`;
    }
    return sanitized;
  }

  buildMergedNameLink(user, otherUser) {
    const userName = user.username || user.first_name || user.last_name || "User";
    const otherUserName = otherUser.username || otherUser.first_name || otherUser.last_name || "User";
    return `${this.buildNameLink(user, userName)}&${this.buildNameLink(otherUser, otherUserName)}`;
  }

  async getFundsWithChanges(groupId, sessionId, betPerPlayer, players, winners, settlementResult) {
    const client = await this.pool.connect();
    try {
      // Get all users who participated in this session
      const playersQuery = `
        SELECT DISTINCT user_id, username, first_name, last_name
        FROM game_players
        WHERE session_id = $1;
      `;
      const playersResult = await client.query(playersQuery, [sessionId]);
      
      const userIds = playersResult.rows.map(row => row.user_id);
      
      if (userIds.length === 0) {
        return { individual: [], joint: [], adminFunds: 0, bingobankFunds: 0 };
      }

      // Get current funds for these users
      const fundsQuery = `
        SELECT 
          u.id,
          u.telegram_id,
          u.username,
          u.first_name,
          u.last_name,
          u.funds,
          u.merged_into,
          partner.first_name AS partner_first_name,
          partner.last_name AS partner_last_name,
          partner.username AS partner_username,
          partner.funds AS partner_funds
        FROM users u
        LEFT JOIN users partner ON partner.id = u.merged_into
        WHERE u.telegram_id = ANY($1)
        ORDER BY 
          CASE WHEN u.merged_into IS NULL THEN 0 ELSE 1 END,
          LOWER(COALESCE(u.first_name, u.username, u.last_name, CAST(u.telegram_id AS TEXT))) ASC;
      `;
      
      const fundsResult = await client.query(fundsQuery, [userIds]);
      
      // Get admin and bingobank funds from group config
      const configQuery = `
        SELECT admin_funds, bingobank_funds
        FROM group_configs
        WHERE group_id = $1;
      `;
      const configResult = await client.query(configQuery, [groupId]);
      const adminFunds = configResult.rows[0]?.admin_funds || 0;
      const bingobankFunds = configResult.rows[0]?.bingobank_funds || 0;

      // Calculate fund changes for each player
      const playerChanges = {};
      const winnerUserIds = new Set((winners || []).map(w => String(w.user_id)));
      const fpPlayers = new Set(players.filter(p => p.used_fp === true).map(p => String(p.user_id)));
      const dpPlayers = new Set(players.filter(p => p.used_dp === true).map(p => String(p.user_id)));
      const dpcPlayers = new Set(players.filter(p => p.used_dpc === true).map(p => String(p.user_id)));

      // Calculate winner prizes
      const winnerPrizes = {};
      if (settlementResult && winners) {
        const winnersByPattern = {};
        for (const winner of winners) {
          const normalizedPattern = String(winner.pattern_name || "").trim().toLowerCase();
          if (!winnersByPattern[normalizedPattern]) {
            winnersByPattern[normalizedPattern] = [];
          }
          winnersByPattern[normalizedPattern].push(winner);
        }

        for (const [pattern, patternWinners] of Object.entries(winnersByPattern)) {
          let patternPrizeAmount = 0;
          for (const winner of patternWinners) {
            if (winner.prize_amount && winner.prize_amount > 0) {
              patternPrizeAmount = winner.prize_amount;
              break;
            }
          }
          
          if (patternPrizeAmount === 0) {
            const totalPot = players.length * betPerPlayer;
            const distinctPatternCount = new Set(
              winners.map(w => String(w.pattern_name || "").trim().toLowerCase()).filter(Boolean)
            ).size || 1;
            patternPrizeAmount = Math.floor(totalPot / distinctPatternCount);
          }
          
          const prizePerWinner = patternWinners.length > 0 ? Math.floor(patternPrizeAmount / patternWinners.length) : 0;
          for (const winner of patternWinners) {
            const userId = String(winner.user_id);
            winnerPrizes[userId] = dpcPlayers.has(userId) ? prizePerWinner * 2 : prizePerWinner;
          }
        }
      }

      // Calculate changes for each player
      for (const player of players) {
        const userId = String(player.user_id);
        const isFpPlayer = fpPlayers.has(userId);
        const isDpPlayer = dpPlayers.has(userId);
        const isWinner = winnerUserIds.has(userId);
        
        let change = 0;
        const actualBet = isDpPlayer ? betPerPlayer - 5 : betPerPlayer;
        
        if (!isFpPlayer) {
          change -= actualBet; // Deduct bet
        }
        
        if (isWinner) {
          change += winnerPrizes[userId] || 0; // Add prize
        }
        
        playerChanges[userId] = change;
      }

      // Separate individual and joint accounts
      const individual = [];
      const joint = [];
      const processedMergedIds = new Set();

      for (const row of fundsResult.rows) {
        const userId = String(row.telegram_id);
        const change = playerChanges[userId] || 0;
        const currentFunds = row.funds || 0;
        const beforeFunds = currentFunds - change;

        if (row.merged_into) {
          // This is a merged account - handle it once
          const mergeKey = Math.min(row.id, row.merged_into).toString() + '-' + Math.max(row.id, row.merged_into).toString();
          if (!processedMergedIds.has(mergeKey)) {
            processedMergedIds.add(mergeKey);
            
            const displayName = this.cleanName(
              (row.first_name || row.username || row.last_name || `user_${row.telegram_id}`) + 
              ' 🔗 ' + 
              (row.partner_first_name || row.partner_username || row.partner_last_name || "Unknown Player")
            );
            
            const sharedFunds = (row.funds || 0) + (row.partner_funds || 0);
            const partnerUserId = String(row.merged_into);
            const partnerChange = playerChanges[partnerUserId] || 0;
            const totalChange = change + partnerChange;
            const beforeSharedFunds = sharedFunds - totalChange;
            
            // Format the change string
            let changeString = `${sharedFunds.toLocaleString()}`;
            if (totalChange !== 0) {
              const changeText = totalChange > 0 ? `+${totalChange}` : totalChange;
              changeString = `${beforeSharedFunds.toLocaleString()}=${changeText}=${sharedFunds.toLocaleString()}`;
            }
            
            joint.push({
              name: displayName,
              nameHtml: this.buildMergedNameLink(row, {
                username: row.partner_username,
                first_name: row.partner_first_name,
                last_name: row.partner_last_name
              }),
              funds: sharedFunds,
              changeString
            });
          }
        } else {
          // Individual account
          const displayName = this.cleanName(
            row.first_name || row.username || row.last_name || `user_${row.telegram_id}`
          );
          
          // Format the change string
          let changeString = `${currentFunds.toLocaleString()}`;
          if (change !== 0) {
            const changeText = change > 0 ? `+${change}` : change;
            changeString = `${beforeFunds.toLocaleString()}=${changeText}=${currentFunds.toLocaleString()}`;
          }
          
          individual.push({
            name: displayName,
            nameHtml: this.buildNameLink(row, displayName),
            funds: currentFunds,
            changeString
          });
        }
      }

      return { individual, joint, adminFunds, bingobankFunds };
    } catch (error) {
      console.error("Error getting funds with changes:", error);
      return { individual: [], joint: [], adminFunds: 0, bingobankFunds: 0 };
    } finally {
      client.release();
    }
  }

  formatFundLogMessage({ individual, joint, adminFunds, bingobankFunds }) {
    const cleanName = this.cleanName;
    const escapeHtml = this.escapeHtml;

    // Format Philippines time
    const phTime = new Date().toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    // Format individual funds
    let individualBlock = "";
    individual.forEach(entry => {
      const safeName = escapeHtml(entry.name);
      const nameHtml = entry.nameHtml;
      const changeString = entry.changeString || entry.funds.toLocaleString();

      const entryText = `ㅤʚɞ . . . ${nameHtml} || ${changeString}`;
      individualBlock += `${entryText}\n`;
    });

    // Format joint funds
    let jointBlock = "";
    joint.forEach(entry => {
      const safeName = escapeHtml(entry.name);
      const nameHtml = entry.nameHtml;
      const changeString = entry.changeString || entry.funds.toLocaleString();

      const entryText = `ㅤʚɞ . . . ${nameHtml} || ${changeString}`;
      jointBlock += `${entryText}\n`;
    });

    // Build the content inside the blockquote
    let blockquoteContent = "";
    if (individualBlock) {
      blockquoteContent += `🏦𝗕𝗜𝗡𝗚𝗢 𝗙𝗨𝗡𝗗𝗦\n${individualBlock}`;
    }

    if (jointBlock) {
      blockquoteContent += `\n🔗 𝗝𝗢𝗜𝗡𝗧 𝗙𝗨𝗡𝗗𝗦\n${jointBlock}`;
    }

    // Add admin and bingobank funds
    blockquoteContent += `\nㅤʚɞ . . . 𝗯𝗶𝗻𝗴𝗼𝗯𝗮𝗻𝗸 || ${bingobankFunds.toLocaleString()}\n`;
    blockquoteContent += `ㅤʚɞ . . . 𝗮𝗱𝗺𝗶𝗻𝗳𝘂𝗻𝗱𝘀 || ${adminFunds.toLocaleString()}`;

    // Build the complete message with date header and expandable blockquote
    const message = `${phTime}<blockquote expandable>${blockquoteContent}</blockquote>`;

    return message;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = FundsLogger;