const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../utils/databaseConfig");

class User {
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
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          telegram_id BIGINT NOT NULL UNIQUE,
          username TEXT,
          first_name TEXT,
          last_name TEXT,
          funds INTEGER DEFAULT 0,
          profile_photo_url TEXT,
          profile_photo_file_id TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Add funds column if it doesn't exist (migration)
      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS funds INTEGER DEFAULT 0;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS profile_photo_file_id TEXT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS join_prank_sent BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS is_celebration TEXT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS bac_cards TEXT[] DEFAULT '{}';
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS temp_admin_until TIMESTAMP;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS temp_admin_group_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE users
          ADD COLUMN IF NOT EXISTS activated_bac TEXT[] DEFAULT '{}';
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
      `);

    } catch (error) {
      console.error("Error initializing users table:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async findByTelegramId(telegramId) {
    const client = await this.pool.connect();
    try {
      const query = "SELECT * FROM users WHERE telegram_id = $1";
      const result = await client.query(query, [telegramId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error finding user by telegram ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async findByUsername(username) {
    const client = await this.pool.connect();
    try {
      const query = "SELECT * FROM users WHERE LOWER(username) = LOWER($1)";
      const result = await client.query(query, [username]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error finding user by username:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAllUsers() {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT telegram_id, username, first_name, last_name, profile_photo_url, updated_at
        FROM users
        ORDER BY updated_at DESC
      `;
      const result = await client.query(query);
      return result.rows.map((r) => ({
        telegram_id: r.telegram_id,
        username: r.username,
        first_name: r.first_name,
        last_name: r.last_name,
        profile_photo_url: r.profile_photo_url,
        updated_at: r.updated_at,
      }));
    } catch (error) {
      console.error("Error fetching all users:", error);
      return [];
    } finally {
      client.release();
    }
  }

  async getProfilePhotoData(api, telegramId) {
    if (!api || !telegramId) {
      return { profilePhotoUrl: null, profilePhotoFileId: null };
    }

    try {
      const profilePhotos = await api.getUserProfilePhotos(telegramId, { limit: 1 });
      const photos = profilePhotos?.photos?.[0] || [];
      const largestPhoto = photos.length > 0 ? photos[photos.length - 1] : null;
      const fileId = largestPhoto?.file_id || null;

      if (!fileId) {
        return { profilePhotoUrl: null, profilePhotoFileId: null };
      }

      let profilePhotoUrl = null;
      try {
        const fileData = await api.getFile(fileId);
        const filePath = fileData?.file_path;
        const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
        if (botToken && filePath) {
          profilePhotoUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
        }
      } catch (fileError) {
        console.warn("Could not resolve Telegram file URL for profile photo:", fileError.message);
      }

      return {
        profilePhotoUrl,
        profilePhotoFileId: fileId,
      };
    } catch (error) {
      console.warn("Could not fetch profile photo for user:", telegramId, error.message);
      return { profilePhotoUrl: null, profilePhotoFileId: null };
    }
  }

  static cleanText(value) {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  static hasEmoji(text) {
    if (!text || typeof text !== "string") return false;
    // Emoji regex - matches common emojis
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    // Check if the entire text is just an emoji (no other characters)
    return emojiRegex.test(text) && text.trim().length <= 2;
  }

  async createOrUpdate(userData) {
    const client = await this.pool.connect();
    try {
      const telegramId = Number(userData.telegramId);
      const username = User.cleanText(userData.username);
      const firstName = User.cleanText(userData.firstName);
      const lastName = User.cleanText(userData.lastName);
      const profilePhotoUrl = User.cleanText(userData.profilePhotoUrl);
      const profilePhotoFileId = User.cleanText(userData.profilePhotoFileId);
      const joinPrankSent = userData.joinPrankSent === true ? true : null;
      
      // Auto-detect celebration emoji in first_name and store it in is_celebration
      const hasCelebrationEmoji = firstName && User.hasEmoji(firstName);
      const celebrationEmoji = hasCelebrationEmoji ? firstName : null;

      const query = `
        INSERT INTO users (telegram_id, username, first_name, last_name, profile_photo_url, profile_photo_file_id, join_prank_sent, is_celebration)
        VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::text, $6::text, COALESCE($7::boolean, FALSE), $8::text)
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          username = COALESCE($2::text, users.username),
          first_name = COALESCE($3::text, users.first_name),
          last_name = COALESCE($4::text, users.last_name),
          profile_photo_url = COALESCE($5::text, users.profile_photo_url),
          profile_photo_file_id = COALESCE($6::text, users.profile_photo_file_id),
          join_prank_sent = CASE WHEN $7 IS NULL THEN users.join_prank_sent ELSE $7 END,
          is_celebration = COALESCE($8::text, users.is_celebration),
          updated_at = CURRENT_TIMESTAMP
        RETURNING *;
      `;

      const result = await client.query(query, [
        telegramId,
        username,
        firstName,
        lastName,
        profilePhotoUrl,
        profilePhotoFileId,
        joinPrankSent,
        celebrationEmoji,
      ]);
      return result.rows[0];
    } catch (error) {
      console.error("Error creating/updating user:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateFunds(telegramId, amount) {
    const client = await this.pool.connect();
    try {
      // First, get the user to check if they have a merged account
      const userQuery = `
        SELECT id, telegram_id, merged_into 
        FROM users 
        WHERE telegram_id = $1;
      `;
      const userResult = await client.query(userQuery, [telegramId]);
      const user = userResult.rows[0];
      
      if (!user) {
        return null;
      }

      // Update the main user
      const query = `
        UPDATE users 
        SET funds = funds + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
        RETURNING *;
      `;
      const result = await client.query(query, [amount, telegramId]);
      const updatedUser = result.rows[0];

      // If user has a merged account, update it too to keep them in sync
      if (user.merged_into) {
        const mergedQuery = `
          UPDATE users 
          SET funds = funds + $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING *;
        `;
        await client.query(mergedQuery, [amount, user.merged_into]);
        console.log(`[updateFunds] Also updated merged account ${user.merged_into} by ${amount}`);
      }

      // Also check if any other accounts have this user as their merged_into (bidirectional)
      const reverseMergeQuery = `
        SELECT id, telegram_id 
        FROM users 
        WHERE merged_into = $1 AND id != $2;
      `;
      const reverseMergeResult = await client.query(reverseMergeQuery, [user.id, user.id]);
      
      for (const reverseUser of reverseMergeResult.rows) {
        const reverseUpdateQuery = `
          UPDATE users 
          SET funds = funds + $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2;
        `;
        await client.query(reverseUpdateQuery, [amount, reverseUser.id]);
        console.log(`[updateFunds] Also updated reverse-merged account ${reverseUser.id} by ${amount}`);
      }

      return updatedUser || null;
    } catch (error) {
      console.error("Error updating user funds:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setFunds(telegramId, amount) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users 
        SET funds = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
        RETURNING *;
      `;
      const result = await client.query(query, [amount, telegramId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error setting user funds:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setCelebrationFlag(telegramId, celebrationEmoji = null) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users
        SET is_celebration = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
        RETURNING *;
      `;
      const result = await client.query(query, [celebrationEmoji, Number(telegramId)]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error updating celebration flag:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async addBacCard(telegramId, bacCardCode) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users
        SET bac_cards = array_append(bac_cards, $1),
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
        RETURNING *;
      `;
      const result = await client.query(query, [bacCardCode, Number(telegramId)]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error adding BAC card:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setTempAdminExpiry(telegramId, expiryDate, groupId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users
        SET temp_admin_until = $1,
            temp_admin_group_id = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $3
        RETURNING *;
      `;
      const result = await client.query(query, [expiryDate, groupId, Number(telegramId)]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error setting temp admin expiry:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getTempAdminExpiry(telegramId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT temp_admin_until
        FROM users
        WHERE telegram_id = $1;
      `;
      const result = await client.query(query, [Number(telegramId)]);
      return result.rows[0]?.temp_admin_until || null;
    } catch (error) {
      console.error("Error getting temp admin expiry:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async clearTempAdminExpiry(telegramId) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users
        SET temp_admin_until = NULL,
            temp_admin_group_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $1
        RETURNING *;
      `;
      const result = await client.query(query, [Number(telegramId)]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error clearing temp admin expiry:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getExpiredTempAdmins() {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT telegram_id, temp_admin_group_id, temp_admin_until
        FROM users
        WHERE temp_admin_until IS NOT NULL
          AND temp_admin_until < CURRENT_TIMESTAMP;
      `;
      const result = await client.query(query);
      return result.rows;
    } catch (error) {
      console.error("Error getting expired temp admins:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async removeBacCard(telegramId, bacCardCode) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users
        SET bac_cards = array_remove(bac_cards, $1),
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
        RETURNING *;
      `;
      const result = await client.query(query, [bacCardCode, Number(telegramId)]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error removing BAC card:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getBacCardQuantity(telegramId, bacCardCode) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT array_length(array_positions(bac_cards, $1), 1) as quantity
        FROM users
        WHERE telegram_id = $2;
      `;
      const result = await client.query(query, [bacCardCode, Number(telegramId)]);
      return result.rows[0]?.quantity || 0;
    } catch (error) {
      console.error("Error getting BAC card quantity:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async decrementBacCard(telegramId, bacCardCode) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users
        SET bac_cards = (
              SELECT COALESCE(array_agg(card ORDER BY ord), ARRAY[]::text[])
              FROM unnest(bac_cards) WITH ORDINALITY AS cards(card, ord)
              WHERE ord <> (
                SELECT MIN(first_card.ord)
                FROM unnest(bac_cards) WITH ORDINALITY AS first_card(card, ord)
                WHERE first_card.card = $1
              )
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
          AND $1 = ANY(bac_cards)
        RETURNING *;
      `;
      const result = await client.query(query, [bacCardCode, Number(telegramId)]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error decrementing BAC card:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async activateBac(telegramId, bacCode) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users
        SET activated_bac = array_append(activated_bac, $1),
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
          AND $1 = ANY(bac_cards)
          AND NOT ($1 = ANY(activated_bac))
        RETURNING *;
      `;
      const result = await client.query(query, [bacCode, Number(telegramId)]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error activating BAC card:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deactivateBac(telegramId, bacCode) {
    const client = await this.pool.connect();
    try {
      const query = `
        UPDATE users
        SET activated_bac = array_remove(activated_bac, $1),
            updated_at = CURRENT_TIMESTAMP
        WHERE telegram_id = $2
          AND $1 = ANY(activated_bac)
        RETURNING *;
      `;
      const result = await client.query(query, [bacCode, Number(telegramId)]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error deactivating BAC card:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async isBacActivated(telegramId, bacCode) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT $1 = ANY(activated_bac) as is_activated
        FROM users
        WHERE telegram_id = $2;
      `;
      const result = await client.query(query, [bacCode, Number(telegramId)]);
      return result.rows[0]?.is_activated || false;
    } catch (error) {
      console.error("Error checking if BAC is activated:", error);
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = User;
