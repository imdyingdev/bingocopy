/**
 * Take BAC command - /takebac [user] [code] [quantity]
 * Allows admins to remove BAC cards from players.
 */

const VALID_BAC_CODES = ['BAFM', 'DPC', 'FP', 'DP', 'LEP', 'MCP', 'BBP', 'BLK', 'BAN', 'BBS'];

async function handleTakeBac(ctx, userModel) {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;

  if (!chatId || !userId) {
    await ctx.reply("❌ Unable to verify user permissions.");
    return;
  }

  try {
    const member = await ctx.api.getChatMember(chatId, userId);
    if (member?.status !== "administrator" && member?.status !== "creator") {
      await ctx.reply("🚫 This command can only be used by group administrators.");
      return;
    }
  } catch (error) {
    await ctx.reply("🚫 Unable to verify admin permissions.");
    return;
  }

  const args = String(ctx.message?.text || "").trim().split(/\s+/).slice(1);
  let targetUser;
  let codeIndex;

  if (ctx.message?.reply_to_message) {
    const repliedUserId = ctx.message.reply_to_message.from?.id;
    if (!repliedUserId || args.length < 1) {
      await ctx.reply("❌ Usage when replying: /takebac [code] [quantity]\nExample: /takebac MCP 1");
      return;
    }
    targetUser = await userModel.findByTelegramId(repliedUserId);
    codeIndex = 0;
  } else {
    if (args.length < 2) {
      await ctx.reply("❌ Usage: /takebac [user] [code] [quantity]\nExample: /takebac @username MCP 1");
      return;
    }
    const target = args[0].replace(/^@/, "");
    targetUser = /^\d+$/.test(target)
      ? await userModel.findByTelegramId(Number(target))
      : await userModel.findByUsername(target);
    codeIndex = 1;
  }

  if (!targetUser) {
    await ctx.reply("❌ User not found. Make sure they have started the bot with /start.");
    return;
  }

  const bacCode = String(args[codeIndex] || "").toUpperCase();
  if (!VALID_BAC_CODES.includes(bacCode)) {
    await ctx.reply(`❌ Invalid BAC code: ${bacCode}\n\nValid codes: ${VALID_BAC_CODES.join(', ')}`);
    return;
  }

  const quantityArg = args[codeIndex + 1];
  const quantity = quantityArg === undefined ? null : Number(quantityArg);
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) {
    await ctx.reply("❌ Quantity must be a positive whole number.");
    return;
  }

  const currentQuantity = await userModel.getBacCardQuantity(targetUser.telegram_id, bacCode);
  if (currentQuantity === 0) {
    await ctx.reply(`❌ ${targetUser.first_name || targetUser.username || 'User'} has no ${bacCode} cards.`);
    return;
  }
  if (quantity !== null && quantity > currentQuantity) {
    await ctx.reply(`❌ Cannot take ${quantity} ${bacCode} card(s). They only have ${currentQuantity}.`);
    return;
  }

  const removeCount = quantity || currentQuantity;
  for (let index = 0; index < removeCount; index++) {
    if (quantity === null) {
      await userModel.removeBacCard(targetUser.telegram_id, bacCode);
      break;
    }
    await userModel.decrementBacCard(targetUser.telegram_id, bacCode);
  }

  const remaining = await userModel.getBacCardQuantity(targetUser.telegram_id, bacCode);
  if (remaining === 0 && await userModel.isBacActivated(targetUser.telegram_id, bacCode)) {
    await userModel.deactivateBac(targetUser.telegram_id, bacCode);
  }

  const targetName = targetUser.first_name || targetUser.username || targetUser.telegram_id;
  await ctx.reply(`✅ Removed ${removeCount} ${bacCode} card${removeCount === 1 ? '' : 's'} from ${targetName}.`);
}

module.exports = { handleTakeBac };