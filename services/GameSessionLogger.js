const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../src/utils/databaseConfig");

class GameSessionLogger {
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

    // Enable SSL for cloud databases (typically needed in production/Northflank)
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

  async initDatabase() {
    const client = await this.pool.connect();
    try {
      // Create table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS game_events (
          id SERIAL PRIMARY KEY,
          chat_id BIGINT NOT NULL,
          group_id TEXT,
          user_id BIGINT,
          username TEXT,
          event_type VARCHAR(50) NOT NULL,
          session_data JSONB,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create index for faster lookups
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_game_events_chat_id ON game_events(chat_id);
      `);

      console.log("Game events database initialized");
    } catch (error) {
      console.error("Error initializing game sessions database:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async logGameSession(sessionData) {
    const client = await this.pool.connect();
    try {
      // Insert game session log
      const query = `
        INSERT INTO game_events (chat_id, group_id, user_id, username, event_type, session_data)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id;
      `;

      const values = [
        sessionData.chatId,
        sessionData.groupId || null,
        sessionData.userId || null,
        sessionData.username || null,
        sessionData.eventType,
        JSON.stringify(sessionData.data),
      ];

      const result = await client.query(query, values);
      console.log(
        `Game session logged: ID ${result.rows[0].id}, Event: ${sessionData.eventType}`,
      );
      return result.rows[0].id;
    } catch (error) {
      console.error("Error logging game session:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Helper function to extract group ID from chat context
  extractGroupId(ctx) {
    // For groups and supergroups, use chat.id as the primary identifier
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      return ctx.chat.id.toString();
    }

    // For channels, use chat.id
    if (ctx.chat.type === "channel") {
      return ctx.chat.id.toString();
    }

    // For private chats, use chat.id
    if (ctx.chat.type === "private") {
      return ctx.chat.id.toString();
    }

    // Fallback to chat.id for any other type
    return ctx.chat.id.toString();
  }

  async logGameStart(ctx, gameData) {
    const sessionData = {
      chatId: ctx.chat.id,
      groupId: this.extractGroupId(ctx),
      userId: ctx.from?.id,
      username: ctx.from?.username,
      eventType: "GAME_START",
      data: {
        gameType: "BINGO",
        card: gameData.card,
        round: gameData.round,
        startTime: new Date().toISOString(),
        chatType: ctx.chat.type,
        chatTitle: ctx.chat.title || ctx.chat.first_name || "Private Chat",
      },
    };

    return await this.logGameSession(sessionData);
  }

  async logGameDraw(ctx, drawData) {
    const sessionData = {
      chatId: ctx.chat.id,
      groupId: this.extractGroupId(ctx),
      userId: ctx.from?.id,
      username: ctx.from?.username,
      eventType: "GAME_DRAW",
      data: {
        gameType: "BINGO",
        draws: drawData.draws,
        round: drawData.round,
        itemsRemaining: drawData.itemsRemaining,
        drawTime: new Date().toISOString(),
        chatType: ctx.chat.type,
      },
    };

    return await this.logGameSession(sessionData);
  }

  async logGameEnd(ctx, endData) {
    const sessionData = {
      chatId: ctx.chat.id,
      groupId: this.extractGroupId(ctx),
      userId: ctx.from?.id,
      username: ctx.from?.username,
      eventType: "GAME_END",
      data: {
        gameType: "BINGO",
        finalRound: endData.round,
        totalDraws: endData.totalDraws,
        selectedItems: endData.selectedItems,
        endTime: new Date().toISOString(),
        chatType: ctx.chat.type,
      },
    };

    return await this.logGameSession(sessionData);
  }

  async getGameHistory(chatId, limit = 10) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM game_events 
        WHERE chat_id = $1 
        ORDER BY timestamp DESC 
        LIMIT $2;
      `;

      const result = await client.query(query, [chatId, limit]);
      return result.rows;
    } catch (error) {
      console.error("Error fetching game history:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = GameSessionLogger;
