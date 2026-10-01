const { Pool } = require("pg");
const { getPostgresConnectionString } = require("../src/utils/databaseConfig");

class GroupConfigService {
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

  async initDatabase() {
    const client = await this.pool.connect();
    try {
      // Create table if it doesn't exist (preserve existing data)
      await client.query(`
        CREATE TABLE IF NOT EXISTS group_configs (
          id SERIAL PRIMARY KEY,
          group_id BIGINT NOT NULL UNIQUE,
          admin_id BIGINT NOT NULL,
          pattern JSONB,
          pattern_order TEXT[],
          status VARCHAR(20) DEFAULT 'idle',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Migration: Add pattern_order column if it doesn't exist
      try {
        await client.query(`
          ALTER TABLE group_configs 
          ADD COLUMN IF NOT EXISTS pattern_order TEXT[];
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS theme_id VARCHAR(50) DEFAULT 'default';
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      // Migration: group_name caches the Telegram title and marks a group as a
      // funds source — a non-null group_name means the group can be picked as one.
      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS group_name TEXT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS funds_group_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS channel_id BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS bola_channel_enabled BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS bola_timer_enabled BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS bola_timer_interval INTEGER DEFAULT 10;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS admin_funds INTEGER DEFAULT 0;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS bingobank_funds INTEGER DEFAULT 0;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS log BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS setup_confirmed BOOLEAN DEFAULT FALSE;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS setup_requested_by BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS setup_requested_at TIMESTAMP;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS setup_confirmed_by BIGINT;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      try {
        await client.query(`
          ALTER TABLE group_configs
          ADD COLUMN IF NOT EXISTS setup_confirmed_at TIMESTAMP;
        `);
      } catch (migrationError) {
        // ignore non-fatal migration notes
      }

      // Create index for faster lookups
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_group_configs_group_id ON group_configs(group_id);
      `);

      // Create unique constraint to ensure one config per group
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_group_configs_group_unique ON group_configs(group_id);
      `);

      console.log("Group configs database initialized");
    } catch (error) {
      console.error("Error initializing group configs database:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async createGroupConfig(groupId, adminId) {
    const client = await this.pool.connect();
    try {
      const normalizedGroupId = this.normalizeGroupId(groupId);
      const groupIds = this.getGroupIdVariants(groupId);

      const existingResult = await client.query(
        `SELECT group_id FROM group_configs WHERE group_id = ANY($1) LIMIT 1;`,
        [groupIds],
      );

      const targetGroupId = existingResult.rows[0]
        ? existingResult.rows[0].group_id
        : normalizedGroupId;

      let result;
      if (existingResult.rows[0]) {
        // UPDATE: always update admin_id for the group
        // uses 3 params ($1 = group_id, $2 = admin_id, $3 = status)
        result = await client.query(
          `
            UPDATE group_configs
            SET admin_id = $2,
                status = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE group_id = $1
            RETURNING id, admin_id, pattern, status;
          `,
          [targetGroupId, adminId, "idle"],
        );
      } else {
        // INSERT: uses 4 params ($1 = group_id, $2 = admin_id, $3 = pattern, $4 = status)
        result = await client.query(
          `
            INSERT INTO group_configs (group_id, admin_id, pattern, status)
            VALUES ($1, $2, $3, $4)
            RETURNING id, admin_id, pattern, status;
          `,
          [targetGroupId, adminId, null, "idle"],
        );
      }
      console.log(
        `Group config created/updated for group ${groupId}, admin ${adminId}`,
      );
      return result.rows[0];
    } catch (error) {
      console.error("Error creating group config:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getGroupConfig(groupId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const result = await client.query(`
        SELECT * FROM group_configs WHERE group_id = ANY($1) LIMIT 1;
      `, [groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error getting group config:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateGroupPattern(groupId, pattern) {
    const client = await this.pool.connect();
    try {
      // Parse pattern to extract key order
      const parsedPattern =
        typeof pattern === "string" ? JSON.parse(pattern) : pattern;
      const keyOrder = Object.keys(parsedPattern);
      const groupIds = this.getGroupIdVariants(groupId);

      const query = `
        UPDATE group_configs 
        SET pattern = $1, pattern_order = $2, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($3)
        RETURNING *;
      `;

      const result = await client.query(query, [pattern, keyOrder, groupIds]);
      return result.rows[0];
    } catch (error) {
      console.error("Error updating group pattern:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAdminGroups(userId) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM group_configs 
        WHERE admin_id = $1;
      `;

      const result = await client.query(query, [userId]);
      return result.rows;
    } catch (error) {
      console.error("Error getting admin groups:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAllGroupConfigs() {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT * FROM group_configs;
      `;
      const result = await client.query(query);
      return result.rows;
    } catch (error) {
      console.error("Error getting all group configs:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async isAdmin(groupId, userId) {
    try {
      const config = await this.getGroupConfig(groupId);
      return config && String(config.admin_id) === String(userId);
    } catch (error) {
      console.error("Error checking admin status:", error);
      return false;
    }
  }

  async validatePattern(pattern) {
    try {
      // Parse JSON
      const parsed = JSON.parse(pattern);

      // Check if it's an object with at least one key
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Object.keys(parsed).length === 0
      ) {
        return {
          valid: false,
          error: "Pattern must be a non-empty JSON object",
        };
      }

      // Check if all values are arrays
      for (const [key, value] of Object.entries(parsed)) {
        if (!Array.isArray(value)) {
          return {
            valid: false,
            error: `Value for key "${key}" must be an array`,
          };
        }

        // Check if arrays have at least one item
        if (value.length === 0) {
          return {
            valid: false,
            error: `Array for key "${key}" cannot be empty`,
          };
        }
      }

      return { valid: true, pattern: pattern };
    } catch (error) {
      return { valid: false, error: "Invalid JSON format" };
    }
  }

  async updateGroupTheme(groupId, themeId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const result = await client.query(
        `
        UPDATE group_configs
        SET theme_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING *;
        `,
        [themeId, groupIds],
      );
      return result.rows[0];
    } catch (error) {
      console.error("Error updating group theme:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAllGroupThemes() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT group_id, COALESCE(theme_id, 'default') AS theme_id
        FROM group_configs;
      `);
      return result.rows;
    } catch (error) {
      console.error("Error getting group themes:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateGroupChannel(groupId, channelId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET channel_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING *;
      `;
      const result = await client.query(query, [channelId, groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error updating group channel:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updateGroupName(groupId, groupName) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET group_name = $1, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING *;
      `;
      const result = await client.query(query, [groupName, groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error updating group name:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getChannelId(groupId) {
    const cfg = await this.getGroupConfig(groupId);
    return cfg ? cfg.channel_id || null : null;
  }

  async getTheme(groupId) {
    const cfg = await this.getGroupConfig(groupId);
    return cfg ? cfg.theme_id || 'default' : 'default';
  }

  async getBolaChannelEnabled(groupId) {
    const cfg = await this.getGroupConfig(groupId);
    return cfg ? cfg.bola_channel_enabled || false : false;
  }

  async setBolaChannelEnabled(groupId, enabled) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET bola_channel_enabled = $1, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING *;
      `;
      const result = await client.query(query, [enabled, groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error setting bola channel enabled:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getBolaTimerEnabled(groupId) {
    const cfg = await this.getGroupConfig(groupId);
    return cfg ? cfg.bola_timer_enabled || false : false;
  }

  async getBolaTimerInterval(groupId) {
    const cfg = await this.getGroupConfig(groupId);
    return cfg ? cfg.bola_timer_interval || 10 : 10;
  }

  async setBolaTimerConfig(groupId, enabled, interval) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET bola_timer_enabled = $1, bola_timer_interval = $2, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($3)
        RETURNING *;
      `;
      const result = await client.query(query, [enabled, interval, groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error setting bola timer config:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getAdminFunds(groupId) {
    const cfg = await this.getGroupConfig(groupId);
    return cfg ? (cfg.admin_funds || 0) : 0;
  }

  async updateAdminFunds(groupId, amount) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET admin_funds = admin_funds + $1, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING admin_funds;
      `;
      const result = await client.query(query, [amount, groupIds]);
      return result.rows[0] ? result.rows[0].admin_funds : null;
    } catch (error) {
      console.error("Error updating admin funds:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getBingobankFunds(groupId) {
    const cfg = await this.getGroupConfig(groupId);
    return cfg ? (cfg.bingobank_funds || 0) : 0;
  }

  async updateBingobankFunds(groupId, amount) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET bingobank_funds = bingobank_funds + $1, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING bingobank_funds;
      `;
      const result = await client.query(query, [amount, groupIds]);
      return result.rows[0] ? result.rows[0].bingobank_funds : null;
    } catch (error) {
      console.error("Error updating bingobank funds:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getLogChatId(groupId) {
    const cfg = await this.getGroupConfig(groupId);
    return cfg ? cfg.log || null : null;
  }

  async updateLogChatId(groupId, logChatId) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET log = $1, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING log;
      `;
      const result = await client.query(query, [logChatId, groupIds]);
      return result.rows[0] ? result.rows[0].log : null;
    } catch (error) {
      console.error("Error updating log chat ID:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async isGroupSetupConfirmed(groupId) {
    try {
      const config = await this.getGroupConfig(groupId);
      return Boolean(config && config.setup_confirmed === true);
    } catch (error) {
      console.error("Error checking group setup approval:", error);
      return false;
    }
  }

  async requestGroupSetupApproval(groupId, requestedBy) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET setup_requested_by = $1,
            setup_requested_at = CURRENT_TIMESTAMP,
            setup_confirmed = FALSE,
            setup_confirmed_by = NULL,
            setup_confirmed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING *;
      `;
      const result = await client.query(query, [requestedBy, groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error requesting setup approval:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async approveGroupSetup(groupId, approvedBy) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET setup_confirmed = TRUE,
            setup_confirmed_by = $1,
            setup_confirmed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING *;
      `;
      const result = await client.query(query, [approvedBy, groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error approving group setup:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async rejectGroupSetup(groupId, rejectedBy) {
    const client = await this.pool.connect();
    try {
      const groupIds = this.getGroupIdVariants(groupId);
      const query = `
        UPDATE group_configs
        SET setup_confirmed = FALSE,
            setup_confirmed_by = $1,
            setup_confirmed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ANY($2)
        RETURNING *;
      `;
      const result = await client.query(query, [rejectedBy, groupIds]);
      return result.rows[0] || null;
    } catch (error) {
      console.error("Error rejecting group setup:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async isCommandAllowedInGroup(groupId, allowedGroups = []) {
    // Require a stored group config row and super-admin confirmation gate
    const config = await this.getGroupConfig(groupId);
    if (!config || config.setup_confirmed !== true) {
      return false;
    }

    // Normalize group ID to handle different formats
    const groupVariants = this.getGroupIdVariants(groupId);

    // If no allowed groups are specified, allow in all groups that are setup-approved
    if (!allowedGroups || allowedGroups.length === 0) {
      return true;
    }

    // Check if the current group ID matches any of the allowed groups
    for (const allowedGroup of allowedGroups) {
      const allowedVariants = this.getGroupIdVariants(allowedGroup);
      if (groupVariants.some(variant => allowedVariants.includes(variant))) {
        return true;
      }
    }

    return false;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = GroupConfigService;
