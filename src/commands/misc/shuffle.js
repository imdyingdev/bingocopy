/**
 * Shuffle/Shake command - fun command during active games
 */

const SHUFFLE_EMOJIS = [
  '6336914771379488725',
  '6338951633849812704',
  '6336738647655581018',
];

async function handleShuffle(ctx, bingoGameSession, botSettingsService) {
  const groupId = ctx.chat.id;

  try {
    // Check if there's an active session in this group
    const session = await bingoGameSession.findByGroupId(groupId);
    
    // Only work if there's an active game session
    if (!session || session.status !== "active") {
      return; // Ignore if not in-game
    }

    // Check premium status
    const usePremiumEmoji = await botSettingsService.getPremiumEmojiEnabled();

    if (usePremiumEmoji) {
      // Use custom emojis with newlines
      const placeholderEmoji = '🔀';
      const emojiTag = (id) => `<tg-emoji emoji-id="${id}">${placeholderEmoji}</tg-emoji>`;
      const shuffleText = SHUFFLE_EMOJIS.map(emojiTag).join('\n');
      
      await ctx.reply(shuffleText, { parse_mode: "HTML" });
    } else {
      // Use plain emoji
      const messages = [
        "🔀 Shuffles...",
        "🔀 Shaking...",
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      await ctx.reply(randomMessage);
    }
  } catch (error) {
    console.error("Error in shuffle command:", error);
  }
}

module.exports = { handleShuffle };
