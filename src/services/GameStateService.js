/**
 * Game state management service
 * Now supports database persistence so games survive bot restarts
 */

const { DATA } = require("../data/defaultData");
const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../utils/databaseConfig");

class GameStateService {
  constructor() {
    this.bingoGames = new Map(); // chatId -> { selected: Set, card: Array, round: Number, drawMessages: Array }
    this.patternConfigurationState = new Map(); // userId -> { groupId, step }
    this.spongebobMode = new Map(); // chatId -> boolean (SpongeBob theme enabled)
    this.minionMonsterMode = new Map(); // chatId -> boolean (temporary red Minions bola)
    this.themes = new Map(); // chatId -> themeId (e.g., "spongebob", "default")
    this.pool = null;
    this.dbReady = false;
  }

  /**
   * Initialize database connection and create tables if needed
   */
  async initDatabase() {
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

    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS game_state (
          id SERIAL PRIMARY KEY,
          chat_id BIGINT NOT NULL UNIQUE,
          game_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_game_state_chat_id ON game_state(chat_id);
      `);

      this.dbReady = true;
    } catch (error) {
      console.error("Error initializing game state database:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Load all active games from database into memory
   * Called on bot startup to restore games after restart
   */
  async restoreAllGames() {
    if (!this.dbReady || !this.pool) {
      console.log("Database not ready, skipping game restoration");
      return;
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT chat_id, game_data FROM game_state
        ORDER BY updated_at DESC;
      `);

      let restoredCount = 0;
      for (const row of result.rows) {
        const chatId = Number(row.chat_id);
        const gameRaw = row.game_data;

        // Deserialize: convert arrays back to Sets
        const game = {
          selected: new Set(gameRaw.selectedArray || []),
          card: gameRaw.card,
          round: gameRaw.round,
          drawOrder: gameRaw.drawOrder || [],
          drawMessages: gameRaw.drawMessages || [],
          sessionId: gameRaw.sessionId || null,
          itemQueryUsage: gameRaw.itemQueryUsage
            ? new Map(Object.entries(gameRaw.itemQueryUsage))
            : new Map(),
        };

        this.bingoGames.set(chatId, game);
        restoredCount++;
      }

      return restoredCount;
    } catch (error) {
      console.error("Error restoring games from database:", error);
    } finally {
      client.release();
    }
  }

  /**
   * Save game state to database (serializes Sets to arrays)
   */
  async saveGameState(chatId) {
    if (!this.dbReady || !this.pool) {
      return;
    }

    const game = this.bingoGames.get(chatId);
    if (!game) return;

    const client = await this.pool.connect();
    try {
      const gameData = {
        selectedArray: Array.from(game.selected),
        card: game.card,
        round: game.round,
        drawOrder: game.drawOrder || [],
        drawMessages: game.drawMessages || [],
        sessionId: game.sessionId || null,
        itemQueryUsage: Object.fromEntries(
          (game.itemQueryUsage instanceof Map ? game.itemQueryUsage : new Map(Object.entries(game.itemQueryUsage || {}))).entries()
        ),
      };

      await client.query(
        `
        INSERT INTO game_state (chat_id, game_data, updated_at)
        VALUES ($1, $2, CURRENT_TIMESTAMP)
        ON CONFLICT (chat_id)
        DO UPDATE SET
          game_data = EXCLUDED.game_data,
          updated_at = CURRENT_TIMESTAMP;
        `,
        [chatId, JSON.stringify(gameData)]
      );
    } catch (error) {
      console.error(`Error saving game state for chat ${chatId}:`, error);
    } finally {
      client.release();
    }
  }

  /**
   * Delete game state from database
   */
  async deleteGameState(chatId) {
    if (!this.dbReady || !this.pool) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query(
        `DELETE FROM game_state WHERE chat_id = $1;`,
        [chatId]
      );
    } catch (error) {
      console.error(`Error deleting game state for chat ${chatId}:`, error);
    } finally {
      client.release();
    }
  }


  /**
   * Get bingo game for a chat
   */
  getBingoGame(chatId) {
    return this.bingoGames.get(chatId);
  }

  /**
   * Set bingo game for a chat (auto-saves to DB)
   */
  setBingoGame(chatId, game) {
    this.bingoGames.set(chatId, game);
    // Fire-and-forget save to database
    this.saveGameState(chatId).catch(err =>
      console.error("Async save failed:", err)
    );
  }

  /**
   * Clear bingo game for a chat (removes from DB too)
   */
  clearBingoGame(chatId) {
    this.bingoGames.delete(chatId);
    // Fire-and-forget delete from database
    this.deleteGameState(chatId).catch(err =>
      console.error("Async delete failed:", err)
    );
  }

  /**
   * Mark game as dirty (needs re-save to DB) — called after each /bola draw
   */
  async markGameDirty(chatId) {
    await this.saveGameState(chatId);
  }

  /**
   * Generate a bingo card
   */
  generateBingoCard(pattern = null, patternOrder = null) {
    let data;
    if (pattern) {
      if (typeof pattern === "string") {
        data = JSON.parse(pattern);
      } else {
        data = pattern;
      }
    } else {
      data = DATA;
    }

    // Handle nested structure for BINGULO Beta
    const isNested = Object.keys(data).some(key => {
      const value = data[key];
      return typeof value === 'object' && !Array.isArray(value);
    });

    let flatData = data;
    let keys = patternOrder || Object.keys(data);

    if (isNested) {
      // Flatten nested structure for card generation
      flatData = {};
      keys = [];
      for (const theme of Object.keys(data)) {
        const themeData = data[theme];
        if (typeof themeData === 'object' && !Array.isArray(themeData)) {
          // This is a nested theme structure
          for (const category of Object.keys(themeData)) {
            // Use unique category names by prefixing with theme name to avoid merging
            const uniqueCategory = `${theme}_${category}`;
            flatData[uniqueCategory] = themeData[category];
            keys.push(uniqueCategory);
          }
        }
      }
    }

    const card = [];

    // A bingo card has at most 5 columns, each mapped to a DISTINCT category.
    // Previously this used `keys[col % keys.length]`, which wrapped around and
    // repeated a category (and all of its items) across multiple columns whenever
    // a pattern had fewer than 5 categories. Those duplicated cells could then be
    // drawn more than once ("drawn twice") and would desync from the `selected`
    // Set and the /listav2 card display (one duplicate cell stays unselected even
    // though the value was already drawn). Iterate over distinct categories so no
    // category — and no item — can appear on the card more than once.
    const columnCount = Math.min(5, keys.length);

    for (let col = 0; col < columnCount; col++) {
      const cat = keys[col];
      const source = flatData[cat];
      // Guard against a pattern_order key that has no matching data entry.
      if (!source) continue;

      // Strip theme prefix for display (e.g., "spongebob_S" -> "S")
      const displayCategory = cat.match(/^([a-z_]+)_([A-Z])$/) ? cat.match(/^([a-z_]+)_([A-Z])$/)[2] : cat;

      // Dedupe values within a category so a single value can't occupy two cells.
      const uniqueValues = [...new Set(source)];
      const allItems = uniqueValues.sort(() => Math.random() - 0.5);
      const items = allItems.map((val) => ({
        category: displayCategory,
        value: val,
        selected: false,
      }));
      card.push({ category: displayCategory, items });
    }

    return card;
  }

  /**
   * Get or create bingo game
   */
  ensureBingoGame(chatId) {
    let game = this.getBingoGame(chatId);
    if (!game) {
      game = {
        selected: new Set(),
        card: this.generateBingoCard(),
        round: 1,
        drawMessages: [],
        itemQueryUsage: new Map(),
      };
      this.setBingoGame(chatId, game);
    }
    return game;
  }

  /**
   * Set pattern configuration state
   */
  setPatternConfigurationState(userId, state) {
    this.patternConfigurationState.set(userId, state);
  }

  /**
   * Get pattern configuration state
   */
  getPatternConfigurationState(userId) {
    return this.patternConfigurationState.get(userId);
  }

  /**
   * Clear pattern configuration state
   */
  clearPatternConfigurationState(userId) {
    this.patternConfigurationState.delete(userId);
  }

  /**
   * Set SpongeBob mode
   */
  setSpongebobMode(chatId, enabled) {
    this.spongebobMode.set(chatId, enabled);
  }

  /**
   * Get SpongeBob mode
   */
  getSpongebobMode(chatId) {
    const chatIdStr = String(chatId);
    return this.spongebobMode.get(chatIdStr) || this.spongebobMode.get("global") || false;
  }

  /**
   * Get SpongeBob mode map (for ImageGenerationService)
   */
  getSpongebobModeMap() {
    return this.spongebobMode;
  }

  setMinionMonsterMode(chatId, enabled) {
    this.minionMonsterMode.set(String(chatId), Boolean(enabled));
  }

  getMinionMonsterMode(chatId) {
    return this.minionMonsterMode.get(String(chatId)) || false;
  }

  resetMinionMonsterMode(chatId) {
    this.minionMonsterMode.delete(String(chatId));
  }

  /**
   * Set theme for a chat — stored in memory only (instant access)
   */
  setTheme(chatId, themeId) {
    this.themes.set(chatId, themeId);
  }

  /**
   * Get theme for a chat — reads from memory instantly
   */
  getTheme(chatId) {
    return this.themes.get(chatId) || "default";
  }

  /**
   * Get themes map
   */
  getThemesMap() {
    return this.themes;
  }
}

module.exports = GameStateService;