/**
 * /autobola command handler
 */

async function isGroupAdmin(ctx, groupConfigService, groupId, userId) {
  if (await groupConfigService.isAdmin(groupId, userId)) return true;

  try {
    const member = await ctx.api.getChatMember(groupId, userId);
    return member?.status === "administrator" || member?.status === "creator";
  } catch (error) {
    console.error("Failed to verify chat member for /autobola:", error);
    return false;
  }
}

async function handleAutoBola(ctx, groupConfigService, autoBolaManager) {
  if (ctx.chat.type === "private") {
    await ctx.reply("🚫 This command can only be used in groups, not in private messages.");
    return;
  }

  const groupId = ctx.chat.id;
  const userId = ctx.from.id;
  if (!(await isGroupAdmin(ctx, groupConfigService, groupId, userId))) {
    await ctx.reply("🚫 This command can only be used by group admins.");
    return;
  }

  const args = (ctx.message?.text || "").trim().split(/\s+/).slice(1);
  if (args[0]?.toLowerCase() === "stop") {
    const stopped = autoBolaManager.stop(groupId);
    await ctx.reply(stopped ? "✅ Auto-bola stopped." : "ℹ️ No auto-bola is currently running.");
    return;
  }

  const count = Number(args[0]);
  const intervalMatch = /^(\d+)s$/i.exec(args[1] || "");
  const interval = intervalMatch ? Number(intervalMatch[1]) : NaN;

  if (!Number.isInteger(count) || count < 1 || count > 3 || !Number.isInteger(interval) || interval < 15 || interval > 60) {
    await ctx.reply("Usage: /autobola <1-3> <15-60s>\nExample: /autobola 3 15s");
    return;
  }

  await autoBolaManager.start(groupId, userId, count, interval);
  if (autoBolaManager.isActive(groupId)) {
    await ctx.reply(`✅ Auto-bola active: ${count} item${count === 1 ? "" : "s"} every ${interval}s. Use /autobola stop to end it.`);
  }
}

module.exports = { handleAutoBola };
