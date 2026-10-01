const DEFAULT_BET_AMOUNT = 5;

async function settleBingoFundsForSession({
  userModel,
  bingoGameSession,
  bingoGamePlayer,
  gameWinnerModel,
  groupId,
  sessionId,
  betPerPlayer = DEFAULT_BET_AMOUNT,
  groupConfigService,
}) {
  if (!userModel || !bingoGameSession || !bingoGamePlayer || !gameWinnerModel) {
    return { settled: false, players: [], winners: [] };
  }

  let session = null;
  if (sessionId) {
    session = await bingoGameSession.findById(sessionId);
  } else {
    session = await bingoGameSession.findByGroupId(groupId);
  }

  if (!session) {
    return { settled: false, players: [], winners: [] };
  }

  if (session.is_free === true || session.is_raid === true) {
    return { settled: false, players: [], winners: [], prizePerPattern: 0, totalPot: 0, patternCount: 0 };
  }

  const players = await bingoGamePlayer.getPlayersBySession(session.id);
  const winners = await gameWinnerModel.getWinnersBySession(session.id);

  if (!Array.isArray(winners) || winners.length === 0) {
    return {
      settled: false,
      players,
      winners,
      prizePerPattern: 0,
      totalPot: 0,
      patternCount: 0,
    };
  }

  const winnerUserIds = new Set((winners || []).map((winner) => String(winner.user_id)));
  const playersCount = players.length || 0;
  const isSponsored = session.is_sponsored === true;
  const sponsorFundingType = String(session.sponsor_funding_type || "").toLowerCase();
  const sponsorId = session.sponsor_id;

  // Count FP players separately
  const fpPlayers = players.filter(p => p.used_fp === true);
  const fpPlayerCount = fpPlayers.length;
  const regularPlayerCount = playersCount - fpPlayerCount;
  const dpcPlayers = new Set(
    players.filter((player) => player.used_dpc === true).map((player) => String(player.user_id))
  );
  const dpPlayers = new Set(
    players.filter((player) => player.used_dp === true).map((player) => String(player.user_id))
  );

  let effectiveBet = Number(session.bet_per_player || betPerPlayer) || betPerPlayer;
  let totalPot;

  if (isSponsored) {
    totalPot = Number(session.sponsor_amount || 0);
    effectiveBet = 0; // No charge for sponsored games
  } else {
    // Calculate pot: regular players pay bet, FP players contribute ₱20 from admin funds, DP players pay bet-5
    const dpPlayerCount = dpPlayers.size;
    const regularNonDpCount = regularPlayerCount - dpPlayerCount;
    totalPot = (regularNonDpCount * effectiveBet) + (dpPlayerCount * (effectiveBet - 5)) + (fpPlayerCount * 20);
  }
  
  const patternCount = Number(session.pattern_count || 0);
  const distinctPatternCount = new Set(
    (winners || [])
      .map((winner) => String(winner.pattern_name || "").trim().toLowerCase())
      .filter(Boolean)
  ).size || 1;
  const realPatternCount = patternCount > 0 ? patternCount : distinctPatternCount;

  // Group winners by pattern to calculate split prizes
  const winnersByPattern = {};
  for (const winner of winners || []) {
    const normalizedPattern = String(winner.pattern_name || "").trim().toLowerCase();
    if (!winnersByPattern[normalizedPattern]) {
      winnersByPattern[normalizedPattern] = [];
    }
    winnersByPattern[normalizedPattern].push(winner);
  }

  // Calculate individual prize amounts using custom prize amounts or equal division
  const winnerPrizes = {};
  let prizePerPattern = 0;
  for (const [pattern, patternWinners] of Object.entries(winnersByPattern)) {
    let patternPrizeAmount = 0;

    // Check if any winner has a custom prize amount
    let hasCustomPrize = false;
    for (const winner of patternWinners) {
      if (winner.prize_amount && winner.prize_amount > 0) {
        hasCustomPrize = true;
        // Split custom prize amount equally among winners of this pattern
        const prizePerWinner = Math.floor(winner.prize_amount / patternWinners.length);
        const userId = String(winner.user_id);
        winnerPrizes[userId] = dpcPlayers.has(userId) ? prizePerWinner * 2 : prizePerWinner;
        console.log(`[settlement] Using custom prize ₱${winner.prize_amount} for pattern ${pattern}, split among ${patternWinners.length} winner(s): ₱${prizePerWinner} each`);
        break;
      }
    }

    if (hasCustomPrize) {
      // Skip equal division for this pattern since we used custom prizes
      continue;
    }

    // Fall back to equal division if no custom prize
    if (patternPrizeAmount === 0 && totalPot > 0) {
      prizePerPattern = Math.floor(totalPot / realPatternCount);
      patternPrizeAmount = prizePerPattern;
      console.log(`[settlement] Using equal division for pattern ${pattern}: ₱${patternPrizeAmount}`);
    }

    // Split pattern prize among winners of this pattern
    const prizePerWinner = patternWinners.length > 0 ? Math.floor(patternPrizeAmount / patternWinners.length) : 0;
    for (const winner of patternWinners) {
      const userId = String(winner.user_id);
      winnerPrizes[userId] = dpcPlayers.has(userId) ? prizePerWinner * 2 : prizePerWinner;
      console.log(`[settlement] Winner ${winner.user_id} gets ₱${prizePerWinner} for pattern ${pattern}`);
    }
  }

  // Persist the calculated prize amounts back to the winners table
  try {
    for (const [pattern, patternWinners] of Object.entries(winnersByPattern)) {
      const prizePerWinner = patternWinners.length > 0 ? Math.floor(
        (winnerPrizes[String(patternWinners[0].user_id)] || 0)
      ) : 0;
      for (const winner of patternWinners) {
        const calculatedPrize = winnerPrizes[String(winner.user_id)] || 0;
        if (calculatedPrize > 0 && (!winner.prize_amount || winner.prize_amount === 0)) {
          await gameWinnerModel.updatePrizeAmount(winner.id, calculatedPrize);
          console.log(`[settlement] Persisted prize ₱${calculatedPrize} for winner ${winner.user_id} (winner id: ${winner.id})`);
        }
      }
    }
  } catch (prizeUpdateError) {
    console.error("[settlement] Failed to persist prize amounts to winners:", prizeUpdateError);
  }

  // For pondo-backed sponsors, deduct the pot from sponsor's funds
  if (isSponsored && sponsorFundingType === "pondo" && sponsorId) {
    try {
      await userModel.updateFunds(sponsorId, -totalPot);
      console.log(`[settlement-sponsor] Deducted ₱${totalPot} from sponsor ${sponsorId} (pondo)`);
    } catch (error) {
      console.error(`[settlement-sponsor] Failed to deduct funds from sponsor ${sponsorId}:`, error);
    }
  }

  // Settle funds by user telegram ID
  for (const player of players) {
    const telegramId = player.user_id;
    const isFpPlayer = player.used_fp === true;
    const isDpcPlayer = player.used_dpc === true;

    // Ensure user exists in database and keep the latest profile info
    const existingUser = await userModel.findByTelegramId(telegramId);
    if (!existingUser) {
      await userModel.createOrUpdate({
        telegramId,
        username: player.username,
        firstName: player.first_name,
        lastName: player.last_name,
      });
    } else {
      await userModel.createOrUpdate({
        telegramId,
        username: player.username || existingUser.username,
        firstName: player.first_name || existingUser.first_name,
        lastName: player.last_name || existingUser.last_name,
      });
    }

    const beforeFunds = Number(existingUser?.funds ?? 0);

    // Only charge if not sponsored and not FP player
    if (!isSponsored && !isFpPlayer && effectiveBet > 0) {
      const isDpPlayer = dpPlayers.has(String(telegramId));
      const actualBet = isDpPlayer ? effectiveBet - 5 : effectiveBet;
      
      const afterCharge = beforeFunds - actualBet;
      const updatedAfterCharge = await userModel.updateFunds(telegramId, -actualBet);
      const afterChargeFunds = Number(updatedAfterCharge?.funds ?? afterCharge);

      if (winnerUserIds.has(String(telegramId))) {
        const prizeAmount = winnerPrizes[String(telegramId)] || 0;
        const updatedAfterWin = await userModel.updateFunds(telegramId, prizeAmount);
        console.log(`[settlement] ${telegramId}: ${beforeFunds} -> ${afterChargeFunds} -> ${updatedAfterWin?.funds ?? afterChargeFunds} (won ₱${prizeAmount}, DP: ${isDpPlayer})`);
      } else {
        console.log(`[settlement] ${telegramId}: ${beforeFunds} -> ${afterChargeFunds} (DP: ${isDpPlayer})`);
      }
    } else if (isFpPlayer) {
      // FP player - already paid via admin funds, just payout if winner
      if (winnerUserIds.has(String(telegramId))) {
        const prizeAmount = winnerPrizes[String(telegramId)] || 0;
        const updatedAfterWin = await userModel.updateFunds(telegramId, prizeAmount);
        console.log(`[settlement-fp] ${telegramId}: ${beforeFunds} -> ${updatedAfterWin?.funds ?? beforeFunds} (FP player, won ₱${prizeAmount})`);
      } else {
        console.log(`[settlement-fp] ${telegramId}: ${beforeFunds} (FP player, no charge)`);
      }
    } else {
      // Sponsored game - no charge to players, just payout winners
      if (winnerUserIds.has(String(telegramId))) {
        const prizeAmount = winnerPrizes[String(telegramId)] || 0;
        const updatedAfterWin = await userModel.updateFunds(telegramId, prizeAmount);
        const fundingLabel = isSponsored ? (sponsorFundingType === "pondo" ? "pondo" : "cash") : "regular";
        console.log(`[settlement-sponsored-${fundingLabel}] ${telegramId}: ${beforeFunds} -> ${updatedAfterWin?.funds ?? beforeFunds} (won ₱${prizeAmount})`);
      }
    }

    // Only deactivate DPC for winners (card only consumed when winning)
    if (isDpcPlayer && winnerUserIds.has(String(telegramId))) {
      try {
        await userModel.deactivateBac(telegramId, 'DPC');
        console.log(`[settlement] Deactivated DPC for winner ${telegramId}`);
      } catch (error) {
        console.error(`[settlement] Failed to deactivate DPC for user ${telegramId}:`, error);
      }
    }
  }

  return {
    settled: true,
    players,
    winners,
    prizePerPattern,
    totalPot,
    patternCount: realPatternCount,
    isSponsored,
    sponsorFundingType,
  };
}

module.exports = { settleBingoFundsForSession };
