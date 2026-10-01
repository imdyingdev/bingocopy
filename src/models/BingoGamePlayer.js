const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../utils/databaseConfig");

class BingoGamePlayer {
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
        DO $$
        BEGIN
          IF to_regclass('players') IS NOT NULL AND to_regclass('game_players') IS NULL THEN
            ALTER TABLE players RENAME TO game_players;
          END IF;
        END $$;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS game_players (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          user_id BIGINT NOT NULL,
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          used_lep BOOLEAN DEFAULT FALSE,
          used_dpc BOOLEAN DEFAULT FALSE,
          used_dp BOOLEAN DEFAULT FALSE,
          UNIQUE(session_id, user_id)
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_game_players_session_id ON game_players(session_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_game_players_user_id ON game_players(user_id);
      `);

      // Migration: Add used_dp column if it doesn't exist
      try {
        await client.query(`
          ALTER TABLE game_players
          ADD COLUMN IF NOT EXISTS used_dp BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      console.log("Game players table initialized");

      // Add used_lep column if it doesn't exist (migration)
      try {
        await client.query(`
          ALTER TABLE game_players
          ADD COLUMN IF NOT EXISTS used_lep BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      // Add used_fp column if it doesn't exist (migration)
      try {
        await client.query(`
          ALTER TABLE game_players
          ADD COLUMN IF NOT EXISTS used_fp BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE game_players
          ADD COLUMN IF NOT EXISTS used_dpc BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

    } catch (error) {
      console.error("Error initializing bingo game players table:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async addPlayer(sessionId, userId, usedLEP = false, usedFP = false, usedDPC = false, usedDP = false) {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO game_players (session_id, user_id, used_lep, used_fp, used_dpc, used_dp)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (session_id, user_id) DO NOTHING
        RETURNING *;
      `;
      const result = await client.query(query, [sessionId, userId, usedLEP, usedFP, usedDPC, usedDP]);
      return result.rows[0];
    } catch (error) {
      console.error("Error adding player to session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getPlayersBySession(sessionId, themeId = null) {
    const client = await this.pool.connect();
    try {
      const requestedThemeId = themeId || "default";
      const query = `
         SELECT bgp.*, u.username, u.first_name, u.last_name,
           ucl.card_link
        FROM game_players bgp
        LEFT JOIN users u ON bgp.user_id = u.telegram_id
         LEFT JOIN user_card_links ucl
           ON ucl.user_id = bgp.user_id
           AND ucl.theme_id = $2
        WHERE bgp.session_id = $1
        ORDER BY lower(
          COALESCE(
            NULLIF(trim(u.first_name || ' ' || u.last_name), ''),
            NULLIF(trim(u.username), ''),
            bgp.user_id::text
          )
        );
      `;
      const result = await client.query(query, [sessionId, requestedThemeId]);
      return result.rows;
    } catch (error) {
      console.error("Error getting players by session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async removePlayer(sessionId, userId) {
    const client = await this.pool.connect();
    try {
      const query = `
        DELETE FROM game_players
        WHERE session_id = $1 AND user_id = $2;
      `;
      await client.query(query, [sessionId, userId]);
    } catch (error) {
      console.error("Error removing player from session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteBySession(sessionId) {
    const client = await this.pool.connect();
    try {
      const query = "DELETE FROM game_players WHERE session_id = $1;";
      await client.query(query, [sessionId]);
    } catch (error) {
      console.error("Error deleting players by session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async isPlayerInSession(sessionId, userId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM game_players
        WHERE session_id = $1 AND user_id = $2;
      `;
      const result = await client.query(query, [sessionId, userId]);
      return result.rows.length > 0;
    } catch (error) {
      console.error("Error checking if player is in session:", error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = BingoGamePlayer;
