/**
 * Funds commands: /pondo, /pondo descend, .rm, name+amount, name-amount, .go
 */

const { GLOBAL_GROUP_ID } = require("../../utils/constants");

async function rejectUnauthorizedFundsGroup(ctx, groupConfigService) {
  // Gate all non-setup commands behind the stored group approval row.
  const isGroupSetupConfirmed = await groupConfigService.isCommandAllowedInGroup(ctx.chat.id, []);
  if (!isGroupSetupConfirmed) {
    await ctx.reply("❌ This command is not available in this group.");
    return true;
  }
  return false;
}

async function handleBingoFunds(ctx, bingoFundsService, gameWinnerModel, groupConfigService) {
  if (ctx.chat.type === "private") {
    await ctx.reply(
      "🚫 This command can only be used in groups, not in private messages.",
    );
    return;
  }

  const groupId = ctx.chat.id;
  const args = ctx.match ? ctx.match.trim().toLowerCase() : "";
  const sortBy = args === "desc" ? "desc" : "name";

  // Gate all non-setup commands behind the stored group approval row.
  const isGroupSetupConfirmed = await groupConfigService.isCommandAllowedInGroup(groupId, []);
  if (!isGroupSetupConfirmed) {
    return;
  }

  // /pondo should read from the shared global group membership source,
  // not the local chat's sparse user_group_memberships slice.
  const effectiveGroupId = GLOBAL_GROUP_ID;

  // Get admin funds and bingobank funds
  const adminFunds = await groupConfigService.getAdminFunds(groupId);
  const bingobankFunds = await groupConfigService.getBingobankFunds(groupId);

  try {
    const fundsList = await bingoFundsService.getFundsByGroup(effectiveGroupId, sortBy);

    let recentWinners = new Set();
    if (gameWinnerModel) {
      try {
        recentWinners = await gameWinnerModel.getRecentWinners();
      } catch (error) {
        console.error("Error getting recent winners:", error);
      }
    }

    if (fundsList.length === 0) {
      await ctx.reply("📋 <b>Bingo Funds List</b>\n\nNo funds entries yet.", {
        parse_mode: "HTML",
      });
      return;
    }

    const cleanName = (value) =>
      String(value || "")
        .replace(/\u3164/g, "")
        .replace(/\u200B/g, "")
        .replace(/\u200C/g, "")
        .replace(/\u200D/g, "")
        .replace(/\uFEFF/g, "")
        .trim();

    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const getZeroFundsEmoji = (updatedAt) => {
      if (!updatedAt) return "🥚";
      const ageMs = Date.now() - new Date(updatedAt).getTime();
      const twelveHours = 12 * 60 * 60 * 1000;
      const twentyFourHours = 24 * 60 * 60 * 1000;
      if (ageMs < twelveHours) return "🥚";
      if (ageMs < twentyFourHours) return "🐣";
      return "🐓";
    };

    let namesBlock = "";
    let namesBlockPlain = "";
    fundsList.forEach((entry) => {
      const firstName = cleanName(entry.first_name || "");
      const lastName = cleanName(entry.last_name || "");
      const displayName =
        [firstName, lastName].filter(Boolean).join(" ").trim() ||
        cleanName(entry.username || entry.name || "Unknown Player");
      const safeName = escapeHtml(displayName);
      const funds = entry.funds;
      const hasValidTelegramId = Number(entry.telegram_id) > 0;
      const nameHtml = hasValidTelegramId
        ? `<a href="tg://user?id=${entry.telegram_id}">${safeName}</a>`
        : safeName;
      const namePlain = safeName;
      const isRecentWinner = recentWinners.has(String(entry.telegram_id));
      const winnerIndicator = isRecentWinner ? "🔼" : "";
      // Only add merged indicator if name doesn't already contain the link emoji
      const mergedIndicator = entry.merged_into && !displayName.includes("🔗") ? "🔗" : "";
      const zeroFundsEmoji = funds === 0 ? getZeroFundsEmoji(entry.updated_at) : "🥚";
      const entryText =
        funds === null
          ? `ㅤʚɞ . . . ${nameHtml} - ☹️${winnerIndicator}${mergedIndicator}`
          : funds === 0
          ? `ㅤʚɞ . . . ${nameHtml} - ${zeroFundsEmoji}${winnerIndicator}${mergedIndicator}`
          : `ㅤʚɞ . . . ${nameHtml} - ${Number(funds).toLocaleString()}${winnerIndicator}${mergedIndicator}`;
      const entryPlainText =
        funds === null
          ? `ㅤʚɞ . . . ${namePlain} - ☹️${winnerIndicator}`
          : funds === 0
          ? `ㅤʚɞ . . . ${namePlain} - ${zeroFundsEmoji}${winnerIndicator}`
          : `ㅤʚɞ . . . ${namePlain} - ${Number(funds).toLocaleString()}${winnerIndicator}`;

      namesBlock += `${entryText}<br>`;
      namesBlockPlain += `${entryPlainText}\n`;
    });

    // Calculate total funds, avoiding double-counting merged accounts
    const mergedAccountIds = new Set();
    const totalFunds = fundsList.reduce((sum, entry) => {
      if (entry.merged_into) {
        // If this account is merged, only count it if we haven't counted its pair yet
        if (!mergedAccountIds.has(entry.merged_into) && !mergedAccountIds.has(entry.id)) {
          mergedAccountIds.add(entry.id);
          mergedAccountIds.add(entry.merged_into);
          return sum + (entry.funds ?? 0);
        }
        return sum; // Skip if we already counted the pair
      }
      return sum + (entry.funds ?? 0);
    }, 0);

    const totalPlayers = fundsList.length;
    const averageFunds = totalPlayers > 0 ? Math.round(totalFunds / totalPlayers) : 0;
    
    // Find highest funds
    let highestFundsEntry = null;
    let highestFunds = 0;
    fundsList.forEach((entry) => {
      if (entry.funds !== null && entry.funds !== undefined && entry.funds > highestFunds) {
        highestFunds = entry.funds;
        highestFundsEntry = entry;
      }
    });
    
    let highestFundsText = "None";
    if (highestFundsEntry) {
      const firstName = cleanName(highestFundsEntry.first_name || "");
      const lastName = cleanName(highestFundsEntry.last_name || "");
      const displayName =
        [firstName, lastName].filter(Boolean).join(" ").trim() ||
        cleanName(highestFundsEntry.username || highestFundsEntry.name || "Unknown Player");
      const safeName = escapeHtml(displayName);
      const hasValidTelegramId = Number(highestFundsEntry.telegram_id) > 0;
      const nameHtml = hasValidTelegramId
        ? `<a href="tg://user?id=${highestFundsEntry.telegram_id}">${safeName}</a>`
        : safeName;
      highestFundsText = `${nameHtml} (${Number(highestFunds).toLocaleString()})`;
    }

    const richHtml = `
  <blockquote expandable>
  <b>📋 Pondo</b><br><br>
${namesBlock}
</blockquote>
<details>
<summary>ℹ️ Details</summary>
<b>Total Funds:</b> ${totalFunds.toLocaleString()}<br>
<b>Total Players:</b> ${totalPlayers}<br>
<b>Average Funds:</b> ${averageFunds.toLocaleString()}<br>
<b>Highest Funds:</b> ${highestFundsText}<br>
<b>Admin Funds:</b> ${adminFunds.toLocaleString()}<br>
<b>Bingo Bank:</b> ${bingobankFunds.toLocaleString()}
</details>
`.trim();

    try {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendRichMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ctx.chat.id,
            rich_message: { html: richHtml },
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("sendRichMessage failed:", response.status, errorText);
        throw new Error(`sendRichMessage failed: ${response.status}`);
      }

      const result = await response.json();
      if (!result.ok) {
        console.error("sendRichMessage API error:", result);
        throw new Error(`API returned error: ${result.description}`);
      }
    } catch (fetchError) {
      console.error("Rich Messages API failed, falling back to standard reply:", fetchError);
      // Fallback to standard HTML reply without unsupported <br> inside blockquote
      const fallbackMessage = `📋 <b>Pondo:</b>\n\n<blockquote expandable>\n${namesBlockPlain}</blockquote>\n\n💰 <b>Total of Funds:</b> ${totalFunds}`;
      await ctx.reply(fallbackMessage, { parse_mode: "HTML" });
    }
  } catch (error) {
    console.error("Error in /pondo:", error);
    await ctx.reply("❌ Failed to retrieve funds list.");
  }
}

async function handleRmSingle(ctx, bingoFundsService, groupConfigService) {
  if (ctx.chat.type === "private") {
    return;
  }

  if (await rejectUnauthorizedFundsGroup(ctx, groupConfigService)) return;

  if (!(await isAdmin(ctx, groupConfigService))) {
    await ctx.reply("❌ Only admins can use this command.");
    return;
  }

  const text = ctx.message.text;
  if (text.includes("\n")) {
    return;
  }

  const groupId = ctx.chat.id;
  const effectiveGroupId = groupId;

  const name = ctx.match[1].trim().toLowerCase().replace(/^@/, "");

  if (!name) {
    await ctx.reply("Usage: <code>.rm <name></code>", {
      parse_mode: "HTML",
    });
    return;
  }

  try {
    const removed = await bingoFundsService.removeFundsEntry(effectiveGroupId, name);

    if (!removed) {
      await ctx.reply(`❌ <b>${name}</b> not found in the funds list`, {
        parse_mode: "HTML",
      });
    } else {
      await ctx.reply(`✅ Removed <b>${name}</b> from the funds list`, {
        parse_mode: "HTML",
      });
    }
  } catch (error) {
    console.error("Error in .rm command:", error);
    await ctx.reply("❌ Failed to remove funds entry.");
  }
}

async function handleRmMulti(ctx, bingoFundsService, groupConfigService) {
  if (ctx.chat.type === "private") {
    return;
  }

  if (await rejectUnauthorizedFundsGroup(ctx, groupConfigService)) return;

  if (!(await isAdmin(ctx, groupConfigService))) {
    await ctx.reply("❌ Only admins can use this command.");
    return;
  }

  const groupId = ctx.chat.id;
  const effectiveGroupId = groupId;
  const text = ctx.message.text;
  const lines = text.split("\n").filter((line) => line.trim());

  const results = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    const match = trimmedLine.match(/^\.rm\s+(.+)$/i) || trimmedLine.match(/^([a-zA-Z0-9_@]+)$/i);
    
    if (!match) continue;

    let name;
    
    if (match[0].startsWith('.rm')) {
      name = match[1].trim().toLowerCase().replace(/^@/, "");
    } else {
      name = match[1].toLowerCase().replace(/^@/, "");
    }

    if (!name) continue;

    try {
      const removed = await bingoFundsService.removeFundsEntry(effectiveGroupId, name);
      
      if (!removed) {
        results.push(`❌ <b>${name}</b> not found`);
      } else {
        results.push(`✅ <b>${name}</b> removed`);
      }
    } catch (error) {
      console.error("Error removing entry:", error);
      results.push(`❌ <b>${name}</b> failed`);
    }
  }

  if (results.length > 0) {
    await ctx.reply(results.join("\n"), { parse_mode: "HTML" });
  }
}

/**
 * Build an HTML hyperlink for a user entry if they have a valid telegram_id.
 * Falls back to plain bold name if no valid telegram_id.
 */
function buildNameLink(entry, displayName) {
  const name = displayName || entry.name || entry.first_name || entry.username || "User";
  const sanitized = name.replace(/[<>]/g, "");
  if (entry.telegram_id && Number(entry.telegram_id) > 0) {
    return `<a href="tg://user?id=${entry.telegram_id}"><b>${sanitized}</b></a>`;
  }
  return `<b>${sanitized}</b>`;
}

function buildMergedNameLink(user, otherUser) {
  const userName = user.username || user.first_name || user.last_name || "User";
  const otherUserName = otherUser.username || otherUser.first_name || otherUser.last_name || "User";
  return `${buildNameLink(user, userName)} 🔗 ${buildNameLink(otherUser, otherUserName)}`;
}

async function handleFundsAdjustment(ctx, bingoFundsService, groupConfigService) {
  if (ctx.chat.type === "private") {
    return;
  }

  if (await rejectUnauthorizedFundsGroup(ctx, groupConfigService)) return;

  if (!(await isAdmin(ctx, groupConfigService))) {
    await ctx.reply("❌ Only admins can use this command.");
    return;
  }

  const text = ctx.message.text;
  if (text.includes("\n")) {
    return;
  }

  const groupId = ctx.chat.id;
  const effectiveGroupId = groupId;

  const name = ctx.match[1].toLowerCase().replace(/^@/, "");
  const operator = ctx.match[2];
  const amount = parseInt(ctx.match[3], 10);

  try {
    const entry = await bingoFundsService.getFundsEntry(groupId, name);

    if (!entry) {
      await ctx.reply(
        `❌ <b>${name}</b> not found in the funds list. User must use /start to register first.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    const nameLink = buildNameLink(entry, name);

    if (entry.funds === null) {
      const finalAmount = operator === "+" ? amount : Math.max(0, -amount);
      const result = await bingoFundsService.setFunds(effectiveGroupId, name, finalAmount);

      if (result.isMerged) {
        const mergedNameLink = buildMergedNameLink(result.user, result.otherUser);
        await ctx.reply(`✅ Both accounts updated:\n${mergedNameLink}: ${Number(finalAmount).toLocaleString()}`, {
          parse_mode: "HTML",
        });
      } else {
        await ctx.reply(`✅ Set ${nameLink} funds to ${Number(finalAmount).toLocaleString()}`, {
          parse_mode: "HTML",
        });
      }
    } else {
      const adjustment = operator === "+" ? amount : -amount;
      const newFunds = entry.funds + adjustment;

      if (newFunds < 0) {
        const result = await bingoFundsService.setFunds(effectiveGroupId, name, 0);
        if (result.isMerged) {
          const mergedNameLink = buildMergedNameLink(result.user, result.otherUser);
          await ctx.reply(`✅ Both accounts reset to 0:\n${mergedNameLink}: 0`, {
            parse_mode: "HTML",
          });
        } else {
          await ctx.reply(`✅ ${nameLink}: ${Number(entry.funds).toLocaleString()} - ${Number(entry.funds).toLocaleString()} = 0`, {
            parse_mode: "HTML",
          });
        }
      } else {
        const result = await bingoFundsService.updateFunds(
          effectiveGroupId,
          name,
          adjustment,
        );
        const operatorSymbol = adjustment > 0 ? '+' : '-';
        
        if (result.isMerged) {
          const mergedNameLink = buildMergedNameLink(result.user, result.otherUser);
          await ctx.reply(
            `✅ Both accounts updated:\n${mergedNameLink}: ${Number(entry.funds).toLocaleString()} ${operatorSymbol} ${Number(Math.abs(adjustment)).toLocaleString()} = ${Number(result.user.funds).toLocaleString()}`,
            { parse_mode: "HTML" },
          );
        } else {
          await ctx.reply(
            `✅ ${nameLink}: ${Number(entry.funds).toLocaleString()} ${operatorSymbol} ${Number(Math.abs(adjustment)).toLocaleString()} = ${Number(result.user.funds).toLocaleString()}`,
            { parse_mode: "HTML" },
          );
        }
      }
    }
  } catch (error) {
    console.error("Error in funds adjustment command:", error);
    await ctx.reply("❌ Failed to update funds.");
  }
}

async function handleGoCommand(ctx, bingoFundsService, groupConfigService) {
  if (ctx.chat.type === "private") {
    return;
  }

  if (await rejectUnauthorizedFundsGroup(ctx, groupConfigService)) return;

  if (!(await isAdmin(ctx, groupConfigService))) {
    await ctx.reply("❌ Only admins can use this command.");
    return;
  }

  const groupId = ctx.chat.id;
  const effectiveGroupId = groupId;
  const text = ctx.editedMessage?.text || ctx.message?.text || ctx.editedMessage?.caption || ctx.message?.caption;
  console.log(`[funds] .go command from chat=${groupId}, effectiveGroupId=${effectiveGroupId}`);
  console.log(`[funds] .go raw text:\n${text}`);
  
  if (!text) return;
  
  if (!text.match(/^\.go\s*\n/i)) {
    console.log('[funds] .go text did not match prefix');
    return;
  }
  
  const commandsText = text.replace(/^\.go\s*\n/i, "");
  const lines = commandsText.split("\n").filter((line) => line.trim());
  console.log(`[funds] .go parsed lines: ${JSON.stringify(lines)}`);

  const commandLines = lines.filter((line) =>
    line.match(/^([a-zA-Z0-9_@]+)(?:\s+\d+)?(\s*[+-]\s*\d+)+$/i),
  );
  console.log(`[funds] .go commandLines: ${JSON.stringify(commandLines)}`);

  const results = [];
  for (const line of commandLines) {
    const match = line.match(/^([a-zA-Z0-9_@]+)(?:\s+(\d+))?(\s*[+-]\s*\d+)+$/i);
    if (!match) continue;

    const name = match[1].toLowerCase().replace(/^@/, "");
    const initialValue = match[2] ? parseInt(match[2], 10) : null;
    
    const operations = line.substring(name.length + (match[1].startsWith("@") ? 1 : 0)).match(/\s*[+-]\s*\d+/gi);
    if (!operations) continue;

    let totalAdjustment = 0;
    const calculationSteps = [];
    
    for (const op of operations) {
      const opMatch = op.match(/\s*([+-])\s*(\d+)/i);
      if (opMatch) {
        const operator = opMatch[1];
        const amount = parseInt(opMatch[2], 10);
        const adjustment = operator === "+" ? amount : -amount;
        totalAdjustment += adjustment;
        calculationSteps.push(`${operator} ${amount}`);
      }
    }

    try {
      const entry = await bingoFundsService.getFundsEntry(groupId, name);

      if (!entry) {
        const safeName = name.replace(/[<>]/g, "");
        results.push(`<b>${safeName}</b>: not found`);
        continue;
      }

      const nameLink = buildNameLink(entry, name);

      if (initialValue !== null) {
        if (entry.funds === null) {
          results.push(`${nameLink}: no funds to compare (has null)`);
          continue;
        }
        if (entry.funds !== initialValue) {
          results.push(`${nameLink}: current funds (${Number(entry.funds).toLocaleString()}) don't match provided value (${Number(initialValue).toLocaleString()})`);
          continue;
        }
      }

      if (entry.funds === null) {
        const finalAmount = Math.max(0, totalAdjustment);
        const result = await bingoFundsService.setFunds(effectiveGroupId, name, finalAmount);
        
        if (result.isMerged) {
          const mergedNameLink = buildMergedNameLink(result.user, result.otherUser);
          results.push(`${mergedNameLink}: ${Number(finalAmount).toLocaleString()}`);
        } else {
          results.push(`${nameLink}: ${Number(finalAmount).toLocaleString()}`);
        }
      } else {
        const newFunds = entry.funds + totalAdjustment;

        if (newFunds < 0) {
          const result = await bingoFundsService.setFunds(effectiveGroupId, name, 0);
          if (result.isMerged) {
            const mergedNameLink = buildMergedNameLink(result.user, result.otherUser);
            results.push(`${mergedNameLink}: ${Number(entry.funds).toLocaleString()} ${calculationSteps.join(' ')} = 0`);
          } else {
            results.push(`${nameLink}: ${Number(entry.funds).toLocaleString()} ${calculationSteps.join(' ')} = 0`);
          }
        } else {
          const result = await bingoFundsService.updateFunds(
            effectiveGroupId,
            name,
            totalAdjustment,
          );
          if (result.isMerged) {
            const mergedNameLink = buildMergedNameLink(result.user, result.otherUser);
            results.push(`${mergedNameLink}: ${Number(entry.funds).toLocaleString()} ${calculationSteps.join(' ')} = ${Number(result.user.funds).toLocaleString()}`);
          } else {
            results.push(`${nameLink}: ${Number(entry.funds).toLocaleString()} ${calculationSteps.join(' ')} = ${Number(result.user.funds).toLocaleString()}`);
          }
        }
      }
    } catch (error) {
      const safeName = name.replace(/[<>]/g, "");
      results.push(`<b>${safeName}</b>: failed`);
    }
  }

  if (results.length > 0) {
    await ctx.reply(`✅ Update\n${results.join("\n")}`, { parse_mode: "HTML" });
  }
}

async function handleMergeCommand(ctx, bingoFundsService, groupConfigService) {
  if (ctx.chat.type === "private") {
    return;
  }

  if (await rejectUnauthorizedFundsGroup(ctx, groupConfigService)) return;

  if (!(await isAdmin(ctx, groupConfigService))) {
    return;
  }

  const text = ctx.message.text;
  if (text.includes("\n")) {
    return;
  }

  const groupId = ctx.chat.id;
  const effectiveGroupId = groupId;

  // Parse the command: .merge <user1>, <user2>
  const match = text.match(/^\.merge\s+(.+),\s*(.+)$/i);
  
  if (!match) {
    await ctx.reply("Usage: <code>.merge &lt;user1&gt;, &lt;user2&gt;</code>\n\nExamples:\n.merge @username1, @username2\n.merge john, jane\n.merge 123456789, 987654321\n\nUse <code>.unmerge &lt;user&gt;</code> to unmerge users.", {
      parse_mode: "HTML",
    });
    return;
  }

  const sourceIdentifier = match[1].trim().replace(/^@/, "");
  const targetIdentifier = match[2].trim().replace(/^@/, "");

  if (!sourceIdentifier || !targetIdentifier) {
    await ctx.reply("😢 Both users must be specified. Usage: <code>.merge &lt;user1&gt;, &lt;user2&gt;</code>", {
      parse_mode: "HTML",
    });
    return;
  }

  try {
    const result = await bingoFundsService.mergeUserFunds(sourceIdentifier, targetIdentifier, groupId);

    if (!result.success) {
      await ctx.reply(`😢 ${result.error}`, { parse_mode: "HTML" });
      return;
    }

    // Build user display names
    const cleanName = (value) =>
      String(value || "")
        .replace(/\u3164/g, "")
        .replace(/\u200B/g, "")
        .replace(/\u200C/g, "")
        .replace(/\u200D/g, "")
        .replace(/\uFEFF/g, "")
        .trim();

    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const buildNameLink = (entry, displayName) => {
      const name = displayName || entry.name || entry.first_name || entry.username || "User";
      const sanitized = name.replace(/[<>]/g, "");
      if (entry.telegram_id && Number(entry.telegram_id) > 0) {
        return `<a href="tg://user?id=${entry.telegram_id}"><b>${sanitized}</b></a>`;
      }
      return `<b>${sanitized}</b>`;
    };

    const targetName = cleanName(result.targetUser.username || result.targetUser.first_name || result.targetUser.last_name || targetIdentifier);
    const targetLink = buildNameLink(result.targetUser, result.combinedName || targetName);

    const message = `✅ <b>Merged!</b> ${targetLink}\n` +
      `💰 ${Number(result.sharedFunds).toLocaleString()} (shared)`;

    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error in .merge command:", error);
    await ctx.reply("😢 Failed to merge user funds.");
  }
}

async function handleUnmergeCommand(ctx, bingoFundsService, groupConfigService) {
  if (ctx.chat.type === "private") {
    return;
  }

  if (await rejectUnauthorizedFundsGroup(ctx, groupConfigService)) return;

  if (!(await isAdmin(ctx, groupConfigService))) {
    return;
  }

  const text = ctx.message.text;
  if (text.includes("\n")) {
    return;
  }

  const groupId = ctx.chat.id;
  const effectiveGroupId = groupId;

  // Parse the command: .unmerge <user>
  const match = text.match(/^\.unmerge\s+(.+)$/i);
  
  if (!match) {
    await ctx.reply("Usage: <code>.unmerge &lt;user&gt;</code>\n\nExamples:\n.unmerge @username\n.unmerge john\n.unmerge 123456789\n\nIf A and B are merged and you unmerge B, both A and B will be separated and their funds will be split equally.", {
      parse_mode: "HTML",
    });
    return;
  }

  const identifier = match[1].trim().replace(/^@/, "");

  if (!identifier) {
    await ctx.reply("😢 User must be specified. Usage: <code>.unmerge &lt;user&gt;</code>", {
      parse_mode: "HTML",
    });
    return;
  }

  try {
    const result = await bingoFundsService.unmergeUserFunds(identifier, groupId);

    if (!result.success) {
      await ctx.reply(`😢 ${result.error}`, { parse_mode: "HTML" });
      return;
    }

    // Build user display names
    const cleanName = (value) =>
      String(value || "")
        .replace(/\u3164/g, "")
        .replace(/\u200B/g, "")
        .replace(/\u200C/g, "")
        .replace(/\u200D/g, "")
        .replace(/\uFEFF/g, "")
        .trim();

    const escapeHtml = (value) =>
      String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const buildNameLink = (entry, displayName) => {
      const name = displayName || entry.name || entry.first_name || entry.username || "User";
      const sanitized = name.replace(/[<>]/g, "");
      if (entry.telegram_id && Number(entry.telegram_id) > 0) {
        return `<a href="tg://user?id=${entry.telegram_id}"><b>${sanitized}</b></a>`;
      }
      return `<b>${sanitized}</b>`;
    };

    const userName = cleanName(result.user.username || result.user.first_name || result.user.last_name || identifier);
    const userLink = buildNameLink(result.user, userName);
    
    const otherUserName = cleanName(result.otherUser.username || result.otherUser.first_name || result.otherUser.last_name || "User");
    const otherUserLink = buildNameLink(result.otherUser, otherUserName);

    const message = `✅ <b>Unmerged!</b>\n` +
      `${userLink}: ${Number(result.userSplitFunds).toLocaleString()}\n` +
      `${otherUserLink}: ${Number(result.otherUserSplitFunds).toLocaleString()}`;

    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    console.error("Error in .unmerge command:", error);
    await ctx.reply("😢 Failed to unmerge user funds.");
  }
}

async function isAdmin(ctx, groupConfigService) {
  try {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) {
      console.error("[funds] No user or chat ID in context", { userId, chatId });
      return false;
    }

    if (ctx.api?.getChatMember) {
      try {
        const chatMember = await ctx.api.getChatMember(chatId, userId);
        const isAdminStatus = chatMember?.status === "administrator" || chatMember?.status === "creator";

        if (isAdminStatus) {
          if (groupConfigService?.createGroupConfig) {
            try {
              await groupConfigService.createGroupConfig(chatId, userId);
              console.log(`[funds] Ensured group config exists for chat ${chatId}, user ${userId}`);
            } catch (configError) {
              console.warn(`[funds] Could not ensure group config for chat ${chatId}:`, configError.message || configError);
            }
          }
          return true;
        }

        console.warn(`[funds] Admin check returned ${chatMember?.status || "unknown"} for user ${userId} in chat ${chatId}`);
      } catch (error) {
        console.warn(`[funds] Telegram admin lookup failed for chat ${chatId}, user ${userId}:`, error.message || error);
      }
    }

    if (groupConfigService?.isAdmin) {
      const configuredAdmin = await groupConfigService.isAdmin(chatId, userId);
      if (configuredAdmin) {
        console.log(`[funds] Admin fallback succeeded via group config for chat ${chatId}, user ${userId}`);
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error(`[funds] Error checking admin status for chat ${ctx.chat?.id}, user ${ctx.from?.id}:`, error);
    return false;
  }
}

module.exports = {
  handleBingoFunds,
  handleRmSingle,
  handleRmMulti,
  handleFundsAdjustment,
  handleGoCommand,
  handleMergeCommand,
  handleUnmergeCommand,
};