const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../utils/databaseConfig");

class UserCardLink {
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
    this.pool.on("error", (error) => {
      console.error("Unexpected error on user card link pool:", error);
    });
  }

  async initTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS user_card_links (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        theme_id VARCHAR(80) NOT NULL,
        card_link TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, theme_id)
      );
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_card_links_user_id
      ON user_card_links(user_id);
    `);
  }

  async upsert(userId, themeId, cardLink) {
    const result = await this.pool.query(
      `
        INSERT INTO user_card_links (user_id, theme_id, card_link)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id, theme_id)
        DO UPDATE SET card_link = EXCLUDED.card_link, updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `,
      [userId, themeId, cardLink],
    );
    return result.rows[0] || null;
  }

  async getByUser(userId) {
    const result = await this.pool.query(
      `
        SELECT user_id, theme_id, card_link
        FROM user_card_links
        WHERE user_id = $1
        ORDER BY theme_id;
      `,
      [userId],
    );
    return result.rows;
  }

  async getByUserAndTheme(userId, themeId) {
    const result = await this.pool.query(
      `
        SELECT user_id, theme_id, card_link
        FROM user_card_links
        WHERE user_id = $1 AND theme_id = $2
        LIMIT 1;
      `,
      [userId, themeId],
    );
    return result.rows[0] || null;
  }
}

module.exports = UserCardLink;
