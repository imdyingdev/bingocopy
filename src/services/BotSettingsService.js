/**
 * Bot Settings Service
 * Manages bot-wide settings like premium emoji status
 */

class BotSettingsService {
  constructor(pool = null) {
    this.pool = pool;
  }

  setPool(pool) {
    this.pool = pool;
  }

  async initDatabase() {
    if (!this.pool) {
      throw new Error('Database pool not set. Call setPool() first.');
    }

    // Create bot_settings table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS bot_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(50) UNIQUE NOT NULL,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert default premium emoji setting if not exists
    await this.pool.query(`
      INSERT INTO bot_settings (key, value)
      VALUES ('premium_emoji_enabled', 'false')
      ON CONFLICT (key) DO NOTHING
    `);

  }

  async getPremiumEmojiEnabled() {
    try {
      const result = await this.pool.query(
        "SELECT value FROM bot_settings WHERE key = 'premium_emoji_enabled'"
      );
      if (result.rows.length > 0) {
        return result.rows[0].value === 'true';
      }
      return false; // Default to false if not found
    } catch (error) {
      console.error("Error getting premium emoji status:", error);
      return false; // Default to false on error
    }
  }

  async setPremiumEmojiEnabled(enabled) {
    try {
      await this.pool.query(
        "UPDATE bot_settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'premium_emoji_enabled'",
        [enabled ? 'true' : 'false']
      );
      console.log(`Premium emoji status updated to: ${enabled}`);
      return true;
    } catch (error) {
      console.error("Error setting premium emoji status:", error);
      return false;
    }
  }
}

module.exports = BotSettingsService;
