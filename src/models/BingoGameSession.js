const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../utils/databaseConfig");

class BingoGameSession {
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
        CREATE TABLE IF NOT EXISTS games (
          id SERIAL PRIMARY KEY,
          group_id BIGINT NOT NULL,
          starter_id BIGINT NOT NULL,
          status VARCHAR(20) DEFAULT 'waiting',
          pattern JSONB,
          pattern_count INTEGER DEFAULT 0,
          bet_per_player INTEGER DEFAULT 5,
          player_list_message_id BIGINT,
          started_at TIMESTAMP,
          ended_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_games_group_id ON games(group_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
      `);

      // Add pattern_count column if it doesn't exist (migration)
      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS pattern_count INTEGER DEFAULT 0;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS bet_per_player INTEGER DEFAULT 5;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS player_list_message_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS player_list_chat_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS is_sponsored BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS is_raid BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS sponsor_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS sponsor_name VARCHAR(255);
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS channel_hyperlink_message_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS channel_hyperlink_chat_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS start_command_message_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS start_command_chat_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS force_command_message_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS force_command_chat_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS pattern_selector_message_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS pattern_selector_chat_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS sponsor_amount INTEGER;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS sponsor_funding_type VARCHAR(50);
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS admin_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS banned_players JSONB DEFAULT '[]';
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE games
          ADD COLUMN IF NOT EXISTS player_list_gif_url TEXT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

    } catch (error) {
      console.error("Error initializing bingo game sessions table:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async create(groupId, starterId, pattern, betPerPlayer = 5, adminId = null) {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO games (group_id, starter_id, pattern, status, bet_per_player, is_free, is_raid, admin_id)
        VALUES ($1, $2, $3, 'waiting', $4, FALSE, FALSE, $5)
        RETURNING *;
      `;
      const result = await client.query(query, [groupId, starterId, pattern, betPerPlayer, adminId]);
      return result.rows[0];
    } catch (error) {
      console.error("Error creating bingo game session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async createFree(groupId, starterId, pattern, adminId = null, isRaid = false) {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO games (group_id, starter_id, pattern, status, bet_per_player, is_free, is_raid, admin_id)
        VALUES ($1, $2, $3, 'waiting', 0, TRUE, $4, $5)
        RETURNING *;
      `;
      const result = await client.query(query, [groupId, starterId, pattern, isRaid, adminId]);
      return result.rows[0];
    } catch (error) {
      console.error("Error creating free bingo game session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async createSponsored(groupId, starterId, pattern, sponsorId, sponsorName, sponsorAmount, sponsorFundingType, adminId = null) {
    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO games (group_id, starter_id, pattern, status, bet_per_player, is_sponsored, is_free, is_raid, sponsor_id, sponsor_name, sponsor_amount, sponsor_funding_type, admin_id)
        VALUES ($1, $2, $3, 'waiting', 0, TRUE, FALSE, FALSE, $4, $5, $6, $7, $8)
        RETURNING *;
      `;
      const result = await client.query(query, [groupId, starterId, pattern, sponsorId, sponsorName, sponsorAmount, sponsorFundingType, adminId]);
      return result.rows[0];
    } catch (error) {
      console.error("Error creating sponsored bingo game session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async findByGroupId(groupId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM games 
        WHERE group_id = $1 AND status IN ('waiting', 'active')
        ORDER BY created_at DESC 
        LIMIT 1;
      `;
      const result = await client.query(query, [groupId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error finding bingo game session by group ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async findLastEndedSession(groupId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM games
        WHERE group_id = $1 AND status = 'ended'
        ORDER BY ended_at DESC NULLS LAST, created_at DESC
        LIMIT 1;
      `;
      const result = await client.query(query, [groupId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error finding last ended bingo session:", error);
      return null;
    } finally {
      client.release();
    }
  }

  async findById(sessionId) {
    const client = await this.pool.connect();
    try {
      const query = "SELECT * FROM games WHERE id = $1";
      const result = await client.query(query, [sessionId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error finding bingo game session by ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async start(sessionId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE games 
        SET status = 'active', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
      `;
      const result = await client.query(query, [sessionId]);
      return result.rows[0];
    } catch (error) {
      console.error("Error starting bingo game session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async end(sessionId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE games 
        SET status = 'ended', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
      `;
      const result = await client.query(query, [sessionId]);
      return result.rows[0];
    } catch (error) {
      console.error("Error ending bingo game session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(sessionId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE games 
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *;
      `;
      const result = await client.query(query, [sessionId]);
      return result.rows[0];
    } catch (error) {
      console.error("Error cancelling bingo game session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setPatternCount(sessionId, patternCount) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE games 
        SET pattern_count = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *;
      `;
      const result = await client.query(query, [patternCount, sessionId]);
      return result.rows[0];
    } catch (error) {
      console.error("Error setting pattern count:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setPlayerListMessageId(sessionId, messageId, chatId = null, gifUrl = null) {
    const client = await this.pool.connect();
    try {
      if (chatId) {
        const query = `
          UPDATE games
          SET player_list_message_id = $1, player_list_chat_id = $2, player_list_gif_url = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $4
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, chatId, gifUrl, sessionId]);
        return result.rows[0];
      } else {
        const query = `
          UPDATE games
          SET player_list_message_id = $1, player_list_gif_url = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, gifUrl, sessionId]);
        return result.rows[0];
      }
    } catch (error) {
      console.error("Error setting player list message ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setChannelHyperlinkMessageId(sessionId, messageId, chatId = null) {
    const client = await this.pool.connect();
    try {
      if (chatId) {
        const query = `
          UPDATE games
          SET channel_hyperlink_message_id = $1, channel_hyperlink_chat_id = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, chatId, sessionId]);
        return result.rows[0];
      } else {
        const query = `
          UPDATE games
          SET channel_hyperlink_message_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, sessionId]);
        return result.rows[0];
      }
    } catch (error) {
      console.error("Error setting channel hyperlink message ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setStartCommandMessageId(sessionId, messageId, chatId = null) {
    const client = await this.pool.connect();
    try {
      if (chatId) {
        const query = `
          UPDATE games
          SET start_command_message_id = $1, start_command_chat_id = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, chatId, sessionId]);
        return result.rows[0];
      } else {
        const query = `
          UPDATE games
          SET start_command_message_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, sessionId]);
        return result.rows[0];
      }
    } catch (error) {
      console.error("Error setting start command message ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setForceCommandMessageId(sessionId, messageId, chatId = null) {
    const client = await this.pool.connect();
    try {
      if (chatId) {
        const query = `
          UPDATE games
          SET force_command_message_id = $1, force_command_chat_id = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, chatId, sessionId]);
        return result.rows[0];
      } else {
        const query = `
          UPDATE games
          SET force_command_message_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, sessionId]);
        return result.rows[0];
      }
    } catch (error) {
      console.error("Error setting force command message ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setPatternSelectorMessageId(sessionId, messageId, chatId = null) {
    const client = await this.pool.connect();
    try {
      if (chatId) {
        const query = `
          UPDATE games
          SET pattern_selector_message_id = $1, pattern_selector_chat_id = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, chatId, sessionId]);
        return result.rows[0];
      } else {
        const query = `
          UPDATE games
          SET pattern_selector_message_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *;
        `;
        const result = await client.query(query, [messageId, sessionId]);
        return result.rows[0];
      }
    } catch (error) {
      console.error("Error setting pattern selector message ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteByGroupId(groupId) {
    const client = await this.pool.connect();
    try {
      const query = `
        DELETE FROM games 
        WHERE group_id = $1 AND status = 'waiting'
        RETURNING *;
      `;
      const result = await client.query(query, [groupId]);
      return result.rowCount > 0;
    } catch (error) {
      console.error("Error deleting bingo game session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getActiveSessions() {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM games 
        WHERE status = 'active'
        ORDER BY created_at ASC;
      `;
      const result = await client.query(query);
      return result.rows;
    } catch (error) {
      console.error("Error getting active bingo game sessions:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async addBannedPlayer(sessionId, targetUserId, bannerUserId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE games
        SET banned_players = banned_players || jsonb_build_object(
          'user_id', $1,
          'banner_id', $2,
          'banned_at', CURRENT_TIMESTAMP
        ),
        updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *;
      `;
      const result = await client.query(query, [targetUserId, bannerUserId, sessionId]);
      return result.rows[0];
    } catch (error) {
      console.error("Error adding banned player:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async isPlayerBanned(sessionId, userId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT EXISTS(
          SELECT 1 FROM games
          WHERE id = $1
          AND banned_players @> jsonb_build_object('user_id', $2::text)
        ) as is_banned;
      `;
      const result = await client.query(query, [sessionId, userId]);
      return result.rows[0]?.is_banned || false;
    } catch (error) {
      console.error("Error checking if player is banned:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getBanCountForPlayer(sessionId, userId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT (
          SELECT COUNT(*)
          FROM jsonb_array_elements(banned_players) AS ban
          WHERE ban->>'user_id' = $2::text
        ) as ban_count
        FROM games
        WHERE id = $1;
      `;
      const result = await client.query(query, [sessionId, userId]);
      return result.rows[0]?.ban_count || 0;
    } catch (error) {
      console.error("Error getting ban count for player:", error);
      return 0;
    } finally {
      client.release();
    }
  }
}

module.exports = BingoGameSession;
