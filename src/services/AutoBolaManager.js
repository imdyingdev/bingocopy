/**
 * Manages finite, manually triggered auto-bola cycles per group.
 */

class AutoBolaManager {
  constructor(bot, gameStateService, groupConfigService, imageGenerationService, bingoFundsService, bingoGameSessionModel, gameWinnerModel, gameLogger) {
    this.bot = bot;
    this.gameStateService = gameStateService;
    this.groupConfigService = groupConfigService;
    this.imageGenerationService = imageGenerationService;
    this.bingoFundsService = bingoFundsService;
    this.bingoGameSessionModel = bingoGameSessionModel;
    this.gameWinnerModel = gameWinnerModel;
    this.gameLogger = gameLogger;
    this.cycles = new Map();
  }

  async executeDraw(groupId, userId, count) {
    const game = this.gameStateService.getBingoGame(groupId);
    if (!game) {
      console.log(`No active game for auto-bola in group ${groupId}`);
      return;
    }

    const { handleBola } = require("../commands/bingo/bola");
    const mockCtx = {
      chat: { id: groupId, type: "group" },
      from: { id: userId },
      message: { text: `/bola ${count}` },
      match: String(count),
      isAutoBola: true,
      api: this.bot.api,
      reply: (message, options) => this.bot.api.sendMessage(groupId, message, options),
      replyWithPhoto: (photo, options) => this.bot.api.sendPhoto(groupId, photo, options),
      replyWithChatAction: (action) => this.bot.api.sendChatAction(groupId, action),
      sendRichMessage: (chatId, message) => this.bot.api.sendRichMessage(chatId, message),
      deleteMessage: async () => {},
    };

    await handleBola(
      mockCtx,
      this.gameStateService,
      this.groupConfigService,
      this.gameLogger,
      this.imageGenerationService,
      this.bingoFundsService,
      this.bingoGameSessionModel,
      this.gameWinnerModel,
      this,
    );
  }

  start(groupId, userId, count, intervalSeconds) {
    this.stop(groupId);

    const cycle = {
      userId,
      count,
      intervalMs: intervalSeconds * 1000,
      timeoutId: null,
    };
    this.cycles.set(groupId, cycle);

    return this.runNext(groupId, cycle);
  }

  async runNext(groupId, cycle) {
    if (this.cycles.get(groupId) !== cycle) return;

    try {
      await this.executeDraw(groupId, cycle.userId, cycle.count);
    } catch (error) {
      console.error(`Error executing auto-bola for group ${groupId}:`, error);
    }

    if (this.cycles.get(groupId) !== cycle) return;

    cycle.timeoutId = setTimeout(() => {
      cycle.timeoutId = null;
      this.runNext(groupId, cycle);
    }, cycle.intervalMs);
  }

  stop(groupId) {
    const cycle = this.cycles.get(groupId);
    if (!cycle) return false;

    if (cycle.timeoutId) clearTimeout(cycle.timeoutId);
    this.cycles.delete(groupId);
    return true;
  }

  isActive(groupId) {
    return this.cycles.has(groupId);
  }
}

module.exports = AutoBolaManager;
