/**
 * Player utility functions for formatting player indicators
 */

/**
 * Format a player's name with indicators for BAC cards used
 * @param {Object} player - Player object with user_id, first_name, last_name, username, used_lep, used_fp, used_dp, used_dpc, has_bbs, has_mcp
 * @param {number} index - Player index in the list
 * @param {number} betAmount - Bet amount for regular players
 * @returns {string} Formatted player line
 */
function isFreePlaySession(session) {
  return session?.is_free === true || session?.is_raid === true;
}

function formatPlayerWithIndicators(player, index, betAmount) {
  const rawPlayerFirstName = String(player.first_name || "").trim();
  const rawPlayerLastName = String(player.last_name || "").trim();
  const rawPlayerUsername = String(player.username || "").trim();
  const fullName = [rawPlayerFirstName, rawPlayerLastName].filter(Boolean).join(" ");
  const name = fullName || rawPlayerUsername || "Player";
  const sanitizedName = name.replace(/[<>]/g, "");
  const hyperlink = `<a href="tg://user?id=${player.user_id}"><b>${sanitizedName}</b></a>`;
  const cardIndicator = player.card_link
    ? ` <a href="${String(player.card_link).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${Math.random() < 0.5 ? "📓" : "📔"}</a>`
    : "";
  
  // Add indicators for LEP, FP, DP, DPC, BBS, and MCP with hyperlinks
  const lepIndicator = player.used_lep ? " <a href=\"https://t.me/bacstimech/11\">⏰</a>" : "";
  const fpIndicator = player.used_fp ? " - <b><a href=\"https://t.me/bacstimech/9\">🎫 FREE PASS!</a></b>" : "";
  const dpIndicator = player.used_dp ? " <a href=\"https://t.me/bacstimech/10\">🏷️</a>" : "";
  const dpcIndicator = player.used_dpc ? " <a href=\"https://t.me/bacstimech/8\">💰</a>" : "";
  const bbsIndicator = player.has_bbs ? " <a href=\"https://t.me/bacstimech/16\">🏦</a>" : "";
  const mcpIndicator = player.has_mcp ? " <a href=\"https://t.me/bacstimech/12\">🛡️</a>" : "";
  
  if (player.used_fp) {
    return `${cardIndicator}${hyperlink}${bbsIndicator}${mcpIndicator}${fpIndicator}`;
  }
  
  const betSuffix = Number(betAmount) > 0 ? ` - ₱${betAmount}` : "";

  if (player.used_dp) {
    return `${cardIndicator}${hyperlink}${dpcIndicator}${dpIndicator}${bbsIndicator}${mcpIndicator}${lepIndicator}${betSuffix}`;
  }
  
  return `${cardIndicator}${hyperlink}${dpcIndicator}${bbsIndicator}${mcpIndicator}${lepIndicator}${betSuffix}`;
}

module.exports = {
  isFreePlaySession,
  formatPlayerWithIndicators
};
