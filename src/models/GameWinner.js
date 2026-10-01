const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../utils/databaseConfig");

class GameWinner {
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

    // Add connection pool settings for better stability
    config.connectionTimeoutMillis = 10000; // 10 seconds
    config.idleTimeoutMillis = 30000; // 30 seconds
    config.max = 20; // Maximum pool size

    this.pool = new Pool(config);

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  async initTable() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS winners (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          user_id BIGINT NOT NULL,
          pattern_name TEXT NOT NULL,
          prize_amount INTEGER DEFAULT NULL,
          claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_winners_session_id ON winners(session_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_winners_user_id ON winners(user_id);
      `);

      // Migration: Change existing 0 prize_amount values to NULL
      try {
        await client.query(`
          UPDATE winners
          SET prize_amount = NULL
          WHERE prize_amount = 0
        `);
        console.log("Winners table: Migrated 0 prize_amount values to NULL");
      } catch (migrationError) {
        console.log("Game winners migration note:", migrationError.message);
      }

    } catch (error) {
      console.error("Error initializing game winners table:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async addWinner(sessionId, userId, patternName, prizeAmount = null) {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO winners (session_id, user_id, pattern_name, prize_amount)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
      `;
      const result = await client.query(query, [sessionId, userId, patternName, prizeAmount]);
      return result.rows[0];
    } catch (error) {
      console.error("Error adding winner:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getWinnersBySession(sessionId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT gw.*, u.username, u.first_name, u.last_name, u.profile_photo_url AS profilePhotoUrl
        FROM winners gw
        LEFT JOIN users u ON gw.user_id = u.telegram_id
        WHERE gw.session_id = $1
        ORDER BY gw.claimed_at ASC;
      `;
      const result = await client.query(query, [sessionId]);
      return result.rows;
    } catch (error) {
      console.error("Error getting winners by session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteWinner(winnerId, sessionId) {
    const client = await this.pool.connect();
    try {
      const query = `
        DELETE FROM winners
        WHERE id = $1 AND session_id = $2
        RETURNING *;
      `;
      const result = await client.query(query, [winnerId, sessionId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error deleting winner:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteBySession(sessionId) {
    const client = await this.pool.connect();
    try {
      const query = "DELETE FROM winners WHERE session_id = $1;";
      await client.query(query, [sessionId]);
    } catch (error) {
      console.error("Error deleting winners by session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getRecentWinners() {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT DISTINCT gw.user_id
        FROM winners gw
        JOIN games bgs ON gw.session_id = bgs.id
        WHERE bgs.id = (
          SELECT MAX(id) FROM games
        )
      `;
      const result = await client.query(query);
      return new Set(result.rows.map(row => String(row.user_id)));
    } catch (error) {
      console.error("Error getting recent winners:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getPlayerStats(groupId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT 
          gw.user_id,
          u.username,
          u.first_name,
          u.last_name,
          u.profile_photo_url AS profilePhotoUrl,
          u.is_celebration AS is_celebration,
          COUNT(DISTINCT gw.session_id) as wins
        FROM winners gw
        JOIN games bgs ON gw.session_id = bgs.id
        LEFT JOIN users u ON gw.user_id = u.telegram_id
        WHERE bgs.group_id = $1
        GROUP BY gw.user_id, u.username, u.first_name, u.last_name, u.profile_photo_url, u.is_celebration
        ORDER BY wins DESC, u.first_name ASC
        LIMIT 10;
      `;
      const result = await client.query(query, [groupId]);
      return result.rows;
    } catch (error) {
      console.error("Error getting player stats:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePrizeAmount(winnerId, prizeAmount) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE winners
        SET prize_amount = $1
        WHERE id = $2
        RETURNING *;
      `;
      const result = await client.query(query, [prizeAmount, winnerId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error updating prize amount:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  getPHDayStartUtcExpression() {
    return `(DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')) AT TIME ZONE 'Asia/Manila'`;
  }

  getPHMonthStartUtcExpression() {
    return `(DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')) AT TIME ZONE 'Asia/Manila'`;
  }

  getPHCalendarDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(date);

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

  parseMonthSelection(monthInput) {
    if (!monthInput || typeof monthInput !== 'string') return null;

    const normalized = monthInput
      .trim()
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (!normalized) return null;

    const monthTokens = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };

    const [monthToken, yearToken] = normalized.split(/\s+/);
    const monthIndex = monthTokens[monthToken.replace(/\./g, '')];
    if (typeof monthIndex !== 'number') return null;

    const currentYear = this.getPHCalendarDateParts().year;
    const year = yearToken && /^\d{4}$/.test(yearToken) ? Number(yearToken) : currentYear;

    const startUtc = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0) - 8 * 60 * 60 * 1000);
    const endUtc = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0) - 8 * 60 * 60 * 1000);

    const label = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      month: 'long',
      year: 'numeric',
    }).format(new Date(Date.UTC(year, monthIndex, 15, 12, 0, 0)));

    return {
      monthIndex,
      year,
      startUtc,
      endUtc,
      label,
    };
  }

  async getMonthlyGameAndBolaCounts(groupId, monthName = null) {
    const client = await this.pool.connect();
    try {
      const monthSelection = monthName ? this.parseMonthSelection(monthName) : null;
      if (monthName && !monthSelection) {
        throw new Error(`Invalid month selection: ${monthName}`);
      }

      const monthStart = this.getPHMonthStartUtcExpression();
      const params = monthSelection
        ? [groupId, monthSelection.startUtc.toISOString(), monthSelection.endUtc.toISOString()]
        : [groupId];
      const dateClause = monthSelection
        ? 'AND bgs.created_at >= $2 AND bgs.created_at < $3'
        : `AND bgs.created_at >= ${monthStart}`;

      const gamesQuery = `
        SELECT COUNT(DISTINCT bgs.id) AS total_games
        FROM games bgs
        WHERE bgs.group_id = $1
          ${dateClause}
          AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
      `;
      const gamesResult = await client.query(gamesQuery, params);
      const totalGames = Number(gamesResult.rows[0]?.total_games || 0);

      const drawsQuery = monthSelection
        ? `
            SELECT COALESCE(SUM(jsonb_array_length(ge.session_data->'draws')), 0) AS total_bola_drawn
            FROM game_events ge
            JOIN games bgs ON bgs.group_id::text = ge.group_id
              AND ge.event_type = 'GAME_DRAW'
              AND ge.timestamp >= bgs.started_at
              AND ge.timestamp <= COALESCE(bgs.ended_at, NOW())
            WHERE bgs.group_id = $1
              AND bgs.created_at >= $2
              AND bgs.created_at < $3
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
              AND bgs.started_at IS NOT NULL
          `
        : `
            SELECT COALESCE(SUM(jsonb_array_length(ge.session_data->'draws')), 0) AS total_bola_drawn
            FROM game_events ge
            JOIN games bgs ON bgs.group_id::text = ge.group_id
              AND ge.event_type = 'GAME_DRAW'
              AND ge.timestamp >= bgs.started_at
              AND ge.timestamp <= COALESCE(bgs.ended_at, NOW())
            WHERE bgs.group_id = $1
              AND bgs.created_at >= ${monthStart}
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
              AND bgs.started_at IS NOT NULL
          `;
      const drawsResult = await client.query(drawsQuery, params);
      const totalBolaDrawn = Number(drawsResult.rows[0]?.total_bola_drawn || 0);

      const playersQuery = monthSelection
        ? `
            SELECT COUNT(DISTINCT bgp.user_id) AS total_players
            FROM game_players bgp
            JOIN games bgs ON bgp.session_id = bgs.id
            WHERE bgs.group_id = $1
              AND bgs.created_at >= $2
              AND bgs.created_at < $3
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
          `
        : `
            SELECT COUNT(DISTINCT bgp.user_id) AS total_players
            FROM game_players bgp
            JOIN games bgs ON bgp.session_id = bgs.id
            WHERE bgs.group_id = $1
              AND bgs.created_at >= ${monthStart}
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
          `;
      const playersResult = await client.query(playersQuery, params);
      const totalPlayers = Number(playersResult.rows[0]?.total_players || 0);

      const prizeQuery = monthSelection
        ? `
            SELECT COALESCE(SUM(COALESCE(gw.prize_amount, 0)), 0) AS total_prize
            FROM winners gw
            JOIN games bgs ON gw.session_id = bgs.id
            WHERE bgs.group_id = $1
              AND bgs.created_at >= $2
              AND bgs.created_at < $3
              AND (bgs.is_sponsored IS NULL OR bgs.is_sponsored = FALSE)
              AND (bgs.is_free IS NULL OR bgs.is_free = FALSE)
              AND (bgs.is_raid IS NULL OR bgs.is_raid = FALSE)
          `
        : `
            SELECT COALESCE(SUM(COALESCE(gw.prize_amount, 0)), 0) AS total_prize
            FROM winners gw
            JOIN games bgs ON gw.session_id = bgs.id
            WHERE bgs.group_id = $1
              AND bgs.created_at >= ${monthStart}
              AND (bgs.is_sponsored IS NULL OR bgs.is_sponsored = FALSE)
              AND (bgs.is_free IS NULL OR bgs.is_free = FALSE)
              AND (bgs.is_raid IS NULL OR bgs.is_raid = FALSE)
          `;
      const prizeResult = await client.query(prizeQuery, params);
      const totalBets = Number(prizeResult.rows[0]?.total_prize || 0);

      return {
        totalGames,
        totalBolaDrawn,
        totalPlayers,
        totalBets,
      };
    } catch (error) {
      console.error('Error getting monthly game and bola counts:', error);
      return {
        totalGames: 0,
        totalBolaDrawn: 0,
        totalPlayers: 0,
        totalBets: 0,
      };
    } finally {
      client.release();
    }
  }

  async getOverallGameAndBolaCounts(groupId) {
    const client = await this.pool.connect();
    try {
      const gamesQuery = `
        SELECT COUNT(DISTINCT bgs.id) AS total_games
        FROM games bgs
        WHERE bgs.group_id = $1
          AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
      `;
      const gamesResult = await client.query(gamesQuery, [groupId]);
      const totalGames = Number(gamesResult.rows[0]?.total_games || 0);

      const drawsQuery = `
        SELECT COALESCE(SUM(jsonb_array_length(ge.session_data->'draws')), 0) AS total_bola_drawn
        FROM game_events ge
        JOIN games bgs ON bgs.group_id::text = ge.group_id
          AND ge.event_type = 'GAME_DRAW'
          AND ge.timestamp >= bgs.started_at
          AND ge.timestamp <= COALESCE(bgs.ended_at, NOW())
        WHERE bgs.group_id = $1
          AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
          AND bgs.started_at IS NOT NULL
      `;
      const drawsResult = await client.query(drawsQuery, [groupId]);
      const totalBolaDrawn = Number(drawsResult.rows[0]?.total_bola_drawn || 0);

      const playersQuery = `
        SELECT COUNT(DISTINCT bgp.user_id) AS total_players
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE bgs.group_id = $1
          AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
      `;
      const playersResult = await client.query(playersQuery, [groupId]);
      const totalPlayers = Number(playersResult.rows[0]?.total_players || 0);

      const prizeQuery = `
        SELECT COALESCE(SUM(COALESCE(gw.prize_amount, 0)), 0) AS total_prize
        FROM winners gw
        JOIN games bgs ON gw.session_id = bgs.id
        WHERE bgs.group_id = $1
          AND (bgs.is_sponsored IS NULL OR bgs.is_sponsored = FALSE)
          AND (bgs.is_free IS NULL OR bgs.is_free = FALSE)
          AND (bgs.is_raid IS NULL OR bgs.is_raid = FALSE)
      `;
      const prizeResult = await client.query(prizeQuery, [groupId]);
      const totalBets = Number(prizeResult.rows[0]?.total_prize || 0);

      return {
        totalGames,
        totalBolaDrawn,
        totalPlayers,
        totalBets,
      };
    } catch (error) {
      console.error('Error getting overall game and bola counts:', error);
      return {
        totalGames: 0,
        totalBolaDrawn: 0,
        totalPlayers: 0,
        totalBets: 0,
      };
    } finally {
      client.release();
    }
  }

  async getPlayerGamesPerDay(groupId) {
    const client = await this.pool.connect();
    try {
      // Count how many games each player participated in today (PH time)
      // Reset at midnight PH time (Asia/Manila timezone)
      // bgs.created_at stores UTC timestamps.
      // We calculate the PH day-start in UTC for correct comparison.
      const dayStartUtc = this.getPHDayStartUtcExpression();
      const query = `
        SELECT 
          bgp.user_id,
          COUNT(DISTINCT bgs.id) as games_per_day
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE bgs.group_id = $1
          AND bgs.created_at >= ${dayStartUtc}
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
        GROUP BY bgp.user_id
      `;
      const result = await client.query(query, [groupId]);
      return new Map(
        result.rows.map(row => [String(row.user_id), row.games_per_day])
      );
    } catch (error) {
      console.error("Error getting player games per day:", error);
      return new Map();
    } finally {
      client.release();
    }
  }

  isQualifiedForLeaderboard(wins, totalGames) {
    return Number.isFinite(totalGames) && Number.isFinite(wins) && totalGames >= 5 && wins >= 0;
  }

  calculateMonthlyRankingScore(wins, totalGames) {
    if (!this.isQualifiedForLeaderboard(wins, totalGames)) return 0;

    const z = 1.96; // 95% confidence interval
    const n = Number(totalGames);
    const phat = wins / n;
    const denominator = 1 + (z * z) / n;
    const centre = phat + (z * z) / (2 * n);
    const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);

    return (centre - margin) / denominator;
  }

  calculateStreakFromResults(results) {
    if (!Array.isArray(results) || results.length === 0) return 0;

    let currentStreak = 0;
    let lastWasWin = null;

    for (const result of results) {
      const isWin = result?.is_win === true;

      if (lastWasWin === null) {
        currentStreak = isWin ? 1 : -1;
      } else if (isWin === lastWasWin) {
        currentStreak += isWin ? 1 : -1;
      } else {
        currentStreak = isWin ? 1 : -1;
      }

      lastWasWin = isWin;
    }

    return currentStreak;
  }

  calculateLongestWinStreakFromResults(results) {
    if (!Array.isArray(results) || results.length === 0) return 0;

    let currentWinStreak = 0;
    let longestWinStreak = 0;

    for (const result of results) {
      const isWin = result?.is_win === true;

      if (isWin) {
        currentWinStreak += 1;
        longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
      } else {
        currentWinStreak = 0;
      }
    }

    return longestWinStreak;
  }

  async getPlayerStreaks(groupId = null, monthStartCondition = null) {
    const client = await this.pool.connect();
    try {
      let query = `
        SELECT 
          bgp.user_id,
          bgs.id,
          EXISTS (
            SELECT 1 FROM winners gw
            WHERE gw.session_id = bgs.id AND gw.user_id = bgp.user_id
          ) as is_win
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
      `;
      const params = [];

      if (groupId !== null && groupId !== undefined) {
        query += ` AND bgs.group_id = $1`;
        params.push(groupId);
      }

      if (monthStartCondition && typeof monthStartCondition === 'object') {
        if (monthStartCondition.start) {
          query += ` AND bgs.created_at >= $${params.length + 1}`;
          params.push(monthStartCondition.start);
        }
        if (monthStartCondition.end) {
          query += ` AND bgs.created_at < $${params.length + 1}`;
          params.push(monthStartCondition.end);
        }
      } else if (monthStartCondition) {
        query += ` AND bgs.created_at >= ${monthStartCondition}`;
      }

      query += ` ORDER BY bgp.user_id, bgs.created_at ASC`;

      const result = await client.query(query, params);
      const streakResultsByUser = new Map();

      for (const row of result.rows) {
        const userId = String(row.user_id);
        if (!streakResultsByUser.has(userId)) {
          streakResultsByUser.set(userId, []);
        }
        streakResultsByUser.get(userId).push({ is_win: row.is_win === true });
      }

      const streaks = new Map();
      for (const [userId, results] of streakResultsByUser.entries()) {
        streaks.set(userId, this.calculateStreakFromResults(results));
      }

      return streaks;
    } catch (error) {
      console.error("Error getting player streaks:", error);
      return new Map();
    } finally {
      client.release();
    }
  }

  async getPlayerLongestWinStreaks(groupId = null, monthStartCondition = null) {
    const client = await this.pool.connect();
    try {
      let query = `
        SELECT 
          bgp.user_id,
          bgs.id,
          EXISTS (
            SELECT 1 FROM winners gw
            WHERE gw.session_id = bgs.id AND gw.user_id = bgp.user_id
          ) as is_win
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
      `;
      const params = [];

      if (groupId !== null && groupId !== undefined) {
        query += ` AND bgs.group_id = $1`;
        params.push(groupId);
      }

      if (monthStartCondition && typeof monthStartCondition === 'object') {
        if (monthStartCondition.start) {
          query += ` AND bgs.created_at >= $${params.length + 1}`;
          params.push(monthStartCondition.start);
        }
        if (monthStartCondition.end) {
          query += ` AND bgs.created_at < $${params.length + 1}`;
          params.push(monthStartCondition.end);
        }
      } else if (monthStartCondition) {
        query += ` AND bgs.created_at >= ${monthStartCondition}`;
      }

      query += ` ORDER BY bgp.user_id, bgs.created_at ASC`;

      const result = await client.query(query, params);
      const streakResultsByUser = new Map();

      for (const row of result.rows) {
        const userId = String(row.user_id);
        if (!streakResultsByUser.has(userId)) {
          streakResultsByUser.set(userId, []);
        }
        streakResultsByUser.get(userId).push({ is_win: row.is_win === true });
      }

      const streaks = new Map();
      for (const [userId, results] of streakResultsByUser.entries()) {
        streaks.set(userId, this.calculateLongestWinStreakFromResults(results));
      }

      return streaks;
    } catch (error) {
      console.error("Error getting player longest win streaks:", error);
      return new Map();
    } finally {
      client.release();
    }
  }

  async getMonthlyPlayerLongestWinStreaks(groupId, maxResults = 10, monthName = null) {
    const playerStats = await this.getMonthlyPlayerStatsWithLosses(groupId, 0, monthName);
    const monthSelection = monthName ? this.parseMonthSelection(monthName) : null;
    const streaksMap = await this.getPlayerLongestWinStreaks(groupId, monthSelection ? { start: monthSelection.startUtc.toISOString(), end: monthSelection.endUtc.toISOString() } : null);

    const statsWithLongestStreaks = playerStats.map((player) => ({
      ...player,
      streak: Number(streaksMap.get(String(player.user_id)) || 0),
    }));

    const sorted = statsWithLongestStreaks.sort((a, b) => Number(b.streak) - Number(a.streak));
    return typeof maxResults === 'number' && maxResults > 0 ? sorted.slice(0, maxResults) : sorted;
  }

  async getPlayerStatsWithLosses(groupId) {
    const client = await this.pool.connect();
    try {
      // Get total games per player in the group - only count games that had winners
      const totalGamesQuery = `
        SELECT 
          bgp.user_id,
          COUNT(DISTINCT bgs.id) as total_games
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE bgs.group_id = $1
          AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
        GROUP BY bgp.user_id
      `;
      const totalGamesResult = await client.query(totalGamesQuery, [groupId]);
      const totalGamesMap = new Map(
        totalGamesResult.rows.map(row => [String(row.user_id), row.total_games])
      );

      // Get wins per player
      const winsQuery = `
        SELECT 
          gw.user_id,
          COUNT(DISTINCT gw.session_id) as wins
        FROM winners gw
        JOIN games bgs ON gw.session_id = bgs.id
        WHERE bgs.group_id = $1
        GROUP BY gw.user_id
      `;
      const winsResult = await client.query(winsQuery, [groupId]);
      const winsMap = new Map(
        winsResult.rows.map(row => [String(row.user_id), row.wins])
      );

      // Get games per day (last 24 hours)
      const gamesPerDayMap = await this.getPlayerGamesPerDay(groupId);
      const streaksMap = await this.getPlayerStreaks(groupId);

      // Get user info - use LEFT JOIN to include players even if they're not in users table
      // Filter out users with no name (no first_name and no username)
      const usersQuery = `
        SELECT DISTINCT ON (bgp.user_id)
          bgp.user_id AS telegram_id,
          u.username,
          u.first_name,
          u.last_name,
          u.profile_photo_url AS profilePhotoUrl,
          u.is_celebration AS is_celebration
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        LEFT JOIN users u ON u.telegram_id = bgp.user_id
        WHERE bgs.group_id = $1
          AND ((u.first_name IS NOT NULL AND TRIM(u.first_name) != '')
               OR (u.username IS NOT NULL AND TRIM(u.username) != ''))
        ORDER BY bgp.user_id
      `;
      const usersResult = await client.query(usersQuery, [groupId]);

      // Combine data
      const stats = usersResult.rows.map(user => {
        const userId = String(user.telegram_id);
        const wins = Number(winsMap.get(userId) || 0);
        const totalGames = Number(totalGamesMap.get(userId) || 0);
        const losses = totalGames - wins;
        const winRate = totalGames > 0 ? wins / totalGames : 0;
        const score = totalGames > 0 ? this.calculateMonthlyRankingScore(wins, totalGames) : 0;
        const gamesPerDay = Number(gamesPerDayMap.get(userId) || 0);
        const streak = Number(streaksMap.get(userId) || 0);

        return {
          user_id: userId,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          profilePhotoUrl: user.profilephotourl,
          is_celebration: user.is_celebration || null,
          wins: wins,
          losses: Math.max(0, losses),
          total_games: totalGames,
          win_rate: winRate,
          win_rate_percent: totalGames > 0 ? Math.round(winRate * 100) : 0,
          games_per_day: gamesPerDay,
          score: score,
          streak: streak,
        };
      });

      let rankedStats = stats.filter((player) => this.isQualifiedForLeaderboard(player.wins, player.total_games));

      const rankComparator = (a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
        return b.total_games - a.total_games;
      };

      rankedStats.sort(rankComparator);

      if (rankedStats.length === 0 && stats.length > 0) {
        rankedStats = stats.slice().sort(rankComparator);
      }

      return rankedStats.slice(0, 10);
    } catch (error) {
      console.error("Error getting player stats with losses:", error);
      throw error;
    }
  }

  async getMonthlyPlayerStatsWithLosses(groupId, maxResults = 10, monthName = null) {
    const client = await this.pool.connect();
    try {
      const monthSelection = monthName ? this.parseMonthSelection(monthName) : null;
      if (monthName && !monthSelection) {
        throw new Error(`Invalid month selection: ${monthName}`);
      }

      const monthStart = this.getPHMonthStartUtcExpression();
      const monthRangeParams = monthSelection
        ? [groupId, monthSelection.startUtc.toISOString(), monthSelection.endUtc.toISOString()]
        : [groupId];

      const monthFilterClause = monthSelection
        ? 'AND bgs.created_at >= $2 AND bgs.created_at < $3'
        : `AND bgs.created_at >= ${monthStart}`;

      const totalGamesQuery = `
        SELECT 
          bgp.user_id,
          COUNT(DISTINCT bgs.id) as total_games
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE bgs.group_id = $1
          ${monthFilterClause}
          AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
        GROUP BY bgp.user_id
      `;
      const totalGamesResult = await client.query(totalGamesQuery, monthRangeParams);
      const totalGamesMap = new Map(
        totalGamesResult.rows.map(row => [String(row.user_id), row.total_games])
      );

      const winsQuery = `
        SELECT 
          gw.user_id,
          COUNT(DISTINCT gw.session_id) as wins
        FROM winners gw
        JOIN games bgs ON gw.session_id = bgs.id
        WHERE bgs.group_id = $1
          ${monthFilterClause}
        GROUP BY gw.user_id
      `;
      const winsResult = await client.query(winsQuery, monthRangeParams);
      const winsMap = new Map(
        winsResult.rows.map(row => [String(row.user_id), row.wins])
      );

      const gamesPerDayMap = await this.getPlayerGamesPerDay(groupId);
      const streaksMap = await this.getPlayerStreaks(groupId, monthSelection ? { start: monthSelection.startUtc.toISOString(), end: monthSelection.endUtc.toISOString() } : monthStart);

      const usersQuery = `
        SELECT DISTINCT ON (bgp.user_id)
          bgp.user_id AS telegram_id,
          u.username,
          u.first_name,
          u.last_name,
          u.profile_photo_url AS profilePhotoUrl,
          u.is_celebration AS is_celebration
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        LEFT JOIN users u ON u.telegram_id = bgp.user_id
        WHERE bgs.group_id = $1
          ${monthFilterClause}
          AND ((u.first_name IS NOT NULL AND TRIM(u.first_name) != '')
               OR (u.username IS NOT NULL AND TRIM(u.username) != ''))
        ORDER BY bgp.user_id
      `;
      const usersResult = await client.query(usersQuery, monthRangeParams);

      const stats = usersResult.rows.map(user => {
        const userId = String(user.telegram_id);
        const wins = Number(winsMap.get(userId) || 0);
        const totalGames = Number(totalGamesMap.get(userId) || 0);
        const losses = totalGames - wins;
        const winRate = totalGames > 0 ? wins / totalGames : 0;
        const score = totalGames > 0 ? this.calculateMonthlyRankingScore(wins, totalGames) : 0;
        const streak = Number(streaksMap.get(userId) || 0);

        return {
          user_id: userId,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          profilePhotoUrl: user.profilephotourl,
          is_celebration: user.is_celebration || null,
          wins: wins,
          losses: Math.max(0, losses),
          total_games: totalGames,
          win_rate: winRate,
          win_rate_percent: totalGames > 0 ? Math.round(winRate * 100) : 0,
          games_per_day: gamesPerDayMap.get(userId) || 0,
          score: score,
          streak: streak,
        };
      });

      let rankedStats = stats.filter((player) => this.isQualifiedForLeaderboard(player.wins, player.total_games));

      const rankComparator = (a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
        return b.total_games - a.total_games;
      };

      rankedStats.sort(rankComparator);

      if (rankedStats.length === 0 && stats.length > 0) {
        rankedStats = stats.slice().sort((a, b) => {
          if (b.total_games !== a.total_games) return b.total_games - a.total_games;
          if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
          if (b.wins !== a.wins) return b.wins - a.wins;
          return 0;
        });
      }

      return typeof maxResults === 'number' && maxResults > 0
        ? rankedStats.slice(0, maxResults)
        : rankedStats;
    } catch (error) {
      console.error("Error getting monthly player stats with losses:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getMonthlyPlayersWithNoWins(groupId, monthName = null) {
    const client = await this.pool.connect();
    try {
      const monthSelection = monthName ? this.parseMonthSelection(monthName) : null;
      if (monthName && !monthSelection) {
        throw new Error(`Invalid month selection: ${monthName}`);
      }

      const monthStart = this.getPHMonthStartUtcExpression();
      const monthRangeParams = monthSelection
        ? [groupId, monthSelection.startUtc.toISOString(), monthSelection.endUtc.toISOString()]
        : [groupId];

      const monthFilterClause = monthSelection
        ? 'AND bgs.created_at >= $2 AND bgs.created_at < $3'
        : `AND bgs.created_at >= ${monthStart}`;

      const totalGamesQuery = `
        SELECT 
          bgp.user_id,
          COUNT(DISTINCT bgs.id) as total_games
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE bgs.group_id = $1
          ${monthFilterClause}
          AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
        GROUP BY bgp.user_id
      `;
      const totalGamesResult = await client.query(totalGamesQuery, monthRangeParams);
      const totalGamesMap = new Map(
        totalGamesResult.rows.map(row => [String(row.user_id), Number(row.total_games)])
      );

      const winsQuery = `
        SELECT 
          gw.user_id,
          COUNT(DISTINCT gw.session_id) as wins
        FROM winners gw
        JOIN games bgs ON gw.session_id = bgs.id
        WHERE bgs.group_id = $1
          ${monthFilterClause}
        GROUP BY gw.user_id
      `;
      const winsResult = await client.query(winsQuery, monthRangeParams);
      const winsMap = new Map(
        winsResult.rows.map(row => [String(row.user_id), Number(row.wins)])
      );

      const usersQuery = `
        SELECT DISTINCT ON (bgp.user_id)
          bgp.user_id AS telegram_id,
          u.username,
          u.first_name,
          u.last_name,
          u.profile_photo_url AS profilePhotoUrl,
          u.is_celebration AS is_celebration
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        LEFT JOIN users u ON u.telegram_id = bgp.user_id
        WHERE bgs.group_id = $1
          ${monthFilterClause}
          AND ((u.first_name IS NOT NULL AND TRIM(u.first_name) != '')
               OR (u.username IS NOT NULL AND TRIM(u.username) != ''))
        ORDER BY bgp.user_id
      `;
      const usersResult = await client.query(usersQuery, monthRangeParams);

      const stats = usersResult.rows.map(user => {
        const userId = String(user.telegram_id);
        const wins = Number(winsMap.get(userId) || 0);
        const totalGames = Number(totalGamesMap.get(userId) || 0);

        return {
          user_id: userId,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          profilePhotoUrl: user.profilephotourl,
          is_celebration: user.is_celebration || null,
          wins,
          total_games: totalGames,
        };
      });

      const noWins = stats
        .filter((player) => player.total_games > 0 && player.wins === 0)
        .sort((a, b) => {
          if (b.total_games !== a.total_games) return b.total_games - a.total_games;
          const aName = String(a.first_name || a.username || "");
          const bName = String(b.first_name || b.username || "");
          return aName.localeCompare(bName);
        });

      return noWins;
    } catch (error) {
      console.error("Error getting monthly players with no wins:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getMonthlyTopAttendance(groupId, maxResults = 5, monthName = null) {
    const client = await this.pool.connect();
    try {
      const monthSelection = monthName ? this.parseMonthSelection(monthName) : null;
      if (monthName && !monthSelection) {
        throw new Error(`Invalid month selection: ${monthName}`);
      }

      const monthStart = this.getPHMonthStartUtcExpression();
      const monthRangeParams = monthSelection
        ? [groupId, monthSelection.startUtc.toISOString(), monthSelection.endUtc.toISOString()]
        : [groupId];

      const monthFilterClause = monthSelection
        ? 'AND bgs.created_at >= $2 AND bgs.created_at < $3'
        : `AND bgs.created_at >= ${monthStart}`;

      // Get total games count for the month
      const totalGamesQuery = monthSelection
        ? `
            SELECT COUNT(DISTINCT bgs.id) AS total_games
            FROM games bgs
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
          `
        : `
            SELECT COUNT(DISTINCT bgs.id) AS total_games
            FROM games bgs
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
          `;
      const totalGamesResult = await client.query(totalGamesQuery, monthRangeParams);
      const totalGamesCount = Number(totalGamesResult.rows[0]?.total_games || 0);

      // Get games participated per player
      const attendanceQuery = monthSelection
        ? `
            SELECT 
              bgp.user_id,
              COUNT(DISTINCT bgs.id) as games_participated
            FROM game_players bgp
            JOIN games bgs ON bgp.session_id = bgs.id
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
            GROUP BY bgp.user_id
          `
        : `
            SELECT 
              bgp.user_id,
              COUNT(DISTINCT bgs.id) as games_participated
            FROM game_players bgp
            JOIN games bgs ON bgp.session_id = bgs.id
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
            GROUP BY bgp.user_id
          `;
      const attendanceResult = await client.query(attendanceQuery, monthRangeParams);

      // Get user info
      const usersQuery = monthSelection
        ? `
            SELECT DISTINCT ON (bgp.user_id)
              bgp.user_id AS telegram_id,
              u.username,
              u.first_name,
              u.last_name,
              u.profile_photo_url AS profilePhotoUrl,
              u.is_celebration AS is_celebration
            FROM game_players bgp
            JOIN games bgs ON bgp.session_id = bgs.id
            LEFT JOIN users u ON u.telegram_id = bgp.user_id
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              AND ((u.first_name IS NOT NULL AND TRIM(u.first_name) != '')
                   OR (u.username IS NOT NULL AND TRIM(u.username) != ''))
            ORDER BY bgp.user_id
          `
        : `
            SELECT DISTINCT ON (bgp.user_id)
              bgp.user_id AS telegram_id,
              u.username,
              u.first_name,
              u.last_name,
              u.profile_photo_url AS profilePhotoUrl,
              u.is_celebration AS is_celebration
            FROM game_players bgp
            JOIN games bgs ON bgp.session_id = bgs.id
            LEFT JOIN users u ON u.telegram_id = bgp.user_id
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              AND ((u.first_name IS NOT NULL AND TRIM(u.first_name) != '')
                   OR (u.username IS NOT NULL AND TRIM(u.username) != ''))
            ORDER BY bgp.user_id
          `;
      const usersResult = await client.query(usersQuery, monthRangeParams);

      // Create attendance map
      const attendanceMap = new Map(
        attendanceResult.rows.map(row => [String(row.user_id), row.games_participated])
      );

      // Combine data
      const stats = usersResult.rows.map(user => {
        const userId = String(user.telegram_id);
        const gamesParticipated = Number(attendanceMap.get(userId) || 0);

        return {
          user_id: userId,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          profilePhotoUrl: user.profilephotourl,
          is_celebration: user.is_celebration || null,
          games_participated: gamesParticipated,
          total_games: totalGamesCount,
          attendance_ratio: `${gamesParticipated}/${totalGamesCount}`
        };
      });

      // Sort by games participated (descending)
      const sorted = stats.sort((a, b) => b.games_participated - a.games_participated);
      
      return typeof maxResults === 'number' && maxResults > 0
        ? sorted.slice(0, maxResults)
        : sorted;
    } catch (error) {
      console.error("Error getting monthly top attendance:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getMonthlyGameTimeStats(groupId, monthName = null) {
    const client = await this.pool.connect();
    try {
      const monthSelection = monthName ? this.parseMonthSelection(monthName) : null;
      if (monthName && !monthSelection) {
        throw new Error(`Invalid month selection: ${monthName}`);
      }

      const monthStart = this.getPHMonthStartUtcExpression();
      const monthRangeParams = monthSelection
        ? [groupId, monthSelection.startUtc.toISOString(), monthSelection.endUtc.toISOString()]
        : [groupId];

      const monthFilterClause = monthSelection
        ? 'AND bgs.created_at >= $2 AND bgs.created_at < $3'
        : `AND bgs.created_at >= ${monthStart}`;

      // Get games with valid winners, duration, and at least 15 balls drawn
      const gamesQuery = monthSelection
        ? `
            SELECT 
              bgs.id,
              bgs.started_at,
              bgs.ended_at,
              EXTRACT(EPOCH FROM (bgs.ended_at - bgs.started_at)) as duration_seconds,
              COALESCE(SUM(jsonb_array_length(ge.session_data->'draws')), 0) as balls_drawn
            FROM games bgs
            LEFT JOIN game_events ge ON bgs.group_id::text = ge.group_id
              AND ge.event_type = 'GAME_DRAW'
              AND ge.timestamp >= bgs.started_at
              AND ge.timestamp <= COALESCE(bgs.ended_at, NOW())
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
              AND bgs.started_at IS NOT NULL
              AND bgs.ended_at IS NOT NULL
            GROUP BY bgs.id, bgs.started_at, bgs.ended_at
            HAVING COALESCE(SUM(jsonb_array_length(ge.session_data->'draws')), 0) >= 15
          `
        : `
            SELECT 
              bgs.id,
              bgs.started_at,
              bgs.ended_at,
              EXTRACT(EPOCH FROM (bgs.ended_at - bgs.started_at)) as duration_seconds,
              COALESCE(SUM(jsonb_array_length(ge.session_data->'draws')), 0) as balls_drawn
            FROM games bgs
            LEFT JOIN game_events ge ON bgs.group_id::text = ge.group_id
              AND ge.event_type = 'GAME_DRAW'
              AND ge.timestamp >= bgs.started_at
              AND ge.timestamp <= COALESCE(bgs.ended_at, NOW())
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
              AND bgs.started_at IS NOT NULL
              AND bgs.ended_at IS NOT NULL
            GROUP BY bgs.id, bgs.started_at, bgs.ended_at
            HAVING COALESCE(SUM(jsonb_array_length(ge.session_data->'draws')), 0) >= 15
          `;
      const gamesResult = await client.query(gamesQuery, monthRangeParams);

      const gamesWithDuration = gamesResult.rows
        .filter(row => row.duration_seconds && row.duration_seconds > 0 && row.duration_seconds < 86400) // Filter out unrealistically long games (>24 hours)
        .map(row => ({
          id: row.id,
          started_at: row.started_at,
          ended_at: row.ended_at,
          duration_seconds: Number(row.duration_seconds),
          balls_drawn: Number(row.balls_drawn)
        }));

      if (gamesWithDuration.length === 0) {
        return {
          longest_game: null,
          fastest_game: null
        };
      }

      // Sort by duration (descending for longest, ascending for fastest)
      const sortedByDuration = [...gamesWithDuration].sort((a, b) => b.duration_seconds - a.duration_seconds);
      const longestGame = sortedByDuration[0];
      const fastestGame = sortedByDuration[sortedByDuration.length - 1];

      return {
        longest_game: {
          duration_seconds: longestGame.duration_seconds,
          duration_formatted: this.formatDuration(longestGame.duration_seconds),
          game_id: longestGame.id,
          balls_drawn: longestGame.balls_drawn
        },
        fastest_game: {
          duration_seconds: fastestGame.duration_seconds,
          duration_formatted: this.formatDuration(fastestGame.duration_seconds),
          game_id: fastestGame.id,
          balls_drawn: fastestGame.balls_drawn
        }
      };
    } catch (error) {
      console.error("Error getting monthly game time stats:", error);
      return {
        longest_game: null,
        fastest_game: null
      };
    } finally {
      client.release();
    }
  }

  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return "0s";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.round(seconds % 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  async getMonthlyTimeBasedWinners(groupId, timePeriod, maxResults = 3, monthName = null) {
    const client = await this.pool.connect();
    try {
      const monthSelection = monthName ? this.parseMonthSelection(monthName) : null;
      if (monthName && !monthSelection) {
        throw new Error(`Invalid month selection: ${monthName}`);
      }

      const monthStart = this.getPHMonthStartUtcExpression();
      const monthRangeParams = monthSelection
        ? [groupId, monthSelection.startUtc.toISOString(), monthSelection.endUtc.toISOString()]
        : [groupId];

      const monthFilterClause = monthSelection
        ? 'AND bgs.created_at >= $2 AND bgs.created_at < $3'
        : `AND bgs.created_at >= ${monthStart}`;

      // Define time periods in PH timezone (Asia/Manila)
      // Midnight: 0:00 - 6:00, Morning: 6:00 - 12:00, Afternoon: 12:00 - 18:00, Evening: 18:00 - 24:00
      let timeFilterClause = '';
      const periodHours = {
        midnight: { start: 0, end: 6 },
        morning: { start: 6, end: 12 },
        afternoon: { start: 12, end: 18 },
        evening: { start: 18, end: 24 }
      };

      const hours = periodHours[timePeriod.toLowerCase()];
      if (!hours) {
        throw new Error(`Invalid time period: ${timePeriod}. Use 'midnight', 'morning', 'afternoon', or 'evening'`);
      }

      timeFilterClause = `AND EXTRACT(HOUR FROM bgs.created_at AT TIME ZONE 'Asia/Manila') >= ${hours.start} AND EXTRACT(HOUR FROM bgs.created_at AT TIME ZONE 'Asia/Manila') < ${hours.end}`;

      // Get wins per player for the time period
      const winsQuery = monthSelection
        ? `
            SELECT 
              gw.user_id,
              COUNT(DISTINCT gw.session_id) as wins
            FROM winners gw
            JOIN games bgs ON gw.session_id = bgs.id
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              ${timeFilterClause}
            GROUP BY gw.user_id
          `
        : `
            SELECT 
              gw.user_id,
              COUNT(DISTINCT gw.session_id) as wins
            FROM winners gw
            JOIN games bgs ON gw.session_id = bgs.id
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              ${timeFilterClause}
            GROUP BY gw.user_id
          `;
      const winsResult = await client.query(winsQuery, monthRangeParams);
      const winsMap = new Map(
        winsResult.rows.map(row => [String(row.user_id), row.wins])
      );

      // Get user info for winners
      const usersQuery = monthSelection
        ? `
            SELECT DISTINCT ON (bgp.user_id)
              bgp.user_id AS telegram_id,
              u.username,
              u.first_name,
              u.last_name,
              u.profile_photo_url AS profilePhotoUrl,
              u.is_celebration AS is_celebration
            FROM game_players bgp
            JOIN games bgs ON bgp.session_id = bgs.id
            LEFT JOIN users u ON u.telegram_id = bgp.user_id
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              ${timeFilterClause}
              AND ((u.first_name IS NOT NULL AND TRIM(u.first_name) != '')
                   OR (u.username IS NOT NULL AND TRIM(u.username) != ''))
            ORDER BY bgp.user_id
          `
        : `
            SELECT DISTINCT ON (bgp.user_id)
              bgp.user_id AS telegram_id,
              u.username,
              u.first_name,
              u.last_name,
              u.profile_photo_url AS profilePhotoUrl,
              u.is_celebration AS is_celebration
            FROM game_players bgp
            JOIN games bgs ON bgp.session_id = bgs.id
            LEFT JOIN users u ON u.telegram_id = bgp.user_id
            WHERE bgs.group_id = $1
              ${monthFilterClause}
              ${timeFilterClause}
              AND ((u.first_name IS NOT NULL AND TRIM(u.first_name) != '')
                   OR (u.username IS NOT NULL AND TRIM(u.username) != ''))
            ORDER BY bgp.user_id
          `;
      const usersResult = await client.query(usersQuery, monthRangeParams);

      // Combine data
      const stats = usersResult.rows.map(user => {
        const userId = String(user.telegram_id);
        const wins = Number(winsMap.get(userId) || 0);

        return {
          user_id: userId,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          profilePhotoUrl: user.profilephotourl,
          is_celebration: user.is_celebration || null,
          wins: wins
        };
      });

      // Filter out players with 0 wins and sort by wins (descending)
      const sorted = stats
        .filter(player => player.wins > 0)
        .sort((a, b) => b.wins - a.wins);
      
      return typeof maxResults === 'number' && maxResults > 0
        ? sorted.slice(0, maxResults)
        : sorted;
    } catch (error) {
      console.error(`Error getting monthly ${timePeriod} winners:`, error);
      return [];
    } finally {
      client.release();
    }
  }

  async getGlobalPlayerStatsWithLosses() {
    const client = await this.pool.connect();
    try {
      // Get total games per player globally - only count games that had winners
      const totalGamesQuery = `
        SELECT 
          bgp.user_id,
          COUNT(DISTINCT bgs.id) as total_games
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
        GROUP BY bgp.user_id
      `;
      const totalGamesResult = await client.query(totalGamesQuery);
      const totalGamesMap = new Map(
        totalGamesResult.rows.map(row => [String(row.user_id), row.total_games])
      );

      // Get wins per player globally
      const winsQuery = `
        SELECT 
          gw.user_id,
          COUNT(DISTINCT gw.session_id) as wins
        FROM winners gw
        JOIN games bgs ON gw.session_id = bgs.id
        GROUP BY gw.user_id
      `;
      const winsResult = await client.query(winsQuery);
      const winsMap = new Map(
        winsResult.rows.map(row => [String(row.user_id), row.wins])
      );

      // Get games per day (last 24 hours) globally
      const gamesPerDayMap = await this.getGlobalPlayerGamesPerDay();
      const streaksMap = await this.getPlayerStreaks();

      // Get user info - use LEFT JOIN to include players even if they're not in users table
      // Filter out users with no name (no first_name and no username)
      const usersQuery = `
        SELECT DISTINCT ON (bgp.user_id)
          bgp.user_id AS telegram_id,
          u.username,
          u.first_name,
          u.last_name,
          u.profile_photo_url AS profilePhotoUrl,
          u.is_celebration AS is_celebration
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        LEFT JOIN users u ON u.telegram_id = bgp.user_id
        WHERE (u.first_name IS NOT NULL AND TRIM(u.first_name) != '')
           OR (u.username IS NOT NULL AND TRIM(u.username) != '')
        ORDER BY bgp.user_id
      `;
      const usersResult = await client.query(usersQuery);

      // Combine data
      const stats = usersResult.rows.map((user) => {
        const userId = String(user.telegram_id);
        const wins = Number(winsMap.get(userId) || 0);
        const totalGames = Number(totalGamesMap.get(userId) || 0);
        const losses = totalGames - wins;
        const gamesPerDay = Number(gamesPerDayMap.get(userId) || 0);
        const streak = Number(streaksMap.get(userId) || 0);

        const winRate = totalGames > 0 ? wins / totalGames : 0;
        const score = totalGames > 0 ? this.calculateMonthlyRankingScore(wins, totalGames) : 0;

        return {
          user_id: userId,
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          profilePhotoUrl: user.profilephotourl,
          is_celebration: user.is_celebration || null,
          wins: wins,
          losses: Math.max(0, losses),
          total_games: totalGames,
          win_rate: winRate,
          win_rate_percent: totalGames > 0 ? Math.round(winRate * 100) : 0,
          games_per_day: gamesPerDay,
          streak: streak,
          score: score,
        };
      });

      let rankedStats = stats.filter((player) => this.isQualifiedForLeaderboard(player.wins, player.total_games));

      const rankComparator = (a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
        return b.total_games - a.total_games;
      };

      rankedStats.sort(rankComparator);

      if (rankedStats.length === 0 && stats.length > 0) {
        rankedStats = stats.slice().sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.win_rate !== a.win_rate) return b.win_rate - a.win_rate;
          return b.total_games - a.total_games;
        });
      }

      return rankedStats;
    } catch (error) {
      console.error("Error getting global player stats with losses:", error);
      throw error;
    }
  }

  async getGlobalPlayerGamesPerDay() {
    const client = await this.pool.connect();
    try {
      const dayStartUtc = this.getPHDayStartUtcExpression();
      const query = `
        SELECT 
          bgp.user_id,
          COUNT(DISTINCT bgs.id) as games_count
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE bgs.created_at >= ${dayStartUtc}
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
        GROUP BY bgp.user_id
      `;
      const result = await client.query(query);
      return new Map(
        result.rows.map(row => [String(row.user_id), row.games_count])
      );
    } catch (error) {
      console.error("Error getting global player games per day:", error);
      return new Map();
    } finally {
      client.release();
    }
  }

  async getPlayerStreak(userId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT 
          bgs.id,
          bgs.created_at,
          EXISTS (
            SELECT 1 FROM winners gw 
            WHERE gw.session_id = bgs.id AND gw.user_id = $1
          ) as is_win
        FROM game_players bgp
        JOIN games bgs ON bgp.session_id = bgs.id
        WHERE bgp.user_id = $1
          AND EXISTS (SELECT 1 FROM winners gw WHERE gw.session_id = bgs.id)
        ORDER BY bgs.created_at DESC
      `;
      const result = await client.query(query, [userId]);

      if (result.rows.length === 0) return 0;

      return this.calculateStreakFromResults(result.rows.map((row) => ({ is_win: row.is_win === true })));
    } catch (error) {
      console.error("Error getting player streak:", error);
      return 0;
    } finally {
      client.release();
    }
  }
}

module.exports = GameWinner;
