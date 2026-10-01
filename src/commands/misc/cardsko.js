const { THEMES } = require("../../constants/themes");

const pendingCardLinkThemes = new Map();
const CARD_LINK_PATTERN = /^https:\/\/t\.me\/(?:c\/[-\d]+|[A-Za-z0-9_]+)\/\d+(?:\/\d+)?\/?$/i;

function getVisibleThemes() {
  return THEMES.filter((theme) => theme.id !== "bingulo_beta");
}

function buildThemeKeyboard(savedThemeIds = new Set()) {
  const themes = getVisibleThemes();
  const keyboard = [];
  for (let index = 0; index < themes.length; index += 2) {
    keyboard.push(
      themes.slice(index, index + 2).map((theme) => ({
        text: `${savedThemeIds.has(theme.id) ? "✅ " : ""}${theme.emoji} ${theme.name}`,
        callback_data: `cardsko_theme_${theme.id}`,
      })),
    );
  }
  return keyboard;
}

async function handleCardsKo(ctx, userCardLinkModel) {
  if (ctx.chat.type !== "private") {
    return;
  }

  const savedLinks = await userCardLinkModel.getByUser(ctx.from.id);
  const savedThemeIds = new Set(savedLinks.map((link) => link.theme_id));
  await ctx.reply(
    "🃏 <b>Your bingo card links</b>\n\n" +
      "Choose a theme, then send the Telegram copy link for your card. " +
      "That link will appear beside your name when you join a matching game.",
    {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buildThemeKeyboard(savedThemeIds) },
    },
  );
}

async function handleCardsKoThemeCallback(ctx) {
  const themeId = ctx.callbackQuery.data.replace("cardsko_theme_", "");
  const theme = getVisibleThemes().find((entry) => entry.id === themeId);
  if (!theme) {
    await ctx.answerCallbackQuery({ text: "Theme not found.", show_alert: true });
    return;
  }

  if (ctx.chat?.type !== "private") {
    await ctx.answerCallbackQuery({ text: "Use /cardsko in private chat.", show_alert: true });
    return;
  }

  pendingCardLinkThemes.set(ctx.from.id, theme.id);
  await ctx.answerCallbackQuery();
  await ctx.reply(
    `📎 Send the copy link for your <b>${theme.name}</b> card.\n\n` +
      "Example: <code>https://t.me/bingagocards/496/500</code>",
    { parse_mode: "HTML" },
  );
}

async function handleCardsKoLinkInput(ctx, userCardLinkModel) {
  if (ctx.chat?.type !== "private") return false;

  const themeId = pendingCardLinkThemes.get(ctx.from.id);
  if (!themeId) return false;

  const link = String(ctx.message?.text || "").trim();
  if (!CARD_LINK_PATTERN.test(link)) {
    await ctx.reply("⚠️ That does not look like a Telegram card copy link. Please send the full https://t.me/... link.");
    return true;
  }

  await userCardLinkModel.upsert(ctx.from.id, themeId, link);
  pendingCardLinkThemes.delete(ctx.from.id);
  await ctx.reply("✅ Card link saved. It will appear beside your name when you join this theme.");
  return true;
}

module.exports = {
  handleCardsKo,
  handleCardsKoThemeCallback,
  handleCardsKoLinkInput,
};
