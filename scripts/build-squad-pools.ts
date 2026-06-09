import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ACCEPTED_POSITIONS } from '../src/config/formations';
import { POPULAR_CLUBS } from '../src/config/clubs';
import { buildPoolKey, ERAS, POSITIONS } from '../src/game';
import type {
  ClubEraPool,
  FormationLine,
  NormalizedPosition,
  Player,
  PlayerCandidate,
  PositionPoolMeta,
  SquadPools,
  TeamEraTag,
} from '../src/types';
import type { NormalizedPlayersFile } from './types';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function ratingForCandidate(player: Player, tag: TeamEraTag) {
  const yearsBonus = Math.min(8, tag.yearsInEra * 2);
  const confidenceBonus = Math.min(5, Math.max(0, Math.floor((player.confidence - 60) / 8)));
  const sitelinkBonus = Math.min(10, Math.floor(Math.log10((player.sitelinks ?? 0) + 1) * 4));
  const chineseBonus = player.cnName ? 1 : 0;
  const clubExperienceBonus = Math.min(3, Math.max(0, player.clubs.length - 1));
  const weightBonus = tag.weight >= 0.7 ? 2 : 0;

  return clamp(
    70 + yearsBonus + confidenceBonus + sitelinkBonus + chineseBonus + clubExperienceBonus + weightBonus,
    70,
    99,
  );
}

function periodTag(yearsInEra: number, rating: number): string {
  if (rating >= 96 || yearsInEra >= 8) return '巅峰期';
  if (rating >= 90 || yearsInEra >= 5) return '核心期';
  if (yearsInEra >= 3) return '稳定期';
  return '短暂效力';
}

function candidateFor(player: Player, tag: TeamEraTag, position: NormalizedPosition): PlayerCandidate {
  const rating = ratingForCandidate(player, tag);
  return {
    playerId: player.id,
    displayName: player.displayName,
    name: player.name,
    cnName: player.cnName,
    nationality: player.nationality,
    clubId: tag.clubId,
    clubName: tag.clubName,
    clubCnName: tag.clubCnName,
    era: tag.era,
    position,
    originalPositions: player.normalizedPositions,
    normalizedPositions: player.normalizedPositions,
    rating,
    periodRating: rating,
    periodTag: periodTag(tag.yearsInEra, rating),
    confidence: player.confidence,
    weight: tag.weight,
    yearsInEra: tag.yearsInEra,
  };
}

function pushCandidate(target: Record<string, PlayerCandidate[]>, candidate: PlayerCandidate) {
  const key = buildPoolKey(candidate.clubId, candidate.era, candidate.position);
  const existing = target[key] ?? [];
  if (!existing.some((item) => item.playerId === candidate.playerId)) {
    target[key] = [...existing, candidate];
  }
}

function sortPool(pool: PlayerCandidate[]) {
  return pool.sort(
    (a, b) =>
      b.rating - a.rating ||
      b.yearsInEra - a.yearsInEra ||
      b.confidence - a.confidence ||
      a.displayName.localeCompare(b.displayName),
  );
}

function buildPools(players: Player[]) {
  const pools: Record<string, PlayerCandidate[]> = {};
  const relaxedPools: Record<string, PlayerCandidate[]> = {};

  players
    .filter((player) => player.confidence >= 60 && player.normalizedPositions.length > 0)
    .forEach((player) => {
      player.teamEraTags
        .filter((tag) => tag.weight > 0)
        .forEach((tag) => {
          POSITIONS.forEach((position) => {
            const strictMatch = player.normalizedPositions.includes(position);
            const relaxedMatch = ACCEPTED_POSITIONS[position].some((candidatePosition) =>
              player.normalizedPositions.includes(candidatePosition),
            );

            if (strictMatch) {
              pushCandidate(pools, candidateFor(player, tag, position));
            }

            if (relaxedMatch) {
              pushCandidate(relaxedPools, candidateFor(player, tag, position));
            }
          });
        });
    });

  Object.values(pools).forEach(sortPool);
  Object.values(relaxedPools).forEach(sortPool);
  return { pools, relaxedPools };
}

function clubEraKey(clubId: string, era: string) {
  return `${clubId}__${era}`;
}

function emptyPositionCounts(): Record<NormalizedPosition, number> {
  return Object.fromEntries(POSITIONS.map((position) => [position, 0])) as Record<NormalizedPosition, number>;
}

function emptyLineCounts(): Record<FormationLine, number> {
  return { GK: 0, DEF: 0, MID: 0, ATT: 0 };
}

function lineForPosition(position: NormalizedPosition): FormationLine {
  if (position === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(position)) return 'MID';
  return 'ATT';
}

function uniqueByPlayer(candidates: PlayerCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.playerId)) return false;
    seen.add(candidate.playerId);
    return true;
  });
}

function sourceQuality(playablePositions: NormalizedPosition[], lineCoverage: Record<FormationLine, number>) {
  const coveredLines = Object.values(lineCoverage).filter((count) => count > 0).length;
  if (playablePositions.length >= 8 && coveredLines >= 4) return 'high';
  if (playablePositions.length >= 5 && coveredLines >= 3) return 'medium';
  return 'low';
}

function buildPoolMetadata(
  pools: Record<string, PlayerCandidate[]>,
  relaxedPools: Record<string, PlayerCandidate[]>,
  clubs: typeof POPULAR_CLUBS,
) {
  const positionPoolMeta: Record<string, PositionPoolMeta> = {};
  const clubEraBuckets = new Map<string, PlayerCandidate[]>();

  clubs.forEach((club) => {
    ERAS.forEach((era) => {
      POSITIONS.forEach((position) => {
        const key = buildPoolKey(club.clubId, era, position);
        const strict = pools[key] ?? [];
        const relaxed = relaxedPools[key] ?? [];
        const candidateCount = strict.length;
        positionPoolMeta[key] = {
          key,
          clubKey: club.clubId,
          clubName: club.clubName,
          clubCnName: club.clubCnName,
          era,
          position,
          candidateCount,
          strictCount: strict.length,
          relaxedCount: relaxed.length,
          isPlayable: candidateCount >= 4,
        };

        if (strict.length > 0) {
          const bucketKey = clubEraKey(club.clubId, era);
          clubEraBuckets.set(bucketKey, [...(clubEraBuckets.get(bucketKey) ?? []), ...strict]);
        }
      });
    });
  });

  const clubEraPools: Record<string, ClubEraPool> = {};
  clubEraBuckets.forEach((items, key) => {
    const [clubId, era] = key.split('__');
    const club = clubs.find((item) => item.clubId === clubId);
    if (!club) return;

    const players = uniqueByPlayer(items).sort(
      (a, b) =>
        (b.periodRating ?? b.rating) - (a.periodRating ?? a.rating) ||
        b.yearsInEra - a.yearsInEra ||
        b.confidence - a.confidence ||
        a.displayName.localeCompare(b.displayName),
    );
    const positionCoverage = emptyPositionCounts();
    POSITIONS.forEach((position) => {
      positionCoverage[position] = positionPoolMeta[buildPoolKey(club.clubId, era as typeof ERAS[number], position)]?.candidateCount ?? 0;
    });
    const lineCoverage = emptyLineCounts();
    POSITIONS.forEach((position) => {
      lineCoverage[lineForPosition(position)] += positionCoverage[position];
    });
    const playablePositions = POSITIONS.filter((position) => positionCoverage[position] >= 4);
    const lowPositions = POSITIONS.filter((position) => positionCoverage[position] > 0 && positionCoverage[position] < 4);
    const dataConfidence =
      players.length > 0 ? Math.round(players.reduce((sum, player) => sum + player.confidence, 0) / players.length) : 0;

    clubEraPools[key] = {
      clubKey: club.clubId,
      clubName: club.clubName,
      clubCnName: club.clubCnName,
      era: era as typeof ERAS[number],
      players,
      totalPlayers: players.length,
      positionCoverage,
      lineCoverage,
      playablePositions,
      lowPositions,
      sourceQuality: sourceQuality(playablePositions, lineCoverage),
      dataConfidence,
    };
  });

  return { clubEraPools, positionPoolMeta };
}

function topPoolsByCandidateCount(pools: Record<string, PlayerCandidate[]>) {
  return Object.entries(pools)
    .map(([key, candidates]) => ({ key, count: candidates.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 30);
}

function playablePoolBreakdowns(pools: Record<string, PlayerCandidate[]>, relaxedPools: Record<string, PlayerCandidate[]>) {
  const playablePoolsByEra = Object.fromEntries(ERAS.map((era) => [era, 0]));
  const playablePoolsByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const lowCandidatePoolsByEra = Object.fromEntries(ERAS.map((era) => [era, 0]));
  const lowCandidatePoolsByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const playablePoolsByClub: Record<string, number> = {};
  const lowCandidatePoolsByClub: Record<string, number> = {};
  const positionsUsingRelaxedFallback = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  let lowCandidatePoolsAfterRelaxed = 0;

  Object.entries(pools).forEach(([key, candidates]) => {
    const [clubId, era, position] = key.split('__') as [string, string, NormalizedPosition];
    if (!clubId || !era || !position) return;
    const relaxedCount = relaxedPools[key]?.length ?? 0;

    if (candidates.length >= 4) {
      playablePoolsByEra[era] = (playablePoolsByEra[era] ?? 0) + 1;
      playablePoolsByPosition[position] = (playablePoolsByPosition[position] ?? 0) + 1;
      playablePoolsByClub[clubId] = (playablePoolsByClub[clubId] ?? 0) + 1;
    } else if (candidates.length > 0) {
      lowCandidatePoolsByEra[era] = (lowCandidatePoolsByEra[era] ?? 0) + 1;
      lowCandidatePoolsByPosition[position] = (lowCandidatePoolsByPosition[position] ?? 0) + 1;
      lowCandidatePoolsByClub[clubId] = (lowCandidatePoolsByClub[clubId] ?? 0) + 1;
      if (relaxedCount >= 4) positionsUsingRelaxedFallback[position] = (positionsUsingRelaxedFallback[position] ?? 0) + 1;
      if (relaxedCount < 4) lowCandidatePoolsAfterRelaxed += 1;
    }
  });

  return {
    playablePoolsByEra,
    playablePoolsByPosition,
    playablePoolsByClub: Object.fromEntries(
      Object.entries(playablePoolsByClub).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    lowCandidatePoolsByClub: Object.fromEntries(
      Object.entries(lowCandidatePoolsByClub).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
    lowCandidatePoolsByEra,
    lowCandidatePoolsByPosition,
    strictPlayablePoolCount: Object.values(pools).filter((items) => items.length >= 4).length,
    relaxedPlayablePoolCount: Object.values(relaxedPools).filter((items) => items.length >= 4).length,
    positionsUsingRelaxedFallback,
    lowCandidatePoolsAfterRelaxed,
  };
}

export async function buildSquadPools() {
  const normalized = JSON.parse(await readFile('data/generated/players.json', 'utf8')) as NormalizedPlayersFile;
  const { pools, relaxedPools } = buildPools(normalized.players);
  const activeClubIds = new Set(
    normalized.players.flatMap((player) => player.teamEraTags.map((tag) => tag.clubId)),
  );
  const clubs = POPULAR_CLUBS.filter((club) => activeClubIds.has(club.clubId));
  const poolCount = clubs.length * ERAS.length * POSITIONS.length;
  const totalCandidates = Object.values(pools).reduce((sum, items) => sum + items.length, 0);
  const strictPoolCount = Object.keys(pools).length;
  const playablePoolCount = Object.values(pools).filter((items) => items.length >= 4).length;
  const poolBreakdowns = playablePoolBreakdowns(pools, relaxedPools);
  const poolMetadata = buildPoolMetadata(pools, relaxedPools, clubs);
  const clubEraCoverage = Object.fromEntries(
    Object.entries(poolMetadata.clubEraPools).map(([key, pool]) => [
      key,
      {
        totalPlayers: pool.totalPlayers,
        GK: pool.lineCoverage.GK,
        DEF: pool.lineCoverage.DEF,
        MID: pool.lineCoverage.MID,
        ATT: pool.lineCoverage.ATT,
        playablePositions: pool.playablePositions,
        lowPositions: pool.lowPositions,
        sourceQuality: pool.sourceQuality,
      },
    ]),
  );
  const output: SquadPools = {
    generatedAt: new Date().toISOString(),
    source: normalized.source,
    clubs,
    eras: ERAS,
    positions: POSITIONS,
    pools,
    relaxedPools,
    clubEraPools: poolMetadata.clubEraPools,
    positionPoolMeta: poolMetadata.positionPoolMeta,
    stats: {
      clubMode: normalized.stats.clubMode,
      totalPlayers: normalized.players.length,
      totalCandidates,
      generatedPeriodCandidates: totalCandidates,
      strictPoolCount,
      playablePoolCount,
      ...poolBreakdowns,
      clubEraCoverage,
      topPoolsByCandidateCount: topPoolsByCandidateCount(pools),
      playersWithDatedClubHistory: normalized.stats.playersWithDatedClubHistory,
      poolCount,
      emptyPoolCount: poolCount - strictPoolCount,
    },
  };

  await mkdir('data/generated', { recursive: true });
  const json = `${JSON.stringify(output, null, 2)}\n`;
  await writeFile('data/generated/squadPools.json', json);
  if (process.env.WRITE_PUBLIC === '1') {
    await mkdir('public/data', { recursive: true });
    await writeFile('public/data/squadPools.json', json);
  }
  console.log(
    `Wrote ${output.stats.totalCandidates} strict candidates across ${strictPoolCount}/${poolCount} pools (${playablePoolCount} playable pools with >=4 candidates).`,
  );
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  buildSquadPools().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
