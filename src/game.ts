import { POPULAR_CLUBS } from './config/clubs';
import { FORMATIONS } from './config/formations';
import type {
  ClubOption,
  Era,
  FormationConfig,
  GameMode,
  HistoryEntry,
  MatchRecord,
  NormalizedPosition,
  PlayerCandidate,
  SlotSelection,
  SquadPools,
  SquadResult,
  SquadScores,
  SquadSlot,
} from './types';

export const ERAS: Era[] = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];

export const POSITIONS: NormalizedPosition[] = [
  'GK',
  'LB',
  'CB',
  'RB',
  'LWB',
  'RWB',
  'CDM',
  'CM',
  'CAM',
  'LM',
  'RM',
  'LF',
  'RF',
  'ST',
];

export const MODE_LABELS: Record<GameMode, string> = {
  random: '随机混搭挑战',
  singleClub: '单一队套挑战',
};

export const MODE_DESCRIPTIONS: Record<GameMode, string> = {
  random: '每个位置随机不同球队与年代，组出你的历史梦幻十一人。',
  singleClub: '选择一个俱乐部和阵型，每个位置随机不同年代，组出跨时代队套十一人。',
};

const HISTORY_KEY = 'lsk-dream-xi-history';
const PLAYABLE_POOL_MIN_CANDIDATES = 4;

export const RANDOM_MIX_CLUB_IDS = new Set<string>([
  'manchester_united',
  'manchester_city',
  'liverpool',
  'arsenal',
  'chelsea',
  'tottenham_hotspur',
  'real_madrid',
  'barcelona',
  'atletico_madrid',
  'valencia',
  'sevilla',
  'ac_milan',
  'inter_milan',
  'juventus',
  'napoli',
  'roma',
  'lazio',
  'bayern_munich',
  'borussia_dortmund',
  'paris_saint_germain',
]);

type CandidateSeed = {
  playerId: string;
  displayName: string;
  name?: string;
  nationality: string;
  clubId: string;
  era: Era;
  positions: NormalizedPosition[];
  rating: number;
  yearsInEra: number;
};

const FALLBACK_SEEDS: CandidateSeed[] = [
  { playerId: 'fallback-casillas', displayName: '卡西利亚斯', name: 'Iker Casillas', nationality: 'Spain', clubId: 'real_madrid', era: '2010s', positions: ['GK'], rating: 92, yearsInEra: 6 },
  { playerId: 'fallback-marcelo', displayName: '马塞洛', name: 'Marcelo', nationality: 'Brazil', clubId: 'real_madrid', era: '2010s', positions: ['LB', 'LWB', 'LM'], rating: 93, yearsInEra: 10 },
  { playerId: 'fallback-ramos', displayName: '拉莫斯', name: 'Sergio Ramos', nationality: 'Spain', clubId: 'real_madrid', era: '2010s', positions: ['CB', 'RB'], rating: 96, yearsInEra: 10 },
  { playerId: 'fallback-varane', displayName: '瓦拉内', name: 'Raphael Varane', nationality: 'France', clubId: 'real_madrid', era: '2010s', positions: ['CB'], rating: 91, yearsInEra: 9 },
  { playerId: 'fallback-carvajal', displayName: '卡瓦哈尔', name: 'Dani Carvajal', nationality: 'Spain', clubId: 'real_madrid', era: '2010s', positions: ['RB', 'RWB'], rating: 91, yearsInEra: 7 },
  { playerId: 'fallback-casemiro', displayName: '卡塞米罗', name: 'Casemiro', nationality: 'Brazil', clubId: 'real_madrid', era: '2010s', positions: ['CDM', 'CM'], rating: 93, yearsInEra: 7 },
  { playerId: 'fallback-modric', displayName: '莫德里奇', name: 'Luka Modric', nationality: 'Croatia', clubId: 'real_madrid', era: '2010s', positions: ['CM', 'CAM'], rating: 97, yearsInEra: 8 },
  { playerId: 'fallback-isco', displayName: '伊斯科', name: 'Isco', nationality: 'Spain', clubId: 'real_madrid', era: '2010s', positions: ['CAM', 'CM', 'LF'], rating: 90, yearsInEra: 7 },
  { playerId: 'fallback-ronaldo', displayName: 'C罗', name: 'Cristiano Ronaldo', nationality: 'Portugal', clubId: 'real_madrid', era: '2010s', positions: ['ST', 'LF', 'RF'], rating: 99, yearsInEra: 9 },
  { playerId: 'fallback-benzema', displayName: '本泽马', name: 'Karim Benzema', nationality: 'France', clubId: 'real_madrid', era: '2010s', positions: ['ST', 'CAM'], rating: 95, yearsInEra: 10 },
  { playerId: 'fallback-bale', displayName: '贝尔', name: 'Gareth Bale', nationality: 'Wales', clubId: 'real_madrid', era: '2010s', positions: ['RF', 'LF', 'ST', 'LB', 'RM', 'LM'], rating: 93, yearsInEra: 7 },
  { playerId: 'fallback-valdes', displayName: '巴尔德斯', name: 'Victor Valdes', nationality: 'Spain', clubId: 'barcelona', era: '2000s', positions: ['GK'], rating: 89, yearsInEra: 8 },
  { playerId: 'fallback-abidal', displayName: '阿比达尔', name: 'Eric Abidal', nationality: 'France', clubId: 'barcelona', era: '2000s', positions: ['LB', 'CB', 'LWB'], rating: 88, yearsInEra: 4 },
  { playerId: 'fallback-puyol', displayName: '普约尔', name: 'Carles Puyol', nationality: 'Spain', clubId: 'barcelona', era: '2000s', positions: ['CB', 'RB'], rating: 95, yearsInEra: 10 },
  { playerId: 'fallback-pique', displayName: '皮克', name: 'Gerard Pique', nationality: 'Spain', clubId: 'barcelona', era: '2000s', positions: ['CB'], rating: 90, yearsInEra: 2 },
  { playerId: 'fallback-alves', displayName: '阿尔维斯', name: 'Dani Alves', nationality: 'Brazil', clubId: 'barcelona', era: '2000s', positions: ['RB', 'RWB', 'RM'], rating: 94, yearsInEra: 2 },
  { playerId: 'fallback-busquets', displayName: '布斯克茨', name: 'Sergio Busquets', nationality: 'Spain', clubId: 'barcelona', era: '2000s', positions: ['CDM', 'CM'], rating: 91, yearsInEra: 2 },
  { playerId: 'fallback-xavi', displayName: '哈维', name: 'Xavi', nationality: 'Spain', clubId: 'barcelona', era: '2000s', positions: ['CM', 'CAM'], rating: 97, yearsInEra: 10 },
  { playerId: 'fallback-iniesta', displayName: '伊涅斯塔', name: 'Andres Iniesta', nationality: 'Spain', clubId: 'barcelona', era: '2000s', positions: ['CAM', 'CM', 'LM'], rating: 96, yearsInEra: 8 },
  { playerId: 'fallback-ronaldinho', displayName: '罗纳尔迪尼奥', name: 'Ronaldinho', nationality: 'Brazil', clubId: 'barcelona', era: '2000s', positions: ['LF', 'CAM', 'ST'], rating: 98, yearsInEra: 5 },
  { playerId: 'fallback-etoo', displayName: '埃托奥', name: "Samuel Eto'o", nationality: 'Cameroon', clubId: 'barcelona', era: '2000s', positions: ['ST', 'RF'], rating: 94, yearsInEra: 5 },
  { playerId: 'fallback-messi', displayName: '梅西', name: 'Lionel Messi', nationality: 'Argentina', clubId: 'barcelona', era: '2000s', positions: ['RF', 'ST', 'CAM'], rating: 98, yearsInEra: 6 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 70;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededIndex(seed: string, length: number): number {
  if (length <= 1) return 0;
  return hashString(seed) % length;
}

function periodTag(yearsInEra: number, rating: number): string {
  if (rating >= 96 || yearsInEra >= 8) return '巅峰期';
  if (rating >= 90 || yearsInEra >= 5) return '核心期';
  if (yearsInEra >= 3) return '稳定期';
  return '短暂效力';
}

function candidatePositions(candidate: PlayerCandidate): NormalizedPosition[] {
  return candidate.normalizedPositions?.length ? candidate.normalizedPositions : candidate.originalPositions as NormalizedPosition[];
}

export function buildPoolKey(clubId: string, era: Era, position: NormalizedPosition): string {
  return `${clubId}__${era}__${position}`;
}

function parsePoolKey(key: string): { clubId: string; era: Era; position: NormalizedPosition } | null {
  const [clubId, era, position] = key.split('__');
  if (!clubId || !ERAS.includes(era as Era) || !POSITIONS.includes(position as NormalizedPosition)) return null;
  return { clubId, era: era as Era, position: position as NormalizedPosition };
}

function clubById(clubId: string, clubs: ClubOption[]): ClubOption {
  return clubs.find((club) => club.clubId === clubId) ?? POPULAR_CLUBS[0];
}

function uniqueCandidates(candidates: PlayerCandidate[]): PlayerCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.playerId)) return false;
    seen.add(candidate.playerId);
    return true;
  });
}

function sortCandidates(candidates: PlayerCandidate[], displayPosition?: NormalizedPosition): PlayerCandidate[] {
  return uniqueCandidates(candidates).sort((a, b) => {
    const strictA = displayPosition && candidatePositions(a).includes(displayPosition) ? 1 : 0;
    const strictB = displayPosition && candidatePositions(b).includes(displayPosition) ? 1 : 0;
    return (
      strictB - strictA ||
      (b.periodRating ?? b.rating) - (a.periodRating ?? a.rating) ||
      b.yearsInEra - a.yearsInEra ||
      b.confidence - a.confidence ||
      a.displayName.localeCompare(b.displayName)
    );
  });
}

function createFallbackCandidate(seed: CandidateSeed, poolPosition: NormalizedPosition): PlayerCandidate {
  const club = clubById(seed.clubId, POPULAR_CLUBS);
  return {
    playerId: seed.playerId,
    displayName: seed.displayName,
    name: seed.name ?? seed.displayName,
    cnName: seed.displayName,
    nationality: seed.nationality,
    clubId: club.clubId,
    clubName: club.clubName,
    clubCnName: club.clubCnName,
    era: seed.era,
    position: poolPosition,
    originalPositions: seed.positions,
    normalizedPositions: seed.positions,
    rating: seed.rating,
    periodRating: seed.rating,
    periodTag: periodTag(seed.yearsInEra, seed.rating),
    confidence: 95,
    weight: clamp(seed.yearsInEra / 10, 0.2, 1),
    yearsInEra: seed.yearsInEra,
  };
}

function buildFallbackPools(): SquadPools {
  const pools: Record<string, PlayerCandidate[]> = {};
  const relaxedPools: Record<string, PlayerCandidate[]> = {};
  const acceptedByPosition = Object.fromEntries(
    POSITIONS.map((position) => [
      position,
      FORMATIONS.flatMap((formation) => formation.slots)
        .find((slot) => slot.displayPosition === position)?.acceptedPositions ?? [position],
    ]),
  ) as Record<NormalizedPosition, NormalizedPosition[]>;

  FALLBACK_SEEDS.forEach((seed) => {
    seed.positions.forEach((position) => {
      const strictKey = buildPoolKey(seed.clubId, seed.era, position);
      pools[strictKey] = [...(pools[strictKey] ?? []), createFallbackCandidate(seed, position)];
    });

    POSITIONS.forEach((position) => {
      if (seed.positions.some((candidatePosition) => acceptedByPosition[position].includes(candidatePosition))) {
        const relaxedKey = buildPoolKey(seed.clubId, seed.era, position);
        relaxedPools[relaxedKey] = [...(relaxedPools[relaxedKey] ?? []), createFallbackCandidate(seed, position)];
      }
    });
  });

  const poolCount = POPULAR_CLUBS.length * ERAS.length * POSITIONS.length;
  return {
    generatedAt: 'fallback',
    source: 'fallback',
    clubs: POPULAR_CLUBS,
    eras: ERAS,
    positions: POSITIONS,
    pools,
    relaxedPools,
    stats: {
      totalPlayers: FALLBACK_SEEDS.length,
      totalCandidates: Object.values(pools).reduce((sum, items) => sum + items.length, 0),
      poolCount,
      emptyPoolCount: poolCount - Object.keys(pools).length,
    },
  };
}

export const FALLBACK_SQUAD_POOLS = buildFallbackPools();

export function getPlayablePools(payload: SquadPools | null): SquadPools {
  if (
    !payload ||
    payload.generatedAt === 'fallback' ||
    payload.stats.totalCandidates <= 0 ||
    Object.keys(payload.pools ?? {}).length === 0
  ) {
    return FALLBACK_SQUAD_POOLS;
  }
  return payload;
}

function poolCandidates(data: SquadPools, clubId: string, era: Era, position: NormalizedPosition, relaxed = false) {
  const key = buildPoolKey(clubId, era, position);
  const source = relaxed ? data.relaxedPools : data.pools;
  return source?.[key] ?? [];
}

function playableEntriesForPosition(
  data: SquadPools,
  position: NormalizedPosition,
  options: {
    relaxed?: boolean;
    clubId?: string;
    clubIds?: Set<string>;
    era?: Era;
    excludeClubId?: string;
    excludeEra?: Era;
    selectedIds?: Set<string>;
  } = {},
) {
  const source = options.relaxed ? data.relaxedPools ?? {} : data.pools;
  return Object.entries(source)
    .flatMap(([key, candidates]) => {
      const parsed = parsePoolKey(key);
      if (!parsed || parsed.position !== position) return [];
      if (options.clubId && parsed.clubId !== options.clubId) return [];
      if (options.clubIds && !options.clubIds.has(parsed.clubId)) return [];
      if (options.era && parsed.era !== options.era) return [];
      if (options.excludeClubId && parsed.clubId === options.excludeClubId) return [];
      if (options.excludeEra && parsed.era === options.excludeEra) return [];
      const availableCandidates = filterSelected(candidates, options.selectedIds ?? new Set());
      if (availableCandidates.length < PLAYABLE_POOL_MIN_CANDIDATES) return [];
      return [
        {
          ...parsed,
          candidates: availableCandidates,
          count: availableCandidates.length,
          relaxed: Boolean(options.relaxed),
        },
      ];
    })
    .sort((a, b) => b.count - a.count || a.clubId.localeCompare(b.clubId) || a.era.localeCompare(b.era));
}

function pickPlayableEntryForPosition(
  data: SquadPools,
  position: NormalizedPosition,
  seed: string,
  options: Omit<Parameters<typeof playableEntriesForPosition>[2], 'relaxed'> = {},
) {
  const strictEntries = playableEntriesForPosition(data, position, { ...options, relaxed: false });
  if (strictEntries.length > 0) return strictEntries[seededIndex(`${seed}-strict`, strictEntries.length)];

  const relaxedEntries = playableEntriesForPosition(data, position, { ...options, relaxed: true });
  if (relaxedEntries.length > 0) return relaxedEntries[seededIndex(`${seed}-relaxed`, relaxedEntries.length)];

  return null;
}

export function clubSupportsFormation(data: SquadPools, clubId: string, formation: FormationConfig): boolean {
  return formation.slots.every((slot) =>
    Boolean(pickPlayableEntryForPosition(data, slot.displayPosition, `${clubId}-${slot.slotId}`, { clubId })),
  );
}

export function eligibleClubsForFormation(data: SquadPools, formation: FormationConfig): ClubOption[] {
  const clubs = data.clubs.length ? data.clubs : POPULAR_CLUBS;
  return clubs.filter((club) => clubSupportsFormation(data, club.clubId, formation));
}

export function pickReplacementClubForFormation(
  data: SquadPools,
  formation: FormationConfig,
  currentClubId: string,
  seed = `${Date.now()}`,
): ClubOption | null {
  const clubs = eligibleClubsForFormation(data, formation).filter((club) => club.clubId !== currentClubId);
  return clubs[seededIndex(seed, clubs.length)] ?? null;
}

function withCandidateDefaults(candidate: PlayerCandidate): PlayerCandidate {
  const positions = candidate.normalizedPositions?.length
    ? candidate.normalizedPositions
    : (candidate.originalPositions as NormalizedPosition[]);
  return {
    ...candidate,
    normalizedPositions: positions,
    periodRating: candidate.periodRating ?? candidate.rating,
    periodTag: candidate.periodTag ?? periodTag(candidate.yearsInEra, candidate.rating),
  };
}

function filterSelected(candidates: PlayerCandidate[], selectedIds: Set<string>) {
  return candidates.map(withCandidateDefaults).filter((candidate) => !selectedIds.has(candidate.playerId));
}

export function resolveCandidatesForSlot(
  data: SquadPools,
  slot: SquadSlot,
  selectedIds: Set<string>,
  options: { fixedClubId?: string; clubIds?: Set<string> } = {},
): { candidates: PlayerCandidate[]; source: 'strict' | 'relaxed' | 'playable-fallback' | 'fallback'; note: string } {
  const strict = filterSelected(poolCandidates(data, slot.clubId, slot.era, slot.displayPosition, false), selectedIds);
  if (strict.length >= PLAYABLE_POOL_MIN_CANDIDATES) {
    return { candidates: sortCandidates(strict, slot.displayPosition), source: 'strict', note: '严格匹配位置、球队与年代' };
  }

  const relaxed = filterSelected([
    ...poolCandidates(data, slot.clubId, slot.era, slot.displayPosition, true),
    ...slot.acceptedPositions.flatMap((position) => poolCandidates(data, slot.clubId, slot.era, position, false)),
  ], selectedIds);
  if (relaxed.length >= PLAYABLE_POOL_MIN_CANDIDATES) {
    return { candidates: sortCandidates(relaxed, slot.displayPosition), source: 'relaxed', note: '候选不足，已启用位置放宽' };
  }

  const playable = pickPlayableEntryForPosition(data, slot.displayPosition, `${slot.slotId}-${slot.clubId}-${slot.era}`, {
    selectedIds,
    clubId: options.fixedClubId,
    clubIds: options.clubIds,
  });
  if (playable) {
    return {
      candidates: sortCandidates(playable.candidates, slot.displayPosition),
      source: 'playable-fallback',
      note: '该条件候选较少，已自动切换到可玩历史池',
    };
  }

  if (options.fixedClubId) {
    return { candidates: [], source: 'playable-fallback', note: '当前条件可替换项不足' };
  }

  const fallback = filterSelected([
    ...poolCandidates(FALLBACK_SQUAD_POOLS, slot.clubId, slot.era, slot.displayPosition, false),
    ...poolCandidates(FALLBACK_SQUAD_POOLS, slot.clubId, slot.era, slot.displayPosition, true),
    ...poolCandidates(FALLBACK_SQUAD_POOLS, 'real_madrid', '2010s', slot.displayPosition, true),
    ...poolCandidates(FALLBACK_SQUAD_POOLS, 'barcelona', '2000s', slot.displayPosition, true),
    ...slot.acceptedPositions.flatMap((position) => poolCandidates(FALLBACK_SQUAD_POOLS, 'real_madrid', '2010s', position, false)),
    ...slot.acceptedPositions.flatMap((position) => poolCandidates(FALLBACK_SQUAD_POOLS, 'barcelona', '2000s', position, false)),
  ], selectedIds);
  return { candidates: sortCandidates(fallback, slot.displayPosition), source: 'fallback', note: '真实数据不足，已启用 fallback 示例候选' };
}

export function buildSquadSlots(
  data: SquadPools,
  mode: GameMode,
  formation: FormationConfig,
  options: { clubId?: string; era?: Era; seed?: string } = {},
): SquadSlot[] {
  const seed = options.seed ?? `${Date.now()}`;
  const clubs = data.clubs.length ? data.clubs : POPULAR_CLUBS;
  const defaultClub = clubs[0] ?? POPULAR_CLUBS[0];
  const randomMixClubs = clubs.filter((club) => RANDOM_MIX_CLUB_IDS.has(club.clubId));

  const usedRandomCombos = new Set<string>();
  const usedSingleClubEras = new Set<Era>();
  return formation.slots.map((baseSlot, index) => {
    let club = defaultClub;
    let era = ERAS[(index + 3) % ERAS.length];

    if (mode === 'singleClub' && options.clubId) {
      club = clubById(options.clubId, clubs);
      const strictEntries = playableEntriesForPosition(data, baseSlot.displayPosition, {
        clubId: club.clubId,
        relaxed: false,
      });
      const entries =
        strictEntries.length > 0
          ? strictEntries
          : playableEntriesForPosition(data, baseSlot.displayPosition, { clubId: club.clubId, relaxed: true });
      const unusedEraEntries = entries.filter((entry) => !usedSingleClubEras.has(entry.era));
      const eraPool = unusedEraEntries.length > 0 ? unusedEraEntries : entries;
      const unused = eraPool.filter((entry) => !usedRandomCombos.has(`${entry.clubId}-${entry.era}-${entry.position}`));
      const pool = unused.length > 0 ? unused : entries;
      const picked = pool[seededIndex(`${seed}-${club.clubId}-${baseSlot.slotId}-${index}`, Math.max(pool.length, 1))];
      era = picked?.era ?? ERAS[(index + 3) % ERAS.length];
      usedSingleClubEras.add(era);
      usedRandomCombos.add(`${club.clubId}-${era}-${baseSlot.displayPosition}`);
    } else if (mode === 'random') {
      const strictEntries = playableEntriesForPosition(data, baseSlot.displayPosition, {
        relaxed: false,
        clubIds: RANDOM_MIX_CLUB_IDS,
      });
      const entries =
        strictEntries.length > 0
          ? strictEntries
          : playableEntriesForPosition(data, baseSlot.displayPosition, { relaxed: true, clubIds: RANDOM_MIX_CLUB_IDS });
      const unused = entries.filter((entry) => !usedRandomCombos.has(`${entry.clubId}-${entry.era}-${entry.position}`));
      const pool = unused.length > 0 ? unused : entries;
      const picked = pool[seededIndex(`${seed}-${baseSlot.slotId}-${index}`, Math.max(pool.length, 1))];
      club = picked ? clubById(picked.clubId, clubs) : randomMixClubs[index % Math.max(1, randomMixClubs.length)] ?? defaultClub;
      era = picked?.era ?? ERAS[(index + 3) % ERAS.length];
      usedRandomCombos.add(`${club.clubId}-${era}-${baseSlot.displayPosition}`);
    } else {
      const currentHasPlayable =
        filterSelected(poolCandidates(data, club.clubId, era, baseSlot.displayPosition, false), new Set()).length >=
          PLAYABLE_POOL_MIN_CANDIDATES ||
        filterSelected(poolCandidates(data, club.clubId, era, baseSlot.displayPosition, true), new Set()).length >=
          PLAYABLE_POOL_MIN_CANDIDATES;
      if (!currentHasPlayable) {
        const picked = pickPlayableEntryForPosition(data, baseSlot.displayPosition, `${seed}-${baseSlot.slotId}-${index}`);
        if (picked) {
          club = clubById(picked.clubId, clubs);
          era = picked.era;
        }
      }
    }

    return {
      ...baseSlot,
      label: baseSlot.displayPosition,
      position: baseSlot.displayPosition,
      clubId: club.clubId,
      clubName: club.clubName,
      clubCnName: club.clubCnName,
      era,
    };
  });
}

export function replaceSlotCondition(
  data: SquadPools,
  slot: SquadSlot,
  kind: 'club' | 'era',
  selectedIds: Set<string>,
  seed = `${Date.now()}`,
  replaceOptions: { clubIds?: Set<string> } = {},
): SquadSlot {
  const clubs = data.clubs.length ? data.clubs : POPULAR_CLUBS;

  const options =
    kind === 'club'
      ? { era: slot.era, excludeClubId: slot.clubId, selectedIds }
      : { clubId: slot.clubId, excludeEra: slot.era, selectedIds };
  const entries = [
    ...playableEntriesForPosition(data, slot.displayPosition, { ...options, relaxed: false, clubIds: replaceOptions.clubIds }),
    ...playableEntriesForPosition(data, slot.displayPosition, { ...options, relaxed: true, clubIds: replaceOptions.clubIds }),
  ];
  const picked = entries[seededIndex(`${seed}-${kind}`, entries.length)];
  if (!picked) return slot;

  const club = clubById(picked.clubId, clubs);
  return {
    ...slot,
    clubId: club.clubId,
    clubName: club.clubName,
    clubCnName: club.clubCnName,
    era: picked.era,
  };
}

export function ensurePlayableSlot(
  data: SquadPools,
  slot: SquadSlot,
  selectedIds: Set<string>,
  seed = `${Date.now()}`,
  options: { fixedClubId?: string; clubIds?: Set<string> } = {},
): SquadSlot {
  const strict = filterSelected(poolCandidates(data, slot.clubId, slot.era, slot.displayPosition, false), selectedIds);
  const relaxed = filterSelected([
    ...poolCandidates(data, slot.clubId, slot.era, slot.displayPosition, true),
    ...slot.acceptedPositions.flatMap((position) => poolCandidates(data, slot.clubId, slot.era, position, false)),
  ], selectedIds);
  if (strict.length >= PLAYABLE_POOL_MIN_CANDIDATES || relaxed.length >= PLAYABLE_POOL_MIN_CANDIDATES) return slot;

  const picked = pickPlayableEntryForPosition(data, slot.displayPosition, seed, {
    selectedIds,
    clubId: options.fixedClubId,
    clubIds: options.clubIds,
  });
  if (!picked) return slot;
  const clubs = data.clubs.length ? data.clubs : POPULAR_CLUBS;
  const club = clubById(picked.clubId, clubs);
  return {
    ...slot,
    clubId: club.clubId,
    clubName: club.clubName,
    clubCnName: club.clubCnName,
    era: picked.era,
  };
}

function maxRepeatScore(values: (string | undefined)[], factor: number, maxBonus: number) {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value!, (counts.get(value!) ?? 0) + 1));
  const max = Math.max(0, ...counts.values());
  return Math.min(maxBonus, Math.max(0, max - 1) * factor);
}

function positionScoreWeight(position: NormalizedPosition): number {
  const weights: Record<NormalizedPosition, number> = {
    GK: 1,
    CB: 1.04,
    LB: 1,
    RB: 1,
    LWB: 1,
    RWB: 1,
    CDM: 1.04,
    CM: 1.05,
    CAM: 1.05,
    LM: 0.98,
    RM: 0.98,
    LF: 1.03,
    RF: 1.03,
    ST: 1.08,
  };
  return weights[position];
}

function weightedMeanScores(items: { slot: SquadSlot; player: PlayerCandidate }[]): number {
  if (items.length === 0) return 70;
  const weighted = items.map((item) => {
    const rating = item.player.periodRating ?? item.player.rating;
    const weight = positionScoreWeight(item.slot.displayPosition);
    const positionFit = candidatePositions(item.player).includes(item.slot.displayPosition) ? 1 : 0;
    return {
      value: clamp(rating + positionFit, 70, 99),
      weight,
    };
  });
  const weightSum = weighted.reduce((sum, item) => sum + item.weight, 0);
  return weighted.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum;
}

function eraStart(era: Era): number {
  return Number(era.slice(0, 4));
}

function eraBalance(players: PlayerCandidate[]): number {
  if (players.length === 0) return 70;
  const eras = players.map((player) => eraStart(player.era));
  const span = Math.max(...eras) - Math.min(...eras);
  const repeatBonus = maxRepeatScore(players.map((player) => player.era), 3, 12);
  const clubEraBonus = maxRepeatScore(players.map((player) => `${player.clubId}-${player.era}`), 2, 8);
  const nearbyPairs = eras.reduce((sum, era, index) => {
    return sum + eras.slice(index + 1).filter((otherEra) => Math.abs(otherEra - era) <= 10).length;
  }, 0);
  const nearbyBonus = Math.min(8, nearbyPairs * 0.7);
  const spanPenalty = Math.min(18, Math.floor(span / 10) * 3);
  return clamp(78 + repeatBonus + clubEraBonus + nearbyBonus - spanPenalty, 70, 99);
}

export function calculateSquadResult(formation: FormationConfig, slots: SquadSlot[], selections: SlotSelection[]): SquadResult {
  const selected = new Map(selections.map((selection) => [selection.slotId, selection.candidate]));
  const playersBySlot = slots
    .map((slot) => ({ slot, player: selected.get(slot.slotId) }))
    .filter((item): item is { slot: SquadSlot; player: PlayerCandidate } => Boolean(item.player));
  const players = playersBySlot.map((item) => item.player);

  const attackScore = weightedMeanScores(playersBySlot.filter((item) => item.slot.line === 'ATT'));
  const midfieldScore = weightedMeanScores(playersBySlot.filter((item) => item.slot.line === 'MID'));
  const defenseScore = weightedMeanScores(playersBySlot.filter((item) => item.slot.line === 'DEF'));
  const goalkeeperScore = weightedMeanScores(playersBySlot.filter((item) => item.slot.line === 'GK'));

  const chemistryScore = clamp(
    70 +
      maxRepeatScore(players.map((player) => player.clubId), 4, 12) +
      maxRepeatScore(players.map((player) => player.era), 3, 9) +
      maxRepeatScore(players.map((player) => player.nationality), 2, 8) +
      Math.min(6, players.filter((player, index) =>
        players.slice(index + 1).some((otherPlayer) => Math.abs(eraStart(otherPlayer.era) - eraStart(player.era)) <= 10),
      ).length),
    70,
    99,
  );
  const eraBalanceScore = eraBalance(players);

  const scores: SquadScores = {
    attackScore: Math.round(attackScore),
    midfieldScore: Math.round(midfieldScore),
    defenseScore: Math.round(defenseScore),
    goalkeeperScore: Math.round(goalkeeperScore),
    chemistryScore: Math.round(chemistryScore),
    eraBalanceScore: Math.round(eraBalanceScore),
    overallScore: Math.round(
      attackScore * 0.3 +
        midfieldScore * 0.25 +
        defenseScore * 0.25 +
        goalkeeperScore * 0.08 +
        chemistryScore * 0.08 +
        eraBalanceScore * 0.04,
    ),
  };

  const record = predictRecord(scores.overallScore, players.map((player) => player.playerId).join('|'));
  const { grade, gradeText } = gradeSquad(scores.overallScore);

  return {
    scores,
    record,
    grade,
    gradeText,
    corePlayers: pickCorePlayers(playersBySlot),
    formationId: formation.formationId,
    formationName: formation.name,
  };
}

function predictRecord(overallScore: number, seed: string): MatchRecord {
  const roll = seededIndex(`record-${seed}-${overallScore}`, 1000) / 999;
  let winsMin = 12;
  let winsMax = 15;
  let lossesMin = 10;
  let lossesMax = 15;

  if (overallScore >= 98) {
    const options: MatchRecord[] = [
      { wins: 38, draws: 0, losses: 0 },
      { wins: 37, draws: 1, losses: 0 },
      { wins: 36, draws: 2, losses: 0 },
    ];
    return options[seededIndex(seed, options.length)];
  }

  if (overallScore >= 94) {
    winsMin = 34; winsMax = 36; lossesMin = 0; lossesMax = 2;
  } else if (overallScore >= 90) {
    winsMin = 30; winsMax = 33; lossesMin = 1; lossesMax = 4;
  } else if (overallScore >= 85) {
    winsMin = 25; winsMax = 29; lossesMin = 3; lossesMax = 6;
  } else if (overallScore >= 80) {
    winsMin = 20; winsMax = 24; lossesMin = 5; lossesMax = 9;
  } else if (overallScore >= 75) {
    winsMin = 16; winsMax = 19; lossesMin = 8; lossesMax = 12;
  }

  const wins = winsMin + Math.floor(roll * (winsMax - winsMin + 1));
  const lossRoll = seededIndex(`loss-${seed}-${overallScore}`, 1000) / 999;
  const losses = Math.min(38 - wins, lossesMin + Math.floor(lossRoll * (lossesMax - lossesMin + 1)));
  return { wins, losses, draws: 38 - wins - losses };
}

export function gradeSquad(overallScore: number) {
  if (overallScore >= 98) return { grade: 'SS', gradeText: '宇宙级梦幻队' };
  if (overallScore >= 94) return { grade: 'S+', gradeText: '历史级强队' };
  if (overallScore >= 90) return { grade: 'S', gradeText: '冠军热门' };
  if (overallScore >= 85) return { grade: 'A+', gradeText: '豪门级阵容' };
  if (overallScore >= 80) return { grade: 'A', gradeText: '欧冠淘汰赛级别' };
  if (overallScore >= 75) return { grade: 'B+', gradeText: '有明显短板' };
  if (overallScore >= 70) return { grade: 'B', gradeText: '情怀阵容' };
  return { grade: 'C', gradeText: '需要重新组队' };
}

function pickCorePlayers(playersBySlot: { slot: SquadSlot; player: PlayerCandidate }[]) {
  const priority: Record<NormalizedPosition, number> = {
    ST: 14,
    LF: 13,
    RF: 13,
    CAM: 12,
    LM: 11,
    RM: 11,
    CM: 10,
    CDM: 9,
    LWB: 8,
    RWB: 8,
    CB: 7,
    LB: 6,
    RB: 6,
    GK: 5,
  };

  const linePriority: Array<SquadSlot['line']> = ['GK', 'DEF', 'MID', 'ATT'];
  const selected = new Set<string>();
  const ranked = [...playersBySlot].sort(
    (a, b) =>
      (b.player.periodRating ?? b.player.rating) - (a.player.periodRating ?? a.player.rating) ||
      b.player.yearsInEra - a.player.yearsInEra ||
      priority[b.slot.displayPosition] - priority[a.slot.displayPosition],
  );
  const core: PlayerCandidate[] = [];

  linePriority.forEach((line) => {
    const candidate = ranked.find((item) => item.slot.line === line && !selected.has(item.player.playerId));
    if (candidate) {
      selected.add(candidate.player.playerId);
      core.push(candidate.player);
    }
  });

  ranked.forEach((item) => {
    if (core.length >= 5 || selected.has(item.player.playerId)) return;
    selected.add(item.player.playerId);
    core.push(item.player);
  });

  return core;
}

export function formatRecord(record: MatchRecord): string {
  return `${record.wins}-${record.draws}-${record.losses}`;
}

export function saveHistory(mode: GameMode, result: SquadResult) {
  const existing = loadHistory();
  const entry: HistoryEntry = {
    id: `${Date.now()}`,
    createdAt: new Date().toISOString(),
    mode,
    formationId: result.formationId,
    formationName: result.formationName,
    record: result.record,
    grade: result.grade,
    gradeText: result.gradeText,
    overallScore: result.scores.overallScore,
    corePlayers: result.corePlayers,
  };

  localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...existing].slice(0, 12)));
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
