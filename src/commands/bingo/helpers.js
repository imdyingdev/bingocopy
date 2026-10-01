/**
 * Helper functions for bingo commands
 */

const { InputFile } = require("grammy");
const { compareSortableValues } = require("../../utils/helpers");
const { IMAGE_ENABLED } = require("../../utils/imageSettings");
const { THEME_EMOJIS } = require("../../constants/themeEmojis");

function buildJoinRichMessage(playersText, gifUrl, joinButtonText, sessionId, customEmojiId = null, audioUrl = null, isRaid = false) {
  // Convert newlines to <br> tags for rich message HTML rendering
  const formattedPlayersText = String(playersText)
    .replace(/Players Joined:/g, "__PLAYERS_JOINED__")
    .replace(/__PLAYERS_JOINED__/g, "<b>Players Joined:</b>")
    .replace(/<b>Use \/bingoforce to start the game<\/b>|Use \/bingoforce to start the game/g, "<i>Use /bingoforce to start the game</i>")
    .replace(/\r?\n/g, "<br>");
  
  let media = "";
  if (audioUrl) {
    media = `<audio src="${audioUrl}"></audio>`;
  }
  
  // For raid mode, put header above video with large text
  if (isRaid) {
    const raidHeader = "<h3>⚔️ Bingo Raid!</h3>";
    if (gifUrl) {
      media += `${raidHeader}<video src="${gifUrl}"></video><p>${formattedPlayersText}</p>`;
    } else {
      media += `${raidHeader}<p>${formattedPlayersText}</p>`;
    }
  } else {
    // Normal mode: video first, then players text
    if (gifUrl) {
      media += `<video src="${gifUrl}"></video><p>${formattedPlayersText}</p>`;
    } else {
      media += `<p>${formattedPlayersText}</p>`;
    }
  }
  
  // Strip emoji from button text if custom emoji is provided
  const cleanButtonText = customEmojiId 
    ? joinButtonText.replace(/^[\p{Emoji}\p{Emoji_Presentation}]\s*/u, '')
    : joinButtonText;
  
  const buttonText = customEmojiId
    ? `<tg-emoji emoji-id="${customEmojiId}">⭐</tg-emoji> ${cleanButtonText}`
    : cleanButtonText;

  return {
    html: `${media}
<tg-button-row align="center">
  <tg-button type="callback_data" style="success" data="join_game_${sessionId}">${buttonText}</tg-button>
  <tg-button type="callback_data" style="danger" data="leave_game_${sessionId}">🚪 Leave</tg-button>
</tg-button-row>`,
  };
}

/**
 * Build plain HTML message for edits (without rich message tags)
 * Returns object with text and inline keyboard for use with editMessageText
 */
function buildJoinPlainMessage(playersText, gifUrl, joinButtonText, sessionId, customEmojiId = null, isRaid = false) {
  // Preserve newlines - Telegram HTML parse_mode doesn't support <br> tags
  const formattedPlayersText = String(playersText)
    .replace(/Players Joined:/g, "__PLAYERS_JOINED__")
    .replace(/__PLAYERS_JOINED__/g, "<b>Players Joined:</b>")
    .replace(/<b>Use \/bingoforce to start the game<\/b>|Use \/bingoforce to start the game/g, "<i>Use /bingoforce to start the game</i>");
  
  // Build the message text
  let messageText = "";
  if (isRaid) {
    messageText = `⚔️ <b>Bingo Raid!</b>\n\n${formattedPlayersText}`;
  } else if (gifUrl) {
    messageText = `<a href="${gifUrl}">🎮</a>\n\n${formattedPlayersText}`;
  } else {
    messageText = formattedPlayersText;
  }
  
  // Strip emoji from button text if custom emoji is provided
  const cleanButtonText = customEmojiId 
    ? joinButtonText.replace(/^[\u{1F300}-\u{1F9FF}]\s*/u, '')
    : joinButtonText;
  
  return {
    text: messageText,
    reply_markup: {
      inline_keyboard: [[
        { text: cleanButtonText, callback_data: `join_game_${sessionId}` },
        { text: "🚪 Leave", callback_data: `leave_game_${sessionId}` }
      ]]
    }
  };
}

/**
 * Helper: Create drawn items table (horizontal format with categories as headers)
 * Only shows columns that have drawn items
 * Returns HTML table or null if error
 */
function createDrawnItemsTable(game) {
  try {
    if (!game.drawOrder || game.drawOrder.length === 0) {
      return null; // No drawn items
    }

    const categoryMap = new Map();
    game.drawOrder.forEach(([cat, val]) => {
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, []);
      }
      categoryMap.get(cat).push(val);
    });

    // Sort items within each category in ascending order
    categoryMap.forEach((items) => {
      items.sort((a, b) => compareSortableValues(a, b));
    });

    // Get all categories from card (in card order), not just categories with drawn items
    const categoriesWithItems = [];
    if (game.card) {
      game.card.forEach((col) => {
        categoriesWithItems.push(col.category);
      });
    }

    if (categoriesWithItems.length === 0) {
      return null; // No categories
    }

    // Find max number of items in any category
    let maxItems = 0;
    categoriesWithItems.forEach((cat) => {
      const items = categoryMap.get(cat);
      const itemCount = items ? items.length : 0;
      if (itemCount > maxItems) {
        maxItems = itemCount;
      }
    });

    // Build horizontal table: each item on separate row
    let table = '<table bordered>\n';

    // Header row with categories
    table += '  <tr>\n';
    categoriesWithItems.forEach((cat) => {
      table += `    <th>${cat}</th>\n`;
    });
    table += '  </tr>\n';

    // Data rows: one row per item level
    for (let i = 0; i < maxItems; i++) {
      table += '  <tr>\n';
      categoriesWithItems.forEach((cat) => {
        const items = categoryMap.get(cat);
        const item = (items && items[i]) ? items[i] : ""; // Empty cell if this category has fewer items or no items
        table += `    <td>${item}</td>\n`;
      });
      table += '  </tr>\n';
    }

    table += '</table>';
    return table;
  } catch (error) {
    console.error("[tabla-error] createDrawnItemsTable failed:", error);
    return null;
  }
}

/**
 * Helper: Stream drawn items table (for private chats only)
 * Streams with animation effect using editMessageText
 */
async function streamDrawnItemsTable(ctx, game) {
  try {
    const drawnTable = createDrawnItemsTable(game);

    if (!drawnTable) {
      return false;
    }

    console.log("[stream-start] Starting to stream table...");

    // Send initial message with "loading" indicator
    let message = await ctx.reply("📊 <b>Drawn Items:</b>\n<i>Loading...</i>", {
      parse_mode: "HTML",
    });

    // Stream by editing message with loading animation
    for (let i = 0; i < 8; i++) {
      const dots = "".repeat(i % 4);
      const updatedContent = `📊 <b>Drawn Items:</b>\n<i>Loading${dots}   </i>`;
      
      try {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, updatedContent, {
          parse_mode: "HTML",
        });
      } catch (e) {
        // Too fast, skip intermediate update
      }

      await new Promise(r => setTimeout(r, 150));
    }

    // Send final version with table using sendRichMessage
    try {
      const richMsg = await ctx.api.sendRichMessage(ctx.chat.id, {
        html: `<h2>📊 Drawn Items\n</h2>
${drawnTable}`,
      }, { reply_to_message_id: ctx.message.message_id });
      
      console.log("[stream-success] Rich message table sent");
      
      // Delete the loading message
      try {
        await ctx.api.deleteMessage(ctx.chat.id, message.message_id);
      } catch (e) {
        // Ignore deletion errors
      }
      
      return true;
    } catch (finalError) {
      console.error("[stream-final-error] sendRichMessage failed:", finalError.message);
      
      // Fallback: update loading message with simple text
      try {
        await ctx.api.editMessageText(ctx.chat.id, message.message_id, 
          `📊 <b>Drawn Items</b>`,
          { parse_mode: "HTML" }
        );
      } catch (e) {
        console.error("[stream-fallback-error]", e.message);
      }
      
      return true;
    }
  } catch (error) {
    console.error("[stream-error] Streaming failed:", error.message);
    return false;
  }
}

function formatDuration(ms) {
  if (!ms || ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatDrawnItemsText(game, title = "📊 Drawn Items") {
  const escapeHtml = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const categories = new Map();

  (game.drawOrder || []).forEach(([category, value]) => {
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(value);
  });

  if (categories.size === 0) {
    (game.card || []).forEach((column) => {
      const values = (column.items || []).filter((item) => item.selected).map((item) => item.value);
      if (values.length) categories.set(column.category, values);
    });
  }

  if (categories.size === 0) return `${title}\n\nNo items drawn yet.`;
  const lines = Array.from(categories, ([category, values]) =>
    `<b>${escapeHtml(category)}:</b> ${values.map(escapeHtml).join(", ")}`
  );
  return `${title}\n\n${lines.join("\n")}`;
}

async function displayBingoCard(ctx, game, imageGenerationService, overrideThemeId = null) {
  if (!IMAGE_ENABLED) {
    await ctx.reply(formatDrawnItemsText(game), { parse_mode: "HTML" });
    return;
  }

  await ctx.replyWithChatAction("upload_photo");

  try {
    const buffer = await imageGenerationService.generateBingoDrawnItemsImage(game, ctx.chat.id, overrideThemeId);

    let caption = "";
    let hasAnySelected = false;

    // Only show items from drawOrder (drawn items) - maintain draw order
    if (game.drawOrder && game.drawOrder.length > 0) {
      const categoryMap = new Map();
      game.drawOrder.forEach(([cat, val]) => {
        if (!categoryMap.has(cat)) {
          categoryMap.set(cat, []);
        }
        categoryMap.get(cat).push(val);
      });

      // Use card order (BINGO pattern) for categories, but maintain draw order within each category
      game.card.forEach((col) => {
        const cat = col.category;
        if (categoryMap.has(cat)) {
          hasAnySelected = true;
          caption += `<b>${cat}:</b>\n`;
          categoryMap.get(cat).forEach((item) => {
            caption += `• ${item}\n`;
          });
          caption += "\n";
        }
      });
    }

    if (!hasAnySelected) {
      caption = "<i>No items selected yet - use /bola to draw!</i>";
    }

    await ctx.replyWithPhoto(new InputFile(buffer), {
      caption: caption,
      parse_mode: "HTML",
    });
  } catch (error) {
    console.error("Failed to display bingo card:", error);
    await ctx.reply("❌ Failed to load bingo card.");
  }
}

/**
 * Helper: Test if custom emoji is available by sending a test message to bot owner
 * Returns true if custom emoji works, false otherwise
 */
async function testPremiumEmojiStatus(ctx, botOwnerId) {
  try {
    // Use a known custom emoji from Frozen theme for testing
    const testEmojiId = THEME_EMOJIS.frozen.header[0]; // First emoji from Frozen header
    const testMessage = `<tg-emoji emoji-id="${testEmojiId}">⭐</tg-emoji> Premium test`;
    
    const sentMessage = await ctx.api.sendMessage(botOwnerId, testMessage, {
      parse_mode: "HTML",
    });
    
    // Check if the message contains custom emoji entities
    // If Premium is inactive, Telegram will send the message but without custom emoji entities
    const hasCustomEmoji = sentMessage.entities && sentMessage.entities.some(
      entity => entity.type === 'custom_emoji'
    );
    
    // Delete the test message to avoid clutter
    try {
      await ctx.api.deleteMessage(botOwnerId, sentMessage.message_id);
    } catch (deleteErr) {
      // Ignore deletion errors
    }
    
    if (hasCustomEmoji) {
      console.log("[premium-test] Custom emoji test succeeded - custom emoji entity found");
      return true;
    } else {
      console.log("[premium-test] Custom emoji test failed - no custom emoji entity found");
      return false;
    }
  } catch (error) {
    console.error("[premium-test] Custom emoji test failed:", error.message);
    return false;
  }
}

/**
 * Helper: Build rich message with custom emoji tags
 */
function buildRichMessage(playersText, themeId) {
  const placeholderEmoji = '⭐';
  const makeTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;

  // Check if theme has premium emoji support
  if (THEME_EMOJIS[themeId] && THEME_EMOJIS[themeId].header) {
    const premiumIds = THEME_EMOJIS[themeId].header;
    const validPremiumIds = premiumIds.filter(id => id && String(id).trim());
    
    if (validPremiumIds.length > 0) {
      const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
      
      let headerTags;
      // Handle Frozen theme's special two-group header
      if (themeId === 'frozen') {
        const firstGroup = validPremiumIds.slice(0, 6).map(emojiTag).join('');
        const secondGroup = validPremiumIds.slice(6).map(emojiTag).join('');
        const spacer = '\u00A0'.repeat(5);
        headerTags = firstGroup + (secondGroup ? spacer + secondGroup : '');
      } else if (themeId === 'spongebob') {
        // SpongeBob: "ARE YOU" on first line, "READY KIDS?" on second line with 5 spaces between words
        const are = validPremiumIds.slice(0, 3).map(emojiTag).join('');
        const you = validPremiumIds.slice(3, 6).map(emojiTag).join('');
        const ready = validPremiumIds.slice(6, 11).map(emojiTag).join('');
        const kids = validPremiumIds.slice(11).map(emojiTag).join('');
        const spacer = '\u00A0'.repeat(5);
        headerTags = are + spacer + you + '\n' + ready + spacer + kids;
      } else {
        // For other themes, just join all emojis
        headerTags = validPremiumIds.map(emojiTag).join('');
      }
      
      // Replace label emojis if theme has them
      let richText = playersText;
      if (THEME_EMOJIS[themeId].pot) {
        richText = richText.replace(/💰\s*Pot:/g, `${makeTag(THEME_EMOJIS[themeId].pot)} Pot:`);
      }
      if (THEME_EMOJIS[themeId].pattern) {
        richText = richText.replace(/🎲\s*Pattern:/g, `${makeTag(THEME_EMOJIS[themeId].pattern)} Pattern:`);
      }
      if (THEME_EMOJIS[themeId].players) {
        const playersEmojiId = Array.isArray(THEME_EMOJIS[themeId].players) 
          ? THEME_EMOJIS[themeId].players[Math.floor(Math.random() * THEME_EMOJIS[themeId].players.length)]
          : THEME_EMOJIS[themeId].players;
        richText = richText.replace(/👥\s*Players Joined:/g, `${makeTag(playersEmojiId)} Players Joined:`);
      }
      
      // Prepend header
      if (richText.startsWith('🎯 <b>Bingo Game Started!')) {
        richText = richText.replace(
          /^🎯 <b>Bingo Game Started!(?: — 🎮 Free Play)?<\/b>\n\n/,
          `${headerTags}\n\n`,
        );
      } else {
        richText = `${headerTags}\n\n${richText}`;
      }
      
      return richText;
    }
  }
  
  return playersText; // Return original if no theme or no valid IDs
}

/**
 * Helper: Build plain message with standard emojis only
 */
function buildPlainMessage(playersText, themeId) {
  // For plain mode, just return the original playersText with standard emojis
  // No custom emoji tags, no theme-specific headers
  return playersText;
}

module.exports = {
  buildJoinRichMessage,
  buildJoinPlainMessage,
  createDrawnItemsTable,
  streamDrawnItemsTable,
  formatDuration,
  formatDrawnItemsText,
  displayBingoCard,
  testPremiumEmojiStatus,
  buildRichMessage,
  buildPlainMessage,
};
