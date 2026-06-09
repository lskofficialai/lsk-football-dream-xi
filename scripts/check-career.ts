import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { NormalizedPlayersFile } from './types';
import type { NormalizedPosition, Player, SquadPools } from '../src/types';

const VALID_POOL_KEY =
  /^[a-z0-9_]+__(1960s|1970s|1980s|1990s|2000s|2010s|2020s)__(GK|LB|CB|RB|LWB|RWB|CDM|CM|CAM|LM|RM|LF|RF|ST)$/;
const FORBIDDEN_KEY_TOKENS = new Set(['25ucl', '24ucl', 'wg', 'ws', 'dp', 'icontm', 'el', 'bdo']);
const FORBIDDEN_KEY_SUBSTRINGS = ['salary', 'wage', 'ovr', 'classname', 'seasonkey'];
const TARGET_ERAS = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const POSITIONS: NormalizedPosition[] = ['GK', 'LB', 'CB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LF', 'RF', 'ST'];
const PLAYABLE_POOL_MIN_CANDIDATES = 4;
const CHECK_TARGETS = {
  mvp: {
    minDatedHistory: 300,
    minPeriodCandidates: 1200,
    minStrictPoolCount: 120,
    minPlayablePoolCount: 80,
  },
  extended: {
    minDatedHistory: 4500,
    minPeriodCandidates: 2500,
    minStrictPoolCount: 450,
    minPlayablePoolCount: 250,
  },
  historical: {
    minDatedHistory: 6500,
    minPeriodCandidates: 4000,
    minStrictPoolCount: 650,
    minPlayablePoolCount: 350,
  },
} as const;

type CareerCheckMode = keyof typeof CHECK_TARGETS;

export interface CareerCheckOptions {
  baseDir?: string;
  mode?: CareerCheckMode;
  minDatedHistory?: number;
  minPeriodCandidates?: number;
  minStrictPoolCount?: number;
  minPlayablePoolCount?: number;
  maxEmptyPoolRate?: number;
}

export interface CareerCheckSummary {
  checkMode: CareerCheckMode;
  source: string;
  cardRecordCount: 0;
  uniquePlayerCount: number;
  playersWithDatedClubHistory: number;
  generatedPeriodCandidates: number;
  strictPoolCount: number;
  playablePoolCount: number;
  poolCount: number;
  emptyPoolCount: number;
  emptyPoolRate: number;
  forbiddenKeyCount: number;
  top30Pools: Array<{ key: string; count: number }>;
  topPoolsByCandidateCount: Array<{ key: string; count: number }>;
  playablePoolsByEra: Record<string, number>;
  playablePoolsByPosition: Record<string, number>;
  playablePoolsByClub: Record<string, number>;
  lowCandidatePoolsByEra: Record<string, number>;
  lowCandidatePoolsByPosition: Record<string, number>;
  lowCandidatePoolsByClub: Record<string, number>;
  clubEraCoverage: NonNullable<SquadPools['stats']['clubEraCoverage']>;
  strictPlayablePoolCount: number;
  relaxedPlayablePoolCount: number;
  positionsUsingRelaxedFallback: Record<string, number>;
  lowCandidatePoolsAfterRelaxed: number;
  shortfalls: {
    playersWithDatedClubHistory: number;
    generatedPeriodCandidates: number;
    strictPoolCount: number;
    playablePoolCount: number;
  };
}

function numberOption(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

function hasDatedClubHistory(player: Player): boolean {
  return Boolean(
    player.teamEraTags?.some((tag) => Boolean(tag.fromYear) && tag.yearsInEra > 0) ||
      player.clubs?.some((club) => Boolean(club.fromYear)),
  );
}

function countDatedPlayers(playersFile: NormalizedPlayersFile): number {
  return playersFile.stats.playersWithDatedClubHistory ?? playersFile.players.filter(hasDatedClubHistory).length;
}

function invalidPoolKeys(keys: string[]): string[] {
  return keys.filter((key) => !VALID_POOL_KEY.test(key));
}

function forbiddenPoolKeys(keys: string[]): string[] {
  return keys.filter((key) => {
    const lower = key.toLowerCase();
    const tokens = lower.split('__');
    return (
      tokens.some((token) => FORBIDDEN_KEY_TOKENS.has(token)) ||
      FORBIDDEN_KEY_SUBSTRINGS.some((substring) => lower.includes(substring))
    );
  });
}

function topPools(pools: SquadPools['pools']): CareerCheckSummary['top30Pools'] {
  return Object.entries(pools)
    .map(([key, candidates]) => ({ key, count: candidates.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, 30);
}

function inferCheckMode(squadPools: SquadPools, explicitMode?: string): CareerCheckMode {
  if (explicitMode === 'mvp' || explicitMode === 'extended' || explicitMode === 'historical') return explicitMode;
  if (squadPools.clubs.length > 16) return 'historical';
  if (squadPools.clubs.length > 8) return 'extended';
  return 'mvp';
}

function poolBreakdowns(pools: SquadPools['pools']) {
  const playablePoolsByEra = Object.fromEntries(TARGET_ERAS.map((era) => [era, 0]));
  const playablePoolsByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const lowCandidatePoolsByEra = Object.fromEntries(TARGET_ERAS.map((era) => [era, 0]));
  const lowCandidatePoolsByPosition = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const playablePoolsByClub: Record<string, number> = {};
  const lowCandidatePoolsByClub: Record<string, number> = {};

  Object.entries(pools).forEach(([key, candidates]) => {
    const [clubId, era, position] = key.split('__');
    if (!clubId || !era || !position) return;

    if (candidates.length >= PLAYABLE_POOL_MIN_CANDIDATES) {
      playablePoolsByEra[era] = (playablePoolsByEra[era] ?? 0) + 1;
      playablePoolsByPosition[position] = (playablePoolsByPosition[position] ?? 0) + 1;
      playablePoolsByClub[clubId] = (playablePoolsByClub[clubId] ?? 0) + 1;
    } else if (candidates.length > 0) {
      lowCandidatePoolsByEra[era] = (lowCandidatePoolsByEra[era] ?? 0) + 1;
      lowCandidatePoolsByPosition[position] = (lowCandidatePoolsByPosition[position] ?? 0) + 1;
      lowCandidatePoolsByClub[clubId] = (lowCandidatePoolsByClub[clubId] ?? 0) + 1;
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
  };
}

function lineForPosition(position: string) {
  if (position === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(position)) return 'DEF';
  if (['CDM', 'CM', 'CAM', 'LM', 'RM'].includes(position)) return 'MID';
  return 'ATT';
}

function computedClubEraCoverage(squadPools: SquadPools): NonNullable<SquadPools['stats']['clubEraCoverage']> {
  const coverage: NonNullable<SquadPools['stats']['clubEraCoverage']> = {};
  Object.entries(squadPools.pools).forEach(([key, candidates]) => {
    const [clubId, era, position] = key.split('__');
    if (!clubId || !era || !position) return;
    const clubEraKey = `${clubId}__${era}`;
    const row = coverage[clubEraKey] ?? {
      totalPlayers: 0,
      GK: 0,
      DEF: 0,
      MID: 0,
      ATT: 0,
      playablePositions: [],
      lowPositions: [],
      sourceQuality: 'low',
    };
    row.totalPlayers += candidates.length;
    row[lineForPosition(position) as 'GK' | 'DEF' | 'MID' | 'ATT'] += candidates.length;
    if (candidates.length >= PLAYABLE_POOL_MIN_CANDIDATES) {
      row.playablePositions = [...new Set([...row.playablePositions, position as NormalizedPosition])];
    } else if (candidates.length > 0) {
      row.lowPositions = [...new Set([...row.lowPositions, position as NormalizedPosition])];
    }
    const coveredLines = [row.GK, row.DEF, row.MID, row.ATT].filter((count) => count > 0).length;
    row.sourceQuality = row.playablePositions.length >= 8 && coveredLines >= 4 ? 'high' : row.playablePositions.length >= 5 ? 'medium' : 'low';
    coverage[clubEraKey] = row;
  });
  return coverage;
}

function relaxedBreakdowns(squadPools: SquadPools) {
  const relaxedPools = squadPools.relaxedPools ?? {};
  const positionsUsingRelaxedFallback = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  let lowCandidatePoolsAfterRelaxed = 0;

  Object.entries(squadPools.pools).forEach(([key, candidates]) => {
    const position = key.split('__')[2];
    if (!position) return;
    const relaxedCount = relaxedPools[key]?.length ?? 0;
    if (candidates.length > 0 && candidates.length < PLAYABLE_POOL_MIN_CANDIDATES) {
      if (relaxedCount >= PLAYABLE_POOL_MIN_CANDIDATES) {
        positionsUsingRelaxedFallback[position] = (positionsUsingRelaxedFallback[position] ?? 0) + 1;
      } else {
        lowCandidatePoolsAfterRelaxed += 1;
      }
    }
  });

  return {
    strictPlayablePoolCount: Object.values(squadPools.pools).filter((items) => items.length >= PLAYABLE_POOL_MIN_CANDIDATES).length,
    relaxedPlayablePoolCount: Object.values(relaxedPools).filter((items) => items.length >= PLAYABLE_POOL_MIN_CANDIDATES).length,
    positionsUsingRelaxedFallback,
    lowCandidatePoolsAfterRelaxed,
  };
}

function shortfall(actual: number, target: number): number {
  return Math.max(0, target + 1 - actual);
}

export async function checkCareerData(options: CareerCheckOptions = {}): Promise<CareerCheckSummary> {
  const baseDir = options.baseDir ?? 'public/data';
  const maxEmptyPoolRate = options.maxEmptyPoolRate ?? numberOption(process.env.MAX_EMPTY_POOL_RATE, 1);
  const playersFile = await readJson<NormalizedPlayersFile>(`${baseDir}/players.json`);
  const squadPools = await readJson<SquadPools>(`${baseDir}/squadPools.json`);
  const checkMode = inferCheckMode(
    squadPools,
    options.mode ??
      process.env.CAREER_CHECK_MODE ??
      process.env.WIKIDATA_CLUB_MODE ??
      squadPools.stats.clubMode ??
      playersFile.stats.clubMode,
  );
  const modeTargets = CHECK_TARGETS[checkMode];
  const minDatedHistory =
    options.minDatedHistory ?? numberOption(process.env.MIN_DATED_HISTORY, modeTargets.minDatedHistory);
  const minPeriodCandidates =
    options.minPeriodCandidates ?? numberOption(process.env.MIN_PERIOD_CANDIDATES, modeTargets.minPeriodCandidates);
  const minStrictPoolCount =
    options.minStrictPoolCount ?? numberOption(process.env.MIN_STRICT_POOL_COUNT, modeTargets.minStrictPoolCount);
  const minPlayablePoolCount =
    options.minPlayablePoolCount ?? numberOption(process.env.MIN_PLAYABLE_POOL_COUNT, modeTargets.minPlayablePoolCount);
  const poolKeys = Object.keys(squadPools.pools);
  const source = squadPools.source ?? playersFile.source ?? 'unknown';
  const strictPoolCount = squadPools.stats.strictPoolCount ?? poolKeys.length;
  const playablePoolCount =
    squadPools.stats.playablePoolCount ??
    Object.values(squadPools.pools).filter((items) => items.length >= PLAYABLE_POOL_MIN_CANDIDATES).length;
  const generatedPeriodCandidates = squadPools.stats.generatedPeriodCandidates ?? squadPools.stats.totalCandidates;
  const playersWithDatedClubHistory = squadPools.stats.playersWithDatedClubHistory ?? countDatedPlayers(playersFile);
  const poolCount = squadPools.stats.poolCount;
  const emptyPoolCount = squadPools.stats.emptyPoolCount;
  const emptyPoolRate = poolCount > 0 ? emptyPoolCount / poolCount : 1;
  const badShapeKeys = invalidPoolKeys(poolKeys);
  const badTokenKeys = forbiddenPoolKeys(poolKeys);
  const computedBreakdowns = poolBreakdowns(squadPools.pools);
  const computedRelaxedBreakdowns = relaxedBreakdowns(squadPools);
  const playablePoolsByEra = squadPools.stats.playablePoolsByEra ?? computedBreakdowns.playablePoolsByEra;
  const playablePoolsByPosition = squadPools.stats.playablePoolsByPosition ?? computedBreakdowns.playablePoolsByPosition;
  const playablePoolsByClub = squadPools.stats.playablePoolsByClub ?? computedBreakdowns.playablePoolsByClub;
  const lowCandidatePoolsByEra = squadPools.stats.lowCandidatePoolsByEra ?? computedBreakdowns.lowCandidatePoolsByEra;
  const lowCandidatePoolsByPosition =
    squadPools.stats.lowCandidatePoolsByPosition ?? computedBreakdowns.lowCandidatePoolsByPosition;
  const lowCandidatePoolsByClub = squadPools.stats.lowCandidatePoolsByClub ?? computedBreakdowns.lowCandidatePoolsByClub;
  const clubEraCoverage = squadPools.stats.clubEraCoverage ?? computedClubEraCoverage(squadPools);
  const strictPlayablePoolCount =
    squadPools.stats.strictPlayablePoolCount ?? computedRelaxedBreakdowns.strictPlayablePoolCount;
  const relaxedPlayablePoolCount =
    squadPools.stats.relaxedPlayablePoolCount ?? computedRelaxedBreakdowns.relaxedPlayablePoolCount;
  const positionsUsingRelaxedFallback =
    squadPools.stats.positionsUsingRelaxedFallback ?? computedRelaxedBreakdowns.positionsUsingRelaxedFallback;
  const lowCandidatePoolsAfterRelaxed =
    squadPools.stats.lowCandidatePoolsAfterRelaxed ?? computedRelaxedBreakdowns.lowCandidatePoolsAfterRelaxed;
  const top30Pools = squadPools.stats.topPoolsByCandidateCount ?? topPools(squadPools.pools);
  const shortfalls = {
    playersWithDatedClubHistory: shortfall(playersWithDatedClubHistory, minDatedHistory),
    generatedPeriodCandidates: shortfall(generatedPeriodCandidates, minPeriodCandidates),
    strictPoolCount: shortfall(strictPoolCount, minStrictPoolCount),
    playablePoolCount: shortfall(playablePoolCount, minPlayablePoolCount),
  };
  const errors: string[] = [];

  if (source === 'fallback' || !['wikidata', 'wikidata+lsk-local'].includes(source)) {
    errors.push(`source must be wikidata or wikidata+lsk-local, got ${source}.`);
  }
  if (playersWithDatedClubHistory <= minDatedHistory) {
    errors.push(`playersWithDatedClubHistory must be > ${minDatedHistory}, got ${playersWithDatedClubHistory}.`);
  }
  if (generatedPeriodCandidates <= minPeriodCandidates) {
    errors.push(`generatedPeriodCandidates must be > ${minPeriodCandidates}, got ${generatedPeriodCandidates}.`);
  }
  if (strictPoolCount <= minStrictPoolCount) {
    errors.push(`strictPoolCount must be > ${minStrictPoolCount}, got ${strictPoolCount}.`);
  }
  if (playablePoolCount <= minPlayablePoolCount) {
    errors.push(`playablePoolCount must be > ${minPlayablePoolCount}, got ${playablePoolCount}.`);
  }
  if (emptyPoolRate > maxEmptyPoolRate) {
    errors.push(`emptyPoolRate must be <= ${maxEmptyPoolRate}, got ${emptyPoolRate.toFixed(3)}.`);
  }
  if (badShapeKeys.length > 0) {
    errors.push(`invalid pool key shape: ${badShapeKeys.slice(0, 20).join(', ')}.`);
  }
  if (badTokenKeys.length > 0) {
    errors.push(`FC Online key tokens remain: ${badTokenKeys.slice(0, 20).join(', ')}.`);
  }

  const summary: CareerCheckSummary = {
    checkMode,
    source,
    cardRecordCount: 0,
    uniquePlayerCount: playersFile.count,
    playersWithDatedClubHistory,
    generatedPeriodCandidates,
    strictPoolCount,
    playablePoolCount,
    poolCount,
    emptyPoolCount,
    emptyPoolRate: Number(emptyPoolRate.toFixed(4)),
    forbiddenKeyCount: badTokenKeys.length,
    top30Pools,
    topPoolsByCandidateCount: top30Pools,
    playablePoolsByEra,
    playablePoolsByPosition,
    playablePoolsByClub,
    lowCandidatePoolsByEra,
    lowCandidatePoolsByPosition,
    lowCandidatePoolsByClub,
    clubEraCoverage,
    strictPlayablePoolCount,
    relaxedPlayablePoolCount,
    positionsUsingRelaxedFallback,
    lowCandidatePoolsAfterRelaxed,
    shortfalls,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (errors.length > 0) {
    throw new Error(`Career data check failed:\n- ${errors.join('\n- ')}`);
  }

  return summary;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  checkCareerData({
    baseDir: argValue('base') ?? process.env.CAREER_CHECK_BASE_DIR ?? 'public/data',
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
