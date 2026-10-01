const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../src/utils/databaseConfig");

class BingoFundsService {
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

  normalizeGroupId(value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }

    const raw = String(value).trim();
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return raw;
    }

    return String(parseInt(raw, 10));
  }

  cleanName(value) {
    // Remove common invisible/filler characters: Hangul filler (U+3164), Zero-width space, etc.
    return String(value || "")
      .replace(/\u3164/g, "") // Korean Hangul filler
      .replace(/\u200B/g, "") // Zero-width space
      .replace(/\u200C/g, "") // Zero-width non-joiner
      .replace(/\u200D/g, "") // Zero-width joiner
      .replace(/\uFEFF/g, "") // Zero-width no-break space
      .trim();
  }

  getGroupIdVariants(value) {
    const normalized = this.normalizeGroupId(value);
    const variants = new Set([normalized]);

    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      const absValue = String(Math.abs(numeric));
      if (normalized.startsWith("-100") && absValue.length > 3) {
        variants.add(absValue.slice(3));
      } else if (!normalized.startsWith("-100") && absValue.length >= 10) {
        variants.add(`-100${absValue}`);
      }
    }

    return Array.from(variants);
  }

  async findUserByName(client, name) {
    const normalizedName = (name || "").trim().toLowerCase();
    if (!normalizedName) {
      return null;
    }

    const query = `
      SELECT id, telegram_id, username, first_name, last_name, funds
      FROM users
      WHERE lower(username) = $1
         OR lower(first_name) = $1
         OR lower(last_name) = $1
      ORDER BY updated_at DESC
      LIMIT 1;
    `;

    const result = await client.query(query, [normalizedName]);
    return result.rows[0] || null;
  }

  async ensureUserByName(client, name, initialFunds = 0) {
    const existingUser = await this.findUserByName(client, name);
    if (existingUser) {
      return existingUser;
    }

    const displayName = this.cleanName(name);
    const fallbackTelegramId = -1000000000000 - Math.floor(Math.random() * 1000000000);
    const query = `
      INSERT INTO users (telegram_id, username, first_name, funds, created_at, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, telegram_id, username, first_name, last_name, funds;
    `;
    const result = await client.query(query, [fallbackTelegramId, displayName, displayName, initialFunds]);
    return result.rows[0] || null;
  }

  async initDatabase() {
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
          merged_into BIGINT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS funds INTEGER DEFAULT 0;
      `);
      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
      `);
      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS profile_photo_file_id TEXT;
      `);
      await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS merged_into BIGINT;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS user_group_memberships (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          group_id BIGINT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, group_id)
        );
      `);

      console.log("Funds service initialized against users table");
    } catch (error) {
      console.error("Error initializing funds database:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async addUserToGroup(telegramId, groupId) {
    const client = await this.pool.connect();
    try {
      await client.query(`
        INSERT INTO user_group_memberships (user_id, group_id)
        SELECT id, $2 FROM users WHERE telegram_id = $1
        ON CONFLICT (user_id, group_id) DO NOTHING;
      `, [telegramId, groupId]);
    } finally {
      client.release();
    }
  }

  async addFundsEntry(groupId, name, funds = null) {
    const client = await this.pool.connect();
    try {
      console.log(`[funds-service] addFundsEntry group=${groupId} name=${name} funds=${funds}`);
      const matchingUser = await this.findUserByIdentifier(client, name, groupId);
      
      if (!matchingUser) {
        // If not found, try to create user with ensureUserByName (for name/username only)
        const createdUser = await this.ensureUserByName(client, name, 0);
        const amount = funds === null ? 0 : funds;
        const updateQuery = `
          UPDATE users
          SET funds = COALESCE(funds, 0) + $1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING id, telegram_id, username, first_name, last_name, funds;
        `;
        const result = await client.query(updateQuery, [amount, createdUser.id]);
        return result.rows[0] || null;
      }
      
      const amount = funds === null ? 0 : funds;
      const updateQuery = `
        UPDATE users
        SET funds = COALESCE(funds, 0) + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, telegram_id, username, first_name, last_name, funds;
      `;
      const result = await client.query(updateQuery, [amount, matchingUser.id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error adding funds entry:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async removeFundsEntry(groupId, name) {
    const client = await this.pool.connect();
    try {
      const matchingUser = await this.findUserByIdentifier(client, name, groupId);
      if (!matchingUser) {
        return null;
      }

      const result = await client.query(`
        DELETE FROM users
        WHERE id = $1
        RETURNING id, telegram_id, username, first_name, last_name, funds;
      `, [matchingUser.id]);

      return result.rows[0] || null;
    } catch (error) {
      console.error("Error removing funds entry:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateFunds(groupId, name, amount) {
    const client = await this.pool.connect();
    try {
      console.log(`[funds-service] updateFunds group=${groupId} name=${name} amount=${amount}`);
      const matchingUser = await this.findUserByIdentifier(client, name, groupId);
      
      if (!matchingUser) {
        return null;
      }
      
      // Check if user is merged
      const userQuery = `
        SELECT id, telegram_id, username, first_name, last_name, funds, merged_into
        FROM users
        WHERE id = $1
        LIMIT 1;
      `;
      const userResult = await client.query(userQuery, [matchingUser.id]);
      const user = userResult.rows[0];

      if (!user) {
        return null;
      }

      // If user is merged, update both accounts
      if (user.merged_into) {
        const otherUserQuery = `
          SELECT id, telegram_id, username, first_name, last_name, funds, merged_into
          FROM users
          WHERE id = $1
            AND EXISTS (SELECT 1 FROM user_group_memberships membership WHERE membership.user_id = users.id AND membership.group_id = $2)
          LIMIT 1;
        `;
        const otherUserResult = await client.query(otherUserQuery, [user.merged_into, groupId]);
        const otherUser = otherUserResult.rows[0];

        if (otherUser) {
          // Update both users
          const updateUserQuery = `
            UPDATE users
            SET funds = COALESCE(funds, 0) + $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, telegram_id, username, first_name, last_name, funds;
          `;
          const updateUserResult = await client.query(updateUserQuery, [amount, user.id]);
          
          const updateOtherUserQuery = `
            UPDATE users
            SET funds = COALESCE(funds, 0) + $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, telegram_id, username, first_name, last_name, funds;
          `;
          const updateOtherUserResult = await client.query(updateOtherUserQuery, [amount, otherUser.id]);

          return {
            user: updateUserResult.rows[0],
            otherUser: updateOtherUserResult.rows[0],
            isMerged: true
          };
        }
      } else {
        const reverseMergeQuery = `
          SELECT id, telegram_id, username, first_name, last_name, funds, merged_into
          FROM users
          WHERE merged_into = $1
            AND EXISTS (SELECT 1 FROM user_group_memberships membership WHERE membership.user_id = users.id AND membership.group_id = $2)
          LIMIT 1;
        `;
        const reverseMergeResult = await client.query(reverseMergeQuery, [user.id, groupId]);
        const otherUser = reverseMergeResult.rows[0];

        if (otherUser) {
          const updateUserQuery = `
            UPDATE users
            SET funds = COALESCE(funds, 0) + $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, telegram_id, username, first_name, last_name, funds;
          `;
          const updateUserResult = await client.query(updateUserQuery, [amount, user.id]);

          const updateOtherUserQuery = `
            UPDATE users
            SET funds = COALESCE(funds, 0) + $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, telegram_id, username, first_name, last_name, funds;
          `;
          const updateOtherUserResult = await client.query(updateOtherUserQuery, [amount, otherUser.id]);

          return {
            user: updateUserResult.rows[0],
            otherUser: updateOtherUserResult.rows[0],
            isMerged: true
          };
        }
      }

      // Single user update (not merged)
      const result = await client.query(`
        UPDATE users
        SET funds = COALESCE(funds, 0) + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, telegram_id, username, first_name, last_name, funds;
      `, [amount, matchingUser.id]);

      return {
        user: result.rows[0],
        isMerged: false
      };
    } catch (error) {
      console.error("Error updating funds:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async setFunds(groupId, name, amount) {
    const client = await this.pool.connect();
    try {
      console.log(`[funds-service] setFunds group=${groupId} name=${name} amount=${amount}`);
      const matchingUser = await this.findUserByIdentifier(client, name, groupId);
      
      if (!matchingUser) {
        return null;
      }
      
      // Check if user is merged
      const userQuery = `
        SELECT id, telegram_id, username, first_name, last_name, funds, merged_into
        FROM users
        WHERE id = $1
        LIMIT 1;
      `;
      const userResult = await client.query(userQuery, [matchingUser.id]);
      const user = userResult.rows[0];

      if (!user) {
        return null;
      }

      // If user is merged, update both accounts
      if (user.merged_into) {
        const otherUserQuery = `
          SELECT id, telegram_id, username, first_name, last_name, funds, merged_into
          FROM users
          WHERE id = $1
            AND EXISTS (SELECT 1 FROM user_group_memberships membership WHERE membership.user_id = users.id AND membership.group_id = $2)
          LIMIT 1;
        `;
        const otherUserResult = await client.query(otherUserQuery, [user.merged_into, groupId]);
        const otherUser = otherUserResult.rows[0];

        if (otherUser) {
          // Update both users
          const updateUserQuery = `
            UPDATE users
            SET funds = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, telegram_id, username, first_name, last_name, funds;
          `;
          const updateUserResult = await client.query(updateUserQuery, [amount, user.id]);
          
          const updateOtherUserQuery = `
            UPDATE users
            SET funds = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, telegram_id, username, first_name, last_name, funds;
          `;
          const updateOtherUserResult = await client.query(updateOtherUserQuery, [amount, otherUser.id]);

          return {
            user: updateUserResult.rows[0],
            otherUser: updateOtherUserResult.rows[0],
            isMerged: true
          };
        }
      } else {
        const reverseMergeQuery = `
          SELECT id, telegram_id, username, first_name, last_name, funds, merged_into
          FROM users
          WHERE merged_into = $1
            AND EXISTS (SELECT 1 FROM user_group_memberships membership WHERE membership.user_id = users.id AND membership.group_id = $2)
          LIMIT 1;
        `;
        const reverseMergeResult = await client.query(reverseMergeQuery, [user.id, groupId]);
        const otherUser = reverseMergeResult.rows[0];

        if (otherUser) {
          const updateUserQuery = `
            UPDATE users
            SET funds = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, telegram_id, username, first_name, last_name, funds;
          `;
          const updateUserResult = await client.query(updateUserQuery, [amount, user.id]);

          const updateOtherUserQuery = `
            UPDATE users
            SET funds = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, telegram_id, username, first_name, last_name, funds;
          `;
          const updateOtherUserResult = await client.query(updateOtherUserQuery, [amount, otherUser.id]);

          return {
            user: updateUserResult.rows[0],
            otherUser: updateOtherUserResult.rows[0],
            isMerged: true
          };
        }
      }

      // Single user update (not merged)
      const result = await client.query(`
        UPDATE users
        SET funds = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, telegram_id, username, first_name, last_name, funds;
      `, [amount, matchingUser.id]);

      return {
        user: result.rows[0],
        isMerged: false
      };
    } catch (error) {
      console.error("Error setting funds:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getFundsByGroup(groupId, sortBy = "name") {
    const client = await this.pool.connect();
    try {
      const orderClause =
        sortBy === "desc"
          ? "ORDER BY user_row.funds DESC NULLS LAST, LOWER(COALESCE(user_row.first_name, user_row.username, user_row.last_name, CAST(user_row.telegram_id AS TEXT))) ASC"
          : "ORDER BY LOWER(COALESCE(user_row.first_name, user_row.username, user_row.last_name, CAST(user_row.telegram_id AS TEXT))) ASC";

      const query = `
        SELECT
          user_row.id,
          user_row.telegram_id,
          user_row.username,
          user_row.first_name,
          user_row.last_name,
          user_row.funds,
          user_row.updated_at,
          user_row.merged_into,
          partner.first_name AS partner_first_name,
          partner.last_name AS partner_last_name,
          partner.username AS partner_username
        FROM users AS user_row
        LEFT JOIN users AS partner ON partner.id = user_row.merged_into
        WHERE (user_row.merged_into IS NULL OR user_row.id < user_row.merged_into)
        ${orderClause};
      `;

      const result = await client.query(query);
      return result.rows.map((row) => ({
        id: row.id,
        telegram_id: row.telegram_id,
        username: row.username,
        first_name: row.merged_into
          ? `${row.first_name || row.username || row.last_name || `user_${row.telegram_id}`} 🔗 ${row.partner_first_name || row.partner_username || row.partner_last_name || "Unknown Player"}`
          : row.first_name,
        last_name: row.last_name,
        name: row.merged_into
          ? `${row.first_name || row.username || row.last_name || `user_${row.telegram_id}`} 🔗 ${row.partner_first_name || row.partner_username || row.partner_last_name || "Unknown Player"}`
          : row.username || row.first_name || row.last_name || `user_${row.telegram_id}`,
        funds: row.funds,
        updated_at: row.updated_at,
        merged_into: row.merged_into,
        partner_first_name: row.partner_first_name,
        partner_last_name: row.partner_last_name,
        partner_username: row.partner_username,
      }));
    } catch (error) {
      console.error("Error getting funds by group:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getFundsEntry(groupId, name) {
    const client = await this.pool.connect();
    try {
      const user = await this.findUserByIdentifier(client, name, groupId);
      
      if (!user) {
        return null;
      }

      return {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        name: user.username || user.first_name || user.last_name || `user_${user.telegram_id}`,
        funds: user.funds,
      };
    } catch (error) {
      console.error("Error getting funds entry:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }

  // Funds are now stored against the shared users table and linked via group_configs.
  async setFundsGroupMapping(gameplayGroupId, fundsGroupId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(gameplayGroupId);
      const rows = await client.query(`
        SELECT group_id FROM group_configs;
      `);
      const match = rows.rows.find((row) => groupIds.includes(this.normalizeGroupId(row.group_id)));
      if (!match) {
        return null;
      }

      const query = `
        UPDATE group_configs
        SET funds_group_id = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($1)
        RETURNING group_id, funds_group_id;
      `;

      const result = await client.query(query, [groupIds, fundsGroupId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error setting funds group mapping:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getFundsGroupMapping(gameplayGroupId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(gameplayGroupId);
      const result = await client.query(`
        SELECT group_id, funds_group_id
        FROM group_configs;
      `);
      const mapping = result.rows.find((row) => groupIds.includes(this.normalizeGroupId(row.group_id))) || null;
      console.log(`[funds-service] getFundsGroupMapping gameplayGroup=${gameplayGroupId} ->`, mapping);
      return mapping;
    } catch (error) {
      console.error("Error getting funds group mapping:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async removeFundsGroupMapping(gameplayGroupId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(gameplayGroupId);
      const rows = await client.query(`
        SELECT group_id FROM group_configs;
      `);
      const match = rows.rows.find((row) => groupIds.includes(this.normalizeGroupId(row.group_id)));
      if (!match) {
        return null;
      }

      const query = `
        UPDATE group_configs
        SET funds_group_id = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($1)
        RETURNING group_id, funds_group_id;
      `;

      const result = await client.query(query, [groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error removing funds group mapping:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getEffectiveGroupId(gameplayGroupId) {
    const mapping = await this.getFundsGroupMapping(gameplayGroupId);
    const effectiveGroupId = mapping?.funds_group_id ? Number(mapping.funds_group_id) : gameplayGroupId;
    console.log(`[funds-service] getEffectiveGroupId gameplayGroup=${gameplayGroupId} effectiveGroup=${effectiveGroupId}`);
    return effectiveGroupId;
  }

  // Register a group as a funds group (stores its display name on group_configs)
  async registerFundsGroup(groupId, groupName) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const rows = await client.query(`
        SELECT group_id FROM group_configs;
      `);
      const match = rows.rows.find((row) => groupIds.includes(this.normalizeGroupId(row.group_id)));
      if (!match) {
        console.log(`Funds group not registered (no config for group ${groupId})`);
        return null;
      }

      const query = `
        UPDATE group_configs
        SET group_name = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($1)
        RETURNING group_id, group_name;
      `;

      const result = await client.query(query, [groupIds, groupName]);
      if (result.rows.length === 0) {
        // No group_configs row (group was never set up via /bingoset) — nothing to register.
        console.log(`Funds group not registered (no config for group ${groupId})`);
        return null;
      }
      console.log(`Funds group registered: ${groupName} (${groupId})`);
      return result.rows[0];
    } catch (error) {
      console.error("Error registering funds group:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Get all registered funds groups (any group_configs row that has a name)
  async getRegisteredFundsGroups() {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT group_id, group_name FROM group_configs
        WHERE group_name IS NOT NULL
        ORDER BY group_name ASC;
      `;

      const result = await client.query(query);
      return result.rows;
    } catch (error) {
      console.error("Error getting registered funds groups:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Check if a group has a mapping to use external funds (appears as gameplay_group_id in mapping)
  async isFundsOnlyGroup(groupId) {
    return false;
  }

  // Get funds group name by ID
  async getFundsGroupName(groupId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const result = await client.query(`
        SELECT group_id, group_name FROM group_configs;
      `);
      const match = result.rows.find((row) => groupIds.includes(this.normalizeGroupId(row.group_id)));
      if (match && match.group_name) {
        return match.group_name;
      }

      // Fallback: try to get from Telegram API if not in database
      return null;
    } catch (error) {
      console.error("Error getting funds group name:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Remove a group from registered funds groups (clears the cached name)
  async removeFundsGroupRegistration(groupId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const rows = await client.query(`
        SELECT group_id FROM group_configs;
      `);
      const match = rows.rows.find((row) => groupIds.includes(this.normalizeGroupId(row.group_id)));
      if (!match) {
        return null;
      }

      const query = `
        UPDATE group_configs
        SET group_name = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($1) AND group_name IS NOT NULL
        RETURNING group_id;
      `;

      const result = await client.query(query, [groupIds]);
      if (result.rows.length > 0) {
        console.log(`Removed funds group registration for group ${groupId}`);
      }
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error removing funds group registration:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async findUserByIdentifier(client, identifier, groupId = null) {
    // Remove @ if present and normalize
    const cleanIdentifier = String(identifier || "").trim().replace(/^@/, "").toLowerCase();
    
    if (!cleanIdentifier) {
      return null;
    }

    // Check if it's a numeric telegram ID
    const numericId = Number(cleanIdentifier);
    const isNumeric = Number.isFinite(numericId) && numericId > 0;

    const membershipClause = groupId === null
      ? ""
      : " AND EXISTS (SELECT 1 FROM user_group_memberships membership WHERE membership.user_id = users.id AND membership.group_id = $2)";
    let query;
    let params;

    if (isNumeric) {
      // Search by telegram_id
      query = `
        SELECT id, telegram_id, username, first_name, last_name, funds
        FROM users
        WHERE telegram_id = $1${membershipClause}
        ORDER BY updated_at DESC
        LIMIT 1;
      `;
      params = groupId === null ? [numericId] : [numericId, groupId];
    } else {
      // Search by username, first_name, or last_name
      query = `
        SELECT id, telegram_id, username, first_name, last_name, funds
        FROM users
          WHERE (lower(username) = $1
            OR lower(first_name) = $1
            OR lower(last_name) = $1)${membershipClause}
        ORDER BY updated_at DESC
        LIMIT 1;
      `;
      params = groupId === null ? [cleanIdentifier] : [cleanIdentifier, groupId];
    }

    const result = await client.query(query, params);
    return result.rows[0] || null;
  }

  async mergeUserFunds(sourceIdentifier, targetIdentifier, groupId = null) {
    const client = await this.pool.connect();
    try {
      console.log(`[funds-service] mergeUserFunds source=${sourceIdentifier} target=${targetIdentifier}`);

      // Find both users
      const sourceUser = await this.findUserByIdentifier(client, sourceIdentifier, groupId);
      const targetUser = await this.findUserByIdentifier(client, targetIdentifier, groupId);

      if (!sourceUser && !targetUser) {
        return { success: false, error: `Users "${sourceIdentifier}" and "${targetIdentifier}" not found` };
      }

      if (!sourceUser) {
        return { success: false, error: `User "${sourceIdentifier}" not found` };
      }

      if (!targetUser) {
        return { success: false, error: `User "${targetIdentifier}" not found` };
      }

      if (sourceUser.id === targetUser.id) {
        return { success: false, error: "Cannot merge a user with themselves" };
      }

      // Calculate merged funds (shared between both accounts)
      const sourceFunds = sourceUser.funds || 0;
      const targetFunds = targetUser.funds || 0;
      const sharedFunds = sourceFunds + targetFunds;

      // Combine names with slash format
      const getSourceDisplayName = () => {
        const firstName = this.cleanName(sourceUser.first_name || "");
        const lastName = this.cleanName(sourceUser.last_name || "");
        const username = this.cleanName(sourceUser.username || "");
        return firstName || lastName || username || sourceIdentifier;
      };

      const getTargetDisplayName = () => {
        const firstName = this.cleanName(targetUser.first_name || "");
        const lastName = this.cleanName(targetUser.last_name || "");
        const username = this.cleanName(targetUser.username || "");
        return firstName || lastName || username || targetIdentifier;
      };

      const sourceName = getSourceDisplayName();
      const targetName = getTargetDisplayName();
      
      // Create combined name with link icon in the center
      const combinedFirstName = `${sourceName} 🔗 ${targetName}`;
      
      // Update both users with shared funds and point to each other
      const updateTargetQuery = `
        UPDATE users
        SET funds = $1,
            merged_into = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING id, telegram_id, username, first_name, last_name, funds, merged_into;
      `;
      const updateTargetResult = await client.query(updateTargetQuery, [sharedFunds, sourceUser.id, targetUser.id]);

      const updateSourceQuery = `
        UPDATE users
        SET funds = $1,
            merged_into = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING id, telegram_id, username, first_name, last_name, funds, merged_into;
      `;
      const updateSourceResult = await client.query(updateSourceQuery, [sharedFunds, targetUser.id, sourceUser.id]);

      const updatedTarget = updateTargetResult.rows[0];
      const updatedSource = updateSourceResult.rows[0];

      return {
        success: true,
        sourceUser: updatedSource,
        targetUser: updatedTarget,
        sourceFunds,
        targetFunds,
        sharedFunds,
        combinedName: combinedFirstName
      };
    } catch (error) {
      console.error("Error merging user funds:", error);
      return { success: false, error: "Failed to merge user funds" };
    } finally {
      client.release();
    }
  }

  async unmergeUserFunds(identifier, groupId = null) {
    const client = await this.pool.connect();
    try {
      console.log(`[funds-service] unmergeUserFunds identifier=${identifier}`);

      // Find the user by identifier
      const user = await this.findUserByIdentifier(client, identifier, groupId);

      if (!user) {
        return { success: false, error: `User "${identifier}" not found` };
      }

      // Check if user is merged (either as source or target)
      let sourceUser = user;
      let targetUser = null;
      
      if (user.merged_into) {
        // User is the source, find the target
        const targetUserQuery = `
          SELECT id, telegram_id, username, first_name, last_name, funds, merged_into
          FROM users
          WHERE id = $1
          LIMIT 1;
        `;
        const targetUserResult = await client.query(targetUserQuery, [user.merged_into]);
        targetUser = targetUserResult.rows[0];
      } else {
        // User might be the target, check if anyone has this user as merged_into
        const reverseMergeQuery = `
          SELECT id, telegram_id, username, first_name, last_name, funds, merged_into
          FROM users
          WHERE merged_into = $1
          LIMIT 1;
        `;
        const reverseMergeResult = await client.query(reverseMergeQuery, [user.id]);
        if (reverseMergeResult.rows.length > 0) {
          sourceUser = reverseMergeResult.rows[0];
          targetUser = user;
        }
      }

      if (!targetUser) {
        return { success: false, error: `User "${identifier}" is not merged with anyone` };
      }

      // Calculate split funds (50/50 split of shared funds)
      const sharedFunds = sourceUser.funds || 0;
      const baseSplit = Math.floor(sharedFunds / 2);
      const remainder = sharedFunds % 2;
      
      // If odd funds, randomly assign the extra 1 to one user
      const sourceGetsExtra = remainder === 1 && Math.random() < 0.5;
      const sourceSplitFunds = sourceGetsExtra ? baseSplit + 1 : baseSplit;
      const targetSplitFunds = sourceGetsExtra ? baseSplit : baseSplit + remainder;

      // Update both users: remove merged_into, restore names, split funds
      const updateSourceQuery = `
        UPDATE users
        SET funds = $1,
            merged_into = NULL,
            first_name = CASE 
              WHEN first_name LIKE '% 🔗 %' THEN split_part(first_name, ' 🔗 ', 2)
              ELSE first_name
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, telegram_id, username, first_name, last_name, funds, merged_into;
      `;
      const updateSourceResult = await client.query(updateSourceQuery, [sourceSplitFunds, sourceUser.id]);

      const updateTargetQuery = `
        UPDATE users
        SET funds = $1,
            merged_into = NULL,
            first_name = CASE 
              WHEN first_name LIKE '% 🔗 %' THEN split_part(first_name, ' 🔗 ', 1)
              ELSE first_name
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, telegram_id, username, first_name, last_name, funds, merged_into;
      `;
      const updateTargetResult = await client.query(updateTargetQuery, [targetSplitFunds, targetUser.id]);

      const updatedSource = updateSourceResult.rows[0];
      const updatedTarget = updateTargetResult.rows[0];

      return {
        success: true,
        user: updatedSource,
        otherUser: updatedTarget,
        userSplitFunds: sourceSplitFunds,
        otherUserSplitFunds: targetSplitFunds
      };
    } catch (error) {
      console.error("Error unmerging user funds:", error);
      return { success: false, error: "Failed to unmerge user funds" };
    } finally {
      client.release();
    }
  }
}

module.exports = BingoFundsService;
