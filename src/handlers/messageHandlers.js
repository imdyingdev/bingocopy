/**
 * Message handlers for reactions and special patterns
 */

const { InputFile } = require("grammy");
const path = require("path");
const fs = require("fs");

function normalizeItemValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function ensureItemQueryUsage(game) {
  if (!game.itemQueryUsage || !(game.itemQueryUsage instanceof Map)) {
    game.itemQueryUsage = new Map();
  }
  return game.itemQueryUsage;
}

async function handleDuplicateItemQuery(ctx, game) {
  if (!game || !ctx?.from?.id || game.round <= 1) {
    return false;
  }

  const usageMap = ensureItemQueryUsage(game);
  const userId = String(ctx.from.id);

  if (usageMap.get(userId) === game.round) {
    try {
      await ctx.deleteMessage();
    } catch (error) {
      // Silently handle expected deletion failures
      if (error.error_code !== 400 || error.description !== "Bad Request: message can't be deleted") {
        console.log("Failed to delete duplicate item query:", error.message);
      }
    }
    return true;
  }

  usageMap.set(userId, game.round);
  return false;
}

async function handleItemQuery(ctx, gameStateService, bingoFundsService) {
  if (ctx.chat.type === "private") {
    return;
  }

  const rawQuery = ctx.match[1] || "";
  const query = rawQuery.trim().toLowerCase();
  const normalizedQuery = normalizeItemValue(rawQuery);
  if (!query || !normalizedQuery) return;

  const chatId = ctx.chat.id;

  const isFundsOnly = await bingoFundsService.isFundsOnlyGroup(chatId);
  if (isFundsOnly) {
    return;
  }

  const game = gameStateService.getBingoGame(chatId);
  const isSpecialRia = normalizedQuery === "ria";

  if (isSpecialRia && !game) {
    // ?ria only responds when a bingo game is active
    return;
  }

  if (game) {
    if (isSpecialRia) {
      try {
        const voicePath = path.join(__dirname, "..", "..", "assets", "voice", "ria.mp3");
        if (fs.existsSync(voicePath)) {
          await ctx.replyWithVoice(new InputFile(voicePath), {
            reply_to_message_id: ctx.message.message_id,
          });
        } else {
          console.error(`Voice file not found: ${voicePath}`);
        }
      } catch (error) {
        console.error("Failed to send ria voice message:", error);
      }
      return;
    }
    const duplicate = await handleDuplicateItemQuery(ctx, game);
    if (duplicate) {
      return;
    }
  }

  if (!game) {
    try {
      // Try react first (primary)
      await ctx.react("💩");
    } catch (error) {
      // Fallback to message if react fails (message may have been deleted)
      console.error("Failed to react to message (no active game), falling back to reply:", error);
      try {
        await ctx.reply("❌ No active bingo game. Start one with /bingostart", {
          reply_to_message_id: ctx.message.message_id,
        });
      } catch (replyError) {
        // If reply failed because the message to reply to wasn't found, resend without reply_to_message_id
        console.warn("Reply with reply_to_message_id failed, retrying without reply target:", replyError && replyError.message ? replyError.message : replyError);
        try {
          await ctx.reply("❌ No active bingo game. Start one with /bingostart");
        } catch (finalErr) {
          console.error("Also failed to send non-reply fallback for item query:", finalErr);
        }
      }
    }
    return;
  }

  let foundItem = null;
  for (const col of game.card || []) {
    for (const item of col.items || []) {
      if (normalizeItemValue(item.value) === normalizedQuery) {
        foundItem = item;
        break;
      }
    }
    if (foundItem) break;
  }

  console.log(`Query: "${query}", Found: ${foundItem ? foundItem.value : 'null'}, Selected: ${foundItem ? foundItem.selected : 'N/A'}`);

  let reaction = "💩";
  let statusText = `💩 <b>${query}</b> is not on the card.`;

  // Check if SpongeBob mode is enabled
  const isSpongebob = gameStateService.getSpongebobMode(chatId);

  if (foundItem) {
    if (foundItem.selected) {
      reaction = isSpongebob ? "🐳" : "❤️";
      statusText = `${reaction} <b>${foundItem.value}</b> has already been drawn!`;
    } else {
      reaction = "👎";
      statusText = `👎 <b>${foundItem.value}</b> has not been drawn yet.`;

      // Random chance to send voice message: pick 1, 2, or 3
      // If 2 → send voice, if 1 or 3 → ignore
      const randomPick = Math.floor(Math.random() * 3) + 1; // 1, 2, or 3
      console.log(`Item not drawn — random pick: ${randomPick}`);

      if (randomPick === 2) {
          try {
          const voices = ["wala.mp3", "ano.mp3", "alapate.mp3"];
          const chosenVoice = voices[Math.floor(Math.random() * voices.length)];
          const voicePath = path.join(__dirname, "..", "..", "assets", "voice", chosenVoice);
          if (fs.existsSync(voicePath)) {
            try {
              await ctx.replyWithVoice(new InputFile(voicePath), {
                reply_to_message_id: ctx.message.message_id,
              });
              console.log(`Sent ${chosenVoice} voice message (reply)`);
            } catch (voiceReplyErr) {
              // If reply target missing, send voice without reply_to_message_id
              console.warn("Voice reply failed, retrying without reply target:", voiceReplyErr && voiceReplyErr.message ? voiceReplyErr.message : voiceReplyErr);
              try {
                await ctx.replyWithVoice(new InputFile(voicePath));
                console.log(`Sent ${chosenVoice} voice message (no-reply)`);
              } catch (voiceFinalErr) {
                console.error("Failed to send voice message fallback:", voiceFinalErr);
              }
            }
          } else {
            console.error(`Voice file not found: ${voicePath}`);
          }
        } catch (error) {
          console.error("Failed to send voice message:", error);
        }
      }
    }
  }

  // PRIMARY: Try to react
  try {
    await ctx.react(reaction);
  } catch (error) {
    // FALLBACK: If react fails, send message instead
    console.error("Failed to react to message, falling back to reply:", error);
    try {
      await ctx.reply(statusText, { 
        parse_mode: "HTML",
        reply_to_message_id: ctx.message.message_id,
      });
    } catch (replyError) {
      // If reply target invalid, retry without reply_to_message_id
      console.warn("Reply with reply_to_message_id failed, retrying without reply target:", replyError && replyError.message ? replyError.message : replyError);
      try {
        await ctx.reply(statusText, { parse_mode: "HTML" });
      } catch (finalErr) {
        console.error("Also failed to send non-reply fallback for item query:", finalErr);
      }
    }
  }
}

async function handleCandleEmoji(ctx) {
  if (ctx.chat.type === "private") {
    return;
  }

  try {
    await ctx.react("🙏");
  } catch (error) {
    console.error("Failed to react to candle emoji:", error);
  }
}

async function handlePatternWord(ctx) {
  if (ctx.chat.type === "private") {
    return;
  }

  try {
    await ctx.react("👀");
  } catch (error) {
    console.error("Failed to react to pattern word:", error);
  }
}

module.exports = {
  handleItemQuery,
  handleCandleEmoji,
  handlePatternWord,
};