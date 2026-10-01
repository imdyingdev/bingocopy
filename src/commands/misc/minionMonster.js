/** Toggle the temporary red Minions /bola palette for an active Minions game. */
async function handleMinionMonster(ctx, gameStateService) {
  if (ctx.chat.type === "private") return;

  const chatId = ctx.chat.id;
  const game = gameStateService.getBingoGame(chatId);
  if (!game || gameStateService.getTheme(chatId) !== "minions") return;

  const enabled = !gameStateService.getMinionMonsterMode(chatId);
  gameStateService.setMinionMonsterMode(chatId, enabled);
  await ctx.reply(enabled ? "🔴 Minion monster mode enabled." : "🟡 Minion monster mode disabled.");
}

module.exports = { handleMinionMonster };