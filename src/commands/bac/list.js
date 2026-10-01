/**
 * BAC (Bingo Advantage Cards) command - displays available BAC cards
 */

async function handleBacs(ctx) {
  // Admin-only check
  try {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    
    if (!userId || !chatId) {
      await ctx.reply("❌ Unable to verify user permissions.");
      return;
    }

    // Check if user is admin via Telegram API
    if (ctx.api?.getChatMember) {
      try {
        const chatMember = await ctx.api.getChatMember(chatId, userId);
        const isAdminStatus = chatMember?.status === "administrator" || chatMember?.status === "creator";
        
        if (!isAdminStatus) {
          await ctx.reply("🚫 This command can only be used by group administrators.");
          return;
        }
      } catch (error) {
        console.warn("Telegram admin lookup failed:", error.message);
        await ctx.reply("🚫 Unable to verify admin permissions.");
        return;
      }
    } else {
      await ctx.reply("🚫 Unable to verify admin permissions.");
      return;
    }
  } catch (error) {
    console.error("Admin check error:", error);
    await ctx.reply("🚫 Unable to verify admin permissions.");
    return;
  }

  try {
    // Create expandable quote format with BAC cards
    let message = "<b>🎴 Bingo Advantage Cards (BAC)</b>\n\n";
    message += "<blockquote expandable>";
    
    // Basic BAC cards with links (bold) and codes
    message += '<a href="https://t.me/bacstimech/7"><b>👑 Be an Admin for a Month</b></a> <code>BAFM</code>\n';
    message += '<a href="https://t.me/bacstimech/8"><b>💰 Double Prize Card</b></a> <code>DPC</code>\n';
    message += '<a href="https://t.me/bacstimech/9"><b>🎫 Free Pass</b></a> <code>FP</code>\n';
    message += '<a href="https://t.me/bacstimech/10"><b>🏷️ Discount Pass</b></a> <code>DP</code>\n';
    message += '<a href="https://t.me/bacstimech/11"><b>⏰ Late Entry Pass</b></a> <code>LEP</code>\n';
    message += '<a href="https://t.me/bacstimech/12"><b>🛡️ Missed Call Protection</b></a> <code>MCP</code>\n';
    message += '<a href="https://t.me/bacstimech/13"><b>🍀 Bad Bingo Protection</b></a> <code>BBP</code>\n';
    message += '<a href="https://t.me/bacstimech/14"><b>🚫 Block a Player Card</b></a> <code>BLK</code>\n';
    message += '<a href="https://t.me/bacstimech/15"><b>🔨 Ban a Player Card</b></a> <code>BAN</code>\n';
    message += '<a href="https://t.me/bacstimech/16"><b>🏦 Bingo Bank Shield</b></a> <code>BBS</code>\n';
    
    message += "</blockquote>";
    
    message += "\n<i>Use /givebac [code]\nto give a BAC to a player.</i>";
    
    await ctx.reply(message, { 
      parse_mode: "HTML",
      disable_web_page_preview: true
    });
  } catch (error) {
    console.error("Error in /bacs command:", error);
    await ctx.reply("❌ Failed to load BAC cards. Please try again.");
  }
}

module.exports = { handleBacs };
