require("dotenv").config();
const { Bot } = require("grammy");

// Services
const GameSessionLogger = require("../services/GameSessionLogger");
const GroupConfigService = require("../services/GroupConfigService");
const BingoFundsService = require("../services/BingoFundsService");
const GameStateService = require("./services/GameStateService");
const ImageGenerationService = require("./services/ImageGenerationService");
const BolaTimerManager = require("./services/BolaTimerManager");
const AutoBolaManager = require("./services/AutoBolaManager");
const BotSettingsService = require("./services/BotSettingsService");

// Models
const User = require("./models/User");
const BingoGameSession = require("./models/BingoGameSession");
const BingoGamePlayer = require("./models/BingoGamePlayer");
const GameWinner = require("./models/GameWinner");
const UserCardLink = require("./models/UserCardLink");

// Commands
const { handleStart } = require("./commands/bingo/startCmd");
const { handleBingoStart, handleBingo, handleBingoStop, handleListaV2, handleBinguloThemeLista, handleSetPremium, handleRemainingItems } = require("./commands/bingo");
const { setBotSettingsService } = require("./commands/bingo/sharedState");
const { handleBola } = require("./commands/bingo/bola");
const { handleAutoBola } = require("./commands/bingo/autobola");
const { handleBingoSet, handleBingoPattern, handleBingoFundsFrom, handleSpongebob, handleBingoChannel, handleBolaChannel, handleBolaTimer, handleAdminFunds, handleBingobankFunds, handleSetLog, getPendingChannelLink, clearPendingChannelLink } = require("./commands/config/main");
const { handleTheme } = require("./commands/misc/theme");
const { handleMinionMonster } = require("./commands/misc/minionMonster");
const { handleBingoForce } = require("./commands/bingo/force");
const { handleBingoWinner, handleUnbingo } = require("./commands/bingo/winner");
const { handleJoin } = require("./commands/join/index");
const { handlePanalo, handlePanaloV2, handleBingoRecap } = require("./commands/leaderboard/panalo");
const ImageUploadService = require("../services/ImageUploadService");
const { handleBingoFlee } = require("./commands/misc/flee");
const { handleSunday } = require("./commands/misc/sunday");
const { handleToystory } = require("./commands/misc/toystory");
const { handleShuffle } = require("./commands/misc/shuffle");
const { handleBacs } = require("./commands/bac/list");
const { handleMybingo } = require("./commands/misc/mybingo");
const { handleCardsKo, handleCardsKoLinkInput } = require("./commands/misc/cardsko");
const { handleGiveBac } = require("./commands/bac/give");
const { handleTakeBac } = require("./commands/bac/take");
const { handleActivateBac, handleBafmActivationCallback } = require("./commands/bac/activate");
const { handleDeactivateBac } = require("./commands/bac/deactivate");
const { handleBan, handleBanCallback } = require("./commands/bac/ban");
const { 
  handleBingoFunds, 
  handleRmSingle, 
  handleRmMulti, 
  handleFundsAdjustment, 
  handleGoCommand,
  handleMergeCommand,
  handleUnmergeCommand
} = require("./commands/funds/main");

// Handlers
const { handlePatternInput } = require("./handlers/patternHandler");
const { handleItemQuery, handleCandleEmoji, handlePatternWord } = require("./handlers/messageHandlers");
const { handleCallbackQuery } = require("./handlers/callbackHandler");
const { handleCardsKoThemeCallback } = require("./commands/misc/cardsko");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const bot = new Bot(BOT_TOKEN);

bot.use(async (ctx, next) => {
  // Callback query updates carry the group chat context inside the callback,
  // but they are not normal message command updates. They must bypass the
  // setup-confirmation gate so the inline approve/reject keyboard can reach
  // the callback router and update group_configs.
  if (ctx.callbackQuery) {
    return next();
  }

  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
    return next();
  }

  const text = ctx.message?.text || "";
  if (/^\/bingoset(?:@\w+)?/i.test(text)) {
    return next();
  }

  const isApproved = await groupConfigService.isCommandAllowedInGroup(ctx.chat.id, []);
  if (!isApproved) {
    return;
  }

  return next();
});

// Initialize services
const gameStateService = new GameStateService();
const imageGenerationService = new ImageGenerationService(gameStateService.getSpongebobModeMap(), gameStateService);
// Set the themes map for image generation service
imageGenerationService.setThemesMap(gameStateService.getThemesMap());
const gameLogger = new GameSessionLogger();
const groupConfigService = new GroupConfigService();
const bingoFundsService = new BingoFundsService();
const imageUploadService = new ImageUploadService();
const botSettingsService = new BotSettingsService();

// Initialize models
const userModel = new User();
const bingoGameSessionModel = new BingoGameSession();
const bingoGamePlayerModel = new BingoGamePlayer();
const gameWinnerModel = new GameWinner();
const userCardLinkModel = new UserCardLink();

// Initialize bola timer manager after models are created
let bolaTimerManager;
let autoBolaManager;

// Initialize database tables
async function initializeServices() {
  try {
    await groupConfigService.initDatabase();
    await gameLogger.initDatabase();
    await bingoFundsService.initDatabase();
    await gameStateService.initDatabase();
    await userModel.initTable();
    try {
      await userModel.pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_celebration TEXT;
      `);
    } catch (migrationError) {
      console.warn("Celebration column migration skipped:", migrationError.message || migrationError);
    }
    await bingoGameSessionModel.initTable();
    await bingoGamePlayerModel.initTable();
    await gameWinnerModel.initTable();
    await userCardLinkModel.initTable();

    const themeRows = await groupConfigService.getAllGroupThemes();
    for (const row of themeRows) {
      gameStateService.setTheme(Number(row.group_id), row.theme_id);
    }
    // Restore any active games from database (survives bot restarts)
    const restoredGameCount = await gameStateService.restoreAllGames() || 0;
    // After restoring in-memory game cards, re-link any active DB sessions so
    // winners and session metadata are recoverable if the bot was restarted mid-game.
    let linkedGameCount = 0;
    try {
      const restoredChatIds = Array.from(gameStateService.bingoGames.keys());
      for (const chatId of restoredChatIds) {
        try {
          const session = await bingoGameSessionModel.findByGroupId(chatId);
          if (session && (session.status === 'active' || session.status === 'waiting')) {
            const game = gameStateService.getBingoGame(chatId);
            if (game) {
              game.sessionId = session.id;
              // persist updated in-memory game back to DB
              gameStateService.setBingoGame(chatId, game);
              linkedGameCount++;
            }
          }
        } catch (linkErr) {
          console.warn(`Failed to link restored game for chat ${chatId}:`, linkErr && linkErr.message);
        }
      }
    } catch (err) {
      console.warn("Error while linking restored games to sessions:", err && err.message);
    }
    // Check and revoke expired temp admin status
    let revokedTempAdminCount = 0;
    try {
      const expiredAdmins = await userModel.getExpiredTempAdmins();
      for (const expired of expiredAdmins) {
        try {
          const groupId = expired.temp_admin_group_id;
          const userId = expired.telegram_id;
          
          // Demote user from admin in the group
          await bot.api.promoteChatMember(groupId, userId, {
            can_change_info: false,
            can_post_messages: false,
            can_edit_messages: false,
            can_delete_messages: false,
            can_invite_users: false,
            can_restrict_members: false,
            can_pin_messages: false,
            can_manage_topics: false,
            can_promote_members: false,
            can_manage_video_chats: false,
            can_manage_chat: false,
          });
          
          // Clear the temp admin expiry
          await userModel.clearTempAdminExpiry(userId);
          revokedTempAdminCount++;
        } catch (revokeError) {
          console.error(`[temp-admin] Failed to revoke admin for user ${expired.telegram_id}:`, revokeError);
          // Still clear the expiry even if revoke fails
          await userModel.clearTempAdminExpiry(expired.telegram_id);
        }
      }
    } catch (checkError) {
      console.error("Error checking expired temp admins:", checkError);
    }

    console.log(
      `[startup] Ready | themes: ${themeRows.length} | active games: ${restoredGameCount} | ` +
      `linked sessions: ${linkedGameCount} | expired admins revoked: ${revokedTempAdminCount}`
    );

    // Set up periodic check for expired temp admins (every hour)
    setInterval(async () => {
      try {
        const expiredAdmins = await userModel.getExpiredTempAdmins();
        for (const expired of expiredAdmins) {
          try {
            const groupId = expired.temp_admin_group_id;
            const userId = expired.telegram_id;
            
            await bot.api.promoteChatMember(groupId, userId, {
              can_change_info: false,
              can_post_messages: false,
              can_edit_messages: false,
              can_delete_messages: false,
              can_invite_users: false,
              can_restrict_members: false,
              can_pin_messages: false,
              can_manage_topics: false,
              can_promote_members: false,
              can_manage_video_chats: false,
              can_manage_chat: false,
            });
            
            await userModel.clearTempAdminExpiry(userId);
            console.log(`[temp-admin-periodic] Revoked admin status for user ${userId} in group ${groupId}`);
          } catch (revokeError) {
            console.error(`[temp-admin-periodic] Failed to revoke admin for user ${expired.telegram_id}:`, revokeError);
            await userModel.clearTempAdminExpiry(expired.telegram_id);
          }
        }
      } catch (checkError) {
        console.error("Error in periodic temp admin check:", checkError);
      }
    }, 60 * 60 * 1000); // Check every hour

    // Inject botSettingsService into sharedState and set its pool
    setBotSettingsService(botSettingsService);
    botSettingsService.setPool(groupConfigService.pool);
    
    // Initialize bot settings database now that pool is set
    await botSettingsService.initDatabase();

    // Initialize bola timer manager after bot is created
    bolaTimerManager = new BolaTimerManager(bot, gameStateService, groupConfigService, imageGenerationService, bingoFundsService, bingoGameSessionModel, gameWinnerModel);
    autoBolaManager = new AutoBolaManager(bot, gameStateService, groupConfigService, imageGenerationService, bingoFundsService, bingoGameSessionModel, gameWinnerModel, gameLogger);

    // Restore bola timers for groups that have them enabled
    const allConfigs = await groupConfigService.pool.query('SELECT group_id, bola_timer_enabled, bola_timer_interval FROM group_configs WHERE bola_timer_enabled = true');
    for (const config of allConfigs.rows) {
      if (config.bola_timer_enabled && config.bola_timer_interval) {
        bolaTimerManager.startTimer(config.group_id, config.bola_timer_interval);
        console.log(`Restored bola timer for group ${config.group_id} with interval ${config.bola_timer_interval}s`);
      }
    }
  } catch (error) {
    console.error("Failed to initialize services:", error);
    throw error;
  }
}

// Test command
bot.command("test", async (ctx) => {
  console.log("=== /test command received ===");
  await ctx.reply("✅ Test command working! Commands are being processed.");
});

// /start command
bot.command("start", (ctx) => handleStart(ctx, groupConfigService, gameStateService, userModel, bingoFundsService));

// /theme command
bot.command("theme", (ctx) => handleTheme(ctx, gameStateService, groupConfigService, botSettingsService));

bot.command("minionmonster", (ctx) => handleMinionMonster(ctx, gameStateService));

// /bingoset command
bot.command("bingoset", (ctx) => handleBingoSet(ctx, groupConfigService, bingoFundsService, botSettingsService, gameStateService));

// /bingopattern command
bot.command("bingopattern", (ctx) => handleBingoPattern(ctx, groupConfigService, gameStateService));

// /bingostart command
bot.command("bingostart", (ctx) => 
  handleBingoStart(ctx, gameStateService, groupConfigService, gameLogger, imageGenerationService, bingoFundsService, bingoGameSessionModel, userModel, bingoGamePlayerModel)
);

// /join command
bot.command("join", (ctx) =>
  handleJoin(ctx, bingoGameSessionModel, bingoGamePlayerModel, userModel, gameStateService, groupConfigService)
);

// /panalo command - leaderboard
bot.command("panalo", (ctx) =>
  handlePanalo(ctx, gameWinnerModel, imageGenerationService, groupConfigService)
);

// /panalov2 command - slideshow leaderboard
bot.command("panalov2", (ctx) =>
  handlePanaloV2(ctx, gameWinnerModel, imageGenerationService, imageUploadService)
);

// /bingorecap command - hidden owner-only recap slideshow
bot.command("bingorecap", (ctx) =>
  handleBingoRecap(ctx, gameWinnerModel, imageGenerationService, imageUploadService)
);

// /bingoflee command - leave a game
bot.command("bingoflee", (ctx) =>
  handleBingoFlee(ctx, bingoGameSessionModel, bingoGamePlayerModel, gameStateService, groupConfigService, userModel)
);

// /auqpala command - alias for flee
bot.command("auqpala", (ctx) =>
  handleBingoFlee(ctx, bingoGameSessionModel, bingoGamePlayerModel, gameStateService, groupConfigService, userModel)
);

// /bingoforce command
bot.command("bingoforce", (ctx) =>
  handleBingoForce(ctx, bingoGameSessionModel, bingoGamePlayerModel, groupConfigService)
);

// /bola command
bot.command("bola", (ctx) => 
  handleBola(ctx, gameStateService, groupConfigService, gameLogger, imageGenerationService, bingoFundsService, bingoGameSessionModel, gameWinnerModel, autoBolaManager)
);

// /autobola command
bot.command("autobola", (ctx) => handleAutoBola(ctx, groupConfigService, autoBolaManager));

// /bingo command - register winners by pattern name
bot.hears(/^\/bingo\s+(.+)$/i, (ctx) => handleBingoWinner(ctx, bingoGameSessionModel, bingoGamePlayerModel, gameWinnerModel, gameStateService, groupConfigService));

// /unbingo command - undo the latest winner registration for a player
bot.command("unbingo", (ctx) => handleUnbingo(ctx, bingoGameSessionModel, bingoGamePlayerModel, gameWinnerModel, gameStateService, groupConfigService));

// /lista command - display drawn items image
bot.command("lista", (ctx) => handleListaV2(ctx, gameStateService, imageGenerationService, bingoFundsService));

// /listav2 command - display drawn items table
bot.command("listav2", (ctx) => handleBingo(ctx, gameStateService, imageGenerationService, bingoFundsService));

// /tyn command - show remaining bingo items
bot.command("tyn", (ctx) => handleRemainingItems(ctx, gameStateService));

// Bingulo Beta theme-specific list commands
bot.command("listacomics", (ctx) => handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, "comics"));
bot.command("listatoystory", (ctx) => handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, "toy_story"));
bot.command("listanumbers", (ctx) => handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, "numbers"));
bot.command("listaspongebob", (ctx) => handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, "spongebob"));

bot.command("listacomicsv2", (ctx) => handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, "comics", true));
bot.command("listatoystoryv2", (ctx) => handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, "toy_story", true));
bot.command("listanumbersv2", (ctx) => handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, "numbers", true));
bot.command("listaspongebobv2", (ctx) => handleBinguloThemeLista(ctx, gameStateService, imageGenerationService, bingoFundsService, groupConfigService, "spongebob", true));

// /bingostop command
bot.command("bingostop", (ctx) => 
  handleBingoStop(ctx, gameStateService, gameLogger, imageGenerationService, bingoFundsService, bingoGameSessionModel, bingoGamePlayerModel, gameWinnerModel, userModel, groupConfigService)
);

// /setpremium command - control premium emoji status
bot.command("setpremium", (ctx) => handleSetPremium(ctx, botSettingsService));

// /shuffle and /shake commands - fun command during active games
bot.command("shuffle", (ctx) => handleShuffle(ctx, bingoGameSessionModel, botSettingsService));
bot.command("shake", (ctx) => handleShuffle(ctx, bingoGameSessionModel, botSettingsService));

// /bacs command - display BAC cards
bot.command("bacs", (ctx) => handleBacs(ctx));

// /givebac command - give BAC cards to players
bot.command("givebac", (ctx) => handleGiveBac(ctx, userModel, groupConfigService));
bot.command("takebac", (ctx) => handleTakeBac(ctx, userModel));

// /ban command - ban a player from joining (private chat only)
bot.command("ban", (ctx) => handleBan(ctx, userModel, bingoGameSessionModel, groupConfigService));

// Ban callback handler
bot.callbackQuery(/^ban_\d+_-?\d+$/, (ctx) => handleBanCallback(ctx, userModel, bingoGameSessionModel, bingoGamePlayer));

// /activate command - activate BAC cards
bot.command("activate", (ctx) => handleActivateBac(ctx, userModel, groupConfigService, bingoGameSessionModel));

// BAFM activation callback handler
bot.callbackQuery(/^activate_bafm_(yes|no)_/, (ctx) => handleBafmActivationCallback(ctx, userModel));

// /deactivate command - deactivate BAC cards
bot.command("deactivate", (ctx) => handleDeactivateBac(ctx, userModel));

// /mybingo command - display user stats and BAC cards
bot.command("mybingo", (ctx) => handleMybingo(ctx, userModel, gameWinnerModel));

// /cardsko command - manage reusable theme card links
bot.command("cardsko", (ctx) => handleCardsKo(ctx, userCardLinkModel));

// /pondo command
bot.command("pondo", (ctx) => handleBingoFunds(ctx, bingoFundsService, gameWinnerModel, groupConfigService));

// /bingofundsfrom command
bot.command("bingofundsfrom", (ctx) => 
  handleBingoFundsFrom(ctx, groupConfigService, bingoFundsService, gameStateService)
);

// /bingochannel command (DM-only interactive)
bot.command("bingochannel", (ctx) => handleBingoChannel(ctx, groupConfigService, gameStateService));

// /bolachannel command (group-only)
bot.command("bolachannel", (ctx) => handleBolaChannel(ctx, groupConfigService));

// /bolatimer command (group-only)
bot.command("bolatimer", (ctx) => handleBolaTimer(ctx, groupConfigService, bolaTimerManager));

// /adminfunds command - update admin funds for FP
bot.command("adminfunds", (ctx) => handleAdminFunds(ctx, groupConfigService));

// /bingobank command - update bingobank funds
bot.command("bingobank", (ctx) => handleBingobankFunds(ctx, groupConfigService));

// /setlog command - set log chat for fund tracking
bot.command("setlog", (ctx) => handleSetLog(ctx, groupConfigService));

// /spongebob command - now only works in private chat
bot.command("spongebob", (ctx) => handleSpongebob(ctx, gameStateService));

// Item status query (e.g., ?slurpee)
bot.hears(/^\?(.+)/, (ctx) => handleItemQuery(ctx, gameStateService, bingoFundsService));

// Candle emoji reaction
bot.hears(/🕯/, handleCandleEmoji);

// Pattern word reaction
bot.hears(/pattern/i, handlePatternWord);

// Callback query handler
bot.on("callback_query", (ctx) => 
  handleCallbackQuery(ctx, groupConfigService, bingoFundsService, gameStateService, bingoGameSessionModel, bingoGamePlayerModel, userModel, gameWinnerModel, userCardLinkModel)
);

// Single .rm command
bot.hears(/^\.rm\s+(.+)$/i, (ctx) => handleRmSingle(ctx, bingoFundsService, groupConfigService));

// Multi-line .rm command
bot.hears(/^\.rm\s+(.+)(\n.+)+$/i, (ctx) => handleRmMulti(ctx, bingoFundsService, groupConfigService));

// "sunday" easter egg — exact word only (not "sundays", no typos), DM only
bot.hears(/^sunday$/i, (ctx) => handleSunday(ctx));

// "toystory" easter egg — exact word only (no spaces, no typos), DM only
bot.hears(/^toystory$/i, (ctx) => handleToystory(ctx));

// Single name+amount and name-amount commands
bot.hears(/^([a-zA-Z0-9_@]+)\s*([+-])\s*(\d+)$/i, (ctx) => handleFundsAdjustment(ctx, bingoFundsService, groupConfigService));

// .go command for batch operations
bot.hears(/^\.go\s*\n.+/i, (ctx) => handleGoCommand(ctx, bingoFundsService, groupConfigService));

// .merge command for merging user funds
bot.hears(/^\.merge\s+.+,\s*.+$/i, (ctx) => handleMergeCommand(ctx, bingoFundsService, groupConfigService));

// .unmerge command for unmerging user funds
bot.hears(/^\.unmerge\s+.+$/i, (ctx) => handleUnmergeCommand(ctx, bingoFundsService, groupConfigService));

// Handle edited messages with .go
bot.on("edit:text", async (ctx) => {
  const text = ctx.editedMessage?.text || ctx.editedMessage?.caption;
  if (text && text.match(/^\.go\s*\n/i)) {
    await handleGoCommand(ctx, bingoFundsService, groupConfigService);
  }
  if (text && text.match(/^\.merge\s+.+,\s*.+$/i)) {
    await handleMergeCommand(ctx, bingoFundsService, groupConfigService);
  }
  if (text && text.match(/^\.unmerge\s+.+$/i)) {
    await handleUnmergeCommand(ctx, bingoFundsService, groupConfigService);
  }
});

// Handle JSON pattern input - only when user is in configuration mode
bot.on("message:text", async (ctx, next) => {
  const userId = ctx.from.id;
  if (await handleCardsKoLinkInput(ctx, userCardLinkModel)) {
    return;
  }
  const state = gameStateService.getPatternConfigurationState(userId);
  
  // Only process if user is in pattern configuration mode
  if (state && state.step === "awaiting_json" && ctx.chat.type === "private") {
    await handlePatternInput(ctx, groupConfigService, gameStateService);
  } else {
    // Let other handlers process this message
    await next();
  }
});

// Handle forwarded messages or manual input for pending /bingochannel flows
bot.on("message", async (ctx, next) => {
  try {
    if (ctx.chat.type !== "private") {
      return next();
    }

    const userId = ctx.from.id;
    const pending = getPendingChannelLink(userId);
    if (!pending) return next();

    const { groupId, mode } = pending;

    if (mode === "forward") {
      const forwarded = ctx.message && (ctx.message.forward_from_chat || ctx.message.forward_from_message?.chat);
      if (!forwarded) {
        await ctx.reply("⚠️ No forwarded channel message detected. Please forward a message from the channel.");
        return;
      }
      const channelId = forwarded.id;
      try {
        const updated = await groupConfigService.updateGroupChannel(groupId, channelId);
        if (updated) {
          await ctx.reply(`✅ Channel configured: ${channelId} for group ${groupId}`);
        } else {
          await ctx.reply("❌ Failed to set channel. Make sure the group was initialized with /bingoset.");
        }
      } catch (err) {
        console.error("Error updating group channel from forwarded message:", err);
        await ctx.reply("❌ Failed to set channel. Check logs.");
      } finally {
        clearPendingChannelLink(userId);
      }
      return;
    }

    if (mode === "manual") {
      const text = (ctx.message && ctx.message.text) ? ctx.message.text.trim() : "";
      if (!text) {
        await ctx.reply("⚠️ Please send the channel @username (e.g. @mychannel) or numeric channel ID.");
        return;
      }

      let identifier = text.split(" ")[0];
      try {
        let chatInfo = null;
        try {
          chatInfo = await ctx.api.getChat(identifier);
        } catch (e) {
          const numeric = Number(identifier.replace(/[^0-9-]/g, ""));
          if (Number.isFinite(numeric)) {
            chatInfo = await ctx.api.getChat(numeric);
          }
        }

        if (!chatInfo) {
          await ctx.reply("❌ Could not resolve the channel. Make sure the bot is added to the channel or provide a valid @username or numeric ID.");
          return;
        }

        const channelId = chatInfo.id;
        const updated = await groupConfigService.updateGroupChannel(groupId, channelId);
        if (updated) {
          await ctx.reply(`✅ Channel configured: ${channelId} for group ${groupId}`);
        } else {
          await ctx.reply("❌ Failed to set channel. Make sure the group was initialized with /bingoset.");
        }
      } catch (error) {
        console.error("Error resolving manual channel identifier:", error);
        await ctx.reply("❌ Failed to set channel. Check logs.");
      } finally {
        clearPendingChannelLink(userId);
      }
      return;
    }

    return next();
  } catch (error) {
    console.error("Error in pending /bingochannel message handler:", error);
    return next();
  }
});

// Error handler
bot.catch((err) => {
  console.error("Bot error:", err);
});

// Start bot
initializeServices()
  .then(() => {
    bot.start({ drop_pending_updates: true });
    console.log("[startup] Bot started");
  })
  .catch((error) => {
    console.error("Failed to start bot:", error);
    process.exit(1);
  });

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nStopping bot...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nStopping bot...");
  process.exit(0);
});