/**
 * Set Premium command: /setpremium on|off|status
 * Admin-only command to manually control premium emoji status
 */

const { BOT_OWNER_ID, getPremiumStatus, setPremiumStatus, forcePremiumCheck } = require("./sharedState");
const { testPremiumEmojiStatus } = require("./helpers");

async function handleSetPremium(ctx, botSettingsService) {
  // Only allow bot owner and only in private messages
  if (ctx.from.id !== BOT_OWNER_ID) {
    await ctx.reply("❌ This command is only available to the bot owner.");
    return;
  }

  if (ctx.chat.type !== "private") {
    await ctx.reply("❌ This command can only be used in private messages to the bot.");
    return;
  }

  const args = ctx.message.text.split(' ').slice(1);
  const action = args[0]?.toLowerCase();

  if (!action) {
    const status = await getPremiumStatus();
    const statusText = status === null ? "⏳ Not checked yet" : (status ? "✅ Active" : "❌ Inactive");
    await ctx.reply(
      "📋 <b>Premium Emoji Control</b>\n\n" +
      "Usage: /setpremium <action>\n\n" +
      "Actions:\n" +
      "• <code>on</code> - Force re-check and enable premium emoji\n" +
      "• <code>off</code> - Manually disable premium emoji\n" +
      "• <code>status</code> - Show current premium status\n\n" +
      `Current status: ${statusText}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (action === 'status') {
    const status = await getPremiumStatus();
    const statusText = status === null ? "⏳ Not checked yet" : (status ? "✅ Active" : "❌ Inactive");
    await ctx.reply(
      `📊 <b>Premium Emoji Status</b>\n\n` +
      `Status: ${statusText}\n\n` +
      `Use <code>/setpremium on</code> to force re-check or <code>/setpremium off</code> to disable.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (action === 'on') {
    await ctx.reply("🔄 Testing premium emoji status...");
    
    // Force re-check by resetting cache
    forcePremiumCheck();
    
    // Run test
    const testResult = await testPremiumEmojiStatus(ctx, BOT_OWNER_ID);
    await setPremiumStatus(testResult);
    
    if (testResult) {
      await ctx.reply("✅ Premium emoji is now ACTIVE. Custom emojis will be used in themed messages.");
    } else {
      await ctx.reply("❌ Premium emoji test FAILED. Plain emojis will be used instead.");
    }
    return;
  }

  if (action === 'off') {
    await setPremiumStatus(false);
    await ctx.reply("❌ Premium emoji manually DISABLED. Plain emojis will be used in all messages.");
    return;
  }

  // Invalid action
  await ctx.reply(
    "❌ Invalid action. Use: <code>/setpremium on|off|status</code>",
    { parse_mode: "HTML" }
  );
}

module.exports = { handleSetPremium };
