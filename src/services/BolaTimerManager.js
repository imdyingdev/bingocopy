/**
 * BolaTimerManager - Manages automatic bola timer per group
 */

class BolaTimerManager {
  constructor(bot, gameStateService, groupConfigService, imageGenerationService, bingoFundsService, bingoGameSessionModel, gameWinnerModel) {
    this.bot = bot;
    this.gameStateService = gameStateService;
    this.groupConfigService = groupConfigService;
    this.imageGenerationService = imageGenerationService;
    this.bingoFundsService = bingoFundsService;
    this.bingoGameSessionModel = bingoGameSessionModel;
    this.gameWinnerModel = gameWinnerModel;
    
    // Map of groupId -> intervalId
    this.timers = new Map();
  }

  getDrawCount(drawCount) {
    // Pattern: 1-15 draws -> bola 3, 16-24 draws -> bola 2, 24+ draws -> bola 1
    if (drawCount <= 15) return 3;
    if (drawCount <= 24) return 2;
    return 1;
  }

  async executeBolaDraw(groupId) {
    try {
      // Get the game state
      const game = this.gameStateService.getBingoGame(groupId);
      if (!game) {
        console.log(`No active game for group ${groupId}, skipping bola timer draw`);
        return;
      }

      // Calculate draw count based on pattern
      const currentDrawCount = game.selected ? game.selected.size : 0;
      const toDraw = this.getDrawCount(currentDrawCount);

      // Create a mock context for the bola handler
      const mockCtx = {
        chat: { id: groupId, type: 'group' },
        from: { id: 0 }, // System user
        message: { text: `/bola ${toDraw}` },
        api: this.bot.api,
        reply: async (msg, opts) => this.bot.api.sendMessage(groupId, msg, opts),
        replyWithPhoto: async (photo, opts) => this.bot.api.sendPhoto(groupId, photo, opts),
        replyWithChatAction: async (action) => this.bot.api.sendChatAction(groupId, action),
        deleteMessage: async () => {}, // No-op for timer
      };

      // Import and call the bola handler
      const { handleBola } = require('../commands/bingo/bola');
      await handleBola(
        mockCtx,
        this.gameStateService,
        this.groupConfigService,
        null, // gameLogger - not needed for timer
        this.imageGenerationService,
        this.bingoFundsService,
        this.bingoGameSessionModel,
        this.gameWinnerModel
      );

      console.log(`Bola timer executed for group ${groupId}, drew ${toDraw} items`);
    } catch (error) {
      console.error(`Error executing bola timer for group ${groupId}:`, error);
    }
  }

  startTimer(groupId, intervalSeconds) {
    // Stop existing timer if any
    this.stopTimer(groupId);

    const intervalMs = intervalSeconds * 1000;
    console.log(`Starting bola timer for group ${groupId} with interval ${intervalSeconds}s`);

    const intervalId = setInterval(() => {
      this.executeBolaDraw(groupId);
    }, intervalMs);

    this.timers.set(groupId, intervalId);
  }

  stopTimer(groupId) {
    const intervalId = this.timers.get(groupId);
    if (intervalId) {
      clearInterval(intervalId);
      this.timers.delete(groupId);
      console.log(`Stopped bola timer for group ${groupId}`);
    }
  }

  stopAllTimers() {
    for (const [groupId, intervalId] of this.timers) {
      clearInterval(intervalId);
    }
    this.timers.clear();
    console.log('Stopped all bola timers');
  }

  isTimerRunning(groupId) {
    return this.timers.has(groupId);
  }
}

module.exports = BolaTimerManager;
