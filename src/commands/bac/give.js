/**
 * Give BAC command - /givebac [user] [code]
 * Allows admins to give BAC cards to players
 */

function getBacCardCopies(bacCode) {
  if (bacCode === 'FP') return 2;
  if (bacCode === 'BAN' || bacCode === 'LEP' || bacCode === 'BLK' || bacCode === 'DPC') return 3;
  if (bacCode === 'MCP') return 2;
  if (bacCode === 'BBS') return 4;
  return 1;
}

function canDuplicateBacCard(bacCode) {
  return ['FP', 'BAN', 'LEP', 'MCP', 'BLK', 'BBS', 'DPC'].includes(bacCode);
}

async function handleGiveBac(ctx, userModel, groupConfigService) {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  
  // Admin-only check
  try {
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

  // Parse command arguments
  const args = ctx.message.text.split(' ').slice(1);
  
  // Determine target user
  let targetUser;
  let bacCode;
  let customQuantity = null;

  // Check if replying to a message
  if (ctx.message.reply_to_message) {
    const repliedUserId = ctx.message.reply_to_message.from?.id;
    if (!repliedUserId) {
      await ctx.reply("❌ Could not identify the user from the replied message.");
      return;
    }
    
    // If replying, need at least 1 arg (the BAC code)
    if (args.length < 1) {
      await ctx.reply(
        "❌ Usage when replying: /givebac [code] [quantity]\n\n" +
        "Example: /givebac LEP\n" +
        "Example: /givebac BBS 2\n\n" +
        "Available BAC codes:\n" +
        "BAFM - Be An Admin For a Month\n" +
        "DPC - Double Prize Card\n" +
        "FP - Free Pass\n" +
        "DP - Discount Pass\n" +
        "LEP - Late Entry Pass\n" +
        "MCP - Missed Call Protection\n" +
        "BBP - Bad Bingo Protection\n" +
        "BLK - Block a Player Card\n" +
        "BAN - Ban a Player Card\n" +
        "BBS - Bingo Bank Shield",
        { parse_mode: "HTML" }
      );
      return;
    }
    
    // If replying, the first arg is the BAC code, optional second arg is quantity
    bacCode = args[0].toUpperCase();
    if (args.length >= 2) {
      const quantity = parseInt(args[1], 10);
      if (!isNaN(quantity) && quantity > 0) {
        customQuantity = quantity;
      }
    }
    targetUser = await userModel.findByTelegramId(repliedUserId);
  } else {
    // Not replying, need at least 2 args (user and BAC code)
    if (args.length < 2) {
      await ctx.reply(
        "❌ Usage: /givebac [user] [code] [quantity]\n\n" +
        "Examples:\n" +
        "/givebac @username LEP\n" +
        "/givebac 123456789 LEP\n" +
        "/givebac @username BBS 2\n\n" +
        "Or reply to a user's message and use:\n" +
        "/givebac LEP\n" +
        "/givebac BBS 2\n\n" +
        "Available BAC codes:\n" +
        "BAFM - Be An Admin For a Month\n" +
        "DPC - Double Prize Card\n" +
        "FP - Free Pass\n" +
        "DP - Discount Pass\n" +
        "LEP - Late Entry Pass\n" +
        "MCP - Missed Call Protection\n" +
        "BBP - Bad Bingo Protection\n" +
        "BLK - Block a Player Card\n" +
        "BAN - Ban a Player Card\n" +
        "BBS - Bingo Bank Shield",
        { parse_mode: "HTML" }
      );
      return;
    }
    
    // Not replying, first arg is user, second is BAC code, optional third arg is quantity
    const userIdentifier = args[0].replace('@', '');
    bacCode = args[1].toUpperCase();
    if (args.length >= 3) {
      const quantity = parseInt(args[2], 10);
      if (!isNaN(quantity) && quantity > 0) {
        customQuantity = quantity;
      }
    }
    
    // Try to find by username or telegram ID
    const isNumeric = /^\d+$/.test(userIdentifier);
    if (isNumeric) {
      targetUser = await userModel.findByTelegramId(parseInt(userIdentifier, 10));
    } else {
      targetUser = await userModel.findByUsername(userIdentifier);
    }
  }

  if (!targetUser) {
    await ctx.reply("❌ User not found. Make sure they have started the bot with /start.");
    return;
  }

  // Validate BAC code
  const validBacCodes = ['BAFM', 'DPC', 'FP', 'DP', 'LEP', 'MCP', 'BBP', 'BLK', 'BAN', 'BBS'];
  if (!validBacCodes.includes(bacCode)) {
    await ctx.reply(
      `❌ Invalid BAC code: ${bacCode}\n\n` +
      `Valid codes: ${validBacCodes.join(', ')}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // For BAFM, check if target is already admin or owner
  if (bacCode === 'BAFM') {
    try {
      const targetMember = await ctx.api.getChatMember(chatId, targetUser.telegram_id);
      const isTargetOwner = targetMember?.status === "creator";
      const isTargetAdmin = targetMember?.status === "administrator";
      
      if (isTargetOwner) {
        await ctx.reply(
          `❌ Cannot give this card to the group owner. It can only be given to regular members.`,
          { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
        );
        return;
      }
      
      if (isTargetAdmin) {
        await ctx.reply(
          `❌ Cannot give this card to an administrator. It can only be given to regular members.`,
          { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
        );
        return;
      }
    } catch (memberError) {
      console.error("Error checking target member status:", memberError);
      await ctx.reply(
        "❌ Unable to verify target user's admin status. Please try again.",
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
      return;
    }
  }

  // Check if user already has this BAC card; FP, BAN, LEP, MCP, and BBS can have duplicates
  const userBacCards = targetUser.bac_cards || [];
  if (userBacCards.includes(bacCode) && !canDuplicateBacCard(bacCode)) {
    const displayName = targetUser.first_name || targetUser.username || "User";
    await ctx.reply(
      `⚠️ ${displayName} already has the ${bacCode} BAC card.`,
      { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  // Add BAC card to user (FP gets 2 copies, BAN, LEP, and BLK get 3 copies, BBS gets 4 copies by default)
  try {
    let updatedUser;
    // Use custom quantity if provided, otherwise use default
    const copiesToAdd = customQuantity !== null ? customQuantity : getBacCardCopies(bacCode);

    for (let i = 1; i < copiesToAdd; i++) {
      await userModel.addBacCard(targetUser.telegram_id, bacCode);
    }
    updatedUser = await userModel.addBacCard(targetUser.telegram_id, bacCode);
    
    const displayName = targetUser.first_name || targetUser.username || "User";
    const quantityText = copiesToAdd > 1 ? ` (${copiesToAdd})` : '';
    const bacNames = {
      'BAFM': '👑 Be An Admin For a Month',
      'DPC': '💰 Double Prize Card',
      'FP': '🎫 Free Pass',
      'DP': '🏷️ Discount Pass',
      'LEP': '⏰ Late Entry Pass',
      'MCP': '🛡️ Missed Call Protection',
      'BBP': '🍀 Bad Bingo Protection',
      'BLK': '🚫 Block a Player Card',
      'BAN': '🔨 Ban a Player Card',
      'BBS': '🏦 Bingo Bank Shield'
    };
    
    // Handle BAFM - set expiry but don't auto-promote
    if (bacCode === 'BAFM') {
      try {
        // Calculate expiry: 1st day of next month at 00:00 PH time (UTC+8)
        const now = new Date();
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        // Set to PH time (UTC+8) - we'll store as UTC timestamp
        const expiryDate = new Date(nextMonth.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
        
        await userModel.setTempAdminExpiry(targetUser.telegram_id, expiryDate, chatId);
        
        await ctx.reply(
          `✅ Successfully gave <b>${displayName}</b> the <b>${bacNames[bacCode]}</b> BAC card${quantityText}!\n\n� Use /activate BAFM to activate this card and promote yourself to admin.`,
          { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
        );
      } catch (expiryError) {
        console.error("Error setting temp admin expiry:", expiryError);
        await ctx.reply(
          `✅ Successfully gave <b>${displayName}</b> the <b>${bacNames[bacCode]}</b> BAC card${quantityText}!\n\n⚠️ Failed to set admin expiry. Please set manually.`,
          { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
        );
      }
    } else {
      await ctx.reply(
        `✅ Successfully gave <b>${displayName}</b> the <b>${bacNames[bacCode] || bacCode}</b> BAC card${quantityText}!`,
        { parse_mode: "HTML", reply_to_message_id: ctx.message.message_id }
      );
    }
  } catch (error) {
    console.error("Error adding BAC card:", error);
    await ctx.reply("❌ Failed to add BAC card. Please try again.");
  }
}

module.exports = { handleGiveBac, getBacCardCopies, canDuplicateBacCard };
