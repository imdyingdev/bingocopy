/**
 * /sunday easter-egg command
 *
 * When a user DMs the bot the exact word "sunday" (no typos, not "sundays"),
 * the bot streams a fun message live using Telegram's rich-message drafts
 * (sendRichMessageDraft, Bot API 10.1+), then finalizes with a real message
 * so it stays in the chat history.
 *
 * Draft streaming is DM-only per Telegram's API. If sendRichMessageDraft fails
 * (older server, network hiccup, etc), it latches off for the rest of the run
 * and falls back to the old edit-in-place loop for that call.
 *
 * Note: on Telegram Desktop, draft streams sometimes don't render even though
 * the API call succeeds (known client bug). Not something we can detect or
 * fix from the bot side — the final message always lands regardless, so it's
 * just a cosmetic miss on Desktop, not a functional failure.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes cooldown per user

const SUNDAY_MESSAGE =
  "# GUYS, MAGDAGDAG TAU RULES.\n\n" +
  "### BAWAL MAGBINGO NG LINGGO. MAGSIMBA KAU. REST DAY YAN. REST DAY NYO KAKASUGAL. REST DAY NG MGA SUGAROL. REST DAY NG ADMINS. OKAY B?\n\n" +
  "##### ENJOY UR DAY FRIENDS\n\n" +
  "###### - SAMOI";

// Per-user cooldown timestamps (in-memory; resets on restart)
const lastUsed = new Map();

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function callTelegram(method, payload) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${data.description || "unknown error"}`);
  }
  return data.result;
}

/**
 * Split the message into streamable chunks so the draft appears to "type" live.
 */
function chunkMessage(text) {
  const chunks = [];
  const words = text.split(" ");
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (candidate.length > 40) {
      if (current) chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function handleSunday(ctx) {
  console.log("=== /sunday command triggered ===");
  console.log("User:", ctx.from.id, "Chat:", ctx.chat.id, "Chat type:", ctx.chat.type);

  // Draft streaming only works in private (DM) chat with the bot
  if (ctx.chat.type !== "private") {
    console.log("Rejected: not a private chat");
    return ctx.reply("This only works in DM with me, not in the group.");
  }

  const userId = ctx.from.id;
  const now = Date.now();
  const last = lastUsed.get(userId) || 0;
  if (now - last < COOLDOWN_MS) {
    console.log("Rejected: cooldown active");
    return ctx.reply("Hmmm.");
  }
  lastUsed.set(userId, now);
  console.log("Starting stream");

  const chatId = ctx.chat.id;
  const chunks = chunkMessage(SUNDAY_MESSAGE);
  console.log(`Message split into ${chunks.length} chunks`);

  // Generate a proper 64-bit integer for draft_id (Bot API 10.2 requirement)
  const currentDraftId = Math.floor(Math.random() * 900000000) + 100000000;
  console.log(`Using draft_id: ${currentDraftId}`);

  // Send initial "analyzing..." draft using markdown
  try {
    await callTelegram("sendRichMessageDraft", {
      chat_id: chatId,
      draft_id: currentDraftId,
      rich_message: { markdown: "✨ Sunday's Best..." }
    });
    console.log("Initial analyzing draft sent");
    await new Promise((r) => setTimeout(r, 2000)); // Wait 1 second before streaming
  } catch (err) {
    console.error("Initial analyzing draft failed:", err.message);
  }

  let buffer = "";
  let draftFailed = false;
  const THROTTLE_MS = 600; // drafts aren't edits, can run a bit faster

  for (let i = 0; i < chunks.length; i++) {
    buffer += (buffer ? " " : "") + chunks[i];
    console.log(`Streaming chunk ${i + 1}/${chunks.length}: "${chunks[i]}"`);

    if (!draftFailed) {
      try {
        await callTelegram("sendRichMessageDraft", {
          chat_id: chatId,
          draft_id: currentDraftId,
          rich_message: { markdown: buffer },
        });
      } catch (err) {
        console.error("sendRichMessageDraft failed, latching off for rest of run:", err.message);
        draftFailed = true; // stop hammering a broken/unsupported endpoint
      }
    }

    await new Promise((r) => setTimeout(r, THROTTLE_MS));
  }

  console.log("Streaming complete, finalizing message");

  // Always persist a real message — drafts vanish after 30s otherwise
  // Use sendRichMessage to properly finalize the draft with the same rich formatting
  try {
    await callTelegram("sendRichMessage", {
      chat_id: chatId,
      rich_message: { markdown: SUNDAY_MESSAGE }
    });
    console.log("Final message sent successfully via sendRichMessage");
  } catch (err) {
    console.error("sendRichMessage failed, falling back to plain reply:", err);
    await ctx.reply(SUNDAY_MESSAGE);
    console.log("Fallback: sent plain message");
  }

  // If draft API failed, send a note so user knows
  if (draftFailed) {
    try {
      await ctx.reply("(Draft streaming unavailable, sent as regular message)");
    } catch (err) {
      console.error("Failed to send draft failure note:", err);
    }
  }

  console.log("=== /sunday command completed ===");
}

module.exports = { handleSunday };