/**
 * /toystory easter-egg command
 *
 * When a user sends the exact word "toystory" (no spaces, no typos),
 * the bot replies with the ToyStory audio file.
 * Works in both group chats and DMs.
 */

const path = require("path");
const { InputFile } = require("grammy");

async function handleToystory(ctx) {
  console.log("=== /toystory command triggered ===");
  console.log("User:", ctx.from.id, "Chat:", ctx.chat.id, "Chat type:", ctx.chat.type);

  const audioPath = path.join(__dirname, "../../assets/voice/ToyStory.mp3");

  try {
    await ctx.replyWithVoice(
      new InputFile(audioPath),
      { reply_to_message_id: ctx.message.message_id }
    );
    console.log("ToyStory audio sent successfully");
  } catch (err) {
    console.error("Failed to send ToyStory audio:", err);
    await ctx.reply("Sorry, couldn't play the audio right now.");
  }

  console.log("=== /toystory command completed ===");
}

module.exports = { handleToystory };
