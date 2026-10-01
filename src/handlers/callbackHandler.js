/**
 * Callback query handler for inline buttons
 * Routes callback queries to appropriate handler modules
 */

const { handleJoinGameCallback } = require("./callbacks/joinCallbackHandler");
const { handleLeaveGameCallback } = require("./callbacks/leaveCallbackHandler");
const { handleSelectGroupPatternCallback, handleSelectPatternsCallback } = require("./callbacks/patternCallbackHandler");
const {
  handleSelectBingoChannelGroupCallback,
  handleBingoChannelForwardCallback,
  handleBingoChannelManualCallback,
  handleBingoChannelClearCallback,
  handleBingoChannelCancelCallback,
} = require("./callbacks/channelCallbackHandler");
const { handleSelectGroupForThemeCallback, handleSelectThemeCallback } = require("./callbacks/themeCallbackHandler");
const { handleSelectFundsGroupCallback } = require("./callbacks/fundsCallbackHandler");
const { handleWinnerConfirmationCallback } = require("./callbacks/winnerCallbackHandler");
const { handleMybingoToggleCallback } = require("./callbacks/mybingoCallbackHandler");
const { handleApproveGroupSetupCallback, handleRejectGroupSetupCallback } = require("./callbacks/setupCallbackHandler");
const { handleCardsKoThemeCallback } = require("../commands/misc/cardsko");

async function handleCallbackQuery(ctx, groupConfigService, bingoFundsService, gameStateService, bingoGameSession, bingoGamePlayer, userModel, gameWinnerModel, userCardLinkModel) {
  const callbackData = ctx.callbackQuery.data;

  if (callbackData.startsWith("cardsko_theme_")) {
    await handleCardsKoThemeCallback(ctx);
    return;
  }

  if (callbackData.startsWith("approve_group_setup_")) {
    await handleApproveGroupSetupCallback(ctx, groupConfigService);
    return;
  }

  if (callbackData.startsWith("reject_group_setup_")) {
    await handleRejectGroupSetupCallback(ctx, groupConfigService);
    return;
  }

  // Handle join game button
  if (callbackData.startsWith("join_game_")) {
    await handleJoinGameCallback(ctx, groupConfigService, gameStateService, bingoGameSession, bingoGamePlayer, userModel);
    return;
  }

  // Handle leave game button
  if (callbackData.startsWith("leave_game_")) {
    await handleLeaveGameCallback(ctx, bingoGameSession, bingoGamePlayer, userModel);
    return;
  }

  // Pattern callbacks
  if (callbackData.startsWith("select_group_pattern_")) {
    await handleSelectGroupPatternCallback(ctx, groupConfigService, gameStateService);
    return;
  }

  if (callbackData.startsWith("select_patterns_")) {
    await handleSelectPatternsCallback(ctx, groupConfigService, gameStateService, bingoGameSession, bingoGamePlayer);
    return;
  }

  // Channel callbacks
  if (callbackData.startsWith("select_bingochannel_group_")) {
    await handleSelectBingoChannelGroupCallback(ctx, groupConfigService);
    return;
  }

  if (callbackData.startsWith("bingochannel_forward_")) {
    await handleBingoChannelForwardCallback(ctx);
    return;
  }

  if (callbackData.startsWith("bingochannel_manual_")) {
    await handleBingoChannelManualCallback(ctx);
    return;
  }

  if (callbackData.startsWith("bingochannel_clear_")) {
    await handleBingoChannelClearCallback(ctx, groupConfigService);
    return;
  }

  if (callbackData.startsWith("bingochannel_cancel_")) {
    await handleBingoChannelCancelCallback(ctx);
    return;
  }

  // Funds callback
  if (callbackData.startsWith("select_funds_group_")) {
    await handleSelectFundsGroupCallback(ctx, groupConfigService, bingoFundsService, gameStateService);
    return;
  }

  // Theme callbacks
  if (callbackData.startsWith("select_group_for_theme_")) {
    await handleSelectGroupForThemeCallback(ctx, groupConfigService);
    return;
  }

  if (callbackData.startsWith("select_theme_")) {
    await handleSelectThemeCallback(ctx, groupConfigService, gameStateService);
    return;
  }

  // Winner confirmation callback
  if (callbackData.startsWith("confirm_winner_") || callbackData.startsWith("reject_winner_")) {
    await handleWinnerConfirmationCallback(ctx, groupConfigService, bingoGameSession, bingoGamePlayer, userModel, gameWinnerModel, gameStateService);
    return;
  }

  // Mybingo toggle callback
  if (callbackData.startsWith("mybingo_toggle_")) {
    await handleMybingoToggleCallback(ctx, userModel, gameWinnerModel);
    return;
  }
}

module.exports = {
  handleCallbackQuery,
};